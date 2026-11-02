// aiCall.mjs — 提煉各棒之 AI 呼叫之單一包裝:單棒 extractAiCall(整合、審計、修訂、終審、待審裁決、各判定小組之席、修訂席、同義提議)
//   與起草三席 extractFanout,皆經 AI 調度層之工作流入口(getWkf／seatSpec／recordCall)
//
// 【為何只此一份】3+3 之各棒、待審裁決、各判定小組專步與同義專步之呼叫步驟相同;各寫一份即漂移——截止感知之歸類、逐棒日誌與嘗試數、
//   席位未設與放不下之分辨,任一份漏寫即與他棒不一致。
// 【步驟】①給了 shouldStop 而已到點 → 不送(stopped)②席位未設 → 不送(unset;設定之缺漏,與放不下是兩種問題)③seatSpec 依實際提示詞長度
//   預篩遞補鏈,整條放不下 → 不送(oversize)④送出:明給 acceptTruncated:false(差量、裁決與票皆為全有全無之物件,截斷之搶救不適用——給了
//   自訂 parse 時上游之預設為放行)⑤recordCall ⑥onCall(每次送出各一筆逐棒紀錄;回呼拋錯不影響)⑦歸類(見下)。未送出者不呼叫 onCall
//   (沒有棒可記;呼叫端要記者自記)。
// 【onEvent 只於呼叫端明給時轉交】生產之各棒不給——逐棒之紀錄一律於回來後以 onCall 記(上游之工作流以 { ...預設, ...逐次選項 } 合併選項,
//   呼叫端之 onEvent 若未經調度層串接即蓋掉其計帳與健康)。評分(bench/extractBench)要讀調度事件以歸類失敗(冷卻＝限流即停),
//   明給 o.onEvent 才轉交工作流入口:抓取套件之調度層將之串在其事件入口之後(不取代計帳與健康)。
// 【歸類:不是模型之失敗者不計失敗】回 { ok:false, error:'stopped', stopped:true, cause(原錯誤之前 120 字) }:
//   ①截止:給了 shouldStop(截止感知)而未成交,且棒回來時已到點、或預算耗盡(errorType budget)而整輪剩餘不足該席一次最低嘗試(席位之
//     minAttemptMs;未給取 w-dispatch-ai 之預設最低嘗試 20 秒)——否則截止前之瞬間 budget-out 會被當成模型失敗而走降級梯;
//   ②斷網:調度層標 netDown(整鏈皆敗且本機網路不通;另帶 netDown:true)——網路問題不算在這一棒頭上(不計失敗、不計次)。

import { textValueOf as str } from '../core/capturePackage.mjs'

/** 席位未給 minAttemptMs 時之最低嘗試(w-dispatch-ai 之預設最低嘗試;截止歸類用) */
const MIN_ATTEMPT_MS = 20_000
/** 席位未設之錯誤字樣(與放不下之 'oversize' 分開) */
const UNSET_SEAT = '席位未設'


/**
 * 每次嘗試之成交／失敗(遞補鏈逐家;失敗者留原文前 400 字供診斷——否則長時間失敗後落遞補者原因無紀錄)
 *
 * @param {Object} r 輸入呼叫結果(取 tried)
 * @returns {Array} 回傳 [{ id, outcome, errorType, ms, error, finish?, out?, outLen?, err? }]
 * @example
 * console.log(triedOf({ tried: [{ providerId: 'p1', outcome: 'ok', durationMs: 5 }] }))
 * // => [ { id: 'p1', outcome: 'ok', errorType: '', ms: 5, error: '' } ]
 */
export const triedOf = (r) => (Array.isArray(r?.tried) ? r.tried : []).map((t) => ({
    id: t.keyId || t.providerId || '', outcome: t.outcome || '', errorType: t.errorType || '', ms: t.durationMs || 0, error: str(t.error).slice(0, 160),
    ...(t.finishReason ? { finish: t.finishReason } : {}),
    ...(t.outcome !== 'ok' && t.stdout ? { out: String(t.stdout).slice(0, 400), outLen: String(t.stdout).length } : {}),
    ...(t.outcome !== 'ok' && t.stderr ? { err: String(t.stderr).slice(-400) } : {}),
}))

/**
 * 截止之判定(shouldStop／remainingMs 同源;給了 shouldStop 即截止感知)
 *
 * @param {Object} o 輸入 { shouldStop?, remainingMs? }
 * @returns {Object} 回傳 { aware:Boolean, shouldStop:Function, remainingMs:Function }
 */
function deadlineOf(o) {
    const aware = typeof o.shouldStop === 'function'
    return { aware, shouldStop: aware ? o.shouldStop : () => false, remainingMs: typeof o.remainingMs === 'function' ? o.remainingMs : () => Infinity }
}

/**
 * 逐棒紀錄之一筆(onCall 之引數)
 *
 * @param {String} stage 輸入棒名
 * @param {Object} r 輸入呼叫結果
 * @param {Integer} promptLen 輸入提示詞字數
 * @returns {Object} 回傳 { stage, ok, providerId, ms, error, promptLen, tried, netDown(調度層標整鏈皆敗且本機網路不通) }
 */
const entryOf = (stage, r, promptLen) => ({ stage, ok: !!r?.ok, providerId: r?.providerId || '', ms: r?.ms || 0, error: r?.ok ? '' : str(r?.error).slice(0, 200), promptLen, tried: triedOf(r), netDown: r?.netDown === true })

/**
 * 呼叫 onCall(未給略過;回呼拋錯不影響呼叫之結果)
 *
 * @param {Function} [onCall] 輸入回呼
 * @param {Object} entry 輸入逐棒紀錄
 */
function noteOf(onCall, entry) {
    try {
        onCall?.(entry)
    }
    catch { /* 呼叫端回呼失敗不影響 */ }
}

/**
 * 回來之結果是否歸為截止(見檔頭【歸類】)
 *
 * @param {Object} r 輸入呼叫結果
 * @param {Object} seat 輸入席位(取 minAttemptMs)
 * @param {Object} d 輸入 deadlineOf 之產物
 * @returns {Object|null} 回傳截止之結果;非截止回 null
 */
function stoppedOf(r, seat, d) {
    if (r?.ok) return null
    if (r?.netDown === true) return { ok: false, error: 'stopped', stopped: true, netDown: true, cause: str(r?.error).slice(0, 120) }
    const minAttempt = Number(seat?.minAttemptMs) > 0 ? Number(seat.minAttemptMs) : MIN_ATTEMPT_MS
    if (d.aware && (d.shouldStop() === true || (r?.errorType === 'budget' && d.remainingMs() < minAttempt))) return { ok: false, error: 'stopped', stopped: true, cause: str(r?.error).slice(0, 120) }
    return null
}

/**
 * 單棒之呼叫(見檔頭之步驟與歸類)
 *
 * @param {Object} ai 輸入 AI 調度層(getWkf、seatSpec、recordCall?)
 * @param {Object} o 輸入 { stage:棒名(逐棒紀錄用), seat:席位 { use, fallback, timeoutMs?, minAttemptMs?, budgetMs? }, prompt:String, parse:Function, check:Function,
 *   shouldStop?:()=>Boolean(給了即截止感知), remainingMs?:()=>整輪剩餘毫秒(與 shouldStop 同源;未給視為無限), onCall?:(entry)=>void,
 *   onEvent?:(ev)=>void(調度事件;明給才轉交工作流入口,見檔頭) }
 * @returns {Promise<Object>} 回傳工作流 callAi 之結果({ ok, json, providerId, ms, error, errorType?, tried, … });未送出者
 *   { ok:false, error:'stopped', stopped:true }｜{ ok:false, error:'席位未設', unset:true }｜{ ok:false, error:'oversize', oversize:true };
 *   歸為截止者 { ok:false, error:'stopped', stopped:true, cause, netDown? }
 * @example
 * need test in nodejs.
 *
 * let r = await extractAiCall(ai, { stage: 'audit', seat: settings.extract.ai.audit, prompt, parse: parseAudit, check: checkAudit, shouldStop, remainingMs, onCall: (e) => console.log(e.stage, e.ok) })
 * if (r.stopped) return
 */
export async function extractAiCall(ai, o) {
    const d = deadlineOf(o)
    if (d.shouldStop()) return { ok: false, error: 'stopped', stopped: true }
    if (!o.seat) return { ok: false, error: UNSET_SEAT, unset: true }
    const spec = ai.seatSpec(o.seat, o.prompt.length)
    if (!spec) return { ok: false, error: 'oversize', oversize: true }
    const { use, fallback, ...rest } = spec
    const r = await ai.getWkf().callAi(o.prompt, { spec: { use, fallback }, ...rest, parse: o.parse, check: o.check, acceptTruncated: false, shouldStop: d.shouldStop, ...(typeof o.onEvent === 'function' ? { onEvent: o.onEvent } : {}) })
    ai.recordCall?.(r)
    noteOf(o.onCall, entryOf(o.stage, r, o.prompt.length))
    return stoppedOf(r, o.seat, d) || r
}

/**
 * 單棒之呼叫函數(一份;3+3 之各棒、待審裁決、各判定小組專步與同義專步之 call 皆以之組):把每段共同之選項(截止感知、逐棒紀錄、
 *   固定之 parse／check)綁一次,回傳 (stage, seat, prompt, parse?, check?) => extractAiCall 之結果——逐次給了 parse／check 即取代共同者
 *
 * @param {Object} ai 輸入 AI 調度層(getWkf、seatSpec、recordCall?)
 * @param {Object} [common={}] 輸入共同選項 { parse?, check?, shouldStop?, remainingMs?, onCall?, onEvent? }(extractAiCall 之 o,不含 stage／seat／prompt)
 * @returns {Function} 回傳 async (stage, seat, prompt, parse?, check?) => 結果(見 extractAiCall)
 * @example
 * need test in nodejs.
 *
 * let call = callerOf(ai, { shouldStop, remainingMs, onCall })
 * let r = await call('audit', settings.extract.ai.audit, prompt, parseAudit, checkAudit)
 */
export function callerOf(ai, common = {}) {
    return (stage, seat, prompt, parse, check) => extractAiCall(ai, { ...common, stage, seat, prompt, ...(parse === undefined ? {} : { parse }), ...(check === undefined ? {} : { check }) })
}

/**
 * 起草三席(多開;同一份提示詞,三席並行,不進工作流之內建整合——候選交呼叫端之程式處理)
 *
 * @param {Object} ai 輸入 AI 調度層(getWkf、seatSpec、recordCall?)
 * @param {Object} o 輸入 { stages:Array(各席之棒名,與 seats 對齊), seats:Array(席位;未設者不送), prompt, parse, check, shouldStop?, remainingMs?, onCall? }
 * @returns {Promise<Object>} 回傳 { stopped:Boolean(到點而未送), unset:Integer(未設之席數), alive:Integer(送出之席數;0＝皆未設或放不下),
 *   results:[{ k(席之索引), r(該席之結果), stopped:Boolean(歸為截止;見檔頭【歸類】) }](依工作流回傳之序), cut:Integer(歸為截止之席數) }
 * @example
 * need test in nodejs.
 *
 * const r = await extractFanout(ai, { stages: ['draft1', 'draft2', 'draft3'], seats, prompt, parse, check })
 * console.log(r.results.map((x) => x.k), r.cut)
 */
export async function extractFanout(ai, o) {
    const d = deadlineOf(o)
    const seats = Array.isArray(o.seats) ? o.seats : []
    const unset = seats.filter((seat) => !seat).length
    if (d.shouldStop()) return { stopped: true, unset, alive: 0, results: [], cut: 0 }
    const agents = seats.map((seat) => (seat ? ai.seatSpec(seat, o.prompt.length) : null))
        .map((s) => (s ? { use: s.use, fallback: s.fallback, timeoutMs: s.timeoutMs, budgetMs: s.budgetMs, ...(s.minAttemptMs ? { minAttemptMs: s.minAttemptMs } : {}), parse: o.parse, check: o.check, acceptTruncated: false } : null))
    const alive = agents.map((a, k) => ({ a, k })).filter((x) => x.a)
    if (!alive.length) return { stopped: false, unset, alive: 0, results: [], cut: 0 }
    const rA = await ai.getWkf().runFanout({ task: o.prompt, agents: alive.map((x) => x.a), minCandidates: 99, callOpt: { shouldStop: d.shouldStop } })
    const results = (rA.agents || []).map((r, j) => {
        const k = alive[j].k
        ai.recordCall?.(r)
        noteOf(o.onCall, entryOf(Array.isArray(o.stages) ? o.stages[k] : '', r, o.prompt.length))
        return { k, r, stopped: !!stoppedOf(r, seats[k], d) }
    })
    return { stopped: false, unset, alive: alive.length, results, cut: results.filter((x) => x.stopped).length }
}

export default { triedOf, extractAiCall, callerOf, extractFanout }
