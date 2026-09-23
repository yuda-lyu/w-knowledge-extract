// ingestGate.mjs — 文件入庫的單一閘門:契約檢查 → 業務過濾 → 去重占位入庫
//
// 【為何獨立成模組】入庫此前有兩條路徑:輪抓(listFetch 之 normalizeItems→filterItems→admitPersist 三環)
//   與探測入庫(expand 直接 stores.docs.insertNew 一份自組記錄)。後者繞過契約層(欄位對應、批內去重、
//   每來源上限的同一份實作)、業務過濾(安裝方之 filter 對它無效)與去重層的 invalid 留痕——同一規則
//   手寫兩份且不對稱(2026-09-12 複審 P5/S5)。此後兩條路徑都呼叫本模組:listFetch 的三環 mw 是本模組
//   三步的可掛載投影(hook 錨點與語意不變),expand 以 ingestFeedItems 一次走完三步。
// 【id 由去重層決定】seen.admit 一律以 identity(keyOf:'raw'＝sha1(canonicalUrl))覆寫 id;
//   契約層(normalizeItems)以同一份 identity 算 canonicalUrl 並做批內去重,兩層擋掉的是同一批。

import isobj from 'wsemi/src/isobj.mjs'
import { normalizeItems } from 'w-data-pipeline/src/fetch/itemContract.mjs'
import { defaultToRecord } from '../util/records.mjs'

/**
 * 內部共用檢查:o 須為物件且含 ctx.deps(閘門三步與 ingestFeedItems 皆依賴 ctx.deps 取得 stores/settings/seen,
 * 規則只在此寫一份,不逐函數各自手寫一次)
 *
 * @param {String} fnName 輸入呼叫端函數名稱(組錯誤訊息用)
 * @param {*} o 輸入待檢查之設定物件
 * @throws {Error} o 非物件、o.ctx 非物件或 o.ctx.deps 非物件時拋出
 */
function checkCtxDeps(fnName, o) {
    if (!isobj(o) || !isobj(o.ctx) || !isobj(o.ctx.deps)) {
        throw new Error(`${fnName} 需要 { ctx }`)
    }
}

/**
 * 步驟①契約檢查:原始項目 → 正規化項目(欄位對應、批內去重、每來源上限截斷);非法項目進 invalid 留痕。
 *
 * @param {Array} rawItems 輸入抓取函數回傳值(非陣列即拋——抓取器實作錯誤,不是「這次沒抓到」;
 *   此檢查由 w-data-pipeline normalizeItems 拋出 TypeError,本函數不重複判斷)
 * @param {Object} o 輸入設定物件，需含 ctx(ctx.deps)；可含 source、fetcherId、itemsPerSource
 * @returns {Object} 回傳 {items:Array, invalid:Array, dupInBatch:Integer}
 * @throws {Error} o 非物件或缺 ctx(ctx.deps)時拋出
 * @throws {TypeError} rawItems 非陣列時拋出(來自 w-data-pipeline normalizeItems)
 */
export function normalizeFeedItems(rawItems, o) {

    //check
    checkCtxDeps('normalizeFeedItems', o)
    const { source, fetcherId, ctx, itemsPerSource } = o

    const { settings, seen } = ctx.deps
    return normalizeItems(rawItems, {
        maxItems: itemsPerSource ?? settings.fetch.itemsPerSource,
        maxTextChars: settings.fetch.maxTextChars,
        identity: seen?.identity || null,
        source,
        fetcherId,
    })
}

/**
 * 步驟②業務過濾(預設放行):黑名單/日期窗這類「否決」政策——必須在占位入庫之前。
 *
 * @param {Array} items 輸入正規化項目陣列
 * @param {Object} o 輸入設定物件，需含 ctx(ctx.deps)；可含 source、filter
 * @param {Function} [o.filter] 輸入業務過濾函數 (items, {source, ctx}) => Promise<Array>|Array，未給即放行
 * @returns {Promise} 回傳 Promise，resolve 回傳 {kept:Array, dropped:Integer}
 * @throws {Error} o 非物件或缺 ctx(ctx.deps)時拋出
 * @throws {TypeError} o.filter 回傳非陣列時拋出
 */
export async function filterFeedItems(items, o) {

    //check
    checkCtxDeps('filterFeedItems', o)
    const { source, ctx, filter } = o

    if (typeof filter !== 'function') return { kept: items, dropped: 0 }
    const kept = await filter(items, { source, ctx })
    if (!Array.isArray(kept)) throw new TypeError('filterItems 之 filter 必須回傳陣列（要保留的項目）')
    return { kept, dropped: items.length - kept.length }
}

/**
 * 步驟③去重占位＋入庫(seen.admit＝insertNew):沒抓過才放行,越下游每步越貴。
 *
 * @param {Array} items 輸入正規化項目陣列
 * @param {Object} o 輸入設定物件，需含 ctx(ctx.deps)；可含 source、fetcher、toRecord
 * @returns {Promise} 回傳 Promise，resolve 回傳 seen.admit 之結果(含 fresh/dup/invalid)
 * @throws {Error} o 非物件或缺 ctx(ctx.deps)時拋出
 */
export async function admitFeedItems(items, o) {

    //check
    checkCtxDeps('admitFeedItems', o)
    const { source, fetcher, ctx, toRecord } = o

    return ctx.deps.seen.admit(items, { toRecord: toRecord || defaultToRecord(ctx.deps), meta: { source, fetcher } })
}

/**
 * 三步一次走完(探測入庫用;輪抓走三環 mw 以保留掛載點)。
 *
 * @param {Array} rawItems 輸入抓取函數回傳值
 * @param {Object} o 輸入設定物件，需含 ctx(ctx.deps)；可含 source、fetcherId、fetcher、itemsPerSource、filter、toRecord
 * @returns {Promise} 回傳 Promise，resolve 回傳 {items, invalid, dupInBatch, dropped, fresh, dup, unidentified}
 * @throws {Error} o 非物件或缺 ctx(ctx.deps)時拋出
 */
export async function ingestFeedItems(rawItems, o) {

    //check
    checkCtxDeps('ingestFeedItems', o)

    const n = normalizeFeedItems(rawItems, o)
    const f = await filterFeedItems(n.items, o)
    const a = await admitFeedItems(f.kept, { ...o, fetcher: o.fetcher || { id: o.fetcherId } })
    return { items: f.kept, invalid: n.invalid, dupInBatch: n.dupInBatch, dropped: f.dropped, fresh: a.fresh, dup: a.dup, unidentified: a.invalid }
}

export default { normalizeFeedItems, filterFeedItems, admitFeedItems, ingestFeedItems }
