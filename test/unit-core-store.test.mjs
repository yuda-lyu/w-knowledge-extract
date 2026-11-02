// unit-core-store.test.mjs — 核心狀態檔(真理檔)之讀寫:缺檔／壞檔／非本格式版本分流、.prev 救回、隔離、CAS、封存(依標記之 .prev 處置、撞名序號)、
//   手改偵測、原子寫、嚴格驗形、四態分流表(loadUsable)
//
// 規格來源:stores/coreStore 檔頭與 JSDoc、stores/coreState.normalizeState 之 JSDoc;每條斷言之訊息標明所對之規格句。
// 執行:自套件根 node <mocha> test/unit-core-store.test.mjs(暫存落 test/_tmp/core-store-<pid>〔tmpRoot,以套件根定位、與 cwd 無關〕,測完即刪〔removeRoots,回驗〕)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createCoreStore, mdHashOf, ARCHIVE_TAGS } from '../src/stores/coreStore.mjs'
import { emptyState, STATE_VERSION } from '../src/stores/coreState.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'

let TMP = ''
let seq = 0
const mk = () => {
    const d = `${TMP}/s${++seq}`
    return createCoreStore({ dir: `${d}/core`, prevDir: `${d}/prev` })
}
const st = (version, extra = {}) => ({ ...emptyState({ coreId: 'k', concept: '甲' }), version, ...extra })

describe('unit-core-store', function() {

    before(() => {
        TMP = tmpRoot('core-store')
    })
    after(() => removeRoots([TMP]))

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
        fs.writeFileSync(s.fileOf('k'), `{"v":${STATE_VERSION},"version":2,"claims":[{"id":"C`, 'utf8')
        const r = s.load('k')
        assert.equal(r.status, 'recovered')
        assert.equal(r.state.version, 1, '自 .prev 救回上一版')
        assert.match(r.error, /JSON 解析失敗/)
        const moved = s.quarantine('k', '20260929T1')
        assert.match(moved, /\.state\.json\.corrupt-20260929T1$/)
        assert.equal(fs.readFileSync(moved, 'utf8'), `{"v":${STATE_VERSION},"version":2,"claims":[{"id":"C`, '壞檔原樣保留供事後分析')
        assert.deepEqual([s.load('k').status, s.load('k').lost], ['recovered', true], '隔離保留 .prev → 主檔缺而仍可救回(修復以 expectRev null 落盤)')
        const s2 = mk()
        fs.mkdirSync(s2.dir, { recursive: true })
        fs.writeFileSync(s2.fileOf('k'), 'not json', 'utf8')
        assert.equal(s2.load('k').status, 'corrupt')
        assert.ok(Number.isNaN(s2.diskRev('k')))
    })

    it('非本格式之版本(較新、較舊、缺 v)→ foreign(拒讀,error 以「格式版本」起頭;不當壞檔:不由 .prev 救回、不覆寫、原檔留在原位)', () => {
        const s = mk()
        fs.mkdirSync(s.dir, { recursive: true })
        for (const [id, v] of [['newer', STATE_VERSION + 1], ['older', STATE_VERSION - 1], ['v1', 1], ['none', undefined]]) {
            const text = JSON.stringify({ v, coreId: id, version: 9, rev: 9, claims: [] })
            fs.writeFileSync(s.fileOf(id), text, 'utf8')
            const r = s.load(id)
            assert.equal(r.status, 'foreign', `v=${v}`)
            assert.match(r.error, /^格式版本 /, `v=${v}`)
            assert.equal(r.state, undefined, `v=${v}:不回傳可用狀態`)
            assert.ok(Number.isNaN(s.diskRev(id)), `v=${v}:diskRev 必不等於任何 expectRev`)
            assert.throws(() => s.save(id, st(10), { expectRev: 9 }), /已被他處改動/, `v=${v}:讀不懂之非本格式檔不可被覆寫`)
            assert.equal(fs.readFileSync(s.fileOf(id), 'utf8'), text, `v=${v}:原檔內容不變`)
        }
        // 即使 .prev 為合法之本格式:foreign 不當壞檔(不走 .prev 救回、不隔離改名)
        s.save('withPrev', st(1), { expectRev: null })
        s.save('withPrev', st(2), { expectRev: 1 })
        const foreignText = JSON.stringify({ v: STATE_VERSION + 1, version: 9 })
        fs.writeFileSync(s.fileOf('withPrev'), foreignText, 'utf8')
        assert.equal(s.load('withPrev').status, 'foreign', '不由 .prev 救回(那是壞檔才有之處置)')
        assert.equal(fs.readFileSync(s.fileOf('withPrev'), 'utf8'), foreignText, '原檔仍在原位')
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
        assert.equal(s.guardManualEdit(md, [], 'T4', manualDir), '', '無渲染雜湊(核心首次渲染前)不動作')
    })

    it('狀態檔遺失:有 .prev → load 回 recovered 且 lost(由上一版讀出;呼叫端修復);loadPrev 可直讀;封存與隔離檔放 archiveDir(不在知識目錄內)', () => {
        const d = `${TMP}/s${++seq}`
        const s = createCoreStore({ dir: `${d}/core`, prevDir: `${d}/state/prev`, archiveDir: `${d}/state/archive` })
        s.save('k', st(1), { expectRev: null })
        s.save('k', st(2), { expectRev: 1 })
        fs.rmSync(s.fileOf('k'))
        const r = s.load('k')
        assert.deepEqual([r.status, r.lost, r.state.version, r.error], ['recovered', true, 1, '狀態檔遺失'], '「壞檔或缺檔 → 試 .prev,救得回者 recovered;lost 標記缺檔」')
        assert.equal(s.loadPrev('k').state.version, 1)
        assert.equal(s.diskRev('k'), null, '主檔缺 → CAS 期待 null(修復以 expectRev null 落盤)')
        s.save('k', st(3), { expectRev: null })
        const moved = s.archive('k', 'regen', 'T9')
        assert.ok(path.resolve(moved).startsWith(path.resolve(`${d}/state/archive`)), moved)
        assert.deepEqual(fs.readdirSync(`${d}/core`), [], '知識目錄內不留封存檔')
    })

    it('封存依標記:壞檔隔離(corrupt)保留 .prev;打掉重練(regen)與分身併入(merged)連 .prev 一併封存(主檔不在亦然);同一標記同一時戳撞名加 -1、-2 序號', () => {
        const d = `${TMP}/s${++seq}`
        const s = createCoreStore({ dir: `${d}/core`, prevDir: `${d}/prev`, archiveDir: `${d}/archive` })
        const two = (id) => {
            s.save(id, { ...st(1), coreId: id }, { expectRev: null })
            s.save(id, { ...st(2), coreId: id }, { expectRev: 1 })
        }
        // corrupt:主檔移走、.prev 留(「壞檔隔離保留 .prev——.prev 正是壞檔之還原來源」)
        two('a')
        fs.writeFileSync(s.fileOf('a'), '{壞', 'utf8')
        const movedA = s.quarantine('a', 'T1')
        assert.match(movedA, /a\.state\.json\.corrupt-T1$/)
        assert.ok(fs.existsSync(s.prevOf('a')), '.prev 留在原位')
        assert.deepEqual([s.load('a').status, s.load('a').lost, s.load('a').state.version], ['recovered', true, 1], '隔離後主檔缺而 .prev 仍可救回')
        // regen／merged:主檔與 .prev 皆封存
        for (const tag of [ARCHIVE_TAGS.regen, ARCHIVE_TAGS.merged]) {
            const id = `b-${tag}`
            two(id)
            const moved = s.archive(id, tag, 'T2')
            assert.match(moved, new RegExp(`${id}\\.state\\.json\\.${tag}-T2$`))
            assert.equal(fs.existsSync(s.prevOf(id)), false, `${tag}:.prev 一併封存`)
            assert.ok(fs.existsSync(`${d}/archive/${id}.state.prev.json.${tag}-T2`))
            assert.equal(s.load(id).status, 'missing', `${tag}:封存後不自舊版 .prev 還原出被打掉之核心`)
        }
        // 主檔不在而 .prev 在:regen 仍封存 .prev(回''),其後同 id 之新核心不會被舊 .prev 還原
        two('c')
        fs.rmSync(s.fileOf('c'))
        assert.equal(s.archive('c', ARCHIVE_TAGS.regen, 'T3'), '', '主檔不存在回空字串')
        assert.equal(fs.existsSync(s.prevOf('c')), false)
        assert.equal(s.load('c').status, 'missing')
        // 撞名:同一標記同一時戳再封存 → -1、-2
        two('e')
        assert.match(s.archive('e', ARCHIVE_TAGS.regen, 'T4'), /e\.state\.json\.regen-T4$/)
        two('e')
        assert.match(s.archive('e', ARCHIVE_TAGS.regen, 'T4'), /e\.state\.json\.regen-T4-1$/)
        two('e')
        assert.match(s.archive('e', ARCHIVE_TAGS.regen, 'T4'), /e\.state\.json\.regen-T4-2$/)
        assert.deepEqual(fs.readdirSync(`${d}/archive`).filter((f) => f.startsWith('e.state.prev.json')).sort(), ['e.state.prev.json.regen-T4', 'e.state.prev.json.regen-T4-1', 'e.state.prev.json.regen-T4-2'], '.prev 之封存檔亦不覆寫')
    })

    it('四態分流表 loadUsable:ok 可讀可寫(expectRev＝rev);recovered(壞檔或缺檔而由上一版讀出)可讀不可寫、why 指引修復;missing／corrupt／foreign／error 皆否且 why 載明', () => {
        const s = mk()
        fs.mkdirSync(s.dir, { recursive: true })
        const miss = s.loadUsable('none')
        assert.deepEqual([miss.status, miss.readable, miss.writable, miss.state, miss.expectRev, miss.why], ['missing', false, false, null, null, '狀態檔不存在'])
        s.save('k', st(1), { expectRev: null })
        s.save('k', st(2), { expectRev: 1 })
        const ok = s.loadUsable('k')
        assert.deepEqual([ok.status, ok.readable, ok.writable, ok.expectRev, ok.state.version, ok.why, ok.lost], ['ok', true, true, 2, 2, '', false])
        fs.writeFileSync(s.fileOf('k'), '{壞', 'utf8')
        const rec = s.loadUsable('k')
        assert.deepEqual([rec.status, rec.readable, rec.writable, rec.expectRev, rec.state.version, rec.lost], ['recovered', true, false, null, 1, false])
        assert.match(rec.why, /^狀態檔毀損，已由上一版讀出但尚未修復（跑一輪提煉段/)
        fs.rmSync(s.fileOf('k'))
        const lost = s.loadUsable('k')
        assert.deepEqual([lost.status, lost.readable, lost.writable, lost.lost], ['recovered', true, false, true])
        assert.match(lost.why, /^狀態檔遺失，已由上一版讀出但尚未修復/)
        fs.writeFileSync(s.fileOf('c'), 'not json', 'utf8')
        const cor = s.loadUsable('c')
        assert.deepEqual([cor.status, cor.readable, cor.writable, cor.state], ['corrupt', false, false, null])
        assert.match(cor.why, /^狀態檔毀損且無上一版可還原（JSON 解析失敗/)
        fs.writeFileSync(s.fileOf('f'), JSON.stringify({ v: STATE_VERSION + 1 }), 'utf8')
        const frn = s.loadUsable('f')
        assert.deepEqual([frn.status, frn.readable, frn.writable], ['foreign', false, false])
        assert.match(frn.why, /^狀態檔非本格式版本（格式版本 /)
        fs.mkdirSync(s.fileOf('dir'), { recursive: true })
        const err = s.loadUsable('dir')
        assert.deepEqual([err.status, err.readable, err.writable], ['error', false, false])
        assert.match(err.why, /^狀態檔讀取失敗（/)
    })

    it('嚴格驗形:鍵在場而錯型別＝壞檔(自 .prev 救回為 recovered、error 載明鍵;無 .prev 為 corrupt;原檔不動);缺鍵補預設不算壞檔', () => {
        const s = mk()
        s.save('k', st(1), { expectRev: null })
        s.save('k', st(2), { expectRev: 1 })
        const bad = JSON.stringify({ ...st(3), rev: 2, claims: 'x', seen: [] })
        fs.writeFileSync(s.fileOf('k'), bad, 'utf8')
        const r = s.load('k')
        assert.deepEqual([r.status, r.state.version], ['recovered', 1], '「鍵在場而錯型別 → 拋 CORRUPT_STATE_CODE,核心儲存分流為 corrupt、以上一版還原」')
        assert.match(r.error, /^核心狀態檔錯形狀（claims 應為陣列；seen 應為物件）/)
        assert.equal(fs.readFileSync(s.fileOf('k'), 'utf8'), bad, '原檔不動(隔離由呼叫端)')
        assert.ok(Number.isNaN(s.diskRev('k')), '錯形狀之檔不可被 CAS 覆寫')
        fs.writeFileSync(s.fileOf('lone'), JSON.stringify({ ...st(1), coreId: 'lone', version: '1' }), 'utf8')
        assert.deepEqual([s.load('lone').status, /version 應為非負整數/.test(s.load('lone').error)], ['corrupt', true])
        // 缺鍵:舊碼寫出之狀態檔缺後加之鍵(同一格式版本)→ 補預設(正式庫 .prev 乾跑:48 檔缺 seenConflicts／seen／withdrawn／lineage)
        const old = { ...st(4), coreId: 'old' }
        for (const k of ['seenConflicts', 'seen', 'withdrawn', 'lineage', 'renderHashes']) delete old[k]
        fs.writeFileSync(s.fileOf('old'), JSON.stringify(old), 'utf8')
        const o = s.load('old')
        assert.deepEqual([o.status, o.state.seenConflicts, o.state.seen, o.state.withdrawn, o.state.lineage, o.state.renderHashes], ['ok', [], {}, {}, null, []], '「缺鍵補預設(不算壞檔)」')
    })
})
