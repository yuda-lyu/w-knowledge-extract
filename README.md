# w-knowledge-extract
A general-purpose pipeline for knowledge extraction: building per-concept core knowledge from notes and the relations between them, updating it when knowledge or relations change, and vetting it with standards.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-knowledge-extract.svg?style=flat)](https://npmjs.org/package/w-knowledge-extract) 
[![license](https://img.shields.io/npm/l/w-knowledge-extract.svg?style=flat)](https://npmjs.org/package/w-knowledge-extract) 
[![npm download](https://img.shields.io/npm/dt/w-knowledge-extract.svg)](https://npmjs.org/package/w-knowledge-extract) 
[![npm download](https://img.shields.io/npm/dm/w-knowledge-extract.svg)](https://npmjs.org/package/w-knowledge-extract) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-knowledge-extract.svg)](https://www.jsdelivr.com/package/npm/w-knowledge-extract)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-knowledge-extract/global.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-knowledge-extract
```

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-knowledge-extract/blob/master/g.mjs)]
```alias
import fs from 'fs'
import WKnowledgeExtract from './src/WKnowledgeExtract.mjs'


let { createKnowledgeExtract } = WKnowledgeExtract


let test = async () => {
    let ms = []

    //workDir, 知識庫根目錄(唯一必填): db/log/state/knowledge/tmp 等皆由此展開, 筆記 md 位於 knowledge/notes, 核心知識 md 與狀態檔寫入 knowledge/core
    let workDir = './_test_knowledge_extract'
    fs.rmSync(workDir, { recursive: true, force: true })
    let notesDir = `${workDir}/knowledge/notes`
    fs.mkdirSync(notesDir, { recursive: true })

    //notes, 模擬摘要套件交出之筆記(記錄與 md), 實務上由 w-knowledge-summarize 寫入同一個 workDir, 關聯由 w-knowledge-relate 完成(relatedAt 非空代表已關聯)
    let landNote = (id, title, concepts, summary, points) => {
        let file = `${notesDir}/${id}.md`
        let md = [
            '---',
            `title: "${title}"`,
            `slug: "${id}"`,
            `concepts: [${concepts.map((c) => `"${c}"`).join(', ')}]`,
            'type: "note"',
            '---',
            '',
            `# ${title}`,
            '',
            '## 一句話重點',
            '',
            summary,
            '',
            '## 核心知識',
            '',
            ...points.map((p) => `- ${p}`),
            '',
        ].join('\n')
        fs.writeFileSync(file, md, 'utf8')
        return { id, title, category: '方法與技術', concepts, summary, claimType: '實證研究', evidenceLevel: '中', file, createdAt: '2026-09-01T00:00:00+08:00', relatedAt: '2026-09-02T00:00:00+08:00', extractedAt: '' }
    }
    let notes = [
        landNote('accretion-disk', '黑洞吸積盤之輻射機制', ['黑洞', '吸積盤'], '吸積盤氣體因摩擦加熱，並以 X 射線輻射出重力位能。', ['盤內緣溫度可達百萬度以上']),
        landNote('black-hole-spin', '以鐵譜線輪廓量測黑洞自旋', ['黑洞', '自旋'], '由 X 射線光譜中鐵譜線的輪廓，可推估吸積盤內緣位置與黑洞自旋。', ['譜線輪廓愈寬，內緣愈靠近黑洞']),
        landNote('jet-launching', '相對論噴流之發射', ['黑洞', '噴流'], '吸積盤磁場把部分物質沿自旋軸加速成相對論噴流。', ['噴流功率與自旋及磁場強度相關']),
    ]

    //aiAdapter, AI 調度層替身(cfg.aiAdapter 為正當擴充口): 依提示詞首句判斷 3+3 工作流之角色並作答, 離線可跑
    //  起草(三席)每篇筆記提一條「規則」主張並立本質, 整合收入第一份候選, 審計無意見, 終審逐條保留
    let calls = []
    let roleOf = (prompt) => {
        let roles = [[/^你是.*?的提煉器。/, 'draft'], [/^你是.*?的整合員。/, 'integrate'], [/^你是.*?的審計員。/, 'audit'], [/^你是.*?的修訂員。以下是「/, 'revise'], [/^你是.*?的終審員。/, 'accept']]
        return (roles.find(([re]) => re.test(prompt)) || [null, 'other'])[1]
    }
    let answerOf = {
        draft: (prompt) => {
            let batch = [...prompt.matchAll(/^### (N\d+) (\S*)/gm)].map((m) => ({ code: m[1], title: m[2] }))
            let ann = { critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }
            return {
                ops: [
                    ...batch.map((n, k) => ({ op: 'add', ref: `r${k}`, kind: 'rule', text: `主張：${n.title}`, basis: '案例', sources: [n.code], ...ann })),
                    { op: 'essence', text: '黑洞周圍之吸積盤、自旋與噴流彼此相扣', claims: ['@r0'], reason: '首版' },
                ],
                skipped: [],
            }
        },
        integrate: (prompt) => {
            let sec = prompt.split(/^【候選 (\d+)】$/m)[2] || ''
            let ops = sec.split('\n').filter((l) => /^a\d+_\d+（/.test(l)).map((l) => {
                let op = JSON.parse(l.slice(l.indexOf('{')))
                delete op._oid
                return { ...op, via: [l.match(/^(a\d+_\d+)（/)[1]] }
            })
            return { ops, skipped: [] }
        },
        audit: () => ({ issues: [] }),
        revise: () => ({ edits: [], adds: [], removes: [] }),
        accept: (prompt) => ({ verdicts: [...prompt.matchAll(/^i=(\d+) \{.*\}$/gm)].map((m) => ({ i: Number(m[1]), action: 'keep' })) }),
    }
    let answer = (prompt, opt) => {
        let role = roleOf(prompt)
        calls.push(role)
        let json = (answerOf[role] || (() => null))(prompt)
        let ok = json !== null && (typeof opt?.check !== 'function' || opt.check(json))
        return ok ? { ok: true, json, providerId: `stub-${role}`, ms: 1, tried: [{ providerId: `stub-${role}`, outcome: 'ok' }] } : { ok: false, error: '替身形狀不合', tried: [] }
    }
    let wkf = {
        runFanout: async ({ task, agents }) => ({ ok: true, agents: agents.map((a) => answer(task, a)) }),
        callAi: async (prompt, opt) => answer(prompt, opt),
    }
    let aiAdapter = {
        getWkf: () => wkf,
        seatSpec: (seat) => (seat ? { use: seat.use, fallback: [], timeoutMs: 60000 } : null),
        recordCall: () => {},
    }

    //flow, 總組裝: 內建設定/詞彙/提示詞/檢定標準/LMDB/鎖/日誌/執行摘要走預設, 只置換 AI 調度層; extract 僅調降新核心門檻與批量以適應 3 篇筆記
    let silent = { info: () => {}, warn: () => {}, error: () => {} }
    let flow = createKnowledgeExtract({
        workDir,
        data: {
            vocab: { domain: '天文學' }, //主題範圍(選填), 提示詞之領域句據此限定, 未給即不限主題
        },
        extract: { minNotes: 2, notesPerConcept: 3, perRun: 1 },
        aiAdapter,
        scheduleLimitMin: 60, //排程執行上限(分鐘), 整輪時間預算與鎖陳舊期限由此推導
        afterRun: false, //無收尾鉤子
        logFactory: () => silent, //靜音日誌(預設每輪寫 log/<day>/<stamp>-run.log)
    })

    //stores, 寫入筆記記錄(實務上由摘要套件寫入, 此處直接插入作為輸入)
    let stores = flow.openStores()
    await stores.notes.insertNew(notes)
    await flow.closeStores(stores)

    //run, 一輪: 選題 → 3+3 工作流(起草→整合→審計→終審)→ 套用 → 寫狀態檔與核心 md
    let r = await flow.run()
    ms.push({ round: `ok[${r.ok}], ` + r.stages.map((s) => `${s.name}[${s.status}]`).join(', ') })
    ms.push({ summary: r.stages[0].result.summary })

    //stores, 讀回結果(狀態檔為真理, 核心 md 與 cores 記錄為其投影)
    stores = flow.openStores()
    let cs = await stores.cores.select()
    ms.push({ cores: cs.map((c) => `${c.concept}｜${c.noteCount} 篇`) })
    let ns = await stores.notes.select()
    ms.push({ extracted: ns.map((n) => `${n.id}｜${n.extractedAt ? '已提煉' : '未提煉'}`).sort() })
    await flow.closeStores(stores)
    let files = fs.readdirSync(`${workDir}/knowledge/core`).sort()
    ms.push({ coreFiles: files.map((f) => f.replace(cs[0].id, '<核心 id>')) })
    let md = fs.readFileSync(`${workDir}/knowledge/core/${cs[0].id}.md`, 'utf8')
    ms.push({ mdSection: md.split('\n').filter((l) => l.startsWith('## ')) })
    ms.push({ calls })

    //clear
    fs.rmSync(workDir, { recursive: true, force: true })

    console.log('ms', ms)
    return ms
}
await test()
    .catch((err) => {
        console.log(err)
    })
// => ms [
//   { round: 'ok[true], 提煉[ok]' },
//   { summary: '概念 1、更新 1 則核心、消化 3 篇（AI 6 次）' },
//   { cores: [ '黑洞｜3 篇' ] },
//   {
//     extracted: [
//       'accretion-disk｜已提煉',
//       'black-hole-spin｜已提煉',
//       'jet-launching｜已提煉'
//     ]
//   },
//   { coreFiles: [ '<核心 id>.md', '<核心 id>.state.json' ] },
//   { mdSection: [ '## 本質', '## 可操作規則', '## 提煉自' ] },
//   {
//     calls: [ 'draft', 'draft', 'draft', 'integrate', 'audit', 'accept' ]
//   }
// ]
```

---

## 概述

通用知識提煉:自知識筆記(摘要套件交出)與筆記間之關聯(關聯套件交出),為每個概念提煉一份**核心知識**——主張(原理、可操作規則、陷阱與失效條件、時效與機制相依四種)、參數、爭議、待解問題與本質;新筆記加入、既有筆記或關聯變更時更新受影響之核心;以檢定標準剔除不合格之內容,對立之結論以爭議並陳而不硬調和。

- **領域中立**:預設不綁任何主題。知識庫稱呼、主題範圍、內容類型之證據封頂、證據性質之詞、推論類、提示詞之領域句,全由使用方給。
- **逐層可覆寫**:設定、詞彙、提示詞(17 鍵)、domain、子階段與動作鏈、AI 調度層、儲存皆有預設,使用方只給要改的部分。
- **自成一體**:本套件只 import 自己的檔案、`package.json` 所列套件,以及抓取、摘要、關聯三套件(各經單一匯入點 `src/core/capturePackage.mjs`、`src/core/summarizePackage.mjs`、`src/core/relatePackage.mjs`);原始碼在 `src/`,下文所列檔案路徑(`core/…`、`stages/…`、`createKnowledgeExtract.mjs`、`bench/…` 等)除另標 `src/` 者外皆相對 `src/`(測試輔助件在 `test/tools/`,隨 npm 包發布供下游取用)。

---

## 1. 一輪做什麼

`flow.run()` 跑一個子階段 `extract`(`cfg.stageOpts` 之鍵),其內依序:

| 步 | 做什麼 | 呼叫 AI |
|---|---|---|
| 停用判斷 | `extract.perRun` 為 0 即本輪不選題、不呼叫 AI(合法設定) | 否 |
| 中斷之補做 | 前次落盤中斷者(dirty 標記)以狀態重建投影 | 否 |
| 維護 | 首見基準、**刪除墓碑驅動之撤出處／恢復**(關聯套件之明示刪除)、投影更新(標題改了即重繪 md)、重審項之統計(已提煉之筆記內容變更、新判之衝突、衝突被撤銷)、已見衝突之回頭檢查(處置結構被拆解、取代、撤回拿掉而無去向者自已見移出,檢定標準 ES5)、關聯變更之影響(檢定標準 ES10;預設關)——在時間守門之前,不因時間不足而停擺 | 否 |
| 時間守門 | 剩餘時間預算不足 `extract.minRemainingMs` 即不再開工 | 否 |
| 選題 | 概念層:新核心之主標籤可提煉篇數 ≥ `minNotes`;既有核心之待提煉 ≥ 每批,或 ≥ `minPending` 且等待 ≥ `maxWaitDays`;閒置輪補久候尾數;類別後備預設停用 | 否 |
| 逐核心(並行 `perRun`) | 待審裁決 → [僅重審] → 整併(有效主張逾 `claimsCap`)→ 提煉批次 × 追趕(`catchupBatches`)→ 本質專步(ES6)→ 各判定小組之專步:爭議覆核(ES14)、出處支持存量覆核(ES9)、失撐主張找支持(ES8)(三者預設關) | 是 |
| 同義核心核對 | 兩個主核心之概念名是否同一概念(ES11;預設關) | 是 |

**3+3 工作流**(每一步皆同):三家獨立起草(各出一份差量)→ 整合(合併三份候選;程式計票、引用閉包)→ 審計(只列問題;程式判得出之超限一併列)→ 修訂(只出補丁;審後不得比審前差)→ 終審(逐操作裁決;不可逆操作須明列)→ 程式套用。差量之操作經守門、檢定標準之納入閘與不變式;不合者逐條剔除、其餘照收。

**狀態為真理、md 為投影**:每個核心一份狀態檔(主張庫;`<核心 id>.state.json`)為真理,核心 md 與 `cores` 記錄為其投影。寫入順序:dirty 標記 → 狀態(CAS、原子寫、上一版)→ 再驗磁碟版次 → md(手改偵測:被手改者先另存再覆寫)→ `cores` 記錄 → 筆記之 `extractedAt` → 分身 → 清 dirty;中斷者下輪以狀態重建投影。**已用過**＝逐核心累積之出處(狀態之 consumed),不是筆記之全域旗標。

### 與上下游之介面

| 方向 | 內容 |
|---|---|
| 摘要 → 本套件 | 筆記記錄(`notes`:`id`、`title`、`concepts`〔第一個為主標籤〕、`category`、`claimType`、`evidenceLevel`、`samplePeriod`、`caveats`、`sourceName`、`docId`、`createdAt`、`file`)與筆記 md(摘要套件之版型)。分節摘要讀 md 之「一句話重點」「核心知識」「關鍵參數」「方法與步驟」「適用條件與限制」「利弊與取捨」「時效與機制相依」「爭議與反方觀點」與關聯之「⚠ 衝突與反例」(`NOTE_SECTIONS`,各章限長);「品質與證據標注」之值由記錄之欄位入摘要之標注行;「可驗證要點」不入起草之輸入(§19)。檢定標準之數字紮根之材料(`extractMaterialOf`)＝摘要之內容章＋原文標題＋發布時間 |
| 關聯 → 本套件 | 邊(`relations`:衝突型之邊為爭議之材料;全型別之邊為【關聯脈絡】與 ES10);關聯之帳(刪除墓碑 `openDeletions`、衝突撤銷／降級事件 `readConflictEvents`、撤出稽核 `readEdgeAudit`);md 之「⚠ 衝突與反例」章與 frontmatter `conflicts`(入分節摘要;不算內容變更);筆記之可提煉以關聯套件之 `isRelated`(已關聯)判,未關聯者逾 `relateGraceDays` 亦可 |
| 抓取 → 本套件 | 文件(`docs`,選開):發布時間與來源;未開即取筆記之欄位 |
| 本套件 → 筆記 | 記錄之 `extractedAt`(摘要套件之資料契約欄;曾被任一核心消化之時刻,ISO) |
| 本套件 → 下游 | ①核心記錄(`cores`;§12)②核心 md(`<core>/<核心 id>.md`;frontmatter 與各章由 domain 之 `renderState` 產生;章名為常數 `CORE_SECTION_TITLES`——讀核心 md 者取之,不另寫字面)③狀態檔(`<coreState>/<核心 id>.state.json`)④帳(`dirs.state` 下;§12) |
| 本套件 → 關聯 | 判為非對立、或多次未處置之衝突,以關聯套件之 `queueConflictCheck` 交關聯段核對(RS4 待判;日誌「…條衝突交關聯段核對」) |
| 待判與檢核紀錄 | 與摘要、關聯套件同一集合(`holds`、`checks`);物件與鍵見 §12;處置(列表、重試、豁免)屬抓取套件 |
| 執行摘要 | run.json 中段名「提煉」之段,其 `sub.extract` 為提煉子階段之 report;鍵之全集見 `EXTRACT_REPORT_KEYS`(`logContract.mjs`) |
| 日誌 | 外部巡檢所需之字樣與正則:`EXTRACT_LOG_KNOWN`、`EXTRACT_LOG_MUST_SEE`、`EXTRACT_LOG_PARSE`(§16) |

---

## 2. 安裝與執行環境

```
npm i w-knowledge-extract
```

依賴套件(`dependencies`,隨本套件一併安裝):json5、w-knowledge-capture、w-knowledge-relate、w-knowledge-summarize、wsemi。

| 外部程式 | 用途 | 沒有時 |
|---|---|---|
| opencode CLI | 預設 AI 席位(免費模型,免金鑰) | 提煉之 pass 全鏈失敗:記失敗帳(回隊尾、不丟),下輪再試 |

金鑰(付費或 REST 供應商)放 `<workDir>/.env`(或 `cfg.envFile`),不寫在設定裡。與抓取、摘要、關聯套件共用同一個 LMDB(`<workDir>/db`,庫名 `knowledge`)時,集合名一致即可,不必遷移。

---

## 3. 快速開始

```js
import W from 'w-knowledge-extract/src/WKnowledgeExtract.mjs'

const flow = W.createKnowledgeExtract({
    workDir: 'd:/my-kb', //唯一必填(與摘要、關聯套件同一個 workDir:讀其 notes 與 relations)
    data: {
        vocab: { kbLabel: '天文學知識庫', domain: '天文學' }, //皆選填;未給 domain 即不限主題
    },
    //待判登錄(holds)與檢核紀錄(checks)為必開之集合(判不了者須有處登錄、已檢者須有處記錄),不必給鍵
    scheduleLimitMin: 60, //每輪時間上限(分),據以推導整輪預算與鎖之陳舊期限
})
const report = await flow.run()
console.log(report.ok, report.summaryFile) //核心 md 寫入 d:/my-kb/knowledge/core
```

`createKnowledgeExtract` 回傳 `{ run, openStores, closeStores, info }`:`run` 跑一輪;`openStores`／`closeStores` 給維運工具開關集合;`info()` 揭露生效之目錄、設定、時鐘、AI 調度層、domain(提煉與關聯;與管線同一份)、資料與詞彙、時間預算、鎖與集合名。

**設定錯誤一律在建構期拋錯**:`cfg` 與設定(`ai`、`extract`)之不認得鍵、型別或值域不合(含 3+3 席位之結構與逐席形狀)、詞彙表不合規格、注入之 domain 缺成員或形狀不合、提示詞與 domain 同給、啟用之檢定標準缺判定小組席位或 domain 成員、子階段之掛載對不上錨點、注入之 AI 調度層缺工作流入口、AI 席位引用不存在之條目 id、時區無效——都不會靜默改用預設。形狀錯誤之訊息先於席位檢核。

---

## 4. 覆寫點一覽

| 層 | cfg 鍵 | 預設 |
|---|---|---|
| 路徑 | `workDir`(必填)、`dirs`(逐鍵:`db`、`log`、`tmp`、`state`、`knowledge`、`core`、`coreState`) | `<workDir>/db` 等;核心 md `<workDir>/knowledge/core`(不隨 `knowledge` 之覆寫移動);狀態檔目錄 `coreState` 未給者＝(覆寫後之)`core`——只覆寫 `core` 者狀態與 md 不分家 |
| 管線名 | `name`(日誌之管道名與執行摘要 `run.json` 之 `name`;非空字串) | `'知識提煉'` |
| 時鐘 | `timeZone`(IANA 時區)、`clock`(整組置換) | `'Asia/Taipei'` |
| 語言 | `lang`(BCP 47 代碼;抓取套件之 `resolveLocale`):覆核類提示詞之理由語言句、核心標準 ES3 之適用(只有繁體中文有字形標準——其餘語言掃描逐條目列「不適用」、操作守門與存量處置不轉字形)、概念鍵之繁簡折疊(中文才折)。每輪依賴 `deps.locale` 與 `info().locale` 為解析後之語言設定;`createExtractDomain` 收 `opt.locale`;純函數(`checkCore`、`guardOps`、`coreFixOf`)收 `ctx.locale`,未給即正體 | `'zh-TW'` |
| 設定 | `ai`、`extract`(見 §5) | `core/extractSettings.mjs` |
| 資料 | `data.vocab`(見 §6) | 中立之預設詞彙 |
| 提示詞 | `prompts.<17 鍵>`(見 §7) | 內建通用提示詞與規則表 |
| domain | `domains.extract`(整組置換;見 §7) | 內建工廠 `createExtractDomain` |
| 子階段 | `stageOpts.extract`(動作鏈之 `tap`、子階段之 opt;契約欄位 `enabled:false` 停用、`when(ctx)` 條件執行——停用者 report 為 `{ detail:{ disabled:true } }`)或 `stages`(整組自訂,與 `stageOpts` 擇一) | 內建之提煉子階段 |
| AI | `aiAdapter`(整組置換;須具工作流入口)、`aiOptions`(內建調度層之建構選項:`providerPick`、`exes`、`persistStore`、`usageCounter`;抓取套件之 `AI_OPTIONS_KEYS`)、`envFile`、`aiWorkspace` | 內建調度層(抓取套件之 `createAiAdapter`,開工作流入口) |
| 儲存 | `lmdb`:`WOrm`、`path`、`db`、`cls`(集合名);`holds`、`checks`(必開)、`docs`(選開) | w-orm-lmdb、`<workDir>/db`、`'knowledge'` |
| 時間與鎖 | `scheduleLimitMin`、`deadlineMs`、`lockStaleMs`、`lock` | 預算 50 分、鎖 `<dirs.tmp>/run.lock` |
| 其他 | `conceptFold`(概念鍵之繁簡折疊;與抓取、摘要、關聯套件同一單例)、`netGuard`(本機網路判斷;未給或 `null` 不判斷,見 §8)、`logFactory`、`afterRun`(收尾鉤子) | 內建 |

可用鍵之全集在 `createKnowledgeExtract.mjs` 之 `CFG_KEYS`、`DATA_KEYS`、`PROMPT_KEYS`、`COLLECTION_KEYS`。

**相對路徑之基準各鍵不同**:`envFile` 以 `workDir` 為基準;`lock`(字串)與 `aiWorkspace` 以執行時之 cwd 為基準。`info()` 回報的是解析後之絕對路徑。

**集合**:`notes`(讀筆記、寫 `extractedAt`)、`cores`(核心記錄)、`relations`(讀邊)、`holds`(待判登錄;與摘要、關聯套件同一集合)、`checks`(檢核紀錄)必開——未能判定不得算合格:判不了者須有處登錄、已檢者須有處記錄(提煉段開工即驗,缺者拋錯,不靜默略過;與關聯套件同);`docs`(文件;抓取套件寫入、本套件唯讀)以 `cfg.docs` 給 `true` 或集合名才開,未開者發布時間與來源取筆記之欄位。

---

## 5. 設定(`ai`／`extract`)

**合併規則**:**組**(物件)逐鍵遞迴合併——給了的鍵取代預設、其餘沿用;**葉**(含 3+3 席位)整個取代、不逐層合併。完整鍵、型別與註解以 `core/extractSettings.mjs` 為準(`EXTRACT_DEFAULT`／`EXTRACT_SCHEMA`／`EXTRACT_AI_DEFAULT`／`EXTRACT_AI_SCHEMA`;合併與型別規則取自抓取套件,`ai` 段之 schema 即抓取套件之 `ai` 段)。

```js
createKnowledgeExtract({
    workDir,
    extract: {
        perRun: 2,                                                   //只改所給之鍵
        recheck: { perRun: 2 },                                      //巢狀組逐層合併:其餘 recheck 鍵沿用預設
        standards: { ai: { first: { use: 'oc:opencode/big-pickle' }, second: { use: 'oc:opencode/mimo-v2.6-flash-free' } }, disputeCheck: { perRun: 2 } },
    },
    ai: { healthStreak: 2 },
})
```

| 組 | 鍵 | 預設 | 意義 |
|---|---|---|---|
| `extract` | `perRun`／`notesPerConcept` | 4／12 | 每輪提煉幾個概念(0＝停用)／一批之篇數;容量＝`perRun`×`notesPerConcept`(48 篇/輪) |
| | `minNotes`／`minPending`／`maxWaitDays` | 6／4／30 | 新核心門檻(主標籤可提煉篇數)／既有核心未滿一批時之入選下限／未滿一批者須等待之天數 |
| | `catchupBatches`／`relateGraceDays` | 3／3 | 積壓核心同輪至多連續幾批／未關聯之筆記延後入選之寬限天數 |
| | `sourceCap`／`noteTries` | 2／2 | 同一來源每批上限(不足一批時放寬)／批內未被涵蓋之筆記至多送幾次(含首次;第 `noteTries` 次仍未涵蓋即出隊並登錄待判 ES15) |
| | `claimsCap`／`consolidateEvery` | 80／5 | 有效主張逾此值即排入整併／每幾版至多整併一次 |
| | `minRemainingMs` | 900000 | 開工與每一步之門檻:剩餘時間不足即不再開始下一步 |
| | `relationTypes` | `'conflict'` | 起草提示詞【關聯脈絡】所列之型別:`'conflict'`(只衝突型)｜`'linked'`｜`'all'` |
| | `categoryFallback` | `null` | 類別後備(給 `{ minNotes, minGain }` 才開) |
| | `ai` | 見 §8 | 3+3 席位 `{ drafters:[3 席], integrate, audit, revise, accept }`(葉;給了即整份取代) |
| `extract.recheck` | `slots`／`perRun`／`guard`／`waitDays` | 3／1／20／7 | 一般批內保留給重審筆記之格數／每輪至多幾個僅重審 pass／單輪內容變更篇數之守門(逾即不排重審並告警,確認後以 `requestRebaseline` 重設基準)／衝突重審之最長等待天數 |
| | `relationImpact` | false | 關聯變更之影響(ES10):開啟時以邊庫快照差分產生事件、逐核心處置並記影響帳 |
| `extract.standards` | `supportCheck.enabled`／`.maxTries` | false／3 | 出處支持覆核(ES9 新進):定稿於套用前判所引出處是否支持斷言／同一筆記之覆核判不了逾此次數(含待審裁決之再判) → 改由使用者判讀 |
| | `supportStock.perRun`／`.maxTries` | 0／3 | 出處支持之存量覆核(ES9 存量;0＝停用)／同一主張缺票或同一供應者逾此次數 → 隔離＋待判 |
| | `orphanCheck.perRun`／`.maxTries` | 0／3 | 失撐主張找支持(ES8;0＝停用;每輪至多幾條主張,失撐多之核心先;同時服務之核心數以 `extract.perRun` 封頂)／同上 |
| | `disputeCheck.perRun`／`.minVersions`／`.waitDays`／`.maxTries` | 0／1／7／3 | 爭議覆核(ES14;0＝停用;每輪至多幾則):終審存疑之未解決爭議,於核心再升版 `minVersions` 版或存疑逾 `waitDays` 天後判是否真對立／同一則缺票或同一供應者逾此次數 → 待判(使用者) |
| | `synonymCheck.perRun`／`.maxTries` | 0／3 | 同義核心核對(ES11;每輪至多幾對)／同上 |
| | `ai` | `{ first:null, second:null, third:null }` | 上列各項共用之判定小組(任一項開啟時 first、second 必填;兩票之實際成交供應者須不同才成立) |
| | `scanEachRun` | false | 每輪結束掃一次確定性標準(逐核心讀狀態與出處筆記,大庫耗時) |
| `ai` | 抓取套件之 `AI_SCHEMA` 各鍵 | 同抓取套件 | `timeoutMs`、`maxRetries`、`cooldownMs`、`providerTimeouts`、`extraProviders`、`pools`、`providerLimits` |
| | `healthStreak` | 3 | 供應商健康降序之門檻(連續幾次整組皆敗即降至鏈尾) |

`ai` 段不含 `parallel`:每輪之概念數由 `extract.perRun` 定,起草三席同時、其餘逐棒。

**容量自洽(啟動期警告)**:本套件不知道筆記之進料;他總組裝以 `extractWarningsOf(settings, { inflow:{ max, desc } })` 取「進料 > 容量」之警告(推導值 `extractCapacityOf`、式之說明 `EXTRACT_CAPACITY_DESC`)。已開啟之判定小組,其首兩席首選同家且無首選不同之第三席者,亦於啟動期警告(兩票恆為同一供應者,永遠判不成)。3+3 之席位語意提示(起草三席之首選是否三家不同、審計與終審是否與起草或整合同家)以 `extractSeatHintsOf(settings)` 取(只提示、不擋)。

**席位之形狀**:`{ use, fallback?, timeoutMs?, minAttemptMs?, budgetMs? }`——`use` 為條目 id、`fallback` 為條目 id 之陣列、數值鍵為正數(毫秒),其他鍵拋錯(3+3 之七席與判定小組各席逐席驗;規則取自抓取套件之 `seatProblem`)。預設詞彙中立(證據性質封頂、自承限制片語、推定詞與 `guide.extract` 皆不帶任何主題);面向使用者之字樣(待判之下一步、日誌之尾段)只指本套件與上游套件之 API。

---

## 6. 資料(`cfg.data.vocab`)

`cfg.data` 只收 `vocab`。詞彙表**整鍵替換**(給 `basisCaps` 就整組換),唯 `guide` 逐欄回退預設;不認得之鍵拋錯。與他段共用一份詞彙表者,以 `pickExtractVocab(vocab)` 取本套件所讀之鍵(`guide` 只取 `extract` 段)。**借用之鍵交擁有者驗**:主題範圍、稱呼、概念之改名與別名(抓取套件);分類清單、清單外分類之落點、內容類型、證據等級、最高證據等級之要件(摘要套件);關聯型別之定義(關聯套件)——規則與訊息只在擁有者。

| 鍵 | 預設 | 說明 |
|---|---|---|
| `domain`、`kbLabel` | `''` | 主題範圍、知識庫稱呼(各提示詞首句之稱呼;抓取套件之鍵) |
| `conceptRenames`、`conceptAliases` | `{}` | 概念鍵之改名與別名(選題之概念分群;與抓取套件同一折疊) |
| `claimTypes`、`evidenceLevels`、`evidenceRule` | 摘要套件之預設 | 內容類型、證據等級、最高證據等級之要件(摘要套件之鍵) |
| `evidenceCaps` | 理論模型封頂次高;實務經驗、教學示範、觀點評論、廠商內容封頂最低 | 核心主張證據等級之內容類型封頂 `{ 內容類型: 等級名｜位置整數 }`(0＝最高、1＝次高、-1＝最低);不給封頂表即「取出處最高」 |
| `basisCaps` | 只有「獨立驗證」可達最高;單一研究、理論、模擬、案例封頂次高;實務、教學、觀點、廠商、轉述封頂最低 | 核心主張之證據性質封頂 `{ basis 關鍵詞: 等級, '*': 皆不含時 }`(子字串比對、多詞取最嚴);鍵同時是規則表「證據性質擇自」之清單與核心 md 之語氣標記 |
| `inferenceBasis` | `['理論']` | 推論類之證據性質詞:出處支持覆核以此分判準(推論類須寫明所依前提) |
| `selfLimitPhrases` | 單一研究、同一研究、僅摘要、未經獨立驗證、未經驗證 | 核心主張之自承限制片語(含之即封頂次高) |
| `absolutePhrases` | 一定會、必然、總是、永遠…(15 詞) | 絕對語氣片語:新寫入之主張含之即計入指標(只計數、不擋) |
| `presumedBasis` | `null` | 推定之證據性質(須為 `basisCaps` 之鍵;`null`＝不推定) |
| `guide.extract` | 中立句 | 提示詞之領域句十欄(`EXTRACT_GUIDE_FIELDS`):`ruleTarget`(規則之落點)、`weakEvidence`(弱證據之說法)、`temporal`(時效之說明)、`narrowScope`／`broadScope`(出處支持覆核之範圍之例)、`reviseScope`(依出處收斂之範圍)、`opposedObjects`(爭議覆核之對象之例)、`sameExample`／`subtopicExample`／`siblingExample`(同義覆核之例) |
| 關聯型別之鍵 | 關聯套件之預設 | `relationTypes`、`conflictType`、`fallbackType`、`relationTypeRenames`、`relationTypeAliases`、`relationTypeRoles`(鍵集取關聯套件之 `RELATE_VOCAB_OWN_KEYS`)——獨立組裝時以之自建關聯 domain(衝突型與其舊名) |

**啟動期警告**:自訂 `claimTypes` 而未給 `evidenceCaps`(預設封頂表無一鍵對得上)者警告(`extractVocabWarningsOf`)。

---

## 7. 提示詞(三層覆寫)

輸出契約(欄位、格式、驗證)固定;覆寫的是「怎麼問」。覆寫者須依輸出契約要求模型輸出,否則其輸出會被驗證擋下。

1. **`vocab.guide.extract` 逐欄**:填回自己調校過之領域句即可逐字重現自己的提示詞,輸出契約仍隨套件演進。
2. **`cfg.prompts` 整個提示詞函數**(17 鍵;函數形式見 `EXTRACT_PROMPT_SIGS`):收原參數＋末參數 `ctx`(含 `defaultPrompt`——內建提示詞函數,可包裝而不必重寫):

   | 鍵 | domain 成員 | 回傳 |
   |---|---|---|
   | `propose`、`review`、`consolidate`、`essence`、`integrate`、`audit`、`revise`、`supportCheck`、`supportRevise`、`orphanCheck`、`disputeCheck`、`synonymPropose`、`synonymCheck` | `build<鍵>Prompt`(起草、終審、整併、本質、整合、審計、修訂、出處支持覆核、依出處收斂之修訂、失撐找支持、爭議覆核、同義提議、同義覆核) | 非空字串 |
   | `acceptAppendix` | `buildAcceptAppendix`(終審附錄:審計意見與修訂紀錄) | 字串(無附錄時合法回 `''`) |
   | `recheckText` | `buildRecheckText`(重審段) | 字串(無重審段時合法回 `''`) |
   | `withdrawnRule` | `withdrawnRule`(核心有出處已撤之條目時加入之條件規則) | 規則物件 `{ id, priority, text }` 或 `null` |
   | `rules` | `rules`(規則表;建構時套用一次,收內建規則表之複本) | 非空之規則陣列(id 不重複) |

   ```js
   createKnowledgeExtract({
       workDir,
       prompts: {
           propose: (input, ctx) => `${ctx.defaultPrompt(input)}\n（補充：…）`,
           rules: (defaultRules) => [...defaultRules, { id: 'myRule', priority: 9, text: '…' }],
       },
   })
   ```
3. **`cfg.domains.extract` 整組 domain**:成員表 `EXTRACT_DOMAIN_MEMBERS`(唯一一份)——資料成員(`kb`、`claimKinds`〔不可覆寫〕、`limits`、`rules`、`evidence`、`weakEvidence`、`evidenceRule`)與每輪無條件呼叫之函數必填;依功能而必填者(出處支持、失撐、爭議、同義覆核之提示詞)於該功能開啟時必填;選填者(本質、同義提議、依出處收斂之修訂、重審段、條件規則、分身轉址頁、內容鍵之版本)缺之即停用對應之步。建議以 `createExtractDomain({ vocab, prompts })` 之產物展開後覆寫;建構期驗其形狀(`extractDomainShapeProblems`)。同一 domain 不可同時給 `cfg.prompts`(給了即拋)。

**生效之 domain 只有一份**:`info().domains.extract` 即每輪 `deps.domains.extract`;維運 API、符合度掃描與評分取同一份。

---

## 8. AI 調度

- **預設席位全為免費模型**,兩家輪替(`oc:opencode/mimo-v2.6-flash-free`、`oc:opencode/big-pickle`):起草三席之首選依序為 mimo、big-pickle、mimo(只有兩家,故第三席與第一席同家;計票以實際成交之供應者計),整合、審計、修訂、終審之首選輪流,遞補為另一家;各席 `timeoutMs` 600000、`minAttemptMs` 90000。判定小組預設關閉。付費家請自行加在 `fallback` 尾端,或覆寫為自己評比選定之三家;各家於各棒之適任以評比為準(§15)。免費模型之目錄會隨供應方變動,實際可用之條目以 `opencode models` 之輸出為準。
- **工作流入口**:3+3 與各判定小組經調度層之 `getWkf()`(w-dispatch-ai 工作流之 `callAi`／`runFanout`)與 `seatSpec(seat, promptLen)`(依實際提示詞長度預篩遞補鏈、帶席位之逾時與預算)呼叫,每次呼叫後 `recordCall(r)` 計帳。內建調度層開 `workflow`;**注入之調度層須具 `getWkf`、`seatSpec`、`recordCall`**(建構期驗)。席位清單 `extractSeatsOf(settings)`、顯示名 `EXTRACT_SEAT_LABELS`;啟動期交調度層之 `validateSeats` 檢核(不可解析即拋)。
- **呼叫之單一包裝**(`extractAiCall`):截止感知(兩棒之間問 `shouldStop`;上游預算耗盡而剩餘不足一次嘗試、或棒回來時已到點,皆視同截止——本 pass 不套用、不計失敗,下輪再做;不走降級梯);各棒逐次給 `acceptTruncated:false`(差量、裁決與票皆為全有全無之物件);逐棒日誌(每次失敗之嘗試、成交、全鏈失敗)與 `aiCalls`／`aiAttempts` 計數。
- **單次嘗試之開工門檻**:席位未給 `minAttemptMs` 者,調度層以 min(20 秒, 單次逾時之一半) 為門檻——否則逾時設得短(預算不足 20 秒)之席位一次都不送出。
- **判定小組**(`extractPanelsOf(settings)`):first、second 並行(second 之項序打亂),未成立而可成立者叫 third;兩票明確、相同且**實際成交之供應者不同**才成立。全部受檢項皆缺票或同一供應者＝專步層之失敗(連續失敗次數記失敗帳、退避 1／2／4 天);部分缺票者逐項計次,逾 `maxTries` 轉使用者待判。
- **免費池額度**(`ai.pools`)、**健康降序**(`ai.healthStreak`,預設 3)、**能力預篩**(`ai.providerLimits`;內建調度層另計條目之固有上限):事件各以 WARN 一行寫入當輪日誌(「供應商額度：」「供應商健康：」「供應商能力：」;注入 `cfg.aiAdapter` 時不接)。失敗預覽不開(只作用於 `callJson`,本套件不經之)。
- **斷網不計(選用)**:`cfg.netGuard` 給本機網路判斷器(抓取套件之 `createNetGuard` 產物或同形之 `{ check, confirmDown, isDown, describe }`)時,整鏈皆敗之呼叫經其確認不通即標 `netDown`——該 pass 中止、不計失敗(日誌「因本機網路不通未完成」);本套件不內建探測,未給或 `null` 不判斷。
- CLI 型條目讀取哪些檔由 CLI 決定(會讀工作目錄上層之指示檔);要量不受其影響之能力,把 `aiWorkspace` 放在沒有這些檔之目錄樹。

---

## 9. 組裝與依賴(deps)

**每輪依賴**(總組裝每輪開啟後交入;只放可列舉之普通屬性):`{ stores, clock, dirs, data, vocab, locale, settings, ai, domains }`。套件子階段與自寫子階段同一條注入通道。

**子階段之依賴契約(只讀)**——他總組裝以自己之每輪依賴驅動 `createExtractObject` 者,依此給即可:

```
{ stores:{ notes, cores, relations, holds, checks, docs? }, clock, dirs:{ state, core, coreState? },
  settings:{ extract }, ai(getWkf、seatSpec、recordCall?), domains:{ extract, relate(conflictType、conflictTypeNames、resolveType) }, vocab? }
```

- 關聯 domain 必給(衝突之重審、衝突之去向 ES5 與關聯變更之影響 ES10 依之判定;缺即該輪寫入前拋)。`settings` 可另有他工作之段。
- `holds`／`checks` **必開**(判不了者須有處登錄、已檢者須有處記錄;缺之本輪任何寫入前即拋——`REQUIRED_STORES`);`docs` 選用(開啟者逐筆 `get`、無 `get` 之集合才整庫 `select`;未開即取筆記之欄位——選篇之發布年退樣本期末年、再退建立年,來源退筆記之 `sourceName`)。

**他總組裝共用提煉件**:`createExtractRuntime(cfg, settings, { vocab?, prompts?, domains?, relateDomain? })` → `{ data, vocab, locale, folds, domains:{ extract, relate }, warnings }`——資料與詞彙之解析、概念鍵之折疊、提煉 domain(內建工廠＋提示詞覆寫,或注入者之形狀檢核)、關聯 domain(他總組裝交其生效之一份,其成員之缺漏以關聯套件之 `relateDomainNeedsOf` 判;獨立組裝以關聯套件之工廠自建)、啟用之檢定標準所需之判定小組席位與 domain 成員之檢核、詞彙之警告,與本套件之總組裝同一份。`opt` 含其他鍵即拋(不認得之鍵);`opt.vocab` 須為安裝方原給之詞彙(詞彙之警告以之判)。容量警告不經本函數:以 `extractWarningsOf(settings, { inflow })` 取。本函數**不讀 `cfg.domains`、不檢 AI 調度層**:

```js
const rt = createExtractRuntime(cfg, settings, {
    vocab: pickExtractVocab(整份詞彙表),
    domains: <cfg.domains 中鍵在 EXTRACT_DOMAIN_KEYS 者> || {},
    relateDomain: <關聯之生效 domain>,
})
```

其餘提煉件之取法:集合鍵 `EXTRACT_STORE_KEYS`、資料鍵 `EXTRACT_DATA_KEYS`、目錄 `EXTRACT_DIRS` 與其展開 `resolveExtractDirs`、子階段之掛載鍵 `EXTRACT_TAP_STAGE_KEYS`、席位 `extractSeatsOf`、判定小組 `extractPanelsOf`、容量 `extractCapacityOf`、警告 `extractWarningsOf(settings, { inflow })`、保留時間 `extractReserveMs(settings)`、選題參數 `extractPickOf(settings)`、符合度掃描 `auditExtractStandards`(結果之形狀 `extractScanOf`、計數摘要取抓取套件之 `standardsCountsOf`,與本套件之總組裝同一份;AI 標準列之計法與材料讀取器取關聯套件之 `aiStandardRowOf`／`createMaterialReader`,材料之文字以本套件之 `extractMaterialOf` 注入)。

---

## 10. 擴充點

| 要做的事 | 作法 |
|---|---|
| 改某一環之行為 | `cfg.stageOpts.extract.tap`:動作鏈之錨點 before／after／replace(`loadState`、`selectNotes`、`pass`、`renderState`、`persistState`);錨點對不上者建構期即拋 |
| 換掉整條管線 | `cfg.stages` 給 `[{ name, run(ctx) }]`(與 `stageOpts` 擇一);可用匯出之子階段工廠 `stageExtract` 與各錨點之 `mw*` 自組,依賴一律走 `ctx.deps` |
| 他總組裝共用提煉件 | `createExtractRuntime`(§9);物件 `createExtractObject(opt)`(子階段之 opt 與總組裝之 `stageOpts` 同形;平鋪之 opts 只給 extract 子階段) |
| 核心 md 之版型 | `domains.extract.renderState`(整組 domain;機制鍵由提煉段寫);分身轉址頁之本文 `domains.extract.renderTwinRedirect` |
| 換儲存 | `cfg.lmdb.WOrm` 給相容之 ORM 建構函數 |
| 收尾通知／巡檢 | `cfg.afterRun({ report, summaryFile, log, deps })`(管線之外、摘要之後;失敗只記 WARN) |

---

## 11. 執行輸出

| 檔案 | 內容 |
|---|---|
| `<log>/<日>/<時間戳>-run.start.json` | 開工標記(本輪上限之宣告);取鎖之前寫入 |
| `<log>/<日>/<時間戳>-run.log` | 本輪日誌 |
| `<log>/<日>/<時間戳>-run.json` | 結構化摘要(管線名預設「知識提煉」〔`cfg.name` 可覆寫〕、段「提煉」與子階段之 report、AI 實績;掃描開啟時另有 `standards`) |
| `<core>/<核心 id>.md` | 核心 md(投影;分身為轉址頁) |
| `<coreState>/<核心 id>.state.json` | 核心狀態檔(真理) |
| `<state>/core/{prev,archive,manual,dirty}/` | 狀態檔之上一版、封存、被手改之 md 於覆寫前之另存、落盤中之標記 |
| `<state>/` 之帳檔 | 見 §12 |

段之摘要為固定格式(對外契約;`extractSummaryOf`):`概念 N、更新 N 則核心、消化 N 篇`,其後依序附(>0 才附)重審、撤出處、恢復、爭議覆核、出處支持覆核、存量覆核、失撐找支持、關聯影響、同義核對、降級、截止、超長、絕對語氣等段,句尾 `（AI N 次）`;有子階段失敗或自訂子階段時改為通用摘要。外部巡檢之正則退路依「更新 N 則核心」解析。

---

## 12. 資料契約

**核心記錄**(`cores`;`recordOf`):`id`、`concept`、`scope`(`'concept'`｜`'category'`)、`file`、`noteCount`(存活出處之篇數)、`noteIds`(已用過之筆記)、`version`、`rev`、`essence`(前綴「〔待重寫〕」表本質所引已被取代或撤回)、`updatedAt`、`proposedAt`、`status`(`'active'`)、`nextIdHigh`、`pendingReview`(待審數)。分身(同概念鍵之次核心;主核心落盤後處理)另有 `status:'merged'`、`mergedInto`、`mergedAt`、`archivedFile`,其 md 改寫為轉址頁。「核心已引」之唯一口徑為 `citedNotesOf(state)`;主核心之判定 `isMainCore`。

**核心狀態**(`stores/coreState`):主張(`kind` 四種、`text`、`basis`、`conditions`、`critique`、`pros`、`cons`、`sources`、`evidence`、`status`)、參數、爭議(各方 `sides`、存疑)、待解問題、本質、沿革、已撤出處(`withdrawn`;出處欄不動,存活出處由之衍生,還原即移除)、已見之衝突(`seenConflicts`)、待審。差量之套用 `applyDelta`(`stores/coreDelta`)、不變式 `checkInvariants`(落盤前必過)。

**待判(`holds`)與檢核紀錄(`checks`)之物件**(`EXTRACT_HOLD_OBJECTS`):

| 物件 | 值 | 標準 | oid |
|---|---|---|---|
| 筆記 | `extract-note` | ES15(逾限筆記)、ES9(新進覆核判不了之筆記) | `<核心 id>:<筆記 id>` |
| 爭議 | `dispute` | ES14 | `<核心 id>:<爭議 id>` |
| 主張 | `claim` | ES9 存量、ES8(`checks` 同名) | `<核心 id>:<主張 id>` |
| 兩核心 | `core-pair` | ES11(`checks` 同名) | `pairKeyOf(a, b)`(以「 ⇄ 」相接之無序鍵;`pairOfKey` 為其逆) |
| 核心 | `core` | 存量處置修不了者 | 核心 id |

期限一律 `extractHoldDeadlineOf`(30 天,不開放設定)。下一步(`EXTRACT_HOLD_NEXT`)與提示(`EXTRACT_API_HINT`)指處置 API:重送／重判／豁免＝抓取套件之 `requestRetry`／`waiveHold`(待判登錄為四工作同一機制);重設基準＝本套件之 `requestRebaseline`;出處懸空＝關聯套件之 `deleteNote`／`restoreNote`;缺集合(手建 deps)＝「每輪依賴之 stores 給 holds／checks 集合」。

**帳檔**(`dirs.state` 下;`EXTRACT_STATE_FILES` 彙集):失敗帳 `extract-attempts.json`(`ATTEMPTS_FILE`;鍵 `<scope>|<概念鍵>` 與專步之 `step|synonym`〔前綴 `EXTRACT_LEDGER_STEP_PREFIX`〕;計數欄 `tries` 與各專步之 `<專步>Tries`——外部巡檢判「連續失敗」以 `extractStuckOf(帳之內容, { min })` 取核心鍵與專步鍵,門檻預設 `EXTRACT_STUCK_TRIES`＝3,不另讀欄位)、內容鍵快取 `extract-content.json`、推定判定快取 `extract-notop.json`、邊庫快照 `extract-edges-seen.json`、影響帳 `extract-impact.jsonl`、影響之留待 `extract-impact-retry.json`、待審丟棄帳 `extract-pending-dropped.jsonl`、重設基準之名單 `extract-rebaseline.json`、重練意圖 `extract-regen.json`、同義提議之紀錄 `extract-synonym.json`。狀態檔之存取器單一工廠 `coreStoreOf(dirs)`、狀態檔目錄 `coreStateDirOf(dirs)`、附屬目錄 `coreAuxDirs(dirs)`。

---

## 13. 維運 API

皆為具名匯出。**寫入者由呼叫端負責取執行鎖(與管線互斥)、備份與同意**。

| 函數 | 寫入 | 做什麼 |
|---|---|---|
| `previewRecheck({ stores, dirs, domain, relateDomain, settings? })` | 否 | 預覽重審項(內容變更、新衝突、衝突被撤銷;開啟關聯變更之影響者另列關聯變更與夥伴) |
| `requestRebaseline(dirs, at, ids, { by })`、`rebaselineIdsOf(dirs, { onError, stamp })` | 是／否 | 指示下一輪以現值重設內容基準(大量格式變動而非內容修訂時;內容變更守門所指);讀名單(壞檔回 [] 並回報;給 `stamp` 者並隔離壞檔,不給只回報、不改檔) |
| `regenCore(stores, concept, { dirs, lockFile, staleMs, stamp, by, clock, dryRun })`、`listCores(stores)` | 是 | 打掉重練一個核心(刪核心記錄、封存狀態與 md、結案其未結待判並記重練意圖〔管線下一輪開工時清其失敗帳與影響留待〕——`stores.holds` 必給;下一輪以現有筆記從頭重練,筆記與其 `extractedAt` 不動;`lockFile` 給了即取鎖〔`staleMs` 為持鎖者未宣告陳舊期限時所用〕;`dryRun` 只回將封存之檔、將刪之記錄與將結案之待判,不寫)／列出核心 |
| `reviveClaims(deps, { core, ids, by, ruling, lockFile, staleMs })` | 是 | 還原可還原之撤回(存量覆核之「覆核無出處支持」、失撐之「出處已撤他篇無支持」)——使用者複核後裁示主張成立時;結案相關待判、寫檢核紀錄(使用者裁示)、記沿革;`lockFile`(`staleMs`)給了即取鎖。deps:`{ stores:{ notes, cores, holds, checks }, dirs, domain, clock?, log?, locale? }` |
| `planCoreStockFix(deps, { stds, ids, limit, material, at })` → `applyCoreStockFix(deps, plan, { material, at, ledgerFile, onRow })` → `verifyCoreStockChain(deps, rows)`;`rollbackCoreStockFix(deps, rows, { at, ledgerFile, acceptCurrent })`(回退＝撤銷:核心之版次仍＝處置後者才寫回,其後被改寫者報 `conflicts`、不覆寫;`acceptCurrent` 記取代列)、`readCoreStockLedger(file, { since, at, allowBad })` | apply／rollback 時 | 核心之存量處置(預演 → 套用 → 回驗;回退逐列):可確定性修正者修正並記處置帳(抓取套件之帳協定,四工作與宿主同一本帳;讀帳遇無法解析之列即拒,`allowBad` 才略過;失敗之件逐件隔離、記 `{ id, object, error }`),修不了者一核心一標準登錄使用者待判;`coreFixOf(state, ctx)` 為單一核心之修正;`edgeSeenSyncOf(dirs)` 掛於關聯之邊存量處置(邊庫快照同步) |
| `auditExtractStandards(deps, opt)` | 否 | 符合度掃描(§14) |

**待判之處置屬抓取套件**(待判登錄為四工作同一機制):列表、逾期、要求重試、豁免——`listHolds`、`overdueHolds`、`requestRetry(holds, id, { at })`、`waiveHold(holds, id, { by, ruling, at })`——自抓取套件取用,本套件不轉出。

**無逆操作之件(只有人工取回,沒有程式之逆)**:
- `regenCore` 之封存(`dirs.state/core/archive/<id>.state.json.regen-<時戳>`〔連 `.prev`〕與核心 md 之 `<id>.md.regen-<時戳>.md`)只供人工取回,沒有「取消重練」;意圖先記於 `extract-regen.json`,中斷即以同概念重跑續作(各步冪等),管線開工消化 `done` 之意圖、未完成者每輪 WARN。
- `settleTwins`(分身之併入:同鍵之分身併入主核心、分身 md 改為轉址頁、狀態封存、記錄 `mergedInto`):**併入後拆開＝自 v1 重練**(以 `vocab.conceptRenames` 拆折疊後對該概念 `regenCore`);分身之待判於下輪維護段清掃時結案(結案方式「已不適用：核心不在」)。
- `quarantine`(壞狀態檔之隔離:改名為 `dirs.state/core/archive/<id>.state.json.corrupt-<時戳>`、保留 `.prev`;以 `.prev` 救回者標 recovered 並立即落盤):取回法＝人工比對隔離檔與現值後以 `rollbackCoreStockFix` 之 `restore` 語意寫回(須持鎖),無 CLI;維護段單輪隔離逾 5 即熔斷(「提煉狀態檔熔斷」須見)。
- `cores` 記錄之 `archivedFile` 保留(人工取回封存之線索)。
- 核心狀態之 CAS 只保證「寫入者皆持共同鎖時」之序;不同行程不持鎖並寫者不在承諾內。

---

## 14. 檢定標準

`EXTRACT_STANDARDS`(`standards/registry.mjs`)一條一列:對象與入口、判定類別、能證明／不能證明、執行處、是否可存量掃描。逐件判定之標準(`CORE_STANDARDS`;`checkCore`)於新進之納入閘、落盤前之不變式與符合度掃描呼叫同一判定;ES8、ES9、ES11、ES14 之版本取自其判定模組(檢核紀錄據以判重檢)。

| id | 標準 | 類別 | 存量掃描 |
|---|---|---|---|
| ES1 | 不變式、外洩、長度硬上限 | 程式 | 是 |
| ES2 | 數字紮根於本條所引出處 | 程式 | 是 |
| ES3 | 正體 | 程式 | 是 |
| ES4 | 標注明示(銳評、利弊、期間、條件) | 程式 | 是 |
| ES5 | 已見之衝突有去向(兩端皆可引者) | 程式 | 是 |
| ES6 | 有效主張即須有本質,且本質非待重寫 | 程式 | 是 |
| ES7 | 語氣超出證據者依出處收斂措辭(併入 ES9 之修訂路徑) | AI | 否 |
| ES8 | 失撐條目待處置(出處筆記皆已刪除;找支持之專步為兩席,預設關) | 程式 | 是(另有 AI 列) |
| ES9 | 出處支持(新進定稿前、存量輪替;隔離待判者) | AI(兩席) | 是(AI 列) |
| ES10 | 關聯變更之影響逐事件有處置(預設停用) | 程式 | 否(處置寫影響帳) |
| ES11 | 同義概念不分立核心(兩席核對;預設關) | AI | 否(AI 列) |
| ES12 | principle 跨篇(相異文件 ≥2) | 程式 | 是 |
| ES13 | 弱證據參數須註明限制 | 程式 | 是 |
| ES14 | 爭議為真對立(兩席覆核;預設關) | AI | 否(AI 列) |
| ES15 | 逾限筆記有待判登錄 | 程式 | 是 |
| ES16 | 本質之數字紮根 | 程式 | 是 |
| ES17 | 主張文字不提及筆記 | 程式 | 否(納入閘為唯一執行處) |

- **符合度掃描(唯讀)**:`auditExtractStandards({ stores:{ notes, cores, relations?, holds?, checks? }, dirs, domain, relateDomain?, locale? }, { only, material, materialOf, onNote, maxIds, disputeCheck, nowMs })`:只掃主核心;狀態檔壞而無上一版者範圍內全部記未能判定;ES2／ES16 之材料三擇一(`materialOf` → `onNote` 全量 → 按需讀 md;`material:false` 者含數字記未能判定);ES5 須 `relations` 與 `relateDomain`;AI 列(ES8、ES9、ES11、ES14)列已檢、四態、版本過時與待判之未結／已豁免(ES8、ES9、ES11 取檢核紀錄,ES14 由核心狀態推得),另計受檢總量與到期數(`disputeCheck: { minVersions, waitDays }` 為 ES14 到期之門檻,`nowMs` 為到期判定之現在;ES14 恆有列,其餘來源集合未給者為 `null`,不報為零)。**管線每輪掃描**:`extract.standards.scanEachRun: true`——管線之後、執行摘要之前掃,計數入 `run.json` 之 `standards`(本輪已逾時間預算者略過,失敗只留 WARN)。
- **已見衝突之回頭檢查(ES5;維護段,無 AI)**:衝突入已見(`seenConflicts`)當下有去向,日後該結構可被拿掉(依衝突所立之爭議被拆解、被取代之主張或加條件之修正所依之主張被撤回)。管線每輪維護以符合度掃描、存量處置同一判定檢各主核心(概念層與類別層)之已見衝突:兩端皆為已消化存活筆記、無處置結構(不限版)、且未交衝突核對(關聯段之 RS4 待判,任一狀態)者,自已見移出(記帳欄位,不升版、不改提示詞與狀態檔格式),由重審項之新衝突重新呈現(概念層;類別核心無重審項,待下批觸及兩端時呈現),收尾走原有機制:起草處置、宣告非對立交衝突核對、逾 2 次未處置交衝突核對(有界)。待判集合未讀入時不處置。report 之 `detail.conflictReopened` 記移出之條數;日誌 INFO「提煉[概念]：N 條已見衝突之處置結構已消失（爭議拆解／取代／撤回），移出已見、下輪重新呈現（ES5）：甲 ⇄ 乙」(至多列 3 組)。升版後第一輪維護會移出現有之不合格邊,其後各核心於重審到期時各多一次僅重審 pass。
- **使用者豁免**:待判之 `waiveHold`(抓取套件);掃描把「不合格／未能判定而有豁免」計為已豁免並逐一列出——豁免是裁示,不是合格。豁免之鍵:條目層之待判(`claim`、`extract-note`)與核心層之待判(`core:<核心 id>:<標準>`——該核心該標準之全部判定)。
- **安裝方之逐案題組**:四個判定小組標準(ES9、ES8、ES14、ES11)之逐案題組與評分(§15)同形,頁組法 `esPagesOfCases`(`standards/esCases.mjs`;與正式之 `run*Check` 同一組法——項編號頁內重起、出處依頁內首次出現序以 id 去重)——安裝方以自己之題組以正式席位逐案測試時與評分同讀;指紋以抓取套件之 `benchPromptFpOf`(各頁「案 id＋提示詞」)算即與評分之 promptFp 相同。

---

## 15. 免費 AI 能力評分(十四角色;核心為抓取套件之 benchKit)

量的是本套件之 AI 呼叫點在**正式提示詞與正式判準**下之品質:單棒經 `extractAiCall`(工作流入口、正式之解析與驗證、`acceptTruncated:false`),起草三席之棒(起草、整併、本質)經 `extractFanout`(受測模型為第一席、其餘兩席為凍結腳本——只量受測席之候選);逐案之類別以正式之判定函數算出(票＝各判定模組之 `*VotesOf`;爭議之拆解欄位＝`dissolveUsableOf`;修訂＝補丁 → 守門 → 納入閘;提議＝`proposedCandidatesOf`;工作流類＝正式之 `normalizeIssues`、`gateVerdicts`＋`applyVerdicts`、`validateVia`＋`closeRefs`＋`droppedMajority`、`applyPatch`、`applyDelta`＋`coverageOf`／`checkInvariants`／`checkCore`)。失敗之逐次摘要附驗證失敗之不合格原因(抓取套件之 `callJsonShapeOf`,與 `callJson` 同字樣)。

| 角色(`--role`) | 對應 | 席位(設定) | 內建題組(`src/bench/cases/<id>-generic.json`) |
|---|---|---|---|
| `support-check` 出處支持覆核 | ES9 | `extract.standards.ai.{first,second,third}` | 16 案 |
| `support-revise` 依出處收斂之修訂 | ES9 之修訂路徑(題組 std／v 同 ES9,以角色欄分辨) | `extract.ai.revise` | 12 案 |
| `orphan-check` 失撐找支持 | ES8 | `extract.standards.ai.{first,second,third}` | 16 案 |
| `dispute-check` 爭議覆核 | ES14 | `extract.standards.ai.{first,second,third}` | 16 案 |
| `synonym-check` 同義覆核 | ES11 | `extract.standards.ai.{first,second,third}` | 16 案 |
| `synonym-propose` 同義提議 | ES11 | `extract.standards.ai.first` | 16 案 |
| `wf-audit` 審計 | 3+3 之審計 | `extract.ai.audit` | 16 案 |
| `wf-accept` 終審 | 3+3 之終審 | `extract.ai.accept` | 16 案 |
| `wf-pending` 待審裁決 | 待審裁決 | `extract.ai.accept` | 16 案 |
| `wf-integrate` 整合 | 3+3 之整合 | `extract.ai.integrate` | 16 案 |
| `wf-draft` 起草〔結構合規〕 | 3+3 之起草 | `extract.ai.drafters` | 16 案 |
| `wf-revise` 修訂〔結構合規〕 | 3+3 之修訂 | `extract.ai.revise` | 16 案 |
| `wf-consolidate` 整併〔結構合規〕 | 整併(起草席之整併模式) | `extract.ai.drafters` | 16 案 |
| `wf-essence` 本質〔結構合規〕 | 本質專步(起草席) | `extract.ai.drafters` | 16 案 |

```
node src/bench/cli.mjs [--role <角色 id|all>] [--lang <語言代碼>] [--models <id,…>|free] [--cases <題組 json>] [--vocab <詞彙 json> [--vocab-pick]] [--runs 2] [--out <目錄>] [--env <金鑰檔>] [--timeout <毫秒>] [--concurrency <n>] [--tz <IANA 時區>] [--board <評比表 csv>] [--batch <n>]
```

- **計分**:每案呼叫 `runs` 回,**各回之類別皆等於應然才算通過**(不以比率放行)。題組領域中立、合成材料、無網址與文獻,各案附 `why`。多角色之命令列規則為抓取套件之 `defineBenchRoles`(各套件同一份);角色 id 與題組檔名由角色定義導出(`EXTRACT_BENCH_ROLE_IDS`)。
- **工作流類**:案給合成之核心狀態(`esCases.coreStateOf` 之精簡描述)、材料與本批;**每案須於 `input.state.concept` 給概念名**(見下「自己的題組與詞彙」);`expect` 列模型須做到之謂詞,類別＝首個不成立之謂詞(皆成立為 `ok`)。第二批(起草、修訂、整併、本質)為**結構合規**——只驗格式、涵蓋與程式可判之性質,不驗是否抓到該抓之要點;評比表之角色欄標「〔結構合規〕」。
- **一席兩用取兩用之最低分**:`extract.ai.revise` 兼 `wf-revise` 與 `support-revise`、`extract.ai.accept` 兼 `wf-accept` 與 `wf-pending`——換席位時兩列皆須看,取低者。
- **`--batch`**:只限單一角色、且只 `support-check`／`support-revise`／`dispute-check`／`synonym-check` 收(每頁案數);`--role all` 給之即拋。**`--lang`**:本套件之參數(全部角色共用,`--role all` 亦可),語言設定同正式之 `cfg.lang`(輸出語言句與操作守門之字形政策);程式呼叫為 `opt.lang`。
- **免費額度**:`--role all` 每模型之呼叫數＝各角色之頁數×`runs`——判定類六角色 40 頁(出處支持 2、修訂 2、失撐 16、爭議 2、同義覆核 2、同義提議 16)＝80 次;工作流類八角色一案一頁,各 16 案共 128 頁＝256 次;合計 336 次(`runs` 2)。
- **自己的題組與詞彙**:`--cases` 給與內建同形之題組、`--vocab` 給詞彙物件之 JSON(只收本套件之鍵;與他段共用一份詞彙表者加 `--vocab-pick`)。**工作流類八角色(`wf-*`)自帶題組時,每案須於 `input.state.concept` 給概念名**(已有 `input.state` 者在其內加 `concept` 鍵):這八角色之正式提示詞皆含規則 1「只收與本概念直接相關之知識;離題之筆記列入 skipped」(審計之「離題」意見亦然),「離題」以概念名為準;未給時預設為「題組」(`ES_CASE_CONCEPT`),與合成材料全無關係,模型會把全部材料判為離題、得分失真。概念名須**涵蓋**該案應收錄、應接受、應判為捏造／重複／出處錯誤等之材料與操作及 `state` 內既有條目,**不涵蓋**應判「離題」者(中性日常主題,建議 4～10 字);缺、為空(含全空白)或明給「題組」之案於準備期(未呼叫 AI 前)即被拒,訊息指明欄名 `input.state.concept`。判定類六角色之提示詞無離題規則,不要求。程式呼叫:`runExtractBench(role, opt)`、`planExtractBench(role, opt)`(只備題、不呼叫 AI)、`runExtractBenchCli(argv)`。
- **評比表 `模型評比.csv`**:套件根之 `模型評比.csv` 為 `--board` 累積之評比表(現只有出處修訂、出處支持覆核、失撐找支持三角色之列)。`--board` 為一角色一模型一列,以本次覆蓋同角色同模型之舊列(命令列不擋自己之題組——以自己之題組評分時不給 `--board`,或指向自己之評比表;「題組」欄＝題組之 std 與 v,自己之同形題組之列只能以提示詞指紋分辨,`--vocab`、`--lang` 亦改變指紋)。CLI 型模型會讀 AI 工作目錄上層之指示檔,**量通用能力時 `--out` 放在任何專案之外**。
- **真 AI 測試**:`WK_LIVE_AI=1 node <mocha> test/api-extract-bench-ai.test.mjs`(每角色全題組、每案兩回;預設受測＝`extract.ai.drafters` 之 use 與 fallback;`WK_EXTRACT_MODELS`／`WK_EXTRACT_ROLES`／`WK_ENV_FILE`)。

---

## 16. 日誌與報告契約

`logContract.mjs` 為外部巡檢判讀提煉段之唯一來源(隨本套件之訊息與 report 一起改):

- `EXTRACT_LOG_KNOWN`:已知常態之 WARN 字樣(逐棒紀錄「提煉事件」、降級、投影補正、各 pass 之全鏈失敗「<pass>失敗（」、時間預算截止、本質未補成、同義提議席失敗、同義專步失敗、管線秩序之常態、調度層事件)——巡檢不當未知警告。
- `EXTRACT_LOG_MUST_SEE`:一律須見之字樣(不變式違反、被他處改動、本概念跳過、終審自相矛盾、待審逾上限、分身合併、手改另存、狀態還原、出處懸空、內容變更守門、維護失敗、提煉異常、帳檔寫入失敗、本機網路不通)——行內即使含已知字樣亦須列出。
- 刻意不列者(設定問題之提示:重設基準之名單檔不可讀、筆記找不到預設章節)即當未知警告呈現。
- `EXTRACT_LOG_PARSE`:執行摘要缺時之退路(段落完成行之概念數、更新之核心數、AI 次數;逐棒成交之棒與供應者;衝突交關聯段核對之條數)。
- `EXTRACT_REPORT_KEYS`:段名、子階段鍵、統計鍵、detail 之鍵全集(含條件鍵 `backlog`、`disabled`、`skippedForBudget`)。

以原始碼之全部 WARN／ERROR 發出點之歸類與真實執行之日誌、report 驗證(`unit-extract-log-contract`)。

---

## 17. 測試

在套件根執行(`package.json` 之 scripts 為 `test` 與 `deploy`):

```
npm test                                                        # mocha --parallel "test/*.test.mjs" --timeout 180000
node <mocha 路徑>/bin/mocha.js --timeout 180000 test/<檔名>      # 單檔
```

| 層 | 檔案 | 內容 |
|---|---|---|
| 設定與詞彙 | `unit-settings`、`unit-vocab`、`unit-extract-locale` | 設定與詞彙之逐鍵檢核、免費席位、判定小組、容量與警告;語言設定(`cfg.lang`)之落點 |
| 狀態與選題 | `unit-core-state`、`unit-core-store`、`unit-selection`、`unit-extract-files` | 主張庫之差量與不變式、狀態檔之存取與還原、選題與選篇、帳檔 |
| 工作流與段 | `unit-extract-{workflow,aicall,stage,lineage,notop,ops,failpaths}` | 3+3、呼叫之單一包裝、提煉段之各步、知識與關聯之變更、推定、維運 API;失敗與中斷之路徑 |
| 模組之直接案 | `unit-extract-direct` | 文字相似度、候選之投票與聯集、操作之分類與文字欄、回覆之形狀檢核、提示詞四件、內容雜湊、重審理由 |
| domain 與提示詞 | `unit-extract-{domain,prompts,golden,render,rules}` | domain 之成員與覆寫、17 鍵之提示詞、逐字契約(golden;中立基準之重產工具)、版型、規則表 |
| 檢定標準 | `unit-extract-{standards,opstandards,registry,audit,stockfix,support,orphan,dispute,synonym,irreversible}` | 各標準之純函數與入口、登記、符合度掃描、存量處置、各判定小組;不可逆操作之涵蓋表(撤銷與重新收件兩契約) |
| 物件與組裝 | `unit-extract-object`、`unit-extract-assembly`、`unit-extract-entry`、`unit-extract-package` | 物件之子階段序列與固定格式摘要;總組裝與執行期件之逐鍵檢核、domain 與提示詞、啟用功能之檢核、工作流入口、網路判斷、席位與調度層事件、每輪掃描;入口匯出;**套件邊界、依賴、發布面(不設 `exports`／`files`、不提供 `.npmignore`、`npm pack --dry-run` 之打包清單含 `sgud/` 與 `test/tools/`、`LICENSE`)、範例 `g.mjs` 離線可執行且 README 含其全文,與發布內容(含隨包發布之 `test/tools`)不帶宿主之痕跡、撞名、舊名、沿革與面向使用者之字樣(判準取抓取套件之 `test/tools/historyMarks`,四套件同一份)、預設領域中立、層序、區域同名件、測試檔之隔離與暫存根、橋接之發布後指定詞、本表與實際測試檔之對帳** |
| 契約與流程 | `unit-extract-log-contract`、`unit-flow-extract`、`unit-extract-contract`、`unit-extract-upstream-budget`、`unit-domain-terms` | 日誌字樣、正則與 report 鍵;真 LMDB 上四輪之完整流程;與摘要、關聯套件之資料契約;真上游之預算與斷網之歸類;領域中立之共用詞表 |
| 評分 | `unit-extract-bench`、`unit-bench-wf-concept`、`api-extract-bench-ai` | 評分角色、題組與頁組法;工作流類八角色題組之概念名與準備期守門(`unit-bench-wf-concept`);真 AI(`WK_LIVE_AI=1` 且給 `WK_BENCH_OUT` 才跑) |

- **固定埠**(≥8000、不隨機):8881 為無人監聽之埠(內建調度層之「整鏈皆敗」)、8882 為本機假 REST;8883～8889 保留。
- **暫存**:各測試自建 `test/_tmp/<名>-<pid>`,測完刪除(`test/tools/extractTestKit.mjs` 之 `tmpRoot`／`removeRoots`:以套件根定位、刪除後回驗)。唯一例外為真 AI 之評分測試 `api-extract-bench-ai`:AI 子行程之工作目錄與報表一律落 `WK_BENCH_OUT`(專案外之絕對路徑;CLI 型模型會讀工作目錄上層之指示檔),不寫 `test/_tmp`;工作目錄測完即刪、報表保留供人閱讀。
- **提示詞基準檔**(`test/golden/`):中立基準(`extract/`)以 `node test/tools/regen-golden.mjs` 重產——預設預演(列出會新增／改動之檔,不寫),`GOLDEN_WRITE=1` 才寫入;刻意改提示詞(須先以正式席位 A/B 驗證)才重產。覆寫重現(`extract-override/`,16 檔)不可重產:其真理源是中立化之前之實作之輸出(該實作已不在本套件),以現行實作重產即拿被測物自己的輸出當真理;只能逐字比對,確認某檔本身有誤才手改並逐行說明依據。
- 測試中之 AI 一律為替身或本機假端點,不連外網、不燒額度。
- **跨套件之介面以本套件一側之契約測試驗**:三套件之件經測試專用之橋接(`test/tools/{captureForTest,summarizeForTest,relateForTest}.mjs`)取得(套件程式碼不 import);領域中立掃描之詞表取抓取套件之 `test/tools/domainTerms.mjs`(經 `test/tools/captureForTest.mjs`;四套件同一份)。

---

## 18. 收斂到特定主題與整合

套件預設不限主題;要專注某一領域,只給資料與設定,不改程式。以天文學知識庫為例:

```js
createKnowledgeExtract({
    workDir: 'd:/astro-kb',
    data: {
        vocab: {
            kbLabel: '天文學知識庫', domain: '天文學',
            basisCaps: { 多站重現: 0, 單次觀測: 1, 理論: 1, 模擬: 1, 轉述: -1, '*': 1 },
            inferenceBasis: ['理論'],
            guide: {
                extract: {
                    ruleTarget: '可直接用於觀測規劃與資料處理的規則',
                    weakEvidence: '僅單次觀測或未經他站重現',
                    narrowScope: '單一天區、特定波段或觀測季',
                },
            },
        },
    },
    extract: { minNotes: 4 },
})
```

**整合進多工作之知識庫專案**(專案之設定檔頂層有 `ai`、`extract` 等段,各工作各佔一段):

| 專案端 | 本套件 |
|---|---|
| 設定檔之 `extract` 段 | 原樣給 `cfg.extract`(鍵與型別見 §5) |
| 設定檔之 `ai` 段 | 只挑 `EXTRACT_AI_SCHEMA` 之鍵給 `cfg.ai`——他工作之鍵(如併發數 `parallel`)會被拒收 |
| 共用之詞彙表(含他段之鍵) | `cfg.data.vocab = pickExtractVocab(詞彙表)`;要逐字重現既有之提示詞,把既有之領域措辭填回 `guide.extract` |
| 共用之 AI 調度狀態 | 建一個開工作流入口之調度實例,以 `cfg.aiAdapter` 注入各工作 |
| 共用一庫 | `lmdb.db`／`lmdb.cls` 對齊既有之庫名與集合名;`holds`、`checks`、`docs` 依既有之集合開啟 |
| 本機網路判斷 | 抓取套件之判斷器以 `cfg.netGuard` 注入(同一判斷器給各工作) |
| 他總組裝共用提煉件 | `createExtractRuntime(cfg, settings, { vocab: pickExtractVocab(…), domains: … || {}, relateDomain })`(§9;容量警告另以 `extractWarningsOf(settings, { inflow })`) |

---

## 19. 已知限制

- **「可驗證要點」不入起草之輸入**:摘要套件之筆記版型有此內容章,分節摘要(起草者所見)不讀之(檢定標準之材料則含之)。改為讀之即改變全部提示詞與內容鍵之版本,須以正式提示詞與正式席位之 A/B 驗證有效後才改;契約測試(`unit-extract-contract`)釘住現況,摘要之版型新增內容章而本套件未讀即失敗。
- **主張之「空話」(形式齊全而無可操作內容)無確定性判準、無標準**:審計席判為空話者只能交修訂(建設性操作不得因空話移除),修不成則保留原稿;要立標準須比照出處支持覆核建 AI 判定小組與題組(每條主張兩席呼叫),屬安裝方之決定。
- **不做 AI 狀態落檔**:游標、冷卻、用量皆在行程內(排程每輪新行程;冷卻短於排程週期)。
- **內建提示詞、規則表與核心版型為繁體中文**:`lang` 只換覆核類提示詞之理由語言句與字形政策,不翻譯提示詞本體與章名(整份可經 `cfg.prompts` 覆寫;章名為契約 `CORE_SECTION_TITLES`);字形標準只有臺灣正體一種,其他語言之 ES3 列不適用。文字相似度之比對前折疊固定折向正體(非中文文字為不動點)。
- **選題與排序以字碼序(抓取套件之 `cmp`)而非語系規則**:跨機器、跨 ICU 版本之結果一致;id 與時刻字串之序與語系無涉,概念鍵之序只作同分之決勝。
- **各棒之驗證只驗外層之鍵為陣列**:逐操作之把關在下游之守門與納入閘;未觀察到漏網。
- **席位未設或提示詞放不下之棒亦計入 `aiCalls`／`aiAttempts`**:正式席位恆設、放不下罕見;改即改計數之語意。
- **注入之調度層須具 `recordCall`**:提煉之呼叫包裝以選用呼叫之(子階段自組之測試替身可缺),總組裝則要求具備——缺之用量計帳即靜默失效。
- **評分之 `--board` 只該收內建通用題組之結果**:命令列不擋(各套件同此契約);以自己之題組評分時不給 `--board`。
- **評分以嚴格之詞彙解析建 domain**:與他段共用一份詞彙表者須加 `--vocab-pick`(取子集);修訂角色之題組只收新增主張與爭議之一方兩種;爭議題組之「另立主張」只在不另立(`toClaim:false`)時可帶既有主張。
- **評分為單席視角**:判定類之評分只量第一席所見(題組序);正式之判定小組第二席項序打亂、未成立者叫第三席——位置效應與成對成立未量。
- **起草三席之棒只量受測席**:其餘兩席為凍結腳本(合法之空差量),整合、審計等後段不隨之執行——起草之評分不含整合之效果(整合另有 `wf-integrate`)。
- **工作流類第二批為結構合規**:起草、修訂、整併、本質之謂詞只驗程式可判之性質;內容是否抓到要點、精簡是否忠實不可由程式判定。
- **管線層之「逾時間預算」只在多工作之管線出現**:提煉為末段,前段耗盡整輪預算時管線不開工提煉段;獨立組裝之提煉段自身以 `minRemainingMs` 守門(INFO)。
- **刻意之差(設計,非缺陷)**:單份候選仍過 `_trial` 試套之濾;待審裁決經與終審同一份驗證(目標以現狀重分類);`ops` 之還原撤回與確定性修正不過守門(過不變式);整併／本質之終審失敗整份不套;專步之席位預算不走 `drafters` 鏈;ES8 一案一頁;評分單席不遞補、逐案兩回;派生快取重建;影響帳之重放可有重複列;`perRun` 之單位(爭議＝項、存量＝項、失撐＝項、同義＝對);待判期限 30 天;`renderTwinRedirect` 為選填(整組置換之 domain 可缺則用內建版型);`export *` 之公開面。
- **已知而未改(改即行為變更,須 A/B 或另案)**:狀態摘要之待審段不可逆清單缺「拆分」(由 `TERMINAL_OPS` 產生即多一詞——提示詞變更);ES3 之存量掃描欄位集未含理由類欄(`statusNote`、沿革說明)而新進閘檢全部文字欄;`checkCore` 對隔離／失撐之參數整條跳過而 `coreFixOf` 照修、ES1 之受檢範圍含已結案而 ES3 不含;`@ref` 之文字欄集於換號(5／4 欄)與 `REF_FIELDS.texts`(9 欄)不同;重審項兩端皆被引用時以 `createdAt` 字串比較選呈現端(混合時區);`standards/holdSettle` 取整包本段環境且 `sweepStaleHolds → env.stateCache → maintainCores` 隱性耦合;專步排程以閉包序列而非表驅動;`domain/prompts` 之匯出函數直接呼叫時須自給 `ctx.kb`。
