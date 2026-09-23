// WKnowledgeExtract.mjs — 主入口:通用知識之抓取、萃取、關聯與提煉套件
//
// 安裝即用(僅 workDir 必填),六層擴充入口(cfg 覆寫/pipeline 重排/stages 重組/tap 掛載/mw opts/plugins),
// 全部積木具名匯出——安裝方依自己的管線自由組裝,不需改套件。領域(主題範圍、分類詞彙、prompt、抓取器)皆可注入。
// 排程任務執行殼(設定載入/時鐘/每次一檔日誌/runTask/行程安全網/Telegram/AI 接線/子進程隔離)另有輕量入口
// ./taskRunner.mjs(不載入本管線;本入口亦含其全部成員,同名即同一實作)。

import { createKnowledgeExtract } from './core/createKnowledgeExtract.mjs'
import { createFetchObject, createOrganizeObject, createRelateObject, createDistillObject } from './core/objects.mjs'
import { defineMw, defineFirstMw, applyTaps, makeMsg, count, composeChain, runChainOverMsgs, stdReport, MwContractError } from './core/kernel.mjs'
import { resolvePlugins, mergeTaps } from './core/plugins.mjs'
import { acquireLock } from './core/lock.mjs'
import { resolveSettings, FETCH_DEFAULT, KNOWLEDGE_DEFAULT, SOURCE_POLICY_DEFAULT, AI_DEFAULT, SKIP_TITLE_PATTERNS_DEFAULT } from './core/settingsDefault.mjs'
// ── 子階段工廠與 mw 積木 ──
import { stageSeedSync, mwSyncSeeds, mwCullSources } from './stages/seedSyncStage.mjs'
import { stageListFetch, mwFetchList, mwNormalizeItems, mwFilterItems, mwAdmitPersist, mwAccountSource } from './stages/listFetchStage.mjs'
import { stageDetailFetch, mwTitleSkip, mwRouteFetcher, mwFetchDetail, mwTranscodeLinks, mwFeedFallback, mwPersistOutcome } from './stages/detailFetchStage.mjs'
import { stageDocMaintain, mwSlim } from './stages/docMaintainStage.mjs'
import { stageExpand, mwProbe, mwSettleClue, probeSiteFeed, probeSearchEndpoints } from './stages/expandStage.mjs'
import { stageTriage, mwSettleTriage } from './stages/triageStage.mjs'
import { stageExtract, mwSaveClues, mwSkipGate, mwRenderNote, mwPersistNote, mwMarkDoc } from './stages/extractStage.mjs'
import { stageRelate, stageRelationIndex, mwBuildEdges, mwPersistEdges, mwApplyToNote, mwConflictDualWrite, mwMarkRelated, mwRebuildRelationIndex, pickCandidates, makeSlugResolver, applyRelationsToNote, markConflict, rebuildRelationIndex } from './stages/relateStage.mjs'
import { stageDistill, mwBuildBase, mwRunWorkflow, mwAdoptResult, mwRenderCore, mwPersistCore, buildWorkflowStages } from './stages/distillStage.mjs'
import { stageKnowledgeIndex, mwRebuildKnowledgeIndex, rebuildKnowledgeIndex } from './stages/indexStage.mjs'
import { runAiBatchStage } from './stages/aiBatchStage.mjs'
import { judgeFromDocs } from './stages/collectHelpers.mjs'
// ── 生命週期政策 ──
import { ensureSeedSources, isLowYield, pickDueSources, recordSourceOutcome, cullZeroYieldSources } from './stores/sourcePolicy.mjs'
import { slimTerminalDocs, byRetryTierFifo } from './stores/docPolicy.mjs'
import { clueKey, legacyClueKey, cluePriority, saveClues, pickClues, enforceFrontierCap, settleClue } from './stores/frontierPolicy.mjs'
import { normalizeFeedItems, filterFeedItems, admitFeedItems, ingestFeedItems } from './stores/ingestGate.mjs'
import { conceptVocabulary, pickConcepts, pickCategories } from './stores/conceptGroups.mjs'
// ── 內建領域預設 ──
import { createExtractDomain } from './domain/extractDomain.mjs'
import { createTriageDomain } from './domain/triageDomain.mjs'
import { createRelateDomain } from './domain/relateDomain.mjs'
import { createDistillDomain, buildDistillPrompt, buildAuditPrompt, buildRevisePrompt, buildFinalPrompt, renderCoreBody, checkCore, checkIssues, CORE_SCHEMA } from './domain/distillDomain.mjs'
import { VOCAB_DEFAULT, resolveVocab, kbLabelOf } from './domain/vocabDefault.mjs'
// ── 內建抓取器與端點 ──
import { createDefaultFetchers, mergeFetchers } from './fetchers/defaultFetchers.mjs'
import { DEFAULT_SITE_ADAPTERS, mergeSiteAdapters } from './fetchers/siteAdapters.mjs'
import { fetchArticle, fetchArticleLinks, discoverFeed } from './fetchers/articleParse.mjs'
import { gridSourceUrl, bingNewsSearchUrl, arxivSearchUrl, expandSeeds } from './fetchers/endpoints.mjs'
// ── AI 調度與營運配套 ──
import { createAiAdapter } from './ai/adapter.mjs'
import { createProviderHealth } from './ai/providerHealth.mjs'
import { KIND_MAX_PROMPT_CHARS, maxPromptCharsOf, fitChain } from './ai/capability.mjs'
import { createLogger } from './ops/logger.mjs'
import { createPatrol } from './ops/patrol.mjs'
import { buildRunSummary, writeRunSummary, readRunSummary, subReportOf, RUN_SUMMARY_VERSION } from './ops/runSummary.mjs'
import { regenCore, listCores } from './ops/regenCore.mjs'
import { ingestNotes } from './ops/ingestNotes.mjs'
import { reviveDeadDocs, deadMatcher } from './ops/reviveDocs.mjs'
// ── 工具 ──
import { renderFrontmatter, parseFrontmatter, writeMd, readMd, section, sectionOf, dropSection } from './md/md.mjs'
import { createClock } from './util/clock.mjs'
import { sha1, normalizeConcept, slugify, setConceptFold } from './util/text.mjs'
import { normalizeUrl, unwrapNewsUrl } from './util/web.mjs'
import { oneline, readJson, writeJson, queueAge } from './util/misc.mjs'
import { sourceId, docRecord, defaultToRecord, defaultToLinkedRecord } from './util/records.mjs'
import { normalizeWorkDir, expandDirs } from './core/dirs.mjs'
import { budgetOf } from './core/budget.mjs'
import taskRunner from './taskRunner.mjs'


/**
 * 通用知識之抓取、萃取、關聯與提煉套件
 *
 * 提供四段式知識管線(抓取 → 彙整(預篩→萃取) → 關聯 → 提煉,結束後自動重建索引):
 * ① 安裝即用:createKnowledgeExtract({ workDir }) 零注入即完整管線,內建萃取 prompt、筆記/核心版型、
 *    rss/grid/article/links 抓取器、feed/Bing/arXiv 線索探測、AI 調度層(w-dispatch-ai)與巡檢
 * ② 逐層可覆寫:cfg 設定覆寫、pipeline 物件重排、物件內 stages 重組、動作鏈 tap/chain 掛載、mw opts 注入、跨階段 plugins
 * ③ 領域可注入:主題範圍與分類詞彙(cfg.data.vocab)、prompt 與版型(各物件之 domain)、抓取器(cfg.fetchers)皆由安裝方決定
 * ④ 全部積木具名匯出,並含第二入口 taskRunner 之全部成員(同名即同一實作)
 *
 * @returns {Object} 回傳套件物件,含 createKnowledgeExtract、四物件工廠(createFetchObject 等)、子階段工廠(stage*)、
 *     mw 積木(mw*)、middleware 核心(defineMw、applyTaps、runChainOverMsgs 等)、內建領域預設(create*Domain、VOCAB_DEFAULT 等)、
 *     內建設定(resolveSettings、*_DEFAULT)、抓取器與端點、AI 調度(createAiAdapter 等)、營運配套(createPatrol、regenCore 等)、
 *     生命週期政策(pickDueSources、saveClues 等)與工具(md、clock、text、web、misc、records)等函數
 * @example
 * import WKnowledgeExtract from 'w-knowledge-extract'
 *
 * //零注入:僅 workDir 必填(金鑰放 workDir/.env)
 * let flow = WKnowledgeExtract.createKnowledgeExtract({
 *     workDir: './my-kb',
 *     data: {
 *         seedSources: [{ kind: 'rss', tier: 1, name: '範例來源', url: 'https://example.com/feed', lang: 'en' }],
 *         vocab: { domain: '機器學習' }, //主題範圍(選填), 未給即不限主題
 *     },
 * })
 * let report = await flow.run() //抓取→彙整→關聯→提煉→索引, 結束後寫 log/<day>/<stamp>-run.json 再巡檢
 * console.log(report.ok)
 */
let WKnowledgeExtract = {

    //執行殼(第二入口 ./taskRunner.mjs 之全部成員;泛用秩序,他專案之排程任務只 import 該入口即可)
    ...taskRunner,

    //總組裝(僅 workDir 必填;零注入即完整管線)
    createKnowledgeExtract,

    //預設四物件(可增減/重排/混入自寫物件)
    createFetchObject,
    createOrganizeObject,
    createRelateObject,
    createDistillObject,

    //子階段工廠(物件內 stages 重組用)
    stageSeedSync,
    stageListFetch,
    stageDetailFetch,
    stageDocMaintain,
    stageExpand,
    stageTriage,
    stageExtract,
    stageRelate,
    stageRelationIndex,
    stageDistill,
    stageKnowledgeIndex,

    //mw 積木(動作鏈 chain 重排/tap 置換用;具名=hook 錨點)
    mwSyncSeeds,
    mwCullSources,
    mwFetchList,
    mwNormalizeItems,
    mwFilterItems,
    mwAdmitPersist,
    mwAccountSource,
    mwTitleSkip,
    mwRouteFetcher,
    mwFetchDetail,
    mwTranscodeLinks,
    mwFeedFallback,
    mwPersistOutcome,
    mwSlim,
    mwProbe,
    mwSettleClue,
    probeSiteFeed,
    probeSearchEndpoints,
    mwSettleTriage,
    mwSaveClues,
    mwSkipGate,
    mwRenderNote,
    mwPersistNote,
    mwMarkDoc,
    mwBuildEdges,
    mwPersistEdges,
    mwApplyToNote,
    mwConflictDualWrite,
    mwMarkRelated,
    mwRebuildRelationIndex,
    mwBuildBase,
    mwRunWorkflow,
    mwAdoptResult,
    mwRenderCore,
    mwPersistCore,
    mwRebuildKnowledgeIndex,

    //middleware 核心(自寫單元/插件用)
    defineMw,
    defineFirstMw,
    applyTaps,
    makeMsg,
    count,
    composeChain,
    runChainOverMsgs,
    stdReport,
    MwContractError,
    resolvePlugins,
    mergeTaps,

    //內建預設(領域/設定/抓取器;安裝方組自訂管線時可原件取用)
    createTriageDomain,
    createExtractDomain,
    createRelateDomain,
    createDistillDomain,
    buildDistillPrompt,
    buildAuditPrompt,
    buildRevisePrompt,
    buildFinalPrompt,
    renderCoreBody,
    checkCore,
    checkIssues,
    CORE_SCHEMA,
    VOCAB_DEFAULT,
    resolveVocab,
    kbLabelOf,
    resolveSettings,
    FETCH_DEFAULT,
    KNOWLEDGE_DEFAULT,
    SOURCE_POLICY_DEFAULT,
    AI_DEFAULT,
    SKIP_TITLE_PATTERNS_DEFAULT,
    createDefaultFetchers,
    mergeFetchers,
    defaultToRecord,
    defaultToLinkedRecord,
    DEFAULT_SITE_ADAPTERS,
    mergeSiteAdapters,
    fetchArticle,
    fetchArticleLinks,
    discoverFeed,
    gridSourceUrl,
    bingNewsSearchUrl,
    arxivSearchUrl,
    expandSeeds,
    createAiAdapter,
    createProviderHealth,
    KIND_MAX_PROMPT_CHARS,
    maxPromptCharsOf,
    fitChain,
    createLogger,

    //營運配套(巡檢/維運/執行摘要;CLI 殼由執行端提供)
    createPatrol,
    regenCore,
    listCores,
    ingestNotes,
    reviveDeadDocs,
    deadMatcher,
    buildRunSummary,
    writeRunSummary,
    readRunSummary,
    subReportOf,
    RUN_SUMMARY_VERSION,

    //機制(生命週期政策/批次 AI harness/關聯與提煉機制/入庫閘門/時間預算)
    runAiBatchStage,
    buildWorkflowStages,
    judgeFromDocs,
    budgetOf,
    ensureSeedSources,
    isLowYield,
    pickDueSources,
    recordSourceOutcome,
    cullZeroYieldSources,
    slimTerminalDocs,
    byRetryTierFifo,
    clueKey,
    legacyClueKey,
    cluePriority,
    saveClues,
    pickClues,
    enforceFrontierCap,
    settleClue,
    normalizeFeedItems,
    filterFeedItems,
    admitFeedItems,
    ingestFeedItems,
    conceptVocabulary,
    pickConcepts,
    pickCategories,
    pickCandidates,
    makeSlugResolver,
    applyRelationsToNote,
    markConflict,
    rebuildRelationIndex,
    rebuildKnowledgeIndex,

    //工具
    acquireLock,
    renderFrontmatter,
    parseFrontmatter,
    writeMd,
    readMd,
    section,
    sectionOf,
    dropSection,
    createClock,
    sha1,
    normalizeConcept,
    slugify,
    setConceptFold,
    normalizeUrl,
    unwrapNewsUrl,
    oneline,
    readJson,
    writeJson,
    queueAge,
    sourceId,
    docRecord,
    normalizeWorkDir,
    expandDirs,

}


export default WKnowledgeExtract
