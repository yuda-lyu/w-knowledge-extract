// detailFetchStage.mjs — 抓取物件子階段 a3:逐篇補素材(逐 doc 動作鏈)
//
// hook 錨點:fetch.detailFetch.{titleSkip, routeFetcher(first), fetchDetail,
//           transcodeLinks, feedFallback, persistOutcome}
// 逐 doc 一條 msg(topic:'doc')流過六環:標題預篩 → 路由(first:彙整貼文走 links)→
// 抓取 → 轉錄(彙整貼文短路)→ feed 退路(短路)→ 落庫(raw/dead/new)。
// 抓取嘗試/內容契約復用 w-data-pipeline 內件(attemptFetch/normalizeContent)。

import isobj from 'wsemi/src/isobj.mjs'
import { attemptFetch } from 'w-data-pipeline/src/fetch/attemptFetch.mjs'
import { normalizeContent } from 'w-data-pipeline/src/fetch/itemContract.mjs'
import { isTimeoutError } from 'w-data-pipeline/src/core/errors.mjs'
import { defineMw, defineFirstMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { budgetOf } from '../core/budget.mjs'
import { byRetryTierFifo } from '../stores/docPolicy.mjs'
import { defaultToLinkedRecord } from '../util/records.mjs'
import { oneline, queueAge } from '../util/misc.mjs'

/**
 * mw 錨點 fetch.detailFetch.titleSkip:標題預篩:確定不含知識的例行貼文(彙整/公告)標記 _titleSkip,改走連結轉錄
 *
 * 讀 msg.data.title;寫 msg.data._titleSkip(Boolean)。不短路。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Array} [opt.patterns] 輸入標題比對之正則陣列,未給則用 ctx.deps.data.skipTitlePatterns
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwTitleSkip = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'titleSkip',
        handle: async (msg, ctx, next) => {
            const patterns = opt.patterns || ctx.deps.data.skipTitlePatterns || []
            msg.data._titleSkip = patterns.some((re) => re.test(msg.data.title || ''))
            return next(msg)
        },
    })
}

/**
 * mw 錨點 fetch.detailFetch.routeFetcher(first 錨點):第一個回非空 id 者勝出;都不回則交 registry 依 match 自動判定
 *
 * 讀 msg.data._titleSkip／msg.data.fetcher;寫 msg.data._route(經 apply 預設寫法)。不短路。
 * 無 opt 參數。
 *
 * @returns {Object} 回傳 defineFirstMw 產物
 */
export const mwRouteFetcher = () => defineFirstMw({
    name: 'routeFetcher',
    candidates: [
        { name: 'aggregator-links', probe: (m) => (m.data._titleSkip ? 'links' : null) },
    ],
    apply: (msg, result) => {
        msg.data._route = result || msg.data.fetcher || ''
    },
})

/**
 * mw 錨點 fetch.detailFetch.fetchDetail:內文抓取:依路由解析 detail 抓取器,attemptFetch＋內容契約;失敗記 _fetched.ok=false
 *
 * 讀 msg.data._route／msg.data.fetcher／msg.data.kind／msg.data.title／msg.data.url／msg.data.fetchTries;
 * 寫 msg.data._tries、msg.data._fetched。不短路。無 opt 參數。
 *
 * @returns {Object} 回傳 defineMw 產物
 * @throws {Error} 無可用內文抓取器(kind 未指定或未註冊)時拋出
 */
export const mwFetchDetail = () => defineMw({
    name: 'fetchDetail',
    handle: async (msg, ctx, next) => {
        const doc = msg.data
        const { registry, settings } = ctx.deps
        const fetcher = registry.resolve('detail', { ...doc, fetcher: doc._route || undefined }, ctx)
        if (!fetcher) throw new Error(`無可用內文抓取器（kind=${doc.kind || '未指定'}）`)
        doc._tries = (doc.fetchTries || 0) + 1
        const label = oneline(doc.title || doc.url, 40)
        try {
            const raw = await attemptFetch(fetcher, doc, ctx, fetcher.timeoutMs || settings.fetch.articleTimeoutMs || 0)
            doc._fetched = normalizeContent(raw, { fetcherId: fetcher.id, minTextChars: fetcher.contract?.minTextChars })
            if (doc._fetched.ok && doc._fetched.links?.length) ctx.log.info(`內文[${label}] 成功（連結 ${doc._fetched.links.length} 條，${fetcher.id}）`)
            else if (doc._fetched.ok) ctx.log.info(`內文[${label}] 成功（${doc._fetched.contentLength} 字，${fetcher.id}${doc._fetched.extra?.adapterId ? `／adapter:${doc._fetched.extra.adapterId}` : ''}）`)
            else ctx.log.warn(`內文[${label}] 失敗（${doc._fetched.reason}：${oneline(doc._fetched.message, 120)}）`)
        }
        catch (e) {
            doc._fetched = { ok: false, reason: isTimeoutError(e) ? 'timeout' : 'fetch-error', message: oneline(e?.message, 300), text: '', title: '', links: [] }
            ctx.log.warn(`內文[${label}] 失敗（${doc._fetched.reason}）：${oneline(e?.message, 200)}`)
        }
        return next(msg)
    },
})

/**
 * mw 錨點 fetch.detailFetch.transcodeLinks:彙整貼文轉錄:連結是這篇的全部價值;無連結可轉錄則直接略過(送 AI 只會白燒額度)。
 *
 * 僅 msg.data._titleSkip 為真且 msg.data._fetched.ok 為真時執行(when)。
 * 讀 msg.data._fetched.links／msg.data.title;有連結:轉錄入庫(ctx.deps.stores.docs.patch status:'aggregated')並
 * count(msg,'aggregated');無連結:標記 status:'skip'。**短路**(恆不呼叫 next,為此篇之終點)。
 *
 * @param {Object} [opt={}] 輸入子階段 opts,非物件則回退為 {}
 * @param {Function} [opt.toLinkedRecord] 輸入連結→doc 記錄轉換函數,未給用預設 toLinkedRecord
 * @param {Integer} [opt.linksPerDoc] 輸入單篇最多轉錄幾條連結,未給則用 settings.fetch.aggregatorLinksPerDoc
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwTranscodeLinks = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'transcodeLinks',
        when: (m) => m.data._titleSkip && m.data._fetched?.ok,
        handle: async (msg, ctx) => {
            const doc = msg.data
            const { stores, seen, clock, settings } = ctx.deps
            const links = doc._fetched.links || []
            if (links.length > 0) {
                const toLinked = opt.toLinkedRecord || defaultToLinkedRecord(ctx.deps)
                const linked = links.slice(0, opt.linksPerDoc ?? settings.fetch.aggregatorLinksPerDoc).map((l) => toLinked(l, doc, { nowIso: clock.iso8() }))
                const ins = await seen.admit(linked)
                await stores.docs.patch(doc.id, { status: 'aggregated', fetchTries: doc._tries, linkCount: links.length })
                count(msg, 'aggregated', ins.fresh.length)
                ctx.log.info(`彙整[${oneline(doc.title, 40)}] 轉錄 ${links.length} 條，新增 ${ins.fresh.length} 篇`)
            }
            else {
                await stores.docs.patch(doc.id, { status: 'skip', fetchTries: doc._tries, skipReason: '標題樣式判定為例行公告／彙整貼文（未進 AI）' })
            }
            return msg // 短路:轉錄/略過即此篇終點
        },
    })
}

/**
 * mw 錨點 fetch.detailFetch.feedFallback:feed 退路:全文抓不到但來源自帶素材夠長(feed 內嵌內文/論文摘要)。
 *
 * 僅 msg.data._fetched 存在且 !ok 時執行(when)。讀 msg.data.feedText／msg.data._fetched;
 * feedText 未達 settings.fetch.minFallbackChars 時呼叫 next 放行(不短路);
 * 達門檻則寫回 ctx.deps.stores.docs(status:'raw', textFrom:'feed')、count(msg,'filled')並**短路**(不呼叫 next)。
 * 無 opt 參數。
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwFeedFallback = () => defineMw({
    name: 'feedFallback',
    when: (m) => m.data._fetched && !m.data._fetched.ok,
    handle: async (msg, ctx, next) => {
        const doc = msg.data
        const { stores, settings } = ctx.deps
        if (String(doc.feedText || '').length < settings.fetch.minFallbackChars) return next(msg)
        await stores.docs.patch(doc.id, {
            text: doc.feedText,
            textLength: doc.feedText.length,
            status: 'raw',
            fetchTries: doc._tries,
            textFrom: 'feed',
            rawAt: ctx.deps.clock.iso8(),
        })
        count(msg, 'filled')
        ctx.log.info(`全文[${oneline(doc.title, 40)}] 抓取失敗（${doc._fetched.reason}），改用 feed 內文`)
        return msg // 短路:已入彙整佇列
    },
})

/**
 * mw 錨點 fetch.detailFetch.persistOutcome:落庫:成功→raw(素材就緒);失敗→重試計數並退回 new(排隊末,見 stageDetailFetch 之選取),
 * 達 maxFetchTries 標 dead——「確定抓不到」之判定,移出待抓清單但記錄永不刪除(去重憑證)。
 *
 * 讀 msg.data._fetched／msg.data._tries;寫回 ctx.deps.stores.docs(status/text/fetchTries/…)並
 * count(msg,'filled'或'dead')。不短路。無 opt 參數。
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwPersistOutcome = () => defineMw({
    name: 'persistOutcome',
    handle: async (msg, ctx, next) => {
        const doc = msg.data
        const { stores, settings } = ctx.deps
        if (doc._fetched?.ok) {
            await stores.docs.patch(doc.id, {
                text: doc._fetched.text.slice(0, settings.fetch.maxTextChars),
                textLength: Math.min(doc._fetched.text.length, settings.fetch.maxTextChars),
                title: doc.title || doc._fetched.title,
                status: 'raw',
                fetchTries: doc._tries,
                // 內容來源:經站台 adapter 取得者記 adapter:<id>(如 msn 走站方 content API),否則為網頁正文
                textFrom: doc._fetched.extra?.adapterId ? `adapter:${doc._fetched.extra.adapterId}` : 'article',
                // 進入 raw 之時刻:raw 池等待時間據此量。collectedAt 是收錄時刻——舊件補抓後 collectedAt 已數十天,
                // 用它量會把「當輪就萃取」誤判為久候(巡檢⑨與萃取段日誌皆讀 rawAt)
                rawAt: ctx.deps.clock.iso8(),
            })
            count(msg, 'filled')
        }
        else {
            const dead = doc._tries >= settings.fetch.maxFetchTries
            if (dead) count(msg, 'dead')
            await stores.docs.patch(doc.id, {
                fetchTries: doc._tries,
                status: dead ? 'dead' : 'new',
                lastError: String(doc._fetched?.message || '').slice(0, 200),
                ...(dead ? { deadAt: ctx.deps.clock.iso8() } : {}), // 判定「確定抓不到」之時刻(可稽核何時放棄)
            })
        }
        return next(msg)
    },
})

/**
 * @param {Object} [opt={}] 輸入子階段設定,非物件則回退為 {};可含 chain, tap, patterns, toLinkedRecord, linksPerDoc, articlesPerRun
 * @returns {Object} 回傳階段物件 { name:'detailFetch', run(ctx) }
 */
export function stageDetailFetch(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps(
        [mwTitleSkip(opt), mwRouteFetcher(opt), mwFetchDetail(opt), mwTranscodeLinks(opt), mwFeedFallback(opt), mwPersistOutcome(opt)],
        opt.tap, { chainName: 'fetch.detailFetch' },
    )
    return {
        name: 'detailFetch',
        run: async (ctx) => {
            const { stores, settings } = ctx.deps
            const queue = await stores.docs.select({ status: 'new' })
            const quota = opt.articlesPerRun ?? settings.fetch.articlesPerRun
            // 選取順序(stores/docPolicy byRetryTierFifo,與萃取段同一份):tries 升冪(失敗件排隊末)→ tier → collectedAt(FIFO)。
            // 記錄一律保留,試滿 maxFetchTries 才標 dead(終態,移出待抓清單)
            const pending = queue.sort(byRetryTierFifo('fetchTries')).slice(0, quota)
            // 積壓可見性:佇列長度、未試/重試組成與最舊者天數每輪進日誌
            // (巡檢據此告警排隊過長;沒有時間型丟棄,只告警不丟)
            const age = queueAge(queue)
            const untried = queue.reduce((n, d) => n + ((d.fetchTries || 0) === 0 ? 1 : 0), 0)
            ctx.log.info(`待抓內文 ${age.count} 篇（未試 ${untried}、重試 ${age.count - untried}、最舊 ${age.oldestDays} 天），本輪取 ${pending.length}`)
            for (const w of settings.warnings || []) ctx.log.warn(w) // 容量自洽(resolveSettings):名額 > 萃取容量
            const msgs = pending.map((d) => makeMsg('doc', { ...d }, { stage: 'detailFetch' }))
            // 時間預算守門:逾整輪軟性截止即不再取件(未抓者仍為 new,下輪 FIFO 接手)
            // 例外仍落帳:逐篇鏈拋錯(無可用抓取器、落庫失敗)亦記 fetchTries,否則該篇永遠停在原排序位置每輪佔一個名額
            //(與萃取段 bumpTries 對稱;2026-09-12 複審 A4)。達 maxFetchTries 同樣標 dead(與 persistOutcome 同一判準)——
            // 此前只增 tries 不標終態,永遠拋錯者恆為 new,佇列短時每輪仍被取件、積壓統計永遠含它(2026-09-23 修)
            const maxFetchTries = settings.fetch?.maxFetchTries
            const r = await runChainOverMsgs({
                chain,
                ctx,
                msgs,
                chainName: 'fetch.detailFetch',
                shouldStop: budgetOf(ctx).shouldStop,
                onFail: async (m, e) => {
                    const tries = (m.data.fetchTries || 0) + 1
                    const dead = Number.isFinite(maxFetchTries) && tries >= maxFetchTries
                    await stores.docs.patch(m.data.id, {
                        fetchTries: tries,
                        lastError: `逐篇鏈異常：${oneline(e?.message, 180)}`,
                        ...(dead ? { status: 'dead', deadAt: ctx.deps.clock?.iso8?.() || new Date().toISOString() } : {}),
                    })
                    if (dead) ctx.log.warn(`內文[${oneline(m.data.title || m.data.url, 40)}] 逐篇鏈異常達 ${tries} 次，標為 dead`)
                },
            })
            for (const e of r.errors) ctx.log.warn(`detailFetch 逐篇異常：${e}`)
            if (r.left > 0) ctx.log.warn(`補全文：逾時間預算，${r.left} 篇未取件留下輪`)
            return stdReport({
                stats: { in: pending.length - r.left, out: r.stats.filled || 0, fail: r.fails + (r.stats.dead || 0) },
                detail: { filled: r.stats.filled || 0, aggregated: r.stats.aggregated || 0, dead: r.stats.dead || 0, left: r.left, queued: age.count, queuedOldestDays: age.oldestDays },
            })
        },
    }
}

export default stageDetailFetch
