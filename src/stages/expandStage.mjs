// expandStage.mjs — 抓取物件子階段 a5:線索探測(自我擴充:待探索線索 → 新來源/新文件)
//
// hook 錨點:fetch.expand.probe(first)/fetch.expand.settleClue
// probe 是 first 錨點:內建 site-feed 與 search-endpoints 兩顆候選,安裝方要加
// 新探測端點(如 Google Scholar)= tap add 一顆候選,不動套件。
//
// 【內建探測政策(實測定案)】site 走 feed 探測;keyword/topic 打 Bing News＋arXiv、
//   CJK 線索跳過 arXiv(全站英文,中文查詢必逾時白耗);探測 ≥3 筆才登錄常設來源
//   (線索產生速度遠高於輪抓量,無條件登錄會讓來源表被空查詢塞滿)。

import isobj from 'wsemi/src/isobj.mjs'
import fetchRSS from 'w-dwdata-hub/src/fetchRSS.mjs'
import { defineMw, defineFirstMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { budgetOf } from '../core/budget.mjs'
import { pickClues, settleClue, enforceFrontierCap } from '../stores/frontierPolicy.mjs'
import { ingestFeedItems } from '../stores/ingestGate.mjs'
import { discoverFeed } from '../fetchers/articleParse.mjs'
import { bingNewsSearchUrl, arxivSearchUrl } from '../fetchers/endpoints.mjs'
import { sourceId } from '../util/records.mjs'
import { normalizeUrl } from '../util/web.mjs'
import { oneline } from '../util/misc.mjs'

/**
 * 探測衍生來源的記錄組裝(tier 3:優先權低於人工驗證過的種子)
 *
 * @param {Object} p 輸入候選來源欄位，含 name、url，可含 lang
 * @param {Object} clue 輸入待探索線索，含 type、value，可含 why
 * @param {String} nowIso 輸入現在時刻 ISO 字串
 * @returns {Object} 回傳來源記錄物件(未落地)
 */
function newSource(p, clue, nowIso) {
    return {
        id: sourceId('rss', normalizeUrl(p.url)),
        kind: 'rss',
        tier: 3,
        name: p.name,
        url: normalizeUrl(p.url),
        lang: p.lang || '',
        origin: `frontier:${clue.type}:${clue.value}`,
        note: oneline(clue.why, 120),
        enabled: true,
        addedAt: nowIso,
        lastFetchAt: '',
        okCount: 0,
        failCount: 0,
    }
}

/**
 * 內建候選①:site 線索 → 實際探測 RSS/Atom feed,抓得到才登錄
 *
 * first 錨點候選(probe):非 site 線索或 clue 非物件回 null(語意:不處理,交下一候選)
 *
 * @param {Object} clue 輸入線索記錄，需含 type、value；非物件回 null
 * @param {Object} ctx 輸入鏈上下文，取 ctx.deps.{stores,clock}
 * @returns {Promise} 回傳 Promise，resolve 回傳 null(非 site 線索)，或 { ok, resolved, newSources } ／ { ok:false, error }
 */
export async function probeSiteFeed(clue, ctx) {

    //check
    if (!isobj(clue)) {
        return null
    }
    if (clue.type !== 'site') return null

    const { stores, clock } = ctx.deps
    const d = await discoverFeed(clue.value)
    if (!d.ok) return { ok: false, error: d.message }
    const r = await stores.sources.insertNew([{
        ...newSource({ name: oneline(d.siteTitle || clue.value, 60), url: d.feedUrl }, clue, clock.iso8()),
        origin: `frontier:site:${clue.value}`,
    }])
    return { ok: true, resolved: d.feedUrl, newSources: r.addCount }
}

/**
 * 內建候選②:keyword/topic → Bing News＋arXiv 一次性探測(文件入庫;≥3 筆才登錄來源)。
 *
 * 入庫走與輪抓同一閘門(stores/ingestGate:契約檢查→業務過濾→去重占位),此前直接 insertNew 一份自組記錄,
 * 安裝方之 filter/toRecord 對探測文件無效、契約層與去重層的 invalid 也無留痕(2026-09-12 複審 P5/S5)。
 * first 錨點候選(probe):非 keyword/topic 線索或 clue 非物件回 null(語意:不處理,交下一候選)。
 *
 * @param {Object} clue 輸入線索記錄，需含 type、value；非物件回 null
 * @param {Object} ctx 輸入鏈上下文，取 ctx.deps.{stores,clock,settings}
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.arxivCategories] 輸入 arXiv 類別過濾字串陣列，優先於 settings.fetch.arxivCategories，皆無即不限
 * @param {Object} [opt.ingest] 輸入探測入庫閘門之覆寫(預設由 createFetchObject 自 listFetch 之 opts 帶入)，含 filter、toRecord、itemsPerSource
 * @returns {Promise} 回傳 Promise，resolve 回傳 null(非 keyword/topic 線索)，或 { ok, resolved, yieldDocs, newSources, partialErrors? } ／ { ok:false, error }
 */
export async function probeSearchEndpoints(clue, ctx, opt = {}) {

    //check
    if (!isobj(clue)) {
        return null
    }
    if (!isobj(opt)) {
        opt = {}
    }
    if (clue.type !== 'keyword' && clue.type !== 'topic') return null

    const { stores, clock, settings } = ctx.deps
    const kw = clue.value
    const isCJK = /[一-鿿぀-ヿ가-힯]/.test(kw)
    // arXiv 類別過濾:opt.arxivCategories 優先,其次 settings.fetch.arxivCategories;皆無即不限(通用套件預設)
    const arxivCategories = Array.isArray(opt.arxivCategories) ? opt.arxivCategories : (settings?.fetch?.arxivCategories || [])
    const probes = [
        { name: `Bing News：${kw}`, url: bingNewsSearchUrl(kw), lang: '' },
        ...(isCJK ? [] : [{ name: `arXiv 查詢：${kw}`, url: arxivSearchUrl(kw, { categories: arxivCategories }), lang: 'en' }]),
    ]
    let docsAdded = 0
    let registered = 0
    const errors = []
    for (const p of probes) {
        const src = newSource(p, clue, clock.iso8())
        let items = []
        try {
            // 探測用快速失敗設定:一次性試抓,用預設重試預算會讓一輪探測吃掉近兩小時
            items = await fetchRSS(src.url, { method: 'curl', withContent: true, maxRetries: 1, timeout: 12_000, showLog: false })
        }
        catch (e) {
            // 端點失敗須留痕:此前 catch 即 continue 而仍回 ok:true,線索被標 done——網路失敗與「查無內容」
            // 混為一談,done 中 56% 零產出有一部分正是這樣來的(2026-09-12 複審 A13);全數端點失敗即回 ok:false 留 pending 重試
            errors.push(`${p.name}：${oneline(e?.message, 80)}`)
            continue
        }
        const ins = await ingestFeedItems(items, { source: src, fetcherId: 'probe:rss', ctx, ...(opt.ingest || {}) })
        docsAdded += ins.fresh.length
        if (ins.invalid.length) ctx.log.info(`探測[${p.name}] 有 ${ins.invalid.length} 項不符格式而略過：${oneline(ins.invalid.map((x) => x.reason).join('；'), 160)}`)
        if (ins.dropped > 0) ctx.log.info(`探測[${p.name}] 業務過濾剔除 ${ins.dropped} 項`)
        if (items.length >= 3) {
            const r = await stores.sources.insertNew([{ ...src, lastFetchAt: clock.iso8(), okCount: 1 }])
            registered += r.addCount
        }
    }
    if (errors.length === probes.length) return { ok: false, error: `探測端點皆失敗：${errors.join('；')}` }
    return { ok: true, resolved: `search:${kw}`, yieldDocs: docsAdded, newSources: registered, ...(errors.length ? { partialErrors: errors } : {}) }
}

/**
 * 錨點:probe(first 錨點:第一個能處理該線索型別的探測器勝出;安裝方 tap add 追加探測器)
 *
 * 讀 msg.data(線索:type、value);寫 msg.data._outcome(探測結果)與 msg.data._probeBy(勝出候選名);不短路(恆呼叫 next)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}，原樣傳入 probeSearchEndpoints
 * @returns {Object} 回傳 defineFirstMw 產物
 */
export const mwProbe = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineFirstMw({
        name: 'probe',
        candidates: [
            { name: 'site-feed', probe: (m, ctx) => probeSiteFeed(m.data, ctx) },
            { name: 'search-endpoints', probe: (m, ctx) => probeSearchEndpoints(m.data, ctx, opt) },
        ],
        apply: (msg, result, _ctx, winner) => {
            msg.data._outcome = result || { ok: false, error: `無探測器可處理線索型別「${msg.data.type}」` }
            msg.data._probeBy = winner
        },
    })
}

/**
 * 錨點:settleClue(消化結果落帳:tries/failed 狀態機;逐線索統計)
 *
 * 讀 msg.data(線索:type、value、_outcome);不寫 msg.data(落帳寫入 stores.frontier);不短路(恆呼叫 next)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Integer} [opt.maxTries=2] 輸入線索失敗達幾次即轉 failed
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwSettleClue = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'settleClue',
        handle: async (msg, ctx, next) => {
            const { stores, clock } = ctx.deps
            const clue = msg.data
            const outcome = clue._outcome
            const settled = await settleClue(stores.frontier, clue, outcome, { nowIso: clock.iso8(), maxTries: opt.maxTries ?? 2 })
            if (outcome.ok) {
                count(msg, 'newSources', outcome.newSources || 0)
                count(msg, 'docsAdded', outcome.yieldDocs || 0)
                ctx.log.info(`擴充：${clue.type}[${clue.value}] → 來源 ${outcome.newSources || 0} 個、文件 ${outcome.yieldDocs || 0} 篇`)
            }
            else {
                if (settled.status === 'failed') count(msg, 'clueFailed')
                ctx.log.warn(`擴充：${clue.type}[${clue.value}] 失敗（${String(outcome.error || '').slice(0, 100)}）→ ${settled.status}`)
            }
            return next(msg)
        },
    })
}

/**
 * 擴充子階段:自我擴充(待探索線索 → 新來源/新文件)。hook 錨點:fetch.expand.{probe(first), settleClue}
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)，於預設鏈上 before/after/replace/add
 * @param {Integer} [opt.perRun] 輸入本輪取用線索筆數上限，未給則用 settings.knowledge.frontierPerRun
 * @param {Integer} [opt.maxPending] 輸入待探索線索上限，未給則用 settings.knowledge.frontierMaxPending
 * @param {Integer} [opt.maxTries=2] 輸入線索失敗達幾次即轉 failed
 * @param {Object} [opt.ingest] 輸入探測入庫閘門之 opts(filter、toRecord、itemsPerSource)，預設同 listFetch
 * @returns {Object} 回傳 stage 物件 { name, run }
 */
export function stageExpand(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps([mwProbe(opt), mwSettleClue(opt)], opt.tap, { chainName: 'fetch.expand' })
    return {
        name: 'expand',
        run: async (ctx) => {
            const { stores, settings, clock } = ctx.deps
            // 上限淘汰(frontierPolicy):線索產生量≫消化量,無上限即永無止境成長;淘汰者記錄保留、再被提及即復活
            const maxPending = opt.maxPending ?? settings.knowledge.frontierMaxPending
            const cap = await enforceFrontierCap(stores.frontier, { maxPending, nowIso: clock.iso8() })
            if (cap.evicted > 0) ctx.log.warn(`擴充：待探索線索 ${cap.pending + cap.evicted} 筆超過上限 ${maxPending}，淘汰優先序最低之 ${cap.evicted} 筆（記錄保留，再被提及即復活）`)
            const pending = await pickClues(stores.frontier, opt.perRun ?? settings.knowledge.frontierPerRun)
            if (pending.length === 0) {
                ctx.log.info('擴充：待探索清單為空')
                return stdReport({ detail: { picked: 0, newSources: 0, docsAdded: 0, failed: 0, evicted: cap.evicted, pending: cap.pending } })
            }
            const msgs = pending.map((c) => makeMsg('clue', { ...c }, { stage: 'expand' }))
            // 時間預算守門(每筆線索 2 次 HTTP,無守門時消化量一調高就吃掉後段時間);未取件之線索仍為 pending
            // 例外仍落帳:逐線索鏈拋錯(入庫失敗、安裝方 filter 回非陣列…)亦走 settleClue 記 tries、達上限轉 failed——
            // 此前無 onFail,拋錯之線索 tries 不增、狀態不動;線索依 hits 排序而非 tries,高 hits 者每輪都排回隊頭白佔名額
            //(與補全文 onFail、萃取 bumpTries 對稱;2026-09-23 修)
            const maxTries = opt.maxTries ?? 2
            const r = await runChainOverMsgs({
                chain,
                ctx,
                msgs,
                chainName: 'fetch.expand',
                shouldStop: budgetOf(ctx).shouldStop,
                onFail: async (m, e) => {
                    const settled = await settleClue(stores.frontier, m.data, { ok: false, error: `逐線索鏈異常：${oneline(e?.message, 120)}` }, { nowIso: clock.iso8(), maxTries })
                    if (settled.status === 'failed') ctx.log.warn(`擴充：${m.data.type}[${m.data.value}] 逐線索鏈異常達 ${maxTries} 次，轉 failed`)
                },
            })
            for (const e of r.errors) ctx.log.warn(`expand 逐線索異常：${e}`)
            if (r.left > 0) ctx.log.warn(`擴充：逾時間預算，${r.left} 筆線索未取件留下輪`)
            return stdReport({
                stats: { in: pending.length - r.left, out: r.stats.newSources || 0, fail: (r.stats.clueFailed || 0) + r.fails },
                detail: { picked: pending.length - r.left, newSources: r.stats.newSources || 0, docsAdded: r.stats.docsAdded || 0, failed: (r.stats.clueFailed || 0) + r.fails, left: r.left, evicted: cap.evicted, pending: cap.pending },
            })
        },
    }
}

export default stageExpand
