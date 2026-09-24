// providerHealth.mjs — 供應商健康層:連續失敗即降序(冷卻)、成功即復原;本檔為此決定之唯一擁有者
//
// 【為何需要】w-dispatch-ai 的內建冷卻只認 HTTP 429 與逾時(dispatchAiFallback 之「冷卻觸發」段),
//   輸出驗證失敗(OUTPUT_VALIDATION_FAILED,整組跳過)與 CLI 執行失敗(非零離開碼,換金鑰或單一登入態)皆不冷卻——
//   主力供應商進入失敗風暴時,每一批仍先在它身上耗掉一次完整回應時間才遞補。
//   2026-09-09 08:00～11:00 生產實測:gemini 每輪驗證失敗 10～22 次(exec 風暴 16 次),
//   成交全落 claude:sonnet,彙整段由 350s 暴增至 1650～1745s,整輪 3200s 逼近排程上限被砍。
//
// 【判準:連續 N 次(預設 3)失敗 → 冷卻】單次驗證失敗是常態(各家 1.8～30%),
//   立即冷卻會讓主力被正常波動反覆踢下;連續 3 敗在 <30% 失敗率下機率 <3%,
//   而風暴期(>90%)幾乎必達。成功一次即歸零(與套件「任一次成功即解除冷卻」同語意)。
//
// 【冷卻的實作沿用套件機制,不另建鏈序】把 providerId 寫進 store 之 state.cooling,
//   下一次 dispatchAiFallback 讀 store 即以 reorderByCooling 將其降至鏈尾(只降序不移除,
//   前面全敗仍會試到它;逾 cooldownMs 自動解除)。單次呼叫路徑(extract/relate)與工作流路徑
//   (distill)共用同一個 store,故一處寫入兩處生效。
//   競態:套件各呼叫持有各自讀入的 state 副本並整份寫回,可能蓋掉本層剛寫的 cooling——
//   本層於該供應商每次再失敗時重新斷言(streak 未歸零即再寫),失效窗口至多一次呼叫;
//   與套件自述之「假定單行程序列調用、並行請自加鎖」同一假定,本套件既有 aiParallel 3 已承擔此假定。
//
// 【哪些失敗計入(2026-09-24 改)】
//   ①型別:除 params 外一律計入(排除清單 IGNORE_TYPES)。此前為白名單,上游 1.0.37／1.0.38 兩度新增或改型錯誤型別
//     (截斷 incomplete、工具不支援 tool-unsupported、本體非 JSON 之 invalid-response)而白名單未同步,這些失敗靜默不計;
//     排除式使上游日後新增之型別預設計入,誤計之代價僅為降序一個冷卻窗(不移除)。
//     params(進入執行前即被擋,如 agy 之 prompt 長度上限)不計 streak:那是席位設定與供應商能力不相容,
//     不會因冷卻而改善,故另計 mismatch 供執行摘要與巡檢揭露(2026-09-06～09-09 每輪固定 6 次)。
//   ②事件:以 w-dispatch-ai 1.0.39 起之 group-exhausted(一組試完仍無成交)計——上游每次呼叫每組恰發一次,位於該組最後
//     一個 next-key／skip-group 之後;成交、組內預算用盡、中止之組不發。故無金鑰輪替(CLI 登入態、無金鑰之 REST)、單把、
//     多把金鑰一律同一規則:每收到一次計一次。一把失敗而他把成交之呼叫不會有此事件,「單把額度用盡」自然不當整家故障;
//     組內預算用盡者後段金鑰從未被試,亦不會有此事件。next-key／skip-group 只記失敗型別次數(執行摘要與巡檢讀),不動 streak。
//     本組各次嘗試之型別(ev.errorTypes)皆在排除清單者(如全為 params)不計;混合者以最後一個計入型別為本次之型別。
//   ③為何不自行由逐次事件重建「一次呼叫整組皆敗」:逐次事件不帶呼叫識別,而同一 onEvent 由並行呼叫共用(批次 aiParallel、
//     提煉多席位)。以失敗事件數計,一把死、一把活的條目在並行下會把同一把死金鑰的多次失敗誤算成整組皆敗(2026-09-24 雙審
//     實測:6 個呼叫全數成功仍被冷卻);改以「各把失敗次數之最小值」計圈數,在並行呼叫跨越一次成交時(游標只在成交時推進,
//     在途呼叫與新呼叫起點不同)仍多計或少計 1 次(同日以真實 dispatchAiFallback 重現),且須照抄上游之游標推進時機、
//     每把至多一次、金鑰濾法。組邊界只有上游知道,故由上游提供事件(1.0.39),本層按事件計數即精確。
//     消費之事件須來自 w-dispatch-ai ≥1.0.39(本套件 package.json 已要求);更舊之版本不發 group-exhausted,本層將永不降序。
//
// 【截斷放行(truncated)另計】經 acceptTruncated 放行之截斷內容屬成功(部分進度)、歸零 streak;由 adapter 呼叫
//   noteTruncated 另計次數,性質同 oversize(機制在運作而非失敗),供執行摘要與巡檢揭露放行頻率。

import isobj from 'wsemi/src/isobj.mjs'

/**
 * 不計入 streak 之 errorType(排除清單;取自 w-dispatch-ai getErrorType 值域,其餘型別一律計入,理由見檔頭)
 *
 * @type {Set}
 */
const IGNORE_TYPES = new Set(['params'])

/**
 * 建立供應商健康層:連續失敗即降序(冷卻)、成功即復原;本模組為此決定之唯一擁有者
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Object} [opt.store] 輸入 w-dispatch-ai store 物件 { get, set }，缺則只統計不冷卻
 * @param {Integer} [opt.threshold=3] 輸入連續失敗幾次即冷卻之正整數，預設3
 * @param {Integer} [opt.windowMs=900000] 輸入冷卻視窗毫秒數正整數(＝ai.cooldownMs)，預設900000；已冷卻且未逾窗者不重寫
 * @param {Function} [opt.onCool] 輸入觸發冷卻時之回呼，格式 (ev)=>void，ev 為 { providerId, streak, errorType, error, keys? }，keys 僅於觸發之組為多金鑰條目且每把皆試過而敗(attempted＝keys≥2)時附上，為該條目之金鑰數
 * @param {Function} [opt.now=Date.now] 輸入時間函數(測試注入用)，預設Date.now
 * @returns {Object} 回傳 { onEvent, noteOversize, noteTruncated, snapshot, summary, threshold, windowMs }
 */
export function createProviderHealth(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const threshold = Number.isInteger(opt.threshold) && opt.threshold > 0 ? opt.threshold : 3
    const windowMs = Number.isInteger(opt.windowMs) && opt.windowMs > 0 ? opt.windowMs : 900_000
    const now = typeof opt.now === 'function' ? opt.now : Date.now
    const store = opt.store && typeof opt.store.get === 'function' && typeof opt.store.set === 'function' ? opt.store : null
    const streak = {} // providerId → { n, lastType, lastError }
    const cooledAt = {} // providerId → 本層最近一次「新」冷卻之時刻(視窗內的重寫是修復,不是新事件)
    let counts = {} // providerId → { ok, fail:{type:n}, cooled, mismatch, oversize, truncated }
    const ensure = (id) => (counts[id] ||= { ok: 0, fail: {}, cooled: 0, mismatch: 0, oversize: 0, truncated: 0 })

    /**
   * 記一次「prompt 逾該條目長度上限而未送出」(由 adapter 於呼叫前剔除時呼叫)。
   * 與 mismatch(params:已 spawn 才被轉接器擋下)分開計:oversize 是本層先擋下、省掉一次 spawn,
   * 是機制在運作而非失敗;巡檢據此提示「該席位主力長期用不到」。
   *
   * @param {String} id 輸入供應商條目 id
   * @returns {undefined} 無回傳值
   */
    function noteOversize(id) {
        ensure(id).oversize++
    }

    /**
     * 記一次「截斷內容經 acceptTruncated 放行」(由 adapter 見成功結果帶 truncated 時呼叫);性質同 oversize,非失敗
     *
     * @param {String} id 輸入供應商條目 id
     * @returns {undefined} 無回傳值
     */
    function noteTruncated(id) {
        ensure(id).truncated++
    }

    /**
     * 把供應商寫進套件的冷卻表(已在冷卻中且未逾窗則不動)
     *
     * @param {String} id 輸入供應商條目 id
     * @returns {Boolean} 回傳是否為新寫入(true=本次新冷卻，false=無 store 或未逾窗而略過)
     */
    function cool(id) {
        if (!store) return false
        let st
        try {
            st = store.get()
        }
        catch {
            st = null
        }
        if (!st || typeof st !== 'object') st = {}
        if (!st.cooling || typeof st.cooling !== 'object') st.cooling = {}
        const t = st.cooling[id]
        if (Number.isFinite(t) && now() - t < windowMs) return false
        st.cooling[id] = now()
        try {
            store.set(st)
        }
        catch { /* 寫入失敗:下次失敗事件再斷言 */ }
        return true
    }

    /**
     * 事件入口:ok 歸零 streak;next-key／skip-group 只記失敗型別次數;group-exhausted(一組試完仍無成交,上游每次呼叫每組
     * 恰發一次)計一次連續失敗,達門檻即呼叫 cool() 並觸發 onCool(見檔頭②③)
     *
     * @param {Object} ev 輸入事件物件(w-dispatch-ai ≥1.0.39 之 dispatchAiFallback 事件)，需含 providerId
     * @returns {undefined} 無回傳值
     */
    function onEvent(ev) {
        if (!ev || typeof ev !== 'object' || !ev.providerId) return
        const id = String(ev.providerId)
        if (ev.type === 'ok') {
            ensure(id).ok++
            delete streak[id]
            return
        }
        // 逐次失敗:只記型別次數(params 另計 mismatch:席位與能力不相容,供摘要與巡檢揭露);連續失敗由組盡事件計
        if (ev.type === 'skip-group' || ev.type === 'next-key') {
            const type = String(ev.errorType || 'exec')
            const c = ensure(id)
            c.fail[type] = (c.fail[type] || 0) + 1
            if (type === 'params') c.mismatch++
            return
        }
        if (ev.type !== 'group-exhausted') return
        // 本組各次嘗試之型別皆在排除清單者不計;否則以最後一個計入型別為本次之型別(缺 errorTypes 者視為 exec)
        const types = (Array.isArray(ev.errorTypes) ? ev.errorTypes : []).map((t) => String(t || 'exec'))
        const counted = types.filter((t) => !IGNORE_TYPES.has(t))
        if (types.length && !counted.length) return
        const type = counted.length ? counted[counted.length - 1] : 'exec'
        // keys:多金鑰條目每把皆試過而敗(attempted＝keys≥2)時附上,供訊息註明「每次 N 把金鑰皆敗」;首把即整組跳過者不附
        const keys = Number.isInteger(ev.keys) && ev.keys >= 2 && ev.attempted === ev.keys ? ev.keys : 0
        const c = ensure(id)
        const s = (streak[id] ||= { n: 0, lastType: '', lastError: '' })
        s.n++
        s.lastType = type
        s.lastError = String(ev.error || '').slice(0, 120)
        if (s.n < threshold) return
        const inWindow = Number.isFinite(cooledAt[id]) && now() - cooledAt[id] < windowMs
        const fresh = cool(id)
        if (!fresh) {
            if (!inWindow) cooledAt[id] = now(); return
        } // 套件(429/逾時)已冷卻:對齊時刻,不重複計
        if (inWindow) return // 視窗內重寫＝修復被套件蓋掉的紀錄,不是新事件
        cooledAt[id] = now()
        c.cooled++
        try {
            opt.onCool?.({ providerId: id, streak: s.n, errorType: type, error: s.lastError, ...(keys ? { keys } : {}) })
        }
        catch { /* 回呼不影響主流程 */ }
    }

    /**
     * 本行程累計(供執行摘要);drain=true 時歸零
     *
     * @param {Boolean} [drain=false] 輸入是否於取出後歸零累計，預設false
     * @returns {Object} 回傳 { threshold, counts, streak } 之深拷貝快照
     */
    function snapshot(drain = false) {
        const out = { threshold, counts: JSON.parse(JSON.stringify(counts)), streak: JSON.parse(JSON.stringify(streak)) }
        if (drain) counts = {}
        return out
    }

    /**
     * 一行摘要:健康降序、席位不相容、prompt 逾長跳過與截斷放行(無則空字串)
     *
     * @param {Object} [snap=snapshot()] 輸入快照物件(snapshot 之產出)，預設取當前快照
     * @returns {String} 回傳彙整後之摘要字串，各項皆無時回傳空字串
     */
    function summary(snap = snapshot()) {
        const cooled = Object.entries(snap.counts).filter(([, c]) => c.cooled > 0).map(([id, c]) => `${id}×${c.cooled}`)
        const mism = Object.entries(snap.counts).filter(([, c]) => c.mismatch > 0).map(([id, c]) => `${id}(params)×${c.mismatch}`)
        const over = Object.entries(snap.counts).filter(([, c]) => (c.oversize || 0) > 0).map(([id, c]) => `${id}×${c.oversize}`)
        const trunc = Object.entries(snap.counts).filter(([, c]) => (c.truncated || 0) > 0).map(([id, c]) => `${id}×${c.truncated}`)
        return [
            cooled.length && `健康降序 ${cooled.join(' ')}`,
            mism.length && `席位不相容 ${mism.join(' ')}`,
            over.length && `prompt 逾長跳過 ${over.join(' ')}`,
            trunc.length && `截斷放行 ${trunc.join(' ')}`,
        ].filter(Boolean).join('；')
    }

    return { onEvent, noteOversize, noteTruncated, snapshot, summary, threshold, windowMs }
}

export default createProviderHealth
