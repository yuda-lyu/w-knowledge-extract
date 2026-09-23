// unit-ops.test.mjs — 營運配套（巡檢）之回歸測試：主力供應商判定、異常事件去重
// 執行：npx mocha test/unit-ops.test.mjs（暫存落 test/_tmp/ops-<pid>，測完即刪）

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createPatrol } from '../src/ops/patrol.mjs'
import { createClock } from '../src/util/clock.mjs'
import { memStore } from './tools/memStore.mjs'

const TMP = path.resolve(`test/_tmp/ops-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const clock = createClock('Asia/Taipei')
const openStores = () => ({ docs: memStore(), notes: memStore(), relations: memStore(), cores: memStore(), sources: memStore(), frontier: memStore() })
// 今日用量：providerPick 首項 agnes 只佔 10%，各名額之主力 gemini 佔 90%
const usage = { used: 100, byKey: { 'agnes:agnes-2.5-flash#0': 10, 'agy:gemini-3.8-flash-high': 90 }, chain: '', providers: [{ id: 'agnes:agnes-2.5-flash' }, { id: 'agy:gemini-3.8-flash-high' }] }
const make = (extra) => createPatrol({
    dirs: { log: `${TMP}/log`, state: `${TMP}/state`, tmp: `${TMP}/tmp` },
    workDir: TMP,
    clock,
    openStores,
    closeStores: async () => {},
    aiUsageToday: () => usage,
    ...extra,
})
const resetState = () => fs.rmSync(`${TMP}/state/patrol-state.json`, { force: true })
const entries = (file) => (fs.readFileSync(file, 'utf8').match(/^### 20/gm) || []).length


describe('unit-ops', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        for (const d of ['log', 'state', 'tmp']) fs.mkdirSync(`${TMP}/${d}`, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    it('用量占比判定以各名額主力（primaryProviderIds）為準，不再以 providerPick[0] 誤報', async () => {
        resetState()
        const p1 = make({ recordFile: `${TMP}/r1.md`, primaryProviderIds: ['agy:gemini-3.8-flash-high'] })
        assert.deepEqual(await p1.patrolFromPipeline(), { ok: true }, '收尾呼叫回 {ok}——失敗時附 error 供管線留 warn,不再裸吞')
        assert.doesNotMatch(fs.readFileSync(`${TMP}/r1.md`, 'utf8'), /AI 流量僅/, '主力 gemini 佔 90%，不得報警（曾因取 providerPick[0] 連續誤報 257 次）')
        resetState()
        const p0 = make({ recordFile: `${TMP}/r0.md` }) // 未給 primaryProviderIds → 退回 providers[0]（agnes 10%）
        await p0.patrolFromPipeline()
        assert.match(fs.readFileSync(`${TMP}/r0.md`, 'utf8'), /AI 流量僅 10%/, '退路仍能偵測主力失效')
    })

    it('異常事件去重：同一組問題連續兩輪只追加一次；問題集合改變才再追加', async () => {
        resetState()
        const p = make({ recordFile: `${TMP}/r2.md` }) // 無任何日誌 →「最近 N 分鐘無管線啟動」＋ agnes 10% 兩項
        await p.patrolFromPipeline()
        await p.patrolFromPipeline()
        const t = fs.readFileSync(`${TMP}/r2.md`, 'utf8')
        assert.equal(entries(`${TMP}/r2.md`), 1, '相同問題第二輪不得再追加（持續性問題逐輪洗版會淹沒新問題）')
        assert.match(t, /未重複追加/, '近況總覽須說明本輪未追加')
        usage.byKey['agnes:agnes-2.5-flash#0'] = 60 // 占比問題消失 → 問題集合改變
        await p.patrolFromPipeline()
        assert.equal(entries(`${TMP}/r2.md`), 2, '問題集合改變須再追加')
    })

    // ── 佇列告警（2026-09-07：知識庫沒有時間型丟棄，積壓只告警；判準見 patrol ⑧～⑪）──
    it('佇列告警：未定義狀態、raw 跨輪未清、raw 連續淨增、補全文過長且未消化須報；佇列消化中不報過長', async () => {
        resetState()
        const day = 86400_000
        const ago = (d) => new Date(Date.now() - d * day).toISOString()
        const docs = memStore([
            { id: 'n1', status: 'new', collectedAt: ago(40) },
            { id: 'r1', status: 'raw', collectedAt: ago(40), rawAt: ago(5) }, // 舊件補抓後在 raw 等了 5 天（以 rawAt 量，非 collectedAt）
            { id: 'r2', status: 'raw', collectedAt: ago(40) }, // 無 rawAt（舊資料）不計入最舊
            { id: 'x1', status: 'expired', collectedAt: ago(40) }, // 未定義狀態（曾為未判定即丟棄之機制）
        ])
        const stores = () => ({ docs, notes: memStore(), relations: memStore(), cores: memStore(), sources: memStore(), frontier: memStore() })
        const today = clock.day8()
        const hh = clock.iso8().slice(11, 13)
        fs.mkdirSync(`${TMP}/log/${today}`, { recursive: true })
        // 每輪日誌:待抓佇列 q、raw 池 r（萃取開始前＝本輪進料）、彙整處理 p（殘餘＝r−p）
        const writeRuns = (rows) => rows.forEach(([q, r, p], i) => fs.writeFileSync(`${TMP}/log/${today}/${today}${hh}0${i}00-run.log`,
            `[t] INFO  待抓內文 ${q} 篇（最舊 40 天），本輪取 27\n[t] INFO  raw 池 ${r} 篇（最舊 5 天），本輪容量 54\n` +
        `[t] INFO  步驟2 彙整 完成：處理 ${p}、新知識 1、略過 0、線索 0（AI 1 次）（1.0s）\n[t] INFO  管道[知識管線] 結束，耗時 1.0s\n`))
        writeRuns([[100, 12, 10], [100, 24, 20], [101, 40, 30]]) // 佇列未消化（≥）、raw 殘餘 2→4→10 遞增
        const p = make({ recordFile: `${TMP}/r3.md`, openStores: stores, primaryProviderIds: ['agy:gemini-3.8-flash-high'] })
        await p.patrolFromPipeline()
        const t = fs.readFileSync(`${TMP}/r3.md`, 'utf8')
        assert.match(t, /未定義狀態：expired=1/, '未定義狀態須報')
        assert.match(t, /raw 池最舊者已等 5 天（2 篇）/, 'raw 跨輪未清須報，且以 rawAt 量（r2 無 rawAt 不計最舊、但計篇數）')
        assert.match(t, /raw 池連續 3 輪留有殘餘且遞增（12-10=2、24-20=4、40-30=10）/, 'raw 殘餘遞增須報')
        assert.match(t, /補全文佇列最舊者已等 40 天（1 篇）且近 3 輪無淨消化（100→100→101）/, '過長且未消化須報')
        assert.match(t, /待抓內文 1（最舊 40 天）｜待萃取 2（最舊 5 天）/, '近況總覽須顯示佇列長度與最舊天數')

        resetState()
        // 佇列消化中（遞減）；raw 進料逐輪遞增但每輪清空（殘餘 0）——2026-09-08 15:29 曾以池大小判而誤報
        writeRuns([[100, 15, 15], [90, 24, 24], [80, 31, 31]])
        const docs2 = memStore([{ id: 'n1', status: 'new', collectedAt: ago(40) }])
        const p2 = make({ recordFile: `${TMP}/r4.md`, openStores: () => ({ ...stores(), docs: docs2 }), primaryProviderIds: ['agy:gemini-3.8-flash-high'] })
        await p2.patrolFromPipeline()
        const t2 = fs.readFileSync(`${TMP}/r4.md`, 'utf8')
        assert.doesNotMatch(t2, /補全文佇列最舊者/, '佇列在消化中（100→90→80）不得報過長——排隊變長才是訊號，過長本身不是')
        assert.doesNotMatch(t2, /raw 池連續/, 'raw 進料遞增但每輪清空（殘餘 0）不得報——「raw 池 N」是萃取前的進料量，不是殘留量')
        assert.doesNotMatch(t2, /未定義狀態/, '狀態皆在狀態機內不報')

        // 中間回落不得使「無淨消化」漏報：曾以逐輪遞增判定，2026-09-08 佇列整日 +81 卻因一輪回落而漏報
        resetState()
        writeRuns([[100, 5, 5], [110, 5, 5], [105, 5, 5]])
        const p3 = make({ recordFile: `${TMP}/r5.md`, openStores: () => ({ ...stores(), docs: memStore([{ id: 'n1', status: 'new', collectedAt: ago(40) }]) }), primaryProviderIds: ['agy:gemini-3.8-flash-high'] })
        await p3.patrolFromPipeline()
        assert.match(fs.readFileSync(`${TMP}/r5.md`, 'utf8'), /無淨消化（100→110→105）/, '末(105) ≥ 首(100) 即未消化，中間回落不得漏報')
    })

})
