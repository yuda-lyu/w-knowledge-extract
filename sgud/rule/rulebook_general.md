# 規則帳本 — 總則 GEN-*（w-knowledge-extract）

> **路徑基準**：原始碼在 `src/`，本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`；上游三套件（抓取 `w-knowledge-capture`、摘要 `w-knowledge-summarize`、關聯 `w-knowledge-relate`）之檔寫作「<套件名> 之 <路徑>」，位於 `node_modules/<套件名>/`（`src/`、`test/tools/`、`sgud/`）。
> 本檔為本套件之總則；整條移出者見 `rulebook.md`〈已移出〉。現況以 `../state/state.md` 與 README 為準；盤點指令皆於套件根以 `git grep --untracked` 重跑（提交後可去 `--untracked`）。

## 1. 總則(命名、組裝、設定、邊界)

- **GEN-01 四模組英文名唯一**:抓→`capture`、摘要→`summarize`、關聯→`relate`、提煉→`extract`,用於目錄、設定之四大工作段、物件工廠、hook 前綴、欄位、評比角色;舊名 `fetch`(區段)、`extract`(萃取義)、`organize`、`distill` 不得再出現。中文「彙整」只留「彙整貼文」(aggregator post)、「萃取」只留 prompt 原文。
  - 為何:設定與套件曾三套名字並存,文件與程式對不上。
  - 盤點:`git grep --untracked -nE "\bdistill|\borganize|docsPerExtract|fetchExtract|ai\.distill|settings\.fetch\b|createFetchObject|extractTries|extract-failed|distilledAt" -- src test README.md g.mjs toolg` 應為空(`sgud/` 內對照表不在範圍)。
  - 站點:資料層 `notes.extractedAt`、失敗帳 `state/extract-attempts.json`(`stores/extractFiles.mjs` 之常數)— 已套。
- **GEN-02 機制入套件、領域留使用端**:本套件之原始碼、預設設定、預設詞彙、提示詞、題組、README 不含任何領域詞(量化／股市／站名等);領域句走 `data.vocab` 之 `kbLabel`／`guide`,數字走設定,抓取器與 domain 可注入。
  - 盤點:`git grep --untracked -nE "量化|台股|Quantocracy|Quantpedia" -- src g.mjs toolg README.md` 應為空。
  - 站點:提示詞 domain `domain/extractDomain.mjs`、`domain/prompts.mjs`(領域句欄位化,由詞彙 `guide.extract` 十欄給回);詞彙預設 `core/vocab/extractVocab.mjs`(`basisCaps` 為「獨立驗證」等通用性質、`presumedBasis` 預設 `null` 不推定、`selfLimitPhrases` 通用)— 已套。使用端要領域措辭者以詞彙覆寫(`resolveExtractVocab`/`pickExtractVocab`)。
  - 測試:`test/unit-extract-package.test.mjs` ⑤(含 README、`g.mjs`、`toolg/`、`test/tools` 之領域詞掃描;詞表單一來源為抓取套件之 `test/tools/domainTerms.mjs`,經 `test/tools/captureForTest.mjs` 取用);`unit-extract-domain`、`unit-vocab`。
- **GEN-03 設定依段分組、逐層驗證、啟動期拋錯、不靜默回預設**:設定段為 `ai`(AI 調度層與併發;即抓取套件之 ai 段)與 `extract`(提煉之全部設定,依要點分組;檢定標準另成 `standards` 組,含符合度掃描開關 `scanEachRun`;AI 席位放在用到它的那一組,鍵名一律 `ai`);推導值在 `capacity`(唯讀)。驗證三層:頂層 cfg 鍵以 `CFG_KEYS`(`createKnowledgeExtract.mjs`)驗;各段以 schema 逐組遞迴驗鍵集、型別、值域(`core/extractSettings.mjs` 之 `EXTRACT_SCHEMA`／`EXTRACT_AI_SCHEMA`,合併與型別規則取抓取套件之 `mergeSettingsGroup`);`extract.ai` 須合 3+3 席位(`extractSeatsProblem`,啟動期與執行期各驗一次)。合併:組(物件)逐鍵遞迴,葉(含席位、樣式陣列)給了即整個取代。
  - 為何:打錯鍵、數字寫成字串、席位給錯形狀若靜默回套件預設(含付費席位),比拋錯更難察覺。
  - 盤點:`git grep --untracked -nE "mergeSettingsGroup\(|resolveExtractSettings\(|CFG_KEYS|extractSeatsProblem\(" -- src`。
  - 站點:`core/extractSettings.mjs`(解析、`extractSeatsProblem`、`extractResolvedProblem`)、`createKnowledgeExtract.mjs`(CFG_KEYS)、`stages/extractStage.mjs`(執行期驗)— 已套;執行期數值鍵取抓取套件之 `resolveRuntime`(給了無效視同未給＋警告;有安全預設)— 刻意不套拋錯。
  - 測試:`test/unit-settings.test.mjs`、`unit-extract-assembly`(CFG_KEYS ↔ 讀取者骨架比對、逐鍵嚴格性案例表之鍵集須等於 `CFG_KEYS`)。
- **GEN-04 套件只放新格式、不含遷移與舊名退路**:舊資料一律以使用端一次性工具處理(dry-run 預設、`--apply` 須同意、每步回驗);本套件遇非本格式資料只檢核、fail-closed、不轉換。
  - 盤點:`git grep --untracked -nE "legacy|遷移|migrat|舊格式|舊名退路" -- src` 應只命中「不做遷移」之說明與 fail-closed 之拒寫訊息(「相容」一詞另指能力／介面相容,不列入)。
  - 站點:`stores/coreStore.mjs`(非本格式版本回 `foreign` 跳過,不轉換)— 已套;關聯邊庫世代(未遷移之有序對 id)屬上游關聯套件,本套件只讀。
- **GEN-06 模組邊界與層序**:本套件只 import 自己的檔案、`package.json` 所列套件,以及抓取、摘要、關聯三套件(各**只**經單一匯入點 `core/capturePackage.mjs`、`core/summarizePackage.mjs`、`core/relatePackage.mjs`,各只指向其上游之主入口;所列之名須存在於上游主入口且為同一實體)。層序 `core ← guards ← stores ← standards〔根之 logContract 同層〕← workflow ← { stages, ops }`:層內之檔只取同層或更低層、stages 與 ops 互不引用、domain 與 bench 為葉(自身可取全部,各層不得取)、根檔(入口、總組裝、物件、執行期件)不被各層取、三埠視為外部;檔級無環。四工作於管線中只經 `ctx.deps`(stores／settings／domains／ai)溝通。
  - 測試:`test/unit-extract-package.test.mjs` ①(埠與橋接之指定詞、埠只列套件程式碼所需之名)、⑥(層序、環、判準自檢)、`unit-extract-entry`。
- **GEN-07 hook 錨點全集(改錨點名須同步此表、README §10、插件測試)**:`extract.extract.{loadState, selectNotes, pass, renderState, persistState}`(`extractObject.mjs` 之 `EXTRACT_TAP_STAGE_KEYS`;於建構期驗,對不存在之錨點建立物件即拋)。
  - 盤點:`git grep --untracked -nE "EXTRACT_TAP_STAGE_KEYS" -- src`。
  - 測試:`test/unit-extract-object.test.mjs`、`unit-extract-assembly`。
- **GEN-09 測試之掃描／匯入根以測試檔位置推導,不用 cwd**:凡以 `readdirSync` 列舉原始碼、或 `import()` 逐檔載入者,根一律 `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`(再接 `src`);暫存目錄(`test/_tmp/…`)以 cwd 相對者不在此限(只建檔、不執行)。掃描根必須是 `src/`:套件根另有 `toolg/`、`g.mjs`(執行即改版號、清資料夾、編譯),被逐檔 import 即造成副作用。
  - 盤點:`git grep --untracked -nE "path\.resolve\('\.'\)|readdirSync\(\s*'\.'" -- test` 應為空。
  - 站點:`test/unit-extract-entry`、`-package`、`-registry`、`-rules`、`-log-contract`、`-assembly`(讀 `src/…`)— 已套。
- **GEN-15 評比總表 `模型評比.csv` 在套件根,只由評分命令列之 `--board` 產生與更新**:本套件根之 `模型評比.csv` 為 `--board` 累積之評比表(表頭只在抓取套件 `BENCH_BOARD_HEADER` 一份,併入時表頭不同即拒寫),隨 npm 包發布;不得由其他程式寫入、不得手改列。
  - 盤點:`git grep --untracked -nE "模型評比\.csv" -- src test` 命中應只有 `--board` 說明與 `unit-extract-bench` 之守門。
  - 測試:`test/unit-extract-bench.test.mjs`〈套件根之 模型評比.csv〉。
- **GEN-16 多角色評分命令列與逐案題組之頁組法各只一份**:①多角色之 AI 能力評分命令列(--role 之解析與「all 不可給 --cases 與角色專屬參數」、--vocab-pick 之子集檔 `<套件>-vocab-<時間戳>.json`、全部角色之準備期〔任何呼叫與寫檔之前〕、前面角色已停測之模型不再於後續角色受測)只在抓取套件 `bench/benchRoles.mjs` 之 `defineBenchRoles`;本套件之 `parseExtractBenchArgs`／`runExtractBenchCli`／`EXTRACT_BENCH_USAGE`／`extractBenchRoleOf` 只為其薄包裝(只給角色清單、`pickExtractVocab` 與子集檔名之主幹)。②檢定標準 ES9／ES8／ES14／ES11 之逐案題組之頁組法只在 `standards/esCases.mjs`(`esPagesOfCases`);回覆文字一律 `textValueOf`(與正式判定同一取法);命令列之直接執行判定一律 `isDirectRun`(比對實際路徑——經連結執行不再靜默不跑)。
  - 為何:命令列各寫一份即漂移(限制、停測帶過、子集檔);頁組法兩份即評分所送與逐案測試所記之指紋不一致而無人察覺。
  - 站點:`bench/extractBench.mjs`、`bench/cli.mjs`(薄殼)、`standards/esCases.mjs` — 已套。命令列為 `node src/bench/cli.mjs`,內建題組在 `src/bench/cases/<角色 id>-generic.json`;印出之用法字串須為套件根下實際可執行之路徑。
  - 測試:`test/unit-extract-bench.test.mjs`(含〈印出之命令列用法與題組路徑為套件佈局下實際可用之路徑〉)。
- **GEN-18 自有套件之匯入指定詞一律「套件名/src/入口檔」**:取自有套件(wsemi、w-*)之 ESM 入口一律寫 `<套件名>/src/<入口檔>.mjs`,不寫套件根(自有套件發布後 `main` 指 dist 之 UMD、不設 `exports`,寫套件根即解析到 UMD,具名匯入與 `export *` 不可靠);測試工具之子路徑照實際路徑(`<套件名>/test/tools/<檔>`,隨 npm 包發布)。本套件自己的指定詞亦同:`w-knowledge-extract/src/WKnowledgeExtract.mjs`(README 與 JSDoc 之用法範例、`g.mjs`)。`package.json` 不設 `exports`／`files`、不提供 `.npmignore`(npm 包＝git 版控內容,下游以 `…/src/…`、`…/test/tools/…` 深層路徑取用)。
  - 為何:設了 `exports` 即擋掉深層路徑;設了 `files` 白名單,套件根新增檔案時易漏。
  - 盤點:`git grep --untracked -nE "from 'w-knowledge-(capture|summarize|relate)'|from 'wsemi'|from 'node:|from 'lodash-es'" -- src toolg g.mjs` 應為空(三上游走 `src/` 深層路徑;wsemi 取 `wsemi/src/<函數>.mjs`;node 內建模組在 `src/` 無前綴;lodash-es 取單函數路徑——本套件 `src/` 無直接 import)。
  - 測試:`test/unit-extract-package.test.mjs` ①(指定詞形與橋接映射)、②〈發布面〉〈打包清單〉(不設 exports／files、無 `.npmignore`、`npm pack --dry-run` 含 `sgud/` 與 `test/tools/`、不含 `CLAUDE*.md`／`tmp`／`test/_tmp`)、〈範例 g.mjs〉。
  - **測試件之發布面**:`test/tools/*.mjs` 隨 npm 包發布供下游取用,故不得含宿主痕跡(磁碟路徑、使用者目錄、專案名);`unit-extract-package` ② 掃之。
  - **模組私有標記之單例**(`setConceptFold` 等):以模組內之標記或模組級狀態辨認自己產物的件,**同一行程內每個套件須只有一份模組實體**(兩份安裝即互不相認)——如抓取套件 `core/util/text` 之概念折疊 `setConceptFold`(各總組裝設定、分群鍵同讀)、摘要套件 `core/standards/evidenceRules` 之 `COMPILED` 標記、抓取套件 `bench/benchKit` 之 `DEFINED`、`w-data-pipeline` 執行鎖之行程內登記表;版本範圍須與上游有交集。mocha `--parallel` 下同一 worker 依序載入多檔,改動單例之檔同檔須以 `resetConceptFold()` 還原(`unit-extract-package` ⑧ 守)。
- **GEN-19 跨套件共用件之歸屬與只一份**:四套件之間「與工作內容無關之機制」與「多套件同讀之規則」只有一份,**家在依賴鏈最下層之用者**(抓取 ← 摘要 ← 關聯 ← 提煉;抓取所需者在抓取,摘要專屬之機制——判定小組、批次 AI、md、筆記之存量——在摘要);上層只經埠取用,埠只列套件程式碼所需之名。測試之共用件同理:家在最低之使用套件之 `test/tools`,本套件之測試經橋接 `test/tools/{capture,summarize,relate}ForTest.mjs` 取用,**不得在本套件 test/ 自寫副本**。共用件之界線:與題材無關之機制與 helper(替身、斷言、解析、檔案與日誌件)才是共用件;題材夾具(提示詞之固定輸入、評分題組)屬各套件之資料,不收斂。
  - 為何:同一規則手寫多份即漂移(待判之期限／重試判定、存量帳之讀寫與回退、掃描之累計、判定小組之必填與同家警告、提示詞覆寫之驗證、詞彙之頭……)。
  - 盤點:`git grep --untracked -nE "^export (const|function) (cmp|strictTextOf|textValueOf|uniq|jsonClone)\b" -- src` 應為空(此類小件取自抓取埠);本套件 `test/tools/extractKit.mjs` 之具名定義為其「家」,他測試檔不得另定義同名件(此條由 `unit-extract-package` ⑧ 自動盤點,不再以手動 grep 為準)。
  - 測試:`test/unit-extract-package.test.mjs` ①（埠所列之名皆有非測試取用）、⑦（區域同名件:逐字同之跨檔同名＝0,各自語意者列白名單）、⑧〈測試檔不另定義共用件之名〉(`test/*.test.mjs` 不以 `const`／`let`／`var`／`function`／`class` 宣告與 `test/tools/*.mjs` 具名匯出〔含橋接轉出之上游名〕同名之識別字;自家匯入、別名、轉出不算;不辨語意、不列白名單,同名他義者改名;含判準自檢;解構宣告不計)。
- **GEN-20 本套件為泛用開源套件,不專給特定知識庫**:①**領域中立**與**語言地區中立**:預設詞彙、提示詞、題組、原始碼不含特定領域詞;輸出語言、字形標準之適用、折疊與 slug 政策由 `cfg.lang` 決定(抓取套件 `core/locale.mjs` 之 `resolveLocale` 單一實作,總組裝收頂層 `lang`、執行期件解析一次經 `deps.locale` 與 domain 工廠 `opt.locale` 注入;純函數收 `locale`,未給即臺灣正體——**預設行為逐字不變**,由 golden 與契約測試守);字形標準 ES3 之判定表宣告 `appliesTo:['zh-Hant-TW']`,語言設定非繁體中文時掃描逐件列「不適用」(受檢總量不為 0、不報合格),納入閘、存量處置不轉字形。②**零件庫用法**:子階段契約欄位 `enabled:false`／`when(ctx)`、`cfg.aiOptions` 等新選項皆 opt-in、預設行為不變。③**契約常數單一來源**:核心 md 章名 `CORE_SECTION_TITLES`(`domain/extractDomain`)、批內代號由提煉傳入摘要套件之 `numbers.stripPatterns`——下游只取常數,不另寫字面。④**共用件由底層提供**:字形折疊經抓取埠之 `cnToTw`,不直接依賴 opencc-js;上層安裝依賴取用,不另立套件。⑤**無宿主痕跡與發布衛生**:套件內 csv／md／mjs 不得含磁碟機路徑(`HOST_PATH`)或宿主名稱(`HOST_NAME`),由 `unit-extract-package` ② 守;預設庫名 `'knowledge'`、測試閘環境變數 `WK_*`;不設 `files`／`exports`、無 `.npmignore`(見 `rulebook.md` 鐵則 11〈發布面〉);各套件之依賴範圍於交付時對齊已安裝版。⑥**既定行為**:刻意者列 README §19 已知限制(預設產品語言為繁體中文——提示詞本體與章名不在地化,`lang` 只換覆核類提示詞之理由語言句與字形政策;文字相似度之比對前折疊固定折向正體)。
  - 盤點:`git grep --untracked -nE "繁體中文|臺灣正體|toTw\b|scriptProblems" -- src`——提示詞之語言句只在 domain 工廠且經 `resolveLocale(opt.locale).label`,字形判定與修正只經 `scriptOf(...)`(抓取套件為家)。
  - 站點:`extractRuntime.mjs`、`domain/extractDomain.mjs`、`standards/{coreStandards,stockFix,coreStockFix,opGuards,audit}.mjs`、`workflow/{runPass,pending,disputePass,supportStockPass}.mjs`、`guards/similarity.mjs`(`cnToTw` 取自抓取埠)、`stages/extractStage.mjs`。
  - 測試:`test/unit-extract-locale.test.mjs`、`unit-extract-golden`(預設提示詞逐字不變)、`unit-extract-object`(enabled／when)。
- **GEN-21 跨套件收斂之共用件:同一規則之全部副本一次收斂、歸最低使用者**:本套件取自上游之收斂件(經埠):抓取 `core/util/values.mjs`(碼元序比較 `cmp`、文字值 `strictTextOf`／`textValueOf`)、`core/prompts.mjs`(覆寫之 ctx `promptCtxOf`、可覆寫成員 `overridablePrompt`、`promptDomainOf`、`promptsForDomain`)、`core/util/entry.mjs composeNamespaces`(入口之預設匯出物件由之合成,同名不同實體即拋)、`core/vocab/vocabDefault.mjs`(`CAPTURE_VOCAB_KEYS`、`captureVocabDefaultOf`)、`bench/benchKit.mjs`(項編號由核心於分頁後給定:promptOf／check 之 ctx 帶 `base`、check 另帶 `domain`、verdictOf 之 at 帶 `seq`;缺票字樣 `benchVoteMissingOf`)、`bench/benchRoles.mjs`(CLI 之 `run`／`plan`)、`core/util/cli.mjs isDirectRun`;關聯 `core/stores/checks.mjs`（`aiStandardRowOf`）、`standards/audit.mjs createMaterialReader`(材料之文字 `textOf` 由本套件以 `extractMaterialOf` 注入)。
  - 為何:同一規則各寫一份即漂移(缺票字樣、覆寫之 ctx 形狀、入口合成之衝突判定);WeakMap 以案物件為鍵之側通道使測試得先「規劃」才能判定;共用預設以參照共用時下游改預設會汙染抓取。
  - 盤點:`git grep --untracked -nE "const cmp = \(a, b\)|new WeakMap\(\)" -- src` — `cmp` 應為空;`new WeakMap` 只剩 `bench/extractBench.mjs` 之 `PAGES`（頁組法之記憶,非編號）與 `LOCALES`（domain→語言設定之登錄,非編號）。
  - 刻意不動:四總組裝之 `CFG_KEYS` 各自列(各套件以「讀取者＝清單」測試守);提煉 bench 之 `PAGES`。
- **GEN-22 測試件之共用與守門:手寫副本歸家、橋接無死轉出、題組之說明受沿革守門**:①共用件之家在上游之 `test/tools`:抓取套件 `testKit.mjs`(`deepMerge`、`parseCsv`、`withCheck`、日誌替身、暫存根工廠 `tmpRootsOf`、`removeRoots`、`resetConceptFold`、`subReport`、`withStores`、`findFiles`、`readJsonFile`)、`sourceScan.mjs`(`sourceFilesOf(root, { ext, exclude })`、`lexSource`、`specifiersOf`…)、`historyMarks.mjs`(`benchCaseNotesOf`)、`domainTerms.mjs`;摘要套件 `noteKit.mjs`(`landNoteOf`)、`stageKit.mjs`;關聯套件 `relateTestKit.mjs`(`seedNotes`)。②本套件測試一律經橋接取用、暫存根一律 `tmpRoot(名)`＋`removeRoots`(before 才建、不綁 cwd;測試程式禁寫 `./tmp/`)、手寫 AI 替身之 check 包裝 `withCheck`。③橋接所轉出之每一名皆須被本套件 test/ 下至少一檔取用——本套件尚無自動守門案,維護時人工盤點。④四套件之沿革掃描（`unit-extract-package` ④）擴及 `src/bench/cases/*.json` 之**說明文字**(`benchCaseNotesOf`:頂層 note 與各案 why;材料 input 與應然 expect 為題材不掃)。⑤**兩席段之斷網**:席位皆指向死埠、`netGuard` 確認不通 → 該段記截止、待判之 tries 不增、不記檢核、WARN 含「本機網路不通」。
  - 為何:橋接轉出之名無人用即「測試之需求寫成依賴面」(GEN-19 之反面);題組之 why 帶日期與改寫說明即沿革落入套件。
  - 盤點:`git grep --untracked -nE "resolve\(.test/_tmp" -- test` 應只剩 `unit-extract-package` 之判準自檢樣本;`git grep --untracked -nE "callAI = async|callAI: async" -- test` 應為空(手寫 AI 替身一律經 `withCheck` 包住)。
  - 測試:`unit-extract-package` ④、⑧(暫存根、單例不跨檔汙染、測試檔不另定義共用件之名〔GEN-19〕、橋接映射、README §17 ↔ 檔、固定埠與暫存敘述)。
- **GEN-24 取抓取套件只經 npm 套件 `w-knowledge-capture` 之指定詞,不留本地副本**:唯一取用點為埠 `core/capturePackage.mjs`(指定詞 `w-knowledge-capture/src/WKnowledgeCapture.mjs`),測試橋接 `test/tools/captureForTest.mjs` 另可取其 `test/tools/<檔>`;`package.json` 之 `dependencies` 列 `w-knowledge-capture` 之 semver 範圍(最低版取私有倉庫現行最新)。
  - 為何:本地副本與上游分歧即同名異義;只經一個匯入點，上游升版時只需核對埠。
  - 測試:`unit-extract-package` ①（埠之名皆存在於上游主入口且為同一實體）、②〈依賴對帳〉（三上游之實際版本合於所列範圍）。
- **GEN-25 取摘要套件只經 npm 套件 `w-knowledge-summarize` 之指定詞,不留本地副本**:同 GEN-24（埠 `core/summarizePackage.mjs`,橋接 `test/tools/summarizeForTest.mjs`）。
- **GEN-26 取關聯套件只經 npm 套件 `w-knowledge-relate` 之指定詞,不留本地副本**:同 GEN-24（埠 `core/relatePackage.mjs`,橋接 `test/tools/relateForTest.mjs`）;關聯→提煉只有一個方向(EXT-13),本套件不回寫關聯之邊庫,僅經關聯套件之 `queueConflictCheck` 交關聯段核對。
