// coreVersionsByProvenance.mjs — 依產出鏈取核心版本(純讀;跨套件之產出鏈規格 §6 之提煉端選件)
//
// 【資料來源】各核心狀態檔之 changelog 每筆之 produced(core/producedChain;stage 為 extract、regen-core、rollback)——真理源為狀態檔,不讀 md。
//   舊記錄(無 produced 之 changelog 筆)不出現在結果(不回填);被回退而封存之版本不在現行狀態檔,故不出現。
// 【條件】皆為「且」:stamp(輪次 stamp;null＝輪次外之手動操作)、stage、provider／seat(多步產出者比對 steps,同一步須同時合 provider 與 seat;單一形〔如回退之 null／null〕
//   比對其頂層 seat／provider)、since／until(比對 produced.at;含界)。未給之條件不限。
// 【之後】選件之後之重處理或撤出走既有路徑(重審、regenCore、rollbackCore),本函數不寫任何東西。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { cmp } from '../core/capturePackage.mjs'
import { liveCoresOf } from '../stores/conceptSelection.mjs'
import { coreStoreOf } from '../stores/coreStore.mjs'
import { EXTRACT_API_HINT } from '../stores/extractHolds.mjs'

/**
 * 時間條件轉毫秒(接受 ISO 字串、毫秒數、Date;不合者拋)
 *
 * @param {*} v 輸入時間
 * @param {String} name 輸入條件名(訊息用)
 * @returns {Number} 回傳毫秒
 */
function msOf(v, name) {
    const n = v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : Date.parse(String(v)))
    if (!Number.isFinite(n)) throw new Error(`coreVersionsByProvenance 之 opt.${name} 須為可解析之時間（ISO 字串、毫秒數或 Date）`)
    return n
}

/**
 * 依產出鏈取核心版本(純讀):逐核心讀狀態檔之 changelog,取 produced 合於條件者
 *
 * @param {Object} stores 輸入集合物件，需含 cores(select)
 * @param {Object} opt 輸入設定物件(必填)
 * @param {Object} opt.dirs 輸入目錄物件(同每輪依賴之 dirs；取 core、coreState、state)
 * @param {String|null} [opt.stamp] 輸入輪次 stamp(14 碼;null＝輪次外之手動操作);未給不限
 * @param {String} [opt.stage] 輸入產出階段(extract、regen-core、rollback);未給不限
 * @param {String|null} [opt.provider] 輸入實際成交條目(多步者比對任一 steps;與 seat 並給時須同一步);未給不限
 * @param {Number|String|null} [opt.seat] 輸入席位(多步者之席號〔收數字或數字字串〕;單一形者之席位字串);未給不限
 * @param {String|Number|Date} [opt.since] 輸入起(含;比對 produced.at);未給不限
 * @param {String|Number|Date} [opt.until] 輸入迄(含;比對 produced.at);未給不限
 * @returns {Promise} 回傳 Promise，resolve 回傳 [{ concept, version, produced }](依概念、版本排序;無 produced 之舊記錄不出現)
 * @throws {Error} stores 缺 cores.select、opt.dirs 缺 core／state、since／until 不可解析時拋出
 * @example
 * need test in nodejs.
 *
 * let rows = await coreVersionsByProvenance(stores, { dirs, provider: 'codex:gpt-6.1-terra', stage: 'extract' })
 * console.log(rows.map((x) => `${x.concept}@v${x.version}`))
 */
export async function coreVersionsByProvenance(stores, opt = {}) {

    //check
    if (!isobj(stores) || !isobj(stores.cores) || !isfun(stores.cores.select)) {
        throw new Error('coreVersionsByProvenance 需要 stores.cores.select（cores 集合）')
    }
    if (!isobj(opt) || !isobj(opt.dirs) || !isestr(opt.dirs.core) || !isestr(opt.dirs.state)) {
        throw new Error(`coreVersionsByProvenance 需要 opt.dirs（${EXTRACT_API_HINT.regenDirs}）`)
    }
    const since = opt.since === undefined || opt.since === null ? null : msOf(opt.since, 'since')
    const until = opt.until === undefined || opt.until === null ? null : msOf(opt.until, 'until')
    const has = (k) => opt[k] !== undefined
    const store = coreStoreOf(opt.dirs)

    // 一筆 produced 是否合於全部條件
    const match = (p) => {
        if (!isobj(p)) return false
        if (has('stamp') && p.stamp !== opt.stamp) return false
        if (has('stage') && p.stage !== opt.stage) return false
        if (since !== null || until !== null) {
            const t = Date.parse(p.at)
            if (!Number.isFinite(t) || (since !== null && t < since) || (until !== null && t > until)) return false
        }
        if (has('provider') || has('seat')) {
            const steps = Array.isArray(p.steps) ? p.steps : [{ seat: p.seat, provider: p.provider }]
            const ok = (s) => (!has('provider') || s.provider === opt.provider) && (!has('seat') || String(s.seat) === String(opt.seat))
            if (!steps.some(ok)) return false
        }
        return true
    }

    const out = []
    for (const rec of liveCoresOf(await stores.cores.select())) {
        const r = store.load(rec.id)
        if (r.status !== 'ok' && r.status !== 'recovered') continue
        for (const c of Array.isArray(r.state.changelog) ? r.state.changelog : []) {
            if (match(c?.produced)) out.push({ concept: r.state.concept, version: c.version, produced: c.produced })
        }
    }
    return out.sort((a, b) => cmp(a.concept, b.concept) || a.version - b.version)
}

export default { coreVersionsByProvenance }
