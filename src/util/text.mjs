// text.mjs — 概念正規化、slug 與雜湊（知識庫識別體系的基石）
//
// 【sha1 委派 wsemi str2sha】與 w-data-pipeline 之 keyOf 同一來源；
//   既有知識庫（kns 2k+ 筆 slug）綁定 sha1 尾碼，不可換演算法。

import str2sha from 'wsemi/src/str2sha.mjs'

/**
 * SHA-1 十六進位（空輸入回 ''，fail-safe：合法雜湊會讓無鍵項目共用同一 key）
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串，其餘轉字串後雜湊
 * @returns {String} 回傳 SHA-1 十六進位字串(40 碼)；輸入為空字串時回傳''
 * @example
 * console.log(sha1('hello'))
 * // => aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
 *
 * console.log(sha1(undefined))
 * // =>
 */
export function sha1(s) {
    return str2sha(String(s ?? ''), 1)
}

// ── 概念分群鍵的字形折疊（可注入）──
//
// 【為何需要】NFKC 統一的是全形半形，**不做繁簡轉換**——「注意力機制」與「注意力机制」
//   在 NFKC 下是不同分群鍵。實測後果（kns 2026-08-19）：模型偶爾無視「一律繁體」指示
//   輸出簡體標籤，同一概念分裂成兩群，簡體群過門檻後產出與繁體版重複的核心檔
//   （同一概念繁體版 v47/1044 篇 ⇄ 簡體版 v1/26 篇 兩份並存）。
// 【為何注入而非內建】字形對應表是隨語料成長的資料（opencc 級辭典逾千條目），
//   內建會讓套件揹上重依賴；且「摺疊到哪種字形」是執行端政策。
//   注入函數只需「一致」不需「語言學正確」——摺疊結果僅作分群鍵、永不顯示，
//   故 opencc 之 cn→tw 字元級轉換即足（繁體與英文為不動點）。
let conceptFold = null

/**
 * 注入字形折疊函數（如 opencc-js 之 Converter({from:'cn',to:'tw'})）；傳非函數即清除(還原為不折疊)
 *
 * @param {Function} fn 輸入折疊函數 (t:String) => String，傳非函數視為清除
 * @returns {undefined} 無回傳值(設定模組層級變數 conceptFold，供 normalizeConcept 內部使用)
 */
export function setConceptFold(fn) {
    conceptFold = typeof fn === 'function' ? fn : null
}

/**
 * 正規化概念標籤作為分群鍵。
 * 概念標籤是「跨篇提煉」的唯一分群依據——標籤對不起來，提煉就永遠不會被觸發。
 * 統一全形半形（NFKC）、去空白、英文小寫，再套用注入的字形折疊（見 setConceptFold）。
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串，其餘轉字串後正規化
 * @returns {String} 回傳正規化後之分群鍵字串
 * @example
 * console.log(normalizeConcept('  注意力 機制 '))
 * // => 注意力機制
 *
 * console.log(normalizeConcept('Attention（機制）'))
 * // => attention機制
 */
export function normalizeConcept(s) {
    const t = String(s ?? '')
        .normalize('NFKC')
        .replace(/[\s\u3000]+/g, '')
        .replace(/[（）()［］[\]「」]/g, '')
        .toLowerCase()
        .trim()
    return conceptFold ? conceptFold(t) : t
}

/**
 * 由標題產生檔名 slug：保留中英數，其餘轉連字號，尾綴 8 碼雜湊確保唯一。
 * 尾碼同時是 relate 階段「slug 抄寫容錯」的比對基礎（模型抄長中文 slug 會漏字，
 * 尾碼相符即可解析回真實 slug），故格式不可變更。
 *
 * @param {*} title 輸入標題，null／undefined 視為空字串
 * @param {String} [seed=''] 輸入雜湊種子字串，預設用 title（仍空則用亂數，此時不可重現），確保重覆標題仍可分辨
 * @returns {String} 回傳 slug 字串，格式為 `<保留字元或'note'>-<8碼雜湊>`
 * @example
 * console.log(slugify('Hello World'))
 * // => hello-world-0a4d55a8
 *
 * console.log(slugify('Transformer 注意力機制！！', 'k1'))
 * // => transformer-注意力機制-a2ab1959
 */
export function slugify(title, seed = '') {
    const base = String(title || '')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\p{Script=Han}a-z0-9-]+/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48)
    const suffix = sha1(seed || title || String(Math.random())).slice(0, 8)
    return `${base || 'note'}-${suffix}`
}

export default { sha1, normalizeConcept, slugify }
