// aiBatchStage.mjs — 批次 AI 處理的泛用 harness（萃取與關聯共用的核心機制）
//
// 【這是本套件抽提價值最高的一塊】extract 與 relate 在原專案是兩份平行實作，
//   實際共用同一套來之不易的機制（皆為實戰教訓的結晶）：
//   ①「部分接受」——只要求至少一項結構完整即接受，截斷造成的半截項目略過、
//     未涵蓋者留佇列下輪換批次組合再試（全有全無實測失敗率 26%，每敗白耗 3 請求）；
//   ②「同 index 去重」——模型偶爾重複輸出同一項，取第一個；
//   ③「隊頭防阻塞」——失敗批次記 tries 降序排到隊尾，達上限出隊，
//     否則某批令模型反覆截斷時會永遠擋死整條線、每輪白燒全部額度；
//   ④「輪次 × 併發」——單呼叫 1.5~5 分鐘，串行讓排程時窗大半閒置；
//     各批項目由一次取足後切分，彼此不重疊，寫入互不干擾；
//   ⑤「額度中止與零進度守門」——額度用盡（skipped）中止後續輪；
//     整輪全數掛零則停損（下一輪大概率挑到同一批再敗）。
//
// 【prompt 與逐項處置由執行端注入】機制與內容分離：本檔不認識任何領域欄位。

import { chunk } from 'lodash-es'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'

/**
 * 執行一個「批次 AI 處理」階段。
 *
 * @param {Object} cfg 輸入設定物件(必填)
 * @param {Function} cfg.pickPool 輸入取待處理池之函數，簽名 (limit:Number)=>Promise<Array>(呼叫端負責排序：tries 前置)
 * @param {Integer} cfg.batchSize 輸入每批項目數，須為正整數
 * @param {Integer} cfg.parallel 輸入每輪並行批數，須為正整數
 * @param {Integer} cfg.rounds 輸入輪數，須為非負整數
 * @param {Function} cfg.buildPrompt 輸入組單批 prompt 之函數，簽名 (batch:Array)=>Promise<String>（async 允許——可查詞彙表）
 * @param {Function} cfg.checkResult 輸入 AI 回傳整體驗證函數，簽名 (data:*, batch:Array)=>Boolean（部分接受語意：至少一項完整）
 * @param {Function} cfg.isValidItem 輸入單項結構完整性函數，簽名 (item:*, batch:Array)=>Boolean
 * @param {Function} cfg.indexOf 輸入取項目對應之批內編號函數，簽名 (item:*)=>Number(1-based)
 * @param {Function} cfg.callAI 輸入 AI 呼叫函數，簽名 (prompt:String, check:Function)=>Promise<{ok,data,error,skipped,attempts,preview}>
 * @param {Function} cfg.applyItem 輸入套用單一完整項目之函數，簽名 (item:*, target:*, helpers:Object)=>Promise<Object>
 *        （寫檔／入庫／改狀態全在執行端；回傳計數併入 stats.applied）
 * @param {Function} cfg.onMissed 輸入處理未被涵蓋項目之函數，簽名 (target:*, tries:Number, helpers:Object)=>Promise<void>
 *        （記 tries／達上限出隊——由執行端決定欄位與狀態）
 * @param {Function} [cfg.onBatchFailed] 輸入整批失敗時(非額度問題)的處置函數，簽名 (targets:Array, error:Object, helpers:Object)=>Promise<void>；
 *        非函數視為未給，僅記日誌
 * @param {Function} [cfg.shouldStop] 輸入時間預算守門函數，簽名 ()=>Boolean：每輪開工前詢問，回 true 即不再開新輪
 *        （進行中的批次跑完；未取件者原樣留佇列）。非函數視為未給。此前 rounds 迴圈不看剩餘時間，
 *        整輪軟性截止（deadlineMs）對萃取／關聯形同虛設（2026-09-09 實測整輪 3200s > 截止 3000s）
 * @param {Object} cfg.log 輸入 logger 物件，需具 info／warn 方法
 * @returns {Promise} 回傳 Promise，resolve 回傳 {rounds, batches, aiCalls, aiAttempts, applied, aborted, stopped, failedBatches, missed}
 *        aiCalls＝批次(任務)數；aiAttempts＝實際嘗試數(含遞補與重試,與用量計帳同義)；
 *        aborted＝額度／預算用盡中止；stopped＝shouldStop 守門停止；failedBatches／missed 供階段 report 之 fail 統計
 *        (預算／額度中止之批次不計 failedBatches——它不是這批的失敗,另由 aborted/stopped 表達)
 * @throws {Error} cfg 非物件、必要函數缺席、batchSize／parallel 非正整數、rounds 非非負整數，或 log 缺 info/warn 函數時拋出
 */
export async function runAiBatchStage(cfg) {

    //check
    if (!isobj(cfg)) {
        throw new Error('runAiBatchStage 需要 cfg 物件')
    }
    for (const name of ['pickPool', 'buildPrompt', 'callAI', 'checkResult', 'isValidItem', 'indexOf', 'applyItem', 'onMissed']) {
        if (!isfun(cfg[name])) {
            throw new Error(`runAiBatchStage 需要 ${name} 函數`)
        }
    }
    let batchSize = cfg.batchSize
    if (!ispint(batchSize)) {
        throw new Error('runAiBatchStage 需要 cfg.batchSize 正整數')
    }
    batchSize = cint(batchSize)
    let parallel = cfg.parallel
    if (!ispint(parallel)) {
        throw new Error('runAiBatchStage 需要 cfg.parallel 正整數')
    }
    parallel = cint(parallel)
    let rounds = cfg.rounds
    if (!isp0int(rounds)) {
        throw new Error('runAiBatchStage 需要 cfg.rounds 非負整數')
    }
    rounds = cint(rounds)
    if (!isobj(cfg.log) || !isfun(cfg.log.info) || !isfun(cfg.log.warn)) {
        throw new Error('runAiBatchStage 需要 cfg.log（具 info/warn 函數）')
    }

    const log = cfg.log
    const stat = { rounds: 0, batches: 0, aiCalls: 0, aiAttempts: 0, applied: {}, aborted: false, stopped: false, failedBatches: 0, missed: 0 }
    const bump = (obj) => {
        for (const [k, v] of Object.entries(obj || {})) {
            if (typeof v === 'number') stat.applied[k] = (stat.applied[k] || 0) + v
        }
    }
    const shouldStop = typeof cfg.shouldStop === 'function' ? cfg.shouldStop : null
    const onBatchFailed = typeof cfg.onBatchFailed === 'function' ? cfg.onBatchFailed : null

    for (let round = 0; round < rounds; round++) {
        if (shouldStop && shouldStop() === true) {
            stat.stopped = true
            log.warn(`批次：逾時間預算，第 ${round + 1}/${rounds} 輪起不再開工（未取件者留佇列）`)
            break
        }
        const pool = await cfg.pickPool(batchSize * parallel)
        if (pool.length === 0) break
        stat.rounds++
        const batches = chunk(pool, batchSize)

        const results = await Promise.all(batches.map(async (batch) => {
            const r0 = { progressed: 0, aborted: false }
            try {
                stat.batches++
                stat.aiCalls++
                const prompt = await cfg.buildPrompt(batch)
                const r = await cfg.callAI(prompt, (d) => cfg.checkResult(d, batch))
                stat.aiAttempts += Math.max(1, Number(r?.attempts) || 0) // 實際嘗試次數(含遞補),與用量計帳同義;aiCalls 為任務數
                if (!r.ok) {
                    // 額度／時間預算用盡(skipped)不是這批的失敗:另有 aborted/stopped 欄位,fail 不再吸收它(複審 B10)
                    if (!r.skipped) stat.failedBatches++
                    log.warn(`批次 AI 失敗（${r.error}，試 ${r.attempts ?? '?'} 次）→ ${r.preview || ''}`)
                    // 額度用盡（skipped）不記 tries：這不是這批的錯，重排只會冤枉無辜批次
                    if (!r.skipped && onBatchFailed) await onBatchFailed(batch, r, {})
                    r0.aborted = !!r.skipped
                    return r0
                }

                // 部分接受：只採用結構完整的項目；同 index 重複取第一個
                const covered = new Set()
                for (const item of r.data) {
                    if (!cfg.isValidItem(item, batch) || covered.has(cfg.indexOf(item))) continue
                    covered.add(cfg.indexOf(item))
                    const target = batch[cfg.indexOf(item) - 1]
                    if (!target) continue
                    bump(await cfg.applyItem(item, target, {}))
                    r0.progressed++
                }
                // 未被涵蓋者（模型截斷在它們之前）交執行端記 tries／出隊
                const missed = batch.filter((_, i) => !covered.has(i + 1))
                stat.missed += missed.length
                for (const t of missed) await cfg.onMissed(t, {})
                if (missed.length > 0) {
                    log.info(`批次：${batch.length} 項中 ${covered.size} 項完整、${missed.length} 項未涵蓋（留佇列下輪）`)
                }
            }
            catch (e) {
                // 例外仍落帳(與 !r.ok 分支對稱):此前只記日誌——該批全部項目不記 tries、不出隊,
                // 下輪 pickPool 取到同一批再拋,永久空轉且 report 之 fail 不含它(2026-09-12 複審 A2)
                stat.failedBatches++
                log.warn(`批次異常：${e.message}`)
                if (onBatchFailed) {
                    try {
                        await onBatchFailed(batch, { ok: false, error: String(e?.message || e), skipped: false }, {})
                    }
                    catch (e2) {
                        log.warn(`批次異常之落帳失敗：${e2.message}`)
                    }
                }
            }
            return r0
        }))

        if (results.some((x) => x.aborted)) {
            stat.aborted = true; break
        }
        // 零進度守門：本輪全數掛零＝下一輪大概率挑到同一批再敗，停損不空燒
        if (results.every((x) => x.progressed === 0)) break
    }
    return stat
}

export default runAiBatchStage
