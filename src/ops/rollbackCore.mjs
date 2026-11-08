// rollbackCore.mjs — 令指定概念之核心知識回退至較早之版本(維運能力;與 regenCore 之「打掉重練」相對:不重來,只退回)
//
// 【既有能力之盤點(本函數之依據)】①regenCore:封存整個核心、自 v1 重練(破壞性、非回退);②`prev`(核心狀態檔之上一份,每次寫入前由 coreStore.save 存):
//   只有「上一次寫入前」之內容——只落帳之寫入(略過、逾限標已用、已見衝突)不升知識版本,故 .prev 之版本可能與現版相同;③archive(壞檔隔離、重練、分身併入):
//   皆為另一類之封存;④essenceHistory、主張之 history(只對 revise 記 before):不足以逆推完整狀態。——無任何既有能力可回到指定版本,故新增本函數。
// 【回退之唯一來源是 .prev】只在 .prev 之版本恰為 toVersion(且低於現版)時可回退;不是者明確拒絕(refused,附原因碼與現況),不猜、不由 changelog 逆推。
//   (實務上緊接於升版之後之回退成立;其後若有只落帳之寫入,.prev 已被覆蓋為同版,即無從回退——須另有逐版快照才能回到任意版,見 sgud 狀態之已知缺口。)
// 【步驟】①取執行鎖(給 lockFile 時;管線持鎖中即拒絕)→ ②選主核心(coreForKey)、讀現版與 .prev、驗可回退 → ③被回退之版本封存(狀態檔複本,標記 rollback;
//   主檔仍在直到被新內容以 CAS 取代,無「無主檔」之空窗)→ ④寫回退後之狀態(.prev 之內容＋一筆 changelog:mode 'rollback'、produced〔stage 'rollback'、不呼叫 AI 故
//   seat／provider 同時 null、stamp 為 null〕;version 即 toVersion)→ ⑤md 投影與 cores 記錄重渲染(coreProjection.writeProjections;需 opt.domain＝管線所用之 domain)
//   → ⑥結案該核心之待判(比照 regenCore:以核心 id 為鍵之持久物全集;舊登錄與舊裁示不得作用於回退後之條目)。
// 【連動】已用筆記(consumed)、已見(seen)、已見衝突等隨狀態回到該版之值——回退之版本所消化之筆記回到「未消化」,下一輪依既有選篇規則重新處理(重處理走既有路徑)。
//   失敗帳與影響留待不動(退避僅影響排序)。
// 【md 之 changelog 末筆】回退之 changelog 筆沿用回退後版本末筆之 batch——渲染之 front matter「notes」取末筆之 batch,如此回退後之 md 與該版當時之 md 逐位元組相同。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { acquireLock, jsonClone as clone, makeProduced, normalizeConcept, pkgIdOf, resolveClockCfg, resolveHold } from '../core/capturePackage.mjs'
import { coreForKey } from '../stores/conceptSelection.mjs'
import { ARCHIVE_TAGS, coreAuxDirs, coreStoreOf } from '../stores/coreStore.mjs'
import { createNoTopCache } from '../stores/contentCache.mjs'
import { writeProjections } from '../stores/coreProjection.mjs'
import { NO_TOP_CACHE_FILE } from '../stores/extractFiles.mjs'
import { EXTRACT_API_HINT, coreHoldsToCloseOf } from '../stores/extractHolds.mjs'

/**
 * 回退被拒之原因碼(refused 之值;rollbackCore 之回傳):
 *   no-core 找不到核心、state-unreadable 現版狀態檔讀不了、no-prev 無上一份(.prev)可讀、to-version-invalid toVersion 非非負整數、
 *   to-version-not-lower toVersion 不低於現版、version-unavailable 上一份之版本不是 toVersion(只可回到 .prev 之版本)、prev-mismatch 上一份屬另一概念
 *
 * @type {Object}
 */
export const ROLLBACK_REFUSED = Object.freeze({
    noCore: 'no-core',
    stateUnreadable: 'state-unreadable',
    noPrev: 'no-prev',
    toVersionInvalid: 'to-version-invalid',
    toVersionNotLower: 'to-version-not-lower',
    versionUnavailable: 'version-unavailable',
    prevMismatch: 'prev-mismatch',
})

/**
 * 令指定概念之核心回退至指定版本(至少回前一版;來源唯一為 .prev,見檔頭):被回退之版本封存(狀態檔複本)、回退後之狀態記一筆 changelog(mode 'rollback',
 * produced.stage 'rollback'、不呼叫 AI 故 steps 以不呼叫 AI 之單一形〔seat、provider 同時 null〕表達)、md 與 cores 記錄重渲染、該核心之待判結案;
 * 不可回退者(找不到、狀態讀不了、無上一份、版本不符…)明確拒絕(ok:false 與 refused 原因碼),不改任何東西
 *
 * @param {Object} stores 輸入集合物件，需含 cores(select、replace)、notes(select)、holds(get／replace／select;該核心之待判隨回退結案)
 * @param {String} conceptArg 輸入欲回退之概念名稱字串(以 normalizeConcept 正規化後比對；先找概念層、再找類別層)
 * @param {Object} opt 輸入設定物件(必填)
 * @param {Object} opt.dirs 輸入目錄物件(同每輪依賴之 dirs；取 core、coreState、state)
 * @param {Object} opt.domain 輸入提煉 domain(管線所用者,如 flow.info().domains.extract;md 投影以之渲染,版型須與管線同版)
 * @param {Integer} [opt.toVersion] 輸入欲回到之版本(非負整數;須低於現版且等於 .prev 之版本);未給＝上一份之版本(前一版)
 * @param {String} [opt.lockFile] 輸入執行鎖檔路徑(與管線同一把)，給了即取鎖、管線持鎖中即拒絕
 * @param {Integer} [opt.staleMs] 輸入取鎖時持鎖者未宣告陳舊期限所用之毫秒數
 * @param {String} [opt.stamp] 輸入封存檔名之時間戳，預設 clock.stamp8()
 * @param {String} [opt.by='api'] 輸入執行者(待判結案之處置方式記之)
 * @param {Object} [opt.clock] 輸入時鐘(取 iso8、stamp8)，未給依預設時區
 * @param {Boolean} [opt.dryRun=false] 輸入預演:只驗可否回退並回 plan,不寫任何東西
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok:Boolean, notFound?:Boolean, locked?:Boolean, refused?:String(ROLLBACK_REFUSED 之值), dryRun?:Boolean, concept, coreId,
 *   fromVersion, toVersion, archived:Array(被回退之版本之封存檔), holdsResolved:Array(結案之登錄鍵), produced?:Object(寫入 changelog 之產出鏈), plan?:{ coreId, fromVersion, toVersion, archive:Boolean, holds:Array }(預演), messages:Array }
 * @throws {Error} stores 缺必要方法、opt.dirs 缺 core／state、opt.domain 缺 renderState 時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await rollbackCore(stores, '光合作用', { dirs, domain, toVersion: 3, lockFile })
 * console.log(r.ok, r.fromVersion, r.toVersion)
 */
export async function rollbackCore(stores, conceptArg, opt = {}) {

    //check, 本函數實際用到之集合方法須一併檢查(缺者要到寫入之後才拋原生 TypeError,留下半套狀態)
    if (!isobj(stores) || !isobj(stores.cores) || !isfun(stores.cores.select) || !isfun(stores.cores.replace)) {
        throw new Error('rollbackCore 需要 stores.cores.select 與 stores.cores.replace（cores 集合）')
    }
    if (!isobj(stores.notes) || !isfun(stores.notes.select)) {
        throw new Error('rollbackCore 需要 stores.notes.select（notes 集合）')
    }
    if (!isobj(opt) || !isobj(opt.dirs) || !isestr(opt.dirs.core) || !isestr(opt.dirs.state)) {
        throw new Error(`rollbackCore 需要 opt.dirs（${EXTRACT_API_HINT.regenDirs}）`)
    }
    if (!isobj(opt.domain) || !isfun(opt.domain.renderState)) {
        throw new Error('rollbackCore 需要 opt.domain（管線所用之提煉 domain，如 flow.info().domains.extract；md 投影以之渲染）')
    }
    if (!['get', 'replace', 'select'].every((m) => isfun(stores.holds?.[m]))) {
        throw new Error(`rollbackCore 需要 holds 集合（具 get／replace／select 方法；${EXTRACT_API_HINT.holdsStore}）——該核心之未結待判須隨回退結案`)
    }
    const messages = []
    const fail = (refused, text, extra = {}) => ({ ok: false, refused, notFound: refused === ROLLBACK_REFUSED.noCore, archived: [], holdsResolved: [], messages: [...messages, text], ...extra })
    if (!isestr(conceptArg)) return fail(ROLLBACK_REFUSED.noCore, `找不到概念「${conceptArg}」的核心知識`)

    let lock = null
    if (isestr(opt.lockFile)) {
        lock = acquireLock(opt.lockFile, Number.isInteger(opt.staleMs) && opt.staleMs > 0 ? { staleMs: opt.staleMs } : {})
        if (!lock.ok) return { ok: false, locked: true, archived: [], holdsResolved: [], messages: [`管線執行中，未回退：${lock.message}`] }
    }
    try {
        const dirs = opt.dirs
        const clock = isfun(opt.clock?.iso8) && isfun(opt.clock?.stamp8) ? opt.clock : resolveClockCfg(opt.clock)
        const at = clock.iso8()
        const stamp = isestr(opt.stamp) ? opt.stamp : clock.stamp8()
        const by = isestr(opt.by) ? opt.by.trim() : 'api'
        const key = normalizeConcept(conceptArg)
        const cores = await stores.cores.select()
        const target = coreForKey(cores, 'concept', key) || coreForKey(cores, 'category', key)
        if (!target) return fail(ROLLBACK_REFUSED.noCore, `找不到概念「${conceptArg}」的核心知識`)
        const id = target.id
        const store = coreStoreOf(dirs)
        const cur = store.load(id)
        if (cur.status !== 'ok') return fail(ROLLBACK_REFUSED.stateUnreadable, `概念「${target.concept}」之狀態檔不是可寫之正常狀態（${cur.status}${cur.error ? `：${cur.error}` : ''}），不回退（先跑一輪提煉段之維護修復）`, { concept: target.concept, coreId: id })
        const prev = store.loadPrev(id)
        const from = cur.state.version
        const base = { concept: target.concept, coreId: id, fromVersion: from }
        if (prev.status !== 'ok') return fail(ROLLBACK_REFUSED.noPrev, `概念「${target.concept}」（現為 v${from}）無上一份狀態（.prev）可讀（${prev.status}），不回退`, base)
        const to = opt.toVersion === undefined || opt.toVersion === null ? prev.state.version : opt.toVersion
        if (!(Number.isInteger(to) && to >= 0)) return fail(ROLLBACK_REFUSED.toVersionInvalid, 'toVersion 須為非負整數', base)
        if (to >= from) return fail(ROLLBACK_REFUSED.toVersionNotLower, `概念「${target.concept}」現為 v${from}，toVersion ${to} 不低於現版，不回退`, { ...base, toVersion: to })
        if (prev.state.version !== to) return fail(ROLLBACK_REFUSED.versionUnavailable, `概念「${target.concept}」現為 v${from}，上一份狀態（.prev）為 v${prev.state.version}，無從回到 v${to}（只可回到 .prev 之版本；回退來源唯一為 .prev）`, { ...base, toVersion: to })
        if (normalizeConcept(prev.state.concept) !== normalizeConcept(cur.state.concept)) return fail(ROLLBACK_REFUSED.prevMismatch, `上一份狀態屬概念「${prev.state.concept}」而非「${cur.state.concept}」，不回退`, { ...base, toVersion: to })

        const holdsToClose = await coreHoldsToCloseOf(stores.holds, id)
        const info = { ...base, toVersion: to }
        if (opt.dryRun === true) {
            messages.push(`預演：將回退「${target.concept}」v${from} → v${to}（封存現版狀態檔複本 1 份、重渲染 md 與記錄、結案待判 ${holdsToClose.length} 則）；未寫入`)
            return { ok: true, dryRun: true, ...info, archived: [], holdsResolved: [], plan: { coreId: id, fromVersion: from, toVersion: to, archive: true, holds: holdsToClose.map((h) => h.id) }, messages }
        }

        // ③被回退之版本封存(複本;主檔仍在)
        const snap = store.snapshot(id, ARCHIVE_TAGS.rollback, stamp)
        const archived = snap ? [snap.replace(/\\/g, '/')] : []
        messages.push(archived.length ? `已封存被回退之 v${from}：${archived[0]}` : `無狀態檔複本可封存（v${from}）`)
        // ④回退後之狀態:.prev 之內容＋一筆 rollback 之 changelog(產出鏈:不呼叫 AI;輪次外 stamp 為 null);renderHashes 取現版者(磁碟上之 md 即現版所渲染——
        //   否則手改偵測把現版之 md 當成手改而另存)
        const produced = makeProduced({ stamp: null, stage: 'rollback', seat: null, provider: null, pkg: pkgIdOf(import.meta.url), at })
        const restored = clone(prev.state)
        const lastBatch = Array.isArray(restored.changelog?.[restored.changelog.length - 1]?.batch) ? restored.changelog[restored.changelog.length - 1].batch : []
        restored.changelog = [...(Array.isArray(restored.changelog) ? restored.changelog : []), { version: to, at, mode: 'rollback', batch: [...lastBatch], from, by, produced }]
        restored.renderHashes = Array.isArray(cur.state.renderHashes) ? [...cur.state.renderHashes] : []
        let saved
        try {
            saved = store.save(id, restored, { expectRev: cur.state.rev })
        }
        catch (e) {
            if (snap) fs.rmSync(snap, { force: true })
            return fail(ROLLBACK_REFUSED.stateUnreadable, `回退未寫入（${e.message}）`, info)
        }
        // ⑤md 投影與 cores 記錄(高水位:記錄之 rev、id 計數不倒退;條目編號之新配發不與被回退之版本撞號)
        const notes = await stores.notes.select()
        const notesById = new Map(notes.map((n) => [n.id, n]))
        const noTop = createNoTopCache(path.join(dirs.state, NO_TOP_CACHE_FILE), opt.domain.evidenceRule ?? null)
        const env = { aux: coreAuxDirs(dirs), at, stamp, store, log: { warn: (m) => messages.push(m) }, cores, stores, notesById, noTopOf: (nid) => noTop.of(notesById.get(nid)) }
        await writeProjections({ id, file: target.file || path.join(dirs.core, `${id}.md`), state: saved, env, domain: opt.domain })
        messages.push(`已回退「${target.concept}」：v${from} → v${to}（md 與記錄已重渲染）`)
        // ⑥結案該核心之待判(未結與已豁免;比照 regenCore)
        const how = `回退（rollbackCore；執行者 ${by}）：核心已自 v${from} 回退至 v${to}，其後各版之條目不再存在，舊登錄與舊裁示不得作用於回退後之條目`
        const holdsResolved = []
        for (const h of holdsToClose) {
            await resolveHold(stores.holds, h.id, { at, how })
            holdsResolved.push(h.id)
        }
        if (holdsResolved.length) messages.push(`已結案該核心之待判 ${holdsResolved.length} 則`)
        return { ok: true, ...info, archived, holdsResolved, produced, messages }
    }
    finally {
        lock?.release?.()
    }
}

export default { ROLLBACK_REFUSED, rollbackCore }
