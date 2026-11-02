// extractKit.mjs — 提煉測試之共用件(不帶 .test. 中綴:共用層,避免被 runner 當測試檔抓取)
//
// 【單一來源】各測試檔共用之小件只定義一次,不在各檔另寫一份(同一規則多處手寫必然漂移):
//   ① 目錄與時鐘:extractDirsOf(測試知識庫之目錄;核心狀態目錄未覆寫者＝核心目錄)、clock(顯式時區之時鐘)、fixedClock(固定時刻之時鐘——
//     提煉之時刻比較以之固定;同一秒內連跑兩輪之時窗不前進)
//   ② 日誌與狀態:recLog(記錄型 logger;日誌行為 `<等級> <訊息>`;取抓取套件之測試共用件,四套件同一份)、has(日誌是否有一行合乎樣式)、readState(讀核心
//     狀態檔)、ledgerOf(讀失敗帳;與 readState 同層)、seedCore(以一批差量自空狀態造既有核心並落帳;差量須全數套用)
//   ③ 3+3 替身:SEATS／ROLE(席位與角色)、ANN(合 ES4 之標注)、提示詞之讀法(batchOf、codesIn、acceptOps、auditOps)、各棒之回覆件(keepAll、verdictOn、
//     auditHigh、echoIntegrate、draftAll、onlyFirst、doubtOn、cover)、提示詞首句之角色(PROMPT_ROLES、roleOfPrompt)、scriptAi(提煉段用:依席位、角色或提示詞
//     首句回覆,未給之棒用預設,回覆經工作流之 check 驗;另有 'fail'／'budget'／'limit'／'netDown'／'skipped' 等失敗形狀)、seatAi(單一 pass 用:依席位回覆,
//     未給即該席失敗;記下各席之提示詞)
//   ④ 判定小組替身:panelCall(各覆核執行器之 call 契約)、panelAi(各專步經 AI 調度層之工作流入口呼叫)——依段名回覆;各案之票(依提示詞之項)由各案寫
//   ⑤ 提煉段之環境:writeNote／noteRow(筆記 md 與記錄)、mkEnvIn(目錄、筆記、記憶體集合、設定、domains)、addNotes(追加筆記)、runStage(跑一次提煉段)
//   ⑥ 不執行之替身:noAi(只建構之案;取工作流入口即拋——被呼叫即是缺陷)、blankAi(只建構、不執行之案;工作流入口回空物件)
// 【家】本檔之具名定義為其「家」(看得到本檔之測試檔不得另定義同名件);時鐘(clock)與標注(ANN)為一行之資料常數,
//   不在此限(各檔之題材夾具可有自己的一份;位元組相同者改取本檔)。

import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expandDirs, genClockTZ, memStore, recLog } from './captureForTest.mjs'
import { writeMd } from '../../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../../src/core/relatePackage.mjs'
import { resolveExtractSettings } from '../../src/core/extractSettings.mjs'
import { applyDelta, coverageOf, commitBatch } from '../../src/stores/coreDelta.mjs'
import { emptyState } from '../../src/stores/coreState.mjs'
import { createExtractDomain } from '../../src/domain/extractDomain.mjs'
import { stageExtract } from '../../src/stages/extractStage.mjs'
import { ATTEMPTS_FILE } from '../../src/stores/extractFiles.mjs'


// ═══════════════════════ ① 目錄與時鐘 ═══════════════════════

/**
 * 測試知識庫之知識目錄(相對 workDir;抓取套件之基本目錄以外者,以其 expandDirs 之 extra 宣告)
 *
 * @type {Object}
 */
const KNOWLEDGE_DIRS = Object.freeze({ notes: 'knowledge/notes', core: 'knowledge/core', relations: 'knowledge/relations' })

/**
 * 測試知識庫之目錄:抓取套件之基本目錄(db、log、tmp、state、knowledge)＋筆記、核心、關聯目錄,逐鍵覆寫後衍生核心狀態目錄——
 *   未覆寫 coreState(非空字串)者＝覆寫後之 core(核心狀態檔與核心 md 同處;只覆寫 core 者狀態與 md 不分家)
 *
 * @param {String} workDir 輸入工作目錄
 * @param {Object} [overrides={}] 輸入逐鍵覆寫物件，非物件時視為{}
 * @returns {Object} 回傳 { db, log, tmp, state, knowledge, notes, core, relations, coreState }(皆為路徑字串)
 * @example
 * console.log(extractDirsOf('c:/kb').coreState, extractDirsOf('c:/kb', { core: 'd:/vault/核心' }).coreState)
 * // => c:/kb/knowledge/core d:/vault/核心
 */
export function extractDirsOf(workDir, overrides = {}) {
    const o = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}
    const dirs = expandDirs(workDir, o, KNOWLEDGE_DIRS)
    if (!(typeof o.coreState === 'string' && o.coreState)) dirs.coreState = dirs.core
    return dirs
}

/**
 * 顯式時區之時鐘(提煉段之 deps.clock;各測試檔同一份)
 *
 * @type {Object}
 */
export const clock = genClockTZ('Asia/Taipei')

/**
 * 固定時刻之時鐘(提煉所讀之 iso8 與 stamp8)
 *
 * @param {String} day 輸入日期 'YYYY-MM-DD'
 * @returns {Object} 回傳 { iso8:()=>'<day>T00:00:00+08:00', stamp8:()=>'<YYYYMMDD>' }
 */
export function fixedClock(day) {
    return { iso8: () => `${day}T00:00:00+08:00`, stamp8: () => day.replace(/\D/g, '') }
}


// ═══════════════════════ ② 日誌與狀態 ═══════════════════════

/** 記錄型 logger:取抓取套件 test/tools/testKit 之一份(經 captureForTest;lines 為 `INFO …`、`WARN …`、`ERROR …`),本檔轉出供各測試檔沿用 */
export { recLog } from './captureForTest.mjs'

/**
 * 日誌是否有一行合乎樣式
 *
 * @param {Object} log 輸入 recLog 之產物
 * @param {RegExp} re 輸入樣式
 * @returns {Boolean} 回傳是否命中
 */
export function has(log, re) {
    return log.lines.some((l) => re.test(l))
}

/**
 * 讀核心狀態檔
 *
 * @param {Object} env 輸入測試環境(取 dirs.coreState)
 * @param {String} id 輸入核心 id
 * @returns {Object} 回傳狀態檔之內容
 */
export function readState(env, id) {
    return JSON.parse(fs.readFileSync(`${env.dirs.coreState}/${id}.state.json`, 'utf8'))
}

/**
 * 讀失敗帳(dirs.state 下之 ATTEMPTS_FILE;缺檔＝空帳,同失敗帳之讀法——提煉段只在有失敗時落帳)
 *
 * @param {Object} env 輸入測試環境(取 dirs.state)
 * @param {String} [key] 輸入帳之鍵(如 'concept|動量'、SYNONYM_LEDGER_KEY);未給回整份帳
 * @returns {Object|undefined} 回傳該鍵之列(無則 undefined)或整份帳
 */
export function ledgerOf(env, key) {
    const f = `${env.dirs.state}/${ATTEMPTS_FILE}`
    const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}
    return key === undefined ? all : all[key]
}

/**
 * 以一批差量造既有核心:自 base(未給＝emptyState({ coreId, concept }))套用差量,差量須全數套用(否則夾具本身有誤),再以同一批落帳
 *   (出處入 consumed,使不變式「出處必為已用筆記」成立);commit 為 false 者不落帳(只要套用後之狀態)
 *
 * @param {Object} o 輸入 { ops:Array(或 delta:差量物件), batch:[{ code, id }], at, coreId?, concept?, base?, commit?:Boolean(預設 true), msg?:String(未全數套用時之訊息;預設列出拒收) }
 * @returns {Object} 回傳核心狀態
 */
export function seedCore(o) {
    const base = o.base || emptyState({ coreId: o.coreId, concept: o.concept })
    const r = applyDelta(base, o.delta || { ops: o.ops }, { batch: o.batch, mode: 'delta', at: o.at })
    assert.deepEqual(r.rejected, [], o.msg ?? JSON.stringify(r.rejected))
    return o.commit === false ? r.state : commitBatch(r.state, coverageOf({ batch: o.batch, applied: r.applied }))
}


// ═══════════════════════ ③ 3+3 替身 ═══════════════════════

/**
 * 深凍結(共用之夾具常數:同一 worker 內各測試檔共用一份,被就地改動即拋錯,不靜默汙染他檔)
 *
 * @param {*} v 輸入值
 * @returns {*} 回傳同一值(已凍結)
 */
function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v)
        for (const x of Object.values(v)) deepFreeze(x)
    }
    return v
}

/** 3+3 之席位(替身以 use 分派) */
export const SEATS = deepFreeze({ drafters: [{ use: 'd1' }, { use: 'd2' }, { use: 'd3' }], integrate: { use: 'int' }, audit: { use: 'aud' }, revise: { use: 'rev' }, accept: { use: 'acc' } })

/** 席位 → 角色 */
export const ROLE = deepFreeze({ d1: 'draft', d2: 'draft', d3: 'draft', int: 'integrate', aud: 'audit', rev: 'revise', acc: 'accept' })

/** 合檢定標準之標注(ES4:銳評必填;rule 之利弊寫出處內容或「出處未載」) */
export const ANN = deepFreeze({ critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] })

/** 起草提示詞中之本批 [{ code, title }] */
export const batchOf = (prompt) => [...prompt.matchAll(/^### (N\d+) (\S*)/gm)].map((m) => ({ code: m[1], title: m[2] }))

/** 起草提示詞中之本批代號 */
export const codesIn = (prompt) => batchOf(prompt).map((x) => x.code)

/** 終審提示詞所列之操作 [{ i, op }] */
export const acceptOps = (prompt) => [...prompt.matchAll(/^i=(\d+) (\{.*\})$/gm)].map((m) => ({ i: Number(m[1]), op: JSON.parse(m[2]) }))

/** 審計提示詞所列之整合後操作 [{ oid, op }] */
export const auditOps = (prompt) => (prompt.split('【整合後之操作】\n')[1] || '').split('\n\n')[0].split('\n').map((l) => {
    const m = l.match(/^(\S+?)（/)
    return m ? { oid: m[1], op: JSON.parse(l.slice(l.indexOf('{'))) } : null
}).filter(Boolean)

/** 終審逐條明列 keep(不可逆操作須明列裁決,漏列者不套用) */
export const keepAll = (prompt) => ({ verdicts: acceptOps(prompt).map((x) => ({ i: x.i, action: 'keep' })) })

/** 對符合 pred 之操作下 v 裁決,其餘 keep;omit 為 true 時其餘不列 */
export const verdictOn = (pred, v, omit = false) => (prompt) => ({ verdicts: acceptOps(prompt).filter((x) => !omit || pred(x.op)).map((x) => (pred(x.op) ? { i: x.i, ...v } : { i: x.i, action: 'keep' })) })

/** 審計指出符合 pred 之操作(嚴重度高) */
export const auditHigh = (pred, type = '離題') => (prompt) => ({ issues: auditOps(prompt).filter((x) => pred(x.op)).map((x) => ({ ref: x.oid, severity: '高', type, detail: '與本概念無關', fix: '剔除' })) })

/**
 * 整合替身:第一份成功候選之操作原樣收入(via 指回)、其略過清單照收
 *
 * @param {String} prompt 輸入整合提示詞
 * @returns {Object} 回傳 { ops, skipped }
 */
export function echoIntegrate(prompt) {
    const secs = prompt.split(/^【候選 (\d+)】$/m)
    if (secs.length < 3) return { ops: [], skipped: [] }
    const ops = []
    let skipped = []
    for (const line of secs[2].split('\n')) {
        const m = line.match(/^(a\d+_\d+)（/)
        if (m) {
            const op = JSON.parse(line.slice(line.indexOf('{')))
            delete op._oid
            ops.push({ ...op, via: [m[1]] })
            continue
        }
        const s = line.match(/^略過：(.*)$/)
        if (s) skipped = s[1].split('、').map((x) => x.match(/^(N\d+)（(.*)）$/)).filter(Boolean).map((x) => ({ note: x[1], reason: x[2] }))
    }
    return { ops, skipped }
}

/** 起草替身:每篇一條新主張(文字含筆記標題,各篇相異;單篇出處故為 rule——principle 須跨篇,ES12),並以首條立本質 */
export const draftAll = (prompt) => {
    const b = batchOf(prompt)
    return {
        ops: [
            ...b.map((x, k) => ({ op: 'add', ref: `r${k}`, kind: 'rule', text: `主張 ${x.title}`, basis: '案例', sources: [x.code], ...ANN })),
            { op: 'essence', text: '本質文字', claims: ['@r0'], reason: '首版' },
        ],
        skipped: [],
    }
}

/** 起草替身:只引本批第一篇(一條 rule 並以之立本質;其餘篇未涵蓋——驗未涵蓋之筆記之重送與計次) */
export const onlyFirst = (prompt) => ({ ops: [{ op: 'add', ref: 'a', kind: 'rule', text: '只引第一篇', basis: '案例', sources: [codesIn(prompt)[0]], ...ANN }, { op: 'essence', text: '只引第一篇', claims: ['@a'], reason: '首版' }], skipped: [] })

/** 終審替身:對新增之爭議(dispute_add)下「存疑」(非對立),其餘 keep */
export const doubtOn = verdictOn((op) => op.op === 'dispute_add', { action: 'doubt', reason: '非對立', note: '兩方回答不同情境' })

/**
 * 起草替身之工廠:本批每篇各以一條 confirm 涵蓋既有主張 id(不新增條目)
 *
 * @param {String} id 輸入既有主張之 id
 * @returns {Function} 回傳 (prompt) => { ops, skipped }
 */
export const cover = (id) => (prompt) => ({ ops: codesIn(prompt).map((c) => ({ op: 'confirm', id, sources: [c] })), skipped: [] })

/**
 * 3+3 之提示詞首句 → 角色(預設席位不以 use 區分角色時用:同一模型可兼任起草與整合)。依序比對;3+3 以外之提示詞回 'other'
 *
 * @type {Array}
 */
export const PROMPT_ROLES = deepFreeze([[/^你是.*?的提煉器。/, 'draft'], [/^你是.*?的整合員。/, 'integrate'], [/^你是.*?的審計員。/, 'audit'], [/^你是.*?的修訂員。以下是「/, 'revise'], [/^你是.*?的終審員。/, 'accept']])

/** 提示詞之 3+3 角色(PROMPT_ROLES;無者 'other') */
export const roleOfPrompt = (prompt) => (PROMPT_ROLES.find(([re]) => re.test(String(prompt || ''))) || [null, 'other'])[1]

/**
 * 提煉段之 3+3 替身 adapter:起草三席走 runFanout,其餘走 callAi;script 之鍵可為席位(d1…acc,或判定小組等他席之 use)或角色
 *   (draft／integrate／audit／revise／accept),值為 JSON、(prompt, n:該角色第幾次)=>JSON、'fail'(失敗)、'budget'(上游預算耗盡,未嘗試)、
 *   'limit'(額度用盡之實際形狀:錯誤只有裸離開碼、原因只在 stdout)、'netDown'(調度層標整鏈皆敗且本機網路不通——呼叫包裝視同截止,不計失敗)、
 *   'skipped'(整鏈略過而未標斷網——一般失敗);未給之整合／審計／修訂／終審用預設(整合原樣收入第一份候選、審計無意見、
 *   修訂無補丁、終審逐條 keep);回覆經工作流傳入之 check 驗證(同真工作流之語意)。o.byPrompt 為 true 時角色依提示詞首句判(roleOfPrompt;
 *   席位為任意 use 者,如套件之預設席位)
 *
 * @param {Object} [script={}] 輸入腳本
 * @param {Object} [o={}] 輸入 { byPrompt:Boolean }
 * @returns {Object} 回傳 { calls:[{ use, role, prompt, acceptTruncated }], roles:()=>角色序列, getWkf, seatSpec, recordCall }
 */
export function scriptAi(script = {}, o = {}) {
    const calls = []
    const DEF = { integrate: echoIntegrate, audit: { issues: [] }, revise: { edits: [], adds: [], removes: [] }, accept: keepAll }
    const answer = (use, prompt, opt) => {
        const role = o?.byPrompt === true ? roleOfPrompt(prompt) : (ROLE[use] || use)
        const fn = script[use] !== undefined ? script[use] : (script[role] !== undefined ? script[role] : DEF[role])
        const n = calls.filter((c) => c.role === role).length + 1
        calls.push({ use, role, prompt, acceptTruncated: opt?.acceptTruncated })
        const out = typeof fn === 'function' ? fn(prompt, n) : fn
        if (out === 'budget') return { ok: false, error: 'budget exhausted', errorType: 'budget', tried: [] } // 上游預算耗盡(未嘗試)
        if (out === 'limit') return { ok: false, error: 'Exit code 1', errorType: 'exec', tried: [{ providerId: use, outcome: 'skip-group', errorType: 'exec', error: 'Exit code 1', stdout: 'You\'ve hit your session limit · resets 10:30am (Asia/Taipei)\n' }] }
        if (out === 'netDown') return { ok: false, skipped: true, netDown: true, error: 'fetch failed', errorType: 'exec', tried: [] } // 整鏈皆敗且本機網路不通
        if (out === 'skipped') return { ok: false, skipped: true, error: 'all skipped', errorType: 'exec', tried: [] } // 整鏈略過而網路通(未標 netDown)
        if (out === undefined || out === 'fail') return { ok: false, error: `${use} 失敗（替身）`, tried: [{ providerId: use, outcome: 'fail', errorType: 'exec', error: '替身失敗' }] }
        if (typeof opt?.check === 'function' && !opt.check(out)) return { ok: false, error: 'OUTPUT_VALIDATION_FAILED', tried: [{ providerId: use, outcome: 'fail', errorType: 'validation' }] }
        const providerId = `stub-${use}`
        return { ok: true, json: out, providerId, ms: 1, tried: [{ providerId, outcome: 'ok' }] }
    }
    const wkf = {
        runFanout: async ({ task, agents }) => ({ ok: true, agents: agents.map((a) => answer(a.use, task, a)) }),
        callAi: async (prompt, opt) => answer(opt.spec.use, prompt, opt),
    }
    return { calls, roles: () => calls.map((c) => c.role), getWkf: () => wkf, seatSpec: (seat) => (seat ? { use: seat.use, fallback: [], timeoutMs: 60_000 } : null), recordCall: () => {} }
}

/**
 * 單一 pass(runPass／runPending)之替身 adapter:依席位 use 回覆(不經角色預設、不驗 check——各棒之回覆原樣交工作流);值為 JSON、
 *   (prompt)=>JSON、'fail'(失敗;未給亦同)、'budget'(上游預算耗盡,未嘗試)、'netDown'(該席整鏈皆敗且本機網路不通);h[`${use}Provider`] 可指定
 *   成交之供應者(預設＝use)
 *
 * @param {Object} h 輸入 { [席位 use]: 回覆 }
 * @returns {Object} 回傳 { seen:Array(各次呼叫之席位,依序), prompts:{ 席位: 最後一次之提示詞 }, getWkf, seatSpec, recordCall }
 */
export function seatAi(h) {
    const seen = []
    const prompts = {}
    const answer = (key, prompt) => {
        seen.push(key)
        prompts[key] = prompt
        const v = typeof h[key] === 'function' ? h[key](prompt) : h[key]
        if (v === 'budget') return { ok: false, error: 'budget exhausted', errorType: 'budget', providerId: key, tried: [] }
        if (v === 'netDown') return { ok: false, skipped: true, netDown: true, error: '整鏈皆敗', providerId: key, tried: [] }
        if (v === undefined || v === 'fail') return { ok: false, error: `${key} fail`, providerId: key }
        return { ok: true, json: v, providerId: h[`${key}Provider`] || key, ms: 1 }
    }
    const wkf = {
        runFanout: async ({ task, agents }) => ({ ok: true, agents: agents.map((a) => answer(a.use, task)) }),
        callAi: async (prompt, opt) => answer(opt.spec.use, prompt),
    }
    return { seen, prompts, getWkf: () => wkf, seatSpec: (seat) => ({ use: seat.use, fallback: [], timeoutMs: 1000, budgetMs: 1000 }), recordCall: () => {} }
}


// ═══════════════════════ ④ 判定小組替身 ═══════════════════════

/**
 * 成交之供應者:o.provider 為函數 → (stage, use);'stage' → 段名;未給 → 席位之 use
 *
 * @param {Object} o 輸入選項
 * @param {String} stage 輸入段名
 * @param {String} use 輸入席位之 use
 * @returns {String} 回傳供應者
 */
function providerOf(o, stage, use) {
    if (typeof o.provider === 'function') return o.provider(stage, use)
    return o.provider === 'stage' ? stage : use
}

/**
 * 覆核執行器(runSupportCheck／runOrphanCheck／runDisputeCheck／runSynonymCheck／runSupportRevise)之 call 替身:依段名(check1…、orphan1…、
 *   dispute1…、synonym1…、revise9)以 reply 回覆;回覆 'fail' 或 undefined ＝ 該席失敗
 *
 * @param {Function} reply 輸入 (stage, prompt, seat) => 回覆之 JSON｜'fail'｜undefined
 * @param {Object} [o={}] 輸入 { provider:'stage'｜(stage, use)=>供應者(未給＝席位之 use) }
 * @returns {Function} 回傳 async (stage, seat, prompt) => { ok:true, providerId, json }｜{ ok:false }
 */
export function panelCall(reply, o = {}) {
    return async (stage, seat, prompt) => {
        const out = reply(stage, prompt, seat)
        if (out === undefined || out === 'fail') return { ok: false }
        return { ok: true, providerId: providerOf(o, stage, seat?.use), json: out }
    }
}

/**
 * 各專步(爭議、失撐、存量、同義)經 AI 調度層之工作流入口(getWkf().callAi)呼叫之替身:段名預設＝席位之 use(o.stageOf 可另判,如以提示詞之角色分);
 *   回覆 'fail'、null 或 undefined ＝ 失敗
 *
 * @param {Function} reply 輸入 (stage, prompt) => 回覆之 JSON｜'fail'｜null｜undefined
 * @param {Object} [o={}] 輸入 { stageOf:(prompt, opt)=>段名, provider:'stage'｜(stage, use)=>供應者(未給＝席位之 use) }
 * @returns {Object} 回傳 { getWkf, seatSpec, recordCall }
 */
export function panelAi(reply, o = {}) {
    const wkf = {
        callAi: async (prompt, opt) => {
            const stage = typeof o.stageOf === 'function' ? o.stageOf(prompt, opt) : opt?.spec?.use
            const out = reply(stage, prompt)
            if (out === 'fail' || out === null || out === undefined) return { ok: false, error: '替身失敗', tried: [] }
            const providerId = providerOf(o, stage, opt?.spec?.use)
            return { ok: true, json: out, providerId, ms: 1, tried: [{ providerId, outcome: 'ok' }] }
        },
    }
    return { getWkf: () => wkf, seatSpec: (seat) => (seat ? { use: seat.use, fallback: [], timeoutMs: 60_000 } : null), recordCall: () => {} }
}


// ═══════════════════════ ⑤ 提煉段之環境 ═══════════════════════

/**
 * 寫一篇筆記 md(一句話重點、核心知識、來源;frontmatter 之 conflicts／published 取 n)
 *
 * @param {Object} dirs 輸入目錄(取 notes)
 * @param {Object} n 輸入筆記 { id, title?, conflicts?, published? }
 * @param {String} [core] 輸入核心知識之內容(預設「<id> 之知識」;改寫以模擬內容變更)
 * @returns {String} 回傳 md 檔路徑
 */
export function writeNote(dirs, n, core = `${n.id} 之知識`) {
    const file = `${dirs.notes}/${n.id}.md`
    writeMd(file, { title: n.title || n.id, conflicts: n.conflicts || [], published: n.published || '' },
        `# ${n.title || n.id}\n\n## 一句話重點\n\n${n.id} 之重點\n\n## 核心知識\n\n- ${core}\n\n## 來源\n\n- x`)
    return file
}

/**
 * 寫一篇筆記 md 並回傳記錄
 *
 * @param {Object} dirs 輸入目錄
 * @param {Object} n 輸入筆記(記錄之欄位覆寫)
 * @returns {Object} 回傳筆記記錄
 */
export function noteRow(dirs, n) {
    return { title: n.id, category: '方法與技術', createdAt: '2026-08-01T00:00:00+08:00', relatedAt: '2026-08-02', claimType: '實證研究', evidenceLevel: '中', sourceName: `S-${n.id}`, docId: `d-${n.id}`, ...n, file: writeNote(dirs, n) }
}

/**
 * 知識庫環境之建構器(目錄落在 root 下,各環境各一子目錄)
 *
 * @param {String} root 輸入暫存根目錄
 * @returns {Function} 回傳 (notes, o={ extract?, cores?, relations?, holds?, checks?, docs? }) => { dirs, stores:{ notes, cores, relations, holds, checks, docs }, settings, domains:{ extract, relate } }
 */
export function mkEnvIn(root) {
    // 暫存根須為絕對路徑(tmpRoot 之產物):空字串或相對路徑會使環境落到磁碟根或 cwd 下(describe 定義期之暫存根尚未建立即是此形)
    if (!(typeof root === 'string' && path.isAbsolute(root))) throw new Error(`mkEnvIn:暫存根須為絕對路徑(tmpRoot 之產物;於 before 內建立後再實例化):${JSON.stringify(root)}`)
    let seq = 0
    return (notes, o = {}) => {
        const dirs = extractDirsOf(`${root}/w${++seq}`)
        for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
        const settings = resolveExtractSettings({
            extract: { minNotes: 2, notesPerConcept: 3, perRun: 2, catchupBatches: 1, minPending: 1, maxWaitDays: 0, ai: SEATS, ...(o.extract || {}) },
        })
        return {
            dirs,
            stores: { notes: memStore(notes.map((n) => noteRow(dirs, n))), cores: memStore(o.cores || []), relations: memStore(o.relations || []), holds: memStore(o.holds || []), checks: memStore(o.checks || []), docs: memStore(o.docs || []) },
            settings,
            domains: { extract: createExtractDomain({}), relate: createRelateDomain({}) },
        }
    }
}

/**
 * 追加筆記(後續輪次之新料)
 *
 * @param {Object} env 輸入環境
 * @param {Array} ids 輸入筆記 id
 * @param {Array} concepts 輸入概念標籤
 * @returns {Promise} 回傳 insertNew 之結果
 */
export async function addNotes(env, ids, concepts) {
    await env.stores.notes.insertNew(ids.map((id) => noteRow(env.dirs, { id, concepts })))
}

/**
 * 跑一次提煉段(記錄型 logger;剩餘時間預設一小時、未逾期)
 *
 * @param {Object} env 輸入環境
 * @param {Object} ai 輸入 AI 替身
 * @param {Object} [opt={}] 輸入提煉段之 opt
 * @param {Object} [o={}] 輸入 { clock?(預設 clock), remainingMs?:Number }
 * @returns {Promise<Object>} 回傳 { report, log }
 */
export async function runStage(env, ai, opt = {}, o = {}) {
    const log = recLog()
    const ctx = { deps: { ...env, clock: o.clock || clock, ai }, log, remainingMs: () => o.remainingMs ?? 3_600_000, expired: () => false }
    const report = await stageExtract(opt).run(ctx)
    return { report, log }
}


// ═══════════════════════ ⑥ 不執行之替身 ═══════════════════════

/** 只建構之案之 AI 調度層:取工作流入口即拋(本案不應呼叫 AI;被呼叫即是缺陷);seatSpec 回 null、recordCall 無作用 */
export const noAi = Object.freeze({
    getWkf: () => {
        throw new Error('本案不應呼叫 AI')
    },
    seatSpec: () => null,
    recordCall: () => {},
})

/** 只建構、不執行之案之 AI 調度層(合工作流入口之形狀;工作流入口回空物件——不拋,供建構期取用 getWkf 之組裝) */
export const blankAi = Object.freeze({ getWkf: () => ({}), seatSpec: () => null, recordCall: () => {} })


export default {
    extractDirsOf, clock, fixedClock, recLog, has, readState, ledgerOf, seedCore,
    SEATS, ROLE, ANN, batchOf, codesIn, acceptOps, auditOps, keepAll, verdictOn, auditHigh, echoIntegrate, draftAll, onlyFirst, doubtOn, cover, PROMPT_ROLES, roleOfPrompt,
    scriptAi, seatAi, panelCall, panelAi,
    writeNote, noteRow, mkEnvIn, addNotes, runStage,
    noAi, blankAi,
}
