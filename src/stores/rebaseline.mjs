// rebaseline.mjs — 重設內容基準之名單(持久檔:dirs.state 下之 REBASELINE_FILE,形狀 { ids:{ [筆記 id]:{ at, by } } })
//
// 【為何以名單檔指示而不直接改狀態】核心狀態之寫入一律走管線之落盤序列(CAS、投影、手改偵測;stores/coreProjection 之 persistMechanical)——
//   本檔只寫一個逐 id 名單,下一輪提煉段之維護讀到即對名單內「被引用而內容已變」之筆記以現值重設基準(視為已知之格式變動,不排重審),
//   處置畢刪已處置之 id(所屬核心維護失敗者保留至下輪)。逐 id 而非全域旗標:預覽之後才變更之筆記不被一併吞掉。
//   用途:內容變更守門(extract.recheck.guard)因批次格式改寫而觸發時;存量處置先記超集、套用後對未變者取消(cancelRebaseline);
//   屬真實內容修訂者應調高守門放行,不用本指示。
// 【持久檔語意】讀寫經 stores/extractFiles(缺檔＝空名單;壞檔或錯形狀:維護段給 stamp 即隔離並回報,純讀者只回報、不改檔;寫入前壞檔先隔離,
//   不無聲覆蓋)。逐 id 記指示者與時刻(多方指示可並存、可逐 id 取消)。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import { REBASELINE_FILE, EXTRACT_LEDGER_SHAPES, readLedgerJson, saveLedgerJson } from './extractFiles.mjs'
import { textValueOf as str } from '../core/capturePackage.mjs'

export { REBASELINE_FILE }

const fileOf = (dirs) => path.join(dirs.state, REBASELINE_FILE)
const idsOf = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map((x) => str(x)).filter(Boolean))]

/**
 * 讀名單檔(stamp 給了即壞檔隔離,否則純讀);壞檔經 opt.onError 回報
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {Object} [opt={}] 輸入 { onError:(訊息)=>void, stamp?:String(給了即隔離壞檔) }
 * @returns {Object} 回傳 { ids:{ [id]:{ at, by } } }(缺檔或壞檔為空名單)
 */
function readList(dirs, opt = {}) {
    const raw = readLedgerJson(fileOf(dirs), {
        shape: EXTRACT_LEDGER_SHAPES.rebaseline,
        quarantine: !!opt?.stamp,
        stamp: opt?.stamp,
        hint: '本次不生效',
        onCorrupt: (i) => {
            const moved = i.movedTo ? `；已隔離為 ${path.basename(i.movedTo)}` : ''
            if (typeof opt?.onError === 'function') opt.onError(`重設基準之名單檔不可讀（${path.basename(i.file)}），本次不生效${moved}；請以 requestRebaseline 重給名單`)
        },
    })
    return { ids: isobj(raw?.ids) ? { ...raw.ids } : {} }
}

/**
 * 指示下一輪以現值重設內容基準(逐 id 名單;實際重設由提煉段之維護執行後刪除已處置之 id)——只對名單內之筆記生效。已有名單者合併(同 id 以本次之指示者與時刻為準)
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {String} at 輸入時刻
 * @param {Array} ids 輸入筆記 id(須非空)
 * @param {Object} [opt={}] 輸入 { by:指示者(預設 'api'——如存量處置記 'stock-fix'、執行端之工具記其名) }
 * @returns {String} 回傳名單檔路徑
 * @throws {Error} ids 為空時拋出
 * @example
 * need test in nodejs.
 *
 * requestRebaseline(dirs, '2026-09-01T00:00:00+08:00', ['n-a'], { by: 'tool' })
 */
export function requestRebaseline(dirs, at, ids, opt = {}) {
    const list = idsOf(ids)
    if (!list.length) throw new Error('requestRebaseline 須給筆記 id 名單(逐 id 重設基準)')
    fs.mkdirSync(dirs.state, { recursive: true })
    // 寫入前壞檔先隔離(時戳取指示時刻),不無聲覆蓋
    const cur = readList(dirs, { stamp: String(at || '').replace(/\D/g, '').slice(0, 14) || 'x' }).ids
    for (const id of list) cur[id] = { at: String(at || ''), by: str(opt?.by) || 'api' }
    saveLedgerJson(fileOf(dirs), { ids: cur })
    return fileOf(dirs)
}

/**
 * 自名單移除若干 id(空即刪檔)
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {Array} ids 輸入筆記 id
 * @returns {Integer} 回傳實際移除之筆數
 */
function removeIds(dirs, ids) {
    const list = idsOf(ids)
    if (!list.length) return 0
    const cur = readList(dirs).ids
    let n = 0
    for (const id of list) {
        if (Object.hasOwn(cur, id)) {
            delete cur[id]
            n++
        }
    }
    if (n) saveLedgerJson(fileOf(dirs), Object.keys(cur).length ? { ids: cur } : null)
    return n
}

/**
 * 取消指示(存量處置套用後對未變之筆記、回退之筆記;指示者不限):自名單移除,名單空即刪檔
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {Array} ids 輸入筆記 id
 * @returns {Integer} 回傳實際取消之筆數
 * @example
 * need test in nodejs.
 *
 * cancelRebaseline(dirs, ['n-a'])
 */
export function cancelRebaseline(dirs, ids) {
    return removeIds(dirs, ids)
}

/**
 * 已處置(提煉段之維護對名單內之筆記以現值重設基準畢):只刪已處置之 id——所屬核心維護失敗者由呼叫端不列入,保留至下輪
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {Array} ids 輸入已處置之筆記 id
 * @returns {Integer} 回傳實際刪除之筆數
 * @example
 * need test in nodejs.
 *
 * rebaselineDone(dirs, ['n-a'])
 */
export function rebaselineDone(dirs, ids) {
    return removeIds(dirs, ids)
}

/**
 * 讀重設基準之名單(提煉段之維護、存量處置之連鎖斷言同讀);名單檔不存在回空,壞檔回空並經 opt.onError 回報(不靜默——壞檔若不處置即永不生效);
 *   維護段給 opt.stamp 即隔離壞檔,純讀者不給(只回報、不改檔)
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {Object} [opt={}] 輸入 { onError:(訊息)=>void, stamp?:String }
 * @returns {Array} 回傳筆記 id(去重)
 * @example
 * need test in nodejs.
 *
 * const ids = rebaselineIdsOf(dirs, { onError: (m) => log.warn(m) })
 */
export function rebaselineIdsOf(dirs, opt = {}) {
    return Object.keys(readList(dirs, opt).ids)
}

export default { REBASELINE_FILE, requestRebaseline, cancelRebaseline, rebaselineDone, rebaselineIdsOf }
