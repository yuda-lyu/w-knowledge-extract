// unit-extract-render.test.mjs — 核心狀態之 md 投影(domain.renderState):語氣標記由程式決定(證據性質〔〕、最低等級「有一說：」)
// 【為何要有】語氣標記(證據性質〔〕、最低等級「有一說」)由程式依 basis／出處內容類型決定(模型自寫之語氣不可靠);
//   本檔鎖住各種標記來源(basis 關鍵詞、出處內容類型、推定詞)、爭議各方之標記、以及不加標記之情形。
//   推定之案以量化詞彙之覆寫(test/tools/quantVocab:推定詞與其證據性質封頂)＋證據規則(摘要套件之 test/tools/quantRule,經 summarizeForTest)給,出處之判定以提煉段同一判準
//   (stores/contentCache 之 noteNoTopOf)經 ctx.noTopOf 交 renderState。
// 執行:npx mocha test/unit-extract-render.test.mjs(cwd＝套件根)

import assert from 'node:assert/strict'
import { QUANT_RULE } from './tools/summarizeForTest.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { noteNoTopOf } from '../src/stores/contentCache.mjs'
import { applyDelta } from '../src/stores/coreDelta.mjs'
import { seedCore } from './tools/extractKit.mjs'

const AT = '2026-10-02T21:00:00+08:00'
const domain = createExtractDomain({})
const NOTES = new Map([
    ['n1', { id: 'n1', title: '動量崩潰研究', claimType: '實證研究', evidenceLevel: '中' }],
    ['n2', { id: 'n2', title: '交易員手記', claimType: '實務經驗', evidenceLevel: '低' }],
])

/**
 * 以 emptyState＋applyDelta 造核心:C1(principle,basis 理論,出處 n1)、C2(pitfall,未寫 basis,出處 n2)、
 * D1(一方引 C1、一方只有立場＋出處 n2)、P1、本質。證據等級為衍生欄位(正式流程由 domain.evidence.apply 寫入),
 * 此處逐項指定,使標記與等級之對應固定
 */
function sample() {
    const s = seedCore({ coreId: 'm', concept: '動量', ops: [
        { op: 'add', ref: 'th', kind: 'principle', text: '反應不足之理論解釋', conditions: ['市場資訊流通慢'], basis: '理論', sources: ['N1'] },
        { op: 'add', ref: 'cr', kind: 'pitfall', text: '空頭反轉期動量崩潰', sources: ['N2'] },
        { op: 'dispute_add', question: '波動率縮放是否有效', sides: [{ position: '可降低崩潰', claims: ['@th'] }, { position: '效果不穩', conditions: ['高頻再平衡'], sources: ['N2'] }] },
        { op: 'param_add', name: '縮放目標波動', value: '12%', conditions: '年化', period: '2000–2020', sources: ['N1'] },
        { op: 'essence', text: '動量是贏家續贏之傾向。', claims: ['@th'], reason: '首版' },
    ], batch: [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }], at: AT, commit: false, msg: '造狀態之差量須全數套用' })
    const th = s.claims.find((c) => c.text === '反應不足之理論解釋')
    const cr = s.claims.find((c) => c.text === '空頭反轉期動量崩潰')
    assert.deepEqual([th.id, cr.id, s.disputes[0].id], ['C1', 'C2', 'D1'])
    th.evidence = { level: '低' }
    cr.evidence = { level: '中' }
    s.disputes[0].sides[0].evidence = { level: '低' }
    s.disputes[0].sides[1].evidence = { level: '中' }
    return { s, th, cr }
}

describe('unit-extract-render', function() {

    it('語氣標記:basis 之關鍵詞冠〔〕於文字尾、最低等級冠「有一說：」;未寫 basis 取出處之內容類型;爭議各方取所引主張與自身出處', () => {
        const { s } = sample()
        const { body } = domain.renderState(s, { notesById: NOTES })
        assert.match(body, /- 〔C1〕有一說：反應不足之理論解釋〔理論〕（證據低｜有爭議）\n {2}- 條件：市場資訊流通慢\n/, 'basis「理論」→〔理論〕;最低等級 → 有一說;被未解決之爭議引用 → 有爭議')
        assert.match(body, /- 〔C2〕空頭反轉期動量崩潰〔實務〕（證據中）\n/, '未寫 basis → 出處筆記內容類型「實務經驗」含關鍵詞「實務」')
        assert.ok(body.includes([
            '- 〔D1〕波動率縮放是否有效（未解決）',
            '  - 第1方：有一說：可降低崩潰〔理論〕｜證據低｜依〔C1〕｜出處：[[n1]]',
            '  - 第2方：效果不穩〔實務〕（條件：高頻再平衡）｜證據中｜出處：[[n2]]',
        ].join('\n')), `一方取所引主張之標記(〔理論〕)與出處、一方取自身出處之內容類型(〔實務〕):\n${body}`)
    })

    it('語氣標記補位:basis 不含任何關鍵詞者取出處之內容類型', () => {
        const { s, cr } = sample()
        cr.basis = '經驗分享'
        const { body } = domain.renderState(s, { notesById: NOTES })
        assert.match(body, /- 〔C2〕空頭反轉期動量崩潰〔實務〕（證據中）\n/, 'basis 無關鍵詞 → 取出處「實務經驗」')
    })

    // 推定之判準為詞彙表之證據規則(摘要套件之 noTopEvidenceOf——與摘要之最高級要件同一判準):本案給量化之證據規則與推定詞;
    //   未給規則者恆不推定(推定詞已設亦然)
    it('推定〔樣本內〕:basis 空白且出處類型無關鍵詞,而出處筆記皆自承無樣本外驗證(詞彙之證據規則;含簡體 caveats)→ 標〔樣本內〕;任一出處未自承 → 不推;不推〔樣本外〕;詞彙未給證據規則 → 不推', () => {
        const { s, cr } = sample()
        cr.basis = ''
        const notes = new Map([
            ['n1', { id: 'n1', title: '甲', claimType: '實證研究', evidenceLevel: '中', caveats: ['外汇异常结论未提供样本外验证'] }],
            ['n2', { id: 'n2', title: '乙', claimType: '實證研究', evidenceLevel: '中', caveats: ['無樣本外驗證，依賴單一窗口'] }],
            ['n3', { id: 'n3', title: '丙', claimType: '實證研究', evidenceLevel: '中', caveats: ['樣本 2000-2015'] }],
        ])
        // 出處之判定(提煉段同一判準;此處筆記無 md,只以記錄之 caveats 判)
        const render = (d) => d.renderState(s, { notesById: notes, noTopOf: (nid) => noteNoTopOf(notes.get(nid), null, d.evidenceRule) }).body
        const ruled = createExtractDomain({ vocab: { ...QUANT_VOCAB, evidenceRule: QUANT_RULE } })
        cr.sources = ['n1', 'n2']
        assert.match(render(ruled), /- 〔C2〕空頭反轉期動量崩潰〔樣本內〕（證據中）\n/)
        assert.match(render(createExtractDomain({ vocab: QUANT_VOCAB })), /- 〔C2〕空頭反轉期動量崩潰（證據中）\n/, '未給證據規則 → 不推')
        cr.sources = ['n1', 'n3']
        assert.match(render(ruled), /- 〔C2〕空頭反轉期動量崩潰（證據中）\n/, '任一出處未自承 → 不推')
    })

    it('無 basis、無內容類型時不加任何標記(文字後直接接證據等級)', () => {
        const { s, cr } = sample()
        cr.sources = []
        assert.match(domain.renderState(s, { notesById: new Map() }).body, /- 〔C2〕空頭反轉期動量崩潰（證據中）\n {2}- 出處：（無）/)
    })

    it('終態項不刪、入沿革(被取代者附取代者／理由／舊觀點成立期間;撤回者附理由與併入對象;先前之本質留版次),不列於有效章節', () => {
        const { s } = sample()
        const r = applyDelta(s, { ops: [
            { op: 'add', ref: 'nw', kind: 'pitfall', text: '空頭反轉後之反彈期動量虧損最深', sources: ['N3'] },
            { op: 'supersede', id: 'C2', by: '@nw', reason: '新樣本顯示虧損集中於反彈期', validPeriod: '較早之研究', sources: ['N3'] },
            { op: 'add', kind: 'rule', text: '反應不足之理論解釋（重述）', sources: ['N3'] },
            { op: 'essence', text: '動量是贏家續贏之傾向，反彈期易崩潰。', claims: ['C1', '@nw'], reason: '納入崩潰之時點' },
        ] }, { batch: [{ code: 'N3', id: 'n3' }], mode: 'delta', at: AT })
        assert.deepEqual(r.rejected, [])
        const r2 = applyDelta(r.state, { ops: [{ op: 'retract', id: 'C4', reason: '重複', into: 'C1' }] }, { batch: [], mode: 'delta', at: AT })
        assert.deepEqual(r2.rejected, [])
        const { body } = domain.renderState(r2.state, { notesById: NOTES })
        const [live, history] = body.split('\n## 沿革\n')
        assert.ok(history, body)
        assert.match(history, /^\n- 〔C2〕已取代（由〔C3〕）：空頭反轉期動量崩潰｜理由：新樣本顯示虧損集中於反彈期｜舊觀點成立期間：較早之研究\n/)
        assert.match(history, /\n- 〔C4〕已撤回（重複，併入〔C1〕）：反應不足之理論解釋（重述）\n/)
        assert.match(history, /\n- 先前之本質（v1）：動量是贏家續贏之傾向。(\n|$)/)
        assert.doesNotMatch(live, /〔C2〕|〔C4〕/, '終態項不列於有效章節')
        assert.match(live, /^> v3｜有效主張 2 條（有爭議 1）｜/m)
        assert.match(live, /## 本質\n\n動量是贏家續贏之傾向，反彈期易崩潰。（依〔C1〕〔C3〕）/)
    })
})
