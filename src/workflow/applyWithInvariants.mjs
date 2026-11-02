// applyWithInvariants.mjs — 套用一份差量並驗不變式(ES1):違反者逐條剔除後重套——五個 pass(3+3、待審裁決、爭議覆核、存量覆核、失撐找支持)同一份
//
// 【為何只此一份】不變式違反之處置原有兩種:3+3 與待審裁決逐條剔除(保住其餘操作),三專步整批不套(一條違反即丟掉整次已付之判定)——
//   「整批不套用會讓同核心其他項永遠落不了地、每輪白付一次」之理由對三專步同樣成立。
// 【尾端寫入在不變式之前】套用後之尾端寫入(出處排除集、證據重算、涵蓋落帳、待審存入、覆核結案之記帳欄位)由呼叫端以 finish 給,
//   於不變式之前執行——否則驗過之狀態再被改寫,等於沒驗。
// 【逐條剔除】違反時以「保留者＋本條」逐條試套(含 finish),不違反者保留;被剔者記 { op, id, inv }(第一條違反之說明)。全部剔除後仍違反者回 inv 非空
//   (finish 本身改寫了未觸及之條目——程式之錯,呼叫端以失敗處置)。

import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { applyDelta } from '../stores/coreDelta.mjs'
import { checkInvariants } from '../stores/coreState.mjs'
import { textValueOf as str } from '../core/capturePackage.mjs'


/**
 * 套用＋尾端寫入＋不變式;違反者逐條剔除後重套
 *
 * @param {Object} state 輸入套用前狀態(不修改)
 * @param {Array} ops 輸入操作
 * @param {Object} applyCtx 輸入 applyDelta 之 ctx
 * @param {Object} [o={}] 輸入 { finish?:(ap)=>{ state, …extra }(尾端寫入;回物件,state 為寫入後之狀態,其餘鍵原樣回傳), touchedExtra?:Array(不變式另視為觸及之 id),
 *   onDropped?:(dropped, firstInv)=>void(有剔除時、最終重套之前呼叫——呼叫端記日誌、降級,並可改 applyCtx.meta 使最終 changelog 計入) }
 * @returns {Object} 回傳 { ok:Boolean(最終無違反), state, ap(最終之 applyDelta 結果), inv:Array(最終仍違反者), dropped:[{ op, id, inv, raw(原操作) }], firstInv:Array(首次之違反說明;無違反為 []), …finish 之 extra }
 * @example
 * need test in nodejs.
 *
 * const r = applyWithInvariants(state, ops, applyCtx, { finish: (ap) => ({ state: ap.state }) })
 * console.log(r.ok, r.dropped.length)
 */
export function applyWithInvariants(state, ops, applyCtx, o = {}) {
    const list = isarr(ops) ? ops : []
    const finish = isfun(o?.finish) ? o.finish : (ap) => ({ state: ap.state })
    const extraTouched = isarr(o?.touchedExtra) ? o.touchedExtra : []
    const once = (xs) => {
        const ap = applyDelta(state, { ops: xs }, applyCtx)
        const f = finish(ap)
        const after = f && typeof f === 'object' && f.state ? f.state : ap.state
        const { state: _s, ...extra } = f && typeof f === 'object' ? f : {}
        return { ap, state: after, extra, inv: checkInvariants(state, after, { touched: [...ap.touched, ...extraTouched] }) }
    }
    let res = once(list)
    const firstInv = res.inv.slice(0, 20)
    const dropped = []
    if (res.inv.length) {
        const keep = []
        for (const op of list) {
            const t = once([...keep, op])
            if (!t.inv.length) keep.push(op)
            else dropped.push({ op: str(op?.op), id: str(op?.id) || str(op?.into) || str(op?.ref), inv: t.inv[0], raw: op })
        }
        if (isfun(o?.onDropped)) o.onDropped(dropped, firstInv)
        res = once(keep)
    }
    return { ok: !res.inv.length, state: res.state, ap: res.ap, inv: res.inv, dropped, firstInv, ...res.extra }
}

export default { applyWithInvariants }
