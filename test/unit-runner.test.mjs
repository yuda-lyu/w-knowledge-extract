// unit-runner.test.mjs — 執行殼層（第二入口 taskRunner）之回歸測試：消費端（排程殼）呼叫之 19＋4 個 API 與合併後之共用件
// 執行：npx mocha test/unit-runner.test.mjs（不發網路、不呼叫 AI；runJsonCli 一案會真的 spawn 一支暫存 node 腳本；暫存落 test/_tmp/runner-<pid>，測完即刪）

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import W from '../src/taskRunner.mjs'
import { createAiAdapter } from '../src/ai/adapter.mjs'
import { createClock } from '../src/util/clock.mjs'
import { createPatrol } from '../src/ops/patrol.mjs'
import { memStore } from './tools/memStore.mjs'

const TMP = path.resolve(`test/_tmp/runner-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除

/** 收集記錄器（log／logWarn／logError 介面）:不落檔不印 */
const capLogger = () => {
    const lines = []
    const mk = (lv) => (m) => lines.push(`${lv} ${m}`)
    return { lines, log: mk('INFO'), logWarn: mk('WARN'), logError: mk('ERROR') }
}
const slash = (p) => String(p).replace(/\\/g, '/')

describe('unit-runner', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    it('入口：消費端（排程殼）呼叫之 19 個 API＋4 個匯出面成員皆存在（第二入口 taskRunner.mjs）', () => {
        const names = ['createSettingsHolder', 'createTime', 'oneline', 'cliFailDetail', 'createRunLogger', 'escapeHtml', 'firstLineClamp',
            'createTelegramNotifier', 'runJsonCli', 'createUsageCounter', 'createAiCaller', 'createFileStore', 'parseIndexList', 'parseJsonArray',
            'makeArrayCoverageValidator', 'logAiOutcome', 'createAiEventLogger', 'runTask', 'installProcessGuards',
            'loadSettings', 'decorateSettings', 'readEnvFile']
        for (const n of names) assert.equal(typeof W[n], 'function', `W.${n}`)
        assert.equal(typeof W.DF_DIRS, 'object')
        assert.equal(W.TELEGRAM_TEXT_MAX, 4096)
    })

    it('clock：createClock 同時具本套件與執行殼兩套方法名（同一物件）；createTime 為預設 Asia/Taipei 之別名', () => {
        const c = createClock('Asia/Taipei')
        for (const n of ['iso8', 'stamp8', 'date8', 'day8', 'getISO', 'getNow', 'getDay', 'getDate', 'formatTime', 'getTimestamp']) assert.equal(typeof c[n], 'function', n)
        assert.equal(c.timeZone, 'Asia/Taipei')
        const now = c.getNow()
        assert.match(now, /^\d{14}$/)
        assert.equal(c.getDay(now), now.slice(0, 8), 'getDay(stamp) 純切片')
        assert.equal(c.getDay(), c.day8())
        assert.equal(c.getDate(0), c.date8())
        assert.match(c.getDate(-1), /^\d{4}-\d{2}-\d{2}$/)
        assert.notEqual(c.getDate(-1), c.getDate(0))
        assert.equal(c.formatTime('20260808214408'), '2026/08/08 21:44')
        assert.match(c.getTimestamp(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        assert.match(c.getISO(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
        assert.equal(W.createTime().timeZone, 'Asia/Taipei')
        assert.equal(W.createTime('UTC').getISO().slice(-6), '+00:00')
        assert.throws(() => createClock(), /IANA/, '本套件內部用 createClock:時區必填')
    })

    it('oneline：壓平空白；超長補刪節號（長度 n＋3）、未超長原樣（與 w-data-pipeline 同行為）', () => {
        assert.equal(W.oneline('a\n  b\tc'), 'a b c')
        const r = W.oneline('x'.repeat(250), 200)
        assert.equal(r.length, 203)
        assert.ok(r.endsWith('...'))
        assert.equal(W.oneline('short', 200), 'short')
        assert.equal(W.oneline(null), '')
    })

    it('cliFailDetail／firstLineClamp／escapeHtml', () => {
        assert.equal(W.cliFailDetail({ attempts: 3, stderr: 'boom\nat x' }), '，共試 3 次 → boom at x')
        assert.equal(W.cliFailDetail({}), '')
        assert.equal(W.cliFailDetail({ attempts: 1 }), '，共試 1 次')
        assert.equal(W.firstLineClamp('標題\n副標', 100), '標題')
        const long = W.firstLineClamp('x'.repeat(120), 100)
        assert.equal(long.length, 100, '回傳長度嚴格不超過 max（含刪節號）')
        assert.ok(long.endsWith('...'))
        assert.equal(W.escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d')
        assert.equal(W.escapeHtml('&lt;'), '&amp;lt;', '& 先轉，才不會把後續產生的 &lt; 二次轉義')
        assert.equal(W.escapeHtml('"q"'), '"q"', '只轉三個字元，引號不轉')
        assert.equal(W.escapeHtml(null), '')
    })

    it('createRunLogger：open 前不落檔（只回 stdout，echo:false 靜音）；open 後檔名 {root}/{day}/{runId}.log；別名與 withTag；可帶尾碼', () => {
        const root = `${TMP}/log-run`
        const c = createClock('Asia/Taipei')
        const lg = W.createRunLogger({ root, getISO: c.getISO, echo: false })
        assert.equal(lg.file, null)
        assert.doesNotThrow(() => lg.logError('before open'), 'open 前記錄不拋錯（行程安全網要在最早期掛上）')
        const f = lg.open('20260921120000')
        assert.equal(slash(f), `${root}/20260921/20260921120000.log`)
        assert.equal(lg.file, f)
        lg.log('a'); lg.logWarn('b'); lg.logError('c'); lg.info('d'); lg.warn('e'); lg.error('f')
        lg.withTag('步驟1：').log('g')
        lg.withTag('步驟2：').warn('h')
        const text = fs.readFileSync(f, 'utf8')
        assert.doesNotMatch(text, /before open/)
        for (const re of [/\] INFO {2}a\n/, /\] WARN {2}b\n/, /\] ERROR c\n/, /\] INFO {2}d\n/, /\] WARN {2}e\n/, /\] ERROR f\n/, /\] INFO {2}步驟1：g\n/, /\] WARN {2}步驟2：h\n/]) assert.match(text, re)
        assert.equal(slash(lg.open('20260921130000', '20260921', 'run')), `${root}/20260921/20260921130000-run.log`)
        assert.throws(() => W.createRunLogger({ root }), /getISO/)
        assert.throws(() => W.createRunLogger({ getISO: c.getISO }), /root/)
    })

    it('createLogger（本套件工廠）：建構即開檔 {dir}/{day}/{stamp}-{name}.log；now／elapsed；cliFail 委派 cliFailDetail', () => {
        const dir = `${TMP}/log-kns`
        const c = createClock('Asia/Taipei')
        const lg = W.createLogger('run', { dir, clock: c, echo: false })
        assert.match(lg.now, /^\d{14}$/)
        assert.equal(slash(lg.file), `${dir}/${lg.now.slice(0, 8)}/${lg.now}-run.log`)
        lg.info('hello')
        lg.withTag('T:').error('bad')
        assert.match(fs.readFileSync(lg.file, 'utf8'), /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] INFO {2}hello\n\[[^\]]+\] ERROR T:bad\n$/)
        assert.match(lg.elapsed(), /^\d+\.\d$/)
        assert.equal(lg.cliFail({ error: 'Exit code 1', attempts: 2, stderr: 'ENOENT x' }), 'Exit code 1，共試 2 次 → ENOENT x')
        assert.equal(lg.cliFail(null), 'unknown')
        assert.throws(() => W.createLogger('x', {}), /dir, clock/)
    })

    it('runTask：起訖行寫在 finally（成敗皆有「完成，總耗時」）；失敗記異常、呼叫 onError、onError 自身失敗只記錄；ensureDirs；回傳形狀；與 createRunLogger 接線', async () => {
        const lg = capLogger()
        const ok = await W.runTask({
            name: '任務',
            logger: lg,
            runId: 'r1',
            run: async (ctx) => {
                assert.equal(ctx.runId, 'r1'); ctx.log('inside'); ctx.logWarn('w'); return 42
            }
        })
        assert.equal(ok.ok, true); assert.equal(ok.result, 42); assert.equal(ok.runId, 'r1'); assert.equal(ok.error, null); assert.equal(ok.logFile, null)
        assert.ok(Number.isFinite(ok.durationMs))
        assert.deepEqual(lg.lines.map((l) => l.replace(/\d+\.\ds/, 'Ns')), ['INFO 任務啟動', 'INFO inside', 'WARN w', 'INFO 任務完成，總耗時 Ns'])

        const lg2 = capLogger()
        let notified = null
        const bad = await W.runTask({
            name: 'X',
            logger: lg2,
            getNow: () => '20260921120000',
            ensureDirs: [`${TMP}/ensured/a`],
            onError: async (e) => {
                notified = e.message; throw new Error('tg down')
            },
            run: async () => {
                throw new Error('boom')
            },
        })
        assert.equal(bad.ok, false); assert.equal(bad.error.message, 'boom'); assert.equal(bad.runId, '20260921120000', 'runId 未給時以 getNow 產生')
        assert.equal(notified, 'boom')
        assert.ok(fs.existsSync(`${TMP}/ensured/a`), 'ensureDirs 於開工前建立')
        assert.deepEqual(lg2.lines.map((l) => l.replace(/\d+\.\ds/, 'Ns')), ['INFO X啟動', 'ERROR X異常：boom', 'ERROR X失敗通知也失敗：tg down', 'INFO X完成，總耗時 Ns'])

        const c = createClock('Asia/Taipei')
        const rl = W.createRunLogger({ root: `${TMP}/log-task`, getISO: c.getISO, echo: false })
        const r3 = await W.runTask({ logger: rl, runId: '20260921120000', run: async () => {} })
        assert.equal(slash(r3.logFile), `${TMP}/log-task/20260921/20260921120000.log`, 'openLog 預設以 runId 開檔')
        assert.match(fs.readFileSync(r3.logFile, 'utf8'), /任務啟動\n[\s\S]*任務完成，總耗時/)
        await assert.rejects(() => W.runTask({ logger: rl }), /需要 run/)
        await assert.rejects(() => W.runTask({ logger: rl, run: async () => {} }), /runId 或 getNow/)
        await assert.rejects(() => W.runTask({ run: async () => {}, runId: 'x' }), /需要 logger/)
    })

    it('installProcessGuards：掛上 uncaughtException／unhandledRejection 各一，解除函數移除之；缺 onFatal 拋錯', () => {
        const a = process.listenerCount('uncaughtException')
        const b = process.listenerCount('unhandledRejection')
        const off = W.installProcessGuards({ onFatal: () => {} })
        assert.equal(process.listenerCount('uncaughtException'), a + 1)
        assert.equal(process.listenerCount('unhandledRejection'), b + 1)
        off()
        assert.equal(process.listenerCount('uncaughtException'), a)
        assert.equal(process.listenerCount('unhandledRejection'), b)
        assert.throws(() => W.installProcessGuards({}), /onFatal/)
    })

    it('createTelegramNotifier：!res.ok 自行拋出並重試 maxRetries 次；enable:false 乾跑；物件轉 JSON；timeoutMs 帶 signal（fetch 以替身攔截，不發網路）', async () => {
        const calls = []
        const realFetch = globalThis.fetch
        let failTimes = 0
        globalThis.fetch = async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body), hasSignal: !!init.signal })
            if (failTimes > 0) {
                failTimes--; return { ok: false, status: 400, statusText: 'Bad Request', text: async () => 'can\'t parse entities' }
            }
            return { ok: true, status: 200, statusText: 'OK', text: async () => '' }
        }
        try {
            const n = W.createTelegramNotifier({ token: 'T', chatId: 'C', maxRetries: 1, timeoutMs: 5000, apiBase: 'https://example.invalid' })
            assert.equal(await n.send('hi'), 'ok')
            assert.equal(calls[0].url, 'https://example.invalid/botT/sendMessage')
            assert.deepEqual(calls[0].body, { chat_id: 'C', text: 'hi', parse_mode: 'HTML' })
            assert.equal(calls[0].hasSignal, true)
            assert.equal(await n.send({ a: 1 }), 'ok')
            assert.deepEqual(JSON.parse(calls[1].body.text), { a: 1 })
            failTimes = 1
            assert.equal(await n.send('retry-ok'), 'ok')
            assert.equal(calls.length, 4, '首次 400 後重試一次成功')
            failTimes = 5
            await assert.rejects(() => n.send('always-fail'), /HTTP 400 Bad Request: can't parse entities/)
            assert.equal(calls.length, 6, 'maxRetries 1 → 最多送 2 次後 reject')
            failTimes = 0 // 上一案殘量歸零,否則下一個 send 會先吃到失敗再重試(記帳失準)
            const plain = W.createTelegramNotifier({ token: 'T', chatId: 'C' })
            await plain.send('no-timeout')
            assert.equal(calls[6].hasSignal, false, '未給 timeoutMs 即不設（與原實作同）')
            const dry = W.createTelegramNotifier({ token: 'T', chatId: 'C', enable: false })
            assert.equal(await dry.send('x'), '未啟用發送訊息')
            assert.equal(dry.enable, false)
            assert.equal(calls.length, 7, '乾跑不發送')
            await assert.rejects(() => plain.send('x'.repeat(W.TELEGRAM_TEXT_MAX + 1)), /訊息 4097 字元超過 Telegram 單則上限 4096/)
            assert.equal(calls.length, 7, '超長 fail-fast：不發請求、不重試（同樣長度重試必再敗）')
            assert.equal(await plain.send('x'.repeat(W.TELEGRAM_TEXT_MAX)), 'ok', '剛好上限可送')
            assert.throws(() => W.createTelegramNotifier({ chatId: 'C' }), /token/)
            assert.throws(() => W.createTelegramNotifier({ token: 'T' }), /chatId/)
        }
        finally {
            globalThis.fetch = realFetch
        }
    })

    it('patrol 推送改走共用 notifier：envFile 有 TELEGRAM_* 才送、parse_mode HTML、內文經 escapeHtml；送出失敗仍回 {ok:true}（推送是附加功能）', async () => {
        const calls = []
        const realFetch = globalThis.fetch
        let okResp = true
        globalThis.fetch = async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body) }); return { ok: okResp, status: okResp ? 200 : 400, statusText: '', text: async () => '' }
        }
        try {
            const dir = `${TMP}/patrol`
            for (const d of ['log', 'state', 'tmp']) fs.mkdirSync(`${dir}/${d}`, { recursive: true })
            const envFile = `${dir}/.env`
            fs.writeFileSync(envFile, 'TELEGRAM_BOT_TOKEN=tk\nTELEGRAM_CHAT_ID=42\n', 'utf8')
            const clock = createClock('Asia/Taipei')
            const openStores = () => ({ docs: memStore(), notes: memStore(), relations: memStore(), cores: memStore(), sources: memStore(), frontier: memStore() })
            const mk = (extra) => createPatrol({ dirs: { log: `${dir}/log`, state: `${dir}/state`, tmp: `${dir}/tmp` }, workDir: dir, clock, openStores, closeStores: async () => {}, aiUsageToday: () => ({ used: 0, byKey: {}, chain: '', providers: [] }), recordFile: `${dir}/r.md`, ...extra })
            assert.deepEqual(await mk({}).patrolFromPipeline(), { ok: true })
            assert.equal(calls.length, 0, '無 envFile → 靜默略過')
            assert.deepEqual(await mk({ envFile }).patrolFromPipeline(), { ok: true })
            assert.equal(calls.length, 1)
            assert.equal(calls[0].url, 'https://api.telegram.org/bottk/sendMessage')
            assert.equal(calls[0].body.chat_id, '42')
            assert.equal(calls[0].body.parse_mode, 'HTML')
            assert.match(calls[0].body.text, /^(✅|⚠️) 知識庫巡檢 /, '推送標題為領域中立之「知識庫巡檢」')
            assert.doesNotMatch(calls[0].body.text, /[<>]|&(?!amp;|lt;|gt;)/, '內文已轉義：不得有裸 < > 或非實體之 &')
            okResp = false
            assert.deepEqual(await mk({ envFile }).patrolFromPipeline(), { ok: true }, '推送失敗不影響巡檢')
            assert.equal(calls.length, 2, '巡檢推送不重試（maxRetries 0）')
        }
        finally {
            globalThis.fetch = realFetch
        }
    })

    it('parseIndexList：取數字最多的一串、忽略敘述內孤立數字、單一 0＝空集合、max／topN', () => {
        assert.deepEqual(W.parseIndexList('3,7,9', { max: 20, topN: 5 }), { isZero: false, indices: [3, 7, 9] })
        assert.deepEqual(W.parseIndexList('0', { max: 20 }), { isZero: true, indices: [] })
        assert.deepEqual(W.parseIndexList('5,6,15,16,28 Wait, let me reconsider. The rules say pick at most 5', { max: 20, topN: 5 }), { isZero: false, indices: [5, 6, 15, 16] })
        assert.deepEqual(W.parseIndexList('1, 4, 6, 12, 14', { max: 10 }), { isZero: false, indices: [1, 4, 6] })
        assert.deepEqual(W.parseIndexList('選 2、3、4', { max: 10, topN: 2 }), { isZero: false, indices: [2, 3] })
        assert.deepEqual(W.parseIndexList('', {}), { isZero: false, indices: [] })
    })

    it('parseJsonArray：code fence 與尾隨說明免疫；截斷回 null（不搶救半成品）；非陣列回 null', () => {
        assert.deepEqual(W.parseJsonArray('```json\n[{"index":1}]\n```'), [{ index: 1 }])
        assert.deepEqual(W.parseJsonArray('[1,2] trailing text with ]'), [1, 2])
        assert.equal(W.parseJsonArray('[{"index":1,"short":"a"},{"index":2,"sho'), null)
        assert.equal(W.parseJsonArray('{"a":1}'), null)
        assert.equal(W.parseJsonArray(''), null)
    })

    it('makeArrayCoverageValidator：涵蓋判定不受重複影響；內容為空不算；缺篇／截斷／非 JSON 皆 false；省略 contentFields 不驗內容', () => {
        const v = W.makeArrayCoverageValidator({ indices: [1, 2], contentFields: ['short', 'long'] })
        assert.equal(v('[{"index":1,"short":"a"},{"index":2,"long":"b"}]'), true)
        assert.equal(v('[{"index":1,"short":"a"},{"index":1,"short":"dup"},{"index":2,"long":"b"}]'), true)
        assert.equal(v('[{"index":1,"short":"a"},{"index":2,"short":"","long":" "}]'), false)
        assert.equal(v('[{"index":1,"short":"a"}]'), false)
        assert.equal(v('[{"index":1,"short":"a"},{"index":2,"lo'), false)
        assert.equal(v('not json'), false)
        assert.equal(W.makeArrayCoverageValidator({ indices: [1] })('[{"index":1}]'), true)
    })

    it('makeArrayCoverageValidator：maxLengths 任一項任一欄位超過即整體不合格（重複 index 之另一筆亦然）；onReject 收到可讀原因；未給 maxLengths 不驗長度', () => {
        const reasons = []
        const mk = (arr) => JSON.stringify(arr)
        const v = W.makeArrayCoverageValidator({ indices: [1, 2], contentFields: ['short', 'long'], maxLengths: { short: 90, long: 300 }, onReject: (why) => reasons.push(why) })
        assert.equal(v(mk([{ index: 1, short: 'a'.repeat(43), long: 'b'.repeat(205) }, { index: 2, short: 'c'.repeat(38), long: 'd'.repeat(146) }])), true, 'agnes 3.0 實測長度通過')
        assert.equal(v(mk([{ index: 1, short: 'a'.repeat(74), long: 'b'.repeat(876) }, { index: 2, short: 'c', long: 'd' }])), false, 'poolside 實測 876 字擋下')
        assert.match(reasons.at(-1), /第 1 項之 long 為 876 字，超過上限 300/)
        assert.equal(v(mk([{ index: 1, short: 'a', long: 'b'.repeat(300) }, { index: 2, short: 'c', long: 'd' }])), true, '剛好上限通過')
        assert.equal(v(mk([{ index: 1, short: 'a'.repeat(91), long: 'b' }, { index: 2, short: 'c', long: 'd' }])), false, 'short 亦受檢')
        assert.equal(v(mk([{ index: 1, short: 'a', long: 'b' }, { index: 1, short: 'a', long: 'x'.repeat(301) }, { index: 2, short: 'c', long: 'd' }])), false, '重複 index 其一超長亦不合格（不得以合格那筆蒙混）')
        assert.equal(v(mk([{ index: 1, short: 'a', long: 'b' }])), false)
        assert.match(reasons.at(-1), /未涵蓋編號 2/)
        assert.equal(v('not json'), false)
        assert.match(reasons.at(-1), /非 JSON/)
        assert.equal(reasons.length, 5)
        const noLen = W.makeArrayCoverageValidator({ indices: [1], contentFields: ['short'], maxLengths: { short: 0 } })
        assert.equal(noLen(mk([{ index: 1, short: 'a'.repeat(9999) }])), true, 'maxLengths 為 0／省略：只驗涵蓋率（既有契約不變）')
    })

    it('logAiOutcome：使用哪家（key#／tokens 含思考）、遞補歷程 WARN、未納入 WARN、無效 id ERROR；createAiEventLogger 記 cooled；兩種記錄器介面皆以成員呼叫', () => {
        const lg = capLogger()
        W.logAiOutcome({
            tag: '步驟6：',
            log: lg,
            result: {
                ok: true,
                providerId: 'agnes:agnes-3.0-flash',
                keyIndex: 0,
                kind: 'api-openai-compat',
                model: 'agnes-3.0-flash',
                usage: { prompt_tokens: 100, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 7 } },
                tried: [
                    { providerId: 'zen:x', keyIndex: null, outcome: 'skip-group', errorType: 'http', error: 'HTTP 403 FreeTierError\nline2', durationMs: 1234 },
                    { providerId: 'agnes:agnes-3.0-flash', keyIndex: 0, outcome: 'ok' },
                ],
                providersSkipped: ['poolside:laguna-s-2.1（POOLSIDE_KEYS 無金鑰）'],
                providersMissing: ['oc:opencode/union-alpha'],
            },
        })
        assert.deepEqual(lg.lines, [
            'INFO 步驟6：使用 AI agnes:agnes-3.0-flash／key#1（api-openai-compat／agnes-3.0-flash，tokens 100+20（含思考 7））',
            'WARN 步驟6：AI 遞補歷程 → zen:x（整組跳過：http／HTTP 403 FreeTierError line2，1.2s）',
            'WARN 步驟6：AI 供應商未納入 → poolside:laguna-s-2.1（POOLSIDE_KEYS 無金鑰）',
            'ERROR 步驟6：providerPick 有無效 id → oc:opencode/union-alpha（請對照供應商目錄）',
        ])
        const lg2 = capLogger()
        const onEvent = W.createAiEventLogger({ log: lg2, tag: '步驟8b：' })
        onEvent({ type: 'try' })
        onEvent({ type: 'cooled', providerId: 'agy:x', error: 'TIMEOUT after 300000ms', cooldownMs: 900000 })
        assert.equal(lg2.lines.length, 1)
        assert.match(lg2.lines[0], /^WARN 步驟8b：AI 供應商進入冷卻 → agy:x（TIMEOUT after 300000ms，15 分鐘內降至鏈尾/)
        const lg3 = []
        W.logAiOutcome({ log: { info: (m) => lg3.push(m), warn: (m) => lg3.push(m), error: (m) => lg3.push(m) }, result: { providerId: 'p', kind: 'k', model: 'm' } })
        assert.deepEqual(lg3, ['使用 AI p（k／m）'])
        assert.equal(W.OUTCOME_TEXT['next-key'], '換金鑰')
    })

    it('runJsonCli：子進程寫 JSON 檔讀回；進度行依前綴過濾、stdout/stderr 分流、半行緩衝；失敗回 {status:error} 含共試次數與 stderr 前段', async () => {
        const script = `${TMP}/cli.mjs`
        fs.writeFileSync(script, [
            'import fs from \'node:fs\';',
            'const out = process.argv[process.argv.length - 1];',
            'const mode = process.argv[2];',
            'process.stdout.write(\'[fetchWeb] try curl\\n[noise] ignore\\n[fetchWeb] ha\');',
            'process.stdout.write(\'lf-line\\n\');',
            'process.stderr.write(\'[fetchWeb] blocked\\n\');',
            'if (mode === \'fail\') { console.error(\'ENOENT: script missing\'); process.exit(1); }',
            'fs.writeFileSync(out, JSON.stringify({ status: \'ok\', mode, len: 3 }));',
        ].join('\n'), 'utf8')
        const lines = []
        const r = await W.runJsonCli({ script, args: ['okmode'], outputPath: `${TMP}/out1.json`, timeoutMs: 30000, progressPrefix: '[fetchWeb]', onProgress: (l, isErr) => lines.push(`${isErr ? 'E' : 'O'}:${l}`) })
        assert.deepEqual(r, { status: 'ok', mode: 'okmode', len: 3 })
        assert.deepEqual(lines.sort(), ['E:[fetchWeb] blocked', 'O:[fetchWeb] half-line', 'O:[fetchWeb] try curl'])
        const bad = await W.runJsonCli({ script, args: ['fail'], outputPath: `${TMP}/out2.json`, timeoutMs: 30000, maxRetries: 1 })
        assert.equal(bad.status, 'error')
        assert.match(bad.message, /共試 \d+ 次 → .*ENOENT: script missing/)
        await assert.rejects(() => W.runJsonCli({ outputPath: 'x' }), /需要 script/)
        await assert.rejects(() => W.runJsonCli({ script }), /需要 outputPath/)
        const em = []; const emit = W.makeLineEmitter((l) => em.push(l), '')
        emit('a\r\n\r\n  b'); emit('c\nd')
        assert.deepEqual(em, ['a', 'bc'], '空行不回報、半行跨 chunk 接續')
    })

    it('loadSettings／decorateSettings／createSettingsHolder：JSON5、workDir 衍生 dir、機密宣告式注入、.env 缺檔即拋、required:false 略過、set 亦 decorate', () => {
        const wd = `${TMP}/proj`
        fs.mkdirSync(wd, { recursive: true })
        fs.writeFileSync(`${wd}/settings.json`, `{ // JSON5 可寫註解與尾逗號\n  workDir: '${wd}',\n  telegram: { tokenEnvVar: 'TG_TOKEN', chatId: '1', },\n}`, 'utf8')
        fs.writeFileSync(`${wd}/.env`, 'TG_TOKEN=abc\nOTHER=x,y\n', 'utf8')
        const st = W.loadSettings({ file: `${wd}/settings.json`, dirs: { log: 'log', state: 'state' }, secrets: [{ to: 'telegram.token', from: 'telegram.tokenEnvVar' }, { to: 'opt.missing', envVar: 'NOPE', required: false }] })
        assert.equal(st.telegram.token, 'abc')
        assert.equal(slash(st.dir.log), `${wd}/log`)
        assert.equal(slash(st.dir.state), `${wd}/state`)
        assert.equal(st.dir.db, undefined, 'dirs 由呼叫端給，不假設專案有哪些目錄')
        assert.deepEqual(st.env, { TG_TOKEN: 'abc', OTHER: 'x,y' })
        assert.equal(st.opt?.missing, undefined)
        assert.throws(() => W.loadSettings({ file: `${wd}/settings.json`, secrets: [{ to: 'k', envVar: 'NOPE' }] }), /NOPE 未設定於/)
        assert.throws(() => W.loadSettings({ file: `${wd}/settings.json`, secrets: [{ to: 'k', from: 'no.such' }] }), /無法取得變數名/)
        assert.throws(() => W.loadSettings({ file: `${wd}/settings.json`, envFile: 'none.env' }), /env 檔不存在/)
        assert.throws(() => W.loadSettings({ file: `${wd}/nope.json` }), /讀不到設定檔/)
        fs.writeFileSync(`${wd}/bad.json`, '{ workDir: ', 'utf8')
        assert.throws(() => W.loadSettings({ file: `${wd}/bad.json` }), /格式錯誤（JSON5）/)
        assert.throws(() => W.loadSettings({}), /需要 file/)
        assert.throws(() => W.decorateSettings({}), /缺少 workDir/)
        assert.deepEqual(W.DF_DIRS, { db: 'db', log: 'log', tmp: 'tmp', state: 'state' })
        const pre = W.decorateSettings({ workDir: wd, telegram: { token: 'preset' } }, { secrets: [{ to: 'telegram.token', envVar: 'TG_TOKEN' }] })
        assert.equal(pre.telegram.token, 'preset', '已有值即不覆蓋（允許程式碼先行注入替身）')
        const h = W.createSettingsHolder({ file: `${wd}/settings.json`, secrets: [] })
        assert.equal(h.get().workDir, wd)
        assert.equal(h.get(), h.get(), '快取')
        const injected = h.set({ workDir: wd, custom: 1 })
        assert.equal(h.get().custom, 1)
        assert.ok(injected.dir.tmp, 'set 亦 decorate（補 st.dir；預設 DF_DIRS）')
        h.reset()
        assert.equal(h.get().custom, undefined)
        assert.equal(h.load().workDir, wd)
    })

    it('createAiCaller：目錄展開共用 ai/resolve（extraProviders／exes／patch／providerTimeouts）；缺金鑰列 skipped、未知 id 列 missing 不拋；無可用條目回同形失敗', async () => {
        const catalogue = [
            { id: 'k:needs-key', model: 'm', kind: 'api-openai-compat', envVar: 'K_KEYS', baseURL: 'https://example.invalid/v1' },
            { id: 'claude:sonnet', model: 'sonnet', kind: 'claude' },
        ]
        const c = W.createAiCaller({ catalogue, pick: ['k:needs-key', 'claude:sonnet', 'typo:x'], env: {}, exes: { claude: 'C:/x/claude.exe' }, patch: { 'claude:sonnet': { timeoutMs: 123 } }, providerTimeouts: { 'claude:sonnet': 456 } })
        assert.deepEqual(c.providers.map((p) => p.id), ['claude:sonnet'])
        assert.equal(c.providers[0].exe, 'C:/x/claude.exe', 'exes 依 kind 注入')
        assert.equal(c.providers[0].timeoutMs, 123, 'patch 優先於逾時三層取值')
        assert.deepEqual(c.skipped, ['k:needs-key（K_KEYS 無金鑰）'])
        assert.deepEqual(c.missing, ['typo:x'])
        assert.equal(typeof c.hints, 'object')
        const none = W.createAiCaller({ catalogue, pick: ['k:needs-key'], env: {} })
        const r = await none.callAI('hi')
        assert.equal(r.ok, false)
        assert.match(r.error, /無可用的 AI 供應商（k:needs-key（K_KEYS 無金鑰））/)
        assert.deepEqual(r.providersSkipped, ['k:needs-key（K_KEYS 無金鑰）'])
        assert.deepEqual(r.tried, [])
        assert.equal(r.attempts, 0)
        const c2 = W.createAiCaller({ catalogue, extraProviders: [{ id: 'k:needs-key', envVar: 'K2' }], pick: ['k:needs-key'], env: { K2: 'a,b' } })
        assert.equal(c2.providers.length, 1, 'extraProviders 同 id 覆蓋內建（envVar 改指 K2）')
        assert.deepEqual(c2.providers[0].keys, ['a', 'b'])
        assert.throws(() => W.createAiCaller({ catalogue, extraProviders: [{ model: 'no-id' }] }), /缺少 id/)
        const tp = W.timeoutPatch(catalogue, { pick: ['claude:sonnet'], providerTimeouts: {}, timeoutMs: 999 })
        assert.deepEqual(tp, { 'claude:sonnet': { timeoutMs: 999 } }, '逾時三層:全域預設補到未指定者')
    })

    it('createAiAdapter：接受 env 物件（與 envFile 二擇一）與 exes（opt 或 ai.exes）；pick 含未知 id 仍於建構期拋錯並附拼寫提示', () => {
        const clock = createClock('Asia/Taipei')
        const stateDir = `${TMP}/ad`
        fs.mkdirSync(stateDir, { recursive: true })
        const a = createAiAdapter({ ai: { providerPick: ['claude:sonnet'], providerTimeouts: { 'claude:sonnet': 2000 }, exes: { claude: 'C:/x/claude.exe' } }, env: {}, stateDir, workspace: TMP, clock })
        const u = a.aiUsageToday()
        assert.equal(u.providers[0].exe, 'C:/x/claude.exe')
        assert.equal(u.providers[0].timeoutMs, 2000)
        const b = createAiAdapter({ ai: { providerPick: ['claude:sonnet'] }, env: {}, exes: { claude: 'C:/y/claude.exe' }, stateDir, workspace: TMP, clock })
        assert.equal(b.aiUsageToday().providers[0].exe, 'C:/y/claude.exe')
        assert.throws(() => createAiAdapter({ ai: { providerPick: ['claude:sonnet'] }, stateDir, workspace: TMP, clock }), /envFile 或 env/)
        assert.throws(() => createAiAdapter({ ai: { providerPick: ['claude:sonet'] }, env: {}, stateDir, workspace: TMP, clock }), /含未知 id:claude:sonet\(內建目錄與 ai\.extraProviders 皆無\)；拼寫提示：claude:sonet→claude:sonnet/)
    })

})
