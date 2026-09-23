// unit-guide.test.mjs — prompt 領域句欄位化(vocab.guide／kbLabel)、頂層 domains 注入、標題推導、網格 arXiv 類別拆分
//
// 規格來源:安裝方提議〈建議 w-knowledge-extract 調整〉§3.2～§3.5 與主代理評估之修正(2026-09-23):
//   ①未設定任何欄位時 prompt 與 1.0.0 逐字相同(唯一刻意變更:時效相依之稱呼改回與 md 章節同名「時效與機制相依」)
//   ②每個欄位各有唯一落點(填入標記字串,只出現在對應 prompt 一次)③輸出格式說明與驗證函數不受欄位影響
//   ④欄位逐欄回退預設、空字串照填、null 視為未給 ⑤欄位名／型別錯誤於啟動期拋錯
//   ⑥證據等級清單依 vocab.evidenceLevels 產生 ⑦索引／巡檢推送標題由知識庫稱呼推導 ⑧cfg.domains 同時作用於管線與 info()
//   ⑨grid 遞補之 arXiv 類別可與探測類別分設
// 執行:npx mocha test/unit-guide.test.mjs(暫存落 test/_tmp/guide-<pid>,測完即刪;不發網路)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { renderAllPrompts } from './tools/promptFixtures.mjs'
import { memStore } from './tools/memStore.mjs'
import { GUIDE_FIELDS, VOCAB_DEFAULT, guideDefaultOf, resolveVocab, kbLabelOf } from '../src/domain/vocabDefault.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { createKnowledgeExtract } from '../src/core/createKnowledgeExtract.mjs'
import { createDefaultFetchers } from '../src/fetchers/defaultFetchers.mjs'
import { createPatrol } from '../src/ops/patrol.mjs'
import { createClock } from '../src/util/clock.mjs'
import { setConceptFold } from '../src/util/text.mjs'

const TMP = path.resolve(`test/_tmp/guide-${process.pid}`).replace(/\\/g, '/')
const GOLDEN = JSON.parse(fs.readFileSync(path.resolve('test/golden/prompts-1.0.0.json'), 'utf8'))
// 刻意變更(規格①之唯一例外):regime_dependency／temporal 之稱呼改回與 md 章節同名
const intended = (s) => s.split('時效與條件相依').join('時效與機制相依')
const count = (s, m) => s.split(m).length - 1

const stubAi = {
    callJson: async () => ({ ok: false, data: null, error: 'stub', skipped: false, attempts: 0, preview: '' }),
    getWkf: () => ({}),
    withBudget: (s) => s,
    recordCall: () => {},
    drainStats: () => '無呼叫',
    aiUsageToday: () => ({ today: '', used: 0, byKey: {}, chain: '', providers: [], skipped: [] }),
}

/** 各段欄位之標記值(字串/陣列/證據等級物件依型別給) */
function markerGuide() {
    const g = {}
    for (const [sec, fields] of Object.entries(GUIDE_FIELDS)) {
        g[sec] = {}
        for (const [k, type] of Object.entries(fields)) {
            const m = `⟦${sec}.${k}⟧`
            g[sec][k] = type === 'array' ? [m] : type === 'levelMap' ? { '高': m } : m
        }
    }
    return g
}

/** 欄位 → 應出現之 prompt 鍵 */
function targetsOf(sec, k) {
    if (sec === 'triage') return k === 'fallbackReason' ? ['triageReason'] : ['triage']
    if (sec === 'extract') return ['extract', 'extractNoVocab']
    if (sec === 'relate') return ['relate']
    return ['distillBase', 'distillBasePrior']
}

describe('unit-guide', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        setConceptFold(null) // createKnowledgeExtract 會注入模組級 opencc 折疊,不留給同 worker 之他檔
    })

    // ── ①預設不變 ──
    it('①未設定任何欄位:七類 prompt(含預篩預設理由)與 1.0.0 逐字相同,唯一例外為時效相依之稱呼(無 domain 與有 domain 兩組)', () => {
        for (const [variant, vocab] of [['noDomain', null], ['domain', { domain: '機器學習' }]]) {
            const now = renderAllPrompts(vocab)
            assert.deepEqual(Object.keys(now), Object.keys(GOLDEN[variant]))
            for (const [k, exp] of Object.entries(GOLDEN[variant])) {
                assert.equal(now[k], intended(exp), `${variant}.${k} 須與 1.0.0 相同`)
            }
            assert.ok(now.extract.includes('regime_dependency：時效與機制相依（0-3 條）'), 'prompt 稱呼與 md 章節名一致')
            assert.ok(now.distillBase.includes('**temporal（時效與機制相依）**'))
            assert.ok(!Object.values(now).some((s) => s.includes('時效與條件相依')))
        }
    })

    // ── ②欄位覆蓋 ──
    it('②每個欄位各有唯一落點:標記只出現在對應 prompt 一次、不出現在其他 prompt;kbLabel 出現在七類 prompt 首句各一次', () => {
        const now = renderAllPrompts({ kbLabel: '⟦kbLabel⟧', guide: markerGuide() })
        let n = 0
        for (const [sec, fields] of Object.entries(GUIDE_FIELDS)) {
            for (const k of Object.keys(fields)) {
                const m = `⟦${sec}.${k}⟧`
                const tg = targetsOf(sec, k)
                for (const [key, s] of Object.entries(now)) {
                    assert.equal(count(s, m), tg.includes(key) ? 1 : 0, `${m} 於 ${key}`)
                }
                n++
            }
        }
        assert.equal(n, 22, '欄位共 22 個(＋kbLabel＝23)')
        for (const [key, s] of Object.entries(now)) {
            if (key === 'triageReason') {
                assert.equal(count(s, '⟦kbLabel⟧'), 0)
                continue
            }
            assert.equal(count(s, '⟦kbLabel⟧'), 1, `kbLabel 於 ${key}`)
            assert.ok(s.startsWith('你是⟦kbLabel⟧的'), `${key} 首句用 kbLabel`)
        }
    })

    // ── ③契約不動 ──
    it('③輸出格式說明與驗證函數不受欄位影響(全部欄位換成標記,「只回覆 JSON…」起之段落與預設逐字相同)', () => {
        const base = renderAllPrompts(null)
        const now = renderAllPrompts({ guide: markerGuide() })
        const tail = (s, mark) => s.slice(s.indexOf(mark))
        for (const [key, mark] of [['triage', '只回覆 JSON 陣列'], ['extract', '只回覆 JSON 陣列'], ['relate', '只回覆 JSON 陣列'], ['distillBase', '只回覆 JSON 物件'], ['audit', '只回覆 JSON：'], ['revise', '只回覆修訂後'], ['final', '只回覆定稿']]) {
            assert.ok(base[key].includes(mark))
            assert.equal(tail(now[key], mark), tail(base[key], mark), `${key} 之輸出格式段不變`)
        }
        const t = createTriageDomain({ vocab: { guide: markerGuide() } })
        assert.equal(t.isValidItem({ index: 1, relevant: true }, 1), true)
        assert.equal(t.isValidItem({ index: 2, relevant: true }, 1), false)
        const e = createExtractDomain({ vocab: { guide: markerGuide() } })
        assert.equal(e.isValidItem({ index: 1, relevant: true, title: 'T', key_points: ['k'], concepts: ['c'] }, 1), true)
        assert.equal(e.normalizeQuality({ evidence_level: '高' }).evidenceLevel, '高')
    })

    // ── ④合併語意 ──
    it('④逐欄回退預設:只給一欄,其餘欄位與他段皆為預設;prompt 只在該處不同', () => {
        const v = resolveVocab({ guide: { relate: { vagueReason: '都屬同一學科' } } })
        const exp = guideDefaultOf('')
        exp.relate.vagueReason = '都屬同一學科'
        assert.deepEqual(v.guide, exp)
        const now = renderAllPrompts({ guide: { relate: { vagueReason: '都屬同一學科' } } })
        assert.equal(now.relate, intended(GOLDEN.noDomain.relate).replace('「都與某主題有關」', '「都屬同一學科」'))
        assert.equal(now.triage, intended(GOLDEN.noDomain.triage), '他段不受影響')
        // 證據等級定義逐級回退:只給高,中/低沿用預設
        const d = resolveVocab({ guide: { extract: { evidenceLevelDefs: { '高': '有重複驗證' } } } }).guide.extract.evidenceLevelDefs
        assert.deepEqual(d, { '高': '有重複驗證', '中': '僅單一研究、案例或統計分析', '低': '示範性質、未驗證、或推廣內容' })
    })

    it('④空字串照填(scopeLine:"" 關閉主題範圍句);null 視為未給(沿用預設);預設句依 domain 產生', () => {
        const withScope = renderAllPrompts({ domain: '機器學習' }).triage
        const noScope = renderAllPrompts({ domain: '機器學習', guide: { triage: { scopeLine: '' } } }).triage
        assert.ok(withScope.includes('\n本知識庫之主題範圍為「機器學習」：與此主題無關者判 false。'))
        assert.equal(noScope, withScope.replace('\n本知識庫之主題範圍為「機器學習」：與此主題無關者判 false。', ''))
        const nulls = renderAllPrompts({ domain: '機器學習', guide: { triage: { scopeLine: null, question: null }, extract: null } })
        assert.equal(nulls.triage, withScope)
        assert.equal(resolveVocab({ guide: null }).guide.triage.fallbackReason, '無可複用知識')
        assert.equal(resolveVocab({ domain: '機器學習' }).guide.triage.fallbackReason, '與「機器學習」無關或無可複用知識')
        assert.equal(resolveVocab({ domain: '機器學習' }).guide.extract.relevance, '與「機器學習」相關、可長期複用之知識、方法、技術、參數或原理')
    })

    it('④可重複套用:resolveVocab(resolveVocab(x)) 與 resolveVocab(x) 相同(含改等級名稱者);非物件視為全用預設', () => {
        const x = { domain: '機器學習', kbLabel: 'ML知識庫', evidenceLevels: ['強', '弱'], guide: { extract: { evidenceLevelDefs: { '強': '有重複驗證' } }, relate: { broadRelation: '同屬AI' } } }
        const once = resolveVocab(x)
        assert.deepEqual(resolveVocab(once), once)
        assert.deepEqual(once.guide.extract.evidenceLevelDefs, { '強': '有重複驗證' }, '預設之高/中/低定義不適用於改名後之等級')
        assert.deepEqual(resolveVocab('bad'), VOCAB_DEFAULT)
    })

    // ── ⑤啟動期驗證 ──
    it('⑤欄位名打錯、型別不符、證據等級鍵不在 evidenceLevels、kbLabel 非字串 → 拋錯(不靜默沿用預設)', () => {
        assert.throws(() => resolveVocab({ guide: 'x' }), /vocab\.guide 須為物件/)
        assert.throws(() => resolveVocab({ guide: { triag: {} } }), /vocab\.guide 含不認得的段「triag」/)
        assert.throws(() => resolveVocab({ guide: { triage: 'x' } }), /vocab\.guide\.triage 須為物件/)
        assert.throws(() => resolveVocab({ guide: { triage: { qestion: 'x' } } }), /vocab\.guide\.triage 含不認得的欄位「qestion」/)
        assert.throws(() => resolveVocab({ guide: { relate: { vagueReason: 3 } } }), /vocab\.guide\.relate\.vagueReason 須為字串/)
        for (const bad of [[], ['a', ''], 'a', [1]]) {
            assert.throws(() => resolveVocab({ guide: { triage: { rejects: bad } } }), /vocab\.guide\.triage\.rejects 須為字串陣列/)
        }
        assert.throws(() => resolveVocab({ guide: { extract: { evidenceLevelDefs: ['x'] } } }), /evidenceLevelDefs 須為物件/)
        assert.throws(() => resolveVocab({ guide: { extract: { evidenceLevelDefs: { '極高': 'x' } } } }), /「極高」不在 evidenceLevels/)
        assert.throws(() => resolveVocab({ guide: { extract: { evidenceLevelDefs: { '高': 1 } } } }), /evidenceLevelDefs\.高 須為字串/)
        assert.throws(() => resolveVocab({ kbLabel: 5 }), /vocab\.kbLabel 須為字串/)
        // 總組裝於建構期即爆(不是跑到該段才發現)
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/bad`, afterRun: false, aiAdapter: stubAi, data: { vocab: { guide: { triage: { qestion: 'x' } } } } }), /不認得的欄位「qestion」/)
    })

    // ── ⑥證據等級 ──
    it('⑥證據等級擇一清單依 vocab.evidenceLevels 產生:改了等級名稱,prompt 與產出驗證同步(此前 prompt 寫死高／中／低)', () => {
        const d1 = createExtractDomain({ vocab: { evidenceLevels: ['強', '弱'], guide: { extract: { evidenceLevelDefs: { '強': '有重複驗證', '弱': '未驗證' } } } } })
        const p1 = d1.buildPrompt([{ title: 'T', sourceName: 'S', url: 'https://example.com/a', text: 't' }], [])
        assert.ok(p1.includes('evidence_level 擇一：強（有重複驗證）／弱（未驗證）；'))
        assert.ok(!p1.includes('高（'))
        assert.equal(d1.normalizeQuality({ evidence_level: '強' }).evidenceLevel, '強', 'prompt 要求之等級即驗證所認之等級')
        const d2 = createExtractDomain({ vocab: { evidenceLevels: ['A', 'B'] } })
        assert.ok(d2.buildPrompt([], []).includes('evidence_level 擇一：A／B；'), '無定義之等級只列名稱')
    })

    // ── 知識庫稱呼 ──
    it('kbLabel 明給者優先,空字串與未給由 domain 推導;七類 prompt 首句皆用之', () => {
        assert.equal(kbLabelOf({ domain: '機器學習', kbLabel: 'ML知識庫' }), 'ML知識庫')
        assert.equal(kbLabelOf({ domain: '機器學習', kbLabel: '' }), '「機器學習」知識庫')
        assert.equal(kbLabelOf({ domain: '', kbLabel: '  ' }), '知識庫')
        const now = renderAllPrompts({ kbLabel: 'ML知識庫' })
        for (const k of ['triage', 'extract', 'relate', 'distillBase', 'audit', 'revise', 'final']) assert.ok(now[k].startsWith('你是ML知識庫的'), k)
        assert.equal(createRelateDomain({ vocab: { kbLabel: 'ML知識庫' } }).conflictType, '衝突或反例')
    })

    // ── ⑦標題 ──
    it('⑦索引標題:未給 cfg.indexTitle 時為「<稱呼>索引」(無 domain 仍為「知識庫索引」),明給者優先', () => {
        const base = { afterRun: false, aiAdapter: stubAi }
        const t = (extra, name) => createKnowledgeExtract({ workDir: `${TMP}/${name}`, ...base, ...extra }).info().settings.indexTitle
        assert.equal(t({}, 't1'), '知識庫索引')
        assert.equal(t({ data: { vocab: { domain: '機器學習' } } }, 't2'), '「機器學習」知識庫索引')
        assert.equal(t({ data: { vocab: { kbLabel: 'ML知識庫' } } }, 't3'), 'ML知識庫索引')
        assert.equal(t({ data: { vocab: { kbLabel: 'ML知識庫' } }, indexTitle: '總索引' }, 't4'), '總索引')
    })

    it('⑦巡檢推送標題:createPatrol 之 pushTitle(預設「知識庫巡檢」);總組裝以「<稱呼>巡檢」帶入,monitor.pushTitle 可覆寫', async () => {
        const clock = createClock('Asia/Taipei')
        const dir = `${TMP}/patrol`
        for (const d of ['log', 'state', 'tmp']) fs.mkdirSync(`${dir}/${d}`, { recursive: true })
        const sent = []
        const openStores = () => ({ docs: memStore(), notes: memStore(), relations: memStore(), cores: memStore(), sources: memStore(), frontier: memStore() })
        const mk = (extra) => createPatrol({ dirs: { log: `${dir}/log`, state: `${dir}/state`, tmp: `${dir}/tmp` }, workDir: dir, clock, openStores, closeStores: async () => {}, aiUsageToday: () => ({ used: 0, byKey: {}, chain: '', providers: [] }), recordFile: `${dir}/r.md`, notify: (s) => sent.push(s), ...extra })
        await mk({}).patrolFromPipeline()
        await mk({ pushTitle: 'ML知識庫巡檢' }).patrolFromPipeline()
        assert.match(sent[0], /^(✅|⚠️) 知識庫巡檢 /)
        assert.match(sent[1], /^(✅|⚠️) ML知識庫巡檢 /)
        // 總組裝接線(真 LMDB,暫存目錄):稱呼推導與 monitor 覆寫
        const flowSent = []
        const base = { afterRun: false, aiAdapter: stubAi, monitor: { notify: (s) => flowSent.push(s) } }
        const f1 = createKnowledgeExtract({ workDir: `${TMP}/p1`, ...base, data: { vocab: { kbLabel: 'ML知識庫' } } })
        assert.deepEqual(await f1.info().patrol.patrolFromPipeline(), { ok: true })
        const f2 = createKnowledgeExtract({ workDir: `${TMP}/p2`, ...base, monitor: { ...base.monitor, pushTitle: '自訂巡檢' } })
        assert.deepEqual(await f2.info().patrol.patrolFromPipeline(), { ok: true })
        assert.match(flowSent[0], /^(✅|⚠️) ML知識庫巡檢 /)
        assert.match(flowSent[1], /^(✅|⚠️) 自訂巡檢 /)
    })

    // ── ⑧頂層 domains 注入 ──
    it('⑧cfg.domains:給了的整組置換並同時作用於 info()(管線 deps 取同一物件),沒給的沿用內建;形狀錯誤於建構期拋錯', () => {
        const base = { afterRun: false, aiAdapter: stubAi }
        const relate = { ...createRelateDomain({}), buildPrompt: () => 'MY RELATE PROMPT' }
        const flow = createKnowledgeExtract({ workDir: `${TMP}/d1`, ...base, domains: { relate } })
        const ds = flow.info().domains
        assert.equal(ds.relate, relate)
        assert.equal(ds.relate.buildPrompt(), 'MY RELATE PROMPT')
        assert.equal(typeof ds.extract.buildPrompt, 'function', '未給者沿用內建')
        assert.equal(createKnowledgeExtract({ workDir: `${TMP}/d2`, ...base, domains: null }).info().domains.relate.conflictType, '衝突或反例', 'null 視為未給')
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/d3`, ...base, domains: 'x' }), /cfg\.domains 須為物件/)
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/d4`, ...base, domains: { relat: relate } }), /cfg\.domains 含不認得的鍵「relat」/)
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/d5`, ...base, domains: { relate: 'x' } }), /cfg\.domains\.relate 須為 domain 物件/)
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/d6`, ...base, domains: { relate: { buildPrompt: () => '' } } }), /cfg\.domains\.relate 缺成員「relationTypes、conflictType、fallbackType」/)
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/d7`, ...base, domains: { triage: { ...createTriageDomain({}), reasonOf: 'x' } } }), /cfg\.domains\.triage 缺成員「reasonOf」/)
    })

    // ── ⑨網格 arXiv 類別拆分 ──
    it('⑨grid 遞補 arXiv:gridArxivCategories 優先,未給(null)沿用 arxivCategories;設定型別錯誤於建構期拋錯', async () => {
        const urls = []
        const stub = async (u) => {
            urls.push(u)
            return u.includes('openalex') ? { status: 'error', message: 'HTTP 429' } : { status: 'success', html: '<feed></feed>' }
        }
        const gridOf = (extra) => createDefaultFetchers({ fetchWebByCurl: stub, ...extra }).find((f) => f.id === 'grid')
        await gridOf({ arxivCategories: ['cs.LG'], gridArxivCategories: ['stat.ML', 'math.OC'] }).fetch({ query: 'q' })
        assert.match(decodeURIComponent(urls[1]), /all:q AND \(cat:stat\.ML OR cat:math\.OC\)/, 'grid 用自己的類別清單')
        await gridOf({ arxivCategories: ['cs.LG'], gridArxivCategories: null }).fetch({ query: 'q' })
        assert.match(decodeURIComponent(urls[3]), /all:q AND \(cat:cs\.LG\)/, '未給沿用 arxivCategories')
        await gridOf({ arxivCategories: ['cs.LG'], gridArxivCategories: [] }).fetch({ query: 'q' })
        assert.doesNotMatch(decodeURIComponent(urls[5]), /cat:/, '空陣列＝grid 明確不限類別')
        const base = { afterRun: false, aiAdapter: stubAi }
        assert.equal(createKnowledgeExtract({ workDir: `${TMP}/g1`, ...base }).info().settings.fetch.gridArxivCategories, null, '預設 null')
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/g2`, ...base, fetch: { gridArxivCategories: 'stat.ML' } }), /gridArxivCategories 須為字串陣列或 null/)
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/g3`, ...base, fetch: { arxivCategories: 'cs.LG' } }), /arxivCategories 須為字串陣列/)
    })
})
