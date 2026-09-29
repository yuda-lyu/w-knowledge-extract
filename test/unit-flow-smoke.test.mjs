// unit-flow-smoke.test.mjs — 端到端冒煙:近零注入跑 createKnowledgeExtract 完整兩輪
//
// 注入僅四處,且每一處都是套件宣稱的正當擴充口(冒煙同時驗證這些口):
//   ①fetchers 同 id 置換(rss/article 換成 stub,避免真網路)
//   ②aiAdapter 整組置換(stub callAI,避免燒額度)
//   ③plugins 跨階段掛載(驗證插件真的被執行)
//   ④domains 頂層注入(關聯 domain 包一層計數,prompt 仍為內建:驗證管線實際使用 cfg.domains,不只反映在 info())
// 其餘全走內建預設:真 prompt/真版型/真 LMDB/真鎖/真索引。
// 執行:npx mocha test/unit-flow-smoke.test.mjs(暫存落 test/_tmp/flow-smoke-<pid>,測完即刪)

import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import WKE from '../src/WKnowledgeExtract.mjs'
import { setConceptFold } from '../src/util/text.mjs'

const ROOT = path.resolve(`test/_tmp/flow-smoke-${process.pid}`) // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除

const LONG = '梯度下降以學習率控制每步更新幅度，實務常用學習率衰減以穩定收斂。'.repeat(20)
const silentLog = { info: () => {}, warn: () => {}, error: () => {}, file: '', now: '', elapsed: () => '0.0', cliFail: () => '' }

// ── stub AI:triage/extract、relate、提煉之提案與審查的回應以 check 相容性自動配對(形狀互斥:前兩者為陣列,提案帶 ops、審查帶 verdicts)──
const extractData = [
    { index: 1, relevant: true, title: '學習率決定梯度下降步長', key_points: ['更新量＝學習率×梯度'], concepts: ['梯度下降'], summary: '更新量＝學習率×梯度。', category: '方法與技術', claim_type: '理論模型', evidence_level: '中', explore: [{ type: 'keyword', value: '學習率排程', why: '測試線索' }] },
    { index: 2, relevant: true, title: '學習率衰減穩定收斂', key_points: ['學習率衰減犧牲初期速度換取收斂穩定'], concepts: ['梯度下降'], summary: '學習率衰減犧牲初期速度換取收斂穩定。', category: '方法與技術', claim_type: '理論模型', evidence_level: '中' },
]
const relateData = [{ index: 1, relations: [] }, { index: 2, relations: [] }]
const proposeData = {
    ops: [
        { op: 'add', ref: 'a', kind: 'principle', text: '學習率決定梯度下降之步長，衰減以初期速度換取收斂穩定', basis: '理論', sources: ['N1', 'N2'] },
        { op: 'essence', text: '梯度下降以學習率控制每步更新幅度', claims: ['@a'], reason: '首版' },
    ],
    skipped: [],
}
const reviewData = { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep' }] }
let aiCalls = 0
const distillCalls = []
const aiAdapter = {
    callJson: async (prompt, check, opt) => {
        aiCalls++
        for (const d of [extractData, relateData, proposeData, reviewData]) {
            if (check(d)) {
                if (d === proposeData || d === reviewData) distillCalls.push({ kind: d === proposeData ? 'propose' : 'review', acceptTruncated: opt?.acceptTruncated })
                return { ok: true, data: d, error: '', skipped: false, attempts: 1, preview: '', providerId: 'stub' }
            }
        }
        return { ok: false, data: null, error: 'stub 無匹配形狀', skipped: false, attempts: 1, preview: '' }
    },
    recordCall: () => {},
    drainStats: () => '無呼叫',
    aiUsageToday: () => ({ today: '', used: 0, byKey: {}, chain: '', providers: [], skipped: [] }),
}

// ── 插件:於 fetchDetail 與預篩落帳之後各掛一顆計數 mw(驗證跨階段插件真的執行;預篩掛點曾被總組裝靜默丟棄)──
let pluginHits = 0
let triagePluginHits = 0
const countingPlugin = {
    'name': 'smoke-counter',
    'fetch.detailFetch.fetchDetail': {
        after: [WKE.defineMw({
            name: 'smokeCount',
            handle: async (m, c, n) => {
                pluginHits++; return n(m)
            }
        })],
    },
    'organize.triage.settleTriage': {
        after: [WKE.defineMw({
            name: 'smokeTriageCount',
            handle: async (m, c, n) => {
                triagePluginHits++; return n(m)
            }
        })],
    },
}

// ── 頂層 domains 注入:包一層計數的內建關聯 domain ──
let relatePromptCalls = 0
const builtinRelate = WKE.createRelateDomain({})
const countingRelate = {
    ...builtinRelate,
    buildPrompt: (targets, candidateMap) => {
        relatePromptCalls++
        return builtinRelate.buildPrompt(targets, candidateMap)
    },
}

describe('unit-flow-smoke', function() {

    let flow = null
    let rep = null
    let afterRunRan = false
    let afterRunSaw = null

    before(async function() {
        fs.rmSync(ROOT, { recursive: true, force: true })
        flow = WKE.createKnowledgeExtract({
            workDir: ROOT,
            data: {
                seedSources: [{ kind: 'rss', tier: 1, name: 'Stub 來源', url: 'https://example.com/feed', lang: '' }],
            },
            // 同 id 置換內建抓取器(套件宣稱的正當擴充口)
            fetchers: [
                {
                    id: 'rss',
                    kinds: ['rss'],
                    fetch: () => [
                        { url: 'https://example.com/a1', title: '梯度下降與學習率', time: '2026-08-20', summary: LONG.slice(0, 400) },
                        { url: 'https://example.com/a2', title: '學習率衰減的收斂控制', time: '2026-08-20', summary: LONG.slice(0, 400) },
                    ]
                },
                { id: 'article', role: 'detail', match: () => true, fetch: () => ({ ok: true, text: LONG }) },
            ],
            aiAdapter,
            plugins: [countingPlugin],
            domains: { relate: countingRelate },
            // 提煉以內建預設走完一輪(真 prompt、真狀態檔、真 LMDB 記錄):兩篇同概念即成新核心
            // (本冒煙之時間預算僅 60 秒,開工門檻歸零)
            knowledge: { distillMinNotes: 2, distillRelateGraceDays: 0, distillMinRemainingMs: 0 },
            deadlineMs: 60_000,
            logFactory: () => silentLog,
            // 收尾鉤子在管線之外、摘要之後被呼叫:巡檢(預設收尾)須讀得到當輪 run.json
            afterRun: ({ summaryFile, report }) => {
                afterRunRan = true
                afterRunSaw = { summaryExists: !!summaryFile && fs.existsSync(summaryFile), stages: report?.stages?.length }
            },
        })
        rep = await flow.run()
    })

    after(function() {
        fs.rmSync(ROOT, { recursive: true, force: true })
        setConceptFold(null) // createKnowledgeExtract 會注入模組級 opencc 折疊,不留給同 worker 之他檔
    })

    it('第一輪:管線整體成功、五段全 ok、收尾不在管線階段內', function() {
        assert.equal(rep.ok, true, '管線整體須成功')
        assert.deepEqual(rep.stages.map((s) => s.name), ['抓取', '彙整', '關聯', '提煉', '索引'], '收尾不再是管線階段')
        assert.ok(rep.stages.every((s) => s.status === 'ok'), '五段全 ok')
    })

    // 【子階段層級的斷言】段狀態 ok 只代表物件沒拋錯——子階段失敗會被 onError:'continue'
    // 吸收,段照樣 ok。必須逐一驗子階段 report.ok,否則「每輪都失敗但看起來正常」這類靜默失效會逃過冒煙
    it('第一輪:各子階段 report.ok 皆非 false,段摘要不含 undefined 或失敗字樣', function() {
        for (const st of rep.stages) {
            const sub = st.result?.detail
            if (!sub || typeof sub !== 'object') continue
            for (const [name, r] of Object.entries(sub)) {
                if (r && typeof r === 'object' && 'ok' in r) {
                    assert.notEqual(r.ok, false, `子階段[${st.name}.${name}] 失敗:${r.summary || ''}`)
                }
            }
            assert.doesNotMatch(String(st.result.summary || ''), /undefined|失敗：/, `段[${st.name}] 摘要不得含 undefined 或失敗字樣:${st.result.summary}`)
        }
    })

    it('第一輪:收尾鉤子於 run.json 落地後執行、跨階段插件被執行', function() {
        assert.equal(afterRunRan, true, '收尾鉤子須執行')
        assert.deepEqual(afterRunSaw, { summaryExists: true, stages: 5 }, '收尾鉤子被呼叫時當輪 run.json 已落地、且收到完整 report')
        assert.ok(pluginHits >= 2, `插件掛載須被執行(fetchDetail 後;實得 ${pluginHits})`)
        assert.equal(triagePluginHits, 2, `插件掛於 organize.triage 須被執行(每篇預篩落帳後一次;實得 ${triagePluginHits})`)
        assert.ok(aiCalls >= 2, `AI stub 須被呼叫(預篩＋萃取＋關聯;實得 ${aiCalls})`)
        assert.ok(relatePromptCalls >= 1, `關聯段須使用頂層注入之 domain(實得 ${relatePromptCalls} 次)`)
        assert.equal(flow.info().domains.relate, countingRelate, 'info() 回傳生效之同一 domain')
    })

    it('第一輪:抓取與彙整摘要格式保真(巡檢之正則退路依此解析)', function() {
        const fetchRep = rep.stages.find((s) => s.name === '抓取').result
        assert.match(fetchRep.summary, /來源 1 個、新文件 2、素材 2、轉錄 0、放棄 0｜線索消化/, '抓取摘要格式保真(巡檢契約)')
        const orgRep = rep.stages.find((s) => s.name === '彙整').result
        assert.match(orgRep.summary, /處理 2、新知識 2、略過 0、線索 1（AI 1 次）/, '彙整摘要格式保真')
    })

    it('第一輪:內建版型與索引生效、0 邊不重寫關聯總覽、執行鎖已釋放', function() {
        const noteFiles = fs.readdirSync(path.join(ROOT, 'knowledge/notes')).filter((f) => f.endsWith('.md'))
        assert.equal(noteFiles.length, 2, '兩篇 stub 文件應各成一篇筆記')
        const noteMd = fs.readFileSync(path.join(ROOT, 'knowledge/notes', noteFiles[0]), 'utf8')
        assert.ok(noteMd.includes('品質與證據標注') && noteMd.includes('內容類型：理論模型'), '內建版型須生效')
        const idx = fs.readFileSync(path.join(ROOT, 'knowledge/index.md'), 'utf8')
        assert.match(idx, /^---\ntitle: "知識庫索引"\ntype: "index"\n/, '內建索引標題(領域中立)與 frontmatter 格式')
        assert.ok(!fs.existsSync(path.join(ROOT, 'knowledge/relations/graph.json')), '0 邊時不重寫關聯總覽')
        assert.ok(!fs.existsSync(path.join(ROOT, 'tmp/run.lock')), '執行鎖須已釋放')
    })

    it('第一輪:結構化執行摘要(run.json)落地且帶各子階段 report', function() {
        assert.ok(rep.summaryFile && fs.existsSync(rep.summaryFile), `run.json 須寫入 log/<day>/：${rep.summaryFile}`)
        const summary = JSON.parse(fs.readFileSync(rep.summaryFile, 'utf8'))
        assert.deepEqual(summary.stages.map((s) => s.name), ['抓取', '彙整', '關聯', '提煉', '索引'])
        assert.equal(summary.stages[0].sub.listFetch.detail.newDocs, 2, '摘要須帶各子階段 report 之 detail')
        assert.equal(summary.stages[1].sub.extract.detail.notes, 2)
        assert.equal(summary.stages[1].sub.extract.detail.tagSuspect, 0, '可疑標籤計數進子階段 detail(本冒煙之標籤皆正常)')
        assert.equal(summary.ok, true)
        assert.ok(Number.isFinite(summary.deadlineMs), '摘要帶本輪時間預算')
    })

    it('第一輪:提煉(2.0)以內建預設成核心——狀態檔為真理、md 與索引為投影;提案與審查皆單次呼叫且截斷一律換家', function() {
        assert.deepEqual(distillCalls.map((c) => c.kind), ['propose', 'review'])
        assert.ok(distillCalls.every((c) => c.acceptTruncated === false))
        const coreFiles = fs.readdirSync(path.join(ROOT, 'knowledge/core')).filter((f) => f.endsWith('.md'))
        assert.equal(coreFiles.length, 1)
        const md = fs.readFileSync(path.join(ROOT, 'knowledge/core', coreFiles[0]), 'utf8')
        assert.match(md, /stateFormat: 2/)
        assert.match(md, /〔C1〕學習率決定梯度下降之步長/)
        assert.match(md, /## 本質\n\n梯度下降以學習率控制每步更新幅度（依〔C1〕）/)
        const stateFiles = fs.readdirSync(path.join(ROOT, 'knowledge/core')).filter((f) => f.endsWith('.state.json'))
        assert.deepEqual(stateFiles, [coreFiles[0].replace(/\.md$/, '.state.json')], '狀態檔與核心 md 同目錄同名')
        const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/core', stateFiles[0]), 'utf8'))
        assert.deepEqual([st.version, st.rev, st.consumed.length, st.claims[0].sources.length], [1, 1, 2, 2])
        const dist = rep.stages.find((s) => s.name === '提煉').result
        assert.match(String(dist.summary || ''), /概念 1、更新 1 則核心、消化 2 篇（AI 2 次）/, '提煉段摘要(「更新 N 則核心」為巡檢日誌正則之契約)')
        const idx = fs.readFileSync(path.join(ROOT, 'knowledge/index.md'), 'utf8')
        assert.match(idx, /梯度下降以學習率控制每步更新幅度/, '索引列出核心本質')
    })

    it('第二輪:去重(不重複產筆記)與 relatedAt 持久化(不重關聯同批筆記);已用過之筆記不再提煉', async function() {
        const n0 = distillCalls.length
        const rep2 = await flow.run()
        assert.equal(rep2.ok, true)
        assert.equal(fs.readdirSync(path.join(ROOT, 'knowledge/notes')).filter((f) => f.endsWith('.md')).length, 2, '重跑不得重複產筆記')
        const rel2 = rep2.stages.find((s) => s.name === '關聯').result
        assert.equal(rel2.detail.relate.detail.targets, 0, 'relatedAt 已持久化——第二輪不得重關聯同批筆記')
        assert.equal(distillCalls.length, n0, '無新筆記:不呼叫提煉')
    })

})
