// unit-extract-entry.test.mjs — 入口契約:具名匯出與預設匯出為同一組成員、全部公開模組之匯出皆掛入入口(同名即同一實作)、無名稱衝突、
//   不轉出抓取、摘要與關聯套件之件、關鍵積木存在
// 規則(出自 WKnowledgeExtract 檔頭):
//   ①公開模組各列一次,具名匯出與預設物件由同一組命名空間合成,必然同一組名稱
//   ②兩個公開模組匯出同名而不同實體時載入即拋(export * 會靜默剔除該名,以具名匯入取用時才爆)
//   ③不列入者:三個單一匯入點 core/capturePackage.mjs(抓取埠)、core/summarizePackage.mjs(摘要埠)、core/relatePackage.mjs(關聯埠)——不是本套件
//     之公開模組;三套件之件自其套件取用
//   ④拆檔不得隱性丟名:現入口之名集 ⊇ 拆檔前之名集(凍結之清單)
// 名稱之全集由各公開模組之命名空間推導(不手寫全部名稱:他模組新增之匯出自然掛入);關鍵積木之抽查只列既有之名。
// 【本檔為入口四條規則之唯一家】具名＝預設、無 undefined 成員、全部公開模組之具名匯出掛入入口、入口成員恰為其聯集——unit-extract-package 不另寫
//   (其 ③ 只守與上游之撞名與各模組之預設匯出;同一規則只一份)。原始檔之走訪取抓取套件之共用件 sourceFilesOf(經 captureForTest)。
// 執行:自套件根 node <mocha> test/unit-extract-entry.test.mjs
// 【以本檔位置定根,不用 cwd】本測試會 import(＝執行)根下每一支 .mjs,套件根須與 cwd 無關

import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import WKnowledgeExtract, * as NS from '../src/WKnowledgeExtract.mjs'
import * as CapturePort from '../src/core/capturePackage.mjs'
import * as SummarizePort from '../src/core/summarizePackage.mjs'
import * as RelatePort from '../src/core/relatePackage.mjs'
import { sourceFilesOf } from './tools/captureForTest.mjs'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 不是公開模組:三個單一匯入點(轉出抓取／摘要／關聯套件之件)
const NOT_PUBLIC = new Set(['core/capturePackage.mjs', 'core/summarizePackage.mjs', 'core/relatePackage.mjs'])

// 入口中與抓取套件之件同一實體之名:提煉之 ai 段即抓取套件之 ai 段之 schema(以本套件之名別名轉出同一物件,不另寫)
const CAPTURE_SAME_ALLOWED = Object.freeze({ EXTRACT_AI_SCHEMA: 'AI_SCHEMA' })

// 拆檔前之入口名集(2026-10-30 P3a 拆檔前取自入口之具名匯出,去 default;共 438 名)——拆檔後之入口名集須為其超集
// 拆檔後之改名(舊名 → 新名;P4 小件收斂 2026-10-30:JSON 擷取之 extractObject 與提煉物件 extractObject.mjs 同名異義,改名 replyObjectOf)——
//   名集守門以新名核對;刪名須列於此(新名為 null)並註明去向
//   P5a 評分 2026-10-30:benchCallResultOf(單棒結果 → callJson 之形狀)與抓取調度層之同一規則收斂為抓取套件之 callJsonShapeOf(評分之角色經抓取埠取用),
//   提煉不再轉出——刪名
const RENAMED_SINCE_SPLIT = Object.freeze({ extractObject: 'replyObjectOf', benchCallResultOf: null })

const NAMES_BEFORE_SPLIT = Object.freeze([
    'ACCEPT_DROP_PREFIXES', 'ANNOTATION_UNSTATED', 'ARCHIVE_TAGS', 'ATTEMPTS_FILE', 'CFG_KEYS', 'CLAIM_OBJECT', 'COLLECTION_KEYS', 'CONFLICT_DISPOSITIONS',
    'CONSOLIDATE_OPS', 'CONSTRUCTIVE_OPS', 'CONTENT_CACHE_FILE', 'CONTENT_KEY_VERSION', 'CORE_FIX_STDS', 'CORE_HOLD_OBJECT', 'CORE_SECTION_TITLES', 'CORE_STANDARDS',
    'CORE_STATUS', 'CORRUPT_STATE_CODE', 'DATA_KEYS', 'DEFAULT_CLAIM_KINDS', 'DEFAULT_LIMITS', 'DELTA_OPS', 'DESTRUCTIVE_OPS', 'DISPUTE_DROP_REASONS',
    'DISPUTE_VERDICTS', 'DISPUTE_WORD', 'DISSOLVED_RETRACT_REASON', 'DISSOLVE_DROP_REASONS', 'DOUBT_REASONS', 'DROP_REASONS', 'EDGE_SEEN_FILE', 'ES11',
    'ES14', 'ES14_OBJECT', 'ES15', 'ES15_OBJECT', 'ES8', 'ES9', 'ES_BY_MISMATCH', 'ES_CASE_CONCEPT',
    'ES_CASE_PAGE_SIZE', 'ES_CASE_STDS', 'ES_NOT_NOFIELDS', 'EXHAUSTED_REASON', 'EXTRACT_AI_DEFAULT', 'EXTRACT_AI_SCHEMA', 'EXTRACT_AI_STANDARD_IDS', 'EXTRACT_API_HINT',
    'EXTRACT_AUDITED_STANDARD_IDS', 'EXTRACT_BENCH_CASES_FILES', 'EXTRACT_BENCH_MODELS', 'EXTRACT_BENCH_ROLES', 'EXTRACT_BENCH_USAGE', 'EXTRACT_CAPACITY_DESC', 'EXTRACT_DATA_KEYS', 'EXTRACT_DEFAULT',
    'EXTRACT_DIRS', 'EXTRACT_DOMAIN_KEYS', 'EXTRACT_DOMAIN_MEMBERS', 'EXTRACT_FEATURES', 'EXTRACT_GUIDE_FIELDS', 'EXTRACT_HOLD_DEADLINE_DAYS', 'EXTRACT_HOLD_NEXT', 'EXTRACT_HOLD_OBJECTS',
    'EXTRACT_LEDGER_CORRUPT_WORD', 'EXTRACT_LEDGER_SHAPES', 'EXTRACT_LEDGER_STEP_PREFIX', 'EXTRACT_LOG_KNOWN', 'EXTRACT_LOG_MUST_SEE', 'EXTRACT_LOG_PARSE', 'EXTRACT_PANEL_WHY', 'EXTRACT_PANEL_WHY_LABELS',
    'EXTRACT_PROMPT_SIGS', 'EXTRACT_REPORT_KEYS', 'EXTRACT_SCAN_OBJECT', 'EXTRACT_SCHEMA', 'EXTRACT_SEAT_KEYS', 'EXTRACT_SEAT_LABELS', 'EXTRACT_SETTING_TYPES', 'EXTRACT_STAGE_KEYS',
    'EXTRACT_STANDARDS', 'EXTRACT_STATE_FILES', 'EXTRACT_STORE_KEYS', 'EXTRACT_STUCK_TRIES', 'EXTRACT_TAP_STAGE_KEYS', 'EXTRACT_VOCAB_DEFAULT', 'EXTRACT_VOCAB_KEYS', 'FIXABLE_FIELDS',
    'FOREIGN_STATE_CODE', 'HOLD_STALE_HOW_PREFIX', 'HOLD_UNDO_HOW', 'HOLD_VOID_HOWS', 'IMPACT_LEDGER_FILE', 'IMPACT_RETRY_FILE', 'ITEM_TEXT_FIELDS', 'KIND_LABELS',
    'LEAK_PHRASES', 'MERGE_KEEP_MIN', 'NEW_ITEM_DROP_REASONS', 'NOTE_CODE_RE', 'NOTE_LINK_RE', 'NOTE_SECTIONS', 'NO_MATERIAL_TEXT', 'NO_TOP_CACHE_FILE',
    'OFFTOPIC_REASON', 'ORPHAN_VERDICTS', 'PENDING_DROPPED_FILE', 'PENDING_REVIEW_CAP', 'PROGRAM_RETRACT_REASONS', 'PROMPT_KEYS', 'REBASELINE_FILE', 'RECHECK_SKIP_REASONS',
    'REGEN_FILE', 'REPORTED_BASIS', 'RETRACT_REASONS', 'REVISABLE_KINDS', 'REVISE_CASE_KINDS', 'REVIVABLE_RETRACT', 'REVIVE_GATE_STDS', 'SIDE_TEXT_FIELDS',
    'SKIP_REASONS', 'SPLIT_COVER_MIN', 'SPLIT_PART_MIN', 'STATE_VERSION', 'STD_ISSUE_TYPE', 'STOCK_STDS', 'SUPPORT_GATE_WHY', 'SUPPORT_PAGE_CHARS',
    'SUPPORT_VERDICTS', 'SUPPORT_WORD', 'SYNONYM_LEDGER_KEY', 'SYNONYM_STATE_FILE', 'SYNONYM_VERDICTS', 'TERMINAL_OPS', 'TERMINAL_OP_LABELS', 'TERMINAL_STATUSES',
    'UNASSESSED', 'URGENT_RECHECK_REASONS', 'VERDICT_MIN_REASON', 'agreedLabelsOf', 'annotationProblems', 'applyCoreStockFix', 'applyCtxOf', 'applyDelta',
    'applyImpact', 'applyPatch', 'applyRefAliases', 'applySupportFixes', 'applyVerdicts', 'applyWithInvariants', 'auditExtractStandards', 'bagOf',
    'benchCallResultOf', 'bestContainment', 'bodyHashOf', 'bracketRefs', 'buildAcceptAppendix', 'buildAuditPrompt', 'buildIntegratePrompt', 'buildRevisePrompt',
    'cancelRebaseline', 'checkAudit', 'checkCore', 'checkDisputeChecks', 'checkDisputeVerdictOf', 'checkDraft', 'checkInvariants', 'checkOrphanChecks',
    'checkOrphanVerdictOf', 'checkPatch', 'checkSupportChecks', 'checkSupportRevise', 'checkSupportVerdictOf', 'checkSynonymChecks', 'checkSynonymProposals', 'checkSynonymVerdictOf',
    'checkVerdicts', 'citedNotesOf', 'claimAssertion', 'closeRefs', 'codeMapOf', 'commitBatch', 'conflictDisposedOf', 'conflictGoneOf',
    'consumedNeedsRebaseline', 'containment', 'coreAuxDirs', 'coreFixOf', 'coreForKey', 'coreLedgerKeyOf', 'coreStateDirOf', 'coreStoreOf',
    'coreWriterOf', 'coverageOf', 'createContentCache', 'createCoreStore', 'createExtractDomain', 'createExtractLedger', 'createExtractObject', 'createExtractRuntime',
    'createKnowledgeExtract', 'createNoTopCache', 'createOpStandards', 'defaultRules', 'deriveStatus', 'disputeCaseOf', 'disputeCheckBenchRole', 'disputeDueOf',
    'disputeHashOf', 'disputeHeldIdsOf', 'disputeHoldSetsOf', 'disputeItemsOf', 'disputeProgressOf', 'dissolveOpOf', 'dissolveSidesOf', 'dissolveUsableOf',
    'doubtCheckedOf', 'droppedMajority', 'edgeSeenSyncOf', 'edgeSigOf', 'edgeSnapshotOf', 'editDistance', 'emptyState', 'es5CtxOf',
    'es5RowsOf', 'esCaseInputProblems', 'esDisputeClassOf', 'esExpectClassOf', 'esOrphanClassOf', 'esPageOf', 'esPageSizeOf', 'esPagesOfCases',
    'esSupportClassOf', 'esSynonymClassOf', 'esVotesOf', 'essenceLostOf', 'essenceNeedOf', 'excludedSourcesOf', 'extractAiCall', 'extractBenchRoleOf',
    'extractCapacityOf', 'extractDomainShapeProblems', 'extractFanout', 'extractFeatureProblems', 'extractGuideDefaultOf', 'extractHoldDeadlineOf', 'extractLedgerCorruptTextOf', 'extractMaterialOf',
    'extractObject', 'extractPanelsOf', 'extractPickOf', 'extractPromptId', 'extractReserveMs', 'extractScanOf', 'extractSeatHintsOf', 'extractSeatsOf',
    'extractSeatsProblem', 'extractStuckOf', 'extractSummaryOf', 'extractVocabWarningsOf', 'extractWarningsOf', 'fieldsOf', 'findItem', 'foldScript',
    'gateOps', 'gateVerdicts', 'groundingOf', 'groupByConcept', 'guardOps', 'holdItems', 'impactLedgerRowsOf', 'impactOfCore',
    'inferOp', 'isExtracted', 'isMainCore', 'isPrimaryCore', 'isReady', 'itemTexts', 'lengthCapOf', 'lengthIssues',
    'listCores', 'liveCoresOf', 'liveSourcesOf', 'makeEvidence', 'mdHashOf', 'mutualContainment', 'mwLoadState', 'mwPass',
    'mwPersistState', 'mwRenderState', 'mwSelectNotes', 'nameCandidatesOf', 'needsRebaseline', 'newCoreIdOf', 'nextRevOf', 'normText',
    'normalizeBareRefs', 'normalizeConflictDecl', 'normalizeDelta', 'normalizeIssues', 'normalizeState', 'notSupportedReasonsOf', 'noteMentionsOf', 'noteNoTopOf',
    'noteOfCode', 'opClass', 'opLengthProblem', 'opSidesOf', 'opStandardsCtxOf', 'orphanCandidatesOf', 'orphanCheckBenchRole', 'orphanHashOf',
    'orphanNeedsOf', 'orphanNotes', 'packOrphanPages', 'packSupportPages', 'pairKeyOf', 'pairOfKey', 'panelCallOf', 'panelRetryOf',
    'panelWhyLabelOf', 'parseAudit', 'parseDisputeChecks', 'parseDraft', 'parseExtractBenchArgs', 'parseOrphanChecks', 'parsePatch', 'parseSide',
    'parseSupportChecks', 'parseSupportRevise', 'parseSynonymChecks', 'parseSynonymProposals', 'parseVerdicts', 'pendingReviewOps', 'pickCategories', 'pickConcepts',
    'pickExtractVocab', 'pickRecheck', 'pickStock', 'planCoreStockFix', 'planExtractBench', 'prefixCandidate', 'previewRecheck', 'principleDocsProblem',
    'programUnion', 'programWriteProblems', 'proposedCandidatesOf', 'queuePendingReview', 'readCoreStockLedger', 'readLedgerJson', 'readRegenIntents', 'rebaselineDone',
    'rebaselineIdsOf', 'recheckDue', 'recheckItemsOf', 'refsOf', 'regenCore', 'relationContextRows', 'relationEventsOf', 'releaseHeld',
    'remapRefs', 'removalAllowed', 'renderRules', 'requestRebaseline', 'resolveExtractData', 'resolveExtractDirs', 'resolveExtractSettings', 'resolveExtractVocab',
    'revisableOf', 'reviseCaseOf', 'reviveClaims', 'reviveItems', 'rewriteTextFields', 'rollbackCoreStockFix', 'rulesTextOf', 'runDisputeCheck',
    'runDisputePass', 'runExtractBench', 'runExtractBenchCli', 'runOrphanCheck', 'runOrphanPass', 'runPanelPages', 'runPass', 'runPending',
    'runSupportCheck', 'runSupportGate', 'runSupportRevise', 'runSupportStockPass', 'runSynonymCheck', 'runSynonymStep', 'sameNegation', 'sameOrphan',
    'sameSubstance', 'saveLedgerJson', 'seatDisputeVotesOf', 'seatOrphanVotesOf', 'seatSupportVotesOf', 'seatSynonymVotesOf', 'selectNotes', 'setExcluded',
    'stageExtract', 'stateDigest', 'stateFingerprintOf', 'stateView', 'stockHashOf', 'stockNeedsOf', 'stripProgramFields', 'supportByEffects',
    'supportCheckBenchRole', 'supportClassOf', 'supportClassOfOp', 'supportFixesOf', 'supportHoldClosure', 'supportItemsOf', 'supportReviseBenchRole', 'supportingSourcesOf',
    'synonymCandidatesOf', 'synonymCheckBenchRole', 'synonymDueOf', 'synonymHashOf', 'synonymProposeBenchRole', 'textFieldsOf', 'touchedText', 'trialApply',
    'triedOf', 'trimToLimit', 'twinRedirectBodyOf', 'twinsOf', 'unsupportedOf', 'validateVia', 'verdictFieldsOf', 'verifyCoreStockChain',
    'voteOps', 'votesByIndexOf', 'withdrawSources', 'withdrawnOf', 'writeRegenIntents', 'yearOf',
])

/** 公開模組:套件之 src/ 下之 .mjs(共用走訪 sourceFilesOf;略 node_modules),去入口與三埠;路徑相對 src/(套件根之 toolg/、g.mjs 等發布與範例腳本不在其內,不可被 import 執行) */
const libraryFiles = () => sourceFilesOf(path.join(PKG, 'src')).filter((f) => f !== 'WKnowledgeExtract.mjs' && !NOT_PUBLIC.has(f))

/**
 * 入口中與某埠之件同一實體之名(入口名 → 埠名)
 *
 * @param {Object} port 輸入埠之命名空間
 * @returns {Object} 回傳 { 入口名: 埠名 }
 */
const sameEntitiesWith = (port) => {
    const byValue = new Map()
    for (const [k, v] of Object.entries(port)) if ((typeof v === 'object' && v !== null) || typeof v === 'function') byValue.set(v, k)
    return Object.fromEntries(Object.entries(WKnowledgeExtract).filter(([, v]) => byValue.has(v)).map(([k, v]) => [k, byValue.get(v)]))
}

describe('unit-extract-entry', function() {

    this.timeout(60_000)

    it('具名匯出與預設匯出為同一組名稱、同一實體;預設物件不含 default 鍵', () => {
        const named = Object.keys(NS).filter((k) => k !== 'default').sort()
        const dflt = Object.keys(WKnowledgeExtract).sort()
        assert.deepEqual(named, dflt, '兩種取用方式之成員須完全相同')
        for (const k of named) assert.equal(NS[k], WKnowledgeExtract[k], `${k}:具名與預設須為同一實體`)
        assert.equal('default' in WKnowledgeExtract, false)
        assert.ok(named.length > 300, `入口之名過少:${named.length}`)
    })

    it('入口成員皆有定義(無 undefined 成員)', () => {
        for (const [k, v] of Object.entries(WKnowledgeExtract)) assert.notEqual(v, undefined, k)
    })

    it('走訪涵蓋全部公開模組(各層目錄皆有模組、關鍵檔皆在):走訪不得空轉,否則下列匯出檢查恆過', () => {
        const files = libraryFiles()
        for (const f of ['createKnowledgeExtract.mjs', 'extractObject.mjs', 'extractRuntime.mjs', 'logContract.mjs', 'core/extractSettings.mjs', 'core/vocab/extractVocab.mjs',
            'stores/coreState.mjs', 'stores/coreDelta.mjs', 'stores/stateDigest.mjs', 'stores/coreStore.mjs', 'stores/coreProjection.mjs', 'stores/contentCache.mjs', 'stores/conceptSelection.mjs',
            'domain/extractDomain.mjs', 'domain/prompts.mjs', 'guards/similarity.mjs',
            'ops/recheckOps.mjs', 'ops/regenCore.mjs', 'ops/reviveClaims.mjs',
            'standards/parse.mjs', 'standards/opGuards.mjs', 'standards/registry.mjs', 'standards/audit.mjs', 'standards/stockFix.mjs', 'standards/coreStockFix.mjs', 'standards/recheck.mjs',
            'standards/relationImpact.mjs', 'standards/holdSettle.mjs', 'standards/esCases.mjs',
            'stages/extractStage.mjs', 'stages/extractChain.mjs', 'stages/extractSteps.mjs', 'stages/extractMaintain.mjs', 'stages/synonymStep.mjs',
            'workflow/aiCall.mjs', 'workflow/runPass.mjs', 'workflow/verdicts.mjs', 'bench/extractBench.mjs', 'bench/cli.mjs']) {
            assert.ok(files.includes(f), `走訪缺 ${f}`)
        }
        for (const d of ['stages', 'stores', 'ops', 'standards', 'domain', 'core', 'guards', 'workflow', 'bench']) assert.ok(files.some((f) => f.startsWith(`${d}/`)), `走訪缺目錄 ${d}/`)
        assert.ok(files.every((f) => !f.startsWith('test/') && !f.includes('node_modules')))
        for (const f of NOT_PUBLIC) assert.ok(!files.includes(f), `${f} 不列入`)
    })

    it('全部公開模組之具名匯出皆掛入入口且為同一實體(新增模組 export 而未掛入口即失敗)', async () => {
        const missing = []
        for (const f of libraryFiles()) {
            const mod = await import(pathToFileURL(path.join(PKG, 'src', f)).href)
            const own =Object.keys(mod).filter((k) => k !== 'default')
            assert.ok(own.length > 0, `${f} 無任何具名匯出(公開模組須有具名積木)`)
            for (const k of own) if (WKnowledgeExtract[k] !== mod[k]) missing.push(`${f}:${k}`)
        }
        assert.deepEqual(missing, [], '未掛入入口(或同名而不同實體)之具名匯出')
    })

    it('名稱無衝突:不同公開模組匯出同名時須為同一實體(獨立走訪重驗,不依賴載入期之檢查);入口之成員恰為各公開模組具名匯出之聯集', async () => {
        const owner = new Map()
        const conflicts = []
        for (const f of libraryFiles()) {
            const mod = await import(pathToFileURL(path.join(PKG, 'src', f)).href)
            for (const [k, v] of Object.entries(mod)) {
                if (k === 'default') continue
                const prev = owner.get(k)
                if (prev && prev.v !== v) conflicts.push(`${k}:${prev.f}／${f}`)
                if (!prev) owner.set(k, { f, v })
            }
        }
        assert.deepEqual(conflicts, [])
        assert.deepEqual([...owner.keys()].sort(), Object.keys(WKnowledgeExtract).sort(), '入口之成員恰為各公開模組具名匯出之聯集(無遺漏、無憑空名稱)')
    })

    it('不轉出抓取、摘要與關聯套件之件:入口中與三埠之件同一實體者只有具名之例外(ai 段之 schema 別名);三埠本身不是公開模組', () => {
        assert.deepEqual(sameEntitiesWith(CapturePort), CAPTURE_SAME_ALLOWED)
        assert.deepEqual(sameEntitiesWith(SummarizePort), {})
        assert.deepEqual(sameEntitiesWith(RelatePort), {})
        // 抽查:三套件之總組裝、核心件、筆記 md 之讀寫、關聯 domain 之工廠、評分核心皆不在入口(自其套件取用)
        for (const k of ['createKnowledgeCapture', 'createKnowledgeSummarize', 'createKnowledgeRelate', 'createAiAdapter', 'createRoundRunner', 'stdReport', 'readMd', 'writeMd',
            'createRelateDomain', 'pickRelateVocab', 'listHolds', 'putHold', 'requestRetry', 'waiveHold', 'defineBenchRole', 'defineBenchRoles', 'runBench', 'AI_SCHEMA', 'AI_DEFAULT']) {
            assert.equal(k in WKnowledgeExtract, false, k)
        }
    })

    it('關鍵積木存在且型別正確:總組裝、物件、執行期件、子階段、設定、詞彙、domain、核心狀態與其檔、選題、檢定標準(含登記、掃描與存量處置、題組之頁組法)、維運件、AI 能力評分、日誌契約', () => {
        const FUNCS = [
            'createKnowledgeExtract', 'createExtractObject', 'extractSummaryOf', 'createExtractRuntime', 'resolveExtractData', 'resolveExtractDirs',
            'stageExtract', 'mwLoadState', 'mwSelectNotes', 'mwPass', 'mwRenderState', 'mwPersistState',
            'resolveExtractSettings', 'extractSeatsOf', 'extractPanelsOf', 'extractWarningsOf', 'extractCapacityOf', 'extractSeatsProblem',
            'resolveExtractVocab', 'pickExtractVocab', 'extractVocabWarningsOf', 'createExtractDomain', 'extractDomainShapeProblems', 'extractFeatureProblems',
            'applyDelta', 'emptyState', 'checkInvariants', 'renderRules', 'coreStoreOf', 'pickConcepts', 'isMainCore', 'extractMaterialOf', 'needsRebaseline',
            'consumedNeedsRebaseline',
            'checkCore', 'auditExtractStandards', 'extractScanOf', 'esPagesOfCases', 'esPageOf',
            'applyVerdicts', 'coverageOf', 'stateDigest', 'coreWriterOf', 'maintainCores', 'createSteps', 'registerHolds', 'recheckItemsOf', 'createContentCache',
            'reviveClaims', 'runExtractBench', 'planExtractBench', 'runExtractBenchCli', 'extractBenchRoleOf', 'extractAiCall',
            // P4 小件收斂之共用件(同一規則一份)
            'callerOf', 'voteTextOf', 'itemOidOf', 'parseItemOid', 'allItemsOf', 'notesOfCodes', 'opIdOf', 'leakProblem', 'scriptBadOf', 'weakEvidenceProblem',
            'itemsInScopeOf', 'relationTypeNowOf', 'noteTitleFnOf', 'markExtracted', 'supportCheckCallOf', 'extractResolvedProblem', 'replyObjectOf',
            // P5a 評分之共用件(案 → 合成核心狀態、題組層之出處一致性、出處之比對、修訂之覆核說明、意見指向操作、待審裁決之提示詞)
            'coreStateOf', 'esSuiteProblems', 'esByMatchOf', 'reviseReasonsOf', 'reviseVotesProblems', 'issueOnOp', 'pendingReviewPromptOf',
        ]
        for (const k of FUNCS) assert.equal(typeof WKnowledgeExtract[k], 'function', k)
        const ARRAYS = ['CFG_KEYS', 'DATA_KEYS', 'PROMPT_KEYS', 'COLLECTION_KEYS', 'EXTRACT_STAGE_KEYS', 'EXTRACT_TAP_STAGE_KEYS', 'EXTRACT_STORE_KEYS', 'EXTRACT_DATA_KEYS', 'EXTRACT_DOMAIN_KEYS',
            'EXTRACT_LOG_KNOWN', 'EXTRACT_LOG_MUST_SEE', 'EXTRACT_VOCAB_KEYS', 'EXTRACT_SEAT_KEYS', 'EXTRACT_STANDARDS', 'EXTRACT_AUDITED_STANDARD_IDS', 'EXTRACT_AI_STANDARD_IDS',
            'TERMINAL_STATUSES', 'ES_CASE_STDS', 'EXTRACT_BENCH_ROLES', 'EXTRACT_BENCH_MODELS', 'EXTRACT_FEATURES', 'EXTRACT_UNGATED_WRITE_ENTRIES',
            'EXTRACT_BENCH_ROLE_IDS', 'WF_STRUCTURAL', 'SUPPORT_KINDS', 'REMOVE_TYPES']
        for (const k of ARRAYS) assert.ok(Array.isArray(WKnowledgeExtract[k]) && WKnowledgeExtract[k].length > 0, k)
        const OBJECTS = ['EXTRACT_REPORT_KEYS', 'EXTRACT_LOG_PARSE', 'EXTRACT_PROMPT_SIGS', 'EXTRACT_DIRS', 'EXTRACT_DEFAULT', 'EXTRACT_SCHEMA', 'EXTRACT_AI_DEFAULT', 'EXTRACT_AI_SCHEMA',
            'EXTRACT_VOCAB_DEFAULT', 'EXTRACT_GUIDE_FIELDS', 'EXTRACT_SEAT_LABELS', 'EXTRACT_DOMAIN_MEMBERS', 'CORE_STATUS', 'ES8', 'ES9', 'ES11', 'ES14', 'ES15', 'EXTRACT_API_HINT', 'EXTRACT_HOLD_NEXT', 'EXTRACT_STATE_FILES', 'REF_FIELDS', 'TERMINAL_SET', 'DISPUTE_OPS',
            'ISSUE_TYPES', 'RECHECK_REASONS', 'RECHECK_SKIP', 'KEY_OF_PREFIX']
        for (const k of OBJECTS) assert.equal(typeof WKnowledgeExtract[k], 'object', k)
        // 執行期件之提示詞覆寫表即 domain 之同一實體(組裝者一處取齊)
        assert.equal(WKnowledgeExtract.EXTRACT_PROMPT_SIGS, NS.EXTRACT_PROMPT_SIGS)
    })

    it('入口名集 ⊇ 拆檔前之名集(經改名對照;拆檔不得隱性丟名:兩模組同名而不同實體時 export * 會靜默剔除該名)', () => {
        const now = new Set(Object.keys(NS).filter((k) => k !== 'default'))
        assert.ok(Object.isFrozen(NAMES_BEFORE_SPLIT) && NAMES_BEFORE_SPLIT.length === 438, '名集凍結且完整')
        assert.deepEqual(Object.keys(RENAMED_SINCE_SPLIT).filter((k) => !NAMES_BEFORE_SPLIT.includes(k) || now.has(k)), [], '改名對照之舊名須在拆檔前之名集、且已不在現入口')
        const want = NAMES_BEFORE_SPLIT.map((k) => (k in RENAMED_SINCE_SPLIT ? RENAMED_SINCE_SPLIT[k] : k)).filter((k) => k !== null)
        assert.deepEqual(want.filter((k) => !now.has(k)), [], '拆檔前之名(經改名對照)於現入口缺')
    })
})
