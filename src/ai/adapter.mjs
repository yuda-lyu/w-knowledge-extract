// adapter.mjs — 內建 AI 調度層(建構於 w-dispatch-ai):鏈組裝、冷卻、健康、計帳、工作流
//
// 【套件內建、設定執行端給】供應商宣告(providerPick/providerTimeouts/名額)與金鑰
//   (envFile)是安裝方資產;鏈組裝/冷卻偵測/健康降序/用量計帳/JSON 搶救是套件能力。
//   工廠化:所有狀態(resolved/store/usage/health/tally/wkf)收在 createAiAdapter 閉包內,
//   同進程可開多個互不相踩的 adapter(測試/多庫)。
//
// 【w-dispatch-ai 件的使用對照】
//   readEnvFile／resolveProviders  經 ai/resolve 單一入口(與 ai/caller 共用):extraProviders 合併、逾時三層取值
//                        寫進 patch(陣列與 table 同源)、env 或 envFile、exes 逐 kind 注入執行檔
//   createFileStore      游標＋冷卻持久化(排除式 passthrough,套件加欄位不必跟版)
//   createUsageCounter   逐日用量計帳(於 onEvent 之 try 事件計)
//   noSideEffectPrefix   防寫檔前綴(修正版:豁免唯讀查閱)
//   salvageTruncatedArray extractJsonLoose 救不回時的截斷搶救(部分接受策略);1.0.37 起 REST 截斷於 validate 之前即判失敗,
//                        callJson 須帶 acceptTruncated:true 才交搶救裁決
//   buildValidator／safeValidate 條目自帶 validate 與本層驗證取交集(同工作流層 1.0.37 起之作法)
//   budgetFor            遞補鏈預算＝timeout 總和(手寫數字會在改 fallback 時失準)
//
// 【事件單一入口】本層之 onEvent 同時做計帳(usage)與健康(providerHealth),單次呼叫與工作流
//   皆掛它;呼叫端要自有回呼(如提煉逐次事件寫日誌)時須轉呼叫 ai.onEvent,否則健康層看不到事件。
// 【狀態檔為行程內單一共享物件】套件文件明載 store「假定單行程序列調用,並行請自行加鎖」
//   (createFileStore.mjs:24、dispatchAiFallback.mjs:241),而本套件 aiParallel 3 批並行、提煉多席位並行:
//   各呼叫各自 get() 取副本再整份 set() 寫回,游標與冷卻互相覆蓋(後寫者勝)。改為 get() 恆回同一物件、
//   各呼叫就地修改、set() 落地同一物件——同行程內不再有失落更新;跨行程(維運工具與排程同時跑)
//   仍為後寫者勝,與套件同一假定。
// 【時間預算】callOpt.budgetMs 與鏈預算取較小者;callOpt.shouldStop 於嘗試之間中止——
//   兩者由階段以 ctx.remainingMs()/ctx.expired() 餵入,使整輪軟性截止對每次 AI 呼叫生效。
// 【啟動期席位檢核】validateSeats:所有名額之 use/fallback 皆須可解析。缺金鑰之條目被 resolveProviders
//   列入 skipped 而不進 table、不拋(resolveProviders.mjs:14),此前要到第一次呼叫 chainFor 才拋——
//   而批次層把拋錯當單批異常,整段每輪靜默不做事;設定錯誤須在啟動期爆。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isstr from 'wsemi/src/isstr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import budgetFor from 'w-dispatch-ai/src/budgetFor.mjs'
import buildValidator from 'w-dispatch-ai/src/buildValidator.mjs'
import { safeValidate } from 'w-dispatch-ai/src/checkTruncation.mjs'
import dispatchAiFallback from 'w-dispatch-ai/src/dispatchAiFallback.mjs'
import dispatchAiWkf from 'w-dispatch-ai/src/dispatchAiWkf.mjs'
import createFileStore from 'w-dispatch-ai/src/wkf/createFileStore.mjs'
import createUsageCounter from 'w-dispatch-ai/src/wkf/createUsageCounter.mjs'
import NO_SIDE_EFFECT from 'w-dispatch-ai/src/wkf/noSideEffectPrefix.mjs'
import extractJsonLoose from 'w-dispatch-ai/src/wkf/extractJsonLoose.mjs'
import salvageTruncatedArray from 'w-dispatch-ai/src/wkf/salvageTruncatedArray.mjs'
import { createProviderHealth } from './providerHealth.mjs'
import { fitChain, maxPromptCharsOf } from './capability.mjs'
import { resolveCatalogue } from './resolve.mjs'

/**
 * 內容型失敗之 errorType:此類失敗之 stdout／stderr 為模型產出(被拒之回覆或 REST 原始本體),不含執行層之限流訊息
 *
 * @type {Set}
 */
const CONTENT_FAIL_TYPES = new Set(['validation', 'incomplete', 'tool-unsupported', 'invalid-response'])

/**
 * 預設冷卻偵測:由結果之 stderr／stdout 判斷是否命中限流字樣
 *
 * 錯誤字樣由觀察維護(套件哲學:不維護簽章表);可由 opt.coolDetect 覆寫。
 * 內容型失敗(見 CONTENT_FAIL_TYPES)與截斷不掃:其輸出是模型對文章的回覆,文章談到 rate limit／quota exceeded
 * 就會誤觸冷卻(2026-09-24 雙審實測);限流訊息只出現在執行層失敗(CLI 之 stderr、REST 之非 2xx 本體)。
 *
 * @param {Object} r 輸入呼叫結果物件，取 errorType、truncated、stderr、stdout
 * @returns {Boolean} 回傳是否命中冷卻字樣
 */
const COOL_DETECT = (r) => {
    if (CONTENT_FAIL_TYPES.has(r?.errorType) || r?.truncated === true) return false
    return /FreeUsageLimitError|rate.?limit|quota exceeded|too many requests/i.test(`${r?.stderr || ''} ${r?.stdout || ''}`)
}

/**
 * 解析 AI 回覆之 JSON:extractJsonLoose 優先,救不回時對陣列輸出做截斷搶救(部分接受策略)
 *
 * @param {String} text 輸入 AI 回覆之原始文字
 * @returns {*} 回傳解析後之資料(物件或陣列)，兩者皆救不回時回傳 salvageTruncatedArray 之結果(可能為 null)
 */
function parseJson(text) {
    const j = extractJsonLoose(text)
    if (j !== null && j !== undefined) return j
    return salvageTruncatedArray(text)
}

/**
 * 由結果物件推出 keyId(供實績彙總與冷卻紀錄)
 *
 * 【為何不能只讀 r.keyId】dispatchAiFallback 的結果頂層只有 providerId 與 keyIndex,
 *   keyId 僅存在於 tried[] 各項;工作流(dispatchAiWkf)的名額結果則另帶 keyId。
 *   只讀 r.keyId 會讓單次呼叫路徑退化成無金鑰索引的 providerId——
 *   「某一把金鑰用盡」與「整個服務停供」在實績摘要上就分不開了。
 *
 * @param {Object} r 輸入呼叫結果物件，取 keyId 或 providerId／keyIndex
 * @returns {String} 回傳 keyId 字串，無 providerId 時回傳空字串
 */
function keyIdOf(r) {
    if (r?.keyId) return r.keyId
    const id = r?.providerId
    if (!id) return ''
    return (r.keyIndex === null || r.keyIndex === undefined) ? id : `${id}#${r.keyIndex}`
}

/**
 * 由遞補歷程(tried)數實際嘗試次數:ok／next-key／skip-group 各為一次真的送出之嘗試(budget-out／aborted 未送出)
 *
 * 【為何不用 r.attempts】遞補層之結果展開自最後一次轉接器結果,其 attempts 是該次轉接器之內部重試數
 *   (maxRetries 0 時恆為 1),不是遞補總嘗試數——試了 3 次仍回 1,與 aiBatchStage 之 aiAttempts
 *   (「含遞補,與用量計帳同義」)不符(2026-09-24 雙審實測)
 *
 * @param {Array} tried 輸入 dispatchAiFallback 結果之 tried 陣列，非陣列視為空
 * @returns {Integer} 回傳實際嘗試次數
 */
function attemptsOf(tried) {
    return (Array.isArray(tried) ? tried : []).filter((t) => t && (t.outcome === 'ok' || t.outcome === 'next-key' || t.outcome === 'skip-group')).length
}

/**
 * 由遞補歷程(tried)取失敗摘要:依序列出非成功項之「金鑰:錯誤型別(耗時)」
 *
 * 【為何需要】全數失敗時頂層 error 只反映最後一次嘗試(例:第一把空正文、第二把以剩餘預算重打而逾時),
 *   只看它會把傳輸問題誤讀成模型太慢;耗時一併列出才分得出「快速失敗」與「空耗一輪逾時」。
 *   無 errorType 者(budget-out／aborted)以 outcome 代之,無耗時者不附。
 *
 * @param {Array} tried 輸入 dispatchAiFallback 結果之 tried 陣列，非陣列視為空
 * @returns {Array} 回傳字串陣列，如 ['p#0:http(1.2s)', 'p:budget-out']
 */
function errorsOf(tried) {
    return (Array.isArray(tried) ? tried : []).filter((t) => t && t.outcome !== 'ok').map((t) => {
        const sec = Number.isFinite(t.durationMs) ? `(${(t.durationMs / 1000).toFixed(1)}s)` : ''
        return `${t.keyId || t.providerId}:${t.errorType || t.outcome}${sec}`
    })
}

/**
 * 條目自帶 validate 時與本層 validate 取交集(兩者皆過才算過)
 *
 * 【為何需要】遞補層以條目覆寫共用選項(attemptOpt＝{ ...共用, ...條目 }),條目自帶之 validate 會整個蓋掉本層之
 *   JSON 驗證,放行非 JSON 回覆而得 ok:true、data:null,批次層隨即因 data 不可迭代而整批異常(2026-09-24 雙審實測)。
 *   做法同 w-dispatch-ai 工作流層(callAiWithFallback 之條目 validate 交集,1.0.37 起)。
 *
 * @param {Object} entry 輸入供應商條目
 * @param {Function} validate 輸入本層驗證函數 (stdout) => Boolean
 * @returns {Object} 回傳條目；條目無有效 validate 時原樣回傳，否則回傳 validate 已取交集之淺拷貝
 */
function intersectEntryValidate(entry, validate) {
    const ev = buildValidator(entry?.validate)
    if (ev === null) return entry
    return { ...entry, validate: (s) => safeValidate(ev, s).pass && validate(s) }
}

/**
 * 建立內建 AI 調度層(鏈組裝、冷卻、健康、計帳、工作流),工廠化:所有狀態收在閉包內,同進程可開多個互不相踩的 adapter
 *
 * @param {Object} opt 輸入設定物件，非物件視為 {} 後由必填檢查拋錯
 * @param {Object} [opt.ai] 輸入 settings.ai 形狀，{ providerPick, providerTimeouts, cooldownMs, maxRetries, healthStreak?, extraProviders?, exes?, providerLimits? }
 * @param {String} [opt.envFile] 輸入金鑰檔絕對路徑(.env；值不進 cfg)，與 env 二擇一
 * @param {Object} [opt.env] 輸入已解析之金鑰物件(變數名 → 逗號分隔金鑰；如 loadSettings 之 st.env、測試替身)
 * @param {Object} [opt.exes] 輸入逐 kind 之 CLI 執行檔絕對路徑對照(亦可放 ai.exes；PATH 不含 npm 全域目錄之排程環境用)
 * @param {String} [opt.stateDir] 輸入狀態目錄字串(游標／用量檔落點)
 * @param {String} [opt.workspace] 輸入 AI 子進程工作目錄字串(與知識庫隔離，防模型順手寫檔)
 * @param {Object} [opt.clock] 輸入 createClock 產物(用量計帳之「今日」判定)
 * @param {Function} [opt.coolDetect] 輸入冷卻偵測函數覆寫，預設 COOL_DETECT(內容型失敗與截斷不掃)
 * @param {Function} [opt.onHealth] 輸入健康層觸發冷卻時之回呼，格式 ({ providerId, streak, errorType, error, keys? }) => void，keys 僅於觸發之組為多金鑰條目且每把皆試過而敗時附上(見 providerHealth)
 * @param {Function} [opt.onOversize] 輸入 prompt 逾長剔除時之回呼，格式 ({ providerId, promptLen, limit }) => void
 * @returns {Object} 回傳 { callJson, getWkf, withBudget, recordCall, drainStats, aiUsageToday, usage, store, chainFor, validateSeats, onEvent, health }
 * @throws {Error} opt 缺 ai／(envFile 或 env)／stateDir／workspace／clock 任一者時拋出;ai.providerPick 含未知 id 時拋出
 */
export function createAiAdapter(opt) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { ai, envFile, env, stateDir, workspace, clock } = opt
    if (!ai || !(envFile || env) || !stateDir || !workspace || !clock) {
        throw new Error('createAiAdapter 需要 { ai, envFile 或 env, stateDir, workspace, clock }')
    }
    const coolDetect = opt.coolDetect || COOL_DETECT

    // ── 展開供應商(ai/resolve 單一入口,與 ai/caller 共用:extraProviders 合併、逾時三層取值寫進 patch 使陣列與 table 同源、
    //    env/envFile 二擇一、exes 逐 kind 注入;理由與殷鑑見該檔檔頭)──
    const { resolved } = resolveCatalogue({
        extraProviders: ai.extraProviders,
        pick: ai.providerPick,
        env,
        envFile,
        exes: opt.exes || ai.exes,
        providerTimeouts: ai.providerTimeouts,
        timeoutMs: ai.timeoutMs,
    })
    if (resolved.missing.length) {
        const hints = Object.entries(resolved.hints || {}).map(([k, v]) => `${k}→${v}`).join('、')
        throw new Error(`ai.providerPick 含未知 id:${resolved.missing.join('、')}(內建目錄與 ai.extraProviders 皆無)${hints ? `；拼寫提示：${hints}` : ''}`)
    }

    // ── 持久化(行程內單一共享狀態物件,見檔頭)、計帳與健康 ──
    const fileStore = createFileStore({ file: path.join(stateDir, 'ai-cursor.json') })
    let shared = null
    const store = {
        file: fileStore.file,
        get: () => {
            if (!shared) shared = fileStore.get(); return shared
        },
        set: (s) => {
            if (!shared) shared = fileStore.get()
            if (s && typeof s === 'object' && s !== shared) Object.assign(shared, s) // 外來副本併入,不整份取代
            fileStore.set(shared)
        },
    }
    const usage = createUsageCounter({ file: path.join(stateDir, 'ai-usage.json'), getDate: () => clock.date8() })
    const cooldownMs = ai.cooldownMs ?? 900_000
    const health = createProviderHealth({ store, threshold: ai.healthStreak, windowMs: cooldownMs, onCool: opt.onHealth })
    // prompt 長度上限之逐 id 覆寫(0/null＝解除);kind 之硬上限見 ai/capability.mjs
    const providerLimits = ai.providerLimits || {}
    const oversizeSeen = new Set()
    /**
     * 逾長剔除之計數與留痕:同一條目只警告一次(每輪一行),其餘只累計,由 drainStats/巡檢彙報
     *
     * @param {String} id 輸入條目 id
     * @param {Integer} promptLen 輸入 prompt 實際字元數
     * @param {Integer} limit 輸入該條目之字元數上限
     * @returns {undefined} 無回傳值
     */
    function noteOversize(id, promptLen, limit) {
        health.noteOversize(id)
        if (oversizeSeen.has(id)) return
        oversizeSeen.add(id)
        opt.onOversize?.({ providerId: id, promptLen, limit })
    }
    /**
     * 統一事件入口:計帳＋健康(呼叫端自有回呼請轉呼叫本函數)
     *
     * @param {Object} ev 輸入 dispatchAiFallback／dispatchAiWkf 之事件物件
     * @returns {undefined} 無回傳值
     */
    const onEvent = (ev) => {
        try {
            usage.onEvent(ev)
        }
        catch { /* 計帳失敗不影響主流程 */ }
        health.onEvent(ev)
    }

    /**
     * 名額規格 { use, fallback } → 條目陣列;引用不存在的 id 拋錯(靜默略過會讓鏈莫名變短)
     *
     * @param {Object} spec 輸入名額規格物件，{ use:String, fallback:Array }
     * @returns {Array} 回傳條目陣列(依序:use 於前,fallback 依序在後)，各項為 { id, ...resolved.table[id] }
     * @throws {Error} spec 缺 use、或引用了不可用(未知或缺金鑰)的 id 時拋出
     */
    function chainFor(spec) {
        const names = [spec?.use, ...(spec?.fallback || [])].filter(Boolean)
        if (!names.length) throw new Error(`名額規格缺 use:${JSON.stringify(spec)}`)
        const bad = names.filter((n) => !resolved.table[n])
        if (bad.length) {
            const sk = new Map((resolved.skipped || []).map((x) => [x.id, x.envVar]))
            const why = bad.map((n) => (sk.has(n) ? `${n}(缺金鑰 ${sk.get(n)})` : n)).join('、')
            throw new Error(`名額引用了不可用的條目:${why}(可用:${Object.keys(resolved.table).join('、')})`)
        }
        return names.map((n) => ({ id: n, ...resolved.table[n] }))
    }

    /**
   * 啟動期席位檢核(檔頭):任一席位不可解析即拋錯,訊息列出席位名與原因(缺金鑰者附環境變數名)。
   *
   * 【能力相容不在此猜】prompt 長度是呼叫當下才知道的事實:此處只擋「整條鏈都有長度上限」
   *   ——那種席位遇到長 prompt 時無處可去,必然整批失敗;首選有上限而遞補無上限者屬正常配置,
   *   由 callJson 依實際長度剔除(見 ai/capability.mjs)。此前以席位名稱是否含 distill 猜測,
   *   關聯席位同樣派給 agy(實測 prompt 4.3 萬字元、每輪 9 次全數 params 失敗)卻查不出來。
   *
   * @param {Object} seats 輸入席位規格物件，{ 席位名: { use, fallback } }
   * @returns {Object} 回傳 { ok:true, warnings:Array }，warnings 為全鏈皆有長度上限之席位提示
   * @throws {Error} 任一席位無法解析(見 chainFor)時拋出，訊息彙整全部問題席位
   */
    function validateSeats(seats) {
        const problems = []
        const warnings = []
        for (const [name, spec] of Object.entries(seats || {})) {
            try {
                const chain = chainFor(spec)
                const limits = chain.map((e) => maxPromptCharsOf(e, providerLimits))
                if (limits.every((n) => Number.isFinite(n))) {
                    warnings.push(`${name} 之全鏈條目皆有 prompt 長度上限（${chain.map((e, i) => `${e.id}≤${limits[i]}`).join('、')}）：prompt 超過時本席位無處可去，整批將失敗；建議遞補鏈至少留一家無上限者`)
                }
            }
            catch (e) {
                problems.push(`${name} → ${e.message}`)
            }
        }
        if (problems.length) throw new Error(`AI 名額於啟動期檢核失敗（${problems.length} 席）：${problems.join('；')}`)
        return { ok: true, warnings }
    }

    // ── 供應商實績彙總(格式對齊日誌之「成交/遞補略過」行)──
    let tally = []
    /**
     * 記錄一次呼叫結果供實績彙總(drainStats)使用
     *
     * @param {Object} r 輸入呼叫結果物件(dispatchAiFallback 之產出)，非物件(假值)不記錄
     * @returns {undefined} 無回傳值
     */
    function recordCall(r) {
        if (!r) return
        // 截斷內容經 acceptTruncated 放行之成功:另計於健康層(進執行摘要 run.json 與巡檢),不當失敗
        if (r.ok && r.truncated === true && r.providerId) health.noteTruncated(String(r.providerId))
        tally.push({ keyId: keyIdOf(r), ok: !!r.ok, skipped: (r.tried || []).filter((t) => t.outcome !== 'ok').map((t) => `${t.keyId || t.providerId}(${t.errorType || t.outcome || '?'})`) })
    }
    /**
     * 彙整並清空實績暫存(供輪末日誌顯示「成交/遞補略過」與健康摘要),呼叫後 tally 歸零
     *
     * @returns {String} 回傳彙整後之一行摘要字串，無呼叫紀錄時回傳「無呼叫」
     */
    function drainStats() {
        const win = {}
        const skip = {}
        for (const c of tally) {
            if (c.ok && c.keyId) win[c.keyId] = (win[c.keyId] || 0) + 1
            for (const s of c.skipped) skip[s] = (skip[s] || 0) + 1
        }
        tally = []
        const w = Object.entries(win).map(([k, n]) => `${k}×${n}`).join(' ')
        const s = Object.entries(skip).map(([k, n]) => `${k}×${n}`).join(' ')
        const h = health.summary(health.snapshot(true))
        return [w && `成交 ${w}`, s && `遞補略過 ${s}`, h].filter(Boolean).join('；') || '無呼叫'
    }

    /**
   * 單次 JSON 任務(含遞補)。回傳形狀＝aiBatchStage 之 callAI 契約,不拋錯——呼叫端只需處理單一失敗形狀:
   * { ok, data, error, skipped, attempts, preview, errors };skipped=true 代表額度/預算(含時間預算)耗盡。
   * REST 截斷(finish_reason=length)經搶救放行者為成功並帶 truncated:true(部分接受,未涵蓋項由批次層記 tries);
   * 條目自帶 validate 者與本層 JSON 驗證取交集(不被覆寫)。
   *
   * @param {String} prompt 輸入提示詞字串，非字串時回傳失敗形狀不呼叫 AI
   * @param {Function} check 輸入驗證函數 (data) => Boolean，判斷解析後之 JSON 是否合格；非函數時回傳失敗形狀不呼叫 AI
   * @param {Object} [callOpt={}] 輸入逐次設定物件，非物件視為 {}
   * @param {Object} [callOpt.spec] 輸入名額規格 { use, fallback }，省略則用建構時之預設鏈(resolved.providers)
   * @param {Number} [callOpt.budgetMs] 輸入本次時間預算毫秒數，與鏈預算(budgetFor)取較小者
   * @param {Function} [callOpt.shouldStop] 輸入中止判斷函數，嘗試之間呼叫以決定是否停止遞補
   * @returns {Promise} 回傳 Promise，resolve 回傳 { ok, data, error, skipped, attempts, preview }；attempts 為實際嘗試次數(含遞補)；
   *   失敗時另帶 errors(各次失敗嘗試之「金鑰:錯誤型別(耗時)」依序陣列，未送出即失敗者為空陣列)；截斷放行之成功另帶 truncated:true
   */
    async function callJson(prompt, check, callOpt = {}) {

        //check
        if (!isstr(prompt) || !isfun(check)) {
            return { ok: false, data: null, error: 'callJson 需要 prompt（字串）與 check（函數）', skipped: false, attempts: 0, preview: '', errors: [] }
        }
        if (!isobj(callOpt)) {
            callOpt = {}
        }

        const chain = callOpt.spec ? chainFor(callOpt.spec) : resolved.providers
        // 能力相容(ai/capability):命令列型供應商有 prompt 長度硬上限,超過即「未執行就失敗」。
        // 呼叫前依實際長度剔除放不下者——此前每次都白付一次 spawn 開銷才落遞補
        const text = NO_SIDE_EFFECT + prompt
        const fit = fitChain(chain, text.length, providerLimits)
        for (const d of fit.dropped) noteOversize(d.id, text.length, d.limit)
        if (!fit.kept.length) {
            return { ok: false, data: null, skipped: false, attempts: 0, preview: '', errors: [], error: `prompt ${text.length} 字元超過本名額全部條目之上限（${fit.dropped.map((d) => `${d.id}≤${d.limit}`).join('、')}）：縮短輸入或於遞補鏈加入無上限之條目` }
        }
        // validate:parseJson(含截斷搶救)＋check;拋錯視同不合格(該家失敗、交遞補),不中斷整條鏈
        const validate = (s) => {
            try {
                const d = parseJson(s)
                return d !== null && d !== undefined && !!check(d)
            }
            catch {
                return false
            }
        }
        const providers = fit.kept.map((e) => intersectEntryValidate(e, validate))
        const cap = Number.isFinite(callOpt.budgetMs) && callOpt.budgetMs > 0 ? callOpt.budgetMs : Infinity
        const r = await dispatchAiFallback(text, {
            providers,
            cwd: workspace,
            validate,
            // 截斷放行:w-dispatch-ai 1.0.37 起 REST 截斷於 validate 之前即判失敗,須明示同意才交 validate 裁決;
            // 本層 validate 內之 parseJson(salvageTruncatedArray)即搶救策略——收前段完整項目,未涵蓋者由批次層記 tries(部分接受)。
            // content_filter 與可見輸出為空者上游仍一律判失敗(checkTruncation.judgeTruncated)
            acceptTruncated: true,
            budgetMs: Math.min(budgetFor(providers), cap),
            maxRetries: ai.maxRetries ?? 0,
            cooldownMs,
            coolDetect,
            store,
            onEvent,
            ...(typeof callOpt.shouldStop === 'function' ? { shouldStop: callOpt.shouldStop } : {}),
        })
        recordCall(r)
        if (!r.ok) {
            const skipped = r.errorType === 'budget' || r.errorType === 'aborted'
            return { ok: false, data: null, error: r.error, skipped, attempts: attemptsOf(r.tried), preview: String(r.stdout || '').slice(0, 120), errors: errorsOf(r.tried) }
        }
        return { ok: true, data: parseJson(r.stdout), error: '', skipped: false, attempts: attemptsOf(r.tried), preview: '', ...(r.truncated === true ? { truncated: true } : {}) }
    }

    /**
     * 今日用量摘要(維運顯示用;providers 供健康檢查判斷鏈韌性)
     *
     * @returns {Object} 回傳 { today, used, byKey, chain, providers, skipped }
     */
    function aiUsageToday() {
        const t = usage.today?.() || {}
        const byKey = t.byKey ?? t ?? {}
        const used = Object.values(byKey).reduce((a, b) => a + (Number(b) || 0), 0)
        const chain = resolved.providers.map((p) => `${p.id}${p.keys ? `×${p.keys.length}` : ''}`).join(' → ')
        return { today: t.today || '', used, byKey, chain, providers: resolved.providers, skipped: resolved.skipped || [] }
    }

    // ── 工作流(distill 用):與單次呼叫共用 store/計帳/冷卻/健康 ──
    let cachedWkf = null
    /**
     * 取得(並快取)工作流物件(distill 用),與單次呼叫共用 store／計帳／冷卻／健康
     *
     * @returns {Object} 回傳 dispatchAiWkf 之產出，同一 adapter 實例內重複呼叫回傳同一份快取
     */
    function getWkf() {
        if (cachedWkf) return cachedWkf
        cachedWkf = dispatchAiWkf({
            providers: resolved.table,
            defaults: {
                cwd: workspace,
                store,
                minAttemptMs: 90_000,
                budgetMs: 420_000, // 保底值;各名額由 withBudget 明給(＝鏈 timeout 總和)
                cooldownMs,
                coolDetect,
                onEvent,
            },
        })
        return cachedWkf
    }

    /**
     * 名額補預算:未給 budgetMs 者以其鏈之 timeout 總和補上(改 fallback 不再需要手動同步)
     *
     * @param {Object} seat 輸入席位規格物件 { use, fallback, budgetMs? }
     * @returns {Object} 回傳補上 budgetMs 後之席位物件(已給 budgetMs 者原樣回傳)
     * @throws {Error} seat 非物件時拋出
     */
    function withBudget(seat) {

        //check
        if (!isobj(seat)) {
            throw new Error('withBudget 需要席位物件 { use, fallback }')
        }

        return seat.budgetMs ? seat : { ...seat, budgetMs: budgetFor(chainFor(seat)) }
    }

    return { callJson, getWkf, withBudget, recordCall, drainStats, aiUsageToday, usage, store, chainFor, validateSeats, onEvent, health }
}

export default createAiAdapter
