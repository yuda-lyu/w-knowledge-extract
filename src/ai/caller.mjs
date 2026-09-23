// caller.mjs — AI 呼叫器:把設定轉成 w-dispatch-ai 要的形態、注入狀態持久化與用量記錄,回傳套件原始結果
//   (泛用件,自 tai-news 之執行殼移入;契約與 ai/adapter 不同,見下)
//
// 【與 ai/adapter 的分工】adapter 是本套件批次管線的 JSON 任務層:強制 JSON、截斷搶救(部分接受)、供應商健康降序、
//   能力相容預篩、輪末彙總;pick 含未知 id 於建構期拋錯(整輪不執行——批次層把拋錯當單批異常而靜默做事最糟)。
//   本檔是「原始遞補呼叫」:validate 由呼叫端逐次給(字串規則或函數)、回傳 dispatchAiFallback 原始結果
//   (stdout／tried／usage／providerId／keyIndex／durationMs),供 logAiOutcome 逐次渲染;pick 含未知 id 只回報
//   providersMissing 不拋——由呼叫端以 ERROR 記(tai-news 契約)。兩種語意各自服務不同消費端,刻意並存;
//   目錄展開則共用 ai/resolve,不再各寫一份。
//
// 【本函數只做接線,不做策略】多供應商遞補、群組優先序、組內金鑰輪替、失敗分流、時間預算、冷卻降序,全部由
//   dispatchAiFallback 負責。「用哪幾家、什麼順序、逾時多少」是消費端的決策,一律由參數傳入,本層不預設值。
//
// 【為何條目定義取自套件目錄而非各專案手抄】模型改版、baseURL 變更、新參數都得兩邊同步,漏一邊就會出現「套件說可用、
//   專案卻用舊設定」的難查落差。故條目定義以 providers.mjs 為單一來源,消費端只表達 pick;要補條目走 extraProviders。
//
// 【條目於建構時解析一次,非逐次呼叫解析】排程任務為短生命行程,設定於行程內不變。若消費端是長駐行程且要熱更新
//   金鑰／pick,應重建 caller——這是本函數的明文契約。
//
// 【為何 missing 與 skipped 要分開回報】skipped:缺對應環境變數而停用,屬「暫時少一層備援」,記 WARN 即可。
//   missing:pick 到目錄裡不存在的 id,屬設定錯誤(打錯字或套件改名),它不會自行恢復且會讓遞補鏈默默少一層,
//   混在 WARN 裡容易被當成常態雜訊略過,故分開回傳由呼叫端以 ERROR 記錄(hints 附最接近之 id)。

import isobj from 'wsemi/src/isobj.mjs'
import dispatchAiFallback from 'w-dispatch-ai/src/dispatchAiFallback.mjs'
import { resolveCatalogue } from './resolve.mjs'

/**
 * 建立「原始遞補呼叫」之 AI 呼叫器:把設定轉成 w-dispatch-ai 要的形態、注入狀態持久化與用量記錄,回傳套件原始結果
 *
 * 與 ai/adapter 分工見檔頭:本函數只做接線,不做策略——多供應商遞補、群組優先序、組內金鑰輪替、失敗分流、時間預算、
 * 冷卻降序,全部由 dispatchAiFallback 負責。條目於建構時解析一次,非逐次呼叫解析(見檔頭)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Array} [opt.pick] 輸入供應商 id 陣列，順序即遞補優先序
 * @param {Object} [opt.env] 輸入金鑰來源物件(變數名 → 逗號分隔之金鑰字串)，與 envFile 二擇一，皆無則用 process.env
 * @param {String} [opt.envFile] 輸入 .env 路徑字串
 * @param {Array} [opt.catalogue] 輸入供應商目錄，預設 w-dispatch-ai 之 providers.mjs
 * @param {Array} [opt.extraProviders] 輸入安裝方自帶條目陣列(同 id 覆蓋內建)
 * @param {Object} [opt.exes] 輸入各 kind 之執行檔絕對路徑對照(透傳 resolveProviders)
 * @param {Object} [opt.patch] 輸入各 id 之欄位覆寫對照(透傳 resolveProviders，於 exes 之後施作)
 * @param {Object} [opt.providerTimeouts] 輸入逐 id 逾時對照(寫進條目；見 ai/resolve)
 * @param {Integer} [opt.timeoutMs] 輸入單次嘗試逾時毫秒數(可於 callAI 逐次覆寫)
 * @param {Integer} [opt.maxRetries] 輸入同家重試次數，韌性建議交給換家，預設沿用套件之 0
 * @param {Integer} [opt.budgetMs] 輸入單輪遞補之時間上限毫秒數
 * @param {Integer} [opt.minAttemptMs] 輸入開工門檻毫秒數:剩餘預算低於此值即不再開新嘗試
 * @param {Integer} [opt.cooldownMs] 輸入供應商冷卻視窗毫秒數(0 或省略為不啟用)
 * @param {Function} [opt.coolDetect] 輸入冷卻觸發之額外判定函數
 * @param {String} [opt.cwd] 輸入子進程工作目錄字串
 * @param {Object} [opt.store] 輸入狀態持久化物件(建議 w-dispatch-ai 之 createFileStore)
 * @param {Function} [opt.onUsage] 輸入用量回調，格式 (providerId) => void，於每次實際嘗試時觸發
 * @param {Function} [opt.onEvent] 輸入事件回調，格式 (ev) => void
 * @returns {Object} 回傳 { callAI:Function, providers:Array, skipped:Array<String>, missing:Array<String>, hints:Object }
 */
export function createAiCaller(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const {
        pick, env, envFile, catalogue, extraProviders, exes, patch, providerTimeouts,
        timeoutMs, maxRetries, budgetMs, minAttemptMs, cooldownMs, coolDetect, cwd, store, onUsage, onEvent,
    } = opt

    const { resolved } = resolveCatalogue({ catalogue, extraProviders, pick, env, envFile, exes, patch, providerTimeouts, timeoutMs })
    const { providers, skipped, missing, hints } = resolved

    // skippedText:供日誌直接顯示(缺哪個變數才是可行動的資訊,只給 id 無從處理)
    const skippedText = skipped.map((s) => `${s.id}（${s.envVar} 無金鑰）`)

    /**
   * 呼叫 AI,依 pick 順序自動遞補
   *
   * @param {String} prompt 輸入提示詞字串
   * @param {Object} [o={}] 輸入逐次設定物件，非物件視為 {}；可覆寫 timeoutMs、validate,並可加掛 onEvent
   * @returns {Promise} 回傳 Promise，resolve 回傳套件結果物件(另補 providersSkipped 與 providersMissing)
   */
    const callAI = async (prompt, o = {}) => {

        //check
        if (!isobj(o)) {
            o = {}
        }

        // 無可用條目:回與套件同形之失敗結果,讓呼叫端只需處理一種形狀
        if (providers.length === 0) {
            return {
                ok: false,
                stdout: '',
                stderr: '',
                code: null,
                durationMs: 0,
                attempts: 0,
                error: `無可用的 AI 供應商${skippedText.length ? `（${skippedText.join('、')}）` : ''}`,
                tried: [],
                providersSkipped: skippedText,
                providersMissing: missing,
            }
        }

        const r = await dispatchAiFallback(prompt, {
            providers,
            timeoutMs: o.timeoutMs ?? timeoutMs,
            validate: o.validate,
            maxRetries,
            budgetMs,
            minAttemptMs,
            cooldownMs,
            coolDetect,
            cwd,
            store,
            onEvent: (ev) => {
                // 用量按「實際嘗試」入帳(純觀測,不參與任何判斷)
                if (ev?.type === 'try' && ev.providerId && typeof onUsage === 'function') onUsage(ev.providerId)
                if (typeof onEvent === 'function') onEvent(ev)
                if (typeof o.onEvent === 'function') o.onEvent(ev)
            },
        })

        // 因缺金鑰而未納入輪替者一併帶回,否則呼叫端看不出少了備援
        if (skippedText.length) r.providersSkipped = skippedText
        if (missing?.length) r.providersMissing = missing
        return r
    }

    return { callAI, providers, skipped: skippedText, missing, hints }
}

export default createAiCaller
