// extractStage.mjs — 提煉階段:主張庫＋差量,3+3 工作流。選題 → 逐核心(待審裁決 → 整併 → 提煉批次×追趕)→ 程式套用 → 落盤
//
// 【流程(3+3)】每一步皆走 workflow/runPass:
//   三家獨立起草(各自讀同一份狀態與本批筆記、各出一份差量)→ 整合(合併三份候選,程式計票、via 驗證、ref 閉包)
//   → 審計(列出問題;程式判得出之超限一併列為意見)→ 修訂(只出補丁,程式守門:審後不得比審前差)
//   → 終審(逐操作裁決;不可逆操作須明列)→ 程式套用(狀態為真理;不變式違反者逐條剔除後重套)。
//   席位 settings.extract.ai = { drafters:[3 席], integrate, audit, revise, accept }。
// 【三種步驟】delta:一批筆記併入;consolidate:有效主張逾上限時整併(起草用整併提示詞、不處理筆記);
//   pending:前次終審未明列裁決(或終審失敗)而暫緩之不可逆操作,交終審席裁決(workflow/pending)。
// 【狀態為真理】stores/coreState 為真理、md 與 cores 記錄為投影;已用過＝逐核心累積出處;本段只讀寫本格式之狀態檔(他種資料由安裝端自行處理)。
// 【機制與領域分工】本檔:每輪之編排(必開之集合、席位與各檢定標準之設定、本段環境、待判之清掃與重送名單、維護、時間守門、選題、步驟序列、報告);
//   逐核心動作鏈(載入、選篇、pass 與其落帳、渲染、落盤、逐棒日誌)在 stages/extractChain,步驟序列與專步排程在 stages/extractSteps,
//   無 AI 維護在 stages/extractMaintain,投影寫入器(渲染、投影、修復、分身、程式寫入)在 stores/coreProjection,待判之登錄與結案在
//   standards/holdSettle;編排與程式守門在 workflow/;提示詞、規則文字、分節摘要、版型屬 domain(domain/extractDomain)。
// 【寫入順序】dirty 標記 → 狀態(CAS、原子寫、.prev)→ 再驗磁碟 rev → md(手改偵測)→ cores 記錄 → 筆記 extractedAt → 分身 → 清 dirty。
//   中斷者下輪由 dirty 標記或載入時之對帳(rev 比對)以狀態重建投影(無 AI)。
// 【時間預算】各席位之預算於開工當下以整輪剩餘時間封頂(budget.capSeat),兩棒之間問 shouldStop;截止時本 pass 不套用、不計失敗,下輪再做。
// 【失敗帳】dirs.state 下之失敗帳(stores/extractLedger 之 ATTEMPTS_FILE):本段行程內單一共享物件(並行概念共寫,讀改寫會失落更新),每核心處理後原子寫;
//   記 tries／lastTriedAt／lastError(失敗即回隊尾)、noteTries(批內未涵蓋之重送次數)、整併嘗試。
//   凡「本輪對此核心有嘗試而未落盤」皆須落帳,否則選題每輪照選、每輪照失敗:AI 失敗、鏈內例外、狀態檔損壞／非本格式／遺失、
//   CAS 衝突 → tries＋1;時間預算截止只記 lastTriedAt(不是它的錯,但也不是沒試過)。
// 【分身】settleTwins 只在「主核心」(coreForKey 所選)落盤後執行;分身自己落盤時不得反過來把主核心標 merged(否則高版本之主核心被分身吞掉)。
// 【知識或關聯變更時更新核心(要點 2)】每輪順序:停用判斷 → dirty 補做 →
//   無 AI 維護(maintainCores:首見基準、墓碑驅動之撤出處／恢復、投影更新、重審項統計;在時間守門之前)→ 時間守門 → 選題(INFO)→
//   逐核心(待審 → [僅重審] → 整併 → 提煉批次×追趕;一般批先放重審筆記)→ 待審／僅重審專步。偵測在 stages/extractMaintain、重審項判定在 standards/recheck;
//   重審沿用 3+3 與既有操作詞彙(起草、審計、修訂、終審附【重審】段;所涉條目強制全文;撤回另有守門,coreState ⑯)。
//   關聯之增刪改(檢定標準 ES10;extract.recheck.relationImpact):維護時以邊庫快照差分產生事件、逐核心處置(relationImpact)——
//   非衝突新關聯之另一端入夥伴候選(重審管道最低優先:一般批補空位、閒置核心湊批走僅重審 pass)、經夥伴入批者之關聯變更與
//   衝突理由更新(有爭議涉及)→ 重審;處置與「不需更新」之理由寫 extract-impact.jsonl。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import { applyTaps, budgetOf, listHolds, noteDocIdOf, pipelineDueOf, retryRequestedOf, sha1, stageFields, stdReport } from '../core/capturePackage.mjs'
import { readConflictEvents, readEdgeAudit, relateDomainNeedsOf } from '../core/relatePackage.mjs'
import { extractFeatureProblems, extractPickOf, extractResolvedProblem, extractSeatsProblem } from '../core/extractSettings.mjs'
import { extractStatInit } from '../logContract.mjs'
import { isReady, orphanNotes, pickCategories, pickConcepts } from '../stores/conceptSelection.mjs'
import { createContentCache, createNoTopCache, saveNoTopCache } from '../stores/contentCache.mjs'
import { coreAuxDirs, coreStoreOf } from '../stores/coreStore.mjs'
import { ATTEMPTS_FILE, CONTENT_CACHE_FILE, EDGE_SEEN_FILE, EXTRACT_LEDGER_SHAPES, IMPACT_RETRY_FILE, NO_TOP_CACHE_FILE, readLedgerJson } from '../stores/extractFiles.mjs'
import { ES15, EXTRACT_API_HINT, parseItemOid } from '../stores/extractHolds.mjs'
import { createExtractLedger } from '../stores/extractLedger.mjs'
import { extractMaterialOf } from '../stores/noteFacts.mjs'
import { renderRules } from '../stores/stateDigest.mjs'
import { ES14, ES14_OBJECT, disputeHoldSetsOf } from '../standards/disputeCheck.mjs'
import { sweepStaleHolds } from '../standards/holdSettle.mjs'
import { recheckItemsOf } from '../standards/recheck.mjs'
import { relationEventsOf } from '../standards/relationImpact.mjs'
import { ES9 } from '../standards/supportCheck.mjs'
import { relationTypeNowOf } from '../standards/coreStandards.mjs'
import { CLAIM_OBJECT } from '../standards/supportStock.mjs'
import { mwLoadState, mwPass, mwPersistState, mwRenderState, mwSelectNotes } from './extractChain.mjs'
import { consumeRegenIntents, maintainCores, redoDirtyProjections } from './extractMaintain.mjs'
import { createSteps, failStreaksOf } from './extractSteps.mjs'

export { EXTRACT_STATE_FILES, IMPACT_RETRY_FILE, PENDING_DROPPED_FILE } from '../stores/extractFiles.mjs'

/**
 * 提煉提示詞識別(檢定標準 ES15 之重送條件):起草提示詞模板(空輸入)＋規則表＋起草席位鏈——任一改變即視為「提示詞或席位已變」
 *
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} seats 輸入 settings.extract.ai
 * @returns {String} 回傳 12 碼識別
 * @example
 * const domain = createExtractDomain({})
 * console.log(extractPromptId(domain, EXTRACT_DEFAULT.ai) === extractPromptId(domain, EXTRACT_DEFAULT.ai))
 * // => true
 */
export function extractPromptId(domain, seats) {
    const tmpl = typeof domain?.buildProposePrompt === 'function' ? domain.buildProposePrompt({ concept: '', scope: 'concept', digest: '', batch: [], rulesText: renderRules(domain.rules || []), relations: '' }) : ''
    const chain = (seats?.drafters || []).map((x) => [x?.use || '', ...(Array.isArray(x?.fallback) ? x.fallback : [])].join('>'))
    return sha1(`${tmpl}\u0000${chain.join('|')}`).slice(0, 12)
}

/**
 * 提煉子階段:選題(概念層、類別層後備)→ 並行逐核心(待審裁決 → 整併(到期時)→ 3+3 提煉批次×追趕)→ 軟性截止。
 * hook 錨點:extract.extract.{loadState, selectNotes, pass, renderState, persistState}
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)
 * @param {Object} [opt.domain] 輸入整組置換之提煉領域物件，未給則用 ctx.deps.domains.extract
 * @param {Function} [opt.shouldStop] 輸入 AI 呼叫之中止判定(兩棒之間檢查)，預設 budgetOf(ctx).shouldStop
 * @param {Integer} [opt.minNotes] 輸入新核心門檻，未給則用 settings.extract.minNotes
 * @param {Integer} [opt.notesPerTarget] 輸入每批篇數，未給則用 settings.extract.notesPerConcept
 * @param {Integer} [opt.parallel] 輸入本輪並行核心數，未給則用 settings.extract.perRun;0＝本輪停用提煉(記 INFO,不選題、不呼叫 AI)
 * @param {Object} [opt.categoryFallback] 輸入類別後備之門檻 { minNotes, minGain }(給物件＝開啟；false＝停用)，未給或 null 則用 settings.extract.categoryFallback(預設 null＝停用)
 * @param {Function} [opt.deadline] 輸入軟性截止判定函數，未給則用 budgetOf(ctx).expired
 * @param {Integer} [opt.minRemainingMs=900000] 輸入開工與每一步之門檻:剩餘時間不足即不再開始下一步，未給則用 settings.extract.minRemainingMs
 * @returns {Object} 回傳 stage 物件 { name, run }
 * @throws {Error} 執行期 settings.extract.ai 不是 3+3 席位(見 extractSeatsProblem)、或 settings.extract 未經解析(缺鍵或型別不合;見 extractResolvedProblem)時拋出
 * @example
 * need test in nodejs.
 *
 * const stage = stageExtract({ minNotes: 2 })
 */
export function stageExtract(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps(
        [mwLoadState(opt), mwSelectNotes(opt), mwPass(opt), mwRenderState(opt), mwPersistState(opt)],
        opt.tap, { chainName: 'extract.extract' },
    )

    return {
        ...stageFields(opt, { name: 'extract' }),
        run: async (ctx) => {
            const { stores, settings, dirs, clock } = ctx.deps
            const k = settings.extract
            const log = ctx.log
            // 本輪統計:初值由日誌契約生成(logContract 之 extractStatInit;鍵之意義與分組見 EXTRACT_REPORT_KEYS.detail.extract 各列註解);
            //   條件鍵(backlog、disabled、skippedForBudget)於該條件下才寫入
            const stat = extractStatInit()
            // 必開之集合(判不了者須有處登錄、已檢者須有處記錄;缺者本輪任何寫入前即拋,不靜默略過)
            for (const name of ['notes', 'cores', 'relations', 'holds', 'checks']) {
                if (!isobj(stores?.[name])) throw new Error(`提煉段需要 stores.${name} 集合（notes、cores、relations、holds、checks 必開；${name === 'holds' ? EXTRACT_API_HINT.holdsStore : (name === 'checks' ? EXTRACT_API_HINT.checksStore : '每輪依賴之 stores')}）`)
            }
            const parallel = opt.parallel ?? k.perRun
            if (parallel === 0) {
                // 停用(extract.perRun 明給 0):合法設定,不是容量問題——不選題、不載入筆記、不呼叫 AI;dirty 補做、對帳與維護留待重新啟用之輪。
                //   型別與值域(負數、非整數、字串)由 resolveSettings 於啟動期拋錯,此處只認 0
                log.info('提煉停用：extract.perRun 為 0，本輪不選題、不呼叫 AI')
                return stdReport({ detail: { ...stat, disabled: true } })
            }
            const budget = budgetOf(ctx)
            const deadline = opt.deadline || budget.expired
            const minRemainingMs = opt.minRemainingMs ?? k.minRemainingMs
            const timeOk = () => !deadline() && budget.remainingMs() >= minRemainingMs
            const domain = opt.domain || ctx.deps.domains.extract
            const seatProblem = extractSeatsProblem(k.ai)
            if (seatProblem) throw new Error(seatProblem)
            // 設定須已解析(core/extractSettings 之 extractResolvedProblem):本段之各值只取解析後之設定、不另寫退路——缺鍵或型別不合即拋,不靜默改用預設
            const unresolved = extractResolvedProblem(ctx.deps.settings)
            if (unresolved) throw new Error(unresolved)
            // 各席位之預算於「開工當下」以剩餘時間封頂(budget.capSeat 之 getter):序列後段之棒拿到當時剩餘,進行中之最後一次嘗試於截止時被切斷
            const d0 = k.ai
            const seats = { drafters: d0.drafters.map((s) => budget.capSeat(s)), integrate: budget.capSeat(d0.integrate), audit: budget.capSeat(d0.audit), revise: budget.capSeat(d0.revise), accept: budget.capSeat(d0.accept) }
            // 已開啟之檢定標準(出處支持、存量、失撐、爭議、同義)所需之判定小組席位、domain 成員與規則(單一判定,組裝者之啟動期同讀);
            //   缺者本輪任何寫入前即拋,不等到該專步才爆
            const stdCfg = k.standards
            const e9 = stdCfg.ai
            const featureProblems = extractFeatureProblems(ctx.deps.settings, domain)
            if (featureProblems.length) throw new Error(featureProblems.join('；'))
            // 關聯 domain(衝突型、其舊名、型別現名化):缺之則衝突之重審、去向與關聯變更之影響全部靜默失能——本輪任何寫入前即拋
            //   (缺漏之判準在關聯套件 relateDomainNeedsOf,組裝期之 createExtractRuntime 同讀)
            const relDomain = ctx.deps.domains?.relate
            const relMissing = relateDomainNeedsOf(relDomain)
            if (relMissing.length) throw new Error(`提煉需要關聯 domain：每輪依賴之 domains 須給 relate（缺 ${relMissing.join('、')}）——衝突之重審、衝突之去向（ES5）與關聯變更之影響（ES10）皆依之判定`)
            // 判定小組專步之逐項次數上限(maxTries;同一項缺票或同一供應者逾此次數 → 待判;爭議、存量、失撐、同義各取其設定;新進覆核之判不了逾此次數 → 使用者)
            // 出處支持覆核(檢定標準 ES9):開啟時三席(預算同其他棒於開工當下封頂);未開啟 → null(runPass 不覆核)
            const supportCheck = stdCfg.supportCheck.enabled === true ? { seats: { first: budget.capSeat(e9.first), second: isobj(e9.second) ? budget.capSeat(e9.second) : null, third: isobj(e9.third) ? budget.capSeat(e9.third) : null }, maxTries: stdCfg.supportCheck.maxTries } : null
            // 爭議覆核(檢定標準 ES14;開啟判準只看 perRun > 0):開啟時沿用提煉之覆核席(extract.standards.ai;first 與 second 必填)
            const dsp = stdCfg.disputeCheck
            const disputeCheck = dsp.perRun > 0
                ? {
                    seats: { first: budget.capSeat(e9.first), second: budget.capSeat(e9.second), third: isobj(e9.third) ? budget.capSeat(e9.third) : null },
                    perRun: dsp.perRun,
                    minVersions: dsp.minVersions,
                    waitDays: dsp.waitDays,
                    maxTries: dsp.maxTries,
                }
                : null
            // 出處支持之存量覆核(ES9 存量)、失撐主張之專責佇列(ES8):沿用覆核席(extract.standards.ai;first 與 second 必填);存量之修訂用提煉之修訂席
            const stockPerRun = stdCfg.supportStock.perRun
            const orphanPerRun = stdCfg.orphanCheck.perRun
            const claimCheckSeats = stockPerRun > 0 || orphanPerRun > 0 ? { first: budget.capSeat(e9.first), second: budget.capSeat(e9.second), third: isobj(e9.third) ? budget.capSeat(e9.third) : null } : null
            const supportStock = stockPerRun > 0 ? { perRun: stockPerRun, seats: claimCheckSeats, reviseSeat: seats.revise, maxTries: stdCfg.supportStock.maxTries } : null
            const orphanCheck = orphanPerRun > 0 ? { perRun: orphanPerRun, seats: claimCheckSeats, maxTries: stdCfg.orphanCheck.maxTries } : null
            // 同義核心核對(ES11):每輪候選對數與同一對缺票之次數上限(逐對計次記於失敗帳之全域鍵 step|synonym)
            const synPerRun = stdCfg.synonymCheck.perRun
            const synonymCheck = synPerRun > 0 ? { perRun: synPerRun, maxTries: stdCfg.synonymCheck.maxTries } : null
            const aux = coreAuxDirs(dirs)
            const conflictType = relDomain.conflictType
            // 衝突型之現名與改名表中之舊名(檢定標準 RS1′:關聯段維護改寫前之一輪仍認得舊名);讀入後型別一律以現名呈現
            const conflictNames = relDomain.conflictTypeNames.length ? relDomain.conflictTypeNames : [conflictType]
            const typeNow = (e) => {
                const t = relDomain.resolveType(e.type)
                return t && t !== e.type ? { ...e, type: t } : e
            }
            // 【關聯脈絡】之型別(settings.extract.relationTypes):'conflict' 只載衝突型;'linked'／'all' 載全型別(脈絡用),
            //   衝突型另存 relEdges(重審、seenConflicts、維護只看衝突型)
            const relationTypes = k.relationTypes
            // 關聯變更之影響(ES10)須全型別之邊(快照差分);未開啟且脈絡只用衝突型時只載衝突型
            const impactOn = k.recheck.relationImpact === true
            const [notes, cores, relations0] = await Promise.all([
                stores.notes.select(), stores.cores.select(),
                relationTypes === 'conflict' && !impactOn ? Promise.all(conflictNames.map((t) => stores.relations.select({ type: t }))).then((xs) => xs.flat()) : stores.relations.select(),
            ])
            const relations = relations0.map(typeNow)
            const conflicts = new Map()
            const relEdges = []
            for (const e of relations) {
                if (e.type !== conflictType) continue
                relEdges.push(e)
                conflicts.set(e.from, [...(conflicts.get(e.from) || []), e.to])
                conflicts.set(e.to, [...(conflicts.get(e.to) || []), e.from])
            }
            const ledger = createExtractLedger(path.join(dirs.state, ATTEMPTS_FILE), { stamp: clock.stamp8(), log })
            const env = {
                dirs,
                stores,
                aux,
                cores,
                notesById: new Map(notes.map((n) => [n.id, n])),
                docsById: new Map(), // 選題後只取候選筆記所屬之文件(發布時間、來源;文件數以萬計,不整庫載入)
                conflicts,
                relEdges, // 衝突型關聯邊:重審(新衝突)、seenConflicts、維護之首見基準
                conflictIds: new Set(relEdges.map((e) => e.id)), // 當下衝突邊 id(衝突已不成立之判定:事件之邊當下仍非衝突)
                conflictEvents: readConflictEvents(dirs.state), // 關聯段重評之衝突撤銷／降級事件(帳驅動;關聯套件之衝突事件帳)
                ctxEdges: relationTypes === 'conflict' ? relEdges : relations, // 起草提示詞之【關聯脈絡】(只列觸及本批者;workflow/relationContext)
                relationTypes,
                conflictType,
                levels: domain.evidence?.levels || [],
                ledger,
                log,
                at: clock.iso8(),
                stamp: clock.stamp8(),
                store: coreStoreOf(dirs),
                shouldStop: opt.shouldStop || budget.shouldStop,
                remainingMs: budget.remainingMs, // 與 shouldStop 同源;席位預算用盡且剩餘不足一次嘗試 → 視為截止(workflow/runPass cutOff)
                contentCache: createContentCache(path.join(dirs.state, CONTENT_CACHE_FILE), domain), // 已消化筆記之內容鍵(mtime＋大小快取)
                recheck: new Map(), // 核心 id → 本輪開工時之重審項(維護時統計;選篇時以當下狀態重算)
                essenceNeeds: new Map(), // 核心 id → 本質之需求(ES6;維護時統計,本質專步據以選核心;執行時以當下狀態再判)
                recheckBlocked: false, // 內容變更守門觸發(本輪不排 changed)
                contentOf: null, // 檢定標準之出處內容(見下;本輪內快取)
                supportCheck, // 出處支持覆核(ES9;未開啟為 null)
                disputeCheck, // 爭議覆核(ES14;未開啟為 null)
                disputeNeeds: new Map(), // 核心 id → 到期之存疑爭議 [{ id, age, days }](ES14;維護時統計)
                disputeHeld: new Map(), // 核心 id → 待判中(未要求重試)之爭議 id 集合(ES14;不再自動排入)
                disputeWaived: new Map(), // 核心 id → Map(爭議 id → 豁免時刻)(ES14;豁免後無新存疑者不再排入)
                supportStock, // 出處支持之存量覆核(ES9 存量;未開啟為 null)
                orphanCheck, // 失撐主張之專責佇列(ES8;未開啟為 null)
                stockNeeds: new Map(), // 核心 id → 須(重)檢之主張 [{ id, hash, never, held }](ES9 存量;維護時統計)
                orphanNeeds: new Map(), // 核心 id → 須(重)檢之失撐主張 [{ id, hash }](ES8;維護時統計)
                stockRetry: new Map(), // 核心 id → 使用者要求重判之主張 id 集合(ES9 存量)
                stockWaived: new Map(), // 核心 id → 使用者豁免(保留)之主張 id 集合(ES9 存量;解除隔離)
                orphanRetry: new Map(), // 核心 id → 使用者要求重判之失撐主張 id 集合(ES8)
                impact: null, // 關聯變更之影響(ES10;開啟時見下)
            }
            // 筆記之內容鍵(ES9 存量之雜湊用;mtime＋大小快取,不可得為 '')
            env.noteKeyOf = (nid) => String(env.contentCache.keyOf(env.notesById.get(nid)) ?? '')
            // 出處之推定判定(核心 md 之推定標記;mtime＋大小快取,判準為 domain 之證據規則)——本段之各落盤路徑經 renderOf 同讀此函數
            env.noTopCache = createNoTopCache(path.join(dirs.state, NO_TOP_CACHE_FILE), domain.evidenceRule ?? null)
            env.noTopOf = (nid) => env.noTopCache.of(env.notesById.get(nid))
            // 重練意圖之消化(清其失敗帳與影響留待;在影響留待讀入之前)
            consumeRegenIntents(env, log)
            // 關聯變更之影響(檢定標準 ES10):邊庫快照差分(撤銷以撤出稽核為證;型別改名不算改型)→ 本輪事件;前次未能處置之核心另有留待之事件
            if (impactOn) {
                const typeOf = relationTypeNowOf(relDomain)
                // 快照與留待皆為狀態(非派生檔):壞檔或錯形狀即隔離並告警(stores/extractFiles);快照壞了本輪只能以現行邊重建基準——載明其間之事件不產生,不假稱首見
                let snapshotCorrupt = false
                const prevSnap = readLedgerJson(path.join(dirs.state, EDGE_SEEN_FILE), { shape: EXTRACT_LEDGER_SHAPES.edgeSeen, stamp: env.stamp, log, hint: '本輪以現行邊重建快照基準（其間之關聯變更事件不產生）', onCorrupt: () => { snapshotCorrupt = true } })
                const ev = relationEventsOf(prevSnap, relations, readEdgeAudit(dirs.state), { typeOf })
                const isConflict = (t) => !!t && (t === conflictType || conflictNames.includes(t))
                const edgeById = new Map(relations.map((e) => [e.id, e]))
                const nowMs = Date.parse(env.at)
                const retry = readLedgerJson(path.join(dirs.state, IMPACT_RETRY_FILE), { shape: EXTRACT_LEDGER_SHAPES.impactRetry, stamp: env.stamp, log, hint: '留待之事件已失，無法補審' })
                env.impact = {
                    baseline: ev.baseline,
                    snapshotCorrupt,
                    events: ev.events,
                    edges: relations,
                    isConflict,
                    retry: isobj(retry) ? retry : {},
                    perCore: [], // [{ core, rows }]:已落盤之處置(影響帳)
                    done: new Set(), // 已處置之核心(未處置者之事件留待下輪)
                    readyOf: (nid) => isReady(env.notesById.get(nid), nowMs, k.relateGraceDays),
                    edgeOf: (id) => {
                        const e = edgeById.get(id)
                        return e && !isConflict(e.type) ? e : null
                    },
                }
            }
            // 重審項之單一算法(維護之統計、選篇共用;standards/recheck 之 recheckItemsOf)
            env.recheckItemsFor = (s, coreId) => recheckItemsOf(s, {
                notesById: env.notesById,
                conflictEdges: env.relEdges,
                keyOf: (nid) => env.contentCache.keyOf(env.notesById.get(nid)),
                version: env.contentCache.enabled ? env.contentCache.version : '',
                conflictEvents: env.conflictEvents,
                resend: env.resend.get(coreId) || [],
                ...(env.impact ? { impact: true, readyOf: env.impact.readyOf, edgeOf: env.impact.edgeOf } : {}),
            })
            // 已不適用之未結待判先清掃(落盤未完成之假待判、筆記已刪、核心不在、條目終態),再算重送名單——否則假待判會被重送
            await sweepStaleHolds(env, log, stat)
            // 逾限筆記之待判登錄(檢定標準 ES15):提示詞識別(起草模板＋規則＋起草席位鏈)變更、或使用者要求重試(摘要套件之 requestRetry)→ 本輪重送
            env.promptId = extractPromptId(domain, d0)
            env.resend = new Map() // 核心 id → 重送之筆記 id
            {
                for (const h of await listHolds(stores.holds, { status: 'open', object: ES15.object, std: ES15.std })) {
                    const { coreId, id: nid } = parseItemOid(h.oid)
                    if (!coreId || !nid) continue
                    if (h.ctx?.promptId !== env.promptId || retryRequestedOf(h)) env.resend.set(coreId, [...(env.resend.get(coreId) || []), nid])
                }
                // 出處支持覆核判不了(ES9):負責者 pipeline 者下次處理本核心時重送;使用者要求重試者同
                for (const h of await listHolds(stores.holds, { status: 'open', object: ES15.object, std: ES9.std })) {
                    const { coreId, id: nid } = parseItemOid(h.oid)
                    if (!coreId || !nid) continue
                    if (pipelineDueOf(h)) env.resend.set(coreId, [...new Set([...(env.resend.get(coreId) || []), nid])])
                }
                // 主張層(ES9 存量、ES8)之待判:使用者要求重試 → 本輪強制重判;ES9 之豁免 → 維護時解除隔離
                if (supportStock || orphanCheck) {
                    for (const h of await listHolds(stores.holds, { object: CLAIM_OBJECT })) {
                        const { coreId, id: cid } = parseItemOid(h.oid)
                        if (!coreId || !cid) continue
                        const add = (m) => m.set(coreId, new Set([...(m.get(coreId) || []), cid]))
                        if (h.std === ES9.std && h.status === 'waived') add(env.stockWaived)
                        else if (h.status === 'open' && retryRequestedOf(h)) add(h.std === ES9.std ? env.stockRetry : env.orphanRetry)
                    }
                }
                // 爭議覆核判不了(ES14):待判中者不再自動排入;使用者要求重試者(重試時刻晚於登錄更新)照常排入;
                //   使用者豁免(保留爭議與存疑)者亦不再排入——除非其後又有新的終審存疑(存疑時刻晚於豁免;維護時以當下狀態判,standards/disputeCheck 之 disputeHeldIdsOf)
                if (disputeCheck) {
                    for (const [coreId, x] of disputeHoldSetsOf(await listHolds(stores.holds, { object: ES14_OBJECT, std: ES14.std }), retryRequestedOf)) {
                        env.disputeHeld.set(coreId, x.held)
                        env.disputeWaived.set(coreId, x.waived)
                    }
                }
            }
            // 檢定標準 ES2／ES16 之材料(stores/noteFacts 之 extractMaterialOf;與符合度掃描同一定義);讀不到 → null(未能判定);本輪內快取
            const contentMemo = new Map()
            env.contentOf = (nid) => {
                if (!contentMemo.has(nid)) contentMemo.set(nid, extractMaterialOf(env.notesById.get(nid)))
                return contentMemo.get(nid)
            }

            // 前次中斷者之投影補做(dirty 標記;無 AI)
            await redoDirtyProjections(env, domain, log, stat)
            // 無 AI 之維護(首見基準、撤出處／恢復、投影更新、重審項):在時間守門之前——不需 AI,不因時間不足而停擺
            await maintainCores(env, domain, log, stat, k)
            if (!timeOk()) {
                const rem = budget.remainingMs()
                log.info(`提煉：${deadline() ? '逾時間預算' : `剩餘時間預算 ${Math.round(rem / 1000)}s 不足下限 ${Math.round(minRemainingMs / 1000)}s`}，本輪不再提煉`)
                failStreaksOf(env, ledger, stat)
                return stdReport({ detail: { ...stat, skippedForBudget: true } })
            }

            // 選題參數取設定之單一映射(extractPickOf;外部巡檢之待提煉估算同讀),本段只加 opt 之覆寫、失敗帳與現在時刻
            const picked = extractPickOf(ctx.deps.settings)
            const catchup = picked.catchup
            const pick = {
                ...picked,
                minNotes: opt.minNotes ?? picked.minNotes,
                notesPerTarget: opt.notesPerTarget ?? picked.notesPerTarget,
                attempts: Object.fromEntries(Object.entries(ledger.data).map(([key, v]) => [key, v])),
                now: Date.parse(env.at),
            }
            // 本輪開工時之積壓(主標籤、該核心未用過之篇數,含未達入選下限者):外部巡檢以其走勢對照實際消化(notesUsed)
            stat.backlog = pickConcepts(notes, cores, { ...pick, minPending: 0, maxWaitDays: 0, attempts: {} }).reduce((n, t) => n + t.pending.length, 0)
            let targets = pickConcepts(notes, cores, pick).slice(0, parallel)
            // 閒置輪(概念層無一般目標)之空餘名額,依序:
            //   ①久候尾數:既有核心只剩 1～3 篇待提煉且等待逾 extract.maxWaitDays 者——一般規則(≥ extract.minPending)下永不入選,
            //     概念不再進料時這幾篇就永遠進不了核心;閒置輪不擠占滿批,故只在此補做
            //   ②類別後備(預設停用;opt／extract.categoryFallback 給物件才開啟):只收久候孤兒,見 stores/conceptSelection 之 orphanNotes
            if (targets.length === 0) {
                targets = pickConcepts(notes, cores, { ...pick, minPending: 1 }).filter((t) => t.core).slice(0, parallel)
                if (targets.length > 0) {
                    stat.tails = targets.length
                    log.info(`提煉：概念層無一般目標，補做久候尾數（${targets.map((t) => `${t.concept}×${t.pending.length}`).join('、')}）`)
                }
            }
            const cf = opt.categoryFallback ?? k.categoryFallback
            if (targets.length === 0 && isobj(cf)) {
                const orphans = orphanNotes(notes, cores, { minNotes: pick.minNotes, maxWaitDays: pick.maxWaitDays, graceDays: pick.graceDays, now: pick.now })
                targets = pickCategories(orphans, cores, { ...cf, notesPerTarget: pick.notesPerTarget, maxWaitDays: pick.maxWaitDays, graceDays: pick.graceDays, attempts: pick.attempts, now: pick.now, fallbackCategory: ctx.deps.vocab?.fallbackCategory }).slice(0, parallel)
                if (targets.length > 0) log.info(`提煉：概念層無合格群組，改走類別層（${targets.map((t) => t.concept).join('、')}；久候孤兒 ${orphans.length} 篇）`)
            }
            if (targets.length === 0) log.info(`提煉：無累積足量新筆記的概念${isobj(cf) ? '或類別' : ''}`)
            // 選題當下即落日誌(否則選題成功時無任何訊號,首行要等起草回來)
            const recheckNote = `${stat.recheckChanged || stat.recheckConflict ? `；重審待處理：內容變更 ${stat.recheckChanged} 篇、新衝突 ${stat.recheckConflict} 條` : ''}${stat.recheckRelation || stat.recheckPartner ? `；關聯影響待處理：關聯變更 ${stat.recheckRelation} 項、夥伴候選 ${stat.recheckPartner} 篇` : ''}${stat.withdrawn || stat.restored ? `；撤出處 ${stat.withdrawn} 篇、恢復 ${stat.restored} 篇` : ''}`
            if (targets.length) log.info(`提煉選題：${targets.map((t) => `${t.concept}×${t.pending.length}${t.core ? '' : '（新）'}`).join('、')}；積壓 ${stat.backlog} 篇${recheckNote}`)
            else if (recheckNote) log.info(`提煉：${recheckNote.slice(1)}`)
            stat.concepts = targets.length
            // 候選筆記所屬之文件(選篇之發布年與來源):逐筆 get,無 get 之集合實作才整庫 select;未開 docs 集合者不取
            //   (選篇之發布年退樣本期末年、再退建立年,來源退筆記之 sourceName)
            const docIds = stores.docs ? [...new Set(targets.flatMap((t) => (t.candidates || []).map((c) => noteDocIdOf(c.note))).filter(Boolean))] : []
            if (docIds.length && typeof stores.docs.get === 'function') {
                for (const id of docIds) {
                    const d = await stores.docs.get(id)
                    if (d) env.docsById.set(id, d)
                }
            }
            else if (docIds.length) for (const d of await stores.docs.select()) env.docsById.set(d.id, d)

            // 逐核心之步驟序列與專步排程(stages/extractSteps):一般目標並行 → 其後以剩餘時間排之專步;鏈之統計併入本輪統計
            const steps = createSteps({ env, ctx, chain, domain, seats, ledger, stat, log, k, pick, catchup, parallel, timeOk, budget, e9, synonymCheck })
            await Promise.all(targets.map(steps.serve))
            await steps.runSteps()
            if (stat.unsectioned) log.warn(`提煉：${stat.unsectioned} 篇筆記找不到預設章節（自訂筆記版型？），摘要退回截斷正文；請以 domains.extract.noteDigest 對應自訂章名`)
            saveNoTopCache(env, log)
            failStreaksOf(env, ledger, stat)
            return stdReport({
                stats: { in: stat.concepts, out: stat.updated, skip: 0, fail: stat.failed, aiCalls: stat.aiCalls },
                detail: stat,
            })
        },
    }
}

export default stageExtract
