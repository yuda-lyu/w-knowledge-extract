// supportStockPass.mjs — 出處支持之存量覆核專步(檢定標準 ES9 存量):既有有效主張逐條交判定小組判是否仍受其存活出處支持
//   → 記錄、依出處收斂措辭、撤回、或隔離待判
//
// 【流程】受檢主張(呼叫端以 stockNeedsOf／pickStock 選定之 ids)→ 斷言＝主張文字＋條件＋期間、出處＝存活出處 → runSupportCheck(兩席＋第三席)→ 逐項:
//   成立 supported → pass(隔離中者解除)
//   成立不受支持:可修訂(含 overclaim、無 contradicted)→ 修訂席依出處收斂措辭 → 納入閘 → 判定小組重判:受支持 → revise 落地＋pass;否則撤回
//                不可修訂 → 撤回(理由「覆核無出處支持」,PROGRAM_RETRACT_REASONS;使用者複核後可以 ops/reviveClaims 還原)
//   未成立:不確定／不一致／材料過大(單項已超過席位可容) → 隔離(held,記當下雜湊)＋待判(使用者);缺票／同一供應者 → 重試(呼叫端記次,逾限轉隔離＋待判)
//   材料不可得(任一存活出處之內容讀不到)→ 不送審、不計次、不隔離(維護段修復 md 後下輪再排;另計 stockUnreadable)
// 【全部受檢項皆缺票或同一供應者】專步層之失敗(回 ok:false;呼叫端退避;不逐項計次——四個判定小組專步同一規則,見 standards/panelVotes)。
// 【中止】已判之頁照處置,未判之項本輪不動(不計次;回 ok:true、stopped:true、undecided);無任何已判者 → ok:false、stopped(既有路徑)。
// 【寫入】一份程式差量(revise／retract;applyDelta ctx.program)→ 隔離與解除(記帳欄位;解除只對實際落地之修訂與受支持者)→ 出處排除集(⑳;受支持而兩席
//   皆未列為支持之出處,以本次結果取代)→ 證據重算 → 不變式(touched＝差量所觸及;違反者逐條剔除後重套——workflow/applyWithInvariants;被剔者不記檢核,下輪重檢)。
// 【截止】任一席截止、額度中止或斷網 → 回 stopped(不套用、不記次);呼叫經 workflow/aiCall 之 callerOf(單棒 extractAiCall)。

import { TERMINAL_STATUSES, findItem, holdItems, releaseHeld, liveSourcesOf, withdrawnOf, setExcluded } from '../stores/coreState.mjs'
import { createOpStandards, opStandardsCtxOf, applyCtxOf, gateOps } from '../standards/opStandards.mjs'
import { applyWithInvariants } from './applyWithInvariants.mjs'
import { guardOps } from '../standards/opGuards.mjs'
import { panelSeats } from '../core/summarizePackage.mjs'
import { STATUS, textValueOf as str, textListOf as strs } from '../core/capturePackage.mjs'
import { ES9, SUPPORT_WORD, claimAssertion, runSupportCheck, supportCheckCallOf } from '../standards/supportCheck.mjs'
import { noteTitleFnOf } from '../stores/noteFacts.mjs'
import { revisableOf, notSupportedReasonsOf, runSupportRevise, parseSupportRevise, checkSupportRevise } from '../standards/supportRevise.mjs'
import { EXTRACT_API_HINT } from '../stores/extractHolds.mjs'
import { stockHashOf } from '../standards/supportStock.mjs'
import { panelRetryOf, panelWhyLabelOf, voteTextOf } from '../standards/panelVotes.mjs'
import { callerOf } from './aiCall.mjs'
import { extractStatInit } from '../logContract.mjs'


/**
 * 出處支持之存量覆核專步
 *
 * @param {Object} o 輸入
 * @param {Object} o.state 輸入目前狀態
 * @param {String} o.concept 輸入概念名
 * @param {Array} o.ids 輸入受檢之主張 id(呼叫端選定並截至本輪上限)
 * @param {Object} o.domain 輸入提煉 domain(buildSupportCheckPrompt、buildSupportRevisePrompt?、claimKinds、limits、evidence、weakEvidence)
 * @param {Object} o.seats 輸入覆核席 { first, second, third? }(settings.extract.standards.ai)
 * @param {Object} [o.reviseSeat] 輸入修訂席(settings.extract.ai.revise;未給即不修訂,不受支持者一律撤回)
 * @param {Object} o.ai 輸入 AI adapter(getWkf、seatSpec、recordCall)
 * @param {Map} [o.notesById] 輸入筆記 id → 記錄
 * @param {Function} [o.contentOf] 輸入 (noteId)=>出處筆記之內容|null
 * @param {Function} [o.keyOf] 輸入 (noteId)=>內容鍵(雜湊用)
 * @param {String} [o.at=''] 輸入時刻
 * @param {Function} [o.shouldStop] 輸入截止判斷
 * @param {Function} [o.remainingMs] 輸入 ()=>整輪剩餘毫秒數
 * @param {Function} [o.onCall] 輸入每棒回來時之回呼
 * @param {Object} [o.locale] 輸入語言設定(操作守門之正體轉換依之,未給＝臺灣正體)
 * @param {Function} [o.log] 輸入 (line) => void
 * @returns {Promise<Object>} 回傳 { ok, noop?, state, applied, rejected, stats, checks:[{ id, hash, status, seats, reason }], held:[{ id, why, detail }],
 *   retry:Array(id), released:Array(id), undecided:Array(id;中止而未判), unreadable:Array(id;材料不可得而未送審), stopped?, error? }
 * @example
 * need test in nodejs.
 *
 * const r = await runSupportStockPass({ state, concept: '黑洞', ids: ['C1'], domain, seats: { first, second, third }, ai })
 * console.log(r.decided, r.retry)
 */
export async function runSupportStockPass(o) {
    const { state, concept, domain, seats, ai } = o
    const log = typeof o.log === 'function' ? o.log : () => {}
    const at = str(o.at)
    const keyOf = typeof o.keyOf === 'function' ? o.keyOf : () => ''
    const stats = extractStatInit(['stockChecked', 'stockSupported', 'stockRevised', 'stockRetracted', 'stockHeld', 'stockRetry', 'stockCalls', 'stockUnreadable'])
    const W = withdrawnOf(state)
    const claims = (Array.isArray(o.ids) ? o.ids : []).map((id) => findItem(state, str(id))).filter((h) => h?.key === 'claims' && !TERMINAL_STATUSES.includes(h.item.status))
    const items0 = claims.map((h) => ({ key: h.item.id, op: null, kind: 'claim', claim: h.item, text: claimAssertion(h.item), basis: str(h.item.basis), notes: liveSourcesOf(h.item, state, W) })).filter((it) => it.notes.length)
    const contentOf = typeof o.contentOf === 'function' ? o.contentOf : () => null
    // 材料不可得(任一存活出處之內容讀不到)→ 不送審、不計次、不隔離
    const unreadable = items0.filter((it) => it.notes.some((n) => contentOf(n) === null || contentOf(n) === undefined)).map((it) => it.key)
    const items = items0.filter((it) => !unreadable.includes(it.key))
    stats.stockUnreadable = unreadable.length
    if (unreadable.length) log(`出處支持存量覆核[${concept}]：${unreadable.length} 條主張之出處內容讀不到（〔${unreadable.slice(0, 5).join('〕〔')}〕），本輪不送審、不計次`)
    const empty = { state, applied: [], rejected: [], stats, checks: [], held: [], retry: [], released: [], undecided: [], unreadable }
    if (!items.length) return { ok: true, noop: true, ...empty }
    if (typeof domain.buildSupportCheckPrompt !== 'function') return { ok: false, error: 'domain 未提供 buildSupportCheckPrompt（出處支持覆核停用）', ...empty }
    if (!seats?.first) return { ok: false, error: '未設覆核席(settings.extract.standards.ai.first)', ...empty }
    const call = callerOf(ai, { shouldStop: o.shouldStop, remainingMs: o.remainingMs, onCall: o.onCall })
    const titleOf = noteTitleFnOf(o.notesById)
    const checkCall = supportCheckCallOf(call)
    const sc = await runSupportCheck({ items, concept, contentOf, titleOf, buildPrompt: domain.buildSupportCheckPrompt, seats, call: checkCall })
    stats.stockCalls += sc.calls
    // 中止:已判之頁照處置、未判之項本輪不動;無任何已判者即中止(不套用、不記次)
    const undecided = new Set(sc.stopped ? sc.undecided : [])
    const judged = items.filter((it) => !undecided.has(it.key))
    if (sc.stopped && !judged.length) return { ok: false, error: 'stopped', stopped: true, ...empty }
    stats.stockChecked = judged.length
    if (judged.every((it) => panelRetryOf(sc.decisions.get(it.key)))) {
        return { ok: false, error: '出處支持存量覆核（ES9）未完成：全部受檢項皆缺票或同一供應者（各席皆未回、回覆不合格、席位未設或提示詞放不下、兩票成交於同一供應者）', ...empty, retry: judged.map((it) => it.key) }
    }
    const hashOf = (c) => stockHashOf(c, liveSourcesOf(c, state, W), keyOf)
    const checks = []
    const held = []
    const retry = []
    const supported = []
    const toRevise = []
    const toRetract = []
    // 出處排除集(⑳):受支持時,兩席皆未列為支持之出處(有票未分別 → 清空)
    const excl = []
    const exclOf = (id, notes, d) => excl.push({ id, ids: Array.isArray(d?.supportBy) ? notes.filter((n) => !d.supportBy.includes(n)) : [] })
    let stopped = sc.stopped
    for (const it of judged) {
        const d = sc.decisions.get(it.key)
        if (d?.status === 'decided' && d.verdict.verdict === 'supported') {
            supported.push(it.key)
            exclOf(it.key, it.notes, d)
            checks.push({ id: it.key, hash: hashOf(it.claim), status: STATUS.PASS, seats: panelSeats(d.votes), reason: str(d.verdict.reason).slice(0, 200) })
            continue
        }
        if (d?.status === 'decided') {
            if (o.reviseSeat && typeof domain.buildSupportRevisePrompt === 'function' && revisableOf(d)) toRevise.push({ it, d })
            else toRetract.push({ it, d })
            continue
        }
        if (panelRetryOf(d)) {
            retry.push(it.key)
            stats.stockRetry++
            log(`出處支持存量覆核[${concept}]：〔${it.key}〕未成立（${panelWhyLabelOf(d?.why)}）——下輪重試`)
            continue
        }
        held.push({ id: it.key, why: d.why, detail: voteTextOf(d), hash: hashOf(it.claim) })
        checks.push({ id: it.key, hash: hashOf(it.claim), status: STATUS.UNDETERMINED, seats: panelSeats(d.votes), reason: `${panelWhyLabelOf(d.why)}：${voteTextOf(d)}`.slice(0, 200) })
        // (待判登錄之 ctx.hash＝受檢雜湊:使用者豁免後素材未變即不重登;終審 §3 D5e)
        log(`出處支持存量覆核[${concept}]：〔${it.key}〕判不了（${panelWhyLabelOf(d.why)}）——隔離、待判（使用者）：${voteTextOf(d).slice(0, 160)}`)
    }
    // 語氣超出證據:依出處收斂措辭 → 納入閘 → 重判(受支持才採;一輪為限);修訂席或重判中止 → 該些主張本輪不動(不撤回)
    const reviseOps = []
    if (toRevise.length) {
        const targets = toRevise.map((x) => ({ it: x.it, d: x.d, fields: { text: str(x.it.claim.text), conditions: strs(x.it.claim.conditions), period: str(x.it.claim.period) } }))
        const rv = await runSupportRevise({ targets, concept, contentOf, titleOf, buildPrompt: domain.buildSupportRevisePrompt, call: (stage, seat, prompt) => call(stage, seat, prompt, parseSupportRevise, checkSupportRevise), seat: o.reviseSeat })
        stats.stockCalls += rv.calls
        if (rv.stopped) {
            stopped = true
            for (const x of toRevise) undecided.add(x.it.key)
            toRevise.length = 0
        }
        const applyCtx = applyCtxOf(domain, { batch: [], mode: 'delta', step: 'support', program: true, onlyOps: ['revise'], at, self: concept })
        const std = createOpStandards(opStandardsCtxOf({ state, batch: [], contentOf, notesById: o.notesById, applyCtx, domain }))
        const gated = []
        for (const x of toRevise) {
            const fix = rv.fixes.get(x.it.key)
            if (!fix) {
                toRetract.push(x)
                continue
            }
            const op0 = { op: 'revise', id: x.it.key, reason: `依出處收斂措辭（ES9 存量覆核：${notSupportedReasonsOf(x.d).join('；').slice(0, 80)}）`, fields: { text: fix.text, ...(fix.conditions !== undefined ? { conditions: fix.conditions } : {}), ...(fix.period !== undefined ? { period: fix.period } : {}) } }
            // 操作守門(正體只轉違規處,ES3)→ 納入閘(ES2／ES4／ES17／外洩…;standards/opStandards.gateOps 一份)
            const g = gateOps([op0], { guard: guardOps, state, locale: o.locale, std })
            if (!g.ops.length) {
                log(`出處支持存量覆核[${concept}]：〔${x.it.key}〕修訂後未過納入閘（${g.rejected.flatMap((y) => y.why).slice(0, 2).join('；')}）——撤回`)
                toRetract.push(x)
                continue
            }
            const f = g.ops[0].fields
            const merged = { ...x.it.claim, text: f.text, ...(f.conditions !== undefined ? { conditions: f.conditions } : {}), ...(f.period !== undefined ? { period: f.period } : {}) }
            gated.push({ x, op: g.ops[0], merged })
        }
        if (gated.length) {
            const items2 = gated.map((g) => ({ key: g.x.it.key, op: g.op, kind: 'claim', text: claimAssertion(g.merged), basis: str(g.merged.basis), notes: g.x.it.notes }))
            const sc2 = await runSupportCheck({ items: items2, concept, contentOf, titleOf, buildPrompt: domain.buildSupportCheckPrompt, seats, call: checkCall })
            stats.stockCalls += sc2.calls
            if (sc2.stopped) stopped = true
            for (const g of gated) {
                const d2 = sc2.decisions.get(g.x.it.key)
                if (sc2.stopped && sc2.undecided.includes(g.x.it.key)) {
                    undecided.add(g.x.it.key)
                    continue
                }
                if (d2?.status === 'decided' && d2.verdict.verdict === 'supported') {
                    reviseOps.push(g.op)
                    exclOf(g.x.it.key, g.x.it.notes, d2)
                    checks.push({ id: g.x.it.key, hash: stockHashOf(g.merged, g.x.it.notes, keyOf), status: STATUS.PASS, seats: panelSeats(d2.votes), reason: `修訂後受支持：${str(d2.verdict.reason)}`.slice(0, 200) })
                    log(`出處支持存量覆核[${concept}]：〔${g.x.it.key}〕語氣超出證據——依出處收斂措辭後兩席判受支持（${str(g.merged.text).slice(0, 60)}）`)
                }
                else toRetract.push(g.x)
            }
        }
    }
    const retractOps = []
    for (const x of toRetract) {
        retractOps.push({ op: 'retract', id: x.it.key, reason: '覆核無出處支持', note: `兩席覆核：${notSupportedReasonsOf(x.d).join('；').slice(0, 160)}` })
        checks.push({ id: x.it.key, hash: hashOf(x.it.claim), status: STATUS.VIOLATION, seats: panelSeats(x.d.votes), reason: notSupportedReasonsOf(x.d).join('；').slice(0, 200) })
        log(`出處支持存量覆核[${concept}]：〔${x.it.key}〕兩席判不受出處支持（${[...new Set((x.d.votes || []).map((v) => v.verdict).filter((v) => v && typeof v === 'object' && v.verdict !== 'supported').map((v) => SUPPORT_WORD[v.verdict] || v.verdict))].join('、')}）——撤回（可還原：${EXTRACT_API_HINT.revive}）`)
    }
    // 寫入:程式差量 → 隔離 → 解除(受支持者、實際落地之修訂)→ 出處排除集 → 證據重算,皆於同一次套用之尾端;不變式違反者逐條剔除
    //   (被剔之修訂／撤回不落地、不記檢核,下輪重檢)
    const ops = [...reviseOps, ...retractOps]
    const finish = (ap) => {
        let s = ap.state
        const done = new Set(ap.applied.map((a) => a.id))
            if (held.length) s = holdItems(s, held.map((h) => ({ id: h.id, std: ES9.std, why: `兩席覆核未能判定（${panelWhyLabelOf(h.why)}）`, hash: h.hash })), { at }).state
        // 解除隔離:受支持者、與實際落地之修訂(被拒或被剔之修訂仍隔離——其重判對象是未落地之文字)
        const rel = releaseHeld(s, supported.concat(reviseOps.filter((op) => done.has(op.id)).map((op) => op.id)))
        s = rel.state
        // 出處排除集:受支持者、與實際落地之修訂
        const ex = setExcluded(s, excl.filter((e) => supported.includes(e.id) || done.has(e.id)).map((e) => ({ ...e, std: ES9.std })), { at })
        s = ex.state
        if (o.notesById instanceof Map && domain.evidence?.apply) domain.evidence.apply(s, o.notesById)
        return { state: s, released: rel.released, excluded: ex.changed }
    }
    const res = applyWithInvariants(state, ops, { ...applyCtxOf(domain, { batch: [], mode: 'delta', step: 'support', program: true, onlyOps: ['revise', 'retract'], at, self: concept, meta: { std: 'ES9', pass: 'stock' } }) }, { finish })
    if (!res.ok) return { ok: false, error: `不變式違反：${res.inv.slice(0, 3).join('；')}`, ...empty }
    const ap = res.ap
    const s = res.state
    const done = new Set(ap.applied.map((a) => a.id))
    // 落地之修訂:檢核雜湊以套用後之條目重算(applyDelta 會改文字——正體、〔〕連結;以送審文字算之雜湊下輪必判須重檢;E-2)
    const revisedIds = new Set(reviseOps.filter((op) => done.has(op.id)).map((op) => op.id))
    for (const c of checks) {
        if (!revisedIds.has(c.id)) continue
        const cur = findItem(s, c.id)?.item
        if (cur) c.hash = stockHashOf(cur, liveSourcesOf(cur, s, withdrawnOf(s)), keyOf)
    }
    for (const d of res.dropped) log(`出處支持存量覆核[${concept}]：${d.op}〔${d.id}〕違反不變式（${d.inv}）——不落地、不記檢核（下輪重檢）`)
    for (const x of ap.rejected) log(`出處支持存量覆核[${concept}]：${x.op}〔${str(x.id) || str(ops[x.index]?.id)}〕拒收（${x.reason}）`)
    if (res.excluded.length) log(`出處支持存量覆核[${concept}]：${res.excluded.length} 條主張之出處排除集更新（兩席皆未列為支持之出處不計證據；〔${res.excluded.slice(0, 5).join('〕〔')}〕）`)
    stats.stockExcluded = res.excluded.length
    const rel = { released: res.released }
    stats.stockSupported = supported.length
    stats.stockRevised = reviseOps.filter((op) => done.has(op.id)).length
    stats.stockRetracted = retractOps.filter((op) => done.has(op.id)).length
    stats.stockHeld = held.length
    // 套用被拒之撤回或修訂:不記檢核結果(下輪重檢);中止而未判者不記、不計次
    const okIds = new Set([...supported, ...held.map((h) => h.id), ...done].filter((id) => !undecided.has(id)))
    if (stopped) log(`出處支持存量覆核[${concept}]：中止，已判 ${judged.length - undecided.size} 條照處置、未判 ${undecided.size} 條留待下輪`)
    return { ok: true, state: s, applied: ap.applied, rejected: ap.rejected, stats, checks: checks.filter((c) => okIds.has(c.id)), held, retry, released: rel.released, undecided: [...undecided], unreadable, ...(stopped ? { stopped: true } : {}) }
}

export default runSupportStockPass
