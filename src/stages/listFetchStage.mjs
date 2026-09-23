// listFetchStage.mjs — 抓取物件子階段 a2:來源輪抓入庫(逐來源動作鏈)
//
// hook 錨點:fetch.listFetch.{fetchList, normalizeItems, filterItems, admitPersist, accountSource}
// 逐來源一條 msg(topic:'source')流過五環;來源失敗記於 _outcome、續走 accountSource 計帳。
// 契約檢查／業務過濾／去重入庫三環是 stores/ingestGate 三步的可掛載投影(探測入庫走同一閘門);
// 抓取嘗試復用 w-data-pipeline 內件(attemptFetch)——行為與 runListFetch 一致,但每一環都可掛載/置換。

import isobj from 'wsemi/src/isobj.mjs'
import { attemptFetch } from 'w-data-pipeline/src/fetch/attemptFetch.mjs'
import { isTimeoutError, ContractError } from 'w-data-pipeline/src/core/errors.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { budgetOf } from '../core/budget.mjs'
import { pickDueSources, recordSourceOutcome } from '../stores/sourcePolicy.mjs'
import { normalizeFeedItems, filterFeedItems, admitFeedItems } from '../stores/ingestGate.mjs'
import { oneline } from '../util/misc.mjs'

/**
 * mw 錨點 fetch.listFetch.fetchList:執行抓取(含 fetcher 自宣告之 timeout/重試);失敗記 _outcome 不短路——計帳環仍要走
 *
 * 讀 msg.data._fetcher／msg.data(來源記錄);成功寫 msg.data._raw,失敗寫 msg.data._outcome 並 count(msg,'srcFail')。不短路。
 * 無 opt 參數。
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwFetchList = () => defineMw({
    name: 'fetchList',
    handle: async (msg, ctx, next) => {
        const src = msg.data
        try {
            msg.data._raw = await attemptFetch(src._fetcher, src, ctx, src._fetcher.timeoutMs || 0)
        }
        catch (e) {
            msg.data._outcome = { ok: false, reason: isTimeoutError(e) ? 'timeout' : 'fetch-error', error: oneline(e?.message, 300) }
            count(msg, 'srcFail')
            ctx.log.warn(`來源[${src.name || src.url}] 抓取失敗（${msg.data._outcome.reason}）：${msg.data._outcome.error.slice(0, 200)}`)
        }
        return next(msg)
    },
})

/**
 * mw 錨點 fetch.listFetch.normalizeItems:契約檢查(僅 msg.data._raw !== undefined 時執行)。
 *
 * 非法項目略過並留痕(靜默丟棄會讓「這輪沒新資料」無從歸因);
 * 每來源取用上限(itemsPerSource)在此截斷——進料須與每輪處理量同量級,否則佇列無上限累積、
 * 舊料被餓死(2026-09-06 實測:未截斷時單來源一輪新增達 100 篇,new 積壓 4428、expired 3679)。
 * 抓取器回傳不合契約(非陣列)屬實作錯誤,但仍記 _outcome 走完計帳環——否則該來源
 * lastFetchAt 永不更新、永遠排在「最舊優先」隊頭且不會因連敗停用(舊 runListFetch 拋錯時同樣呼叫 onSource)。
 *
 * 讀 msg.data._raw／msg.data._fetcher;成功寫 msg.data._items,失敗寫 msg.data._outcome 並 count(msg,'srcFail')。不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Integer} [opt.itemsPerSource] 輸入每來源取用上限,未給則用 settings.fetch.itemsPerSource
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwNormalizeItems = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'normalizeItems',
        when: (m) => m.data._raw !== undefined,
        handle: async (msg, ctx, next) => {
            const src = msg.data
            let r
            try {
                r = normalizeFeedItems(src._raw, { source: src, fetcherId: src._fetcher.id, ctx, itemsPerSource: opt.itemsPerSource })
            }
            catch (e) {
                msg.data._outcome = { ok: false, reason: 'contract-error', error: oneline(e?.message, 300) }
                count(msg, 'srcFail')
                ctx.log.warn(`來源[${src.name || src.url}] 抓取回傳不合契約：${oneline(e?.message, 200)}`)
                return next(msg)
            }
            if (r.invalid.length) ctx.log.warn(`來源[${src.name}] 有 ${r.invalid.length} 項不符格式而略過：${oneline(r.invalid.map((x) => x.reason).join('；'), 200)}`)
            msg.data._items = r.items
            return next(msg)
        },
    })
}

/**
 * mw 錨點 fetch.listFetch.filterItems:業務過濾接縫(僅 msg.data._items 為陣列時執行,預設放行)。
 *
 * 黑名單/日期窗這類「否決」政策掛這裡——必須在占位入庫之前。讀寫 msg.data._items。不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Function} [opt.filter] 輸入業務過濾函數 (items,{source,ctx})=>Promise<Array>|Array,未給即不過濾
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwFilterItems = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'filterItems',
        when: (m) => Array.isArray(m.data._items),
        handle: async (msg, ctx, next) => {
            const { kept, dropped } = await filterFeedItems(msg.data._items, { source: msg.data, ctx, filter: opt.filter })
            if (dropped > 0) ctx.log.info(`來源[${msg.data.name}] 業務過濾剔除 ${dropped} 項`)
            msg.data._items = kept
            return next(msg)
        },
    })
}

/**
 * mw 錨點 fetch.listFetch.admitPersist:去重占位＋入庫(seen.admit＝insertNew,僅 msg.data._items 為陣列時執行)。
 *
 * 沒抓過才放行,越下游每步越貴。讀 msg.data._items,寫 msg.data._fresh 與
 * msg.data._outcome={ok:true,itemCount},並 count(msg,'newDocs')。不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Function} [opt.toRecord] 輸入項目→doc 記錄轉換函數,未給用預設 toRecord
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwAdmitPersist = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'admitPersist',
        when: (m) => Array.isArray(m.data._items),
        handle: async (msg, ctx, next) => {
            const src = msg.data
            const r = await admitFeedItems(src._items, { source: src, fetcher: src._fetcher, ctx, toRecord: opt.toRecord })
            msg.data._fresh = r.fresh
            msg.data._outcome = { ok: true, itemCount: src._items.length }
            count(msg, 'newDocs', r.fresh.length)
            ctx.log.info(`來源[${src.name}] 取得 ${src._items.length} 項，新增 ${r.fresh.length} 篇${r.dup ? `（已抓過 ${r.dup}）` : ''}`)
            return next(msg)
        },
    })
}

/**
 * 來源計帳之單一實作(計帳環與逐來源鏈異常落帳共用,規則不手寫兩份)
 *
 * @param {Object} ctx 輸入管道脈絡(需 ctx.deps.stores/settings/clock 與 ctx.log)
 * @param {Object} src 輸入來源訊息之 data(來源記錄＋執行期欄位)
 * @param {Object} outcome 輸入本輪結果 { ok, itemCount, error }
 * @param {Object} [opt={}] 輸入子階段 opts(取 sourcePolicy 覆寫),非物件則回退為 {}
 * @returns {Promise} 回傳 Promise，resolve 回傳 recordSourceOutcome 之結果 { disabled, reason }
 */
async function accountSourceOutcome(ctx, src, outcome, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { stores, settings, clock } = ctx.deps
    const p = { ...settings.sourcePolicy, ...(opt.sourcePolicy || {}) }
    const rec = await recordSourceOutcome(stores.sources, src, outcome, {
        nowIso: clock.iso8(),
        maxConsecFails: p.maxConsecFails,
        maxConsecEmpty: p.maxConsecEmpty,
        isAutoSource: p.isAutoSource,
        extraPatch: p.extraPatchOf?.(src, { ok: outcome.ok, items: src._items || [] }) || {},
    })
    if (rec.disabled) ctx.log.warn(`來源[${src.name}] ${rec.reason}，停用`)
    return rec
}

/**
 * mw 錨點 fetch.listFetch.accountSource:來源計帳:成敗/連敗停用/空回計數/逐來源 extraPatch(grid cursor 前進走這裡)
 *
 * 讀 msg.data._outcome(缺席視為 { ok:false, error:'未執行抓取' }),寫回 ctx.deps.stores.sources。不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwAccountSource = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'accountSource',
        handle: async (msg, ctx, next) => {
            const src = msg.data
            const outcome = src._outcome || { ok: false, error: '未執行抓取' }
            await accountSourceOutcome(ctx, src, outcome, opt)
            return next(msg)
        },
    })
}

/**
 * @param {Object} [opt={}] 輸入子階段設定,非物件則回退為 {};可含 chain, tap, filter, toRecord, sourcePolicy,
 *   sourcesPerRun, minSourceIntervalMs, itemsPerSource
 * @returns {Object} 回傳階段物件 { name:'listFetch', run(ctx) }
 */
export function stageListFetch(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps(
        [mwFetchList(opt), mwNormalizeItems(opt), mwFilterItems(opt), mwAdmitPersist(opt), mwAccountSource(opt)],
        opt.tap, { chainName: 'fetch.listFetch' },
    )
    return {
        name: 'listFetch',
        run: async (ctx) => {
            const { stores, registry, settings } = ctx.deps
            if (!registry) throw new ContractError('listFetch 需要抓取器登錄（cfg.fetchers 或內建預設）')
            const sp = { ...settings.sourcePolicy, ...(opt.sourcePolicy || {}) }
            const due = await pickDueSources(stores.sources, {
                limit: opt.sourcesPerRun ?? settings.fetch.sourcesPerRun,
                minIntervalMs: opt.minSourceIntervalMs ?? settings.fetch.minSourceIntervalMs,
                // 產出率回饋(sourcePolicy):樣本足量且產出率低者排同層級之末;judged/yielded 由 seedSync 之 cullSources 每輪落帳
                lowYieldRate: sp.lowYieldRate,
                minJudged: sp.cullMinJudged,
            })
            ctx.log.info(`本輪來源 ${due.length} 個：${due.map((s) => s.name).join('、') || '（無到期來源）'}`)

            // 抓取器解析前置:設定錯誤(kind 沒對到/指名不存在)開工前整批 fail loud,
            // 不攤平成單來源失敗——理由同 runListFetch(靜默會顯示成「這輪沒新資料」)
            const resolved = due.map((src) => ({ src, fetcher: registry.resolve('list', src, ctx) }))
            const unhandled = resolved.filter((x) => !x.fetcher)
            if (unhandled.length) {
                throw new ContractError(`有 ${unhandled.length} 個來源無可用抓取器：${unhandled.map((x) => x.src?.name || x.src?.url).join('、')}（已註冊：${registry.label()}）`)
            }

            const msgs = resolved.map(({ src, fetcher }) => makeMsg('source', { ...src, _fetcher: fetcher }, { stage: 'listFetch' }))
            // 時間預算守門與 detailFetch 對稱(同一執行器 runChainOverMsgs);未取件之來源 lastFetchAt 不動,下輪仍為最舊優先
            // 例外仍落帳:逐來源鏈於計帳環之前拋錯(安裝方 filter 回非陣列、toRecord 拋錯、入庫失敗…)亦記一次失敗——
            // 此前無 onFail,該來源 lastFetchAt 永不更新、永遠排在「最舊優先」隊頭,且不會因連敗停用(2026-09-23 修,與補全文 onFail 對稱)
            const r = await runChainOverMsgs({
                chain,
                ctx,
                msgs,
                chainName: 'fetch.listFetch',
                shouldStop: budgetOf(ctx).shouldStop,
                onFail: async (m, e) => {
                    await accountSourceOutcome(ctx, m.data, { ok: false, error: `逐來源鏈異常：${oneline(e?.message, 180)}` }, opt)
                },
            })
            for (const e of r.errors) ctx.log.warn(`listFetch 逐來源異常：${e}`)
            if (r.left > 0) ctx.log.warn(`輪抓：逾時間預算，${r.left} 個來源未取件留下輪`)
            return stdReport({
                stats: { in: due.length - r.left, out: r.stats.newDocs || 0, fail: (r.stats.srcFail || 0) + r.fails },
                detail: { sourcesTried: due.length - r.left, newDocs: r.stats.newDocs || 0, left: r.left },
            })
        },
    }
}

export default stageListFetch
