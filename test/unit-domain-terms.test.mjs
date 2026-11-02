// unit-domain-terms.test.mjs — 領域中立:①本套件之中立題材與識別字不被詞表誤傷(詞表與命中函數取抓取套件之 test/tools/domainTerms,經
//   test/tools/captureForTest;四套件同一份,其自檢在抓取套件之 unit-domain-terms)
//   ②零設定與預設詞彙下,提示詞覆寫之 17 鍵之產出(以中立輸入;重審段之全部理由與兩種棒次)、規則表、核心 md 版型皆不含詞表之詞
//   ③負對照:給回量化之原值與原句,產出即帶回該領域之詞——中立來自詞彙表之預設,提示詞本身不寫死領域之例
// 【掃描各只在一處】非測試、非評分之原始碼(含註解、JSDoc 與字串)、package.json、README、預設設定與預設詞彙(含 guide.extract 之預設)
//   與零設定組裝之 info() 之掃描在 unit-extract-package ⑤(具名例外亦只在該處列明);bench/ 之原始碼與通用題組在 unit-extract-bench ⑥——
//   本檔不另掃一份(同一規則兩處手寫,例外清單必然各自漂移)
// 規則(出自抓取套件 test/tools/domainTerms 檔頭):中文以子字串;英文以詞界、不分大小寫、容字尾變化;識別字、檔名、模型條目 id 之片段不命中
// 執行:自套件根 node <mocha> test/unit-domain-terms.test.mjs(唯讀;不寫檔、不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import { DOMAIN_TERM_RE, domainTermsIn } from './tools/captureForTest.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { EXTRACT_VOCAB_DEFAULT, resolveExtractVocab } from '../src/core/vocab/extractVocab.mjs'
import { renderRules } from '../src/stores/stateDigest.mjs'
import { emptyState } from '../src/stores/coreState.mjs'
import { promptArgsOf, PROMPT_MEMBERS, ES_PROMPT_INPUTS } from './tools/promptInputs.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'

/** 中立題材之代表文字(不得命中) */
const NEUTRAL = {
    天文: [
        '恆星演化與紅移之觀測：以望遠鏡量測視差，推算系外行星之軌道週期；半人馬座 α 星為距太陽最近之恆星系統',
        'Stellar parallax, redshift surveys and the orbital period of an exoplanet measured by a space telescope',
    ],
    醫學: [
        '隨機對照臨床試驗之設計：受試者分組、雙盲、樣本數與統計檢定力；不良反應之通報與追蹤',
        'A randomized controlled trial with blinded outcome assessment, sample size planning and adverse event reporting',
    ],
    物理: [
        '動量守恆與能量守恆：碰撞前後之總動量不變；量子穿隧與波函數之機率解釋',
        'Conservation of momentum and energy in particle collisions; quantum tunneling through a potential barrier',
    ],
    識別字與相近字: [
        'quantum、quantity、supportStock、stockNeeds、stock-fix.jsonl、oc:opencode/fledge-alpha-free、alphabet、future work、trade-off、node:crypto、cryptography',
    ],
}

/** 重審段之全部理由(各型單獨、全部並列、只有新關聯) */
const REASONS = ['changed', 'conflict', 'conflictGone', 'resend', 'relationChanged', 'conflictReason', 'partner']
const recheckItem = (reason, i) => ({ code: `N${i + 1}`, reason, citedBy: ['C1'], anchorTitle: '丙篇', anchorItems: ['C2'], kind: i % 2 ? 'retire' : 'retype', newType: '延伸深化', why: '理由' })
const RECHECK_SETS = [...REASONS.map((r) => [recheckItem(r, 0)]), REASONS.map(recheckItem), [recheckItem('partner', 0), recheckItem('partner', 1)]]

/** 中立之核心狀態(各種條目皆有:四種主張、爭議、參數、待解問題、本質),供版型之掃描 */
function neutralState() {
    const s = emptyState({ coreId: 'k', concept: '甲概念', scope: 'concept' })
    s.version = 2
    s.essence = { text: '甲之本質', claims: ['C1'], sources: ['n1'], at: '' }
    s.claims = ['principle', 'rule', 'pitfall', 'temporal'].map((kind, i) => ({ id: `C${i + 1}`, kind, text: `甲之主張${i + 1}`, status: 'active', sources: ['n1'], evidence: { level: i ? '中' : '低' } }))
    s.disputes = [{ id: 'D1', question: '甲是否成立', status: 'open', sides: [{ position: '成立', claims: ['C1'] }, { position: '不成立', sources: ['n1'] }] }]
    s.parameters = [{ id: 'P1', name: '參數乙', value: '1 到 2', status: 'active', sources: ['n1'] }]
    s.questions = [{ id: 'Q1', text: '甲在條件二之下是否成立', status: 'open', sources: ['n1'] }]
    return s
}

/**
 * 一個 domain 之全部可掃描之產出:17 鍵(提示詞 13 支、終審附錄、重審段〔全部理由 × 兩種棒次〕、條件規則、規則表)與核心 md 版型
 *
 * @param {Object} d 輸入提煉 domain
 * @returns {Object} 回傳 { 名: 文字 }
 */
function outputsOf(d) {
    const args = promptArgsOf(renderRules(d.rules), d.kb)
    const out = { rules: renderRules(d.rules), withdrawnRule: JSON.stringify(d.withdrawnRule()) }
    for (const [key, member] of Object.entries(PROMPT_MEMBERS)) {
        if (['rules', 'withdrawnRule', 'recheckText'].includes(key)) continue
        out[key] = d[member](...args[key])
    }
    RECHECK_SETS.forEach((items, i) => {
        for (const stage of ['draft', 'review']) out[`recheckText#${i}:${stage}`] = d.buildRecheckText(items, { stage })
    })
    const notes = new Map([['n1', { id: 'n1', title: '甲篇', sourceName: '來源甲', claimType: '理論模型' }]])
    out.renderState = d.renderState(neutralState(), { notesById: notes, noTopOf: () => false }).body
    return out
}

/** 一組產出之命中(名 → 詞;只列有命中者) */
const hitsOf = (outputs) => Object.fromEntries(Object.entries(outputs).map(([k, t]) => [k, domainTermsIn(t)]).filter(([, h]) => h.length))

describe('unit-domain-terms', function() {

    // ── ① 本套件之中立題材與識別字不被詞表誤傷(詞表本身之自檢在抓取套件)──

    it('中立題材(天文、醫學、物理)與本套件之識別字(supportStock、stockNeeds、存量處置帳之檔名)不命中;詞表之掃描用正則與命中函數於此諸例一致', () => {
        for (const [topic, texts] of Object.entries(NEUTRAL)) for (const s of texts) assert.deepEqual(domainTermsIn(s), [], `${topic}:${s}`)
        for (const s of Object.values(NEUTRAL).flat()) assert.equal(DOMAIN_TERM_RE.test(s), false, s)
        assert.deepEqual(domainTermsIn('只談套利'), ['套利'], '正向對照:詞表確能命中')
    })

    // ── ② 預設之產出 ──

    it('測試之輸入本身中立(掃描量的是提示詞,不是輸入)', () => {
        assert.deepEqual(domainTermsIn(JSON.stringify([promptArgsOf('', '知識庫'), ES_PROMPT_INPUTS, RECHECK_SETS], (k, v) => (v instanceof Map ? [...v] : v))), [])
        assert.deepEqual(domainTermsIn(JSON.stringify(neutralState())), [])
    })

    it('零設定與預設詞彙下:17 鍵之產出(提示詞、終審附錄、重審段、條件規則、規則表)與核心 md 版型皆不含領域詞', () => {
        for (const d of [createExtractDomain({}), createExtractDomain({ vocab: resolveExtractVocab({}) }), createExtractDomain({ vocab: EXTRACT_VOCAB_DEFAULT })]) {
            const out = outputsOf(d)
            assert.ok(Object.keys(out).length >= 16 + RECHECK_SETS.length * 2, '掃描涵蓋 17 鍵與版型')
            assert.deepEqual(hitsOf(out), {})
        }
    })

    // ── ③ 負對照 ──

    it('負對照:給回量化之原值與原句(證據性質封頂、自承限制片語、推定詞、guide 7 欄)→ 產出帶回該領域之詞,且只在詞彙所及之鍵', () => {
        const hits = hitsOf(outputsOf(createExtractDomain({ vocab: QUANT_VOCAB })))
        // 規則表(「擇自」之清單)與引規則表之各步、出處支持覆核、依出處收斂之修訂、爭議覆核、同義覆核(guide 之原句)
        assert.deepEqual(Object.keys(hits).sort(), ['audit', 'consolidate', 'disputeCheck', 'essence', 'integrate', 'propose', 'review', 'revise', 'rules', 'supportCheck', 'supportRevise', 'synonymCheck'].sort())
        assert.ok(hits.rules.includes('樣本外') && hits.supportCheck.includes('市場') && hits.synonymCheck.includes('套利'))
    })
})
