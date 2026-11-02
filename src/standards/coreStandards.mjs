// coreStandards.mjs — 提煉之檢定標準(核心狀態之條目):純函數,輸入＝核心狀態＋出處筆記之內容,新進守門與符合度掃描共用
//
// 【標準】(各標準之版本 v 改變即令既有之判定作廢重檢)
//   ES1 不變式(coreState.checkInvariants 對落地狀態);v2 另含外洩(流程用語,與新進 opStandards 同一
//       LEAK_PHRASES)與長度硬上限(文字欄逾上限 2 倍、本質逾上限,與 applyDelta 同一判準)——逐條目一筆
//   ES5 已見之衝突有去向(v1):seenConflicts 中兩端皆為已消化存活筆記之衝突邊,須有處置結構
//       (conflictDisposition:爭議兩方／取代／加條件修正(存量不限版)／離題)或已交 RS4 核對(待判登錄);ctx 未給邊端 → 不檢
//   ES2 數字紮根於本條所引出處:主張、參數、爭議方、待解問題之數字事實須見於「本條存活出處筆記之內容章＋原文標題」
//       (爭議方另含所引主張之出處;參數另含所依主張之出處);不含投影章(關聯、⚠)——投影章由邊庫產生,不是該筆記之內容。
//       出處內容不可得而有未紮根者 → 未能判定
//   ES3 正體:全部文字欄之簡體專用字與同形字誤用數＝0;只適用於臺灣正體之字形政策(appliesTo;ctx.locale 非繁體中文 → 不適用,抓取套件之 core/locale)
//   ES4 標注明示(分類、標注、銳評、利弊、時間相依):有效主張之銳評必填;principle／rule 之利與弊各須
//       有內容(出處沒有時寫明「出處未載」——明示,不捏造);temporal 須有期間;pitfall 須有條件
//   ES6 有效主張即須有本質,且本質非待重寫(v2:所引主張被取代／撤回或其出處已撤;與提煉段本質專步同一判定 essenceNeedOf)
//   ES8 失撐條目(出處全撤):隔離於有效集合之外、待專責處置 → 列為未能判定(不是合格)
//   ES9 出處支持(AI 標準;存量覆核判不了 → 隔離 held):狀態上之隔離者列未能判定
//   ES12 principle 為跨篇歸納:存活出處之相異文件 ≥2(同一文件之多筆記只算一份)
//   ES13 弱證據參數(證據等級為最低級或未評估)之 conditions 須註明限制(與新進 opStandards 同一判準;ctx 未給 evidence → 不檢)
//   ES15 逾限筆記(未涵蓋達上限而出隊)須有待判登錄(未結、已結或已豁免;提煉段落盤後登錄,提示詞或席位變更後重送)
//   ES16 本質之數字紮根於所引主張之出處
//   ES17 主張文字不提及筆記:不得殘留批內代號(N12)或筆記連結([[…]])——納入閘為唯一執行處(noteMentionsOf 供新進守門);符合度掃描不產 ES17 列
//       (存量之文字無本批之語境,形如代號者判不了)

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { STATUS, result, textValueOf as str, textListOf as strs } from '../core/capturePackage.mjs'
import { withoutForeignSpans, scriptOf, scriptApplies, SCRIPT_NA_DETAIL } from '../core/capturePackage.mjs'
import { ungroundedNumbers, outputNumbers } from '../core/summarizePackage.mjs'
import { ITEM_TEXT_FIELDS, SIDE_TEXT_FIELDS, lengthCapOf, TERMINAL_SET, checkInvariants, withdrawnOf, unsupportedOf, essenceNeedOf, citedNotesOf, EXHAUSTED_REASON, DEFAULT_LIMITS } from '../stores/coreState.mjs'
import { es5RowsOf } from './conflictDisposition.mjs'
import { ES9 as ES9_DEF } from './supportCheck.mjs'
import { ES8 as ES8_DEF } from './orphanCheck.mjs'
import { RS4 } from '../core/relatePackage.mjs'
import { ES15 } from '../stores/extractHolds.mjs'

/**
 * 逾限筆記之待判登錄物件種類(ES15;oid＝`<核心 id>:<筆記 id>`):筆記層待判之物件名只一份＝stores/extractHolds 之 EXTRACT_HOLD_OBJECTS.note
 *   (ES15.object 為其別名);本名為對外之既有別名(宿主之測試取用),套件內一律取 ES15.object
 */
export const ES15_OBJECT = ES15.object

/** 標注之「出處未載」明示(ES4 丙:出處沒有該項內容時明寫,不捏造亦不留白;提示詞與修法同一字樣) */
export const ANNOTATION_UNSTATED = '出處未載'

/** 核心檢定標準表(ES1～ES17):{ id, title, kind(program＝確定性程式判定／ai＝AI 判定／rule＝規則型), v(標準版本), appliesTo? }，由 checkCore 與符合度掃描共用 */
export const CORE_STANDARDS = [
    { id: 'ES1', title: '不變式、外洩、長度硬上限', kind: 'program', v: 2 },
    { id: 'ES2', title: '數字紮根於本條所引出處', kind: 'program', v: 1 },
    { id: 'ES3', title: '正體', kind: 'program', v: 2, appliesTo: ['zh-Hant-TW'] },
    { id: 'ES4', title: '標注明示(銳評、利弊、期間、條件)', kind: 'program', v: 1 },
    { id: 'ES5', title: '已見之衝突有去向(兩端皆可引者)', kind: 'program', v: 1 },
    { id: 'ES6', title: '有效主張即須有本質,且本質非待重寫', kind: 'program', v: 2 },
    // ES8／ES9 之版本取自判定模組(同一標準只一個版號;v2:判準依證據性質)
    { id: 'ES8', title: '失撐條目待處置', kind: 'program', v: ES8_DEF.v },
    // ES9 為 AI 標準(判定小組;存量專步與新進覆核記檢核紀錄):狀態上只看得到「隔離待判」者 → 列未能判定;其餘之判定結果在檢核紀錄
    { id: 'ES9', title: '出處支持(隔離待判者)', kind: 'ai', v: ES9_DEF.v },
    { id: 'ES12', title: 'principle 跨篇(相異文件 ≥2)', kind: 'program', v: 1 },
    { id: 'ES13', title: '弱證據參數須註明限制', kind: 'program', v: 1 },
    { id: ES15.std, title: '逾限筆記有待判登錄', kind: 'program', v: 1 },
    { id: 'ES16', title: '本質之數字紮根', kind: 'program', v: 1 },
    // ES17(主張文字不提及筆記)不在此表:納入閘為唯一執行處(noteMentionsOf 供新進守門),定義於 standards/registry
]


// ── 規則函數(存量掃描 checkCore、新進守門 standards/opStandards 與 standards/opGuards、存量處置 standards/coreStockFix 共用之單一判定)──

/** 流程外洩字樣(ES1:定稿不得出現編修經過;「已修正／已更正」會誤中正常敘述,不收)——新進守門與掃描同讀(standards/opGuards 以原名轉出) */
export const LEAK_PHRASES = ['依審計', '審計意見', '依意見', '原稿', '本批筆記', '候選稿', '整合稿', '修訂稿', '編修']

/**
 * 文字之流程外洩(ES1;新進之納入閘與存量掃描同一判定):第一個出現之 LEAK_PHRASES
 *
 * @param {String} text 輸入文字
 * @returns {String} 回傳命中之片語(無回 '')
 * @example
 * console.log(leakProblem('依審計意見修正'), JSON.stringify(leakProblem('動量有效')))
 * // => 依審計 ""
 */
export function leakProblem(text) {
    return LEAK_PHRASES.find((p) => text.includes(p)) || ''
}

/**
 * 文字之字形問題數(ES3;新進守門、存量掃描與存量處置同一判式):去掉非本篇文字之片段(`[[連結]]` 與網址;抓取套件之 withoutForeignSpans)後,
 *   依字形政策(抓取套件之 scriptOf 之產物)之問題數
 *
 * @param {Object} script 輸入字形政策(scriptOf 之產物)
 * @param {String} text 輸入文字
 * @returns {Integer} 回傳問題數(0＝合格)
 * @example
 * console.log(scriptBadOf(scriptOf('zh-TW'), '軟件開發'), scriptBadOf(scriptOf('zh-TW'), '软件开发'))
 * // => 0 3
 */
export function scriptBadOf(script, text) {
    return script.problems(withoutForeignSpans(text)).count
}

/**
 * 弱證據參數須註明限制(ES13;新進之納入閘〔試套之結果〕與存量掃描同一判準):證據等級為最低級、未評估或不在清單者,conditions 須含限制語
 *   (證據演算法之 selfLimitOf 判得為限制語,或含詞彙之弱證據說法 weakEvidence)
 *
 * @param {Object} p 輸入參數(取 evidence.level、conditions)
 * @param {Object} [ctx={}] 輸入 { evidence?:{ levels, selfLimitOf }, weakEvidence? }(未給 levels → 不適用)
 * @returns {Object} 回傳 { applies:Boolean(本參數受檢), ok:Boolean(合格;不受檢者為 true), level:String(證據等級;未評估為 '') }
 * @example
 * const ctx = { evidence: { levels: ['強', '中', '弱'], selfLimitOf: (x) => x.conditions.some((t) => /僅|限/.test(t)) } }
 * console.log(weakEvidenceProblem({ evidence: { level: '弱' }, conditions: [] }, ctx), weakEvidenceProblem({ evidence: { level: '弱' }, conditions: ['僅限單一觀測'] }, ctx), weakEvidenceProblem({ evidence: { level: '強' }, conditions: [] }, ctx))
 * // => { applies: true, ok: false, level: '弱' } { applies: true, ok: true, level: '弱' } { applies: false, ok: true, level: '強' }
 */
export function weakEvidenceProblem(p, ctx = {}) {
    const levels = isarr(ctx?.evidence?.levels) ? ctx.evidence.levels : []
    const level = str(p?.evidence?.level)
    if (!levels.length || (level && level !== levels[levels.length - 1] && levels.includes(level))) return { applies: false, ok: true, level }
    const conds = { conditions: strs(p?.conditions) }
    const ok = !!((isfun(ctx.evidence?.selfLimitOf) && ctx.evidence.selfLimitOf(conds)) || (str(ctx.weakEvidence) && conds.conditions.some((t) => t.includes(str(ctx.weakEvidence)))))
    return { applies: true, ok, level }
}

/**
 * 正體之受檢範圍(ES3;存量掃描與存量處置同一份):主張、參數、待解問題之非終態且非已結案者;爭議除撤回外皆檢(已解決之爭議仍檢)——依集合序
 *   (claims、parameters、questions、disputes)、集合內原序
 *
 * @param {Object} state 輸入核心狀態
 * @returns {Array} 回傳 [{ key, item }]
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { text: '乙', sources: ['n2'], status: 'retracted', retractReason: '重複' }], questions: [{ text: '丙', sources: ['n3'] }] }).state
 * console.log(itemsInScopeOf(s).map((x) => `${x.key}:${x.item.id}`))
 * // => [ 'claims:C1', 'questions:Q1' ]
 */
export function itemsInScopeOf(state) {
    const out = []
    for (const key of Object.keys(ITEM_TEXT_FIELDS)) {
        for (const x of isarr(state?.[key]) ? state[key] : []) {
            if (!x || (key === 'disputes' ? x.status === 'retracted' : (TERMINAL_SET.has(x.status) || x.status === 'resolved'))) continue
            out.push({ key, item: x })
        }
    }
    return out
}

// ── 規則函數(存量掃描 checkCore 與新進守門 extract/standards/opStandards 共用之單一判定)──

/**
 * 主張之標注問題(ES4):有效主張之銳評必填;principle／rule 之利與弊各須有內容(出處沒有時寫「出處未載」);temporal 須有期間;
 * pitfall 須有條件
 *
 * @param {Object} c 輸入主張(取 kind、critique、pros、cons、period、conditions)
 * @returns {Array} 回傳問題說明陣列(無問題回 [])
 * @example
 * console.log(annotationProblems({ kind: 'rule', critique: '', pros: [], cons: ['出處未載'] }), annotationProblems({ kind: 'rule', critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }))
 * // => [ '缺銳評', '缺利(或「出處未載」)' ] []
 */
export function annotationProblems(c) {
    const p = []
    if (!str(c?.critique)) p.push('缺銳評')
    if (['principle', 'rule'].includes(c?.kind)) {
        if (!strs(c?.pros).length) p.push('缺利(或「出處未載」)')
        if (!strs(c?.cons).length) p.push('缺弊(或「出處未載」)')
    }
    if (c?.kind === 'temporal' && !str(c?.period)) p.push('時效主張缺期間')
    if (c?.kind === 'pitfall' && !strs(c?.conditions).length) p.push('陷阱主張缺條件')
    return p
}

/**
 * principle 跨篇之問題(ES12):存活出處之相異文件 ≥2(同一文件之多筆記只算一份)
 *
 * @param {Array} sourceIds 輸入存活出處筆記 id
 * @param {Function} [docIdOf] 輸入 (noteId)=>文件 id(未給或回空則以筆記 id 當文件)
 * @returns {String} 回傳問題說明(無問題回 '')
 * @example
 * console.log([principleDocsProblem(['n1', 'n2'], () => 'doc-a'), principleDocsProblem(['n1', 'n2'], (id) => `doc-${id}`)])
 * // => [ 'principle 之存活出處只來自 1 份文件', '' ]
 */
export function principleDocsProblem(sourceIds, docIdOf) {
    const of = isfun(docIdOf) ? docIdOf : (id) => id
    const docs = new Set(strs(sourceIds).map((nid) => of(nid) || nid))
    return docs.size >= 2 ? '' : `principle 之存活出處只來自 ${docs.size} 份文件`
}

/** 筆記連結 [[…]] */
export const NOTE_LINK_RE = /\[\[[^\]]+\]\]/
/** 批內筆記代號(N12;前後不得緊接英數) */
export const NOTE_CODE_RE = /(?<![A-Za-z0-9])N\d+(?![0-9])/g

/**
 * 文字中提及筆記之處(ES17):筆記連結 [[…]] 與批內代號(codes 給定時只認本批代號——如型號「N95」不是代號)
 *
 * @param {String} text 輸入文字
 * @param {Set} [codes] 輸入本批代號集合(大寫);未給則任何 N 數字皆算
 * @returns {Array} 回傳提及之字樣陣列(無回 [])
 * @example
 * console.log(noteMentionsOf('見 [[黑洞吸積盤]] 與 N2，型號 N95 不算', new Set(['N1', 'N2'])))
 * // => [ '[[黑洞吸積盤]]', 'N2' ]
 */
export function noteMentionsOf(text, codes) {
    const t = String(text ?? '')
    const out = (t.match(new RegExp(NOTE_LINK_RE.source, 'g')) || []).slice()
    for (const m of t.matchAll(NOTE_CODE_RE)) if (!(codes instanceof Set) || codes.has(m[0].toUpperCase())) out.push(m[0])
    return out
}

/**
 * 數字紮根之判定(ES2、ES16):文字之數字事實須見於材料;材料有不可得者(null)而有未紮根之數字 → 未能判定
 *
 * @param {String} text 輸入受檢文字
 * @param {Array} materials 輸入材料陣列(元素為字串;null＝該出處內容不可得)
 * @returns {Object} 回傳 { status:STATUS 之一, ung:Array(未紮根之數字), missing:Integer(不可得之材料數) }
 * @example
 * console.log(groundingOf('溫度達 300 萬度', ['盤內緣溫度可達 300 萬度']), groundingOf('溫度達 500 萬度', ['盤內緣溫度可達 300 萬度']), groundingOf('溫度達 500 萬度', [null]))
 * // => { status: 'pass', ung: [], missing: 0 } { status: 'violation', ung: [ '500 萬' ], missing: 0 } { status: 'undetermined', ung: [ '500 萬' ], missing: 1 }
 */
export function groundingOf(text, materials) {
    // 批內代號(N12)屬本套件之識別碼:交數字共用件以 stripPatterns 去除(摘要之共用件不認得他工作之代號)
    const strip = { stripPatterns: [NOTE_CODE_RE] }
    if (!outputNumbers(text, strip).length) return { status: STATUS.PASS, ung: [], missing: 0 }
    const mats = isarr(materials) ? materials : []
    const avail = mats.filter((m) => typeof m === 'string')
    const ung = ungroundedNumbers(text, avail, strip)
    if (!ung.length) return { status: STATUS.PASS, ung, missing: mats.length - avail.length }
    return { status: avail.length < mats.length ? STATUS.UNDETERMINED : STATUS.VIOLATION, ung, missing: mats.length - avail.length }
}

/**
 * 條目之全部文字(檢定用;代號〔C12〕等由數字共用件自行去除)
 *
 * @param {String} key 輸入集合鍵(claims／parameters／questions／disputes)
 * @param {Object} x 輸入條目
 * @returns {Array} 回傳 [{ field, text }]
 * @example
 * console.log(itemTexts('claims', { text: '甲', conditions: ['乙'], critique: '丙', pros: ['丁'], cons: [] }))
 * // => [
 * //   { field: 'text', text: '甲' },
 * //   { field: 'conditions', text: '乙' },
 * //   { field: 'pros', text: '丁' },
 * //   { field: 'critique', text: '丙' }
 * // ]
 */
export function itemTexts(key, x) {
    const out = []
    const push = (field, v) => {
        for (const t of strs(v)) out.push({ field, text: t })
    }
    for (const f of ITEM_TEXT_FIELDS[key] || []) push(f, x?.[f])
    if (key === 'disputes') {
        for (const [k, sd] of (isarr(x?.sides) ? x.sides : []).entries()) for (const f of SIDE_TEXT_FIELDS) push(`sides[${k}].${f}`, sd?.[f])
    }
    return out
}

/**
 * 檢定一個核心(ES1～ES17;逐條目一筆結果,field＝條目 id)
 *
 * @param {Object} state 輸入核心狀態(normalizeState 之後)
 * @param {Object} [ctx={}] 輸入 { contentOf:(noteId)=>String|null(出處筆記之內容章＋原文標題;未給則不檢 ES2／ES16),
 *        docIdOf:(noteId)=>String|null(ES12;未給則以筆記 id 當文件), heldOf:(coreId, noteId)=>Boolean(ES15:有無待判登錄;未給則未能判定),
 *        limits?(ES1 長度;未給用 DEFAULT_LIMITS), evidence?:{ levels, selfLimitOf }、weakEvidence?(ES13;未給 evidence 不檢),
 *        conflictEndsOf?:(邊 id)=>[a, b]|null(ES5;未給不檢), rs4HeldOf?:(邊 id)=>Boolean(ES5:已交 RS4 核對),
 *        locale?:語言設定或字形政策(ES3 只適用於臺灣正體,其餘逐條目列不適用;未給＝正體) }
 * @returns {Array} 回傳判定結果陣列
 * @throws {Error} ctx.locale 不合時拋出
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'], critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }] }).state
 * console.log(checkCore(s, {}).map((r) => [r.std, r.field, r.status].join(':')))
 * // => [
 * //   'ES1::pass',
 * //   'ES1:C1:pass',
 * //   'ES3:C1:pass',
 * //   'ES4:C1:pass',
 * //   'ES12:C1:violation',
 * //   'ES6::violation'
 * // ]
 */
export function checkCore(state, ctx = {}) {
    const s = isobj(state) ? state : {}
    const script = scriptOf(ctx.locale, 'checkCore 之 ctx.locale')
    const es3Applies = scriptApplies(CORE_STANDARDS.find((x) => x.id === 'ES3'), script)
    const out = []
    const W = withdrawnOf(s)
    const un = unsupportedOf(s)
    const contentOf = isfun(ctx.contentOf) ? ctx.contentOf : null
    const docIdOf = isfun(ctx.docIdOf) ? ctx.docIdOf : (id) => id
    const claimById = new Map((s.claims || []).map((c) => [c.id, c]))
    // 受檢範圍(itemsInScopeOf;存量處置同一份):主張、參數、待解問題之非終態且非已結案者;爭議除撤回外
    const inScope = new Set(itemsInScopeOf(s).map((x) => x.item))
    const liveSrc = (ids) => strs(ids).filter((id) => !W.has(id))

    // ES1 不變式(整個核心一筆)
    const inv = checkInvariants(s, s)
    out.push(inv.length ? result('ES1', STATUS.VIOLATION, inv.slice(0, 5).join('；'), s.coreId || '') : result('ES1', STATUS.PASS, '', s.coreId || ''))
    // ES1(v2)外洩與長度硬上限(逐條目;與新進 opStandards 之外洩、applyDelta 之長度拒收同一判準)
    const limits = { ...DEFAULT_LIMITS, ...(isobj(ctx.limits) ? ctx.limits : {}) }
    const es1Of = (id, texts, isEssence = false) => {
        const ps = []
        for (const f of texts) {
            const hit = leakProblem(f.text)
            if (hit) ps.push(`${f.field} 含流程用語「${hit}」`)
            const cap = lengthCapOf(isEssence ? 'essence' : f.field, limits)
            if (cap && f.text.length > cap) ps.push(`${f.field} 過長（${f.text.length} 字，硬上限 ${cap}）`)
        }
        out.push(ps.length ? result('ES1', STATUS.VIOLATION, ps.slice(0, 3).join('；'), id) : result('ES1', STATUS.PASS, '', id))
    }
    // ES1 之外洩亦檢理由類欄位(狀態說明、沿革之說明——流程用語常自理由欄外洩;新進之納入閘同檢理由)
    const noteTexts = (x) => [
        ...(str(x?.statusNote) ? [{ field: 'statusNote', text: str(x.statusNote) }] : []),
        ...(isarr(x?.history) ? x.history : []).map((h, i) => ({ field: `history[${i}].note`, text: str(h?.note) })).filter((t) => t.text),
    ]
    for (const key of ['claims', 'parameters', 'questions', 'disputes']) {
        for (const x of s[key] || []) {
            if (!x || TERMINAL_SET.has(x.status) || x.status === 'retracted') continue
            es1Of(x.id, [...itemTexts(key, x), ...noteTexts(x)])
        }
    }
    if (str(s.essence?.text)) es1Of('essence', [{ field: 'essence', text: str(s.essence.text) }], true)

    // ES2:對一組文字以一組出處判紮根
    const ground = (id, texts, srcIds) => {
        if (!contentOf) return
        const ids = [...new Set(srcIds)]
        const g = groundingOf(texts.map((x) => x.text).join('\n'), ids.map((nid) => contentOf(nid)))
        if (g.status === STATUS.PASS) out.push(result('ES2', STATUS.PASS, '', id))
        else if (g.status === STATUS.UNDETERMINED) out.push(result('ES2', STATUS.UNDETERMINED, `出處內容不可得 ${g.missing} 篇；可得者無：${g.ung.slice(0, 5).join('、')}`, id))
        else out.push(result('ES2', STATUS.VIOLATION, `所引出處無之數字：${g.ung.slice(0, 6).join('、')}`, id))
    }
    const forms = (id, texts) => {
        // ES3 v2:`[[連結]]` 與網址不計(與 SS3 v2、新進守門同一定義 FOREIGN_SPAN_RE);字形政策非臺灣正體 → 不適用
        if (!es3Applies) out.push(result('ES3', STATUS.NA, SCRIPT_NA_DETAIL, id))
        else {
            const bad = texts.filter((x) => scriptBadOf(script, x.text))
            out.push(bad.length ? result('ES3', STATUS.VIOLATION, `${bad.map((x) => x.field).slice(0, 4).join('、')} 有簡體或同形字誤用`, id) : result('ES3', STATUS.PASS, '', id))
        }
    }

    // 主張
    for (const c of s.claims || []) {
        if (!inScope.has(c)) continue
        const texts = itemTexts('claims', c)
        if (un.items.has(c.id)) {
            // 隔離(出處支持未能判定,ES9 存量;coreState ⑲)與出處全撤(ES8)分列——兩者皆不在有效集合,皆非合格
            out.push(un.held.has(c.id) ? result('ES9', STATUS.UNDETERMINED, `出處支持未能判定(隔離待判:${str(s.held?.[c.id]?.why).slice(0, 80)})`, c.id) : result('ES8', STATUS.UNDETERMINED, '出處全撤(隔離待處置)', c.id))
            forms(c.id, texts)
            continue
        }
        ground(c.id, texts, liveSrc(c.sources))
        forms(c.id, texts)
        const p4 = annotationProblems(c)
        out.push(p4.length ? result('ES4', STATUS.VIOLATION, p4.join('、'), c.id) : result('ES4', STATUS.PASS, '', c.id))
        if (c.kind === 'principle') {
            const p12 = principleDocsProblem(liveSrc(c.sources), docIdOf)
            out.push(p12 ? result('ES12', STATUS.VIOLATION, p12, c.id) : result('ES12', STATUS.PASS, '', c.id))
        }
    }
    // 參數(出處＝自身出處＋所依主張之出處)
    for (const p of s.parameters || []) {
        if (!inScope.has(p)) continue
        const texts = itemTexts('parameters', p)
        if (un.items.has(p.id)) {
            out.push(result('ES8', STATUS.UNDETERMINED, '出處全撤(隔離待處置)', p.id))
            continue
        }
        ground(p.id, texts, [...liveSrc(p.sources), ...liveSrc(claimById.get(p.claim)?.sources)])
        forms(p.id, texts)
        // ES13 弱證據參數須註明限制(與新進 opStandards 同一判準 weakEvidenceProblem;不受檢者不列)
        const w13 = weakEvidenceProblem(p, ctx)
        if (w13.applies) out.push(w13.ok ? result('ES13', STATUS.PASS, '', p.id) : result('ES13', STATUS.VIOLATION, `證據等級「${w13.level || '未評估'}」而 conditions 未註明限制`, p.id))
    }
    // 待解問題
    for (const q of s.questions || []) {
        if (!inScope.has(q)) continue
        const texts = itemTexts('questions', q)
        ground(q.id, texts, liveSrc(q.sources))
        forms(q.id, texts)
    }
    // 爭議(各方:方層出處＋所引主張之出處)
    for (const d of s.disputes || []) {
        if (!inScope.has(d)) continue
        const texts = itemTexts('disputes', d)
        const src = (d.sides || []).flatMap((sd) => [...liveSrc(sd?.sources), ...strs(sd?.claims).flatMap((cid) => liveSrc(claimById.get(cid)?.sources))])
        ground(d.id, texts, src)
        forms(d.id, texts)
    }
    // 本質
    const ess = isobj(s.essence) ? s.essence : {}
    // ES6 v2:與提煉段之本質專步同一判定(coreState.essenceNeedOf)——無本質或本質待重寫皆不合格
    const en = essenceNeedOf(s)
    if (en.need === 'missing') out.push(result('ES6', STATUS.VIOLATION, `有效主張 ${en.live} 條而無本質`, s.coreId || ''))
    else if (en.need === 'stale') out.push(result('ES6', STATUS.VIOLATION, `本質待重寫（${en.staleWhy}）`, s.coreId || ''))
    else out.push(result('ES6', en.live > 0 ? STATUS.PASS : STATUS.NA, '', s.coreId || ''))
    if (str(ess.text)) {
        const texts = [{ field: 'essence', text: str(ess.text) }]
        const src = strs(ess.claims).flatMap((cid) => liveSrc(claimById.get(cid)?.sources))
        if (contentOf) {
            const before = out.length
            ground('essence', texts, src)
            for (let i = before; i < out.length; i++) out[i] = { ...out[i], std: 'ES16' }
        }
        if (!es3Applies) out.push(result('ES3', STATUS.NA, SCRIPT_NA_DETAIL, 'essence'))
        else {
            const bad = scriptBadOf(script, ess.text)
            out.push(bad ? result('ES3', STATUS.VIOLATION, '本質有簡體或同形字誤用', 'essence') : result('ES3', STATUS.PASS, '', 'essence'))
        }
    }
    // ES15 逾限筆記須有待判登錄(逐篇;ctx.heldOf 未給 → 未能判定):逾限＝該篇最後一次之略過理由為逾限(重送後另有去向者不算)且未被存活條目引用
    //   (重送後已引用者不算;出處之撤回使其再成逾限亦照掃)
    const lastReason = new Map()
    for (const x of s.skipped || []) if (str(x?.note)) lastReason.set(str(x.note), x.reason)
    const citedNow = citedNotesOf(s)
    const exhausted = [...lastReason].filter(([nid, reason]) => reason === EXHAUSTED_REASON && !citedNow.has(nid)).map(([nid]) => nid)
    for (const nid of exhausted) {
        if (!isfun(ctx.heldOf)) out.push(result(ES15.std, STATUS.UNDETERMINED, '未給待判登錄', nid))
        else out.push(ctx.heldOf(s.coreId || '', nid) ? result(ES15.std, STATUS.PASS, '', nid) : result(ES15.std, STATUS.VIOLATION, '逾限筆記無待判登錄（靜默遺失）', nid))
    }
    // ES5 已見之衝突有去向(存量;ctx.conflictEndsOf 未給 → 不檢):兩端皆為已消化存活筆記者,須有處置結構(③不限版)或已交 RS4 核對;
    //   給了邊端而未給待判登錄(rs4HeldOf)→ 無處置結構者未能判定(同 ES15:不知有無交 RS4,不報為違反;終審 §3 D5l)
    if (isfun(ctx.conflictEndsOf)) {
        for (const { eid, ends, how } of es5RowsOf(s, ctx)) {
            out.push(how ? result('ES5', STATUS.PASS, '', eid)
                : (!isfun(ctx.rs4HeldOf) ? result('ES5', STATUS.UNDETERMINED, '未給待判登錄', eid)
                    : result('ES5', STATUS.VIOLATION, `衝突（${ends.join(' ⇄ ')}）已記為見過而無處置結構、亦未交 RS4 核對`, eid)))
        }
    }
    return out
}

/**
 * 關聯型別之現名化(單一規則;提煉段讀邊與 ES5 之判定材料同讀):型別解析(關聯 domain 之 resolveType)得到者為現名,解析不到者以原值;
 *   domain 無型別解析者一律原值
 *
 * @param {Object} relDomain 輸入關聯 domain(取 resolveType)
 * @returns {Function} 回傳 (型別) => 現名或原值
 * @example
 * console.log(relationTypeNowOf({ resolveType: (t) => (t === '舊' ? '新' : '') })('舊'), relationTypeNowOf({ resolveType: () => '' })('外'), relationTypeNowOf(null)('x'))
 * // => 新 外 x
 */
export function relationTypeNowOf(relDomain) {
    return (t) => (isfun(relDomain?.resolveType) ? relDomain.resolveType(t) || t : t)
}

/**
 * 檢定標準 ES5 之判定材料(checkCore 之 conflictEndsOf／rs4HeldOf;符合度掃描與存量處置同一份):衝突邊之兩端、已交衝突核對(RS4)者
 *   (待判登錄,任一狀態)。衝突型之判定取關聯 domain 之型別解析——現名之外,改名表之舊名亦認得(關聯段維護改寫前之一輪;與提煉段讀衝突邊
 *   同一規則:型別解析得到者為現名,解析不到者以原值比)
 *
 * @param {Array} edges 輸入全部邊
 * @param {Array|null} holds 輸入全部待判登錄(未開 holds 集合為 null)
 * @param {Object} relDomain 輸入關聯 domain(取 conflictType、resolveType)
 * @returns {Object} 回傳 { conflictEndsOf:(邊 id)=>[a, b]|null, rs4HeldOf:(邊 id)=>Boolean }
 * @example
 * let ctx = es5CtxOf([{ id: 'e1', from: 'a', to: 'b', type: '衝突' }], [], { conflictType: '衝突', resolveType: (t) => t })
 * console.log(ctx.conflictEndsOf('e1'), ctx.rs4HeldOf('e1'))
 * // => [ 'a', 'b' ] false
 */
export function es5CtxOf(edges, holds, relDomain) {
    const typeOf = relationTypeNowOf(relDomain)
    const ends = new Map((isarr(edges) ? edges : []).filter((e) => isobj(e) && typeOf(e.type) === relDomain?.conflictType).map((e) => [e.id, [e.from, e.to]]))
    const rs4 = new Set((isarr(holds) ? holds : []).filter((h) => h?.std === RS4.std).map((h) => h.oid))
    return { conflictEndsOf: (id) => ends.get(id) || null, rs4HeldOf: (id) => rs4.has(id) }
}

export default { CORE_STANDARDS, ANNOTATION_UNSTATED, ES15_OBJECT, LEAK_PHRASES, leakProblem, scriptBadOf, weakEvidenceProblem, itemsInScopeOf, relationTypeNowOf, NOTE_LINK_RE, NOTE_CODE_RE, annotationProblems, principleDocsProblem, noteMentionsOf, groundingOf, itemTexts, checkCore, es5CtxOf }
