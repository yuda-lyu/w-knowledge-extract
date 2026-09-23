// runTask.mjs — 執行一次排程任務之外殼:識別、目錄、日誌開檔、總計時、全域收攔、失敗通知(泛用件,自 tai-news 之執行殼移入)
//
// 【本函數只給外殼,不給步驟】任務內容由呼叫端以單一 run 函數提供。需要「多階段、逐段計時、失敗隔離、提前收工」時,
//   於 run 內改用管道(w-data-pipeline 之 definePipeline／runPipeline,本套件 createKnowledgeExtract().run() 即是)——
//   那是另一層次的秩序,本函數刻意不重覆實作,否則消費端會出現兩套互不相通的階段語意。
//   ※ 原專案之執行端(trigger)仍手寫起訖行,因「知識管線啟動／結束」是 ops/patrol 解析的契約;
//     要改用本函數須連動 patrol 之正則,列為已知不修(2026-09-21)。
//
// 【為何要有這層】排程任務的每一次執行都必須回答三個問題:什麼時候跑的、跑了多久、有沒有成功。
//   這三件事若交由每個專案自行在主流程頭尾手寫,就會出現「有的任務失敗時不寫收尾行」「有的耗時記在 catch 內
//   而失敗時就沒有」這類不一致,讓跨任務的巡檢腳本無法統一解析。
//
// 【為何收尾行寫在 finally】成功與失敗都必須留下「總耗時」,那是巡檢判讀「這次到底有沒有跑完」的唯一錨點;
//   只在成功路徑寫,失敗時的日誌就會沒有結尾,與「執行到一半被強制中止」外觀相同而無法區分。
//
// 【為何 onError 自身失敗只記錄不外拋】失敗通知常走網路(Telegram／webhook),本來就可能失敗。若讓它拋出,
//   原始錯誤會被通知錯誤蓋掉,日誌上只剩「通知失敗」而看不到任務究竟為何失敗。
//
// 【為何不重新拋出錯誤】排程入口通常還要決定離開碼與後續清理,由回傳值表達成敗比以例外中斷更好接。
//   需要非零離開碼時,呼叫端依 r.ok 自行 process.exit 即可。

import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'

/**
 * 執行一次排程任務之外殼:識別、目錄、日誌開檔、總計時、全域收攔、失敗通知
 *
 * 起訖行寫在 finally,成功與失敗都留下「總耗時」,供巡檢判讀「這次到底有沒有跑完」;不重新拋出錯誤,
 * 以回傳值表達成敗;onError 自身失敗只記錄不外拋(避免通知錯誤蓋掉原始錯誤)
 *
 * @param {Object} opt 輸入設定物件
 * @param {Function} opt.run 輸入任務主體 async (ctx) => any,ctx 含 runId／logger／log／logWarn／logError／logFile，必填
 * @param {Object} opt.logger 輸入記錄器(ops/logger 之 createRunLogger／createLogger,或任何具 log／logWarn／logError 或 info／warn／error 者)，必填
 * @param {String} [opt.name='任務'] 輸入任務名稱,用於日誌起始與收尾行
 * @param {String} [opt.runId] 輸入本次執行識別字串;未給時以 getNow() 產生
 * @param {Function} [opt.getNow] 輸入時間戳函數(util/clock 之 getNow／stamp8),runId 未給時必填
 * @param {Array} [opt.ensureDirs=[]] 輸入執行前須確保存在之目錄路徑陣列，非陣列視為空陣列
 * @param {Boolean} [opt.openLog=true] 輸入是否以 runId 呼叫 logger.open 開啟當次日誌檔(logger 無 open 者略過)
 * @param {Function} [opt.onError] 輸入失敗通知函數 async (err, ctx) => void
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok:Boolean, runId:String, durationMs:Number, result:*, error:Error(或 null), logFile:String(或 null) }
 * @throws {Error} 缺 run、缺 logger、或 runId 與 getNow 皆未給時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await runTask({ logger, runId: '20260921120000', run: async (ctx) => { ctx.log('hi'); return 1 } })
 * console.log(r.ok)
 */
export async function runTask(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { run, logger, name = '任務', getNow, openLog = true, onError } = opt
    let { runId, ensureDirs } = opt
    if (!isfun(run)) throw new Error('runTask 需要 run')
    // logger 須具 log 或 info 方法(此前只做 truthy 判斷,傳入字串等值要到第一次記錄才拋原生 TypeError)
    if (!isobj(logger) || !(isfun(logger.log) || isfun(logger.info))) throw new Error('runTask 需要 logger')
    if (!runId) {
        if (!isfun(getNow)) throw new Error('runTask 需要 runId 或 getNow')
        runId = getNow()
    }
    if (!isarr(ensureDirs)) {
        ensureDirs = []
    }

    const log = (m) => (logger.log ? logger.log(m) : logger.info(m))
    const logError = (m) => (logger.logError ? logger.logError(m) : logger.error(m))

    // ensureDirs:於開工前建立;產物目錄不存在時,各步驟才會在寫檔當下失敗,且錯誤指向的是寫檔行而非缺目錄
    for (const d of ensureDirs) fsCreateFolder(d)

    let logFile = null
    if (openLog && typeof logger.open === 'function') logFile = logger.open(runId)

    const ctx = {
        runId,
        logger,
        log,
        logWarn: (m) => (logger.logWarn ? logger.logWarn(m) : logger.warn(m)),
        logError,
        logFile,
    }

    const startTime = Date.now()
    log(`${name}啟動`)

    let ok = false
    let result = null
    let error = null
    try {
        result = await run(ctx)
        ok = true
    }
    catch (err) {
        error = err
        logError(`${name}異常：${err?.message || err}`)
        if (typeof onError === 'function') {
            try {
                await onError(err, ctx)
            }
            catch (err2) {
                logError(`${name}失敗通知也失敗：${err2?.message || err2}`)
            }
        }
    }
    finally {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        log(`${name}完成，總耗時 ${elapsed}s`)
    }

    return { ok, runId, durationMs: Date.now() - startTime, result, error, logFile }
}

export default runTask
