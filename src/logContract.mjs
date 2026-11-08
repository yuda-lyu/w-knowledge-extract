// logContract.mjs — 提煉之日誌與報告契約:外部巡檢判讀提煉段之日誌字樣與正則、執行摘要(run.json)中提煉段之 report 鍵(唯一來源;
//   隨本套件之訊息與 report 一起改)
//
// 【為何在提煉套件】提煉子階段(及其各專步、AI 呼叫之逐棒紀錄、總組裝共用件)之訊息字樣與 report 之鍵由本套件之碼產生;巡檢若自寫一份,
//   本套件改字即失效——字樣對不上時,常態訊息被當未知警告洗版、或須見之訊息被已知字樣吞掉。
// 【三類字樣】
//   EXTRACT_LOG_KNOWN:已知常態之 WARN 字樣(各有機制兜底、或有 report 鍵之專屬判準)——巡檢不當未知警告;
//   EXTRACT_LOG_MUST_SEE:一律須見之字樣(行內即使含已知字樣或概念名,亦須列出;他工作之已知字樣過寬時亦不被吞);
//   EXTRACT_LOG_PARSE:逐輪數字與觀察契約之正則(執行摘要 run.json 缺時之退路;group 1 為數字或名稱;依 extractSummaryOf 之固定句與逐棒紀錄)。
//   前兩類為正則片段字串,巡檢以「|」併入其總表(與其他工作之字樣合併)。
// 【字樣由發出者宣告、本檔以聯集組成】提煉段專屬者列於本檔;總組裝共用件與抓取套件之核心件所發者取抓取套件之 CORE_LOG_*——不另抄一份。
// 【字樣取該行特有之片語】已知字樣若是常見詞,會連帶吞掉同段之須見訊息;須見之行多含概念名,概念名可能含他工作之已知字樣——故須見字樣另列,
//   不靠「不在已知之列」。刻意不列者(設定問題之提示、讀不到名單檔、子階段整段倒了)不在兩類之中:巡檢即當未知警告呈現。
// 【report 鍵】EXTRACT_REPORT_KEYS:階段名、子階段鍵、統一統計之鍵、子階段 detail 之鍵(全集;條件鍵另列於 conditional)——巡檢讀
//   run.json 之 stages[].sub 依此取值,固定格式摘要(extractObject 之 extractSummaryOf)讀同一組鍵。物件之子階段鍵(extractObject 之
//   EXTRACT_STAGE_KEYS)與階段名即本契約之同一實體;提煉段與各專步之統計初值由本契約生成(extractStatInit),鍵不在契約者載入即拋。
// 【以實際訊息驗證】單元測試以真實之子階段與總組裝產出之日誌與 report 驗證(test/unit-extract-log-contract):原始碼之 WARN／ERROR 字樣逐一歸類
//   (已知、須見、刻意不列),每個 report 鍵皆須在實際 report 出現,實際 report 亦不得有未列之鍵。

import { CORE_LOG_KNOWN, CORE_LOG_MUST_SEE } from './core/capturePackage.mjs'
import { REJECT_BY_KEYS } from './core/rejectKinds.mjs'

/** 提煉物件之階段名(執行摘要之段名;段落完成行「步驟N <階段名> 完成：」之正則同讀) */
const STAGE = '提煉'

/**
 * 提煉段之已知常態 WARN 字樣(正則片段;提煉專屬者＋核心件之字樣)
 *
 * @type {Array}
 */
export const EXTRACT_LOG_KNOWN = Object.freeze([
    // 逐棒紀錄(AI 呼叫之遞補鏈每次失敗之嘗試、全鏈失敗;遞補是設計機制,成交另記 INFO)
    '提煉事件',
    // 降級(某棒失敗而採最近一份合格產物續跑;終審失敗時破壞性操作存待審)、中斷後之投影補正(以狀態重建投影)
    '提煉降級', '提煉投影補正',
    // 各 pass 之全鏈失敗(已記失敗帳、退避或回隊尾;判定小組專步之專步層失敗另附連續次數與退避)——提煉、整併、待審裁決、重審、本質、
    //   爭議覆核、出處支持存量覆核、失撐主張找支持
    '提煉失敗（', '整併失敗（', '待審裁決失敗（', '重審失敗（', '本質失敗（', '爭議覆核失敗（', '出處支持存量覆核失敗（', '失撐主張找支持失敗（',
    // 時間預算截止(本次不套用、不計失敗,下輪再做)。斷網者同一機制,但字樣含須見之「本機網路不通」——刻意不列為已知
    '因時間預算截止未完成',
    // 本質專步未補成本質(退避後再試)、同義核心核對之提議席失敗(本輪只用名稱相近之候選)、同義核心核對之專步層失敗(退避)
    '本質專步未補成本質', '提煉同義核心核對：提議席失敗', '提煉同義核心核對：提議紀錄檔損壞', '同義核心核對失敗（',
    // 重練意圖之消化(regenCore 先記之意圖,管線開工清其失敗帳與影響留待——設計機制;未完成者另為須見)
    '提煉重練意圖：已消化',
    // 核心件所發者(管線秩序——執行鎖持有中略過本輪、時間預算守門、啟動期檢核;AI 調度層之事件)
    ...CORE_LOG_KNOWN,
])

/**
 * 提煉段之一律須見字樣(正則片段;純文字;提煉專屬者＋核心件之字樣)
 *
 * @type {Array}
 */
export const EXTRACT_LOG_MUST_SEE = Object.freeze([
    // 不變式違反(兩種語序:pass 後落帳／投影補正;未落盤)、狀態寫入被他處改動(CAS;本次不寫入)、狀態檔讀不了而本概念跳過
    '不變式違反', '違反不變式', '被他處改動', '本概念跳過',
    // 終審自相矛盾、待審逾上限(最舊者丟棄)、分身合併、手改另存、狀態還原(狀態檔毀損或遺失,以上一版還原並落盤)、狀態檔熔斷(維護段單輪修復＋隔離逾上限而停手)
    '提煉終審自相矛盾', '待審逾上限', '提煉分身合併', '提煉手改另存', '提煉狀態還原', '提煉狀態檔熔斷',
    // 出處懸空、內容變更守門、維護失敗、逐核心之異常
    '提煉出處懸空', '提煉內容變更守門', '提煉維護失敗', '提煉異常\\[',
    // 帳檔寫入失敗(失敗帳、待審丟棄帳;寫入層壞了)、帳檔損壞(已隔離或唯讀讀法未隔離;stores/extractFiles 之字樣)、落盤失敗之登錄撤銷未完成(先記後寫之補償失敗)
    '失敗帳寫入失敗', '待審丟棄帳寫入失敗', '提煉帳檔損壞', '登錄撤銷未完成',
    // 重練意圖未完成(封存中途中斷;每輪 WARN 直至重跑 regenCore 續作)
    '提煉重練意圖未完成',
    // 判定小組兩席同家(摘要套件之 panelSameProviderWarnings 之字樣;啟動期檢核之行內):開啟之覆核永遠無法成立——行首為已知之「啟動期檢核：」,須仍被看見
    '判定小組永遠無法成立',
    // 統計鍵不在初值表(count 之鍵與初值表、契約之鍵不同步;程式之錯)
    '提煉統計：未知之統計鍵',
    // 產出鏈(core/producedChain)組不出(輪次 stamp、套件版或寫入時刻不合共用件之格式;程式之錯):該版 changelog 缺 produced,須見
    '提煉產出鏈組不出',
    // 核心件所發者(本機網路不通:注入之網路判斷器確認不通;不計此次之失敗——行首為已知之「提煉[…]：<pass>」前綴)
    ...CORE_LOG_MUST_SEE,
])

/**
 * 逐輪數字與觀察契約之正則(執行摘要缺時之退路):管線執行器之段落完成行(「步驟N 提煉 完成：」＋extractSummaryOf 之固定格式摘要);
 *   逐棒成交之行(「提煉事件[<概念>] <棒> <供應者> 成交」;group 1 棒、group 2 供應者——成交統計)、衝突交關聯段核對之行(group 1 條數)
 *
 * @type {Object}
 */
export const EXTRACT_LOG_PARSE = Object.freeze({
    cores: new RegExp(`步驟\\d+ ${STAGE} 完成：.*?更新 (\\d+) 則核心`),
    concepts: new RegExp(`步驟\\d+ ${STAGE} 完成：概念 (\\d+)`),
    aiCalls: new RegExp(`步驟\\d+ ${STAGE} 完成：.*（AI (\\d+) 次）`),
    deal: /提煉事件\[[^\]]*\] (\S+) (\S+) 成交/,
    toRelate: /提煉\[[^\]]*\]：(\d+) 條衝突交關聯段核對/,
})

/**
 * 執行摘要(run.json)中提煉段之 report 鍵:stages[] 中 name 為 stage 之段,其 sub 為子階段名 → 子階段 report({ ok, stats, detail, summary })
 *
 * @type {Object}
 */
export const EXTRACT_REPORT_KEYS = Object.freeze({
    // 物件之階段名(extractObject 之預設 name;段落完成行之正則同讀)
    stage: STAGE,
    // 子階段之鍵
    subStages: Object.freeze(['extract']),
    // 子階段與物件之統一統計
    stats: Object.freeze(['in', 'out', 'skip', 'fail', 'aiCalls']),
    detail: Object.freeze({
        extract: Object.freeze([
            // 逐輪之核心與 pass
            'concepts', 'updated', 'bumps', 'failed', 'stopped', 'aiCalls', 'aiAttempts', 'batches', 'consolidated', 'pendingReviewed', 'pendingPurged', 'tails',
            'degraded',
            // 操作與守門、審計、修訂、終審
            'opsApplied', 'opsRejected', 'opsWithheld', 'opsDropped', 'opsDoubted', 'invariantDropped', 'reviewConflicts', 'reviewDisputesCascaded',
            'reviewDisputeOfftopicKept', 'overLimit', 'lengthChecked', 'absoluteTone', 'questionsAdded', 'questionsResolved',
            // 拒收／擋下／剔除／存疑之型別計數(core/rejectKinds;{ 型別碼: 計數 },各鍵之和等於同組之總數:opsRejectedBy＝opsRejected、integrateRejectedBy＝integrateRejected
            //   〔整合輸出之驗證拒收;本組總數亦為新增〕、guardBy＝guardRejected、reviseBlockedBy＝patchBlocked、acceptDroppedBy＝opsDropped、doubtedBy＝opsDoubted)
            'integrateRejected', ...REJECT_BY_KEYS,
            // 筆記之消化與材料
            'notesUsed', 'notesSkipped', 'notesUncovered', 'notesExhausted', 'unsectioned', 'mdMissing', 'twinsMerged', 'repaired', 'guardRejected',
            'stdIssues', 'stdRejected', 'auditIssues', 'patchApplied', 'patchBlocked', 'verdictBlocked',
            // 維護與重審
            'baselined', 'withdrawn', 'restored', 'dangling', 'projected', 'maintainFailed', 'recheckChanged', 'recheckConflict', 'recheckConflictGone',
            'conflictGonePruned', 'conflictReopened', 'notesRechecked', 'recheckPasses', 'essencePasses', 'notesHeld', 'holdsResolved', 'holdsSwept', 'holdsWaivedKept', 'versionChanged', 'unverifiable',
            'conflictsDisposed', 'conflictsNotOpposed', 'conflictsPending', 'conflictsToRs4', 'recheckExhausted', 'recheckBlocked', 'rebaselined',
            // 出處支持覆核(ES9 新進):受檢、不採、判不了、基礎設施未成立、存待審、材料不可得、中止未判、筆記層登錄、待審逾次移出、修訂、出處修剪、排除集
            'supportChecked', 'supportCalls', 'supportRejected', 'supportUndetermined', 'supportInfra', 'supportWithheld', 'supportUnreadable', 'supportStopped', 'notesHeldEs9', 'pendingEs9Held',
            'supportRevised', 'supportReviseFailed', 'supportSourcesDropped', 'supportExcludedClaims',
            // 出處支持之存量覆核(ES9 存量)
            'stockDue', 'stockChecked', 'stockSupported', 'stockRevised', 'stockRetracted', 'stockHeld', 'stockRetry', 'stockCalls', 'stockPasses',
            'stockHolds', 'stockReleased', 'stockExcluded', 'stockUnreadable',
            // 失撐主張之專責佇列(ES8)
            'orphanDue', 'orphanChecked', 'orphanResourced', 'orphanRetracted', 'orphanHeld', 'orphanRetry', 'orphanCalls', 'orphanPasses', 'orphanHolds',
            'orphanRevived', 'orphanPages', 'orphanUnreadable',
            // 爭議覆核(ES14)
            'disputeDue', 'disputeChecked', 'disputeOpposed', 'disputeDissolved', 'disputeHeld', 'disputeRetry', 'disputeStdRejected', 'disputeCalls',
            'disputePasses', 'disputeHolds', 'disputeUnreadable',
            // 關聯變更之影響(ES10)
            'impactEvents', 'impactCandidates', 'impactRecheck', 'impactDropped', 'impactRetryCores', 'recheckRelation', 'recheckPartner',
            'partnersCovered', 'partnersUsed',
            // 同義核心核對(ES11)
            'synonymCandidates', 'synonymProposed', 'synonymChecked', 'synonymSame', 'synonymDifferent', 'synonymHeld', 'synonymRetry', 'synonymResolved',
            'synonymCalls', 'synonymWaivedKept',
            // 各專步之專步層連續失敗(失敗帳之 <mode>Tries;僅重審、本質、判定小組三專步〔核心鍵〕與同義〔全域鍵〕)
            'recheckFailStreak', 'essenceFailStreak', 'disputeFailStreak', 'supportFailStreak', 'orphanFailStreak', 'synonymFailStreak',
            // 條件鍵(conditional 同列):選題後之積壓(選題有執行時)、停用(extract.perRun 0;只有此鍵與初值)、剩餘時間不足而未開工(只有此鍵與初值)
            'backlog', 'disabled', 'skippedForBudget',
        ]),
    }),
    // 條件鍵(只在條件下出現,不入統計初值):detail 之鍵集之子集
    conditional: Object.freeze({
        extract: Object.freeze(['backlog', 'disabled', 'skippedForBudget']),
    }),
})

/**
 * 統計之初值由契約生成(提煉段之 stat、各 pass 與專步之 stats 同讀;鍵之序即契約之序):未給鍵即全部非條件鍵;給了鍵即該子集。
 *   鍵不在契約或為條件鍵即拋(模組載入或開工當下即發現,不等到 agg 才 WARN)
 *
 * @param {Array} [keys=null] 輸入鍵之子集(null＝全部非條件鍵)
 * @returns {Object} 回傳 { 鍵: 0 }(型別計數鍵〔REJECT_BY_KEYS〕之初值為 {})
 * @throws {Error} 鍵不在契約之 detail 或為條件鍵時拋出
 * @example
 * console.log(extractStatInit(['concepts', 'updated']))
 * // => { concepts: 0, updated: 0 }
 */
export function extractStatInit(keys = null) {
    const all = EXTRACT_REPORT_KEYS.detail.extract
    const cond = EXTRACT_REPORT_KEYS.conditional.extract
    const ks = Array.isArray(keys) ? keys : all.filter((k) => !cond.includes(k))
    const missing = ks.filter((k) => !all.includes(k))
    if (missing.length) throw new Error(`提煉統計初值：鍵不在契約（${missing.join('、')}）`)
    const conditional = ks.filter((k) => cond.includes(k))
    if (conditional.length) throw new Error(`提煉統計初值：條件鍵不入初值（${conditional.join('、')}）`)
    return Object.fromEntries(ks.map((k) => [k, REJECT_BY_KEYS.includes(k) ? {} : 0]))
}

export default { EXTRACT_LOG_KNOWN, EXTRACT_LOG_MUST_SEE, EXTRACT_LOG_PARSE, EXTRACT_REPORT_KEYS, extractStatInit }
