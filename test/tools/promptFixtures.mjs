// promptFixtures.mjs — 七類 prompt 之固定輸入與一次產出(預設 prompt 標準檔之產製與 unit-guide 測試共用)
//
// 只經公開工廠(createTriageDomain／createExtractDomain／createRelateDomain／createDistillDomain)產出,
// 故同一份輸入可用於「改版前凍結標準檔」與「改版後比對」。輸入皆為中立假資料,網址僅用保留網域 example.com。

import { createTriageDomain } from '../../src/domain/triageDomain.mjs'
import { createExtractDomain } from '../../src/domain/extractDomain.mjs'
import { createRelateDomain } from '../../src/domain/relateDomain.mjs'
import { createDistillDomain } from '../../src/domain/distillDomain.mjs'

const TRIAGE_DOCS = [
    { title: '標題甲', sourceName: '來源甲', text: '開頭片段甲' },
    { title: '標題乙', sourceName: '來源乙', feedText: '開頭片段乙' },
]
const EXTRACT_DOCS = [
    { title: '標題甲', sourceName: '來源甲', url: 'https://example.com/a', text: '內文甲' },
]
const CONCEPT_VOCAB = ['概念甲(3)', '概念乙(2)']
const RELATE_TARGETS = [
    { id: 'n1', title: '筆記甲', category: '方法與技術', concepts: ['概念甲'], summary: '重點甲', evidenceLevel: '中', caveats: ['樣本小'] },
]
const RELATE_CANDS = () => new Map([['n1', [{ id: 'n2', title: '筆記乙', category: '方法與技術', concepts: ['概念甲'], summary: '重點乙', evidenceLevel: '高' }]]])
const DISTILL_NOTES = [
    { id: 'n1', title: '筆記甲', file: '', sourceName: '來源甲', sourceUrl: 'https://example.com/a', claimType: '實證研究', evidenceLevel: '中' },
]
const DRAFT = { essence: '本質', principles: ['原理'], rules: [] }
const ISSUES = [{ severity: '低', type: '空話', where: 'essence', detail: '填充句' }]

/**
 * 以指定之 domain 工廠與詞彙表產出七類 prompt(及預篩預設理由);工廠可換成他版實作以逐字比對
 *
 * @param {Object} f 輸入工廠物件 { createTriageDomain, createExtractDomain, createRelateDomain, createDistillDomain }
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件(交給各 domain 工廠之 opt.vocab)
 * @returns {Object} 回傳 { triage, triageReason, extract, extractNoVocab, relate, distillBase, distillBasePrior, audit, revise, final }
 */
export function renderPromptsWith(f, vocab = null) {
    const triage = f.createTriageDomain({ vocab })
    const extract = f.createExtractDomain({ vocab })
    const relate = f.createRelateDomain({ vocab })
    const distill = f.createDistillDomain({ vocab })
    const t = { concept: '概念甲', scope: 'concept' }
    return {
        triage: triage.buildPrompt(TRIAGE_DOCS),
        triageReason: triage.reasonOf({}),
        extract: extract.buildPrompt(EXTRACT_DOCS, CONCEPT_VOCAB),
        extractNoVocab: extract.buildPrompt(EXTRACT_DOCS, []),
        relate: relate.buildPrompt(RELATE_TARGETS, RELATE_CANDS()),
        distillBase: distill.buildBasePrompt(t, DISTILL_NOTES, ''),
        distillBasePrior: distill.buildBasePrompt({ concept: '類別甲', scope: 'category' }, DISTILL_NOTES, '既有核心本文'),
        audit: distill.kinds.audit.build({ concept: '概念甲', basePrompt: '基底任務', draft: DRAFT }),
        revise: distill.kinds.revise.build({ draft: DRAFT, issues: ISSUES }),
        final: distill.kinds.accept.build({ draft: DRAFT, issues: ISSUES }),
    }
}

/**
 * 以本套件之 domain 工廠產出七類 prompt
 *
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件
 * @returns {Object} 回傳同 renderPromptsWith
 */
export function renderAllPrompts(vocab = null) {
    return renderPromptsWith({ createTriageDomain, createExtractDomain, createRelateDomain, createDistillDomain }, vocab)
}

export default renderAllPrompts
