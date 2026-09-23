# w-knowledge-extract
A general-purpose pipeline for fetching, extracting, relating and distilling knowledge.

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

    //workDir, 知識庫根目錄(唯一必填): db/log/state/knowledge 等皆由此展開
    let workDir = './_test_knowledge_extract'
    fs.rmSync(workDir, { recursive: true, force: true })

    //items與pages, 模擬來源之文章清單與內文頁, 實務上由內建 rss/grid/article 抓取器連網取得
    let items = [
        { url: 'https://example.com/post/checkpointing', title: '以梯度檢查點換取訓練記憶體', time: '2026-09-01' },
        { url: 'https://example.com/post/mixed-precision', title: '混合精度訓練之記憶體與速度取捨', time: '2026-09-02' },
    ]
    let pages = {
        'https://example.com/post/checkpointing': '梯度檢查點只保存部分層之激活值，反向傳播時重算其餘層，以約三成額外計算換取大幅降低之激活記憶體。'.repeat(8),
        'https://example.com/post/mixed-precision': '混合精度以半精度進行前向與反向計算並保留單精度主權重，搭配損失縮放避免梯度下溢，可降低記憶體並加速訓練。'.repeat(8),
    }

    //notesOf, 模擬萃取結果(依標題對應), 實務上由 AI 依內建萃取 prompt 產出
    let notesOf = {
        '以梯度檢查點換取訓練記憶體': { title: '梯度檢查點以重算換記憶體', category: '方法與技術', summary: '只保存部分激活值，反向時重算其餘層。', key_points: ['以約三成額外計算換取激活記憶體大幅下降'], concepts: ['訓練記憶體優化', '梯度檢查點'], claim_type: '實務經驗', evidence_level: '中' },
        '混合精度訓練之記憶體與速度取捨': { title: '混合精度訓練之取捨', category: '方法與技術', summary: '半精度計算搭配單精度主權重與損失縮放。', key_points: ['損失縮放可避免梯度下溢'], concepts: ['訓練記憶體優化', '混合精度'], claim_type: '實務經驗', evidence_level: '中' },
    }

    //answer, 模擬 AI 回應: 依 prompt 種類(預篩/萃取/關聯)回傳固定之 JSON, 實務上為內建 AI 調度層(w-dispatch-ai, 金鑰放 workDir/.env)
    let answer = (prompt) => {
        if (prompt.includes('的預篩器')) {
            let n = Number((prompt.match(/以下 (\d+) 篇/) || [])[1]) || 0
            return Array.from({ length: n }, (_, i) => ({ index: i + 1, relevant: true, reason: '含方法論' }))
        }
        if (prompt.includes('的萃取器')) {
            return [...prompt.matchAll(/--- 第(\d+)篇 ---\n標題：(.*)/g)].map((m) => ({ index: Number(m[1]), relevant: true, ...notesOf[m[2]] }))
        }
        if (prompt.includes('的關聯建立器')) {
            return prompt.split(/--- 第\d+篇（待建立關聯）---/).slice(1).map((block, i) => {
                let to = (block.match(/- slug: (\S+)｜/) || [])[1]
                return { index: i + 1, relations: to ? [{ to, type: '互補搭配', reason: '兩者皆為降低訓練記憶體之手段，可併用' }] : [] }
            })
        }
        return null
    }

    //aiAdapter, 以 AI 調度層替身取代內建(cfg.aiAdapter 為正當擴充口, 測試與離線示範皆走這裡)
    let aiAdapter = {
        callJson: async (prompt, check) => {
            let data = answer(prompt)
            if (data && check(data)) {
                return { ok: true, data, error: '', skipped: false, attempts: 1, preview: '' }
            }
            return { ok: false, data: null, error: '無對應回應', skipped: false, attempts: 1, preview: '' }
        },
        //提煉工作流(fanout 起草 → 整合 → 審計鏈)之替身: 直接回傳定稿
        getWkf: () => ({
            runFanoutPipeline: async ({ callOpt }) => {
                callOpt.onEvent({ type: 'try' }) //真實工作流每次呼叫供應商皆發 try 事件, 提煉據此計 AI 次數
                return {
                    ok: true,
                    totalMs: 1,
                    result: { essence: '訓練記憶體主要耗在激活值與權重精度，可用重算或降精度換取。', principles: ['以計算換記憶體', '以精度換記憶體'], rules: ['若激活記憶體不足則先開梯度檢查點'] },
                }
            },
        }),
        withBudget: (seat) => seat,
        recordCall: () => {},
        drainStats: () => '',
        aiUsageToday: () => ({ today: '', used: 0, byKey: {}, chain: '', providers: [], skipped: [] }),
    }

    //flow, 總組裝: 內建 prompt/版型/LMDB/鎖/索引全走預設, 只置換抓取器與 AI 調度層
    let silent = { info: () => {}, warn: () => {}, error: () => {} }
    let flow = createKnowledgeExtract({
        workDir,
        data: {
            seedSources: [{ kind: 'rss', tier: 1, name: '範例部落格', url: 'https://example.com/feed', lang: 'zh' }],
            vocab: { domain: '機器學習' }, //主題範圍(選填), 預篩/萃取/關聯/提煉之 prompt 據此限定, 未給即不限主題
        },
        fetch: { minSourceIntervalMs: 0 }, //設定覆寫(逐鍵): 同一來源最短重抓間隔預設 6 小時, 此處設 0 使第二輪即重抓以展示去重
        fetchers: [
            { id: 'rss', kinds: ['rss'], fetch: () => items }, //同 id 置換內建 rss 抓取器
            { id: 'article', role: 'detail', match: () => true, fetch: (doc) => ({ ok: true, text: pages[doc.url] }) }, //置換內建正文抓取器
        ],
        aiAdapter,
        deadlineMs: 3600000, //整輪時間預算(實務上給 scheduleLimitMin 由排程上限推導)
        afterRun: false, //停用收尾巡檢(預設每輪寫監控紀錄 md)
        logFactory: () => silent, //靜音日誌(預設每輪寫 log/<day>/<stamp>-run.log)
    })

    //run, 第一輪: 抓取 → 彙整(預篩→萃取) → 關聯 → 提煉 → 索引
    let r1 = await flow.run()
    ms.push({ round1: `ok[${r1.ok}], ` + r1.stages.map((s) => `${s.name}[${s.status}]`).join(', ') })
    for (let s of r1.stages) {
        ms.push({ [s.name]: s.result.summary })
    }

    //knowledge, 產出之知識 md(筆記/核心/關聯總覽/索引)
    let notes = fs.readdirSync(`${workDir}/knowledge/notes`).filter((f) => f.endsWith('.md'))
    let cores = fs.readdirSync(`${workDir}/knowledge/core`).filter((f) => f.endsWith('.md'))
    ms.push({ files: `筆記 ${notes.length} 篇, 核心 ${cores.length} 則, 關聯總覽 ${fs.existsSync(`${workDir}/knowledge/relations/graph.json`)}` })
    let index = fs.readFileSync(`${workDir}/knowledge/index.md`, 'utf8')
    ms.push({ index: index.split('\n').find((l) => l.startsWith('- 知識筆記')) })

    //run, 第二輪: 重抓同一來源但文章皆已抓過(去重不入庫), 筆記已關聯(relatedAt 持久化), 核心無新筆記(不重提煉)
    let r2 = await flow.run()
    ms.push({ round2: r2.stages.slice(0, 4).map((s) => `${s.name}: ${s.result.summary}`) })

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
//   { round1: 'ok[true], 抓取[ok], 彙整[ok], 關聯[ok], 提煉[ok], 索引[ok]' },
//   { '抓取': '來源 1 個、新文件 2、素材 2、轉錄 0、放棄 0｜線索消化 0、新來源 0' },
//   { '彙整': '處理 2、新知識 2、略過 0、線索 0（AI 1 次）｜預篩 2 篇放行 2（AI 1 次）' },
//   { '關聯': '處理 2、關聯 2 條、衝突 0 組（AI 1 次）' },
//   { '提煉': '概念 1、更新 1 則核心（AI 1 次）' },
//   { '索引': '筆記 2、核心 1、關聯 2' },
//   { files: '筆記 2 篇, 核心 1 則, 關聯總覽 true' },
//   { index: '- 知識筆記 2 篇｜核心知識 1 則｜關聯 2 條' },
//   {
//     round2: [
//       '抓取: 來源 1 個、新文件 0、素材 0、轉錄 0、放棄 0｜線索消化 0、新來源 0',
//       '彙整: 處理 0、新知識 0、略過 0、線索 0（AI 0 次）',
//       '關聯: 處理 0、關聯 0 條、衝突 0 組（AI 0 次）',
//       '提煉: 概念 0、更新 0 則核心（AI 0 次）'
//     ]
//   }
// ]
```
