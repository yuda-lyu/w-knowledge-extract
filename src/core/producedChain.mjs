// producedChain.mjs — 核心版本之產出鏈(changelog 每筆之 produced):自一個 pass 之逐棒呼叫紀錄組出多步產出(steps／failures)
//
// 【規格】跨套件之產出鏈規格 §2.2(多步產出)、§3(核心之 changelog 每筆)、§4(stage:extract、regen-core、rollback);組出一律經抓取套件之 makeProduced
//   (檢核與鍵序一份,不自行拼物件)。
// 【steps】每個「實際成交」之呼叫一列(依呼叫完成之序):role＝評比角色 id 去 `wf-` 前綴(見 CALL_ROLES;角色名與本套件之十四個評比角色一致),
//   seat＝席號(起草席與判定小組之席為 1 起、單席之棒為 0),provider＝該次呼叫結果之 providerId(遞補後為遞補者),
//   promptFp＝該角色之評比題組以現行詞彙組出之提示詞之指紋(createPromptFpCache 之 promptFpOf;無題組或算不出者省略該欄)。
// 【failures】成交之呼叫其遞補鏈中「失敗而遞補」之嘗試(逐家,同呼叫之 role／seat):provider＝失敗者之條目 id(去金鑰序號 #n)、
//   type＝調度層之失敗分類(errorType;缺者取該次嘗試之 outcome)。整條鏈皆敗(無成交)之呼叫不入產出鏈(沒有產出;失敗見逐棒日誌)。
// 【無 AI 之版本】無任何成交呼叫者(如回退)改用規格 §2.1 之不呼叫 AI 之寫入:seat 與 provider 同時 null(共用件之 steps 須至少一列,不收空陣列)。
//   無 AI 之確定性寫入(存量處置、撤出處／恢復、還原撤回)同此單一形,stage 為 `standards-fix`(standardsFixProducedOf)。

import { makeProduced, pkgIdOf } from './capturePackage.mjs'

/**
 * 各棒(onCall 之 stage 名)→ { role:步驟之角色名, seat:席號, bench:評比角色 id(提示詞指紋之來源) }。
 *   起草之三席於整併、本質專步改用 wf-consolidate、wf-essence 之提示詞(以 mode 覆蓋,見 callRoleOf);待審裁決之終審席為 wf-pending
 *
 * @type {Object}
 */
export const CALL_ROLES = Object.freeze({
    draft1: Object.freeze({ role: 'draft', seat: 1, bench: 'wf-draft' }),
    draft2: Object.freeze({ role: 'draft', seat: 2, bench: 'wf-draft' }),
    draft3: Object.freeze({ role: 'draft', seat: 3, bench: 'wf-draft' }),
    integrate: Object.freeze({ role: 'integrate', seat: 0, bench: 'wf-integrate' }),
    audit: Object.freeze({ role: 'audit', seat: 0, bench: 'wf-audit' }),
    revise: Object.freeze({ role: 'revise', seat: 0, bench: 'wf-revise' }),
    accept: Object.freeze({ role: 'accept', seat: 0, bench: 'wf-accept' }),
    check1: Object.freeze({ role: 'support-check', seat: 1, bench: 'support-check' }),
    check2: Object.freeze({ role: 'support-check', seat: 2, bench: 'support-check' }),
    check3: Object.freeze({ role: 'support-check', seat: 3, bench: 'support-check' }),
    revise9: Object.freeze({ role: 'support-revise', seat: 0, bench: 'support-revise' }),
    dispute1: Object.freeze({ role: 'dispute-check', seat: 1, bench: 'dispute-check' }),
    dispute2: Object.freeze({ role: 'dispute-check', seat: 2, bench: 'dispute-check' }),
    dispute3: Object.freeze({ role: 'dispute-check', seat: 3, bench: 'dispute-check' }),
    orphan1: Object.freeze({ role: 'orphan-check', seat: 1, bench: 'orphan-check' }),
    orphan2: Object.freeze({ role: 'orphan-check', seat: 2, bench: 'orphan-check' }),
    orphan3: Object.freeze({ role: 'orphan-check', seat: 3, bench: 'orphan-check' }),
    synonymPropose: Object.freeze({ role: 'synonym-propose', seat: 0, bench: 'synonym-propose' }),
    synonym1: Object.freeze({ role: 'synonym-check', seat: 1, bench: 'synonym-check' }),
    synonym2: Object.freeze({ role: 'synonym-check', seat: 2, bench: 'synonym-check' }),
    synonym3: Object.freeze({ role: 'synonym-check', seat: 3, bench: 'synonym-check' }),
})

/** 起草席於整併、本質專步之角色(以 mode 覆蓋) */
const DRAFT_ROLE_OF_MODE = Object.freeze({ consolidate: { role: 'consolidate', bench: 'wf-consolidate' }, essence: { role: 'essence', bench: 'wf-essence' } })

/** 寫入時刻之格式(同 makeProduced 之 at:本地時區 ISO,秒位、帶 ±hh:mm 偏移) */
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

/**
 * 一次呼叫之角色資訊(CALL_ROLES 依 mode 覆蓋):mode 為 'consolidate'／'essence' 時起草席為 consolidate／essence、'pending' 時終審席為 pending
 *
 * @param {String} stage 輸入棒名(onCall 之 stage)
 * @param {String} [mode=''] 輸入 pass 之模式(delta、consolidate、essence、pending…)
 * @returns {Object|null} 回傳 { role, seat, bench };棒名不認得回 null
 * @example
 * console.log(callRoleOf('draft2', 'delta'), callRoleOf('draft2', 'essence'), callRoleOf('accept', 'pending'), callRoleOf('nope'))
 * // => { role: 'draft', seat: 2, bench: 'wf-draft' } { role: 'essence', seat: 2, bench: 'wf-essence' } { role: 'pending', seat: 0, bench: 'wf-pending' } null
 */
export function callRoleOf(stage, mode = '') {
    const base = CALL_ROLES[stage]
    if (!base) return null
    if (base.role === 'draft' && DRAFT_ROLE_OF_MODE[mode]) return { ...base, ...DRAFT_ROLE_OF_MODE[mode] }
    if (stage === 'accept' && mode === 'pending') return { ...base, role: 'pending', bench: 'wf-pending' }
    return { ...base }
}

/**
 * 失敗嘗試之條目 id(去調度層之金鑰序號後綴 `#n`:keyId＝`<條目 id>#<序號>`;成交之 providerId 無此後綴,兩者須同一寫法才能依條目 id 選件)
 *
 * @param {Object} t 輸入逐家嘗試之一筆(triedOf 之項:{ id, outcome, errorType })
 * @returns {String} 回傳條目 id(空字串＝無)
 * @example
 * console.log(triedProviderOf({ id: 'codex:gpt-6.1-terra#2', outcome: 'fail' }), triedProviderOf({ id: 'claude:sonnet' }), JSON.stringify(triedProviderOf({})))
 * // => codex:gpt-6.1-terra claude:sonnet ""
 */
export function triedProviderOf(t) {
    return String(t?.id || t?.providerId || '').replace(/#\d+$/, '')
}

/**
 * 自一個 pass 之逐棒呼叫紀錄組出核心版本之產出鏈(經 makeProduced;無成交呼叫者為不呼叫 AI 之單一形)
 *
 * @param {Object} o 輸入
 * @param {Array} o.calls 輸入逐棒呼叫紀錄 [{ stage, ok, providerId, tried:[{ id, outcome, errorType }] }](aiCall 之 onCall 引數;依呼叫完成之序)
 * @param {String|null} o.stamp 輸入輪次 stamp(ctx.stamp;輪次外為 null)
 * @param {String} o.stage 輸入產出階段(extract、regen-core、rollback;規格 §4)
 * @param {String} o.pkg 輸入套件版(pkgIdOf)
 * @param {String} [o.at] 輸入寫入時刻(格式不合者視為未給,取現在)
 * @param {String} [o.mode=''] 輸入 pass 之模式(決定起草席與終審席之角色,見 callRoleOf)
 * @param {Function} [o.promptFpOf] 輸入 (評比角色 id) => 指紋字串|null(createPromptFpCache 之 promptFpOf 綁角色與詞彙;未給或回 null 者省略 promptFp)
 * @returns {Object} 回傳 produced(makeProduced 之產物)
 * @throws {Error} makeProduced 檢核不合時拋出(如 stamp 非 14 碼、pkg 格式不合)
 * @example
 * const calls = [
 *     { stage: 'draft1', ok: true, providerId: 'p1', tried: [{ id: 'p1', outcome: 'ok' }] },
 *     { stage: 'draft2', ok: true, providerId: 'p3', tried: [{ id: 'p2#0', outcome: 'fail', errorType: 'timeout' }, { id: 'p3', outcome: 'ok' }] },
 *     { stage: 'integrate', ok: false, providerId: '', tried: [{ id: 'p4', outcome: 'fail', errorType: 'validation' }] },
 *     { stage: 'accept', ok: true, providerId: 'p5', tried: [] },
 * ]
 * const p = producedOfCalls({ calls, stamp: '20261108220000', stage: 'extract', pkg: 'w-demo@1.0.0', at: '2026-11-08T22:00:00+08:00' })
 * console.log(p.steps.map((s) => `${s.role}#${s.seat}:${s.provider}`).join(' '), JSON.stringify(p.failures))
 * // => draft#1:p1 draft#2:p3 accept#0:p5 [{"role":"draft","seat":2,"provider":"p2","type":"timeout"}]
 */
export function producedOfCalls(o) {
    const steps = []
    const failures = []
    for (const c of Array.isArray(o?.calls) ? o.calls : []) {
        if (!c || c.ok !== true || !c.providerId) continue
        const r = callRoleOf(c.stage, o.mode)
        if (!r) continue
        const fp = typeof o.promptFpOf === 'function' ? o.promptFpOf(r.bench) : null
        steps.push({ role: r.role, seat: r.seat, provider: c.providerId, ...(typeof fp === 'string' && fp ? { promptFp: fp } : {}) })
        for (const t of Array.isArray(c.tried) ? c.tried : []) {
            if (!t || t.outcome === 'ok') continue
            const provider = triedProviderOf(t)
            if (!provider) continue
            failures.push({ role: r.role, seat: r.seat, provider, type: String(t.errorType || t.outcome || 'error') })
        }
    }
    const at = typeof o?.at === 'string' && AT_RE.test(o.at) ? { at: o.at } : {}
    if (!steps.length) return makeProduced({ stamp: o.stamp, stage: o.stage, seat: null, provider: null, pkg: o.pkg, ...at })
    return makeProduced({ stamp: o.stamp, stage: o.stage, pkg: o.pkg, ...at, steps, failures })
}

/**
 * 寫入 changelog 之附加欄位(applyDelta 之 ctx.meta 展開):呼叫端供應 producedOf 且其回傳非空者為 { produced },否則 {}——
 *   各 pass 於各棒皆完成後、套用前呼叫一次(之後之棒不入該版之產出鏈)
 *
 * @param {Function} [producedOf] 輸入 () => produced|null
 * @returns {Object} 回傳 { produced } 或 {}
 * @example
 * console.log(producedMetaOf(), producedMetaOf(() => null), producedMetaOf(() => ({ v: 1 })))
 * // => {} {} { produced: { v: 1 } }
 */
export function producedMetaOf(producedOf) {
    const p = typeof producedOf === 'function' ? producedOf() : null
    return p ? { produced: p } : {}
}

/** 不呼叫 AI 之確定性寫入之 stage(規格 §4 之 extract 列舉):標準修正、存量處置、撤出處與恢復、還原撤回等維運(與摘要、關聯套件同名同義) */
export const STANDARDS_FIX_STAGE = 'standards-fix'

/**
 * 不呼叫 AI 之確定性寫入之產出鏈(規格 §2.1 單一形;stage `standards-fix`;`seat`／`provider` 同時 null、無 `promptFp`):寫 changelog 一筆而無 AI 呼叫者
 *   (存量處置 `stock-fix`、撤出處／恢復 `withdraw`／`restore`、還原撤回 `revive`)皆取此;`pkg` 取本套件版(pkgIdOf)
 *
 * @param {Object} [o={}] 輸入
 * @param {String|null} [o.stamp=null] 輸入輪次 stamp(14 碼;輪次內之呼叫者給 ctx.stamp;維運入口未給＝null)
 * @param {String} [o.at] 輸入寫入時刻(格式不合者視為未給,取現在)
 * @returns {Object} 回傳 produced(makeProduced 之產物)
 * @throws {Error} stamp 非 14 碼字串或 null、或套件版取不到時拋出(寫入前即拋,不留半套)
 * @example
 * const p = standardsFixProducedOf({ stamp: '20261108220000', at: '2026-11-08T22:00:00+08:00' })
 * console.log(p.stage, p.stamp, p.seat, p.provider, 'steps' in p, 'promptFp' in p, p.at)
 * // => standards-fix 20261108220000 null null false false 2026-11-08T22:00:00+08:00
 */
export function standardsFixProducedOf(o = {}) {
    const at = typeof o?.at === 'string' && AT_RE.test(o.at) ? { at: o.at } : {}
    return makeProduced({ stamp: o?.stamp ?? null, stage: STANDARDS_FIX_STAGE, seat: null, provider: null, pkg: pkgIdOf(import.meta.url), ...at })
}

export default { CALL_ROLES, STANDARDS_FIX_STAGE, callRoleOf, triedProviderOf, producedOfCalls, producedMetaOf, standardsFixProducedOf }
