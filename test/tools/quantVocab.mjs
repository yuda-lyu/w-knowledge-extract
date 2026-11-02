// quantVocab.mjs — 測試用之量化詞彙(詞彙表之覆寫;共用層,不帶 .test. 中綴)
//
// 【為何要有】本套件之預設詞彙為領域中立。部分測試之斷言(證據性質之標記、規則表之「擇自」清單、推定之標記、提示詞之領域例)依一組具體之
//   領域詞彙而寫:這些案以本檔之詞彙覆寫保留原斷言(不改斷言遷就中立預設);提示詞之逐字基準(golden 之覆寫重現)亦以之證明——安裝方給回
//   這組原值與原句,提示詞即逐字重現。本檔為其唯一一份(不在各測試檔手寫第二份)。
// 【值】自有之鍵(basisCaps、selfLimitPhrases)為中立化之前之預設值;推定詞與 guide.extract 之 7 欄為量化領域之原句——只作測試之夾具,
//   不是本套件之預設。最高證據等級之要件(evidenceRule)另見摘要套件之 test/tools/quantRule.mjs(經 summarizeForTest 取 QUANT_RULE;需推定之案自行併入)。

/** 證據性質封頂(中立化之前之預設值;鍵序即規則表「擇自」之序) */
export const QUANT_BASIS_CAPS = Object.freeze({ 樣本外: 0, 樣本內: 1, 理論: 1, 模擬: 1, 案例: 1, 實務: -1, 教學: -1, 觀點: -1, 廠商: -1, 轉述: -1, '*': 1 })

/** 自承限制片語(中立化之前之預設值) */
export const QUANT_SELF_LIMIT_PHRASES = Object.freeze(['僅樣本內', '單一研究', '同一研究', '僅摘要', '未經獨立驗證', '未經驗證'])

/** 推定詞(與 quantRule 之要件成對) */
export const QUANT_PRESUMED_BASIS = '樣本內'

/** guide.extract 之 7 欄之原句(出處支持覆核、修訂、爭議覆核、同義覆核之領域例) */
export const QUANT_GUIDE_EXTRACT = Object.freeze({
    narrowScope: '單一樣本、樣本內、特定市場或期間、有前提條件',
    broadScope: '更多市場、期間、資產或情境',
    reviseScope: '樣本、市場或期間',
    opposedObjects: '市場、資產、樣本',
    sameExample: '「數據與特徵」與「資料與特徵」',
    subtopicExample: '「套利」與「統計套利」',
    siblingExample: '「市場廣度」與「市場情緒」',
})

/**
 * 量化詞彙之覆寫(交 createExtractDomain／resolveExtractVocab 之 vocab;他鍵照預設)
 *
 * @type {Object}
 */
export const QUANT_VOCAB = Object.freeze({
    basisCaps: QUANT_BASIS_CAPS,
    selfLimitPhrases: QUANT_SELF_LIMIT_PHRASES,
    presumedBasis: QUANT_PRESUMED_BASIS,
    guide: Object.freeze({ extract: QUANT_GUIDE_EXTRACT }),
})

export default QUANT_VOCAB
