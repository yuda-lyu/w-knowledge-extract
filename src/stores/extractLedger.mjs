// extractLedger.mjs — 提煉之失敗帳(dirs.state 下;每核心之失敗次數與退避、批內未涵蓋筆記之重送次數、專步層之連續失敗)
//
// 【單一共享物件】本段行程內只建一份(並行概念共寫同一物件;save 為同步整份原子寫,行程內無交錯),每核心處理後原子寫整份。鍵為 `<scope>|<正規化概念>`
//   (核心;鍵式只在 coreLedgerKeyOf)或 `step|<專步>`(不屬單一核心之專步;前綴 EXTRACT_LEDGER_STEP_PREFIX);選題只讀核心鍵。
//   跨行程之寫者只有管線(維運之重練不直接改帳,改寫重練意圖由管線消化——否則被管線之整份覆寫吃掉)。
// 【檔名只此一處】提煉段、維運與外部巡檢同讀 ATTEMPTS_FILE。
// 【帳之格式只此一處】計數欄:tries(一般差量、整併、待審裁決之全鏈失敗;失敗即回隊尾)、<專步>Tries(重審、本質與判定小組專步之專步層失敗;
//   退避);noteTries、conflictTries、<專步>ItemTries 為逐項之物件(不是連續失敗)。外部巡檢判「連續失敗」取 extractStuckOf,不另讀欄位。
// 【壞檔】帳檔壞或錯形狀＝隔離並告警(stores/extractFiles 之持久檔語意),不當空帳無聲覆蓋。

import isobj from 'wsemi/src/isobj.mjs'
import { normalizeConcept } from '../core/capturePackage.mjs'
import { ATTEMPTS_FILE, EXTRACT_LEDGER_SHAPES, readLedgerJson, saveLedgerJson } from './extractFiles.mjs'

export { ATTEMPTS_FILE }

/** 失敗帳中專步鍵之前綴(專步鍵＝前綴＋專步名;核心鍵之 scope 只有 concept／category,不相撞) */
export const EXTRACT_LEDGER_STEP_PREFIX = 'step|'

/** 失敗帳之錯誤摘要(lastError 與各模式之 <mode>LastError)之字數上限(抓取套件之 oneline 截斷;已落帳之欄,各寫入處同讀此值) */
export const LEDGER_ERROR_CHARS = 200

/** 連續失敗之次數門檻(外部巡檢列示「連續失敗」之預設;選題之回隊尾與專步之退避自行運作,不讀本值) */
export const EXTRACT_STUCK_TRIES = 3

/**
 * 核心之失敗帳鍵(鍵式只此一處:`<scope>|<正規化概念>`;scope 缺省為 concept;選題、提煉段、專步排程、重練意圖之消化同讀)
 *
 * @param {Object} c 輸入 { scope?, concept }(核心記錄)或 { scope?, key }(選題項與重練意圖:key＝已正規化之概念鍵,給了即直接用、不再正規化——
 *   正規化不保證冪等〔改名與別名表〕,已正規化者不可再過一次)
 * @returns {String} 回傳鍵
 * @example
 * console.log(coreLedgerKeyOf({ concept: 'Transformer 架構' }), coreLedgerKeyOf({ scope: 'category', concept: '方法' }), coreLedgerKeyOf({ scope: 'concept', key: 'x', concept: '顯示名' }))
 * // => concept|transformer架構 category|方法 concept|x
 */
export function coreLedgerKeyOf(c) {
    const key = typeof c?.key === 'string' ? c.key : normalizeConcept(String(c?.concept ?? ''))
    return `${c?.scope === 'category' ? 'category' : 'concept'}|${key}`
}

/**
 * 失敗帳(行程內單一共享物件;每次 save 原子寫整份)
 *
 * @param {String} file 輸入帳檔路徑
 * @param {Object} [o={}] 輸入 { stamp?:String(隔離檔名之時戳), log?:{ warn }(壞檔之告警) }
 * @returns {Object} 回傳 { data, entry(key), save(), remove(key)→Boolean }
 * @example
 * need test in nodejs.
 *
 * const ledger = createExtractLedger(`${dirs.state}/extract-attempts.json`, { stamp: '20261102', log })
 */
export function createExtractLedger(file, o = {}) {
    const data = readLedgerJson(file, { shape: EXTRACT_LEDGER_SHAPES.attempts, stamp: o?.stamp, log: o?.log }) || {}
    return {
        data,
        entry: (key) => {
            if (!isobj(data[key])) data[key] = {}
            if (!isobj(data[key].noteTries)) data[key].noteTries = {}
            return data[key]
        },
        save: () => saveLedgerJson(file, data, { pretty: true }),
        /** 刪一鍵(重練意圖之消化;有刪回 true) */
        remove: (key) => {
            if (!(key in data)) return false
            delete data[key]
            return true
        },
    }
}

/**
 * 失敗帳中連續失敗達門檻者(外部巡檢之列示;檔頭【帳之格式只此一處】):核心鍵之 tries 或任一 <專步>Tries 達門檻者;專步鍵之 <專步>Tries
 *   達門檻者另列
 *
 * @param {Object} data 輸入失敗帳之內容(createExtractLedger 之 data,或讀帳檔所得之物件;非物件視為{})
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Integer} [opt.min=EXTRACT_STUCK_TRIES] 輸入門檻(正整數;非正整數取預設)
 * @returns {Object} 回傳 { cores:Array(核心鍵), steps:Array(專步鍵) }(皆依帳內之序)
 * @example
 * console.log(extractStuckOf({ 'concept|甲': { tries: 3 }, 'concept|乙': { tries: 1, essenceTries: 4, noteTries: { n1: 5 } }, 'concept|丙': { tries: 2 }, 'step|synonym': { synonymTries: 3 } }))
 * // => { cores: [ 'concept|甲', 'concept|乙' ], steps: [ 'step|synonym' ] }
 */
export function extractStuckOf(data, opt = {}) {
    const d = isobj(data) ? data : {}
    const min = Number.isInteger(opt?.min) && opt.min > 0 ? opt.min : EXTRACT_STUCK_TRIES
    // 計數欄只認數值:noteTries、conflictTries、<專步>ItemTries 為逐項之物件
    const stuck = (v) => isobj(v) && Object.entries(v).some(([k, n]) => (k === 'tries' || /[a-z]Tries$/.test(k)) && Number.isFinite(n) && n >= min)
    const cores = []
    const steps = []
    for (const [k, v] of Object.entries(d)) {
        if (!stuck(v)) continue
        if (k.startsWith(EXTRACT_LEDGER_STEP_PREFIX)) steps.push(k)
        else cores.push(k)
    }
    return { cores, steps }
}

export default { ATTEMPTS_FILE, EXTRACT_LEDGER_STEP_PREFIX, EXTRACT_STUCK_TRIES, LEDGER_ERROR_CHARS, coreLedgerKeyOf, createExtractLedger, extractStuckOf }
