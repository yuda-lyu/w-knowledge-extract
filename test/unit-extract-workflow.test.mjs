// unit-extract-workflow.test.mjs — 提煉 3+3 工作流(runPass)之編排、程式守門與降級梯(替身 AI,不呼叫真模型)
// 【為何要有】提煉為「3 家獨立起草 → 整合 → 審計 → 修訂 → 終審」,B 段為補丁＋依操作類別之守門(建設性／破壞性之剔除語意相反);
//   整合失敗時改程式聯集、續跑 B 段(不用 runFanoutPipeline 一條到底)——本檔把編排與每條守門以替身鎖住。
// 執行:npx mocha test/unit-extract-workflow.test.mjs(cwd＝套件根)

import assert from 'node:assert/strict'
import { runPass, stateView, lengthIssues, trimToLimit, rulesTextOf } from '../src/workflow/runPass.mjs'
import { relationContextRows } from '../src/workflow/relationContext.mjs'
import { replyObjectOf, normalizeDelta, parseDraft, parseAudit, parsePatch, parseVerdicts, checkDraft } from '../src/standards/parse.mjs'
import { closeRefs, normalizeBareRefs } from '../src/workflow/candidates.mjs'
import { applyPatch, inferOp, normalizeIssues, gateVerdicts, removalAllowed } from '../src/workflow/reviewGuards.mjs'
import { bracketRefs, guardOps } from '../src/standards/opGuards.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { findItem, holdItems, withdrawSources } from '../src/stores/coreState.mjs'
import { opLengthProblem, applyDelta, coverageOf, commitBatch, queuePendingReview } from '../src/stores/coreDelta.mjs'
import { applyVerdicts, pendingReviewOps } from '../src/workflow/verdicts.mjs'
import { stateDigest } from '../src/stores/stateDigest.mjs'
import { runPending } from '../src/workflow/pending.mjs'
import { runSupportStockPass } from '../src/workflow/supportStockPass.mjs'
import { seedCore, SEATS, ANN, seatAi as fakeAi, keepAll } from './tools/extractKit.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'

const AT = '2026-10-02T20:00:00+08:00'
const domain = createExtractDomain({})
/** 既有核心:以 emptyState＋applyDelta 造(先前一批筆記 s0 之提煉結果),並落帳(s0 入 consumed,使不變式「出處必為已用筆記」成立) */
const SEED_BATCH = [{ code: 'N0', id: 's0' }]
const seed = (ops, at = AT) => seedCore({ coreId: 'm', concept: '動量', ops, batch: SEED_BATCH, at, msg: '既有核心之差量須全數套用' })
const baseState = () => seed([
    { op: 'add', ref: 'a', kind: 'principle', text: '投資人對資訊反應不足，使價格緩慢反映消息', basis: '實證', sources: ['N0'] },
    { op: 'add', kind: 'principle', text: '動量報酬在空頭反轉期常出現崩潰，需搭配風險控管', basis: '實證', sources: ['N0'] },
    { op: 'add', kind: 'pitfall', text: '交易成本高時淨報酬消失', basis: '實證', sources: ['N0'] },
    { op: 'essence', text: '動量是贏家續贏之傾向。', claims: ['@a'], reason: '首版' },
])
const BATCH = [
    { code: 'N1', id: 'n1', digest: '### N1 動量與反應不足\n【核心知識】實證顯示投資人對盈餘消息反應不足，動量報酬可持續 3 到 12 個月。' },
    { code: 'N2', id: 'n2', digest: '### N2 動量崩潰\n【核心知識】動量策略在市場由空頭反轉向上時出現大幅虧損，波動率縮放可降低崩潰損失。' },
]
const NOTES = new Map([['n1', { id: 'n1', evidenceLevel: '高', claimType: '實證研究', docId: 'd1' }], ['n2', { id: 'n2', evidenceLevel: '中', claimType: '實證研究', docId: 'd2' }]])
// 3+3 之席位、合檢定標準之標注(ANN)與單一 pass 之替身(依席位 use 回覆;'fail' 失敗、'budget' 上游預算耗盡)取共用件(test/tools/extractKit)。
//   本檔替身起草之新增主張皆只引單篇筆記——principle 須存活出處來自相異文件 ≥2(ES12),單篇者故為 rule;不合標準之操作會成程式意見、迫使修訂棒執行並於定稿被剔
const run = (state, ai, extra = {}) => runPass({ state, concept: '動量', batch: BATCH, domain, seats: SEATS, ai, notesById: NOTES, at: AT, ...extra })
const c1Of = (s) => s.claims.find((c) => c.text.includes('反應不足'))
const crashOf = (s) => s.claims.find((c) => c.text.includes('崩潰'))

describe('unit-extract-workflow', function() {

    it('guardOps 正體(ES3 v2;與 SS3 同一定義 FOREIGN_SPAN_RE):文字欄之簡體只轉違規處並記旗標;網址內之字不轉、不計(轉了即壞連結)', () => {
        const s = baseState()
        const g = guardOps([{ op: 'add', kind: 'rule', text: '动量之后見 https://x.test/数据', sources: ['N1'], ...ANN }], { state: s })
        assert.equal(g.ops[0].text, '動量之後見 https://x.test/数据')
        assert.ok(g.flagged.some((f) => f.flag === 'simplified'))
        const u = guardOps([{ op: 'add', kind: 'rule', text: '詳見 https://x.test/数据 之說明', sources: ['N1'], ...ANN }], { state: s })
        assert.deepEqual([u.ops[0].text, u.flagged.some((f) => f.flag === 'simplified')], ['詳見 https://x.test/数据 之說明', false], '只有網址內有簡體 → 不計、不轉')
    })

    it('正常路徑:三席起草(一席失敗)→ 整合(via)→ 審計無意見略過修訂 → 終審 → 套用;新增、確認、交代、證據', async () => {
        const s = baseState()
        const c1 = c1Of(s)
        const ai = fakeAi({
            d1: { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', basis: '實證', sources: ['N1'], ...ANN }, { op: 'confirm', id: c1.id, sources: ['N1'] }], skipped: [] },
            d2: { ops: [{ op: 'add', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] },
            d3: 'fail',
            int: (p) => {
                assert.ok(p.includes('a1_1') && p.includes('a2_1'), '整合提示詞列出候選操作 id')
                return { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', basis: '實證', sources: ['N1'], ...ANN, via: ['a1_1', 'a2_1'] }, { op: 'confirm', id: c1.id, sources: ['N1'], via: ['a1_2'] }, { op: 'confirm', id: crashOf(s).id, sources: ['N2'], via: ['a1_2'] }], skipped: [] }
            },
            aud: { issues: [] },
            acc: keepAll,
        })
        const r = await run(s, ai)
        assert.equal(r.ok, true, r.error)
        assert.deepEqual(ai.seen, ['d1', 'd2', 'd3', 'int', 'aud', 'acc'], '審計無意見→修訂略過')
        const added = r.state.claims.find((c) => c.text.startsWith('盈餘消息'))
        assert.ok(added && added.sources.includes('n1'))
        assert.ok(findItem(r.state, c1.id).item.sources.includes('n1'), '既有主張被確認、累積出處')
        assert.equal(r.applied.filter((a) => a.op === 'confirm').length, 1, '第二個 confirm 之出處 N2 不在 via 所引候選之出處內 → 整合拒收')
        assert.ok(r.coverage.used.includes('n1'))
        assert.ok(r.coverage.uncovered.includes('n2'), 'N2 未被合法引用 → 未涵蓋(下次重送)')
        assert.equal(r.stats.candidates, 2)
        assert.ok(added.evidence.level, '證據等級由程式重算')
    })

    it('整合失敗 → 程式聯集(保留單票者),續跑 B 段', async () => {
        const s = baseState()
        const ai = fakeAi({
            d1: { ops: [{ op: 'add', kind: 'pitfall', text: '空頭反轉期動量崩潰造成大幅虧損', sources: ['N2'], critique: ANN.critique, conditions: ['空頭反轉向上之市場'] }], skipped: [] },
            d2: { ops: [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] },
            d3: { ops: [], skipped: [{ note: 'N1', reason: '無可用知識' }] },
            int: 'fail',
            aud: { issues: [] },
            acc: keepAll,
        })
        const r = await run(s, ai)
        assert.equal(r.ok, true, r.error)
        assert.ok(r.degrade.some((d) => d.includes('程式聯集')))
        assert.equal(r.applied.filter((a) => a.op === 'add').length, 2, '兩條單票知識皆保留')
    })

    it('單棒未送出(workflow/aiCall):席位未設 → 記「席位未設」(不誤報為放不下);整條鏈放不下 → 記「整條遞補鏈皆放不下此提示詞」——皆入 calls 軌跡與逐棒回呼,降級梯照走', async () => {
        const s = baseState()
        const h = {
            d1: { ops: [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] },
            d2: { ops: [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] },
            d3: 'fail', aud: { issues: [] }, acc: keepAll,
        }
        const entries = []
        const unset = await run(s, fakeAi(h), { seats: { ...SEATS, integrate: null }, onCall: (e) => entries.push(e) })
        assert.equal(unset.ok, true, unset.error)
        assert.deepEqual(unset.calls.find((c) => c.stage === 'integrate'), { stage: 'integrate', ok: false, error: '席位未設', promptLen: unset.calls.find((c) => c.stage === 'integrate').promptLen })
        assert.ok(unset.degrade.includes('整合失敗（席位未設）：改用程式聯集'), unset.degrade.join('；'))
        assert.ok(entries.some((e) => e.stage === 'integrate' && e.error === '席位未設'), '逐棒回呼亦記')
        const ai = fakeAi(h)
        const big = await run(s, { ...ai, seatSpec: (seat, len) => (seat.use === 'int' ? null : ai.seatSpec(seat, len)) })
        assert.equal(big.calls.find((c) => c.stage === 'integrate').error, '整條遞補鏈皆放不下此提示詞')
        assert.ok(big.degrade.includes('整合失敗（oversize）：改用程式聯集'), big.degrade.join('；'))
        assert.equal(ai.seen.includes('int'), false, '放不下者不送')
        // 起草三席:皆未設 vs 皆放不下(兩種問題分開說)
        assert.equal((await run(s, fakeAi(h), { seats: { ...SEATS, drafters: [null, null, null] } })).error, '起草席位未設')
        const ai2 = fakeAi(h)
        assert.equal((await run(s, { ...ai2, seatSpec: () => null })).error, '三席起草皆放不下提示詞')
        assert.deepEqual(ai2.seen, [], '皆不送')
    })

    it('斷網(調度層標 netDown;整鏈皆敗且本機網路不通)→ 視同截止(stopped,不計失敗、不走降級梯):起草三席皆斷網、或後段一棒斷網', async () => {
        const s = baseState()
        const ok = { ops: [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] }
        const ai = fakeAi({ d1: ok, d2: ok, d3: ok, aud: { issues: [] }, acc: keepAll })
        const wkf = ai.getWkf()
        // 三席皆斷網:調度層之 runFanout 整體回 ok:false＋netDown(扇出層之旗標;共用件 seatAi 之值為逐席,故此處另以扇出層之形狀覆寫)
        const down = { ok: false, skipped: true, netDown: true, error: '整鏈皆敗', tried: [] }
        const allDown = await run(s, { ...ai, getWkf: () => ({ ...wkf, runFanout: async ({ agents }) => ({ ok: false, netDown: true, agents: agents.map(() => ({ ...down })) }) }) })
        assert.deepEqual([allDown.ok, allDown.stopped, allDown.error], [false, true, 'stopped'], '三席皆斷網:截止,不是「起草全敗」')
        // 後段一棒斷網:共用件 seatAi 之 'netDown'(該席整鏈皆敗且本機網路不通)
        const auditDown = await run(s, fakeAi({ d1: ok, d2: ok, d3: ok, aud: 'netDown', acc: keepAll }))
        assert.deepEqual([auditDown.ok, auditDown.stopped], [false, true], '審計斷網:截止,不以程式意見續跑')
    })

    it('修訂補丁:中嚴重度不得移除建設性操作;高嚴重度離題可;改寫須保有過半', async () => {
        const s = baseState()
        const text = '動量報酬可持續 3 到 12 個月'
        const mk = () => ({ ops: [{ op: 'add', kind: 'rule', text, sources: ['N1'], ...ANN }], skipped: [] })
        const base = { d1: mk(), d2: mk(), d3: mk(), int: { ops: [{ op: 'add', kind: 'rule', text, sources: ['N1'], ...ANN, via: ['a1_1'] }], skipped: [] }, acc: keepAll }
        // 整合後之操作 id 為 i_n(審計、修訂之提示詞所列者;候選之 a{席}_{n} 只在整合前有效)
        const mid = await run(s, fakeAi({ ...base, aud: { issues: [{ ref: 'i_1', severity: '中', type: '離題', detail: 'x' }] }, rev: { removes: [{ ref: 'i_1', issue: 0 }] } }))
        assert.equal(mid.applied.filter((a) => a.op === 'add').length, 1, '中嚴重度之移除被擋下')
        assert.equal(mid.stats.patch.blocked, 1)
        const high = await run(s, fakeAi({ ...base, aud: { issues: [{ ref: 'i_1', severity: '高', type: '離題', detail: 'x' }] }, rev: { removes: [{ ref: 'i_1', issue: 0 }] } }))
        assert.equal(high.applied.filter((a) => a.op === 'add').length, 0, '高嚴重度離題可移除')
        const rewrite = await run(s, fakeAi({ ...base, aud: { issues: [{ ref: 'i_1', severity: '中', type: '空話', detail: 'x' }] }, rev: { edits: [{ ref: 'i_1', fields: { text: '完全不同的一句話' }, issue: 0 }] } }))
        assert.ok(rewrite.state.claims.some((c) => c.text === text), '改寫未保有過半 → 不採,原文保留')
    })

    it('終審:剔除建設性操作須高嚴重度;剔除破壞性操作一律放行;終審失敗則破壞性操作存待審', async () => {
        const s = baseState()
        const crash = crashOf(s)
        const ops = [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }, { op: 'supersede', id: crash.id, reason: '新證據顯示波動率縮放可降低崩潰', validPeriod: '較早之研究', sources: ['N2'] }]
        const base = { d1: { ops, skipped: [] }, d2: { ops, skipped: [] }, d3: 'fail', int: { ops: ops.map((x, k) => ({ ...x, via: [`a1_${k + 1}`] })), skipped: [] }, aud: { issues: [] } }
        const blocked = await run(s, fakeAi({ ...base, acc: { verdicts: [{ i: 0, action: 'drop', reason: '離題' }, { i: 1, action: 'drop', reason: '無出處支持' }] } }))
        assert.equal(blocked.stats.verdictBlocked, 1, '建設性之剔除被擋(無高嚴重度意見)')
        assert.ok(blocked.state.claims.some((c) => c.text.startsWith('動量報酬可持續')))
        assert.equal(findItem(blocked.state, crash.id).item.status, 'active', '破壞性之剔除放行＝既有知識保住')
        const failed = await run(s, fakeAi({ ...base, acc: 'fail' }))
        assert.ok(failed.degrade.some((d) => d.includes('終審失敗')))
        assert.equal(findItem(failed.state, crash.id).item.status, 'active', '終審失敗時不套破壞性操作')
        assert.equal(failed.state.pendingReview.length, 1, '存入待審')
        assert.ok(failed.state.claims.some((c) => c.text.startsWith('動量報酬可持續')), '建設性照套')
    })

    it('守門:材料沒有之數字拒收;只見索引行之條目不得改狀態(confirm 例外)', async () => {
        const s = baseState()
        const c1 = c1Of(s)
        const ops = [{ op: 'add', kind: 'rule', text: '動量年化報酬高達 30%', sources: ['N1'], ...ANN }, { op: 'revise', id: c1.id, fields: { text: '投資人反應不足' }, reason: 'r', sources: ['N1'] }, { op: 'confirm', id: c1.id, sources: ['N1'] }]
        const ai = fakeAi({ d1: { ops, skipped: [] }, d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: keepAll })
        const r = await run(s, ai, { promptBudget: 10 })
        assert.equal(r.ok, true, r.error)
        assert.equal(r.view.full, false)
        assert.equal(r.applied.filter((a) => a.op === 'add').length, 0, '30% 不在材料 → 拒')
        assert.equal(r.applied.filter((a) => a.op === 'revise').length, 0, '不可見條目之修訂 → 拒')
        assert.equal(r.applied.filter((a) => a.op === 'confirm').length, 1, 'confirm 不受可見性限制')
    })

    it('stateView:放得下給全文;放不下時相關條目優先', () => {
        const s = baseState()
        const full = stateView(s, '崩潰', (d) => d.length, 1e9)
        assert.equal(full.full, true)
        const tight = stateView(s, '動量策略崩潰風險控管', (d) => d.length, 150)
        assert.equal(tight.full, false)
        assert.ok(tight.visible.has(crashOf(s).id) || tight.visible.size === 0)
        // 預算恰容一條全文 → 給與本批最相關之條目(崩潰),其餘列索引
        const crash = crashOf(s).id
        const one = stateView(s, '動量策略崩潰風險控管', (d) => d.length, stateDigest(s, { only: new Set([crash]) }).length)
        assert.deepEqual([one.full, [...one.visible]], [false, [crash]], '只放得下一條全文 → 相關條目優先')
        assert.match(one.digest, /〔C1〕（索引）/)
    })

    it('relationContextRows:只列觸及本批之邊、衝突在前並標記、同對去重、非本批者標是否核心已引;衝突型未給即拋(不退回預設詞彙)', () => {
        const codeOf = (id) => ({ n1: 'N1', n2: 'N2' })[id] || ''
        const rows = relationContextRows([
            { from: 'n1', to: 'x9', type: '延伸深化', reason: '延伸' },
            { from: 'n1', to: 'n2', type: '衝突或反例', reason: '結論相反' },
            { from: 'n2', to: 'n1', type: '衝突或反例', reason: '重複之反向邊' },
            { from: 'x8', to: 'x9', type: '衝突或反例', reason: '與本批無關' },
        ], { codeOf, titleOf: (id) => ({ x9: '舊研究' })[id] || '', cited: new Set(['x9']), conflictType: '衝突或反例' })
        assert.deepEqual(rows.map((r) => r.line), ['- N1 ↔ N2〔衝突或反例；衝突〕：結論相反', '- N1 ↔ 〈舊研究〉（核心已引）〔延伸深化〕：延伸'])
        assert.deepEqual(relationContextRows([], { codeOf, conflictType: '衝突或反例' }), [])
        for (const ctx of [{ codeOf }, { codeOf, conflictType: '' }, undefined]) assert.throws(() => relationContextRows([], ctx), /relationContextRows 需要 ctx\.conflictType/)
    })

    it('relationContextRows linked(extract.relationTypes \'linked\'):非衝突型只列兩端皆在本批或核心已引者;衝突型不受限', () => {
        const codeOf = (id) => ({ n1: 'N1', n2: 'N2' })[id] || ''
        const edges = [
            { id: 'e1', from: 'n1', to: 'n2', type: '互補搭配', reason: '同屬動量' },
            { id: 'e2', from: 'n1', to: 'x9', type: '延伸深化', reason: '延伸已引' },
            { id: 'e3', from: 'n2', to: 'x7', type: '前置概念', reason: '他核心之筆記' },
            { id: 'e4', from: 'n2', to: 'x8', type: '衝突或反例', reason: '結論相反' },
        ]
        const ctx = { codeOf, titleOf: (id) => ({ x7: '他篇', x8: '反方', x9: '舊研究' })[id] || '', cited: new Set(['x9']), conflictType: '衝突或反例' }
        const linked = relationContextRows(edges, { ...ctx, linked: true })
        assert.deepEqual(linked.map((r) => r.id).sort(), ['e1', 'e2', 'e4'], '他端非本批亦非已引之非衝突邊(e3)不列;衝突邊(e4)照列')
        assert.equal(linked[0].id, 'e4', '衝突在前')
        assert.deepEqual(relationContextRows(edges, ctx).map((r) => r.id).sort(), ['e1', 'e2', 'e3', 'e4'], '未給 linked＝全列(all)')
    })

    it('ref 閉包:整合漏收定義 @ref 之新條目時自候選取回;整合員改收合併版者以別名指回;漏寫 @ 者補回', () => {
        const cands = [{ seat: 1, ops: [{ op: 'add', ref: 'a1_x', kind: 'principle', text: '甲', sources: ['N1'], _oid: 'a1_1' }, { op: 'add', ref: 'a1_y', kind: 'rule', text: '乙', sources: ['N2'], _oid: 'a1_2' }] }]
        const pulled = closeRefs([{ op: 'dispute_add', question: 'q', sides: [{ position: 'p', claims: ['@a1_x'] }, { position: 'r', sources: ['N2'] }], _oid: 'i_1', _via: ['a1_3'] }], cands)
        assert.deepEqual(pulled.ops.map((o) => o._oid), ['i_1', 'a1_1'], '定義操作自候選取回')
        assert.equal(pulled.ops[1]._closure, true)
        const twin = closeRefs([{ op: 'add', ref: 'i_merged', kind: 'principle', text: '甲（合併）', _oid: 'i_1', _via: ['a1_1', 'a2_1'] }, { op: 'param_add', name: 'k', value: '1', claim: '@a1_x', _oid: 'i_2', _via: ['a1_4'] }], cands)
        assert.equal(twin.ops.length, 2, '合併版已收 → 不重複取回')
        assert.equal(twin.ops[1].claim, '@i_merged', '別名指回整合員之合併版')
        const bare = normalizeBareRefs([{ op: 'essence', text: 't', claims: ['a1_y', 'C3'] }], new Set(['a1_y']))
        assert.deepEqual(bare[0].claims, ['@a1_y', 'C3'], '已知 ref 名補 @,既有條目編號不動')
    })

    it('補丁容錯:revise 之內容欄改入其 fields 且仍守過半;param_add 之 note→conditions;adds 缺 op 依欄位推定;略過不在 ops', () => {
        const ops = [{ op: 'revise', id: 'C1', fields: { text: '動量報酬可持續 3 到 12 個月' }, reason: 'r', _oid: 'i_1' }, { op: 'param_add', name: '回看期', value: '12 個月', _oid: 'i_2' }]
        const issues = normalizeIssues([{ ref: 'i_1', severity: '中', type: '遺漏', detail: 'd' }])
        const p = applyPatch(ops, { edits: [{ ref: 'i_1', fields: { text: '動量報酬可持續 3 到 12 個月，空頭反轉後例外', conditions: ['空頭反轉後例外'] } }, { ref: 'i_2', fields: { note: '形成期' } }], adds: [{ op: { kind: 'pitfall', text: '交易成本侵蝕', sources: ['N1'] }, issue: 0 }] }, { state: null, issues })
        assert.deepEqual(p.log.map((x) => x.ok), [true, true, true], JSON.stringify(p.log))
        assert.equal(p.ops[0].fields.text, '動量報酬可持續 3 到 12 個月，空頭反轉後例外')
        assert.deepEqual(p.ops[0].fields.conditions, ['空頭反轉後例外'])
        assert.equal(p.ops[1].conditions, '形成期')
        assert.equal(p.ops[2].op, 'add')
        const bad = applyPatch(ops, { edits: [{ ref: 'i_1', fields: { text: '完全不同的一句話' } }] }, { state: null, issues })
        assert.equal(bad.log[0].ok, false, 'revise 之改寫同樣須保有原文過半')
        assert.equal(inferOp({ name: 'n', value: 1 }).op, 'param_add')
        assert.equal(inferOp({ text: '只有文字' }).op, undefined, '推定不了者原樣(仍以「新增缺 op」拒收)')
        const nd = normalizeDelta({ ops: [{ op: 'skipped', note: 'N3', reason: '離題' }, { op: 'add', text: 'x' }], skipped: [] })
        assert.deepEqual(nd.ops.map((o) => o.op), ['add'])
        assert.deepEqual(nd.skipped, [{ note: 'N3', reason: '離題' }])
    })

    it('整合漏收定義之新條目:runPass 自候選取回,引用它之爭議得以成立', async () => {
        const s = baseState()
        const c1 = c1Of(s)
        const cand = { ops: [{ op: 'add', ref: 'g', kind: 'rule', text: '動量報酬在空頭反轉期仍可持續', basis: '樣本內', sources: ['N2'], ...ANN }, { op: 'dispute_add', question: '動量在空頭反轉期是否持續', sides: [{ position: '反應不足使動量持續', claims: [c1.id] }, { position: '空頭反轉期仍可持續', claims: ['@g'], sources: ['N2'] }], sources: ['N2'] }], skipped: [] }
        const r = await run(s, fakeAi({ d1: cand, d2: cand, d3: 'fail', int: { ops: [{ ...cand.ops[1], sides: [{ position: '反應不足使動量持續', claims: [c1.id] }, { position: '空頭反轉期仍可持續', claims: ['@a1_g'], sources: ['N2'] }], via: ['a1_2', 'a2_2'] }], skipped: [] }, aud: { issues: [] }, acc: keepAll }))
        assert.equal(r.ok, true, r.error)
        assert.equal(r.stats.closure, 1)
        assert.equal(r.state.disputes.filter((d) => d.origin === 'note').length, 1, '爭議成立')
        assert.ok(r.state.claims.some((c) => c.text === '動量報酬在空頭反轉期仍可持續'), '被引用之新主張一併收入')
    })

    it('integrate:program 不呼叫整合員、改程式聯集;candidates 沿用前次起草(不再起草)——同一份起草只差整合方式', async () => {
        const s = baseState()
        const d = { ops: [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] }
        const llm = await run(s, fakeAi({ d1: d, d2: d, d3: 'fail', int: { ops: [{ ...d.ops[0], via: ['a1_1', 'a2_1'] }], skipped: [] }, aud: { issues: [] }, acc: keepAll }))
        assert.equal(llm.ok, true, llm.error)
        assert.equal(llm.stats.integrateMode, 'llm')
        const ai = fakeAi({ aud: { issues: [] }, acc: keepAll })
        const prog = await run(s, ai, { integrate: 'program', candidates: llm.trace.cands })
        assert.equal(prog.ok, true, prog.error)
        assert.deepEqual(ai.seen, ['aud', 'acc'], '不起草、不整合;只跑 B 段')
        assert.equal(prog.stats.integrateMode, 'program')
        assert.equal(prog.stats.reusedCandidates, true)
        assert.equal(prog.degrade.length, 0, '程式整合是指定之整合方式,不是降級')
        assert.equal(prog.applied.filter((a) => a.op === 'add').length, 1, '兩份相同候選合為一條')
    })

    it('裸寫之既有條目編號補〔〕:只收 C／D／P 且須既有;Q、已加括號、不存在者不動', () => {
        const s = baseState()
        const id = c1Of(s).id
        const o = bracketRefs({ op: 'add', text: `屬 ${id} 範疇；Q1 營收；〔${id}〕；C999`, conditions: [`見 ${id}`], sides: [{ position: `同 ${id}` }] }, s)
        assert.equal(o.text, `屬 〔${id}〕 範疇；Q1 營收；〔${id}〕；C999`)
        assert.deepEqual(o.conditions, [`見 〔${id}〕`])
        assert.equal(o.sides[0].position, `同 〔${id}〕`)
    })

    // ── 長度上限:整合之本質逾硬上限 220 時先列為程式意見交修訂縮寫;不處理則套用時整條被拒,新核心落得無本質──
    const SENT = '動量來自投資人對消息之反應不足〔@x〕。' // 20 字
    const essenceCase = (essText, rev) => {
        const add = { op: 'add', ref: 'x', kind: 'rule', text: '投資人對盈餘消息反應不足使動量持續', sources: ['N1'], ...ANN }
        const ess = { op: 'essence', text: essText, reason: '綜合本批', claims: ['@x'] }
        // 整合不得改變操作種類(終審 §3 D5i):本質須指回候選之本質(起草者各出一份)
        const d = { ops: [add, ess], skipped: [] }
        return fakeAi({
            d1: d, d2: d, d3: 'fail',
            int: { ops: [{ ...add, via: ['a1_1', 'a2_1'] }, { ...ess, via: ['a1_2', 'a2_2'] }], skipped: [] },
            aud: { issues: [{ ref: 'i_2', severity: '中', type: '其他', detail: '本質未綜合 @x 之條件', fix: '補一句' }] },
            rev,
            acc: keepAll,
        })
    }

    it('超限:整合之本質逾硬上限 → 程式意見(超限)排在審計意見之前交修訂;新核心定稿前仍超限 → 截至句界,本質不落空', async () => {
        const long = SENT.repeat(13) // 260 字
        const ai = essenceCase(long, (p) => {
            assert.ok(p.includes('超限') && p.includes('essence 過長（260 字，上限 220）'), '修訂提示詞含程式之超限意見')
            return { edits: [{ ref: 'i_2', fields: { text: long + SENT }, issue: 1 }] } // 再補一句(原本就超限 → 不在補丁閘擋)
        })
        const r = await run({ ...baseState(), essence: { text: '', claims: [], sources: [], at: '' } }, ai)
        assert.equal(r.ok, true, r.error)
        assert.equal(r.trace.issues[0].type, '超限', '程式意見在前(k=0)')
        assert.equal(r.trace.issues[0].ref, 'i_2')
        assert.ok(r.trace.essenceTrim && r.trace.essenceTrim.from === 280 && r.trace.essenceTrim.to <= 220, JSON.stringify(r.trace.essenceTrim))
        assert.ok(r.state.essence.text && r.state.essence.text.length <= 220 && r.state.essence.text.endsWith('。'), '新核心有本質,且落在句界')
        assert.ok(!r.rejected.some((x) => x.op === 'essence'), '本質未被拒收')
    })

    it('超限:補丁使本質由合格變超限 → 不採(保留原稿);既有核心之本質超限不截(既有本質仍在)', async () => {
        const ok200 = SENT.repeat(10) // 200 字
        const r = await run({ ...baseState(), essence: { text: '', claims: [], sources: [], at: '' } }, essenceCase(ok200, { edits: [{ ref: 'i_2', fields: { text: ok200 + SENT + SENT }, issue: 0 }] }))
        assert.equal(r.ok, true, r.error)
        assert.ok(r.trace.patchLog.some((x) => !x.ok && x.why.startsWith('補丁使本條超限（essence 過長（240 字')), JSON.stringify(r.trace.patchLog))
        assert.equal(r.state.essence.text.length, 200, '保留修訂前之合格本質')
        const s = baseState() // 既有核心:本質「動量是贏家續贏之傾向。」(seed 之 essence)
        assert.equal(s.essence.text, '動量是贏家續贏之傾向。')
        const long = SENT.repeat(13)
        const r2 = await run(s, essenceCase(long, { edits: [] }))
        assert.equal(r2.ok, true, r2.error)
        assert.equal(r2.trace.essenceTrim, undefined, '既有核心不截')
        assert.ok(r2.rejected.some((x) => x.op === 'essence' && x.reason.startsWith('essence 過長')), '超限之新本質被拒收')
        assert.equal(r2.state.essence.text, '動量是贏家續贏之傾向。', '既有本質仍在')
    })

    it('超限判準與 applyDelta 同一來源:opLengthProblem 之字樣即拒收理由;trimToLimit 取句界、逗號、不切斷〔〕', () => {
        assert.equal(opLengthProblem({ op: 'essence', text: '甲'.repeat(221) }), 'essence 過長（221 字，上限 220）')
        assert.equal(opLengthProblem({ op: 'essence', text: '甲'.repeat(220) }), '')
        assert.equal(opLengthProblem({ op: 'add', text: '乙'.repeat(181) }), 'text 過長（181 字，上限 90）', '文字欄逾上限 2 倍即拒')
        assert.equal(opLengthProblem({ op: 'add', text: '乙'.repeat(180) }), '', '1～2 倍放行(計數)')
        assert.equal(opLengthProblem({ op: 'revise', id: 'P3', fields: { value: '丙'.repeat(121) } }), 'value 過長（121 字，上限 60）', 'revise 依目標種類取欄位表')
        assert.equal(opLengthProblem({ op: 'dispute_add', question: 'q', sides: [{ position: '丁'.repeat(181) }, { position: 'x' }] }), 'position 過長（181 字，上限 90）')
        assert.equal(opLengthProblem({ op: 'question_add', text: '戊'.repeat(181) }), 'text 過長（181 字，上限 90）')
        assert.equal(opLengthProblem({ op: 'retract', id: 'C1' }), '', '未涵蓋之操作回空(以 applyDelta 為準)')
        assert.equal(opLengthProblem({ op: 'essence', text: '甲'.repeat(150) }, { essence: 100 }), 'essence 過長（150 字，上限 100）', 'limits 逐鍵覆寫')
        const s = baseState()
        const ap = applyDelta(s, { ops: [{ op: 'question_add', text: '戊'.repeat(181) }] }, { batch: [{ code: 'N1', id: 'n1' }], mode: 'delta', at: AT })
        assert.equal(ap.rejected[0]?.reason, opLengthProblem({ op: 'question_add', text: '戊'.repeat(181) }), '與 applyDelta 拒收理由同字樣')
        assert.equal(trimToLimit('甲乙。丙丁戊。', 5), '甲乙。')
        assert.equal(trimToLimit('甲乙，丙丁戊己庚', 5), '甲乙。', '無句界取逗號(改為句號)')
        assert.equal(trimToLimit('甲乙丙〔@ab〕丁', 5), '甲乙丙', '硬截不切斷〔〕標記')
        assert.equal(trimToLimit('短句。', 220), '短句。')
        assert.deepEqual(lengthIssues([{ op: 'essence', _oid: 'i_9', text: '甲'.repeat(230) }, { op: 'add', _oid: 'i_1', text: 'ok' }], {}).map((x) => [x.ref, x.type]), [['i_9', '超限']])
    })

    it('嚴格解析:前言之 [3] 不會被當成結果', () => {
        assert.equal(replyObjectOf('依意見 [3] 修改：{"edits":[{"ref":"a1_1"}]}', ['edits']).edits[0].ref, 'a1_1')
        assert.equal(replyObjectOf('[3]', ['edits']), null)
        assert.equal(replyObjectOf("{'ops': [],}", ['ops']).ops.length, 0, 'JSON5 容錯')
    })

    it('取最後一個合格者:自我更正取後者;末個不過 accept 即往前取;含鍵之物件其內之物件不另列;不含鍵之外包物件往其內找;各棒解析器帶入自己的 check', () => {
        const fix = '{"ops":[{"op":"add","text":"a"}],"skipped":[]}\n等等，更正如下：\n{"ops":[{"op":"add","text":"a"},{"op":"confirm","id":"C1"}],"skipped":[]}'
        assert.equal(replyObjectOf(fix, ['ops']).ops.length, 2, '未給 accept:最後一個含鍵者')
        assert.equal(parseDraft(fix).ops.length, 2, 'parseDraft 取更正後之那段')
        const tailBad = '{"ops":[{"op":"add","text":"a"}]}\n補充：{"ops":"無"}'
        assert.equal(replyObjectOf(tailBad, ['ops']).ops, '無', '未給 accept:取最後一個含鍵者(交呼叫端之 check 判不合格)')
        assert.equal(parseDraft(tailBad).ops.length, 1, '末個不過 checkDraft → 往前取')
        assert.equal(checkDraft(parseDraft(tailBad)), true)
        assert.deepEqual(replyObjectOf('{"edits":[{"ref":"a","edits":[]}]}', ['edits']).edits, [{ ref: 'a', edits: [] }], '含鍵之物件整段為一個候選,其內含鍵之物件不另列')
        assert.deepEqual(replyObjectOf('{"result":{"verdicts":[1]}}', ['verdicts']), { verdicts: [1] }, '外包物件不含鍵:往其內找')
        assert.deepEqual(parseVerdicts('{"verdicts":[{"ref":"x"}]} 註：{"verdicts":"略"}').verdicts, [{ ref: 'x' }])
        assert.equal(parseAudit('{"issues":[]} 另 {"issues":null}').issues.length, 0)
        assert.deepEqual(parsePatch('{"edits":[{"ref":"a"}]}\n修正：{"edits":[{"ref":"b"}]}').edits, [{ ref: 'b' }])
        assert.equal(replyObjectOf('{"ops":[]}', ['ops'], () => {
            throw new Error('壞了')
        }).ops.length, 0, 'accept 拋錯視同不合格,皆不過即取最後一個含鍵者')
        assert.equal(replyObjectOf('{"ops":[]}', ['ops'], () => 1).ops.length, 0, 'accept 須嚴格 true;皆不過即取最後一個含鍵者')
    })

    it('截止感知:給了 shouldStop 時,上游 budget 且剩餘不足一次嘗試、或 shouldStop 為真 → 整個 pass 回 stopped、不套用;未給者 budget 只是該棒失敗(整合失敗走程式聯集)', async () => {
        const drafts = {
            d1: { ops: [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] },
            d2: { ops: [{ op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] },
            d3: 'fail',
            aud: { issues: [] },
            acc: keepAll,
        }
        // ①整合 budget、剩餘 1 秒(< 席位 minAttemptMs 預設 20 秒)、未逾期 → stopped(不改走程式聯集落盤:截止不是整合失敗)
        const a = fakeAi({ ...drafts, int: 'budget' })
        const ra = await run(baseState(), a, { shouldStop: () => false, remainingMs: () => 1000 })
        assert.deepEqual([ra.ok, ra.stopped], [false, true], JSON.stringify({ error: ra.error, degrade: ra.degrade }))
        assert.deepEqual(a.seen, ['d1', 'd2', 'd3', 'int'], '整合之後不再開棒')
        // ②同樣 budget 但剩餘充裕(席位自帶預算用盡,非整輪截止)→ 不是截止:整合失敗走程式聯集,照常套用
        const b = fakeAi({ ...drafts, int: 'budget' })
        const rb = await run(baseState(), b, { shouldStop: () => false, remainingMs: () => 600_000 })
        assert.equal(rb.ok, true, rb.error)
        assert.ok(rb.degrade.some((d) => d.includes('程式聯集')))
        // ③未給 shouldStop(非截止感知):budget 只是該棒失敗
        const c = fakeAi({ ...drafts, int: 'budget' })
        const rc = await run(baseState(), c)
        assert.equal(rc.ok, true)
        assert.ok(rc.degrade.some((d) => d.includes('程式聯集')))
        // ④shouldStop 於整合後轉真 → stopped(不開審計)
        let stop = false
        const d = fakeAi({ ...drafts, int: () => {
            stop = true
            return { ops: [], skipped: [] }
        } })
        const rd = await run(baseState(), d, { shouldStop: () => stop })
        assert.deepEqual([rd.ok, rd.stopped], [false, true])
        assert.ok(!d.seen.includes('aud'), '截止後不開審計')
        // ⑤三席起草全 budget 且剩餘不足 → stopped(非「起草全敗」);剩餘充裕 → 起草全敗
        const e = fakeAi({ d1: 'budget', d2: 'budget', d3: 'budget' })
        const se = baseState()
        const re = await run(se, e, { shouldStop: () => false, remainingMs: () => 1000 })
        assert.deepEqual([re.ok, re.stopped, re.state], [false, true, se], '失敗一律帶 state(輸入狀態;終審 D9)')
        const f = fakeAi({ d1: 'budget', d2: 'budget', d3: 'budget' })
        const sf = baseState()
        const rf = await run(sf, f, { shouldStop: () => false, remainingMs: () => 600_000 })
        assert.equal(rf.ok, false)
        assert.notEqual(rf.stopped, true)
        assert.match(String(rf.error), /起草全敗/)
        assert.ok(rf.state === sf && Array.isArray(rf.calls) && Array.isArray(rf.degrade) && rf.stats && rf.trace, '失敗之形狀:state、calls、degrade、stats、trace')
    })

    it('不變式剔除之日誌列出被剔之操作與編號(可見性):log 收到「提煉不變式剔除[…]：op〔id〕（違反）」,trace.invariantDropped 可查', async () => {
        const s = baseState()
        const c1 = c1Of(s)
        // 取代本質所引之主張且 by 指向不存在之新項 → 本質改指 null、標 stale 而不違反;另造一個會違反者:retract 被爭議引用…
        // 以「supersede 既有主張並把 by 指向同批之新項」為合法路徑,再以 fix 把 by 改掉造成違反過於曲折;改驗守門可觀察之產物:日誌格式
        const lines = []
        const ai = fakeAi({
            d1: { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', basis: '實證', sources: ['N1'], ...ANN }, { op: 'supersede', id: c1.id, by: '@x', reason: '新研究', validPeriod: '較早之研究', sources: ['N1'] }], skipped: [] },
            d2: 'fail',
            d3: 'fail',
            int: (p) => ({ ops: [{ op: 'add', ref: 'x', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', basis: '實證', sources: ['N1'], ...ANN, via: ['a1_1'] }, { op: 'supersede', id: c1.id, by: '@x', reason: '新研究', validPeriod: '較早之研究', sources: ['N1'], via: ['a1_2'] }], skipped: [] }),
            aud: { issues: [] },
            acc: { verdicts: [{ i: 1, action: 'keep' }] },
        })
        const r = await run(s, ai, { log: (l) => lines.push(l) })
        assert.equal(r.ok, true, r.error)
        assert.equal(findItem(r.state, c1.id).item.status, 'superseded', '取代被本質引用之主張可套用(本質改指／標 stale,不再觸不變式)')
        assert.ok(!lines.some((l) => /不變式剔除/.test(l)), `不應有剔除:${lines.join('\n')}`)
        assert.ok(r.state.essence.claims.includes(findItem(r.state, c1.id).item.supersededBy) || r.state.essence.stale, '本質改指 by 或標 stale')
    })

    it('終審剔除之閘門:破壞性照放;建設性只准重複或引高嚴重度離題／捏造;爭議類以「離題」剔除須有高嚴重度意見;「同篇」「非對立」不受閘門、交 applyVerdicts 轉存疑', () => {
        const s = baseState()
        const ops = [
            { _oid: 'i_0', op: 'dispute_add', question: 'q', sides: [{ position: '甲', sources: ['N1'] }, { position: '乙', sources: ['N2'] }] },
            { _oid: 'i_1', op: 'add', kind: 'rule', text: 't', sources: ['N1'] },
            { _oid: 'i_2', op: 'retract', id: s.claims[2].id, reason: '離題' },
            { _oid: 'i_3', op: 'contest', id: s.claims[0].id, dispute: 'D9', side: 0, reason: 'r', sources: ['N1'] },
        ]
        const high = [{ k: 0, ref: 'i_0', severity: '高', type: '離題', detail: 'x', fix: '' }]
        // 爭議類以「同篇」剔除(無意見)不得被閘門擋成 keep——須與 applyVerdicts、終審提示詞所述「可以同篇剔除」一致
        const g1 = gateVerdicts(ops, [{ i: 0, action: 'drop', reason: '同篇', note: '兩方皆出自同一研究' }], { state: s, issues: [] })
        assert.deepEqual([g1.blocked, g1.verdicts[0].action, g1.verdicts[0].reason], [[], 'drop', '同篇'], '同篇不受閘門(交 applyVerdicts 轉存疑)')
        const av = applyVerdicts({ ops }, g1.verdicts)
        assert.deepEqual([av.dropped, av.doubted.map((x) => [x.index, x.reason, x.byDrop])], [[], [[0, '同篇', true]]])
        const g2 = gateVerdicts(ops, [{ i: 0, action: 'drop', reason: '離題' }], { state: s, issues: [] })
        assert.equal(g2.verdicts[0].action, 'keep', '爭議類以離題剔除而無高嚴重度意見 → 擋下')
        assert.match(g2.blocked[0].why, /建設性操作只准以「重複」或「高」嚴重度之離題／捏造意見移除/)
        assert.equal(gateVerdicts(ops, [{ i: 0, action: 'drop', reason: '離題' }], { state: s, issues: high }).verdicts[0].action, 'drop', '有高嚴重度離題意見 → 放行')
        assert.equal(gateVerdicts(ops, [{ i: 3, action: 'drop', reason: '非對立' }], { state: s, issues: [] }).verdicts[0].action, 'drop', '非對立不受閘門(存疑)')
        // 建設性:重複放行、無意見之離題擋下;破壞性一律放行
        assert.equal(removalAllowed(ops[1], s, [], '重複').ok, true)
        assert.equal(removalAllowed(ops[1], s, [], '離題').ok, false)
        assert.equal(removalAllowed(ops[2], s, [], '離題').ok, true)
        // 修訂之 removes 同一判準:爭議類以「同篇」移除不准(同篇為終審之存疑,不是移除理由)
        const p = applyPatch(ops, { removes: [{ ref: 'i_0', reason: '同篇' }] }, { state: s, issues: [] })
        assert.deepEqual([p.ops.length, p.log[0].ok], [4, false])
    })

    it('待審逾上限丟最舊:丟棄之提案內容隨結果回傳(pendingDroppedOps;提煉段逐項落帳)——丟棄的是提案、不是知識,落帳可查', async () => {
        // 21 條主張;待審預存 20 項(上限)撤回提案;本 pass 終審失敗 → 破壞性操作存待審 → 逾上限丟最舊(C1 之提案)
        const ops = Array.from({ length: 21 }, (_, k) => ({ op: 'add', kind: 'pitfall', text: `第${k + 1}條陷阱之說明文字`, basis: '實證', sources: ['N0'] }))
        const s0 = seed(ops)
        const pre = queuePendingReview(s0, s0.claims.slice(0, 20).map((c) => ({ resolved: { op: 'retract', id: c.id, reason: '離題' }, sources: ['s0'] })), { at: AT, reason: '終審失敗' }).state
        const last = s0.claims[20]
        const ai = fakeAi({ d1: { ops: [{ op: 'retract', id: last.id, reason: '離題', sources: ['N1'] }], skipped: [] }, d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: 'fail' })
        const r = await run(pre, ai)
        assert.equal(r.ok, true, r.error)
        assert.equal(r.pendingDropped, 1)
        assert.deepEqual(r.pendingDroppedOps.map((e) => [e.op.op, e.op.id, e.reason]), [['retract', s0.claims[0].id, '終審失敗']], '丟棄之提案內容可查')
    })

    // ─── 出處支持覆核(檢定標準 ES9;standards/supportCheck;定稿篩選之後、套用之前)───
    describe('出處支持覆核(ES9)', function() {
        const ADD = '盈餘消息反應不足使動量報酬持續 3 到 12 個月'
        const CHECK = { seats: { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } } }
        /** 覆核席替身:依斷言文字回裁決(by:{ 斷言開頭: 裁決 });理由皆合格 */
        const checker = (by) => (prompt) => ({
            checks: [...prompt.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => {
                const hit = Object.keys(by).find((k) => m[2].startsWith(k))
                const v = hit ? by[hit] : 'supported'
                return { index: Number(m[1]), verdict: v, reason: '出處之內容與斷言之關係說明' }
            }),
        })
        const pass = (s, h) => fakeAi({
            d1: { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: ADD, basis: '實證', sources: ['N1'], ...ANN }, { op: 'confirm', id: c1Of(s).id, sources: ['N1'] }], skipped: [] },
            d2: { ops: [{ op: 'add', kind: 'rule', text: ADD, sources: ['N1'], ...ANN }], skipped: [] },
            d3: 'fail',
            int: { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: ADD, basis: '實證', sources: ['N1'], ...ANN, via: ['a1_1', 'a2_1'] }, { op: 'confirm', id: c1Of(s).id, sources: ['N1'], via: ['a1_2'] }], skipped: [] },
            aud: { issues: [] },
            acc: keepAll,
            ...h,
        })

        it('兩席皆判 supported → 照套;終審之後才覆核(棒序);未給 supportCheck 時不覆核(既有各案即此)', async () => {
            const s = baseState()
            const ai = pass(s, { ck1: checker({}), ck2: checker({}) })
            const r = await run(s, ai, { supportCheck: CHECK })
            assert.equal(r.ok, true, r.error)
            assert.deepEqual(ai.seen, ['d1', 'd2', 'd3', 'int', 'aud', 'acc', 'ck1', 'ck2'])
            assert.ok(r.state.claims.some((c) => c.text === ADD))
            assert.deepEqual([r.stats.supportChecked, r.stats.supportRejected || 0, r.supportHolds], [2, 0, []])
        })

        it('兩席皆判 insufficient → 該操作不採(診斷軌跡與日誌寫明);其餘照套;引用其 ref 者寫根因', async () => {
            const s = baseState()
            const lines = []
            const ai = pass(s, { ck1: checker({ 盈餘消息: 'insufficient' }), ck2: checker({ 盈餘消息: 'insufficient' }) })
            const r = await run(s, ai, { supportCheck: CHECK, log: (l) => lines.push(l) })
            assert.equal(r.ok, true, r.error)
            assert.equal(r.state.claims.some((c) => c.text === ADD), false, '未受支持之新增不採')
            assert.ok(findItem(r.state, c1Of(s).id).item.sources.includes('n1'), '確認照套')
            assert.deepEqual([r.stats.supportRejected, r.stats.supportUndetermined, r.supportHolds], [1, 0, []])
            assert.match(r.trace.supportOut[0].why, /ES9：出處未涉及或不足以支持/)
            assert.ok(lines.some((l) => /提煉出處覆核\[動量\]：add〔x〕 ES9：出處未涉及或不足以支持——不採/.test(l)), lines.join('\n'))
        })

        it('支持之出處(⑳):新增引兩篇而兩席皆只列一篇 → 只帶支持者為出處;存量覆核之既有出處兩席皆未列 → 出處排除集(證據不計),有票未分別 → 清空', async () => {
            const s = baseState()
            const labelOf = (p, nid) => (new RegExp(`^=== 出處 (S\\d+)：${nid} ===$`, 'm').exec(p) || [])[1]
            const byOnly = (nids) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---$/gm)].map((m) => ({ index: Number(m[1]), verdict: 'supported', ...(nids ? { by: nids.map((n) => labelOf(p, n)).filter(Boolean) } : {}), reason: '出處直接陳述此斷言之內容' })) })
            const two = { op: 'add', ref: 'x', kind: 'rule', text: ADD, basis: '實證', sources: ['N1', 'N2'], ...ANN }
            const ai = pass(s, { d1: { ops: [two], skipped: [] }, d2: { ops: [{ ...two }], skipped: [] }, int: { ops: [{ ...two, via: ['a1_1', 'a2_1'] }], skipped: [] }, ck1: byOnly(['n1']), ck2: byOnly(['n1']) })
            const r = await run(s, ai, { supportCheck: CHECK })
            assert.equal(r.ok, true, r.error)
            assert.deepEqual(r.state.claims.find((c) => c.text === ADD).sources, ['n1'], '兩席皆未列之 n2 不加為出處')
            assert.equal(r.stats.supportSourcesDropped, 1)
            // 存量覆核:C1 出處 s0、n1、n2;兩席分別列 n2、n1 → s0 兩席皆未列 → 排除
            const c1 = c1Of(s)
            const r0 = applyDelta(s, { ops: [{ op: 'confirm', id: c1.id, sources: ['N1', 'N2'] }] }, { batch: BATCH, mode: 'delta', at: AT })
            const s1 = commitBatch(r0.state, coverageOf({ batch: BATCH, applied: r0.applied }))
            const go = (st, h) => runSupportStockPass({ state: st, concept: '動量', ids: [c1.id], domain, seats: CHECK.seats, ai: fakeAi(h), notesById: NOTES, contentOf: (n) => `${n} 之內容`, at: AT })
            const st = await go(s1, { ck1: byOnly(['n2']), ck2: byOnly(['n1']) })
            assert.equal(st.ok, true, st.error)
            assert.deepEqual([st.state.srcExcluded?.[c1.id]?.ids, st.stats.stockExcluded], [['s0'], 1])
            assert.deepEqual(findItem(st.state, c1.id).item.sources, ['s0', 'n1', 'n2'], '出處欄不動')
            assert.match(findItem(st.state, c1.id).item.evidence.trace, /另 1 篇經覆核判不支持，不計/)
            const st2 = await go(st.state, { ck1: byOnly(null), ck2: byOnly(['n1']) })
            assert.equal(st2.state.srcExcluded, undefined, '有一票未分別 → 不排除(以新結果取代)')
        })

        it('存量覆核(runSupportStockPass):全部受檢項皆缺票或同一供應者 → 專步層之失敗(ok:false,不逐項計次——呼叫端退避);部分 → 該項重試、其餘照處置', async () => {
            const s = baseState()
            const ids = s.claims.map((c) => c.id)
            const go = (seats, h) => runSupportStockPass({ state: s, concept: '動量', ids, domain, seats, ai: fakeAi(h), notesById: NOTES, contentOf: (n) => `${n} 之內容`, at: AT })
            // 第一、二席成交於同一家(p)
            const same = { ck1: checker({}), ck2: checker({}), ck1Provider: 'p', ck2Provider: 'p' }
            const all = await go({ first: CHECK.seats.first, second: CHECK.seats.second }, same)
            assert.deepEqual([all.ok, /全部受檢項皆缺票或同一供應者/.test(all.error), all.retry, all.state], [false, true, ids, s])
            const miss = await go({ first: CHECK.seats.first, second: CHECK.seats.second }, { ck1: checker({}), ck2: 'fail' })
            assert.deepEqual([miss.ok, miss.retry], [false, ids], '全部缺票亦然')
            // 第三席:第 1 條與之成立受支持;其餘兩條不確定 → 同一供應者 → 重試
            const part = await go(CHECK.seats, { ...same, ck3: checker({ 動量報酬: 'unsure', 交易成本: 'unsure' }) })
            assert.deepEqual([part.ok, part.retry, part.stats.stockSupported, part.stats.stockRetry], [true, ids.slice(1), 1, 2])
        })

        it('存量覆核之材料與中止(終審 §3 D5c、D5d):出處讀不到之主張不送審、不計次;中止 → 已判之頁照處置、未判留待下輪(ok、stopped、undecided)', async () => {
            const s = baseState()
            const ids = s.claims.map((c) => c.id)
            const lines = []
            // 全部主張皆引 s0;s0 讀不到 → 全部不送 → noop
            const un = await runSupportStockPass({ state: s, concept: '動量', ids, domain, seats: CHECK.seats, ai: fakeAi({ ck1: checker({}), ck2: checker({}) }), notesById: NOTES, contentOf: () => null, at: AT, log: (l) => lines.push(l) })
            assert.deepEqual([un.ok, un.noop, un.unreadable, un.stats.stockUnreadable], [true, true, ids, 3])
            assert.ok(lines.some((l) => /出處支持存量覆核\[動量\]：3 條主張之出處內容讀不到/.test(l)), lines.join('\n'))
            // 三條主張各引不同筆記、各自一頁(出處 40000 字、每頁上限 60000):第一頁兩席後截止 → 第一條照處置、其餘留待
            const three = seedCore({ coreId: 'm', concept: '動量', ops: [1, 2, 3].map((k) => ({ op: 'add', kind: 'rule', text: `主張${k}`, basis: '實證', sources: [`N${k}`], ...ANN })), batch: [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }, { code: 'N3', id: 'n3' }], at: AT })
            let n = 0
            const st = await runSupportStockPass({ state: three, concept: '動量', ids: three.claims.map((c) => c.id), domain, seats: { first: CHECK.seats.first, second: CHECK.seats.second }, ai: fakeAi({ ck1: checker({}), ck2: checker({}) }), notesById: NOTES, contentOf: () => 'x'.repeat(40_000), at: AT, shouldStop: () => n >= 2, onCall: () => { n++ } })
            assert.deepEqual([st.ok, st.stopped, st.checks.map((c) => c.id), st.undecided, st.stats.stockChecked, st.stats.stockSupported], [true, true, ['C1'], ['C2', 'C3'], 1, 1])
        })

        it('兩席不一致 → 第三席裁定(只送該項);判不了(第三席不確定)→ 不採並回報其本批筆記(supportHolds)', async () => {
            const s = baseState()
            const ok = await run(s, pass(s, { ck1: checker({}), ck2: checker({ 盈餘消息: 'overclaim' }), ck3: checker({}) }), { supportCheck: CHECK })
            assert.equal(ok.state.claims.some((c) => c.text === ADD), true, '第三席與第一席成立 supported')
            const und = await run(s, pass(s, { ck1: checker({}), ck2: checker({ 盈餘消息: 'contradicted' }), ck3: checker({ 盈餘消息: 'unsure' }) }), { supportCheck: CHECK })
            assert.equal(und.ok, true, und.error)
            assert.equal(und.state.claims.some((c) => c.text === ADD), false)
            assert.deepEqual([und.stats.supportUndetermined, und.supportHolds], [1, ['n1']])
            // 未成立原因之字樣取判定小組之字樣表(摘要套件之 PANEL_WHY_LABELS;摘要、關聯、提煉同用)
            assert.match(und.trace.supportOut[0].why, /ES9：未能判定（有席位不確定）/)
        })

        it('各席皆失敗(基礎設施)→ 須覆核之操作存待審(理由「出處支持覆核未完成」,不計失敗)、其餘照套;截止(預算耗盡且無剩餘)→ 已判者照處置、未判者存待審,pass 完成並計 supportStopped(終審 §1 原則 3)', async () => {
            const s = baseState()
            const lines = []
            const r = await run(s, pass(s, { ck1: 'fail', ck2: 'fail' }), { supportCheck: CHECK, log: (l) => lines.push(l) })
            assert.equal(r.ok, true, r.error)
            assert.equal(r.state.claims.some((c) => c.text === ADD), false, '未得判定之新增不套')
            assert.deepEqual([r.stats.supportInfra, r.stats.supportWithheld, r.stats.supportRejected, r.stats.supportUndetermined, r.supportHolds], [2, 2, 0, 0, []], '兩操作(新增、確認)皆基礎設施未成立 → 存待審、不登錄筆記層')
            assert.deepEqual(pendingReviewOps(r.state).ops.map((o) => [o.op, o.ref || o.id]), [['add', 'x'], ['confirm', c1Of(s).id]])
            assert.deepEqual(r.state.pendingReview.map((e) => [e.reason, e.tries, e.es9Tries]), [['出處支持覆核未完成', 0, 0], ['出處支持覆核未完成', 0, 0]])
            assert.ok(lines.some((l) => /提煉出處覆核\[動量\]：add〔x〕 出處支持覆核未完成（缺票（呼叫失敗或回覆不合格））——存待審/.test(l)), lines.join('\n'))
            assert.ok(r.coverage.pending.includes('n1') && !r.coverage.uncovered.includes('n1'), '存待審者之筆記算涵蓋（pending；操作被保存）')
            // 截止:第一席預算耗盡且整輪無剩餘 → 中止;未判者存待審、pass 照常完成
            const st = await run(s, pass(s, { ck1: 'budget', ck2: checker({}) }), { supportCheck: CHECK, shouldStop: () => false, remainingMs: () => 0 })
            assert.deepEqual([st.ok, st.stopped, st.stats.supportStopped > 0, st.stats.supportWithheld], [true, undefined, true, 2])
        })

        it('整併(無待審可存)之基礎設施未成立 → 本次不採、下次再提;引用留待之新項者一併留待(閉包)', async () => {
            const s = baseState()
            const [a, b] = [c1Of(s), crashOf(s)]
            const MERGED = '投資人對資訊反應不足，使價格緩慢反映消息；動量報酬在空頭反轉期常出現崩潰，需搭配風險控管'
            const cons = fakeAi({ d1: { ops: [{ op: 'merge', into: a.id, from: [b.id], text: MERGED, reason: '兩條同一機制' }], skipped: [] }, d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: { verdicts: [{ i: 0, action: 'keep' }] }, ck1: 'fail', ck2: 'fail' })
            const SEEDB = [{ code: 'N0', id: 's0', digest: `### N0\n【核心知識】${MERGED}。` }]
            const no = await runPass({ state: s, concept: '動量', batch: [], mode: 'consolidate', domain, seats: SEATS, ai: cons, notesById: NOTES, at: AT, supportCheck: CHECK, contentOf: (nid) => SEEDB.find((x) => x.id === nid)?.digest ?? null })
            assert.equal(no.ok, true, no.error)
            assert.deepEqual([findItem(no.state, a.id).item.text, no.state.pendingReview.length, no.stats.supportInfra, no.stats.supportWithheld], [a.text, 0, 1, 0], '整併之合併稿不採、不存待審')
            // 閉包:新增主張留待 → 引用其 @ref 之爭議亦留待(否則以「所引新項不存在」被拒而遺失)
            const dep = fakeAi({
                d1: { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: ADD, basis: '實證', sources: ['N1'], ...ANN }, { op: 'dispute_add', question: '動量是否可持續', sides: [{ position: '可持續', claims: ['@x'] }, { position: '不可持續', sources: ['N2'] }] }], skipped: [] },
                d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: keepAll, ck1: 'fail', ck2: 'fail',
            })
            const r2 = await run(s, dep, { supportCheck: CHECK })
            assert.equal(r2.ok, true, r2.error)
            assert.deepEqual(pendingReviewOps(r2.state).ops.map((o) => o.op), ['add', 'dispute_add'])
            assert.deepEqual(pendingReviewOps(r2.state).ops[1].sides.map((sd) => [sd.claims, sd.sources]), [[['@a1_x'], undefined], [undefined, ['n2']]], '留待之爭議保留 @ref（席位前綴之 ref）、方之出處換成筆記 id')
        })

        it('待審裁決(runPending)亦覆核:受支持照套;成立不受支持 → 自待審移除;判不了 → 留於待審(終審失敗而暫緩之大幅改寫亦須經 ES9)', async () => {
            const s = baseState()
            const c2 = crashOf(s)
            const NEW = '動量策略於空頭反轉時之損失需以風險控管因應'
            const q = queuePendingReview(s, [{ resolved: { op: 'revise', id: c2.id, fields: { text: NEW }, reason: '依新出處改寫', sources: ['s0'] }, sources: ['s0'] }], { at: AT, reason: '終審失敗' }).state
            const PB = [{ code: 'N0', id: 's0', digest: '### N0 種子\n【核心知識】動量策略於空頭反轉時之損失需以風險控管因應。' }]
            const accept = { acc: (p) => ({ verdicts: [...p.matchAll(/^i=(\d+) /gm)].map((m) => ({ i: Number(m[1]), action: 'keep' })) }) }
            const go = (h) => runPending({ state: q, concept: '動量', batch: PB, domain, seats: SEATS, ai: fakeAi({ ...accept, ...h }), notesById: NOTES, at: AT, supportCheck: CHECK })
            const ok = await go({ ck1: checker({}), ck2: checker({}) })
            assert.equal(ok.ok, true, ok.error)
            assert.deepEqual([findItem(ok.state, c2.id).item.text, pendingReviewOps(ok.state).ops.length], [NEW, 0], '受支持 → 照套')
            const no = await go({ ck1: checker({ 動量策略於空頭: 'insufficient' }), ck2: checker({ 動量策略於空頭: 'contradicted' }) })
            assert.deepEqual([findItem(no.state, c2.id).item.text, pendingReviewOps(no.state).ops.length, no.trace.supportRejected.length, no.stats.supportRejected, no.stats.supportChecked], [c2.text, 0, 1, 1, 1], '成立不受支持 → 不採、自待審移除;統計與 runPass 同形')
            const und = await go({ ck1: checker({}), ck2: checker({ 動量策略於空頭: 'insufficient' }), ck3: checker({ 動量策略於空頭: 'unsure' }) })
            assert.deepEqual([findItem(und.state, c2.id).item.text, pendingReviewOps(und.state).ops.length, und.state.pendingReview[0].es9Tries, und.state.pendingReview[0].tries, und.state.pendingReview[0].at, und.state.pendingReview[0].reason, und.heldOps], [c2.text, 1, 1, 1, AT, '出處支持覆核判不了', []], '判不了 → 留於待審(下次再裁)、es9Tries＋1、原登錄時刻保留')
            // 判不了累計達 maxTries → 移出待審、交呼叫端登錄使用者待判(heldOps 帶操作與出處);缺票(基礎設施)→ 留於待審、不計次
            const q2 = { ...q, pendingReview: [{ ...q.pendingReview[0], es9Tries: 2, tries: 2 }] }
            const over = await runPending({ state: q2, concept: '動量', batch: PB, domain, seats: SEATS, ai: fakeAi({ ...accept, ck1: checker({}), ck2: checker({ 動量策略於空頭: 'insufficient' }), ck3: checker({ 動量策略於空頭: 'unsure' }) }), notesById: NOTES, at: AT, supportCheck: { ...CHECK, maxTries: 3 } })
            assert.deepEqual([over.ok, pendingReviewOps(over.state).ops.length, over.heldOps.map((x) => [x.op.op, x.op.id, x.notes, x.tries])], [true, 0, [['revise', c2.id, ['s0'], 3]]])
            const miss = await go({ ck1: checker({}), ck2: 'fail' })
            assert.deepEqual([pendingReviewOps(miss.state).ops.length, miss.state.pendingReview[0].es9Tries, miss.state.pendingReview[0].reason, miss.stats.supportInfra], [1, 0, '出處支持覆核未完成', 1], '缺票 → 留於待審、不計次')
        })

        it('待審裁決之語氣超出證據(ES7;同 runPass):成立 overclaim → 修訂席依出處收斂措辭 → 重判受支持 → 照套修訂後之文字;重判仍不受支持 → 自待審移除;修訂席失敗或修訂後未過納入閘 → 自待審移除(不重判);截止 → stopped(待審保留)', async () => {
            const s = baseState()
            const c2 = crashOf(s)
            const NEW = '動量策略於空頭反轉時之損失需以風險控管因應'
            const NARROW = '在實證樣本中，動量策略於空頭反轉時之損失需以風險控管因應'
            const q = queuePendingReview(s, [{ resolved: { op: 'revise', id: c2.id, fields: { text: NEW }, reason: '依新出處改寫', sources: ['s0'] }, sources: ['s0'] }], { at: AT, reason: '終審失敗' }).state
            const PB = [{ code: 'N0', id: 's0', digest: '### N0 種子\n【核心知識】動量策略於空頭反轉時之損失需以風險控管因應。' }]
            const accept = { acc: (p) => ({ verdicts: [...p.matchAll(/^i=(\d+) /gm)].map((m) => ({ i: Number(m[1]), action: 'keep' })) }) }
            const reviser = (fix, seen) => (prompt) => {
                seen?.push(prompt)
                return { fixes: [...prompt.matchAll(/^--- 第(\d+)項（.+?）---$/gm)].map((m) => ({ index: Number(m[1]), ...fix })) }
            }
            const over = { ck1: checker({ 動量策略於空頭: 'overclaim' }), ck2: checker({ 動量策略於空頭: 'overclaim' }) }
            const go = (h, x = {}) => {
                const lines = []
                const ai = fakeAi({ ...accept, ...over, ...h })
                return runPending({ state: q, concept: '動量', batch: PB, domain, seats: SEATS, ai, notesById: NOTES, at: AT, supportCheck: CHECK, log: (l) => lines.push(l), ...x }).then((r) => ({ r, lines, seen: ai.seen }))
            }
            // ①修訂後兩席判受支持 → 以修訂後之文字套用、自待審移除(已落地)
            const prompts = []
            const ok = await go({ rev: reviser({ text: NARROW }, prompts) })
            assert.equal(ok.r.ok, true, ok.r.error)
            assert.deepEqual(ok.seen, ['acc', 'ck1', 'ck2', 'rev', 'ck1', 'ck2'], '覆核 → 修訂(一次)→ 重判')
            const four = (r) => [r.stats.supportRevised, r.stats.supportReviseFailed, r.stats.supportInfra, r.stats.supportUndetermined]
            assert.deepEqual([findItem(ok.r.state, c2.id).item.text, pendingReviewOps(ok.r.state).ops.length, ok.r.trace.supportRevised.map((x) => x.id), ok.r.trace.supportRejected.length, four(ok.r)], [NARROW, 0, [c2.id], 0, [1, 0, 0, 0]])
            assert.match(prompts[0], /語氣超出證據/, '修訂提示詞附覆核說明')
            assert.ok(ok.lines.some((l) => /待審裁決出處覆核修訂\[動量\]：revise〔C2〕 依出處收斂措辭後兩席判受支持——照套修訂後之文字/.test(l)), ok.lines.join('\n'))
            // ②修訂後重判仍不受支持 → 不採、自待審移除並記明
            const still = await go({ ck1: checker({ 動量策略於空頭: 'overclaim', 在實證樣本中: 'insufficient' }), ck2: checker({ 動量策略於空頭: 'overclaim', 在實證樣本中: 'insufficient' }), rev: reviser({ text: NARROW }) })
            assert.deepEqual([findItem(still.r.state, c2.id).item.text, pendingReviewOps(still.r.state).ops.length, still.r.trace.supportRejected.length, four(still.r)], [c2.text, 0, 1, [0, 1, 0, 0]])
            assert.ok(still.lines.some((l) => /依出處收斂措辭後仍未受支持——自待審移除/.test(l)) && still.lines.some((l) => /待審裁決出處覆核\[動量\]：revise〔C2〕 ES9：語氣超出證據——自待審移除/.test(l)), still.lines.join('\n'))
            // ③修訂席失敗(或回 drop)→ 照不受支持處置:自待審移除並記明(同 runPass 之不採)
            const fail = await go({ rev: 'fail' })
            assert.deepEqual([findItem(fail.r.state, c2.id).item.text, pendingReviewOps(fail.r.state).ops.length, fail.r.trace.supportRejected.length, fail.r.stats.supportReviseFailed, fail.seen.slice(-1)[0]], [c2.text, 0, 1, 1, 'rev'], '修訂席失敗不重判')
            assert.ok(fail.lines.some((l) => /修訂席未給可用之修訂——自待審移除/.test(l)), fail.lines.join('\n'))
            // ④修訂後之文字未過納入閘(引入出處沒有之數字,ES2)→ 不重判、自待審移除並記明(同 runPass 之不採)
            const gate = await go({ rev: reviser({ text: '在實證樣本中，動量策略於空頭反轉時之損失達 18% 需以風險控管因應' }) })
            assert.equal(gate.r.ok, true, gate.r.error)
            assert.deepEqual([findItem(gate.r.state, c2.id).item.text, pendingReviewOps(gate.r.state).ops.length, gate.r.trace.supportRejected.length, four(gate.r), gate.seen], [c2.text, 0, 1, [0, 1, 0, 0], ['acc', 'ck1', 'ck2', 'rev']], '未過閘者不交重判')
            assert.ok(gate.lines.some((l) => /待審裁決出處覆核修訂\[動量\]：revise〔C2〕 修訂後未過納入閘（ES2：數字 18/.test(l) && /——自待審移除$/.test(l)), gate.lines.join('\n'))
            // ⑤修訂席截止(預算耗盡且整輪無剩餘)→ 基礎設施:原操作留於待審(不計次)、裁決照常完成並計 supportStopped
            const cut = await go({ rev: 'budget' }, { shouldStop: () => false, remainingMs: () => 0 })
            assert.deepEqual([cut.r.ok, cut.r.stats.supportStopped, cut.r.stats.supportWithheld, pendingReviewOps(cut.r.state).ops.length, cut.r.state.pendingReview[0].es9Tries, cut.r.state.pendingReview[0].reason], [true, 1, 1, 1, 0, '出處支持覆核未完成'])
            // 修訂席未設 → 不修訂(照不受支持處置,同 runPass)
            const noRev = await runPending({ state: q, concept: '動量', batch: PB, domain, seats: { ...SEATS, revise: undefined }, ai: fakeAi({ ...accept, ...over }), notesById: NOTES, at: AT, supportCheck: CHECK })
            assert.deepEqual([findItem(noRev.state, c2.id).item.text, noRev.trace.supportRejected.length], [c2.text, 1])
        })

        it('整併(consolidate)之合併給新文字 → 覆核合併稿(受被併各項之存活出處支持);不受支持 → 不採', async () => {
            const s = baseState()
            const [a, b] = [c1Of(s), crashOf(s)]
            // 合併稿須保有 into 與被併項之過半(coreState ⑪ MERGE_KEEP_MIN),否則試套即剔
            const MERGED = '投資人對資訊反應不足，使價格緩慢反映消息；動量報酬在空頭反轉期常出現崩潰，需搭配風險控管'
            const cons = (h) => fakeAi({ d1: { ops: [{ op: 'merge', into: a.id, from: [b.id], text: MERGED, reason: '兩條同一機制' }], skipped: [] }, d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: { verdicts: [{ i: 0, action: 'keep' }] }, ...h })
            const SEEDB = [{ code: 'N0', id: 's0', digest: `### N0\n【核心知識】${MERGED}。` }]
            const ai1 = cons({ ck1: checker({}), ck2: checker({}) })
            const ok = await runPass({ state: s, concept: '動量', batch: [], mode: 'consolidate', domain, seats: SEATS, ai: ai1, notesById: NOTES, at: AT, supportCheck: CHECK, contentOf: (nid) => SEEDB.find((x) => x.id === nid)?.digest ?? null })
            assert.equal(ok.ok, true, ok.error)
            assert.ok(ai1.seen.includes('ck1'), '整併亦覆核')
            assert.equal(findItem(ok.state, a.id).item.text, MERGED)
            const ai2 = cons({ ck1: checker({ 投資人對資訊: 'overclaim' }), ck2: checker({ 投資人對資訊: 'insufficient' }), rev: 'fail' })
            const no = await runPass({ state: s, concept: '動量', batch: [], mode: 'consolidate', domain, seats: SEATS, ai: ai2, notesById: NOTES, at: AT, supportCheck: CHECK, contentOf: (nid) => SEEDB.find((x) => x.id === nid)?.digest ?? null })
            assert.equal(findItem(no.state, a.id).item.text, a.text, '不受支持之合併稿不採')
        })

        it('規則表:只有隔離(held)之主張時不加「出處已撤」之條件規則(提示詞與無隔離時逐字相同);出處已撤時才加', () => {
            const s = baseState()
            const held = holdItems(s, [{ id: c1Of(s).id, std: 'ES9', why: '兩席不一致' }], { at: AT }).state
            assert.equal(rulesTextOf(domain, held), rulesTextOf(domain, s))
            const gone = withdrawSources(s, { withdraw: [{ id: 's0', title: '種子' }], at: AT }).state
            assert.notEqual(rulesTextOf(domain, gone), rulesTextOf(domain, s))
            assert.match(rulesTextOf(domain, gone), /出處已撤/)
        })

        // ES7「語氣超出證據 → 修訂補丁」;不合格者先修正,修不了才不納入(standards/supportRevise)
        describe('語氣超出證據之修訂(ES7 併入 ES9)', function() {
            const NARROW = '在實證樣本中，盈餘消息反應不足之動量報酬持續 3 到 12 個月'
            /** 修訂席替身:回覆收斂後之文字;記下提示詞供斷言 */
            const reviser = (fix, seen) => (prompt) => {
                seen?.push(prompt)
                return { fixes: [...prompt.matchAll(/^--- 第(\d+)項（.+?）---$/gm)].map((m) => ({ index: Number(m[1]), ...fix })) }
            }

            it('兩席成立 overclaim → 修訂席依出處收斂措辭 → 重判受支持 → 照套修訂後之文字(原文不入核心);棒序與統計', async () => {
                const s = baseState()
                const prompts = []
                const lines = []
                const ai = pass(s, { ck1: checker({ 盈餘消息: 'overclaim' }), ck2: checker({ 盈餘消息: 'overclaim' }), rev: reviser({ text: NARROW, conditions: ['實證樣本'] }, prompts) })
                const r = await run(s, ai, { supportCheck: CHECK, log: (l) => lines.push(l) })
                assert.equal(r.ok, true, r.error)
                assert.deepEqual(ai.seen, ['d1', 'd2', 'd3', 'int', 'aud', 'acc', 'ck1', 'ck2', 'rev', 'ck1', 'ck2'], '覆核 → 修訂(一次)→ 重判')
                const got = r.state.claims.find((c) => c.text === NARROW)
                assert.ok(got, '修訂後之文字落地')
                assert.deepEqual(got.conditions, ['實證樣本'])
                assert.equal(r.state.claims.some((c) => c.text === ADD), false, '超出證據之原文不入核心')
                assert.deepEqual([r.stats.supportRevised, r.stats.supportReviseFailed, r.stats.supportRejected], [1, 0, 0])
                assert.match(prompts[0], /語氣超出證據/, '修訂提示詞附覆核說明')
                assert.match(prompts[0], /=== 出處 S1：/, '修訂提示詞附出處材料(與覆核同一份)')
                assert.ok(lines.some((l) => /提煉出處覆核修訂\[動量\]：add〔x〕 依出處收斂措辭後兩席判受支持/.test(l)), lines.join('\n'))
            })

            it('修訂後重判仍不受支持 → 不採;修訂席回 drop → 不採(不重判);各只修訂一輪', async () => {
                const s = baseState()
                const still = pass(s, { ck1: checker({ 盈餘消息: 'overclaim', 在實證樣本中: 'insufficient' }), ck2: checker({ 盈餘消息: 'overclaim', 在實證樣本中: 'insufficient' }), rev: reviser({ text: NARROW }) })
                const r1 = await run(s, still, { supportCheck: CHECK })
                assert.equal(r1.ok, true, r1.error)
                assert.equal(r1.state.claims.some((c) => c.text === NARROW || c.text === ADD), false)
                assert.deepEqual([r1.stats.supportRevised, r1.stats.supportReviseFailed, r1.stats.supportRejected], [0, 1, 1])
                assert.equal(still.seen.filter((x) => x === 'rev').length, 1, '一輪為限')
                const drop = pass(s, { ck1: checker({ 盈餘消息: 'overclaim' }), ck2: checker({ 盈餘消息: 'overclaim' }), rev: reviser({ drop: true }) })
                const r2 = await run(s, drop, { supportCheck: CHECK })
                assert.equal(r2.state.claims.some((c) => c.text === ADD), false)
                assert.deepEqual(drop.seen.slice(-3), ['ck1', 'ck2', 'rev'], 'drop 者不再重判')
                assert.equal(r2.trace.supportRevise[0].out, 'no-fix')
            })

            it('成立之票有 contradicted(出處陳述相反)→ 不修訂、直接不採;判不了者亦不修訂', async () => {
                const s = baseState()
                const ai = pass(s, { ck1: checker({ 盈餘消息: 'contradicted' }), ck2: checker({ 盈餘消息: 'overclaim' }), rev: reviser({ text: NARROW }) })
                const r = await run(s, ai, { supportCheck: CHECK })
                assert.equal(r.ok, true, r.error)
                assert.equal(ai.seen.includes('rev'), false, '陳述相反非措辭問題')
                assert.equal(r.state.claims.some((c) => c.text === ADD || c.text === NARROW), false)
                const und = pass(s, { ck1: checker({ 盈餘消息: 'overclaim' }), ck2: checker({ 盈餘消息: 'unsure' }), ck3: checker({ 盈餘消息: 'unsure' }), rev: reviser({ text: NARROW }) })
                const r2 = await run(s, und, { supportCheck: CHECK })
                assert.equal(und.seen.includes('rev'), false, '未成立者不修訂(入待判)')
                assert.deepEqual(r2.supportHolds, ['n1'])
            })

            it('修訂後之文字須過納入閘:引入出處沒有之數字(ES2)→ 不採、不重判', async () => {
                const s = baseState()
                const ai = pass(s, { ck1: checker({ 盈餘消息: 'overclaim' }), ck2: checker({ 盈餘消息: 'overclaim' }), rev: reviser({ text: '在實證樣本中，盈餘消息反應不足之動量報酬持續 3 到 18 個月' }) })
                const lines = []
                const r = await run(s, ai, { supportCheck: CHECK, log: (l) => lines.push(l) })
                assert.equal(r.ok, true, r.error)
                assert.equal(r.state.claims.some((c) => /18 個月/.test(c.text)), false)
                assert.deepEqual(ai.seen.slice(-3), ['ck1', 'ck2', 'rev'], '未過閘者不交重判')
                assert.equal(r.trace.supportRevise[0].out, 'gate')
                assert.ok(lines.some((l) => /修訂後未過納入閘（ES2/.test(l)), lines.join('\n'))
            })
        })
    })
})
