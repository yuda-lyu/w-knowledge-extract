// relationContext.mjs — 起草提示詞之【關聯脈絡】之列:本批筆記之間、以及與核心已引筆記之關聯邊
//
// 【關聯驅動】衝突型排前並標「衝突」,提煉器須立爭議或說明非對立(規則表 dispute／disputeBoundary);兩端皆可引之衝突列冠 R 編號
//   (檢定標準 ES5:須逐條交代去向)。提煉段據回傳之列記錄「已見之衝突邊」——截斷而未呈現者不算見過。
// 【衝突型由呼叫端給】衝突型之名屬關聯 domain(conflictType);不給即拋,不退回任何預設詞彙(退回會與提煉段所讀之衝突邊不一致)。

import { cmp, textValueOf as str } from '../core/capturePackage.mjs'


/**
 * 關聯脈絡之列(純函數):只列至少一端在本批之邊;衝突型在前 → 邊時刻新到舊 → 端點 id(截斷於 max 時保留最新者,與輸入序無關)。
 *   與筆記 md 之關聯投影不同序:投影於衝突之後依型別序、同型再新到舊,脈絡於衝突之後即新到舊(不分型別)。
 *   ctx.label 為真時,兩端皆可引(本批或核心已引)之衝突列冠以 R1、R2…;一端不可引者不編號(只供參考)
 *
 * @param {Array} edges 輸入關聯邊 [{ id?, from, to, type, reason, updatedAt?, createdAt? }](筆記 id)
 * @param {Object} ctx 輸入 { conflictType:衝突型之名(必給;關聯 domain 之 conflictType), codeOf:(id)=>本批代號或'', titleOf:(id)=>標題,
 *   cited:Set(核心已引之筆記 id), max:列數上限(預設 40), linked:Boolean(true＝非衝突型只列兩端皆在本批或為核心已引者;衝突型不受限),
 *   label:Boolean(兩端皆可引之衝突列冠 R 編號) }
 * @returns {Array} 回傳實際呈現之列 [{ id(邊 id,無則''), conflict:Boolean, line, label(R 編號,無則''), ends:[from,to], enforced:Boolean }](已排序、已截斷)
 * @throws {Error} ctx.conflictType 非非空字串時拋出
 * @example
 * const rows = relationContextRows([{ from: 'a', to: 'b', type: '對立', reason: '結論相反' }], { conflictType: '對立', codeOf: (id) => ({ a: 'N1', b: 'N2' })[id] || '' })
 * console.log(rows.map((r) => r.line).join('\n'))
 * // => - N1 ↔ N2〔對立；衝突〕：結論相反
 */
export function relationContextRows(edges, ctx = {}) {
    const conflictType = str(ctx?.conflictType)
    if (!conflictType) throw new Error('relationContextRows 需要 ctx.conflictType（衝突型之名；取每輪依賴之關聯 domain 之 conflictType）')
    const codeOf = typeof ctx.codeOf === 'function' ? ctx.codeOf : () => ''
    const titleOf = typeof ctx.titleOf === 'function' ? ctx.titleOf : (id) => id
    const cited = ctx.cited instanceof Set ? ctx.cited : new Set()
    const max = Number.isInteger(ctx.max) && ctx.max > 0 ? ctx.max : 40
    const name = (id) => codeOf(id) || `〈${titleOf(id) || id}〉${cited.has(id) ? '（核心已引）' : '（非本批）'}`
    const known = (id) => !!codeOf(id) || cited.has(id)
    const seen = new Set()
    const rows = []
    for (const e of Array.isArray(edges) ? edges : []) {
        const a = str(e?.from)
        const b = str(e?.to)
        if (!a || !b || a === b || (!codeOf(a) && !codeOf(b))) continue
        const conflict = str(e?.type) === conflictType
        if (ctx.linked === true && !conflict && !(known(a) && known(b))) continue
        const key = [a, b].sort().join('\u0000') + `\u0000${str(e?.type)}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({ id: str(e?.id), conflict, at: str(e?.updatedAt) || str(e?.createdAt), key, ends: [a, b], enforced: conflict && known(a) && known(b), body: `${name(a)} ↔ ${name(b)}〔${str(e?.type) || '關聯'}${conflict ? '；衝突' : ''}〕${str(e?.reason) ? `：${str(e.reason)}` : ''}` })
    }
    rows.sort((x, y) => Number(y.conflict) - Number(x.conflict) || cmp(y.at, x.at) || cmp(x.key, y.key))
    let n = 0
    return rows.slice(0, max).map((r) => {
        const label = ctx.label === true && r.enforced ? `R${++n}` : ''
        return { id: r.id, conflict: r.conflict, line: `- ${label ? `${label} ` : ''}${r.body}`, label, ends: r.ends, enforced: r.enforced }
    })
}

export default { relationContextRows }
