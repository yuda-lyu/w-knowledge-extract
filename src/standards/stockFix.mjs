// stockFix.mjs — 核心之檢定標準存量處置:預演(plan)→ 套用(apply;處置帳可回退)→ 連鎖斷言(verify)→ 回退(rollback)
//
// 【目標取自符合度掃描】與每輪掃描同一判定(standards/audit;範圍＝掃描之逐件判定標準 STOCK_STDS):只處置現行違反者(已豁免者不在其列)。
//   修法(standards/coreStockFix 之 coreFixOf;可修者只有 CORE_FIX_STDS):ES3 → 確定性修正(條目與本質之文字欄只改違規處;[[連結]] 與網址不轉;條目沿革記
//   存量處置、升一版);ES5 → 已見而無去向之衝突移出已見(記帳欄位,不升版;下輪重新呈現交提煉處置)。套用時逐核心以現值重算(已不須修者列 stale)。
// 【修不了者】確定性修正做不到者,與非可修標準之違反(ES1、ES4、ES6、ES12、ES13、ES15;讀材料時另含 ES2、ES16——預演之 unfixable,逐(標準,條目)列)
//   登錄使用者待判 core:<核心 id>:<標準>(同一核心同一標準一筆,原因列各條;期限 extractHoldDeadlineOf、下一步 EXTRACT_HOLD_NEXT.coreStock)。
//   已有未結或已豁免者不重登。符合度掃描以同一鍵把該核心該標準之判定記為已豁免(違反不再靜默;終審 §3 P2b)。已不再違反者(內容經提煉改寫等)
//   之未結登錄,由預演列出(resolvable)、套用結案——掃描唯讀、不會結案。
// 【狀態檔讀不了或尚未修復者】進不了計畫:預演另列 unreadable(不列修不了、不登錄待判——由提煉段之維護修復:壞檔隔離、自上一版落盤);套用、
//   連鎖斷言與回退以核心儲存之四態分流表(loadUsable)判可寫:不可寫者套用拒、斷言報 problem、回退拒(狀態檔與上一版皆不在者為核心不在,衝突)。
// 【寫入】核心經提煉段之同一落盤路徑(stores/coreProjection 之 coreWriterOf:證據重算、不變式、渲染、CAS、手改偵測、cores 記錄);先記帳列(before 之整份狀態、
//   預測之 after.rev、after.hash＝內容指紋)再寫;寫入失敗而狀態未變者附寫作廢列(讀帳即排除),狀態已寫而投影失敗者帳列留著(投影由提煉段之 dirty 補做)。
//   修不了以(標準,條目)粒度:修正後以 checkCore 重判,仍違反之條目才列修不了;套用時 unfixable／resolvable 以現值重驗(已不違反者不登錄、仍違反者不結案)。
// 【連鎖】ES10 之邊庫快照(提煉段之 EDGE_SEEN_FILE)隨關聯之字形修正換簽章:edgeSeenSyncOf 回傳之處理器掛於關聯之存量處置之套用與回退
//   (字形修正不是關聯之內容變更——不產生「理由已更新」之事件而觸發重審);快照原與舊值同步者才換,原本就不同步者不動。
// 【處置帳】抓取套件之帳協定(opt.ledgerFile;未給為 deps.dirs.state 下之 STOCK_LEDGER_FILE——四工作與宿主同一本帳,本模組只讀寫自己之列):
//   核心列 { at, object:'core', id, stds, changes, before:{ state(處置前之整份狀態) }, after:{ rev(處置後之版次) }, file };
//   待判列 { at, object:'hold', id:登錄鍵, stds, before:{ hold(登錄前之記錄｜null) }, hold:登錄鍵 };
//   結案列 { at, object:'hold-resolved', id:登錄鍵, stds, before:{ hold(結案前之登錄) }, hold:登錄鍵 };回退列 { at, rollbackOf, object, id }
//   (接受現值之取代列另帶 { accepted:'current', units })。讀帳(readCoreStockLedger)遇無法解析之列即拋(allowBad 才略過)。
//   待判之登錄、結案、回退與斷言取抓取套件之存量待判件。
// 【回退＝撤銷】只撤銷該次處置之效果:核心之現值仍為該次處置之結果(內容指紋＝after.hash;投影更新只升 rev 不改指紋)才寫回處置前(寫回前驗形);
//   其後被提煉或他次處置改寫者不覆寫而報衝突(使用者可以 acceptCurrent 接受現值結案);內容已回到處置前(指紋＝處置前)者視為已完成(可續作)。
//   缺 after 之核心列即錯;md 路徑取現行記錄(帳列之 file 為退路)。
// 【回退逐列】rollbackCoreStockFix 接受任意帳列(他模組之列略過:restored 0、不報錯):呼叫端依帳之全域逆序逐列交付,與他模組之列交錯時先後不變。
// 【呼叫端負責】取執行鎖、一致備份、使用者同意(正式庫)。本模組不取鎖、不呼叫 AI。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { strOf, STATUS, noteDocIdOf, jsonClone as clone } from '../core/capturePackage.mjs'
import { standardsFixProducedOf } from '../core/producedChain.mjs'
import { readMd } from '../core/summarizePackage.mjs'
import { EXTRACT_LEDGER_SHAPES, readLedgerJson, saveLedgerJson } from '../stores/extractFiles.mjs'
import {
    holdKey, stockLedgerFileOf, stockAtOf, stockLedgerRowsOf, stockLedgerWriter, appendRollbackRow, stockErrorOf,
    holdStockUnfixable, closeStockHold, rollbackStockHold, reopenStockHold, stockHoldProblems,
} from '../core/capturePackage.mjs'
import { createMaterialReader } from '../core/relatePackage.mjs'
import { CORE_FIX_STDS, coreFixOf, stateFingerprintOf } from './coreStockFix.mjs'
import { es5CtxOf, checkCore } from './coreStandards.mjs'
import { auditExtractStandards, EXTRACT_AUDITED_STANDARD_IDS } from './audit.mjs'
import { coreStoreOf } from '../stores/coreStore.mjs'
import { normalizeState } from '../stores/coreState.mjs'
import { isPrimaryCore } from '../stores/conceptSelection.mjs'
import { extractMaterialOf } from '../stores/noteFacts.mjs'
import { CORE_HOLD_OBJECT, EXTRACT_HOLD_NEXT, extractHoldDeadlineOf } from '../stores/extractHolds.mjs'
import { EDGE_SEEN_FILE, edgeSigOf } from './relationImpact.mjs'
import { coreWriterOf } from '../stores/coreProjection.mjs'

export { CORE_FIX_STDS }

/**
 * 存量處置涵蓋之標準:掃描範圍內之逐件判定者——可修者(CORE_FIX_STDS)以確定性修正,其餘之違反只列修不了(套用時登錄使用者待判;終審 §3 P2b)
 *
 * @type {Array}
 */
export const STOCK_STDS = EXTRACT_AUDITED_STANDARD_IDS


/**
 * 是否為本模組之帳列:核心列(標準皆為本模組可處置者)、核心物件之待判列與結案列(以登錄鍵前綴 core: 認,不限標準)
 *
 * @param {*} r 輸入帳列
 * @returns {Boolean} 回傳是否為本模組之列
 */
function isCoreRow(r) {
    if (!isobj(r) || r.rollbackOf) return false
    if (r.object === 'core') return isarr(r.stds) && r.stds.length > 0 && r.stds.every((s) => CORE_FIX_STDS.includes(s))
    return (r.object === 'hold' || r.object === 'hold-resolved') && strOf(r.hold || r.id).startsWith(`${CORE_HOLD_OBJECT}:`)
}

/**
 * 以現值判一核心某標準之結果(checkCore 之子集;修後重判、套用時之現值重驗、已不再違反之判定同用)
 *
 * @param {Object} state 輸入核心狀態
 * @param {String} std 輸入標準
 * @param {Object} ctx 輸入 checkCore 之 ctx(locale、ES5 之材料)
 * @returns {Array} 回傳該標準之判定結果
 */
const judgeOf = (state, std, ctx) => checkCore(state, ctx).filter((r) => r.std === std)

/**
 * 非可修標準之判定材料(與符合度掃描同一組:長度上限、證據判定與限制句、筆記之文件 id;要求讀材料時另給出處內容——ES2／ES16 之數字紮根)
 *
 * @param {Object} deps 輸入 { stores:{ notes }, domain }
 * @param {Boolean} material 輸入是否讀出處材料
 * @returns {Promise} 回傳 Promise，resolve 回傳 checkCore 之 ctx 片段
 */
async function judgeBaseOf(deps, material) {
    const notes = isfun(deps?.stores?.notes?.select) ? await deps.stores.notes.select() : []
    const noteById = new Map(notes.map((n) => [n.id, n]))
    const d = deps?.domain || {}
    return {
        limits: d.limits, evidence: d.evidence, weakEvidence: d.weakEvidence, docIdOf: (nid) => noteDocIdOf(noteById.get(nid)) || null,
        ...(material ? { contentOf: createMaterialReader({ notes, noteById, useMaterial: true, materialOf: null, onNote: null, textOf: extractMaterialOf }) } : {}),
    }
}

/**
 * ES5 之判定材料(與符合度掃描同一函數 es5CtxOf):讀全部邊與待判登錄
 *
 * @param {Object} deps 輸入 { stores:{ relations, holds? }, relateDomain }
 * @param {String} where 輸入呼叫處之名稱(錯誤訊息用)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { conflictEndsOf, rs4HeldOf }
 * @throws {Error} 缺 relations 之 select 或 relateDomain 時拋出
 */
async function es5Of(deps, where) {
    if (!isfun(deps?.stores?.relations?.select) || !isestr(deps?.relateDomain?.conflictType)) {
        throw new Error(`${where} 之 ES5 需要 deps.stores.relations（具 select 方法）與 deps.relateDomain（關聯 domain，衝突型之判定）`)
    }
    return es5CtxOf(await deps.stores.relations.select(), isfun(deps.stores.holds?.select) ? await deps.stores.holds.select() : null, deps.relateDomain)
}

/**
 * 預演:列出各核心之處置(不寫任何東西)
 *
 * @param {Object} deps 輸入 { stores:{ notes, cores, relations?(ES5), holds?(使用者豁免、已登錄之待判) }, dirs, domain(提煉 domain), relateDomain?(ES5), clock?,
 *   locale?(語言設定;ES3 之判定與修正依之,未給＝臺灣正體) }
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.stds] 輸入只處置這些標準(STOCK_STDS 之子集;未給或空陣列＝全部;其他 id 略過;可修者只有 CORE_FIX_STDS,其餘之違反列修不了)
 * @param {Array} [opt.ids] 輸入只處置這些核心 id
 * @param {Integer} [opt.limit] 輸入每種修正之標準組合至多幾個核心(正整數;依掃描之序;修不了者照列)
 * @param {Boolean} [opt.material=false] 輸入是否讀出處材料(ES2／ES16 之數字紮根須讀之;大庫耗時)
 * @param {String} [opt.at] 輸入預演時刻 ISO(預設 clock.iso8() 或現在;修正之沿革時刻)
 * @returns {Promise} 回傳 Promise,resolve 回傳 { at, stds, ids,
 *   items:[{ object:'core', id, stds, changes:[{ std, id, what }] }], unfixable:[{ id(掃描之 id), std, detail }],
 *   resolvable:[{ key, id(核心 id), std }](已不再違反之未結登錄;套用時結案),
 *   unreadable:[{ id(核心 id), status, why }](狀態檔讀不了或尚未修復而進不了計畫;不登錄待判——由提煉段之維護修復),
 *   counts:{ violations:{ 標準: 掃描之違反數 }, items, unfixable, resolvable, unreadable, fixes:{ 標準: 核心數 } } }
 * @throws {Error} deps.stores 缺 notes／cores 之 select、缺 dirs、domain,或範圍含 ES5 而缺 relations、relateDomain 時拋出
 * @example
 * need test in nodejs.
 *
 * const plan = await planCoreStockFix({ stores, dirs, domain, relateDomain }, { stds: ['ES3'] })
 * console.log(plan.items.map((x) => x.id), plan.unfixable)
 */
export async function planCoreStockFix(deps, opt = {}) {
    if (!isobj(opt)) opt = {}
    const stds = [...new Set((isarr(opt.stds) && opt.stds.length ? opt.stds : STOCK_STDS).filter((s) => STOCK_STDS.includes(s)))]
    const ids = isarr(opt.ids) && opt.ids.length ? new Set(opt.ids.map(strOf)) : null
    const limit = Number.isInteger(opt.limit) && opt.limit > 0 ? opt.limit : Infinity
    const at = stockAtOf(deps, opt)
    const items = []
    const unfixable = []
    const resolvable = []
    const unreadable = []
    const violations = {}
    const fixes = {}
    const done = () => ({ at, stds, ids: ids ? [...ids] : null, items, unfixable, resolvable, unreadable, counts: { violations, items: items.length, unfixable: unfixable.length, resolvable: resolvable.length, unreadable: unreadable.length, fixes } })
    if (!stds.length) return done()

    // 掃描(與每輪掃描同一判定;預設不讀材料——ES2／ES16 之數字紮根要求 opt.material 才判)
    const audit = await auditExtractStandards(deps, { only: stds, material: opt.material === true })
    const byCore = new Map()
    // 有違反或未能判定(含狀態檔讀不了)之核心:其未結登錄不可視為已不再違反
    const unclean = new Map(stds.map((s) => [s, new Set()]))
    for (const s of stds) {
        violations[s] = audit.standards[s]?.violation || 0
        for (const v of audit.standards[s]?.undetermineds || []) unclean.get(s).add(strOf(v.id).split('#')[0])
        for (const v of audit.standards[s]?.violations || []) {
            const cid = strOf(v.id).split('#')[0]
            unclean.get(s).add(cid)
            if (ids && !ids.has(cid)) continue
            if (!byCore.has(cid)) byCore.set(cid, [])
            byCore.get(cid).push({ std: s, id: v.id, detail: v.detail })
        }
    }
    const store = coreStoreOf(deps.dirs)
    const es5 = stds.includes('ES5') && (byCore.size || isfun(deps.stores?.holds?.select)) ? await es5Of(deps, 'planCoreStockFix') : {}
    const judgeCtx = { locale: deps.locale, ...(stds.some((s) => !CORE_FIX_STDS.includes(s)) ? await judgeBaseOf(deps, opt.material === true) : {}), ...es5 }
    const perKey = {}
    for (const [cid, vs] of byCore) {
        const lu = store.loadUsable(cid)
        if (!lu.writable) {
            // 讀不了或尚未修復者進不了計畫:不列修不了(不登錄待判——由提煉段之維護修復),另列供命令列呈現
            unreadable.push({ id: cid, status: lu.status, why: lu.why })
            continue
        }
        const myStds = [...new Set(vs.map((v) => v.std))]
        const fixStds = myStds.filter((s) => CORE_FIX_STDS.includes(s))
        const fix = fixStds.length ? coreFixOf(lu.state, { stds: fixStds, at, locale: deps.locale, ...es5 }) : { state: lu.state, changes: [] }
        // 修不了以(標準,條目)粒度:修正後重判,仍違反之條目才列(整個標準無修法者亦逐條目列)
        for (const s of myStds) {
            for (const r of judgeOf(fix.state, s, judgeCtx)) {
                if (r.status === STATUS.VIOLATION) unfixable.push({ id: r.field && r.field !== cid ? `${cid}#${r.field}` : cid, std: s, detail: r.detail })
            }
        }
        if (!fix.changes.length) continue
        const fixed = new Set(fix.changes.map((c) => c.std))
        const key = [...fixed].sort().join('+')
        perKey[key] = (perKey[key] || 0) + 1
        if (perKey[key] > limit) continue
        items.push({ object: 'core', id: cid, stds: [...fixed], changes: fix.changes })
        for (const s of fixed) fixes[s] = (fixes[s] || 0) + 1
    }

    // 已不再違反之未結登錄(核心物件;範圍內之標準、核心):只限本次掃描之主核心而該標準以現值重判全為合格者(無違反、無未能判定、無不適用;
    //   狀態檔讀不了或尚未修復者不列);套用時以現值再驗一次才結案
    if (isfun(deps.stores?.holds?.select)) {
        const open = (await deps.stores.holds.select()).filter((h) => h?.object === CORE_HOLD_OBJECT && h.status === 'open' && stds.includes(h.std) && (!ids || ids.has(strOf(h.oid))))
        const cores = open.length ? await deps.stores.cores.select() : []
        for (const h of open) {
            const cid = strOf(h.oid)
            const rec = cores.find((c) => c?.id === cid)
            if (!rec || !isPrimaryCore(rec, cores) || unclean.get(h.std).has(cid)) continue
            const lu = store.loadUsable(cid)
            if (!lu.writable || !judgeOf(lu.state, h.std, judgeCtx).every((r) => r.status === STATUS.PASS)) continue
            resolvable.push({ key: strOf(h.id) || holdKey(CORE_HOLD_OBJECT, cid, h.std), id: cid, std: h.std })
        }
    }
    return done()
}

/**
 * 套用預演之計畫:核心逐件以現值重算再寫(經核心寫入器)、即記帳;修不了者登錄使用者待判(同一核心同一標準一筆);已不再違反之未結登錄結案
 *
 * @param {Object} deps 輸入 { stores:{ notes, cores(select／get／replace), relations?(ES5), holds?(待判;未開者列入 errors) }, dirs, domain(提煉 domain),
 *   relateDomain?(ES5), clock, log? }
 * @param {Object} plan 輸入 planCoreStockFix 之產物(取 items 中 object 為 core 者、unfixable 與 resolvable 中 STOCK_STDS 者;他模組之項略過)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Boolean} [opt.material=false] 輸入現值重驗是否讀出處材料(同預演;ES2／ES16 之修不了者須讀之才驗得出仍違反)
 * @param {String} [opt.at] 輸入處置時刻 ISO(帳列之 at、沿革時刻、待判之登錄時刻;預設 clock.iso8() 或現在)
 * @param {String|null} [opt.stamp=null] 輸入輪次 stamp(14 碼;於輪次內呼叫者給 ctx.stamp;輪次外之維運入口未給＝null)——寫入核心 changelog 該筆之
 *   produced(stage `standards-fix`、不呼叫 AI 故 seat／provider 同時 null);非 14 碼字串即拋(任何寫入前)
 * @param {String} [opt.ledgerFile] 輸入處置帳(JSONL)絕對路徑(未給為 deps.dirs.state 下之 STOCK_LEDGER_FILE)
 * @param {Function} [opt.onRow] 輸入 (帳列) => void:每記一列即呼叫(呼叫端之總覽或日誌)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { at, counts:{ ES3?, ES5?(核心數), held?(新登錄之待判數), resolved?(結案數) }, rows:Array(本次寫入之帳列),
 *   applied:[{ id, stds }], held:[{ key, id, std }], alreadyHeld:Array(已有未結或已豁免之登錄鍵), resolved:Array(結案之登錄鍵),
 *   stale:Array(現值已不須處置之核心 id), errors:[{ id, object, error }], ledgerFile }
 * @throws {Error} 處置帳之路徑皆未給、或 opt.stamp 非 14 碼字串時拋出(任何寫入前)
 * @example
 * need test in nodejs.
 *
 * const r = await applyCoreStockFix({ stores, dirs, domain, relateDomain, clock }, plan)
 * console.log(r.applied, r.held)
 */
export async function applyCoreStockFix(deps, plan, opt = {}) {
    if (!isobj(opt)) opt = {}
    const ledgerFile = stockLedgerFileOf(deps, opt, 'applyCoreStockFix')
    const at = stockAtOf(deps, opt)
    // 產出鏈(不呼叫 AI 之確定性寫入;stage standards-fix):任何寫入前先組(stamp 不合即拋,不留半套);輪次外之維運入口未給 opt.stamp 即 null
    const produced = standardsFixProducedOf({ stamp: opt.stamp ?? null, at })
    const stores = deps?.stores || {}
    // 寫列器開 seq:先記之核心列與其作廢列、同核心之待判列於同一次套用可並存,作廢列以 seq 精確對應
    const { log, rows } = stockLedgerWriter(ledgerFile, at, { onRow: opt.onRow, seq: true })
    const counts = {}
    const bump = (k) => {
        counts[k] = (counts[k] || 0) + 1
    }
    const applied = []
    const held = []
    const alreadyHeld = []
    const resolved = []
    const stale = []
    const errors = []
    const items = (isarr(plan?.items) ? plan.items : []).filter((x) => x?.object === 'core')
    const unfix = (isarr(plan?.unfixable) ? plan.unfixable : []).filter((u) => STOCK_STDS.includes(strOf(u?.std)))
    const resolvable = (isarr(plan?.resolvable) ? plan.resolvable : []).filter((x) => STOCK_STDS.includes(strOf(x?.std)))
    const holds = isfun(stores.holds?.get) && isfun(stores.holds?.replace) && isfun(stores.holds?.select) ? stores.holds : null
    const store = coreStoreOf(deps.dirs)
    // 現值重驗之材料(ES5 讀邊與待判一次;範圍含 ES5 者才讀;非可修標準另取掃描同一組之判定材料)
    const needEs5 = items.some((x) => (x.stds || []).includes('ES5')) || unfix.some((u) => strOf(u.std) === 'ES5') || resolvable.some((x) => strOf(x.std) === 'ES5')
    const es5 = needEs5 ? await es5Of(deps, 'applyCoreStockFix') : {}
    const needBase = [...unfix, ...resolvable].some((x) => !CORE_FIX_STDS.includes(strOf(x.std)))
    const judgeCtx = { locale: deps.locale, ...(needBase ? await judgeBaseOf(deps, opt.material === true) : {}), ...es5 }

    // 核心:逐件以現值重算、先記帳列再寫(同一落盤路徑);寫入失敗而狀態未變者附寫作廢列
    if (items.length) {
        const writer = await coreWriterOf({ ...deps, clock: deps.clock || { iso8: () => at, stamp8: () => at.replace(/\D/g, '').slice(0, 14) } })
        for (const it of items) {
            const id = strOf(it.id)
            try {
                const lu = writer.store.loadUsable(id)
                if (!lu.writable) throw new Error(`核心狀態檔不可寫：${lu.why}`)
                const rec = await stores.cores.get(id)
                if (!rec?.file) throw new Error('核心記錄或 md 路徑不在')
                const before = clone(lu.state)
                const fix = coreFixOf(lu.state, { stds: it.stds, at, locale: deps.locale, produced, ...es5 })
                if (!fix.changes.length) {
                    stale.push(id)
                    continue
                }
                // 先記:處置前之整份狀態、預測之處置後版次(CAS 期待值＋1)與內容指紋(回退之判準;投影更新不改指紋)
                const stds = [...new Set(fix.changes.map((c) => c.std))]
                const row = log({ object: 'core', id, stds, changes: fix.changes, before: { state: before }, after: { rev: before.rev + 1, hash: stateFingerprintOf(fix.state) }, file: rec.file })
                try {
                    await writer.write({ id, file: rec.file, state: fix.state, expectRev: before.rev, before, touched: fix.touched })
                }
                catch (e) {
                    // 本次之內容未落地(CAS 失敗、不變式、寫檔失敗;磁碟現值之指紋 ≠ 預測)→ 作廢列;狀態已寫而其後(投影)失敗 → 帳列留著(投影由提煉段之 dirty 補做)
                    const now = writer.store.loadUsable(id)
                    if (!now.readable || stateFingerprintOf(now.state) !== row.after.hash) appendRollbackRow(ledgerFile, row, at, { voided: 'write-failed' })
                    throw e
                }
                for (const s of stds) bump(s)
                applied.push({ id, stds })
            }
            catch (e) {
                errors.push(stockErrorOf(id, 'core', e))
            }
        }
    }

    // 已不再違反之未結登錄:以現值再驗(該標準全為合格)才結案(抓取套件之存量待判件;帳記結案前之登錄,回退時復原)
    for (const x of resolvable) {
        const key = strOf(x.key)
        try {
            const lu = store.loadUsable(strOf(x.id))
            if (!lu.writable || !judgeOf(lu.state, strOf(x.std), judgeCtx).every((r) => r.status === STATUS.PASS)) {
                stale.push(key)
                continue
            }
            if (!(await closeStockHold(holds, key, strOf(x.std), { at, log }))) continue
            bump('resolved')
            resolved.push(key)
        }
        catch (e) {
            errors.push(stockErrorOf(key, CORE_HOLD_OBJECT, e))
        }
    }

    // 修不了者:同一核心同一標準登錄一筆使用者待判(原因列各條;抓取套件之存量待判件——已有未結或已豁免者不重登、登錄即記待判列);
    //   登錄前以現值重驗(標準,條目):已不違反之條目不列,全不違反即不登錄(stale);未開 holds 集合 → errors(不靜默)
    const groups = new Map()
    const judged = new Map()
    const stillBad = (cid, std, field) => {
        const k = `${cid}|${std}`
        if (!judged.has(k)) {
            const lu = store.loadUsable(cid)
            judged.set(k, lu.readable ? new Set(judgeOf(lu.state, std, judgeCtx).filter((r) => r.status === STATUS.VIOLATION).map((r) => r.field || cid)) : null)
        }
        const bad = judged.get(k)
        return bad === null || bad.has(field)
    }
    for (const u of unfix) {
        const [cid, field] = strOf(u.id).split('#')
        const std = strOf(u.std)
        if (!stillBad(cid, std, field || cid)) continue
        const key = holdKey(CORE_HOLD_OBJECT, cid, std)
        if (!groups.has(key)) groups.set(key, { key, id: cid, std, details: [] })
        groups.get(key).details.push(`〔${field || cid}〕${strOf(u.detail)}`)
    }
    for (const u of unfix) {
        const [cid] = strOf(u.id).split('#')
        const key = holdKey(CORE_HOLD_OBJECT, cid, strOf(u.std))
        if (!groups.has(key) && !stale.includes(key)) stale.push(key)
    }
    for (const g of groups.values()) {
        try {
            const r = await holdStockUnfixable(holds, { object: CORE_HOLD_OBJECT, oid: g.id, std: g.std, detail: g.details.join('；'), next: EXTRACT_HOLD_NEXT.coreStock, owner: 'user', deadline: extractHoldDeadlineOf(at) }, { at, log })
            if (!r.held) {
                alreadyHeld.push(g.key)
                continue
            }
            bump('held')
            held.push({ key: g.key, id: g.id, std: g.std })
        }
        catch (e) {
            errors.push(stockErrorOf(g.id, CORE_HOLD_OBJECT, e))
        }
    }
    return { at, counts, rows, applied, held, alreadyHeld, resolved, stale, errors, ledgerFile }
}

/**
 * 套用後之連鎖斷言(本套件可驗者):核心列——狀態檔可寫、版號＝處置後應有者(有 ES3 修正者為處置前＋1)、內容指紋＝帳列之 after.hash(未被他處覆寫;
 *   舊列無指紋者比版次)、同一修法重跑無改動(ES3)、cores 記錄之版號與 md 前言之版號＝狀態;待判列——登錄存在;結案列——登錄已結案;
 *   關聯之邊列帶 seen 者(ES10 之快照隨字形修正換值)——邊仍在且 updatedAt 未被改者,快照之簽章＝現值之簽章
 *
 * @param {Object} deps 輸入 { stores:{ cores?, holds?, relations?(邊列) }, dirs(核心狀態檔、快照), locale? }
 * @param {Array} rows 輸入帳列(applyCoreStockFix 之 rows,或 readCoreStockLedger 之產物;亦可含關聯之邊列——只驗其快照;他列略過)
 * @returns {Promise} 回傳 Promise,resolve 回傳 { checked:Integer(驗過之列數), problems:Array(字串) }
 * @example
 * need test in nodejs.
 *
 * const r = await applyCoreStockFix(deps, plan)
 * console.log((await verifyCoreStockChain(deps, r.rows)).problems)
 * // => []
 */
export async function verifyCoreStockChain(deps, rows) {
    const stores = deps?.stores || {}
    const store = coreStoreOf(deps.dirs)
    let snap
    let snapCorrupt = ''
    // 斷言為純讀:快照壞了不隔離(唯讀讀法),列為問題
    const snapOf = () => {
        if (snap === undefined) snap = readLedgerJson(path.join(deps.dirs.state, EDGE_SEEN_FILE), { shape: EXTRACT_LEDGER_SHAPES.edgeSeen, quarantine: false, onCorrupt: (i) => { snapCorrupt = strOf(i.error) } })
        return snap
    }
    let checked = 0
    const problems = []
    for (const r of isarr(rows) ? rows : []) {
        if (isCoreRow(r)) {
            checked++
            if (r.object === 'core') {
                const lu = store.loadUsable(r.id)
                const base = Number(r.before?.state?.version) || 0
                const want = (r.changes || []).some((c) => c.std === 'ES3') ? base + 1 : base
                // 四態:不可寫者(含由上一版讀出而尚未修復——處置之結果已不在現檔)即 problem
                if (!lu.writable) {
                    problems.push(`核心 ${r.id}：${lu.why}`)
                    continue
                }
                const s = lu.state
                if (Number(s.version) !== want) problems.push(`核心 ${r.id}：版號 ${s.version} ≠ 處置後應有之 ${want}（被他處覆寫？）`)
                else if (isestr(r.after?.hash) ? stateFingerprintOf(s) !== r.after.hash : s.rev !== r.after?.rev) problems.push(`核心 ${r.id}：${isestr(r.after?.hash) ? '內容指紋 ≠ 帳列之處置後指紋' : `版次 ${s.rev} ≠ 處置後之 ${r.after?.rev ?? '（帳列缺 after）'}`}（被他處覆寫？）`)
                else {
                    // 加驗:同一修法重跑無改動(ES3;ES5 之材料須邊庫,留給預演)、投影之版號與狀態一致(cores 記錄、md 前言)
                    if ((r.stds || []).includes('ES3') && coreFixOf(s, { stds: ['ES3'], at: strOf(r.at), locale: deps.locale }).changes.length) problems.push(`核心 ${r.id}：ES3 重跑仍有改動（修正未落地或其後又寫入簡體）`)
                    const rec = isfun(stores.cores?.get) ? await stores.cores.get(r.id) : null
                    if (rec && Number(rec.version) !== Number(s.version)) problems.push(`核心 ${r.id}：cores 記錄之版號 ${rec.version} ≠ 狀態 ${s.version}（投影未更新）`)
                    const front = readMd(rec?.file || r.file)?.front
                    if (front && Number(front.version) !== Number(s.version)) problems.push(`核心 ${r.id}：md 前言之版號 ${front.version} ≠ 狀態 ${s.version}（投影未更新）`)
                }
                continue
            }
            problems.push(...(await stockHoldProblems(stores.holds, r)))
        }
        else if (isobj(r) && !r.rollbackOf && r.object === 'edge' && isobj(r.seen)) {
            // 快照須隨字形修正換簽章(否則下輪產生「理由已更新」事件);邊仍在且 updatedAt 未被改者才比(其餘由關聯之連鎖斷言回報)
            checked++
            const cur = isfun(stores.relations?.get) ? await stores.relations.get(r.id) : null
            if (cur && cur.updatedAt === r.before?.edge?.updatedAt && snapOf()?.edges?.[r.id] !== edgeSigOf(cur)) problems.push(snapCorrupt ? `邊 ${r.id}：提煉之邊庫快照損壞（${snapCorrupt}），無從驗其簽章` : `邊 ${r.id}：提煉之邊庫快照未隨字形修正換簽章（下輪會產生「理由已更新」事件）`)
        }
    }
    return { checked, problems }
}

/**
 * 讀處置帳(JSONL;抓取套件之帳協定):本模組之列(核心列、核心物件之待判列與結案列),排除回退列與已被回退者;檔案不存在回空陣列
 *
 * @param {String} file 輸入處置帳絕對路徑
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.since] 輸入只取此時刻起之列(以時刻比較)
 * @param {String} [opt.at] 輸入只取此時刻之列(某次套用之列;連鎖斷言用)
 * @param {Boolean} [opt.allowBad=false] 輸入有無法解析之列時是否略過(預設即拋)
 * @returns {Array} 回傳列陣列(依檔內順序)
 * @throws {Error} 帳有無法解析之列而未給 allowBad 時拋出(訊息列行號)
 * @example
 * need test in nodejs.
 *
 * const rows = readCoreStockLedger(path.join(dirs.state, STOCK_LEDGER_FILE), { at: r.at })
 */
export function readCoreStockLedger(file, opt = {}) {
    if (!isobj(opt)) opt = {}
    return stockLedgerRowsOf(file, { since: opt.since, at: opt.at, allowBad: opt.allowBad, keep: isCoreRow })
}

/**
 * 回退(逐列;檔頭【回退逐列】):給定之列中本模組之列依逆序撤銷——核心列:現值版次＝處置後之版次者寫回處置前之整份狀態(同一落盤路徑之 restore;
 *   版號與沿革本就倒退,不驗不變式)、內容已同處置前者為已完成(續作)、其餘(其後被改寫、核心已不在)為衝突(不覆寫、不記回退列);
 *   待判列只動同一登錄(使用者其後之裁示如豁免不被回退改寫);結案列——登錄仍為本次所結者復原為結案前之登錄;逐件附寫回退列
 *   { at, rollbackOf, object, id }(readCoreStockLedger 據以排除已回退者)。他模組之列略過(restored 0、不報錯)
 *
 * @param {Object} deps 輸入 { stores:{ notes, cores, holds? }, dirs, domain(提煉 domain;核心列之渲染), clock?, log? }
 * @param {Array} rows 輸入帳列(單列之陣列,或 readCoreStockLedger 之產物;他模組之列略過)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.at] 輸入回退時刻 ISO(回退列之 at、待判結案時刻;預設 clock.iso8() 或現在)
 * @param {String} [opt.ledgerFile] 輸入處置帳(JSONL)絕對路徑(未給為 deps.dirs.state 下之 STOCK_LEDGER_FILE)
 * @param {Boolean} [opt.acceptCurrent=false] 輸入衝突之核心列是否接受現值(記取代列 { accepted:'current', units }、不寫值)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { at, restored:Integer, accepted:Integer, conflicts:[{ id, object:'core', units }], errors:[{ id, object, error }] }
 * @throws {Error} 處置帳之路徑皆未給時拋出
 * @example
 * need test in nodejs.
 *
 * const rows = readCoreStockLedger(path.join(dirs.state, STOCK_LEDGER_FILE))
 * const rb = await rollbackCoreStockFix({ stores, dirs, domain, clock }, rows)
 * console.log(rb.restored, rb.errors)
 */
export async function rollbackCoreStockFix(deps, rows, opt = {}) {
    if (!isobj(opt)) opt = {}
    const ledgerFile = stockLedgerFileOf(deps, opt, 'rollbackCoreStockFix')
    const at = stockAtOf(deps, opt)
    const stores = deps?.stores || {}
    const mine = [...(isarr(rows) ? rows : [])].filter(isCoreRow).reverse()
    let restored = 0
    let accepted = 0
    const conflicts = []
    const errors = []
    if (!mine.length) return { at, restored, accepted, conflicts, errors }
    const writer = mine.some((r) => r.object === 'core') ? await coreWriterOf({ ...deps, clock: deps.clock || { iso8: () => at, stamp8: () => at.replace(/\D/g, '').slice(0, 14) } }) : null
    for (const r of mine) {
        try {
            if (r.object === 'core') {
                if (!isobj(r.before?.state)) throw new Error('帳列缺 before（處置前之狀態），無從還原')
                if (!isobj(r.after) || !(isestr(r.after.hash) || Number.isInteger(r.after.rev))) throw new Error('帳列缺 after（處置後之指紋或版次），無從判定其後是否被改寫')
                // 四態:可寫者為現值;狀態檔與上一版皆不在者為核心不在(衝突);其餘(由上一版讀出而尚未修復、壞檔無上一版、他版、讀不了)拒——
                //   由提煉段之維護修復後再回退
                const lu = writer.store.loadUsable(r.id)
                if (!lu.writable && lu.status !== 'missing') throw new Error(`核心狀態檔不可寫：${lu.why}`)
                const cur = lu.writable ? lu.state : null
                // 三態(內容指紋;舊列無指紋者比版次):現值為該次處置之結果 → 寫回(寫回前驗形;md 路徑取現行記錄);已回到處置前 → 已完成(續作);
                //   其餘(其後被提煉或他次處置改寫、核心已不在)→ 衝突(不覆寫、不記回退列;opt.acceptCurrent 記取代列)
                const fpCur = cur ? stateFingerprintOf(cur) : ''
                const isAfter = cur && (isestr(r.after.hash) ? fpCur === r.after.hash : cur.rev === r.after.rev)
                if (isAfter) {
                    const restoreState = normalizeState(clone(r.before.state))
                    const rec = isfun(stores.cores?.get) ? await stores.cores.get(r.id) : null
                    await writer.restore({ id: r.id, file: rec?.file || r.file, state: restoreState, expectRev: cur.rev })
                }
                else if (!cur || fpCur !== stateFingerprintOf(r.before.state)) {
                    const units = cur ? [isestr(r.after.hash) ? '狀態（內容指紋 ≠ 處置後之指紋）' : `狀態（版次 ${cur.rev} ≠ 處置後之 ${r.after.rev}）`] : ['（核心不在）']
                    if (opt.acceptCurrent === true) {
                        appendRollbackRow(ledgerFile, r, at, { accepted: 'current', units })
                        accepted++
                    }
                    else conflicts.push({ id: strOf(r.id), object: 'core', units })
                    continue
                }
            }
            // 待判列只動同一登錄(使用者其後之裁示——豁免——與他次登錄不被回退改寫);結案列仍為本次所結者復原(其後已被重開或豁免者不動)
            else if (r.object === 'hold') await rollbackStockHold(stores.holds, r, at)
            else await reopenStockHold(stores.holds, r)
            appendRollbackRow(ledgerFile, r, at)
            restored++
        }
        catch (e) {
            errors.push(stockErrorOf(r.id, r.object, e))
        }
    }
    return { at, restored, accepted, conflicts, errors }
}

/**
 * ES10 之邊庫快照之連鎖處理器(掛於關聯之存量處置之套用與回退;檔頭【連鎖】):字形修正後,快照中原與舊值同步者換為新值之簽章;
 *   回退時,快照仍為處置所換之值者換回。套用之換值批次寫回(flush;改了才原子寫),回退之換回逐列寫回
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @returns {Object} 回傳 { onEdgeFixed:(before, after)=>{ seen:{ from, to } }|undefined(併入關聯之帳列), onEdgeRolledBack:(row)=>void, flush:()=>Boolean(是否寫回) }
 * @throws {Error} dirs 缺 state 時拋出
 * @example
 * need test in nodejs.
 *
 * const sync = edgeSeenSyncOf(dirs)
 * const r = await applyEdgeStockFix(relDeps, { items }, { onEdgeFixed: sync.onEdgeFixed })
 * sync.flush()
 */
export function edgeSeenSyncOf(dirs) {
    if (!isestr(dirs?.state)) throw new Error('edgeSeenSyncOf 需要 dirs.state（邊庫快照之位置）')
    const file = path.join(dirs.state, EDGE_SEEN_FILE)
    let seen
    let dirty = false
    // 唯讀讀法:快照壞了不隔離(提煉段下輪開工時隔離並重建基準),本處視為無快照——不換值、不寫回(不覆寫壞檔)
    const read = () => readLedgerJson(file, { shape: EXTRACT_LEDGER_SHAPES.edgeSeen, quarantine: false })
    const load = () => {
        if (seen === undefined) seen = read()
        return seen
    }
    return {
        onEdgeFixed: (before, after) => {
            const s = load()
            if (!s?.edges || s.edges[before?.id] !== edgeSigOf(before)) return undefined
            s.edges[before.id] = edgeSigOf(after)
            dirty = true
            return { seen: { from: edgeSigOf(before), to: edgeSigOf(after) } }
        },
        onEdgeRolledBack: (r) => {
            if (!isobj(r?.seen)) return
            // 未寫回之換值先落地,再以磁碟之現值判(與他處之推進一致)
            if (dirty) {
                saveLedgerJson(file, seen)
                dirty = false
            }
            const snap = read()
            if (snap?.edges?.[r.id] === r.seen.to) {
                snap.edges[r.id] = r.seen.from
                saveLedgerJson(file, snap)
            }
            seen = undefined
        },
        flush: () => {
            if (!dirty) return false
            saveLedgerJson(file, seen)
            dirty = false
            return true
        },
    }
}

export default { CORE_FIX_STDS, STOCK_STDS, planCoreStockFix, applyCoreStockFix, verifyCoreStockChain, readCoreStockLedger, rollbackCoreStockFix, edgeSeenSyncOf }
