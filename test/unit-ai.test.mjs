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
const fail = (providerId, errorType, extra = {}) => ({ type: 'skip-group', providerId, keyIndex: null, keyId: providerId, error: `${errorType} err`, errorType, ...extra })

describe('unit-ai', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── providerHealth ──
    it('連續 3 次驗證失敗 → 寫入套件 cooling 表(降序);成功即歸零;未達門檻不冷卻', () => {
        const store = memStore({ cursors: {}, cooling: {} })
        const cooled = []
        let t = 1_000_000
        const h = createProviderHealth({ store, threshold: 3, windowMs: 900_000, now: () => t, onCool: (ev) => cooled.push(ev) })
        h.onEvent(fail('g', 'validation'))
        h.onEvent(fail('g', 'validation'))
        assert.equal(store._raw().cooling.g, undefined, '兩次未達門檻不冷卻——單次驗證失敗是常態')
        h.onEvent({ type: 'ok', providerId: 'g', keyIndex: null, keyId: 'g', durationMs: 1 })
        h.onEvent(fail('g', 'validation'))
        h.onEvent(fail('g', 'validation'))
        assert.equal(store._raw().cooling.g, undefined, '成功歸零後重新計數')
        h.onEvent(fail('g', 'exec'))
        assert.equal(store._raw().cooling.g, t, '第 3 次(混合 validation/exec)即寫入 cooling')
        assert.equal(cooled.length, 1)
        assert.equal(cooled[0].providerId, 'g')
        assert.equal(cooled[0].streak, 3)
        assert.equal(cooled[0].errorType, 'exec')
        // 冷卻中再失敗:重新斷言但不重複回呼(套件各呼叫整份寫回 state 可能蓋掉本層寫入,故每次失敗再寫)
        store.set({ cursors: {}, cooling: {} }) // 模擬被套件的 saveState 蓋掉
        h.onEvent(fail('g', 'validation'))
        assert.equal(store._raw().cooling.g, t, '被蓋掉後於下一次失敗重新斷言')
        assert.equal(cooled.length, 1, '同一段 streak 只回呼一次')
        const s = h.snapshot()
        assert.equal(s.counts.g.cooled, 1)
        assert.equal(s.counts.g.fail.validation, 5)
        assert.equal(s.counts.g.ok, 1)
    })

    it('params(席位與能力不相容,如 agy prompt 過長)不計 streak,另計 mismatch 並進摘要', () => {
        const store = memStore({ cooling: {} })
        const h = createProviderHealth({ store, threshold: 2 })
        for (let i = 0; i < 6; i++) h.onEvent(fail('agy', 'params', { error: 'prompt too long (41000 chars > 30000)' }))
        assert.equal(store._raw().cooling.agy, undefined, 'params 不冷卻:冷卻改善不了設定不相容,反而讓它在可用的席位也被降序')
        assert.equal(h.snapshot().counts.agy.mismatch, 6)
        assert.match(h.summary(), /席位不相容 agy\(params\)×6/)
        assert.doesNotMatch(h.summary(), /健康降序/)
    })

    it('多把金鑰之單把失敗(next-key 帶 keyIndex)不計 streak;無金鑰輪替者(keyIndex null)之 next-key 計入', () => {
        const store = memStore({ cooling: {} })
        const h = createProviderHealth({ store, threshold: 2 })
        for (let i = 0; i < 3; i++) h.onEvent({ type: 'next-key', providerId: 'agnes', keyIndex: i % 2, keyId: `agnes#${i % 2}`, errorType: 'exec', error: 'quota' })
        assert.equal(store._raw().cooling.agnes, undefined, '一把額度用盡不是整家故障,由套件換鑰處理')
        for (let i = 0; i < 2; i++) h.onEvent({ type: 'next-key', providerId: 'agy', keyIndex: null, keyId: 'agy', errorType: 'exec', error: 'cli exit 1' })
        assert.ok(Number.isFinite(store._raw().cooling.agy), 'CLI 登入態之連續執行失敗計入(2026-09-09 08:00 agy exec×16 之風暴)')
    })

    it('冷卻中且未逾窗不重寫時間戳;逾窗後再達門檻才重寫', () => {
        const store = memStore({ cooling: {} })
        let t = 100
        const h = createProviderHealth({ store, threshold: 1, windowMs: 1000, now: () => t })
        h.onEvent(fail('p', 'validation'))
        assert.equal(store._raw().cooling.p, 100)
        t = 500
        h.onEvent(fail('p', 'validation'))
        assert.equal(store._raw().cooling.p, 100, '未逾窗不重寫(否則冷卻永不結束)')
        t = 1200
        h.onEvent(fail('p', 'validation'))
        assert.equal(store._raw().cooling.p, 1200, '逾窗後重寫')
        assert.equal(h.snapshot().counts.p.cooled, 2)
    })

    it('無 store 時只統計不冷卻;非失敗事件(try/aborted/budget-out/cooled)不影響 streak', () => {
        const h = createProviderHealth({ threshold: 1 })
        h.onEvent({ type: 'try', providerId: 'x' })
        h.onEvent({ type: 'aborted', providerId: 'x' })
        h.onEvent({ type: 'budget-out', providerId: 'x' })
        h.onEvent({ type: 'cooled', providerId: 'x' })
        assert.deepEqual(h.snapshot().streak, {})
        h.onEvent(fail('x', 'validation'))
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
        ai.onEvent(fail('agy:gemini-3.8-flash-high', 'validation'))
        ai.onEvent(fail('agy:gemini-3.8-flash-high', 'validation'))
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
