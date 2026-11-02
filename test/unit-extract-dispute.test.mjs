// unit-extract-dispute.test.mjs — 檢定標準 ES14(爭議為真對立;終審存疑之處置)之純函數、判定小組與專步(extract/standards/disputeCheck、
//   workflow/disputePass)。規格:方案 v2 D／終審 §3.5「存疑逾 N 版 → 兩席拆解判定」、細目 tmp/standards-audit/D-plan.md §5A
//   (對象、裁決、處置、設定)。提煉段之接線(維護統計、專步、待判登錄)在 unit-extract-stage。
// 執行:自套件根 npx mocha test/unit-extract-dispute.test.mjs

import assert from 'node:assert/strict'
import { PANEL_UNSURE } from '../src/core/summarizePackage.mjs'
import { applyVerdicts } from '../src/workflow/verdicts.mjs'
import { findItem, dissolveSidesOf, checkInvariants } from '../src/stores/coreState.mjs'
import { ES14, ES14_OBJECT, disputeDueOf, disputeItemsOf, doubtCheckedOf, disputeHashOf, disputeHoldSetsOf, disputeHeldIdsOf, disputeProgressOf, checkDisputeVerdictOf, seatDisputeVotesOf, dissolveOpOf, runDisputeCheck } from '../src/standards/disputeCheck.mjs'
import { runDisputePass } from '../src/workflow/disputePass.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { seedCore, ANN, panelAi } from './tools/extractKit.mjs'

const AT = '2026-10-01T20:00:00+08:00'
const NOW = Date.parse('2026-10-10T20:00:00+08:00')
const SEED = [{ code: 'N0', id: 's0' }, { code: 'N9', id: 's9' }, { code: 'N5', id: 's5' }]
const domain = createExtractDomain({})

// 經真實路徑造出存疑之爭議:終審裁決 doubt → applyDelta 記於爭議(D1:side 0 只有立場文字、side 1 引一條主張＋方層出處;D2:兩方皆只有立場)
const doubted = () => {
    const ops = [
        { op: 'add', ref: 'a', kind: 'rule', text: '動量於美股有效', sources: ['N0'], ...ANN },
        { op: 'dispute_add', question: '動量是否於台股有效', sides: [{ position: '台股動量顯著', sources: ['N0'] }, { position: '台股反轉主導', claims: ['@a'], sources: ['N9'] }] },
        { op: 'dispute_add', question: '價值因子是否失效', sides: [{ position: '價值因子近十年失效', sources: ['N5'] }, { position: '價值因子長期仍有溢酬', sources: ['N9'] }] },
    ]
    const av = applyVerdicts({ ops }, [{ i: 1, action: 'doubt', reason: '非對立', note: '兩方回答不同市場' }, { i: 2, action: 'doubt', reason: '非對立', note: '期間不同' }])
    return seedCore({ coreId: 'm', concept: '動量', delta: av.delta, batch: SEED, at: AT })
}
// 起草者已有一次機會:核心再升一版(另一批新增主張)
const bumped = (s) => seedCore({ base: s, ops: [{ op: 'add', kind: 'rule', text: '另一條主張', sources: ['N0'], ...ANN }], batch: SEED, at: AT, commit: false })
// 替身 AI:依「問題」行回覆裁決;by[stage][問題] = 票(物件或 'unsure');provider 依席位,o.provider 可另給(呼叫之包裝取共用件 panelAi,test/tools/extractKit)
const fakeAi = (by, prompts = [], o = {}) => panelAi((stage, prompt) => {
    prompts.push({ stage, prompt })
    const its = [...prompt.matchAll(/^--- 第(\d+)項 ---\n問題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), q: m[2] }))
    const rows = its.map((x) => {
        const v = by[stage]?.[x.q]
        return v === undefined ? null : (v === PANEL_UNSURE ? { index: x.index, verdict: 'unsure' } : { index: x.index, ...v })
    }).filter(Boolean)
    return { checks: rows }
}, o)
/** 判定小組三席(區域名;與共用件 extractKit 之 3+3 席位 SEATS 不同義) */
const PANEL = { first: { use: 'p1' }, second: { use: 'p2' }, third: { use: 'p3' } }
const NOT = { verdict: 'not-opposed', reason: '一方談台股、一方談美股之反轉，回答不同市場', kinds: ['rule', null], annotations: [{ critique: '只見於單一研究', pros: ['出處未載'], cons: ['出處未載'] }, null] }
const OPP = { verdict: 'opposed', reason: '價值因子之長期溢酬一方說失效一方說仍在' }

describe('unit-extract-dispute', function() {

    it('disputeDueOf:未解決且帶存疑;起草者已有一次機會(核心再升版 ≥ minVersions)或存疑逾 waitDays;待判中、已覆核者不排;存疑久者先', () => {
        const s0 = doubted()
        assert.deepEqual(disputeDueOf(s0, { nowMs: Date.parse(AT), waitDays: 7 }), [], '剛存疑、未再升版、未逾期 → 不排')
        assert.deepEqual(disputeDueOf(s0, { nowMs: NOW, waitDays: 7 }).map((x) => x.id), ['D1', 'D2'], '逾 7 天 → 排(閒置核心不升版亦須處置)')
        const s1 = bumped(s0)
        assert.deepEqual(disputeDueOf(s1, { nowMs: Date.parse(AT), waitDays: 7 }).map((x) => [x.id, x.age]), [['D1', 1], ['D2', 1]], '再升一版 → 排')
        assert.deepEqual(disputeDueOf(s1, { nowMs: Date.parse(AT), waitDays: 7, minVersions: 2 }), [], 'minVersions 2 → 尚未')
        assert.deepEqual(disputeDueOf(s1, { nowMs: Date.parse(AT), heldIds: new Set(['D1']) }).map((x) => x.id), ['D2'], '待判中者不排')
        const s2 = { ...s1, doubtChecks: { D2: { v: ES14.v, verdict: 'opposed', doubtVersion: findItem(s1, 'D2').item.doubt.version, doubtCount: 1, hash: disputeHashOf(findItem(s1, 'D2').item, (nid) => `${nid}:v1`), shape: disputeHashOf(findItem(s1, 'D2').item) } } }
        assert.equal(doubtCheckedOf(s2, findItem(s2, 'D2').item), true)
        assert.deepEqual(disputeDueOf(s2, { nowMs: Date.parse(AT) }).map((x) => x.id), ['D1'], '已覆核者不排')
        // 標準改版(方案 v2 §1.4「標準版本變 → 全量重檢」;2026-10-05 審查 B-M9)→ 覆核紀錄失效
        const sv = { ...s2, doubtChecks: { D2: { ...s2.doubtChecks.D2, v: ES14.v - 1 } } }
        assert.equal(doubtCheckedOf(sv, findItem(sv, 'D2').item), false, '舊版標準之覆核紀錄不算已覆核')
        // 內容變了(方層出處增加)→ 覆核紀錄失效,再排
        const s3 = JSON.parse(JSON.stringify(s2))
        findItem(s3, 'D2').item.sides[0].sources.push('s0')
        assert.deepEqual(disputeDueOf(s3, { nowMs: Date.parse(AT) }).map((x) => x.id), ['D1', 'D2'])
        // 素材雜湊含各方出處之內容鍵(終審 §3 D5g):給 keyOf 者比記錄之 hash(出處內容變即失效);未給 keyOf 者比記錄之 shape(只含結構;渲染)
        const k1 = (nid) => `${nid}:v1`
        const d2 = findItem(s1, 'D2').item
        assert.notEqual(disputeHashOf(d2, k1), disputeHashOf(d2), '有無內容鍵不同雜湊')
        assert.notEqual(disputeHashOf(d2, k1), disputeHashOf(d2, (nid) => (nid === 's5' ? 's5:v2' : k1(nid))), '一方出處之內容變 → 雜湊變')
        assert.deepEqual([doubtCheckedOf(s2, d2, k1), doubtCheckedOf(s2, d2), doubtCheckedOf(s2, d2, (nid) => `${nid}:v2`)], [true, true, false], '同鍵已覆核;未給 keyOf 比結構;鍵變即重判')
        assert.deepEqual(disputeDueOf(s2, { nowMs: Date.parse(AT), keyOf: (nid) => `${nid}:v2` }).map((x) => x.id), ['D1', 'D2'], '出處內容變 → 再排')
        assert.equal(doubtCheckedOf({ ...s2, doubtChecks: { D2: { ...s2.doubtChecks.D2, shape: 'x' } } }, d2), false, '結構雜湊不符 → 未覆核(渲染不加註)')
    })

    it('待判集合與進度(專步與掃描同一讀法):disputeHoldSetsOf 逐核心之待判中(未結、非要求重試)與已豁免;disputeHeldIdsOf 豁免後無新存疑者不排;disputeProgressOf 之已檢、合格、版本過時、受檢、到期', () => {
        const H = (oid, status, extra = {}) => ({ object: ES14_OBJECT, std: ES14.std, oid, status, at: AT, ...extra })
        const rows = [H('m:D1', 'open'), H('m:D2', 'open', { retry: true }), H('m:D3', 'waived', { waivedAt: '2026-10-05T00:00:00+08:00' }), H('m:D4', 'resolved'), H('x:D1', 'open'), { object: 'claim', std: 'ES9', oid: 'm:C1', status: 'open' }, H('bad', 'open')]
        const sets = disputeHoldSetsOf(rows, (h) => h.retry === true)
        assert.deepEqual([...sets.keys()], ['m', 'x'])
        assert.deepEqual([[...sets.get('m').held], [...sets.get('m').waived], [...sets.get('x').held]], [['D1'], [['D3', '2026-10-05T00:00:00+08:00']], ['D1']], '要求重試者不算待判中;已結案不算;他標準與壞 oid 略過')
        assert.deepEqual(disputeHoldSetsOf(null).size, 0)
        const s = bumped(doubted())
        const d1 = findItem(s, 'D1').item
        assert.deepEqual([...disputeHeldIdsOf(s, { held: ['D2'], waived: [['D1', '2026-10-05T00:00:00+08:00']] })], ['D2', 'D1'], '存疑(10-01)不晚於豁免(10-05)→ 不排')
        assert.deepEqual([...disputeHeldIdsOf(s, { held: [], waived: [['D1', '2026-09-30T00:00:00+08:00']] })], [], '豁免後有新存疑 → 照排')
        assert.deepEqual([...disputeHeldIdsOf(s, undefined), ...disputeHeldIdsOf(null, { waived: [['D1', AT]] })], [], '空集合')
        const p0 = disputeProgressOf(s, { nowMs: Date.parse(AT) })
        assert.deepEqual(p0, { checked: 0, pass: 0, stale: 0, total: 2, due: 2 }, '再升一版 → 兩則到期')
        const sc = { ...s, doubtChecks: { D1: { v: ES14.v, verdict: 'opposed', doubtVersion: d1.doubt.version, doubtCount: 1, hash: 'h', shape: disputeHashOf(d1) }, D2: { v: ES14.v - 1, verdict: 'opposed', doubtVersion: 1, doubtCount: 1, hash: 'h', shape: 'h' }, bad: 5 } }
        assert.deepEqual(disputeProgressOf(sc, { nowMs: Date.parse(AT), heldIds: new Set(['D2']) }), { checked: 2, pass: 1, stale: 1, total: 2, due: 0 }, '非物件之紀錄不計;已覆核與待判中者不到期')
        assert.deepEqual(disputeProgressOf(null), { checked: 0, pass: 0, stale: 0, total: 0, due: 0 })
    })

    it('disputeItemsOf:各方之立場、條件、所引主張、出處(含所引主張之出處)、拆解去處(dissolveSidesOf 單一判定)與存疑', () => {
        const s = bumped(doubted())
        const [it] = disputeItemsOf(s, ['D1'])
        assert.deepEqual(it.sides.map((sd) => [sd.position, sd.toClaim, sd.claims.map((c) => c.id), sd.notes]), [['台股動量顯著', true, [], ['s0']], ['台股反轉主導', false, ['C1'], ['s9', 's0']]])
        assert.deepEqual(dissolveSidesOf(s, findItem(s, 'D1').item).map((x) => x.to), ['claim', 'merge'], 'side 1 只引一條主張且有方層出處 → 併入')
        assert.deepEqual(it.doubt, { reason: '非對立', note: '兩方回答不同市場' })
        assert.deepEqual(it.notes, ['s0', 's9'])
    })

    it('checkDisputeVerdictOf:opposed(理由可空);not-opposed／same-study 理由 ≥10 字、拆解欄位長度須等於方數;unsure 合法;其餘＝缺票', () => {
        assert.deepEqual(checkDisputeVerdictOf({ verdict: 'OPPOSED' }), { verdict: 'opposed', reason: '' })
        assert.equal(checkDisputeVerdictOf({ verdict: 'not-opposed', reason: '太短' }), null)
        assert.deepEqual(checkDisputeVerdictOf({ ...NOT }, 2), { verdict: 'not-opposed', reason: NOT.reason, kinds: ['rule', null], annotations: NOT.annotations })
        const short = checkDisputeVerdictOf({ ...NOT, kinds: ['rule'] }, 2)
        assert.deepEqual([short.verdict, 'kinds' in short], ['not-opposed', false], '拆解欄位長度不符 → 票仍計類別,但無拆解欄位')
        assert.equal(checkDisputeVerdictOf({ verdict: 'same-study', reason: '兩方皆出自同一篇之利與弊' }).verdict, 'same-study')
        assert.equal(checkDisputeVerdictOf({ verdict: 'unsure' }), PANEL_UNSURE)
        assert.equal(checkDisputeVerdictOf({ verdict: 'keep' }), null)
    })

    it('seatDisputeVotesOf:以編號對應、限本席所見;同編號矛盾(含 unsure 對明確票)→ 缺票;同類別之重複保留首票', () => {
        const sides = new Map([[1, 2], [2, 2], [3, 2]])
        const m = seatDisputeVotesOf({ checks: [
            { index: 1, verdict: 'opposed' }, { index: 1, verdict: 'not-opposed', reason: '回答不同問題之說明文字' },
            { index: 2, verdict: 'unsure' }, { index: 2, verdict: 'same-study', reason: '同一篇之利與弊之正反說明' },
            { index: 3, verdict: 'not-opposed', reason: '回答不同問題之說明文字' }, { index: 3, verdict: 'same-study', reason: '同一篇之利與弊之正反說明' },
            { index: 9, verdict: 'opposed' },
        ] }, sides)
        assert.deepEqual([m.get(1), m.get(2), m.get(3)?.verdict, m.has(9)], [null, null, 'not-opposed', false])
    })

    it('dissolveOpOf:以非對立之票組 dispute_dissolve(與起草者提出者同形);無拆解欄位、長度不符、轉為主張之方種類不在清單(含 null)或標注非物件 → null(不交 coreState 以第一種類後備)', () => {
        const s = bumped(doubted())
        const [it] = disputeItemsOf(s, ['D1'])
        const kinds = domain.claimKinds
        assert.deepEqual(dissolveOpOf(it, NOT, kinds), { op: 'dispute_dissolve', id: 'D1', reason: NOT.reason, kinds: ['rule', null], annotations: NOT.annotations })
        assert.equal(dissolveOpOf(it, { verdict: 'not-opposed', reason: NOT.reason }, kinds), null)
        assert.equal(dissolveOpOf(it, { ...NOT, kinds: ['rule'] }, kinds), null)
        // side 0 拆解時轉為主張:種類 null(模型照抄範例之實見形狀)、清單外、標注非物件 → 不可用;side 1 不另立主張,其欄位不驗
        assert.equal(dissolveOpOf(it, { ...NOT, kinds: [null, null] }, kinds), null)
        assert.equal(dissolveOpOf(it, { ...NOT, kinds: ['axiom', null] }, kinds), null)
        assert.equal(dissolveOpOf(it, { ...NOT, annotations: ['銳評', null] }, kinds), null)
        assert.ok(dissolveOpOf(it, { ...NOT, kinds: ['rule', 'whatever'] }, kinds), '不另立主張之方之種類不驗')
    })

    it('runDisputeCheck:兩席一致 → 成立;類別相同(not-opposed／same-study)→ 成立為非對立,不叫第三席;不一致 → 第三席只送該些項;提示詞含界線、存疑、拆解去處與 S 標示', async () => {
        const s = bumped(doubted())
        const items = disputeItemsOf(s, ['D1', 'D2'])
        const SAME = { verdict: 'same-study', reason: '兩方皆出自同一研究之利與弊之正反', kinds: ['rule', null], annotations: NOT.annotations }
        const prompts = []
        const ai = fakeAi({ p1: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP }, p2: { 動量是否於台股有效: SAME, 價值因子是否失效: NOT }, p3: { 價值因子是否失效: OPP } }, prompts)
        const call = async (stage, seat, prompt) => ai.getWkf().callAi(prompt, { spec: { use: seat.use } })
        const r = await runDisputeCheck({ items, concept: '動量', contentOf: (n) => `${n} 之內容`, titleOf: (n) => `${n} 標題`, buildPrompt: domain.buildDisputeCheckPrompt, call, seats: PANEL })
        assert.deepEqual([...r.decisions.entries()].map(([k, d]) => [k, d.status, d.verdict?.verdict]), [['D1', 'decided', 'not-opposed'], ['D2', 'decided', 'opposed']])
        assert.equal(r.calls, 3)
        const third = prompts.find((x) => x.stage === 'p3').prompt
        assert.equal((third.match(/^--- 第\d+項 ---/gm) || []).length, 1, '第三席只送未成立之項')
        const p1 = prompts.find((x) => x.stage === 'p1').prompt
        for (const x of ['【非對立之界線】', '終審存疑（非對立）：兩方回答不同市場', 'side 0：台股動量顯著｜出處：S1｜拆解時轉為一條主張（須給 kinds[0]、annotations[0]）', '｜所引主張：〔C1〕動量於美股有效', '拆解時不另立主張', '=== 出處 S1：s0 標題 ===\ns0 之內容', '拿不準就回 unsure，不要猜', '不可只引述存疑']) assert.ok(p1.includes(x), x)
    })

    it('runDisputePass:成立對立 → doubtChecks 記錄、爭議逐欄不變;成立非對立 → 經納入閘拆解(只有立場之方轉主張、方層出處併入所引主張);不變式成立', async () => {
        const s = bumped(doubted())
        const ai = fakeAi({ p1: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP }, p2: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP } })
        const lines = []
        const r = await runDisputePass({ state: s, concept: '動量', ids: ['D1', 'D2'], domain, seats: PANEL, ai, contentOf: (n) => `${n} 之內容`, at: '2026-10-02T10:00:00+08:00', log: (l) => lines.push(l) })
        assert.equal(r.ok, true, r.error)
        assert.deepEqual([r.decided, r.held, r.retry, r.applied.map((a) => a.op)], [['D1', 'D2'], [], [], ['dispute_dissolve']])
        const d1 = findItem(r.state, 'D1').item
        assert.deepEqual([d1.status, d1.retractReason, d1.statusNote], ['retracted', '非對立', NOT.reason])
        const fromSide0 = r.state.claims.find((c) => c.origin === 'dispute')
        assert.deepEqual([fromSide0.text, fromSide0.kind, fromSide0.critique, fromSide0.sources], ['台股動量顯著', 'rule', '只見於單一研究', ['s0']])
        assert.deepEqual(findItem(r.state, 'C1').item.sources, ['s0', 's9'], 'side 1 之方層出處併入所引主張')
        // 對立:爭議本身不動,記帳欄位記覆核結果
        assert.deepEqual(findItem(r.state, 'D2').item, findItem(s, 'D2').item)
        assert.deepEqual([r.state.doubtChecks.D2.verdict, r.state.doubtChecks.D2.seats, r.state.doubtChecks.D2.doubtVersion], ['opposed', 'p1|p2', findItem(s, 'D2').item.doubt.version])
        assert.equal(doubtCheckedOf(r.state, findItem(r.state, 'D2').item), true)
        assert.deepEqual(checkInvariants(s, r.state, { touched: [...new Set([...r.state.claims.map((c) => c.id), 'D1'])] }), [])
        assert.deepEqual(r.stats, { disputeChecked: 2, disputeOpposed: 1, disputeDissolved: 1, disputeHeld: 0, disputeRetry: 0, disputeStdRejected: 0, disputeCalls: 2, disputeUnreadable: 0 })
        // 渲染:存疑行加註覆核結果
        const md = domain.renderState(r.state).body
        assert.match(md, /終審存疑（v\d+；非對立）：期間不同；兩席覆核（v\d+）：真對立——價值因子之長期溢酬一方說失效一方說仍在/)
    })

    it('runDisputePass:拆解欄位未過納入閘(缺銳評)→ 改用另一席;皆不過 → 不拆解、待判(dissolve-rejected);判不了(unsure／不一致)→ 待判;缺票或同一供應者 → 重試(全部受檢項皆如此 → 專步層之失敗)', async () => {
        const s = bumped(doubted())
        const BAD = { ...NOT, annotations: [{ pros: ['出處未載'], cons: ['出處未載'] }, null] }
        // 第一席缺銳評、第二席合格 → 用第二席
        const r1 = await runDisputePass({ state: s, concept: '動量', ids: ['D1'], domain, seats: PANEL, ai: fakeAi({ p1: { 動量是否於台股有效: BAD }, p2: { 動量是否於台股有效: NOT } }), contentOf: () => 'x', at: AT })
        assert.deepEqual([r1.decided, r1.applied.length, r1.state.claims.find((c) => c.origin === 'dispute')?.critique], [['D1'], 1, '只見於單一研究'])
        // 兩席皆缺 → 待判
        const r2 = await runDisputePass({ state: s, concept: '動量', ids: ['D1'], domain, seats: PANEL, ai: fakeAi({ p1: { 動量是否於台股有效: BAD }, p2: { 動量是否於台股有效: BAD } }), contentOf: () => 'x', at: AT })
        assert.deepEqual([r2.decided, r2.held.map((h) => [h.id, h.why]), r2.applied.length, r2.stats.disputeStdRejected], [[], [['D1', 'dissolve-rejected']], 0, 1])
        assert.equal(r2.state, s, '無任何變更 → 狀態原物件')
        // 不確定 → 叫第三席;第三席亦不確定 → 待判(unsure)
        const r3 = await runDisputePass({ state: s, concept: '動量', ids: ['D2'], domain, seats: PANEL, ai: fakeAi({ p1: { 價值因子是否失效: OPP }, p2: { 價值因子是否失效: PANEL_UNSURE }, p3: { 價值因子是否失效: PANEL_UNSURE } }), contentOf: () => 'x', at: AT })
        assert.deepEqual(r3.held.map((h) => [h.id, h.why]), [['D2', 'unsure']])
        // 缺票(第二席未回此項)→ 重試;全部缺 → 失敗(不套用)
        const r4 = await runDisputePass({ state: s, concept: '動量', ids: ['D1', 'D2'], domain, seats: { first: PANEL.first, second: PANEL.second }, ai: fakeAi({ p1: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP }, p2: { 價值因子是否失效: OPP } }), contentOf: () => 'x', at: AT })
        assert.deepEqual([r4.decided, r4.retry], [['D2'], ['D1']])
        const r5 = await runDisputePass({ state: s, concept: '動量', ids: ['D1'], domain, seats: PANEL, ai: fakeAi({}), contentOf: () => 'x', at: AT })
        assert.deepEqual([r5.ok, /各席皆未回/.test(r5.error)], [false, true])
        // 同一供應者(第一、二席成交於同一家):部分項 → 該項重試(逐項計次);全部受檢項皆同一供應者 → 專步層之失敗(同全缺票;不逐項計次、不轉待判)
        const sameAi = (by) => fakeAi(by, [], { provider: (stage) => (stage === 'p3' ? 'p3' : 'p1') })
        const r6 = await runDisputePass({ state: s, concept: '動量', ids: ['D2'], domain, seats: { first: PANEL.first, second: PANEL.second }, ai: sameAi({ p1: { 價值因子是否失效: OPP }, p2: { 價值因子是否失效: OPP } }), contentOf: () => 'x', at: AT })
        assert.deepEqual([r6.ok, /全部受檢項皆缺票或同一供應者/.test(r6.error), r6.retry], [false, true, ['D2']])
        // 第三席與之成立者成立;第三席不確定者 → 該項同一供應者(重試)
        const r7 = await runDisputePass({ state: s, concept: '動量', ids: ['D1', 'D2'], domain, seats: PANEL, ai: sameAi({ p1: { 動量是否於台股有效: OPP, 價值因子是否失效: OPP }, p2: { 動量是否於台股有效: OPP, 價值因子是否失效: OPP }, p3: { 動量是否於台股有效: OPP, 價值因子是否失效: PANEL_UNSURE } }), contentOf: () => 'x', at: AT })
        assert.deepEqual([r7.ok, r7.decided, r7.retry, r7.stats.disputeRetry], [true, ['D1'], ['D2'], 1], '部分同一供應者 → 逐項重試')
    })

    it('runDisputePass:拆解欄位(AI 所寫之標注)含簡體 → 經操作守門只轉違規處為正體再落地(ES3;2026-10-05 審查 B-K1)', async () => {
        const s = bumped(doubted())
        const CN = { ...NOT, annotations: [{ critique: '只见于单一研究', pros: ['出處未載'], cons: ['出處未載'] }, null] }
        const r = await runDisputePass({ state: s, concept: '動量', ids: ['D1'], domain, seats: PANEL, ai: fakeAi({ p1: { 動量是否於台股有效: CN }, p2: { 動量是否於台股有效: CN } }), contentOf: () => 'x', at: AT })
        assert.equal(r.ok, true, r.error)
        assert.equal(r.state.claims.find((c) => c.origin === 'dispute')?.critique, '只見於單一研究')
    })

    it('分頁與材料(終審 §3 D5c、D5d):依出處字數分頁(每頁各自呼叫);單項放不下 → 待判（材料過大）;出處讀不到之爭議不送審、不計次', async () => {
        const s = bumped(doubted())
        const items = disputeItemsOf(s, ['D1', 'D2'])
        const prompts = []
        const ai = fakeAi({ p1: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP }, p2: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP } }, prompts)
        const call = async (stage, seat, prompt) => ai.getWkf().callAi(prompt, { spec: { use: seat.use } })
        // 每篇出處 50 字、每頁上限 60:兩則爭議各自一頁 → 四次呼叫
        const r = await runDisputeCheck({ items, concept: '動量', contentOf: (n) => 'x'.repeat(50), titleOf: (n) => n, buildPrompt: domain.buildDisputeCheckPrompt, call, seats: { first: PANEL.first, second: PANEL.second }, pageChars: 60 })
        assert.deepEqual([r.calls, [...r.decisions.keys()], prompts.filter((x) => x.stage === 'p1').length], [4, ['D1', 'D2'], 2])
        // 單項放不下 → 材料過大 → 專步列待判(使用者),不是重試
        const big = await runDisputePass({ state: s, concept: '動量', ids: ['D1'], domain, seats: PANEL, ai: { getWkf: () => ({ callAi: async () => ({ ok: false, error: 'oversize' }) }), seatSpec: () => null, recordCall: () => {} }, contentOf: () => 'x', at: AT })
        assert.deepEqual([big.ok, big.held.map((h) => [h.id, h.why]), big.retry, big.stats.disputeHeld], [true, [['D1', 'oversize']], [], 1])
        // 出處讀不到(contentOf 回 null)→ 不送審、不計次;全部如此 → noop
        const lines = []
        const un = await runDisputePass({ state: s, concept: '動量', ids: ['D1', 'D2'], domain, seats: PANEL, ai: fakeAi({}), contentOf: (n) => (n === 's5' ? null : 'x'), at: AT, log: (l) => lines.push(l) })
        assert.deepEqual([un.ok, un.stats.disputeUnreadable, un.stats.disputeChecked, un.retry], [false, 1, 1, ['D1']], 'D2 之一方出處 s5 讀不到 → 不送;D1 照送(替身無票 → 全部已送者缺票 → 專步層失敗、重試)')
        assert.ok(lines.some((l) => /爭議覆核\[動量\]：1 則爭議之出處內容讀不到（〔D2〕），本輪不送審、不計次/.test(l)), lines.join('\n'))
        const allUn = await runDisputePass({ state: s, concept: '動量', ids: ['D1', 'D2'], domain, seats: PANEL, ai: fakeAi({}), contentOf: () => null, at: AT })
        assert.deepEqual([allUn.ok, allUn.noop, allUn.unreadable], [true, true, ['D1', 'D2']])
    })

    it('中止(終審 §3 D5d):已判之頁照處置、未判之項本輪不動(ok、stopped、undecided);無任何已判者 → ok:false、stopped', async () => {
        const s = bumped(doubted())
        let n = 0
        const ai = fakeAi({ p1: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP }, p2: { 動量是否於台股有效: NOT, 價值因子是否失效: OPP } })
        // 第一頁兩席各一次呼叫後截止(shouldStop 於第三次呼叫前成立):每頁各自一頁(出處 50 字、上限 60 → 以 pageChars 不可自專步給,改以 contentOf 之字數撐過 SUPPORT_PAGE_CHARS)
        const r = await runDisputePass({ state: s, concept: '動量', ids: ['D1', 'D2'], domain, seats: { first: PANEL.first, second: PANEL.second }, ai, contentOf: () => 'x'.repeat(40_000), at: AT, shouldStop: () => n >= 2, onCall: () => { n++ } })
        assert.deepEqual([r.ok, r.stopped, r.decided, r.undecided, r.stats.disputeChecked], [true, true, ['D1'], ['D2'], 1])
        const none = await runDisputePass({ state: s, concept: '動量', ids: ['D1'], domain, seats: PANEL, ai: fakeAi({}), contentOf: () => 'x', at: AT, shouldStop: () => true })
        assert.deepEqual([none.ok, none.stopped], [false, true])
    })

    it('runDisputePass:截止 → stopped、不套用;無受檢項 → noop', async () => {
        const s = bumped(doubted())
        const r = await runDisputePass({ state: s, concept: '動量', ids: ['D1'], domain, seats: PANEL, ai: fakeAi({}), contentOf: () => 'x', at: AT, shouldStop: () => true })
        assert.deepEqual([r.ok, r.stopped], [false, true])
        const n = await runDisputePass({ state: s, concept: '動量', ids: [], domain, seats: PANEL, ai: fakeAi({}), at: AT })
        assert.deepEqual([n.ok, n.noop], [true, true])
    })

})
