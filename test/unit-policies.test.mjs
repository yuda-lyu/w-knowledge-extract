// unit-policies.test.mjs — 生命週期政策與批次 AI harness 的回歸測試
// 執行：npx mocha test/unit-policies.test.mjs

import assert from 'node:assert/strict'
import { memStore } from './tools/memStore.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { ensureSeedSources, recordSourceOutcome, cullZeroYieldSources, pickDueSources, isLowYield } from '../src/stores/sourcePolicy.mjs'
import { slimTerminalDocs, byRetryTierFifo } from '../src/stores/docPolicy.mjs'
import { clueKey, legacyClueKey, saveClues, pickClues, settleClue, enforceFrontierCap } from '../src/stores/frontierPolicy.mjs'
import { ingestFeedItems } from '../src/stores/ingestGate.mjs'
import { pickConcepts, pickCategories, conceptVocabulary } from '../src/stores/conceptGroups.mjs'
import { setConceptFold } from '../src/util/text.mjs'
import { pickCandidates } from '../src/stages/relateStage.mjs'
import { runAiBatchStage } from '../src/stages/aiBatchStage.mjs'
import { nullLogger } from './tools/nullLogger.mjs'

const log = nullLogger()
const NOW = '2026-08-18T12:00:00+08:00'

describe('unit-policies', function() {

    // conceptFold 為模組級單例(util/text):mocha --parallel 之 worker 會重用行程,他檔建 createKnowledgeExtract 會注入 opencc 折疊;
    // 本檔測試前提為「未注入折疊」,故前後一律清除
    before(function() {
        setConceptFold(null)
    })

    after(function() {
        setConceptFold(null)
    })

    // ── sourcePolicy ──
    it('種子同步：宣告欄位跟著種子檔更新，執行期統計不動', async () => {
        const s = memStore([{ id: 'a', tier: 2, name: '舊名', okCount: 7, lastFetchAt: 'X' }])
        const r = await ensureSeedSources(s, [{ id: 'a', tier: 1, name: '新名' }, { id: 'b', tier: 3, name: 'B' }])
        assert.equal(r.addCount, 1)
        assert.equal(r.synced, 1)
        const a = await s.get('a')
        assert.equal(a.tier, 1)
        assert.equal(a.name, '新名')
        assert.equal(a.okCount, 7, '執行期統計不可被種子覆寫')
    })

    it('failCount 成功即歸零；連續失敗達門檻停用', async () => {
        const s = memStore([{ id: 'a', name: 'A', failCount: 7 }])
        await recordSourceOutcome(s, await s.get('a'), { ok: true, itemCount: 3 }, { nowIso: NOW, maxConsecFails: 8 })
        assert.equal((await s.get('a')).failCount, 0, '成功必歸零——不歸零會跨月累積讓健康來源莫名停用')
        for (let i = 0; i < 8; i++) await recordSourceOutcome(s, await s.get('a'), { ok: false, error: 'x' }, { nowIso: NOW, maxConsecFails: 8 })
        assert.equal((await s.get('a')).enabled, false, '連續 8 次失敗停用')
    })

    it('空回計數只停用自動衍生來源，種子來源不受影響', async () => {
        const s = memStore([{ id: 'seed', name: 'S', origin: 'seed' }, { id: 'auto', name: 'A', origin: 'frontier:kw' }])
        const cfg = { nowIso: NOW, maxConsecEmpty: 3, isAutoSource: (x) => /^frontier:/.test(x.origin) }
        for (let i = 0; i < 3; i++) {
            await recordSourceOutcome(s, await s.get('seed'), { ok: true, itemCount: 0 }, cfg)
            await recordSourceOutcome(s, await s.get('auto'), { ok: true, itemCount: 0 }, cfg)
        }
        assert.notEqual((await s.get('seed')).enabled, false, '種子來源一時無新文不停用')
        assert.equal((await s.get('auto')).enabled, false)
    })

    it('零產出淘汰：有產出或樣本不足者不動', async () => {
        const s = memStore([
            { id: 'z', name: '純雜訊' }, { id: 'm', name: '混合' }, { id: 'few', name: '樣本少' },
        ])
        const judge = { z: { judged: 8, yielded: 0 }, m: { judged: 10, yielded: 3 }, few: { judged: 3, yielded: 0 } }
        await cullZeroYieldSources(s, (x) => judge[x.id], { minJudged: 6, log })
        assert.equal((await s.get('z')).enabled, false)
        assert.notEqual((await s.get('m')).enabled, false, '混合型來源有真產出，淘汰它是誤殺')
        assert.notEqual((await s.get('few')).enabled, false)
    })

    it('輪抓挑選：tier 優先、最舊優先、未逾最短間隔不入選', async () => {
        const s = memStore([
            { id: 'a', tier: 2, lastFetchAt: '2026-08-18T10:00:00+08:00' },
            { id: 'b', tier: 1, lastFetchAt: '2026-08-18T09:00:00+08:00' },
            { id: 'c', tier: 1, lastFetchAt: new Date().toISOString() }, // 剛抓過
            { id: 'd', tier: 1, lastFetchAt: '' },
        ])
        const due = await pickDueSources(s, { limit: 10, minIntervalMs: 3600_000 })
        assert.deepEqual(due.map((x) => x.id), ['d', 'b', 'a'], 'c 未逾間隔須排除；d 從未抓過最優先')
    })

    // ── docPolicy ──
    it('終態瘦身：清素材保記錄；非終態不可清（沒有時間型過期——2026-09-07 移除 expireStaleDocs）', async () => {
        const docs = memStore([
            { id: '1', status: 'noted', text: 'AAAA', feedText: 'BB' },
            { id: '2', status: 'raw', text: 'KEEP' },
            { id: '3', status: 'new', fetchTries: 1, collectedAt: '2026-01-01T00:00:00+08:00' }, // 舊且抓過：不是終態，不碰
        ])
        const r = await slimTerminalDocs(docs, { terminalStatuses: ['noted'] })
        assert.equal(r.slimmed, 1)
        assert.equal((await docs.get('1')).text, '')
        assert.equal((await docs.get('1')).textLength, 6, '瘦身須記下原長度')
        assert.equal((await docs.get('2')).text, 'KEEP', '非終態不可清')
        assert.equal((await docs.get('3')).status, 'new', '新舊與抓過幾次都不是丟棄理由；記錄永不刪除')
    })

    // ── frontierPolicy ──
    it('線索：去重累加 hits、hits 優先消化、達上限轉 failed', async () => {
        const f = memStore()
        await saveClues(f, [{ type: 'keyword', value: 'Transformer', why: 'a' }], { nowIso: NOW })
        await saveClues(f, [{ type: 'keyword', value: 'transformer', why: 'b' }], { nowIso: NOW }) // 大小寫視同重複
        await saveClues(f, [{ type: 'site', value: 'not-a-url' }, { type: 'weird', value: 'x' }], { nowIso: NOW })
        const rows = f._dump()
        assert.equal(rows.length, 1, 'site 非網址與未知 type 不可入庫')
        assert.equal(rows[0].hits, 2, '重複是訊號：hits 累加')

        await saveClues(f, [{ type: 'topic', value: 'cold' }], { nowIso: NOW })
        const picked = await pickClues(f, 10)
        assert.equal(picked[0].value, 'Transformer', 'hits 高者優先——純 FIFO 會讓核心題目排在冷門線索後')

        let st1 = await settleClue(f, picked[0], { ok: false, error: 'x' }, { nowIso: NOW, maxTries: 2 })
        assert.equal(st1.status, 'pending')
        st1 = await settleClue(f, await f.get(picked[0].id), { ok: false, error: 'x' }, { nowIso: NOW, maxTries: 2 })
        assert.equal(st1.status, 'failed')
    })

    it('線索鍵折疊：全形／空白／括號／大小寫視同一筆；舊鍵記錄以新值寫入時累加其 hits（不需遷移）', async () => {
        const f = memStore()
        await saveClues(f, [{ type: 'keyword', value: 'Transformer 架構' }], { nowIso: NOW })
        await saveClues(f, [{ type: 'keyword', value: 'transformer架構' }], { nowIso: NOW })
        await saveClues(f, [{ type: 'keyword', value: 'Ｔransformer（架構）' }], { nowIso: NOW }) // 全形 Ｔ＋括號
        assert.equal(f._dump().length, 1, '三種寫法須折疊為一筆——鍵只做 lowercase 時 pending 27864 筆中 hits≥2 者僅 2 筆')
        assert.equal(f._dump()[0].hits, 3)
        assert.equal(f._dump()[0].value, 'Transformer 架構', '保留首見原值供人讀')
        // 既有記錄仍為舊鍵(2026-09-12 前):新值寫入時先查新鍵、再查舊鍵,命中即累加,不另開一筆
        const legacy = memStore([{ id: legacyClueKey('topic', 'Few Shot'), type: 'topic', value: 'Few Shot', hits: 4, status: 'pending' }])
        const r = await saveClues(legacy, [{ type: 'topic', value: 'few shot' }], { nowIso: NOW })
        assert.deepEqual(r, { addCount: 0, merged: 1, revived: 0 })
        assert.equal(legacy._dump().length, 1)
        assert.equal(legacy._dump()[0].hits, 5)
        assert.notEqual(clueKey('topic', 'Few Shot'), legacyClueKey('topic', 'Few Shot'), '新舊鍵不同(去空白)——故必須雙查')
        // site 型以 normalizeUrl 折疊(去追蹤參數／尾斜線)
        await saveClues(f, [{ type: 'site', value: 'https://Example.com/blog/?utm_source=x' }], { nowIso: NOW })
        await saveClues(f, [{ type: 'site', value: 'https://example.com/blog' }], { nowIso: NOW })
        assert.equal(f._dump().filter((x) => x.type === 'site').length, 1)
    })

    it('輪抓挑選之產出率回饋：樣本足量且產出率低者排同層級之末；樣本不足與統計缺席者不動；門檻 0 即關閉', async () => {
        const s = memStore([
            { id: 'a', tier: 1, lastFetchAt: '2026-08-18T08:00:00+08:00', judged: 10, yielded: 0 }, // 最舊但產出 0/10
            { id: 'b', tier: 1, lastFetchAt: '2026-08-18T09:00:00+08:00', judged: 10, yielded: 5 },
            { id: 'c', tier: 1, lastFetchAt: '2026-08-18T10:00:00+08:00', judged: 3, yielded: 0 }, // 樣本不足
            { id: 'd', tier: 2, lastFetchAt: '2026-08-18T07:00:00+08:00' }, // 無統計
        ])
        const base = { limit: 10, minIntervalMs: 3600_000, minJudged: 6 }
        assert.deepEqual((await pickDueSources(s, { ...base, lowYieldRate: 0.1 })).map((x) => x.id), ['b', 'c', 'a', 'd'], '低產出者降到 tier 1 之末,仍在 tier 2 之前')
        assert.deepEqual((await pickDueSources(s, { ...base, lowYieldRate: 0 })).map((x) => x.id), ['a', 'b', 'c', 'd'], '門檻 0 即舊行為')
        assert.equal(isLowYield({ judged: 10, yielded: 1 }, { lowYieldRate: 0.1, minJudged: 6 }), false, '恰為門檻不算低')
        assert.equal(isLowYield({ judged: 10, yielded: 0 }, { lowYieldRate: 0.1, minJudged: 6 }), true)
    })

    it('零產出淘汰同時把 judged/yielded 落在來源記錄上（有變才寫）', async () => {
        const s = memStore([{ id: 'x', name: 'X' }, { id: 'y', name: 'Y', judged: 4, yielded: 1 }])
        const judge = { x: { judged: 8, yielded: 2 }, y: { judged: 4, yielded: 1 } }
        const r = await cullZeroYieldSources(s, (v) => judge[v.id], { minJudged: 6, log })
        assert.deepEqual(r, { culled: 0, synced: 1 }, 'y 統計未變不寫')
        assert.deepEqual([(await s.get('x')).judged, (await s.get('x')).yielded], [8, 2])
    })

    it('選取順序 byRetryTierFifo：tries 升冪 → tier 升冪 → collectedAt 升冪（補全文與萃取共用一份比較器）', () => {
        const rows = [
            { id: 't1-tried', sourceTier: 1, fetchTries: 2, collectedAt: '2026-06-01' },
            { id: 't3-new', sourceTier: 3, fetchTries: 0, collectedAt: '2026-08-01' },
            { id: 't1-new-late', sourceTier: 1, fetchTries: 0, collectedAt: '2026-08-02' },
            { id: 't1-new-early', sourceTier: 1, fetchTries: 0, collectedAt: '2026-07-01' },
        ]
        assert.deepEqual(rows.slice().sort(byRetryTierFifo('fetchTries')).map((r) => r.id), ['t1-new-early', 't1-new-late', 't3-new', 't1-tried'])
        assert.deepEqual(rows.slice().sort(byRetryTierFifo('extractTries')).map((r) => r.id), ['t1-tried', 't1-new-early', 't1-new-late', 't3-new'], '換欄位名即萃取側語意(此處 extractTries 皆 0 → 只剩 tier→collectedAt)')
    })

    it('入庫閘門 ingestFeedItems：契約檢查（無 url 留痕、批內去重、正規化 id）→ 業務過濾 → seen.admit 去重占位；探測入庫與輪抓同一份', async () => {
        const docs = memStore()
        const seen = W.createSeenStore({ collection: docs, identity: W.createIdentity({ keyOf: 'raw' }), log })
        const ctx = { deps: { settings: { fetch: { itemsPerSource: 8, maxTextChars: 50 } }, seen, clock: { iso8: () => NOW } }, log }
        const source = { id: 's1', name: 'S', kind: 'rss', tier: 3 }
        const raw = [
            { url: 'https://a.com/x?utm_source=z', title: 'A', description: 'd'.repeat(80) },
            { url: 'https://a.com/x', title: 'A 重複（追蹤參數不同）' },
            { title: '沒有 url' },
            { url: 'https://a.com/y', title: 'B' },
        ]
        const r = await ingestFeedItems(raw, { source, fetcherId: 'probe:rss', ctx, filter: (items) => items.filter((i) => i.title !== 'B') })
        assert.equal(r.invalid.length, 1, '無 url 者進 invalid 留痕(此前探測入庫靜默丟)')
        assert.equal(r.dupInBatch, 1, '批內以同一份 identity 去重')
        assert.equal(r.dropped, 1, '業務過濾對探測文件同樣生效')
        assert.equal(r.fresh.length, 1)
        assert.equal(r.fresh[0].id, seen.idOf('https://a.com/x'), 'id 由去重層以 canonicalUrl 算出')
        assert.deepEqual([r.fresh[0].sourceId, r.fresh[0].sourceTier, r.fresh[0].status, r.fresh[0].fetchTries], ['s1', 3, 'new', 0], '正準 doc 形狀(util/records)')
        assert.equal(r.fresh[0].feedText.length, 50, 'feedText 依 maxTextChars 截斷')
        const again = await ingestFeedItems(raw, { source, fetcherId: 'probe:rss', ctx })
        assert.equal(again.fresh.length, 1, '第二次:x 已在庫,只有 B(本次未過濾)入庫')
        assert.equal(again.dup, 1)
    })

    it('線索上限淘汰：超過 maxPending 即淘汰優先序最低者（hits 低、來自 skip 文件、最舊）；再被提及即復活；pickClues 同一優先序；0 即不設限', async () => {
        const f = memStore()
        await saveClues(f, [{ type: 'keyword', value: 'hot' }], { nowIso: '2026-08-18T10:00:00+08:00' })
        await saveClues(f, [{ type: 'keyword', value: 'hot' }], { nowIso: '2026-08-18T10:01:00+08:00' }) // hits 2
        await saveClues(f, [{ type: 'keyword', value: 'from-skip' }], { nowIso: '2026-08-18T09:00:00+08:00', fromRef: 'skip:d1' })
        await saveClues(f, [{ type: 'keyword', value: 'old-cold' }], { nowIso: '2026-08-18T08:00:00+08:00' })
        await saveClues(f, [{ type: 'keyword', value: 'new-cold' }], { nowIso: '2026-08-18T11:00:00+08:00' })
        assert.deepEqual((await pickClues(f, 10)).map((c) => c.value), ['hot', 'old-cold', 'new-cold', 'from-skip'], 'hits 降冪 → 來自知識文件者先 → 先來後到')
        assert.deepEqual(await enforceFrontierCap(f, { maxPending: 2, nowIso: NOW }), { pending: 2, evicted: 2 })
        assert.deepEqual((await f.select({ status: 'evicted' })).map((c) => c.value).sort(), ['from-skip', 'new-cold'], '淘汰的是至今只被提過一次的冷門線索')
        assert.deepEqual((await pickClues(f, 10)).map((c) => c.value), ['hot', 'old-cold'])
        const s = await saveClues(f, [{ type: 'keyword', value: 'From-Skip' }], { nowIso: NOW })
        assert.deepEqual(s, { addCount: 0, merged: 1, revived: 1 }, '淘汰者再被提及即累加 hits 並復活——記錄保留是去重憑證,淘汰的不是資訊本身')
        assert.equal((await f.select({ status: 'pending' })).length, 3)
        assert.deepEqual(await enforceFrontierCap(f, { maxPending: 0, nowIso: NOW }), { pending: 3, evicted: 0 }, '0 即不設限')
    })

    // ── conceptGroups ──
    it('概念分群：normalizeConcept 歸群、gain 選題、類別後備', async () => {
        const mk = (id, c, cat = '方法與技術', created = '2026-08-01') => ({ id, concepts: [c], category: cat, createdAt: created })
        const notes = [mk('1', 'Transformer 架構'), mk('2', 'transformer架構'), mk('3', 'Ｔransformer架構')] // 全形Ｔ
        let t = pickConcepts(notes, [], { minNotes: 3 })
        assert.equal(t.length, 1, '三種寫法須歸同一群')
        assert.equal(t[0].notes.length, 3)

        t = pickConcepts(notes, [{ concept: 'Transformer 架構', noteCount: 3 }], { minNotes: 3 })
        assert.equal(t.length, 0, '沒有新筆記不重跑——重跑只燒額度並讓核心檔抖動')

        const catNotes = Array.from({ length: 6 }, (_, i) => mk(`c${i}`, `各自為政${i}`, '模型評估'))
        const cats = pickCategories(catNotes, [], { minNotes: 6, minGain: 4 })
        assert.equal(cats.length, 1)
        assert.equal(cats[0].scope, 'category')

        const vocabStore = memStore(notes.map((n) => ({ ...n })))
        const vocab = await conceptVocabulary(vocabStore)
        assert.match(vocab[0], /\(3\)$/, '詞彙表帶使用篇數供 prompt 收斂')
    })

    it('提煉選題 aging：score＝gain×等待天數——久候者優先、剛提煉的大概念不再壟斷、無核心者自最早筆記起算', () => {
        const now = Date.parse('2026-09-06T12:00:00+08:00')
        const day = 86400_000
        const mk = (id, c, created) => ({ id, concepts: [c], category: '方法與技術', createdAt: new Date(created).toISOString() })
        const many = (n, p, c, created) => Array.from({ length: n }, (_, i) => mk(`${p}${i}`, c, created))
        const notes = [
            ...many(10, 'a', '過擬合', now - 40 * day), // 有核心、gain 5、0.05 天前才提煉
            ...many(3, 'b', '梯度下降', now - 40 * day), // 有核心、gain 1、等了 20 天
            ...many(2, 'c', '正則化', now - 30 * day), // 無核心、素材等了 30 天
            ...many(2, 'd', '新概念', now), // 無核心、剛出現（等待 0 天）
        ]
        const cores = [
            { concept: '過擬合', noteCount: 5, updatedAt: new Date(now - 0.05 * day).toISOString() },
            { concept: '梯度下降', noteCount: 2, updatedAt: new Date(now - 20 * day).toISOString() },
        ]
        const t = pickConcepts(notes, cores, { minNotes: 2, now })
        assert.deepEqual(t.map((x) => x.concept), ['正則化', '梯度下降', '過擬合', '新概念'],
            '正則化(2×30)＞梯度下降(1×20)＞過擬合(5×0.05)＞新概念(2×0)；純 gain 排序會讓過擬合永遠第一（生產實測 194 個概念從未提煉）')
        assert.ok(t[0].score > t[1].score && t[1].score > t[2].score && t[2].score > t[3].score)
        assert.equal(t[2].gain, 5, 'gain 語意不變（只是排序加權）')
    })

    // ── 字形折疊（繁簡分裂修正，2026-08-19）──
    it('折疊注入後：繁簡標籤歸同群、display 取多數寫法、清除後復原', async () => {
        const FOLD = { '机': '機' }
        setConceptFold((s) => [...s].map((ch) => FOLD[ch] || ch).join(''))
        try {
            const mk = (id, c) => ({ id, concepts: [c], category: '方法與技術', createdAt: '2026-08-01' })
            const notes = [mk('1', '注意力機制'), mk('2', '注意力機制'), mk('3', '注意力机制')]
            const t = pickConcepts(notes, [], { minNotes: 3 })
            assert.equal(t.length, 1, '繁簡兩種寫法必須歸同一群（分裂即重複核心檔之根源）')
            assert.equal(t[0].concept, '注意力機制', 'display 取多數寫法，不可被少數簡體帶偏')
            // 既有 core 為繁體時，簡體筆記的累積要算進同一 gain（不可另起爐灶）
            const t2 = pickConcepts(notes, [{ concept: '注意力機制', noteCount: 2 }], { minNotes: 3 })
            assert.equal(t2.length, 1)
            assert.equal(t2[0].gain, 1, '簡體筆記須計入既有繁體 core 之增量')
            // 詞彙表 display 同理
            const vocab = await conceptVocabulary(memStore(notes.map((n) => ({ ...n }))))
            assert.match(vocab[0], /^注意力機制\(3\)$/, '詞彙表回饋 prompt 的寫法必須是多數（繁體）形')
        }
        finally {
            setConceptFold(null)
        }
        // 清除後行為復原：無折疊時繁簡仍是兩鍵（既有測試依賴此預設）
        const notes2 = [{ id: '1', concepts: ['注意力機制'], category: '方法與技術' }, { id: '2', concepts: ['注意力机制'], category: '方法與技術' }]
        assert.equal(pickConcepts(notes2, [], { minNotes: 2 }).length, 0, '未注入折疊時不可偷偷合併')
    })

    it('relate 候選比對：折疊注入後繁簡互相命中', () => {
        const FOLD = { '机': '機' }
        setConceptFold((s) => [...s].map((ch) => FOLD[ch] || ch).join(''))
        try {
            const target = { id: 't', concepts: ['注意力机制'], category: '方法與技術' }
            const cands = [
                { id: 'a', concepts: ['注意力機制'], category: '方法與技術', createdAt: '2026-08-01' },
                { id: 'b', concepts: ['批次正規化'], category: '方法與技術', createdAt: '2026-08-02' },
            ]
            const picked = pickCandidates(target, cands, 1)
            assert.equal(picked[0].id, 'a', '簡體目標必須命中繁體候選（共享概念計分）')
        }
        finally {
            setConceptFold(null)
        }
    })

    // ── aiBatchStage ──
    it('harness：部分接受＋未涵蓋記 tries＋同 index 取第一', async () => {
        const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
        const applied = []
        const missed = []
        const r = await runAiBatchStage({
            log,
            batchSize: 3,
            parallel: 1,
            rounds: 1,
            pickPool: async () => pool,
            buildPrompt: async () => 'p',
            callAI: async () => ({
                ok: true,
                data: [
                    { index: 1, v: '首' }, { index: 1, v: '重複' }, { index: 2, bad: true }, // index2 不完整
                ]
            }),
            checkResult: (d) => Array.isArray(d),
            isValidItem: (it) => !it.bad,
            indexOf: (it) => it.index,
            applyItem: async (it, t) => {
                applied.push(`${t.id}:${it.v}`); return { done: 1 }
            },
            onMissed: async (t) => missed.push(t.id),
        })
        assert.deepEqual(applied, ['a:首'], '同 index 取第一；不完整項不採用')
        assert.deepEqual(missed.sort(), ['b', 'c'], '未涵蓋者交 onMissed 記 tries')
        assert.equal(r.applied.done, 1)
    })

    it('harness：額度用盡中止且不記 tries；一般失敗走 onBatchFailed', async () => {
        let batchFailed = 0
        const r1 = await runAiBatchStage({
            log,
            batchSize: 2,
            parallel: 1,
            rounds: 3,
            pickPool: async () => [{ id: 'a' }],
            buildPrompt: async () => 'p',
            callAI: async () => ({ ok: false, error: 'quota', skipped: true }),
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({}),
            onMissed: async () => {},
            onBatchFailed: async () => {
                batchFailed++
            },
        })
        assert.equal(r1.aborted, true, '額度用盡須中止後續輪')
        assert.equal(r1.rounds, 1)
        assert.equal(batchFailed, 0, '額度問題不是這批的錯，不可記 tries')

        await runAiBatchStage({
            log,
            batchSize: 2,
            parallel: 1,
            rounds: 1,
            pickPool: async () => [{ id: 'a' }],
            buildPrompt: async () => 'p',
            callAI: async () => ({ ok: false, error: 'truncated' }),
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({}),
            onMissed: async () => {},
            onBatchFailed: async () => {
                batchFailed++
            },
        })
        assert.equal(batchFailed, 1, '一般失敗須走 onBatchFailed（整批降序）')
    })

    it('harness：shouldStop 於每輪開工前守門(stopped)；failedBatches／missed 計數供 report 之 fail', async () => {
        let prompts = 0
        const r = await runAiBatchStage({
            log,
            batchSize: 2,
            parallel: 1,
            rounds: 5,
            shouldStop: () => prompts >= 2, // 第 3 輪開工前逾時間預算
            pickPool: async () => [{ id: 'a' }, { id: 'b' }],
            buildPrompt: async () => {
                prompts++; return 'p'
            },
            callAI: async () => ({ ok: true, data: [{ index: 1, v: 1 }] }), // 只涵蓋第 1 項,第 2 項未涵蓋
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({ done: 1 }),
            onMissed: async () => {},
        })
        assert.equal(r.rounds, 2, '守門前已跑 2 輪')
        assert.equal(r.stopped, true, '逾預算停止須可辨識(與額度中止 aborted 分開)')
        assert.equal(r.aborted, false)
        assert.equal(r.missed, 2, '每輪 1 項未涵蓋 × 2 輪')
        assert.equal(r.failedBatches, 0)

        const r2 = await runAiBatchStage({
            log,
            batchSize: 1,
            parallel: 1,
            rounds: 3,
            pickPool: async () => [{ id: 'a' }],
            buildPrompt: async () => 'p',
            callAI: async () => ({ ok: false, error: 'truncated' }),
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({}),
            onMissed: async () => {},
        })
        assert.equal(r2.failedBatches, 1, '失敗批次須計數——此前階段 report 恆 fail:0,批次失敗被吸收成正常')
        assert.equal(r2.stopped, false)
    })

    it('harness：buildPrompt／callAI 拋錯亦落帳（failedBatches＋onBatchFailed），與 ok:false 分支對稱', async () => {
        const failedWith = []
        let calls = 0
        const r = await runAiBatchStage({
            log,
            batchSize: 2,
            parallel: 1,
            rounds: 3,
            pickPool: async () => [{ id: 'a' }, { id: 'b' }],
            buildPrompt: async () => {
                calls++; throw new Error('席位解析失敗')
            },
            callAI: async () => ({ ok: true, data: [] }),
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({}),
            onMissed: async () => {},
            onBatchFailed: async (batch, err) => failedWith.push(`${batch.map((t) => t.id).join('+')}:${err.error}`),
        })
        assert.equal(r.failedBatches, 1, '例外批次計入 failedBatches——此前只記日誌,report 之 fail 不含它')
        assert.deepEqual(failedWith, ['a+b:席位解析失敗'], '例外亦走 onBatchFailed(記 tries 出隊),否則同一批永久空轉')
        assert.equal(calls, 1, '零進度守門仍生效(不重複空轉)')
    })

    it('harness：零進度守門——整輪掛零即停損', async () => {
        let calls = 0
        await runAiBatchStage({
            log,
            batchSize: 1,
            parallel: 1,
            rounds: 5,
            pickPool: async () => [{ id: 'a' }],
            buildPrompt: async () => 'p',
            callAI: async () => {
                calls++; return { ok: false, error: 'validation' }
            },
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({}),
            onMissed: async () => {},
        })
        assert.equal(calls, 1, '掛零即停——下一輪大概率挑到同一批再敗')
    })

    // ── 2026-09-23 修正之回歸 ──
    it('概念分群:同一篇筆記之多個標籤折疊成同一鍵時只入群一次(此前重複計入:增量與 noteCount 虛增、同篇重複進提煉 prompt)', async () => {
        const notes = [
            { id: '1', concepts: ['Transformer 架構', 'transformer架構'], category: 'c', createdAt: '2026-08-01' }, // 同篇兩種寫法,折疊後同鍵
            { id: '2', concepts: ['Transformer 架構'], category: 'c', createdAt: '2026-08-01' },
        ]
        const t = pickConcepts(notes, [], { minNotes: 2 })
        assert.equal(t.length, 1)
        assert.deepEqual(t[0].notes.map((n) => n.id), ['1', '2'], '同篇只出現一次')
        assert.equal(t[0].gain, 2)
        assert.equal(pickConcepts(notes, [], { minNotes: 3 }).length, 0, '實際只有 2 篇,不得因重複標籤湊滿門檻 3')
        const vocab = await conceptVocabulary(memStore(notes.map((n) => ({ ...n }))))
        assert.match(vocab[0], /\(2\)$/, '詞彙表之使用篇數亦只計一次')
    })

})
