# 規則帳本：拒收型別碼、核心版本之產出鏈、核心回退與依產出鏈取版本（EXT-38～40）

> 本檔為 `rulebook.md` 之分檔（EXT-38～40 條文在此；索引與鐵則在該檔）。路徑基準同該檔（`src/` 下之檔省略 `src/`）。使用端需求出處：Gitea #109（拒收型別碼、核心 changelog 之產出鏈、核心回退）；產出鏈之資料結構取跨套件之產出鏈規格（摘要、關聯、提煉三套件同一份；共用件 `makeProduced`／`pkgIdOf`／`createPromptFpCache` 在抓取套件，本套件只呼叫）。

## EXT-38 拒收／擋下／剔除／存疑之型別碼（單一來源）

- **規則**：提煉之拒收類判定，每個判定分支各有一個穩定之型別碼（kebab-case 小寫，**只在組內唯一**）；①日誌行於理由前（或概念名後）插入同一碼、②run.json 提煉子段 `detail` 之 `<By 鍵>` 記 `{ 碼: 計數 }`、③全集匯出為常數 `REJECT_KINDS`（`core/rejectKinds.mjs`）——三處同一來源，日誌行與 detail 之碼皆經 `rejectKindOf(組, kind)` 歸一（未登記者歸 `unclassified` 安全網，使計數和仍等於總數、漏標看得見）。**各 By 鍵之計數和＝同組之既有總數**。理由字串之字樣不變（碼是附加之結構欄 `kind`）。
- **六組**（日誌行前綴與 detail 鍵；總數鍵即既有 report 鍵）：

| 組 | 判定所在 | detail 之 By 鍵 | 和＝總數 | 日誌行（插入位置） |
|---|---|---|---|---|
| `opsRejected` | `stores/coreDelta.applyDelta`（套用時之拒收） | `opsRejectedBy` | `opsRejected` | `提煉拒收[概念]：〔碼〕理由×n、〔碼〕理由×n`（每項理由前；聚合行） |
| `integrateRejected` | `workflow/candidates.validateVia`（整合輸出之驗證拒收；**本輪新增之總數 `integrateRejected`**——原只在 `trace`） | `integrateRejectedBy` | `integrateRejected` | `提煉整合拒收[概念]〔碼〕：理由`（概念名後、冒號前；單項行） |
| `guard` | `standards/opGuards.guardOps`（整合後之操作守門） | `guardBy` | `guardRejected` | `提煉守門[概念]〔碼〕：操作 理由` |
| `reviseBlocked` | `workflow/reviewGuards.applyPatch`（修訂補丁被擋） | `reviseBlockedBy` | `patchBlocked` | `提煉修訂擋下[概念]〔碼〕：動作 ref 理由` |
| `acceptDropped` | `workflow/verdicts.applyVerdicts` 之 dropped（終審剔除；碼依理由之封閉列舉） | `acceptDroppedBy` | `opsDropped` | `提煉終審剔除[概念]：〔碼〕理由×n；爭議類 …`（每項理由前） |
| `doubted` | `workflow/verdicts.applyVerdicts` 之 doubted（終審存疑；碼依理由之封閉列舉） | `doubtedBy` | `opsDoubted` | `提煉終審存疑[概念]：i=… op「…」（〔碼〕理由：說明）；…`（括號內理由前） |

- **既有日誌行之其餘字樣不變**；插入只在上表位置。下游以既有字樣解析者：單項行之「`[概念]：`」變為「`[概念]〔碼〕：`」，聚合行與存疑行之各項理由前多一個〔碼〕。標記之正則取匯出常數 `REJECT_TAG_RE`（小寫 kebab-case，與條目編號〔C1〕〔D2〕不相混）。
- **計數之路徑**：`msg.stats` 為純數字累加，巢狀 map 以扁平鍵 `<By 鍵>:<碼>` 計入（`rejectStatKey`／`rejectStatSplit` 互逆），`stages/extractSteps` 之 `agg` 轉成 `detail.<By 鍵>[碼]`；`extractStatInit` 之初值：By 鍵為 `{}`、總數鍵為 `0`（契約之鍵恆在）。一個 pass 之計數取 `passKindStats(r)`（`r.rejected` 與 `r.stats` 之 guardBy／reviseBlockedBy／integrateRejectedBy）；終審剔除與存疑於 `stages/extractChain.logVerdicts` 計。
- **刻意不套（未納入計數與型別碼）**：下列拒收類日誌行不在五組（使用端 §1 所列之五鍵）之內，沿用原字樣、無碼：`提煉守門（終審後）`（定稿前再過守門之拒收；既有 `guardRejected` 亦不含）、`提煉終審擋下`（`verdictBlocked`；其理由之碼同 `reviseBlocked` 之 removalAllowed 兩碼，可日後另立 `verdictBlockedBy`）、`提煉終審裁決無效`、`提煉未達檢定標準`（`stdRejected`）、`提煉超限`／`提煉檢定標準`（交修訂之程式意見）、`提煉不變式剔除`（`invariantDropped`）。**要補須先裁示**（各自須有既有總數可對）。
- **新增判定分支之步驟**：①先在 `core/rejectKinds.REJECT_KINDS` 該組登記碼與說明；②分支以碼標記（`applyDelta` 之 `fail(理由, 碼)`、其餘之 `kind:` 欄）；③補 `unit-extract-reject-kinds` 之觸發案（K3）；K4 之原始碼掃描守「使用之碼皆已登記、登記之碼皆有分支」。
- **站點全集（碼 → 分支 file:line）**（2026-11-08；盤點指令：`git grep -nE "\bfail\(|\bkind: " -- src/stores/coreDelta.mjs src/workflow/candidates.mjs src/standards/opGuards.mjs src/workflow/reviewGuards.mjs`，每個 `fail(` 行之末參數皆為碼或帶 `.kind`；`unit-extract-reject-kinds` K4 自動核）：

#### opsRejected(opsRejectedBy；和＝opsRejected；日誌行 提煉拒收)

| 型別碼 | 說明 | 分支 file:line |
|---|---|---|
| `op-not-in-pass` | 本 pass 只收特定操作,收到其他操作 | src/stores/coreDelta.mjs:370 |
| `op-not-in-mode` | 增量或整併模式不可用該操作 | src/stores/coreDelta.mjs:370 |
| `op-unknown` | 未知操作 | src/stores/coreDelta.mjs:370、1245 |
| `ref-duplicate` | 同差量之 ref 重複宣告 | src/stores/coreDelta.mjs:375 |
| `state-op-multiple` | 同一既有項目有多個改狀態操作 | src/stores/coreDelta.mjs:186 |
| `state-op-confirm-vs-terminal` | 同一既有項目同時被確認與取代／撤回 | src/stores/coreDelta.mjs:189 |
| `launder-source-withdrawn` | 引用出處已撤(筆記已刪除)之條目(洗白守門) | src/stores/coreDelta.mjs:211 |
| `launder-source-held` | 引用出處支持未能判定、已隔離待判之條目(洗白守門) | src/stores/coreDelta.mjs:211 |
| `recheck-retract-has-other-sources` | 重審批內以「無出處支持」撤回仍有他篇出處之條目 | src/stores/coreDelta.mjs:219 |
| `ref-undefined` | 引用之 @ref 未於本差量定義 | src/stores/coreDelta.mjs:236、268 |
| `dependency-rejected` | 所依之同差量新項已被終審剔除或拒收 | src/stores/coreDelta.mjs:237、268、584、623、661、883、1031、1046 |
| `item-not-found` | 引用或目標之既有項目不存在 | src/stores/coreDelta.mjs:240、268 |
| `target-kind-mismatch` | 引用或目標之項目種類不符 | src/stores/coreDelta.mjs:258、272 |
| `target-terminal` | 目標已為終態(撤回、取代) | src/stores/coreDelta.mjs:259、471、506、564、607、652、702、800、1143 |
| `target-not-open` | 目標之爭議或問題已非未解決 | src/stores/coreDelta.mjs:666、930 |
| `kind-not-allowed` | 主張種類不在許可清單 | src/stores/coreDelta.mjs:404、529、840、1173 |
| `missing-field` | 缺必要欄位 | src/stores/coreDelta.mjs:408、510、568、572、656、707、716、805、871、906、934、960、966、1008、1036、1147 |
| `no-batch-source` | 操作無本批出處 | src/stores/coreDelta.mjs:413、476、517、577、677、759、876、939 |
| `text-too-long` | 文字欄逾長度硬上限(2 倍)或合併稿逾上限 | src/stores/coreDelta.mjs:295、1081 |
| `essence-too-long` | 本質逾硬上限 | src/stores/coreDelta.mjs:972 |
| `dangling-text-ref` | 文字中之引用懸空(〔id〕不存在或〔@ref〕未定義) | src/stores/coreDelta.mjs:297、995、1086 |
| `revise-no-editable-field` | revise 無可改之欄位 | src/stores/coreDelta.mjs:525 |
| `required-field-emptied` | 必要欄位不可改為空 | src/stores/coreDelta.mjs:536 |
| `side-invalid` | 爭議之 side 不存在或未給 | src/stores/coreDelta.mjs:486、672 |
| `retract-reason-invalid` | 撤回理由不在許可清單 | src/stores/coreDelta.mjs:612 |
| `retract-duplicate-needs-into` | 理由「重複」未帶有效之 into(存活之同種類項) | src/stores/coreDelta.mjs:623 |
| `supersede-by-self` | 取代者不可為自身 | src/stores/coreDelta.mjs:584 |
| `contest-needs-dispute` | contest 未連既有或同差量新建之爭議 | src/stores/coreDelta.mjs:661 |
| `dispute-sides-too-few` | 新立爭議少於兩方 | src/stores/coreDelta.mjs:721 |
| `dispute-side-no-position` | 爭議有一方缺立場 | src/stores/coreDelta.mjs:728 |
| `dispute-side-no-source` | 爭議有一方無本批出處亦無所引主張 | src/stores/coreDelta.mjs:743 |
| `dispute-status-invalid` | 爭議之 status 非 open 或 resolved | src/stores/coreDelta.mjs:711 |
| `same-doc-pair` | 同篇正反不成爭議(含併後之同篇成對) | src/stores/coreDelta.mjs:770、1054 |
| `essence-duplicate` | 同一差量有多個 essence | src/stores/coreDelta.mjs:955 |
| `essence-claims-required` | essence 未引任何主張 | src/stores/coreDelta.mjs:990 |
| `merge-invalid-from` | merge 之 from 為空或含 into | src/stores/coreDelta.mjs:1041 |
| `merge-text-overwrite` | 合併稿未保有被併項過半內容 | src/stores/coreDelta.mjs:1076 |
| `merge-dispute-clash` | 合併會使爭議之不同方指向同一主張 | src/stores/coreDelta.mjs:1095 |
| `split-parts-invalid` | split 之 parts 不在 2～8 條 | src/stores/coreDelta.mjs:1152 |
| `split-part-not-subset` | split 之某條不是原文之子集 | src/stores/coreDelta.mjs:1162 |
| `split-coverage-low` | split 各條合起來未涵蓋原文 | src/stores/coreDelta.mjs:1167 |
| `refacet-invalid` | refacet 缺 from 或 to,或兩者相同 | src/stores/coreDelta.mjs:1228 |
| `refacet-no-match` | refacet 無對應面向之主張 | src/stores/coreDelta.mjs:1233 |
| `dissolve-side-unconvertible` | 爭議拆解時某方無法轉為主張 | src/stores/coreDelta.mjs:836 |
| `unclassified` | 未歸類(安全網:出現即表示有分支漏標) | (安全網;無分支) |

#### integrateRejected(integrateRejectedBy；和＝integrateRejected；日誌行 提煉整合拒收)

| 型別碼 | 說明 | 分支 file:line |
|---|---|---|
| `via-missing` | via 未指回任何候選操作(整合不可新增候選沒有之操作) | src/workflow/candidates.mjs:233 |
| `op-type-changed` | 操作種類與所引候選不同(整合不可改變操作種類) | src/workflow/candidates.mjs:235 |
| `target-mismatch` | 操作之目標與所引候選不同(整合不可改變目標) | src/workflow/candidates.mjs:241 |
| `source-not-in-candidates` | 出處不在所引候選之出處內 | src/workflow/candidates.mjs:244 |
| `text-diverged` | 文字與所引候選差異過大(整合不可改寫成候選沒有之內容) | src/workflow/candidates.mjs:248 |
| `unclassified` | 未歸類(安全網) | (安全網;無分支) |

#### guard(guardBy；和＝guardRejected；日誌行 提煉守門)

| 型別碼 | 說明 | 分支 file:line |
|---|---|---|
| `target-not-in-prompt` | 目標只見索引行、未於提示詞附全文(只見索引行之條目不可改狀態) | src/standards/opGuards.mjs:174 |
| `unclassified` | 未歸類(安全網) | (安全網;無分支) |

#### reviseBlocked(reviseBlockedBy；和＝patchBlocked；日誌行 提煉修訂擋下)

| 型別碼 | 說明 | 分支 file:line |
|---|---|---|
| `op-not-found` | 補丁指向之操作找不到 | src/workflow/reviewGuards.mjs:181、203 |
| `removal-dispute-not-offtopic` | 爭議類操作之移除理由不是「離題」(假爭議不是移除理由) | src/workflow/reviewGuards.mjs:150 |
| `severity-too-low` | 建設性操作以中低嚴重度之意見移除(只准重複或高嚴重度之離題／捏造) | src/workflow/reviewGuards.mjs:144、154 |
| `no-editable-field` | 改寫不含該操作之可改欄位 | src/workflow/reviewGuards.mjs:218 |
| `text-overwrite` | 改寫文字未保有原文過半 | src/workflow/reviewGuards.mjs:235 |
| `guard-rejected` | 改寫或新增之操作過不了操作守門 | src/workflow/reviewGuards.mjs:237、261 |
| `over-limit` | 補丁使本條超限(套用時必被拒收) | src/workflow/reviewGuards.mjs:240、263 |
| `new-standard-issue` | 補丁使本條新增檢定標準問題 | src/workflow/reviewGuards.mjs:247 |
| `add-op-missing` | 補丁新增缺 op | src/workflow/reviewGuards.mjs:258 |
| `add-needs-issue` | 補丁新增未對應任何審計意見 | src/workflow/reviewGuards.mjs:259 |
| `add-standard-issue` | 補丁新增之操作未達檢定標準 | src/workflow/reviewGuards.mjs:267 |
| `unclassified` | 未歸類(安全網) | (安全網;無分支) |

#### acceptDropped(acceptDroppedBy；和＝opsDropped；日誌行 提煉終審剔除)

| 型別碼 | 理由字串 | 分支 file:line |
|---|---|---|
| `off-topic` | 離題 | src/workflow/verdicts.mjs:155(理由列舉 :13) |
| `no-source-support` | 無出處支持 | src/workflow/verdicts.mjs:155(理由列舉 :13) |
| `same-doc` | 同篇 | src/workflow/verdicts.mjs:155(理由列舉 :13) |
| `duplicate` | 重複 | src/workflow/verdicts.mjs:155(理由列舉 :13) |
| `mislabeled` | 性質標錯 | src/workflow/verdicts.mjs:155(理由列舉 :13) |
| `fabricated` | 捏造 | src/workflow/verdicts.mjs:155(理由列舉 :13) |
| `opposition-holds` | 對立成立 | src/workflow/verdicts.mjs:155(理由列舉 :13、:31) |

#### doubted(doubtedBy；和＝opsDoubted；日誌行 提煉終審存疑)

| 型別碼 | 理由字串 | 分支 file:line |
|---|---|---|
| `not-opposed` | 非對立 | src/workflow/verdicts.mjs:136(理由列舉 :28) |
| `same-doc` | 同篇 | src/workflow/verdicts.mjs:136(理由列舉 :28) |

- 測試：`unit-extract-reject-kinds`（K1 清單形狀與契約鍵；K2 理由→碼對照與 `verdicts` 列舉同集；K3 `applyDelta` 之 44 個碼各一觸發案(同一碼有多條路徑者逐路徑各一案)、`validateVia` 五碼、`guardOps`、`applyPatch`／`removalAllowed` 十一碼、`applyVerdicts` 之七＋二理由；K4 原始碼掃描；K5 輔助函數；K6 runPass 層與提煉段層之日誌行↔detail↔stats 同源、各組之和等於總數）；`unit-extract-stage`〈終審之非對立〉〈終審剔除入日誌與計數〉（刻意更新之日誌行斷言）。
- 限制：①`launder-source-withdrawn`／`launder-source-held` 兩種並見者以先列者（出處已撤）為碼；②`same-doc-pair` 含「併爭議後之同篇成對」；③`dependency-rejected` 為依附操作之連鎖拒收（其根因之碼在被依附之操作自己的拒收上，兩者各計一次）；④`unclassified` 在正常路徑為 0，出現即漏標。

## EXT-39 核心版本之產出鏈（changelog 每筆之 `produced`）

- **規則**：每個由 AI 產出之新核心版本，其 changelog 該筆帶 `produced`（跨套件之產出鏈規格 §2.2 多步產出）：`{ v:1, stamp, stage, pkg, at, steps:[{ role, seat, provider, promptFp? }], failures:[{ role, seat, provider, type }] }`，一律經 `makeProduced` 組（`core/producedChain.producedOfCalls`）。`steps` 依呼叫完成之序、**每個實際成交之呼叫一列**（`provider`＝該次結果之 `providerId`，遞補後為遞補者）；`failures` 為成交之呼叫其遞補鏈中失敗而遞補之嘗試（`provider` 去金鑰序號 `#n`、`type`＝調度層之 `errorType`，缺者取 `outcome`）；**整條鏈皆敗（無成交）之呼叫不入產出鏈**（沒有產出；失敗見逐棒日誌）。
- **stage**：`extract`（一般）、`regen-core`（`regenCore` 後新核心之**第一版**：核心尚無版本而封存目錄有該核心之重練封存〔`hasCoreArchive(dirs, id, 'regen')`〕）、`rollback`（`rollbackCore`，見 EXT-40）、`standards-fix`（不呼叫 AI 之確定性寫入，見下〈不呼叫 AI 之確定性寫入〉）。regen-core 之後各版為 `extract`。
- **`stamp`**＝提煉段 `ctx.stamp`（管線執行器交各段，與該輪 `run.json` 之 `stamp` 同一值）；輪次外（手動 ops／直接呼叫）為 `null`。`pkg`＝`pkgIdOf(import.meta.url)`（`w-knowledge-extract@<版>`）。`at`＝該輪 `env.at`（`clock.iso8()`）。
- **`steps[].role` 與席號**（角色名＝十四個評比角色 id 去 `wf-` 前綴；`promptFp`＝該評比角色之 `createPromptFpCache.promptFpOf(角色, { vocab })`，無題組或算不出者省略；評比角色由根檔 `extractObject` 經 `opt.benchRoleOf` 注入提煉段〔stages 層不取葉〕）：

| 呼叫之棒（onCall 之 stage） | step `role` | 席號 | 提示詞指紋之評比角色 |
|---|---|---|---|
| `draft1`～`draft3`（一般提煉） | `draft` | 1～3 | `wf-draft` |
| `draft1`～`draft3`（整併） | `consolidate` | 1～3 | `wf-consolidate` |
| `draft1`～`draft3`（本質專步） | `essence` | 1～3 | `wf-essence` |
| `integrate` | `integrate` | 0 | `wf-integrate` |
| `audit` | `audit` | 0 | `wf-audit` |
| `revise` | `revise` | 0 | `wf-revise` |
| `accept`（一般） | `accept` | 0 | `wf-accept` |
| `accept`（待審裁決） | `pending` | 0 | `wf-pending` |
| `check1`～`check3`（出處支持覆核） | `support-check` | 1～3 | `support-check` |
| `revise9`（語氣收斂） | `support-revise` | 0 | `support-revise` |
| `dispute1`～`dispute3`（爭議覆核） | `dispute-check` | 1～3 | `dispute-check` |
| `orphan1`～`orphan3`（失撐找支持） | `orphan-check` | 1～3 | `orphan-check` |
| `synonymPropose`／`synonym1`～`3` | `synonym-propose`／`synonym-check` | 0／1～3 | 同名評比角色（同義專步不升核心版，列於對照以備全） |

- **既有 `ctx.meta` 與 `produced` 之關係**（兩者並存、舊欄位不刪）：一般差量 `{ accepted, degrade }`、待審裁決 `{ step:'pending', reviewed:'ok', provider }`（`provider`＝終審席成交者，與 `produced.steps` 之 `pending` 步同值）、失撐／存量專步 `{ std, pass }`；`mode`（＝`ctx.step`）與 `produced.stage` 不同義（mode 為 pass 之種類 delta／consolidate／essence／pending…，stage 為產出之來由 extract／regen-core／rollback）。重複者（待審之 `provider`）以 `produced` 為準。
- **不呼叫 AI 之確定性寫入（stage `standards-fix`；主控裁示：規格 §4 之 extract stage 列舉已含，定義為「不呼叫 AI 之確定性寫入〔標準修正、存量處置、撤出處與恢復等維運〕」）**：凡會在 changelog 寫一筆而無 AI 呼叫者，該筆一律帶 `produced`＝規格 §2.1 單一形 `{ v:1, stamp, stage:'standards-fix', seat:null, provider:null, pkg, at }`（`seat`／`provider` 同時 null、無 `promptFp`、無 `steps`；經 `core/producedChain.standardsFixProducedOf` 組，內部走共用件 `makeProduced`）。`stamp`：輪次內之呼叫者取 `ctx.stamp`（提煉維護取 `env.roundStamp`）；維運入口（`applyCoreStockFix`、`reviveClaims`）由 `opt.stamp` 給，未給為 `null`；不合式即拋（訊息不含輸入值），**拋在任何寫入之前**。`at`＝該筆 changelog 之 `at`。純狀態函數（`coreFixOf`／`reviveItems`／`withdrawSources`）以選件 `produced` 接收、由呼叫端組好傳入（寫入複本）；**未給者無 `produced` 鍵（既有輸出不變）**，預演（`planCoreStockFix` 之 `coreFixOf`）不給。舊記錄不回填。
- **changelog 寫入站點全集**（盤點指令：Grep `changelog\.push\(|changelog\s*=\s*\[|changelog:\s*\[[^\]]` 於 `src/`；恰此 5 站，測試 `unit-extract-provenance` P6 之靜態掃描逐站驗「帶 produced」，新增站點即紅）：

| # | 站點 file:line | changelog `mode` | produced.stage | produced 之來源（呼叫端 file:line） |
|---|---|---|---|---|
| 1 | `src/stores/coreDelta.mjs:1287`（`applyDelta`） | `delta`／`consolidate`／`essence`／`pending`／失撐／存量專步…（`ctx.step`） | `extract`／`regen-core`（AI） | `ctx.meta.produced`＝各 pass 之 `producedMetaOf(o.producedOf)`：`runPass.mjs:555`、`pending.mjs:209`、`orphanPass.mjs:124`、`disputePass.mjs:161`、`supportStockPass.mjs:204`（皆經 `applyWithInvariants`） |
| 2 | `src/ops/rollbackCore.mjs:139` | `rollback` | `rollback` | 同處（`rollbackCore` 本身組，§2.1 單一形；`stamp` 恆 `null`——維運入口，無輪次） |
| 3 | `src/stores/coreState.mjs:691`（`reviveItems`） | `revive` | `standards-fix` | `src/ops/reviveClaims.mjs:183`（`opt.stamp`；試算 `:163` 不寫入） |
| 4 | `src/stores/coreState.mjs:788`（`withdrawSources`；僅升版者寫） | `withdraw`／`restore` | `standards-fix` | `src/stages/extractMaintain.mjs:279`（`env.roundStamp`） |
| 5 | `src/standards/coreStockFix.mjs:161`（`coreFixOf`；僅升版〔ES3 有改〕者寫） | `stock-fix` | `standards-fix` | `src/standards/stockFix.mjs:282`（`applyCoreStockFix` 之套用路徑；`opt.stamp`；預演 `:185` 與連鎖斷言重跑 `:413` 不寫） |

  非 changelog 寫入站點（不需 produced）：`rollbackCoreStockFix`（`stockFix.mjs:474`）寫回處置前之整份狀態而不新寫 changelog；只移出已見（ES5）、只落帳（rev 升）、證據重算之寫入不升版故不寫 changelog；`bench／esCases／opStandards／candidates` 之 `applyDelta` 為記憶體內試算不落盤。`withdrawSources` 無受影響條目（不升版）者不寫 changelog。
- **產出鏈組不出**（stamp、套件版或時刻不合共用件格式；程式之錯）：該版 changelog 缺 `produced`，WARN `提煉產出鏈組不出[概念]：…`（須見，已入 `EXTRACT_LOG_MUST_SEE`）；不拖垮該 pass。
- 測試：`unit-extract-provenance`（P1 一輪之 steps／stamp／pkg／at／promptFp、十四角色逐一實跑得指紋、revise 步、輪次外 stamp null；P2 遞補與 failures、整條鏈皆敗不入、純函數與靜態掃描〔五個 pass 皆接 `producedMetaOf`〕；P5 既有 meta 並存；P3 總組裝之兩輪 stamp 等於各自 run.json、重練後第一版 regen-core；P6 `standardsFixProducedOf` 之形與 stamp 檢核、三個純函數之 produced 參數〔給／未給／未升版〕、changelog 寫入站點全集之靜態掃描、撤出處／恢復之輪次內外 stamp、依產出鏈取回〔`stage: 'standards-fix'` 選得到、`provider` 成交者選不到、`provider: null` 恰選到〕）；站點案分置：存量處置 `unit-extract-stockfix`〈產出鏈(EXT-39…)〉（stamp 內外、不合式拋且未寫未記帳、只移出已見不寫 changelog、選件）、還原撤回 `unit-extract-stage`〈reviveClaims 之產出鏈〉（stamp 內外、不合式拋且未寫、選件）、撤出處／恢復之總組裝 `unit-flow-extract` F4（stamp＝該輪 run.json 之 stamp）。

## EXT-40 核心回退 `rollbackCore` 與依產出鏈取版本 `coreVersionsByProvenance`

- **既有能力盤點**（先查，無則新增）：`regenCore`＝封存後自 v1 重練（破壞性、非回退）；`prev`（`<id>.state.prev.json`）＝每次 `coreStore.save` 前之上一份，**只落帳之寫入不升版，故 .prev 之版本可能與現版同**；`archive`＝壞檔隔離、重練、分身併入之封存；`essenceHistory`、主張之 `history`（只有 revise 記 `before`）不足以逆推完整狀態。**無任何既有 ops 可回到指定版本** → 新增 `rollbackCore(stores, concept, { dirs, domain, toVersion?, … })`（`ops/rollbackCore.mjs`）。
- **規則**：①回退來源**唯一為 `.prev`**，且須 `.prev.version === toVersion < 現版`（未給 toVersion＝上一份之版本，即前一版）；不是者明確拒絕（`ok:false`＋`refused` 原因碼：`no-core`、`state-unreadable`、`no-prev`、`to-version-invalid`、`to-version-not-lower`、`version-unavailable`、`prev-mismatch`；常數 `ROLLBACK_REFUSED`），不改任何東西；②被回退之版本封存＝現版狀態檔複本（`<id>.state.json.rollback-<stamp>`，`coreStore.snapshot`；主檔仍在直到被新內容以 CAS 取代，無空窗）；③寫回 `.prev` 之內容＋一筆 changelog `{ version:toVersion, mode:'rollback', batch:(回退後版本末筆之 batch), from, by, produced }`，`produced`＝規格 §2.1 之不呼叫 AI 之單一形 `{ stage:'rollback', seat:null, provider:null, stamp:null, pkg, at }`（共用件之 steps 不收空陣列，故不用 `steps: []`）；`version` 即 toVersion、`rev` 續增（CAS）；④md 與 cores 記錄以 `writeProjections` 重渲染（需 `opt.domain`＝管線所用之 domain）；回退後之 md 與該版當時之 md 逐位元組同（`renderHashes` 取現版者，不誤報手改；changelog 末筆沿用該版之 batch 使 front matter 之 notes 同）；⑤該核心之待判結案（`coreHoldsToCloseOf`，與 `regenCore` 同一份：未結與已豁免之筆記層、爭議、主張、核心待判）；已用筆記（`consumed`）、已見（`seen`）、已見衝突隨狀態回到該版——被回退之版本所消化之筆記回到未消化，下一輪依既有選篇重新處理；⑥`opt.lockFile` 給了即取鎖（管線持鎖中拒絕）；`opt.dryRun` 只驗與列 plan。
- **`coreVersionsByProvenance(stores, { dirs, stamp?, stage?, provider?, seat?, since?, until? }) → [{ concept, version, produced }]`**（`ops/coreVersionsByProvenance.mjs`；純讀）：逐核心讀狀態檔之 changelog，取 `produced` 合於條件者；條件皆「且」；多步者之 `provider`／`seat` 比對 steps，**兩者並給時須同一步**；單一形（如回退之 null／null）比對頂層；`since`／`until` 比對 `produced.at`（含界；ISO 字串、毫秒數、Date）；無 `produced` 之舊記錄不出現；被回退而封存之版本不在現行狀態故不出現。選件之後之重處理或撤出走既有路徑（重審、`regenCore`、`rollbackCore`）。
- 刻意之差與限制：①回退只能回到 `.prev` 之版本（實務上緊接於升版之後成立；其後若有只落帳之寫入即無從回退）——要回任意版須另有逐版快照（每次升版前存一份；本輪未做，見 state 已知缺口）；②回退不清失敗帳與影響留待（退避只影響排序）；③回退後 `.prev` 為被回退之版本（其版本高於現版，故 `rollbackCore` 不能「重做」——拒收 `to-version-not-lower`；被回退之版本以封存複本人工取回）；④`rollbackCore` 列入 `EXTRACT_UNGATED_WRITE_ENTRIES`（`kind:'undo'`）。
- 測試：`unit-extract-rollback`（B1 成功：version、狀態內容、changelog 之 rollback 筆與 produced、封存複本、md 逐位元組同 v1、記錄、待判只結案該核心、手改不誤報、選件選得出 rollback、回退後下一輪重處理；B2 七個拒收碼＋鎖＋無 .prev，皆不改任何東西〔指紋比對〕；B3 預演不寫、輸入檢核）；`unit-extract-provenance` P4（選件之各條件、且、同一步、含界、不可解析拋、輸入檢核、純讀、舊記錄不出現）；`unit-extract-registry`（寫入站點之反向盤點含 `rollbackCore`）。
