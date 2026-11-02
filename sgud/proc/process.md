# 處理要點（w-knowledge-extract）

> 本套件之開發、驗收、維運要求與其處理流程。本檔為索引與要點；細節分檔如下表。
> **路徑基準**：原始碼在 `src/`，下文與分檔所列檔案路徑（`core/…`、`stages/…`、`createKnowledgeExtract.mjs` 等）除註明外皆相對 `src/`；測試在 `test/`（輔助件在 `test/tools/`，隨 npm 包發布供下游取用）。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「摘要套件」＝npm `w-knowledge-summarize`；「關聯套件」＝npm `w-knowledge-relate`；「下游」＝讀本套件產物（核心 md、`cores` 記錄、狀態檔）之後續工作。

## 接手先讀

1. `../state/state.md`（現況：版本與佈局、最近驗證、已知缺口與待辦）——接續工作只讀此檔，不必翻經驗檔。
2. 規則查 `../rule/rulebook.md`（索引；條目分檔在同目錄）；業務要求與流程查本檔；踩過的坑在 `../exp/experience.md`。
3. 完成一項功能或結束一輪工作即更新 `state.md`（只記現況，過程寫入經驗檔）。

## 分檔

| 檔 | 內容 |
|---|---|
| `process_common.md` | 變更與驗收之共通要點：測試自套件根、測試之形式與共用件、真 AI 案之旗標、改設定鍵須知、提示詞逐字相同檢查、模組英文名、設定結構與席位清單、語言設定 `cfg.lang` |
| `process_extract.md` | 提煉（3+3）之設定與監看：流程與降級梯、設定所在、逐輪監看（筆記被改／刪／還原、新衝突邊、衝突撤銷）、本質缺席 |
| `process_standards.md` | 檢定標準之運維：預設全關、開啟程序、容量、符合度掃描、存量處置與回退 |

## 已移出

屬使用端（宿主專案）之運維，不屬本套件之處理要點，原文由原出處保有：變更與驗收流程中之整點避開、使用端全套驗收、席位核對（`check-seats`）、執行殼接線與升版驗證、等下一輪、使用端設定檔之舊→新鍵對照、使用端已開啟之 AI 標準與其容量實測表（`process_common.md` 原〈設定對照〉〈本專案領域設定在哪〉二節；`process_standards.md` 原已開啟之 AI 標準與容量快照）。

## 本套件之鐵則（細目見 `../rule/rulebook.md`）

- 只 import 自己的檔案、`package.json` 所列套件，以及抓取、摘要、關聯三套件（各經單一匯入點 `core/capturePackage.mjs`、`core/summarizePackage.mjs`、`core/relatePackage.mjs`）。
- 層序 `core ← guards ← stores ← standards ← workflow ← { stages, ops }`（domain、bench 為葉）；standards 不得 import workflow（閘之共用件以注入取 guard）。
- 狀態檔為真理、md 與 `cores` 記錄為投影；先記後寫（待判登錄、意圖先於破壞性寫入）；不變式違反者逐條剔除後重套（`workflow/applyWithInvariants`）。
- 三原則：①回退＝撤銷該次處置之效果；②同一處境同一處置，中止不計、失敗計，未判不記已審，使用者之裁示不被自動流程推翻（素材雜湊變了才重提）；③**基礎設施失敗留待、不計失敗、不轉使用者**（缺票、同一供應者、中止、席位未設 → 存待審／留待審）。
- 改本套件後：自套件根跑本套件全套（`npm test`）；本套件在最上層，無下游套件，但核心 md／`cores` 記錄／狀態檔之格式即對使用端之契約，改動須同步 README §12。

## 結構與工具

- **佈局**：`src/`（主入口 `src/WKnowledgeExtract.mjs`；根層 `createKnowledgeExtract.mjs`、`extractObject.mjs`、`extractRuntime.mjs`、`logContract.mjs`＋`bench/ core/ domain/ guards/ ops/ stages/ standards/ stores/ workflow/`）、`test/`（`*.test.mjs`＋`tools/`＋`golden/`）、`toolg/`（編譯與文件工具，依自有套件之標準寫法）、`g.mjs`（離線範例）、`sgud/`、根目錄範本檔（`.editorconfig`、`.eslintrc.js`、`.jsdoc`、`babel.config.js`、`SECURITY.md`）、`模型評比.csv`（`--board` 累積之評比表）。
- **發布面**：`package.json` 之 `main` 指 `dist/w-knowledge-extract.umd.js`，**不設 `exports` 與 `files`**（設了即擋掉下游之 `…/src/…`、`…/test/tools/…` 深層路徑）；**不提供 `.npmignore`**，npm 包＝git 版控內容（`sgud/`、`test/`、`docs/` 隨包，`CLAUDE*.md` 由 `.gitignore` 排除）；`script.txt` 為發布列序（使用者維護），發布與 `./dist` 之產製由使用者與自動化流程處理，不列為待辦。
- **編譯**：`node toolg/gDistRollup.mjs`；`external`／`globals` 自 `src/WKnowledgeExtract.mjs` 靜態追蹤 import 圖（含經三上游再引用之自有套件原始碼）盤點，原則見該檔檔頭；`opencc-js` 與 `json5` 為 external，`opencc-js/dict/*`、`lodash-es/*`、`mingo` 等打包進 dist。
- **import 規範**：`lodash-es` 取單函數路徑；wsemi 取 `wsemi/src/<函數>.mjs`；其他自有套件走其 `src/` 深層路徑；node 內建模組在 `src/` 無前綴（`fs`、`path`、`url`）。
- **JSDoc**：`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（`// =>` 為實跑輸出）；`node node_modules/jsdoc/jsdoc.js -c .jsdoc` 須成功。
- **測試**：一律自套件根跑，`npm test`（＝`mocha --parallel "test/*.test.mjs" --timeout 180000`）；不連網、不呼叫真實 AI（真 AI 案須 `WK_LIVE_AI=1`，會燒免費額度，須使用者同意）；提示詞之基準檔 `test/golden/`：中立組以 `GOLDEN_WRITE=1` 重產、覆寫組手改——提示詞改了即改題目識別，須先以正式席位 A/B 驗證；`package.json` 之 scripts 為 `test` 與 `deploy`；不建 `.mocharc.json`。

## 不列為待辦者

- 發布套件、`./dist` 之產製由使用者處理；四專步（ES14／ES9 存量／ES8／ES11）與 ES9 新進之開啟、舊資料之處理（存量處置 `applyCoreStockFix`、舊核心重建 `regenCore`）須使用者同意。
