// registry.mjs — 提煉檢定標準之全集(定義表;純資料,不判定)
//
// 【一條一列】{ id, title, object(對象與入口), kind, v, proves(能證明), notProves(不能證明), enforcedAt(執行處), scan, scanNote }:
//   kind:'program'＝程式判定(判定可重算);'ai'＝由判定小組(兩席,不一致時第三席)判定、以題組逐案評。
//   enforcedAt:執行之所在,「套件內檔案:函數」(路徑相對套件根;只列匯出之函數——段內之未匯出步驟〔維護、落帳〕以其所屬之段列之);
//   同一標準多處執行者皆列——判定之純函數、納入閘(起草之 3+3、待審裁決、爭議覆核之拆解、出處支持存量覆核之修訂)、程式寫入、
//   各專步、存量處置、還原撤回、符合度掃描各入口依實際之碼列出。
//   scan:auditExtractStandards(standards/audit)是否以本條 id 逐件判定並計數;scanNote 寫掃描之範圍,或不掃之理由。
// 【版本單一來源】逐件判定之標準(standards/coreStandards 之 CORE_STANDARDS)之標題與版本取自該表(判定改變即升版,掃描與存量處置
//   據以判斷是否須重掃);ES8、ES9、ES11、ES14 之識別與版本取自其判定模組(檢核紀錄據以判重檢);ES7 併入 ES9(出處支持之修訂路徑;
//   修訂後之重判記於 ES9 之檢核紀錄),無獨立版本,v 為 null;ES10 為 1。
// 【AI 列】EXTRACT_AI_STANDARD_IDS:判定記於檢核紀錄與待判登錄之標準——ES8(失撐之隔離為程式判定、找支持為判定小組)、ES9、ES11、ES14。
// 【能證明／不能證明】程式標準只證明形式、來源與結構;AI 標準證明的是兩個不同供應者之席位對該案得出同一類別(題組以應然釘住判準),
//   不證明客觀真偽。「不能證明」即該標準之已知盲區,由所列之他標準或使用者判讀補位。
// 【不經納入閘之寫入入口(刻意)】EXTRACT_UNGATED_WRITE_ENTRIES:回退(存量處置之回退寫回處置前之狀態——撤銷該次處置之效果,不是新進)與
//   機械寫入(以狀態重建投影、壞檔以上一版落盤、分身之併入、打掉重練之封存、隔離之解除、邊庫快照之換簽章;不改條目內容或不寫新內容)。
//   寫入之站點(store.save、.restore、.archive、writeMd)須在各標準之執行處或本表之內,不在者即缺陷。

import { CORE_STANDARDS, ANNOTATION_UNSTATED } from './coreStandards.mjs'
import { ES8 } from './orphanCheck.mjs'
import { ES9 } from './supportCheck.mjs'
import { ES11 } from './synonymCheck.mjs'
import { ES14 } from './disputeCheck.mjs'
import { ES15, EXTRACT_HOLD_DEADLINE_DAYS } from '../stores/extractHolds.mjs'

/**
 * 逐件判定之標準之 id、標題與版本(CORE_STANDARDS 為唯一來源;缺者即拋——表與判定脫節時於載入當下發現)
 *
 * @param {String} id 輸入標準 id
 * @returns {Object} 回傳 { id, title, kind, v }
 * @throws {Error} CORE_STANDARDS 無此 id 時拋出
 */
function coreStd(id) {
    const s = CORE_STANDARDS.find((x) => x.id === id)
    if (!s) throw new Error(`registry:CORE_STANDARDS 缺 ${id}`)
    return { id: s.id, title: s.title, kind: s.kind, v: s.v }
}

/** 執行處(各標準共用;各條另加其專屬者) */
const E = Object.freeze({
    judge: 'standards/coreStandards.mjs:checkCore',
    opGate: 'standards/opStandards.mjs:createOpStandards',
    guard: 'standards/opGuards.mjs:guardOps',
    runPass: 'workflow/runPass.mjs:runPass',
    pending: 'workflow/pending.mjs:runPending',
    disputePass: 'workflow/disputePass.mjs:runDisputePass',
    stockPass: 'workflow/supportStockPass.mjs:runSupportStockPass',
    orphanPass: 'workflow/orphanPass.mjs:runOrphanPass',
    apply: 'stores/coreDelta.mjs:applyDelta',
    invariants: 'stores/coreState.mjs:checkInvariants',
    programWrite: 'stores/coreProjection.mjs:programWriteProblems',
    writer: 'stores/coreProjection.mjs:coreWriterOf',
    stage: 'stages/extractStage.mjs:stageExtract',
    maintain: 'stages/extractMaintain.mjs:maintainCores',
    pass: 'stages/extractChain.mjs:mwPass',
    persist: 'stages/extractChain.mjs:mwPersistState',
    domain: 'domain/extractDomain.mjs:createExtractDomain',
    material: 'stores/noteFacts.mjs:extractMaterialOf',
    revive: 'ops/reviveClaims.mjs:reviveClaims',
    coreFix: 'standards/coreStockFix.mjs:coreFixOf',
    stockPlan: 'standards/stockFix.mjs:planCoreStockFix',
    stockApply: 'standards/stockFix.mjs:applyCoreStockFix',
    scan: 'standards/audit.mjs:auditExtractStandards',
})

/** 起草之 3+3 與待審裁決(新進之差量;同一檢定器) */
const DELTA_ENTRIES = [E.opGate, E.runPass, E.pending, E.pass]

/** 提煉檢定標準全集(依 id 之序) */
export const EXTRACT_STANDARDS = Object.freeze([
    {
        ...coreStd('ES1'),
        object: '核心狀態(每一次寫入)與落地之條目(文字欄、本質);入口 起草之 3+3 定稿、待審裁決、爭議覆核之拆解、出處支持存量覆核之修訂與撤回、失撐主張之補出處與撤回、維護之程式寫入(首見基準、撤出處與恢復、投影更新、隔離解除、高水位補正)、存量處置、還原撤回',
        proves: '每次寫入前驗不變式:既有項不刪(取代、撤回者保留並附理由)、出處只增、沿革只追加、未觸及之項不改(衍生欄位除外)、終態不可逆(可還原之撤回之還原為唯一例外)、引用可解析、撤回理由在清單、取代鏈無環;違反者不寫入。落地之條目另驗編修經過之用語不外洩、文字欄不逾上限之 2 倍、本質不逾上限(與套用之拒收同一判準;1～2 倍放行而計數)',
        notProves: '內容之正確性(ES2、ES9)',
        enforcedAt: [E.invariants, E.apply, 'stores/coreState.mjs:lengthCapOf', 'stores/coreDelta.mjs:opLengthProblem', 'workflow/runPass.mjs:lengthIssues', ...DELTA_ENTRIES, E.disputePass, E.stockPass, E.orphanPass, E.programWrite, E.writer, 'stores/coreProjection.mjs:persistMechanical', 'stages/extractChain.mjs:mwLoadState', E.stage, E.persist, E.revive, E.stockApply, E.judge, E.scan],
        scan: true,
        scanNote: '主核心(分身與類別核心不掃);不變式整個核心一筆(以落地狀態自驗),外洩與長度逐條目一筆(非終態;爭議除撤回外)與本質一筆;狀態檔讀不了者全部標準記未能判定',
    },
    {
        ...coreStd('ES2'),
        object: '條目(主張、參數、爭議各方、待解問題)之文字(理由除外);入口 起草之 3+3、待審裁決、爭議覆核之拆解、出處支持存量覆核之修訂',
        proves: '數字事實見於本條所引之存活出處(筆記之內容章＋原文標題＋發布時間;不含投影章);參數另含所依主張之出處,爭議各方另含所引主張之出處;新進另以所觸及既有條目之全文與同差量所引新項為材料(整合後轉修訂意見、定稿仍不合即不採);材料不可得而有未紮根之數字 → 未能判定(新進不採、掃描不報為零)',
        notProves: '數字所指與推論是否成立(ES9)',
        enforcedAt: ['standards/coreStandards.mjs:groundingOf', ...DELTA_ENTRIES, E.disputePass, E.stockPass, E.material, E.stage, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之非終態條目;材料＝出處筆記之內容章＋原文標題＋發布時間(md 讀不到者記未能判定,不報為零);呼叫端可給 materialOf 共用其走訪;material:false 不讀材料,含數字者記未能判定並註明',
    },
    {
        ...coreStd('ES3'),
        object: '條目與本質之文字欄;入口 全部差量(守門)、存量處置',
        proves: '簡體專用字與同形字誤用數＝0([[連結]] 與網址不計不轉);差量於守門時只轉違規處並記旗標、不擋;存量以確定性修正只改違規處(條目之沿革記存量處置並升一版;本質之改寫入本質沿革)',
        notProves: '錯字(錯字仍是正體字)',
        enforcedAt: [E.guard, 'standards/opGuards.mjs:rewriteTextFields', E.runPass, E.pending, E.disputePass, E.stockPass, E.coreFix, E.stockPlan, E.stockApply, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之非終態條目(爭議除撤回外)與本質;[[連結]] 與網址不計',
    },
    {
        ...coreStd('ES4'),
        object: '主張之標注(銳評、利弊、期間、條件);入口 新主張(add、拆分各部、拆解轉主張之方)與改到標注或種類之修訂',
        proves: `有效主張之銳評必填;principle／rule 之利與弊各須有內容(出處沒有時寫明「${ANNOTATION_UNSTATED}」,不捏造亦不留白);temporal 須有期間;pitfall 須有條件——新進以試套整份差量後之結果判(整合後轉修訂意見、定稿仍不合即不採)`,
        notProves: '標注內容之品質(ES9 之語氣、使用者判讀)',
        enforcedAt: ['standards/coreStandards.mjs:annotationProblems', ...DELTA_ENTRIES, E.disputePass, E.stockPass, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之有效主張(失撐與隔離者除外)',
    },
    {
        ...coreStd('ES5'),
        object: '呈現給起草之衝突邊(兩端皆為已消化之存活筆記者);入口 每次 pass 之落地結構與起草之宣告、維護之回頭檢查(入已見後處置結構消失者)、存量處置',
        proves: '逐邊有結構化之去向(兩端分屬爭議兩方、取代、本版加條件且兩端皆為出處、一端離題)或已交衝突核對(關聯之 RS4);未處置者不入已見(下次再呈現),逾次或宣告非對立 → 交衝突核對;已見而無去向者(存量,或入已見後處置結構被拆解、取代、撤回拿掉者)由維護每輪回頭檢查或存量處置移出已見(下輪重新呈現;已交衝突核對者不動)',
        notProves: '去向之判斷是否最佳(衝突核對、ES14)',
        enforcedAt: ['standards/conflictDisposition.mjs:conflictDisposedOf', 'standards/conflictDisposition.mjs:normalizeConflictDecl', 'standards/conflictDisposition.mjs:es5RowsOf', 'standards/conflictDisposition.mjs:es5ReopenOf', 'workflow/relationContext.mjs:relationContextRows', E.runPass, E.pass, E.maintain, 'standards/coreStandards.mjs:es5CtxOf', E.coreFix, E.stockPlan, E.stockApply, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之已見衝突中兩端皆可引者;衝突邊之兩端取邊庫(衝突型之現名與改名之舊名,取關聯 domain)、已交衝突核對者取待判登錄;範圍不含本標準者不讀邊',
    },
    {
        ...coreStd('ES6'),
        object: '核心之本質;入口 本質專步(無本質或本質待重寫之主核心)、每次 pass',
        proves: '有效主張 > 0 即須有本質,且本質所引主張未被取代或撤回、其出處未撤(與本質專步同一判定);待重寫之原因呈現於 md 與 cores 記錄',
        notProves: '本質之品質',
        enforcedAt: ['stores/coreState.mjs:essenceNeedOf', 'stores/coreState.mjs:essenceLostOf', E.runPass, E.pass, E.stage, E.domain, E.judge, E.scan],
        scan: true,
        scanNote: '主核心一筆;無有效主張者記不適用',
    },
    {
        id: 'ES7',
        title: '語氣超出證據者依出處收斂措辭(出處支持之修訂路徑)',
        object: '出處支持覆核判為語氣超出證據而可修訂之主張;入口 起草之 3+3 定稿後之出處支持覆核、待審裁決、出處支持存量覆核',
        kind: 'ai',
        v: null,
        proves: '可修訂者(超出證據而無反駁)交修訂席依出處收斂措辭 → 經同一納入閘 → 判定小組重判受支持才採用;否則該操作不採(存量則撤回,可還原)',
        notProves: '收斂後之措辭是否最佳(使用者判讀)',
        enforcedAt: ['standards/supportRevise.mjs:revisableOf', 'standards/supportRevise.mjs:runSupportRevise', 'standards/supportRevise.mjs:applySupportFixes', E.runPass, E.pending, E.stockPass, E.domain],
        scan: false,
        scanNote: '未掃:併入 ES9(修訂後之重判記於 ES9 之檢核紀錄,見掃描之 ai.ES9);修訂之採用與否見各段之報告計數',
    },
    {
        ...coreStd(ES8.std),
        object: '出處全撤(出處筆記皆已刪除)之主張與參數;入口 維護之撤出處(隔離於有效集合之外)、失撐主張找支持之專步(預設關)、出處筆記還原時之自動還原、還原撤回',
        proves: '出處全撤者即離開有效集合(不入本質、不計證據)、列未能判定;開啟專步時於本核心之已消化筆記中找支持——兩席皆判某篇支持即補為出處,每一頁皆無支持才撤回(可還原之撤回;出處筆記還原時由維護一併還原),判不了者登錄待判(使用者)',
        notProves: '未消化之筆記中之支持',
        enforcedAt: ['stores/coreState.mjs:unsupportedOf', 'stores/coreState.mjs:withdrawSources', 'standards/orphanCheck.mjs:orphanNeedsOf', 'standards/orphanCheck.mjs:runOrphanCheck', E.orphanPass, E.pass, E.persist, E.stage, E.domain, E.revive, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之失撐主張與參數(隔離者另列 ES9)記未能判定(不是合格);專步之判定在檢核紀錄與待判(見掃描之 ai.ES8:受檢總量與到期數)',
    },
    {
        ...coreStd(ES9.std),
        object: '主張(新增與改寫於提交前;存量全量輪替);入口 起草之 3+3 定稿後、待審裁決、出處支持存量覆核專步(預設關)、還原撤回(使用者裁示)',
        proves: '主張受所引出處支持、語氣不超出證據:兩個不同供應者之席位得出同一類別(不一致時第三席;題組逐案評);判準依證據性質(推論類須寫明前提);受支持而兩席皆未列為支持之出處入排除集(不計證據、不列出處);不受支持者不採(存量撤回,可由使用者以 reviveClaims 還原);判不了者隔離並登錄待判(使用者)',
        notProves: '出處本身之對錯(爭議與銳評)',
        enforcedAt: ['standards/supportCheck.mjs:supportItemsOf', 'standards/supportCheck.mjs:runSupportCheck', 'standards/supportCheck.mjs:supportByEffects', 'standards/supportStock.mjs:stockNeedsOf', 'standards/supportStock.mjs:stockHashOf', E.runPass, E.pending, E.stockPass, 'stores/coreState.mjs:holdItems', 'stores/coreState.mjs:releaseHeld', 'stores/coreState.mjs:setExcluded', E.pass, E.persist, E.stage, E.domain, E.revive, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之隔離(判不了)主張記未能判定;其餘之判定在檢核紀錄(見掃描之 ai.ES9:已檢、四態、版本過時、待判之未結與已豁免、受檢總量與到期數)',
    },
    {
        id: 'ES10',
        title: '關聯變更之影響逐事件有處置',
        object: '關聯之增刪改(邊庫快照之差分事件);入口 維護(開啟時,概念層),預設停用',
        kind: 'program',
        v: 1,
        proves: '觸及核心已消化筆記之事件逐核心有處置與理由:非衝突之新關聯之另一端入夥伴候選、其所依之邊撤銷或改為衝突即移出;經夥伴入批者之關聯撤銷、衝突理由更新而爭議兩方分含兩端 → 重審;其餘記「不需更新」與理由(處置帳);維護失敗之核心其事件留待下輪',
        notProves: '處置後核心內容之正確(ES9 等)',
        enforcedAt: ['standards/relationImpact.mjs:edgeSnapshotOf', 'standards/relationImpact.mjs:relationEventsOf', 'standards/relationImpact.mjs:impactOfCore', 'standards/relationImpact.mjs:applyImpact', 'standards/relationImpact.mjs:impactLedgerRowsOf', 'standards/recheck.mjs:recheckItemsOf', E.stage],
        scan: false,
        scanNote: '未掃:事件驅動(邊庫快照之差分),處置於維護時寫入處置帳;各輪之報告計數夥伴候選、重審與移出',
    },
    {
        id: ES11.std,
        title: '同義概念不分立核心(兩席核對)',
        object: '兩個主核心之概念名(候選對:名稱相近或提議);入口 同義核心核對專步,預設關',
        kind: 'ai',
        v: ES11.v,
        proves: '候選對經兩個不同供應者之席位判定同一概念與否(不一致時第三席;題組逐案評);判為同一概念者登錄待判(使用者確認後加入詞彙表之概念別名,下一輪之分身合併即併為一核心),判不了者登錄待判',
        notProves: '未成為候選之同義(名稱差異大且未被提議者)',
        enforcedAt: ['standards/synonymCheck.mjs:nameCandidatesOf', 'standards/synonymCheck.mjs:proposedCandidatesOf', 'standards/synonymCheck.mjs:synonymHashOf', 'standards/synonymCheck.mjs:runSynonymCheck', 'stages/synonymStep.mjs:runSynonymStep', E.stage, E.domain],
        scan: false,
        scanNote: '未掃:AI 判定以題組逐案評;掃描列檢核紀錄之已檢、四態、版本過時與待判之未結、已豁免(見掃描之 ai.ES11)',
    },
    {
        ...coreStd('ES12'),
        object: 'principle 之主張;入口 新主張或改為 principle 之修訂(試套整份差量後判)',
        proves: '存活出處之相異文件 ≥2(以文件計;同一文件之多篇筆記只算一份)',
        notProves: '兩文件是否為獨立之研究(文件之去重只去同一內容)',
        enforcedAt: ['standards/coreStandards.mjs:principleDocsProblem', ...DELTA_ENTRIES, E.disputePass, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之有效 principle;文件取筆記記錄之 docId(缺者以筆記 id 計)',
    },
    {
        ...coreStd('ES13'),
        object: '參數之條件;入口 新參數(試套整份差量後之證據等級)',
        proves: '證據等級為最低級或未評估之參數,conditions 須含限制語(自承限制片語或詞彙表之弱證據句)',
        notProves: '限制語之內容是否恰當(使用者判讀)',
        enforcedAt: [...DELTA_ENTRIES, 'stores/evidence.mjs:makeEvidence', E.domain, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之有效參數;證據等級與限制片語取提煉 domain(未給證據判定者不檢)',
    },
    {
        id: ES14.std,
        title: '爭議為真對立(兩席覆核)',
        object: '未解決且帶終審存疑之爭議(存疑後核心再升版達門檻者);入口 爭議覆核專步,預設關',
        kind: 'ai',
        v: ES14.v,
        proves: '爭議為真對立:兩個不同供應者之席位得出同一類別(不一致時第三席;題組逐案評);真對立 → 存疑結案(md 加註)、非對立 → 經同一納入閘拆解(各方轉主張)、判不了 → 登錄待判(使用者)',
        notProves: '何方正確',
        enforcedAt: ['standards/disputeCheck.mjs:disputeDueOf', 'standards/disputeCheck.mjs:disputeItemsOf', 'standards/disputeCheck.mjs:runDisputeCheck', 'standards/disputeCheck.mjs:dissolveOpOf', 'standards/disputeCheck.mjs:doubtCheckedOf', E.disputePass, E.pass, E.persist, E.stage, E.domain],
        scan: false,
        scanNote: '未掃:AI 判定以題組逐案評;掃描列由核心狀態推得之已檢、合格、版本過時、受檢總量、到期數與待判之未結、已豁免(見掃描之 ai.ES14;覆核只記於狀態之 doubtChecks)',
    },
    {
        ...coreStd(ES15.std),
        object: '逾限出隊之筆記(多次未交代去向而出隊);入口 每次 pass 落盤後、重審段之重送',
        proves: `逾限筆記一律登錄待判(期限 ${EXTRACT_HOLD_DEADLINE_DAYS} 天;記當時之提示詞識別);提示詞或起草席位變更、或使用者要求重試 → 重審段重送,涵蓋即結案、再逾限即更新登錄`,
        notProves: '重送後能否涵蓋',
        enforcedAt: ['stores/coreDelta.mjs:commitBatch', E.persist, 'stages/extractStage.mjs:extractPromptId', 'stores/extractHolds.mjs:extractHoldDeadlineOf', 'standards/recheck.mjs:recheckItemsOf', E.stage, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之逾限筆記;待判登錄任一狀態皆算(未給待判集合 → 未能判定)',
    },
    {
        ...coreStd('ES16'),
        object: '本質;入口 本質之寫入(起草與本質專步)',
        proves: '本質之數字事實見於所引主張之存活出處(不含主張文字);材料同 ES2',
        notProves: '數字所指與推論是否成立(ES9)',
        enforcedAt: ['standards/coreStandards.mjs:groundingOf', ...DELTA_ENTRIES, E.material, E.stage, E.judge, E.scan],
        scan: true,
        scanNote: '主核心之本質;材料同 ES2',
    },
    {
        id: 'ES17',
        title: '主張文字不提及筆記',
        kind: 'program',
        v: 1,
        object: '條目之文字(理由除外);入口 全部差量',
        proves: '文字不殘留本批代號或筆記連結(出處由出處欄記錄);新進轉修訂意見、定稿仍殘留即不採;內容欄不自動轉連結',
        notProves: '主張之可讀性',
        enforcedAt: ['standards/coreStandards.mjs:noteMentionsOf', ...DELTA_ENTRIES, E.apply],
        scan: false,
        scanNote: '未掃:納入閘為唯一執行處(新進轉修訂意見、定稿仍殘留即不採);存量之文字無本批之語境,形如代號者(如型號 N95)判不了,不以之列違反',
    },
].map((s) => Object.freeze({
    // 欄序固定(報表與比對之輸出可重現)
    id: s.id, title: s.title, object: s.object, kind: s.kind, v: s.v, proves: s.proves, notProves: s.notProves,
    enforcedAt: Object.freeze([...s.enforcedAt]), scan: s.scan, scanNote: s.scanNote,
})))

/** 不經納入閘之寫入入口(檔頭【不經納入閘之寫入入口】;每列 { entry:'檔:函數', kind:'undo'＝回退｜'mechanical'＝機械寫入, why }) */
export const EXTRACT_UNGATED_WRITE_ENTRIES = Object.freeze([
    { entry: 'standards/stockFix.mjs:rollbackCoreStockFix', kind: 'undo', why: '存量處置之回退:寫回處置前之整份狀態(不驗不變式;回到處置前者才寫)' },
    { entry: 'ops/regenCore.mjs:regenCore', kind: 'mechanical', why: '打掉重練:封存狀態檔與核心 md(不寫新內容;其後以現有筆記從頭提煉,新內容照過閘)' },
    { entry: 'stores/coreState.mjs:releaseHeld', kind: 'mechanical', why: '隔離之解除:使用者豁免之待判 → 解除隔離(記帳欄位,不升版、不改條目)' },
    { entry: 'standards/stockFix.mjs:edgeSeenSyncOf', kind: 'mechanical', why: '邊庫快照之換簽章:關聯之存量處置改寫邊時同步快照之簽章(不產生影響事件)' },
    { entry: 'stores/coreProjection.mjs:writeProjections', kind: 'mechanical', why: '以狀態重建投影:md、cores 記錄、筆記之提煉時刻與渲染雜湊之回寫(不改條目)' },
    { entry: 'stores/coreProjection.mjs:repairCore', kind: 'mechanical', why: '壞檔之修復:以上一版落盤並重建投影(高水位只動版次與 id 計數)' },
    { entry: 'stores/coreProjection.mjs:settleTwins', kind: 'mechanical', why: '分身之併入:封存分身之 md 與狀態檔、改寫為轉址頁(不改主核心)' },
].map((x) => Object.freeze(x)))

/** 符合度掃描逐件判定之標準 id(scan 為 true 者;依全集之序——與 CORE_STANDARDS 同序) */
export const EXTRACT_AUDITED_STANDARD_IDS = Object.freeze(EXTRACT_STANDARDS.filter((s) => s.scan).map((s) => s.id))

/** 符合度掃描列檢核紀錄與待判之標準 id(依全集之序) */
export const EXTRACT_AI_STANDARD_IDS = Object.freeze(EXTRACT_STANDARDS.filter((s) => [ES8.std, ES9.std, ES11.std, ES14.std].includes(s.id)).map((s) => s.id))

export default { EXTRACT_STANDARDS, EXTRACT_UNGATED_WRITE_ENTRIES, EXTRACT_AUDITED_STANDARD_IDS, EXTRACT_AI_STANDARD_IDS }
