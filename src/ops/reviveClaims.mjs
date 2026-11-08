// reviveClaims.mjs — 還原可還原之撤回(維運能力;使用者裁示)
//
// 【為何需要】程式撤回(coreState 之 PROGRAM_RETRACT_REASONS:ES9 存量覆核之「覆核無出處支持」、ES8 失撐之「出處已撤他篇無支持」)出自判定小組,
//   判定可能錯;使用者複核後裁示主張成立者須能還原——終態不可逆之唯一例外(coreState ⑱ reviveItems)。
// 【規則】①只收 status retracted 且理由在 REVIVABLE_RETRACT 之主張,且至少一則出處存活(出處皆已撤者還原後仍為失撐〔ES8〕——先以關聯套件之
//   restoreNote 還原出處筆記;理由為 ES8 之撤回者於出處筆記還原時由維護一併還原);其餘(非本核心之主張、非撤回、理由不可還原、出處皆已撤)逐條列
//   errors,不動;
//   ②閘:擬還原者以還原後之狀態過檢定標準之子集(ES2 數字紮根、ES4 標注明示、ES12 跨篇、ES13 弱證據限制;checkCore)——違反者不還原、逐條列
//   errors(使用者裁示不豁免內容標準;ES17 為新進之閘、ES3 由存量處置);
//   ③序:先寫裁示紀錄(檢核紀錄:ES9 之雜湊以還原後之狀態預算、pass、席位 user、理由記裁示者與裁示內容——同一內容不再被存量覆核重判撤回;主張被
//   修訂、出處或出處之內容變了即照常重檢)→ 經核心之程式寫入器落盤(stores/coreProjection 之 coreWriterOf:證據重算、不變式〔touched＝還原者〕、渲染、CAS、
//   手改偵測、cores 記錄;本質不自動改回,由本質專步重寫;狀態檔不可寫〔壞檔、遺失、尚未修復、非本格式〕者不寫,交提煉段之維護處置)
//   → 結案其主張物件(claim)之未結待判(ES9、ES8;處置方式記裁示)。可續作:主張已 active 而檢核紀錄之席位為 user(前次於落盤後、結案前中斷)者
//   跳過寫入、只結案待判;
//   ④沿革:主張之沿革記 revive(說明＝裁示)、changelog 記 mode revive(reviveItems);
//   ⑤by、ruling 必填(使用者裁示須可追溯;同待判豁免之規則);需 holds 與 checks 集合(裁示須落帳,否則下一輪存量覆核可再撤回);
//   ⑥給 opt.lockFile 時取執行鎖(與管線同一把;管線持鎖中即拒絕),避免與提煉段同時動同一核心。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { normalizeConcept, resolveClockCfg, STATUS, strictTextOf as str, jsonClone as clone } from '../core/capturePackage.mjs'
import { holdKey, resolveHold, acquireLock, noteDocIdOf } from '../core/capturePackage.mjs'
import { standardsFixProducedOf } from '../core/producedChain.mjs'
import { checkKey, recordCheck, createMaterialReader } from '../core/relatePackage.mjs'
import { REVIVABLE_RETRACT, reviveItems, withdrawnOf, liveSourcesOf, findItem } from '../stores/coreState.mjs'
import { liveCoresOf, coreForKey } from '../stores/conceptSelection.mjs'
import { EXTRACT_API_HINT, itemOidOf } from '../stores/extractHolds.mjs'
import { extractMaterialOf } from '../stores/noteFacts.mjs'
import { checkCore } from '../standards/coreStandards.mjs'
import { CLAIM_OBJECT, stockHashOf } from '../standards/supportStock.mjs'
import { ES9 } from '../standards/supportCheck.mjs'
import { ES8 } from '../standards/orphanCheck.mjs'
import { createContentCache } from '../stores/contentCache.mjs'
import { CONTENT_CACHE_FILE } from '../stores/extractFiles.mjs'
import { coreWriterOf } from '../stores/coreProjection.mjs'


/** 還原之閘:擬還原之主張須過之確定性標準(以還原後之狀態判;違反者不還原) */
export const REVIVE_GATE_STDS = Object.freeze(['ES2', 'ES4', 'ES12', 'ES13'])

/**
 * 依核心 id 或概念名找存活之核心(id 先;概念名以 normalizeConcept 比對,先概念層、再類別層之主核心)
 *
 * @param {Array} cores 輸入核心記錄陣列
 * @param {String} arg 輸入核心 id 或概念名
 * @returns {Object|null} 回傳核心記錄
 */
function coreOfArg(cores, arg) {
    const key = normalizeConcept(arg)
    return liveCoresOf(cores).find((c) => c.id === arg) || coreForKey(cores, 'concept', key) || coreForKey(cores, 'category', key) || null
}

/**
 * 還原可還原之撤回(使用者裁示):閘 → 裁示紀錄 → 落盤(程式寫入器)→ 結案相關待判;沿革
 *
 * @param {Object} deps 輸入 { stores:{ notes, cores, holds, checks }, dirs(每輪依賴之 dirs;取 core、coreState、state), domain(提煉 domain), clock?(未給依預設時區), log?, locale? }
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.core 輸入核心 id 或概念名
 * @param {Array} opt.ids 輸入欲還原之主張 id
 * @param {String} opt.by 輸入裁示者
 * @param {String} opt.ruling 輸入裁示內容
 * @param {String} [opt.lockFile] 輸入執行鎖檔路徑(與管線同一把),給了即取鎖、管線持鎖中即拒絕
 * @param {Integer} [opt.staleMs] 輸入取鎖時持鎖者未宣告陳舊期限所用之毫秒數
 * @param {String|null} [opt.stamp=null] 輸入輪次 stamp(14 碼;於輪次內呼叫者給 ctx.stamp;輪次外之維運入口未給＝null)——寫入核心 changelog 該筆之 produced
 *   (stage `standards-fix`、不呼叫 AI 故 seat／provider 同時 null);非 14 碼字串即拋(任何寫入前)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok:Boolean(有還原者), notFound:Boolean, locked?:Boolean, core(核心 id), concept, version(還原後之知識版本;未寫回 null),
 *   revived:Array(主張 id), resumed:Array(前次中斷而只結案待判者), holdsResolved:Array(登錄鍵), checks:Array(檢核紀錄鍵), errors:Array({ id, why }) }
 * @throws {Error} deps 缺必要之集合、dirs 或 domain,opt 缺 core／ids／by／ruling、opt.stamp 非 14 碼字串時拋出;寫入違反不變式或 CAS 衝突時拋出(未落盤;裁示紀錄已寫,待判不動——重跑即續作)
 * @example
 * need test in nodejs.
 *
 * let r = await reviveClaims({ stores, dirs, domain }, { core: '光合作用', ids: ['C3'], by: '王小明', ruling: '原文第二段即支持此主張' })
 * console.log(r.revived)
 */
export async function reviveClaims(deps, opt = {}) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.cores?.select) || !isfun(stores.notes?.select)) throw new Error('reviveClaims 需要 deps.stores 之 notes、cores 集合')
    // 待判與檢核紀錄之集合方法須先驗(缺者在落盤後才拋,留下半套處置)
    if (!['get', 'replace', 'select'].every((m) => isfun(stores.holds?.[m]))) throw new Error(`reviveClaims 需要 holds 集合（${EXTRACT_API_HINT.holdsStore}）`)
    if (!['get', 'replace'].every((m) => isfun(stores.checks?.[m]))) throw new Error(`reviveClaims 需要 checks 集合（${EXTRACT_API_HINT.checksStore}）——裁示須落帳，否則下一輪存量覆核可再撤回`)
    if (!isobj(deps.dirs) || !isestr(deps.dirs.core) || !isestr(deps.dirs.state)) throw new Error(`reviveClaims 需要 deps.dirs（${EXTRACT_API_HINT.regenDirs}）`)
    if (!isfun(deps.domain?.renderState)) throw new Error('reviveClaims 需要 deps.domain（提煉 domain：createExtractDomain 之產物；渲染與證據同提煉段）')
    if (!isobj(opt) || !isestr(opt.core)) throw new Error('reviveClaims 需要 opt.core（核心 id 或概念名）')
    const ids = isarr(opt.ids) ? [...new Set(opt.ids.map(str).filter(Boolean))] : []
    if (!ids.length) throw new Error('reviveClaims 需要 opt.ids（主張 id 陣列）')
    const by = str(opt.by)
    const ruling = str(opt.ruling)
    if (!by || !ruling) throw new Error('還原撤回須記裁示者與裁示內容（opt.by、opt.ruling）')

    const none = { ok: false, notFound: false, core: '', concept: '', version: null, revived: [], resumed: [], holdsResolved: [], checks: [], errors: [] }
    let lock = null
    if (isestr(opt.lockFile)) {
        lock = acquireLock(opt.lockFile, Number.isInteger(opt.staleMs) && opt.staleMs > 0 ? { staleMs: opt.staleMs } : {})
        if (!lock.ok) return { ...none, locked: true, errors: [{ id: '', why: `管線執行中，未還原：${lock.message}` }] }
    }
    try {
        const { dirs, domain } = deps
        const log = deps.log || { info: () => {}, warn: () => {}, error: () => {} }
        // 時鐘:落盤所讀之 iso8／stamp8 皆有者原樣採用;未給依預設時區建立(給了而不合者由 resolveClockCfg 拋)
        const clock = isfun(deps.clock?.iso8) && isfun(deps.clock?.stamp8) ? deps.clock : resolveClockCfg(deps.clock)
        const at = clock.iso8()
        // 產出鏈(不呼叫 AI 之確定性寫入;stage standards-fix):任何寫入前先組(stamp 不合即拋)
        const produced = standardsFixProducedOf({ stamp: opt.stamp ?? null, at })
        const rec = coreOfArg(await stores.cores.select(), opt.core)
        if (!rec) return { ...none, notFound: true, errors: [{ id: '', why: `找不到核心「${opt.core}」` }] }
        const out = { ...none, core: rec.id, concept: rec.concept }
        const writer = await coreWriterOf({ stores, dirs, clock, log, domain })
        // 四態分流表:不可寫者(由上一版讀出而尚未修復、壞檔無上一版、他版、讀不了、不存在)拒並指引
        const lu = writer.store.loadUsable(rec.id)
        if (!lu.writable) return { ...out, errors: [{ id: '', why: `核心狀態檔不可寫：${lu.why}` }] }

        // ①逐條判定可否還原;前次中斷者(主張已 active 而裁示紀錄已寫)續作
        const s0 = lu.state
        const W = withdrawnOf(s0)
        const want = []
        const resume = []
        const resumeReason = new Map() // 續作之原撤回理由:自前次所寫之裁示紀錄(reason 含「撤回理由 X」)取,沿革之 note 不含之
        for (const id of ids) {
            const c = (s0.claims || []).find((x) => x.id === id)
            if (!c) {
                out.errors.push({ id, why: '非本核心之主張' })
                continue
            }
            if (c.status !== 'retracted') {
                const rec9 = await stores.checks.get(checkKey(CLAIM_OBJECT, itemOidOf(rec.id, id)))
                if (c.status === 'active' && rec9?.results?.[ES9.std]?.seats === 'user') {
                    resume.push(id)
                    resumeReason.set(id, str(rec9.results[ES9.std].reason).match(/撤回理由 (\S+?)）/)?.[1] || '（前次）')
                }
                else out.errors.push({ id, why: `非撤回之主張（狀態 ${c.status}）` })
                continue
            }
            if (!REVIVABLE_RETRACT.includes(c.retractReason)) out.errors.push({ id, why: `撤回理由「${c.retractReason}」不可還原（可還原者：${REVIVABLE_RETRACT.join('、')}）` })
            else if (!liveSourcesOf(c, s0, W).length) out.errors.push({ id, why: '出處皆已撤——還原後仍為失撐（ES8）；先以關聯套件之 restoreNote 還原出處筆記' })
            else want.push(id)
        }
        const notes = await stores.notes.select()
        const notesById = new Map(notes.map((n) => [n.id, n]))
        const how = (id, reason) => `使用者以 reviveClaims 還原（撤回理由 ${reason}）——裁示者 ${by}：${ruling}；同一內容不再自動覆核`
        const closeHolds = async (id, reason) => {
            const oid = itemOidOf(rec.id, id)
            for (const std of [ES9.std, ES8.std]) {
                const h = await stores.holds.get(holdKey(CLAIM_OBJECT, oid, std))
                if (h?.status !== 'open') continue
                await resolveHold(stores.holds, h.id, { at, how: how(id, reason) })
                out.holdsResolved.push(h.id)
            }
        }
        // 續作:只結案待判(裁示紀錄已寫、狀態已 active)
        for (const id of resume) {
            await closeHolds(id, resumeReason.get(id) || '（前次）')
            out.resumed.push(id)
        }
        if (!want.length) return { ...out, ok: out.resumed.length > 0, version: out.resumed.length ? s0.version : null }

        // ②閘:以還原後之狀態過檢定標準之子集(違反者不還原、逐條列 errors)
        const wasOf = new Map(want.map((id) => [id, s0.claims.find((x) => x.id === id).retractReason]))
        const trial = reviveItems(clone(s0), want, { at, why: `使用者裁示（${by}）：${ruling}` })
        const gateCtx = {
            limits: domain.limits,
            evidence: domain.evidence,
            weakEvidence: domain.weakEvidence,
            docIdOf: (nid) => noteDocIdOf(notesById.get(nid)) || null,
            locale: deps.locale,
            contentOf: createMaterialReader({ notes, noteById: notesById, useMaterial: true, materialOf: null, onNote: null, textOf: extractMaterialOf }),
        }
        const gated = new Map()
        for (const r of checkCore(trial.state, gateCtx)) {
            if (!REVIVE_GATE_STDS.includes(r.std) || r.status !== STATUS.VIOLATION || !want.includes(r.field)) continue
            gated.set(r.field, [...(gated.get(r.field) || []), `${r.std}：${r.detail}`])
        }
        for (const [id, why] of gated) out.errors.push({ id, why: `還原後不過檢定標準（${why.join('；')}）——修正後再還原` })
        const pass = want.filter((id) => !gated.has(id))
        if (!pass.length) return { ...out, ok: out.resumed.length > 0, version: out.resumed.length ? s0.version : null }

        // ③裁示紀錄(先記;ES9 之雜湊以還原後之狀態預算——出處之內容鍵取提煉段之同一快取,唯讀)
        const before = clone(s0)
        const rv = reviveItems(s0, pass, { at, why: `使用者裁示（${by}）：${ruling}`, produced })
        const cache = createContentCache(path.join(dirs.state, CONTENT_CACHE_FILE), domain)
        const keyOf = (nid) => String(cache.keyOf(notesById.get(nid)) ?? '')
        for (const id of rv.revived) {
            const oid = itemOidOf(rec.id, id)
            const c = findItem(rv.state, id).item
            await recordCheck(stores.checks, { object: CLAIM_OBJECT, oid, hash: stockHashOf(c, liveSourcesOf(c, rv.state), keyOf), std: ES9.std, v: ES9.v, at, status: STATUS.PASS, seats: 'user', reason: how(id, wasOf.get(id)) })
            out.checks.push(checkKey(CLAIM_OBJECT, oid))
        }
        // ④落盤(程式寫入器;不變式之 touched＝還原者)
        const written = await writer.write({ id: rec.id, file: rec.file || path.join(dirs.core, `${rec.id}.md`), state: rv.state, expectRev: before.rev, before, touched: rv.revived })
        // ⑤待判結案(ES9、ES8;處置方式記裁示)
        for (const id of rv.revived) await closeHolds(id, wasOf.get(id))
        log.info(`提煉還原[${rec.concept}]：〔${rv.revived.join('〕〔')}〕撤回已還原（使用者裁示：${by}）`)
        return { ...out, ok: true, version: written.version, revived: rv.revived }
    }
    finally {
        lock?.release?.()
    }
}

export default { REVIVE_GATE_STDS, reviveClaims }
