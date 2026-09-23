// docPolicy.mjs — 文件生命週期的泛用機制：終態瘦身
//
// 【狀態機約定（可由 config 覆寫狀態名，機制不變）】
//   new → raw（有素材，待 AI 處理）→ noted／skip（已處理）
//   new → dead（全文試滿 maxFetchTries，確定抓不到）；raw → extract-failed（AI 連續失敗出隊）
//   aggregated（彙整貼文，已轉錄連結）
//
// 【沒有時間型過期】知識庫的文章價值與新舊無關；丟棄只能發生在「AI 判定非知識（skip）」或
//   「確定抓不到（dead）」之後，不存在「逾期」。2026-09-07 前曾有 expireStaleDocs（逾 staleDocDays
//   未取得素材者標 expired），是新聞爬蟲假設：FIFO 下抓過失敗者下輪必再輪到，時間型過期唯一會
//   觸發的情境是高層級洪水餓死低層級——而那是容量告警不是丟棄理由。已移除，既有 expired 回填為
//   new（2026-09-07）。
//
// 【記錄永不刪除】終態文件只清素材欄位不刪記錄——記錄本身就是去重憑證
//   （w-data-pipeline seen store 的設計前提），刪了同一 url 會被重新收錄。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'

/**
 * 終態文件瘦身：清掉不再會被讀到的原文素材。
 * 素材只有 AI 處理階段會讀（僅限待處理狀態）；進入終態後全文再無讀取路徑，
 * 而全表 select 的成本隨總位元組線性成長——現在清成本近零，事後補救要停機整理。
 *
 * @param {Object} docs 輸入文件集合，需具 select／patch 方法
 * @param {Object} [cfg={}] 輸入設定物件，非物件則回退為 {}
 * @param {Array} cfg.terminalStatuses 輸入終態狀態字串陣列（必填；非陣列即拋錯）
 * @param {Array} [cfg.textFields=['text','feedText']] 輸入要清空的素材欄位字串陣列，非陣列則用預設
 * @returns {Promise} 回傳 Promise，resolve 回傳 { slimmed:Integer, freedBytes:Integer }
 * @throws {Error} docs 缺 select／patch 方法，或 cfg.terminalStatuses 非陣列時拋出
 */
export async function slimTerminalDocs(docs, cfg = {}) {

    //check
    if (!isfun(docs?.select) || !isfun(docs?.patch)) {
        throw new Error('slimTerminalDocs 需要 docs 集合（具 select/patch 方法）')
    }
    if (!isobj(cfg)) {
        cfg = {}
    }
    if (!isarr(cfg.terminalStatuses)) {
        throw new Error('slimTerminalDocs 需要 cfg.terminalStatuses（狀態陣列）')
    }
    let textFields = cfg.textFields
    if (!isarr(textFields)) {
        textFields = ['text', 'feedText']
    }

    const terminal = cfg.terminalStatuses
    const fields = textFields
    let slimmed = 0
    let freed = 0
    for (const st of terminal) {
        for (const d of await docs.select({ status: st })) {
            const n = fields.reduce((a, f) => a + String(d[f] || '').length, 0)
            if (n === 0) continue
            const patch = { textLength: d.textLength || n }
            for (const f of fields) patch[f] = ''
            await docs.patch(d.id, patch)
            slimmed++
            freed += n
        }
    }
    return { slimmed, freedBytes: freed }
}

/**
 * 待處理佇列的選取順序(補全文與萃取共用):tries 升冪 → tier 升冪 → collectedAt 升冪。
 *
 * 【tries 擺第一:失敗件排隊末(隊頭防阻塞)】失敗者退回佇列時保留原 collectedAt,若只按 collectedAt 排
 *   就永遠黏在隊頭、每輪重耗名額直到試滿——2026-09-08 實測補全文隊頭 30 篇有 14 篇為 tries=2 之
 *   MSN wrapper/401/403,每輪 27 個名額僅 5~15 篇成功;萃取側同一批壞批永遠排隊頭則整條線被擋死。
 * 【tier 次之】來源品質優先;層內 FIFO(先收先處理)。曾為 collectedAt 降冪(最新優先):同層級沒搶到名額者
 *   每輪被更新者擠掉直到過期——對新聞合理,對知識庫是丟棄機制(2026-09-07 盤查)。
 * 【一份比較器】此前補全文與萃取各手寫一份三段比較(複審 P8):規則改一處另一處必漂移。
 *
 * @param {String} [triesField='fetchTries'] 輸入排序依據欄位名字串，'fetchTries'(補全文)或 'extractTries'(萃取)，非有效字串則用預設
 * @returns {Function} 回傳比較器函數 (a:Object, b:Object)=>Number，供 Array.prototype.sort 使用
 * @example
 * let rows = [{ fetchTries: 1, sourceTier: 1, collectedAt: '2026-09-01' }, { fetchTries: 0, sourceTier: 2, collectedAt: '2026-09-02' }]
 * console.log(rows.sort(byRetryTierFifo('fetchTries')).map((r) => r.fetchTries))
 * // => [ 0, 1 ]
 */
export function byRetryTierFifo(triesField = 'fetchTries') {

    //check
    if (!isestr(triesField)) {
        triesField = 'fetchTries'
    }

    return (a, b) => (a[triesField] || 0) - (b[triesField] || 0) ||
    (a.sourceTier || 2) - (b.sourceTier || 2) ||
    String(a.collectedAt || '').localeCompare(String(b.collectedAt || ''))
}

export default { slimTerminalDocs, byRetryTierFifo }
