// relationImpact.mjs — 關聯變更之影響範圍(知識或關聯加入或變更時更新影響範圍內之高階知識;檢定標準 ES10)——純函數:事件之產生
//   (邊庫快照差分)、逐核心之處置判定與套用
//
// 【事件(全型別)】快照(dirs.state/extract-edges-seen.json:邊 id → 型別＋理由雜湊)與現行邊庫差分:add(新邊)、retype(型別變)、
//   reason(同型、理由變)、retire(快照有、現無,且撤出稽核帳有該邊——正面證據)、gone(現無而稽核無紀錄:非經套件刪除路徑之消失,
//   不推定撤銷、只記)。首見(無快照)→ 以現值為基準、不產事件。不改關聯之寫入點(帳驅動;同 conflictGone 之精神);「被撤出之邊」之判定
//   (每條邊之最後一筆稽核、其後還原者不算)取關聯套件之 retiredEdgesOf(與其 restoreEdge 同一判定,不另寫一份)。
// 【處置(逐事件 × 受影響之核心:已消化含任一端、或夥伴候選依此邊者)】
//   add 非衝突型:一端被核心引用、另一端 P 未被核心消化 → P 入夥伴候選(state.partners;重審管道之最低優先:一般批只補空位、
//     閒置核心由僅重審 pass 湊批處理);其餘 → none(附理由);衝突型 → none(新判衝突由重審 conflict 處理)。
//   retire／retype／reason:經此邊入批而仍被引用之筆記(state.via)→ 重審 relationChanged;衝突型改理由且有未決爭議之兩方分含兩端
//     → 重審 conflictReason;夥伴候選所依之邊被撤或改為衝突型 → 自候選移除;其餘 → none(附理由)。「不需更新」亦留理由(處置可稽)。
// 【狀態欄位(只在開啟後出現)】partners{ 筆記 id: { edge, from, at } }(未消化)、impactRecheck{ 筆記 id: [重審項] }(已消化)、
//   via{ 筆記 id: 邊 id }(經夥伴入批而已涵蓋者)——不變式見 coreState.checkInvariants;消化即移出 partners(stores/coreDelta 之 commitBatch)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { sha1, textValueOf as str, jsonClone as clone } from '../core/capturePackage.mjs'
import { retiredEdgesOf } from '../core/relatePackage.mjs'
import { HASH_FIELD_SEP, withdrawnOf, citedNotesOf } from '../stores/coreState.mjs'
import { EDGE_SEEN_FILE, IMPACT_LEDGER_FILE } from '../stores/extractFiles.mjs'
import { RECHECK_REASONS } from './recheck.mjs'

export { EDGE_SEEN_FILE, IMPACT_LEDGER_FILE }

const KIND_WORD = { retire: '已撤銷', retype: '改型', reason: '理由已更新' }

/**
 * 邊之簽章(型別＋理由雜湊;差分用)
 *
 * @param {Object} e 輸入邊
 * @returns {String} 回傳簽章
 * @example
 * console.log(edgeSigOf({ type: '延伸深化', reason: '理由' }) === edgeSigOf({ type: '延伸深化', reason: '理由' }), edgeSigOf({ type: '延伸深化', reason: '理由' }) === edgeSigOf({ type: '衝突', reason: '理由' }))
 * // => true false
 */
export function edgeSigOf(e) {
    return `${str(e?.type)}${HASH_FIELD_SEP}${sha1(str(e?.reason)).slice(0, 8)}`
}

/**
 * 邊庫快照(寫檔之內容)
 *
 * @param {Array} edges 輸入現行全部邊
 * @param {String} at 輸入時刻
 * @returns {Object} 回傳 { v:1, at, edges:{ 邊 id: 簽章 } }
 * @example
 * const snap = edgeSnapshotOf([{ id: 'a|b', from: 'a', to: 'b', type: '延伸深化', reason: '理由' }], '2026-09-01T00:00:00+08:00')
 * console.log(snap.at, Object.keys(snap.edges))
 * // => 2026-09-01T00:00:00+08:00 [ 'a|b' ]
 */
export function edgeSnapshotOf(edges, at) {
    const out = {}
    for (const e of isarr(edges) ? edges : []) if (str(e?.id)) out[e.id] = edgeSigOf(e)
    return { v: 1, at: str(at), edges: out }
}

/**
 * 影響事件(快照差分;撤銷以稽核為證)
 *
 * @param {Object|null} prev 輸入前次快照(edgeSnapshotOf 之產物;null＝首見)
 * @param {Array} edges 輸入現行全部邊(型別已為現名)
 * @param {Array} [audit=[]] 輸入撤出稽核帳之列({ at, reason, detail?, edge };還原另記 reason 'restored')
 * @param {Object} [o={}] 輸入 { typeOf:(型別)=>現名(型別改名表;快照中之舊名先換成現名再比——只是改名不算改型) }
 * @returns {Object} 回傳 { baseline:Boolean(首見,不產事件), events:[{ kind:'add'|'retype'|'reason'|'retire'|'gone', edgeId, from, to, type, oldType, reason }] }
 * @example
 * const e1 = { id: 'a|b', from: 'a', to: 'b', type: '延伸深化', reason: '理由' }
 * const prev = edgeSnapshotOf([e1], '2026-09-01T00:00:00+08:00')
 * const r = relationEventsOf(prev, [{ ...e1, type: '衝突' }, { id: 'a|c', from: 'a', to: 'c', type: '延伸深化', reason: '理由' }])
 * console.log(r.baseline, r.events.map((x) => [x.kind, x.edgeId]), relationEventsOf(null, [e1]).baseline)
 * // => false [ [ 'retype', 'a|b' ], [ 'add', 'a|c' ] ] true
 */
export function relationEventsOf(prev, edges, audit = [], o = {}) {
    if (!isobj(prev?.edges)) return { baseline: true, events: [] }
    const typeOf = typeof o.typeOf === 'function' ? o.typeOf : (t) => t
    const sigNow = (old) => {
        const [t, h] = String(old).split(HASH_FIELD_SEP)
        return `${str(typeOf(t)) || t}${HASH_FIELD_SEP}${h || ''}`
    }
    const list = isarr(edges) ? edges.filter((e) => str(e?.id)) : []
    const cur = new Set(list.map((e) => e.id))
    // 每邊之最後一筆稽核:撤出(任何理由)為證;其後又還原者不算(關聯套件之 retiredEdgesOf)
    const retired = retiredEdgesOf(audit)
    const events = []
    for (const e of list) {
        const old = prev.edges[e.id]
        const base = { edgeId: e.id, from: str(e.from), to: str(e.to), type: str(e.type), reason: str(e.reason) }
        if (old === undefined) events.push({ kind: 'add', ...base, oldType: '' })
        else if (sigNow(old) !== edgeSigOf(e)) {
            const oldType = sigNow(old).split(HASH_FIELD_SEP)[0]
            events.push({ kind: oldType !== base.type ? 'retype' : 'reason', ...base, oldType })
        }
    }
    for (const id of Object.keys(prev.edges)) {
        if (cur.has(id)) continue
        const r = retired.get(id)
        const oldType = sigNow(prev.edges[id]).split(HASH_FIELD_SEP)[0]
        if (r) events.push({ kind: 'retire', edgeId: id, from: str(r.edge.from), to: str(r.edge.to), type: '', oldType, reason: str(r.detail) || str(r.reason) })
        else events.push({ kind: 'gone', edgeId: id, from: '', to: '', type: '', oldType, reason: '' })
    }
    return { baseline: false, events }
}

/**
 * 一個核心之處置(純判定;不改狀態)
 *
 * @param {Object} s 輸入核心狀態
 * @param {Array} events 輸入影響事件(依序;同一邊之多個事件依序生效)
 * @param {Object} [o={}] 輸入 { isConflict:(type)=>Boolean, at }
 * @returns {Object} 回傳 { rows:[{ ...事件, action:'candidate'|'drop-candidate'|'recheck'|'none', why }](只列觸及本核心者),
 *   addPartners:Map(筆記 id → { edge, from, at }), dropPartners:Map(筆記 id → 理由), recheck:Array({ id, reason, anchor, edgeId, kind, newType, why, at }) }
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['a'] }], consumed: ['a'] }).state
 * const prev = edgeSnapshotOf([], 'T0')
 * const events = relationEventsOf(prev, [{ id: 'a|c', from: 'a', to: 'c', type: '延伸深化', reason: '理由' }]).events
 * const plan = impactOfCore(s, events, { isConflict: (t) => t === '衝突', at: 'T1' })
 * console.log(plan.rows.map((x) => [x.kind, x.action]), plan.recheck.length)
 * // => [ [ 'add', 'candidate' ] ] 0
 */
export function impactOfCore(s, events, o = {}) {
    const isConflict = typeof o.isConflict === 'function' ? o.isConflict : () => false
    const at = str(o.at)
    const out = { rows: [], addPartners: new Map(), dropPartners: new Map(), recheck: [] }
    const consumed = new Set(isarr(s?.consumed) ? s.consumed : [])
    const cited = citedNotesOf(s)
    const W = withdrawnOf(s)
    // 夥伴候選(含本次新增者;同一輪先加後撤之邊須能撤回)
    const partners = new Map(Object.entries(isobj(s?.partners) ? s.partners : {}).map(([nid, p]) => [nid, str(p?.edge)]))
    const via = isobj(s?.via) ? s.via : {}
    // 未決爭議之各方篇集(conflictReason 用)
    const claimSrc = new Map((s?.claims || []).map((c) => [c.id, isarr(c.sources) ? c.sources : []]))
    const sideDocs = (s?.disputes || []).filter((d) => d.status === 'open').map((d) => (d.sides || []).map((sd) => new Set([...(isarr(sd.sources) ? sd.sources : []), ...(isarr(sd.claims) ? sd.claims : []).flatMap((c) => claimSrc.get(c) || [])])))
    const splitBy = (a, b) => sideDocs.some((docs) => docs.some((x, i) => x.has(a) && docs.some((y, j) => j !== i && y.has(b))))
    const row = (e, action, why) => out.rows.push({ ...e, action, why })
    for (const e of isarr(events) ? events : []) {
        if (e.kind === 'gone') continue
        const partnerHit = [...partners.entries()].filter(([, edge]) => edge === e.edgeId).map(([nid]) => nid)
        if (!consumed.has(e.from) && !consumed.has(e.to) && !partnerHit.length) continue
        if (e.kind === 'add') {
            if (isConflict(e.type)) {
                row(e, 'none', '衝突型新邊由重審（新判衝突）處理')
                continue
            }
            const pick = (a, b) => (cited.has(a) && !consumed.has(b) && b ? [a, b] : null)
            const pair = pick(e.from, e.to) || pick(e.to, e.from)
            if (!pair) {
                const why = consumed.has(e.from) && consumed.has(e.to) ? '兩端皆已被本核心消化，核心已讀過兩方內容'
                    : '已消化之一端未被本核心任何條目引用'
                row(e, 'none', why)
                continue
            }
            const [inside, outside] = pair
            if (partners.has(outside)) {
                row(e, 'none', `〈${outside}〉已是夥伴候選（依另一關聯）`)
                continue
            }
            partners.set(outside, e.edgeId)
            out.addPartners.set(outside, { edge: e.edgeId, from: inside, at })
            out.dropPartners.delete(outside)
            row(e, 'candidate', `〈${outside}〉與本核心所引〈${inside}〉新增「${e.type}」關聯——入夥伴候選`)
            continue
        }
        // retire／retype／reason
        let acted = false
        for (const nid of partnerHit) {
            if (e.kind === 'retire' || (e.kind === 'retype' && isConflict(e.type))) {
                partners.delete(nid)
                out.addPartners.delete(nid)
                out.dropPartners.set(nid, e.kind === 'retire' ? '夥伴候選所依之關聯已撤銷' : '夥伴候選所依之關聯改為衝突型（由重審新判衝突處理）')
                row(e, 'drop-candidate', out.dropPartners.get(nid))
            }
            else row(e, 'none', `夥伴候選〈${nid}〉所依之關聯${e.kind === 'retype' ? `改為「${e.type}」` : '理由已更新'}，仍為非衝突型——候選保留（呈現時取現值）`)
            acted = true
        }
        for (const nid of [e.from, e.to]) {
            if (!nid || str(via[nid]) !== e.edgeId || !cited.has(nid) || W.has(nid)) continue
            out.recheck.push({ id: nid, reason: RECHECK_REASONS.relationChanged, anchor: nid === e.from ? e.to : e.from, edgeId: e.edgeId, kind: e.kind, newType: e.type, why: e.reason, at })
            row(e, 'recheck', `〈${nid}〉經此關聯入批而被引用，關聯${e.kind === 'retype' ? `改為「${e.type}」` : KIND_WORD[e.kind]}——重審`)
            acted = true
        }
        if (e.kind === 'reason' && isConflict(e.type) && cited.has(e.from) && cited.has(e.to) && splitBy(e.from, e.to)) {
            out.recheck.push({ id: e.from, reason: RECHECK_REASONS.conflictReason, anchor: e.to, edgeId: e.edgeId, kind: e.kind, newType: e.type, why: e.reason, at })
            row(e, 'recheck', '衝突理由已更新，且未決爭議之兩方分含兩端——重審')
            acted = true
        }
        if (acted) continue
        if (isConflict(e.oldType) || isConflict(e.type)) row(e, 'none', e.kind === 'reason' ? '衝突理由已更新，但無未決爭議之兩方分含兩端' : '衝突型之撤銷／改型由衝突事件帳（衝突已撤銷之重審）處理')
        else row(e, 'none', '非經此關聯入批：核心條目以筆記內容為出處，關聯只作脈絡，條目不依此關聯成立')
    }
    return out
}

/**
 * 套用處置於狀態(純函數;回傳新狀態):夥伴候選之增刪、重審項之併入(同一筆記同一邊者以新代舊)、已刪筆記之夥伴移除
 *
 * @param {Object} s 輸入核心狀態
 * @param {Object} plan 輸入 impactOfCore 之產物
 * @param {Object} [o={}] 輸入 { gone:(nid)=>Boolean(筆記已刪除) }
 * @returns {Object} 回傳 { state, changed:Boolean, pruned:Array(因筆記已刪除而移出候選之 id) }
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['a'] }], consumed: ['a'] }).state
 * const events = relationEventsOf(edgeSnapshotOf([], 'T0'), [{ id: 'a|c', from: 'a', to: 'c', type: '延伸深化', reason: '理由' }]).events
 * const plan = impactOfCore(s, events, { isConflict: (t) => t === '衝突', at: 'T1' })
 * const r = applyImpact(s, plan, { gone: () => false })
 * console.log(r.changed, r.state === s, Object.keys(r.state).filter((k) => !(k in s)))
 * // => true false [ 'partners' ]
 */
export function applyImpact(s, plan, o = {}) {
    const gone = typeof o.gone === 'function' ? o.gone : () => false
    const next = clone(s)
    let changed = false
    const partners = isobj(next.partners) ? next.partners : {}
    for (const nid of (plan?.dropPartners || new Map()).keys()) {
        if (!partners[nid]) continue
        delete partners[nid]
        changed = true
    }
    for (const [nid, p] of plan?.addPartners || []) {
        if (partners[nid]) continue
        partners[nid] = { edge: p.edge, from: p.from, at: p.at }
        changed = true
    }
    const pruned = Object.keys(partners).filter((nid) => gone(nid))
    for (const nid of pruned) delete partners[nid]
    if (pruned.length) changed = true
    if (Object.keys(partners).length || isobj(next.partners)) next.partners = partners
    const rc = isobj(next.impactRecheck) ? next.impactRecheck : {}
    // 同一筆記同一邊同一理由之項以新代舊;內容相同者(重套同一事件)保留原項、不算變更
    const body = (a) => JSON.stringify([a.reason, a.anchor, a.edgeId, a.kind, a.newType, a.why])
    for (const x of plan?.recheck || []) {
        const item = { reason: x.reason, anchor: x.anchor, edgeId: x.edgeId, kind: x.kind, newType: x.newType, why: x.why, at: x.at }
        const prev = isarr(rc[x.id]) ? rc[x.id] : []
        if (prev.some((y) => body(y) === body(item))) continue
        rc[x.id] = [...prev.filter((y) => !(y.edgeId === x.edgeId && y.reason === x.reason)), item]
        changed = true
    }
    if (Object.keys(rc).length || isobj(next.impactRecheck)) next.impactRecheck = rc
    return { state: next, changed, pruned }
}

/**
 * 處置紀錄之列(寫 extract-impact.jsonl):candidate／drop-candidate／recheck 逐事件逐核心一列;none 依理由彙整一列(邊 id 清單);
 *   未觸及任何核心之事件與 gone 亦彙整留痕
 *
 * @param {Array} events 輸入本輪事件
 * @param {Array} perCore 輸入 [{ core:核心 id, rows:impactOfCore 之 rows }]
 * @param {String} at 輸入時刻
 * @returns {Array} 回傳紀錄列
 * @example
 * const events = relationEventsOf(edgeSnapshotOf([], 'T0'), [{ id: 'a|c', from: 'a', to: 'c', type: '延伸深化', reason: '理由' }]).events
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['a'] }], consumed: ['a'] }).state
 * const plan = impactOfCore(s, events, { isConflict: (t) => t === '衝突', at: 'T1' })
 * console.log(impactLedgerRowsOf(events, [{ core: 'c1', rows: plan.rows }], 'T1').map((x) => [x.core, x.action]))
 * // => [ [ 'c1', 'candidate' ] ]
 */
export function impactLedgerRowsOf(events, perCore, at) {
    const out = []
    const none = new Map()
    const touched = new Set()
    const addNone = (why, edgeId) => {
        if (!none.has(why)) none.set(why, new Set())
        none.get(why).add(edgeId)
    }
    for (const { core, rows } of isarr(perCore) ? perCore : []) {
        for (const r of isarr(rows) ? rows : []) {
            touched.add(r.edgeId)
            if (r.action === 'none') addNone(r.why, r.edgeId)
            else out.push({ at, kind: r.kind, edgeId: r.edgeId, from: r.from, to: r.to, type: r.type, oldType: r.oldType, core, action: r.action, why: r.why })
        }
    }
    for (const e of isarr(events) ? events : []) {
        if (touched.has(e.edgeId)) continue
        if (e.kind === 'gone') addNone('邊已不在而撤出稽核無紀錄（非經套件之刪除路徑），不推定撤銷', e.edgeId)
        else addNone('未觸及任何核心（兩端皆未被任何核心消化，亦非夥伴候選所依）', e.edgeId)
    }
    for (const [why, ids] of none) out.push({ at, action: 'none', why, count: ids.size, edges: [...ids] })
    return out
}

export default { EDGE_SEEN_FILE, IMPACT_LEDGER_FILE, edgeSigOf, edgeSnapshotOf, relationEventsOf, impactOfCore, applyImpact, impactLedgerRowsOf }
