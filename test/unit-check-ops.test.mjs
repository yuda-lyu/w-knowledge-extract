// unit-check-ops.test.mjs — 本輪為 ops/ingestNotes、logger、notify、patrol、processGuards、regenCore、reviveDocs、runSummary、runTask
//   新增之型別檢查回歸測試：每條檢查至少一個無效輸入案例＋一個有效輸入行為不變之案例
// 執行：npx mocha test/unit-check-ops.test.mjs（不發網路；暫存落 test/_tmp/check-ops-<pid>，測完即刪）

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'
import { createRunLogger, createLogger } from '../src/ops/logger.mjs'
import { createTelegramNotifier } from '../src/ops/notify.mjs'
import { installProcessGuards } from '../src/ops/processGuards.mjs'
import { createPatrol } from '../src/ops/patrol.mjs'
import { regenCore, listCores } from '../src/ops/regenCore.mjs'
import { reviveDeadDocs, deadMatcher } from '../src/ops/reviveDocs.mjs'
import { buildRunSummary, writeRunSummary, readRunSummary, RUN_SUMMARY_VERSION } from '../src/ops/runSummary.mjs'
import { runTask } from '../src/ops/runTask.mjs'
import { createClock } from '../src/util/clock.mjs'
import { memStore } from './tools/memStore.mjs'

const TMP = path.resolve(`test/_tmp/check-ops-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const capLogger = () => {
    const lines = []
    const mk = (lv) => (m) => lines.push(`${lv} ${m}`)
    return { lines, log: mk('INFO'), logWarn: mk('WARN'), logError: mk('ERROR') }
}

describe('unit-check-ops', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── ingestNotes.mjs ──
    describe('ingestNotes', function() {
        it('deps 非物件或缺 stores/dirs/clock/domain 拋錯；items 非陣列拋錯', async () => {
            await assert.rejects(() => ingestNotes(undefined, []), /ingestNotes 需要 \{ stores, dirs, clock, domain \}/)
            await assert.rejects(() => ingestNotes({}, []), /ingestNotes 需要 \{ stores, dirs, clock, domain \}/)
            await assert.rejects(() => ingestNotes({ stores: {}, dirs: {}, clock: {}, domain: {} }, 'not-array'), /ingestNotes 需要 items 陣列/)
        })

        it('有效輸入行為不變：合法 deps／items 正常入庫(md 檔落地、notes 索引寫入)', async () => {
            const stores = { docs: memStore(), notes: memStore() }
            const fakeClock = { iso8: () => '2026-09-23T12:00:00+08:00' }
            const fakeDomain = {
                vocab: { categories: ['其他'] },
                normalizeQuality: () => ({ claimType: '未標注', evidenceLevel: '未評估', evidenceNote: '', caveats: [], samplePeriod: '未載明', pros: [], cons: [], regime: [], counterViews: [] }),
                renderNoteBody: (k) => `# ${k.title}`,
            }
            const notesDir = `${TMP}/ingest-notes`
            const r = await ingestNotes({ stores, dirs: { notes: notesDir }, clock: fakeClock, domain: fakeDomain }, [
                { url: 'https://example.com/a', note: { title: 'T1', key_points: ['a'], concepts: ['c1'] } },
            ])
            assert.deepEqual(r, { added: 1, dup: 0, bad: 0, messages: [] })
            const notes = await stores.notes.select()
            assert.equal(notes.length, 1)
            assert.ok(fs.existsSync(notes[0].file), 'md 檔須落地')
        })
    })

    // ── logger.mjs ──
    describe('logger', function() {
        it('createRunLogger：opt 非物件視為 {} 後仍依既有檢查拋錯(root 缺失)，不為 TypeError', () => {
            assert.throws(() => createRunLogger(null), /createRunLogger 需要 root/)
            assert.throws(() => createRunLogger('not-obj'), /createRunLogger 需要 root/)
        })

        it('createLogger：name 非有效字串拋新錯；既有 createLogger(\'x\', {}) 仍拋 /dir, clock/；有效輸入行為不變', () => {
            assert.throws(() => createLogger(123, {}), /createLogger 需要 name（日誌名）/)
            assert.throws(() => createLogger('', {}), /createLogger 需要 name（日誌名）/)
            assert.throws(() => createLogger('x', {}), /dir, clock/, '既有訊息不可變')
            const clock = createClock('Asia/Taipei')
            const lg = createLogger('run', { dir: `${TMP}/log-check`, clock, echo: false })
            assert.match(lg.now, /^\d{14}$/)
            lg.info('hello') // 日誌檔於首次寫入時才落地(open 僅建目錄與定檔名)
            assert.ok(fs.existsSync(lg.file), '有效輸入仍正常開檔並可寫入')
        })
    })

    // ── notify.mjs ──
    describe('notify', function() {
        it('createTelegramNotifier：opt 非物件視為 {} 後仍依既有檢查拋錯(token 缺失)；有效輸入行為不變(enable:false 乾跑不發網路)', async () => {
            assert.throws(() => createTelegramNotifier(null), /createTelegramNotifier 需要 token/)
            assert.throws(() => createTelegramNotifier('not-obj'), /createTelegramNotifier 需要 token/)
            const n = createTelegramNotifier({ token: 'T', chatId: 'C', enable: false })
            assert.equal(await n.send('hi'), '未啟用發送訊息')
        })
    })

    // ── processGuards.mjs ──
    describe('processGuards', function() {
        it('installProcessGuards：opt 非物件視為 {} 後仍依既有檢查拋錯(onFatal 缺失)；有效輸入行為不變', () => {
            assert.throws(() => installProcessGuards(null), /installProcessGuards 需要 onFatal/)
            assert.throws(() => installProcessGuards('not-obj'), /installProcessGuards 需要 onFatal/)
            const a = process.listenerCount('uncaughtException')
            const off = installProcessGuards({ onFatal: () => {} })
            assert.equal(process.listenerCount('uncaughtException'), a + 1)
            off()
            assert.equal(process.listenerCount('uncaughtException'), a)
        })
    })

    // ── regenCore.mjs ──
    describe('regenCore／listCores', function() {
        it('listCores：stores 非物件或缺 stores.cores.select 拋錯', async () => {
            await assert.rejects(() => listCores(undefined), /listCores 需要 stores\.cores\.select（cores 集合）/)
            await assert.rejects(() => listCores({}), /listCores 需要 stores\.cores\.select（cores 集合）/)
        })

        it('listCores：有效輸入行為不變(依 noteCount 降冪排序)', async () => {
            const list = await listCores({ cores: memStore([{ id: 'a', noteCount: 1 }, { id: 'b', noteCount: 5 }]) })
            assert.deepEqual(list.map((c) => c.id), ['b', 'a'])
        })

        it('regenCore：conceptArg 非有效字串回同形失敗物件(不拋錯)；stores 缺本函數實際用到之集合方法即拋錯(cores.select／cores.raw.del／notes.select／notes.patch)', async () => {
            // 完整之集合替身(regenCore 實際用到 cores.select、cores.raw.del、notes.select、notes.patch)
            const full = () => ({ cores: { select: async () => [], raw: { del: async () => {} } }, notes: memStore() })
            const r = await regenCore(full(), undefined)
            assert.deepEqual(r, { ok: false, notFound: true, messages: ['找不到概念「undefined」的核心知識'] })
            const r2 = await regenCore(full(), 123)
            assert.equal(r2.notFound, true)
            await assert.rejects(() => regenCore(undefined, 'x'), /regenCore 需要 stores\.cores\.select（cores 集合）/)
            await assert.rejects(() => regenCore({}, 'x'), /regenCore 需要 stores\.cores\.select（cores 集合）/)
            // 缺 raw.del 或 notes 方法者開頭即拋錯(此前要到刪完 md 檔之後才拋原生 TypeError,留下半套狀態)
            await assert.rejects(() => regenCore({ cores: { select: async () => [] }, notes: memStore() }, 'x'), /regenCore 需要 stores\.cores\.raw\.del/)
            await assert.rejects(() => regenCore({ cores: { select: async () => [], raw: { del: async () => {} } } }, 'x'), /regenCore 需要 stores\.notes\.select／stores\.notes\.patch/)
        })

        it('regenCore：有效輸入行為不變(刪核心記錄與 md 檔、相關筆記 distilledAt 清空、不相關筆記不受影響)', async () => {
            const coreFile = `${TMP}/regen-core1.md`
            fs.writeFileSync(coreFile, '# x', 'utf8')
            const cores = memStore([{ id: 'core1', concept: '風險', version: 2, noteCount: 5, file: coreFile }])
            cores.raw = { del: async () => {} } // memStore 無 raw.del，補最小替身(regenCore 本身不再查驗刪除結果)
            const notes = memStore([
                { id: 'n1', concepts: ['風險'], distilledAt: '2026-09-01' },
                { id: 'n2', concepts: ['其他'], distilledAt: '2026-09-01' },
            ])
            const r = await regenCore({ cores, notes }, '風險')
            assert.equal(r.ok, true)
            assert.equal(r.availableNotes, 1)
            assert.equal((await notes.get('n1')).distilledAt, '', '相關筆記須清空 distilledAt')
            assert.equal((await notes.get('n2')).distilledAt, '2026-09-01', '不相關筆記不受影響')
            assert.ok(!fs.existsSync(coreFile), 'md 檔須刪除')
        })
    })

    // ── reviveDocs.mjs ──
    describe('reviveDeadDocs／deadMatcher', function() {
        it('reviveDeadDocs：stores 非物件或缺 docs.select/patch 拋錯；cfg.match 非函數拋既有錯(訊息不變)', async () => {
            await assert.rejects(() => reviveDeadDocs(undefined, { match: () => true }), /reviveDeadDocs 需要 stores\.docs\.select／stores\.docs\.patch（docs 集合）/)
            await assert.rejects(() => reviveDeadDocs({}, { match: () => true }), /reviveDeadDocs 需要 stores\.docs\.select／stores\.docs\.patch（docs 集合）/)
            await assert.rejects(() => reviveDeadDocs({ docs: memStore() }, {}), /reviveDeadDocs 需要 match\(doc\) 函數/)
        })

        it('deadMatcher：opt 非物件回退為 {}(恆不比對，回傳 false)', () => {
            const m0 = deadMatcher(null)
            assert.equal(m0({ url: 'https://x.com', lastError: 'boom' }), false)
            const m1 = deadMatcher('not-obj')
            assert.equal(m1({ url: 'https://x.com', lastError: 'boom' }), false)
        })

        it('有效輸入行為不變：deadMatcher(host) 篩出子網域，reviveDeadDocs 依 match 回填並清 fetchTries、留 revivedFrom', async () => {
            const docs = memStore([
                { id: 'd1', url: 'https://dead.example.com/x', status: 'dead', lastError: '404' },
                { id: 'd2', url: 'https://other.com/y', status: 'dead', lastError: '404' },
            ])
            const r = await reviveDeadDocs({ docs }, { match: deadMatcher({ host: 'dead.example.com' }), nowIso: '2026-09-23T00:00:00+08:00' })
            assert.deepEqual(r, { dead: 2, matched: 1, revived: 1, sample: ['https://dead.example.com/x'] })
            const d1 = await docs.get('d1')
            assert.equal(d1.status, 'new')
            assert.equal(d1.fetchTries, 0)
            assert.equal(d1.revivedFrom, '404')
            const d2 = await docs.get('d2')
            assert.equal(d2.status, 'dead', '不符 host 者不受影響')
        })
    })

    // ── runSummary.mjs ──
    describe('runSummary', function() {
        it('buildRunSummary：p 非物件視為 {}(不拋錯，回傳空殼摘要)', () => {
            const s = buildRunSummary(undefined)
            assert.equal(s.name, '')
            assert.deepEqual(s.stages, [])
            const s2 = buildRunSummary(123)
            assert.deepEqual(s2.stages, [])
        })

        it('writeRunSummary：p 非物件回 null；readRunSummary：file 非有效字串回 null', () => {
            assert.equal(writeRunSummary(undefined), null)
            assert.equal(writeRunSummary('not-obj'), null)
            assert.equal(readRunSummary(undefined), null)
            assert.equal(readRunSummary(123), null)
        })

        it('有效輸入行為不變：build→write→read 往返正常', () => {
            const summary = buildRunSummary({ report: { name: 'x', ms: 10, ok: true, stages: [] }, stamp: '20260923120000' })
            const file = writeRunSummary({ dir: `${TMP}/summary`, stamp: '20260923120000', summary })
            assert.ok(file && fs.existsSync(file))
            const j = readRunSummary(file)
            assert.equal(j.version, RUN_SUMMARY_VERSION)
            assert.equal(j.name, 'x')
        })
    })

    // ── runTask.mjs ──
    describe('runTask', function() {
        it('opt 非物件視為 {} 後仍依既有檢查拋錯(run 缺失)，不為 TypeError', async () => {
            await assert.rejects(() => runTask(null), /runTask 需要 run/)
            await assert.rejects(() => runTask('not-obj'), /runTask 需要 run/)
        })

        it('ensureDirs 非陣列回退為 []（不嘗試建立、不拋錯）', async () => {
            const lg = capLogger()
            const r = await runTask({ logger: lg, runId: 'r1', ensureDirs: 'not-array', run: async () => 1 })
            assert.equal(r.ok, true)
            assert.equal(r.result, 1)
        })

        it('有效輸入行為不變：ensureDirs 陣列仍於開工前建立目錄', async () => {
            const lg = capLogger()
            const dir = `${TMP}/runtask-ensured/a`
            const r = await runTask({ logger: lg, runId: 'r2', ensureDirs: [dir], run: async () => 2 })
            assert.equal(r.ok, true)
            assert.ok(fs.existsSync(dir))
        })
    })

    // ── patrol.mjs ──
    describe('createPatrol', function() {
        it('cfg 非物件視為 {} 後仍依既有檢查拋錯(dirs/clock 缺失)，不為 TypeError', () => {
            assert.throws(() => createPatrol(undefined), /createPatrol 需要 \{ dirs:\{log,state,tmp\}, clock \}/)
            assert.throws(() => createPatrol('not-obj'), /createPatrol 需要 \{ dirs:\{log,state,tmp\}, clock \}/)
        })

        it('有效輸入行為不變：合法 cfg 正常建構並可執行 patrolFromPipeline', async () => {
            const dir = `${TMP}/patrol-check`
            for (const d of ['log', 'state', 'tmp']) fs.mkdirSync(`${dir}/${d}`, { recursive: true })
            const clock = createClock('Asia/Taipei')
            const openStores = () => ({ docs: memStore(), notes: memStore(), relations: memStore(), cores: memStore(), sources: memStore(), frontier: memStore() })
            const p = createPatrol({
                dirs: { log: `${dir}/log`, state: `${dir}/state`, tmp: `${dir}/tmp` },
                workDir: dir,
                clock,
                openStores,
                closeStores: async () => {},
                aiUsageToday: () => ({ used: 0, byKey: {}, chain: '', providers: [] }),
                recordFile: `${dir}/record.md`,
            })
            assert.equal(typeof p.patrolFromPipeline, 'function')
            assert.equal(p.recordFile, `${dir}/record.md`)
            const r = await p.patrolFromPipeline()
            assert.deepEqual(r, { ok: true })
            assert.ok(fs.existsSync(`${dir}/record.md`), '紀錄檔須落地')
        })
    })

})
