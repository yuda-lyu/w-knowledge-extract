// runtime.mjs — 執行期生效值之單一來源:排程上限、整輪時間預算、執行鎖陳舊期限、鎖檔／金鑰檔／AI 工作區路徑
//
// 【為何獨立成純函數】此前這些值散在 createKnowledgeExtract 各處推導,巡檢設定又以 {...推導值, ...cfg.monitor} 展開,
//   舊名 monitor.scheduleLimitMin 於展開時蓋掉頂層值——管線以頂層 480 分跑、巡檢卻以 60 分判界(安裝方回報、本機重現)。
//   收斂為一份結果,同時餵給管線(deadlineMs／鎖)、巡檢(判界)與 info()(揭露),三者不再各算各的(2026-09-28)。
// 【值有效性】數值鍵一律「有限且大於 0」,數字字串轉數;給了卻無效者視同未給並指名警告——此前 monitor 給字串 '60'
//   使判界門檻成 '6060'、頂層給 0 蓋掉有效之 monitor 值並誤報「未給」(雙審實測)。
// 【鎖之陳舊期限須涵蓋整輪】陳舊期限由持鎖者宣告(core/lock),他實例以它判定是否可接管,故須 ≥ 本輪最長可能耗時:
//   排程上限＋5 分,或時間預算＋安全邊際＋5 分,兩者取大;此前只給 deadlineMs 時仍為 60 分,長時執行 60 分後即被接管。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'

const MIN = 60_000
// 安全邊際:截止只切得到已接上剩餘預算的呼叫;席位預算於開工當下封頂(core/budget),但已開始的那一次
// 嘗試最多再跑到其自身 timeout(現行最大 claude:sonnet 360s),邊際取 6 分鐘涵蓋之;下限 10 分
const DEADLINE_MARGIN_MS = 360_000
const DEADLINE_FLOOR_MS = 600_000
const DEADLINE_DEFAULT_MS = 3000_000
// 執行鎖陳舊期限須大於排程上限:正常但偏慢的執行不可在跑到一半被下一實例判為殘留而搶鎖
const LOCK_STALE_EXTRA_MS = 300_000
const LOCK_STALE_DEFAULT_MS = 3600_000


/**
 * 數值設定之有效性(執行期數值鍵之單一判準,巡檢之 cfg 正規化亦用此):有限且大於 0 者取值,數字字串轉數
 *
 * @param {*} v 輸入設定值
 * @returns {Number} 回傳數值；無效(非數字、非有限、≤0、空字串、其他型別)時回傳 null
 * @example
 * console.log(positiveNumber('60'), positiveNumber(0), positiveNumber('abc'))
 * // => 60 null null
 */
export function positiveNumber(v) {
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
    return Number.isFinite(n) && n > 0 ? n : null
}


/**
 * 數值設定之正規化:未給(undefined／null)與給了卻無效者分開回報
 *
 * @param {*} v 輸入設定值
 * @returns {Object} 回傳 { given:Boolean, value:Number(無效或未給時為 null) }
 */
function posNum(v) {
    if (v === undefined || v === null) return { given: false, value: null }
    return { given: true, value: positiveNumber(v) }
}


/**
 * 設定值之顯示字串(警告訊息用)
 *
 * @param {*} v 輸入設定值
 * @returns {String} 回傳顯示字串:字串加引號、數字與布林原樣、其餘為型別名
 */
function show(v) {
    if (typeof v === 'string') return JSON.stringify(v)
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return Array.isArray(v) ? 'array' : typeof v
}


/**
 * 由整輪時間預算推回該輪之最長可能耗時(分):預算＋安全邊際(已開始之呼叫最多再跑到其自身 timeout)
 *
 * 巡檢判「進行中 vs 被砍」與「耗時逼近上限」時,對只宣告了時間預算之輪次以此為界
 *
 * @param {Number} deadlineMs 輸入整輪時間預算毫秒數
 * @returns {Integer} 回傳分鐘數(無條件進位)；deadlineMs 非有限正數時回傳 null
 * @example
 * console.log(limitMinOfDeadline(3540000))
 * // => 65
 */
export function limitMinOfDeadline(deadlineMs) {
    if (!(Number.isFinite(deadlineMs) && deadlineMs > 0)) return null
    return Math.ceil((deadlineMs + DEADLINE_MARGIN_MS) / MIN)
}


/**
 * 解析執行期生效值(純函數;createKnowledgeExtract 之管線、巡檢與 info() 一律取用其結果)
 *
 * 排程上限:頂層 cfg.scheduleLimitMin 優先,舊名 cfg.monitor.scheduleLimitMin 只在頂層未給(或無效)時作用,兩者皆有效且不同即警告。
 * 時間預算:cfg.deadlineMs 明給者優先,否則由排程上限推導(上限−6 分,下限 10 分),再無則套件預設 50 分。
 * 鎖陳舊期限:cfg.lockStaleMs 明給者優先(小於時間預算＋安全邊際即警告),否則取「上限＋5 分」與「明給之預算＋6 分＋5 分」之大者,皆無則 60 分。
 * 巡檢判界(patrolLimitMin):排程上限,否則由明給之預算推回(預算＋6 分),皆無為 null(巡檢用其預設)
 *
 * @param {Object} cfg 輸入 createKnowledgeExtract 之設定物件，非物件時視為{}
 * @param {Object} ctx 輸入路徑脈絡 { workDir:String, dirs:Object(core/dirs 之 expandDirs 產物) }
 * @returns {Object} 回傳 { envFile:String, aiWorkspace:String(注入 cfg.aiAdapter 時為 null), lockFile:String(cfg.lock 為 false 時為 null),
 *   scheduleLimitMin:Number(未給為 null), patrolLimitMin:Number(未給為 null), deadlineMs:Number, lockStaleMs:Integer, warnings:Array(字串) }
 * @throws {Error} ctx 缺 workDir／dirs、cfg.lock 非 false／true／字串，或 cfg.envFile／cfg.aiWorkspace 給了非字串時拋出
 * @example
 * let r = resolveRuntime({ scheduleLimitMin: 65 }, { workDir: 'c:/kb', dirs: { tmp: 'c:/kb/tmp' } })
 * console.log(r.deadlineMs, r.lockStaleMs, r.lockFile)
 * // => 3540000 4200000 c:/kb/tmp/run.lock
 */
export function resolveRuntime(cfg, ctx) {

    //check
    if (!isobj(cfg)) {
        cfg = {}
    }
    if (!isobj(ctx) || !isestr(ctx.workDir) || !isobj(ctx.dirs)) {
        throw new Error('resolveRuntime 需要 { workDir, dirs }')
    }

    const { workDir, dirs } = ctx
    const warnings = []
    const invalid = (key, v, unit) => warnings.push(`${key} 無效（收到 ${show(v)}；須為大於 0 之${unit}），視同未給`)

    // ── 路徑 ──
    let lockFile
    if (cfg.lock === false) lockFile = null
    else if (cfg.lock === undefined || cfg.lock === null || cfg.lock === true || cfg.lock === '') lockFile = `${dirs.tmp}/run.lock`
    else if (isestr(cfg.lock)) lockFile = cfg.lock
    // 此前 true 原樣傳給取鎖而每輪拋錯(仍照寫摘要與收尾);其餘型別同樣每輪才爆——改為建構期拋錯
    else throw new Error(`cfg.lock 須為 false（不上鎖）、true 或未給（預設 ${dirs.tmp}/run.lock）或鎖檔路徑字串，收到 ${show(cfg.lock)}`)
    if (cfg.envFile && !isestr(cfg.envFile)) throw new Error(`cfg.envFile 須為路徑字串（相對者以 workDir 為基準），收到 ${show(cfg.envFile)}`)
    if (cfg.aiWorkspace && !isestr(cfg.aiWorkspace)) throw new Error(`cfg.aiWorkspace 須為路徑字串，收到 ${show(cfg.aiWorkspace)}`)
    const envFile = cfg.envFile
        ? (path.isAbsolute(cfg.envFile) ? cfg.envFile : `${workDir}/${cfg.envFile}`)
        : `${workDir}/.env`
    // AI 工作區只供內建調度層使用;注入 cfg.aiAdapter 時無此目錄
    const aiWorkspace = cfg.aiAdapter ? null : (cfg.aiWorkspace || `${workDir}/tmp/ai-workspace`)

    // ── 排程上限(頂層優先;舊名只在頂層未給或無效時作用)──
    const top = posNum(cfg.scheduleLimitMin)
    const mon = posNum(isobj(cfg.monitor) ? cfg.monitor.scheduleLimitMin : undefined)
    if (top.given && top.value === null) invalid('cfg.scheduleLimitMin', cfg.scheduleLimitMin, '分鐘數')
    if (mon.given && mon.value === null) invalid('cfg.monitor.scheduleLimitMin', cfg.monitor.scheduleLimitMin, '分鐘數')
    if (top.value !== null && mon.value !== null && top.value !== mon.value) {
        warnings.push(`cfg.scheduleLimitMin（${top.value}）與舊名 cfg.monitor.scheduleLimitMin（${mon.value}）不同，以頂層為準（管線與巡檢皆用 ${top.value} 分）`)
    }
    const scheduleLimitMin = top.value ?? mon.value

    // ── 整輪時間預算 ──
    const dl = posNum(cfg.deadlineMs)
    if (dl.given && dl.value === null) invalid('cfg.deadlineMs', cfg.deadlineMs, '毫秒數')
    const deadlineMs = dl.value ?? (scheduleLimitMin !== null ? Math.max(DEADLINE_FLOOR_MS, Math.round(scheduleLimitMin * MIN) - DEADLINE_MARGIN_MS) : DEADLINE_DEFAULT_MS)
    if (scheduleLimitMin === null && dl.value === null) {
        warnings.push(`未給 scheduleLimitMin 亦未給 deadlineMs，整輪時間預算採套件預設 ${DEADLINE_DEFAULT_MS / MIN} 分（與本安裝端之排程上限無關）`)
    }

    // ── 執行鎖陳舊期限(持鎖者宣告值,須涵蓋本輪最長可能耗時)──
    const ls = posNum(cfg.lockStaleMs)
    if (ls.given && ls.value === null) invalid('cfg.lockStaleMs', cfg.lockStaleMs, '毫秒數')
    const need = Math.max(
        scheduleLimitMin !== null ? Math.ceil(scheduleLimitMin * MIN) + LOCK_STALE_EXTRA_MS : 0,
        dl.value !== null ? Math.ceil(dl.value) + DEADLINE_MARGIN_MS + LOCK_STALE_EXTRA_MS : 0,
    )
    const lockStaleMs = ls.value !== null ? Math.ceil(ls.value) : (need || LOCK_STALE_DEFAULT_MS)
    if (ls.value !== null && lockFile && ls.value < deadlineMs + DEADLINE_MARGIN_MS) {
        warnings.push(`cfg.lockStaleMs（${(ls.value / MIN).toFixed(1)} 分）小於整輪時間預算加安全邊際（${((deadlineMs + DEADLINE_MARGIN_MS) / MIN).toFixed(1)} 分）——偏慢但正常之一輪可能被下一個實例判為陳舊而接管，兩條管線同時寫同一個資料庫`)
    }

    // ── 巡檢判界:排程上限;只給預算者由預算推回;皆無為 null(巡檢用其預設)──
    const patrolLimitMin = scheduleLimitMin ?? (dl.value !== null ? limitMinOfDeadline(dl.value) : null)

    return { envFile, aiWorkspace, lockFile, scheduleLimitMin, patrolLimitMin, deadlineMs, lockStaleMs, warnings }
}


export default resolveRuntime
