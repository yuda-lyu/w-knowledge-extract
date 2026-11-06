# 規則帳本：提示詞須以字面寫出程式以字面判讀之要求（EXT-37）

> 本檔為 `rulebook.md` 之分檔（EXT-37 條文在該檔；此處為站點全集、判準與盤點指令）。路徑基準同該檔（`src/` 下之檔省略 `src/`）。使用端需求出處：Gitea #90。

## EXT-37 規則

- **規則**：程式以字面判讀（字串包含、固定清單、固定片語、必填欄位、整條層級之條件）而拒收、不採或交修訂之要求，起草提示詞（`domain/extractDomain.mjs` 之規則段 `defaultRules` 與操作段 `proposeOpsText`）須以**同樣之字面**寫出。模型只照提示詞之字面做：提示詞寫語意、程式比字面，語意正確之回覆仍會被拒收或不採，且越照提示詞之範例做越失分。
- **列表隨詞彙**：字面要求之內容若取自詞彙（`vocab.selfLimitPhrases`、`vocab.guide.extract.weakEvidence`），提示詞由詞彙組出，不寫死（安裝方覆寫詞彙時自動跟著變），且與程式判讀同一來源。
- **不改判定**：補寫提示詞不改納入閘與檢定標準之判定（爭議須能回溯本批、ES13 字面判讀皆維持）。
- **改提示詞之步驟**：改一字即改題目識別（`planExtractBench('wf-draft').promptFp` 與 `extractPromptId` 隨之變）；須先以正式起草席位對 `wf-draft` 題組 A/B（`node src/bench/cli.mjs --role wf-draft --models <正式席位> --runs 2`，逐案兩回全過為準），再 `regen-golden.mjs` 重產中立基準、手改覆寫重現組（登錄於 `test/unit-extract-golden.test.mjs` 檔頭【覆寫重現之手改紀錄】）。

## 站點全集

### 已套（2026-11-06）

| 站點（程式） | 程式以字面判讀之要求 | 起草提示詞之字面 | 測試 |
|---|---|---|---|
| `stores/coreDelta.mjs` `applyDelta` 之 dispute_add（約 :733-753） | 每方須有本批出處（sources）或所引主張；**整條**（頂層 `sources` ∪ 各方 `sources`）須至少一個本批出處，否則拒收「無本批出處」——各方只引主張（含同一差量之新主張 `@名`，其出處即本批）而全無 `sources` 者整條被拒 | `domain/extractDomain.mjs` `proposeOpsText` 之 dispute_add：「每方須有本批出處或所引主張，且至少一方要寫本批出處 sources——各方只引主張（含同一差量之新主張 @名）而整條無 sources 者會被拒收」 | `unit-extract-domain`〈EXT-37：dispute_add 行〉〈EXT-37：與納入閘實際行為一致〉 |
| `standards/coreStandards.mjs` `weakEvidenceProblem`（ES13；新進之納入閘與存量掃描同一判準） | 證據等級最低或未評估之參數，conditions 須含證據判定之自承限制片語（`vocab.selfLimitPhrases`）或弱證據之說法（`guide.extract.weakEvidence`）之一（字串包含） | `proposeOpsText` 之 param_add：「conditions 須含「…」之一（程式以字面判讀，同義改寫不算）」，列表＝`selfLimitPhrases` ∪ `weakEvidence`（去空白、去空、去重；`domain/extractDomain.mjs` 之 `limitPhrases`） | `unit-extract-domain`〈EXT-37：param_add 行〉〈EXT-37：所列之限制語＝ES13 實際接受之字面〉 |

已知限制（兩處）：①dispute_add 之字面要求比納入閘嚴（閘亦接受頂層 `sources`）——取 A/B 驗證過之寫法，依之做必過閘；②param_add 之觸發條件在提示詞寫「證據僅單一來源或未經獨立驗證者」，程式實際之觸發是**程式判定之證據等級為最低級或未評估**（模型不寫證據等級，見規則 evidence）——二者不完全重合，模型對等級較低但非單一來源之參數可能漏寫限制語；如需再補，須另行 A/B。

### 未套（待改提示詞前逐項核對並 A/B；本輪只盤點、不改）

2026-11-06 由子代理唯讀盤點（涵蓋 `stores/coreDelta.mjs` 之 `applyDelta` 全部 `fail`、`standards/opGuards.mjs`、`standards/parse.mjs`、`standards/opStandards.mjs`、`standards/coreStandards.mjs`、起草輸出 JSON 形狀）；主責抽核者標「已核」，餘為「盤點，待核」。未涵蓋：`domain/prompts.mjs`（整合、審計、修訂提示詞）、`workflow/` 之 verdicts／reviewGuards／pending／supportGate 等、整併與本質專步提示詞之細部、外部三套件之判定細節。

| # | 站點（程式） | 程式以字面判讀之要求 | 起草提示詞現況 | 後果 | 核對 |
|---|---|---|---|---|---|
| 1 | `stores/coreDelta.mjs:184,187` | 同一既有 id 至多一個 revise／supersede／retract／contest／dispute_dissolve／split（含 merge 之 from）；confirm 與終態操作（supersede／retract／dissolve／split）不並存——違反者涉及之**全部**操作皆拒收 | 無 | 拒收（涉及之全部操作） | 已核 |
| 2 | `standards/coreStandards.mjs:69`（`LEAK_PHRASES` 九詞）、`standards/opStandards.mjs` 外洩檢查 | 任何文字欄（含 reason）不得含「依審計」「審計意見」「依意見」「原稿」「本批筆記」「候選稿」「整合稿」「修訂稿」「編修」 | 九詞皆未列；起草提示詞自身多處用「本批筆記」（規則 source、【本批筆記之去向】），模型易回聲 | 交修訂，定稿仍有即不採 | 已核（清單與提示詞用語） |
| 3 | `standards/opGuards.mjs:169-174` | 狀態摘要中標「（索引）」之條目（預算不足時只給索引行）不可下 revise／supersede／retract／contest／dispute_update／dispute_dissolve／split／question_resolve／merge（confirm 例外） | 規則段與操作段無說明 | 守門拒收 | 已核（守門）；摘要標記待核 |
| 4 | `domain/extractDomain.mjs:614` ↔ `stores/coreState.mjs:832,836` | 一般批 skipped 之 reason 只收 `SKIP_REASONS`（可附說明）；「非對立」僅重審批可用 | 關聯脈絡標題寫「立爭議，或於 skipped／reason 說明為何非對立」，語意歧義（可能指 conflicts 之去向「非對立」，也可能被讀成 skipped 之理由） | 未涵蓋→重送 | 已核（兩處文字）；模型是否誤讀待實測 |
| 5 | `stores/coreDelta.mjs:698-753` dispute_update | 同 dispute_add：note 必填、頂層 `sources` ∪ `sides_add[].sources` 須至少一個本批出處 | 範例帶頂層 `sources`，無字面要求；`sides_add` 寫成 `[…]` | 拒收 | 已核（程式）；字面差待 A/B |
| 6 | `standards/opStandards.mjs` ES2 | 數字須見於**本操作所引出處**（內容章＋原文標題＋發布時間，加所觸及既有條目、同差量所引新項）；全部文字欄皆受檢（reason 除外） | 規則 source 只寫「不可加入筆記中沒有之數字」；規則 evidence 之推論條款鼓勵由出處推算 | 交修訂，定稿仍不合即不採 | 盤點，待核 |
| 7 | ES16 | 本質中之數字須見於所引主張之存活出處筆記（不含主張文字） | 無 | 交修訂→不採 | 盤點，待核 |
| 8 | ES1／`coreDelta.mjs:33-40` | 逾上限 2 倍之文字欄拒收（本質逾上限即拒）；提示詞只列 text／conditions／pros／cons／critique／essence 之上限，未列 period、basis、position、question、note、resolution、name、value | 部分 | 拒收（>2 倍） | 盤點，待核 |
| 9 | ES12 | 新 principle 之存活出處須至少兩份相異文件（以 docId 計） | 規則 kind 寫「至少兩份不同文件」；起草者看不到 docId，同一研究之多篇筆記可能被當成兩份 | 交修訂→不採 | 盤點（設計限制） |
| 10 | `coreDelta.mjs:22-25,491-534` revise；ES4 | revise 只認固定欄位集，改到標注欄後整條結果須合 ES4（critique／pros／cons／period／conditions 必填） | revise 說明只示範 `"fields":{"text":…}`；改標注欄之要求僅終審提示詞寫 | 拒收／交修訂 | 盤點，待核 |
| 11 | `coreDelta.mjs` 各操作 | reason 必填（revise／supersede／contest／dispute_dissolve／split；essence 改寫既有本質）、`ref` 不可重名、同差量至多一個 essence、essence.claims 至少一條且為現行有效主張、split 之 parts 為 2～8 條、contest 之爭議須未解決 | 多僅見於範例，無「必填」「至多」字面 | 拒收 | 盤點，待核 |
| 12 | `coreDelta.mjs` dispute_dissolve／supersede；`workflow/conflictDisposition.mjs` | dissolve 之方層出處在起草視圖不可見；supersede 之 `by` 在提示詞為選填而 ES5 之「取代」去向需要 `by` | 部分 | 拒收／未處置→下次再呈現 | 盤點，待核 |
| 13 | ES9（AI 判定，非字面） | 新增與修訂之 text、conditions、period 皆須被所引出處支持；模型自加之限制語亦在其內 | 部分 | 不採或隔離 | 盤點（非字面判讀，僅記） |
| 14 | 整合提示詞（`test/golden/extract/delta-integrate.txt:9`）；修訂提示詞可 `adds` 補操作（`delta-revise.txt:6`） | 同 #5 與已套之 dispute_add：整條須至少一個本批出處、param_add 之 conditions 限制語——整合與修訂也會產出 dispute_add／param_add（整合指回候選、修訂補操作），其結果同樣過納入閘 | 整合提示詞只寫「dispute_add 之 sides 是陣列、至少兩方，每方有 position，並有本批出處或所引主張」，無整條層級之要求；修訂提示詞對 adds 只寫「出處只能引本批代號」；二者皆無 param_add 之限制語 | 拒收／不採（整合失敗時程式聯集；修訂補丁守門） | 已核（文字）；本輪依派工〈起草以外之提示詞不改〉未動，是否需補待 A/B 與實測 |

### 刻意不套（無須補字面）

- `applyDelta` 之自動轉換（正體字形、近似重複改記為 confirm）：不拒收，只轉換並計數。
- 解析容錯（`standards/parse.mjs` 丟棄非物件之 ops 項、`op:"skip"` 歸 skipped）：容錯，不拒收。
- ES15（每篇筆記須有去向）、`conflicts` 之 `edge`／`disposition` 清單、`skipped` 之理由清單：提示詞已以同樣字面列出（`SKIP_REASONS`、`CONFLICT_DISPOSITIONS` 由常數產生）。
- 整併模式專用操作（merge、refacet、related_prune）：起草提示詞不列。

## 盤點指令（於套件根）

- 程式端之拒收原因全集：`git grep -n "fail('" -- src/stores/coreDelta.mjs`；`git grep -n "add('ES" -- src/standards/opStandards.mjs`；`git grep -n "LEAK_PHRASES\|NOTE_CODE_RE\|NOTE_LINK_RE" -- src/standards`；守門 `git grep -n "reason:" -- src/standards/opGuards.mjs`。
- 提示詞端：`node --input-type=module -e "import('./src/domain/extractDomain.mjs').then(m=>{console.log(m.createExtractDomain({}).buildProposePrompt({concept:'概念',scope:'concept',digest:'',batch:[],rulesText:''}))})"`（印出起草提示詞全文，逐項對上表）。
- 已套二處之現行提示詞行：同上指令，取 `- dispute_add` 與 `- param_add` 兩行；指紋 `node --input-type=module -e "import('./src/bench/extractBench.mjs').then(m=>console.log(m.planExtractBench('wf-draft').promptFp))"`（2026-11-06：dd8b47fb92930902 → 5118f8f40bf0dc40）。

## 判準與測試

- 判準：已套＝提示詞含程式字面要求之全部要素（含詞彙組出之列表），且 `unit-extract-domain` 之交叉案（提示詞所列＝程式實際接受）綠；未套＝上表「起草提示詞現況」非「已寫出」者，列於此待 A/B；刻意不套＝見上節。新增或修改程式端之字面判讀（新 `fail`、新檢定標準、新片語清單）時，同輪須回頭看本表：補寫提示詞（先 A/B）或登記於「未套」。
- 測試：`unit-extract-domain`〈EXT-37〉四案（dispute_add 行、dispute_add 與納入閘一致、param_add 行隨詞彙、param_add 所列＝ES13 接受之字面）；`unit-extract-golden`（中立基準與覆寫重現）。
