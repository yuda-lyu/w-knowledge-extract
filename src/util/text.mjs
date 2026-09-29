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
//   注入函數只需「一致」不需「語言學正確」——摺疊結果僅作分群鍵、永不顯示（英文為不動點）。
// 【2.0 起總組裝預設折向簡體（opencc tw→cn）】繁體多字對一簡體（迴／回、裡／里、衝／沖…），折向簡體才收斂字形變體；
//   1.x 之 cn→tw 收斂不了（均值回歸／均值迴歸／均值回归 分 2 鍵，2026-09-29 實測）。代價：少數繁體語意不同之字對同鍵
//   （曆年／歷年、回復／回覆…），以折疊前改名拆開（見下）；兩岸用語（演算法／算法）字元級轉換不收斂，以折疊後別名合併。
// 【別名兩段】renames＝折疊前精確改名（NFKC＋去空白後比對原字形）：可拆開折疊誤合、可把「名稱(743)」類改回基名；
//   aliases＝折疊後同義合併（鍵與值皆經改名、去括號、小寫、折疊）：兩岸用語、同義詞。兩者皆單跳、不遞移。
// 【線索鍵凍結】待探索線索之去重鍵是持久化的（frontier 記錄 id），分群折疊改向會使既有線索全部換鍵；
//   線索鍵另走 normalizeClue：只用 clueFold（總組裝注入 1.x 之折疊），不套改名與別名——與概念分群脫鉤，不加查詢鏈。
let conceptFold = null
let clueFold = null
let renameMap = new Map()
let aliasMap = new Map()

/**
 * 折疊前之比對形：NFKC、去空白(\s 已涵蓋全形空白 U+3000;NFKC 亦將其轉為半形空白)
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串
 * @returns {String} 回傳比對形字串
 */
const preFormOf = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '')

/**
 * 去括號字元、英文小寫、去頭尾空白
 *
 * @param {String} t 輸入折疊前之比對形
 * @returns {String} 回傳待折疊之字串
 */
const stripOf = (t) => t.replace(/[（）()［］[\]「」]/g, '').toLowerCase().trim()

/**
 * 檢查別名對照物件:須為 { 原寫法: 新寫法 } 且兩端皆為非空字串
 *
 * @param {*} map 輸入待檢查之值，undefined／null 視為空對照
 * @param {String} name 輸入設定鍵名稱(錯誤訊息用，如 'vocab.conceptRenames')
 * @returns {Array} 回傳 [原寫法, 新寫法] 陣列
 * @throws {Error} 非物件、或任一端非非空字串時拋出
 * @example
 * console.log(checkNameMap({ '算法': '演算法' }, 'vocab.conceptAliases'))
 * // => [ [ '算法', '演算法' ] ]
 */
export function checkNameMap(map, name) {
    if (map === undefined || map === null) return []
    if (typeof map !== 'object' || Array.isArray(map)) throw new Error(`${name} 須為物件 { 原寫法: 新寫法 }`)
    const out = Object.entries(map)
    for (const [k, v] of out) {
        if (!preFormOf(k) || typeof v !== 'string' || !preFormOf(v)) throw new Error(`${name} 之「${k}」須對應非空字串`)
    }
    return out
}

/**
 * 注入字形折疊函數與別名（如 opencc-js 之 Converter({from:'tw',to:'cn'})）；傳非函數即清除折疊(還原為不折疊)
 *
 * 只給 fn(1.x 用法)時:改名與別名清空、線索折疊同 fn。
 *
 * @param {Function} fn 輸入分群用折疊函數 (t:String) => String，傳非函數視為清除
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}
 * @param {Function} [opt.clueFold] 輸入線索鍵用折疊函數(總組裝注入 1.x 之折疊以凍結線索鍵)，未給此鍵即同 fn，給非函數即不折疊
 * @param {Object} [opt.renames] 輸入折疊前改名對照 { 原寫法: 新寫法 }(vocab.conceptRenames)
 * @param {Object} [opt.aliases] 輸入折疊後別名對照 { 別名: 正名 }(vocab.conceptAliases)
 * @returns {undefined} 無回傳值(設定模組層級變數，供 normalizeConcept／normalizeClue 內部使用)
 * @throws {Error} opt.renames／opt.aliases 不合 checkNameMap 時拋出(模組狀態不變)
 */
export function setConceptFold(fn, opt = {}) {
    if (opt === null || typeof opt !== 'object') opt = {}
    const renames = checkNameMap(opt.renames, 'vocab.conceptRenames')
    const aliases = checkNameMap(opt.aliases, 'vocab.conceptAliases')
    conceptFold = typeof fn === 'function' ? fn : null
    clueFold = Object.prototype.hasOwnProperty.call(opt, 'clueFold') ? (typeof opt.clueFold === 'function' ? opt.clueFold : null) : conceptFold
    renameMap = new Map(renames.map(([k, v]) => [preFormOf(k), preFormOf(v)]))
    aliasMap = new Map()
    const keyOf = (s) => {
        let t = preFormOf(s)
        if (renameMap.has(t)) t = renameMap.get(t)
        t = stripOf(t)
        return conceptFold ? conceptFold(t) : t
    }
    for (const [k, v] of aliases) aliasMap.set(keyOf(k), keyOf(v))
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
    let t = preFormOf(s)
    if (renameMap.has(t)) t = renameMap.get(t)
    t = stripOf(t)
    if (conceptFold) t = conceptFold(t)
    return aliasMap.get(t) ?? t
}

/**
 * 正規化待探索線索值作為去重鍵(持久化鍵;見檔頭【線索鍵凍結】):NFKC、去空白與括號、英文小寫，再套用線索折疊，不套改名與別名
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串
 * @returns {String} 回傳正規化後之線索鍵字串
 * @example
 * console.log(normalizeClue('Transformer 架構'))
 * // => transformer架構
 */
export function normalizeClue(s) {
    const t = stripOf(preFormOf(s))
    return clueFold ? clueFold(t) : t
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

export default { sha1, normalizeConcept, normalizeClue, checkNameMap, setConceptFold, slugify }
