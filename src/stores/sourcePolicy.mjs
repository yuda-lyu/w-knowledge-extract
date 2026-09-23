// sourcePolicy.mjs — 來源管理的泛用機制：種子同步、輪抓挑選、成敗計數、品質淘汰與產出率回饋
//
// 【機制入套件，數字與判準留執行端】「連續失敗幾次停用」「零產出怎麼判定」是品質政策，
//   各知識庫不同——故門檻走 config、產出判定走注入函數；本檔只保證機制正確：
//   計數歸零時機（成功即歸零，否則跨月累積間歇性失敗會讓健康來源莫名被停用）、
//   停用可逆、宣告欄位與執行期統計分離。
// 【產出率回饋輪抓配額】下游 AI 判定（noted／skip）是來源品質的唯一事實來源；此前只用它做「零產出淘汰」，
//   產出率極低但不為零的來源與高產出來源同等競爭名額（2026-09-12 複審 P11）。此後每輪把各來源的
//   judged／yielded 落在來源記錄上（同一次文件掃描，不另加成本），輪抓挑選時把「樣本足量且產出率
//   低於門檻」者排到同層級之末——降序不停用，記錄與名額都不丟。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import cint from 'wsemi/src/cint.mjs'

/**
 * 把種子來源補進集合（已存在者不動統計），並同步宣告欄位。
 *
 * 【宣告欄位要跟著種子檔更新】種子檔是 tier／name 等欄位的唯一真理來源；
 *   不同步的話，改了種子宣告，庫裡舊記錄永遠停在建立當時的值。
 *   執行期統計（lastFetchAt／okCount／failCount／enabled）不可覆寫。
 *
 * @param {Object} sources 輸入來源集合（w-data-pipeline openCollection 介面），需具 insertNew／select／patch 方法
 * @param {Array} seeds 輸入已含 id 之種子記錄陣列（id 由執行端算好——它是去重鍵）
 * @param {Array} [declaredFields=['tier','name','lang','query']] 輸入要同步的宣告欄位字串陣列，非陣列則用預設
 * @returns {Promise} 回傳 Promise，resolve 回傳 { addCount, dupCount, synced }
 * @throws {Error} sources 缺 insertNew／select／patch 方法，或 seeds 非陣列時拋出
 */
export async function ensureSeedSources(sources, seeds, declaredFields = ['tier', 'name', 'lang', 'query']) {

    //check
    if (!isfun(sources?.insertNew) || !isfun(sources?.select) || !isfun(sources?.patch)) {
        throw new Error('ensureSeedSources 需要 sources 集合（具 insertNew/select/patch 方法）')
    }
    if (!isarr(seeds)) {
        throw new Error('ensureSeedSources 需要 seeds（種子記錄陣列）')
    }
    if (!isarr(declaredFields)) {
        declaredFields = ['tier', 'name', 'lang', 'query']
    }

    const r = await sources.insertNew(seeds)
    const existing = new Map((await sources.select()).map((s) => [s.id, s]))
    let synced = 0
    for (const s of seeds) {
        const cur = existing.get(s.id)
        if (!cur) continue
        const patch = {}
        for (const f of declaredFields) {
            if (s[f] !== undefined && cur[f] !== s[f]) patch[f] = s[f]
        }
        if (Object.keys(patch).length) {
            await sources.patch(s.id, patch); synced++
        }
    }
    return { addCount: r.addCount, dupCount: r.dupCount, synced }
}

/**
 * 低產出判定：樣本足量（judged ≥ minJudged）且產出率低於 lowYieldRate；統計缺席者不判
 *
 * @param {Object} src 輸入來源記錄，需含 judged／yielded 統計欄位（缺席視為 0）
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Number} [opt.lowYieldRate] 輸入產出率門檻（0～1），未給或非正數即不判定為低產出
 * @param {Integer} [opt.minJudged=6] 輸入樣本足量之最少已判定篇數
 * @returns {Boolean} 回傳是否為低產出來源
 * @example
 * console.log(isLowYield({ judged: 10, yielded: 1 }, { lowYieldRate: 0.3, minJudged: 6 }))
 * // => true
 *
 * console.log(isLowYield({ judged: 2, yielded: 0 }, { lowYieldRate: 0.3, minJudged: 6 }))
 * // => false
 */
export function isLowYield(src, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }
    const { lowYieldRate, minJudged } = opt

    const rate = Number(lowYieldRate)
    if (!(rate > 0)) return false
    const judged = Number(src?.judged) || 0
    if (judged < (minJudged ?? 6)) return false
    return (Number(src?.yielded) || 0) / judged < rate
}

/**
 * 挑出本輪要抓的來源：先 tier，同層級內低產出者排末，再 lastFetchAt（最舊優先）；且需超過最短重抓間隔。
 *
 * @param {Object} sources 輸入來源集合，需具 select 方法
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Integer} [opt.limit] 輸入本輪最多取幾筆，非非負整數(含未給)即不限（全取語意，與 frontierPolicy 之 pickClues 同一規則）
 * @param {Integer} [opt.minIntervalMs=0] 輸入最短重抓間隔毫秒數，非數值(含未給)視為 0（不設間隔，已抓過者亦到期）
 * @param {Number} [opt.lowYieldRate] 輸入產出率門檻，未給或 0 即不降序（行為同舊版）
 * @param {Integer} [opt.minJudged] 輸入樣本足量之最少已判定篇數
 * @returns {Promise} 回傳 Promise，resolve 回傳到期來源陣列（依優先序排序後取前 limit 筆）
 * @throws {Error} sources 缺 select 方法時拋出
 */
export async function pickDueSources(sources, opt = {}) {

    //check
    if (!isfun(sources?.select)) {
        throw new Error('pickDueSources 需要 sources 集合（具 select 方法）')
    }
    if (!isobj(opt)) {
        opt = {}
    }
    const { limit, lowYieldRate, minJudged } = opt
    // 此前未給 minIntervalMs 時 `now - t >= undefined` 恆為 false,已抓過之來源永不到期(只剩從未抓過者);
    // 管線內呼叫端一律帶 settings.fetch.minSourceIntervalMs,故只影響直接呼叫本函數者
    let minIntervalMs = opt.minIntervalMs
    if (!isnum(minIntervalMs)) {
        minIntervalMs = 0
    }
    minIntervalMs = cdbl(minIntervalMs)

    const all = await sources.select()
    const now = Date.now()
    const due = all.filter((s) => {
        if (s.enabled === false) return false
        if (!s.lastFetchAt) return true
        const t = Date.parse(s.lastFetchAt)
        return !Number.isFinite(t) || now - t >= minIntervalMs
    })
    const demoted = (s) => (isLowYield(s, { lowYieldRate, minJudged }) ? 1 : 0)
    due.sort((a, b) => ((a.tier || 2) - (b.tier || 2)) ||
    (demoted(a) - demoted(b)) ||
    String(a.lastFetchAt || '').localeCompare(String(b.lastFetchAt || '')))
    if (!isp0int(limit)) {
        return due
    }
    return due.slice(0, cint(limit))
}

/**
 * 記錄單一來源本輪成敗並套用停用規則。
 *
 * 【failCount 成功即歸零】停用門檻的本意是「連續」失敗 N 次；不歸零會跨月累積
 *   間歇性失敗，健康的種子來源終有一天被莫名停用且極難歸因。
 * 【空回計數只針對自動衍生來源】種子來源一時無新文不停用（人工驗證過的來源
 *   值得長期監看）；自動衍生的查詢來源連續全空即停用，否則永久佔用輪抓名額。
 *
 * @param {Object} sources 輸入來源集合，需具 patch 方法
 * @param {Object} src 輸入來源記錄
 * @param {Object} outcome 輸入本輪結果物件，需含 ok（Boolean），可含 itemCount(Number)、error(String)
 * @param {Object} [cfg={}] 輸入設定物件，非物件則回退為 {}
 * @param {String} [cfg.nowIso] 輸入現在時刻 ISO 字串
 * @param {Integer} [cfg.maxConsecFails=8] 輸入連續失敗幾次即停用
 * @param {Integer} [cfg.maxConsecEmpty=5] 輸入自動衍生來源連續空回幾次即停用
 * @param {Function} [cfg.isAutoSource] 輸入判斷是否為自動衍生來源之函數，簽名 (src)=>Boolean
 * @param {Object} [cfg.extraPatch] 輸入要一併寫入之額外欄位物件
 * @returns {Promise} 回傳 Promise，resolve 回傳 { disabled:Boolean, reason:String }
 * @throws {Error} sources 缺 patch 方法，或 outcome 非物件時拋出
 */
export async function recordSourceOutcome(sources, src, outcome, cfg = {}) {

    //check
    if (!isfun(sources?.patch)) {
        throw new Error('recordSourceOutcome 需要 sources 集合（具 patch 方法）')
    }
    if (!isobj(outcome)) {
        throw new Error('recordSourceOutcome 需要 outcome 物件（{ ok, itemCount?, error? }）')
    }
    if (!isobj(cfg)) {
        cfg = {}
    }

    const nowIso = cfg.nowIso
    if (outcome.ok) {
        const emptyCount = (outcome.itemCount || 0) === 0 ? (src.emptyCount || 0) + 1 : 0
        const auto = !!cfg.isAutoSource?.(src)
        const disable = auto && emptyCount >= (cfg.maxConsecEmpty ?? 5)
        await sources.patch(src.id, {
            lastFetchAt: nowIso,
            okCount: (src.okCount || 0) + 1,
            failCount: 0,
            lastError: '',
            emptyCount,
            enabled: !disable,
            ...(cfg.extraPatch || {}),
        })
        return { disabled: disable, reason: disable ? `連續 ${emptyCount} 次無資料` : '' }
    }
    const failCount = (src.failCount || 0) + 1
    const disable = failCount >= (cfg.maxConsecFails ?? 8)
    await sources.patch(src.id, {
        lastFetchAt: nowIso,
        failCount,
        lastError: String(outcome.error || '').slice(0, 200),
        enabled: !disable,
        ...(cfg.extraPatch || {}),
    })
    return { disabled: disable, reason: disable ? `連續失敗 ${failCount} 次` : '' }
}

/**
 * 零產出來源淘汰＋產出統計落帳：已判定樣本夠多且產出掛零者停用；每來源之 judged／yielded 有變即寫回
 * 來源記錄（供輪抓挑選之產出率回饋與巡檢／工具檢視）。
 *
 * 【判準：產出掛零，而非丟棄率高】混合型來源有真產出，以丟棄率淘汰就是誤殺；
 *   判定數據由注入的 judge 提供（通常自文件集統計 AI 已做過的逐篇分類），
 *   不引入新的猜測。停用可逆：手動 enable 後若產出首篇即不再觸發。
 *
 * @param {Object} sources 輸入來源集合，需具 select／patch 方法
 * @param {Function} judgeOf 輸入每來源的判定統計函數，簽名 (src)=>{judged:Number, yielded:Number}|null
 * @param {Object} [cfg={}] 輸入設定物件，非物件則回退為 {}
 * @param {Integer} [cfg.minJudged=6] 輸入樣本足量之最少已判定篇數
 * @param {Object} [cfg.log] 輸入 logger 物件（用 warn 記錄自動停用）
 * @returns {Promise} 回傳 Promise，resolve 回傳 { culled:Integer, synced:Integer }
 * @throws {Error} sources 缺 select／patch 方法，或 judgeOf 非函數時拋出
 */
export async function cullZeroYieldSources(sources, judgeOf, cfg = {}) {

    //check
    if (!isfun(sources?.select) || !isfun(sources?.patch)) {
        throw new Error('cullZeroYieldSources 需要 sources 集合（具 select/patch 方法）')
    }
    if (!isfun(judgeOf)) {
        throw new Error('cullZeroYieldSources 需要 judgeOf 函數')
    }
    if (!isobj(cfg)) {
        cfg = {}
    }

    const minJudged = cfg.minJudged ?? 6
    let culled = 0
    let synced = 0
    for (const s of await sources.select()) {
        const j = judgeOf(s)
        if (j && ((s.judged || 0) !== j.judged || (s.yielded || 0) !== j.yielded)) {
            await sources.patch(s.id, { judged: j.judged, yielded: j.yielded })
            synced++
        }
        if (s.enabled === false) continue
        if (!j || j.yielded > 0 || j.judged < minJudged) continue
        await sources.patch(s.id, { enabled: false, lastError: `已判定 ${j.judged} 篇產出 0，自動停用` })
        cfg.log?.warn?.(`來源[${s.name}] 已判定 ${j.judged} 篇、產出 0，自動停用`)
        culled++
    }
    return { culled, synced }
}

export default { ensureSeedSources, isLowYield, pickDueSources, recordSourceOutcome, cullZeroYieldSources }
