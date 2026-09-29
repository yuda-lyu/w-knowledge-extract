// coreState.mjs — 核心知識之狀態(主張庫)與差量操作:純函數,不做 IO
//
// 【為何需要】核心 md 此前同時是呈現與唯一的保存:每版讀回、截斷 2,500 字、整份重寫——舊知識逐版流失、
//   出處只剩最近一批、篇幅與保留互相拉扯(安裝方〈建議w-knowledge-extract優化〉§1,2026-09-29)。改為:狀態為真理,md 為投影;
//   模型只提「差量操作」,由本檔套用並保證不變式——舊項不刪(被取代／撤回者保留並附理由)、出處只增、id 穩定、引用可解析。
// 【機制所有,domain 不可放寬】操作之結構規則(出處須屬本批、跨操作衝突、ref 連鎖、同篇爭議、文字引用、長度上限)屬機制;
//   domain 只給內容層:主張種類(claimKinds)、長度上限(limits)、證據演算法(evidenceOf)、提示詞與渲染。
// 【操作語意之取捨(2026-09-29 雙審定案,tmp/wke-distill-b-全盤.md §11)】
//   ①同一差量內每個既有項至多一個改狀態操作(revise／supersede／retract／contest／merge-from),違者皆拒——意圖矛盾時不猜。
//   ②confirm 與 supersede／retract 同一項 → 皆拒。③新項以 ref 互引(他處寫 '@ref'),被拒之新項其依賴操作連鎖拒收
//     (否則引用懸空觸發不變式、整個差量丟棄)。④爭議之立場若出處全來自同一篇 → 拒收(同篇正反不成爭議)。
//   ⑤contested 為衍生狀態:被未解決之爭議某方引用即 contested,否則 active——模型不直接改;終態(superseded／retracted)不可逆。
//   ⑥文字欄以〔C12〕格式引用他項,引用不存在者拒收(自由文字之「Q1」「C4」可能是季度或術語,不檢查)。
//   ⑦新增項與既有項全文相同 → 改記為 confirm(累積出處,不另立重複項)。
//   ⑧爭議可立亦可拆(2026-09-29):兩方並非回答同一問題、或結論並不相反之「硬配對立」,以 dispute_dissolve 拆解——爭議轉終態
//     (理由「非對立」),只有立場文字之一方由程式轉為獨立主張(出處沿用),內容與出處全留、只拿掉對立標籤;審查剔除提案中之
//     dispute_add／dispute_update 亦可用「非對立」,其只有立場文字之方同樣轉為新增主張。此前只能建立爭議、不能不刪內容地解除
//     (有 A→B 無 B→A);「防對立被藏」之保護不變——任何拆解都不刪內容。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'

/** 狀態格式版本(upgradeState 依此升級;未知之較新版本拒讀) */
export const STATE_VERSION = 1

/** 增量模式之操作 */
export const DELTA_OPS = ['add', 'confirm', 'revise', 'supersede', 'retract', 'contest', 'dispute_add', 'dispute_update', 'dispute_dissolve', 'param_add', 'question_add', 'question_resolve', 'essence', 'related_add']

/** 整併模式之操作(不消耗筆記、不需本批出處) */
export const CONSOLIDATE_OPS = ['merge', 'refacet', 'revise', 'essence', 'related_prune', 'dispute_dissolve']

/** 撤回之理由(列舉;撤回為終態,項目保留並渲染於沿革);「重複」須帶 into(存活之同種類項),出處併入之 */
export const RETRACT_REASONS = ['離題', '無出處支持', '同篇誤配', '重複']

/** 終態操作(不可逆):審查失敗或漏裁決時不套用,改存待審(pendingReview) */
export const TERMINAL_OPS = ['supersede', 'retract', 'merge', 'dispute_dissolve']

/** 待審上限:逾者丟最舊並由呼叫端記 WARN */
export const PENDING_REVIEW_CAP = 20

/** 預設主張種類(domain 以 claimKinds 覆寫) */
export const DEFAULT_CLAIM_KINDS = ['principle', 'rule', 'pitfall', 'temporal']

/** 預設長度上限(字元;domain 以 limits 覆寫)——提示詞寫入、超過即計入超長率;逾 2 倍拒收(防失控,不截斷改寫) */
export const DEFAULT_LIMITS = { essence: 220, text: 90, conditions: 60, pros: 60, cons: 60, critique: 90, period: 40, basis: 90, position: 90, question: 90, note: 120, resolution: 120, name: 40, value: 60 }

const KEY_OF_PREFIX = { C: 'claims', D: 'disputes', P: 'parameters', Q: 'questions' }
const PREFIX_OF_KEY = { claims: 'C', disputes: 'D', parameters: 'P', questions: 'Q' }
const NAME_OF_KEY = { claims: '主張', disputes: '爭議', parameters: '參數', questions: '問題' }
const TERMINAL = new Set(['superseded', 'retracted'])
const REF_RE = /〔([CDPQ]\d+)〕/g
// 文字中以〔@ref〕指稱同一差量之新項(模型仿〔C1〕之寫法;1.0.5 真實模型驗收實測本質文字寫「〔@a〕」)——落盤前換成實際 id
const TEMP_REF_RE = /〔@([^〔〕\s]+)〕/g

// revise 可改之欄位(id／sources／status／origin 等機制欄位不可由模型改)
const REVISABLE = {
    claims: ['text', 'conditions', 'pros', 'cons', 'period', 'critique', 'facet', 'basis', 'kind'],
    parameters: ['name', 'value', 'conditions', 'period', 'snapshot'],
}
// 各項之文字欄(長度上限與〔id〕引用檢查之對象)
const TEXT_FIELDS = {
    claims: ['text', 'conditions', 'pros', 'cons', 'period', 'critique', 'basis'],
    parameters: ['name', 'value', 'conditions', 'period'],
    questions: ['text', 'resolution'],
    disputes: ['question', 'note'],
}
const ARRAY_FIELDS = new Set(['conditions', 'pros', 'cons'])

const str = (v) => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''))
const strs = (v) => (isarr(v) ? v.map((x) => str(x)).filter(Boolean) : (str(v) ? [str(v)] : []))
const oneLine = (v) => str(v).replace(/\s+/g, ' ')
const uniq = (arr) => [...new Set(arr)]
const clone = (v) => JSON.parse(JSON.stringify(v))
const sameText = (s) => String(s || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
const allItems = (s) => [...s.claims, ...s.disputes, ...s.parameters, ...s.questions]


/**
 * 空狀態(新概念之首版起點)
 *
 * @param {Object} [meta={}] 輸入 { coreId, concept, scope }，非物件視為{}
 * @returns {Object} 回傳狀態物件(version 0)
 * @example
 * console.log(emptyState({ concept: '甲' }).version)
 * // => 0
 */
export function emptyState(meta = {}) {
    if (!isobj(meta)) meta = {}
    return {
        v: STATE_VERSION,
        coreId: str(meta.coreId),
        concept: str(meta.concept),
        scope: meta.scope === 'category' ? 'category' : 'concept',
        version: 0, // 知識版本:有操作套用才 +1(md 與索引顯示者)
        rev: 0, // 寫入序號:每次寫檔 +1(含只改 consumed 之落帳);投影對帳與 CAS 一律比 rev——比 version 看不見只落帳之寫入
        updatedAt: '', // 最近一次知識版本之時刻(渲染取此值,使 md 為狀態之純函數)
        essence: { text: '', claims: [], sources: [], at: '' },
        claims: [],
        disputes: [],
        parameters: [],
        questions: [],
        related: [],
        legacy: null,
        pendingReview: [],
        consumed: [],
        skipped: [],
        essenceHistory: [],
        changelog: [],
        lastConsolidated: 0,
        proposedAt: '', // 最近一次提案之時刻(選題之等待錨點;整併不更新)
        renderHashes: [], // 最近兩次渲染之 md 雜湊(手改偵測;無則不比對)
        nextId: { C: 1, D: 1, P: 1, Q: 1 },
    }
}


/**
 * 讀入之狀態升級與形狀補齊(缺欄補預設);未知之較新版本拒讀——不降級覆寫
 *
 * @param {*} raw 輸入自檔案讀出之物件
 * @returns {Object} 回傳可用之狀態物件(新物件,不修改輸入)
 * @throws {Error} raw 非物件、v 非正整數、或 v 大於 STATE_VERSION 時拋出
 */
export function upgradeState(raw) {
    if (!isobj(raw)) throw new Error('核心狀態須為物件')
    if (!Number.isInteger(raw.v) || raw.v < 1) throw new Error(`核心狀態之格式版本無效：${raw.v}`)
    if (raw.v > STATE_VERSION) throw new Error(`核心狀態之格式版本 ${raw.v} 新於本套件支援之 ${STATE_VERSION}，拒讀（請升級套件）`)
    const base = emptyState({ coreId: raw.coreId, concept: raw.concept, scope: raw.scope })
    const s = { ...base, ...clone(raw) }
    for (const k of ['claims', 'disputes', 'parameters', 'questions', 'related', 'pendingReview', 'consumed', 'skipped', 'essenceHistory', 'changelog', 'renderHashes']) {
        if (!isarr(s[k])) s[k] = []
    }
    s.essence = { ...base.essence, ...(isobj(s.essence) ? s.essence : {}) }
    s.nextId = { ...base.nextId, ...(isobj(s.nextId) ? s.nextId : {}) }
    if (!Number.isInteger(s.version) || s.version < 0) s.version = 0
    if (!Number.isInteger(s.rev) || s.rev < 0) s.rev = 0
    s.v = STATE_VERSION
    return s
}


/**
 * 依 id 找項目(主張 C／爭議 D／參數 P／待解問題 Q)
 *
 * @param {Object} s 輸入狀態
 * @param {String} id 輸入 id
 * @returns {Object|null} 回傳 { key, item }，找不到回 null
 */
export function findItem(s, id) {
    const key = KEY_OF_PREFIX[String(id || '')[0]]
    if (!key || !isarr(s?.[key])) return null
    const item = s[key].find((x) => x.id === id)
    return item ? { key, item } : null
}


/**
 * 重算衍生狀態:主張被「未解決且未撤回之爭議」某方引用即 contested,否則 active(終態不動);essence 之出處＝所引主張出處之聯集
 *
 * @param {Object} s 輸入狀態(就地修改)
 * @returns {Array} 回傳狀態有變動之主張 id 陣列
 */
export function deriveStatus(s) {
    const cited = new Set()
    for (const d of s.disputes) {
        if (d.status !== 'open') continue
        for (const sd of d.sides || []) for (const cid of sd.claims || []) cited.add(cid)
    }
    const changed = []
    for (const c of s.claims) {
        if (TERMINAL.has(c.status)) continue
        const want = cited.has(c.id) ? 'contested' : 'active'
        if (c.status !== want) {
            c.status = want
            changed.push(c.id)
        }
    }
    const ess = s.essence || {}
    ess.sources = uniq((ess.claims || []).flatMap((id) => findItem(s, id)?.item?.sources || []))
    return changed
}


/**
 * 套用差量:逐操作原子(不合規者拒收並記原因,其餘照套);新項 id 由程式配發(單調、永不重用);出處只增;
 * 同一差量內之新項可以 ref 互引(他處寫 '@ref');規則見檔頭【操作語意之取捨】
 *
 * @param {Object} state 輸入目前狀態(不修改,回傳新狀態)
 * @param {Object} delta 輸入差量 { ops:[...] }(skipped 等其他欄位由呼叫端處理)
 * @param {Object} [ctx={}] 輸入脈絡，非物件視為{}
 * @param {Array} [ctx.batch=[]] 輸入本批筆記 [{ code:'N1', id }]；出處只能引本批(以代號或 id 皆可)
 * @param {String} [ctx.mode='delta'] 輸入 'delta'｜'consolidate'
 * @param {Array} [ctx.claimKinds] 輸入許可之主張種類，預設 DEFAULT_CLAIM_KINDS
 * @param {Object} [ctx.limits] 輸入長度上限，逐鍵覆寫 DEFAULT_LIMITS
 * @param {Array} [ctx.withhold=[]] 輸入本次暫緩之操作名(如審查失敗之降級:終態操作不套用)，被暫緩者記入 withheld(帶 resolved＝@ref 已換實際 id 之操作)；
 *   個別操作帶 _withhold:true 者亦暫緩(審查漏裁決之終態操作)
 * @param {Function} [ctx.keyOf] 輸入概念名正規化函數(related 去重用)，預設去空白小寫
 * @param {String} [ctx.self=''] 輸入本核心之概念名(related 去自身用)
 * @param {String} [ctx.at=''] 輸入時刻字串(寫入 history 與 changelog)
 * @param {Object} [ctx.meta={}] 輸入寫入 changelog 之附加欄位(如 provider、reviewed)
 * @returns {Object} 回傳 { state, applied:Array({index,op,id?,sources,noop?}), rejected:Array({index,op,reason,sources}), withheld:Array({index,op,sources}), touched:Array(id), overLimit:Integer(逾建議上限而放行之欄數), lengthChecked:Integer(受長度檢查之欄數) }
 */
export function applyDelta(state, delta, ctx = {}) {
    if (!isobj(ctx)) ctx = {}
    const s = clone(state)
    const mode = ctx.mode === 'consolidate' ? 'consolidate' : 'delta'
    const allowed = mode === 'consolidate' ? CONSOLIDATE_OPS : DELTA_OPS
    const kinds = isarr(ctx.claimKinds) && ctx.claimKinds.length ? ctx.claimKinds : DEFAULT_CLAIM_KINDS
    const limits = { ...DEFAULT_LIMITS, ...(isobj(ctx.limits) ? ctx.limits : {}) }
    const withhold = new Set(isarr(ctx.withhold) ? ctx.withhold : [])
    const keyOf = typeof ctx.keyOf === 'function' ? ctx.keyOf : (x) => String(x || '').replace(/\s+/g, '').toLowerCase()
    const at = str(ctx.at)
    const version = s.version + 1
    const ops = isobj(delta) && isarr(delta.ops) ? delta.ops : []

    // 本批代號 → 筆記 id(亦接受完整 id)
    const codeMap = new Map()
    for (const b of isarr(ctx.batch) ? ctx.batch : []) {
        if (!isobj(b) || !str(b.id)) continue
        codeMap.set(str(b.id), str(b.id))
        if (str(b.code)) codeMap.set(str(b.code).toUpperCase(), str(b.id))
    }
    const toNote = (x) => codeMap.get(str(x)) || codeMap.get(str(x).toUpperCase()) || null
    const srcOf = (v) => uniq(strs(v).map(toNote).filter(Boolean))
    const preIds = new Set(allItems(s).map((x) => x.id))

    const applied = []
    const rejected = []
    const withheld = []
    const touched = new Set()
    let overLimit = 0
    let lengthChecked = 0
    const opSources = (op) => uniq([...srcOf(op?.sources), ...(isarr(op?.sides) ? op.sides.flatMap((sd) => srcOf(sd?.sources)) : []), ...(isarr(op?.sides_add) ? op.sides_add.flatMap((sd) => srcOf(sd?.sources)) : [])])
    // 回報用序號:經 applyVerdicts 剔除後之操作帶 _i(提案原序號),回報一律用原序號
    const rep = (index, op) => (Number.isInteger(op?._i) ? op._i : index)
    const reject = (index, op, reason) => {
        rejected.push({ index: rep(index, op), op: str(op?.op) || '?', reason, sources: opSources(op) })
    }

    // ── 前置掃描:ref 登記(重複者皆拒)、跨操作衝突(既有項至多一個改狀態操作;confirm 與終態操作不並存)──
    const refState = new Map() // ref → { id:null|String, rejected:Boolean }
    const refDup = new Set()
    ops.forEach((op) => {
        const ref = str(op?.ref)
        if (!ref || !['add', 'dispute_add', 'param_add', 'question_add'].includes(op?.op)) return
        if (refState.has(ref)) refDup.add(ref)
        else refState.set(ref, { id: null, rejected: false })
    })
    // 被審查剔除之新項(applyVerdicts 之 droppedRefs):引用它們之保留操作拒收時寫明「已被審查剔除(理由)」,
    //   不再以「不存在」之類之理由掩蓋上游之剔除;同名 ref 仍由存活操作定義者不登記
    for (const [ref, why] of Object.entries(isobj(ctx.droppedRefs) ? ctx.droppedRefs : {})) {
        if (!refState.has(ref)) refState.set(ref, { id: null, rejected: true, dropped: str(why) || '審查剔除' })
    }
    const stateOps = new Map() // 既有 id → 改狀態操作之索引
    const confirmOps = new Map()
    const terminalOps = new Map()
    ops.forEach((op, index) => {
        if (!isobj(op)) return
        const targets = op.op === 'merge' ? strs(op.from) : (['revise', 'supersede', 'retract', 'contest', 'dispute_dissolve'].includes(op.op) ? [str(op.id)] : [])
        for (const t of targets) {
            if (!preIds.has(t)) continue
            stateOps.set(t, [...(stateOps.get(t) || []), index])
            if (['supersede', 'retract', 'dispute_dissolve'].includes(op.op) || op.op === 'merge') terminalOps.set(t, [...(terminalOps.get(t) || []), index])
        }
        if (op.op === 'confirm' && preIds.has(str(op.id))) confirmOps.set(str(op.id), [...(confirmOps.get(str(op.id)) || []), index])
    })
    const conflict = new Map() // index → 原因
    for (const [t, idx] of stateOps) if (idx.length > 1) for (const i of idx) conflict.set(i, `同一項目 ${t} 有多個改狀態操作`)
    for (const [t, idx] of terminalOps) {
        if (!confirmOps.has(t)) continue
        for (const i of [...idx, ...confirmOps.get(t)]) conflict.set(i, `同一項目 ${t} 同時被確認與取代／撤回`)
    }

    // 處理順序:新增主張 → 新增爭議／參數／問題 → 其餘依原序(「先引用、後定義」亦可解析)
    const phaseOf = (op) => (op?.op === 'add' ? 0 : ['dispute_add', 'param_add', 'question_add'].includes(op?.op) ? 1 : 2)
    const order = ops.map((op, index) => ({ op, index })).sort((a, b) => phaseOf(a.op) - phaseOf(b.op) || a.index - b.index)
    const newId = (key) => {
        const p = PREFIX_OF_KEY[key]
        const n = Math.max(Number(s.nextId[p]) || 1, 1)
        s.nextId[p] = n + 1
        return `${p}${n}`
    }
    // 解析引用:'@ref' → 已配發之 id;所依之新項未成立 → 依賴失敗,dep 為寫明根因之拒收理由(被審查剔除／被程式拒收);一般 id 須存在
    const resolveRef = (x) => {
        const v = str(x)
        if (v.startsWith('@')) {
            const r = refState.get(v.slice(1))
            if (!r) return { id: null, reason: `ref「${v}」未定義` }
            if (!r.id) return { id: null, reason: 'dependency-rejected', dep: r.dropped ? `所引 ${v} 已被審查剔除（${r.dropped}）` : `所引 ${v} 已被拒收（${r.why || '未成立'}）` }
            return { id: r.id }
        }
        return findItem(s, v) ? { id: v } : { id: null, reason: `引用之項目 ${v || '(空)'} 不存在` }
    }
    // 操作之目標 id 亦可為同一差量新項之「@ref」(新增處理在前,此時已配發;如把本批新主張 contest 進既有爭議——真實模型驗收實測);
    //   所依之新項未成立 → 依賴失敗(dep＝寫明根因之拒收理由)
    const targetOf = (x) => {
        const v = str(x)
        if (!v.startsWith('@')) return { hit: findItem(s, v), shown: v, dep: '' }
        const r = resolveRef(v)
        return { hit: r.id ? findItem(s, r.id) : null, shown: v, dep: r.dep || '' }
    }
    // 引用須為指定種類(之非終態)項:不成立時回寫明根因之理由——依賴失敗、ref 未定義、不存在、種類不符、終態各自寫明,
    //   不以「不存在或為終態」概括(1.0.5 真實模型驗收實測:本質引用爭議之 @ref 被報「不存在或為終態」,看不出錯在種類)
    const refOfKind = (x, keys, opt = {}) => {
        const r = resolveRef(x)
        if (!r.id) return { id: null, why: r.dep || r.reason }
        const h = findItem(s, r.id)
        const shown = str(x) === r.id ? r.id : `${str(x)}＝${r.id}`
        if (!keys.includes(h.key)) return { id: null, why: `${shown} 為${NAME_OF_KEY[h.key] || h.key}，須為${keys.map((k) => NAME_OF_KEY[k] || k).join('或')}` }
        if (opt.live !== false && TERMINAL.has(h.item.status)) return { id: null, why: `${shown} 已${h.item.status === 'retracted' ? '撤回' : '取代'}` }
        return { id: r.id, hit: h }
    }
    // 「方」之索引:接受整數、數字字串與「side1／side 1」(提示詞以 `side k` 標示,模型可能照抄);其餘回 null
    const parseSide = (v) => {
        if (Number.isInteger(v)) return v
        const m = typeof v === 'string' ? /^\s*(?:side\s*)?(\d+)\s*$/i.exec(v) : null
        return m ? Number(m[1]) : null
    }
    const sideRange = (d) => ((d.sides || []).length ? `現有 side 0～${d.sides.length - 1}` : '無任何一方')
    const hist = (item, op, note, before) => {
        item.history = isarr(item.history) ? item.history : []
        item.history.push({ version, at, op, ...(note ? { note } : {}), ...(before ? { before } : {}) })
    }
    // 文字中之引用:〔id〕須存在;〔@ref〕須為本差量宣告、且尚未失敗之 ref(落盤前換成實際 id,見下方 linkCodes)
    const danglingIn = (v) => {
        for (const m of v.matchAll(REF_RE)) if (!findItem(s, m[1])) return `文字引用懸空：〔${m[1]}〕`
        for (const m of v.matchAll(TEMP_REF_RE)) {
            const r = refState.get(m[1])
            if (!r) return `文字引用懸空：〔@${m[1]}〕（ref 未定義）`
            if (r.rejected) return `文字引用懸空：〔@${m[1]}〕（${r.dropped ? `已被審查剔除（${r.dropped}）` : `已被拒收（${r.why || '未成立'}）`}）`
        }
        return ''
    }
    // 文字欄:長度(逾 2 倍拒收、逾上限計數)與文字中之引用;fields 未給即取該種類之全部文字欄
    const textProblem = (key, obj, fields) => {
        for (const f of fields || TEXT_FIELDS[key] || []) {
            const vals = ARRAY_FIELDS.has(f) ? strs(obj[f]) : [str(obj[f])]
            for (const v of vals) {
                const lim = limits[f]
                if (lim && v.length > lim * 2) return `${f} 過長（${v.length} 字，上限 ${lim}）`
                const dg = danglingIn(v)
                if (dg) return dg
            }
        }
        return ''
    }
    // 逾建議上限(1～2 倍、放行者)之欄數與受檢欄數:比率供驗收「超長 ≤10%」(安裝方 §3 #5)
    const countOver = (key, obj) => {
        for (const f of TEXT_FIELDS[key] || []) {
            const vals = (ARRAY_FIELDS.has(f) ? strs(obj[f]) : [str(obj[f])]).filter(Boolean)
            if (!limits[f] || !vals.length) continue
            lengthChecked++
            if (vals.some((v) => v.length > limits[f])) overLimit++
        }
    }
    const markRef = (ref, id) => {
        if (ref && refState.has(ref)) refState.get(ref).id = id
    }
    const failRef = (op, why) => {
        const ref = str(op?.ref)
        if (ref && refState.has(ref)) Object.assign(refState.get(ref), { rejected: true, why: str(why) })
    }
    const live = (hit) => hit && !TERMINAL.has(hit.item.status)
    let essenceSeen = false
    // 審查存疑之落帳:爭議上留最新一則(含累計次數),另寫沿革(沿革只增,舊存疑可追溯)
    const markDoubt = (op, entry) => {
        const did = op.op === 'contest' ? resolveRef(op.dispute).id : entry.id
        const d = did ? findItem(s, did)?.item : null
        if (!d || !isarr(d.sides)) return
        const note = str(op._doubt.note).slice(0, (limits.note || 120) * 2) || '（審查未附說明）'
        const prev = isobj(d.doubt) ? d.doubt : null
        d.doubt = { reason: str(op._doubt.reason) || '非對立', note, version, at, op: op.op, ...(op.op === 'contest' ? { claim: entry.id, side: parseSide(op.side) } : {}), count: (prev?.count || 0) + 1 }
        hist(d, 'doubt', `${d.doubt.reason}：${note}`)
        touched.add(d.id)
    }

    for (const { op, index } of order) {
        const fail = (reason) => {
            failRef(op, reason)
            reject(index, op, reason)
        }
        if (!isobj(op) || !allowed.includes(op.op)) {
            fail(isobj(op) && [...DELTA_OPS, ...CONSOLIDATE_OPS].includes(op.op) ? `${mode === 'consolidate' ? '整併' : '增量'}模式不可用「${op.op}」` : '未知操作')
            continue
        }
        const ref = str(op.ref)
        if (ref && refDup.has(ref)) {
            fail(`ref「${ref}」重複`)
            continue
        }
        if (conflict.has(index)) {
            fail(conflict.get(index))
            continue
        }
        if (withhold.has(op.op) || op._withhold === true) {
            failRef(op)
            withheld.push({ index: rep(index, op), op: op.op, sources: opSources(op), _op: op })
            continue
        }
        const needSrc = (v) => {
            const got = srcOf(v)
            return got.length ? got : null
        }
        const done = (entry) => applied.push({ index: rep(index, op), op: op.op, sources: [], ...entry })
        const nApplied = applied.length

        switch (op.op) {
        case 'add': {
            const kind = str(op.kind || op.type)
            if (!kinds.includes(kind)) {
                fail(`種類「${kind}」不在許可清單（${kinds.join('、')}）`)
                break
            }
            if (!str(op.text)) {
                fail('缺 text')
                break
            }
            const src = needSrc(op.sources)
            if (!src) {
                fail('無本批出處')
                break
            }
            const tp = textProblem('claims', op)
            if (tp) {
                fail(tp)
                break
            }
            // 與既有(非終態)主張全文相同 → 改記為 confirm
            const dup = s.claims.find((c) => !TERMINAL.has(c.status) && sameText(c.text) === sameText(op.text))
            if (dup) {
                const add = src.filter((x) => !dup.sources.includes(x))
                dup.sources = uniq([...dup.sources, ...src])
                if (add.length) hist(dup, 'confirm', 'add 與既有主張同文，改記為確認')
                touched.add(dup.id)
                markRef(ref, dup.id)
                done({ id: dup.id, sources: src, asConfirm: true, noop: add.length === 0 })
                break
            }
            const id = newId('claims')
            markRef(ref, id)
            const c = {
                id,
                kind,
                facet: str(op.facet),
                text: str(op.text),
                conditions: strs(op.conditions),
                pros: strs(op.pros),
                cons: strs(op.cons),
                period: str(op.period),
                critique: str(op.critique),
                basis: str(op.basis),
                sources: src,
                origin: 'note',
                status: 'active',
                statusNote: '',
                validPeriod: '',
                supersededBy: '',
                mergedInto: '',
                retractReason: '',
                evidence: { level: '', basis: '', trace: '' },
                addedIn: version,
                history: [{ version, at, op: 'add' }],
            }
            countOver('claims', c)
            s.claims.push(c)
            touched.add(id)
            done({ id, sources: src })
            break
        }
        case 'confirm': {
            const tg = targetOf(op.id)
            const hit = tg.hit
            if (!hit || !['claims', 'parameters', 'disputes'].includes(hit.key)) {
                fail(tg.dep || `目標 ${tg.shown || '(空)'} 不存在`)
                break
            }
            if (!live(hit)) {
                fail(`目標 ${hit.item.id} 已${hit.item.status === 'retracted' ? '撤回' : '取代'}`)
                break
            }
            const src = needSrc(op.sources)
            if (!src) {
                fail('無本批出處')
                break
            }
            const it = hit.item
            if (hit.key === 'disputes') {
                // 確認爭議:出處加到指定之一方(side 索引,0 起),未指定者加到爭議本身
                const given = op.side !== undefined && op.side !== null && op.side !== ''
                const k = given ? parseSide(op.side) : null
                const side = k === null ? null : it.sides[k]
                if (given && !side) {
                    fail(`爭議 ${it.id} 無 side ${str(op.side)}（${sideRange(it)}）`)
                    break
                }
                if (side) side.sources = uniq([...(side.sources || []), ...src])
            }
            const add = src.filter((x) => !(it.sources || []).includes(x))
            it.sources = uniq([...(it.sources || []), ...src])
            if (add.length) hist(it, 'confirm')
            touched.add(it.id)
            done({ id: it.id, sources: src, noop: add.length === 0 })
            break
        }
        case 'revise': {
            const tg = targetOf(op.id)
            const hit = tg.hit
            if (!hit) {
                fail(tg.dep || `目標 ${tg.shown || '(空)'} 不存在`)
                break
            }
            if (!REVISABLE[hit.key]) {
                fail(`目標 ${hit.item.id} 為${NAME_OF_KEY[hit.key]}，不可修訂（revise 限${Object.keys(REVISABLE).map((k) => NAME_OF_KEY[k]).join('、')}）`)
                break
            }
            if (!live(hit)) {
                fail(`目標 ${hit.item.id} 為終態，不可修訂`)
                break
            }
            if (!str(op.reason)) {
                fail('缺 reason')
                break
            }
            let src = []
            if (mode === 'delta') {
                src = needSrc(op.sources)
                if (!src) {
                    fail('無本批出處')
                    break
                }
            }
            const f = isobj(op.fields) ? op.fields : {}
            const keys = Object.keys(f).filter((k) => REVISABLE[hit.key].includes(k))
            if (!keys.length) {
                fail('無可改之欄位')
                break
            }
            if (keys.includes('kind') && !kinds.includes(str(f.kind))) {
                fail(`種類「${str(f.kind)}」不在許可清單`)
                break
            }
            const next = {}
            for (const k of keys) next[k] = k === 'snapshot' ? f[k] === true : (ARRAY_FIELDS.has(k) ? strs(f[k]) : str(f[k]))
            if ((hit.key === 'claims' && keys.includes('text') && !next.text) || (hit.key === 'parameters' && ((keys.includes('name') && !next.name) || (keys.includes('value') && !next.value)))) {
                fail('必要欄位不可改為空')
                break
            }
            const tp = textProblem(hit.key, { ...hit.item, ...next })
            if (tp) {
                fail(tp)
                break
            }
            const it = hit.item
            const before = {}
            for (const k of keys) before[k] = clone(it[k] ?? '')
            Object.assign(it, next)
            it.sources = uniq([...(it.sources || []), ...src])
            hist(it, 'revise', str(op.reason), before)
            countOver(hit.key, it)
            touched.add(it.id)
            done({ id: it.id, sources: src })
            break
        }
        case 'supersede': {
            const tg = targetOf(op.id)
            const hit = tg.hit
            if (!hit || !['claims', 'parameters'].includes(hit.key)) {
                fail(tg.dep || `目標 ${tg.shown || '(空)'} 不存在`)
                break
            }
            if (!live(hit)) {
                fail(`目標 ${hit.item.id} 已為終態`)
                break
            }
            if (!str(op.reason)) {
                fail('缺 reason')
                break
            }
            if (!str(op.validPeriod)) {
                fail('缺 validPeriod（舊觀點成立期間；年份不詳可寫「較早之研究」或「不詳」）')
                break
            }
            const src = needSrc(op.sources)
            if (!src) {
                fail('無本批出處')
                break
            }
            let by = ''
            if (str(op.by)) {
                const r = refOfKind(op.by, [hit.key], { live: false })
                if (!r.id || r.id === hit.item.id) {
                    fail(r.id ? '取代者不可為自身' : `取代者 ${r.why}`)
                    break
                }
                by = r.id
            }
            const it = hit.item
            Object.assign(it, { status: 'superseded', statusNote: str(op.reason), validPeriod: str(op.validPeriod), supersededBy: by })
            it.sources = uniq([...(it.sources || []), ...src])
            hist(it, 'supersede', str(op.reason))
            touched.add(it.id)
            done({ id: it.id, sources: src })
            break
        }
        case 'retract': {
            const tg = targetOf(op.id)
            const hit = tg.hit
            if (!hit) {
                fail(tg.dep || `目標 ${tg.shown || '(空)'} 不存在`)
                break
            }
            if (TERMINAL.has(hit.item.status)) {
                fail(`目標 ${hit.item.id} 已為終態`)
                break
            }
            const reason = str(op.reason)
            if (!RETRACT_REASONS.includes(reason)) {
                fail(`撤回理由須為：${RETRACT_REASONS.join('、')}`)
                break
            }
            const src = srcOf(op.sources)
            const it = hit.item
            // 「重複」須指明存活之同種類項,出處併入之(否則存活者得不到被撤回者之出處,出處累積失真)
            let into = null
            if (reason === '重複') {
                const r = resolveRef(op.into)
                const h = r.id ? findItem(s, r.id) : null
                if (!h || h.key !== hit.key || h.item.id === it.id || !live(h)) {
                    fail(r.dep || '理由「重複」須帶 into（存活之同種類項）')
                    break
                }
                into = h.item
            }
            it.status = 'retracted'
            it.retractReason = reason
            it.statusNote = str(op.note) || (into ? `與 ${into.id} 重複` : reason)
            if (into) {
                it.mergedInto = into.id
                into.sources = uniq([...(into.sources || []), ...(it.sources || [])])
                hist(into, 'retract', `併入重複項 ${it.id} 之出處`)
                touched.add(into.id)
            }
            hist(it, 'retract', it.statusNote)
            touched.add(it.id)
            done({ id: it.id, sources: src })
            break
        }
        case 'contest': {
            const tg = targetOf(op.id)
            const hit = tg.hit
            if (!hit || hit.key !== 'claims') {
                fail(tg.dep || `目標主張 ${tg.shown || '(空)'} 不存在`)
                break
            }
            if (!live(hit)) {
                fail(`目標 ${hit.item.id} 已為終態`)
                break
            }
            if (!str(op.reason)) {
                fail('缺 reason')
                break
            }
            const r = resolveRef(op.dispute)
            if (!r.id || findItem(s, r.id)?.key !== 'disputes') {
                fail(r.dep || 'contest 須連既有或同一差量新建之爭議')
                break
            }
            const d = findItem(s, r.id).item
            if (d.status !== 'open') {
                fail(`爭議 ${d.id} 已非未解決`)
                break
            }
            const k = parseSide(op.side)
            const side = k === null ? null : d.sides[k]
            if (!side) {
                fail(`爭議 ${d.id} 無 side ${str(op.side) || '(未給)'}（contest 須指明 side；${sideRange(d)}）`)
                break
            }
            const src = needSrc(op.sources)
            if (!src) {
                fail('無本批出處')
                break
            }
            side.claims = uniq([...(side.claims || []), hit.item.id])
            side.sources = uniq([...(side.sources || []), ...src])
            d.sources = uniq([...(d.sources || []), ...src])
            hist(hit.item, 'contest', `${d.id}：${str(op.reason)}`)
            hist(d, 'contest', `${hit.item.id} 列入 side ${k}`)
            touched.add(hit.item.id)
            touched.add(d.id)
            done({ id: hit.item.id, sources: src })
            break
        }
        case 'dispute_add':
        case 'dispute_update': {
            const isAdd = op.op === 'dispute_add'
            let d = null
            if (!isAdd) {
                const tg = targetOf(op.id)
                const hit = tg.hit
                if (!hit || hit.key !== 'disputes') {
                    fail(tg.dep || `目標爭議 ${tg.shown || '(空)'} 不存在`)
                    break
                }
                if (TERMINAL.has(hit.item.status)) {
                    fail(`爭議 ${hit.item.id} 已撤回`)
                    break
                }
                d = hit.item
                if (!str(op.note)) {
                    fail('缺 note')
                    break
                }
                if (op.status !== undefined && !['open', 'resolved'].includes(op.status)) {
                    fail('status 須為 open／resolved')
                    break
                }
            }
            else if (!str(op.question)) {
                fail('缺 question')
                break
            }
            const rawSides = isAdd ? (isarr(op.sides) ? op.sides : []) : (isarr(op.sides_add) ? op.sides_add : [])
            if (isAdd && rawSides.length < 2) {
                fail('少於兩方')
                break
            }
            const sides = []
            let bad = ''
            for (const sd of rawSides) {
                if (!str(sd?.position)) {
                    bad = '有一方缺立場'
                    break
                }
                const claims = []
                for (const x of strs(sd?.claims)) {
                    const r = refOfKind(x, ['claims'])
                    if (!r.id) {
                        bad = r.why
                        break
                    }
                    claims.push(r.id)
                }
                if (bad) break
                const src = srcOf(sd?.sources)
                if (!src.length && !claims.length) {
                    bad = '有一方無本批出處亦無所引主張'
                    break
                }
                const tp = textProblem('disputes', sd, ['position', 'conditions'])
                if (tp) {
                    bad = tp
                    break
                }
                sides.push({ position: str(sd.position), conditions: strs(sd?.conditions), claims, sources: src })
            }
            if (bad) {
                fail(bad)
                break
            }
            const newSrc = uniq([...srcOf(op.sources), ...sides.flatMap((x) => x.sources)])
            if (!newSrc.length) {
                fail('無本批出處')
                break
            }
            const tp = textProblem('disputes', isAdd ? { question: op.question } : { note: op.note })
            if (tp) {
                fail(tp)
                break
            }
            if (isAdd) {
                // 同篇正反不成爭議:各方之出處(本批出處＋所引主張之出處)聯集只有 1 篇 → 拒收
                const perSide = sides.map((sd) => uniq([...sd.sources, ...sd.claims.flatMap((cid) => findItem(s, cid)?.item?.sources || [])]))
                if (uniq(perSide.flat()).length < 2) {
                    fail('各方出處只有同一篇（同篇正反不成爭議）')
                    break
                }
                const id = newId('disputes')
                markRef(ref, id)
                d = { id, question: str(op.question), sides, sources: newSrc, status: 'open', note: str(op.note), origin: 'note', evidence: { level: '', basis: '', trace: '' }, addedIn: version, history: [{ version, at, op: 'dispute_add' }] }
                s.disputes.push(d)
            }
            else {
                d.sides.push(...sides)
                if (op.status) d.status = op.status
                d.note = str(op.note)
                d.sources = uniq([...(d.sources || []), ...newSrc])
                hist(d, 'dispute_update', str(op.note))
            }
            touched.add(d.id)
            for (const sd of sides) for (const cid of sd.claims) touched.add(cid)
            done({ id: d.id, sources: newSrc })
            break
        }
        case 'dispute_dissolve': {
            // 拆解硬配之對立(檔頭⑧):爭議轉終態,只有立場文字之方轉為獨立主張——內容與出處全留,只拿掉對立標籤
            const tg = targetOf(op.id)
            const hit = tg.hit
            if (!hit || hit.key !== 'disputes') {
                fail(tg.dep || `目標爭議 ${tg.shown || '(空)'} 不存在`)
                break
            }
            if (TERMINAL.has(hit.item.status)) {
                fail(`爭議 ${hit.item.id} 已撤回`)
                break
            }
            const reason = str(op.reason)
            if (!reason) {
                fail('缺 reason（兩方為何不是對立）')
                break
            }
            const tp = textProblem('disputes', { note: reason })
            if (tp) {
                fail(tp)
                break
            }
            const d = hit.item
            // 各方之去處(內容與出處全留):只有立場文字之方 → 轉為主張;引主張之方其「方層出處」(confirm side／contest 所加,
            //   不在所引主張出處內者)→ 只引一條有效主張則併入其出處,否則以該方立場另立一條主張——拆解後這些出處仍被有效項引用
            //   種類取 kinds[k](k＝side 索引;不在許可清單者取清單第一項;種類可由 domain 自訂)
            const kindsIn = isarr(op.kinds) ? op.kinds.map((x) => str(x)) : []
            const plan = []
            const merges = []
            let bad = ''
            for (const [k, sd] of (d.sides || []).entries()) {
                const cited = (sd.claims || []).map((cid) => findItem(s, cid)).filter((h) => live(h))
                const covered = new Set(cited.flatMap((h) => h.item.sources || []))
                const extra = (sd.sources || []).filter((x) => !covered.has(x))
                if ((sd.claims || []).length && !extra.length) continue
                if (cited.length === 1 && extra.length) {
                    merges.push({ k, claim: cited[0].item, extra })
                    continue
                }
                const c0 = { text: str(sd.position), conditions: strs(sd.conditions) }
                const p = textProblem('claims', c0, ['text', 'conditions'])
                const src = (sd.claims || []).length ? extra : (sd.sources || [])
                if (p || !src.length) {
                    bad = `side ${k} 無法轉為主張：${p || '無出處'}`
                    break
                }
                plan.push({ k, sd, c0, src, kind: kinds.includes(kindsIn[k]) ? kindsIn[k] : kinds[0] })
            }
            if (bad) {
                fail(bad)
                break
            }
            for (const m of merges) {
                m.claim.sources = uniq([...(m.claim.sources || []), ...m.extra])
                hist(m.claim, 'dispute_dissolve', `併入 ${d.id} side ${m.k} 之方層出處`)
                touched.add(m.claim.id)
            }
            for (const x of plan) {
                const id = newId('claims')
                const c = { id, kind: x.kind, facet: '', text: x.c0.text, conditions: x.c0.conditions, pros: [], cons: [], period: '', critique: '', basis: '', sources: [...x.src], origin: 'dispute', status: 'active', statusNote: '', validPeriod: '', supersededBy: '', mergedInto: '', retractReason: '', evidence: { level: '', basis: '', trace: '' }, addedIn: version, history: [{ version, at, op: 'dispute_dissolve', note: `拆自 ${d.id} side ${x.k}` }] }
                countOver('claims', c)
                s.claims.push(c)
                x.sd.claims = uniq([...(x.sd.claims || []), id])
                touched.add(id)
            }
            Object.assign(d, { status: 'retracted', retractReason: '非對立', statusNote: reason })
            hist(d, 'dispute_dissolve', reason)
            touched.add(d.id)
            for (const sd of d.sides || []) for (const cid of sd.claims || []) touched.add(cid)
            done({ id: d.id })
            break
        }
        case 'param_add': {
            if (!str(op.name) || !str(op.value)) {
                fail('缺 name 或 value')
                break
            }
            const src = needSrc(op.sources)
            if (!src) {
                fail('無本批出處')
                break
            }
            let claim = ''
            if (str(op.claim)) {
                const r = resolveRef(op.claim)
                if (!r.id || findItem(s, r.id)?.key !== 'claims') {
                    fail(r.dep || `所依主張 ${str(op.claim)} 不存在`)
                    break
                }
                claim = r.id
            }
            const p0 = { name: op.name, value: op.value, conditions: op.conditions, period: op.period }
            const tp = textProblem('parameters', p0)
            if (tp) {
                fail(tp)
                break
            }
            const id = newId('parameters')
            markRef(ref, id)
            const p = { id, name: str(op.name), value: str(op.value), conditions: str(op.conditions), period: str(op.period), snapshot: op.snapshot === true, claim, sources: src, origin: 'note', status: 'active', statusNote: '', validPeriod: '', supersededBy: '', retractReason: '', evidence: { level: '', basis: '', trace: '' }, addedIn: version, history: [{ version, at, op: 'param_add' }] }
            countOver('parameters', p)
            s.parameters.push(p)
            touched.add(id)
            done({ id, sources: src })
            break
        }
        case 'question_add': {
            if (!str(op.text)) {
                fail('缺 text')
                break
            }
            const tp = textProblem('questions', { text: op.text })
            if (tp) {
                fail(tp)
                break
            }
            const src = srcOf(op.sources)
            const id = newId('questions')
            markRef(ref, id)
            s.questions.push({ id, text: str(op.text), status: 'open', resolution: '', sources: src, retractReason: '', addedIn: version, history: [{ version, at, op: 'question_add' }] })
            touched.add(id)
            done({ id, sources: src })
            break
        }
        case 'question_resolve': {
            const tg = targetOf(op.id)
            const hit = tg.hit
            if (!hit || hit.key !== 'questions') {
                fail(tg.dep || `目標問題 ${tg.shown || '(空)'} 不存在`)
                break
            }
            if (hit.item.status !== 'open') {
                fail(`問題 ${hit.item.id} 已非未解`)
                break
            }
            if (!str(op.resolution)) {
                fail('缺 resolution')
                break
            }
            const src = needSrc(op.sources)
            if (!src) {
                fail('無本批出處')
                break
            }
            const tp = textProblem('questions', { resolution: op.resolution })
            if (tp) {
                fail(tp)
                break
            }
            Object.assign(hit.item, { status: 'resolved', resolution: str(op.resolution), sources: uniq([...hit.item.sources, ...src]) })
            hist(hit.item, 'question_resolve')
            touched.add(hit.item.id)
            done({ id: hit.item.id, sources: src })
            break
        }
        case 'essence': {
            if (essenceSeen) {
                fail('同一差量只能有一個 essence')
                break
            }
            const text = str(op.text)
            if (!text || !str(op.reason)) {
                fail('缺 text 或 reason')
                break
            }
            // 本質為硬上限(逾即拒,不同於主張各欄之「2 倍拒收、1～2 倍計數」):安裝方驗收 §3 #5「本質 ≤220 字」屬程式判定(2026-09-29 定稿版)
            if (limits.essence && text.length > limits.essence) {
                fail(`essence 過長（${text.length} 字，上限 ${limits.essence}）`)
                break
            }
            const claims = []
            let why = ''
            for (const x of strs(op.claims)) {
                const r = refOfKind(x, ['claims'])
                if (!r.id) {
                    why = r.why
                    break
                }
                claims.push(r.id)
            }
            if (why) {
                fail(why)
                break
            }
            if (!claims.length) {
                fail('essence 須引至少一條主張（claims）')
                break
            }
            const dang = danglingIn(text)
            if (dang) {
                fail(dang)
                break
            }
            essenceSeen = true
            if (s.essence.text) s.essenceHistory.push({ version: s.version, at: s.essence.at || '', text: s.essence.text, reason: str(op.reason) })
            s.essence = { text, claims: uniq(claims), sources: [], at }
            done({ id: 'essence' })
            break
        }
        case 'related_add':
        case 'related_prune': {
            const cs = strs(op.concepts)
            if (!cs.length) {
                fail('缺 concepts')
                break
            }
            const selfKey = keyOf(ctx.self)
            if (op.op === 'related_add') {
                const have = new Set(s.related.map(keyOf))
                for (const c of cs) {
                    const k = keyOf(c)
                    if (!k || k === selfKey || have.has(k)) continue
                    have.add(k)
                    s.related.push(c)
                }
            }
            else {
                const drop = new Set(cs.map(keyOf))
                s.related = s.related.filter((c) => !drop.has(keyOf(c)))
            }
            done({})
            break
        }
        case 'merge': {
            const ri = refOfKind(op.into, ['claims', 'parameters', 'questions'])
            if (!ri.id) {
                fail(`into ${ri.why}`)
                break
            }
            const into = ri.hit
            if (!str(op.reason)) {
                fail('缺 reason')
                break
            }
            const from = uniq(strs(op.from))
            if (!from.length || from.includes(into.item.id)) {
                fail('from 為空或含 into')
                break
            }
            const badFrom = from.map((id) => refOfKind(id, [into.key])).find((r) => !r.id)
            if (badFrom) {
                fail(`from ${badFrom.why}`)
                break
            }
            const hits = from.map((id) => findItem(s, id))
            if (str(op.text) && into.key === 'claims') {
                const tp = textProblem('claims', { text: op.text })
                if (tp) {
                    fail(tp)
                    break
                }
            }
            for (const h of hits) {
                Object.assign(h.item, { status: 'superseded', statusNote: `併入 ${into.item.id}：${str(op.reason)}`, mergedInto: into.item.id, supersededBy: into.item.id })
                hist(h.item, 'merge', `併入 ${into.item.id}`)
                into.item.sources = uniq([...(into.item.sources || []), ...(h.item.sources || [])])
                touched.add(h.item.id)
            }
            // 被併之主張若被爭議某方或本質引用,改指向 into(引用不懸空、contested 衍生正確)
            if (into.key === 'claims') {
                const map = new Set(from)
                for (const d of s.disputes) {
                    for (const sd of d.sides || []) {
                        if ((sd.claims || []).some((x) => map.has(x))) {
                            sd.claims = uniq(sd.claims.map((x) => (map.has(x) ? into.item.id : x)))
                            touched.add(d.id)
                        }
                    }
                }
                s.essence.claims = uniq((s.essence.claims || []).map((x) => (map.has(x) ? into.item.id : x)))
                for (const p of s.parameters) {
                    if (map.has(p.claim)) {
                        p.claim = into.item.id
                        touched.add(p.id)
                    }
                }
                if (str(op.text)) {
                    hist(into.item, 'merge', str(op.reason), { text: into.item.text })
                    into.item.text = str(op.text)
                    countOver('claims', { text: into.item.text })
                }
            }
            hist(into.item, 'merge', `併入 ${from.join('、')}`)
            touched.add(into.item.id)
            done({ id: into.item.id })
            break
        }
        case 'refacet': {
            const from = str(op.from)
            const to = str(op.to)
            if (!from || !to || from === to) {
                fail('refacet 須有不同之 from 與 to')
                break
            }
            const hit = s.claims.filter((c) => !TERMINAL.has(c.status) && c.facet === from)
            if (!hit.length) {
                fail(`無面向為「${from}」之主張`)
                break
            }
            for (const c of hit) {
                hist(c, 'refacet', `${from} → ${to}`, { facet: from })
                c.facet = to
                touched.add(c.id)
            }
            done({})
            break
        }
        default:
            fail('未知操作')
        }
        // 審查存疑(檔頭⑧):附於爭議類操作、且該操作套用成功者,記於其爭議——不移除、不改狀態;被拒收之操作不記
        if (isobj(op._doubt) && applied.length > nApplied) markDoubt(op, applied[applied.length - 1])
    }

    // 文字中殘留之本批代號(如「N4 指出…」)換成筆記連結 [[id]]:代號只在本批有效,留在狀態裡,下一批同名之代號即指向別篇
    //   (2026-09-29 真實模型驗收實測:爭議註記寫「N4 指出」)。長度與同文比對以模型原文為準(上方逐操作已查),此處只改存入之文字。
    //   〔@ref〕同理換成〔實際 id〕;所指之新項於同差量稍後才失敗者(檢查當時尚未處理)無 id 可換,去掉該標記(不留短命識別碼)
    const linkCodes = (v) => (typeof v === 'string'
        ? v.replace(/(?<![A-Za-z0-9])N\d+(?![0-9])/g, (m) => (codeMap.has(m) ? `[[${codeMap.get(m)}]]` : m))
            .replace(TEMP_REF_RE, (m, ref) => {
                const id = refState.get(ref)?.id
                return id ? `〔${id}〕` : ''
            })
        : v)
    const linkFields = (obj, fields) => {
        for (const f of fields) {
            if (isarr(obj?.[f])) obj[f] = obj[f].map(linkCodes)
            else if (typeof obj?.[f] === 'string') obj[f] = linkCodes(obj[f])
        }
    }
    for (const id of touched) {
        const hit = findItem(s, id)
        if (!hit) continue
        linkFields(hit.item, [...(TEXT_FIELDS[hit.key] || []), 'statusNote', 'validPeriod'])
        for (const sd of isarr(hit.item.sides) ? hit.item.sides : []) linkFields(sd, ['position', 'conditions'])
        for (const h of isarr(hit.item.history) ? hit.item.history : []) if (h.version === version) linkFields(h, ['note'])
        if (isobj(hit.item.doubt) && hit.item.doubt.version === version) linkFields(hit.item.doubt, ['note'])
    }
    if (essenceSeen) linkFields(s.essence, ['text'])

    deriveStatus(s)
    if (applied.length) {
        s.version = version
        s.updatedAt = at
        const byOp = {}
        for (const a of applied) byOp[a.op] = (byOp[a.op] || 0) + 1
        s.changelog.push({ version, at, mode, batch: [...new Set(codeMap.values())], applied: byOp, rejected: rejected.length, withheld: withheld.length, ...(isobj(ctx.meta) ? ctx.meta : {}) })
        if (mode === 'consolidate') s.lastConsolidated = version
    }
    // 暫緩之操作:@ref 換成本差量實際配發之 id(供存入待審;所依之新項被拒者 resolved 為 null)
    for (const w of withheld) {
        const o = { ...w._op }
        delete o._i
        delete o._withhold
        let ok = true
        const fix = (v) => {
            const x = str(v)
            if (!x.startsWith('@')) return x
            const id = refState.get(x.slice(1))?.id
            if (!id) ok = false
            return id || ''
        }
        for (const k of ['id', 'by', 'into', 'dispute']) if (o[k] !== undefined) o[k] = fix(o[k])
        if (isarr(o.from)) o.from = o.from.map(fix)
        linkFields(o, ['reason', 'validPeriod', 'note', 'text']) // 待審於日後另一批送審,本批代號同樣須換成連結
        o.sources = w.sources
        w.resolved = ok ? o : null
        delete w._op
    }
    // 回報依提案原序號排列(處理順序為相序,與提案順序不同)
    const byIndex = (a, b) => a.index - b.index
    return { state: s, applied: applied.sort(byIndex), rejected: rejected.sort(byIndex), withheld: withheld.sort(byIndex), touched: [...touched], overLimit, lengthChecked }
}


/**
 * 暫緩之終態操作存入待審(審查失敗或漏裁決時;其筆記因此算涵蓋——操作被保存,不是被丟棄)
 *
 * 同一目標已有待審者,新者取代舊者;超過上限丟最舊。
 *
 * @param {Object} state 輸入狀態(不修改,回傳新狀態)
 * @param {Array} withheld 輸入 applyDelta 之 withheld(各帶 resolved)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.at=''] 輸入時刻
 * @param {String} [opt.reason=''] 輸入暫緩原因(如「審查失敗」)
 * @returns {Object} 回傳 { state, queued:Integer, dropped:Array(被丟之待審) }
 */
export function queuePendingReview(state, withheld, opt = {}) {
    if (!isobj(opt)) opt = {}
    const s = clone(state)
    const q = isarr(s.pendingReview) ? s.pendingReview : []
    let queued = 0
    for (const w of isarr(withheld) ? withheld : []) {
        if (!w?.resolved) continue
        const key = `${w.resolved.op}|${w.resolved.id || w.resolved.into || ''}`
        const k = q.findIndex((x) => `${x.op.op}|${x.op.id || x.op.into || ''}` === key)
        const entry = { op: w.resolved, sources: w.sources || [], at: str(opt.at), version: s.version, reason: str(opt.reason) }
        if (k >= 0) q.splice(k, 1, entry)
        else q.push(entry)
        queued++
    }
    const dropped = q.length > PENDING_REVIEW_CAP ? q.splice(0, q.length - PENDING_REVIEW_CAP) : []
    s.pendingReview = q
    return { state: s, queued, dropped }
}


/**
 * 取出仍有效之待審操作(目標已為終態或不存在者丟棄),供下次審查以獨立差量裁決
 *
 * @param {Object} state 輸入狀態
 * @returns {Object} 回傳 { ops:Array(可交審查之操作,各帶 sources), stale:Array(丟棄之待審) }
 */
export function pendingReviewOps(state) {
    const ops = []
    const stale = []
    for (const e of isarr(state?.pendingReview) ? state.pendingReview : []) {
        const t = findItem(state, e?.op?.op === 'merge' ? e.op.into : e?.op?.id)
        if (!t || TERMINAL.has(t.item.status)) stale.push(e)
        else ops.push({ ...e.op, sources: e.sources || e.op.sources || [] })
    }
    return { ops, stale }
}


/** 審查剔除之理由(列舉) */
export const DROP_REASONS = ['離題', '無出處支持', '同篇', '重複', '性質標錯', '捏造']

/** 爭議類操作只接受之剔除理由——只收形式理由(程式保證:審查不可把真實爭議藏掉,安裝方 r3 實測「審計挑、修訂刪」使爭議流失)。
 *  「兩方非對立」屬內容判斷,審查以 doubt(存疑)表達:爭議照立並加註,拆解另由提案／整併端以 dispute_dissolve 提出、審查明列保留
 *  (1.0.4 曾以「非對立」剔除,預設審查席之同系模型實測把真爭議當非對立剔除;2026-09-29 三獨立審定案 E′,檔頭⑧) */
export const DISPUTE_DROP_REASONS = ['離題', '同篇']

/** 存疑之理由(裁決 action:'doubt';只適用於爭議類操作);舊寫法 drop＋「非對立」視同存疑 */
export const DOUBT_REASONS = ['非對立']

/** 拆解操作(dispute_dissolve)之剔除理由:剔除＝保留爭議,另可以「對立成立」剔除 */
export const DISSOLVE_DROP_REASONS = [...DROP_REASONS, '對立成立']

/** 模型可列入 skipped 之理由(支持既有主張之筆記須 confirm,不可列 skipped) */
export const SKIP_REASONS = ['離題', '無可用知識', '品質不足']

// 審查 fix 可改之欄位(不得新增出處:sources 只可刪減)
const FIXABLE = {
    add: ['text', 'conditions', 'pros', 'cons', 'period', 'critique', 'facet', 'basis', 'kind', 'sources'],
    confirm: ['sources'],
    revise: ['fields', 'reason', 'sources'],
    supersede: ['reason', 'validPeriod', 'sources'],
    retract: ['reason', 'note'],
    contest: ['reason', 'sources'],
    dispute_add: ['question', 'note'],
    dispute_update: ['note', 'status'],
    dispute_dissolve: ['reason', 'kinds'],
    param_add: ['name', 'value', 'conditions', 'period', 'snapshot', 'sources'],
    question_add: ['text'],
    question_resolve: ['resolution', 'sources'],
    essence: ['text', 'claims', 'reason'],
    related_add: ['concepts'],
}
const DISPUTE_OPS = new Set(['dispute_add', 'dispute_update', 'contest'])


/** 操作中所有「指向項目」之欄位值(含同差量之 '@ref') */
function refFields(o) {
    const one = [o?.id, o?.by, o?.into, o?.dispute, o?.claim]
    const many = [o?.from, o?.claims, ...(isarr(o?.sides) ? o.sides.map((sd) => sd?.claims) : []), ...(isarr(o?.sides_add) ? o.sides_add.map((sd) => sd?.claims) : [])]
    return [...one, ...many.flatMap((x) => (isarr(x) ? x : []))].filter((x) => typeof x === 'string')
}


/**
 * 套用審查裁決(逐操作:keep／drop／doubt／fix;於配號前套用,故不產生跳號)——審查不得新增操作,fix 不得增加出處
 *
 * @param {Object} delta 輸入提案 { ops:[...] }
 * @param {Array} verdicts 輸入裁決 [{ i, action:'keep'|'drop'|'doubt'|'fix', reason?, note?, fields? }]，未裁決之操作視為 keep；
 *   doubt(存疑)只適用於爭議類操作:照保留並帶 _doubt,由 applyDelta 記於爭議;舊寫法 drop＋「非對立」視同 doubt
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}(保留供擴充)
 * @returns {Object} 回傳 { delta:{ ops }(保留與修正者,各帶 _i＝提案原序號), dropped:Array({index,op,reason,note,sources}), fixed:Array(index),
 *   removed:Array({note,reason})(fix 刪去之出處), unverdicted:Array(index)(未得有效裁決者;其中終態操作由呼叫端比照降級), verdictRejected:Array({i,reason}),
 *   doubted:Array({index,op,reason,note,legacy}), droppedRefs:Object(被剔除之新項 ref → 剔除理由；交 applyDelta 之 ctx.droppedRefs),
 *   conflicts:Array({kept,dropped,ref,reason})(保留之操作引用被剔除之新項) }
 */
export function applyVerdicts(delta, verdicts, opt = {}) {
    if (!isobj(opt)) opt = {}
    const ops = isobj(delta) && isarr(delta.ops) ? delta.ops : []
    const byI = new Map()
    const verdictRejected = []
    for (const v of isarr(verdicts) ? verdicts : []) {
        const i = v?.i
        if (!Number.isInteger(i) || i < 0 || i >= ops.length) {
            verdictRejected.push({ i, reason: 'i 無效' })
            continue
        }
        if (byI.has(i)) {
            verdictRejected.push({ i, reason: '同一操作重複裁決' })
            continue
        }
        byI.set(i, v)
    }
    const kept = []
    const dropped = []
    const fixed = []
    const removed = []
    const unverdicted = []
    const doubted = []
    // 審查之說明(自由文字):單行、限長——入日誌與存疑,不因審查之文字連累提案之操作
    const noteOf = (v) => oneLine(v?.note).slice(0, 240)
    const srcOf = (o) => uniq([...strs(o?.sources), ...(isarr(o?.sides) ? o.sides.flatMap((sd) => strs(sd?.sources)) : []), ...(isarr(o?.sides_add) ? o.sides_add.flatMap((sd) => strs(sd?.sources)) : [])])
    ops.forEach((op, i) => {
        const v = byI.get(i)
        let action = str(v?.action)
        // 舊寫法相容:爭議類操作之 drop＋「非對立」＝存疑(1.0.4 之寫法;使用方自訂之審查提示詞不致把爭議移除)
        const legacy = action === 'drop' && DISPUTE_OPS.has(op?.op) && DOUBT_REASONS.includes(str(v?.reason))
        if (legacy) action = 'doubt'
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
            doubted.push({ index: i, op: str(op.op), reason, note, legacy })
            kept.push({ ...op, _i: i, _doubt: { reason, note, legacy } })
            return
        }
        if (action === 'drop') {
            const reason = str(v.reason)
            const okList = op?.op === 'dispute_dissolve' ? DISSOLVE_DROP_REASONS : (DISPUTE_OPS.has(op?.op) ? DISPUTE_DROP_REASONS : DROP_REASONS)
            if (!okList.includes(reason)) {
                verdictRejected.push({ i, reason: `${DISPUTE_OPS.has(op?.op) ? '爭議類操作' : '操作'}之剔除理由須為：${okList.join('、')}（收到「${reason}」）` })
                unverdicted.push(i)
                kept.push({ ...op, _i: i })
                return
            }
            dropped.push({ index: i, op: str(op?.op) || '?', reason, note: noteOf(v), sources: srcOf(op), ref: str(op?.ref) })
            return
        }
        if (action === 'fix') {
            const allow = FIXABLE[op?.op] || []
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


/**
 * 本批筆記之涵蓋計算:被已套用操作引用(used)、模型列入 skipped(理由須在 SKIP_REASONS)、被審查剔除之操作所引用(dropped)皆算涵蓋;
 * 其餘(含只被程式拒收或暫緩之操作引用者)為未涵蓋——值得重試(多為引用問題)
 *
 * @param {Object} o 輸入物件
 * @param {Array} o.batch 輸入本批 [{ code, id }]
 * @param {Array} [o.applied=[]] 輸入 applyDelta 之 applied(各帶 sources)
 * @param {Array} [o.skipped=[]] 輸入模型之 skipped [{ note:'N3'|id, reason }]
 * @param {Array} [o.dropped=[]] 輸入 applyVerdicts 之 dropped(各帶 sources 與 reason)
 * @param {Array} [o.queued=[]] 輸入存入待審之暫緩操作(applyDelta 之 withheld 中 resolved 非 null 者,各帶 sources)——操作已保存,其筆記算涵蓋
 * @param {Array} [o.removed=[]] 輸入審查 fix 刪去之出處 [{ note, reason }](審查已判定,算涵蓋)
 * @returns {Object} 回傳 { used:Array(id), pending:Array(id), skipped:Array({note,reason}), dropped:Array({note,reason}), uncovered:Array(id), badSkipped:Array }
 */
export function coverageOf(o) {
    const batch = (isarr(o?.batch) ? o.batch : []).filter((b) => isobj(b) && str(b.id))
    const byCode = new Map()
    for (const b of batch) {
        byCode.set(str(b.id), str(b.id))
        if (str(b.code)) byCode.set(str(b.code).toUpperCase(), str(b.id))
    }
    const toNote = (x) => byCode.get(str(x)) || byCode.get(str(x).toUpperCase()) || null
    const used = new Set((isarr(o?.applied) ? o.applied : []).flatMap((a) => (isarr(a?.sources) ? a.sources : [])).filter((id) => byCode.has(id)))
    const skipped = []
    const badSkipped = []
    const seen = new Set(used)
    for (const k of isarr(o?.skipped) ? o.skipped : []) {
        const id = toNote(k?.note)
        const reason = str(k?.reason)
        if (!id || !SKIP_REASONS.includes(reason)) {
            badSkipped.push({ note: str(k?.note), reason })
            continue
        }
        if (seen.has(id)) continue
        seen.add(id)
        skipped.push({ note: id, reason })
    }
    const pending = []
    for (const q of isarr(o?.queued) ? o.queued : []) {
        for (const x of isarr(q?.sources) ? q.sources : []) {
            const id = toNote(x)
            if (!id || seen.has(id)) continue
            seen.add(id)
            pending.push(id)
        }
    }
    const dropped = []
    const addDrop = (x, reason) => {
        const id = toNote(x)
        if (!id || seen.has(id)) return
        seen.add(id)
        dropped.push({ note: id, reason })
    }
    for (const d of isarr(o?.dropped) ? o.dropped : []) {
        for (const x of isarr(d?.sources) ? d.sources : []) addDrop(x, `審查剔除：${str(d.reason)}`)
    }
    for (const r of isarr(o?.removed) ? o.removed : []) addDrop(r?.note, `審查刪去出處：${str(r?.reason) || '未說明'}`)
    const uncovered = batch.map((b) => str(b.id)).filter((id) => !seen.has(id))
    return { used: [...used], pending, skipped, dropped, uncovered, badSkipped }
}


/**
 * 本批落帳:已涵蓋與「未涵蓋達上限」者計入 consumed,略過／剔除／逾限之理由記入 skipped(不改版號)
 *
 * @param {Object} state 輸入狀態(不修改,回傳新狀態)
 * @param {Object} cov 輸入 coverageOf 之產出
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.exhausted=[]] 輸入未涵蓋且已達重試上限之筆記 id(記「未涵蓋逾限」)
 * @returns {Object} 回傳新狀態
 */
export function commitBatch(state, cov, opt = {}) {
    const s = clone(state)
    if (!isobj(opt)) opt = {}
    const exhausted = isarr(opt.exhausted) ? opt.exhausted.map(str).filter(Boolean) : []
    const notes = [...(cov?.used || []), ...(cov?.pending || []), ...(cov?.skipped || []).map((x) => x.note), ...(cov?.dropped || []).map((x) => x.note), ...exhausted]
    s.consumed = uniq([...s.consumed, ...notes])
    const reasons = [...(cov?.skipped || []), ...(cov?.dropped || []), ...exhausted.map((note) => ({ note, reason: '未涵蓋逾限' }))]
    for (const r of reasons) s.skipped.push({ note: r.note, reason: r.reason, version: s.version })
    return s
}


/**
 * 不變式自檢(套用與落帳之後):違反者回傳說明字串陣列,空陣列＝通過
 *
 * @param {Object} before 輸入套用前狀態
 * @param {Object} after 輸入套用後狀態
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.touched=[]] 輸入本次被操作觸及之 id(applyDelta 之 touched)；未觸及者除衍生欄位(active／contested、evidence)外須逐欄不變
 * @returns {Array} 回傳違反說明陣列
 */
export function checkInvariants(before, after, opt = {}) {
    const out = []
    if (!isobj(opt)) opt = {}
    const touched = new Set(isarr(opt.touched) ? opt.touched : [])
    const idsAfter = new Map()
    for (const x of allItems(after)) {
        if (idsAfter.has(x.id)) out.push(`id 重複：${x.id}`)
        idsAfter.set(x.id, x)
    }
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    // 衍生欄位(證據等級、active／contested)由程式重算,不屬「被改動」
    const derivedFree = (x) => {
        const y = clone(x)
        delete y.evidence
        if (y.status === 'active' || y.status === 'contested') delete y.status
        if (isarr(y.sides)) for (const sd of y.sides) delete sd.evidence
        return y
    }
    for (const x of allItems(before)) {
        const y = idsAfter.get(x.id)
        if (!y) {
            out.push(`舊項遺失：${x.id}`)
            continue
        }
        const miss = (x.sources || []).filter((sid) => !(y.sources || []).includes(sid))
        if (miss.length) out.push(`出處減少：${x.id}（${miss.join('、')}）`)
        const hx = isarr(x.history) ? x.history : []
        const hy = isarr(y.history) ? y.history : []
        if (hy.length < hx.length || !eq(hy.slice(0, hx.length), hx)) out.push(`沿革被改寫：${x.id}`)
        if (TERMINAL.has(x.status) && !eq(derivedFree(x), derivedFree({ ...y, history: hx }))) out.push(`終態項被改動：${x.id}`)
        if (!touched.has(x.id) && !eq(derivedFree(x), derivedFree(y))) out.push(`未觸及之項被改動：${x.id}`)
        if (isarr(x.sides)) {
            if ((y.sides || []).length < x.sides.length) out.push(`爭議之方減少：${x.id}`)
            x.sides.forEach((sd, k) => {
                const ys = y.sides?.[k] || {}
                if ((sd.sources || []).some((sid) => !(ys.sources || []).includes(sid))) out.push(`爭議某方出處減少：${x.id} side ${k}`)
                for (const cid of sd.claims || []) {
                    const merged = idsAfter.get(cid)?.mergedInto
                    if (!(ys.claims || []).includes(cid) && !(merged && (ys.claims || []).includes(merged))) out.push(`爭議某方所引主張遺失：${x.id} side ${k}→${cid}`)
                }
            })
        }
    }
    for (const c of after.claims) {
        if (TERMINAL.has(c.status) && !c.statusNote) out.push(`終態無理由：${c.id}`)
        if (c.status === 'superseded' && !c.validPeriod && !c.mergedInto) out.push(`取代無成立期間：${c.id}`)
        if (c.status === 'retracted' && !RETRACT_REASONS.includes(c.retractReason)) out.push(`撤回理由不合：${c.id}`)
        for (const k of ['supersededBy', 'mergedInto']) if (c[k] && !idsAfter.has(c[k])) out.push(`${k} 懸空：${c.id}→${c[k]}`)
    }
    // 取代鏈無環
    for (const c of after.claims) {
        const seen = new Set([c.id])
        let cur = c.supersededBy
        while (cur) {
            if (seen.has(cur)) {
                out.push(`取代鏈成環：${c.id}`)
                break
            }
            seen.add(cur)
            cur = idsAfter.get(cur)?.supersededBy
        }
    }
    for (const d of after.disputes) {
        for (const sd of d.sides || []) for (const cid of sd.claims || []) if (!idsAfter.has(cid)) out.push(`爭議引用懸空：${d.id}→${cid}`)
    }
    for (const p of after.parameters) if (p.claim && !idsAfter.has(p.claim)) out.push(`參數引用懸空：${p.id}→${p.claim}`)
    for (const cid of after.essence?.claims || []) {
        const c = idsAfter.get(cid)
        if (!c || TERMINAL.has(c.status)) out.push(`本質所引主張懸空或為終態：${cid}`)
    }
    for (const e of after.pendingReview || []) {
        for (const id of [e?.op?.id, e?.op?.by, e?.op?.into, ...(isarr(e?.op?.from) ? e.op.from : [])]) {
            if (id && !idsAfter.has(id)) out.push(`待審引用懸空：${e.op.op}→${id}`)
        }
    }
    // consumed 只增,且涵蓋所有出處(出處必為確實讀過之筆記)
    const consumed = new Set(after.consumed || [])
    if ((before.consumed || []).some((x) => !consumed.has(x))) out.push('已用筆記減少')
    const orphan = uniq(allItems(after).flatMap((x) => x.sources || []).filter((sid) => !consumed.has(sid)))
    if (orphan.length) out.push(`出處不在已用筆記內：${orphan.slice(0, 5).join('、')}`)
    // 本質沿革只增;本質改寫時前一版須入沿革
    const eh0 = before.essenceHistory || []
    const eh1 = after.essenceHistory || []
    if (eh1.length < eh0.length || !eq(eh1.slice(0, eh0.length), eh0)) out.push('本質沿革被改寫')
    if (before.essence?.text && after.essence?.text !== before.essence.text && eh1[eh1.length - 1]?.text !== before.essence.text) out.push('本質改寫未入沿革')
    // 版號與 changelog
    const dv = (after.version || 0) - (before.version || 0)
    if (dv !== 0 && dv !== 1) out.push(`版號跳動：${before.version}→${after.version}`)
    if ((after.changelog || []).length !== (before.changelog || []).length + dv) out.push('changelog 與版號不一致')
    // id 計數單調,且大於既有最大編號
    for (const [p, key] of Object.entries(KEY_OF_PREFIX)) {
        const n = Number(after.nextId?.[p]) || 0
        if (n < (Number(before.nextId?.[p]) || 0)) out.push(`id 計數倒退：${p}`)
        const max = Math.max(0, ...(after[key] || []).map((x) => Number(String(x.id).slice(1)) || 0))
        if (n <= max) out.push(`id 計數不大於既有編號：${p}${max}`)
    }
    return out
}


/**
 * 規則表 → 提示詞文字(機制:依優先序編號;提案、審查、整併共用同一份——同一類規則只定義一次、注入各步)
 *
 * @param {Array} rules 輸入規則陣列 [{ id, text, priority }]
 * @returns {String} 回傳編號後之規則文字
 * @example
 * console.log(renderRules([{ id: 'b', text: '乙', priority: 2 }, { id: 'a', text: '甲', priority: 1 }]))
 * // => 1. 甲
 * // 2. 乙
 */
export function renderRules(rules) {
    return (isarr(rules) ? rules : [])
        .filter((r) => r && String(r.text || '').trim())
        .slice().sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .map((r, k) => `${k + 1}. ${String(r.text).trim()}`)
        .join('\n')
}


/**
 * 狀態之提示詞摘要(機制預設;domain 可自組):本質、主張(非終態)、爭議(未撤回)、參數、待解問題、相關概念;終態項只列 id 與一句
 *
 * @param {Object} state 輸入狀態
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Boolean} [opt.full=false] 輸入是否附出處篇數以外之全部欄位(整併用)
 * @returns {String} 回傳摘要文字；狀態為空時回傳「（尚無內容）」
 */
export function stateDigest(state, opt = {}) {
    if (!isobj(opt)) opt = {}
    const s = state || emptyState()
    const lines = []
    const j = (arr) => (isarr(arr) ? arr.filter(Boolean).join('；') : '')
    const ev = (x) => (x.evidence?.level ? `證據${x.evidence.level}` : '證據未評估')
    if (s.essence?.text) lines.push(`【本質】${s.essence.text}${(s.essence.claims || []).length ? `（依〔${s.essence.claims.join('〕〔')}〕）` : ''}`)
    const claims = s.claims.filter((c) => !TERMINAL.has(c.status))
    if (claims.length) {
        lines.push(`【主張】共 ${claims.length} 條`)
        for (const c of claims) {
            const parts = [`〔${c.id}〕[${c.kind}${c.facet ? `｜${c.facet}` : ''}] ${c.text}`]
            if (c.conditions?.length) parts.push(`條件：${j(c.conditions)}`)
            if (opt.full && c.pros?.length) parts.push(`利：${j(c.pros)}`)
            if (opt.full && c.cons?.length) parts.push(`弊：${j(c.cons)}`)
            if (c.period) parts.push(`時期：${c.period}`)
            if (opt.full && c.critique) parts.push(`銳評：${c.critique}`)
            parts.push(`${ev(c)}、出處 ${(c.sources || []).length} 篇${c.status === 'contested' ? '、有爭議' : ''}`)
            lines.push(parts.join('｜'))
        }
    }
    const disputes = s.disputes.filter((d) => d.status !== 'retracted')
    if (disputes.length) {
        lines.push('【爭議】（各方以 side k 標示，k 即操作之 "side" 值，自 0 起）')
        for (const d of disputes) {
            const sides = (d.sides || []).map((sd, k) => `side ${k}：${sd.position}${(sd.claims || []).length ? `（引〔${sd.claims.join('〕〔')}〕）` : ''}`).join('｜')
            // 審查存疑只顯示至其後第一次提案落盤(存疑產生之提案落帳時 proposedAt 即其時刻):給提案端至少一次拆解之機會,
            //   但不讓同一則懷疑逐批呈現而累積成拆解(第二方被第一方之懷疑帶著走);md 與審查所見之觸及條目常駐
            const doubt = d.status === 'open' && isobj(d.doubt) && str(d.doubt.at) >= str(s.proposedAt) ? `｜審查存疑（${d.doubt.reason}）：${d.doubt.note}` : ''
            lines.push(`〔${d.id}〕${d.status === 'resolved' ? '（已解決）' : ''}${d.question}｜${sides}${doubt}`)
        }
    }
    const params = s.parameters.filter((p) => !TERMINAL.has(p.status))
    if (params.length) {
        lines.push('【參數】')
        for (const p of params) lines.push(`〔${p.id}〕${p.name}＝${p.value}${p.conditions ? `（${p.conditions}）` : ''}${p.period ? `｜時期：${p.period}` : ''}${p.claim ? `｜依〔${p.claim}〕` : ''}`)
    }
    const qs = s.questions.filter((q) => q.status === 'open')
    if (qs.length) {
        lines.push('【待解問題】')
        for (const q of qs) lines.push(`〔${q.id}〕${q.text}`)
    }
    if (s.related.length) lines.push(`【相關概念】${s.related.join('、')}`)
    if ((s.pendingReview || []).length) {
        lines.push(`【待審（審查失敗或未得裁決而暫緩之不可逆操作——取代、撤回、合併、拆解；勿重複提出）】${s.pendingReview.map((e) => `〔${e.op.id || e.op.into}〕${e.op.op}${e.op.by ? `→〔${e.op.by}〕` : ''}`).join('、')}`)
    }
    const gone = allItems(s).filter((x) => TERMINAL.has(x.status))
    if (gone.length) lines.push(`【已取代／撤回】${gone.map((x) => `〔${x.id}〕${x.status === 'retracted' ? `撤回（${x.retractReason}）` : `取代${x.mergedInto ? `（併入〔${x.mergedInto}〕）` : ''}`}`).join('、')}`)
    return lines.length ? lines.join('\n') : '（尚無內容）'
}


export default { STATE_VERSION, DELTA_OPS, CONSOLIDATE_OPS, RETRACT_REASONS, TERMINAL_OPS, PENDING_REVIEW_CAP, DROP_REASONS, DISPUTE_DROP_REASONS, DOUBT_REASONS, DISSOLVE_DROP_REASONS, SKIP_REASONS, DEFAULT_CLAIM_KINDS, DEFAULT_LIMITS, emptyState, upgradeState, findItem, deriveStatus, applyDelta, queuePendingReview, pendingReviewOps, applyVerdicts, coverageOf, commitBatch, checkInvariants, renderRules, stateDigest }
