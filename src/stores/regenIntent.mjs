// regenIntent.mjs — 打掉重練之意圖(持久檔:dirs.state 下之 REGEN_FILE,形狀 { cores:{ [核心 id]:{ key, scope, concept, stamp, by, at, done, doneAt? } } })
//
// 【為何先記意圖】重練是多步之破壞性操作(封存狀態檔、封存 md、刪記錄、結案待判、清失敗帳與影響留待);中途中斷即半套。意圖先記於持久檔,
//   各步冪等、重跑依意圖續作(沿用其時戳);失敗帳與影響留待屬管線之帳(跨行程之寫者只有管線),故由管線開工消化已完成(done)之意圖時清,
//   消化後刪意圖;未完成者每輪 WARN(須見)。
// 【持久檔語意】讀寫經 stores/extractFiles(缺檔＝無意圖;壞檔或錯形狀即隔離並告警,不當空檔無聲覆蓋)。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import { REGEN_FILE, EXTRACT_LEDGER_SHAPES, readLedgerJson, saveLedgerJson } from './extractFiles.mjs'

export { REGEN_FILE }

/**
 * 讀重練意圖(壞檔隔離並告警;stamp 為隔離檔名之時戳)
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {Object} [o={}] 輸入 { stamp?:String, log?:{ warn }, onCorrupt?:(info)=>void }
 * @returns {Object} 回傳 { cores:{ [核心 id]: 意圖 } }(缺檔或壞檔為空)
 * @example
 * need test in nodejs.
 *
 * const intents = readRegenIntents(dirs, { stamp: '20261102', log })
 */
export function readRegenIntents(dirs, o = {}) {
    const raw = readLedgerJson(path.join(dirs.state, REGEN_FILE), { shape: EXTRACT_LEDGER_SHAPES.regen, stamp: o?.stamp, log: o?.log, onCorrupt: o?.onCorrupt, hint: '以無意圖續行' })
    return { cores: isobj(raw?.cores) ? { ...raw.cores } : {} }
}

/**
 * 寫重練意圖(原子;無意圖即刪檔)
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {Object} data 輸入 { cores:{ [核心 id]: 意圖 } }
 * @returns {void} 無回傳值(原子寫檔;無意圖即刪檔)
 * @example
 * need test in nodejs.
 *
 * writeRegenIntents(dirs, { cores: { [coreId]: intent } })
 */
export function writeRegenIntents(dirs, data) {
    const cores = isobj(data?.cores) ? data.cores : {}
    fs.mkdirSync(dirs.state, { recursive: true })
    saveLedgerJson(path.join(dirs.state, REGEN_FILE), Object.keys(cores).length ? { cores } : null)
}

export default { REGEN_FILE, readRegenIntents, writeRegenIntents }
