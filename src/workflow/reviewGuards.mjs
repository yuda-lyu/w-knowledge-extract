// reviewGuards.mjs — B 段(審計→修訂→終審)之程式守門(純函數):修訂補丁之套用、終審剔除之閘門
//
// 【補丁＋守門(補丁守門)】整份重寫之 B 段會把既有內容改壞(評比平均為負分);改「只輸出補丁、程式套回、守門」後審後不比審前差。
//   補丁守門之六條規則依操作類別映射:
//   ①修訂只輸出 {edits, adds, removes},程式套回,未點名之操作逐字保留;
//   ②要移除「建設性」操作只准:重複(不論嚴重度),或引用嚴重度「高」之離題／捏造意見(中嚴重度之「離題」多落在範圍有爭議或應保留者);
//     意見面之判定只此一份(removalIssueOf;評分之審計角色 wf-audit 之謂詞 flags 共用);
//     移除「破壞性」操作一律放行(＝保住既有知識);
//   ③改寫只限該操作之可改欄位(FIXABLE_FIELDS),不得改 op 與目標 id;改寫文字須保有原文過半(包含率 ≥0.5);
//   ④「假爭議」不是移除理由(爭議類操作只能以離題移除且須引用高嚴重度之離題／捏造意見——coreState.DISPUTE_DROP_REASONS;
//     非對立、同篇為存疑——workflow/verdicts 之 DOUBT_REASONS);
//   ⑤新增之操作須對應某條審計意見(補遺漏),並過同一套操作守門(數字紮根、可見性);
//   ⑥終審之剔除同②;其餘裁決交 workflow/verdicts 之 applyVerdicts。

import { FIXABLE_FIELDS, DISPUTE_DROP_REASONS, DOUBT_REASONS } from './verdicts.mjs'
import { opLengthProblem } from '../stores/coreDelta.mjs'
import { DISPUTE_OPS } from '../stores/coreState.mjs'
import { containment } from '../guards/similarity.mjs'
import { opClass } from '../standards/opGuards.mjs'
import { STD_ISSUE_TYPE } from '../standards/opStandards.mjs'
import { refsOf } from './candidates.mjs'
import { textValueOf as str, jsonClone as clone } from '../core/capturePackage.mjs'

/** revise 操作之新內容在其 fields 之內;修訂員常直接寫 {"fields":{"text":…}}(不認則對 revise 之 edit 全數因「無可改之欄位」被擋) */
const REVISE_INNER = new Set(['text', 'conditions', 'pros', 'cons', 'period', 'critique', 'basis', 'name', 'value', 'kind', 'facet'])
/**
 * 補丁 adds 之操作缺 "op" 時,依欄位推定(只推定無歧義者;修訂員常把完整操作放進 adds 卻漏了 "op":"add")
 *
 * @param {Object} o 輸入操作物件
 * @returns {Object} 回傳補上 op 之新物件(推定不了則原樣)
 * @example
 * console.log(inferOp({ ref: 'r0', kind: 'rule', text: '甲', sources: ['N1'] }), inferOp({ text: '乙' }))
 * // => { ref: 'r0', kind: 'rule', text: '甲', sources: [ 'N1' ], op: 'add' } { text: '乙' }
 */
export function inferOp(o) {
    if (!o || typeof o !== 'object' || str(o.op)) return o
    if (str(o.kind) && str(o.text)) return { ...o, op: 'add' }
    if (str(o.name) && o.value !== undefined) return { ...o, op: 'param_add' }
    if (str(o.question) && Array.isArray(o.sides)) return { ...o, op: 'dispute_add' }
    return o
}
/**
 * 「高」嚴重度之字樣(補丁守門與終審剔除之閘以之判讀;評分之審計角色同讀)
 *
 * @type {Set}
 */
export const SEV_HIGH = new Set(['高', 'high', 'High', 'HIGH', '嚴重'])
/**
 * 審計意見之類型(程式判讀與提示詞同一來源:補丁守門以之判讀;審計、修訂之提示詞與終審附錄之字樣由之產生——覆寫提示詞者須沿用此組類型):
 *   fabricated 捏造、offTopic 離題(建設性操作之移除須引用其「高」嚴重度者)、duplicate 重複(移除之理由)、
 *   overLength 超限(程式意見:超過長度上限;workflow/runPass 之 lengthIssues)、standard 檢定標準(程式意見;standards/opStandards 之 STD_ISSUE_TYPE)
 *
 * @type {Object}
 */
export const ISSUE_TYPES = Object.freeze({ fabricated: '捏造', offTopic: '離題', duplicate: '重複', overLength: '超限', standard: STD_ISSUE_TYPE })
/**
 * 建設性操作之移除須有之意見類型(引用「高」嚴重度者)
 *
 * @type {Array}
 */
export const REMOVE_TYPES = [ISSUE_TYPES.offTopic, ISSUE_TYPES.fabricated]

/**
 * 意見是否指向某操作(ref＝操作之 _oid、目標 id 或新項之 ref;補丁守門、終審剔除之閘與評分之審計角色同一判準)。
 *   ref 為空(審計回覆之意見可不帶 ref,checkAudit 只要求 issues 為陣列,正規化後 ref 為空字串)不指向任何操作——
 *   否則空字串會與一切無 id、無 ref 之操作(多數新增主張)相符,使缺 ref 之意見成為移除之放行依據
 *
 * @param {Object} x 輸入正規化之審計意見(normalizeIssues 之項)
 * @param {Object} op 輸入操作(帶 _oid)
 * @returns {Boolean} 回傳是否指向該操作
 * @example
 * console.log(issueOnOp({ ref: 'a1_2' }, { op: 'add', _oid: 'a1_2' }), issueOnOp({ ref: 'C3' }, { op: 'revise', id: 'C3', _oid: 'i_1' }), issueOnOp({ ref: '' }, { op: 'add', _oid: 'a1_2' }))
 * // => true true false
 */
export const issueOnOp = (x, op) => !!x.ref && (x.ref === op._oid || x.ref === str(op.id) || x.ref === str(op.ref))

/**
 * 審計意見正規化:ref(操作 id 或條目 id)、severity、type、detail、fix
 *
 * @param {*} issues 輸入審計回傳之 issues
 * @returns {Array} 回傳 [{ k, ref, severity, type, detail, fix }]
 * @example
 * console.log(normalizeIssues([{ ref: 'a1_0', severity: '高', type: '離題', detail: '與本概念無關', fix: '剔除' }, null]))
 * // => [
 * //   {
 * //     k: 0,
 * //     ref: 'a1_0',
 * //     severity: '高',
 * //     type: '離題',
 * //     detail: '與本概念無關',
 * //     fix: '剔除'
 * //   }
 * // ]
 */
export function normalizeIssues(issues) {
    return (Array.isArray(issues) ? issues : []).filter((x) => x && typeof x === 'object').map((x, k) => ({
        k,
        ref: str(x.ref || x.target || x.where),
        severity: str(x.severity),
        type: str(x.type),
        detail: str(x.detail).slice(0, 400),
        fix: str(x.fix).slice(0, 300),
    }))
}

/** 只問「重複」(removalAllowed 之重複條) */
const DUP_ONLY = Object.freeze([ISSUE_TYPES.duplicate])

/**
 * 移除判準之意見面(單一來源):哪一筆審計意見足以使某建設性操作被移除——意見指向該操作(issueOnOp),且依其類型:
 *   「重複」不論嚴重度;「離題」「捏造」須「高」嚴重度(SEV_HIGH);其餘類型(超限、檢定標準、措辭…)不足。
 *   removalAllowed(修訂之 removes、終審之剔除閘)與評分之審計角色(wf-audit 之謂詞 flags:植入之缺陷是否被指出)共用此一份——
 *   審計提示詞之「高」＝不改會留下錯誤知識或遺失知識,「重複」兩者皆非,故模型標中嚴重度之重複屬正確,正式之修訂、終審照樣依之移除。
 *   只含意見面:操作類別(破壞性操作移除不需意見)、爭議類操作之移除理由(須為「離題」或有高嚴重度意見)、移除方自述之理由(終審 drop 之 reason)
 *   屬操作與移除方之性質,不在意見之內,仍由 removalAllowed 判
 *
 * @param {Object} op 輸入操作(帶 _oid;或 id、ref)
 * @param {Array} issues 輸入正規化之審計意見(normalizeIssues 之項);非陣列視同無意見
 * @param {Array} [types=[ISSUE_TYPES.duplicate, ...REMOVE_TYPES]] 輸入限定之意見類型(ISSUE_TYPES 之重複／離題／捏造之子集;給了只問「以這些類型」是否足以;不在其中之類型恆不足;未給＝三者皆可)
 * @returns {Object|undefined} 回傳第一筆足以移除該操作之意見;無則 undefined
 * @example
 * const issues = normalizeIssues([{ ref: 'a1_2', severity: '中', type: '重複', detail: '與 a1_1 同義', fix: '刪除' }, { ref: 'a1_3', severity: '中', type: '捏造', detail: '出處未載', fix: '刪除' }])
 * console.log(removalIssueOf({ _oid: 'a1_2' }, issues)?.type, removalIssueOf({ _oid: 'a1_3' }, issues)?.type, removalIssueOf({ _oid: 'a1_2' }, issues, [ISSUE_TYPES.fabricated])?.type)
 * // => 重複 undefined undefined
 */
export function removalIssueOf(op, issues, types = [ISSUE_TYPES.duplicate, ...REMOVE_TYPES]) {
    if (!Array.isArray(issues) || !Array.isArray(types)) return undefined
    return issues.find((x) => issueOnOp(x, op) && types.some((t) => x.type.includes(t) && (t === ISSUE_TYPES.duplicate || (REMOVE_TYPES.includes(t) && SEV_HIGH.has(x.severity)))))
}

/**
 * 移除一條操作是否合法(補丁守門,依類別)
 *
 * @param {Object} op 輸入操作
 * @param {Object} state 輸入目前狀態
 * @param {Array} issues 輸入正規化之審計意見
 * @param {String} [reason=''] 輸入移除方自述之理由(終審 drop 之 reason)
 * @returns {Object} 回傳 { ok:Boolean, why:String, kind?:String(不許時之型別碼;core/rejectKinds 之 reviseBlocked 組:removal-dispute-not-offtopic、severity-too-low) }
 * @example
 * console.log(removalAllowed({ _oid: 'a1_0', op: 'add', kind: 'rule', text: '甲', sources: ['N1'] }, emptyState(), [], ''))
 * // => {
 * //   ok: false,
 * //   why: '建設性操作只准以「重複」或「高」嚴重度之離題／捏造意見移除（中、低嚴重度請修訂措辭）',
 * //   kind: 'severity-too-low'
 * // }
 */
export function removalAllowed(op, state, issues, reason = '') {
    if (opClass(op, state) === 'destructive') return { ok: true, why: '破壞性操作，移除即保住既有知識' }
    if (DISPUTE_OPS.has(op.op) && !DISPUTE_DROP_REASONS.includes(str(reason)) && !removalIssueOf(op, issues, REMOVE_TYPES)) {
        return { ok: false, why: `爭議類操作只能以「${DISPUTE_DROP_REASONS.join('」「')}」移除（假爭議不是移除理由）`, kind: 'removal-dispute-not-offtopic' }
    }
    if (removalIssueOf(op, issues, DUP_ONLY) || str(reason) === '重複') return { ok: true, why: '重複' }
    if (removalIssueOf(op, issues, REMOVE_TYPES)) return { ok: true, why: '引用高嚴重度之離題／捏造意見' }
    return { ok: false, why: '建設性操作只准以「重複」或「高」嚴重度之離題／捏造意見移除（中、低嚴重度請修訂措辭）', kind: 'severity-too-low' }
}

/**
 * 套用修訂補丁 {edits, adds, removes}(依 ref＝操作之 _oid 定位;不以序號,序號會因移除而位移)
 *
 * @param {Array} ops 輸入整合後之操作(帶 _oid)
 * @param {Object} patch 輸入修訂回傳
 * @param {Object} ctx 輸入 { state, issues(正規化), guard:(ops)=>{ops,rejected}(新增操作之操作守門), limits?(長度上限,同 applyDelta;未給用 DEFAULT_LIMITS),
 *        problemsOf?:(ops)=>Map(op → 檢定標準問題)(extract/standards/opStandards;給了即「補丁不得新增問題、新增須已合標準」) }
 * @returns {Object} 回傳 { ops, log:Array({act,ref,ok,why,kind?(被擋者之型別碼;core/rejectKinds 之 reviseBlocked 組)}), droppedRefs:Object(被移除之新項 ref → '修訂移除';交 applyDelta 之 ctx.droppedRefs——引用者拒收時寫明根因) }
 * @example
 * need test in nodejs.
 *
 * const r = applyPatch(ops, { edits: [{ ref: 'a1_0', fields: { text: '改寫後之主張' } }], adds: [], removes: [] }, { state, issues, guard })
 * console.log(r.ops.length)
 */
export function applyPatch(ops, patch, ctx = {}) {
    const issues = Array.isArray(ctx.issues) ? ctx.issues : []
    const state = ctx.state
    let out = ops.map(clone)
    const log = []
    const droppedRefs = {}
    const find = (ref) => out.find((o) => o._oid === str(ref) || (str(o.ref) && str(o.ref) === str(ref)))
    for (const r of Array.isArray(patch?.removes) ? patch.removes : []) {
        const ref = str(r?.ref ?? r)
        const op = find(ref)
        if (!op) { log.push({ act: 'remove', ref, ok: false, why: '找不到操作', kind: 'op-not-found' }); continue }
        const issueRef = r?.issue
        const iss = issues.filter((x) => str(issueRef) && (String(x.k) === str(issueRef) || x.ref === str(issueRef)))
        const allIss = iss.length ? [...iss, ...issues] : issues
        const v = removalAllowed(op, state, allIss, str(r?.reason))
        if (!v.ok) { log.push({ act: 'remove', ref, ok: false, why: v.why, kind: v.kind }); continue }
        out = out.filter((o) => o !== op)
        log.push({ act: 'remove', ref, ok: true, why: v.why })
        // 被移除者為新項(帶 ref)→ 引用它之操作一併移除(建設性者同受移除判準,不合者留著、套用時以根因拒收;破壞性者放行);ref 記為修訂移除
        if (str(op.ref)) {
            droppedRefs[str(op.ref)] = '修訂移除'
            for (const dep of out.filter((o) => o !== op && refsOf(o).includes(str(op.ref)))) {
                const dv = removalAllowed(dep, state, allIss, str(r?.reason))
                if (!dv.ok) { log.push({ act: 'remove', ref: dep._oid, ok: false, why: `引用已移除之新項 @${str(op.ref)}，但${dv.why}`, kind: dv.kind }); continue }
                out = out.filter((o) => o !== dep)
                log.push({ act: 'remove', ref: dep._oid, ok: true, why: `引用已移除之新項 @${str(op.ref)}（${dv.why}）` })
            }
        }
    }
    for (const e of Array.isArray(patch?.edits) ? patch.edits : []) {
        const ref = str(e?.ref)
        const op = find(ref)
        if (!op) { log.push({ act: 'edit', ref, ok: false, why: '找不到操作', kind: 'op-not-found' }); continue }
        const allow = FIXABLE_FIELDS[op.op] || []
        let fields = e?.fields && typeof e.fields === 'object' ? { ...e.fields } : {}
        if (op.op === 'revise') {
            const inner = Object.fromEntries(Object.entries(fields).filter(([k]) => REVISE_INNER.has(k)))
            if (Object.keys(inner).length) {
                for (const k of Object.keys(inner)) delete fields[k]
                fields.fields = { ...(fields.fields && typeof fields.fields === 'object' ? fields.fields : {}), ...inner }
            }
        }
        if (op.op === 'param_add' && fields.note !== undefined && fields.conditions === undefined) {
            fields.conditions = fields.note
            delete fields.note
        }
        const keys = Object.keys(fields).filter((k) => allow.includes(k) && k !== 'sources')
        if (!keys.length) { log.push({ act: 'edit', ref, ok: false, why: `無可改之欄位（試改：${Object.keys(fields).join('、') || '無'}；${op.op} 可改：${allow.join('、')}）`, kind: 'no-editable-field' }); continue }
        let bad = ''
        const next = clone(op)
        for (const k of keys) {
            const before = typeof op[k] === 'string' ? op[k] : (k === 'fields' ? JSON.stringify(op.fields || {}) : '')
            const after = fields[k]
            if (typeof after === 'string' && before && ['text', 'question', 'position', 'name', 'value', 'resolution'].includes(k) && containment(before, after) < 0.5) {
                bad = `改寫 ${k} 未保有原文過半（包含率須 ≥0.5）`
                break
            }
            if (k === 'fields' && after && typeof after === 'object' && str(after.text) && str(op.fields?.text) && containment(str(op.fields.text), str(after.text)) < 0.5) {
                bad = '改寫 fields.text 未保有原文過半（包含率須 ≥0.5）'
                break
            }
            if (k === 'fields') next.fields = { ...(op.fields || {}), ...(typeof after === 'object' ? after : {}) }
            else next[k] = after
        }
        if (bad) { log.push({ act: 'edit', ref, ok: false, why: bad, kind: 'text-overwrite' }); continue }
        const g = typeof ctx.guard === 'function' ? ctx.guard([next]) : { ops: [next], rejected: [] }
        if (!g.ops.length) { log.push({ act: 'edit', ref, ok: false, why: g.rejected[0]?.reason || '守門拒收', kind: 'guard-rejected' }); continue }
        // 審後不得比審前差:補丁使本條由合格變超限(套用時必被拒收)者不採,保留原稿;原本就超限者不在此擋(交定稿前處置)
        const lp = opLengthProblem(g.ops[0], ctx.limits)
        if (lp && !opLengthProblem(op, ctx.limits)) { log.push({ act: 'edit', ref, ok: false, why: `補丁使本條超限（${lp}），保留原稿`, kind: 'over-limit' }); continue }
        // 審後不得比審前差(檢定標準):補丁使本條新增問題(新的未紮根數字、新提及筆記、新缺標注…)者不採,保留原稿;減少問題者照採
        if (typeof ctx.problemsOf === 'function') {
            const keys = (ps) => (Array.isArray(ps) ? ps : []).flatMap((p) => (Array.isArray(p.items) ? p.items : [p.detail]).map((i) => `${p.std}|${p.field}|${i}`))
            const before = new Set(keys(ctx.problemsOf(out).get(op)))
            const trialOut = out.map((o) => (o === op ? g.ops[0] : o))
            const added = keys(ctx.problemsOf(trialOut).get(g.ops[0])).filter((k) => !before.has(k))
            if (added.length) { log.push({ act: 'edit', ref, ok: false, why: `補丁使本條新增檢定標準問題（${added.slice(0, 3).join('、')}），保留原稿`, kind: 'new-standard-issue' }); continue }
        }
        out = out.map((o) => (o === op ? g.ops[0] : o))
        log.push({ act: 'edit', ref, ok: true, why: keys.join('、') })
    }
    let n = 0
    for (const a of Array.isArray(patch?.adds) ? patch.adds : []) {
        let op = a?.op && typeof a.op === 'object' ? clone(a.op) : (a && typeof a === 'object' ? clone(a) : null)
        if (op && op.issue !== undefined) delete op.issue
        op = inferOp(op)
        const issueRef = str(a?.issue)
        if (!op || !str(op.op)) { log.push({ act: 'add', ok: false, why: '新增缺 op', kind: 'add-op-missing' }); continue }
        if (!issueRef || !issues.some((x) => String(x.k) === issueRef || x.ref === issueRef)) { log.push({ act: 'add', ok: false, why: '新增須對應某條審計意見（issue）', kind: 'add-needs-issue' }); continue }
        const g = typeof ctx.guard === 'function' ? ctx.guard([op]) : { ops: [op], rejected: [] }
        if (!g.ops.length) { log.push({ act: 'add', ok: false, why: g.rejected[0]?.reason || '守門拒收', kind: 'guard-rejected' }); continue }
        const lp = opLengthProblem(g.ops[0], ctx.limits)
        if (lp) { log.push({ act: 'add', ok: false, why: `新增超限（${lp}），套用時必被拒收`, kind: 'over-limit' }); continue }
        // 新增之操作(補遺漏)須已合檢定標準:定稿時不合者不採,此處先擋——它不再有修訂機會
        if (typeof ctx.problemsOf === 'function') {
            const ps = ctx.problemsOf([...out, g.ops[0]]).get(g.ops[0])
            if (ps?.length) { log.push({ act: 'add', ok: false, why: `新增未達檢定標準（${ps.map((p) => `${p.std}：${p.detail}`).slice(0, 2).join('；')}）`, kind: 'add-standard-issue' }); continue }
        }
        n++
        const added = { ...g.ops[0], _oid: `b2_${n}`, _via: [`issue:${issueRef}`] }
        out.push(added)
        log.push({ act: 'add', ref: added._oid, ok: true, why: `補遺漏（意見 ${issueRef}）` })
    }
    return { ops: out, log, droppedRefs }
}

/**
 * 終審裁決之閘門:剔除建設性操作須合補丁守門(否則改為 keep 並記錄);以 ref(_oid)或 i 定位,回傳以 i 為鍵之裁決供 applyVerdicts;
 *   定位不到之裁決(非物件、i 與 ref 皆無效)列 rejected(不靜默;終審 §3 D5j)
 *
 * @param {Array} ops 輸入送終審之操作(順序即 i)
 * @param {Array} verdicts 輸入終審回傳之 verdicts
 * @param {Object} ctx 輸入 { state, issues }
 * @returns {Object} 回傳 { verdicts:Array(以 i 為鍵), blocked:Array({i,why}), rejected:Array({ i, reason }) }
 * @example
 * need test in nodejs.
 *
 * const g = gateVerdicts(ops, [{ i: 0, action: 'drop', reason: '離題' }], { state, issues })
 * console.log(g.rejected)
 */
export function gateVerdicts(ops, verdicts, ctx = {}) {
    const issues = Array.isArray(ctx.issues) ? ctx.issues : []
    const out = []
    const blocked = []
    const rejected = []
    for (const v of Array.isArray(verdicts) ? verdicts : []) {
        if (!v || typeof v !== 'object') {
            rejected.push({ i: v, reason: `裁決非物件（${JSON.stringify(v)}）` })
            continue
        }
        let i = Number.isInteger(v.i) ? v.i : ops.findIndex((o) => o._oid === str(v.ref))
        if (!(i >= 0 && i < ops.length)) {
            rejected.push({ i: v.i ?? v.ref, reason: `裁決定位不到操作（i=${JSON.stringify(v.i)}、ref=${JSON.stringify(v.ref)}；操作 0～${ops.length - 1}）` })
            continue
        }
        if (str(v.action) === 'drop') {
            // 爭議類操作以 drop＋「非對立」表達者是存疑而非剔除(applyVerdicts 轉為 doubt:照套、記於爭議),不受剔除之閘門——
            //   擋成 keep 會把終審之存疑丟掉
            if (DISPUTE_OPS.has(ops[i]?.op) && DOUBT_REASONS.includes(str(v.reason))) {
                out.push({ ...v, i })
                continue
            }
            const ok = removalAllowed(ops[i], ctx.state, issues, str(v.reason))
            if (!ok.ok) {
                blocked.push({ i, why: ok.why })
                out.push({ ...v, i, action: 'keep', note: `${str(v.note)}（程式擋下剔除：${ok.why}）`.slice(0, 240) })
                continue
            }
        }
        out.push({ ...v, i })
    }
    return { verdicts: out, blocked, rejected }
}

export default { ISSUE_TYPES, SEV_HIGH, REMOVE_TYPES, issueOnOp, inferOp, normalizeIssues, removalIssueOf, removalAllowed, applyPatch, gateVerdicts }
