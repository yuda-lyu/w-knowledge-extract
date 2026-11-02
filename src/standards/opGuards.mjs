// opGuards.mjs — 差量操作之程式守門(純函數):操作類別、可見性、實質重複轉確認、正體、文字欄之範圍
//
// 【補丁守門依操作類別映射】補丁守門(審後不得比審前差)之「刪除」指讓知識離開。差量裡「剔除」一條操作,
//   對建設性操作(add、confirm…)是把新知識擋在門外,對破壞性操作(supersede、retract…)卻是保護既有知識。
//   故修訂與終審要剔除建設性操作才套此守門(只准重複,或引用「高」嚴重度之離題／捏造意見);剔除破壞性操作一律放行。
//   revise 依改動幅度:改後仍保有原文過半(包含率 ≥0.5)屬建設性,否則視同破壞性。
// 【可見性】狀態視圖只給索引行之條目,起草者看不到全文——對它下改狀態之操作一律拒收(confirm 例外:只加出處)。
// 【正體】判定與修正為檢定標準共用件(抓取套件之字形政策,ctx.locale 決定——非繁體中文之語言為恆等):欄位內簡體專用字或同形字誤用任一處 → 只轉該欄之違規處並記旗標。
// 【實質重複轉確認】雙向包含率 ≥0.7、數字相同、否定詞一致才自動轉(否則只標記交審計):單向 ≥0.6 會把結論相反或加了條件之
//   新主張吞成確認,反方因此消失。全文相同者另由 stores/coreDelta 之 applyDelta(add)轉。
// 【檢定標準之納入閘不在此】數字紮根(逐操作之出處)、標注、跨篇、提及筆記、流程外洩等於 standards/opStandards:
//   先轉修訂意見、定稿仍不合才不採(ES1／ES2／ES4／ES12／ES13／ES16／ES17)。

import { TERMINAL_SET, findItem, REF_FIELDS } from '../stores/coreState.mjs'
import { containment, mutualContainment, sameSubstance } from '../guards/similarity.mjs'
import { scriptOf, textValueOf as str, textListOf as strs } from '../core/capturePackage.mjs'
import { LEAK_PHRASES, scriptBadOf } from './coreStandards.mjs'


/** 建設性操作(加入或累積知識):被剔除＝新知識進不來 */
export const CONSTRUCTIVE_OPS = new Set(['add', 'confirm', 'param_add', 'question_add', 'dispute_add', 'contest', 'related_add', 'essence'])
/** 破壞性操作(讓既有知識離開有效集合):被剔除＝舊知識被保住 */
export const DESTRUCTIVE_OPS = new Set(['supersede', 'retract', 'merge', 'dispute_dissolve', 'question_resolve', 'related_prune', 'split', 'refacet'])
/** 對既有條目改狀態之操作與其目標欄位(可見性守門用) */
const TARGET_FIELDS = { revise: ['id'], supersede: ['id'], retract: ['id', 'into'], contest: ['id', 'dispute'], dispute_update: ['id'], dispute_dissolve: ['id'], merge: ['into', 'from'], split: ['id'], question_resolve: ['id'] }
// 流程外洩字樣(定義與判定在 standards/coreStandards:LEAK_PHRASES、leakProblem;此處轉出同一實體)
export { LEAK_PHRASES }

/** 操作頂層之文字欄(textFieldsOf 與 rewriteTextFields 同一欄位集;檢定標準 ES2／ES3 之範圍＝全部內容字串,代號除外)——與條目之文字欄(coreState 之 ITEM_TEXT_FIELDS)是兩回事:操作另帶 reason、facet、validPeriod 等操作層之欄,故不共用 */
const TOP_TEXT_KEYS = ['text', 'question', 'note', 'name', 'value', 'conditions', 'pros', 'cons', 'critique', 'period', 'basis', 'facet', 'resolution', 'reason', 'validPeriod']
/** 爭議方之文字欄 */
const SIDE_TEXT_KEYS = ['position', 'conditions', 'basis']
/** 拆分各部之文字欄 */
const PART_TEXT_KEYS = ['text', 'conditions', 'pros', 'cons', 'critique', 'period', 'basis', 'facet']
/** 拆解爭議時各方轉主張之標注(dispute_dissolve 之 annotations[k];conditions 與該方之條件合併) */
const ANNOTATION_TEXT_KEYS = ['critique', 'pros', 'cons', 'period', 'conditions']

/**
 * 操作之全部文字欄(數字紮根、正體、提及筆記、外洩之受檢對象):頂層、revise 之 fields、爭議方(sides／sides_add)、拆分各部(parts)、
 * 相關概念(related_add／related_prune 之 concepts)、改面向(refacet 之 from／to)
 *
 * @param {Object} op 輸入操作
 * @returns {Array} 回傳 [{ path, text }]
 * @example
 * console.log(textFieldsOf({ op: 'revise', id: 'C1', fields: { text: '甲' }, reason: '乙' }).map((f) => f.value ?? f))
 * // => [ { path: 'reason', text: '乙' }, { path: 'fields.text', text: '甲' } ]
 */
export function textFieldsOf(op) {
    const out = []
    const push = (path, v) => {
        for (const [k, t] of strs(v).entries()) out.push({ path: Array.isArray(v) ? `${path}[${k}]` : path, text: t })
    }
    for (const k of TOP_TEXT_KEYS) {
        if (op?.[k] !== undefined) push(k, op[k])
    }
    if (op?.fields && typeof op.fields === 'object') for (const [k, v] of Object.entries(op.fields)) push(`fields.${k}`, v)
    for (const key of ['sides', 'sides_add']) {
        if (Array.isArray(op?.[key])) op[key].forEach((sd, k) => { for (const f of SIDE_TEXT_KEYS) push(`${key}[${k}].${f}`, sd?.[f]) })
    }
    if (Array.isArray(op?.parts)) op.parts.forEach((p, k) => { for (const f of PART_TEXT_KEYS) push(`parts[${k}].${f}`, p?.[f]) })
    if (Array.isArray(op?.annotations)) op.annotations.forEach((a, k) => { for (const f of ANNOTATION_TEXT_KEYS) push(`annotations[${k}].${f}`, a?.[f]) })
    if (['related_add', 'related_prune'].includes(op?.op)) push('concepts', op.concepts)
    if (op?.op === 'refacet') for (const k of ['from', 'to']) push(k, op[k])
    return out
}

// 文字中未加〔〕之既有條目編號(「屬 C17 範疇」)補上〔〕:成為可追溯之引用(渲染、懸空檢查一致),也不被當成數字而拒收紮根。
//   只收 C／D／P 且須為狀態中既有之條目(「Q1」常是季度,不碰)
const BARE_REF = /(?<![A-Za-z0-9〔@])([CDP]\d{1,4})(?![0-9A-Za-z])/g
const REF_TEXT_KEYS = REF_FIELDS.texts
/**
 * 補上既有條目編號之〔〕(不修改輸入)
 *
 * @param {Object} op 輸入操作
 * @param {Object} state 輸入目前狀態
 * @returns {Object} 回傳新操作(無可補者原樣之複本)
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] }).state
 * console.log(bracketRefs({ op: 'add', kind: 'rule', text: '與 C1 並列', sources: ['N1'] }, s).text)
 * // => 與 〔C1〕 並列
 */
export function bracketRefs(op, state) {
    const o = JSON.parse(JSON.stringify(op))
    if (!state) return o
    const fix = (t) => (typeof t === 'string' ? t.replace(BARE_REF, (m, id) => (findItem(state, id) ? `〔${id}〕` : m)) : t)
    const fixAll = (v) => (Array.isArray(v) ? v.map(fix) : fix(v))
    for (const k of REF_TEXT_KEYS) if (o[k] !== undefined) o[k] = fixAll(o[k])
    if (o.fields && typeof o.fields === 'object') for (const k of Object.keys(o.fields)) if (REF_TEXT_KEYS.includes(k)) o.fields[k] = fixAll(o.fields[k])
    for (const key of ['sides', 'sides_add']) if (Array.isArray(o[key])) for (const sd of o[key]) if (sd && typeof sd === 'object') { sd.position = fix(sd.position); if (sd.conditions !== undefined) sd.conditions = fixAll(sd.conditions) }
    if (Array.isArray(o.parts)) for (const p of o.parts) if (p && typeof p === 'object') for (const k of REF_TEXT_KEYS) if (p[k] !== undefined) p[k] = fixAll(p[k])
    return o
}

/**
 * 操作類別:'constructive'｜'destructive'
 *
 * @param {Object} op 輸入操作
 * @param {Object} state 輸入目前狀態(revise 判幅度用)
 * @returns {String} 回傳類別
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] }).state
 * console.log(opClass({ op: 'add', kind: 'rule', text: '乙', sources: ['N1'] }, s), opClass({ op: 'retract', id: 'C1', reason: '重複' }, s))
 * // => constructive destructive
 */
export function opClass(op, state) {
    if (op?.op === 'revise') {
        const hit = findItem(state, str(op.id))
        const before = str(hit?.item?.text) || str(hit?.item?.value)
        const after = str(op?.fields?.text) || str(op?.fields?.value)
        if (!after || !before) return 'constructive'
        return containment(before, after) >= 0.5 ? 'constructive' : 'destructive'
    }
    if (op?.op === 'dispute_update' && op?.status === 'resolved') return 'destructive'
    return DESTRUCTIVE_OPS.has(op?.op) ? 'destructive' : 'constructive'
}

/**
 * 以 fn 改寫操作之全部文字欄(與 textFieldsOf 同一欄位集;不修改輸入)
 *
 * @param {Object} op 輸入操作
 * @param {Function} fn 輸入字串轉換函數
 * @returns {Object} 回傳新操作
 * @example
 * const next = rewriteTextFields({ op: 'add', kind: 'rule', text: 'abc', sources: ['N1'] }, (t) => t.toUpperCase())
 * console.log(next.text)
 * // => ABC
 */
export function rewriteTextFields(op, fn) {
    const o = JSON.parse(JSON.stringify(op))
    const conv = (v) => (typeof v === 'string' ? fn(v) : (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? fn(x) : x)) : v))
    for (const k of TOP_TEXT_KEYS) {
        if (o[k] !== undefined) o[k] = conv(o[k])
    }
    if (o.fields && typeof o.fields === 'object') for (const k of Object.keys(o.fields)) o.fields[k] = conv(o.fields[k])
    for (const key of ['sides', 'sides_add']) {
        if (Array.isArray(o[key])) for (const sd of o[key]) if (sd && typeof sd === 'object') for (const f of SIDE_TEXT_KEYS) if (sd[f] !== undefined) sd[f] = conv(sd[f])
    }
    if (Array.isArray(o.parts)) for (const p of o.parts) if (p && typeof p === 'object') for (const f of PART_TEXT_KEYS) if (p[f] !== undefined) p[f] = conv(p[f])
    if (Array.isArray(o.annotations)) for (const a of o.annotations) if (a && typeof a === 'object') for (const f of ANNOTATION_TEXT_KEYS) if (a[f] !== undefined) a[f] = conv(a[f])
    if (['related_add', 'related_prune'].includes(o.op) && o.concepts !== undefined) o.concepts = conv(o.concepts)
    if (o.op === 'refacet') for (const k of ['from', 'to']) if (o[k] !== undefined) o[k] = conv(o[k])
    return o
}

/**
 * 對一份差量逐條守門(不修改輸入;回傳處理後之操作與紀錄)
 *
 * @param {Array} ops 輸入操作陣列(可帶 _oid 等程式欄位)
 * @param {Object} ctx 輸入 { state, visible:Set|null(全文可見之條目 id;null＝全部可見), locale?(語言設定或字形政策;未給＝臺灣正體) }
 * @returns {Object} 回傳 { ops:Array(通過者;轉確認者已改寫、正體已轉換、旗標已標), rejected:Array({op,reason}), flagged:Array({op,flag,detail}) }
 * @throws {Error} ctx.locale 不合時拋出
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] }).state
 * const r = guardOps([{ op: 'add', kind: 'rule', text: '软件开发', sources: ['N1'] }], { state: s })
 * console.log(r.ops.map((o) => o.text), r.rejected.length)
 * // => [ '軟件開發' ] 0
 */
export function guardOps(ops, ctx = {}) {
    const state = ctx.state
    const visible = ctx.visible instanceof Set ? ctx.visible : null
    const script = scriptOf(ctx.locale, 'guardOps 之 ctx.locale')
    const out = []
    const rejected = []
    const flagged = []
    const liveClaims = (state?.claims || []).filter((c) => !TERMINAL_SET.has(c.status))
    for (const op0 of Array.isArray(ops) ? ops : []) {
        if (!op0 || typeof op0 !== 'object') continue
        let op = bracketRefs(op0, state)
        // ① 可見性:對只見索引行之既有條目改狀態 → 拒(confirm 只加出處,不受限)
        if (visible && TARGET_FIELDS[op.op]) {
            const tgts = TARGET_FIELDS[op.op].flatMap((f) => strs(op[f])).filter((x) => !x.startsWith('@'))
            const hidden = tgts.filter((x) => findItem(state, x) && !visible.has(x))
            if (hidden.length) {
                rejected.push({ op, reason: `目標 ${hidden.join('、')} 未於提示詞中附全文（只見索引行之條目不可改狀態）` })
                continue
            }
        }
        // ② 正體:任一文字欄有簡體專用字或同形字誤用 → 只轉文字欄之違規處並記旗標(不擋);代號、出處等非文字欄不碰;
        //   `[[連結]]` 與網址不計不轉(與 SS3 同一定義 FOREIGN_SPAN_RE——轉網址內之字即壞連結)
        const badScript = textFieldsOf(op).find((f) => scriptBadOf(script, f.text))
        if (badScript) {
            op = rewriteTextFields(op, (t) => script.fixKeepLinks(t))
            flagged.push({ op, flag: 'simplified', detail: badScript.path })
        }
        // ③ 新增主張與既有有效主張實質相同 → 轉為 confirm(累積出處);只是相近者標記交審計
        if (op.op === 'add' && str(op.text)) {
            const same = liveClaims.find((c) => sameSubstance(op.text, str(c.text)))
            if (same) {
                const conv = { op: 'confirm', id: same.id, sources: op.sources || [], _oid: op._oid, _via: op._via, _from: `add 與 ${same.id} 實質相同，改記確認` }
                if (op.ref) conv._refAlias = { ref: op.ref, id: same.id }
                flagged.push({ op: conv, flag: 'add→confirm', detail: same.id })
                out.push(conv)
                continue
            }
            const near = liveClaims.find((c) => mutualContainment(op.text, str(c.text)) >= 0.6)
            if (near) {
                op._suspectDup = near.id
                flagged.push({ op, flag: 'suspectDup', detail: near.id })
            }
        }
        out.push(op)
    }
    return { ops: out, rejected, flagged }
}

export default { CONSTRUCTIVE_OPS, DESTRUCTIVE_OPS, LEAK_PHRASES, textFieldsOf, rewriteTextFields, bracketRefs, opClass, guardOps }
