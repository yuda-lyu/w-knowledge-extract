// pending.mjs — 待審裁決:前次終審未明列裁決(或終審失敗)而暫緩之不可逆操作,下次處理該核心時先交終審席逐條裁決
//
// 【為何需要】3+3 之終審(accept)對取代／撤回／合併／拆解須明列裁決;未列或終審失敗者不套用,存入狀態之 pendingReview
//   (runPass 定稿時之 queuePendingReview)——不把未審之不可逆變更套進真理,也不遺失其內容。待審者之「審」由終審席做:
//   同一份裁決提示詞(domain.buildReviewPrompt,mode 'pending'),與 runPass 之終審同一席位、同一規則。
// 【與 runPass 對稱】終審 fix 後再過一次操作守門(可見性、正體)與檢定標準之定稿篩選(standards/opStandards:數字紮根、
//   標注、跨篇、弱證據參數、不提及筆記、外洩——未達者不採,自待審移除並記明);不變式違反逐條剔除——被剔之待審項為確定性違反
//   (重試不會變好),自待審移除並記明;整批不套用會讓同核心其他待審項永遠落不了地、每輪白付一次終審。
// 【出處支持(ES9;workflow/supportGate 之骨架一份,與 runPass 同取)】給了 o.supportCheck(提煉段開啟 extract.standards.supportCheck.enabled 時)→ 定稿篩選後
//   以判定小組覆核改寫之斷言:受支持照套;成立「語氣超出證據」(無「陳述相反」)且種類可改者,先以修訂席(seats.revise)依出處收斂措辭一次 → 操作守門＋
//   納入閘 → 判定小組重判(同一材料)——受支持才以修訂後之操作取代(ES7);修訂不成、未過閘或重判仍不受支持 → 自待審移除並記明;其餘成立不受支持者
//   自待審移除;判不了(兩票可用)→ 留於待審並計 es9Tries,逾 o.supportCheck.maxTries → 不再留待審,改登錄筆記層待判(使用者;heldOps 交呼叫端登錄,
//   ctx 存操作);基礎設施之未成立(缺票、同一供應者、中止)→ 留於待審、不計次(終審 §1 原則 3)。材料不可得之出處照送占位字樣(待審之例外)。
// 【陳舊項】目標已為終態或不存在、或所依出處全數已撤(筆記已刪除)之待審項於本步清除(無則不呼叫 AI、不落盤)。
// 【失敗】終審席失敗 → 不套用、待審保留(下次再裁);截止(給了 shouldStop 時到點或預算耗盡)或斷網 → 回 stopped、不計失敗。
//   呼叫一律經 workflow/aiCall 之 extractAiCall(截止與斷網之歸類只此一份)。

import { applyVerdicts, pendingReviewOps } from './verdicts.mjs'
import { checkInvariants, setExcluded, TERMINAL_OPS, opIdOf } from '../stores/coreState.mjs'
import { queuePendingReview } from '../stores/coreDelta.mjs'
import { createOpStandards, opStandardsCtxOf, applyCtxOf, gateOps } from '../standards/opStandards.mjs'
import { EXTRACT_DEFAULT } from '../core/extractSettings.mjs'
import { applyWithInvariants } from './applyWithInvariants.mjs'
import { runSupportGate, supportHoldClosure, SUPPORT_GATE_WHY } from './supportGate.mjs'
import { refsOf } from './candidates.mjs'
import { parseVerdicts, checkVerdicts } from '../standards/parse.mjs'
import { guardOps } from '../standards/opGuards.mjs'
import { touchedText, rulesTextOf } from './runPass.mjs'
import { callerOf, extractAiCall } from './aiCall.mjs'
import { extractStatInit } from '../logContract.mjs'
import { textValueOf as str, jsonClone as clone } from '../core/capturePackage.mjs'
import { noteTitleFnOf } from '../stores/noteFacts.mjs'


/**
 * 待審裁決之提示詞(終審席;runPending 與評分之待審裁決角色同讀):仍有效之待審操作之出處(含爭議各方之出處)由筆記 id 換成本批代號(與一般差量
 *   同一形狀——終審員對得上【筆記】之代號)→ domain.buildReviewPrompt(mode 'pending')
 *
 * @param {Object} o 輸入 { state, pend(pendingReviewOps 之產物), concept, scope?, batch:[{ code, id, digest }], domain }
 * @returns {Object} 回傳 { ops(送終審之操作,裁決之 i 即此序), prompt }
 * @example
 * need test in nodejs.
 *
 * const prompt = pendingReviewPromptOf({ state, pend: pendingReviewOps(state), concept: '黑洞', batch, domain })
 */
export function pendingReviewPromptOf(o) {
    const { state, pend, concept, domain } = o
    const scope = o.scope || 'concept'
    const batch = Array.isArray(o.batch) ? o.batch : []
    const codeOf = new Map(batch.map((b) => [b.id, b.code]))
    const toCodes = (v) => (Array.isArray(v) ? v.map((id) => codeOf.get(id) || id) : v)
    const ops = pend.ops.map((op) => ({
        ...op, sources: toCodes(op.sources || []),
        ...(Array.isArray(op.sides) ? { sides: op.sides.map((sd) => (sd && typeof sd === 'object' && sd.sources !== undefined ? { ...sd, sources: toCodes(sd.sources) } : sd)) } : {}),
        ...(Array.isArray(op.sides_add) ? { sides_add: op.sides_add.map((sd) => (sd && typeof sd === 'object' && sd.sources !== undefined ? { ...sd, sources: toCodes(sd.sources) } : sd)) } : {}),
    }))
    const touched = touchedText(state, ops)
    const prompt = domain.buildReviewPrompt({ concept, scope, mode: 'pending', ops, batch, touched, rulesText: rulesTextOf(domain, state) })
    return { ops, prompt }
}

/**
 * 待審裁決(終審席,單次呼叫)
 *
 * @param {Object} o 輸入
 * @param {Object} o.state 輸入目前狀態(含 pendingReview)
 * @param {String} o.concept 輸入概念名
 * @param {String} [o.scope='concept'] 輸入 'concept'｜'category'
 * @param {Array} [o.batch=[]] 輸入待審操作所引之筆記 [{ code, id, digest }](出處由筆記 id 換成本批代號,與一般差量同形)
 * @param {Object} o.domain 輸入提煉 domain(rules、claimKinds、limits、evidence、buildReviewPrompt;ES9 另用 buildSupportCheckPrompt、buildSupportRevisePrompt?)
 * @param {Object} o.seats 輸入席位(取 accept;ES9 之語氣超出證據之修訂取 revise——未設即不修訂)
 * @param {Object} o.ai 輸入 AI adapter(getWkf、seatSpec、recordCall)
 * @param {Map} [o.notesById] 輸入筆記 id → 記錄(證據等級重算;ES12 之文件 id)
 * @param {Function} [o.contentOf] 輸入 (noteId)=>出處筆記之內容(內容章＋原文標題＋發布時間)|null(檢定標準 ES2／ES16 之材料;未給則以本批摘要)
 * @param {String} [o.at=''] 輸入時刻
 * @param {Function} [o.keyOf] 輸入概念名正規化
 * @param {Function} [o.shouldStop] 輸入截止判斷(呼叫前檢查;到點即不呼叫、待審保留);給了即截止感知(見 workflow/aiCall)
 * @param {Function} [o.remainingMs] 輸入 ()=>整輪剩餘毫秒數(與 shouldStop 同源)
 * @param {Function} [o.onCall] 輸入每棒回來時之回呼 (entry:{ stage, ok, providerId, ms, error, promptLen, tried }) => void
 * @param {Object} [o.supportCheck] 輸入出處支持覆核(ES9){ seats:{ first, second?, third? }, maxTries?(判不了逾此次數 → 移出待審改登錄使用者待判;預設取設定預設) };未給即不覆核
 * @param {Object} [o.locale] 輸入語言設定(操作守門之正體轉換依之,未給＝臺灣正體)
 * @param {Function} [o.log] 輸入 (line) => void
 * @returns {Promise<Object>} 回傳 { ok, state, applied, rejected, withheld, queued, verdicts(applyVerdicts 之回傳), reviewOps(送終審之操作,裁決之 i 即此序),
 *   overLimit, lengthChecked, pendingDropped, invariantDropped(自待審移除之確定性違反項),
 *   heldOps:[{ op, notes, tries }](覆核判不了逾次而移出待審者;呼叫端登錄筆記層待判),
 *   stats:{ stdRejected(未達檢定標準而自待審移除之數), supportChecked, supportCalls, supportRejected, supportUndetermined, supportInfra, supportWithheld(留於待審之數),
 *     supportUnreadable, supportStopped(中止而未判之項數), supportRevised, supportReviseFailed, supportSourcesDropped }(與 runPass 同形;提煉段逐鍵計入),
 *   trace:{ stdRejected:[{ op, id, problems }], supportRejected:[{ op, id }](成立不受支持而自待審移除;含修訂不成者), supportRevised:[{ op, id }](修訂後受支持而照套) },
 *   noop?(無待審), purged?(清除之陳舊項數), stopped?, error? };失敗(ok:false)一律帶 state(輸入狀態)
 * @example
 * need test in nodejs.
 *
 * const r = await runPending({ state, concept: '黑洞', batch, domain, seats: { accept }, ai })
 * console.log(r.ok)
 */
export async function runPending(o) {
    const { state, concept, domain, seats, ai } = o
    const scope = o.scope || 'concept'
    const batch = Array.isArray(o.batch) ? o.batch : []
    const log = typeof o.log === 'function' ? o.log : () => {}
    // 各棒呼叫之共同參數(workflow/aiCall:到點不送;截止與斷網歸為 stopped、不計失敗)
    const callOpt = { shouldStop: o.shouldStop, remainingMs: o.remainingMs, onCall: o.onCall }
    const pend = pendingReviewOps(state)
    if (!pend.ops.length) {
        if (!pend.stale.length) return { ok: true, noop: true, purged: 0, state, applied: [], rejected: [], withheld: [], queued: 0 }
        // 只剩陳舊項:清除後回傳(呼叫端落盤一次),不呼叫 AI;程式寫入亦驗不變式(ES1:只清待審,條目與已用筆記不動)
        const s = clone(state)
        s.pendingReview = []
        const inv = checkInvariants(state, s, { touched: [] })
        if (inv.length) return { ok: false, error: `不變式違反：${inv.slice(0, 3).join('；')}`, state }
        log(`待審裁決[${concept}]：${pend.stale.length} 項待審之目標已為終態、不存在或所依出處已撤，自待審清除（${pend.stale.slice(0, 3).map((e) => `${e.op?.op}〔${e.op?.id || e.op?.into || ''}〕`).join('、')}）`)
        return { ok: true, noop: true, purged: pend.stale.length, state: s, applied: [], rejected: [], withheld: [], queued: 0 }
    }
    if (!seats?.accept) return { ok: false, error: '未設終審席(settings.extract.ai.accept)', state }
    // 待審操作之出處存的是筆記 id(含爭議各方之出處):換成本批代號,與一般差量同一形狀——終審員對得上【筆記】之代號(pendingReviewPromptOf 一份)
    const { ops, prompt } = pendingReviewPromptOf({ state, pend, concept, scope, batch, domain })
    const r = await extractAiCall(ai, { stage: 'accept', seat: seats.accept, prompt, parse: parseVerdicts, check: checkVerdicts, ...callOpt })
    if (r?.stopped) return { ok: false, error: 'stopped', stopped: true, state }
    if (r?.oversize) return { ok: false, error: '終審席之遞補鏈皆放不下此提示詞', state }
    if (!r?.ok || !r.json) return { ok: false, error: str(r?.error) || '終審失敗', state }
    const av = applyVerdicts({ ops }, r.json.verdicts)
    const unv = new Set(av.unverdicted)
    let delta = { ops: av.delta.ops.map((x) => (unv.has(x._i) && TERMINAL_OPS.includes(x.op) ? { ...x, _withhold: true } : x)) }
    const applyCtx = applyCtxOf(domain, { batch, mode: 'delta', step: 'pending', at: o.at || '', keyOf: o.keyOf, self: concept, droppedRefs: av.droppedRefs, meta: { step: 'pending', reviewed: 'ok', provider: r.providerId || '' } })
    // 終審之 fix 可能改寫文字:套用前再過操作守門(可見性、正體)與檢定標準之定稿篩選(與 runPass 定稿前對稱;standards/opStandards.gateOps 一份)
    const stdRejected = []
    // 檢定標準之材料(ES2／ES16;出處覆核同一份)與納入閘(定稿篩選與修訂後之重篩共用)
    const contentOf = typeof o.contentOf === 'function' ? o.contentOf : (nid) => batch.find((b) => b.id === nid)?.digest ?? null
    const titleOf = noteTitleFnOf(o.notesById)
    const std = createOpStandards(opStandardsCtxOf({ state, batch: applyCtx.batch, contentOf, notesById: o.notesById, applyCtx, domain }))
    const gate = (xs, droppedRefs) => gateOps(xs, { guard: guardOps, state, visible: null, locale: o.locale, std, droppedRefs })
    {
        const g = gate(delta.ops, av.droppedRefs)
        for (const x of g.rejected) {
            if (!x.problems) {
                log(`待審裁決守門[${concept}]：${x.op?.op || '?'} ${x.why[0].replace(/^守門：/, '')}`)
                continue
            }
            stdRejected.push({ op: x.op.op, id: str(x.op.id) || str(x.op.into) || str(x.op.ref), problems: x.why })
            log(`待審裁決未達檢定標準[${concept}]：${x.op.op}${str(x.op.id) ? `〔${str(x.op.id)}〕` : ''}（${x.why.slice(0, 3).join('；')}）——自待審移除`)
        }
        applyCtx.droppedRefs = { ...av.droppedRefs, ...g.droppedRefs }
        delta = { ops: g.ops }
    }
    // 出處支持之覆核(檢定標準 ES9;workflow/supportGate 一份——待審含終審失敗而暫緩之大幅改寫與 resolved,終審之 fix 亦可改寫文字):
    //   受支持照套;成立不受支持 → 自待審移除並記明;判不了 → 留於待審並計 es9Tries(逾 maxTries → 移出、交呼叫端登錄使用者待判);
    //   基礎設施未成立(含中止)→ 留於待審、不計次;材料不可得之出處照送占位字樣(待審之例外)
    const supportRejected = []
    const supportRevised = []
    const heldOps = []
    // 統計與 runPass 同形(supportGate 之全部鍵＋納入閘之不採數＋留於待審數;提煉段逐鍵計入本輪統計)
    const stats = extractStatInit(['stdRejected', 'supportChecked', 'supportCalls', 'supportRejected', 'supportUndetermined', 'supportInfra', 'supportWithheld', 'supportUnreadable', 'supportStopped', 'supportRevised', 'supportReviseFailed', 'supportSourcesDropped'])
    // 出處排除集(⑳):受支持之改寫／合併,兩席皆未列為支持之既有出處——套用後記入(同 runPass)
    let supportExclusions = []
    if (o.supportCheck?.seats?.first && typeof domain.buildSupportCheckPrompt === 'function') {
        const maxTries = Number.isInteger(o.supportCheck.maxTries) && o.supportCheck.maxTries > 0 ? o.supportCheck.maxTries : EXTRACT_DEFAULT.standards.supportCheck.maxTries
        const sg = await runSupportGate({
            ops: delta.ops, state, batch: applyCtx.batch, concept, domain, seats: { check: o.supportCheck.seats, revise: seats.revise }, contentOf, titleOf,
            gate: (xs) => gate(xs, applyCtx.droppedRefs), call: callerOf(ai, callOpt),
            log, tag: '待審裁決', words: { rejected: '自待審移除', undetermined: '留於待審', infra: '留於待審' }, allowPlaceholder: true,
        })
        Object.assign(stats, sg.stats)
        for (const x of sg.rejected) supportRejected.push({ op: x.op.op, id: opIdOf(x.op) })
        for (const [op] of sg.replaced) supportRevised.push({ op: op.op, id: opIdOf(op) })
        supportExclusions = sg.exclusions
        // 留待之閉包:基礎設施未成立者與引用其 ref 者留於待審;判不了者計次(逾次 → 移出待審,改登錄使用者待判);本批代號換回筆記 id 由 applyDelta 之暫緩處理
        const held = supportHoldClosure([...sg.kept.keys()], sg.withheld, refsOf)
        stats.supportWithheld = held.size
        const undet = new Map(sg.undetermined.map((x) => [x.op, x.notes]))
        delta = { ops: delta.ops.flatMap((op) => {
            if (held.has(op)) return [{ ...op, _withhold: true, _withholdReason: SUPPORT_GATE_WHY.infra }]
            if (undet.has(op)) {
                const e = Number.isInteger(op._i) ? pend.entries[op._i] : null
                const n = (Number(e?.es9Tries) || 0) + 1
                if (n >= maxTries) {
                    heldOps.push({ op: pend.ops[op._i] || op, notes: undet.get(op), tries: n })
                    log(`待審裁決出處覆核[${concept}]：${op.op}${opIdOf(op) ? `〔${opIdOf(op)}〕` : ''} 覆核判不了已 ${n} 次（上限 ${maxTries}）——移出待審，改登錄使用者待判（ES9）`)
                    return []
                }
                return [{ ...op, _withhold: true, _withholdEs9: true, _withholdReason: '出處支持覆核判不了' }]
            }
            return sg.kept.has(op) ? [sg.kept.get(op)] : []
        }) }
    }
    // 套用＋尾端寫入(待審重存、出處排除集、證據重算)＋不變式(違反者逐條剔除;workflow/applyWithInvariants 一份):被剔之待審項為確定性違反,
    //   自待審移除(finish 重設 pendingReview,只重存未裁決者),重試不會變好
    const finish = (ap) => {
        let s = ap.state
        s.pendingReview = []
        const queued = ap.withheld.filter((w) => w.resolved)
        let pendingDropped = []
        if (queued.length) {
            const q = queuePendingReview(s, queued, { at: o.at || '', reason: '終審未裁決', prev: state.pendingReview })
            s = q.state
            pendingDropped = q.dropped
        }
        // 出處排除集(⑳):只對實際套用之改寫／合併
        if (supportExclusions.length) {
            const appliedIds = new Set(ap.applied.filter((a) => a.op === 'revise' || a.op === 'merge').map((a) => a.id))
            s = setExcluded(s, supportExclusions.filter((e) => appliedIds.has(e.id)).map((e) => ({ id: e.id, ids: e.ids, std: 'ES9' })), { at: o.at || '' }).state
        }
        if (o.notesById instanceof Map && domain.evidence?.apply) domain.evidence.apply(s, o.notesById)
        return { state: s, queued, pendingDropped }
    }
    const res = applyWithInvariants(state, delta.ops, applyCtx, {
        finish,
        onDropped: (dropped, firstInv) => {
            log(`待審裁決不變式[${concept}]：${firstInv.slice(0, 3).join('；')}——逐條剔除違反之操作`)
            for (const d of dropped) log(`待審裁決剔除[${concept}]：${d.op}${d.id ? `〔${d.id}〕` : ''}（${d.inv}）——確定性違反，自待審移除`)
        },
    })
    if (!res.ok) return { ok: false, error: `不變式違反：${res.inv.slice(0, 3).join('；')}`, state }
    const ap = res.ap
    const invariantDropped = res.dropped.map(({ raw, ...d }) => d)
    stats.stdRejected = stdRejected.length
    return { ok: true, state: res.state, applied: ap.applied, rejected: ap.rejected, withheld: ap.withheld, queued: res.queued.length, pendingDropped: res.pendingDropped.length, pendingDroppedOps: res.pendingDropped, verdicts: av, reviewOps: ops, overLimit: ap.overLimit || 0, lengthChecked: ap.lengthChecked || 0, invariantDropped, heldOps, stats, trace: { stdRejected, supportRejected, supportRevised } }
}

export default runPending
