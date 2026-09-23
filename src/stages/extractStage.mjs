// extractStage.mjs — 彙整物件子階段 b1:佇列→批次 AI 萃取→逐項動作鏈→線索回收
//
// hook 錨點:organize.extract.{saveClues, skipGate, renderNote, persistNote, markDoc}
// 批次調度(部分接受/隊頭防阻塞/tries 出隊/額度中止/零進度守門/時間預算守門)是 aiBatchStage 機制,
// 不拆散;通過驗證的逐項結果送進動作鏈——掛載點在逐項鏈上。
// prompt/驗證/版型內建於 domain(deps.domains.extract),可由 opt.domain 整組置換
// 或 tap 逐環覆寫(replace renderNote＝換版型)。
//
// 【一次呼叫做兩件事】萃取與「待探索線索判斷」合併為單一 AI 呼叫(額度是硬限制,
//   拆兩次等於可處理文件量砍半,而兩件事讀同一份原文)。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { budgetOf } from '../core/budget.mjs'
import { conceptVocabulary } from '../stores/conceptGroups.mjs'
import { saveClues } from '../stores/frontierPolicy.mjs'
import { byRetryTierFifo } from '../stores/docPolicy.mjs'
import { runAiBatchStage } from './aiBatchStage.mjs'
import { slugify } from '../util/text.mjs'
import { oneline, queueAge } from '../util/misc.mjs'
import { writeMd } from '../md/md.mjs'

/**
 * 錨點:saveClues(線索回收:略過的文件仍收線索——彙整貼文不成筆記,但它列的題目正是最值得追的)
 *
 * 讀 msg.data(doc.id、_aiItem、_domain);不寫 msg.data(線索寫入 stores.frontier);不短路(恆呼叫 next)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.clueTypes] 輸入線索型別白名單，傳給 saveClues
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwSaveClues = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'saveClues',
        handle: async (msg, ctx, next) => {
            const { stores, clock } = ctx.deps
            const item = msg.data._aiItem
            const domain = msg.data._domain
            const explore = domain.exploreOf?.(item) || item.explore || []
            const clue = await saveClues(stores.frontier, explore, {
                types: opt.clueTypes, nowIso: clock.iso8(), fromRef: item.relevant ? '' : `skip:${msg.data.doc.id}`,
            })
            count(msg, 'explore', clue.addCount)
            return next(msg)
        },
    })
}

/**
 * 錨點:skipGate(非知識判定:標記略過並短路,不進版型/落庫)
 *
 * 讀 msg.data(doc、_aiItem.relevant、_domain);不寫 msg.data(略過狀態寫入 stores.docs);
 * 短路:_aiItem.relevant 為 false 時處理後直接回傳 msg(不呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwSkipGate = () => defineMw({
    name: 'skipGate',
    when: (m) => !m.data._aiItem.relevant,
    handle: async (msg, ctx) => {
        const { stores, clock } = ctx.deps
        const { doc, _aiItem: item, _domain: domain } = msg.data
        await stores.docs.patch(doc.id, {
            status: 'skip',
            skipReason: String(domain.skipReasonOf?.(item) || item.reason || '').slice(0, 150),
            notedAt: clock.iso8(),
        })
        count(msg, 'processed')
        count(msg, 'skipped')
        ctx.log.info(`萃取：略過[${String(doc.title || '').slice(0, 40)}] → 保留線索 ${msg.stats.explore || 0} 筆`)
        return msg // 短路
    },
})

/**
 * 錨點:renderNote(版型組裝:slug/front/body/索引記錄,不落地;replace 此環＝換筆記版型)
 *
 * 讀 msg.data(doc、_aiItem、_domain);寫 msg.data._note({slug,file,nowIso,front,body,record});不短路(恆呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwRenderNote = () => defineMw({
    name: 'renderNote',
    handle: async (msg, ctx, next) => {
        const { dirs, clock } = ctx.deps
        const { doc, _aiItem: k, _domain: domain } = msg.data
        const nowIso = clock.iso8()
        const slug = slugify(k.title, doc.id)
        const file = path.join(dirs.notes, `${slug}.md`)
        const concepts = (k.concepts || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 6)
        const q = domain.normalizeQuality(k)
        const cat = domain.vocab.categories.includes(k.category) ? k.category : '其他'
        msg.data._note = {
            slug,
            file,
            nowIso,
            front: {
                title: k.title,
                slug,
                category: cat,
                concepts,
                claim_type: q.claimType,
                evidence_level: q.evidenceLevel,
                sample_period: q.samplePeriod,
                caveats: q.caveats,
                source_name: doc.sourceName,
                source_url: doc.url,
                published: doc.publishedAt || '',
                created: nowIso,
                doc_id: doc.id,
                type: 'note',
            },
            body: domain.renderNoteBody(k, doc, q),
            record: {
                id: slug,
                title: k.title,
                category: cat,
                concepts,
                summary: String(k.summary || '').slice(0, 300),
                claimType: q.claimType,
                evidenceLevel: q.evidenceLevel,
                caveats: q.caveats,
                samplePeriod: q.samplePeriod,
                sourceUrl: doc.url,
                sourceName: doc.sourceName,
                docId: doc.id,
                file: file.replace(/\\/g, '/'),
                createdAt: nowIso,
                relatedAt: '',
                distilledAt: '',
            },
        }
        return next(msg)
    },
})

/**
 * 錨點:persistNote(落地:寫 md＋筆記索引入庫)
 *
 * 讀 msg.data._note({file,front,body,record});不寫 msg.data(落地為 md 檔與 stores.notes);不短路(恆呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwPersistNote = () => defineMw({
    name: 'persistNote',
    handle: async (msg, ctx, next) => {
        const { stores } = ctx.deps
        const n = msg.data._note
        writeMd(n.file, n.front, n.body)
        await stores.notes.insertNew([n.record])
        count(msg, 'notes')
        return next(msg)
    },
})

/**
 * 錨點:markDoc(文件終態:noted＋回鏈 slug)
 *
 * 讀 msg.data(doc、_note.slug、_note.nowIso);不寫 msg.data(終態寫入 stores.docs);不短路(恆呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwMarkDoc = () => defineMw({
    name: 'markDoc',
    handle: async (msg, ctx, next) => {
        const { stores } = ctx.deps
        const { doc, _note: n } = msg.data
        await stores.docs.patch(doc.id, { status: 'noted', noteSlug: n.slug, notedAt: n.nowIso })
        count(msg, 'processed')
        ctx.log.info(`萃取：新增知識筆記 ${n.slug}`)
        return next(msg)
    },
})

/**
 * 萃取子階段:佇列→批次 AI 萃取→逐項動作鏈→線索回收。hook 錨點:organize.extract.{saveClues, skipGate, renderNote, persistNote, markDoc}
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)
 * @param {Object} [opt.domain] 輸入整組置換之萃取領域物件，未給則用 ctx.deps.domains.extract
 * @param {Function} [opt.callAI] 輸入覆寫之 AI 呼叫函數 (prompt, check, {shouldStop, budgetMs}) => Promise，未給則用 ai.callJson
 * @param {Integer} [opt.docsPerBatch] 輸入每批文件數，未給則用 settings.knowledge.docsPerExtract
 * @param {Integer} [opt.parallel] 輸入每輪並行批數，未給則用 settings.ai.aiParallel
 * @param {Integer} [opt.rounds] 輸入輪數，未給則用 settings.ai.fetchExtractRounds
 * @param {Integer} [opt.maxTries=3] 輸入萃取失敗達幾次即標為 extract-failed
 * @param {Array} [opt.clueTypes] 輸入線索型別白名單，傳給 mwSaveClues
 * @param {Object} [opt.statuses] 輸入狀態名覆寫，可含 pending、failed
 * @param {String} [opt.triesField='extractTries'] 輸入嘗試次數計數之欄位名
 * @param {Boolean} [opt.requireTriage] 輸入是否只萃取已預篩放行者，未給則用 settings.knowledge.triageEnabled===true
 * @returns {Object} 回傳 stage 物件 { name, run }
 */
export function stageExtract(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps(
        [mwSaveClues(opt), mwSkipGate(opt), mwRenderNote(opt), mwPersistNote(opt), mwMarkDoc(opt)],
        opt.tap, { chainName: 'organize.extract' },
    )

    return {
        name: 'extract',
        run: async (ctx) => {
            const { stores, settings, ai } = ctx.deps
            const log = ctx.log
            const domain = opt.domain || ctx.deps.domains.extract
            // 時間預算(core/budget 單一擁有者):每次呼叫以剩餘時間封頂、嘗試之間可中止;每輪開工前由 harness 守門。
            // 覆寫 callAI 者亦收到第三參數(shouldStop/budgetMs),不因覆寫而失去時間預算
            const budget = budgetOf(ctx)
            const shouldStop = budget.shouldStop
            const baseCall = (p, c, o) => ai.callJson(p, c, { spec: settings.ai.extract.executor, ...o })
            const callAI = (p, c) => (opt.callAI || baseCall)(p, c, { shouldStop, budgetMs: budget.remainingMs() })
            const st = { pending: 'raw', failed: 'extract-failed', ...(opt.statuses || {}) }
            const triesField = opt.triesField || 'extractTries'
            const maxTries = opt.maxTries ?? 3

            /**
             * 累加萃取失敗次數;達 maxTries 即標為終態(st.failed)並記 lastError,否則僅累加供下輪隊頭防阻塞排序
             * @param {Object} doc 輸入待萃取文件記錄
             * @param {String} why 輸入本次失敗原因(寫入 lastError／warn 訊息)
             */
            const bumpTries = async (doc, why) => {
                const tries = (doc[triesField] || 0) + 1
                if (tries >= maxTries) {
                    await stores.docs.patch(doc.id, { [triesField]: tries, status: st.failed, lastError: why })
                    log.warn(`萃取：[${String(doc.title || '').slice(0, 40)}] ${why}（第 ${tries} 次），標為 ${st.failed}`)
                }
                else {
                    await stores.docs.patch(doc.id, { [triesField]: tries })
                }
            }

            /**
             * 套件層(機制)之最低結構驗證:index 落在批次範圍內且 relevant 為布林值;domain.isValidItem 另補內容層驗證
             * @param {Object} it 輸入 AI 回傳之單一項目
             * @param {Integer} cnt 輸入本批文件數(index 須介於 1～cnt)
             * @returns {Boolean} 回傳是否通過機制層最低驗證
             */
            const baseValid = (it, cnt) => it && typeof it === 'object' &&
        typeof it.index === 'number' && it.index >= 1 && it.index <= cnt &&
        typeof it.relevant === 'boolean'

            const batchSize = opt.docsPerBatch ?? settings.knowledge.docsPerExtract
            const parallel = opt.parallel ?? settings.ai.aiParallel
            const rounds = opt.rounds ?? settings.ai.fetchExtractRounds
            // 預篩接縫(stages/triageStage):啟用(resolveSettings 預設 true)時只萃取已放行者(triage==='relevant');
            // 未預篩者等預篩,攔下者已轉 skip。settings 未經 resolveSettings(undefined)視為未啟用,與預篩段同一判準
            const requireTriage = opt.requireTriage ?? settings.knowledge?.triageEnabled === true
            const ready = (d) => !requireTriage || d.triage === 'relevant'
            // 積壓可見性:raw 池與最舊者天數每輪進日誌;容量＝rounds×parallel×batchSize(巡檢據此判容量不足;不丟)
            const rawAll = await stores.docs.select({ status: st.pending })
            const pool = queueAge(rawAll, 'rawAt') // 量進入 raw 之時刻,非收錄時刻
            const readyCount = rawAll.filter(ready).length
            log.info(`raw 池 ${pool.count} 篇（最舊 ${pool.oldestDays ?? '-'} 天${requireTriage ? `，已預篩放行 ${readyCount}` : ''}），本輪容量 ${rounds * parallel * batchSize}`)

            const r = await runAiBatchStage({
                log,
                batchSize,
                parallel,
                rounds,
                shouldStop,
                // 選取順序(stores/docPolicy byRetryTierFifo,與補全文段同一份):tries 升冪(失敗批排隊尾,同一批永遠排隊頭
                // 會把整條線擋死)→ tier → collectedAt(FIFO;曾為最新優先,進料大於容量時最舊者永遠輪不到)
                pickPool: async (limit) => (await stores.docs.select({ status: st.pending })).filter(ready).sort(byRetryTierFifo(triesField)).slice(0, limit),
                buildPrompt: async (batch) => domain.buildPrompt(batch, await conceptVocabulary(stores.notes)),
                checkResult: (data, batch) => Array.isArray(data) && data.length > 0 &&
          data.some((it) => baseValid(it, batch.length) && domain.isValidItem(it, batch.length)),
                isValidItem: (it, batch) => baseValid(it, batch.length) && domain.isValidItem(it, batch.length),
                indexOf: (it) => it.index,
                callAI,
                // 逐項鏈走 runChainOverMsgs(與抓取側同一執行器):mw 可 ctx.emit 衍生訊息(1→N),
                // 單項拋錯被隔離、不中斷同批其餘項目;拋錯者仍記 tries——此 doc 仍為 raw 且 tries 最小者
                // 最先被挑,不記就永遠排在隊頭、每輪佔一個批次名額(與隊頭防阻塞機制相悖)
                applyItem: async (item, doc) => {
                    const msg = makeMsg('doc', { doc, _aiItem: item, _domain: domain }, { stage: 'extract' })
                    const r = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'organize.extract' })
                    if (r.fails) await bumpTries(doc, `逐項鏈異常：${oneline(r.errors.join('；'), 150)}`)
                    return r.stats
                },
                onMissed: (doc) => bumpTries(doc, '未被模型完整涵蓋（輸出截斷）'),
                onBatchFailed: async (batch) => {
                    // 整批失敗:無法得知是哪一篇引發截斷,只能整批降序;換批次組合後無辜文件仍有機會
                    for (const d of batch) await bumpTries(d, '萃取批次失敗（輸出截斷／驗證不過）')
                },
            })

            // fail＝失敗批次＋未涵蓋項(不含預算／額度中止):此前手組 report 恆為 fail:0,批次失敗被吸收成「一切正常」
            return stdReport({
                stats: { in: r.applied.processed || 0, out: r.applied.notes || 0, skip: r.applied.skipped || 0, fail: r.failedBatches + r.missed, aiCalls: r.aiCalls },
                detail: {
                    processed: r.applied.processed || 0,
                    notes: r.applied.notes || 0,
                    skipped: r.applied.skipped || 0,
                    explore: r.applied.explore || 0,
                    aborted: r.aborted,
                    stopped: r.stopped,
                    failedBatches: r.failedBatches,
                    missed: r.missed,
                    aiAttempts: r.aiAttempts,
                    pool: pool.count,
                    poolOldestDays: pool.oldestDays,
                    ready: readyCount,
                },
            })
        },
    }
}

export default stageExtract
