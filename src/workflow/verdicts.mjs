// verdicts.mjs — 終審裁決之套用(剔除、存疑、修正;於配號前套用)與其理由之列舉、終審可修之欄位,與仍有效之待審操作之取出(workflow 層)
//
// 【可修者不刪】新增主張與參數之標籤錯誤以 fix 改正;爭議類操作之剔除只收形式理由,內容判斷以存疑(doubt)表達(stores/coreState 檔頭⑧⑨)。
// 【同一份驗證】裁決之驗證與 workflow/reviewGuards 之閘同讀本檔之理由表與可修欄位(FIXABLE_FIELDS;提示詞與程式同一來源)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { DISPUTE_OPS, OFFTOPIC_REASON, REF_FIELDS, TERMINAL_SET, findItem, withdrawnOf } from '../stores/coreState.mjs'
import { textValueOf as str, textListOf as strs, uniq } from '../core/capturePackage.mjs'

/** 終審剔除之理由(列舉);「性質標錯」指操作類別用錯(如應立爭議卻寫成取代或待解問題),標籤錯誤以 fix 改正 */
export const DROP_REASONS = [OFFTOPIC_REASON, '無出處支持', '同篇', '重複', '性質標錯', '捏造']

/** 新增主張(add)與參數(param_add)之剔除理由:其標籤(種類 kind、證據性質 basis、快照 snapshot)可由終審以 fix 改正,故不收「性質標錯」——可修者不刪。
 *  終審仍以此理由剔除者為無效裁決、按未裁決保留(與爭議類理由不合同一機制);否則內容正確之新主張被剔除,引用它之爭議連帶拒收 */
export const NEW_ITEM_DROP_REASONS = DROP_REASONS.filter((r) => r !== '性質標錯')

/** 爭議類操作只接受之剔除理由——只收形式理由(對爭議類操作之直接裁決,終審不可把真實爭議藏掉);且須引用高嚴重度之離題／捏造意見
 *  (workflow/reviewGuards.removalAllowed)。
 *  「兩方非對立」「兩方之對立只出自同一研究」屬內容判斷,終審以 doubt(存疑)表達:爭議照立並加註,拆解另由起草／整併端以 dispute_dissolve 提出、
 *  終審明列保留(以「非對立」剔除時,模型常把真爭議當非對立剔除;stores/coreState 檔頭⑧)。結構上之同篇(兩方皆只有同一篇)由 applyDelta 判定拒收(④),
 *  不需終審剔除(「同篇」若列為剔除理由,與閘門要求之高嚴重度意見兩處不一致)。
 *  間接路徑:剔除爭議所引之新項時爭議連帶拒收——新增主張之標籤錯誤不可剔除(NEW_ITEM_DROP_REASONS),其餘理由之連帶一律記 WARN「提煉終審自相矛盾」 */
export const DISPUTE_DROP_REASONS = [OFFTOPIC_REASON]

/** 存疑之理由(裁決 action:'doubt';只適用於爭議類操作);以 drop＋其中之一表達者視同存疑 */
export const DOUBT_REASONS = ['非對立', '同篇']

/** 拆解操作(dispute_dissolve)之剔除理由:剔除＝保留爭議,另可以「對立成立」剔除 */
export const DISSOLVE_DROP_REASONS = [...DROP_REASONS, '對立成立']

/** 終審 fix 可改之欄位(依操作;不得新增出處:sources 只可刪減)——終審與修訂提示詞自此表列出各操作可改之欄位(提示詞與程式同一來源) */
export const FIXABLE_FIELDS = {
    add: ['text', 'conditions', 'pros', 'cons', 'period', 'critique', 'facet', 'basis', 'kind', 'sources'],
    confirm: ['sources'],
    revise: ['fields', 'reason', 'sources'],
    supersede: ['reason', 'validPeriod', 'sources'],
    retract: ['reason', 'note'],
    contest: ['reason', 'sources'],
    dispute_add: ['question', 'note'],
    dispute_update: ['note', 'status'],
    dispute_dissolve: ['reason', 'kinds', 'annotations'],
    param_add: ['name', 'value', 'conditions', 'period', 'snapshot', 'sources'],
    question_add: ['text'],
    question_resolve: ['resolution', 'sources'],
    essence: ['text', 'claims', 'reason'],
    related_add: ['concepts'],
    split: ['parts', 'reason'],
}

const NEW_ITEM_OPS = new Set(['add', 'param_add'])

/** 操作中所有「指向項目」之欄位值(含同差量之 '@ref') */
function refFields(o) {
    const one = REF_FIELDS.ids.map((k) => o?.[k])
    const many = [...REF_FIELDS.lists.map((k) => o?.[k]), ...(isarr(o?.sides) ? o.sides.map((sd) => sd?.claims) : []), ...(isarr(o?.sides_add) ? o.sides_add.map((sd) => sd?.claims) : [])]
    return [...one, ...many.flatMap((x) => (isarr(x) ? x : []))].filter((x) => typeof x === 'string')
}

/**
 * 套用終審裁決(逐操作:keep／drop／doubt／fix;於配號前套用,故不產生跳號)——終審不得新增操作,fix 不得增加出處
 *
 * @param {Object} delta 輸入送終審之差量 { ops:[...] }
 * @param {Array} verdicts 輸入裁決 [{ i, action:'keep'|'drop'|'doubt'|'fix', reason?, note?, fields? }]，未裁決之操作視為 keep；
 *   doubt(存疑)只適用於爭議類操作:照保留並帶 _doubt,由 applyDelta 記於爭議;爭議類之 drop＋「非對立」視同 doubt
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}(保留供擴充)
 * @returns {Object} 回傳 { delta:{ ops }(保留與修正者,各帶 _i＝差量原序號), dropped:Array({index,op,reason,note,sources}), fixed:Array(index),
 *   removed:Array({note,reason})(fix 刪去之出處), unverdicted:Array(index)(未得有效裁決者;其中終態操作由呼叫端比照降級), verdictRejected:Array({i,reason}),
 *   doubted:Array({index,op,reason,note,byDrop(以 drop＋非對立表達者)}), droppedRefs:Object(被剔除之新項 ref → 剔除理由；交 applyDelta 之 ctx.droppedRefs),
 *   conflicts:Array({kept,dropped,ref,reason})(保留之操作引用被剔除之新項) }
 * @example
 * const delta = { ops: [{ op: 'add', ref: 'r0', kind: 'rule', text: '甲', sources: ['N1'] }, { op: 'add', ref: 'r1', kind: 'rule', text: '乙', sources: ['N2'] }] }
 * const r = applyVerdicts(delta, [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '離題' }])
 * console.log(r.delta.ops.length, r.removed.length, r.unverdicted)
 * // => 1 0 []
 */
export function applyVerdicts(delta, verdicts, opt = {}) {
    if (!isobj(opt)) opt = {}
    const ops = isobj(delta) && isarr(delta.ops) ? delta.ops : []
    const byI = new Map()
    const verdictRejected = []
    // 同一操作重複裁決:兩份相同(逐欄)取首;不同即皆作廢(按未裁決;終審 §3 D5j——不以先後定優劣)
    const voided = new Set()
    for (const v of isarr(verdicts) ? verdicts : []) {
        const i = v?.i
        if (!Number.isInteger(i) || i < 0 || i >= ops.length) {
            verdictRejected.push({ i, reason: 'i 無效' })
            continue
        }
        if (byI.has(i)) {
            if (JSON.stringify(byI.get(i)) === JSON.stringify(v)) continue
            if (!voided.has(i)) {
                voided.add(i)
                verdictRejected.push({ i, reason: '同一操作重複裁決且內容不同（皆作廢，按未裁決）' })
            }
            continue
        }
        byI.set(i, v)
    }
    for (const i of voided) byI.delete(i)
    const kept = []
    const dropped = []
    const fixed = []
    const removed = []
    const unverdicted = []
    const doubted = []
    // 終審之說明(自由文字):單行、限長——入日誌與存疑,不因終審之文字連累差量之操作
    // 裁決說明:文字值之空白壓成一格、取前 240 字(落於狀態之存疑紀錄;不取抓取套件之 oneline——其截斷附「...」,會改變已落盤之字樣)
    const noteOf = (v) => str(v?.note).replace(/\s+/g, ' ').slice(0, 240)
    const srcOf = (o) => uniq([...strs(o?.sources), ...(isarr(o?.sides) ? o.sides.flatMap((sd) => strs(sd?.sources)) : []), ...(isarr(o?.sides_add) ? o.sides_add.flatMap((sd) => strs(sd?.sources)) : [])])
    ops.forEach((op, i) => {
        const v = byI.get(i)
        let action = str(v?.action)
        // 爭議類操作之 drop＋「非對立」＝存疑(認為非對立者不把爭議移除;使用方自訂之裁決提示詞亦同此語意)
        const byDrop = action === 'drop' && DISPUTE_OPS.has(op?.op) && DOUBT_REASONS.includes(str(v?.reason))
        if (byDrop) action = 'doubt'
        if (!v || !action) {
            unverdicted.push(i)
            kept.push({ ...op, _i: i })
            return
        }
        if (action === 'keep') {
            kept.push({ ...op, _i: i })
            return
        }
        if (action === 'doubt') {
            if (!DISPUTE_OPS.has(op?.op)) {
                verdictRejected.push({ i, reason: `存疑只適用於爭議類操作（dispute_add、dispute_update、contest；收到 ${str(op?.op) || '?'}）` })
                unverdicted.push(i)
                kept.push({ ...op, _i: i })
                return
            }
            const reason = DOUBT_REASONS.includes(str(v.reason)) ? str(v.reason) : DOUBT_REASONS[0]
            const note = noteOf(v)
            doubted.push({ index: i, op: str(op.op), reason, note, byDrop })
            kept.push({ ...op, _i: i, _doubt: { reason, note, byDrop } })
            return
        }
        if (action === 'drop') {
            const reason = str(v.reason)
            let okList = DROP_REASONS
            if (op?.op === 'dispute_dissolve') okList = DISSOLVE_DROP_REASONS
            else if (DISPUTE_OPS.has(op?.op)) okList = DISPUTE_DROP_REASONS
            else if (NEW_ITEM_OPS.has(op?.op)) okList = NEW_ITEM_DROP_REASONS
            if (!okList.includes(reason)) {
                // 新增主張／參數之「性質標錯」:標籤可由 fix 改正,不予剔除(按未裁決保留,內容不失;引用它之操作不連帶拒收)
                const who = DISPUTE_OPS.has(op?.op) ? '爭議類操作' : (NEW_ITEM_OPS.has(op?.op) ? '新增主張／參數' : '操作')
                const hint = NEW_ITEM_OPS.has(op?.op) && DROP_REASONS.includes(reason) ? '——標籤（種類、證據性質、快照）請以 fix 改正' : ''
                verdictRejected.push({ i, reason: `${who}之剔除理由須為：${okList.join('、')}（收到「${reason}」${hint}）` })
                unverdicted.push(i)
                kept.push({ ...op, _i: i })
                return
            }
            dropped.push({ index: i, op: str(op?.op) || '?', reason, note: noteOf(v), sources: srcOf(op), ref: str(op?.ref) })
            return
        }
        if (action === 'fix') {
            const allow = FIXABLE_FIELDS[op?.op] || []
            const f = isobj(v.fields) ? v.fields : {}
            const keys = Object.keys(f).filter((k) => allow.includes(k))
            if (!keys.length) {
                verdictRejected.push({ i, reason: 'fix 無可改之欄位' })
                unverdicted.push(i)
                kept.push({ ...op, _i: i })
                return
            }
            const next = { ...op, _i: i }
            for (const k of keys) {
                if (k === 'sources') {
                    const orig = strs(op.sources)
                    const sub = strs(f.sources).filter((x) => orig.includes(x))
                    if (!sub.length) continue // 不得增加出處;刪到全無請用 drop
                    next.sources = sub
                    for (const x of orig) if (!sub.includes(x)) removed.push({ note: x, reason: str(v.reason) })
                }
                else if (k === 'fields') next.fields = { ...(isobj(op.fields) ? op.fields : {}), ...(isobj(f.fields) ? f.fields : {}) }
                else next[k] = f[k]
            }
            fixed.push(i)
            kept.push(next)
            return
        }
        verdictRejected.push({ i, reason: `未知裁決「${action}」` })
        unverdicted.push(i)
        kept.push({ ...op, _i: i })
    })
    // 被剔除之新項(帶 ref)→ 交 applyDelta:引用它們之保留操作拒收時寫明因果;並列出「保留之操作引用被剔除之新項」(依賴衝突)
    const keptRefs = new Set(kept.map((o) => str(o?.ref)).filter(Boolean))
    const droppedRefs = {}
    for (const x of dropped) if (x.ref && !keptRefs.has(x.ref)) droppedRefs[x.ref] = x.reason
    const conflicts = []
    for (const o of kept) {
        for (const f of refFields(o)) {
            const ref = f.startsWith('@') ? f.slice(1) : ''
            const x = ref && droppedRefs[ref] ? dropped.find((d) => d.ref === ref) : null
            if (x) conflicts.push({ kept: o._i, keptOp: str(o.op), dropped: x.index, droppedOp: x.op, ref: f, reason: x.reason })
        }
    }
    return { delta: { ...(isobj(delta) ? delta : {}), ops: kept }, dropped, fixed, removed, unverdicted, verdictRejected, doubted, droppedRefs, conflicts }
}

/** 新增類操作(無既有目標;待審之鍵以 ref 分辨、陳舊只以出處判) */
const NEW_OPS = new Set(['add', 'param_add', 'question_add', 'dispute_add', 'related_add'])

/**
 * 取出仍有效之待審操作(目標已為終態或不存在、或所依出處全數已撤者丟棄;新增類操作無目標,只以出處判),供下次交終審席以獨立差量裁決
 *
 * @param {Object} state 輸入狀態
 * @returns {Object} 回傳 { ops:Array(可交終審之操作,各帶 sources), entries:Array(與 ops 對位之待審項;tries、es9Tries、at、reason), stale:Array(丟棄之待審) }
 * @example
 * console.log(pendingReviewOps(emptyState()))
 * // => { ops: [], entries: [], stale: [] }
 */
export function pendingReviewOps(state) {
    const ops = []
    const entries = []
    const stale = []
    const W = withdrawnOf(state)
    for (const e of isarr(state?.pendingReview) ? state.pendingReview : []) {
        const isNew = NEW_OPS.has(str(e?.op?.op))
        const t = isNew ? null : findItem(state, e?.op?.op === 'merge' ? e.op.into : e?.op?.id)
        const sources = e?.sources || e?.op?.sources || []
        // 所依出處全數已撤(筆記已刪除)者亦屬陳舊:裁決時無原文可核
        if ((!isNew && (!t || TERMINAL_SET.has(t.item.status))) || (sources.length && sources.every((x) => W.has(x)))) stale.push(e)
        else {
            ops.push({ ...e.op, sources })
            entries.push(e)
        }
    }
    return { ops, entries, stale }
}

export default { DROP_REASONS, NEW_ITEM_DROP_REASONS, DISPUTE_DROP_REASONS, DOUBT_REASONS, DISSOLVE_DROP_REASONS, FIXABLE_FIELDS, applyVerdicts, pendingReviewOps }
