// seedSyncStage.mjs — 抓取物件子階段 a1:種子同步＋品質淘汰
//
// hook 錨點:fetch.seedSync.syncSeeds / fetch.seedSync.cullSources
// 單一 maintenance 訊息流過兩環;各環可 before/after/replace 掛載。

import isobj from 'wsemi/src/isobj.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { ensureSeedSources, cullZeroYieldSources } from '../stores/sourcePolicy.mjs'
import { judgeFromDocs } from './collectHelpers.mjs'
import { expandSeeds } from '../fetchers/endpoints.mjs'

/**
 * mw 錨點 fetch.seedSync.syncSeeds:種子同步:cfg.data 之靜態種子＋主題網格展開 → 補入/宣告欄位同步
 *
 * 讀 opt.seeds(未給則以 ctx.deps.data 展開);寫入 ctx.deps.stores.sources、msg.stats.seedAdd。不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Array} [opt.seeds] 輸入覆寫用種子陣列,未給則由 ctx.deps.data 展開(expandSeeds)
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwSyncSeeds = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'syncSeeds',
        handle: async (msg, ctx, next) => {
            const { stores, data, clock } = ctx.deps
            const seeds = opt.seeds || expandSeeds(data, { nowIso: clock.iso8() })
            const r = await ensureSeedSources(stores.sources, seeds)
            if (r.addCount > 0) ctx.log.info(`種子來源補入 ${r.addCount} 筆（既有 ${r.dupCount} 筆）`)
            count(msg, 'seedAdd', r.addCount)
            return next(msg)
        },
    })
}

/**
 * mw 錨點 fetch.seedSync.cullSources:零產出淘汰:統計直接從文件算(計數器有競態),樣本足量且產出掛零者停用
 *
 * 讀 ctx.deps.stores.docs 全表統計;寫入 ctx.deps.stores.sources(停用)。不讀寫 msg.data;不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Integer} [opt.cullMinJudged] 輸入樣本足量之最少已判定篇數,未給則用 settings.sourcePolicy.cullMinJudged
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwCullSources = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'cullSources',
        handle: async (msg, ctx, next) => {
            const { stores, settings } = ctx.deps
            const judged = judgeFromDocs(await stores.docs.select())
            await cullZeroYieldSources(stores.sources, (s) => judged[s.id], {
                minJudged: opt.cullMinJudged ?? settings.sourcePolicy.cullMinJudged,
                log: ctx.log,
            })
            return next(msg)
        },
    })
}

/**
 * @param {Object} [opt={}] 輸入子階段設定,非物件則回退為 {};可含 chain(整鏈重排), tap(認名掛載), seeds, cullMinJudged
 * @returns {Object} 回傳階段物件 { name:'seedSync', run(ctx) }
 */
export function stageSeedSync(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps([mwSyncSeeds(opt), mwCullSources(opt)], opt.tap, { chainName: 'fetch.seedSync' })
    return {
        name: 'seedSync',
        run: async (ctx) => {
            const r = await runChainOverMsgs({ chain, ctx, msgs: [makeMsg('maintenance', {})], chainName: 'fetch.seedSync' })
            return stdReport({ ok: r.fails === 0, stats: { in: 1, out: 1, fail: r.fails, ...r.stats }, detail: r.stats })
        },
    }
}

export default stageSeedSync
