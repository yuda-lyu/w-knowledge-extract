// triageStage.mjs — 彙整物件子階段 b0:預篩(raw 文件之標題＋開頭片段 → 放行／攔下),萃取只讀放行者
//
// hook 錨點:organize.triage.settleTriage
// 批次調度(部分接受/隊頭防阻塞/tries 出隊/額度中止/零進度守門/時間預算守門)沿用 aiBatchStage;
// prompt/驗證內建於 domain(deps.domains.triage),可由 opt.domain 整組置換或 tap 逐環覆寫。
//
// 【與萃取的接縫】raw 文件之 `triage` 欄:無＝待預篩;'relevant'＝放行(萃取 pickPool 只取此類);
//   'irrelevant'＝攔下(同時 status→skip,skipReason「預篩：…」)。預篩失敗達上限者標 relevant 放行
//   (fail-open):預篩壞了不得擋住整條萃取線。knowledge.triageEnabled=false 即整段停用且萃取不看此欄。
// 【容量】triageRounds×aiParallel×docsPerTriage(預設 2×3×20＝120 篇/輪),約為萃取容量之 2 倍——
//   放行率實測約 4~5 成,兩段容量才對得上。

import isobj from 'wsemi/src/isobj.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { budgetOf } from '../core/budget.mjs'
import { byRetryTierFifo } from '../stores/docPolicy.mjs'
import { createTriageDomain } from '../domain/triageDomain.mjs'
import { runAiBatchStage } from './aiBatchStage.mjs'
import { oneline } from '../util/misc.mjs'

/**
 * 錨點:settleTriage(落帳:放行標 relevant;攔下轉 skip(記錄保留,skipReason 帶「預篩：」可稽核))
 *
 * 讀 msg.data(doc、_aiItem、_domain);不寫 msg.data(落帳寫入 stores.docs);不短路(恆呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwSettleTriage = () => defineMw({
    name: 'settleTriage',
    handle: async (msg, ctx, next) => {
        const { stores, clock } = ctx.deps
        const { doc, _aiItem: item, _domain: domain } = msg.data
        const now = clock.iso8()
        if (item.relevant) {
            await stores.docs.patch(doc.id, { triage: 'relevant', triagedAt: now })
            count(msg, 'relevant')
        }
        else {
            const reason = domain.reasonOf(item)
            await stores.docs.patch(doc.id, { triage: 'irrelevant', triagedAt: now, status: 'skip', skipReason: `預篩：${reason}`, notedAt: now })
            count(msg, 'irrelevant')
            ctx.log.info(`預篩：攔下[${oneline(doc.title, 40)}]（${reason}）`)
        }
        count(msg, 'processed')
        return next(msg)
    },
})

/**
 * 預篩子階段:raw 文件之標題＋開頭片段 → 放行／攔下,萃取只讀放行者。hook 錨點:organize.triage.settleTriage
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)
 * @param {Object} [opt.domain] 輸入整組置換之預篩領域物件(buildPrompt/isValidItem/reasonOf)，未給則用 ctx.deps.domains.triage
 * @param {Function} [opt.callAI] 輸入覆寫之 AI 呼叫函數 (prompt, check, {shouldStop, budgetMs}) => Promise，未給則用 ai.callJson
 * @param {Integer} [opt.docsPerBatch] 輸入每批文件數，未給則用 settings.knowledge.docsPerTriage
 * @param {Integer} [opt.parallel] 輸入每輪並行批數，未給則用 settings.ai.aiParallel
 * @param {Integer} [opt.rounds] 輸入輪數，未給則用 settings.ai.triageRounds
 * @param {Integer} [opt.maxTries] 輸入預篩失敗幾次後 fail-open 放行，未給則用 settings.knowledge.triageMaxTries，預設2
 * @param {Object} [opt.statuses] 輸入狀態名覆寫，可含 pending，預設 { pending:'raw' }
 * @param {Boolean} [opt.enabled] 輸入是否啟用本子階段，未給則用 settings.knowledge.triageEnabled===true
 * @returns {Object} 回傳 stage 物件 { name, run }
 */
export function stageTriage(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps([mwSettleTriage(opt)], opt.tap, { chainName: 'organize.triage' })

    return {
        name: 'triage',
        run: async (ctx) => {
            const { stores, settings, ai, clock } = ctx.deps
            const log = ctx.log
            // 啟用判準與萃取段同一份:settings.knowledge.triageEnabled === true(resolveSettings 預設 true;裸 settings 視為未啟用)
            const enabled = opt.enabled ?? settings.knowledge?.triageEnabled === true
            if (!enabled) return stdReport({ detail: { disabled: true, processed: 0, relevant: 0, irrelevant: 0 } })
            const domain = opt.domain || ctx.deps.domains?.triage || createTriageDomain({ vocab: ctx.deps.data?.vocab, triageCharsPerDoc: settings.knowledge.triageCharsPerDoc })
            // 時間預算(core/budget):與萃取同一份守門;覆寫 callAI 者亦收第三參數
            const budget = budgetOf(ctx)
            const shouldStop = budget.shouldStop
            // 席位:ai.triage.executor 未給即沿用萃取席位(取值延後到真的要呼叫時:覆寫 callAI 之測試環境可無 settings.ai)
            const baseCall = (p, c, o) => ai.callJson(p, c, { spec: settings.ai?.triage?.executor || settings.ai?.extract?.executor, ...o })
            const callAI = (p, c) => (opt.callAI || baseCall)(p, c, { shouldStop, budgetMs: budget.remainingMs() })
            const st = { pending: 'raw', ...(opt.statuses || {}) }
            const triesField = 'triageTries'
            const maxTries = opt.maxTries ?? settings.knowledge.triageMaxTries ?? 2

            /**
             * fail-open:預篩失敗達上限即放行交萃取(記 lastError 可稽核),不得擋住整條線
             * @param {Object} doc 輸入待預篩文件記錄
             * @param {String} why 輸入本次未判定原因(寫入 lastError／warn 訊息)
             */
            const bumpTries = async (doc, why) => {
                const tries = (doc[triesField] || 0) + 1
                if (tries >= maxTries) {
                    await stores.docs.patch(doc.id, { [triesField]: tries, triage: 'relevant', triagedAt: clock.iso8(), lastError: `預篩未判定（${why}），放行交萃取` })
                    log.warn(`預篩：[${oneline(doc.title, 40)}] ${why}（第 ${tries} 次），放行交萃取`)
                }
                else {
                    await stores.docs.patch(doc.id, { [triesField]: tries })
                }
            }

            const batchSize = opt.docsPerBatch ?? settings.knowledge.docsPerTriage
            const parallel = opt.parallel ?? settings.ai.aiParallel
            const rounds = opt.rounds ?? settings.ai.triageRounds
            /** 未預篩之待處理池:status 為 pending 且尚無 triage 欄者 */
            const pickUntriaged = async () => (await stores.docs.select({ status: st.pending })).filter((d) => !d.triage)
            const pool = await pickUntriaged()
            log.info(`預篩池 ${pool.length} 篇，本輪容量 ${rounds * parallel * batchSize}`)
            if (pool.length === 0) return stdReport({ detail: { processed: 0, relevant: 0, irrelevant: 0, pool: 0 } })

            const r = await runAiBatchStage({
                log,
                batchSize,
                parallel,
                rounds,
                shouldStop,
                // 選取順序與萃取同一份比較器(tries 升冪→tier→FIFO):高層級來源先預篩、先萃取
                pickPool: async (limit) => (await pickUntriaged()).sort(byRetryTierFifo(triesField)).slice(0, limit),
                buildPrompt: async (batch) => domain.buildPrompt(batch),
                checkResult: (data, batch) => Array.isArray(data) && data.length > 0 && data.some((it) => domain.isValidItem(it, batch.length)),
                isValidItem: (it, batch) => domain.isValidItem(it, batch.length),
                indexOf: (it) => it.index,
                callAI,
                applyItem: async (item, doc) => {
                    const msg = makeMsg('doc', { doc, _aiItem: item, _domain: domain }, { stage: 'triage' })
                    const rr = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'organize.triage' })
                    if (rr.fails) await bumpTries(doc, `逐項鏈異常：${oneline(rr.errors.join('；'), 150)}`)
                    return rr.stats
                },
                onMissed: (doc) => bumpTries(doc, '未被模型完整涵蓋'),
                onBatchFailed: async (batch) => {
                    for (const d of batch) await bumpTries(d, '預篩批次失敗（輸出截斷／驗證不過）')
                },
            })

            return stdReport({
                stats: { in: r.applied.processed || 0, out: r.applied.relevant || 0, skip: r.applied.irrelevant || 0, fail: r.failedBatches + r.missed, aiCalls: r.aiCalls },
                detail: {
                    processed: r.applied.processed || 0,
                    relevant: r.applied.relevant || 0,
                    irrelevant: r.applied.irrelevant || 0,
                    aborted: r.aborted,
                    stopped: r.stopped,
                    failedBatches: r.failedBatches,
                    missed: r.missed,
                    aiAttempts: r.aiAttempts,
                    pool: pool.length,
                },
            })
        },
    }
}

export default stageTriage
