// extractChain.mjs — 提煉之逐核心動作鏈(stages 層;hook 錨點 extract.extract.{loadState, selectNotes, pass, renderState, persistState})
//
// 【五錨點】loadState(載入真理:狀態檔分流、修復、對帳)→ selectNotes(選篇、配發代號、分節摘要)→ pass(3+3 工作流、待審裁決與各專步;
//   涵蓋落帳、失敗帳、統計)→ renderState(自狀態渲染 md,不落地)→ persistState(待判登錄 → 狀態 CAS → 投影 → 分身 → 結案)。
//   投影之寫入器在 stores/coreProjection,待判之登錄與結案在 standards/holdSettle,3+3 與各專步之編排在 workflow/。
// 【逐棒日誌】各棒之 onCall(aiCallLogOf;3+3、待審、各專步與同義專步同一份):失敗之嘗試 WARN、成交 INFO、全鏈失敗 WARN。
// 【失敗帳之欄位】MODES(鍵式只此一份):一般差量、整併、待審裁決用 tries;僅重審、本質與判定小組專步另立欄位,供退避(backoffDaysOf)。

import fs from 'fs'
import path from 'path'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { appendJsonlRows, count, defineMw, normalizeConcept, noteDocIdOf, oneline, sha1, jsonClone as clone } from '../core/capturePackage.mjs'
import { readMd, writeMd } from '../core/summarizePackage.mjs'
import { coreForKey } from '../stores/conceptSelection.mjs'
import { bodyHashOf } from '../stores/contentCache.mjs'
import { commitBatch } from '../stores/coreDelta.mjs'
import { highWater, knownHashesOf, newCoreIdOf, nextRenderHashes, programWriteProblems, recordOf, renderOf, repairCore, settleTwins, writeProjections } from '../stores/coreProjection.mjs'
import { OFFTOPIC_REASON, TERMINAL_SET, citedNotesOf, emptyState, essenceNeedOf, findItem, holdItems, liveSourcesOf, withdrawnOf } from '../stores/coreState.mjs'
import { mdHashOf, nextRevOf } from '../stores/coreStore.mjs'
import { PENDING_DROPPED_FILE } from '../stores/extractFiles.mjs'
import { LEDGER_ERROR_CHARS } from '../stores/extractLedger.mjs'
import { markExtracted } from '../stores/noteFacts.mjs'
import { selectNotes } from '../stores/noteSelection.mjs'
import { conflictDisposedOf } from '../standards/conflictDisposition.mjs'
import { disputeDueOf, disputeHashOf, disputeHeldIdsOf } from '../standards/disputeCheck.mjs'
import { claimChecksOf, closeHolds, compensateHolds, registerHolds, settleHolds } from '../standards/holdSettle.mjs'
import { ES8, orphanCandidatesOf, orphanHashOf, orphanNeedsOf } from '../standards/orphanCheck.mjs'
import { RECHECK_REASONS, pickRecheck } from '../standards/recheck.mjs'
import { ES9 } from '../standards/supportCheck.mjs'
import { stockHashOf, stockNeedsOf } from '../standards/supportStock.mjs'
import { runDisputePass } from '../workflow/disputePass.mjs'
import { runOrphanPass } from '../workflow/orphanPass.mjs'
import { runPending } from '../workflow/pending.mjs'
import { relationContextRows } from '../workflow/relationContext.mjs'
import { runPass } from '../workflow/runPass.mjs'
import { runSupportStockPass } from '../workflow/supportStockPass.mjs'
import { pendingReviewOps } from '../workflow/verdicts.mjs'
import { SYNONYM_LEDGER_KEY } from './synonymStep.mjs'


/** 衝突未處置之重呈上限(逾則交 RS4 待判、入 seenConflicts) */
const CONFLICT_TRIES_MAX = 2

/**
 * 衝突之去向(檢定標準 ES5;pass 後落帳):呈現之 R 列(兩端皆可引之衝突)逐邊判定
 *
 * @param {Object} o 輸入 { s(套用後狀態), rows(R 列:{ id, label, ends }), decl(起草之宣告 [{ edge, disposition, reason }]), cov(涵蓋), led(失敗帳之本核心條目;記 conflictTries) }
 * @returns {Object} 回傳 { seen:Array(入 seenConflicts 之邊 id), toRs4:Array({ edgeId, ends, reason }), counts:{ conflictsDisposed, conflictsNotOpposed, conflictsPending, conflictsToRs4 } }
 */
function settleConflictDispositions(o) {
    const out = { seen: [], toRs4: [], counts: { conflictsDisposed: 0, conflictsNotOpposed: 0, conflictsPending: 0, conflictsToRs4: 0 } }
    if (!o.rows.length) return out
    const tries = isobj(o.led.conflictTries) ? o.led.conflictTries : (o.led.conflictTries = {})
    const offtopic = new Set((o.cov?.skipped || []).filter((x) => x.reason === OFFTOPIC_REASON).map((x) => x.note))
    for (const row of o.rows) {
        if (conflictDisposedOf(o.s, row.ends, { offtopic, version: o.s.version })) {
            out.seen.push(row.id)
            out.counts.conflictsDisposed++
            delete tries[row.id]
            continue
        }
        const nd = o.decl.find((x) => x.edge === row.label && x.disposition === '非對立' && x.reason)
        if (nd) {
            out.seen.push(row.id)
            out.toRs4.push({ edgeId: row.id, ends: row.ends, reason: `提煉判為非對立：${nd.reason}` })
            out.counts.conflictsNotOpposed++
            delete tries[row.id]
            continue
        }
        const n = (Number(tries[row.id]) || 0) + 1
        if (n >= CONFLICT_TRIES_MAX) {
            out.seen.push(row.id)
            out.toRs4.push({ edgeId: row.id, ends: row.ends, reason: `提煉 ${n} 次呈現皆未處置此衝突` })
            out.counts.conflictsToRs4++
            delete tries[row.id]
        }
        else {
            tries[row.id] = n
            out.counts.conflictsPending++
        }
    }
    return out
}

// 逐棒日誌之棒名與步驟名
const STAGE_WORD = { draft1: '起草1', draft2: '起草2', draft3: '起草3', integrate: '整合', audit: '審計', revise: '修訂', accept: '終審', check1: '出處覆核1', check2: '出處覆核2', check3: '出處覆核3', revise9: '出處修訂', dispute1: '爭議覆核1', dispute2: '爭議覆核2', dispute3: '爭議覆核3', orphan1: '失撐找支持1', orphan2: '失撐找支持2', orphan3: '失撐找支持3', synonymPropose: '同義提議', synonym1: '同義覆核1', synonym2: '同義覆核2', synonym3: '同義覆核3' }

const MODE_WORD = { delta: '提煉', consolidate: '整併', pending: '待審裁決', recheck: '重審', essence: '本質', dispute: '爭議覆核', support: '出處支持存量覆核', orphan: '失撐主張找支持' }

/**
 * 逐棒日誌與呼叫計數(各棒之 onCall;3+3、待審、各專步與同義專步同一份):每次失敗之嘗試 WARN、成交 INFO、全鏈失敗 WARN
 *   (字樣「提煉事件[…]」,日誌契約列為已知——遞補是設計機制);aiCalls 每棒一次、aiAttempts 依遞補鏈之實際嘗試數(至少 1)
 *
 * @param {String} tag 輸入日誌之前綴(如 `提煉事件[<概念>]`)
 * @param {Object} log 輸入 logger(info、warn)
 * @param {Function} add 輸入 (計數鍵, 數) => void
 * @returns {Function} 回傳 onCall:(entry:{ stage, ok, providerId, ms, error, tried }) => void
 * @example
 * const lines = []
 * const counts = {}
 * const onCall = aiCallLogOf('提煉事件[黑洞]', { info: (m) => lines.push(`INFO ${m}`), warn: (m) => lines.push(`WARN ${m}`) }, (k, n) => { counts[k] = (counts[k] || 0) + n })
 * onCall({ stage: 'draft1', ok: true, providerId: 'p1', ms: 2400, tried: [{ id: 'p0', outcome: 'fail', errorType: 'timeout', error: '逾時' }, { id: 'p1', outcome: 'ok' }] })
 * console.log(lines, counts)
 * // => [ 'WARN 提煉事件[黑洞] 起草1 p0：timeout（逾時）', 'INFO 提煉事件[黑洞] 起草1 p1 成交（2s）' ] { aiCalls: 1, aiAttempts: 2 }
 */
export function aiCallLogOf(tag, log, add) {
    return (c) => {
        const tried = Array.isArray(c.tried) ? c.tried : []
        add('aiCalls', 1)
        add('aiAttempts', Math.max(1, tried.length))
        const stage = STAGE_WORD[c.stage] || c.stage
        // 錯誤只有裸離開碼時附 CLI 輸出開頭(額度用盡等原因只在 stdout,錯誤欄只有「Exit code 1」)
        const why = (x) => (x.error && !/^Exit code \d+$/i.test(String(x.error).trim()) ? '' : oneline(x.out || x.err || '', 80))
        for (const x of tried.filter((y) => y.outcome !== 'ok')) log.warn(`${tag} ${stage} ${x.id}：${x.errorType || x.outcome}${x.error ? `（${oneline(x.error, 100)}）` : ''}${why(x) ? `｜${why(x)}` : ''}`)
        if (c.ok) log.info(`${tag} ${stage} ${c.providerId} 成交（${Math.round((c.ms || 0) / 1000)}s）`)
        else log.warn(`${tag} ${stage} 全鏈失敗：${oneline(c.error, 120)}`)
    }
}

/**
 * 專步失敗之退避天數(第 n 次連續失敗後:1、2、4 天,之後恆 4 天;各專步與同義專步同一規則)
 *
 * @param {Integer} n 輸入連續失敗次數(≥1)
 * @returns {Number} 回傳天數
 * @example
 * console.log([1, 2, 3, 4, 9].map(backoffDaysOf))
 * // => [ 1, 2, 4, 4, 4 ]
 */
export const backoffDaysOf = (n) => Math.min(4, 2 ** (n - 1))

/**
 * 判定小組專步(爭議、存量、失撐、同義)之專步層失敗之日誌尾段:連續次數與退避(持續失敗須看得見;次數即失敗帳之 <mode>Tries)
 *
 * @param {Integer} n 輸入連續失敗次數(≥1)
 * @returns {String} 回傳尾段字樣
 * @example
 * console.log(stepFailNote(2))
 * // => 專步連續失敗 2 次，退避 2 天後再試
 */
export const stepFailNote = (n) => `專步連續失敗 ${n} 次，退避 ${backoffDaysOf(n)} 天後再試`

/**
 * 各專步於失敗帳之欄位(終審 §3 D5a;鍵式只此一份):tries＝專步層之連續失敗(退避)、items＝逐項之計次(缺票／同一供應者;逾該專步之 maxTries → 使用者)、
 *   panel＝以判定小組判定(全部受檢項皆缺票或同一供應者＝專步層之失敗)、key＝不屬單一核心者之全域鍵(同義專步);一般差量、整併、待審裁決用 tries
 *
 * @type {Object}
 */
const MODES = Object.freeze({
    recheck: { tries: 'recheckTries' },
    essence: { tries: 'essenceTries' },
    dispute: { tries: 'disputeTries', items: 'disputeItemTries', panel: true },
    support: { tries: 'supportTries', items: 'supportItemTries', panel: true },
    orphan: { tries: 'orphanTries', items: 'orphanItemTries', panel: true },
    synonym: { tries: 'synonymTries', items: 'synonymItemTries', panel: true, key: SYNONYM_LEDGER_KEY },
})

/** 以判定小組判定之核心層專步(失敗帳之 <mode>Tries 於核心鍵) */
export const PANEL_MODES = Object.freeze(Object.keys(MODES).filter((m) => MODES[m].panel && !MODES[m].key))

/** 專步層連續失敗記於核心鍵之模式(僅重審、本質、判定小組三專步;本輪統計之 <mode>FailStreak 取其現存核心之最大值;同義專步另以全域鍵) */
export const STREAK_MODES = Object.freeze(Object.keys(MODES).filter((m) => !MODES[m].key))

/**
 * 判定小組專步之部分中止(已判之頁照處置、未判之項留待下輪;standards/panelVotes 之 runPanelPages):計一次截止並記 WARN(不計失敗、不計次)
 *
 * @param {Object} msg 輸入訊息信封(計數)
 * @param {Object} ctx 輸入動作鏈 ctx(日誌)
 * @param {String} concept 輸入概念名
 * @param {Object} r 輸入專步之結果(stopped、undecided、stats)
 */
function notePartialStop(msg, ctx, concept, r) {
    if (!r?.ok || r.stopped !== true) return
    count(msg, 'stopped')
    const judged = Number(r.stats?.disputeChecked ?? r.stats?.stockChecked ?? 0)
    ctx.log.warn(`提煉[${concept}]：專步因時間預算截止未完成（已判 ${judged} 項照處置、未判 ${(r.undecided || []).length} 項留待下輪）`)
}

// ─── 逐核心動作鏈(hook 錨點:extract.extract.{loadState, selectNotes, pass, renderState, persistState}) ───

/**
 * 錨點:loadState(載入真理):狀態檔分流(正常／壞檔或遺失而上一版救得回者立即修復——隔離、高水位、落盤、投影／遺失而無上一版則跳過／
 * 非本格式版本則跳過／新核心);對帳(rev 與投影不符 → 無 AI 重建投影;狀態比投影舊者 WARN 並保 id 高水位)
 *
 * 讀 msg.data(target、mode、_env、_domain);寫 msg.data._core({ id, file, record, state, expectRev });
 * 短路:壞檔無上一版、修復失敗、非本格式版本、讀取失敗、核心記錄存在而狀態檔遺失且無 .prev(本套件只讀寫本格式之狀態檔,不轉換他種資料)
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * need test in nodejs.
 *
 * const chain = [mwLoadState(), mwSelectNotes({ notesPerTarget: 3 }), mwPass(), mwRenderState(), mwPersistState()]
 */
export const mwLoadState = () => defineMw({
    name: 'loadState',
    handle: async (msg, ctx, next) => {
        const { target: t, _env: env, _domain: domain } = msg.data
        let record = t.core || null
        let id = record?.id
        if (!record) id = newCoreIdOf(t, env.cores, env.dirs).id
        const file = path.join(env.dirs.core, `${id}.md`)
        const base = { id, file, record }
        const r = env.store.load(id)
        let state = null
        let expectRev = null
        // 載入失敗之落帳:不落帳則同一核心每輪被選題選中、每輪同一 ERROR(stages/extractStage 檔頭【失敗帳】)
        const fail = (halt, why) => {
            const led = env.ledger.entry(msg.data._ledgerKey)
            led.tries = (led.tries || 0) + 1
            led.lastTriedAt = env.at
            led.lastError = oneline(why, LEDGER_ERROR_CHARS)
            msg.data._halt = halt
            return msg
        }
        if (r.status === 'ok') {
            state = r.state
            expectRev = r.state.rev
        }
        else if (r.status === 'recovered') {
            // 壞檔或遺失而上一版救得回:立即修復(隔離、高水位、落盤、投影)——不留「可讀不可寫」之狀態給其後之落盤(CAS 必撞壞檔)
            try {
                const rp = await repairCore(env, domain, { id, rec: record, file, state: r.state, lost: r.lost })
                state = rp.state
                expectRev = rp.expectRev
                ctx.log.warn(`提煉狀態還原[${t.concept}]：狀態檔${r.lost ? '遺失' : `毀損（${oneline(r.error, 120)}），已隔離為 ${rp.moved}`}，已由上一版還原並落盤（落後一次寫入；該次所用之筆記將重新待提煉）`)
            }
            catch (e) {
                ctx.log.error(`提煉[${t.concept}]：狀態檔修復失敗（${oneline(e.message, 160)}）；本概念跳過、不覆寫`)
                return fail('repair', `狀態檔修復失敗（${oneline(e.message, 120)}）`)
            }
        }
        else if (r.status === 'missing' && record) {
            // 核心記錄在、狀態檔與上一版皆不在:跳過——不自空狀態重建(會把既有核心當新概念覆寫)
            const why = `核心記錄存在而狀態檔遺失且無上一版可還原（${env.store.fileOf(id).replace(/\\/g, '/')}）`
            ctx.log.error(`提煉[${t.concept}]：${why}；本概念跳過、不覆寫。請自備份或版控還原狀態檔`)
            return fail('state-lost', why)
        }
        else if (r.status === 'missing') state = emptyState({ coreId: id, concept: t.concept, scope: t.scope })
        else {
            const tag = r.status === 'foreign' ? '狀態檔非本格式版本' : (r.status === 'corrupt' ? '狀態檔毀損且無上一版' : '狀態檔讀取失敗')
            if (r.status === 'corrupt') env.store.quarantine(id, env.stamp)
            ctx.log.error(`提煉[${t.concept}]：${tag}（${oneline(r.error, 160)}）；本概念跳過、不覆寫`)
            return fail(r.status, `${tag}（${oneline(r.error, 120)}）`)
        }
        // 對帳:投影(cores 記錄／md)之 rev 或版本與狀態不符 → 以狀態重建(無 AI)
        if (r.status === 'ok' && record && (record.rev !== state.rev || record.version !== state.version || readMd(file)?.front?.version !== state.version)) {
            if (Number.isFinite(record.rev) && record.rev > state.rev) {
                // 狀態比投影舊(如 git 回滾):以狀態為準,但 rev 與 id 取高水位(程式寫入之不變式:只動 rev 與 id 計數)
                const was = state.rev
                const raised = highWater(clone(state), record)
                // 磁碟 md 為較新之投影(回滾後):其雜湊記入已知集(repairCore 同法),否則重建投影時被當手改另存並發須見之 WARN
                const diskHash = fs.existsSync(file) ? mdHashOf(fs.readFileSync(file, 'utf8')) : ''
                if (diskHash && !(raised.renderHashes || []).includes(diskHash)) raised.renderHashes = [...new Set([...(raised.renderHashes || []).slice(-1), diskHash])]
                const bad = programWriteProblems(state, raised)
                if (bad.length) {
                    ctx.log.error(`提煉[${t.concept}]：投影補正違反不變式（未落盤）：${bad.slice(0, 3).join('；')}`)
                    return fail('invariant', `投影補正違反不變式：${bad.slice(0, 2).join('；')}`)
                }
                const w = env.store.save(id, raised, { expectRev })
                state = w
                expectRev = w.rev
                ctx.log.warn(`提煉投影補正[${t.concept}]：狀態（rev ${was}）比投影舊（rev ${record.rev}），以狀態為準重建投影（回滾後被退掉之版次所用筆記重新待提煉）`)
            }
            else ctx.log.warn(`提煉投影補正[${t.concept}]：投影落後於狀態（rev ${record.rev ?? '無'} → ${state.rev}），以狀態重建`)
            const wp = await writeProjections({ id, file, state, env, domain })
            state = wp.state
            expectRev = wp.state.rev
        }
        msg.data._core = { ...base, state, expectRev }
        return next(msg)
    },
})

/**
 * 錨點:selectNotes(選篇):候選以狀態之 consumed 再濾一次;配發 N 代號;分節摘要。待審模式以待審操作所引之筆記為「批」;整併模式無筆記
 *
 * 讀 msg.data(target、mode、_core、_env、_domain);寫 msg.data._batch([{ code, id, note, digest }]);短路:增量模式無可用筆記(記 lastTriedAt,不呼叫 AI、不計 tries)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Integer} [opt.notesPerTarget] 輸入每批篇數，未給則用 settings.extract.notesPerConcept
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * need test in nodejs.
 *
 * const mw = mwSelectNotes({ notesPerTarget: 3 })
 */
export const mwSelectNotes = (opt = {}) => defineMw({
    name: 'selectNotes',
    handle: async (msg, ctx, next) => {
        const { target: t, mode, _core: core, _env: env, _domain: domain } = msg.data
        const k = ctx.deps.settings.extract
        const limit = opt.notesPerTarget ?? k.notesPerConcept
        let picked = []
        let rItems = []
        if (mode === 'delta' || mode === 'recheck') {
            // 重審筆記:以當下狀態重算(追趕之次批不重放已處理者);一般批至多 extract.recheck.slots 格、僅重審 pass 至多一批;
            //   內容變更守門觸發時不排 changed(衝突不受影響)。重審筆記不受「已消化」過濾
            const items = (t.scope || 'concept') === 'concept'
                ? env.recheckItemsFor(core.state, core.id).filter((x) => !(env.recheckBlocked && x.reason === RECHECK_REASONS.changed))
                : []
            const slots = mode === 'recheck' ? limit : Math.min(Number.isInteger(k.recheck.slots) ? k.recheck.slots : 3, limit)
            // 新關聯之夥伴(ES10)於一般批不占重審格,排在本概念主次標籤之後補位;僅重審 pass 依重審序殿後
            const pr = pickRecheck(items, slots, mode === 'delta' ? { exclude: [RECHECK_REASONS.partner] } : {})
            rItems = pr.items
            const rPicked = pr.ids.map((id) => ({ id, note: env.notesById.get(id), primary: false }))
            let rest = []
            let pPicked = []
            if (mode === 'delta') {
                const consumed = new Set(core.state.consumed || [])
                const cands = (t.candidates || []).filter((c) => !consumed.has(c.note.id) && !pr.ids.includes(c.note.id))
                const tries = env.ledger.entry(msg.data._ledgerKey).noteTries
                rest = selectNotes(cands, {
                    limit: Math.max(0, limit - rPicked.length),
                    sourceCap: k.sourceCap,
                    publishedOf: (n) => env.docsById.get(noteDocIdOf(n))?.publishedAt || '',
                    sourceOf: (n) => env.docsById.get(noteDocIdOf(n))?.sourceId || n.sourceName || '',
                    conflicts: env.conflicts,
                    levels: env.levels,
                    triesOf: (nid) => tries[nid] || 0,
                })
                const room = limit - rPicked.length - rest.length
                if (room > 0) {
                    const taken = new Set([...pr.ids, ...rest.map((x) => x.id)])
                    const pp = pickRecheck(items.filter((x) => x.reason === RECHECK_REASONS.partner && !taken.has(x.id)), room)
                    rItems = [...rItems, ...pp.items]
                    pPicked = pp.ids.map((id) => ({ id, note: env.notesById.get(id), primary: false }))
                }
            }
            picked = [...rPicked, ...rest, ...pPicked]
            if (!picked.length) {
                if (mode === 'delta') env.ledger.entry(msg.data._ledgerKey).lastTriedAt = env.at
                ctx.log.info(`提煉無可用筆記[${t.concept}]：${mode === 'recheck' ? '無待重審之筆記' : '候選皆已用過或未就緒'}，本輪不呼叫 AI`)
                msg.data._halt = mode === 'recheck' ? 'no-recheck' : 'no-notes'
                return msg
            }
        }
        else if (mode === 'pending') {
            const ids = [...new Set(pendingReviewOps(core.state).ops.flatMap((o) => o.sources || []))]
            picked = ids.map((id, i) => ({ code: `N${i + 1}`, id, note: env.notesById.get(id) || { id, title: id }, primary: true }))
        }
        // md 讀不到者不入批(空摘要送 AI 會被當成「無可用知識」消化,或誘發對既有條目之撤回);待審裁決照舊。
        //   讀不到者計重送次數(同未涵蓋):達上限即出隊(ES15 之待判理由載明 md 讀不到),不讓它永遠擋在批內
        const readable = []
        const mdExhausted = []
        const noteTries = env.ledger.entry(msg.data._ledgerKey).noteTries
        for (const p of picked) {
            const md = readMd(p.note?.file)
            if (!md && mode !== 'pending') {
                count(msg, 'mdMissing')
                const n = (noteTries[p.id] || 0) + 1
                if (n >= k.noteTries) {
                    mdExhausted.push(p.id)
                    delete noteTries[p.id]
                }
                else noteTries[p.id] = n
                continue
            }
            readable.push({ ...p, md })
        }
        msg.data._mdExhausted = mdExhausted
        readable.forEach((p, i) => { p.code = `N${i + 1}` })
        const codeOf = new Map(readable.map((p) => [p.id, p.code]))
        const batch = readable.map((p) => {
            const d = domain.noteDigest(p.note, p.md, { code: p.code, codeOf: (nid) => codeOf.get(nid) || '', titleOf: (nid) => env.notesById.get(nid)?.title || '' })
            if (d && d.sectioned === false) count(msg, 'unsectioned')
            return { code: p.code, id: p.id, note: p.note, digest: String(d?.text ?? d ?? ''), key: typeof d?.contentKey === 'string' ? sha1(d.contentKey) : null, body: bodyHashOf(p.md) }
        })
        if (!batch.length && (mode === 'delta' || mode === 'recheck')) {
            if (mdExhausted.length) {
                // 無可用筆記而有 md 讀不到逾限者:純程式落盤(出隊入 skipped;不呼叫 AI),待判登錄於落盤前寫(mwPersistState)
                const s = commitBatch(core.state, { used: [], pending: [], skipped: [], dropped: [] }, { exhausted: mdExhausted })
                const bad = programWriteProblems(core.state, s)
                if (bad.length) {
                    ctx.log.error(`提煉[${t.concept}]：不變式違反（md 讀不到逾限之出隊，未落盤）：${bad.slice(0, 3).join('；')}`)
                    msg.data._halt = 'invariant'
                    return msg
                }
                ctx.log.info(`提煉無可用筆記[${t.concept}]：本批筆記之 md 皆讀不到，其中 ${mdExhausted.length} 篇逾限出隊（純程式落盤，不呼叫 AI）`)
                msg.data._batch = []
                msg.data._recheck = []
                msg.data._next = s
                msg.data._applied = { applied: 0, rejected: 0, withheld: 0, cov: { used: [], pending: [], skipped: [], dropped: [], uncovered: [], badSkipped: [] }, exhausted: [...mdExhausted], mdExhausted: [...mdExhausted], resendDone: [], resendUncovered: [], rs4: [], es9: [], bumped: false }
                msg.data._programOnly = true
                return next(msg)
            }
            ctx.log.info(`提煉無可用筆記[${t.concept}]：本批筆記之 md 皆讀不到，本輪不呼叫 AI`)
            msg.data._halt = mode === 'recheck' ? 'no-recheck' : 'no-notes'
            return msg
        }
        msg.data._batch = batch
        msg.data._recheck = rItems.filter((x) => batch.some((b) => b.id === x.id))
        return next(msg)
    },
})

/**
 * 錨點:pass(3+3 提煉:三家獨立起草 → 整合 → 審計 → 修訂 → 終審 → 程式套用;workflow/runPass)。
 *   delta:一批筆記併入核心;consolidate:有效主張逾上限時整併(起草用整併提示詞、不處理筆記);
 *   pending:前次暫緩之不可逆操作交終審席裁決(workflow/pending)。
 *   套用、不變式、證據重算在 runPass／runPending 內;本錨點做涵蓋落帳(批內未涵蓋者記重送次數、逾限出隊)、失敗帳、逐棒日誌與統計。
 *
 * 讀 msg.data(target、mode、_core、_batch、_env、_domain、_seats);寫 msg.data._next(新狀態)、_applied;
 * 短路:全鏈失敗或起草全敗(記失敗帳)、時間預算截止(只記 lastTriedAt)、不變式違反、待審無事可做(no-pending;只剩陳舊項者清除後照常落盤)
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * need test in nodejs.
 *
 * const mw = mwPass()
 */
export const mwPass = () => defineMw({
    name: 'pass',
    handle: async (msg, ctx, next) => {
        const { target: t, mode, _core: core, _batch: batch, _env: env, _domain: domain, _seats: seats } = msg.data
        // 純程式之落盤(選篇時 md 讀不到逾限而無可用筆記:_next 與 _applied 已備妥,不呼叫 AI)
        if (msg.data._programOnly) return next(msg)
        const k = ctx.deps.settings.extract
        const emptyCov = { used: [], pending: [], skipped: [], dropped: [], uncovered: [], badSkipped: [] }
        // 逐棒紀錄;任一棒遇本機網路不通(調度層之 netDown)即記下——未完成時之字樣與中止原因據以分辨斷網與截止
        let netDown = false
        const logCall = aiCallLogOf(`提煉事件[${t.concept}]`, ctx.log, (key, n) => count(msg, key, n))
        const onCall = (c) => {
            if (c?.netDown === true) netDown = true
            logCall(c)
        }
        // shouldStop／remainingMs 同源(整輪截止):給了即「截止感知」——席位預算用盡(errorType budget)且剩餘不足一次嘗試者視為截止、不計失敗
        const common = { state: core.state, concept: t.concept, scope: t.scope, domain, seats, ai: ctx.deps.ai, notesById: env.notesById, contentOf: env.contentOf, at: env.at, keyOf: normalizeConcept, shouldStop: env.shouldStop, remainingMs: env.remainingMs, onCall, log: (l) => ctx.log.info(l), supportCheck: env.supportCheck, locale: ctx.deps.locale }
        let r
        let shownConflicts = []
        let enforcedRows = []
        const recheck = mode === 'delta' || mode === 'recheck' ? (msg.data._recheck || []) : []
        // 本質專步(ES6):以當下狀態再判一次——同輪一般批已補上本質者不再呼叫 AI
        if (mode === 'essence' && !essenceNeedOf(core.state).need) {
            msg.data._halt = 'no-need'
            return msg
        }
        const dc = env.disputeCheck
        if (mode === 'dispute') {
            // 爭議覆核專步(ES14):以當下狀態再判到期(同輪已拆解、已覆核者不再呼叫 AI)
            const due = new Set(disputeDueOf(core.state, { minVersions: dc?.minVersions, waitDays: dc?.waitDays, nowMs: Date.parse(env.at), heldIds: disputeHeldIdsOf(core.state, { held: env.disputeHeld?.get(core.id), waived: env.disputeWaived?.get(core.id) }), keyOf: env.noteKeyOf }).map((x) => x.id))
            const ids = (t.disputeIds || []).filter((id) => due.has(id))
            if (!dc || !ids.length) {
                msg.data._halt = 'no-need'
                return msg
            }
            r = await runDisputePass({ state: core.state, concept: t.concept, ids, domain, seats: dc.seats, ai: ctx.deps.ai, notesById: env.notesById, contentOf: env.contentOf, noteKeyOf: env.noteKeyOf, at: env.at, keyOf: normalizeConcept, shouldStop: env.shouldStop, remainingMs: env.remainingMs, onCall, log: (l) => ctx.log.info(l), locale: ctx.deps.locale })
        }
        else if (mode === 'support' || mode === 'orphan') {
            // 出處支持存量覆核(ES9 存量)／失撐主張(ES8)專步:以當下狀態再判須檢者(同輪已處置者不再呼叫 AI)
            const recs = await claimChecksOf(env, core.id, core.state)
            const recOf = (oid) => recs.get(oid) || null
            const due = new Set((mode === 'support'
                ? stockNeedsOf(core.state, { coreId: core.id, recOf, keyOf: env.noteKeyOf, retry: env.stockRetry?.get(core.id) })
                : orphanNeedsOf(core.state, { coreId: core.id, recOf, has: (nid) => env.notesById.has(nid), keyOf: env.noteKeyOf, retry: env.orphanRetry?.get(core.id) })).map((x) => x.id))
            const ids = ((mode === 'support' ? t.supportIds : t.orphanIds) || []).filter((id) => due.has(id))
            const cfg = mode === 'support' ? env.supportStock : env.orphanCheck
            if (!cfg || !ids.length) {
                msg.data._halt = 'no-need'
                return msg
            }
            const base = { state: core.state, concept: t.concept, ids, domain, seats: cfg.seats, ai: ctx.deps.ai, notesById: env.notesById, contentOf: env.contentOf, keyOf: env.noteKeyOf, at: env.at, shouldStop: env.shouldStop, remainingMs: env.remainingMs, onCall, log: (l) => ctx.log.info(l), locale: ctx.deps.locale }
            r = mode === 'support' ? await runSupportStockPass({ ...base, reviseSeat: cfg.reviseSeat }) : await runOrphanPass(base)
        }
        else if (mode === 'pending') r = await runPending({ ...common, batch })
        else {
            const codeOf = new Map(batch.map((b) => [b.id, b.code]))
            const rows = mode === 'consolidate' || mode === 'essence'
                ? []
                : relationContextRows(env.ctxEdges, { codeOf: (id) => codeOf.get(id) || '', titleOf: (id) => env.notesById.get(id)?.title || '', cited: citedNotesOf(core.state), conflictType: env.conflictType, linked: env.relationTypes === 'linked', label: true })
            // 實際呈現之衝突邊(截斷而未呈現者不算見過,下次補呈;seenConflicts)。兩端皆可引者(R 編號)須有去向才算見過(ES5;落帳時判定)
            shownConflicts = rows.filter((x) => x.conflict && x.id && !x.enforced).map((x) => x.id)
            enforcedRows = rows.filter((x) => x.enforced && x.id)
            const relations = rows.map((x) => x.line).join('\n')
            // 僅重審 pass(mode 'recheck')以一般差量執行(出處須屬本批),只是批全為重審筆記、不動選題錨點
            r = await runPass({ ...common, batch, relations, mode: mode === 'recheck' ? 'delta' : mode, claimsCap: k.claimsCap, recheck: recheck.map((x) => ({ id: x.id, reason: x.reason, anchor: x.anchor, kind: x.kind, newType: x.newType, why: x.why })) })
        }
        if (!r.ok) {
            const stopped = r.error === 'stopped'
            const led = env.ledger.entry(msg.data._ledgerKey)
            if (MODES[mode]) {
                // 僅重審 pass、本質專步、爭議覆核專步、出處支持存量覆核、失撐主張專步之失敗另立欄位(MODES;不動 tries／lastTriedAt——否則選題被罰、
                //   等待錨點被改),供退避
                if (!stopped) {
                    led[MODES[mode].tries] = (led[MODES[mode].tries] || 0) + 1
                    led[`${mode}LastTriedAt`] = env.at
                    led[`${mode}LastError`] = oneline(r.error, LEDGER_ERROR_CHARS)
                }
                else count(msg, 'stopped')
            }
            else {
                led.lastTriedAt = env.at
                if (!stopped) {
                    led.tries = (led.tries || 0) + 1
                    led.lastError = oneline(r.error, LEDGER_ERROR_CHARS)
                }
                else count(msg, 'stopped')
            }
            if (r.degrade?.length) ctx.log.warn(`提煉降級[${t.concept}]：${r.degrade.join('；')}`)
            // 判定小組專步之專步層失敗(含全部受檢項皆缺票或同一供應者——不逐項計次、不轉待判):尾段附連續次數與退避,持續失敗看得見
            const streak = !stopped && PANEL_MODES.includes(mode) ? `——${stepFailNote(env.ledger.entry(msg.data._ledgerKey)[MODES[mode].tries])}` : ''
            const stopWord = netDown ? '因本機網路不通未完成（本次不套用、不計失敗，下輪再做）' : '因時間預算截止未完成（本次不套用、不計失敗，下輪再做）'
            ctx.log.warn(`提煉[${t.concept}]：${MODE_WORD[mode]}${stopped ? stopWord : `失敗（${oneline(r.error, 160)}）${streak}`}`)
            msg.data._halt = stopped ? 'budget' : (String(r.error).startsWith('不變式違反') ? 'invariant' : 'ai-failed')
            return msg
        }
        if (r.noop) {
            // 待審無可裁決者:只剩陳舊項(目標已終態或不存在)→ 已清除,照常落盤一次讓投影之待審數歸零;全無 → 不落盤;專步之 noop(以當下狀態再判無須檢者)→ no-need
            if (!r.purged) {
                msg.data._halt = mode === 'pending' ? 'no-pending' : 'no-need'
                return msg
            }
            count(msg, 'pendingPurged', r.purged)
            msg.data._next = r.state
            msg.data._applied = { applied: 0, rejected: 0, withheld: 0, cov: emptyCov, exhausted: [], bumped: false }
            return next(msg)
        }
        if (mode === 'dispute') {
            // 爭議覆核專步(ES14)之落帳:專步成功即清退避;缺票／同一供應者者逐則記次(逾 extract.standards.disputeCheck.maxTries → 待判使用者);
            //   狀態無變(只有待判或重試)→ 即登錄待判、不落盤;有變(拆解或存疑結案)→ 落盤成功後登錄(mwPersistState)
            const led = env.ledger.entry(msg.data._ledgerKey)
            led[MODES.dispute.tries] = 0
            led.disputeLastError = ''
            const dt = isobj(led[MODES.dispute.items]) ? led[MODES.dispute.items] : (led[MODES.dispute.items] = {})
            const es14 = { held: [...(r.held || [])], decided: [...(r.decided || [])] }
            for (const id of [...es14.decided, ...es14.held.map((h) => h.id)]) delete dt[id]
            for (const id of r.retry || []) {
                const n = (Number(dt[id]) || 0) + 1
                if (n >= dc.maxTries) {
                    delete dt[id]
                    es14.held.push({ id, why: 'missing', detail: `覆核 ${n} 次皆缺票或同一供應者`, hash: disputeHashOf(findItem(core.state, id)?.item, env.noteKeyOf) })
                }
                else dt[id] = n
            }
            for (const [key, n] of Object.entries(r.stats || {})) count(msg, key, n)
            count(msg, 'disputePasses')
            notePartialStop(msg, ctx, t.concept, r)
            const changed = r.applied.length > 0 || JSON.stringify(r.state.doubtChecks || {}) !== JSON.stringify(core.state.doubtChecks || {})
            if (!changed) {
                await settleHolds(env, ctx, { coreId: core.id, concept: t.concept, ap: { es14 }, msg }, core.state.rev)
                msg.data._halt = 'no-change'
                return msg
            }
            msg.data._next = r.state
            msg.data._applied = { applied: r.applied.length, rejected: r.rejected.length, withheld: 0, cov: emptyCov, exhausted: [], resendDone: [], rs4: [], es9: [], es14, bumped: r.state.version !== core.state.version }
            return next(msg)
        }
        if (mode === 'support' || mode === 'orphan') {
            // 出處支持存量覆核(ES9 存量)／失撐主張(ES8)專步之落帳:專步成功即清退避;缺票／同一供應者者逐條記次,逾限 → 待判(使用者;ES9 另隔離);
            //   狀態無變(只有檢核紀錄、待判)→ 即落帳、不落盤;有變(修訂、撤回、補出處、隔離與解除)→ 落盤成功後落帳(mwPersistState)
            const std = mode === 'support' ? ES9.std : ES8.std
            const cfg = mode === 'support' ? env.supportStock : env.orphanCheck
            const led = env.ledger.entry(msg.data._ledgerKey)
            led[MODES[mode].tries] = 0
            led[`${mode}LastError`] = ''
            const tries = isobj(led[MODES[mode].items]) ? led[MODES[mode].items] : (led[MODES[mode].items] = {})
            const res = { checks: [...(r.checks || [])], held: [...(r.held || [])], decided: (r.checks || []).filter((c) => c.status !== 'undetermined').map((c) => c.id) }
            let s = r.state
            for (const id of [...res.decided, ...res.held.map((h) => h.id)]) delete tries[id]
            const over = []
            for (const id of r.retry || []) {
                const n = (Number(tries[id]) || 0) + 1
                if (n >= cfg.maxTries) {
                    delete tries[id]
                    over.push(id)
                }
                else tries[id] = n
            }
            if (over.length) {
                const W = withdrawnOf(s)
                const hashOf = (c) => (mode === 'support' ? stockHashOf(c, liveSourcesOf(c, s, W), env.noteKeyOf) : orphanHashOf(c, orphanCandidatesOf(s, (nid) => env.notesById.has(nid)), env.noteKeyOf))
                const rows = over.map((id) => findItem(s, id)?.item).filter(Boolean).map((c) => ({ c, hash: hashOf(c) }))
                // 逾次:未能判定——ES9 存量另隔離(不入有效集合;ES8 本已為衍生隔離)
                if (mode === 'support') s = holdItems(s, rows.map((x) => ({ id: x.c.id, std: ES9.std, why: `覆核 ${cfg.maxTries} 次皆缺票或同一供應者`, hash: x.hash })), { at: env.at }).state
                for (const x of rows) {
                    res.held.push({ id: x.c.id, why: 'missing', detail: `覆核 ${cfg.maxTries} 次皆缺票或同一供應者` })
                    res.checks.push({ id: x.c.id, hash: x.hash, status: 'undetermined', seats: '', reason: `覆核 ${cfg.maxTries} 次皆缺票或同一供應者` })
                }
            }
            for (const [key, n] of Object.entries(r.stats || {})) count(msg, key, n)
            count(msg, mode === 'support' ? 'stockPasses' : 'orphanPasses')
            notePartialStop(msg, ctx, t.concept, r)
            // 有變＝有差量落地、隔離變、或出處排除集變(⑳;證據等級隨之改,須落盤重渲染)
            const changed = r.applied.length > 0 || JSON.stringify(s.held || {}) !== JSON.stringify(core.state.held || {}) || JSON.stringify(s.srcExcluded || {}) !== JSON.stringify(core.state.srcExcluded || {})
            if (!changed) {
                await settleHolds(env, ctx, { coreId: core.id, concept: t.concept, ap: { claimCheck: { std, res } }, msg }, core.state.rev)
                msg.data._halt = 'no-change'
                return msg
            }
            msg.data._next = s
            msg.data._applied = { applied: r.applied.length, rejected: r.rejected.length, withheld: 0, cov: emptyCov, exhausted: [], resendDone: [], rs4: [], es9: [], claimCheck: { std, res }, bumped: s.version !== core.state.version }
            return next(msg)
        }
        // 本段之落帳就地改 s(＝r.state);不變式以 runPass 產物之複本為前
        const passOut = clone(r.state)
        let s = r.state
        const cov = r.coverage || emptyCov
        // md 讀不到逾限者(選篇時出隊;不在批內)與批內未涵蓋逾限者同列出隊
        const exhausted = [...(msg.data._mdExhausted || [])]
        const rIds = new Set(recheck.map((x) => x.id))
        let covered = new Set()
        if (mode === 'delta' || mode === 'recheck') {
            // 批內未涵蓋者記重送次數;達上限者出隊(記入 skipped「未涵蓋逾限」),不讓同一篇永遠擋在批內(重審筆記同一規則:逾限即以現值為基準)
            const tries = env.ledger.entry(msg.data._ledgerKey).noteTries
            covered = new Set([...cov.used, ...cov.pending, ...cov.skipped.map((x) => x.note), ...cov.dropped.map((x) => x.note)])
            for (const nid of covered) delete tries[nid]
            for (const nid of cov.uncovered) {
                const n = (tries[nid] || 0) + 1
                if (n >= k.noteTries) {
                    exhausted.push(nid)
                    delete tries[nid]
                }
                else tries[nid] = n
            }
            if (exhausted.length) s = commitBatch(s, { used: [], pending: [], skipped: [], dropped: [] }, { exhausted })
            // 只有一般批更新選題之等待錨點;僅重審 pass 不動(否則每次重審把該核心之等待歸零、新筆記被擠後)
            if (mode === 'delta') s.proposedAt = env.at
            // 出處版本紀錄:已涵蓋或逾限之筆記記選篇當下之內容鍵(日後據以判內容變更);實際呈現之衝突邊與已處置之重審衝突邊入 seenConflicts
            const version = env.contentCache.enabled ? env.contentCache.version : ''
            const done = new Set([...covered, ...exhausted])
            if (version) for (const b of batch) if (done.has(b.id) && b.key) s.seen[b.id] = { k: b.key, v: version, ...(b.body ? { h: b.body } : {}) }
            // 衝突之去向(檢定標準 ES5):兩端皆可引之衝突列逐邊以落地狀態判定——已處置者入 seen;未見處置而有宣告「非對立」(附理由)者
            //   入 seen 並交 RS4 待判;皆無者記次數,逾 2 次交 RS4 待判並入 seen(不無限重呈),未逾者下次再呈現
            const cd = settleConflictDispositions({ s, rows: enforcedRows, decl: r.conflictDecl || [], cov, led: env.ledger.entry(msg.data._ledgerKey) })
            for (const [key, n] of Object.entries(cd.counts)) count(msg, key, n)
            const settled = new Set(cd.seen)
            // 重審之新衝突項已涵蓋:其邊若在本次之 R 列,依去向;不在(截斷未呈現)者依舊以涵蓋為已處置
            const enforcedIds = new Set(enforcedRows.map((x) => x.id))
            const handled = recheck.filter((x) => x.reason === RECHECK_REASONS.conflict && done.has(x.id) && (!enforcedIds.has(x.edgeId) || settled.has(x.edgeId))).map((x) => x.edgeId)
            // 衝突已撤銷之重審項已涵蓋 → 自 seenConflicts 移出(已處置;日後再成為衝突即為新衝突)。未涵蓋者保留,下次再排
            const goneDone = new Set(recheck.filter((x) => x.reason === RECHECK_REASONS.conflictGone && done.has(x.id)).map((x) => x.edgeId))
            s.seenConflicts = [...new Set([...(s.seenConflicts || []), ...shownConflicts, ...cd.seen, ...handled])].filter((x) => !goneDone.has(x))
            // 關聯變更之影響(ES10):夥伴被引為出處(含存入待審之操作)→ 記經此邊入批(日後此邊變更即重審此篇);關聯變更之重審項已涵蓋或逾限 → 清除
            //   (夥伴之消化即移出候選,由 commitBatch 處理)
            const cited0 = new Set([...cov.used, ...cov.pending])
            for (const x of recheck) {
                if (x.reason === RECHECK_REASONS.partner && cited0.has(x.id) && x.edgeId) {
                    if (!isobj(s.via)) s.via = {}
                    s.via[x.id] = x.edgeId
                    count(msg, 'partnersUsed')
                }
                if ((x.reason === RECHECK_REASONS.relationChanged || x.reason === RECHECK_REASONS.conflictReason) && done.has(x.id) && isobj(s.impactRecheck)) delete s.impactRecheck[x.id]
            }
            msg.data._rs4 = cd.toRs4
            if (!isobj(s.lineage)) s.lineage = { at: env.at }
            // 重審篇與夥伴(新筆記,ES10)分計;兩者皆不計入一般消化(外部巡檢以一般消化對照主標籤積壓)
            const pIds = new Set(recheck.filter((x) => x.reason === RECHECK_REASONS.partner).map((x) => x.id))
            const rDone = [...rIds].filter((id) => done.has(id))
            count(msg, 'notesRechecked', rDone.filter((id) => !pIds.has(id)).length)
            count(msg, 'partnersCovered', rDone.filter((id) => pIds.has(id)).length)
            count(msg, 'recheckExhausted', exhausted.filter((id) => rIds.has(id)).length)
            if (mode === 'recheck') {
                const led = env.ledger.entry(msg.data._ledgerKey)
                led.recheckTries = 0
                led.recheckLastError = ''
            }
            // 程式寫入之不變式(ES1):本段之落帳(逾限出隊、選題錨點、出處版本、已見衝突、首見)不得改動條目、不得減少已用筆記——違反即不落盤
            const bad = programWriteProblems(passOut, s)
            if (bad.length) {
                const led = env.ledger.entry(msg.data._ledgerKey)
                led.tries = (led.tries || 0) + 1
                led.lastTriedAt = env.at
                led.lastError = oneline(`不變式違反（pass 後落帳）：${bad.join('；')}`, LEDGER_ERROR_CHARS)
                ctx.log.error(`提煉[${t.concept}]：不變式違反（pass 後落帳，未落盤）：${bad.slice(0, 3).join('；')}`)
                msg.data._halt = 'invariant'
                return msg
            }
        }
        if (mode === 'essence') {
            // 本質專步套用後仍不合 ES6(本質被拒收或未產出)→ 記為失敗以退避(否則每輪同一核心重付一次 3+3);補成即歸零
            const led = env.ledger.entry(msg.data._ledgerKey)
            if (essenceNeedOf(s).need) {
                led.essenceTries = (led.essenceTries || 0) + 1
                led.essenceLastTriedAt = env.at
                led.essenceLastError = oneline(`本質未成立（套用 ${r.applied.length}、拒收 ${r.rejected.length}${r.rejected[0] ? `：${r.rejected[0].reason}` : ''}）`, LEDGER_ERROR_CHARS)
                ctx.log.warn(`提煉[${t.concept}]：本質專步未補成本質（${led.essenceLastError}），退避後再試`)
            }
            else {
                led.essenceTries = 0
                led.essenceLastError = ''
            }
            // 無任何操作套用 → 狀態未變,不落盤(不空升 rev)
            if (!r.applied.length) {
                msg.data._halt = 'no-change'
                return msg
            }
        }
        if (r.degrade?.length) {
            count(msg, 'degraded')
            ctx.log.warn(`提煉降級[${t.concept}]：${r.degrade.join('；')}`)
        }
        // 暫緩之不可逆操作其所依新項未成立(被終審剔除或被拒收)者無法存待審——如實記錄,不以「改存待審」誤報
        const lost = (r.withheld || []).filter((w) => !w.resolved)
        if (lost.length) ctx.log.info(`提煉[${t.concept}]：${lost.length} 項暫緩之不可逆操作所依新項未成立（被終審剔除或拒收），未存待審（${lost.slice(0, 3).map((w) => `${w.op}（i=${w.index}）`).join('、')}）`)
        if (r.pendingDropped) {
            // 丟棄的是提案(非知識),但須落帳可查(待審逾上限丟最舊者,不落帳即無從追查被丟了什麼):逐項寫入丟棄帳。
            //   丟棄於落盤時才生效(本段只記帳):落盤失敗者下次重算、重列——帳內同一提案可能重複出現,以 at 分辨
            const rows = (r.pendingDroppedOps || []).map((e) => ({ at: env.at, core: core.id, concept: t.concept, op: e.op, sources: e.sources || [], queuedAt: e.at || '', reason: e.reason || '' }))
            try {
                appendJsonlRows(path.join(env.dirs.state, PENDING_DROPPED_FILE), rows)
            }
            catch (e) {
                ctx.log.warn(`提煉[${t.concept}]：待審丟棄帳寫入失敗（${oneline(e?.message, 120)}）`)
            }
            ctx.log.warn(`提煉[${t.concept}]：待審逾上限，最舊 ${r.pendingDropped} 項將於落盤時丟棄（${rows.slice(0, 3).map((x) => `${x.op.op}〔${x.op.id || x.op.into || ''}〕`).join('、')}；內容記於 ${PENDING_DROPPED_FILE}，落盤失敗則下次重列）`)
        }
        if (r.invariantDropped?.length) count(msg, 'invariantDropped', r.invariantDropped.length)
        const st = r.stats || {}
        count(msg, 'opsApplied', r.applied.length)
        count(msg, 'opsRejected', r.rejected.length)
        count(msg, 'opsWithheld', r.queued || 0)
        count(msg, 'overLimit', r.overLimit || 0)
        count(msg, 'lengthChecked', r.lengthChecked || 0)
        count(msg, 'guardRejected', st.guardRejected || 0)
        // 檢定標準之納入閘(standards/opStandards):交修訂之程式意見數、定稿仍不合而不採之操作數(待審裁決之不採另計)
        count(msg, 'stdIssues', st.stdIssues || 0)
        count(msg, 'stdRejected', st.stdRejected || 0)
        count(msg, 'auditIssues', st.issues || 0)
        count(msg, 'patchApplied', st.patch?.ok || 0)
        count(msg, 'patchBlocked', st.patch?.blocked || 0)
        count(msg, 'verdictBlocked', st.verdictBlocked || 0)
        // 出處支持覆核(檢定標準 ES9):受檢之斷言數、成立而未受支持(不採)之操作數、判不了(不採、所引本批筆記入待判)之操作數、
        //   基礎設施未成立(存待審)之操作數、材料不可得(不送審)之操作數、中止而未判之操作數(計一次截止)
        count(msg, 'supportChecked', st.supportChecked || 0)
        count(msg, 'supportCalls', st.supportCalls || 0)
        count(msg, 'supportRejected', st.supportRejected || 0)
        count(msg, 'supportUndetermined', st.supportUndetermined || 0)
        count(msg, 'supportInfra', st.supportInfra || 0)
        count(msg, 'supportWithheld', st.supportWithheld || 0)
        count(msg, 'supportUnreadable', st.supportUnreadable || 0)
        count(msg, 'supportStopped', st.supportStopped || 0)
        if ((st.supportStopped || 0) > 0) count(msg, 'stopped')
        // 語氣超出證據之修訂(ES7 併入 ES9):修訂後受支持而照套、修訂後仍不採
        count(msg, 'supportRevised', st.supportRevised || 0)
        count(msg, 'supportReviseFailed', st.supportReviseFailed || 0)
        // 出處排除集(⑳):受支持而兩席皆未列為支持之出處——自新增出處之操作移除之篇數、既有主張排除集更新之條數
        count(msg, 'supportSourcesDropped', st.supportSourcesDropped || 0)
        count(msg, 'supportExcludedClaims', st.supportExcludedClaims || 0)
        if (r.verdicts) logVerdicts(r.verdicts, r.trace?.reviewOps || r.reviewOps || [], t, msg, ctx)
        // 絕對語氣指標(只計數不擋):本次新寫入或改寫之有效主張文字
        const prevText = new Map(core.state.claims.map((c) => [c.id, c.text]))
        const tones = s.claims.filter((c) => !TERMINAL_SET.has(c.status) && c.text !== prevText.get(c.id)).map((c) => [c.id, domain.toneOf(c.text)]).filter(([, p]) => p)
        if (tones.length) {
            count(msg, 'absoluteTone', tones.length)
            ctx.log.info(`提煉語氣[${t.concept}]：${tones.length} 條新寫主張含絕對語氣（${tones.slice(0, 5).map(([id, p]) => `〔${id}〕「${p}」`).join('、')}）`)
        }
        count(msg, 'questionsAdded', r.applied.filter((a) => a.op === 'question_add').length)
        count(msg, 'questionsResolved', r.applied.filter((a) => a.op === 'question_resolve').length)
        // 消化計數不含重審筆記(重審另計 notesRechecked;實際消化之計數不被灌水)
        count(msg, 'notesUsed', cov.used.filter((id) => !rIds.has(id)).length)
        count(msg, 'notesSkipped', [...cov.skipped, ...cov.dropped].filter((x) => !rIds.has(x.note)).length)
        count(msg, 'notesUncovered', cov.uncovered.filter((id) => !rIds.has(id)).length - exhausted.filter((id) => !rIds.has(id)).length)
        count(msg, 'notesExhausted', exhausted.filter((id) => !rIds.has(id)).length)
        if (r.rejected.length) {
            const by = {}
            for (const x of r.rejected) by[x.reason] = (by[x.reason] || 0) + 1
            ctx.log.info(`提煉拒收[${t.concept}]：${Object.entries(by).map(([k2, n]) => `${k2}×${n}`).join('、')}`)
        }
        if (cov.badSkipped?.length) ctx.log.info(`提煉未涵蓋[${t.concept}]：略過清單中 ${cov.badSkipped.length} 項代號或理由不合，按未涵蓋處理`)
        msg.data._next = s
        // 逾限出隊(exhausted)與重送已涵蓋(resendDone)之待判登錄於落盤成功後寫(ES15;mwPersistState)
        //   ES9 判不了之操作所引、而本批已算涵蓋之筆記 → 待判(ES9;下次處理本核心時重送);未涵蓋者照未涵蓋之既有規則重送,不另登錄
        //   重送而仍未涵蓋者(resendUncovered):其 ES9 筆記層之未結登錄再登並轉使用者(登錄時判),ES15 者照 noteTries
        const resend = recheck.filter((x) => x.reason === RECHECK_REASONS.resend)
        msg.data._applied = { applied: r.applied.length, rejected: r.rejected.length, withheld: r.queued || 0, cov, exhausted, mdExhausted: msg.data._mdExhausted || [], resendDone: resend.filter((x) => covered.has(x.id)).map((x) => x.id), resendUncovered: resend.filter((x) => !covered.has(x.id) && !exhausted.includes(x.id)).map((x) => x.id), rs4: msg.data._rs4 || [], es9: (r.supportHolds || []).filter((nid) => covered.has(nid)), es9Ops: r.heldOps || [], bumped: s.version !== core.state.version }
        return next(msg)
    },
})

/**
 * 終審裁決之日誌與計數(剔除、存疑、依賴衝突、理由替代、無效裁決):終審之判斷須在生產日誌可見,
 * 否則終審席一換或重跑、爭議被系統性清空時無痕可查
 *
 * @param {Object} v 輸入裁決摘要 { dropped, doubted, conflicts, verdictRejected, delta }(runPass／runPending 之 verdicts)
 * @param {Array} ops 輸入送終審之操作(索引＝裁決之 i)
 * @param {Object} t 輸入選題項
 * @param {Object} msg 輸入訊息信封(計數用)
 * @param {Object} ctx 輸入動作鏈 ctx(日誌用)
 */
function logVerdicts(v, ops, t, msg, ctx) {
    const cut = (s, n = 40) => oneline(String(s || ''), n)
    const label = (i) => {
        const o = ops[i] || {}
        return `i=${i} ${o.op || '?'}${o.question ? `「${cut(o.question, 30)}」` : (o.id ? `〔${o.id}〕` : '')}`
    }
    const DISPUTE = new Set(['dispute_add', 'dispute_update', 'contest'])
    if (v.dropped.length) {
        count(msg, 'opsDropped', v.dropped.length)
        const by = {}
        for (const x of v.dropped) by[x.reason] = (by[x.reason] || 0) + 1
        const disputes = v.dropped.filter((x) => DISPUTE.has(x.op))
        ctx.log.info(`提煉終審剔除[${t.concept}]：${Object.entries(by).map(([k, n]) => `${k}×${n}`).join('、')}${disputes.length ? `；爭議類 ${disputes.slice(0, 5).map((x) => `${label(x.index)}（${x.reason}${x.note ? `：${cut(x.note)}` : ''}）`).join('；')}` : ''}`)
    }
    if (v.doubted.length) {
        count(msg, 'opsDoubted', v.doubted.length)
        const byDrop = v.doubted.filter((x) => x.byDrop).length
        ctx.log.info(`提煉終審存疑[${t.concept}]：${v.doubted.slice(0, 5).map((x) => `${label(x.index)}（${x.reason}：${cut(x.note || '（未附說明）')}）`).join('；')}${byDrop ? `（其中 ${byDrop} 則以「剔除＋${[...new Set(v.doubted.filter((x) => x.byDrop).map((x) => x.reason))].join('／')}」表達，已轉為存疑）` : ''}`)
    }
    if (v.verdictRejected?.length) ctx.log.info(`提煉終審[${t.concept}]：${v.verdictRejected.length} 則裁決無效（${v.verdictRejected.slice(0, 3).map((x) => x.reason).join('；')}），相應操作按未裁決處理`)
    if (v.conflicts.length) {
        // 保留之操作所引之新項被剔除(任一理由):終審之裁決自相矛盾,該操作連帶拒收、其內容(爭議、本質、參數…)本批不成立——一律 WARN,
        //   外部巡檢之「未列入已知常態之警告」可見;reviewDisputesCascaded＝因此不成立之爭議類操作數
        count(msg, 'reviewConflicts', v.conflicts.length)
        const disputesLost = new Set(v.conflicts.filter((c) => DISPUTE.has(c.keptOp)).map((c) => c.kept)).size
        if (disputesLost) count(msg, 'reviewDisputesCascaded', disputesLost)
        ctx.log.warn(`提煉終審自相矛盾[${t.concept}]：${v.conflicts.slice(0, 5).map((c) => `保留 ${label(c.kept)}，卻以「${c.reason}」剔除其所引 ${c.ref}（i=${c.dropped}）`).join('；')}${v.conflicts.length > 5 ? `；等共 ${v.conflicts.length} 則` : ''}——所引不成立，該操作連帶拒收`)
    }
    // 理由替代之監測:以「離題」剔除爭議、而其所引之主張皆保留(既有者、或同差量保留之新項)——懷疑可能被改寫成離題
    const keptRefs = new Set(v.delta.ops.map((o) => o?.ref).filter(Boolean))
    const sub = v.dropped.filter((x) => x.op === 'dispute_add' && x.reason === OFFTOPIC_REASON).filter((x) => {
        const cited = (ops[x.index]?.sides || []).flatMap((sd) => (isarr(sd?.claims) ? sd.claims : []))
        return cited.length > 0 && cited.every((c) => (String(c).startsWith('@') ? keptRefs.has(String(c).slice(1)) : true))
    })
    if (sub.length) {
        count(msg, 'reviewDisputeOfftopicKept', sub.length)
        ctx.log.info(`提煉終審不一致[${t.concept}]：以「離題」剔除爭議 ${sub.slice(0, 3).map((x) => label(x.index)).join('、')}，其所引主張卻皆保留`)
    }
}

/**
 * 錨點:renderState(版型組裝:自狀態渲染 md,不落地;replace 此環＝換核心版型)
 *
 * 讀 msg.data(_core、_next、_env、_domain);寫 msg.data._render({ front, body, hash })、_next.renderHashes(最近兩次)
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * need test in nodejs.
 *
 * const mw = mwRenderState()
 */
export const mwRenderState = () => defineMw({
    name: 'renderState',
    handle: async (msg, ctx, next) => {
        const { _core: core, _next: s, _env: env, _domain: domain } = msg.data
        const rendered = renderOf(s, domain, env, core.id)
        s.renderHashes = nextRenderHashes(core.state, rendered.hash)
        msg.data._render = rendered
        return next(msg)
    },
})

/**
 * 錨點:persistState(落盤:dirty → 狀態(CAS)→ 再驗 rev → md(手改偵測)→ cores 記錄 → extractedAt → 分身 → 清 dirty)
 *
 * 讀 msg.data(target、mode、_core、_next、_render、_applied、_env);寫 msg.data._out(落盤後之狀態);短路:CAS 衝突或寫檔失敗
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * need test in nodejs.
 *
 * const mw = mwPersistState()
 */
export const mwPersistState = () => defineMw({
    name: 'persistState',
    handle: async (msg, ctx, next) => {
        const { target: t, mode, _core: core, _next: s, _render: rendered, _applied: ap, _env: env } = msg.data
        const dirty = path.join(env.aux.dirty, core.id)
        fs.mkdirSync(env.aux.dirty, { recursive: true })
        fs.writeFileSync(dirty, env.at, 'utf8')
        // CAS 衝突之落帳:本輪已付 AI 而未落盤,與 AI 失敗同計一次(stages/extractStage 檔頭【失敗帳】)
        const casFail = (why) => {
            const led = env.ledger.entry(msg.data._ledgerKey)
            led.tries = (led.tries || 0) + 1
            led.lastTriedAt = env.at
            led.lastError = oneline(why, LEDGER_ERROR_CHARS)
            ctx.log.error(`提煉[${t.concept}]：${oneline(why, 240)}`)
            msg.data._halt = 'cas'
            return msg
        }
        // 先記後寫:待判登錄(ctx 記本次落盤後之 rev)→ 狀態(CAS)。登錄或落盤失敗 → 以前像補償本次登錄(有前像者寫回、無者結案);
        //   狀態已提交而其後(投影)失敗者不補償——登錄對應之落盤已完成
        const holdsCtx = { coreId: core.id, concept: t.concept, ap, msg }
        const undo = []
        let written
        try {
            await registerHolds(env, ctx, holdsCtx, { rev: nextRevOf(core.expectRev, s), undo })
            written = env.store.save(core.id, s, { expectRev: core.expectRev })
        }
        catch (e) {
            fs.rmSync(dirty, { force: true })
            await compensateHolds(env, ctx, t.concept, undo)
            return casFail(e.message)
        }
        // 維運工具(regenCore)恰在狀態寫入之後封存時,不可再寫回投影(否則 cores 記錄復活而狀態已不在)
        if (env.store.diskRev(core.id) !== written.rev) return casFail('狀態寫入後即被他處改動（如 regenCore），不寫投影')
        const saved = env.store.guardManualEdit(core.file, knownHashesOf(core.state, rendered), env.stamp, env.aux.manual)
        if (saved) ctx.log.warn(`提煉手改另存[${t.concept}]：核心 md 與上次渲染不符，覆寫前已另存 ${saved.replace(/\\/g, '/')}`)
        writeMd(core.file, rendered.front, rendered.body)
        const k = env.cores.findIndex((c) => c.id === core.id)
        const rec = recordOf(written, { id: core.id, file: core.file, prev: k >= 0 ? env.cores[k] : null })
        await env.stores.cores.replace(rec)
        if (k >= 0) env.cores.splice(k, 1, rec)
        else env.cores.push(rec)
        await markExtracted(env.stores.notes, env.notesById, written.consumed, env.at)
        // 分身處理只由主核心(coreForKey 所選:版本高、篇數多者)發動;本核心若是分身,落盤後不得把主核心標 merged
        if (coreForKey(env.cores, rec.scope, normalizeConcept(rec.concept))?.id === rec.id) count(msg, 'twinsMerged', await settleTwins(rec, env, msg.data._domain))
        fs.rmSync(dirty, { force: true })
        await closeHolds(env, ctx, holdsCtx)
        const led = env.ledger.entry(msg.data._ledgerKey)
        // 專步(爭議覆核、出處支持存量覆核、失撐主張)之落盤不動選題之失敗帳(其失敗另立欄位;同僅重審 pass 之理由:不改選題之等待錨點)
        const special = ['dispute', 'support', 'orphan'].includes(mode)
        if (!special) {
            led.tries = 0
            led.lastError = ''
        }
        if (ap.bumped) count(msg, 'bumps') // 升版次數(追趕時同一核心可多次);「更新 N 則核心」以核心計,由階段於逐核心結束時計
        if (!special) count(msg, { delta: 'batches', consolidate: 'consolidated', recheck: 'recheckPasses', essence: 'essencePasses' }[mode] || 'pendingReviewed')
        const c = ap.cov
        const nR = (msg.data._recheck || []).length ? new Set(msg.data._recheck.map((x) => x.id)).size : 0
        ctx.log.info(`提煉[${t.concept}]：${ap.bumped ? `v${written.version} 完成` : `v${written.version} 未改版`}（${mode === 'delta' || mode === 'recheck' ? `${mode === 'recheck' ? '重審；' : ''}本批 ${msg.data._batch.length} 篇${nR ? `（重審 ${nR} 篇）` : ''}：引用 ${c.used.length}、略過 ${c.skipped.length + c.dropped.length}、未涵蓋 ${c.uncovered.length}${ap.exhausted.length ? `（逾限 ${ap.exhausted.length}）` : ''}；` : ({ consolidate: '整併；', essence: '本質；', dispute: '爭議覆核；', support: '出處支持存量覆核；', orphan: '失撐主張找支持；' }[mode] || '待審裁決；')}操作 套用 ${ap.applied}、拒收 ${ap.rejected}${ap.withheld ? `、存待審 ${ap.withheld}` : ''}；有效主張 ${written.claims.filter((x) => !TERMINAL_SET.has(x.status)).length} 條${(written.pendingReview || []).length ? `；待審 ${written.pendingReview.length} 項` : ''}）`)
        msg.data._out = written
        return next(msg)
    },
})

export default { mwLoadState, mwSelectNotes, mwPass, mwRenderState, mwPersistState, aiCallLogOf, backoffDaysOf, stepFailNote, PANEL_MODES, STREAK_MODES }
