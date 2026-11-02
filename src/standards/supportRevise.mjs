// supportRevise.mjs — 依出處收斂措辭之修訂(檢定標準 ES9 之「語氣超出證據」,即 ES7 併入 ES9 覆核之裁決:語氣超出證據 → 修訂補丁;
//   不合格先修正,修不了才不納入)
//
// 【可修訂】判定小組成立「不受支持」之受檢項,其成立之各票原因含 overclaim、且無 contradicted(出處陳述相反者非措辭問題,改寫即換成另一主張);
//   斷言種類限 add、revise(改 text)、爭議之方(side)——confirm／contest 不改文字,不適用。
// 【修訂】修訂席一次呼叫(全部可修訂項;同一份出處材料):只改主張之 text／conditions／period(方:position／conditions),
//   不得加入出處沒有之內容;改不成者回 drop。之後由呼叫端過操作守門、納入閘並交判定小組重判(同一材料)——受支持才採,一輪為限。
// 【材料】與覆核同一份(contentOf:出處筆記之內容章＋原文標題＋發布時間),依字數分頁之第一頁為上限:修訂項連同其出處入同頁,
//   放不下者不修訂(照原處置)——不截斷材料。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { SUPPORT_PAGE_CHARS, SUPPORT_WORD } from './supportCheck.mjs'
import { NO_MATERIAL_TEXT } from './panelVotes.mjs'
import { replyObjectOf } from './parse.mjs'
import { opSidesOf } from '../stores/coreState.mjs'
import { textValueOf as str, textListOf as strs, uniq, jsonClone as clone } from '../core/capturePackage.mjs'


/** 可修訂之斷言種類 */
export const REVISABLE_KINDS = Object.freeze(['add', 'revise', 'side'])

/**
 * 判定小組之結果是否可修訂:成立不受支持,成立之各票(明確且不受支持者)原因含 overclaim、無 contradicted
 *
 * @param {Object} d 輸入 decidePanel 之結果(帶 votes)
 * @returns {Boolean} 回傳是否可修訂
 * @example
 * const vote = (v) => ({ seat: 'first', verdict: v })
 * console.log(revisableOf({ status: 'decided', verdict: { verdict: 'overclaim' }, seats: ['first', 'second'], votes: [vote({ verdict: 'overclaim', reason: '原文只說有相關，未說有因果' })] }), revisableOf({ status: 'decided', verdict: { verdict: 'contradicted' }, seats: ['first', 'second'], votes: [] }))
 * // => true false
 */
export function revisableOf(d) {
    if (d?.status !== 'decided' || d.verdict?.verdict === 'supported') return false
    const reasons = (d.votes || []).map((v) => v.verdict).filter((v) => isobj(v) && v.verdict !== 'supported').map((v) => v.verdict)
    return reasons.includes('overclaim') && !reasons.includes('contradicted')
}

/**
 * 成立之不受支持各票之說明(修訂提示詞用:「出處只支持什麼」)
 *
 * @param {Object} d 輸入判定小組之結果
 * @returns {Array} 回傳 [String]
 * @example
 * const d = { status: 'decided', verdict: { verdict: 'overclaim' }, seats: ['first', 'second'], votes: [{ seat: 'first', verdict: { verdict: 'overclaim', reason: '原文只說有相關' } }, { seat: 'second', verdict: { verdict: 'overclaim', reason: '未說有因果' } }] }
 * console.log(notSupportedReasonsOf(d))
 * // => [ '語氣超出證據：原文只說有相關', '語氣超出證據：未說有因果' ]
 */
export function notSupportedReasonsOf(d) {
    return uniq((d?.votes || []).map((v) => v.verdict).filter((v) => isobj(v) && v.verdict !== 'supported').map((v) => `${SUPPORT_WORD[v.verdict] || v.verdict}：${str(v.reason)}`))
}

/**
 * 受檢項之現行文字欄(修訂之起點)
 *
 * @param {Object} it 輸入受檢項(supportItemsOf 之產物或存量之合成項;kind、op、key)
 * @param {Object} [base] 輸入 revise 之目標條目(存量或 revise 操作改 text 之原條目;取其未改之欄)
 * @returns {Object|null} 回傳 { text, conditions:Array, period }(方:period 恆空)
 * @example
 * console.log(fieldsOf({ kind: 'add', op: { op: 'add', text: '甲', conditions: ['乙'], period: '2024' } }))
 * // => { text: '甲', conditions: [ '乙' ], period: '2024' }
 */
export function fieldsOf(it, base) {
    if (it.kind === 'add') return { text: str(it.op.text), conditions: strs(it.op.conditions), period: str(it.op.period) }
    if (it.kind === 'revise') {
        const f = isobj(it.op.fields) ? it.op.fields : {}
        const pick = (k) => (f[k] !== undefined ? f[k] : base?.[k])
        return { text: str(pick('text')), conditions: strs(pick('conditions')), period: str(pick('period')) }
    }
    if (it.kind === 'side') {
        const k = Number(String(it.key).split(':side')[1])
        const sd = opSidesOf(it.op)[k]
        return sd ? { text: str(sd.position), conditions: strs(sd.conditions), period: '' } : null
    }
    return null
}

/**
 * 修訂之結果套回操作(回新操作,不改輸入):add 改 text／conditions／period;revise 改 fields 之同名欄(條目原有之欄位由 fields 覆寫);
 *   方改 position／conditions
 *
 * @param {Object} op 輸入原操作
 * @param {Array} fixes 輸入 [{ it(受檢項), fix:{ text, conditions?, period? } }](同一操作之全部受檢項)
 * @returns {Object} 回傳新操作
 * @example
 * const op = { op: 'add', kind: 'rule', text: '甲且乙', conditions: [], sources: ['N1'] }
 * const next = applySupportFixes(op, [{ it: { kind: 'add' }, fix: { text: '甲', conditions: ['僅限單一觀測'] } }])
 * console.log(next.text, next.conditions, op.text)
 * // => 甲 [ '僅限單一觀測' ] 甲且乙
 */
export function applySupportFixes(op, fixes) {
    const out = clone(op)
    for (const { it, fix } of fixes) {
        if (it.kind === 'add') {
            out.text = str(fix.text)
            if (fix.conditions !== undefined) out.conditions = strs(fix.conditions)
            if (fix.period !== undefined) out.period = str(fix.period)
        }
        else if (it.kind === 'revise') {
            out.fields = { ...(isobj(out.fields) ? out.fields : {}), text: str(fix.text) }
            if (fix.conditions !== undefined) out.fields.conditions = strs(fix.conditions)
            if (fix.period !== undefined) out.fields.period = str(fix.period)
        }
        else if (it.kind === 'side') {
            const k = Number(String(it.key).split(':side')[1])
            const n = isarr(out.sides) ? out.sides.length : 0
            const sd = k < n ? out.sides[k] : (isarr(out.sides_add) ? out.sides_add[k - n] : null)
            if (!sd) continue
            sd.position = str(fix.text)
            if (fix.conditions !== undefined) sd.conditions = strs(fix.conditions)
        }
    }
    return out
}

/**
 * 修訂席之形狀檢查(交 w-dispatch-ai 之 check):須有 fixes 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkSupportRevise({ fixes: [] }), checkSupportRevise({ checks: [] }))
 * // => true false
 */
export const checkSupportRevise = (j) => !!j && isarr(j.fixes)

/**
 * 修訂席之解析(交 w-dispatch-ai 之 parse;取最後一個過 checkSupportRevise 者)
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 fixes 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseSupportRevise('{"fixes":[{"index":1,"text":"收斂後之措辭"}]}').fixes.length, parseSupportRevise('x'))
 * // => 1 null
 */
export const parseSupportRevise = (s) => replyObjectOf(s, ['fixes'], checkSupportRevise)

/**
 * 一席之修訂回覆 → 逐項修訂(text 非空者;drop 或缺者不列——呼叫端照原處置)
 *
 * @param {*} json 輸入 parseSupportRevise 之產物
 * @param {Set} indices 輸入送出之項編號
 * @returns {Map} 回傳 Map(項編號 → { text, conditions?, period? })
 * @example
 * console.log(supportFixesOf({ fixes: [{ index: 1, text: '收斂後之措辭' }, { index: 2, drop: true }] }, new Set([1, 2])))
 * // => Map(1) { 1 => { text: '收斂後之措辭' } }
 */
export function supportFixesOf(json, indices) {
    const out = new Map()
    const bad = new Set()
    for (const f of isarr(json?.fixes) ? json.fixes : []) {
        const i = Number(f?.index)
        if (!Number.isInteger(i) || !indices.has(i) || f?.drop === true || !str(f?.text)) continue
        if (out.has(i)) bad.add(i)
        out.set(i, { text: str(f.text), ...(f.conditions !== undefined ? { conditions: strs(f.conditions) } : {}), ...(f.period !== undefined ? { period: str(f.period) } : {}) })
    }
    for (const i of bad) out.delete(i) // 同編號多份 → 不採(不猜)
    return out
}

/**
 * 依出處收斂措辭之修訂呼叫
 *
 * @param {Object} o 輸入 { targets:[{ it, d, fields }](可修訂項;fields＝fieldsOf), concept, contentOf, titleOf, buildPrompt(domain.buildSupportRevisePrompt),
 *   call:(stage, seat, prompt)=>Promise<{ ok, json, providerId, stopped? }>, seat, pageChars? }
 * @returns {Promise<Object>} 回傳 { fixes:Map(受檢項 key → fix), calls, stopped, skipped:Array(key;材料放不下而未送)}
 * @example
 * need test in nodejs.
 *
 * const r = await runSupportRevise({ targets, concept: '黑洞', contentOf, titleOf, buildPrompt, call, seat })
 * console.log(r.fixes)
 */
export async function runSupportRevise(o) {
    const targets = isarr(o.targets) ? o.targets : []
    const contentOf = isfun(o.contentOf) ? o.contentOf : () => null
    const titleOf = isfun(o.titleOf) ? o.titleOf : (nid) => nid
    const cap = Number(o.pageChars) > 0 ? Number(o.pageChars) : SUPPORT_PAGE_CHARS
    const fixes = new Map()
    if (!targets.length || !o.seat || !isfun(o.buildPrompt)) return { fixes, calls: 0, stopped: false, skipped: targets.map((x) => x.it.key) }
    // 材料:修訂項連同其出處入同一頁;放不下者不送(不截斷材料)
    const take = []
    const skipped = []
    const seen = new Set()
    let size = 0
    for (const x of targets) {
        const add = x.it.notes.filter((n) => !seen.has(n)).reduce((a, n) => a + String(contentOf(n) ?? '').length, 0)
        if (take.length && size + add > cap) {
            skipped.push(x.it.key)
            continue
        }
        take.push(x)
        for (const n of x.it.notes) seen.add(n)
        size += add
    }
    const notes = uniq(take.flatMap((x) => x.it.notes))
    const label = new Map(notes.map((n, i) => [n, `S${i + 1}`]))
    const sources = notes.map((n) => ({ label: label.get(n), title: titleOf(n), text: contentOf(n) ?? NO_MATERIAL_TEXT }))
    const items = take.map((x, j) => ({ index: j + 1, kind: x.it.kind, text: x.fields.text, conditions: x.fields.conditions, period: x.fields.period, labels: x.it.notes.map((n) => label.get(n)), reasons: notSupportedReasonsOf(x.d) }))
    const r = await o.call('revise9', o.seat, o.buildPrompt({ concept: o.concept, sources, items }))
    if (r?.stopped) return { fixes, calls: 1, stopped: true, skipped }
    const got = r?.ok ? supportFixesOf(r.json, new Set(items.map((x) => x.index))) : new Map()
    take.forEach((x, j) => {
        if (got.has(j + 1)) fixes.set(x.it.key, got.get(j + 1))
    })
    return { fixes, calls: 1, stopped: false, skipped }
}

export default { REVISABLE_KINDS, revisableOf, notSupportedReasonsOf, fieldsOf, applySupportFixes, parseSupportRevise, checkSupportRevise, supportFixesOf, runSupportRevise }
