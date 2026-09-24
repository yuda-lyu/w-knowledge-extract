// unit-ai.test.mjs — AI 調度層:供應商健康(連續失敗即冷卻)、事件單一入口、時間預算封頂之契約
// 執行:npx mocha test/unit-ai.test.mjs(不發網路、不呼叫任何 AI;暫存落 test/_tmp/ai-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createProviderHealth } from '../src/ai/providerHealth.mjs'
import { createAiAdapter } from '../src/ai/adapter.mjs'
import { createClock } from '../src/util/clock.mjs'

const TMP = path.resolve(`test/_tmp/ai-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除

/** 記憶體 store(與 w-dispatch-ai createFileStore 同契約 {get,set}) */
const memStore = (init = {}) => {
    let st = { ...init }; return {
        get: () => JSON.parse(JSON.stringify(st)),
        set: (s) => {
            st = JSON.parse(JSON.stringify(s))
        },
        _raw: () => st
    }
}
// 事件形狀同 w-dispatch-ai ≥1.0.39 之 dispatchAiFallback:逐次失敗(next-key／skip-group)之後,該組試完仍無成交時另發 group-exhausted
const fail = (providerId, errorType, extra = {}) => ({ type: 'skip-group', providerId, keyIndex: null, keyId: providerId, error: `${errorType} err`, errorType, ...extra })
const exhausted = (providerId, errorTypes, extra = {}) => ({ type: 'group-exhausted', providerId, keyIndex: null, keyId: providerId, keys: 0, attempted: errorTypes.length, by: 'skip-group', errorTypes, error: `${errorTypes[errorTypes.length - 1]} err`, ...extra })
/** 無金鑰條目之一次呼叫以與金鑰無關之失敗收尾:上游依序發 skip-group 與 group-exhausted */
const failCall = (target, providerId, errorType, extra = {}) => {
    target.onEvent(fail(providerId, errorType, extra))
    target.onEvent(exhausted(providerId, [errorType], extra.error ? { error: extra.error } : {}))
}

describe('unit-ai', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── providerHealth ──
    it('連續 3 次呼叫失敗(每次一個組盡事件)→ 寫入套件 cooling 表(降序);成功即歸零;未達門檻不冷卻', () => {
        const store = memStore({ cursors: {}, cooling: {} })
        const cooled = []
        let t = 1_000_000
        const h = createProviderHealth({ store, threshold: 3, windowMs: 900_000, now: () => t, onCool: (ev) => cooled.push(ev) })
        failCall(h, 'g', 'validation')
        failCall(h, 'g', 'validation')
        assert.equal(store._raw().cooling.g, undefined, '兩次未達門檻不冷卻——單次驗證失敗是常態')
        h.onEvent({ type: 'ok', providerId: 'g', keyIndex: null, keyId: 'g', durationMs: 1 })
        failCall(h, 'g', 'validation')
        failCall(h, 'g', 'validation')
        assert.equal(store._raw().cooling.g, undefined, '成功歸零後重新計數')
        failCall(h, 'g', 'exec')
        assert.equal(store._raw().cooling.g, t, '第 3 次(混合 validation/exec)即寫入 cooling')
        assert.equal(cooled.length, 1)
        assert.equal(cooled[0].providerId, 'g')
        assert.equal(cooled[0].streak, 3)
        assert.equal(cooled[0].errorType, 'exec')
        // 冷卻中再失敗:重新斷言但不重複回呼(套件各呼叫整份寫回 state 可能蓋掉本層寫入,故每次失敗再寫)
        store.set({ cursors: {}, cooling: {} }) // 模擬被套件的 saveState 蓋掉
        failCall(h, 'g', 'validation')
        assert.equal(store._raw().cooling.g, t, '被蓋掉後於下一次失敗重新斷言')
        assert.equal(cooled.length, 1, '同一段 streak 只回呼一次')
        const s = h.snapshot()
        assert.equal(s.counts.g.cooled, 1)
        assert.equal(s.counts.g.fail.validation, 5, '失敗型別次數由逐次失敗事件計(組盡事件不重複記)')
        assert.equal(s.counts.g.ok, 1)
    })

    it('params(席位與能力不相容,如 agy prompt 過長)不計 streak,另計 mismatch 並進摘要', () => {
        const store = memStore({ cooling: {} })
        const h = createProviderHealth({ store, threshold: 2 })
        for (let i = 0; i < 6; i++) failCall(h, 'agy', 'params', { error: 'prompt too long (41000 chars > 30000)' })
        assert.equal(store._raw().cooling.agy, undefined, 'params 不冷卻:冷卻改善不了設定不相容,反而讓它在可用的席位也被降序')
        assert.equal(h.snapshot().counts.agy.mismatch, 6)
        assert.equal(h.snapshot().streak.agy, undefined)
        assert.match(h.summary(), /席位不相容 agy\(params\)×6/)
        assert.doesNotMatch(h.summary(), /健康降序/)
    })

    it('逐次失敗(next-key／skip-group)只記失敗次數、不動 streak;連續失敗以組盡事件計,無金鑰／單把／多把同一規則', () => {
        const store = memStore({ cooling: {} })
        const h = createProviderHealth({ store, threshold: 2 })
        for (let i = 0; i < 4; i++) h.onEvent({ type: 'next-key', providerId: 'agnes', keyIndex: i % 2, keyId: `agnes#${i % 2}`, errorType: 'http', error: 'quota' })
        for (let i = 0; i < 3; i++) h.onEvent(fail('agnes', 'validation'))
        assert.equal(h.snapshot().streak.agnes, undefined, '沒有組盡事件就不計:一把失敗而他把成交之呼叫,上游不發組盡事件')
        assert.deepEqual(h.snapshot().counts.agnes.fail, { http: 4, validation: 3 })
        assert.equal(store._raw().cooling.agnes, undefined)
        for (const keys of [0, 1, 3]) {
            const pid = `k${keys}`
            for (let i = 0; i < 2; i++) h.onEvent(exhausted(pid, Array(Math.max(1, keys)).fill('exec'), { keys, by: 'all-keys' }))
            assert.ok(Number.isFinite(store._raw().cooling[pid]), `keys ${keys}:每收到一次組盡事件計一次(2026-09-09 08:00 agy exec×16 之風暴屬 keys 0)`)
        }
    })

    // ── providerHealth:計入型別為排除清單、連續失敗以上游組盡事件(group-exhausted,w-dispatch-ai 1.0.39)計 ──
    describe('providerHealth:排除清單與組盡事件', function() {

        const nk = (providerId, keyIndex, errorType = 'http', extra = {}) => ({ type: 'next-key', providerId, keyIndex, keyId: `${providerId}#${keyIndex}`, errorType, error: `${errorType} err`, ...extra })
        const ok = (providerId, keyIndex = 0) => ({ type: 'ok', providerId, keyIndex, keyId: `${providerId}#${keyIndex}`, durationMs: 1 })

        it('R03 排除清單:incomplete、tool-unsupported、invalid-response 與未知新型別皆計入;無金鑰 REST 之 fetch 計入;params 只記 mismatch;混合者以最後一個計入型別計;缺 errorTypes 者計為 exec', () => {
            const store = memStore({ cooling: {} })
            const h = createProviderHealth({ store, threshold: 2 })
            for (const t of ['incomplete', 'tool-unsupported', 'invalid-response', 'future-x']) {
                failCall(h, `p-${t}`, t)
                failCall(h, `p-${t}`, t)
                assert.ok(Number.isFinite(store._raw().cooling[`p-${t}`]), `${t} 連續 2 次須冷卻(白名單時代漏同步即靜默不計)`)
            }
            for (let i = 0; i < 2; i++) {
                h.onEvent({ type: 'next-key', providerId: 'rest-nokey', keyIndex: null, keyId: 'rest-nokey', errorType: 'fetch', error: 'FETCH_ERROR' })
                h.onEvent(exhausted('rest-nokey', ['fetch'], { by: 'all-keys' }))
            }
            assert.ok(Number.isFinite(store._raw().cooling['rest-nokey']), '無金鑰 REST 之網路層失敗計入')
            for (let i = 0; i < 4; i++) failCall(h, 'agy', 'params')
            assert.equal(store._raw().cooling.agy, undefined, 'params 不冷卻')
            assert.equal(h.snapshot().counts.agy.mismatch, 4)
            h.onEvent(exhausted('mix', ['http', 'params'], { keys: 2, by: 'all-keys' }))
            assert.deepEqual([h.snapshot().streak.mix.n, h.snapshot().streak.mix.lastType], [1, 'http'], '混合者計入,型別取最後一個計入型別')
            h.onEvent({ type: 'group-exhausted', providerId: 'none', keyIndex: null, keyId: 'none', keys: 0, attempted: 1, by: 'all-keys', error: 'x' })
            assert.equal(h.snapshot().streak.none.lastType, 'exec', '缺 errorTypes 者仍計入(計為 exec)')
        })

        it('R04 兩把皆敗:每次呼叫一個組盡事件計一次,達門檻冷卻;onCool 帶 keys 2', () => {
            const store = memStore({ cooling: {} })
            const cooled = []
            const h = createProviderHealth({ store, threshold: 2, onCool: (ev) => cooled.push(ev) })
            const call = () => {
                h.onEvent(nk('p', 0)); h.onEvent(nk('p', 1)); h.onEvent(exhausted('p', ['http', 'http'], { keys: 2, by: 'all-keys' }))
            }
            call()
            assert.equal(h.snapshot().streak.p.n, 1, '一次呼叫計 1(兩個換鑰失敗事件不重複計)')
            assert.equal(store._raw().cooling.p, undefined)
            call()
            assert.ok(Number.isFinite(store._raw().cooling.p), '第二次呼叫達門檻冷卻')
            assert.equal(cooled.length, 1)
            assert.deepEqual([cooled[0].keys, cooled[0].errorType, cooled[0].streak], [2, 'http', 2], '訊息可註明「每次 2 把金鑰皆敗」')
        })

        it('R04 一死一活並行(游標只在成功時推進,並行呼叫皆從死金鑰起跑):6 次換鑰失敗後 6 次成功,無組盡事件,不得冷卻', () => {
            const store = memStore({ cooling: {} })
            const h = createProviderHealth({ store, threshold: 2 })
            for (let i = 0; i < 6; i++) h.onEvent(nk('p', 0))
            for (let i = 0; i < 6; i++) h.onEvent(ok('p', 1))
            assert.equal(store._raw().cooling.p, undefined, '以失敗事件數計會把同一把死金鑰誤算成整組皆敗')
            assert.deepEqual([h.snapshot().counts.p.cooled, h.snapshot().counts.p.fail.http], [0, 6])
        })

        it('R04 組內預算用盡(後段金鑰從未被試):上游不發組盡事件,不得計入', () => {
            const store = memStore({ cooling: {} })
            const h = createProviderHealth({ store, threshold: 2 })
            for (let i = 0; i < 6; i++) {
                h.onEvent(nk('p', 0))
                h.onEvent({ type: 'budget-out', providerId: 'p', keyIndex: 1, keyId: 'p#1', remainingMs: 1 })
            }
            assert.equal(store._raw().cooling.p, undefined)
            assert.equal(h.snapshot().streak.p, undefined)
        })

        it('R04 不重複計:換鑰失敗後以整組跳過收尾之呼叫只計一次(整組跳過事件本身不計)', () => {
            const store = memStore({ cooling: {} })
            const h = createProviderHealth({ store, threshold: 10 })
            for (let i = 0; i < 3; i++) {
                h.onEvent(nk('p', 0, 'http'))
                h.onEvent({ type: 'skip-group', providerId: 'p', keyIndex: 1, keyId: 'p#1', errorType: 'timeout', error: 'TIMEOUT' })
                h.onEvent(exhausted('p', ['http', 'timeout'], { keys: 2, by: 'skip-group' }))
            }
            assert.equal(h.snapshot().streak.p.n, 3, '3 個呼叫各計一次')
            assert.deepEqual(h.snapshot().counts.p.fail, { http: 3, timeout: 3 })
        })

        it('R04 單把金鑰、首把即整組跳過亦每次計一次;onCool 之 keys 只在多金鑰且每把皆試過時附上;成功歸零後重新起算', () => {
            const store = memStore({ cooling: {} })
            const cooled = []
            const h = createProviderHealth({ store, threshold: 2, onCool: (ev) => cooled.push(ev) })
            for (let i = 0; i < 2; i++) h.onEvent(exhausted('one', ['http'], { keys: 1, by: 'all-keys' }))
            for (let i = 0; i < 2; i++) h.onEvent(exhausted('first', ['timeout'], { keys: 2, attempted: 1, by: 'skip-group' }))
            assert.ok(Number.isFinite(store._raw().cooling.one), '只有 1 把者每次呼叫皆敗即計')
            assert.ok(Number.isFinite(store._raw().cooling.first), '首把即整組跳過(與金鑰無關)亦計')
            assert.deepEqual(cooled.map((e) => [e.providerId, 'keys' in e]), [['one', false], ['first', false]], '後段金鑰未試者不可寫成「每次 N 把金鑰皆敗」')
            const h2 = createProviderHealth({ store: memStore({ cooling: {} }), threshold: 3 })
            h2.onEvent(exhausted('p', ['http', 'http'], { keys: 2, by: 'all-keys' }))
            h2.onEvent(ok('p', 1))
            h2.onEvent(exhausted('p', ['http', 'http'], { keys: 2, by: 'all-keys' }))
            assert.equal(h2.snapshot().streak.p.n, 1, '成功歸零後重新起算')
        })

        it('R04 上游已冷卻(窗內)時達門檻:只對齊時刻,不新冷卻、不回呼;全為 params 之組只記 mismatch', () => {
            let t = 5_000
            const store = memStore({ cooling: { p: 4_000 } })
            const cooled = []
            const h = createProviderHealth({ store, threshold: 2, windowMs: 900_000, now: () => t, onCool: (ev) => cooled.push(ev) })
            for (let i = 0; i < 2; i++) {
                h.onEvent(nk('p', 0, 'http')); h.onEvent(nk('p', 1, 'http')); h.onEvent(exhausted('p', ['http', 'http'], { keys: 2, by: 'all-keys' }))
            }
            assert.equal(store._raw().cooling.p, 4_000, '冷卻時戳不變')
            assert.deepEqual([h.snapshot().counts.p.cooled, cooled.length], [0, 0])
            for (let i = 0; i < 2; i++) {
                h.onEvent(nk('q', 0, 'params')); h.onEvent(nk('q', 1, 'params')); h.onEvent(exhausted('q', ['params', 'params'], { keys: 2, by: 'all-keys' }))
            }
            assert.equal(h.snapshot().counts.q.mismatch, 4)
            assert.equal(h.snapshot().streak.q, undefined)
        })

        it('R02 截斷放行另計:noteTruncated 進 counts 與摘要「截斷放行」', () => {
            const h = createProviderHealth({})
            h.noteTruncated('p'); h.noteTruncated('p')
            assert.equal(h.snapshot().counts.p.truncated, 2)
            assert.match(h.summary(), /截斷放行 p×2/)
        })

        it('R04 adapter 接線:組盡事件經 ai.onEvent 進健康層,達門檻 → 寫入 cooling、onHealth 帶 keys', () => {
            const envFile = `${TMP}/keys.env`
            fs.writeFileSync(envFile, 'PROBE_KEYS=ka,kb\n', 'utf8')
            const seen = []
            const ai = createAiAdapter({
                ai: {
                    providerPick: ['probe:two'],
                    extraProviders: [{ id: 'probe:two', model: 'probe', kind: 'api-openai-compat', envVar: 'PROBE_KEYS', baseURL: 'https://example.invalid/v1' }],
                    providerTimeouts: {},
                    cooldownMs: 900_000,
                    maxRetries: 0,
                    healthStreak: 2,
                },
                envFile,
                stateDir: `${TMP}/wire`,
                workspace: `${TMP}/wire`,
                clock: createClock('Asia/Taipei'),
                onHealth: (ev) => seen.push(ev),
            })
            for (let i = 0; i < 2; i++) {
                ai.onEvent(nk('probe:two', 0)); ai.onEvent(nk('probe:two', 1)); ai.onEvent(exhausted('probe:two', ['http', 'http'], { keys: 2, by: 'all-keys' }))
            }
            assert.ok(Number.isFinite(ai.store.get().cooling['probe:two']), '兩次呼叫皆整組皆敗 → 寫入套件 cooling 表')
            assert.equal(seen.length, 1)
            assert.equal(seen[0].keys, 2)
        })
    })

    it('冷卻中且未逾窗不重寫時間戳;逾窗後再達門檻才重寫', () => {
        const store = memStore({ cooling: {} })
        let t = 100
        const h = createProviderHealth({ store, threshold: 1, windowMs: 1000, now: () => t })
        failCall(h, 'p', 'validation')
        assert.equal(store._raw().cooling.p, 100)
        t = 500
        failCall(h, 'p', 'validation')
        assert.equal(store._raw().cooling.p, 100, '未逾窗不重寫(否則冷卻永不結束)')
        t = 1200
        failCall(h, 'p', 'validation')
        assert.equal(store._raw().cooling.p, 1200, '逾窗後重寫')
        assert.equal(h.snapshot().counts.p.cooled, 2)
    })

    it('無 store 時只統計不冷卻;非失敗事件(try/aborted/budget-out/cooled)與逐次失敗事件皆不影響 streak', () => {
        const h = createProviderHealth({ threshold: 1 })
        h.onEvent({ type: 'try', providerId: 'x' })
        h.onEvent({ type: 'aborted', providerId: 'x' })
        h.onEvent({ type: 'budget-out', providerId: 'x' })
        h.onEvent({ type: 'cooled', providerId: 'x' })
        h.onEvent(fail('x', 'validation'))
        assert.deepEqual(h.snapshot().streak, {})
        h.onEvent(exhausted('x', ['validation']))
        assert.equal(h.snapshot().streak.x.n, 1)
        assert.equal(h.snapshot().counts.x.cooled, 0, '無 store 不冷卻')
        assert.equal(h.summary(), '')
    })

    // ── adapter 接線(不呼叫 AI:只驗事件入口與摘要;providerPick 皆為 CLI 登入態條目,不需金鑰)──
    const mkAdapter = () => {
        const envFile = `${TMP}/.env`
        fs.writeFileSync(envFile, '', 'utf8')
        return createAiAdapter({
            ai: {
                providerPick: ['agy:gemini-3.8-flash-high', 'claude:sonnet'],
                providerTimeouts: { 'agy:gemini-3.8-flash-high': 1000, 'claude:sonnet': 2000 },
                cooldownMs: 900_000,
                maxRetries: 0,
                healthStreak: 2,
                extract: { executor: { use: 'agy:gemini-3.8-flash-high', fallback: ['claude:sonnet'] } },
            },
            envFile,
            stateDir: TMP,
            workspace: TMP,
            clock: createClock('Asia/Taipei'),
            onHealth: (ev) => healthEvents.push(ev),
        })
    }
    let healthEvents = []

    it('adapter：ai.onEvent 同時計帳與健康;連續失敗達 healthStreak 寫入 ai-cursor.json 之 cooling 並回呼 onHealth', () => {
        healthEvents = []
        const ai = mkAdapter()
        assert.equal(typeof ai.onEvent, 'function')
        assert.equal(typeof ai.health?.snapshot, 'function')
        ai.onEvent({ type: 'try', providerId: 'agy:gemini-3.8-flash-high', keyIndex: null, keyId: 'agy:gemini-3.8-flash-high' })
        failCall(ai, 'agy:gemini-3.8-flash-high', 'validation')
        failCall(ai, 'agy:gemini-3.8-flash-high', 'validation')
        const st = JSON.parse(fs.readFileSync(`${TMP}/ai-cursor.json`, 'utf8'))
        assert.ok(Number.isFinite(st.cooling?.['agy:gemini-3.8-flash-high']), '冷卻須落到套件狀態檔(下一次 dispatchAiFallback 讀檔即降序)')
        assert.equal(healthEvents.length, 1)
        assert.equal(healthEvents[0].streak, 2)
        const usage = ai.aiUsageToday()
        assert.equal(usage.byKey['agy:gemini-3.8-flash-high'], 1, '計帳仍於 try 事件計')
        assert.match(ai.drainStats(), /健康降序 agy:gemini-3\.8-flash-high×1/, '執行摘要須揭露健康降序')
        assert.doesNotMatch(ai.drainStats(), /健康降序/, 'drainStats 歸零')
    })

    it('adapter：狀態檔為行程內單一共享物件——get 恆回同一物件、外來副本以併入而非整份取代落地', () => {
        const ai = mkAdapter()
        const a = ai.store.get()
        const b = ai.store.get()
        assert.equal(a, b, '同一物件:各並行呼叫就地修改,不再互相覆蓋(套件文件要求呼叫端自行處理並發)')
        a.cursors = { x: 1 }
        ai.store.set({ cooling: { p: 123 } }) // 模擬套件以副本寫回
        const c = ai.store.get()
        assert.equal(c.cursors.x, 1, '併入後既有欄位保留')
        assert.equal(c.cooling.p, 123)
        const onDisk = JSON.parse(fs.readFileSync(`${TMP}/ai-cursor.json`, 'utf8'))
        assert.equal(onDisk.cursors.x, 1)
        assert.equal(onDisk.cooling.p, 123)
    })

    it('adapter：validateSeats 於啟動期檢核全部席位;缺金鑰之條目訊息附環境變數名', () => {
        const ai = mkAdapter()
        // 首選有長度上限、遞補無上限＝正常配置:長 prompt 由 callJson 依實際長度自動改派(ai/capability),啟動期不猜
        const ok = ai.validateSeats({ 'ai.extract.executor': { use: 'agy:gemini-3.8-flash-high', fallback: ['claude:sonnet'] } })
        assert.equal(ok.ok, true)
        assert.deepEqual(ok.warnings, [], '席位名稱不再是判準——此前以名稱含 distill 猜測,關聯席位同樣派 agy 卻查不出來')
        // 全鏈皆有長度上限＝遇長 prompt 無處可去,必然整批失敗 → 啟動期警告
        const w = ai.validateSeats({ 'ai.relate.executor': { use: 'agy:gemini-3.8-flash-high', fallback: ['agy:gemini-3.8-flash-high'] } })
        assert.equal(w.ok, true)
        assert.equal(w.warnings.length, 1)
        assert.match(w.warnings[0], /ai\.relate\.executor.*全鏈條目皆有 prompt 長度上限.*agy:gemini-3\.8-flash-high≤30000/)
        const envFile = `${TMP}/.env`
        // 需金鑰之條目以 extraProviders 自帶,不引用內建目錄之實際 id:內建目錄會隨模型輪替增刪
        //(2026-09-15 w-dispatch-ai 1.0.25 把 agnes-2.5-flash 換成 3.0,本測試原寫死 2.5 而失敗),
        // 測試要驗的是「缺金鑰 → 啟動期拋錯並指出變數名」這條規則,不該綁在某個會過期的型號上
        const withKeyed = createAiAdapter({
            ai: {
                providerPick: ['probe:needs-key', 'claude:sonnet'],
                extraProviders: [{ id: 'probe:needs-key', model: 'probe', kind: 'api-openai-compat', envVar: 'PROBE_KEYS_ABSENT', baseURL: 'https://example.invalid/v1' }],
                providerTimeouts: {},
                cooldownMs: 1000,
                maxRetries: 0,
            },
            envFile,
            stateDir: TMP,
            workspace: TMP,
            clock: createClock('Asia/Taipei'),
        })
        assert.throws(
            () => withKeyed.validateSeats({ 'ai.relate.executor': { use: 'probe:needs-key', fallback: ['claude:sonnet'] } }),
            /ai\.relate\.executor.*probe:needs-key\(缺金鑰 PROBE_KEYS_ABSENT\)/,
            '缺金鑰之席位須於啟動期拋錯並指出變數名——此前到第一次呼叫才拋、再被批次層當單批異常吞掉',
        )
    })

    it('adapter：withBudget 由鏈 timeout 總和補預算;chainFor 引用不存在條目拋錯', () => {
        const ai = mkAdapter()
        const seat = ai.withBudget({ use: 'agy:gemini-3.8-flash-high', fallback: ['claude:sonnet'] })
        assert.equal(seat.budgetMs, 3000, '1000＋2000')
        assert.throws(() => ai.chainFor({ use: 'nope' }), /不可用的條目:nope/)
    })

})
