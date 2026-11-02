// synonymStep.mjs — 提煉段之同義核心核對專步(檢定標準 ES11;判定純函數 extract/standards/synonymCheck)
//
// 【時機】extract.standards.synonymCheck.perRun > 0 時,提煉段各專步之後(不擠占提煉名額);每輪至多該數之候選對。
// 【候選】名稱相近(程式)∪ AI 提議(全部主核心概念名一次;名單雜湊記於 dirs.state/extract-synonym.json,名單變了才再提)。
//   已有檢核紀錄(同名對、同版本)者不再判;有未結待判(使用者)者不重排,負責者 pipeline(缺票／同一供應者)者先排。
// 【判】覆核席 extract.standards.ai(first、second 必填;third 選填):兩席並行(第二席項序打亂)＋第三席(core/standards/panel);
//   每頁 10 對(PAGE);中止(預算／額度)時已判之頁照樣處置,未判之頁本輪不動(無待判、下輪再排)。
// 【處置】同一概念 → 待判(使用者):建議 vocab.conceptAliases 之「別名 → 正名」(正名取已用筆記較多之核心;同數取字典序前者);檢核不合格。
//   不同概念 → 檢核合格(該對之既有待判結案)。判不了(含材料過大)→ 待判(使用者)＋未能判定。缺票／同一供應者 → 待判 pipeline(下輪重判;
//   逐對計次只在失敗帳 step|synonym 之 synonymItemTries——呼叫端依本專步回報之 retry／decided 增減,本專步只以 o.triesOf 讀現值定負責者:
//   現值＋1 達 o.maxTries(extract.standards.synonymCheck.maxTries)即改使用者)。
//   **不改詞彙表、不動核心狀態**——別名改變分群,屬安裝方之設定;加別名後,兩核心同鍵,正名核心下次落盤時由分身合併併為一核心
//   (其筆記由正名核心重新提煉)。
// 【豁免】使用者已豁免之對(waived),其素材雜湊未變即不重登(裁示有效);素材變了才重判(待判登錄之 ctx.hash;終審 §3 D5e)。
// 【全部受檢項皆缺票或同一供應者】專步層之失敗(回 failed;不逐項計次、不登錄待判、不記檢核——未收到可用之兩票是額度、故障或席位配置之問題,
//   逐項計次會把基礎設施之失敗轉成使用者之待判;四個判定小組專步同一規則,見 standards/panelVotes)。專步層之連續失敗與退避由呼叫端
//   (提煉段)記於失敗帳之全域鍵 SYNONYM_LEDGER_KEY(與他三專步之 <mode>Tries 同一規則)。中止者照中止(不計失敗)。
// 【結案】每輪先查未結之待判:兩名已同鍵(已加入別名)、或任一方已非主核心(已併入他核心或已刪除)→ 結案(記處置方式)。
// 【範圍】主核心含概念層與類別層(isPrimaryCore;四專步與掃描同一範圍,終審 §3 D5m)。
// 【與掃描同一函數】候選對與素材雜湊(standards/synonymCheck 之 synonymCandidatesOf)、須檢之判定(synonymDueOf)——掃描之 ES11 列之受檢總量
//   與到期數由之推得;提議紀錄檔名(SYNONYM_STATE_FILE)亦在該處定義、本檔轉出。
// 【呼叫】一律經 workflow/aiCall 之 callerOf(單棒 extractAiCall):逐棒紀錄(onCall;提煉段記逐棒日誌與嘗試數)、截止感知之歸類、斷網不計失敗。

import { normalizeConcept, oneline, textValueOf as str } from '../core/capturePackage.mjs'
import { saveLedgerJson } from '../stores/extractFiles.mjs'
import { EXTRACT_DEFAULT } from '../core/extractSettings.mjs'
import { STATUS } from '../core/capturePackage.mjs'
import { panelSeats } from '../core/summarizePackage.mjs'
import { holdKey, putHold, resolveHold, listHolds } from '../core/capturePackage.mjs'
import { checkKey, recordCheck } from '../core/relatePackage.mjs'
import { EXTRACT_HOLD_NEXT, extractHoldDeadlineOf } from '../stores/extractHolds.mjs'
import { ES11, SYNONYM_STATE_FILE, SYNONYM_PAGE_SIZE, pairOfKey, proposedCandidatesOf, synonymCandidatesOf, synonymDueOf, runSynonymCheck, parseSynonymChecks, checkSynonymChecks, parseSynonymProposals, checkSynonymProposals } from '../standards/synonymCheck.mjs'
import { panelRetryOf, panelWhyLabelOf, voteTextOf } from '../standards/panelVotes.mjs'
import { callerOf } from '../workflow/aiCall.mjs'
import { EXTRACT_LEDGER_STEP_PREFIX } from '../stores/extractLedger.mjs'
import { extractStatInit } from '../logContract.mjs'

export { SYNONYM_STATE_FILE }

/** 專步層之連續失敗與退避於失敗帳之鍵(全域一筆;欄位 synonymTries／synonymLastTriedAt／synonymLastError,同他專步之 <mode>Tries;
 *   專步鍵之前綴不與核心之鍵 `<scope>|<概念鍵>` 相撞——scope 只有 concept／category) */
export const SYNONYM_LEDGER_KEY = `${EXTRACT_LEDGER_STEP_PREFIX}synonym`

const PAGE = SYNONYM_PAGE_SIZE

/**
 * 同義核心核對專步
 *
 * @param {Object} o 輸入 { env(提煉段環境:cores、store、notesById、dirs、at、stores), domain, seats:{ first, second, third? }, ai, perRun,
 *   maxTries?(同一對缺票之次數上限;預設取設定預設), triesOf?:(pairKey)=>Integer(失敗帳之現值;未給視為 0),
 *   log, shouldStop?, remainingMs?, onCall?(逐棒紀錄;提議與覆核各席每次送出各一筆) }
 * @returns {Promise<Object>} 回傳 { stats:{ synonymCandidates, synonymProposed, synonymChecked, synonymSame, synonymDifferent, synonymHeld, synonymRetry, synonymResolved, synonymCalls,
 *   synonymWaivedKept }, retry:Array(pairKey;缺票或同一供應者——呼叫端計次), decided:Array(pairKey;已判定或判不了——呼叫端清計次), stopped?, failed?(專步層之失敗:全部受檢項皆缺票或同一供應者), error? }
 * @example
 * need test in nodejs.
 *
 * const r = await runSynonymStep({ env, domain, seats: { first, second }, ai, perRun: 2, log })
 * console.log(r.decided, r.retry)
 */
export async function runSynonymStep(o) {
    const { env, domain, seats, ai, log } = o
    const stats = extractStatInit(['synonymCandidates', 'synonymProposed', 'synonymChecked', 'synonymSame', 'synonymDifferent', 'synonymHeld', 'synonymRetry', 'synonymResolved', 'synonymCalls', 'synonymWaivedKept'])
    const maxTries = Number.isInteger(o.maxTries) && o.maxTries > 0 ? o.maxTries : EXTRACT_DEFAULT.standards.synonymCheck.maxTries
    const triesOf = typeof o.triesOf === 'function' ? o.triesOf : () => 0
    const retry = []
    const decided = []
    const { holds, checks } = env.stores
    // 每次送出計一次呼叫,並交呼叫端之逐棒紀錄
    const onCall = (entry) => {
        stats.synonymCalls++
        o.onCall?.(entry)
    }
    const call = callerOf(ai, { shouldStop: o.shouldStop, remainingMs: o.remainingMs, onCall })

    // ── 主核心(概念層與類別層)與其名、候選對與素材(與掃描同一函數) ──
    const sc = synonymCandidatesOf({ cores: env.cores, loadUsable: (id) => env.store.loadUsable(id), notesById: env.notesById, stateDir: env.dirs.state, log })
    const { names, byName, cand } = sc

    // ── 已不成對之待判結案:兩名已同鍵(安裝方已加入別名——分身合併併為一核心)、或任一方已非主核心(已併入他核心或已刪除)──
    const open = []
    for (const h of await listHolds(holds, { status: 'open', std: ES11.std })) {
        const [a, b] = str(h.ctx?.a) && str(h.ctx?.b) ? [str(h.ctx.a), str(h.ctx.b)] : pairOfKey(h.oid)
        const how = a && b && normalizeConcept(a) === normalizeConcept(b) ? '兩名已同鍵（詞彙表已加入別名），由分身合併併為一核心'
            : (!byName.has(a) || !byName.has(b) ? `「${byName.has(a) ? b : a}」已非主核心（已併入他核心或已刪除）` : '')
        if (!how) {
            open.push(h)
            continue
        }
        await resolveHold(holds, h.id, { at: env.at, how })
        stats.synonymResolved++
        log.info(`提煉同義核心核對：待判結案「${a}」⇄「${b}」——${how}`)
    }
    if (names.length < 2) return { stats, retry, decided }

    // ── AI 提議(名單變了才再提;併入候選)──
    if (!sc.proposed && typeof domain.buildSynonymProposePrompt === 'function') {
        const r = await call('synonymPropose', seats.first, domain.buildSynonymProposePrompt(names), parseSynonymProposals, checkSynonymProposals)
        if (r?.stopped) return { stats, stopped: true }
        if (r?.ok) {
            const proposed = proposedCandidatesOf(r.json, names)
            saveLedgerJson(sc.file, { v: 1, namesHash: sc.namesHash, at: env.at, pairs: proposed })
            stats.synonymProposed = proposed.length
            sc.add(proposed)
        }
        else log.warn(`提煉同義核心核對：提議席失敗（${oneline(r?.error, 100)}），本輪只用名稱相近之候選`)
    }
    stats.synonymCandidates = cand.size
    const { sidesOf, hashOf } = sc

    // ── 須檢者(排除已判、待判中(使用者)、已豁免而素材未變者;pipeline 待判先排;與掃描同一判定)──
    const openBy = new Map(open.map((h) => [h.oid, h]))
    const dr = await synonymDueOf(sc, { openOf: (key) => openBy.get(key), waivedOf: (key) => holds.get(holdKey(ES11.object, key, ES11.std)), recOf: (key) => checks.get(checkKey(ES11.object, key)) })
    stats.synonymWaivedKept = dr.waivedKept
    const take = dr.due.slice(0, Math.max(0, Number(o.perRun) || 0))
    if (!take.length) return { stats, retry, decided }

    // ── 材料不可得(狀態檔讀不了而尚未修復)之對不送審、不記紀錄:空材料之判定無意義;維護段修復後下輪再排 ──
    const prepared = take.map((c) => {
        const x = sidesOf(c)
        return { key: c.key, a: x.a.side, b: x.b.side, c, readable: x.a.readable && x.b.readable }
    })
    const ready = prepared.filter((p) => p.readable).map(({ readable, ...p }) => p)
    if (ready.length < prepared.length) log.info(`提煉同義核心核對：${prepared.length - ready.length} 對之核心狀態檔讀不了，本輪不送審、不記紀錄（提煉段之維護修復後再排）`)
    if (!ready.length) return { stats, retry, decided }
    // ── 逐頁判(每頁 PAGE 對);中止(預算／額度)時已判之頁照樣處置,未判之頁本輪不動 ──
    const items = []
    const decisions = new Map()
    let stopped = false
    for (let i = 0; i < ready.length; i += PAGE) {
        const page = ready.slice(i, i + PAGE)
        const rc = await runSynonymCheck({
            items: page,
            seats,
            buildPrompt: (xs) => domain.buildSynonymCheckPrompt(xs),
            call: (stage, seat, prompt) => call(stage, seat, prompt, parseSynonymChecks, checkSynonymChecks),
        })
        if (rc.stopped) {
            stopped = true
            break
        }
        items.push(...page)
        for (const [key, d] of rc.decisions) decisions.set(key, d)
    }

    // ── 全部受檢項(已判之頁)皆缺票或同一供應者 → 專步層之失敗:不逐項處置(不計次、不登錄、不記檢核),同未判之頁本輪不動 ──
    const allRetry = items.length > 0 && items.every((it) => panelRetryOf(decisions.get(it.key)))
    const settled = allRetry ? [] : items

    // ── 處置 ──
    const deadline = () => extractHoldDeadlineOf(env.at)
    const record = (key, status, reason, votes) => recordCheck(checks, { object: ES11.object, oid: key, hash: hashOf(cand.get(key)), std: ES11.std, v: ES11.v, at: env.at, status, seats: panelSeats(votes), reason })
    const hold = (it, h) => putHold(holds, { object: ES11.object, oid: it.key, std: ES11.std, reason: h.reason, next: h.next, owner: h.owner, deadline: deadline(), ctx: { a: it.c.a, b: it.c.b, by: it.c.by, hash: hashOf(it.c), ...(h.ctx || {}) } }, env.at)
    for (const it of settled) {
        const d = decisions.get(it.key)
        stats.synonymChecked++
        if (d?.status === 'decided' && d.verdict?.verdict === 'same') {
            // 正名:已用筆記較多之核心(同數取字典序前者);別名為另一方
            const [canonical, alias] = it.a.noteCount >= it.b.noteCount ? [it.a.concept, it.b.concept] : [it.b.concept, it.a.concept]
            stats.synonymSame++
            decided.push(it.key)
            // 先登錄待判、後記檢核紀錄(待判為待辦、紀錄為已審之快取;四專步同序——紀錄先寫而登錄未寫,下輪即不再判、待辦即遺失)
            await hold(it, { reason: `兩席判為同一概念（${oneline(d.verdict.reason, 120)}）：建議於 vocab.conceptAliases 加入「${alias}」→「${canonical}」`, next: EXTRACT_HOLD_NEXT.synonymSame, owner: 'user', ctx: { alias, canonical } })
            await record(it.key, STATUS.VIOLATION, `兩席判為同一概念：${oneline(d.verdict.reason, 120)}`, d.votes)
            log.info(`提煉同義核心核對：「${it.c.a}」與「${it.c.b}」判為同一概念——待判（建議別名「${alias}」→「${canonical}」）`)
            continue
        }
        if (d?.status === 'decided') {
            stats.synonymDifferent++
            decided.push(it.key)
            await record(it.key, STATUS.PASS, `兩席判為不同概念：${oneline(d.verdict.reason, 120)}`, d.votes)
            if (it.c.hold) await resolveHold(holds, it.c.hold.id, { at: env.at, how: '兩席判為不同概念' })
            continue
        }
        if (panelRetryOf(d)) {
            stats.synonymRetry++
            retry.push(it.key)
            // 負責者:失敗帳之現值＋本次達上限 → 使用者判讀(計次本身由呼叫端寫入失敗帳)
            await hold(it, { reason: `判定小組未成立（${panelWhyLabelOf(d?.why)}）`, next: EXTRACT_HOLD_NEXT.synonymRetry, owner: triesOf(it.key) + 1 >= maxTries ? 'user' : 'pipeline' })
            continue
        }
        stats.synonymHeld++
        decided.push(it.key)
        const why = panelWhyLabelOf(d.why)
        await hold(it, { reason: `判定小組判不了是否同一概念（${why}；${oneline(voteTextOf(d, { oneline: true }), 200)}）`, next: EXTRACT_HOLD_NEXT.synonymUser, owner: 'user' })
        await record(it.key, STATUS.UNDETERMINED, `判定小組判不了（${why}）`, d.votes)
    }
    log.info(`提煉同義核心核對：候選 ${stats.synonymCandidates} 對（AI 提議 ${stats.synonymProposed}）、本輪核 ${stats.synonymChecked} 對：同一概念 ${stats.synonymSame}、不同 ${stats.synonymDifferent}、判不了 ${stats.synonymHeld}、重試 ${stats.synonymRetry}${stats.synonymWaivedKept ? `、已豁免且素材未變 ${stats.synonymWaivedKept}` : ''}${allRetry ? `；已判之 ${items.length} 對皆缺票或同一供應者，本輪不記` : ''}${stopped ? `；中止，未判 ${ready.length - items.length} 對留待下輪` : ''}`)
    if (stopped) return { stats, retry, decided, stopped: true }
    return allRetry ? { stats, retry, decided, failed: true, error: '同義核心核對（ES11）未完成：全部受檢項皆缺票或同一供應者（各席皆未回、回覆不合格、席位未設或提示詞放不下、兩票成交於同一供應者）' } : { stats, retry, decided }
}

export default { SYNONYM_STATE_FILE, SYNONYM_LEDGER_KEY, runSynonymStep }
