// unit-core-state.test.mjs — 主張庫之差量套用(applyDelta)、審查裁決、涵蓋落帳、不變式、證據等級(純函數)
//
// 規格來源:tmp/wke-distill-b-全盤.md §3.2(操作 × 合規條件)與 §11.1 A4～A9、A25(2026-09-29 雙審定案);
//   安裝方〈建議w-knowledge-extract優化〉§2.1、§2.4、§3 驗收 1～6。每條斷言對應之規格句見其訊息字串。
// 執行:npx mocha test/unit-core-state.test.mjs(純函數,不落檔、不開埠)

import assert from 'node:assert/strict'
import {
    emptyState, upgradeState, findItem, applyDelta, applyVerdicts, coverageOf, commitBatch, checkInvariants, stateDigest,
    queuePendingReview, pendingReviewOps, STATE_VERSION, RETRACT_REASONS, DISPUTE_DROP_REASONS
} from '../src/stores/coreState.mjs'
import { makeEvidence, UNASSESSED } from '../src/stores/evidence.mjs'

const B = (...ids) => ids.map((id, k) => ({ code: `N${k + 1}`, id }))
const BATCH = B('n1', 'n2', 'n3', 'n4')
const run = (state, ops, extra = {}) => applyDelta(state, { ops }, { batch: BATCH, at: 'T', ...extra })
const reasons = (r) => r.rejected.map((x) => x.reason)
const claim = (s, id) => findItem(s, id)?.item

/** 以一組操作建立起點狀態(並落帳,使 consumed 涵蓋出處) */
function seed() {
    const s0 = emptyState({ concept: '均值回歸' })
    const r = run(s0, [
        { op: 'add', ref: 'a', kind: 'principle', text: '價格偏離均值後傾向回歸', sources: ['N1'] },
        { op: 'add', ref: 'b', kind: 'pitfall', text: '強趨勢下回歸失效', conditions: ['強趨勢'], sources: ['N2'] },
        { op: 'add', ref: 'c', kind: 'rule', text: '偏離兩個標準差以上才進場', sources: ['N3'] },
        { op: 'param_add', ref: 'p', name: '半衰期', value: '5–20 日', claim: '@a', sources: ['N1'] },
        { op: 'question_add', ref: 'q', text: '回歸速度是否隨市況而變', sources: [] },
    ])
    return commitBatch(r.state, coverageOf({ batch: BATCH, applied: r.applied }))
}

describe('unit-core-state', function() {

    describe('applyDelta:新增與出處', function() {

        it('add:種類在許可清單、text 非空、出處以本批代號或 id 皆可;非本批出處被剝除;新項 id 由程式配發', () => {
            const r = run(emptyState(), [
                { op: 'add', kind: 'principle', text: '甲', sources: ['N1', 'n2', 'n9'] },
                { op: 'add', kind: 'nonsense', text: '乙', sources: ['N1'] },
                { op: 'add', kind: 'rule', text: '', sources: ['N1'] },
                { op: 'add', kind: 'rule', text: '丙', sources: ['n9'] },
            ])
            assert.deepEqual(r.applied.map((a) => a.id), ['C1'])
            assert.deepEqual(claim(r.state, 'C1').sources, ['n1', 'n2'], '出處只收本批(n9 被剝除)')
            assert.deepEqual(reasons(r), ['種類「nonsense」不在許可清單（principle、rule、pitfall、temporal）', '缺 text', '無本批出處'])
            assert.equal(r.state.version, 1)
            assert.equal(r.state.changelog.length, 1)
        })

        it('文字中殘留之本批代號換成筆記連結(代號只在本批有效;真實模型驗收實測「N4 指出」);非本批代號與夾在英數中者不動;待審操作亦同', () => {
            const s = seed()
            const r = run(s, [
                { op: 'add', ref: 'x', kind: 'rule', text: '依 N4 之實驗，偏離大時先減碼', conditions: ['N4、N2 皆見'], sources: ['N4'] },
                { op: 'dispute_add', question: '回歸是否在強趨勢下成立', note: 'N2 與 N4 結論相反；N9 非本批；RN4 不動', sides: [{ position: '成立（N4）', claims: ['@x'], sources: ['N4'] }, { position: '不成立', claims: ['C2'] }] },
                { op: 'essence', text: '回歸多數時成立（N4），強趨勢下失效', claims: ['C1', '@x'], reason: '依 N4 補充' },
                { op: 'supersede', id: 'C3', by: '@x', reason: 'N4 之新證據', validPeriod: 'N4 以前之研究', sources: ['N4'] },
            ], { withhold: ['supersede'] })
            assert.equal(reasons(r).length, 0, reasons(r).join('；'))
            const c = r.state.claims.find((x) => x.text.startsWith('依'))
            assert.equal(c.text, '依 [[n4]] 之實驗，偏離大時先減碼')
            assert.deepEqual(c.conditions, ['[[n4]]、[[n2]] 皆見'])
            const d = r.state.disputes[0]
            assert.equal(d.note, '[[n2]] 與 [[n4]] 結論相反；N9 非本批；RN4 不動')
            assert.equal(d.sides[0].position, '成立（[[n4]]）')
            assert.equal(r.state.essence.text, '回歸多數時成立（[[n4]]），強趨勢下失效')
            assert.deepEqual([r.withheld[0].resolved.reason, r.withheld[0].resolved.validPeriod], ['[[n4]] 之新證據', '[[n4]] 以前之研究'])
            const after = commitBatch(r.state, coverageOf({ batch: BATCH, applied: r.applied, queued: r.withheld.filter((w) => w.resolved) }))
            assert.deepEqual(checkInvariants(s, after, { touched: r.touched }), [])
        })

        it('文字中之〔@ref〕(1.0.5 真實模型驗收實測本質文字寫「〔@a〕」):落盤前換成實際 id;ref 未定義或已被剔除 → 拒收(文字引用懸空);所指新項於同差量稍後才失敗 → 去掉標記,不留短命識別碼', () => {
            const s = seed()
            const r = run(s, [
                { op: 'add', ref: 'x', kind: 'rule', text: '偏離大時先減碼（承〔@y〕）', sources: ['N4'] },
                { op: 'add', ref: 'y', kind: 'principle', text: '回歸在低波動期較明顯', sources: ['N3'] },
                { op: 'dispute_add', ref: 'd', question: '回歸何時成立', note: '〔@x〕與〔C2〕結論相反', sides: [{ position: '成立', claims: ['@x'] }, { position: '不成立', claims: ['C2'], sources: ['N2'] }] },
                { op: 'essence', text: '回歸多數時成立〔@y〕，強趨勢下失效〔C2〕', claims: ['@y', 'C2'], reason: 'r' },
                { op: 'add', kind: 'rule', text: '未定義之引用〔@nope〕', sources: ['N1'] },
                { op: 'add', ref: 'z', kind: 'rule', text: '承〔@w〕之說', sources: ['N1'] },
                { op: 'add', ref: 'w', kind: 'bogus', text: 'w', sources: ['N1'] },
            ])
            assert.deepEqual(r.rejected.map((x) => [x.index, x.reason]).sort((a, b) => a[0] - b[0]), [[4, '文字引用懸空：〔@nope〕（ref 未定義）'], [6, '種類「bogus」不在許可清單（principle、rule、pitfall、temporal）']])
            const x = r.state.claims.find((c) => c.text.startsWith('偏離大時'))
            const y = r.state.claims.find((c) => c.text.startsWith('回歸在'))
            assert.equal(x.text, `偏離大時先減碼（承〔${y.id}〕）`, '先引用、後定義(同相)亦換成實際 id')
            assert.equal(r.state.disputes[0].note, `〔${x.id}〕與〔C2〕結論相反`)
            assert.equal(r.state.essence.text, `回歸多數時成立〔${y.id}〕，強趨勢下失效〔C2〕`)
            assert.equal(r.state.claims.find((c) => c.text.startsWith('承')).text, '承之說', '所指新項稍後失敗 → 去掉標記')
            assert.ok(!JSON.stringify(r.state).includes('〔@'), '狀態內不留〔@ref〕')
            // 被審查剔除之新項:引用它之文字 → 拒收並寫明根因
            const v = applyVerdicts({ ops: [{ op: 'add', ref: 'a', kind: 'rule', text: '甲', sources: ['N1'] }, { op: 'add', kind: 'rule', text: '承〔@a〕', sources: ['N2'] }] }, [{ i: 0, action: 'drop', reason: '離題' }, { i: 1, action: 'keep' }])
            const r2 = applyDelta(s, v.delta, { batch: BATCH, at: 'T', droppedRefs: v.droppedRefs })
            assert.deepEqual(reasons(r2), ['文字引用懸空：〔@a〕（已被審查剔除（離題））'])
            assert.deepEqual(checkInvariants(s, commitBatch(r.state, coverageOf({ batch: BATCH, applied: r.applied })), { touched: r.touched }), [])
        })

        it('操作之目標 id 可為同一差量新項之 @ref(把本批新主張 contest 進既有爭議;真實模型驗收實測被誤拒);所依新項被拒 → 拒收理由寫明根因(1.0.5)', () => {
            let s = seed()
            s = run(s, [{ op: 'dispute_add', question: '回歸是否普遍成立', sides: [{ position: '是', claims: ['C1'] }, { position: '否', claims: ['C2'] }], sources: ['N1'] }]).state
            const r = run(s, [
                { op: 'add', ref: 'n', kind: 'principle', text: '回歸在低波動期較明顯', sources: ['N3'] },
                { op: 'contest', id: '@n', dispute: 'D1', side: 0, reason: '新證據支持成立方', sources: ['N3'] },
                { op: 'add', ref: 'bad', kind: 'nonsense', text: 'x', sources: ['N4'] },
                { op: 'contest', id: '@bad', dispute: 'D1', side: 1, reason: 'y', sources: ['N4'] },
                { op: 'confirm', id: '@nope', sources: ['N4'] },
            ])
            assert.deepEqual(reasons(r), ['種類「nonsense」不在許可清單（principle、rule、pitfall、temporal）', '所引 @bad 已被拒收（種類「nonsense」不在許可清單（principle、rule、pitfall、temporal））', '目標 @nope 不存在'])
            assert.ok(findItem(r.state, 'D1').item.sides[0].claims.includes('C4'))
            assert.equal(claim(r.state, 'C4').status, 'contested')
        })

        it('add 與既有非終態主張全文相同(忽略空白標點) → 改記為確認,不另立重複項', () => {
            const s = seed()
            const r = run(s, [{ op: 'add', kind: 'principle', text: '價格偏離均值後，傾向回歸。', sources: ['N4'] }])
            assert.equal(r.state.claims.length, 3)
            assert.equal(r.applied[0].asConfirm, true)
            assert.deepEqual(claim(r.state, 'C1').sources, ['n1', 'n4'])
        })

        it('長度:逾上限 2 倍拒收(不截斷改寫)、逾上限計入 overLimit;文字欄之〔id〕須可解析', () => {
            const r = run(emptyState(), [
                { op: 'add', kind: 'rule', text: 'x'.repeat(181), sources: ['N1'] },
                { op: 'add', kind: 'rule', text: 'y'.repeat(120), sources: ['N1'] },
                { op: 'add', kind: 'rule', text: '見〔C41〕', sources: ['N1'] },
                { op: 'add', kind: 'rule', text: '2024 年 Q1 營收下滑(自由文字之 Q1 不檢查)', sources: ['N2'] },
            ], { limits: { text: 90 } })
            assert.deepEqual(reasons(r), ['text 過長（181 字，上限 90）', '文字引用懸空：〔C41〕'])
            assert.equal(r.overLimit, 1)
            assert.equal(r.lengthChecked, 2, '受檢欄數＝放行者之非空受限欄(超長率之分母;安裝方 §3 #5 ≤10%)')
            assert.equal(r.state.claims.length, 2)
        })

        it('本質為硬上限(逾即拒,不計入 overLimit;安裝方 §3 #5「本質 ≤220 字」屬程式判定);整併改寫主張文字亦計入超長與受檢', () => {
            const s = seed()
            const ok = run(s, [{ op: 'essence', text: '本'.repeat(220), claims: ['C1'], reason: 'r' }])
            assert.deepEqual([reasons(ok), ok.state.essence.text.length, ok.overLimit], [[], 220, 0])
            const bad = run(s, [{ op: 'essence', text: '本'.repeat(221), claims: ['C1'], reason: 'r' }])
            assert.deepEqual(reasons(bad), ['essence 過長（221 字，上限 220）'])
            assert.equal(bad.state.essence.text, '', '本質未被改寫')
            const m = applyDelta(s, { ops: [{ op: 'merge', into: 'C1', from: ['C3'], reason: '同一主張', text: '併'.repeat(100) }] }, { mode: 'consolidate', at: 'T' })
            assert.deepEqual([reasons(m), m.overLimit, m.lengthChecked], [[], 1, 1])
        })
    })

    describe('applyDelta:確認、修訂、取代、撤回', function() {

        it('confirm:主張／參數累積出處;爭議可指明一方;全部已存在者記 noop;終態目標拒收', () => {
            const s = seed()
            const r = run(s, [
                { op: 'confirm', id: 'C1', sources: ['N4', 'N1'] },
                { op: 'confirm', id: 'P1', sources: ['N2'] },
                { op: 'confirm', id: 'C2', sources: ['N2'] },
                { op: 'confirm', id: 'C9', sources: ['N1'] },
            ])
            assert.deepEqual(claim(r.state, 'C1').sources, ['n1', 'n4'])
            assert.deepEqual(findItem(r.state, 'P1').item.sources, ['n1', 'n2'])
            assert.equal(r.applied.find((a) => a.id === 'C2').noop, true)
            assert.deepEqual(reasons(r), ['目標 C9 不存在'])
        })

        it('revise:只改許可欄位、前像入 history、id／sources／status 不可改;增量須本批出處,整併不需', () => {
            const s = seed()
            const r = run(s, [{ op: 'revise', id: 'C1', fields: { text: '價格偏離長期均值後傾向回歸', id: 'HACK', status: 'retracted', sources: [] }, reason: '精確化', sources: ['N4'] }])
            const c = claim(r.state, 'C1')
            assert.equal(c.text, '價格偏離長期均值後傾向回歸')
            assert.equal(c.id, 'C1')
            assert.equal(c.status, 'active')
            assert.deepEqual(c.sources, ['n1', 'n4'])
            assert.deepEqual(c.history.at(-1).before, { text: '價格偏離均值後傾向回歸' })
            const r2 = run(s, [{ op: 'revise', id: 'C1', fields: { text: 'x' }, reason: 'r', sources: [] }])
            assert.deepEqual(reasons(r2), ['無本批出處'])
            const r3 = applyDelta(s, { ops: [{ op: 'revise', id: 'C1', fields: { text: '合併後文字' }, reason: '整併' }] }, { mode: 'consolidate', at: 'T' })
            assert.equal(claim(r3.state, 'C1').text, '合併後文字')
            const r4 = run(s, [{ op: 'revise', id: 'C1', fields: { text: '' }, reason: 'r', sources: ['N1'] }, { op: 'revise', id: 'C2', fields: { kind: 'bogus' }, reason: 'r', sources: ['N1'] }])
            assert.deepEqual(reasons(r4), ['必要欄位不可改為空', '種類「bogus」不在許可清單'])
        })

        it('supersede:須理由與成立期間(可為「不詳」或相對期間);by 須存在且非自身;主張與參數皆可;終態不可再操作', () => {
            const s = seed()
            const r = run(s, [
                { op: 'supersede', id: 'C2', reason: '新研究顯示弱回歸', validPeriod: '較早之研究', by: 'C1', sources: ['N4'] },
                { op: 'supersede', id: 'C3', reason: 'r', sources: ['N4'] },
                { op: 'supersede', id: 'P1', reason: '新樣本', validPeriod: '不詳', sources: ['N4'] },
            ])
            assert.equal(claim(r.state, 'C2').status, 'superseded')
            assert.equal(claim(r.state, 'C2').supersededBy, 'C1')
            assert.equal(findItem(r.state, 'P1').item.status, 'superseded')
            assert.match(reasons(r)[0], /缺 validPeriod/)
            const r2 = run(r.state, [{ op: 'confirm', id: 'C2', sources: ['N1'] }, { op: 'supersede', id: 'C3', reason: 'r', validPeriod: 'x', by: 'C3', sources: ['N1'] }])
            assert.deepEqual(reasons(r2), ['目標 C2 已取代', '取代者不可為自身'])
        })

        it('引用不成立之拒收理由寫根因(1.0.5;真實模型驗收實測本質引爭議之 @ref 被報「不存在或為終態」):ref 未定義、不存在、種類不符、終態各自寫明', () => {
            const s = run(seed(), [{ op: 'retract', id: 'C3', reason: '離題' }]).state
            const r = run(s, [
                { op: 'dispute_add', ref: 'd', question: 'q', sides: [{ position: '甲', claims: ['C1'], sources: ['N4'] }, { position: '乙', claims: ['C2'] }] },
                { op: 'essence', text: '本質', claims: ['C1', '@d'], reason: 'r' },
                { op: 'dispute_add', question: 'q2', sides: [{ position: '甲', claims: ['@nope'], sources: ['N4'] }, { position: '乙', claims: ['C2'] }] },
                { op: 'dispute_add', question: 'q3', sides: [{ position: '甲', claims: ['C3'], sources: ['N4'] }, { position: '乙', claims: ['C2'] }] },
                { op: 'dispute_add', question: 'q4', sides: [{ position: '甲', claims: ['C9'], sources: ['N4'] }, { position: '乙', claims: ['C2'] }] },
                { op: 'supersede', id: 'C2', by: 'P1', reason: 'r', validPeriod: '不詳', sources: ['N4'] },
                { op: 'revise', id: 'Q1', reason: 'r', fields: { text: 'x' }, sources: ['N4'] },
            ])
            assert.deepEqual(r.rejected.map((x) => [x.index, x.reason]).sort((a, b) => a[0] - b[0]), [
                [1, '@d＝D1 為爭議，須為主張'],
                [2, 'ref「@nope」未定義'],
                [3, 'C3 已撤回'],
                [4, '引用之項目 C9 不存在'],
                [5, '取代者 P1 為參數，須為主張'],
                [6, '目標 Q1 為問題，不可修訂（revise 限主張、參數）'],
            ])
            const merge = (into, from) => reasons(applyDelta(s, { ops: [{ op: 'merge', into, from, reason: 'r' }] }, { mode: 'consolidate', at: 'T' }))
            assert.deepEqual([merge('C3', ['C1']), merge('C1', ['P1']), merge('D1x', ['C1'])], [['into C3 已撤回'], ['from P1 為參數，須為主張'], ['into 引用之項目 D1x 不存在']])
        })

        it('retract:理由須為列舉值、為終態(保留於狀態)、不需出處;撤回爭議後其所引主張回到 active', () => {
            const s = seed()
            const r = run(s, [
                { op: 'dispute_add', ref: 'd', question: '回歸是否穩定', sides: [{ position: '甲', claims: ['C1'] }, { position: '乙', claims: ['C2'] }], sources: ['N4'] },
            ])
            assert.equal(claim(r.state, 'C1').status, 'contested', 'contested 為衍生狀態:被未解決之爭議某方引用')
            const r2 = run(r.state, [{ op: 'retract', id: 'D1', reason: '離題' }, { op: 'retract', id: 'C3', reason: '看不順眼' }])
            assert.equal(findItem(r2.state, 'D1').item.status, 'retracted')
            assert.equal(claim(r2.state, 'C1').status, 'active')
            assert.deepEqual(reasons(r2), [`撤回理由須為：${RETRACT_REASONS.join('、')}`])
            assert.equal(r2.state.disputes.length, 1, '撤回不刪除')
        })
    })

    describe('applyDelta:爭議、參數、問題、本質、相關概念', function() {

        it('dispute_add:至少兩方、每方有立場且有本批出處或所引主張;各方出處只有同一篇 → 拒收(同篇正反不成爭議)', () => {
            const s = seed()
            const r = run(s, [
                { op: 'dispute_add', question: 'q1', sides: [{ position: '甲', sources: ['N4'] }] },
                { op: 'dispute_add', question: 'q2', sides: [{ position: '甲', sources: ['N4'] }, { position: '乙', sources: ['N4'] }] },
                { op: 'dispute_add', question: 'q3', sides: [{ position: '甲', sources: ['N4'] }, { position: '', sources: ['N3'] }] },
                { op: 'dispute_add', question: 'q4', sides: [{ position: '甲', sources: ['N4'] }, { position: '乙', claims: ['C3'] }] },
            ])
            assert.deepEqual(reasons(r), ['少於兩方', '各方出處只有同一篇（同篇正反不成爭議）', '有一方缺立場'])
            const d = r.state.disputes[0]
            assert.deepEqual(d.sides[1].claims, ['C3'])
            assert.equal(claim(r.state, 'C3').status, 'contested')
        })

        it('contest 須連爭議並指明一方;dispute_update 可解決爭議(所引主張回 active)、可加一方', () => {
            const s = seed()
            const r = run(s, [
                { op: 'dispute_add', ref: 'd', question: '回歸速度', sides: [{ position: '快', sources: ['N1'] }, { position: '慢', sources: ['N2'] }] },
                { op: 'contest', id: 'C1', dispute: '@d', side: 0, reason: '速度依市況', sources: ['N1'] },
                { op: 'contest', id: 'C2', reason: '沒連爭議', sources: ['N2'] },
                { op: 'contest', id: 'C3', dispute: '@d', side: 5, reason: 'x', sources: ['N2'] },
            ])
            assert.deepEqual(reasons(r), ['contest 須連既有或同一差量新建之爭議', '爭議 D1 無 side 5（contest 須指明 side；現有 side 0～1）'])
            assert.equal(claim(r.state, 'C1').status, 'contested')
            const r2 = run(r.state, [{ op: 'dispute_update', id: 'D1', note: '新證據支持依市況而定', status: 'resolved', sides_add: [{ position: '依市況', sources: ['N3'] }], sources: ['N3'] }])
            const d = findItem(r2.state, 'D1').item
            assert.equal(d.status, 'resolved')
            assert.equal(d.sides.length, 3)
            assert.equal(claim(r2.state, 'C1').status, 'active', '爭議解決後不再 contested')
        })

        it('ref:先引用後定義可解析;被拒之新項其依賴操作連鎖拒收(理由寫明所依之 @ref 與其拒收理由);ref 重複皆拒', () => {
            const r = run(emptyState(), [
                { op: 'dispute_add', question: 'q', sides: [{ position: '甲', claims: ['@a'] }, { position: '乙', claims: ['@x'] }] },
                { op: 'add', ref: 'a', kind: 'rule', text: '甲', sources: ['N1'] },
                { op: 'add', ref: 'x', kind: 'rule', text: '', sources: ['N2'] },
                { op: 'param_add', name: 'k', value: '1', claim: '@x', sources: ['N2'] },
                { op: 'add', ref: 'y', kind: 'rule', text: '丙', sources: ['N3'] },
                { op: 'add', ref: 'y', kind: 'rule', text: '丁', sources: ['N3'] },
            ])
            assert.deepEqual(r.rejected.map((x) => [x.index, x.reason]).sort((a, b) => a[0] - b[0]), [
                [0, '所引 @x 已被拒收（缺 text）'], [2, '缺 text'], [3, '所引 @x 已被拒收（缺 text）'], [4, 'ref「y」重複'], [5, 'ref「y」重複'],
            ])
            assert.deepEqual(r.applied.map((a) => a.id), ['C1'])
        })

        it('param_add／question_add／question_resolve;essence 須引主張、同一差量只一個、改寫入沿革、出處＝所引主張之聯集', () => {
            const s = seed()
            const r = run(s, [
                { op: 'essence', text: '偏離均值之價格傾向回歸，但速度依市況', claims: ['C1', 'C2'], reason: '首版' },
                { op: 'essence', text: '第二個', claims: ['C1'], reason: 'x' },
                { op: 'question_resolve', id: 'Q1', resolution: '依市況而變', sources: ['N4'] },
                { op: 'param_add', name: '', value: '1', sources: ['N1'] },
            ])
            assert.deepEqual(reasons(r), ['同一差量只能有一個 essence', '缺 name 或 value'])
            assert.deepEqual(r.state.essence.sources, ['n1', 'n2'])
            assert.equal(findItem(r.state, 'Q1').item.status, 'resolved')
            const r2 = run(r.state, [{ op: 'essence', text: '新本質', claims: ['C1'], reason: '新證據' }, { op: 'confirm', id: 'C1', sources: ['N4'] }])
            assert.equal(r2.state.essenceHistory.at(-1).text, '偏離均值之價格傾向回歸，但速度依市況')
            assert.deepEqual(r2.state.essence.sources, ['n1', 'n4'], '同一差量之確認亦反映於本質出處')
            const r3 = run(s, [{ op: 'essence', text: '無依據', claims: [], reason: 'x' }])
            assert.deepEqual(reasons(r3), ['essence 須引至少一條主張（claims）'])
        })

        it('related_add 正規化去重、去自身;related_prune 限整併', () => {
            const s = seed()
            const r = run(s, [{ op: 'related_add', concepts: ['動量', '動量 ', '均值回歸', '配對交易'] }], { self: '均值回歸' })
            assert.deepEqual(r.state.related, ['動量', '配對交易'])
            assert.match(reasons(run(r.state, [{ op: 'related_prune', concepts: ['動量'] }]))[0], /增量模式不可用「related_prune」/)
            const r2 = applyDelta(r.state, { ops: [{ op: 'related_prune', concepts: ['動量'] }] }, { mode: 'consolidate', at: 'T' })
            assert.deepEqual(r2.state.related, ['配對交易'])
        })
    })

    describe('拆解硬配之爭議(dispute_dissolve;有建立無解除之缺陷,2026-09-29)', function() {

        /** 起點:爭議 D1 一方引主張 C3、一方只有立場文字(出處 n4) */
        const withDispute = () => commitBatch(run(seed(), [{ op: 'dispute_add', question: '回歸何時成立', sides: [{ position: '偏離大時成立', claims: ['C3'] }, { position: '低流動性時才成立', conditions: ['小型股'], sources: ['N4'] }] }]).state, { used: ['n4'] })

        it('拆解:爭議轉終態(理由「非對立」)、只有立場之方轉為主張(出處與條件沿用、種類預設取許可清單第一項)、引主張之方回 active;不變式成立', () => {
            const s = withDispute()
            assert.equal(claim(s, 'C3').status, 'contested')
            const r = run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: '兩方回答的是不同條件下之成立與否' }])
            assert.deepEqual(reasons(r), [])
            const d = findItem(r.state, 'D1').item
            assert.deepEqual([d.status, d.retractReason, d.statusNote], ['retracted', '非對立', '兩方回答的是不同條件下之成立與否'])
            const c = claim(r.state, 'C4')
            assert.deepEqual([c.kind, c.text, c.conditions, c.sources, c.origin], ['principle', '低流動性時才成立', ['小型股'], ['n4'], 'dispute'], '內容與出處全留')
            assert.deepEqual(d.sides.map((sd) => sd.claims), [['C3'], ['C4']], '各方可追溯至主張')
            assert.equal(claim(r.state, 'C3').status, 'active', '對立標籤拿掉')
            assert.deepEqual(checkInvariants(s, r.state, { touched: r.touched }), [])
            // kinds 依方序;不在許可清單者取第一項
            assert.equal(claim(run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r', kinds: ['rule', 'pitfall'] }]).state, 'C4').kind, 'pitfall')
            assert.equal(claim(run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r', kinds: ['x', 'nope'] }]).state, 'C4').kind, 'principle')
            assert.equal(claim(run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r' }], { claimKinds: ['觀察', '規則'] }).state, 'C4').kind, '觀察', '自訂種類取其第一項')
            assert.equal(findItem(run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r' }]).state, 'C4').item.history[0].note, '拆自 D1 side 1', '沿革以 side k 標示')
        })

        it('拆解不遺失「方層出處」(confirm side 所加、不在所引主張出處內者):只引一條有效主張 → 併入該主張;引多條 → 以該方立場另立一條主張', () => {
            const s0 = withDispute()
            // side 0(引 C3)另有方層出處 n1
            const s = commitBatch(run(s0, [{ op: 'confirm', id: 'D1', side: 0, sources: ['N1'] }]).state, { used: ['n1'] })
            assert.deepEqual(findItem(s, 'D1').item.sides[0].sources, ['n1'])
            const r = run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: '兩方回答不同問題' }])
            assert.deepEqual(reasons(r), [])
            assert.deepEqual(claim(r.state, 'C3').sources, ['n3', 'n1'], '併入唯一所引之主張')
            assert.match(claim(r.state, 'C3').history.at(-1).note, /併入 D1 side 0 之方層出處/)
            assert.deepEqual(checkInvariants(s, r.state, { touched: r.touched }), [])
            // 引兩條主張之方有方層出處 → 另立主張承接
            const t0 = commitBatch(run(seed(), [{ op: 'dispute_add', question: 'q', sides: [{ position: '甲方立場', claims: ['C1', 'C3'], sources: ['N4'] }, { position: '乙方', claims: ['C2'] }] }]).state, { used: ['n4'] })
            const r2 = run(t0, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r', kinds: ['rule'] }])
            const extra = r2.state.claims.find((c) => c.origin === 'dispute')
            assert.deepEqual([extra.text, extra.kind, extra.sources], ['甲方立場', 'rule', ['n4']])
            assert.deepEqual(findItem(r2.state, 'D1').item.sides[0].claims, ['C1', 'C3', extra.id])
            assert.deepEqual(checkInvariants(t0, r2.state, { touched: r2.touched }), [])
        })

        it('拆解之拒收:缺理由、目標非爭議、已撤回;為不可逆操作(審查失敗時暫緩);與確認同一爭議並存皆拒;整併模式可用', () => {
            const s = withDispute()
            assert.deepEqual(reasons(run(s, [{ op: 'dispute_dissolve', id: 'D1' }])), ['缺 reason（兩方為何不是對立）'])
            assert.deepEqual(reasons(run(s, [{ op: 'dispute_dissolve', id: 'C3', reason: 'r' }])), ['目標爭議 C3 不存在'])
            const once = run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r' }]).state
            assert.deepEqual(reasons(run(once, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r' }])), ['爭議 D1 已撤回'])
            const w = run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r' }], { withhold: ['dispute_dissolve'] })
            assert.deepEqual([w.withheld.length, findItem(w.state, 'D1').item.status], [1, 'open'], '暫緩:爭議不動')
            const both = run(s, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r' }, { op: 'confirm', id: 'D1', sources: ['N1'] }])
            assert.equal(both.applied.length, 0, reasons(both).join('；'))
            const c = applyDelta(s, { ops: [{ op: 'dispute_dissolve', id: 'D1', reason: '整併時發現為硬配' }] }, { mode: 'consolidate', at: 'T' })
            assert.deepEqual([reasons(c), findItem(c.state, 'D1').item.status], [[], 'retracted'])
        })

        it('審查存疑(1.0.5,三獨立審定案 E′):爭議類操作之「非對立」不再剔除——doubt 照套並在爭議記存疑(不改狀態);舊寫法 drop＋非對立視同 doubt;doubt 不適用於非爭議類;拆解可以「對立成立」剔除', () => {
            assert.deepEqual(DISPUTE_DROP_REASONS, ['離題', '同篇'], '爭議類只收形式理由')
            const ops = [
                { op: 'add', ref: 'a', kind: 'rule', text: '新主張', sources: ['N1'] },
                { op: 'dispute_add', question: 'q', sides: [{ position: '甲方', claims: ['@a'] }, { position: '乙方之立場', conditions: ['c'], sources: ['N2'] }] },
                { op: 'contest', id: 'C1', dispute: 'D9', side: 0, reason: 'r', sources: ['N3'] },
                { op: 'dispute_dissolve', id: 'D9', reason: 'r' },
            ]
            const v = applyVerdicts({ ops }, [
                { i: 1, action: 'doubt', reason: '非對立', note: '兩方回答不同問題' },
                { i: 2, action: 'drop', reason: '非對立' },
                { i: 3, action: 'drop', reason: '對立成立', note: '對立成立' },
            ])
            assert.deepEqual(v.doubted.map((x) => [x.index, x.reason, x.note, x.legacy]), [[1, '非對立', '兩方回答不同問題', false], [2, '非對立', '', true]])
            assert.deepEqual(v.dropped.map((x) => [x.index, x.reason, x.note]), [[3, '對立成立', '對立成立']])
            assert.deepEqual(v.delta.ops.filter((o) => o._doubt).map((o) => o._i), [1, 2], '存疑者照保留')
            // 套用:爭議照立,存疑記在爭議上(沿革另記);所引主張 contested(存疑不改狀態)
            const r = run(emptyState(), v.delta.ops.filter((o) => o._i !== 2))
            const d = findItem(r.state, 'D1').item
            assert.deepEqual([reasons(r), d.status, d.doubt.reason, d.doubt.note, d.doubt.op, d.doubt.count, d.history.at(-1).op], [[], 'open', '非對立', '兩方回答不同問題', 'dispute_add', 1, 'doubt'])
            assert.equal(claim(r.state, 'C1').status, 'contested')
            // contest 之存疑記所列入之主張與 side;未附說明者標「（審查未附說明）」;累計次數
            const s = run(seed(), [{ op: 'dispute_add', question: 'q2', sides: [{ position: '甲', claims: ['C1'] }, { position: '乙', claims: ['C2'] }], sources: ['N1'] }]).state
            const r2 = run(s, [{ op: 'contest', id: 'C3', dispute: 'D1', side: '1', reason: 'r', sources: ['N4'], _doubt: { reason: '非對立', note: '' } }])
            assert.deepEqual([reasons(r2), findItem(r2.state, 'D1').item.doubt.claim, findItem(r2.state, 'D1').item.doubt.side, findItem(r2.state, 'D1').item.doubt.note], [[], 'C3', 1, '（審查未附說明）'], 'side 容許數字字串')
            const s2 = commitBatch(r2.state, { used: ['n1', 'n4'] })
            const r3 = run(s2, [{ op: 'dispute_update', id: 'D1', note: 'n', sources: ['N3'], _doubt: { reason: '非對立', note: '再疑' } }])
            assert.equal(findItem(r3.state, 'D1').item.doubt.count, 2)
            assert.deepEqual(checkInvariants(s2, commitBatch(r3.state, { used: ['n3'] }), { touched: r3.touched }), [])
            // doubt 用於非爭議類 → 裁決無效、按未裁決保留;拆解不可以「非對立」剔除(剔除拆解＝保留爭議,理由另列)
            const bad = applyVerdicts({ ops }, [{ i: 0, action: 'doubt', note: 'x' }, { i: 3, action: 'drop', reason: '非對立' }])
            assert.deepEqual([bad.verdictRejected.length, bad.unverdicted], [2, [0, 1, 2, 3]])
        })

        it('審查剔除之新項被保留之操作引用:回報依賴衝突,套用時拒收理由寫明「已被審查剔除(理由)」(12 種引用點同一機制);出處彙整含 sides_add', () => {
            const s = seed()
            const ops = [
                { op: 'add', ref: 'a', kind: 'rule', text: '新主張', sources: ['N1'] },
                { op: 'dispute_add', question: 'q', sides: [{ position: '甲', claims: ['@a'] }, { position: '乙', claims: ['C2'] }] },
                { op: 'param_add', name: 'k', value: '1', claim: '@a', sources: ['N1'] },
                { op: 'dispute_update', id: 'D9', note: 'n', sides_add: [{ position: '丙', sources: ['N4'] }] },
            ]
            const v = applyVerdicts({ ops }, [{ i: 0, action: 'drop', reason: '離題', note: '與本概念無關' }, { i: 3, action: 'drop', reason: '同篇' }])
            assert.deepEqual(v.droppedRefs, { a: '離題' })
            assert.deepEqual(v.conflicts.map((c) => [c.kept, c.keptOp, c.dropped, c.ref, c.reason]), [[1, 'dispute_add', 0, '@a', '離題'], [2, 'param_add', 0, '@a', '離題']])
            assert.deepEqual(v.dropped.find((x) => x.index === 3).sources, ['N4'], 'dispute_update 之 sides_add 出處計入(否則筆記判未涵蓋而重送)')
            const r = run(s, v.delta.ops, { droppedRefs: v.droppedRefs })
            assert.deepEqual(reasons(r), ['所引 @a 已被審查剔除（離題）', '所引 @a 已被審查剔除（離題）'])
        })
    })

    describe('applyDelta:整併(merge／refacet)', function() {

        it('merge 限整併:被併者為 superseded＋mergedInto、出處併入、爭議與本質與參數之引用改指 into', () => {
            let s = seed()
            s = commitBatch(run(s, [{ op: 'dispute_add', question: 'q', sides: [{ position: '甲', claims: ['C3'] }, { position: '乙', sources: ['N4'] }] }, { op: 'essence', text: 'e', claims: ['C3'], reason: 'r' }]).state, { used: ['n4'] })
            assert.match(reasons(run(s, [{ op: 'merge', into: 'C1', from: ['C3'], reason: 'x' }]))[0], /增量模式不可用「merge」/)
            const r = applyDelta(s, { ops: [{ op: 'merge', into: 'C1', from: ['C3'], reason: '同一主張', text: '合併後' }] }, { mode: 'consolidate', at: 'T' })
            assert.deepEqual(reasons(r), [])
            const c3 = claim(r.state, 'C3')
            assert.equal(c3.status, 'superseded')
            assert.equal(c3.mergedInto, 'C1')
            assert.deepEqual(claim(r.state, 'C1').sources, ['n1', 'n3'])
            assert.deepEqual(r.state.disputes[0].sides[0].claims, ['C1'])
            assert.deepEqual(r.state.essence.claims, ['C1'])
            assert.equal(claim(r.state, 'C1').text, '合併後')
            assert.equal(r.state.lastConsolidated, r.state.version)
            assert.deepEqual(checkInvariants(s, r.state, { touched: r.touched }), [])
        })

        it('refacet:面向改名作用於該面向之全部非終態主張', () => {
            let s = seed()
            s = run(s, [{ op: 'revise', id: 'C1', fields: { facet: '機制' }, reason: 'r', sources: ['N1'] }, { op: 'revise', id: 'C2', fields: { facet: '機制' }, reason: 'r', sources: ['N2'] }]).state
            const r = applyDelta(s, { ops: [{ op: 'refacet', from: '機制', to: '原理與機制' }] }, { mode: 'consolidate', at: 'T' })
            assert.deepEqual(r.state.claims.map((c) => c.facet), ['原理與機制', '原理與機制', ''])
        })
    })

    describe('applyDelta:跨操作規則、暫緩、版號', function() {

        it('同一既有項至多一個改狀態操作(皆拒);確認與取代／撤回同一項(皆拒);他項不受影響', () => {
            const s = seed()
            const r = run(s, [
                { op: 'revise', id: 'C1', fields: { text: 'a' }, reason: 'r', sources: ['N1'] },
                { op: 'supersede', id: 'C1', reason: 'r', validPeriod: 'x', sources: ['N1'] },
                { op: 'confirm', id: 'C2', sources: ['N4'] },
                { op: 'retract', id: 'C2', reason: '離題' },
                { op: 'confirm', id: 'C3', sources: ['N4'] },
            ])
            assert.deepEqual(r.rejected.map((x) => x.index), [0, 1, 2, 3])
            assert.match(r.rejected[0].reason, /C1 有多個改狀態操作/)
            assert.match(r.rejected[2].reason, /C2 同時被確認與取代／撤回/)
            assert.deepEqual(r.applied.map((a) => a.id), ['C3'])
        })

        it('withhold(審查失敗之降級):指定操作暫緩、記入 withheld(含其出處),其 ref 之依賴連鎖拒收', () => {
            const s = seed()
            const r = run(s, [{ op: 'supersede', id: 'C2', reason: 'r', validPeriod: 'x', sources: ['N4'] }, { op: 'confirm', id: 'C1', sources: ['N3'] }], { withhold: ['supersede', 'retract'] })
            assert.deepEqual(r.withheld.map((w) => [w.index, w.op, w.sources]), [[0, 'supersede', ['n4']]])
            assert.equal(r.withheld[0].resolved.id, 'C2')
            assert.equal(claim(r.state, 'C2').status, 'active')
            assert.deepEqual(r.applied.map((a) => a.id), ['C1'])
        })

        it('全數拒收:不升版、無 changelog;整併模式不可用增量操作', () => {
            const s = seed()
            const r = run(s, [{ op: 'confirm', id: 'C99', sources: ['N1'] }])
            assert.equal(r.state.version, s.version)
            assert.equal(r.state.changelog.length, s.changelog.length)
            const r2 = applyDelta(s, { ops: [{ op: 'add', kind: 'rule', text: 'x', sources: ['N1'] }] }, { mode: 'consolidate' })
            assert.match(reasons(r2)[0], /整併模式不可用「add」/)
        })
    })

    describe('第二輪判識之補正(2026-09-29 §12)', function() {

        it('新筆記與既有主張相反:一方引既有主張(其出處早已 consumed)、一方引本批 → 爭議成立;contest 連同差量新建之爭議(判識 A exp1)', () => {
            const s = seed()
            const r = run(s, [
                { op: 'dispute_add', ref: 'd', question: '偏離均值後是否回歸', sides: [{ position: '會回歸', claims: ['C1'] }, { position: '不回歸', sources: ['N4'] }] },
                { op: 'add', ref: 'x', kind: 'principle', text: '部分資產不回歸均值', sources: ['N4'] },
            ])
            assert.deepEqual(reasons(r), [])
            assert.equal(claim(r.state, 'C1').status, 'contested', '舊主張因被未解決之爭議引用而 contested,對立並陳')
            assert.deepEqual(r.state.disputes[0].sources, ['n4'])
        })

        it('retract「重複」須帶 into(存活之同種類項),被撤回者之出處併入 into', () => {
            const s = seed()
            const r = run(s, [{ op: 'retract', id: 'C3', reason: '重複' }])
            assert.match(reasons(r)[0], /須帶 into/)
            const r2 = run(s, [{ op: 'retract', id: 'C3', reason: '重複', into: 'C1' }])
            assert.equal(claim(r2.state, 'C3').status, 'retracted')
            assert.deepEqual(claim(r2.state, 'C1').sources.sort(), ['n1', 'n3'])
            assert.deepEqual(checkInvariants(s, r2.state, { touched: r2.touched }), [])
        })

        it('審查失敗之降級:終態操作暫緩並保存待審(@ref 換成實際 id),其筆記算涵蓋;待審目標轉為終態者丟棄;上限 20', () => {
            const s = seed()
            const r = run(s, [
                { op: 'add', ref: 'n', kind: 'principle', text: '回歸在高頻資料中不成立', sources: ['N4'] },
                { op: 'supersede', id: 'C1', by: '@n', reason: '新研究', validPeriod: '較早之研究', sources: ['N4'] },
            ], { withhold: ['supersede', 'retract', 'merge'] })
            assert.deepEqual(r.withheld[0].resolved, { op: 'supersede', id: 'C1', by: 'C4', reason: '新研究', validPeriod: '較早之研究', sources: ['n4'] })
            const q = queuePendingReview(r.state, r.withheld, { at: 'T', reason: '審查失敗' })
            assert.equal(q.queued, 1)
            assert.equal(q.state.pendingReview[0].op.by, 'C4')
            const cov = coverageOf({ batch: BATCH, applied: r.applied, queued: r.withheld.filter((w) => w.resolved) })
            assert.deepEqual(cov.used, ['n4'])
            const s2 = commitBatch(q.state, cov)
            assert.deepEqual(checkInvariants(s, s2, { touched: r.touched }), [])
            assert.deepEqual(pendingReviewOps(s2).ops.map((o) => [o.op, o.id, o.by]), [['supersede', 'C1', 'C4']])
            assert.match(stateDigest(s2), /【待審.*〔C1〕supersede→〔C4〕/)
            // 待審者之目標已為終態 → 丟棄
            const s3 = run(s2, [{ op: 'retract', id: 'C1', reason: '離題' }]).state
            assert.equal(pendingReviewOps(s3).stale.length, 1)
            // 上限
            let big = s2
            for (let k = 0; k < 25; k++) big = queuePendingReview(big, [{ resolved: { op: 'retract', id: `C${k + 10}`, reason: '離題' }, sources: [] }]).state
            assert.equal(big.pendingReview.length, 20)
        })

        it('applyVerdicts:fix 刪去之出處回報為 removed(算涵蓋);未得有效裁決者回報 unverdicted;逐筆 _withhold 之操作暫緩', () => {
            const ops = [
                { op: 'add', kind: 'rule', text: '甲', sources: ['N1', 'N2'] },
                { op: 'supersede', id: 'C1', reason: 'r', validPeriod: 'x', sources: ['N3'] },
            ]
            const v = applyVerdicts({ ops }, [{ i: 0, action: 'fix', reason: '同篇', fields: { sources: ['N1'] } }])
            assert.deepEqual(v.removed, [{ note: 'N2', reason: '同篇' }])
            assert.deepEqual(v.unverdicted, [1])
            const cov = coverageOf({ batch: BATCH, applied: [{ sources: ['n1'] }], removed: v.removed })
            assert.deepEqual(cov.dropped, [{ note: 'n2', reason: '審查刪去出處：同篇' }])
            const s = seed()
            const marked = v.delta.ops.map((o) => (o._i === 1 ? { ...o, _withhold: true } : o))
            const r = run(s, marked)
            assert.deepEqual(r.withheld.map((w) => [w.index, w.op]), [[1, 'supersede']])
            assert.equal(r.withheld[0].resolved._withhold, undefined)
        })

        it('checkInvariants:待審引用懸空可被抓到', () => {
            const s = seed()
            const x = JSON.parse(JSON.stringify(s))
            x.pendingReview = [{ op: { op: 'supersede', id: 'C77' }, sources: [] }]
            assert.match(checkInvariants(s, x).join('｜'), /待審引用懸空：supersede→C77/)
        })
    })

    describe('applyVerdicts:審查逐操作裁決', function() {

        it('keep／drop／fix;未裁決者保留;不得新增操作;fix 不得增加出處;爭議類之剔除只收「離題／同篇」;回報用提案原序號', () => {
            const ops = [
                { op: 'add', kind: 'rule', text: '甲', sources: ['N1', 'N2'] },
                { op: 'add', kind: 'rule', text: '乙（離題）', sources: ['N3'] },
                { op: 'dispute_add', question: 'q', sides: [{ position: 'a', sources: ['N1'] }, { position: 'b', sources: ['N2'] }] },
                { op: 'add', kind: 'rule', text: '丙', sources: ['N4'] },
            ]
            const v = applyVerdicts({ ops }, [
                { i: 0, action: 'fix', fields: { text: '甲（修）', sources: ['N1', 'N9'] } },
                { i: 1, action: 'drop', reason: '離題' },
                { i: 2, action: 'drop', reason: '重複' },
                { i: 9, action: 'drop', reason: '離題' },
                { i: 3, action: 'add' },
            ])
            assert.deepEqual(v.delta.ops.map((o) => o._i), [0, 2, 3], '被剔除者移除;未知裁決與爭議之非法理由 → 保留')
            assert.deepEqual(v.delta.ops[0].sources, ['N1'], '不得增加出處(N9 被忽略)')
            assert.equal(v.delta.ops[0].text, '甲（修）')
            assert.deepEqual(v.dropped, [{ index: 1, op: 'add', reason: '離題', note: '', sources: ['N3'], ref: '' }])
            assert.deepEqual(v.verdictRejected.map((x) => x.i), [9, 2, 3])
            const r = run(emptyState(), v.delta.ops)
            assert.deepEqual(r.applied.map((a) => a.index).sort(), [0, 2, 3], 'applyDelta 回報原序號')
        })
    })

    describe('涵蓋與落帳', function() {

        it('coverageOf:被已套用操作引用、列入 skipped(理由合法)、被審查剔除者皆算涵蓋;只被拒收或暫緩者為未涵蓋', () => {
            const cov = coverageOf({
                batch: BATCH,
                applied: [{ sources: ['n1'] }],
                skipped: [{ note: 'N2', reason: '離題' }, { note: 'N1', reason: '離題' }, { note: 'N3', reason: '看過了' }],
                dropped: [{ reason: '重複', sources: ['N3'] }],
            })
            assert.deepEqual(cov.used, ['n1'])
            assert.deepEqual(cov.skipped, [{ note: 'n2', reason: '離題' }], '已被引用者不再列略過')
            assert.deepEqual(cov.dropped, [{ note: 'n3', reason: '審查剔除：重複' }])
            assert.deepEqual(cov.uncovered, ['n4'])
            assert.deepEqual(cov.badSkipped, [{ note: 'N3', reason: '看過了' }])
        })

        it('commitBatch:consumed 只增(已涵蓋＋逾限)、理由入 skipped、不改版號', () => {
            const s = seed()
            const s2 = commitBatch(s, { used: ['n4'], skipped: [{ note: 'n2', reason: '離題' }], dropped: [] }, { exhausted: ['n3'] })
            assert.deepEqual(s2.consumed.sort(), ['n1', 'n2', 'n3', 'n4'])
            assert.deepEqual(s2.skipped.map((x) => x.reason), ['離題', '未涵蓋逾限'])
            assert.equal(s2.version, s.version)
        })
    })

    describe('checkInvariants', function() {

        it('正常套用後無違反;每類違反各一例皆抓得到', () => {
            const s = seed()
            assert.deepEqual(checkInvariants(emptyState(), s), [])
            const bad = (fn) => {
                const x = JSON.parse(JSON.stringify(s))
                fn(x)
                return checkInvariants(s, x, { touched: ['C1'] }).join('｜')
            }
            assert.match(bad((x) => x.claims.splice(1, 1)), /舊項遺失：C2/)
            assert.match(bad((x) => {
                x.claims[0].sources = []
            }), /出處減少：C1/)
            assert.match(bad((x) => {
                x.claims[0].history = []
            }), /沿革被改寫：C1/)
            assert.match(bad((x) => {
                x.claims[2].text = '被偷改'
            }), /未觸及之項被改動：C3/)
            assert.match(bad((x) => {
                x.claims[0].status = 'superseded'
            }), /終態無理由：C1/)
            assert.match(bad((x) => {
                x.parameters[0].claim = 'C77'
            }), /參數引用懸空：P1→C77/)
            assert.match(bad((x) => {
                x.consumed = []
            }), /已用筆記減少/)
            assert.match(bad((x) => {
                x.nextId.C = 2
            }), /id 計數/)
            assert.match(bad((x) => {
                x.version += 2
            }), /版號跳動/)
            assert.match(bad((x) => {
                x.claims.push({ ...x.claims[0] })
            }), /id 重複：C1/)
            assert.match(bad((x) => {
                x.claims[1].status = 'superseded'; x.claims[1].statusNote = 'r'; x.claims[1].validPeriod = 'v'; x.claims[1].supersededBy = 'C1'
                x.claims[0].status = 'superseded'; x.claims[0].statusNote = 'r'; x.claims[0].validPeriod = 'v'; x.claims[0].supersededBy = 'C2'
            }), /取代鏈成環/)
            const x = JSON.parse(JSON.stringify(s))
            x.claims[0].sources.push('n77')
            assert.match(checkInvariants(s, x, { touched: ['C1'] }).join('｜'), /出處不在已用筆記內：n77/)
        })

        it('性質測試:隨機操作序列(固定種子)40 輪——applyDelta 不拋錯,落帳後不變式恆成立', () => {
            let seedN = 20260929
            const rnd = () => {
                seedN = (seedN * 1103515245 + 12345) % 2147483648
                return seedN / 2147483648
            }
            const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
            const ev = makeEvidence({ levels: ['高', '中', '低'], caps: { '觀點評論': '低' } })
            const notes = new Map()
            let s = emptyState({ concept: '測試' })
            for (let round = 0; round < 40; round++) {
                const ids = Array.from({ length: 4 }, (_, k) => `r${round}n${k}`)
                for (const id of ids) notes.set(id, { evidenceLevel: pick(['高', '中', '低', '未評估']), claimType: pick(['實證研究', '觀點評論']) })
                const batch = ids.map((id, k) => ({ code: `N${k + 1}`, id }))
                const existing = [...s.claims, ...s.disputes, ...s.parameters, ...s.questions].map((x) => x.id)
                const anyId = () => (existing.length && rnd() < 0.8 ? pick(existing) : pick(['C999', '@r0', '@r1', '']))
                const src = () => [pick(['N1', 'N2', 'N3', 'N4', 'n0', 'X'])]
                const ops = Array.from({ length: 1 + Math.floor(rnd() * 7) }, (_, k) => {
                    const kind = pick(['add', 'add', 'confirm', 'revise', 'supersede', 'retract', 'contest', 'dispute_add', 'dispute_update', 'dispute_dissolve', 'param_add', 'question_add', 'question_resolve', 'essence', 'related_add', 'merge', 'bogus'])
                    return {
                        add: { op: 'add', ref: `r${k}`, kind: pick(['rule', 'principle', 'x']), text: pick(['甲', `主張${round}-${k}`, '']), sources: src() },
                        confirm: { op: 'confirm', id: anyId(), sources: src() },
                        revise: { op: 'revise', id: anyId(), fields: { text: `改${round}` }, reason: pick(['r', '']), sources: src() },
                        supersede: { op: 'supersede', id: anyId(), reason: 'r', validPeriod: pick(['不詳', '']), by: pick(['', anyId()]), sources: src() },
                        retract: { op: 'retract', id: anyId(), reason: pick(['離題', '重複', 'x']) },
                        contest: { op: 'contest', id: anyId(), dispute: anyId(), side: pick([0, 1, 3]), reason: 'r', sources: src() },
                        dispute_add: { op: 'dispute_add', ref: `r${k}`, question: 'q', sides: [{ position: 'a', sources: src(), claims: rnd() < 0.3 ? [anyId()] : [] }, { position: 'b', sources: src() }] },
                        dispute_update: { op: 'dispute_update', id: anyId(), note: 'n', status: pick(['open', 'resolved', undefined]), sources: src() },
                        param_add: { op: 'param_add', ref: `r${k}`, name: 'k', value: pick(['1', '']), claim: pick(['', anyId()]), sources: src() },
                        question_add: { op: 'question_add', text: 'q?', sources: src() },
                        question_resolve: { op: 'question_resolve', id: anyId(), resolution: 'r', sources: src() },
                        dispute_dissolve: { op: 'dispute_dissolve', id: anyId(), reason: pick(['r', '']), kinds: [pick(['rule', 'x'])] },
                        essence: { op: 'essence', text: `本質${round}`, claims: [anyId()], reason: 'r' },
                        related_add: { op: 'related_add', concepts: [pick(['甲', '乙'])] },
                        merge: { op: 'merge', into: anyId(), from: [anyId()], reason: 'r' },
                        bogus: { op: 'bogus' },
                    }[kind]
                })
                const mode = rnd() < 0.15 ? 'consolidate' : 'delta'
                const before = s
                const r = applyDelta(s, { ops }, { batch: mode === 'delta' ? batch : [], mode, at: `R${round}` })
                let next = commitBatch(r.state, coverageOf({ batch: mode === 'delta' ? batch : [], applied: r.applied }))
                next = ev.apply(next, notes)
                const v = checkInvariants(before, next, { touched: r.touched })
                assert.deepEqual(v, [], `第 ${round} 輪(${mode}):${JSON.stringify(ops)}`)
                s = next
            }
            assert.ok(s.claims.length > 3, '序列確實有累積')
        })
    })

    describe('證據等級(中立預設)', function() {

        const notes = new Map([
            ['h1', { evidenceLevel: '高', claimType: '實證研究' }], ['h2', { evidenceLevel: '高', claimType: '實證研究' }],
            ['m1', { evidenceLevel: '中', claimType: '實證研究' }], ['l1', { evidenceLevel: '低', claimType: '實證研究' }],
            ['op', { evidenceLevel: '高', claimType: '觀點評論' }], ['u1', { evidenceLevel: '未評估', claimType: '實證研究' }],
        ])
        const ev = makeEvidence({ levels: ['高', '中', '低'], caps: { '觀點評論': '低', '理論模型': '中', '不存在類': '極高' } })

        it('最高級須 ≥2 篇同達,否則封頂次高級;有爭議封頂次高級;內容類型封頂;未評估排最低之下;無出處＝未評估', () => {
            const lv = (src, contested) => ev.claimEvidence(src, notes, contested).level
            assert.equal(lv(['h1']), '中', '[高]→中(單一來源)')
            assert.equal(lv(['h1', 'h2']), '高', '[高,高]→高')
            assert.equal(lv(['h1', 'l1']), '中', '[高,低]→中')
            assert.equal(lv(['h1', 'h2'], true), '中', 'contested 封頂中')
            assert.equal(lv(['m1'], true), '中', 'contested 之中級不再降')
            assert.equal(lv(['op']), '低', '觀點評論封頂低')
            assert.equal(lv(['u1', 'l1']), '低', '未評估＋低 → 低(不是 undefined)')
            assert.equal(lv(['u1']), UNASSESSED)
            assert.equal(lv([]), UNASSESSED)
            assert.match(ev.claimEvidence(['h1'], notes).trace, /高級僅 1 份文件 → 封頂中/)
        })

        it('「最高級須 ≥2」以相異文件(docId)計:同一研究兩個網址入庫不構成獨立驗證;封頂可用位置表達(等級改名亦生效)', () => {
            const n = new Map([['a', { evidenceLevel: '高', docId: 'd1' }], ['b', { evidenceLevel: '高', docId: 'd1' }], ['c', { evidenceLevel: '高', docId: 'd2' }]])
            assert.equal(ev.claimEvidence(['a', 'b'], n).level, '中', '同一文件兩篇筆記')
            assert.equal(ev.claimEvidence(['a', 'c'], n).level, '高')
            const evPos = makeEvidence({ levels: ['A', 'B', 'C'], caps: { '觀點評論': -1, '理論模型': 1, '壞': 9 } })
            assert.equal(evPos.capRank('觀點評論'), 2)
            assert.equal(evPos.capRank('理論模型'), 1)
            assert.equal(evPos.capRank('壞'), null, '超出範圍之位置忽略')
            const n2 = new Map([['x', { evidenceLevel: 'A', claimType: '觀點評論', docId: 'x' }], ['y', { evidenceLevel: 'A', claimType: '觀點評論', docId: 'y' }]])
            assert.equal(evPos.claimEvidence(['x', 'y'], n2).level, 'C', '等級改名為 A／B／C 仍依位置封頂為最低')
        })

        it('等級名稱依詞彙:2 級與 4 級詞彙皆有定義', () => {
            const ev2 = makeEvidence({ levels: ['強', '弱'] })
            const n2 = new Map([['a', { evidenceLevel: '強' }], ['b', { evidenceLevel: '強' }]])
            assert.equal(ev2.claimEvidence(['a'], n2).level, '弱')
            assert.equal(ev2.claimEvidence(['a', 'b'], n2).level, '強')
            const ev4 = makeEvidence({ levels: ['A', 'B', 'C', 'D'] })
            const n4 = new Map([['a', { evidenceLevel: 'A' }], ['c', { evidenceLevel: 'C' }]])
            assert.equal(ev4.claimEvidence(['a', 'c'], n4).level, 'B')
        })

        it('apply:爭議各方取所引主張之最高等級;參數取所依主張;終態項不重算', () => {
            let s = emptyState()
            const ops = [
                { op: 'add', ref: 'a', kind: 'rule', text: '甲', sources: ['h1', 'h2'] },
                { op: 'add', ref: 'b', kind: 'rule', text: '乙', sources: ['op'] },
                { op: 'param_add', name: 'k', value: '1', claim: '@a', sources: ['m1'] },
                { op: 'dispute_add', question: 'q', sides: [{ position: 'x', claims: ['@a'] }, { position: 'y', sources: ['l1'] }] },
            ]
            s = applyDelta(s, { ops }, { batch: [...notes.keys()].map((id) => ({ id })) }).state
            ev.apply(s, notes)
            assert.equal(claim(s, 'C1').evidence.level, '中', 'C1 被爭議引用 → contested 封頂中')
            assert.equal(findItem(s, 'P1').item.evidence.level, '中', '參數取所依主張')
            assert.equal(s.disputes[0].sides[0].evidence.level, '中')
            assert.equal(s.disputes[0].sides[1].evidence.level, '低')
            assert.equal(claim(s, 'C2').evidence.level, '低')
        })

        it('主張本身之兩道封頂(只壓低不抬高):證據性質(basis)取所含關鍵詞之最嚴者、皆不含取「*」;自承限制片語 → 次高;皆記入 trace(安裝方驗收 §3 #3)', () => {
            const evB = makeEvidence({
                levels: ['高', '中', '低'],
                basisCaps: { '樣本外實證': 0, '理論': 1, '觀點': -1, '*': 1 },
                selfLimit: ['單一研究', '未經獨立驗證'],
            })
            const n = new Map([['a', { evidenceLevel: '高', docId: 'a' }], ['b', { evidenceLevel: '高', docId: 'b' }], ['l', { evidenceLevel: '低', docId: 'l' }]])
            const lvOf = (c) => {
                const s = { ...emptyState(), claims: [{ id: 'C1', status: 'active', sources: ['a', 'b'], ...c }] }
                evB.apply(s, n)
                return s.claims[0].evidence
            }
            assert.equal(lvOf({ basis: '樣本外實證' }).level, '高', '兩篇高＋樣本外實證 → 高')
            assert.equal(lvOf({ basis: '實證研究＋理論解釋' }).level, '中', '含「理論」→ 次高')
            assert.equal(lvOf({ basis: '樣本外實證、觀點' }).level, '低', '並列時取最嚴')
            assert.equal(lvOf({ basis: '實證研究' }).level, '中', '不在表內 → 「*」次高(只有樣本外實證可達最高)')
            assert.equal(lvOf({}).level, '中', '未寫 basis → 「*」')
            assert.match(lvOf({ basis: '理論' }).trace, /性質「理論」→ 封頂中/)
            const lim = lvOf({ basis: '樣本外實證', critique: '僅見於單一研究' })
            assert.deepEqual([lim.level, /自承限制「單一研究」→ 封頂中/.test(lim.trace)], ['中', true], '銳評自承限制 → 次高(與出處無關之獨立防線)')
            assert.equal(lvOf({ basis: '樣本外實證', conditions: ['未經獨立驗證'] }).level, '中', 'conditions 亦算')
            assert.equal(lvOf({ basis: '樣本外實證', sources: ['l'] }).level, '低', '只壓低、不抬高')
            const plain = makeEvidence({ levels: ['高', '中', '低'] })
            const s0 = { ...emptyState(), claims: [{ id: 'C1', status: 'active', sources: ['a', 'b'], basis: '理論', critique: '單一研究' }] }
            plain.apply(s0, n)
            assert.equal(s0.claims[0].evidence.level, '高', '未給兩表 → 不封頂(直呼 makeEvidence 之行為不變)')
        })
    })

    describe('upgradeState／stateDigest', function() {

        it('upgradeState:補齊缺欄;未知之較新版本拒讀;非物件拒讀', () => {
            const s = upgradeState({ v: 1, concept: '甲', claims: [{ id: 'C1' }] })
            assert.deepEqual(s.nextId, { C: 1, D: 1, P: 1, Q: 1 })
            assert.deepEqual(s.disputes, [])
            assert.throws(() => upgradeState({ v: STATE_VERSION + 1 }), /新於本套件支援/)
            assert.throws(() => upgradeState(null), /須為物件/)
            assert.throws(() => upgradeState({ v: 0 }), /格式版本無效/)
        })

        it('stateDigest:列非終態之主張與爭議(含 id)、終態只列 id;空狀態明示', () => {
            let s = seed()
            s = run(s, [{ op: 'retract', id: 'C3', reason: '離題' }]).state
            const d = stateDigest(s)
            assert.match(d, /〔C1〕\[principle\] 價格偏離均值後傾向回歸/)
            assert.match(d, /〔P1〕半衰期＝5–20 日.*依〔C1〕/)
            assert.match(d, /〔Q1〕回歸速度是否隨市況而變/)
            assert.match(d, /【已取代／撤回】〔C3〕撤回（離題）/)
            assert.doesNotMatch(d, /偏離兩個標準差以上才進場/)
            assert.equal(stateDigest(emptyState()), '（尚無內容）')
        })

        it('side k 一致(1.0.5 三獨立審定案 S1):摘要各方標 side k、k 即操作之 side 值;side 收整數、數字字串與「side k」;錯誤訊息列現有範圍', () => {
            const s = run(seed(), [{ op: 'dispute_add', question: '回歸速度', sides: [{ position: '快', claims: ['C1'] }, { position: '慢', claims: ['C2'] }], sources: ['N1'] }]).state
            assert.match(stateDigest(s), /【爭議】（各方以 side k 標示，k 即操作之 "side" 值，自 0 起）\n〔D1〕回歸速度｜side 0：快（引〔C1〕）｜side 1：慢（引〔C2〕）/)
            // 依摘要所見之 k 填 side → 落在同一方(1.0.4 摘要寫「第2方」、操作要填 1,模型照抄即錯一格)
            for (const side of [1, '1', 'side 1', 'Side1']) {
                const r = run(s, [{ op: 'contest', id: 'C3', dispute: 'D1', side, reason: 'r', sources: ['N3'] }])
                const d = findItem(r.state, 'D1').item
                assert.deepEqual([reasons(r), d.sides[1].claims, d.history.at(-1).note], [[], ['C2', 'C3'], 'C3 列入 side 1'], `side=${JSON.stringify(side)}`)
            }
            assert.deepEqual(reasons(run(s, [{ op: 'contest', id: 'C3', dispute: 'D1', side: '第2方', reason: 'r', sources: ['N3'] }])), ['爭議 D1 無 side 第2方（contest 須指明 side；現有 side 0～1）'])
            assert.deepEqual(findItem(run(s, [{ op: 'confirm', id: 'D1', side: 'side 0', sources: ['N4'] }]).state, 'D1').item.sides[0].sources, ['n4'])
            assert.deepEqual(reasons(run(s, [{ op: 'confirm', id: 'D1', side: 2, sources: ['N4'] }])), ['爭議 D1 無 side 2（現有 side 0～1）'])
        })

        it('審查存疑於提案摘要只顯示至下一次提案落盤(存疑時刻 ≥ 上次提案時刻);已解決或撤回之爭議不顯示', () => {
            const s = run(seed(), [{ op: 'dispute_add', question: '回歸速度', sides: [{ position: '快', claims: ['C1'] }, { position: '慢', claims: ['C2'] }], sources: ['N1'] }]).state
            const v = applyVerdicts({ ops: [{ op: 'dispute_update', id: 'D1', note: '補充', sources: ['N4'] }] }, [{ i: 0, action: 'doubt', reason: '非對立', note: '兩方回答不同問題' }])
            const T = '2026-10-01T00:00:00+08:00'
            const t = applyDelta(s, v.delta, { batch: BATCH, at: T }).state
            assert.deepEqual([t.disputes[0].doubt.at, t.disputes[0].doubt.version], [T, t.version])
            const line = /｜審查存疑（非對立）：兩方回答不同問題/
            assert.match(stateDigest({ ...t, proposedAt: T }), line, '存疑產生之提案落盤時 proposedAt＝其時刻 → 下一次提案看得到')
            assert.doesNotMatch(stateDigest({ ...t, proposedAt: '2026-10-02T00:00:00+08:00' }), line, '其後之提案落盤 → 不再呈現')
            const resolved = run(t, [{ op: 'dispute_update', id: 'D1', status: 'resolved', note: '已釐清', sources: ['N3'] }]).state
            assert.doesNotMatch(stateDigest({ ...resolved, proposedAt: T }), line, '已解決者不顯示')
        })
    })
})
