// unit-domain.test.mjs — 領域中立化(通用知識套件)之回歸:預設 prompt/詞彙/設定不綁任何領域、主題範圍由 vocab.domain 注入
// 執行:npx mocha test/unit-domain.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { createDistillDomain } from '../src/domain/distillDomain.mjs'
import { renderRules, emptyState } from '../src/stores/coreState.mjs'
import { VOCAB_DEFAULT, resolveVocab, kbLabelOf } from '../src/domain/vocabDefault.mjs'
import { resolveSettings, SKIP_TITLE_PATTERNS_DEFAULT } from '../src/core/settingsDefault.mjs'

// 原專案之領域用語:通用套件之預設 prompt 不得再出現(使用者 2026-09-23 要求)
const LEGACY_DOMAIN = new RegExp(['量', '化'].join('') + '|交易|金融|行情')

const docs = [{ title: '標題', sourceName: '來源', url: 'https://e.com/a', text: '內文片段' }]
const target = { id: 'a-11111111', title: 'A', category: 'c', concepts: ['x'], summary: 's' }
const cands = new Map([['a-11111111', [{ id: 'b-22222222', title: 'B', category: 'c', concepts: ['x'], summary: 's' }]]])
const promptsOf = (vocab) => {
    const d = createDistillDomain({ vocab })
    const rulesText = renderRules(d.rules)
    return {
        triage: createTriageDomain({ vocab }).buildPrompt(docs),
        extract: createExtractDomain({ vocab }).buildPrompt(docs, ['概念(2)']),
        relate: createRelateDomain({ vocab }).buildPrompt([target], cands),
        distillPropose: d.buildProposePrompt({ concept: '概念', scope: 'concept', digest: '', batch: [], rulesText }),
        distillReview: d.buildReviewPrompt({ concept: '概念', mode: 'delta', ops: [], batch: [], rulesText }),
        distillConsolidate: d.buildConsolidatePrompt({ concept: '概念', scope: 'concept', digest: '', live: 90, cap: 80, rulesText }),
    }
}

describe('unit-domain', function() {

    it('預設六種角色 prompt(預篩、萃取、關聯、提煉之提案／審查／整併)皆領域中立:不含原專案之領域用語,稱呼為「知識庫」', () => {
        for (const [name, p] of Object.entries(promptsOf(null))) {
            assert.doesNotMatch(p, LEGACY_DOMAIN, `${name} prompt 含領域用語`)
            assert.match(p, /^你是知識庫的/, `${name} prompt 稱呼`)
        }
        // 規則表(提案／審查／整併共用之資料)亦中立
        assert.doesNotMatch(renderRules(createDistillDomain({}).rules), LEGACY_DOMAIN)
    })

    it('vocab.domain 注入主題範圍:六種 prompt 之稱呼帶主題;預篩與萃取另加主題限定', () => {
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
        // 提煉(2.0)之提案契約:差量操作(非整份重寫)、主張種類、略過理由
        for (const f of ['"op":"add"', '"op":"confirm"', '"op":"supersede"', '"op":"dispute_add"', '"op":"essence"', 'principle|rule|pitfall|temporal', '"skipped"']) assert.ok(ps.distillPropose.includes(f), f)
        assert.match(ps.distillReview, /"verdicts"/)
        assert.match(ps.distillConsolidate, /"op":"merge"/)
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

    it('renderState:核心版型(本質、主張〔編號〕、參數表轉義 |、提煉自)', () => {
        const s = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s.version = 1
        s.essence = { text: '本質', claims: ['C1'], sources: ['n1'], at: '' }
        s.claims = [{ id: 'C1', kind: 'rule', text: '若A則B', status: 'active', sources: ['n1'], evidence: { level: '中' } }]
        s.parameters = [{ id: 'P1', name: 'k|x', value: '1|2', conditions: 'c|d', status: 'active', sources: ['n1'] }]
        const { body } = createDistillDomain({}).renderState(s, { notesById: new Map([['n1', { title: '筆記', sourceName: '來源' }]]) })
        assert.match(body, /^# 核心知識：概念A\n\n> v1｜/)
        assert.match(body, /## 本質\n\n本質（依〔C1〕）/)
        assert.match(body, /## 可操作規則\n\n- 〔C1〕若A則B（證據中）/)
        assert.match(body, /\| P1 \| k／x \| 1／2 \| c／d \|/, '參數表之各欄一律轉義 |')
        const note = createExtractDomain({}).renderNoteBody({ title: 'T', key_points: ['k'], parameters: [{ name: 'a|b', value: '1|2', note: 'c|d' }] }, { title: 't', sourceName: 's', url: 'u' }, createExtractDomain({}).normalizeQuality({}))
        assert.match(note, /\| a／b \| 1／2 \| c／d \|/, '筆記版型之參數表同一規則')
        assert.match(body, /## 提煉自\n\n- \[\[n1\]\] 筆記（來源）/)
    })

    it('renderState:爭議各方出處＝直接出處 ∪ 所引主張之出處(只引主張之一方不再顯示「（無）」);待解問題章名不帶「供日後抓取」', () => {
        const s = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s.version = 2
        s.claims = [
            { id: 'C1', kind: 'rule', text: '甲', status: 'contested', sources: ['n1'], evidence: { level: '中' } },
            { id: 'C2', kind: 'rule', text: '乙', status: 'contested', sources: ['n2', 'n3'], evidence: { level: '低' } },
        ]
        const sides = [
            { position: '甲方', claims: ['C1'], sources: [] },
            { position: '乙方', claims: ['C2'], sources: ['n3', 'n4'] },
            { position: '丙方', claims: [], sources: [] },
        ]
        s.disputes = [{ id: 'D1', question: '問', status: 'open', sides }]
        s.questions = [{ id: 'Q1', text: '待證之事', status: 'open', sources: ['n1'] }, { id: 'Q2', text: '已結', status: 'resolved', sources: ['n1'] }]
        const { body } = createDistillDomain({}).renderState(s, { notesById: new Map() })
        assert.match(body, /第1方：甲方｜證據[^｜]*｜依〔C1〕｜出處：\[\[n1\]\]/, '只引主張之一方取主張之出處')
        assert.match(body, /第2方：乙方｜證據[^｜]*｜依〔C2〕｜出處：\[\[n3\]\]、\[\[n4\]\]、\[\[n2\]\]\n/, '直接出處在前、聯集去重(n3 不重複)')
        assert.match(body, /第3方：丙方｜證據[^｜]*｜出處：（無）/, '無主張無出處者仍照實顯示')
        assert.match(body, /\n## 待解問題\n\n- 〔Q1〕待證之事\n/)
        assert.doesNotMatch(body, /供日後抓取/, '章名去承諾')
        assert.doesNotMatch(body.split('## 沿革')[0], /〔Q2〕/, '已結案者不列於待解問題')
        assert.match(body, /## 沿革\n\n(- .*\n)*- 〔Q2〕已結案：已結｜/, '已結案者留痕於沿革:文字中之〔Q〕引用在本文可找到(安裝方 §3 #6)')
    })

    it('拆解之爭議(非對立)於沿革列「已拆解」與各方所在之主張;待審行之動詞依操作(拆解／撤回／取代);提案、整併、審查三種提示詞皆說明拆解與「非對立」', () => {
        const s = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s.version = 3
        s.claims = [{ id: 'C1', kind: 'rule', text: '甲', status: 'active', sources: ['n1'] }, { id: 'C2', kind: 'principle', text: '乙', status: 'active', sources: ['n2'] }]
        s.disputes = [{ id: 'D1', question: '硬配之問', status: 'retracted', retractReason: '非對立', statusNote: '兩方回答不同問題', sides: [{ position: '甲方', claims: ['C1'] }, { position: '乙方', claims: ['C2'] }] }]
        s.pendingReview = [{ op: { op: 'dispute_dissolve', id: 'D9', reason: '待審之拆解' } }, { op: { op: 'retract', id: 'C5', reason: '離題' } }]
        const d = createDistillDomain({})
        const { body } = d.renderState(s, { notesById: new Map() })
        assert.match(body, /- 〔D1〕已拆解（非對立：兩方回答不同問題；各方見〔C1〕〔C2〕）：硬配之問/)
        assert.doesNotMatch(body, /## 爭議與未定論/, '拆解後不再列為爭議')
        assert.match(body, /- 待審：〔D9〕擬拆解：待審之拆解/)
        assert.match(body, /- 待審：〔C5〕擬撤回：離題/)
        const rulesText = renderRules(d.rules)
        const pp = d.buildProposePrompt({ concept: '概念', scope: 'concept', digest: '', batch: [], rulesText })
        assert.match(pp, /"op":"dispute_dissolve","id":"D2","reason":"…","kinds":\[null,"principle"\]/)
        assert.match(pp, /kinds\[k\] 為 side k 轉出主張之種類，引主張之方填 null/)
        assert.match(pp, /標有「審查存疑」者請獨立判斷，不可只引述存疑/)
        assert.match(d.buildConsolidatePrompt({ concept: '概念', scope: 'concept', digest: '', live: 90, cap: 80, rulesText }), /dispute_dissolve 拆解非對立之爭議（依規則表之爭議規則與「非對立之界線」判定/)
        const rv = d.buildReviewPrompt({ concept: '概念', mode: 'delta', ops: [], batch: [], rulesText })
        assert.match(rv, /只能以「離題」或「同篇」剔除——不可把真實之對立藏掉/)
        assert.match(rv, /- doubt：只用於爭議類操作——你依規則表「非對立之界線」認為兩方並非對立時用之，reason 寫「非對立」/)
        assert.match(rv, /程式照常套用該操作，並在爭議上標示審查存疑，不會移除/)
        assert.match(rv, /以「對立成立」剔除/)
        assert.match(rv, /拆解（dispute_dissolve）不可逆/)
        assert.match(rv, /爭議各方以 side k 標示，k 即操作之 "side" 值/)
        assert.match(rv, /\{"verdicts":\[\{"i":0,"action":"keep","reason":"","note":""\}\]\}/)
        // 「非對立」之唯一定義在規則表(獨立一條,含演進之切分);其餘三處只引用
        assert.equal(d.rules.filter((r) => /非對立之界線】/.test(r.text)).length, 1)
        assert.match(rulesText, /【非對立之界線】只有兩方回答的是不同問題、或兩方結論可同時成立.*同一對象之結論隨時期改變（較早期間成立、其後之新證據顯示不再成立）屬演進，依演進規則以 supersede 處理/)
        for (const p of [pp, rv]) assert.doesNotMatch(p.replace(rulesText, ''), /兩方並非回答同一問題、或結論並不相反/, '界線不在規則表外另寫一份')
        // md:未解決之爭議常駐顯示審查存疑
        const s2 = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s2.version = 5
        s2.claims = s.claims
        s2.disputes = [{ id: 'D2', question: '問', status: 'open', sides: [{ position: '甲', claims: ['C1'] }, { position: '乙', claims: ['C2'] }], doubt: { reason: '非對立', note: '兩方回答不同問題', version: 4, at: 'T', op: 'dispute_add', count: 2 } }]
        assert.match(d.renderState(s2, { notesById: new Map() }).body, / {2}- 審查存疑（v4，累計 2 次；非對立）：兩方回答不同問題/)
    })

    it('審查提示詞(2026-10-01;安裝方 1.0.5 實測審查以「性質標錯」整條剔除):fix 可改之欄位依本批操作自 FIXABLE_FIELDS 列出並附格式;新增主張／參數不以「性質標錯」剔除;告知剔除被引用之新項會連帶', () => {
        const d = createDistillDomain({})
        const rulesText = renderRules(d.rules)
        const ops = [{ op: 'add', ref: 'a', kind: 'rule', text: 't', sources: ['N1'] }, { op: 'dispute_add', question: 'q', sides: [] }, { op: 'param_add', name: 'k', value: '1', sources: ['N1'] }, { op: 'add', kind: 'rule', text: 'u', sources: ['N2'] }]
        const rv = d.buildReviewPrompt({ concept: '概念', mode: 'delta', ops, batch: [], rulesText })
        assert.ok(rv.includes('本次各操作可改之欄位：add＝text、conditions、pros、cons、period、critique、facet、basis、kind、sources；dispute_add＝question、note；param_add＝name、value、conditions、period、snapshot、sources；'), '只列本批出現之操作、依出現序、與程式同一來源')
        assert.ok(rv.includes('例：{"i":3,"action":"fix","fields":{"kind":"pitfall"},"note":"…"}'))
        assert.ok(rv.includes('新增主張 add、參數 param_add 只能以「離題」「無出處支持」「同篇」「重複」「捏造」剔除——其種類、證據性質、快照標錯者請以 fix 改正，不可剔除'))
        assert.ok(rv.includes('「性質標錯」指操作類別用錯'))
        assert.ok(rv.includes('被其他操作以 "@ref名" 引用之新項若剔除，引用它之操作會一併不成立（連帶拒收）——內容可用而標籤或措辭有誤者，請以 fix 改正，不要剔除。'))
        assert.ok(!d.buildReviewPrompt({ concept: '概念', mode: 'pending', ops: [], batch: [], rulesText }).includes('本次各操作可改之欄位'), '無操作不列')
        assert.ok(d.claimKinds.includes(/"fields":\{"kind":"([^"]+)"\}/.exec(rv)[1]), '範例之種類取自許可清單')
    })

    it('本質之 claims 只列主張、爭議寫在文字(1.0.5 真實模型驗收實測:本質 claims 引爭議之 @d 而整條被拒);文字可寫〔@ref名〕(程式換成實際編號)', () => {
        const d = createDistillDomain({})
        const rulesText = renderRules(d.rules)
        assert.match(rulesText, /不可擇一抹平爭議——有爭議者在文字中並陳兩方，claims 只列主張（不列爭議）/)
        assert.match(rulesText, /同一差量內之新條目寫〔@ref名〕，由程式換成實際編號/)
        assert.match(d.buildProposePrompt({ concept: '概念', scope: 'concept', digest: '', batch: [], rulesText }), /- essence 本質（claims 只列所依之主張，不列爭議）/)
        assert.match(d.buildConsolidatePrompt({ concept: '概念', scope: 'concept', digest: '', live: 90, cap: 80, rulesText }), /- essence 重寫本質（claims 只列主張，不列爭議）/)
    })

    it('toneOf:絕對語氣片語(只計數不擋);前兩字含「不未非無」或為「難以」者不計;不收裸詞以免「一定程度／絕對值／保證金」誤計;absolutePhrases 可換或給 [] 停用', () => {
        const { toneOf } = createDistillDomain({})
        assert.equal(toneOf('預熱一定會提升效果'), '一定會')
        assert.equal(toneOf('此法總是有效'), '總是')
        for (const t of ['預熱不一定會提升效果', '並非總是有效', '難以保證會收斂', '未必總是如此', '在一定程度上有效', '取梯度絕對值', '保證金比率', '']) assert.equal(toneOf(t), '', t)
        assert.equal(toneOf('不一定會，但此法總是有效'), '總是', '同句之否定只豁免該處')
        assert.equal(createDistillDomain({ vocab: { absolutePhrases: ['必勝'] } }).toneOf('此法必勝'), '必勝')
        assert.equal(createDistillDomain({ vocab: { absolutePhrases: [] } }).toneOf('此法總是有效'), '')
    })

    it('規則表:question 規則排在爭議之後、不可把對立改列問題;evidence 規則之 basis 選項取自 vocab.basisCaps 之鍵(不含 *)', () => {
        const rules = createDistillDomain({}).rules
        const ids = rules.map((r) => r.id)
        assert.ok(ids.indexOf('dispute') < ids.indexOf('question') && ids.indexOf('question') < ids.indexOf('kind'))
        assert.deepEqual(rules.map((r) => r.priority), rules.map((r, k) => k + 1), 'priority 連號 1..N')
        const q = rules.find((r) => r.id === 'question').text
        assert.match(q, /question_add/)
        assert.match(q, /不可改列為問題/)
        assert.match(q, /question_resolve/)
        const ev = (vocab) => createDistillDomain({ vocab }).rules.find((r) => r.id === 'evidence').text
        assert.match(ev(null), /basis 寫證據性質，擇自（可並列）：樣本外、樣本內、理論、模擬、案例、實務、教學、觀點、廠商、轉述；/)
        // 預設短詞以子字串比對同時涵蓋長寫法(安裝方 v5 之九個短標記與模型常用之長寫法皆命中;待議 2)
        const ev0 = createDistillDomain({}).evidence
        for (const [b, rank] of [['實務', 2], ['實務經驗', 2], ['教學示範', 2], ['廠商內容', 2], ['觀點', 2], ['轉述', 2], ['樣本外', 0], ['樣本外實證', 0], ['樣本內實證', 1], ['理論', 1], ['模擬', 1], ['實證研究', 1]]) assert.equal(ev0.basisRank(b).rank, rank, b)
        assert.doesNotMatch(ev(null), /[、：]\*[、；]/, '「*」不列為選項')
        assert.match(ev({ basisCaps: { '實驗': 0, '*': 1 } }), /擇自（可並列）：實驗；/, '安裝方改表即改提示詞')
        assert.match(ev({ basisCaps: {} }), /在 basis 寫證據性質；/, '空表時不列選項')
        assert.match(ev(null), /限制（如單一研究、未經獨立驗證）照實寫在 conditions 或 critique/)
    })

    it('resolveVocab:basisCaps／selfLimitPhrases 之預設、null 回預設、{}／[] 停用、形狀錯誤於建構期拋錯', () => {
        assert.deepEqual(resolveVocab({}).basisCaps, VOCAB_DEFAULT.basisCaps)
        assert.deepEqual(resolveVocab({}).selfLimitPhrases, VOCAB_DEFAULT.selfLimitPhrases)
        assert.deepEqual(resolveVocab({ basisCaps: null, selfLimitPhrases: null }).basisCaps, VOCAB_DEFAULT.basisCaps)
        assert.deepEqual(resolveVocab({ basisCaps: null, selfLimitPhrases: null }).selfLimitPhrases, VOCAB_DEFAULT.selfLimitPhrases)
        assert.deepEqual(resolveVocab({ basisCaps: {}, selfLimitPhrases: [] }).basisCaps, {})
        assert.deepEqual(resolveVocab({ basisCaps: {}, selfLimitPhrases: [] }).selfLimitPhrases, [])
        assert.deepEqual(resolveVocab({ basisCaps: { '實驗': '高', '*': -1 } }).basisCaps, { '實驗': '高', '*': -1 }, '等級名與位置整數皆可')
        assert.throws(() => resolveVocab({ basisCaps: ['x'] }), /vocab\.basisCaps 須為物件/)
        assert.throws(() => resolveVocab({ basisCaps: { '實驗': '極高' } }), /vocab\.basisCaps\.實驗 須為 evidenceLevels 之等級名/)
        assert.throws(() => resolveVocab({ basisCaps: { '實驗': 0.5 } }), /vocab\.basisCaps\.實驗/)
        assert.throws(() => resolveVocab({ basisCaps: { ' ': 0 } }), /vocab\.basisCaps 之鍵不可為空字串/)
        assert.throws(() => resolveVocab({ selfLimitPhrases: '單一研究' }), /vocab\.selfLimitPhrases 須為非空字串陣列/)
        assert.throws(() => resolveVocab({ selfLimitPhrases: ['單一研究', ''] }), /vocab\.selfLimitPhrases 須為非空字串陣列/)
        assert.deepEqual(resolveVocab({}).absolutePhrases, VOCAB_DEFAULT.absolutePhrases)
        assert.deepEqual(resolveVocab({ absolutePhrases: null }).absolutePhrases, VOCAB_DEFAULT.absolutePhrases)
        assert.deepEqual(resolveVocab({ absolutePhrases: [] }).absolutePhrases, [])
        assert.throws(() => resolveVocab({ absolutePhrases: '總是' }), /vocab\.absolutePhrases 須為非空字串陣列（\[\] 即不計）/)
        assert.throws(() => resolveVocab({ absolutePhrases: ['總是', 1] }), /vocab\.absolutePhrases 須為非空字串陣列/)
        // 換了 evidenceLevels 時,basisCaps 之等級名須對得上新等級(位置整數不受影響)
        assert.throws(() => resolveVocab({ evidenceLevels: ['強', '弱'], basisCaps: { '實驗': '高' } }), /等級名（強、弱）/)
        assert.doesNotThrow(() => resolveVocab({ evidenceLevels: ['強', '弱'] }), '預設表以位置表達,換等級名不失效')
        // resolveVocab 可重複套用(冪等)
        const once = resolveVocab({ basisCaps: { '實驗': 0 } })
        assert.deepEqual(resolveVocab(once).basisCaps, once.basisCaps)
    })

})
