// unit-extract-opstandards.test.mjs — 提煉之納入閘(extract/standards/opStandards):逐操作之檢定標準、程式意見、定稿篩選、補丁不得新增問題
// 規格:方案 v2 §3.4 與檢定標準終審 §3.5——ES2 數字紮根於本操作所引出處(＋所觸及條目全文;不含投影章;材料不可得 → 未能判定)、
//   ES16 本質紮根於所引主張之出處、ES4 標注明示(丙:「出處未載」可)、ES12 principle 跨篇(以文件計)、ES13 弱證據參數須註明限制、
//   ES17 不提及筆記(本批代號、[[…]];非本批之 N 數字不算)、外洩(含理由);先轉修訂意見、定稿仍不合才不採;補丁不得新增問題。
// 執行:自套件根 npx mocha test/unit-extract-opstandards.test.mjs(不呼叫 AI)

import assert from 'node:assert/strict'
import { createOpStandards, STD_ISSUE_TYPE, opStandardsCtxOf, applyCtxOf, gateOps } from '../src/standards/opStandards.mjs'
import { applyPatch } from '../src/workflow/reviewGuards.mjs'
import { guardOps } from '../src/standards/opGuards.mjs'
import { applyWithInvariants } from '../src/workflow/applyWithInvariants.mjs'
import { runPass } from '../src/workflow/runPass.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { applyDelta, coverageOf, commitBatch } from '../src/stores/coreDelta.mjs'
import { findItem } from '../src/stores/coreState.mjs'
import { seedCore, seatAi, keepAll } from './tools/extractKit.mjs'

const AT = '2026-10-04T21:00:00+08:00'
const domain = createExtractDomain({})
// 本檔之標注另寫(不取共用件之 ANN):「拆分各部」之案以種子主張之銳評原文為拆出之銳評(拆分之各欄須取自原條),銳評之字樣即該案之前提
const ANN = { critique: '僅單一研究之結論', pros: ['出處未載'], cons: ['出處未載'] }
// 既有核心:s0、s1 兩篇(不同文件)為出處
const SEED_BATCH = [{ code: 'N0', id: 's0' }, { code: 'N9', id: 's1' }]
const seedState = () => seedCore({ coreId: 'm', concept: '動量', ops: [
    { op: 'add', ref: 'a', kind: 'rule', text: '動量策略持有期 6 個月之報酬最高', basis: '實證', sources: ['N0'], ...ANN },
    { op: 'add', ref: 'b', kind: 'pitfall', text: '交易成本 0.5% 時淨報酬消失', basis: '實證', conditions: ['高周轉'], critique: '單一市場', sources: ['N9'] },
    { op: 'essence', text: '動量是贏家續贏之傾向。', claims: ['@a'], reason: '首版' },
], batch: SEED_BATCH, at: AT })
const BATCH = [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }, { code: 'N3', id: 'n3' }]
const CONTENT = {
    n1: '# 甲\n## 核心知識\n- 動量報酬可持續 3 到 12 個月\n## 爭議與反方觀點\n- 他人研究稱年化 8%',
    n2: '# 乙\n## 核心知識\n- 空頭反轉時動量虧損 40%',
    n3: '# 丙\n## 核心知識\n- 同一研究之轉載：動量報酬可持續 3 到 12 個月',
    s0: '# 種子甲\n## 核心知識\n- 持有期 6 個月之報酬最高',
    s1: '# 種子乙\n## 核心知識\n- 交易成本 0.5% 時淨報酬消失',
}
// n1、n3 為同一文件(轉載);n2 另一文件
const NOTES = new Map([
    ['n1', { id: 'n1', evidenceLevel: '低', claimType: '實證研究', docId: 'd1' }],
    ['n2', { id: 'n2', evidenceLevel: '中', claimType: '實證研究', docId: 'd2' }],
    ['n3', { id: 'n3', evidenceLevel: '低', claimType: '實證研究', docId: 'd1' }],
    ['s0', { id: 's0', evidenceLevel: '中', claimType: '實證研究', docId: 'd0' }],
    ['s1', { id: 's1', evidenceLevel: '中', claimType: '實證研究', docId: 'd9' }],
])
const ctxOf = (state, o = {}) => ({
    state, batch: BATCH, contentOf: (nid) => (nid in CONTENT ? CONTENT[nid] : null), docIdOf: (nid) => NOTES.get(nid)?.docId || nid,
    applyCtx: { batch: BATCH, mode: 'delta', claimKinds: domain.claimKinds, limits: domain.limits, at: AT }, evidence: domain.evidence, notesById: NOTES, weakEvidence: '僅回測未經樣本外驗證', ...o,
})
const stdOf = (ops, state = seedState(), o = {}) => createOpStandards(ctxOf(state, o)).problemsOf(ops)
const only = (m, op) => (m.get(op) || []).map((p) => `${p.std}${p.field ? `(${p.field})` : ''}`)

describe('unit-extract-opstandards', function() {

    describe('ES2／ES16 數字紮根(逐操作之材料)', function() {

        it('數字須見於本操作所引出處:引 N1 而數字只在 N2 → 不合(此前全批聯集即過);引 N2 → 合', () => {
            const a = { op: 'add', kind: 'rule', text: '空頭反轉時動量虧損 40%', sources: ['N1'], ...ANN }
            const b = { op: 'add', kind: 'rule', text: '空頭反轉時動量虧損 40%', sources: ['N2'], ...ANN }
            const m = stdOf([a, b])
            assert.deepEqual(only(m, a), ['ES2'])
            assert.match(m.get(a)[0].detail, /數字 40% 不見於本操作所引出處/)
            assert.deepEqual(only(m, b), [])
        })

        it('所觸及既有條目之全文為材料(revise 保留原數字);⚠ 投影章不屬筆記內容(contentOf 由呼叫端去除)', () => {
            const s = seedState()
            const c = s.claims.find((x) => x.text.includes('6 個月'))
            const rv = { op: 'revise', id: c.id, fields: { text: '動量策略持有期 6 個月之報酬最高，扣成本後仍為正' }, reason: '補充' }
            assert.deepEqual(only(stdOf([rv], s), rv), [])
            const bad = { op: 'revise', id: c.id, fields: { text: '動量策略持有期 9 個月之報酬最高' }, reason: '改寫' }
            assert.deepEqual(only(stdOf([bad], s), bad), ['ES2'])
        })

        it('材料不可得而有未紮根之數字 → 未能判定(亦交修訂、定稿不採);可得材料已紮根者照過', () => {
            const s = seedState()
            const c = s.claims.find((x) => x.text.includes('6 個月'))
            const op = { op: 'revise', id: c.id, fields: { text: '動量策略持有期 6 個月，年化 15%' }, reason: '補充' }
            const m = stdOf([op], s, { contentOf: () => null })
            assert.deepEqual(only(m, op), ['ES2'])
            assert.match(m.get(op)[0].detail, /出處內容不可得（1 篇）而有須核對之數字 15%/)
            const ok = { op: 'revise', id: c.id, fields: { text: '動量策略持有期 6 個月之報酬最高，另有說明' }, reason: '補充' }
            assert.deepEqual(only(stdOf([ok], s, { contentOf: () => null }), ok), [], '數字見於所觸及條目之原文')
        })

        it('同差量所引新項之文字與出處亦為材料(dispute_add 之方引 @ref)', () => {
            const add = { op: 'add', ref: 'x', kind: 'rule', text: '空頭反轉時動量虧損 40%', sources: ['N2'], ...ANN }
            const dp = { op: 'dispute_add', question: '動量是否在反轉期失效', sides: [{ position: '反轉期虧損 40%', claims: ['@x'] }, { position: '長期仍有效', sources: ['N1'] }] }
            assert.deepEqual(only(stdOf([add, dp]), dp), [])
        })

        it('ES16 本質:數字須見於所引主張之出處(不含主張文字)', () => {
            const s = seedState()
            const c = s.claims.find((x) => x.text.includes('6 個月'))
            const ok = { op: 'essence', text: `動量以持有 6 個月最佳〔${c.id}〕。`, claims: [c.id] }
            assert.deepEqual(only(stdOf([ok], s), ok), [])
            const bad = { op: 'essence', text: `動量以持有 9 個月最佳〔${c.id}〕。`, claims: [c.id] }
            assert.deepEqual(only(stdOf([bad], s), bad), ['ES16(text)'])
        })
    })

    describe('ES4／ES12／ES13(試套之結果)', function() {

        it('ES4:新主張之銳評必填;principle／rule 之利弊須有內容或「出處未載」;temporal 須期間;pitfall 須條件', () => {
            const ops = [
                { op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'] },
                { op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月，限美股', sources: ['N1'], ...ANN },
                { op: 'add', kind: 'temporal', text: '動量效應於 2009 後減弱', sources: ['N1'], critique: '推測' },
                { op: 'add', kind: 'pitfall', text: '空頭反轉時動量虧損 40%', sources: ['N2'], critique: '單一事件' },
            ]
            const m = stdOf(ops)
            assert.match(m.get(ops[0])[0].detail, /缺銳評、缺利\(或「出處未載」\)、缺弊\(或「出處未載」\)/)
            assert.deepEqual(only(m, ops[1]), [])
            assert.ok(m.get(ops[2]).some((p) => p.std === 'ES4' && /時效主張缺期間/.test(p.detail)))
            assert.ok(m.get(ops[3]).some((p) => p.std === 'ES4' && /陷阱主張缺條件/.test(p.detail)))
        })

        it('ES4 之 revise:改到標注或種類才以結果檢(不因既有缺標注擋住無關之改寫);改為 principle 須補利弊', () => {
            const s = seedState()
            const pit = s.claims.find((x) => x.kind === 'pitfall')
            const textOnly = { op: 'revise', id: pit.id, fields: { text: '交易成本 0.5% 時淨報酬消失，高周轉尤甚' }, sources: ['N1'], reason: '補充' }
            assert.deepEqual(only(stdOf([textOnly], s), textOnly), [])
            const toRule = { op: 'revise', id: pit.id, fields: { kind: 'rule' }, sources: ['N1'], reason: '改種類' }
            assert.ok(stdOf([toRule], s).get(toRule).some((p) => p.std === 'ES4' && /缺利/.test(p.detail)))
            const toRuleOk = { op: 'revise', id: pit.id, fields: { kind: 'rule', pros: ['出處未載'], cons: ['高周轉時淨報酬消失'] }, sources: ['N1'], reason: '改種類' }
            assert.deepEqual(only(stdOf([toRuleOk], s), toRuleOk), [])
        })

        it('ES12:principle 之存活出處相異文件 ≥2(同一研究之轉載只算一份);改為 principle 者亦檢', () => {
            const one = { op: 'add', kind: 'principle', text: '動量報酬可持續 3 到 12 個月', sources: ['N1', 'N3'], ...ANN }
            const two = { op: 'add', kind: 'principle', text: '動量報酬可持續 3 到 12 個月，反轉期虧損 40%', sources: ['N1', 'N2'], ...ANN }
            const m = stdOf([one, two])
            assert.deepEqual(only(m, one), ['ES12'])
            assert.match(m.get(one)[0].detail, /principle 之存活出處只來自 1 份文件/)
            assert.deepEqual(only(m, two), [])
        })

        it('ES13:param_add 之程式判定證據為最低級者 conditions 須含限制語(自承限制片語或 weakEvidence 句);較高者不檢', () => {
            const low = { op: 'param_add', name: '持有期', value: '3 到 12 個月', sources: ['N1'] }
            const lowOk = { op: 'param_add', name: '持有期', value: '3 到 12 個月', conditions: ['單一研究'], sources: ['N1'] }
            const lowWeak = { op: 'param_add', name: '持有期', value: '3 到 12 個月', conditions: ['僅回測未經樣本外驗證'], sources: ['N1'] }
            const mid = { op: 'param_add', name: '虧損幅度', value: '40%', sources: ['N2'] }
            const m = stdOf([low, lowOk, lowWeak, mid])
            assert.deepEqual(only(m, low), ['ES13(conditions)'])
            assert.match(m.get(low)[0].detail, /證據等級為「低」而 conditions 未註明限制/)
            for (const x of [lowOk, lowWeak, mid]) assert.deepEqual(only(m, x), [])
        })

        it('參數之 conditions 一律為字串:param_add 與 revise 給陣列者以「；」併為一句(此前 param_add 之陣列被靜默丟棄、revise 存成陣列)', () => {
            const s = seedState()
            const r = applyDelta(s, { ops: [{ op: 'param_add', ref: 'p', name: '持有期', value: '3 到 12 個月', conditions: ['美股樣本', '單一研究'], sources: ['N1'] }] }, { batch: BATCH, mode: 'delta', at: AT })
            const p = r.state.parameters.find((x) => x.name === '持有期')
            assert.equal(p.conditions, '美股樣本；單一研究')
            const r2 = applyDelta(r.state, { ops: [{ op: 'revise', id: p.id, fields: { conditions: ['美股樣本', '僅回測'] }, sources: ['N1'], reason: '補條件' }] }, { batch: BATCH, mode: 'delta', at: AT })
            assert.equal(r2.state.parameters.find((x) => x.id === p.id).conditions, '美股樣本；僅回測')
        })

        it('拆分各部之主張亦檢 ES4(試套產生之主張)', () => {
            const s = seedState()
            const c = s.claims.find((x) => x.text.includes('6 個月'))
            const sp = { op: 'split', id: c.id, reason: '一條說兩件事', parts: [{ text: '動量策略持有期 6 個月', critique: '僅單一研究之結論', pros: ['出處未載'], cons: ['出處未載'] }, { text: '報酬最高', pros: ['出處未載'], cons: ['出處未載'] }] }
            const m = stdOf([sp], s)
            assert.deepEqual(only(m, sp), ['ES4(parts[1])'])
        })
    })

    describe('ES17 與外洩', function() {

        it('ES17:本批代號與筆記連結不得出現在內容文字;非本批之 N 數字(如 N225)不算;理由欄不檢', () => {
            const ops = [
                { op: 'add', kind: 'rule', text: 'N1 指出動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN },
                { op: 'add', kind: 'rule', text: '日經 N225 成分股之動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN },
                { op: 'add', kind: 'rule', text: '見 [[某筆記]]：動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN },
                { op: 'supersede', id: 'C1', reason: 'N2 之樣本外結果否定', validPeriod: '至 2020' },
            ]
            const m = stdOf(ops)
            assert.deepEqual(only(m, ops[0]), ['ES17(text)'])
            assert.deepEqual(only(m, ops[1]), [])
            assert.deepEqual(only(m, ops[2]), ['ES17(text)'])
            assert.ok(!(m.get(ops[3]) || []).some((p) => p.std === 'ES17'), '理由欄不檢提及筆記')
        })

        it('外洩:全部文字欄(含理由)不得有流程用語', () => {
            const op = { op: 'retract', id: 'C2', reason: '依審計意見撤回' }
            assert.deepEqual(only(stdOf([op]), op), ['leak(reason)'])
        })
    })

    describe('程式意見、定稿篩選、補丁', function() {

        it('issuesOf:審計意見形狀(ref＝_oid、嚴重度高、類型「檢定標準」、附修法);screen:不合者不採,其 ref 記為已剔除(寫明標準)', () => {
            const a = { op: 'add', ref: 'x', kind: 'rule', text: '空頭反轉時動量虧損 40%', sources: ['N1'], ...ANN, _oid: 'i_1' }
            const b = { op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN, _oid: 'i_2' }
            const std = createOpStandards(ctxOf(seedState()))
            const is = std.issuesOf([a, b])
            assert.equal(is.length, 1)
            assert.deepEqual([is[0].ref, is[0].severity, is[0].type], ['i_1', '高', STD_ISSUE_TYPE])
            assert.match(is[0].detail, /^ES2：數字 40% 不見於本操作所引出處與所觸及條目——定稿仍不合即不採$/)
            assert.match(is[0].fix, /改用所引出處中之數字/)
            const sc = std.screen([a, b])
            assert.deepEqual(sc.ops, [b])
            assert.deepEqual(sc.droppedRefs, { x: '未達檢定標準（ES2）' })
        })

        it('applyPatch:補丁使本條新增問題(新的未紮根數字)→ 保留原稿;減少問題 → 照採;新增之操作須已合標準', () => {
            const state = seedState()
            const std = createOpStandards(ctxOf(state))
            const op = { op: 'add', kind: 'rule', text: '空頭反轉時動量虧損 40%、年化 9%', sources: ['N2'], ...ANN, _oid: 'i_1' }
            const issues = [{ k: 0, ref: 'i_1', severity: '高', type: STD_ISSUE_TYPE, detail: 'ES2', fix: '' }]
            const ctx = { state, issues, guard: (xs) => ({ ops: xs, rejected: [] }), limits: domain.limits, problemsOf: (xs) => std.problemsOf(xs) }
            const worse = applyPatch([op], { edits: [{ ref: 'i_1', fields: { text: '空頭反轉時動量虧損 40%、年化 7%' } }] }, ctx)
            assert.equal(worse.log[0].ok, false)
            assert.match(worse.log[0].why, /新增檢定標準問題（ES2\|\|7%）/)
            const better = applyPatch([op], { edits: [{ ref: 'i_1', fields: { text: '空頭反轉時動量虧損 40%' } }] }, ctx)
            assert.equal(better.log[0].ok, true, better.log[0].why)
            const added = applyPatch([op], { adds: [{ issue: '0', op: { op: 'add', kind: 'rule', text: '年化 9%', sources: ['N2'], ...ANN } }] }, ctx)
            assert.match(added.log[0].why, /^新增未達檢定標準（ES2：數字 9%/)
        })
    })

    // 終審 §3 D7(閘之組合一份)、D5k(不變式違反之處置一份):p2-設計 WP1
    describe('閘之共用件(gateOps／opStandardsCtxOf／applyCtxOf)與不變式之逐條剔除(applyWithInvariants)', function() {

        it('opStandardsCtxOf:docIdOf 自筆記記錄取 docId(無者以筆記 id)、證據規則與弱證據句取 domain;applyCtxOf:batch 收斂為 { code, id },主張種類與上限取 domain', () => {
            const ctx = opStandardsCtxOf({ state: seedState(), batch: BATCH, contentOf: (nid) => CONTENT[nid] ?? null, notesById: NOTES, applyCtx: { batch: BATCH }, domain })
            assert.deepEqual([ctx.docIdOf('n1'), ctx.docIdOf('zz'), ctx.evidence === domain.evidence, ctx.weakEvidence], ['d1', 'zz', true, domain.weakEvidence])
            const ac = applyCtxOf(domain, { batch: [{ code: 'N1', id: 'n1', digest: 'x', note: {} }], at: AT, step: 'essence', onlyOps: ['essence'] })
            assert.deepEqual(ac, { batch: [{ code: 'N1', id: 'n1' }], mode: 'delta', at: AT, step: 'essence', onlyOps: ['essence'], claimKinds: domain.claimKinds, limits: domain.limits })
        })

        it('gateOps:守門之拒收與納入閘之不合皆入 rejected(理由陣列;守門者以「守門：」起頭、納入閘者「<標準>：<細節>」);通過者經 remap;droppedRefs 記納入閘所剔之 ref;無 guard 即拋', () => {
            const state = seedState()
            const std = createOpStandards(ctxOf(state))
            const bad = { op: 'add', ref: 'x', kind: 'rule', text: '空頭反轉時動量虧損 40%', sources: ['N1'], ...ANN }
            const ok = { op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }
            // 可見性守門:對只見索引行之條目改狀態 → 守門拒
            const hidden = { op: 'retract', id: 'C1', reason: '已被取代' }
            const g = gateOps([bad, ok, hidden], { guard: guardOps, state, visible: new Set(), std, remap: (xs) => xs.map((x) => ({ ...x, _seen: true })) })
            assert.deepEqual(g.ops.map((x) => [x.text, x._seen]), [[ok.text, true]])
            assert.deepEqual(g.rejected.map((x) => [x.op.op, x.why[0].replace(/^(守門：目標|ES2：數字).*$/, '$1'), !!x.problems]), [['retract', '守門：目標', false], ['add', 'ES2：數字', true]])
            assert.deepEqual([g.droppedRefs, g.guardRejected, g.stdRejected], [{ x: '未達檢定標準（ES2）' }, 1, 1])
            assert.throws(() => gateOps([ok], { state, std }), /需要 o\.guard/)
            // 未給 std:只守門
            assert.deepEqual(gateOps([bad], { guard: guardOps, state }).ops.length, 1)
        })

        it('applyWithInvariants:尾端寫入(finish)在不變式之前;違反者逐條剔除(dropped 帶原操作與首條違反)、其餘重套,onDropped 於最終重套前呼叫;全部剔除後仍違反 → ok:false', () => {
            const state = seedState()
            const ctx = { batch: BATCH, mode: 'delta', claimKinds: domain.claimKinds, limits: domain.limits, at: AT }
            const a = { op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }
            const b = { op: 'add', kind: 'rule', text: '空頭反轉時動量虧損 40%', sources: ['N2'], ...ANN }
            // 尾端寫入(涵蓋落帳:出處入已用筆記——不變式「出處必為已用筆記」賴之)在不變式之前;finish 以 extra 回傳;正常路徑無剔除
            const commit = (ap) => commitBatch(ap.state, coverageOf({ batch: BATCH, applied: ap.applied }))
            const ok = applyWithInvariants(state, [a, b], ctx, { finish: (ap) => ({ state: commit(ap), n: ap.applied.length }) })
            assert.deepEqual([ok.ok, ok.dropped, ok.firstInv, ok.n, ok.ap.applied.length], [true, [], [], 2, 2])
            // finish 於含 b 之套用時改寫未觸及之既有條目(模擬尾端寫入之錯)→ b 被剔、a 照套
            const calls = []
            const corrupt = (ap) => {
                const s = commit(ap)
                if (s.claims.some((c) => c.text === b.text)) findItem(s, 'C1').item.text = '被改壞'
                return { state: s }
            }
            const r = applyWithInvariants(state, [a, b], ctx, { finish: corrupt, onDropped: (d, first) => calls.push([d.map((x) => x.op), first.length > 0]) })
            assert.deepEqual([r.ok, r.dropped.map((x) => [x.op, x.raw === b, /C1/.test(x.inv)]), calls, r.ap.applied.length, r.state.claims.some((c) => c.text === a.text), r.state.claims.some((c) => c.text === b.text)], [true, [['add', true, true]], [[['add'], true]], 1, true, false])
            // 每次套用皆改寫 → 全部剔除後仍違反
            const always = applyWithInvariants(state, [a], ctx, { finish: (ap) => { const s = commit(ap); findItem(s, 'C1').item.text = '壞'; return { state: s } } })
            assert.deepEqual([always.ok, always.dropped.length, always.inv.length > 0], [false, 1, true])
        })
    })

    describe('runPass 之接線', function() {

        // 單一起草者之 3+3(區域名;與共用件 extractKit 之三席起草 SEATS 不同義)
        const SEATS1 = { drafters: [{ use: 'd1' }], integrate: { use: 'int' }, audit: { use: 'aud' }, revise: { use: 'rev' }, accept: { use: 'acc' } }
        // 單一 pass 之替身(依席位 use 回覆、記下各席之提示詞)取共用件 seatAi(test/tools/extractKit)
        const fakeAi = seatAi
        const digestBatch = () => BATCH.map((b) => ({ ...b, digest: `### ${b.code}\n${CONTENT[b.id]}` }))
        const run = (ai) => runPass({ state: seedState(), concept: '動量', batch: digestBatch(), domain, seats: SEATS1, ai, notesById: NOTES, contentOf: (nid) => CONTENT[nid] ?? null, at: AT })
        const bad = { op: 'add', ref: 'x', kind: 'rule', text: '空頭反轉時動量虧損 40%', sources: ['N1'], ...ANN }
        const dep = { op: 'param_add', name: '虧損幅度', value: '40%', claim: '@x', conditions: ['單一研究'], sources: ['N2'] }

        it('不合者成程式意見交修訂;修訂改對 → 套用', async () => {
            const ai = fakeAi({ d1: { ops: [bad], skipped: [] }, aud: { issues: [] }, rev: { edits: [{ ref: 'a1_1', fields: { sources: ['N2'] } }, { ref: 'a1_1', fields: { text: '空頭反轉時動量虧損 40%（N2 樣本）' } }] }, acc: keepAll })
            const r = await run(ai)
            assert.equal(r.ok, true, r.error)
            assert.deepEqual(ai.seen, ['d1', 'aud', 'rev', 'acc'], '有程式意見即跑修訂')
            assert.ok(r.trace.issues.some((x) => x.type === STD_ISSUE_TYPE && /ES2/.test(x.detail)))
            assert.ok(ai.prompts.rev.includes('檢定標準'), '修訂提示詞含程式意見')
            assert.equal(r.stats.stdIssues, 1)
        })

        it('修訂未改對 → 定稿不採;依賴它之操作拒收時寫明根因(未達檢定標準);筆記未涵蓋', async () => {
            const ai = fakeAi({ d1: { ops: [bad, dep], skipped: [] }, aud: { issues: [] }, rev: { edits: [] }, acc: keepAll })
            const r = await run(ai)
            assert.equal(r.ok, true, r.error)
            assert.equal(r.stats.stdRejected, 1)
            assert.deepEqual(r.trace.stdOut.map((x) => x.op), ['add'])
            assert.ok(!r.state.claims.some((c) => c.text.includes('40%')))
            assert.ok(r.rejected.some((x) => x.op === 'param_add' && /未達檢定標準（ES2）/.test(x.reason)), JSON.stringify(r.rejected))
            assert.ok(r.coverage.uncovered.includes('n1'))
        })
    })
})
