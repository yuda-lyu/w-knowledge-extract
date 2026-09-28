// unit-patrol-record.test.mjs — 巡檢紀錄＝事件庫之投影(2026-09-28):版面與冪等、舊檔遷移(累積空行、CRLF、只一次)、占位字不改寫、
//   寫入失敗不遺失、截斷自癒、推送失敗不影響成敗、巡檢鎖(同行程並發、有界等待、CLI 不等)、split 模式、事件庫壞行、路徑、節流
// 規格來源:安裝方〈建議w-knowledge-extract調整〉項 1～3 與雙審定案(tmp 全盤規劃 §11)
// 執行:npx mocha test/unit-patrol-record.test.mjs(暫存落 test/_tmp/patrol-record-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createPatrol, PATROL_MARK_TAIL } from '../src/ops/patrol.mjs'
import { acquireLock } from '../src/core/lock.mjs'
import { createClock } from '../src/util/clock.mjs'
import { memStore } from './tools/memStore.mjs'

const TMP = path.resolve(`test/_tmp/patrol-record-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴;after 清除
const real = createClock('Asia/Taipei')
// 凍結時鐘:同一組輸入之渲染須逐位元組相同(冪等),時刻不可每輪不同
const frozen = (() => {
    const iso = real.iso8()
    const st = real.stamp8()
    return { ...real, iso8: () => iso, getISO: () => iso, stamp8: () => st, getNow: () => st, date8: () => iso.slice(0, 10), day8: () => st.slice(0, 8) }
})()
const openStores = () => ({ docs: memStore(), notes: memStore(), relations: memStore(), cores: memStore(), sources: memStore(), frontier: memStore() })
let seq = 0
/** 每個案例一組獨立目錄(dirs.state 為事件史之單位) */
const newDir = () => {
    const dir = `${TMP}/c${seq++}`
    for (const d of ['log', 'state']) fs.mkdirSync(`${dir}/${d}`, { recursive: true })
    return dir
}
/** 同一目錄之巡檢器(問題以 settingsWarnings 注入,⑰ 之訊息即「設定不自洽：<字串>」) */
const mk = (dir, extra = {}) => createPatrol({
    dirs: { log: `${dir}/log`, state: `${dir}/state` },
    workDir: dir,
    clock: real,
    openStores,
    closeStores: async () => {},
    aiUsageToday: () => ({ used: 0, byKey: {}, chain: '', providers: [] }),
    recordFile: `${dir}/r.md`,
    notify: () => true,
    ...extra,
})
/** 寫一輪剛跑完之日誌:①不報,無注入問題時本輪即正常 */
const writeFreshRun = (dir) => {
    const st = real.stamp8()
    fs.mkdirSync(`${dir}/log/${st.slice(0, 8)}`, { recursive: true })
    fs.writeFileSync(`${dir}/log/${st.slice(0, 8)}/${st}-run.log`, `[${real.iso8()}] INFO  管道[知識管線] 結束，耗時 1.0s\n`, 'utf8')
}
const read = (f) => fs.readFileSync(f, 'utf8')
const tailOf = (md) => md.slice(md.indexOf(PATROL_MARK_TAIL) + PATROL_MARK_TAIL.length)
const eventsOf = (p) => read(p.paths.eventsFile).split('\n').filter(Boolean).map((l) => JSON.parse(l))

describe('unit-patrol-record', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    it('版面:MARK_TAIL 後恰一個空行接「## 異常事件」;無事件為「（尚無）」;同一輸入連寫 10 次位元組不變(此前每寫一次多一個空行)', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const p0 = mk(dir, { clock: frozen })
        assert.equal((await p0.patrolFromPipeline()).ok, true)
        assert.equal(tailOf(read(p0.recordFile)), '\n\n## 異常事件\n\n（尚無）\n', '無事件:同此前首次寫入之版面')
        const p = mk(dir, { clock: frozen, settingsWarnings: ['甲'] })
        await p.patrolFromPipeline()
        assert.equal(tailOf(read(p.recordFile)), `\n\n## 異常事件\n\n### ${frozen.iso8()}\n\n- 設定不自洽：甲\n`, '一則事件')
        const snaps = []
        for (let i = 0; i < 10; i++) {
            await p.patrolFromPipeline()
            snaps.push(read(p.recordFile))
        }
        assert.ok(snaps.every((s) => s === snaps[0]), '連寫 10 次位元組不變')
        assert.equal(eventsOf(p).filter((e) => e.type === 'event').length, 1, '同一組問題只入庫一次')
    })

    it('遷移:舊 md 之事件原文(含累積 1,020 行空白、CRLF)移入 legacy 且只做一次;新事件接其後;事件內文之「（尚無）」保留', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const legacy = '### 2026-09-01T10:00:00+08:00\n\n- 舊問題（尚無）A\n\n### 2026-09-02T10:00:00+08:00\n\n- 舊問題 B'
        const old = `# 監控運維紀錄\n\n舊總覽\n${PATROL_MARK_TAIL}${'\n'.repeat(1020)}## 異常事件\n\n\n${legacy}\n`
        fs.writeFileSync(`${dir}/r.md`, old.replace(/\n/g, '\r\n'), 'utf8')
        const p = mk(dir, { settingsWarnings: ['新問題'] })
        const r = await p.patrolFromPipeline()
        assert.equal(r.ok, true)
        const t = tailOf(read(p.recordFile))
        assert.ok(t.startsWith(`\n\n## 異常事件\n\n${legacy}\n\n### `), `遷移後恰一個空行、舊事件原文在前:${JSON.stringify(t.slice(0, 160))}`)
        assert.match(t, /\n\n- 設定不自洽：新問題\n$/)
        assert.equal(read(p.paths.legacyFile), `${legacy}\n`)
        const evs = eventsOf(p)
        assert.deepEqual(evs.map((e) => e.type), ['migrated', 'event'])
        assert.equal(evs[0].key, '', '遷移標記 key 為空字串:升版後首輪之持續性問題必入庫一則')
        await p.patrolFromPipeline()
        await mk(dir).patrolFromPipeline()
        assert.equal(read(p.recordFile).split('舊問題 B').length - 1, 1, '舊事件不重複')
        assert.equal(eventsOf(p).filter((e) => e.type === 'migrated').length, 1, '遷移只做一次')
    })

    it('舊 md 無事件(「（尚無）」)或不存在:不建 legacy;事件內文含「（尚無）」者之後續追加不改寫它(此前占位字取代未錨定)', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        fs.writeFileSync(`${dir}/r.md`, `${PATROL_MARK_TAIL}\n\n\n\n## 異常事件\n\n（尚無）\n`, 'utf8')
        const p = mk(dir, { settingsWarnings: ['值為（尚無）時'] })
        await p.patrolFromPipeline()
        assert.ok(!fs.existsSync(p.paths.legacyFile), '只有占位字:無舊事件')
        await mk(dir, { settingsWarnings: ['另一問題'] }).patrolFromPipeline()
        const t = tailOf(read(p.recordFile))
        assert.match(t, /^\n\n## 異常事件\n\n### .+\n\n- 設定不自洽：值為（尚無）時\n\n### .+\n\n- 設定不自洽：另一問題\n$/)
    })

    it('紀錄 md 寫入失敗:回 ok:false、recordWritten:false、不留暫存檔;修復後下一輪補上該則(先入庫後寫狀態:此前狀態先寫而永不入檔)', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const p = mk(dir, { settingsWarnings: ['甲'] })
        await mk(dir).patrolFromPipeline() // 先完成遷移(正常輪)
        fs.rmSync(p.recordFile)
        fs.mkdirSync(p.recordFile) // 同名目錄使寫入失敗
        const r = await p.patrolFromPipeline()
        assert.equal(r.ok, false)
        assert.equal(r.recordWritten, false)
        assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], '暫存檔已清')
        fs.rmSync(p.recordFile, { recursive: true })
        const r2 = await p.patrolFromPipeline()
        assert.equal(r2.ok, true)
        assert.equal(r2.result.repeated, true, '同一組問題:本輪不再入庫')
        assert.match(tailOf(read(p.recordFile)), /- 設定不自洽：甲\n$/, '失敗那輪之事件仍在(事件庫為真理)')
        assert.equal(eventsOf(p).filter((e) => e.type === 'event').length, 1)
    })

    it('蒐集拋錯或事件庫無法讀取:收尾回 ok:false、不入庫不寫狀態、鎖已釋放;runCli reject(推送以外之失敗照舊外拋)', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const bad = mk(dir, {
            settingsWarnings: ['甲'],
            openStores: () => {
                throw new Error('資料庫開不起來')
            },
        })
        const r = await bad.patrolFromPipeline()
        assert.deepEqual([r.ok, r.recordWritten, r.error], [false, false, '資料庫開不起來'])
        assert.equal(eventsOf(bad).filter((e) => e.type === 'event').length, 0, '蒐集失敗不入庫')
        assert.ok(!fs.existsSync(`${dir}/state/patrol-state.json`), '不寫節流狀態')
        assert.ok(!fs.existsSync(bad.paths.lockFile), '鎖已釋放')
        await assert.rejects(() => bad.runCli(['--force']), /資料庫開不起來/)
        const d2 = newDir()
        const p = mk(d2)
        fs.mkdirSync(p.paths.eventsFile) // 事件庫路徑被占用(讀取失敗且非不存在)
        const r2 = await p.patrolFromPipeline()
        assert.deepEqual([r2.ok, r2.recordWritten], [false, false])
        assert.match(r2.error, /EISDIR|illegal operation on a directory/)
        assert.ok(!fs.existsSync(p.recordFile), '不以空事件史覆寫紀錄')
    })

    it('紀錄 md 被截斷或手改:下一輪由事件庫整份重建(此前歷史只存在 md,截斷即全失)', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const p = mk(dir, { settingsWarnings: ['甲'] })
        await p.patrolFromPipeline()
        fs.writeFileSync(p.recordFile, read(p.recordFile).slice(0, 50), 'utf8')
        await mk(dir, { settingsWarnings: ['乙'] }).patrolFromPipeline()
        assert.match(tailOf(read(p.recordFile)), /- 設定不自洽：甲\n\n### .+\n\n- 設定不自洽：乙\n$/)
    })

    it('推送失敗(自訂 notify 拋錯)不影響成敗:ok、紀錄已寫,錯誤記入 pushError;runCli 不 reject;notify 回 false 視為未送出', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const r = await mk(dir, {
            notify: () => {
                throw new Error('推送端故障')
            },
        }).patrolFromPipeline()
        assert.deepEqual([r.ok, r.recordWritten, r.result.pushed, r.result.pushError], [true, true, false, '推送端故障'], '此前回 ok:false 且日誌稱「監控紀錄停留在上一輪」')
        const c = await mk(dir, {
            notify: async () => {
                throw new Error('非同步故障')
            },
        }).runCli(['--force'])
        assert.equal(c.pushError, '非同步故障', '此前 runCli 整個 reject')
        const f = await mk(dir, { notify: () => false }).patrolFromPipeline()
        assert.deepEqual([f.result.pushed, f.result.pushError], [false, ''])
    })

    it('同一行程兩個巡檢並發:依序執行(後者等鎖),同一組問題只入庫一次(此前各自讀改寫而重複追加);鎖已釋放', async function() {
        this.timeout(30_000)
        const dir = newDir()
        writeFreshRun(dir)
        const p = mk(dir, { settingsWarnings: ['甲'] })
        const [a, b] = await Promise.all([p.patrolFromPipeline(), p.patrolFromPipeline()])
        assert.deepEqual([a.ok, a.recordWritten, b.ok, b.recordWritten], [true, true, true, true])
        assert.equal(eventsOf(p).filter((e) => e.type === 'event').length, 1)
        assert.equal([a, b].filter((x) => x.result.repeated).length, 1, '後者判為重複')
        assert.ok(!fs.existsSync(p.paths.lockFile))
    })

    it('巡檢鎖被占用:管線收尾每秒一探、逾 lockWaitMs 略過且不寫任何檔;CLI 不等即回 null;釋放後恢復', async function() {
        this.timeout(30_000)
        const dir = newDir()
        writeFreshRun(dir)
        const p = mk(dir, { lockWaitMs: 1500 })
        const held = acquireLock(p.paths.lockFile, { staleMs: 60_000 })
        assert.equal(held.ok, true)
        const t0 = Date.now()
        const r = await p.patrolFromPipeline()
        const waited = Date.now() - t0
        assert.deepEqual([r.ok, r.skipped, r.recordWritten], [true, 'locked', false])
        assert.match(r.message, /^另一巡檢進行中，等候 2s 仍未取得巡檢鎖（/)
        assert.ok(waited >= 1400 && waited < 5000, `等候 ${waited}ms`)
        assert.ok(!fs.existsSync(p.recordFile), '略過時不寫紀錄')
        assert.ok(!fs.existsSync(p.paths.eventsFile), '略過時不動事件庫')
        const t1 = Date.now()
        assert.equal(await p.runCli(['--force']), null)
        assert.ok(Date.now() - t1 < 1000, 'CLI 不等鎖')
        held.release()
        assert.equal((await p.patrolFromPipeline()).recordWritten, true)
    })

    it('split 模式:主檔只列最新一則、歷史檔(預設 <主檔名>-歷史.md)列全部,兩檔同以 MARK_TAIL 分區;尚無新事件時主檔取舊事件之末則', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        await mk(dir, { recordMode: 'split', settingsWarnings: ['甲'] }).patrolFromPipeline()
        const p = mk(dir, { recordMode: 'split', settingsWarnings: ['乙'] })
        await p.patrolFromPipeline()
        assert.equal(p.recordMode, 'split')
        assert.equal(p.paths.historyFile, path.resolve(`${dir}/r-歷史.md`))
        assert.match(tailOf(read(p.recordFile)), /^\n\n## 異常事件\n\n### .+\n\n- 設定不自洽：乙\n$/, '主檔只列最新一則')
        assert.match(read(p.recordFile), /本檔只列最新一則，完整歷史見 r-歷史\.md/)
        const hist = read(p.paths.historyFile)
        assert.ok(hist.includes(PATROL_MARK_TAIL), '歷史檔同以 MARK_TAIL 分區(解析端可共用)')
        assert.match(tailOf(hist), /^\n\n## 異常事件\n\n### .+\n\n- 設定不自洽：甲\n\n### .+\n\n- 設定不自洽：乙\n$/)

        const d2 = newDir()
        writeFreshRun(d2)
        fs.writeFileSync(`${d2}/r.md`, `${PATROL_MARK_TAIL}\n\n## 異常事件\n\n### 2026-09-01T00:00:00+08:00\n\n- 舊甲\n\n### 2026-09-02T00:00:00+08:00\n\n- 舊乙\n`, 'utf8')
        const q = mk(d2, { recordMode: 'split' })
        await q.patrolFromPipeline()
        assert.equal(tailOf(read(q.recordFile)), '\n\n## 異常事件\n\n### 2026-09-02T00:00:00+08:00\n\n- 舊乙\n')
        assert.match(tailOf(read(q.paths.historyFile)), /舊甲[\s\S]*舊乙/)
    })

    it('recordMode 非 full／split、historyFile 與主檔相同:建構期拋錯;null 視為未給', () => {
        const dir = newDir()
        assert.throws(() => mk(dir, { recordMode: 'latest' }), /recordMode 須為 'full' 或 'split'，收到 "latest"/)
        assert.throws(() => mk(dir, { recordMode: 'split', historyFile: `${dir}/r.md` }), /historyFile 不可與 recordFile 相同/)
        assert.equal(mk(dir, { recordMode: null }).recordMode, 'full')
        assert.equal(mk(dir, { recordMode: 'split', historyFile: `${dir}/h.md` }).paths.historyFile, path.resolve(`${dir}/h.md`))
    })

    it('事件庫末行被截斷:壞行略過並計數(不中斷),新紀錄另起一行而非黏在殘行後', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const p = mk(dir, { settingsWarnings: ['甲'] })
        await p.patrolFromPipeline()
        fs.appendFileSync(p.paths.eventsFile, '{"v":1,"type":"event","at":"2026', 'utf8')
        const r = await mk(dir, { settingsWarnings: ['乙'] }).patrolFromPipeline()
        assert.equal(r.ok, true)
        assert.equal(r.result.skippedLines, 1)
        assert.ok(r.result.info.some((x) => /事件庫有 1 行無法解析而略過/.test(x)))
        const last = read(p.paths.eventsFile).split('\n').filter(Boolean).at(-1)
        assert.equal(JSON.parse(last).issues[0], '設定不自洽：乙')
        assert.match(tailOf(read(p.recordFile)), /甲[\s\S]*乙/)
    })

    it('paths 為實際讀寫之絕對路徑;巡檢鎖一律落 dirs.state(此前隨 dirs.tmp 有無漂移,兩實例各取一把)', () => {
        const dir = newDir()
        const a = mk(dir)
        const b = createPatrol({ dirs: { log: `${dir}/log`, state: `${dir}/state`, tmp: `${dir}/tmp` }, clock: real, openStores, closeStores: async () => {} })
        assert.equal(a.paths.lockFile, path.resolve(`${dir}/state/patrol.lock`))
        assert.equal(b.paths.lockFile, a.paths.lockFile)
        assert.equal(a.paths.eventsFile, path.resolve(`${dir}/state/patrol-events.jsonl`))
        assert.equal(a.paths.historyFile, null)
        for (const v of Object.values(a.paths).filter(Boolean)) assert.ok(path.isAbsolute(v), v)
    })

    it('runCli 節流在巡檢鎖內判定:剛巡檢過未達間隔回 null,--force 略過節流', async () => {
        const dir = newDir()
        writeFreshRun(dir)
        const p = mk(dir)
        assert.ok(await p.runCli([]))
        assert.equal(await p.runCli([]), null)
        assert.ok(await p.runCli(['--force']))
    })

})
