// recheck.mjs — 重審項之判定(純函數;standards 層):每批開工前以當下狀態重算,不存帳
//
// 【重審項】changed＝被有效條目引用之存活出處,其現內容鍵 ≠ 消化時之 seen(同版本);
//   conflict＝衝突型邊觸及被引用之存活出處、其 id 不在 seenConflicts(集合成員判定,不比時間——含 40 列截斷而未呈現者);
//   conflictGone＝關聯段重評撤銷或降級了本核心見過之衝突邊、且有未決爭議以其端點為出處(帳驅動,conflictGoneOf);
//   relationChanged／conflictReason／partner＝關聯變更之影響(檢定標準 ES10;處置於維護時由 standards/relationImpact 寫入狀態,此處依當下狀態篩選);
//   resend＝逾限筆記之重送(檢定標準 ES15)。
// 【到期】立即到期之理由(URGENT_RECHECK_REASONS)不等湊批;湊批之理由(新判衝突、新關聯之夥伴)篇數達門檻或最舊者逾等待天數才到期。
// 【理由之值只此一份】七值之窮舉在 RECHECK_REASONS(具名鍵);立即到期／湊批／關聯影響之分組、重審項之判定、選篇之序、提煉段之處置與統計、
//   起草與終審提示詞之重審段一律取之,不寫字面。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { cmp, textValueOf as str } from '../core/capturePackage.mjs'
import { citedNotesOf, withdrawnOf } from '../stores/coreState.mjs'

/**
 * 重審理由(具名鍵;值即重審項之 reason,亦為狀態 impactRecheck 之已持久化之值——不可改):changed 內容已更新、conflict 新判衝突、
 *   conflictGone 衝突已撤銷、relationChanged 關聯已變更、conflictReason 衝突理由已更新、resend 重送(逾限筆記,ES15)、partner 新關聯之夥伴(ES10)
 *
 * @type {Object}
 */
export const RECHECK_REASONS = Object.freeze({
    changed: 'changed',
    conflict: 'conflict',
    conflictGone: 'conflictGone',
    relationChanged: 'relationChanged',
    conflictReason: 'conflictReason',
    resend: 'resend',
    partner: 'partner',
})


/**
 * 衝突已不成立(關聯段重評之撤銷／降級;帳驅動,事件為關聯套件之衝突事件帳 readConflictEvents,經 core/relatePackage):
 *   事件之邊本核心見過(seenConflicts)、當下邊庫中它已非衝突,且有未決爭議之某方以任一端為出處 → 重審項 conflictGone(入批＝被重評之
 *   筆記,錨點＝另一端);見過而無未決爭議涉及者 → orphans(只需自 seenConflicts 移出,日後再成為衝突即為新衝突)。
 *   不以「seenConflicts 減現行衝突邊」推定(conflictType 改名、刪除、prune 都會讀不到)
 *
 * @param {Object} s 輸入狀態
 * @param {Object} o 輸入 { conflictEvents:Array, conflictIds:Set(當下衝突邊 id), notesById:Map, keyOf:(nid)=>雜湊|null }
 * @returns {Object} 回傳 { items:[{ id, reason:'conflictGone', anchor, edgeId, at, kind, newType, why }], orphans:Array(邊 id) }
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }], consumed: ['n1'] }).state
 * console.log(conflictGoneOf(s, { conflictEvents: [], conflictIds: new Set(), notesById: new Map(), keyOf: () => 'k' }))
 * // => { items: [], orphans: [] }
 */
export function conflictGoneOf(s, o = {}) {
    const out = { items: [], orphans: [] }
    const events = isarr(o.conflictEvents) ? o.conflictEvents : []
    if (!events.length) return out
    const seenC = new Set(isarr(s?.seenConflicts) ? s.seenConflicts : [])
    const cur = o.conflictIds instanceof Set ? o.conflictIds : new Set()
    const notesById = o.notesById instanceof Map ? o.notesById : new Map()
    const keyOf = typeof o.keyOf === 'function' ? o.keyOf : () => ''
    const W = withdrawnOf(s)
    const claimSrc = new Map((s?.claims || []).map((c) => [c.id, isarr(c.sources) ? c.sources : []]))
    const disputed = new Set()
    for (const d of s?.disputes || []) {
        if (d.status !== 'open') continue
        for (const sd of d.sides || []) {
            for (const x of isarr(sd.sources) ? sd.sources : []) disputed.add(x)
            for (const c of isarr(sd.claims) ? sd.claims : []) for (const x of claimSrc.get(c) || []) disputed.add(x)
        }
    }
    const latest = new Map()
    for (const e of events) if (!latest.has(e.edgeId) || str(e.at) >= str(latest.get(e.edgeId).at)) latest.set(e.edgeId, e)
    for (const e of latest.values()) {
        if (!seenC.has(e.edgeId) || cur.has(e.edgeId)) continue
        if (!disputed.has(e.from) && !disputed.has(e.to)) {
            out.orphans.push(e.edgeId)
            continue
        }
        const id = [e.note, e.from, e.to].find((x) => x && (x === e.from || x === e.to) && notesById.has(x) && !W.has(x) && keyOf(x) !== null)
        if (!id) continue
        out.items.push({ id, reason: RECHECK_REASONS.conflictGone, anchor: id === e.from ? e.to : e.from, edgeId: e.edgeId, at: str(e.at), kind: e.kind, newType: str(e.newType), why: str(e.reason) })
    }
    return out
}

/** 立即到期之重審理由(不等湊批):內容已變、衝突已撤銷、關聯已變更、衝突理由已更新、重送 */
export const URGENT_RECHECK_REASONS = Object.freeze([RECHECK_REASONS.changed, RECHECK_REASONS.conflictGone, RECHECK_REASONS.relationChanged, RECHECK_REASONS.conflictReason, RECHECK_REASONS.resend])

/** 湊批之重審理由(篇數達門檻或最舊者逾等待天數才到期):新判衝突、新關聯之夥伴 */
const BATCHED_RECHECK_REASONS = new Set([RECHECK_REASONS.conflict, RECHECK_REASONS.partner])

/** 狀態 impactRecheck 之合法理由(檢定標準 ES10) */
const IMPACT_REASONS = new Set([RECHECK_REASONS.relationChanged, RECHECK_REASONS.conflictReason])

/**
 * 重審項(純判定):changed(被引用之存活出處內容已變)、conflict(衝突邊觸及被引用之存活出處而未見過)、conflictGone(見 conflictGoneOf;給 conflictEvents 才判)、
 *   resend(逾限筆記之重送:檢定標準 ES15——待判登錄之條件成立,如提示詞或起草席位已變;呼叫端給 resend);
 *   impact 開啟時(檢定標準 ES10;relationImpact)另收狀態之 impactRecheck(relationChanged／conflictReason:記錄在、仍被引用、md 讀得到)與
 *   partners(新關聯之夥伴:未消化、記錄在、md 讀得到、已就緒、所依之邊仍在)
 *
 * @param {Object} s 輸入狀態
 * @param {Object} o 輸入 { notesById:Map, conflictEdges:Array, keyOf:(nid)=>雜湊|null, version:內容鍵版本, conflictEvents?:Array, resend?:Array(筆記 id),
 *   impact?:Boolean, readyOf?:(nid)=>Boolean, edgeOf?:(邊 id)=>邊|null(夥伴所依之邊;現存且非衝突型者) }
 * @returns {Array} 回傳 [{ id(要入批之筆記), reason:'changed'|'conflict'|'conflictGone'|'resend'|'relationChanged'|'conflictReason'|'partner', anchor?, edgeId?, at?, kind?, newType?, why? }]
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }], consumed: ['n1'] }).state
 * console.log(recheckItemsOf(s, { notesById: new Map(), conflictEdges: [], keyOf: () => 'k', version: 1 }))
 * // => []
 */
export function recheckItemsOf(s, o = {}) {
    const notesById = o.notesById instanceof Map ? o.notesById : new Map()
    const keyOf = typeof o.keyOf === 'function' ? o.keyOf : () => null
    const W = withdrawnOf(s)
    const cited = citedNotesOf(s)
    const out = []
    // 重送(ES15):已消化(逾限出隊)之筆記;記錄在、未撤、md 讀得到才入批
    const consumed = new Set(isarr(s?.consumed) ? s.consumed : [])
    for (const nid of new Set(isarr(o.resend) ? o.resend : [])) if (consumed.has(nid) && notesById.has(nid) && !W.has(nid) && keyOf(nid) !== null) out.push({ id: nid, reason: RECHECK_REASONS.resend })
    if (str(o.version)) {
        for (const nid of cited) {
            const prev = s?.seen?.[nid]
            if (!isobj(prev) || prev.v !== o.version || !notesById.has(nid)) continue
            const k = keyOf(nid)
            if (k !== null && k !== undefined && k !== prev.k) out.push({ id: nid, reason: RECHECK_REASONS.changed })
        }
    }
    const seenC = new Set(isarr(s?.seenConflicts) ? s.seenConflicts : [])
    const byEdge = new Set()
    for (const e of isarr(o.conflictEdges) ? o.conflictEdges : []) {
        if (!e?.id || seenC.has(e.id) || byEdge.has(e.id)) continue
        const a = cited.has(e.from)
        const b = cited.has(e.to)
        if (!a && !b) continue
        let id
        let anchor
        if (a && b) {
            // 兩端皆被引用:呈現較新建立之一端(另一端為錨點)
            const ca = str(notesById.get(e.from)?.createdAt)
            const cb = str(notesById.get(e.to)?.createdAt)
            ;[id, anchor] = ca >= cb ? [e.from, e.to] : [e.to, e.from]
        }
        else [id, anchor] = a ? [e.to, e.from] : [e.from, e.to]
        if (!notesById.has(id) || W.has(id) || keyOf(id) === null) continue
        byEdge.add(e.id)
        out.push({ id, reason: RECHECK_REASONS.conflict, anchor, edgeId: e.id, at: str(e.updatedAt) || str(e.createdAt) })
    }
    if (isarr(o.conflictEvents) && o.conflictEvents.length) {
        out.push(...conflictGoneOf(s, { conflictEvents: o.conflictEvents, conflictIds: new Set((isarr(o.conflictEdges) ? o.conflictEdges : []).map((e) => e.id)), notesById, keyOf }).items)
    }
    // 關聯變更之影響(ES10):處置於維護時寫入狀態(relationImpact.impactOfCore),此處只依當下狀態篩出仍成立者
    if (o.impact === true) {
        const readyOf = typeof o.readyOf === 'function' ? o.readyOf : () => true
        const edgeOf = typeof o.edgeOf === 'function' ? o.edgeOf : () => null
        for (const [nid, list] of Object.entries(isobj(s?.impactRecheck) ? s.impactRecheck : {})) {
            if (!cited.has(nid) || !notesById.has(nid) || keyOf(nid) === null) continue
            for (const x of isarr(list) ? list : []) {
                if (!isobj(x) || !IMPACT_REASONS.has(x.reason)) continue
                out.push({ id: nid, reason: x.reason, anchor: str(x.anchor), edgeId: str(x.edgeId), at: str(x.at), kind: str(x.kind), newType: str(x.newType), why: str(x.why) })
            }
        }
        for (const [nid, p] of Object.entries(isobj(s?.partners) ? s.partners : {})) {
            if (!isobj(p) || consumed.has(nid) || !notesById.has(nid) || keyOf(nid) === null || !readyOf(nid)) continue
            const e = edgeOf(str(p.edge))
            if (!e) continue
            out.push({ id: nid, reason: RECHECK_REASONS.partner, anchor: str(p.from), edgeId: str(p.edge), at: str(p.at), newType: str(e.type), why: str(e.reason) })
        }
    }
    return out
}

/**
 * 本批之重審筆記(至多 slots 篇,同一篇之多項併為一篇):changed 先、conflictGone 次之、relationChanged／conflictReason(關聯變更,ES10)再次、
 *   resend 再次、conflict 依邊時刻舊到新,partner(新關聯之夥伴,ES10)依時刻舊到新殿後
 *
 * @param {Array} items 輸入 recheckItemsOf 之產物
 * @param {Integer} slots 輸入至多幾篇
 * @param {Object} [o={}] 輸入 { exclude:Array(不排之理由;一般批之夥伴另以補位處理) }
 * @returns {Object} 回傳 { ids:Array(筆記 id), items:Array(入批之項,含同一篇之全部項) }
 * @example
 * const items = [{ id: 'n1', reason: 'changed', at: 'T1' }, { id: 'n2', reason: 'conflict', at: 'T2' }]
 * console.log(pickRecheck(items, 1).ids)
 * // => [ 'n1' ]
 */
export function pickRecheck(items, slots, o = {}) {
    const n = Number.isInteger(slots) && slots > 0 ? slots : 0
    if (!n || !isarr(items) || !items.length) return { ids: [], items: [] }
    const ex = new Set(isarr(o?.exclude) ? o.exclude : [])
    const of = (reason) => (ex.has(reason) ? [] : items.filter((x) => x.reason === reason))
    const byAt = (list) => list.sort((x, y) => cmp(str(x.at), str(y.at)))
    const sorted = [...of(RECHECK_REASONS.changed), ...of(RECHECK_REASONS.conflictGone), ...of(RECHECK_REASONS.relationChanged), ...of(RECHECK_REASONS.conflictReason), ...of(RECHECK_REASONS.resend), ...byAt(of(RECHECK_REASONS.conflict)), ...byAt(of(RECHECK_REASONS.partner))]
    const ids = []
    for (const x of sorted) {
        if (ids.length >= n) break
        if (!ids.includes(x.id)) ids.push(x.id)
    }
    return { ids, items: items.filter((x) => ids.includes(x.id) && !ex.has(x.reason)) }
}

/**
 * 僅重審 pass 是否到期:有立即到期之理由(URGENT_RECHECK_REASONS);或湊批之理由(conflict、partner)之篇數 ≥ 門檻;
 *   或其最舊者之時刻已逾等待天數
 *
 * @param {Array} items 輸入重審項
 * @param {Object} o 輸入 { minConflict, waitDays, nowMs }
 * @returns {Boolean} 回傳是否到期
 * @example
 * console.log(recheckDue([{ id: 'n1', reason: 'changed', at: '2026-09-01T00:00:00+08:00' }], { minConflict: 3, waitDays: 7, nowMs: Date.parse('2026-09-02T00:00:00+08:00') }), recheckDue([{ id: 'n2', reason: 'conflict', at: '2026-09-01T00:00:00+08:00' }], { minConflict: 3, waitDays: 7, nowMs: Date.parse('2026-09-02T00:00:00+08:00') }))
 * // => true false
 */
export function recheckDue(items, o = {}) {
    if (!isarr(items) || !items.length) return false
    if (items.some((x) => URGENT_RECHECK_REASONS.includes(x.reason))) return true
    const batched = items.filter((x) => BATCHED_RECHECK_REASONS.has(x.reason))
    if (new Set(batched.map((x) => x.id)).size >= (Number(o.minConflict) || 1)) return true
    const oldest = Math.min(...batched.map((x) => Date.parse(x.at || '')).filter(Number.isFinite))
    return Number.isFinite(oldest) && Number.isFinite(o.nowMs) && o.nowMs - oldest >= (Number(o.waitDays) || 0) * 86400_000
}

export default { RECHECK_REASONS, URGENT_RECHECK_REASONS, conflictGoneOf, recheckItemsOf, pickRecheck, recheckDue }
