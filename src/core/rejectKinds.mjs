// rejectKinds.mjs — 拒收／擋下／剔除／存疑之型別碼(單一來源):判定分支之穩定識別,日誌行與執行摘要(run.json)之 detail 皆取自此處
//
// 【為何有這個檔】提煉之拒收類判定散在各層(整合驗證、操作守門、修訂補丁、終審剔除與存疑、套用差量),原本只留人讀之理由字串(含編號與數字,字面一改即失準);
//   巡檢要計數與立判準,不能靠正則從理由字串解回。本檔給每個判定分支一個穩定之型別碼(kebab-case),
//   ①日誌行於理由前(或概念名後)插入 〔碼〕、②detail 之 `<By 鍵>` 記 { 碼: 計數 }、③本常數列全集——三處同一來源,測試以匯出值比對。
// 【六個分組】分組＝判定所在之關卡;每組對應一條 INFO 行與 detail 之一個 By 鍵,其各鍵計數和等於該組既有之總數(`total`):
//   opsRejected 套用差量時之拒收(applyDelta;detail.opsRejected)、integrateRejected 整合輸出之驗證拒收(validateVia;detail.integrateRejected,本檔新增之總數)、
//   guard 操作守門(guardOps;detail.guardRejected)、reviseBlocked 修訂補丁被擋(applyPatch;detail.patchBlocked)、
//   acceptDropped 終審剔除(applyVerdicts;detail.opsDropped)、doubted 終審存疑(detail.opsDoubted)。
// 【碼只在組內唯一】同一概念在不同關卡可同名(如終審剔除與存疑之 same-doc);一個碼之意義由「所在之行」與 By 鍵決定。
// 【新增判定分支必先登記】分支以碼標記,碼不在其組之清單即歸 unclassified(安全網:出現即表示有分支漏標,測試掃描每個分支之碼皆在清單)。
// 【層】core/(最低層):不引用其他層;理由字串→碼之對照(終審剔除與存疑之理由為封閉列舉)以字面寫在此,測試以 workflow/verdicts 之列舉核對。

/** 未歸類之安全網碼(任一組皆收):碼未登記或分支漏標時歸入,使計數和仍等於總數、缺漏看得見 */
export const UNCLASSIFIED_KIND = 'unclassified'

/**
 * 各組之型別碼清單(碼 → 一句說明):分組鍵見 REJECT_GROUPS
 *
 * @type {Object}
 */
export const REJECT_KINDS = Object.freeze({
    // 套用差量(stores/coreDelta.applyDelta)之拒收:依判定順序列(操作層 → 目標解析 → 欄位 → 各操作專屬)
    opsRejected: Object.freeze({
        'op-not-in-pass': '本 pass 只收特定操作,收到其他操作',
        'op-not-in-mode': '增量或整併模式不可用該操作',
        'op-unknown': '未知操作',
        'ref-duplicate': '同差量之 ref 重複宣告',
        'state-op-multiple': '同一既有項目有多個改狀態操作',
        'state-op-confirm-vs-terminal': '同一既有項目同時被確認與取代／撤回',
        'launder-source-withdrawn': '引用出處已撤(筆記已刪除)之條目(洗白守門)',
        'launder-source-held': '引用出處支持未能判定、已隔離待判之條目(洗白守門)',
        'recheck-retract-has-other-sources': '重審批內以「無出處支持」撤回仍有他篇出處之條目',
        'ref-undefined': '引用之 @ref 未於本差量定義',
        'dependency-rejected': '所依之同差量新項已被終審剔除或拒收',
        'item-not-found': '引用或目標之既有項目不存在',
        'target-kind-mismatch': '引用或目標之項目種類不符',
        'target-terminal': '目標已為終態(撤回、取代)',
        'target-not-open': '目標之爭議或問題已非未解決',
        'kind-not-allowed': '主張種類不在許可清單',
        'missing-field': '缺必要欄位',
        'no-batch-source': '操作無本批出處',
        'text-too-long': '文字欄逾長度硬上限(2 倍)或合併稿逾上限',
        'essence-too-long': '本質逾硬上限',
        'dangling-text-ref': '文字中之引用懸空(〔id〕不存在或〔@ref〕未定義)',
        'revise-no-editable-field': 'revise 無可改之欄位',
        'required-field-emptied': '必要欄位不可改為空',
        'side-invalid': '爭議之 side 不存在或未給',
        'retract-reason-invalid': '撤回理由不在許可清單',
        'retract-duplicate-needs-into': '理由「重複」未帶有效之 into(存活之同種類項)',
        'supersede-by-self': '取代者不可為自身',
        'contest-needs-dispute': 'contest 未連既有或同差量新建之爭議',
        'dispute-sides-too-few': '新立爭議少於兩方',
        'dispute-side-no-position': '爭議有一方缺立場',
        'dispute-side-no-source': '爭議有一方無本批出處亦無所引主張',
        'dispute-status-invalid': '爭議之 status 非 open 或 resolved',
        'same-doc-pair': '同篇正反不成爭議(含併後之同篇成對)',
        'essence-duplicate': '同一差量有多個 essence',
        'essence-claims-required': 'essence 未引任何主張',
        'merge-invalid-from': 'merge 之 from 為空或含 into',
        'merge-text-overwrite': '合併稿未保有被併項過半內容',
        'merge-dispute-clash': '合併會使爭議之不同方指向同一主張',
        'split-parts-invalid': 'split 之 parts 不在 2～8 條',
        'split-part-not-subset': 'split 之某條不是原文之子集',
        'split-coverage-low': 'split 各條合起來未涵蓋原文',
        'refacet-invalid': 'refacet 缺 from 或 to,或兩者相同',
        'refacet-no-match': 'refacet 無對應面向之主張',
        'dissolve-side-unconvertible': '爭議拆解時某方無法轉為主張',
        [UNCLASSIFIED_KIND]: '未歸類(安全網:出現即表示有分支漏標)',
    }),
    // 整合輸出之驗證拒收(workflow/candidates.validateVia):依判式次序
    integrateRejected: Object.freeze({
        'via-missing': 'via 未指回任何候選操作(整合不可新增候選沒有之操作)',
        'op-type-changed': '操作種類與所引候選不同(整合不可改變操作種類)',
        'target-mismatch': '操作之目標與所引候選不同(整合不可改變目標)',
        'source-not-in-candidates': '出處不在所引候選之出處內',
        'text-diverged': '文字與所引候選差異過大(整合不可改寫成候選沒有之內容)',
        [UNCLASSIFIED_KIND]: '未歸類(安全網)',
    }),
    // 操作守門(standards/opGuards.guardOps)之拒收
    guard: Object.freeze({
        'target-not-in-prompt': '目標只見索引行、未於提示詞附全文(只見索引行之條目不可改狀態)',
        [UNCLASSIFIED_KIND]: '未歸類(安全網)',
    }),
    // 修訂補丁(workflow/reviewGuards.applyPatch)被擋
    reviseBlocked: Object.freeze({
        'op-not-found': '補丁指向之操作找不到',
        'removal-dispute-not-offtopic': '爭議類操作之移除理由不是「離題」(假爭議不是移除理由)',
        'severity-too-low': '建設性操作以中低嚴重度之意見移除(只准重複或高嚴重度之離題／捏造)',
        'no-editable-field': '改寫不含該操作之可改欄位',
        'text-overwrite': '改寫文字未保有原文過半',
        'guard-rejected': '改寫或新增之操作過不了操作守門',
        'over-limit': '補丁使本條超限(套用時必被拒收)',
        'new-standard-issue': '補丁使本條新增檢定標準問題',
        'add-op-missing': '補丁新增缺 op',
        'add-needs-issue': '補丁新增未對應任何審計意見',
        'add-standard-issue': '補丁新增之操作未達檢定標準',
        [UNCLASSIFIED_KIND]: '未歸類(安全網)',
    }),
    // 終審剔除(workflow/verdicts.applyVerdicts 之 dropped)依其理由
    acceptDropped: Object.freeze({
        'off-topic': '離題',
        'no-source-support': '無出處支持',
        'same-doc': '同篇',
        'duplicate': '重複',
        'mislabeled': '性質標錯',
        'fabricated': '捏造',
        'opposition-holds': '對立成立(拆解操作被剔除＝保留爭議)',
        [UNCLASSIFIED_KIND]: '未歸類(安全網)',
    }),
    // 終審存疑(爭議類操作;workflow/verdicts.applyVerdicts 之 doubted)依其理由
    doubted: Object.freeze({
        'not-opposed': '非對立',
        'same-doc': '同篇',
        [UNCLASSIFIED_KIND]: '未歸類(安全網)',
    }),
})

/**
 * 各組之中繼:detail 之 By 鍵(`by`)、其和應等於之既有總數鍵(`total`)、對應之 INFO 行前綴(`line`;日誌字樣之一部分,未改)
 *
 * @type {Object}
 */
export const REJECT_GROUPS = Object.freeze({
    opsRejected: Object.freeze({ by: 'opsRejectedBy', total: 'opsRejected', line: '提煉拒收' }),
    integrateRejected: Object.freeze({ by: 'integrateRejectedBy', total: 'integrateRejected', line: '提煉整合拒收' }),
    guard: Object.freeze({ by: 'guardBy', total: 'guardRejected', line: '提煉守門' }),
    reviseBlocked: Object.freeze({ by: 'reviseBlockedBy', total: 'patchBlocked', line: '提煉修訂擋下' }),
    acceptDropped: Object.freeze({ by: 'acceptDroppedBy', total: 'opsDropped', line: '提煉終審剔除' }),
    doubted: Object.freeze({ by: 'doubtedBy', total: 'opsDoubted', line: '提煉終審存疑' }),
})

/**
 * detail 中之 By 鍵(六個;值為 { 碼: 計數 };初值 {})
 *
 * @type {Array}
 */
export const REJECT_BY_KEYS = Object.freeze(Object.values(REJECT_GROUPS).map((g) => g.by))

/**
 * 終審剔除之理由(封閉列舉)→ acceptDropped 之碼(workflow/verdicts 之 DROP_REASONS 與 DISSOLVE_DROP_REASONS 之全集;測試核對)
 *
 * @type {Object}
 */
export const DROP_REASON_KINDS = Object.freeze({ 離題: 'off-topic', 無出處支持: 'no-source-support', 同篇: 'same-doc', 重複: 'duplicate', 性質標錯: 'mislabeled', 捏造: 'fabricated', 對立成立: 'opposition-holds' })

/**
 * 終審存疑之理由(封閉列舉)→ doubted 之碼(workflow/verdicts 之 DOUBT_REASONS;測試核對)
 *
 * @type {Object}
 */
export const DOUBT_REASON_KINDS = Object.freeze({ 非對立: 'not-opposed', 同篇: 'same-doc' })

/**
 * 日誌行中型別碼標記之正則(全域;group 1 為碼):碼為小寫 kebab-case,與條目編號之標記〔C1〕〔D2〕(含大寫與數字)不相混
 *
 * @type {RegExp}
 */
export const REJECT_TAG_RE = /〔([a-z]+(?:-[a-z]+)*)〕/g

/**
 * 取某組之合法碼:不在該組清單(含非字串)者歸 unclassified(安全網)
 *
 * @param {String} group 輸入分組鍵(REJECT_GROUPS 之鍵)
 * @param {*} code 輸入碼
 * @returns {String} 回傳合法碼或 'unclassified'
 * @throws {Error} 分組鍵不認得時拋出
 * @example
 * console.log(rejectKindOf('guard', 'target-not-in-prompt'), rejectKindOf('guard', 'no-such-kind'), rejectKindOf('doubted', undefined))
 * // => target-not-in-prompt unclassified unclassified
 */
export function rejectKindOf(group, code) {
    const kinds = REJECT_KINDS[group]
    if (!kinds) throw new Error(`rejectKindOf 之分組不認得（可用：${Object.keys(REJECT_KINDS).join('、')}）`) // 訊息不回顯輸入值(輸入參數之檢測機制)
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(kinds, code) ? code : UNCLASSIFIED_KIND
}

/**
 * 日誌行之型別碼標記(〔碼〕;日誌行與 detail 皆經此組出,字樣只此一處)
 *
 * @param {String} code 輸入碼
 * @returns {String} 回傳〔碼〕
 * @example
 * console.log(rejectTag('essence-too-long'))
 * // => 〔essence-too-long〕
 */
export function rejectTag(code) {
    return `〔${code}〕`
}

/**
 * 計數用之扁平統計鍵(msg.stats 為純數字累加,巢狀 map 以 `<By 鍵>:<碼>` 之扁平鍵累加,段層彙總時轉回 { 碼: 計數 })
 *
 * @param {String} group 輸入分組鍵
 * @param {String} code 輸入碼(經 rejectKindOf 歸一)
 * @returns {String} 回傳扁平統計鍵
 * @throws {Error} 分組鍵不認得時拋出
 * @example
 * console.log(rejectStatKey('opsRejected', 'essence-too-long'), rejectStatKey('opsRejected', 'bogus'))
 * // => opsRejectedBy:essence-too-long opsRejectedBy:unclassified
 */
export function rejectStatKey(group, code) {
    const kind = rejectKindOf(group, code)
    return `${REJECT_GROUPS[group].by}:${kind}`
}

/**
 * 扁平統計鍵拆回 [By 鍵, 碼];非此形者回 null
 *
 * @param {String} key 輸入統計鍵
 * @returns {Array|null} 回傳 [By 鍵, 碼] 或 null
 * @example
 * console.log(rejectStatSplit('guardBy:target-not-in-prompt'), rejectStatSplit('opsApplied'))
 * // => [ 'guardBy', 'target-not-in-prompt' ] null
 */
export function rejectStatSplit(key) {
    const i = typeof key === 'string' ? key.indexOf(':') : -1
    if (i < 0) return null
    const by = key.slice(0, i)
    return REJECT_BY_KEYS.includes(by) ? [by, key.slice(i + 1)] : null
}

/**
 * 型別碼之計數(某組之拒收／擋下項各帶 kind;未登記者歸 unclassified):{ 碼: 計數 },各鍵之和等於項數
 *
 * @param {String} group 輸入分組鍵(REJECT_GROUPS 之鍵)
 * @param {Array} items 輸入各項(帶 kind;非陣列視同無項)
 * @returns {Object} 回傳 { 碼: 計數 }
 * @throws {Error} 分組鍵不認得且有項時拋出
 * @example
 * console.log(kindTally('guard', [{ kind: 'target-not-in-prompt' }, { kind: 'target-not-in-prompt' }, {}]))
 * // => { 'target-not-in-prompt': 2, unclassified: 1 }
 */
export function kindTally(group, items) {
    const m = {}
    for (const x of Array.isArray(items) ? items : []) {
        const k = rejectKindOf(group, x?.kind)
        m[k] = (m[k] || 0) + 1
    }
    return m
}

/**
 * 一個 pass 之結果(runPass／runPending 之回傳)之型別計數:提煉段逐鍵 count 入本輪統計之扁平鍵(`<By 鍵>:<碼>`)與整合驗證拒收之總數——
 *   opsRejected 取自 r.rejected(套用差量之拒收,各帶 kind)、guard／reviseBlocked／integrateRejected 取自 r.stats 之 guardBy／reviseBlockedBy／integrateRejectedBy;
 *   各組之和等於該組既有之總數(r.rejected.length、stats.guardRejected、stats.patch.blocked、stats.integrateRejected)。終審剔除與存疑另見提煉段之 logVerdicts
 *
 * @param {Object} r 輸入 pass 之結果(取 rejected、stats;缺者視同無)
 * @returns {Object} 回傳 { 扁平統計鍵: 計數 }(含 integrateRejected 總數;計數為 0 之鍵不列)
 * @example
 * console.log(passKindStats({ rejected: [{ kind: 'item-not-found' }, { kind: 'item-not-found' }], stats: { guardBy: { 'target-not-in-prompt': 1 }, integrateRejected: 1, integrateRejectedBy: { 'text-diverged': 1 } } }))
 * // => {
 * //   'opsRejectedBy:item-not-found': 2,
 * //   'guardBy:target-not-in-prompt': 1,
 * //   integrateRejected: 1,
 * //   'integrateRejectedBy:text-diverged': 1
 * // }
 */
export function passKindStats(r) {
    const out = {}
    const add = (group, by) => {
        for (const [kind, n] of Object.entries(by || {})) if (n) out[rejectStatKey(group, kind)] = (out[rejectStatKey(group, kind)] || 0) + n
    }
    const st = r?.stats || {}
    add('opsRejected', kindTally('opsRejected', r?.rejected))
    add('guard', st.guardBy)
    add('reviseBlocked', st.reviseBlockedBy)
    if (st.integrateRejected) out.integrateRejected = st.integrateRejected
    add('integrateRejected', st.integrateRejectedBy)
    return out
}

export default { UNCLASSIFIED_KIND, REJECT_KINDS, REJECT_GROUPS, REJECT_BY_KEYS, DROP_REASON_KINDS, DOUBT_REASON_KINDS, REJECT_TAG_RE, rejectKindOf, rejectTag, rejectStatKey, rejectStatSplit, kindTally, passKindStats }
