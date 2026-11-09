// unit-extract-rollback.test.mjs — 核心回退 rollbackCore(規則帳本 EXT-40;使用端 Gitea #109 §3):
//   既有能力盤點:無任何既有 ops 可回到指定版本(regenCore 為打掉重練、.prev 只有上一份、archive 為壞檔／重練／分身、essenceHistory 與 history 不足以逆推)→ 新增 rollbackCore
//   B1 回退成功:version 回指定值、md 重渲染(與該版當時之 md 逐位元組同)、被回退之版本在封存目錄(狀態檔複本)、changelog 多一筆 rollback(produced.stage rollback、
//      不呼叫 AI → seat／provider 同時 null、stamp null)、cores 記錄隨之;該核心之待判結案(比照 regenCore),他核心之待判不動;回退後下一輪依既有選篇規則重新處理被回退之筆記
//   B2 不可回退者明確拒絕(refused 原因碼),不改任何東西:找不到、toVersion 非非負整數、不低於現版、上一份之版本不符、上一份即同版(只落帳之寫入覆蓋)、
//      無上一份、現版狀態檔讀不了;管線持鎖中拒絕
//   B3 預演不寫、輸入檢核
// 執行:自套件根 node <mocha> test/unit-extract-rollback.test.mjs(暫存 test/_tmp/extract-rollback-<pid>;不連網、不呼叫真 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { acquireLock, listHolds, putHold } from '../src/core/capturePackage.mjs'
import { rollbackCore, ROLLBACK_REFUSED } from '../src/ops/rollbackCore.mjs'
import { coreVersionsByProvenance } from '../src/ops/coreVersionsByProvenance.mjs'
import { scriptAi, draftAll, readState } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots, resetConceptFold, landNote, buildTestExtractor, withStores, seedNotes, fileLogFactory, PKG_ROOT } from './tools/extractTestKit.mjs'
import { sleep } from './tools/captureForTest.mjs'

const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version
const concept = '視差量測'

describe('unit-extract-rollback', function() {

    this.timeout(120_000)

    let root = ''
    let flow = null
    let ai = null
    let core = null // 核心記錄(id、file)
    const N = {}
    const snap = {} // v1、v2 當時之 md 與狀態
    const dirs = () => flow.info().dirs
    const stateFile = () => `${dirs().core}/${core.id}.state.json`
    const prevFile = () => `${dirs().state}/core/prev/${core.id}.state.prev.json`
    const roll = (o = {}) => withStores(flow, (s) => rollbackCore(s, concept, { dirs: dirs(), domain: flow.info().domains.extract, ...o }))
    const coreRec = async () => (await withStores(flow, (s) => s.cores.select())).find((c) => c.concept === concept)
    /** 現況之指紋:狀態檔、.prev、md、cores 記錄、封存目錄之清單(預演與拒絕不得改任何一項) */
    const fingerprint = async () => JSON.stringify({
        state: fs.readFileSync(stateFile(), 'utf8'),
        prev: fs.existsSync(prevFile()) ? fs.readFileSync(prevFile(), 'utf8') : null,
        md: fs.readFileSync(core.file, 'utf8'),
        rec: await coreRec(),
        archive: fs.existsSync(`${dirs().state}/core/archive`) ? fs.readdirSync(`${dirs().state}/core/archive`).sort() : [],
    })

    before(async () => {
        root = tmpRoot('extract-rollback')
        resetConceptFold()
        ai = scriptAi({ draft: draftAll })
        ;({ flow } = buildTestExtractor(root, { aiAdapter: ai, scheduleLimitMin: 55, logFactory: fileLogFactory(() => flow) }))
        const notesDir = `${root}/knowledge/notes`
        N.a = landNote(notesDir, { doc: 'a', title: '恆星視差之量測', concepts: [concept] })
        N.b = landNote(notesDir, { doc: 'b', title: '視差誤差之修正', concepts: [concept] })
        await seedNotes(flow, [N.a, N.b])
        await flow.run() // v1
        core = await coreRec()
        snap.md1 = fs.readFileSync(core.file, 'utf8')
        snap.st1 = readState({ dirs: dirs() }, core.id)
        snap.noPrev = await roll({ dryRun: true }) // 只跑過一輪:尚無 .prev(新核心首次寫入無前一份)
        await sleep(1100)
        N.c = landNote(notesDir, { doc: 'c', title: '視差量測之新方法', concepts: [concept] })
        await withStores(flow, (s) => s.notes.insertNew([N.c]))
        await flow.run() // v2
        core = await coreRec()
        snap.md2 = fs.readFileSync(core.file, 'utf8')
        snap.st2 = readState({ dirs: dirs() }, core.id)
    })
    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    it('前提:兩輪後現為 v2、.prev 為 v1(升版之寫入前之上一份);兩版之 md 不同', () => {
        assert.deepEqual([snap.st1.version, snap.st2.version], [1, 2])
        assert.equal(JSON.parse(fs.readFileSync(prevFile(), 'utf8')).version, 1)
        assert.notEqual(snap.md1, snap.md2)
    })

    describe('B2 不可回退者明確拒絕(不改任何東西)', () => {
        const refuse = async (o, code, re) => {
            const before = await fingerprint()
            const r = await roll(o)
            assert.equal(r.ok, false, JSON.stringify(r))
            assert.equal(r.refused, code)
            assert.ok(Array.isArray(r.archived) && r.archived.length === 0 && Array.isArray(r.holdsResolved) && r.holdsResolved.length === 0)
            if (re) assert.match(r.messages.join('｜'), re)
            assert.equal(await fingerprint(), before, '拒絕不改任何東西')
            return r
        }

        it('找不到概念 → no-core(notFound);conceptArg 非字串 → 同形拒絕', async () => {
            const r = await withStores(flow, (s) => rollbackCore(s, '不存在之概念', { dirs: dirs(), domain: flow.info().domains.extract }))
            assert.deepEqual([r.ok, r.refused, r.notFound], [false, ROLLBACK_REFUSED.noCore, true])
            const r2 = await withStores(flow, (s) => rollbackCore(s, undefined, { dirs: dirs(), domain: flow.info().domains.extract }))
            assert.deepEqual([r2.ok, r2.refused], [false, ROLLBACK_REFUSED.noCore])
        })

        it('toVersion 非非負整數 → to-version-invalid', async () => {
            for (const v of [-1, 1.5, '1', true, NaN]) await refuse({ toVersion: v }, 'to-version-invalid', /toVersion 須為非負整數/)
            const echo = await roll({ toVersion: 'ZZ-INPUT-ECHO' })
            assert.ok(!echo.messages.join('｜').includes('ZZ-INPUT-ECHO'), '訊息不回顯輸入值(輸入參數之檢測機制)')
        })

        it('toVersion 不低於現版 → to-version-not-lower', async () => {
            await refuse({ toVersion: 2 }, 'to-version-not-lower', /現為 v2，toVersion 2 不低於現版/)
            await refuse({ toVersion: 7 }, 'to-version-not-lower')
        })

        it('上一份之版本不是 toVersion(只可回到 .prev 之版本;來源唯一為 .prev,不由 changelog 逆推)→ version-unavailable,訊息載明 .prev 之版本', async () => {
            await refuse({ toVersion: 0 }, 'version-unavailable', /上一份狀態（\.prev）為 v1，無從回到 v0/)
        })

        it('上一份與現版同版(只落帳之寫入已把 .prev 覆蓋為同版)→ version-unavailable', async () => {
            const keep = fs.readFileSync(prevFile(), 'utf8')
            fs.writeFileSync(prevFile(), fs.readFileSync(stateFile(), 'utf8'))
            try {
                await refuse({ toVersion: 1 }, 'version-unavailable', /上一份狀態（\.prev）為 v2，無從回到 v1/)
                await refuse({}, 'to-version-not-lower', /不低於現版/) // 未給 toVersion＝上一份之版本(此時即現版)
            }
            finally {
                fs.writeFileSync(prevFile(), keep)
            }
        })

        it('無上一份(.prev 不存在)→ no-prev;壞檔之 .prev 亦然', async () => {
            const keep = fs.readFileSync(prevFile(), 'utf8')
            try {
                fs.rmSync(prevFile())
                await refuse({}, 'no-prev', /無上一份狀態（\.prev）可讀（missing）/)
                fs.writeFileSync(prevFile(), '{ 壞檔')
                await refuse({ toVersion: 1 }, 'no-prev', /（corrupt）/)
            }
            finally {
                fs.writeFileSync(prevFile(), keep)
            }
        })

        it('現版狀態檔讀不了(壞檔)→ state-unreadable(先跑維護修復;回退不在壞檔上動作)', async () => {
            const keep = fs.readFileSync(stateFile(), 'utf8')
            try {
                fs.writeFileSync(stateFile(), '{ 壞檔')
                const r = await roll({ toVersion: 1 })
                assert.deepEqual([r.ok, r.refused], [false, ROLLBACK_REFUSED.stateUnreadable])
                assert.equal(fs.readFileSync(stateFile(), 'utf8'), '{ 壞檔', '不動')
            }
            finally {
                fs.writeFileSync(stateFile(), keep)
            }
        })

        it('上一份屬另一概念 → prev-mismatch', async () => {
            const keep = fs.readFileSync(prevFile(), 'utf8')
            try {
                const p = JSON.parse(keep)
                p.concept = '另一個概念'
                fs.writeFileSync(prevFile(), JSON.stringify(p))
                await refuse({}, 'prev-mismatch', /上一份狀態屬概念「另一個概念」/)
            }
            finally {
                fs.writeFileSync(prevFile(), keep)
            }
        })

        it('管線持鎖中 → 拒絕(locked),不動任何東西', async () => {
            const lockFile = `${root}/tmp/run.lock`
            const held = acquireLock(lockFile)
            try {
                const before = await fingerprint()
                const r = await roll({ lockFile, staleMs: 60_000 })
                assert.deepEqual([r.ok, r.locked], [false, true])
                assert.equal(await fingerprint(), before)
            }
            finally {
                held.release()
            }
        })

        it('只跑過一輪之新核心(尚無 .prev;首次寫入無前一份)→ no-prev', () => {
            assert.deepEqual([snap.noPrev.ok, snap.noPrev.refused], [false, ROLLBACK_REFUSED.noPrev])
        })
    })

    describe('B3 預演與輸入檢核', () => {
        it('預演:列計畫(來源版本、目標版本、將結案之待判)、不寫任何東西', async () => {
            const before = await fingerprint()
            const r = await roll({ dryRun: true })
            assert.deepEqual([r.ok, r.dryRun, r.fromVersion, r.toVersion, r.archived, r.holdsResolved], [true, true, 2, 1, [], []])
            assert.deepEqual(r.plan, { coreId: core.id, fromVersion: 2, toVersion: 1, archive: true, holds: [] })
            assert.equal(await fingerprint(), before)
            assert.match(r.messages.join('｜'), /預演：將回退「視差量測」v2 → v1/)
        })

        it('輸入檢核:stores 缺本函數用到之集合方法、opt.dirs 缺 core／state、opt.domain 缺 renderState、holds 缺方法即拋', async () => {
            const dom = flow.info().domains.extract
            const okStores = () => ({ cores: { select: async () => [], replace: async () => {} }, notes: { select: async () => [] }, holds: { get: async () => null, replace: async () => {}, select: async () => [] } })
            await assert.rejects(() => rollbackCore(undefined, 'x', { dirs: dirs(), domain: dom }), /rollbackCore 需要 stores\.cores\.select 與 stores\.cores\.replace/)
            await assert.rejects(() => rollbackCore({ cores: { select: async () => [] } }, 'x', { dirs: dirs(), domain: dom }), /rollbackCore 需要 stores\.cores\.select 與 stores\.cores\.replace/)
            await assert.rejects(() => rollbackCore({ cores: okStores().cores }, 'x', { dirs: dirs(), domain: dom }), /rollbackCore 需要 stores\.notes\.select/)
            await assert.rejects(() => rollbackCore(okStores(), 'x', {}), /rollbackCore 需要 opt\.dirs/)
            await assert.rejects(() => rollbackCore(okStores(), 'x', { dirs: { core: 'c' }, domain: dom }), /rollbackCore 需要 opt\.dirs/)
            await assert.rejects(() => rollbackCore(okStores(), 'x', { dirs: dirs() }), /rollbackCore 需要 opt\.domain/)
            await assert.rejects(() => rollbackCore(okStores(), 'x', { dirs: dirs(), domain: {} }), /rollbackCore 需要 opt\.domain/)
            await assert.rejects(() => rollbackCore({ ...okStores(), holds: {} }, 'x', { dirs: dirs(), domain: dom }), /rollbackCore 需要 holds 集合/)
        })
    })

    describe('B1 回退成功', () => {
        let r = null
        let ctx = null

        before(async () => {
            // 該核心與他核心各一則待判:回退只結案該核心之
            await withStores(flow, async (s) => {
                await putHold(s.holds, { object: 'claim', oid: `${core.id}:C1`, std: 'ES9', reason: '相關之未結待判', next: 'n', owner: 'user' }, '2026-11-08T12:00:00+08:00')
                await putHold(s.holds, { object: 'claim', oid: 'other-core:C1', std: 'ES9', reason: '他核心之待判', next: 'n', owner: 'user' }, '2026-11-08T12:00:00+08:00')
            })
            ctx = { recBefore: await coreRec() }
            r = await roll({ stamp: 'RB1', by: '王小明' })
        })

        it('回傳 ok、來源／目標版本、被回退之版本之封存檔(狀態檔複本,標記 rollback)、結案之待判鍵、寫入之產出鏈', () => {
            assert.deepEqual([r.ok, r.concept, r.coreId, r.fromVersion, r.toVersion], [true, concept, core.id, 2, 1])
            assert.equal(r.archived.length, 1)
            assert.match(r.archived[0], new RegExp(`/core/archive/${core.id}\\.state\\.json\\.rollback-RB1$`))
            assert.equal(r.holdsResolved.length, 1)
            assert.equal(r.produced.stage, 'rollback')
        })

        it('被回退之版本在封存目錄:內容即回退前之現版(v2)狀態,含其 changelog 與 produced', () => {
            const arc = JSON.parse(fs.readFileSync(r.archived[0], 'utf8'))
            assert.equal(arc.version, 2)
            assert.deepEqual(arc.changelog.map((e) => e.version), [1, 2])
            assert.deepEqual(arc.changelog[1].produced, snap.st2.changelog[1].produced)
            assert.equal(arc.rev, snap.st2.rev, '複本即回退前之原檔')
        })

        it('狀態:version 回到 1、內容為 v1 當時之條目與已用筆記;rev 續增(CAS 之序號不倒退)', () => {
            const st = readState({ dirs: dirs() }, core.id)
            assert.equal(st.version, 1)
            assert.deepEqual(st.claims, snap.st1.claims)
            assert.deepEqual(st.consumed, snap.st1.consumed)
            assert.deepEqual(st.essence, snap.st1.essence)
            assert.ok(st.rev > snap.st2.rev, `rev ${st.rev} 須大於回退前 ${snap.st2.rev}`)
        })

        it('changelog:v1 之歷史原樣保留,另多一筆 rollback(mode、from、by、批沿用 v1 末筆);其 produced 為不呼叫 AI 之形(seat／provider 同時 null、stamp null)、stage rollback', () => {
            const st = readState({ dirs: dirs() }, core.id)
            assert.equal(st.changelog.length, snap.st1.changelog.length + 1, 'changelog 多一筆')
            assert.deepEqual(st.changelog.slice(0, -1), snap.st1.changelog, 'v1 之歷史不動')
            const e = st.changelog[st.changelog.length - 1]
            assert.deepEqual([e.version, e.mode, e.from, e.by], [1, 'rollback', 2, '王小明'])
            assert.deepEqual(e.batch, snap.st1.changelog[snap.st1.changelog.length - 1].batch)
            const p = e.produced
            assert.deepEqual(Object.keys(p), ['v', 'stamp', 'stage', 'seat', 'provider', 'pkg', 'at'], '規格 §2.1 之單一產出者形(不呼叫 AI)')
            assert.deepEqual([p.v, p.stamp, p.stage, p.seat, p.provider, p.pkg], [1, null, 'rollback', null, null, `w-knowledge-extract@${PKG_VERSION}`])
            assert.match(p.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
            assert.deepEqual(r.produced, p)
        })

        it('md 重渲染:與該版當時之 md 逐位元組相同;cores 記錄之 version 回到 1、rev 不倒退', async () => {
            assert.equal(fs.readFileSync(core.file, 'utf8'), snap.md1)
            const rec = await coreRec()
            assert.equal(rec.version, 1)
            assert.ok(rec.rev >= ctx.recBefore.rev, `記錄 rev ${rec.rev} 不得小於回退前 ${ctx.recBefore.rev}`)
            assert.deepEqual([rec.id, rec.file, rec.status], [core.id, core.file, 'active'])
        })

        it('該核心之待判已結案、他核心之待判不動;md 無「手改另存」(現版之 md 不被當成手改)', async () => {
            const open = await withStores(flow, (s) => listHolds(s.holds, { status: 'open' }))
            assert.deepEqual(open.map((h) => h.oid), ['other-core:C1'])
            const manual = `${dirs().state}/core/manual`
            assert.ok(!fs.existsSync(manual) || fs.readdirSync(manual).length === 0, '無手改另存')
        })

        it('依產出鏈取版本:現行狀態之 rollback 版本可被選出(stage rollback;provider null);被回退之 v2 不在現行狀態', async () => {
            const rows = await withStores(flow, (s) => coreVersionsByProvenance(s, { dirs: dirs(), stage: 'rollback' }))
            assert.deepEqual(rows.map((x) => [x.concept, x.version, x.produced.stage]), [[concept, 1, 'rollback']])
            const noAiRows = await withStores(flow, (s) => coreVersionsByProvenance(s, { dirs: dirs(), provider: null, seat: null }))
            assert.deepEqual(noAiRows.map((x) => x.produced.stage), ['rollback'], '不呼叫 AI 之寫入以 provider／seat 為 null 選出')
            assert.deepEqual((await withStores(flow, (s) => coreVersionsByProvenance(s, { dirs: dirs(), stage: 'extract' }))).map((x) => x.version), [1], 'v1 之原產出鏈仍在')
        })

        it('回退後下一輪依既有選篇規則重新處理被回退之筆記:再升為 v2(stage extract,新 stamp);封存之舊 v2 不動', async () => {
            await sleep(1100)
            const rep = await flow.run()
            assert.equal(rep.ok, true)
            const st = readState({ dirs: dirs() }, core.id)
            assert.equal(st.version, 2)
            const e = st.changelog[st.changelog.length - 1]
            assert.deepEqual([e.mode, e.produced.stage], ['delta', 'extract'])
            assert.deepEqual(st.changelog.map((x) => x.mode), ['delta', 'rollback', 'delta'])
            assert.ok(fs.existsSync(r.archived[0]), '封存之舊 v2 仍在')
            assert.equal(JSON.parse(fs.readFileSync(r.archived[0], 'utf8')).version, 2)
        })
    })
})
