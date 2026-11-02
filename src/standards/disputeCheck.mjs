// disputeCheck.mjs — 檢定標準 ES14(爭議為真對立;終審存疑之處置——存疑逾 N 版即兩席判定拆解與否)之對象判定、單票驗證、判定小組、拆解之組裝
//
// 【對象】未解決且帶存疑(終審以 doubt 標示非對立／同篇)之爭議,且起草者已有一次機會:核心於存疑之後已再升版(存疑版本 + minVersions
//   ≤ 核心版本),或存疑已逾 waitDays 天(閒置核心永不升版——只以版數判會使存疑常駐,正是本標準要處置之缺陷)。
//   已覆核者(狀態之 doubtChecks 記錄與現存疑同版同次同素材)不再排;待判中(ES14 未結,非要求重試)者與使用者豁免後無新存疑者不再自動排
//   (disputeHoldSetsOf／disputeHeldIdsOf;專步與掃描同一讀法)。
// 【單一真理】覆核之結果只記於狀態之 doubtChecks(對立)或拆解之差量(非對立),不另寫檢核紀錄;掃描之 ES14 列由各核心狀態推得(disputeProgressOf)。
// 【裁決】opposed(真對立)｜not-opposed(回答不同問題或可同時成立)｜same-study(對立只出自同一研究之正反)｜unsure;非 opposed 之理由 ≥10 字,
//   不合格之票＝缺票。判定小組以類別成立(對立／非對立;not-opposed 與 same-study 處置相同,原因只記錄)。
//   非對立之票另附拆解欄位(kinds、annotations;與 dispute_dissolve 同形),由呼叫端組成拆解操作、經同一納入閘。
// 【材料】爭議之問題、各方立場與條件與 basis、各方所引主張、各方出處筆記之內容(與 ES2／ES9 同一 contentOf,S1… 各列一次)、終審之存疑。
// 【判定小組】依出處字數分頁(同 ES9 之 SUPPORT_PAGE_CHARS;項連同其出處入同頁),每頁交摘要套件之單頁執行器 runPanelPage(逐頁驅動取
//   standards/panelVotes 之 runPanelPages:放不下對半分、單項仍放不下即材料過大、中止即已判之頁照回);本檔只給本標準之差異:無項不呼叫、
//   提示詞之項(出處於該頁各項去重後標號)、一席回覆之逐項票(拆解欄位之長度依該項之方數)、「相同」之定義(類別)、裁定附項編號、打亂前綴 es14、
//   段名 dispute1／dispute2／dispute3。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { PANEL_UNSURE, runPanelPage } from '../core/summarizePackage.mjs'
import { sha1, cmp, textValueOf as str, textListOf as strs, uniq } from '../core/capturePackage.mjs'
import { HASH_FIELD_SEP, withdrawnOf, dissolveSidesOf } from '../stores/coreState.mjs'
import { replyObjectOf } from './parse.mjs'
import { VERDICT_MIN_REASON, NO_MATERIAL_TEXT, verdictFieldsOf, votesByIndexOf, panelCallOf, runPanelPages } from './panelVotes.mjs'
import { SUPPORT_PAGE_CHARS, packSupportPages } from './supportCheck.mjs'
import { EXTRACT_HOLD_OBJECTS, parseItemOid } from '../stores/extractHolds.mjs'
import { EXTRACT_DEFAULT } from '../core/extractSettings.mjs'

/** 標準識別 */
export const ES14 = Object.freeze({ std: 'ES14', v: 1 })
/** 合法裁決值 */
export const DISPUTE_VERDICTS = Object.freeze(['opposed', 'not-opposed', 'same-study', PANEL_UNSURE])
/** 裁決之中文 */
export const DISPUTE_WORD = Object.freeze({ 'opposed': '真對立', 'not-opposed': '非對立', 'same-study': '對立只出自同一研究', 'unsure': '不確定' })
/** 待判之物件種類(oid＝`<核心 id>:<爭議 id>`) */
export const ES14_OBJECT = EXTRACT_HOLD_OBJECTS.dispute

const disputeClass = (v) => (v?.verdict === 'opposed' ? 'opposed' : 'not')
// 判定小組之「相同」取類別:對立與否(not-opposed／same-study 皆為非對立,處置相同);兩票皆須為明確之票(物件)——'unsure' 不屬任何類別
const sameDispute = (a, b) => isobj(a) && isobj(b) && disputeClass(a) === disputeClass(b)

/**
 * 爭議之內容雜湊(問題、各方立場／條件／basis／所引主張／出處,與各方出處之內容鍵——判定所讀之素材,出處內容變即重判〔終審 §3 D5g〕;覆核紀錄之對象版本)
 *
 * @param {Object} d 輸入爭議
 * @param {Function} [keyOf] 輸入 (筆記 id)=>內容鍵(字串;不可得回 '';未給視為 ''——只比結構,供無內容鍵之讀者〔渲染〕)
 * @returns {String} 回傳 12 碼雜湊
 * @example
 * const d = { question: '黑洞自旋可否量測', sides: [{ position: '可', sources: ['n1'] }, { position: '不可', sources: ['n2'] }] }
 * console.log(disputeHashOf(d, () => 'k1') === disputeHashOf(d, () => 'k1'), disputeHashOf(d, () => 'k1') === disputeHashOf(d, () => 'k2'))
 * // => true false
 */
export function disputeHashOf(d, keyOf) {
    const k = isfun(keyOf) ? keyOf : () => ''
    const sides = (isarr(d?.sides) ? d.sides : []).map((sd) => [str(sd?.position), strs(sd?.conditions).join('；'), str(sd?.basis), strs(sd?.claims).join(','), strs(sd?.sources).map((n) => `${n}=${str(k(n))}`).join(',')].join('|'))
    return sha1(`${str(d?.question)}\u0000${sides.join(HASH_FIELD_SEP)}`).slice(0, 12)
}

/**
 * 現存疑是否已覆核(狀態之 doubtChecks 記錄與現存疑同版、同次、同素材,且為本標準之現行版本——標準改版即重檢)。
 *   給了 keyOf 者比含出處內容鍵之素材雜湊(記錄之 hash;維護、專步與掃描);未給者比只含結構之雜湊(記錄之 shape;渲染——不讀出處內容鍵)
 *
 * @param {Object} state 輸入核心狀態
 * @param {Object} d 輸入爭議
 * @param {Function} [keyOf] 輸入 (筆記 id)=>內容鍵
 * @returns {Boolean} 回傳是否已覆核
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { text: '乙', sources: ['n2'] }], disputes: [{ question: '丙', sides: [{ position: '一方', claims: ['C1'], sources: ['n1'] }, { position: '他方', claims: ['C2'], sources: ['n2'] }], doubt: { reason: '非對立', note: '兩方回答不同情境' } }] }).state
 * console.log(doubtCheckedOf(s, s.disputes[0]))
 * // => false
 */
export function doubtCheckedOf(state, d, keyOf) {
    const r = isobj(state?.doubtChecks) ? state.doubtChecks[d?.id] : null
    if (!r || Number(r.v) !== Number(ES14.v) || Number(r.doubtVersion) !== Number(d?.doubt?.version) || Number(r.doubtCount || 1) !== Number(d?.doubt?.count || 1)) return false
    return isfun(keyOf) ? r.hash === disputeHashOf(d, keyOf) : r.shape === disputeHashOf(d)
}

/**
 * 到期之存疑爭議
 *
 * @param {Object} state 輸入核心狀態
 * @param {Object} [o={}] 輸入 { minVersions, waitDays(皆預設＝設定預設之 standards.disputeCheck), nowMs, heldIds:Set(待判中、非要求重試之爭議 id), keyOf?:(nid)=>內容鍵(已覆核之判定含素材) }
 * @returns {Array} 回傳 [{ id, age(版差), days(存疑以來之天數) }](存疑久者先)
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { text: '乙', sources: ['n2'] }], disputes: [{ question: '丙', sides: [{ position: '一方', claims: ['C1'], sources: ['n1'] }, { position: '他方', claims: ['C2'], sources: ['n2'] }], doubt: { reason: '非對立', note: '兩方回答不同情境' } }] }).state
 * console.log(disputeDueOf(s, { minVersions: 0, waitDays: 0, nowMs: Date.parse('2026-09-10T00:00:00+08:00') }))
 * // => [ { id: 'D1', age: 0, days: Infinity } ]
 */
export function disputeDueOf(state, o = {}) {
    const minVersions = Number.isInteger(o.minVersions) && o.minVersions >= 0 ? o.minVersions : EXTRACT_DEFAULT.standards.disputeCheck.minVersions
    const waitDays = Number.isFinite(o.waitDays) && o.waitDays >= 0 ? o.waitDays : EXTRACT_DEFAULT.standards.disputeCheck.waitDays
    const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now()
    const held = o.heldIds instanceof Set ? o.heldIds : new Set()
    const version = Number(state?.version) || 0
    const out = []
    for (const d of isarr(state?.disputes) ? state.disputes : []) {
        if (d?.status !== 'open' || !isobj(d.doubt) || held.has(d.id) || doubtCheckedOf(state, d, o.keyOf)) continue
        const age = version - (Number(d.doubt.version) || 0)
        const at = Date.parse(str(d.doubt.at))
        const days = Number.isFinite(at) ? (nowMs - at) / 86400_000 : Infinity
        if (age >= minVersions || days >= waitDays) out.push({ id: d.id, age, days })
    }
    return out.sort((a, b) => b.days - a.days || cmp(String(a.id), String(b.id)))
}

/**
 * 待判登錄(本標準)→ 逐核心之「不再自動排入」之材料:待判中(未結、非要求重試)之爭議 id、已豁免之爭議與其豁免時刻(專步與掃描同一讀法)
 *
 * @param {Array} rows 輸入待判登錄列(本標準之列;他標準之列略過)
 * @param {Function} [retryRequested] 輸入 (登錄)=>Boolean(使用者要求重試;未給視為否)
 * @returns {Map} 回傳 Map(核心 id → { held:Set(爭議 id), waived:Map(爭議 id → 豁免時刻) })
 * @example
 * const sets = disputeHoldSetsOf([])
 * console.log(sets.size, [...sets.keys()])
 * // => 0 []
 */
export function disputeHoldSetsOf(rows, retryRequested) {
    const out = new Map()
    const at = (coreId) => out.get(coreId) || out.set(coreId, { held: new Set(), waived: new Map() }).get(coreId)
    for (const h of isarr(rows) ? rows : []) {
        if (h?.std !== ES14.std || h.object !== ES14_OBJECT) continue
        const { coreId, id: did } = parseItemOid(h.oid)
        if (!coreId || !did) continue
        if (h.status === 'waived') at(coreId).waived.set(did, String(h.waivedAt || h.at || ''))
        if (h.status !== 'open' || (isfun(retryRequested) && retryRequested(h))) continue
        at(coreId).held.add(did)
    }
    return out
}

/**
 * 不再自動排入之爭議 id:待判中者;使用者豁免(保留爭議與存疑)且其後無新的終審存疑者(存疑時刻不晚於豁免——以當下狀態判)
 *
 * @param {Object} state 輸入核心狀態
 * @param {Object} [o={}] 輸入 { held:Iterable(爭議 id), waived:Iterable([爭議 id, 豁免時刻]) }(disputeHoldSetsOf 之一核心)
 * @returns {Set} 回傳爭議 id 集合
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] }).state
 * console.log([...disputeHeldIdsOf(s, { held: ['D1'], waived: [] })])
 * // => [ 'D1' ]
 */
export function disputeHeldIdsOf(state, o = {}) {
    const out = new Set(o?.held || [])
    for (const [did, at] of o?.waived || []) {
        const d = (isarr(state?.disputes) ? state.disputes : []).find((x) => x.id === did)
        if (d && str(d.doubt?.at) <= str(at)) out.add(did)
    }
    return out
}

/**
 * 一核心之本標準進度(掃描之 ES14 列由狀態推得——覆核紀錄只在狀態之 doubtChecks,不另寫檢核紀錄〔終審 §3 D5g〕):
 *   已檢＝doubtChecks 筆數、合格＝現版且判為對立、版本過時＝記錄之標準版本非現版;受檢總量＝未解決且帶存疑之爭議數;到期＝disputeDueOf 之數
 *
 * @param {Object} state 輸入核心狀態
 * @param {Object} [o={}] 輸入 disputeDueOf 之選項(minVersions、waitDays、nowMs、heldIds、keyOf)
 * @returns {Object} 回傳 { checked, pass, stale, total, due }
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { text: '乙', sources: ['n2'] }], disputes: [{ question: '丙', sides: [{ position: '一方', claims: ['C1'], sources: ['n1'] }, { position: '他方', claims: ['C2'], sources: ['n2'] }], doubt: { reason: '非對立', note: '兩方回答不同情境' } }] }).state
 * console.log(disputeProgressOf(s, { minVersions: 0, waitDays: 0, nowMs: Date.parse('2026-09-10T00:00:00+08:00') }))
 * // => { checked: 0, pass: 0, stale: 0, total: 1, due: 1 }
 */
export function disputeProgressOf(state, o = {}) {
    const r = { checked: 0, pass: 0, stale: 0, total: 0, due: 0 }
    for (const x of Object.values(isobj(state?.doubtChecks) ? state.doubtChecks : {})) {
        if (!isobj(x)) continue
        r.checked++
        if (Number(x.v) !== Number(ES14.v)) r.stale++
        else if (x.verdict === 'opposed') r.pass++
    }
    r.total = (isarr(state?.disputes) ? state.disputes : []).filter((d) => d?.status === 'open' && isobj(d.doubt)).length
    r.due = disputeDueOf(state, o).length
    return r
}

/**
 * 受檢項(每則爭議一項):文字與所引出處筆記
 *
 * @param {Object} state 輸入核心狀態
 * @param {Array} ids 輸入爭議 id
 * @returns {Array} 回傳 [{ key(爭議 id), dispute, sides:[{ position, conditions, basis, claims:[{ id, text, conditions }], toClaim(拆解時轉為主張——須有種類與標注) }],
 *   notes:Array(筆記 id), doubt }]
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { text: '乙', sources: ['n2'] }], disputes: [{ question: '丙', sides: [{ position: '一方', claims: ['C1'], sources: ['n1'] }, { position: '他方', claims: ['C2'], sources: ['n2'] }], doubt: { reason: '非對立', note: '兩方回答不同情境' } }] }).state
 * console.log(disputeItemsOf(s, ['D1']).map((it) => [it.key, it.sides.length]))
 * // => [ [ 'D1', 2 ] ]
 */
export function disputeItemsOf(state, ids) {
    const W = withdrawnOf(state)
    const claimOf = new Map((isarr(state?.claims) ? state.claims : []).map((c) => [c.id, c]))
    const out = []
    for (const id of isarr(ids) ? ids : []) {
        const d = (isarr(state?.disputes) ? state.disputes : []).find((x) => x.id === id)
        if (!d) continue
        const plan = dissolveSidesOf(state, d)
        const sides = (d.sides || []).map((sd, k) => ({
            toClaim: plan[k]?.to === 'claim',
            position: str(sd?.position),
            conditions: strs(sd?.conditions),
            basis: str(sd?.basis),
            claims: strs(sd?.claims).map((cid) => claimOf.get(cid)).filter(Boolean).map((c) => ({ id: c.id, text: str(c.text), conditions: strs(c.conditions) })),
            notes: uniq([...strs(sd?.sources), ...strs(sd?.claims).flatMap((cid) => strs(claimOf.get(cid)?.sources))]).filter((n) => !W.has(n)),
        }))
        out.push({ key: d.id, dispute: d, sides, notes: uniq(sides.flatMap((x) => x.notes)), doubt: { reason: str(d.doubt?.reason), note: str(d.doubt?.note) } })
    }
    return out
}

/**
 * 單票驗證
 *
 * @param {*} raw 輸入 { verdict, reason, kinds?, annotations? }
 * @param {Integer} [nSides=0] 輸入爭議之方數(拆解欄位之長度;0＝不驗)
 * @returns {Object|String|null} 回傳 { verdict, reason, kinds?, annotations? }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * console.log(checkDisputeVerdictOf({ verdict: 'opposed', reason: '兩方對同一問題給出相反結論' }, 2), checkDisputeVerdictOf({ verdict: 'maybe' }, 2))
 * // => { verdict: 'opposed', reason: '兩方對同一問題給出相反結論' } null
 */
export function checkDisputeVerdictOf(raw, nSides = 0) {
    const f = verdictFieldsOf(raw)
    if (!f) return null
    const { verdict: v, reason } = f
    if (v === PANEL_UNSURE) return PANEL_UNSURE
    if (v === 'opposed') return { verdict: v, reason }
    if (v !== 'not-opposed' && v !== 'same-study') return null
    if (reason.length < VERDICT_MIN_REASON) return null
    const out = { verdict: v, reason }
    // 拆解欄位:長度須等於方數(可省略——省略者此票仍計入類別,只是無法用來組拆解操作)
    if (isarr(raw.kinds) || isarr(raw.annotations)) {
        const kinds = isarr(raw.kinds) ? raw.kinds.map((x) => (x === null ? null : str(x) || null)) : []
        const annotations = isarr(raw.annotations) ? raw.annotations.map((x) => (isobj(x) ? x : null)) : []
        if (!nSides || (kinds.length === nSides && annotations.length === nSides)) Object.assign(out, { kinds, annotations })
    }
    return out
}

/**
 * 一席之回覆({ checks:[{ index, verdict, reason, kinds?, annotations? }] })→ 逐項票(讀法見 panelVotes 之 votesByIndexOf);同編號矛盾者作廢為缺票
 *
 * @param {*} json 輸入 parseDisputeChecks 之產物
 * @param {Map} sidesOf 輸入 項編號 → 方數(本席所見之項)
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)
 * @example
 * const json = { checks: [{ index: 1, verdict: 'opposed', reason: '兩方對同一問題給出相反結論' }] }
 * console.log(seatDisputeVotesOf(json, new Map([[1, 2]])))
 * // => Map(1) { 1 => { verdict: 'opposed', reason: '兩方對同一問題給出相反結論' } }
 */
export function seatDisputeVotesOf(json, sidesOf) {
    return votesByIndexOf(json, { seen: (i) => sidesOf instanceof Map && sidesOf.has(i), voteOf: (it, i) => checkDisputeVerdictOf(it, sidesOf.get(i)), same: sameDispute })
}

/**
 * 覆核席之形狀檢查(爭議覆核):須有 checks 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkDisputeChecks({ checks: [] }), checkDisputeChecks({}))
 * // => true false
 */
export const checkDisputeChecks = (j) => !!j && isarr(j.checks)

/**
 * 覆核席之解析(爭議覆核;取最後一個過 checkDisputeChecks 者)
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 checks 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseDisputeChecks('{"checks":[{"index":1,"verdict":"opposed","reason":"兩方對同一問題給出相反結論"}]}').checks.length, parseDisputeChecks('x'))
 * // => 1 null
 */
export const parseDisputeChecks = (s) => replyObjectOf(s, ['checks'], checkDisputeChecks)

/**
 * 以一票組拆解操作(dispute_dissolve;與起草者提出者同形,交同一納入閘)。拆解時轉為主張之方(toClaim),其種類須在清單內、標注須為物件——
 *   否則此票不可用於拆解(不交 coreState 以第一種類後備:後備值會把模型之錯填藏起來;模型可能照抄範例之 null)
 *
 * @param {Object} item 輸入受檢項(disputeItemsOf;sides[k].toClaim)
 * @param {Object} vote 輸入非對立之票(含 kinds、annotations)
 * @param {Array} [kinds] 輸入主張種類清單(domain.claimKinds);未給則不驗種類
 * @returns {Object|null} 回傳操作;票無拆解欄位、長度不符、或轉為主張之方之種類／標注不合者回 null
 * @example
 * const item = { key: 'D1', sides: [{ position: '一方', toClaim: false }, { position: '他方', toClaim: false }] }
 * const vote = { verdict: 'not-opposed', reason: '兩方回答不同情境', kinds: ['rule', 'rule'], annotations: [{}, {}] }
 * console.log(dissolveOpOf(item, vote, DEFAULT_CLAIM_KINDS), dissolveOpOf(item, { verdict: 'not-opposed', reason: '兩方回答不同情境' }, DEFAULT_CLAIM_KINDS))
 * // => {
 * //   op: 'dispute_dissolve',
 * //   id: 'D1',
 * //   reason: '兩方回答不同情境',
 * //   kinds: [ 'rule', 'rule' ],
 * //   annotations: [ {}, {} ]
 * // } null
 */
export function dissolveOpOf(item, vote, kinds) {
    if (!isobj(vote) || !isarr(vote.kinds) || !isarr(vote.annotations)) return null
    const n = item?.sides?.length || 0
    if (vote.kinds.length !== n || vote.annotations.length !== n) return null
    const bad = (item.sides || []).some((sd, k) => sd?.toClaim && ((isarr(kinds) && !kinds.includes(vote.kinds[k])) || !isobj(vote.annotations[k])))
    if (bad) return null
    return { op: 'dispute_dissolve', id: item.key, reason: str(vote.reason), kinds: vote.kinds, annotations: vote.annotations }
}

/**
 * 判定小組之執行(依出處字數分頁;每頁交 runPanelPage——第一、二席並行(第二席項序打亂)→ 未成立且可成立者叫第三席;見檔頭【判定小組】)
 *
 * @param {Object} o 輸入 { items(disputeItemsOf), concept, contentOf:(nid)=>String|null, titleOf:(nid)=>String, buildPrompt(domain.buildDisputeCheckPrompt),
 *   call:(stage, seat, prompt)=>Promise<{ ok, json, providerId, stopped? }>, seats:{ first, second, third? }, pageChars? }
 * @returns {Promise<Object>} 回傳 { decisions:Map(爭議 id → decidePanel 之結果＋votes＋index;材料過大者 { status:'undetermined', why:'oversize' }), calls, stopped,
 *   undecided:Array(爭議 id;中止而未判), oversize:Array(爭議 id) }
 * @example
 * need test in nodejs.
 *
 * const r = await runDisputeCheck({ items, concept: '黑洞', contentOf, titleOf, buildPrompt, call, seats: { first, second, third } })
 * console.log(r.decisions, r.undecided, r.oversize)
 */
export async function runDisputeCheck(o) {
    const items = isarr(o.items) ? o.items : []
    const contentOf = isfun(o.contentOf) ? o.contentOf : () => null
    const titleOf = isfun(o.titleOf) ? o.titleOf : (nid) => nid
    const seats = isobj(o.seats) ? o.seats : {}
    if (!items.length) return { decisions: new Map(), calls: 0, stopped: false, undecided: [], oversize: [] }
    const pages = packSupportPages(items, (nid) => String(contentOf(nid) ?? '').length, Number(o.pageChars) > 0 ? Number(o.pageChars) : SUPPORT_PAGE_CHARS)
    return runPanelPages({
        pages,
        runPage: async (page, track) => {
            const notes = uniq(page.flatMap((it) => it.notes))
            const label = new Map(notes.map((n, i) => [n, `S${i + 1}`]))
            const sources = notes.map((n) => ({ label: label.get(n), title: titleOf(n), text: contentOf(n) ?? NO_MATERIAL_TEXT }))
            const local = page.map((it, j) => ({ index: j + 1, key: it.key, it }))
            const byIdx = new Map(local.map((x) => [x.index, x]))
            const view = (x) => ({ index: x.index, question: str(x.it.dispute.question), doubt: x.it.doubt, sides: x.it.sides.map((sd) => ({ ...sd, labels: sd.notes.map((n) => label.get(n)) })) })
            const r = await runPanelPage({
                local,
                buildPrompt: (xs) => o.buildPrompt({ concept: o.concept, sources, items: xs.map(view) }),
                shufflePrefix: 'es14',
                stages: ['dispute1', 'dispute2', 'dispute3'],
                call: panelCallOf(o, track),
                seats,
                // 拆解欄位之長度驗於該項之方數(取票時才讀)
                votesOf: (data, idx) => seatDisputeVotesOf(data, new Map([...idx].map((i) => [i, byIdx.get(i).it.sides.length]))),
                same: sameDispute,
            })
            const decisions = new Map()
            for (const x of local) if (r.byIndex.has(x.index)) decisions.set(x.key, { ...r.byIndex.get(x.index), index: x.index })
            return { decisions, calls: r.calls, stopped: r.stopped }
        },
    })
}

export default { ES14, DISPUTE_VERDICTS, DISPUTE_WORD, ES14_OBJECT, disputeHashOf, doubtCheckedOf, disputeDueOf, disputeHoldSetsOf, disputeHeldIdsOf, disputeProgressOf, disputeItemsOf, checkDisputeVerdictOf, seatDisputeVotesOf, parseDisputeChecks, checkDisputeChecks, dissolveOpOf, runDisputeCheck }
