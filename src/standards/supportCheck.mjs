// supportCheck.mjs — 檢定標準 ES9(主張受所引出處支持;含 ES7 語氣不超出證據)之新進覆核:受檢之斷言、單票驗證、分頁、判定小組
//
// 【受檢之斷言(每操作一項,爭議之各方各一項)】add(主張文字＋條件＋期間 ← 本操作之出處)、confirm(目標主張或爭議之一方 ← 新增之出處)、
//   revise 改 text／conditions／period／basis(改寫後之主張 ← 既有存活出處＋本操作之出處)、merge 給新文字(合併稿 ← 被併各項之存活出處)、
//   dispute_add／dispute_update 之各方(立場 ← 該方之出處;只引主張者不核)、
//   contest(被列入之那一方之立場 ← 新增之出處;coreState 把 contest 之出處併入該方之方層出處,與 confirm 帶 side 同一語意)。
//   刻意不套:supersede、param_add(數字由 ES2)、retract、split(各條為原文之子集,包含率 ≥0.8,coreState ⑫)、dissolve(內容與出處全留)、essence(數字由 ES16)。
//   方之索引與 coreState 同一解析(0、"1"、"side 1"皆可;解析不同即有操作被套用卻未覆核);既有爭議之方含同差量 dispute_update 所補之方。
// 【裁決】supported｜contradicted(出處陳述相反)｜insufficient(出處未涉及或不足)｜overclaim(語氣超出證據)｜unsure;非 supported 之理由 ≥10 字,
//   不合格之票＝缺票(不是不確定)。相同＝類別相同(受支持與否;不受支持之三種原因同類,原因只作紀錄)。
// 【判準依證據性質(v2)】每項帶 basis;推論類(vocab.inferenceBasis)須斷言寫明
//   所依前提(前提為出處明載)才算受支持,其餘須出處直接陳述——類別由 domain 之提示詞依 basis 標示(不交模型判);改 basis 之 revise 亦覆核。
// 【材料】受檢項所引之出處筆記內容(contentOf;與 ES2 同一材料:內容章＋原文標題＋發布時間,不含投影章)各列一次,以 S1… 標示;
//   依字數上限分頁(項連同其出處入同頁;單項超過上限者獨佔一頁,不截斷)。
// 【判定小組】每頁交摘要套件之單頁執行器 runPanelPage(第一、二席並行,第二席項序打亂、編號不變;未成立且可成立者叫第三席,只送該些項);
//   本檔只給本標準之差異:分頁(逐頁呼叫、累計呼叫數)、提示詞之項與出處標號、一席回覆之逐項票(驗 by 須為該項所引之標號)、「相同」之定義
//   (類別)、成立受支持者之支持出處(supportBy,頁後以 byIndex 計)、打亂前綴 es9、段名 check1／check2／check3。
//   任一席截止或額度中止(stopped)→ 整個覆核中止(已判之頁之裁定照回;呼叫端本 pass 不套用)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { PANEL_UNSURE, runPanelPage } from '../core/summarizePackage.mjs'
import { codeMapOf, noteOfCode, notesOfCodes, parseSide, opSidesOf, findItem, liveSourcesOf, withdrawnOf } from '../stores/coreState.mjs'
import { replyObjectOf } from './parse.mjs'
import { VERDICT_MIN_REASON, NO_MATERIAL_TEXT, verdictFieldsOf, votesByIndexOf, panelCallOf, runPanelPages } from './panelVotes.mjs'
import { textValueOf as str, textListOf as strs, uniq } from '../core/capturePackage.mjs'

/** 標準識別(v2:判準依證據性質——推論類須寫明前提;版本變 → 存量檢核紀錄作廢重核) */
export const ES9 = Object.freeze({ std: 'ES9', v: 2 })
/** 合法裁決值 */
export const SUPPORT_VERDICTS = Object.freeze(['supported', 'contradicted', 'insufficient', 'overclaim', PANEL_UNSURE])
/** 裁決之中文(日誌與理由) */
export const SUPPORT_WORD = Object.freeze({ supported: '受出處支持', contradicted: '出處陳述相反', insufficient: '出處未涉及或不足以支持', overclaim: '語氣超出證據', unsure: '不確定' })
/** 每頁出處材料之字數上限 */
export const SUPPORT_PAGE_CHARS = 60_000
/**
 * 受檢之斷言種類(supportItemsOf 之 kind,另含存量覆核之既有主張 claim;提示詞之種類對照由 domain 依此表產生——domain 轉出同一實體,
 *   評分與逐案題組之檢核同讀)
 *
 * @type {Array}
 */
export const SUPPORT_KINDS = Object.freeze(['add', 'confirm', 'revise', 'merge', 'side', 'contest', 'claim'])

/**
 * 票之類別(判定小組之「相同」、評分與逐案測試之比對同讀):受支持(supported)與否——納入與否是二元問題;contradicted／insufficient／overclaim
 *   只是不受支持之原因(兩家皆判不受支持而原因不同,不是「判不了」);不確定為 unsure;無票為 null
 *
 * @param {*} v 輸入票(checkSupportVerdictOf 之產物)、PANEL_UNSURE 或 null
 * @returns {String|null} 回傳 'supported'｜'not'｜'unsure'｜null
 * @example
 * console.log([supportClassOf({ verdict: 'overclaim' }), supportClassOf('unsure'), supportClassOf(null)])
 * // => [ 'not', 'unsure', null ]
 */
export function supportClassOf(v) {
    if (v === PANEL_UNSURE || v?.verdict === PANEL_UNSURE) return PANEL_UNSURE
    if (v?.verdict === 'supported') return 'supported'
    return v ? 'not' : null
}
// 兩票皆須為明確之票(物件)——'unsure' 不屬任何類別(否則同一席對同一項回 unsure 與 insufficient 兩次會被當成一致)
const sameSupport = (a, b) => isobj(a) && isobj(b) && supportClassOf(a) === supportClassOf(b)

/**
 * 主張之受檢文字(文字＋條件＋期間——條件與期間是斷言之範圍,須一併受出處支持)
 *
 * @param {Object} c 輸入主張(或 add 操作)
 * @returns {String} 回傳文字
 * @example
 * console.log(claimAssertion({ text: '盤內緣溫度可達百萬度', conditions: ['穩定吸積'], period: '2020～2024' }))
 * // => 盤內緣溫度可達百萬度（條件：穩定吸積）（期間：2020～2024）
 */
export function claimAssertion(c) {
    const conds = strs(c?.conditions)
    const period = str(c?.period)
    return `${str(c?.text)}${conds.length ? `（條件：${conds.join('；')}）` : ''}${period ? `（期間：${period}）` : ''}`
}

const sideAssertion = (sd) => {
    const conds = strs(sd?.conditions)
    return `${str(sd?.position)}${conds.length ? `（條件：${conds.join('；')}）` : ''}`
}


/**
 * 受檢之斷言
 *
 * @param {Array} ops 輸入定稿之操作
 * @param {Object} ctx 輸入 { state, batch:[{ code, id }] }
 * @returns {Array} 回傳 [{ key, op, kind:'add'|'confirm'|'revise'|'merge'|'side'|'contest', text, basis(證據性質;判準依推論類與否), notes:Array(筆記 id) }]
 *   (無文字或無出處者不列)
 * @example
 * const ops = [{ op: 'add', kind: 'rule', text: '甲', sources: ['N1'] }, { op: 'add', kind: 'rule', text: '', sources: ['N1'] }]
 * console.log(supportItemsOf(ops, { state: emptyState(), batch: [{ code: 'N1', id: 'n-a' }] }).map((it) => [it.kind, it.text, it.notes]))
 * // => [ [ 'add', '甲', [ 'n-a' ] ] ]
 */
export function supportItemsOf(ops, ctx = {}) {
    const state = ctx.state
    const W = withdrawnOf(state)
    const codeMap = codeMapOf(ctx.batch)
    const list = (isarr(ops) ? ops : []).filter(isobj)
    const refOps = new Map(list.filter((op) => str(op.ref)).map((op) => [str(op.ref), op]))
    // 目標:既有條目(findItem)或同差量以 @ref 新建者(add → 主張;dispute_add → 爭議)
    const targetOf = (id) => {
        const s = str(id)
        if (s.startsWith('@')) {
            const r = refOps.get(s.slice(1))
            if (r?.op === 'add') return { key: 'claims', item: r }
            if (r?.op === 'dispute_add') return { key: 'disputes', item: { sides: opSidesOf(r) } }
            return null
        }
        return state ? findItem(state, s) : null
    }
    const addedSides = new Map()
    for (const op of list) if (op.op === 'dispute_update' && isarr(op.sides_add)) addedSides.set(str(op.id), [...(addedSides.get(str(op.id)) || []), ...op.sides_add])
    // 爭議之某一方(confirm 帶 side、contest 用):既有爭議含同差量所補之方
    const sideOf = (id, side) => {
        const t = targetOf(id)
        const k = parseSide(side)
        if (t?.key !== 'disputes' || k === null) return null
        return [...(t.item.sides || []), ...(str(id).startsWith('@') ? [] : addedSides.get(str(id)) || [])][k] || null
    }
    const out = []
    // head＝斷言之主體(主張文字或立場);主體為空者是結構不合格之操作(coreState 以「缺 text」「有一方缺立場」拒收)——不覆核,
    //   否則把結構錯誤誤判為「出處支持判不了」並登錄待判(如空立場之爭議方只剩條件文字)
    const push = (op, p, sub, kind, head, text, notes, basis) => {
        const ns = uniq(notes)
        if (!str(head) || !ns.length) return
        out.push({ key: `${p}${sub}`, op, kind, text, basis: str(basis), notes: ns })
    }
    // 改寫之欄位:文字、條件、期間改變斷言之範圍(claimAssertion);證據性質改變判準(推論類與否)——皆須覆核
    const REVISE_KEYS = ['text', 'conditions', 'period', 'basis']
    list.forEach((op, p) => {
        if (op.op === 'add') push(op, p, '', 'add', op.text, claimAssertion(op), notesOfCodes(codeMap, op.sources), op.basis)
        else if (op.op === 'confirm') {
            const t = targetOf(op.id)
            if (t?.key === 'claims') push(op, p, '', 'confirm', t.item.text, claimAssertion(t.item), notesOfCodes(codeMap, op.sources), t.item.basis)
            else {
                const sd = sideOf(op.id, op.side)
                if (sd) push(op, p, '', 'confirm', sd.position, sideAssertion(sd), notesOfCodes(codeMap, op.sources), sd.basis)
            }
        }
        else if (op.op === 'revise' && isobj(op.fields) && REVISE_KEYS.some((k) => op.fields[k] !== undefined)) {
            // 改文字、條件、期間或證據性質皆一併覆核(條件與期間改變亦改變斷言之範圍;basis 決定判準)
            const h = state ? findItem(state, str(op.id)) : null
            if (h?.key === 'claims') {
                const merged = { ...h.item, ...Object.fromEntries(REVISE_KEYS.filter((k) => op.fields[k] !== undefined).map((k) => [k, op.fields[k]])) }
                push(op, p, '', 'revise', merged.text, claimAssertion(merged), [...liveSourcesOf(h.item, state, W), ...notesOfCodes(codeMap, op.sources)], merged.basis)
            }
        }
        else if (op.op === 'merge' && str(op.text)) {
            // 整併之合併給新文字:合併稿須受被併各項之存活出處支持(整併亦可改寫斷言);證據性質沿用合併目標之條
            const into = state ? findItem(state, str(op.into)) : null
            if (into?.key === 'claims') {
                const froms = strs(op.from).map((id) => findItem(state, id)).filter((h) => h?.key === 'claims')
                push(op, p, '', 'merge', op.text, claimAssertion({ ...into.item, text: op.text }), [...liveSourcesOf(into.item, state, W), ...froms.flatMap((h) => liveSourcesOf(h.item, state, W))], into.item.basis)
            }
        }
        else if (op.op === 'dispute_add' || op.op === 'dispute_update') opSidesOf(op).forEach((sd, k) => push(op, p, `:side${k}`, 'side', sd?.position, sideAssertion(sd), notesOfCodes(codeMap, sd?.sources), sd?.basis))
        else if (op.op === 'contest') {
            const sd = sideOf(op.dispute, op.side)
            if (sd) push(op, p, '', 'contest', sd.position, sideAssertion(sd), notesOfCodes(codeMap, op.sources), sd.basis)
        }
    })
    return out
}

/**
 * 單票驗證
 *
 * @param {*} raw 輸入 { verdict, by?(supported 時支持之出處標號), reason }
 * @param {Set} [labels] 輸入本項所引之出處標號(S1…;給了即驗 by 須為其中者)
 * @returns {Object|String|null} 回傳 { verdict, reason, by?(supported:標號陣列,null＝未分別) }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * console.log(checkSupportVerdictOf({ verdict: 'supported', by: ['S1'], reason: 'S1 明載盤內緣溫度數據' }, new Set(['S1'])), checkSupportVerdictOf({ verdict: 'supported', by: ['S9'], reason: 'S9 明載盤內緣溫度數據' }, new Set(['S1'])))
 * // => { verdict: 'supported', reason: 'S1 明載盤內緣溫度數據', by: [ 'S1' ] } null
 */
export function checkSupportVerdictOf(raw, labels) {
    const f = verdictFieldsOf(raw)
    if (!f) return null
    const { verdict: v, reason } = f
    if (v === PANEL_UNSURE) return PANEL_UNSURE
    if (v === 'supported') {
        // 支持之出處(by;⑳ 出處排除集之依據):未給或空＝未分別(視為皆支持,不排除);給了須至少一個為本項所引(非本項所引者略去),皆非 → 缺票
        if (raw.by === undefined || raw.by === null || (isarr(raw.by) && !raw.by.length)) return { verdict: v, reason, by: null }
        const by = uniq((isarr(raw.by) ? raw.by : [raw.by]).map((x) => str(x).toUpperCase()).filter((x) => x && (!(labels instanceof Set) || labels.has(x))))
        return by.length ? { verdict: v, reason, by } : null
    }
    if (['contradicted', 'insufficient', 'overclaim'].includes(v)) return reason.length >= VERDICT_MIN_REASON ? { verdict: v, reason } : null
    return null
}

/**
 * 一席之回覆({ checks:[{ index, verdict, by?, reason }] })→ 逐項票(讀法見 panelVotes 之 votesByIndexOf);同編號矛盾者作廢為缺票
 *
 * @param {*} json 輸入 parseSupportChecks 之產物
 * @param {Set} [indices] 輸入本席所見之項編號(未給不限)
 * @param {Map} [labelsOf] 輸入 Map(項編號 → Set(該項所引之出處標號);給了即驗 by)
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)
 * @example
 * const json = { checks: [{ index: 1, verdict: 'supported', by: ['S1'], reason: 'S1 明載盤內緣溫度數據' }] }
 * console.log(seatSupportVotesOf(json, new Set([1]), new Map([[1, new Set(['S1'])]])))
 * // => Map(1) {
 * //   1 => { verdict: 'supported', reason: 'S1 明載盤內緣溫度數據', by: [ 'S1' ] }
 * // }
 */
export function seatSupportVotesOf(json, indices, labelsOf) {
    return votesByIndexOf(json, {
        seen: (i) => !(indices instanceof Set) || indices.has(i),
        voteOf: (it, i) => checkSupportVerdictOf(it, labelsOf instanceof Map ? labelsOf.get(i) : undefined),
        same: sameSupport,
    })
}

/**
 * 覆核席之形狀檢查(出處支持覆核;交 w-dispatch-ai 之 check):須有 checks 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkSupportChecks({ checks: [] }), checkSupportChecks({ fixes: [] }))
 * // => true false
 */
export const checkSupportChecks = (j) => !!j && isarr(j.checks)

/**
 * 覆核席之解析(出處支持覆核;交 w-dispatch-ai 之 parse;取最後一個過 checkSupportChecks 者)
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 checks 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseSupportChecks('{"checks":[{"index":1,"verdict":"supported","by":["S1"],"reason":"S1 明載"}]}').checks.length, parseSupportChecks('x'))
 * // => 1 null
 */
export const parseSupportChecks = (s) => replyObjectOf(s, ['checks'], checkSupportChecks)

/**
 * 覆核席之呼叫(綁 parseSupportChecks／checkSupportChecks;新進之閘與存量覆核同一份):(棒, 席, 提示詞) → 呼叫包裝之結果
 *
 * @param {Function} call 輸入呼叫包裝 (stage, seat, prompt, parse, check) => 結果(workflow/aiCall 之 callerOf 之產物或同形者)
 * @returns {Function} 回傳 (stage, seat, prompt) => 結果
 * @example
 * need test in nodejs.
 *
 * const check = supportCheckCallOf(call)
 * const res = await check('check1', seat, prompt)
 */
export function supportCheckCallOf(call) {
    return (stage, seat, prompt) => call(stage, seat, prompt, parseSupportChecks, checkSupportChecks)
}

/**
 * 分頁:項依序放入,頁內出處材料(去重)之字數逾上限即開新頁;單項超過上限者獨佔一頁
 *
 * @param {Array} items 輸入受檢項
 * @param {Function} sizeOf 輸入 (筆記 id)=>字數
 * @param {Integer} cap 輸入每頁上限
 * @returns {Array} 回傳頁陣列
 * @example
 * const items = [{ key: 'a', notes: ['n1'] }, { key: 'b', notes: ['n2'] }, { key: 'c', notes: ['n3'] }]
 * console.log(packSupportPages(items, () => 400, 1000).map((p) => p.map((it) => it.key)))
 * // => [ [ 'a', 'b' ], [ 'c' ] ]
 */
export function packSupportPages(items, sizeOf, cap) {
    const pages = []
    let cur = []
    let seen = new Set()
    let size = 0
    for (const it of isarr(items) ? items : []) {
        const add = it.notes.filter((n) => !seen.has(n)).reduce((a, n) => a + (Number(sizeOf(n)) || 0), 0)
        if (cur.length && size + add > cap) {
            pages.push(cur)
            cur = []
            seen = new Set()
            size = 0
        }
        cur.push(it)
        for (const n of it.notes) {
            if (!seen.has(n)) {
                seen.add(n)
                size += Number(sizeOf(n)) || 0
            }
        }
    }
    if (cur.length) pages.push(cur)
    return pages
}

/**
 * 出處支持之覆核(判定小組;每頁交 runPanelPage,見檔頭【判定小組】)
 *
 * @param {Object} o 輸入 { items(supportItemsOf), concept, contentOf:(nid)=>String|null, titleOf:(nid)=>String, buildPrompt:(p)=>String(domain.buildSupportCheckPrompt),
 *   call:(stage, seat, prompt)=>Promise<{ ok, json, providerId, stopped? }>, seats:{ first, second, third? }, pageChars? }
 * @returns {Promise<Object>} 回傳 { decisions:Map(key → decidePanel 之結果＋votes＋supportBy(成立受支持時:成對兩票所列支持出處之聯集〔筆記 id〕;
 *   任一票未分別 → null);材料過大者 { status:'undetermined', why:'oversize' }), calls, stopped, undecided:Array(key;中止而未判), oversize:Array(key) }
 *   (中止時 decisions 只含已判之頁;放不下之頁對半分再送——standards/panelVotes 之 runPanelPages)
 * @example
 * need test in nodejs.
 *
 * const r = await runSupportCheck({ items, concept: '黑洞', contentOf, titleOf, buildPrompt, call, seats: { first, second, third } })
 * console.log(r.decisions, r.undecided, r.oversize)
 */
export async function runSupportCheck(o) {
    const items = isarr(o.items) ? o.items : []
    const contentOf = isfun(o.contentOf) ? o.contentOf : () => null
    const titleOf = isfun(o.titleOf) ? o.titleOf : (nid) => nid
    const seats = isobj(o.seats) ? o.seats : {}
    const pages = packSupportPages(items, (nid) => String(contentOf(nid) ?? '').length, Number(o.pageChars) > 0 ? Number(o.pageChars) : SUPPORT_PAGE_CHARS)
    return runPanelPages({
        pages,
        runPage: async (page, track) => {
            const notes = uniq(page.flatMap((it) => it.notes))
            const label = new Map(notes.map((n, i) => [n, `S${i + 1}`]))
            const sources = notes.map((n) => ({ label: label.get(n), title: titleOf(n), text: contentOf(n) ?? NO_MATERIAL_TEXT }))
            const local = page.map((it, j) => ({ index: j + 1, key: it.key, it }))
            // 各項所引之出處標號(驗 by)與標號 → 筆記 id
            const labelsOf = new Map(local.map((x) => [x.index, new Set(x.it.notes.map((n) => label.get(n)))]))
            const noteOfLabel = new Map([...label].map(([n, l]) => [l, n]))
            const r = await runPanelPage({
                local,
                buildPrompt: (xs) => o.buildPrompt({ concept: o.concept, sources, items: xs.map((x) => ({ index: x.index, kind: x.it.kind, text: x.it.text, basis: x.it.basis || '', labels: x.it.notes.map((n) => label.get(n)) })) }),
                shufflePrefix: 'es9',
                stages: ['check1', 'check2', 'check3'],
                call: panelCallOf(o, track),
                seats,
                votesOf: (data, idx) => seatSupportVotesOf(data, idx, labelsOf),
                same: sameSupport,
            })
            const decisions = new Map()
            for (const x of local) {
                const d = r.byIndex.get(x.index)
                if (!d) continue
                // 支持之出處:成立受支持時,成對兩票所列之聯集(兩席皆未列者才排除——排除是刪減證據,須兩席一致);任一票未分別 → null(不排除)
                if (d.status === 'decided' && d.verdict?.verdict === 'supported') {
                    const pair = d.votes.filter((v) => (d.seats || []).includes(v.seat) && isobj(v.verdict))
                    d.supportBy = pair.length >= 2 && pair.every((v) => isarr(v.verdict.by)) ? uniq(pair.flatMap((v) => v.verdict.by).map((l) => noteOfLabel.get(l)).filter(Boolean)) : null
                }
                decisions.set(x.key, d)
            }
            return { decisions, calls: r.calls, stopped: r.stopped }
        },
    })
}

/**
 * 受支持之判定對操作與出處排除集之效果(⑳;不支持之出處衍生排除集):成立受支持而兩席皆未列為支持之出處——
 *   新增出處之操作(add、confirm、contest、爭議之方)→ 自該操作之出處移除(不把不支持之出處加上去);
 *   既有主張之改寫(revise)與合併(merge)→ 該主張之出處排除集＝本次未列者(以新結果取代;皆列 → 清空)。
 *   supportBy 為 null(有票未分別)者不動。
 *
 * @param {Array} items 輸入 supportItemsOf 之受檢項
 * @param {Map} decisions 輸入 runSupportCheck 之 decisions
 * @param {Object} ctx 輸入 { batch:[{ code, id }] }
 * @returns {Object} 回傳 { patched:Map(原操作 → 移除出處後之操作), exclusions:Array({ id(主張 id), ids:Array(筆記 id), op }), dropped:Integer(移除之出處數) }
 * @example
 * need test in nodejs.
 *
 * const effects = supportByEffects(items, decisions, { batch })
 */
export function supportByEffects(items, decisions, ctx = {}) {
    const codeMap = codeMapOf(ctx.batch)
    const noteOf = (x) => noteOfCode(codeMap, x)
    const patched = new Map()
    const exclusions = []
    let dropped = 0
    const without = (list, drop) => {
        const before = isarr(list) ? list : []
        const after = before.filter((x) => !drop.has(noteOf(x)))
        dropped += before.length - after.length
        return after
    }
    for (const it of isarr(items) ? items : []) {
        const d = decisions instanceof Map ? decisions.get(it.key) : null
        if (d?.status !== 'decided' || d.verdict?.verdict !== 'supported' || !isarr(d.supportBy)) continue
        const by = new Set(d.supportBy)
        const drop = new Set(it.notes.filter((n) => !by.has(n)))
        if (it.kind === 'revise' || it.kind === 'merge') {
            exclusions.push({ id: str(it.kind === 'revise' ? it.op?.id : it.op?.into), ids: [...drop], op: it.op })
            continue
        }
        if (!drop.size) continue
        const op = patched.get(it.op) || it.op
        if (it.kind === 'side') {
            const k = Number(String(it.key).split(':side')[1])
            const n0 = isarr(op.sides) ? op.sides.length : 0
            const field = k < n0 ? 'sides' : 'sides_add'
            const j = k < n0 ? k : k - n0
            const arr = isarr(op[field]) ? [...op[field]] : []
            if (isobj(arr[j])) arr[j] = { ...arr[j], sources: without(arr[j].sources, drop) }
            patched.set(it.op, { ...op, [field]: arr })
        }
        else patched.set(it.op, { ...op, sources: without(op.sources, drop) })
    }
    return { patched, exclusions, dropped }
}

export default { ES9, SUPPORT_VERDICTS, SUPPORT_WORD, SUPPORT_PAGE_CHARS, SUPPORT_KINDS, supportClassOf, claimAssertion, supportItemsOf, checkSupportVerdictOf, seatSupportVotesOf, parseSupportChecks, supportCheckCallOf, checkSupportChecks, packSupportPages, runSupportCheck, supportByEffects }
