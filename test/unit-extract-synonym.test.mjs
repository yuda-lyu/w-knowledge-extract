// unit-extract-synonym.test.mjs — 檢定標準 ES11(核心身分:同義概念不分立核心):候選對、單票、判定小組、同義核心核對專步之處置
// 規則:同義之核心以加別名後由筆記重新提煉處置——本套件只登錄待判(建議別名),不自動改詞彙表、不動核心。
// 執行:自套件根 node <mocha> test/unit-extract-synonym.test.mjs(暫存 test/_tmp/extract-syn-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { memStore, setConceptFold, resetConceptFold, waiveHold } from './tools/captureForTest.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import { PANEL_UNSURE } from '../src/core/summarizePackage.mjs'
import { holdKey } from '../src/core/capturePackage.mjs'
import { checkKey } from '../src/core/relatePackage.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { ES11, editDistance, pairKeyOf, nameCandidatesOf, proposedCandidatesOf, synonymHashOf, synonymCandidatesOf, synonymDueOf, checkSynonymVerdictOf, seatSynonymVotesOf, runSynonymCheck } from '../src/standards/synonymCheck.mjs'
import { runSynonymStep, SYNONYM_STATE_FILE } from '../src/stages/synonymStep.mjs'
import { recLog, panelAi } from './tools/extractKit.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'

let TMP = ''
const DOMAIN = createExtractDomain({})
const R = '兩者之本質與主張談的是同一件事'
const RD = '甲談統計套利之配對，乙談一般套利之定義'
let seq = 0

/**
 * 專步之環境:核心記錄與狀態(只讀)、holds／checks;AI 替身依 stage 回覆(synonymPropose／synonym1／synonym2／synonym3)
 * @param {Object} o 輸入 { cores:[{ id, concept, noteCount, essence, claims }], reply:(stage, prompt, seat)=>JSON|'fail', providers }
 * @returns {Object} 回傳 { env, ai, calls, log, holds, checks, dir }
 */
function mk(o = {}) {
    const dir = `${TMP}/e${++seq}`
    fs.mkdirSync(`${dir}/state`, { recursive: true })
    const cores = (o.cores || []).map((c) => ({ scope: 'concept', status: 'active', version: 1, ...c }))
    const states = new Map((o.cores || []).map((c) => [c.id, { coreId: c.id, concept: c.concept, essence: { text: c.essence || `${c.concept}之本質` }, claims: (c.claims || [`${c.concept}之主張`]).map((t, i) => ({ id: `C${i + 1}`, text: t, status: 'active', sources: [`n-${c.id}-${i}`] })) }]))
    const holds = memStore([])
    const checks = memStore([])
    const calls = []
    const providers = { synonymPropose: 'p:a', synonym1: 'p:a', synonym2: 'p:b', synonym3: 'p:c', ...(o.providers || {}) }
    // 提議席與覆核第一席同為 first:以提示詞之角色分(提議員／覆核員),覆核各席以席位條目分(呼叫之包裝取共用件 panelAi,test/tools/extractKit)
    const stageOf = (prompt, opt) => (/的同義概念提議員/.test(prompt) ? 'synonymPropose' : opt?.spec?.use)
    const ai = panelAi((stage, prompt) => {
        calls.push({ stage, prompt })
        return o.reply ? o.reply(stage, prompt) : null
    }, { stageOf, provider: (stage) => providers[stage] || stage })
    // 核心儲存之替身:四態分流表只有 ok／missing 兩態(專步只讀 readable)
    const store = {
        load: (id) => (states.has(id) ? { status: 'ok', state: states.get(id) } : { status: 'missing' }),
        loadUsable: (id) => (states.has(id) ? { status: 'ok', state: states.get(id), readable: true, writable: true, why: '' } : { status: 'missing', state: null, readable: false, writable: false, why: '狀態檔不存在' }),
    }
    const env = { cores, store, notesById: new Map(), dirs: { state: `${dir}/state` }, at: '2026-10-05T09:00:00+08:00', stores: { holds, checks } }
    const log = recLog()
    const run = (perRun = 10, x = {}) => runSynonymStep({ env, domain: DOMAIN, seats: { first: { use: 'synonym1' }, second: { use: 'synonym2' }, third: { use: 'synonym3' } }, ai, perRun, log, shouldStop: x.shouldStop, maxTries: x.maxTries, triesOf: x.triesOf })
    return { env, ai, calls, log, holds, checks, dir, run, states }
}
// 依提示詞之第 N 項回覆:決定函數 (甲概念, 乙概念, stage) → 票
const replyBy = (fn) => (stage, prompt) => {
    if (stage === 'synonymPropose') return { pairs: [] }
    const items = [...prompt.matchAll(/^--- 第(\d+)項 ---\n【甲】概念：(.+)\n[\s\S]*?【乙】概念：(.+)$/gm)].map((m) => ({ index: Number(m[1]), a: m[2], b: m[3] }))
    return { checks: items.map((it) => ({ index: it.index, ...fn(it.a, it.b, stage) })) }
}

describe('unit-extract-synonym', function() {

    before(() => {
        TMP = tmpRoot('extract-syn')
        resetConceptFold() // 總組裝(createKnowledgeExtract)會注入模組級之字形折疊,本檔之概念鍵不依賴他檔是否清乾淨
    })
    after(() => {
        resetConceptFold() // 模組級單例,不留給同 worker 之他檔
        removeRoots([TMP])
    })

    // ─── 純函數 ───

    it('editDistance／pairKeyOf／nameCandidatesOf:四字以下距離 ≤1、五字以上 ≤2、或一方包含另一方(較短者 ≥2 字);鍵無序', () => {
        assert.deepEqual([editDistance('最優執行', '最適執行'), editDistance('資料與特徵', '數據與特徵'), editDistance('', 'ab')], [1, 2, 2])
        assert.equal(pairKeyOf('乙', '甲'), pairKeyOf('甲', '乙'))
        const c = nameCandidatesOf(['最優執行', '最適執行', '資料與特徵', '數據與特徵', '套利', '統計套利', '市場廣度', '市場情緒', '動量因子', '價值因子', 'A', 'AB'])
        assert.deepEqual(c.map((x) => `${x.a}⇄${x.b}:${x.by}`).sort(), ['套利⇄統計套利:contain', '數據與特徵⇄資料與特徵:edit', '最優執行⇄最適執行:edit'].sort(),
            '市場廣度／市場情緒(四字距離 2)、動量因子／價值因子不入;單字之包含不算')
    })

    it('proposedCandidatesOf:只收名單內、不同名、去重;單票與逐項票:same／different 理由 ≥10 字、unsure 合法、同編號矛盾作廢', () => {
        const p = proposedCandidatesOf({ pairs: [{ a: '做市', b: '流動性提供', reason: '同一行為' }, { a: '做市', b: '不存在', reason: 'x' }, { a: '流動性提供', b: '做市', reason: '重複' }, { a: '做市', b: '做市' }] }, ['做市', '流動性提供'])
        assert.deepEqual(p.map((x) => [x.a, x.b, x.by]), [['做市', '流動性提供', 'propose']])
        assert.deepEqual(checkSynonymVerdictOf({ verdict: 'Same', reason: R }), { verdict: 'same', reason: R })
        assert.equal(checkSynonymVerdictOf({ verdict: 'same', reason: '短' }), null)
        assert.equal(checkSynonymVerdictOf({ verdict: 'unsure' }), PANEL_UNSURE)
        assert.equal(checkSynonymVerdictOf({ verdict: 'maybe', reason: R }), null)
        const m = seatSynonymVotesOf({ checks: [{ index: 1, verdict: 'same', reason: R }, { index: 2, verdict: 'same', reason: R }, { index: 2, verdict: 'different', reason: RD }, { index: 9, verdict: 'same', reason: R }] }, new Set([1, 2]))
        assert.deepEqual([m.get(1)?.verdict, m.get(2), m.has(9)], ['same', null, false])
    })

    it('runSynonymCheck:兩席一致(不同家)→ 成立;不一致 → 第三席只送該些項;同一供應者 → 不成立', async () => {
        const items = [{ key: 'k1', a: { concept: '甲' }, b: { concept: '乙' } }, { key: 'k2', a: { concept: '丙' }, b: { concept: '丁' } }]
        const seen = []
        const call = async (stage, seat, prompt) => {
            seen.push([stage, (prompt.match(/^--- 第\d+項 ---$/gm) || []).length])
            const idx = [...prompt.matchAll(/^--- 第(\d+)項 ---\n【甲】概念：(.+)$/gm)].map((x) => ({ i: Number(x[1]), a: x[2] }))
            const v = (a) => (a === '甲' ? { verdict: 'same', reason: R } : { verdict: stage === 'synonym2' ? 'same' : 'different', reason: stage === 'synonym2' ? R : RD })
            return { ok: true, json: { checks: idx.map((x) => ({ index: x.i, ...v(x.a) })) }, providerId: stage }
        }
        const r = await runSynonymCheck({ items, seats: { first: {}, second: {}, third: {} }, buildPrompt: (xs) => DOMAIN.buildSynonymCheckPrompt(xs), call })
        assert.deepEqual([r.decisions.get('k1').status, r.decisions.get('k1').verdict.verdict], ['decided', 'same'])
        assert.deepEqual([r.decisions.get('k2').status, r.decisions.get('k2').verdict.verdict], ['decided', 'different'], '第三席與第一席(different)成立')
        assert.deepEqual(seen, [['synonym1', 2], ['synonym2', 2], ['synonym3', 1]])
        const same = await runSynonymCheck({ items: items.slice(0, 1), seats: { first: {}, second: {} }, buildPrompt: (xs) => DOMAIN.buildSynonymCheckPrompt(xs), call: async (stage, seat, prompt) => ({ ok: true, json: { checks: [{ index: 1, verdict: 'same', reason: R }] }, providerId: 'p:same' }) })
        assert.deepEqual([same.decisions.get('k1').status, same.decisions.get('k1').why], ['undetermined', 'same-provider'])
    })

    it('提示詞:提議列全部核心名、要求逐字照抄;覆核列兩方之概念、本質、主張、出處;判準含子題算不同、unsure 合法', () => {
        const pp = DOMAIN.buildSynonymProposePrompt(['最優執行', '最適執行'])
        assert.match(pp, /的同義概念提議員。/)
        assert.match(pp, /只能用名單中出現的概念名，逐字照抄/)
        assert.match(pp, /【核心概念名】\n- 最優執行\n- 最適執行/)
        // 判準之領域例依量化詞彙之覆寫(guide.extract 之原句;本案之斷言依之)
        const cp = createExtractDomain({ vocab: QUANT_VOCAB }).buildSynonymCheckPrompt([{ index: 1, a: { concept: '最優執行', essence: '本質甲', claims: ['主張一'], notes: ['筆記一'] }, b: { concept: '最適執行', essence: '', claims: [], notes: [] } }])
        assert.match(cp, /--- 第1項 ---\n【甲】概念：最優執行\n本質：本質甲\n主要主張：\n- 主張一\n主要出處：筆記一\n【乙】概念：最適執行\n本質：（無）/)
        assert.match(cp, /一方是另一方之子題或上位概念（例如「套利」與「統計套利」）/)
        assert.match(cp, /- unsure：材料不足以判斷/)
    })

    // ─── 專步 ───

    it('專步:候選＝名稱相近 ∪ AI 提議(名單雜湊落檔);同一概念 → 待判(使用者,建議別名→正名:已用筆記多者為正名)＋檢核不合格;不同 → 檢核合格;下輪不重判、不重提議', async () => {
        const cores = [
            { id: 'c1', concept: '最優執行', noteCount: 3 },
            { id: 'c2', concept: '最適執行', noteCount: 9 },
            { id: 'c3', concept: '套利', noteCount: 5 },
            { id: 'c4', concept: '統計套利', noteCount: 5 },
            { id: 'c5', concept: '做市', noteCount: 4 },
            { id: 'c6', concept: '流動性提供', noteCount: 2 },
        ]
        const reply = (stage, prompt) => (stage === 'synonymPropose'
            ? { pairs: [{ a: '做市', b: '流動性提供', reason: '同一行為之不同說法' }] }
            : replyBy((a, b) => ((a.includes('執行') || a === '做市' || b === '做市') ? { verdict: 'same', reason: R } : { verdict: 'different', reason: RD }))(stage, prompt))
        const e = mk({ cores, reply })
        const r = await e.run()
        assert.deepEqual([r.stats.synonymCandidates, r.stats.synonymProposed, r.stats.synonymChecked, r.stats.synonymSame, r.stats.synonymDifferent], [3, 1, 3, 2, 1], JSON.stringify(r.stats))
        const h = await e.holds.get(holdKey(ES11.object, pairKeyOf('最優執行', '最適執行'), ES11.std))
        assert.deepEqual([h.owner, h.ctx.alias, h.ctx.canonical], ['user', '最優執行', '最適執行'], '已用筆記多者(最適執行 9)為正名')
        assert.match(h.reason, /建議於 vocab\.conceptAliases 加入「最優執行」→「最適執行」/)
        assert.equal((await e.checks.get(checkKey(ES11.object, pairKeyOf('套利', '統計套利')))).results.ES11.status, 'pass')
        assert.equal((await e.checks.get(checkKey(ES11.object, pairKeyOf('做市', '流動性提供')))).results.ES11.status, 'violation')
        assert.ok(fs.existsSync(`${e.dir}/state/${SYNONYM_STATE_FILE}`))
        const n = e.calls.length
        const r2 = await e.run()
        assert.deepEqual([e.calls.length, r2.stats.synonymChecked], [n, 0], '已判之對不重判;名單未變不重提議')
    })

    it('synonymCandidatesOf／synonymDueOf(專步與掃描同一函數):主核心之名、名稱相近 ∪ 已存之提議(名單同雜湊者)、兩側素材與雜湊(含本質與主張);須檢者排除待判中(使用者)、已判同素材、已豁免且素材未變;pipeline 待判先', async () => {
        const cores = [{ id: 'c1', concept: '最優執行', noteCount: 3, essence: '最優執行之本質' }, { id: 'c2', concept: '最適執行', noteCount: 9 }, { id: 'c3', concept: '做市', noteCount: 4 }, { id: 'c4', concept: '流動性提供', noteCount: 2 }, { id: 'c5', concept: '分身', noteCount: 1, status: 'merged', mergedInto: 'c1' }]
        const e = mk({ cores })
        const o = { cores: e.env.cores, loadUsable: (id) => e.env.store.loadUsable(id), notesById: new Map(), stateDir: e.env.dirs.state }
        const sc = synonymCandidatesOf(o)
        assert.deepEqual([sc.names, [...sc.cand.keys()], sc.proposed], [['做市', '最優執行', '最適執行', '流動性提供'], [pairKeyOf('最優執行', '最適執行')], null], '分身不算主核心;無提議紀錄')
        const c = sc.cand.get(pairKeyOf('最優執行', '最適執行'))
        const sides = sc.sidesOf(c)
        assert.deepEqual([sides.a.readable, sides.a.side.concept, sides.a.side.essence, sides.a.side.claims, sides.a.side.noteCount], [true, '最優執行', '最優執行之本質', ['最優執行之主張'], 3])
        assert.equal(sc.hashOf(c), synonymHashOf(c.key, sides.a.side, sides.b.side), '雜湊含兩側之本質與主張')
        // 提議紀錄:名單同雜湊者併入;不同者不併(專步會重提)
        fs.writeFileSync(`${e.env.dirs.state}/${SYNONYM_STATE_FILE}`, JSON.stringify({ v: 1, namesHash: sc.namesHash, at: e.env.at, pairs: [{ a: '做市', b: '流動性提供', by: 'propose', reason: 'r' }] }), 'utf8')
        const sc2 = synonymCandidatesOf(o)
        assert.deepEqual([[...sc2.cand.keys()], sc2.proposed.length], [[pairKeyOf('最優執行', '最適執行'), pairKeyOf('做市', '流動性提供')], 1])
        fs.writeFileSync(`${e.env.dirs.state}/${SYNONYM_STATE_FILE}`, JSON.stringify({ v: 1, namesHash: 'x', at: e.env.at, pairs: [{ a: '做市', b: '流動性提供', by: 'propose' }] }), 'utf8')
        assert.equal(synonymCandidatesOf(o).proposed, null)
        sc2.add([{ a: '流動性提供', b: '做市', by: 'propose' }, { a: '最適執行', b: '最優執行', by: 'edit' }])
        assert.equal(sc2.cand.size, 2, 'add 去重且不依序')
        // 須檢:無待判、無紀錄 → 皆須;待判中(使用者)不計;pipeline 到期者先;已判同素材不計;豁免且素材未變不計(計 waivedKept)
        const k1 = pairKeyOf('最優執行', '最適執行')
        const k2 = pairKeyOf('做市', '流動性提供')
        const none = { openOf: () => null, waivedOf: () => null, recOf: () => null }
        assert.deepEqual((await synonymDueOf(sc2, none)).due.map((x) => [x.key, x.hold]), [[k1, null], [k2, null]], '名稱相近先於提議')
        const userHold = { status: 'open', owner: 'user', oid: k2 }
        assert.deepEqual((await synonymDueOf(sc2, { ...none, openOf: (k) => (k === k2 ? userHold : null) })).due.map((x) => x.key), [k1])
        const pipeHold = { status: 'open', owner: 'pipeline', oid: k2, deadline: '2000-01-01T00:00:00+08:00' }
        assert.deepEqual((await synonymDueOf(sc2, { ...none, openOf: (k) => (k === k2 ? pipeHold : null) })).due.map((x) => [x.key, x.hold]), [[k2, pipeHold], [k1, null]], 'pipeline 待判到期者先')
        const rec = (k) => ({ hash: sc2.hashOf(sc2.cand.get(k)), results: { ES11: { v: ES11.v, status: 'pass' } } })
        assert.deepEqual((await synonymDueOf(sc2, { ...none, recOf: (k) => (k === k1 ? rec(k1) : null) })).due.map((x) => x.key), [k2], '已判同素材不計')
        assert.deepEqual((await synonymDueOf(sc2, { ...none, recOf: (k) => (k === k1 ? { ...rec(k1), hash: 'old' } : null) })).due.map((x) => x.key), [k1, k2], '素材變 → 重判')
        const r = await synonymDueOf(sc2, { ...none, waivedOf: async (k) => (k === k1 ? { status: 'waived', ctx: { hash: sc2.hashOf(sc2.cand.get(k1)) } } : null) })
        assert.deepEqual([r.due.map((x) => x.key), r.waivedKept], [[k2], 1], '已豁免且素材未變 → 不計')
        assert.deepEqual((await synonymDueOf(sc2, { ...none, waivedOf: (k) => (k === k1 ? { status: 'waived', ctx: { hash: 'old' } } : null) })).due.map((x) => x.key), [k1, k2], '豁免時之素材已變 → 計')
    })

    it('專步:使用者已豁免之對,素材未變即不重判、不重登(stats.synonymWaivedKept);本質變了 → 重判;缺票逾次(o.triesOf＋本次 ≥ maxTries)→ 待判改使用者', async () => {
        const cores = [{ id: 'c1', concept: '最優執行', noteCount: 3 }, { id: 'c2', concept: '最適執行', noteCount: 9 }]
        const key = pairKeyOf('最優執行', '最適執行')
        const e = mk({ cores, reply: replyBy((a, b, stage) => (stage === 'synonym1' ? { verdict: 'same', reason: R } : stage === 'synonym2' ? { verdict: 'different', reason: RD } : { verdict: 'unsure', reason: '材料不足以判斷' })) })
        const r1 = await e.run()
        assert.deepEqual([r1.stats.synonymHeld, (await e.holds.get(holdKey(ES11.object, key, ES11.std))).owner], [1, 'user'])
        await waiveHold(e.holds, holdKey(ES11.object, key, ES11.std), { by: '使用者', ruling: '兩者不同', at: '2026-10-05T10:00:00+08:00' })
        const n = e.calls.length
        const r2 = await e.run()
        assert.deepEqual([r2.stats.synonymChecked, r2.stats.synonymWaivedKept, e.calls.length, (await e.holds.get(holdKey(ES11.object, key, ES11.std))).status], [0, 0, n, 'waived'], '素材未變 → 檢核紀錄(判不了)仍有效:不重判、不重登')
        // 檢核紀錄失效(如標準改版重檢)而素材與豁免時相同 → 豁免之裁示有效(synonymWaivedKept),仍不重判
        const rec = await e.checks.get(checkKey(ES11.object, key))
        await e.checks.replace({ ...rec, hash: 'stale' })
        const r2b = await e.run()
        assert.deepEqual([r2b.stats.synonymChecked, r2b.stats.synonymWaivedKept, e.calls.length], [0, 1, n], '紀錄失效而素材未變 → 不重判')
        e.states.get('c1').essence = { text: '本質已改寫' }
        const r3 = await e.run()
        assert.deepEqual([r3.stats.synonymChecked, r3.stats.synonymWaivedKept, r3.stats.synonymHeld], [1, 0, 1], '素材變 → 重判、再判不了即重登')
        assert.deepEqual([(await e.holds.get(holdKey(ES11.object, key, ES11.std))).status, (await e.holds.get(holdKey(ES11.object, key, ES11.std))).tries], ['open', 0], '豁免後重登＝重開(history 保留,次數歸零)')
        // 缺票(部分:另一對照判,否則為專步層之失敗):負責者依失敗帳之現值(triesOf)與 maxTries
        let missing = true
        const key2 = pairKeyOf('資料與特徵', '數據與特徵')
        const e2 = mk({ cores: [...cores, { id: 'c3', concept: '資料與特徵', noteCount: 2 }, { id: 'c4', concept: '數據與特徵', noteCount: 2 }], reply: (stage, prompt) => {
            if (stage === 'synonymPropose') return { pairs: [] }
            const out = replyBy((a) => ({ verdict: 'same', reason: R, skip: missing && stage === 'synonym2' && a.includes('執行') }))(stage, prompt)
            out.checks = out.checks.filter((x) => !x.skip).map(({ skip, ...x }) => x)
            return out
        } })
        const a = await e2.run(10, { maxTries: 2, triesOf: () => 0 })
        assert.deepEqual([a.retry, a.decided, (await e2.holds.get(holdKey(ES11.object, key, ES11.std))).owner], [[key], [key2], 'pipeline'], '現值 0＋本次 1 < 2 → pipeline;另一對照判')
        // 下輪再缺票(另有一對新候選照判,否則為專步層之失敗):現值 1＋本次 1 ≥ 2 → 使用者
        for (const [id, concept] of [['c5', '動量因子'], ['c6', '動能因子']]) {
            e2.env.cores.push({ id, concept, noteCount: 4, scope: 'concept', status: 'active', version: 1 })
            e2.states.set(id, { coreId: id, concept, essence: { text: `${concept}之本質` }, claims: [{ id: 'C1', text: `${concept}之主張`, status: 'active', sources: [`n-${id}`] }] })
        }
        const b = await e2.run(10, { maxTries: 2, triesOf: () => 1 })
        assert.deepEqual([b.retry, b.decided, (await e2.holds.get(holdKey(ES11.object, key, ES11.std))).owner], [[key], [pairKeyOf('動量因子', '動能因子')], 'user'], '現值 1＋本次 1 ≥ 2 → 使用者')
        missing = false
        const c = await e2.run(10, { maxTries: 2, triesOf: () => 1 })
        assert.deepEqual([c.retry, c.decided.length], [[], 0], '使用者負責之待判不再自動重判;已判之對不重判')
    })

    it('專步:判不了 → 待判(使用者)＋未能判定;缺票 → 待判 pipeline、下輪優先重判;每輪配額', async () => {
        const cores = [{ id: 'c1', concept: '最優執行', noteCount: 3 }, { id: 'c2', concept: '最適執行', noteCount: 9 }, { id: 'c3', concept: '資料與特徵', noteCount: 2 }, { id: 'c4', concept: '數據與特徵', noteCount: 2 }]
        let missing = true
        // 執行對:第一席 same、第二席 different、第三席 unsure → 判不了;資料對:第二席不回(缺票)→ 重試
        const vote = (a, stage) => (a.includes('執行')
            ? (stage === 'synonym1' ? { verdict: 'same', reason: R } : stage === 'synonym2' ? { verdict: 'different', reason: RD } : { verdict: 'unsure', reason: '材料不足以判斷' })
            : (missing && stage === 'synonym2' ? { skip: true } : { verdict: 'same', reason: R }))
        const reply = (stage, prompt) => {
            if (stage === 'synonymPropose') return { pairs: [] }
            const out = replyBy((a) => vote(a, stage))(stage, prompt)
            out.checks = out.checks.filter((x) => !x.skip)
            return out
        }
        const e = mk({ cores, reply })
        const r = await e.run()
        assert.deepEqual([r.stats.synonymHeld, r.stats.synonymRetry], [1, 1], JSON.stringify(r.stats))
        const exe = await e.holds.get(holdKey(ES11.object, pairKeyOf('最優執行', '最適執行'), ES11.std))
        assert.equal(exe.owner, 'user')
        assert.equal((await e.checks.get(checkKey(ES11.object, pairKeyOf('最優執行', '最適執行')))).results.ES11.status, 'undetermined')
        const data = await e.holds.get(holdKey(ES11.object, pairKeyOf('資料與特徵', '數據與特徵'), ES11.std))
        assert.equal(data.owner, 'pipeline')
        missing = false
        const r2 = await e.run(1)
        assert.deepEqual([r2.stats.synonymChecked, r2.stats.synonymSame], [1, 1], '配額 1:pipeline 待判優先重判')
        assert.equal((await e.holds.get(holdKey(ES11.object, pairKeyOf('資料與特徵', '數據與特徵'), ES11.std))).owner, 'user', '判為同一概念 → 交使用者')
    })

    it('專步:提示詞放不下(終審 §3 D5d)→ 頁對半分再送;單對仍放不下 → 待判(使用者;材料過大),不是重試', async () => {
        // 執行對之一核心本質極長:含它之提示詞放不下(seatSpec 以長度預篩回 null ＝ 整條遞補鏈放不下);資料對之單對提示詞放得下
        const cores = [{ id: 'c1', concept: '最優執行', noteCount: 3, essence: 'x'.repeat(4000) }, { id: 'c2', concept: '最適執行', noteCount: 9 }, { id: 'c3', concept: '資料與特徵', noteCount: 2 }, { id: 'c4', concept: '數據與特徵', noteCount: 2 }]
        const sizes = []
        const e = mk({ cores, reply: (stage, prompt) => {
            if (stage === 'synonymPropose') return { pairs: [] }
            sizes.push((prompt.match(/^--- 第\d+項 ---$/gm) || []).length)
            return replyBy(() => ({ verdict: 'different', reason: RD }))(stage, prompt)
        } })
        e.ai.seatSpec = (seat, len) => (seat && len <= 3000 ? { use: seat.use, fallback: [], timeoutMs: 60_000 } : null)
        const r = await e.run()
        assert.deepEqual(sizes, [1, 1], '放得下而真送出者只有資料對之單對頁(兩席各一次)')
        assert.deepEqual([r.stats.synonymChecked, r.stats.synonymDifferent, r.stats.synonymHeld, r.stats.synonymRetry], [2, 1, 1, 0], JSON.stringify(r.stats))
        const exe = await e.holds.get(holdKey(ES11.object, pairKeyOf('最優執行', '最適執行'), ES11.std))
        assert.deepEqual([exe.owner, /材料過大（單項已超過席位可容）/.test(exe.reason)], ['user', true])
        assert.equal((await e.checks.get(checkKey(ES11.object, pairKeyOf('最優執行', '最適執行')))).results.ES11.status, 'undetermined')
    })

    it('專步:全部受檢項皆缺票或同一供應者 → 專步層之失敗(failed;不逐項計次、不登錄待判、不記檢核——呼叫端退避);部分 → 該對待判 pipeline(見上案)', async () => {
        const cores = [{ id: 'c1', concept: '最優執行', noteCount: 3 }, { id: 'c2', concept: '最適執行', noteCount: 9 }, { id: 'c3', concept: '資料與特徵', noteCount: 2 }, { id: 'c4', concept: '數據與特徵', noteCount: 2 }]
        const same = replyBy(() => ({ verdict: 'same', reason: R }))
        // 全部缺票:第二席不回
        const e = mk({ cores, reply: (stage, prompt) => (stage === 'synonym2' ? { checks: [] } : same(stage, prompt)) })
        const r = await e.run()
        assert.deepEqual([r.failed, /全部受檢項皆缺票或同一供應者/.test(r.error), r.stopped, r.stats.synonymChecked, r.stats.synonymRetry, r.stats.synonymCalls], [true, true, undefined, 0, 0, 3], JSON.stringify(r))
        assert.deepEqual([(await e.holds.select()).length, (await e.checks.select()).length], [0, 0], '不登錄待判、不記檢核(基礎設施之失敗不轉使用者)')
        assert.ok(e.log.lines.some((x) => /本輪核 0 對：.*；已判之 2 對皆缺票或同一供應者，本輪不記/.test(x)), e.log.lines.join('\n'))
        // 全部同一供應者:三席成交於同一家
        const f = mk({ cores, reply: same, providers: { synonym2: 'p:a', synonym3: 'p:a' } })
        const r2 = await f.run()
        assert.deepEqual([r2.failed, (await f.holds.select()).length, (await f.checks.select()).length], [true, 0, 0])
        // 第三席另一家而成立 → 照常處置(不是專步層之失敗)
        const g = mk({ cores, reply: same, providers: { synonym2: 'p:a' } })
        const r3 = await g.run()
        assert.deepEqual([r3.failed, r3.stats.synonymSame], [undefined, 2])
    })

    it('專步:中止而已判之頁皆缺票 → 中止(不計失敗、不逐項記;下輪再排)', async () => {
        const CH = [...'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黃宇宙洪荒日月盈昃宿列張寒來暑往秋收冬藏閏餘成']
        const names = Array.from({ length: 24 }, (_, i) => CH[2 * i] + CH[2 * i + 1])
        const cores = names.map((concept, i) => ({ id: `c${i}`, concept, noteCount: 1 }))
        const pairs = Array.from({ length: 12 }, (_, i) => ({ a: names[2 * i], b: names[2 * i + 1], reason: '提議' }))
        const reply = (stage, prompt) => (stage === 'synonymPropose' ? { pairs } : (stage === 'synonym2' ? { checks: [] } : replyBy(() => ({ verdict: 'different', reason: RD }))(stage, prompt)))
        const f = mk({ cores, reply })
        const r = await f.run(12, { shouldStop: () => f.calls.filter((x) => x.stage !== 'synonymPropose').length >= 2 })
        assert.deepEqual([r.stopped, r.failed, r.stats.synonymChecked], [true, undefined, 0], JSON.stringify(r))
        assert.deepEqual([(await f.holds.select()).length, (await f.checks.select()).length], [0, 0])
    })

    it('專步:逐頁判(每頁 10 對);中止時已判之頁照樣處置,未判之頁不登錄、不記檢核(下輪再排)', async () => {
        // 48 個互不相同之字組成 24 個兩字名(彼此無名稱相近之候選),候選全由 AI 提議:12 對
        const CH = [...'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黃宇宙洪荒日月盈昃宿列張寒來暑往秋收冬藏閏餘成']
        const names = Array.from({ length: 24 }, (_, i) => CH[2 * i] + CH[2 * i + 1])
        const cores = names.map((concept, i) => ({ id: `c${i}`, concept, noteCount: 1 }))
        const pairs = Array.from({ length: 12 }, (_, i) => ({ a: names[2 * i], b: names[2 * i + 1], reason: '提議' }))
        const reply = (stage, prompt) => (stage === 'synonymPropose' ? { pairs } : replyBy(() => ({ verdict: 'different', reason: RD }))(stage, prompt))
        const e = mk({ cores, reply })
        const r = await e.run(12)
        assert.deepEqual([r.stats.synonymCandidates, r.stats.synonymChecked, r.stats.synonymDifferent, r.stopped], [12, 12, 12, undefined], JSON.stringify(r.stats))
        assert.deepEqual(e.calls.filter((x) => x.stage !== 'synonymPropose').map((x) => [x.stage, (x.prompt.match(/^--- 第\d+項 ---$/gm) || []).length]),
            [['synonym1', 10], ['synonym2', 10], ['synonym1', 2], ['synonym2', 2]], '兩頁:10＋2')
        // 中止:第一頁之兩席回覆後即停
        const f = mk({ cores, reply })
        const r2 = await f.run(12, { shouldStop: () => f.calls.filter((x) => x.stage !== 'synonymPropose').length >= 2 })
        assert.deepEqual([r2.stats.synonymChecked, r2.stopped], [10, true], JSON.stringify(r2.stats))
        assert.equal((await f.checks.select()).length, 10, '只記已判之頁')
        assert.equal((await f.holds.select()).length, 0, '未判之頁不登錄待判')
        assert.ok(f.log.lines.some((x) => /中止，未判 2 對留待下輪/.test(x)), f.log.lines.join('\n'))
    })

    it('專步:待判結案——加入別名後兩名同鍵 → 結案;任一方已非主核心(已併入他核心)→ 結案;仍成對者不動、不重判', async () => {
        const cores = [
            { id: 'c1', concept: '最優執行', noteCount: 3 },
            { id: 'c2', concept: '最適執行', noteCount: 9 },
            { id: 'c3', concept: '資料與特徵', noteCount: 2 },
            { id: 'c4', concept: '數據與特徵', noteCount: 2 },
            { id: 'c5', concept: '動量因子', noteCount: 4 },
            { id: 'c6', concept: '動能因子', noteCount: 4 },
        ]
        const e = mk({ cores, reply: replyBy(() => ({ verdict: 'same', reason: R })) })
        const r = await e.run()
        assert.equal(r.stats.synonymSame, 3, JSON.stringify(r.stats))
        try {
            // 安裝方依建議加入別名(最優執行 → 最適執行);資料對之一方已由分身合併標為 merged
            setConceptFold(null, { aliases: { 最優執行: '最適執行' } })
            const k = e.env.cores.findIndex((c) => c.id === 'c4')
            e.env.cores.splice(k, 1, { ...e.env.cores[k], status: 'merged', mergedInto: 'c3' })
            const r2 = await e.run()
            assert.deepEqual([r2.stats.synonymResolved, r2.stats.synonymChecked], [2, 0], JSON.stringify(r2.stats))
            const exe = await e.holds.get(holdKey(ES11.object, pairKeyOf('最優執行', '最適執行'), ES11.std))
            assert.deepEqual([exe.status, exe.how], ['resolved', '兩名已同鍵（詞彙表已加入別名），由分身合併併為一核心'])
            const data = await e.holds.get(holdKey(ES11.object, pairKeyOf('資料與特徵', '數據與特徵'), ES11.std))
            assert.deepEqual([data.status, data.how], ['resolved', '「數據與特徵」已非主核心（已併入他核心或已刪除）'])
            assert.equal((await e.holds.get(holdKey(ES11.object, pairKeyOf('動量因子', '動能因子'), ES11.std))).status, 'open', '仍成對者不動')
            assert.equal(e.log.lines.filter((x) => /待判結案「/.test(x)).length, 2, e.log.lines.join('\n'))
        }
        finally {
            resetConceptFold() // 模組級單例,不留給同 worker 之他檔
        }
    })
})
