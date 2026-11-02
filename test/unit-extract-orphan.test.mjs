// unit-extract-orphan.test.mjs — 檢定標準 ES8(失撐主張之專責佇列:出處筆記全撤之主張於已消化筆記中找支持)之純函數與判定小組
//   (extract/standards/orphanCheck、workflow/orphanPass)
// 規格:終審 §3.5 P1-8「孤兒主張專責佇列(不等選題)→ 於已消化筆記中找支持 → 兩席一致無支持才撤回(理由專用、出處筆記還原時復活)」;
//   細目 tmp/standards-audit/F-plan.md §4。提煉段之整合案在 unit-extract-stage。
// 執行:自套件根 npx mocha test/unit-extract-orphan.test.mjs

import assert from 'node:assert/strict'
import { withdrawSources, holdItems, findItem } from '../src/stores/coreState.mjs'
import { ES8, orphanCandidatesOf, orphanHashOf, orphanNeedsOf, checkOrphanVerdictOf, sameOrphan, seatOrphanVotesOf, packOrphanPages, agreedLabelsOf, runOrphanCheck } from '../src/standards/orphanCheck.mjs'
import { runOrphanPass } from '../src/workflow/orphanPass.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { seedCore, ANN, panelCall, panelAi } from './tools/extractKit.mjs'

const AT = '2026-10-05T10:00:00+08:00'
const B = [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }, { code: 'N3', id: 'n3' }]
/** 三條主張各引一篇;n1 刪除後 C1 失撐 */
const orphaned = () => {
    const s = seedCore({ coreId: 'k', concept: '動量', ops: [
        { op: 'add', kind: 'rule', text: '動量於美股可持續 3 到 12 個月', sources: ['N1'], ...ANN },
        { op: 'add', kind: 'rule', text: '動量崩潰多發生於空頭反轉', sources: ['N2'], ...ANN },
        { op: 'add', kind: 'rule', text: '交易成本侵蝕動量報酬', sources: ['N3'], ...ANN },
    ], batch: B, at: AT })
    return withdrawSources(s, { withdraw: [{ id: 'n1', title: '筆記一' }], at: AT }).state
}
const vote = (seat, provider, v) => ({ seat, provider, verdict: v })

describe('unit-extract-orphan', function() {

    it('orphanCandidatesOf:已消化、未撤、記錄仍在者;orphanHashOf:斷言＋證據性質＋候選(排序)', () => {
        const s = orphaned()
        assert.deepEqual(orphanCandidatesOf(s), ['n2', 'n3'])
        assert.deepEqual(orphanCandidatesOf(s, (n) => n !== 'n3'), ['n2'])
        const c = s.claims[0]
        assert.equal(orphanHashOf(c, ['n3', 'n2']), orphanHashOf(c, ['n2', 'n3']))
        assert.notEqual(orphanHashOf(c, ['n2']), orphanHashOf(c, ['n2', 'n3']), '候選變 → 重判')
        assert.notEqual(orphanHashOf({ ...c, basis: '理論' }, ['n2']), orphanHashOf(c, ['n2']), '證據性質變(判準依推論類與否)→ 重判')
        // 候選之內容鍵入雜湊(終審 §3 D5g:判定所讀之素材變即重判);未給 keyOf 只比結構
        const k1 = (nid) => `${nid}:v1`
        assert.equal(orphanHashOf(c, ['n2', 'n3'], k1), orphanHashOf(c, ['n3', 'n2'], k1), '含內容鍵亦不依序')
        assert.notEqual(orphanHashOf(c, ['n2', 'n3'], k1), orphanHashOf(c, ['n2', 'n3'], (nid) => (nid === 'n2' ? 'n2:v2' : k1(nid))), '一篇候選之內容變 → 重判')
        assert.notEqual(orphanHashOf(c, ['n2', 'n3'], k1), orphanHashOf(c, ['n2', 'n3']), '有無內容鍵不同雜湊')
    })

    it('orphanNeedsOf:只列出處全撤之主張(非隔離);已檢而候選未變者不列;要求重試者列;無候選者不列', () => {
        const s = orphaned()
        const need = orphanNeedsOf(s, { coreId: 'k', recOf: () => null })
        assert.deepEqual(need.map((x) => x.id), ['C1'])
        const rec = { hash: need[0].hash, results: { ES8: { v: ES8.v, status: 'undetermined' } } }
        assert.deepEqual(orphanNeedsOf(s, { coreId: 'k', recOf: () => rec }), [])
        assert.equal(orphanNeedsOf(s, { coreId: 'k', recOf: () => ({ ...rec, results: { ES8: { v: ES8.v - 1, status: 'pass' } } }) }).length, 1, '標準版本變(ES8 v2:判準依證據性質)→ 重判')
        assert.equal(orphanNeedsOf(s, { coreId: 'k', recOf: () => rec, retry: new Set(['C1']) }).length, 1)
        assert.deepEqual(orphanNeedsOf(s, { coreId: 'k', recOf: () => null, has: () => false }), [], '無存活候選')
        const held = holdItems(orphaned(), [{ id: 'C2', std: 'ES9', why: 'x' }], { at: AT }).state
        assert.deepEqual(orphanNeedsOf(held, { coreId: 'k', recOf: () => null }).map((x) => x.id), ['C1'], '隔離(ES9)者不屬 ES8')
    })

    it('checkOrphanVerdictOf／sameOrphan／seatOrphanVotesOf:supported 須列本頁之筆記;理由 ≥10 字;同為 none 或所列筆記有交集才相同;同編號矛盾 → 缺票', () => {
        const L = new Set(['S1', 'S2'])
        assert.deepEqual(checkOrphanVerdictOf({ verdict: 'supported', by: ['s2', 'S9'], reason: '筆記第二段直接陳述此主張' }, L), { verdict: 'supported', by: ['S2'], reason: '筆記第二段直接陳述此主張' })
        assert.equal(checkOrphanVerdictOf({ verdict: 'supported', by: ['S9'], reason: '筆記第二段直接陳述此主張' }, L), null, '所列筆記皆不在本頁 → 缺票')
        assert.equal(checkOrphanVerdictOf({ verdict: 'supported', by: ['S1'], reason: '九個字之理由說明' }, L), null, '理由不足 10 字 → 缺票')
        assert.equal(checkOrphanVerdictOf({ verdict: 'none', reason: '短' }, L), null)
        assert.equal(checkOrphanVerdictOf({ verdict: 'unsure' }, L), 'unsure')
        const a = { verdict: 'supported', by: ['S1', 'S2'] }
        assert.equal(sameOrphan(a, { verdict: 'supported', by: ['S2'] }), true)
        assert.equal(sameOrphan(a, { verdict: 'supported', by: ['S3'] }), false, '各指不同筆記 → 不同')
        assert.equal(sameOrphan({ verdict: 'none', by: [] }, { verdict: 'none', by: [] }), true)
        const v = seatOrphanVotesOf({ checks: [{ index: 1, verdict: 'none', reason: '候選筆記皆未涉及此主張' }, { index: 1, verdict: 'supported', by: ['S1'], reason: '筆記第一段直接陳述此主張' }] }, new Set([1]), L)
        assert.equal(v.get(1), null)
    })

    it('packOrphanPages:依字數分頁、單篇超過上限獨佔一頁(不截斷);agreedLabelsOf:成對兩票所列之交集', () => {
        const size = { a: 30, b: 30, c: 100, d: 10 }
        assert.deepEqual(packOrphanPages(['a', 'b', 'c', 'd'], (n) => size[n], 60), [['a', 'b'], ['c'], ['d']])
        const d = { status: 'decided', verdict: { verdict: 'supported' }, seats: ['first', 'third'], votes: [vote('first', 'p1', { verdict: 'supported', by: ['S1', 'S3'] }), vote('second', 'p2', { verdict: 'none', by: [] }), vote('third', 'p3', { verdict: 'supported', by: ['S3'] })] }
        assert.deepEqual(agreedLabelsOf(d), ['S3'])
    })

    it('runOrphanCheck:逐頁兩席＋第三席;任一頁成立 supported → 補出處(交集);每頁皆成立 none → none;有頁判不了 → held;有頁缺票 → retry', async () => {
        const content = { n2: 'x'.repeat(50), n3: 'y'.repeat(50) }
        const items = [{ key: 'C1', text: '動量於美股可持續 3 到 12 個月' }]
        const mkCall = (byStage) => panelCall((stage, prompt) => {
            const f = byStage[stage]
            if (f === 'fail') return 'fail'
            const labels = [...prompt.matchAll(/^=== 筆記 (S\d+)：(\S+) ===$/gm)].map((m) => ({ label: m[1], note: m[2] }))
            return { checks: [f(labels)] }
        }, { provider: 'stage' })
        const base = { items, notes: ['n2', 'n3'], concept: '動量', contentOf: (n) => content[n], titleOf: (n) => n, buildPrompt: createExtractDomain({}).buildOrphanCheckPrompt, seats: { first: { use: 'a' }, second: { use: 'b' }, third: { use: 'c' } }, pageChars: 60 }
        const sup = (note) => (ls) => (ls.some((x) => x.note === note) ? { index: 1, verdict: 'supported', by: [ls.find((x) => x.note === note).label], reason: '該筆記直接陳述此主張' } : { index: 1, verdict: 'none', reason: '本頁筆記皆未涉及此主張' })
        const none = () => ({ index: 1, verdict: 'none', reason: '本頁筆記皆未涉及此主張' })
        const r1 = await runOrphanCheck({ ...base, call: mkCall({ orphan1: sup('n3'), orphan2: sup('n3') }) })
        assert.deepEqual([r1.pages, r1.results.get('C1').status, r1.results.get('C1').notes], [2, 'supported', ['n3']], '第二頁兩席同指 n3')
        const r2 = await runOrphanCheck({ ...base, call: mkCall({ orphan1: none, orphan2: none }) })
        assert.equal(r2.results.get('C1').status, 'none')
        const r3 = await runOrphanCheck({ ...base, call: mkCall({ orphan1: none, orphan2: sup('n2'), orphan3: () => ({ index: 1, verdict: 'unsure' }) }) })
        assert.deepEqual([r3.results.get('C1').status, r3.results.get('C1').why], ['held', 'unsure'], '第一頁不一致且第三席不確定 → 不能斷言皆無')
        const r4 = await runOrphanCheck({ ...base, call: mkCall({ orphan1: none, orphan2: 'fail' }) })
        assert.deepEqual([r4.results.get('C1').status, r4.results.get('C1').why], ['retry', 'missing'])
    })

    it('runOrphanPass:補出處(confirm,出處＝交集筆記)→ 不再失撐;皆無 → 撤回「出處已撤他篇無支持」;判不了 → held 列待判、狀態不變;記錄供檢核紀錄', async () => {
        const domain = createExtractDomain({})
        const notesById = new Map(['n2', 'n3'].map((id) => [id, { id, title: id }]))
        const ai = (answer) => panelAi((stage, prompt) => ({ checks: [answer(prompt)] }))
        const lab = (prompt, note) => [...prompt.matchAll(/^=== 筆記 (S\d+)：(\S+) ===$/gm)].find((m) => m[2] === note)[1]
        const seats = { first: { use: 'a' }, second: { use: 'b' } }
        const s = orphaned()
        const ok = await runOrphanPass({ state: s, concept: '動量', ids: ['C1'], domain, seats, ai: ai((p) => ({ index: 1, verdict: 'supported', by: [lab(p, 'n2')], reason: '該筆記直接陳述此主張' })), notesById, contentOf: (n) => `${n} 之內容`, at: AT })
        assert.equal(ok.ok, true, ok.error)
        assert.deepEqual([findItem(ok.state, 'C1').item.sources, ok.stats.orphanResourced, ok.checks[0].status], [['n1', 'n2'], 1, 'pass'])
        const no = await runOrphanPass({ state: s, concept: '動量', ids: ['C1'], domain, seats, ai: ai(() => ({ index: 1, verdict: 'none', reason: '候選筆記皆未涉及此主張' })), notesById, contentOf: (n) => `${n} 之內容`, at: AT })
        assert.deepEqual([findItem(no.state, 'C1').item.status, findItem(no.state, 'C1').item.retractReason, no.checks[0].status], ['retracted', '出處已撤他篇無支持', 'violation'])
        const und = await runOrphanPass({ state: s, concept: '動量', ids: ['C1'], domain, seats, ai: ai(() => ({ index: 1, verdict: 'unsure' })), notesById, contentOf: (n) => `${n} 之內容`, at: AT })
        assert.deepEqual([und.state, und.held.map((h) => h.id), und.checks[0].status], [s, ['C1'], 'undetermined'], '判不了 → 狀態不變(仍為衍生隔離)')
        const noop = await runOrphanPass({ state: s, concept: '動量', ids: [], domain, seats, ai: ai(() => ({})), notesById, at: AT })
        assert.equal(noop.noop, true, '無受檢項 → 不呼叫 AI')
    })

    it('runOrphanPass:全部受檢項皆缺票或同一供應者 → 專步層之失敗(ok:false,不逐項計次——呼叫端退避);部分 → 該項重試、其餘照處置', async () => {
        const domain = createExtractDomain({})
        const notesById = new Map([['n3', { id: 'n3', title: 'n3' }]])
        // n1、n2 皆刪除 → C1、C2 失撐;候選只剩 n3
        const two = withdrawSources(orphaned(), { withdraw: [{ id: 'n2', title: '筆記二' }], at: AT }).state
        // 第一、二席成交於同一家(p1);第三席另一家:第 1 項判皆無支持,第 2 項不確定
        const reply = (stage, prompt) => ({ checks: [...prompt.matchAll(/^--- 第(\d+)項/gm)].map((m) => (stage === 'c' && m[1] === '2' ? { index: 2, verdict: 'unsure' } : { index: Number(m[1]), verdict: 'none', reason: '候選筆記皆未涉及此主張' })) })
        const ai = panelAi(reply, { provider: (stage) => (stage === 'c' ? 'pc' : 'p1') })
        const base = { state: two, concept: '動量', ids: ['C1', 'C2'], domain, ai, notesById, contentOf: (n) => `${n} 之內容`, at: AT }
        const all = await runOrphanPass({ ...base, seats: { first: { use: 'a' }, second: { use: 'b' } } })
        assert.deepEqual([all.ok, /全部受檢項皆缺票或同一供應者/.test(all.error), all.retry, all.state], [false, true, ['C1', 'C2'], two])
        const part = await runOrphanPass({ ...base, seats: { first: { use: 'a' }, second: { use: 'b' }, third: { use: 'c' } } })
        assert.deepEqual([part.ok, part.retry, part.stats.orphanRetracted, findItem(part.state, 'C1').item.status], [true, ['C2'], 1, 'retracted'], '第 1 項由第三席成立 → 撤回;第 2 項同一供應者 → 重試')
    })

    it('材料與分頁(終審 §3 D5c、D5d):候選筆記讀不到者不送審,可送者皆無支持時不撤回而待判(材料不可得);頁放不下 → 候選對半分;單篇仍放不下 → 該頁各項材料過大 → 待判', async () => {
        const domain = createExtractDomain({})
        const notesById = new Map(['n2', 'n3'].map((id) => [id, { id, title: id }]))
        const seats = { first: { use: 'a' }, second: { use: 'b' } }
        const s = orphaned()
        const none = panelAi(() => ({ checks: [{ index: 1, verdict: 'none', reason: '候選筆記皆未涉及此主張' }] }))
        const lines = []
        // n3 讀不到:只送 n2;皆無支持 → 不撤回、待判(材料不可得)、不計次
        const r = await runOrphanPass({ state: s, concept: '動量', ids: ['C1'], domain, seats, ai: none, notesById, contentOf: (n) => (n === 'n3' ? null : `${n} 之內容`), at: AT, log: (l) => lines.push(l) })
        assert.deepEqual([r.ok, findItem(r.state, 'C1').item.status, r.held.map((h) => [h.id, h.why]), r.retry, r.unreadable, r.stats.orphanUnreadable, r.checks[0].status], [true, 'active', [['C1', 'no-material']], [], ['n3'], 1, 'undetermined'])
        assert.ok(lines.some((l) => /可送之候選皆無支持，但 1 篇候選讀不到——不撤回、待判（使用者）/.test(l)), lines.join('\n'))
        // 全部候選讀不到 → noop
        const allUn = await runOrphanPass({ state: s, concept: '動量', ids: ['C1'], domain, seats, ai: none, notesById, contentOf: () => null, at: AT })
        assert.deepEqual([allUn.noop, allUn.unreadable], [true, ['n2', 'n3']])
        // 分頁:兩篇一頁放不下 → 對半分;單篇仍放不下 → 材料過大
        const items = [{ key: 'C1', text: '動量於美股可持續 3 到 12 個月' }]
        const pages = []
        const call = async (stage, seat, prompt) => {
            const notes = [...prompt.matchAll(/^=== 筆記 (S\d+)：(\S+) ===$/gm)].map((m) => m[2])
            pages.push(notes)
            if (notes.length > 1 || notes[0] === 'n3') return { ok: false, error: 'oversize', oversize: true }
            return { ok: true, providerId: seat.use, json: { checks: [{ index: 1, verdict: 'none', reason: '本頁筆記皆未涉及此主張' }] } }
        }
        const rc = await runOrphanCheck({ items, notes: ['n2', 'n3'], concept: '動量', contentOf: (n) => `${n} 之內容`, titleOf: (n) => n, buildPrompt: domain.buildOrphanCheckPrompt, call, seats })
        // 兩席並行,每頁各推入兩次
        assert.deepEqual([pages.slice(0, 4), rc.results.get('C1').status, rc.results.get('C1').why], [[['n2', 'n3'], ['n2', 'n3'], ['n2'], ['n2']], 'held', 'oversize'], '兩篇一頁放不下 → 分成兩頁;n3 單篇仍放不下 → 判不了(材料過大)')
    })

    it('ES8 提示詞:判準三類(只支持較窄範圍算不支持)、只看候選筆記、unsure 合法、輸出形狀 checks＋by;判準依證據性質(與 ES9 同一判準)', () => {
        const p = createExtractDomain({}).buildOrphanCheckPrompt({ concept: '動量', sources: [{ label: 'S1', title: 't', text: 'x' }], items: [{ index: 1, text: '主張甲' }, { index: 2, text: '主張乙', basis: '理論' }, { index: 3, text: '主張丙', basis: '樣本外、理論推導' }] })
        for (const s of ['出處筆記已被刪除', 'supported：', 'none：', '只支持較窄的範圍', 'unsure：', '只看候選筆記的內容', '"by":["S2"]', '{"checks":[', '=== 筆記 S1：t ===', '--- 第1項（證據性質：未標；非推論類）---\n主張：主張甲']) assert.ok(p.includes(s), s)
        assert.ok(p.includes('--- 第2項（證據性質：理論；推論類）---'), 'basis 含推論類關鍵詞 → 推論類')
        assert.ok(p.includes('--- 第3項（證據性質：樣本外、理論推導；推論類）---'), '並列之證據性質含推論類詞(子字串)→ 推論類')
        for (const s of ['・非推論類之項：筆記本身寫出了斷言的結論（同義改寫亦可）', '只要結論須自行計算或推論才得到，就不算', '・推論類之項：斷言可由筆記明載的內容推得，且斷言本身寫明了推論所依的前提', '・同義改寫＝措辭不同而所指之對象、範圍、條件與筆記相同', '非推論類之項須推論才得到、推論類之項未寫明前提者，亦算不支持']) assert.ok(p.includes(s), s)
        // 無推論類(inferenceBasis [])→ 不列推論類之判準,一律須直接陳述
        const p0 = createExtractDomain({ vocab: { inferenceBasis: [] } }).buildOrphanCheckPrompt({ concept: '動量', sources: [], items: [{ index: 1, text: '主張甲', basis: '理論' }] })
        assert.ok(p0.includes('--- 第1項（證據性質：理論；非推論類）---') && !p0.includes('・推論類之項'))
    })
})
