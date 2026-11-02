// unit-extract-irreversible.test.mjs — 不可逆操作之涵蓋表(操作 × 處境):每一格釘一案(既有案、本檔之最小案或不適用之依據),並以案釘住撤銷與重新收件兩契約
//
// 規則出處:stores/coreState 檔頭【操作語意】⑤⑧⑪⑫⑭⑱ 與 TERMINAL_OPS／TERMINAL_OP_LABELS;standards/opGuards 檔頭【補丁守門依操作類別映射】與
//   CONSTRUCTIVE_OPS／DESTRUCTIVE_OPS;workflow/runPass 之終審段與出處支持段;workflow/pending、workflow/supportGate 檔頭;standards/stockFix 檔頭
//   【回退＝撤銷】;standards/registry 檔頭【不經納入閘之寫入入口】;ops/reviveClaims 檔頭【規則】;README §13〈無逆操作之件〉;
//   規則帳本 EXT-02(終態不可逆)、EXT-10(待審)、EXT-24(不經納入閘之寫入入口)、EXT-26(先記後寫、還原之閘)、EXT-28(終審守門)、EXT-33(無逆操作須文件化);
//   CLAUDE.md 三原則之①回退＝撤銷該次處置之效果。
// 【操作全集】不可逆操作以原始碼之 TERMINAL_OPS 為準(取代、撤回、合併、拆解、拆分);本質重寫(核心已有本質時之 essence)依派工另列一列——
//   原始碼不列其為不可逆(CONSTRUCTIVE_OPS),其各格依建設性操作之實際路徑寫。表之操作集取 TERMINAL_OPS:原始碼新增終態操作而表未補即紅。
// 【處境】套用(終審明列 keep 而落盤)、待審(存入 pendingReview)、拒絕(終審 drop、守門／納入閘剔除)、還原(已套用之效果被撤銷;無逆操作者寫依據)。
// 【兩契約】撤銷 rollbackCoreStockFix 不過納入閘(亦不驗不變式;只驗形);重新收件 reviveClaims 過閘(REVIVE_GATE_STDS＝ES2／ES4／ES12／ES13,另須出處存活)。
// 【判準自檢】表之完整性與引用之有效性以同一判準函數(coverageProblemsOf)判;合成之表(缺格、指向不存在之標題、重複格…)須各被抓到、合規者不誤報。
// 執行:自套件根 node <mocha> test/unit-extract-irreversible.test.mjs(暫存落 test/_tmp/extract-irreversible-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { STOCK_LEDGER_FILE } from './tools/captureForTest.mjs'
import { seedCore, SEATS, ANN, keepAll, verdictOn, seatAi as fakeAi, scriptAi, draftAll, mkEnvIn, runStage, readState, fixedClock } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots, resetConceptFold, PKG_ROOT } from './tools/extractTestKit.mjs'
import { STATUS } from '../src/core/capturePackage.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { TERMINAL_OPS, TERMINAL_OP_LABELS, DELTA_OPS, CONSOLIDATE_OPS, DISSOLVED_RETRACT_REASON, findItem, checkInvariants, reviveItems } from '../src/stores/coreState.mjs'
import { applyDelta, commitBatch, coverageOf } from '../src/stores/coreDelta.mjs'
import { CONSTRUCTIVE_OPS, DESTRUCTIVE_OPS, opClass } from '../src/standards/opGuards.mjs'
import { runPass } from '../src/workflow/runPass.mjs'
import { pendingReviewOps } from '../src/workflow/verdicts.mjs'
import { checkCore } from '../src/standards/coreStandards.mjs'
import { CORE_FIX_STDS } from '../src/standards/coreStockFix.mjs'
import { planCoreStockFix, applyCoreStockFix, readCoreStockLedger, rollbackCoreStockFix } from '../src/standards/stockFix.mjs'
import { EXTRACT_UNGATED_WRITE_ENTRIES } from '../src/standards/registry.mjs'
import { reviveClaims, REVIVE_GATE_STDS } from '../src/ops/reviveClaims.mjs'

let TMP = ''
let mkEnv = null
const SELF = 'test/unit-extract-irreversible.test.mjs'
const AT = '2026-10-30T09:00:00+08:00'
const DOMAIN = createExtractDomain({})

// ═══════════════════════ 題材夾具(天文;中立) ═══════════════════════

/** 既有核心之出處(兩篇:爭議兩方須出自相異之筆記,同篇正反不成爭議——coreState ④) */
const SEED_BATCH = [{ code: 'N0', id: 's0' }, { code: 'N9', id: 's9' }]
/** 本批筆記(起草所引;摘要即出處之內容——runPass 之 contentOf 預設取之) */
const BATCH = [{ code: 'N1', id: 'n1', digest: '### N1 星雲觀測\n【核心知識】新觀測顯示反射星雲之顏色亦受塵埃顆粒大小影響；星雲之塵埃會吸收紫外線。' }]
const NOTES = new Map([['n1', { id: 'n1', evidenceLevel: '中', claimType: '實證研究', docId: 'd1' }]])
const OLD_ESSENCE = '星雲之面貌取決於其與恆星之關係'

/**
 * 既有核心:C1～C4 四條 rule(C4 為可拆之長條目)、爭議 D1(一方引 C1、一方只有立場文字)、本質引 C1
 *
 * @returns {Object} 回傳核心狀態(已落帳)
 */
function baseState() {
    return seedCore({
        coreId: 'nb', concept: '星雲', batch: SEED_BATCH, at: AT,
        ops: [
            { op: 'add', ref: 'a', kind: 'rule', text: '暗星雲會遮蔽其後方之星光', basis: '觀測', sources: ['N0'], ...ANN },
            { op: 'add', kind: 'rule', text: '發射星雲因鄰近熱星照射而發光', basis: '觀測', sources: ['N0'], ...ANN },
            { op: 'add', kind: 'rule', text: '反射星雲因塵埃散射星光而呈藍色', basis: '觀測', sources: ['N9'], ...ANN },
            { op: 'add', kind: 'rule', text: '行星狀星雲由恆星晚期拋出之外層形成，其形狀常受伴星牽引', basis: '觀測', sources: ['N9'], ...ANN },
            { op: 'dispute_add', question: '暗星雲是否必然阻擋可見光', sides: [{ position: '必然阻擋', claims: ['@a'] }, { position: '塵埃稀薄時可透出部分星光', conditions: ['塵埃稀薄'], sources: ['N9'] }] },
            { op: 'essence', text: OLD_ESSENCE, claims: ['@a'], reason: '首版' },
        ],
    })
}

/** 各操作之最小差量(皆合檢定標準:無數字、標注齊全) */
const OPS = Object.freeze({
    supersede: { op: 'supersede', id: 'C3', reason: '新觀測修正舊說', validPeriod: '較早之觀測', sources: ['N1'] },
    retract: { op: 'retract', id: 'C2', reason: '離題' },
    merge: { op: 'merge', into: 'C2', from: ['C3'], reason: '兩條描述同一發光機制' },
    dispute_dissolve: { op: 'dispute_dissolve', id: 'D1', reason: '兩方回答不同塵埃密度之情境', kinds: [null, 'pitfall'], annotations: [null, { critique: ANN.critique }] },
    split: { op: 'split', id: 'C4', reason: '一條含兩個主張', parts: [{ text: '行星狀星雲由恆星晚期拋出之外層形成', ...ANN }, { text: '其形狀常受伴星牽引', ...ANN }] },
    essence: { op: 'essence', text: '星雲之面貌取決於恆星之照射與塵埃之多寡', claims: ['C1', 'C3'], reason: '納入反射星雲之觀測' },
})
/** 各操作之目標(套用後之狀態判讀用) */
const TARGET = Object.freeze({ supersede: 'C3', retract: 'C2', merge: 'C3', dispute_dissolve: 'D1', split: 'C4' })
/** 只能於整併模式之操作(merge 不在 DELTA_OPS) */
const modeOf = (op) => (DELTA_OPS.includes(op) ? 'delta' : 'consolidate')
/** 同一差量內與不可逆操作並列之建設性操作(終審明列 keep;使「漏裁決」不致變成「一條有效裁決都沒有」) */
const CONFIRM = Object.freeze({ op: 'confirm', id: 'C1', sources: ['N1'] })
/** 出處支持覆核(ES9)之席位 */
const CHECK = Object.freeze({ seats: { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } } })

/**
 * 跑一次 3+3(單一 pass):第一席起草 ops、其餘兩席失敗,整合原樣收入(via 指回)、審計無意見,終審以 acc 回覆
 *
 * @param {Array} ops 輸入起草之操作
 * @param {*} acc 輸入終審席之回覆(JSON、(prompt)=>JSON 或 'fail')
 * @param {Object} [o={}] 輸入 { mode, state, supportCheck, log, more(其他席位之回覆) }
 * @returns {Promise<Object>} 回傳 runPass 之結果
 */
function passOf(ops, acc, o = {}) {
    const { more, ...rest } = o
    const mode = rest.mode || 'delta'
    const ai = fakeAi({ d1: { ops, skipped: [] }, d2: 'fail', d3: 'fail', int: { ops: ops.map((x, k) => ({ ...x, via: [`a1_${k + 1}`] })), skipped: [] }, aud: { issues: [] }, acc, ...(more || {}) })
    return runPass({ concept: '星雲', domain: DOMAIN, seats: SEATS, ai, notesById: NOTES, at: AT, ...rest, state: rest.state || baseState(), mode, batch: mode === 'consolidate' ? [] : BATCH })
}

/** 條目之狀態(主張、爭議) */
const statusOf = (s, id) => findItem(s, id)?.item?.status

/**
 * 以 3+3 替身(draftAll)於知識庫環境造一個核心(三篇筆記各一條 rule,本質引第一條)
 *
 * @param {Object} env 輸入 mkEnv 之環境
 * @returns {Promise<Object>} 回傳核心記錄
 */
async function seedNebula(env) {
    await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
    return (await env.stores.cores.select())[0]
}

/**
 * 不合格之內容(兩契約共用之同一種):指定主張之文字含簡體(ES3)且缺銳評(ES4)
 *
 * @param {Object} s 輸入核心狀態
 * @param {String} id 輸入主張 id
 * @param {String} text 輸入改寫後之文字(含簡體字)
 * @returns {Object} 回傳新狀態(不修改輸入)
 */
function withBadClaim(s, id, text) {
    const t = structuredClone(s)
    const c = t.claims.find((x) => x.id === id)
    c.text = text
    c.critique = ''
    return t
}

// ═══════════════════════ 涵蓋表 ═══════════════════════

/** 處境(鍵 → 名) */
const SITUATIONS = Object.freeze({ apply: '套用', pending: '待審', reject: '拒絕', restore: '還原' })
/** 表之操作集:原始碼之不可逆操作全集＋本質重寫(派工另列) */
const TABLE_OPS = Object.freeze([...TERMINAL_OPS, 'essence'])
const F = Object.freeze({
    stage: 'test/unit-extract-stage.test.mjs',
    wf: 'test/unit-extract-workflow.test.mjs',
    core: 'test/unit-core-state.test.mjs',
    std: 'test/unit-extract-opstandards.test.mjs',
    stock: 'test/unit-extract-stockfix.test.mjs',
})
/** 本檔之最小案(it 標題之子字串) */
const H = Object.freeze({
    apply: '終審逐條明列 keep → 落盤',
    reject: '終審 drop → 不套用、不入待審',
    pending: '提煉批次之不可逆操作漏裁決 → 存待審',
    essencePending: '本質非不可逆操作',
    noInverse: '無逆操作——終態轉回即違反不變式',
    undo: 'rollbackCoreStockFix:不過納入閘亦不驗不變式',
    revive: 'reviveClaims:過閘 REVIVE_GATE_STDS',
})
const NO_INVERSE_TERMINAL = '無逆操作：終態(superseded／retracted)不可逆(stores/coreState 檔頭【操作語意】⑤;不變式「終態項被改動」,EXT-02);'
    + '唯一例外為可還原之撤回(⑱ reviveItems,只收 REVIVABLE_RETRACT 之主張);存量處置之修法只 ES3／ES5(CORE_FIX_STDS),'
    + '其回退不涉終態操作,其後之改寫只報衝突、不覆寫(stockFix 檔頭【回退＝撤銷】);README §13〈無逆操作之件〉之人工取回(regenCore 之封存)為唯一出路'

/**
 * 涵蓋表(凍結):每格 { op, at, refs };refs 之一筆為 { file, it }(既有案;it 為該檔 it 標題之子字串)、{ here }(本檔之案)、
 *   { na }(不適用／無逆操作之依據;以「不適用：」或「無逆操作：」起頭);note 為補充說明
 *
 * @type {Array}
 */
const COVERAGE = Object.freeze([
    // ── 取代(supersede) ──
    { op: 'supersede', at: 'apply', refs: [{ here: H.apply }, { file: F.stage, it: '無新筆記時另排待審專步交終審席裁決', note: '待審裁決之終審席 keep → superseded' }, { file: F.wf, it: '不變式剔除之日誌列出被剔之操作與編號', note: '3+3 終審 keep 被本質引用之主張之取代' }] },
    { op: 'supersede', at: 'pending', refs: [{ here: H.pending }, { file: F.stage, it: '提煉批次之取代改存待審' }, { file: F.wf, it: '終審失敗則破壞性操作存待審' }] },
    { op: 'supersede', at: 'reject', refs: [{ here: H.reject }, { file: F.wf, it: '剔除破壞性操作一律放行' }] },
    { op: 'supersede', at: 'restore', refs: [{ na: NO_INVERSE_TERMINAL }, { here: H.noInverse }, { file: F.stock, it: '不覆寫、不記回退列', note: '處置後被改寫(如其後之取代)→ 回退只報衝突' }] },
    // ── 撤回(retract) ──
    { op: 'retract', at: 'apply', refs: [{ here: H.apply }, { file: F.stage, it: '不受支持撤回', note: '程式差量(ES9 存量)之撤回,非終審' }] },
    { op: 'retract', at: 'pending', refs: [{ here: H.pending }, { file: F.wf, it: '待審逾上限丟最舊', note: '終審失敗 → 撤回存待審,逾上限丟最舊之提案' }] },
    { op: 'retract', at: 'reject', refs: [{ here: H.reject }, { file: F.std, it: '不得有流程用語', note: '理由外洩 → 納入閘不採' }, { file: F.std, it: '守門之拒收與納入閘之不合皆入 rejected', note: '只見索引行之目標 → 守門拒' }] },
    {
        op: 'retract', at: 'restore', refs: [
            { here: H.revive }, { file: F.stage, it: '存量覆核撤回之主張 → 還原' }, { file: F.stage, it: '還原後不過檢定標準子集' }, { file: F.stage, it: '出處筆記還原即還原', note: 'ES8 之撤回於出處筆記還原時由維護還原' },
            { na: '無逆操作：AI 差量之撤回(RETRACT_REASONS:離題、無出處支持、同篇誤配、重複)不可還原——reviveItems 只收 REVIVABLE_RETRACT(程式撤回之理由;coreState ⑱、ops/reviveClaims【規則】①)' },
            { here: H.noInverse },
        ],
    },
    // ── 合併(merge;只在整併模式) ──
    { op: 'merge', at: 'apply', refs: [{ here: H.apply }, { file: F.stage, it: '整併嘗試記入失敗帳' }, { file: F.wf, it: '覆核合併稿' }] },
    {
        op: 'merge', at: 'pending', refs: [
            { na: '不適用：merge 只在整併模式(CONSOLIDATE_OPS;不在 DELTA_OPS)——整併之不可逆操作漏裁決本次不採、終審失敗整份不套、出處支持覆核未完成本次不採(workflow/runPass 終審段「整併之不可逆操作不入待審」與出處支持段);待審裁決以增量模式套用(workflow/pending 之 applyCtx mode delta),merge 不在其操作集' },
            { here: H.pending }, { file: F.stage, it: '整併之合併本次不採' }, { file: F.wf, it: '無待審可存' },
        ],
    },
    { op: 'merge', at: 'reject', refs: [{ here: H.reject }, { file: F.wf, it: '覆核合併稿', note: '合併稿不受出處支持 → 不採' }] },
    { op: 'merge', at: 'restore', refs: [{ na: NO_INVERSE_TERMINAL }, { here: H.noInverse }] },
    // ── 拆解(dispute_dissolve) ──
    { op: 'dispute_dissolve', at: 'apply', refs: [{ here: H.apply }, { file: F.stage, it: '拆解硬配之爭議', note: '待審裁決之終審席 keep → 爭議入沿革' }, { file: F.stage, it: '經納入閘拆解', note: '爭議覆核(ES14)判非對立 → 經納入閘拆解' }] },
    { op: 'dispute_dissolve', at: 'pending', refs: [{ here: H.pending }, { file: F.stage, it: '拆解硬配之爭議' }, { file: F.core, it: '拆解之拒收', note: '終審失敗時暫緩(withhold)' }] },
    { op: 'dispute_dissolve', at: 'reject', refs: [{ here: H.reject }, { file: F.core, it: '拆解之拒收' }] },
    { op: 'dispute_dissolve', at: 'restore', refs: [{ na: `${NO_INVERSE_TERMINAL};拆解後爭議之撤回理由「非對立」(DISSOLVED_RETRACT_REASON)不在可還原之列,reviveClaims 亦只還原主張` }, { here: H.noInverse }] },
    // ── 拆分(split) ──
    { op: 'split', at: 'apply', refs: [{ here: H.apply }, { file: F.core, it: '新條沿用原條之出處', note: 'applyDelta 層之語意' }] },
    { op: 'split', at: 'pending', refs: [{ here: H.pending }, { file: F.core, it: '各條須為原文之子集', note: 'applyDelta 層:為不可逆操作(可暫緩)' }] },
    { op: 'split', at: 'reject', refs: [{ here: H.reject }, { file: F.core, it: '各條須為原文之子集' }, { file: F.std, it: '拆分各部之主張亦檢' }] },
    { op: 'split', at: 'restore', refs: [{ na: NO_INVERSE_TERMINAL }, { here: H.noInverse }] },
    // ── 本質重寫(essence;核心已有本質時之改寫;原始碼不列為不可逆) ──
    { op: 'essence', at: 'apply', refs: [{ here: H.apply }, { file: F.core, it: '重寫 essence 即解除 stale', note: 'applyDelta 層之語意' }] },
    { op: 'essence', at: 'pending', refs: [{ here: H.essencePending }] },
    { op: 'essence', at: 'reject', refs: [{ here: H.reject }, { file: F.core, it: '本質為硬上限' }, { file: F.wf, it: '補丁使本質由合格變超限' }] },
    {
        op: 'essence', at: 'restore', refs: [
            { here: H.undo, note: '存量處置(ES3)之本質改寫由回退寫回' }, { file: F.stock, it: '回退寫回處置前之狀態' },
            { na: '無逆操作：3+3 之本質改寫無程式之逆——前一版只入本質沿革(不變式「本質改寫未入沿革」;coreState checkInvariants)供人工取回;還原撤回亦不改回本質(ops/reviveClaims【規則】③「本質不自動改回,由本質專步重寫」)' },
        ],
    },
].map((row) => Object.freeze({ ...row, refs: Object.freeze(row.refs.map((r) => Object.freeze({ ...r }))) })))

/**
 * 檔內各 it 之標題字面(只認 it 呼叫之第一個引數為單引號、雙引號或反引號之字串字面者)
 *
 * @param {String} text 輸入原始碼
 * @returns {Array} 回傳標題字串陣列(跳脫字元原樣)
 */
function itTitlesOf(text) {
    return [...String(text || '').matchAll(/\bit\(\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g)].map((m) => m[2])
}

/**
 * 涵蓋表之判準(同一函數判真表與合成之表):缺格、重複格、未知之格、無對應、對應形狀不合、不適用無依據;給了 textOf 時另驗
 *   既有案之檔存在且檔內恰有一個 it 標題含該子字串(本檔之案以 selfFile 驗)
 *
 * @param {Array} table 輸入涵蓋表
 * @param {Object} o 輸入 { ops:Array, situations:Array(處境鍵), textOf?:(file)=>String|null, selfFile?:String }
 * @returns {Array} 回傳問題字串陣列(空＝合規)
 */
function coverageProblemsOf(table, o) {
    const out = []
    const cells = new Map()
    for (const row of Array.isArray(table) ? table : []) {
        const key = `${row?.op}×${row?.at}`
        if (!o.ops.includes(row?.op) || !o.situations.includes(row?.at)) {
            out.push(`未知之格：${key}`)
            continue
        }
        if (cells.has(key)) out.push(`重複格：${key}`)
        cells.set(key, row)
        const refs = Array.isArray(row.refs) ? row.refs : []
        if (!refs.length) out.push(`無對應：${key}`)
        for (const r of refs) {
            const kinds = ['file', 'here', 'na'].filter((k) => r?.[k] !== undefined)
            if (kinds.length !== 1 || (kinds[0] === 'file' && typeof r.it !== 'string')) {
                out.push(`對應形狀不合：${key}`)
                continue
            }
            if (kinds[0] === 'na') {
                if (!/^(不適用|無逆操作)：\S/.test(String(r.na))) out.push(`不適用無依據：${key}`)
                continue
            }
            if (typeof o.textOf !== 'function') continue
            const file = kinds[0] === 'here' ? o.selfFile : r.file
            const sub = kinds[0] === 'here' ? r.here : r.it
            const text = o.textOf(file)
            if (text === null || text === undefined) {
                out.push(`檔不存在：${key}｜${file}`)
                continue
            }
            const n = itTitlesOf(text).filter((t) => String(sub) && t.includes(String(sub))).length
            if (n === 0) out.push(`找不到 it：${key}｜${file}｜${sub}`)
            else if (n > 1) out.push(`it 不唯一：${key}｜${file}｜${sub}（${n} 個）`)
        }
    }
    for (const op of o.ops) for (const at of o.situations) if (!cells.has(`${op}×${at}`)) out.push(`缺格：${op}×${at}`)
    return out
}

/** 自套件根讀檔(不存在回 null) */
const pkgTextOf = (file) => {
    const p = path.join(PKG_ROOT, file)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

describe('unit-extract-irreversible', function() {

    before(() => {
        TMP = tmpRoot('extract-irreversible')
        mkEnv = mkEnvIn(TMP)
        resetConceptFold()
    })

    after(() => {
        removeRoots([TMP])
    })

    describe('操作全集', function() {

        it('操作全集:不可逆操作取 TERMINAL_OPS(取代、撤回、合併、拆解、拆分),皆為破壞性操作;本質重寫為建設性操作、不在不可逆集合;合併只在整併模式', () => {
            // 規則(coreState TERMINAL_OP_LABELS):終態操作之中文名與 TERMINAL_OPS 同一來源(提示詞之不可逆清單由之產生)
            assert.deepEqual(Object.keys(TERMINAL_OP_LABELS), [...TERMINAL_OPS])
            // 規則(派工之清單對原始碼):取代、撤回、合併、拆解、拆分即原始碼之不可逆全集
            assert.deepEqual(TERMINAL_OPS.map((op) => TERMINAL_OP_LABELS[op]), ['取代', '撤回', '合併', '拆解', '拆分'])
            // 規則(runPass 終審段:終審失敗 → 破壞性存待審;opGuards【補丁守門依操作類別映射】):不可逆操作皆為破壞性
            assert.deepEqual(TERMINAL_OPS.filter((op) => !DESTRUCTIVE_OPS.has(op) || opClass({ op }) !== 'destructive'), [])
            // 規則(opGuards CONSTRUCTIVE_OPS):essence 為建設性操作、不在不可逆集合(故不須明列裁決、終審失敗照套)
            assert.deepEqual([CONSTRUCTIVE_OPS.has('essence'), TERMINAL_OPS.includes('essence'), opClass({ op: 'essence' })], [true, false, 'constructive'])
            // 規則(coreState DELTA_OPS／CONSOLIDATE_OPS):merge 只在整併模式;split 兩模式皆可(待審裁決以增量模式套用)
            assert.deepEqual([DELTA_OPS.includes('merge'), CONSOLIDATE_OPS.includes('merge'), DELTA_OPS.includes('split'), CONSOLIDATE_OPS.includes('split')], [false, true, true, true])
        })
    })

    describe('格之最小案(3+3 替身;不呼叫真模型)', function() {

        it('格〔取代／撤回／合併／拆解／拆分／本質重寫 × 套用〕:終審逐條明列 keep → 落盤(終態生效、本質改寫入沿革)、不入待審', async () => {
            const base = baseState()
            const out = {}
            for (const op of TABLE_OPS) {
                const r = await passOf([OPS[op]], keepAll, { mode: modeOf(op) })
                // 規則(EXT-28):終審有有效裁決 → pass 完成
                assert.equal(r.ok, true, `${op}：${r.error}`)
                // 規則(EXT-10、coreState TERMINAL_OPS):終審明列 keep 之不可逆操作照套
                assert.ok(r.applied.some((a) => a.op === op), `${op}：${JSON.stringify(r.rejected)}`)
                // 規則(EXT-10):明列裁決者不存待審
                assert.equal((r.state.pendingReview || []).length, 0, op)
                out[op] = r.state
            }
            const st = (op) => out[op]
            const sp = st('supersede')
            // 規則(coreState ⑤):取代轉終態 superseded,記舊觀點成立期間
            assert.deepEqual([statusOf(sp, 'C3'), findItem(sp, 'C3').item.validPeriod], ['superseded', '較早之觀測'])
            const rt = st('retract')
            // 規則(coreState ⑤):撤回轉終態 retracted,理由在 RETRACT_REASONS
            assert.deepEqual([statusOf(rt, 'C2'), findItem(rt, 'C2').item.retractReason], ['retracted', '離題'])
            const mg = st('merge')
            // 規則(coreState ⑪):被併者為 superseded＋mergedInto
            assert.deepEqual([statusOf(mg, 'C3'), findItem(mg, 'C3').item.mergedInto], ['superseded', 'C2'])
            const ds = st('dispute_dissolve')
            // 規則(coreState ⑧):拆解使爭議轉終態(理由「非對立」)、引主張之方回 active
            assert.deepEqual([statusOf(ds, 'D1'), findItem(ds, 'D1').item.retractReason, statusOf(ds, 'C1')], ['retracted', DISSOLVED_RETRACT_REASON, 'active'])
            const sl = st('split')
            const into = findItem(sl, 'C4').item.splitInto
            // 規則(coreState ⑫):原條轉終態(splitInto)、拆出條為有效主張
            assert.deepEqual([statusOf(sl, 'C4'), into.length, into.map((id) => statusOf(sl, id))], ['superseded', 2, ['active', 'active']])
            const es = st('essence')
            // 規則(coreState 不變式「本質改寫須入沿革」):改寫既有本質 → 新文字生效、前一版入本質沿革
            assert.deepEqual([es.essence.text, es.essenceHistory.at(-1).text, base.essence.text], [OPS.essence.text, OLD_ESSENCE, OLD_ESSENCE])
        })

        it('格〔取代／撤回／合併／拆解／拆分／本質重寫 × 拒絕〕:終審 drop → 不套用、不入待審、目標維持原狀(剔除破壞性操作放行＝保住既有知識;剔除建設性之本質只准「重複」等理由)', async () => {
            const base = baseState()
            const reasonOf = { dispute_dissolve: '對立成立', essence: '重複' }
            for (const op of TABLE_OPS) {
                const r = await passOf([OPS[op]], verdictOn(() => true, { action: 'drop', reason: reasonOf[op] || '無出處支持' }), { mode: modeOf(op) })
                // 規則(EXT-28):剔除亦為有效裁決 → pass 完成(不是終審失敗)
                assert.equal(r.ok, true, `${op}：${r.error}`)
                // 規則(opGuards【補丁守門依操作類別映射】、runPass 終審段):剔除破壞性操作一律放行;剔除建設性操作以「重複」放行 → 裁決成立
                assert.deepEqual([r.verdicts.dropped.length, r.stats.verdictBlocked || 0], [1, 0], op)
                // 規則(EXT-10):被剔除者不套用、亦不存待審
                assert.deepEqual([r.applied.filter((a) => a.op === op).length, (r.state.pendingReview || []).length], [0, 0], op)
                // 規則(opGuards【補丁守門依操作類別映射】):剔除破壞性操作＝舊知識被保住(目標維持原狀);本質不被改寫
                if (op === 'essence') assert.equal(r.state.essence.text, OLD_ESSENCE)
                else assert.equal(statusOf(r.state, TARGET[op]), statusOf(base, TARGET[op]), op)
            }
        })

        it('格〔取代／撤回／拆解／拆分 × 待審〕:提煉批次之不可逆操作漏裁決 → 存待審(終審未明列裁決)、終審失敗 → 存待審(終審失敗);整併之合併與拆分漏裁決 → 本次不採、不入待審', async () => {
            const base = baseState()
            const keepConfirm = verdictOn((x) => x.op === 'confirm', { action: 'keep' }, true)
            for (const op of TERMINAL_OPS.filter((x) => modeOf(x) === 'delta')) {
                const lines = []
                const r = await passOf([OPS[op], CONFIRM], keepConfirm, { log: (l) => lines.push(l) })
                // 規則(EXT-28):有一條有效裁決(confirm 之 keep)→ 不是終審失敗,pass 完成
                assert.equal(r.ok, true, `${op}：${r.error}`)
                // 規則(runPass 終審段、EXT-10):不可逆操作須明列裁決;未列者視為未審、本次不套用——一般差量存待審(理由「終審未明列裁決」)
                assert.deepEqual(r.state.pendingReview.map((e) => [e.op.op, e.reason]), [[op, '終審未明列裁決']], op)
                // 規則(workflow/pending 檔頭:不把未審之不可逆變更套進真理):目標維持原狀
                assert.equal(statusOf(r.state, TARGET[op]), statusOf(base, TARGET[op]), `${op}：未審之不可逆操作不套用`)
                // 規則(runPass 終審段:未得裁決者記日誌,一般差量為「擬存待審」)
                assert.ok(lines.includes('提煉終審[星雲]：1 項不可逆操作未得裁決，擬存待審'), lines.join('\n'))
                // 規則(domain 之終審提示詞:其餘操作未列出者視為 keep):同差量之建設性操作照套
                assert.ok(r.applied.some((a) => a.op === 'confirm'), op)
                const f = await passOf([OPS[op], CONFIRM], 'fail')
                // 規則(runPass 終審段:終審失敗 → 一般差量建設性照套、破壞性存待審;EXT-28)
                assert.deepEqual([f.state.pendingReview.map((e) => [e.op.op, e.reason]), statusOf(f.state, TARGET[op]), f.applied.some((a) => a.op === 'confirm')], [[[op, '終審失敗']], statusOf(base, TARGET[op]), true], op)
                // 規則(workflow/pending 檔頭):待審者下次交終審席裁決——待審之操作可由 pendingReviewOps 取出(目標仍有效,非陳舊項)
                assert.deepEqual([pendingReviewOps(f.state).ops.map((x) => x.op), pendingReviewOps(f.state).stale.length], [[op], 0], op)
            }
            // 整併:合併與拆分各漏裁決一次
            for (const [omit, keep] of [['merge', 'split'], ['split', 'merge']]) {
                const lines = []
                const r = await passOf([OPS.split, OPS.merge], verdictOn((x) => x.op === keep, { action: 'keep' }, true), { mode: 'consolidate', log: (l) => lines.push(l) })
                // 規則(EXT-28):有一條有效裁決 → 不是終審失敗(整併不致整份不套)
                assert.equal(r.ok, true, r.error)
                // 規則(runPass 終審段):整併之不可逆操作不入待審(待審以一般差量裁決),本次不採、下次再提
                assert.deepEqual([(r.state.pendingReview || []).length, statusOf(r.state, TARGET[omit]), r.applied.map((a) => a.op)], [0, statusOf(base, TARGET[omit]), [keep]], `漏裁決 ${omit}`)
                // 規則(runPass 終審段:整併之未得裁決者記「本次不採」)
                assert.ok(lines.includes('提煉終審[星雲]：1 項不可逆操作未得裁決，本次不採'), lines.join('\n'))
            }
        })

        it('格〔本質重寫 × 待審〕:本質非不可逆操作——終審失敗照套、漏裁決視為 keep;唯所引新主張之出處支持覆核未完成時依閉包一併存待審', async () => {
            // 規則(runPass 終審段:終審失敗 → 建設性照套;essence 為建設性):本質改寫不存待審
            const f = await passOf([OPS.essence], 'fail')
            assert.deepEqual([f.ok, f.state.essence.text, (f.state.pendingReview || []).length], [true, OPS.essence.text, 0])
            // 規則(runPass 終審段):終審失敗記入降級(此案確為終審失敗之路徑)
            assert.ok(f.degrade.some((d) => d.includes('終審失敗')), f.degrade.join('；'))
            // 規則(domain 之終審提示詞:不可逆操作以外未列出者視為 keep):漏裁決之本質改寫照套
            const u = await passOf([OPS.essence, CONFIRM], verdictOn((x) => x.op === 'confirm', { action: 'keep' }, true))
            assert.deepEqual([u.ok, u.state.essence.text, (u.state.pendingReview || []).length], [true, OPS.essence.text, 0])
            // 規則(supportGate【分流】infra、supportHoldClosure;原則 3):所引新主張之覆核為基礎設施未成立 → 新主張與引用其 ref 之本質一併存待審(理由「出處支持覆核未完成」)
            const add = { op: 'add', ref: 'x', kind: 'rule', text: '星雲之塵埃會吸收紫外線', basis: '觀測', sources: ['N1'], ...ANN }
            const ess = { ...OPS.essence, claims: ['C1', '@x'] }
            const c = await passOf([add, ess], keepAll, { supportCheck: CHECK, more: { ck1: 'fail', ck2: 'fail' } })
            // 規則(原則 3:基礎設施失敗不計失敗)→ pass 完成
            assert.equal(c.ok, true, c.error)
            // 規則(supportGate【分流】infra、runPass 出處支持段之留待閉包)
            assert.deepEqual(c.state.pendingReview.map((e) => [e.op.op, e.reason]), [['add', '出處支持覆核未完成'], ['essence', '出處支持覆核未完成']])
            // 規則(coreDelta applyDelta:所依之新項同為暫緩者保留 @ref——同入待審、裁決時同一差量內可解析;ref 名經候選之席位前綴);本質不改寫
            assert.deepEqual([c.state.pendingReview[1].op.claims, c.state.essence.text], [['C1', `@${c.state.pendingReview[0].op.ref}`], OLD_ESSENCE])
        })

        it('格〔取代／合併／拆解／拆分 × 還原〕與 AI 撤回之還原:無逆操作——終態轉回即違反不變式「終態項被改動」、reviveItems 不收;可還原之撤回(程式撤回)為唯一例外', () => {
            const base = baseState()
            const cases = [...TERMINAL_OPS].map((op) => ({ op, id: TARGET[op] }))
            for (const { op, id } of cases) {
                const mode = modeOf(op)
                const r = applyDelta(base, { ops: [OPS[op]] }, { batch: mode === 'delta' ? BATCH : [], mode, at: AT })
                // 前提(coreState 【操作語意】⑤⑧⑪⑫):各不可逆操作合規 → 套用
                assert.deepEqual(r.rejected, [], op)
                const st = commitBatch(r.state, coverageOf({ batch: mode === 'delta' ? BATCH : [], applied: r.applied }))
                const was = statusOf(st, id)
                // 規則(coreState ⑤):終態為 superseded／retracted
                assert.ok(['superseded', 'retracted'].includes(was), `${op}：${was}`)
                // 規則(coreState ⑱ reviveItems):只還原 status retracted 且理由在 REVIVABLE_RETRACT 之主張——取代、合併、拆分、拆解與 AI 撤回皆不收
                assert.deepEqual(reviveItems(st, [id], { at: AT, why: '試還原' }).revived, [], op)
                // 規則(coreState ⑤、checkInvariants「終態不可逆」;EXT-02):把終態項轉回有效(即使記了 revive 沿革)即違反不變式
                const back = structuredClone(st)
                const item = findItem(back, id).item
                Object.assign(item, { status: id.startsWith('D') ? 'open' : 'active', retractReason: '', statusNote: '' })
                item.history = [...(item.history || []), { version: st.version + 1, at: AT, op: 'revive', note: '試還原' }]
                back.version = st.version + 1
                back.changelog = [...back.changelog, { version: back.version, at: AT, mode: 'revive' }]
                assert.ok(checkInvariants(st, back, { touched: [id] }).includes(`終態項被改動：${id}`), op)
            }
            // 規則(coreState ⑱):程式撤回(可還原之理由)之還原為終態不可逆之唯一例外——還原後不變式成立
            const p = applyDelta(base, { ops: [{ op: 'retract', id: 'C2', reason: '覆核無出處支持' }] }, { batch: [], at: AT, program: true, onlyOps: ['retract'] })
            // 前提(coreState ⑱):程式差量可用 PROGRAM_RETRACT_REASONS
            assert.deepEqual(p.rejected, [])
            const rv = reviveItems(p.state, ['C2'], { at: AT, why: '使用者裁示' })
            assert.deepEqual([rv.revived, statusOf(rv.state, 'C2'), checkInvariants(p.state, rv.state, { touched: rv.revived })], [['C2'], 'active', []])
            // 規則(stockFix 檔頭【目標取自符合度掃描】):存量處置之修法只 ES3／ES5——其回退不涉終態操作
            assert.deepEqual([...CORE_FIX_STDS].sort(), ['ES3', 'ES5'])
        })
    })

    describe('兩契約(原則 1:撤銷與重新收件是兩種契約)', function() {

        it('契約〔撤銷〕rollbackCoreStockFix:不過納入閘亦不驗不變式——處置前含不合格內容(缺銳評 ES4、簡體 ES3)之狀態照樣寫回;本質之存量改寫一併撤銷', async () => {
            const env = mkEnv(['x1', 'x2', 'x3'].map((id) => ({ id, concepts: ['星雲'] })))
            const rec = await seedNebula(env)
            const file = `${env.dirs.coreState}/${rec.id}.state.json`
            const bad = withBadClaim(readState(env, rec.id), 'C2', '主張 x2 之观测')
            bad.essence = { ...bad.essence, text: '本质文字' }
            fs.writeFileSync(file, JSON.stringify(bad), 'utf8')
            const deps = { stores: env.stores, dirs: env.dirs, domain: env.domains.extract, clock: fixedClock('2026-10-30') }
            const plan = await planCoreStockFix(deps, { stds: ['ES3'], at: AT })
            // 規則(stockFix 檔頭):ES3 → 確定性修正(條目與本質之文字欄只改違規處)
            assert.deepEqual(plan.items.map((x) => [x.id, x.stds]), [[rec.id, ['ES3']]])
            const r = await applyCoreStockFix(deps, plan, { at: AT })
            // 規則(stockFix 檔頭【寫入】):核心經同一落盤路徑寫入、先記帳列
            assert.deepEqual([r.applied, r.errors], [[{ id: rec.id, stds: ['ES3'] }], []])
            const after = readState(env, rec.id)
            const c2a = findItem(after, 'C2').item
            // 規則(stockFix 檔頭【修不了者】):可修者只 ES3／ES5——缺銳評(ES4)不在可修之列,處置後仍缺;本質之簡體一併轉正體
            assert.deepEqual([c2a.text, c2a.critique, after.essence.text], ['主張 x2 之觀測', '', '本質文字'])
            const rb = await rollbackCoreStockFix({ ...deps, clock: fixedClock('2026-10-31') }, readCoreStockLedger(path.join(env.dirs.state, STOCK_LEDGER_FILE)))
            // 規則(stockFix【回退＝撤銷】):現值仍為該次處置之結果(內容指紋＝after.hash)才寫回處置前
            assert.deepEqual([rb.restored, rb.conflicts, rb.errors], [1, [], []])
            const back = readState(env, rec.id)
            const c2b = findItem(back, 'C2').item
            // 規則(CLAUDE.md 原則 1):回退＝撤銷該次處置之效果——處置前之內容原樣寫回(簡體、缺銳評),本質亦回到處置前
            assert.deepEqual([c2b.text, c2b.critique, back.essence.text], ['主張 x2 之观测', '', '本质文字'])
            // 規則(registry【不經納入閘之寫入入口】):回退不是新進——寫回之條目在檢定標準之同一判定(checkCore)下不合格(ES3、ES4),回退照寫
            const stds = checkCore(back, {}).filter((x) => x.field === 'C2' && x.status === STATUS.VIOLATION).map((x) => x.std)
            assert.deepEqual(['ES3', 'ES4'].filter((s) => stds.includes(s)), ['ES3', 'ES4'], stds.join('、'))
            // 規則(rollbackCoreStockFix JSDoc:同一落盤路徑之 restore,版號與沿革本就倒退,不驗不變式)——不變式若驗則必擋(版號倒退、本質沿革縮短)
            const inv = checkInvariants(after, back, { touched: ['C2'] })
            assert.ok(inv.some((x) => x.startsWith('版號跳動')) && inv.includes('本質沿革被改寫'), inv.join('；'))
            // 規則(EXT-24):回退列於不經納入閘之寫入入口,類別 undo
            assert.deepEqual(EXTRACT_UNGATED_WRITE_ENTRIES.filter((x) => x.entry.endsWith(':rollbackCoreStockFix')).map((x) => x.kind), ['undo'])
        })

        it('契約〔重新收件〕reviveClaims:過閘 REVIVE_GATE_STDS(ES2／ES4／ES12／ES13)——同一缺銳評之主張還原被擋、補齊銳評者照還原;ES3 不在閘', async () => {
            // 規則(reviveClaims【規則】②):閘＝檢定標準之子集 ES2 數字紮根、ES4 標注明示、ES12 跨篇、ES13 弱證據限制(ES17 為新進之閘、ES3 由存量處置)
            assert.deepEqual([...REVIVE_GATE_STDS], ['ES2', 'ES4', 'ES12', 'ES13'])
            const env = mkEnv(['y1', 'y2', 'y3'].map((id) => ({ id, concepts: ['星雲'] })))
            const rec = await seedNebula(env)
            const file = `${env.dirs.coreState}/${rec.id}.state.json`
            const bad = withBadClaim(readState(env, rec.id), 'C2', '主張 y2 之观测')
            const pr = applyDelta(bad, { ops: [{ op: 'retract', id: 'C2', reason: '覆核無出處支持' }, { op: 'retract', id: 'C3', reason: '覆核無出處支持' }] }, { batch: [], at: AT, program: true, onlyOps: ['retract'] })
            // 規則(coreState ⑱):程式差量可用可還原之撤回理由(前提)
            assert.deepEqual(pr.rejected, [])
            fs.writeFileSync(file, JSON.stringify(pr.state), 'utf8')
            const deps = { stores: env.stores, dirs: env.dirs, domain: env.domains.extract, clock: fixedClock('2026-10-30') }
            const r = await reviveClaims(deps, { core: rec.id, ids: ['C2', 'C3'], by: '值班員', ruling: '原文即載此觀測' })
            // 規則(reviveClaims【規則】②):擬還原者以還原後之狀態過閘——違反者不還原、逐條列 errors;其餘照還原
            assert.deepEqual([r.ok, r.revived, r.errors.map((e) => e.id)], [true, ['C3'], ['C2']])
            // 規則(reviveClaims【規則】②:使用者裁示不豁免內容標準):擋下之理由為 ES4;ES3(簡體)不在閘、不列
            assert.match(r.errors[0].why, /^還原後不過檢定標準（ES4：.+）——修正後再還原$/)
            // 規則(reviveClaims【規則】②:ES3 由存量處置,不在還原之閘)
            assert.doesNotMatch(r.errors[0].why, /ES3/)
            const s2 = readState(env, rec.id)
            // 規則(reviveClaims【規則】②):未過閘者不動(仍為撤回)
            assert.deepEqual([statusOf(s2, 'C2'), statusOf(s2, 'C3')], ['retracted', 'active'])
            // 補齊銳評(簡體照留)→ 同一條照還原:擋下之因只在閘之標準
            const fixed = structuredClone(s2)
            fixed.claims.find((c) => c.id === 'C2').critique = ANN.critique
            fs.writeFileSync(file, JSON.stringify(fixed), 'utf8')
            const r2 = await reviveClaims(deps, { core: rec.id, ids: ['C2'], by: '值班員', ruling: '補齊銳評後再還原' })
            // 規則(reviveClaims【規則】②):過閘者還原(沿革記 revive)
            assert.deepEqual([r2.ok, r2.revived, r2.errors], [true, ['C2'], []])
            const s3 = readState(env, rec.id)
            // 規則(reviveClaims【規則】④:主張之沿革記 revive);ES3 不在閘——簡體文字照留(交存量處置)
            assert.deepEqual([statusOf(s3, 'C2'), findItem(s3, 'C2').item.history.at(-1).op, findItem(s3, 'C2').item.text], ['active', 'revive', '主張 y2 之观测'])
        })
    })

    describe('涵蓋表之守門與判準自檢', function() {

        it('涵蓋表①完整性:操作 × 處境之全部格皆在表中、無重複格、每格皆有對應(既有案、本檔之案或附依據之不適用)', () => {
            // 規則(派工:每一格必須對應既有案、本檔之最小案或不適用＋依據;操作集取 TERMINAL_OPS——新增終態操作而表未補即紅)
            assert.deepEqual(coverageProblemsOf(COVERAGE, { ops: TABLE_OPS, situations: Object.keys(SITUATIONS) }), [])
            // 規則(同上):格數＝操作數 × 處境數
            assert.equal(COVERAGE.length, TABLE_OPS.length * Object.keys(SITUATIONS).length)
            // 規則(表為凍結之常數):不可就地改動
            assert.ok(Object.isFrozen(COVERAGE) && COVERAGE.every((r) => Object.isFrozen(r) && Object.isFrozen(r.refs)))
        })

        it('涵蓋表②既有案之引用:每列之檔存在且檔內恰有一個 it 標題含該子字串;本檔之案亦然', () => {
            // 規則(派工:(a) 類之 file 存在且檔內含該 it 子字串,只認 it 之標題字面;可唯一定位)
            assert.deepEqual(coverageProblemsOf(COVERAGE, { ops: TABLE_OPS, situations: Object.keys(SITUATIONS), textOf: pkgTextOf, selfFile: SELF }), [])
            // 規則(同上):表確有引用既有案與本檔之案(驗的不是空集合)
            const refs = COVERAGE.flatMap((r) => r.refs)
            assert.ok(refs.filter((x) => x.file).length >= 20 && refs.filter((x) => x.here).length >= 20, `既有案 ${refs.filter((x) => x.file).length}、本檔 ${refs.filter((x) => x.here).length}`)
        })

        it('涵蓋表③判準自檢:合成之表(缺一格、指向不存在之標題、重複格、標題不唯一、檔不存在、不適用無依據、無對應)各被抓到;合規之合成表不誤報', () => {
            // 合成之原始碼:以拼接造 it 呼叫之字面(避免本檔之原始碼自身出現合成之標題)
            const itLine = (title) => `${'i'}t('${title}', () => {})\n`
            const files = { 'test/f.test.mjs': itLine('甲案:一') + itLine('甲案:二') + itLine('乙案'), 'test/self.test.mjs': itLine('本檔丙案') }
            const o = { ops: ['a', 'b'], situations: ['x', 'y'], textOf: (f) => files[f] ?? null, selfFile: 'test/self.test.mjs' }
            const ok = [
                { op: 'a', at: 'x', refs: [{ file: 'test/f.test.mjs', it: '乙案' }] },
                { op: 'a', at: 'y', refs: [{ here: '本檔丙案' }] },
                { op: 'b', at: 'x', refs: [{ na: '不適用：依據某段原始碼' }] },
                { op: 'b', at: 'y', refs: [{ na: '無逆操作：依據某段檔頭' }] },
            ]
            const with1 = (k, row) => ok.map((r, i) => (i === k ? row : r))
            // 規則(判準自檢:合規之合成表不誤報)
            assert.deepEqual(coverageProblemsOf(ok, o), [])
            // 規則(完整性:缺一格即抓到)
            assert.deepEqual(coverageProblemsOf(ok.slice(0, 3), o), ['缺格：b×y'])
            // 規則(完整性:重複格即抓到)
            assert.deepEqual(coverageProblemsOf([...ok, ok[0]], o), ['重複格：a×x'])
            // 規則(引用:指向不存在之標題即抓到)
            assert.deepEqual(coverageProblemsOf(with1(0, { op: 'a', at: 'x', refs: [{ file: 'test/f.test.mjs', it: '不存在之標題' }] }), o), ['找不到 it：a×x｜test/f.test.mjs｜不存在之標題'])
            // 規則(引用:本檔之案亦驗)
            assert.deepEqual(coverageProblemsOf(with1(1, { op: 'a', at: 'y', refs: [{ here: '本檔無此案' }] }), o), ['找不到 it：a×y｜test/self.test.mjs｜本檔無此案'])
            // 規則(引用:子字串須可唯一定位)
            assert.deepEqual(coverageProblemsOf(with1(0, { op: 'a', at: 'x', refs: [{ file: 'test/f.test.mjs', it: '甲案' }] }), o), ['it 不唯一：a×x｜test/f.test.mjs｜甲案（2 個）'])
            // 規則(引用:檔須存在)
            assert.deepEqual(coverageProblemsOf(with1(0, { op: 'a', at: 'x', refs: [{ file: 'test/none.test.mjs', it: '乙案' }] }), o), ['檔不存在：a×x｜test/none.test.mjs'])
            // 規則(不適用須寫依據)
            assert.deepEqual(coverageProblemsOf(with1(2, { op: 'b', at: 'x', refs: [{ na: '' }] }), o), ['不適用無依據：b×x'])
            // 規則(每格須有對應)
            assert.deepEqual(coverageProblemsOf(with1(3, { op: 'b', at: 'y', refs: [] }), o), ['無對應：b×y'])
            // 規則(每筆對應只屬一類:既有案、本檔之案或不適用)
            assert.deepEqual(coverageProblemsOf(with1(3, { op: 'b', at: 'y', refs: [{ file: 'test/f.test.mjs', here: '本檔丙案', it: '乙案' }] }), o), ['對應形狀不合：b×y'])
            // 規則(格之操作與處境須在全集內)
            assert.deepEqual(coverageProblemsOf([...ok, { op: 'c', at: 'x', refs: [{ na: '不適用：x' }] }], o), ['未知之格：c×x'])
            // 規則(標題字面之讀法:只認 it 之第一個引數為字串字面者;跳脫之引號不截斷標題)
            assert.deepEqual(itTitlesOf(`${'i'}t('含 \\'引號\\' 之標題', () => {})\nsubm${'i'}t('非 it')\n${'i'}t(name, () => {})`), ["含 \\'引號\\' 之標題"])
        })
    })
})
