// extractMaintain.mjs — 提煉段之無 AI 維護(stages 層;每輪開工、時間守門之前):重練意圖之消化、前次中斷之投影補做(dirty)、
//   逐主核心之維護(maintainCores)與關聯變更之影響之收尾
//
// 【要點 2:知識或關聯變更時更新影響範圍內之高階知識】核心對其出處負責到底——本檔只做「察覺」與無 AI 之寫入:
//   ①首見基準(本版之前建立者:已消化筆記之內容鍵、觸及已消化筆記之現存衝突邊)②撤出處／恢復以「刪除墓碑」驅動(關聯段之明示刪除;讀取為
//     關聯套件之 openDeletions,經 core/relatePackage):已消化、記錄不在、有墓碑 → 撤;已撤、記錄在、無墓碑 → 恢復;記錄不在而無墓碑 → 只計數
//     (懸空,告警)——讀不到不等於刪除(關聯段同一原則)③已消化未引用者之內容變更 → 靜默重設基準 ④投影更新(證據現值、標題、版型)
//   ⑤重審項統計(只概念層主核心;判定在 standards/recheck)。逐核心隔離(一個壞狀態檔不影響其他核心與本輪提煉)。
// 【已見衝突之回頭檢查(ES5)】衝突已不成立者(帳驅動)與處置結構已消失者(爭議被拆解、取代或撤回拿掉了處置;判定在 standards/conflictDisposition 之
//   es5ReopenOf,與符合度掃描、存量處置同一份)皆自 seenConflicts 移出(記帳欄位,不升版),由重審項之新衝突重新呈現;已交 RS4 核對者不動。
// 【快取與檔名】內容鍵與推定判定之快取在 stores/contentCache;帳檔之檔名在 stores/extractFiles。
// 【不做】AI 呼叫、選題(提煉段)、投影與落盤之實作(stores/coreProjection)。

import fs from 'fs'
import path from 'path'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { appendJsonlRows, oneline, jsonClone as clone } from '../core/capturePackage.mjs'
import { standardsFixProducedOf } from '../core/producedChain.mjs'
import { openDeletions } from '../core/relatePackage.mjs'
import { isPrimaryCore } from '../stores/conceptSelection.mjs'
import { saveNoTopCache } from '../stores/contentCache.mjs'
import { evidenceSnapshot, persistMechanical, renderOf, repairCore, writeProjections } from '../stores/coreProjection.mjs'
import { citedNotesOf, essenceNeedOf, releaseHeld, withdrawSources, withdrawnOf } from '../stores/coreState.mjs'
import { EDGE_SEEN_FILE, EXTRACT_LEDGER_SHAPES, IMPACT_LEDGER_FILE, IMPACT_RETRY_FILE, readLedgerJson, saveLedgerJson } from '../stores/extractFiles.mjs'
import { EXTRACT_API_HINT } from '../stores/extractHolds.mjs'
import { coreLedgerKeyOf } from '../stores/extractLedger.mjs'
import { rebaselineDone, rebaselineIdsOf } from '../stores/rebaseline.mjs'
import { readRegenIntents, writeRegenIntents } from '../stores/regenIntent.mjs'
import { es5ReopenOf } from '../standards/conflictDisposition.mjs'
import { disputeDueOf, disputeHeldIdsOf } from '../standards/disputeCheck.mjs'
import { claimChecksOf } from '../standards/holdSettle.mjs'
import { orphanNeedsOf } from '../standards/orphanCheck.mjs'
import { RECHECK_REASONS, conflictGoneOf } from '../standards/recheck.mjs'
import { applyImpact, edgeSnapshotOf, impactLedgerRowsOf, impactOfCore } from '../standards/relationImpact.mjs'
import { stockNeedsOf } from '../standards/supportStock.mjs'


/** 狀態檔修復之熔斷:維護段單輪修復(自上一版落盤)＋隔離逾此數即停手、其餘留待下輪——單輪大量壞檔多半是磁碟或同步之問題,不是逐檔之偶發,
 *   逐檔處置會把更多上一版推成現值 */
const STATE_REPAIR_FUSE = 5

/**
 * 重練意圖之消化(每輪開工;ops/regenCore 先記之意圖):已完成者清該核心之失敗帳與影響留待後刪意圖(帳之寫者只有管線);
 *   未完成者(封存中途中斷)每輪 WARN(須見)、意圖留著——重跑 regenCore 即續作
 *
 * @param {Object} env 輸入本段環境(dirs、ledger、stamp)
 * @param {Object} log 輸入日誌
 * @returns {void} 無回傳值(就地清帳、刪除已完成之意圖)
 * @example
 * need test in nodejs.
 *
 * consumeRegenIntents({ dirs, ledger, stamp }, log)
 */
export function consumeRegenIntents(env, log) {
    const intents = readRegenIntents(env.dirs, { stamp: env.stamp, log })
    const ids = Object.keys(intents.cores)
    if (!ids.length) return
    const retryFile = path.join(env.dirs.state, IMPACT_RETRY_FILE)
    let retry = null
    let retryTouched = false
    let ledgerTouched = false
    const left = {}
    for (const id of ids) {
        const it = intents.cores[id]
        if (!isobj(it)) continue
        if (it.done !== true) {
            log.warn(`提煉重練意圖未完成：「${it.concept || id}」（${id}；${it.by || 'api'} 於 ${it.at || '?'} 發起）封存中途中斷，請重跑 regenCore 續作`)
            left[id] = it
            continue
        }
        if (env.ledger.remove(coreLedgerKeyOf({ scope: it.scope, key: String(it.key) }))) ledgerTouched = true
        if (retry === null) retry = readLedgerJson(retryFile, { shape: EXTRACT_LEDGER_SHAPES.impactRetry, stamp: env.stamp, log }) || {}
        if (retry[id] !== undefined) {
            delete retry[id]
            retryTouched = true
        }
        log.warn(`提煉重練意圖：已消化「${it.concept || id}」（${id}；${it.by || 'api'}）——清其失敗帳與影響留待，下一輪以現有筆記從頭重練`)
    }
    if (ledgerTouched) env.ledger.save()
    if (retryTouched) saveLedgerJson(retryFile, Object.keys(retry).length ? retry : null)
    writeRegenIntents(env.dirs, { cores: left })
}

/**
 * 前次中斷者之投影補做(dirty 標記;無 AI):標記所指之核心可讀者以狀態重建投影並計一次修復,標記一律清除
 *
 * @param {Object} env 輸入本段環境(aux、cores、dirs、store)
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} log 輸入日誌
 * @param {Object} stat 輸入本段統計(累計 repaired)
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined
 * @example
 * need test in nodejs.
 *
 * await redoDirtyProjections({ aux, cores, dirs, store }, domain, log, stat)
 * console.log(stat.repaired)
 */
export async function redoDirtyProjections(env, domain, log, stat) {
    if (fs.existsSync(env.aux.dirty)) {
        for (const id of fs.readdirSync(env.aux.dirty)) {
            const r = env.store.load(id)
            if (r.status === 'ok') {
                const rec = env.cores.find((c) => c.id === id)
                const wp = await writeProjections({ id, file: path.join(env.dirs.core, `${id}.md`), state: r.state, env, domain })
                log.warn(`提煉投影補正[${r.state.concept}]：前次落盤中斷（${rec ? `記錄 rev ${rec.rev ?? '無'}` : '無記錄'} → 狀態 rev ${wp.state.rev}），已以狀態重建`)
                stat.repaired++
            }
            fs.rmSync(path.join(env.aux.dirty, id), { force: true })
        }
    }
}

/**
 * 關聯變更之影響(檢定標準 ES10)之維護收尾:處置帳(append)、留待事件(本輪應處置而未處置之主核心:維護例外、壞檔——只留觸及其已消化
 *   筆記者,與撤銷／改型／改理由)、邊庫快照(更新為現值;首見即建基準)。順序:先帳與留待、後快照——快照寫成即視為本輪事件已交付
 *
 * @param {Object} env 輸入本段環境(impact、cores、dirs、at)
 * @param {Object} log 輸入日誌
 * @param {Object} stat 輸入本段統計
 */
function finishImpact(env, log, stat) {
    const im = env.impact
    const state = env.dirs.state
    stat.impactEvents = im.events.length
    try {
        const rows = impactLedgerRowsOf(im.events, im.perCore, env.at)
        appendJsonlRows(path.join(state, IMPACT_LEDGER_FILE), rows) // 抓取套件之 JSONL 共用件(建目錄、先補尾換行;空列不寫)
        const retry = {}
        const badRecs = []
        for (const rec of env.cores.filter((c) => isPrimaryCore(c, env.cores))) {
            if (im.done.has(rec.id)) continue
            // 逐核心隔離:一筆記錄或其留待之事件壞了(錯形狀),其餘核心之留待照寫;壞者之事件保留原樣留待下輪(不丟)
            try {
                const mine = new Set(isarr(rec.noteIds) ? rec.noteIds : [])
                const keep = [...(isarr(im.retry[rec.id]) ? im.retry[rec.id] : []), ...im.events].filter((e) => isobj(e) && e.kind !== 'gone' && (e.kind !== 'add' || mine.has(e.from) || mine.has(e.to)))
                if (keep.length) retry[rec.id] = keep
            }
            catch (e) {
                badRecs.push(`${rec.id}（${oneline(e?.message, 80)}）`)
                if (im.retry[rec.id] !== undefined) retry[rec.id] = im.retry[rec.id]
            }
        }
        if (badRecs.length) log.warn(`提煉維護失敗[關聯影響留待]：${badRecs.length} 個核心之留待未能重算（${badRecs.slice(0, 3).join('、')}），原樣留待下輪`)
        saveLedgerJson(path.join(state, IMPACT_RETRY_FILE), Object.keys(retry).length ? retry : null)
        stat.impactRetryCores = Object.keys(retry).length
        saveLedgerJson(path.join(state, EDGE_SEEN_FILE), edgeSnapshotOf(im.edges, env.at))
        if (im.baseline) log.info(`提煉關聯影響：${im.snapshotCorrupt ? '快照損壞已隔離，' : '首見，'}以現行 ${im.edges.length} 條邊建立快照（本輪不產事件）`)
        else if (im.events.length) log.info(`提煉關聯影響：事件 ${im.events.length} 則；夥伴候選 +${stat.impactCandidates}、關聯變更重審 ${stat.impactRecheck}、移出候選 ${stat.impactDropped}${stat.impactRetryCores ? `；${stat.impactRetryCores} 個核心未能處置，事件留待下輪` : ''}`)
    }
    catch (e) {
        // 快照未更新 → 下輪以同一舊快照重算差分(處置為冪等:候選已在即不重加、重審項同邊同理由以新代舊)
        stat.maintainFailed++
        log.warn(`提煉維護失敗[關聯影響收尾]：${oneline(e?.message, 160)}`)
    }
}

/**
 * 每輪開工之無 AI 維護(停用輪之後、時間守門之前;順序 dirty 補做 → 本步 → 選題):逐主核心一次載入、至多一次寫入——
 *   ①首見基準(本版之前建立者:已消化筆記之內容鍵、觸及已消化筆記之現存衝突邊)②撤出處／恢復(刪除墓碑驅動)
 *   ③已消化未引用者之內容變更 → 靜默重設基準 ③′衝突已不成立者與已見衝突之處置結構已消失者(ES5 回頭檢查)移出 seenConflicts
 *   ④投影更新(證據現值、標題、版型)⑤重審項統計(只概念層主核心)。
 *   逐核心隔離(一個壞狀態檔不影響其他核心與本輪提煉)。
 *
 * @param {Object} env 輸入本段環境(含 contentCache、recheck:Map、relEdges、rs4Held:Set|null〔已交 RS4 核對之邊 id;非 Set 者 ES5 回頭檢查不處置〕)
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} log 輸入日誌
 * @param {Object} stat 輸入本段統計(就地累計)
 * @param {Object} k 輸入 settings.extract
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined(結果就地累計於 stat 與 env)
 * @example
 * need test in nodejs.
 *
 * const stat = { repaired: 0 }
 * await maintainCores(env, domain, log, stat, 4)
 */
export async function maintainCores(env, domain, log, stat, k) {
    const cache = env.contentCache
    if (!cache.enabled) log.info('提煉：domain 未提供內容鍵版本（contentKeyVersion），本輪不偵測筆記內容變更')
    const del = openDeletions(env.dirs.state)
    // 重設內容基準之指示(stores/rebaseline 之 requestRebaseline 寫入之逐 id 名單;批次格式改寫觸發內容變更守門時用):名單內被引用而內容已變者以現值為基準、
    //   不重審。名單檔壞了即隔離並 WARN(不處置則永不生效);維護畢只刪已處置之 id(所屬核心維護失敗者保留至下輪)
    const rebaselineIds = new Set(cache.enabled ? rebaselineIdsOf(env.dirs, { stamp: env.stamp, onError: (m) => log.warn(`提煉：${m}`) }) : [])
    const rebaseline = rebaselineIds.size > 0
    const rebaselineKeep = new Set()
    let rebased = 0
    const keyOf = (nid) => cache.keyOf(env.notesById.get(nid))
    const bodyOf = (nid) => cache.bodyOf(env.notesById.get(nid))
    // 衝突邊之兩端(③′之二 ES5 回頭檢查之判定材料;與符合度掃描 es5CtxOf 同為衝突型之現行邊——relEdges 讀入時型別已以現名呈現)
    const conflictEnds = new Map(env.relEdges.map((e) => [e.id, [e.from, e.to]]))
    const titleOf = (nid) => env.notesById.get(nid)?.title || nid
    // 出處版本紀錄:內容鍵＋版本＋正文雜湊(與章節設定無關;換版時分辨格式變動與真實修訂)
    const seenOf = (nid, kk) => {
        const h = bodyOf(nid)
        return { k: kk, v: cache.version, ...(h ? { h } : {}) }
    }
    const changedNotes = new Set()
    const dangling = []
    // 壞檔之全量處置(選中與否皆修;熔斷見 STATE_REPAIR_FUSE):上一版救得回者修復(隔離、高水位、落盤、投影),救不回者隔離並 ERROR
    let fuse = 0
    let fused = false
    for (const rec of env.cores.filter((c) => isPrimaryCore(c, env.cores))) {
        try {
            let r = env.stateCache?.get(rec.id) || env.store.load(rec.id)
            if (r.status === 'recovered' || r.status === 'corrupt') {
                if (fused) continue
                if (fuse >= STATE_REPAIR_FUSE) {
                    fused = true
                    log.warn(`提煉狀態檔熔斷：本輪已修復或隔離 ${fuse} 份核心狀態檔（上限 ${STATE_REPAIR_FUSE}），其餘留待下輪——單輪大量壞檔多半是磁碟或同步之問題，請先查 ${env.aux.archive.replace(/\\/g, '/')}`)
                    continue
                }
                fuse++
                if (r.status === 'corrupt') {
                    const moved = env.store.quarantine(rec.id, env.stamp)
                    log.error(`提煉[${rec.concept}]：狀態檔毀損且無上一版（${oneline(r.error, 160)}），已隔離為 ${String(moved).replace(/\\/g, '/')}；本概念跳過、不覆寫。請自備份或版控還原狀態檔`)
                    continue
                }
                const rp = await repairCore(env, domain, { id: rec.id, rec, file: rec.file, state: r.state, lost: r.lost })
                log.warn(`提煉狀態還原[${rec.concept}]：狀態檔${r.lost ? '遺失' : `毀損（${oneline(r.error, 120)}），已隔離為 ${rp.moved}`}，已由上一版還原並落盤（落後一次寫入；該次所用之筆記將重新待提煉）`)
                stat.repaired++
                r = { status: 'ok', state: rp.state }
            }
            if (r.status !== 'ok') continue // 遺失而無上一版、他版、讀不了:由選中時之 loadState 記 ERROR 並落帳
            const before = clone(r.state) // 程式寫入之不變式(persistMechanical):以載入時之狀態為前
            let s = r.state
            let touched = false
            const revivedIds = [] // 出處恢復而一併還原之 ES8 撤回(⑱;不變式須列入 touched)
            // ①首見:本版之前建立(無 lineage)者,以現值為基準——不視為變更(同摘要之同步雜湊回填)
            if (!isobj(s.lineage)) {
                if (cache.enabled) {
                    for (const nid of s.consumed || []) {
                        const kk = env.notesById.has(nid) ? keyOf(nid) : null
                        if (kk !== null) s.seen[nid] = seenOf(nid, kk)
                    }
                }
                const consumed = new Set(s.consumed || [])
                s.seenConflicts = [...new Set([...(s.seenConflicts || []), ...env.relEdges.filter((e) => consumed.has(e.from) || consumed.has(e.to)).map((e) => e.id)])]
                s.lineage = { at: env.at }
                touched = true
                stat.baselined++
            }
            else if (cache.enabled) {
                // 內容鍵換版(章節設定或正規化規則改了):正文雜湊相同 → 只是鍵之定義變了,重設基準;不同 → 內容也改了,記為已變(k 置空 → 重審項 changed);
                //   舊紀錄無正文雜湊 → 無從分辨,重設基準並計數(unverifiable)。同版而尚無正文雜湊、內容鍵未變者補記(此後換版即可分辨);已消化而尚無基準者補記
                for (const nid of s.consumed || []) {
                    const e = s.seen[nid]
                    const kk = env.notesById.has(nid) ? keyOf(nid) : null
                    if (kk === null) continue
                    if (isobj(e) && e.v === cache.version) {
                        if (!e.h && e.k === kk && bodyOf(nid)) {
                            s.seen[nid] = { ...e, h: bodyOf(nid) }
                            touched = true
                        }
                        continue
                    }
                    if (isobj(e) && e.h && bodyOf(nid) && e.h !== bodyOf(nid)) {
                        s.seen[nid] = { k: '', v: cache.version, h: e.h }
                        stat.versionChanged++
                    }
                    else {
                        if (isobj(e) && !e.h) stat.unverifiable++
                        s.seen[nid] = seenOf(nid, kk)
                    }
                    touched = true
                }
            }
            // ②撤出處／恢復:墓碑驅動;記錄不在而無墓碑者只計數(懸空)
            const W = withdrawnOf(s)
            const gone = (s.consumed || []).filter((id) => !env.notesById.has(id))
            const toWithdraw = gone.filter((id) => del.has(id) && !W.has(id)).map((id) => ({ id, title: del.titleOf(id), reason: 'deleted' }))
            const toRestore = [...W].filter((id) => env.notesById.has(id) && !del.has(id))
            const dang = gone.filter((id) => !del.has(id))
            if (dang.length) {
                stat.dangling += dang.length
                dangling.push(`${rec.concept}×${dang.length}`)
            }
            if (toWithdraw.length || toRestore.length) {
                // 產出鏈(不呼叫 AI 之確定性寫入;stage standards-fix):stamp＝本輪 ctx.stamp(輪次內;手建 env 未給者 null)
                const w = withdrawSources(s, { withdraw: toWithdraw, restore: toRestore, at: env.at, produced: standardsFixProducedOf({ stamp: env.roundStamp ?? null, at: env.at }) })
                s = w.state
                touched = true
                stat.withdrawn += w.withdrawn.length
                stat.restored += w.restored.length
                revivedIds.push(...(w.revived || []))
                stat.orphanRevived += (w.revived || []).length
                log.info(`提煉出處${w.withdrawn.length ? `撤出[${rec.concept}]：${toWithdraw.map((x) => x.title).join('、')}（筆記已刪除）` : `恢復[${rec.concept}]：${w.restored.join('、')}`}${w.bumped ? `；影響〔${w.affected.join('〕〔')}〕，v${s.version}` : '；不影響有效條目'}${(w.revived || []).length ? `；ES8 撤回之〔${w.revived.join('〕〔')}〕隨出處恢復而還原` : ''}`)
            }
            // ③已消化而未被引用者之內容變更:不重審(核心不依賴之),靜默重設基準;被引用者只在重設名單內(逐 id)才重設
            if (cache.enabled) {
                const cited = citedNotesOf(s)
                for (const nid of s.consumed || []) {
                    if ((cited.has(nid) && !rebaselineIds.has(nid)) || !isobj(s.seen[nid]) || !env.notesById.has(nid)) continue
                    const kk = keyOf(nid)
                    if (kk === null || kk === s.seen[nid].k) continue
                    s.seen[nid] = seenOf(nid, kk)
                    touched = true
                    if (cited.has(nid)) rebased++
                }
            }
            // ③′衝突已不成立(關聯段重評之撤銷／降級;帳驅動)而無未決爭議涉及者:自 seenConflicts 移出——日後再成為衝突即為新衝突
            if ((s.scope || 'concept') === 'concept' && env.conflictEvents.length) {
                const { orphans } = conflictGoneOf(s, { conflictEvents: env.conflictEvents, conflictIds: env.conflictIds, notesById: env.notesById, keyOf })
                if (orphans.length) {
                    const drop = new Set(orphans)
                    s.seenConflicts = (s.seenConflicts || []).filter((x) => !drop.has(x))
                    touched = true
                    stat.conflictGonePruned += orphans.length
                }
            }
            // ③′之二已見衝突之處置結構已消失(檢定標準 ES5 回頭檢查;不限概念層,範圍同符合度掃描與存量處置):入已見當下之處置(爭議、取代、加條件之修正)
            //   日後被拆解、取代或撤回拿掉,邊卻留在 seenConflicts——既不再呈現也不交 RS4,符合度掃描判違反而管線無從自癒。兩端皆為已消化存活筆記、無處置結構
            //   (不限版)且未交 RS4 核對者(es5ReopenOf,與掃描、存量處置同一判定)自 seenConflicts 移出(記帳欄位,不升版)→ 概念層之重審項 conflict
            //   下輪重新呈現,收尾走原有機制(起草處置、宣告非對立交 RS4、逾次交 RS4;有界)。已交 RS4 核對之邊集未讀入(env.rs4Held 非 Set)→ 不處置
            if ((s.seenConflicts || []).length) {
                const reopen = es5ReopenOf(s, { conflictEndsOf: (eid) => conflictEnds.get(eid) || null, rs4Held: env.rs4Held })
                if (reopen.length) {
                    const drop = new Set(reopen.map((x) => x.eid))
                    s.seenConflicts = s.seenConflicts.filter((x) => !drop.has(x))
                    touched = true
                    stat.conflictReopened += reopen.length
                    log.info(`提煉[${rec.concept}]：${reopen.length} 條已見衝突之處置結構已消失（爭議拆解／取代／撤回），移出已見、下輪重新呈現（ES5）：${reopen.slice(0, 3).map((x) => x.ends.map(titleOf).join(' ⇄ ')).join('；')}${reopen.length > 3 ? '…' : ''}`)
                }
            }
            // ③″關聯變更之影響(檢定標準 ES10;開啟時,概念層):本輪事件(＋前次維護失敗而留待之事件)逐核心處置——夥伴候選之增刪、
            //   關聯變更之重審項、已刪筆記之夥伴移除;處置列入影響帳(維護後寫)
            let impactDone = null
            if (env.impact && (s.scope || 'concept') === 'concept') {
                const evs = [...(env.impact.retry[rec.id] || []), ...env.impact.events]
                impactDone = { core: rec.id, rows: [], n: [0, 0, 0] }
                if (evs.length || isobj(s.partners)) {
                    const plan = impactOfCore(s, evs, { isConflict: env.impact.isConflict, at: env.at })
                    const ap = applyImpact(s, plan, { gone: (nid) => !env.notesById.has(nid) && del.has(nid) })
                    if (ap.changed) {
                        s = ap.state
                        touched = true
                    }
                    impactDone.rows = [...plan.rows, ...ap.pruned.map((nid) => ({ kind: 'note-deleted', edgeId: '', from: nid, to: '', type: '', oldType: '', action: 'drop-candidate', why: `夥伴候選〈${nid}〉之筆記已刪除` }))]
                    impactDone.n = [plan.addPartners.size, plan.recheck.length, plan.dropPartners.size + ap.pruned.length]
                }
            }
            // ③‴隔離之解除(ES9 存量;coreState ⑲):使用者 waive(保留主張)之待判 → 解除隔離(記帳欄位,不升版)
            const waived = env.stockWaived?.get(rec.id)
            if (waived?.size && isobj(s.held)) {
                const rl = releaseHeld(s, [...waived])
                if (rl.released.length) {
                    s = rl.state
                    touched = true
                    stat.stockReleased += rl.released.length
                    log.info(`提煉[${rec.concept}]：使用者豁免之〔${rl.released.join('〕〔')}〕解除隔離（ES9 存量覆核判不了 → 保留）`)
                }
            }
            // ④投影更新:以現值(標題、分類、存活出處)重算證據並渲染;與上次渲染不同、證據欄位有變或 md 不在 → 落盤(只 rev+1)
            const ev0 = evidenceSnapshot(s)
            if (domain.evidence?.apply) domain.evidence.apply(s, env.notesById)
            const hash = renderOf(s, domain, env, rec.id).hash
            const projChanged = evidenceSnapshot(s) !== ev0 || hash !== (s.renderHashes || []).slice(-1)[0] || !fs.existsSync(rec.file)
            if (projChanged && !touched) stat.projected++
            if (touched || projChanged) s = await persistMechanical(env, domain, { id: rec.id, file: rec.file, state: s, expectRev: before.rev, before, touched: revivedIds })
            // ③″之處置已落盤(或無變更)才算本核心已處置:列入影響帳;未達此處者(例外、壞檔)之事件留待下輪
            if (impactDone) {
                env.impact.perCore.push({ core: rec.id, rows: impactDone.rows })
                env.impact.done.add(rec.id)
                stat.impactCandidates += impactDone.n[0]
                stat.impactRecheck += impactDone.n[1]
                stat.impactDropped += impactDone.n[2]
            }
            // ⑤′本質之需求(ES6):本質專步據以選核心
            const en = essenceNeedOf(s).need
            if (en) env.essenceNeeds.set(rec.id, en)
            // ⑤″爭議覆核之到期項(ES14;開啟時):終審存疑之未解決爭議,起草者已有一次機會(核心已再升版)或存疑逾期;待判中者不排
            if (env.disputeCheck) {
                const dc = env.disputeCheck
                const due = disputeDueOf(s, { minVersions: dc.minVersions, waitDays: dc.waitDays, nowMs: Date.parse(env.at), heldIds: disputeHeldIdsOf(s, { held: env.disputeHeld?.get(rec.id), waived: env.disputeWaived?.get(rec.id) }), keyOf: env.noteKeyOf })
                if (due.length) env.disputeNeeds.set(rec.id, due)
            }
            // ⑤‴出處支持之存量覆核(ES9 存量)與失撐主張(ES8)之到期項(開啟時;主核心含概念層與類別層——終審 §3 D5m):以檢核紀錄(內容雜湊＋標準版本)判須(重)檢者
            if (env.supportStock || env.orphanCheck) {
                const recs = await claimChecksOf(env, rec.id, s)
                const recOf = (oid) => recs.get(oid) || null
                if (env.supportStock) {
                    const need = stockNeedsOf(s, { coreId: rec.id, recOf, keyOf: env.noteKeyOf, retry: env.stockRetry.get(rec.id) })
                    if (need.length) env.stockNeeds.set(rec.id, need)
                }
                if (env.orphanCheck) {
                    const need = orphanNeedsOf(s, { coreId: rec.id, recOf, has: (nid) => env.notesById.has(nid), keyOf: env.noteKeyOf, retry: env.orphanRetry.get(rec.id) })
                    if (need.length) env.orphanNeeds.set(rec.id, need)
                }
            }
            // ⑤重審項(概念層主核心):本輪供選篇與僅重審 pass 使用;此處統計
            const items = (s.scope || 'concept') === 'concept' ? env.recheckItemsFor(s, rec.id) : []
            env.recheck.set(rec.id, items)
            for (const x of items) if (x.reason === RECHECK_REASONS.changed) changedNotes.add(x.id)
            stat.recheckChanged += items.filter((x) => x.reason === RECHECK_REASONS.changed).length
            stat.recheckConflict += items.filter((x) => x.reason === RECHECK_REASONS.conflict).length
            stat.recheckConflictGone += items.filter((x) => x.reason === RECHECK_REASONS.conflictGone).length
            stat.recheckRelation += items.filter((x) => x.reason === RECHECK_REASONS.relationChanged || x.reason === RECHECK_REASONS.conflictReason).length
            stat.recheckPartner += items.filter((x) => x.reason === RECHECK_REASONS.partner).length
        }
        catch (e) {
            stat.maintainFailed++
            for (const nid of isarr(rec.noteIds) ? rec.noteIds : []) if (rebaselineIds.has(nid)) rebaselineKeep.add(nid)
            log.warn(`提煉維護失敗[${rec.concept}]：${oneline(e?.message, 200)}`)
        }
    }
    delete env.stateCache // 清掃時之載入結果只供本段重用(狀態已改,不可再讀)
    try {
        cache.save()
    }
    catch (e) {
        log.warn(`提煉維護失敗[內容鍵快取]：${oneline(e?.message, 160)}`)
    }
    saveNoTopCache(env, log)
    if (env.impact) finishImpact(env, log, stat)
    if (rebaseline) {
        stat.rebaselined = rebased
        const done = [...rebaselineIds].filter((id) => !rebaselineKeep.has(id))
        if (done.length) rebaselineDone(env.dirs, done)
        log.info(`提煉重設內容基準（requestRebaseline 之名單 ${rebaselineIds.size} 篇）：被引用而內容已變之筆記 ${rebased} 處以現值為基準、不重審${rebaselineKeep.size ? `；${rebaselineKeep.size} 篇所屬核心維護失敗，指示保留至下輪` : ''}`)
    }
    if (stat.versionChanged || stat.unverifiable) log.info(`提煉內容鍵換版：正文亦改者 ${stat.versionChanged} 處記為內容變更（重審）${stat.unverifiable ? `；舊紀錄無正文雜湊而無從分辨者 ${stat.unverifiable} 處以現值為基準` : ''}`)
    if (dangling.length) log.warn(`提煉出處懸空：已消化之筆記記錄不存在且無刪除墓碑，未撤出處（${dangling.slice(0, 8).join('、')}）——${EXTRACT_API_HINT.dangling}`)
    // 大量內容變更守門:一次格式腳本或批次改寫不得無聲排入大量重審(每項一次 3+3)
    const guard = k.recheck.guard
    if (changedNotes.size > guard) {
        env.recheckBlocked = true
        stat.recheckBlocked = changedNotes.size
        log.warn(`提煉內容變更守門：本輪偵測到 ${changedNotes.size} 篇已提煉筆記內容變更（逾 ${guard}），暫不重審——屬內容修訂者請調高 extract.recheck.guard 放行；${EXTRACT_API_HINT.rebaseline}`)
    }
}

export default { consumeRegenIntents, redoDirtyProjections, maintainCores }
