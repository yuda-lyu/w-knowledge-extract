// extractObject.mjs — 提煉物件:子階段序列(extract)
//
// ════════════════ 分形組裝:物件=子階段序列,子階段=動作鏈 ════════════════
//
// 工廠零參數即可用(內建預設子階段與動作鏈);opt 逐層覆寫:
//   opt.stages           整組重排子階段(混入自寫 {name, run(ctx)} 單元)
//   opt.extract          透傳提煉子階段工廠(其內 tap/chain/單元 opts;鍵見 EXTRACT_STAGE_KEYS)
//   opt.name/onError…    階段契約欄位
//   其餘平鋪鍵           只給 extract 子階段(與 opt.extract 合併,opt.extract 優先)
//
// 【依賴一律走 ctx.deps】stores/clock/dirs/settings/data/vocab/ai/domains 由總組裝每輪開啟交入;套件子階段與自寫子階段同一條注入通道。
// 【子階段失敗預設隔離】單一子階段倒了記於 detail、續跑後續子階段;子階段宣告 onError:'abort' 才中止整個物件。物件本身預設
//   onError:'continue'(提煉失敗不阻斷同一管線之後段)。
// 【物件 report 形狀】{ ok, stats, detail: <子階段名 → 子階段 report>, summary }——子階段 opts 之合併、子階段序列執行、統計彙總、摘要組裝與
//   物件 report 取自抓取套件之物件共用件(各物件同一份規則);固定格式摘要(extractSummaryOf)為對外契約,見其 JSDoc。
// 【平鋪 tap 與子階段 tap 合併而非覆蓋】呼叫端可能同時給平鋪之 tap 與 opt.extract.tap(兩方各自組 opt 時);二擇一會使其一靜默失效,
//   故以抓取套件之 subOpt 合併(同錨點 before／after 串接,雙方皆 replace 即拋錯)。
// 【錨點於建構期驗】有動作鏈之鍵(EXTRACT_TAP_STAGE_KEYS)之 tap 對不上錨點者,建立物件時即拋——不等到該段開工才發現插件掛不上。

import isobj from 'wsemi/src/isobj.mjs'
import { subOpt, stageFields, runSubStages, summaryOf, objectReport } from './core/capturePackage.mjs'
import { EXTRACT_REPORT_KEYS } from './logContract.mjs'
import { stageExtract } from './stages/extractStage.mjs'
import { extractBenchRoleOf } from './bench/extractBench.mjs'

/**
 * 內建子階段之鍵(依執行順序;亦為 opt.<子階段名> 之可用鍵與物件 report 之 detail 鍵)——即日誌契約之 report 子階段鍵(EXTRACT_REPORT_KEYS.subStages,
 *   同一實體;物件之階段名亦取該契約之 stage,巡檢讀 run.json 時與物件同一份名稱)
 *
 * @type {Array}
 */
export const EXTRACT_STAGE_KEYS = EXTRACT_REPORT_KEYS.subStages

/**
 * 有動作鏈(hook 錨點)之鍵:提煉子階段之鏈(錨點 extract.extract.{loadState, selectNotes, pass, renderState, persistState})——
 *   opt.<鍵>.tap／chain 與總組裝之插件掛載(stageOpts)之可用鍵;由子階段鍵推導(唯一之子階段即有鏈者)
 *
 * @type {Array}
 */
export const EXTRACT_TAP_STAGE_KEYS = Object.freeze([...EXTRACT_STAGE_KEYS])

/**
 * 提煉之固定格式摘要(預設子階段全數成功時):格式為對外契約——外部巡檢之正則退路依「更新 N 則核心」解析逐輪統計,既有段落不動,
 *   新增段落皆 >0 才附
 *
 * 段落(依序;第一段恆在,其餘 >0 才附):
 *   「概念 N、更新 N 則核心、消化 N 篇」｜「、重審 N 篇」「、撤出處 N 篇」「、恢復 N 篇」(出處之沿革)｜
 *   「、爭議覆核 N 則（真對立 a、拆解 b、待判 c、重試 d）」(ES14)｜「、出處支持覆核 N 項（不採 a、判不了 b、修訂後採用 c）」(ES9 新進;
 *   不採與判不了以操作計)｜「、存量覆核 N 條（受支持 a、修訂 b、撤回 c、隔離 d、重試 e）」(ES9 存量)｜「、失撐找支持 N 條（補出處 a、撤回 b、
 *   判不了 c、重試 d）」(ES8)｜「、關聯影響 N 則（…）」(ES10)｜「、同義核對 N 對（…）」(ES11)｜「、降級 N」｜「、截止 N」｜「、超長 a／b 欄」｜
 *   「、絕對語氣 N 條」｜句尾「（AI N 次）」恆在
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @returns {String} 回傳摘要字串；缺 extract 之 detail(或 reports 非物件)時回 ''(由 summaryOf 退用通用摘要)
 * @example
 * let reports = { extract: { stats: { aiCalls: 7 }, detail: { concepts: 2, updated: 1, notesUsed: 5, notesSkipped: 1, orphanChecked: 2, orphanResourced: 1, orphanRetracted: 1 } } }
 * console.log(extractSummaryOf(reports))
 * // => 概念 2、更新 1 則核心、消化 6 篇、失撐找支持 2 條（補出處 1、撤回 1、判不了 0、重試 0）（AI 7 次）
 */
export function extractSummaryOf(reports) {

    //check
    if (!isobj(reports)) {
        return ''
    }

    const d = reports.extract?.detail
    if (!d) return ''
    // 本輪消化篇數(引用＋略過)、超長欄數／受檢欄數(超過篇幅上限而未達兩倍、仍收者;超長率之監測)、絕對語氣條數(新寫主張;以指標呈現)
    const digested = (d.notesUsed || 0) + (d.notesSkipped || 0)
    const over = d.overLimit ? `、超長 ${d.overLimit}／${d.lengthChecked || d.overLimit} 欄` : ''
    const tone = d.absoluteTone ? `、絕對語氣 ${d.absoluteTone} 條` : ''
    const stopped = d.stopped ? `、截止 ${d.stopped}` : '' // 因整輪截止作廢之 pass 數(已成交之棒整份丟棄,下輪重做)
    // 重審篇數(不入「消化」)、撤出處／恢復篇數
    const lineage = `${d.notesRechecked ? `、重審 ${d.notesRechecked} 篇` : ''}${d.withdrawn ? `、撤出處 ${d.withdrawn} 篇` : ''}${d.restored ? `、恢復 ${d.restored} 篇` : ''}`
    // 爭議覆核(檢定標準 ES14;開啟且本輪有受檢者才附)
    const dispute = d.disputeChecked ? `、爭議覆核 ${d.disputeChecked} 則（真對立 ${d.disputeOpposed || 0}、拆解 ${d.disputeDissolved || 0}、待判 ${d.disputeHeld || 0}、重試 ${d.disputeRetry || 0}）` : ''
    // 出處支持覆核(檢定標準 ES9 新進;開啟且本輪有受檢項才附):受檢項;不採、判不了、修訂後採用以操作計
    const support = d.supportChecked ? `、出處支持覆核 ${d.supportChecked} 項（不採 ${d.supportRejected || 0}、判不了 ${d.supportUndetermined || 0}、修訂後採用 ${d.supportRevised || 0}）` : ''
    // 出處支持之存量覆核(檢定標準 ES9 存量;本輪有受檢者才附)
    const stockLine = d.stockChecked ? `、存量覆核 ${d.stockChecked} 條（受支持 ${d.stockSupported || 0}、修訂 ${d.stockRevised || 0}、撤回 ${d.stockRetracted || 0}、隔離 ${d.stockHeld || 0}、重試 ${d.stockRetry || 0}）` : ''
    // 失撐主張之專責佇列(檢定標準 ES8;本輪有受檢者才附)
    const orphan = d.orphanChecked ? `、失撐找支持 ${d.orphanChecked} 條（補出處 ${d.orphanResourced || 0}、撤回 ${d.orphanRetracted || 0}、判不了 ${d.orphanHeld || 0}、重試 ${d.orphanRetry || 0}）` : ''
    // 關聯變更之影響(檢定標準 ES10;開啟且本輪有事件或夥伴入批才附):事件、新增候選、關聯變更重審項、夥伴入批被涵蓋／被引為出處
    const impact = d.impactEvents || d.partnersCovered ? `、關聯影響 ${d.impactEvents || 0} 則（夥伴候選 +${d.impactCandidates || 0}、關聯重審 ${d.impactRecheck || 0}、夥伴入批 ${d.partnersCovered || 0} 篇／被引 ${d.partnersUsed || 0}）` : ''
    // 同義核心核對(檢定標準 ES11;有受檢或待判結案才附):受檢對數、同一概念(待判)、判不了、重試;待判結案(已同鍵或已非主核心)有才附
    const synResolved = d.synonymResolved ? `、待判結案 ${d.synonymResolved}` : ''
    const synonym = d.synonymChecked || d.synonymResolved ? `、同義核對 ${d.synonymChecked || 0} 對（同一概念 ${d.synonymSame || 0}、不同 ${d.synonymDifferent || 0}、判不了 ${d.synonymHeld || 0}、重試 ${d.synonymRetry || 0}${synResolved}）` : ''
    return `概念 ${d.concepts}、更新 ${d.updated} 則核心、消化 ${digested} 篇${lineage}${dispute}${support}${stockLine}${orphan}${impact}${synonym}${d.degraded ? `、降級 ${d.degraded}` : ''}${stopped}${over}${tone}（AI ${reports.extract.stats?.aiCalls ?? 0} 次）`
}

/**
 * 提煉物件:extract(選題 → 並行逐核心之待審裁決、整併、3+3 提煉批次×追趕、各檢定標準之專步 → 軟性截止;時間預算接整輪)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}；extract 子階段之 opts 亦可直接平鋪於 opt(見檔頭)
 * @param {Array} [opt.stages] 輸入整組重排之子階段陣列，給了即取代內建之 extract 子階段
 * @param {Object} [opt.extract] 輸入透傳給 stageExtract 之 opt(與平鋪 opts 合併，opt.extract 優先；tap 則與平鋪之 tap 合併)
 * @param {String} [opt.name] 輸入階段名稱，未給則取日誌契約之階段名(EXTRACT_REPORT_KEYS.stage,「提煉」)
 * @param {String} [opt.onError='continue'] 輸入階段失敗處置，'continue'／'abort'
 * @returns {Object} 回傳階段物件 { name, onError, when?, timeoutMs?, always?, run(ctx) }
 * @throws {Error} 平鋪 tap 與 opt.extract.tap 同錨點皆給 replace、或 tap 對不上錨點時拋出
 * @example
 * need test in nodejs.
 *
 * let obj = createExtractObject({ extract: { parallel: 2 } })
 * console.log(obj.name)
 * // => 提煉
 */
export function createExtractObject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    // 評比角色(提示詞指紋之來源)由本根檔注入提煉段:stages 層不取葉(bench),經 opt.benchRoleOf 取角色;自訂 opt.stages 者不經此
    const stages = opt.stages || [stageExtract({ benchRoleOf: extractBenchRoleOf, ...subOpt(opt, opt.extract, 'extract.extract') })]
    return {
        ...stageFields(opt, { name: EXTRACT_REPORT_KEYS.stage }),
        run: async (ctx) => {
            const reports = await runSubStages(stages, ctx)
            return objectReport(reports, summaryOf(reports, () => extractSummaryOf(reports)))
        },
    }
}

export default createExtractObject
