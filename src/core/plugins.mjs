// plugins.mjs — 跨階段插件(Rollup 物件形態):一顆插件對多個 hook 錨點掛載
//
// 插件形狀:{ name, enforce?, '<物件>.<子階段>.<環名>': { before/after/replace/add } }
// 展開為各子階段之 tap,由總組裝於建構預設物件時合併注入。
//
// 【只作用於預設 pipeline】自組 pipeline(cfg.pipeline)時物件由呼叫端建構,
//   插件無從注入——此時給 plugins 一律定義期拋錯,不默默失效(fail loud)。
// 【replace 衝突拋錯】兩顆插件搶同一錨點的 replace 沒有合理的合併語意,
//   靜默後者蓋前者是最難查的失效樣態。
// 【形狀錯誤一律拋錯】enforce 打錯字(如 'PRE')曾讓整顆插件被排序步驟靜默丟棄;掛載鍵打錯字(如 afer)
//   曾被展開步驟略過而成為空 tap——皆為「註冊了卻完全沒反應」,2026-09-23 起定義期拋錯。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { MwContractError } from './kernel.mjs'

const HOOK_RE = /^([\w-]+)\.([\w-]+)\.([\w-]+)$/
const RESERVED = new Set(['name', 'enforce'])
const PLUGIN_ENFORCE = new Set(['pre', 'post', ''])
const TAP_KEYS = new Set(['before', 'after', 'replace', 'add'])


/**
 * 展開插件清單為各子階段之 taps
 *
 * enforce:'pre' 之插件先套用(其 before/after 排前),其次無 enforce 者,最後 'post'
 *
 * @param {Array} [plugins=[]] 輸入插件物件陣列，各插件形狀為 { name, enforce, '<物件>.<子階段>.<環名>': { before, after, replace, add } }，其中 name 必填、enforce 可選 'pre' 或 'post'，預設[]
 * @returns {Object} 回傳各子階段之 taps 對照物件，格式為 { '<物件>.<子階段>': { '<環名>': { before, after, replace, add } } }
 * @throws {MwContractError} plugins 非陣列、插件非物件或缺 name、enforce 值非法、hook 名不合格式、掛載規格非物件或含未知鍵、兩顆插件搶同一錨點之 replace 時拋出
 * @example
 * import { defineMw } from './kernel.mjs'
 *
 * let mw = defineMw({ name: 'clean', handle: (m, c, n) => n(m) })
 * let taps = resolvePlugins([{ name: 'p1', 'fetch.detailFetch.fetchDetail': { after: [mw] } }])
 * console.log(Object.keys(taps), taps['fetch.detailFetch'].fetchDetail.after.length)
 * // => [ 'fetch.detailFetch' ] 1
 */
export function resolvePlugins(plugins = []) {

    //check
    if (!isarr(plugins)) {
        throw new MwContractError('plugins 須為陣列')
    }
    plugins.forEach((p, i) => {
        if (!isobj(p)) {
            throw new MwContractError(`插件[${i}] 須為物件`)
        }
        if (p.enforce !== undefined && !PLUGIN_ENFORCE.has(p.enforce)) {
            throw new MwContractError(`插件[${p.name || i}] 的 enforce 只能是 pre／post，收到：${p.enforce}`)
        }
    })

    const out = {}
    const replaceBy = {} // hook 全名 → 插件名(replace 衝突偵測)
    const ordered = [
        ...plugins.filter((p) => p.enforce === 'pre'),
        ...plugins.filter((p) => !p.enforce),
        ...plugins.filter((p) => p.enforce === 'post'),
    ]
    for (const p of ordered) {
        const pname = String(p?.name || '').trim()
        if (!pname) throw new MwContractError('插件缺少 name')
        for (const [key, spec] of Object.entries(p)) {
            if (RESERVED.has(key)) continue
            const m = HOOK_RE.exec(key)
            if (!m) throw new MwContractError(`插件[${pname}] 的 hook 名「${key}」不合格式 <物件>.<子階段>.<環名>`)
            if (!isobj(spec)) throw new MwContractError(`插件[${pname}] 的 hook「${key}」之掛載規格須為物件 { before, after, replace, add }`)
            const unknownKeys = Object.keys(spec).filter((k) => !TAP_KEYS.has(k))
            if (unknownKeys.length) throw new MwContractError(`插件[${pname}] 的 hook「${key}」含不認得的掛載鍵「${unknownKeys.join('、')}」(可用:before/after/replace/add)`)
            const prefix = `${m[1]}.${m[2]}`
            const anchor = m[3]
            if (!out[prefix]) out[prefix] = {}
            if (!out[prefix][anchor]) out[prefix][anchor] = {}
            const t = out[prefix][anchor]
            if (spec.before) t.before = [...(t.before || []), ...spec.before]
            if (spec.after) t.after = [...(t.after || []), ...spec.after]
            if (spec.add) t.add = [...(t.add || []), ...spec.add]
            if (spec.replace) {
                if (replaceBy[key]) throw new MwContractError(`插件[${pname}] 與插件[${replaceBy[key]}] 同時 replace「${key}」——請改用 before/after 或合併為一顆插件`)
                replaceBy[key] = pname
                t.replace = spec.replace
            }
        }
    }
    return out
}


/**
 * 合併兩份 taps(執行端直接給的 tap 與插件展開的 tap)
 *
 * before/after/add 依序串接,replace 雙方皆給時拋錯;任一方未給(非物件)即原樣回傳另一方
 *
 * @param {Object} [a] 輸入第一份 taps 物件，格式為 { '<環名>': { before, after, replace, add } }，未給代表無
 * @param {Object} [b] 輸入第二份 taps 物件，格式同 a，未給代表無
 * @param {String} [label=''] 輸入錯誤訊息用之標籤字串，例如 'organize.extract'，預設''
 * @returns {Object} 回傳合併後 taps 物件
 * @throws {MwContractError} 同一錨點雙方皆給 replace 時拋出
 * @example
 * import { defineMw } from './kernel.mjs'
 *
 * let mwA = defineMw({ name: 'mwA', handle: (m, c, n) => n(m) })
 * let mwB = defineMw({ name: 'mwB', handle: (m, c, n) => n(m) })
 * let merged = mergeTaps({ x: { before: [mwA] } }, { x: { before: [mwB], after: [mwB] } })
 * console.log(merged.x.before.length, merged.x.after.length)
 * // => 2 1
 */
export function mergeTaps(a, b, label = '') {

    //check
    if (!isobj(a)) {
        return b
    }
    if (!isobj(b)) {
        return a
    }
    if (!isestr(label)) {
        label = ''
    }

    const out = { ...a }
    for (const [anchor, t] of Object.entries(b)) {
        if (!out[anchor]) {
            out[anchor] = t; continue
        }
        const x = { ...out[anchor] }
        if (t.before) x.before = [...(x.before || []), ...t.before]
        if (t.after) x.after = [...(x.after || []), ...t.after]
        if (t.add) x.add = [...(x.add || []), ...t.add]
        if (t.replace) {
            if (x.replace) throw new MwContractError(`${label} 錨點[${anchor}] 之 replace 衝突（tap 與插件同時置換）`)
            x.replace = t.replace
        }
        out[anchor] = x
    }
    return out
}


export default { resolvePlugins, mergeTaps }
