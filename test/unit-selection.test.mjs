// unit-selection.test.mjs — 提煉選題(pickConcepts／pickCategories／coreForKey)與選篇(selectNotes)之語意:
//   失敗即回隊尾、身分含 scope 與分身唯一綁定、主標籤計數、既有核心入選下限、選篇
// 執行:npx mocha test/unit-selection.test.mjs(純函數,不落檔)

import assert from 'node:assert/strict'
import { pickConcepts, pickCategories, orphanNotes, coreForKey, twinsOf, isReady, groupByConcept } from '../src/stores/conceptSelection.mjs'
import { selectNotes, yearOf } from '../src/stores/noteSelection.mjs'
import { setConceptFold, resetConceptFold } from './tools/captureForTest.mjs'

const DAY = 86400_000
const NOW = Date.parse('2026-09-29T12:00:00+08:00')
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const note = (id, concepts, extra = {}) => ({ id, concepts, category: '方法與技術', createdAt: iso(30 * DAY), relatedAt: 'x', sourceName: `S-${id}`, ...extra })

describe('unit-selection', function() {

    before(() => resetConceptFold())
    after(() => resetConceptFold()) // 模組級單例,不留給同 worker 之他檔

    describe('pickConcepts／pickCategories', function() {

        it('主標籤計數:pending 與新核心門檻只計第一個標籤;次標籤只作補位候選', () => {
            const notes = [
                note('a1', ['甲', '乙']), note('a2', ['甲', '乙']), note('a3', ['甲']),
                note('b1', ['乙']),
            ]
            const t = pickConcepts(notes, [], { minNotes: 2, now: NOW })
            assert.deepEqual(t.map((x) => [x.concept, x.pending.length]), [['甲', 3]], '乙之主標籤只有 1 篇 → 不達門檻 2(次標籤不計入門檻)')
            const t2 = pickConcepts(notes, [], { minNotes: 1, now: NOW })
            const yi = t2.find((x) => x.concept === '乙')
            assert.deepEqual(yi.pending.map((n) => n.id), ['b1'])
            assert.deepEqual(yi.candidates.filter((c) => !c.primary).map((c) => c.note.id), ['a1', 'a2'], '次標籤為補位候選')
        })

        it('已用過＝該核心之累積出處(cores.noteIds);全部用過者不入選;核心記錄無 noteIds 者視為尚無已用過', () => {
            const notes = [note('a1', ['甲']), note('a2', ['甲']), note('a3', ['甲'])]
            const core = { id: 'k', concept: '甲', noteIds: ['a1', 'a2'], version: 4, updatedAt: iso(10 * DAY) }
            const t = pickConcepts(notes, [core], { minPending: 1, maxWaitDays: 0, now: NOW })
            assert.deepEqual(t[0].pending.map((n) => n.id), ['a3'])
            assert.equal(t[0].core, core)
            assert.equal(pickConcepts(notes, [{ ...core, noteIds: ['a1', 'a2', 'a3'] }], { now: NOW }).length, 0)
            assert.deepEqual(pickConcepts(notes, [{ ...core, noteIds: undefined }], { minPending: 1, maxWaitDays: 0, now: NOW })[0].pending.map((n) => n.id), ['a1', 'a2', 'a3'])
        })

        it('既有核心入選:滿一批即入選;未滿者須「≥ minPending 且等待 ≥ maxWaitDays」(部分批會吃掉名額,模擬實際消化只有名目 1/3)', () => {
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
            const t1 = pickConcepts(notes, cores, { catchup: 1, now: NOW })
            assert.equal(t1[0].score, t1[1].score, '不追趕(catchup 1):兩者同分(皆封頂 12)')
            assert.equal(pickConcepts(notes, cores, { now: NOW })[0].score, 36 * 5, '未給 catchup＝設定預設之追趕批數(3)')
            const t3 = pickConcepts(notes, cores, { catchup: 3, now: NOW })
            assert.deepEqual(t3.map((x) => x.concept), ['樞紐', '小'])
            assert.equal(t3[0].score, 36 * 5)
        })

        it('等待錨點＝上次提煉批次(proposedAt):整併更新 updatedAt 不重置提煉之等待', () => {
            const notes = Array.from({ length: 12 }, (_, i) => note(`a${i}`, ['甲']))
            const core = { id: 'k', concept: '甲', noteIds: [], version: 3, proposedAt: iso(10 * DAY), updatedAt: iso(0.01 * DAY) }
            assert.ok(Math.abs(pickConcepts(notes, [core], { now: NOW })[0].ageDays - 10) < 1e-6)
        })

        it('失敗即回隊尾:等待天數自 max(上次成功, 上次嘗試) 起算——失敗之概念不會每輪佔名額', () => {
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

        it('身分含 scope:同名之類別核心不綁概念層群組(兩層各自綁定、互不遮蔽)', () => {
            const notes = Array.from({ length: 3 }, (_, i) => note(`n${i}`, ['方法與技術']))
            const catCore = { id: 'c', concept: '方法與技術', scope: 'category', noteIds: [], noteCount: 12, version: 5, updatedAt: iso(DAY) }
            const t = pickConcepts(notes, [catCore], { minNotes: 3, now: NOW })
            assert.equal(t.length, 1)
            assert.equal(t[0].core, null, '概念層為新核心')
            const six = Array.from({ length: 6 }, (_, i) => note(`c${i}`, ['x']))
            const cats = pickCategories(six, [catCore], { minNotes: 6, minGain: 4, notesPerTarget: 6, now: NOW })
            assert.equal(cats[0].core, catCore, '類別層綁類別核心')
            assert.equal(cats[0].scope, 'category')
            // 既有類別核心之入選與概念層對稱:滿批,或(≥ minGain 且等待 ≥ maxWaitDays);minGain 不當滿批(1 天前才提煉者加 4～11 篇不入選)
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
            const cores = [{ id: 'k', concept: '乙', scope: 'concept', version: 1, noteIds: [] }, { id: 'kc', concept: '甲', scope: 'category', version: 1 }]
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
            // 上限 ≤ 0 即不選(重審篇數已填滿一批時,新筆記之名額為 0——不得退回預設篇數而超出一批)
            for (const limit of [0, -3]) assert.deepEqual(selectNotes([cand('p1'), cand('p2')], { limit }), [], `limit ${limit}`)
            assert.equal(selectNotes(Array.from({ length: 20 }, (_, i) => cand(`q${i}`))).length, 12, '未給 limit＝設定預設之每批篇數')
        })

        it('依發布年分層、自最新之年輪流取(發布時間 → 樣本期末年 → 建立年)', () => {
            const cs = [
                cand('a2020', { published: '2020-01-01' }), cand('b2020', { published: '2020-06-01' }),
                cand('c2024', { published: 'Tue, 03 Sep 2024 10:00:00 GMT' }), cand('d2024', { published: '2024-02-01' }),
                cand('e2015', { samplePeriod: '2010-2015' }), cand('f2026', {}),
            ]
            const pub = (n) => n.published || ''
            const out = selectNotes(cs, { limit: 4, newestShare: 0, publishedOf: pub })
            assert.deepEqual(out.map((x) => x.id), ['f2026', 'c2024', 'a2020', 'e2015'], '各年層各取一篇')
            // 未給 publishedOf:不讀記錄之 published(筆記記錄無此欄;發布時間由呼叫端以 docs 對照注入),退樣本期末年、再退建立年
            const two = [cand('x', { published: '2010', createdAt: '2026-01-01' }), cand('y', { createdAt: '2025-01-01' })]
            assert.deepEqual(selectNotes(two, { limit: 1, newestShare: 0 }).map((n) => n.id), ['x'], '以建立年 2026 分層(非 published 2010)')
            assert.deepEqual(selectNotes(cs, { limit: 4, newestShare: 0, publishedOf: (n) => (n.id === 'f2026' ? '1999' : n.published) }).map((x) => x.id)[3], 'f2026', 'publishedOf 可由 docs 對照注入')
        })

        it('最新保留:每批先取 ⌈篇數／4⌉ 篇最新建立者(不因分層而讓新料等數月);重送者排在同層最後且不入保留', () => {
            const cs = [
                cand('old1', { published: '2015', createdAt: '2026-01-01' }), cand('old2', { published: '2016', createdAt: '2026-01-02' }),
                cand('old3', { published: '2017', createdAt: '2026-01-03' }), cand('old4', { published: '2018', createdAt: '2026-01-04' }),
                cand('new1', { published: '2010', createdAt: '2026-09-28' }),
            ]
            const pub = (n) => n.published || ''
            assert.deepEqual(selectNotes(cs, { limit: 4, publishedOf: pub }).map((x) => x.id), ['new1', 'old4', 'old3', 'old2'], '最新建立之 new1 先入批(其發布年最舊,依年分層則排最後)')
            assert.deepEqual(selectNotes(cs, { limit: 4, publishedOf: pub, triesOf: (id) => (id === 'new1' ? 1 : 0) }).map((x) => x.id)[0], 'old4', '重送者不入保留')
            const same = [cand('r1', { createdAt: '2026-01-01' }), cand('f1', { createdAt: '2026-01-02' })]
            assert.deepEqual(selectNotes(same, { limit: 2, newestShare: 0, triesOf: (id) => (id === 'r1' ? 1 : 0) }).map((x) => x.id), ['f1', 'r1'], '同層中重送者排後')
        })

        it('同來源每批上限(預設 2),不足一批時放寬', () => {
            const cs = ['a', 'b', 'c', 'd'].map((id) => cand(id, { sourceName: 'X' })).concat([cand('e', { sourceName: 'Y' })])
            assert.deepEqual(selectNotes(cs, { limit: 3 }).map((x) => x.id), ['a', 'b', 'e'])
            assert.deepEqual(selectNotes(cs, { limit: 5 }).map((x) => x.id), ['a', 'b', 'e', 'c', 'd'], '放寬後補滿')
            assert.equal(selectNotes(cs, { limit: 3, sourceOf: () => 'same' }).length, 3)
        })

        it('主標籤集中於同一來源:先放寬主標籤之來源上限,仍不足一批才輪到次標籤', () => {
            const prim = ['a', 'b', 'c', 'd'].map((id) => cand(id, { sourceName: 'X' }))
            const sec = ['s1', 's2'].map((id) => cand(id, {}, false))
            assert.deepEqual(selectNotes([...sec, ...prim], { limit: 4, newestShare: 0 }).map((x) => x.id), ['a', 'b', 'c', 'd'], '主標籤足量 → 全為主標籤(次標籤不擠掉同源之主標籤)')
            assert.deepEqual(selectNotes([...sec, ...prim.slice(0, 3)], { limit: 5, newestShare: 0 }).map((x) => `${x.id}:${x.primary}`), ['a:true', 'b:true', 'c:true', 's1:false', 's2:false'], '主標籤不足一批 → 次標籤補位')
            const secX = ['t1', 't2', 't3'].map((id) => cand(id, { sourceName: 'Z' }, false)).concat([cand('u1', { sourceName: 'W' }, false)])
            assert.deepEqual(selectNotes([...secX, cand('a', { sourceName: 'X' })], { limit: 4, newestShare: 0 }).map((x) => x.id), ['a', 't1', 't2', 'u1'], '次標籤層內仍先求來源多樣')
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

    describe('conceptSelection（選題）', function() {

        it('pickConcepts：notes／cores 非陣列回傳 []；minNotes 非數值＝設定預設之新核心門檻(6),明給 0 才不過濾', () => {
            assert.deepEqual(pickConcepts(null, undefined), [], 'notes/cores 非陣列回傳空陣列')
            const notes = [{ id: 'a', concepts: ['甲'], createdAt: '2026-09-01T00:00:00Z' }, { id: 'b', concepts: ['甲'], createdAt: '2026-09-02T00:00:00Z' }]
            assert.equal(pickConcepts(notes, [], { minNotes: 'abc', now: Date.parse('2026-09-10T00:00:00Z') }).length, 0, 'minNotes 非數值＝設定預設 6:2 篇未達門檻')
            const out = pickConcepts(notes, [], { minNotes: 0, now: Date.parse('2026-09-10T00:00:00Z') })
            assert.equal(out.length, 1, 'minNotes 0 不過濾(未關聯者逾寬限 3 天放行)')
            assert.equal(out[0].pending.length, 2)
            const outValid = pickConcepts(notes, [], { minNotes: 3, now: Date.parse('2026-09-10T00:00:00Z') })
            assert.equal(outValid.length, 0, '有效 minNotes 過濾行為不變')
        })

        it('pickCategories：notes／cores 非陣列回傳 []；有效輸入選題行為不變', () => {
            assert.deepEqual(pickCategories(null, null), [])
            const notes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, category: '其他', relatedAt: 'x' }))
            const out = pickCategories(notes, [], { minNotes: 6, minGain: 4 })
            assert.equal(out.length, 1, '有效輸入行為不變')
        })
    })

    // ── conceptSelection（選題）──
    it('概念分群：normalizeConcept 歸群、pending 選題(已用者不重跑)、類別後備', () => {
        const mk = (id, c, cat = '方法與技術', created = '2026-08-01') => ({ id, concepts: [c], category: cat, createdAt: created, relatedAt: created })
        const notes = [mk('1', 'Transformer 架構'), mk('2', 'transformer架構'), mk('3', 'Ｔransformer架構')] // 全形Ｔ
        let t = pickConcepts(notes, [], { minNotes: 3 })
        assert.equal(t.length, 1, '三種寫法須歸同一群')
        assert.equal(t[0].pending.length, 3)

        t = pickConcepts(notes, [{ id: 'k', concept: 'Transformer 架構', noteIds: ['1', '2', '3'], version: 1 }], { minNotes: 3, minPending: 1, maxWaitDays: 0 })
        assert.equal(t.length, 0, '沒有未用過之筆記不重跑——重跑只燒額度並讓核心檔抖動')

        const catNotes = Array.from({ length: 6 }, (_, i) => mk(`c${i}`, `各自為政${i}`, '模型評估'))
        const cats = pickCategories(catNotes, [], { minNotes: 6, minGain: 4 })
        assert.equal(cats.length, 1)
        assert.equal(cats[0].scope, 'category')
        // 詞彙表(conceptVocabulary)之歸群與只回名稱:屬摘要套件,見 摘要套件 w-knowledge-summarize unit-core「conceptVocabulary：normalizeConcept 歸群…」
    })

    it('提煉選題 aging：score＝min(pending, 每批)×等待天數——久候者優先、剛提煉的大概念不壟斷、無核心者自最早筆記起算', () => {
        const now = Date.parse('2026-09-06T12:00:00+08:00')
        const day = 86400_000
        const mk = (id, c, created) => ({ id, concepts: [c], category: '方法與技術', createdAt: new Date(created).toISOString(), relatedAt: 'x' })
        const many = (n, p, c, created) => Array.from({ length: n }, (_, i) => mk(`${p}${i}`, c, created))
        const notes = [
            ...many(10, 'a', '過擬合', now - 40 * day), // 有核心、pending 5、0.05 天前才提煉
            ...many(3, 'b', '梯度下降', now - 40 * day), // 有核心、pending 1、等了 20 天
            ...many(2, 'c', '正則化', now - 30 * day), // 無核心、素材等了 30 天
            ...many(2, 'd', '新概念', now), // 無核心、剛出現（等待 0 天）
        ]
        const cores = [
            { id: 'k1', concept: '過擬合', noteIds: ['a0', 'a1', 'a2', 'a3', 'a4'], version: 3, updatedAt: new Date(now - 0.05 * day).toISOString() },
            { id: 'k2', concept: '梯度下降', noteIds: ['b0', 'b1'], version: 2, updatedAt: new Date(now - 20 * day).toISOString() },
        ]
        const t = pickConcepts(notes, cores, { minNotes: 2, minPending: 1, maxWaitDays: 0, now })
        assert.deepEqual(t.map((x) => x.concept), ['正則化', '梯度下降', '過擬合', '新概念'],
            '正則化(2×30)＞梯度下降(1×20)＞過擬合(5×0.05)＞新概念(2×0)；純增量排序會讓過擬合永遠第一')
        assert.ok(t[0].score > t[1].score && t[1].score > t[2].score && t[2].score > t[3].score)
        assert.equal(t[2].gain, 5, 'gain＝pending(主標籤、未用過)')
        const capped = pickConcepts([...notes, ...many(40, 'e', '過擬合', now - 40 * day)], cores, { minNotes: 2, minPending: 1, maxWaitDays: 0, notesPerTarget: 12, catchup: 1, now })
        assert.equal(capped.find((x) => x.concept === '過擬合').score, 12 * 0.05, 'pending 45 以每批 12 上限化(大 pending 不壟斷)')
    })

    // ── 字形折疊（繁簡標籤歸同群）──
    it('折疊注入後：繁簡標籤歸同群、display 取多數寫法、清除後復原', () => {
        const FOLD = { '机': '機' }
        setConceptFold((s) => [...s].map((ch) => FOLD[ch] || ch).join(''))
        try {
            const mk = (id, c) => ({ id, concepts: [c], category: '方法與技術', createdAt: '2026-08-01', relatedAt: 'x' })
            const notes = [mk('1', '注意力機制'), mk('2', '注意力機制'), mk('3', '注意力机制')]
            const t = pickConcepts(notes, [], { minNotes: 3 })
            assert.equal(t.length, 1, '繁簡兩種寫法必須歸同一群（分裂即重複核心檔之根源）')
            assert.equal(t[0].concept, '注意力機制', 'display 取多數寫法，不可被少數簡體帶偏')
            // 既有 core 為繁體時，簡體筆記要算進同一核心之 pending（不可另起爐灶）
            const t2 = pickConcepts(notes, [{ id: 'k', concept: '注意力機制', noteIds: ['1', '2'], version: 1 }], { minNotes: 3, minPending: 1, maxWaitDays: 0 })
            assert.equal(t2.length, 1)
            assert.deepEqual(t2[0].pending.map((n) => n.id), ['3'], '簡體筆記須計入既有繁體 core 之 pending')
            // 詞彙表 display 同理:屬摘要套件,見 摘要套件 w-knowledge-summarize unit-core「conceptVocabulary：折疊注入後繁簡標籤同鍵…」
        }
        finally {
            resetConceptFold()
        }
        // 清除後行為復原：無折疊時繁簡仍是兩鍵（既有測試依賴此預設）
        const notes2 = [{ id: '1', concepts: ['注意力機制'], category: '方法與技術', relatedAt: 'x' }, { id: '2', concepts: ['注意力机制'], category: '方法與技術', relatedAt: 'x' }]
        assert.equal(pickConcepts(notes2, [], { minNotes: 2 }).length, 0, '未注入折疊時不可偷偷合併')
    })

    // ── 概念分群之同篇多標籤折疊 ──
    it('概念分群:同一篇筆記之多個標籤折疊成同一鍵時只入群一次(重複計入會使增量與 noteCount 虛增、同篇重複進提煉 prompt)', () => {
        const notes = [
            { id: '1', concepts: ['Transformer 架構', 'transformer架構'], category: 'c', createdAt: '2026-08-01', relatedAt: 'x' }, // 同篇兩種寫法,折疊後同鍵
            { id: '2', concepts: ['Transformer 架構'], category: 'c', createdAt: '2026-08-01', relatedAt: 'x' },
        ]
        const t = pickConcepts(notes, [], { minNotes: 2 })
        assert.equal(t.length, 1)
        assert.deepEqual(t[0].candidates.map((c) => c.note.id), ['1', '2'], '同篇只出現一次')
        assert.equal(t[0].gain, 2)
        assert.equal(pickConcepts(notes, [], { minNotes: 3 }).length, 0, '實際只有 2 篇,不得因重複標籤湊滿門檻 3')
        // 詞彙表之使用篇數亦只計一次:屬摘要套件,見 摘要套件 w-knowledge-summarize unit-core「conceptVocabulary：同一篇筆記之多個標籤折疊成同一鍵時只計一次…」
    })
})
