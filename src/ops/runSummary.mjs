// runSummary.mjs — 每輪執行摘要之結構化落地(log/<day>/<stamp>-run.json)與讀取
//
// 【為何需要】巡檢與健康檢查此前以正則解析日誌文字取數字,而數字來源是各物件手寫的摘要字串
//   (objects.mjs 之 legacy 摘要)——同一份數字被「格式化成字串」再「用正則解回來」,字串格式
//   因此成了隱性契約,改一個字兩邊就失準(已修過多次正則)。而 runPipeline 回傳的 report
//   物件本來就帶各段 stats/detail,只是沒有落地。本檔把它落成 JSON:巡檢優先讀 JSON,
//   正則只作舊日誌與被砍輪次(無 JSON)的退路;日誌回歸人讀。
//
// 【內容:只留可序列化之純量與扁平物件】stage.result 內可能帶大物件(子階段 report 之 detail
//   含統計,無原文);一律經 sanitize 截字串、限深度,檔案永遠只有幾 KB。
// 【失敗不影響管線】寫檔失敗只回 null,不拋——摘要是附加產物,不承擔本輪成敗。

import fs from 'fs'
import path from 'path'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'

export const RUN_SUMMARY_VERSION = 1

/**
 * 深度清洗任意值為可序列化形狀:只保留純量／陣列／物件,限深度與字串長度;函數與循環參照一律剔除
 *
 * 遞迴容錯,不對 v 之型別加檢查(本就以 typeof 逐型分派);維持既有語意
 *
 * @param {*} v 輸入任意值
 * @param {Integer} [depth=0] 輸入目前遞迴深度(內部遞迴用，外部呼叫通常省略)
 * @param {Integer} [maxDepth=5] 輸入最大遞迴深度，逾此深度之子節點剔除
 * @returns {*} 回傳清洗後之值；函數／symbol／bigint 或逾深度者回傳 undefined
 * @example
 * console.log(sanitize({ f: () => 1, s: 'x'.repeat(400), n: 1 }).f)
 * // => undefined
 *
 * console.log(sanitize({ n: 1 }).n)
 * // => 1
 */
export function sanitize(v, depth = 0, maxDepth = 5) {
    if (v === null || v === undefined) return v
    const t = typeof v
    if (t === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v
    if (t === 'number' || t === 'boolean') return v
    if (t === 'function' || t === 'symbol' || t === 'bigint') return undefined
    if (v instanceof Error) return { message: String(v.message || '').slice(0, 300) }
    if (depth >= maxDepth) return undefined
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => sanitize(x, depth + 1, maxDepth)).filter((x) => x !== undefined)
    const out = {}
    for (const [k, x] of Object.entries(v)) {
        const s = sanitize(x, depth + 1, maxDepth)
        if (s !== undefined) out[k] = s
    }
    return out
}

/**
 * 由 runPipeline 之 report 組出摘要物件(純資料),供 writeRunSummary 落地為 JSON
 *
 * @param {Object} p 輸入來源物件
 * @param {Object} [p.report] 輸入 runPipeline 之 report 物件，含 name、ms、ok、stages 等
 * @param {String} [p.startedAt] 輸入本輪開始時刻字串
 * @param {String} [p.endedAt] 輸入本輪結束時刻字串
 * @param {Number} [p.deadlineMs] 輸入時間預算毫秒數
 * @param {Object} [p.ai] 輸入 AI 調度物件，取 aiUsageToday()、health.snapshot()
 * @param {String} [p.stamp] 輸入本輪時間戳(與日誌檔同一時間戳)
 * @returns {Object} 回傳摘要物件(RUN_SUMMARY_VERSION 形狀)
 * @example
 * need test in nodejs.
 *
 * let summary = buildRunSummary({ report, startedAt: 'x', endedAt: 'y', stamp: '20260921120000' })
 */
export function buildRunSummary(p) {

    //check
    if (!isobj(p)) {
        p = {}
    }

    const rep = p.report || {}
    const stages = (rep.stages || []).map((s) => {
        const r = s.result && typeof s.result === 'object' ? s.result : null
        return sanitize({
            name: s.name,
            step: s.step,
            status: s.status,
            reason: s.reason || '',
            ms: s.ms,
            ok: r?.ok,
            stats: r?.stats,
            summary: r?.summary,
            // 物件級 report 之 detail＝各子階段 report(名稱 → {ok,stats,detail,summary});其餘階段 detail 為統計
            sub: r?.detail && typeof r.detail === 'object' ? r.detail : undefined,
        })
    })
    const ai = p.ai
    return {
        version: RUN_SUMMARY_VERSION,
        name: rep.name || '',
        stamp: p.stamp || '',
        startedAt: p.startedAt || '',
        endedAt: p.endedAt || '',
        ms: rep.ms ?? 0,
        ok: rep.ok !== false,
        stopped: !!rep.stopped,
        stopReason: rep.stopReason || '',
        aborted: !!rep.aborted,
        lockSkipped: !!rep.lockSkipped,
        deadlineMs: p.deadlineMs ?? null,
        stages,
        ai: ai
            ? sanitize({
                usageToday: ai.aiUsageToday?.()?.byKey,
                health: ai.health?.snapshot?.(false),
            })
            : undefined,
    }
}

/**
 * 寫入 log/<day>/<stamp>-run.json;回傳檔案路徑,失敗回 null(摘要是附加產物,不承擔本輪成敗)
 *
 * @param {Object} p 輸入來源物件
 * @param {String} p.dir 輸入 log 根目錄字串
 * @param {String} p.stamp 輸入時間戳字串(與日誌檔同一時間戳,格式須為 14 碼數字)
 * @param {*} p.summary 輸入欲寫入之摘要資料(通常為 buildRunSummary 之產出)
 * @returns {String} 回傳檔案路徑;p 非物件、stamp 格式不符或寫入失敗時回傳 null
 * @example
 * need test in nodejs.
 *
 * let file = writeRunSummary({ dir: './log', stamp: '20260921120000', summary: { a: 1 } })
 */
export function writeRunSummary(p) {

    //check
    if (!isobj(p)) {
        return null
    }

    try {
        const stamp = String(p.stamp || '')
        if (!/^\d{14}$/.test(stamp)) return null
        const folder = path.join(p.dir, stamp.slice(0, 8))
        fsCreateFolder(folder)
        const file = path.join(folder, `${stamp}-run.json`)
        fs.writeFileSync(file, JSON.stringify(p.summary, null, 2), 'utf8')
        return file
    }
    catch {
        return null
    }
}

/**
 * 讀取摘要 JSON 檔;不存在、壞檔、版本不符或 file 非有效字串皆回 null(呼叫端退回正則解析)
 *
 * @param {String} file 輸入摘要 JSON 檔案路徑字串
 * @returns {Object} 回傳摘要物件;讀取失敗或版本不符時回傳 null
 * @example
 * need test in nodejs.
 *
 * let j = readRunSummary('./log/20260921/20260921120000-run.json')
 */
export function readRunSummary(file) {

    //check
    if (!isestr(file)) {
        return null
    }

    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!j || typeof j !== 'object' || j.version !== RUN_SUMMARY_VERSION || !Array.isArray(j.stages)) return null
        return j
    }
    catch {
        return null
    }
}

/**
 * 取某階段之子階段 report;無則 null。
 * 先依階段名,找不到再以子階段鍵於全部階段搜尋——階段名(抓取／彙整…)可由安裝方以 opt.name 覆寫,
 * 子階段名(listFetch／extract…)是 hook 名冊之固定鍵,才是穩定的接縫(2026-09-12 複審 B9)
 *
 * @param {Object} summary 輸入摘要物件(readRunSummary 或 buildRunSummary 之產出)，容錯:非物件或缺 stages 視為無資料
 * @param {String} stageName 輸入階段名字串(如 '彙整')
 * @param {String} subName 輸入子階段鍵字串(如 'extract')
 * @returns {Object} 回傳子階段 report 物件;找不到時回傳 null
 * @example
 * need test in nodejs.
 *
 * let sub = subReportOf(summary, '彙整', 'extract')
 */
export function subReportOf(summary, stageName, subName) {
    const stages = summary?.stages || []
    const pick = (st) => (st?.sub?.[subName] && typeof st.sub[subName] === 'object' ? st.sub[subName] : null)
    return pick(stages.find((s) => s.name === stageName)) || stages.map(pick).find(Boolean) || null
}

export default { buildRunSummary, writeRunSummary, readRunSummary, subReportOf, sanitize, RUN_SUMMARY_VERSION }
