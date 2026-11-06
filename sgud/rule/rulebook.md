# 規則帳本（w-knowledge-extract）

> **藍圖**：以規則為單位記程式碼須長成什麼樣。本檔為索引、本套件之鐵則與套件審計落地之規則（EXT-23～36）；條目分檔如下表。與現況比對看 `../state/state.md`。
> **路徑基準**：原始碼在 `src/`，本檔與分檔所列檔案路徑（`core/…`、`stages/…`、`createKnowledgeExtract.mjs` 等）除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`；測試在 `test/`（輔助件在 `test/tools/`，隨 npm 包發布供下游取用）。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「摘要套件」＝npm `w-knowledge-summarize`；「關聯套件」＝npm `w-knowledge-relate`；上游三套件之規則在各該套件之 `sgud/rule/`，本套件只保留引用，不複製條文。規則 ID 沿用 GEN／EXT／STD／AI 之編號，缺號登記於〈已移出〉；`AI-`、`REL-`、`SUM-`、`CAP-` 等前綴之規則屬上游套件，條文在各該套件之 `sgud/rule/`。

## 分檔

| 檔 | 內容 |
|---|---|
| `rulebook_general.md` | 總則 GEN-01～04、06、07、09、15、16、18～22、24～26（命名、領域中立、設定、邊界與層序、hook 錨點、評比總表、評分命令列只一份、匯入指定詞、共用件之歸屬、泛用套件之界定、測試件之共用與守門、取三上游只經 npm 指定詞） |
| `rulebook_extract.md` | EXT-01～22（3+3 工作流與降級梯、狀態為真理、待審、重審、撤出處／恢復、關聯變更之影響 EXT-21、本質缺席 EXT-22） |
| `rulebook_standards.md` | 檢定標準之框架與共通條目 STD-00～02、04、07、10、22、25～29（STD-27～29 只記本套件側之取用） |
| `rulebook_standards_extract.md` | 本套件實作之檢定標準 STD-08（提煉納入閘）、STD-12（出處支持覆核 ES9）、STD-15（爭議覆核 ES14）、STD-18（關聯變更之影響 ES10）、STD-21（同義核心 ES11）、STD-23（失撐主張 ES8） |
| `rulebook_bench.md` | EXT-35 工作流類八角色評分題組之概念名（逐案概念名全集、反向案與排除案、盤點指令）；EXT-36 審計謂詞與正式移除判準共用一份、審計與起草題組之材料守則（逐案改動、限制、指紋） |
| 本檔 | 鐵則、EXT-23～36、盤點指令、測試清單 |

## 已移出

屬使用端（宿主專案）或上游套件之規則，不屬本套件，原文由原出處保有：

| 規則 | 原主題 | 去向 |
|---|---|---|
| GEN-05 | 使用端只有一個組裝點 | 使用端 |
| GEN-08 | 使用端之階段要求（含舊套件退役、`./srcPack` 分工） | 使用端 |
| GEN-10 | 使用端之抓取一律取自抓取套件 | 使用端；本套件側見 GEN-24 |
| GEN-11 | 摘要獨立套件只依賴抓取套件且領域中立 | 摘要套件之 `sgud/` |
| GEN-12 | 使用端之摘要一律取自摘要套件 | 使用端；本套件側見 GEN-25 |
| GEN-13 | 關聯獨立套件只依賴抓取與摘要兩套件且領域中立 | 關聯套件之 `sgud/` |
| GEN-14 | 使用端之關聯一律取自關聯套件 | 使用端；本套件側見 GEN-26 |
| GEN-17 | 使用端解體後之結構（執行殼、編排層、轉接檔） | 使用端 |
| GEN-23 | 使用端之派工規範（原帳本即不收） | 使用端 |
| STD-03 | 文件原文另存（抓取套件專屬） | 抓取套件之 `sgud/` |
| STD-14 | 品質測試逐案化（使用端之品質測試放行判準） | 使用端 |
| STD-24 | 盤點表 B 之逐項歸類（使用端之審計表） | 使用端；提煉側之結論併入 README §19 已知限制 |
| STD-05／06／09／11／13／16／17／19／20 | 抓取、摘要、關聯各自之檢定標準 | 各該套件之 `sgud/` |

## 本套件之鐵則

1. **邊界**（GEN-06／18）：只 import 自己、`package.json` 所列套件與抓取、摘要、關聯三套件（各經 `core/capturePackage.mjs`、`core/summarizePackage.mjs`、`core/relatePackage.mjs`；名單明列）。守門：`test/unit-extract-package.test.mjs` ①、`unit-extract-entry`。
2. **層序**（EXT-23）：`core ← guards ← stores ← standards〔根之 logContract 同層〕← workflow ← { stages, ops }`，stages 與 ops 互不引用，domain／bench 為葉（自身可取全部，各層不得取），根檔不被各層取，三埠視為外部；檔級無環。守門 `unit-extract-package` ⑥（含環檢查與判準自檢）。
3. **狀態為真理、md 與 `cores` 記錄為投影**（EXT-01～05）：每核心一份 `<id>.state.json`（CAS、原子寫、`.prev` 上一版）；寫入序 dirty → 狀態 → 再驗版次 → md（手改偵測）→ 記錄 → 筆記 `extractedAt` → 分身 → 清 dirty；四態分流表 `coreStore.loadUsable`（ok／recovered／missing／corrupt）、高水位、熔斷。
4. **3+3 工作流**（EXT-04～10）：三席起草 → 整合（`validateVia`：via 指回候選、操作種類與目標不變、出處不超出聯集、文字過半；全數拒收即程式聯集）→ 審計 → 修訂（補丁守門；移除新項連帶其引用者）→ 終審（逐操作裁決；不可逆操作須明列；一條有效裁決都沒有＝終審失敗）→ 守門＋納入閘（`standards/opStandards.gateOps` 只此一份）→ `workflow/applyWithInvariants`（尾端寫入在不變式之前；違反者逐條剔除後重套）。
5. **三原則**：①回退＝撤銷該次處置之效果；②同一處境同一處置、中止不計、失敗計、未判不記已審、使用者之裁示不被推翻（素材雜湊變了才重提——待判登錄 `ctx.hash`，`waived` 同雜湊不重登）；③**基礎設施失敗留待、不計失敗、不轉使用者**（缺票／同一供應者／中止／席位未設 → `runSupportGate` 之 `withheld` 存待審、pending 留待審；判不了（unsure／disagree）才逐次計、逾 `maxTries` 轉使用者）。
6. **四專步同一規則**：失敗帳欄位由 `MODES` 表給（`<mode>Tries`、`<mode>ItemTries`；同義專步 `step|synonym`）；開啟判準一律 `perRun > 0`（無 `enabled`；ES9 新進為 `supportCheck.enabled`）；範圍為主核心含概念層與類別層（`isPrimaryCore`）；核心層以 `extract.perRun` 封頂；分頁與中止取 `standards/panelVotes.runPanelPages`（放不下對半分、單項仍放不下即材料過大、中止已判之頁照回）；材料不可得者不送審、不計次。
7. **雜湊含素材**：`stockHashOf`／`orphanHashOf`／`disputeHashOf`／`synonymHashOf` 皆含出處內容鍵或兩側素材；ES14 覆核只記於狀態 `doubtChecks`（`hash` 含鍵、`shape` 只結構），掃描之 ES14 列由狀態推得（`disputeProgressOf`），ES11 列之受檢總量與到期由 `synonymCandidatesOf`／`synonymDueOf`（與專步同一函數）。
8. **存量處置**（STD-22／25／26）：範圍＝掃描之逐件判定標準 `STOCK_STDS`；可修者只 ES3／ES5；其餘之違反逐（標準,條目）列修不了 → 套用時登錄 `core:<核心>:<標準>` 使用者待判；先記後寫、回退＝撤銷（after.rev 三態）；修訂落地之檢核雜湊以套用後之條目重算。
9. **排序與統計**：排序一律字碼序 `cmp`（不用 `localeCompare`）；統計鍵不在初值表 → WARN「提煉統計：未知之統計鍵」（須見）；report 之鍵與日誌字樣只在 `logContract.mjs`。
10. **提示詞為契約**：17 鍵提示詞之基準檔 `test/golden/`；改提示詞＝改題目識別，須以正式 prompt＋正式席位對凍結輸入實測後才算驗證。實測之載具＝該提示詞對應之評分角色題組（`node src/bench/cli.mjs --role <角色> --models <正式席位> --runs 2`；判定走正式路徑），判準＝逐案兩回全過；替代文字亦可行（優化）時才做舊／新 A/B；舊字樣與程式不一致之修正（如不可逆清單依 `TERMINAL_OPS` 產生）只做驗證、不設 B 臂。驗證不過之回退判準＝換席（該席位不得擔任該角色），不回舊字樣。golden 變更之步必附對應角色之正式席位實跑結果。
11. **發布面**（GEN-18）：`package.json` 之 `main` 指 `dist/w-knowledge-extract.umd.js`，**不設 `exports`／`files`**、**不提供 `.npmignore`**（npm 包＝git 版控內容：`src/`、`dist/`、`docs/`、`sgud/`、`test/`〔含 `test/tools/`〕、`toolg/` 隨包，`CLAUDE*.md` 由 `.gitignore` 排除）。守門：`unit-extract-package` ②〈發布面〉〈打包清單〉。
12. **原始碼規範**：`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（`// =>` 為實跑輸出；需真實儲存或 AI 者標 `need test in nodejs.`）；`node node_modules/jsdoc/jsdoc.js -c .jsdoc` 須成功；import 取 wsemi `wsemi/src/<函數>.mjs`、lodash-es 單函數路徑（本套件 `src/` 無直接 import）、node 內建模組在 `src/` 無前綴；`toolg/gDistRollup.mjs` 之 external／globals 自 `src/WKnowledgeExtract.mjs` 之 import 圖盤點（原則見該檔檔頭）。

## 套件審計之規則（EXT-23～EXT-34）

每條：規則 → 盤點指令／判準 → 測試。

- **EXT-23 層序與拆檔**：層序如鐵則 2；`stages/extractStage.mjs` 只留 `stageExtract` 之編排，逐核心動作鏈 `stages/extractChain`（五錨點、`MODES` 表、`PANEL_MODES`／`STREAK_MODES`）、步驟序列與專步排程 `stages/extractSteps`（`createSteps` 工廠）、無 AI 維護 `stages/extractMaintain`、投影寫入器 `stores/coreProjection`（含分身轉址頁內建版型 `twinRedirectBodyOf`，domain 轉出）、快取 `stores/contentCache`、檔名常數一律 `stores/extractFiles`（原檔以原名轉出）、待判登錄與結案 `standards/holdSettle`、重審判定 `standards/recheck`、關聯影響 `standards/relationImpact`、核心可修 `standards/coreStockFix`、解析與守門 `standards/{parse,opGuards}`、內建提示詞 `domain/prompts`；`stores/coreState` 只留模型／衍生／不變式／常數（新匯出 `TERMINAL_SET`、`DISPUTE_OPS`、`REF_FIELDS`），差量套用 `stores/coreDelta`、裁決 `workflow/verdicts`、摘要 `stores/stateDigest`；功能表 `EXTRACT_DOMAIN_MEMBERS`／`FEATURE_TABLE`／`extractFeatureProblems` 在 `core/extractSettings`（domain 轉出）。匯出名不改（`RENAMED_SINCE_SPLIT` 列改名：`extractObject` → `replyObjectOf`、`benchCallResultOf` → 抓取 `callJsonShapeOf`）。
  - 測試：`unit-extract-package` ⑥（層序、環、自檢）、`unit-extract-entry`（入口名集 ⊇ 拆檔前 438 名、模組清單）、`unit-extract-registry`（`enforcedAt` 之檔:函數存在）。
- **EXT-24 不經納入閘之寫入入口須登記**：`standards/registry.EXTRACT_UNGATED_WRITE_ENTRIES`（`rollbackCoreStockFix` undo；`regenCore`、`releaseHeld`、`edgeSeenSyncOf`、`writeProjections`、`repairCore`、`settleTwins` mechanical）；核心狀態之寫入站點（`store.save(`／`.restore(`／`.archive(`／`archiveAs(`／`writeMd(`）所在之頂層函數 ⊆ 各標準之 `enforcedAt` ∪ 此表（儲存之實作 `stores/coreStore` 除外）；程式寫入（`persistMechanical`、`mwLoadState`）列於 ES1 之執行處並於寫入前驗 `programWriteProblems`。
  - 測試：`unit-extract-registry`（形狀、反向盤點含判準自檢）。
- **EXT-25 持久檔語意與狀態檔四態**：JSON 帳（失敗帳、邊庫快照、影響留待、重設名單、重練意圖、同義提議紀錄）經 `stores/extractFiles.readLedgerJson`（關聯埠 `loadLedgerJson`）以 `EXTRACT_LEDGER_SHAPES` 驗結構，壞或錯形狀 → 隔離 `.corrupt-<時戳>`＋WARN「提煉帳檔損壞」（須見）；派生快取（content／notop）重建；`normalizeState` 嚴格——缺鍵補預設（不算壞檔）、鍵在場而錯型別＝壞檔；`coreStore.loadUsable(coreId, { repair })` 四態 ok／recovered／missing／corrupt 之單一分流表：提煉段與維護段 recovered 即隔離壞檔 → 立即 save → dirty → 投影，唯讀消費者 ok／recovered 皆讀但 recovered 標未落盤，寫入消費者非 ok 即拒；維護段單輪修復＋隔離逾 5（`STATE_REPAIR_FUSE`）即熔斷並須見「提煉狀態檔熔斷」；corrupt 保留 `.prev`。
  - 測試：`unit-extract-files`、`unit-core-store`、`unit-extract-stage`（四態、熔斷、還原）、`unit-extract-notop`、`unit-extract-lineage`（快照壞檔重建基準、留待錯形狀）。
- **EXT-26 先記後寫（回退＝撤銷——回退只驗形 `normalizeState`、不過閘亦不驗不變式，`unit-extract-irreversible`「契約〔撤銷〕」釘住）**：落盤前登錄（`standards/holdSettle.registerHolds`，ctx 記本次落盤後之 `rev` 與素材 `hash`）→ 狀態 CAS 寫入 → 投影 → 結案與檢核紀錄（`closeHolds`）；落盤失敗依登錄之逆序以前像補償（`compensateHolds`）；維護段先清掃已不適用之未結待判（`sweepStaleHolds`：落盤未完成之假待判、筆記已刪、核心不在、終態）再算重送名單。重練：意圖先記 `extract-regen.json`（`stores/regenIntent`）→ 封存狀態（＋`.prev`）→ 封存 md → 刪記錄 → 結案待判 → `done`，各步冪等可續作；管線開工消化 `done`（清失敗帳與影響留待）、未完成者每輪 WARN「提煉重練意圖未完成」。還原撤回（`ops/reviveClaims`）：閘（`REVIVE_GATE_STDS`＝ES2／4／12／13；ES17 為新進之閘、ES3 由存量處置——不在此閘）→ 寫裁示紀錄 → 落盤 → 結案待判，可續作（續作之結案說明之撤回理由自前次所寫之裁示紀錄 `reason` 取）。存量處置（`standards/stockFix`）：先記帳列（before、預測 `after.rev`、`after.hash`＝去衍生欄之指紋、`seq`）→ 寫入；寫入失敗追加作廢列；回退以內容指紋為主、`after.rev` 三態（回到處置前者才寫；衝突不覆寫、`acceptCurrent`）；修不了以（標準,條目）粒度登錄 `core:<核心>:<標準>` 使用者待判。影響收尾 `finishImpact` try/catch 留待下輪（WARN「提煉維護失敗[關聯影響收尾]」）。重設基準 `stores/rebaseline`（預演超集先記 → 套用 → 未變者取消；`cancelRebaseline`）。
  - 測試：`unit-extract-stage`（登錄先於落盤、CAS 補償、清掃、regen 中斷重跑、reviveClaims）、`unit-extract-stockfix`（先記、作廢列、回退、verify、資料隔離）、`unit-extract-lineage`（影響收尾）、`unit-extract-files`。
- **EXT-27 四專步與 ES9 新進之同一規則（鐵則 5／6）**：失敗帳欄位由 `stages/extractChain.MODES` 表給（`<mode>Tries` 專步層退避 1／2／4 天、`<mode>ItemTries` 逐項計次；同義專步全域鍵 `step|synonym`）；開啟判準一律 `perRun > 0`（無 `enabled`；ES9 新進為 `supportCheck.enabled`），每專步 `maxTries` 設定鍵；範圍＝主核心含概念層與類別層（`isPrimaryCore`），核心層以 `extract.perRun` 封頂；分頁與中止取 `standards/panelVotes.runPanelPages`（放不下對半分、單項仍放不下即「材料過大」待判、中止已判之頁照回、未判留待）；材料不可得者不送審、不計次；逐項計次只對「兩票可用而判不了」，缺票／同一供應者／中止／席位未設為基礎設施失敗 → 留待（runPass 存待審、pending 留待審＋`es9Tries`、專步退避）、不計失敗、不轉使用者，逾 `maxTries` 才轉使用者；雜湊含素材，已豁免而雜湊未變者不重登（`holdsWaivedKept`／`synonymWaivedKept`）；ES14 單一真理 `doubtChecks{ hash, shape }`；ES9 新進骨架一份 `workflow/supportGate`（ES7 修訂路徑在內）。
  - 測試：`unit-extract-dispute`、`unit-extract-orphan`、`unit-extract-support`、`unit-extract-synonym`、`unit-extract-workflow`（supportGate、pending es9Tries）、`unit-extract-stage`（perRun、豁免不重登、FailStreak）、`unit-settings`（鍵與預設）。
- **EXT-28 整合、修訂、終審之守門**：`validateVia`（via 指回候選、操作種類與目標 id 不變、`sides[].sources` 不超出聯集、revise／param_add／essence／add 之文字包含）；整合全數拒收 → 程式聯集（`programUnion` 聯集 `related_add`／`dispute_update`）＋degrade；補丁之 `removes` 查依賴並記 `droppedRefs`（`applyPatch`）；終審一條有效裁決都沒有＝終審失敗（整併整份不套、一般差量破壞性存待審；「終審未裁決任何操作」）、無效列入 `rejected`、重複裁決不同即皆作廢、編號嚴格整數；ES5 無 `rs4HeldOf` → 未能判定；`applyWithInvariants` 一份（尾端寫入在不變式之前，違反者逐條剔除後重套）。
  - 測試：`unit-extract-workflow`、`unit-extract-stage`（漏裁決）、`unit-extract-opstandards`、`unit-core-state`（applyVerdicts）。
- **EXT-29 契約同一實體**：`EXTRACT_STAGE_KEYS ＝ EXTRACT_REPORT_KEYS.subStages`、物件名取 `EXTRACT_REPORT_KEYS.stage`、`EXTRACT_LOG_PARSE` 以階段名常數組字串；統計初值由契約生成 `extractStatInit(keys?)`（條件鍵 `EXTRACT_REPORT_KEYS.conditional`；鍵不在契約即拋；提煉段與六專步同讀）、`agg` 未知鍵 WARN「提煉統計：未知之統計鍵」（須見）；五個 pass 失敗一律帶 `state`，pending 之 `stats` 與 runPass 同形（陣列入 `trace`）；FailStreak 依 `STREAK_MODES`（含 recheck／essence）。
  - 測試：`unit-extract-log-contract`（同一實體 `assert.equal`、detail 鍵集＝實際 report 聯集、統計鍵來源 ⊆ 契約、`extractStatInit`）。
- **EXT-30 小件一份**：區域 `str`／`strs`／`uniq`／`clone`／`TERMINAL` 一律取抓取 `textValueOf`／`textListOf`／`uniq`／`jsonClone` 與 `TERMINAL_SET`；跨檔同名只許各自語意之巢狀閉包且列白名單 `LOCAL_SAME_NAMES`（`unit-extract-package` ⑦；逐字同＝0）；oid `itemOidOf`／`parseItemOid`、失敗帳鍵 `coreLedgerKeyOf`、`notesOfCodes`／`allItemsOf`／`opIdOf`／`KEY_OF_PREFIX`／`REF_FIELDS`（coreState）、`voteTextOf`、`callerOf`、`noteTitleFnOf`、`supportCheckCallOf`、`relationTypeNowOf`、`LEDGER_ERROR_CHARS`、`HASH_FIELD_SEP`；提示詞之類型字由常數產生（`ISSUE_TYPES`、`RECHECK_REASONS`／`RECHECK_SKIP`、`CONFLICT_DISPOSITIONS`、`TERMINAL_OPS`、`SUPPORT_KINDS`；文字逐字不變，golden 不重產）；`kb` 只由 domain 閉包帶入；ES 規則函式一份（`scriptBadOf`、`leakProblem`、`weakEvidenceProblem`、`itemsInScopeOf`）；筆記欄位經抓取 `NOTE_FIELDS`／`markExtracted`／`noteDocIdOf`／`noteCreatedMsOf`；設定無二次退路——`stageExtract` 開工驗 `extractResolvedProblem`，只留 `stageOpts` 五鍵覆寫。
  - 測試：`unit-extract-package` ⑦、`unit-settings`、`unit-extract-golden`／`unit-extract-prompts`。
- **EXT-31 詞彙 null 政策與組裝**：自有之鍵 null＝未給（取預設；`{}`／`[]` 才是「不要」），`guide.extract` 10 欄為共用型別 `'estr'`（空字串、只含空白、非字串皆拋「須為非空字串」；null 沿用預設）；`createExtractRuntime` 之 opt 只收 `RUNTIME_OPT_KEYS`（vocab、prompts、domains、relateDomain；容量警告由組裝者以 `extractWarningsOf` 取），不認得之鍵即拋；`buildDeps` 以抓取 `DEPS_COMMON_KEYS` 組；holds／checks 必開（`REQUIRED_STORES`）。
  - 測試：`unit-vocab`、`unit-extract-assembly`（opt 鍵集、必開集合）。
- **EXT-32 評分**：判定類六角色之提示詞、頁組法、判定與正式路徑同一（ES9 項編號頁內重起、出處去重首見序；`SYNONYM_PAGE_SIZE` 一份；`esCases` ↔ `run*Check` 實際送出之提示詞逐字同之守門；`esSuiteProblems`、`esByMatchOf`、修訂輸入為結構化 `votes` 經 `notSupportedReasonsOf`）；工作流類八角色 `wf-audit`／`wf-accept`／`wf-pending`／`wf-integrate`（可確定）與 `wf-draft`／`wf-revise`／`wf-consolidate`／`wf-essence`（〔結構合規〕）：`pageSize 1`、`expectOf 'ok'`、類別＝首個不成立之謂詞、`esCases.coreStateOf` 一份、`fanoutAdapterOf` 受測席一席其餘凍結；一席兩用（revise、accept）取兩用之最低分；提示詞指紋一律抓取 `benchPromptFpOf`；提示詞或題組改了須以正式席位逐案兩次全過後重評。
  - 測試：`unit-extract-bench`、`unit-bench-wf-concept`（EXT-35）、`api-extract-bench-ai`（十四角色；`WK_LIVE_AI`）。
- **EXT-33 無逆操作與刻意之差須文件化**：`regenCore` 之封存只供人工取回、`settleTwins` 併入後拆開＝自 v1 重練、`quarantine` 之取回法；刻意之差（單份候選濾 `_trial`、pending 經同一份驗證、ops 還原與確定性修正不過守門、整併／本質終審敗整份不套、專步席位不走 `drafters` 鏈、ES8 一案一頁、單席不遞補、逐案兩回、派生快取重建、影響帳重複列、`perRun` 單位、待判期限 30 天、`export *` 公開面、`renderTwinRedirect` optional、`coreStore` 之 CAS 承諾為「寫入者須持共同鎖」）寫 README〈維運〉〈已知限制〉與各檔檔頭。
  - 測試：文件項以 `unit-extract-package` ④（沿革與宿主路徑掃描）守形式。
- **EXT-34 合併與爭議之一致性、回滾後之已知雜湊**：`coreDelta` 之 merge（claims）拒收「合併會使爭議 D 之不同方指向同一主張（C1、C3 分屬其各方）」——爭議兩方立場相反卻引同一條者不是同義；`checkInvariants` 新不變式「爭議之不同方引同一主張：D→C」只報方數未變而新產生者（爭議併爭議之各方原樣併入、新增一方不在此列；存量既有者不報）；`mwLoadState` 高水位分支重建投影時把磁碟 md 之雜湊記入 `renderHashes`（同 `repairCore`），git 回滾後不再誤報「提煉手改另存」。
  - 測試：`unit-core-state`「merge 不得使同一爭議之不同方指向同一主張」、`unit-extract-bench` `WF_NEG` s06（多併 → `noLoss`）、`unit-extract-failpaths` ②（回滾後無「提煉手改另存」）、`unit-extract-stage`「reviveClaims 之閘、序與續作」。
- **EXT-35 工作流類八角色之評分題組每案自給概念名，準備期守門拒收缺者**：八個 `wf-*` 角色之正式提示詞皆含離題規則（規則 1；審計之「離題」意見亦然），「離題」以概念名為準；題組每案須於 `input.state.concept` 給涵蓋應收錄材料、不涵蓋應判離題者之概念名（中性日常主題、4～10 字），否則 `coreStateOf` 預設「題組」使模型把全部材料判為離題、得分失真。守門＝`extractBench.mjs` 之 `wfInputProblems`（八角色共用）內之 `wfConceptProblems`：缺、為空或等於 `ES_CASE_CONCEPT` 即於準備期拒收並指明欄名；判定類六角色不檢、題組與提示詞不動。逐案概念名全集、反向案與排除案、盤點指令見 `rulebook_bench.md`。使用端需求出處：Gitea #87。
  - 測試：`unit-bench-wf-concept`（每案給概念名、提示詞首段、守門含欄名、判定類不受影響）。
- **EXT-36 評分謂詞與正式移除判準共用一份；審計、起草題組之材料與應然一致**：審計（`wf-audit`）謂詞 `flags` 判「植入之缺陷是否被指出」，不另抄規則，與 `removalAllowed` 共用 `workflow/reviewGuards.removalIssueOf`（意見面：捏造、離題須高嚴重度，重複不論嚴重度；破壞性放行、爭議類移除理由、移除方自述之理由仍由 `removalAllowed` 判）；`removalAllowed` 之既有行為不變；`clean` 與之對稱（不乾淨＝被列任何高嚴重度意見，或被列足以使正式流程移除該操作之意見，兩條件取聯集）；審計意見 `ref` 為空不指向任何操作（`issueOnOp`；正式流程與評分共用，修正缺 `ref` 之意見會放行移除之缺陷）。審計題組三守則（標注不寫出處所無之內容、材料只含被操作收入之知識、有主張者附本質）、起草題組 `kinds` 與材料一致、起草謂詞 `dispute`／`grounded` 不成立之說明寫明原因。逐案改動、限制與待決、提示詞指紋見 `rulebook_bench.md`。使用端需求出處：Gitea #89。
  - 測試：`unit-bench-wf-audit-cases`（本質、利弊帳、準備期、植入缺陷非爭議類、起草 kinds、note 同步）、`unit-extract-bench`（謂詞與單一來源交叉驗、`clean` 對稱、空 `ref`、不成立之說明）、`unit-extract-workflow`（`removalIssueOf`、`removalAllowed` 既有行為凍結、缺 `ref` 之意見含正式 `runPass`）。
- **測試件與守門**：暫存根一律 `extractTestKit` 之 `tmpRoot`／`removeRoots`（`before` 內建、`after` 回驗；模組層以 TMP 建構之 env 延後實例化，`mkEnvIn` 拒非絕對路徑）；原始檔走訪取抓取 `sourceFilesOf`（根為 `src/`）、JSONL 讀取取 `readJsonlRows`、概念折疊還原一律 `resetConceptFold()`、失敗帳讀取 `ledgerOf`、替身 `scriptAi` 之 `netDown`／`skipped`、`noAi`／`blankAi`；橋接三檔檔頭【移植】指定詞「<上游>/src/<入口>」「<上游>/test/tools/<檔>」皆可映射；README §17 表＝實際 `test/*.test.mjs`；固定埠 8881（死埠）、8882（假埠）、8883～8889 保留；真 AI 評分之工作目錄與報表一律 `WK_BENCH_OUT`（專案外絕對路徑）；golden 中立組以 `test/tools/regen-golden.mjs` 重產（預設預演、`GOLDEN_WRITE=1` 才寫；覆寫組 16 檔不可重產）。
  - 測試：`unit-extract-package` ⑧（暫存根、單例不跨檔汙染、橋接映射、README §17 ↔ 檔、固定埠與暫存敘述；各含判準自檢）、`unit-extract-golden`「重產工具」三案。

## 盤點指令與判準

| 項 | 指令（於套件根） | 判準 |
|---|---|---|
| 全套測試 | `npm test`（＝`mocha --parallel "test/*.test.mjs" --timeout 180000`） | 0 失敗；pending 只有真 AI 之案 |
| 結構與守門 | `unit-extract-package`、`unit-extract-entry`、`unit-extract-registry`（各標準的 enforcedAt）、`unit-extract-log-contract`（WARN／ERROR 發出點歸類、report 鍵全集）、`unit-extract-files`、`unit-extract-contract` | 皆綠 |
| 提示詞基準 | `unit-extract-golden`；中立組 `node test/tools/regen-golden.mjs`（預演）、`GOLDEN_WRITE=1` 才寫；覆寫組不可重產 | 逐字相同；預演「會新增 0、會改動 0」 |
| 層序與同名件 | `unit-extract-package` ⑥（層序、環）、⑦（區域同名件） | 違反邊 0；逐字同之跨檔同名 0 |
| 舊名與領域詞 | `git grep --untracked -nE "\bdistill|\borganize" -- src test README.md g.mjs toolg`；`git grep --untracked -nE "量化|台股" -- src g.mjs toolg README.md` | 皆應為空 |
| JSDoc 與文件 | `node node_modules/jsdoc/jsdoc.js -c .jsdoc`；`node toolg/gDocsExams.mjs` | exit 0、無 ERROR |
| 編譯 | `node toolg/gDistRollup.mjs`；`require('./dist/w-knowledge-extract.umd.js')` 具名匯出集合＝`src/WKnowledgeExtract.mjs` | exit 0；集合與型別相同 |
| 打包清單 | `npm pack --dry-run --json`（`unit-extract-package` ② 守） | 含 `sgud/` 與 `test/tools/`；不含 `CLAUDE*.md`、`tmp/`、`test/_tmp/` |

## 測試清單（`test/`）

- 結構與契約：`unit-extract-package`、`unit-extract-entry`、`unit-extract-registry`、`unit-extract-log-contract`、`unit-extract-contract`、`unit-extract-files`、`unit-extract-locale`、`unit-settings`、`unit-vocab`、`unit-domain-terms`、`unit-extract-rules`、`unit-extract-domain`、`unit-extract-prompts`、`unit-extract-golden`、`unit-extract-assembly`、`unit-extract-object`
- 狀態與工作流：`unit-core-state`、`unit-core-store`、`unit-extract-workflow`、`unit-extract-opstandards`、`unit-extract-lineage`、`unit-extract-render`、`unit-extract-notop`、`unit-selection`、`unit-extract-aicall`、`unit-extract-upstream-budget`、`unit-flow-extract`、`unit-extract-stage`、`unit-extract-ops`（regenCore 不直接改帳，意圖檔由管線消化）
- 檢定標準與專步：`unit-extract-standards`、`unit-extract-audit`、`unit-extract-support`、`unit-extract-dispute`、`unit-extract-orphan`、`unit-extract-synonym`、`unit-extract-stockfix`
- 模組之直接案、失敗路徑、不可逆涵蓋表：`unit-extract-direct`（相似度閾值邊界、候選十件、opGuards、parse、提示詞四件、`bodyHashOf`、重審理由常數）、`unit-extract-failpaths`（四態於段層、高水位、投影補正、分身補完、維護失敗四站、專步斷網、並行共寫、reviveClaims CAS／半套、手改另存、步 × 到點表、失敗帳寫入失敗）、`unit-extract-irreversible`（`TERMINAL_OPS` × 套用／待審／拒絕／還原之涵蓋表、撤銷與重新收件兩契約）
- 評分：`unit-extract-bench`、`unit-bench-wf-concept`（工作流類八角色題組之概念名與守門）；真 AI：`api-extract-bench-ai`（`WK_LIVE_AI=1` 且 `WK_BENCH_OUT`）
- 以上共 42 個 `test/*.test.mjs`；工具（`test/tools/`，不帶 `.test.`）：`extractTestKit`（`tmpRoot`／`removeRoots`、`buildTestExtractor`、`landNote`）、`extractKit`（`scriptAi`、`mkEnvIn`、`ledgerOf`、`noAi`／`blankAi`、`ANN`、`clock`）、`promptInputs`、`quantVocab`、三橋接 `captureForTest`／`summarizeForTest`／`relateForTest`、`regen-golden.mjs`；README §17 之表與本清單須與實際檔一致（`unit-extract-package` ⑧ 守 README；本清單人工對）
