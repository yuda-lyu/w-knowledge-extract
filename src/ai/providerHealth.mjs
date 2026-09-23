// providerHealth.mjs — 供應商健康層:連續失敗即降序(冷卻)、成功即復原;本檔為此決定之唯一擁有者
//
// 【為何需要】w-dispatch-ai 的冷卻只認 HTTP 429 與逾時(dispatchAiFallback.mjs:458),
//   輸出驗證失敗(OUTPUT_VALIDATION_FAILED)與 CLI 執行失敗屬「整組跳過但不冷卻」——
//   主力供應商進入失敗風暴時,每一批仍先在它身上耗掉一次完整回應時間才遞補。
//   2026-09-09 08:00～11:00 生產實測:gemini 每輪驗證失敗 10～22 次(exec 風暴 16 次),
//   成交全落 claude:sonnet,彙整段由 350s 暴增至 1650～1745s,整輪 3200s 逼近排程上限被砍。
//
// 【判準:連續 N 次(預設 3)與金鑰無關之失敗 → 冷卻】單次驗證失敗是常態(各家 1.8～30%),
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
// 【哪些失敗計入】只計「與金鑰無關」者:skip-group(驗證失敗/逾時/執行檔不存在)一律計;
//   next-key 只在該條目無金鑰輪替(keyIndex 為 null,即 CLI 登入態)時計——多把金鑰之單把失敗
//   由套件換鑰處理,計入會把「一把額度用盡」誤判成整家故障。
//   params(進入執行前即被擋,如 agy 之 prompt 長度上限)不計 streak:那是席位設定與供應商能力
//   不相容,不會因冷卻而改善,故另計 mismatch 供執行摘要與巡檢揭露(2026-09-06～09-09 每輪固定 6 次)。

import isobj from 'wsemi/src/isobj.mjs'

/** 計入 streak 之 errorType(取自 w-dispatch-ai getErrorType 值域) */
const STREAK_TYPES = new Set(['validation', 'timeout', 'exec', 'spawn', 'http'])

/**
 * 建立供應商健康層:連續失敗即降序(冷卻)、成功即復原;本模組為此決定之唯一擁有者
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Object} [opt.store] 輸入 w-dispatch-ai store 物件 { get, set }，缺則只統計不冷卻
 * @param {Integer} [opt.threshold=3] 輸入連續失敗幾次即冷卻之正整數，預設3
 * @param {Integer} [opt.windowMs=900000] 輸入冷卻視窗毫秒數正整數(＝ai.cooldownMs)，預設900000；已冷卻且未逾窗者不重寫
 * @param {Function} [opt.onCool] 輸入觸發冷卻時之回呼，格式 (ev)=>void，ev 為 { providerId, streak, errorType, error }
 * @param {Function} [opt.now=Date.now] 輸入時間函數(測試注入用)，預設Date.now
 * @returns {Object} 回傳 { onEvent, noteOversize, snapshot, summary, threshold, windowMs }
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
    let counts = {} // providerId → { ok, fail:{type:n}, cooled, mismatch }
    const ensure = (id) => (counts[id] ||= { ok: 0, fail: {}, cooled: 0, mismatch: 0, oversize: 0 })

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
     * 事件入口:依 ev.type 更新成功／失敗計數,累計連續失敗達門檻即呼叫 cool() 並觸發 onCool
     *
     * @param {Object} ev 輸入事件物件，需含 providerId；type 為 'ok' 時歸零 streak,'skip-group'／'next-key' 時依 errorType 判斷是否計入 streak
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
        if (ev.type !== 'skip-group' && ev.type !== 'next-key') return
        const type = String(ev.errorType || 'exec')
        const c = ensure(id)
        c.fail[type] = (c.fail[type] || 0) + 1
        if (type === 'params') {
            c.mismatch++; return
        }
        if (!STREAK_TYPES.has(type)) return
        // next-key 僅無金鑰輪替者計入(見檔頭)
        if (ev.type === 'next-key' && ev.keyIndex !== null && ev.keyIndex !== undefined) return
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
            opt.onCool?.({ providerId: id, streak: s.n, errorType: type, error: s.lastError })
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
     * 一行摘要:健康降序與席位不相容(無則空字串)
     *
     * @param {Object} [snap=snapshot()] 輸入快照物件(snapshot 之產出)，預設取當前快照
     * @returns {String} 回傳彙整後之摘要字串，各項皆無時回傳空字串
     */
    function summary(snap = snapshot()) {
        const cooled = Object.entries(snap.counts).filter(([, c]) => c.cooled > 0).map(([id, c]) => `${id}×${c.cooled}`)
        const mism = Object.entries(snap.counts).filter(([, c]) => c.mismatch > 0).map(([id, c]) => `${id}(params)×${c.mismatch}`)
        const over = Object.entries(snap.counts).filter(([, c]) => (c.oversize || 0) > 0).map(([id, c]) => `${id}×${c.oversize}`)
        return [
            cooled.length && `健康降序 ${cooled.join(' ')}`,
            mism.length && `席位不相容 ${mism.join(' ')}`,
            over.length && `prompt 逾長跳過 ${over.join(' ')}`,
        ].filter(Boolean).join('；')
    }

    return { onEvent, noteOversize, snapshot, summary, threshold, windowMs }
}

export default createProviderHealth
