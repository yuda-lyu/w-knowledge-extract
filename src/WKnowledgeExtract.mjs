// WKnowledgeExtract.mjs — 主入口:通用知識提煉套件
//
// 安裝即用(僅 workDir 必填);設定、詞彙、提示詞皆有通用預設,安裝方逐鍵覆寫即可收斂到自己的主題。
// 全部積木具名匯出,並預設匯出同一物件——安裝方依自己的管線自由組裝,不需改套件。
//
// 【匯出單一來源:模組清單】各公開模組於下方各列一次「命名空間匯入＋export *」;預設匯出物件由同一組命名空間合成,
//   具名匯出與預設物件必然同一組名稱(不另手寫名稱清單——三處各寫一份必然漂移)。
// 【名稱衝突即拋】兩模組匯出同名而不同實體時,export * 會靜默剔除該名(以具名匯入取用時才爆),故載入時即檢查並拋錯(合成之規則取抓取套件之
//   composeNamespaces,四套件同一份)。
// 【不轉出抓取、摘要與關聯套件之件】core/capturePackage.mjs(抓取埠)、core/summarizePackage.mjs(摘要埠)與 core/relatePackage.mjs(關聯埠)
//   為取用三套件之單一匯入點,不是本套件之公開模組;三套件之件請自其套件取用。

import { composeNamespaces } from './core/capturePackage.mjs'
import * as createKnowledgeExtractNs from './createKnowledgeExtract.mjs'
import * as extractObjectNs from './extractObject.mjs'
// ── 提煉執行期件之組裝(總組裝共用)與日誌／報告契約 ──
import * as extractRuntimeNs from './extractRuntime.mjs'
import * as logContractNs from './logContract.mjs'
// ── 設定預設與詞彙(本套件自有;三套件無之模組)──
import * as extractSettingsNs from './core/extractSettings.mjs'
import * as extractVocabNs from './core/vocab/extractVocab.mjs'
// ── 拒收類型別碼(日誌行與執行摘要之單一來源)與核心版本之產出鏈(本套件自有;三套件無之模組)──
import * as rejectKindsNs from './core/rejectKinds.mjs'
import * as producedChainNs from './core/producedChain.mjs'
// ── stores:核心狀態(主張庫)與差量之套用、狀態摘要、其檔、投影寫入器、證據等級、待判之字樣與期限、失敗帳、帳檔與檔名、出處之快取、筆記之提煉面事實、選篇、選題 ──
import * as coreStateNs from './stores/coreState.mjs'
import * as coreDeltaNs from './stores/coreDelta.mjs'
import * as stateDigestNs from './stores/stateDigest.mjs'
import * as coreStoreNs from './stores/coreStore.mjs'
import * as coreProjectionNs from './stores/coreProjection.mjs'
import * as evidenceNs from './stores/evidence.mjs'
import * as extractHoldsNs from './stores/extractHolds.mjs'
import * as extractLedgerNs from './stores/extractLedger.mjs'
import * as extractFilesNs from './stores/extractFiles.mjs'
import * as contentCacheNs from './stores/contentCache.mjs'
import * as rebaselineNs from './stores/rebaseline.mjs'
import * as regenIntentNs from './stores/regenIntent.mjs'
import * as noteFactsNs from './stores/noteFacts.mjs'
import * as noteSelectionNs from './stores/noteSelection.mjs'
import * as conceptSelectionNs from './stores/conceptSelection.mjs'
// ── domain:內建領域預設(規則表、提示詞、筆記分節摘要、核心 md 版型)──
import * as extractDomainNs from './domain/extractDomain.mjs'
import * as promptsNs from './domain/prompts.mjs'
// ── guards:守門共用之文字相似度 ──
import * as similarityNs from './guards/similarity.mjs'
// ── ops:維運(重審、打掉重練、還原撤回)──
import * as recheckOpsNs from './ops/recheckOps.mjs'
import * as regenCoreNs from './ops/regenCore.mjs'
import * as rollbackCoreNs from './ops/rollbackCore.mjs'
import * as coreVersionsByProvenanceNs from './ops/coreVersionsByProvenance.mjs'
import * as reviveClaimsNs from './ops/reviveClaims.mjs'
// ── standards:檢定標準(解析、守門、納入閘、核心之確定性檢定、各覆核、全集、符合度掃描、核心之存量處置與其修法、重審項、關聯變更之影響、待判之登錄與結案、逐案題組之頁組法與類別)──
import * as parseNs from './standards/parse.mjs'
import * as opGuardsNs from './standards/opGuards.mjs'
import * as conflictDispositionNs from './standards/conflictDisposition.mjs'
import * as coreStandardsNs from './standards/coreStandards.mjs'
import * as disputeCheckNs from './standards/disputeCheck.mjs'
import * as opStandardsNs from './standards/opStandards.mjs'
import * as orphanCheckNs from './standards/orphanCheck.mjs'
import * as panelVotesNs from './standards/panelVotes.mjs'
import * as supportCheckNs from './standards/supportCheck.mjs'
import * as supportReviseNs from './standards/supportRevise.mjs'
import * as supportStockNs from './standards/supportStock.mjs'
import * as synonymCheckNs from './standards/synonymCheck.mjs'
import * as registryNs from './standards/registry.mjs'
import * as auditNs from './standards/audit.mjs'
import * as stockFixNs from './standards/stockFix.mjs'
import * as coreStockFixNs from './standards/coreStockFix.mjs'
import * as recheckNs from './standards/recheck.mjs'
import * as relationImpactNs from './standards/relationImpact.mjs'
import * as holdSettleNs from './standards/holdSettle.mjs'
import * as esCasesNs from './standards/esCases.mjs'
// ── stages:提煉子階段與其逐核心動作鏈、步驟序列與專步排程、無 AI 之維護、同義核心專步 ──
import * as extractStageNs from './stages/extractStage.mjs'
import * as extractChainNs from './stages/extractChain.mjs'
import * as extractStepsNs from './stages/extractSteps.mjs'
import * as extractMaintainNs from './stages/extractMaintain.mjs'
import * as synonymStepNs from './stages/synonymStep.mjs'
// ── workflow:3+3 工作流(AI 呼叫之單一包裝、起草候選、終審裁決、守門之閘、關聯脈絡)與各專步 ──
import * as aiCallNs from './workflow/aiCall.mjs'
import * as applyWithInvariantsNs from './workflow/applyWithInvariants.mjs'
import * as candidatesNs from './workflow/candidates.mjs'
import * as disputePassNs from './workflow/disputePass.mjs'
import * as relationContextNs from './workflow/relationContext.mjs'
import * as orphanPassNs from './workflow/orphanPass.mjs'
import * as pendingNs from './workflow/pending.mjs'
import * as reviewGuardsNs from './workflow/reviewGuards.mjs'
import * as runPassNs from './workflow/runPass.mjs'
import * as supportGateNs from './workflow/supportGate.mjs'
import * as supportStockPassNs from './workflow/supportStockPass.mjs'
import * as verdictsNs from './workflow/verdicts.mjs'
// ── bench:AI 能力評分(判定類六角色;核心為抓取套件之 benchKit;命令列 bench/cli.mjs 被 import 時不執行,只轉出同一實體)──
import * as extractBenchNs from './bench/extractBench.mjs'
import * as benchCliNs from './bench/cli.mjs'

export * from './createKnowledgeExtract.mjs'
export * from './extractObject.mjs'
export * from './extractRuntime.mjs'
export * from './logContract.mjs'
export * from './core/extractSettings.mjs'
export * from './core/vocab/extractVocab.mjs'
export * from './core/rejectKinds.mjs'
export * from './core/producedChain.mjs'
export * from './stores/coreState.mjs'
export * from './stores/coreDelta.mjs'
export * from './stores/stateDigest.mjs'
export * from './stores/coreStore.mjs'
export * from './stores/coreProjection.mjs'
export * from './stores/evidence.mjs'
export * from './stores/extractHolds.mjs'
export * from './stores/extractLedger.mjs'
export * from './stores/extractFiles.mjs'
export * from './stores/contentCache.mjs'
export * from './stores/rebaseline.mjs'
export * from './stores/regenIntent.mjs'
export * from './stores/noteFacts.mjs'
export * from './stores/noteSelection.mjs'
export * from './stores/conceptSelection.mjs'
export * from './domain/extractDomain.mjs'
export * from './domain/prompts.mjs'
export * from './guards/similarity.mjs'
export * from './ops/recheckOps.mjs'
export * from './ops/regenCore.mjs'
export * from './ops/rollbackCore.mjs'
export * from './ops/coreVersionsByProvenance.mjs'
export * from './ops/reviveClaims.mjs'
export * from './standards/parse.mjs'
export * from './standards/opGuards.mjs'
export * from './standards/conflictDisposition.mjs'
export * from './standards/coreStandards.mjs'
export * from './standards/disputeCheck.mjs'
export * from './standards/opStandards.mjs'
export * from './standards/orphanCheck.mjs'
export * from './standards/panelVotes.mjs'
export * from './standards/supportCheck.mjs'
export * from './standards/supportRevise.mjs'
export * from './standards/supportStock.mjs'
export * from './standards/synonymCheck.mjs'
export * from './standards/registry.mjs'
export * from './standards/audit.mjs'
export * from './standards/stockFix.mjs'
export * from './standards/coreStockFix.mjs'
export * from './standards/recheck.mjs'
export * from './standards/relationImpact.mjs'
export * from './standards/holdSettle.mjs'
export * from './standards/esCases.mjs'
export * from './stages/extractStage.mjs'
export * from './stages/extractChain.mjs'
export * from './stages/extractSteps.mjs'
export * from './stages/extractMaintain.mjs'
export * from './stages/synonymStep.mjs'
export * from './workflow/aiCall.mjs'
export * from './workflow/applyWithInvariants.mjs'
export * from './workflow/candidates.mjs'
export * from './workflow/disputePass.mjs'
export * from './workflow/relationContext.mjs'
export * from './workflow/orphanPass.mjs'
export * from './workflow/pending.mjs'
export * from './workflow/reviewGuards.mjs'
export * from './workflow/runPass.mjs'
export * from './workflow/supportGate.mjs'
export * from './workflow/supportStockPass.mjs'
export * from './workflow/verdicts.mjs'
export * from './bench/extractBench.mjs'
export * from './bench/cli.mjs'

/**
 * 公開模組之命名空間(預設匯出物件之來源;與上方 export * 為同一組模組)
 *
 * @type {Array}
 */
const NAMESPACES = [
    createKnowledgeExtractNs, extractObjectNs, extractRuntimeNs, logContractNs,
    extractSettingsNs, extractVocabNs, rejectKindsNs, producedChainNs,
    coreStateNs, coreDeltaNs, stateDigestNs, coreStoreNs, coreProjectionNs, evidenceNs, extractHoldsNs, extractLedgerNs, extractFilesNs, contentCacheNs, rebaselineNs, regenIntentNs, noteFactsNs, noteSelectionNs, conceptSelectionNs,
    extractDomainNs, promptsNs,
    similarityNs,
    recheckOpsNs, regenCoreNs, rollbackCoreNs, coreVersionsByProvenanceNs, reviveClaimsNs,
    parseNs, opGuardsNs, conflictDispositionNs, coreStandardsNs, disputeCheckNs, opStandardsNs, orphanCheckNs, panelVotesNs, supportCheckNs, supportReviseNs, supportStockNs, synonymCheckNs, registryNs, auditNs, stockFixNs, coreStockFixNs, recheckNs, relationImpactNs, holdSettleNs, esCasesNs,
    extractStageNs, extractChainNs, extractStepsNs, extractMaintainNs, synonymStepNs,
    aiCallNs, applyWithInvariantsNs, candidatesNs, disputePassNs, orphanPassNs, pendingNs, relationContextNs, reviewGuardsNs, runPassNs, supportGateNs, supportStockPassNs, verdictsNs,
    extractBenchNs, benchCliNs,
]

/**
 * 通用知識提煉套件
 *
 * 提供一輪提煉之完整管線(選題 → 逐概念之 3+3 提煉與各檢定標準之專步 → 核心 md 之投影):
 * ① 安裝即用:createKnowledgeExtract({ workDir }) 零注入即可跑,讀摘要套件交出之筆記與關聯套件交出之邊,預設席位為免金鑰之免費模型
 * ② 逐層可覆寫:cfg 設定逐鍵覆寫(resolveExtractSettings;ai、extract 兩段,錯誤一律拋錯)、cfg.data.vocab 知識庫稱呼與主題範圍、證據封頂、
 *    推論類與提示詞之領域句(resolveExtractVocab;pickExtractVocab 自共用之詞彙表取子集)、cfg.prompts 提示詞與規則表、cfg.domains 整組 domain、
 *    cfg.stages／stageOpts 子階段與動作鏈 tap、cfg.aiAdapter 調度層;他總組裝以 createExtractRuntime 組出同一組提煉件
 * ③ 領域中立:主題範圍、知識庫稱呼、內容類型之證據封頂、主張之推論類皆由安裝方決定
 * ④ 知識之加入、變更與刪除:新筆記之提煉、筆記內容變更之重審、出處撤回與恢復、關聯變更之影響、同義核心之核對;維運(存量處置、
 *    打掉重練、還原撤回)
 * ⑤ 檢定標準:納入閘、核心之確定性檢定、各判定小組之覆核(出處支持、失撐、爭議、同義)、標準之登記(EXTRACT_STANDARDS)、
 *    符合度掃描(auditExtractStandards)與存量處置,供測試與維運檢查功能是否正常
 * ⑥ 免費 AI 能力評分:判定類六角色(出處支持覆核、出處修訂、失撐找支持、爭議覆核、同義覆核、同義提議)與工作流類八角色(3+3 之各棒、待審裁決、本質、整併),共十四角色(runExtractBench、runExtractBenchCli)
 * ⑦ 日誌與報告契約:外部巡檢判讀提煉段之字樣與 report 鍵(EXTRACT_LOG_KNOWN、EXTRACT_LOG_MUST_SEE、EXTRACT_LOG_PARSE、EXTRACT_REPORT_KEYS)
 *
 * @returns {Object} 回傳套件物件,含 createKnowledgeExtract、createExtractObject、createExtractRuntime、子階段工廠、設定預設
 *     (resolveExtractSettings、EXTRACT_*)、詞彙(resolveExtractVocab 等)、domain 工廠、檢定標準、存量掃描與處置、維運件、AI 能力評分與
 *     日誌契約等(與具名匯出同一組)
 * @throws {Error} 兩個公開模組匯出同名而不同實體時於載入期拋出
 * @example
 * import WKnowledgeExtract from 'w-knowledge-extract/src/WKnowledgeExtract.mjs'
 *
 * //零注入:僅 workDir 必填(金鑰放 workDir/.env;預設 AI 席位為免金鑰之免費模型)
 * let flow = WKnowledgeExtract.createKnowledgeExtract({
 *     workDir: './my-kb', //notes 集合中之筆記(摘要套件交出)與 relations 集合中之邊(關聯套件交出)即本套件之輸入
 *     data: { vocab: { domain: '天文學' } }, //主題範圍(選填), 未給即不限主題
 * })
 * let report = await flow.run() //提煉一輪, my-kb/knowledge/core 之核心 md 隨之更新, 結束後寫 log/<day>/<stamp>-run.json
 * console.log(report.ok)
 */
const WKnowledgeExtract = composeNamespaces('WKnowledgeExtract', NAMESPACES)


export default WKnowledgeExtract
