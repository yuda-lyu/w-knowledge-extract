// panelVotes.mjs — 提煉之各判定小組(ES9 出處支持、ES8 失撐找支持、ES14 爭議、ES11 同義)共同之讀票規則、未成立原因之分類與執行器之接法
//
// 【為何獨立成檔】各標準之裁決值、理由要件之例外與「兩票相同」之定義各異,但下列規則相同——同一規則手寫四份必然漂移,故只此一份:
//   ①單票之讀法:裁決值去頭尾空白、不分大小寫;理由之連續空白收成一格;非 unsure 之明確票,其理由須達 VERDICT_MIN_REASON 字
//     (各標準之例外——如真對立之理由可空——寫在其單票驗證)。
//   ②一席回覆之逐項票:以項編號對應(非整數者略過)、只收本席所見之項、同編號重複而兩票不同且不「相同」者作廢為缺票、同類之重複保留首票
//     (模型對同一項回兩個互相矛盾之裁決時,任取其一都是替模型做決定)。
//   ③未成立之原因是否為「未收到可用之兩票」(缺票或同一供應者):兩票皆可用而判不了是判斷之問題,轉使用者;未收到可用之兩票是額度、
//     故障或席位配置之問題,重試——全部受檢項皆如此即專步層之失敗(退避;不逐項計次、不轉待判,基礎設施之失敗不轉使用者)。
//   ④判定小組之單頁執行器(摘要套件之 runPanelPage)之呼叫:AI 調度層之呼叫包裝回 { ok, json, providerId, stopped },執行器收
//     { ok, data, providerId, stop }。轉換不包成 async 函數——呼叫之同步拋出須原樣拋出,第二席才不被呼叫(與改用前之執行順序相同)。
//     席位未設(unset)與提示詞放不下(oversize)不是模型之失敗:記入 track(呼叫端之逐頁判),票仍為缺票(骨架不變)。
//   ⑤逐頁之驅動(runPanelPages;四標準同用):某頁放不下(任一席 oversize)→ 頁內多項對半分再送(遞迴至單項);單項仍放不下 → 該項
//     「材料過大」(EXTRACT_PANEL_WHY.OVERSIZE;不是重試之對象——重送仍放不下,轉使用者);中止 → 已判之頁照回、未判之項列 undecided
//     (各專步「已判之頁照處置、未判之頁本輪不動」)。
//   ⑥未成立原因之字樣:摘要套件之 PANEL_WHY_LABELS 加本套件之兩種(材料過大、材料不可得),只經 panelWhyLabelOf 取。
//   ⑦各席之票之文字(日誌、待判之理由、覆核紀錄之細節):voteTextOf 一份。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { PANEL_WHY, PANEL_WHY_LABELS } from '../core/summarizePackage.mjs'
import { textValueOf as str, oneline } from '../core/capturePackage.mjs'

/** 本套件另有之未成立原因(摘要套件之 PANEL_WHY 以外):材料過大(單項已超過席位可容)、材料不可得 */
export const EXTRACT_PANEL_WHY = Object.freeze({ OVERSIZE: 'oversize', NO_MATERIAL: 'no-material' })

/** 未成立原因之字樣(面向使用者;摘要套件之字樣表＋本套件之兩種) */
export const EXTRACT_PANEL_WHY_LABELS = Object.freeze({ ...PANEL_WHY_LABELS, [EXTRACT_PANEL_WHY.OVERSIZE]: '材料過大（單項已超過席位可容）', [EXTRACT_PANEL_WHY.NO_MATERIAL]: '材料不可得' })

/**
 * 未成立原因之字樣(無對應者回原值;未給視為缺票)
 *
 * @param {String} [why] 輸入原因
 * @returns {String} 回傳字樣
 * @example
 * console.log(panelWhyLabelOf('oversize'), panelWhyLabelOf())
 * // => 材料過大（單項已超過席位可容） 缺票（呼叫失敗或回覆不合格）
 */
export function panelWhyLabelOf(why) {
    const k = why === undefined || why === null || why === '' ? PANEL_WHY.MISSING : String(why)
    return EXTRACT_PANEL_WHY_LABELS[k] || k
}

/** 明確票(非 unsure)之理由下限(字數;不足者為缺票,不是不確定) */
export const VERDICT_MIN_REASON = 10

/** 材料不可得時提示詞之占位字樣(只此一份;各專步於送審前即濾掉材料不可得之項,實際送出者只有待審裁決之例外——占位筆記照送) */
export const NO_MATERIAL_TEXT = '（內容不可得）'

/**
 * 判定小組各席之票之文字(檔頭⑦;日誌、待判之理由與覆核紀錄之細節同一格式):`<席>:<供應者>:<裁決>（<理由>）`,各席以「；」相接;
 *   裁決非物件者(未成立之標記等)原樣轉字串。各呼叫端之截斷與欄位為既有字樣(已見於日誌與待判),以選項保留
 *
 * @param {Object} d 輸入判定小組之單項結果(取 votes:[{ seat, provider, verdict }])
 * @param {Object} [o={}] 輸入 { chars:Integer(理由之字數上限,預設 60), oneline:Boolean(理由壓成單行並以抓取套件之 oneline 截斷;預設去頭尾空白後截字),
 *   by:Boolean(附裁決之 by 清單), bareProvider:Boolean(供應者缺時不補「?」), list:Boolean(回各席之陣列,不相接) }
 * @returns {String|Array} 回傳文字(list 時為各席之陣列)
 * @example
 * console.log(voteTextOf({ votes: [{ seat: 'first', provider: 'p', verdict: { verdict: 'same', reason: '同一件事' } }, { seat: 'second', verdict: 'missing' }] }))
 * // => first:p:same（同一件事）；second:?:missing
 */
export function voteTextOf(d, o = {}) {
    const chars = Number.isInteger(o.chars) ? o.chars : 60
    const reasonOf = (r) => (o.oneline === true ? oneline(r, chars) : str(r).slice(0, chars))
    const parts = (d?.votes || []).map((v) => {
        const cast = v.verdict && typeof v.verdict === 'object'
            ? `${v.verdict.verdict}${o.by === true && v.verdict.by?.length ? `[${v.verdict.by.join(',')}]` : ''}（${reasonOf(v.verdict.reason)}）`
            : String(v.verdict)
        return `${v.seat}:${o.bareProvider === true ? v.provider : (v.provider || '?')}:${cast}`
    })
    return o.list === true ? parts : parts.join('；')
}


/**
 * 一票之欄位(檔頭①):裁決值去頭尾空白並轉小寫、理由之連續空白收成一格
 *
 * @param {*} raw 輸入一席回覆中之一項 { verdict, reason, … }
 * @returns {Object|null} 回傳 { verdict, reason };非物件回 null(不合格＝缺票)
 * @example
 * console.log(verdictFieldsOf({ verdict: ' Same ', reason: '兩者\n談的是同一件事' }))
 * // => { verdict: 'same', reason: '兩者 談的是同一件事' }
 */
export function verdictFieldsOf(raw) {
    if (!isobj(raw)) return null
    return { verdict: str(raw.verdict).toLowerCase(), reason: String(raw.reason ?? '').replace(/\s+/g, ' ').trim() }
}

/**
 * 一席之回覆({ checks:[{ index, … }] })→ 逐項票(檔頭②):以編號對應、只收本席所見之項、同編號矛盾者作廢為缺票
 *
 * @param {*} json 輸入一席之回覆(checks 非陣列視為無項)
 * @param {Object} o 輸入 { seen:(項編號)=>Boolean(本席所見之項), voteOf:(raw, 項編號)=>票|PANEL_UNSURE|null(該標準之單票驗證),
 *   same:(a, b)=>Boolean(兩明確票是否相同;該標準之定義) }
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)
 * @example
 * let m = votesByIndexOf({ checks: [{ index: 1, v: 'a' }, { index: 1, v: 'b' }, { index: 2, v: 'a' }, { index: 9, v: 'a' }] }, { seen: (i) => i < 9, voteOf: (raw) => ({ v: raw.v }), same: (a, b) => a.v === b.v })
 * console.log([...m])
 * // => [ [ 1, null ], [ 2, { v: 'a' } ] ]
 */
export function votesByIndexOf(json, o) {
    const out = new Map()
    const bad = new Set()
    for (const it of isarr(json?.checks) ? json.checks : []) {
        // 編號須為整數(字串、小數、缺之皆略過——不以 Number() 寬鬆轉換;終審 §3 D5j)
        const i = it?.index
        if (!Number.isInteger(i) || !o.seen(i)) continue
        const v = o.voteOf(it, i)
        if (!out.has(i)) out.set(i, v)
        else if (!(out.get(i) === v || o.same(out.get(i), v))) bad.add(i)
    }
    for (const i of bad) out.set(i, null)
    return out
}

/**
 * 判定小組之結果是否為「未收到可用之兩票」(檔頭③;缺票或同一供應者——重試之對象;無結果亦然)
 *
 * @param {Object} [d] 輸入判定小組之結果(decidePanel 之產物;未給視為無結果)
 * @returns {Boolean} 回傳是否為重試之對象(成立者與「判不了」者為 false)
 * @example
 * console.log([panelRetryOf(undefined), panelRetryOf({ status: 'undetermined', why: 'same-provider' }), panelRetryOf({ status: 'undetermined', why: 'unsure' })])
 * // => [ true, true, false ]
 */
export function panelRetryOf(d) {
    return !d || (d.status !== 'decided' && (d.why === PANEL_WHY.MISSING || d.why === PANEL_WHY.SAME_PROVIDER))
}

/**
 * 判定小組執行器之呼叫(檔頭④):呼叫端之 o.call(段名, 席位, 提示詞)=>{ ok, json, providerId, stopped, unset?, oversize? } 轉成單頁執行器之
 *   { ok, data, providerId, stop }——不包成 async 函數,同步拋出原樣拋出;席位未設與放不下記入 track
 *
 * @param {Object} o 輸入呼叫端之參數物件(於每次呼叫時取 o.call)
 * @param {Object} [track] 輸入逐頁之紀錄物件(就地寫 oversize:Boolean、unset:Boolean)
 * @returns {Function} 回傳 (stage, seat, prompt) => Promise<{ ok, data, providerId, stop }>
 * @example
 * need test in nodejs.
 *
 * const track = {}
 * const call = panelCallOf({ call: async (stage, seat, prompt) => ({ ok: true, json: { checks: [] }, providerId: 'p1' }) }, track)
 * const r = await call('check1', { use: 'p1' }, prompt)
 * console.log(r.ok, r.providerId, track)
 */
export function panelCallOf(o, track) {
    return (stage, seat, prompt) => Promise.resolve(o.call(stage, seat, prompt)).then((x) => {
        if (isobj(track)) {
            if (x?.oversize === true) track.oversize = true
            if (x?.unset === true) track.unset = true
        }
        return { ok: x?.ok, data: x?.json, providerId: x?.providerId, stop: x?.stopped }
    })
}

/**
 * 逐頁之驅動(檔頭⑤):放不下之頁對半分、單項仍放不下即「材料過大」、中止即已判之頁照回
 *
 * @param {Object} o 輸入 { pages:Array(頁;各為受檢項之陣列,項須有 key), runPage:(page, track)=>Promise<{ decisions:Map, calls, stopped }>(以 panelCallOf(o, track) 呼叫 runPanelPage) }
 * @returns {Promise<Object>} 回傳 { decisions:Map(key → 裁定;材料過大者 { status:'undetermined', why:'oversize', votes:[] }), calls, stopped:Boolean, undecided:Array(key;中止而未判), oversize:Array(key) }
 * @example
 * need test in nodejs.
 *
 * const r = await runPanelPages({ pages: [[a, b]], runPage: (page, track) => runPanelPage({ …, call: panelCallOf(o, track) }) })
 * console.log(r.decisions.size, r.oversize)
 */
export async function runPanelPages(o) {
    const queue = (isarr(o?.pages) ? o.pages : []).map((p) => (isarr(p) ? p : [])).filter((p) => p.length)
    const decisions = new Map()
    const oversize = []
    let calls = 0
    while (queue.length) {
        const page = queue.shift()
        const track = { oversize: false, unset: false }
        const r = await o.runPage(page, track)
        calls += Number(r?.calls) || 0
        if (r?.stopped) return { decisions, calls, stopped: true, undecided: [...page, ...queue.flat()].map((it) => it.key), oversize }
        if (track.oversize) {
            if (page.length > 1) {
                const half = Math.ceil(page.length / 2)
                queue.unshift(page.slice(0, half), page.slice(half))
                continue
            }
            for (const it of page) {
                decisions.set(it.key, { status: 'undetermined', why: EXTRACT_PANEL_WHY.OVERSIZE, votes: [] })
                oversize.push(it.key)
            }
            continue
        }
        for (const [k, d] of r?.decisions instanceof Map ? r.decisions : []) decisions.set(k, d)
    }
    return { decisions, calls, stopped: false, undecided: [], oversize }
}

export default { VERDICT_MIN_REASON, NO_MATERIAL_TEXT, voteTextOf, EXTRACT_PANEL_WHY, EXTRACT_PANEL_WHY_LABELS, panelWhyLabelOf, verdictFieldsOf, votesByIndexOf, panelRetryOf, panelCallOf, runPanelPages }
