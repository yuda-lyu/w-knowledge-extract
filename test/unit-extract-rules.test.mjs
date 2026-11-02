// unit-extract-rules.test.mjs — 同一規則之單一函數(C2c 收斂):各函數之行為,與收斂前各站之手寫式逐案相同(逐案等價;式樣錄自封存之舊版)
//
// 規格來源:各函數之 JSDoc(stores/coreState、stores/conceptSelection、stores/noteFacts)。每條斷言之訊息標明所對之規格句或舊站。
// 執行:自套件根 node <mocha> test/unit-extract-rules.test.mjs(暫存落 test/_tmp/extract-rules-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不發網路、不開埠)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpRoot, removeRoots, PKG_ROOT as PKG } from './tools/extractTestKit.mjs'
import { lexSource, sourceFilesOf } from './tools/captureForTest.mjs'
import { REF_FIELDS } from '../src/stores/coreState.mjs'
import { normalizeConcept } from '../src/core/capturePackage.mjs'
import { writeMd, readMd, noteMaterialText, publishedOf } from '../src/core/summarizePackage.mjs'
import { TERMINAL_STATUSES, ITEM_TEXT_FIELDS, SIDE_TEXT_FIELDS, DEFAULT_LIMITS, codeMapOf, noteOfCode, parseSide, opSidesOf, lengthCapOf, OFFTOPIC_REASON, RETRACT_REASONS, SKIP_REASONS, DISSOLVED_RETRACT_REASON, ACCEPT_DROP_PREFIXES } from '../src/stores/coreState.mjs'
import { DROP_REASONS, DISPUTE_DROP_REASONS } from '../src/workflow/verdicts.mjs'
import { coverageOf } from '../src/stores/coreDelta.mjs'
import { CORE_STATUS, liveCoresOf, isPrimaryCore, isMainCore, coreForKey } from '../src/stores/conceptSelection.mjs'
import { itemTexts } from '../src/standards/coreStandards.mjs'
import { isExtracted, consumedNeedsRebaseline, needsRebaseline, extractMaterialOf } from '../src/stores/noteFacts.mjs'

let TMP = ''

describe('unit-extract-rules', function() {

    before(() => {
        TMP = tmpRoot('extract-rules')
    })

    after(() => {
        removeRoots([TMP])
    })

    it('TERMINAL_STATUSES:終態＝取代、撤回(凍結;原 16 處手寫之同一清單)', () => {
        assert.deepEqual([...TERMINAL_STATUSES], ['superseded', 'retracted'])
        assert.ok(Object.isFrozen(TERMINAL_STATUSES))
    })

    it('核心記錄之判定:liveCoresOf／isPrimaryCore／isMainCore 與收斂前之手寫式逐案相同(分身、併入、類別層、缺 scope、折疊同鍵)', () => {
        const cores = [
            { id: 'a1', concept: '動量', version: 3, noteCount: 5 },
            { id: 'a2', concept: '動量', scope: 'concept', version: 1, noteCount: 9 },
            { id: 'a3', concept: '動量', status: CORE_STATUS.merged, version: 9, mergedInto: 'a1' },
            { id: 'b1', concept: '動量', scope: 'category', version: 2 },
            { id: 'b2', concept: '動量', scope: 'category', version: 1, status: CORE_STATUS.active },
            { id: 'c1', concept: 'Momentum', version: 1, noteCount: 1 },
            { id: 'c2', concept: 'momentum', version: 1, noteCount: 2 },
            { id: 'd1', concept: '價值', status: CORE_STATUS.active, version: 1 },
        ]
        // 舊站之式(巡檢與索引;掃描、重審預覽、同義核對與提煉段之主核心;提煉段之選題綁定)
        const oldLive = (c) => c.status !== 'merged'
        const oldMain = (c) => c.status !== 'merged' && (c.scope || 'concept') === 'concept' && coreForKey(cores, 'concept', normalizeConcept(c.concept))?.id === c.id
        const oldPrimary = (c) => coreForKey(cores, c.scope || 'concept', normalizeConcept(c.concept))?.id === c.id
        assert.deepEqual(liveCoresOf(cores), cores.filter(oldLive), 'liveCoresOf ≡ status !== merged(含類別核心)')
        for (const c of cores) {
            assert.equal(isMainCore(c, cores), oldMain(c), `isMainCore ≡ 舊式:${c.id}`)
            assert.equal(isPrimaryCore(c, cores), oldPrimary(c), `isPrimaryCore ≡ 舊式:${c.id}`)
        }
        // 規格句之具體值:主核心依 version 降冪(分身非主);併入者不為主(版本再高亦然);類別層不為概念層主核心;折疊同鍵取一
        assert.deepEqual(cores.filter((c) => isMainCore(c, cores)).map((c) => c.id), ['a1', 'c2', 'd1'])
        assert.deepEqual(cores.filter((c) => isPrimaryCore(c, cores)).map((c) => c.id), ['a1', 'b1', 'c2', 'd1'])
        assert.deepEqual([liveCoresOf(undefined), liveCoresOf([null, { id: 'x' }]).map((c) => c.id), isMainCore(null, cores), isPrimaryCore(undefined, cores)], [[], ['x'], false, false], '非陣列與空值不拋')
    })

    it('條目之文字欄:ITEM_TEXT_FIELDS／SIDE_TEXT_FIELDS 與收斂前三份手寫清單(套用、存量處置、檢定標準 ES1)逐欄相同;itemTexts 依之列出', () => {
        const OLD = { claims: ['text', 'conditions', 'pros', 'cons', 'period', 'critique', 'basis'], parameters: ['name', 'value', 'conditions', 'period'], questions: ['text', 'resolution'], disputes: ['question', 'note'] }
        assert.deepEqual(JSON.parse(JSON.stringify(ITEM_TEXT_FIELDS)), OLD)
        assert.deepEqual([...SIDE_TEXT_FIELDS], ['position', 'conditions', 'basis'])
        assert.ok(Object.isFrozen(ITEM_TEXT_FIELDS) && Object.isFrozen(ITEM_TEXT_FIELDS.claims) && Object.isFrozen(SIDE_TEXT_FIELDS))
        const d = { question: '問', note: '註', sides: [{ position: '甲', conditions: ['條件一', '條件二'], basis: '轉述' }, { position: '乙' }] }
        assert.deepEqual(itemTexts('disputes', d).map((x) => `${x.field}=${x.text}`), ['question=問', 'note=註', 'sides[0].position=甲', 'sides[0].conditions=條件一', 'sides[0].conditions=條件二', 'sides[0].basis=轉述', 'sides[1].position=乙'], '舊 itemTexts 之欄序')
    })

    it('長度硬上限 lengthCapOf:與收斂前之兩式(套用之拒收:limits[f]×2;ES1:本質取 limits.essence、方之欄以欄名計)逐欄相同', () => {
        const limits = { ...DEFAULT_LIMITS, position: 50 }
        const oldApply = (f) => (limits[f] ? limits[f] * 2 : 0)
        const oldEs1 = (field, isEssence) => {
            const base = String(field).replace(/^sides\[\d+\]\./, '')
            return isEssence ? limits.essence : (limits[base] ? limits[base] * 2 : 0)
        }
        const fields = [...new Set([...Object.values(ITEM_TEXT_FIELDS).flat(), ...SIDE_TEXT_FIELDS, 'nonexistent'])]
        for (const f of fields) {
            assert.equal(lengthCapOf(f, limits), oldApply(f), `套用之式:${f}`)
            assert.equal(lengthCapOf(f, limits), oldEs1(f, false), `ES1 之式:${f}`)
            assert.equal(lengthCapOf(`sides[3].${f}`, limits), oldEs1(`sides[3].${f}`, false), `ES1 之方之欄:${f}`)
        }
        assert.equal(lengthCapOf('essence', limits), oldEs1('essence', true))
        assert.deepEqual([lengthCapOf('text', { text: 200 }), lengthCapOf('sides[1].position', { position: 50 }), lengthCapOf('essence', { essence: 300 }), lengthCapOf('essence', {}), lengthCapOf('text', undefined)], [400, 100, 300, 0, 0])
    })

    it('本批代號 codeMapOf／noteOfCode:完整 id 與代號(不分大小寫)皆對回筆記 id;不在本批回 null;不合之項略過', () => {
        const m = codeMapOf([{ code: 'N1', id: 'n-a' }, { code: 'n2', id: 'n-b' }, { id: 'n-c' }, { code: 'N9' }, null, 'x'])
        assert.deepEqual([...m.entries()], [['n-a', 'n-a'], ['N1', 'n-a'], ['n-b', 'n-b'], ['N2', 'n-b'], ['n-c', 'n-c']])
        assert.deepEqual(['N1', 'n1', ' n2 ', 'n-a', 'n-c', 'N3', '', undefined, 1].map((x) => noteOfCode(m, x)), ['n-a', 'n-a', 'n-b', 'n-a', 'n-c', null, null, null, null])
        assert.deepEqual([...codeMapOf(undefined)], [])
    })

    it('方之索引 parseSide:整數、數字字串、「side k」(不分大小寫、可有空白)→ 整數;其餘 null', () => {
        assert.deepEqual([0, 2, '1', ' 3 ', 'side 1', 'side2', ' Side 4 ', 'SIDE0'].map(parseSide), [0, 2, 1, 3, 1, 2, 4, 0])
        assert.deepEqual(['x', '', '1.5', 'side', '第1方', 1.5, null, undefined, {}].map(parseSide), Array(9).fill(null))
    })

    it('操作所帶之方 opSidesOf:dispute_add 之 sides 與 dispute_update 之 sides_add 依序串接;非陣列視為空', () => {
        assert.deepEqual(opSidesOf({ sides: [{ position: 'a' }], sides_add: [{ position: 'b' }] }).map((x) => x.position), ['a', 'b'])
        assert.deepEqual([opSidesOf({ sides: 'x' }), opSidesOf(null), opSidesOf({})], [[], [], []])
    })

    it('理由名之常數:離題(撤回、剔除、爭議剔除、略過共用同一值)、拆解後之撤回理由、終審致不涵蓋之落帳前綴(coverageOf 之 dropped 以之起首)', () => {
        assert.equal(OFFTOPIC_REASON, '離題')
        for (const list of [RETRACT_REASONS, DROP_REASONS, DISPUTE_DROP_REASONS, SKIP_REASONS]) assert.ok(list.includes(OFFTOPIC_REASON))
        assert.equal(DISSOLVED_RETRACT_REASON, '非對立')
        assert.deepEqual(ACCEPT_DROP_PREFIXES, { dropped: '終審剔除：', removed: '終審刪去出處：' })
        assert.ok(Object.isFrozen(ACCEPT_DROP_PREFIXES))
        const cov = coverageOf({ batch: [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }], applied: [], dropped: [{ sources: ['N1'], reason: '離題' }], removed: [{ note: 'n2', reason: '' }] })
        assert.deepEqual(cov.dropped, [{ note: 'n1', reason: `${ACCEPT_DROP_PREFIXES.dropped}離題` }, { note: 'n2', reason: `${ACCEPT_DROP_PREFIXES.removed}未說明` }])
    })

    it('筆記之提煉面事實:isExtracted(extractedAt 非空)、needsRebaseline(已納入且內容或標題變)、extractMaterialOf(內容章＋原文標題＋發布時間;給 md 不重讀、null＝讀不到、未給讀其檔)', () => {
        assert.deepEqual([isExtracted({ extractedAt: 'T' }), isExtracted({ extractedAt: '' }), isExtracted({}), isExtracted(null)], [true, false, false, false])
        const done = { extractedAt: 'T' }
        assert.deepEqual([
            needsRebaseline(done, { contentChanged: true }), needsRebaseline(done, { titleChanged: true }), needsRebaseline(done, { contentChanged: false, titleChanged: false }),
            needsRebaseline(done, { contentChanged: 'yes' }), needsRebaseline(done, undefined), needsRebaseline({ extractedAt: '' }, { contentChanged: true }),
        ], [true, true, false, false, false, false], '旗標須嚴格 true;未納入者不重設')
        // 以「已納入」之事實判(只持有 consumed 之呼叫端):與以記錄判者同一判準;consumed 須嚴格 true
        assert.deepEqual([
            consumedNeedsRebaseline(true, { contentChanged: true }), consumedNeedsRebaseline(true, { titleChanged: true }), consumedNeedsRebaseline(true, {}),
            consumedNeedsRebaseline(false, { contentChanged: true }), consumedNeedsRebaseline('yes', { contentChanged: true }), consumedNeedsRebaseline(undefined, { titleChanged: true }),
        ], [true, true, false, false, false, false], 'consumed 須嚴格 true;旗標同上')
        for (const [n, c] of [[done, { contentChanged: true }], [done, {}], [{ extractedAt: '' }, { titleChanged: true }], [null, { contentChanged: true }]]) {
            assert.equal(needsRebaseline(n, c), consumedNeedsRebaseline(isExtracted(n), c), '以記錄判＝以事實判')
        }
        const file = `${TMP}/n1.md`
        writeMd(file, { title: 'T1' }, '# T1\n\n## 一句話重點\n\n重點\n\n## 核心知識\n\n- 甲之知識\n\n## 關聯\n\n- [[x]]\n\n## 來源\n\n- 原文標題：甲研究\n- 發布時間：2024-05-01\n')
        const md = readMd(file)
        const want = `${noteMaterialText(md.body)}\n${publishedOf(md.body)}`
        assert.equal(extractMaterialOf({ file }, md), want, '收斂前之式(提煉段與符合度掃描)')
        assert.equal(extractMaterialOf({ file }), want, '未給 md → 讀其檔')
        assert.equal(extractMaterialOf({ file }, null), null, 'md 為 null → 讀不到')
        assert.equal(extractMaterialOf({ file: `${TMP}/none.md` }), null, '檔不在 → null')
        assert.ok(!want.includes('[[x]]'), '不含投影章(關聯)')
    })

    it('ref 欄位集一份(終審 §3 D7「ref 欄位集」):REF_FIELDS 凍結;非測試原始碼中與其 ids／texts 同一組之字面陣列只在 stores/coreState;換號、存待審、文字引用、指向擷取四處皆讀 REF_FIELDS;判準自檢', () => {
        // 規則(stores/coreState 之 REF_FIELDS JSDoc):操作之引用欄位一份,@ref 換號(workflow/candidates)、存待審之 ref 換號(stores/coreDelta)、
        //   文字引用之改寫(standards/opGuards)、指向條目之擷取(workflow/verdicts)同讀
        assert.ok(Object.isFrozen(REF_FIELDS) && Object.isFrozen(REF_FIELDS.ids) && Object.isFrozen(REF_FIELDS.lists) && Object.isFrozen(REF_FIELDS.texts))
        const literalOf = (arr) => new RegExp(`\\[\\s*${arr.map((k) => `['"]${k}['"]`).join('\\s*,\\s*')}\\s*,?\\s*\\]`)
        const SETS = { ids: literalOf(REF_FIELDS.ids), texts: literalOf(REF_FIELDS.texts) }
        // 判準自檢:同一組之字面(單雙引號、尾逗號)抓得到;少一欄或換序者不算同一組
        assert.ok(SETS.ids.test("const K = ['id', 'by', 'into', 'dispute', 'claim']") && SETS.ids.test('x(["id","by","into","dispute","claim",])'))
        assert.ok(!SETS.ids.test("['id', 'by', 'into', 'dispute']") && !SETS.ids.test("['by', 'id', 'into', 'dispute', 'claim']"))
        const lib = sourceFilesOf(`${PKG}/src`)
        assert.ok(lib.length >= 60, `走訪不得空轉:${lib.length}`)
        const hits = []
        for (const f of lib) {
            const code = lexSource(fs.readFileSync(`${PKG}/src/${f}`, 'utf8')).code
            for (const [k, re] of Object.entries(SETS)) if (re.test(code)) hits.push(`${f}:${k}`)
        }
        assert.deepEqual(hits, ['stores/coreState.mjs:ids', 'stores/coreState.mjs:texts'], '同一組之字面只在其家')
        for (const f of ['workflow/candidates.mjs', 'stores/coreDelta.mjs', 'standards/opGuards.mjs', 'workflow/verdicts.mjs']) {
            assert.match(lexSource(fs.readFileSync(`${PKG}/src/${f}`, 'utf8')).code, /\bREF_FIELDS\.(ids|lists|texts)\b/, `${f} 讀 REF_FIELDS`)
        }
    })
})
