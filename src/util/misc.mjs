// misc.mjs — 顯示與 JSON 檔小工具(泛用件,原樣自執行端抽提;oneline／cliFailDetail／firstLineClamp 亦為執行殼層共用件)

import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import fsReadJson from 'wsemi/src/fsReadJson.mjs'
import fsWriteJson from 'wsemi/src/fsWriteJson.mjs'


/**
 * 壓成單行、限長,供日誌顯示
 *
 * 【壓平空白才是本函數存在的理由,截斷是次要的】解析錯誤、CLI stderr、模型回覆常含換行,直接寫進日誌會讓單筆記錄散成多行,
 *   破壞逐行 grep 與事後統計腳本的解析。
 * 【截斷委派 wsemi strTruncate】超長才補刪節號(回傳長度為 n＋3)、未超長原樣回傳——讀日誌時才分得出「訊息就這麼短」與
 *   「被切掉了」。與 w-data-pipeline 之 oneline 同一行為(2026-09-21 統一;此前本檔為純 slice,與自家套件不一致)。
 *   ops/patrol 之解析只取數字與關鍵字、不依賴行尾,不受影響。
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串，其餘轉字串
 * @param {Integer} [n=200] 輸入保留長度非負整數(不含刪節號)，非有效值則不截斷
 * @returns {String} 回傳單行字串
 * @example
 * console.log(oneline('a\n  b\tc'))
 * // => a b c
 *
 * console.log(oneline('x'.repeat(10), 3))
 * // => xxx...
 */
export function oneline(s, n = 200) {
    return strTruncate(String(s ?? '').replace(/\s+/g, ' ').trim(), n)
}


/**
 * 格式化外部 CLI／API 失敗詳情(嘗試次數＋stderr 摘要),供日誌與通知訊息串接於尾端;無資訊時回空字串
 *
 * 【為何不能只寫「失敗」】只回「Exit code 1」無法定位問題——殷鑑:某次失敗實為腳本檔缺失(ENOENT),但日誌只留下離開碼,
 *   需人工重跑才查得出來。帶上「共試幾次」可分辨「一次就死」與「重試耗盡」;帶上 stderr 前段才看得到真因。
 * 【為何取前段而非末行】末行常是堆疊尾巴或進度訊息,真正的失敗原因多在前面。
 *
 * @param {Object} result 輸入執行結果物件(如 wsemi execCli 之結果)，取 attempts 與 stderr，非物件視為無資訊
 * @param {Integer} [n=300] 輸入 stderr 保留長度非負整數，預設300
 * @returns {String} 回傳失敗詳情字串，無資訊時為空字串
 * @example
 * console.log(cliFailDetail({ attempts: 3, stderr: 'boom\nat x' }))
 * // => ，共試 3 次 → boom at x
 *
 * console.log(cliFailDetail({}))
 * // =>
 */
export function cliFailDetail(result, n = 300) {
    const attempts = result?.attempts != null ? `，共試 ${result.attempts} 次` : ''
    const stderr = oneline(result?.stderr, n)
    return `${attempts}${stderr ? ` → ${stderr}` : ''}`
}


/**
 * 取第一行並限長(超長截斷補刪節號;回傳長度嚴格不超過 max,呼叫端據此排版才不會溢出)
 *
 * 【為何只取第一行】來源資料(RSS 標題、抓回的網頁標題)常夾帶換行與副標,直接用於訊息或日誌會撐開版面;
 *   多行內容在 Telegram 之類的單行標題位置會被折行而破壞編號對齊。
 * 【max 小於 4 時不補刪節號】刪節號佔 3 字,max≤3 時補上即超長,改為純截斷以守住長度上限(2026-09-23 修)
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串
 * @param {Integer} [max=100] 輸入最大長度非負整數(含刪節號)，非有效值則使用預設100
 * @returns {String} 回傳第一行字串，長度不超過 max
 * @example
 * console.log(firstLineClamp('標題\n副標', 100))
 * // => 標題
 *
 * console.log(firstLineClamp('abcdefghij', 6))
 * // => abc...
 *
 * console.log(firstLineClamp('abcdefghij', 2))
 * // => ab
 */
export function firstLineClamp(s, max = 100) {

    //check
    if (!isp0int(max)) {
        max = 100
    }
    max = cint(max)

    const firstLine = String(s ?? '').split(/[\r\n]/)[0].trim()
    if (firstLine.length <= max) return firstLine
    return max > 3 ? firstLine.slice(0, max - 3) + '...' : firstLine.slice(0, max)
}


/**
 * 讀 JSON 檔;讀不到或非法 JSON 回 fallback(委派 wsemi,把 {success}/{error} 信封轉回 fallback 語意)
 *
 * @param {String} file 輸入 JSON 檔案路徑字串
 * @param {*} [fallback=null] 輸入讀取失敗時之回傳值，預設null
 * @returns {*} 回傳解析後之物件或陣列，失敗時回傳 fallback
 * @example
 * need test in nodejs.
 *
 * console.log(readJson('./not-exist.json', { a: 1 }))
 * // => { a: 1 }
 */
export function readJson(file, fallback = null) {

    //check
    if (!isestr(file)) {
        return fallback
    }

    const r = fsReadJson(file)
    return r?.error !== undefined ? fallback : r.success
}


/**
 * 寫 JSON 檔(2 空格縮排、自動建父目錄);失敗拋錯——狀態檔靜默寫失敗＝追蹤靜默丟失
 *
 * @param {String} file 輸入 JSON 檔案路徑字串
 * @param {*} data 輸入欲寫入之資料
 * @throws {Error} file 非有效字串或寫入失敗時拋出
 * @example
 * need test in nodejs.
 *
 * writeJson('./tmp/state.json', { a: 1 })
 */
export function writeJson(file, data) {

    //check
    if (!isestr(file)) {
        throw new Error('writeJson 需要 file（檔案路徑字串）')
    }

    const r = fsWriteJson(file, data, { useFormat: true })
    if (r?.error !== undefined) throw new Error(`writeJson(${file}) 失敗:${r.error?.message || r.error}`)
}


/**
 * 佇列積壓摘要:筆數與最舊者天數(供各段日誌與巡檢;積壓只告警不丟——知識庫沒有時間型丟棄)
 *
 * 無任何可解析日期時 oldestDays 為 null(顯示 '-'),不回 0——0 是「全新」,null 是「無資料」,
 * 混為一談會讓巡檢的天數判準在舊資料無該欄時永遠測到 0(2026-09-12 複審 A8)
 *
 * @param {Array} rows 輸入記錄陣列，非陣列視為空陣列
 * @param {String} [field='collectedAt'] 輸入日期欄位名稱字串，預設'collectedAt'
 * @param {Number} [now=Date.now()] 輸入現在時刻毫秒數(測試注入用)，預設Date.now()
 * @returns {Object} 回傳 { count, oldestDays }，oldestDays 為最舊者距今天數(無可解析日期時為 null)
 * @example
 * let now = Date.parse('2026-09-10T00:00:00Z')
 * console.log(queueAge([{ collectedAt: '2026-09-01T00:00:00Z' }, { collectedAt: '' }], 'collectedAt', now))
 * // => { count: 2, oldestDays: 9 }
 */
export function queueAge(rows, field = 'collectedAt', now = Date.now()) {

    //check
    if (!isarr(rows)) {
        rows = []
    }
    if (!isestr(field)) {
        field = 'collectedAt'
    }
    if (!Number.isFinite(now)) {
        now = Date.now()
    }

    let oldest = Infinity
    for (const r of rows) {
        const t = Date.parse(r?.[field] || ''); if (Number.isFinite(t) && t < oldest) oldest = t
    }
    const oldestDays = Number.isFinite(oldest) ? Math.max(0, Math.floor((now - oldest) / 86400_000)) : null
    return { count: rows.length, oldestDays }
}


export default { oneline, cliFailDetail, firstLineClamp, readJson, writeJson, queueAge }
