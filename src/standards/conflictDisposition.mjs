// conflictDisposition.mjs — 檢定標準 ES5:提煉時呈現之衝突邊(兩端皆可引者;起草提示詞以 R 編號列出),逐邊須有去向
//
// 【以落地狀態之結構判定,不信宣告】起草者於 conflicts 逐條宣告去向(立爭議、併入爭議、contested、supersede、revise、非對立、離題),
//   但「有沒有處置」以套用後之核心狀態判定(純函數,無 AI):
//   ①爭議:有一則未撤回之爭議,兩端分屬不同之方(方之篇集＝本方出處 ∪ 所引主張之出處)——立爭議、併入爭議、contest 皆落在此;
//   ②取代:被取代之主張以一端為出處、取代它之主張以另一端為出處;
//   ③加條件之修正:本版被修改之有效主張同時以兩端為出處且有條件(兩篇在條件下可同時成立);
//   ④離題:一端於本批被列為離題。
//   以上皆無而有宣告「非對立」(附理由)者 → 非對立(交關聯段兩席核對 RS4);皆無 → 未處置(不入 seenConflicts,下次再呈現;逾次交 RS4)。
// 【只對兩端皆可引者】一端非本批亦非核心已引之衝突,無從當出處——只供參考,不要求去向。
// 【入已見之後的回頭檢查】入已見(seenConflicts)當下有去向,不保證日後仍有:處置結構可被日後之操作拿掉(依衝突所立之爭議被拆解、被取代之主張或加條件
//   之修正所依之主張被撤回…),邊卻留在已見——既不再呈現、也未交 RS4 核對。符合度掃描(es5RowsOf)只報、存量處置(coreStockFix)須人工觸發,
//   故管線每輪維護以同一判定回頭檢查(es5ReopenOf):無處置結構且未交 RS4 核對者自已見移出,由重審項之新衝突重新呈現,收尾走原有機制(起草處置、
//   宣告非對立交 RS4、逾次交 RS4)。

import { OFFTOPIC_REASON, TERMINAL_SET, withdrawnOf } from '../stores/coreState.mjs'
import { textValueOf as str } from '../core/capturePackage.mjs'

// 陣列之文字值(非陣列者為空——與抓取 textListOf 之差:單值不收;判定只認狀態之陣列欄)
const arrayTexts = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

/** 起草者可宣告之去向 */
export const CONFLICT_DISPOSITIONS = ['立爭議', '併入爭議', 'contested', 'supersede', 'revise', '非對立', '離題']

/**
 * 宣告之正規化:{ edge(R 編號), disposition(在清單內), reason };不合者丟棄
 *
 * @param {*} list 輸入起草輸出之 conflicts
 * @returns {Array} 回傳 [{ edge, disposition, reason }]
 * @example
 * console.log(normalizeConflictDecl([{ edge: 'R1', disposition: '立爭議', reason: '兩篇結論相反' }, { edge: 'R2', disposition: '不存在之去向', reason: 'x' }]))
 * // => [ { edge: 'R1', disposition: '立爭議', reason: '兩篇結論相反' } ]
 */
export function normalizeConflictDecl(list) {
    return (Array.isArray(list) ? list : [])
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({ edge: str(x.edge).toUpperCase(), disposition: str(x.disposition), reason: str(x.reason).slice(0, 300) }))
        .filter((x) => /^R\d+$/.test(x.edge) && CONFLICT_DISPOSITIONS.includes(x.disposition))
}

/**
 * 一條衝突邊於落地狀態之去向(結構判定)
 *
 * @param {Object} s 輸入套用後之核心狀態
 * @param {Array} ends 輸入邊之兩端筆記 id [a, b]
 * @param {Object} [o={}] 輸入 { offtopic:Set(本批列為離題之筆記 id), version:Integer(本版號;③ 之「本版被修改」),
 *   anyVersion:Boolean(存量掃描:③ 不限本版——曾以兩端為出處加條件修正者皆算) }
 * @returns {String} 回傳 'dispute'|'supersede'|'revise'|'offtopic'|''(未見處置)
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { text: '乙', sources: ['n2'] }], disputes: [{ question: '丙', sides: [{ position: '一方', claims: ['C1'], sources: ['n1'] }, { position: '他方', claims: ['C2'], sources: ['n2'] }] }] }).state
 * console.log(conflictDisposedOf(s, ['n1', 'n2'], { version: 1 }))
 * // => dispute
 */
export function conflictDisposedOf(s, ends, o = {}) {
    const [a, b] = Array.isArray(ends) ? ends.map(str) : []
    if (!a || !b) return ''
    const claims = Array.isArray(s?.claims) ? s.claims : []
    const byId = new Map(claims.map((c) => [c.id, c]))
    const has = (x, id) => arrayTexts(x?.sources).includes(id)
    // ①爭議:兩端分屬不同之方
    for (const d of Array.isArray(s?.disputes) ? s.disputes : []) {
        if (d.status === 'retracted') continue
        const docs = (d.sides || []).map((sd) => new Set([...arrayTexts(sd?.sources), ...arrayTexts(sd?.claims).flatMap((cid) => arrayTexts(byId.get(cid)?.sources))]))
        for (let i = 0; i < docs.length; i++) for (let j = 0; j < docs.length; j++) if (i !== j && docs[i].has(a) && docs[j].has(b)) return 'dispute'
    }
    // ②取代
    for (const c of claims) {
        if (c.status !== 'superseded' || !c.supersededBy) continue
        const by = byId.get(c.supersededBy)
        if ((has(c, a) && has(by, b)) || (has(c, b) && has(by, a))) return 'supersede'
    }
    // ③加條件之修正(本版被修改、同時以兩端為出處、有條件)
    const version = Number(o.version)
    for (const c of claims) {
        if (TERMINAL_SET.has(c.status) || !has(c, a) || !has(c, b) || !arrayTexts(c.conditions).length) continue
        if (o.anyVersion === true || (c.history || []).some((h) => Number(h?.version) === version)) return 'revise'
    }
    // ④離題
    const off = o.offtopic instanceof Set ? o.offtopic : new Set()
    if (off.has(a) || off.has(b)) return 'offtopic'
    return ''
}

/**
 * 檢定標準 ES5 之逐邊判定(符合度掃描與存量處置同一份):已見之衝突(seenConflicts)中兩端皆為已消化存活筆記者,判其去向——
 *   有處置結構(conflictDisposedOf,不限版)或已交 RS4 核對;皆無即未處置(how 為 '')。conflictEndsOf 未給 → 不判(回空)
 *
 * @param {Object} s 輸入核心狀態
 * @param {Object} ctx 輸入 { conflictEndsOf:(邊 id)=>[a, b]|null, rs4HeldOf?:(邊 id)=>Boolean }
 * @returns {Array} 回傳 [{ eid, ends, how:'dispute'|'supersede'|'revise'|'offtopic'|'rs4'|'' }](只列兩端皆可引者)
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }], consumed: ['n1'] }).state
 * console.log(es5RowsOf(s, { conflictEndsOf: () => null }))
 * // => []
 */
export function es5RowsOf(s, ctx = {}) {
    if (typeof ctx?.conflictEndsOf !== 'function') return []
    const W = withdrawnOf(s)
    const citable = new Set((s?.consumed || []).map(str).filter((id) => id && !W.has(id)))
    const offtopic = new Set((s?.skipped || []).filter((x) => x?.reason === OFFTOPIC_REASON).map((x) => str(x.note)).filter(Boolean))
    const rows = []
    for (const eid of Array.isArray(s?.seenConflicts) ? s.seenConflicts : []) {
        const ends = ctx.conflictEndsOf(eid)
        if (!Array.isArray(ends) || ends.length !== 2 || !ends.every((n) => citable.has(n))) continue
        const how = conflictDisposedOf(s, ends, { offtopic, anyVersion: true }) || (typeof ctx.rs4HeldOf === 'function' && ctx.rs4HeldOf(eid) ? 'rs4' : '')
        rows.push({ eid, ends, how })
    }
    return rows
}

/**
 * 檢定標準 ES5 之回頭檢查(維護段;無 AI):已見之衝突中,兩端皆為已消化存活筆記、無處置結構(conflictDisposedOf,不限版)且未交 RS4 核對者——
 *   入已見後處置結構被拿掉而邊仍留在已見,須自已見移出(記帳欄位,不升版)、下輪重新呈現。判定與符合度掃描、存量處置同一份(es5RowsOf),
 *   只取其中「未處置」者。已交 RS4 核對之邊集(rs4Held)不是 Set(待判集合不可用)→ 無從分辨已交核對者,不處置(同符合度掃描之未能判定)
 *
 * @param {Object} s 輸入核心狀態
 * @param {Object} ctx 輸入 { conflictEndsOf:(邊 id)=>[a, b]|null, rs4Held:Set|null(已交 RS4 核對之邊 id,任一狀態) }
 * @returns {Array} 回傳 [{ eid, ends }](須自已見移出者;只列兩端皆可引者)
 * @example
 * const s = { ...coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { text: '乙', sources: ['n2'] }], consumed: ['n1', 'n2'] }).state, seenConflicts: ['e1'] }
 * const conflictEndsOf = (eid) => ({ e1: ['n1', 'n2'] })[eid] || null
 * console.log(es5ReopenOf(s, { conflictEndsOf, rs4Held: new Set() }), es5ReopenOf(s, { conflictEndsOf, rs4Held: new Set(['e1']) }), es5ReopenOf(s, { conflictEndsOf, rs4Held: null }))
 * // => [ { eid: 'e1', ends: [ 'n1', 'n2' ] } ] [] []
 */
export function es5ReopenOf(s, ctx = {}) {
    if (!(ctx?.rs4Held instanceof Set)) return []
    return es5RowsOf(s, { conflictEndsOf: ctx.conflictEndsOf, rs4HeldOf: (eid) => ctx.rs4Held.has(eid) }).filter((x) => !x.how).map(({ eid, ends }) => ({ eid, ends }))
}

export default { CONFLICT_DISPOSITIONS, normalizeConflictDecl, conflictDisposedOf, es5RowsOf, es5ReopenOf }
