// noteFacts.mjs — 筆記之提煉面之事實(單一判定):已納入提煉、重設內容基準之需要、檢定標準之出處材料
//
// 【為何獨立成檔】「已納入提煉」(筆記記錄之 extractedAt;摘要套件之資料契約欄)、「已消化而內容或標題變 → 重設內容基準」、
//   「ES2／ES16 之材料＝內容章＋原文標題＋發布時間」各被提煉段、符合度掃描、存量處置與執行端之工具讀;各寫一份即漂移。
//   「已納入提煉」＝抓取套件之 noteConsumedOf(下游筆記欄位之單一宣告;四套件同讀),本檔以提煉之用語轉出。

import { readMd, noteMaterialText, publishedOf } from '../core/summarizePackage.mjs'
import { noteConsumedOf, NOTE_FIELDS } from '../core/capturePackage.mjs'

/**
 * 筆記是否已納入提煉(曾被任一核心消化;抓取套件之 noteConsumedOf——記錄之 extractedAt 非空)
 *
 * @param {Object} note 輸入筆記記錄
 * @returns {Boolean} 回傳是否已納入
 * @example
 * console.log([isExtracted({ extractedAt: '2026-10-01T00:00:00+08:00' }), isExtracted({ extractedAt: '' }), isExtracted(null)])
 * // => [ true, false, false ]
 */
export function isExtracted(note) {
    return noteConsumedOf(note)
}

/**
 * 筆記標題之讀取函數(覆核與重審之提示詞以標題標示筆記;單一規則):以筆記 id 取記錄之標題,無標題或不在記錄者回 id
 *
 * @param {Map} [notesById] 輸入筆記記錄(筆記 id → 記錄);未給即一律回 id
 * @returns {Function} 回傳 (筆記 id) => 標題或 id
 * @example
 * let titleOf = noteTitleFnOf(new Map([['n1', { title: '動量' }], ['n2', {}]]))
 * console.log(titleOf('n1'), titleOf('n2'), titleOf('n3'))
 * // => 動量 n2 n3
 */
export function noteTitleFnOf(notesById) {
    return (nid) => notesById?.get?.(nid)?.title || nid
}

/**
 * 標記筆記已納入提煉(寫筆記記錄之 extractedAt——欄名取抓取套件之 NOTE_FIELDS,與 isExtracted 之讀同一欄;提煉段與投影寫入器之落盤同讀):
 *   ids 中記錄在、尚未標記者逐篇寫入集合(patch)並同步記憶體之記錄
 *
 * @param {Object} notes 輸入筆記集合(具 patch)
 * @param {Map} notesById 輸入記憶體中之筆記記錄(筆記 id → 記錄;就地更新)
 * @param {Array} ids 輸入筆記 id(核心狀態之 consumed)
 * @param {String} at 輸入時刻
 * @returns {Promise} 回傳 Promise,resolve 無回傳值
 * @example
 * need test in nodejs.
 *
 * await markExtracted(stores.notes, notesById, ['n-a', 'n-b'], '2026-09-01T00:00:00+08:00')
 */
export async function markExtracted(notes, notesById, ids, at) {
    for (const nid of ids) {
        const n = notesById.get(nid)
        if (n && !isExtracted(n)) {
            await notes.patch(nid, { [NOTE_FIELDS.extractedAt]: at })
            n[NOTE_FIELDS.extractedAt] = at
        }
    }
}

/**
 * 重設內容基準之判準,以「已納入提煉」之事實判(只持有該事實、不持有筆記記錄之呼叫端用之——如存量處置之宿主持有摘要套件回報之 consumed):
 *   已納入,且內容或標題有變
 *
 * @param {Boolean} consumed 輸入筆記是否已納入提煉(嚴格 true 才算)
 * @param {Object} change 輸入變更之旗標 { contentChanged?:Boolean, titleChanged?:Boolean }
 * @returns {Boolean} 回傳是否須重設基準
 * @example
 * console.log([consumedNeedsRebaseline(true, { titleChanged: true }), consumedNeedsRebaseline(false, { contentChanged: true })])
 * // => [ true, false ]
 */
export function consumedNeedsRebaseline(consumed, change) {
    return consumed === true && (change?.contentChanged === true || change?.titleChanged === true)
}

/**
 * 筆記之變更是否須重設提煉之內容基準:已納入提煉,且內容或標題有變(變更之旗標由摘要套件之還原閘與存量處置給出)——
 *   不重設則下輪提煉段之維護把格式性之改寫當成內容變更而排重審
 *
 * @param {Object} note 輸入筆記記錄(取 extractedAt)
 * @param {Object} change 輸入變更之旗標 { contentChanged?:Boolean, titleChanged?:Boolean }
 * @returns {Boolean} 回傳是否須重設基準
 * @example
 * console.log([needsRebaseline({ extractedAt: 'T' }, { titleChanged: true }), needsRebaseline({ extractedAt: '' }, { contentChanged: true })])
 * // => [ true, false ]
 */
export function needsRebaseline(note, change) {
    return consumedNeedsRebaseline(isExtracted(note), change)
}

/**
 * 檢定標準 ES2／ES16 之出處材料:內容章＋原文標題＋發布時間(不含投影章——投影章由邊庫產生,不是該筆記之內容)
 *
 * @param {Object} note 輸入筆記記錄(md 未給時讀其 file)
 * @param {Object|null} [md] 輸入 readMd 之產物(已讀者傳入免重讀;null＝讀不到)
 * @returns {String|null} 回傳材料文字;md 讀不到回 null(未能判定)
 * @example
 * need test in nodejs.
 *
 * const material = extractMaterialOf(note)
 */
export function extractMaterialOf(note, md) {
    const m = md === undefined ? readMd(note?.file) : md
    return m ? `${noteMaterialText(m.body)}\n${publishedOf(m.body)}` : null
}

export default { isExtracted, markExtracted, noteTitleFnOf, consumedNeedsRebaseline, needsRebaseline, extractMaterialOf }
