// unit-extract-provenance.test.mjs — 核心版本之產出鏈(changelog 每筆之 produced;跨套件之產出鏈規格 §2.2、§3、§4、§6;規則帳本 EXT-39;使用端 Gitea #109 §2):
//   P1 一個概念跑一輪(替身 AI):changelog 末筆帶 produced——stamp 等於該輪之 stamp、steps 之角色與席號與成交者(providerId)對得上各次呼叫、promptFp 等於評比機制之指紋、pkg、at
//   P2 起草席失敗而遞補:steps 為遞補者、failures 列失敗者(去金鑰序號);整條鏈皆敗之棒不入產出鏈;各 pass 皆經 producedMetaOf 寫入
//   P3 重練後新核心之第一版為 regen-core、其後為 extract;總組裝之輪次:produced.stamp 等於該輪 run.json 之 stamp(兩輪各自一值)
//   P4 依產出鏈取版本 coreVersionsByProvenance:stamp／stage／provider／seat／since／until 之條件、「且」、多步者同一步須同時合 provider 與 seat、舊記錄(無 produced)不出現、純讀
//   P5 既有 meta 欄位(accepted、degrade;待審之 step、reviewed、provider)與 produced 並存且不變
//   P6 不呼叫 AI 之確定性寫入(stage standards-fix;規格 §2.1 單一形、§4;使用端 Gitea #109 主控裁示④):standardsFixProducedOf 之形與檢核、三個純函數之 produced 參數(加法)、
//      changelog 寫入站點全集(盤點指令之靜態掃描)、撤出處／恢復之輪次內外 stamp(提煉維護)、依產出鏈取回該等版本(stage 選得到、provider 選不到);
//      存量處置(applyCoreStockFix)與還原撤回(reviveClaims)之站點案分置於 unit-extract-stockfix／unit-extract-stage
// 執行:自套件根 node <mocha> test/unit-extract-provenance.test.mjs(暫存 test/_tmp/extract-provenance-<pid>;不連網、不呼叫真 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createPromptFpCache, makeProduced } from '../src/core/capturePackage.mjs'
import { extractBenchRoleOf, EXTRACT_BENCH_ROLE_IDS, planExtractBench } from '../src/bench/extractBench.mjs'
import { stageExtract } from '../src/stages/extractStage.mjs'
import { runPending } from '../src/workflow/pending.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { coreStateOf } from '../src/standards/esCases.mjs'
import { regenCore } from '../src/ops/regenCore.mjs'
import { hasCoreArchive } from '../src/stores/coreStore.mjs'
import { coreVersionsByProvenance } from '../src/ops/coreVersionsByProvenance.mjs'
import { callRoleOf, CALL_ROLES, producedOfCalls, producedMetaOf, triedProviderOf, standardsFixProducedOf, STANDARDS_FIX_STAGE } from '../src/core/producedChain.mjs'
import { reviveItems, withdrawSources } from '../src/stores/coreState.mjs'
import { coreFixOf } from '../src/standards/coreStockFix.mjs'
import { DELETION_FILES } from './tools/relateForTest.mjs'
import { scriptAi, seatAi, draftAll, readState, mkEnvIn, recLog, clock as TW, auditHigh } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots, resetConceptFold, landNote, buildTestExtractor, withStores, seedNotes, subReport, readJsonFile, fileLogFactory, PKG_ROOT } from './tools/extractTestKit.mjs'
import { sleep } from './tools/captureForTest.mjs'

const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version
const STAMP = '20261108123000'

/** 起草第二席以遞補者成交(其遞補鏈之第一家失敗):包裝替身之工作流入口之 runFanout */
const flakyDraft2 = (ai) => {
    const wkf = ai.getWkf()
    return {
        ...ai,
        getWkf: () => ({
            ...wkf,
            runFanout: async (a) => {
                const r = await wkf.runFanout(a)
                return { ...r, agents: r.agents.map((x, j) => (j === 1 ? { ...x, providerId: 'fallback-x', tried: [{ providerId: 'bad-y#0', outcome: 'fail', errorType: 'timeout' }, { providerId: 'fallback-x', outcome: 'ok' }] } : x)) }
            }
        })
    }
}

describe('unit-extract-provenance', function() {

    this.timeout(120_000)

    let root = ''
    let mkEnv = null

    before(() => {
        root = tmpRoot('extract-provenance')
        mkEnv = mkEnvIn(root)
        resetConceptFold()
    })
    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    /** 提煉段一輪(帶 stamp;評比角色由根檔注入之同一函數) */
    const runWith = async (env, ai, o = {}) => {
        const log = recLog()
        const ctx = { deps: { ...env, clock: o.clock || TW, ai }, log, stamp: o.stamp, remainingMs: () => 3_600_000, expired: () => false }
        const report = await stageExtract({ benchRoleOf: extractBenchRoleOf, ...(o.opt || {}) }).run(ctx)
        return { report, log }
    }
    const lastLog = async (env, concept = '學習率') => {
        const rec = (await env.stores.cores.select()).find((c) => c.concept === concept)
        const st = readState(env, rec.id)
        return { rec, st, entry: st.changelog[st.changelog.length - 1] }
    }
    const notes3 = () => ['p1', 'p2', 'p3'].map((id) => ({ id, concepts: ['學習率'] }))

    describe('P1 一個概念跑一輪', () => {
        it('changelog 末筆帶 produced:stage extract、stamp＝該輪之 stamp、pkg、at;steps 依呼叫完成之序,角色／席號／成交者與各次呼叫之 providerId 一一對得上;無失敗者 failures 為空', async () => {
            const env = mkEnv(notes3())
            const ai = scriptAi({ draft: draftAll })
            await runWith(env, ai, { stamp: STAMP })
            const { entry } = await lastLog(env)
            const p = entry.produced
            assert.deepEqual(Object.keys(p), ['v', 'stamp', 'stage', 'pkg', 'at', 'steps', 'failures'], '多步產出之形狀(規格 §2.2):不帶頂層 seat／provider／promptFp')
            assert.deepEqual([p.v, p.stamp, p.stage, p.pkg], [1, STAMP, 'extract', `w-knowledge-extract@${PKG_VERSION}`])
            assert.match(p.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
            // steps ↔ 各次呼叫:起草三席(席號 1～3)、整合、審計、終審(席號 0);成交者＝替身之 providerId(stub-<席位 use>)
            assert.deepEqual(ai.roles(), ['draft', 'draft', 'draft', 'integrate', 'audit', 'accept'])
            assert.deepEqual(p.steps.map((s) => [s.role, s.seat, s.provider]), [['draft', 1, 'stub-d1'], ['draft', 2, 'stub-d2'], ['draft', 3, 'stub-d3'], ['integrate', 0, 'stub-int'], ['audit', 0, 'stub-aud'], ['accept', 0, 'stub-acc']])
            assert.deepEqual(p.steps.map((s) => s.provider), ai.calls.map((c) => `stub-${c.use}`), '成交者與各次呼叫之席位一一對應')
            assert.deepEqual(p.failures, [])
        })

        it('promptFp:各步之指紋等於評比機制之同一角色之指紋(planExtractBench 之 promptFp;同一份 capture 之 createPromptFpCache);同角色同值', async () => {
            const env = mkEnv(notes3())
            await runWith(env, scriptAi({ draft: draftAll }), { stamp: STAMP })
            const { entry } = await lastLog(env)
            const fp = createPromptFpCache().promptFpOf
            const expect = { draft: 'wf-draft', integrate: 'wf-integrate', audit: 'wf-audit', accept: 'wf-accept' }
            for (const s of entry.produced.steps) {
                assert.match(s.promptFp, /^[0-9a-f]{16}$/, s.role)
                assert.equal(s.promptFp, fp(extractBenchRoleOf(expect[s.role]), {}), s.role)
                assert.equal(s.promptFp, planExtractBench(expect[s.role]).promptFp, `${s.role}:與評比報表之「提示詞指紋」欄同值`)
            }
            assert.equal(new Set(entry.produced.steps.filter((s) => s.role === 'draft').map((s) => s.promptFp)).size, 1, '起草三席同一提示詞版本')
        })

        it('十四個評比角色逐角色實跑一次:promptFpOf 皆得 16 碼指紋(角色與 promptFpOf 出自同一份 capture;內建題組可讀)', () => {
            assert.equal(EXTRACT_BENCH_ROLE_IDS.length, 14)
            const { promptFpOf } = createPromptFpCache({ onFail: (id, e) => assert.fail(`${id}:${e.message}`) })
            for (const id of EXTRACT_BENCH_ROLE_IDS) assert.match(promptFpOf(extractBenchRoleOf(id), {}), /^[0-9a-f]{16}$/, id)
        })

        it('審計有意見時修訂席亦入產出鏈(revise 步);輪次外(ctx 無 stamp)之 stamp 為 null', async () => {
            const env = mkEnv(notes3())
            const isJia = (op) => op.text === '甲'
            const draft = (p) => ({ ops: [{ op: 'add', ref: 'x', kind: 'rule', text: '甲', basis: '案例', sources: [codeOf(p, 0)], critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }, { op: 'add', kind: 'rule', text: '乙', basis: '案例', sources: [codeOf(p, 1)], critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }], skipped: [] })
            const ai = scriptAi({ draft, audit: auditHigh(isJia, '捏造') })
            await runWith(env, ai)
            const { entry } = await lastLog(env)
            assert.equal(entry.produced.stamp, null)
            assert.deepEqual(entry.produced.steps.map((s) => s.role), ['draft', 'draft', 'draft', 'integrate', 'audit', 'revise', 'accept'])
            assert.equal(entry.produced.steps.find((s) => s.role === 'revise').provider, 'stub-rev')
        })
    })

    describe('P2 失敗而遞補、無成交者不入產出鏈', () => {
        it('起草第二席由遞補者成交:steps 之 draft#2 為遞補者、failures 列失敗者(去金鑰序號 #n)與調度層之失敗分類', async () => {
            const env = mkEnv(notes3())
            const ai = flakyDraft2(scriptAi({ draft: draftAll }))
            await runWith(env, ai, { stamp: STAMP })
            const { entry } = await lastLog(env)
            assert.deepEqual(entry.produced.steps.slice(0, 3).map((s) => [s.role, s.seat, s.provider]), [['draft', 1, 'stub-d1'], ['draft', 2, 'fallback-x'], ['draft', 3, 'stub-d3']])
            assert.deepEqual(entry.produced.failures, [{ role: 'draft', seat: 2, provider: 'bad-y', type: 'timeout' }])
        })

        it('整合席整條鏈皆敗(程式聯集續跑):integrate 不入 steps(無成交)、其失敗亦不入 failures(「失敗而遞補」才列);其餘各步照記', async () => {
            const env = mkEnv(notes3())
            await runWith(env, scriptAi({ draft: draftAll, integrate: 'fail' }), { stamp: STAMP })
            const { entry } = await lastLog(env)
            assert.deepEqual(entry.produced.steps.map((s) => s.role), ['draft', 'draft', 'draft', 'audit', 'accept'])
            assert.deepEqual(entry.produced.failures, [])
        })

        it('producedOfCalls／callRoleOf／triedProviderOf／producedMetaOf(純函數):整併、本質專步之起草角色、待審之終審角色;無成交呼叫者為不呼叫 AI 之單一形;失敗之 type 缺者取 outcome', () => {
            assert.deepEqual(callRoleOf('draft1', 'consolidate'), { role: 'consolidate', seat: 1, bench: 'wf-consolidate' })
            assert.deepEqual(callRoleOf('draft3', 'essence'), { role: 'essence', seat: 3, bench: 'wf-essence' })
            assert.deepEqual(callRoleOf('accept', 'pending'), { role: 'pending', seat: 0, bench: 'wf-pending' })
            assert.deepEqual(callRoleOf('accept', 'delta'), { role: 'accept', seat: 0, bench: 'wf-accept' })
            assert.equal(callRoleOf('nope'), null)
            assert.ok(Object.isFrozen(CALL_ROLES))
            assert.equal(triedProviderOf({ id: 'a:b#12' }), 'a:b')
            assert.equal(triedProviderOf({ providerId: 'a:b' }), 'a:b')
            assert.equal(triedProviderOf({ id: 'a#b' }), 'a#b', '只去尾端之 #數字')
            const base = { stamp: STAMP, stage: 'extract', pkg: 'w-x@1.0.0', at: '2026-11-08T12:00:00+08:00' }
            const none = producedOfCalls({ ...base, calls: [{ stage: 'draft1', ok: false, providerId: '', tried: [{ id: 'p', outcome: 'fail' }] }] })
            assert.deepEqual([none.seat, none.provider, 'steps' in none], [null, null, false], '無成交呼叫:規格 §2.1 之不呼叫 AI 形(steps 不收空陣列)')
            const withFail = producedOfCalls({ ...base, calls: [{ stage: 'check1', ok: true, providerId: 'q', tried: [{ id: 'z', outcome: 'skip-group' }, { id: 'q', outcome: 'ok' }] }], mode: 'delta' })
            assert.deepEqual(withFail.failures, [{ role: 'support-check', seat: 1, provider: 'z', type: 'skip-group' }])
            assert.deepEqual([producedMetaOf(), producedMetaOf(() => null), producedMetaOf(() => ({ v: 1 }))], [{}, {}, { produced: { v: 1 } }])
            // stamp 非 14 碼:經 makeProduced 檢核而拋(呼叫端捕捉後不寫 produced 並 WARN)
            assert.throws(() => producedOfCalls({ ...base, stamp: 'x', calls: [] }), /invalid o\.stamp/)
        })

        it('hasCoreArchive:封存目錄下有該核心該標記之主檔封存、或主檔缺時只封存之 .prev 皆為有;他核心、他標記、封存目錄不存在皆為無', () => {
            const dirs = { state: `${root}/arch`, core: `${root}/arch/core` }
            const arc = `${dirs.state}/core/archive`
            assert.equal(hasCoreArchive(dirs, 'k1', 'regen'), false, '封存目錄不存在')
            fs.mkdirSync(arc, { recursive: true })
            fs.writeFileSync(`${arc}/k1.state.json.regen-T1`, '{}')
            fs.writeFileSync(`${arc}/k2.state.prev.json.regen-T1`, '{}')
            fs.writeFileSync(`${arc}/k3.state.json.corrupt-T1`, '{}')
            assert.deepEqual(['k1', 'k2', 'k3', 'k4'].map((id) => hasCoreArchive(dirs, id, 'regen')), [true, true, false, false])
            assert.equal(hasCoreArchive(dirs, 'k3', 'corrupt'), true)
            assert.equal(hasCoreArchive(dirs, 'k1', 'corrupt'), false, '標記不同')
        })

        it('各 pass 皆經 producedMetaOf 把產出鏈寫入 applyDelta 之 ctx.meta(runPass、待審裁決、爭議覆核、失撐找支持、出處存量覆核;靜態掃描,無漏接)', () => {
            for (const rel of ['runPass', 'pending', 'disputePass', 'orphanPass', 'supportStockPass']) {
                const text = fs.readFileSync(path.join(PKG_ROOT, 'src/workflow', `${rel}.mjs`), 'utf8')
                assert.match(text, /producedMetaOf\(o\.producedOf\)/, rel)
            }
        })

        it('mwPass 把 producedOf 交給五個 pass 呼叫點(一般差量、待審、爭議覆核、出處存量覆核／失撐找支持)', () => {
            const text = fs.readFileSync(path.join(PKG_ROOT, 'src/stages/extractChain.mjs'), 'utf8')
            assert.equal(text.match(/onCall, producedOf,/g).length, 3, 'common 與兩個專步之參數組')
            assert.match(text, /runDisputePass\(\{[^\n]*producedOf/)
        })
    })

    describe('P5 既有 meta 欄位與 produced 並存且不變', () => {
        it('runPass 之 changelog:accepted、degrade 照舊,produced 為新增欄;不給 producedOf 者(直接呼叫)無 produced 欄(既有輸出不變)', async () => {
            const env = mkEnv(notes3())
            await runWith(env, scriptAi({ draft: draftAll }), { stamp: STAMP })
            const { entry } = await lastLog(env)
            assert.deepEqual(Object.keys(entry), ['version', 'at', 'mode', 'batch', 'applied', 'rejected', 'withheld', 'accepted', 'degrade', 'produced'])
            assert.deepEqual([entry.mode, entry.accepted, entry.degrade], ['delta', true, 0])
        })

        it('待審裁決(runPending):meta 之 step／reviewed／provider 照舊,produced 並存(provider 與 produced.steps 之 pending 步同值)', async () => {
            const s0 = coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }, { text: '乙方法有效', sources: ['n2'] }], pendingReview: [{ op: { op: 'retract', id: 'C1', reason: '重複', into: 'C2' }, sources: ['n1'], reason: '終審失敗' }] }).state
            const produced = makeProduced({ stamp: STAMP, stage: 'extract', pkg: 'w-x@1.0.0', at: '2026-11-08T12:00:00+08:00', steps: [{ role: 'pending', seat: 0, provider: 'stub-acc' }] })
            const ai = seatAi({ acc: { verdicts: [{ i: 0, action: 'keep' }] }, accProvider: 'stub-acc' })
            const r = await runPending({ state: s0, concept: '甲', batch: [], domain: createExtractDomain({}), seats: { accept: { use: 'acc' } }, ai, producedOf: () => produced, at: '2026-11-08T12:00:00+08:00' })
            assert.equal(r.ok, true, JSON.stringify(r.error))
            const e = r.state.changelog[r.state.changelog.length - 1]
            assert.deepEqual([e.mode, e.step, e.reviewed, e.provider], ['pending', 'pending', 'ok', 'stub-acc'])
            assert.deepEqual(e.produced, produced)
            assert.equal(e.provider, e.produced.steps[0].provider)
            // 不給 producedOf:無 produced 欄
            const r2 = await runPending({ state: s0, concept: '甲', batch: [], domain: createExtractDomain({}), seats: { accept: { use: 'acc' } }, ai: seatAi({ acc: { verdicts: [{ i: 0, action: 'keep' }] } }), at: '2026-11-08T12:00:00+08:00' })
            assert.equal('produced' in r2.state.changelog[r2.state.changelog.length - 1], false)
        })
    })

    describe('P3／P4 總組裝之輪次、重練後之第一版、依產出鏈取版本', () => {
        let work = ''
        let flow1 = null
        let flow2 = null
        let ai1 = null
        let ai2 = null
        const reps = []
        const N = {}
        const concept = '視差量測'

        /** 第二個總組裝(同工作目錄,席位改名 → 成交者不同):以區分哪些版本由哪組席位產出 */
        const SEATS2 = { drafters: [{ use: 'e1' }, { use: 'e2' }, { use: 'e3' }], integrate: { use: 'i2' }, audit: { use: 'a2' }, revise: { use: 'r2' }, accept: { use: 'c2' } }
        const coresOf = async (f) => (await withStores(f, (s) => s.cores.select())).filter((c) => c.concept === concept)
        const queryOf = (o) => withStores(flow2, (s) => coreVersionsByProvenance(s, { dirs: flow2.info().dirs, ...o }))

        before(async () => {
            work = `${root}/flow`
            fs.mkdirSync(work, { recursive: true })
            ai1 = scriptAi({ draft: draftAll })
            ai2 = scriptAi({ draft: draftAll }, { byPrompt: true })
            ;({ flow: flow1 } = buildTestExtractor(work, { aiAdapter: ai1, scheduleLimitMin: 55, logFactory: fileLogFactory(() => flow1) }))
            ;({ flow: flow2 } = buildTestExtractor(work, { aiAdapter: ai2, scheduleLimitMin: 55, extract: { ai: SEATS2 }, logFactory: fileLogFactory(() => flow2) }))
            const notesDir = `${work}/knowledge/notes`
            N.a = landNote(notesDir, { doc: 'a', title: '恆星視差之量測', concepts: [concept] })
            N.b = landNote(notesDir, { doc: 'b', title: '視差誤差之修正', concepts: [concept] })
            await seedNotes(flow1, [N.a, N.b])
            // 第一輪(席位 d1…):v1
            reps.push(await flow1.run())
            // 第二輪(席位 e1…):新筆記入批 → v2
            await sleep(1100)
            N.c = landNote(notesDir, { doc: 'c', title: '視差量測之新方法', concepts: [concept] })
            await withStores(flow2, (s) => s.notes.insertNew([N.c]))
            reps.push(await flow2.run())
        })

        const entries = async () => {
            const [core] = await coresOf(flow2)
            return readState({ dirs: flow2.info().dirs }, core.id).changelog
        }

        it('P3 produced.stamp 等於該輪 run.json 之 stamp(兩輪各自一值);成交者隨該輪之席位', async () => {
            const [e1, e2] = await entries()
            const s1 = readJsonFile(reps[0].summaryFile)
            const s2 = readJsonFile(reps[1].summaryFile)
            assert.match(s1.stamp, /^\d{14}$/)
            assert.deepEqual([e1.produced.stamp, e2.produced.stamp], [s1.stamp, s2.stamp])
            assert.notEqual(s1.stamp, s2.stamp)
            assert.deepEqual(e1.produced.steps.map((s) => s.provider), ['stub-d1', 'stub-d2', 'stub-d3', 'stub-int', 'stub-aud', 'stub-acc'])
            assert.deepEqual(e2.produced.steps.map((s) => s.provider), ['stub-e1', 'stub-e2', 'stub-e3', 'stub-i2', 'stub-a2', 'stub-c2'])
            assert.deepEqual([e1.version, e2.version, e1.produced.stage, e2.produced.stage], [1, 2, 'extract', 'extract'])
            assert.ok(Date.parse(e2.produced.at) > Date.parse(e1.produced.at), '寫入時刻隨輪次')
        })

        it('P3 總組裝之 promptFp 由根檔注入之評比角色取得(14 角色中本輪用到者皆有指紋)', async () => {
            const [e1] = await entries()
            for (const s of e1.produced.steps) assert.match(s.promptFp, /^[0-9a-f]{16}$/, s.role)
        })

        it('P3 detail 之型別計數鍵皆在(初值 {}),各組之和等於既有總數', () => {
            const d = subReport(reps[0], '提煉', 'extract').detail
            for (const k of ['opsRejectedBy', 'integrateRejectedBy', 'guardBy', 'reviseBlockedBy', 'acceptDroppedBy', 'doubtedBy']) assert.deepEqual(d[k], {}, k)
            const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0)
            assert.deepEqual([sum(d.opsRejectedBy), sum(d.guardBy), sum(d.reviseBlockedBy), sum(d.acceptDroppedBy), sum(d.doubtedBy), sum(d.integrateRejectedBy)], [d.opsRejected, d.guardRejected, d.patchBlocked, d.opsDropped, d.opsDoubted, d.integrateRejected])
        })

        it('P4 coreVersionsByProvenance:無條件取全部版本(依概念、版本);條件皆為「且」', async () => {
            const [e1, e2] = await entries()
            const all = await queryOf({})
            assert.deepEqual(all.map((x) => [x.concept, x.version]), [[concept, 1], [concept, 2]])
            assert.deepEqual(all.map((x) => x.produced), [e1.produced, e2.produced])
            assert.deepEqual((await queryOf({ stamp: e1.produced.stamp })).map((x) => x.version), [1])
            assert.deepEqual((await queryOf({ stamp: e2.produced.stamp })).map((x) => x.version), [2])
            assert.deepEqual((await queryOf({ stamp: '20200101000000' })).map((x) => x.version), [])
            assert.deepEqual((await queryOf({ stage: 'extract' })).map((x) => x.version), [1, 2])
            assert.deepEqual((await queryOf({ stage: 'rollback' })).map((x) => x.version), [])
            assert.deepEqual((await queryOf({ stage: 'extract', stamp: e1.produced.stamp })).map((x) => x.version), [1], '且')
            assert.deepEqual((await queryOf({ stage: 'regen-core', stamp: e1.produced.stamp })).map((x) => x.version), [], '且:一條不合即無')
        })

        it('P4 provider／seat 比對 steps 任一步;兩者並給時須同一步(席號 2 之成交者是 e2 而非 e1)', async () => {
            assert.deepEqual((await queryOf({ provider: 'stub-d2' })).map((x) => x.version), [1])
            assert.deepEqual((await queryOf({ provider: 'stub-e3' })).map((x) => x.version), [2])
            assert.deepEqual((await queryOf({ provider: 'stub-i2' })).map((x) => x.version), [2], '單席之棒(整合)')
            assert.deepEqual((await queryOf({ provider: 'nobody' })).map((x) => x.version), [])
            assert.deepEqual((await queryOf({ seat: 3 })).map((x) => x.version), [1, 2])
            assert.deepEqual((await queryOf({ seat: '3' })).map((x) => x.version), [1, 2], '數字字串亦收')
            assert.deepEqual((await queryOf({ seat: 9 })).map((x) => x.version), [])
            assert.deepEqual((await queryOf({ provider: 'stub-e1', seat: 1 })).map((x) => x.version), [2])
            assert.deepEqual((await queryOf({ provider: 'stub-e1', seat: 2 })).map((x) => x.version), [], '同一步須同時合 provider 與 seat')
            assert.deepEqual((await queryOf({ provider: 'stub-e1', seat: 3 })).map((x) => x.version), [])
        })

        it('P4 since／until 比對 produced.at(含界;ISO 字串、毫秒數、Date 皆可);不可解析者拋', async () => {
            const [e1, e2] = await entries()
            assert.deepEqual((await queryOf({ since: e2.produced.at })).map((x) => x.version), [2])
            assert.deepEqual((await queryOf({ until: e1.produced.at })).map((x) => x.version), [1])
            assert.deepEqual((await queryOf({ since: e1.produced.at, until: e2.produced.at })).map((x) => x.version), [1, 2], '含界')
            assert.deepEqual((await queryOf({ since: Date.parse(e2.produced.at) })).map((x) => x.version), [2])
            assert.deepEqual((await queryOf({ until: new Date(Date.parse(e1.produced.at)) })).map((x) => x.version), [1])
            assert.deepEqual((await queryOf({ since: '2999-01-01T00:00:00+08:00' })).map((x) => x.version), [])
            await assert.rejects(() => queryOf({ since: 'not-a-time' }), /opt\.since 須為可解析之時間/)
            await assert.rejects(() => queryOf({ until: {} }), /opt\.until 須為可解析之時間/)
        })

        it('P4 輸入檢核:stores 缺 cores.select、opt.dirs 缺 core／state 即拋', async () => {
            await assert.rejects(() => coreVersionsByProvenance(undefined, { dirs: {} }), /coreVersionsByProvenance 需要 stores\.cores\.select/)
            await assert.rejects(() => coreVersionsByProvenance({ cores: { select: async () => [] } }, {}), /coreVersionsByProvenance 需要 opt\.dirs/)
            await assert.rejects(() => coreVersionsByProvenance({ cores: { select: async () => [] } }, { dirs: { core: 'x' } }), /coreVersionsByProvenance 需要 opt\.dirs/)
        })

        it('P4 純讀:查詢前後核心狀態檔與 md 之內容逐位元組不變;舊記錄(changelog 筆無 produced)不出現在結果', async () => {
            const [core] = await coresOf(flow2)
            const dirs = flow2.info().dirs
            const files = [`${dirs.core}/${core.id}.state.json`, core.file]
            const before = files.map((f) => fs.readFileSync(f, 'utf8'))
            assert.equal((await queryOf({})).length, 2)
            assert.deepEqual(files.map((f) => fs.readFileSync(f, 'utf8')), before, '純讀')
            // 模擬舊記錄:拿掉 v1 筆之 produced(狀態檔直接改寫;不經管線)
            const st = JSON.parse(before[0])
            delete st.changelog[0].produced
            fs.writeFileSync(files[0], `${JSON.stringify(st, null, 2)}\n`)
            assert.deepEqual((await queryOf({})).map((x) => x.version), [2], '無 produced 者不出現(不回填)')
            assert.deepEqual((await queryOf({ stage: 'extract' })).map((x) => x.version), [2])
            fs.writeFileSync(files[0], before[0])
        })

        it('P3 重練後新核心之第一版為 regen-core、其後之版本為 extract', async () => {
            const [core] = await coresOf(flow2)
            const r = await withStores(flow2, (s) => regenCore(s, concept, { dirs: flow2.info().dirs, stamp: 'RG1' }))
            assert.equal(r.ok, true)
            await sleep(1100)
            reps.push(await flow2.run()) // 管線消化意圖 → 以現有筆記從頭重練:新核心 v1
            const [fresh] = await coresOf(flow2)
            assert.equal(fresh.id, core.id, '新核心沿用同一 id')
            const st1 = readState({ dirs: flow2.info().dirs }, fresh.id)
            assert.deepEqual([st1.version, st1.changelog.map((e) => e.produced?.stage)], [1, ['regen-core']])
            assert.deepEqual((await queryOf({ stage: 'regen-core' })).map((x) => [x.concept, x.version]), [[concept, 1]])
            assert.deepEqual((await queryOf({ stage: 'extract' })).map((x) => x.version), [], '舊版已隨重練封存,現行狀態只有重練後之版本')
            // 其後加新筆記 → v2 為 extract
            await sleep(1100)
            const notesDir = `${work}/knowledge/notes`
            N.d = landNote(notesDir, { doc: 'd', title: '視差量測之又一方法', concepts: [concept] })
            await withStores(flow2, (s) => s.notes.insertNew([N.d]))
            reps.push(await flow2.run())
            const st2 = readState({ dirs: flow2.info().dirs }, fresh.id)
            assert.deepEqual([st2.version, st2.changelog.map((e) => e.produced?.stage)], [2, ['regen-core', 'extract']])
        })
    })

    describe('P6 不呼叫 AI 之確定性寫入(stage standards-fix)', () => {
        const NO_AI_KEYS = ['v', 'stamp', 'stage', 'seat', 'provider', 'pkg', 'at']
        const PKG = `w-knowledge-extract@${PKG_VERSION}`
        const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
        const AT_X = '2026-11-08T22:00:00+08:00'

        it('standardsFixProducedOf:規格 §2.1 單一形(seat／provider 同時 null、無 promptFp、無 steps)、stage standards-fix、pkg 取本套件版;stamp 未給＝null;at 未給或格式不合者取現在;每次回新物件', () => {
            const p = standardsFixProducedOf({ stamp: STAMP, at: AT_X })
            assert.deepEqual(Object.keys(p), NO_AI_KEYS, '規格 §2.1:單一產出者形,不呼叫 AI 者 seat 與 provider 同為 null')
            assert.deepEqual(p, { v: 1, stamp: STAMP, stage: 'standards-fix', seat: null, provider: null, pkg: PKG, at: AT_X })
            assert.equal(STANDARDS_FIX_STAGE, 'standards-fix')
            for (const o of [undefined, {}, { stamp: null }, { at: '昨天' }, { at: 5 }]) {
                const q = standardsFixProducedOf(o)
                assert.deepEqual([q.stamp, q.seat, q.provider, q.stage], [null, null, null, 'standards-fix'], JSON.stringify(o))
                assert.match(q.at, AT_RE, '未給或格式不合者取現在(共用件之格式)')
            }
            assert.notEqual(standardsFixProducedOf({ stamp: STAMP }), standardsFixProducedOf({ stamp: STAMP }))
        })

        it('stamp 不合式即拋(訊息不含輸入值;共用件之檢核),不在寫入之後才發現', () => {
            for (const bad of ['RG1', '2026', '2026110812300x', ' ']) {
                assert.throws(() => standardsFixProducedOf({ stamp: bad }), (e) => /invalid o\.stamp/.test(e.message) && !e.message.includes(bad.trim() || '\u0000'), JSON.stringify(bad))
            }
        })

        it('三個純函數之 produced 參數(加法):給了即寫入該筆 changelog 之 produced(複本、非同一參考);未給無 produced 鍵(既有輸出不變);未升版者不寫 changelog', () => {
            const p = standardsFixProducedOf({ stamp: STAMP, at: AT_X })
            // 撤出處與恢復(withdrawSources;changelog mode withdraw／restore)
            const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] }).state
            const wd = { withdraw: [{ id: 'n1', title: '甲筆記', reason: 'deleted' }], at: AT_X }
            const w1 = withdrawSources(s, { ...wd, produced: p })
            const e1 = w1.state.changelog.at(-1)
            assert.deepEqual([w1.bumped, e1.mode, e1.produced], [true, 'withdraw', p])
            assert.notEqual(e1.produced, p, '寫入複本,不與呼叫端共用參考')
            assert.equal('produced' in withdrawSources(s, wd).state.changelog.at(-1), false, '未給 produced → 無該鍵')
            const w2 = withdrawSources(w1.state, { restore: ['n1'], at: AT_X, produced: p })
            assert.deepEqual([w2.state.changelog.at(-1).mode, w2.state.changelog.at(-1).produced], ['restore', p])
            const w3 = withdrawSources(s, { withdraw: [{ id: 'zzz', title: 'z', reason: 'deleted' }], at: AT_X, produced: p })
            assert.deepEqual([w3.changed, w3.state === s], [false, true], '無變更者不寫、回原物件')
            // 還原撤回(reviveItems;changelog mode revive)
            const sr = coreStateOf({ claims: [{ text: '甲', sources: ['n1'], status: 'retracted', retractReason: '覆核無出處支持' }] }).state
            const r1 = reviveItems(sr, ['C1'], { at: AT_X, why: '裁示', produced: p })
            assert.deepEqual([r1.state.changelog.at(-1).mode, r1.state.changelog.at(-1).produced], ['revive', p])
            assert.equal('produced' in reviveItems(sr, ['C1'], { at: AT_X, why: '裁示' }).state.changelog.at(-1), false)
            assert.equal(reviveItems(sr, ['C9'], { at: AT_X, produced: p }).state, sr, '無可還原者不寫')
            // 存量處置(coreFixOf;changelog mode stock-fix)
            const sf = coreStateOf({ claims: [{ text: '软件开发', sources: ['n1'] }] }).state
            const f1 = coreFixOf(sf, { stds: ['ES3'], at: AT_X, produced: p })
            assert.deepEqual([f1.bumped, f1.state.changelog.at(-1).mode, f1.state.changelog.at(-1).produced], [true, 'stock-fix', p])
            assert.notEqual(f1.state.changelog.at(-1).produced, p)
            assert.equal('produced' in coreFixOf(sf, { stds: ['ES3'], at: AT_X }).state.changelog.at(-1), false, '預演不給 produced')
            const clean = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }] }).state
            const f2 = coreFixOf(clean, { at: AT_X, produced: p })
            assert.deepEqual([f2.bumped, f2.state === clean], [false, true], '無改動者不升版、不寫 changelog')
        })

        it('changelog 寫入站點全集(盤點指令:src 下 changelog.push( 、changelog = [ 、changelog: [非空):恰為已知 5 站,逐站皆帶 produced(AI 之各 pass 經 applyDelta 之 ctx.meta 展開);新增站點而不帶 produced 者此案即紅', () => {
            const SRC = path.join(PKG_ROOT, 'src')
            const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : (x.name.endsWith('.mjs') ? [path.join(d, x.name)] : [])))
            const re = /\bchangelog(?:\.push\(|\s*=\s*\[|:\s*\[(?!\]))/
            const hits = []
            for (const f of walk(SRC)) {
                for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
                    if (re.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push({ file: path.relative(SRC, f).replace(/\\/g, '/'), line })
                }
            }
            assert.deepEqual(hits.map((h) => h.file).sort(), ['ops/rollbackCore.mjs', 'standards/coreStockFix.mjs', 'stores/coreDelta.mjs', 'stores/coreState.mjs', 'stores/coreState.mjs'], 'applyDelta／rollbackCore／reviveItems／withdrawSources／coreFixOf')
            for (const h of hits) assert.match(h.line, /produced|ctx\.meta/, `${h.file}:該站寫 changelog 而不帶 produced`)
            assert.ok(hits.some((h) => h.file === 'stores/coreDelta.mjs' && /ctx\.meta/.test(h.line)), 'AI 之各 pass 之 produced 經 meta 展開寫入')
        })

        describe('撤出處／恢復(提煉維護;不呼叫 AI;輪次內給 ctx.stamp、輪次外為 null)', () => {
            const concept = '光譜學'
            const STAMP_W = '20261108130000'
            const e = {}
            let env = null
            let rec = null
            const st = () => readState(env, rec.id)
            const sfVersions = () => st().changelog.filter((x) => x.produced?.stage === 'standards-fix').map((x) => x.version)
            const queryOf = (o) => coreVersionsByProvenance(env.stores, { dirs: env.dirs, ...o })

            before(async () => {
                env = mkEnv(['w1', 'w2', 'w3'].map((id) => ({ id, concepts: [concept] })))
                await runWith(env, scriptAi({ draft: draftAll }), { stamp: STAMP }) // v1(extract)
                rec = (await env.stores.cores.select())[0]
                // 關聯段之刪除墓碑(帳檔名取關聯套件之常數;提煉讀之以撤出處):w1 被明示刪除 → 本輪(帶 stamp)撤出處
                const row = await env.stores.notes.get('w1')
                const tomb = path.join(env.dirs.state, DELETION_FILES.tombstones)
                await env.stores.notes.del('w1')
                fs.writeFileSync(tomb, JSON.stringify({ ids: { w1: { at: '2026-11-08T12:00:00+08:00', reason: '與他篇重複' } } }), 'utf8')
                await runWith(env, scriptAi({ draft: draftAll }), { stamp: STAMP_W })
                e.withdraw = st().changelog.find((x) => x.mode === 'withdraw')
                // 撤銷刪除(墓碑清空、筆記放回)→ 下一輪恢復;此輪不給 stamp(輪次外)
                fs.writeFileSync(tomb, JSON.stringify({ ids: {} }), 'utf8')
                await env.stores.notes.insertNew([row])
                await runWith(env, scriptAi({ draft: draftAll }), {})
                e.restore = st().changelog.find((x) => x.mode === 'restore')
            })

            it('撤出處:changelog 該筆(mode withdraw)之 produced＝單一形、stage standards-fix、seat／provider 皆 null、無 promptFp／steps、stamp＝該輪 ctx.stamp、pkg、at 與該筆 changelog 同一時刻', () => {
                const w = e.withdraw
                assert.ok(w, '前提:維護撤出處寫了一筆 withdraw')
                assert.deepEqual(w.withdrawn, ['w1'])
                assert.deepEqual(Object.keys(w.produced), NO_AI_KEYS)
                assert.deepEqual([w.produced.v, w.produced.stamp, w.produced.stage, w.produced.seat, w.produced.provider, w.produced.pkg], [1, STAMP_W, 'standards-fix', null, null, PKG])
                assert.equal(w.produced.at, w.at, '寫入時刻＝該筆 changelog 之 at')
                assert.equal('promptFp' in w.produced || 'steps' in w.produced, false)
            })

            it('恢復:changelog 該筆(mode restore)同為 standards-fix 單一形;輪次外(ctx 無 stamp)之 stamp 為 null', () => {
                const r = e.restore
                assert.ok(r, '前提:維護恢復寫了一筆 restore')
                assert.deepEqual(r.restored, ['w1'])
                assert.deepEqual(Object.keys(r.produced), NO_AI_KEYS)
                assert.deepEqual([r.produced.stamp, r.produced.stage, r.produced.seat, r.produced.provider], [null, 'standards-fix', null, null])
                assert.equal(r.produced.at, r.at)
                assert.ok(r.version > e.withdraw.version, '其後之版本')
            })

            it('AI 產出之版本不受影響:v1 之 produced 仍為 extract 多步形(stamp＝首輪)', () => {
                const p = st().changelog[0].produced
                assert.deepEqual([st().changelog[0].version, p.stage, p.stamp, p.steps.length > 0], [1, 'extract', STAMP, true])
            })

            it('依產出鏈取回:{ stage: standards-fix } 取回撤出處與恢復兩版;stamp 精確選到一版(輪次外者以 null 選);{ provider: 成交者 } 選不到該等版本;provider／seat 為 null 者(不呼叫 AI)恰選到該等版本', async () => {
                const sf = sfVersions()
                assert.deepEqual(sf, [e.withdraw.version, e.restore.version])
                assert.deepEqual((await queryOf({ stage: 'standards-fix' })).map((x) => x.version), sf)
                assert.deepEqual((await queryOf({ stage: 'standards-fix', stamp: STAMP_W })).map((x) => x.version), [e.withdraw.version])
                assert.deepEqual((await queryOf({ stage: 'standards-fix', stamp: null })).map((x) => x.version), [e.restore.version], '輪次外者以 stamp null 選')
                const byDrafter = (await queryOf({ provider: 'stub-d1' })).map((x) => x.version)
                assert.ok(byDrafter.includes(1), '前提:起草席成交者選得到 AI 產出之版本')
                assert.deepEqual(byDrafter.filter((v) => sf.includes(v)), [], '起草席成交者選不到不呼叫 AI 之版本')
                assert.deepEqual((await queryOf({ stage: 'standards-fix', provider: 'stub-d1' })).map((x) => x.version), [])
                assert.deepEqual((await queryOf({ provider: null })).map((x) => x.version), sf, 'provider null＝不呼叫 AI 之寫入')
                assert.deepEqual((await queryOf({ seat: null })).map((x) => x.version), sf)
                assert.deepEqual((await queryOf({ stage: 'extract' })).map((x) => x.version).filter((v) => sf.includes(v)), [])
            })
        })
    })
})

/** 本批第 k 篇之代號(起草提示詞之「### N<k> 標題」) */
function codeOf(prompt, k) {
    return [...prompt.matchAll(/^### (N\d+) /gm)].map((m) => m[1])[k]
}
