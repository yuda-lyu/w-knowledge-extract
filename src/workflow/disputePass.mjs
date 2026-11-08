// disputePass.mjs — 爭議覆核專步(檢定標準 ES14):終審存疑之未解決爭議,到期者交判定小組判是否真對立 → 存疑結案、拆解、或待判
//
// 【流程】到期項(呼叫端以 disputeDueOf 選定之 ids)→ 受檢項(disputeItemsOf)→ runDisputeCheck(兩席並行＋第三席)→ 逐項處置:
//   成立「對立」→ 狀態之 doubtChecks 記錄(存疑結案;爭議本身逐欄不變——終審之存疑仍留沿革,渲染加註覆核結果)
//   成立「非對立」→ 依序以第一、二、三席之拆解欄位組 dispute_dissolve → 操作守門(正體轉換,ES3)＋同一納入閘(opStandards.screen:ES4／ES17／外洩…)
//       → 取第一個過閘者;皆不過(或皆無拆解欄位)→ 不拆解、待判(使用者;附各票)
//   未成立:不確定／不一致／材料過大 → 待判(使用者);缺票／同一供應者 → 重試(呼叫端記次,逾限轉待判)
//   材料不可得(任一方出處之內容讀不到)→ 不送審、不計次、不待判(另計 disputeUnreadable)
// 【全部受檢項皆缺票或同一供應者】專步層之失敗(回 ok:false;呼叫端退避)——未收到任何可用之兩票是額度、故障或席位配置之問題,
//   逐項計次會把基礎設施之失敗轉成使用者之待判(standards/panelVotes 之 panelRetryOf;四個判定小組專步同一規則)。
// 【中止】已判之頁照處置,未判之項本輪不動(回 ok:true、stopped:true、undecided);無任何已判者 → ok:false、stopped。
// 【寫入】全部拆解一份差量、一次套用(delta 模式、只收 dispute_dissolve;不動 lastConsolidated);doubtChecks 為記帳欄位(非條目),於同一次套用之尾端寫入。
//   套用後驗不變式(touched＝拆解所觸及);違反者逐條剔除後重套(workflow/applyWithInvariants;五個 pass 同一份)——被剔之拆解 → 待判(使用者;invariant-rejected)。
// 【截止】任一席截止、額度中止或斷網 → 回 stopped(不套用、不記次);呼叫經 workflow/aiCall 之 callerOf(單棒 extractAiCall)。

import { createOpStandards, opStandardsCtxOf, applyCtxOf, gateOps } from '../standards/opStandards.mjs'
import { applyWithInvariants } from './applyWithInvariants.mjs'
import { guardOps } from '../standards/opGuards.mjs'
import { panelSeats } from '../core/summarizePackage.mjs'
import { ES14, DISPUTE_WORD, disputeItemsOf, disputeHashOf, dissolveOpOf, runDisputeCheck, parseDisputeChecks, checkDisputeChecks } from '../standards/disputeCheck.mjs'
import { panelRetryOf, panelWhyLabelOf, voteTextOf } from '../standards/panelVotes.mjs'
import { callerOf } from './aiCall.mjs'
import { extractStatInit } from '../logContract.mjs'
import { textValueOf as str } from '../core/capturePackage.mjs'
import { producedMetaOf } from '../core/producedChain.mjs'
import { noteTitleFnOf } from '../stores/noteFacts.mjs'


/**
 * 爭議覆核專步
 *
 * @param {Object} o 輸入
 * @param {Object} o.state 輸入目前狀態
 * @param {String} o.concept 輸入概念名
 * @param {Array} o.ids 輸入到期之爭議 id(呼叫端 disputeDueOf 選定並截至本輪上限)
 * @param {Object} o.domain 輸入提煉 domain(buildDisputeCheckPrompt、rules、claimKinds、limits、evidence、weakEvidence)
 * @param {Object} o.seats 輸入覆核席 { first, second, third? }(settings.extract.standards.ai)
 * @param {Object} o.ai 輸入 AI adapter(getWkf、seatSpec、recordCall)
 * @param {Map} [o.notesById] 輸入筆記 id → 記錄(標題;證據重算;ES12 之文件 id)
 * @param {Function} [o.contentOf] 輸入 (noteId)=>出處筆記之內容(內容章＋原文標題＋發布時間)|null
 * @param {Function} [o.noteKeyOf] 輸入 (noteId)=>內容鍵(覆核結案與待判之素材雜湊;未給視為 '')
 * @param {String} [o.at=''] 輸入時刻
 * @param {Function} [o.keyOf] 輸入概念名正規化
 * @param {Function} [o.shouldStop] 輸入截止判斷;給了即截止感知
 * @param {Function} [o.remainingMs] 輸入 ()=>整輪剩餘毫秒數
 * @param {Function} [o.onCall] 輸入每棒回來時之回呼 (entry:{ stage, ok, providerId, ms, error, tried }) => void
 * @param {Function} [o.producedOf] 輸入 () => produced|null:各棒完成後、套用前呼叫一次,回傳寫入該版 changelog 之產出鏈(未給或回 null 即不寫)
 * @param {Object} [o.locale] 輸入語言設定(操作守門之正體轉換依之,未給＝臺灣正體)
 * @param {Function} [o.log] 輸入 (line) => void
 * @returns {Promise<Object>} 回傳 { ok, noop?, state, applied, rejected, stats, held:[{ id, why, detail }], retry:Array(id), decided:Array(id), undecided:Array(id;中止而未判),
 *   unreadable:Array(id;材料不可得而未送審), stopped?, error? }
 * @example
 * need test in nodejs.
 *
 * const r = await runDisputePass({ state, concept: '黑洞', ids: ['D1'], domain, seats: { first, second, third }, ai })
 * console.log(r.decided, r.retry)
 */
export async function runDisputePass(o) {
    const { state, concept, domain, seats, ai } = o
    const log = typeof o.log === 'function' ? o.log : () => {}
    const at = str(o.at)
    const stats = extractStatInit(['disputeChecked', 'disputeOpposed', 'disputeDissolved', 'disputeHeld', 'disputeRetry', 'disputeStdRejected', 'disputeCalls', 'disputeUnreadable'])
    const contentOf = typeof o.contentOf === 'function' ? o.contentOf : () => null
    const noteKeyOf = typeof o.noteKeyOf === 'function' ? o.noteKeyOf : () => ''
    const items0 = disputeItemsOf(state, Array.isArray(o.ids) ? o.ids : [])
    // 材料不可得(任一方出處之內容讀不到)→ 不送審、不計次、不待判
    const unreadable = items0.filter((it) => it.notes.some((n) => contentOf(n) === null || contentOf(n) === undefined)).map((it) => it.key)
    const items = items0.filter((it) => !unreadable.includes(it.key))
    stats.disputeUnreadable = unreadable.length
    if (unreadable.length) log(`爭議覆核[${concept}]：${unreadable.length} 則爭議之出處內容讀不到（〔${unreadable.slice(0, 5).join('〕〔')}〕），本輪不送審、不計次`)
    const empty = { state, applied: [], rejected: [], stats, held: [], retry: [], decided: [], undecided: [], unreadable }
    if (!items.length) return { ok: true, noop: true, ...empty }
    if (typeof domain.buildDisputeCheckPrompt !== 'function') return { ok: false, error: 'domain 未提供 buildDisputeCheckPrompt（爭議覆核停用）', state, stats }
    if (!seats?.first) return { ok: false, error: '未設覆核席(settings.extract.standards.ai.first)', state, stats }
    const call = callerOf(ai, { parse: parseDisputeChecks, check: checkDisputeChecks, shouldStop: o.shouldStop, remainingMs: o.remainingMs, onCall: o.onCall })
    const boundary = str((Array.isArray(domain.rules) ? domain.rules : []).find((r) => r?.id === 'disputeBoundary')?.text)
    const rc = await runDisputeCheck({
        items, concept, contentOf, titleOf: noteTitleFnOf(o.notesById), seats,
        buildPrompt: (p) => domain.buildDisputeCheckPrompt({ ...p, ...(boundary ? { boundary } : {}) }),
        call,
    })
    stats.disputeCalls = rc.calls
    // 中止:已判之頁照處置、未判之項本輪不動;無任何已判者即中止
    const undecided = new Set(rc.stopped ? rc.undecided : [])
    const judged = items.filter((it) => !undecided.has(it.key))
    if (rc.stopped && !judged.length) return { ok: false, error: 'stopped', stopped: true, state, stats }
    stats.disputeChecked = judged.length
    if (judged.every((it) => panelRetryOf(rc.decisions.get(it.key)))) {
        return { ok: false, error: '爭議覆核（ES14）未完成：全部受檢項皆缺票或同一供應者（各席皆未回、回覆不合格、席位未設或提示詞放不下、兩票成交於同一供應者）', state, stats, retry: judged.map((it) => it.key) }
    }
    const applyCtx = applyCtxOf(domain, { batch: [], mode: 'delta', step: 'dispute', onlyOps: ['dispute_dissolve'], at, keyOf: o.keyOf, self: concept, meta: producedMetaOf(o.producedOf) })
    const std = createOpStandards(opStandardsCtxOf({ state, batch: [], contentOf, notesById: o.notesById, applyCtx, domain }))
    const held = []
    const retry = []
    const decided = []
    const opposed = []
    const ops = []
    for (const it of judged) {
        const d = rc.decisions.get(it.key)
        if (d?.status !== 'decided') {
            if (panelRetryOf(d)) {
                retry.push(it.key)
                stats.disputeRetry++
                log(`爭議覆核[${concept}]：〔${it.key}〕未成立（${panelWhyLabelOf(d?.why)}）——下輪重試`)
            }
            else {
                held.push({ id: it.key, why: d.why, detail: voteTextOf(d), hash: disputeHashOf(it.dispute, noteKeyOf) })
                stats.disputeHeld++
                log(`爭議覆核[${concept}]：〔${it.key}〕判不了（${panelWhyLabelOf(d.why)}）——待判（使用者）：${voteTextOf(d).slice(0, 200)}`)
            }
            continue
        }
        if (d.verdict.verdict === 'opposed') {
            opposed.push({ it, d })
            decided.push(it.key)
            stats.disputeOpposed++
            log(`爭議覆核[${concept}]：〔${it.key}〕兩席判真對立——存疑結案（${str(d.verdict.reason).slice(0, 80)}）`)
            continue
        }
        // 非對立:依序以成立之各票之拆解欄位組操作,取第一個過閘者
        const cands = (d.votes || []).map((v) => v.verdict).filter((v) => v && typeof v === 'object' && v.verdict !== 'opposed').map((v) => dissolveOpOf(it, v, domain.claimKinds)).filter(Boolean)
        let chosen = null
        const fails = []
        for (const op0 of cands) {
            // 操作守門(正體:只轉文字欄之違規處——拆解所生主張之標注亦同;ES3)→ 納入閘(standards/opStandards.gateOps 一份)
            const g = gateOps([op0], { guard: guardOps, state, locale: o.locale, std })
            if (g.ops.length) {
                chosen = g.ops[0]
                break
            }
            fails.push(g.rejected.flatMap((x) => x.why).slice(0, 2).join('；'))
        }
        if (!chosen) {
            stats.disputeStdRejected++
            held.push({ id: it.key, why: 'dissolve-rejected', detail: `兩席判非對立（${DISPUTE_WORD[d.verdict.verdict] || d.verdict.verdict}），拆解欄位${cands.length ? `未過納入閘：${fails.join('｜').slice(0, 200)}` : '缺漏'}；${voteTextOf(d)}`, hash: disputeHashOf(it.dispute, noteKeyOf) })
            stats.disputeHeld++
            log(`爭議覆核[${concept}]：〔${it.key}〕兩席判非對立，但拆解${cands.length ? '未過納入閘' : '欄位缺漏'}——不拆解、待判（使用者）`)
            continue
        }
        ops.push(chosen)
        decided.push(it.key)
    }
    // 套用:全部拆解一份差量;覆核結案(記帳欄位;不得改動條目——ES1)於同一次套用之尾端寫入;不變式違反者逐條剔除(被剔之拆解 → 待判)
    const finish = (ap) => {
        let s = ap.state
        if (o.notesById instanceof Map && domain.evidence?.apply) domain.evidence.apply(s, o.notesById)
        if (opposed.length) {
            s = { ...s, doubtChecks: { ...(s.doubtChecks && typeof s.doubtChecks === 'object' ? s.doubtChecks : {}) } }
            for (const { it, d } of opposed) {
                const cur = (s.disputes || []).find((x) => x.id === it.key)
                if (!cur) continue
                // hash＝含各方出處內容鍵之素材雜湊(專步與掃描比之)、shape＝只含結構之雜湊(渲染等不讀內容鍵者比之)
                s.doubtChecks[it.key] = { v: ES14.v, verdict: 'opposed', doubtVersion: Number(cur.doubt?.version) || 0, doubtCount: Number(cur.doubt?.count) || 1, hash: disputeHashOf(cur, noteKeyOf), shape: disputeHashOf(cur), version: Number(s.version) || 0, at, seats: panelSeats(d.votes), reason: str(d.verdict.reason).slice(0, 200) }
            }
        }
        return { state: s }
    }
    let s = state
    let ap = { applied: [], rejected: [], touched: [] }
    if (ops.length || opposed.length) {
        const res = applyWithInvariants(state, ops, applyCtx, { finish })
        if (!res.ok) return { ok: false, error: `不變式違反：${res.inv.slice(0, 3).join('；')}`, state, stats }
        for (const d of res.dropped) {
            log(`爭議覆核[${concept}]：拆解〔${d.id}〕違反不變式（${d.inv}）——不拆解、待判（使用者）`)
            held.push({ id: d.id, why: 'invariant-rejected', detail: `拆解違反不變式：${d.inv}`, hash: disputeHashOf(items.find((it) => it.key === d.id)?.dispute, noteKeyOf) })
            stats.disputeHeld++
        }
        ap = res.ap
        // 無任何操作、無覆核結案 → 狀態原物件(呼叫端以「無變」判不落盤)
        s = ops.length || opposed.length ? res.state : state
        for (const a of ap.applied) log(`爭議覆核[${concept}]：〔${a.id}〕兩席判非對立——已拆解（內容與出處全留）`)
        for (const x of ap.rejected) {
            const id = str(x.op?.id) || str(ops[x.index]?.id)
            log(`爭議覆核[${concept}]：拆解〔${id}〕拒收（${x.reason}）——待判（使用者）`)
            held.push({ id, why: 'dissolve-rejected', detail: `拆解拒收：${x.reason}`, hash: disputeHashOf(items.find((it) => it.key === id)?.dispute, noteKeyOf) })
            stats.disputeHeld++
        }
        stats.disputeDissolved = ap.applied.length
    }
    const decidedOk = decided.filter((id) => !held.some((h) => h.id === id))
    if (rc.stopped) log(`爭議覆核[${concept}]：中止，已判 ${judged.length} 則照處置、未判 ${undecided.size} 則留待下輪`)
    return { ok: true, state: s, applied: ap.applied, rejected: ap.rejected, stats, held, retry, decided: decidedOk, undecided: [...undecided], unreadable, ...(rc.stopped ? { stopped: true } : {}) }
}

export default runDisputePass
