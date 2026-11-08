// runPass.mjs — 一次提煉 pass(3+3):3 家獨立起草 → 整合 → 審計 → 修訂 → 終審 → 程式套用
//
// 【全部走 w-dispatch-ai 既有工作流】起草用 runFanout(三席並行、同一份 task);整合、審計、修訂、終審用 callAi(單一名額＋遞補)——
//   呼叫一律經 workflow/aiCall(extractFanout、extractAiCall:截止與斷網之歸類、席位預篩、計帳與逐棒紀錄只此一份)。
//   本檔只做編排與程式處理(試套、計票、via、守門、補丁、裁決閘門、套用、不變式),不自寫調度。
//   不用 runFanoutPipeline 一條到底:整合失敗時它不跑後段、任一後段之棒失敗即中止後棒,而降級梯要求「採最近一份合格產物、續跑剩下之棒」。
// 【提示詞一律經 domain】起草、整合、審計、修訂、終審(含附錄)、整併、本質之提示詞皆為 domain 之成員(可覆寫或整組置換);本檔只組材料。
// 【程式補救】整合後 ref 依賴閉包與漏寫 @ 補回(candidates.closeRefs／normalizeBareRefs);
//   誤放 ops 之「略過」移到 skipped(parse.normalizeDelta);回傳 trace 供逐項診斷。
// 【降級梯(不損及既有狀態)】起草全敗→本 pass 失敗(筆記回待提煉);只 1 份→跳過整合;整合敗→程式聯集(保留單票者);
//   審計／修訂敗→以最後一份合格差量續跑終審;終審敗→建設性操作照套、破壞性操作(終態類與大幅 revise)存待審;
//   不變式違反→只剔除違反之操作再套(不整批丟掉 7 次呼叫之成果)。
// 【檢定標準之納入閘(standards/opStandards)】整合後之操作逐條檢定(數字紮根於本操作所引出處、標注、principle 跨篇、
//   弱證據參數、不提及筆記、流程外洩)→ 不合者列為程式意見(與超限意見同列)交修訂;補丁不得使操作新增問題;定稿(終審後)再檢,
//   仍不合者不採(終審成功與否皆然——終審失敗而照套之建設性操作亦須先過本閘)。
// 【出處支持之覆核(檢定標準 ES9;workflow/supportGate 之骨架一份,與待審裁決同取)】定稿篩選之後、套用之前,以覆核席(判定小組)判新增／確認／改寫之主張與
//   爭議各方是否受所引出處支持:成立 supported 照套;成立「語氣超出證據」(無「陳述相反」)者先依出處收斂措辭(修訂席一次)再過閘重判,
//   受支持即照套修訂後之文字(standards/supportRevise;ES7);其餘成立之裁決不採;判不了(兩票可用)不採並回報其本批筆記(呼叫端登錄待判、下次重送);
//   基礎設施之未成立(缺票、同一供應者、中止、席位未設)→ 該操作連同引用其 ref 者存待審(理由「出處支持覆核未完成」),其餘照套、不計失敗
//   (終審 §1 原則 3;整併無待審可存 → 本次不採、下次再提);材料不可得者不送審、不採、不登錄。
// 【狀態視圖】提示詞放得下就給全文;放不下時與本批相關之條目給全文、其餘只列索引行——只見索引行之條目不得改狀態(opGuards)。

import { TERMINAL_SET, findItem, unsupportedOf, liveSourcesOf, essenceNeedOf, setExcluded, TERMINAL_OPS, DEFAULT_LIMITS } from '../stores/coreState.mjs'
import { applyVerdicts, FIXABLE_FIELDS } from './verdicts.mjs'
import { coverageOf, commitBatch, queuePendingReview, opLengthProblem } from '../stores/coreDelta.mjs'
import { stateDigest, renderRules } from '../stores/stateDigest.mjs'
import { containment } from '../guards/similarity.mjs'
import { parseDraft, checkDraft, parseAudit, checkAudit, parsePatch, checkPatch, parseVerdicts, checkVerdicts, normalizeDelta } from '../standards/parse.mjs'
import { guardOps, opClass } from '../standards/opGuards.mjs'
import { createOpStandards, opStandardsCtxOf, applyCtxOf, gateOps } from '../standards/opStandards.mjs'
import { applyWithInvariants } from './applyWithInvariants.mjs'
import { runSupportGate, supportHoldClosure, SUPPORT_GATE_WHY } from './supportGate.mjs'
import { prefixCandidate, trialApply, voteOps, programUnion, validateVia, droppedMajority, applyRefAliases, stripProgramFields, normalizeBareRefs, closeRefs, refsOf } from './candidates.mjs'
import { ISSUE_TYPES, normalizeIssues, applyPatch, gateVerdicts } from './reviewGuards.mjs'
import { callerOf, extractFanout } from './aiCall.mjs'
import { textValueOf as str, jsonClone as clone } from '../core/capturePackage.mjs'
import { RECHECK_REASONS } from '../standards/recheck.mjs'
import { noteTitleFnOf } from '../stores/noteFacts.mjs'

const liveItems = (s) => [...s.claims, ...s.disputes, ...s.parameters, ...s.questions].filter((x) => !TERMINAL_SET.has(x.status) && x.status !== 'resolved')
const itemText = (x) => str(x.text) || str(x.question) || `${str(x.name)} ${str(x.value)}`

/**
 * 超限之操作 → 程式意見(交修訂縮寫):判準即 applyDelta 之拒收判準(stores/coreDelta 之 opLengthProblem 單一來源)。
 *   不先交修訂縮寫者,套用時整條被拒(如本質逾硬上限 → 新核心落得無本質)。
 *
 * @param {Array} ops 輸入操作(帶 _oid)
 * @param {Object} limits 輸入長度上限(domain.limits)
 * @returns {Array} 回傳審計意見形狀之陣列 [{ ref, severity, type, detail, fix }]
 * @example
 * console.log(lengthIssues([{ _oid: 'a1_0', op: 'essence', text: '長'.repeat(900) }, { _oid: 'a1_1', op: 'essence', text: '短' }], DEFAULT_LIMITS).length)
 * // => 1
 */
export function lengthIssues(ops, limits) {
    const lim = { ...DEFAULT_LIMITS, ...(limits && typeof limits === 'object' ? limits : {}) }
    return (Array.isArray(ops) ? ops : []).map((op) => ({ op, p: opLengthProblem(op, lim) })).filter((x) => x.p).map(({ op, p }) => ({
        ref: str(op._oid),
        severity: '高',
        type: ISSUE_TYPES.overLength,
        detail: `${p}——超過即被程式拒收`,
        fix: op.op === 'essence' ? `縮寫 text 至 ${lim.essence} 字以內(〔〕標記也計入),保留核心結論與所引主張` : '縮寫該欄至上限以內,保留原意',
    }))
}

/**
 * 新核心之本質定稿前仍超過硬上限時之最後防線:取至句界(。；！？)使其落在上限內;句界皆放不下則取至逗號,再不行硬截
 *   (退回〔之前,不切斷標記)。只在核心尚無本質時用——既有核心之本質被拒時舊本質仍在,不需截短。
 *
 * @param {String} text 輸入本質文字
 * @param {Integer} limit 輸入硬上限字數
 * @returns {String} 回傳截短後之文字(本就合格者原樣回傳)
 * @example
 * console.log(trimToLimit('甲乙。丙丁戊。', 5))
 * // => 甲乙。
 */
export function trimToLimit(text, limit) {
    const t = str(text)
    if (!limit || t.length <= limit) return t
    const head = t.slice(0, limit)
    for (const re of [/[。；！？]/g, /[，、,]/g]) {
        let cut = -1
        for (const m of head.matchAll(re)) cut = m.index
        if (cut > 0) return head.slice(0, cut + 1).replace(/[，、,]$/, '。')
    }
    const open = head.lastIndexOf('〔')
    return open > head.lastIndexOf('〕') ? head.slice(0, open) : head
}

/**
 * 狀態視圖:放得下給全文(visible＝null);放不下時依與本批之相關度挑全文條目,其餘列索引
 *
 * @param {Object} state 輸入狀態
 * @param {String} batchText 輸入本批筆記摘要全文
 * @param {Function} lenOf 輸入 (digest) => 完整提示詞長度
 * @param {Integer} budget 輸入提示詞字元上限
 * @param {Object} [opt={}] 輸入 { mustShow:Set(一律給全文之條目 id;重審所涉條目——只見索引行者不得改狀態,重審之改寫會被拒收), marks:Map(條目 id → 附註) }
 * @returns {Object} 回傳 { digest, visible:Set|null, full:Boolean }
 * @example
 * const v = stateView(emptyState(), '本批筆記摘要', (digest) => digest.length + 100, 100000)
 * console.log(v.visible)
 * // => null
 */
export function stateView(state, batchText, lenOf, budget, opt = {}) {
    const marks = opt?.marks instanceof Map ? opt.marks : undefined
    const mustShow = opt?.mustShow instanceof Set ? opt.mustShow : new Set()
    const dg = (o) => stateDigest(state, marks ? { ...o, marks } : o)
    const full = dg({})
    if (lenOf(full) <= budget) return { digest: full, visible: null, full: true }
    // 相關度＝條目文字之雙字組出現在本批筆記之比例;爭議另加 0.2(對立最需要被看見全文);mustShow 者先入(預算不足亦然)
    const scored = liveItems(state).filter((x) => !mustShow.has(x.id)).map((x) => ({ id: x.id, score: containment(itemText(x), batchText) + (str(x.id).startsWith('D') ? 0.2 : 0) }))
    scored.sort((a, b) => b.score - a.score)
    const visible = new Set(liveItems(state).filter((x) => mustShow.has(x.id)).map((x) => x.id))
    let digest = dg({ only: visible })
    for (const x of scored) {
        visible.add(x.id)
        const next = dg({ only: visible })
        if (lenOf(next) > budget) {
            visible.delete(x.id)
            break
        }
        digest = next
    }
    return { digest, visible, full: false }
}

/**
 * 規則表文字(起草、整合、審計、修訂、終審、待審裁決共用之單一來源):domain.rules＋條件規則
 *   (核心有出處已撤之條目時加入 domain.withdrawnRule 之回傳;優先序排最後,不改既有規則之編號;無此類條目或回傳 null 時不加)
 *
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} state 輸入目前狀態
 * @returns {String} 回傳編號後之規則文字
 * @example
 * console.log(rulesTextOf(createExtractDomain({}), emptyState()).split('\n')[0].slice(0, 30))
 * // => 1. 只收與本概念直接相關之知識；離題之筆記列入 skipp
 */
export function rulesTextOf(domain, state) {
    // 只對出處已撤者(隔離 held 之主張另有標示「勿引用」,由洗白守門擋引用;不改規則表,提示詞與無隔離時逐字相同)
    const un = unsupportedOf(state)
    const extra = typeof domain?.withdrawnRule === 'function' && (un.items.size > un.held.size || un.sides.size > 0) ? [domain.withdrawnRule()] : []
    return renderRules([...(domain?.rules || []), ...extra])
}

/**
 * 被操作觸及之既有條目(全文;供審計、修訂、終審與待審裁決)
 *
 * @param {Object} state 輸入目前狀態
 * @param {Array} ops 輸入操作陣列
 * @returns {String} 回傳觸及條目之狀態摘要(無則空字串)
 * @example
 * console.log(JSON.stringify(touchedText(emptyState(), [{ op: 'confirm', id: 'C9' }])))
 * // => ""
 */
export function touchedText(state, ops) {
    const ids = new Set()
    const sideClaims = (sides) => (Array.isArray(sides) ? sides.flatMap((sd) => (Array.isArray(sd?.claims) ? sd.claims : [])) : [])
    for (const op of ops) for (const k of ['id', 'into', 'by', 'dispute', 'claim']) if (str(op[k]) && !str(op[k]).startsWith('@') && findItem(state, str(op[k]))) ids.add(str(op[k]))
    for (const op of ops) for (const x of [...(Array.isArray(op.from) ? op.from : []), ...(Array.isArray(op.claims) ? op.claims : []), ...sideClaims(op.sides), ...sideClaims(op.sides_add)]) if (findItem(state, str(x))) ids.add(str(x))
    // 被觸及之爭議:其各方所引之主張一併列出全文——審計、終審據以判斷兩方是否回答同一問題、結論是否相反(存疑與拆解之依據)
    for (const id of [...ids]) for (const cid of sideClaims(findItem(state, id)?.item?.sides)) if (findItem(state, str(cid))) ids.add(str(cid))
    if (!ids.size) return ''
    // 終審存疑於審計、修訂、終審所見之觸及條目常駐(起草端之摘要只顯示至其後第一次提煉落盤)
    return stateDigest(state, { only: ids, allDoubts: true }).split('\n').filter((l) => !l.includes('（索引）')).join('\n')
}

/**
 * 一次提煉 pass
 *
 * @param {Object} o 輸入
 * @param {Object} o.state 輸入目前狀態(normalizeState 後)
 * @param {String} o.concept 輸入概念名
 * @param {String} [o.scope='concept'] 輸入 'concept'｜'category'
 * @param {Array} o.batch 輸入本批筆記 [{ code:'N1', id, digest }]
 * @param {String} [o.relations=''] 輸入關聯脈絡文字
 * @param {String} [o.mode='delta'] 輸入 'delta'(一批筆記併入)｜'consolidate'(整併:有效主張逾上限時合併重複、精簡;起草用整併提示詞,不處理筆記)｜
 *   'essence'(本質專步:有效主張而無本質或本質待重寫之核心,起草用 domain.buildEssencePrompt、只收 essence 操作,不處理筆記;檢定標準 ES6)
 * @param {Integer} [o.claimsCap] 輸入有效主張上限(整併提示詞顯示用)
 * @param {Function} [o.onCall] 輸入逐棒呼叫回來時之回呼 (entry:{ stage, ok, providerId, ms, error, promptLen, tried }) => void(生產之逐次日誌)
 * @param {Object} o.domain 輸入提煉 domain(rules、claimKinds、limits、evidence、weakEvidence 與各步之提示詞:buildProposePrompt、buildIntegratePrompt、
 *   buildAuditPrompt、buildRevisePrompt、buildReviewPrompt、buildAcceptAppendix;整併、本質另需 buildConsolidatePrompt、buildEssencePrompt)
 * @param {Object} o.seats 輸入席位 { drafters:[3], integrate, audit, revise, accept }
 * @param {Object} o.ai 輸入 AI adapter(getWkf、seatSpec、recordCall)
 * @param {Map} [o.notesById] 輸入筆記 id → 記錄(證據等級重算用;ES12 之文件 id)
 * @param {Function} [o.contentOf] 輸入 (noteId)=>出處筆記之內容(內容章＋原文標題＋發布時間;不含投影章)|null——檢定標準 ES2／ES16 之材料;
 *   未給則以本批摘要(digest)當本批筆記之內容、其餘不可得
 * @param {String} [o.at=''] 輸入時刻
 * @param {Function} [o.keyOf] 輸入概念名正規化
 * @param {Function} [o.shouldStop] 輸入截止判斷(兩棒之間檢查;到點即不開下一棒、本 pass 不套用)。給了此函數即「截止感知」:
 *   上游回預算耗盡(errorType budget)且剩餘時間不足一次嘗試、或棒回來時已到點,皆視同截止(stopped),不走降級梯——
 *   否則截止前 90 秒窗內整合／審計／終審瞬間 budget-out,起草聯集會未經審核直接落盤
 * @param {Function} [o.remainingMs] 輸入 ()=>整輪剩餘毫秒數(與 shouldStop 同源);未給視為無限(席位自帶預算之耗盡即一般失敗)
 * @param {Integer} [o.promptBudget=29000] 輸入起草提示詞之字元預算(只決定增量起草之狀態視圖給全文或索引——stateView;不依席位推導,
 *   三席共用同一份 task)。各席放不放得下以調度層之 seatSpec 依實際提示詞長度預篩遞補鏈為準(整條放不下＝oversize,不送出;workflow/aiCall)
 * @param {String} [o.integrate='llm'] 輸入整合方式:'llm'(整合員)｜'program'(程式聯集,不呼叫整合員)
 * @param {Array} [o.candidates] 輸入沿用之起草候選(前次 trace.cands;給定則不再起草——兩臂比較同一份起草用)
 * @param {Array} [o.recheck=[]] 輸入本批中之重審筆記 [{ id, reason:'changed'|'conflict'|'conflictGone'|'resend'|'relationChanged'|'conflictReason'|'partner',
 *   anchor?(核心已引之另一端筆記 id), kind?, newType?, why? }]:起草、審計、修訂、終審附重審段(domain.buildRecheckText);所涉條目一律全文;
 *   撤回與略過理由另有守門(coreState ⑯;partner 為新筆記,照一般規則)
 * @param {Object} [o.supportCheck] 輸入出處支持覆核(檢定標準 ES9){ seats:{ first, second?, third? } };未給即不覆核(每頁之字數用執行器之預設)
 * @param {Object} [o.locale] 輸入語言設定(每輪依賴之 deps.locale;操作守門之正體轉換依之,未給＝臺灣正體)
 * @param {Function} [o.log] 輸入 (line) => void
 * @returns {Promise<Object>} 回傳 { ok, state, applied, rejected, withheld, queued(實際存入待審數), coverage, overLimit, lengthChecked, calls(各棒；tried＝逐家嘗試), degrade, stats, trace(候選、整合、閉包、守門、意見、補丁、裁決、定稿之診斷軌跡),
 *   supportHolds(ES9 判不了而未納入之操作所引之本批筆記 id), view, error };失敗(ok:false)一律帶 state(輸入狀態)、calls、degrade、stats、trace
 * @example
 * need test in nodejs.
 *
 * const r = await runPass({ state, concept: '黑洞', batch: [{ code: 'N1', id: 'n-a', digest }], domain, seats, ai })
 * console.log(r.ok, r.applied)
 */
export async function runPass(o) {
    const { state, concept, batch = [], domain, seats, ai } = o
    const scope = o.scope || 'concept'
    const mode = ['consolidate', 'essence'].includes(o.mode) ? o.mode : 'delta'
    if (mode === 'essence' && typeof domain.buildEssencePrompt !== 'function') return { ok: false, error: 'domain 未提供 buildEssencePrompt（本質專步停用）', state, calls: [], degrade: [], stats: {}, trace: {} }
    const log = typeof o.log === 'function' ? o.log : () => {}
    const shouldStop = typeof o.shouldStop === 'function' ? o.shouldStop : () => false
    const at = str(o.at)
    const rulesText = rulesTextOf(domain, state)
    const calls = []
    const degrade = []
    const stats = { candidates: 0, integrated: 0, guardRejected: 0, issues: 0, stdIssues: 0, stdRejected: 0, patch: { ok: 0, blocked: 0 }, verdictBlocked: 0, closure: 0 }
    // 診斷軌跡(各棒之產物與程式處置;拒收原因須可逐項追查——候選與中間產物不留存即無從查起)
    const trace = { cands: [], integrated: null, integrateRejected: [], closure: [], guard0: null, missing: [], issues: [], patch: null, patchLog: [], verdicts: null, verdictBlocked: [], final: null, stdOut: [], invariants: [] }
    // 重審:本批中被本核心消化過、因內容更新或新判衝突而重新呈現之筆記——起草、審計、修訂、終審附重審段,
    //   所涉條目(引用該篇或衝突錨點之存活條目)一律給全文並加附註;無重審筆記時各提示詞不附重審段(與一般批同一提示詞)
    const recheck = (mode === 'delta' && Array.isArray(o.recheck) ? o.recheck : []).filter((x) => x && batch.some((b) => b.id === x.id))
    const codeById = new Map(batch.map((b) => [b.id, b.code]))
    const citedBy = (nid) => liveItems(state).filter((x) => liveSourcesOf(x, state).includes(nid)).map((x) => x.id)
    // 各理由逐一映射——不可把非 changed 一律當新判衝突(conflictGone 之意思相反);未知理由不入重審段
    const titleOf = noteTitleFnOf(o.notesById)
    const rItems = recheck.map((x) => {
        const code = codeById.get(x.id)
        const rel = { kind: x.kind, newType: str(x.newType), why: str(x.why) }
        if (x.reason === RECHECK_REASONS.changed) return { code, reason: RECHECK_REASONS.changed, citedBy: citedBy(x.id) }
        if (x.reason === RECHECK_REASONS.conflictGone) return { code, reason: RECHECK_REASONS.conflictGone, anchorTitle: titleOf(x.anchor), anchorItems: [...new Set([...citedBy(x.anchor), ...citedBy(x.id)])], ...rel }
        if (x.reason === RECHECK_REASONS.resend) return { code, reason: RECHECK_REASONS.resend } // 逾限筆記之重送(ES15):前次未交代去向,未被任何條目引用
        if (x.reason === RECHECK_REASONS.conflict) return { code, reason: RECHECK_REASONS.conflict, anchorTitle: titleOf(x.anchor), anchorItems: citedBy(x.anchor) }
        // 關聯變更之影響(ES10):經夥伴入批者之關聯已變(列引用它之條目)、衝突理由已更新(列兩端之條目)、新關聯之夥伴(列錨點之條目)
        if (x.reason === RECHECK_REASONS.relationChanged) return { code, reason: RECHECK_REASONS.relationChanged, anchorTitle: titleOf(x.anchor), citedBy: citedBy(x.id), ...rel }
        if (x.reason === RECHECK_REASONS.conflictReason) return { code, reason: RECHECK_REASONS.conflictReason, anchorTitle: titleOf(x.anchor), anchorItems: [...new Set([...citedBy(x.anchor), ...citedBy(x.id)])], ...rel }
        if (x.reason === RECHECK_REASONS.partner) return { code, reason: RECHECK_REASONS.partner, anchorTitle: titleOf(x.anchor), anchorItems: citedBy(x.anchor), ...rel }
        return null
    }).filter(Boolean)
    const mustShow = new Set(rItems.flatMap((x) => [...(x.citedBy || []), ...(x.anchorItems || [])]))
    const marks = new Map()
    // resend 無涉及之條目(不附註)
    const markOf = (x) => ({
        changed: `引用重審筆記 ${x.code}`,
        conflictGone: `涉及 ${x.code} 已撤之衝突`,
        conflict: `為 ${x.code} 之衝突對象`,
        relationChanged: `引用關聯已變更之筆記 ${x.code}`,
        conflictReason: `涉及 ${x.code} 理由已更新之衝突`,
        partner: `為新關聯筆記 ${x.code} 之對象`,
    }[x.reason] || '')
    for (const x of rItems) for (const id of [...(x.citedBy || []), ...(x.anchorItems || [])]) marks.set(id, `${marks.has(id) ? `${marks.get(id)}；` : ''}${markOf(x)}`)
    const recheckBlock = (stage) => (rItems.length && typeof domain.buildRecheckText === 'function' ? domain.buildRecheckText(rItems, { stage }) : '')
    // 重審之略過理由另收 RECHECK_SKIP_REASONS;夥伴(新筆記)照一般規則(不入 recheckIds)
    const recheckIds = recheck.filter((x) => x.reason !== RECHECK_REASONS.partner).map((x) => x.id)
    // 本質專步以整併模式套用(不需本批出處)、只收 essence
    //   套用機制(mode)與實際棒次(step)分開:本質專步以整併機制套用但不是整併(lastConsolidated 只由 consolidate 真值寫;changelog 記 step)
    const applyCtx = applyCtxOf(domain, { batch, mode: mode === 'delta' ? 'delta' : 'consolidate', consolidate: mode === 'consolidate', step: mode, ...(mode === 'essence' ? { onlyOps: ['essence'] } : {}), at, keyOf: o.keyOf, self: concept, ...(recheckIds.length ? { recheckIds } : {}) })
    const batchText = batch.map((b) => b.digest).join('\n\n')
    // 逐棒呼叫之紀錄(本 pass 之 calls 軌跡＋o.onCall 生產之逐次日誌);回呼拋錯不影響本 pass
    const noteCall = (entry) => {
        calls.push(entry)
        try {
            o.onCall?.(entry)
        }
        catch { /* 呼叫端回呼失敗不影響 */ }
    }
    // 單棒(workflow/aiCall):未送出之棒(席位未設、整條鏈放不下)本 pass 亦記一筆——每一棒之去向都在 calls 軌跡與逐棒日誌
    const ask = callerOf(ai, { shouldStop: o.shouldStop, remainingMs: o.remainingMs, onCall: noteCall })
    const call = async (stage, seat, prompt, parse, check) => {
        const r = await ask(stage, seat, prompt, parse, check)
        if (r.unset || r.oversize) noteCall({ stage, ok: false, error: r.unset ? r.error : '整條遞補鏈皆放不下此提示詞', promptLen: prompt.length })
        return r
    }

    // ── 狀態視圖與起草提示詞;整併(consolidate)之起草給完整狀態、用整併提示詞,不處理筆記 ──
    const live = state.claims.filter((c) => !TERMINAL_SET.has(c.status)).length
    const need = essenceNeedOf(state)
    const draftOf = mode === 'consolidate'
        ? (digest) => domain.buildConsolidatePrompt({ concept, scope, digest, live, cap: o.claimsCap, rulesText })
        : mode === 'essence'
            ? (digest) => domain.buildEssencePrompt({ concept, scope, digest, live, need: need.need, why: need.staleWhy, rulesText })
            : (digest) => domain.buildProposePrompt({ concept, scope, digest, batch, rulesText, relations: o.relations }) + recheckBlock('draft')
    const view = mode !== 'delta'
        ? { digest: stateDigest(state, { full: true }), visible: null, full: true }
        : stateView(state, batchText, (d) => draftOf(d).length, Number.isInteger(o.promptBudget) ? o.promptBudget : 29_000, rItems.length ? { mustShow, marks } : {})
    const task = draftOf(view.digest)
    const guard = (ops) => guardOps(ops, { state, visible: view.visible, locale: o.locale })
    // 檢定標準(逐操作):材料＝本操作所引出處之內容＋所觸及條目之全文;生產由提煉段給 contentOf(md 之內容章,不含投影章)
    const contentOf = typeof o.contentOf === 'function' ? o.contentOf : (nid) => batch.find((b) => b.id === nid)?.digest ?? null
    const std = createOpStandards(opStandardsCtxOf({ state, batch: applyCtx.batch, contentOf, notesById: o.notesById, applyCtx, domain }))
    // 守門 → 納入閘(standards/opStandards.gateOps;定稿與修訂後之重篩同一組合;ref 別名於守門後改寫)
    const gate = (ops, droppedRefs) => gateOps(ops, { guard: guardOps, state, visible: view.visible, locale: o.locale, std, droppedRefs, remap: applyRefAliases })

    // ── A1 三家獨立起草(extractFanout;不在此整合,候選交程式處理);o.candidates 給定時沿用(比較整合方式時用同一份起草) ──
    const cands = []
    if (Array.isArray(o.candidates) && o.candidates.length) {
        if (shouldStop()) return { ok: false, error: 'stopped', stopped: true, state, calls, degrade, stats, trace }
        for (const c0 of clone(o.candidates)) {
            for (const op of c0.ops || []) delete op._trial
            trialApply(state, c0.ops || [], applyCtx)
            cands.push({ seat: c0.seat, provider: c0.provider, ops: c0.ops || [], skipped: c0.skipped || [], conflicts: c0.conflicts || [] })
        }
        stats.reusedCandidates = true
    }
    else {
        const drafters = seats.drafters || []
        const fan = await extractFanout(ai, { stages: drafters.map((_, k) => `draft${k + 1}`), seats: drafters, prompt: task, parse: parseDraft, check: checkDraft, shouldStop: o.shouldStop, remainingMs: o.remainingMs, onCall: noteCall })
        if (fan.stopped) return { ok: false, error: 'stopped', stopped: true, state, calls, degrade, stats, trace }
        // 無一席送出:皆未設是設定之缺漏,有設而放不下是提示詞太長——兩種問題分開說
        if (!fan.alive) return { ok: false, error: fan.unset === drafters.length ? '起草席位未設' : '三席起草皆放不下提示詞', state, calls, degrade, stats, trace }
        for (const x of fan.results) {
            if (!x.r.ok || !x.r.json) continue
            const seat = x.k + 1
            const nd = normalizeDelta(x.r.json)
            const c = prefixCandidate(nd, seat, state)
            trialApply(state, c.ops, applyCtx)
            cands.push({ seat, provider: x.r.providerId || `seat${seat}`, ops: c.ops, skipped: c.skipped, conflicts: c.conflicts, dropped: nd.dropped })
        }
        // 三席皆歸為截止(或斷網)而未成交 → 截止(不計失敗);有成交者照常續跑(下一棒到點時由單棒之呼叫歸為截止)
        if (!cands.length && fan.cut > 0 && fan.cut === fan.alive) return { ok: false, error: 'stopped', stopped: true, state, calls, degrade, stats, trace }
    }
    stats.candidates = cands.length
    trace.cands = cands.map((c) => ({ seat: c.seat, provider: c.provider, ops: clone(c.ops), skipped: clone(c.skipped), conflicts: clone(c.conflicts || []), ...(c.dropped ? { dropped: c.dropped } : {}) }))
    if (!cands.length) return { ok: false, error: '起草全敗', state, calls, degrade, stats, trace }
    const votes = voteOps(cands)
    const byOid = new Map(cands.flatMap((c) => c.ops.map((op) => [op._oid, op])))

    // ── A2 整合(只 1 份候選則跳過;失敗則程式聯集) ──
    let integrated = []
    let skipped = []
    if (cands.length === 1) {
        integrated = cands[0].ops.filter((op) => !op._trial).map((op) => ({ ...op, _via: [op._oid], _votes: 1 }))
        skipped = cands[0].skipped
        degrade.push('只有 1 份候選：跳過整合')
    }
    else {
        // o.integrate 'program'＝不呼叫整合員、直接程式聯集(省一次呼叫)
        const useProgram = o.integrate === 'program'
        const prompt = useProgram ? '' : domain.buildIntegratePrompt({ concept, rulesText, cands, votes, digestIndex: stateDigest(state, { only: new Set() }), batchCodes: batch.map((b) => b.code) })
        const r = useProgram ? { ok: false, error: '程式整合' } : await call('integrate', seats.integrate, prompt, parseDraft, checkDraft)
        if (r.stopped) return { ok: false, error: 'stopped', stopped: true, state, calls, degrade, stats, trace }
        // 程式聯集(整合失敗、或整合者之輸出全數拒收——有候選而一條都收不進,等同整合失敗;終審 §3 D5i):略過＝各候選皆略過之筆記
        const union = (why) => {
            integrated = programUnion(cands, votes)
            const codes = batch.map((b) => b.code)
            skipped = codes.filter((c) => cands.every((cd) => cd.skipped.some((x) => str(x.note).toUpperCase() === c))).map((c) => ({ note: c, reason: cands[0].skipped.find((x) => str(x.note).toUpperCase() === c)?.reason || '無可用知識' }))
            if (why) degrade.push(`${why}：改用程式聯集`)
        }
        if (r.ok && r.json) {
            const j = normalizeDelta(r.json)
            const v = validateVia(j.ops, byOid)
            for (const x of v.rejected) log(`提煉整合拒收[${concept}]：${x.reason}`)
            trace.integrateRejected = v.rejected.map((x) => ({ op: clone(x.op), reason: x.reason }))
            if (j.dropped) trace.integrateDropped = j.dropped
            if (!v.ops.length && v.rejected.length) union('整合全數拒收')
            else {
                integrated = v.ops.map((op) => ({ ...op, _votes: Math.max(...op._via.map((x) => votes.get(x)?.votes || 1)) }))
                skipped = j.skipped
            }
        }
        else union(useProgram ? '' : `整合失敗（${str(r.error).slice(0, 80)}）`)
        stats.integrateMode = useProgram ? 'program' : 'llm'
    }
    // ref:漏寫 @ 者補回、依賴閉包(引用之新條目未被收入時以別名指回或自候選取回)
    const refNames = new Set(cands.flatMap((c) => c.ops.map((op) => str(op.ref)).filter(Boolean)))
    normalizeBareRefs(integrated, refNames)
    {
        const cl = closeRefs(integrated, cands)
        integrated = cl.ops.map((op) => (op._closure && !op._votes ? { ...op, _votes: votes.get(op._oid)?.votes || 1 } : op))
        stats.closure = cl.added.length
        trace.closure = cl.added
        for (const x of cl.added) log(`提煉 ref 閉包[${concept}]：@${x.ref}（${x.by}）${x.how}`)
    }
    integrated.forEach((op, n) => { if (!op._oid) op._oid = `i_${n + 1}` })
    stats.integrated = integrated.length
    trace.integrated = clone(integrated)

    // ── 操作守門 ──
    const g0 = guard(integrated)
    let ops = applyRefAliases(g0.ops)
    stats.guardRejected = g0.rejected.length
    trace.guard0 = { rejected: g0.rejected.map((x) => ({ oid: x.op?._oid, op: x.op?.op, reason: x.reason })), flagged: g0.flagged.map((f) => ({ oid: f.op?._oid, flag: f.flag, detail: f.detail })) }
    for (const x of g0.rejected) log(`提煉守門[${concept}]：${x.op?.op || '?'} ${x.reason}`)
    const flags = g0.flagged.map((f) => `${f.op?._oid || ''} ${f.flag}：${f.detail}`)

    // ── B1 審計(程式判得出之超限與檢定標準先列為意見,與審計意見一併交修訂)──
    let issues = []
    const lenIssues = lengthIssues(ops, domain.limits)
    for (const x of lenIssues) log(`提煉超限[${concept}]：${x.ref} ${x.detail}——交修訂縮寫`)
    const stdIssues = std.issuesOf(ops)
    stats.stdIssues = stdIssues.length
    for (const x of stdIssues) log(`提煉檢定標準[${concept}]：${x.ref} ${x.detail}——交修訂`)
    const progIssues = [...lenIssues, ...stdIssues]
    const missing = droppedMajority(cands, votes, integrated)
    trace.missing = missing.map((op) => op._oid)
    {
        const prompt = domain.buildAuditPrompt({ concept, rulesText, ops, flags, missing, touched: touchedText(state, ops), batch, relations: o.relations }) + recheckBlock('review')
        const r = await call('audit', seats.audit, prompt, parseAudit, checkAudit)
        if (r.stopped) return { ok: false, error: 'stopped', stopped: true, state, calls, degrade, stats, trace }
        if (r.ok && r.json) issues = normalizeIssues([...progIssues, ...(Array.isArray(r.json.issues) ? r.json.issues : [])])
        else {
            issues = normalizeIssues(progIssues)
            degrade.push(`審計失敗（${str(r.error).slice(0, 80)}）：${progIssues.length ? '只以程式意見（超限、檢定標準）續跑' : '無意見續跑'}`)
        }
    }
    stats.issues = issues.length
    trace.issues = issues

    // ── B2 修訂(有意見才跑;補丁＋守門) ──
    let patchLog = []
    let patchDroppedRefs = {}
    if (issues.length) {
        const prompt = domain.buildRevisePrompt({ concept, rulesText, ops, issues, fixable: FIXABLE_FIELDS, touched: touchedText(state, ops), batch }) + recheckBlock('review')
        const r = await call('revise', seats.revise, prompt, parsePatch, checkPatch)
        if (r.stopped) return { ok: false, error: 'stopped', stopped: true, state, calls, degrade, stats, trace }
        if (r.ok && r.json) {
            trace.patch = clone(r.json)
            const p = applyPatch(ops, r.json, { state, issues, guard, limits: domain.limits, problemsOf: (xs) => std.problemsOf(xs) })
            ops = applyRefAliases(normalizeBareRefs(p.ops, refNames))
            patchLog = p.log
            patchDroppedRefs = p.droppedRefs || {}
            trace.patchLog = p.log
            stats.patch.ok = p.log.filter((x) => x.ok).length
            stats.patch.blocked = p.log.filter((x) => !x.ok).length
            for (const x of p.log.filter((y) => !y.ok)) log(`提煉修訂擋下[${concept}]：${x.act} ${x.ref || ''} ${x.why}`)
        }
        else degrade.push(`修訂失敗（${str(r.error).slice(0, 80)}）：採整合後之差量`)
    }

    // ── B3 終審(逐操作裁決;剔除過閘門) ──
    const reviewOps = ops.map(stripProgramFields)
    trace.reviewOps = clone(reviewOps) // 終審所見之操作(裁決之 i 即此序;生產日誌之裁決標示據此)
    let finalDelta = { ops: reviewOps }
    let verdictInfo = { dropped: [], removed: [], droppedRefs: {}, unverdicted: [] }
    let accepted = false
    {
        const prompt = domain.buildReviewPrompt({ concept, scope, mode, ops: reviewOps, batch, touched: touchedText(state, ops), rulesText }) + domain.buildAcceptAppendix({ issues, patchLog }) + recheckBlock('review')
        const r = await call('accept', seats.accept, prompt, parseVerdicts, checkVerdicts)
        if (r.stopped) return { ok: false, error: 'stopped', stopped: true, state, calls, degrade, stats, trace }
        // 回覆合格而一條有效裁決都沒有(verdicts 空、或 i／ref 全無效)而有操作 → 等同終審失敗(終審 §3 D5i;無操作者不在此限)
        const gv = r.ok && r.json ? gateVerdicts(ops, r.json.verdicts, { state, issues }) : null
        if (gv) {
            trace.verdicts = clone(r.json.verdicts)
            trace.verdictBlocked = gv.blocked
            stats.verdictBlocked = gv.blocked.length
            for (const x of gv.blocked) log(`提煉終審擋下[${concept}]：i=${x.i} ${x.why}`)
            for (const x of gv.rejected) log(`提煉終審裁決無效[${concept}]：${x.reason}`)
        }
        if (gv && (gv.verdicts.length || !reviewOps.length)) {
            const av = applyVerdicts(finalDelta, gv.verdicts)
            const unv = new Set(av.unverdicted)
            // 不可逆操作須明列裁決;未列者視為未審、本次不套用——一般差量存待審;整併之不可逆操作不入待審
            //   (待審以一般差量裁決;整併之 merge 於待審無對應之收件路徑、split 雖在 DELTA_OPS 可收但整併之拆分須連同其整份改寫),本次不採、下次再提
            const unvTerminal = av.delta.ops.filter((x) => unv.has(x._i) && TERMINAL_OPS.includes(x.op)).length
            if (unvTerminal) log(`提煉終審[${concept}]：${unvTerminal} 項不可逆操作未得裁決，${mode === 'delta' ? '擬存待審' : '本次不採'}`)
            finalDelta = { ops: av.delta.ops.flatMap((x) => (unv.has(x._i) && TERMINAL_OPS.includes(x.op) ? (mode === 'delta' ? [{ ...x, _withhold: true }] : []) : [x])) }
            verdictInfo = { ...av, verdictRejected: [...gv.rejected, ...av.verdictRejected] }
            accepted = true
        }
        else {
            // 終審失敗(或未裁決任何操作):一般差量 → 建設性照套,破壞性(終態類與大幅 revise)存待審;整併 → 整份不套(只重組既有知識,未經終審不落地)
            finalDelta = { ops: mode === 'delta' ? reviewOps.map((x, i) => (opClass(ops[i], state) === 'destructive' ? { ...x, _withhold: true } : x)) : [] }
            if (gv) verdictInfo = { ...verdictInfo, verdictRejected: gv.rejected }
            degrade.push(`${gv ? '終審未裁決任何操作' : `終審失敗（${str(r.error).slice(0, 80)}）`}：${mode === 'delta' ? '破壞性操作存待審' : '整份不套用'}`)
        }
    }

    // ── 終審之 fix 可能改寫文字:定稿前再過操作守門(可見性、正體)與納入閘(檢定標準仍不合者不採;其 ref 記為已剔除:引用它之操作拒收時寫明根因;
    //   修訂移除之新項亦在已剔除之列)──
    {
        const g = gate(finalDelta.ops, { ...patchDroppedRefs, ...(verdictInfo.droppedRefs || {}) })
        for (const x of g.rejected.filter((y) => !y.problems)) log(`提煉守門（終審後）[${concept}]：${x.op?.op || '?'} ${x.why[0].replace(/^守門：/, '')}`)
        finalDelta.ops = g.ops
        verdictInfo = { ...verdictInfo, droppedRefs: { ...patchDroppedRefs, ...(verdictInfo.droppedRefs || {}), ...g.droppedRefs } }
        trace.stdOut = g.rejected.filter((y) => y.problems).map((x) => ({ op: x.op.op, id: str(x.op.id) || str(x.op.into) || str(x.op.ref), problems: x.why }))
        stats.stdRejected = g.stdRejected
        for (const x of trace.stdOut) log(`提煉未達檢定標準[${concept}]：${x.op}${x.id ? `〔${x.id}〕` : ''}（${x.problems.slice(0, 3).join('；')}）——不採`)
    }

    // ── 定稿前:出處支持之覆核(檢定標準 ES9;workflow/supportGate 一份;o.supportCheck＝{ seats } 且 domain 有 buildSupportCheckPrompt 時;
    //   一般差量、重審與整併——本質專步不新增斷言,不跑,數字由 ES16)。分流見 supportGate 檔頭;本段只決定去向:
    //   判不了 → 不採並回報其本批筆記(supportHolds;呼叫端登錄待判、下次重送);基礎設施未成立 → 一般差量存待審(連同引用其 ref 之操作),整併本次不採 ──
    const supportHolds = []
    // 出處排除集(⑳;受支持而兩席皆未列為支持之出處):新增出處之操作移除之;既有主張之 revise／merge 於套用後記入 srcExcluded
    let supportExclusions = []
    if (mode !== 'essence' && o.supportCheck && typeof o.supportCheck === 'object' && o.supportCheck.seats?.first && typeof domain.buildSupportCheckPrompt === 'function') {
        const sg = await runSupportGate({
            ops: finalDelta.ops, state, batch: applyCtx.batch, concept, domain, seats: { check: o.supportCheck.seats, revise: seats.revise },
            contentOf, titleOf, gate: (xs) => gate(xs, verdictInfo.droppedRefs), call, log, tag: '提煉', words: { infra: mode === 'delta' ? '存待審' : '本次不採（整併無待審可存）' },
        })
        Object.assign(stats, sg.stats)
        trace.supportOut = sg.trace.supportOut
        trace.supportRevise = sg.trace.supportRevise
        // 留待:基礎設施未成立之操作與引用其 ref 之操作(閉包)一併存待審(理由「出處支持覆核未完成」);整併無待審可存 → 本次不採
        const held = supportHoldClosure([...sg.kept.keys()], sg.withheld, refsOf)
        stats.supportWithheld = mode === 'delta' ? held.size : 0
        const mark = (op) => ({ ...op, _withhold: true, _withholdReason: SUPPORT_GATE_WHY.infra })
        finalDelta.ops = finalDelta.ops.flatMap((op) => (held.has(op) ? (mode === 'delta' ? [mark(op)] : []) : (sg.kept.has(op) ? [sg.kept.get(op)] : [])))
        supportHolds.push(...sg.undetermined.flatMap((x) => x.notes.filter((n) => batch.some((b) => b.id === n))))
        supportExclusions = sg.exclusions
        verdictInfo = { ...verdictInfo, droppedRefs: { ...(verdictInfo.droppedRefs || {}), ...sg.droppedRefs } }
    }

    // ── 定稿前:尚無本質之核心(新核心,或首版本質曾被拒者)之本質仍超過硬上限 → 截至句界(否則整條被拒、核心無本質;
    //   已有本質者被拒時舊本質仍在,不截)──
    if (!str(state.essence?.text)) {
        const limit = { ...DEFAULT_LIMITS, ...(domain.limits || {}) }.essence
        finalDelta.ops = finalDelta.ops.map((op) => {
            if (op.op !== 'essence' || !opLengthProblem(op, domain.limits)) return op
            const text = trimToLimit(op.text, limit)
            trace.essenceTrim = { from: str(op.text).length, to: text.length }
            log(`提煉本質截短[${concept}]：${str(op.text).length} → ${text.length} 字（核心尚無本質，定稿前仍逾上限 ${limit}；取至句界）`)
            return { ...op, text }
        })
    }
    trace.final = clone(finalDelta.ops)

    // ── 套用＋尾端寫入(涵蓋落帳、待審存入、出處排除集、證據重算)＋不變式(違反者逐條剔除後重套;workflow/applyWithInvariants 一份) ──
    const meta = { accepted, degrade: degrade.length }
    const finish = (ap) => {
        const queued = ap.withheld.filter((w) => w.resolved)
        const cov = coverageOf({ batch: applyCtx.batch, applied: ap.applied, skipped, dropped: verdictInfo.dropped, queued, removed: verdictInfo.removed, recheckIds: applyCtx.recheckIds })
        let after = commitBatch(ap.state, cov)
        let pendingDropped = []
        if (queued.length) {
            const q = queuePendingReview(after, queued, { at, reason: accepted ? '終審未明列裁決' : '終審失敗' })
            after = q.state
            pendingDropped = q.dropped
        }
        // 出處排除集(⑳):只對實際套用之改寫／合併(被拒者之覆核對象是未落地之文字,不得據以排除)
        let excluded = []
        if (supportExclusions.length) {
            const appliedIds = new Set(ap.applied.filter((a) => a.op === 'revise' || a.op === 'merge').map((a) => a.id))
            const ex = setExcluded(after, supportExclusions.filter((e) => appliedIds.has(e.id)).map((e) => ({ id: e.id, ids: e.ids, std: 'ES9' })), { at })
            after = ex.state
            excluded = ex.changed
        }
        if (o.notesById instanceof Map && domain.evidence?.apply) domain.evidence.apply(after, o.notesById)
        return { state: after, cov, pendingDropped, excluded }
    }
    const res = applyWithInvariants(state, finalDelta.ops, { ...applyCtx, droppedRefs: verdictInfo.droppedRefs, meta }, {
        finish,
        onDropped: (dropped, firstInv) => {
            trace.invariants = firstInv
            log(`提煉不變式[${concept}]：${firstInv.slice(0, 3).join('；')}——逐條剔除違反之操作`)
            // 被剔之操作逐條列明(op＋目標),否則「剔除 N 條」看不出是哪個取代／撤回落不了地
            for (const d of dropped) log(`提煉不變式剔除[${concept}]：${d.op}${d.id ? `〔${d.id}〕` : ''}（${d.inv}）`)
            trace.invariantDropped = dropped.map(({ raw, ...d }) => d)
            degrade.push(`不變式違反：剔除 ${dropped.length} 條（${dropped.slice(0, 3).map((d) => `${d.op}${d.id ? `〔${d.id}〕` : ''}`).join('、')}）`)
            meta.degrade = degrade.length // 剔除之降級計入本次 changelog(最終重套在此之後)
        },
    })
    if (!res.ok) return { ok: false, error: `不變式違反：${res.inv.slice(0, 3).join('；')}`, state, calls, degrade, stats, trace }
    if (res.excluded.length) {
        stats.supportExcludedClaims = res.excluded.length
        log(`提煉出處覆核[${concept}]：${res.excluded.length} 條主張之出處排除集更新（兩席皆未列為支持之出處不計證據；〔${res.excluded.slice(0, 5).join('〕〔')}〕）`)
    }
    const verdicts = { dropped: verdictInfo.dropped || [], doubted: verdictInfo.doubted || [], conflicts: verdictInfo.conflicts || [], verdictRejected: verdictInfo.verdictRejected || [], delta: verdictInfo.delta || { ops: [] } }
    // 衝突去向之宣告(檢定標準 ES5):各席起草之 conflicts 聯集;是否已處置由呼叫端以落地狀態之結構判定(standards/conflictDisposition)
    const conflictDecl = cands.flatMap((c) => c.conflicts || [])
    return { ok: true, state: res.state, applied: res.ap.applied, rejected: res.ap.rejected, withheld: res.ap.withheld, queued: res.ap.withheld.filter((w) => w.resolved).length, pendingDropped: res.pendingDropped.length, pendingDroppedOps: res.pendingDropped, coverage: res.cov, overLimit: res.ap.overLimit || 0, lengthChecked: res.ap.lengthChecked || 0, verdicts, calls, degrade, stats, trace, conflictDecl, supportHolds: [...new Set(supportHolds)], view: { full: view.full, visible: view.visible ? view.visible.size : null } }
}

export default runPass
