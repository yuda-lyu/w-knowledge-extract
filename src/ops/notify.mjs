// notify.mjs — Telegram 通知器(序列化佇列＋重試＋4xx/5xx 自行拋出)與 HTML 轉義(泛用件,自 tai-news 之執行殼移入)
//
// 【單一送出實作】ops/patrol 之巡檢推送亦走本檔(此前 patrol 內建一份 fetch:未轉義、單發、失敗靜默),
//   兩份 Telegram 送出實作收成一份;patrol 端保留「無 TELEGRAM_* 即靜默略過、失敗回 false」的附加功能語意。
//
// 【為何要序列化(併發 1)】Telegram Bot API 對同一 chat 有速率限制,併發送出會零星回 429;而任務結束前的數則訊息
//   (結果、警告、失敗通知)常在同一瞬間發出。以佇列逐則送出可避開,代價僅是數百毫秒。
//
// 【為何 !res.ok 必須自行拋出】fetch 不因 4xx／5xx 拋錯(axios 會)。不自行拋出時,發送失敗仍會回傳成功、且不觸發重試——
//   現象是「日誌顯示已發送,但手機上什麼都沒有」,屬最難察覺的靜默失效。
//
// 【為何 enable 採 opt-out】省略即為啟用。若改為 opt-in,漏設就會讓整條管線「執行成功但一則訊息都沒發」,
//   同樣難以察覺;而多發一則訊息的代價遠低於漏發。要乾跑時明確給 enable: false。
//
// 【為何未啟用時回字串而非拋錯】乾跑是正常用途,不是錯誤。回傳可辨識字串讓呼叫端可據以記錄,而不必在每個發送點加分支。
//
// 【escapeHtml 為何是必要而非保險】以 parse_mode:'HTML' 送出的訊息,內文中的 < > & 會被收訊端當成標籤解析。
//   tai-news 實測新聞標題約 0.8% 含這些字元(如「Deepseek 官方 & OpenCode」),未轉義時 Telegram 直接回 400
//   "can't parse entities"——整則訊息發不出去,而不是只有該段顯示異常。& 必須先轉,否則會把後續產生的 &lt; 再轉成 &amp;lt;;
//   只轉三個字元,引號轉了反而會在內文出現字面的 &quot;。

import pmQueue from 'wsemi/src/pmQueue.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import o2j from 'wsemi/src/o2j.mjs'
import cstr from 'wsemi/src/cstr.mjs'

/**
 * 轉義 HTML 保留字元(& < >),供 Telegram parse_mode:'HTML' 送出前使用
 *
 * & 須先轉,否則會把後續產生的 &lt; 再轉成 &amp;lt;;只轉三個字元,引號不轉(轉了反而會在內文出現字面的 &quot;)
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串，其餘轉字串
 * @returns {String} 回傳已轉義之字串
 * @example
 * console.log(escapeHtml('a & b < c > d'))
 * // => a &amp; b &lt; c &gt; d
 *
 * console.log(escapeHtml(null))
 * // =>
 */
export function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Telegram sendMessage 單則文字上限(以 String.length 計,非位元組:tai-news 2026-09-21 實測 2,000 字元／5,946 位元組之中文訊息送達成功)。
 * 超過即回 400 "message is too long"——整則不送,不是截斷送出。呼叫端組訊息時須先限長(截哪裡是訊息模板的政策,本層只擋不截)。
 */
export const TELEGRAM_TEXT_MAX = 4096

/**
 * 建立 Telegram 通知器:序列化佇列(併發 1，避開同 chat 速率限制)＋重試＋4xx/5xx 自行拋出＋逾長 fail-fast
 *
 * fetch 不因 4xx／5xx 拋錯(axios 會),故 !res.ok 必須自行拋出,否則發送失敗仍回傳成功、且不觸發重試——
 * 現象是「日誌顯示已發送,但手機上什麼都沒有」,屬最難察覺的靜默失效。enable 採 opt-out:省略即為啟用,
 * 要乾跑時明確給 enable:false。未啟用時回字串而非拋錯,因乾跑是正常用途,不是錯誤。
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.token 輸入 bot token，必填
 * @param {String} opt.chatId 輸入目標 chat id，必填
 * @param {Boolean} [opt.enable=true] 輸入是否實際送出，false 為乾跑
 * @param {String} [opt.parseMode='HTML'] 輸入訊息解析模式，內文須先經 escapeHtml
 * @param {Integer} [opt.maxRetries=3] 輸入重試次數(不含初次，故最多送出 maxRetries+1 次)
 * @param {Integer} [opt.timeoutMs] 輸入單次 HTTP 逾時毫秒，未給即不設逾時
 * @param {String} [opt.apiBase='https://api.telegram.org'] 輸入 API 基底位址
 * @returns {Object} 回傳 { send:Function, enable:Boolean }；send(msg) 回傳 Promise，未啟用 resolve '未啟用發送訊息'、成功 resolve 'ok'、重試耗盡則 reject
 * @throws {Error} 缺 token 或 chatId 時拋出
 * @example
 * need test in nodejs.
 *
 * let notifier = createTelegramNotifier({ token: 'xxx', chatId: '123' })
 * await notifier.send('hello')
 */
export function createTelegramNotifier(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { token, chatId, enable = true, parseMode = 'HTML', maxRetries = 3, timeoutMs, apiBase = 'https://api.telegram.org' } = opt
    if (!token) throw new Error('createTelegramNotifier 需要 token')
    if (!chatId) throw new Error('createTelegramNotifier 需要 chatId')

    const pmq = pmQueue(1) // 同時處理 1 個

    /**
     * 送出單次請求(不重試);未啟用時直接回覆字串,不發請求
     *
     * @param {*} msg 輸入訊息內容，物件／陣列轉為 JSON 字串，其餘非字串以 cstr 轉換
     * @returns {Promise} 回傳 Promise，resolve 回傳 'ok'
     * @throws {Error} 訊息超過 TELEGRAM_TEXT_MAX(附 noRetry 旗標)或 HTTP 非 2xx 時拋出
     */
    const sendPost = async (msg) => {
        if (!enable) return '未啟用發送訊息'
        // toString:物件與陣列轉為 JSON 字串,其餘非字串以 cstr 轉換
        if (isobj(msg) || isarr(msg)) msg = o2j(msg)
        if (!isestr(msg)) msg = cstr(msg)
        // 長度 fail-fast:超長必然 400,同樣長度重試必再敗(tai-news 曾重試 3 次白耗後才拋)——不發請求、不重試,直接拋出可行動的訊息
        if (msg.length > TELEGRAM_TEXT_MAX) {
            const e = new Error(`訊息 ${msg.length} 字元超過 Telegram 單則上限 ${TELEGRAM_TEXT_MAX}，未送出（呼叫端須先限長）`)
            e.noRetry = true
            throw e
        }
        const res = await fetch(`${apiBase}/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: parseMode }),
            ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        })
        if (!res.ok) {
            const t = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status} ${res.statusText}: ${t}`)
        }
        return 'ok'
    }

    /**
     * 送出並於失敗時重試,確定性錯誤(如超長,e.noRetry)不重試
     *
     * @param {*} msg 輸入訊息內容(同 sendPost)
     * @returns {Promise} 回傳 Promise，resolve 回傳 'ok'，重試耗盡則 reject 最後一次錯誤
     */
    const sendRetry = async (msg) => {
        let r = ''
        let errTemp = null
        for (let i = 0; i <= maxRetries; i++) {
            let b = false
            await sendPost(msg)
                .then((res) => {
                    r = res; errTemp = null; b = true
                })
                .catch((err) => {
                    errTemp = err; b = false
                })
            if (b) break
            if (errTemp?.noRetry) break // 確定性錯誤(如超長)重試無意義
        }
        if (errTemp !== null) return Promise.reject(errTemp)
        return r
    }

    return {
        /**
         * 送出一則訊息(經序列化佇列,同時最多處理 1 則)
         *
         * @param {*} msg 輸入訊息內容(同 sendPost)
         * @returns {Promise} 回傳 Promise，resolve 回傳 'ok' 或 '未啟用發送訊息'，reject 為重試耗盡之錯誤
         */
        send: async (msg) => pmq(sendRetry, msg),
        /** 本通知器是否實際送出(乾跑為 false) */
        get enable() {
            return enable
        },
    }
}

export default { createTelegramNotifier, escapeHtml }
