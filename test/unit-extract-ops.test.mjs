// unit-extract-ops.test.mjs — 提煉之維運:regenCore(打掉重練)、listCores(列出核心)——型別檢查(無效輸入拋錯或回同形失敗物件)與有效輸入之行為
// 執行:在套件根 node <mocha> test/unit-extract-ops.test.mjs(暫存落 test/_tmp/extract-ops-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { regenCore, listCores } from '../src/ops/regenCore.mjs'
import { normalizeConcept, acquireLock } from '../src/core/capturePackage.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { memStore } from './tools/captureForTest.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'

let TMP = '' // 專用暫存根(tmpRoot:套件根下 test/_tmp/<名>-<pid>,與 cwd 無關;並行之多個 mocha 行程互不干擾)

describe('unit-extract-ops', function() {

    before(function() {
        TMP = tmpRoot('extract-ops')
    })

    after(function() {
        removeRoots([TMP])
    })

    describe('regenCore／listCores', function() {
        it('listCores：stores 非物件或缺 stores.cores.select 拋錯', async () => {
            await assert.rejects(() => listCores(undefined), /listCores 需要 stores\.cores\.select（cores 集合）/)
            await assert.rejects(() => listCores({}), /listCores 需要 stores\.cores\.select（cores 集合）/)
        })

        it('listCores：有效輸入行為不變(依 noteCount 降冪排序)', async () => {
            const list = await listCores({ cores: memStore([{ id: 'a', noteCount: 1 }, { id: 'b', noteCount: 5 }]) })
            assert.deepEqual(list.map((c) => c.id), ['b', 'a'])
        })

        it('regenCore：stores 缺本函數實際用到之集合方法、或缺 opt.dirs 即拋錯;conceptArg 非有效字串回同形失敗物件(不拋錯)', async () => {
            // 完整之集合替身(regenCore 實際用到 cores.select、cores.del、notes.select、holds 之 get／replace／select)
            const full = () => ({ cores: { select: async () => [], del: async () => {} }, notes: memStore(), holds: memStore() })
            const dirs = { core: `${TMP}/regen0/core`, state: `${TMP}/regen0/state` }
            const r = await regenCore(full(), undefined, { dirs })
            assert.deepEqual(r, { ok: false, notFound: true, archived: [], holdsResolved: [], messages: ['找不到概念「undefined」的核心知識'] })
            const r2 = await regenCore(full(), 123, { dirs })
            assert.equal(r2.notFound, true)
            await assert.rejects(() => regenCore(undefined, 'x', { dirs }), /regenCore 需要 stores\.cores\.select（cores 集合）/)
            await assert.rejects(() => regenCore({}, 'x', { dirs }), /regenCore 需要 stores\.cores\.select（cores 集合）/)
            // 缺集合介面之 del 或 notes 方法者開頭即拋錯(不等到封存之後才拋原生 TypeError 而留下半套狀態)
            await assert.rejects(() => regenCore({ cores: { select: async () => [] }, notes: memStore() }, 'x', { dirs }), /regenCore 需要 stores\.cores\.del（集合介面之刪除）/)
            await assert.rejects(() => regenCore({ cores: { select: async () => [], del: async () => {} }, holds: memStore() }, 'x', { dirs }), /regenCore 需要 stores\.notes\.select（notes 集合）/)
            // holds 為必給(該核心之待判須隨重練結案;集合必開):缺者開頭即拋
            await assert.rejects(() => regenCore({ cores: { select: async () => [], del: async () => {} }, notes: memStore() }, 'x', { dirs }), /regenCore 需要 holds 集合（具 get／replace／select 方法；請於每輪依賴之 stores 給 holds 集合）——該核心之未結待判須隨重練結案/)
            // 狀態檔與封存目錄取自 opt.dirs,缺者開頭即拋錯
            await assert.rejects(() => regenCore(full(), 'x'), /regenCore 需要 opt\.dirs（同每輪依賴之 dirs：核心狀態檔與封存目錄由此取得）/)
            await assert.rejects(() => regenCore(full(), 'x', { dirs: { core: dirs.core } }), /regenCore 需要 opt\.dirs（同每輪依賴之 dirs：核心狀態檔與封存目錄由此取得）/)
        })

        it('regenCore：意圖先記 → 封存狀態檔(連 .prev)與 md → 刪記錄(集合介面)→ 標 done;失敗帳不直接改(由管線開工消化意圖);筆記與其 extractedAt 不動;預演不寫', async () => {
            const dirs = { core: `${TMP}/regen1/core`, state: `${TMP}/regen1/state` }
            fs.mkdirSync(dirs.core, { recursive: true })
            fs.mkdirSync(`${dirs.state}/core/prev`, { recursive: true })
            const coreFile = `${dirs.core}/core1.md`
            fs.writeFileSync(coreFile, '# x', 'utf8')
            fs.writeFileSync(`${dirs.core}/core1.state.json`, '{"v":3,"rev":3}', 'utf8')
            fs.writeFileSync(`${dirs.state}/core/prev/core1.state.prev.json`, '{"v":3,"rev":2}', 'utf8')
            // 失敗帳之鍵為「scope|分群鍵」(分群鍵經 normalizeConcept,依當下之折疊)
            const ledgerText = JSON.stringify({ [`concept|${normalizeConcept('風險')}`]: { tries: 2, noteTries: { n1: 1 } }, 'concept|其他': { tries: 1 } })
            fs.writeFileSync(`${dirs.state}/extract-attempts.json`, ledgerText, 'utf8')
            const cores = memStore([{ id: 'core1', concept: '風險', scope: 'concept', version: 2, noteCount: 5, file: coreFile }])
            const notes = memStore([
                { id: 'n1', concepts: ['風險'], extractedAt: '2026-09-01' },
                { id: 'n2', concepts: ['其他'], extractedAt: '2026-09-01' },
            ])
            const stores = { cores, notes, holds: memStore() }
            // 預演:列計畫、不寫
            const d = await regenCore(stores, '風險', { dirs, stamp: 'T1', dryRun: true })
            assert.deepEqual([d.ok, d.dryRun, d.archived, d.plan.record, d.plan.holds, d.plan.stamp, !!d.plan.state, !!d.plan.prev, !!d.plan.md], [true, true, [], true, [], 'T1', true, true, true], '「opt.dryRun:只回 plan,不寫任何東西」')
            assert.ok(fs.existsSync(coreFile) && await cores.get('core1') && !fs.existsSync(`${dirs.state}/extract-regen.json`), '預演未寫')
            const r = await regenCore(stores, '風險', { dirs, stamp: 'T1', by: '王小明' })
            assert.equal(r.ok, true)
            assert.equal(r.availableNotes, 1)
            assert.equal(await cores.get('core1'), null, '核心記錄已刪(集合介面之 del)')
            assert.ok(!fs.existsSync(coreFile) && !fs.existsSync(`${dirs.core}/core1.state.json`) && !fs.existsSync(`${dirs.state}/core/prev/core1.state.prev.json`), '原位置不再有 md、狀態檔與 .prev')
            assert.ok(fs.existsSync(`${dirs.state}/core/archive/core1.md.regen-T1.md`), 'md 改名封存(不刪)')
            assert.ok(fs.existsSync(`${dirs.state}/core/archive/core1.state.json.regen-T1`) && fs.existsSync(`${dirs.state}/core/archive/core1.state.prev.json.regen-T1`), '狀態檔與 .prev 改名封存(不刪)')
            assert.equal(fs.readFileSync(`${dirs.state}/extract-attempts.json`, 'utf8'), ledgerText, '「失敗帳由管線開工時消化已完成之意圖而清;本函數不直接改帳」')
            const it = JSON.parse(fs.readFileSync(`${dirs.state}/extract-regen.json`, 'utf8')).cores.core1
            assert.deepEqual([it.key, it.scope, it.concept, it.stamp, it.by, it.done, typeof it.at, typeof it.doneAt], [normalizeConcept('風險'), 'concept', '風險', 'T1', '王小明', true, 'string', 'string'], '意圖已記並標 done')
            assert.equal((await notes.get('n1')).extractedAt, '2026-09-01', '不清 extractedAt(已用過是逐核心之 consumed)')
            assert.equal((await notes.get('n2')).extractedAt, '2026-09-01')
            assert.ok(r.messages.includes('重練意圖已記（管線下一輪開工時清其失敗帳與影響留待，再以現有筆記從頭重練）'), r.messages.join('；'))
        })

        it('regenCore：續作——意圖已記而記錄已刪(中斷於刪記錄之後)者,重跑同概念依意圖續作(沿用時戳、封存殘留之 md、標 done);同時戳再封存撞名加序號', async () => {
            const dirs = { core: `${TMP}/regen2/core`, state: `${TMP}/regen2/state` }
            fs.mkdirSync(dirs.core, { recursive: true })
            fs.mkdirSync(dirs.state, { recursive: true })
            const coreFile = `${dirs.core}/k.md`
            fs.writeFileSync(coreFile, '# 殘留', 'utf8')
            fs.writeFileSync(`${dirs.state}/extract-regen.json`, JSON.stringify({ cores: { k: { key: normalizeConcept('甲'), scope: 'concept', concept: '甲', stamp: 'T7', by: 'x', at: '2026-10-01T00:00:00+08:00', done: false } } }), 'utf8')
            const stores = { cores: memStore([]), notes: memStore([{ id: 'n1', concepts: ['甲'] }]), holds: memStore() }
            const r = await regenCore(stores, '甲', { dirs, stamp: 'T9' })
            assert.deepEqual([r.ok, r.notFound, r.concept, r.version, r.availableNotes], [true, false, '甲', null, 1], '記錄不在而有未完成之意圖 → 續作(非 notFound)')
            assert.deepEqual(r.archived, [`${dirs.state}/core/archive/k.md.regen-T7.md`], '沿用意圖之時戳,封存殘留之 md')
            assert.match(r.messages[0], /前次重練（T7）中斷於刪記錄之後，續作/)
            const it = JSON.parse(fs.readFileSync(`${dirs.state}/extract-regen.json`, 'utf8')).cores.k
            assert.deepEqual([it.done, it.stamp, it.at], [true, 'T7', '2026-10-01T00:00:00+08:00'])
            // 撞名:同 id 同時戳再封存 → -1 序號
            fs.writeFileSync(coreFile, '# 再來', 'utf8')
            await stores.cores.insertNew([{ id: 'k', concept: '甲', scope: 'concept', version: 1, noteCount: 1, file: coreFile }])
            const r2 = await regenCore(stores, '甲', { dirs, stamp: 'T7' })
            assert.deepEqual(r2.archived, [`${dirs.state}/core/archive/k.md.regen-T7-1.md`], '撞名加序號,不覆寫前一份')
            assert.equal(fs.readFileSync(`${dirs.state}/core/archive/k.md.regen-T7.md`, 'utf8'), '# 殘留')
        })
    })

    it('regenCore:刪核心記錄、md 改名封存;以 normalizeConcept 比對;找不到回 notFound;管線持鎖中拒絕;listCores 依版本降冪且排除已併入之分身', async () => {
        const dirs = { core: `${TMP}/core`, state: `${TMP}/state` }
        const file = `${dirs.core}/k1.md`
        writeMd(file, { title: 'x' }, 'body')
        const cores = memStore([
            { id: 'k1', concept: 'Transformer 架構', version: 3, noteCount: 5, file },
            { id: 'k2', concept: '其他', version: 1, noteCount: 9, file: `${dirs.core}/none.md` },
            { id: 'k3', concept: 'transformer架構', version: 1, noteCount: 1, status: 'merged', mergedInto: 'k1' },
        ])
        const notes = memStore([{ id: 'n1', concepts: ['transformer架構'], extractedAt: 'x' }, { id: 'n2', concepts: ['別的'], extractedAt: 'y' }])
        const stores = { cores, notes, holds: memStore() }
        assert.deepEqual((await listCores(stores)).map((c) => c.id), ['k1', 'k2'], '依版本降冪;merged 分身不列')
        // 管線持鎖中:拒絕、不動任何東西(含意圖)
        const lockFile = `${TMP}/run.lock`
        const held = acquireLock(lockFile)
        const locked = await regenCore(stores, 'TRANSFORMER架構', { dirs, lockFile, staleMs: 60_000 })
        assert.deepEqual([locked.ok, locked.locked], [false, true])
        assert.ok(fs.existsSync(file) && await cores.get('k1') && !fs.existsSync(`${dirs.state}/extract-regen.json`))
        held.release()
        const r = await regenCore(stores, 'TRANSFORMER架構', { dirs, lockFile, stamp: 'T1' })
        assert.equal(r.ok, true)
        assert.deepEqual([r.concept, r.version, r.availableNotes], ['Transformer 架構', 3, 1], '以 normalizeConcept 比對(大小寫/空白不敏感);同鍵以主核心(非 merged)為準')
        assert.ok(!fs.existsSync(file) && fs.existsSync(`${dirs.state}/core/archive/k1.md.regen-T1.md`), '核心 md 改名封存')
        assert.deepEqual([await cores.get('k1'), (await cores.get('k2'))?.id], [null, 'k2'], '核心索引記錄已刪(只刪該核心)')
        assert.equal((await notes.get('n1')).extractedAt, 'x', '不清 extractedAt(已用過與否以核心狀態之 consumed 為準)')
        assert.ok(!fs.existsSync(lockFile), '執行鎖已釋放')
        const nf = await regenCore(stores, '不存在的概念', { dirs })
        assert.deepEqual([nf.ok, nf.notFound], [false, true])
    })

})
