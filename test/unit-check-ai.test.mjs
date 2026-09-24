// unit-check-ai.test.mjs — src/ai/{adapter,caller,capability,logAiOutcome,parsers,providerHealth,resolve}.mjs 之型別檢查
// 執行:npx mocha test/unit-check-ai.test.mjs(不呼叫任何真實 AI、不連網:只測檢查路徑與純函數)
//
// 【adapter／caller 之「有效輸入」案例如何避免真實派工】callJson／callAI 之有效輸入案例會繼續往下執行到
//   dispatchAiFallback 才會真正 spawn CLI 供應商——本檔以兩種既有機制讓它在抵達那一步之前就安全短路:
//   ①callJson:以 ai.providerLimits 把唯一供應商之 prompt 上限壓到 1 字元,任何非空 prompt 皆會被既有
//     fitChain 剔除而提早回傳(ai/capability.mjs 既有邏輯,非本次新增);②callAI:以 pick 指向一個不存在的
//     供應商 id,令 providers 為空陣列,命中既有的「無可用供應商」早退分支。經 tasklist／Get-CimInstance
//     實測驗證,兩種手法皆不會啟動任何 claude/codex/agy/opencode 子行程。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createAiAdapter } from '../src/ai/adapter.mjs'
import { createAiCaller } from '../src/ai/caller.mjs'
import { fitChain } from '../src/ai/capability.mjs'
import { logAiOutcome, createAiEventLogger } from '../src/ai/logAiOutcome.mjs'
import { parseIndexList, makeArrayCoverageValidator } from '../src/ai/parsers.mjs'
import { createProviderHealth } from '../src/ai/providerHealth.mjs'
import { mergeCatalogue, timeoutPatch, resolveCatalogue } from '../src/ai/resolve.mjs'
import { createClock } from '../src/util/clock.mjs'
import { nullLogger } from './tools/nullLogger.mjs'

const TMP = path.resolve(`test/_tmp/check-ai-${process.pid}`).replace(/\\/g, '/') // cwd 相對;帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除

describe('unit-check-ai', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        fs.writeFileSync(`${TMP}/.env`, '', 'utf8') // 空 .env:envFile 存在即可,不含任何金鑰
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── adapter.mjs:createAiAdapter ──
    describe('adapter.createAiAdapter', function() {

        it('opt 非物件 → 視為 {} 後由既有必填檢查拋錯(訊息含 envFile 或 env,不可改)', () => {
            for (const bad of [null, 42, 'x', [], true, undefined]) {
                assert.throws(() => createAiAdapter(bad), /envFile 或 env/)
            }
        })

        it('opt 為有效物件時正常建構,回傳完整方法集(有效輸入行為不變)', () => {
            const ai = createAiAdapter({
                ai: { providerPick: ['claude:sonnet'], providerTimeouts: {}, cooldownMs: 1000, maxRetries: 0 },
                envFile: `${TMP}/.env`,
                stateDir: TMP,
                workspace: TMP,
                clock: createClock('Asia/Taipei'),
            })
            assert.equal(typeof ai.callJson, 'function')
            assert.equal(typeof ai.withBudget, 'function')
            assert.equal(typeof ai.chainFor, 'function')
            assert.equal(typeof ai.validateSeats, 'function')
        })
    })

    // ── adapter.mjs:callJson 之 prompt／check／callOpt 檢查 ──
    describe('adapter：callJson 之 prompt／check／callOpt 檢查', function() {

        // 見檔頭:以 providerLimits 把唯一供應商之上限壓到 1 字元,任何非空 prompt 必在 dispatchAiFallback 之前被剔除
        const mkAi = () => createAiAdapter({
            ai: { providerPick: ['claude:sonnet'], providerLimits: { 'claude:sonnet': 1 }, providerTimeouts: {}, cooldownMs: 1000, maxRetries: 0 },
            envFile: `${TMP}/.env`,
            stateDir: TMP,
            workspace: TMP,
            clock: createClock('Asia/Taipei'),
        })

        it('prompt 非字串 → 回傳失敗形狀(不拋錯),attempts:0、errors 為空陣列(失敗形狀一律帶 errors,2026-09-24 起)', async () => {
            const ai = mkAi()
            const r = await ai.callJson(123, () => true)
            assert.deepEqual(r, { ok: false, data: null, error: 'callJson 需要 prompt（字串）與 check（函數）', skipped: false, attempts: 0, preview: '', errors: [] })
        })

        it('check 非函數 → 回傳失敗形狀(不拋錯)', async () => {
            const ai = mkAi()
            const r = await ai.callJson('hello', 'not-a-function')
            assert.equal(r.ok, false)
            assert.equal(r.error, 'callJson 需要 prompt（字串）與 check（函數）')
        })

        it('prompt／check 皆有效時,callOpt 省略／null／物件三者行為一致(callOpt 非物件已回退為 {})', async () => {
            const ai = mkAi()
            const rOmitted = await ai.callJson('hello world', () => true)
            const rNull = await ai.callJson('hello world', () => true, null)
            const rSpec = await ai.callJson('hello world', () => true, { spec: { use: 'claude:sonnet', fallback: [] } })
            for (const r of [rOmitted, rNull, rSpec]) {
                assert.equal(r.ok, false)
                // 通過型別檢查後,命中既有(非本次新增)之 oversize 短路邏輯,而非型別錯誤訊息——證明有效輸入未被本次檢查攔下
                assert.match(r.error, /claude:sonnet≤1/)
                assert.doesNotMatch(r.error, /callJson 需要 prompt/)
                assert.deepEqual([r.attempts, r.errors], [0, []], '全數逾長未送出:無嘗試、無失敗歷程(失敗形狀一律帶 errors)')
            }
            assert.deepEqual(rOmitted, rNull, 'callOpt 省略與 null 須產生相同結果,證明 null 已正確回退為 {}')
        })
    })

    // ── adapter.mjs:withBudget 之 seat 檢查 ──
    describe('adapter：withBudget 之 seat 檢查', function() {

        const mkAi = () => createAiAdapter({
            ai: { providerPick: ['claude:sonnet'], providerTimeouts: { 'claude:sonnet': 3000 }, cooldownMs: 1000, maxRetries: 0 },
            envFile: `${TMP}/.env`,
            stateDir: TMP,
            workspace: TMP,
            clock: createClock('Asia/Taipei'),
        })

        it('seat 非物件 → 拋錯', () => {
            const ai = mkAi()
            assert.throws(() => ai.withBudget(null), /withBudget 需要席位物件 \{ use, fallback \}/)
            assert.throws(() => ai.withBudget('bad'), /withBudget 需要席位物件/)
        })

        it('seat 為有效物件時行為不變:已給 budgetMs 原樣回傳,未給則補鏈 timeout 總和', () => {
            const ai = mkAi()
            assert.deepEqual(ai.withBudget({ use: 'x', fallback: [], budgetMs: 999 }), { use: 'x', fallback: [], budgetMs: 999 })
            const seat = ai.withBudget({ use: 'claude:sonnet', fallback: [] })
            assert.equal(seat.budgetMs, 3000)
        })
    })

    // ── caller.mjs:createAiCaller／callAI ──
    describe('caller.createAiCaller／callAI', function() {

        it('createAiCaller：opt 非物件 → {},仍正常建構(不拋錯)', () => {
            for (const bad of [null, 42, 'x', true]) {
                const c = createAiCaller(bad)
                assert.equal(typeof c.callAI, 'function')
                assert.ok(Array.isArray(c.providers))
            }
        })

        it('callAI：o 非物件 → {},與省略／undefined 行為一致(以不存在的 pick id 確保零供應商,不觸及真實派工)', async () => {
            const c = createAiCaller({ pick: ['definitely-nonexistent-id-xyz-12345'] })
            assert.equal(c.providers.length, 0, '前提:零供應商,callAI 必走既有安全早退路徑')
            const rOmitted = await c.callAI('hello')
            const rNull = await c.callAI('hello', null)
            const rBad = await c.callAI('hello', 'not-an-object')
            for (const r of [rOmitted, rNull, rBad]) {
                assert.equal(r.ok, false)
                assert.match(r.error, /無可用的 AI 供應商/)
                assert.deepEqual(r.providersMissing, ['definitely-nonexistent-id-xyz-12345'])
            }
        })
    })

    // ── capability.mjs:fitChain ──
    describe('capability.fitChain', function() {

        it('promptLen 非有限數值 → 視為 0,全數保留(kept=全部,dropped=空)', () => {
            const chain = [{ id: 'agy:g', kind: 'antigravity' }, { id: 'claude:sonnet', kind: 'claude' }]
            for (const bad of [NaN, undefined, null, 'abc', {}, Infinity, -Infinity]) {
                const r = fitChain(chain, bad)
                assert.deepEqual(r.dropped, [])
                assert.equal(r.kept.length, chain.length)
            }
        })

        it('promptLen 為有效有限數值時行為不變(既有語意)', () => {
            const chain = [{ id: 'agy:g', kind: 'antigravity' }, { id: 'claude:sonnet', kind: 'claude' }]
            const r = fitChain(chain, 30_001)
            assert.deepEqual(r.kept.map((x) => x.id), ['claude:sonnet'])
            assert.deepEqual(r.dropped, [{ id: 'agy:g', limit: 30_000 }])
        })
    })

    // ── logAiOutcome.mjs:logAiOutcome／createAiEventLogger ──
    describe('logAiOutcome／createAiEventLogger', function() {

        it('logAiOutcome：opt 非物件或 log 缺／非物件 → 拋錯', () => {
            assert.throws(() => logAiOutcome({}), /logAiOutcome 需要 log（記錄器）/)
            assert.throws(() => logAiOutcome({ log: 'not-an-object' }), /logAiOutcome 需要 log（記錄器）/)
            assert.throws(() => logAiOutcome(null), /logAiOutcome 需要 log（記錄器）/) // opt 非物件先回退 {},仍缺 log
        })

        it('logAiOutcome：log 為有效記錄器時正常記錄,以成員呼叫形式觸發(不破壞 class-based logger 之 this 綁定)', () => {
            const calls = []
            class FakeLogger { // 模擬 winston/pino 一類 class-based logger,方法內用 this
                constructor() {
                    this.prefix = '[fake]'
                }

                log(m) {
                    calls.push(this.prefix + m)
                }

                logWarn(m) {
                    calls.push(this.prefix + 'WARN:' + m)
                }

                logError(m) {
                    calls.push(this.prefix + 'ERROR:' + m)
                }
            }
            const lg = new FakeLogger()
            logAiOutcome({ result: { providerId: 'p', kind: 'claude', model: 'sonnet' }, log: lg })
            assert.equal(calls.length, 1)
            assert.match(calls[0], /^\[fake\]使用 AI p/)
        })

        it('createAiEventLogger：opt 非物件或 log 缺／非物件 → 拋錯;有效 log 時回傳可用之事件回調', () => {
            assert.throws(() => createAiEventLogger({}), /createAiEventLogger 需要 log（記錄器）/)
            assert.throws(() => createAiEventLogger(null), /createAiEventLogger 需要 log（記錄器）/)
            const fn = createAiEventLogger({ log: nullLogger() })
            assert.equal(typeof fn, 'function')
            assert.doesNotThrow(() => fn({ type: 'cooled', providerId: 'p', cooldownMs: 60000, error: 'x' }))
        })
    })

    // ── parsers.mjs ──
    describe('parsers', function() {

        it('parseIndexList：opt 非物件 → {}(套用預設 max/min/topN),有效輸入行為不變', () => {
            assert.deepEqual(parseIndexList('3,4,5', 'bad'), { isZero: false, indices: [3, 4, 5] })
            assert.deepEqual(parseIndexList('3,4,5', { max: 4 }), { isZero: false, indices: [3, 4] })
        })

        it('makeArrayCoverageValidator：indices 給了但非陣列 → 拋 TypeError(不可靜默改空陣列,否則驗證器形同放行)', () => {
            assert.throws(() => makeArrayCoverageValidator({ indices: 'bad' }), TypeError)
            assert.throws(() => makeArrayCoverageValidator({ indices: 'bad' }), /makeArrayCoverageValidator 之 indices 須為陣列/)
        })

        it('makeArrayCoverageValidator：indices 省略時預設空陣列,不拋錯', () => {
            const v = makeArrayCoverageValidator({})
            assert.equal(v('[]'), true)
        })

        it('makeArrayCoverageValidator：opt 非物件 → {};contentFields 非陣列 → [];maxLengths 非物件 → {}(不拋錯)', () => {
            const v = makeArrayCoverageValidator(null)
            assert.equal(v('[]'), true)
            const v2 = makeArrayCoverageValidator({ indices: [1], contentFields: 'bad', maxLengths: 'bad' })
            assert.equal(v2('[{"index":1}]'), true)
        })

        it('makeArrayCoverageValidator：onReject 非函數 → 不回報(不拋錯),仍正確回傳驗證結果', () => {
            const v = makeArrayCoverageValidator({ indices: [1, 2], onReject: 'not-a-function' })
            assert.equal(v('[{"index":1}]'), false) // 缺 2,不合格但不因 onReject 非函數而拋錯
        })

        it('makeArrayCoverageValidator：有效輸入行為不變(涵蓋齊全→true,單項超長→false)', () => {
            const v = makeArrayCoverageValidator({ indices: [1, 2], maxLengths: { short: 3 } })
            assert.equal(v('[{"index":1,"short":"ab"},{"index":2,"short":"cd"}]'), true)
            assert.equal(v('[{"index":1,"short":"abcd"},{"index":2,"short":"cd"}]'), false)
        })
    })

    // ── providerHealth.mjs:createProviderHealth ──
    describe('providerHealth.createProviderHealth', function() {

        it('opt 非物件 → {},仍以預設值正常建構(不拋錯)', () => {
            for (const bad of [null, 42, 'x', true]) {
                const h = createProviderHealth(bad)
                assert.equal(h.threshold, 3)
                assert.equal(h.windowMs, 900_000)
                assert.equal(typeof h.onEvent, 'function')
            }
        })

        it('opt 為有效物件時行為不變(自訂 threshold／windowMs 生效)', () => {
            const h = createProviderHealth({ threshold: 5, windowMs: 1234 })
            assert.equal(h.threshold, 5)
            assert.equal(h.windowMs, 1234)
        })
    })

    // ── resolve.mjs ──
    describe('resolve', function() {

        it('mergeCatalogue：extraProviders 為 undefined／null → 視為 []', () => {
            const base = [{ id: 'a' }, { id: 'b' }]
            assert.deepEqual(mergeCatalogue(base, undefined), base)
            assert.deepEqual(mergeCatalogue(base, null), base)
        })

        it('mergeCatalogue：extraProviders 給了但非陣列 → 拋錯;既有「缺少 id」訊息不變', () => {
            assert.throws(() => mergeCatalogue([], 'bad'), /ai\.extraProviders 須為陣列/)
            assert.throws(() => mergeCatalogue([], [{ noId: true }]), /ai\.extraProviders 之條目缺少 id/)
        })

        it('mergeCatalogue：有效輸入行為不變(同 id 覆蓋、新 id 追加)', () => {
            const base = [{ id: 'a', v: 1 }]
            const merged = mergeCatalogue(base, [{ id: 'a', v: 2 }, { id: 'b', v: 3 }])
            assert.deepEqual(merged, [{ id: 'a', v: 2 }, { id: 'b', v: 3 }])
        })

        it('timeoutPatch：merged 非陣列 → 拋錯', () => {
            assert.throws(() => timeoutPatch('bad'), /timeoutPatch 需要 merged（條目陣列）/)
            assert.throws(() => timeoutPatch(null), /timeoutPatch 需要 merged（條目陣列）/)
        })

        it('timeoutPatch：opts 非物件 → {},仍正常運作(用條目自帶 timeoutMs)', () => {
            const p = timeoutPatch([{ id: 'x', timeoutMs: 100 }], 'bad')
            assert.deepEqual(p, { x: { timeoutMs: 100 } })
        })

        it('timeoutPatch：有效輸入行為不變(pick 過濾、逐 id 覆寫優先於條目自帶值)', () => {
            const merged = [{ id: 'a', timeoutMs: 100 }, { id: 'b', timeoutMs: 200 }]
            const p = timeoutPatch(merged, { pick: ['a'], providerTimeouts: { a: 999 } })
            assert.deepEqual(p, { a: { timeoutMs: 999 } })
        })

        it('resolveCatalogue：opt 非物件 → {},回傳形狀不變', () => {
            const r = resolveCatalogue(null)
            assert.ok(Array.isArray(r.merged))
            assert.ok(r.resolved)
            assert.ok(Array.isArray(r.resolved.providers))
        })
    })

})
