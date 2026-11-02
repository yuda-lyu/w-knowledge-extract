// candidates.mjs — 三家起草候選之程式處理(純函數):穩定 id、ref 前綴、試套、計票、程式聯集、via 驗證、ref 別名
//
// 【穩定 id 依席位而非成功候選之序】runFanout 之 candidates 是「成功者依序過濾」,
//   第 2 席失敗時第 3 席之候選排第 2——以 r.agents 之席位序號給 id(a{席}_{n}),失敗席位不佔號。
// 【計票以實際成交之 provider】三席首選失敗而同落同一遞補家時,三份候選來自同一家,不算三個獨立支持(同一 provider 只算一票)。
// 【程式聯集保留單票者】整合失敗時之降級:保留全部合格操作(含只出現在一份候選者)——三家聯集勝過單家,
//   多出之知識正是這些單票者;「≥2 票才收」會把它們丟掉。

import { applyDelta } from '../stores/coreDelta.mjs'
import { normalizeConflictDecl } from '../standards/conflictDisposition.mjs'
import { containment, mutualContainment, sameSubstance } from '../guards/similarity.mjs'
import { REF_FIELDS } from '../stores/coreState.mjs'
import { textValueOf as str, textListOf as strs, uniq, jsonClone as clone } from '../core/capturePackage.mjs'

const REF_KEYS = REF_FIELDS.ids
const REF_LIST_KEYS = REF_FIELDS.lists

/**
 * 操作內之 '@ref' 改寫(含 sides／sides_add 之 claims 與文字中之〔@ref〕)
 *
 * @param {Object} op 輸入操作(就地修改)
 * @param {Function} map 輸入 (ref:String) => 新 ref(不含 @)
 * @returns {Object} 回傳同一操作
 * @example
 * const op = { op: 'dispute_add', ref: 'd', sides: [{ claims: ['@c'] }], text: '見〔@c〕' }
 * remapRefs(op, (ref) => `a1_${ref}`)
 * console.log(op.sides[0].claims, op.text)
 * // => [ '@a1_c' ] 見〔@a1_c〕
 */
export function remapRefs(op, map) {
    const fix = (v) => (typeof v === 'string' && v.startsWith('@') ? `@${map(v.slice(1))}` : v)
    for (const k of REF_KEYS) if (typeof op[k] === 'string') op[k] = fix(op[k])
    for (const k of REF_LIST_KEYS) if (Array.isArray(op[k])) op[k] = op[k].map(fix)
    for (const key of ['sides', 'sides_add']) if (Array.isArray(op[key])) for (const sd of op[key]) if (Array.isArray(sd?.claims)) sd.claims = sd.claims.map(fix)
    const txt = (v) => (typeof v === 'string' ? v.replace(/〔@([^〔〕\s]+)〕/g, (m, r) => `〔@${map(r)}〕`) : v)
    for (const k of ['text', 'question', 'note', 'critique', 'reason']) if (typeof op[k] === 'string') op[k] = txt(op[k])
    return op
}

/**
 * 候選加席位前綴:每條操作給穩定 id(a{席}_{n})、ref 改為 a{席}_{ref}、引用同步改寫;skipped 與衝突去向之宣告(conflicts,檢定標準 ES5)標席位
 *
 * @param {Object} delta 輸入候選 { ops, skipped, conflicts? }
 * @param {Integer} seat 輸入席位序號(1 起)
 * @returns {Object} 回傳 { ops, skipped, conflicts }(新物件)
 * @example
 * const d = prefixCandidate({ ops: [{ op: 'add', ref: 'r0', kind: 'rule', text: '甲', sources: ['N1'] }, { op: 'essence', text: '本質', claims: ['@r0'] }], skipped: [] }, 2)
 * console.log(d.ops.map((o) => [o._oid, o.ref, o.claims]))
 * // => [ [ 'a2_1', 'a2_r0', undefined ], [ 'a2_2', undefined, [ '@a2_r0' ] ] ]
 */
export function prefixCandidate(delta, seat) {
    const ops = (Array.isArray(delta?.ops) ? delta.ops : []).filter((o) => o && typeof o === 'object').map((o, n) => {
        const op = clone(o)
        if (str(op.ref)) op.ref = `a${seat}_${str(op.ref)}`
        remapRefs(op, (r) => `a${seat}_${r}`)
        op._oid = `a${seat}_${n + 1}`
        op._seat = seat
        return op
    })
    const skipped = (Array.isArray(delta?.skipped) ? delta.skipped : []).map((x) => ({ ...x, _seat: seat }))
    const conflicts = normalizeConflictDecl(delta?.conflicts).map((x) => ({ ...x, _seat: seat }))
    return { ops, skipped, conflicts }
}

/**
 * 試套:以 applyDelta 套於複本(不落盤),標出會被拒收之操作(_trial＝理由)
 *
 * @param {Object} state 輸入目前狀態
 * @param {Array} ops 輸入操作(就地加 _trial)
 * @param {Object} ctx 輸入 applyDelta 之 ctx(batch、mode、claimKinds、limits)
 * @returns {Object} 回傳 { applied:Integer, rejected:Integer }
 * @example
 * const ops = [{ op: 'add', ref: 'r0', kind: 'rule', text: '甲', basis: '案例', sources: ['N1'], critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }]
 * trialApply(emptyState(), ops, { batch: [{ code: 'N1', id: 'n-a' }], mode: 'delta', claimKinds: DEFAULT_CLAIM_KINDS, limits: DEFAULT_LIMITS })
 * console.log(ops.map((o) => o._trial || 'ok'))
 * // => [ 'ok' ]
 */
export function trialApply(state, ops, ctx) {
    const r = applyDelta(state, { ops }, ctx)
    for (const x of r.rejected) if (ops[x.index]) ops[x.index]._trial = x.reason
    return { applied: r.applied.length, rejected: r.rejected.length }
}

/** 操作之比對簽章:改狀態類以「操作＋目標」,新增類以文字 */
function sigOf(op) {
    if (['add'].includes(op.op)) return { kind: 'text', text: str(op.text) }
    if (op.op === 'dispute_add') return { kind: 'text', text: str(op.question) }
    if (op.op === 'param_add') return { kind: 'text', text: `${str(op.name)} ${str(op.value)}` }
    if (op.op === 'question_add') return { kind: 'text', text: str(op.text) }
    return { kind: 'target', key: `${op.op}|${str(op.id) || str(op.into)}` }
}
const similar = (a, b) => {
    if (a.op !== b.op) return false
    const sa = sigOf(a)
    const sb = sigOf(b)
    if (sa.kind !== sb.kind) return false
    return sa.kind === 'target' ? sa.key === sb.key : (sa.text && sb.text && (sameSubstance(sa.text, sb.text, 0.6) || mutualContainment(sa.text, sb.text) >= 0.6))
}

/**
 * 跨候選計票:每條操作之支持席位(以實際成交 provider 去重)
 *
 * @param {Array} cands 輸入 [{ seat, provider, ops }]
 * @returns {Map} 回傳 _oid → { votes:Integer(相異 provider 數), seats:Array, similar:Array(_oid) }
 * @example
 * const op = { op: 'add', kind: 'rule', text: '甲', sources: ['N1'] }
 * const votes = voteOps([{ seat: 1, provider: 'p1', ops: [{ ...op, _oid: 'a1_0' }] }, { seat: 2, provider: 'p2', ops: [{ ...op, _oid: 'a2_0' }] }])
 * console.log(votes.size)
 * // => 2
 */
export function voteOps(cands) {
    const all = cands.flatMap((c) => c.ops.map((op) => ({ op, seat: c.seat, provider: c.provider || `seat${c.seat}` })))
    const out = new Map()
    for (const x of all) {
        const peers = all.filter((y) => y.seat !== x.seat && similar(x.op, y.op))
        const providers = uniq([x.provider, ...peers.map((p) => p.provider)])
        out.set(x.op._oid, { votes: providers.length, seats: uniq([x.seat, ...peers.map((p) => p.seat)]), similar: peers.map((p) => p.op._oid) })
    }
    return out
}

/**
 * 程式聯集(整合失敗之降級):保留全部未被試套拒收之操作,相似者合為一條(取票多、文字長者為代表,出處取聯集),每條附 _via
 *
 * @param {Array} cands 輸入 [{ seat, provider, ops }](ops 已試套)
 * @param {Map} votes 輸入 voteOps 之產出
 * @returns {Array} 回傳整合後之操作陣列
 * @example
 * const op = { op: 'add', kind: 'rule', text: '甲', sources: ['N1'] }
 * const cands = [{ seat: 1, provider: 'p1', ops: [{ ...op, _oid: 'a1_0' }] }, { seat: 2, provider: 'p2', ops: [{ ...op, _oid: 'a2_0', sources: ['N2'] }] }]
 * const u = programUnion(cands, voteOps(cands))
 * console.log(u.length, u[0].sources, u[0]._via)
 * // => 1 [ 'N1', 'N2' ] [ 'a1_0', 'a2_0' ]
 */
export function programUnion(cands, votes) {
    const pool = cands.flatMap((c) => c.ops).filter((op) => !op._trial)
    const used = new Set()
    const out = []
    for (const op of pool) {
        if (used.has(op._oid)) continue
        const group = [op, ...pool.filter((y) => y._oid !== op._oid && !used.has(y._oid) && similar(op, y))]
        for (const g of group) used.add(g._oid)
        const rep = group.slice().sort((a, b) => (votes.get(b._oid)?.votes || 0) - (votes.get(a._oid)?.votes || 0) || str(b.text).length - str(a.text).length)[0]
        const merged = clone(rep)
        merged.sources = uniq(group.flatMap((g) => strs(g.sources)))
        // 關聯概念取聯集;爭議補方取聯集(同立場者去重)、說明取長者(終審 §3 D5i)
        if (rep.op === 'related_add') merged.concepts = uniq(group.flatMap((g) => strs(g.concepts)))
        if (rep.op === 'dispute_update') {
            const seen = new Set()
            const sides = group.flatMap((g) => (Array.isArray(g.sides_add) ? g.sides_add : [])).filter((sd) => sd && typeof sd === 'object').filter((sd) => (seen.has(str(sd.position)) ? false : (seen.add(str(sd.position)), true)))
            if (sides.length) merged.sides_add = sides.map(clone)
            const note = group.map((g) => str(g.note)).sort((a, b) => b.length - a.length)[0]
            if (note) merged.note = note
        }
        merged._via = group.map((g) => g._oid)
        merged._votes = votes.get(rep._oid)?.votes || 1
        out.push(merged)
    }
    return out
}

/** 整合者輸出與候選比對之文字(依操作種類:新增類之 text／question、修訂之 fields.text、本質之 text、參數之名稱＋值) */
const viaTextOf = (op) => (op?.op === 'revise' ? str(op.fields?.text) : (op?.op === 'param_add' ? [str(op.name), str(op.value)].filter(Boolean).join(' ') : (str(op?.text) || str(op?.question))))
/** 改狀態類之目標欄位(整合不得改目標) */
const TARGET_KEYS = ['id', 'into', 'by', 'dispute', 'claim']

/**
 * 驗證整合者之輸出:每條須以 via 指回候選操作;操作種類須同所引候選之一;改狀態類之目標須同所引候選;出處(含各方之出處)不得超出 via 所指操作之
 *   出處聯集;文字(新增類之 text／question、修訂之 fields.text、本質之 text、參數之名稱＋值)須保有 via 原文過半(終審 §3 D5i)——
 *   判式為兩向包含率任一 ≥0.5(新文為原文之子集而僅縮短者亦過;同 opGuards 之 revise 判式),非嚴格之「原文過半在新文」
 *
 * @param {Array} ops 輸入整合者回傳之操作(各帶 via:Array)
 * @param {Map} byOid 輸入 _oid → 候選操作
 * @returns {Object} 回傳 { ops:Array(通過者,帶 _via), rejected:Array({op,reason}) }
 * @example
 * const cand = { _oid: 'a1_0', op: 'add', kind: 'rule', text: '甲乙丙丁', sources: ['N1'] }
 * const r = validateVia([{ op: 'add', kind: 'rule', text: '甲乙丙丁', sources: ['N1'], via: ['a1_0'] }, { op: 'add', kind: 'rule', text: '全新文字', sources: ['N1'], via: ['a1_0'] }], new Map([['a1_0', cand]]))
 * console.log(r.ops.length, r.rejected.length)
 * // => 1 1
 */
export function validateVia(ops, byOid) {
    const ok = []
    const rejected = []
    for (const op0 of Array.isArray(ops) ? ops : []) {
        if (!op0 || typeof op0 !== 'object') continue
        const op = clone(op0)
        const via = strs(op.via).filter((x) => byOid.has(x))
        delete op.via
        if (!via.length) {
            rejected.push({ op, reason: 'via 未指回任何候選操作（整合不可新增候選沒有之操作）' })
            continue
        }
        const cands = via.map((x) => byOid.get(x))
        if (!cands.some((c) => str(c.op) === str(op.op))) {
            rejected.push({ op, reason: `操作種類 ${str(op.op) || '?'} 與所引候選（${uniq(cands.map((c) => str(c.op))).join('、')}）不同（整合不可改變操作種類）` })
            continue
        }
        const badTarget = TARGET_KEYS.find((k) => typeof op[k] === 'string' && str(op[k]) && !cands.some((c) => str(c[k]) === str(op[k])))
        if (badTarget) {
            rejected.push({ op, reason: `目標 ${badTarget}＝${str(op[badTarget])} 與所引候選不同（整合不可改變操作之目標）` })
            continue
        }
        const srcs = srcUnion(cands)
        const extra = [...strs(op.sources), ...(Array.isArray(op.sides) ? op.sides.flatMap((sd) => strs(sd?.sources)) : [])].filter((x) => !srcs.has(x))
        if (extra.length) {
            rejected.push({ op, reason: `出處 ${uniq(extra).join('、')} 不在所引候選之出處內` })
            continue
        }
        const t = viaTextOf(op)
        if (t) {
            const base = cands.map(viaTextOf).filter(Boolean)
            if (base.length && Math.max(...base.map((b) => containment(t, b))) < 0.5 && Math.max(...base.map((b) => containment(b, t))) < 0.5) {
                rejected.push({ op, reason: '文字與所引候選差異過大（整合不可改寫成候選沒有之內容）' })
                continue
            }
        }
        op._via = via
        ok.push(op)
    }
    return { ops: ok, rejected }
}
const srcUnion = (ops) => new Set(ops.flatMap((o) => [...strs(o?.sources), ...(Array.isArray(o?.sides) ? o.sides.flatMap((sd) => strs(sd?.sources)) : [])]))

/**
 * 「多數支持卻未被整合收入」之操作(交審計)
 *
 * @param {Array} cands 輸入候選
 * @param {Map} votes 輸入計票
 * @param {Array} integrated 輸入整合後操作(帶 _via)
 * @returns {Array} 回傳未被收入且票數 ≥2 之候選操作
 * @example
 * const op = { op: 'add', kind: 'rule', text: '甲', sources: ['N1'] }
 * const cands = [{ seat: 1, provider: 'p1', ops: [{ ...op, _oid: 'a1_0' }] }, { seat: 2, provider: 'p2', ops: [{ ...op, _oid: 'a2_0' }] }, { seat: 3, provider: 'p3', ops: [] }]
 * console.log(droppedMajority(cands, voteOps(cands), []).length)
 * // => 2
 */
export function droppedMajority(cands, votes, integrated) {
    const covered = new Set(integrated.flatMap((o) => o._via || []))
    return cands.flatMap((c) => c.ops).filter((op) => !op._trial && !covered.has(op._oid) && (votes.get(op._oid)?.votes || 0) >= 2 && !(votes.get(op._oid)?.similar || []).some((x) => covered.has(x)))
}

/**
 * ref 別名(新增轉確認後,原 ref 之引用改指既有條目 id)
 *
 * @param {Array} ops 輸入操作(就地改寫)
 * @returns {Array} 回傳同一陣列
 * @example
 * const ops = [{ op: 'confirm', id: 'C1', _refAlias: { ref: 'x', id: 'C1' }, sources: ['N1'] }, { op: 'essence', text: '本質', claims: ['@x'] }]
 * applyRefAliases(ops)
 * console.log(ops[1].claims)
 * // => [ 'C1' ]
 */
export function applyRefAliases(ops) {
    const alias = new Map(ops.filter((o) => o?._refAlias).map((o) => [o._refAlias.ref, o._refAlias.id]))
    if (!alias.size) return ops
    for (const op of ops) {
        const fix = (v) => (typeof v === 'string' && v.startsWith('@') && alias.has(v.slice(1)) ? alias.get(v.slice(1)) : v)
        for (const k of REF_KEYS) if (typeof op[k] === 'string') op[k] = fix(op[k])
        for (const k of REF_LIST_KEYS) if (Array.isArray(op[k])) op[k] = op[k].map(fix)
        for (const key of ['sides', 'sides_add']) if (Array.isArray(op[key])) for (const sd of op[key]) if (Array.isArray(sd?.claims)) sd.claims = sd.claims.map(fix)
    }
    return ops
}

/**
 * 操作所引之同差量 ref(去 @;含 sides 之 claims 與文字中之〔@ref〕)
 *
 * @param {Object} op 輸入操作
 * @returns {Array} 回傳 ref 名陣列(不含 @,去重)
 * @example
 * console.log(refsOf({ op: 'dispute_add', sides: [{ claims: ['@r1'] }], text: '見〔@r2〕', claims: ['@r0', 'C3'] }))
 * // => [ 'r0', 'r1', 'r2' ]
 */
export function refsOf(op) {
    const out = []
    const take = (v) => { if (typeof v === 'string' && v.startsWith('@') && v.length > 1) out.push(v.slice(1)) }
    for (const k of REF_KEYS) take(op?.[k])
    for (const k of REF_LIST_KEYS) if (Array.isArray(op?.[k])) op[k].forEach(take)
    for (const key of ['sides', 'sides_add']) if (Array.isArray(op?.[key])) for (const sd of op[key]) if (Array.isArray(sd?.claims)) sd.claims.forEach(take)
    for (const k of ['text', 'question', 'note', 'critique']) if (typeof op?.[k] === 'string') for (const m of op[k].matchAll(/〔@([^〔〕\s]+)〕/g)) out.push(m[1])
    return uniq(out)
}

/**
 * 漏寫 @ 之 ref 補回:引用欄位之值等於某個已知 ref 名(候選或本差量所定義)而非既有條目編號者,改為 '@名'
 * (整合員常寫 claims:["a3_c_xxx"] 而漏了 @,不補回則整條以「引用之項目不存在」被拒)
 *
 * @param {Array} ops 輸入操作(就地改寫)
 * @param {Set} names 輸入已知 ref 名集合
 * @returns {Array} 回傳同一陣列
 * @example
 * const ops = [{ op: 'essence', text: '本質', claims: ['a1_r0', 'C2'] }]
 * normalizeBareRefs(ops, new Set(['a1_r0']))
 * console.log(ops[0].claims)
 * // => [ '@a1_r0', 'C2' ]
 */
export function normalizeBareRefs(ops, names) {
    const fix = (v) => (typeof v === 'string' && !v.startsWith('@') && names.has(v) ? `@${v}` : v)
    for (const op of ops) {
        for (const k of REF_KEYS) if (typeof op[k] === 'string') op[k] = fix(op[k])
        for (const k of REF_LIST_KEYS) if (Array.isArray(op[k])) op[k] = op[k].map(fix)
        for (const key of ['sides', 'sides_add']) if (Array.isArray(op[key])) for (const sd of op[key]) if (Array.isArray(sd?.claims)) sd.claims = sd.claims.map(fix)
    }
    return ops
}

/**
 * ref 依賴閉包:整合(或程式聯集、修訂)後之操作所引之 '@ref' 未在本差量定義時——
 *   ①本差量中有操作之 _via 含該 ref 之定義操作(整合員把它合併改名或未給 ref)→ 別名指向它(必要時補上 ref);
 *   ②否則自候選取回定義操作(未被試套拒收者)一併收入,標 _closure。重複至不再增加。
 * (整合員常收了引用 @ref 之 param_add 與 dispute_add,卻漏了定義它之 add,不閉包則兩條皆被拒)
 *
 * @param {Array} ops 輸入操作(帶 _oid、_via)
 * @param {Array} cands 輸入候選 [{ ops }](已前綴、已試套)
 * @returns {Object} 回傳 { ops:Array(新陣列), added:Array({ref,by,how}) }
 * @example
 * const def = { _oid: 'a1_0', op: 'add', ref: 'a1_r0', kind: 'rule', text: '甲', sources: ['N1'] }
 * const ops = [{ _oid: 'i_1', op: 'essence', text: '本質', claims: ['@a1_r0'], _via: ['a1_1'] }]
 * const r = closeRefs(ops, [{ ops: [def] }])
 * console.log(r.ops.map((o) => o._oid), r.added)
 * // => [ 'i_1', 'a1_0' ] [ { ref: 'a1_r0', by: 'i_1', how: '取回 a1_0' } ]
 */
export function closeRefs(ops, cands) {
    const out = ops.map((o) => o)
    const pool = new Map()
    for (const c of cands || []) for (const op of c.ops || []) if (str(op.ref) && !op._trial && !pool.has(str(op.ref))) pool.set(str(op.ref), op)
    const defined = () => new Set(out.map((o) => str(o.ref)).filter(Boolean))
    const alias = new Map()
    const added = []
    for (let round = 0; round < 10; round++) {
        const have = defined()
        const missing = uniq(out.flatMap((o) => refsOf(o).map((r) => ({ r, by: o._oid })))
            .filter((x) => !have.has(x.r) && !alias.has(x.r) && pool.has(x.r)).map((x) => `${x.r}\u0000${x.by}`)).map((s) => s.split('\u0000'))
        if (!missing.length) break
        for (const [r, by] of missing) {
            if (defined().has(r) || alias.has(r)) continue
            const def = pool.get(r)
            const twin = out.find((o) => o.op === def.op && Array.isArray(o._via) && o._via.includes(def._oid))
            if (twin) {
                if (!str(twin.ref)) twin.ref = r
                else alias.set(r, str(twin.ref))
                added.push({ ref: r, by, how: `別名→${twin._oid}` })
                continue
            }
            const copy = clone(def)
            copy._via = [def._oid]
            copy._closure = true
            out.push(copy)
            added.push({ ref: r, by, how: `取回 ${def._oid}` })
        }
    }
    if (alias.size) for (const op of out) remapRefs(op, (x) => alias.get(x) || x)
    return { ops: out, added }
}

/**
 * 去掉程式欄位(送模型或 applyDelta 前;_i 由 applyVerdicts 自行管理)
 *
 * @param {Object} op 輸入操作
 * @returns {Object} 回傳去掉程式欄位(_oid、_via、_trial 等)後之操作複本
 * @example
 * console.log(stripProgramFields({ op: 'add', text: '甲', _oid: 'a1_0', _via: ['a1_0'], _trial: 'x' }))
 * // => { op: 'add', text: '甲' }
 */
export const stripProgramFields = (op) => {
    const o = clone(op)
    for (const k of Object.keys(o)) if (k.startsWith('_') && k !== '_i' && k !== '_withhold' && k !== '_doubt') delete o[k]
    return o
}

export default { remapRefs, prefixCandidate, trialApply, voteOps, programUnion, validateVia, droppedMajority, applyRefAliases, refsOf, normalizeBareRefs, closeRefs, stripProgramFields }
