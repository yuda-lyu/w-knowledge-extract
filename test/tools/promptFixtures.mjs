// promptFixtures.mjs — 各類 prompt 之固定輸入與一次產出(預設 prompt 標準檔之產製與 unit-guide 測試共用)
//
// 只經公開工廠(createTriageDomain／createExtractDomain／createRelateDomain／createDistillDomain)產出,
// 故同一份輸入可用於「改版前凍結標準檔」與「改版後比對」。輸入皆為中立假資料,網址僅用保留網域 example.com。
// 提煉於 2.0 改為主張庫＋差量(提案／審查／整併),1.x 之 distillBase／distillBasePrior／audit／revise／final 五鍵退役
// (標準檔 prompts-1.0.0.json 保留原樣、不重產;提煉之新鍵不在其中,由 unit-guide 以結構斷言驗證)。

import { createTriageDomain } from '../../src/domain/triageDomain.mjs'
import { createExtractDomain } from '../../src/domain/extractDomain.mjs'
import { createRelateDomain } from '../../src/domain/relateDomain.mjs'
import { createDistillDomain } from '../../src/domain/distillDomain.mjs'
import { emptyState, renderRules, stateDigest } from '../../src/stores/coreState.mjs'

const TRIAGE_DOCS = [
    { title: '標題甲', sourceName: '來源甲', text: '開頭片段甲' },
    { title: '標題乙', sourceName: '來源乙', feedText: '開頭片段乙' },
]
const EXTRACT_DOCS = [
    { title: '標題甲', sourceName: '來源甲', url: 'https://example.com/a', text: '內文甲' },
]
const CONCEPT_VOCAB = ['概念甲', '概念乙'] // 2.0 起 conceptVocabulary 預設只回名稱(1.0.0 標準檔為「概念甲(3)、概念乙(2)」)
const RELATE_TARGETS = [
    { id: 'n1', title: '筆記甲', category: '方法與技術', concepts: ['概念甲'], summary: '重點甲', evidenceLevel: '中', caveats: ['樣本小'] },
]
const RELATE_CANDS = () => new Map([['n1', [{ id: 'n2', title: '筆記乙', category: '方法與技術', concepts: ['概念甲'], summary: '重點乙', evidenceLevel: '高' }]]])
const DISTILL_NOTE = { id: 'n1', title: '筆記甲', sourceName: '來源甲', claimType: '實證研究', evidenceLevel: '中' }
const DISTILL_MD = { front: { published: '2026-01-01' }, body: '# 筆記甲\n\n## 一句話重點\n\n重點甲\n\n## 核心知識\n\n- 知識甲' }

/**
 * 既有核心狀態(提案之「目前狀態」與整併之完整摘要用)
 *
 * @param {String} concept 輸入概念名
 * @param {String} scope 輸入 'concept'|'category'
 * @returns {Object} 回傳狀態
 */
function priorState(concept, scope) {
    const s = emptyState({ coreId: 'k', concept, scope })
    s.version = 1
    s.essence = { text: '本質甲', claims: ['C1'], sources: ['n0'], at: '' }
    s.claims = [{ id: 'C1', kind: 'principle', text: '主張甲', status: 'active', sources: ['n0'], evidence: { level: '中' } }]
    return s
}

/**
 * 以指定之 domain 工廠與詞彙表產出各類 prompt(及預篩預設理由);工廠可換成他版實作以逐字比對
 *
 * @param {Object} f 輸入工廠物件 { createTriageDomain, createExtractDomain, createRelateDomain, createDistillDomain }
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件(交給各 domain 工廠之 opt.vocab)
 * @returns {Object} 回傳 { triage, triageReason, extract, extractNoVocab, relate, distillPropose, distillProposePrior, distillReview, distillConsolidate }
 */
export function renderPromptsWith(f, vocab = null) {
    const triage = f.createTriageDomain({ vocab })
    const extract = f.createExtractDomain({ vocab })
    const relate = f.createRelateDomain({ vocab })
    const distill = f.createDistillDomain({ vocab })
    const rulesText = renderRules(distill.rules)
    const batch = [{ code: 'N1', id: 'n1', digest: distill.noteDigest(DISTILL_NOTE, DISTILL_MD, { code: 'N1' }).text }]
    const prior = priorState('類別甲', 'category')
    const ops = [{ op: 'add', ref: 'a', kind: 'principle', text: '主張乙', basis: '案例', sources: ['N1'] }, { op: 'supersede', id: 'C1', by: '@a', reason: '新研究', validPeriod: '較早之研究', sources: ['N1'] }]
    return {
        triage: triage.buildPrompt(TRIAGE_DOCS),
        triageReason: triage.reasonOf({}),
        extract: extract.buildPrompt(EXTRACT_DOCS, CONCEPT_VOCAB),
        extractNoVocab: extract.buildPrompt(EXTRACT_DOCS, []),
        relate: relate.buildPrompt(RELATE_TARGETS, RELATE_CANDS()),
        distillPropose: distill.buildProposePrompt({ concept: '概念甲', scope: 'concept', digest: '', batch, rulesText }),
        distillProposePrior: distill.buildProposePrompt({ concept: '類別甲', scope: 'category', digest: stateDigest(prior), batch, rulesText }),
        distillReview: distill.buildReviewPrompt({ concept: '概念甲', scope: 'concept', mode: 'delta', ops, batch, touched: '〔C1〕主張甲（active｜證據中｜出處 1 篇）', rulesText }),
        distillConsolidate: distill.buildConsolidatePrompt({ concept: '類別甲', scope: 'category', digest: stateDigest(prior, { full: true }), live: 81, cap: 80, rulesText }),
    }
}

/**
 * 以本套件之 domain 工廠產出各類 prompt
 *
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件
 * @returns {Object} 回傳同 renderPromptsWith
 */
export function renderAllPrompts(vocab = null) {
    return renderPromptsWith({ createTriageDomain, createExtractDomain, createRelateDomain, createDistillDomain }, vocab)
}

export default renderAllPrompts
