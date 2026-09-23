// capability.mjs — 供應商能力表:prompt 長度上限(命令列型供應商有硬上限,超過即「未執行就失敗」)
//
// 【為何要有這張表】w-dispatch-ai 的 antigravity 轉接器以命令列參數傳 prompt,超過
//   MAX_PROMPT_LENGTH(30,000 字元,dispatchAntigravity.mjs)即回 params 錯誤——**不是**呼叫失敗,
//   是根本沒送出。呼叫端看到的只是「這一家失敗了,換下一家」,於是每次都白付一次 spawn 的
//   啟動開銷(數秒)才落到遞補。2026-09-12 13:07 輪實測:關聯段 9 次呼叫全數如此
//   (agy params×9,實際全由 claude:sonnet 承接),提煉段先前亦然(每輪 6 次)。
// 【修法:呼叫前依實際 prompt 長度剔除放不下的條目】長度是呼叫當下才知道的事實,
//   不是設定期的猜測——此前的啟動期檢核只認席位名稱含 distill(字串猜測),
//   關聯席位同樣派給 agy 卻查不出來(§2.1 對稱性:規則套一種元素就要比對兄弟元素)。
// 【只剔除、不改鏈序】剔除後鏈仍依原順序遞補;全部放不下才回失敗(訊息附長度與各家上限)。

/** 依 kind 之硬上限(來源:w-dispatch-ai 各 dispatch* 之實作);未列者無上限 */
export const KIND_MAX_PROMPT_CHARS = Object.freeze({
    antigravity: 30_000,
})

/**
 * 取得單一供應商條目之 prompt 長度上限
 *
 * 上限來源依序:逐 id 覆寫(overrides) → 條目自帶 maxPromptChars → kind 之硬上限(KIND_MAX_PROMPT_CHARS) → 無上限
 *
 * @param {Object} entry 輸入 resolveProviders 之條目物件 { id, kind, maxPromptChars? }，非物件(假值)視為無上限
 * @param {Object} [overrides={}] 輸入逐 id 覆寫物件，如 { 'agy:x': 20000 }；值為 0 或非正數視為解除上限
 * @returns {Number} 回傳字元數上限，無上限時回傳 Infinity
 * @example
 * console.log(maxPromptCharsOf({ id: 'agy:g', kind: 'antigravity' }))
 * // => 30000
 *
 * console.log(maxPromptCharsOf({ id: 'claude:sonnet', kind: 'claude' }))
 * // => Infinity
 */
export function maxPromptCharsOf(entry, overrides = {}) {
    if (!entry) return Infinity
    if (Object.prototype.hasOwnProperty.call(overrides || {}, entry.id)) {
        const v = overrides[entry.id]
        return Number.isFinite(v) && v > 0 ? v : Infinity
    }
    const n = entry.maxPromptChars ?? KIND_MAX_PROMPT_CHARS[entry.kind]
    return Number.isFinite(n) && n > 0 ? n : Infinity
}

/**
 * 依 prompt 實際長度把鏈切成「放得下」與「放不下」,剔除後鏈序不變
 *
 * @param {Array} providers 輸入條目陣列(鏈序)，非陣列(假值)視為空鏈
 * @param {Number} promptLen 輸入實際字元數(含防寫前綴)，非有限數值視為 0(即全數保留)
 * @param {Object} [overrides={}] 輸入逐 id 覆寫物件，透傳 maxPromptCharsOf
 * @returns {Object} 回傳 { kept:Array, dropped:Array }，dropped 各項為 { id, limit }
 * @example
 * let r = fitChain([{ id: 'agy:g', kind: 'antigravity' }, { id: 'claude:sonnet', kind: 'claude' }], 30001)
 * console.log(r.kept.map((x) => x.id), r.dropped)
 * // => [ 'claude:sonnet' ] [ { id: 'agy:g', limit: 30000 } ]
 */
export function fitChain(providers, promptLen, overrides = {}) {

    //check
    if (!Number.isFinite(promptLen)) {
        promptLen = 0
    }

    const kept = []
    const dropped = []
    for (const p of providers || []) {
        const limit = maxPromptCharsOf(p, overrides)
        if (promptLen > limit) dropped.push({ id: p.id, limit })
        else kept.push(p)
    }
    return { kept, dropped }
}

export default { KIND_MAX_PROMPT_CHARS, maxPromptCharsOf, fitChain }
