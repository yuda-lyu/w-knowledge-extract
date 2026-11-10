# 回饋（w-knowledge-extract）

> 任務中發現之自有套件、全域技能、全域設定之調整與抽提提案。只增不改；處置結果另記一列並寫明承接哪一列。回饋是紀錄與提案，實際修改走通報管道。

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-11 | 自有套件 | w-knowledge-capture | `AI_SCHEMA` 與 `AI_DEFAULT` 之鍵序不一致：1.0.18 新增之 `cooldownGrowth`、`cooldownMaxMs` 在預設緊接 `cooldownMs`，在 schema 卻排最末。下游以 `Object.keys(AI_SCHEMA)` 迭代組預設者（本套件 `EXTRACT_AI_DEFAULT` 原寫法）鍵序即偏離抓取套件。提案：兩處排成同序，或於 schema 註解載明「鍵序以 `AI_DEFAULT` 為準」。本套件已改為迭代預設物件之鍵（不待上游），故非阻擋項 | `node_modules/w-knowledge-capture/src/core/settingsDefault.mjs:45-53`（預設）、`:294-299`（schema）；改前 `unit-settings`〈鍵與序同抓取套件〉之失敗輸出 |
| 2026-11-11 | 自有套件 | w-knowledge-capture | 各下游測試各維護一份「設定型別 → 邊界樣本」表（本套件 `test/unit-settings.test.mjs` 之 `SAMPLES`，摘要套件同），上游新增型別 `growth` 時每個下游都須補同一組樣本。提案：上游於其測試工具匯出各型別之邊界樣本（合格／不合格），下游測試改取之，只留本套件專屬型別之樣本 | `test/unit-settings.test.mjs` 之 `SAMPLES` 與 `samplesOf`；`node_modules/w-knowledge-summarize/test/unit-settings.test.mjs:89` 同一組 `growth` 樣本 |
