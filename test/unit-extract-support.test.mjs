// unit-extract-support.test.mjs — 檢定標準 ES9(主張受所引出處支持;含 ES7 語氣)之純函數與判定(extract/standards/supportCheck)
// 規格:方案 v2 D(ES9:出處支持三分類＋語氣;新增／改寫於提交前覆核)、終審 ES9 條(以出處聯集判、材料用 md 去投影章)、
//   細目 tmp/standards-audit/D-plan.md §5.2(受檢斷言表、裁決、處置)。runPass 之整合案在 unit-extract-workflow。
// 執行:自套件根 npx mocha test/unit-extract-support.test.mjs

import assert from 'node:assert/strict'
import { PANEL_UNSURE } from '../src/core/summarizePackage.mjs'
import { applyDelta } from '../src/stores/coreDelta.mjs'
import { findItem, holdItems, withdrawSources } from '../src/stores/coreState.mjs'
import { ES9, claimAssertion, supportItemsOf, checkSupportVerdictOf, seatSupportVotesOf, packSupportPages, runSupportCheck, parseSupportChecks, checkSupportChecks, supportByEffects } from '../src/standards/supportCheck.mjs'
import { revisableOf, fieldsOf, applySupportFixes, supportFixesOf, runSupportRevise } from '../src/standards/supportRevise.mjs'
import { stockHashOf, stockNeedsOf, pickStock } from '../src/standards/supportStock.mjs'
import { EXTRACT_PANEL_WHY, panelRetryOf, panelWhyLabelOf } from '../src/standards/panelVotes.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { seedCore, ANN, panelCall } from './tools/extractKit.mjs'

const AT = '2026-10-04T20:00:00+08:00'
const SEED = [{ code: 'N0', id: 's0' }, { code: 'N9', id: 's9' }]
const BATCH = [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }]
const seeded = () => seedCore({ coreId: 'm', concept: '動量', ops: [
    { op: 'add', kind: 'rule', text: '動量報酬可持續 3 到 12 個月', conditions: ['美股'], period: '1990至2020年', sources: ['N0'], ...ANN },
    { op: 'dispute_add', question: '動量是否於台股有效', sides: [{ position: '台股動量顯著', sources: ['N0'] }, { position: '台股反轉主導', sources: ['N9'] }] },
], batch: SEED, at: AT })

describe('unit-extract-support', function() {

    it('claimAssertion:文字＋條件＋期間(條件與期間是斷言之範圍,一併受檢)', () => {
        assert.equal(claimAssertion({ text: '動量有效', conditions: ['美股', '大型股'], period: '2000年後' }), '動量有效（條件：美股；大型股）（期間：2000年後）')
        assert.equal(claimAssertion({ text: '動量有效' }), '動量有效')
    })

    it('supportItemsOf:add／confirm(既有主張、@ref 新主張、爭議之一方)／revise 改 text(既有出處＋新出處)／爭議各方(無出處之方不列)／contest(被列入之方);方之索引同 coreState("side 1"、同差量補方);其餘操作、無本批出處者與主體為空者不列', () => {
        const s = seeded()
        const c = s.claims[0]
        const d = s.disputes[0]
        const ops = [
            { op: 'add', ref: 'x', kind: 'rule', text: '盈餘反應不足使動量持續', conditions: ['美股'], sources: ['N1'], ...ANN },
            { op: 'confirm', id: c.id, sources: ['N2'] },
            { op: 'confirm', id: '@x', sources: ['N2'] },
            { op: 'confirm', id: d.id, side: 1, sources: ['N1'] },
            { op: 'confirm', id: d.id, sources: ['N1'] }, // 加到爭議本身(未指定方):無可核之斷言
            { op: 'revise', id: c.id, fields: { text: '動量報酬可持續 6 到 12 個月' }, reason: '新研究', sources: ['N1'] },
            { op: 'revise', id: c.id, fields: { critique: '只改銳評' }, reason: 'r', sources: ['N1'] }, // 不改 text:不核
            { op: 'dispute_add', question: '成本是否吃掉動量', sides: [{ position: '成本後仍有超額', sources: ['N1'] }, { position: '成本後消失', claims: [c.id] }] },
            { op: 'contest', id: c.id, dispute: d.id, side: 0, reason: '台股證據', sources: ['N2'] },
            { op: 'param_add', name: '形成期', value: '12 個月', sources: ['N1'] },
            { op: 'supersede', id: c.id, reason: 'r', validPeriod: '較早', sources: ['N1'] },
            { op: 'add', kind: 'rule', text: '無出處者', sources: [] },
            // 結構不合格(主體為空,只剩條件):不覆核,交 coreState 之結構驗證拒收(不誤判為「出處支持判不了」)
            { op: 'add', kind: 'rule', text: '', conditions: ['只有條件'], sources: ['N1'] },
            { op: 'dispute_add', question: '空立場', sides: [{ position: '', conditions: ['只有條件'], sources: ['N1'] }, { position: '另一方', sources: ['N2'] }] },
            // 方之索引與 coreState 同一解析("side 1" 亦合法——解析不同即有操作被套用卻未覆核);既有爭議之方含同差量 dispute_update 所補之方
            { op: 'confirm', id: d.id, side: 'side 1', sources: ['N2'] },
            { op: 'dispute_update', id: d.id, note: '補一方', sides_add: [{ position: '兩者皆非', sources: ['N1'] }] },
            { op: 'contest', id: c.id, dispute: d.id, side: '2', reason: '列入所補之方', sources: ['N1'] },
        ]
        const items = supportItemsOf(ops, { state: s, batch: BATCH })
        assert.deepEqual(items.map((x) => [x.key, x.kind, x.text, x.notes]), [
            ['0', 'add', '盈餘反應不足使動量持續（條件：美股）', ['n1']],
            ['1', 'confirm', '動量報酬可持續 3 到 12 個月（條件：美股）（期間：1990至2020年）', ['n2']],
            ['2', 'confirm', '盈餘反應不足使動量持續（條件：美股）', ['n2']],
            ['3', 'confirm', '台股反轉主導', ['n1']],
            ['5', 'revise', '動量報酬可持續 6 到 12 個月（條件：美股）（期間：1990至2020年）', ['s0', 'n1']],
            ['7:side0', 'side', '成本後仍有超額', ['n1']],
            ['8', 'contest', '台股動量顯著', ['n2']],
            ['13:side1', 'side', '另一方', ['n2']],
            ['14', 'confirm', '台股反轉主導', ['n2']],
            ['15:side0', 'side', '兩者皆非', ['n1']],
            ['16', 'contest', '兩者皆非', ['n1']],
        ])
        assert.ok(findItem(s, c.id))
        // 只改條件／期間亦改變斷言之範圍(claimAssertion)→ 受檢;整併之合併給新文字 → 受檢(出處＝被併各項之存活出處)(2026-10-05 審查 A-B2)
        const more = supportItemsOf([
            { op: 'revise', id: c.id, fields: { conditions: ['美股', '大型股'] }, reason: '補條件' },
            { op: 'revise', id: c.id, fields: { period: '2000至2020年' }, reason: '改期間' },
            { op: 'merge', into: c.id, from: [], text: '動量報酬可持續 3 到 12 個月（合併稿）', reason: 'r' },
            { op: 'merge', into: c.id, from: [], reason: '不給 text:into 原文不變,不核' },
        ], { state: s, batch: BATCH })
        assert.deepEqual(more.map((x) => [x.key, x.kind, x.text, x.notes]), [
            ['0', 'revise', '動量報酬可持續 3 到 12 個月（條件：美股；大型股）（期間：1990至2020年）', ['s0']],
            ['1', 'revise', '動量報酬可持續 3 到 12 個月（條件：美股）（期間：2000至2020年）', ['s0']],
            ['2', 'merge', '動量報酬可持續 3 到 12 個月（合併稿）（條件：美股）（期間：1990至2020年）', ['s0']],
        ])
        // 證據性質(basis)決定判準(推論類須寫明前提;2026-10-05 審查 A-B8):各項帶 basis——add 取操作、confirm／merge 取目標條、revise 取改後、
        //   爭議之方取該方;只改 basis 之 revise 亦受檢
        const withBasis = applyDelta(s, { ops: [{ op: 'revise', id: c.id, fields: { basis: '樣本外' }, reason: '補證據性質', sources: ['N0'] }] }, { batch: SEED, mode: 'delta', at: AT }).state
        const bs = supportItemsOf([
            { op: 'add', kind: 'rule', text: '成本敏感度推算', basis: '理論', sources: ['N1'], ...ANN },
            { op: 'confirm', id: c.id, sources: ['N2'] },
            { op: 'revise', id: c.id, fields: { basis: '理論' }, reason: '改為推論類' },
            { op: 'merge', into: c.id, from: [], text: '合併稿', reason: 'r' },
            { op: 'dispute_add', question: 'q', sides: [{ position: '甲方', basis: '轉述', sources: ['N1'] }, { position: '乙方', sources: ['N2'] }] },
        ], { state: withBasis, batch: BATCH })
        assert.deepEqual(bs.map((x) => [x.key, x.kind, x.basis]), [['0', 'add', '理論'], ['1', 'confirm', '樣本外'], ['2', 'revise', '理論'], ['3', 'merge', '樣本外'], ['4:side0', 'side', '轉述'], ['4:side1', 'side', '']])
    })

    it('checkSupportVerdictOf:supported(理由可空;by 未給＝未分別、給了須為本項所引);contradicted／insufficient／overclaim 理由須 ≥10 字;unsure 合法;其餘＝缺票', () => {
        assert.deepEqual(checkSupportVerdictOf({ verdict: 'SUPPORTED' }), { verdict: 'supported', reason: '', by: null })
        const L = new Set(['S1', 'S2'])
        assert.deepEqual(checkSupportVerdictOf({ verdict: 'supported', by: ['s2', 'S9'] }, L).by, ['S2'], '非本項所引者略去')
        assert.equal(checkSupportVerdictOf({ verdict: 'supported', by: ['S9'] }, L), null, '所列皆非本項所引 → 缺票')
        assert.deepEqual(checkSupportVerdictOf({ verdict: 'supported', by: [] }, L).by, null, '空陣列＝未分別')
        assert.deepEqual(checkSupportVerdictOf({ verdict: 'insufficient', reason: '出處只談美股，未談台股之情形' }).verdict, 'insufficient')
        assert.equal(checkSupportVerdictOf({ verdict: 'overclaim', reason: '太短' }), null)
        assert.equal(checkSupportVerdictOf({ verdict: 'unsure' }), PANEL_UNSURE)
        assert.equal(checkSupportVerdictOf({ verdict: 'yes' }), null)
        assert.equal(checkSupportVerdictOf('supported'), null)
    })

    it('seatSupportVotesOf:以編號對應、限本席所見、同編號矛盾 → 缺票;parse／check 形狀', () => {
        const j = parseSupportChecks('說明文字 {"checks":[{"index":1,"verdict":"supported"},{"index":2,"verdict":"supported"},{"index":2,"verdict":"contradicted","reason":"出處明載結論相反之數據"},{"index":9,"verdict":"supported"}]} 尾巴')
        assert.equal(checkSupportChecks(j), true)
        assert.equal(checkSupportChecks({ checks: 'x' }), false)
        const m = seatSupportVotesOf(j, new Set([1, 2]))
        assert.deepEqual([m.get(1)?.verdict, m.get(2), m.has(9)], ['supported', null, false])
    })

    it('packSupportPages:頁內出處(去重)字數逾上限即開新頁;同出處不重算;單項超上限獨佔一頁(不截斷)', () => {
        const size = { a: 40, b: 40, c: 100, d: 10 }
        const it = (key, notes) => ({ key, notes })
        const pages = packSupportPages([it('1', ['a']), it('2', ['a', 'b']), it('3', ['c']), it('4', ['d']), it('5', ['a'])], (n) => size[n], 90)
        assert.deepEqual(pages.map((p) => p.map((x) => x.key)), [['1', '2'], ['3'], ['4', '5']])
    })

    it('runSupportCheck:兩席一致 → 成立;不一致 → 第三席只送該些項;席位之實際供應者相同 → 未成立(same-provider);截止 → stopped;提示詞以 S 標示出處、各列一次', async () => {
        const domain = createExtractDomain({})
        const items = [{ key: '0', kind: 'add', text: '甲斷言', notes: ['n1'] }, { key: '1', kind: 'confirm', text: '乙斷言', notes: ['n1', 'n2'] }, { key: '2', kind: 'side', text: '丙斷言', notes: ['n2'] }]
        const prompts = []
        const verdictsBy = { check1: { 甲斷言: 'supported', 乙斷言: 'supported', 丙斷言: 'insufficient' }, check2: { 甲斷言: 'supported', 乙斷言: 'contradicted', 丙斷言: 'insufficient' }, check3: { 乙斷言: 'contradicted' } }
        const call = panelCall((stage, prompt) => {
            prompts.push({ stage, prompt })
            const its = [...prompt.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }))
            return { checks: its.map((x) => ({ index: x.index, verdict: verdictsBy[stage][x.text], reason: '出處之內容與斷言之關係說明' })) }
        })
        const r = await runSupportCheck({ items, concept: '動量', contentOf: (n) => `${n} 之內容`, titleOf: (n) => `${n} 標題`, buildPrompt: domain.buildSupportCheckPrompt, call, seats: { first: { use: 'p1' }, second: { use: 'p2' }, third: { use: 'p3' } } })
        assert.deepEqual([...r.decisions.entries()].map(([k, d]) => [k, d.status, d.verdict?.verdict]), [['0', 'decided', 'supported'], ['1', 'decided', 'contradicted'], ['2', 'decided', 'insufficient']])
        assert.equal(r.calls, 3)
        const third = prompts.find((x) => x.stage === 'check3').prompt
        assert.equal((third.match(/^--- 第\d+項/gm) || []).length, 1, '第三席只送未成立之項')
        const p1 = prompts.find((x) => x.stage === 'check1').prompt
        assert.match(p1, /=== 出處 S1：n1 標題 ===\nn1 之內容/)
        assert.equal((p1.match(/=== 出處 S/g) || []).length, 2, '出處各列一次')
        assert.match(p1, /所引出處：S1、S2/)
        // 同一供應者
        const same = await runSupportCheck({ items: items.slice(0, 1), concept: '動量', contentOf: () => 'x', buildPrompt: domain.buildSupportCheckPrompt, call: async (stage, seat, prompt) => ({ ...(await call(stage, seat, prompt)), providerId: 'p1' }), seats: { first: { use: 'p1' }, second: { use: 'p2' } } })
        assert.deepEqual([same.decisions.get('0').status, same.decisions.get('0').why], ['undetermined', 'same-provider'])
        const stop = await runSupportCheck({ items, concept: '動量', contentOf: () => 'x', buildPrompt: domain.buildSupportCheckPrompt, call: async () => ({ ok: false, stopped: true }), seats: { first: { use: 'p1' }, second: { use: 'p2' } } })
        assert.equal(stop.stopped, true)
    })

    it('分頁與中止(終審 §3 D5d;standards/panelVotes 之 runPanelPages):頁放不下(任一席 oversize)→ 對半分再送;單項仍放不下 → 材料過大(非重試之對象);中止 → 已判之頁照回、未判列 undecided', async () => {
        const domain = createExtractDomain({})
        const items = [1, 2, 3, 4].map((k) => ({ key: String(k), kind: 'add', text: `斷言${k}`, notes: [`n${k}`] }))
        const seats = { first: { use: 'p1' }, second: { use: 'p2' } }
        const sizes = []
        // 兩項以上之頁放不下(第一席 oversize);單項可判
        const call = async (stage, seat, prompt) => {
            const its = [...prompt.matchAll(/^--- 第(\d+)項/gm)].map((m) => Number(m[1]))
            sizes.push(its.length)
            if (its.length > 1) return { ok: false, error: 'oversize', oversize: true }
            return { ok: true, providerId: seat.use, json: { checks: its.map((index) => ({ index, verdict: 'supported', reason: '出處直接陳述此斷言之內容' })) } }
        }
        const r = await runSupportCheck({ items, concept: '動量', contentOf: (n) => `${n} 之內容`, buildPrompt: domain.buildSupportCheckPrompt, call, seats })
        assert.deepEqual([...r.decisions.values()].map((d) => d.status), ['decided', 'decided', 'decided', 'decided'])
        assert.deepEqual([r.oversize, r.stopped, r.undecided], [[], false, []])
        assert.deepEqual(sizes.slice(0, 4), [4, 4, 2, 2], '整頁放不下 → 對半分(4 → 2 → 1)')
        // 單項仍放不下 → 材料過大:不是重試之對象(panelRetryOf false),字樣取 panelWhyLabelOf
        const big = await runSupportCheck({ items: items.slice(0, 1), concept: '動量', contentOf: () => 'x', buildPrompt: domain.buildSupportCheckPrompt, call: async () => ({ ok: false, oversize: true }), seats })
        assert.deepEqual([big.decisions.get('1').status, big.decisions.get('1').why, big.oversize, panelRetryOf(big.decisions.get('1')), panelWhyLabelOf(big.decisions.get('1').why)], ['undetermined', EXTRACT_PANEL_WHY.OVERSIZE, ['1'], false, '材料過大（單項已超過席位可容）'])
        // 中止:第二頁(各項獨佔一頁)中止 → 第一頁照回、其餘列 undecided
        let n = 0
        const stopCall = async (stage, seat, prompt) => {
            const its = [...prompt.matchAll(/^--- 第(\d+)項/gm)].map((m) => Number(m[1]))
            if (++n > 2) return { ok: false, error: 'stopped', stopped: true }
            return { ok: true, providerId: seat.use, json: { checks: its.map((index) => ({ index, verdict: 'supported', reason: '出處直接陳述此斷言之內容' })) } }
        }
        const st = await runSupportCheck({ items, concept: '動量', contentOf: () => 'x'.repeat(50), buildPrompt: domain.buildSupportCheckPrompt, call: stopCall, seats, pageChars: 60 })
        assert.deepEqual([st.stopped, [...st.decisions.keys()], st.undecided], [true, ['1'], ['2', '3', '4']])
    })

    it('支持之出處(⑳ 排除集之依據):成立受支持時 supportBy＝成對兩票所列之聯集(筆記 id);任一票未分別 → null;by 之標號依本項所引驗證', async () => {
        const domain = createExtractDomain({})
        const items = [{ key: '0', kind: 'add', text: '甲斷言', notes: ['n1', 'n2', 'n3'] }, { key: '1', kind: 'add', text: '乙斷言', notes: ['n1', 'n2'] }]
        const byOf = { check1: { 甲斷言: ['S1'], 乙斷言: null }, check2: { 甲斷言: ['S2'], 乙斷言: ['S1'] } }
        const call = panelCall((stage, prompt) => {
            const its = [...prompt.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }))
            return { checks: its.map((x) => ({ index: x.index, verdict: 'supported', ...(byOf[stage][x.text] ? { by: byOf[stage][x.text] } : {}), reason: '出處直接陳述此斷言之內容' })) }
        })
        const r = await runSupportCheck({ items, concept: '動量', contentOf: (n) => `${n} 之內容`, titleOf: (n) => n, buildPrompt: domain.buildSupportCheckPrompt, call, seats: { first: { use: 'p1' }, second: { use: 'p2' } } })
        assert.deepEqual(r.decisions.get('0').supportBy.sort(), ['n1', 'n2'], '兩席所列之聯集(兩席皆未列者 n3 才排除)')
        assert.equal(r.decisions.get('1').supportBy, null, '有一票未分別 → 不排除')
        const p = createExtractDomain({}).buildSupportCheckPrompt({ concept: '動量', sources: [], items: [] })
        assert.ok(p.includes('by 列出所引出處中真正支持該斷言之出處編號') && p.includes('"verdict":"supported","by":["S1"]'), '提示詞要求 by')
    })

    it('supportByEffects:新增出處之操作(add／confirm／爭議之方／contest)移除兩席皆未列者;既有主張之 revise／merge 記排除集(皆列 → 清空);未分別者不動', () => {
        const s = seeded()
        const c = s.claims[0]
        const d = s.disputes[0]
        const ops = [
            { op: 'add', ref: 'x', kind: 'rule', text: '新主張', sources: ['N1', 'N2'], ...ANN },
            { op: 'confirm', id: c.id, sources: ['N1', 'N2'] },
            { op: 'dispute_add', question: 'q', sides: [{ position: '甲方', sources: ['N1', 'N2'] }, { position: '乙方', sources: ['N2'] }] },
            { op: 'revise', id: c.id, fields: { text: '動量報酬可持續 6 到 12 個月' }, reason: 'r', sources: ['N1'] },
            { op: 'contest', id: c.id, dispute: d.id, side: 0, reason: 'r', sources: ['N1', 'N2'] },
            { op: 'merge', into: c.id, from: [], text: '合併稿', reason: 'r' },
        ]
        const items = supportItemsOf(ops, { state: s, batch: BATCH })
        const sup = (by) => ({ status: 'decided', verdict: { verdict: 'supported' }, supportBy: by })
        const decisions = new Map([['0', sup(['n1'])], ['1', sup(['n2'])], ['2:side0', sup(['n1'])], ['2:side1', sup(null)], ['3', sup(['n1'])], ['4', sup(['n1', 'n2'])], ['5', sup(['s0'])]])
        const eff = supportByEffects(items, decisions, { batch: BATCH })
        assert.deepEqual(eff.patched.get(ops[0]).sources, ['N1'], 'add:移除未列之 N2')
        assert.deepEqual(eff.patched.get(ops[1]).sources, ['N2'])
        assert.deepEqual(eff.patched.get(ops[2]).sides.map((x) => x.sources), [['N1'], ['N2']], '爭議之方逐方移除;未分別之方不動')
        assert.equal(eff.patched.has(ops[4]), false, '皆列 → 不動')
        assert.deepEqual(eff.exclusions.map((e) => [e.id, e.ids.sort()]), [[c.id, ['s0']], [c.id, []]], 'revise:既有出處 s0 未列 → 排除;merge:皆列 → 清空(以新結果取代)')
        assert.equal(eff.dropped, 3)
        assert.equal(ops[0].sources.length, 2, '不改原操作')
    })

    it('判定取類別(受支持與否):兩家皆判不受支持而原因不同(contradicted／overclaim)→ 成立為不受支持,不叫第三席;受支持對不受支持 → 叫第三席', async () => {
        const domain = createExtractDomain({})
        const by = { check1: 'contradicted', check2: 'overclaim', check3: 'supported' }
        const stages = []
        const call = panelCall((stage, prompt) => {
            stages.push(stage)
            const its = [...prompt.matchAll(/^--- 第(\d+)項/gm)].map((m) => Number(m[1]))
            return { checks: its.map((index) => ({ index, verdict: by[stage], reason: '出處之內容與斷言之關係說明' })) }
        })
        const r = await runSupportCheck({ items: [{ key: '0', kind: 'add', text: '甲', notes: ['n1'] }], concept: '動量', contentOf: () => 'x', buildPrompt: domain.buildSupportCheckPrompt, call, seats: { first: { use: 'p1' }, second: { use: 'p2' }, third: { use: 'p3' } } })
        const d = r.decisions.get('0')
        assert.deepEqual([d.status, d.verdict.verdict !== 'supported', stages], ['decided', true, ['check1', 'check2']])
    })

    it('ES9 提示詞:判準五類(含 overclaim 與「只看所引出處」)、unsure 合法、輸出形狀 checks;判準依證據性質(推論類須寫明前提,其餘須直接陳述;類別由程式標示)', () => {
        const p = createExtractDomain({}).buildSupportCheckPrompt({ concept: '動量', sources: [{ label: 'S1', title: 't', text: 'x' }], items: [{ index: 1, kind: 'add', text: '斷言', labels: ['S1'] }, { index: 2, kind: 'add', text: '推算', basis: '理論', labels: ['S1'] }] })
        for (const s of ['supported：', 'contradicted：', 'insufficient：', 'overclaim：', 'unsure：', '只看「所引出處」', '拿不準就回 unsure，不要猜', '{"checks":[', '--- 第1項（新增主張；證據性質：未標；非推論類）---\n斷言：斷言\n所引出處：S1', '--- 第2項（新增主張；證據性質：理論；推論類）---\n斷言：推算']) assert.ok(p.includes(s), s)
        for (const s of ['・非推論類之項：所引出處本身寫出了斷言的結論（同義改寫亦可）。斷言即使寫了前提或推算過程，只要結論須自行計算或推論才得到，就不算', '・推論類之項：斷言可由所引出處明載的內容推得，且斷言本身寫明了推論所依的前提（前提須為所引出處明載）', '・兩類皆須：斷言所附的條件、期間與所引出處相符', '・同義改寫＝措辭不同而所指之對象、範圍、條件與所引出處相同', '非推論類之項須推論才得到、推論類之項未寫明前提者，亦是 insufficient', '把結論擴大到出處未涵蓋之範圍']) assert.ok(p.includes(s), s)
        assert.ok(createExtractDomain({}).buildSupportCheckPrompt({ concept: '動量', sources: [], items: [{ index: 1, kind: 'claim', text: '斷言', labels: [] }] }).includes('第1項（既有主張；'), '存量覆核之項標「既有主張」')
        // 起草規則須告知同一判準(否則推論所得之主張一律被覆核判不受支持):evidence 規則含推論類之寫法
        const rule = createExtractDomain({}).rules.find((r) => r.id === 'evidence').text
        assert.match(rule, /由出處推算或推論而得（出處未直接陳述）之主張，basis 須含「理論」，並在 text 或 conditions 寫明所依之前提/)
        assert.match(createExtractDomain({ vocab: { inferenceBasis: [] } }).rules.find((r) => r.id === 'evidence').text, /主張須為出處直接陳述之內容（同義改寫可），不寫入推論/)
    })

    // 終審 §3.5 ES7「語氣超出證據 → 修訂補丁」(extract/standards/supportRevise;細目 F-plan §1.3)
    describe('依出處收斂措辭之修訂(supportRevise)', function() {
        const vote = (seat, provider, verdict) => ({ seat, provider, verdict: verdict === 'unsure' ? 'unsure' : { verdict, reason: '出處只涉及美股樣本內' } })
        const decided = (a, b) => ({ status: 'decided', verdict: { verdict: a }, votes: [vote('first', 'p1', a), vote('second', 'p2', b)] })

        it('revisableOf:成立不受支持且原因含 overclaim、無 contradicted 才可修訂;受支持、未成立、有陳述相反者不可', () => {
            assert.equal(revisableOf(decided('overclaim', 'overclaim')), true)
            assert.equal(revisableOf(decided('overclaim', 'insufficient')), true, '兩家原因不同而含語氣超出')
            assert.equal(revisableOf(decided('insufficient', 'insufficient')), false, '只有未涉及／不足 → 非措辭問題')
            assert.equal(revisableOf(decided('overclaim', 'contradicted')), false, '有一家判陳述相反')
            assert.equal(revisableOf(decided('supported', 'supported')), false)
            assert.equal(revisableOf({ status: 'undetermined', why: 'unsure', votes: [] }), false)
        })

        it('fieldsOf／applySupportFixes:add 改 text／conditions／period;revise 改 fields(未改之欄取原條目);方改立場與條件;回新操作不改輸入', () => {
            const add = { op: 'add', text: '動量普遍有效', conditions: [], period: '' }
            assert.deepEqual(fieldsOf({ kind: 'add', op: add, key: '0' }), { text: '動量普遍有效', conditions: [], period: '' })
            const out = applySupportFixes(add, [{ it: { kind: 'add', key: '0' }, fix: { text: '動量於美股樣本內有效', conditions: ['美股'], period: '1990至2020年' } }])
            assert.deepEqual([out.text, out.conditions, out.period, add.text], ['動量於美股樣本內有效', ['美股'], '1990至2020年', '動量普遍有效'])
            const rv = { op: 'revise', id: 'C1', fields: { text: '新文字' } }
            assert.deepEqual(fieldsOf({ kind: 'revise', op: rv, key: '1' }, { text: '舊', conditions: ['甲'], period: '近年' }), { text: '新文字', conditions: ['甲'], period: '近年' })
            assert.deepEqual(applySupportFixes(rv, [{ it: { kind: 'revise', key: '1' }, fix: { text: '收斂後', conditions: ['乙'] } }]).fields, { text: '收斂後', conditions: ['乙'] })
            const da = { op: 'dispute_add', sides: [{ position: '甲方', conditions: [] }], sides_add: [] }
            const du = { op: 'dispute_update', id: 'D1', sides: [], sides_add: [{ position: '補方', conditions: [] }] }
            assert.deepEqual(fieldsOf({ kind: 'side', op: da, key: '2:side0' }), { text: '甲方', conditions: [], period: '' })
            assert.equal(applySupportFixes(da, [{ it: { kind: 'side', key: '2:side0' }, fix: { text: '甲方（限美股）', conditions: ['美股'] } }]).sides[0].position, '甲方（限美股）')
            assert.equal(applySupportFixes(du, [{ it: { kind: 'side', key: '3:side0' }, fix: { text: '補方收斂' } }]).sides_add[0].position, '補方收斂', '索引跨 sides 與 sides_add')
        })

        it('supportFixesOf:drop、空 text、同編號多份、未送出之編號 → 不採(照原處置)', () => {
            const got = supportFixesOf({ fixes: [{ index: 1, text: '甲' }, { index: 2, drop: true }, { index: 3, text: ' ' }, { index: 4, text: 'a' }, { index: 4, text: 'b' }, { index: 9, text: '外' }] }, new Set([1, 2, 3, 4]))
            assert.deepEqual([...got.keys()], [1])
        })

        it('runSupportRevise:修訂項連同出處入同一頁(放不下者不送、不截斷);一次呼叫;截止 → stopped', async () => {
            const content = { n1: 'x'.repeat(40), n2: 'y'.repeat(40) }
            const targets = [
                { it: { key: 'a', kind: 'add', notes: ['n1'] }, d: decided('overclaim', 'overclaim'), fields: { text: '甲', conditions: [], period: '' } },
                { it: { key: 'b', kind: 'add', notes: ['n2'] }, d: decided('overclaim', 'overclaim'), fields: { text: '乙', conditions: [], period: '' } },
            ]
            const prompts = []
            const call = panelCall((stage, prompt) => {
                prompts.push(prompt)
                return { fixes: [{ index: 1, text: '甲收斂' }] }
            })
            const r = await runSupportRevise({ targets, concept: '動量', contentOf: (n) => content[n], buildPrompt: createExtractDomain({}).buildSupportRevisePrompt, call, seat: { use: 'rev' }, pageChars: 60 })
            assert.deepEqual([[...r.fixes.keys()], r.skipped, r.calls, prompts.length], [['a'], ['b'], 1, 1])
            assert.match(prompts[0], /=== 出處 S1：n1 ===/)
            assert.match(prompts[0], /覆核說明：語氣超出證據：出處只涉及美股樣本內/)
            const st = await runSupportRevise({ targets, concept: '動量', contentOf: (n) => content[n], buildPrompt: createExtractDomain({}).buildSupportRevisePrompt, call: async () => ({ ok: false, stopped: true }), seat: { use: 'rev' } })
            assert.equal(st.stopped, true)
        })

        it('修訂提示詞:只改三欄、不得加入出處沒有之內容、改不成回 drop、輸出形狀 fixes', () => {
            const p = createExtractDomain({}).buildSupportRevisePrompt({ concept: '動量', sources: [{ label: 'S1', title: 't', text: 'x' }], items: [{ index: 1, kind: 'claim', text: '斷言', conditions: ['美股'], period: '', labels: ['S1'], reasons: ['語氣超出證據：只涉及樣本內'] }] })
            for (const s of ['語氣超出證據', '不得加入出處沒有的內容', '"drop":true', '{"fixes":[', '--- 第1項（既有主張）---', '條件：美股', '覆核說明：語氣超出證據：只涉及樣本內']) assert.ok(p.includes(s), s)
        })
    })

    // 檢定標準 ES9 存量(extract/standards/supportStock;細目 F-plan §3)
    describe('出處支持之存量覆核(supportStock)', function() {
        const keyOf = (n) => `k-${n}`

        it('stockHashOf:斷言(文字＋條件＋期間)、證據性質、存活出處(排序)、各出處之內容鍵,任一變即變', () => {
            const c = { text: '甲', conditions: ['美股'], period: '' }
            const h = stockHashOf(c, ['n2', 'n1'], keyOf)
            assert.equal(h, stockHashOf(c, ['n1', 'n2'], keyOf), '出處順序不影響')
            assert.notEqual(h, stockHashOf({ ...c, text: '乙' }, ['n1', 'n2'], keyOf))
            assert.notEqual(h, stockHashOf({ ...c, conditions: ['台股'] }, ['n1', 'n2'], keyOf))
            assert.notEqual(h, stockHashOf({ ...c, basis: '理論' }, ['n1', 'n2'], keyOf), '證據性質變(判準依推論類與否,ES9 v2)→ 重檢')
            assert.notEqual(h, stockHashOf(c, ['n1'], keyOf))
            assert.notEqual(h, stockHashOf(c, ['n1', 'n2'], (n) => `k2-${n}`))
        })

        it('stockNeedsOf:從未檢、雜湊或版本變者須檢;已檢未變者不檢;終態、出處全撤(ES8 之範圍)不列;隔離者只在雜湊變或要求重試時再檢', () => {
            const s = seeded()
            const c = s.claims[0]
            const none = stockNeedsOf(s, { coreId: 'm', recOf: () => null, keyOf })
            assert.deepEqual(none.map((x) => [x.id, x.never, x.held]), [[c.id, true, false]])
            const hash = none[0].hash
            const rec = { hash, results: { ES9: { v: ES9.v, status: 'pass' } } }
            assert.deepEqual(stockNeedsOf(s, { coreId: 'm', recOf: (oid) => (oid === `m:${c.id}` ? rec : null), keyOf }), [], '已檢未變者不檢')
            assert.equal(stockNeedsOf(s, { coreId: 'm', recOf: () => ({ hash, results: { ES9: { v: ES9.v - 1 } } }), keyOf }).length, 1, '標準版本變(v1 之紀錄於 v2 判準依證據性質後作廢)→ 重檢')
            assert.equal(stockNeedsOf(s, { coreId: 'm', recOf: () => rec, keyOf: (n) => `x-${n}` }).length, 1, '出處內容鍵變 → 重檢')
            assert.equal(stockNeedsOf(s, { coreId: 'm', recOf: () => rec, keyOf, retry: new Set([c.id]) }).length, 1, '使用者要求重試 → 重檢')
            const held = holdItems(s, [{ id: c.id, std: 'ES9', why: 'x', hash }], { at: AT }).state
            assert.deepEqual(stockNeedsOf(held, { coreId: 'm', recOf: () => null, keyOf }), [], '隔離而雜湊未變 → 待使用者')
            assert.deepEqual(stockNeedsOf(held, { coreId: 'm', recOf: () => null, keyOf: (n) => `y-${n}` }).map((x) => [x.id, x.held]), [[c.id, true]], '隔離後內容變 → 再檢')
            const gone = withdrawSources(s, { withdraw: [{ id: 's0', title: 't' }], at: AT }).state
            assert.deepEqual(stockNeedsOf(gone, { coreId: 'm', recOf: () => null, keyOf }), [], '出處全撤 → ES8 之範圍')
        })

        it('pickStock:從未檢者先、其次重檢;同級依核心 id、原序;截至上限;0 → 不取', () => {
            const rows = [{ cid: 'b', id: 'C1', never: false }, { cid: 'a', id: 'C2', never: false }, { cid: 'b', id: 'C3', never: true }, { cid: 'a', id: 'C4', never: true }]
            assert.deepEqual(pickStock(rows, 3).map((x) => `${x.cid}:${x.id}`), ['a:C4', 'b:C3', 'a:C2'])
            assert.deepEqual(pickStock(rows, 0), [])
        })
    })

})
