// unit-extract-contract.test.mjs — 提煉與上游兩套件之資料契約(以兩套件之真實件產出,驗提煉之讀法)
// 規則(出自 domain/extractDomain 之筆記分節摘要與內容鍵、stores/noteFacts、stores/coreProjection 與 stages/extractChain 之寫入順序,與摘要、關聯套件之資料契約):
//   ①摘要 → 提煉(筆記之版型):摘要套件之真實版型(全部選填章皆給)之筆記,提煉之分節摘要逐章命中(NOTE_SECTIONS 之摘要章);摘要之內容章中
//     提煉不讀者恰為具名之兩章——品質與證據標注(其值經記錄之欄位入摘要之標注行)、可驗證要點(未納入起草之輸入;改動須經正式席位之 A/B,
//     列已知限制);檢定標準之材料(extractMaterialOf)＝摘要之內容章(含可驗證要點)＋原文標題＋發布時間
//   ②關聯 → 提煉(投影):關聯套件之真實投影寫入 frontmatter conflicts 與兩章 → 提煉之分節摘要列「衝突對象」與衝突章之文字;內容鍵不變
//     (投影不是內容變更,不觸發重審);檢定標準之材料不含投影章
//   ③提煉 → 摘要(extractedAt):提煉寫入 ISO 時刻於所用之筆記;摘要之內容同步(同步欄位之雜湊,如一句話重點)把已提煉之變更篇計入
//     touchExtracted,提煉以自身之內容鍵(全部內容章)偵測同一變更並排入重審——摘要偵測得到之內容變更,提煉亦偵測得到
//   ④提煉 → 關聯(cores.noteIds):核心記錄之 noteIds 為所用之筆記;關聯之明示刪除之預演據以列出以該篇為出處之核心
// 規則一律以中立題材驗(天文觀測);兩套件之件經測試專用之橋接取得。
// 執行:自套件根 node <mocha> test/unit-extract-contract.test.mjs(暫存 test/_tmp/extract-contract-<pid>,測完即刪;真 LMDB、不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readMd, writeMd } from '../src/core/summarizePackage.mjs'
import { NOTE_SECTIONS } from '../src/domain/extractDomain.mjs'
import { extractMaterialOf } from '../src/stores/noteFacts.mjs'
import { NON_CONTENT_SECTIONS, syncNotes } from './tools/summarizeForTest.mjs'
import { makeEdge, deleteNote, projectNotes } from './tools/relateForTest.mjs'
import { scriptAi, draftAll } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots, resetConceptFold, landNote, buildTestExtractor, withStores, seedNotes, subReport, silentLog } from './tools/extractTestKit.mjs'
import { sleep } from './tools/captureForTest.mjs'

/** 全部選填章皆給之摘要項目欄位 */
const FULL_K = Object.freeze({
    parameters: [{ name: '視差下限', value: '0.1 角秒', note: '地面觀測之量測下限' }],
    methods: ['於半年之兩端量測恆星之角位移'],
    pros: ['原理單純、不依賴恆星模型'],
    cons: ['距離愈遠誤差愈大'],
    regime_dependency: ['大氣擾動大之季節誤差增加'],
    counter_views: ['光度法對遠距恆星較可行'],
    verifiable: ['以多站同時觀測可重現同一視差值'],
})
/** 摘要之內容章中提煉之分節摘要刻意不讀者(具名;理由見檔頭) */
const NOT_READ = Object.freeze(['品質與證據標注', '可驗證要點'])
const REASON_C = '甲篇主張誤差主導距離估計；乙篇主張誤差可忽略'

describe('unit-extract-contract', function() {

    this.timeout(120_000)

    let root = ''
    before(() => {
        root = tmpRoot('extract-contract')
    })
    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    let seq = 0
    const dirOf = (name) => `${root}/${name}-${++seq}`
    const relateDeps = (flow, s) => ({ stores: s, dirs: flow.info().dirs, clock: flow.info().clock, log: silentLog, domain: flow.info().domains.relate })

    // ══════════════════════════ ① 摘要 → 提煉 ══════════════════════════
    describe('①摘要之真實版型 → 提煉之分節摘要與檢定標準之材料', function() {

        it('全部選填章皆給之筆記:提煉之分節摘要逐章命中(sectioned;各章之文字皆入);摘要之內容章中不讀者恰為具名之兩章;提煉所讀而摘要不寫者只有關聯之投影章', () => {
            const wd = dirOf('full')
            const { flow } = buildTestExtractor(wd)
            const rec = landNote(`${wd}/knowledge/notes`, { doc: 'f', title: '三角視差法之量測', concepts: ['視差量測'], conditions: ['晴朗而大氣穩定之夜'], k: FULL_K })
            const md = readMd(rec.file)
            const headings = [...md.body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
            const content = headings.filter((h) => !NON_CONTENT_SECTIONS.includes(h))
            const read = NOTE_SECTIONS.map(([t]) => t)
            const d = flow.info().domains.extract.noteDigest(rec, md, { code: 'N1' })
            assert.equal(d.sectioned, true)
            for (const t of read.filter((x) => headings.includes(x))) assert.ok(d.text.includes(`【${t}】`), `分節摘要缺章:${t}\n${d.text}`)
            assert.deepEqual(content.filter((h) => !read.includes(h)), [...NOT_READ], '摘要之內容章中提煉不讀者(新增之內容章未被讀即失敗)')
            assert.deepEqual(read.filter((t) => !headings.includes(t)), ['⚠ 衝突與反例'], '提煉所讀而摘要不寫者只有關聯之投影章')
            // 各章之文字入摘要(截斷內)
            for (const s of [rec.summary, FULL_K.methods[0], FULL_K.pros[0], FULL_K.cons[0], FULL_K.regime_dependency[0], FULL_K.counter_views[0], '0.1 角秒', '晴朗而大氣穩定之夜']) assert.ok(d.text.includes(s), s)
            // 品質與證據標注之值經記錄之欄位入標注行;可驗證要點未入
            assert.match(d.text, /^標注：實證研究｜證據 中｜樣本期 .*｜⚠ 適用範圍狹窄$/m)
            assert.ok(!d.text.includes(FULL_K.verifiable[0]), '可驗證要點未入起草之輸入(已知限制)')
        })

        it('檢定標準之材料(extractMaterialOf)＝摘要之內容章(含可驗證要點)＋原文標題＋發布時間;md 讀不到為 null(未能判定)', () => {
            const wd = dirOf('material')
            const rec = landNote(`${wd}/knowledge/notes`, { doc: 'm', title: '三角視差法之量測', concepts: ['視差量測'], k: FULL_K })
            const m = extractMaterialOf(rec)
            for (const s of [rec.summary, FULL_K.verifiable[0], FULL_K.methods[0], '0.1 角秒']) assert.ok(m.includes(s), s)
            assert.match(m, /三角視差法之量測/, '原文標題')
            assert.equal(extractMaterialOf({ ...rec, file: `${wd}/不存在.md` }), null)
        })
    })

    // ══════════════════════════ ② 關聯 → 提煉 ══════════════════════════
    describe('②關聯之真實投影 → 提煉之分節摘要、內容鍵與材料', function() {

        it('投影寫入 frontmatter conflicts 與兩章 → 分節摘要列衝突對象(同批以代號、非本批以標題)與衝突章;內容鍵不變(不觸發重審);材料不含投影章', async () => {
            const wd = dirOf('proj')
            const { flow } = buildTestExtractor(wd)
            const a = landNote(`${wd}/knowledge/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差量測'] })
            const b = landNote(`${wd}/knowledge/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差量測'] })
            const C = flow.info().domains.relate.conflictType
            await seedNotes(flow, [a, b], [makeEdge({ from: a.id, to: b.id, type: C, reason: REASON_C, nowIso: '2026-01-05T00:00:00+08:00' })])
            const dom = flow.info().domains.extract
            const before = dom.noteDigest(a, readMd(a.file), { code: 'N1' })
            await withStores(flow, (s) => projectNotes(relateDeps(flow, s), [a.id, b.id]))
            const md = readMd(a.file)
            assert.deepEqual(md.front.conflicts, [b.id], '前提:關聯之投影寫入 frontmatter conflicts')
            assert.match(md.body, /^## ⚠ 衝突與反例$/m)
            const titles = new Map([[b.id, b.title]])
            const after = dom.noteDigest(a, md, { code: 'N1', codeOf: () => '', titleOf: (id) => titles.get(id) })
            assert.ok(after.text.includes(`衝突對象：〈${b.title}〉（非本批）`), after.text)
            assert.ok(after.text.includes('【⚠ 衝突與反例】') && after.text.includes(REASON_C), after.text)
            assert.ok(dom.noteDigest(a, md, { code: 'N1', codeOf: (id) => (id === b.id ? 'N2' : '') }).text.includes('衝突對象：N2（同批）'))
            assert.equal(after.contentKey, before.contentKey, '投影不是內容變更')
            assert.ok(!extractMaterialOf(a, md).includes(REASON_C), '材料不含投影章')
        })
    })

    // ══════════════════════════ ③④ 提煉之寫入 → 上游之讀法 ══════════════════════════
    describe('③④提煉之寫入(extractedAt、cores.noteIds)→ 摘要與關聯之讀法', function() {

        it('提煉寫 extractedAt(ISO 時刻)於所用之筆記;摘要之內容同步把已提煉之變更篇計入 touchExtracted;提煉以自身之內容鍵偵測同一變更並排入重審', async () => {
            const wd = dirOf('sync')
            const { flow } = buildTestExtractor(wd, { aiAdapter: scriptAi({ draft: draftAll }) })
            const a = landNote(`${wd}/knowledge/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差量測'] })
            const b = landNote(`${wd}/knowledge/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差量測'] })
            const c = landNote(`${wd}/knowledge/notes`, { doc: 'c', title: '星等之定義', concepts: ['星等'] })
            await seedNotes(flow, [a, b, c])
            await flow.run()
            const syncDeps = (s) => ({ stores: s, dirs: flow.info().dirs, clock: flow.info().clock, log: silentLog })
            await withStores(flow, async (s) => {
                assert.match((await s.notes.get(a.id)).extractedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
                assert.equal((await s.notes.get(c.id)).extractedAt, '', '未入核心之篇維持摘要之初值')
                await syncNotes(syncDeps(s)) // 基準(首次同步:補記雜湊)
            })
            await sleep(30)
            // 改一句話重點(摘要同步回記錄之欄位,亦為提煉所讀之內容章);摘要之同步只看同步欄位之雜湊,提煉看內容章之內容鍵
            for (const n of [a, c]) {
                const md = readMd(n.file)
                writeMd(n.file, md.front, md.body.replace(`${n.title}之重點`, `修訂：${n.title}之重點須先校正儀器`))
            }
            const det = await withStores(flow, (s) => syncNotes(syncDeps(s)))
            assert.deepEqual([det.changed, det.touchExtracted], [2, 1], JSON.stringify(det))
            const rep = await flow.run()
            assert.deepEqual([subReport(rep, '提煉', 'extract').detail.recheckChanged, subReport(rep, '提煉', 'extract').detail.notesRechecked], [1, 1], '提煉之內容鍵偵測同一變更(只計已被引用者)')
        })

        it('核心記錄之 noteIds 為所用之筆記;關聯之明示刪除之預演據以列出以該篇為出處之核心(提煉之集合開啟時)', async () => {
            const wd = dirOf('cores')
            const { flow } = buildTestExtractor(wd, { aiAdapter: scriptAi({ draft: draftAll }) })
            const a = landNote(`${wd}/knowledge/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差量測'] })
            const b = landNote(`${wd}/knowledge/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差量測'] })
            await seedNotes(flow, [a, b])
            await flow.run()
            await withStores(flow, async (s) => {
                const [core] = await s.cores.select()
                assert.deepEqual([...core.noteIds].sort(), [a.id, b.id].sort())
                const r = await deleteNote(relateDeps(flow, s), a.id, { dryRun: true })
                assert.deepEqual([r.dryRun, r.cores], [true, [core.id]])
            })
            assert.ok(fs.existsSync(a.file), '預演不刪')
        })
    })
})
