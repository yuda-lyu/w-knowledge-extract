// supportStock.mjs — 檢定標準 ES9 之存量覆核:既有有效主張是否仍受其存活出處支持(存量全量逐輪輪替)——純函數:受檢項、內容雜湊、須檢判定、選取
//
// 【受檢】非終態、非失撐(出處未全撤)之主張,有存活出處;隔離(held)者只在其內容雜湊與隔離時不同(文字被修訂、補了出處)或使用者要求重判時再檢。
// 【雜湊】主張之斷言(文字＋條件＋期間)＋證據性質(basis;判準依推論類與否,ES9 v2)＋存活出處 id(排序)＋各出處之內容鍵——任一變即須重檢;
//   只換標準版本(ES9.v)亦重檢(needsCheck)。
// 【檢核紀錄】物件 claim、oid `<核心 id>:<主張 id>`(core/stores/checks)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { sha1, cmp, textValueOf as str } from '../core/capturePackage.mjs'
import { needsCheck } from '../core/relatePackage.mjs'
import { HASH_FIELD_SEP, TERMINAL_SET, liveSourcesOf, unsupportedOf, withdrawnOf } from '../stores/coreState.mjs'
import { ES9, claimAssertion } from './supportCheck.mjs'
import { EXTRACT_HOLD_OBJECTS, itemOidOf } from '../stores/extractHolds.mjs'

/** 檢核紀錄與待判登錄之物件種類(ES9 存量、ES8;oid＝`<核心 id>:<主張 id>`) */
export const CLAIM_OBJECT = EXTRACT_HOLD_OBJECTS.claim


/**
 * 主張之受檢雜湊(ES9 存量)
 *
 * @param {Object} claim 輸入主張
 * @param {Array} live 輸入存活出處 id
 * @param {Function} keyOf 輸入 (筆記 id)=>內容鍵(字串;不可得回 '')
 * @returns {String} 回傳雜湊
 * @example
 * const claim = { text: '甲', basis: '案例' }
 * console.log(stockHashOf(claim, ['n1', 'n2'], () => 'k') === stockHashOf(claim, ['n2', 'n1'], () => 'k'), stockHashOf(claim, ['n1'], () => 'k') === stockHashOf(claim, ['n1'], () => 'k2'))
 * // => true false
 */
export function stockHashOf(claim, live, keyOf) {
    const ids = [...(isarr(live) ? live : [])].sort()
    return sha1([claimAssertion(claim), `basis=${str(claim?.basis)}`, ...ids.map((n) => `${n}=${str(typeof keyOf === 'function' ? keyOf(n) : '')}`)].join(HASH_FIELD_SEP))
}

/**
 * 本核心須(重)檢之主張
 *
 * @param {Object} s 輸入核心狀態
 * @param {Object} o 輸入 { coreId, recOf:(oid)=>檢核紀錄|null, keyOf:(nid)=>內容鍵, retry:Set(使用者要求重判之主張 id) }
 * @returns {Array} 回傳 [{ id, hash, never:Boolean(從未檢), held:Boolean }](依主張序)
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] }).state
 * console.log(stockNeedsOf(s, { coreId: 'c1', recOf: () => null, keyOf: () => 'k', retry: new Set() }).map((x) => x.id))
 * // => [ 'C1' ]
 */
export function stockNeedsOf(s, o = {}) {
    const W = withdrawnOf(s)
    const un = unsupportedOf(s)
    const retry = o.retry instanceof Set ? o.retry : new Set()
    const out = []
    for (const c of s?.claims || []) {
        if (TERMINAL_SET.has(c.status)) continue
        const isHeld = un.held.has(c.id)
        if (un.items.has(c.id) && !isHeld) continue // 出處全撤 → ES8 之範圍
        const live = liveSourcesOf(c, s, W)
        if (!live.length) continue
        const hash = stockHashOf(c, live, o.keyOf)
        const rec = typeof o.recOf === 'function' ? o.recOf(itemOidOf(str(o.coreId), c.id)) : null
        if (isHeld) {
            // 隔離者:內容或出處變了(與隔離時之雜湊不同)、標準改版(檢核紀錄之版本非現版)、或使用者要求重判 → 再檢;否則待使用者
            const stale = isobj(rec?.results?.[ES9.std]) && Number(rec.results[ES9.std].v) !== Number(ES9.v)
            if (retry.has(c.id) || stale || str(s.held?.[c.id]?.hash) !== hash) out.push({ id: c.id, hash, never: false, held: true })
            continue
        }
        if (retry.has(c.id) || needsCheck(rec, { hash, std: ES9.std, v: ES9.v })) out.push({ id: c.id, hash, never: !isobj(rec) || !isobj(rec.results?.[ES9.std]), held: false })
    }
    return out
}

/**
 * 跨核心之選取:從未檢者先、其次重檢(隔離者之重判與一般重檢同級);同級依核心 id、主張序;截至 perRun
 *
 * @param {Array} rows 輸入 [{ cid, id, never, ... }](各核心之 stockNeedsOf 依核心 id 串接)
 * @param {Integer} perRun 輸入本輪上限(主張數)
 * @returns {Array} 回傳選中之列(原物件)
 * @example
 * const rows = [{ cid: 'c2', id: 'C1', never: true }, { cid: 'c1', id: 'C2', never: false }, { cid: 'c1', id: 'C1', never: true }]
 * console.log(pickStock(rows, 2).map((x) => `${x.cid}:${x.id}`))
 * // => [ 'c1:C1', 'c2:C1' ]
 */
export function pickStock(rows, perRun) {
    const n = Number.isInteger(perRun) && perRun > 0 ? perRun : 0
    if (!n) return []
    return (isarr(rows) ? rows : []).map((x, i) => ({ x, i })).sort((a, b) => Number(b.x.never) - Number(a.x.never) || cmp(String(a.x.cid), String(b.x.cid)) || a.i - b.i).slice(0, n).map((y) => y.x)
}

export default { CLAIM_OBJECT, stockHashOf, stockNeedsOf, pickStock }
