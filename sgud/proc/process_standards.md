# 處理要點 — 檢定標準之運維（w-knowledge-extract）

> **路徑基準**：原始碼在 `src/`，本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`。「使用端」＝使用本套件之專案；上游三套件之運維見各該套件之 `sgud/`。

## 檢定標準之運維(規則帳本 `rulebook_standards.md`／`rulebook_standards_extract.md`)

- **預設全關**:本套件之 AI 標準預設皆停用(`extract.standards.supportCheck.enabled` false;`disputeCheck`、`supportStock`、`orphanCheck`、`synonymCheck` 之 `perRun` 皆 0;`extract.recheck.relationImpact` false;符合度掃描 `extract.standards.scanEachRun` false)。開啟前依「**容量 ≥ 進料**」定配額與席位,並備好判定小組席位(`extract.standards.ai.{first,second,third}`;啟動期檢核缺席位即拋)。
- **開啟程序**(每個 AI 標準):①以評分角色對正式席位實跑題組(`node src/bench/cli.mjs --role <角色> --models <正式席位> --runs 2`;判準＝逐案兩回全過,README §15);②先小配額(`perRun` 取小值)開啟,觀察日誌與 `run.json` 之計數(已檢、合格、待判、截止);③待判之處置(列表、重試、豁免)屬抓取套件(`listHolds`、`requestRetry`、`waiveHold`),各待判之「下一步」即可完成之處置;④存量由逐輪餘量消化,依 `extract.standards.*.perRun`、`maxTries` 與退避(1／2／4 天)推算完成期。
- **AI 標準之容量**:呼叫數為下限＝兩席各 1 次／頁,另加第三席(兩席不一致時)、修訂與修訂後重判。ES9 以 `packSupportPages` 依字數分頁(材料同提煉段 `env.contentOf`)、ES8 以 `packOrphanPages`、ES14 同 ES9 依字數分頁(`SUPPORT_PAGE_CHARS`)、ES11 以 `SYNONYM_PAGE_SIZE` 為一頁;進料＝新進操作於每個提煉 pass 內覆核(ES9 新進,每 pass 至少 2 次)與關聯變更之夥伴(ES10)。
- **符合度掃描**:`auditExtractStandards`（`standards/audit.mjs`）逐核心判定確定性標準與讀 AI 標準之檢核紀錄;未能判定不得算合格,分開計。
- **存量處置與回退**:`planCoreStockFix` → `applyCoreStockFix` → `verifyCoreStockChain`;回退 `rollbackCoreStockFix` 只還原該次處置改過之單位、現值已被改者不覆寫並報 `conflicts`(`acceptCurrent` 記取代列)。**寫入者由呼叫端負責取執行鎖(與管線互斥)、備份與同意**。
