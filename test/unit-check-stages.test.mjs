// unit-check-stages.test.mjs — 本組新增之型別檢查回歸測試
//   涵蓋:expandStage / triageStage / extractStage / relateStage / distillStage / indexStage
//   每條新增檢查至少一個無效輸入案例＋一個有效輸入行為不變之案例(style-guide 第四節)。
// 執行:npx mocha test/unit-check-stages.test.mjs(暫存落 test/_tmp/check-stages-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore } from './tools/memStore.mjs'
import { nullLogger } from './tools/nullLogger.mjs'
import { createClock } from '../src/util/clock.mjs'
import { composeChain, makeMsg } from '../src/core/kernel.mjs'
import { readMd, writeMd } from '../src/md/md.mjs'

import { probeSiteFeed, probeSearchEndpoints, mwProbe, mwSettleClue, stageExpand } from '../src/stages/expandStage.mjs'
import { mwSettleTriage, stageTriage } from '../src/stages/triageStage.mjs'
import { mwSaveClues, stageExtract } from '../src/stages/extractStage.mjs'
import {
    pickCandidates, makeSlugResolver, applyRelationsToNote, markConflict, rebuildRelationIndex,
    mwBuildEdges, mwRebuildRelationIndex, stageRelate, stageRelationIndex
} from '../src/stages/relateStage.mjs'
import { buildWorkflowStages, mwBuildBase, mwRunWorkflow, stageDistill } from '../src/stages/distillStage.mjs'
import { rebuildKnowledgeIndex, mwRebuildKnowledgeIndex, stageKnowledgeIndex } from '../src/stages/indexStage.mjs'

const TMP = path.resolve(`test/_tmp/check-stages-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const log = nullLogger()
const clock = createClock('Asia/Taipei')

describe('unit-check-stages', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ────────────────────────────── expandStage ──────────────────────────────
    describe('expandStage', function() {

        it('probeSiteFeed:clue 非物件 → null;有效物件(非 site)沿既有邏輯回 null,不觸碰 ctx.deps', async () => {
            assert.equal(await probeSiteFeed(null, {}), null)
            assert.equal(await probeSiteFeed('x', {}), null)
            assert.equal(await probeSiteFeed(123, {}), null)
            // 有效物件但非 site 線索:走既有 `clue.type !== 'site'` 判斷回 null;ctx={} 若被誤觸碰 ctx.deps 會直接拋錯
            assert.equal(await probeSiteFeed({ type: 'topic', value: 'k' }, {}), null)
        })

        it('probeSearchEndpoints:clue 非物件 → null;opt 非物件視為{}且不拋錯(以非 keyword/topic 線索避開真實網路請求)', async () => {
            assert.equal(await probeSearchEndpoints(null, {}, {}), null)
            assert.equal(await probeSearchEndpoints('x', {}, {}), null)
            // 有效 clue 物件(非 keyword/topic)＋opt 給非物件:opt 應被靜默視為{}而不拋錯,並沿既有邏輯回 null
            assert.equal(await probeSearchEndpoints({ type: 'site', value: 'k' }, {}, 'not-object'), null)
            assert.equal(await probeSearchEndpoints({ type: 'site', value: 'k' }, {}, 123), null)
        })

        it('mwProbe:opt 非物件視為{};回傳 first 錨點 mw(name=probe、2 候選),有效 opt 亦同', () => {
            const bad = mwProbe('not-object')
            assert.equal(bad.name, 'probe')
            assert.equal(bad.mode, 'first')
            assert.equal(bad.candidates.length, 2)
            const good = mwProbe({ arxivCategories: ['cs.LG'] })
            assert.equal(good.name, 'probe')
            assert.equal(good.candidates.map((c) => c.name).join(','), 'site-feed,search-endpoints')
        })

        it('mwSettleClue:opt 非物件視為{},建構不拋錯;有效輸入結算成功線索落帳 newSources/docsAdded 並更新 frontier(行為不變)', async () => {
            const bad = mwSettleClue('not-object')
            assert.equal(bad.name, 'settleClue')

            const frontier = memStore([{ id: 'c1', type: 'site', value: 'https://e.example', status: 'pending', tries: 0, hits: 1, addedAt: '2026-01-01' }])
            const mw = mwSettleClue({ maxTries: 2 })
            const msg = makeMsg('clue', { id: 'c1', type: 'site', value: 'https://e.example', tries: 0, _outcome: { ok: true, newSources: 2, yieldDocs: 3 } })
            const ctx = { deps: { stores: { frontier }, clock }, log }
            const { halted } = await composeChain([mw])(msg, ctx)
            assert.equal(halted, '', '不短路:恆呼叫 next')
            assert.equal(msg.stats.newSources, 2)
            assert.equal(msg.stats.docsAdded, 3)
            assert.equal((await frontier.get('c1')).status, 'done')
        })

        it('stageExpand:opt 非物件視為{},不拋錯;有效輸入(無待探索線索)行為不變', async () => {
            const bad = stageExpand('not-object')
            assert.equal(typeof bad.run, 'function')

            const frontier = memStore([])
            const stage = stageExpand({})
            const r = await stage.run({ deps: { stores: { frontier }, settings: { knowledge: { frontierPerRun: 5, frontierMaxPending: 0 } }, clock }, log })
            assert.equal(r.ok, true)
            assert.equal(r.detail.picked, 0)
        })
    })

    // ────────────────────────────── triageStage ──────────────────────────────
    describe('triageStage', function() {

        it('stageTriage:opt 非物件視為{},不拋錯;有效輸入(停用預篩)行為不變', async () => {
            const bad = stageTriage('not-object')
            assert.equal(typeof bad.run, 'function')

            const stage = stageTriage({ enabled: false })
            const r = await stage.run({ deps: { settings: { knowledge: {} } }, log })
            assert.equal(r.detail.disabled, true)
        })

        it('mwSettleTriage:讀 doc/_aiItem/_domain,落帳 stores.docs,恆呼叫 next(JSDoc 所述行為之最小驗證)', async () => {
            const docs = memStore([{ id: 'd1', title: 'A' }])
            const mw = mwSettleTriage()
            const msg = makeMsg('doc', { doc: { id: 'd1', title: 'A' }, _aiItem: { relevant: true }, _domain: { reasonOf: () => '' } })
            const ctx = { deps: { stores: { docs }, clock }, log }
            const { halted } = await composeChain([mw])(msg, ctx)
            assert.equal(halted, '')
            assert.equal((await docs.get('d1')).triage, 'relevant')
        })
    })

    // ────────────────────────────── extractStage ──────────────────────────────
    describe('extractStage', function() {

        it('mwSaveClues:opt 非物件視為{},不拋錯;有效輸入回收線索(白名單套用)行為不變', async () => {
            const bad = mwSaveClues('not-object')
            assert.equal(bad.name, 'saveClues')

            const frontier = memStore([])
            const mw = mwSaveClues({})
            const msg = makeMsg('doc', {
                doc: { id: 'd1' },
                _aiItem: { relevant: true, explore: [{ type: 'keyword', value: 'k1', why: 'w' }] },
                _domain: {},
            })
            const ctx = { deps: { stores: { frontier }, clock }, log }
            await composeChain([mw])(msg, ctx)
            assert.equal(msg.stats.explore, 1)
            assert.equal((await frontier.select()).length, 1)
        })

        it('stageExtract:opt 非物件視為{},不拋錯;有效輸入(空 raw 池)行為不變', async () => {
            const bad = stageExtract('not-object')
            assert.equal(typeof bad.run, 'function')

            const docs = memStore([])
            const stage = stageExtract({ domain: { buildPrompt: async () => 'p', isValidItem: () => true }, docsPerBatch: 2, parallel: 1, rounds: 1 })
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: { knowledge: {}, ai: {} } }
            const r = await stage.run({ deps, log })
            assert.equal(r.detail.processed, 0)
            assert.equal(r.stats.aiCalls, 0)
        })
    })

    // ────────────────────────────── relateStage ──────────────────────────────
    describe('relateStage', function() {

        it('pickCandidates:target 非物件 → [];allNotes 非陣列 → [];limit 非非負整數 → 不限(0 仍視為有效值);有效輸入排序不變', () => {
            assert.deepEqual(pickCandidates('x', [], 1), [])
            assert.deepEqual(pickCandidates(undefined, [{ id: 'a' }], 1), [])
            assert.deepEqual(pickCandidates({ id: 'a' }, 'not-array', 1), [])
            assert.deepEqual(pickCandidates({ id: 'a' }, null, 1), [])

            const notes = [
                { id: 'a', concepts: ['x'], category: 'c', createdAt: '2026-01-01' },
                { id: 'b', concepts: ['x'], category: 'c', createdAt: '2026-01-02' },
                { id: 'c', concepts: [], category: 'other', createdAt: '2026-01-03' },
            ]
            const target = { id: 'z', concepts: ['x'], category: 'c' }
            assert.equal(pickCandidates(target, notes, 'not-a-number').length, 3, 'limit 非非負整數:不限,回傳全部候選')
            assert.equal(pickCandidates(target, notes, -1).length, 3, '負數非非負整數:同樣不限')
            assert.deepEqual(pickCandidates(target, notes, 0), [], 'limit=0 為有效非負整數,不得誤當成「不限」')
            assert.deepEqual(pickCandidates(target, notes, 1).map((n) => n.id), ['b'], '分數依共享概念與類別排序不變:同分依 createdAt 新到舊')
        })

        it('makeSlugResolver:candidates 非陣列視為[](任何輸入皆回 null);有效陣列之完全相符/尾碼容錯不變', () => {
            const badResolve = makeSlugResolver('not-array')
            assert.equal(badResolve('anything'), null)
            const badResolve2 = makeSlugResolver(null)
            assert.equal(badResolve2('a-11112222'), null)

            const resolve = makeSlugResolver([{ id: '深度學習於蛋白質結構預測-ab12cd34' }])
            assert.equal(resolve('深度學習於蛋白質結構預測-ab12cd34'), '深度學習於蛋白質結構預測-ab12cd34')
            assert.equal(resolve('深度-學習-於蛋白質-結構預測-ab12cd34'), '深度學習於蛋白質結構預測-ab12cd34', '抄寫誤差由尾碼救回')
            assert.equal(resolve('完全捏造-ffffffff'), null, '幻想 slug 拒收')
        })

        it('applyRelationsToNote:note 無 file 字串 → false;relations/titleOf/cfg 給無效型別皆回退為預設,不拋錯', () => {
            assert.equal(applyRelationsToNote({}, [], () => '', {}), false)
            assert.equal(applyRelationsToNote(null, [], () => '', {}), false)
            assert.equal(applyRelationsToNote({ file: 123 }, [], () => '', {}), false, 'file 非字串視為無 file')

            const file = `${TMP}/note-apply-invalid.md`
            writeMd(file, { title: 'T' }, '# T\n\n內文')
            const note = { id: 't-1', file }
            // relations 非陣列、titleOf 非函數、cfg 非物件:應各自回退為 []／()=>''／{}，不得拋錯
            const ok = applyRelationsToNote(note, 'not-array', 'not-fun', 'not-object')
            assert.equal(ok, true)
            assert.doesNotMatch(readMd(file).body, /## 關聯/, 'relations 非陣列時視為 []:無內容可寫,不產生關聯章節')
        })

        it('applyRelationsToNote:有效輸入(關聯陣列與 titleOf)行為不變', () => {
            const file = `${TMP}/note-apply-valid.md`
            writeMd(file, { title: 'T2' }, '# T2\n\n內文')
            const note = { id: 't-2', file }
            const ok = applyRelationsToNote(note, [{ to: 'other-1', type: '互補搭配', reason: 'r' }], (slug) => `標題-${slug}`, { nowIso: '2026-01-01' })
            assert.equal(ok, true)
            const md = readMd(file)
            assert.match(md.body, /## 關聯/)
            assert.match(md.body, /標題-other-1/)
            assert.deepEqual(md.front.related, ['other-1'])
        })

        it('markConflict:note 無 file 字串 → false;cfg 非物件視為{},不拋錯;有效輸入行為不變(雙寫、冪等)', () => {
            assert.equal(markConflict({}, 's', 't', 'r', {}), false)
            assert.equal(markConflict(null, 's', 't', 'r', {}), false)

            const file = `${TMP}/note-conflict.md`
            writeMd(file, { title: 'C' }, '# C\n\n內文')
            const note = { id: 'c-1', file }
            const ok = markConflict(note, 'other-2', '對方標題', '衝突原因', 'not-object')
            assert.equal(ok, true, 'cfg 非物件視為{}:仍用預設章節標題完成寫入')
            const md = readMd(file)
            assert.match(md.body, /⚠ 衝突與反例/)
            assert.deepEqual(md.front.conflicts, ['other-2'])
            // 冪等:重覆呼叫不重複追加
            markConflict(note, 'other-2', '對方標題', '衝突原因', {})
            const md2 = readMd(file)
            assert.equal((md2.body.match(/other-2/g) || []).length, 1)
        })

        it('rebuildRelationIndex:cfg 非物件或缺 dir → 拋錯;stores 缺 select → 拋錯;有效輸入行為不變', async () => {
            await assert.rejects(() => rebuildRelationIndex({ relations: memStore(), notes: memStore() }, {}), /rebuildRelationIndex 需要 cfg\.dir/)
            await assert.rejects(() => rebuildRelationIndex({ relations: memStore(), notes: memStore() }, 'not-object'), /rebuildRelationIndex 需要 cfg\.dir/)
            await assert.rejects(() => rebuildRelationIndex({}, { dir: TMP }), /rebuildRelationIndex 需要 stores\.relations 與 stores\.notes/)
            await assert.rejects(() => rebuildRelationIndex({ relations: {}, notes: memStore() }, { dir: TMP }), /rebuildRelationIndex 需要 stores\.relations 與 stores\.notes/)

            const dir = `${TMP}/relidx`
            fs.mkdirSync(dir, { recursive: true })
            const stores = {
                notes: memStore([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]),
                relations: memStore([{ id: 'r1', from: 'a', to: 'b', type: '互補搭配', reason: 'x' }]),
            }
            await rebuildRelationIndex(stores, { dir, nowIso: '2026-01-01', indexTitle: '總覽' })
            assert.ok(fs.existsSync(`${dir}/index.md`))
            assert.ok(fs.existsSync(`${dir}/graph.json`))
            const g = JSON.parse(fs.readFileSync(`${dir}/graph.json`, 'utf8'))
            assert.equal(g.edges.length, 1)
        })

        it('mwBuildEdges:opt 非物件視為{},不拋錯;有效輸入組裝邊陣列不變', async () => {
            const bad = mwBuildEdges('not-object')
            assert.equal(bad.name, 'buildEdges')

            const mw = mwBuildEdges({ maxRelationsPerNote: 4 })
            const resolve = (raw) => (raw === 'b-1' ? 'b-1' : null)
            const msg = makeMsg('note', {
                note: { id: 'a-1' },
                _aiItem: { relations: [{ to: 'b-1', type: '互補搭配', reason: 'r' }] },
                _resolver: resolve,
                _domain: { relationTypes: ['互補搭配'], fallbackType: '互補搭配' },
            })
            const { halted } = await composeChain([mw])(msg, { deps: { clock }, log })
            assert.equal(halted, '')
            assert.equal(msg.data._edges.length, 1)
            assert.equal(msg.data._edges[0].to, 'b-1')
        })

        it('mwRebuildRelationIndex/stageRelate/stageRelationIndex:opt 非物件皆視為{},不拋錯', () => {
            assert.equal(mwRebuildRelationIndex('not-object').name, 'rebuild')
            assert.equal(typeof stageRelate('not-object').run, 'function')
            assert.equal(typeof stageRelationIndex('not-object').run, 'function')
        })

        it('stageRelate:有效輸入(筆記不足 2 篇)行為不變', async () => {
            const stage = stageRelate({ domain: {} })
            const bag = {}
            const ctx = {
                deps: { stores: { notes: memStore([{ id: 'only-one' }]) }, settings: {}, ai: null, clock },
                log,
                set: (k, v) => {
                    bag[k] = v
                },
                get: (k, d) => bag[k] ?? d,
            }
            const r = await stage.run(ctx)
            assert.equal(r.detail.targets, 0)
            assert.equal(bag.relateEdges, 0)
        })
    })

    // ────────────────────────────── distillStage ──────────────────────────────
    describe('distillStage', function() {

        const KINDS = { audit: { produces: 'issues', check: () => true, build: ({ draft, issues }) => `A|${draft}|${issues}` } }

        it('buildWorkflowStages:kinds 非物件 → 拋錯;bind 非物件視為{},不拋錯;有效輸入行為不變', () => {
            assert.throws(() => buildWorkflowStages([{ stage: 'audit' }], 'not-object', {}), /buildWorkflowStages 需要 kinds/)
            assert.throws(() => buildWorkflowStages([{ stage: 'audit' }], null, {}), /buildWorkflowStages 需要 kinds/)
            // pipeline 之既有檢查訊息不因新增 kinds/bind 檢查而改變
            assert.throws(() => buildWorkflowStages([], KINDS, {}), /distill pipeline 未設定或為空/)

            const stages = buildWorkflowStages([{ stage: 'audit' }], KINDS, 'not-object')
            assert.equal(stages.length, 1)
            const ctx = { input: 'D0', results: {} }
            assert.equal(stages[0].prompt(ctx), 'A|D0|null', 'bind 非物件視為{}:build 仍正常接住 draft/issues')
        })

        it('mwBuildBase/mwRunWorkflow:opt 非物件皆視為{},不拋錯', () => {
            assert.equal(mwBuildBase('not-object').name, 'buildBase')
            assert.equal(mwRunWorkflow('not-object').name, 'runWorkflow')
        })

        it('stageDistill:opt 非物件視為{},不拋錯;有效輸入(無合格概念/類別)行為不變', async () => {
            const bad = stageDistill('not-object')
            assert.equal(typeof bad.run, 'function')

            const stage = stageDistill({ minNotes: 100, domain: {}, workflow: { wkf: {} } })
            const deps = {
                stores: { notes: memStore([]), cores: memStore([]) },
                settings: { knowledge: { distillPerRun: 2, distillMinNotes: 100 } },
            }
            const r = await stage.run({ deps, log })
            assert.equal(r.detail.concepts, 0)
        })
    })

    // ────────────────────────────── indexStage ──────────────────────────────
    describe('indexStage', function() {

        it('rebuildKnowledgeIndex:cfg 非物件/dir 非字串/stores 缺 select → 拋錯(同一訊息);有效輸入行為不變', async () => {
            await assert.rejects(() => rebuildKnowledgeIndex(), /rebuildKnowledgeIndex 需要 \{ stores, dir \}/)
            await assert.rejects(() => rebuildKnowledgeIndex('not-object'), /rebuildKnowledgeIndex 需要 \{ stores, dir \}/)
            await assert.rejects(() => rebuildKnowledgeIndex({ stores: { notes: memStore(), cores: memStore(), relations: memStore() } }), /rebuildKnowledgeIndex 需要 \{ stores, dir \}/, 'dir 缺漏')
            await assert.rejects(() => rebuildKnowledgeIndex({ dir: TMP, stores: { notes: {}, cores: {}, relations: {} } }), /rebuildKnowledgeIndex 需要 \{ stores, dir \}/, 'stores 缺 select')

            const dir = `${TMP}/kidx`
            fs.mkdirSync(dir, { recursive: true })
            const stores = { notes: memStore([{ id: 'n1', title: 'N1', category: '其他', createdAt: '2026-01-01' }]), cores: memStore([]), relations: memStore([]) }
            const r = await rebuildKnowledgeIndex({ stores, dir, nowIso: '2026-01-01', title: '索引' })
            assert.deepEqual(r, { notes: 1, cores: 0, edges: 0 })
            assert.ok(fs.existsSync(`${dir}/index.md`))
        })

        it('mwRebuildKnowledgeIndex/stageKnowledgeIndex:opt 非物件皆視為{},不拋錯', () => {
            assert.equal(mwRebuildKnowledgeIndex('not-object').name, 'rebuild')
            assert.equal(typeof stageKnowledgeIndex('not-object').run, 'function')
        })
    })

})
