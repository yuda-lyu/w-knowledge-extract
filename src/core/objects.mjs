// objects.mjs — 套件預設提供的四個管線物件:抓取/彙整/關聯/提煉
//
// ════════════════ 分形組裝:物件=子階段序列,子階段=動作鏈 ════════════════
//
// 每個工廠零參數即可用(內建預設子階段與動作鏈);opt 逐層覆寫:
//   opt.stages           整組重排子階段(混入自寫 {name, run(ctx)} 單元)
//   opt.<子階段名>       透傳該子階段工廠(其內 tap/chain/單元 opts)
//   opt.name/onError…    階段契約欄位
//
// 【依賴一律走 ctx.deps】stores/seen/registry/clock/dirs/settings/data/ai/domains
//   由總組裝每輪開啟交入;套件子階段與自寫子階段同一條注入通道。
// 【子階段失敗預設隔離】單一子階段倒了記於 detail、續跑後續子階段;
//   子階段宣告 onError:'abort' 才中止整個物件。四物件本身預設 onError:'continue'
//   (抓取失敗時既有筆記仍應被彙整/關聯/提煉)。
// 【物件 report 形狀】{ ok, stats, detail: <子階段名 → 子階段 report>, summary }——detail 即各子階段
//   report 的對照表,執行摘要(ops/runSummary)據此落地;曾另掛同一份於 sub 鍵,無讀者,已移除。

import isobj from 'wsemi/src/isobj.mjs'
import { stdReport } from './kernel.mjs'
import { stageSeedSync } from '../stages/seedSyncStage.mjs'
import { stageListFetch } from '../stages/listFetchStage.mjs'
import { stageDetailFetch } from '../stages/detailFetchStage.mjs'
import { stageDocMaintain } from '../stages/docMaintainStage.mjs'
import { stageExpand } from '../stages/expandStage.mjs'
import { stageTriage } from '../stages/triageStage.mjs'
import { stageExtract } from '../stages/extractStage.mjs'
import { stageRelate, stageRelationIndex } from '../stages/relateStage.mjs'
import { stageDistill } from '../stages/distillStage.mjs'

/**
 * 彙整物件之平鋪 opts 中,預篩與萃取共用之通用鍵(其餘平鋪鍵只給萃取;預篩專屬設定一律走 opt.triage)
 * callAI＝同一 AI 替身/調度、parallel＝同一併發數、statuses＝同一待處理狀態名
 */
const ORGANIZE_SHARED_KEYS = ['callAI', 'parallel', 'statuses']

/**
 * 階段契約欄位之透傳(name/onError 各工廠給預設,when/timeoutMs/always 原樣透傳)
 *
 * @param {Object} opt 輸入呼叫端之工廠 opt(已由各工廠正規化為物件)
 * @param {Object} defaults 輸入預設值物件
 * @param {String} defaults.name 輸入 name 之預設值
 * @returns {Object} 回傳階段契約欄位物件 { name, onError, when?, timeoutMs?, always? }
 */
const stageFields = (opt, defaults) => ({
    name: opt.name || defaults.name,
    onError: opt.onError || 'continue',
    ...(opt.when !== undefined && { when: opt.when }),
    ...(opt.timeoutMs !== undefined && { timeoutMs: opt.timeoutMs }),
    ...(opt.always !== undefined && { always: opt.always }),
})

/**
 * 子階段序列執行:逐段隔離(失敗記報告續跑;onError:'abort' 才外拋)
 *
 * @param {Array} stages 輸入子階段陣列，各項為 { name, run(ctx), when?, onError? }
 * @param {Object} ctx 輸入管道脈絡(原樣傳遞給各子階段之 run)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { <子階段名>: report }
 * @throws {Error} 子階段宣告 onError:'abort' 且其 run 拋錯時，原錯誤外拋
 */
async function runSubStages(stages, ctx) {
    const reports = {}
    for (const st of stages) {
        if (st.when && !st.when(ctx)) continue
        try {
            reports[st.name] = await st.run(ctx)
        }
        catch (e) {
            reports[st.name] = stdReport({ ok: false, stats: { fail: 1 }, summary: `失敗：${String(e?.message || e).slice(0, 160)}` })
            if (st.onError === 'abort') throw e
            ctx.log.warn(`子階段[${st.name}] 失敗（續跑後續子階段）：${String(e?.message || e).slice(0, 200)}`)
        }
    }
    return reports
}

/**
 * 彙總各子階段之統一核心統計
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @returns {Object} 回傳加總後統計物件 { in, out, skip, fail, aiCalls }
 */
function aggStats(reports) {
    const agg = { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0 }
    for (const r of Object.values(reports)) {
        for (const k of Object.keys(agg)) agg[k] += r?.stats?.[k] || 0
    }
    return agg
}

/**
 * 通用摘要(自組 stages 時用;預設 stages 有各自的 legacy 保真摘要)
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @returns {String} 回傳摘要字串，如「2/3 段完成（in 3、out 3、fail 1）」
 */
function genericSummary(reports) {
    const names = Object.keys(reports)
    const okCount = names.filter((n) => reports[n]?.ok !== false).length
    const a = aggStats(reports)
    return `${okCount}/${names.length} 段完成（in ${a.in}、out ${a.out}、fail ${a.fail}）`
}

/**
 * 失敗的子階段名(摘要不得掩蓋失敗)
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @returns {Array} 回傳 report.ok===false 之子階段名字串陣列
 */
function failedNames(reports) {
    return Object.entries(reports).filter(([, r]) => r?.ok === false).map(([n]) => n)
}

/**
 * 組摘要:全數成功才用 legacy 保真格式(巡檢之正則退路依此解析);
 * 有子階段失敗時一律改走通用摘要並列出失敗者。
 *
 * 【為何不能只看 detail 是否存在】失敗時 stdReport 之 detail 是 {}——truthy,
 *   於是 `d.concepts` 取到 undefined,摘要印成「概念 undefined」而把失敗掩蓋成
 *   看似正常的一行(2026-08-20 實測:提煉段每輪失敗卻只顯示 undefined)。
 * 【部分失敗亦要在人讀路徑看得見】子階段沒倒但 stats.fail>0(批次失敗/未涵蓋/無產出概念)時附註
 *   「｜失敗 N」——此前 fail 只在 report.stats,日誌照印「處理 N、新知識 N…」一字不提(2026-09-12 複審 B7)。
 *   附在句尾不改既有格式,巡檢正則(.*?)不受影響
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @param {Function} legacy 輸入 ()=>String，全數成功時嘗試組 legacy 保真摘要，回空字串則退用通用摘要
 * @returns {String} 回傳摘要字串
 */
function summaryOf(reports, legacy) {
    const failed = failedNames(reports)
    if (failed.length > 0) return `${genericSummary(reports)}｜失敗：${failed.join('、')}`
    const s = legacy() || genericSummary(reports)
    const fail = aggStats(reports).fail
    return fail > 0 ? `${s}｜失敗 ${fail}` : s
}

/**
 * 物件 report(檔頭之形狀)
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @param {String} summary 輸入摘要字串
 * @returns {Object} 回傳物件 report(stdReport 產物):{ ok, stats, detail:reports, summary }
 */
function objectReport(reports, summary) {
    return stdReport({ ok: failedNames(reports).length === 0, stats: aggStats(reports), detail: reports, summary })
}

/**
 * 抓取物件:seedSync → listFetch → detailFetch → docMaintain → expand。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}
 * @param {Array} [opt.stages] 輸入整組重排之子階段陣列(混入自寫 {name, run(ctx)} 單元)，給了即取代下列五個內建子階段
 * @param {Object} [opt.seedSync] 輸入透傳給 stageSeedSync 之 opt
 * @param {Object} [opt.listFetch] 輸入透傳給 stageListFetch 之 opt(filter/toRecord/itemsPerSource 亦供 expand 之 ingest 沿用)
 * @param {Object} [opt.detailFetch] 輸入透傳給 stageDetailFetch 之 opt
 * @param {Object} [opt.docMaintain] 輸入透傳給 stageDocMaintain 之 opt
 * @param {Object} [opt.expand] 輸入透傳給 stageExpand 之 opt
 * @param {String} [opt.name='抓取'] 輸入階段名稱
 * @param {String} [opt.onError='continue'] 輸入階段失敗處置，'continue'／'abort'
 * @returns {Object} 回傳階段物件 { name, onError, run(ctx) }
 */
export function createFetchObject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const lf = opt.listFetch || {}
    const stages = opt.stages || [
        stageSeedSync(opt.seedSync || {}),
        stageListFetch(lf),
        stageDetailFetch(opt.detailFetch || {}),
        stageDocMaintain(opt.docMaintain || {}),
        // 探測入庫與輪抓走同一閘門(stores/ingestGate):安裝方給 listFetch 的 filter/toRecord/itemsPerSource
        // 對探測文件同樣生效;要分開治理時明給 opt.expand.ingest
        stageExpand({ ingest: { filter: lf.filter, toRecord: lf.toRecord, itemsPerSource: lf.itemsPerSource }, ...(opt.expand || {}) }),
    ]
    return {
        ...stageFields(opt, { name: '抓取' }),
        run: async (ctx) => {
            const reports = await runSubStages(stages, ctx)
            // 預設子階段全數成功時輸出 legacy 保真摘要(巡檢之正則退路依此解析逐輪統計)
            const summary = summaryOf(reports, () => {
                const lf = reports.listFetch?.detail
                const df = reports.detailFetch?.detail
                const xp = reports.expand?.detail
                if (!lf || !df) return ''
                return `來源 ${lf.sourcesTried} 個、新文件 ${lf.newDocs}、素材 ${df.filled}、轉錄 ${df.aggregated}、放棄 ${df.dead}` +
          (xp ? `｜線索消化 ${xp.picked}、新來源 ${xp.newSources}` : '')
            })
            return objectReport(reports, summary)
        },
    }
}

/**
 * 彙整物件:triage(預篩:標題＋片段攔下明確無關者)→ extract(放行文件 → md 知識筆記)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}；extract 之 opts 亦可直接平鋪於 opt(見下)
 * @param {Array} [opt.stages] 輸入整組重排之子階段陣列，給了即取代 triage／extract 兩個內建子階段
 * @param {Object} [opt.triage] 輸入透傳給 stageTriage 之 opt(與平鋪之 ORGANIZE_SHARED_KEYS 合併，triage 優先)
 * @param {Object} [opt.extract] 輸入透傳給 stageExtract 之 opt(與平鋪 opts 合併，extract 優先)
 * @param {String} [opt.name='彙整'] 輸入階段名稱
 * @param {String} [opt.onError='continue'] 輸入階段失敗處置，'continue'／'abort'
 * @returns {Object} 回傳階段物件 { name, onError, run(ctx) }
 */
export function createOrganizeObject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    // 平鋪 opts 與 opt.extract 合併(後者優先):插件展開會把 tap 寫進 opt.extract,
    // 若二擇一則平鋪的 callAI/domain 等會在有插件時靜默失效。預篩只吃 opt.triage(＋平鋪之通用鍵 ORGANIZE_SHARED_KEYS)。
    // 【平鋪鍵不可整包灌進預篩】此前 stageTriage({ ...opt, ...opt.triage }) 使萃取專屬之平鋪鍵一併進入預篩:
    //   平鋪 tap(萃取錨點)讓預篩鏈於組裝期拋「無錨點」、平鋪 domain 讓預篩改用萃取 domain(無 reasonOf、prompt 不同)、
    //   平鋪 docsPerBatch/rounds/maxTries 讓預篩批量與輪數被改成萃取的值(2026-09-23 修)
    const shared = {}
    for (const k of ORGANIZE_SHARED_KEYS) {
        if (opt[k] !== undefined) shared[k] = opt[k]
    }
    const stages = opt.stages || [
        stageTriage({ ...shared, ...(opt.triage || {}) }),
        stageExtract({ ...opt, ...(opt.extract || {}) }),
    ]
    return {
        ...stageFields(opt, { name: '彙整' }),
        run: async (ctx) => {
            const reports = await runSubStages(stages, ctx)
            const summary = summaryOf(reports, () => {
                const e = reports.extract?.detail
                const t = reports.triage?.detail
                if (!e) return ''
                // 萃取數字在前(巡檢正則以第一個「（AI N 次）」取萃取呼叫數);預篩附於其後
                return `處理 ${e.processed}、新知識 ${e.notes}、略過 ${e.skipped}、線索 ${e.explore}（AI ${reports.extract.stats.aiCalls} 次）` +
          (t && t.processed > 0 ? `｜預篩 ${t.processed} 篇放行 ${t.relevant}（AI ${reports.triage.stats.aiCalls} 次）` : '')
            })
            return objectReport(reports, summary)
        },
    }
}

/**
 * 關聯物件:relate → relationIndex(僅有新增邊時重建總覽)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}；relate 之 opts 亦可直接平鋪於 opt
 * @param {Array} [opt.stages] 輸入整組重排之子階段陣列，給了即取代 relate／relationIndex 兩個內建子階段
 * @param {Object} [opt.relate] 輸入透傳給 stageRelate 之 opt(與平鋪 opts 合併，relate 優先)
 * @param {Object} [opt.relationIndex] 輸入透傳給 stageRelationIndex 之 opt
 * @param {String} [opt.name='關聯'] 輸入階段名稱
 * @param {String} [opt.onError='continue'] 輸入階段失敗處置，'continue'／'abort'
 * @returns {Object} 回傳階段物件 { name, onError, run(ctx) }
 */
export function createRelateObject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const stages = opt.stages || [
        stageRelate({ ...opt, ...(opt.relate || {}) }), // 平鋪與 opt.relate 合併,理由同彙整物件
        stageRelationIndex(opt.relationIndex || {}),
    ]
    return {
        ...stageFields(opt, { name: '關聯' }),
        run: async (ctx) => {
            const reports = await runSubStages(stages, ctx)
            const summary = summaryOf(reports, () => {
                const r = reports.relate?.detail
                return r ? `處理 ${r.targets}、關聯 ${r.edges} 條、衝突 ${r.conflicts} 組（AI ${reports.relate.stats.aiCalls} 次）` : ''
            })
            return objectReport(reports, summary)
        },
    }
}

/**
 * 提煉物件:distill(概念群 → 核心知識;軟性截止自動接整輪時間預算)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}；distill 之 opts 亦可直接平鋪於 opt
 * @param {Array} [opt.stages] 輸入整組重排之子階段陣列，給了即取代內建之 distill 子階段
 * @param {Object} [opt.distill] 輸入透傳給 stageDistill 之 opt(與平鋪 opts 合併，distill 優先)
 * @param {String} [opt.name='提煉'] 輸入階段名稱
 * @param {String} [opt.onError='continue'] 輸入階段失敗處置，'continue'／'abort'
 * @returns {Object} 回傳階段物件 { name, onError, run(ctx) }
 */
export function createDistillObject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const stages = opt.stages || [stageDistill({ ...opt, ...(opt.distill || {}) })] // 平鋪與 opt.distill 合併,理由同彙整物件
    return {
        ...stageFields(opt, { name: '提煉' }),
        run: async (ctx) => {
            const reports = await runSubStages(stages, ctx)
            const summary = summaryOf(reports, () => {
                const d = reports.distill?.detail
                return d ? `概念 ${d.concepts}、更新 ${d.updated} 則核心（AI ${reports.distill.stats.aiCalls} 次）` : ''
            })
            return objectReport(reports, summary)
        },
    }
}

export default { createFetchObject, createOrganizeObject, createRelateObject, createDistillObject }
