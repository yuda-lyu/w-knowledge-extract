// unit-settings.test.mjs — 提煉之設定(core/extractSettings):預設值(逐葉)、逐鍵覆寫、設定錯誤一律拋錯(訊息含完整路徑與可用鍵)、
//   只收 ai／extract 兩段、容量推導與容量自洽警告、功能之開啟判準、判定小組之組成與同家警告、席位表、3+3 之席位語意提示、保留時間、
//   選題參數之映射、實例互不汙染
// 規則(出自 extractSettings 之設計):
//   ①兩段 ai(抓取套件之 ai 段＋健康降序預設 3,不含 parallel)、extract;合併與共用型別取抓取套件之 mergeSettingsGroup／SETTING_TYPES,
//     本段專屬之型別(relationTypes、categoryFallback、extractSeats)經其 opt.types 帶入;席位之形狀一律取抓取套件之 seatProblem
//     (3+3 之七席逐席驗;判定小組之席即其 seatOrNull)
//   ②組逐鍵遞迴合併、葉給了即整個取代;不認得之鍵、型別或值域不符、組形狀錯、ai／extract 以外之段一律拋錯,絕不靜默改用預設
//   ③預設值(35 葉):3+3 七席為免費兩家輪替(起草三席首選為 mimo、big-pickle、mimo;整合、審計、修訂、終審輪流)、判定小組全空且關閉、符合度掃描關、
//     存量與失撐之次數上限 3;期望值寫死於本檔(套件測試不讀套件外之設定)
//   ④容量:提煉＝extract.perRun×extract.notesPerConcept;進料上界由組裝者給(inflow),只警告「進料 > 容量」;perRun 0＝停用不警告
//   ⑤功能之開啟判準(功能表 EXTRACT_FEATURES 之 on;五項);判定小組單一組(extract.standards.ai):任一功能開啟即開啟;已開啟而首兩席首選同家且無不同家之
//     第三席 → 警告永遠無法成立
//   ⑥席位表、席位清單(null 不列;序同組裝者)、3+3 之席位語意提示(起草三家不同、審計／終審換家)
//   ⑦保留時間:提煉啟用＝minRemainingMs,停用 0;選題參數:單一映射(欄名同選題函數之讀法)
//   ⑧各實例拿到之設定互不共用預設常數之參照
// 執行:自套件根 node <mocha> test/unit-settings.test.mjs(純函數,不連網、不寫檔)

import assert from 'node:assert/strict'
import providers from 'w-dispatch-ai/src/providers.mjs'
import {
    EXTRACT_AI_DEFAULT, EXTRACT_AI_SCHEMA, EXTRACT_DEFAULT, EXTRACT_SCHEMA, EXTRACT_SETTING_TYPES, EXTRACT_SEAT_KEYS, extractSeatsProblem,
    resolveExtractSettings, extractCapacityOf, EXTRACT_CAPACITY_DESC, extractWarningsOf, extractPanelsOf, EXTRACT_SEAT_LABELS, extractSeatsOf, EXTRACT_FEATURES,
    extractSeatHintsOf, extractReserveMs, extractPickOf, extractResolvedProblem,
} from '../src/core/extractSettings.mjs'
import { AI_SCHEMA, seatProblem } from '../src/core/capturePackage.mjs'
import { SUMMARIZE_AI_DEFAULT } from '../src/core/summarizePackage.mjs'
import { SETTING_TYPES, SEAT_KEYS, showSettingValue, AI_DEFAULT, msgOf } from './tools/captureForTest.mjs'

const RS = (cfg) => resolveExtractSettings(cfg)

/** 全部型別判準:抓取套件之共用表＋本段專屬者(同 mergeSettingsGroup 之合併,同名以本段者為準) */
const TYPES = { ...SETTING_TYPES, ...EXTRACT_SETTING_TYPES }

/**
 * 序列化供比對:函數以原始碼、RegExp 以樣式與旗標表示,undefined 亦保留
 *
 * @param {*} v 輸入任意值
 * @returns {String} 回傳序列化字串
 */
const snap = (v) => JSON.stringify(v, (k, x) => {
    if (typeof x === 'function') return `fn:${x.toString()}`
    if (x instanceof RegExp) return `re:${x.source}/${x.flags}`
    return x === undefined ? '__undefined__' : x
})

/**
 * schema 之全部葉:路徑、型別、預設值
 *
 * @param {Object} schema 輸入 schema(鍵 → 型別名或子組 schema)
 * @param {Object} dflt 輸入同形之預設值
 * @param {Array} [prefix=[]] 輸入路徑前綴
 * @returns {Array} 回傳 [{ path:Array, type:String, dflt:* }]
 */
function leavesOf(schema, dflt, prefix = []) {
    const out = []
    for (const [k, node] of Object.entries(schema)) {
        if (typeof node === 'string') out.push({ path: [...prefix, k], type: node, dflt: dflt?.[k] })
        else out.push(...leavesOf(node, dflt?.[k], [...prefix, k]))
    }
    return out
}

/**
 * schema 之全部組(含根):路徑與其 schema、預設值
 *
 * @param {Object} schema 輸入 schema
 * @param {Object} dflt 輸入同形之預設值
 * @param {Array} [prefix=[]] 輸入路徑前綴
 * @returns {Array} 回傳 [{ path:Array, schema:Object, dflt:Object }]
 */
function groupsOf(schema, dflt, prefix = []) {
    const out = [{ path: prefix, schema, dflt }]
    for (const [k, node] of Object.entries(schema)) {
        if (typeof node !== 'string') out.push(...groupsOf(node, dflt?.[k], [...prefix, k]))
    }
    return out
}

/** 由路徑與值組出巢狀覆寫物件 */
const nest = (p, value) => p.reduceRight((acc, k) => ({ [k]: acc }), value)
/** 依路徑取值 */
const getAt = (obj, p) => p.reduce((o, k) => o?.[k], obj)
/** 設定值之顯示字串:合併規則之錯誤訊息所用之同一函數(抓取套件之 showSettingValue,經測試專用之橋接) */
const show = showSettingValue

const SONNET = 'claude:sonnet'
const MIMO = 'oc:opencode/mimo-v2.6-flash-free'
const PICKLE = 'oc:opencode/big-pickle'
/** 3+3 之一席(差量之席位逾時 600 秒、最短嘗試時間 90 秒) */
const SEAT = (use, fallback) => ({ use, fallback, timeoutMs: 600_000, minAttemptMs: 90_000 })

/** extract 段之預設(期望值,寫死於本檔——套件測試不讀套件外之設定):3+3 七席為免費兩家輪替,遞補為另一家 */
const EXPECTED = {
    perRun: 4, notesPerConcept: 12, minNotes: 6, minPending: 4, maxWaitDays: 30, catchupBatches: 3, relateGraceDays: 3, sourceCap: 2, noteTries: 2,
    claimsCap: 80, consolidateEvery: 5, minRemainingMs: 900_000, relationTypes: 'conflict', categoryFallback: null,
    ai: {
        drafters: [SEAT(MIMO, [PICKLE]), SEAT(PICKLE, [MIMO]), SEAT(MIMO, [PICKLE])],
        integrate: SEAT(MIMO, [PICKLE]), audit: SEAT(PICKLE, [MIMO]), revise: SEAT(MIMO, [PICKLE]), accept: SEAT(PICKLE, [MIMO]),
    },
    recheck: { slots: 3, perRun: 1, guard: 20, waitDays: 7, relationImpact: false },
    standards: {
        supportCheck: { enabled: false, maxTries: 3 },
        supportStock: { perRun: 0, maxTries: 3 },
        orphanCheck: { perRun: 0, maxTries: 3 },
        disputeCheck: { perRun: 0, minVersions: 1, waitDays: 7, maxTries: 3 },
        synonymCheck: { perRun: 0, maxTries: 3 },
        ai: { first: null, second: null, third: null },
        scanEachRun: false,
    },
}

/** 安裝方之典型覆寫(要點 1 之數值、七席同一家、符合度掃描明設) */
const OWN_SEAT = { use: SONNET, fallback: ['codex:gpt-6-luna'], timeoutMs: 600000, minAttemptMs: 90000 }
const INSTALLER = {
    perRun: 4, notesPerConcept: 12, minNotes: 6, catchupBatches: 1,
    ai: { drafters: [OWN_SEAT, OWN_SEAT, OWN_SEAT], integrate: OWN_SEAT, audit: OWN_SEAT, revise: OWN_SEAT, accept: OWN_SEAT },
    standards: { scanEachRun: true },
}

/** 合格之 3+3 席位(與預設不同) */
const SEATS_OK = { drafters: [{ use: 'x:a' }, { use: 'x:b' }, { use: 'x:c' }], integrate: { use: 'x:d' }, audit: { use: 'x:e' }, revise: { use: 'x:f' }, accept: { use: 'x:g' } }

// 各型別之邊界樣本(合格樣本須通過型別判準、不合格樣本須不通過——判準取抓取套件與本段之型別表,樣本先經其篩過再用;各型別須至少各留一個)
const SAMPLES = {
    pint: { valid: [7, 8], invalid: [0, -1, 1.5, '5', NaN, null, Infinity] },
    p0int: { valid: [7, 8], invalid: [-1, 1.5, '5', NaN, null] },
    p0num: { valid: [0, 1.5, 7], invalid: [-1, '5', NaN, null, Infinity] },
    growth: { valid: [1, 1.5, 4], invalid: [0.5, 0, -1, '2', NaN, Infinity, null] }, // 冷卻加長倍率:≥ 1 之有限數(抓取套件 SETTING_TYPES.growth)
    bool: { valid: [true, false], invalid: ['true', 1, 0, null] },
    objArr: { valid: [[{ id: 'x' }], [{ a: 1 }, { b: 2 }]], invalid: [{}, [1], ['x'], 'x', null] },
    timeouts: { valid: [{ 'x:y': 1000 }], invalid: [{ a: 0 }, { a: 1.5 }, { a: '5' }, [], 'x', null] },
    pools: { valid: [{ oc: { log: 'auto' } }, { oc: { log: 'auto', resetUtcHour: 0 } }], invalid: ['x', [], null, 1, { xx: {} }, { oc: { resetUtcHour: 24 } }] },
    limits: { valid: [{ 'x:y': 30000 }, { a: 1 }], invalid: [{ a: 0 }, { a: 1.5 }, { a: '5' }, [], 'x', null] },
    relationTypes: { valid: ['conflict', 'linked', 'all'], invalid: ['bogus', 'ALL', '', null, 1, true] },
    categoryFallback: { valid: [null, false, { minNotes: 3 }, { minNotes: 3, minGain: 2 }, {}], invalid: [true, 'x', [], { bogus: 1 }, { minNotes: 0 }, { minGain: 1.5 }, 0] },
    extractSeats: {
        valid: [SEATS_OK],
        invalid: [
            'x', [], {}, null, { drafters: [] }, { ...SEATS_OK, bogus: { use: 'x:z' } }, { ...SEATS_OK, accept: null }, { ...SEATS_OK, drafters: [{ use: 'x:a' }, { use: 'x:b' }] },
            // 結構合格而某席之形狀不合(抓取套件之 seatProblem)
            { ...SEATS_OK, integrate: { use: 'x:d', timeout: 1 } }, { ...SEATS_OK, audit: { use: 5 } }, { ...SEATS_OK, drafters: [{ use: 'x:a', fallback: 'x:b' }, { use: 'x:b' }, { use: 'x:c' }] },
        ],
    },
    seatOrNull: { valid: [{ use: 'x:y' }, null, { use: 'x:y', fallback: ['a:b'] }], invalid: ['x', {}, { use: '' }, { use: 5 }, 0, false, [], { use: 'x:y', typo: 1 }, { use: 'x:y', timeoutMs: 0 }] },
}

/**
 * 某型別之樣本(經型別判準篩過)
 *
 * @param {String} type 輸入型別名
 * @returns {Object} 回傳 { valid:Array, invalid:Array }
 */
function samplesOf(type) {
    const t = TYPES[type]
    const s = SAMPLES[type]
    assert.ok(t, `型別「${type}」須在抓取套件之 SETTING_TYPES 或 EXTRACT_SETTING_TYPES`)
    assert.ok(s, `型別「${type}」缺邊界樣本(新增型別須補 SAMPLES)`)
    return { valid: s.valid.filter((v) => t.test(v)), invalid: s.invalid.filter((v) => !t.test(v)) }
}

const SECTIONS = [
    ['ai', EXTRACT_AI_SCHEMA, EXTRACT_AI_DEFAULT],
    ['extract', EXTRACT_SCHEMA, EXTRACT_DEFAULT],
]
const LEAVES = SECTIONS.flatMap(([name, schema, dflt]) => leavesOf(schema, dflt, [name]))
const GROUPS = SECTIONS.flatMap(([name, schema, dflt]) => groupsOf(schema, dflt, [name]))

describe('unit-settings', function() {

    describe('① 預設值', function() {

        it('回傳 ai、extract、capacity、warnings;未給 cfg、給 {}、給非物件皆同;預設設定無警告', () => {
            const s = RS({})
            assert.deepEqual(Object.keys(s), ['ai', 'extract', 'capacity', 'warnings'])
            assert.equal(snap(RS()), snap(s))
            assert.equal(snap(RS('x')), snap(s))
            assert.equal(snap(RS(null)), snap(s))
            assert.deepEqual(s.warnings, [])
        })

        it('extract 段逐葉＝預設(36 葉;空設定與安裝方之典型覆寫兩案)', () => {
            const leaves = leavesOf(EXTRACT_SCHEMA, EXPECTED)
            assert.equal(leaves.length, 36)
            const s0 = RS({}).extract
            for (const l of leaves) assert.equal(snap(getAt(s0, l.path)), snap(l.dflt), `空設定:extract.${l.path.join('.')}`)
            assert.deepEqual(s0, EXPECTED)
            assert.deepEqual(Object.keys(s0), Object.keys(EXPECTED), '鍵序同現行')
            // 典型覆寫:給了的葉取給定值(3+3 席位整份取代),其餘葉維持現行預設
            const s1 = RS({ extract: INSTALLER }).extract
            const want = { ...EXPECTED, perRun: 4, notesPerConcept: 12, minNotes: 6, catchupBatches: 1, ai: INSTALLER.ai, standards: { ...EXPECTED.standards, scanEachRun: true } }
            for (const l of leavesOf(EXTRACT_SCHEMA, want)) assert.equal(snap(getAt(s1, l.path)), snap(l.dflt), `典型覆寫:extract.${l.path.join('.')}`)
            assert.deepEqual(s1, want)
        })

        it('預設與 schema 之鍵集逐組一致,且每個預設值本身通過所屬型別之判準', () => {
            for (const g of GROUPS) assert.deepEqual(Object.keys(g.dflt).sort(), Object.keys(g.schema).sort(), `${g.path.join('.')}:預設鍵集應等於 schema 鍵集`)
            for (const l of LEAVES) {
                assert.ok(TYPES[l.type], `${l.path.join('.')}:型別「${l.type}」須在型別表`)
                assert.ok(TYPES[l.type].test(l.dflt), `${l.path.join('.')} 之預設值須合型別「${l.type}」`)
            }
        })

        it('ai 段＝抓取套件之 ai 段＋健康降序預設 3(schema 同一物件;預設取摘要套件之 ai 段去 parallel——健康降序之預設只一份);不含 parallel', () => {
            assert.equal(EXTRACT_AI_SCHEMA, AI_SCHEMA, 'schema 同一物件,不另寫')
            assert.ok('healthStreak' in AI_SCHEMA, '前提:抓取套件之 ai 段有健康降序之鍵')
            assert.deepEqual(EXTRACT_AI_DEFAULT, { ...AI_DEFAULT, healthStreak: 3 })
            const { parallel: _p, ...sumAi } = SUMMARIZE_AI_DEFAULT
            assert.deepEqual(EXTRACT_AI_DEFAULT, sumAi, '即摘要套件之 ai 段預設去 parallel')
            assert.deepEqual(Object.keys(EXTRACT_AI_DEFAULT), Object.keys(AI_DEFAULT), '鍵與序同抓取套件')
            assert.notEqual(EXTRACT_AI_DEFAULT.providerTimeouts, AI_DEFAULT.providerTimeouts, '預設為複本,不與抓取套件共用參照')
            assert.equal(RS({}).ai.healthStreak, 3)
            assert.equal(AI_DEFAULT.healthStreak, 0, '抓取套件之預設不受影響')
            assert.equal('parallel' in EXTRACT_AI_SCHEMA || 'parallel' in EXTRACT_AI_DEFAULT, false)
        })

        it('本段專屬之型別:relationTypes、categoryFallback、extractSeats(凍結;不在共用之型別表);判定小組之席為共用表之 seatOrNull(驗鍵集與數值,同 AI 調度層)', () => {
            assert.deepEqual(Object.keys(EXTRACT_SETTING_TYPES), ['relationTypes', 'categoryFallback', 'extractSeats'])
            assert.ok(Object.isFrozen(EXTRACT_SETTING_TYPES) && Object.values(EXTRACT_SETTING_TYPES).every(Object.isFrozen))
            for (const k of ['relationTypes', 'categoryFallback', 'extractSeats']) assert.equal(k in SETTING_TYPES, false, `${k} 不在共用之型別表`)
            const extra = { use: 'x:y', typo: 1 }
            assert.equal(msgOf(() => RS({ extract: { standards: { ai: { first: extra } } } })), `settings.extract.standards.ai.first 須為${SETTING_TYPES.seatOrNull.desc}，收到 object（${seatProblem(extra)}）`, '打錯之鍵於解析設定時即拋')
            assert.deepEqual(RS({ extract: { standards: { ai: { first: { use: 'x:y', fallback: ['a:b'], timeoutMs: 1000 } } } } }).extract.standards.ai.first, { use: 'x:y', fallback: ['a:b'], timeoutMs: 1000 })
        })

        it('3+3 席位之逐席形狀取抓取套件之 seatProblem(與 AI 調度層同一判準):不認得之鍵、use 非字串、fallback 非字串陣列、數值鍵非正數 → 拋,訊息列各席與原因;結構之字樣照 extractSeatsProblem', () => {
            const D = '提煉席位 { drafters:[3 席], integrate, audit, revise, accept }'
            const bad = { ...SEATS_OK, drafters: [{ use: 'x:a', fallback: 'x:b' }, { use: 'x:b' }, { use: 'x:c', timeoutMs: -1 }], integrate: { use: 'x:d', timeout: 1 } }
            const why = [`drafters[0] → ${seatProblem(bad.drafters[0])}`, `drafters[2] → ${seatProblem(bad.drafters[2])}`, `integrate → 含不認得之鍵：timeout（可用：${SEAT_KEYS.join('、')}）`].join('；')
            assert.equal(msgOf(() => RS({ extract: { ai: bad } })), `settings.extract.ai 須為${D}，收到 object（settings.extract.ai 之席位不合：${why}）`)
            assert.equal(extractSeatsProblem(bad), '', '結構合格(逐席之形狀屬設定型別,不改 extractSeatsProblem 之字樣)')
            assert.equal(msgOf(() => RS({ extract: { ai: { ...SEATS_OK, audit: { use: 5 } } } })), `settings.extract.ai 須為${D}，收到 object（settings.extract.ai 之席位不合：audit → use 須為非空字串（條目 id））`)
            assert.deepEqual(RS({ extract: { ai: { ...SEATS_OK, accept: { use: 'x:g', fallback: null, budgetMs: 5 } } } }).extract.ai.accept, { use: 'x:g', fallback: null, budgetMs: 5 }, '合格之鍵照收')
        })

        it('預設席位皆在 AI 調度層之內建目錄(零設定可組裝)且全為免費兩家(起草三席首選為 mimo、big-pickle、mimo;遞補為另一家);判定小組空席且關閉;符合度掃描預設關', () => {
            const s = RS({}).extract
            const catalogue = new Set(providers.map((p) => p.id))
            const seats = [...s.ai.drafters, s.ai.integrate, s.ai.audit, s.ai.revise, s.ai.accept]
            for (const id of new Set(seats.flatMap((x) => [x.use, ...x.fallback]))) assert.ok(catalogue.has(id), `預設席位 ${id} 須在 w-dispatch-ai 內建目錄`)
            for (const x of seats) assert.deepEqual([x.use, ...x.fallback].sort(), [MIMO, PICKLE].sort(), `${x.use}:首選＋遞補恰為免費兩家`)
            assert.deepEqual(s.ai.drafters.map((x) => x.use), [MIMO, PICKLE, MIMO], '起草三席首選輪替')
            assert.deepEqual([s.ai.integrate.use, s.ai.audit.use, s.ai.revise.use, s.ai.accept.use], [MIMO, PICKLE, MIMO, PICKLE])
            assert.deepEqual(s.standards.ai, { first: null, second: null, third: null })
            assert.deepEqual([s.standards.supportCheck.enabled, s.standards.disputeCheck.perRun, s.standards.supportStock.perRun, s.standards.orphanCheck.perRun, s.standards.synonymCheck.perRun], [false, 0, 0, 0, 0], '四專步皆以 perRun > 0 開啟(終審 §3 A-5:無另一個 enabled 開關)')
            assert.deepEqual([s.standards.supportCheck.maxTries, s.standards.supportStock.maxTries, s.standards.orphanCheck.maxTries, s.standards.disputeCheck.maxTries, s.standards.synonymCheck.maxTries], [3, 3, 3, 3, 3], '五個判定小組之逐項次數上限皆預設 3(判不了逾次 → 使用者)')
            assert.equal(s.standards.scanEachRun, false)
            assert.deepEqual([...EXTRACT_SEAT_KEYS], ['drafters', 'integrate', 'audit', 'revise', 'accept'])
            assert.ok(Object.isFrozen(EXTRACT_SEAT_KEYS))
        })
    })

    describe('② 逐鍵覆寫與型別錯誤(兩段 × 全部葉)', function() {

        for (const [name, schema, dflt] of SECTIONS) {
            it(`${name}:每個葉逐一覆寫 → 該葉取給定值,其餘全部葉維持預設`, () => {
                const base = RS({})
                for (const leaf of leavesOf(schema, dflt, [name])) {
                    const sample = samplesOf(leaf.type).valid.find((v) => snap(v) !== snap(leaf.dflt))
                    assert.notEqual(sample, undefined, `${leaf.path.join('.')}:找不到與預設不同之合格樣本`)
                    const r = RS(nest(leaf.path, sample))
                    assert.equal(snap(getAt(r, leaf.path)), snap(sample), `${leaf.path.join('.')} 應取給定值`)
                    for (const other of LEAVES) {
                        if (other.path.join('.') !== leaf.path.join('.')) assert.equal(snap(getAt(r, other.path)), snap(getAt(base, other.path)), `${other.path.join('.')} 不應受 ${leaf.path.join('.')} 影響`)
                    }
                }
            })

            it(`${name}:每個葉給不合格值 → 拋錯,訊息含完整路徑、型別說明與收到之值`, () => {
                for (const leaf of leavesOf(schema, dflt, [name])) {
                    const { invalid } = samplesOf(leaf.type)
                    assert.ok(invalid.length, `${leaf.path.join('.')}:缺不合格樣本`)
                    for (const bad of invalid) {
                        const m = msgOf(() => RS(nest(leaf.path, bad)))
                        const prefix = `settings.${leaf.path.join('.')} 須為${TYPES[leaf.type].desc}，收到 ${show(bad)}`
                        assert.ok(m && m.startsWith(prefix), `${leaf.path.join('.')}=${snap(bad)}:${m}`)
                    }
                }
            })
        }

        it('各段給了但非物件 → 拋(訊息含路徑);組之形狀錯亦拋;undefined／null 之組視為未給', () => {
            assert.equal(msgOf(() => RS({ extract: [1, 2] })), 'settings.extract 須為物件，收到 array')
            assert.equal(msgOf(() => RS({ extract: 'x' })), 'settings.extract 須為物件，收到 "x"')
            assert.equal(msgOf(() => RS({ ai: 'xyz' })), 'settings.ai 須為物件，收到 "xyz"')
            assert.equal(msgOf(() => RS({ extract: { standards: 'on' } })), 'settings.extract.standards 須為物件，收到 "on"')
            assert.equal(msgOf(() => RS({ extract: { recheck: [] } })), 'settings.extract.recheck 須為物件，收到 array')
            assert.equal(msgOf(() => RS({ extract: { standards: { ai: 5 } } })), 'settings.extract.standards.ai 須為物件，收到 5')
            assert.equal(snap(RS({ ai: null, extract: null })), snap(RS({})))
            assert.equal(snap(RS({ extract: { recheck: null, standards: undefined } }).extract), snap(RS({}).extract))
        })

        it('不認得之鍵 → 拋並列該組之可用鍵(每一組皆然;他段與舊名之鍵亦拒)', () => {
            for (const g of GROUPS) {
                const where = g.path.join('.')
                assert.equal(msgOf(() => RS(nest(g.path, { zz: 1 }))), `settings.${where} 含不認得之鍵：zz（可用：${Object.keys(g.schema).join('、')}）`, where)
            }
            assert.match(msgOf(() => RS({ extract: { distilPerRun: 2 } })), /^settings\.extract 含不認得之鍵：distilPerRun（可用：/)
            assert.equal(msgOf(() => RS({ extract: { standards: { ai: { judge: { use: 'x:y' } } } } })), 'settings.extract.standards.ai 含不認得之鍵：judge（可用：first、second、third）', '判定小組之席名為 first／second／third')
            assert.match(msgOf(() => RS({ extract: { parallel: 3 } })), /^settings\.extract 含不認得之鍵：parallel/)
        })

        it('只收 ai、extract 兩段:他段(含值為 undefined 者)→ 拋並列可用之段', () => {
            assert.equal(msgOf(() => RS({ relate: {} })), 'settings 含不認得之鍵：relate（可用：ai、extract）')
            assert.equal(msgOf(() => RS({ capture: {}, summarize: {}, indexTitle: 'x', extract: {} })), 'settings 含不認得之鍵：capture、summarize、indexTitle（可用：ai、extract）')
            assert.equal(msgOf(() => RS({ relate: undefined })), 'settings 含不認得之鍵：relate（可用：ai、extract）')
        })

        it('ai 段不收 parallel 與供應商池(提煉不讀;席位即呼叫之依據)', () => {
            for (const k of ['parallel', 'providerPick']) {
                assert.equal(msgOf(() => RS({ ai: { [k]: 3 } })), `settings.ai 含不認得之鍵：${k}（可用：${Object.keys(EXTRACT_AI_SCHEMA).join('、')}）`, k)
            }
        })

        it('3+3 席位:給了即整份取代(不與預設合併);不合 3+3 → 拋,訊息附席位問題', () => {
            assert.deepEqual(RS({ extract: { ai: SEATS_OK } }).extract.ai, SEATS_OK)
            const D = '提煉席位 { drafters:[3 席], integrate, audit, revise, accept }'
            assert.equal(msgOf(() => RS({ extract: { ai: ['a'] } })), `settings.extract.ai 須為${D}，收到 array（提煉需要 settings.extract.ai = { drafters:[3 席], integrate, audit, revise, accept }(3+3 工作流之席位)）`)
            assert.equal(msgOf(() => RS({ extract: { ai: { drafters: [] } } })), `settings.extract.ai 須為${D}，收到 object（settings.extract.ai.drafters 須為 3 個席位 [{ use, fallback }, …](三家獨立起草)）`)
            assert.match(msgOf(() => RS({ extract: { ai: { ...SEATS_OK, revise: undefined } } })), /settings\.extract\.ai 缺席位：revise/)
        })

        it('extractSeatsProblem:合格回 \'\';非物件、不認得之鍵、起草非 3 席或席位無 use、缺席位 → 各自之說明', () => {
            assert.equal(extractSeatsProblem(SEATS_OK), '')
            assert.equal(extractSeatsProblem(EXPECTED.ai), '')
            for (const bad of [undefined, null, 'x', []]) assert.equal(extractSeatsProblem(bad), '提煉需要 settings.extract.ai = { drafters:[3 席], integrate, audit, revise, accept }(3+3 工作流之席位)', JSON.stringify(bad))
            assert.equal(extractSeatsProblem({ ...SEATS_OK, judge: {}, x: 1 }), 'settings.extract.ai 含不認得之鍵：judge、x（可用：drafters、integrate、audit、revise、accept）——3+3 工作流＝三家獨立起草 → 整合 → 審計 → 修訂 → 終審 → 程式套用', '不認得之鍵為 checkKeys 之格式')
            for (const drafters of [[], [{ use: 'a' }, { use: 'b' }], [{ use: 'a' }, { use: 'b' }, {}], [{ use: 'a' }, { use: 'b' }, { use: 'c' }, { use: 'd' }], 'x']) {
                assert.equal(extractSeatsProblem({ ...SEATS_OK, drafters }), 'settings.extract.ai.drafters 須為 3 個席位 [{ use, fallback }, …](三家獨立起草)', JSON.stringify(drafters))
            }
            assert.equal(extractSeatsProblem({ drafters: SEATS_OK.drafters, integrate: { use: 'x' }, audit: { use: '' } }), 'settings.extract.ai 缺席位：audit、revise、accept(各為 { use, fallback, timeoutMs?, minAttemptMs? })')
        })

        it('類別後備與關聯脈絡之型別:合法值照收;不合 → 拋(訊息含型別說明)', () => {
            assert.deepEqual(RS({ extract: { categoryFallback: { minNotes: 3 } } }).extract.categoryFallback, { minNotes: 3 })
            assert.equal(RS({ extract: { categoryFallback: false } }).extract.categoryFallback, false)
            assert.equal(msgOf(() => RS({ extract: { categoryFallback: { minNotes: 6, bogus: 1 } } })), 'settings.extract.categoryFallback 須為null／false（停用）或物件 { minNotes?:正整數, minGain?:正整數 }，收到 object')
            for (const v of ['conflict', 'linked', 'all']) assert.equal(RS({ extract: { relationTypes: v } }).extract.relationTypes, v)
            assert.equal(msgOf(() => RS({ extract: { relationTypes: 'bogus' } })), "settings.extract.relationTypes 須為'conflict'｜'linked'｜'all'，收到 \"bogus\"")
        })

        it('cfg 子組為有效物件 → 逐鍵遞迴合併(只給想調的鍵,同組與兄弟組其餘沿用預設)', () => {
            const s = RS({ extract: { standards: { disputeCheck: { perRun: 5 } } } })
            assert.equal(s.extract.standards.disputeCheck.perRun, 5)
            assert.deepEqual(s.extract.standards.disputeCheck, { ...EXPECTED.standards.disputeCheck, perRun: 5 })
            assert.deepEqual(s.extract.standards.ai, EXPECTED.standards.ai)
            assert.deepEqual([s.extract.recheck, s.extract.ai, s.extract.perRun], [EXPECTED.recheck, EXPECTED.ai, EXPECTED.perRun])
        })
    })

    describe('③ 容量推導', function() {

        it('預設:提煉 4×12＝48;extractCapacityOf 為唯一推導;推導式說明為常數', () => {
            const s = RS({})
            assert.deepEqual(s.capacity, { extract: 48 })
            assert.deepEqual(extractCapacityOf(s), s.capacity)
            assert.deepEqual(EXTRACT_CAPACITY_DESC, { extract: 'extract.perRun×extract.notesPerConcept' })
            assert.ok(Object.isFrozen(EXTRACT_CAPACITY_DESC))
        })

        it('公式:perRun 與 notesPerConcept 相乘;perRun 0 → 容量 0', () => {
            assert.equal(RS({ extract: { perRun: 5, notesPerConcept: 7 } }).capacity.extract, 35)
            assert.equal(RS({ extract: { perRun: 0 } }).capacity.extract, 0)
        })
    })

    describe('④ 容量自洽警告(進料上界由組裝者給;只警告進料 > 容量;訊息逐字)', function() {
        const W = (max, desc, cap) => `筆記進料上界約 ${max} 篇（${desc}）大於提煉容量 ${cap}（extract.perRun×extract.notesPerConcept）：待提煉之筆記會逐輪堆積；調高 extract.perRun 或 extract.notesPerConcept`

        it('進料上界 > 容量 → 警告;等於 → 不警告;未給進料 → 不判', () => {
            const s = RS({})
            assert.deepEqual(extractWarningsOf(s, { inflow: { max: 49, desc: '上游容量 98×產出率 0.5' } }), [W(49, '上游容量 98×產出率 0.5', 48)])
            assert.deepEqual(extractWarningsOf(s, { inflow: { max: 48, desc: '上游' } }), [])
            assert.deepEqual(extractWarningsOf(s, { inflow: { max: 0, desc: '上游' } }), [])
            assert.deepEqual([extractWarningsOf(s), extractWarningsOf(s, {}), extractWarningsOf(s, null), extractWarningsOf(s, { inflow: null })], [[], [], [], []])
            assert.deepEqual(extractWarningsOf(RS({ extract: { perRun: 1 } }), { inflow: { max: 27, desc: 'x' } }), [W(27, 'x', 12)])
        })

        it('extract.perRun 0＝刻意停用:進料再大亦不警告', () => {
            assert.deepEqual(extractWarningsOf(RS({ extract: { perRun: 0 } }), { inflow: { max: 9999, desc: '上游' } }), [])
        })

        it('進料上界之形狀錯 → 拋錯(組裝者之依賴不靜默略過)', () => {
            const s = RS({})
            for (const bad of [{ max: -1, desc: 'x' }, { max: '40', desc: 'x' }, { max: NaN, desc: 'x' }, { max: Infinity, desc: 'x' }, { max: 40 }, { max: 40, desc: '' }, 'x', 40]) {
                assert.match(msgOf(() => extractWarningsOf(s, { inflow: bad })), /^extractWarningsOf 之 opt\.inflow 須為 \{ max: 非負數/, JSON.stringify(bad))
            }
        })

        it('resolveExtractSettings 之 warnings＝extractWarningsOf(不給進料)之結果;他總組裝之同形設定(ai 段可另有本套件不收之鍵)取同一組警告', () => {
            const a = { use: 'x:a' }
            const s = RS({ extract: { standards: { supportCheck: { enabled: true }, ai: { first: a, second: a } } } })
            assert.equal(s.warnings.length, 1)
            assert.deepEqual(extractWarningsOf(s), s.warnings)
            assert.deepEqual(extractWarningsOf({ ...s, ai: { ...s.ai, providerPick: ['x:a'], parallel: 3 } }), s.warnings, 'ai 段多出之鍵不影響')
        })
    })

    describe('⑤ 判定小組之組成與同家警告(單一組;訊息逐字)', function() {
        const W = (use) => `提煉覆核（extract.standards.ai）：first 與 second 之首選同為「${use}」且無首選不同之第三席（third）——兩票為同一供應者，判定小組永遠無法成立（只會逐輪重試、逾次轉使用者）；請改其一席之 use，或設首選不同之 third`
        /** 開啟判準之五項(各自單獨開啟) */
        const ON = [
            ['出處支持覆核 supportCheck.enabled', { supportCheck: { enabled: true } }],
            ['爭議覆核 disputeCheck.perRun>0', { disputeCheck: { perRun: 1 } }],
            ['出處支持之存量覆核 supportStock.perRun>0', { supportStock: { perRun: 1 } }],
            ['失撐主張之專責佇列 orphanCheck.perRun>0', { orphanCheck: { perRun: 2 } }],
            ['同義核心核對 synonymCheck.perRun>0', { synonymCheck: { perRun: 3 } }],
        ]

        it('EXTRACT_FEATURES:功能表之設定面(凍結;序同訊息之序)——各覆核之稱呼、判定小組(共用 extract.standards.ai,first／second 必填)', () => {
            assert.deepEqual(EXTRACT_FEATURES.map((f) => [f.key, f.what, f.panel.path, f.panel.seats]), [
                ['supportCheck', '出處支持覆核(extract.standards.supportCheck.enabled)', 'extract.standards.ai', ['first', 'second']],
                ['supportStock', '出處支持存量覆核(extract.standards.supportStock.perRun > 0)', 'extract.standards.ai', ['first', 'second']],
                ['orphanCheck', '失撐主張專責佇列(extract.standards.orphanCheck.perRun > 0)', 'extract.standards.ai', ['first', 'second']],
                ['disputeCheck', '爭議覆核(extract.standards.disputeCheck.perRun > 0)', 'extract.standards.ai', ['first', 'second']],
                ['synonymCheck', '同義核心核對(extract.standards.synonymCheck.perRun > 0)', 'extract.standards.ai', ['first', 'second']],
            ])
            assert.ok(Object.isFrozen(EXTRACT_FEATURES) && EXTRACT_FEATURES.every((f) => Object.isFrozen(f) && Object.isFrozen(f.panel)))
        })

        it('EXTRACT_FEATURES 之開啟判準:五項各自(新進覆核為開關 true、四專步為 perRun > 0);非開關之鍵不開啟;無 extract 段皆不開', () => {
            const onOf = (s) => Object.fromEntries(EXTRACT_FEATURES.map((f) => [f.key, f.on(s) === true]))
            const none = { supportCheck: false, supportStock: false, orphanCheck: false, disputeCheck: false, synonymCheck: false }
            assert.deepEqual(onOf(RS({})), none)
            const keys = ['supportCheck', 'disputeCheck', 'supportStock', 'orphanCheck', 'synonymCheck']
            ON.forEach(([name, standards], i) => assert.deepEqual(onOf(RS({ extract: { standards } })), { ...none, [keys[i]]: true }, name))
            assert.deepEqual(onOf(RS({ extract: { standards: { disputeCheck: { waitDays: 5, maxTries: 9 }, supportStock: { maxTries: 9 } } } })), none, '爭議覆核之等待天數與次數上限、存量之次數上限不開啟')
            assert.deepEqual([onOf({}), onOf(null), onOf({ extract: 'x' })], [none, none, none])
        })

        it('extractPanelsOf:單一組之標準(序同席位檢核工具)、設定路徑、名稱、成員(first／second 必填、third 選填)、投票組合;預設關閉且空席;無 extract 段 → []', () => {
            const g = extractPanelsOf(RS({}))
            assert.equal(g.length, 1)
            assert.deepEqual([g[0].std, g[0].path, g[0].name, g[0].on], ['ES9／ES14／ES8／ES11', 'extract.standards.ai', '提煉覆核', false])
            assert.deepEqual(g[0].members, [{ label: 'first', seat: null, required: true }, { label: 'second', seat: null, required: true }, { label: 'third', seat: null, required: false }])
            assert.deepEqual(g[0].ballots, [[0, 1, 2]])
            const seat = (n) => ({ use: `x:${n}` })
            const set = extractPanelsOf(RS({ extract: { standards: { ai: { first: seat('a'), third: seat('c') } } } }))[0]
            assert.deepEqual(set.members.map((m) => m.seat?.use ?? null), ['x:a', null, 'x:c'])
            assert.deepEqual([extractPanelsOf({}), extractPanelsOf(null), extractPanelsOf({ extract: 'x' })], [[], [], []])
        })

        it('開啟判準五項:任一項單獨開啟即開啟;皆未開 → 關;爭議覆核之 waitDays 與存量覆核之 maxTries 等非開關之鍵不開啟', () => {
            for (const [name, standards] of ON) assert.equal(extractPanelsOf(RS({ extract: { standards } }))[0].on, true, name)
            assert.equal(extractPanelsOf(RS({ extract: { standards: { disputeCheck: { waitDays: 5 }, supportStock: { perRun: 0, maxTries: 5 } }, recheck: { relationImpact: true } } }))[0].on, false)
            assert.equal(extractPanelsOf(RS({ extract: { standards: { supportCheck: { enabled: false }, synonymCheck: { perRun: 0 } } } }))[0].on, false)
        })

        it('同家警告:已開啟而 first、second 首選同家(遞補不同仍算同家)且無不同家之第三席 → 警告;第三席同家亦警告;第三席不同家、兩席不同家、缺席、未開啟 → 不警告', () => {
            const a = { use: 'x:a', fallback: ['x:b'] }
            for (const [name, standards] of ON) {
                const on = (ai) => RS({ extract: { standards: { ...standards, ai } } }).warnings
                assert.deepEqual(on({ first: a, second: { use: 'x:a', fallback: ['x:c'] } }), [W('x:a')], name)
                assert.deepEqual(on({ first: a, second: a, third: { use: 'x:a' } }), [W('x:a')], `${name}:第三席同家`)
                assert.deepEqual(on({ first: a, second: a, third: { use: 'x:c' } }), [], `${name}:第三席不同家`)
                assert.deepEqual(on({ first: a, second: { use: 'x:b' } }), [], `${name}:兩席不同家`)
                assert.deepEqual(on({ first: a, second: null }), [], `${name}:缺席屬組裝者之啟動期檢核`)
            }
            assert.deepEqual(RS({ extract: { standards: { ai: { first: a, second: a } } } }).warnings, [], '未開啟不判')
        })

        it('多條警告之順序:容量在前,其次判定小組', () => {
            const a = { use: 'x:a' }
            const s = RS({ extract: { perRun: 1, standards: { orphanCheck: { perRun: 1 }, ai: { first: a, second: a } } } })
            const w = extractWarningsOf(s, { inflow: { max: 99, desc: 'x' } })
            assert.equal(w.length, 2)
            assert.ok(w[0].startsWith('筆記進料上界約 99 篇'))
            assert.equal(w[1], W('x:a'))
        })
    })

    describe('⑥ 席位表、席位清單與 3+3 之席位語意提示', function() {

        it('EXTRACT_SEAT_LABELS:全部可設之席位(路徑 → 顯示名),序同組裝者列席位之序', () => {
            assert.deepEqual(Object.entries(EXTRACT_SEAT_LABELS), [
                ['extract.ai.drafters[0]', '起草1'], ['extract.ai.drafters[1]', '起草2'], ['extract.ai.drafters[2]', '起草3'],
                ['extract.ai.integrate', '整合'], ['extract.ai.audit', '審計'], ['extract.ai.revise', '修訂'], ['extract.ai.accept', '終審'],
                ['extract.standards.ai.first', '提煉覆核第一席'], ['extract.standards.ai.second', '提煉覆核第二席'], ['extract.standards.ai.third', '提煉覆核第三席'],
            ])
            assert.ok(Object.isFrozen(EXTRACT_SEAT_LABELS))
        })

        it('extractSeatsOf:預設 7 席(起草三席、整合、審計、修訂、終審;判定小組之空席不列),值即設定之席位;全設時路徑與席位表一致', () => {
            const s = RS({})
            const seats = extractSeatsOf(s)
            assert.deepEqual(Object.keys(seats), Object.keys(EXTRACT_SEAT_LABELS).slice(0, 7))
            assert.equal(seats['extract.ai.drafters[1]'], s.extract.ai.drafters[1], '同一物件')
            assert.equal(seats['extract.ai.accept'], s.extract.ai.accept)
            const seat = (n) => ({ use: `x:${n}` })
            const all = RS({ extract: { standards: { ai: { first: seat('p1'), second: seat('p2'), third: seat('p3') } } } })
            assert.deepEqual(Object.keys(extractSeatsOf(all)), Object.keys(EXTRACT_SEAT_LABELS))
            assert.deepEqual(Object.values(extractSeatsOf(all)).slice(7).map((x) => x.use), ['x:p1', 'x:p2', 'x:p3'])
            assert.deepEqual(Object.keys(extractSeatsOf(RS({ extract: { standards: { ai: { second: seat('p2') } } } }))).slice(7), ['extract.standards.ai.second'])
            assert.deepEqual([extractSeatsOf({}), extractSeatsOf(null)], [{}, {}], '無 extract 段 → 空')
        })

        it('extractSeatHintsOf:起草三席之首選三家不同與否、審計／終審之首選與起草／整合同家與否(只提示;字樣逐字)', () => {
            // 預設:免費模型只有兩家,起草三席之首選只有 2 家不同;審計與終審之首選必與某起草席同家(此為第二起草席)
            assert.deepEqual(extractSeatHintsOf(RS({})), [
                { key: 'drafters', paths: ['extract.ai.drafters[0]', 'extract.ai.drafters[1]', 'extract.ai.drafters[2]'], uses: [MIMO, PICKLE, MIMO], ok: false, text: `起草三席之首選：${MIMO}、${PICKLE}、${MIMO}——只有 2 家（計票以供應商計，多數支持之判斷退化）` },
                { key: 'audit', paths: ['extract.ai.audit'], uses: [PICKLE], ok: false, text: `審計首選與起草／整合同家：${PICKLE}（同家即自審）` },
                { key: 'accept', paths: ['extract.ai.accept'], uses: [PICKLE], ok: false, text: `終審首選與起草／整合同家：${PICKLE}（同家即自審）` },
            ])
            // 七席同一家:起草只有 1 家
            const one = extractSeatHintsOf(RS({ extract: INSTALLER }))
            assert.deepEqual(one.map((h) => [h.key, h.ok]), [['drafters', false], ['audit', false], ['accept', false]])
            assert.equal(one[0].text, `起草三席之首選：${SONNET}、${SONNET}、${SONNET}——只有 1 家（計票以供應商計，多數支持之判斷退化）`)
            // 起草三家不同、審計與終審換家
            const ok = extractSeatHintsOf(RS({ extract: { ai: SEATS_OK } }))
            assert.deepEqual(ok.map((h) => [h.key, h.ok]), [['drafters', true], ['audit', true], ['accept', true]])
            assert.deepEqual(ok.slice(1).map((h) => h.text), ['審計首選與起草／整合同家：否', '終審首選與起草／整合同家：否'])
            // 審計與整合同家亦算自審;起草 2 家
            const two = extractSeatHintsOf(RS({ extract: { ai: { ...SEATS_OK, drafters: [{ use: 'x:a' }, { use: 'x:a' }, { use: 'x:c' }], audit: { use: 'x:d' } } } }))
            assert.deepEqual(two.map((h) => [h.key, h.ok]), [['drafters', false], ['audit', false], ['accept', true]])
            assert.match(two[0].text, /——只有 2 家/)
            // 席位結構不合 3+3 → 不提示(結構問題見 extractSeatsProblem)
            assert.deepEqual([extractSeatHintsOf({}), extractSeatHintsOf({ extract: { ai: { drafters: [] } } })], [[], []])
        })
    })

    describe('⑦ 保留時間與選題參數', function() {

        it('extractResolvedProblem(提煉段開工之守門;終審 C-20):解析後之設定合格;缺鍵(預設非 null 者)、錯型別、不認得之鍵、無 extract 段 → 問題;預設為 null 之葉缺之同 null', () => {
            // 規則:core/extractSettings 之 extractResolvedProblem——提煉段之各值只取解析後之設定,不另寫退路
            const ok = RS({ extract: { perRun: 2, standards: { ai: { first: { use: 'x' }, second: { use: 'y' } } } } })
            assert.equal(extractResolvedProblem(ok), '')
            const cut = RS({})
            delete cut.extract.standards.disputeCheck.minVersions
            delete cut.extract.noteTries
            assert.equal(extractResolvedProblem(cut), 'settings.extract 未經解析（缺 settings.extract.noteTries、settings.extract.standards.disputeCheck.minVersions）：提煉之各值只取解析後之設定（resolveExtractSettings 或以 EXTRACT_SCHEMA 解析之同形設定）')
            const noRecheck = RS({})
            delete noRecheck.extract.recheck
            assert.match(extractResolvedProblem(noRecheck), /^settings\.extract 未經解析（缺 settings\.extract\.recheck）/, '缺整組只報組名')
            const nulls = RS({})
            nulls.extract.standards.ai = { first: { use: 'x' } }
            delete nulls.extract.categoryFallback
            assert.equal(extractResolvedProblem(nulls), '', '預設為 null 之葉(判定小組之席、類別後備)缺之同 null')
            const bad = RS({})
            bad.extract.perRun = '4'
            assert.match(extractResolvedProblem(bad), /^settings\.extract\.perRun 須為/, '錯型別(與解析設定同一判準與字樣)')
            const extra = RS({})
            extra.extract.zzz = 1
            assert.match(extractResolvedProblem(extra), /^settings\.extract 含不認得之鍵：zzz/)
            assert.equal(extractResolvedProblem({}), '提煉需要解析後之 settings.extract（resolveExtractSettings 之產物）')
        })

        it('extractReserveMs:提煉啟用＝minRemainingMs;perRun 0 → 0;minRemainingMs 非非負數或缺 extract 段 → 預設 900000', () => {
            assert.equal(extractReserveMs(RS({})), 900_000)
            assert.equal(extractReserveMs(RS({ extract: { perRun: 0 } })), 0)
            assert.equal(extractReserveMs(RS({ extract: { minRemainingMs: 600_000 } })), 600_000)
            assert.equal(extractReserveMs(RS({ extract: { minRemainingMs: 0 } })), 0)
            assert.equal(extractReserveMs({ extract: { perRun: 2, minRemainingMs: -5 } }), 900_000)
            assert.equal(extractReserveMs({ extract: { perRun: 2, minRemainingMs: 'x' } }), 900_000)
            assert.deepEqual([extractReserveMs({}), extractReserveMs(null)], [900_000, 900_000])
        })

        it('extractPickOf:單一映射(notesPerTarget←notesPerConcept、graceDays←relateGraceDays、catchup←catchupBatches 至少 1、類別後備之物件或 null)', () => {
            assert.deepEqual(extractPickOf(RS({})), { minNotes: 6, minPending: 4, maxWaitDays: 30, notesPerTarget: 12, graceDays: 3, catchup: 3, categoryFallback: null })
            const s = RS({ extract: { minNotes: 2, minPending: 1, maxWaitDays: 0, notesPerConcept: 20, relateGraceDays: 1.5, catchupBatches: 1, categoryFallback: { minNotes: 3, minGain: 2 } } })
            const p = extractPickOf(s)
            assert.deepEqual(p, { minNotes: 2, minPending: 1, maxWaitDays: 0, notesPerTarget: 20, graceDays: 1.5, catchup: 1, categoryFallback: { minNotes: 3, minGain: 2 } })
            assert.notEqual(p.categoryFallback, s.extract.categoryFallback, '類別後備為複本')
            assert.equal(extractPickOf(RS({ extract: { categoryFallback: false } })).categoryFallback, null, 'false＝停用')
            assert.equal(extractPickOf({ extract: { ...EXPECTED, catchupBatches: 0 } }).catchup, 1, '至少 1')
            for (const bad of [{}, null, { extract: 'x' }]) assert.equal(msgOf(() => extractPickOf(bad)), 'extractPickOf 須給已解析之設定（含 extract 段）')
        })
    })

    describe('⑧ 實例互不汙染', function() {

        it('就地修改某次解析之設定,不影響下次解析與預設常數(含抓取套件之 ai 段預設)', () => {
            const a = RS({})
            a.extract.ai.drafters[0].fallback.push('x:y')
            a.extract.standards.ai.first = { use: 'x:y' }
            a.extract.recheck.slots = 99
            a.ai.providerTimeouts['x:y'] = 1
            const b = RS({})
            assert.deepEqual(b.extract, EXPECTED)
            assert.deepEqual(b.ai.providerTimeouts, {})
            assert.deepEqual(EXTRACT_DEFAULT.ai.drafters[0].fallback, [PICKLE])
            assert.deepEqual([EXTRACT_AI_DEFAULT.providerTimeouts, AI_DEFAULT.providerTimeouts], [{}, {}])
        })
    })
})
