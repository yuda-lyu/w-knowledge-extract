# 現況（w-knowledge-extract）— 2026-11-06

> 只記現況，不寫過程（過程在 `../exp/`）。接續工作先讀本檔；完成一項功能或結束一輪工作即更新。
> **路徑基準**：原始碼在 `src/`，下文與分檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`。

## 身分與位置

- 套件名 `w-knowledge-extract`（倉庫現行 1.0.13；**本批新內容為 1.0.14 首發**——`package.json` 之 `version` 設 1.0.13，由發布流程之 `addVersion` 升為 1.0.14），以新內容覆蓋舊版套件（舊內容不參考、不保留）。入口 `src/WKnowledgeExtract.mjs`（具名＋預設匯出同一組）、總組裝 `createKnowledgeExtract`、執行期件 `createExtractRuntime`、物件 `extractObject.mjs`；`main` 指 `dist/w-knowledge-extract.umd.js`。`unit-extract-package` ④ 之「舊名」為暫名 `w-knowledge-extractor`／`createKnowledgeExtractor`／`WKnowledgeExtractor`（負向守門）。
- 依賴：抓取 npm `w-knowledge-capture` ^1.0.2（埠 `core/capturePackage.mjs`；指定詞 `w-knowledge-capture/src/WKnowledgeCapture.mjs`）、摘要 npm `w-knowledge-summarize` ^1.0.2（埠 `core/summarizePackage.mjs`）、關聯 npm `w-knowledge-relate` ^1.0.1（埠 `core/relatePackage.mjs`；測試橋接 `test/tools/relateForTest.mjs` 另取 `w-knowledge-relate/test/tools/relateTestKit.mjs`）、`wsemi` ^1.9.43、`json5` ^2.2.3（`standards/parse.mjs` 之寬鬆 JSON）；devDependencies：`w-data-pipeline`、`w-dispatch-ai`、`w-orm-lmdb`（測試用）、`w-package-tools`（`toolg/`；mocha 隨之安裝）。
- 被誰用：使用端經 `w-knowledge-extract/src/WKnowledgeExtract.mjs` 取用；本套件在最上層，無下游套件。
- 發布狀態：已依自有套件佈局重整（2026-11-02）；發布與推送由使用者與自動化流程處理。

## 佈局（2026-11-02 重整）

- 原始碼全在 `src/`（根層 5 檔＋`bench/ core/ domain/ guards/ ops/ stages/ standards/ stores/ workflow/`；`bench/cases/` 十四份內建題組）；`test/`（`*.test.mjs`＋`tools/`＋`golden/`）；`toolg/`（`addVersion`、`modifyReadme`、`cleanFolder`、`gDocsExams`、`gDistRollup`、`genDocsDist`，皆標準寫法）；`g.mjs`（離線範例：3 篇筆記 → 一則核心，不連網、不呼叫真 AI）；`dist/`、`docs/` 為產製物。
- 編譯：`node toolg/gDistRollup.mjs` 產出 `dist/w-knowledge-extract.umd.js`（`runin: 'nodejs'`；external：node 內建九項、`json5`、`opencc-js`、`tree-kill`、`dayjs`／`dayjs/plugin/utc.js`、`@mozilla/readability`、`jsdom`、`playwright`、`rss-parser`、`lmdb`）；dist 以 `require` 載入之具名匯出（512）與 ESM 入口集合、型別完全相同。警告兩條皆固有（入口具名與預設並存；umd 以 browser 環境編譯時提示 node 內建模組，皆已 external）。
- 印出之命令列用法一律為實際路徑：`node src/bench/cli.mjs`、題組 `src/bench/cases/<角色 id>-generic.json`。
- JSDoc：`src/` 匯出函數 341 個，說明、`@param`、`@returns`、`@example` 皆 341/341；匯出常數 171/171；可實跑之範例 249 則經腳本實跑核對 `// =>`，92 則標 `need test in nodejs.`（需真實儲存或 AI）。

## 最近驗證

| 日期 | 項 | 結果 |
|---|---|---|
| 2026-11-06 | 工作流類八角色題組自給概念名＋準備期守門（EXT-35）後全套（`npm test`，經 quiet-run 鎖） | 869 通過／0 失敗／14 待決（同上）；新增 `unit-bench-wf-concept` 36 案；變異：拿掉守門 → 16 案紅（八角色 × 守門 2 案），各刪三案之 `concept`（多行、單行、僅 `concept` 之 `state` 三種形狀）→ 6 案紅；還原後全綠。**未以真 AI 實測概念名之實效**（待使用端重跑評比） |
| 2026-11-02 | 重整為自有套件佈局後全套（`npm test`，經 quiet-run 鎖） | 833 通過／0 失敗／14 待決（全為 `api-extract-bench-ai` 十四角色之真 AI 案，`WK_LIVE_AI=1` 才執行；真實網路亦預設關） |
| 2026-11-02 | 發布面守門之變異證據（`unit-extract-package` ②、`unit-extract-bench` 用法案） | 五種變異皆被抓：`.npmignore` 列 `sgud`、`.gitignore` 加 `sgud`、`.gitignore` 去 `CLAUDE*.md`、`g.mjs` 之 `// =>` 與 README 不同步、`cli.mjs` 用法字串還原；還原後全綠 |
| 2026-11-02 | 打包清單（`npm pack --dry-run --json`） | 296 檔：`src/` 84、`test/` 81（`test/tools/` 8）、`docs/` 99、`sgud/` 12、`toolg/` 6、`dist/` 2、根層 12；`CLAUDE*.md`、`tmp/`、`test/_tmp/`、`.npmignore` 皆 0 |
| 2026-11-02 | 建置與文件（`gDistRollup`、jsdoc、`gDocsExams`、`genDocsDist`） | dist 以 `require` 載入之具名匯出 512＝ESM 入口 512（缺 0、多 0、型別差 0）；jsdoc 無錯誤無警告；`docs/dist` 已複製 |

## 功能現況（對應規則帳本）

| 功能 | 狀態 | 規則／測試 |
|---|---|---|
| 選題、選篇、3+3 工作流（起草／整合／審計／修訂／終審）、降級梯、截止感知；五 pass 失敗一律帶 `state`、pending 之 `stats` 與 runPass 同形 | 落地並為使用端所用 | EXT-06～10、EXT-29；`unit-extract-workflow`、`unit-selection`、`unit-extract-stage` |
| 狀態為真理、投影、四態分流、高水位、熔斷、先記後寫 | 落地 | EXT-01～05、EXT-25／26；`unit-core-state`、`unit-extract-files`、`unit-extract-stage` |
| 待審裁決（pending；`tries`／`es9Tries`、逾次改登錄筆記層待判） | 落地 | EXT-10、EXT-27；`unit-extract-workflow`、`unit-extract-stage` |
| 重審、撤出處／恢復、關聯變更之影響 ES10（`recheck.relationImpact` 預設關） | 落地 | EXT-14～21、STD-18；`unit-extract-lineage` |
| 本質專步 ES6 v2 | 落地 | EXT-22；`unit-extract-stage` |
| ES9 新進覆核（`supportCheck.enabled`，預設關）：骨架 `runSupportGate`、ES7 修訂路徑、原則 3 | 落地 | STD-12；`unit-extract-support`、`unit-extract-workflow` |
| 四專步：爭議覆核 ES14、出處支持存量 ES9、失撐 ES8、同義 ES11（皆 `perRun > 0` 開啟，預設關） | 落地（分頁、中止、材料、席位、計次、豁免、雜湊含素材） | STD-15／12／23／21；`unit-extract-dispute`、`unit-extract-support`、`unit-extract-orphan`、`unit-extract-synonym` |
| 檢定標準 ES1～ES17 之掃描（ES14 由狀態推得、ES11 總量與到期）與存量處置（`STOCK_STDS`；可修 ES3／ES5，其餘登錄待判） | 落地 | STD-08／22／25；`unit-extract-audit`、`unit-extract-standards`、`unit-extract-stockfix` |
| 日誌與 report 契約（`EXTRACT_REPORT_KEYS` 為物件子階段鍵與階段名之同一實體；統計初值由契約生成；含 `holdsWaivedKept`、`synonymWaivedKept`、`recheckFailStreak`／`essenceFailStreak`、未知統計鍵 WARN） | 落地 | EXT-29；`unit-extract-log-contract` |
| 層序（葉模型）、不經納入閘之寫入入口登記、入口名集 | 落地 | EXT-23／24；`unit-extract-package` ⑥、`unit-extract-registry`、`unit-extract-entry` |
| 免費 AI 能力評分：判定類六角色＋工作流類八角色 `wf-*`（十四角色）、`--lang`、`planExtractBench` 可規劃；命令列取抓取 `defineBenchRoles` | 落地；內建題組 `src/bench/cases/*.json` 十四份 | GEN-15／16、EXT-32；`unit-extract-bench`、`api-extract-bench-ai`（十四角色，`WK_LIVE_AI=1` 才執行） |
| 測試件與守門（暫存根、單例、橋接映射、README §17 ↔ 檔、固定埠 8881～8889、`WK_BENCH_OUT`、golden 重產工具）；模組直接案、失敗路徑、不可逆涵蓋表 | 落地 | `rulebook.md`〈測試件與守門〉；`unit-extract-package` ⑧、`unit-extract-direct`／`-failpaths`／`-irreversible`、`unit-extract-golden` |
| 發布面守門（不設 exports／files、無 `.npmignore`、打包清單、範例 `g.mjs` 離線可執行且 README 含全文） | 落地 | GEN-18；`unit-extract-package` ② |
| 合併與爭議之一致性（merge 拒收、不變式）、回滾後之已知雜湊、續作之撤回理由 | 落地 | EXT-34；`unit-core-state`、`unit-extract-bench` s06、`unit-extract-failpaths` ②、`unit-extract-stage` |
| 語言設定 `lang` | 落地 | GEN-20；`unit-extract-locale` |
| 工作流類八角色（`wf-*`）評分題組每案於 `input.state.concept` 自給概念名（128 案）；準備期守門 `wfConceptProblems`（缺、為空、等於「題組」即拒，訊息含欄名）；判定類六角色不檢、不動 | 落地（2026-11-06；使用端 Gitea #87） | EXT-35（`rulebook_bench.md`）；`unit-bench-wf-concept`。**提示詞指紋已改**（修前→修後）：`wf-audit` 0ec11315fdf4f047→5d1dbd0074c4fd94、`wf-accept` 384fce44e0110aa1→9db0f8361da3025f、`wf-pending` 246de996c960d864→9042f5c3972a21e0、`wf-integrate` ce91e458a4247ed8→0cd78faa9f8a13c0、`wf-draft` 9d33ea64027780ac→86f153a73629b0f8、`wf-revise` 3d1bbe4388e418c7→3c52b8cff671460a、`wf-consolidate` 8b17191fd400378e→00cf462b3af1c891、`wf-essence` 05774ce18a608141→2e2507e862051fb4；舊指紋之歷史評比列不可與新列並比。判定類六角色指紋不變 |

## 已知缺口與待辦（依序）

1. 免費 AI 能力評分之補跑：評比表 `模型評比.csv` 目前只有出處修訂、出處支持覆核、失撐找支持三角色之列；其餘角色與新免費池之席位待逐角色跑（須額度與使用者同意），結果併表後定席位與題組判準。工作流類八角色之概念名（EXT-35）**尚未以真 AI 實測實效**（2026-11-06 本套件不呼叫 AI）：待以正式席位重跑八角色，若仍有「把應收材料判離題」或「把應判離題者收入」之失分，逐案調整該案概念名（寬窄取捨見 `rulebook_bench.md`）；餘失分若為 `kinds`／`dispute`／`grounded` 或審計「重複」之嚴重度，屬題組應然或模型能力，與概念名無關。
2. 留待（記為已知限制，未改）：`standards/holdSettle` 仍取整包 env 且 `sweepStaleHolds → env.stateCache → maintainCores` 隱性耦合、專步排程未表驅動；`renderTwinRedirect` 維持 optional；stateDigest 待審段之不可逆清單缺「拆分」（提示詞變更須 A/B）；ES3 掃描欄位集未含理由類欄、受檢範圍兩處既有差異（`checkCore` 對隔離／失撐之參數整條跳過而 `coreFixOf` 照修；ES1 含已結案而 ES3 不含）；`@ref` 文字欄集（candidates 5／4 欄 vs `REF_FIELDS.texts` 9 欄）；recheck 之 createdAt 字串比較；`scriptBadOf` 四套件各一份與 `buildDeps` 摘要／關聯之同型（跨套件審計）。
3. 3+3 五棒之差量題型評比（須使用者同意）；四專步與 ES9 新進之開啟（題組以正式席位逐案兩次全過＋同意）。
4. 舊核心之重建（`regenCore`）、存量處置（`applyCoreStockFix`）皆須使用者同意；先改完驗完才處理舊資料。
5. 重整時發現之疑似遺留（未改）：JSDoc 既有範例 `selectNotes` 之預期值與實跑不符（已更正註解為實跑輸出：`N1:n3,N2:n1`，程式未動，其選篇次序是否符合設計待本套件主責確認）；`unit-extract-package` 〈範例 g.mjs〉等守門與 `g.mjs` 檔末 `// =>` 須同步。

## 需使用者決定者

- 無。
