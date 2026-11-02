// promptInputs.mjs — 測試用之提示詞輸入(中立題材;共用層,不帶 .test. 中綴)
//
// 【為何要有】提示詞之逐字基準(golden)、提示詞覆寫之測試與領域中立掃描須以同一組固定輸入呼叫各支提示詞——輸入各寫一份即各自漂移
//   (基準之產生腳本與比對之測試對不上)。題材一律中立(不含 domainTerms 之詞),使中立掃描只量提示詞本身。
// 【內容】①ES_PROMPT_INPUTS:檢定標準之六支提示詞(出處支持覆核、依出處收斂之修訂、失撐找支持、爭議覆核、同義覆核、同義提議)之輸入,
//   各支至少走過其條件分支(推論類與非推論類、各方之條件／證據性質／所引主張、轉為主張與否、有無本質與主張)②PROMPT_MEMBERS:提示詞覆寫之鍵 →
//   domain 之成員 ③promptArgsOf(rulesText):全部可覆寫之提示詞成員(rules 除外)之原參數

/** 出處(S 標號;中立題材) */
const SOURCES = Object.freeze([
    Object.freeze({ label: 'S1', title: '甲篇', text: '甲之內容：在條件一之下，兩組觀測皆出現現象甲。' }),
    Object.freeze({ label: 'S2', title: '乙篇', text: '乙之內容：理論推導顯示現象甲與參數乙成正比。' }),
])

/**
 * 檢定標準之六支提示詞之輸入(鍵即提示詞覆寫之鍵)
 *
 * @type {Object}
 */
export const ES_PROMPT_INPUTS = Object.freeze({
    supportCheck: Object.freeze({
        concept: '甲概念',
        sources: SOURCES,
        items: [
            { index: 1, kind: 'add', text: '在條件一之下會出現現象甲', basis: '', labels: ['S1'] },
            { index: 2, kind: 'revise', text: '在條件一之下，現象甲與參數乙成正比', basis: '理論', labels: ['S2'] },
            { index: 3, kind: 'side', text: '現象甲普遍存在', basis: '案例', labels: ['S1', 'S2'] },
        ],
    }),
    supportRevise: Object.freeze({
        concept: '甲概念',
        sources: SOURCES,
        items: [
            { index: 1, kind: 'add', text: '現象甲普遍存在', conditions: ['條件一'], period: '第一期', labels: ['S1'], reasons: ['語氣超出證據：出處只涉及兩組觀測'] },
            { index: 2, kind: 'side', text: '參數乙決定現象甲', conditions: [], period: '', labels: ['S2'], reasons: ['語氣超出證據：只有理論推導', '語氣超出證據：未載條件'] },
        ],
    }),
    orphanCheck: Object.freeze({
        concept: '甲概念',
        sources: SOURCES,
        items: [
            { index: 1, text: '在條件一之下會出現現象甲', basis: '' },
            { index: 2, text: '在條件一之下，現象甲與參數乙成正比', basis: '理論推導' },
        ],
    }),
    disputeCheck: Object.freeze({
        concept: '甲概念',
        sources: SOURCES,
        items: [
            {
                index: 1,
                question: '現象甲是否隨參數乙增加？',
                doubt: { reason: '非對立', note: '兩方回答不同問題' },
                sides: [
                    { position: '會隨之增加', conditions: ['條件一'], basis: '理論', claims: [{ id: 'C1', text: '現象甲與參數乙成正比', conditions: ['條件一'] }], labels: ['S2'], toClaim: false },
                    { position: '不會隨之增加', conditions: [], basis: '', claims: [], labels: ['S1'], toClaim: true },
                ],
            },
            {
                index: 2,
                question: '現象甲是否持續出現？',
                doubt: { reason: '同篇', note: '' },
                sides: [
                    { position: '持續出現', conditions: [], basis: '', claims: [], labels: ['S1'], toClaim: true },
                    { position: '只出現一次', conditions: ['第二期'], basis: '轉述', claims: [], labels: [], toClaim: true },
                ],
            },
        ],
    }),
    synonymCheck: Object.freeze([
        { index: 1, a: { concept: '甲概念', essence: '甲之本質', claims: ['主張一', '主張二'], notes: ['甲篇'] }, b: { concept: '甲之概念', essence: '', claims: [], notes: [] } },
        { index: 2, a: { concept: '乙概念', essence: '', claims: [], notes: [] }, b: { concept: '丙概念', essence: '丙之本質', claims: ['主張三'], notes: ['乙篇', '丙篇'] } },
    ]),
    synonymPropose: Object.freeze(['甲概念', '乙概念', '甲之概念']),
})

/**
 * 提示詞覆寫之鍵 → domain 之成員(rules 為資料成員)
 *
 * @type {Object}
 */
export const PROMPT_MEMBERS = Object.freeze({
    propose: 'buildProposePrompt',
    review: 'buildReviewPrompt',
    consolidate: 'buildConsolidatePrompt',
    essence: 'buildEssencePrompt',
    recheckText: 'buildRecheckText',
    withdrawnRule: 'withdrawnRule',
    rules: 'rules',
    integrate: 'buildIntegratePrompt',
    audit: 'buildAuditPrompt',
    revise: 'buildRevisePrompt',
    acceptAppendix: 'buildAcceptAppendix',
    supportCheck: 'buildSupportCheckPrompt',
    supportRevise: 'buildSupportRevisePrompt',
    orphanCheck: 'buildOrphanCheckPrompt',
    disputeCheck: 'buildDisputeCheckPrompt',
    synonymPropose: 'buildSynonymProposePrompt',
    synonymCheck: 'buildSynonymCheckPrompt',
})

/**
 * 全部可覆寫之提示詞成員(rules 除外)之原參數(中立題材;各支走過其主要分支)
 *
 * @param {String} rulesText 輸入規則表文字(renderRules 之產物)
 * @param {String} [kb='知識庫'] 輸入知識庫之稱呼(整合、審計、修訂之輸入帶之)
 * @returns {Object} 回傳 { <鍵>: Array(原參數) }(鍵同 PROMPT_MEMBERS,不含 rules)
 */
export function promptArgsOf(rulesText, kb = '知識庫') {
    const batch = [{ code: 'N1', id: 'n1', digest: '### N1 甲篇\n【一句話重點】\n甲之重點' }, { code: 'N2', id: 'n2', digest: '### N2 乙篇\n【核心知識】\n乙之知識' }]
    const op = { op: 'add', ref: 'a', kind: 'rule', text: '若條件一則現象甲', sources: ['N1'], critique: '只有兩組觀測', pros: ['出處未載'], cons: ['出處未載'] }
    return {
        propose: [{ concept: '甲概念', scope: 'concept', digest: '〔C1〕甲之主張', batch, rulesText, relations: '- R1 N1 ↔ N2〔衝突或反例；衝突〕：甲乙相反' }],
        review: [{ concept: '甲概念', scope: 'concept', mode: 'delta', ops: [op, { op: 'retract', id: 'C1', reason: '重複', into: 'C2' }], batch, touched: '〔C1〕甲之主張', rulesText }],
        consolidate: [{ concept: '甲概念', scope: 'concept', digest: '〔C1〕甲之主張', live: 81, cap: 80, rulesText }],
        essence: [{ concept: '甲概念', scope: 'category', digest: '〔C1〕甲之主張', live: 3, need: 'stale', why: '所引〔C2〕已被取代', rulesText }],
        recheckText: [[{ code: 'N1', reason: 'changed', citedBy: ['C1'] }, { code: 'N2', reason: 'conflict', anchorTitle: '丙篇', anchorItems: ['C2'] }], { stage: 'draft' }],
        withdrawnRule: [],
        integrate: [{ kb, concept: '甲概念', rulesText, cands: [{ seat: 1, ops: [{ ...op, _oid: 'a1_1' }], skipped: [{ note: 'N2', reason: '離題' }] }, { seat: 2, ops: [], skipped: [] }], votes: new Map([['a1_1', { votes: 1 }]]), digestIndex: '〔C1〕（索引）', batchCodes: ['N1', 'N2'] }],
        audit: [{ kb, concept: '甲概念', rulesText, ops: [{ ...op, _oid: 'i_1', _votes: 2 }], flags: ['i_1 數字：出處未見'], missing: [], touched: '', batch, relations: '' }],
        revise: [{ kb, concept: '甲概念', rulesText, ops: [{ ...op, _oid: 'i_1' }], issues: [{ k: 0, ref: 'i_1', severity: '中', type: '空話', detail: '可更具體', fix: '補條件' }], fixable: { add: ['text', 'conditions', 'sources'] }, touched: '', batch }],
        acceptAppendix: [{ issues: [{ ref: 'i_1', severity: '中', type: '空話', detail: '可更具體' }], patchLog: [{ ok: true, act: 'edit', ref: 'i_1', why: '補條件' }] }],
        supportCheck: [ES_PROMPT_INPUTS.supportCheck],
        supportRevise: [ES_PROMPT_INPUTS.supportRevise],
        orphanCheck: [ES_PROMPT_INPUTS.orphanCheck],
        disputeCheck: [ES_PROMPT_INPUTS.disputeCheck],
        synonymPropose: [ES_PROMPT_INPUTS.synonymPropose],
        synonymCheck: [ES_PROMPT_INPUTS.synonymCheck],
    }
}

export default { ES_PROMPT_INPUTS, PROMPT_MEMBERS, promptArgsOf }
