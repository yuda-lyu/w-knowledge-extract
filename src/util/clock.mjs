// clock.mjs — 顯式時區錨定的時間工具(兩套方法名並列於同一物件)
//
// 【為何不用系統時區】排程 session 的系統時區可能為 UTC+0，靠系統時區會讓日誌、
//   檔名與「當日」判定錯 8 小時。wsemi 的 now2str 系列隨系統時區飄移（實測），
//   故以 dayjs timezone plugin 顯式錨定；時區由 createClock(timeZone) 注入，
//   套件不寫死 Asia/Taipei——這是執行端設定。
//
// 【為何兩套方法名並列而非擇一】本套件各段以 iso8／stamp8／date8／day8 呼叫;自 tai-news 移入的執行殼件
//   (ops/runTask、ops/logger 之 createRunLogger、其消費端)以 getISO／getNow／getDay／getDate／formatTime／getTimestamp
//   呼叫。同一工廠回同一物件,兩邊零改動、不會再各持一份時鐘。createTime 為 createClock 之別名,沿用其原契約
//   (timeZone 省略時預設 Asia/Taipei);本套件內部一律用 createClock(必填,設定錯誤於啟動期爆)。

import ot from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import isestr from 'wsemi/src/isestr.mjs'

ot.extend(utc)
ot.extend(timezone)

/**
 * 建立顯式時區錨定的時鐘工具;同一時區注入後,套件內各處算出之「今天」與「時間戳」不因執行環境系統時區而漂移(見檔頭【為何不用系統時區】)
 *
 * 回傳物件同時提供兩套方法名(見檔頭【為何兩套方法名並列而非擇一】):iso8／stamp8／date8／day8 供本套件內部使用,
 * getISO／getNow／getDay／getDate／formatTime／getTimestamp 供自 tai-news 移入之執行殼呼叫,兩者本質為同一物件。
 *
 * @param {String} timeZone 輸入 IANA 時區字串(如 'Asia/Taipei')，必填
 * @returns {Object} 回傳時鐘物件，含:
 *   - {String} timeZone 原樣回傳輸入之時區字串
 *   - {Function} iso8() 回傳含時區偏移之 ISO 字串，如 2026-08-18T12:00:00+08:00(日誌用)
 *   - {Function} stamp8() 回傳緊湊時間戳，如 20260818120000(檔名／runId 用)
 *   - {Function} date8() 回傳日期字串，如 2026-08-18
 *   - {Function} day8() 回傳緊湊日期字串，如 20260818
 *   - {Function} getISO() 同 iso8()(執行殼命名)
 *   - {Function} getNow() 同 stamp8()(執行殼命名)
 *   - {Function} getDay([s=stamp8()]) 回傳日期分檔用之 8 碼字串(對輸入字串純切片前 8 碼,不重新解析,避免時區歧義)
 *   - {Function} getDate([offsetDay=0]) 回傳可讀日期 2026-08-08，offsetDay 可取昨日(-1)或明日(1)
 *   - {Function} formatTime(s) 將 getNow() 格式之字串轉為可讀顯示 2026/08/08 21:44
 *   - {Function} getTimestamp() 回傳可讀時間戳 2026-08-08 21:44:08(供資料欄位記錄用)
 * @throws {Error} timeZone 非有效字串時拋出
 * @example
 * const clock = createClock('Asia/Taipei')
 * console.log(clock.timeZone, clock.getDay('20260818120000'), clock.formatTime('20260818214408'))
 * // => Asia/Taipei 20260818 2026/08/18 21:44
 */
export function createClock(timeZone) {

    //check
    if (!isestr(timeZone)) {
        throw new Error('createClock 需要 IANA 時區字串（如 Asia/Taipei）')
    }

    const now = () => ot().tz(timeZone)
    /** 2026-08-18T12:00:00+08:00（日誌用） */
    const iso8 = () => now().format('YYYY-MM-DDTHH:mm:ssZ')
    /** 20260818120000（檔名／runId 用） */
    const stamp8 = () => now().format('YYYYMMDDHHmmss')
    /** 2026-08-18 */
    const date8 = () => now().format('YYYY-MM-DD')
    /** 20260818 */
    const day8 = () => now().format('YYYYMMDD')
    return {
        timeZone,
        iso8,
        stamp8,
        date8,
        day8,
        // ── 執行殼命名(同義,見檔頭)──
        getISO: iso8,
        getNow: stamp8,
        /** 日期分檔用 20260808;輸入為 getNow() 格式時純字串切片(避免重新解析而有時區歧義) */
        getDay: (s = stamp8()) => String(s).slice(0, 8),
        /** 可讀日期 2026-08-08,offsetDay 可取昨日(-1)或明日(1) */
        getDate: (offsetDay = 0) => now().add(offsetDay, 'day').format('YYYY-MM-DD'),
        /** 訊息顯示用 2026/08/08 21:44(輸入為 getNow() 格式) */
        formatTime: (s) => {
            s = String(s)
            return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`
        },
        /** 可讀時間戳 2026-08-08 21:44:08(供資料欄位記錄用) */
        getTimestamp: () => now().format('YYYY-MM-DD HH:mm:ss'),
    }
}

/**
 * 執行殼別名:同 createClock,但 timeZone 省略時預設 'Asia/Taipei'(沿用 tai-news createTime 契約)
 *
 * @param {String} [timeZone='Asia/Taipei'] 輸入 IANA 時區字串
 * @returns {Object} 回傳同 createClock 之時鐘物件
 * @throws {Error} timeZone 非有效字串時拋出(來自 createClock)
 * @example
 * console.log(createTime().timeZone)
 * // => Asia/Taipei
 */
export function createTime(timeZone = 'Asia/Taipei') {
    return createClock(timeZone)
}

export default createClock
