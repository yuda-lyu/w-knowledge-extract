// unit-bench-wf-concept.test.mjs — 工作流類八角色(wf-*)之內建題組須自給概念名(input.state.concept),且準備期守門拒收缺概念名或明給預設概念名之案
//   spec 依據(R 編號供追溯):
//   R1 正式提示詞之規則 1「只收與本概念直接相關之知識;離題之筆記列入 skipped(理由「離題」)」(domain/extractDomain.mjs 規則表 offtopic)與審計提示詞之「離題」意見,
//      皆以「概念名」為準;未給時 coreStateOf 預設為 ES_CASE_CONCEPT(「題組」),而題組之材料為與之無關之合成情境,模型依規則 1 全判離題,
//      題組與正式提示詞互相衝突、得分不反映模型能力 → 八個 wf 角色之題組每案須自給概念名(非空、非預設值)
//   R2 概念名經 coreStateOf 進狀態,各角色之正式提示詞首段即以之稱呼本概念 → 各頁提示詞首段為該案概念名,全文不含預設概念名「題組」
//   R3 缺概念名之題組靜默(準備期無問題、付費跑完才以低分現形)→ 共用之 wf 守門(wfInputProblems)於準備期拒收缺、為空或明給預設值之案,訊息指明欄名 input.state.concept
//   R4 非 wf 角色(判定類六角色)之提示詞無離題規則 → 不要求概念名,題組、提示詞照舊;ES_CASE_CONCEPT 之值與 coreStateOf 之預設不變(非 wf 角色仍用)
//   「概念名涵蓋應收材料、不涵蓋應判離題者」屬語意判斷,無法程式判定:逐案之概念名、涵蓋與排除見 sgud/rule 之規則帳本,實效由 AI 評比驗證(本檔不呼叫 AI)
// 執行(套件根):node node_modules/mocha/bin/mocha.js --timeout 180000 test/unit-bench-wf-concept.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { planExtractBench, EXTRACT_BENCH_CASES_FILES, EXTRACT_BENCH_ROLE_IDS, EXTRACT_BENCH_USAGE } from '../src/bench/extractBench.mjs'
import { ES_CASE_CONCEPT, coreStateOf } from '../src/standards/esCases.mjs'
import { msgOf } from './tools/captureForTest.mjs'

/** 工作流類八角色(正式提示詞含離題規則者) */
const WF_IDS = ['wf-audit', 'wf-accept', 'wf-pending', 'wf-integrate', 'wf-draft', 'wf-revise', 'wf-consolidate', 'wf-essence']
/** 判定類六角色(提示詞無離題規則) */
const JUDGE_IDS = ['support-check', 'support-revise', 'orphan-check', 'dispute-check', 'synonym-check', 'synonym-propose']

/** 讀內建題組原檔 */
const readSet = (role) => JSON.parse(fs.readFileSync(EXTRACT_BENCH_CASES_FILES[role], 'utf8'))

/** 複製一案並移除概念名(state 只剩 concept 者連 state 一併移除,使其回到「未給 state」) */
const withoutConcept = (c) => {
    const x = structuredClone(c)
    if (x.input.state) {
        delete x.input.state.concept
        if (!Object.keys(x.input.state).length) delete x.input.state
    }
    return x
}

/** 複製一案並把概念名設為指定值(無 state 者補 state) */
const withConcept = (c, concept) => {
    const x = structuredClone(c)
    x.input.state = { ...(x.input.state || {}), concept }
    return x
}

describe('unit-bench-wf-concept: 工作流類八角色之題組概念名', function() {

    it('R1 角色全集:含離題規則之 wf 角色恰為八個(新增 wf 角色時須一併納入本檔)', () => {
        assert.deepEqual(EXTRACT_BENCH_ROLE_IDS.filter((id) => id.startsWith('wf-')).sort(), [...WF_IDS].sort())
        assert.deepEqual(EXTRACT_BENCH_ROLE_IDS.filter((id) => !id.startsWith('wf-')).sort(), [...JUDGE_IDS].sort())
    })

    for (const role of WF_IDS) {
        describe(role, function() {
            const set = readSet(role)

            it('R1 內建題組每案皆給 input.state.concept(非空字串、非預設「題組」、4～10 字)', () => {
                assert.equal(set.cases.length, 16, `${role} 案數`)
                const bad = []
                for (const c of set.cases) {
                    const concept = c.input?.state?.concept
                    if (typeof concept !== 'string' || concept.trim() === '' || concept !== concept.trim()) bad.push(`${c.id}：未給或為空`)
                    else if (concept === ES_CASE_CONCEPT) bad.push(`${c.id}：為預設概念名「${ES_CASE_CONCEPT}」`)
                    else if (concept.length < 4 || concept.length > 10) bad.push(`${c.id}：「${concept}」不在 4～10 字`)
                }
                assert.deepEqual(bad, [], role)
            })

            it('R2 內建題組通過準備期;各頁提示詞首段為該案概念名,全文不含預設概念名「題組」', () => {
                const plan = planExtractBench(role)
                assert.equal(plan.pages.length, set.cases.length, '一案一頁')
                for (const pg of plan.pages) {
                    const c = set.cases.find((x) => x.id === pg.ids[0])
                    assert.ok(c, `頁 ${pg.ids[0]} 對應題組之案`)
                    const concept = c.input.state?.concept ?? ''
                    assert.ok(concept !== '' && pg.prompt.split('\n')[0].includes(`「${concept}」`), `${c.id} 提示詞首段未見概念名「${concept}」`)
                    assert.ok(!pg.prompt.includes(`「${ES_CASE_CONCEPT}」`), `${c.id} 提示詞含預設概念名「${ES_CASE_CONCEPT}」`)
                }
            })

            it('R3 守門:題組之每一案,移除其概念名後於準備期被拒,訊息指明欄名 input.state.concept', () => {
                for (const c of set.cases) {
                    const m = msgOf(() => planExtractBench(role, { cases: [withoutConcept(c)] })) || ''
                    assert.match(m, /input\.state\.concept/, `${role} ${c.id} 缺概念名應被拒`)
                }
            })

            it('R3 守門:明給預設概念名「題組」、空字串、全空白之案亦被拒;給有效概念名之案通過', () => {
                const c = set.cases[0]
                for (const bad of [ES_CASE_CONCEPT, '', '   ']) {
                    const m = msgOf(() => planExtractBench(role, { cases: [withConcept(c, bad)] })) || ''
                    assert.match(m, /input\.state\.concept/, `${role} 概念名 ${JSON.stringify(bad)} 應被拒`)
                }
                assert.doesNotThrow(() => planExtractBench(role, { cases: [withConcept(c, '某個日常主題')] }), `${role} 有效概念名應通過`)
            })
        })
    }

    describe('R4 非 wf 角色不受影響', function() {
        it('判定類六角色之內建題組準備期照舊通過(不要求概念名;題組檔不含 input.state.concept)', () => {
            for (const role of JUDGE_IDS) {
                assert.doesNotThrow(() => planExtractBench(role), role)
                const withConceptField = readSet(role).cases.filter((c) => c.input?.state?.concept !== undefined).map((c) => c.id)
                assert.deepEqual(withConceptField, [], `${role} 題組不應被加概念名欄`)
            }
        })

        it('ES_CASE_CONCEPT 之值與 coreStateOf 之預設概念名不變(非 wf 角色仍用);判定類三角色之提示詞仍以之稱呼', () => {
            assert.equal(ES_CASE_CONCEPT, '題組')
            assert.equal(coreStateOf({}).state.concept, ES_CASE_CONCEPT)
            assert.equal(coreStateOf({ concept: '某概念' }).state.concept, '某概念')
            for (const role of ['support-check', 'orphan-check', 'dispute-check']) {
                assert.ok(planExtractBench(role).pages.every((pg) => pg.prompt.includes(`「${ES_CASE_CONCEPT}」`)), role)
            }
        })
    })

    it('R3 使用者可見之說明:命令列用法說明提及 wf 角色之案須給 input.state.concept', () => {
        assert.match(EXTRACT_BENCH_USAGE, /input\.state\.concept/)
    })
})
