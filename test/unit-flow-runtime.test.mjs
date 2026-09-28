// unit-flow-runtime.test.mjs — 總組裝之執行期接線(2026-09-28):同行程並發 run() 互斥、report.afterRun 結構化結果、開工標記、
//   收尾日誌三態、生效值單一來源(info() 與實際使用同源、舊名不再蓋掉頂層)、cfg.lock 值域
// 規格來源:安裝方〈建議w-knowledge-extract調整〉項 3、4、6 與雙審定案(tmp 全盤規劃 §11)
// 執行:npx mocha test/unit-flow-runtime.test.mjs(暫存落 test/_tmp/flow-runtime-<pid>,測完即刪;真 LMDB、不發網路)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createKnowledgeExtract } from '../src/core/createKnowledgeExtract.mjs'
import { readRunStart } from '../src/ops/runSummary.mjs'
import { setConceptFold } from '../src/util/text.mjs'
import { stubAi } from './tools/stubAi.mjs'

const TMP = path.resolve(`test/_tmp/flow-runtime-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴;after 清除
const MIN = 60_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 以空轉管線建構 flow(真 LMDB、索引段照跑);logFactory 收集每輪之日誌行(「層級 訊息」),logs[i] 為第 i 輪
 *
 * @param {String} name 輸入案例名(workDir 子目錄)
 * @param {Object} [extra={}] 輸入覆寫之 cfg
 * @returns {Object} 回傳 { flow, logs }
 */
const mkFlow = (name, extra = {}) => {
    const logs = []
    const flow = createKnowledgeExtract({
        workDir: `${TMP}/${name}`,
        aiAdapter: stubAi,
        pipeline: [{
            name: '空轉',
            run: async () => {
                await sleep(200)
                return { ok: true, summary: '空轉' }
            },
        }],
        logFactory: () => {
            const lines = []
            logs.push(lines)
            const w = (lv) => (m) => lines.push(`${lv} ${m}`)
            return { info: w('INFO'), warn: w('WARN'), error: w('ERROR'), log: w('INFO'), now: '' }
        },
        ...extra,
    })
    return { flow, logs }
}

describe('unit-flow-runtime', function() {

    this.timeout(60_000)

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        setConceptFold(null) // createKnowledgeExtract 會注入模組級 opencc 折疊,不留給同 worker 之他檔
    })

    it('同一 flow 並發兩次 run():恰一輪執行、另一輪 lockSkipped(此前同 pid 一律放行,兩條管線同時寫同一個資料庫)', async () => {
        const { flow } = mkFlow('conc', { afterRun: false })
        const [a, b] = await Promise.all([flow.run(), flow.run()])
        assert.deepEqual([a, b].map((r) => !!r.lockSkipped).sort(), [false, true])
        assert.match([a, b].find((r) => r.lockSkipped).stopReason, /^本行程已持有此鎖（/)
        assert.equal([a, b].find((r) => !r.lockSkipped).ok, true)
        assert.ok(!fs.existsSync(flow.info().lockFile), '執行鎖已釋放')
    })

    it('預設收尾(巡檢):report.afterRun 為結構化結果;開工標記記本輪上限;頂層上限不再被舊名 monitor.scheduleLimitMin 蓋掉,不一致揭露於日誌與 ⑰', async () => {
        const { flow, logs } = mkFlow('patrol', { scheduleLimitMin: 480, monitor: { scheduleLimitMin: 60, notify: () => true } })
        const rep = await flow.run()
        assert.deepEqual([rep.afterRun.ok, rep.afterRun.recordWritten, rep.afterRun.result.pushed], [true, true, true], '此前 afterRun 之回傳被丟棄')
        const st = readRunStart(rep.summaryFile.replace(/\.json$/, '.start.json'))
        assert.deepEqual([st.limitMin, st.scheduleLimitMin, st.deadlineMs, st.lockStaleMs, st.pid], [480, 480, 474 * MIN, 485 * MIN, process.pid])
        assert.ok(logs[0].some((l) => /^INFO 收尾完成（[\d.]+s）$/.test(l)), logs[0].join('\n'))
        const conflict = 'cfg.scheduleLimitMin（480）與舊名 cfg.monitor.scheduleLimitMin（60）不同，以頂層為準'
        assert.ok(logs[0].some((l) => l.startsWith(`WARN 啟動期檢核：${conflict}`)))
        assert.ok(rep.afterRun.result.issues.some((x) => x.startsWith(`設定不自洽：${conflict}`)))
        assert.equal(flow.info().patrol.scheduleLimitMin, 480, '巡檢判界取頂層(此前展開 monitor 時被 60 蓋掉)')
    })

    it('收尾日誌分完成／略過／失敗,失敗時依 recordWritten 說明紀錄是否已更新;推送失敗另記一行;鉤子拋錯記入 report.afterRun', async () => {
        const cases = [
            [{ ok: false, error: '寫檔失敗', recordWritten: false }, /^WARN 收尾失敗：寫檔失敗（管線本身不受影響；監控紀錄停留在上一輪）$/],
            [{ ok: false, error: '其後失敗', recordWritten: true }, /^WARN 收尾失敗：其後失敗（管線本身不受影響；監控紀錄已更新）$/],
            [{ ok: true, skipped: 'locked', message: '另一巡檢進行中', recordWritten: false }, /^WARN 收尾略過：另一巡檢進行中（[\d.]+s；監控紀錄停留在上一輪）$/],
            [{ ok: true, recordWritten: true, result: { pushError: 'HTTP 400' } }, /^WARN 巡檢推送失敗：HTTP 400（紀錄已落地，不影響本輪）$/],
        ]
        for (const [i, [ret, re]] of cases.entries()) {
            const { flow, logs } = mkFlow(`end${i}`, { afterRun: () => ret })
            const rep = await flow.run()
            assert.equal(rep.afterRun, ret, 'report.afterRun 為收尾鉤子之回傳值')
            assert.ok(logs[0].some((l) => re.test(l)), `案例 ${i}:\n${logs[0].join('\n')}`)
        }
        const { flow, logs } = mkFlow('endThrow', {
            afterRun: () => {
                throw new Error('鉤子壞了')
            },
        })
        const rep = await flow.run()
        assert.deepEqual(rep.afterRun, { ok: false, error: '鉤子壞了' })
        assert.ok(logs[0].includes('WARN 收尾鉤子拋錯：鉤子壞了'))
    })

    it('info():envFile／lockFile 為絕對路徑且與實際使用同源;注入 aiAdapter 時 aiWorkspace 為 null;cfg.lock:true 用預設路徑(此前每輪拋錯);其餘型別建構期拋錯', async () => {
        const { flow } = mkFlow('info', { lock: true, envFile: 'sec/.env', scheduleLimitMin: '65', afterRun: false })
        const i = flow.info()
        assert.equal(i.envFile, path.resolve(`${TMP}/info/sec/.env`))
        assert.equal(i.lockFile, path.resolve(`${TMP}/info/tmp/run.lock`))
        assert.equal(i.aiWorkspace, null, '注入 aiAdapter 時不使用 AI 工作區')
        assert.deepEqual([i.scheduleLimitMin, i.deadlineMs, i.lockStaleMs], [65, 59 * MIN, 70 * MIN], '數字字串之上限取數')
        assert.equal(i.patrol.scheduleLimitMin, 65)
        assert.equal(i.patrol.paths.lockFile, path.resolve(`${TMP}/info/state/patrol.lock`))
        const rep = await flow.run()
        assert.deepEqual([rep.ok, !!rep.lockSkipped, !!rep.aborted], [true, false, false], 'cfg.lock:true 可正常取鎖')
        assert.equal(mkFlow('nolock', { lock: false }).flow.info().lockFile, null)
        assert.throws(() => mkFlow('badlock', { lock: 123 }), /cfg\.lock 須為 false（不上鎖）、true 或未給/)
    })

})
