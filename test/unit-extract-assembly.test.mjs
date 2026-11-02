// unit-extract-assembly.test.mjs — 總組裝 createKnowledgeExtract 與執行期件 createExtractRuntime 之嚴格性與接線
// 規則(出自 createKnowledgeExtract 與 extractRuntime 檔頭):
//   ①設定錯誤一律啟動期拋錯,不靜默沿用預設:cfg 之未知鍵、各鍵之形狀、設定兩段(ai／extract)、資料、提示詞、domain、子階段之錨點、
//     啟用之檢定標準所需之判定小組席位與 domain 成員、AI 調度層之工作流入口、AI 席位皆於建構期驗;訊息點名錯誤之鍵並列可用鍵;CFG_KEYS 與實際讀取者一致
//   ②形狀錯誤之訊息不被席位檢核搶先;給了卻無效之執行期數值鍵(排程上限、時間預算、鎖陳舊期限)視同未給並以啟動期警告指名
//   ③生效之 domain 只有一份:cfg.prompts 覆寫內建者之提示詞、cfg.domains 整組置換(兩者同給即拋);每輪 deps.domains 即 info().domains;
//     他總組裝以 createExtractRuntime 取同一組件(opt.vocab／opt.prompts／opt.domains／opt.relateDomain,不認得之鍵即拋;不讀 cfg.domains,不檢 AI 調度層)
//   ④選開之集合(holds、checks、docs);本機網路判斷為選用(cfg.netGuard 給判斷器才交調度層,斷網時整鏈皆敗之 pass 記截止、不記 tries)
//   ⑤零設定(僅 workDir＋AI 替身)即可跑一輪:核心 md 與狀態檔落 <workDir>/knowledge/core、日誌與執行摘要落 <workDir>/log
//   ⑥AI 調度層:建構選項開條目固有之 prompt 長度預篩與工作流入口(getWkf／seatSpec／recordCall)、不開失敗預覽與截斷放行;席位檢核取 extractSeatsOf;
//     判定小組同家警告;調度層事件(健康／額度／能力)寫入當輪日誌(注入調度層者不接)
//   ⑦每輪依賴只放可列舉之普通屬性;info() 之共同欄;符合度掃描(extract.standards.scanEachRun)之計數＝同庫直接掃描之值
// 執行:自套件根 node <mocha> test/unit-extract-assembly.test.mjs(暫存 test/_tmp/extract-assembly-<pid>,測完即刪;真 LMDB、AI 為替身或
//   指向無人監聽之埠 8881,不連外網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import WOrmLmdb from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import { createKnowledgeExtract, CFG_KEYS, DATA_KEYS, PROMPT_KEYS, COLLECTION_KEYS } from '../src/createKnowledgeExtract.mjs'
import {
    createExtractRuntime, resolveExtractData, resolveExtractDirs, EXTRACT_STORE_KEYS, EXTRACT_DATA_KEYS, EXTRACT_DIRS, EXTRACT_DOMAIN_KEYS, EXTRACT_PROMPT_SIGS,
} from '../src/extractRuntime.mjs'
import { EXTRACT_TAP_STAGE_KEYS } from '../src/extractObject.mjs'
import { resolveExtractSettings, extractSeatsOf } from '../src/core/extractSettings.mjs'
import { pickExtractVocab } from '../src/core/vocab/extractVocab.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { renderRules } from '../src/stores/stateDigest.mjs'
import { auditExtractStandards, extractScanOf } from '../src/standards/audit.mjs'
import { standardsCountsOf } from '../src/core/capturePackage.mjs'
import { stdReport, normalizeConcept, defineMw, resolveDirsCfg } from '../src/core/capturePackage.mjs'
import { conceptFoldsOf, RUNTIME_CFG_KEYS, lexSource, msgOf, FIXED_CLOCK } from './tools/captureForTest.mjs'
import { readMd } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/core/relatePackage.mjs'
import { recLog, scriptAi, draftAll, SEATS, ledgerOf, noAi } from './tools/extractKit.mjs'
import { promptArgsOf, PROMPT_MEMBERS } from './tools/promptInputs.mjs'
import {
    PKG_ROOT, DEAD_PORT, silentLog, TEST_EXTRACT, logsOf, tmpRoot, removeRoots, resetConceptFold, landNote, buildTestExtractor, withStores, seedNotes, subReport, findFiles, readJsonFile,
} from './tools/extractTestKit.mjs'

const MIN = 60_000
const DEAD_BASE = `http://127.0.0.1:${DEAD_PORT}/v1` // 無人監聽:連線即被拒
/** 判定小組兩席(不同供應者) */
const PANEL = { first: { use: 'stub:f1' }, second: { use: 'stub:f2' } }

/**
 * 從錯誤訊息「（可用：a、b、c）」取出系統自己列出之可用鍵(鍵集由系統推導,不手列)
 *
 * @param {Function} fn 輸入會拋含「可用：」訊息之函數
 * @returns {Array} 回傳可用鍵陣列
 */
const availableKeysOf = (fn) => {
    let m = ''
    try {
        fn()
    }
    catch (e) {
        m = String(e.message)
    }
    const hit = /（可用：([^）]+)）/.exec(m)
    assert.ok(hit, `訊息須列出可用鍵:${m}`)
    return hit[1].split('、')
}

// ── cfg 逐鍵之錯值(皆須拋錯並點名該鍵)、寬容鍵(無效值僅警告)、有效值(須被接受) ──
const MORE_WRONG = (extra) => ['x', 5, [], ...extra]
const STRICT = {
    workDir: { wrong: [5, '', {}, [], null], name: /需要 workDir/, valid: ['C:/x/y'] },
    name: { wrong: [5, '', {}, [], true, false], name: /cfg\.name 須為非空字串/, valid: ['自訂管線名'] },
    dirs: { wrong: MORE_WRONG([{ zzz: 'a' }, { db: 5 }, { core: '' }, { coreState: 5 }, { coreState: '' }, { coreState: undefined }]), name: /cfg\.dirs/, valid: [{}, { core: 'D:/vault/core' }, { coreState: 'D:/vault/state' }] },
    timeZone: { wrong: [5, '', {}, 'Nowhere/City'], name: /cfg\.timeZone/, valid: ['UTC', 'Asia/Taipei'] },
    clock: { wrong: [{}, 'x', 5], name: /cfg\.clock/, valid: [FIXED_CLOCK] },
    lang: { wrong: [5, '', {}, [], true, '!!', 'zh_TW'], name: /cfg\.lang/, valid: ['zh-TW', 'en', 'ja'] },
    data: { wrong: MORE_WRONG([{ zzz: 1 }, { vocab: 5 }, { vocab: 'x' }, { seedSources: [] }]), name: /cfg\.data/, valid: [{}, { vocab: { domain: '天文學' } }] },
    prompts: { wrong: MORE_WRONG([{ zzz: 1 }, { propose: 'x' }, { relate: () => 'p' }]), name: /cfg\.prompts/, valid: [{}, { propose: () => 'p' }] },
    domains: { wrong: MORE_WRONG([{ zzz: {} }, { extract: 5 }, { extract: {} }, { relate: {} }]), name: /cfg\.domains/, valid: [{}, { extract: createExtractDomain({}) }] },
    conceptFold: { wrong: ['x', 5, {}], name: /cfg\.conceptFold/, valid: [true, false, (t) => t] },
    ai: { wrong: MORE_WRONG([{ zzz: 1 }, { parallel: 2 }, { timeoutMs: 0 }, { providerPick: [] }]), name: /settings\.ai/, valid: [{}, { healthStreak: 0 }] },
    extract: { wrong: MORE_WRONG([{ zzz: 1 }, { perRun: 'x' }, { ai: { drafters: [] } }, { standards: { disputeCheck: { enabled: 'x' } } }]), name: /settings\.extract/, valid: [{}, { perRun: 1 }] },
    scheduleLimitMin: { warn: ['abc', -1, 0, {}, [], true], valid: [55, '65'] },
    deadlineMs: { warn: ['abc', -1, 0, {}, [], true], valid: [600_000] },
    lockStaleMs: { warn: ['abc', -1, 0, {}, [], true], valid: [3_600_000] },
    lock: { wrong: [5, {}, []], name: /cfg\.lock/, valid: [false, true, 'x/run.lock'] },
    envFile: { wrong: [5, {}, [], true], name: /cfg\.envFile/, valid: ['sec/.env'] },
    aiWorkspace: { wrong: [5, {}, [], true], name: /cfg\.aiWorkspace/, valid: ['x/ws'] },
    aiAdapter: { wrong: [{}, 5, 'x', [], false, 0, { callJson: async () => ({}) }, { getWkf: () => ({}), seatSpec: () => null }], name: /cfg\.aiAdapter/, valid: [noAi] },
    // 內建調度層之建構選項(抓取套件 buildAiAdapter 驗鍵集;注入 aiAdapter 時亦驗)
    aiOptions: { wrong: ['x', 5, [], true, { zzz: 1 }], name: /cfg\.aiOptions/, valid: [{}, { exes: {} }] },
    stages: { wrong: [[], 'x', 5, {}, [{ name: 'a' }]], name: /cfg\.stages/, valid: [[{ name: 'a', run: async () => ({}) }]] },
    stageOpts: { wrong: MORE_WRONG([{ zzz: {} }, { extract: 5 }, { extract: 'x' }]), name: /cfg\.stageOpts/, valid: [{}, { extract: {} }, { extract: { tap: {} } }] },
    lmdb: { wrong: MORE_WRONG([{ zzz: 1 }, { WOrm: {} }, { path: '' }, { db: 5 }, { cls: 'x' }]), name: /cfg\.lmdb/, valid: [{}, { db: 'other' }] },
    docs: { wrong: [5, {}, [], 0], name: /cfg\.docs/, valid: [true, false, 'myDocs'] },
    logFactory: { wrong: [5, 'x', {}, [], 0, false], name: /cfg\.logFactory/, valid: [() => recLog()] },
    afterRun: { wrong: [5, true, 'x', {}, [], 0], name: /cfg\.afterRun/, valid: [false, () => ({})] },
    netGuard: { wrong: ['x', 5, [], false, 0, true], name: /cfg\.netGuard/, valid: [null, { check: async () => ({ up: true }) }] },
}

/** 全部席位指向同一條目(內建調度層之案):3+3 七席 */
const seatsAll = (use) => ({ drafters: [{ use }, { use }, { use }], integrate: { use }, audit: { use }, revise: { use }, accept: { use } })

describe('unit-extract-assembly', function() {

    this.timeout(120_000)

    let root = ''
    before(() => {
        root = tmpRoot('extract-assembly')
    })
    after(() => {
        resetConceptFold() // 概念折疊為模組級單例,不留給同 worker 之他檔
        removeRoots([root])
    })

    let seq = 0
    const dirOf = (name = 'c') => `${root}/${name}-${++seq}`
    // 預設組裝:不應被呼叫之替身、不上鎖、靜音日誌;extra 逐鍵覆寫
    const build = (extra = {}) => createKnowledgeExtract({ workDir: dirOf(), aiAdapter: noAi, lock: false, logFactory: () => silentLog, ...extra })
    /** n 篇同一概念之筆記(摘要套件之組裝;已關聯) */
    const notesOf = (wd, n, concept = '視差量測') => Array.from({ length: n }, (_, i) => landNote(`${wd}/knowledge/notes`, { doc: `d${i + 1}`, title: `視差筆記${i + 1}`, concepts: [concept] }))

    // ══════════════════════════ ① cfg 逐鍵嚴格性 ══════════════════════════
    describe('cfg 逐鍵嚴格性(CFG_KEYS 全部鍵 × 錯值／寬容／有效值)', function() {

        it('案例表之鍵集等於 CFG_KEYS(新增 cfg 鍵而未補嚴格性案例即失敗);每個鍵至少有錯值或寬容案例與有效值案例', () => {
            assert.deepEqual(Object.keys(STRICT).sort(), [...CFG_KEYS].sort())
            for (const [k, s] of Object.entries(STRICT)) {
                assert.ok((s.wrong?.length || 0) + (s.warn?.length || 0) > 0, `${k} 缺錯值案例`)
                assert.ok(s.valid?.length > 0, `${k} 缺有效值案例`)
            }
        })

        for (const key of CFG_KEYS) {
            it(`${key}:${STRICT[key]?.wrong ? '錯值一律拋錯並點名該鍵' : '無效值視同未給並以啟動期警告指名(不拋)'};有效值被接受`, () => {
                const s = STRICT[key]
                for (const bad of s.wrong || []) {
                    const m = msgOf(() => build({ [key]: bad }))
                    assert.notEqual(m, null, `${key}=${JSON.stringify(bad)} 應於建構期拋錯(不得靜默接受)`)
                    assert.match(m, s.name, `${key}=${JSON.stringify(bad)}:${m}`)
                }
                for (const bad of s.warn || []) {
                    const flow = build({ [key]: bad })
                    assert.ok(flow.info().startupWarnings.some((w) => w.startsWith(`cfg.${key} 無效（收到 `) && w.endsWith('視同未給')), `${key}=${JSON.stringify(bad)} 應有指名警告:${flow.info().startupWarnings.join('｜')}`)
                }
                for (const ok of s.valid) {
                    assert.doesNotThrow(() => build({ [key]: ok }), `${key}=${typeof ok} 為有效值`)
                }
            })
        }

        it('cfg 非物件視為 {} 後由 workDir 檢查拋錯;不認得之鍵拋錯並列出全部可用鍵(即 CFG_KEYS);近似拼寫與他工作之鍵亦不接受', () => {
            for (const bad of [null, undefined, 5, 'x', []]) assert.throws(() => createKnowledgeExtract(bad), /createKnowledgeExtract 需要 workDir/)
            assert.equal(msgOf(() => build({ aiAdapte: noAi })), `cfg 含不認得之鍵：aiAdapte（可用：${CFG_KEYS.join('、')}）`)
            assert.deepEqual(availableKeysOf(() => build({ zzz: 1 })), [...CFG_KEYS])
            for (const k of ['summarize', 'capture', 'relate', 'relationIndexTitle', 'cores', 'reserveMs', 'monitor']) assert.match(msgOf(() => build({ [k]: {} })), new RegExp(`cfg 含不認得之鍵：${k}`), k)
        })

        it('CFG_KEYS 與實際讀取者一致:本套件之讀取者(總組裝、執行期件、設定解析)所讀之 cfg 鍵＋交抓取套件 resolveRuntime 之鍵(其 runtimeCfgOf 逐鍵讀出 RUNTIME_CFG_KEYS)恰為 CFG_KEYS(以去註解與字串之骨架比對)', () => {
            const readers = ['createKnowledgeExtract.mjs', 'extractRuntime.mjs', 'core/extractSettings.mjs']
            const read = new Set()
            for (const f of readers) {
                for (const m of lexSource(fs.readFileSync(`${PKG_ROOT}/src/${f}`, 'utf8')).skeleton.matchAll(/\bcfg\??\.([A-Za-z_]\w*)/g)) read.add(m[1])
            }
            // 交抓取套件之執行期解析只收逐鍵讀出之值(抓取套件之 runtimeCfgOf):未列於 RUNTIME_CFG_KEYS 之 cfg 鍵影響不到時間預算與路徑;設定解析只交 ai、extract 兩段
            const src = lexSource(fs.readFileSync(`${PKG_ROOT}/src/createKnowledgeExtract.mjs`, 'utf8')).skeleton
            assert.match(src, /resolveRuntime\(runtimeCfgOf\(cfg\)/)
            assert.doesNotMatch(src, /resolveRuntime\(cfg\b/)
            assert.match(src, /resolveExtractSettings\(\{ ai: cfg\.ai, extract: cfg\.extract \}\)/)
            for (const k of RUNTIME_CFG_KEYS) read.add(k)
            assert.deepEqual([...read].filter((k) => !CFG_KEYS.includes(k)).sort(), [], '程式讀取之 cfg 鍵須皆列入 CFG_KEYS')
            assert.deepEqual(CFG_KEYS.filter((k) => !read.has(k)).sort(), [], 'CFG_KEYS 內不得有無人讀取之鍵')
        })
    })

    // ══════════════════════════ cfg 子鍵 ══════════════════════════
    describe('cfg 子鍵嚴格性(鍵集取自系統自己列出之可用鍵)', function() {

        it('cfg.data:只認 vocab(DATA_KEYS＝EXTRACT_DATA_KEYS);詞彙之未知鍵拋錯(他段之詞彙表須以 pickExtractVocab 取子集);info().data.vocab 為原給、info().vocab 為已解析', () => {
            assert.equal(DATA_KEYS, EXTRACT_DATA_KEYS)
            assert.deepEqual(availableKeysOf(() => build({ data: { zzz: 1 } })), ['vocab'])
            for (const bad of [5, 'x', [], false, 0]) assert.throws(() => build({ data: { vocab: bad } }), /cfg\.data\.vocab 須為物件/, `vocab=${JSON.stringify(bad)}`)
            assert.throws(() => build({ data: { vocab: { kbLable: 'x' } } }), /vocab 含不認得之鍵：kbLable/)
            const shared = { domain: '天文學', categoryHints: {}, basisCaps: { 觀測: '中' }, guide: { triage: { scopeLine: '天文' }, extract: { ruleTarget: '觀測之規則' } } }
            assert.throws(() => build({ data: { vocab: shared } }), /vocab 含不認得之鍵：categoryHints/)
            const info = build({ data: { vocab: pickExtractVocab(shared) } }).info()
            assert.deepEqual([info.vocab.domain, info.vocab.basisCaps.觀測, info.vocab.guide.extract.ruleTarget], ['天文學', '中', '觀測之規則'])
            assert.deepEqual(info.data, { vocab: pickExtractVocab(shared) }, 'data.vocab 為安裝方原給之覆寫')
            assert.deepEqual(resolveExtractData(undefined), { vocab: null })
            assert.throws(() => resolveExtractData('x'), /cfg\.data 須為物件 \{ vocab \}/)
        })

        it('cfg.prompts:PROMPT_KEYS＝EXTRACT_PROMPT_SIGS 之 17 鍵;各鍵給非函數即拋(訊息帶其函數形式「(參數) => 回傳」——與 domain 工廠同一字樣);函數被內建 domain 採用(收原參數＋ctx,含 defaultPrompt)', () => {
            assert.deepEqual([...PROMPT_KEYS], Object.keys(EXTRACT_PROMPT_SIGS))
            assert.equal(PROMPT_KEYS.length, 17)
            assert.deepEqual(availableKeysOf(() => build({ prompts: { zzz: 1 } })), [...PROMPT_KEYS])
            for (const k of PROMPT_KEYS) {
                const { params, returns = '提示詞字串' } = EXTRACT_PROMPT_SIGS[k]
                for (const bad of [5, 'x', {}, [], false, 0]) assert.equal(msgOf(() => build({ prompts: { [k]: bad } })), `cfg.prompts.${k} 須為函數 ${params} => ${returns}`, `prompts.${k}=${JSON.stringify(bad)}`)
            }
            // 回傳字串之鍵(13 支提示詞與終審附錄):覆寫者被內建 domain 採用;ctx 帶 defaultPrompt(內建之提示詞)
            const TEXT = Object.keys(PROMPT_MEMBERS).filter((k) => !['rules', 'withdrawnRule', 'recheckText'].includes(k))
            const seen = {}
            const wrap = (k) => (...args) => {
                const ctx = args[args.length - 1]
                seen[k] = typeof ctx.defaultPrompt === 'function' && String(ctx.defaultPrompt(...args.slice(0, -1))).length >= 0
                return `${k}｜覆寫`
            }
            const d = build({ data: { vocab: { domain: '天文學' } }, prompts: Object.fromEntries(TEXT.map((k) => [k, wrap(k)])) }).info().domains.extract
            const args = promptArgsOf(renderRules(d.rules), d.kb)
            for (const k of TEXT) assert.equal(d[PROMPT_MEMBERS[k]](...args[k]), `${k}｜覆寫`, k)
            assert.deepEqual(Object.keys(seen).sort(), [...TEXT].sort())
            assert.ok(Object.values(seen).every(Boolean), 'ctx 帶 defaultPrompt')
            // 規則表:覆寫者收內建規則表之複本,回傳之規則表即生效之一份
            const rules = build({ prompts: { rules: (dflt) => [...dflt, { id: 'myRule', priority: 99, text: '自訂之規則' }] } }).info().domains.extract.rules
            assert.equal(rules.at(-1).id, 'myRule')
        })

        it('cfg.domains:可用鍵 extract;注入者原樣生效(info().domains.extract 即之);非物件、缺恆必填成員(抓取套件之 mergeDomains,同摘要／關聯之字樣)、資料成員不合(claimKinds 不可覆寫)皆拋;選填成員(本質、同義提議、依出處收斂)可缺', () => {
            assert.deepEqual(availableKeysOf(() => build({ domains: { zzz: {} } })), [...EXTRACT_DOMAIN_KEYS])
            assert.equal(msgOf(() => build({ domains: 'x' })), 'cfg.domains 須為物件 { extract? }')
            assert.equal(msgOf(() => build({ domains: { extract: 5 } })), 'cfg.domains.extract 須為 domain 物件')
            const full = createExtractDomain({})
            const { buildProposePrompt: _p, ...noPropose } = full
            assert.equal(msgOf(() => build({ domains: { extract: noPropose } })), 'cfg.domains.extract 缺成員「buildProposePrompt」（須具備內建 domain 之全部成員；建議以 createExtractDomain({ vocab }) 之產物展開後覆寫）')
            assert.equal(msgOf(() => build({ domains: { extract: { ...full, renderState: 'x' } } })), 'cfg.domains.extract 缺成員「renderState」（須具備內建 domain 之全部成員；建議以 createExtractDomain({ vocab }) 之產物展開後覆寫）', '恆必填之函數成員非函數視同缺')
            assert.equal(msgOf(() => build({ domains: { extract: { ...full, buildEssencePrompt: 1 } } })), 'cfg.domains.extract 不合：buildEssencePrompt 須為函數（建議以 createExtractDomain({ vocab }) 之產物展開後覆寫）', '選填成員給了亦須為函數(成員表之形狀)')
            assert.match(msgOf(() => build({ domains: { extract: { ...full, claimKinds: ['rule'] } } })), /^cfg\.domains\.extract 不合：claimKinds 須為內建之主張種類（principle、rule、pitfall、temporal）——不可覆寫/)
            assert.match(msgOf(() => build({ domains: { extract: { ...full, limits: { claim: 0 } } } })), /^cfg\.domains\.extract 不合：limits 須為物件且各值為正數/)
            const { buildEssencePrompt: _e, buildSynonymProposePrompt: _s, buildSupportRevisePrompt: _r, ...minimal } = full
            const flow = build({ domains: { extract: minimal } })
            assert.equal(flow.info().domains.extract, minimal, '注入者原樣生效')
        })

        it('啟用之檢定標準缺判定小組席位或 domain 成員 → 建構期拋錯(不等到該段第一次執行;字樣與提煉段之執行期同一份)', () => {
            const full = createExtractDomain({})
            const std = (s) => ({ standards: { ai: PANEL, ...s } })
            assert.equal(msgOf(() => build({ extract: { standards: { disputeCheck: { perRun: 1 } } } })), '爭議覆核(extract.standards.disputeCheck.perRun > 0)已啟用,但缺席位 settings.extract.standards.ai.first、settings.extract.standards.ai.second')
            assert.equal(msgOf(() => build({ extract: { standards: { ai: { first: PANEL.first }, supportCheck: { enabled: true }, orphanCheck: { perRun: 1 } } } })), '出處支持覆核(extract.standards.supportCheck.enabled)、失撐主張專責佇列(extract.standards.orphanCheck.perRun > 0)已啟用,但缺席位 settings.extract.standards.ai.second')
            // 依功能而必填之成員與「非對立之界線」只由功能之單一判定(extractFeatureProblems)判,訊息以 cfg.domains.extract 指出注入之 domain
            const { buildDisputeCheckPrompt: _d, ...noDispute } = full
            assert.equal(msgOf(() => build({ domains: { extract: noDispute }, extract: std({ disputeCheck: { perRun: 1 } }) })), '爭議覆核(extract.standards.disputeCheck.perRun > 0)已啟用,但 cfg.domains.extract 缺 buildDisputeCheckPrompt')
            const noBoundary = { ...full, rules: full.rules.filter((r) => r.id !== 'disputeBoundary') }
            assert.equal(msgOf(() => build({ domains: { extract: noBoundary }, extract: std({ disputeCheck: { perRun: 1 } }) })), '爭議覆核(extract.standards.disputeCheck.perRun > 0)已啟用,但 cfg.domains.extract.rules 缺 id「disputeBoundary」之規則（爭議覆核以之為判準）')
            // 功能關閉時缺之不拋;開啟且齊備亦不拋
            assert.doesNotThrow(() => build({ domains: { extract: noDispute } }))
            assert.doesNotThrow(() => build({ extract: std({ supportCheck: { enabled: true }, supportStock: { perRun: 1 }, orphanCheck: { perRun: 1 }, disputeCheck: { perRun: 1 }, synonymCheck: { perRun: 1 } }) }))
        })

        it('cfg.prompts 與 cfg.domains.extract 同給即拋(注入者整組置換內建者,提示詞覆寫會靜默失效)', () => {
            const d = createExtractDomain({})
            for (const k of PROMPT_KEYS) {
                assert.match(msgOf(() => build({ prompts: { [k]: () => 'p' }, domains: { extract: d } })), new RegExp(`^cfg\\.prompts\\.${k} 與 cfg\\.domains\\.extract 擇一`), k)
            }
        })

        it('cfg.dirs:可用鍵即抓取套件之基本目錄＋提煉之 core、coreState;core 預設 <workDir>/knowledge/core 且不隨 knowledge 之覆寫移動;coreState 未給者＝(覆寫後之)core;各鍵給非字串或空字串即拋', () => {
            const keys = availableKeysOf(() => build({ dirs: { zzz: 'a' } }))
            assert.deepEqual(keys, ['db', 'log', 'tmp', 'state', 'knowledge', 'core', 'coreState'])
            assert.deepEqual(keys, [...Object.keys(resolveDirsCfg('c:/x', undefined, EXTRACT_DIRS)), 'coreState'], '可用鍵由展開之目錄推導')
            for (const k of keys) for (const bad of [5, '', {}, [], false, 0, undefined]) assert.throws(() => build({ dirs: { [k]: bad } }), new RegExp(`cfg\\.dirs\\.${k} 須為非空路徑字串`), `dirs.${k}=${JSON.stringify(bad)}`)
            const wd = dirOf('dirs')
            const info = (dirs) => createKnowledgeExtract({ workDir: wd, aiAdapter: noAi, lock: false, ...(dirs ? { dirs } : {}) }).info().dirs
            assert.deepEqual([info().core, info().coreState], [`${wd}/knowledge/core`, `${wd}/knowledge/core`])
            assert.deepEqual([info({ knowledge: 'D:/vault/k' }).core, info({ knowledge: 'D:/vault/k' }).knowledge], [`${wd}/knowledge/core`, 'D:/vault/k'], 'core 不隨 knowledge 之覆寫移動')
            assert.deepEqual([info({ core: 'D:/vault/core' }).core, info({ core: 'D:/vault/core' }).coreState], ['D:/vault/core', 'D:/vault/core'], '只覆寫 core 者狀態檔隨之(狀態與 md 不分家)')
            assert.deepEqual([info({ coreState: 'D:/vault/state' }).core, info({ coreState: 'D:/vault/state' }).coreState], [`${wd}/knowledge/core`, 'D:/vault/state'])
            assert.deepEqual(resolveExtractDirs(wd, undefined), info())
        })

        it('resolveExtractDirs 之 extra(他總組裝交他工作之目錄):與提煉之目錄同一份展開;cfg.dirs 之可用鍵含之、可覆寫之;coreState 之衍生不變;重定提煉或基本目錄即拋;非物件視為{}', () => {
            const wd = 'c:/kb'
            const UP = { notes: 'knowledge/notes', relations: 'knowledge/relations' }
            const d = resolveExtractDirs(wd, undefined, UP)
            assert.deepEqual(Object.keys(d), ['db', 'log', 'tmp', 'state', 'knowledge', 'notes', 'relations', 'core', 'coreState'])
            assert.deepEqual([d.notes, d.relations, d.core, d.coreState], [`${wd}/knowledge/notes`, `${wd}/knowledge/relations`, `${wd}/knowledge/core`, `${wd}/knowledge/core`])
            assert.deepEqual(availableKeysOf(() => resolveExtractDirs(wd, { zzz: 'a' }, UP)), ['db', 'log', 'tmp', 'state', 'knowledge', 'notes', 'relations', 'core', 'coreState'])
            const o = resolveExtractDirs(wd, { notes: 'D:/vault/notes', core: 'D:/vault/core' }, UP)
            assert.deepEqual([o.notes, o.relations, o.core, o.coreState], ['D:/vault/notes', `${wd}/knowledge/relations`, 'D:/vault/core', 'D:/vault/core'])
            assert.throws(() => resolveExtractDirs(wd, { notes: '' }, UP), /cfg\.dirs\.notes 須為非空路徑字串/)
            for (const k of ['core', 'coreState']) assert.equal(msgOf(() => resolveExtractDirs(wd, undefined, { [k]: 'x' })), `resolveExtractDirs 之 extra 不可重定提煉之目錄：${k}`)
            assert.match(msgOf(() => resolveExtractDirs(wd, undefined, { db: 'x' })), /extra 不可重定基本目錄：db/)
            for (const bad of [null, 'x', 5, []]) assert.deepEqual(resolveExtractDirs(wd, undefined, bad), resolveExtractDirs(wd, undefined), JSON.stringify(bad))
        })

        it('cfg.lmdb.cls:可用鍵即 COLLECTION_KEYS(＝EXTRACT_STORE_KEYS);預設集合名即對外名(與他工作共用一庫時不必遷移);有效值逐鍵改集合名', () => {
            assert.equal(COLLECTION_KEYS, EXTRACT_STORE_KEYS)
            assert.deepEqual([...EXTRACT_STORE_KEYS], ['notes', 'cores', 'relations', 'holds', 'checks', 'docs'])
            assert.deepEqual(availableKeysOf(() => build({ lmdb: { cls: { zzz: 'x' } } })), [...COLLECTION_KEYS])
            const dflt = build().info().lmdb
            assert.deepEqual(dflt.cls, Object.fromEntries(COLLECTION_KEYS.map((k) => [k, k])))
            assert.equal(dflt.db, 'knowledge')
            for (const k of COLLECTION_KEYS) assert.equal(build({ lmdb: { cls: { [k]: `my_${k}` } } }).info().lmdb.cls[k], `my_${k}`, k)
        })

        it('cfg.stageOpts:可用鍵即 EXTRACT_TAP_STAGE_KEYS;給非物件即拋;tap 對不存在之錨點即拋、五個錨點皆可掛;cfg.stages 與 cfg.stageOpts 擇一、子階段不得重名', () => {
            assert.deepEqual(availableKeysOf(() => build({ stageOpts: { zzz: {} } })), [...EXTRACT_TAP_STAGE_KEYS])
            const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
            for (const bad of [5, 'x', [], false, 0]) assert.throws(() => build({ stageOpts: { extract: bad } }), /cfg\.stageOpts\.extract 須為物件/)
            assert.throws(() => build({ stageOpts: { extract: { tap: { nope: { after: [a] } } } } }), /鏈\[extract\.extract\] 無錨點「nope」\(可用:loadState\/selectNotes\/pass\/renderState\/persistState\)/)
            for (const anchor of ['loadState', 'selectNotes', 'pass', 'renderState', 'persistState']) assert.doesNotThrow(() => build({ stageOpts: { extract: { tap: { [anchor]: { after: [a] } } } } }), anchor)
            const st = [{ name: 'a', run: async () => stdReport() }]
            assert.throws(() => build({ stages: st, stageOpts: {} }), /cfg\.stages（整組自訂子階段）與 cfg\.stageOpts（內建子階段之 opt）擇一/)
            assert.throws(() => build({ stages: [{ name: 'a', run: () => {} }, { name: 'a', run: () => {} }] }), /cfg\.stages 有重複之子階段名：a/)
        })

        it('設定兩段(ai／extract)之子鍵嚴格性由設定解析承擔:總組裝對各組之錯誤原樣拋出(完整路徑可辨)', () => {
            assert.throws(() => build({ extract: { recheck: { perRn: 1 } } }), /settings\.extract\.recheck 含不認得之鍵：perRn（可用：slots、perRun、guard、waitDays、relationImpact）/)
            assert.throws(() => build({ extract: { notesPerConcept: '6' } }), /settings\.extract\.notesPerConcept 須為正整數/)
            assert.throws(() => build({ extract: { ai: { ...SEATS, integrate: { use: 'x', fallbak: [] } } } }), /settings\.extract\.ai 須為提煉席位.*integrate → .*fallbak/)
            assert.throws(() => build({ ai: { parallel: 2 } }), /settings\.ai 含不認得之鍵：parallel/, '提煉不讀 parallel(每輪之概念數由 extract.perRun 定)')
            assert.throws(() => build({ extract: { standards: { ai: { first: { use: 'x', fallbak: [] } } } } }), /settings\.extract\.standards\.ai\.first/)
        })
    })

    // ══════════════════════════ ② 檢核順序 ══════════════════════════
    describe('檢核順序與跨鍵關係', function() {

        it('形狀錯誤之訊息不被席位檢核搶先:同時有 cfg 形狀錯與無法解析之席位 → 報形狀錯', () => {
            const seatBad = { extract: { ai: { ...resolveExtractSettings({}).extract.ai, integrate: { use: 'oc:opencode/no-such-model-free' } } } }
            assert.match(msgOf(() => createKnowledgeExtract({ workDir: dirOf(), lock: false, ...seatBad })), /^AI 席位於啟動期檢核失敗（1 席）：extract\.ai\.integrate → 席位引用了不可用的條目：oc:opencode\/no-such-model-free/, '前提:單獨之席位錯誤確實拋出')
            for (const [name, extra, re] of [
                ['docs 型別錯', { docs: 5 }, /cfg\.docs 須為/],
                ['stages 與 stageOpts 並給', { stages: [{ name: 'a', run: () => {} }], stageOpts: {} }, /擇一/],
                ['data 形狀錯', { data: 'x' }, /cfg\.data 須為物件/],
                ['domains 缺成員', { domains: { extract: {} } }, /cfg\.domains\.extract 缺成員「/],
                ['logFactory 型別錯', { logFactory: 5 }, /cfg\.logFactory/],
                ['netGuard 型別錯', { netGuard: 'x' }, /cfg\.netGuard/],
                ['lmdb 形狀錯', { lmdb: 'x' }, /cfg\.lmdb/],
                ['lock 型別錯', { lock: 5 }, /cfg\.lock/],
                ['aiAdapter 缺工作流入口', { aiAdapter: { callJson: async () => ({}) } }, /cfg\.aiAdapter 須為具 getWkf\(\)/],
            ]) {
                assert.throws(() => createKnowledgeExtract({ workDir: dirOf(), ...seatBad, ...extra }), re, name)
            }
        })

        it('設定(ai／extract)之錯誤先於其他 cfg 鍵之形狀錯(同時錯時先報 settings)', () => {
            assert.throws(() => build({ data: 'x', extract: 'x' }), /settings\.extract 須為物件/)
        })

        it('概念折疊接線(與抓取套件同一單例):未給用內建繁簡折疊;false 明確清除先前實例注入之折疊;函數即自訂;詞彙表之概念別名一併生效', () => {
            build()
            assert.equal(normalizeConcept('視差'), normalizeConcept('视差'))
            build({ conceptFold: false })
            assert.notEqual(normalizeConcept('視差'), normalizeConcept('视差'), 'false 須明確清除')
            build({ conceptFold: (t) => t.toUpperCase() })
            assert.equal(normalizeConcept('abc'), 'ABC')
            build({ data: { vocab: { conceptAliases: { 星系: '銀河' } } } })
            assert.equal(normalizeConcept('星系'), normalizeConcept('銀河'))
        })
    })

    // ══════════════════════════ ③ 執行期件 ══════════════════════════
    describe('createExtractRuntime(總組裝共用之提煉執行期件)', function() {

        const S0 = resolveExtractSettings({})

        it('回傳之件:資料(原給)、已解析之詞彙、折疊、生效之 domain(extract 與關聯之 relate)、警告;settings 不含 extract 即拋;domain 之成員與內建工廠之產物同一組', () => {
            const rt = createExtractRuntime({ data: { vocab: { domain: '天文學' } } }, S0)
            assert.deepEqual(Object.keys(rt).sort(), ['data', 'domains', 'folds', 'locale', 'vocab', 'warnings'])
            assert.deepEqual(Object.keys(rt.domains), [...EXTRACT_DOMAIN_KEYS, 'relate'])
            assert.deepEqual([rt.vocab.domain, rt.data.vocab, rt.warnings], ['天文學', { domain: '天文學' }, []])
            assert.deepEqual(Object.keys(rt.domains.extract), Object.keys(createExtractDomain({})), 'domain 之成員同內建工廠之產物')
            assert.deepEqual(Object.keys(rt.domains.relate), Object.keys(createRelateDomain({})), '關聯 domain 以關聯套件之工廠自建')
            assert.deepEqual(Object.keys(rt.folds), Object.keys(conceptFoldsOf(undefined)), '折疊與抓取套件之 conceptFoldsOf 同形')
            assert.equal(rt.domains.extract.kb, '「天文學」知識庫')
            assert.throws(() => createExtractRuntime({}, {}), /需要解析後之 settings\(含 extract\)/)
            assert.throws(() => createExtractRuntime({}, { ai: S0.ai }), /需要解析後之 settings/)
        })

        it('opt.vocab(他總組裝交之子集)優先於 cfg.data.vocab;opt.prompts 之鍵即 EXTRACT_PROMPT_SIGS(不認得之鍵拋);opt.relateDomain 給了即用(缺成員即拋)', () => {
            const rt = createExtractRuntime({ data: { vocab: { domain: '天文學' } } }, S0, { vocab: { domain: '地質學' } })
            assert.equal(rt.vocab.domain, '地質學')
            assert.equal(msgOf(() => createExtractRuntime({}, S0, { prompts: { area: () => 'p' } })), `createExtractRuntime 之 opt.prompts 含不認得之鍵：area（可用：${Object.keys(EXTRACT_PROMPT_SIGS).join('、')}）`)
            const rd = createRelateDomain({ vocab: { domain: '海洋學' } })
            assert.equal(createExtractRuntime({}, S0, { relateDomain: rd }).domains.relate, rd)
            assert.equal(msgOf(() => createExtractRuntime({}, S0, { relateDomain: {} })), 'createExtractRuntime 之 opt.relateDomain 缺 conflictType、conflictTypeNames、resolveType（提煉之衝突重審、衝突之去向與關聯變更之影響依之判定）')
        })

        it('domain 之注入只經 opt.domains(不讀 cfg.domains):cfg.domains 含他工作之鍵亦不拋;opt.domains 給 {} 用內建;給他工作之鍵即拋;整份詞彙須先以 pickExtractVocab 取子集', () => {
            const cfg = { domains: { triage: {}, summarize: {}, relate: {}, extract: 'x' } }
            assert.doesNotThrow(() => createExtractRuntime(cfg, S0))
            assert.equal(typeof createExtractRuntime(cfg, S0, { domains: {} }).domains.extract.buildProposePrompt, 'function')
            assert.equal(msgOf(() => createExtractRuntime({}, S0, { domains: { relate: {} } })), 'cfg.domains 含不認得之鍵：relate（可用：extract）')
            const injected = createExtractDomain({ vocab: { domain: '海洋學' } })
            assert.equal(createExtractRuntime(cfg, S0, { domains: { extract: injected } }).domains.extract, injected)
            const whole = { domain: '天文學', categoryHints: {}, guide: { triage: {}, extract: { ruleTarget: '觀測之規則' } } }
            assert.throws(() => createExtractRuntime({}, S0, { vocab: whole }), /vocab 含不認得之鍵：categoryHints/)
            assert.equal(createExtractRuntime({}, S0, { vocab: pickExtractVocab(whole) }).vocab.guide.extract.ruleTarget, '觀測之規則')
        })

        it('警告:只有詞彙之警告(自訂內容類型而未給證據封頂);判定小組同家之警告在 settings.warnings(呼叫端併入,本函數不重報)', () => {
            assert.deepEqual(createExtractRuntime({ data: { vocab: { claimTypes: ['甲型', '乙型'] } } }, S0).warnings.length, 1)
            assert.match(createExtractRuntime({ data: { vocab: { claimTypes: ['甲型', '乙型'] } } }, S0).warnings[0], /^vocab\.claimTypes 已自訂而未給 vocab\.evidenceCaps/)
            const same = resolveExtractSettings({ extract: { standards: { ai: { first: { use: 'stub:x' }, second: { use: 'stub:x' } }, disputeCheck: { perRun: 1 } } } })
            assert.equal(same.warnings.length, 1, '前提:判定小組同家之警告在 settings.warnings')
            assert.deepEqual(createExtractRuntime({}, same).warnings, [], '判定小組之警告由呼叫端併入,本函數不重報')
        })

        it('opt 之鍵集:限 vocab、prompts、domains、relateDomain——已刪之 opt.inflow(容量警告改由 extractWarningsOf 取)與打錯之鍵即拋「不認得之鍵」', () => {
            // 規則:extractRuntime 之 RUNTIME_OPT_KEYS(終審 D12:opt.inflow 刪除;給了不靜默略過)
            assert.equal(msgOf(() => createExtractRuntime({}, S0, { inflow: { max: 999, desc: '上游上界' } })), 'createExtractRuntime 之 opt 含不認得之鍵：inflow（可用：vocab、prompts、domains、relateDomain）')
            assert.equal(msgOf(() => createExtractRuntime({}, S0, { vocabs: {} })), 'createExtractRuntime 之 opt 含不認得之鍵：vocabs（可用：vocab、prompts、domains、relateDomain）')
            assert.doesNotThrow(() => createExtractRuntime({}, S0, { vocab: undefined, prompts: undefined, domains: undefined, relateDomain: undefined }))
        })

        it('不檢 AI 調度層與網路判斷(他總組裝或測試可給無工作流入口之替身):cfg.aiAdapter／cfg.netGuard 為任意值亦不拋', () => {
            const rt = createExtractRuntime({ aiAdapter: 'x', netGuard: 5 }, S0)
            assert.deepEqual(Object.keys(rt).sort(), ['data', 'domains', 'folds', 'locale', 'vocab', 'warnings'])
        })
    })

    // ══════════════════════════ info() ══════════════════════════
    describe('info():生效值單一來源', function() {

        it('預設:鍵序(共同欄)、目錄(含 core、coreState)、集合(必開五者)、鎖與金鑰檔路徑皆自 workDir 展開;注入調度層時無 AI 工作區;未給排程上限即預設預算並於啟動期警告;詞彙為預設', () => {
            const wd = dirOf('info')
            const info = createKnowledgeExtract({ workDir: wd, aiAdapter: noAi }).info()
            assert.deepEqual(Object.keys(info), ['dirs', 'settings', 'clock', 'ai', 'domains', 'locale', 'lmdb', 'data', 'vocab', 'deadlineMs', 'lockStaleMs', 'startupWarnings', 'scheduleLimitMin', 'envFile', 'aiWorkspace', 'lockFile', 'collections'])
            assert.deepEqual(info.dirs, resolveExtractDirs(wd, undefined))
            assert.deepEqual(info.collections, ['notes', 'cores', 'relations', 'holds', 'checks'])
            assert.equal(info.lockFile, path.resolve(`${wd}/tmp/run.lock`))
            assert.equal(info.envFile, path.resolve(`${wd}/.env`))
            assert.equal(info.aiWorkspace, null)
            assert.deepEqual([info.scheduleLimitMin, info.deadlineMs, info.lockStaleMs], [null, 50 * MIN, 60 * MIN])
            assert.equal(info.startupWarnings.length, 1)
            assert.match(info.startupWarnings[0], /^未給 scheduleLimitMin 亦未給 deadlineMs/)
            assert.deepEqual(info.data, { vocab: null })
            assert.deepEqual([info.vocab.domain, info.domains.extract.kb], ['', '知識庫'])
            assert.deepEqual(Object.keys(info.domains), ['extract', 'relate'])
            assert.deepEqual(Object.keys(info.settings), ['ai', 'extract', 'capacity', 'warnings'])
            assert.equal(info.ai, noAi)
        })

        it('執行期:排程上限推導預算與鎖陳舊期限;明給者優先;envFile 相對者以 workDir 為基準;lock 字串即鎖檔路徑、false 即無鎖;時鐘原樣採用或依時區建立', () => {
            const a = build({ scheduleLimitMin: 55 }).info()
            assert.deepEqual([a.scheduleLimitMin, a.deadlineMs, a.lockStaleMs, a.startupWarnings], [55, 49 * MIN, 60 * MIN, []])
            assert.equal(build({ deadlineMs: 20 * MIN }).info().deadlineMs, 20 * MIN)
            const wd = dirOf('paths')
            const rel = createKnowledgeExtract({ workDir: `${wd.replace(/\//g, '\\')}\\`, aiAdapter: noAi, envFile: 'sec/.env', lock: `${wd}/x/my.lock` }).info()
            assert.deepEqual([rel.dirs.db, rel.envFile, rel.lockFile], [`${wd}/db`, path.resolve(`${wd}/sec/.env`), path.resolve(`${wd}/x/my.lock`)])
            assert.equal(build({ lock: false }).info().lockFile, null)
            assert.equal(build({ clock: FIXED_CLOCK }).info().clock, FIXED_CLOCK)
            assert.match(build({ timeZone: 'UTC' }).info().clock.iso8(), /\+00:00$/)
        })

        it('集合:notes、cores、relations、holds、checks 必開(判不了者須有處登錄、已檢者須有處記錄;cfg 無 holds／checks 鍵);docs 選開——預設不開;true 或集合名才開(附於必開五者之後);集合名與 lmdb.cls 不一致即拋;只給 lmdb.cls 不開', () => {
            assert.deepEqual(build().info().collections, ['notes', 'cores', 'relations', 'holds', 'checks'])
            assert.deepEqual(build({ docs: true }).info().collections, ['notes', 'cores', 'relations', 'holds', 'checks', 'docs'])
            assert.equal(build({ docs: 'myDocs' }).info().lmdb.cls.docs, 'myDocs')
            assert.equal(build({ lmdb: { cls: { holds: 'myHolds' } } }).info().lmdb.cls.holds, 'myHolds', '必開集合之集合名仍可由 lmdb.cls 覆寫')
            assert.equal(msgOf(() => build({ docs: 'a', lmdb: { cls: { docs: 'b' } } })), 'cfg.docs（a）與 cfg.lmdb.cls.docs（b）不一致：文件集合名擇一給')
            assert.equal(build({ lmdb: { cls: { docs: 'd' } } }).info().collections.includes('docs'), false, '只給集合名而未開 docs 仍不開')
            for (const k of ['holds', 'checks']) assert.match(msgOf(() => build({ [k]: true })), new RegExp(`cfg[^\\n]*${k}`), `${k} 已非 cfg 之鍵（不認得之鍵即拋）`)
        })
    })

    // ══════════════════════════ 每輪依賴與執行 ══════════════════════════
    describe('每輪依賴(deps)與一輪執行', function() {

        it('deps 契約:{ stores, clock, dirs, data, vocab, settings, ai, domains } 皆為可列舉之普通屬性;同一輪各子階段取得同一份;deps 之各件即 info() 之同一物件;stores 為開啟之集合', async () => {
            const sink = []
            const probe = (name) => ({ name, run: async (ctx) => {
                sink.push(ctx.deps)
                return stdReport()
            } })
            let viaAfter = null
            const flow = build({ stages: [probe('p1'), probe('p2')], afterRun: ({ deps }) => {
                viaAfter = deps
            } })
            const rep = await flow.run()
            assert.equal(rep.ok, true)
            const d = sink[0]
            assert.equal(d, sink[1], '同一輪各子階段之 deps 為同一份')
            assert.deepEqual(Object.keys(d).sort(), ['ai', 'clock', 'data', 'dirs', 'domains', 'locale', 'settings', 'stores', 'vocab'])
            const desc = Object.getOwnPropertyDescriptors(viaAfter)
            for (const [k, dd] of Object.entries(desc)) assert.ok(dd.enumerable && 'value' in dd && !dd.get, `deps.${k} 須為可列舉之普通屬性`)
            assert.deepEqual(Object.keys(d.stores), ['notes', 'cores', 'relations', 'holds', 'checks'])
            const info = flow.info()
            assert.deepEqual([d.domains === info.domains, d.vocab === info.vocab, d.settings === info.settings, d.data === info.data, d.ai === info.ai, d.clock === info.clock, d.dirs === info.dirs], [true, true, true, true, true, true, true])
            assert.deepEqual(Object.keys(d.dirs), ['db', 'log', 'tmp', 'state', 'knowledge', 'core', 'coreState'])
            await assert.rejects(() => d.stores.notes.get('x'), undefined, '執行結束後集合已關閉')
        })

        it('零設定(僅 workDir＋AI 替身;預設設定與預設席位)跑一輪:摘要交出之 6 篇筆記 → 一則核心,核心 md 與狀態檔落 <workDir>/knowledge/core;筆記之提煉時刻寫回;日誌、開工標記與執行摘要落 <workDir>/log;執行鎖已釋放', async () => {
            const wd = dirOf('zero')
            const ai = scriptAi({ draft: draftAll }, { byPrompt: true })
            const flow = createKnowledgeExtract({ workDir: wd, aiAdapter: ai })
            const notes = notesOf(wd, 6)
            await seedNotes(flow, notes)
            const orig = console.log
            console.log = () => {} // 預設日誌同時輸出 stdout:測試中靜音
            let rep
            try {
                rep = await flow.run()
            }
            finally {
                console.log = orig
            }
            assert.equal(rep.ok, true)
            assert.deepEqual(ai.roles(), ['draft', 'draft', 'draft', 'integrate', 'audit', 'accept'])
            const cores = await withStores(flow, (s) => s.cores.select())
            assert.equal(cores.length, 1)
            const files = fs.readdirSync(`${wd}/knowledge/core`).sort()
            assert.deepEqual(files, [`${cores[0].id}.md`, `${cores[0].id}.state.json`])
            const md = readMd(`${wd}/knowledge/core/${cores[0].id}.md`)
            assert.equal(md.front.concept, '視差量測')
            await withStores(flow, async (s) => {
                for (const n of await s.notes.select()) assert.ok(n.extractedAt, `${n.id} 已寫提煉時刻`)
            })
            assert.equal(findFiles(`${wd}/log`, '-run.log').length, 1)
            assert.equal(findFiles(`${wd}/log`, '-run.start.json').length, 1)
            const sum = readJsonFile(rep.summaryFile)
            assert.deepEqual([sum.name, sum.stages.map((s) => s.name), Object.keys(sum.stages[0].sub)], ['知識提煉', ['提煉'], ['extract']])
            assert.equal(sum.stages[0].summary, '概念 1、更新 1 則核心、消化 6 篇（AI 6 次）')
            assert.ok(!fs.existsSync(`${wd}/tmp/run.lock`), '執行鎖已釋放')
        })

        it('第二輪無新料:不呼叫 AI、核心不變(冪等);新增同概念之筆記 → 既有核心升版(v2)', async () => {
            const wd = dirOf('again')
            const ai = scriptAi({ draft: draftAll })
            const { flow } = buildTestExtractor(wd, { aiAdapter: ai, extract: { minPending: 1, maxWaitDays: 0 } })
            await seedNotes(flow, notesOf(wd, 2))
            await flow.run()
            const n1 = ai.calls.length
            const rep2 = await flow.run()
            assert.equal(ai.calls.length, n1, '無新料不呼叫 AI')
            assert.equal(subReport(rep2, '提煉', 'extract').detail.updated, 0)
            await seedNotes(flow, [landNote(`${wd}/knowledge/notes`, { doc: 'd9', title: '視差筆記9', concepts: ['視差量測'] })])
            const d3 = subReport(await flow.run(), '提煉', 'extract').detail
            assert.equal(d3.updated, 1)
            const [core] = await withStores(flow, (s) => s.cores.select())
            assert.equal(core.version, 2)
        })

        it('run.json:管線名「知識提煉」、唯一之段「提煉」、子階段之 report;檔名為本輪時間戳', async () => {
            const { flow } = buildTestExtractor(dirOf('runjson'), { clock: FIXED_CLOCK })
            const rep = await flow.run()
            const sum = readJsonFile(rep.summaryFile)
            assert.equal(sum.name, '知識提煉')
            assert.deepEqual(sum.stages.map((s) => [s.name, s.ok]), [['提煉', true]])
            assert.deepEqual(Object.keys(sum.stages[0].sub), ['extract'])
            assert.equal(sum.stages[0].summary, '概念 0、更新 0 則核心、消化 0 篇（AI 0 次）')
            assert.equal(path.basename(rep.summaryFile), '20260102030405-run.json')
        })

        it('cfg.name 取代管線名(run.json 之 name);未給用內建名「知識提煉」', async () => {
            const { flow } = buildTestExtractor(dirOf('pname'), { clock: FIXED_CLOCK, name: '自訂管線名' })
            assert.equal(readJsonFile((await flow.run()).summaryFile).name, '自訂管線名')
        })

        it('符合度掃描(extract.standards.scanEachRun):預設關 → 不掃、run.json 無 standards;開 → 管線後掃確定性標準與 AI 標準之紀錄,計數＝同庫直接掃描之值,日誌一行「符合度掃描（…）」', async () => {
            const wd = dirOf('scan')
            const lg1 = logsOf()
            const first = buildTestExtractor(wd, { logFactory: lg1.factory, aiAdapter: scriptAi({ draft: draftAll }) })
            await seedNotes(first.flow, notesOf(wd, 2))
            const r1 = await first.flow.run()
            assert.equal('standards' in readJsonFile(r1.summaryFile), false, '未開掃描:run.json 無 standards')
            assert.equal(lg1.lines().some((l) => l.includes('符合度掃描')), false)
            const lg2 = logsOf()
            const second = buildTestExtractor(wd, { logFactory: lg2.factory, extract: { standards: { scanEachRun: true } } })
            const r2 = await second.flow.run()
            const st = readJsonFile(r2.summaryFile).standards
            assert.ok(Object.keys(st.counts).length >= 10, JSON.stringify(st.counts))
            let direct
            await withStores(second.flow, async (stores) => {
                const info = second.flow.info()
                direct = standardsCountsOf(extractScanOf(await auditExtractStandards({ stores, dirs: info.dirs, domain: info.domains.extract, relateDomain: info.domains.relate }, { material: true })), { at: st.at, ms: st.ms })
            })
            assert.deepEqual(st, direct, '計數＝同庫直接掃描(同一形狀)')
            assert.ok(Number.isInteger(st.ms) && st.ms >= 0 && typeof st.at === 'string' && st.at.length > 0)
            assert.equal(lg2.lines().filter((l) => /^INFO 符合度掃描（\d+\.\d+s）：/.test(l)).length, 1, lg2.lines().join('\n'))
        })

        it('集合之落點(真 LMDB):lmdb.cls 改名之集合——資料寫入自訂之集合名、預設名之集合為空', async () => {
            const wd = dirOf('cls')
            const flow = createKnowledgeExtract({ workDir: wd, aiAdapter: noAi, lock: false, lmdb: { cls: { cores: 'myCores' } } })
            await withStores(flow, async (st) => {
                await st.cores.insertNew([{ id: 'k1', concept: '甲', scope: 'concept' }])
            })
            const peek = async (cl) => {
                const c = W.openCollection({ WOrm: WOrmLmdb, path: `${wd}/db`, db: 'knowledge', cl })
                try {
                    return (await c.select()).map((r) => r.id)
                }
                finally {
                    await c.close()
                }
            }
            assert.deepEqual(await peek('myCores'), ['k1'])
            assert.deepEqual(await peek('cores'), [], '預設名之核心集合不得有資料')
        })
    })

    // ══════════════════════════ ⑥ AI 調度層 ══════════════════════════
    describe('AI 調度層(工作流入口、席位、建構選項、斷網、事件日誌)', function() {

        it('工作流入口:注入之調度層須具 getWkf、seatSpec、recordCall(缺任一即拋並列出三者);內建調度層開 workflow(具三者)、不開失敗預覽', async () => {
            const msg = 'cfg.aiAdapter 須為具 getWkf()、seatSpec(seat, promptLen)、recordCall(r) 之物件'
            for (const bad of [{ callJson: async () => ({}) }, { getWkf: () => ({}), seatSpec: () => null }, { getWkf: () => ({}), recordCall: () => {} }]) assert.equal(msgOf(() => build({ aiAdapter: bad })), msg)
            const flow = createKnowledgeExtract({ workDir: dirOf('builtin'), lock: false, ai: { extraProviders: [{ id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }] }, extract: { ai: seatsAll('t:dead') } })
            const ai = flow.info().ai
            for (const k of ['getWkf', 'seatSpec', 'recordCall']) assert.equal(typeof ai[k], 'function', k)
            assert.equal(typeof ai.getWkf().callAi, 'function')
            assert.equal(ai.getWkf(), ai.getWkf(), '工作流物件快取')
            const r = await ai.callJson('請只回 JSON', () => true, { spec: { use: 't:dead' } })
            assert.equal(r.ok, false)
            assert.equal('preview' in r, false, '失敗預覽不開(提煉不經 callJson)')
            assert.equal(flow.info().aiWorkspace, path.resolve(`${flow.info().dirs.tmp}/ai-workspace`), '內建調度層之工作區')
        })

        it('席位檢核:注入之調度層有 validateSeats 者以 extractSeatsOf 檢核(建構期一次),其警告併入啟動期警告;內建調度層對無法解析之席位建構期拋錯;預設席位可解析', () => {
            const seen = []
            const ai = { ...noAi, validateSeats: (seats) => {
                seen.push(seats)
                return { warnings: ['席位提示一'] }
            } }
            const flow = build({ aiAdapter: ai, extract: { standards: { ai: PANEL } } })
            assert.deepEqual(seen, [extractSeatsOf(flow.info().settings)])
            assert.deepEqual(Object.keys(seen[0]), ['extract.ai.drafters[0]', 'extract.ai.drafters[1]', 'extract.ai.drafters[2]', 'extract.ai.integrate', 'extract.ai.audit', 'extract.ai.revise', 'extract.ai.accept', 'extract.standards.ai.first', 'extract.standards.ai.second'])
            assert.ok(flow.info().startupWarnings.includes('席位提示一'))
            assert.match(msgOf(() => createKnowledgeExtract({ workDir: dirOf(), lock: false, extract: { ai: seatsAll('oc:opencode/no-such-model-free') } })), /^AI 席位於啟動期檢核失敗（7 席）：extract\.ai\.drafters\[0\] → 席位引用了不可用的條目：oc:opencode\/no-such-model-free/)
            assert.doesNotThrow(() => createKnowledgeExtract({ workDir: dirOf(), lock: false }), '套件預設席位須可解析')
        })

        it('判定小組同家:已開啟之小組其兩席首選同家且無不同家之第三席 → 啟動期警告(每輪以「啟動期檢核：」記入日誌)', async () => {
            const same = { use: 'stub:x' }
            const lg = logsOf()
            const flow = build({ extract: { standards: { ai: { first: same, second: same }, disputeCheck: { perRun: 1 } } }, logFactory: lg.factory, stages: [{ name: 's', run: async () => stdReport() }] })
            const w = flow.info().startupWarnings.find((x) => x.startsWith('提煉覆核（extract.standards.ai）'))
            assert.ok(w, flow.info().startupWarnings.join('｜'))
            await flow.run()
            assert.ok(lg.lines().includes(`WARN 啟動期檢核：${w}`))
        })

        it('詞彙之警告併入啟動期警告(自訂內容類型而未給證據封頂)', () => {
            assert.ok(build({ data: { vocab: { claimTypes: ['甲型', '乙型'] } } }).info().startupWarnings.some((w) => w.startsWith('vocab.claimTypes 已自訂而未給 vocab.evidenceCaps')))
        })

        it('建構選項:條目固有之 prompt 長度預篩開啟(capability)——席位之全鏈條目皆有上限者於啟動期警告;席位規格依實際提示詞長度剔除放不下者', () => {
            const flow = createKnowledgeExtract({
                workDir: dirOf('cap'), lock: false,
                ai: { extraProviders: [{ id: 't:cap', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm', maxPromptChars: 10 }] },
                extract: { ai: seatsAll('t:cap') },
            })
            assert.ok(flow.info().startupWarnings.some((w) => w.startsWith('extract.ai.integrate 之全鏈條目皆有 prompt 長度上限（t:cap≤10）')), flow.info().startupWarnings.join('｜'))
            assert.equal(flow.info().ai.seatSpec({ use: 't:cap' }, 100), null, '整條鏈都放不下 → null(提煉之呼叫包裝記失敗、不送出)')
            const both = createKnowledgeExtract({
                workDir: dirOf('cap'), lock: false,
                ai: { extraProviders: [{ id: 't:cap', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm', maxPromptChars: 10 }, { id: 't:big', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }] },
                extract: { ai: seatsAll('t:big') },
            })
            assert.deepEqual(both.info().ai.seatSpec({ use: 't:cap', fallback: ['t:big'], timeoutMs: 1000 }, 100), { use: 't:big', fallback: [], timeoutMs: 1000, budgetMs: 1000, minAttemptMs: 500 }, '放不下之條目自鏈中剔除(開工門檻＝逾時之一半,AI-11)')
        })

        it('斷網不計:注入之 netGuard 確認不通 → 提煉之 pass 記截止(不計失敗、失敗帳不增)、WARN 含「本機網路不通」;未給 netGuard → 照常記失敗', async () => {
            const wire = (netGuard, wd, lg) => createKnowledgeExtract({
                workDir: wd, lock: false, logFactory: lg.factory, ...(netGuard ? { netGuard } : {}),
                ai: { extraProviders: [{ id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }] },
                extract: { ...TEST_EXTRACT, ai: seatsAll('t:dead') },
            })
            let asked = 0
            const guard = { check: async () => ({ up: false, detail: [] }), confirmDown: async () => {
                asked++
                return true
            }, isDown: () => true, describe: () => '' }
            const lg = logsOf()
            const wd1 = dirOf('net-down')
            const down = wire(guard, wd1, lg)
            await seedNotes(down, notesOf(wd1, 2))
            const d = subReport(await down.run(), '提煉', 'extract').detail
            assert.deepEqual([d.failed, d.stopped >= 1, asked >= 1], [0, true, true], JSON.stringify({ failed: d.failed, stopped: d.stopped, asked }))
            // 失敗帳各鍵之 tries(共用件 ledgerOf;缺檔＝空帳)
            const triesOf = (flow) => Object.values(ledgerOf({ dirs: flow.info().dirs })).map((v) => v.tries || 0)
            assert.deepEqual(triesOf(down).filter((n) => n > 0), [], '斷網不記 tries')
            assert.ok(lg.lines().some((l) => /^WARN 提煉\[視差量測\]：提煉因本機網路不通未完成（本次不套用、不計失敗，下輪再做）$/.test(l)), lg.lines().join('\n'))
            const lg2 = logsOf()
            const wd2 = dirOf('net-none')
            const plain = wire(null, wd2, lg2)
            await seedNotes(plain, notesOf(wd2, 2))
            const d2 = subReport(await plain.run(), '提煉', 'extract').detail
            assert.equal(d2.failed, 1)
            assert.deepEqual(triesOf(plain), [1], '未給判斷器:失敗照常記 tries')
            assert.ok(!lg2.lines().some((l) => l.includes('本機網路不通')))
            assert.ok(lg2.lines().some((l) => /^WARN 提煉\[視差量測\]：提煉失敗（/.test(l)), lg2.lines().join('\n'))
        })

        it('調度層事件寫入當輪日誌(內建調度層;條目指向無人監聽之埠):健康降序(ai.healthStreak 1)「供應商健康：」、免費池額度(ai.pools)「供應商額度：」、能力剔除(ai.providerLimits;經席位規格)「供應商能力：」各見;注入之調度層不接', async () => {
            const dead = { id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }
            const run = async (ai, extra = {}, seats = seatsAll('t:dead')) => {
                const lg = logsOf()
                const wd = dirOf('ev')
                const flow = createKnowledgeExtract({ workDir: wd, lock: false, clock: FIXED_CLOCK, logFactory: lg.factory, ai, extract: { ...TEST_EXTRACT, ai: seats }, ...extra })
                await seedNotes(flow, notesOf(wd, 2))
                await flow.run()
                return lg.lines().filter((l) => l.startsWith('WARN 供應商'))
            }
            const h = await run({ extraProviders: [dead], healthStreak: 1 })
            assert.ok(h.length >= 1, h.join('\n'))
            assert.ok(h.every((l) => /^WARN 供應商健康：t:dead 連續 \d+ 次 \S+ 失敗（.*），降序冷卻$/.test(l)), h.join('\n'))
            const ocLog = `${dirOf('oclog')}/opencode.log`
            fs.mkdirSync(path.dirname(ocLog), { recursive: true })
            fs.writeFileSync(ocLog, `timestamp=${new Date().toISOString()} level=ERROR providerID=opencode modelID=mimo-v2.6-flash-free error.error="AI_APICallError: Rate limit exceeded. Please try again later."\n`, 'utf8')
            const p = await run({ extraProviders: [dead], pools: { oc: { log: ocLog, resetUtcHour: 0 } } })
            assert.ok(p.some((l) => /^WARN 供應商額度：oc:opencode\/mimo-v2\.6-flash-free 自 \d{2}:\d{2} 起 opencode 日誌回報當日額度用盡（1 筆，最近 \d{2}:\d{2}），本輪呼叫前降至鏈尾、照設定遞補，至每日重置（UTC 0 時）止$/.test(l)), p.join('\n'))
            const capSeat = { use: 't:dead', fallback: ['t:dead2'] }
            const c = await run({ extraProviders: [dead, { ...dead, id: 't:dead2' }], providerLimits: { 't:dead': 5 } }, {}, { drafters: [capSeat, capSeat, capSeat], integrate: capSeat, audit: capSeat, revise: capSeat, accept: capSeat })
            assert.equal(c.filter((l) => l.startsWith('WARN 供應商能力：')).length, 1, `同一條目只記一行:\n${c.join('\n')}`)
            assert.ok(c.some((l) => /^WARN 供應商能力：t:dead 之 prompt 上限 5 字元，本輪有呼叫達 \d+ 字元而改由遞補承接（未 spawn）$/.test(l)), c.join('\n'))
            const off = await run({ healthStreak: 1, pools: { oc: { log: ocLog } } }, { aiAdapter: scriptAi({ draft: 'fail' }) })
            assert.deepEqual(off, [], '注入之調度層屬注入方:不接事件')
        })

        it('提煉之調度層預設開健康降序(ai.healthStreak 3)', () => {
            assert.equal(build().info().settings.ai.healthStreak, 3)
        })
    })
})
