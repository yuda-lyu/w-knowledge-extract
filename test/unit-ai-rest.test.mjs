// unit-ai-rest.test.mjs — AI 調度層因應 w-dispatch-ai 1.0.37／1.0.38 之契約(截斷放行、錯誤歷程、條目 validate 交集、冷卻偵測、整組金鑰皆敗)
// 以本機假 OpenAI 相容伺服器(固定埠 8781)走真實 fetch 與真實 dispatchAiFallback,不 mock 轉接器;
// 依請求之 model 決定情境、依 Bearer 金鑰決定該把之成敗。暫存落 test/_tmp/ai-rest-<pid>,測完即刪。
// 執行:npx mocha test/unit-ai-rest.test.mjs --timeout 180000

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import dispatchAiFallback from 'w-dispatch-ai/src/dispatchAiFallback.mjs'
import extractJsonLoose from 'w-dispatch-ai/src/wkf/extractJsonLoose.mjs'
import salvageTruncatedArray from 'w-dispatch-ai/src/wkf/salvageTruncatedArray.mjs'
import { createAiAdapter } from '../src/ai/adapter.mjs'
import { createAiCaller } from '../src/ai/caller.mjs'
import { logAiOutcome } from '../src/ai/logAiOutcome.mjs'
import { runAiBatchStage } from '../src/stages/aiBatchStage.mjs'
import { buildRunSummary } from '../src/ops/runSummary.mjs'
import { createClock } from '../src/util/clock.mjs'

const TMP = path.resolve(`test/_tmp/ai-rest-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴;after 清除
const PORT = 8781 // 固定埠(≥8000、不隨機);本檔為全套唯一開埠者
const BASE = `http://127.0.0.1:${PORT}/v1`

// ── 假伺服器之情境(以 model 選取):content 與 finish_reason ──
const SCENES = {
    s1: { fr: 'length', content: '[{"index":1,"v":"a"},{"index":2,"v":"b"},{"index":3,"v":"c' }, // 2 項完整＋1 項半截
    s0: { fr: 'length', content: '[{"index":1,"v":"a"},{"index":2,"v":"b"},{"index":3,"v":"c"}]\n\n補充說明:以上三項皆依原文萃取,其中第二項之' }, // JSON 完整,截在其後說明
    s2: { fr: 'length', content: '[{"index":1,"v":"a' }, // 0 項完整
    cf: { fr: 'content_filter', content: '[{"index":1,"v":"a"}]' },
    empty: { fr: 'length', content: '', reasoning: 600 },
    ok: { fr: 'stop', content: '[{"index":1,"v":"a"},{"index":2,"v":"b"},{"index":3,"v":"c"}]' },
    plain: { fr: 'stop', content: '好的,這是純文字回覆,不是 JSON。' },
    ratetext: { fr: 'stop', content: '本文討論 API 的 rate limit 與 quota exceeded 之應對方式。' }, // 內容談及限流字樣(非 JSON)
}
const hits = [] // 每次請求 { model, key }

// ── model 'plan' 之排程(依 prompt 內 [[標籤]] 與 Bearer 金鑰):延遲與回應;供並行呼叫跨越一次成交之四情境 ──
//   json＝完整 JSON 陣列(成交);plain＝非 JSON(驗證失敗,整組跳過);st＝非 200 狀態碼(換金鑰)
const PLAN = {
    // 控制組:依序兩呼叫,皆 ka 401、kb 非 JSON
    'C1|ka': { ms: 20, st: 401 },
    'C1|kb': { ms: 20, body: 'plain' },
    'C2|ka': { ms: 20, st: 401 },
    'C2|kb': { ms: 20, body: 'plain' },
    // 多計情境:X、Y 並行,X 之 ka 於 100ms 成交(游標推進到 kb);Y 之 ka 於 300ms 回 401(成交之後)、kb 非 JSON;其後 Z 自 kb 起跑:kb 401、ka 非 JSON
    'X|ka': { ms: 100, body: 'json' },
    'Y|ka': { ms: 300, st: 401 },
    'Y|kb': { ms: 20, body: 'plain' },
    'Z|kb': { ms: 20, st: 401 },
    'Z|ka': { ms: 20, body: 'plain' },
    // 少計情境:X3、Y3 並行,Y3 之 ka 於 20ms 回 401(成交之前),X3 之 ka 於 100ms 成交,Y3 之 kb 於其後回 401(兩把皆敗)
    'X3|ka': { ms: 100, body: 'json' },
    'Y3|ka': { ms: 20, st: 401 },
    'Y3|kb': { ms: 200, st: 401 },
    // 多計情境(預算用盡):budgetMs 20500;X4、Y4 並行,X4 之 ka 成交;Y4 之 ka 於 1 秒回 401 → 剩餘不足 20000,組內預算用盡;Z4 自 kb 起跑亦同
    'X4|ka': { ms: 100, body: 'json' },
    'Y4|ka': { ms: 1000, st: 401 },
    'Z4|kb': { ms: 1000, st: 401 },
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 假伺服器:dead* 金鑰回 401;slow401 延遲 1 秒後回 401;rl503 回 503(本體含 rate limit);plan 依排程表;其餘依情境回 200 */
function handler(req, res) {
    let buf = ''
    req.on('data', (c) => {
        buf += c
    })
    req.on('end', async () => {
        let body = {}
        try {
            body = JSON.parse(buf)
        }
        catch { /* 本體非 JSON:依空物件處理 */ }
        const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
        const model = String(body.model || '')
        hits.push({ model, key })
        if (model === 'plan') {
            const tag = (String(body.messages?.[body.messages.length - 1]?.content || '').match(/\[\[(\w+)\]\]/) || [])[1] || '?'
            const p = PLAN[`${tag}|${key}`] || { st: 500 }
            await sleep(p.ms || 0)
            if ((p.st || 200) !== 200) {
                res.writeHead(p.st, { 'Content-Type': 'application/json' })
                res.end('{"message":"invalid key"}')
                return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: p.body === 'json' ? SCENES.ok.content : SCENES.plain.content }, finish_reason: 'stop' }] }))
            return
        }
        if (model === 'slow401') await sleep(1000)
        if (key.startsWith('dead') || model === 'slow401') {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end('{"message":"invalid key"}')
            return
        }
        if (model === 'rl503') {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end('{"error":"rate limit exceeded, retry later"}')
            return
        }
        const sc = SCENES[model] || SCENES.ok
        const usage = { prompt_tokens: 10, completion_tokens: 5, ...(sc.reasoning ? { completion_tokens_details: { reasoning_tokens: sc.reasoning } } : {}) }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'fake', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: sc.content }, finish_reason: sc.fr }], usage }))
    })
}

// ── 供應商條目(安裝方自帶,走 envVar 展開金鑰)──
const rest = (id, model, envVar = 'FAKE_ONE', extra = {}) => ({ id, model, kind: 'api-openai-compat', baseURL: BASE, envVar, ...extra })
const ENTRIES = [
    rest('rest:s1', 's1'),
    rest('rest:s0', 's0'),
    rest('rest:s2', 's2'),
    rest('rest:cf', 'cf'),
    rest('rest:empty', 'empty'),
    rest('rest:ok', 'ok'),
    rest('rest:plainv', 'plain', 'FAKE_ONE', { validate: 'nonempty' }), // 條目自帶 validate(D1)
    rest('rest:okv', 'ok', 'FAKE_ONE', { validate: 'nonempty' }),
    rest('rest:ratetext', 'ratetext'),
    rest('rest:rl503', 'rl503'),
    rest('rest:dead2', 'ok', 'FAKE_DEAD2'), // 兩把皆死
    rest('rest:half', 'ok', 'FAKE_HALF'), // 一死一活
    rest('rest:slow', 'slow401', 'FAKE_SLOW'),
    rest('rest:plan', 'plan', 'FAKE_PLAN'), // 依排程表(兩把 ka、kb)
    rest('rest:nokey', 'plain', null), // 無金鑰條目(不帶認證標頭;回非 JSON → 驗證失敗)
]
const ENV = { FAKE_ONE: 'k1', FAKE_DEAD2: 'deadA, deadB,', FAKE_HALF: 'deadX,liveY', FAKE_SLOW: 'slowA,slowB', FAKE_PLAN: 'ka,kb' }
const IDS = ENTRIES.map((e) => e.id)

const check = (d) => Array.isArray(d) && d.length > 0
const isValid = (it, batch) => Number.isInteger(it?.index) && it.index >= 1 && it.index <= batch.length && typeof it.v === 'string'

let seq = 0
/** 每個測試各自一個 adapter 與狀態目錄(游標/冷卻/用量互不干擾);aiExtra 覆寫 settings.ai 之鍵(如 healthStreak) */
function mkAdapter(o = {}, aiExtra = {}) {
    const dir = `${TMP}/a${++seq}`
    fs.mkdirSync(dir, { recursive: true })
    return createAiAdapter({
        ai: {
            providerPick: IDS,
            extraProviders: ENTRIES,
            providerTimeouts: Object.fromEntries(IDS.map((id) => [id, 60_000])), // ≥ minAttemptMs(20000)
            cooldownMs: 900_000,
            maxRetries: 0,
            healthStreak: 2,
            ...aiExtra,
        },
        env: ENV,
        stateDir: dir,
        workspace: dir,
        clock: createClock('Asia/Taipei'),
        ...o,
    })
}

describe('unit-ai-rest', function() {

    let server = null

    before(async function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        server = http.createServer(handler)
        await new Promise((resolve, reject) => {
            server.once('error', (e) => reject(new Error(`假伺服器無法監聽固定埠 ${PORT}(${e.code || e.message}):請確認無其他行程佔用`)))
            server.listen(PORT, '127.0.0.1', resolve)
        })
    })

    after(async function() {
        if (server) {
            server.closeAllConnections?.()
            await new Promise((resolve) => server.close(resolve))
        }
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    beforeEach(function() {
        hits.length = 0
    })

    // ── R01／R02:截斷放行(A1)與可見(P6)──
    describe('R01 截斷放行(callJson 帶 acceptTruncated)', function() {

        it('S1(2 完整＋1 半截):成功、收 2 項、truncated:true;健康層計「截斷放行」並帶入執行摘要與輪末彙總', async () => {
            const ai = mkAdapter()
            const r = await ai.callJson('萃取', check, { spec: { use: 'rest:s1' } })
            assert.equal(r.ok, true, `1.0.37 起未帶 acceptTruncated 即判 incomplete:${r.error}`)
            assert.deepEqual(r.data.map((x) => x.index), [1, 2], '搶救前段完整項目')
            assert.equal(r.truncated, true)
            assert.equal(r.attempts, 1)
            assert.equal(hits.length, 1)
            // R02:截斷放行另計、不當失敗
            const snap = ai.health.snapshot()
            assert.equal(snap.counts['rest:s1'].truncated, 1)
            assert.equal(snap.counts['rest:s1'].ok, 1)
            assert.match(ai.health.summary(), /截斷放行 rest:s1×1/)
            const sum = buildRunSummary({ ai, stamp: '20260924120000' })
            assert.equal(sum.ai.health.counts['rest:s1'].truncated, 1, '執行摘要 run.json 帶出(巡檢讀此)')
            assert.match(ai.drainStats(), /成交 rest:s1#0×1.*截斷放行 rest:s1×1/)
        })

        it('S0(JSON 完整、截在其後說明):成功全收 3 項、truncated:true', async () => {
            const ai = mkAdapter()
            const r = await ai.callJson('萃取', check, { spec: { use: 'rest:s0' } })
            assert.equal(r.ok, true)
            assert.equal(r.data.length, 3)
            assert.equal(r.truncated, true)
        })

        it('S2(0 項完整):失敗 rejected by validate;content_filter 與可見輸出為空者一律失敗;完整成功不帶 truncated', async () => {
            const ai = mkAdapter()
            const r2 = await ai.callJson('萃取', check, { spec: { use: 'rest:s2' } })
            assert.equal(r2.ok, false)
            assert.match(r2.error, /INCOMPLETE_RESPONSE: finish_reason=length; rejected by validate/)
            const rc = await ai.callJson('萃取', check, { spec: { use: 'rest:cf' } })
            assert.equal(rc.ok, false)
            assert.match(rc.error, /finish_reason=content_filter/)
            const re = await ai.callJson('萃取', check, { spec: { use: 'rest:empty' } })
            assert.equal(re.ok, false)
            assert.match(re.error, /no visible output.*reasoning_tokens=600/)
            const ro = await ai.callJson('萃取', check, { spec: { use: 'rest:ok' } })
            assert.equal(ro.ok, true)
            assert.equal('truncated' in ro, false, '成功形狀只在截斷放行時增欄位')
            assert.equal(ai.health.snapshot().counts['rest:ok'].truncated, 0)
        })

        it('經 runAiBatchStage:S1 → 套用 2 項、1 項交 onMissed、failedBatches 0(部分接受)', async () => {
            const ai = mkAdapter()
            const applied = []
            const missed = []
            const infos = []
            const warns = []
            let served = false
            const stat = await runAiBatchStage({
                pickPool: async () => {
                    if (served) return []
                    served = true
                    return [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
                },
                batchSize: 3,
                parallel: 1,
                rounds: 2,
                buildPrompt: async (batch) => `萃取 ${batch.length} 項`,
                callAI: (p, ck) => ai.callJson(p, ck, { spec: { use: 'rest:s1' } }),
                checkResult: (d, batch) => Array.isArray(d) && d.some((it) => isValid(it, batch)),
                isValidItem: isValid,
                indexOf: (it) => it.index,
                applyItem: async (it, target) => {
                    applied.push(target.id)
                    return { applied: 1 }
                },
                onMissed: async (t) => {
                    missed.push(t.id)
                },
                log: { info: (m) => infos.push(m), warn: (m) => warns.push(m) },
            })
            assert.deepEqual(applied, ['a', 'b'])
            assert.deepEqual(missed, ['c'])
            assert.deepEqual([stat.failedBatches, stat.aiAttempts, stat.missed], [0, 1, 1])
            assert.deepEqual(warns, [])
            assert.ok(infos.some((m) => /3 項中 2 項完整、1 項未涵蓋/.test(m)))
        })
    })

    // ── R05:錯誤歷程與實際嘗試次數(B2)──
    describe('R05 失敗可歸因(errors／attempts)', function() {

        it('兩把皆 401:attempts 2(非上游之內部次數 1);errors 依序列「金鑰:型別(秒)」', async () => {
            const ai = mkAdapter()
            const r = await ai.callJson('萃取', check, { spec: { use: 'rest:dead2' } })
            assert.equal(r.ok, false)
            assert.equal(r.error, 'HTTP 401')
            assert.equal(r.skipped, false)
            assert.equal(r.attempts, 2)
            assert.equal(r.errors.length, 2)
            assert.match(r.errors[0], /^rest:dead2#0:http\(\d+\.\ds\)$/)
            assert.match(r.errors[1], /^rest:dead2#1:http\(\d+\.\ds\)$/)
        })

        it('組內預算用盡:未送出之 budget-out 不計入 attempts,於 errors 以 outcome 列出且不附耗時', async () => {
            const ai = mkAdapter()
            const r = await ai.callJson('萃取', check, { spec: { use: 'rest:slow' }, budgetMs: 20_500 })
            assert.equal(r.ok, false)
            assert.equal(r.skipped, true, 'budget 屬額度/預算耗盡')
            assert.equal(r.attempts, 1)
            assert.equal(r.errors.length, 2)
            assert.match(r.errors[0], /^rest:slow#0:http\(1\.\ds\)$/, '慢速失敗之耗時可辨')
            assert.equal(r.errors[1], 'rest:slow#1:budget-out')
            assert.equal(hits.length, 1, '第二把未送出')
        })

        it('aiBatchStage 失敗 WARN:前綴不變(巡檢白名單)並附「；歷程」', async () => {
            const ai = mkAdapter()
            const warns = []
            let served = false
            const stat = await runAiBatchStage({
                pickPool: async () => {
                    if (served) return []
                    served = true
                    return [{ id: 'a' }]
                },
                batchSize: 1,
                parallel: 1,
                rounds: 1,
                buildPrompt: async () => '萃取',
                callAI: (p, ck) => ai.callJson(p, ck, { spec: { use: 'rest:dead2' } }),
                checkResult: () => true,
                isValidItem: isValid,
                indexOf: (it) => it.index,
                applyItem: async () => ({}),
                onMissed: async () => {},
                log: { info: () => {}, warn: (m) => warns.push(m) },
            })
            assert.equal(warns.length, 1)
            assert.match(warns[0], /^批次 AI 失敗（HTTP 401，試 2 次；歷程 rest:dead2#0:http\(\d+\.\ds\)、rest:dead2#1:http\(\d+\.\ds\)）→ $/)
            assert.deepEqual([stat.failedBatches, stat.aiAttempts], [1, 2], 'aiAttempts 與實際嘗試同義')
        })
    })

    // ── R06:原始呼叫器之截斷放行透傳(C1)──
    describe('R06 createAiCaller 之 acceptTruncated', function() {

        const salvageValidate = (s) => {
            const j = extractJsonLoose(s) ?? salvageTruncatedArray(s)
            return Array.isArray(j) && j.length > 0
        }

        it('給 true → 截斷內容交 validate 放行並標 truncated;未給或非布林值 → 依上游預設判 incomplete;logAiOutcome 加註截斷放行', async () => {
            const caller = createAiCaller({ pick: ['rest:s1'], env: ENV, extraProviders: ENTRIES, providerTimeouts: { 'rest:s1': 60_000 } })
            const r = await caller.callAI('萃取', { acceptTruncated: true, validate: salvageValidate })
            assert.equal(r.ok, true)
            assert.equal(r.truncated, true)
            assert.equal(r.finishReason, 'length')
            for (const o of [{}, { acceptTruncated: 'yes' }]) {
                const rf = await caller.callAI('萃取', { ...o, validate: salvageValidate })
                assert.equal(rf.ok, false, JSON.stringify(o))
                assert.equal(rf.errorType, 'incomplete')
            }
            const lines = []
            const lg = { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) }
            logAiOutcome({ result: r, log: lg })
            assert.ok(lines[0].startsWith('使用 AI rest:s1／key#1（'), lines[0])
            assert.ok(lines[0].includes('；截斷內容放行（finish_reason=length）'), lines[0])
            const caller2 = createAiCaller({ pick: ['rest:ok'], env: ENV, extraProviders: ENTRIES, providerTimeouts: { 'rest:ok': 60_000 } })
            const ro = await caller2.callAI('萃取', { validate: salvageValidate })
            lines.length = 0
            logAiOutcome({ result: ro, log: lg })
            assert.equal(lines.length, 1)
            assert.ok(!lines[0].includes('截斷內容放行'), '完整成功不加註')
        })
    })

    // ── R07:條目自帶 validate 與本層驗證取交集(D1)──
    describe('R07 條目 validate 取交集', function() {

        it('條目帶 nonempty、回非 JSON → 驗證失敗(可遞補),不再 ok:true／data:null;兩者皆過 → 成功', async () => {
            const ai = mkAdapter()
            const r = await ai.callJson('萃取', check, { spec: { use: 'rest:plainv' } })
            assert.equal(r.ok, false)
            assert.equal(r.error, 'OUTPUT_VALIDATION_FAILED')
            assert.match(r.errors[0], /^rest:plainv#0:validation\(/)
            const rf = await ai.callJson('萃取', check, { spec: { use: 'rest:plainv', fallback: ['rest:ok'] } })
            assert.equal(rf.ok, true, '驗證失敗交遞補')
            assert.equal(rf.data.length, 3)
            const rv = await ai.callJson('萃取', check, { spec: { use: 'rest:okv' } })
            assert.equal(rv.ok, true)
            assert.equal(rv.data.length, 3)
        })

        it('對照:同一條目直接交 dispatchAiFallback(未取交集)時條目 validate 覆寫共用 validate → 非 JSON 被放行(此即修正前之機制)', async () => {
            const ai = mkAdapter()
            const entry = ai.chainFor({ use: 'rest:plainv' })[0]
            assert.equal(entry.validate, 'nonempty')
            const strict = (s) => {
                try {
                    return Array.isArray(JSON.parse(s))
                }
                catch {
                    return false
                }
            }
            const r0 = await dispatchAiFallback('萃取', { providers: [entry], validate: strict })
            assert.equal(r0.ok, true)
        })
    })

    // ── R08:冷卻偵測不掃內容型失敗(D2)──
    describe('R08 預設冷卻偵測', function() {

        it('內容型失敗之回覆含 rate limit／quota exceeded 字樣 → 不冷卻;對照組(舊式全掃)同一回應即冷卻', async () => {
            const ai = mkAdapter()
            const r = await ai.callJson('萃取', check, { spec: { use: 'rest:ratetext' } })
            assert.equal(r.ok, false)
            assert.equal(r.error, 'OUTPUT_VALIDATION_FAILED')
            assert.equal(ai.store.get().cooling?.['rest:ratetext'], undefined, '文章談限流不是限流')
            const old = mkAdapter({ coolDetect: (x) => /rate.?limit|quota exceeded/i.test(`${x?.stderr || ''} ${x?.stdout || ''}`) })
            await old.callJson('萃取', check, { spec: { use: 'rest:ratetext' } })
            assert.ok(Number.isFinite(old.store.get().cooling?.['rest:ratetext']), '對照組證明本情境確實命中字樣')
        })

        it('執行層失敗(HTTP 503 本體含 rate limit)→ 仍冷卻(由冷卻偵測觸發,非健康層)', async () => {
            const ai = mkAdapter()
            const r = await ai.callJson('萃取', check, { spec: { use: 'rest:rl503' } })
            assert.equal(r.ok, false)
            assert.equal(r.error, 'HTTP 503')
            assert.ok(Number.isFinite(ai.store.get().cooling?.['rest:rl503']))
            assert.equal(ai.health.snapshot().counts['rest:rl503'].cooled, 0, '健康層未達門檻(1 < 2)')
        })
    })

    // ── R11:使用者裁示 (a)——提煉工作流維持現況 ──
    describe('R11 提煉工作流 callAi(只給 check)遇截斷仍換家', function() {

        it('S1／S0 → 整組跳過(incomplete)由遞補成交;無遞補則失敗', async () => {
            const ai = mkAdapter()
            const wkf = ai.getWkf()
            for (const use of ['rest:s1', 'rest:s0']) {
                const r = await wkf.callAi('提煉', { spec: { use, fallback: ['rest:ok'] }, check })
                assert.equal(r.ok, true, use)
                assert.equal(r.providerId, 'rest:ok', `${use} 多一次遞補(裁示維持)`)
                assert.equal(r.tried[0].outcome, 'skip-group')
                assert.equal(r.tried[0].errorType, 'incomplete')
            }
            const r2 = await wkf.callAi('提煉', { spec: { use: 'rest:s0' }, check })
            assert.equal(r2.ok, false)
            assert.equal(r2.errorType, 'incomplete')
        })
    })

    // ── R04:整組金鑰皆敗之接線(真實 dispatchAiFallback 事件流)──
    describe('R04 多金鑰條目之健康判定(真實事件流)', function() {

        it('金鑰字串「deadA, deadB,」展開為 2 把;兩把皆死 × healthStreak(2) → 寫入 cooling、onHealth 帶 keys:2', async () => {
            const seen = []
            const ai = mkAdapter({ onHealth: (ev) => seen.push(ev) })
            assert.deepEqual(ai.chainFor({ use: 'rest:dead2' })[0].keys, ['deadA', 'deadB'])
            await ai.callJson('萃取', check, { spec: { use: 'rest:dead2' } })
            assert.equal(ai.store.get().cooling?.['rest:dead2'], undefined, '第一次整組皆敗:streak 1')
            await ai.callJson('萃取', check, { spec: { use: 'rest:dead2' } })
            assert.ok(Number.isFinite(ai.store.get().cooling?.['rest:dead2']), '第二次達門檻')
            assert.equal(seen.length, 1)
            assert.deepEqual([seen[0].providerId, seen[0].streak, seen[0].errorType, seen[0].keys], ['rest:dead2', 2, 'http', 2])
        })

        it('一死一活、6 個並行呼叫(皆自死金鑰起跑):全數成交,不得冷卻', async () => {
            const ai = mkAdapter()
            const rs = await Promise.all(Array.from({ length: 6 }, () => ai.callJson('萃取', check, { spec: { use: 'rest:half' } })))
            assert.ok(rs.every((r) => r.ok), '6 個呼叫全數成交')
            assert.equal(hits.filter((h) => h.key === 'deadX').length, 6, '並行呼叫皆自游標 0(死金鑰)起跑')
            const c = ai.health.snapshot().counts['rest:half']
            assert.deepEqual([c.ok, c.fail.http, c.cooled], [6, 6, 0])
            assert.equal(ai.store.get().cooling?.['rest:half'], undefined)
            assert.ok(rs.every((r) => r.attempts === 2))
        })

        it('並行呼叫跨越一次成交(四情境):每次呼叫試完仍無成交恰計一次——控制組 2、多計情境 2、少計情境 1、預算用盡情境 0', async () => {
            // 此前以金鑰數＋逐把失敗次數之最小值重建,在後三情境得 3、0、1(2026-09-24 以真實 dispatchAiFallback 重現);
            // w-dispatch-ai 1.0.39 起由上游於組試完時發 group-exhausted,健康層按事件計即精確
            const streakOf = async (run) => {
                const ai = mkAdapter({}, { healthStreak: 99 }) // 門檻調高:只觀察計數,不觸發冷卻
                await run((tag, extra = {}) => ai.callJson(`[[${tag}]] 萃取`, check, { spec: { use: 'rest:plan' }, ...extra }))
                return ai.health.snapshot().streak['rest:plan']?.n ?? 0
            }
            const ctl = await streakOf(async (call) => {
                await call('C1'); await call('C2')
            })
            const over = await streakOf(async (call) => {
                await Promise.all([call('X'), call('Y')]); await call('Z')
            })
            const under = await streakOf(async (call) => {
                await Promise.all([call('X3'), call('Y3')])
            })
            const overb = await streakOf(async (call) => {
                const b = { budgetMs: 20_500 }
                await Promise.all([call('X4', b), call('Y4', b)]); await call('Z4', b)
            })
            assert.deepEqual([ctl, over, under, overb], [2, 2, 1, 0])
        })

        it('無金鑰與單把金鑰之條目:每次呼叫一個組盡事件計一次,達門檻冷卻;onHealth 不附 keys(不是「每次 N 把金鑰皆敗」)', async () => {
            const seen = []
            const ai = mkAdapter({ onHealth: (ev) => seen.push(ev) })
            assert.equal(ai.chainFor({ use: 'rest:nokey' })[0].keys, undefined, '無金鑰條目')
            assert.deepEqual(ai.chainFor({ use: 'rest:plainv' })[0].keys, ['k1'], '單把金鑰條目')
            for (const use of ['rest:nokey', 'rest:plainv']) {
                for (let i = 0; i < 2; i++) {
                    const r = await ai.callJson('萃取', check, { spec: { use } })
                    assert.equal(r.error, 'OUTPUT_VALIDATION_FAILED')
                }
                assert.ok(Number.isFinite(ai.store.get().cooling?.[use]), `${use}:兩次呼叫各計一次 → 達門檻冷卻`)
            }
            assert.deepEqual(seen.map((e) => [e.providerId, e.streak, e.errorType, 'keys' in e]), [['rest:nokey', 2, 'validation', false], ['rest:plainv', 2, 'validation', false]])
        })
    })
})
