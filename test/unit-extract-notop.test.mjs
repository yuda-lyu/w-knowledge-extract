// unit-extract-notop.test.mjs — 出處之推定判定之快取(stores/contentCache 之 createNoTopCache)與提煉段之供給(核心 md 之推定標記)
// 【為何要有】核心 md 之推定標記須知各出處筆記是否自承無最高證據等級之要件(判定本身——摘要套件之 noTopEvidenceOf 與其材料之讀法——
//   見 unit-extract-domain)。渲染每輪逐核心進行,判定以 md 之 mtime＋大小快取;快取錯則標記錯:md 或記錄已改而沿用舊判定、規則換版而不重建、
//   規則停用仍讀寫、md 不在而寫入無從比對之條目。提煉段之各落盤路徑(選題後之落盤、維護之投影更新、管線外之寫入器)須給同一個由快取
//   供給之判定,並於落盤後存檔——本檔鎖住以上兩層。
// 【夾具】推定詞與其證據性質封頂取量化詞彙之覆寫(test/tools/quantVocab)、證據規則取摘要套件之 test/tools/quantRule(經 summarizeForTest);本套件之預設不推定。
// 執行:自套件根 node <mocha> test/unit-extract-notop.test.mjs(暫存落 test/_tmp/extract-notop-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import { createNoTopCache } from '../src/stores/contentCache.mjs'
import { NO_TOP_CACHE_FILE } from '../src/stores/extractFiles.mjs'
import { coreWriterOf } from '../src/stores/coreProjection.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { QUANT_RULE } from './tools/summarizeForTest.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'
import { clock, recLog, readState, draftAll, scriptAi, mkEnvIn, runStage } from './tools/extractKit.mjs'

let TMP = ''
const clone = (v) => JSON.parse(JSON.stringify(v))
let seq = 0

/** 推定之 domain(量化詞彙之覆寫＋證據規則;規則為已編譯者,同提煉段所傳) */
const QUANT_DOMAIN = createExtractDomain({ vocab: { ...QUANT_VOCAB, evidenceRule: QUANT_RULE } })
/** 另一版規則(寬式清空:指紋不同) */
const OTHER_RULE = createExtractDomain({ vocab: { ...QUANT_VOCAB, evidenceRule: { ...QUANT_RULE, loose: [] } } }).evidenceRule
/** 明確自承無該驗證之 caveat(嚴式命中)與未自承者 */
const ADMIT = '無樣本外驗證'
const PLAIN = '樣本 2000-2015'

/** 新的暫存目錄 */
function mkdir() {
    const dir = `${TMP}/c${++seq}`
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

/**
 * 寫一篇筆記 md(含證據等級行);caveats 為陣列者寫入 frontmatter(摘要之讀法:md 有 caveats 即優先於記錄)
 *
 * @param {String} file 輸入檔案路徑
 * @param {Array|null} caveats 輸入 frontmatter 之 caveats(null 不寫)
 * @param {String} [knowledge='甲'] 輸入核心知識(改寫以改變 md 之大小)
 * @returns {String} 回傳檔案路徑
 */
function writeNoteMd(file, caveats, knowledge = '甲') {
    writeMd(file, caveats ? { title: 'T', caveats } : { title: 'T' }, `# T\n\n## 核心知識\n\n- ${knowledge}\n\n## 品質與證據標注\n\n- 證據等級：中（兩組觀測）\n`)
    return file
}

/** 讀快取檔 */
const readCache = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

/** 起草替身:同 draftAll 而主張不寫 basis(推定只及於未寫證據性質、出處類型亦無關鍵詞者) */
const draftBare = (prompt) => {
    const out = draftAll(prompt)
    return { ...out, ops: out.ops.map((op) => (op.op === 'add' ? { ...op, basis: '' } : op)) }
}

describe('unit-extract-notop', function() {

    before(() => {
        TMP = tmpRoot('extract-notop')
    })
    after(() => removeRoots([TMP]))

    // ── A. 快取(createNoTopCache) ──

    it('沿用:md 之 mtime 與大小皆同即沿用前次之判定(不重讀 md——以改寫快取檔之判定證之);md 改了即重判', () => {
        const dir = mkdir()
        const cacheFile = `${dir}/notop.json`
        const note = { id: 'n', file: writeNoteMd(`${dir}/n.md`, null), caveats: [PLAIN] }
        const c1 = createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule)
        assert.equal(c1.of(note), false)
        c1.save()
        const raw = readCache(cacheFile)
        assert.deepEqual(Object.keys(raw.notes), ['n'], '每篇一筆')
        raw.notes.n[2] = 1
        fs.writeFileSync(cacheFile, JSON.stringify(raw))
        assert.equal(createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule).of(note), true, 'mtime 與大小皆同 → 沿用(不重讀)')
        writeNoteMd(note.file, null, '甲之內容已改寫')
        assert.equal(createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule).of(note), false, 'md 改了 → 重判')
    })

    it('重建:規則換版(指紋不同)或快取檔壞 → 整份重建(先前之判定不沿用、不拋錯)', () => {
        const dir = mkdir()
        const cacheFile = `${dir}/notop.json`
        const note = { id: 'n', file: writeNoteMd(`${dir}/n.md`, null), caveats: [PLAIN] }
        const c1 = createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule)
        c1.of(note)
        c1.save()
        const raw = readCache(cacheFile)
        raw.notes.n[2] = 1
        fs.writeFileSync(cacheFile, JSON.stringify(raw))
        assert.equal(createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule).of(note), true, '對照:同一規則 → 沿用')
        assert.equal(createNoTopCache(cacheFile, OTHER_RULE).of(note), false, '規則換版 → 重建')
        fs.writeFileSync(cacheFile, '{壞')
        const c2 = createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule)
        assert.equal(c2.of(note), false, '壞檔 → 重建')
        c2.save()
        assert.deepEqual(Object.keys(readCache(cacheFile).notes), ['n'], '重建後寫回')
    })

    it('記錄之 caveats:md 無 caveats 者判定取自記錄——記錄改了即重判(md 未改);md 有 caveats 者以 md 為準——記錄之改動不重判、不寫檔', () => {
        const dir = mkdir()
        const cacheFile = `${dir}/notop.json`
        const a = { id: 'a', file: writeNoteMd(`${dir}/a.md`, null), caveats: [ADMIT] }
        const b = { id: 'b', file: writeNoteMd(`${dir}/b.md`, [ADMIT]), caveats: [] }
        const c1 = createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule)
        assert.equal(c1.of(a), true, '取記錄之 caveats')
        assert.equal(c1.of(b), true, '取 md 之 caveats(優先於記錄)')
        c1.save()
        assert.equal(createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule).of({ ...a, caveats: [PLAIN] }), false, '記錄改了 → 重判')
        const c2 = createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule)
        assert.equal(c2.of({ ...b, caveats: [PLAIN] }), true, 'md 有 caveats → 記錄之改動不影響')
        fs.rmSync(cacheFile)
        c2.save()
        assert.equal(fs.existsSync(cacheFile), false, '只有沿用者 → 無新判定,不寫檔')
    })

    it('md 不在(或記錄無檔案路徑)→ 只以記錄判、不寫入快取;非物件 → false', () => {
        const dir = mkdir()
        const cacheFile = `${dir}/notop.json`
        const c = createNoTopCache(cacheFile, QUANT_DOMAIN.evidenceRule)
        assert.equal(c.of({ id: 'x', file: `${dir}/none.md`, caveats: [ADMIT] }), true)
        assert.equal(c.of({ id: 'y', caveats: [ADMIT] }), true)
        assert.equal(c.of({ id: 'z', caveats: [PLAIN] }), false)
        for (const v of [null, undefined, 'n']) assert.equal(c.of(v), false)
        c.save()
        assert.equal(fs.existsSync(cacheFile), false, '無從比對之條目不寫入')
    })

    it('規則停用(null、未給、詞彙未給證據規則)→ 恆 false(自承者亦然)、不寫檔', () => {
        const dir = mkdir()
        const file = writeNoteMd(`${dir}/n.md`, [ADMIT])
        for (const [i, rule] of [null, undefined, createExtractDomain({}).evidenceRule].entries()) {
            const cacheFile = `${dir}/off${i}.json`
            const c = createNoTopCache(cacheFile, rule)
            assert.equal(c.of({ id: 'n', file, caveats: [ADMIT] }), false, String(i))
            c.save()
            assert.equal(fs.existsSync(cacheFile), false, String(i))
        }
    })

    // ── B. 提煉段之供給(真檔案＋記憶體集合＋腳本化 AI) ──

    // 建構器於首次呼叫時才以暫存根實例化(暫存根於 before 建立;describe 定義期尚未有)
    let envBuilder = null
    const mkEnv = (notes, o) => (envBuilder ||= mkEnvIn(TMP))(notes, o)
    const coreOf = async (env) => (await env.stores.cores.select())[0]
    const cacheOf = (env) => `${env.dirs.state}/${NO_TOP_CACHE_FILE}`
    const presumed = (md, id) => new RegExp(`主張 ${id}〔樣本內〕（`).test(md)

    it('選題後之落盤:出處筆記(md 無 caveats,記錄自承)→ 核心 md 之各主張標推定詞;判定之快取於本段存檔(各出處一筆)', async () => {
        const env = mkEnv(['p1', 'p2', 'p3'].map((id) => ({ id, concepts: ['推定'], caveats: [ADMIT] })))
        env.domains.extract = QUANT_DOMAIN
        await runStage(env, scriptAi({ draft: draftBare }))
        const md = fs.readFileSync((await coreOf(env)).file, 'utf8')
        for (const id of ['p1', 'p2', 'p3']) assert.ok(presumed(md, id), `${id}:\n${md}`)
        const cache = readCache(cacheOf(env))
        assert.deepEqual(Object.keys(cache.notes).sort(), ['p1', 'p2', 'p3'])
        assert.ok(Object.values(cache.notes).every((e) => e[2] === 1), JSON.stringify(cache.notes))
    })

    it('維護之投影更新:記錄之 caveats 改為未自承(md 未改)→ 重判、該篇所撐之主張撤推定詞並落盤;不呼叫 AI;快取隨之更新', async () => {
        const env = mkEnv(['m1', 'm2', 'm3'].map((id) => ({ id, concepts: ['維護'], caveats: [ADMIT] })))
        env.domains.extract = QUANT_DOMAIN
        await runStage(env, scriptAi({ draft: draftBare }))
        const rec = await coreOf(env)
        assert.ok(presumed(fs.readFileSync(rec.file, 'utf8'), 'm1'))
        await env.stores.notes.patch('m1', { caveats: [PLAIN] })
        const ai = scriptAi({ draft: draftBare })
        const { report } = await runStage(env, ai, {}, { remainingMs: 60_000 })
        assert.equal(report.detail.skippedForBudget, true, '只做維護')
        assert.equal(ai.calls.length, 0)
        const md = fs.readFileSync(rec.file, 'utf8')
        assert.ok(!presumed(md, 'm1') && /主張 m1（/.test(md), md)
        assert.ok(presumed(md, 'm2') && presumed(md, 'm3'), md)
        assert.equal(readCache(cacheOf(env)).notes.m1[2], 0)
    })

    it('管線外之寫入器(coreWriterOf):渲染取同一判定(快取供給)、落盤後存檔;對照:規則停用之 domain 不推定、不寫快取', async () => {
        const env = mkEnv(['w1', 'w2', 'w3'].map((id) => ({ id, concepts: ['寫入器'], caveats: [ADMIT] })))
        await runStage(env, scriptAi({ draft: draftBare }))
        const rec = await coreOf(env)
        assert.ok(!presumed(fs.readFileSync(rec.file, 'utf8'), 'w1'), '預設 domain 不推定')
        assert.equal(fs.existsSync(cacheOf(env)), false, '規則停用 → 不寫快取')
        const writer = await coreWriterOf({ stores: env.stores, dirs: env.dirs, clock, domain: QUANT_DOMAIN, log: recLog() })
        const st = readState(env, rec.id)
        await writer.write({ id: rec.id, file: rec.file, state: st, expectRev: st.rev, before: clone(st), touched: [] })
        const md = fs.readFileSync(rec.file, 'utf8')
        for (const id of ['w1', 'w2', 'w3']) assert.ok(presumed(md, id), `${id}:\n${md}`)
        assert.deepEqual(Object.keys(readCache(cacheOf(env)).notes).sort(), ['w1', 'w2', 'w3'])
    })
})
