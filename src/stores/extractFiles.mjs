// extractFiles.mjs — 提煉之 JSON 帳檔之讀寫(持久檔語意:缺檔與壞檔分流、錯形狀＝壞檔、隔離不假稱、預演純讀)與 dirs.state 下之檔名之家
//
// 【檔名之家】提煉於 dirs.state 下之帳檔與快取之檔名皆定義於本檔(EXTRACT_STATE_FILES 彙集;各擁有之模組以原名轉出)。備份同讀之完整表:
//   ①dirs.state 下之帳檔與快取(EXTRACT_STATE_FILES 之各檔)②核心狀態檔目錄(dirs.coreState,未給即 dirs.core;<核心 id>.state.json)
//   ③dirs.state/core 下之 prev(上一版)、archive(隔離與封存)、manual(手改副本)、dirty(待投影標記)④處置帳(抓取套件之帳協定之
//   STOCK_LEDGER_FILE,dirs.state 下;四工作與宿主同一本帳)。
//
// 【缺檔與壞檔分流】缺檔＝空帳;壞檔(JSON 解析失敗或錯形狀——逐帳以 shape 驗結構)＝隔離為 <檔>.corrupt-<時戳>、告警「提煉帳檔損壞」(字樣只一份
//   extractLedgerCorruptTextOf,外部巡檢必看)、以空帳續行——不可把壞檔當空帳而在下次寫入時無聲覆蓋。分流之機制取關聯套件之 loadLedgerJson(經關聯埠;
//   同類機制同處),本檔只給提煉之字樣與各帳之結構判準。
// 【唯讀讀法】預演、掃描、預覽、驗證等純讀入口讀到壞帳不得修改檔案:readLedgerJson(…, { quarantine:false })只回報、不改名。
// 【派生檔不在此列】內容鍵快取、推定判定快取、同義提議紀錄壞了即重建(各自之模組處置);本檔之讀寫只管「狀態」類之帳:失敗帳、邊庫快照、影響之留待、
//   重設基準之名單、重練意圖。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { writeFileAtomic, oneline } from '../core/capturePackage.mjs'
import { loadLedgerJson } from '../core/relatePackage.mjs'

// ── dirs.state 下之檔名(各擁有之模組以原名轉出;EXTRACT_STATE_FILES 彙集)──

/** 失敗帳之檔名(dirs.state 下) */
export const ATTEMPTS_FILE = 'extract-attempts.json'
/** 內容鍵快取之檔名(dirs.state 下) */
export const CONTENT_CACHE_FILE = 'extract-content.json'
/** 推定判定之快取之檔名(dirs.state 下) */
export const NO_TOP_CACHE_FILE = 'extract-notop.json'
/** 邊庫快照之檔名(dirs.state 下) */
export const EDGE_SEEN_FILE = 'extract-edges-seen.json'
/** 處置紀錄之檔名(dirs.state 下;append-only JSONL) */
export const IMPACT_LEDGER_FILE = 'extract-impact.jsonl'
/** 前次維護未能處置之核心所留待之影響事件(dirs.state 下;{ 核心 id: [事件] }) */
export const IMPACT_RETRY_FILE = 'extract-impact-retry.json'
/** 待審逾上限而丟棄之提案帳(dirs.state 下;JSONL,逐項:時刻、核心、操作、出處、存入時刻與原因) */
export const PENDING_DROPPED_FILE = 'extract-pending-dropped.jsonl'
/** 重設基準之名單檔名(dirs.state 下) */
export const REBASELINE_FILE = 'extract-rebaseline.json'
/** 重練意圖之檔名(dirs.state 下) */
export const REGEN_FILE = 'extract-regen.json'
/** AI 提議之紀錄檔(dirs.state 下;名單雜湊與配對) */
export const SYNONYM_STATE_FILE = 'extract-synonym.json'

/**
 * 提煉於 dirs.state 下之全部帳檔與快取之檔名(檔名皆定義於本檔,各擁有之模組以原名轉出;備份、外部巡檢與維運同讀此表)
 *
 * @type {Object}
 */
export const EXTRACT_STATE_FILES = Object.freeze({
    attempts: ATTEMPTS_FILE, // 失敗帳(stores/extractLedger)
    contentCache: CONTENT_CACHE_FILE, // 已消化筆記之內容鍵快取(stores/contentCache)
    noTopCache: NO_TOP_CACHE_FILE, // 出處之推定判定快取(stores/contentCache)
    edgeSeen: EDGE_SEEN_FILE, // 邊庫快照(ES10;standards/relationImpact)
    impactLedger: IMPACT_LEDGER_FILE, // 關聯變更之影響帳(ES10;standards/relationImpact)
    impactRetry: IMPACT_RETRY_FILE, // 影響之留待事件(ES10;stages/extractMaintain)
    pendingDropped: PENDING_DROPPED_FILE, // 待審逾上限而丟棄之提案帳(stages/extractChain)
    rebaseline: REBASELINE_FILE, // 重設內容基準之名單(stores/rebaseline)
    regen: REGEN_FILE, // 打掉重練之意圖(stores/regenIntent;ops/regenCore 先記、stages/extractMaintain 開工消化)
    synonym: SYNONYM_STATE_FILE, // 同義核對之狀態(standards/synonymCheck)
})

/** 帳檔損壞之必看字樣(前綴;logContract 之 MUST_SEE 同值) */
export const EXTRACT_LEDGER_CORRUPT_WORD = '提煉帳檔損壞'

/**
 * 各 JSON 帳之結構判準(shape:回 '' 為合格、否則回結構問題之說明)
 *
 * @type {Object}
 */
export const EXTRACT_LEDGER_SHAPES = Object.freeze({
    /** 失敗帳:{ [鍵]: 條目物件 } */
    attempts: (d) => (isobj(d) && Object.values(d).every(isobj) ? '' : '結構應為 { [核心鍵或專步鍵]: 計數物件 }'),
    /** 邊庫快照:{ v, at, edges:{ [邊 id]: 簽章 } } */
    edgeSeen: (d) => (isobj(d) && isobj(d.edges) && Object.values(d.edges).every((x) => typeof x === 'string') ? '' : '結構應為 { edges:{ [邊 id]: 簽章 } }'),
    /** 影響之留待:{ [核心 id]: 事件陣列 } */
    impactRetry: (d) => (isobj(d) && Object.values(d).every(isarr) ? '' : '結構應為 { [核心 id]: [事件] }'),
    /** 重設基準之名單:{ ids:{ [筆記 id]: { at, by } } } */
    rebaseline: (d) => (isobj(d) && isobj(d.ids) && Object.values(d.ids).every(isobj) ? '' : '結構應為 { ids:{ [筆記 id]: { at, by } } }'),
    /** 重練意圖:{ cores:{ [核心 id]: { key, scope, stamp, by, at, done } } } */
    regen: (d) => (isobj(d) && isobj(d.cores) && Object.values(d.cores).every(isobj) ? '' : '結構應為 { cores:{ [核心 id]: 意圖 } }'),
    /** 同義提議之紀錄(派生檔;壞即重提):{ v, namesHash, at, pairs:[…] } */
    synonym: (d) => (isobj(d) && isarr(d.pairs) ? '' : '結構應為 { namesHash, pairs:[配對] }'),
})

/**
 * 帳檔損壞之告警文(唯一一份;外部巡檢之必看字樣「提煉帳檔損壞」):已隔離者附隔離檔名;唯讀讀法者註明未隔離;隔離失敗者明寫原因與壞檔仍在原位
 *
 * @param {Object} info 輸入 loadLedgerJson 之 onCorrupt 參數 { file, movedTo, error, quarantineError?, readOnly? }
 * @param {String} [hint] 輸入續行之說明(如「本輪重建基準」;無則「以空帳續行」)
 * @returns {String} 回傳告警文
 * @example
 * console.log(extractLedgerCorruptTextOf({ file: '/s/extract-attempts.json', movedTo: '/s/extract-attempts.json.corrupt-1', error: 'Unexpected token' }))
 * // => 提煉帳檔損壞：extract-attempts.json（Unexpected token），已隔離為 extract-attempts.json.corrupt-1；以空帳續行
 */
export function extractLedgerCorruptTextOf(info, hint) {
    const name = path.basename(String(info?.file || ''))
    const how = info?.readOnly
        ? '，唯讀讀法未隔離（壞檔仍在原位，提煉段下輪開工時隔離）'
        : (info?.movedTo ? `，已隔離為 ${path.basename(String(info.movedTo))}` : `，隔離失敗：${oneline(info?.quarantineError || '', 80)}（壞檔仍在原位，下次寫入會覆寫——請先手動移走）`)
    return `${EXTRACT_LEDGER_CORRUPT_WORD}：${name}（${oneline(info?.error, 80)}）${how}；${hint || '以空帳續行'}`
}

/**
 * 讀 JSON 帳(關聯套件之 loadLedgerJson:缺檔 null、壞檔或錯形狀隔離並回報;quarantine:false 為唯讀讀法)——告警字樣由本檔組,交 o.log.warn;
 *   另給 o.onCorrupt 者亦呼叫之(呼叫端據以記旗標)
 *
 * @param {String} file 輸入帳檔路徑
 * @param {Object} [o={}] 輸入 { shape:(data)=>String(EXTRACT_LEDGER_SHAPES 之一), stamp:String(隔離檔名之時戳), log?:{ warn }, onCorrupt?:(info)=>void,
 *   quarantine?:Boolean(預設 true), hint?:String(告警文之續行說明) }
 * @returns {Object|null} 回傳解析後之資料(缺檔或壞檔為 null)
 * @example
 * need test in nodejs.
 *
 * const data = readLedgerJson(`${dirs.state}/extract-attempts.json`, { shape: EXTRACT_LEDGER_SHAPES.attempts, stamp: '20261102', log })
 */
export function readLedgerJson(file, o = {}) {
    return loadLedgerJson(file, {
        shape: o.shape,
        stamp: o.stamp,
        quarantine: o.quarantine !== false,
        onCorrupt: (info) => {
            // 告警之字樣只一份(extractLedgerCorruptTextOf);此處以樣板轉交,供日誌契約之掃描歸類
            const text = extractLedgerCorruptTextOf(info, o.hint)
            if (typeof o.log?.warn === 'function') o.log.warn(`${text}`)
            if (typeof o.onCorrupt === 'function') o.onCorrupt(info)
        },
    })
}

/**
 * 寫 JSON 帳(原子;data 為 null 即刪檔)
 *
 * @param {String} file 輸入帳檔路徑
 * @param {*} data 輸入資料
 * @param {Object} [o={}] 輸入 { pretty:Boolean(縮排 2;失敗帳用) }
 * @returns {void} 無回傳值(原子寫檔;data 為 null 即刪檔)
 * @example
 * need test in nodejs.
 *
 * saveLedgerJson(`${dirs.state}/extract-attempts.json`, { cores: {} }, { pretty: true })
 */
export function saveLedgerJson(file, data, o = {}) {
    if (data === null) {
        if (fs.existsSync(file)) fs.rmSync(file, { force: true })
        return
    }
    writeFileAtomic(file, o.pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data))
}

export default { ATTEMPTS_FILE, CONTENT_CACHE_FILE, NO_TOP_CACHE_FILE, EDGE_SEEN_FILE, IMPACT_LEDGER_FILE, IMPACT_RETRY_FILE, PENDING_DROPPED_FILE, REBASELINE_FILE, REGEN_FILE, SYNONYM_STATE_FILE, EXTRACT_STATE_FILES, EXTRACT_LEDGER_CORRUPT_WORD, EXTRACT_LEDGER_SHAPES, extractLedgerCorruptTextOf, readLedgerJson, saveLedgerJson }
