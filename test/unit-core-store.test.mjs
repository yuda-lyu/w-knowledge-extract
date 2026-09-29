// unit-core-store.test.mjs — 核心狀態檔(真理檔)之讀寫:缺檔／壞檔分流、.prev 救回、隔離、CAS、封存、手改偵測、原子寫
//
// 規格來源:tmp/wke-distill-b-全盤.md §11.1 A12～A16(2026-09-29 雙審定案)
// 執行:npx mocha test/unit-core-store.test.mjs(暫存落 test/_tmp/core-store-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createCoreStore, mdHashOf } from '../src/stores/coreStore.mjs'
import { emptyState, STATE_VERSION } from '../src/stores/coreState.mjs'
import { writeFileAtomic } from '../src/util/misc.mjs'

const TMP = path.resolve(`test/_tmp/core-store-${process.pid}`).replace(/\\/g, '/')
let seq = 0
const mk = () => {
    const d = `${TMP}/s${++seq}`
    return createCoreStore({ dir: `${d}/core`, prevDir: `${d}/prev` })
}
const st = (version, extra = {}) => ({ ...emptyState({ coreId: 'k', concept: '甲' }), version, ...extra })

describe('unit-core-store', function() {

    before(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    it('缺檔 → missing;首次寫入(expectRev null)後可讀回、rev＝1;每次寫入 rev＋1(含知識版本不變之落帳);再寫時現存版存為 .prev', () => {
        const s = mk()
        assert.equal(s.load('k').status, 'missing')
        assert.equal(s.save('k', st(1), { expectRev: null }).rev, 1)
        const r = s.load('k')
        assert.equal(r.status, 'ok')
        assert.deepEqual([r.state.version, r.state.rev], [1, 1])
        const w = s.save('k', r.state, { expectRev: 1 })
        assert.deepEqual([w.version, w.rev], [1, 2], '只落帳(版本不變)亦升 rev')
        assert.equal(JSON.parse(fs.readFileSync(s.prevOf('k'), 'utf8')).rev, 1, '.prev 為上一次寫入')
        assert.equal(s.load('k').state.rev, 2)
    })

    it('CAS:載入後磁碟 rev 被他處改動 → 拋錯且磁碟內容不變;缺檔時期待 null、他處已建檔亦拋錯', () => {
        const s = mk()
        s.save('k', st(3), { expectRev: null })
        assert.throws(() => s.save('k', st(3), { expectRev: 2 }), /已被他處改動（載入時 rev 2、磁碟現為 1）/)
        assert.throws(() => s.save('k', st(1), { expectRev: null }), /載入時 rev 無檔、磁碟現為 1/)
        assert.equal(s.load('k').state.version, 3)
        s.archive('k', 'regen', '20260929')
        assert.throws(() => s.save('k', st(4), { expectRev: 1 }), /磁碟現為 無檔/, 'regenCore 封存後,進行中之管線不可寫回')
    })

    it('壞檔:有 .prev 可救回(recovered);隔離改名、不刪;無 .prev 者為 corrupt;讀回之壞檔內容未被覆寫', () => {
        const s = mk()
        s.save('k', st(1), { expectRev: null })
        s.save('k', st(2), { expectRev: 1 })
        fs.writeFileSync(s.fileOf('k'), '{"v":1,"version":2,"claims":[{"id":"C', 'utf8')
        const r = s.load('k')
        assert.equal(r.status, 'recovered')
        assert.equal(r.state.version, 1, '自 .prev 救回上一版')
        assert.match(r.error, /JSON 解析失敗/)
        const moved = s.quarantine('k', '20260929T1')
        assert.match(moved, /\.state\.json\.corrupt-20260929T1$/)
        assert.equal(fs.readFileSync(moved, 'utf8'), '{"v":1,"version":2,"claims":[{"id":"C', '壞檔原樣保留供事後分析')
        assert.equal(s.load('k').status, 'missing')
        const s2 = mk()
        fs.mkdirSync(s2.dir, { recursive: true })
        fs.writeFileSync(s2.fileOf('k'), 'not json', 'utf8')
        assert.equal(s2.load('k').status, 'corrupt')
        assert.ok(Number.isNaN(s2.diskRev('k')))
    })

    it('格式版本新於本套件 → newer(拒讀,不當壞檔、不覆寫)', () => {
        const s = mk()
        fs.mkdirSync(s.dir, { recursive: true })
        fs.writeFileSync(s.fileOf('k'), JSON.stringify({ v: STATE_VERSION + 1, version: 9 }), 'utf8')
        const r = s.load('k')
        assert.equal(r.status, 'newer')
        assert.throws(() => s.save('k', st(10), { expectRev: 9 }), /已被他處改動/, '讀不懂之較新檔不可被覆寫')
    })

    it('手改偵測:磁碟 md 為最近兩次渲染之一或只差換行格式 → 不另存;內容被改 → 先另存副本(於 manualDir、非 .md)', () => {
        const s = mk()
        const md = `${TMP}/m${seq}.md`
        const manualDir = `${TMP}/manual${seq}`
        const v1 = '---\ntitle: "甲"\n---\n\n# 核心知識：甲\n'
        const v2 = '---\ntitle: "甲"\n---\n\n# 核心知識：甲\n\n## 本質\n\n新\n'
        fs.writeFileSync(md, v1, 'utf8')
        const hashes = [mdHashOf(v1), mdHashOf(v2)]
        assert.equal(s.guardManualEdit(md, hashes, 'T1', manualDir), '', 'md 寫前中斷:磁碟仍為上一次渲染,不算手改')
        fs.writeFileSync(md, v2.replace(/\n/g, '\r\n'), 'utf8')
        assert.equal(s.guardManualEdit(md, hashes, 'T2', manualDir), '', 'CRLF(git autocrlf)不算手改')
        fs.writeFileSync(md, `${v2}\n手改補充\n`, 'utf8')
        const saved = s.guardManualEdit(md, hashes, 'T3', manualDir)
        assert.ok(path.resolve(saved).startsWith(path.resolve(manualDir)) && saved.endsWith('.T3.manual.txt'), saved)
        assert.match(fs.readFileSync(saved, 'utf8'), /手改補充/)
        assert.equal(s.guardManualEdit(md, [], 'T4', manualDir), '', '無渲染雜湊(1.x 舊核心首次渲染前)不動作')
    })

    it('loadPrev:2.0 狀態檔遺失時可由 .prev 還原;封存與隔離檔放 archiveDir(不在知識目錄內)', () => {
        const d = `${TMP}/s${++seq}`
        const s = createCoreStore({ dir: `${d}/core`, prevDir: `${d}/state/prev`, archiveDir: `${d}/state/archive` })
        s.save('k', st(1), { expectRev: null })
        s.save('k', st(2), { expectRev: 1 })
        fs.rmSync(s.fileOf('k'))
        assert.equal(s.load('k').status, 'missing')
        assert.equal(s.loadPrev('k').state.version, 1)
        s.save('k', st(3), { expectRev: null })
        const moved = s.archive('k', 'regen', 'T9')
        assert.ok(path.resolve(moved).startsWith(path.resolve(`${d}/state/archive`)), moved)
        assert.deepEqual(fs.readdirSync(`${d}/core`), [], '知識目錄內不留封存檔')
    })

    it('writeFileAtomic:真理檔 rename 失敗 → 拋錯、不退回覆寫、不留暫存檔', () => {
        const dir = `${TMP}/atomic`
        const target = `${dir}/busy`
        fs.mkdirSync(target, { recursive: true }) // 目標為目錄:rename 必失敗(Windows EPERM／他平台 EISDIR 等)
        assert.throws(() => writeFileAtomic(target, 'x', { retries: 1 }))
        assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], '暫存檔已清除')
        assert.ok(fs.statSync(target).isDirectory(), '目標未被覆寫')
        writeFileAtomic(`${dir}/ok.json`, '{}')
        assert.equal(fs.readFileSync(`${dir}/ok.json`, 'utf8'), '{}')
    })
})
