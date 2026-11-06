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
- JSDoc：`src/` 匯出函數 341 個，說明、`@param`、`@returns`、`@example` 皆 341/341；匯出常數 171/171；可實跑之範例 249 則經腳本實跑核對 `// =>`，92 則標 `need test in nodejs.`（需真實儲存或 AI）。其後新增之匯出函數 `es5ReopenOf` 亦具說明、`@param`、`@returns`、`@example`（範例已實跑核對）；`maintainCores` 之 JSDoc 補列 `env.relEdges`、`env.rs4Held`。新增之匯出函數 `removalIssueOf`（`workflow/reviewGuards`）亦具說明、`@param`、`@returns`、`@example`（範例已實跑核對）。

## 最近驗證

| 日期 | 項 | 結果 |
|---|---|---|
| 2026-11-06 | 起草提示詞以字面寫出納入閘與 ES13 之字面要求（EXT-37；使用端 Gitea #90）後全套（`npm test`，經 quiet-run 鎖） | 899 通過／0 失敗／14 待決（同上）；新增 4 案於 `unit-extract-domain`〈EXT-37〉（修前紅：dispute_add 行、param_add 行隨詞彙、所列＝ES13 接受之字面共 3 案；與納入閘一致之 1 案修前後皆綠，由變異證其有效）；變異：列表不去重 → 1 案紅、列表拿掉 `weakEvidence` → 2 案紅、納入閘放寬「無本批出處」→ 1 案紅；還原後全綠；基準檔：中立 `delta-draft`、`delta-draft-partial` 重產（會新增 0、改動 2、相同 14），覆寫重現同名兩檔手改；十四角色指紋前後對照只有 `wf-draft` 變。**未呼叫 AI**（A/B 由使用端以正式起草席位做過） |
| 2026-11-06 | `clean` 與正式移除判準對稱、`issueOnOp` 空 `ref` 修正（EXT-36 第二輪）後全套（`npm test`，經 quiet-run 鎖） | 895 通過／0 失敗／14 待決（同上）；新增 4 案（`unit-extract-bench` 2、`unit-extract-workflow` 2）＋ `WF_NEG` 1 筆反例、`unit-bench-wf-audit-cases` R6 加 1 斷言；修前紅 6 案（對第一輪之碼）；變異：`clean` 拿掉足以移除條件 → 2 案紅、拿掉高嚴重度條件 → 1 案紅、還原 `issueOnOp` 空 `ref` → 3 案紅；還原後全綠；八角色提示詞指紋不變 |
| 2026-11-06 | 審計謂詞與正式移除判準共用一份、審計與起草題組材料守則、起草不成立之說明（EXT-36；使用端 Gitea #89）後全套（`npm test`，經 quiet-run 鎖） | 891 通過／0 失敗／14 待決（同上）；新增 15 案（`unit-bench-wf-audit-cases` 9、`unit-extract-bench` 4、`unit-extract-workflow` 2；修前紅 10 案，另 `removalAllowed` 既有行為凍結案修前後皆綠）；變異：共用判定件改為重複須高 → 4 案紅且謂詞與 `removalAllowed` 兩側同變、只改 `removalAllowed` → 2 案紅、謂詞改回只計高 → 2 案紅、`grounded` 說明改讀不存在之 `why` → 1 案紅、`dispute` 說明拿掉 → 1 案紅、題組退回舊材料（拿掉 a05 本質、a01 利弊、d01 加 `kinds`）→ 5 案紅；還原後全綠。**未以真 AI 實測題組改動之實效**（待使用端重跑評比） |
| 2026-11-06 | 已見衝突之維護回頭檢查（ES5；使用端 Gitea #88）後全套（`npm test`，經 quiet-run 鎖） | 876 通過／0 失敗／14 待決（同上）；新增 7 案於 `unit-extract-lineage`（修前紅：爭議拆解、撤回、取代三個段內案紅於 `conflictReopened` 未定義；其餘四案為新函數之純判定 2、類別層與首見基準之範圍案〔停用維護步時紅〕、RS4 任一狀態之負向對照案〔修前亦綠，由變異證其有效〕）；變異：停用維護步 → 段內 4 案紅、`rs4HeldOf` 恆 false → 4 案紅（純判定 2、段內 2）、拿掉待判集合非 Set 之守門 → 1 案紅、維護前不讀待判登錄 → 段內 4 案紅；還原後全綠。**未在正式庫實跑**（待使用端升版後之第一輪維護） |
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
| 已見衝突之維護回頭檢查（ES5；維護 ③′之二；`es5ReopenOf`、`env.rs4Held`、report `conflictReopened`、INFO 一行）：處置結構被拆解、取代、撤回拿掉而無去向、未交 RS4 者每輪自 `seenConflicts` 移出（無 AI、不升版），由重審項重呈，逾次交 RS4（有界） | 落地（2026-11-06；使用端 Gitea #88）；限制：類別層核心無重審項、待下批觸及兩端才重呈；首見基準之核心基準後同輪即受檢；未以正式庫實跑 | STD-08 之 ES5 衝突去向（`rulebook_standards_extract.md`）、EXT-18；`unit-extract-lineage` |
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
| 評分謂詞與正式移除判準共用一份：審計（`wf-audit`）謂詞 `flags` 與 `removalAllowed` 共用 `workflow/reviewGuards.removalIssueOf`（重複不論嚴重度、離題／捏造須高）；審計題組乾淨之操作不寫出處所無之標注、有主張之案附本質、材料只含被操作收入之知識；起草題組 `kinds` 與材料一致（d01、d09 刪 `kinds`，d03、dh4 材料改寫）；起草謂詞 `dispute`／`grounded` 不成立之說明寫明原因 | 落地（2026-11-06；使用端 Gitea #89） | EXT-36（`rulebook_bench.md`）；`unit-bench-wf-audit-cases`、`unit-extract-bench`、`unit-extract-workflow`。**提示詞指紋已改**（修前→修後）：`wf-audit` 5d1dbd0074c4fd94→31fac4eef96fe883、`wf-draft` 86f153a73629b0f8→dd8b47fb92930902；其餘十二角色不變；舊指紋之歷史評比列不可與新列並比。第二輪（2026-11-06）：`clean` 與 `flags` 對稱（不乾淨＝被列任何高嚴重度意見，或被列足以使正式流程移除該操作之意見，取聯集；指紋不變）；`issueOnOp` 空 `ref` 不指向任何操作（正式流程之修正：缺 `ref` 之審計意見不再放行移除／剔除）。限制：正式提示詞之觀察（起草 `dispute_add` 之 `sources`、`param_add` 之限制語、`principle` 偏好）不在本輪（須正式路徑 A/B）；其中前二者已於 EXT-37 處理（見下列），`principle` 偏好仍待 A/B |
| 起草提示詞以字面寫出程式以字面判讀之要求（EXT-37）：`dispute_add` 整條須至少一個本批出處 sources（提示詞：至少一方要寫本批出處 sources，各方只引主張而整條無 sources 者會被拒收）；`param_add` 弱證據參數之 conditions 須含限制語（ES13；提示詞列出 `vocab.selfLimitPhrases` ∪ `guide.extract.weakEvidence`，隨詞彙而變，註明程式以字面判讀、同義改寫不算）；其餘由程式字面判讀而提示詞未寫出者十四項已盤點記帳（`rulebook_prompt.md`），未改 | 落地（2026-11-06；使用端 Gitea #90；使用端已以正式起草席位 A/B：`wf-draft` 10/16 → 14/16，兩類失分 6 回 → 0）；不改納入閘與判定；限制：`param_add` 之提示詞觸發語「證據僅單一來源或未經獨立驗證者」與程式之觸發（程式判定之證據等級最低或未評估）不完全重合 | EXT-37（`rulebook_prompt.md`）；`unit-extract-domain`〈EXT-37〉四案、`unit-extract-golden`。**提示詞指紋已改**（修前→修後）：`wf-draft` dd8b47fb92930902→5118f8f40bf0dc40；其餘十三角色不變。`extractPromptId`（預設詞彙、預設席位鏈）9bef7868be78→ad809c62713f（逾限筆記之 ES15 待判依既有機制，升版後首輪重送）。中立基準 `delta-draft`、`delta-draft-partial` 重產；覆寫重現同名兩檔手改（登錄於 `unit-extract-golden` 檔頭）。本套件未呼叫 AI；實效待使用端升版後觀察正式日誌「無本批出處」「ES13…不採」之頻率 |

## 已知缺口與待辦（依序）

1. 免費 AI 能力評分之補跑：評比表 `模型評比.csv` 目前只有出處修訂、出處支持覆核、失撐找支持三角色之列；其餘角色與新免費池之席位待逐角色跑（須額度與使用者同意），結果併表後定席位與題組判準。工作流類八角色之概念名（EXT-35）**尚未以真 AI 實測實效**（2026-11-06 本套件不呼叫 AI）：待以正式席位重跑八角色，若仍有「把應收材料判離題」或「把應判離題者收入」之失分，逐案調整該案概念名（寬窄取捨見 `rulebook_bench.md`）；審計「重複」之嚴重度與起草 `kinds` 之應然已於 EXT-36 與正式判準對齊；餘失分若為 `kinds`／`dispute`／`grounded`，先看謂詞之不成立說明（已分「未提出」與「提出而被拒收」），屬題組應然、正式提示詞與納入閘之字面差或模型能力，與概念名無關。
2. 留待（記為已知限制，未改）：`standards/holdSettle` 仍取整包 env 且 `sweepStaleHolds → env.stateCache → maintainCores` 隱性耦合、專步排程未表驅動；`renderTwinRedirect` 維持 optional；stateDigest 待審段之不可逆清單缺「拆分」（提示詞變更須 A/B）；ES3 掃描欄位集未含理由類欄、受檢範圍兩處既有差異（`checkCore` 對隔離／失撐之參數整條跳過而 `coreFixOf` 照修；ES1 含已結案而 ES3 不含）；`@ref` 文字欄集（candidates 5／4 欄 vs `REF_FIELDS.texts` 9 欄）；recheck 之 createdAt 字串比較；`scriptBadOf` 四套件各一份與 `buildDeps` 摘要／關聯之同型（跨套件審計）。
3. 3+3 五棒之差量題型評比（須使用者同意）；四專步與 ES9 新進之開啟（題組以正式席位逐案兩次全過＋同意）。
4. 舊核心之重建（`regenCore`）、存量處置（`applyCoreStockFix`）皆須使用者同意；先改完驗完才處理舊資料。
5. 重整時發現之疑似遺留（未改）：JSDoc 既有範例 `selectNotes` 之預期值與實跑不符（已更正註解為實跑輸出：`N1:n3,N2:n1`，程式未動，其選篇次序是否符合設計待本套件主責確認）；`unit-extract-package` 〈範例 g.mjs〉等守門與 `g.mjs` 檔末 `// =>` 須同步。

6. 起草提示詞「字面落差」未套項（EXT-37，`rulebook_prompt.md`〈未套〉十四項）：優先序（盤點，後果由重至輕）——同一既有條目至多一個改狀態操作（違反者涉及之全部操作皆拒收）、流程外洩片語九詞（reason 亦受檢，起草提示詞自身多處用「本批筆記」）、索引行條目不可改狀態、`dispute_update` 之整條本批出處、整合提示詞之 `dispute_add` 說明仍只寫「每方」（未寫整條至少一個本批出處）、ES2 數字紮根之範圍（只看本操作所引出處）；每項須先核對再 A/B（`wf-draft` 題組）才可改提示詞；`skipped` 之「非對立」措辭歧義待實測是否被誤讀。

## 需使用者決定者

- 無。
