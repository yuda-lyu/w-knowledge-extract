// synonymCheck.mjs — 檢定標準 ES11(核心身分:同義概念不分立核心——判為同義者加別名後由筆記重新提煉)
//   之純函數:候選對(名稱相近＋AI 提議)、單票驗證、逐項票、判定小組之執行
//
// 【缺口】概念鍵以 normalizeConcept(字形折疊＋改名＋別名)分群;未宣告別名之同義寫法(如「資料與特徵」／「數據與特徵」)
//   各自成核心——同一知識分兩處累積、互不引用。分身合併(同鍵多核心)只處理同鍵者。
// 【候選】①名稱相近(程式):兩核心概念名之編輯距離 ≤1(四字以下)或 ≤2(五字以上)、或一方包含另一方(較短者 ≥2 字)
//   ②AI 提議(全部核心名一次;名單變了才再提)——涵蓋寫法不相近之同義(跨文字系統、譯名)。皆只是候選,成立與否由判定小組。
// 【票】same(同一概念:同義、譯名或寫法不同,可合為一個核心)｜different(不同概念,含一方為另一方之子題或上位)｜unsure;理由 ≥10 字
//   (unsure 除外)。判定小組以裁決值成立(core/standards/panel)。
// 【處置(呼叫端 extract/stages/synonymStep)】成立 same → 待判(使用者;建議 vocab.conceptAliases 之別名與正名)＋檢核紀錄不合格;
//   成立 different → 檢核紀錄合格;判不了 → 待判(使用者)＋未能判定;缺票／同一供應者 → 待判 pipeline(下輪重判;全部受檢項皆如此為專步層之失敗)。
//   **不自動改詞彙表**——別名改變分群,屬安裝方之設定。
// 【判定小組】一頁交摘要套件之單頁執行器 runPanelPage;本檔只給本標準之差異:無項、缺提示詞或缺呼叫者不呼叫、提示詞收各項之陣列、
//   一席回覆之逐項票、「相同」之定義(裁決值)、打亂前綴 es11、段名 synonym1／synonym2／synonym3。
// 【專步與掃描同一函數】候選對與素材雜湊(synonymCandidatesOf:主核心之名、名稱相近 ∪ 已存之提議、兩側之本質與主張)、須檢之判定
//   (synonymDueOf:排除待判中、已判同素材、已豁免且素材未變)——掃描之 ES11 列之受檢總量與到期數由之推得,不另寫一份。

import path from 'path'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { sha1, oneline, pipelineDueOf, textValueOf as str } from '../core/capturePackage.mjs'
import { PANEL_UNSURE, runPanelPage } from '../core/summarizePackage.mjs'
import { needsCheck } from '../core/relatePackage.mjs'
import { replyObjectOf } from './parse.mjs'
import { VERDICT_MIN_REASON, verdictFieldsOf, votesByIndexOf, panelCallOf, runPanelPages } from './panelVotes.mjs'
import { EXTRACT_HOLD_OBJECTS } from '../stores/extractHolds.mjs'
import { SYNONYM_STATE_FILE, EXTRACT_LEDGER_SHAPES, readLedgerJson } from '../stores/extractFiles.mjs'
import { isPrimaryCore } from '../stores/conceptSelection.mjs'
import { HASH_FIELD_SEP, TERMINAL_SET } from '../stores/coreState.mjs'

export { SYNONYM_STATE_FILE }

/** 標準識別與待判／檢核之物件種類 */
export const ES11 = Object.freeze({ std: 'ES11', v: 1, object: EXTRACT_HOLD_OBJECTS.corePair })
/** 合法裁決值 */
export const SYNONYM_VERDICTS = Object.freeze(['same', 'different', PANEL_UNSURE])
/** 同義覆核每頁之對數(正式之同義專步與檢定標準之逐案題組〔standards/esCases 之 ES_CASE_PAGE_SIZE〕同讀此一份) */
export const SYNONYM_PAGE_SIZE = 10
const sameSyn = (a, b) => isobj(a) && isobj(b) && a.verdict === b.verdict
/** 候選來源之排序(須檢者之序:名稱編輯距離、AI 提議、包含) */
const ORDER = { edit: 0, propose: 1, contain: 2 }

/**
 * 兩字串之編輯距離(Levenshtein;以字元計,中文一字一字元)
 *
 * @param {String} a 輸入字串
 * @param {String} b 輸入字串
 * @returns {Integer} 回傳距離
 * @example
 * console.log(editDistance('黑洞', '黑洞們'), editDistance('abc', 'abd'), editDistance('', '甲'))
 * // => 1 1 1
 */
export function editDistance(a, b) {
    const x = [...str(a)]
    const y = [...str(b)]
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
    for (let i = 1; i <= x.length; i++) {
        const cur = [i]
        for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
        prev = cur
    }
    return prev[y.length]
}

/** 配對鍵之分隔(pairKeyOf 與 pairOfKey 同讀) */
const PAIR_SEP = ' ⇄ '

/**
 * 一對概念之鍵(無序;字典序前者在前,以「 ⇄ 」相接——待判與檢核之 oid,列表可讀)
 *
 * @param {String} a 輸入概念名
 * @param {String} b 輸入概念名
 * @returns {String} 回傳鍵
 * @example
 * console.log(pairKeyOf('乙', '甲') === pairKeyOf('甲', '乙'), pairKeyOf('乙', '甲'))
 * // => true 乙 ⇄ 甲
 */
export function pairKeyOf(a, b) {
    const [x, y] = [str(a), str(b)].sort()
    return `${x}${PAIR_SEP}${y}`
}

/**
 * 配對鍵 → 兩概念名(pairKeyOf 之逆;鍵不含分隔者回 ['', ''])
 *
 * @param {String} key 輸入 pairKeyOf 之產物
 * @returns {Array} 回傳 [a, b]
 * @example
 * console.log(pairOfKey(pairKeyOf('乙', '甲')))
 * // => [ '乙', '甲' ]
 */
export function pairOfKey(key) {
    const k = String(key ?? '')
    const i = k.indexOf(PAIR_SEP)
    return i < 0 ? ['', ''] : [str(k.slice(0, i)), str(k.slice(i + PAIR_SEP.length))]
}

/**
 * 檢核雜湊(兩概念名＋判定所讀之素材:兩側之本質與主張文字——名稱或素材變即重判;終審 §3 D5g)
 *
 * @param {String} key 輸入 pairKeyOf 之產物
 * @param {Object} [a] 輸入甲側之材料 { essence, claims:Array(文字) }(未給視為空)
 * @param {Object} [b] 輸入乙側之材料
 * @returns {String} 回傳 16 碼雜湊
 * @example
 * console.log(synonymHashOf('甲 ⇄ 乙') !== synonymHashOf('甲 ⇄ 乙', { essence: 'x', claims: [] }, {}))
 * // => true
 */
export function synonymHashOf(key, a, b) {
    const side = (x) => `${str(x?.essence)}\u0002${(isarr(x?.claims) ? x.claims : []).map(str).join('\u0003')}`
    return sha1(`${ES11.std}|${key}${HASH_FIELD_SEP}${side(a)}${HASH_FIELD_SEP}${side(b)}`).slice(0, 16)
}

/**
 * 名稱相近之候選對(程式;見檔頭)
 *
 * @param {Array} names 輸入核心概念名(各自為主核心;已去重)
 * @returns {Array} 回傳 [{ a, b, by:'edit'|'contain' }](a、b 依字典序)
 * @example
 * console.log(nameCandidatesOf(['黑洞', '黑洞物理', '宇宙']))
 * // => [ { a: '黑洞', b: '黑洞物理', by: 'contain' } ]
 */
export function nameCandidatesOf(names) {
    const list = [...new Set((isarr(names) ? names : []).map(str).filter(Boolean))].sort()
    const out = []
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const [a, b] = [list[i], list[j]]
            const [la, lb] = [[...a].length, [...b].length]
            const short = la <= lb ? a : b
            const long = la <= lb ? b : a
            if ([...short].length >= 2 && long.includes(short)) {
                out.push({ a, b, by: 'contain' })
                continue
            }
            if (la < 2 || lb < 2 || Math.abs(la - lb) > 2) continue
            const d = editDistance(a, b)
            if (d <= (Math.max(la, lb) <= 4 ? 1 : 2)) out.push({ a, b, by: 'edit' })
        }
    }
    return out
}

/**
 * AI 提議之候選對(驗證:兩名皆在名單、不同名);格式 { pairs:[{ a, b, reason }] }
 *
 * @param {*} json 輸入提議席之回覆
 * @param {Array} names 輸入核心概念名
 * @returns {Array} 回傳 [{ a, b, by:'propose', reason }](a、b 依字典序;重複去除)
 * @example
 * console.log(proposedCandidatesOf({ pairs: [{ a: '黑洞', b: '黑洞物理', reason: '同一對象' }, { a: '黑洞', b: '黑洞', reason: '自己' }, { a: '黑洞', b: '外星', reason: '不在名單' }] }, ['黑洞', '黑洞物理']))
 * // => [ { a: '黑洞', b: '黑洞物理', by: 'propose', reason: '同一對象' } ]
 */
export function proposedCandidatesOf(json, names) {
    const set = new Set((isarr(names) ? names : []).map(str))
    const seen = new Set()
    const out = []
    for (const p of isarr(json?.pairs) ? json.pairs : []) {
        const [a, b] = [str(p?.a), str(p?.b)].sort()
        if (!a || !b || a === b || !set.has(a) || !set.has(b)) continue
        const k = pairKeyOf(a, b)
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ a, b, by: 'propose', reason: str(p?.reason) })
    }
    return out
}

/**
 * 同義核對之候選對與其素材(專步與掃描同一函數;終審 §3 D5g):主核心(概念層與類別層)之名;候選＝名稱相近(程式)∪ 已存之提議
 *   (提議紀錄檔之名單雜湊與現名單相同者;AI 提議由專步另補、以 add 併入);每對之素材＝兩核心之本質、主要主張、主要出處標題(狀態走四態
 *   分流表:可讀者取之),檢核雜湊含兩側之本質與主張(素材變即重判)
 *
 * @param {Object} o 輸入 { cores:Array(核心記錄), loadUsable:(核心 id)=>{ readable, state }, notesById?:Map, stateDir:String(提議紀錄檔所在),
 *   log?:{ warn }(提議紀錄檔損壞之告警;未給不告警) }
 * @returns {Object} 回傳 { names:Array(排序之主核心名), byName:Map(名 → 核心記錄), namesHash, file(提議紀錄檔), proposed:Array|null(已存之提議;
 *   名單變了為 null), cand:Map(對鍵 → { key, a, b, by }), add:(pairs)=>void(併入提議), sidesOf:(c)=>{ a:{ readable, side }, b }, hashOf:(c)=>String }
 * @example
 * need test in nodejs.
 *
 * const sc = synonymCandidatesOf({ cores, loadUsable: (id) => store.loadUsable(id), notesById, stateDir: dirs.state })
 * console.log(sc.names.length, sc.cand.size, sc.hashOf([...sc.cand.values()][0]))
 */
export function synonymCandidatesOf(o) {
    const recs = (isarr(o?.cores) ? o.cores : []).filter((c) => isPrimaryCore(c, o.cores))
    const byName = new Map(recs.map((c) => [str(c.concept), c]))
    const names = [...byName.keys()].sort()
    const file = path.join(str(o?.stateDir), SYNONYM_STATE_FILE)
    // 提議之紀錄為派生檔(壞了即重提一次,不隔離;唯讀讀法只告警)
    const saved = readLedgerJson(file, { shape: EXTRACT_LEDGER_SHAPES.synonym, quarantine: false, onCorrupt: (i) => o.log?.warn?.(`提煉同義核心核對：提議紀錄檔損壞（${oneline(i.error, 80)}），本輪重提一次（派生檔，不隔離）`) })
    const namesHash = sha1(names.join('\n'))
    const proposed = isobj(saved) && saved.namesHash === namesHash ? saved.pairs : null
    const cand = new Map()
    const add = (pairs) => {
        for (const p of isarr(pairs) ? pairs : []) {
            const key = pairKeyOf(p.a, p.b)
            if (!cand.has(key)) cand.set(key, { key, a: p.a < p.b ? p.a : p.b, b: p.a < p.b ? p.b : p.a, by: p.by })
        }
    }
    add(nameCandidatesOf(names))
    add(proposed)
    const sideOf = (name) => {
        const rec = byName.get(name)
        const r = rec ? o.loadUsable(rec.id) : null
        const s = r?.readable ? r.state : null
        const live = (isarr(s?.claims) ? s.claims : []).filter((c) => !TERMINAL_SET.has(c.status))
        const cited = [...new Set(live.flatMap((c) => c.sources || []))]
        return { readable: !!s, side: { concept: name, essence: str(s?.essence?.text), claims: live.slice(0, 6).map((c) => str(c.text)), notes: cited.slice(0, 6).map((nid) => o.notesById?.get(nid)?.title || nid), noteCount: Number(rec?.noteCount) || cited.length } }
    }
    const sides = new Map()
    const sidesOf = (c) => {
        if (!sides.has(c.key)) sides.set(c.key, { a: sideOf(c.a), b: sideOf(c.b) })
        return sides.get(c.key)
    }
    const hashOf = (c) => {
        const x = sidesOf(c)
        return synonymHashOf(c.key, x.a.side, x.b.side)
    }
    return { names, byName, namesHash, file, proposed, cand, add, sidesOf, hashOf }
}

/**
 * 候選對中之須檢者(專步與掃描同一判定):排除待判中(使用者;pipeline 者到期即排)、已有同素材之檢核紀錄者、使用者已豁免且素材未變者
 *   (裁示有效;終審 §3 D5e);pipeline 待判者先、再依候選來源(名稱編輯距離、AI 提議、包含)、再依鍵
 *
 * @param {Object} sc 輸入 synonymCandidatesOf 之產物
 * @param {Object} o 輸入 { openOf:(對鍵)=>待判登錄|null(未結者), waivedOf:(對鍵)=>待判登錄|null|Promise(已豁免者), recOf:(對鍵)=>檢核紀錄|null|Promise }
 * @returns {Promise<Object>} 回傳 { due:[{ key, a, b, by, hold }], waivedKept:Integer(已豁免且素材未變而略過之對數) }
 * @example
 * need test in nodejs.
 *
 * const due = await synonymDueOf(synonymCandidatesOf(cores, { editMax: 1 }), { openOf, waivedOf, recOf })
 * console.log(due.map((x) => x.key))
 */
export async function synonymDueOf(sc, o) {
    const due = []
    let waivedKept = 0
    for (const c of sc.cand.values()) {
        const h = o.openOf(c.key) || null
        if (h && !pipelineDueOf(h)) continue
        if (!h && !needsCheck(await o.recOf(c.key), { hash: sc.hashOf(c), std: ES11.std, v: ES11.v })) continue
        const cur = h ? null : await o.waivedOf(c.key)
        if (cur?.status === 'waived' && str(cur.ctx?.hash) === sc.hashOf(c)) {
            waivedKept++
            continue
        }
        due.push({ ...c, hold: h })
    }
    due.sort((x, y) => Number(!x.hold) - Number(!y.hold) || ORDER[x.by] - ORDER[y.by] || (x.key < y.key ? -1 : 1))
    return { due, waivedKept }
}

/**
 * 單票驗證
 *
 * @param {*} raw 輸入 { verdict, reason }
 * @returns {Object|String|null} 回傳 { verdict, reason }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * console.log(checkSynonymVerdictOf({ verdict: 'same', reason: '兩個名稱指同一個天文物理概念' }), checkSynonymVerdictOf({ verdict: 'same' }))
 * // => { verdict: 'same', reason: '兩個名稱指同一個天文物理概念' } null
 */
export function checkSynonymVerdictOf(raw) {
    const f = verdictFieldsOf(raw)
    if (!f) return null
    const { verdict: v, reason } = f
    if (v === PANEL_UNSURE) return PANEL_UNSURE
    if (v !== 'same' && v !== 'different') return null
    return reason.length >= VERDICT_MIN_REASON ? { verdict: v, reason } : null
}

/**
 * 一席之回覆({ checks:[{ index, verdict, reason }] })→ 逐項票(讀法見 panelVotes 之 votesByIndexOf);同編號矛盾者作廢為缺票
 *
 * @param {*} json 輸入回覆
 * @param {Set} indices 輸入本席所見之項編號
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)
 * @example
 * console.log(seatSynonymVotesOf({ checks: [{ index: 1, verdict: 'different', reason: '兩者研究對象不同，不可併為一個核心' }] }, new Set([1])))
 * // => Map(1) { 1 => { verdict: 'different', reason: '兩者研究對象不同，不可併為一個核心' } }
 */
export function seatSynonymVotesOf(json, indices) {
    return votesByIndexOf(json, { seen: (i) => indices instanceof Set && indices.has(i), voteOf: (it) => checkSynonymVerdictOf(it), same: sameSyn })
}

/**
 * 覆核席之形狀檢查(同義核對):須有 checks 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkSynonymChecks({ checks: [] }), checkSynonymChecks({ pairs: [] }))
 * // => true false
 */
export const checkSynonymChecks = (j) => !!j && isarr(j.checks)

/**
 * 覆核席之解析(同義核對;取最後一個過 checkSynonymChecks 者)
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 checks 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseSynonymChecks('{"checks":[{"index":1,"verdict":"same","reason":"指同一概念"}]}').checks.length, parseSynonymChecks('x'))
 * // => 1 null
 */
export const parseSynonymChecks = (s) => replyObjectOf(s, ['checks'], checkSynonymChecks)

/**
 * 提議席之形狀檢查(同義提議):須有 pairs 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkSynonymProposals({ pairs: [] }), checkSynonymProposals({ checks: [] }))
 * // => true false
 */
export const checkSynonymProposals = (j) => !!j && isarr(j.pairs)

/**
 * 提議席之解析(同義提議;取最後一個過 checkSynonymProposals 者)
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 pairs 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseSynonymProposals('{"pairs":[{"a":"黑洞","b":"黑洞物理","reason":"同一對象"}]}').pairs.length, parseSynonymProposals('x'))
 * // => 1 null
 */
export const parseSynonymProposals = (s) => replyObjectOf(s, ['pairs'], checkSynonymProposals)

/**
 * 判定小組之執行(一頁,交 runPanelPage:第一、二席並行(第二席項序打亂)→ 未成立而可成立者叫第三席;見檔頭【判定小組】)
 *
 * @param {Object} o 輸入 { items:[{ key, a:{ concept, essence, claims:Array(文字), notes:Array(標題) }, b:{…} }], buildPrompt:(items)=>String,
 *   call:(stage, seat, prompt)=>Promise<{ ok, json, providerId, stopped? }>, seats:{ first, second, third? } }
 * @returns {Promise<Object>} 回傳 { decisions:Map(key → decidePanel 之結果＋votes;材料過大者 { status:'undetermined', why:'oversize' }), calls, stopped,
 *   undecided:Array(key;中止而未判), oversize:Array(key) }(放不下之頁對半分再送——standards/panelVotes 之 runPanelPages)
 * @example
 * need test in nodejs.
 *
 * const r = await runSynonymCheck({ items, buildPrompt, call, seats: { first, second, third } })
 * console.log(r.decisions, r.undecided, r.oversize)
 */
export async function runSynonymCheck(o) {
    const items = isarr(o.items) ? o.items : []
    const seats = isobj(o.seats) ? o.seats : {}
    if (!items.length || !isfun(o.buildPrompt) || !isfun(o.call)) return { decisions: new Map(), calls: 0, stopped: false, undecided: [], oversize: [] }
    const view = (x) => ({ index: x.index, a: x.it.a, b: x.it.b })
    return runPanelPages({
        pages: [items],
        runPage: async (page, track) => {
            const r = await runPanelPage({
                local: page.map((it, j) => ({ index: j + 1, key: it.key, it })),
                buildPrompt: (xs) => o.buildPrompt(xs.map(view)),
                shufflePrefix: 'es11',
                stages: ['synonym1', 'synonym2', 'synonym3'],
                call: panelCallOf(o, track),
                seats,
                votesOf: seatSynonymVotesOf,
                same: sameSyn,
            })
            return { decisions: r.decisions, calls: r.calls, stopped: r.stopped }
        },
    })
}

export default { ES11, SYNONYM_VERDICTS, SYNONYM_PAGE_SIZE, SYNONYM_STATE_FILE, editDistance, pairKeyOf, pairOfKey, synonymHashOf, nameCandidatesOf, proposedCandidatesOf, synonymCandidatesOf, synonymDueOf, checkSynonymVerdictOf, seatSynonymVotesOf, parseSynonymChecks, checkSynonymChecks, parseSynonymProposals, checkSynonymProposals, runSynonymCheck }
