// unit-extract-locale.test.mjs — 語言設定(cfg.lang;抓取套件之 core/locale)於提煉套件之落點:覆核類提示詞之理由語言句、核心標準 ES3 之適用、
//   操作守門與存量處置之字形政策、文字相似度之折疊經抓取埠、執行期件之接線
// 規則(出自 extractRuntime、extractDomain、coreStandards、opGuards、coreStockFix、guards/similarity 之檔頭與 JSDoc):
//   ①預設逐字不變:未給 lang 時四支覆核提示詞與語言設定出現前相同(golden 另有 unit-extract-golden 守);lang 給了只換理由之語言句
//   ②ES3 只適用於臺灣正體:語言設定非繁體中文 → checkCore 逐條目列不適用(共同字樣)、掃描同;操作守門不轉字形不記旗標;存量修正無改動
//   ③文字相似度之簡繁折疊經抓取埠之 cnToTw(本套件不直接依賴 opencc)
//   ④執行期件:cfg.lang 解析一次,提煉與關聯 domain 工廠同讀
// 執行:自套件根 node <mocha> test/unit-extract-locale.test.mjs(純函數;不連網、不呼叫 AI、不落檔)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { msgOf, resetConceptFold, lexSource } from './tools/captureForTest.mjs'
import { seedCore, ANN } from './tools/extractKit.mjs'
import { SCRIPT_NA_DETAIL, resolveLocale } from '../src/core/capturePackage.mjs'
import { resolveExtractSettings } from '../src/core/extractSettings.mjs'
import { createExtractRuntime } from '../src/extractRuntime.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { checkCore, CORE_STANDARDS } from '../src/standards/coreStandards.mjs'
import { guardOps } from '../src/standards/opGuards.mjs'
import { coreFixOf } from '../src/standards/coreStockFix.mjs'
import { foldScript, normText } from '../src/guards/similarity.mjs'
import { CFG_KEYS } from '../src/createKnowledgeExtract.mjs'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')
const AT = '2026-10-28T12:00:00+08:00'
const SETTINGS = resolveExtractSettings({})
const DOMAIN = createExtractDomain({})
const by = (rs, std, field) => rs.find((r) => r.std === std && (field === undefined || r.field === field))

/** 核心:C1 簡體、本質簡體(ES3 之違反) */
function stateA() {
    const s = seedCore({
        coreId: 'core-a', concept: '甲', batch: [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }], at: '2026-10-01T00:00:00+08:00',
        ops: [
            { op: 'add', kind: 'rule', text: '成本會侵蝕收益', basis: '實證', sources: ['N1'], ...ANN },
            { op: 'add', kind: 'rule', text: '長期才出現', basis: '實證', sources: ['N2'], ...ANN },
            { op: 'essence', text: '成本會侵蝕收益', claims: ['C1'], reason: '首版' },
        ],
    })
    s.claims[0].text = '成本会侵蚀收益'
    s.essence.text = '成本会侵蚀收益'
    return s
}
const CTX = { contentOf: () => null, docIdOf: (id) => id }

describe('unit-extract-locale', function() {

    after(() => resetConceptFold()) // 執行期件之建構即設定模組級之概念折疊:不留給同 worker 之他檔

    it('①四支覆核提示詞:預設逐字含「reason 用繁體中文一句話」;lang en 換為「英文」且不含「繁體中文」;錯值拋錯並點名', () => {
        const d1 = createExtractDomain({ locale: 'en' })
        const c = { concept: '甲', sources: [], items: [] }
        const pairs = [
            [DOMAIN.buildSupportCheckPrompt(c), d1.buildSupportCheckPrompt(c)],
            [DOMAIN.buildOrphanCheckPrompt(c), d1.buildOrphanCheckPrompt(c)],
            [DOMAIN.buildDisputeCheckPrompt(c), d1.buildDisputeCheckPrompt(c)],
            [DOMAIN.buildSynonymCheckPrompt([]), d1.buildSynonymCheckPrompt([])],
        ]
        for (const [p0, p1] of pairs) {
            assert.ok(p0.includes('reason 用繁體中文一句話'), p0.slice(0, 60))
            assert.ok(p1.includes('reason 用英文一句話') && !p1.includes('繁體中文'), p1.slice(0, 60))
            assert.equal(p0.replaceAll('繁體中文', '英文'), p1, '只換語言句,其餘逐字相同')
        }
        assert.equal(createExtractDomain({ locale: resolveLocale('en') }).buildSupportCheckPrompt(c), d1.buildSupportCheckPrompt(c))
        assert.match(msgOf(() => createExtractDomain({ locale: '!!' })), /^createExtractDomain 之 opt\.locale 不是合法之語言代碼/)
    })

    it('②checkCore:ES3 宣告 appliesTo zh-Hant-TW;預設判違反(條目與本質);ctx.locale en 逐條目列不適用(共同字樣);其餘標準照判;錯值拋錯', () => {
        assert.deepEqual(CORE_STANDARDS.find((s) => s.id === 'ES3').appliesTo, ['zh-Hant-TW'])
        const s = stateA()
        const r0 = checkCore(s, CTX)
        assert.deepEqual([by(r0, 'ES3', 'C1').status, by(r0, 'ES3', 'C2').status, by(r0, 'ES3', 'essence').status], ['violation', 'pass', 'violation'])
        const r1 = checkCore(s, { ...CTX, locale: 'en' })
        const es3 = r1.filter((r) => r.std === 'ES3')
        assert.deepEqual([es3.length, es3.every((r) => r.status === 'na' && r.detail === SCRIPT_NA_DETAIL), es3.map((r) => r.field)], [3, true, ['C1', 'C2', 'essence']])
        assert.equal(by(r1, 'ES1').status, 'pass', '其餘標準照判')
        assert.equal(by(checkCore(s, { ...CTX, locale: 'zh-Hant' }), 'ES3', 'C1').status, 'violation')
        assert.match(msgOf(() => checkCore(s, { ...CTX, locale: 5 })), /^checkCore 之 ctx\.locale 須為/)
    })

    it('②guardOps 與 coreFixOf:預設只轉違規處並記旗標／存量修正有 ES3 之改動;locale en 不轉、不記旗標、存量無改動', () => {
        const s = stateA()
        const op = { op: 'add', kind: 'rule', text: '动量之后見 https://x.test/数据', sources: ['N1'], ...ANN }
        const g0 = guardOps([op], { state: s })
        const g1 = guardOps([op], { state: s, locale: 'en' })
        assert.deepEqual([g0.ops[0].text, g0.flagged.some((f) => f.flag === 'simplified')], ['動量之後見 https://x.test/数据', true])
        assert.deepEqual([g1.ops[0].text, g1.flagged.some((f) => f.flag === 'simplified')], ['动量之后見 https://x.test/数据', false])
        const f0 = coreFixOf(s, { stds: ['ES3'], at: AT })
        const f1 = coreFixOf(s, { stds: ['ES3'], at: AT, locale: 'en' })
        assert.deepEqual(f0.changes.map((x) => x.id), ['C1', 'essence'])
        assert.deepEqual([f1.changes, f1.touched, f1.state.claims[0].text], [[], [], '成本会侵蚀收益'])
        assert.match(msgOf(() => guardOps([op], { state: s, locale: '!!' })), /^guardOps 之 ctx\.locale 不是合法之語言代碼/)
        assert.match(msgOf(() => coreFixOf(s, { locale: 5 })), /^coreFixOf 之 ctx\.locale 須為/)
    })

    it('③文字相似度之折疊經抓取埠(cnToTw):簡體折向正體;本套件無直接 import opencc、package.json 不列 opencc-js', () => {
        assert.equal(foldScript('头发与数据'), '頭髮與數據')
        assert.equal(normText('头发, 与数据'), normText('頭髮與數據'))
        const pkg = JSON.parse(fs.readFileSync(`${PKG}/package.json`, 'utf8'))
        assert.equal('opencc-js' in (pkg.dependencies || {}), false)
        const src = lexSource(fs.readFileSync(`${PKG}/src/guards/similarity.mjs`, 'utf8')).skeleton
        assert.ok(!/opencc/.test(src), 'similarity 不直接 import opencc')
    })

    it('④createExtractRuntime 讀 cfg.lang:locale、提煉與自建之關聯 domain 之語言句、折疊依之;預設 zh-TW;錯值拋錯並點名 cfg.lang;lang 在總組裝之 CFG_KEYS', () => {
        const rt = createExtractRuntime({ lang: 'en' }, SETTINGS)
        assert.deepEqual([rt.locale.code, rt.folds], ['en', { fold: null, clueFold: null }])
        assert.ok(rt.domains.extract.buildSupportCheckPrompt({ concept: '甲', sources: [], items: [] }).includes('reason 用英文一句話'))
        assert.ok(rt.domains.relate.buildPrompt([], new Map()).includes('reason 用英文一句話說明'), '自建之關聯 domain 同一語言設定')
        assert.equal(createExtractRuntime({}, SETTINGS).locale.code, 'zh-TW')
        assert.match(msgOf(() => createExtractRuntime({ lang: 'zh_TW' }, SETTINGS)), /^cfg\.lang 不是合法之語言代碼/)
        assert.ok(CFG_KEYS.includes('lang'))
        resetConceptFold()
    })
})
