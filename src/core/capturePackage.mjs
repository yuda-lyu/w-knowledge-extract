// capturePackage.mjs — 抓取套件(npm 套件 w-knowledge-capture)之單一匯入點
//
// 【為何單一匯入點】本套件除抓取、摘要、關聯三套件外不 import 任何其他專案程式碼;取抓取套件之件一律經本檔——抓取套件之指定詞只在本檔
//   ('w-knowledge-capture/src/WKnowledgeCapture.mjs';自有套件發布後 main 指 UMD、原始碼在 src/,取 ESM 入口一律以「套件名/src/入口檔」)。
// 【明列名稱＝抓取埠】本套件依賴抓取套件之哪些件一目瞭然;新增依賴先列於此,不在他檔直接 import 抓取套件。只列套件程式碼所需之名
//   (測試另需者經測試專用之橋接 test/tools/captureForTest.mjs;unit-extract-package ① 驗每一名皆有非測試檔取用)。
// 【抓取之知識只在抓取套件】詞彙之共用鍵(主題範圍、稱呼、概念之改名與別名)、概念鍵之折疊、AI 調度層之設定段與席位之形狀——
//   本套件只呼叫其 API,不另寫一份。
// 【核心件同一實作】管線秩序(kernel)、時間預算、判定形狀、正體、文字與概念鍵、小工具、鎖、設定合併規則、物件共用件、AI 回覆之 JSON 擷取、
//   角色化評分核心(角色之定義、規劃與執行、命令列之參數、免費受測名單)、總組裝共用件(鍵檢核、目錄、時鐘、
//   提示詞鍵、子階段設定、選開集合、儲存、日誌、調度層之建構與事件日誌、啟動期警告、每輪之序列、info() 之共同欄)、概念鍵之折疊與
//   本機網路判斷之判準、待判登錄取自抓取套件;本套件之 core/ 只放抓取套件沒有之模組(與其 core/ 不得有同相對路徑之檔)。本檔為各套件各自之匯入點,
//   與他套件之同名匯入點(如摘要套件之 core/capturePackage.mjs)不在「不得同相對路徑」之列。

export {
    // ── ① 核心件:管線秩序、時間預算、判定形狀與符合度掃描之累計器／總覽之形狀／計數摘要(各工作同一份)、正體(非本篇文字之片段、比對用之簡繁折疊)、
    //   語言設定(字形政策、輸出語言稱呼)、文字與概念鍵、筆記之概念標籤(主標籤之定義)與欄位(出處文件、提煉標記之欄名)、小工具(含值之字串化、
    //   文字清單、去重、JSON 深複本、命令列之直接執行判定)、鎖 ──
    defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport,
    budgetOf,
    STATUS, result, createStandardsTally, standardsScanOf, standardsCountsOf,
    withoutForeignSpans, cnToTw,
    resolveLocale, scriptOf, scriptApplies, SCRIPT_NA_DETAIL,
    sha1, normalizeConcept, noteConceptsOf, noteDocIdOf, noteCreatedMsOf, NOTE_FIELDS, slugify,
    oneline, readJson, writeFileAtomic, strOf, textValueOf, strictTextOf, textListOf, uniq, jsonClone, cmp, isDirectRun, canonOf,
    acquireLock,
    // ── ② 設定合併規則、席位之形狀與席位表、AI 調度層之設定段之 schema(預設取摘要套件之 ai 段)、不認得之鍵之問題、詞彙(抓取共用之鍵;
    //   詞彙表解析之共用件——頭之政策、子集、guide 之合併)──
    mergeSettingsGroup, cloneSettingsDefault, seatProblem, seatsFrom, seatLabelsFrom, AI_SCHEMA, unknownKeysProblem,
    resolveVocab as resolveCaptureVocab, CAPTURE_VOCAB_KEYS, pickCaptureVocab, kbLabelOf, vocabHeadOf, pickVocabKeys, mergeGuideFields,
    // ── ③ 物件共用件(子階段 opts 之合併、子階段序列執行、摘要組裝、物件 report)──
    subOpt, stageFields, runSubStages, summaryOf, objectReport,
    // ── ④ 總組裝共用件(與工作內容無關之組裝機制;含交 resolveRuntime 之鍵、提示詞覆寫之驗證與套用〔cfg 層、執行期件、domain 工廠同一份:覆寫之
    //   ctx、可覆寫成員、鍵之歸屬與子集〕與其和注入 domain 之衝突、domain 之注入與合併、cfg.data 之鍵集與解析、功能表之必填檢核、主入口之合成、
    //   每輪依賴之共同欄)、折疊之套用與網路判斷之共用判準 ──
    given, checkKeys, normalizeWorkDir, resolveRuntime, runtimeCfgOf, DEPS_COMMON_KEYS,
    resolveDirsCfg, resolveClockCfg, resolvePromptsCfg, promptOverridesOf, promptTextOf, promptCtxOf, overridablePrompt, promptDomainOf, promptsForDomain, promptDomainConflicts, mergeDomains, checkDataKeys, resolveDataCfg,
    checkStageConfig, checkOptionalCollections, resolveLmdbCfg,
    resolveLogFactory, resolveAfterRun, checkAiAdapter, createRoundLog, buildAiAdapter, startupWarningsOf, featureProblemsOf,
    createStoreOpener, pipelineNameOf, createRoundRunner, assemblyInfoOf, composeNamespaces,
    applyConceptFold, captureNetGuardOf,
    // ── ⑤ AI 回覆之 JSON 擷取(由後往前取第一段含指定鍵且合格者)──
    pickKeyedJson,
    // ── ⑥ 角色化評分核心(角色之定義、多角色之命令列〔含單角色之執行與準備〕、免費受測名單;角色作者之共用小件——含缺票之原因、同詞彙分頁、
    //   角色參數之正整數、單棒結果轉 callJson 之形狀〔調度層之一份,嘗試數與失敗摘要同 callJson〕)──
    defineBenchRole, defineBenchRoles, DEFAULT_FREE_MODELS,
    typeName, paginateByVocab, benchPintOf, inputVocabProblemsOf, domainNeedsOf, noVerdict, batchOption, benchVoteMissingOf, callJsonShapeOf,
    // ── ⑦ 待判登錄(鍵、登錄、結案、列出;四工作同一機制)、存量處置之帳協定與待判件、append-only JSONL 帳之寫入(影響帳、丟棄帳同一份)──
    holdKey, putHold, resolveHold, listHolds, holdDeadlineOf, retryRequestedOf, pipelineDueOf, noteConsumedOf,
    stockLedgerFileOf, stockAtOf, stockLedgerRowsOf, stockLedgerWriter, appendRollbackRow, stockErrorOf,
    holdStockUnfixable, closeStockHold, rollbackStockHold, reopenStockHold, stockHoldProblems,
    appendJsonlRows,
    // ── ⑧ 日誌契約:核心件(總組裝共用件之每輪序列、AI 調度層之事件、本機網路判斷)所發之字樣(本套件之契約以之組成)──
    CORE_LOG_KNOWN, CORE_LOG_MUST_SEE,
} from 'w-knowledge-capture/src/WKnowledgeCapture.mjs'
