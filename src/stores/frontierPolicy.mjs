// frontierPolicy.mjs — 待探索線索（frontier）的泛用機制：去重累加、優先挑選、上限淘汰、消化紀錄
//
// 【hits 累加是訊號不是雜訊】同一線索被多篇文件各自提到，代表它在該領域確實重要。
//   線索產生速度遠高於消化速度，純 FIFO 會讓最該追的題目排在幾百筆冷門線索後面，
//   故重複時累加 hits、消化時依 hits 優先。
// 【去重鍵須折疊字形，hits 才有效】鍵此前只做 lowercase：「Transformer 架構」「transformer架構」「Ｔransformer 架構」
//   「Transformer 架构」各成一筆。此後鍵走 normalizeConcept（NFKC、去空白與括號、小寫、注入之繁簡折疊）——
//   與概念分群同一份折疊；site 型以 normalizeUrl 折疊。既有記錄仍為舊鍵：寫入時先查新鍵、查不到再查舊鍵，
//   命中舊鍵即累加其 hits——不需遷移資料（2026-09-12 複審 P4/S3）。對真庫唯讀重算：折疊只合併 0.1%，
//   線索的問題本質是產生量（每輪 ~100）≫ 消化量，故另設上限（下）。
// 【上限與淘汰（可復活）】pending 超過 maxPending 即淘汰優先序最低者（hits 低、來自 skip 文件、最舊）：
//   狀態 evicted、記錄保留（去重憑證）；日後再被提及即累加 hits 並復活為 pending——
//   淘汰的是「至今只被提過一次的冷門線索」，不是資訊本身。

import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'
import { sha1, normalizeConcept } from '../util/text.mjs'
import { normalizeUrl } from '../util/web.mjs'

/**
 * 線索去重鍵（折疊後）：keyword/topic 走 normalizeConcept，site 走 normalizeUrl
 *
 * @param {String} type 輸入線索型別，'keyword'／'topic'／'site'
 * @param {String} value 輸入線索原始值
 * @returns {String} 回傳去重鍵（sha1 十六進位）
 * @example
 * console.log(clueKey('keyword', 'Transformer 架構') === clueKey('keyword', 'transformer架構'))
 * // => true
 */
export function clueKey(type, value) {
    const v = type === 'site' ? normalizeUrl(String(value || '')).toLowerCase() : normalizeConcept(value)
    return sha1(`${type}|${v}`)
}

/**
 * 舊鍵（2026-09-12 前：僅 lowercase）——只用於查找既有記錄，不再用於新寫入
 *
 * @param {String} type 輸入線索型別
 * @param {String} value 輸入線索原始值
 * @returns {String} 回傳舊版去重鍵（sha1 十六進位）
 * @example
 * console.log(legacyClueKey('keyword', 'ABC') === legacyClueKey('keyword', 'abc'))
 * // => true
 */
export function legacyClueKey(type, value) {
    return sha1(`${type}|${String(value || '').toLowerCase()}`)
}

/**
 * 來自被略過文件之線索（fromRef 'skip:<docId>'）：優先序低於來自知識文件者
 *
 * @param {Object} c 輸入線索記錄，取 fromRef 欄位
 * @returns {Integer} 回傳 1(來自 skip 文件)或 0
 */
const skipDerived = (c) => (/^skip:/.test(String(c?.fromRef || '')) ? 1 : 0)

/**
 * 線索優先序（高 → 低）：hits 降冪 → 來自知識文件者先 → 先來後到；挑選與淘汰共用同一份
 *
 * @param {Object} a 輸入線索記錄 a
 * @param {Object} b 輸入線索記錄 b
 * @returns {Number} 回傳比較結果，供 Array.prototype.sort 使用
 * @example
 * let list = [{ hits: 1, addedAt: '2026-09-01' }, { hits: 5, addedAt: '2026-09-02' }]
 * console.log(list.sort(cluePriority).map((c) => c.hits))
 * // => [ 5, 1 ]
 */
export function cluePriority(a, b) {
    return (b.hits || 1) - (a.hits || 1) ||
    skipDerived(a) - skipDerived(b) ||
    String(a.addedAt || '').localeCompare(String(b.addedAt || ''))
}

/**
 * 寫入一批線索（去重後入庫；重複者 hits+1，已淘汰者復活）。
 *
 * @param {Object} frontier 輸入 frontier 集合，需具 get／patch／insertNew 方法
 * @param {Array} clues 輸入線索陣列 [{type, value, why}]；type 白名單由 cfg.types 決定
 * @param {Object} [cfg={}] 輸入設定物件，非物件則回退為 {}
 * @param {Array} [cfg.types=['keyword','topic','site']] 輸入合法型別白名單字串陣列
 * @param {String} [cfg.fromRef] 輸入本批線索之來源標記（如 'skip:<docId>'）
 * @param {String} [cfg.nowIso] 輸入現在時刻 ISO 字串
 * @param {Integer} [cfg.maxValueLen=120] 輸入線索值最大長度，超過即略過
 * @returns {Promise} 回傳 Promise，resolve 回傳 { addCount:Integer, merged:Integer, revived:Integer }
 * @throws {Error} frontier 缺 get／patch／insertNew 方法時拋出
 */
export async function saveClues(frontier, clues, cfg = {}) {

    //check
    if (!isfun(frontier?.get) || !isfun(frontier?.patch) || !isfun(frontier?.insertNew)) {
        throw new Error('saveClues 需要 frontier 集合（具 get/patch/insertNew 方法）')
    }
    if (!isobj(cfg)) {
        cfg = {}
    }

    const types = cfg.types || ['keyword', 'topic', 'site']
    const maxLen = cfg.maxValueLen ?? 120
    let addCount = 0
    let merged = 0
    let revived = 0
    for (const e of clues || []) {
        const type = String(e?.type || '').trim().toLowerCase()
        const value = String(e?.value || '').trim()
        if (!types.includes(type)) continue
        if (!value || value.length > maxLen) continue
        if (type === 'site' && !/^https?:\/\//i.test(value)) continue
        const id = clueKey(type, value)
        const cur = (await frontier.get(id)) || (await frontier.get(legacyClueKey(type, value)))
        if (cur) {
            const patch = { hits: (cur.hits || 1) + 1 }
            if (cur.status === 'evicted') {
                Object.assign(patch, { status: 'pending', revivedAt: cfg.nowIso }); revived++
            }
            await frontier.patch(cur.id, patch)
            merged++
        }
        else {
            await frontier.insertNew([{
                id,
                type,
                value,
                why: String(e?.why || '').slice(0, 200),
                fromRef: cfg.fromRef || '',
                addedAt: cfg.nowIso,
                status: 'pending', // pending → done（已消化）／failed（探測不到內容）／evicted（逾上限淘汰，可復活）
                tries: 0,
                hits: 1,
            }])
            addCount++
        }
    }
    return { addCount, merged, revived }
}

/**
 * 挑本輪要消化的線索（優先序見 cluePriority）
 *
 * @param {Object} frontier 輸入 frontier 集合，需具 select 方法
 * @param {Integer} [limit] 輸入本輪最多取幾筆，非非負整數則不限（取全部待消化線索）
 * @returns {Promise} 回傳 Promise，resolve 回傳依優先序排序後之線索陣列
 * @throws {Error} frontier 缺 select 方法時拋出
 */
export async function pickClues(frontier, limit) {

    //check
    if (!isfun(frontier?.select)) {
        throw new Error('pickClues 需要 frontier 集合（具 select 方法）')
    }

    const pending = (await frontier.select({ status: 'pending' })).sort(cluePriority)
    if (!isp0int(limit)) {
        return pending
    }
    return pending.slice(0, cint(limit))
}

/**
 * 上限淘汰：pending 超過 maxPending 時把優先序最低者標 evicted（記錄保留；再被提及即復活）。
 *
 * @param {Object} frontier 輸入 frontier 集合，需具 select／patch 方法
 * @param {Object} cfg 輸入設定物件 { maxPending:Integer, nowIso:String }，maxPending ≤ 0 即不設限
 * @returns {Promise} 回傳 Promise，resolve 回傳 {pending:Integer, evicted:Integer}
 * @throws {Error} frontier 缺 select／patch 方法時拋出
 */
export async function enforceFrontierCap(frontier, cfg) {

    //check
    if (!isfun(frontier?.select) || !isfun(frontier?.patch)) {
        throw new Error('enforceFrontierCap 需要 frontier 集合（具 select/patch 方法）')
    }

    const max = Number(cfg?.maxPending) || 0
    const pending = await frontier.select({ status: 'pending' })
    if (max <= 0 || pending.length <= max) return { pending: pending.length, evicted: 0 }
    const victims = pending.slice().sort(cluePriority).slice(max)
    for (const c of victims) await frontier.patch(c.id, { status: 'evicted', evictedAt: cfg.nowIso })
    return { pending: max, evicted: victims.length }
}

/**
 * 記錄單一線索的消化結果（成功 done；失敗記 tries，達上限轉 failed 否則留 pending）
 *
 * @param {Object} frontier 輸入 frontier 集合，需具 patch 方法
 * @param {Object} clue 輸入線索記錄
 * @param {Object} outcome 輸入本輪消化結果物件，需含 ok（Boolean），可含 resolved(String)、yieldDocs(Number)、error(String)
 * @param {Object} [cfg={}] 輸入設定物件，非物件則回退為 {}
 * @param {String} [cfg.nowIso] 輸入現在時刻 ISO 字串
 * @param {Integer} [cfg.maxTries=2] 輸入最多重試幾次，達上限轉 failed
 * @returns {Promise} 回傳 Promise，resolve 回傳 { status:String }
 * @throws {Error} frontier 缺 patch 方法，或 outcome 非物件時拋出
 */
export async function settleClue(frontier, clue, outcome, cfg = {}) {

    //check
    if (!isfun(frontier?.patch)) {
        throw new Error('settleClue 需要 frontier 集合（具 patch 方法）')
    }
    if (!isobj(outcome)) {
        throw new Error('settleClue 需要 outcome 物件（{ ok, resolved?, yieldDocs?, error? }）')
    }
    if (!isobj(cfg)) {
        cfg = {}
    }

    const tries = (clue.tries || 0) + 1
    if (outcome.ok) {
        await frontier.patch(clue.id, { status: 'done', tries, resolvedAt: cfg.nowIso, resolved: outcome.resolved || '', yieldDocs: outcome.yieldDocs ?? 0 })
        return { status: 'done' }
    }
    const status = tries >= (cfg.maxTries ?? 2) ? 'failed' : 'pending'
    await frontier.patch(clue.id, { status, tries, lastError: String(outcome.error || '').slice(0, 150) })
    return { status }
}

export default { clueKey, legacyClueKey, cluePriority, saveClues, pickClues, enforceFrontierCap, settleClue }
