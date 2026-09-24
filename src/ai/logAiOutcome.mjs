// logAiOutcome.mjs — 把一次 AI 呼叫的結果寫進日誌:用了哪家、遞補歷程、未納入者、無效 id;以及冷卻事件記錄器
//   (泛用件,自 tai-news 之執行殼移入;消費 ai/caller 之原始結果。本套件批次管線之供應商實績另走 adapter:
//   健康層計數進執行摘要 run.json,drainStats 供呼叫端輪末彙總——本套件 run() 本身不呼叫它)
//
// 【為何「換了一家才成功」非記不可】成功結果不會提示剛才有供應商失效。若不記錄,日誌上只看得到最終成功,
//   事後完全無從察覺某家已經開始不穩,直到它連同備援一起失效、整條管線失敗才被發現。故 tried 內非成功項一律以 WARN 突顯。
//
// 【為何要逐筆記到「哪一把金鑰、什麼類型、失敗多久」】這是日後回推「某模型是撞額度、服務不穩、還是已停供」的唯一依據:
//   額度:同一供應商多把金鑰皆 http／HTTP 429 且皆為亞秒級快速失敗;服務不穩:http／HTTP 5xx 或 timeout,耗時長短不一;
//   模型能力:validation,且耗時接近正常產出時間;設定錯誤:spawn(執行檔不存在／命令列過長)、params。
//   少了 key# 就分不出「單把金鑰用盡」與「整個服務不可用」;少了耗時就分不出「快速失敗」與「空耗一輪逾時」。
//
// 【為何 errorType 與 error 字串兩者都記】只有人讀的 error 字串時,事後統計得靠正則比對措辭——各家 CLI 字樣不同又隨版本
//   漂移,規則必然失準。errorType 是穩定的機器可讀分類,兩者並存:類型供統計、字串供人判讀。
//
// 【為何 token 用量要記】各家額度多以 token 計而非以次數計。reasoning_tokens 另記:它是「思考」消耗的部分,佔用輸出預算
//   卻不產生內容,是截斷類失敗的重要線索。
//
// 【為何 outcome 要譯成人話】曾一律寫「已跳過」,於成功者亦被列入時會與上一行「使用 AI ○○」自相矛盾。
//
// 【一律以成員呼叫形式觸發記錄器】不可寫 (lg.log || lg.info)(...):該寫法把方法自接收者剝離,class-based logger
//   (方法內用 this 者,如 winston/pino 包裝)會於呼叫當下 this 為 undefined 而炸在記錄行,把真正要記的訊息蓋掉。

import isobj from 'wsemi/src/isobj.mjs'
import { oneline } from '../util/misc.mjs'

/** outcome 代碼對人話(套件之 tried[].outcome) */
export const OUTCOME_TEXT = { 'next-key': '換金鑰', 'skip-group': '整組跳過' }

/**
 * 把一次 AI 呼叫的結果寫進日誌:使用哪家、遞補歷程(非成功項)、未納入輪替者、無效 id
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Object} [opt.result] 輸入 dispatchAiFallback 之產出結果物件
 * @param {Object} opt.log 輸入記錄器物件，須具 log／logWarn／logError 或 info／warn／error 成員
 * @param {String} [opt.tag=''] 輸入訊息前綴字串，預設''
 * @returns {undefined} 無回傳值
 * @throws {Error} opt.log 非物件時拋出
 */
export function logAiOutcome(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { result: r, log: lg, tag = '' } = opt
    if (!isobj(lg)) {
        throw new Error('logAiOutcome 需要 log（記錄器）')
    }

    const info = (m) => (lg.log ? lg.log(`${tag}${m}`) : lg.info(`${tag}${m}`))
    const warn = (m) => (lg.logWarn ? lg.logWarn(`${tag}${m}`) : lg.warn(`${tag}${m}`))
    const error = (m) => (lg.logError ? lg.logError(`${tag}${m}`) : lg.error(`${tag}${m}`))

    // 使用哪家
    if (r?.providerId) {
        const k = r.keyIndex != null ? `／key#${r.keyIndex + 1}` : ''
        // token 用量(api 類轉接器才有,CLI 類無此欄)
        const u = r.usage
        let tk = ''
        if (u) {
            const rt = u.completion_tokens_details?.reasoning_tokens
            tk = `，tokens ${u.prompt_tokens ?? '?'}+${u.completion_tokens ?? '?'}` + (rt ? `（含思考 ${rt}）` : '')
        }
        // 截斷放行(呼叫端給 acceptTruncated 時):成功但內容為截斷前段,不標示就與完整成功無從區分
        const tr = r.ok && r.truncated === true ? `；截斷內容放行（finish_reason=${r.finishReason || 'length'}）` : ''
        info(`使用 AI ${r.providerId}${k}（${r.kind}／${r.model}${tk}${tr}）`)
    }

    // 遞補歷程:tried 於成功時亦回傳,故需濾掉最後成功的那筆
    const failed = (r?.tried || []).filter((t) => t.outcome !== 'ok')
    if (failed.length) {
        const detail = failed.map((t) => {
            const k = t.keyIndex != null ? `／key#${t.keyIndex + 1}` : ''
            const ms = t.durationMs != null ? `，${(t.durationMs / 1000).toFixed(1)}s` : ''
            const ty = t.errorType ? `${t.errorType}／` : ''
            const why = oneline(t.reason || t.error || '', 80)
            return `${t.providerId}${k}（${OUTCOME_TEXT[t.outcome] || t.outcome}：${ty}${why}${ms}）`
        }).join('、')
        warn(`AI 遞補歷程 → ${detail}`)
    }

    // 缺金鑰而未納入輪替者
    if (r?.providersSkipped?.length) warn(`AI 供應商未納入 → ${r.providersSkipped.join('、')}`)

    // pick 到目錄裡不存在的 id:屬設定錯誤,須以 ERROR 而非 WARN(見 ai/caller 檔頭)
    if (r?.providersMissing?.length) error(`providerPick 有無效 id → ${r.providersMissing.join('、')}（請對照供應商目錄）`)
}

/**
 * 建立事件回調:把「供應商冷卻」寫進日誌
 *
 * 【為何要單獨記】冷卻會把遭限流／逾時的條目移到鏈尾,這是會改變後續呼叫順序的行為。若不記錄,日後看到
 *   「本輪順序與設定的 pick 不同」會找不到原因。tried 只呈現「這一次」的嘗試歷程,看不出「上一次的失敗已把它降序」。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Object} opt.log 輸入記錄器物件，須具 logWarn 或 warn 成員
 * @param {String} [opt.tag=''] 輸入訊息前綴字串，預設''
 * @returns {Function} 回傳事件回調函數 (ev) => void，可交給 createAiCaller 之 onEvent
 * @throws {Error} opt.log 非物件時拋出
 */
export function createAiEventLogger(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { log: lg, tag = '' } = opt
    if (!isobj(lg)) {
        throw new Error('createAiEventLogger 需要 log（記錄器）')
    }

    const warn = (m) => (lg.logWarn ? lg.logWarn(`${tag}${m}`) : lg.warn(`${tag}${m}`))
    return (ev) => {
        if (ev?.type === 'cooled') {
            const mins = Math.round((ev.cooldownMs || 0) / 60000)
            warn(`AI 供應商進入冷卻 → ${ev.providerId}（${oneline(ev.error || '', 60)}，${mins} 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）`)
        }
    }
}

export default { logAiOutcome, createAiEventLogger, OUTCOME_TEXT }
