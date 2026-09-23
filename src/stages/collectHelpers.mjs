// collectHelpers.mjs — 抓取回合共用小件(自 collectStage 抽出供各子階段使用)

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'

/**
 * 由文件集統計各來源的「已判定/有產出」數(供零產出淘汰)。
 * 統計直接從文件算、不設計數器:並行批次下計數器有 read-modify-write 競態;
 * 文件的終態是唯一事實來源,每輪重算即可(瘦身只清素材不刪記錄,歷史完整)。
 *
 * @param {Array} docs 輸入文件陣列(已由呼叫端 select 取出)，非陣列則回傳空物件
 * @param {Object} [cfg={}] 輸入設定物件，非物件則回退為 {}
 * @param {String} [cfg.yieldStatus='noted'] 輸入視為「有產出」之狀態字串
 * @param {String} [cfg.skipStatus='skip'] 輸入視為「已判定但無產出」之狀態字串
 * @returns {Object} 回傳 { [sourceId]: { judged:Integer, yielded:Integer } }
 * @example
 * let docs = [{ sourceId: 's1', status: 'noted' }, { sourceId: 's1', status: 'skip' }, { sourceId: 's2', status: 'new' }]
 * console.log(judgeFromDocs(docs))
 * // => { s1: { judged: 2, yielded: 1 } }
 */
export function judgeFromDocs(docs, cfg = {}) {

    //check
    if (!isarr(docs)) {
        return {}
    }
    if (!isobj(cfg)) {
        cfg = {}
    }

    const yieldStatus = cfg.yieldStatus || 'noted'
    const skipStatus = cfg.skipStatus || 'skip'
    const judged = {}
    for (const d of docs) {
        if (d.status !== yieldStatus && d.status !== skipStatus) continue
        const sid = String(d.sourceId || '').replace(/:linked$/, '')
        if (!sid) continue
        if (!judged[sid]) judged[sid] = { judged: 0, yielded: 0 }
        judged[sid].judged++
        if (d.status === yieldStatus) judged[sid].yielded++
    }
    return judged
}

export default { judgeFromDocs }
