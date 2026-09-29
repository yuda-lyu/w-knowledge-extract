// unit-selection.test.mjs — 提煉選題(pickConcepts／pickCategories／coreForKey)與選篇(selectNotes)之 2.0 語意
//
// 規格來源:tmp/wke-distill-b-全盤.md §11.1 A17(失敗即回隊尾)、A18(身分含 scope、分身唯一綁定)、A19(主標籤計數)、
//   A21(既有核心入選下限)、A22(選篇);安裝方〈建議w-knowledge-extract優化〉§1.3、§1.4、§2.3(2026-09-29)
// 執行:npx mocha test/unit-selection.test.mjs(純函數,不落檔)

import assert from 'node:assert/strict'
import { pickConcepts, pickCategories, orphanNotes, coreForKey, twinsOf, isReady, groupByConcept } from '../src/stores/conceptGroups.mjs'
import { selectNotes, yearOf } from '../src/stores/noteSelection.mjs'
import { setConceptFold } from '../src/util/text.mjs'

const DAY = 86400_000
const NOW = Date.parse('2026-09-29T12:00:00+08:00')
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const note = (id, concepts, extra = {}) => ({ id, concepts, category: '方法與技術', createdAt: iso(30 * DAY), relatedAt: 'x', sourceName: `S-${id}`, ...extra })

describe('unit-selection', function() {

    before(() => setConceptFold(null))

    describe('pickConcepts／pickCategories', function() {

        it('主標籤計數:pending 與新核心門檻只計第一個標籤;次標籤只作補位候選', () => {
            const notes = [
                note('a1', ['甲', '乙']), note('a2', ['甲', '乙']), note('a3', ['甲']),
                note('b1', ['乙']),
            ]
            const t = pickConcepts(notes, [], { minNotes: 2, now: NOW })
            assert.deepEqual(t.map((x) => [x.concept, x.pending.length]), [['甲', 3]], '乙之主標籤只有 1 篇 → 不達門檻 2(1.x 會以 3 篇建核心)')
            const t2 = pickConcepts(notes, [], { minNotes: 1, now: NOW })
            const yi = t2.find((x) => x.concept === '乙')
            assert.deepEqual(yi.pending.map((n) => n.id), ['b1'])
            assert.deepEqual(yi.candidates.filter((c) => !c.primary).map((c) => c.note.id), ['a1', 'a2'], '次標籤為補位候選')
        })

        it('已用過＝該核心之累積出處(cores.noteIds);全部用過者不入選;升版前之記錄(無 stateFormat 2)其 noteIds 只是末批 → 視為 ∅', () => {
            const notes = [note('a1', ['甲']), note('a2', ['甲']), note('a3', ['甲'])]
            const core = { id: 'k', concept: '甲', noteIds: ['a1', 'a2'], version: 4, updatedAt: iso(10 * DAY), stateFormat: 2 }
            const t = pickConcepts(notes, [core], { minPending: 1, maxWaitDays: 0, now: NOW })
            assert.deepEqual(t[0].pending.map((n) => n.id), ['a3'])
            assert.equal(t[0].core, core)
            assert.equal(pickConcepts(notes, [{ ...core, noteIds: ['a1', 'a2', 'a3'] }], { now: NOW }).length, 0)
            // 1.0.3 記錄:知識只在封存區(不轉主張),其筆記須重新提煉——與遷移後狀態之 consumed 自 ∅ 一致
            const legacy = { ...core, stateFormat: undefined, noteIds: ['a1', 'a2', 'a3'] }
            assert.deepEqual(pickConcepts(notes, [legacy], { minPending: 1, maxWaitDays: 0, now: NOW })[0].pending.map((n) => n.id), ['a1', 'a2', 'a3'])
        })

        it('既有核心入選:滿一批即入選;未滿者須「≥ minPending 且等待 ≥ maxWaitDays」(部分批會吃掉名額,判識 B 模擬實際消化只有名目 1/3)', () => {
            const five = Array.from({ length: 5 }, (_, i) => note(`a${i}`, ['甲']))
            const core = (days) => ({ id: 'k', concept: '甲', noteIds: [], version: 1, updatedAt: iso(days * DAY) })
            assert.equal(pickConcepts(five, [core(3)], { minPending: 4, maxWaitDays: 30, now: NOW }).length, 0, '5 篇未滿 12 且只等 3 天')
            assert.equal(pickConcepts(five, [core(31)], { minPending: 4, maxWaitDays: 30, now: NOW }).length, 1, '等逾 30 天放行')
            assert.equal(pickConcepts(five, [core(3)], { minPending: 4, notesPerTarget: 5, now: NOW }).length, 1, '滿一批不需等待')
            assert.equal(pickConcepts(five.slice(0, 2), [core(90)], { minPending: 4, maxWaitDays: 30, now: NOW }).length, 0, '不足下限者等再久亦不為 2 篇開工')
        })

        it('score 上限＝追趕批數×每批:追趕 3 批時,大積壓核心之分數高於小核心(同等待天數)', () => {
            const mk = (p, c, n) => Array.from({ length: n }, (_, i) => note(`${p}${i}`, [c]))
            const notes = [...mk('h', '樞紐', 40), ...mk('s', '小', 12)]
            const cores = [
                { id: 'kh', concept: '樞紐', noteIds: [], version: 9, updatedAt: iso(5 * DAY) },
                { id: 'ks', concept: '小', noteIds: [], version: 2, updatedAt: iso(5 * DAY) },
            ]
            const t1 = pickConcepts(notes, cores, { now: NOW })
            assert.equal(t1[0].score, t1[1].score, '不追趕:兩者同分(皆封頂 12)')
            const t3 = pickConcepts(notes, cores, { catchup: 3, now: NOW })
            assert.deepEqual(t3.map((x) => x.concept), ['樞紐', '小'])
            assert.equal(t3[0].score, 36 * 5)
        })

        it('等待錨點＝上次提案(proposedAt):整併更新 updatedAt 不重置提案之等待', () => {
            const notes = Array.from({ length: 12 }, (_, i) => note(`a${i}`, ['甲']))
            const core = { id: 'k', concept: '甲', noteIds: [], version: 3, proposedAt: iso(10 * DAY), updatedAt: iso(0.01 * DAY) }
            assert.ok(Math.abs(pickConcepts(notes, [core], { now: NOW })[0].ageDays - 10) < 1e-6)
        })

        it('失敗即回隊尾:等待天數自 max(上次成功, 上次嘗試) 起算——失敗之概念不再每輪佔名額(1.x 分數只增不減)', () => {
            const mk = (p, c) => Array.from({ length: 6 }, (_, i) => note(`${p}${i}`, [c]))
            const notes = [...mk('a', '壞'), ...mk('b', '好')]
            const cores = [
                { id: 'ka', concept: '壞', noteIds: [], version: 1, updatedAt: iso(30 * DAY) },
                { id: 'kb', concept: '好', noteIds: [], version: 1, updatedAt: iso(20 * DAY) },
            ]
            assert.equal(pickConcepts(notes, cores, { notesPerTarget: 6, now: NOW })[0].concept, '壞', '未失敗前:等得最久者先')
            const attempts = { 'concept|壞': { tries: 3, lastTriedAt: iso(0.01 * DAY) } }
            const t = pickConcepts(notes, cores, { attempts, notesPerTarget: 6, now: NOW })
            assert.deepEqual(t.map((x) => x.concept), ['好', '壞'])
            assert.equal(t[1].tries, 3)
        })

        it('身分含 scope:同名之類別核心不綁概念層群組(1.x 共用綁定而互蓋、概念層被擋)', () => {
            const notes = Array.from({ length: 3 }, (_, i) => note(`n${i}`, ['方法與技術']))
            const catCore = { id: 'c', concept: '方法與技術', scope: 'category', noteIds: [], noteCount: 12, version: 5, updatedAt: iso(DAY) }
            const t = pickConcepts(notes, [catCore], { minNotes: 3, now: NOW })
            assert.equal(t.length, 1)
            assert.equal(t[0].core, null, '概念層為新核心')
            const six = Array.from({ length: 6 }, (_, i) => note(`c${i}`, ['x']))
            const cats = pickCategories(six, [catCore], { minNotes: 6, minGain: 4, notesPerTarget: 6, now: NOW })
            assert.equal(cats[0].core, catCore, '類別層綁類別核心')
            assert.equal(cats[0].scope, 'category')
            // 既有類別核心之入選與概念層對稱:滿批,或(≥ minGain 且等待 ≥ maxWaitDays);不再以 minGain 當滿批(1 天前才提煉者加 4～11 篇不入選)
            assert.equal(pickCategories(six, [catCore], { minNotes: 6, minGain: 4, now: NOW }).length, 0, '6 篇未滿 12 且只等 1 天')
            assert.equal(pickCategories(six, [{ ...catCore, updatedAt: iso(31 * DAY) }], { minNotes: 6, minGain: 4, now: NOW }).length, 1, '≥ minGain 且久候 → 入選')
        })

        it('orphanNotes(類別後備之候選):主概念無概念核心、主標籤可提煉未達 minNotes、且久候者;無概念標籤者亦算;已有概念核心或可建核心者不算', () => {
            const old = { createdAt: iso(40 * DAY) }
            const notes = [
                { ...note('a1', ['甲']), ...old }, // 甲:1 篇、無核心 → 孤兒
                { ...note('b1', ['乙']), ...old }, // 乙:有概念核心 → 非孤兒
                ...Array.from({ length: 6 }, (_, i) => ({ ...note(`c${i}`, ['丙']), ...old })), // 丙:6 篇達門檻(概念層會建核心)→ 非孤兒
                { ...note('d1', []), ...old }, // 無概念標籤 → 孤兒
                note('e1', ['戊'], { createdAt: iso(10 * DAY) }), // 戊:未久候(10 天前)→ 尚非孤兒
            ]
            const cores = [{ id: 'k', concept: '乙', scope: 'concept', version: 1, stateFormat: 2, noteIds: [] }, { id: 'kc', concept: '甲', scope: 'category', version: 1 }]
            assert.deepEqual(orphanNotes(notes, cores, { minNotes: 6, maxWaitDays: 30, now: NOW }).map((n) => n.id), ['a1', 'd1'], '同名之類別核心不算概念核心')
            assert.deepEqual(orphanNotes(notes, cores, { minNotes: 6, maxWaitDays: 5, now: NOW }).map((n) => n.id), ['a1', 'd1', 'e1'])
        })

        it('coreForKey:同鍵多核心於任何順序皆選同一主核心(version→noteCount→updatedAt→id);排除 merged;twinsOf 列其餘', () => {
            const cores = [
                { id: 'z', concept: '均值回歸', version: 3, noteCount: 50, updatedAt: '2026-09-01' },
                { id: 'y', concept: '均值回歸', version: 7, noteCount: 8, updatedAt: '2026-08-01' },
                { id: 'x', concept: '均值回歸', version: 7, noteCount: 8, updatedAt: '2026-08-01' },
                { id: 'w', concept: '均值回歸', version: 99, status: 'merged', mergedInto: 'x' },
                { id: 'v', concept: '均值回歸', version: 1, scope: 'category' },
            ]
            for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3]]) {
                assert.equal(coreForKey(order.map((k) => cores[k]), 'concept', '均值回歸').id, 'x')
            }
            assert.deepEqual(twinsOf(cores, coreForKey(cores, 'concept', '均值回歸')).map((c) => c.id).sort(), ['y', 'z'])
            assert.equal(coreForKey(cores, 'category', '均值回歸').id, 'v')
            assert.equal(coreForKey([], 'concept', '甲'), null)
        })

        it('未關聯者延後:relatedAt 空且建立未滿寬限天數 → 不計 pending;逾寬限放行', () => {
            assert.equal(isReady({ relatedAt: '', createdAt: iso(1 * DAY) }, NOW, 3), false)
            assert.equal(isReady({ relatedAt: '', createdAt: iso(4 * DAY) }, NOW, 3), true)
            assert.equal(isReady({ relatedAt: '2026-09-29' }, NOW, 3), true)
            const notes = [note('a', ['甲'], { relatedAt: '', createdAt: iso(1 * DAY) }), note('b', ['甲'])]
            assert.deepEqual(pickConcepts(notes, [], { minNotes: 1, now: NOW })[0].pending.map((n) => n.id), ['b'])
        })

        it('groupByConcept:同篇折疊成同鍵之多個標籤只入群一次;第一個有效標籤為主', () => {
            const g = groupByConcept([{ id: '1', concepts: ['', 'A 甲', 'a甲', '乙'] }])
            assert.deepEqual([...g.keys()], ['a甲', '乙'])
            assert.deepEqual(g.get('a甲').primary.map((n) => n.id), ['1'])
            assert.deepEqual(g.get('乙').secondary.map((n) => n.id), ['1'])
        })
    })

    describe('selectNotes', function() {

        const cand = (id, extra = {}, primary = true) => ({ note: { id, createdAt: '2026-09-01', sourceName: `S-${id}`, ...extra }, primary })

        it('主標籤優先、不足才以次標籤補位;配發批內代號 N1…Nk', () => {
            const out = selectNotes([cand('s1', {}, false), cand('p1'), cand('p2')], { limit: 3 })
            assert.deepEqual(out.map((x) => `${x.code}:${x.id}:${x.primary}`), ['N1:p1:true', 'N2:p2:true', 'N3:s1:false'])
            assert.equal(selectNotes([cand('p1'), cand('p2'), cand('p3')], { limit: 2 }).length, 2)
        })

        it('依發布年分層、自最新之年輪流取(發布時間 → 樣本期末年 → 建立年)', () => {
            const cs = [
                cand('a2020', { published: '2020-01-01' }), cand('b2020', { published: '2020-06-01' }),
                cand('c2024', { published: 'Tue, 03 Sep 2024 10:00:00 GMT' }), cand('d2024', { published: '2024-02-01' }),
                cand('e2015', { samplePeriod: '2010-2015' }), cand('f2026', {}),
            ]
            const out = selectNotes(cs, { limit: 4, newestShare: 0 })
            assert.deepEqual(out.map((x) => x.id), ['f2026', 'c2024', 'a2020', 'e2015'], '各年層各取一篇(1.x 只取最新)')
            assert.deepEqual(selectNotes(cs, { limit: 4, newestShare: 0, publishedOf: (n) => (n.id === 'f2026' ? '1999' : n.published) }).map((x) => x.id)[3], 'f2026', 'publishedOf 可由 docs 對照注入')
        })

        it('最新保留:每批先取 ⌈篇數／4⌉ 篇最新建立者(不因分層而讓新料等數月);重送者排在同層最後且不入保留', () => {
            const cs = [
                cand('old1', { published: '2015', createdAt: '2026-01-01' }), cand('old2', { published: '2016', createdAt: '2026-01-02' }),
                cand('old3', { published: '2017', createdAt: '2026-01-03' }), cand('old4', { published: '2018', createdAt: '2026-01-04' }),
                cand('new1', { published: '2010', createdAt: '2026-09-28' }),
            ]
            assert.deepEqual(selectNotes(cs, { limit: 4 }).map((x) => x.id), ['new1', 'old4', 'old3', 'old2'], '最新建立之 new1 先入批(其發布年最舊,分層下原本排最後)')
            assert.deepEqual(selectNotes(cs, { limit: 4, triesOf: (id) => (id === 'new1' ? 1 : 0) }).map((x) => x.id)[0], 'old4', '重送者不入保留')
            const same = [cand('r1', { createdAt: '2026-01-01' }), cand('f1', { createdAt: '2026-01-02' })]
            assert.deepEqual(selectNotes(same, { limit: 2, newestShare: 0, triesOf: (id) => (id === 'r1' ? 1 : 0) }).map((x) => x.id), ['f1', 'r1'], '同層中重送者排後')
        })

        it('同來源每批上限(預設 2),不足一批時放寬', () => {
            const cs = ['a', 'b', 'c', 'd'].map((id) => cand(id, { sourceName: 'X' })).concat([cand('e', { sourceName: 'Y' })])
            assert.deepEqual(selectNotes(cs, { limit: 3 }).map((x) => x.id), ['a', 'b', 'e'])
            assert.deepEqual(selectNotes(cs, { limit: 5 }).map((x) => x.id), ['a', 'b', 'e', 'c', 'd'], '放寬後補滿')
            assert.equal(selectNotes(cs, { limit: 3, sourceOf: () => 'same' }).length, 3)
        })

        it('衝突另一端成對入批;同層內有衝突邊與證據高者優先', () => {
            const cs = [cand('a', { evidenceLevel: '低' }), cand('b', { evidenceLevel: '高' }), cand('c', {}), cand('z', {}, false)]
            const conflicts = new Map([['c', ['z']], ['z', ['c']]])
            const out = selectNotes(cs, { limit: 3, conflicts, newestShare: 0 })
            assert.deepEqual(out.map((x) => x.id), ['c', 'z', 'b'], 'c 有衝突邊先選、另一端 z 緊接成對,再依證據等級')
        })

        it('yearOf:取第一個(或最後一個)19xx／20xx', () => {
            assert.equal(yearOf('2015-2025'), 2015)
            assert.equal(yearOf('2015-2025', true), 2025)
            assert.equal(yearOf('未載明'), null)
            assert.equal(yearOf(2024), 2024)
        })
    })
})
