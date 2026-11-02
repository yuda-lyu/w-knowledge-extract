# 處理要點 — 提煉（3+3）之設定與監看（w-knowledge-extract）

> **路徑基準**：原始碼在 `src/`，本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`；上游三套件（抓取 `w-knowledge-capture`、摘要 `w-knowledge-summarize`、關聯 `w-knowledge-relate`）之檔寫作「<套件名> 之 <路徑>」，位於 `node_modules/<套件名>/`。「使用端」＝使用本套件之專案。

## 提煉(3+3)之設定與監看

- **流程**:三家獨立起草(同一份提示詞,各出一份差量)→ 整合(合併三份候選,via 指回候選;程式計票、ref 閉包)→ 審計(只列問題,附嚴重度;程式先把超限列為意見)→ 修訂(只出補丁 `{edits, adds, removes}`,補丁守門:審後不得比審前差;審計無意見即略過)→ 終審(逐操作 keep／drop／doubt／fix;取代／撤回／合併／拆解須明列,未列或終審失敗者存待審)→ 程式套用(狀態為真理,不變式違反者逐條剔除後重套)。有效主張逾 `extract.claimsCap` 時同一 3+3 走整併;前次之待審於下次處理該核心時先交終審席裁決。
- **降級梯**:起草全敗 → 本批失敗(筆記回待提煉、記失敗帳);只 1 份候選 → 略過整合;整合敗 → 程式聯集;審計／修訂敗 → 以最後一份合格差量續跑;終審敗 → 建設性照套、破壞性存待審;截止 → 本批不套用、不計失敗、只記 lastTriedAt(輪替)。**截止感知**:管線恆給 `shouldStop`,故上游「預算耗盡且整輪剩餘不足該席一次最低嘗試」或棒回來已到點皆歸截止,不走降級梯(否則截止前窗內整合／審計／終審全略過、起草聯集未經審核落盤)。
- **設定所在**(預設見 `core/extractSettings.mjs` 之 `EXTRACT_DEFAULT`):節奏 `extract.minNotes` 6、`extract.perRun` 4(**0＝停用**:每輪 INFO「提煉停用」、不產容量警告)、`extract.notesPerConcept` 12、`extract.catchupBatches` 3;開工門檻 `extract.minRemainingMs` 套件預設 900000(一批 5～7 棒、單棒可達數百秒;以日誌「截止 N」校準——持續出現即門檻低估);整併 `extract.claimsCap` 80、`extract.consolidateEvery` 5。預設席位 `extract.ai`(`EXTRACT_AI_DEFAULT`)為兩家免費模型(`oc:opencode/mimo-v2.6-flash-free`、`oc:opencode/big-pickle`)輪替、互為 fallback,各席 `timeoutMs` 600000、`minAttemptMs` 90000(起草三席首選依序為 mimo、big-pickle、mimo,計票以實際成交之供應者計);付費家由安裝方加於 fallback 尾。
- **逐輪監看**(日誌與 `run.json` 之字樣見 `logContract.mjs` 之 `EXTRACT_LOG_KNOWN`／`EXTRACT_LOG_MUST_SEE`／`EXTRACT_REPORT_KEYS`):
  - **筆記被改**(改標題、內容類型、證據等級)→ 只做投影更新(無 AI)。單輪逾 `extract.recheck.guard`(預設 20 篇)即「提煉內容變更守門」不排重審;確屬真實修訂者調高守門放行;大量格式變動而非內容修訂者用 `requestRebaseline` 指示以現值重設基準。
  - **筆記被刪／還原**:走關聯套件之明示刪除／還原;下一輪提煉段見墓碑即**撤出處**(無 AI、可逆):失撐條目移至核心 md「出處已撤之條目（待重審）」、本質標待重寫、`noteCount` 減;還原即恢復。記錄消失而無墓碑 → WARN「提煉出處懸空」(須見),不撤。
  - **新衝突邊**(關聯段新判,或既有邊升級為衝突)觸及核心所引之筆記:夥伴筆記排重審(衝突滿半批或最舊已等 7 天才開僅重審 pass),起草見「新判衝突」→ 立爭議或判非對立。
  - **衝突撤銷／降級**(關聯重評閘門 `'all'` 時才會發生;規則帳本 EXT-21):只依事件帳 `state/relate-conflict-events.jsonl` 判定(邊讀不到不推定);無爭議涉及者只自 `seenConflicts` 移出(無 AI)。`previewRecheck` 逐核心列「衝突已撤銷 N 項」。
  - **可觀察性**:選題行「提煉選題：…；重審待處理：內容變更 a 篇、新衝突 b 條」;`state/extract-attempts.json` 之 `recheckLastError`(僅重審 pass 失敗,退避 1／2／4 天)。
- **出處支持覆核之證據性質(ES9 v2)**:推論類之主張須在條件寫明出處明載之前提;非推論類須為出處直接陳述。覆核判不支持之「主張 × 出處」記入排除集(`srcExcluded`),該出處不再計為該主張之證據。
- **本質缺席(規則帳本 EXT-22)**:首版之本質操作若被拒(所引 `@ref` 之主張被剔除等),核心落成「（尚未歸納）」——下次處理該核心時狀態摘要會明示「尚未歸納…本批須以 essence 綜合現有主張」而補上。長期未再被選中之核心不必等新筆記:每輪之本質專步(ES6 v2,`essenceNeedOf`;無本質者先、每輪至多 `parallel` 個、未補成退避 1／2／4 天)會補上。日誌「提煉本質截短[…]：a → b 字（核心尚無本質…）」屬最後防線之正常訊息。
