# 處理要點 — 變更與驗收共通要點（w-knowledge-extract）

> **路徑基準**：原始碼在 `src/`，本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`。
> 本檔為本套件變更與驗收之共通要點（測試、設定、提示詞逐字檢查、模組英文名、設定結構與席位、語言設定）；提煉之設定與監看見 `process_extract.md`、檢定標準之運維見 `process_standards.md`。現況以 `../state/state.md` 與 README 為準。

## 本套件之變更與驗收

**背景**:
- 本套件只放新格式＋新工作流:不含舊版相容、舊資料遷移、舊名退路(規則帳本 GEN-04);使用端舊資料之處理由使用端另寫一次性工具。發布套件是使用者之事,不列為待辦。
- **只有一份之機制**(規則帳本 GEN-19):AI 調度層(遞補、冷卻、健康、免費池額度、能力預篩、取最後一段合格之 JSON、斷網不計)、執行期生效值 `resolveRuntime`、總組裝共用件(`createRoundRunner`、`buildAiAdapter`、`startupWarningsOf`…)在抓取套件,經單一匯入點 `core/capturePackage.mjs` 取用;判定小組(`decidePanel`、`runPanelPage`)與批次 AI 在摘要套件(`core/summarizePackage.mjs`);關聯之邊庫、墓碑、衝突事件帳在關聯套件(`core/relatePackage.mjs`)。本套件不另寫一份——改這些機制屬上游套件,上游升版後自套件根跑本套件全套。指定詞一律「套件名/src/入口檔」(規則帳本 GEN-18),只出現於三個匯入點與測試橋接 `test/tools/{capture,summarize,relate}ForTest.mjs`(`unit-extract-package` ① 守門)。

### 流程

1. **測試一律自套件根**:`npm test`(＝`mocha --parallel "test/*.test.mjs" --timeout 180000`;真 AI 之案未設旗標時為 pending);單檔去掉 `--parallel` 換檔名:`node node_modules/mocha/bin/mocha.js --timeout 180000 test/<檔名>`。暫存落 `test/_tmp/`(`test/tools/extractTestKit.mjs` 之 `tmpRoot(名)`＝`test/_tmp/<名>-<pid>`,測完 `removeRoots` 刪除並回驗)。**測試之掃描／匯入根以測試檔位置推導,不用 cwd**(規則帳本 GEN-09),且掃描根為 `src/`(套件根另有 `toolg/`、`g.mjs`)。
2. **測試之形式、共用件與真 AI 案**:本套件測試皆為 mocha 形式(`test/*.test.mjs`,`describe`／`it`;檔名前綴 `unit-`／`api-`);新測試依此寫。
  - **整輪流程測試**:`test/unit-flow-extract.test.mjs` 與其共用件 `test/tools/extractTestKit.mjs` 走對外之總組裝 `createKnowledgeExtract`(設定、詞彙、domain、鎖、日誌、執行摘要皆為真實件,集合為真 LMDB),只換兩件事:①`workDir` 換成 `test/_tmp/<案名>-<pid>`②AI 調度層換成 3+3 腳本化替身(`test/tools/extractKit.mjs` 之 `scriptAi`,依席位或提示詞首句判角色作答,不發網路、不燒額度;回覆經呼叫端之正式 `check` 驗證,不合即失敗)。固定埠(≥8000、不隨機):8881 為無人監聽之埠(內建調度層之「整鏈皆敗」)、8882 為本機假 REST、8883～8889 保留。**斷言之報告 summary 格式即下游監看之契約**:`extractSummaryOf`(`extractObject.mjs`)之固定格式與 `logContract.mjs` 之 `EXTRACT_LOG_KNOWN`／`EXTRACT_LOG_MUST_SEE`／`EXTRACT_LOG_PARSE`／`EXTRACT_REPORT_KEYS`——改摘要或日誌字樣須同步改這些常數與 `unit-extract-log-contract`、`unit-extract-object`、`unit-flow-extract`。
  - **測試之共用件**:上游之共用測試件(日誌替身、暫存根工廠、`deepMerge`、`parseCsv`、`withCheck`、原始檔走訪 `sourceFilesOf`、筆記工廠 `landNoteOf`、`seedNotes`…)一律經測試專用之橋接取得(套件程式碼不 import);**不得在本套件 test/ 自寫副本**(規則帳本 GEN-19、GEN-22);橋接所轉出之每一名皆須被本套件 test/ 下至少一檔取用——本套件尚無自動守門案,維護時人工盤點。各段測試之手寫 AI 替身一律以 `withCheck` 包住。本套件特有之件:`extractTestKit`(`tmpRoot`、`buildTestExtractor`、`landNote`、`TEST_EXTRACT`…)、`extractKit`(`scriptAi`、`seatAi`、`panelAi`、`mkEnvIn`、`ANN`、`clock`…)、`promptInputs`(提示詞之固定輸入)、`quantVocab`(負對照夾具)、`regen-golden`;評分題組(`src/bench/cases/*.json`)等題材夾具屬本套件之資料,不與上游之中立題材收斂。
  - **真 AI 案(會燒額度,須使用者同意)**:`test/api-extract-bench-ai.test.mjs`(免費模型跑十四角色之內建通用題組,每案兩回;評分只報告、不設通過門檻)。**未設 `WK_LIVE_AI=1` 一律略過(mocha pending)並綠**;實跑自套件根:`WK_LIVE_AI=1 WK_BENCH_OUT=<專案外之絕對路徑> node node_modules/mocha/bin/mocha.js --timeout 180000 test/api-extract-bench-ai.test.mjs`。`WK_EXTRACT_MODELS`／`WK_EXTRACT_ROLES`(逗號分隔之條目 id／角色 id)限範圍,`WK_ENV_FILE` 給金鑰檔(預設席位為免金鑰之免費模型,不給即讀 `process.env`);AI 子行程之工作目錄與報表一律落 `WK_BENCH_OUT`(專案外;CLI 型模型會讀工作目錄上層之指示檔),逐回進度即存。
  - **改設定鍵須知**:本套件對 `ai`／`extract` 二段以 schema 驗鍵集、型別與值域(`core/extractSettings.mjs` 之 `EXTRACT_AI_SCHEMA`、`EXTRACT_SCHEMA`;合併與型別規則取抓取套件之 `mergeSettingsGroup`),頂層 cfg 鍵以 `CFG_KEYS`(`createKnowledgeExtract.mjs`)驗——**打錯鍵、數字寫成字串、區段形狀錯皆於建構期拋錯、整輪不執行**,訊息含完整設定路徑與可用鍵。為何:靜默回套件預設比拋錯更難察覺(規則帳本 GEN-03)。新增讀取 `cfg.<鍵>` 處須同步列入 `CFG_KEYS`:`unit-extract-assembly` 以去註解與字串之骨架比對讀取者與 `CFG_KEYS`,且其逐鍵嚴格性案例表之鍵集須等於 `CFG_KEYS`(新增鍵而未補案例即失敗)。改完設定相關程式先跑 `unit-settings`、`unit-extract-assembly`,再跑全套。
3. **提示詞逐字相同檢查**:`node test/tools/regen-golden.mjs`(自套件根;預設預演,只比對現行輸出與基準檔 `test/golden/extract/`,列出會新增／改動者與基準目錄多出之檔,離開碼 0＝全同;`GOLDEN_WRITE=1` 才寫;`test/golden/extract-override/` 之覆寫重現組不可重產,只能逐字比對,`unit-extract-golden` 守)。有差異即提示詞改了——查明是否刻意;若是,重產前須確認差異皆為刻意變更並取得使用者同意,並以正式席位對凍結輸入實測(對應之評分角色題組,逐案兩回全過)後才算驗證;提示詞一改,該角色之 `planExtractBench(角色).promptFp` 隨之改變,與 `模型評比.csv` 之「提示詞指紋」欄不符者,該角色既有評比結果失效,須重跑評分:`node src/bench/cli.mjs --role <角色> --models … --board 模型評比.csv`(README §15)。**刻意改提示詞(經 A/B 驗證)之落地順序**:①改 `src/`;②覆寫重現組中受影響之行以原行就地置換(`Edit` 只換那幾行,不以現行輸出重產;工具在覆寫組不符時中止,故須先手改)並逐檔逐行登錄於 `test/unit-extract-golden.test.mjs` 檔頭【覆寫重現之手改紀錄】(依據、置換法);③`node test/tools/regen-golden.mjs` 預演——覆寫組須比對過、中立組只列受影響之檔(「會新增 0、會改動 N、相同 16−N」);④`GOLDEN_WRITE=1` 寫中立組;⑤受影響之提示詞單元案(例 `unit-extract-domain`〈EXT-37〉)與 `unit-extract-golden`、`unit-extract-prompts` 綠;⑥以全角色 `planExtractBench` 指紋前後對照(HEAD 以 `git archive HEAD src package.json` 解到 `./tmp/` 再跑),確認只有目標角色之指紋變。
4. **留紀錄**:累積經驗(過程性教訓)寫 `sgud/exp/experience.md`;現況(各功能做到哪裡、已知缺口、最近一次驗證)寫 `sgud/state/state.md`,只記現況、不寫過程;完成一項功能或結束一輪工作即更新。

### 模組英文名(一律統一、不得另創或沿用舊名)

| 中文 | 英文(目錄、設定段、hook 前綴、物件工廠、欄位) | 曾用舊名(已全數改掉,不得再出現於 src／test／README) |
|---|---|---|
| 提煉 | `extract`(設定段 `extract`〔`extract.ai = { drafters, integrate, audit, revise, accept }`、`extract.perRun`…〕、物件工廠 `createExtractObject`、總組裝 `createKnowledgeExtract`、執行期件 `createExtractRuntime`、hook 錨點 `extract.extract.{loadState, selectNotes, pass, renderState, persistState}`、筆記欄位 `extractedAt`、失敗帳 `state/extract-attempts.json`、`createExtractDomain`、`extractSeatsProblem`、評分角色十四個〔判定類 `support-check`／`support-revise`／`orphan-check`／`dispute-check`／`synonym-check`／`synonym-propose` 與工作流類 `wf-*`〕) | distill(`ai.distill`、`distill*`、`distilledAt`、`distill-attempts.json`) |

- 盤點:`git grep --untracked -nE "\bdistill|\borganize|ai\.distill|distilledAt|distill-attempts" -- src test README.md g.mjs` 應為空。
- 上游三套件(抓取、摘要、關聯)之命名見各該套件之 sgud;改錨點名須同步 README §10 與 `unit-extract-object`(`EXTRACT_TAP_STAGE_KEYS` 由行為推導、對不存在之錨點建立物件時即拋)。

### 設定結構與席位清單

**結構**:設定只有兩段(`resolveExtractSettings` 只收此二者,其餘拋錯;總組裝只交原給之段):`ai`(AI 調度層與併發;即抓取套件之 ai 段)與 `extract`(提煉之全部設定,依要點分組:節奏〔`perRun`、`notesPerConcept`、`minNotes`、`minPending`、`maxWaitDays`、`catchupBatches`、`relateGraceDays`…〕、整併〔`claimsCap`、`consolidateEvery`〕、重審〔`recheck`〕、檢定標準〔`standards`:`supportCheck`、`supportStock`、`orphanCheck`、`disputeCheck`、`synonymCheck`、判定小組 `ai`、符合度掃描開關 `scanEachRun`〕、3+3 席位〔`ai`〕)。AI 席位放在用到它的那一組(鍵名一律 `ai`;判定小組席名 `first`／`second`／`third`)。只給想調的鍵,其餘沿用套件預設:組(物件節點)逐鍵遞迴合併,葉(席位、樣式陣列)給了即整個取代。預設席位全為免費模型;判定小組預設全空且關閉。推導值唯讀:`capacity.extract`＝`extract.perRun`×`extract.notesPerConcept`(`resolveExtractSettings(cfg).capacity` 與 `info().settings.capacity` 同源;容量須 ≥ 筆記進料上界,不足即啟動期警告)。規則帳本 GEN-03。

- **席位清單之名稱**(`extractSeatsOf(settings)`;只列已設者——null 之選填席位不列;啟動期檢核席位可解析〔不可解析即拋〕、主力供應商計算與維運工具共用;顯示名見 `EXTRACT_SEAT_LABELS`):`extract.ai.drafters[0..2]`、`extract.ai.{integrate,audit,revise,accept}`、`extract.standards.ai.{first,second,third}`。判定小組之組成與功能表見 `extractPanelsOf(settings)`、`EXTRACT_FEATURES`。
- **帳檔**:`state/extract-attempts.json`(失敗帳)、`extract-regen.json`(重練意圖)、`extract-impact.jsonl`(關聯影響處置紀錄)、核心狀態檔 `<coreState>/<核心 id>.state.json`;待判登錄與檢核紀錄在集合 `holds`／`checks`(與摘要、關聯套件同一集合)。
- **語言設定 `cfg.lang`**(規則帳本 GEN-20):總組裝收頂層 `lang`(BCP 47 代碼;抓取套件 `core/locale.mjs` 之 `resolveLocale`),決定覆核類提示詞之輸出語言句、核心標準 ES3(正體)之適用(只有繁體中文有字形標準;其餘語言掃描逐條目列「不適用」、操作守門與存量處置不轉字形)、概念鍵之繁簡折疊(`conceptFold` 未給時依語言設定:中文折、其餘不折)。**不給即預設 `zh-TW`,行為與語言設定出現前逐字相同**(預設提示詞由 `test/golden/` 守,`unit-extract-golden`;語言設定之落點由 `unit-extract-locale` 守)。提示詞本體與核心 md 版型為繁體中文,`lang` 只換理由之語言句與字形政策(整份提示詞可經 `cfg.prompts` 覆寫);產物契約與零件庫用法之新選項(子階段 `enabled`／`when`、`cfg.aiOptions`…)皆 opt-in、預設行為逐字不變。
