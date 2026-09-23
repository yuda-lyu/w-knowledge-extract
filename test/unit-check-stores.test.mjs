// unit-check-stores.test.mjs — 本組(stores 之 sourcePolicy/docPolicy/frontierPolicy/ingestGate/conceptGroups，
// stages 之 aiBatchStage/collectHelpers/seedSyncStage/listFetchStage/detailFetchStage/docMaintainStage)
// 新增之型別檢查回歸測試。
//
// 既有「有效輸入」行為已由 unit-policies.test.mjs／unit-stages.test.mjs 大量覆蓋，本檔聚焦本組新加之型別檢查本身：
// 每條檢查至少一個無效輸入案例＋一個有效輸入行為不變之最小案例。
// 執行：npx mocha test/unit-check-stores.test.mjs（全檔以 memStore 記憶體替身驗證，無需暫存目錄）

import assert from 'node:assert/strict'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore } from './tools/memStore.mjs'
import { nullLogger } from './tools/nullLogger.mjs'

import { ensureSeedSources, isLowYield, pickDueSources, recordSourceOutcome, cullZeroYieldSources } from '../src/stores/sourcePolicy.mjs'
import { slimTerminalDocs, byRetryTierFifo } from '../src/stores/docPolicy.mjs'
import { saveClues, pickClues, enforceFrontierCap, settleClue } from '../src/stores/frontierPolicy.mjs'
import { normalizeFeedItems, filterFeedItems, admitFeedItems, ingestFeedItems } from '../src/stores/ingestGate.mjs'
import { conceptVocabulary, pickConcepts, pickCategories } from '../src/stores/conceptGroups.mjs'
import { judgeFromDocs } from '../src/stages/collectHelpers.mjs'
import { runAiBatchStage } from '../src/stages/aiBatchStage.mjs'
import { mwSyncSeeds, mwCullSources, stageSeedSync } from '../src/stages/seedSyncStage.mjs'
import { mwFetchList, mwNormalizeItems, mwFilterItems, mwAdmitPersist, mwAccountSource, stageListFetch } from '../src/stages/listFetchStage.mjs'
import { mwTitleSkip, mwRouteFetcher, mwFetchDetail, mwTranscodeLinks, mwFeedFallback, mwPersistOutcome, stageDetailFetch } from '../src/stages/detailFetchStage.mjs'
import { mwSlim, stageDocMaintain } from '../src/stages/docMaintainStage.mjs'
import { composeChain, makeMsg } from '../src/core/kernel.mjs'

const log = nullLogger()
const NOW = '2026-09-23T12:00:00+08:00'

describe('unit-check-stores', function() {

    // ══════════════════════ src/stores/sourcePolicy.mjs ══════════════════════
    describe('sourcePolicy', function() {

        it('ensureSeedSources：sources 缺方法拋錯；seeds 非陣列拋錯；declaredFields 非陣列回退預設仍可同步', async () => {
            await assert.rejects(() => ensureSeedSources({}, []), /ensureSeedSources 需要 sources 集合/)
            const s0 = memStore()
            await assert.rejects(() => ensureSeedSources(s0, 'not-array'), /ensureSeedSources 需要 seeds/)

            const s = memStore([{ id: 'a', tier: 2, name: '舊名' }])
            const r = await ensureSeedSources(s, [{ id: 'a', tier: 1, name: '新名' }], 'not-array')
            assert.equal(r.synced, 1, 'declaredFields 非陣列回退為預設 [tier,name,lang,query]，同步仍生效')
            assert.equal((await s.get('a')).name, '新名')
        })

        it('isLowYield：opt 非物件回退為 {}（不拋錯，等同未給門檻）；有效輸入判定不變', () => {
            assert.doesNotThrow(() => isLowYield({ judged: 10, yielded: 0 }, null))
            assert.equal(isLowYield({ judged: 10, yielded: 0 }, null), false, 'opt 非物件回退為 {}，無門檻即不判定為低產出')
            assert.equal(isLowYield({ judged: 10, yielded: 0 }, { lowYieldRate: 0.3, minJudged: 6 }), true, '有效輸入判定不變')
        })

        it('pickDueSources：sources 缺 select 拋錯；第二參數非物件回退為 {}（limit 未給＝全取語意）', async () => {
            await assert.rejects(() => pickDueSources({}), /pickDueSources 需要 sources 集合/)
            const s = memStore([{ id: 'a', tier: 1, lastFetchAt: '' }, { id: 'b', tier: 2, lastFetchAt: '' }])
            const due = await pickDueSources(s, null)
            assert.equal(due.length, 2, 'opt 非物件回退為 {}，limit 未給維持全取語意')
            const due2 = await pickDueSources(s, { limit: 1 })
            assert.equal(due2.length, 1, '有效輸入 limit 行為不變')
        })

        it('pickDueSources：limit 非非負整數即不限(與 pickClues 同一規則)；minIntervalMs 未給視為 0(已抓過者亦到期)', async () => {
            const past = new Date(Date.now() - 60_000).toISOString()
            const s = memStore([
                { id: 'a', tier: 1, lastFetchAt: '' },
                { id: 'b', tier: 1, lastFetchAt: past },
                { id: 'c', tier: 2, lastFetchAt: past },
            ])
            assert.equal((await pickDueSources(s, { limit: -1 })).length, 3, '負數 limit 不再是 slice(0,-1) 之「去掉最後一筆」')
            assert.equal((await pickDueSources(s, { limit: 1.5 })).length, 3, '非整數 limit 視同未給')
            assert.equal((await pickDueSources(s, { limit: 0 })).length, 0, 'limit 0 仍為取 0 筆')
            assert.deepEqual((await pickDueSources(s, {})).map((x) => x.id), ['a', 'b', 'c'], '未給 minIntervalMs：已抓過者亦到期(此前恆被排除)')
            assert.deepEqual((await pickDueSources(s, { minIntervalMs: 3600_000 })).map((x) => x.id), ['a'], '有效間隔行為不變：1 分鐘前抓過者未到期')
        })

        it('recordSourceOutcome：sources 缺 patch 拋錯；outcome 非物件拋錯；cfg 非物件回退為 {}', async () => {
            const s = memStore([{ id: 'a', name: 'A' }])
            const a = await s.get('a')
            await assert.rejects(() => recordSourceOutcome({}, a, { ok: true }), /recordSourceOutcome 需要 sources 集合/)
            await assert.rejects(() => recordSourceOutcome(s, a, null), /recordSourceOutcome 需要 outcome 物件/)
            const rec = await recordSourceOutcome(s, a, { ok: true, itemCount: 1 }, null)
            assert.equal(rec.disabled, false, 'cfg 非物件回退為 {}，不拋錯且正常寫入')
            assert.equal((await s.get('a')).okCount, 1)
        })

        it('cullZeroYieldSources：sources 缺方法拋錯；judgeOf 非函數拋錯；有效輸入行為不變', async () => {
            const s0 = memStore([{ id: 'a', name: 'A' }])
            await assert.rejects(() => cullZeroYieldSources({}, () => null), /cullZeroYieldSources 需要 sources 集合/)
            await assert.rejects(() => cullZeroYieldSources(s0, 'not-fn'), /cullZeroYieldSources 需要 judgeOf 函數/)

            const s = memStore([{ id: 'a', name: 'A' }])
            const r = await cullZeroYieldSources(s, () => ({ judged: 8, yielded: 0 }), { minJudged: 6, log })
            assert.equal(r.culled, 1, '有效輸入淘汰行為不變')
        })
    })

    // ══════════════════════ src/stores/docPolicy.mjs ══════════════════════
    describe('docPolicy', function() {

        it('slimTerminalDocs：docs 缺方法拋錯；cfg.terminalStatuses 非陣列拋錯；cfg.textFields 非陣列回退預設', async () => {
            const docs = memStore([{ id: '1', status: 'noted', text: 'AAAA', feedText: 'BB' }])
            await assert.rejects(() => slimTerminalDocs({}, { terminalStatuses: ['noted'] }), /slimTerminalDocs 需要 docs 集合/)
            await assert.rejects(() => slimTerminalDocs(docs, {}), /slimTerminalDocs 需要 cfg\.terminalStatuses（狀態陣列）/)
            await assert.rejects(() => slimTerminalDocs(docs), /slimTerminalDocs 需要 cfg\.terminalStatuses（狀態陣列）/, 'cfg 全未給時亦回退為 {} 後同樣視為缺 terminalStatuses')

            const r = await slimTerminalDocs(docs, { terminalStatuses: ['noted'], textFields: 'not-array' })
            assert.equal(r.slimmed, 1, 'textFields 非陣列回退為預設 [text,feedText]，瘦身仍生效')
            assert.equal((await docs.get('1')).text, '')
        })

        it('byRetryTierFifo：triesField 非有效字串回退為 fetchTries；有效輸入排序不變', () => {
            const rows = [{ id: 'a', fetchTries: 2 }, { id: 'b', fetchTries: 0 }]
            assert.deepEqual(rows.slice().sort(byRetryTierFifo(123)).map((r) => r.id), ['b', 'a'], 'triesField 非字串回退為 fetchTries')
            assert.deepEqual(rows.slice().sort(byRetryTierFifo('')).map((r) => r.id), ['b', 'a'], '空字串非有效字串同樣回退')
            assert.deepEqual(rows.slice().sort(byRetryTierFifo('fetchTries')).map((r) => r.id), ['b', 'a'], '有效輸入行為不變')
        })
    })

    // ══════════════════════ src/stores/frontierPolicy.mjs ══════════════════════
    describe('frontierPolicy', function() {

        it('saveClues：frontier 缺方法拋錯；cfg 非物件回退為 {}（仍以預設 types 過濾）', async () => {
            await assert.rejects(() => saveClues({}, [{ type: 'keyword', value: 'x' }]), /saveClues 需要 frontier 集合/)
            const f = memStore()
            const r = await saveClues(f, [{ type: 'keyword', value: 'x' }], null)
            assert.equal(r.addCount, 1, 'cfg 非物件回退為 {}，預設 types 白名單與 maxValueLen 仍生效')
        })

        it('pickClues：frontier 缺 select 拋錯；limit 非非負整數即不限', async () => {
            await assert.rejects(() => pickClues({}), /pickClues 需要 frontier 集合/)
            const f = memStore([
                { id: 'a', type: 'keyword', value: 'a', status: 'pending', hits: 1, addedAt: 'x' },
                { id: 'b', type: 'keyword', value: 'b', status: 'pending', hits: 2, addedAt: 'y' },
            ])
            const unlimited = await pickClues(f, 'not-a-number')
            assert.equal(unlimited.length, 2, 'limit 非非負整數即不限，回傳全部待消化線索')
            const limited = await pickClues(f, 1)
            assert.equal(limited.length, 1, '有效 limit 行為不變')
        })

        it('enforceFrontierCap：frontier 缺方法拋錯；有效輸入淘汰行為不變', async () => {
            await assert.rejects(() => enforceFrontierCap({}, { maxPending: 1 }), /enforceFrontierCap 需要 frontier 集合/)
            const f = memStore([
                { id: 'a', type: 'keyword', value: 'a', status: 'pending', hits: 5, addedAt: 'x' },
                { id: 'b', type: 'keyword', value: 'b', status: 'pending', hits: 1, addedAt: 'y' },
            ])
            const r = await enforceFrontierCap(f, { maxPending: 1, nowIso: NOW })
            assert.deepEqual(r, { pending: 1, evicted: 1 })
        })

        it('settleClue：frontier 缺 patch 拋錯；outcome 非物件拋錯；cfg 非物件回退為 {}', async () => {
            const f0 = memStore([{ id: 'c1', tries: 0 }])
            const c1 = await f0.get('c1')
            await assert.rejects(() => settleClue({}, c1, { ok: true }), /settleClue 需要 frontier 集合/)
            await assert.rejects(() => settleClue(f0, c1, null), /settleClue 需要 outcome 物件/)

            const f = memStore([{ id: 'c1', tries: 0, status: 'pending' }])
            const st = await settleClue(f, await f.get('c1'), { ok: false, error: 'x' }, null)
            assert.equal(st.status, 'pending', 'cfg 非物件回退為 {}，maxTries 預設 2，未達上限仍 pending')
        })
    })

    // ══════════════════════ src/stores/ingestGate.mjs ══════════════════════
    describe('ingestGate', function() {

        const buildCtx = () => {
            const docs = memStore()
            const seen = W.createSeenStore({ collection: docs, identity: W.createIdentity({ keyOf: 'raw' }), log })
            return { deps: { settings: { fetch: { itemsPerSource: 8, maxTextChars: 50 } }, seen, clock: { iso8: () => NOW } }, log }
        }

        it('normalizeFeedItems：o 非物件或缺 ctx.deps 拋錯；有效輸入正規化不變', () => {
            assert.throws(() => normalizeFeedItems([], undefined), /normalizeFeedItems 需要 \{ ctx \}/)
            assert.throws(() => normalizeFeedItems([], { ctx: {} }), /normalizeFeedItems 需要 \{ ctx \}/)
            const ctx = buildCtx()
            const r = normalizeFeedItems([{ url: 'https://a.com/x', title: 'A' }], { source: { id: 's1' }, fetcherId: 'rss', ctx })
            assert.equal(r.items.length, 1, '有效輸入正規化行為不變')
        })

        it('filterFeedItems：o 非物件或缺 ctx.deps 拋錯；有效輸入過濾不變', async () => {
            await assert.rejects(() => filterFeedItems([], null), /filterFeedItems 需要 \{ ctx \}/)
            const ctx = buildCtx()
            const r = await filterFeedItems([{ id: 1 }, { id: 2 }], { ctx, filter: (items) => items.filter((i) => i.id === 1) })
            assert.equal(r.kept.length, 1)
            assert.equal(r.dropped, 1, '有效輸入過濾行為不變')
        })

        it('admitFeedItems：o 非物件或缺 ctx.deps 拋錯；有效輸入入庫不變', async () => {
            await assert.rejects(() => admitFeedItems([], {}), /admitFeedItems 需要 \{ ctx \}/)
            const ctx = buildCtx()
            const n = normalizeFeedItems([{ url: 'https://a.com/x', title: 'A' }], { source: { id: 's1', name: 'S', tier: 2 }, fetcherId: 'rss', ctx })
            const r = await admitFeedItems(n.items, { source: { id: 's1', name: 'S', tier: 2 }, fetcher: { id: 'rss' }, ctx })
            assert.equal(r.fresh.length, 1, '有效輸入入庫行為不變')
        })

        it('ingestFeedItems：o 非物件或缺 ctx.deps 拋錯；有效輸入三步走完不變', async () => {
            await assert.rejects(() => ingestFeedItems([], null), /ingestFeedItems 需要 \{ ctx \}/)
            const ctx = buildCtx()
            const r = await ingestFeedItems([{ url: 'https://a.com/y', title: 'B' }], { source: { id: 's1', name: 'S', tier: 2 }, fetcherId: 'rss', ctx })
            assert.equal(r.fresh.length, 1, '有效輸入行為不變')
        })
    })

    // ══════════════════════ src/stores/conceptGroups.mjs ══════════════════════
    describe('conceptGroups', function() {

        it('conceptVocabulary：notes 缺 select 拋錯；limit 非正整數回退為 60', async () => {
            await assert.rejects(() => conceptVocabulary({}), /conceptVocabulary 需要 notes 集合/)
            const notes = memStore(Array.from({ length: 2 }, (_, i) => ({ id: `${i}`, concepts: ['甲'] })))
            const vocab = await conceptVocabulary(notes, -1)
            assert.match(vocab[0], /^甲\(2\)$/, 'limit 非正整數回退為 60，不影響本例(僅 1 個概念)之輸出')
            const vocab2 = await conceptVocabulary(notes, 1)
            assert.equal(vocab2.length, 1, '有效輸入 limit 行為不變')
        })

        it('pickConcepts：notes／cores 非陣列回傳 []；minNotes 非數值維持「不過濾」語意', () => {
            assert.deepEqual(pickConcepts(null, undefined), [], 'notes/cores 非陣列回傳空陣列')
            const notes = [{ concepts: ['甲'], createdAt: '2026-09-01T00:00:00Z' }, { concepts: ['甲'], createdAt: '2026-09-02T00:00:00Z' }]
            const out = pickConcepts(notes, [], { minNotes: 'abc', now: Date.parse('2026-09-10T00:00:00Z') })
            assert.equal(out.length, 1, 'minNotes 非數值視為 0，維持現行不過濾語意')
            assert.equal(out[0].notes.length, 2)
            const outValid = pickConcepts(notes, [], { minNotes: 3, now: Date.parse('2026-09-10T00:00:00Z') })
            assert.equal(outValid.length, 0, '有效 minNotes 過濾行為不變')
        })

        it('pickCategories：notes／cores 非陣列回傳 []；有效輸入選題行為不變', () => {
            assert.deepEqual(pickCategories(null, null), [])
            const notes = Array.from({ length: 6 }, () => ({ category: '其他' }))
            const out = pickCategories(notes, [], { minNotes: 6, minGain: 4 })
            assert.equal(out.length, 1, '有效輸入行為不變')
        })
    })

    // ══════════════════════ src/stages/collectHelpers.mjs ══════════════════════
    describe('collectHelpers', function() {

        it('judgeFromDocs：docs 非陣列回傳 {}；cfg 非物件回退為 {}；有效輸入統計不變', () => {
            assert.deepEqual(judgeFromDocs(null), {})
            assert.deepEqual(judgeFromDocs(undefined, { yieldStatus: 'x' }), {})
            const docs = [{ sourceId: 's1', status: 'noted' }, { sourceId: 's1', status: 'skip' }, { sourceId: 's2', status: 'new' }]
            assert.deepEqual(judgeFromDocs(docs, null), { s1: { judged: 2, yielded: 1 } }, 'cfg 非物件回退為 {}，不拋錯')
            assert.deepEqual(judgeFromDocs(docs), { s1: { judged: 2, yielded: 1 } }, '有效輸入統計行為不變')
        })
    })

    // ══════════════════════ src/stages/aiBatchStage.mjs ══════════════════════
    describe('aiBatchStage', function() {

        const validBase = () => ({
            pickPool: async () => [],
            buildPrompt: async () => '',
            callAI: async () => ({ ok: true, data: [] }),
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({}),
            onMissed: async () => {},
            batchSize: 2,
            parallel: 1,
            rounds: 1,
            log,
        })

        it('runAiBatchStage：cfg 非物件拋錯；必要函數缺席逐一拋錯', async () => {
            await assert.rejects(() => runAiBatchStage(undefined), /runAiBatchStage 需要 cfg 物件/)
            for (const name of ['pickPool', 'buildPrompt', 'callAI', 'checkResult', 'isValidItem', 'indexOf', 'applyItem', 'onMissed']) {
                await assert.rejects(() => runAiBatchStage({ ...validBase(), [name]: 'not-fn' }), new RegExp(`runAiBatchStage 需要 ${name} 函數`))
            }
        })

        it('runAiBatchStage：batchSize／parallel 非正整數拋錯；rounds 非非負整數拋錯；log 缺 info/warn 拋錯', async () => {
            await assert.rejects(() => runAiBatchStage({ ...validBase(), batchSize: 0 }), /runAiBatchStage 需要 cfg\.batchSize 正整數/)
            await assert.rejects(() => runAiBatchStage({ ...validBase(), parallel: -1 }), /runAiBatchStage 需要 cfg\.parallel 正整數/)
            await assert.rejects(() => runAiBatchStage({ ...validBase(), rounds: -1 }), /runAiBatchStage 需要 cfg\.rounds 非負整數/)
            await assert.rejects(() => runAiBatchStage({ ...validBase(), log: { info: () => {} } }), /runAiBatchStage 需要 cfg\.log（具 info\/warn 函數）/)
        })

        it('runAiBatchStage：onBatchFailed／shouldStop 非函數時視為未給（不拋錯，僅記日誌後續照跑）', async () => {
            const r = await runAiBatchStage({
                ...validBase(),
                pickPool: async () => [{ id: 'a' }],
                callAI: async () => ({ ok: false, error: 'boom', skipped: false }),
                onBatchFailed: 'not-a-function',
                shouldStop: 'not-a-function',
            })
            assert.equal(r.failedBatches, 1, '非函數之 onBatchFailed 視為未給，仍正常記錄失敗批次不拋錯')
        })

        it('runAiBatchStage：有效輸入之部分接受／未涵蓋行為不變', async () => {
            const applied = []
            const missed = []
            const r = await runAiBatchStage({
                ...validBase(),
                batchSize: 3,
                pickPool: async () => [{ index: 1 }, { index: 2 }, { index: 3 }],
                callAI: async () => ({ ok: true, data: [{ index: 1 }, { index: 2 }] }),
                isValidItem: (it) => it.index <= 2,
                applyItem: async (item) => {
                    applied.push(item.index); return { noted: 1 }
                },
                onMissed: async (t) => missed.push(t.index),
            })
            assert.deepEqual(applied, [1, 2])
            assert.deepEqual(missed, [3])
            assert.equal(r.applied.noted, 2)
        })
    })

    // ══════════════════════ src/stages/seedSyncStage.mjs ══════════════════════
    describe('seedSyncStage', function() {

        it('mwSyncSeeds／mwCullSources／stageSeedSync：工廠 opt 非物件不拋錯，回退為 {}', () => {
            assert.equal(mwSyncSeeds(null).name, 'syncSeeds')
            assert.equal(mwCullSources('not-object').name, 'cullSources')
            assert.equal(stageSeedSync(123).name, 'seedSync')
        })

        it('stageSeedSync：有效輸入端到端跑通（種子同步補入宣告欄位＋零產出淘汰停用）', async () => {
            const sources = memStore()
            const docs = memStore([{ id: 'd1', sourceId: 's1', status: 'noted' }])
            const ctx = {
                deps: {
                    stores: { sources, docs },
                    data: {},
                    clock: { iso8: () => NOW },
                    settings: { sourcePolicy: { cullMinJudged: 1 } },
                },
                log,
            }
            const stage = stageSeedSync({ seeds: [{ id: 's1', tier: 1, name: 'S1' }] })
            const r = await stage.run(ctx)
            assert.equal(r.ok, true)
            assert.equal((await sources.get('s1')).name, 'S1', '種子同步生效')
        })
    })

    // ══════════════════════ src/stages/listFetchStage.mjs ══════════════════════
    describe('listFetchStage', function() {

        it('mwNormalizeItems／mwFilterItems／mwAdmitPersist／mwAccountSource／stageListFetch：工廠 opt 非物件不拋錯，回退為 {}', () => {
            assert.equal(mwNormalizeItems(null).name, 'normalizeItems')
            assert.equal(mwFilterItems(undefined).name, 'filterItems')
            assert.equal(mwAdmitPersist('x').name, 'admitPersist')
            assert.equal(mwAccountSource(0).name, 'accountSource')
            assert.equal(stageListFetch(null).name, 'listFetch')
            assert.equal(typeof mwFetchList(), 'object', 'mwFetchList 無 opt 參數，工廠呼叫不受影響')
        })

        it('mwNormalizeItems：opt 非物件回退為 {}，itemsPerSource 改用 settings 預設（不短路，仍走 next）', async () => {
            const mw = mwNormalizeItems(null)
            const msg = makeMsg('source', {
                name: 'S',
                url: 'https://s.example',
                _fetcher: { id: 'rss' },
                _raw: [{ url: 'https://e.com/1', title: 't1' }, { url: 'https://e.com/2', title: 't2' }],
            })
            const ctx = { deps: { settings: { fetch: { itemsPerSource: 1, maxTextChars: 100 } }, seen: null }, log }
            const { halted } = await composeChain([mw])(msg, ctx)
            assert.equal(halted, '')
            assert.equal(msg.data._items.length, 1, 'opt 非物件回退為 {}，itemsPerSource 改用 settings.fetch.itemsPerSource')
        })

        it('mwFilterItems：opt 非物件回退為 {}，等同無 filter（全數放行）', async () => {
            const mw = mwFilterItems(null)
            const msg = makeMsg('source', { name: 'S', _items: [{ id: 1 }, { id: 2 }] })
            await composeChain([mw])(msg, { deps: {}, log })
            assert.equal(msg.data._items.length, 2, 'opt 非物件回退為 {}，filter 未給即放行')
        })

        it('stageListFetch：有效輸入端到端跑通（fetch→normalize→filter→admit→account）', async () => {
            const sources = memStore([{ id: 's1', name: 'S1', kind: 'rss', url: 'https://s1.example/feed', tier: 1, lastFetchAt: '', failCount: 0 }])
            const docs = memStore()
            const seen = W.createSeenStore({ collection: docs, identity: W.createIdentity({ keyOf: 'raw' }), log })
            const fetcher = W.defineFetcher({ id: 'rss', kinds: ['rss'], fetch: async () => [{ url: 'https://e.com/1', title: 'T1' }] })
            const registry = { resolve: () => fetcher, label: () => 'rss' }
            const ctx = {
                deps: {
                    stores: { sources },
                    registry,
                    seen,
                    settings: { fetch: { sourcesPerRun: 5, minSourceIntervalMs: 0, itemsPerSource: 8, maxTextChars: 100 }, sourcePolicy: { maxConsecFails: 8 } },
                    clock: { iso8: () => NOW },
                },
                log,
            }
            const stage = stageListFetch()
            const r = await stage.run(ctx)
            assert.equal(r.ok, true)
            assert.equal(r.detail.newDocs, 1, '有效輸入端到端行為不變')
            assert.ok((await sources.get('s1')).lastFetchAt, '來源計帳生效')
        })
    })

    // ══════════════════════ src/stages/detailFetchStage.mjs ══════════════════════
    describe('detailFetchStage', function() {

        it('mwTitleSkip／mwTranscodeLinks／stageDetailFetch：工廠 opt 非物件不拋錯，回退為 {}', () => {
            assert.equal(mwTitleSkip(null).name, 'titleSkip')
            assert.equal(mwTranscodeLinks('x').name, 'transcodeLinks')
            assert.equal(stageDetailFetch(0).name, 'detailFetch')
            assert.equal(typeof mwRouteFetcher(), 'object', 'mwRouteFetcher 無 opt 參數，工廠呼叫不受影響')
            assert.equal(typeof mwFetchDetail(), 'object', 'mwFetchDetail 無 opt 參數，工廠呼叫不受影響')
            assert.equal(typeof mwFeedFallback(), 'object', 'mwFeedFallback 無 opt 參數，工廠呼叫不受影響')
            assert.equal(typeof mwPersistOutcome(), 'object', 'mwPersistOutcome 無 opt 參數，工廠呼叫不受影響')
        })

        it('mwTitleSkip：opt 非物件回退為 {}，patterns 改用 ctx.deps.data.skipTitlePatterns', async () => {
            const mw = mwTitleSkip(null)
            const msg = makeMsg('doc', { title: '每週精選彙整' })
            const ctx = { deps: { data: { skipTitlePatterns: [/精選彙整/] } }, log }
            await composeChain([mw])(msg, ctx)
            assert.equal(msg.data._titleSkip, true, 'opt 非物件回退為 {}，patterns 改用 ctx.deps.data.skipTitlePatterns')
        })

        it('stageDetailFetch：有效輸入端到端跑通（含 onFail：達 maxFetchTries 標 dead，務必保留）', async () => {
            const docs = memStore([{ id: 'a', status: 'new', fetchTries: 2 }])
            const boomMw = {
                __kind: 'mw',
                name: 'boom',
                handle: async () => {
                    throw new Error('逐篇鏈異常')
                },
            }
            const deps = { stores: { docs }, settings: { fetch: { articlesPerRun: 5, maxFetchTries: 3 } }, clock: { iso8: () => NOW } }
            const r = await stageDetailFetch({ chain: [boomMw] }).run({ deps, log })
            assert.equal(r.stats.fail, 1)
            const a = await docs.get('a')
            assert.equal(a.status, 'dead', 'onFail 達 maxFetchTries 標 dead(此檢查用於確認重構未破壞 onFail 邏輯)')
            assert.ok(a.deadAt)
        })
    })

    // ══════════════════════ src/stages/docMaintainStage.mjs ══════════════════════
    describe('docMaintainStage', function() {

        it('mwSlim／stageDocMaintain：工廠 opt 非物件不拋錯，回退為 {}', () => {
            assert.equal(mwSlim(null).name, 'slim')
            assert.equal(stageDocMaintain('x').name, 'docMaintain')
        })

        it('stageDocMaintain：有效輸入端到端跑通（終態瘦身）', async () => {
            const docs = memStore([{ id: '1', status: 'noted', text: 'AAAA', feedText: 'BB' }])
            const stage = stageDocMaintain()
            const r = await stage.run({ deps: { stores: { docs }, settings: { fetch: { terminalStatuses: ['noted'] } } }, log })
            assert.equal(r.ok, true)
            assert.equal((await docs.get('1')).text, '', '有效輸入瘦身行為不變')
        })
    })

})
