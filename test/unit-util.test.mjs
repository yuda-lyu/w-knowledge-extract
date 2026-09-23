// unit-util.test.mjs — 泛用件之回歸測試:執行鎖(只釋放自己的鎖)、firstLineClamp 長度上限、queueAge
// 執行:npx mocha test/unit-util.test.mjs(暫存落 test/_tmp/util-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { acquireLock } from '../src/core/lock.mjs'
import { firstLineClamp, queueAge, oneline, readJson, writeJson } from '../src/util/misc.mjs'

const TMP = path.resolve(`test/_tmp/util-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除

describe('unit-util', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── core/lock ──
    it('acquireLock:取得→他實例(存活 pid、未逾 staleMs)占用時回 ok:false;release 後可再取得;自動建父目錄', () => {
        const file = `${TMP}/lock1/run.lock`
        const a = acquireLock(file, { staleMs: 60_000 })
        assert.equal(a.ok, true)
        assert.ok(fs.existsSync(file), '父目錄不存在時自動建立')
        // 模擬他實例持有:以本行程之父行程 pid(必存活且≠本行程)寫入鎖檔
        fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, at: Date.now() }), 'utf8')
        const b = acquireLock(file, { staleMs: 60_000 })
        assert.equal(b.ok, false)
        assert.match(b.message, new RegExp(`另一個執行中（pid ${process.ppid}`))
        fs.unlinkSync(file)
        const c = acquireLock(file)
        assert.equal(c.ok, true, '鎖檔移除後可取得')
        c.release()
        assert.ok(!fs.existsSync(file), 'release 刪除自己的鎖')
    })

    it('acquireLock:逾 staleMs 或 pid 已不存在者視為殘留而接管;壞檔視同無鎖', () => {
        const file = `${TMP}/lock2/run.lock`
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, at: Date.now() - 10_000 }), 'utf8')
        assert.equal(acquireLock(file, { staleMs: 5_000 }).ok, true, '逾 staleMs 即接管(前次被強制中止之殘留)')
        fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }), 'utf8')
        assert.equal(acquireLock(file, { staleMs: 60_000 }).ok, true, 'pid 已不存在即接管')
        fs.writeFileSync(file, '{壞檔', 'utf8')
        assert.equal(acquireLock(file).ok, true, '壞檔視同無鎖')
    })

    it('acquireLock:release 只刪自己寫的鎖——被接管後之 release 不得刪掉接管者的鎖(2026-09-23 修)', () => {
        const file = `${TMP}/lock3/run.lock`
        const mine = acquireLock(file, { staleMs: 60_000 })
        assert.equal(mine.ok, true)
        // 本實例跑過 staleMs 被下一實例接管(鎖檔內容換成接管者)
        const takeover = JSON.stringify({ pid: process.ppid, at: Date.now() })
        fs.writeFileSync(file, takeover, 'utf8')
        mine.release()
        assert.ok(fs.existsSync(file), '接管者之鎖不得被刪(否則第三個實例即可並行)')
        assert.equal(fs.readFileSync(file, 'utf8'), takeover)
        fs.unlinkSync(file)
        assert.doesNotThrow(() => mine.release(), '鎖檔已不存在時 release 不拋錯')
    })

    it('acquireLock:file 非有效字串拋錯;staleMs 非正整數回退預設 3600000', () => {
        assert.throws(() => acquireLock(''), /acquireLock 需要 file/)
        assert.throws(() => acquireLock(null), /acquireLock 需要 file/)
        const file = `${TMP}/lock4/run.lock`
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, at: Date.now() - 10_000 }), 'utf8')
        assert.equal(acquireLock(file, { staleMs: 'abc' }).ok, false, '無效 staleMs 回退 1 小時:10 秒前之鎖仍有效')
        assert.equal(acquireLock(file, 'bad-opt').ok, false, 'opt 非物件視為 {}')
    })

    // ── util/misc ──
    it('firstLineClamp:回傳長度嚴格不超過 max(max≤3 不補刪節號,2026-09-23 修);只取第一行', () => {
        assert.equal(firstLineClamp('標題\n副標', 100), '標題')
        assert.equal(firstLineClamp('abcdefghij', 6), 'abc...')
        assert.equal(firstLineClamp('abcdefghij', 3), 'abc', 'max=3 時補刪節號會變成 6 字')
        assert.equal(firstLineClamp('abcdefghij', 2), 'ab')
        assert.equal(firstLineClamp('abcdefghij', 0), '')
        for (const max of [0, 1, 2, 3, 4, 5, 10]) assert.ok(firstLineClamp('x'.repeat(50), max).length <= max, `max=${max}`)
        assert.equal(firstLineClamp('abc', 'bad'), 'abc', 'max 非有效值回退預設 100')
        assert.equal(firstLineClamp(null), '')
    })

    it('queueAge:最舊天數以可解析日期計、無可解析者為 null(非 0);rows 非陣列視為空', () => {
        const now = Date.parse('2026-09-10T00:00:00Z')
        assert.deepEqual(queueAge([{ collectedAt: '2026-09-01T00:00:00Z' }, { collectedAt: '' }, {}], 'collectedAt', now), { count: 3, oldestDays: 9 })
        assert.deepEqual(queueAge([{ rawAt: '2026-09-09T12:00:00Z' }], 'rawAt', now), { count: 1, oldestDays: 0 })
        assert.deepEqual(queueAge([{}], 'collectedAt', now), { count: 1, oldestDays: null }, 'null＝無資料,不可與「全新」之 0 混為一談')
        assert.deepEqual(queueAge(null), { count: 0, oldestDays: null })
    })

    it('oneline/readJson/writeJson:壓平空白與截斷;JSON 往返;讀不到回 fallback;寫入路徑非字串拋錯', () => {
        assert.equal(oneline('a\n  b\tc'), 'a b c')
        assert.equal(oneline('x'.repeat(10), 3), 'xxx...')
        const f = `${TMP}/j/state.json`
        writeJson(f, { a: 1, s: '中文' })
        assert.deepEqual(readJson(f), { a: 1, s: '中文' })
        assert.deepEqual(readJson(`${TMP}/none.json`, { d: 1 }), { d: 1 })
        assert.equal(readJson(''), null)
        assert.throws(() => writeJson('', {}), /writeJson 需要 file/)
    })

})
