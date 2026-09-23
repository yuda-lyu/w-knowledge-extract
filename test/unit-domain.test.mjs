// unit-domain.test.mjs — 領域中立化(通用知識套件)之回歸:預設 prompt/詞彙/設定不綁任何領域、主題範圍由 vocab.domain 注入
// 執行:npx mocha test/unit-domain.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { createDistillDomain, buildDistillPrompt, buildAuditPrompt, buildRevisePrompt, buildFinalPrompt, checkCore, checkIssues, renderCoreBody } from '../src/domain/distillDomain.mjs'
import { VOCAB_DEFAULT, resolveVocab, kbLabelOf } from '../src/domain/vocabDefault.mjs'
import { resolveSettings, SKIP_TITLE_PATTERNS_DEFAULT } from '../src/core/settingsDefault.mjs'

// 原專案之領域用語:通用套件之預設 prompt 不得再出現(使用者 2026-09-23 要求)
const LEGACY_DOMAIN = new RegExp(['量', '化'].join('') + '|交易|金融|行情')

const docs = [{ title: '標題', sourceName: '來源', url: 'https://e.com/a', text: '內文片段' }]
const target = { id: 'a-11111111', title: 'A', category: 'c', concepts: ['x'], summary: 's' }
const cands = new Map([['a-11111111', [{ id: 'b-22222222', title: 'B', category: 'c', concepts: ['x'], summary: 's' }]]])
const promptsOf = (vocab) => {
    const d = createDistillDomain({ vocab })
    return {
        triage: createTriageDomain({ vocab }).buildPrompt(docs),
        extract: createExtractDomain({ vocab }).buildPrompt(docs, ['概念(2)']),
        relate: createRelateDomain({ vocab }).buildPrompt([target], cands),
        distill: d.buildBasePrompt({ concept: '概念' }, [], ''),
        audit: d.kinds.audit.build({ concept: '概念', basePrompt: 'BASE', draft: { essence: 'e' } }),
        revise: d.kinds.revise.build({ draft: {}, issues: [] }),
        accept: d.kinds.accept.build({ draft: {}, issues: [] }),
    }
}

describe('unit-domain', function() {

    it('預設七種角色 prompt 皆領域中立:不含原專案之領域用語,稱呼為「知識庫」', () => {
        for (const [name, p] of Object.entries(promptsOf(null))) {
            assert.doesNotMatch(p, LEGACY_DOMAIN, `${name} prompt 含領域用語`)
            assert.match(p, /^你是知識庫的/, `${name} prompt 稱呼`)
        }
        // 直呼之提示詞建構函數(未給 opt)亦同
        for (const p of [buildDistillPrompt('概念', [], ''), buildAuditPrompt('概念', {}, 'b'), buildRevisePrompt({}, []), buildFinalPrompt({}, [])]) {
            assert.match(p, /^你是知識庫的/)
        }
    })

    it('vocab.domain 注入主題範圍:七種 prompt 之稱呼帶主題;預篩與萃取另加主題限定', () => {
        const ps = promptsOf({ domain: '機器學習' })
        for (const [name, p] of Object.entries(ps)) assert.match(p, /^你是「機器學習」知識庫的/, name)
        assert.match(ps.triage, /本知識庫之主題範圍為「機器學習」：與此主題無關者判 false/)
        assert.match(ps.extract, /是否含有與「機器學習」相關、可長期複用之知識/)
        assert.match(ps.extract, /、與「機器學習」無關之內容，/)
        assert.doesNotMatch(promptsOf(null).triage, /主題範圍為/, '未給 domain 即不限主題')
    })

    it('prompt 仍帶詞彙表(類別/內容類型/關聯型別)與既有 JSON 欄位——版型與 schema 不變', () => {
        const ps = promptsOf({ categories: ['甲類', '其他'], relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突或反例'] })
        assert.match(ps.extract, /category 從此清單擇一：甲類、其他/)
        assert.match(ps.extract, /"category":"甲類"/, 'JSON 範例之 category 取詞彙表第一項,不寫死')
        for (const f of ['key_points', 'concepts', 'claim_type', 'evidence_level', 'regime_dependency', 'counter_views', 'explore']) assert.ok(ps.extract.includes(`"${f}"`), f)
        assert.match(ps.relate, /type 從此清單擇一：前置概念、延伸深化、互補搭配、衝突或反例/)
        assert.match(ps.relate, /"type":"延伸深化"/)
        assert.ok(ps.distill.includes('"essence"') && ps.distill.includes('"disputes"') && ps.distill.includes('"temporal"'))
    })

    it('預設詞彙中立;resolveVocab 整鍵替換(非物件視為未覆寫);kbLabelOf', () => {
        assert.equal(VOCAB_DEFAULT.domain, '')
        assert.ok(VOCAB_DEFAULT.categories.includes('其他'))
        assert.ok(VOCAB_DEFAULT.relationTypes.includes(VOCAB_DEFAULT.conflictType) && VOCAB_DEFAULT.relationTypes.includes(VOCAB_DEFAULT.fallbackType))
        for (const w of [...VOCAB_DEFAULT.categories, ...VOCAB_DEFAULT.relationTypes]) assert.doesNotMatch(w, /策略|因子|市場/, `預設詞彙不綁領域:${w}`)
        const v = resolveVocab({ domain: 'X', categories: ['a'] })
        assert.deepEqual([v.domain, v.categories, v.claimTypes], ['X', ['a'], VOCAB_DEFAULT.claimTypes])
        assert.deepEqual(resolveVocab('bad'), VOCAB_DEFAULT)
        assert.equal(kbLabelOf({ domain: '' }), '知識庫')
        assert.equal(kbLabelOf({ domain: ' 機器學習 ' }), '「機器學習」知識庫')
        assert.equal(kbLabelOf(null), '知識庫')
    })

    it('預篩 reasonOf:模型漏給理由時之預設不綁領域(有 domain 則帶主題)', () => {
        assert.equal(createTriageDomain({}).reasonOf({}), '無可複用知識')
        assert.equal(createTriageDomain({ vocab: { domain: '機器學習' } }).reasonOf({}), '與「機器學習」無關或無可複用知識')
        assert.equal(createTriageDomain({}).reasonOf({ reason: ' 純 新聞 ' }), '純 新聞')
    })

    it('設定預設中立:索引標題「知識庫索引」、網格領域過濾預設不限、標題預篩只含通用彙整貼文樣式', () => {
        const s = resolveSettings({})
        assert.equal(s.indexTitle, '知識庫索引')
        assert.equal(s.fetch.openAlexFields, '')
        assert.deepEqual(s.fetch.arxivCategories, [])
        const res = SKIP_TITLE_PATTERNS_DEFAULT.map((x) => new RegExp(x.p, x.f))
        for (const x of SKIP_TITLE_PATTERNS_DEFAULT) assert.doesNotMatch(x.p, /quant/i, `站台專屬樣式不應為預設:${x.p}`)
        for (const t of ['Weekly Roundup #12', 'Recent ML Links', 'Reading Digest', 'AI weekly #45']) assert.ok(res.some((re) => re.test(t)), `通用彙整貼文須攔下:${t}`)
        for (const t of ['Gradient checkpointing explained', '梯度檢查點之取捨']) assert.ok(!res.some((re) => re.test(t)), `一般文章不得攔下:${t}`)
        assert.equal(resolveSettings({ fetch: { arxivCategories: ['cs.LG'] } }).fetch.arxivCategories[0], 'cs.LG', '安裝方可給領域過濾')
    })

    it('src 全域不含原專案之領域名稱(使用者要求:通用知識套件)', () => {
        const root = path.resolve('src')
        const word = ['量', '化'].join('')
        const hits = fs.readdirSync(root, { recursive: true })
            .filter((f) => String(f).endsWith('.mjs'))
            .filter((f) => fs.readFileSync(path.join(root, String(f)), 'utf8').includes(word))
        assert.deepEqual(hits, [])
    })

    it('checkCore/checkIssues/renderCoreBody:稿件驗證與核心版型', () => {
        assert.equal(checkCore({ essence: '本質', principles: ['原理'], rules: [] }), true)
        assert.equal(checkCore({ essence: '', principles: ['原理'], rules: [] }), false)
        assert.equal(checkCore([]), false)
        assert.equal(checkIssues({ issues: [] }), true)
        assert.equal(checkIssues(null), false)
        const body = renderCoreBody('概念A', { essence: '本質', principles: ['原理'], rules: ['若A則B'], parameters: [{ name: 'k', value: '1|2', note: '出處' }] }, [{ id: 'n1', title: '筆記', sourceName: '來源' }])
        assert.match(body, /^# 核心知識：概念A\n\n## 本質\n\n本質/)
        assert.match(body, /\| k \| 1／2 \| 出處 \|/, '名稱/值/說明三欄一律轉義 |(此前只轉義說明欄)')
        const note = createExtractDomain({}).renderNoteBody({ title: 'T', key_points: ['k'], parameters: [{ name: 'a|b', value: '1|2', note: 'c|d' }] }, { title: 't', sourceName: 's', url: 'u' }, createExtractDomain({}).normalizeQuality({}))
        assert.match(note, /\| a／b \| 1／2 \| c／d \|/, '筆記版型之參數表同一規則')
        assert.match(body, /## 提煉自\n\n- \[\[n1\]\] 筆記（來源）/)
    })

})
