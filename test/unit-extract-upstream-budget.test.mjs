// unit-extract-upstream-budget.test.mjs — 3+3 工作流於時間預算邊界與斷網之真上游實跑(抓取套件之調度層之工作流入口＋真 w-dispatch-ai＋本機假 REST,
//   不呼叫真 AI)
//
// 規則(出自 workflow/aiCall 與 workflow/runPass、workflow/pending 之檔頭):上游 dispatchAiFallback 於「剩餘預算 < minAttemptMs」回 errorType 'budget'
//   (未嘗試)、嘗試之間被 shouldStop 中止回 'aborted';呼叫端給了 shouldStop(截止感知)時,shouldStop() 為真、或 budget 且剩餘不足一次嘗試者一律
//   視為截止(stopped),整個 pass 不套用(不走降級梯——否則截止窗內整合／審計／終審全略過、三份起草之聯集直接落盤);未給 shouldStop 者維持原語意
//   (budget 只是這棒失敗)。調度層整鏈皆敗而注入之網路判斷確認不通 → 回 netDown,呼叫包裝視同截止(不計失敗)。替身測試(unit-extract-workflow、
//   unit-extract-aicall)驗同一規則之程式分支,本檔驗真上游之歸類。
// 執行:自套件根 node <mocha> test/unit-extract-upstream-budget.test.mjs(固定埠:8882 假 REST、8881 無人監聽;暫存 test/_tmp/extract-upstream-<pid>〔tmpRoot〕,
//   測完即刪〔removeRoots〕)

import assert from 'node:assert/strict'
import { budgetOf } from '../src/core/capturePackage.mjs'
import { startServer, rest, mkAdapter, mkCtx } from './tools/captureForTest.mjs'
import { runPass } from '../src/workflow/runPass.mjs'
import { runPending } from '../src/workflow/pending.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { applyDelta, coverageOf, commitBatch, queuePendingReview } from '../src/stores/coreDelta.mjs'
import { emptyState } from '../src/stores/coreState.mjs'
import { pendingReviewOps } from '../src/workflow/verdicts.mjs'
import { DEAD_PORT, FAKE_PORT, tmpRoot, removeRoots } from './tools/extractTestKit.mjs'

let TMP = ''
const BASE = `http://127.0.0.1:${FAKE_PORT}/v1`
const DEAD = `http://127.0.0.1:${DEAD_PORT}/v1`
const AT = '2026-10-03T16:00:00+08:00'
const domain = createExtractDomain({})
const ANN_OBS = { critique: '僅兩組觀測', pros: ['出處未載'], cons: ['出處未載'] }

// ── 本機假 REST(OpenAI 相容;共用件 startServer 於 before 啟動、after 關閉):model 名以「情境~延遲毫秒」組成 ──
const DRAFT = JSON.stringify({
    ops: [
        { op: 'add', ref: 'x', kind: 'rule', text: '以三角視差法量測近距恆星之距離', basis: '實證', sources: ['N1'], ...ANN_OBS },
        { op: 'add', kind: 'pitfall', text: '大氣擾動大時視差量測之誤差上升', basis: '實證', sources: ['N2'], ...ANN_OBS },
    ],
    skipped: [],
})
/** 本檔之情境(共用件另內建 plain:純文字回覆;本檔之斷言不讀其內容) */
const SCENES = {
    draft: { fr: 'stop', content: DRAFT },
    issues: { fr: 'stop', content: '{"issues":[]}' },
    verdicts: { fr: 'stop', content: '{"verdicts":[]}' },
}
/** 假 REST(before 啟動;srv.hits 為命中紀錄) */
let srv = null

const ENTRIES = [rest(BASE, 'draft~600'), rest(BASE, 'draft~100'), rest(BASE, 'plain'), rest(BASE, 'issues'), rest(BASE, 'verdicts')]

const SEED_BATCH = [{ code: 'N0', id: 's0' }]
/** 既有核心(兩條主張與本質) */
const baseState = () => {
    const r = applyDelta(emptyState({ coreId: 'm', concept: '視差量測' }), { ops: [
        { op: 'add', ref: 'a', kind: 'rule', text: '視差愈小之恆星距離愈遠', basis: '實證', sources: ['N0'], ...ANN_OBS },
        { op: 'add', kind: 'pitfall', text: '單站觀測無法排除儀器之系統誤差', basis: '實證', sources: ['N0'], ...ANN_OBS },
        { op: 'essence', text: '視差量測以幾何關係推算恆星距離。', claims: ['@a'], reason: '首版' },
    ] }, { batch: SEED_BATCH, mode: 'delta', at: AT })
    assert.deepEqual(r.rejected, [])
    return commitBatch(r.state, coverageOf({ batch: SEED_BATCH, applied: r.applied }))
}
const BATCH = [
    { code: 'N1', id: 'n1', digest: '### N1 三角視差法\n【核心知識】實測顯示以三角視差法可量測近距恆星之距離。' },
    { code: 'N2', id: 'n2', digest: '### N2 大氣擾動\n【核心知識】大氣擾動大時視差量測之誤差上升，須多次觀測平均。' },
]
const NOTES = new Map([['n1', { id: 'n1', evidenceLevel: '高', claimType: '實證研究', docId: 'd1' }], ['n2', { id: 'n2', evidenceLevel: '中', claimType: '實證研究', docId: 'd2' }]])

describe('unit-extract-upstream-budget', function() {

    this.timeout(120_000)

    before(async () => {
        TMP = tmpRoot('extract-upstream')
        srv = await startServer({ port: FAKE_PORT, scenes: SCENES })
    })

    after(async () => {
        await srv?.close()
        removeRoots([TMP])
    })

    it('前提:抓取套件之調度層開工作流入口(getWkf／seatSpec／recordCall);假 REST 之起草經真上游成交(逾時 5 秒而未給 minAttemptMs 之席位亦送出),pass 完成', async () => {
        const ai = mkAdapter(TMP, ENTRIES, { healthStreak: 3 }, { workflow: true }).ai
        for (const k of ['getWkf', 'seatSpec', 'recordCall']) assert.equal(typeof ai[k], 'function', k)
        const S = (use) => ({ use, fallback: [], timeoutMs: 5000 })
        const seats = { drafters: [S('rest:draft~100'), S('rest:draft~100'), S('rest:draft~100')], integrate: S('rest:plain'), audit: S('rest:issues'), revise: S('rest:issues'), accept: S('rest:verdicts') }
        const calls = []
        const r = await runPass({ state: baseState(), concept: '視差量測', batch: BATCH, domain, seats, ai, notesById: NOTES, at: AT, integrate: 'program', onCall: (e) => calls.push(e) })
        assert.equal(r.ok, true, JSON.stringify({ error: r.error, degrade: r.degrade }))
        const drafts = calls.filter((c) => /^draft\d$/.test(c.stage))
        assert.deepEqual(drafts.map((c) => [c.ok, c.providerId]), [[true, 'rest:draft~100'], [true, 'rest:draft~100'], [true, 'rest:draft~100']], '三席起草經真上游成交')
        const later = Object.fromEntries(calls.filter((c) => !/^draft\d$/.test(c.stage)).map((c) => [c.stage, c.ok]))
        assert.deepEqual([later.integrate, later.audit, later.accept], [undefined, true, true], '整合為程式聯集(不呼叫);審計、終審經真上游成交')
    })

    it('截止窗內(未逾期):起草成交後整合之剩餘預算不足一次嘗試(上游 budget)→ 給了 shouldStop 者整個 pass 回 stopped、不套用(不走降級梯)', async () => {
        const ai = mkAdapter(TMP, ENTRIES, { healthStreak: 3 }, { workflow: true }).ai
        const ctx = mkCtx(1500)
        const b = budgetOf(ctx)
        const S = (use) => b.capSeat({ use, fallback: [], timeoutMs: 5000, minAttemptMs: 1000 })
        const seats = { drafters: [S('rest:draft~600'), S('rest:draft~600'), S('rest:draft~600')], integrate: S('rest:draft~100'), audit: S('rest:issues'), revise: S('rest:issues'), accept: S('rest:verdicts') }
        const n0 = srv.hits.length
        const r = await runPass({ state: baseState(), concept: '視差量測', batch: BATCH, domain, seats, ai, notesById: NOTES, at: AT, shouldStop: b.shouldStop, remainingMs: b.remainingMs })
        assert.equal(r.ok, false)
        assert.equal(r.stopped, true, `須歸類為截止:${JSON.stringify({ error: r.error, degrade: r.degrade })}`)
        assert.equal(ctx.expired(), false, '前提:回傳時尚未逾期(是預算窗,不是逾期)')
        assert.deepEqual(srv.hits.slice(n0).map((h) => h.model), ['draft~600', 'draft~600', 'draft~600'], '只發出三席起草,整合未送出(上游 budget)')
    })

    it('起草三席全被預算擋下(未逾期)→ 給了 shouldStop 者回 stopped(非「起草全敗」);未給者維持「起草全敗」(budget 只是這棒失敗)', async () => {
        const ai = mkAdapter(TMP, ENTRIES, { healthStreak: 3 }, { workflow: true }).ai
        const mk = (budget) => {
            const b = budgetOf(mkCtx(budget))
            const S = (use) => b.capSeat({ use, fallback: [], timeoutMs: 5000, minAttemptMs: 1000 })
            return { b, seats: { drafters: [S('rest:draft~100'), S('rest:draft~100'), S('rest:draft~100')], integrate: S('rest:plain'), audit: S('rest:issues'), revise: S('rest:issues'), accept: S('rest:verdicts') } }
        }
        const a = mk(800)
        const ra = await runPass({ state: baseState(), concept: '視差量測', batch: BATCH, domain, seats: a.seats, ai, notesById: NOTES, at: AT, shouldStop: a.b.shouldStop, remainingMs: a.b.remainingMs })
        assert.deepEqual([ra.ok, ra.stopped], [false, true], JSON.stringify({ error: ra.error }))
        const c = mk(800)
        const rc = await runPass({ state: baseState(), concept: '視差量測', batch: BATCH, domain, seats: c.seats, ai, notesById: NOTES, at: AT })
        assert.equal(rc.ok, false)
        assert.notEqual(rc.stopped, true, '未給 shouldStop:不是截止感知,維持原語意')
        assert.match(String(rc.error), /起草全敗/)
    })

    it('待審裁決於預算窗內:終審席 budget → 給了 shouldStop 者回 stopped、待審保留(不當失敗記 tries)', async () => {
        const ai = mkAdapter(TMP, ENTRIES, { healthStreak: 3 }, { workflow: true }).ai
        const s0 = baseState()
        const q = queuePendingReview(s0, [{ resolved: { op: 'supersede', id: 'C2', reason: '新觀測', validPeriod: '較早之觀測', sources: ['s0'] }, sources: ['s0'] }], { at: AT, reason: '終審失敗' })
        assert.equal(pendingReviewOps(q.state).ops.length, 1)
        const b = budgetOf(mkCtx(500))
        const seats = { accept: b.capSeat({ use: 'rest:verdicts', fallback: [], timeoutMs: 5000, minAttemptMs: 1000 }) }
        const r = await runPending({ state: q.state, concept: '視差量測', batch: BATCH, domain, seats, ai, notesById: NOTES, at: AT, shouldStop: b.shouldStop, remainingMs: b.remainingMs })
        assert.deepEqual([r.ok, r.stopped], [false, true], JSON.stringify({ error: r.error }))
        assert.equal(pendingReviewOps(r.state).ops.length, 1, '待審保留')
    })

    it('斷網:條目指向無人監聽之埠、注入之網路判斷確認不通 → 起草整鏈皆敗之結果標 netDown(逐棒紀錄可見),pass 回 stopped(不計失敗);未注入判斷者為一般失敗(起草全敗)', async () => {
        const dead = [rest(DEAD, 'm')]
        let asked = 0
        const down = mkAdapter(TMP, dead, { healthStreak: 3 }, { workflow: true, isNetDown: async () => {
            asked++
            return true
        } }).ai
        const S = (use) => ({ use, fallback: [], timeoutMs: 5000 })
        const seats = { drafters: [S('rest:m'), S('rest:m'), S('rest:m')], integrate: S('rest:m'), audit: S('rest:m'), revise: S('rest:m'), accept: S('rest:m') }
        const calls = []
        const r = await runPass({ state: baseState(), concept: '視差量測', batch: BATCH, domain, seats, ai: down, notesById: NOTES, at: AT, shouldStop: () => false, remainingMs: () => 600_000, onCall: (e) => calls.push(e) })
        assert.deepEqual([r.ok, r.stopped], [false, true], JSON.stringify({ error: r.error }))
        assert.ok(calls.length >= 1 && calls.every((c) => c.netDown === true), `逐棒紀錄標 netDown(提煉段據以寫「因本機網路不通」):${JSON.stringify(calls.map((c) => [c.stage, c.netDown]))}`)
        assert.ok(asked >= 1, '整鏈皆敗時詢問網路判斷')
        const plain = mkAdapter(TMP, dead, { healthStreak: 3 }, { workflow: true }).ai
        const r2 = await runPass({ state: baseState(), concept: '視差量測', batch: BATCH, domain, seats, ai: plain, notesById: NOTES, at: AT, shouldStop: () => false, remainingMs: () => 600_000 })
        assert.deepEqual([r2.ok, r2.stopped === true], [false, false])
        assert.match(String(r2.error), /起草全敗/)
    })
})
