// opStandards.mjs — 提煉之納入閘:差量操作於套用前之檢定標準(新進;規則函數與存量掃描 coreStandards 同一組)
//
// 【時機】整合後之操作 → 不合者成「檢定標準」程式意見(與超限意見同列,交修訂;issuesOf)→
//   定稿(終審後)再檢一次,仍不合者不採(screen;其 ref 記為已剔除,引用它之操作拒收時寫明根因)。待審裁決之定稿同一檢定器。
//   先修正再剔除:修訂員看得到每條意見之修法;只有定稿仍不合才不採——不以「拒收」取代「修訂機會」。
// 【逐操作之標準】
//   ES2 數字紮根:本操作文字(理由除外)之數字須見於「本操作所引出處之內容(內容章＋原文標題＋發布時間;不含投影章)＋所觸及既有條目
//       之全文(含利弊銳評)＋同差量所引新項之文字與出處」;材料有不可得者而有未紮根之數字 → 未能判定(亦不採)。
//   ES16 本質:數字紮根於所引主張之出處(不含主張文字)。
//   ES4 標注:新主張(add、split 各部、dispute_dissolve 各方)與改到標注或種類之 revise,其結果須合 annotationProblems。
//   ES12 principle 跨篇:新主張或由他種改為 principle 者,存活出處之相異文件 ≥2(以文件計;同一研究之多篇筆記只算一份)。
//   ES13 弱證據參數:param_add 之程式判定證據等級為最低級或未評估者,conditions 須含限制語(自承限制片語或 weakEvidence 句)。
//   ES17 不提及筆記:文字(理由除外)不得有筆記連結 [[…]] 或本批代號(N3;「N95」等非本批代號不算)。
//   外洩:全部文字欄(含理由——理由入沿革與 md「理由」)不得有流程用語(LEAK_PHRASES);新進與待審兩路同一判定、同一免檢欄。
// 【結果類標準以試套判定】ES4／ES12／ES13 以 applyDelta 試套整份差量(含證據重算)後之條目判定——與 checkCore 對落地狀態之判定同一份
//   規則函數,不另寫「推測套用結果」之碼(拆分各部、拆解各方之主張由 applyDelta 產生)。
// 【閘之組合只此一份】「操作守門 → 納入閘」之組合(gateOps)與檢定器之 ctx(opStandardsCtxOf)、applyDelta 之 ctx(applyCtxOf)各只一份:3+3 之定稿與修訂後重篩、
//   待審裁決、爭議覆核之拆解、存量修訂、評分之案皆取之——同一組合手寫八份時,失敗之轉接各不相同(有的丟守門之理由、有的把守門當納入閘之問題)。
//   守門函數由呼叫端注入(guard;本檔不匯入 workflow 之守門件),別名改寫(remap)亦由呼叫端給。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { STATUS, noteDocIdOf, textValueOf as str, textListOf as strs, uniq } from '../core/capturePackage.mjs'
import { codeMapOf, notesOfCodes, opSidesOf, findItem, liveSourcesOf, withdrawnOf } from '../stores/coreState.mjs'
import { applyDelta } from '../stores/coreDelta.mjs'
import { textFieldsOf } from './opGuards.mjs'
import { itemTexts, annotationProblems, principleDocsProblem, noteMentionsOf, groundingOf, leakProblem, weakEvidenceProblem, ANNOTATION_UNSTATED } from './coreStandards.mjs'
import { RELATE_SECTION_TITLES } from '../core/relatePackage.mjs'

/** 程式意見之類型(與審計意見同列交修訂) */
export const STD_ISSUE_TYPE = '檢定標準'

/** 理由欄:說明「為何這樣改」,入沿革與 statusNote;不受紮根與提及筆記之檢(外洩仍檢) */
const META_PATHS = new Set(['reason'])
/** revise 改到這些欄位才以結果檢 ES4 */
const ANNOTATION_KEYS = ['kind', 'critique', 'pros', 'cons', 'period', 'conditions']

/** 各標準之修法(交修訂員) */
const FIX = {
    ES2: `改用所引出處中之數字，或刪去該數字；${RELATE_SECTION_TITLES.conflicts}章中他篇之數字，須把該他篇列為出處才可使用`,
    ES2u: '刪去無法核對之數字（其出處內容不可得）',
    ES16: '改用所引主張之出處中之數字，或刪去該數字',
    ES4: `補上標注：銳評(critique)必填；principle／rule 之利(pros)、弊(cons)寫出處之內容，出處沒有時寫「${ANNOTATION_UNSTATED}」；temporal 寫 period；pitfall 寫 conditions`,
    ES12: '改為 rule 或其他種類，或補上另一份文件之出處（同一研究之多篇筆記只算一份）',
    ES13: '在 conditions 註明證據之限制',
    ES17: '改寫為內容本身；出處由 sources 欄記錄，文字中不提筆記代號或連結',
    leak: '刪去編修經過之用語，只寫知識內容',
}

/**
 * 建立一個 pass 之操作檢定器
 *
 * @param {Object} ctx 輸入 { state(目前狀態), batch:[{ code, id }], contentOf:(noteId)=>String|null(出處筆記之內容章＋原文標題＋發布時間),
 *        docIdOf:(noteId)=>String(ES12;未給則以筆記 id 當文件), applyCtx:Object(applyDelta 之 ctx;ES4／ES12／ES13 之試套,未給則不檢),
 *        evidence?:{ apply, levels, selfLimitOf }(ES13;未給則不檢), notesById?:Map(證據重算用), weakEvidence?:String(ES13 另認之限制句) }
 * @returns {Object} 回傳 { problemsOf(ops):Map(op → 問題陣列), issuesOf(ops):Array(審計意見形狀), screen(ops, o?):{ ops, rejected, droppedRefs } }
 * @example
 * need test in nodejs.
 *
 * const std = createOpStandards({ state, batch, contentOf, docIdOf, applyCtx, evidence })
 * const problems = std.check(ops)
 */
export function createOpStandards(ctx = {}) {
    const state = ctx.state
    const W = withdrawnOf(state)
    const codeMap = codeMapOf(ctx.batch)
    const codes = new Set([...codeMap.keys()].filter((k) => /^N\d+$/.test(k)))
    const contentOf = isfun(ctx.contentOf) ? ctx.contentOf : () => null
    const docIdOf = isfun(ctx.docIdOf) ? ctx.docIdOf : (id) => id
    const contentTexts = (op) => textFieldsOf(op).filter((f) => !META_PATHS.has(f.path))

    /**
     * 本操作之紮根材料:所引出處筆記 id 與所觸及條目之全文
     * @param {Object} op 輸入操作
     * @param {Map} refOps 輸入同差量之 ref → 操作
     * @returns {Object} 回傳 { notes:Array(筆記 id), texts:Array(條目全文) }
     */
    const materialOf = (op, refOps) => {
        const notes = new Set([...notesOfCodes(codeMap, op.sources), ...opSidesOf(op).flatMap((sd) => notesOfCodes(codeMap, sd?.sources))])
        const texts = []
        const seen = new Set()
        const addItem = (id) => {
            if (!id || seen.has(id)) return
            seen.add(id)
            if (id.startsWith('@')) {
                const r = refOps.get(id.slice(1))
                if (!r) return
                texts.push(...contentTexts(r).map((f) => f.text))
                for (const n of [...notesOfCodes(codeMap, r.sources), ...opSidesOf(r).flatMap((sd) => notesOfCodes(codeMap, sd?.sources))]) notes.add(n)
                return
            }
            const h = findItem(state, id)
            if (!h) return
            texts.push(...itemTexts(h.key, h.item).map((x) => x.text))
            for (const n of liveSourcesOf(h.item, state, W)) notes.add(n)
            if (h.key === 'disputes') {
                for (const sd of h.item.sides || []) {
                    for (const n of strs(sd?.sources).filter((x) => !W.has(x))) notes.add(n)
                    for (const cid of strs(sd?.claims)) addItem(cid)
                }
            }
            if (h.key === 'parameters' && str(h.item.claim)) addItem(str(h.item.claim))
        }
        const ids = [op.id, op.into, op.by, op.dispute, op.claim, ...strs(op.from), ...strs(op.claims), ...opSidesOf(op).flatMap((sd) => strs(sd?.claims))].map(str).filter(Boolean)
        for (const id of ids) addItem(id)
        return { notes: [...notes], texts }
    }

    /**
     * 本質所引主張之出處(ES16 之材料)
     * @param {Object} op 輸入 essence 操作
     * @param {Map} refOps 輸入 ref → 操作
     * @returns {Array} 回傳筆記 id
     */
    const essenceSources = (op, refOps) => uniq(strs(op.claims).flatMap((cid) => {
        if (cid.startsWith('@')) return notesOfCodes(codeMap, refOps.get(cid.slice(1))?.sources)
        const h = findItem(state, cid)
        return h ? liveSourcesOf(h.item, state, W) : []
    }))

    /**
     * 試套整份差量(含證據重算):各操作所產生或改動之主張與參數(ES4／ES12／ES13 依此判定)
     * @param {Array} ops 輸入操作
     * @param {Object} [o={}] 輸入 { droppedRefs }
     * @returns {Map|null} 回傳 op → [{ field, item, key, changedKind? }];未給 applyCtx 回 null
     */
    const trialOf = (ops, o = {}) => {
        if (!isobj(ctx.applyCtx)) return null
        const r = applyDelta(state, { ops }, { ...ctx.applyCtx, ...(isobj(o.droppedRefs) ? { droppedRefs: o.droppedRefs } : {}) })
        const T = r.state
        if (isfun(ctx.evidence?.apply) && ctx.notesById instanceof Map) ctx.evidence.apply(T, ctx.notesById)
        const byIndex = new Map(ops.map((op, p) => [Number.isInteger(op?._i) ? op._i : p, op]))
        const version = (Number(state?.version) || 0) + 1
        const out = new Map()
        const put = (op, x) => out.set(op, [...(out.get(op) || []), x])
        for (const a of r.applied) {
            const op = byIndex.get(a.index)
            if (!op) continue
            const hit = a.id ? findItem(T, a.id) : null
            if (op.op === 'add' && !a.asConfirm && hit?.key === 'claims') put(op, { field: '', key: 'claims', item: hit.item })
            else if (op.op === 'revise' && hit?.key === 'claims' && isobj(op.fields) && ANNOTATION_KEYS.some((k) => op.fields[k] !== undefined)) {
                const before = findItem(state, a.id)?.item
                put(op, { field: 'fields', key: 'claims', item: hit.item, changedKind: str(op.fields.kind) && str(op.fields.kind) !== str(before?.kind) })
            }
            else if (op.op === 'split' && hit) for (const [k, id] of strs(hit.item.splitInto).entries()) put(op, { field: `parts[${k}]`, key: 'claims', item: findItem(T, id)?.item })
            else if (op.op === 'dispute_dissolve' && a.id) {
                // 拆出之主張:沿革首筆「拆自 D? side k」(applyDelta);問題記在可修之 annotations[k]
                for (const c of T.claims) {
                    const m = c.addedIn === version && c.origin === 'dispute' ? new RegExp(`^拆自 ${a.id} side (\\d+)$`).exec(str(c.history?.[0]?.note)) : null
                    if (m) put(op, { field: `annotations[${m[1]}]`, key: 'claims', item: c })
                }
            }
            else if (op.op === 'param_add' && hit?.key === 'parameters') put(op, { field: 'conditions', key: 'parameters', item: hit.item })
        }
        return out
    }

    /**
     * 各操作之問題
     * @param {Array} ops 輸入操作(整份差量)
     * @param {Object} [o={}] 輸入 { droppedRefs }
     * @returns {Map} 回傳 op → [{ std, field, detail, fix }](無問題者不在其中)
     */
    const problemsOf = (ops, o = {}) => {
        const list = (isarr(ops) ? ops : []).filter(isobj)
        const refOps = new Map(list.filter((op) => str(op.ref)).map((op) => [str(op.ref), op]))
        const trial = trialOf(list, o)
        const out = new Map()
        for (const op of list) {
            const ps = []
            // items:問題之構成單位(未紮根之數字、提及之字樣、缺之標注…);補丁「不得新增問題」以 std|field|item 比對
            const add = (std, field, detail, fix, items) => ps.push({ std, field, detail, fix: fix || FIX[std], items: isarr(items) && items.length ? items : [detail] })
            // 外洩(全部文字欄,含理由)
            for (const f of textFieldsOf(op)) {
                const hit = leakProblem(f.text)
                if (hit) add('leak', f.path, `文字含流程用語「${hit}」`, FIX.leak, [hit])
            }
            // ES17 不提及筆記
            for (const f of contentTexts(op)) {
                const m = uniq(noteMentionsOf(f.text, codes))
                if (m.length) add('ES17', f.path, `文字提及筆記（${m.slice(0, 4).join('、')}）`, FIX.ES17, m)
            }
            // ES2／ES16 數字紮根
            if (op.op === 'essence') {
                const g = groundingOf(str(op.text), essenceSources(op, refOps).map(contentOf))
                if (g.status === STATUS.VIOLATION) add('ES16', 'text', `本質之數字 ${g.ung.slice(0, 5).join('、')} 不見於所引主張之出處`, FIX.ES16, g.ung)
                else if (g.status === STATUS.UNDETERMINED) add('ES16', 'text', `所引主張之出處內容不可得（${g.missing} 篇）而有須核對之數字 ${g.ung.slice(0, 5).join('、')}`, FIX.ES2u, g.ung)
            }
            else {
                const texts = contentTexts(op).map((f) => f.text).join('\n')
                const m = materialOf(op, refOps)
                const g = groundingOf(texts, [...m.notes.map(contentOf), ...m.texts])
                if (g.status === STATUS.VIOLATION) add('ES2', '', `數字 ${g.ung.slice(0, 5).join('、')} 不見於本操作所引出處與所觸及條目`, FIX.ES2, g.ung)
                else if (g.status === STATUS.UNDETERMINED) add('ES2', '', `出處內容不可得（${g.missing} 篇）而有須核對之數字 ${g.ung.slice(0, 5).join('、')}`, FIX.ES2u, g.ung)
            }
            // ES4／ES12／ES13(試套之結果)
            for (const x of trial?.get(op) || []) {
                if (!x.item) continue
                if (x.key === 'claims') {
                    const p4 = annotationProblems(x.item)
                    if (p4.length) add('ES4', x.field, `主張〔${x.item.id}〕（${x.item.kind}）${p4.join('、')}`, FIX.ES4, p4)
                    if (x.item.kind === 'principle' && (op.op !== 'revise' || x.changedKind)) {
                        const p12 = principleDocsProblem(liveSourcesOf(x.item, state, W), docIdOf)
                        if (p12) add('ES12', x.field, `主張〔${x.item.id}〕${p12}`, FIX.ES12, ['principle'])
                    }
                }
                else if (x.key === 'parameters') {
                    // ES13:與存量掃描同一判準(weakEvidenceProblem)
                    const w = weakEvidenceProblem(x.item, ctx)
                    if (w.applies && !w.ok) add('ES13', x.field, `參數〔${x.item.id}〕之證據等級為「${w.level || '未評估'}」而 conditions 未註明限制`, `${FIX.ES13}（如「${str(ctx.weakEvidence) || '未經獨立驗證'}」「單一研究」）`, ['limit'])
                }
            }
            if (ps.length) out.set(op, ps)
        }
        return out
    }

    /**
     * 程式意見(審計意見之形狀;交修訂)
     * @param {Array} ops 輸入操作(帶 _oid)
     * @returns {Array} 回傳 [{ ref, severity, type, detail, fix }]
     */
    const issuesOf = (ops) => {
        const out = []
        for (const [op, ps] of problemsOf(ops)) {
            for (const p of ps) out.push({ ref: str(op._oid) || str(op.ref) || str(op.id), severity: '高', type: STD_ISSUE_TYPE, detail: `${p.std === 'leak' ? '外洩' : p.std}${p.field ? `（${p.field}）` : ''}：${p.detail}——定稿仍不合即不採`, fix: p.fix })
        }
        return out
    }

    /**
     * 定稿之篩選:有問題者不採;其 ref 記為已剔除(引用它之操作拒收時寫明根因)
     * @param {Array} ops 輸入定稿之操作
     * @param {Object} [o={}] 輸入 { droppedRefs }(終審剔除之 ref;試套時一併當作已剔除)
     * @returns {Object} 回傳 { ops(通過者), rejected:[{ op, problems }], droppedRefs:{ ref: 理由 } }
     */
    const screen = (ops, o = {}) => {
        const probs = problemsOf(ops, o)
        const pass = []
        const rejected = []
        const droppedRefs = {}
        for (const op of isarr(ops) ? ops : []) {
            const ps = probs.get(op)
            if (!ps) {
                pass.push(op)
                continue
            }
            rejected.push({ op, problems: ps })
            if (str(op.ref)) droppedRefs[str(op.ref)] = `未達檢定標準（${uniq(ps.map((p) => (p.std === 'leak' ? '外洩' : p.std))).join('、')}）`
        }
        return { ops: pass, rejected, droppedRefs }
    }

    return { problemsOf, issuesOf, screen }
}

/**
 * 檢定器之 ctx(createOpStandards 之九鍵;各 pass 同一組法):docIdOf 由筆記記錄取 docId(無者以筆記 id 當文件),證據規則與弱證據句取 domain
 *
 * @param {Object} o 輸入 { state, batch:[{ code, id }], contentOf:(noteId)=>String|null, notesById?:Map, applyCtx:Object, domain:{ evidence?, weakEvidence? } }
 * @returns {Object} 回傳 createOpStandards 之 ctx
 * @example
 * const ctx = opStandardsCtxOf({ state: {}, batch: [], contentOf: () => null, applyCtx: { batch: [] }, domain: { weakEvidence: '未經驗證' } })
 * console.log(ctx.docIdOf('n1'), ctx.weakEvidence)
 * // => n1 未經驗證
 */
export function opStandardsCtxOf(o) {
    const notesById = o?.notesById instanceof Map ? o.notesById : null
    return {
        state: o?.state,
        batch: isarr(o?.batch) ? o.batch : [],
        contentOf: isfun(o?.contentOf) ? o.contentOf : () => null,
        docIdOf: (nid) => noteDocIdOf(notesById?.get(nid)) || nid,
        applyCtx: o?.applyCtx,
        evidence: o?.domain?.evidence,
        notesById: notesById || undefined,
        weakEvidence: o?.domain?.weakEvidence,
    }
}

/**
 * applyDelta 之 ctx(各 pass 同一組法):主張種類與長度上限取 domain,其餘由呼叫端給;batch 收斂為 [{ code, id }]
 *
 * @param {Object} domain 輸入提煉 domain(取 claimKinds、limits)
 * @param {Object} [o={}] 輸入 { batch?:[{ code, id, … }], mode?, onlyOps?, program?, at?, keyOf?, self?, recheckIds?, droppedRefs?, meta?, withhold?, consolidate?, step? }
 * @returns {Object} 回傳 applyDelta 之 ctx
 * @example
 * console.log(applyCtxOf({ claimKinds: ['rule'], limits: { essence: 100 } }, { batch: [{ code: 'N1', id: 'n1', digest: '…' }], at: 't' }))
 * // => { batch: [ { code: 'N1', id: 'n1' } ], mode: 'delta', at: 't', claimKinds: [ 'rule' ], limits: { essence: 100 } }
 */
export function applyCtxOf(domain, o = {}) {
    const x = isobj(o) ? o : {}
    const batch = (isarr(x.batch) ? x.batch : []).filter(isobj).map((b) => ({ code: b.code, id: b.id }))
    const { batch: _b, ...rest } = x
    return { batch, mode: 'delta', ...rest, claimKinds: domain?.claimKinds, limits: domain?.limits }
}

/**
 * 操作守門 → 納入閘(檔頭【閘之組合只此一份】):失敗之轉接一種——每條被拒之操作附理由陣列(「守門：…」或「<標準>：<細節>」)
 *
 * @param {Array} ops 輸入操作
 * @param {Object} o 輸入 { guard:(ops, ctx)=>{ ops, rejected:[{ op, reason }], flagged }(守門函數;standards/opGuards 之 guardOps),
 *   state, visible?:Set|null, locale?, std:createOpStandards 之產物(未給即不過納入閘), droppedRefs?, remap?:(ops)=>ops(守門後、納入閘前之改寫,如 ref 別名) }
 * @returns {Object} 回傳 { ops(通過者), rejected:[{ op, why:[String], problems?:[…](納入閘之問題) }], flagged, droppedRefs(納入閘所記), guardRejected:Integer, stdRejected:Integer }
 * @throws {Error} o.guard 非函數時拋出
 * @example
 * need test in nodejs.
 *
 * const r = gateOps(ops, { guard: guardOps, state, std })
 * console.log(r.ops.length, r.rejected.length)
 */
export function gateOps(ops, o = {}) {
    if (!isfun(o?.guard)) throw new Error('gateOps 需要 o.guard（操作守門函數）')
    const g = o.guard(isarr(ops) ? ops : [], { state: o.state, visible: o.visible, locale: o.locale })
    const rejected = (isarr(g.rejected) ? g.rejected : []).map((x) => ({ op: x.op, why: [`守門：${x.reason}`] }))
    const guarded = isfun(o.remap) ? o.remap(g.ops) : g.ops
    const sc = guarded.length && o.std ? o.std.screen(guarded, { droppedRefs: o.droppedRefs }) : { ops: guarded, rejected: [], droppedRefs: {} }
    for (const x of sc.rejected) rejected.push({ op: x.op, why: x.problems.map((p) => `${p.std === 'leak' ? '外洩' : p.std}${p.field ? `（${p.field}）` : ''}：${p.detail}`), problems: x.problems })
    return { ops: sc.ops, rejected, flagged: isarr(g.flagged) ? g.flagged : [], droppedRefs: sc.droppedRefs, guardRejected: g.rejected.length, stdRejected: sc.rejected.length }
}

export default { STD_ISSUE_TYPE, createOpStandards, opStandardsCtxOf, applyCtxOf, gateOps }
