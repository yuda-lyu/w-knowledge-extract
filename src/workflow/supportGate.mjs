// supportGate.mjs — 出處支持之新進覆核(檢定標準 ES9;含 ES7 語氣超出證據之修訂)之執行骨架一份:3+3 之定稿與待審裁決同取
//
// 【為何只此一份】runPass 與 pending 原各寫一份「覆核 → 修訂 → 重判 → 分流」,全缺票之判準、判不了之去向、材料不可得之處置三者各自漂移
//   (X77、X78、X87):同一處境須同一處置。本檔只做分流,不落盤、不登錄——去向由呼叫端依其所在(定稿／待審)處置。
// 【分流(每操作)】其受檢項(supportItemsOf;每操作可有多項——爭議各方)之判定:
//   ok:全部成立受支持 → 照套(受支持而兩席皆未列為支持之出處:新增出處者移除、既有主張之改寫／合併記排除集 ⑳)
//   rejected:任一項成立不受支持(含修訂後仍不受支持、修訂不成、修訂後未過納入閘)→ 不採;其 ref 記為已剔除
//   infra:任一項為基礎設施之未成立——缺票、同一供應者(panelRetryOf)、中止而未判、席位未設 → 留待(呼叫端:runPass 存待審、pending 留於待審),
//     不計次、不轉使用者(終審 §1 原則 3)
//   undetermined:兩票可用而判不了(不確定、不一致)→ 判斷之問題:runPass 不採並回報其本批筆記(呼叫端登錄筆記層待判),pending 留於待審並計 es9Tries
//   unreadable:任一出處之材料不可得(contentOf 回 null)→ 不送審、不採、不計次、不登錄(由 ES2／ES16 之未能判定呈現);allowPlaceholder(待審裁決)
//     時例外——占位筆記照送(占位字樣 NO_MATERIAL_TEXT 只此一處實際送出)
//   全部受檢項皆基礎設施 → infra:true(呼叫端不以失敗處置)。
// 【修訂(ES7)】未過之各項皆成立 overclaim(無 contradicted)且種類可改者 → 修訂席依出處收斂措辭(一次)→ 守門＋納入閘 → 判定小組重判(同一材料);
//   全部受支持才以修訂後之操作取代(一輪為限);重判為基礎設施之未成立 → 原操作留待(infra),其餘 → rejected。
// 【中止】任一席中止(預算、額度、斷網)→ 已判之項照分流、未判之項 infra;stopped:true 只供呼叫端計數,不使 pass 失敗。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { PANEL_WHY, PANEL_WHY_LABELS } from '../core/summarizePackage.mjs'
import { findItem, opIdOf } from '../stores/coreState.mjs'
import { supportItemsOf, runSupportCheck, supportCheckCallOf, supportByEffects, SUPPORT_WORD } from '../standards/supportCheck.mjs'
import { REVISABLE_KINDS, revisableOf, fieldsOf, applySupportFixes, runSupportRevise, parseSupportRevise, checkSupportRevise } from '../standards/supportRevise.mjs'
import { panelRetryOf, voteTextOf } from '../standards/panelVotes.mjs'
import { extractStatInit } from '../logContract.mjs'
import { textValueOf as str } from '../core/capturePackage.mjs'


/** 不採／留待之理由字樣(droppedRefs、待審之理由與日誌同讀) */
export const SUPPORT_GATE_WHY = Object.freeze({
    infra: '出處支持覆核未完成',
    unreadable: 'ES9：材料不可得',
})

/**
 * 一操作之各受檢項之判定 → 類別
 *
 * @param {Array} xs 輸入 [{ it, d }](d 為 decidePanel 之結果;未判者 undefined)
 * @returns {String} 回傳 'ok'｜'rejected'｜'infra'｜'undetermined'
 * @example
 * console.log(supportClassOfOp([]))
 * // => ok
 */
export function supportClassOfOp(xs) {
    const list = isarr(xs) ? xs : []
    if (list.every((x) => x.d?.status === 'decided' && x.d.verdict?.verdict === 'supported')) return 'ok'
    if (list.some((x) => x.d?.status === 'decided' && x.d.verdict?.verdict !== 'supported')) return 'rejected'
    if (list.some((x) => !x.d || panelRetryOf(x.d))) return 'infra'
    return 'undetermined'
}

/**
 * 出處支持之新進覆核(見檔頭)
 *
 * @param {Object} o 輸入 { ops, state, batch:[{ code, id }], concept, domain(buildSupportCheckPrompt、buildSupportRevisePrompt?), seats:{ check:{ first, second?, third? }, revise? },
 *   contentOf:(noteId)=>String|null, titleOf:(noteId)=>String, gate:(ops)=>{ ops, rejected:[{ op, why }] }(守門＋納入閘;修訂後之重篩), call:(stage, seat, prompt, parse, check)=>Promise,
 *   log?:(line)=>void, tag?:String(日誌前綴之段名;預設 '提煉'), words?:{ rejected, undetermined, infra, unreadable }(日誌尾段之處置字樣), allowPlaceholder?:Boolean }
 * @returns {Promise<Object>} 回傳 { ops(照套者;修訂者已取代、出處已依 ⑳ 修剪), withheld:[op](infra), undetermined:[{ op, notes }], rejected:[{ op, why }], unreadable:[{ op, notes }],
 *   replaced:Map(原 → 修訂後), exclusions:[{ id, ids, op }], droppedRefs:{ ref:理由 }, infra:Boolean(全部受檢項皆基礎設施), stopped:Boolean,
 *   stats:{ supportChecked, supportCalls, supportRejected, supportUndetermined, supportInfra, supportUnreadable, supportStopped, supportRevised, supportReviseFailed, supportSourcesDropped },
 *   trace:{ supportOut, supportRevise } }
 * @example
 * need test in nodejs.
 *
 * const r = await runSupportGate({ ops, state, batch, concept: '黑洞', domain, seats, contentOf, titleOf, gate, call })
 * console.log(r.replaced.size, r.exclusions)
 */
export async function runSupportGate(o) {
    const ops = isarr(o.ops) ? o.ops : []
    const { state, concept, domain } = o
    const batch = isarr(o.batch) ? o.batch : []
    const log = isfun(o.log) ? o.log : () => {}
    const tag = str(o.tag) || '提煉'
    const words = { rejected: '不採', undetermined: '不採', infra: '存待審', unreadable: '不採', ...(isobj(o.words) ? o.words : {}) }
    const contentOf = isfun(o.contentOf) ? o.contentOf : () => null
    const titleOf = isfun(o.titleOf) ? o.titleOf : (nid) => nid
    const stats = extractStatInit(['supportChecked', 'supportCalls', 'supportRejected', 'supportUndetermined', 'supportInfra', 'supportUnreadable', 'supportStopped', 'supportRevised', 'supportReviseFailed', 'supportSourcesDropped'])
    const trace = { supportOut: [], supportRevise: [] }
    const out = { ops, kept: new Map(), withheld: [], undetermined: [], rejected: [], unreadable: [], replaced: new Map(), exclusions: [], droppedRefs: {}, infra: false, stopped: false, stats, trace }
    const label = (op) => `${op.op}${opIdOf(op) ? `〔${opIdOf(op)}〕` : ''}`

    // ── 受檢項;材料不可得者不送審(待審裁決例外:占位照送)──
    const items0 = supportItemsOf(ops, { state, batch })
    const readable = (it) => it.notes.every((n) => contentOf(n) !== null && contentOf(n) !== undefined)
    const unreadableOps = new Map()
    if (!o.allowPlaceholder) {
        for (const it of items0.filter((x) => !readable(x))) unreadableOps.set(it.op, [...new Set([...(unreadableOps.get(it.op) || []), ...it.notes.filter((n) => contentOf(n) === null || contentOf(n) === undefined)])])
    }
    const items = items0.filter((it) => !unreadableOps.has(it.op))
    stats.supportChecked = items.length
    stats.supportUnreadable = unreadableOps.size
    for (const [op, notes] of unreadableOps) {
        out.unreadable.push({ op, notes })
        if (str(op.ref)) out.droppedRefs[str(op.ref)] = `未達檢定標準（${SUPPORT_GATE_WHY.unreadable}）`
        trace.supportOut.push({ op: op.op, id: opIdOf(op), why: SUPPORT_GATE_WHY.unreadable, items: [] })
        log(`${tag}出處覆核[${concept}]：${label(op)} ${SUPPORT_GATE_WHY.unreadable}（出處 ${notes.join('、')} 之內容讀不到）——${words.unreadable}`)
    }
    if (!items.length) {
        out.ops = ops.filter((op) => !unreadableOps.has(op))
        for (const op of out.ops) out.kept.set(op, op)
        return out
    }
    const checkCall = supportCheckCallOf(o.call)
    const check = (its) => runSupportCheck({ items: its, concept, contentOf, titleOf, buildPrompt: domain.buildSupportCheckPrompt, seats: o.seats?.check, call: checkCall })
    const sc = await check(items)
    stats.supportCalls += sc.calls
    out.stopped = sc.stopped
    const byOp = new Map()
    for (const it of items) byOp.set(it.op, [...(byOp.get(it.op) || []), { it, d: sc.decisions.get(it.key) }])
    const cls = new Map([...byOp].map(([op, xs]) => [op, supportClassOfOp(xs)]))
    out.infra = [...cls.values()].every((c) => c === 'infra') && !sc.stopped
    if (sc.stopped) stats.supportStopped = [...byOp.values()].filter((xs) => xs.some((x) => !x.d)).length

    // ── 語氣超出證據之修訂(ES7):不受支持而各項皆成立 overclaim、種類可改者 → 修訂一次 → 守門＋納入閘 → 重判 ──
    let eff2 = null
    const revCand = isfun(domain.buildSupportRevisePrompt) && o.seats?.revise
        ? [...byOp].filter(([op, xs]) => cls.get(op) === 'rejected' && xs.every((x) => REVISABLE_KINDS.includes(x.it.kind) && revisableOf(x.d)))
        : []
    if (revCand.length) {
        const targets = revCand.flatMap(([op, xs]) => xs.map((x) => ({ it: x.it, d: x.d, fields: fieldsOf(x.it, x.it.kind === 'revise' ? findItem(state, str(op.id))?.item : null) }))).filter((x) => x.fields)
        const rv = await runSupportRevise({ targets, concept, contentOf, titleOf, buildPrompt: domain.buildSupportRevisePrompt, call: (stage, seat, p) => o.call(stage, seat, p, parseSupportRevise, checkSupportRevise), seat: o.seats.revise })
        stats.supportCalls += rv.calls
        if (rv.stopped) {
            // 修訂席中止:候選之原操作留待(基礎設施),不以不受支持處置
            out.stopped = true
            for (const [op] of revCand) cls.set(op, 'infra')
            stats.supportStopped += revCand.length
        }
        else {
            const gated = []
            for (const [op, xs] of revCand) {
                const id = opIdOf(op)
                if (!xs.every((x) => rv.fixes.has(x.it.key))) {
                    trace.supportRevise.push({ op: op.op, id, out: 'no-fix' })
                    log(`${tag}出處覆核修訂[${concept}]：${label(op)} 修訂席未給可用之修訂——${words.rejected}`)
                    continue
                }
                const revised = applySupportFixes(op, xs.map((x) => ({ it: x.it, fix: rv.fixes.get(x.it.key) })))
                const g = o.gate([revised])
                if (!g.ops.length) {
                    const why = g.rejected.flatMap((x) => x.why).slice(0, 2).join('；')
                    trace.supportRevise.push({ op: op.op, id, out: 'gate', why })
                    log(`${tag}出處覆核修訂[${concept}]：${label(op)} 修訂後未過納入閘（${why}）——${words.rejected}`)
                    continue
                }
                gated.push({ op, revised: g.ops[0] })
            }
            if (gated.length) {
                const items2 = supportItemsOf(gated.map((x) => x.revised), { state, batch })
                const sc2 = await check(items2)
                stats.supportCalls += sc2.calls
                if (sc2.stopped) out.stopped = true
                eff2 = supportByEffects(items2, sc2.decisions, { batch })
                for (const x of gated) {
                    const its = items2.filter((it) => it.op === x.revised)
                    const c2 = its.length ? supportClassOfOp(its.map((it) => ({ it, d: sc2.decisions.get(it.key) }))) : 'rejected'
                    const id = opIdOf(x.op)
                    if (c2 === 'infra') {
                        cls.set(x.op, 'infra')
                        trace.supportRevise.push({ op: x.op.op, id, out: 'infra' })
                        continue
                    }
                    trace.supportRevise.push({ op: x.op.op, id, out: c2 === 'ok' ? 'supported' : 'not-supported', text: its.map((it) => it.text.slice(0, 160)) })
                    if (c2 === 'ok') out.replaced.set(x.op, x.revised)
                    log(`${tag}出處覆核修訂[${concept}]：${label(x.op)} 依出處收斂措辭後${c2 === 'ok' ? '兩席判受支持——照套修訂後之文字' : `仍未受支持——${words.rejected}`}（${its.map((it) => it.text).join('｜').slice(0, 80)}）`)
                }
            }
            stats.supportRevised = out.replaced.size
            stats.supportReviseFailed = revCand.filter(([op]) => !out.replaced.has(op) && cls.get(op) !== 'infra').length
        }
    }

    // ── 分流 ──
    const itemsOf = (xs) => xs.map((x) => ({ kind: x.it.kind, text: x.it.text.slice(0, 160), notes: x.it.notes, status: x.d?.status || '', verdict: x.d?.verdict?.verdict || '', why: x.d?.why || '', votes: voteTextOf(x.d, { chars: 80, bareProvider: true, list: true }) }))
    const reasonsOf = (x) => (x.d?.votes || []).map((v) => v.verdict).filter((v) => v && typeof v === 'object' && v.verdict !== 'supported').map((v) => SUPPORT_WORD[v.verdict] || v.verdict)
    const gone = new Set()
    for (const [op, xs] of byOp) {
        const c = cls.get(op)
        if (c === 'ok' || out.replaced.has(op)) continue
        gone.add(op)
        const id = opIdOf(op)
        if (c === 'infra') {
            out.withheld.push(op)
            stats.supportInfra++
            const why = xs.filter((x) => !x.d || panelRetryOf(x.d)).map((x) => (!x.d ? '中止而未判' : (PANEL_WHY_LABELS[x.d.why] || x.d.why)))
            trace.supportOut.push({ op: op.op, id, why: `${SUPPORT_GATE_WHY.infra}（${[...new Set(why)].join('、')}）`, items: itemsOf(xs) })
            log(`${tag}出處覆核[${concept}]：${label(op)} ${SUPPORT_GATE_WHY.infra}（${[...new Set(why)].join('、')}）——${words.infra}`)
            continue
        }
        const decided = xs.filter((x) => x.d?.status === 'decided' && x.d.verdict?.verdict !== 'supported')
        const why = c === 'rejected'
            ? `ES9：${[...new Set(decided.flatMap(reasonsOf))].join('、')}`
            : `ES9：未能判定（${[...new Set(xs.filter((x) => x.d?.status !== 'decided').map((x) => PANEL_WHY_LABELS[x.d?.why || PANEL_WHY.MISSING] || x.d.why))].join('、')}）`
        if (str(op.ref)) out.droppedRefs[str(op.ref)] = `未達檢定標準（${why}）`
        trace.supportOut.push({ op: op.op, id, why, items: itemsOf(xs) })
        if (c === 'rejected') {
            out.rejected.push({ op, why })
            stats.supportRejected++
            log(`${tag}出處覆核[${concept}]：${label(op)} ${why}——${words.rejected}（${xs[0].it.text.slice(0, 60)}）`)
        }
        else {
            out.undetermined.push({ op, notes: [...new Set(xs.flatMap((x) => x.it.notes))] })
            stats.supportUndetermined++
            log(`${tag}出處覆核[${concept}]：${label(op)} ${why}——${words.undetermined}（${xs[0].it.text.slice(0, 60)}）`)
        }
    }
    // 受支持之操作:兩席皆未列為支持之出處——新增出處者移除,既有主張之改寫／合併記入排除集(⑳;呼叫端套用後寫)
    const eff1 = supportByEffects(items, sc.decisions, { batch })
    const revisedOps = new Set(out.replaced.values())
    out.ops = []
    for (const op of ops) {
        if (gone.has(op) || unreadableOps.has(op)) continue
        const r = out.replaced.get(op) || op
        const kept = (revisedOps.has(r) ? eff2?.patched.get(r) : eff1.patched.get(r)) || r
        out.kept.set(op, kept)
        out.ops.push(kept)
    }
    out.exclusions = [...eff1.exclusions.filter((e) => !gone.has(e.op) && !out.replaced.has(e.op)), ...(eff2?.exclusions || []).filter((e) => revisedOps.has(e.op))]
    stats.supportSourcesDropped = eff1.dropped + (eff2?.dropped || 0)
    return out
}

/**
 * 留待之閉包:留待之操作(seed)所定義之 ref 被他操作引用者,引用者一併留待(否則引用者以「所引新項不存在」被拒而遺失);遞迴至不再增加
 *
 * @param {Array} ops 輸入全部操作(原操作;引用以 refsOf 讀)
 * @param {Array} seed 輸入留待之操作
 * @param {Function} refsOf 輸入 (op)=>Array(所引之 ref,不含 @)
 * @returns {Set} 回傳留待之操作集合(含 seed)
 * @example
 * const a = { op: 'add', ref: 'x' }, b = { op: 'dispute_add', sides: [{ claims: ['@x'] }] }
 * console.log(supportHoldClosure([a, b], [a], (op) => (op.sides || []).flatMap((sd) => sd.claims.map((c) => c.slice(1)))).size)
 * // => 2
 */
export function supportHoldClosure(ops, seed, refsOf) {
    const held = new Set(isarr(seed) ? seed : [])
    const refs = new Set([...held].map((op) => str(op?.ref)).filter(Boolean))
    let grew = true
    while (grew) {
        grew = false
        for (const op of isarr(ops) ? ops : []) {
            if (held.has(op) || !refsOf(op).some((r) => refs.has(r))) continue
            held.add(op)
            if (str(op.ref)) refs.add(str(op.ref))
            grew = true
        }
    }
    return held
}

export default { SUPPORT_GATE_WHY, supportClassOfOp, runSupportGate, supportHoldClosure }
