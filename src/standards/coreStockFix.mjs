// coreStockFix.mjs — 核心之存量確定性處置(檢定標準 ES3 正體、ES5 已見衝突之去向)——純函數
//
// 【ES3】非終態條目之文字欄(與符合度掃描同一受檢範圍 coreStandards.itemTexts＋本質)有簡體或同形字誤用者,以 toTwKeepLinks 只改違規處
//   (`[[連結]]` 與網址不轉;FOREIGN_SPAN_RE)。改動之條目沿革追加 stock-fix、升一版、changelog 記 mode 'stock-fix';本質改寫照
//   applyDelta 之規則入 essenceHistory(不變式「本質改寫須入沿革」)。
// 【ES5】seenConflicts 中兩端皆為已消化存活筆記、而無處置結構(conflictDisposition ③不限版)且未交 RS4 核對之衝突(與掃描同一判定)
//   → 移出 seenConflicts(記帳欄位,不升版):提煉維護下輪視為新衝突、排重審重新呈現,須有去向(ES5 新進)或逾次交 RS4。
// 【寫入】由呼叫端(存量處置之套用)以提煉段之同一落盤路徑(stores/coreProjection 之 coreWriterOf;不變式、渲染、CAS)寫入。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { scriptOf, strictTextOf as str, sha1, canonOf, jsonClone as clone } from '../core/capturePackage.mjs'
import { itemsInScopeOf, scriptBadOf } from './coreStandards.mjs'
import { ITEM_TEXT_FIELDS, SIDE_TEXT_FIELDS } from '../stores/coreState.mjs'
import { es5RowsOf } from './conflictDisposition.mjs'

/** 本模組可處置之標準 */
export const CORE_FIX_STDS = Object.freeze(['ES3', 'ES5'])

/**
 * 核心狀態之內容指紋:去落盤簿記(rev、renderHashes)與衍生欄位(條目與各方之 evidence)後之正規化 JSON 之雜湊——存量處置之帳列 after.hash
 *   與回退之「現值為該次處置之結果／已回到處置前」同以此判(投影更新只升 rev、證據重算只改衍生欄,皆不改指紋;ABA 之內容改寫改指紋)
 *
 * @param {Object} state 輸入核心狀態
 * @returns {String} 回傳指紋(sha1)
 * @example
 * console.log(stateFingerprintOf({ v: 3, rev: 1, claims: [{ id: 'C1', text: 'x', evidence: { level: '中' } }] }) === stateFingerprintOf({ v: 3, rev: 9, renderHashes: ['h'], claims: [{ id: 'C1', text: 'x' }] }))
 * // => true
 */
export function stateFingerprintOf(state) {
    const s = clone(isobj(state) ? state : {})
    delete s.rev
    delete s.renderHashes
    for (const key of ['claims', 'parameters', 'disputes', 'questions']) {
        for (const x of isarr(s[key]) ? s[key] : []) {
            if (!isobj(x)) continue
            delete x.evidence
            for (const sd of isarr(x.sides) ? x.sides : []) if (isobj(sd)) delete sd.evidence
        }
    }
    return sha1(canonOf(s))
}

// 條目之文字欄(與套用、檢定標準同一份;此處須可寫回,故逐欄處理)
const FIELDS = ITEM_TEXT_FIELDS
const SIDE_FIELDS = SIDE_TEXT_FIELDS

/**
 * 一個欄位值轉正體(字串或字串陣列;只改違規者;字形政策依語言設定)
 *
 * @param {*} v 輸入欄位值
 * @param {Object} script 輸入字形政策
 * @returns {Object} 回傳 { value, changed:Boolean }
 */
function fixValue(v, script) {
    const bad = (t) => typeof t === 'string' && scriptBadOf(script, t) > 0
    if (typeof v === 'string') {
        if (!bad(v)) return { value: v, changed: false }
        const t = script.fixKeepLinks(v)
        return { value: t, changed: t !== v }
    }
    if (isarr(v)) {
        let changed = false
        const out = v.map((x) => {
            const r = fixValue(x, script)
            if (r.changed) changed = true
            return r.value
        })
        return { value: out, changed }
    }
    return { value: v, changed: false }
}

/**
 * 核心之存量確定性處置
 *
 * @param {Object} state 輸入核心狀態(不修改)
 * @param {Object} [ctx={}] 輸入 { stds:Array(預設全部), at:String, conflictEndsOf:(邊 id)=>[a, b]|null(ES5;未給不處置), rs4HeldOf:(邊 id)=>Boolean,
 *   locale?:語言設定或字形政策(ES3 之修正依之;非繁體中文之語言為恆等、無改動;未給＝臺灣正體),
 *   produced?:不呼叫 AI 之產出鏈(core/producedChain 之 standardsFixProducedOf 之產物;升版而寫 changelog 時帶入其 produced 欄,未給不寫——預演不必給) }
 * @returns {Object} 回傳 { state, changes:[{ std, id, what }], touched:Array(條目 id;不含 essence), bumped:Boolean, seenRemoved:Array(邊 id) }
 * @throws {Error} ctx.locale 不合時拋出
 * @example
 * const s = coreStateOf({ claims: [{ text: '软件开发', sources: ['n1'] }] }).state
 * const r = coreFixOf(s, { stds: ['ES3'], at: 'T1' })
 * console.log(r.changes.map((c) => [c.std, c.id]), r.state.claims[0].text, s.claims[0].text)
 * // => [ [ 'ES3', 'C1' ] ] 軟件開發 软件开发
 */
export function coreFixOf(state, ctx = {}) {
    const stds = new Set(isarr(ctx.stds) && ctx.stds.length ? ctx.stds : CORE_FIX_STDS)
    const at = str(ctx.at)
    const script = scriptOf(ctx.locale, 'coreFixOf 之 ctx.locale')
    const bad = (t) => typeof t === 'string' && scriptBadOf(script, t) > 0
    const s = clone(state)
    const changes = []
    const touched = []
    const seenRemoved = []
    const version = (Number(s.version) || 0) + 1
    let essenceFixed = false

    if (stds.has('ES3')) {
        {
            // 受檢範圍與符合度掃描同一份(standards/coreStandards 之 itemsInScopeOf:爭議除撤回外皆檢;其餘只檢非終態、非已結案者)
            for (const { key, item: x } of itemsInScopeOf(s)) {
                const fields = []
                for (const f of FIELDS[key]) {
                    const r = fixValue(x[f], script)
                    if (r.changed) {
                        x[f] = r.value
                        fields.push(f)
                    }
                }
                if (key === 'disputes') {
                    for (const [k, sd] of (isarr(x.sides) ? x.sides : []).entries()) {
                        if (!isobj(sd)) continue
                        for (const f of SIDE_FIELDS) {
                            const r = fixValue(sd[f], script)
                            if (r.changed) {
                                sd[f] = r.value
                                fields.push(`sides[${k}].${f}`)
                            }
                        }
                    }
                }
                if (!fields.length) continue
                x.history = [...(isarr(x.history) ? x.history : []), { version, at, op: 'stock-fix', note: `ES3 正體（存量處置）：${fields.join('、')}` }]
                touched.push(x.id)
                changes.push({ std: 'ES3', id: x.id, what: `${fields.join('、')} 轉正體` })
            }
        }
        const ess = isobj(s.essence) ? s.essence : null
        if (ess && bad(ess.text)) {
            const t = script.fixKeepLinks(ess.text)
            if (t !== ess.text) {
                // 本質改寫須入沿革(不變式;同 applyDelta essence)
                s.essenceHistory = [...(isarr(s.essenceHistory) ? s.essenceHistory : []), { version: s.version, at: ess.at || '', text: ess.text, reason: 'ES3 正體（存量處置）' }]
                ess.text = t
                essenceFixed = true
                changes.push({ std: 'ES3', id: 'essence', what: '本質轉正體' })
            }
        }
    }

    if (stds.has('ES5') && isfun(ctx.conflictEndsOf)) {
        for (const { eid, ends, how } of es5RowsOf(s, ctx)) {
            if (how) continue
            seenRemoved.push(eid)
            changes.push({ std: 'ES5', id: eid, what: `衝突（${ends.join(' ⇄ ')}）移出已見——下輪重新呈現交提煉處置` })
        }
        if (seenRemoved.length) {
            const drop = new Set(seenRemoved)
            s.seenConflicts = s.seenConflicts.filter((x) => !drop.has(x))
        }
    }

    const bumped = touched.length > 0 || essenceFixed
    if (bumped) {
        s.version = version
        s.updatedAt = at
        s.changelog = [...(isarr(s.changelog) ? s.changelog : []), { version, at, mode: 'stock-fix', std: 'ES3', items: [...touched, ...(essenceFixed ? ['essence'] : [])], ...(isobj(ctx.produced) ? { produced: clone(ctx.produced) } : {}) }]
    }
    return { state: changes.length ? s : state, changes, touched, bumped, seenRemoved }
}

export default { CORE_FIX_STDS, stateFingerprintOf, coreFixOf }
