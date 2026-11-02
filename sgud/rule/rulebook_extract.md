# 規則帳本 — 提煉 EXT-*（w-knowledge-extract）

> **路徑基準**：原始碼在 `src/`，本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`；上游三套件（抓取 `w-knowledge-capture`、摘要 `w-knowledge-summarize`、關聯 `w-knowledge-relate`）之檔寫作「<套件名> 之 <路徑>」，位於 `node_modules/<套件名>/`。
> 本檔為本套件提煉工作之規則（EXT-01～22：3+3 工作流與降級梯、狀態為真理、待審、重審、撤出處／恢復、關聯變更之影響、本質缺席）；套件審計落地之規則 EXT-23～34 在 `rulebook.md`。現況以 `../state/state.md` 為準。

## 6. extract(提煉)


- **EXT-01 狀態為真理、md 為投影**:狀態檔 `<id>.state.json`;寫入順序 dirty 標記 → 狀態(CAS、原子寫、.prev)→ 再驗磁碟 rev → md(手改偵測,另存)→ cores 記錄 → 筆記 extractedAt → 分身 → 清 dirty;前次中斷由 dirty 補做投影。
  - 測試:`unit-core-store`、`unit-extract-stage`。
- **EXT-02 不變式**:`coreState.checkInvariants`(既有項不遺失、出處只增、沿革只增、終態不可逆、引用可解析、本質所引非終態、consumed 只增且涵蓋所有出處、版號與 changelog 一致、id 計數單調)於套用與落帳後自檢;違反者逐條剔除再套,不整批丟。
  - 盤點:`git grep --untracked -n "checkInvariants(" -- src` → `stores/coreState`(定義)、`workflow/{applyWithInvariants,pending}`、`stores/coreProjection`(`programWriteProblems`)、`standards/{coreStandards,esCases}`、`bench/extractBench`(評分角色 wf-consolidate 之判定)。
  - 測試:`unit-core-state`、`unit-extract-workflow`。
- **EXT-03 差量操作語意①～⑭**:以 `src/stores/coreState.mjs` 檔頭為準(檔頭現列①～⑳,⑮～⑳ 為撤出處、重審、關聯變更之影響、程式差量與可還原撤回、隔離、出處排除集,分見 EXT-15／EXT-17、STD-12／18／23;同項至多一改狀態、confirm 與終態互斥、ref 連鎖拒收、同篇不成爭議、contested 衍生、文字引用、全文相同轉 confirm、爭議可拆、終審剔除只用於內容不成立、revise 只驗改欄、merge 包含率 ≥0.5、split 子集 ≥0.8 涵蓋 ≥0.85、本質引用改指 `redirectEssence`)。機制歸 `stores/coreState`(模型、衍生、不變式)與 `stores/coreDelta`,domain 只給 claimKinds／limits／evidence／提示詞／渲染。
  - 測試:`unit-core-state`（含 X1）、`unit-extract-render`。
- **EXT-04 3+3 編排與降級梯**:三家獨立起草(runFanout)→ 整合 → 審計 → 修訂(無意見略過)→ 終審 → 程式套用;起草全敗 → pass 失敗;只 1 份 → 跳過整合;整合敗 → 程式聯集;審計／修訂敗 → 最後一份合格差量續跑;終審敗 → 建設性照套、破壞性存待審;截止 → stopped(AI-05;上游抓取套件規則帳本 `sgud/rule/rulebook_core.md`);全部走 w-dispatch-ai 既有工作流,不自寫調度。
  - 測試:`unit-extract-workflow`、`unit-extract-stage`。
- **EXT-05 守門(依操作類別)**:`standards/opGuards`(可見性、數字紮根、實質重複雙向 ≥0.7 轉確認、正體、流程外洩)與 `workflow/reviewGuards`(補丁只套 FIXABLE_FIELDS、移除建設性操作只准重複或高嚴重度離題／捏造、破壞性操作之移除一律放行、新增須對應意見且過守門、假爭議不是移除理由)。
  - 測試:`unit-core-state`、`unit-extract-workflow`。
- **EXT-06 選題**:`stores/conceptSelection` 之 `pickConcepts`:分群鍵 normalizeConcept;pending＝主標籤 − 已用;新核心門檻 `extract.minNotes`(主標籤);既有核心須滿一批或(≥ `extract.minPending` 且等待 ≥ `extract.maxWaitDays`);score＝min(pending, 追趕批數×每批)×等待天數;失敗回隊尾;未關聯者延後(寬限);`(scope, 鍵)` 身分、分身只選主核心(`coreForKey`);閒置輪補久候尾數、類別後備預設停用。
  - 測試:`unit-selection`、`unit-extract-stage`。
- **EXT-07 選篇**:`noteSelection.selectNotes` ①～⑧(主標籤優先、依發布年分層輪流、同層內衝突邊／證據高／有樣本期先、來源上限、衝突成對入批、每批保留 ⌈篇數／4⌉ 給最新、重送排最後);批內代號 N1…Nk 對回 id。
  - 測試:`unit-selection`。
- **EXT-08 證據等級程式判定**:`evidence.mjs` ①～⑦(出處有效等級＝min(筆記等級, 內容類型封頂);最高級須 2 份相異文件;contested 封頂次高;basis／自承限制封頂;等級名與封頂表屬詞彙);模型只寫 basis。
  - 測試:`unit-core-state`（證據）、`unit-vocab`（封頂警告:自訂內容類型而未給證據封頂 → 一條警告）、`unit-extract-assembly`（警告併入啟動期警告）、`unit-extract-domain`。
- **EXT-09 失敗帳**:`state/extract-attempts.json`,鍵 `scope|key`:tries／lastError／lastTriedAt／noteTries／consolidate;鏈內例外亦落帳;截止不計;成功之 pass 仍留空條目(判「無失敗」看 tries／lastError);regenCore 清該核心之帳(經意圖檔 `extract-regen.json`,由管線開工消化後清;EXT-26)。
  - 測試:`unit-extract-stage`、`unit-extract-files`（帳檔名單一來源、壞檔隔離）、`unit-extract-ops`（regenCore 不直接改帳）。
- **EXT-10 待審**:終審未明列裁決之不可逆操作存 `pendingReview`(上限 20);下次處理該核心先交終審席;確定性違反出隊、陳舊項清除、終審失敗保留、截止回 stopped;待審專步只排主核心。
  - 測試:`unit-extract-stage`。
- **EXT-11 整併**:有效主張 > `extract.claimsCap` 且距上次 ≥ interval(初 every,無效則加倍)才走整併;不消耗筆記、不重置等待;截止不算一次嘗試。
  - 測試:`unit-extract-stage`、`unit-extract-workflow`。
- **EXT-12 停用**:`extract.perRun: 0` 合法＝本輪停用(INFO、不選題、不呼叫 AI、不產容量警告、report.disabled)。
  - 測試:`unit-extract-stage`、`unit-settings`（perRun 0 → 容量 0）。
- **EXT-13 關聯→提煉只有一個方向**:提煉只讀關聯邊(起草之【關聯脈絡】,`relationContextRows` 單一實作、回傳實際呈現之邊)與筆記 frontmatter conflicts(`noteDigest`);不回寫關聯。脈絡之型別由 `extract.relationTypes` 定:`'conflict'`(預設)只列衝突型;`'linked'` 另列兩端皆在本批或為核心已引之他型;`'all'` 觸及本批之全部(衝突在前、新到舊、上限 40)。重審、seenConflicts、維護首見只看衝突型(`env.relEdges`;脈絡另用 `env.ctxEdges`)。已消化筆記後來之新衝突邊由 EXT-17 重審
  - 盤點:`git grep --untracked -n "relationContextRows(" -- src` → 呼叫端 `stages/extractChain.mjs`(mwPass)、定義 `workflow/relationContext.mjs`(檔內只有 `relationContextRows` 一函式)——皆經同一函式,`linked` 由設定或參數帶入。非衝突型關聯之增刪改由 STD-18(ES10)處置。
  - 盤點:`grep -rnE "stores\.relations|front\.conflicts" --include=*.mjs --exclude-dir=test src` → 只讀(select／get):extractStage、ops/recheckOps、standards/{audit,stockFix}(ES5 之材料)、domain/extractDomain(front.conflicts);無寫入。
  - 測試:`unit-extract-workflow`、`unit-extract-lineage`、`unit-extract-golden`（預設逐字不變）。
- **EXT-14 出處版本紀錄(要點 2;`coreState` 之 seen／seenConflicts／lineage、`stores/contentCache.createContentCache`)**:狀態記已消化筆記於消化當下之內容鍵 `seen[id]＝{ k, v }`(k＝`domain.noteDigest(...).contentKey` 之 sha1;v＝`CONTENT_KEY_VERSION`)與「實際呈現過之衝突邊 id」`seenConflicts`;記錄時點＝本批已涵蓋(引用、存待審、略過、剔除)或逾限者,未涵蓋者不記、讀不到 md 者不記。內容鍵＝起草者讀得到之內容(9 章去衝突章,各章截斷後;＋樣本期、品質疑慮、發布),CRLF 與空白正規化;不含標題、內容類型、證據等級(走 EXT-18)、衝突章與 frontmatter conflicts(關聯投影)。v 不符 → 重設基準(首見)。本版之前建立之核心(無 `lineage`)於維護時以現值補基準(不升版、不算變更)。內容鍵快取 `dirs.state/extract-content.json`(mtime＋大小;派生檔,缺／壞／版本不符重建)。不變式:seen、withdrawn 之鍵 ⊆ consumed。
  - 測試:`unit-extract-lineage`（內容鍵、快取、首見、首批記錄）、`unit-extract-golden`（一般批提示詞逐字不變）。
- **EXT-15 撤出處(衍生、可逆;墓碑驅動)**:每輪維護:已消化、記錄不在、有刪除墓碑(上游關聯套件之 `stores/deletions`〔`DELETION_FILES`、`openDeletions`;本套件經 `core/relatePackage` 取用〕,關聯段寫入)→ `withdrawSources`;已撤、記錄在、無墓碑 → 恢復;記錄不在而無墓碑 → WARN「提煉出處懸空」(MUST_SEE)、不撤。出處欄不動(出處只增維持),存活出處、失撐(`unsupportedOf`:主張／問題＝存活出處空;參數＝自身存活出處空且所依主張失撐或無;爭議方＝方層存活出處空且所引主張皆失撐)與本質待重寫(`essenceLostOf`)一律衍生;只有非終態條目受影響才升版(changelog mode withdraw／restore)。證據等級以存活出處計;渲染:失撐主張移至「出處已撤之條目（待重審）」節、各處只列存活出處、爭議方與參數就地標示;cores 記錄 noteCount 以存活出處計。洗白守門:失撐條目不得為 merge 之 from／into、不得被新本質／新爭議方／contest 引用(同差量內 confirm 補出處者除外)。條件規則 `domain.withdrawnRule`(有失撐條目才加入,優先序最後)。待審項所依出處全撤 → 陳舊清除。
  - 測試:`unit-extract-lineage`（撤出處、還原、只撤略過者不升版、洗白、渲染、待審、懸空）。
- **EXT-16 本質待重寫須呈現給讀者**:持久之 `essence.stale`(取代／撤回所致)與衍生之「所引主張出處已撤」皆在核心 md 本質下以「> 本質待重寫：…」呈現、cores 記錄 essence 冠「〔待重寫〕」(索引隨之);拆解爭議(dispute_dissolve)時自帶性質之方另立主張並沿用其 basis(不併入所引主張)。
  - 測試:`unit-extract-lineage`（渲染、拆解保留轉述）。
- **EXT-17 重審(要點 2;`standards/recheck.recheckItemsOf`、`stages/extractChain` 之 mwSelectNotes／mwPass、`stages/extractSteps` 之 serve)**:重審項每批開工前以當下狀態重算、不存帳——changed＝被有效條目引用之存活出處其現內容鍵 ≠ seen;conflict＝衝突型邊觸及被引用之存活出處而 id 不在 seenConflicts(兩端皆引用者呈現較新建立之一端;夥伴不在或讀不到者略;同邊去重)。入批:一般批先放至多 `extract.recheck.slots`(預設 3)篇重審筆記(changed 先、conflict 依邊時刻舊到新),其餘照現行選篇;僅重審 pass:本輪未做一般批之概念層主核心、有 changed 或 conflict ≥ ⌈每批/2⌉ 或最舊衝突已等 `extract.recheck.waitDays`(預設 7)天,每輪至多 `extract.recheck.perRun`(預設 1)個,與待審同一 serve 序列(先待審後重審),不寫 proposedAt、失敗記 recheckTries／recheckLastTriedAt／recheckLastError(退避 1、2、4 天),不動 tries／lastTriedAt。提示詞:有重審筆記時起草、審計、修訂、終審附【重審】段(`domain.buildRecheckText`),所涉條目強制全文(`stateView` mustShow)並附註;重審專用略過理由 `RECHECK_SKIP_REASONS`(重審無須變更、非對立)只對重審筆記有效(一般批之 SKIP_REASONS 與提示詞逐字不變);重審批內尚有他篇存活出處之主張不得以「無出處支持」撤回。落盤:已涵蓋或逾限之重審筆記 seen 更新、已處置之衝突邊入 seenConflicts;重審篇另計 notesRechecked(不入消化)。大量內容變更守門:單輪 changed 篇數 > `extract.recheck.guard`(預設 20)→ 不排 changed、WARN「提煉內容變更守門」(MUST_SEE)
  - **重設基準**(`stores/rebaseline`):逐 id 名單 `extract-rebaseline.json`，`requestRebaseline(dirs, at, ids, { by })` 指示下一輪以現值重設內容基準（大量格式變動而非內容修訂時；內容變更守門所指），維護段執行後只刪已處置之 id；`cancelRebaseline` 取消；`rebaselineIdsOf` 讀名單（壞檔回 [] 並經 `onError` 回報）；套用後 applied 全為 noop 之差量不升版。
  - 測試:`unit-extract-lineage`（重審項、入批、僅重審 pass、守門、重設基準）。
- **EXT-18 維護與投影更新(無 AI;`stages/extractMaintain.maintainCores`／`stores/coreProjection.persistMechanical`)**:順序 停用判斷 → dirty 補做 → 維護 → 時間守門 → 選題(時間不足之輪仍做維護;停用輪全不做);逐主核心一次載入、至多一次寫入、逐核心 try/catch(WARN「提煉維護失敗[概念]」MUST_SEE)。投影更新:以現值(標題、分類、存活出處)重算證據並渲染,渲染雜湊不同、證據欄位(含 trace)變動或 md 不在 → 寫入(rev+1、version 不變;新渲染雜湊寫回狀態後才寫 md,手改偵測以舊雜湊＋本次者比對)——一併消除「生產起草者看到舊證據等級」。
  - 測試:`unit-extract-lineage`（時間不足仍維護、投影更新後一般落盤不誤報手改、兩輪無變化 rev 不變）。
- **EXT-19 可觀察性**:選題當下 INFO「提煉選題：概念×待提煉（新）…；積壓 N 篇；重審待處理：內容變更 a 篇、新衝突 b 條；撤出處…」;執行摘要(`extractObject.mjs`)附「、重審 N 篇」「、撤出處 N 篇」「、恢復 N 篇」(>0 才附);run.json 之提煉 detail 增 baselined／withdrawn／restored／dangling／projected／maintainFailed／recheckChanged／recheckConflict／notesRechecked／recheckPasses／recheckExhausted／recheckBlocked／rebaselined／mdMissing
  - 測試:`unit-extract-object`（執行摘要「、重審 N 篇」「、撤出處 N 篇」「、恢復 N 篇」）、`unit-flow-extract`（F3／F4 端對端摘要）、`unit-extract-log-contract`、`unit-extract-lineage`。
- **EXT-20 略過理由可附說明**:`stores/coreDelta` 之 `coverageOf` 之略過理由以 `skipReasonOf` 正規化——合法理由本身,或「合法理由＋分隔符(空白、冒號、逗號、分號、括號、破折號、頓號)＋說明」取開頭之理由;無分隔符、非合法開頭、一般批之裸「非對立」仍為 badSkipped(保留原文)。提示詞不改(golden 不變)。
  - 為何:實測起草時模型常在合法理由後附說明(例如依【關聯脈絡】說明非對立),逐字比對會把它們當未涵蓋。
  - 測試:`unit-extract-lineage`。
- **EXT-21 衝突已不成立 → 重審(要點 2「關聯變更時更新影響範圍內之高階知識」)**:**帳驅動,不以讀不到推定**——只依事件帳 `state/relate-conflict-events.jsonl`(上游關聯套件之 `stores/conflictEvents`〔`CONFLICT_EVENT_FILE`、`readConflictEvents`;本套件經 `core/relatePackage` 取用〕,由上游關聯套件規則帳本 REL-13 之重評套用撤銷／降級時寫)判定;conflictType 改名、刪除筆記、prune-dangling 等讓衝突邊「讀不到」者一律不算撤銷。
  - 判定(`standards/recheck.conflictGoneOf`,純函數):事件之邊在 seenConflicts、當下非衝突(不在 `conflictIds`)、且有**未決爭議以其端點為出處** → 重審項(reason `conflictGone`,anchorItems＝引用 anchor 與 id 之條目,帶 kind／newType／why);無爭議涉及 → orphans,維護時只自 seenConflicts 移出(無 AI,計 conflictGonePruned)。
  - 排程:`recheckItemsOf` 帶事件時附 conflictGone 項;`pickRecheck` 順序 changed → conflictGone → conflict(依時刻);`recheckDue`:有 changed 或 conflictGone 即到期(不等 `extract.recheck.waitDays`)(三者皆在 `standards/recheck`;現序為 changed → conflictGone → relationChanged／conflictReason〔ES10〕→ resend〔ES15〕→ conflict〔依時刻〕→ partner,`recheckDue` 之立即到期理由另含 relationChanged、conflictReason、resend)。
  - 提示詞(`domain.buildRecheckText`):「- N（衝突已撤銷）：與核心已引之〈…〉之衝突關係已由關聯段重評撤銷|改為「…」（理由：…）；涉及之條目…」;有此項才附指示句——拆解(dispute_dissolve)者於 skipped 寫「非對立」、仍對立者維持並寫「重審無須變更」(兩者皆為 RECHECK_SKIP_REASONS,只對重審筆記有效)。
  - 落盤:已涵蓋之 conflictGone 項自 seenConflicts 移出(日後再成為衝突即為新衝突,走 EXT-17);報告 detail `recheckConflictGone`、`conflictGonePruned`
  - 盤點:`git grep --untracked -nE "conflictGone|readConflictEvents\(" -- src` → `standards/recheck`(定義與主要判定)、`stages/{extractChain,extractMaintain,extractStage}`(載入事件帳、維護、選題、落盤;`extractStage` 只載入事件帳)、`standards/relationImpact`、`workflow/runPass`、`ops/recheckOps`(預覽)、`domain/extractDomain`(提示詞)、`logContract`;事件帳之定義與寫入在關聯套件 `stores/conflictEvents`、`stores/{edgeRetire,edgeRewrite}`。
  - 測試:`unit-extract-lineage`。
- **EXT-22 核心不得長期無本質**:①`applyDelta` 之 essence:缺 text 拒(「缺 text」);**reason 只在改寫既有本質時入沿革,故只對改寫要求**(「缺 reason（改寫本質須說明理由）」),首次歸納缺 reason 照收。②`stateDigest`:已有非終態主張而無本質 → 輸出「【本質】（尚未歸納——本核心已有主張而無本質，本批須以 essence 綜合現有主張）」,下次處理該核心(一般批、僅重審 pass、整併)時起草端據以補上;有本質或空狀態者不變(golden 逐字不變)。③`runPass` 定稿前之本質截短適用於「尚無本質」之核心(新核心與首版曾被拒者)。④長期未再被選中之核心不必等新筆記:每輪之本質專步(ES6 v2,`essenceNeedOf`)會補上。
  - 為何:曾見核心無本質(臨時批次;本質操作缺 text 或 reason、或所引 `@ref` 之主張被剔除而連鎖拒收),且狀態摘要於無本質時只是少一行,無任何指示會補上。`@ref` 連鎖拒收之語意不改(所引主張被剔除時本質文字可能含被剔除之內容),由②自癒。
  - 測試:`unit-core-state`「essence 須引主張…」(首次缺 reason 收、改寫缺 reason 拒、缺 text 拒)、「stateDigest…」(無本質之明示行、有本質者不出現)、`unit-extract-golden`(逐字不變)。