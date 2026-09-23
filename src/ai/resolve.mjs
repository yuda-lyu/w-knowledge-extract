// resolve.mjs — 供應商目錄之展開(單一入口:ai/adapter 與 ai/caller 共用)
//
// 【為何獨立成檔】adapter(JSON 任務＋健康＋計帳)與 caller(原始遞補呼叫,tai-news 契約)都要做同一件事:
//   內建目錄＋安裝方自帶條目(extraProviders)合併 → 逾時三層取值寫進 patch → resolveProviders(env/pick/exes/patch)。
//   兩處各寫一份必然漂移(殷鑑 2026-08-14:逐條 timeout 只加在陣列版、工作流走 table 版全部落回預設),故收成一支。
//
// 【extraProviders:安裝方自帶條目】新模型上線的速度快於套件發版,安裝方必須能不改套件就接上(否則「遇到新情形要能
//   自行擴充」的原則就破功)。條目格式同 w-dispatch-ai providers.mjs:{ id, model, kind, envVar, baseURL, body };
//   同 id 者以自訂覆蓋內建(可就地修正內建條目的 baseURL/body 而不必等發版)。
// 【逾時三層取值】providerTimeouts 逐 id > 條目自帶 timeoutMs > timeoutMs(全域預設)。一律經 patch 寫進條目,
//   budgetFor(預算＝鏈 timeout 總和)與實際 dispatch 才會讀到同一個數字(全域 timeoutMs 曾是無人消費的死設定)。
// 【env 與 envFile 二擇一】排程走 envFile(金鑰不進 process.env、不進 cfg);已解析成物件者(loadSettings 之 st.env、
//   測試替身)直接給 env。兩者皆無時交 resolveProviders 之預設(process.env)。
// 【exes】逐 kind 注入 CLI 執行檔絕對路徑:Windows 排程於 session 0 執行時 PATH 可能不含 npm 全域目錄,靠指令名會 ENOENT
//   (tai-news 實踩;本專案排程環境 PATH 完整,未曾需要)。鍵名為 kind 而非 id 前綴(agy 之鍵為 antigravity)。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import providersAll from 'w-dispatch-ai/src/providers.mjs'
import resolveProviders from 'w-dispatch-ai/src/resolveProviders.mjs'
import readEnvFile from 'w-dispatch-ai/src/readEnvFile.mjs'

/**
 * 內建目錄＋安裝方自帶條目合併(同 id 覆蓋);缺 id 之條目拋錯
 *
 * @param {Array} [catalogue=providersAll] 輸入供應商目錄陣列，非陣列時使用內建目錄 providersAll
 * @param {Array} [extraProviders=[]] 輸入安裝方自帶條目陣列，undefined／null 視為 []；給了但非陣列時拋錯
 * @returns {Array} 回傳合併後之供應商目錄陣列(不改動輸入陣列)
 * @throws {Error} extraProviders 給了但非陣列、或其中條目缺少 id 時拋出
 */
export function mergeCatalogue(catalogue = providersAll, extraProviders = []) {

    //check
    if (extraProviders === undefined || extraProviders === null) {
        extraProviders = []
    }
    if (!isarr(extraProviders)) {
        throw new Error('ai.extraProviders 須為陣列')
    }

    const merged = [...(Array.isArray(catalogue) ? catalogue : providersAll)]
    for (const p of (extraProviders || [])) {
        if (!p?.id) throw new Error('ai.extraProviders 之條目缺少 id')
        const i = merged.findIndex((x) => x.id === p.id)
        if (i >= 0) merged[i] = { ...merged[i], ...p }
        else merged.push(p)
    }
    return merged
}

/**
 * 逾時三層取值(providerTimeouts 逐 id > 條目自帶 timeoutMs > timeoutMs 全域預設)→ 逐 id patch(只收正整數)
 *
 * @param {Array} merged 輸入已合併之條目陣列(mergeCatalogue 之產出)
 * @param {Object} [opts={}] 輸入設定物件，非物件視為 {}
 * @param {Array} [opts.pick] 輸入欲展開之 id 陣列，省略或空陣列時對全目錄
 * @param {Object} [opts.providerTimeouts] 輸入逐 id 逾時毫秒數對照
 * @param {Integer} [opts.timeoutMs] 輸入全域預設逾時毫秒數
 * @returns {Object} 回傳逐 id 之 patch 物件，格式 { id: { timeoutMs } }；只收正整數
 * @throws {Error} merged 非陣列時拋出
 */
export function timeoutPatch(merged, opts = {}) {

    //check
    if (!isarr(merged)) {
        throw new Error('timeoutPatch 需要 merged（條目陣列）')
    }
    if (!isobj(opts)) {
        opts = {}
    }

    const { pick, providerTimeouts, timeoutMs } = opts
    const ids = Array.isArray(pick) && pick.length ? pick : merged.map((x) => x.id)
    const patch = {}
    for (const id of ids) {
        const t = providerTimeouts?.[id] ?? merged.find((x) => x.id === id)?.timeoutMs ?? timeoutMs
        if (Number.isInteger(t) && t > 0) patch[id] = { timeoutMs: t }
    }
    return patch
}

/**
 * 展開供應商目錄:合併目錄 → 決定金鑰來源 → 逾時 patch(與呼叫端 patch 合併) → resolveProviders
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Array} [opt.catalogue] 輸入供應商目錄，預設內建目錄
 * @param {Array} [opt.extraProviders] 輸入安裝方自帶條目陣列
 * @param {Array} [opt.pick] 輸入欲展開之 id 陣列
 * @param {Object} [opt.env] 輸入已解析之金鑰物件，與 envFile 二擇一
 * @param {String} [opt.envFile] 輸入 .env 路徑字串
 * @param {Object} [opt.exes] 輸入逐 kind 之 CLI 執行檔絕對路徑對照
 * @param {Object} [opt.patch] 輸入各 id 之欄位覆寫對照，與逾時 patch 淺合併且優先
 * @param {Object} [opt.providerTimeouts] 輸入逐 id 逾時毫秒數對照
 * @param {Integer} [opt.timeoutMs] 輸入全域預設逾時毫秒數
 * @returns {Object} 回傳 { merged:Array, env:Object, resolved:{ providers, table, skipped, missing, hints } }
 */
export function resolveCatalogue(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const merged = mergeCatalogue(opt.catalogue, opt.extraProviders)
    const env = (opt.env && typeof opt.env === 'object') ? opt.env : (opt.envFile ? readEnvFile(opt.envFile) : undefined)
    const patch = timeoutPatch(merged, { pick: opt.pick, providerTimeouts: opt.providerTimeouts, timeoutMs: opt.timeoutMs })
    for (const [id, v] of Object.entries(opt.patch || {})) patch[id] = { ...(patch[id] || {}), ...(v || {}) }
    const resolved = resolveProviders(merged, { env, pick: opt.pick, exes: opt.exes, patch })
    return { merged, env, resolved }
}

export default { mergeCatalogue, timeoutPatch, resolveCatalogue }
