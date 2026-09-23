// unit-check-core.test.mjs — 本組(core)新增之型別檢查回歸測試
// 涵蓋 src/core/{kernel,objects,createKnowledgeExtract,settingsDefault,loadSettings,dirs}.mjs 新增之無效輸入回退/拋錯
// 執行:npx mocha test/unit-check-core.test.mjs(暫存落 test/_tmp/check-core-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { applyTaps, defineMw, makeMsg, count, runChainOverMsgs, MwContractError } from '../src/core/kernel.mjs'
import { createFetchObject, createOrganizeObject, createRelateObject, createDistillObject } from '../src/core/objects.mjs'
import { createKnowledgeExtract } from '../src/core/createKnowledgeExtract.mjs'
import { resolveSettings, FETCH_DEFAULT, AI_DEFAULT } from '../src/core/settingsDefault.mjs'
import { decorateSettings, loadSettings, createSettingsHolder } from '../src/core/loadSettings.mjs'
import { normalizeWorkDir, expandDirs } from '../src/core/dirs.mjs'

const TMP = path.resolve(`test/_tmp/check-core-${process.pid}`).replace(/\\/g, '/')

// 總組裝測試用之 AI 調度層替身(不讀 .env;同 unit-objects.test.mjs 之寫法)
const stubAi = {
    callJson: async () => ({ ok: false, data: null, error: 'stub', skipped: false, attempts: 0, preview: '' }),
    getWkf: () => ({}),
    withBudget: (s) => s,
    recordCall: () => {},
    drainStats: () => '無呼叫',
    aiUsageToday: () => ({ today: '', used: 0, byKey: {}, chain: '', providers: [], skipped: [] }),
}

describe('unit-check-core', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── kernel.mjs:applyTaps ──
    describe('kernel.applyTaps', function() {

        it('錨點之 before/after/add 給了但非陣列 → 拋 MwContractError(此前為 for...of 對非陣列值之「not iterable」TypeError)', () => {
            const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
            assert.throws(() => applyTaps([a], { a: { before: a } }), MwContractError)
            assert.throws(() => applyTaps([a], { a: { before: a } }), /之「before」須為陣列/)
            assert.throws(() => applyTaps([a], { a: { after: a } }), /之「after」須為陣列/)
            assert.throws(() => applyTaps([a], { a: { add: a } }), /之「add」須為陣列/)
        })

        it('before/after 給有效陣列 → 行為不變(掛載成功、順序正確)', () => {
            const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
            const b = defineMw({ name: 'b', handle: (m, c, n) => n(m) })
            const d = defineMw({ name: 'd', handle: (m, c, n) => n(m) })
            const chain = applyTaps([a], { a: { before: [b], after: [d] } })
            assert.deepEqual(chain.map((m) => m.name), ['b', 'a', 'd'])
        })

        it('opt 非物件(含 null)→ 視為{}(此前 opt=null 會在 opt.chainName 存取處拋 TypeError)', () => {
            const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
            assert.doesNotThrow(() => applyTaps([a], null, null))
            assert.doesNotThrow(() => applyTaps([a], { a: { before: [] } }, 'not-an-object'))
        })
    })

    // ── kernel.mjs:runChainOverMsgs ──
    describe('kernel.runChainOverMsgs', function() {

        it('opt 非物件 → 拋 MwContractError(訊息:需要 opt 物件)', async () => {
            await assert.rejects(() => runChainOverMsgs(undefined), (e) => e instanceof MwContractError && /runChainOverMsgs 需要 opt 物件/.test(e.message))
            await assert.rejects(() => runChainOverMsgs('bogus'), MwContractError)
            await assert.rejects(() => runChainOverMsgs(42), MwContractError)
        })

        it('opt.msgs 給了但非陣列 → 拋 MwContractError;未給時視為[](行為不變)', async () => {
            const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
            await assert.rejects(() => runChainOverMsgs({ chain: [a], ctx: {}, msgs: 'bogus' }), (e) => e instanceof MwContractError && /opt\.msgs 須為陣列/.test(e.message))
            const r = await runChainOverMsgs({ chain: [a], ctx: {} })
            assert.deepEqual(r, { stats: {}, halts: {}, fails: 0, errors: [], left: 0 })
        })

        it('opt.msgs 給有效陣列 → 行為不變', async () => {
            const a = defineMw({
                name: 'a',
                handle: (m, c, n) => {
                    count(m, 'seen')
                    return n(m)
                },
            })
            const r = await runChainOverMsgs({ chain: [a], ctx: {}, msgs: [makeMsg('doc', {})] })
            assert.equal(r.stats.seen, 1)
        })
    })

    // ── kernel.mjs:makeMsg ──
    describe('kernel.makeMsg', function() {

        it('meta 非物件 → 回退為{}', () => {
            assert.deepEqual(makeMsg('doc', { a: 1 }, 'bogus').meta, {})
            assert.deepEqual(makeMsg('doc', { a: 1 }, 42).meta, {})
            assert.deepEqual(makeMsg('doc', { a: 1 }, [1, 2]).meta, {})
        })

        it('meta 為有效物件 → 行為不變(逐鍵帶入)', () => {
            assert.deepEqual(makeMsg('doc', {}, { from: 'x' }).meta, { from: 'x' })
        })
    })

    // ── kernel.mjs:count ──
    describe('kernel.count', function() {

        it('n 非數字 → 回退為1', () => {
            const m = makeMsg('doc', {})
            count(m, 'k', 'bogus')
            assert.equal(m.stats.k, 1)
            count(m, 'k', {})
            assert.equal(m.stats.k, 2)
        })

        it('n 為有效數字(含數字字串)→ 行為不變', () => {
            const m = makeMsg('doc', {})
            count(m, 'k', 5)
            count(m, 'k', '3')
            assert.equal(m.stats.k, 8)
        })
    })

    // ── objects.mjs:四物件工廠 opt 正規化 ──
    describe('objects.四物件工廠', function() {

        it('opt 非物件(null/字串/數字/陣列)→ 視為{},回傳零參數之預設階段物件(不拋錯)', () => {
            for (const bogus of [null, 'bogus', 42, [1, 2]]) {
                assert.equal(createFetchObject(bogus).name, '抓取')
                assert.equal(createOrganizeObject(bogus).name, '彙整')
                assert.equal(createRelateObject(bogus).name, '關聯')
                assert.equal(createDistillObject(bogus).name, '提煉')
            }
        })

        it('opt 為有效物件 → 行為不變(name 覆寫仍生效)', () => {
            assert.equal(createFetchObject({ name: 'x1' }).name, 'x1')
            assert.equal(createOrganizeObject({ name: 'x2' }).name, 'x2')
            assert.equal(createRelateObject({ name: 'x3' }).name, 'x3')
            assert.equal(createDistillObject({ name: 'x4' }).name, 'x4')
        })
    })

    // ── createKnowledgeExtract.mjs ──
    describe('createKnowledgeExtract', function() {

        it('cfg 非物件 → 視為{},再由既有 workDir 檢查拋錯(訊息須含 workDir)', () => {
            assert.throws(() => createKnowledgeExtract('bogus'), /workDir/)
            assert.throws(() => createKnowledgeExtract(42), /workDir/)
            assert.throws(() => createKnowledgeExtract(null), /workDir/)
        })

        it('workDir 給了但非有效字串(isestr 判斷)→ 拋錯,訊息含 workDir(此前數字/物件等 truthy 值會被靜默接受)', () => {
            assert.throws(() => createKnowledgeExtract({ workDir: 123 }), /workDir/)
            assert.throws(() => createKnowledgeExtract({ workDir: '' }), /workDir/)
            assert.throws(() => createKnowledgeExtract({ workDir: {} }), /workDir/)
        })

        it('workDir 為有效字串 → 行為不變(可正常建構並取得 info)', () => {
            const wd = `${TMP}/kt-ok`
            const flow = createKnowledgeExtract({ workDir: wd, afterRun: false, aiAdapter: stubAi })
            assert.equal(flow.info().dirs.db, `${wd}/db`)
        })
    })

    // ── settingsDefault.mjs:resolveSettings ──
    describe('settingsDefault.resolveSettings', function() {

        it('cfg 非物件 → 視為{},回傳內建預設', () => {
            const s = resolveSettings('bogus')
            assert.equal(s.fetch.sourcesPerRun, FETCH_DEFAULT.sourcesPerRun)
        })

        it('cfg.fetch/knowledge/sourcePolicy/ai 給了但非物件 → 視為未給(此前會把字元索引灌入而污染設定)', () => {
            const s = resolveSettings({ fetch: 'abc', knowledge: 123, sourcePolicy: [1, 2], ai: 'xyz' })
            assert.deepEqual(Object.keys(s.fetch).sort(), Object.keys(FETCH_DEFAULT).sort(), 'fetch 未被字元索引污染')
            assert.equal(s.fetch.sourcesPerRun, FETCH_DEFAULT.sourcesPerRun)
            assert.equal(s.ai.extract.executor.use, AI_DEFAULT.extract.executor.use)
        })

        it('cfg 子鍵為有效物件 → 行為不變(逐鍵覆寫仍生效、未覆寫之鍵仍用預設)', () => {
            const s = resolveSettings({ fetch: { sourcesPerRun: 99 } })
            assert.equal(s.fetch.sourcesPerRun, 99)
            assert.equal(s.fetch.itemsPerSource, FETCH_DEFAULT.itemsPerSource)
        })
    })

    // ── loadSettings.mjs:decorateSettings ──
    describe('loadSettings.decorateSettings', function() {

        it('st 非物件 → 拋 Error(/缺少 workDir/)', () => {
            assert.throws(() => decorateSettings(null), /缺少 workDir/)
            assert.throws(() => decorateSettings(42), /缺少 workDir/)
            assert.throws(() => decorateSettings('bogus'), /缺少 workDir/)
        })

        it('opt 非物件 → 視為{}(此前 opt=null 解構會拋 TypeError,掩蓋掉本該出現的 workDir 檢查)', () => {
            assert.throws(() => decorateSettings({}, null), /缺少 workDir/)
        })

        it('secrets 非陣列 → 視為[](此前 for...of 非陣列值拋 not iterable);dirs 非物件 → 回退 DF_DIRS', () => {
            const wd = `${TMP}/decorate-ok`
            fs.mkdirSync(wd, { recursive: true })
            fs.writeFileSync(`${wd}/.env`, 'X=1\n', 'utf8')
            const st = decorateSettings({ workDir: wd }, { secrets: 'bogus', dirs: 'bogus' })
            assert.deepEqual(st.dir, {
                db: path.resolve(wd, 'db'),
                log: path.resolve(wd, 'log'),
                tmp: path.resolve(wd, 'tmp'),
                state: path.resolve(wd, 'state'),
            })
            assert.deepEqual(st.env, { X: '1' })
        })

        it('secrets 為有效陣列、dirs 為有效物件 → 行為不變', () => {
            const wd = `${TMP}/decorate-secrets`
            fs.mkdirSync(wd, { recursive: true })
            fs.writeFileSync(`${wd}/.env`, 'TOK=abc\n', 'utf8')
            const st = decorateSettings({ workDir: wd }, { secrets: [{ to: 'auth.token', envVar: 'TOK' }], dirs: { log: 'log2' } })
            assert.equal(st.auth.token, 'abc')
            assert.equal(st.dir.log, path.resolve(wd, 'log2'))
        })
    })

    // ── loadSettings.mjs:loadSettings／createSettingsHolder ──
    describe('loadSettings.loadSettings／createSettingsHolder', function() {

        it('opt 非物件 → 視為{},再由既有 file 檢查拋錯(訊息「loadSettings 需要 file」不可改字)', () => {
            assert.throws(() => loadSettings(null), /loadSettings 需要 file/)
            assert.throws(() => loadSettings('bogus'), /loadSettings 需要 file/)
            assert.throws(() => loadSettings(undefined), /loadSettings 需要 file/)
        })

        it('opt 為有效物件且 file 存在 → 行為不變', () => {
            const wd = `${TMP}/load-ok`
            fs.mkdirSync(wd, { recursive: true })
            fs.writeFileSync(`${wd}/.env`, 'X=1\n', 'utf8')
            fs.writeFileSync(`${wd}/settings.json`, `{ workDir: '${wd}' }`, 'utf8')
            const st = loadSettings({ file: `${wd}/settings.json` })
            assert.equal(st.workDir, wd)
        })

        it('createSettingsHolder(opt 非物件)→ 視為{},建構不拋錯(此前 opt=null 會在 load 之預設參數 opt.file 處拋 TypeError)', () => {
            assert.doesNotThrow(() => createSettingsHolder(null))
            const h = createSettingsHolder(undefined)
            assert.equal(typeof h.load, 'function')
            assert.throws(() => h.get(), /loadSettings 需要 file/, '未設定 file 時,get() 之首次自動載入仍照既有語意拋錯')
        })
    })

    // ── dirs.mjs ──
    describe('dirs.normalizeWorkDir／expandDirs', function() {

        it('normalizeWorkDir 非有效字串 → 拋 Error(訊息:normalizeWorkDir 需要 workDir)', () => {
            assert.throws(() => normalizeWorkDir(undefined), /normalizeWorkDir 需要 workDir/)
            assert.throws(() => normalizeWorkDir(null), /normalizeWorkDir 需要 workDir/)
            assert.throws(() => normalizeWorkDir(''), /normalizeWorkDir 需要 workDir/)
            assert.throws(() => normalizeWorkDir(123), /normalizeWorkDir 需要 workDir/)
        })

        it('normalizeWorkDir 有效字串 → 行為不變(反斜線轉正斜線、去尾斜線)', () => {
            assert.equal(normalizeWorkDir('C:\\kb\\'), 'C:/kb')
        })

        it('expandDirs overrides 非物件 → 視為{}(回退全預設目錄,不拋錯)', () => {
            const d = expandDirs('c:/kb', 'bogus')
            assert.equal(d.db, 'c:/kb/db')
            assert.equal(d.notes, 'c:/kb/knowledge/notes')
        })

        it('expandDirs overrides 為有效物件 → 行為不變(逐鍵覆寫仍生效)', () => {
            const d = expandDirs('c:/kb', { db: 'c:/other/db' })
            assert.equal(d.db, 'c:/other/db')
            assert.equal(d.log, 'c:/kb/log')
        })
    })

})
