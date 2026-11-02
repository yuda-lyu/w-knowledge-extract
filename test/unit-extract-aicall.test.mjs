// unit-extract-aicall.test.mjs — 提煉各棒之 AI 呼叫之單一包裝(workflow/aiCall:extractAiCall、extractFanout)與判定小組共同之讀票規則
//   (standards/panelVotes:verdictFieldsOf、votesByIndexOf、panelRetryOf、panelCallOf)
// 規格:①未送出之三種(到點、席位未設、整條鏈放不下)與送出之選項(明給 acceptTruncated:false、不帶 onEvent——調度層以 { ...預設, ...逐次選項 }
//   合併,給了即蓋掉其計帳與健康)②送出者 recordCall 與 onCall 各一次 ③歸類:截止感知之截止、斷網(netDown)→ stopped,不計失敗
//   ④讀票:裁決值不分大小寫、理由空白收斂與下限、同編號矛盾作廢、本席未見之項略過 ⑤缺票或同一供應者為重試之對象 ⑥執行器之呼叫之正規化不包成 async
// 【替身為被測物專屬,不取 extractKit】本檔之被測物即呼叫之包裝本身:替身須記下 seatSpec 之引數(含提示詞長度)、callAi／runFanout 之逐次選項與 recordCall,
//   並可逐呼叫指定原始回覆(含調度層之 netDown／budget 形狀)——extractKit 之 scriptAi／seatAi 依席位回 JSON、不記選項,套不上
// 執行:自套件根 node <mocha> test/unit-extract-aicall.test.mjs(不呼叫 AI)

import assert from 'node:assert/strict'
import { PANEL_UNSURE, PANEL_WHY, runPanelPage } from '../src/core/summarizePackage.mjs'
import { extractAiCall, extractFanout, triedOf } from '../src/workflow/aiCall.mjs'
import { VERDICT_MIN_REASON, verdictFieldsOf, votesByIndexOf, panelRetryOf, panelCallOf } from '../src/standards/panelVotes.mjs'

/**
 * 調度層之替身:記下 seatSpec、callAi、runFanout 之輸入與 recordCall;回覆由 o 決定
 *
 * @param {Object} [o={}] 輸入 { spec:(seat, len)=>規格|null, reply:(prompt, opt)=>結果, agent:(agent, j)=>結果 }
 * @returns {Object} 回傳 { seen:{ spec, callAi, fanout, recorded }, getWkf, seatSpec, recordCall }
 */
function fakeAi(o = {}) {
    const seen = { spec: [], callAi: [], fanout: [], recorded: [] }
    const wkf = {
        callAi: async (prompt, opt) => {
            seen.callAi.push({ prompt, opt })
            return o.reply ? o.reply(prompt, opt) : { ok: true, json: { ops: [] }, providerId: `p-${opt.spec.use}`, ms: 3, tried: [{ providerId: `p-${opt.spec.use}`, outcome: 'ok', durationMs: 3 }] }
        },
        runFanout: async (opt) => {
            seen.fanout.push(opt)
            return { ok: true, agents: opt.agents.map((a, j) => (o.agent ? o.agent(a, j) : { ok: true, json: { ops: [] }, providerId: `p-${a.use}`, tried: [] })) }
        },
    }
    const spec = (seat, len) => (o.spec ? o.spec(seat, len) : { use: seat.use, fallback: ['f1'], timeoutMs: 1000, budgetMs: 2000, ...(seat.minAttemptMs ? { minAttemptMs: seat.minAttemptMs } : {}) })
    return {
        seen,
        getWkf: () => wkf,
        seatSpec: (seat, len) => {
            seen.spec.push([seat?.use, len])
            return spec(seat, len)
        },
        recordCall: (r) => seen.recorded.push(r),
    }
}

const parse = (s) => s
const check = () => true
const SEAT = { use: 'm1', minAttemptMs: 30_000 }

describe('unit-extract-aicall', function() {

    describe('extractAiCall(單棒)', function() {

        it('送出之選項:spec＝{ use, fallback }、席位規格之其餘(逾時、預算、最低嘗試)、parse、check、acceptTruncated:false、shouldStop——不帶 onEvent;recordCall 與 onCall 各一次;回傳工作流之結果', async () => {
            const ai = fakeAi()
            const entries = []
            const stop = () => false
            const r = await extractAiCall(ai, { stage: 'audit', seat: SEAT, prompt: '提示詞', parse, check, shouldStop: stop, remainingMs: () => 1e9, onCall: (e) => entries.push(e) })
            assert.equal(r.ok, true)
            assert.deepEqual(ai.seen.spec, [['m1', 3]], '依實際提示詞長度預篩')
            const opt = ai.seen.callAi[0].opt
            assert.deepEqual(Object.keys(opt).sort(), ['acceptTruncated', 'budgetMs', 'check', 'minAttemptMs', 'parse', 'shouldStop', 'spec', 'timeoutMs'])
            assert.deepEqual([opt.spec, opt.timeoutMs, opt.budgetMs, opt.minAttemptMs, opt.acceptTruncated, opt.parse, opt.check, opt.shouldStop], [{ use: 'm1', fallback: ['f1'] }, 1000, 2000, 30_000, false, parse, check, stop])
            assert.equal('onEvent' in opt, false, '不帶 onEvent(呼叫端給了即蓋掉調度層之計帳與健康)')
            assert.deepEqual(ai.seen.recorded, [r])
            assert.deepEqual(entries, [{ stage: 'audit', ok: true, providerId: 'p-m1', ms: 3, error: '', promptLen: 3, tried: [{ id: 'p-m1', outcome: 'ok', errorType: '', ms: 3, error: '' }], netDown: false }])
            // 未給 shouldStop:傳給工作流者仍為函數(恆 false)
            const ai2 = fakeAi()
            await extractAiCall(ai2, { stage: 'x', seat: SEAT, prompt: 'p', parse, check })
            assert.equal(ai2.seen.callAi[0].opt.shouldStop(), false)
        })

        it('未送出:到點 → stopped;席位未設 → unset(「席位未設」,與放不下分開);整條鏈放不下 → oversize;三者皆不 recordCall、不呼叫 onCall', async () => {
            const entries = []
            const onCall = (e) => entries.push(e)
            const ai = fakeAi({ spec: () => null })
            assert.deepEqual(await extractAiCall(ai, { stage: 'a', seat: SEAT, prompt: 'p', parse, check, shouldStop: () => true, onCall }), { ok: false, error: 'stopped', stopped: true })
            assert.deepEqual(ai.seen.spec, [], '到點:不預篩')
            assert.deepEqual(await extractAiCall(ai, { stage: 'a', seat: null, prompt: 'p', parse, check, onCall }), { ok: false, error: '席位未設', unset: true })
            assert.deepEqual(ai.seen.spec, [], '席位未設:不交 seatSpec(設定之缺漏,不是放不下)')
            assert.deepEqual(await extractAiCall(ai, { stage: 'a', seat: SEAT, prompt: 'p', parse, check, onCall }), { ok: false, error: 'oversize', oversize: true })
            assert.deepEqual([ai.seen.callAi.length, ai.seen.recorded.length, entries.length], [0, 0, 0])
        })

        it('歸類:截止感知(給了 shouldStop)而未成交——棒回來已到點、或預算耗盡而剩餘不足該席最低嘗試(未給取 20 秒)→ stopped 附 cause;未給 shouldStop 者不歸類;成交者不歸類', async () => {
            const budget = () => ({ ok: false, error: 'budget exhausted', errorType: 'budget', tried: [] })
            const go = (o) => extractAiCall(fakeAi({ reply: o.reply || budget }), { stage: 'a', seat: o.seat || SEAT, prompt: 'p', parse, check, ...o.x })
            assert.deepEqual(await go({ x: { shouldStop: () => false, remainingMs: () => 29_999 } }), { ok: false, error: 'stopped', stopped: true, cause: 'budget exhausted' }, '剩餘 < 席位之最低嘗試 30 秒')
            assert.equal((await go({ x: { shouldStop: () => false, remainingMs: () => 30_000 } })).stopped, undefined, '剩餘充裕:席位自帶預算之耗盡是失敗')
            assert.equal((await go({ seat: { use: 'm1' }, x: { shouldStop: () => false, remainingMs: () => 19_999 } })).stopped, true, '席位未給 minAttemptMs → 20 秒')
            assert.equal((await go({ seat: { use: 'm1' }, x: { shouldStop: () => false, remainingMs: () => 20_000 } })).stopped, undefined)
            let n = 0
            const late = await go({ reply: () => ({ ok: false, error: 'timeout', errorType: 'timeout', tried: [] }), x: { shouldStop: () => ++n > 1 } })
            assert.deepEqual([late.stopped, late.cause], [true, 'timeout'], '送出前未到點、回來時已到點 → 截止')
            assert.equal((await go({ x: { remainingMs: () => 0 } })).stopped, undefined, '未給 shouldStop(非截止感知):不歸類')
            let m = 0
            assert.equal((await go({ reply: () => ({ ok: true, json: {} }), x: { shouldStop: () => ++m > 1, remainingMs: () => 0 } })).ok, true, '成交者不歸類(回來時已到點亦然)')
        })

        it('斷網:調度層標 netDown(整鏈皆敗且本機網路不通)→ stopped 附 netDown,不論是否截止感知;棒已送出 → recordCall 與 onCall 照記', async () => {
            const entries = []
            const ai = fakeAi({ reply: () => ({ ok: false, skipped: true, netDown: true, error: 'all failed', errorType: 'exec', tried: [{ providerId: 'x', outcome: 'fail', errorType: 'exec' }] }) })
            const r = await extractAiCall(ai, { stage: 'accept', seat: SEAT, prompt: 'p', parse, check, onCall: (e) => entries.push(e) })
            assert.deepEqual(r, { ok: false, error: 'stopped', stopped: true, netDown: true, cause: 'all failed' })
            assert.deepEqual([ai.seen.recorded.length, entries.length, entries[0].ok, entries[0].error], [1, 1, false, 'all failed'])
        })

        it('onCall 拋錯不影響呼叫之結果', async () => {
            const r = await extractAiCall(fakeAi(), { stage: 'a', seat: SEAT, prompt: 'p', parse, check, onCall: () => {
                throw new Error('回呼壞了')
            } })
            assert.equal(r.ok, true)
        })

        it('triedOf:遞補鏈逐家之成交／失敗;失敗者留原文前 400 字與錯誤輸出末 400 字', () => {
            const t = triedOf({ tried: [{ keyId: 'k#1', providerId: 'k', outcome: 'fail', errorType: 'exec', durationMs: 7, error: 'Exit code 1', stdout: 'x'.repeat(500), stderr: 'e'.repeat(450), finishReason: 'length' }, { providerId: 'p', outcome: 'ok' }] })
            assert.deepEqual([t[0].id, t[0].out.length, t[0].outLen, t[0].err.length, t[0].finish, t[1]], ['k#1', 400, 500, 400, 'length', { id: 'p', outcome: 'ok', errorType: '', ms: 0, error: '' }])
            assert.deepEqual(triedOf(null), [])
        })
    })

    describe('extractFanout(起草三席)', function() {

        it('未設之席不送(不交 seatSpec)、放不下之席不送;多開之選項(同一份提示詞、minCandidates 99、callOpt.shouldStop、各席 acceptTruncated:false、不帶 onEvent);各席 recordCall＋onCall(棒名依席之索引)', async () => {
            const entries = []
            const ai = fakeAi({ spec: (seat) => (seat.use === 'big' ? null : { use: seat.use, fallback: [], timeoutMs: 9, budgetMs: 18 }) })
            const stop = () => false
            const r = await extractFanout(ai, { stages: ['draft1', 'draft2', 'draft3'], seats: [{ use: 'a' }, null, { use: 'big' }, { use: 'c' }], prompt: '任務', parse, check, shouldStop: stop, onCall: (e) => entries.push(e) })
            assert.deepEqual(ai.seen.spec.map((x) => x[0]), ['a', 'big', 'c'], '未設之席不交 seatSpec')
            const opt = ai.seen.fanout[0]
            assert.deepEqual([opt.task, opt.minCandidates, opt.callOpt.shouldStop, Object.keys(opt.callOpt)], ['任務', 99, stop, ['shouldStop']])
            assert.deepEqual(opt.agents, [{ use: 'a', fallback: [], timeoutMs: 9, budgetMs: 18, parse, check, acceptTruncated: false }, { use: 'c', fallback: [], timeoutMs: 9, budgetMs: 18, parse, check, acceptTruncated: false }])
            assert.deepEqual([r.stopped, r.unset, r.alive, r.results.map((x) => x.k), r.cut], [false, 1, 2, [0, 3], 0])
            assert.deepEqual(entries.map((e) => e.stage), ['draft1', undefined], '棒名依席之索引(第 4 席無棒名)')
            assert.equal(ai.seen.recorded.length, 2)
        })

        it('皆未設或放不下 → alive 0、不呼叫工作流(未設之席數另計,與放不下分開);到點 → stopped、不預篩不送;歸為截止之席數 cut(截止感知之預算耗盡、斷網)', async () => {
            const none = fakeAi({ spec: () => null })
            assert.deepEqual(await extractFanout(none, { seats: [{ use: 'a' }, { use: 'b' }], prompt: 'p', parse, check }), { stopped: false, unset: 0, alive: 0, results: [], cut: 0 })
            assert.deepEqual(await extractFanout(none, { seats: [null, undefined], prompt: 'p', parse, check }), { stopped: false, unset: 2, alive: 0, results: [], cut: 0 })
            assert.equal(none.seen.fanout.length, 0)
            const early = fakeAi()
            assert.deepEqual(await extractFanout(early, { seats: [{ use: 'a' }], prompt: 'p', parse, check, shouldStop: () => true }), { stopped: true, unset: 0, alive: 0, results: [], cut: 0 })
            assert.deepEqual([early.seen.spec.length, early.seen.fanout.length], [0, 0])
            const mixed = fakeAi({ agent: (a) => (a.use === 'a' ? { ok: false, errorType: 'budget', error: 'budget', tried: [] } : a.use === 'b' ? { ok: false, netDown: true, skipped: true, error: 'down', tried: [] } : { ok: false, error: 'exec', errorType: 'exec', tried: [] }) })
            const r = await extractFanout(mixed, { stages: ['d1', 'd2', 'd3'], seats: [{ use: 'a' }, { use: 'b' }, { use: 'c' }], prompt: 'p', parse, check, shouldStop: () => false, remainingMs: () => 0 })
            assert.deepEqual([r.alive, r.cut, r.results.map((x) => x.stopped)], [3, 2, [true, true, false]], '預算耗盡(剩餘 0)與斷網歸截止;一般失敗不歸')
        })
    })

    describe('判定小組共同之讀票規則(standards/panelVotes)', function() {

        it('verdictFieldsOf:裁決值去空白並轉小寫、理由之空白收成一格;非物件 → null;理由下限為 10 字', () => {
            assert.deepEqual(verdictFieldsOf({ verdict: ' SUPPORTED ', reason: ' 出處\n第二段　 直接陳述 ' }), { verdict: 'supported', reason: '出處 第二段 直接陳述' })
            assert.deepEqual(verdictFieldsOf({ verdict: 3, reason: null }), { verdict: '3', reason: '' })
            assert.deepEqual([null, 'x', undefined, []].map(verdictFieldsOf), [null, null, null, null])
            assert.equal(VERDICT_MIN_REASON, 10)
        })

        it('votesByIndexOf:以編號對應(非整數略過——數字字串、小數皆不收;終審 §3 D5j)、只收本席所見之項、同編號矛盾 → 缺票(null)、相同之重複保留首票;回覆無 checks 陣列 → 空', () => {
            const same = (a, b) => a?.v === b?.v
            const m = votesByIndexOf({ checks: [{ index: 1, v: 'a', n: 1 }, { index: 1, v: 'a', n: 2 }, { index: 2, v: 'a' }, { index: 2, v: 'b' }, { index: '3', v: 'a' }, { index: 1.5, v: 'a' }, { index: 9, v: 'a' }, null] }, { seen: (i) => i < 9, voteOf: (raw) => ({ v: raw.v, n: raw.n }), same })
            assert.deepEqual([...m], [[1, { v: 'a', n: 1 }], [2, null]], '數字字串之編號不收(嚴格整數,不以 Number() 寬鬆轉換)')
            assert.deepEqual([...votesByIndexOf({ checks: 'x' }, { seen: () => true, voteOf: () => 1, same })], [])
            assert.deepEqual([...votesByIndexOf(null, { seen: () => true, voteOf: () => 1, same })], [])
        })

        it('panelRetryOf:無結果、缺票、同一供應者 → 重試之對象;成立、判不了(不確定／不一致)→ 否', () => {
            assert.deepEqual([undefined, { status: 'undetermined', why: PANEL_WHY.MISSING }, { status: 'undetermined', why: PANEL_WHY.SAME_PROVIDER }].map(panelRetryOf), [true, true, true])
            assert.deepEqual([{ status: 'decided', verdict: {}, why: '' }, { status: 'undetermined', why: PANEL_WHY.UNSURE }, { status: 'undetermined', why: PANEL_WHY.DISAGREE }].map(panelRetryOf), [false, false, false])
        })

        it('panelCallOf:{ ok, json, providerId, stopped } → { ok, data, providerId, stop };不包成 async——同步拋出原樣拋出,單頁執行器之第二席不被呼叫', async () => {
            const c = panelCallOf({ call: async () => ({ ok: true, json: { checks: [] }, providerId: 'p', stopped: false }) })
            assert.deepEqual(await c('s', {}, 'x'), { ok: true, data: { checks: [] }, providerId: 'p', stop: false })
            assert.deepEqual(await panelCallOf({ call: () => null })('s', {}, 'x'), { ok: undefined, data: undefined, providerId: undefined, stop: undefined })
            const thrower = panelCallOf({ call: () => {
                throw new Error('同步拋出')
            } })
            assert.throws(() => thrower('s', {}, 'x'), /同步拋出/, '同步拋出(非拒絕之 Promise)')
            const seen = []
            await assert.rejects(runPanelPage({
                local: [{ index: 1, key: 'k' }], buildPrompt: () => 'p', shufflePrefix: 't', stages: ['s1', 's2', 's3'], seats: { first: {}, second: {} }, votesOf: () => new Map(),
                call: panelCallOf({ call: (stage) => {
                    seen.push(stage)
                    if (stage === 's1') throw new Error('第一席同步拋出')
                    return { ok: true }
                } }),
            }), /第一席同步拋出/)
            assert.deepEqual(seen, ['s1'], '第二席未被呼叫')
            assert.equal(PANEL_UNSURE, 'unsure')
        })
    })
})
