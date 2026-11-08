// extractSteps.mjs — 提煉段之步驟序列與專步排程(stages 層;提煉段於選題後建立本輪之一份)
//
// 【一個目標之步驟序列】serve(t):①待審裁決 → 僅重審／本質／爭議覆核／出處支持存量覆核／失撐主張(專步之目標)→ ②整併(到期時)
//   → ③提煉批次×追趕;各 pass 經動作鏈(stages/extractChain),鏈之統計併入本輪統計(不在初值表之鍵 WARN)、鏈內例外落失敗帳。
// 【專步排程】runSteps():一般目標之後以剩餘時間排 ④待審、⑤僅重審、⑥本質、⑦爭議覆核、⑨出處支持存量覆核、⑩失撐主張、⑧同義核心核對;
//   每步之開工以 timeOk 判,失敗依退避(1、2、4 天;backoffDaysOf)。
// 【失敗之計】各 pass 之未產出計入本核心之失敗;無事可做與截止不計(NO_FAIL_HALTS)。

import isobj from 'wsemi/src/isobj.mjs'
import { cmp, makeMsg, normalizeConcept, oneline, runChainOverMsgs } from '../core/capturePackage.mjs'
import { rejectStatSplit } from '../core/rejectKinds.mjs'
import { CORE_STATUS, isMainCore, isPrimaryCore, liveCoresOf } from '../stores/conceptSelection.mjs'
import { TERMINAL_SET } from '../stores/coreState.mjs'
import { LEDGER_ERROR_CHARS, coreLedgerKeyOf } from '../stores/extractLedger.mjs'
import { RECHECK_REASONS, URGENT_RECHECK_REASONS, recheckDue } from '../standards/recheck.mjs'
import { pickStock } from '../standards/supportStock.mjs'
import { STREAK_MODES, aiCallLogOf, backoffDaysOf, stepFailNote } from './extractChain.mjs'
import { SYNONYM_LEDGER_KEY, runSynonymStep } from './synonymStep.mjs'


/** 不計失敗之中止原因(無事可做、截止;其餘之未產出——AI 失敗、不變式、CAS、鏈例外——計入 stat.failed,全部模式同計) */
const NO_FAIL_HALTS = new Set(['no-notes', 'no-pending', 'no-need', 'no-recheck', 'no-change', 'budget'])

/**
 * 各專步之專步層連續失敗(失敗帳之 <mode>Tries;僅重審、本質、判定小組三專步):現存核心(非 merged)之鍵中之最大值,同義專步取其全域鍵——
 *   退避期間亦於每輪之執行摘要可見(持續失敗不轉使用者待判,須另有訊號)
 *
 * @param {Object} env 輸入本段環境(取 cores)
 * @param {Object} ledger 輸入失敗帳(取 data)
 * @param {Object} stat 輸入本段統計(寫各 <mode>FailStreak 與 synonymFailStreak)
 * @returns {void} 無回傳值(就地寫入 stat)
 * @example
 * need test in nodejs.
 *
 * failStreaksOf(env, ledger, stat)
 * console.log(stat.supportCheckFailStreak)
 */
export function failStreaksOf(env, ledger, stat) {
    const keys = [...new Set(liveCoresOf(env.cores).map((c) => coreLedgerKeyOf(c)))]
    for (const mode of STREAK_MODES) stat[`${mode}FailStreak`] = keys.reduce((m, key) => Math.max(m, Number(ledger.data[key]?.[`${mode}Tries`]) || 0), 0)
    stat.synonymFailStreak = Number(ledger.data[SYNONYM_LEDGER_KEY]?.synonymTries) || 0
}

/**
 * 本輪之步驟序列與專步排程(提煉段於選題後建立):serve(t)＝一個目標之步驟序列(待審 → 專步之目標 → 整併(到期時)→ 提煉批次×追趕;
 *   各 pass 經動作鏈,鏈之統計併入 stat、鏈內例外落失敗帳);runSteps()＝一般目標之後以剩餘時間排之專步(待審、僅重審、本質、爭議覆核、
 *   出處支持存量覆核、失撐主張、同義核心核對)
 *
 * @param {Object} o 輸入 { env(本段環境), ctx(管道脈絡), chain(動作鏈), domain, seats(3+3 席位), ledger(失敗帳), stat(本段統計), log,
 *   k(settings.extract), pick(選題參數), catchup(追趕批數), parallel(本輪並行核心數), timeOk(開工門檻之判定), budget(時間預算),
 *   e9(覆核席之設定), synonymCheck(同義核對之設定;未開啟為 null) }
 * @returns {Object} 回傳 { serve:(t)=>Promise, runSteps:()=>Promise }
 * @example
 * need test in nodejs.
 *
 * const steps = createSteps({ env, ctx, chain, domain, seats, ledger, stat, log, k, pick, catchup: 1, parallel: 2, timeOk, budget, e9, synonymCheck: null })
 * await steps.runSteps()
 */
export function createSteps(o) {
    const { env, ctx, chain, domain, seats, ledger, stat, log, k, pick, catchup, parallel, timeOk, budget, e9, synonymCheck } = o
    // 鏈之統計併入本輪統計:鍵不在初值表者為程式之錯(count 之鍵與初值表、契約之鍵不同步)——WARN 一次(須見),不靜默吞掉
    const unknownStat = new Set()
    const agg = (r) => {
        for (const [key, v] of Object.entries(r.stats || {})) {
            if (key === 'backlog') continue
            // 型別計數(core/rejectKinds):鏈內以扁平鍵 `<By 鍵>:<碼>` 累加(count 為純數字),此處轉入本輪統計之 { 碼: 計數 }
            const kindKey = rejectStatSplit(key)
            if (kindKey) {
                const m = stat[kindKey[0]] && typeof stat[kindKey[0]] === 'object' ? stat[kindKey[0]] : (stat[kindKey[0]] = {})
                m[kindKey[1]] = (m[kindKey[1]] || 0) + v
                continue
            }
            if (key in stat) stat[key] += v
            else if (!unknownStat.has(key)) {
                unknownStat.add(key)
                log.warn(`提煉統計：未知之統計鍵 ${key}（不在初值表，已略過；程式之錯）`)
            }
        }
    }
    const servedIds = new Set()
    const serve = async (t0) => {
        const t = { ...t0 }
        const ledgerKey = coreLedgerKeyOf(t)
        let bumped = false
        const run = async (mode) => {
            const msg = makeMsg('concept', { target: t, mode, _domain: domain, _env: env, _seats: seats, _ledgerKey: ledgerKey }, { stage: 'extract' })
            const r = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'extract.extract' })
            if (r.fails) {
                // 鏈內例外(程式錯誤、寫檔失敗)亦落帳:否則此核心每輪被選、每輪同一例外(stages/extractStage 檔頭【失敗帳】)
                log.warn(`提煉異常[${t.concept}]：${r.errors.join('；')}`)
                const led = ledger.entry(ledgerKey)
                led.tries = (led.tries || 0) + 1
                led.lastTriedAt = env.at
                led.lastError = oneline(r.errors.join('；'), LEDGER_ERROR_CHARS)
            }
            agg(r)
            const id = msg.data._core?.id
            if (id) servedIds.add(id)
            // 新核心首批落盤後即綁定其記錄:後續步驟(追趕之次批)載入同一核心,不另配發新 id(否則同輪自造分身)
            if (msg.data._out && id) t.core = env.cores.find((c) => c.id === id) || t.core
            if (msg.data._out && msg.data._applied?.bumped) bumped = true
            return { ok: !r.fails && !!msg.data._out, halt: msg.data._halt || (r.fails ? 'error' : ''), out: msg.data._out }
        }
        // 逐核心收尾:「更新 N 則核心」以核心計(追趕時同一核心多批升版只算一則;外部巡檢之核心更新數據此),落失敗帳
        const finish = () => {
            if (bumped) stat.updated++
            try {
                ledger.save()
            }
            catch (e) {
                log.warn(`提煉：失敗帳寫入失敗（${oneline(e.message, 160)}）`)
            }
        }
        // 預載(待審之有無、各專步之材料)走四態分流表:可讀者取之(recovered 者於載入時修復),其餘 null
        const lu = t.core ? env.store.loadUsable(t.core.id) : null
        let state = lu?.readable ? lu.state : null
        let served = false
        let failed = false
        const led = ledger.entry(ledgerKey)
        // ①待審:前次終審未明列裁決(或終審失敗)而暫緩之不可逆操作,先交終審席裁決(本質專步之核心不重做:同輪已由待審專步處理過)
        // 各 pass 之結果:有產出即接續;失敗(非「無事可做」、非截止)計入本核心之失敗——全部模式(待審、重審、本質、專步、整併、提煉、鏈例外)同計
        const take = (r) => {
            if (r.out) state = r.out
            if (!r.ok && !NO_FAIL_HALTS.has(r.halt)) failed = true
        }
        if (!t.essenceOnly && !t.disputeOnly && !t.supportOnly && !t.orphanOnly && state?.pendingReview?.length && timeOk()) {
            led.pendingTriedAt = env.at
            take(await run('pending'))
        }
        // ①′僅重審 pass(本輪未做一般批之主核心;重審項到期者):與待審同一 serve 序列,不並行撞 CAS
        if (t.recheckOnly && timeOk()) take(await run('recheck'))
        // ①″本質專步(ES6;見下方 ⑥)
        if (t.essenceOnly && timeOk()) take(await run('essence'))
        // ①‴爭議覆核專步(ES14;見下方 ⑦)
        if (t.disputeOnly && timeOk()) take(await run('dispute'))
        // ①⁗出處支持存量覆核專步(ES9 存量;見下方 ⑨)、失撐主張專步(ES8;見下方 ⑩)
        if (t.supportOnly && timeOk()) take(await run('support'))
        if (t.orphanOnly && timeOk()) take(await run('orphan'))
        if (t.pendingOnly || t.recheckOnly || t.essenceOnly || t.disputeOnly || t.supportOnly || t.orphanOnly) {
            if (failed) stat.failed++
            finish()
            return
        }
        // ②整併(到期時):有效主張逾上限且距上次嘗試 ≥ 間隔;不消耗筆記、不取代本輪之提煉批次
        if (state && timeOk()) {
            const live = state.claims.filter((c) => !TERMINAL_SET.has(c.status)).length
            const every = k.consolidateEvery
            const cons = led.consolidate || {}
            const interval = cons.interval || every
            const since = state.version - Math.max(Number(state.lastConsolidated) || 0, Number(cons.version) || 0)
            if (live > k.claimsCap && since >= interval) {
                const r = await run('consolidate')
                const after = r.out ? r.out.claims.filter((c) => !TERMINAL_SET.has(c.status)).length : live
                const effective = r.ok && after <= live * 0.9
                // 截止(budget)不算一次整併嘗試:記了會把下次整併推到 interval 個版次之後,而它根本沒跑完
                if (r.halt !== 'budget') led.consolidate = { version: state.version, at: env.at, ok: r.ok, interval: r.ok ? (effective ? every : interval * 2) : interval }
                take(r)
            }
        }
        // ③提煉批次×追趕:每批一般差量、各自 CAS;第二批起須仍有滿批之待提煉。類別目標為低優先之填空,每輪 1 批
        const batches = t.scope === 'category' ? 1 : catchup
        for (let b = 0; b < batches; b++) {
            if (!timeOk()) break
            if (b > 0) {
                const consumed = new Set(state?.consumed || [])
                const left = (t.pending || []).filter((n) => !consumed.has(n.id)).length
                if (left < pick.notesPerTarget) break
            }
            const r = await run('delta')
            if (r.out) {
                state = r.out
                served = true
            }
            if (!r.ok) {
                if (!served && !NO_FAIL_HALTS.has(r.halt)) failed = true
                break
            }
        }
        if (failed) stat.failed++
        finish()
    }
    const runSteps = async () => {
        // ④待審專步:本輪未處理而有待審之核心——無新筆記者選題選不到,不另排則不可逆操作久懸。
        //   提煉批次完成後以剩餘時間進行、併發同 extract.perRun(不擠占提煉名額)、久未嘗試者先;只排主核心(分身待合併,不另開工)
        const pendingCores = env.cores
            .filter((c) => c.status !== CORE_STATUS.merged && Number(c.pendingReview) > 0 && !servedIds.has(c.id))
            .filter((c) => isPrimaryCore(c, env.cores))
            .map((c) => ({ c, at: ledger.data[coreLedgerKeyOf(c)]?.pendingTriedAt || '' }))
            .sort((a, b) => cmp(a.at, b.at) || cmp(a.c.id, b.c.id))
            .slice(0, parallel)
            .map((x) => x.c)
        // ⑤僅重審 pass:本輪未做一般批之概念層主核心,重審項到期者(有立即到期之理由;或湊批之篇數——新判衝突、新關聯之夥伴(ES10)——
        //   ≥ 半批;或其最舊者已等 extract.recheck.waitDays)——每輪至多 extract.recheck.perRun 個(立即到期者優先、其次最舊);失敗依退避(1、2、4 天)
        const nowMs = Date.parse(env.at)
        const perRecheck = Number.isInteger(k.recheck.perRun) ? k.recheck.perRun : 1
        const waitDays = Number.isFinite(k.recheck.waitDays) ? k.recheck.waitDays : 7
        // 專步失敗之退避(僅重審、本質、爭議、存量、失撐、同義各自之欄位):1、2、4 天
        const backoffOk = (led0, kind = 'recheck') => {
            const n = Number(led0?.[`${kind}Tries`]) || 0
            const last = Date.parse(led0?.[`${kind}LastTriedAt`] || '')
            return !n || !Number.isFinite(last) || nowMs - last >= backoffDaysOf(n) * 86400_000
        }
        // 湊批之重審項(新判衝突、新關聯之夥伴)之最舊時刻;立即到期之理由(內容變更、衝突撤銷、關聯變更、重送)者優先
        const oldestOf = (items) => Math.min(...items.filter((x) => x.reason === RECHECK_REASONS.conflict || x.reason === RECHECK_REASONS.partner).map((x) => Date.parse(x.at || '')).filter(Number.isFinite), Infinity)
        const urgent = (items) => Number(items.some((i) => URGENT_RECHECK_REASONS.includes(i.reason)))
        const recheckCores = perRecheck > 0
            ? env.cores
                .filter((c) => isMainCore(c, env.cores) && !servedIds.has(c.id))
                .map((c) => ({ c, items: (env.recheck.get(c.id) || []).filter((x) => !(env.recheckBlocked && x.reason === RECHECK_REASONS.changed)) }))
                .filter((x) => recheckDue(x.items, { minConflict: Math.ceil(pick.notesPerTarget / 2), waitDays, nowMs }) && backoffOk(ledger.data[coreLedgerKeyOf({ scope: 'concept', concept: x.c.concept })]))
                .sort((a, b) => urgent(b.items) - urgent(a.items) || oldestOf(a.items) - oldestOf(b.items) || cmp(a.c.id, b.c.id))
                .slice(0, perRecheck)
                .map((x) => x.c)
            : []
        const recheckIds = new Set(recheckCores.map((c) => c.id))
        const extra = [...new Map([...pendingCores, ...recheckCores].map((c) => [c.id, c])).values()]
            .map((c) => ({ key: normalizeConcept(c.concept), scope: c.scope || 'concept', concept: c.concept, core: c, pending: [], candidates: [], pendingOnly: !recheckIds.has(c.id), recheckOnly: recheckIds.has(c.id) }))
        if (extra.length && timeOk()) {
            stat.concepts += extra.length
            await Promise.all(extra.map(serve))
        }
        // ⑥本質專步(檢定標準 ES6):有效主張而無本質、或本質待重寫之主核心(維護時統計;執行時以當下狀態再判,同輪已補者不呼叫 AI)——
        //   閒置核心不被選題選中,不另排則永不補。無本質者先、本輪未處理者先;每輪至多 extract.perRun 個(不擠占提煉名額);未補成者退避(1、2、4 天)
        const essenceCores = typeof domain.buildEssencePrompt === 'function'
            ? env.cores
                .filter((c) => env.essenceNeeds.has(c.id) && isPrimaryCore(c, env.cores))
                .filter((c) => backoffOk(ledger.data[coreLedgerKeyOf(c)], 'essence'))
                .sort((a, b) => Number(env.essenceNeeds.get(a.id) !== 'missing') - Number(env.essenceNeeds.get(b.id) !== 'missing') || Number(servedIds.has(a.id)) - Number(servedIds.has(b.id)) || cmp(a.id, b.id))
                .slice(0, parallel)
            : []
        if (essenceCores.length && timeOk()) {
            stat.concepts += essenceCores.length
            log.info(`提煉本質專步：${essenceCores.map((c) => `${c.concept}（${env.essenceNeeds.get(c.id) === 'missing' ? '無本質' : '待重寫'}）`).join('、')}`)
            await Promise.all(essenceCores.map((c) => serve({ key: normalizeConcept(c.concept), scope: c.scope || 'concept', concept: c.concept, core: c, pending: [], candidates: [], essenceOnly: true })))
        }
        // ⑦爭議覆核專步(檢定標準 ES14;開啟時):終審存疑之未解決爭議,到期者(維護時統計)交覆核席判是否真對立——每輪至多
        //   extract.standards.disputeCheck.perRun 則(存疑久者先),同核心之多則同一次呼叫;執行時以當下狀態再判;失敗依退避(1、2、4 天)
        const dcOn = env.disputeCheck && env.disputeCheck.perRun > 0
        const dueRows = dcOn
            ? [...env.disputeNeeds.entries()]
                .flatMap(([cid, due]) => due.map((x) => ({ cid, ...x })))
                .map((x) => ({ ...x, c: env.cores.find((c) => c.id === x.cid) }))
                .filter((x) => x.c && isPrimaryCore(x.c, env.cores) && backoffOk(ledger.data[coreLedgerKeyOf(x.c)], 'dispute'))
            : []
        stat.disputeDue = dueRows.length
        const dueTake = dueRows.sort((a, b) => b.days - a.days || cmp(a.cid, b.cid) || cmp(String(a.id), String(b.id))).slice(0, dcOn ? env.disputeCheck.perRun : 0)
        const disputeCores = [...new Map(dueTake.map((x) => [x.cid, x.c])).values()].slice(0, Math.max(1, parallel))
        if (disputeCores.length && timeOk()) {
            stat.concepts += disputeCores.length
            const idsOf = (cid) => dueTake.filter((x) => x.cid === cid).map((x) => x.id)
            log.info(`提煉爭議覆核專步：${disputeCores.map((c) => `${c.concept}（${idsOf(c.id).map((id) => `〔${id}〕`).join('')}）`).join('、')}；到期共 ${dueRows.length} 則`)
            await Promise.all(disputeCores.map((c) => serve({ key: normalizeConcept(c.concept), scope: c.scope || 'concept', concept: c.concept, core: c, pending: [], candidates: [], disputeOnly: true, disputeIds: idsOf(c.id) })))
        }
        // ⑨出處支持之存量覆核專步(檢定標準 ES9 存量;extract.standards.supportStock.perRun > 0):既有有效主張逐條交覆核席判是否仍受其存活出處支持——
        //   每輪至多該數之主張(從未檢者先、其次重檢;同級依核心 id、主張序),同核心一次專步;執行時以當下狀態再判;失敗依退避(1、2、4 天)
        if (env.supportStock && timeOk()) {
            const rows = [...env.stockNeeds.entries()]
                .flatMap(([cid, need]) => need.map((x) => ({ cid, ...x, c: env.cores.find((c) => c.id === cid) })))
                .filter((x) => x.c && isPrimaryCore(x.c, env.cores) && backoffOk(ledger.data[coreLedgerKeyOf(x.c)], 'support'))
            stat.stockDue = rows.length
            const take = pickStock(rows, env.supportStock.perRun)
            const stockCores = [...new Map(take.map((x) => [x.cid, x.c])).values()].slice(0, Math.max(1, parallel))
            if (stockCores.length) {
                stat.concepts += stockCores.length
                const idsOf = (cid) => take.filter((x) => x.cid === cid).map((x) => x.id)
                log.info(`提煉出處支持存量覆核專步：${stockCores.map((c) => `${c.concept}（${idsOf(c.id).length} 條）`).join('、')}；須檢共 ${rows.length} 條`)
                await Promise.all(stockCores.map((c) => serve({ key: normalizeConcept(c.concept), scope: c.scope || 'concept', concept: c.concept, core: c, pending: [], candidates: [], supportOnly: true, supportIds: idsOf(c.id) })))
            }
        }
        // ⑩失撐主張之專責佇列(檢定標準 ES8;extract.standards.orphanCheck.perRun > 0):出處筆記全數已刪除之主張(維護時統計),每輪至多該數之主張
        //   (失撐多之核心先、逐條截至上限;核心層以 extract.perRun 封頂——四專步皆同,終審 §3 A-6),於該核心全部已消化筆記中找支持;
        //   執行時以當下狀態再判;失敗依退避(1、2、4 天)
        if (env.orphanCheck && timeOk()) {
            const rows = [...env.orphanNeeds.entries()]
                .map(([cid, need]) => ({ cid, need, c: env.cores.find((c) => c.id === cid) }))
                .filter((x) => x.c && isPrimaryCore(x.c, env.cores) && backoffOk(ledger.data[coreLedgerKeyOf(x.c)], 'orphan'))
            stat.orphanDue = rows.reduce((a, x) => a + x.need.length, 0)
            let left = env.orphanCheck.perRun
            const take = []
            for (const x of rows.sort((a, b) => b.need.length - a.need.length || cmp(a.cid, b.cid))) {
                if (left <= 0) break
                const ids = x.need.slice(0, left).map((y) => y.id)
                left -= ids.length
                take.push({ ...x, ids })
            }
            const orphanCores = take.slice(0, Math.max(1, parallel))
            if (orphanCores.length) {
                stat.concepts += orphanCores.length
                log.info(`提煉失撐主張專步：${orphanCores.map((x) => `${x.c.concept}（${x.ids.map((id) => `〔${id}〕`).join('')}）`).join('、')}；須檢共 ${stat.orphanDue} 條`)
                await Promise.all(orphanCores.map((x) => serve({ key: normalizeConcept(x.c.concept), scope: x.c.scope || 'concept', concept: x.c.concept, core: x.c, pending: [], candidates: [], orphanOnly: true, orphanIds: x.ids })))
            }
        }
        // ⑧同義核心核對專步(檢定標準 ES11;extract.standards.synonymCheck.perRun > 0):主核心之概念名兩兩(名稱相近＋AI 提議)交覆核席判是否同一概念——
        //   同一概念者登錄待判(建議別名;不改詞彙表、不動核心);每輪至多該數之候選對(stages/synonymStep)。逐棒日誌與呼叫數同他棒;
        //   專步層之失敗(全部受檢項皆缺票或同一供應者)記於失敗帳之全域鍵並退避(1、2、4 天;同他專步),判過可用之兩票即歸零
        if (synonymCheck && timeOk() && backoffOk(ledger.data[SYNONYM_LEDGER_KEY], 'synonym')) {
            const onCall = aiCallLogOf('提煉事件[同義核心核對]', log, (key, n) => {
                stat[key] += n
            })
            // 逐對缺票之計次只在失敗帳(step|synonym 之 synonymItemTries;D5a):專步只讀 triesOf 定負責者,本段依其回報之 retry／decided 增減
            const ledS = () => ledger.data[SYNONYM_LEDGER_KEY] || (ledger.data[SYNONYM_LEDGER_KEY] = {})
            const itemTries = () => (isobj(ledS().synonymItemTries) ? ledS().synonymItemTries : (ledS().synonymItemTries = {}))
            const sr = await runSynonymStep({ env, domain, seats: { first: budget.capSeat(e9.first), second: budget.capSeat(e9.second), third: isobj(e9.third) ? budget.capSeat(e9.third) : null }, ai: ctx.deps.ai, perRun: synonymCheck.perRun, maxTries: synonymCheck.maxTries, triesOf: (key) => Number(itemTries()[key]) || 0, log, shouldStop: env.shouldStop, remainingMs: env.remainingMs, onCall })
            for (const [key, n] of Object.entries(sr.stats || {})) stat[key] = (stat[key] || 0) + n
            let ledChanged = false
            if ((sr.retry || []).length || (sr.decided || []).length) {
                const it = itemTries()
                for (const key of sr.decided || []) delete it[key]
                for (const key of sr.retry || []) {
                    const n = (Number(it[key]) || 0) + 1
                    if (n >= synonymCheck.maxTries) delete it[key]
                    else it[key] = n
                }
                if (!Object.keys(it).length) delete ledS().synonymItemTries
                ledChanged = true
            }
            const led = ledger.data[SYNONYM_LEDGER_KEY]
            if (sr.failed) {
                const l = ledS()
                l.synonymTries = (Number(l.synonymTries) || 0) + 1
                l.synonymLastTriedAt = env.at
                l.synonymLastError = oneline(sr.error, LEDGER_ERROR_CHARS)
                ledChanged = true
                log.warn(`提煉：同義核心核對失敗（${oneline(sr.error, 160)}）——${stepFailNote(l.synonymTries)}`)
            }
            else if ((sr.stats?.synonymChecked || 0) > 0 && Number(led?.synonymTries) > 0) {
                led.synonymTries = 0
                led.synonymLastError = ''
                ledChanged = true
            }
            if (ledChanged) {
                try {
                    ledger.save()
                }
                catch (e) {
                    log.warn(`提煉：失敗帳寫入失敗（${oneline(e.message, 160)}）`)
                }
            }
        }
    }
    return { serve, runSteps }
}

export default createSteps
