// unit-extract-prompts.test.mjs — 提煉 domain 之提示詞覆寫(opt.prompts 之 17 鍵;EXTRACT_PROMPT_SIGS)
// 規格:①覆寫函數收原參數＋末參數 ctx { kbLabel, domain, vocab, defaultPrompt },defaultPrompt＝該成員之內建函數(包裝後逐字等於內建)
//   ②建構期驗形狀:opt.prompts 非物件、不認得之鍵、值非函數即拋(抓取套件之 promptOverridesOf;訊息「須為函數 (參數) => 回傳」同摘要／關聯套件
//     之 domain 工廠,回傳之說明取 SIGS 之 returns——呼叫期之回傳檢查同讀);undefined／null 之值＝用內建;詞彙不合先於提示詞拋
//   ③呼叫期之回傳檢查依鍵:13 支提示詞須非空字串;終審附錄與重審段須為字串(可空——無內容時合法回 '');條件規則須為規則物件或 null;
//     規則表(rules,建構時套用一次)須為非空之規則陣列(id 不重複)
//   ④只覆寫一支者,其餘逐字為內建;覆寫之規則表為各步提示詞與爭議覆核之判準所讀(同一份)
// 執行:自套件根 node <mocha> test/unit-extract-prompts.test.mjs(純函數,不寫檔、不呼叫 AI)

import assert from 'node:assert/strict'
import { createExtractDomain, EXTRACT_PROMPT_SIGS, defaultRules } from '../src/domain/extractDomain.mjs'
import { resolveExtractVocab } from '../src/core/vocab/extractVocab.mjs'
import { renderRules } from '../src/stores/stateDigest.mjs'
import { emptyState, withdrawSources, DEFAULT_LIMITS } from '../src/stores/coreState.mjs'
import { runPass, rulesTextOf } from '../src/workflow/runPass.mjs'
import { seedCore, seatAi, SEATS, keepAll } from './tools/extractKit.mjs'
import { promptArgsOf, PROMPT_MEMBERS, ES_PROMPT_INPUTS } from './tools/promptInputs.mjs'
import { msgOf } from './tools/captureForTest.mjs'

const V = { domain: '天文學' }
const RULES_TEXT = renderRules(createExtractDomain({ vocab: V }).rules)
const ARGS = promptArgsOf(RULES_TEXT, '「天文學」知識庫')
/** 回傳字串之鍵(呼叫期須非空) */
const TEXT_KEYS = ['propose', 'review', 'consolidate', 'essence', 'integrate', 'audit', 'revise', 'supportCheck', 'supportRevise', 'orphanCheck', 'disputeCheck', 'synonymPropose', 'synonymCheck']
/** 可呼叫之成員之鍵(rules 為資料成員,另測) */
const CALL_KEYS = Object.keys(EXTRACT_PROMPT_SIGS).filter((k) => k !== 'rules')
/** 呼叫某鍵之成員 */
const call = (d, key, args = ARGS[key]) => d[PROMPT_MEMBERS[key]](...args)
/** 合格之條件規則 */
const RULE = { id: 'withdrawn', priority: 99, text: '自訂之條件規則' }
/** 各鍵之合格回傳(覆寫用) */
const OK_OF = (key) => (key === 'withdrawnRule' ? RULE : `自訂-${key}`)

describe('unit-extract-prompts', function() {

    it('EXTRACT_PROMPT_SIGS:17 鍵與覆寫函數之形式 { params, returns? }(凍結;returns 未給為提示詞字串);鍵與 domain 成員一一對應', () => {
        const P = (params, returns) => ({ params, ...(returns ? { returns } : {}) })
        assert.deepEqual(EXTRACT_PROMPT_SIGS, {
            propose: P('(input, ctx)'), review: P('(input, ctx)'), consolidate: P('(input, ctx)'), essence: P('(input, ctx)'), recheckText: P('(items, opt, ctx)', '字串（無重審段時回 \'\'）'),
            withdrawnRule: P('(ctx)', '規則物件 { id, priority, text } 或 null'), rules: P('(defaultRules, ctx)', '非空之規則陣列 [{ id, priority, text }]'),
            integrate: P('(input, ctx)'), audit: P('(input, ctx)'), revise: P('(input, ctx)'), acceptAppendix: P('(input, ctx)', '字串（無附錄時回 \'\'）'),
            supportCheck: P('(input, ctx)'), supportRevise: P('(input, ctx)'), orphanCheck: P('(input, ctx)'), disputeCheck: P('(input, ctx)'), synonymPropose: P('(names, ctx)'), synonymCheck: P('(items, ctx)'),
        })
        assert.equal(Object.keys(EXTRACT_PROMPT_SIGS).length, 17)
        assert.ok(Object.isFrozen(EXTRACT_PROMPT_SIGS) && Object.values(EXTRACT_PROMPT_SIGS).every(Object.isFrozen))
        assert.deepEqual(Object.keys(PROMPT_MEMBERS), Object.keys(EXTRACT_PROMPT_SIGS), '測試之對照涵蓋全部鍵')
        const d = createExtractDomain({})
        for (const [key, member] of Object.entries(PROMPT_MEMBERS)) assert.ok(member in d, `${key} → ${member}`)
    })

    it('覆寫函數收原參數＋末參數 ctx { kbLabel, domain, vocab, defaultPrompt };回傳即為成員之回傳;只覆寫一支者其餘逐字為內建(16 支可呼叫之成員)', () => {
        const plain = createExtractDomain({ vocab: V })
        for (const key of CALL_KEYS) {
            const seen = []
            const d = createExtractDomain({ vocab: V, prompts: { [key]: (...a) => {
                seen.push(a)
                return OK_OF(key)
            } } })
            assert.deepEqual(call(d, key), OK_OF(key), key)
            assert.equal(seen.length, 1, key)
            const a = seen[0]
            assert.equal(a.length, ARGS[key].length + 1, `${key}:原參數＋ctx`)
            assert.deepEqual(a.slice(0, -1), ARGS[key], key)
            const ctx = a.at(-1)
            assert.deepEqual(Object.keys(ctx), ['kbLabel', 'domain', 'vocab', 'defaultPrompt'], `${key}:ctx 四欄`)
            assert.deepEqual([ctx.kbLabel, ctx.domain, ctx.vocab.domain, typeof ctx.defaultPrompt], ['「天文學」知識庫', '天文學', '天文學', 'function'], key)
            for (const k2 of CALL_KEYS) if (k2 !== key) assert.deepEqual(call(d, k2), call(plain, k2), `覆寫 ${key} 不影響 ${k2}`)
            assert.deepEqual(d.rules, plain.rules, `覆寫 ${key} 不影響規則表`)
        }
    })

    it('defaultPrompt 為內建函數:包裝後逐字等於內建、可加前後文(字串者)', () => {
        for (const key of CALL_KEYS) {
            const builtin = call(createExtractDomain({ vocab: V }), key)
            const wrap = createExtractDomain({ vocab: V, prompts: { [key]: (...a) => a.at(-1).defaultPrompt(...a.slice(0, -1)) } })
            assert.deepEqual(call(wrap, key), builtin, key)
            if (typeof builtin !== 'string') continue
            const deco = createExtractDomain({ vocab: V, prompts: { [key]: (...a) => `前言\n${a.at(-1).defaultPrompt(...a.slice(0, -1))}\n附註` } })
            assert.equal(call(deco, key), `前言\n${builtin}\n附註`, key)
        }
    })

    it('呼叫期之回傳檢查:13 支提示詞須非空字串;終審附錄與重審段須為字串(可空);條件規則須為規則物件或 null(不加條件規則)', () => {
        for (const key of TEXT_KEYS) {
            for (const bad of ['', '   ', 123, undefined, null, {}]) {
                assert.equal(msgOf(() => call(createExtractDomain({ prompts: { [key]: () => bad } }), key)), `opt.prompts.${key} 須回傳非空字串`, `${key}=${JSON.stringify(bad)}`)
            }
        }
        for (const [key, what] of [['acceptAppendix', '無附錄時'], ['recheckText', '無重審段時']]) {
            assert.equal(call(createExtractDomain({ prompts: { [key]: () => '' } }), key), '', `${key}:空字串合法`)
            for (const bad of [123, undefined, null, {}, ['x']]) {
                assert.equal(msgOf(() => call(createExtractDomain({ prompts: { [key]: () => bad } }), key)), `opt.prompts.${key} 須回傳字串（${what}回 ''）`, `${key}=${JSON.stringify(bad)}`)
            }
        }
        assert.equal(call(createExtractDomain({ prompts: { withdrawnRule: () => null } }), 'withdrawnRule'), null, '條件規則可為 null')
        const W = (p) => `opt.prompts.withdrawnRule 須回傳規則物件 { id, priority, text } 或 null（${p}）`
        for (const [bad, p] of [
            [undefined, '須為物件 { id, priority, text }'], ['x', '須為物件 { id, priority, text }'], [[RULE], '須為物件 { id, priority, text }'],
            [{ ...RULE, id: '' }, 'id 須為非空字串'], [{ ...RULE, priority: '99' }, '「withdrawn」之 priority 須為數字'], [{ ...RULE, priority: NaN }, '「withdrawn」之 priority 須為數字'],
            [{ ...RULE, text: ' ' }, '「withdrawn」之 text 須為非空字串'],
        ]) assert.equal(msgOf(() => call(createExtractDomain({ prompts: { withdrawnRule: () => bad } }), 'withdrawnRule')), W(p), JSON.stringify(bad))
    })

    it('條件規則之覆寫:核心有出處已撤之條目時,回 null 者規則表不加條件規則、回規則物件者加於末(各步同讀之 rulesTextOf);無此類條目時不呼叫', () => {
        const s0 = seedCore({ coreId: 'k', concept: '甲', ops: [{ op: 'add', kind: 'rule', text: '若條件一則現象甲', sources: ['N1'], critique: '只有兩組觀測', pros: ['出處未載'], cons: ['出處未載'] }], batch: [{ code: 'N1', id: 'n1' }], at: '2026-01-01T00:00:00+08:00' })
        const s = withdrawSources(s0, { withdraw: [{ id: 'n1', title: '甲篇', reason: 'deleted' }], at: '2026-01-02T00:00:00+08:00' }).state
        const builtin = createExtractDomain({})
        assert.equal(rulesTextOf(builtin, s), renderRules([...builtin.rules, builtin.withdrawnRule()]), '前提:內建者加條件規則')
        const none = createExtractDomain({ prompts: { withdrawnRule: () => null } })
        assert.equal(rulesTextOf(none, s), renderRules(none.rules))
        const own = createExtractDomain({ prompts: { withdrawnRule: () => RULE } })
        assert.equal(rulesTextOf(own, s), renderRules([...own.rules, RULE]))
        let calls = 0
        const counted = createExtractDomain({ prompts: { withdrawnRule: () => (calls++, RULE) } })
        assert.equal(rulesTextOf(counted, s0), renderRules(counted.rules))
        assert.equal(calls, 0, '無出處已撤之條目 → 不呼叫')
    })

    it('非陣列之清單輸入以 [] 交覆寫函數(與內建同一正規化);重審段之 opt 非物件以 {} 交', () => {
        const got = []
        const d = createExtractDomain({ prompts: {
            synonymPropose: (names) => (got.push(['p', names]), 'x'),
            synonymCheck: (items) => (got.push(['c', items]), 'y'),
            recheckText: (items, o) => (got.push(['r', items, o]), ''),
        } })
        d.buildSynonymProposePrompt('x')
        d.buildSynonymCheckPrompt(null)
        d.buildRecheckText(undefined, 'draft')
        assert.deepEqual(got, [['p', []], ['c', []], ['r', [], {}]])
    })

    it('規則表(rules):建構時套用一次,收內建規則表之複本與 ctx(defaultPrompt 回內建規則表);覆寫之規則表即 domain.rules,各步提示詞與爭議覆核之判準同讀', () => {
        const vocab = resolveExtractVocab(V)
        const builtin = defaultRules(vocab, DEFAULT_LIMITS)
        const seen = []
        const extra = { id: 'extra', priority: 14, text: '自訂之規則：天文觀測須寫明觀測條件。' }
        const d = createExtractDomain({ vocab: V, prompts: { rules: (rules, ctx) => {
            seen.push([rules, ctx])
            return [...rules.map((r) => (r.id === 'disputeBoundary' ? { ...r, text: '【非對立之界線】自訂之界線。' } : r)), extra]
        } } })
        assert.equal(seen.length, 1, '建構時一次')
        assert.deepEqual(seen[0][0], builtin, '收內建規則表')
        assert.deepEqual(Object.keys(seen[0][1]), ['kbLabel', 'domain', 'vocab', 'defaultPrompt'])
        assert.deepEqual(seen[0][1].defaultPrompt(), builtin, 'defaultPrompt 回內建規則表(新複本)')
        assert.notEqual(seen[0][1].defaultPrompt(), seen[0][0])
        assert.equal(d.rules.at(-1), extra)
        assert.ok(call(d, 'propose', promptArgsOf(renderRules(d.rules)).propose).includes('自訂之規則：天文觀測須寫明觀測條件。'), '起草提示詞讀覆寫之規則表(呼叫端以 renderRules(domain.rules) 組)')
        assert.ok(d.buildDisputeCheckPrompt(ES_PROMPT_INPUTS.disputeCheck).includes('判準：\n【非對立之界線】自訂之界線。\n'), '爭議覆核之判準(未另給 boundary)取覆寫之規則表')
        const wrap = createExtractDomain({ vocab: V, prompts: { rules: (rules, ctx) => ctx.defaultPrompt() } })
        assert.deepEqual(wrap.rules, createExtractDomain({ vocab: V }).rules, '包裝內建 → 同內建')
        const R = (p) => `opt.prompts.rules 須回傳非空之規則陣列 [{ id, priority, text }]（${p}）`
        for (const [bad, p] of [
            [[], '須為非空陣列'], [undefined, '須為非空陣列'], ['x', '須為非空陣列'], [[null], '第 1 條：須為物件 { id, priority, text }'],
            [[{ id: 'a', priority: 1 }], '第 1 條：「a」之 text 須為非空字串'], [[RULE, { ...RULE, text: '另一條' }], 'id「withdrawn」重複'],
        ]) assert.equal(msgOf(() => createExtractDomain({ prompts: { rules: () => bad } })), R(p), JSON.stringify(bad))
    })

    it('建構期:值非函數 → 拋(附函數形式「(參數) => 回傳」——同摘要／關聯套件之 domain 工廠);opt.prompts 非物件 → 拋;不認得之鍵 → 拋並列可用鍵;undefined／null 值 → 用內建;詞彙不合先於提示詞拋', () => {
        const keys = Object.keys(EXTRACT_PROMPT_SIGS)
        for (const key of keys) {
            const { params, returns = '提示詞字串' } = EXTRACT_PROMPT_SIGS[key]
            for (const bad of ['x', 1, {}, [], true]) {
                assert.equal(msgOf(() => createExtractDomain({ prompts: { [key]: bad } })), `createExtractDomain 之 opt.prompts.${key} 須為函數 ${params} => ${returns}`, `${key}=${JSON.stringify(bad)}`)
            }
            for (const v of [undefined, null]) {
                const d = createExtractDomain({ prompts: { [key]: v } })
                if (key === 'rules') assert.deepEqual(d.rules, createExtractDomain({}).rules)
                else assert.deepEqual(call(d, key), call(createExtractDomain({}), key), `${key}=${v}`)
            }
        }
        const objMsg = `createExtractDomain 之 opt.prompts 須為物件 { ${keys.join(', ')} }（各為覆寫提示詞之函數）`
        assert.equal(msgOf(() => createExtractDomain({ prompts: 'x' })), objMsg)
        assert.equal(msgOf(() => createExtractDomain({ prompts: [() => 'x'] })), objMsg)
        assert.equal(msgOf(() => createExtractDomain({ prompts: { summarize: () => 'x', relate: () => 'y' } })), `createExtractDomain 之 opt.prompts 含不認得之鍵：summarize、relate（可用：${keys.join('、')}）`)
        assert.equal(msgOf(() => createExtractDomain({ prompts: { summarize: () => 'x', rules: 'bad' } })), `createExtractDomain 之 opt.prompts 含不認得之鍵：summarize（可用：${keys.join('、')}）`, '不認得之鍵先於值之型別')
        assert.doesNotThrow(() => createExtractDomain({ prompts: null }))
        assert.match(msgOf(() => createExtractDomain({ vocab: { categoryHints: {} }, prompts: 'x' })), /^vocab 含不認得之鍵：categoryHints/, '詞彙先驗')
    })

    it('3+3 之整合、審計、修訂、終審附錄經 domain 呼叫(runPass):覆寫之產出即送出之提示詞;未覆寫者逐字為內建', async () => {
        const add = { op: 'add', kind: 'rule', text: '若條件一則現象甲', sources: ['N1'], critique: '只有兩組觀測', pros: ['出處未載'], cons: ['出處未載'] }
        const replies = {
            d1: { ops: [add], skipped: [{ note: 'N2', reason: '離題' }] }, d2: { ops: [add], skipped: [] }, d3: 'fail',
            int: { ops: [{ ...add, via: ['a1_1', 'a2_1'] }], skipped: [{ note: 'N2', reason: '離題' }] },
            aud: { issues: [{ ref: 'i_1', severity: '中', type: '空話', detail: '可更具體', fix: '補條件' }] }, rev: { edits: [], adds: [], removes: [] }, acc: keepAll,
        }
        const batch = [{ code: 'N1', id: 'n1', digest: '### N1 甲篇\n【核心知識】\n若條件一則現象甲' }, { code: 'N2', id: 'n2', digest: '### N2 乙篇\n【核心知識】\n乙之知識' }]
        const notesById = new Map([['n1', { id: 'n1', title: '甲篇', docId: 'd1', evidenceLevel: '中' }], ['n2', { id: 'n2', title: '乙篇', docId: 'd2', evidenceLevel: '中' }]])
        const run = async (domain) => {
            const ai = seatAi(replies)
            const r = await runPass({ state: emptyState({ coreId: 'k', concept: '甲概念' }), concept: '甲概念', batch, domain, seats: SEATS, ai, notesById, at: '2026-01-01T00:00:00+08:00' })
            assert.equal(r.ok, true, r.error)
            return ai.prompts
        }
        const plain = await run(createExtractDomain({}))
        const mark = (k) => (input, ctx) => `${ctx.defaultPrompt(input)}〔覆寫:${k}〕`
        const custom = await run(createExtractDomain({ prompts: { integrate: mark('integrate'), audit: mark('audit'), revise: mark('revise'), acceptAppendix: mark('acceptAppendix') } }))
        assert.deepEqual([custom.int, custom.aud, custom.rev], [`${plain.int}〔覆寫:integrate〕`, `${plain.aud}〔覆寫:audit〕`, `${plain.rev}〔覆寫:revise〕`])
        assert.equal(custom.acc, `${plain.acc}〔覆寫:acceptAppendix〕`, '終審＝終審提示詞＋附錄(附錄經 domain)')
        assert.equal(custom.d1, plain.d1, '起草不受影響')
    })

    it('輸出之驗證不隨覆寫改變:資料成員(主張種類、長度上限、證據判定、弱證據之說法、證據規則)、筆記分節摘要、絕對語氣、版型逐一同內建', () => {
        const plain = createExtractDomain({ vocab: V })
        const all = Object.fromEntries(CALL_KEYS.map((k) => [k, () => OK_OF(k)]))
        const custom = createExtractDomain({ vocab: V, prompts: all })
        assert.deepEqual(Object.keys(custom), Object.keys(plain))
        for (const k of ['kb', 'claimKinds', 'limits', 'rules', 'weakEvidence', 'contentKeyVersion']) assert.deepEqual(custom[k], plain[k], k)
        assert.equal(JSON.stringify(custom.evidenceRule), JSON.stringify(plain.evidenceRule))
        assert.deepEqual(custom.evidence.levels, plain.evidence.levels)
        for (const b of ['理論', '實務經驗', '獨立驗證']) assert.deepEqual(custom.evidence.basisRank(b), plain.evidence.basisRank(b), b)
        const note = { id: 'n', title: 'T', caveats: [] }
        const md = { front: { title: 'T', conflicts: [] }, body: '# T\n\n## 核心知識\n\n- 甲\n' }
        assert.deepEqual(custom.noteDigest(note, md, { code: 'N1' }), plain.noteDigest(note, md, { code: 'N1' }))
        assert.equal(custom.toneOf('此法總是有效'), plain.toneOf('此法總是有效'))
        const st = emptyState({ coreId: 'k', concept: '甲' })
        st.claims = [{ id: 'C1', kind: 'rule', text: '若甲則乙', status: 'active', sources: ['n'], basis: '理論', evidence: { level: '中' } }]
        assert.equal(custom.renderState(st, { notesById: new Map([['n', note]]) }).body, plain.renderState(st, { notesById: new Map([['n', note]]) }).body)
    })
})
