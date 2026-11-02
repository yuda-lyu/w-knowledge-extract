// holdSettle.mjs — 提煉段之待判登錄與結案(standards 層;登錄件):落盤前之登錄(先記後寫之「記」;前像推入補償表)、落盤後之結案與檢核紀錄、
//   落盤失敗之補償、狀態無變之專步落帳、維護段之清掃(已不適用之未結待判),與主張層判定小組專步之材料(主張之檢核紀錄)
//
// 【先記後寫】每筆登錄之 ctx 記本次落盤後之 rev;落盤失敗依登錄之逆序還原前像(有前像者寫回、無者結案);清掃以登錄之 rev 判「落盤未完成」。
// 【使用者之裁示】已豁免而素材雜湊未變者不重登(素材變了才重提)。
// 【環境】各函數取提煉段之本段環境(env:stores.holds、stores.checks、at、promptId、notesById、noteKeyOf、supportCheck、store、cores、
//   disputeHeld、disputeWaived)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { count, holdKey, listHolds, oneline, pipelineDueOf, putHold, resolveHold, textValueOf as str, jsonClone as clone } from '../core/capturePackage.mjs'
import { RS4, checkKey, queueConflictCheck, recordCheck } from '../core/relatePackage.mjs'
import { CORE_STATUS } from '../stores/conceptSelection.mjs'
import { TERMINAL_SET, citedNotesOf } from '../stores/coreState.mjs'
import { CORE_HOLD_OBJECT, ES15, EXTRACT_HOLD_NEXT, HOLD_STALE_HOW_PREFIX, HOLD_UNDO_HOW, extractHoldDeadlineOf, itemOidOf, parseItemOid } from '../stores/extractHolds.mjs'
import { ES14, ES14_OBJECT } from './disputeCheck.mjs'
import { ES8 } from './orphanCheck.mjs'
import { EXTRACT_PANEL_WHY_LABELS } from './panelVotes.mjs'
import { ES9 } from './supportCheck.mjs'
import { CLAIM_OBJECT } from './supportStock.mjs'


/** 主張層 AI 標準(ES9 存量、ES8)之待判之下一步與說明 */
const CLAIM_HOLD_NEXT = { [ES9.std]: EXTRACT_HOLD_NEXT.claimSupport, [ES8.std]: EXTRACT_HOLD_NEXT.claimOrphan }

const CLAIM_HOLD_WORD = { [ES9.std]: '出處支持存量覆核判不了', [ES8.std]: '失撐主張找支持判不了' }

/**
 * 待判登錄(先記後寫之「記」;落盤之前):逾限筆記(ES15;未涵蓋逾限、md 讀不到逾限)、出處支持覆核判不了之筆記(ES9 筆記層;首次 pipeline、
 *   再登〔重送後仍判不了、重送後仍未納入〕改由使用者判讀——否則負責者 pipeline 之未結登錄每輪重送不止)、衝突交關聯段核對(RS4;經關聯套件之
 *   queueConflictCheck,已有未結者不重登、不補償)、爭議覆核判不了(ES14)、主張層判不了(ES9 存量、ES8)。
 *   每筆 ctx 記 rev(本次落盤後之 rev;維護段清掃據以判「落盤未完成」);登錄前之前像推入 opt.undo(落盤失敗之補償:有前像者寫回、無者結案),
 *   RS4 只在新登(queued)時推入。結案動作與檢核紀錄留落盤之後(closeHolds:待判為待辦、紀錄為已審之快取)
 *
 * @param {Object} env 輸入本段環境(stores.holds、at、promptId、notesById)
 * @param {Object} ctx 輸入管道脈絡(log)
 * @param {Object} o 輸入 { coreId, concept, ap:{ exhausted?, mdExhausted?, es9?, resendUncovered?, rs4?, es14?:{ held }, claimCheck?:{ std, res:{ held } } }, msg }
 * @param {Object} opt 輸入 { rev:Integer(本次落盤後之 rev), undo:Array(就地推入 { id, before }) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined
 * @example
 * need test in nodejs.
 *
 * const undo = []
 * await registerHolds(env, ctx, { coreId, concept: '黑洞', ap: { exhausted: ['n-a'] } }, { undo })
 */
export async function registerHolds(env, ctx, o, opt) {
    const ap = o.ap || {}
    const holds = env.stores.holds
    const deadline = extractHoldDeadlineOf(env.at)
    const rev = String(opt.rev)
    // 登錄(或再登);使用者已豁免且素材雜湊未變 → 不重登(裁示有效;終審 §3 D5e——素材變了才重提):回 false
    const put = async (h, hash) => {
        const id = holdKey(h.object, h.oid, h.std)
        const before = await holds.get(id)
        if (before?.status === 'waived' && str(hash) && str(before.ctx?.hash) === str(hash)) {
            count(o.msg, 'holdsWaivedKept')
            return false
        }
        await putHold(holds, { ...h, deadline, ctx: { ...(h.ctx || {}), rev, ...(str(hash) ? { hash: str(hash) } : {}) } }, env.at)
        opt.undo.push({ id, before: before ? clone(before) : null })
        return true
    }
    const md = new Set(ap.mdExhausted || [])
    const exhausted = ap.exhausted || []
    for (const nid of exhausted) {
        // 素材雜湊＝提示詞識別(提示詞或席位變更即重送;豁免後同一提示詞不重登)
        if (await put({ object: ES15.object, oid: itemOidOf(o.coreId, nid), std: ES15.std, reason: md.has(nid) ? `md 讀不到逾限：提煉「${o.concept}」多次讀不到此篇之 md 而出隊` : `未涵蓋逾限：提煉「${o.concept}」多次未交代此篇之去向而出隊`, next: EXTRACT_HOLD_NEXT.noteOverdue, owner: 'pipeline', ctx: { promptId: env.promptId, title: env.notesById.get(nid)?.title || '' } }, env.promptId)) count(o.msg, 'notesHeld')
    }
    if (exhausted.length) ctx.log.info(`提煉[${o.concept}]：${exhausted.length} 篇未涵蓋逾限，已登錄待判（ES15；提示詞或席位變更後重送）${md.size ? `；其中 md 讀不到逾限 ${exhausted.filter((x) => md.has(x)).length} 篇` : ''}`)
    const es9 = new Set(ap.es9 || [])
    // 負責者:同一篇之覆核判不了累計達 extract.standards.supportCheck.maxTries 次 → 使用者判讀(再登之 tries＝既有 tries＋1;首登 0)
    const maxTries = Number(env.supportCheck?.maxTries) || 3
    for (const nid of [...es9, ...(ap.resendUncovered || []).filter((x) => !es9.has(x))]) {
        const cur = await holds.get(holdKey(ES15.object, itemOidOf(o.coreId, nid), ES9.std))
        const again = cur?.status === 'open'
        // 重送後仍未納入者:只對本輪重送之未結登錄再登,其餘未涵蓋照未涵蓋之既有規則(noteTries)
        if (!es9.has(nid) && !(again && pipelineDueOf(cur))) continue
        const tries = again ? (Number(cur.tries) || 0) + 1 : 0
        const toUser = tries + 1 >= maxTries
        // 素材雜湊＝筆記之內容鍵(豁免後內容未變即不重登)
        if (await put({ object: ES15.object, oid: itemOidOf(o.coreId, nid), std: ES9.std, reason: `出處支持覆核判不了（${ES9.std}）：${es9.has(nid) ? `本篇所引之操作未納入「${o.concept}」${again ? `（重送後仍判不了，第 ${tries + 1} 次）` : ''}` : `重送後仍未納入「${o.concept}」（第 ${tries + 1} 次）`}`, next: toUser ? EXTRACT_HOLD_NEXT.noteSupportUser : EXTRACT_HOLD_NEXT.noteSupportRetry, owner: toUser ? 'user' : 'pipeline', ctx: { title: env.notesById.get(nid)?.title || '' } }, env.noteKeyOf(nid))) count(o.msg, 'notesHeldEs9')
    }
    if (es9.size) ctx.log.info(`提煉[${o.concept}]：${es9.size} 篇因出處支持覆核判不了而有操作未納入，已登錄待判（ES9）`)
    // 待審裁決之覆核判不了逾次者(workflow/pending 之 heldOps):移出待審、逐篇登錄使用者待判,ctx 存該操作(使用者可據以重提或豁免)
    for (const x of isarr(ap.es9Ops) ? ap.es9Ops : []) {
        const id = str(x.op?.id) || str(x.op?.into) || str(x.op?.ref)
        for (const nid of x.notes || []) {
            await put({ object: ES15.object, oid: itemOidOf(o.coreId, nid), std: ES9.std, reason: `出處支持覆核判不了（${ES9.std}）：待審之操作 ${x.op?.op}${id ? `〔${id}〕` : ''} 經 ${x.tries} 次裁決皆判不了，已自「${o.concept}」之待審移出`, next: EXTRACT_HOLD_NEXT.noteSupportUser, owner: 'user', ctx: { title: env.notesById.get(nid)?.title || '', op: JSON.stringify(x.op) } }, env.noteKeyOf(nid))
        }
        count(o.msg, 'pendingEs9Held')
    }
    if ((ap.es9Ops || []).length) ctx.log.info(`提煉[${o.concept}]：${ap.es9Ops.length} 項待審之操作因出處支持覆核屢判不了而移出待審，已逐篇登錄待判（ES9；使用者判讀）`)
    // 衝突之去向(ES5):判為非對立、或多次未處置者 → 交關聯段兩席核對此衝突是否成立(RS4)——物件與標準、期限、下一步皆關聯套件之定義
    for (const x of ap.rs4 || []) {
        const r = await queueConflictCheck(holds, { edgeId: x.edgeId, from: x.ends[0], to: x.ends[1], reason: x.reason, ctx: { core: o.coreId, rev }, at: env.at })
        if (r === 'queued') opt.undo.push({ id: holdKey(RS4.objectEdge, x.edgeId, RS4.std), before: null })
    }
    if ((ap.rs4 || []).length) ctx.log.info(`提煉[${o.concept}]：${ap.rs4.length} 條衝突交關聯段核對（RS4 待判；${ap.rs4.slice(0, 3).map((x) => x.reason).join('；')}）`)
    // 爭議與主張層之待判:素材雜湊由各專步給(h.hash;爭議之內容與出處之內容鍵、主張之受檢雜湊)
    const held14 = isarr(ap.es14?.held) ? ap.es14.held : []
    for (const h of held14) {
        if (await put({ object: ES14_OBJECT, oid: itemOidOf(o.coreId, h.id), std: ES14.std, reason: `爭議覆核判不了（${ES14.std}；${DISPUTE_WHY[h.why] || h.why}）：「${o.concept}」〔${h.id}〕${h.detail ? `——${oneline(h.detail, 300)}` : ''}`, next: EXTRACT_HOLD_NEXT.dispute, owner: 'user', ctx: { core: o.coreId, concept: o.concept } }, h.hash)) count(o.msg, 'disputeHolds')
    }
    if (held14.length) ctx.log.info(`提煉[${o.concept}]：${held14.length} 則爭議覆核判不了，已登錄待判（ES14：${held14.slice(0, 3).map((h) => `〔${h.id}〕${DISPUTE_WHY[h.why] || h.why}`).join('、')}）`)
    const cc = ap.claimCheck
    const heldC = isarr(cc?.res?.held) ? cc.res.held : []
    for (const h of heldC) {
        if (await put({ object: CLAIM_OBJECT, oid: itemOidOf(o.coreId, h.id), std: cc.std, reason: `${CLAIM_HOLD_WORD[cc.std]}（${cc.std}；${DISPUTE_WHY[h.why] || h.why}）：「${o.concept}」〔${h.id}〕${h.detail ? `——${oneline(h.detail, 300)}` : ''}`, next: CLAIM_HOLD_NEXT[cc.std], owner: 'user', ctx: { core: o.coreId, concept: o.concept } }, h.hash)) count(o.msg, cc.std === ES9.std ? 'stockHolds' : 'orphanHolds')
    }
    if (heldC.length) ctx.log.info(`提煉[${o.concept}]：${heldC.length} 條${CLAIM_HOLD_WORD[cc.std]}，已登錄待判（${cc.std}：${heldC.slice(0, 3).map((h) => `〔${h.id}〕${DISPUTE_WHY[h.why] || h.why}`).join('、')}）`)
}

/**
 * 落盤之後之結案與檢核紀錄:重送已涵蓋(ES15)、ES9 筆記層重送後已涵蓋且未再判不了、爭議(ES14)與主張層(ES9 存量、ES8)之已判定者結案;
 *   主張層之檢核紀錄(先登錄後記錄:待判為待辦、紀錄為已審之快取)
 *
 * @param {Object} env 輸入本段環境(stores.holds、stores.checks、at)
 * @param {Object} ctx 輸入管道脈絡
 * @param {Object} o 輸入 { coreId, ap:{ resendDone?, es9?, es14?:{ decided }, claimCheck?:{ std, res:{ checks, decided } } }, msg }
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined
 * @example
 * need test in nodejs.
 *
 * await closeHolds(env, ctx, { coreId, ap: { resendDone: ['n-a'] }, msg })
 */
export async function closeHolds(env, ctx, o) {
    const ap = o.ap || {}
    const holds = env.stores.holds
    const es9 = new Set(ap.es9 || [])
    for (const nid of ap.resendDone || []) {
        if (await resolveHold(holds, holdKey(ES15.object, itemOidOf(o.coreId, nid), ES15.std), { how: '重送已涵蓋', at: env.at })) count(o.msg, 'holdsResolved')
        if (!es9.has(nid)) {
            const cur = await holds.get(holdKey(ES15.object, itemOidOf(o.coreId, nid), ES9.std))
            if (cur?.status === 'open' && await resolveHold(holds, cur.id, { how: '重送後已涵蓋', at: env.at })) count(o.msg, 'holdsResolved')
        }
    }
    for (const id of isarr(ap.es14?.decided) ? ap.es14.decided : []) {
        const cur = await holds.get(holdKey(ES14_OBJECT, itemOidOf(o.coreId, id), ES14.std))
        if (cur?.status === 'open' && await resolveHold(holds, cur.id, { how: '兩席覆核已判定', at: env.at })) count(o.msg, 'holdsResolved')
    }
    const cc = ap.claimCheck
    if (cc) {
        const v = cc.std === ES9.std ? ES9.v : ES8.v
        for (const c of cc.res?.checks || []) await recordCheck(env.stores.checks, { object: CLAIM_OBJECT, oid: itemOidOf(o.coreId, c.id), hash: c.hash, std: cc.std, v, at: env.at, status: c.status, seats: c.seats || '', reason: c.reason || '' })
        for (const id of cc.res?.decided || []) {
            const cur = await holds.get(holdKey(CLAIM_OBJECT, itemOidOf(o.coreId, id), cc.std))
            if (cur?.status === 'open' && await resolveHold(holds, cur.id, { how: '兩席覆核已判定', at: env.at })) count(o.msg, 'holdsResolved')
        }
    }
}

/**
 * 狀態無變(不落盤)之專步落帳:登錄即寫、結案即寫(無落盤可失敗,不須補償;ctx 之 rev 為現 rev)
 *
 * @param {Object} env 輸入本段環境
 * @param {Object} ctx 輸入管道脈絡
 * @param {Object} o 輸入同 registerHolds 與 closeHolds 之 o
 * @param {Integer} rev 輸入現 rev
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined
 * @example
 * need test in nodejs.
 *
 * await settleHolds(env, ctx, { coreId, concept: '黑洞', ap }, state.rev)
 */
export async function settleHolds(env, ctx, o, rev) {
    await registerHolds(env, ctx, o, { rev, undo: [] })
    await closeHolds(env, ctx, o)
}

/**
 * 落盤失敗之補償(先記後寫之「撤銷」):依登錄之逆序還原前像——有前像者寫回(同鍵重登會改 tries／owner／at 並清重試要求,不以結案代之)、
 *   無前像者結案(HOLD_UNDO_HOW)。撤銷本身失敗者 ERROR(須見;維護段清掃以登錄之 rev 兜底)
 *
 * @param {Object} env 輸入本段環境(stores.holds、at)
 * @param {Object} ctx 輸入管道脈絡(log)
 * @param {String} concept 輸入概念名(日誌)
 * @param {Array} undo 輸入 registerHolds 推入之 [{ id, before }]
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined
 * @example
 * need test in nodejs.
 *
 * await compensateHolds(env, ctx, '黑洞', undo)
 */
export async function compensateHolds(env, ctx, concept, undo) {
    const holds = env.stores.holds
    const failed = []
    for (const u of [...undo].reverse()) {
        try {
            if (u.before) await holds.replace(u.before)
            else await resolveHold(holds, u.id, { how: HOLD_UNDO_HOW, at: env.at })
        }
        catch (e) {
            failed.push(`${u.id}（${oneline(e?.message, 80)}）`)
        }
    }
    if (failed.length) ctx.log.error(`提煉[${concept}]：落盤失敗之登錄撤銷未完成（${failed.length} 筆：${failed.slice(0, 3).join('、')}），由維護段清掃（以登錄之 rev 判落盤未完成）`)
}

/**
 * 清掃已不適用之未結待判(維護段;置於重送名單之前——否則落盤未完成之假待判會被重送):逐類判準——
 *   筆記層(ES15、ES9):核心不在／落盤未完成(登錄之 rev 大於現 rev)／筆記已刪除／(ES15)已被存活條目引用;爭議(ES14):核心不在／落盤未完成／爭議不存在／
 *   終態／已不存疑;主張層(ES9 存量、ES8):核心不在／落盤未完成／主張不存在／終態;核心(存量處置):核心不在。結案方式以 HOLD_STALE_HOW_PREFIX 起頭。
 *   核心狀態走四態分流表(可讀者判;讀不了者不動),載入結果放 env.stateCache 供維護段重用(維護段用畢即清)
 *
 * @param {Object} env 輸入本段環境(stores.holds、store、cores、notesById、at)
 * @param {Object} log 輸入日誌
 * @param {Object} stat 輸入統計(寫 holdsSwept)
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined
 * @example
 * need test in nodejs.
 *
 * const stat = { holdsSwept: 0 }
 * await sweepStaleHolds(env, log, stat)
 * console.log(stat.holdsSwept)
 */
export async function sweepStaleHolds(env, log, stat) {
    const holds = env.stores.holds
    const byCore = new Map(env.cores.map((c) => [c.id, c]))
    env.stateCache = new Map()
    const stateOf = (id) => {
        if (!env.stateCache.has(id)) env.stateCache.set(id, env.store.load(id))
        const r = env.stateCache.get(id)
        return r.status === 'ok' || r.status === 'recovered' ? r.state : null
    }
    let swept = 0
    const close = async (h, why) => {
        await resolveHold(holds, h.id, { how: `${HOLD_STALE_HOW_PREFIX}：${why}`, at: env.at })
        swept++
    }
    const coreGone = (coreId) => {
        const rec = byCore.get(coreId)
        return !rec || rec.status === CORE_STATUS.merged
    }
    for (const h of await listHolds(holds, { status: 'open' })) {
        const { coreId, id: sub } = parseItemOid(h.oid)
        const noteLayer = h.object === ES15.object && (h.std === ES15.std || h.std === ES9.std)
        const disputeLayer = h.object === ES14_OBJECT && h.std === ES14.std
        const claimLayer = h.object === CLAIM_OBJECT && (h.std === ES9.std || h.std === ES8.std)
        if (h.object === CORE_HOLD_OBJECT) {
            if (coreGone(h.oid)) await close(h, '核心不在')
            continue
        }
        if (!(noteLayer || disputeLayer || claimLayer) || !coreId || !sub) continue
        if (coreGone(coreId)) {
            await close(h, '核心不在')
            continue
        }
        const s = stateOf(coreId)
        if (!s) continue
        if (Number(h.ctx?.rev) > Number(s.rev)) {
            await close(h, '落盤未完成')
            continue
        }
        if (noteLayer) {
            if (!env.notesById.has(sub)) await close(h, '筆記已刪除')
            else if (h.std === ES15.std && citedNotesOf(s).has(sub)) await close(h, '已被存活條目引用')
        }
        else if (disputeLayer) {
            const d = (s.disputes || []).find((x) => x.id === sub)
            if (!d) await close(h, '爭議不存在')
            else if (TERMINAL_SET.has(d.status)) await close(h, '爭議已終態')
            else if (!isobj(d.doubt)) await close(h, '爭議已不存疑')
        }
        else {
            const c = (s.claims || []).find((x) => x.id === sub)
            if (!c) await close(h, '主張不存在')
            else if (TERMINAL_SET.has(c.status)) await close(h, '主張已終態')
        }
    }
    stat.holdsSwept = swept
    if (swept) log.info(`提煉待判清掃：${swept} 筆已不適用之未結待判結案（落盤未完成、筆記已刪除、已被引用、核心不在、條目終態）`)
}

/** 判定小組專步之未成立原因之字樣(待判理由與日誌用):判定小組之原因取摘要套件之字樣表加本套件之兩種(EXTRACT_PANEL_WHY_LABELS),另加爭議覆核之拆解未成與不變式 */
const DISPUTE_WHY = Object.freeze({ ...EXTRACT_PANEL_WHY_LABELS, 'dissolve-rejected': '判非對立而拆解未成', 'invariant-rejected': '判非對立而拆解違反不變式' })

/**
 * 本核心各主張之檢核紀錄(物件 claim;ES9 存量與 ES8 之須檢判定用)
 *
 * @param {Object} env 輸入本段環境(stores.checks)
 * @param {String} coreId 輸入核心 id
 * @param {Object} s 輸入核心狀態
 * @returns {Promise<Map>} 回傳 Map(oid → 紀錄);無 checks 集合回空 Map
 * @example
 * need test in nodejs.
 *
 * const recs = await claimChecksOf(env, coreId, state)
 */
export async function claimChecksOf(env, coreId, s) {
    const out = new Map()
    const st = env.stores.checks
    if (!st) return out
    for (const c of s?.claims || []) {
        const oid = itemOidOf(coreId, c.id)
        const rec = await st.get(checkKey(CLAIM_OBJECT, oid))
        if (rec) out.set(oid, rec)
    }
    return out
}

export default { registerHolds, closeHolds, settleHolds, compensateHolds, sweepStaleHolds, claimChecksOf }
