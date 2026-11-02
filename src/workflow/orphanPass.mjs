// orphanPass.mjs — 失撐主張之專責佇列專步(檢定標準 ES8):出處筆記全數已刪除之主張,於本核心之已消化筆記中找支持 → 補出處、撤回(可還原)、或待判
//
// 【流程】受檢主張(呼叫端以 orphanNeedsOf 選定)→ 候選＝本核心全部存活之已消化筆記 → runOrphanCheck(逐頁兩席＋第三席、跨頁合成)→ 逐項:
//   成立 supported → confirm(出處＝兩席所列之交集筆記;程式差量,批＝該些筆記——皆已消化)
//   每一頁皆成立 none → 撤回(理由「出處已撤他篇無支持」;出處筆記還原時由 withdrawSources 一併還原)
//   未成立:判不了(不確定、不一致、材料過大)→ 待判(使用者;仍為衍生隔離);缺票／同一供應者 → 重試(呼叫端記次,逾限轉待判)
//   候選筆記之內容讀不到者不送審(自候選移除;無可送者 noop);有讀不到者時「每頁皆 none」不撤回(讀不到之篇可能支持)→ 待判(材料不可得;不計次)
// 【全部受檢項皆缺票或同一供應者】專步層之失敗(回 ok:false;呼叫端退避;不逐項計次——四個判定小組專步同一規則,見 standards/panelVotes)。
// 【中止】跨頁合成須全部頁,中止即回 stopped(不套用、不記次)——與他專步「已判之頁照處置」不同,刻意。
// 【寫入】一份程式差量(confirm／retract;applyDelta ctx.program)→ 證據重算 → 不變式(touched;違反者逐條剔除後重套——workflow/applyWithInvariants;
//   被剔者不記檢核,下輪重檢)。
// 【截止】任一席截止、額度中止或斷網 → 回 stopped(不套用、不記次);呼叫經 workflow/aiCall 之 callerOf(單棒 extractAiCall)。

import { TERMINAL_STATUSES, findItem } from '../stores/coreState.mjs'
import { applyCtxOf } from '../standards/opStandards.mjs'
import { applyWithInvariants } from './applyWithInvariants.mjs'
import { STATUS, textValueOf as str } from '../core/capturePackage.mjs'
import { claimAssertion } from '../standards/supportCheck.mjs'
import { noteTitleFnOf } from '../stores/noteFacts.mjs'
import { orphanCandidatesOf, orphanHashOf, runOrphanCheck, parseOrphanChecks, checkOrphanChecks } from '../standards/orphanCheck.mjs'
import { EXTRACT_PANEL_WHY, panelWhyLabelOf } from '../standards/panelVotes.mjs'
import { callerOf } from './aiCall.mjs'
import { extractStatInit } from '../logContract.mjs'


/**
 * 失撐主張之專責佇列專步
 *
 * @param {Object} o 輸入
 * @param {Object} o.state 輸入目前狀態
 * @param {String} o.concept 輸入概念名
 * @param {Array} o.ids 輸入受檢之失撐主張 id(呼叫端選定)
 * @param {Object} o.domain 輸入提煉 domain(buildOrphanCheckPrompt、claimKinds、limits、evidence)
 * @param {Object} o.seats 輸入覆核席 { first, second, third? }(settings.extract.standards.ai)
 * @param {Object} o.ai 輸入 AI adapter(getWkf、seatSpec、recordCall)
 * @param {Map} [o.notesById] 輸入筆記 id → 記錄(候選須記錄仍在)
 * @param {Function} [o.contentOf] 輸入 (noteId)=>出處筆記之內容|null
 * @param {Function} [o.keyOf] 輸入 (noteId)=>內容鍵(受檢雜湊含候選之內容鍵;未給視為 '')
 * @param {String} [o.at=''] 輸入時刻
 * @param {Function} [o.shouldStop] 輸入截止判斷
 * @param {Function} [o.remainingMs] 輸入 ()=>整輪剩餘毫秒數
 * @param {Function} [o.onCall] 輸入每棒回來時之回呼
 * @param {Function} [o.log] 輸入 (line) => void
 * @returns {Promise<Object>} 回傳 { ok, noop?, state, applied, rejected, stats, checks:[{ id, hash, status, seats, reason }], held:[{ id, why, detail }], retry:Array(id), stopped?, error? }
 * @example
 * need test in nodejs.
 *
 * const r = await runOrphanPass({ state, concept: '黑洞', ids: ['C2'], domain, seats: { first, second, third }, ai })
 * console.log(r.decided, r.retry)
 */
export async function runOrphanPass(o) {
    const { state, concept, domain, seats, ai } = o
    const log = typeof o.log === 'function' ? o.log : () => {}
    const at = str(o.at)
    const stats = extractStatInit(['orphanChecked', 'orphanResourced', 'orphanRetracted', 'orphanHeld', 'orphanRetry', 'orphanCalls', 'orphanPages', 'orphanUnreadable'])
    const has = (nid) => !(o.notesById instanceof Map) || o.notesById.has(nid)
    const contentOf = typeof o.contentOf === 'function' ? o.contentOf : () => null
    const cands0 = orphanCandidatesOf(state, has)
    // 候選筆記之內容讀不到者不送審(自候選移除);有讀不到者時「皆無支持」不足以撤回
    const unreadable = cands0.filter((nid) => contentOf(nid) === null || contentOf(nid) === undefined)
    const cands = cands0.filter((nid) => !unreadable.includes(nid))
    stats.orphanUnreadable = unreadable.length
    const claims = (Array.isArray(o.ids) ? o.ids : []).map((id) => findItem(state, str(id))).filter((h) => h?.key === 'claims' && !TERMINAL_STATUSES.includes(h.item.status))
    const items = claims.map((h) => ({ key: h.item.id, claim: h.item, text: claimAssertion(h.item), basis: str(h.item.basis) }))
    const empty = { state, applied: [], rejected: [], stats, checks: [], held: [], retry: [], unreadable }
    if (unreadable.length && items.length) log(`失撐主張找支持[${concept}]：${unreadable.length} 篇候選筆記之內容讀不到（${unreadable.slice(0, 5).join('、')}），本輪不送審${cands.length ? '；其餘候選照送，但「皆無支持」不撤回' : '、不計次'}`)
    if (!items.length || !cands.length) return { ok: true, noop: true, ...empty }
    if (typeof domain.buildOrphanCheckPrompt !== 'function') return { ok: false, error: 'domain 未提供 buildOrphanCheckPrompt（失撐主張專責佇列停用）', ...empty }
    if (!seats?.first) return { ok: false, error: '未設覆核席(settings.extract.standards.ai.first)', ...empty }
    const call = callerOf(ai, { parse: parseOrphanChecks, check: checkOrphanChecks, shouldStop: o.shouldStop, remainingMs: o.remainingMs, onCall: o.onCall })
    const rc = await runOrphanCheck({ items, notes: cands, concept, contentOf, titleOf: noteTitleFnOf(o.notesById), buildPrompt: domain.buildOrphanCheckPrompt, call, seats })
    stats.orphanCalls = rc.calls
    stats.orphanPages = rc.pages || 0
    if (rc.stopped) return { ok: false, error: 'stopped', stopped: true, ...empty }
    stats.orphanChecked = items.length
    // 跨頁合成之 retry＝有頁缺票或同一供應者(standards/orphanCheck);全部受檢項皆如此即專步層之失敗
    if (items.every((it) => rc.results.get(it.key)?.status === 'retry')) {
        return { ok: false, error: '失撐主張找支持（ES8）未完成：全部受檢項皆缺票或同一供應者（各席皆未回、回覆不合格、席位未設或提示詞放不下、兩票成交於同一供應者）', ...empty, retry: items.map((it) => it.key) }
    }
    // 受檢雜湊:候選以全部已消化筆記計(含本輪讀不到者——其內容鍵為 '',修復後鍵變即重檢)
    const hash = (c) => orphanHashOf(c, cands0, o.keyOf)
    const ops = []
    const batch = []
    const checks = []
    const held = []
    const retry = []
    for (const it of items) {
        const r = rc.results.get(it.key)
        if (r?.status === 'supported' && r.notes.length) {
            ops.push({ op: 'confirm', id: it.key, sources: r.notes })
            batch.push(...r.notes)
            checks.push({ id: it.key, hash: hash(it.claim), status: STATUS.PASS, seats: r.seats, reason: `他篇支持：${r.notes.join('、')}`.slice(0, 200) })
            log(`失撐主張找支持[${concept}]：〔${it.key}〕兩席判 ${r.notes.length} 篇已消化筆記支持——補出處（${r.notes.map((n) => o.notesById?.get?.(n)?.title || n).join('、').slice(0, 120)}）`)
        }
        else if (r?.status === 'none' && unreadable.length) {
            // 可送之候選皆無支持,但有讀不到之候選:不撤回(讀不到之篇可能支持),待判、不計次;md 修復後其雜湊即變而重檢
            held.push({ id: it.key, why: EXTRACT_PANEL_WHY.NO_MATERIAL, detail: `可送之 ${cands.length} 篇皆無支持；另 ${unreadable.length} 篇候選之內容讀不到`, hash: hash(it.claim) })
            checks.push({ id: it.key, hash: hash(it.claim), status: STATUS.UNDETERMINED, seats: r.seats, reason: `${panelWhyLabelOf(EXTRACT_PANEL_WHY.NO_MATERIAL)}：另 ${unreadable.length} 篇候選讀不到` })
            log(`失撐主張找支持[${concept}]：〔${it.key}〕可送之候選皆無支持，但 ${unreadable.length} 篇候選讀不到——不撤回、待判（使用者）`)
        }
        else if (r?.status === 'none') {
            ops.push({ op: 'retract', id: it.key, reason: '出處已撤他篇無支持', note: `出處筆記已刪除，兩席判本核心其餘 ${cands.length} 篇已消化筆記皆不支持（出處筆記還原即還原）` })
            checks.push({ id: it.key, hash: hash(it.claim), status: STATUS.VIOLATION, seats: r.seats, reason: r.detail.slice(0, 200) })
            log(`失撐主張找支持[${concept}]：〔${it.key}〕兩席判他篇皆無支持——撤回（出處筆記還原即還原）`)
        }
        else if (r?.status === 'held') {
            held.push({ id: it.key, why: r.why, detail: r.detail, hash: hash(it.claim) })
            checks.push({ id: it.key, hash: hash(it.claim), status: STATUS.UNDETERMINED, seats: '', reason: `${panelWhyLabelOf(r.why)}：${r.detail}`.slice(0, 200) })
            log(`失撐主張找支持[${concept}]：〔${it.key}〕判不了（${panelWhyLabelOf(r.why)}）——待判（使用者）`)
        }
        else {
            retry.push(it.key)
            log(`失撐主張找支持[${concept}]：〔${it.key}〕未成立（${panelWhyLabelOf(r?.why)}）——下輪重試`)
        }
    }
    stats.orphanHeld = held.length
    stats.orphanRetry = retry.length
    let s = state
    let ap = { applied: [], rejected: [], touched: [] }
    if (ops.length) {
        const applyCtx = applyCtxOf(domain, { batch: [...new Set(batch)].map((id) => ({ id })), mode: 'delta', step: 'orphan', program: true, onlyOps: ['confirm', 'retract'], at, self: concept, meta: { std: 'ES8', pass: 'orphan' } })
        const res = applyWithInvariants(state, ops, applyCtx, {
            finish: (x) => {
                if (o.notesById instanceof Map && domain.evidence?.apply) domain.evidence.apply(x.state, o.notesById)
                return { state: x.state }
            },
        })
        if (!res.ok) return { ok: false, error: `不變式違反：${res.inv.slice(0, 3).join('；')}`, ...empty }
        ap = res.ap
        s = res.state
        for (const d of res.dropped) log(`失撐主張找支持[${concept}]：${d.op}〔${d.id}〕違反不變式（${d.inv}）——不落地、不記檢核（下輪重檢）`)
        for (const x of ap.rejected) log(`失撐主張找支持[${concept}]：${x.op}〔${str(ops[x.index]?.id)}〕拒收（${x.reason}）`)
    }
    const done = new Set(ap.applied.map((a) => a.id))
    stats.orphanResourced = ops.filter((op) => op.op === 'confirm' && done.has(op.id)).length
    stats.orphanRetracted = ops.filter((op) => op.op === 'retract' && done.has(op.id)).length
    // 套用被拒者:不記檢核結果(下輪重檢)
    const okIds = new Set([...done, ...held.map((h) => h.id)])
    return { ok: true, state: s, applied: ap.applied, rejected: ap.rejected, stats, checks: checks.filter((c) => okIds.has(c.id)), held, retry, unreadable }
}

export default runOrphanPass
