// unit-lock.test.mjs — 執行鎖之判定與互斥:inspectLock 各狀態、持鎖者宣告之陳舊期限、同一行程互斥(nonce)、
//   跨行程原子建立(真子行程)、空檔寬限、時鐘回撥、只釋放自己的鎖
// 執行:npx mocha test/unit-lock.test.mjs(暫存落 test/_tmp/lock-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { acquireLock, inspectLock } from '../src/core/lock.mjs'

const TMP = path.resolve(`test/_tmp/lock-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const MIN = 60_000
const DEAD_PID = 2 ** 22 + 12345 // 不存在之 pid(同 unit-util)

//以他行程(本行程之父行程:必存活且≠本行程)之名義寫入鎖檔
function writeToken(file, tok) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof tok === 'string' ? tok : JSON.stringify(tok), 'utf8')
}

//子行程:對齊到 t0 後取鎖,印一行結果;取得者持鎖至 stdin 關閉才釋放(確保其餘子行程皆於持有期間嘗試),
//  WKE_NO_RELEASE=1 時取得後直接結束不釋放(模擬崩潰殘留)
const CHILD = `
import { acquireLock } from ${JSON.stringify(pathToFileURL(path.resolve('src/core/lock.mjs')).href)}
const t0 = Number(process.env.WKE_T0)
while (Date.now() < t0) {}
const r = acquireLock(process.env.WKE_LOCK_FILE, { staleMs: Number(process.env.WKE_STALE) })
process.stdout.write(JSON.stringify({ ok: r.ok, message: r.message, pid: process.pid }) + '\\n')
if (r.ok && process.env.WKE_NO_RELEASE === '1') process.exit(0)
if (r.ok) {
    process.stdin.resume()
    process.stdin.on('end', () => { r.release(); process.exit(0) })
}
`

//同時啟動 n 個子行程搶同一把鎖;全部回報後關閉 stdin,等全部結束;回傳各子行程之結果
function race(file, n, opt = {}) {
    const t0 = Date.now() + 2000
    return new Promise((resolve) => {
        const results = []
        const children = []
        let exited = 0
        const done = () => {
            if (results.length === n) children.forEach((c) => c.stdin.end())
        }
        for (let i = 0; i < n; i++) {
            const c = spawn(process.execPath, ['--input-type=module', '-e', CHILD], {
                env: { ...process.env, WKE_LOCK_FILE: file, WKE_T0: String(t0), WKE_STALE: String(opt.staleMs ?? MIN), WKE_NO_RELEASE: opt.noRelease ? '1' : '0' },
                stdio: ['pipe', 'pipe', 'pipe'],
            })
            let out = ''
            let err = ''
            let reported = false
            c.stdout.on('data', (d) => {
                out += d
                if (!reported && out.includes('\n')) {
                    reported = true
                    results.push(JSON.parse(out.split('\n')[0]))
                    done()
                }
            })
            c.stderr.on('data', (d) => {
                err += d
            })
            c.on('exit', (code) => {
                if (!reported) {
                    reported = true
                    results.push({ ok: null, crash: true, code, stderr: err })
                    done()
                }
                exited++
                if (exited === n) resolve(results)
            })
            children.push(c)
        }
    })
}

describe('unit-lock', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── inspectLock:各狀態 ──
    it('inspectLock:無鎖檔 → none;file 非有效字串拋錯;opt 非物件視為 {}', () => {
        const file = `${TMP}/s-none/run.lock`
        const s = inspectLock(file)
        assert.equal(s.state, 'none')
        assert.equal(s.pid, null)
        assert.equal(s.ageMs, null)
        assert.equal(s.staleMs, 3_600_000, '取鎖者未給 staleMs 時預設 1 小時')
        assert.equal(s.staleMsFrom, 'caller')
        assert.equal(inspectLock(file, 'bad-opt').state, 'none')
        assert.throws(() => inspectLock(''), /inspectLock 需要 file/)
        assert.throws(() => inspectLock(null), /inspectLock 需要 file/)
    })

    it('inspectLock:壞檔(非 JSON、非物件、pid 非正整數)→ corrupt;路徑為目錄 → corrupt', () => {
        const file = `${TMP}/s-corrupt/run.lock`
        for (const bad of ['{壞檔', 'null', '123', '[1]', JSON.stringify({ pid: '123', at: Date.now() }), JSON.stringify({ pid: 0 }), JSON.stringify({ pid: -1 }), JSON.stringify({ at: Date.now() })]) {
            writeToken(file, bad)
            assert.equal(inspectLock(file).state, 'corrupt', `內容 ${bad}`)
        }
        const dir = `${TMP}/s-corrupt/dir.lock`
        fs.mkdirSync(dir, { recursive: true })
        assert.equal(inspectLock(dir).state, 'corrupt', '讀取失敗(非 ENOENT)視為壞檔')
    })

    it('inspectLock:持鎖行程不存在 → dead;存活且未逾期 → held;存活但逾期 → stale', () => {
        const file = `${TMP}/s-live/run.lock`
        writeToken(file, { pid: DEAD_PID, at: Date.now(), staleMs: 60 * MIN })
        const d = inspectLock(file)
        assert.equal(d.state, 'dead')
        assert.equal(d.alive, false)
        writeToken(file, { pid: process.ppid, at: Date.now() - 10_000, staleMs: 60 * MIN })
        const h = inspectLock(file)
        assert.equal(h.state, 'held')
        assert.equal(h.alive, true)
        assert.equal(h.pid, process.ppid)
        assert.ok(h.ageMs >= 10_000 && h.ageMs < 20_000, `ageMs=${h.ageMs}`)
        writeToken(file, { pid: process.ppid, at: Date.now() - 61 * MIN, staleMs: 60 * MIN })
        assert.equal(inspectLock(file).state, 'stale')
    })

    it('inspectLock:本行程現持有 → self(路徑寫法不同亦同一把);release 後 → none', () => {
        const file = `${TMP}/s-self/run.lock`
        const a = acquireLock(file, { staleMs: MIN })
        assert.equal(a.ok, true)
        const s = inspectLock(file)
        assert.equal(s.state, 'self')
        assert.equal(s.self, true)
        assert.equal(s.pid, process.pid)
        assert.equal(inspectLock(path.relative(process.cwd(), file)).state, 'self', '相對路徑')
        if (process.platform === 'win32') assert.equal(inspectLock(file.toUpperCase()).state, 'self', 'Windows 不分大小寫')
        a.release()
        assert.equal(inspectLock(file).state, 'none')
    })

    // ── 陳舊期限由持鎖者宣告 ──
    it('持鎖者宣告 485 分之長時執行,90 分時以 65 分取鎖者判定仍為持有(不得接管);訊息標明持鎖者宣告', () => {
        const file = `${TMP}/decl-long/run.lock`
        writeToken(file, { pid: process.ppid, at: Date.now() - 90 * MIN, staleMs: 485 * MIN, nonce: 'other' })
        const s = inspectLock(file, { staleMs: 65 * MIN })
        assert.equal(s.state, 'held')
        assert.equal(s.staleMs, 485 * MIN)
        assert.equal(s.staleMsFrom, 'holder')
        const r = acquireLock(file, { staleMs: 65 * MIN })
        assert.equal(r.ok, false, '此前以取鎖者之 65 分判定而接管,兩條管線同時寫同一個資料庫')
        assert.match(r.message, new RegExp(`^另一個執行中（pid ${process.ppid}，已執行 \\d+s，陳舊期限 485 分（持鎖者宣告））$`))
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).nonce, 'other', '未接管:鎖檔不變')
    })

    it('持鎖者宣告 65 分,100 分時即使取鎖者宣告 485 分仍判陳舊而接管;接管後鎖檔記本次之宣告值與 nonce', () => {
        const file = `${TMP}/decl-short/run.lock`
        writeToken(file, { pid: process.ppid, at: Date.now() - 100 * MIN, staleMs: 65 * MIN, nonce: 'other' })
        assert.equal(inspectLock(file, { staleMs: 485 * MIN }).state, 'stale')
        const r = acquireLock(file, { staleMs: 485 * MIN })
        assert.equal(r.ok, true)
        const tok = JSON.parse(fs.readFileSync(file, 'utf8'))
        assert.equal(tok.pid, process.pid)
        assert.equal(tok.staleMs, 485 * MIN, '本次宣告值寫入鎖檔,他人以此判定')
        assert.ok(typeof tok.nonce === 'string' && tok.nonce !== 'other')
        assert.ok(Math.abs(tok.at - Date.now()) < 5000)
        r.release()
        assert.ok(!fs.existsSync(file))
    })

    it('舊格式鎖檔(無宣告值)與不合理之宣告值(非正整數、逾 7 天)退回取鎖者之值', () => {
        const file = `${TMP}/decl-fallback/run.lock`
        writeToken(file, { pid: process.ppid, at: Date.now() - 10_000 })
        assert.equal(inspectLock(file, { staleMs: 5_000 }).state, 'stale', '舊格式:以取鎖者 5 秒判定')
        assert.equal(inspectLock(file, { staleMs: MIN }).state, 'held', '舊格式:以取鎖者 60 秒判定')
        assert.equal(inspectLock(file, { staleMs: MIN }).staleMsFrom, 'caller')
        for (const bad of ['abc', -5, 0, 1.5, null, 8 * 24 * 60 * MIN]) {
            writeToken(file, { pid: process.ppid, at: Date.now() - 10_000, staleMs: bad })
            const s = inspectLock(file, { staleMs: 5_000 })
            assert.equal(s.staleMsFrom, 'caller', `宣告值 ${bad}`)
            assert.equal(s.staleMs, 5_000, `宣告值 ${bad}`)
            assert.equal(s.state, 'stale', `宣告值 ${bad}`)
        }
        writeToken(file, { pid: process.ppid, at: Date.now() - 10_000, staleMs: 7 * 24 * 60 * MIN })
        assert.equal(inspectLock(file, { staleMs: 5_000 }).staleMsFrom, 'holder', '恰為 7 天仍採用')
        const r = acquireLock(file, { staleMs: 'abc' })
        assert.equal(r.ok, false)
        assert.match(r.message, /陳舊期限 10080 分（持鎖者宣告））$/)
    })

    it('時鐘回撥(鎖時刻在未來):存活者視為持有並標 clockSkew,ageMs 以 0 計;持鎖行程已不存在者仍可接管', () => {
        const file = `${TMP}/skew/run.lock`
        writeToken(file, { pid: process.ppid, at: Date.now() + 60 * MIN, staleMs: MIN })
        const s = inspectLock(file)
        assert.equal(s.state, 'held')
        assert.equal(s.clockSkew, true)
        assert.equal(s.ageMs, 0)
        const r = acquireLock(file, { staleMs: MIN })
        assert.equal(r.ok, false)
        assert.match(r.message, /，鎖時刻在未來（時鐘回撥））$/)
        writeToken(file, { pid: DEAD_PID, at: Date.now() + 60 * MIN, staleMs: MIN })
        assert.equal(inspectLock(file).state, 'dead')
        assert.equal(acquireLock(file).ok, true)
    })

    // ── 同一行程互斥 ──
    it('同一行程內第二次取同一把鎖回 ok:false(此前同 pid 一律放行);release 後可再取得', () => {
        const file = `${TMP}/same/run.lock`
        const a = acquireLock(file, { staleMs: MIN })
        assert.equal(a.ok, true)
        const b = acquireLock(file, { staleMs: MIN })
        assert.equal(b.ok, false, '並行之兩次 run() 此前兩條管線都跑')
        assert.equal(b.release, undefined)
        assert.match(b.message, /^本行程已持有此鎖（.+）：同一行程內不可重複取得$/)
        assert.equal(acquireLock(path.relative(process.cwd(), file)).ok, false, '相對路徑亦同一把')
        a.release()
        const c = acquireLock(file, { staleMs: MIN })
        assert.equal(c.ok, true, 'release 後登記表已清除')
        c.release()
    })

    it('鎖檔 pid 為本行程但 nonce 不在登記表(前一個同 pid 行程之殘留)→ dead,可接管', () => {
        const file = `${TMP}/same-foreign/run.lock`
        writeToken(file, { pid: process.pid, at: Date.now(), staleMs: 60 * MIN, nonce: 'previous-life' })
        assert.equal(inspectLock(file).state, 'dead')
        writeToken(file, { pid: process.pid, at: Date.now() })
        assert.equal(inspectLock(file).state, 'dead', '舊格式(無 nonce)亦同')
        const r = acquireLock(file, { staleMs: MIN })
        assert.equal(r.ok, true)
        r.release()
    })

    it('release 只釋放自己:被取代之舊持有者晚到的 release 不刪現持有者之鎖、不清其登記', () => {
        const file = `${TMP}/release/run.lock`
        const a = acquireLock(file, { staleMs: MIN })
        assert.equal(a.ok, true)
        fs.unlinkSync(file) // 外力清除(或被判陳舊而接管)
        const b = acquireLock(file, { staleMs: MIN })
        assert.equal(b.ok, true)
        a.release()
        assert.ok(fs.existsSync(file), '現持有者之鎖檔仍在')
        assert.equal(inspectLock(file).state, 'self', '現持有者之登記仍在')
        b.release()
        assert.equal(inspectLock(file).state, 'none')
        assert.doesNotThrow(() => b.release(), '重複 release 不拋錯')
    })

    // ── 空檔寬限('wx' 建立與寫入之間) ──
    it('空鎖檔:2 秒內視為建立中之持有(不接管);逾寬限仍空視為壞檔而接管;僅空白字元同空檔', () => {
        const file = `${TMP}/empty/run.lock`
        writeToken(file, '')
        assert.equal(inspectLock(file).state, 'held')
        const r = acquireLock(file)
        assert.equal(r.ok, false)
        assert.equal(r.message, '另一個執行中（鎖檔建立中）')
        writeToken(file, ' \n')
        assert.equal(inspectLock(file).state, 'held')
        const old = new Date(Date.now() - 10_000)
        fs.utimesSync(file, old, old)
        assert.equal(inspectLock(file).state, 'corrupt')
        const t = acquireLock(file)
        assert.equal(t.ok, true)
        t.release()
    })

    // ── 跨行程(真子行程) ──
    it('跨行程原子建立:8 個子行程同一時刻取同一把鎖,恰 1 個取得(此前 12 行程每回合 8～12 個取得);連做 2 回合', async function() {
        this.timeout(60_000)
        for (let round = 0; round < 2; round++) {
            const file = `${TMP}/race-${round}/run.lock`
            fs.mkdirSync(path.dirname(file), { recursive: true })
            const rs = await race(file, 8)
            const crashed = rs.filter((r) => r.crash)
            assert.deepEqual(crashed, [], '子行程不得崩潰')
            assert.equal(rs.filter((r) => r.ok).length, 1, `第 ${round + 1} 回合取得者:${JSON.stringify(rs)}`)
            for (const r of rs.filter((x) => !x.ok)) assert.match(r.message, /^另一個執行中（/)
            assert.ok(!fs.existsSync(file), '取得者結束前 release,鎖檔已刪')
        }
    })

    it('跨行程崩潰殘留:子行程取得後未釋放即結束 → 本行程判 dead 並接管', async function() {
        this.timeout(30_000)
        const file = `${TMP}/crash/run.lock`
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const rs = await race(file, 1, { noRelease: true, staleMs: 485 * MIN })
        assert.equal(rs[0].ok, true)
        const tok = JSON.parse(fs.readFileSync(file, 'utf8'))
        assert.equal(tok.pid, rs[0].pid)
        assert.equal(tok.staleMs, 485 * MIN)
        const s = inspectLock(file, { staleMs: MIN })
        assert.equal(s.state, 'dead', '即使宣告 485 分,持鎖行程已不存在即可接管')
        const r = acquireLock(file, { staleMs: MIN })
        assert.equal(r.ok, true)
        r.release()
    })

})
