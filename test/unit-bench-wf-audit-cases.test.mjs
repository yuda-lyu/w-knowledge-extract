// unit-bench-wf-audit-cases.test.mjs — 審計(wf-audit)與起草(wf-draft)內建題組之材料須與應然一致(使用端 Gitea #89)
//   spec 依據(R 編號供追溯):
//   R1 審計提示詞之「高」＝不改會留下錯誤知識或遺失知識(domain/prompts.mjs buildAuditPrompt);狀態摘要對「已有主張而無本質」之核心載明
//      「本批須以 essence 綜合現有主張」(stores/stateDigest.mjs)——審計所見之被觸及條目含此句時,操作中無 essence 即屬「遺漏」(遺失知識 → 高),
//      意見之 ref 寫既有主張編號即指向確認／修訂該主張之操作(issueOnOp)→ 乾淨之操作被列高嚴重度意見。故既有狀態有主張之案須附本質。
//   R2 乾淨之操作之標注(利／弊)不寫出處所無之內容:非「出處未載」者逐條列於本檔 GROUNDED 帳,每條附出處中的原文片段(程式核對片段確在該案之出處)
//      ——審計對「出處所無之標注」列高嚴重度「捏造」屬正確,題組不得使乾淨之操作因此不乾淨。標注與片段之語意對應由人工審定(帳),片段是否在出處由程式判。
//   R3 題組之各案皆過準備期(同 planExtractBench);改材料後提示詞仍為正式之 buildAuditPrompt／buildProposePrompt
//   R4 審計之植入缺陷不得為爭議類操作:正式之移除判準對爭議類操作另有移除方自述理由之分支(reviewGuards.removalAllowed),
//      謂詞 flags 只判意見面(removalIssueOf),內建題組須不落入該分支之差異
//   R5 起草之 kinds 預期須與材料一致:單一案例之觀察不預期 rule、爭議之一方之依據不預期為獨立之 pitfall;
//      pitfall 之材料寫失效情境而非操作指示;principle 之材料為兩個相異來源同以「…之原則」立論
//   R6 題組 note 寫明與正式移除判準一致之應然與三條守則(note 與謂詞同步;含 expect.clean 與正式移除判準對稱,R7)
//   「材料不含未被任何操作收入之知識」「標注語意」屬語意判斷,無法程式判定;逐案見規則帳本(rulebook_bench.md),實效以 AI 評比驗證(本檔不呼叫 AI)
// 執行(套件根):node node_modules/mocha/bin/mocha.js --timeout 180000 test/unit-bench-wf-audit-cases.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { planExtractBench, EXTRACT_BENCH_CASES_FILES } from '../src/bench/extractBench.mjs'
import { DISPUTE_OPS } from '../src/stores/coreState.mjs'

const MARK = '本批須以 essence 綜合現有主張'
const read = (id) => JSON.parse(fs.readFileSync(EXTRACT_BENCH_CASES_FILES[id], 'utf8'))
const audit = read('wf-audit')
const draft = read('wf-draft')
const caseOf = (set, id) => set.cases.find((c) => c.id === id)
/** 案之出處全文(各篇相接) */
const textOf = (c) => c.input.sources.map((s) => s.text).join('\n')

/**
 * 乾淨之操作之利／弊中非「出處未載」者之帳(案 id、操作 _oid、欄、標注、出處中支持該標注之原文片段)
 *   增列標注而未列於本帳即失敗——須人工核對標注確為出處所載再入帳
 *
 * @type {Array}
 */
const GROUNDED = [
    ['a03', 'a1_1', 'pros', '降低爛根風險', '不易爛根'],
    ['a04', 'a1_2', 'pros', '維持出風順暢', '維持出風順暢'],
    ['a06', 'a1_1', 'pros', '減少光害干擾', '遠離光害'],
    ['a07', 'a1_1', 'pros', '肉質較軟嫩', '肉質較軟嫩'],
    ['a08', 'a1_1', 'pros', '可隨體溫調整', '隨體溫增減衣物'],
    ['a09', 'a1_1', 'pros', '參觀者較能專注', '參觀者較能專注'],
    ['a11', 'a1_2', 'pros', '利於後續處理', '利於後續處理'],
    ['a12', 'a1_1', 'pros', '較易持續', '較易持續'],
]

describe('unit-bench-wf-audit-cases: 審計／起草題組之材料與應然一致', function() {

    it('R1 既有狀態有主張之審計案皆附本質(state.essence.text 非空、所引主張皆在狀態)', () => {
        const withClaims = audit.cases.filter((c) => (c.input?.state?.claims || []).length)
        assert.deepEqual(withClaims.map((c) => c.id), ['a05', 'a10', 'a12'], '有既有主張之案(增減須同步檢視本質)')
        const bad = []
        for (const c of withClaims) {
            const claims = c.input.state.claims
            const ess = c.input.state.essence
            if (!ess || typeof ess.text !== 'string' || !ess.text.trim()) bad.push(`${c.id}：有主張而無本質`)
            else if (!(ess.claims || []).length || !ess.claims.every((id) => claims.some((x) => x.id === id))) bad.push(`${c.id}：本質所引主張不在狀態`)
        }
        assert.deepEqual(bad, [])
    })

    it('R1 審計各頁提示詞皆不含「本批須以 essence 綜合現有主張」(審計不因本質缺漏而對確認既有主張之乾淨操作列遺漏)', () => {
        const plan = planExtractBench('wf-audit')
        assert.equal(plan.pages.length, audit.cases.length)
        const hit = plan.pages.filter((p) => p.prompt.includes(MARK)).map((p) => p.ids[0])
        assert.deepEqual(hit, [])
    })

    it('R1 反證:拿掉本質後提示詞即含該句(本檢核確實咬得住);附本質則不含', () => {
        const c = structuredClone(caseOf(audit, 'a05'))
        const withEss = planExtractBench('wf-audit', { cases: [structuredClone(c)] })
        assert.equal(withEss.pages[0].prompt.includes(MARK), false)
        delete c.input.state.essence
        const without = planExtractBench('wf-audit', { cases: [c] })
        assert.ok(without.pages[0].prompt.includes(MARK))
    })

    /**
     * 乾淨之操作之利／弊之問題:非「出處未載」者須在 GROUNDED 帳、帳內片段須在該案之出處、帳內每條須有對應之標注
     *
     * @param {Object} set 輸入題組
     * @param {Array} [ledger=GROUNDED] 輸入帳
     * @returns {Array} 回傳問題說明陣列
     */
    const groundedProblems = (set, ledger = GROUNDED) => {
        const p = []
        const seen = new Set()
        for (const c of set.cases) {
            for (const oid of c.expect.clean || []) {
                const op = c.input.ops.find((x) => x._oid === oid)
                for (const f of ['pros', 'cons']) {
                    for (const t of op[f] || []) {
                        if (t === '出處未載') continue
                        const key = [c.id, oid, f, t].join('｜')
                        seen.add(key)
                        if (!ledger.some((g) => g.slice(0, 4).join('｜') === key)) p.push(`${c.id}.${oid}.${f}「${t}」未列於帳(須核對確為出處所載)`)
                    }
                }
            }
        }
        for (const g of ledger) {
            const c = caseOf(set, g[0])
            if (!c || !seen.has(g.slice(0, 4).join('｜'))) p.push(`帳之 ${g.slice(0, 4).join('.')} 在題組中無對應之標注`)
            else if (!textOf(c).includes(g[4])) p.push(`${g[0]} 之標注「${g[3]}」所憑片段「${g[4]}」不在出處`)
        }
        return p
    }

    it('R2 乾淨之操作之利／弊:非「出處未載」者皆在 GROUNDED 帳,且帳內片段確在該案之出處(增列未審之標注即失敗)', () => {
        assert.deepEqual(groundedProblems(audit), [])
    })

    it('R2 反證:乾淨之操作之利／弊寫出處所無之內容(舊題組之 a01 a1_1「擴大服務時段」、a11 a1_1「便於後續處理」)→ 檢出;帳之片段不在出處 → 檢出', () => {
        const mut = structuredClone(audit)
        caseOf(mut, 'a01').input.ops.find((x) => x._oid === 'a1_1').pros = ['擴大服務時段']
        caseOf(mut, 'a11').input.ops.find((x) => x._oid === 'a1_1').pros = ['便於後續處理']
        const p = groundedProblems(mut)
        assert.ok(p.some((x) => x.startsWith('a01.a1_1.pros「擴大服務時段」')), p.join('；'))
        assert.ok(p.some((x) => x.startsWith('a11.a1_1.pros「便於後續處理」')), p.join('；'))
        const wrongQuote = GROUNDED.map((g) => (g[0] === 'a03' ? [...g.slice(0, 4), '出處所無之片段'] : g))
        assert.ok(groundedProblems(audit, wrongQuote).some((x) => x.includes('出處所無之片段')))
        assert.ok(groundedProblems(audit, GROUNDED.slice(1)).some((x) => x.includes('a03.a1_1.pros「降低爛根風險」未列於帳')))
    })

    it('R3 審計、起草各 16 案皆過準備期(planExtractBench 不拋)', () => {
        for (const id of ['wf-audit', 'wf-draft']) {
            const plan = planExtractBench(id)
            assert.equal(plan.set.cases.length, 16, id)
            assert.equal(plan.pages.length, 16, id)
        }
    })

    it('R4 審計之植入缺陷皆非爭議類操作(正式之移除判準對爭議類另有 reason 分支,謂詞只判意見面)', () => {
        const hit = []
        for (const c of audit.cases) for (const oid of Object.keys(c.expect.flags || {})) {
            if (DISPUTE_OPS.has(c.input.ops.find((x) => x._oid === oid).op)) hit.push(`${c.id}.${oid}`)
        }
        assert.deepEqual(hit, [])
    })

    it('R5 起草 kinds 預期與材料一致:單一案例之觀察(d01)、爭議一方之依據(d09)不預期種類;d03 之陷阱材料為失效情境、dh4 之 principle 材料為兩個來源同以「…之原則」立論', () => {
        assert.equal('kinds' in caseOf(draft, 'd01').expect, false, 'd01 之材料為單一館之觀察,非可操作之規則')
        assert.equal('kinds' in caseOf(draft, 'd09').expect, false, 'd09 之 n2 為乙方立場之依據,屬爭議之一方')
        const d03 = caseOf(draft, 'd03')
        assert.deepEqual(d03.expect.kinds, ['rule', 'pitfall'])
        assert.ok(/若受陽光直射/.test(textOf(d03)) && !/避免陽光直射/.test(textOf(d03)), 'd03:陷阱寫成失效情境(若…易…),不是操作指示(避免…以免…)')
        const dh4 = caseOf(draft, 'dh4')
        assert.deepEqual(dh4.expect.kinds, ['principle', 'pitfall'])
        assert.ok(dh4.input.sources.length >= 2 && dh4.input.sources.every((s) => /原則/.test(s.text)), 'dh4:兩個來源皆以「…之原則」立論')
    })

    it('R6 題組 note 寫明與正式移除判準一致之應然與守則(審計)、kinds 之守則(起草)', () => {
        assert.match(audit.note, /重複不論嚴重度/, '審計:重複不論嚴重度')
        assert.match(audit.note, /removalAllowed|移除判準/, '審計:同正式之移除判準')
        assert.match(audit.note, /足以使正式流程移除/, '審計:expect.clean 與正式移除判準對稱(R7)')
        assert.match(audit.note, /出處未載/, '審計:標注不寫出處所無之內容')
        assert.match(audit.note, /本質/, '審計:既有主張附本質')
        assert.match(audit.note, /未被任何操作收入/, '審計:材料只含被操作收入之知識')
        assert.match(draft.note, /kinds/, '起草:kinds 之守則')
        assert.match(draft.note, /爭議/, '起草:爭議之一方之依據不預期獨立之種類')
    })
})
