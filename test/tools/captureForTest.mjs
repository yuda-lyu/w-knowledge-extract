// captureForTest.mjs — 測試專用之抓取橋接(只供測試;套件程式碼不得 import 本檔——邊界檢查只許本檔與 core/capturePackage.mjs 引用抓取套件,
//   且非測試檔一律不得引用 test/ 下之檔)
//
// 【為何需要】測試之環境需要抓取套件之若干件,而本套件之程式碼用不到,故不列入抓取埠(core/capturePackage.mjs 只列套件程式碼所需之名):
//   時鐘(測試自建 ctx.deps.clock)、目錄之展開(測試自建知識庫之目錄)、動作鏈之組裝(以單一 mw 驗其行為)、設定型別表(設定之邊界樣本
//   以之篩選)、落檔之日誌器(總組裝之整合測試以真日誌檔驗日誌契約之正則)。
// 【只轉出測試所需之名】新增前先確認抓取埠沒有、且確為測試所需(抓取埠已有者測試經埠取用);每一名須被本套件 test/ 下至少一檔具名取用
//   (本套件尚無自動守門案守橋接之死轉出,新增時人工確認)。抓取埠只列套件程式碼所需之名
//   (unit-extract-package ① 自動驗),故席位之鍵表、評分之題組驗證與評比表之表頭、概念鍵之折疊單例與折疊之決定(套件程式碼經 applyConceptFold)、
//   交 resolveRuntime 之鍵、抓取之 ai 段預設(本套件之 ai 預設取摘要套件之一份,測試比對其底)等只供測試之名經本檔。
//   評分之真 AI 測試另需建調度層(工作流入口)、落報表與失敗類別之說明(評分模組本身經核心之命令列建調度層,不需抓取埠列之);
//   使用者對待判之重試要求與豁免亦經本檔;JSONL 之讀法(readJsonlRows:缺檔空、壞行略過——測試讀影響帳等用;套件程式碼只寫不讀)亦經本檔。
// 【領域中立詞表】四套件之中立掃描共用抓取套件之測試詞表(其 test/tools/domainTerms;自檢在抓取套件之 unit-domain-terms)——同一規則只一份。
// 【共用測試件】記憶體集合(memStore)、靜音日誌(nullLogger)、位置無關之共用件(testKit:日誌之替身、暫存根之工廠、子階段 report、集合之開關…)、
//   原始碼之詞法器(sourceScan)、假 OpenAI 相容伺服器與真調度層之組裝(fakeRest)、舊名與沿革及面向使用者字樣之判準(historyMarks)皆在抓取套件之
//   test/tools(四套件同一份;各件「只定義於其家」),本套件之測試經本檔取用。
// 【指定詞】抓取套件為 npm 套件:主入口 'w-knowledge-capture/src/WKnowledgeCapture.mjs'(同抓取埠)、測試件 'w-knowledge-capture/test/tools/<檔>'(隨其 tarball 發布)。

export {
    genClockTZ, expandDirs, SETTING_TYPES, SEAT_KEYS, showSettingValue,
    createAiAdapter, writeBenchReport, BENCH_FAIL_KINDS, validateBenchCases, BENCH_BOARD_HEADER,
    requestRetry, waiveHold, STOCK_LEDGER_FILE,
    setConceptFold, conceptFoldsOf, RUNTIME_CFG_KEYS, AI_DEFAULT,
    readJsonlRows,
} from 'w-knowledge-capture/src/WKnowledgeCapture.mjs'
export { DOMAIN_TERM_RE, domainTermsIn } from 'w-knowledge-capture/test/tools/domainTerms.mjs'
export { memStore } from 'w-knowledge-capture/test/tools/memStore.mjs'
export { nullLogger } from 'w-knowledge-capture/test/tools/nullLogger.mjs'
export {
    pkgRootOf, tmpRootsOf, removeRoots, silentLog, recLog, plainLog, logsOf, fileLogFactory, resetConceptFold, subReport, withStores, findFiles, readJsonFile,
    FIXED_CLOCK, msgOf, sleep, mkCtx,
} from 'w-knowledge-capture/test/tools/testKit.mjs'
export { lexSource, specifiersOf, exportedNamesOf, namedImportsOf, sourceFilesOf } from 'w-knowledge-capture/test/tools/sourceScan.mjs'
export { startServer, rest, mkAdapter } from 'w-knowledge-capture/test/tools/fakeRest.mjs'
export { HOST_CLI, historyHitsOf, userTextHitsOf, historyScanOf, userTextScanOf, benchCaseNotesOf } from 'w-knowledge-capture/test/tools/historyMarks.mjs'
