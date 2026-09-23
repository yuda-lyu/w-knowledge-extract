// docMaintainStage.mjs — 抓取物件子階段 a4:終態瘦身
//
// hook 錨點:fetch.docMaintain.slim
//
// 【沒有佇列老化】曾有 mwExpire(逾 staleDocDays 未取得素材者標 expired),2026-09-07 移除:
//   知識庫沒有「逾期」——文章價值與新舊無關,丟棄只能發生在「AI 判定非知識」(skip)或
//   「確定抓不到」(detailFetch 試滿 maxFetchTries 標 dead)之後。時間到就丟是新聞爬蟲假設;
//   FIFO 下抓過而失敗者下輪必再輪到,時間型過期已無任何正當觸發情境(2026-09-07 移除)。

import isobj from 'wsemi/src/isobj.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { slimTerminalDocs } from '../stores/docPolicy.mjs'

/**
 * mw 錨點 fetch.docMaintain.slim:終態瘦身:清掉不再會被讀到的原文素材(select 成本隨位元組線性成長)
 *
 * 讀 ctx.deps.stores.docs(依 opt.terminalStatuses 選出終態文件);清空其素材欄位並寫回、count(msg,'slimmed')。
 * 不讀寫 msg.data 本身欄位;不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Array} [opt.terminalStatuses] 輸入終態狀態字串陣列,未給則用 settings.fetch.terminalStatuses
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwSlim = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'slim',
        handle: async (msg, ctx, next) => {
            const { stores, settings } = ctx.deps
            const r = await slimTerminalDocs(stores.docs, { terminalStatuses: opt.terminalStatuses || settings.fetch.terminalStatuses })
            if (r.slimmed > 0) ctx.log.info(`終態文件瘦身：${r.slimmed} 篇，釋出 ${(r.freedBytes / 1024 / 1024).toFixed(2)} MB`)
            count(msg, 'slimmed', r.slimmed)
            return next(msg)
        },
    })
}

/**
 * @param {Object} [opt={}] 輸入子階段設定,非物件則回退為 {};可含 chain, tap, terminalStatuses
 * @returns {Object} 回傳階段物件 { name:'docMaintain', run(ctx) }
 */
export function stageDocMaintain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps([mwSlim(opt)], opt.tap, { chainName: 'fetch.docMaintain' })
    return {
        name: 'docMaintain',
        run: async (ctx) => {
            const r = await runChainOverMsgs({ chain, ctx, msgs: [makeMsg('maintenance', {})], chainName: 'fetch.docMaintain' })
            return stdReport({ ok: r.fails === 0, stats: { in: 1, out: 1, fail: r.fails }, detail: r.stats })
        },
    }
}

export default stageDocMaintain
