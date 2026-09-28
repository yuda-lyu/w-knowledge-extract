// unit-runtime.test.mjs — 執行期生效值單一來源(core/runtime):排程上限來源與有效性、時間預算、鎖陳舊期限、巡檢判界、路徑值域
// 執行:npx mocha test/unit-runtime.test.mjs(純函數,不落檔)

import assert from 'node:assert/strict'
import path from 'node:path'
import { resolveRuntime, limitMinOfDeadline } from '../src/core/runtime.mjs'

const MIN = 60_000
const CTX = { workDir: 'c:/kb', dirs: { tmp: 'c:/kb/tmp', state: 'c:/kb/state', log: 'c:/kb/log' } }
const NONE_WARN = /^未給 scheduleLimitMin 亦未給 deadlineMs，整輪時間預算採套件預設 50 分/
const rr = (cfg) => resolveRuntime(cfg, CTX)

describe('unit-runtime', function() {

    // ── 排程上限:來源優先序與值有效性 ──
    it('皆未給:時間預算 50 分、鎖陳舊 60 分、巡檢判界 null,並警告未給', () => {
        const r = rr({})
        assert.equal(r.scheduleLimitMin, null)
        assert.equal(r.patrolLimitMin, null)
        assert.equal(r.deadlineMs, 50 * MIN)
        assert.equal(r.lockStaleMs, 60 * MIN)
        assert.equal(r.warnings.length, 1)
        assert.match(r.warnings[0], NONE_WARN)
    })

    it('頂層上限 65:預算＝上限−6 分、鎖陳舊＝上限＋5 分、巡檢判界 65;數字字串同數字', () => {
        for (const v of [65, '65', ' 65 ']) {
            const r = rr({ scheduleLimitMin: v })
            assert.equal(r.scheduleLimitMin, 65, `值 ${JSON.stringify(v)}`)
            assert.equal(r.deadlineMs, 59 * MIN)
            assert.equal(r.lockStaleMs, 70 * MIN)
            assert.equal(r.patrolLimitMin, 65)
            assert.deepEqual(r.warnings, [])
        }
    })

    it('只給舊名 monitor.scheduleLimitMin 仍作用;字串 \'60\' 取 60(此前巡檢門檻成 \'6060\')', () => {
        for (const v of [60, '60']) {
            const r = rr({ monitor: { scheduleLimitMin: v } })
            assert.equal(r.scheduleLimitMin, 60)
            assert.equal(r.patrolLimitMin, 60)
            assert.equal(r.deadlineMs, 54 * MIN)
            assert.deepEqual(r.warnings, [])
        }
    })

    it('頂層 480＋舊名 60:以頂層為準(管線與巡檢同為 480),並警告兩者不同;兩者相同不警告', () => {
        const r = rr({ scheduleLimitMin: 480, monitor: { scheduleLimitMin: 60 } })
        assert.equal(r.scheduleLimitMin, 480)
        assert.equal(r.patrolLimitMin, 480, '此前巡檢以 monitor 之 60 判界')
        assert.equal(r.lockStaleMs, 485 * MIN)
        assert.equal(r.warnings.length, 1)
        assert.match(r.warnings[0], /cfg\.scheduleLimitMin（480）與舊名 cfg\.monitor\.scheduleLimitMin（60）不同，以頂層為準/)
        assert.deepEqual(rr({ scheduleLimitMin: 60, monitor: { scheduleLimitMin: '60' } }).warnings, [])
    })

    it('頂層無效(0／負／非數字／空字串／非有限／布林／物件):視同未給並指名警告,改用有效之舊名(此前 0 蓋掉舊名並誤報未給)', () => {
        for (const bad of [0, -5, 'abc', '', NaN, Infinity, true, {}]) {
            const r = rr({ scheduleLimitMin: bad, monitor: { scheduleLimitMin: 60 } })
            assert.equal(r.scheduleLimitMin, 60, `值 ${String(bad)}`)
            assert.equal(r.warnings.length, 1, `值 ${String(bad)}:${r.warnings.join('｜')}`)
            assert.match(r.warnings[0], /^cfg\.scheduleLimitMin 無效（收到 .+；須為大於 0 之分鐘數），視同未給$/)
        }
    })

    it('舊名無效(0 等):視同未給並警告;兩者皆無效 → 另報未給(預算採預設)', () => {
        const r = rr({ monitor: { scheduleLimitMin: 0 } })
        assert.equal(r.scheduleLimitMin, null)
        assert.equal(r.patrolLimitMin, null, '此前 0 使巡檢 ⑫ 每輪誤報')
        assert.match(r.warnings[0], /^cfg\.monitor\.scheduleLimitMin 無效（收到 0；/)
        assert.match(r.warnings[1], NONE_WARN)
        const b = rr({ scheduleLimitMin: 'x', monitor: { scheduleLimitMin: -1 } })
        assert.equal(b.warnings.length, 3)
        assert.equal(b.deadlineMs, 50 * MIN)
    })

    // ── 時間預算與鎖陳舊期限 ──
    it('只給 deadlineMs(7 小時):鎖陳舊＝預算＋6 分＋5 分(此前仍 60 分,長時執行 60 分後即被接管);巡檢判界由預算推回', () => {
        const r = rr({ deadlineMs: 420 * MIN })
        assert.equal(r.scheduleLimitMin, null)
        assert.equal(r.deadlineMs, 420 * MIN)
        assert.equal(r.lockStaleMs, 431 * MIN)
        assert.equal(r.patrolLimitMin, 426)
        assert.deepEqual(r.warnings, [], '給了預算即不報未給')
        assert.equal(rr({ deadlineMs: String(420 * MIN) }).deadlineMs, 420 * MIN, '數字字串')
    })

    it('上限與預算皆給:預算以明給者為準;鎖陳舊取兩者推導之大者;巡檢判界取上限', () => {
        const a = rr({ scheduleLimitMin: 65, deadlineMs: 30 * MIN })
        assert.equal(a.deadlineMs, 30 * MIN)
        assert.equal(a.lockStaleMs, 70 * MIN, 'max(65＋5, 30＋6＋5)')
        assert.equal(a.patrolLimitMin, 65)
        const b = rr({ scheduleLimitMin: 65, deadlineMs: 120 * MIN })
        assert.equal(b.lockStaleMs, 131 * MIN, 'max(65＋5, 120＋6＋5)')
    })

    it('上限小於 16 分時預算下限 10 分;非整數上限之鎖陳舊仍為整數(取鎖只認正整數)', () => {
        assert.equal(rr({ scheduleLimitMin: 12 }).deadlineMs, 10 * MIN)
        const r = rr({ scheduleLimitMin: 1 / 3 })
        assert.ok(Number.isInteger(r.lockStaleMs), `lockStaleMs=${r.lockStaleMs}`)
        assert.ok(Number.isInteger(r.deadlineMs))
    })

    it('deadlineMs／lockStaleMs 無效:視同未給並指名警告,改用推導值', () => {
        const r = rr({ scheduleLimitMin: 65, deadlineMs: -1, lockStaleMs: 'abc' })
        assert.equal(r.deadlineMs, 59 * MIN)
        assert.equal(r.lockStaleMs, 70 * MIN)
        assert.match(r.warnings[0], /^cfg\.deadlineMs 無效（收到 -1；須為大於 0 之毫秒數），視同未給$/)
        assert.match(r.warnings[1], /^cfg\.lockStaleMs 無效（收到 "abc"；/)
    })

    it('明給 lockStaleMs 小於預算＋安全邊際即警告(偏慢之一輪會被接管);不上鎖時不警告;數字字串取整數', () => {
        const r = rr({ scheduleLimitMin: 65, lockStaleMs: 30 * MIN })
        assert.equal(r.lockStaleMs, 30 * MIN)
        assert.match(r.warnings[0], /^cfg\.lockStaleMs（30\.0 分）小於整輪時間預算加安全邊際（65\.0 分）/)
        assert.deepEqual(rr({ scheduleLimitMin: 65, lockStaleMs: 30 * MIN, lock: false }).warnings, [])
        assert.deepEqual(rr({ scheduleLimitMin: 65, lockStaleMs: 65 * MIN }).warnings, [], '恰等於不警告')
        assert.equal(rr({ scheduleLimitMin: 65, lockStaleMs: '4200000.4' }).lockStaleMs, 4200001)
    })

    // ── 路徑與值域 ──
    it('cfg.lock:false → null;未給／null／true／空字串 → 預設 <dirs.tmp>/run.lock(此前 true 每輪拋錯);字串 → 原樣;其餘型別建構期拋錯', () => {
        assert.equal(rr({ lock: false }).lockFile, null)
        for (const v of [undefined, null, true, '']) assert.equal(rr({ lock: v }).lockFile, 'c:/kb/tmp/run.lock', `值 ${String(v)}`)
        assert.equal(rr({ lock: 'x/my.lock' }).lockFile, 'x/my.lock')
        for (const bad of [1, {}, [], () => 1]) assert.throws(() => rr({ lock: bad }), /^Error: cfg\.lock 須為 false（不上鎖）、true 或未給/)
    })

    it('envFile:未給 → workDir/.env;相對者以 workDir 為基準;絕對者原樣;給了非字串拋錯', () => {
        assert.equal(rr({}).envFile, 'c:/kb/.env')
        assert.equal(rr({ envFile: 'sec/.env' }).envFile, 'c:/kb/sec/.env')
        const abs = path.resolve('abs/.env')
        assert.equal(rr({ envFile: abs }).envFile, abs)
        for (const v of [false, '']) assert.equal(rr({ envFile: v }).envFile, 'c:/kb/.env', '假值同未給(與此前相同)')
        assert.throws(() => rr({ envFile: 123 }), /cfg\.envFile 須為路徑字串/)
    })

    it('aiWorkspace:未給 → workDir/tmp/ai-workspace;給了取之;注入 aiAdapter 時為 null(不使用);給了非字串拋錯', () => {
        assert.equal(rr({}).aiWorkspace, 'c:/kb/tmp/ai-workspace')
        assert.equal(rr({ aiWorkspace: 'w/ai' }).aiWorkspace, 'w/ai')
        assert.equal(rr({ aiAdapter: {}, aiWorkspace: 'w/ai' }).aiWorkspace, null)
        assert.throws(() => rr({ aiWorkspace: {} }), /cfg\.aiWorkspace 須為路徑字串/)
    })

    it('cfg 非物件視為 {};ctx 缺 workDir／dirs 拋錯', () => {
        assert.equal(resolveRuntime(null, CTX).deadlineMs, 50 * MIN)
        assert.throws(() => resolveRuntime({}, {}), /resolveRuntime 需要 \{ workDir, dirs \}/)
        assert.throws(() => resolveRuntime({}), /resolveRuntime 需要/)
    })

    it('limitMinOfDeadline:預算＋6 分無條件進位;非有限正數回 null', () => {
        assert.equal(limitMinOfDeadline(59 * MIN), 65)
        assert.equal(limitMinOfDeadline(50 * MIN), 56)
        assert.equal(limitMinOfDeadline(59 * MIN + 1), 66)
        for (const bad of [0, -1, NaN, Infinity, '3000000', null]) assert.equal(limitMinOfDeadline(bad), null, `值 ${String(bad)}`)
    })

})
