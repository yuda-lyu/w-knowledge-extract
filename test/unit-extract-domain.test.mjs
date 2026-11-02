// unit-extract-domain.test.mjs — 提煉之內建領域預設:核心 md 版型(renderState)、起草／終審／整併提示詞之契約、規則表、絕對語氣指標,
//   提煉輸入(筆記分節摘要 noteDigest)對關聯投影章之讀法;domain 之成員表(EXTRACT_DOMAIN_MEMBERS 三類)與形狀檢核(extractDomainShapeProblems)、
//   主張種類不可覆寫、死成員已移除、各提示詞首句之角色名(觀察契約)、推定(推定詞 presumedBasis＋出處之判定 ctx.noTopOf)
// 執行:在套件根 node <mocha> test/unit-extract-domain.test.mjs(暫存落 test/_tmp/extract-domain-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import { createExtractDomain, EXTRACT_DOMAIN_MEMBERS, extractDomainShapeProblems, extractFeatureProblems } from '../src/domain/extractDomain.mjs'
import { renderRules } from '../src/stores/stateDigest.mjs'
import { emptyState, DEFAULT_CLAIM_KINDS } from '../src/stores/coreState.mjs'
import { resolveExtractSettings, EXTRACT_FEATURES } from '../src/core/extractSettings.mjs'
import { noteNoTopOf } from '../src/stores/contentCache.mjs'
import { writeMd, readMd, dropSection } from '../src/core/summarizePackage.mjs'
import { RELATE_SECTION_TITLES } from '../src/core/relatePackage.mjs'
import { createSummarizeDomain, QUANT_RULE } from './tools/summarizeForTest.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'
import { promptArgsOf, PROMPT_MEMBERS } from './tools/promptInputs.mjs'

let TMP = '' // 專用暫存根(tmpRoot:套件根下 test/_tmp/<名>-<pid>,與 cwd 無關;並行之多個 mocha 行程互不干擾)

describe('unit-extract-domain', function() {

    before(function() {
        TMP = tmpRoot('extract-domain')
    })

    after(function() {
        removeRoots([TMP])
    })

    it('renderState:核心版型(本質、主張〔編號〕、參數表轉義 |、提煉自)', () => {
        const s = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s.version = 1
        s.essence = { text: '本質', claims: ['C1'], sources: ['n1'], at: '' }
        s.claims = [{ id: 'C1', kind: 'rule', text: '若A則B', status: 'active', sources: ['n1'], evidence: { level: '中' } }]
        s.parameters = [{ id: 'P1', name: 'k|x', value: '1|2', conditions: 'c|d', status: 'active', sources: ['n1'] }]
        const { body } = createExtractDomain({}).renderState(s, { notesById: new Map([['n1', { title: '筆記', sourceName: '來源' }]]) })
        assert.match(body, /^# 核心知識：概念A\n\n> v1｜/)
        assert.match(body, /## 本質\n\n本質（依〔C1〕）/)
        assert.match(body, /## 可操作規則\n\n- 〔C1〕若A則B（證據中）/)
        assert.match(body, /\| P1 \| k／x \| 1／2 \| c／d \|/, '參數表之各欄一律轉義 |')
        // 筆記版型(摘要套件之摘要 domain;經匯入點)之參數表與核心版型同一轉義規則
        const note = createSummarizeDomain({}).renderNoteBody({ title: 'T', key_points: ['k'], parameters: [{ name: 'a|b', value: '1|2', note: 'c|d' }] }, { title: 't', sourceName: 's', url: 'u' }, createSummarizeDomain({}).normalizeQuality({}))
        assert.match(note, /\| a／b \| 1／2 \| c／d \|/, '筆記版型之參數表同一規則')
        assert.match(body, /## 提煉自\n\n- \[\[n1\]\] 筆記（來源）/)
    })

    it('renderState:爭議各方出處＝直接出處 ∪ 所引主張之出處(只引主張之一方顯示主張之出處,不顯示「（無）」);待解問題章名不帶「供日後抓取」', () => {
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
        const { body } = createExtractDomain({}).renderState(s, { notesById: new Map() })
        assert.match(body, /第1方：甲方｜證據[^｜]*｜依〔C1〕｜出處：\[\[n1\]\]/, '只引主張之一方取主張之出處')
        assert.match(body, /第2方：乙方｜證據[^｜]*｜依〔C2〕｜出處：\[\[n3\]\]、\[\[n4\]\]、\[\[n2\]\]\n/, '直接出處在前、聯集去重(n3 不重複)')
        assert.match(body, /第3方：丙方｜證據[^｜]*｜出處：（無）/, '無主張無出處者仍照實顯示')
        assert.match(body, /\n## 待解問題\n\n- 〔Q1〕待證之事\n/)
        assert.doesNotMatch(body, /供日後抓取/, '章名不含承諾字樣')
        assert.doesNotMatch(body.split('## 沿革')[0], /〔Q2〕/, '已結案者不列於待解問題')
        assert.match(body, /## 沿革\n\n(- .*\n)*- 〔Q2〕已結案：已結｜/, '已結案者留痕於沿革:文字中之〔Q〕引用在本文可找到')
    })

    it('拆解之爭議(非對立)於沿革列「已拆解」與各方所在之主張;待審行之動詞依操作(拆解／撤回／取代);起草、整併、終審三種提示詞皆說明拆解與「非對立」', () => {
        const s = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s.version = 3
        s.claims = [{ id: 'C1', kind: 'rule', text: '甲', status: 'active', sources: ['n1'] }, { id: 'C2', kind: 'principle', text: '乙', status: 'active', sources: ['n2'] }]
        s.disputes = [{ id: 'D1', question: '硬配之問', status: 'retracted', retractReason: '非對立', statusNote: '兩方回答不同問題', sides: [{ position: '甲方', claims: ['C1'] }, { position: '乙方', claims: ['C2'] }] }]
        s.pendingReview = [{ op: { op: 'dispute_dissolve', id: 'D9', reason: '待審之拆解' } }, { op: { op: 'retract', id: 'C5', reason: '離題' } }]
        const d = createExtractDomain({})
        const { body } = d.renderState(s, { notesById: new Map() })
        assert.match(body, /- 〔D1〕已拆解（非對立：兩方回答不同問題；各方見〔C1〕〔C2〕）：硬配之問/)
        assert.doesNotMatch(body, /## 爭議與未定論/, '拆解後不再列為爭議')
        assert.match(body, /- 待審：〔D9〕擬拆解：待審之拆解/)
        assert.match(body, /- 待審：〔C5〕擬撤回：離題/)
        const rulesText = renderRules(d.rules)
        // 起草(三席共用):拆解之操作格式與「非對立之界線」之引用(規則表外之說明段)
        const pp = d.buildProposePrompt({ concept: '概念', scope: 'concept', digest: '', batch: [], rulesText })
        assert.match(pp.replace(rulesText, ''), /- dispute_dissolve 拆解非對立之爭議（依規則表之爭議規則與「非對立之界線」判定；內容與出處全留，只拿掉對立標籤/)
        // 拆出之主張與新增者同一標注標準(ES4 丙):kinds[k]、annotations[k]
        assert.match(pp, /"op":"dispute_dissolve","id":"D2","reason":"…","kinds":\[null,"rule"\],"annotations":\[null,\{"critique":"…","pros":\["…"\],"cons":\["出處未載"\]\}\]/)
        assert.match(pp, /kinds\[k\] 為 side k 轉出主張之種類、annotations\[k\] 為其標注（依種類填必填者，同新增主張；條件與該方原有之條件合併），引主張之方兩者皆填 null/)
        assert.match(pp, /標有「終審存疑」者請獨立判斷，不可只引述存疑/)
        // 整併:同一說明
        const cp = d.buildConsolidatePrompt({ concept: '概念', scope: 'concept', digest: '', live: 90, cap: 80, rulesText })
        assert.match(cp.replace(rulesText, ''), /dispute_dissolve 拆解非對立之爭議（依規則表之爭議規則與「非對立之界線」判定/)
        assert.match(cp, /標有「終審存疑」者請獨立判斷，不可只引述存疑/)
        // 終審:爭議類只收形式理由、非對立以 doubt 表達、拆解可以「對立成立」剔除且須明列裁決
        const rv = d.buildReviewPrompt({ concept: '概念', mode: 'delta', ops: [], batch: [], rulesText })
        // 爭議類之剔除只收「離題」(須有高嚴重度意見);同篇與非對立為存疑
        assert.match(rv, /只能以「離題」剔除（須有嚴重度「高」之離題意見）——不可把真實之對立藏掉/)
        assert.match(rv, /- doubt：只用於爭議類操作——reason 擇一：「非對立」（你依規則表「非對立之界線」認為兩方並非對立）｜「同篇」（兩方之對立只出自同一研究自身之正反/)
        assert.match(rv, /程式照常套用該操作，並在爭議上標示終審存疑，不會移除（拆解另由提煉器提出）/)
        assert.match(rv, /拆解 dispute_dissolve 若對立其實成立，以「對立成立」剔除/)
        assert.match(rv, /取代（supersede）、撤回（retract）、合併（merge）、拆解（dispute_dissolve）、拆分（split）不可逆/, '不可逆清單由 TERMINAL_OPS 產生(含拆分)')
        assert.match(rv, /爭議各方以 side k 標示，k 即操作之 "side" 值/)
        assert.match(rv, /\{"verdicts":\[\{"i":0,"action":"keep","reason":"","note":""\}\]\}/)
        // 「非對立」之唯一定義在規則表(獨立一條,含演進之切分);起草、整併、終審三處只引用
        assert.equal(d.rules.filter((r) => /非對立之界線】/.test(r.text)).length, 1)
        assert.match(rulesText, /【非對立之界線】只有兩方回答的是不同問題、或兩方結論可同時成立.*同一對象之結論隨時期改變（較早期間成立、其後之新證據顯示不再成立）屬演進，依演進規則以 supersede 處理/)
        for (const p of [pp, cp, rv]) assert.doesNotMatch(p.replace(rulesText, ''), /兩方並非回答同一問題、或結論並不相反/, '界線不在規則表外另寫一份')
        // md:未解決之爭議常駐顯示終審存疑
        const s2 = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s2.version = 5
        s2.claims = s.claims
        s2.disputes = [{ id: 'D2', question: '問', status: 'open', sides: [{ position: '甲', claims: ['C1'] }, { position: '乙', claims: ['C2'] }], doubt: { reason: '非對立', note: '兩方回答不同問題', version: 4, at: 'T', op: 'dispute_add', count: 2 } }]
        assert.match(d.renderState(s2, { notesById: new Map() }).body, / {2}- 終審存疑（v4，累計 2 次；非對立）：兩方回答不同問題/)
    })

    it('終審提示詞:fix 可改之欄位依本批操作自 FIXABLE_FIELDS 列出並附格式;新增主張／參數不以「性質標錯」剔除(標籤以 fix 改正);告知剔除被引用之新項會連帶', () => {
        const d = createExtractDomain({})
        const rulesText = renderRules(d.rules)
        const ops = [{ op: 'add', ref: 'a', kind: 'rule', text: 't', sources: ['N1'] }, { op: 'dispute_add', question: 'q', sides: [] }, { op: 'param_add', name: 'k', value: '1', sources: ['N1'] }, { op: 'add', kind: 'rule', text: 'u', sources: ['N2'] }]
        const rv = d.buildReviewPrompt({ concept: '概念', mode: 'delta', ops, batch: [], rulesText })
        assert.ok(rv.includes('本次各操作可改之欄位：add＝text、conditions、pros、cons、period、critique、facet、basis、kind、sources；dispute_add＝question、note；param_add＝name、value、conditions、period、snapshot、sources；'), '只列本批出現之操作、依出現序、與程式同一來源')
        // 改種類須一併補標注(否則定稿篩選不採:只改 kind 為 pitfall 而未補條件者即被剔除——範例須示範補足)
        assert.ok(rv.includes('改主張之種類時須一併補足該種類所需之標注（規則表之主張種類；標注不全之定稿不採）；例：{"i":3,"action":"fix","fields":{"kind":"pitfall","critique":"…","conditions":["…"]},"note":"…"}'))
        assert.ok(rv.includes('新增主張 add、參數 param_add 只能以「離題」「無出處支持」「同篇」「重複」「捏造」剔除——其種類、證據性質、快照標錯者請以 fix 改正，不可剔除'))
        assert.ok(rv.includes('「性質標錯」指操作類別用錯'))
        assert.ok(rv.includes('被其他操作以 "@ref名" 引用之新項若剔除，引用它之操作會一併不成立（連帶拒收）——內容可用而標籤或措辭有誤者，請以 fix 改正，不要剔除。'))
        assert.ok(!d.buildReviewPrompt({ concept: '概念', mode: 'pending', ops: [], batch: [], rulesText }).includes('本次各操作可改之欄位'), '無操作不列')
        assert.ok(d.claimKinds.includes(/"fields":\{"kind":"([^"]+)"/.exec(rv)[1]), '範例之種類取自許可清單')
    })

    it('本質之 claims 只列主張、爭議寫在文字(claims 引爭議者整條被拒收);文字可寫〔@ref名〕(程式換成實際編號)', () => {
        const d = createExtractDomain({})
        const rulesText = renderRules(d.rules)
        assert.match(rulesText, /不可擇一抹平爭議——有爭議者在文字中並陳兩方，claims 只列主張（不列爭議）/)
        assert.match(rulesText, /同一差量內之新條目寫〔@ref名〕，由程式換成實際編號/)
        assert.match(d.buildProposePrompt({ concept: '概念', scope: 'concept', digest: '', batch: [], rulesText }), /- essence 本質（claims 只列所依之主張，不列爭議）/)
        assert.match(d.buildConsolidatePrompt({ concept: '概念', scope: 'concept', digest: '', live: 90, cap: 80, rulesText }), /- essence 重寫本質（claims 只列主張，不列爭議）/)
    })

    it('toneOf:絕對語氣片語(只計數不擋);前兩字含「不未非無」或為「難以」者不計;不收裸詞以免「一定程度／絕對值／保證金」誤計;absolutePhrases 可換或給 [] 停用', () => {
        const { toneOf } = createExtractDomain({})
        assert.equal(toneOf('預熱一定會提升效果'), '一定會')
        assert.equal(toneOf('此法總是有效'), '總是')
        for (const t of ['預熱不一定會提升效果', '並非總是有效', '難以保證會收斂', '未必總是如此', '在一定程度上有效', '取梯度絕對值', '保證金比率', '']) assert.equal(toneOf(t), '', t)
        assert.equal(toneOf('不一定會，但此法總是有效'), '總是', '同句之否定只豁免該處')
        assert.equal(createExtractDomain({ vocab: { absolutePhrases: ['必勝'] } }).toneOf('此法必勝'), '必勝')
        assert.equal(createExtractDomain({ vocab: { absolutePhrases: [] } }).toneOf('此法總是有效'), '')
    })

    it('規則表:question 規則排在爭議之後、不可把對立改列問題;evidence 規則之 basis 選項取自 vocab.basisCaps 之鍵(不含 *)', () => {
        const rules = createExtractDomain({}).rules
        const ids = rules.map((r) => r.id)
        assert.ok(ids.indexOf('dispute') < ids.indexOf('question') && ids.indexOf('question') < ids.indexOf('kind'))
        assert.deepEqual(rules.map((r) => r.priority), rules.map((r, k) => k + 1), 'priority 連號 1..N')
        const q = rules.find((r) => r.id === 'question').text
        assert.match(q, /question_add/)
        assert.match(q, /不可改列為問題/)
        assert.match(q, /question_resolve/)
        const ev = (vocab) => createExtractDomain({ vocab }).rules.find((r) => r.id === 'evidence').text
        // 「擇自」之清單與封頂之等級依量化詞彙之覆寫(本案之斷言依之)
        assert.match(ev(QUANT_VOCAB), /basis 寫證據性質，擇自（可並列）：樣本外、樣本內、理論、模擬、案例、實務、教學、觀點、廠商、轉述；/)
        // 預設短詞以子字串比對同時涵蓋長寫法(短標記與模型常用之長寫法皆命中)
        const ev0 = createExtractDomain({ vocab: QUANT_VOCAB }).evidence
        for (const [b, rank] of [['實務', 2], ['實務經驗', 2], ['教學示範', 2], ['廠商內容', 2], ['觀點', 2], ['轉述', 2], ['樣本外', 0], ['樣本外實證', 0], ['樣本內實證', 1], ['理論', 1], ['模擬', 1], ['實證研究', 1]]) assert.equal(ev0.basisRank(b).rank, rank, b)
        assert.doesNotMatch(ev(QUANT_VOCAB), /[、：]\*[、；]/, '「*」不列為選項')
        assert.match(ev({ basisCaps: { '實驗': 0, '*': 1 } }), /擇自（可並列）：實驗；/, '安裝方改表即改提示詞')
        assert.match(ev({ basisCaps: {} }), /在 basis 寫證據性質；/, '空表時不列選項')
        assert.match(ev({ basisCaps: { '實驗': 0, '*': 1 } }), /擇自（可並列）：實驗；主張須為出處直接陳述之內容（同義改寫可），不寫入推論；/, '無推論類 → 一律直接陳述')
        assert.match(ev(QUANT_VOCAB), /限制（如單一研究、未經獨立驗證）照實寫在 conditions 或 critique/)
        // 預設(中立)之清單與封頂:只有經獨立驗證者可達最高
        assert.match(ev(null), /basis 寫證據性質，擇自（可並列）：獨立驗證、單一研究、理論、模擬、案例、實務、教學、觀點、廠商、轉述；/)
        const evN = createExtractDomain({}).evidence
        for (const [b, rank] of [['獨立驗證', 0], ['經獨立驗證之重現', 0], ['單一研究', 1], ['理論', 1], ['實證研究', 1], ['實務經驗', 2], ['轉述', 2]]) assert.equal(evN.basisRank(b).rank, rank, b)
    })

    // ── 提煉輸入對關聯投影章之讀法(章名為關聯套件之跨套件契約常數 RELATE_SECTION_TITLES;投影之章序與重算屬關聯套件,
    //    既有筆記之章序不一——提煉依章名去留,不依位置)──
    it('提煉輸入(分節摘要):去關聯章、留衝突章(爭議之直接材料);衝突對象依同批標代號或標題;dropSection 只去關聯章——章名取關聯套件之常數', () => {
        const REL = RELATE_SECTION_TITLES.relations
        const CONF = RELATE_SECTION_TITLES.conflicts
        assert.deepEqual([REL, CONF], ['關聯', '⚠ 衝突與反例'], '章名為跨套件之契約(摘要套件之 NON_CONTENT_SECTIONS 亦列之)')
        const file = `${TMP}/note-b.md`
        // 關聯段投影後之形狀:關聯章在前、⚠ 章在後;frontmatter conflicts 列衝突對象
        writeMd(file, { title: 'B', slug: 'b-22222222', conflicts: ['c-33333333', 'd-44444444'] },
            `# B\n\n內文\n\n## ${REL}\n\n- [互補搭配] → [[e-55555555]] T：r2\n- [衝突或反例] ← [[d-44444444]] D 標題：丙說P丁說Q\n\n## ${CONF}\n\n- 與 [[c-33333333]] C 標題：甲說X乙說Y\n- 與 [[d-44444444]] D 標題：丙說P丁說Q`)
        const titles = { 'c-33333333': 'C 標題' }
        const d = createExtractDomain({}).noteDigest({ id: 'b-22222222', title: 'B', sourceName: 's' }, readMd(file), {
            code: 'N1', codeOf: (id) => (id === 'd-44444444' ? 'N2' : ''), titleOf: (id) => titles[id] || '',
        })
        assert.match(d.text, new RegExp(`【${CONF}】[\\s\\S]*丙說P丁說Q`))
        assert.doesNotMatch(d.text, new RegExp(`## ${REL}|\\[\\[e-55555555\\]\\]`), '關聯章不進提煉輸入')
        assert.match(d.text, /衝突對象：〈C 標題〉（非本批）、N2（同批）/)
        // dropSection 對「關聯在前、衝突在後」亦只去關聯章
        const body3 = `# X\n\n內文\n\n## ${REL}\n\n- a\n\n## ${CONF}\n\n- 與 [[y]] Y：r`
        assert.equal(dropSection(body3, REL), `# X\n\n內文\n\n## ${CONF}\n\n- 與 [[y]] Y：r`)
    })

    // ── domain 之成員表與形狀檢核(注入整組 domain 之依據)──

    it('EXTRACT_DOMAIN_MEMBERS 三類:資料成員(必填)、函數成員(每輪無條件呼叫者必填／依功能開啟者／選填);內建 domain 之成員恰為成員表且型別相符;死成員已移除', () => {
        const M = EXTRACT_DOMAIN_MEMBERS
        assert.ok(Object.isFrozen(M) && Object.values(M).every(Object.isFrozen))
        const by = (pred) => Object.entries(M).filter(([, m]) => pred(m)).map(([k]) => k)
        assert.deepEqual(by((m) => m.kind === 'data' && m.need === 'always'), ['kb', 'claimKinds', 'limits', 'rules', 'evidence', 'weakEvidence', 'evidenceRule'])
        assert.deepEqual(by((m) => m.kind === 'fn' && m.need === 'always'), ['noteDigest', 'renderState', 'toneOf', 'buildProposePrompt', 'buildIntegratePrompt', 'buildAuditPrompt', 'buildRevisePrompt', 'buildReviewPrompt', 'buildAcceptAppendix', 'buildConsolidatePrompt'])
        assert.deepEqual(Object.fromEntries(by((m) => m.need === 'feature').map((k) => [k, [...M[k].features]])), {
            buildSupportCheckPrompt: ['supportCheck', 'supportStock'], buildOrphanCheckPrompt: ['orphanCheck'], buildDisputeCheckPrompt: ['disputeCheck'], buildSynonymCheckPrompt: ['synonymCheck'],
        })
        assert.deepEqual(by((m) => m.need === 'optional'), ['buildSynonymProposePrompt', 'buildSupportRevisePrompt', 'buildEssencePrompt', 'buildRecheckText', 'withdrawnRule', 'renderTwinRedirect', 'contentKeyVersion'])
        assert.ok(Object.values(M).every((m) => typeof m.desc === 'string' && m.desc.length > 2 && (m.need === 'feature') === Array.isArray(m.features)))
        const d = createExtractDomain({})
        assert.deepEqual(Object.keys(d).sort(), Object.keys(M).sort(), '內建 domain 之成員恰為成員表')
        for (const [k, m] of Object.entries(M)) assert.equal(typeof d[k] === 'function', m.kind === 'fn', `${k}:型別同成員表`)
        for (const dead of ['checkDeltaExtra', 'kindLabels']) assert.equal(dead in d, false, `${dead} 已移除(無讀者)`)
    })

    it('extractDomainShapeProblems:內建者(預設與覆寫詞彙)無問題;缺恆必填成員、函數成員非函數(選填者給了亦然)、非物件 → 各自之說明', () => {
        const d = createExtractDomain({})
        assert.deepEqual([extractDomainShapeProblems(d), extractDomainShapeProblems(createExtractDomain({ vocab: { ...QUANT_VOCAB, evidenceRule: QUANT_RULE } }))], [[], []])
        assert.deepEqual([null, 'x', [], undefined].map((x) => extractDomainShapeProblems(x)), [['domain 須為物件'], ['domain 須為物件'], ['domain 須為物件'], ['domain 須為物件']])
        const without = (...ks) => Object.fromEntries(Object.entries(d).filter(([k]) => !ks.includes(k)))
        assert.deepEqual(extractDomainShapeProblems(without('kb', 'renderState', 'buildAcceptAppendix', 'evidenceRule')), ['缺成員：kb、evidenceRule、renderState、buildAcceptAppendix'])
        assert.deepEqual(extractDomainShapeProblems({ ...d, toneOf: 'x', buildEssencePrompt: 1 }), ['toneOf 須為函數', 'buildEssencePrompt 須為函數'], '選填成員給了亦須為函數')
    })

    it('extractDomainShapeProblems 不判依功能而必填之成員與「非對立之界線」(只由 extractFeatureProblems 判——同一規則不寫兩處):缺之、或規則表無 disputeBoundary 皆不拒;功能開啟時由功能之判定指出', () => {
        const d = createExtractDomain({})
        const feature = Object.entries(EXTRACT_DOMAIN_MEMBERS).filter(([, m]) => m.need !== 'always').map(([k]) => k)
        const base = Object.fromEntries(Object.entries(d).filter(([k]) => !feature.includes(k)))
        const noBoundary = { ...d, rules: d.rules.filter((r) => r.id !== 'disputeBoundary') }
        assert.deepEqual([extractDomainShapeProblems(base), extractDomainShapeProblems(noBoundary)], [[], []])
        assert.equal(extractDomainShapeProblems.length, 1, '不收設定')
        const S = (standards) => resolveExtractSettings({ extract: { standards: { ...standards, ai: { first: { use: 'a' }, second: { use: 'b' } } } } })
        assert.deepEqual(extractFeatureProblems(S({ orphanCheck: { perRun: 1 } }), base), ['失撐主張專責佇列(extract.standards.orphanCheck.perRun > 0)已啟用,但 domain 缺 buildOrphanCheckPrompt'])
        assert.deepEqual(extractFeatureProblems(S({ disputeCheck: { perRun: 1 } }), noBoundary), ['爭議覆核(extract.standards.disputeCheck.perRun > 0)已啟用,但 domain.rules 缺 id「disputeBoundary」之規則（爭議覆核以之為判準）'])
    })

    it('extractFeatureProblems(功能與席位之單一判定;提煉段執行期與組裝者啟動期同讀):已開啟之功能所需之判定小組必填席(一句列出開啟者)、依功能而必填之 domain 函數成員(一句列出需要它之開啟者;ES11 亦檢)、爭議覆核之「非對立之界線」;功能皆未開 → 無問題', () => {
        const d = createExtractDomain({})
        const SEATS2 = { first: { use: 'a' }, second: { use: 'b' } }
        const S = (standards, ai = SEATS2) => resolveExtractSettings({ extract: { standards: { ...standards, ai: { ...ai } } } })
        const ALL = { supportCheck: { enabled: true }, supportStock: { perRun: 1 }, orphanCheck: { perRun: 1 }, disputeCheck: { perRun: 1 }, synonymCheck: { perRun: 1 } }
        const W = {
            supportCheck: '出處支持覆核(extract.standards.supportCheck.enabled)', supportStock: '出處支持存量覆核(extract.standards.supportStock.perRun > 0)', orphanCheck: '失撐主張專責佇列(extract.standards.orphanCheck.perRun > 0)',
            disputeCheck: '爭議覆核(extract.standards.disputeCheck.perRun > 0)', synonymCheck: '同義核心核對(extract.standards.synonymCheck.perRun > 0)',
        }
        assert.deepEqual([extractFeatureProblems(S(ALL), d), extractFeatureProblems(S({}, { first: null, second: null }), {}), extractFeatureProblems(resolveExtractSettings({}), null)], [[], [], []], '齊備 → 無;功能皆未開 → 不檢席位與成員')
        // 席位:各功能共用一組(一句,列出全部開啟者與缺之席)
        assert.deepEqual(extractFeatureProblems(S(ALL, { first: { use: 'a' } }), d), [`${Object.values(W).join('、')}已啟用,但缺席位 settings.extract.standards.ai.second`])
        assert.deepEqual(extractFeatureProblems(S({ synonymCheck: { perRun: 2 } }, { first: null, second: null }), d), [`${W.synonymCheck}已啟用,但缺席位 settings.extract.standards.ai.first、settings.extract.standards.ai.second`], '同義核心亦檢席位')
        // 成員:依成員表之序,每成員一句(列出需要它之開啟者);非函數視同缺
        const lack = { ...d, buildSupportCheckPrompt: undefined, buildOrphanCheckPrompt: 'x', buildDisputeCheckPrompt: undefined, buildSynonymCheckPrompt: undefined }
        assert.deepEqual(extractFeatureProblems(S(ALL), lack), [
            `${W.supportCheck}、${W.supportStock}已啟用,但 domain 缺 buildSupportCheckPrompt`, `${W.orphanCheck}已啟用,但 domain 缺 buildOrphanCheckPrompt`,
            `${W.disputeCheck}已啟用,但 domain 缺 buildDisputeCheckPrompt`, `${W.synonymCheck}已啟用,但 domain 缺 buildSynonymCheckPrompt`,
        ])
        assert.deepEqual(extractFeatureProblems(S({ supportStock: { perRun: 1 } }), lack), [`${W.supportStock}已啟用,但 domain 缺 buildSupportCheckPrompt`], '只列開啟者')
        assert.deepEqual(extractFeatureProblems(S({ synonymCheck: { perRun: 1 } }), { ...d, buildSynonymProposePrompt: undefined, buildSupportRevisePrompt: undefined }), [], '同義提議與依出處收斂之修訂為選填')
        // 爭議覆核:規則表須含「非對立之界線」
        const noBoundary = { ...d, rules: d.rules.filter((r) => r.id !== 'disputeBoundary') }
        assert.deepEqual(extractFeatureProblems(S({ disputeCheck: { perRun: 1 } }), noBoundary), [`${W.disputeCheck}已啟用,但 domain.rules 缺 id「disputeBoundary」之規則（爭議覆核以之為判準）`])
        assert.deepEqual(extractFeatureProblems(S({ supportCheck: { enabled: true } }), noBoundary), [], '爭議覆核未開不檢')
        // 多種問題並列(席位 → 成員 → 規則表)
        assert.equal(extractFeatureProblems(S({ disputeCheck: { perRun: 1 } }, { first: null, second: { use: 'b' } }), { ...noBoundary, buildDisputeCheckPrompt: undefined }).length, 3)
        // o.enabled 覆寫設定之開關(子階段之選項)、o.domainLabel 為訊息中 domain 之稱呼(組裝者之啟動期以 cfg.domains.extract 指出注入之 domain)
        assert.deepEqual(extractFeatureProblems(S({}), lack, { enabled: ['orphanCheck'] }), [`${W.orphanCheck}已啟用,但 domain 缺 buildOrphanCheckPrompt`])
        assert.deepEqual(extractFeatureProblems(S({ orphanCheck: { perRun: 1 } }), lack, { domainLabel: 'cfg.domains.extract' }), [`${W.orphanCheck}已啟用,但 cfg.domains.extract 缺 buildOrphanCheckPrompt`])
        // 訊息之稱呼取功能表(core/extractSettings 之 EXTRACT_FEATURES),不另寫
        assert.deepEqual(Object.fromEntries(EXTRACT_FEATURES.map((f) => [f.key, f.what])), W)
    })

    it('成員表之依功能必填(need \'feature\')只引功能表之鍵;每一功能表之功能至少需一個成員(其提示詞)', () => {
        const keys = new Set(EXTRACT_FEATURES.map((f) => f.key))
        const feat = Object.entries(EXTRACT_DOMAIN_MEMBERS).filter(([, m]) => m.need === 'feature')
        for (const [k, m] of feat) for (const f of m.features) assert.ok(keys.has(f), `${k} 之 ${f} 須為 EXTRACT_FEATURES 之鍵`)
        assert.deepEqual([...keys].filter((f) => !feat.some(([, m]) => m.features.includes(f))), [], '每一功能皆有其提示詞成員')
    })

    it('extractDomainShapeProblems:資料成員之形狀(kb、claimKinds 不可覆寫、limits、rules、evidence、weakEvidence、evidenceRule、選填之 contentKeyVersion)', () => {
        const d = createExtractDomain({})
        const shape = (k, v) => extractDomainShapeProblems({ ...d, [k]: v })
        for (const v of ['', '  ', 5, null]) assert.deepEqual(shape('kb', v), ['kb 須為非空字串（知識庫之稱呼）'], JSON.stringify(v))
        const ck = 'claimKinds 須為內建之主張種類（principle、rule、pitfall、temporal）——不可覆寫：規則表、檢定標準與核心版型皆以之為準'
        for (const v of [['rule'], [...DEFAULT_CLAIM_KINDS, 'extra'], ['rule', 'principle', 'pitfall', 'temporal'], 'principle', null]) assert.deepEqual(shape('claimKinds', v), [ck], JSON.stringify(v))
        for (const v of [{}, { text: 0 }, { text: '90' }, [], null]) assert.deepEqual(shape('limits', v), ['limits 須為物件且各值為正數（長度上限）'], JSON.stringify(v))
        const R = (p) => [`rules 須為規則陣列 [{ id, priority, text }]：${p}`]
        assert.deepEqual(shape('rules', []), R('須為非空陣列'))
        assert.deepEqual(shape('rules', 'x'), R('須為非空陣列'))
        assert.deepEqual(shape('rules', ['x']), R('第 1 條：須為物件 { id, priority, text }'))
        assert.deepEqual(shape('rules', [{ id: '', priority: 1, text: 't' }]), R('第 1 條：id 須為非空字串'))
        assert.deepEqual(shape('rules', [...d.rules, { id: 'z', priority: '9', text: 't' }]), R(`第 ${d.rules.length + 1} 條：「z」之 priority 須為數字`))
        assert.deepEqual(shape('rules', [{ id: 'a', priority: 1, text: ' ' }]), R('第 1 條：「a」之 text 須為非空字串'))
        assert.deepEqual(shape('rules', [...d.rules, { ...d.rules[0] }]), R(`id「${d.rules[0].id}」重複`))
        for (const v of [{}, { ...d.evidence, apply: 1 }, { ...d.evidence, levels: [] }, { ...d.evidence, selfLimitOf: null }]) assert.deepEqual(shape('evidence', v), ['evidence 須為證據判定物件（具 apply、levels、selfLimitOf）'])
        assert.deepEqual([shape('weakEvidence', 5), shape('weakEvidence', '')], [['weakEvidence 須為字串'], []])
        assert.deepEqual([shape('evidenceRule', null), shape('evidenceRule', QUANT_RULE)], [[], []], 'null＝停用;規則之設定形可編譯者亦可')
        for (const v of [{ subject: 'x' }, 'x', 5]) assert.deepEqual(shape('evidenceRule', v), ['evidenceRule 須為摘要套件之證據規則（resolveExtractVocab 之 evidenceRule）或 null'], JSON.stringify(v))
        assert.deepEqual([shape('contentKeyVersion', 5), shape('contentKeyVersion', undefined)], [['contentKeyVersion 須為字串（內容鍵之版本）'], []])
    })

    it('主張種類不可覆寫:工廠不收、詞彙表拒收;注入者改種類即形狀不合', () => {
        assert.deepEqual(createExtractDomain({ claimKinds: ['rule'] }).claimKinds, DEFAULT_CLAIM_KINDS, '工廠不收此選項')
        assert.throws(() => createExtractDomain({ vocab: { claimKinds: ['rule'] } }), /^Error: vocab 含不認得之鍵：claimKinds/)
        assert.match(extractDomainShapeProblems({ ...createExtractDomain({}), claimKinds: ['rule', 'pitfall'] }).join('；'), /claimKinds 須為內建之主張種類/)
    })

    it('各提示詞首句之角色名(觀察契約:替身與觀察工具據此辨認棒次):「你是<稱呼>的<角色>。」——稱呼取詞彙表(kbLabel／domain)', () => {
        const ROLES = {
            propose: '提煉器', integrate: '整合員', audit: '審計員', revise: '修訂員', review: '終審員', consolidate: '整併員', essence: '整併員',
            supportCheck: '出處核對員', orphanCheck: '出處核對員', supportRevise: '修訂員', disputeCheck: '爭議覆核員', synonymPropose: '同義概念提議員', synonymCheck: '同義概念覆核員',
        }
        for (const vocab of [null, { kbLabel: '星空知識庫' }, { domain: '天文學' }]) {
            const d = createExtractDomain({ vocab })
            const args = promptArgsOf(renderRules(d.rules), d.kb)
            for (const [key, role] of Object.entries(ROLES)) assert.ok(d[PROMPT_MEMBERS[key]](...args[key]).startsWith(`你是${d.kb}的${role}。`), `${d.kb}／${key}:${role}`)
        }
        assert.deepEqual([createExtractDomain({}).kb, createExtractDomain({ vocab: { domain: '天文學' } }).kb], ['知識庫', '「天文學」知識庫'])
    })

    // ── 推定:推定詞(vocab.presumedBasis)＋出處之判定(ctx.noTopOf;判準為摘要套件之 noTopEvidenceOf,與提煉段同一判定 noteNoTopOf)──

    /** 一條主張(basis 空白、出處之內容類型無證據性質關鍵詞)與一則爭議(一方只有立場＋出處、一方引該主張) */
    const presumeState = (sources) => {
        const s = emptyState({ coreId: 'k', concept: '概念A', scope: 'concept' })
        s.version = 1
        s.claims = [{ id: 'C1', kind: 'rule', text: '甲主張', status: 'contested', sources, evidence: { level: '中' } }]
        s.disputes = [{ id: 'D1', question: '問', status: 'open', sides: [{ position: '甲方', sources: [sources[0]], evidence: { level: '中' } }, { position: '乙方', claims: ['C1'], sources: [], evidence: { level: '中' } }] }]
        return s
    }
    const noteOf = (id, caveats) => ({ id, title: id, claimType: '實證研究', evidenceLevel: '中', caveats })
    const QUANT_RULED = { ...QUANT_VOCAB, evidenceRule: QUANT_RULE }

    it('推定:出處筆記(現存者)皆自承無最高級之要件 → 主張與爭議之方標推定詞;判定為嚴式(明確自承)或寬式(涉及而未明確)皆成立;任一出處未自承 → 不推', () => {
        const d = createExtractDomain({ vocab: QUANT_RULED })
        const rule = d.evidenceRule
        assert.deepEqual([rule.states('只有樣本內回測'), rule.admits('只有樣本內回測')], [true, false], '前提:嚴式獨有之句')
        assert.deepEqual([rule.states('未說明是否做過樣本外驗證'), rule.admits('未說明是否做過樣本外驗證')], [false, true], '前提:寬式獨有之句')
        const notes = new Map([['n1', noteOf('n1', ['只有樣本內回測'])], ['n2', noteOf('n2', ['未說明是否做過樣本外驗證'])], ['n3', noteOf('n3', ['樣本只有兩組'])]])
        const render = (s) => d.renderState(s, { notesById: notes, noTopOf: (nid) => noteNoTopOf(notes.get(nid), null, rule) }).body
        const both = render(presumeState(['n1', 'n2']))
        assert.match(both, /- 〔C1〕甲主張〔樣本內〕（證據中｜有爭議）/, '嚴式獨有與寬式之出處皆自承 → 推定')
        assert.match(both, /第1方：甲方〔樣本內〕｜/, '爭議之一方(自身出處)亦推定')
        assert.match(both, /第2方：乙方〔樣本內〕｜/, '引主張之一方取所引主張之標記')
        assert.match(render(presumeState(['n1'])), /- 〔C1〕甲主張〔樣本內〕（/, '嚴式獨有亦推定(與摘要之最高級要件同一判準)')
        assert.match(render(presumeState(['n1', 'n3'])), /- 〔C1〕甲主張（證據中｜有爭議）/, '任一出處未自承 → 不推')
        assert.match(render(presumeState(['n1', 'gone'])), /- 〔C1〕甲主張〔樣本內〕（/, '只看現存之出處筆記')
        assert.match(render(presumeState(['gone'])), /- 〔C1〕甲主張（證據中｜有爭議）/, '出處筆記皆不存在 → 不推')
    })

    it('推定:另一種合格證據(alt)之肯定陳述 → 不推定;caveats 取 md 之 frontmatter(無則取記錄)、證據說明取 md 之證據等級行(同摘要之讀法)', () => {
        const alt = { ...QUANT_RULE, alt: [{ p: '^(?!.*(?:未|無)).*獨立重現' }] }
        const d = createExtractDomain({ vocab: { ...QUANT_VOCAB, evidenceRule: alt } })
        const mdOf = (caveats, note) => ({ front: { title: 'T', ...(caveats ? { caveats } : {}) }, body: `# T\n\n## 品質與證據標注\n\n- 證據等級：高（${note}）\n` })
        const rec = noteOf('n1', ['無樣本外驗證'])
        assert.equal(noteNoTopOf(rec, mdOf(null, '回溯測試'), d.evidenceRule), true, 'md 無 caveats → 取記錄')
        assert.equal(noteNoTopOf(rec, mdOf(null, '已獲兩個團隊獨立重現'), d.evidenceRule), false, '證據說明肯定陳述另一種合格證據 → 不成立')
        assert.equal(noteNoTopOf(noteOf('n1', []), mdOf(['無樣本外驗證'], '回溯測試'), d.evidenceRule), true, 'md 之 caveats 優先')
        assert.equal(noteNoTopOf(rec, mdOf([], '回溯測試'), d.evidenceRule), false, 'md 之 caveats 為空陣列亦優先(不退回記錄)')
        assert.equal(noteNoTopOf(rec, null, d.evidenceRule), true, 'md 讀不到 → 只以記錄判')
        assert.equal(noteNoTopOf(rec, null, createExtractDomain({}).evidenceRule), false, '未給證據規則(停用)→ 恆不成立')
        const notes = new Map([['n1', rec]])
        const mds = { n1: mdOf(null, '已獲兩個團隊獨立重現') }
        const body = d.renderState(presumeState(['n1']), { notesById: notes, noTopOf: (nid) => noteNoTopOf(notes.get(nid), mds[nid], d.evidenceRule) }).body
        assert.match(body, /- 〔C1〕甲主張（證據中｜有爭議）/, 'alt 支持 → 不推定')
    })

    it('推定:推定詞為 null(預設)→ 不推定(出處判定為真亦然、不需 ctx.noTopOf);推定詞已設而 ctx.noTopOf 非函數 → 拋(不可靜默不推定)', () => {
        const notes = new Map([['n1', noteOf('n1', ['無樣本外驗證'])]])
        const yes = () => true
        const plain = createExtractDomain({ vocab: { ...QUANT_RULED, presumedBasis: null } })
        assert.match(plain.renderState(presumeState(['n1']), { notesById: notes, noTopOf: yes }).body, /- 〔C1〕甲主張（證據中｜有爭議）/)
        assert.doesNotThrow(() => plain.renderState(presumeState(['n1']), { notesById: notes }))
        assert.doesNotThrow(() => createExtractDomain({}).renderState(presumeState(['n1'])))
        const d = createExtractDomain({ vocab: QUANT_RULED })
        const want = 'renderState 需要 ctx.noTopOf(筆記 id) => Boolean：詞彙表之推定詞（presumedBasis「樣本內」）已設，推定須知各出處筆記是否自承無最高證據等級之要件'
        for (const ctx of [{ notesById: notes }, { notesById: notes, noTopOf: 'x' }, undefined]) assert.throws(() => d.renderState(presumeState(['n1']), ctx), { message: want }, JSON.stringify(ctx))
        assert.match(d.renderState(presumeState(['n1']), { notesById: notes, noTopOf: () => 1 }).body, /- 〔C1〕甲主張（證據中｜有爭議）/, '判定須為 true(非布林之真值不推定)')
        // 推定詞為其他證據性質:標記取該詞(與證據封頂、規則表「擇自」同一組鍵)
        const other = createExtractDomain({ vocab: { basisCaps: { 已驗證: 0, 未驗證: 1, '*': 1 }, presumedBasis: '未驗證', evidenceRule: QUANT_RULE } })
        assert.match(other.renderState(presumeState(['n1']), { notesById: notes, noTopOf: yes }).body, /- 〔C1〕甲主張〔未驗證〕（/)
    })

})
