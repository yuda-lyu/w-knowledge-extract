// esCases.mjs — 檢定標準 ES9／ES8／ES14／ES11 之逐案題組(一案一個受檢項,附應然)之頁組法、逐項票與類別,及評分題組之共用件(案 → 合成之核心狀態、
//   題組層之出處一致性):安裝方之 AI 逐案測試與本套件之 AI 能力評分(bench/extractBench)同讀此一份
//
// 【為何獨立成檔】逐案題組之提示詞須與正式管線同形(同一 domain 之提示詞函數),而「一頁放哪幾案、項怎麼編號、出處怎麼標號」是題組才有之
//   組法——安裝方之逐案測試與評分各寫一份即漂移,題組之提示詞指紋(逐案測試記錄、綁定題組與提示詞之版本)與評分所送者不同而無人察覺。
// 【頁組法(六條件;與正式之 run*Check 同一組法)】①domain 由呼叫端給(createExtractDomain;詞彙經 pickExtractVocab 取子集)②每頁至多
//   ES_CASE_PAGE_SIZE 案(可改;ES11 之頁量與正式同義專步同源),ES8 一案一頁(候選只限本案——同頁即他案之筆記亦成候選)③項編號頁內重起
//   (ES8 恆 1;同正式之 runSupportCheck／runDisputeCheck／runSynonymCheck)④出處標號 S1… 依頁內首次出現序以出處 id 去重(ES9、ES14;
//   同正式之 uniq(notes));ES8 依本案之候選序——同一出處 id 於題組內之標題與內文須一致(esSuiteProblems)⑤概念名 ES_CASE_CONCEPT
//   ⑥各欄之預設:basis ''、conditions []、claims []、toClaim 非 false 即 true。
// 【票與類別同正式】逐項票一律以正式之單票驗證(seatSupportVotesOf／seatOrphanVotesOf／seatDisputeVotesOf／seatSynonymVotesOf;同編號矛盾
//   作廢為缺票);類別以正式之判定:ES9 受支持與否(supportClassOf;不受支持之三種原因同類)、ES8 supported／none、ES14 對立與否、ES11
//   same／different,unsure 皆為合法類別。
//   比對另有兩處逐案之要件(與正式之判定小組同義):ES9／ES8 之應然列了支持之出處者,受支持之票須分別列出、非空且皆屬應然(esByMatchOf;
//   ES8 之應然必列、ES9 選列)——列了不支持者為 ES_BY_MISMATCH(正式以兩席所列之交集／聯集補出處或定排除集,列錯即補錯);ES14 之非對立票
//   須附可用之拆解欄位(dissolveUsableOf),不可用者為 ES_NOT_NOFIELDS(正式之拆解不成而轉待判)。
// 【案 → 合成之核心狀態(coreStateOf;一份)】題組以精簡之描述(主張、爭議、參數、待解問題、本質、待審)給狀態;本檔補齊正式條目之全部欄位、
//   配發編號計數、消化之筆記,並以正式之不變式自檢(checkInvariants)——爭議覆核之拆解、修訂案之閘與評分之工作流角色同讀之。
// 【拆解可用(dissolveUsableOf)】與正式爭議覆核之拆解同一路徑:題組之爭議建成合成之核心狀態(各方之出處為題組之出處、所引主張為狀態中之
//   主張)→ 正式之受檢項(disputeItemsOf;各方之去處由 dissolveSidesOf 判定,須與題組之 toClaim 相符)→ dissolveOpOf(種類在清單、標注為物件)
//   → 操作守門(guardOps;正體轉換 ES3,依呼叫端給之語言設定)→ 納入閘(createOpStandards 之 screen:ES2 數字紮根、ES4 標注、ES12 principle 跨篇、
//   ES17 不提及筆記、流程外洩)→ applyDelta 套用不被拒收且不變式成立。出處之內容＝題組出處之標題＋內文(正式為筆記之內容章＋原文標題＋發布時間)、
//   文件以出處 id 計(ES12)。
// 【修訂案(reviseCaseOf)】ES9 之語氣超出證據之修訂(standards/supportRevise)之逐案:斷言種類限新增主張(add)與爭議之一方(side)——其操作
//   可由案之欄位完整重建;改寫既有主張(revise)之操作與納入閘之材料取決於改寫前之條目與其既有出處,案之欄位表達不了,不收。修訂項之欄＝正式之
//   fieldsOf;覆核說明＝案之結構化投票(votes)經正式之 notSupportedReasonsOf;修訂後之可用＝applySupportFixes 套回 → 操作守門 → 納入閘,同正式
//   修訂之路徑(正式其後再交判定小組重判——另一次 AI 呼叫,屬出處支持覆核之能力)。新增主張另以 applyDelta 試套不被拒收(種類在清單、長度未逾
//   硬上限;納入閘之試套被拒收時不報問題,須另驗);爭議之一方只驗守門與納入閘(爭議之其他方不在案中,整則爭議之套用無從重建)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { PANEL_UNSURE } from '../core/summarizePackage.mjs'
import { emptyState, checkInvariants, DEFAULT_CLAIM_KINDS } from '../stores/coreState.mjs'
import { applyDelta } from '../stores/coreDelta.mjs'
import { guardOps } from './opGuards.mjs'
import { createOpStandards, opStandardsCtxOf, applyCtxOf, gateOps } from './opStandards.mjs'
import { ES9, SUPPORT_KINDS, SUPPORT_VERDICTS, supportClassOf, seatSupportVotesOf } from './supportCheck.mjs'
import { ES8, seatOrphanVotesOf } from './orphanCheck.mjs'
import { ES14, disputeItemsOf, dissolveOpOf, seatDisputeVotesOf } from './disputeCheck.mjs'
import { ES11, SYNONYM_PAGE_SIZE, seatSynonymVotesOf } from './synonymCheck.mjs'
import { fieldsOf, notSupportedReasonsOf, revisableOf } from './supportRevise.mjs'
import { textValueOf as str, textListOf as strs, uniq } from '../core/capturePackage.mjs'

export { supportClassOf }

/**
 * 逐案題組之標準(依序)
 *
 * @type {Array}
 */
export const ES_CASE_STDS = Object.freeze([ES9.std, ES8.std, ES14.std, ES11.std])

/** 每頁案數之預設(ES8 恆一案一頁;與正式同義專步之每頁對數同源——standards/synonymCheck 之 SYNONYM_PAGE_SIZE) */
export const ES_CASE_PAGE_SIZE = SYNONYM_PAGE_SIZE

/** 題組之概念名(提示詞之「…」核心) */
export const ES_CASE_CONCEPT = '題組'

/** ES9／ES8:受支持之票所列之支持出處不屬應然(或未分別列出)之類別 */
export const ES_BY_MISMATCH = 'supported(出處不符)'

/** ES14:非對立之票之拆解欄位不可用之類別 */
export const ES_NOT_NOFIELDS = 'not-nofields'

/** 修訂案之斷言種類(見檔頭【修訂案】) */
export const REVISE_CASE_KINDS = Object.freeze(['add', 'side'])

/** 合成之爭議 id(dissolveUsableOf 之核心狀態) */
const DISPUTE_ID = 'D1'

/** 合成狀態之條目編號前綴 → 狀態之集合 */
const ITEM_PREFIX = Object.freeze({ claims: 'C', disputes: 'D', parameters: 'P', questions: 'Q' })


/**
 * 標準名之檢核
 *
 * @param {String} std 輸入標準 id
 * @returns {String} 回傳原值
 * @throws {Error} 不在 ES_CASE_STDS 時拋出
 */
function stdOf(std) {
    if (!ES_CASE_STDS.includes(std)) throw new Error(`不認得之逐案題組標準：${std}（可用：${ES_CASE_STDS.join('、')}）`)
    return std
}

/**
 * 該標準之每頁案數(ES8 恆 1;安裝方之逐案執行器用之公開 API——評分之角色以抓取套件之 benchPintOf 驗角色參數)
 *
 * @param {String} std 輸入標準 id
 * @param {Integer} [pageSize] 輸入每頁案數，未給為 ES_CASE_PAGE_SIZE
 * @returns {Integer} 回傳每頁案數
 * @throws {Error} 標準不認得,或 pageSize 給了而非正整數時拋出
 * @example
 * console.log([esPageSizeOf('ES9'), esPageSizeOf('ES8', 5), esPageSizeOf('ES11', 4)])
 * // => [ 10, 1, 4 ]
 */
export function esPageSizeOf(std, pageSize) {
    stdOf(std)
    if (pageSize !== undefined && pageSize !== null && !(Number.isInteger(pageSize) && pageSize > 0)) throw new Error(`每頁案數須為正整數，收到 ${JSON.stringify(pageSize)}`)
    if (std === ES8.std) return 1
    return pageSize || ES_CASE_PAGE_SIZE
}

/**
 * 頁內之出處標號(依首次出現序以出處 id 去重,同正式之 uniq(notes);內容取首次出現者——題組內同一 id 之內容須一致,esSuiteProblems 驗)
 *
 * @param {Array} srcs 輸入依出現序之出處 [{ id, title, text }]
 * @returns {Object} 回傳 { label:Map(出處 id → 標號), sources:Array({ label, title, text }), idOf:Map(標號 → 出處 id) }
 */
function labelSources(srcs) {
    const byId = new Map()
    for (const s of srcs) if (!byId.has(s.id)) byId.set(s.id, s)
    const label = new Map([...byId.keys()].map((id, k) => [id, `S${k + 1}`]))
    const sources = [...byId.values()].map((s) => ({ label: label.get(s.id), title: s.title, text: s.text }))
    return { label, sources, idOf: new Map([...label].map(([id, l]) => [l, id])) }
}

/**
 * 一頁之組法(頁組法六條件見檔頭;不呼叫 AI)
 *
 * @param {String} std 輸入標準 id(ES9、ES8、ES14、ES11)
 * @param {Array} cases 輸入同頁之案(各案 { input };ES8 須恰一案)
 * @param {Object} o 輸入 { domain(提煉 domain;取各標準之提示詞函數) }
 * @returns {Object} 回傳 { std, cases, indices:Array(各案之項編號,依頁內序), items:Array(提示詞之項), prompt, labelsOf:Map(項編號 → Set(該項所引之出處標號);ES9),
 *   labels:Set(本頁之出處標號;ES8), idOf:Map(出處標號 → 出處 id;ES9／ES8／ES14), sidesOf:Map(項編號 → 方數;ES14) }
 * @throws {Error} 標準不認得、無案、ES8 不只一案、或 domain 缺該標準之提示詞函數時拋出
 * @example
 * let d = createExtractDomain({})
 * let p = esPageOf('ES11', [{ input: { a: { concept: '甲' }, b: { concept: '乙' } } }], { domain: d })
 * console.log(p.indices, p.prompt.includes('【甲】概念：甲'))
 * // => [ 1 ] true
 */
export function esPageOf(std, cases, o = {}) {
    stdOf(std)
    const list = isarr(cases) ? cases : []
    if (!list.length) throw new Error(`${std} 之頁須至少一案`)
    const domain = isobj(o?.domain) ? o.domain : {}
    const need = { ES9: 'buildSupportCheckPrompt', ES8: 'buildOrphanCheckPrompt', ES14: 'buildDisputeCheckPrompt', ES11: 'buildSynonymCheckPrompt' }[std]
    if (typeof domain[need] !== 'function') throw new Error(`${std} 之 domain 須具 ${need}`)
    const page = { std, cases: list, indices: [], items: [], prompt: '', labelsOf: new Map(), labels: new Set(), idOf: new Map(), sidesOf: new Map() }
    const at = list.map((c, j) => ({ c, index: j + 1 }))
    page.indices = at.map((x) => x.index)
    if (std === ES9.std) {
        const { label, sources, idOf } = labelSources(at.flatMap(({ c }) => c.input.sources))
        // 證據性質(判準依推論類與否)——題組未給者＝未標(非推論類)
        page.items = at.map(({ c, index }) => ({ index, kind: c.input.kind, text: c.input.text, basis: c.input.basis || '', labels: c.input.sources.map((s) => label.get(s.id)) }))
        page.prompt = domain.buildSupportCheckPrompt({ concept: ES_CASE_CONCEPT, sources, items: page.items })
        page.labelsOf = new Map(at.map(({ c, index }) => [index, new Set(c.input.sources.map((s) => label.get(s.id)))]))
        page.idOf = idOf
        return page
    }
    if (std === ES8.std) {
        if (list.length !== 1) throw new Error(`${std} 一案一頁（候選只限本案），收到 ${list.length} 案`)
        const c = list[0]
        page.idOf = new Map(c.input.candidates.map((x, k) => [`S${k + 1}`, x.id]))
        page.labels = new Set(page.idOf.keys())
        page.items = [{ index: 1, text: c.input.claim, basis: c.input.basis || '' }]
        page.prompt = domain.buildOrphanCheckPrompt({ concept: ES_CASE_CONCEPT, sources: c.input.candidates.map((x, k) => ({ label: `S${k + 1}`, title: x.title, text: x.text })), items: page.items })
        return page
    }
    if (std === ES14.std) {
        const { label, sources, idOf } = labelSources(at.flatMap(({ c }) => c.input.sides.flatMap((sd) => sd.sources)))
        // 各方:預設只有立場文字(拆解時轉為主張);案可給 claims(所引主張)與 toClaim:false(拆解時不另立主張)
        page.items = at.map(({ c, index }) => ({ index, question: c.input.question, doubt: c.input.doubt, sides: c.input.sides.map((sd) => ({ position: sd.position, conditions: sd.conditions || [], basis: sd.basis || '', claims: sd.claims || [], labels: sd.sources.map((s) => label.get(s.id)), toClaim: sd.toClaim !== false })) }))
        page.prompt = domain.buildDisputeCheckPrompt({ concept: ES_CASE_CONCEPT, sources, items: page.items })
        page.idOf = idOf
        page.sidesOf = new Map(at.map(({ c, index }) => [index, c.input.sides.length]))
        return page
    }
    page.items = at.map(({ c, index }) => ({ index, a: c.input.a, b: c.input.b }))
    page.prompt = domain.buildSynonymCheckPrompt(page.items)
    return page
}

/**
 * 全部頁之組法:依題組之序每 esPageSizeOf 案一頁
 *
 * @param {String} std 輸入標準 id
 * @param {Array} cases 輸入題組之案
 * @param {Object} o 輸入 { domain, pageSize? }
 * @returns {Array} 回傳 esPageOf 之產物陣列
 * @throws {Error} 標準不認得、pageSize 不合,或任一頁組不出時拋出
 * @example
 * let d = createExtractDomain({})
 * let cs = Array.from({ length: 12 }, (_, i) => ({ input: { a: { concept: `甲${i}` }, b: { concept: `乙${i}` } } }))
 * console.log(esPagesOfCases('ES11', cs, { domain: d }).map((p) => p.indices.length))
 * // => [ 10, 2 ]
 */
export function esPagesOfCases(std, cases, o = {}) {
    const size = esPageSizeOf(std, o?.pageSize)
    const list = isarr(cases) ? cases : []
    const out = []
    for (let i = 0; i < list.length; i += size) out.push(esPageOf(std, list.slice(i, i + size), { domain: o?.domain }))
    return out
}

/**
 * 一席回覆之逐項票(正式之單票驗證;項編號限本頁)
 *
 * @param {Object} page 輸入 esPageOf 之產物
 * @param {*} data 輸入一席之回覆(各標準之 parseXxx 之產物,{ checks:[…] })
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)
 * @example
 * need test in nodejs.
 *
 * const votes = esVotesOf(page, { checks: [{ index: 1, verdict: 'supported', by: ['S1'], reason }] })
 */
export function esVotesOf(page, data) {
    const idx = new Set(page.indices)
    if (page.std === ES9.std) return seatSupportVotesOf(data, idx, page.labelsOf)
    if (page.std === ES8.std) return seatOrphanVotesOf(data, idx, page.labels)
    if (page.std === ES14.std) return seatDisputeVotesOf(data, page.sidesOf)
    return seatSynonymVotesOf(data, idx)
}

/**
 * 受支持之票所列之支持出處是否合應然(ES9／ES8 同一規則):票所列(標號換成 id)須非空且皆屬應然之 by;應然未列 by 者——required 為 true
 *   (ES8:應然必列)即不合、為 false(ES9:應然選列)即不比對
 *
 * @param {*} vote 輸入受支持之票({ by:Array(標號) })
 * @param {Object} [expect] 輸入應然 { by?:Array(出處 id) }
 * @param {Map} [idOf] 輸入標號 → 出處 id
 * @param {Object} [o={}] 輸入 { required:Boolean(應然須列 by) }
 * @returns {Boolean} 回傳是否相合
 * @example
 * let idOf = new Map([['S1', 'a'], ['S2', 'b']])
 * console.log([esByMatchOf({ by: ['S1'] }, { by: ['a'] }, idOf), esByMatchOf({ by: ['S1', 'S2'] }, { by: ['a'] }, idOf), esByMatchOf({ by: ['S1'] }, {}, idOf), esByMatchOf({ by: ['S1'] }, {}, idOf, { required: true })])
 * // => [ true, false, true, false ]
 */
export function esByMatchOf(vote, expect, idOf, o = {}) {
    if (!isarr(expect?.by)) return o?.required !== true
    const by = (isarr(vote?.by) ? vote.by : []).map((l) => (idOf instanceof Map ? idOf.get(l) : l))
    return by.length > 0 && by.every((x) => expect.by.includes(x))
}

/**
 * ES9 之類別(supportClassOf;應然列了支持之出處者,受支持之票所列須非空且皆屬應然——否則 ES_BY_MISMATCH)
 *
 * @param {*} vote 輸入票(checkSupportVerdictOf 之產物;by 為出處標號)、PANEL_UNSURE 或 null
 * @param {Object} [expect] 輸入應然 { verdict, by?:Array(出處 id) }
 * @param {Map} [idOf] 輸入出處標號 → 出處 id
 * @returns {String|null} 回傳類別('supported'｜'not'｜'unsure'｜ES_BY_MISMATCH)或 null(缺票)
 * @example
 * let idOf = new Map([['S1', 'a'], ['S2', 'b']])
 * console.log(esSupportClassOf({ verdict: 'supported', by: ['S2'] }, { verdict: 'supported', by: ['a'] }, idOf))
 * // => supported(出處不符)
 */
export function esSupportClassOf(vote, expect, idOf) {
    const cls = supportClassOf(vote)
    if (cls !== 'supported' || supportClassOf(expect) !== 'supported') return cls
    return esByMatchOf(vote, expect, idOf, { required: false }) ? cls : ES_BY_MISMATCH
}

/**
 * ES8 之類別(supported／none／unsure;應然為 supported 者,票所列之支持筆記須非空且皆屬應然——否則 ES_BY_MISMATCH)
 *
 * @param {*} vote 輸入票(checkOrphanVerdictOf 之產物;by 為筆記標號)、PANEL_UNSURE 或 null
 * @param {Object} [expect] 輸入應然 { verdict, by?:Array(候選 id) }
 * @param {Map} [idOf] 輸入筆記標號 → 候選 id
 * @returns {String|null} 回傳類別或 null(缺票)
 * @example
 * let idOf = new Map([['S1', 'c1'], ['S2', 'c2']])
 * console.log(esOrphanClassOf({ verdict: 'supported', by: ['S1', 'S2'] }, { verdict: 'supported', by: ['c2'] }, idOf))
 * // => supported(出處不符)
 */
export function esOrphanClassOf(vote, expect, idOf) {
    if (vote === PANEL_UNSURE) return PANEL_UNSURE
    if (!isobj(vote)) return null
    if (vote.verdict !== 'supported' || expect?.verdict !== 'supported') return vote.verdict
    return esByMatchOf(vote, expect, idOf, { required: true }) ? 'supported' : ES_BY_MISMATCH
}

/**
 * ES11 之類別
 *
 * @param {*} vote 輸入票、PANEL_UNSURE 或 null
 * @returns {String|null} 回傳 'same'｜'different'｜'unsure'｜null
 * @example
 * console.log(esSynonymClassOf({ verdict: 'same', reason: '指同一概念' }), esSynonymClassOf({ verdict: 'different', reason: '指不同概念' }))
 * // => same different
 */
export function esSynonymClassOf(vote) {
    if (vote === PANEL_UNSURE) return PANEL_UNSURE
    return isobj(vote) ? vote.verdict : null
}

/**
 * 應然之類別(與各標準之票之類別同一組)
 *
 * @param {String} std 輸入標準 id
 * @param {Object} expect 輸入應然 { verdict, by? }
 * @returns {String|null} 回傳類別;應然不合者回 null
 * @example
 * console.log([esExpectClassOf('ES9', { verdict: 'overclaim' }), esExpectClassOf('ES14', { verdict: 'same-study' }), esExpectClassOf('ES8', { verdict: 'none' })])
 * // => [ 'not', 'not', 'none' ]
 */
export function esExpectClassOf(std, expect) {
    stdOf(std)
    const v = str(expect?.verdict)
    if (!v) return null
    if (std === ES9.std) return supportClassOf(expect)
    if (std === ES14.std) return v === 'opposed' ? 'opposed' : (v === PANEL_UNSURE ? PANEL_UNSURE : 'not')
    return v
}

/**
 * 題組層之出處一致性:同一出處 id 於題組內(各案之出處、爭議各方之出處)之標題與內文須相同——頁內以出處 id 去重標號(同正式),內容不同即頁內只見
 *   其一(出處支持覆核、修訂、爭議覆核之題組同讀;角色之 suiteProblems)
 *
 * @param {Object} set 輸入題組 { cases }
 * @returns {Array} 回傳問題說明陣列
 * @example
 * let mk = (text) => ({ input: { sources: [{ id: 's1', title: 'T', text }] } })
 * console.log(esSuiteProblems({ cases: [mk('甲'), mk('甲')] }), esSuiteProblems({ cases: [mk('甲'), mk('乙')] }).length)
 * // => [] 1
 */
export function esSuiteProblems(set) {
    const seen = new Map()
    const bad = new Set()
    const take = (s) => {
        if (!isestr(s?.id)) return
        const key = JSON.stringify([s.title, s.text])
        if (seen.has(s.id) && seen.get(s.id) !== key) bad.add(s.id)
        else if (!seen.has(s.id)) seen.set(s.id, key)
    }
    for (const c of isarr(set?.cases) ? set.cases : []) {
        const inp = isobj(c?.input) ? c.input : {}
        for (const s of isarr(inp.sources) ? inp.sources : []) take(s)
        for (const sd of isarr(inp.sides) ? inp.sides : []) for (const s of isarr(sd?.sources) ? sd.sources : []) take(s)
    }
    return bad.size ? [`出處 id「${[...bad].join('、')}」於各案之標題或內文不同（頁內以出處 id 去重，同正式）`] : []
}

/**
 * 案 → 合成之核心狀態(見檔頭【案 → 合成之核心狀態】):精簡之描述補齊正式條目之全部欄位;未給 id 者依集合序配發(C1、D1、P1、Q1…)、編號計數接在
 *   最大號之後;消化之筆記預設為狀態中被引之全部出處;以正式之不變式自檢
 *
 * @param {Object} [spec={}] 輸入 { concept?(預設 ES_CASE_CONCEPT), version?(有條目時預設 1,否則 0),
 *   claims?:[{ id?, kind?(預設 o.claimKinds 之第一種), text, facet?, conditions?, pros?, cons?, period?, critique?, basis?, sources?, status?(預設 active), statusNote?(終態須給), retractReason? }],
 *   disputes?:[{ id?, question, sides:[{ position, conditions?, claims?, sources?, basis? }], status?(預設 open), note?, doubt?:{ reason, note } }],
 *   parameters?:[{ id?, name, value, conditions?, period?, snapshot?, claim?, sources?, status? }], questions?:[{ id?, text, sources?, status? }],
 *   essence?:{ text, claims?, sources?, stale?:{ from(已被取代／撤回之所引主張 id) } }, pendingReview?:[{ op, sources?, reason?, tries? }], consumed?:Array(筆記 id) }
 * @param {Object} [o={}] 輸入 { claimKinds(主張種類;預設 DEFAULT_CLAIM_KINDS) }
 * @returns {Object} 回傳 { state, problems:Array(描述之形狀不合與不變式之違反;空陣列＝合格) }
 * @example
 * let x = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] })
 * console.log(x.state.claims[0].id, x.state.nextId.C, x.state.consumed, x.problems)
 * // => C1 2 [ 'n1' ] []
 */
export function coreStateOf(spec = {}, o = {}) {
    const sp = isobj(spec) ? spec : {}
    const kinds = isarr(o?.claimKinds) && o.claimKinds.length ? o.claimKinds : DEFAULT_CLAIM_KINDS
    const problems = []
    const s = emptyState({ concept: str(sp.concept) || ES_CASE_CONCEPT })
    const lists = { claims: sp.claims, disputes: sp.disputes, parameters: sp.parameters, questions: sp.questions }
    for (const [k, v] of Object.entries(lists)) if (v !== undefined && !isarr(v)) problems.push(`${k} 須為陣列`)
    const any = Object.values(lists).some((v) => isarr(v) && v.length) || isobj(sp.essence)
    s.version = Number.isInteger(sp.version) && sp.version >= 0 ? sp.version : (any ? 1 : 0)
    const v = s.version
    const historyAt = (op) => [{ version: v, at: '', op }]
    const evidenceBlank = () => ({ level: '', basis: '', trace: '' })
    const idOf = (key, x, k) => str(x?.id) || `${ITEM_PREFIX[key]}${k + 1}`
    s.claims = (isarr(sp.claims) ? sp.claims : []).map((c, k) => ({
        id: idOf('claims', c, k), kind: str(c?.kind) || kinds[0], facet: str(c?.facet), text: str(c?.text), conditions: strs(c?.conditions), pros: strs(c?.pros), cons: strs(c?.cons),
        period: str(c?.period), critique: str(c?.critique), basis: str(c?.basis), sources: strs(c?.sources), origin: 'note', status: str(c?.status) || 'active', statusNote: str(c?.statusNote), validPeriod: '',
        supersededBy: '', mergedInto: '', retractReason: str(c?.retractReason), evidence: evidenceBlank(), addedIn: v, history: historyAt('add'),
    }))
    s.disputes = (isarr(sp.disputes) ? sp.disputes : []).map((d, k) => {
        const sides = (isarr(d?.sides) ? d.sides : []).map((sd) => ({ position: str(sd?.position), conditions: strs(sd?.conditions), claims: strs(sd?.claims), sources: strs(sd?.sources), ...(str(sd?.basis) ? { basis: str(sd.basis) } : {}) }))
        return {
            id: idOf('disputes', d, k), question: str(d?.question), sides, sources: uniq(sides.flatMap((x) => x.sources)), status: str(d?.status) || 'open', note: str(d?.note), origin: 'note', evidence: evidenceBlank(), addedIn: v, history: historyAt('dispute_add'),
            ...(isobj(d?.doubt) ? { doubt: { reason: str(d.doubt.reason), note: str(d.doubt.note), version: v, at: '', count: 1 } } : {}),
        }
    })
    s.parameters = (isarr(sp.parameters) ? sp.parameters : []).map((p, k) => ({
        id: idOf('parameters', p, k), name: str(p?.name), value: str(p?.value), conditions: strs(p?.conditions).join('；'), period: str(p?.period), snapshot: p?.snapshot === true, claim: str(p?.claim),
        sources: strs(p?.sources), origin: 'note', status: str(p?.status) || 'active', statusNote: '', validPeriod: '', supersededBy: '', retractReason: '', evidence: evidenceBlank(), addedIn: v, history: historyAt('param_add'),
    }))
    s.questions = (isarr(sp.questions) ? sp.questions : []).map((q, k) => ({ id: idOf('questions', q, k), text: str(q?.text), status: str(q?.status) || 'open', resolution: '', sources: strs(q?.sources), retractReason: '', addedIn: v, history: historyAt('question_add') }))
    // 本質之待重寫標記(所引主張已被取代／撤回而未重寫;同正式之持久 essence.stale)以 stale:{ from(該主張 id) } 給
    if (isobj(sp.essence)) s.essence = { text: str(sp.essence.text), claims: strs(sp.essence.claims), sources: strs(sp.essence.sources), at: '', stale: isobj(sp.essence.stale) ? { version: v, at: '', from: str(sp.essence.stale.from) } : null }
    // 待審項之形狀同正式之 queuePendingReview(op 之出處為筆記 id;sources 未給取 op 之出處)
    s.pendingReview = (isarr(sp.pendingReview) ? sp.pendingReview : []).map((e) => ({ op: isobj(e?.op) ? e.op : {}, sources: strs(e?.sources ?? e?.op?.sources), at: '', version: v, reason: str(e?.reason), tries: Number.isInteger(e?.tries) ? e.tries : 0, es9Tries: 0 }))
    const cited = uniq([
        ...s.claims.flatMap((c) => c.sources), ...s.disputes.flatMap((d) => d.sources), ...s.parameters.flatMap((p) => p.sources), ...s.questions.flatMap((q) => q.sources),
        ...s.pendingReview.flatMap((e) => e.sources),
    ])
    s.consumed = sp.consumed === undefined ? cited : strs(sp.consumed)
    // 編號計數(新項 id 由程式配發、永不重用——接在最大號之後)
    const nextNumOf = (key) => 1 + Math.max(0, ...s[key].map((x) => Number(String(x.id).slice(ITEM_PREFIX[key].length))).filter(Number.isFinite))
    s.nextId = { C: nextNumOf('claims'), D: nextNumOf('disputes'), P: nextNumOf('parameters'), Q: nextNumOf('questions') }
    const ids = Object.keys(ITEM_PREFIX).flatMap((key) => s[key].map((x) => x.id))
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
    if (dup.length) problems.push(`條目 id 重複：${uniq(dup).join('、')}`)
    problems.push(...checkInvariants(s, s).map((x) => `不變式：${x}`))
    return { state: s, problems }
}

/**
 * 題組之爭議 → 合成之核心狀態與正式之受檢項(dissolveUsableOf 與題組之檢核同讀):各方之出處為題組之出處;所引主張(claims)成為狀態中之主張,
 *   其出處＝該方之出處(拆解時不另立主張之方——正式之去處判定為 none;另立主張之方不得引主張,見回傳之 problems);狀態經 coreStateOf 建
 *
 * @param {Object} input 輸入題組之案之 input { question, doubt?, sides:[{ position, conditions?, basis?, claims?:[{ id, text, conditions? }], sources:[{ id, title, text }], toClaim? }] }
 * @param {Object} [o={}] 輸入 { claimKinds(主張種類;狀態中所引主張取其第一種,預設 domain 之預設) }
 * @returns {Object} 回傳 { state, item(disputeItemsOf 之受檢項), notesById:Map, contentOf:(id)=>String|null, problems:Array(題組之 toClaim 與正式之去處不符等) }
 * @example
 * const c = disputeCaseOf({ question: '丙', sides: [{ position: '一方', sources: [{ id: 'n1', title: '甲', text: '甲說' }] }, { position: '他方', sources: [{ id: 'n2', title: '乙', text: '乙說' }] }] })
 * console.log(c.problems, c.state.disputes.length)
 * // => [] 1
 */
export function disputeCaseOf(input, o = {}) {
    const sides = isarr(input?.sides) ? input.sides : []
    const srcs = new Map()
    const problems = []
    const claims = []
    const specSides = sides.map((sd, k) => {
        const ids = uniq((isarr(sd?.sources) ? sd.sources : []).map((x) => str(x?.id)).filter(Boolean))
        for (const x of isarr(sd?.sources) ? sd.sources : []) if (str(x?.id)) srcs.set(str(x.id), x)
        const toClaim = sd?.toClaim !== false
        const cids = (isarr(sd?.claims) ? sd.claims : []).map((c) => {
            const id = `C${claims.length + 1}`
            claims.push({ id, text: str(c?.text), conditions: strs(c?.conditions), sources: [...ids] })
            return id
        })
        if (toClaim && cids.length) problems.push(`side ${k} 引主張而 toClaim 非 false（拆解時另立主張之方不得引主張——正式之去處依所引主張與方層出處判定，題組無從表達）`)
        if (!toClaim && !cids.length) problems.push(`side ${k} 之 toClaim 為 false 而未引主張（正式之去處：無所引主張之方一律轉為主張）`)
        return { position: str(sd?.position), conditions: strs(sd?.conditions), claims: cids, sources: ids, basis: str(sd?.basis) }
    })
    const doubt = { reason: str(input?.doubt?.reason), note: str(input?.doubt?.note) }
    const { state: s } = coreStateOf({ claims, disputes: [{ id: DISPUTE_ID, question: str(input?.question), sides: specSides, doubt }], consumed: [...srcs.keys()] }, { claimKinds: o?.claimKinds })
    const item = disputeItemsOf(s, [DISPUTE_ID])[0]
    // 正式之去處(dissolveSidesOf)須與題組之 toClaim 相符——否則題組所示之「拆解時轉為主張」與正式之拆解不同
    if (!problems.length) {
        item.sides.forEach((sd, k) => {
            const want = sides[k]?.toClaim !== false
            if (sd.toClaim !== want) problems.push(`side ${k} 之 toClaim（${want}）與正式之拆解去處不符`)
        })
    }
    const notesById = new Map([...srcs].map(([id, x]) => [id, { id, title: str(x?.title) }]))
    const contentOf = (id) => (srcs.has(id) ? `${str(srcs.get(id).title)}\n${String(srcs.get(id).text ?? '')}` : null)
    return { state: s, item, notesById, contentOf, problems }
}

/**
 * 非對立之票之拆解欄位是否可用(與正式爭議覆核之拆解同一路徑,見檔頭【拆解可用】)
 *
 * @param {*} vote 輸入非對立之票(checkDisputeVerdictOf 之產物;含 kinds、annotations)
 * @param {Object} input 輸入題組之案之 input(見 disputeCaseOf)
 * @param {Object} domain 輸入提煉 domain(claimKinds、limits、evidence、weakEvidence)
 * @param {Object} [o={}] 輸入 { locale?(語言設定;操作守門之正體轉換依之,未給＝臺灣正體——同正式之每輪依賴 deps.locale) }
 * @returns {Object} 回傳 { ok:Boolean, why:Array(不可用之原因), op:Object|null(過閘之拆解操作) }
 * @example
 * let d = createExtractDomain({})
 * let input = { question: '甲', sides: [{ position: '甲方', sources: [{ id: 'a', title: 'A', text: '甲方之內容' }] }, { position: '乙方', sources: [{ id: 'b', title: 'B', text: '乙方之內容' }] }] }
 * console.log(dissolveUsableOf({ verdict: 'not-opposed', reason: '兩方回答不同之問題', kinds: [null, null], annotations: [null, null] }, input, d).ok)
 * // => false
 */
export function dissolveUsableOf(vote, input, domain, o = {}) {
    const d = isobj(domain) ? domain : {}
    const x = disputeCaseOf(input, { claimKinds: d.claimKinds })
    if (x.problems.length) return { ok: false, why: x.problems, op: null }
    const op0 = dissolveOpOf(x.item, vote, d.claimKinds)
    if (!op0) return { ok: false, why: ['無拆解欄位、長度不符方數，或轉為主張之方之種類不在清單／標注非物件'], op: null }
    const applyCtx = applyCtxOf(d, { batch: [], mode: 'delta', onlyOps: ['dispute_dissolve'], at: '', self: ES_CASE_CONCEPT })
    const std = createOpStandards(opStandardsCtxOf({ state: x.state, batch: [], contentOf: x.contentOf, notesById: x.notesById, applyCtx, domain: d }))
    const sc = gateOps([op0], { guard: guardOps, state: x.state, std, locale: o?.locale })
    if (!sc.ops.length) return { ok: false, why: sc.rejected.flatMap((r) => r.why), op: null }
    const ap = applyDelta(x.state, { ops: sc.ops }, applyCtx)
    if (ap.rejected.length) return { ok: false, why: ap.rejected.map((r) => `拆解拒收：${r.reason}`), op: null }
    if (typeof d.evidence?.apply === 'function') d.evidence.apply(ap.state, x.notesById)
    const inv = checkInvariants(x.state, ap.state, { touched: ap.touched })
    if (inv.length) return { ok: false, why: inv.map((v) => `不變式：${v}`), op: null }
    return { ok: true, why: [], op: sc.ops[0] }
}

/**
 * 修訂案之覆核說明:案之結構化投票(兩席判語氣超出證據之票 [{ verdict, reason }])經正式之 notSupportedReasonsOf(同正式修訂提示詞之項之 reasons)
 *
 * @param {Array} votes 輸入票陣列 [{ verdict(SUPPORT_VERDICTS 之非 supported 者), reason }]
 * @returns {Array} 回傳 [String]
 * @example
 * console.log(reviseReasonsOf([{ verdict: 'overclaim', reason: '出處只涵蓋單一學校' }]))
 * // => [ '語氣超出證據：出處只涵蓋單一學校' ]
 */
export function reviseReasonsOf(votes) {
    return notSupportedReasonsOf({ votes: (isarr(votes) ? votes : []).map((v) => ({ verdict: v })) })
}

/**
 * 修訂案之投票之形狀與可修訂性(正式之 revisableOf:成立不受支持、原因含 overclaim、無 contradicted)
 *
 * @param {*} votes 輸入案之 input.votes
 * @returns {Array} 回傳問題說明陣列
 * @example
 * console.log(reviseVotesProblems([{ verdict: 'overclaim', reason: '原文只說有相關' }]), reviseVotesProblems('x'))
 * // => [] [ 'input.votes 須為非空之票陣列 [{ verdict, reason }]（判定小組成立語氣超出證據之各票）' ]
 */
export function reviseVotesProblems(votes) {
    if (!isarr(votes) || !votes.length) return ['input.votes 須為非空之票陣列 [{ verdict, reason }]（判定小組成立語氣超出證據之各票）']
    const p = []
    votes.forEach((v, k) => {
        if (!isobj(v) || !SUPPORT_VERDICTS.includes(v.verdict) || v.verdict === 'supported' || v.verdict === PANEL_UNSURE) p.push(`input.votes[${k}].verdict 須為不受支持之裁決（${SUPPORT_VERDICTS.filter((x) => x !== 'supported' && x !== PANEL_UNSURE).join('／')}）`)
        else if (!isestr(v.reason) || !v.reason.trim()) p.push(`input.votes[${k}].reason 須為非空字串`)
    })
    if (!p.length && !revisableOf({ status: 'decided', verdict: votes[0], votes: votes.map((v) => ({ verdict: v })) })) p.push('input.votes 不可修訂（正式之修訂只收原因含 overclaim 且無 contradicted 者）')
    return p
}

/**
 * 修訂案(見檔頭【修訂案】):原操作、受檢項、修訂項之欄與閘
 *
 * @param {Object} input 輸入案之 input { kind:'add'|'side', text, conditions?, period?(add), basis?, annotation?:{ kind, critique, pros?, cons? }(add),
 *   question?(side), sources:[{ id, title, text }] }
 * @param {Object} domain 輸入提煉 domain(claimKinds、limits、evidence、weakEvidence)
 * @param {Object} [o={}] 輸入 { locale?(語言設定;同 dissolveUsableOf) }
 * @returns {Object} 回傳 { op(原操作), it(受檢項 { kind, key, op, notes }), fields(fieldsOf 之產物;修訂提示詞之項), gate(op) => { ok, op(過閘之操作), why } }
 * @example
 * let d = createExtractDomain({})
 * let x = reviseCaseOf({ kind: 'side', text: '甲方', sources: [{ id: 'a', title: 'A', text: '甲方之內容' }] }, d)
 * console.log(x.fields, x.gate(x.op).ok)
 * // => { text: '甲方', conditions: [], period: '' } true
 */
export function reviseCaseOf(input, domain, o = {}) {
    const d = isobj(domain) ? domain : {}
    const srcs = new Map((isarr(input?.sources) ? input.sources : []).filter((s) => isestr(s?.id)).map((s) => [s.id, s]))
    const ids = [...srcs.keys()]
    const { state } = coreStateOf({})
    const batch = ids.map((id, k) => ({ code: `N${k + 1}`, id }))
    const basis = str(input?.basis)
    let op
    let it
    if (input?.kind === 'side') {
        op = { op: 'dispute_add', question: str(input?.question), sides: [{ position: str(input?.text), conditions: strs(input?.conditions), ...(basis ? { basis } : {}), sources: ids }] }
        it = { kind: 'side', key: '0:side0', op, notes: ids }
    }
    else {
        const ann = isobj(input?.annotation) ? input.annotation : {}
        op = { op: 'add', kind: str(ann.kind), text: str(input?.text), conditions: strs(input?.conditions), ...(str(input?.period) ? { period: str(input.period) } : {}), ...(basis ? { basis } : {}), critique: str(ann.critique), pros: strs(ann.pros), cons: strs(ann.cons), sources: ids }
        it = { kind: 'add', key: '0', op, notes: ids }
    }
    const applyCtx = applyCtxOf(d, { batch, mode: 'delta', at: '', self: ES_CASE_CONCEPT })
    const notesById = new Map(ids.map((id) => [id, { id, title: str(srcs.get(id).title) }]))
    const contentOf = (id) => (srcs.has(id) ? `${str(srcs.get(id).title)}\n${String(srcs.get(id).text ?? '')}` : null)
    const std = createOpStandards(opStandardsCtxOf({ state, batch, contentOf, notesById, applyCtx, domain: d }))
    const gate = (x) => {
        const sc = gateOps([x], { guard: guardOps, state, std, locale: o?.locale })
        if (!sc.ops.length) return { ok: false, op: null, why: sc.rejected.flatMap((r) => r.why) }
        if (sc.ops[0].op === 'add') {
            const ap = applyDelta(state, { ops: sc.ops }, applyCtx)
            if (ap.rejected.length) return { ok: false, op: null, why: ap.rejected.map((r) => `套用拒收：${r.reason}`) }
        }
        return { ok: true, op: sc.ops[0], why: [] }
    }
    return { op, it, fields: fieldsOf(it), gate }
}

/**
 * ES14 之類別(對立與否;非對立之票之拆解欄位不可用者為 ES_NOT_NOFIELDS)
 *
 * @param {*} vote 輸入票、PANEL_UNSURE 或 null
 * @param {Object} input 輸入題組之案之 input
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} [o={}] 輸入 { locale?(同 dissolveUsableOf) }
 * @returns {Object} 回傳 { cls:String|null('opposed'｜'not'｜ES_NOT_NOFIELDS｜'unsure'｜null), why:Array(拆解不可用之原因) }
 * @example
 * const input = { question: '丙', sides: [{ position: '一方', sources: [{ id: 'n1', title: '甲', text: '甲說' }] }, { position: '他方', sources: [{ id: 'n2', title: '乙', text: '乙說' }] }] }
 * console.log(esDisputeClassOf({ verdict: 'opposed', reason: '兩方對同一問題給出相反結論' }, input, createExtractDomain({})))
 * // => { cls: 'opposed', why: [] }
 */
export function esDisputeClassOf(vote, input, domain, o = {}) {
    if (vote === PANEL_UNSURE) return { cls: PANEL_UNSURE, why: [] }
    if (!isobj(vote)) return { cls: null, why: [] }
    if (vote.verdict === 'opposed') return { cls: 'opposed', why: [] }
    const u = dissolveUsableOf(vote, input, domain, o)
    return { cls: u.ok ? 'not' : ES_NOT_NOFIELDS, why: u.why }
}

/**
 * 題組之案之最小形狀(頁組法所讀之欄位;各標準之應然另驗)
 *
 * @param {String} std 輸入標準 id
 * @param {Object} c 輸入案
 * @returns {Array} 回傳問題說明陣列
 * @example
 * console.log(esCaseInputProblems('ES11', { input: { a: { concept: '黑洞' }, b: { concept: '黑洞物理' } }, expect: { verdict: 'same' } }), esCaseInputProblems('ES11', {}))
 * // => [] [ '缺 input' ]
 */
export function esCaseInputProblems(std, c) {
    stdOf(std)
    const inp = isobj(c?.input) ? c.input : null
    if (!inp) return ['缺 input']
    const p = []
    const srcProblems = (list, where, key = '出處') => {
        if (!isarr(list)) return [`${where} 須為陣列（${key}）`]
        const out = []
        list.forEach((s, k) => {
            if (!isobj(s) || !isestr(s.id) || typeof s.title !== 'string' || typeof s.text !== 'string') out.push(`${where}[${k}] 須為 { id, title, text }（id 非空字串）`)
        })
        return out
    }
    if (std === ES9.std) {
        if (!isestr(inp.kind)) p.push(`input.kind 須為非空字串（斷言種類：${SUPPORT_KINDS.join('、')}）`)
        if (!isestr(inp.text)) p.push('input.text 須為非空字串（斷言）')
        if (inp.basis !== undefined && typeof inp.basis !== 'string') p.push('input.basis 須為字串')
        p.push(...srcProblems(inp.sources, 'input.sources'))
        if (isarr(inp.sources) && !inp.sources.length) p.push('input.sources 須至少一筆（受檢之斷言皆有所引出處）')
    }
    else if (std === ES8.std) {
        if (!isestr(inp.claim)) p.push('input.claim 須為非空字串（失撐之主張）')
        if (inp.basis !== undefined && typeof inp.basis !== 'string') p.push('input.basis 須為字串')
        p.push(...srcProblems(inp.candidates, 'input.candidates', '候選筆記'))
        if (isarr(inp.candidates) && !inp.candidates.length) p.push('input.candidates 須至少一筆')
        const ids = (isarr(inp.candidates) ? inp.candidates : []).map((x) => x?.id)
        if (new Set(ids).size !== ids.length) p.push('input.candidates 之 id 重複')
    }
    else if (std === ES14.std) {
        if (!isestr(inp.question)) p.push('input.question 須為非空字串')
        if (inp.doubt !== undefined && !isobj(inp.doubt)) p.push('input.doubt 須為物件 { reason, note }')
        if (!isarr(inp.sides) || inp.sides.length < 2) p.push('input.sides 須為至少兩方之陣列')
        else {
            inp.sides.forEach((sd, k) => {
                const at = `input.sides[${k}]`
                if (!isobj(sd) || !isestr(sd.position)) return p.push(`${at}.position 須為非空字串`)
                if (sd.conditions !== undefined && !(isarr(sd.conditions) && sd.conditions.every((x) => typeof x === 'string'))) p.push(`${at}.conditions 須為字串陣列`)
                if (sd.basis !== undefined && typeof sd.basis !== 'string') p.push(`${at}.basis 須為字串`)
                if (sd.toClaim !== undefined && typeof sd.toClaim !== 'boolean') p.push(`${at}.toClaim 須為布林`)
                if (sd.claims !== undefined && !(isarr(sd.claims) && sd.claims.every((x) => isobj(x) && isestr(x.id) && isestr(x.text)))) p.push(`${at}.claims 須為 [{ id, text, conditions? }]`)
                p.push(...srcProblems(sd.sources, `${at}.sources`))
            })
            if (!p.length) p.push(...disputeCaseOf(inp).problems)
        }
    }
    else {
        for (const k of ['a', 'b']) {
            const x = inp[k]
            if (!isobj(x) || !isestr(x.concept)) {
                p.push(`input.${k}.concept 須為非空字串`)
                continue
            }
            if (x.essence !== undefined && typeof x.essence !== 'string') p.push(`input.${k}.essence 須為字串`)
            for (const f of ['claims', 'notes']) if (x[f] !== undefined && !(isarr(x[f]) && x[f].every((y) => typeof y === 'string'))) p.push(`input.${k}.${f} 須為字串陣列`)
        }
    }
    return p
}

export default {
    ES_CASE_STDS, ES_CASE_PAGE_SIZE, ES_CASE_CONCEPT, ES_BY_MISMATCH, ES_NOT_NOFIELDS, REVISE_CASE_KINDS,
    supportClassOf, esPageSizeOf, esPageOf, esPagesOfCases, esVotesOf, esByMatchOf, esSupportClassOf, esOrphanClassOf, esSynonymClassOf, esExpectClassOf, esSuiteProblems,
    coreStateOf, disputeCaseOf, dissolveUsableOf, reviseReasonsOf, reviseVotesProblems, reviseCaseOf, esDisputeClassOf, esCaseInputProblems,
}
