// orphanCheck.mjs — 檢定標準 ES8 之專責佇列:失撐主張(出處筆記全數已刪除)不等選題,於該核心之已消化筆記中找支持 → 兩席一致無支持才撤回
//   (理由專用、出處筆記還原時復活)——純函數與判定小組
//
// 【對象】unsupportedOf(state).items 中之主張、非隔離(held 屬 ES9);檢核紀錄物件 claim、標準 ES8,雜湊＝斷言＋證據性質＋候選筆記 id(排序)——
//   核心之已消化筆記變了才重判。
// 【判準依證據性質(v2,與 ES9 v2 同一判準)】每項帶 basis:推論類須主張寫明前提(前提為筆記明載)才算受支持,其餘須筆記直接陳述。
// 【候選】該核心存活之已消化筆記「全部」(不以相似度預篩:預篩漏掉支持者而判「無支持」即誤撤——違反「不以機率篩選」);
//   內容＝contentOf,依字數分頁,同核心之全部受檢主張列於每一頁。
// 【裁決】supported(by:[S…] 支持之筆記)｜none(皆不支持)｜unsure;非 supported 之理由與 supported 之理由皆 ≥10 字,不合格之票＝缺票。
//   同一頁兩票「相同」＝同為 none,或同為 supported 且所列筆記有交集(交集即補出處之筆記)。
// 【跨頁合成】任一頁成立 supported → 補出處(各成立頁之交集聯集);每一頁皆成立 none → none(撤回);其餘 → 未成立
//   (有缺票或同一供應者之頁 → 重試;其餘 → 判不了)。
// 【判定小組】每頁交摘要套件之單頁執行器 runPanelPage;本檔只給本標準之差異:依候選筆記分頁(每頁送全部受檢項,逐頁呼叫、累計呼叫數)、
//   提示詞之項、一席回覆之逐項票(驗 by 須為本頁之標號)、「相同」之定義、跨頁合成(頁後以 byIndex 收各頁之裁定)、打亂前綴 es8、
//   段名 orphan1／orphan2／orphan3。任一頁中止 → 整個覆核中止,回空結果(不以部分頁之裁定處置)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { PANEL_UNSURE, PANEL_WHY, panelSeats, runPanelPage } from '../core/summarizePackage.mjs'
import { sha1, textValueOf as str, uniq } from '../core/capturePackage.mjs'
import { needsCheck } from '../core/relatePackage.mjs'
import { HASH_FIELD_SEP, TERMINAL_SET, unsupportedOf, withdrawnOf } from '../stores/coreState.mjs'
import { itemOidOf } from '../stores/extractHolds.mjs'
import { claimAssertion, SUPPORT_PAGE_CHARS } from './supportCheck.mjs'
import { replyObjectOf } from './parse.mjs'
import { VERDICT_MIN_REASON, NO_MATERIAL_TEXT, EXTRACT_PANEL_WHY, verdictFieldsOf, votesByIndexOf, panelCallOf, voteTextOf } from './panelVotes.mjs'

/** 標準識別(v2:判準依證據性質,同 ES9 v2) */
export const ES8 = Object.freeze({ std: 'ES8', v: 2 })
/** 合法裁決值 */
export const ORPHAN_VERDICTS = Object.freeze(['supported', 'none', PANEL_UNSURE])


/**
 * 本核心之候選筆記:已消化、未撤、記錄仍在者(依消化序)
 *
 * @param {Object} s 輸入核心狀態
 * @param {Function} [has] 輸入 (筆記 id)=>Boolean(記錄仍在;未給視為皆在)
 * @returns {Array} 回傳筆記 id
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }], consumed: ['n1', 'n2', 'n3'] }).state
 * s.withdrawn = { n3: { at: 'T1' } }
 * console.log(orphanCandidatesOf(s, (id) => id !== 'n2'))
 * // => [ 'n1' ]
 */
export function orphanCandidatesOf(s, has) {
    const W = withdrawnOf(s)
    return uniq((s?.consumed || []).map(str).filter((id) => id && !W.has(id) && (!isfun(has) || has(id))))
}

/**
 * 主張之受檢雜湊(ES8):斷言＋證據性質＋候選筆記 id(排序)＋各候選之內容鍵(判定所讀之素材;候選內容變即重判——終審 §3 D5g)
 *
 * @param {Object} claim 輸入主張
 * @param {Array} cands 輸入候選筆記 id
 * @param {Function} [keyOf] 輸入 (筆記 id)=>內容鍵(字串;不可得回 '';未給視為 '')
 * @returns {String} 回傳雜湊
 * @example
 * const claim = { text: '甲', basis: '案例' }
 * console.log(orphanHashOf(claim, ['n2', 'n1'], () => 'k') === orphanHashOf(claim, ['n1', 'n2'], () => 'k'), orphanHashOf(claim, ['n1'], () => 'k') === orphanHashOf(claim, ['n1'], () => 'k2'))
 * // => true false
 */
export function orphanHashOf(claim, cands, keyOf) {
    const k = isfun(keyOf) ? keyOf : () => ''
    return sha1([claimAssertion(claim), `basis=${str(claim?.basis)}`, ...[...(isarr(cands) ? cands : [])].sort().map((n) => `${n}=${str(k(n))}`)].join(HASH_FIELD_SEP))
}

/**
 * 本核心須(重)檢之失撐主張
 *
 * @param {Object} s 輸入核心狀態
 * @param {Object} o 輸入 { coreId, recOf:(oid)=>檢核紀錄|null, has:(nid)=>Boolean, keyOf?:(nid)=>內容鍵, retry:Set(使用者要求重判之主張 id) }
 * @returns {Array} 回傳 [{ id, hash }](無候選筆記者不列——無可找)
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }], consumed: ['n1', 'n2'] }).state
 * s.withdrawn = { n1: { at: 'T1' } }
 * console.log(orphanNeedsOf(s, { coreId: 'c1', recOf: () => null, has: () => true, keyOf: () => 'k', retry: new Set() }).map((x) => x.id))
 * // => [ 'C1' ]
 */
export function orphanNeedsOf(s, o = {}) {
    const un = unsupportedOf(s)
    const cands = orphanCandidatesOf(s, o.has)
    if (!cands.length) return []
    const retry = o.retry instanceof Set ? o.retry : new Set()
    const out = []
    for (const c of s?.claims || []) {
        if (TERMINAL_SET.has(c.status) || !un.items.has(c.id) || un.held.has(c.id)) continue
        const hash = orphanHashOf(c, cands, o.keyOf)
        const rec = isfun(o.recOf) ? o.recOf(itemOidOf(str(o.coreId), c.id)) : null
        if (retry.has(c.id) || needsCheck(rec, { hash, std: ES8.std, v: ES8.v })) out.push({ id: c.id, hash })
    }
    return out
}

/**
 * 單票驗證
 *
 * @param {*} raw 輸入 { verdict, by?, reason }
 * @param {Set} labels 輸入本頁之筆記標號(S1…)
 * @returns {Object|String|null} 回傳 { verdict, by:Array, reason }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * console.log(checkOrphanVerdictOf({ verdict: 'supported', by: ['S1'], reason: 'S1 明載該主張之數據與結論' }, new Set(['S1'])), checkOrphanVerdictOf({ verdict: 'supported', by: ['S9'], reason: 'S9 明載該主張之數據' }, new Set(['S1'])))
 * // => { verdict: 'supported', by: [ 'S1' ], reason: 'S1 明載該主張之數據與結論' } null
 */
export function checkOrphanVerdictOf(raw, labels) {
    const f = verdictFieldsOf(raw)
    if (!f) return null
    const { verdict: v, reason } = f
    if (v === PANEL_UNSURE) return PANEL_UNSURE
    if (reason.length < VERDICT_MIN_REASON) return null
    if (v === 'none') return { verdict: 'none', by: [], reason }
    if (v !== 'supported') return null
    const by = uniq((isarr(raw.by) ? raw.by : [raw.by]).map((x) => str(x).toUpperCase()).filter((x) => labels.has(x)))
    return by.length ? { verdict: 'supported', by, reason } : null
}

/**
 * 同一頁兩票相同:同為 none,或同為 supported 且所列筆記有交集
 *
 * @param {Object} a 輸入票甲 { verdict, by }
 * @param {Object} b 輸入票乙 { verdict, by }
 * @returns {Boolean} 回傳兩票是否相同
 * @example
 * console.log(sameOrphan({ verdict: 'none', by: [] }, { verdict: 'none', by: [] }), sameOrphan({ verdict: 'supported', by: ['S1', 'S2'] }, { verdict: 'supported', by: ['S2'] }), sameOrphan({ verdict: 'supported', by: ['S1'] }, { verdict: 'none', by: [] }))
 * // => true true false
 */
export const sameOrphan = (a, b) => isobj(a) && isobj(b) && a.verdict === b.verdict && (a.verdict === 'none' || a.by.some((x) => b.by.includes(x)))

/**
 * 一席之回覆 → 逐項票(讀法見 panelVotes 之 votesByIndexOf);同編號矛盾者作廢為缺票
 *
 * @param {*} json 輸入 parseOrphanChecks 之產物
 * @param {Set} indices 輸入本席所見之項編號
 * @param {Set} labels 輸入本頁之筆記標號
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)
 * @example
 * const json = { checks: [{ index: 1, verdict: 'none', reason: '各篇皆未提及該主張之內容' }] }
 * console.log(seatOrphanVotesOf(json, new Set([1]), new Set(['S1', 'S2'])))
 * // => Map(1) { 1 => { verdict: 'none', by: [], reason: '各篇皆未提及該主張之內容' } }
 */
export function seatOrphanVotesOf(json, indices, labels) {
    return votesByIndexOf(json, { seen: (i) => indices.has(i), voteOf: (it) => checkOrphanVerdictOf(it, labels), same: sameOrphan })
}

/**
 * 覆核席之形狀檢查(失撐找支持):須有 checks 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkOrphanChecks({ checks: [] }), checkOrphanChecks(null))
 * // => true false
 */
export const checkOrphanChecks = (j) => !!j && isarr(j.checks)

/**
 * 覆核席之解析(失撐找支持;取最後一個過 checkOrphanChecks 者)
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 checks 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseOrphanChecks('{"checks":[{"index":1,"verdict":"none","reason":"各篇皆未提及該主張之內容"}]}').checks.length, parseOrphanChecks('x'))
 * // => 1 null
 */
export const parseOrphanChecks = (s) => replyObjectOf(s, ['checks'], checkOrphanChecks)

/**
 * 候選筆記分頁:依序放入,頁內字數逾上限即開新頁;單篇超過上限者獨佔一頁(不截斷)
 *
 * @param {Array} notes 輸入筆記 id
 * @param {Function} sizeOf 輸入 (筆記 id)=>字數
 * @param {Integer} cap 輸入每頁上限
 * @returns {Array} 回傳頁陣列(筆記 id 陣列)
 * @example
 * console.log(packOrphanPages(['n1', 'n2', 'n3'], (id) => ({ n1: 400, n2: 400, n3: 900 })[id], 1000))
 * // => [ [ 'n1', 'n2' ], [ 'n3' ] ]
 */
export function packOrphanPages(notes, sizeOf, cap) {
    const pages = []
    let cur = []
    let size = 0
    for (const n of isarr(notes) ? notes : []) {
        const add = Number(sizeOf(n)) || 0
        if (cur.length && size + add > cap) {
            pages.push(cur)
            cur = []
            size = 0
        }
        cur.push(n)
        size += add
    }
    if (cur.length) pages.push(cur)
    return pages
}

/**
 * 成立之 supported:成對兩票所列筆記之交集(標號)
 *
 * @param {Object} d 輸入 decidePanel 之結果(帶 votes)
 * @returns {Array} 回傳標號
 * @example
 * const d = { status: 'decided', verdict: { verdict: 'supported' }, seats: ['first', 'second'], votes: [{ seat: 'first', verdict: { verdict: 'supported', by: ['S1', 'S2'] } }, { seat: 'second', verdict: { verdict: 'supported', by: ['S2', 'S3'] } }] }
 * console.log(agreedLabelsOf(d))
 * // => [ 'S2' ]
 */
export function agreedLabelsOf(d) {
    if (d?.status !== 'decided' || d.verdict?.verdict !== 'supported') return []
    const pair = (d.votes || []).filter((v) => (d.seats || []).includes(v.seat) && isobj(v.verdict))
    if (pair.length < 2) return []
    return pair[0].verdict.by.filter((x) => pair[1].verdict.by.includes(x))
}

/**
 * 失撐主張之找支持(判定小組;逐頁交 runPanelPage,跨頁合成;見檔頭【判定小組】)
 *
 * @param {Object} o 輸入 { items:[{ key(主張 id), text, basis? }], notes(候選筆記 id), concept, contentOf, titleOf, buildPrompt(domain.buildOrphanCheckPrompt),
 *   call:(stage, seat, prompt)=>Promise<{ ok, json, providerId, stopped? }>, seats:{ first, second, third? }, pageChars? }
 * @returns {Promise<Object>} 回傳 { results:Map(key → { status:'supported'|'none'|'retry'|'held', notes:Array(補出處之筆記 id), why, detail, seats }), calls, stopped, pages }
 *   (頁放不下 → 候選筆記對半分再送;單篇仍放不下 → 該頁各項記「材料過大」,合成時為判不了;中止 → 回空結果——跨頁合成須全部頁)
 * @example
 * need test in nodejs.
 *
 * const r = await runOrphanCheck({ items: [{ key: 'C2', text: '乙' }], notes: ['n1', 'n2'], concept: '黑洞', contentOf, titleOf, buildPrompt, call, seats: { first, second, third } })
 * console.log(r.decisions, r.undecided, r.oversize)
 */
export async function runOrphanCheck(o) {
    const items = isarr(o.items) ? o.items : []
    const contentOf = isfun(o.contentOf) ? o.contentOf : () => null
    const titleOf = isfun(o.titleOf) ? o.titleOf : (nid) => nid
    const seats = isobj(o.seats) ? o.seats : {}
    const queue = packOrphanPages(isarr(o.notes) ? o.notes : [], (nid) => String(contentOf(nid) ?? '').length, Number(o.pageChars) > 0 ? Number(o.pageChars) : SUPPORT_PAGE_CHARS)
    const perItem = new Map(items.map((it) => [it.key, []])) // key → [{ d, label }](同鍵之項各頁各收一列)
    let calls = 0
    let pages = 0
    while (queue.length) {
        const page = queue.shift()
        const label = new Map(page.map((n, i) => [`S${i + 1}`, n]))
        const labels = new Set(label.keys())
        const sources = page.map((n, i) => ({ label: `S${i + 1}`, title: titleOf(n), text: contentOf(n) ?? NO_MATERIAL_TEXT }))
        const local = items.map((it, j) => ({ index: j + 1, key: it.key, it }))
        const track = { oversize: false, unset: false }
        const r = await runPanelPage({
            local,
            buildPrompt: (xs) => o.buildPrompt({ concept: o.concept, sources, items: xs.map((x) => ({ index: x.index, text: x.it.text, basis: x.it.basis || '' })) }),
            shufflePrefix: 'es8',
            stages: ['orphan1', 'orphan2', 'orphan3'],
            call: panelCallOf(o, track),
            seats,
            votesOf: (data, idx) => seatOrphanVotesOf(data, idx, labels),
            same: sameOrphan,
        })
        calls += r.calls
        pages++
        if (r.stopped) return { results: new Map(), calls, stopped: true, pages }
        if (track.oversize) {
            // 頁放不下:候選筆記對半分再送;單篇仍放不下 → 該頁各項記材料過大
            if (page.length > 1) {
                const half = Math.ceil(page.length / 2)
                queue.unshift(page.slice(0, half), page.slice(half))
                continue
            }
            for (const x of local) perItem.get(x.key).push({ d: { status: 'undetermined', why: EXTRACT_PANEL_WHY.OVERSIZE, votes: [] }, label })
            continue
        }
        for (const x of local) perItem.get(x.key).push({ d: r.byIndex.get(x.index), label })
    }
    const results = new Map()
    for (const it of items) {
        const rows = perItem.get(it.key) || []
        const sup = rows.filter((r) => r.d.status === 'decided' && r.d.verdict.verdict === 'supported')
        if (sup.length) {
            const notes = uniq(sup.flatMap((r) => agreedLabelsOf(r.d).map((l) => r.label.get(l)).filter(Boolean)))
            results.set(it.key, { status: 'supported', notes, why: '', detail: sup.map((r) => voteTextOf(r.d, { chars: 50, by: true })).join('｜'), seats: panelSeats(sup[0].d.votes) })
            continue
        }
        if (rows.length && rows.every((r) => r.d.status === 'decided' && r.d.verdict.verdict === 'none')) {
            results.set(it.key, { status: 'none', notes: [], why: '', detail: rows.map((r) => str(r.d.verdict.reason)).join('｜').slice(0, 300), seats: panelSeats(rows[0].d.votes) })
            continue
        }
        const und = rows.filter((r) => r.d.status !== 'decided')
        const retry = !rows.length || und.some((r) => r.d.why === PANEL_WHY.MISSING || r.d.why === PANEL_WHY.SAME_PROVIDER)
        results.set(it.key, { status: retry ? 'retry' : 'held', notes: [], why: retry ? (und.find((r) => r.d.why === PANEL_WHY.MISSING) ? PANEL_WHY.MISSING : PANEL_WHY.SAME_PROVIDER) : (und[0]?.d.why || PANEL_WHY.DISAGREE), detail: und.map((r) => voteTextOf(r.d, { chars: 50, by: true })).join('｜').slice(0, 300), seats: '' })
    }
    return { results, calls, stopped: false, pages }
}

export default { ES8, ORPHAN_VERDICTS, orphanCandidatesOf, orphanHashOf, orphanNeedsOf, checkOrphanVerdictOf, sameOrphan, seatOrphanVotesOf, parseOrphanChecks, checkOrphanChecks, packOrphanPages, agreedLabelsOf, runOrphanCheck }
