// unit-patrol.test.mjs — 巡檢之結構化摘要優先解析、新判準(⑫～⑰)、早夭判別、已知常態白名單;runSummary 往返
// 執行:npx mocha test/unit-patrol.test.mjs(暫存落 test/_tmp/patrol-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createPatrol } from '../src/ops/patrol.mjs'
import { buildRunSummary, writeRunSummary, readRunSummary, sanitize, subReportOf } from '../src/ops/runSummary.mjs'
import { createClock } from '../src/util/clock.mjs'
import { memStore } from './tools/memStore.mjs'

const TMP = path.resolve(`test/_tmp/patrol-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const clock = createClock('Asia/Taipei')
const today = clock.day8()
const hh = clock.iso8().slice(11, 13)
const tz = clock.iso8().slice(-6)
// 以 clock 時區格式化毫秒時刻(toISOString 是 UTC,直接把 Z 換成 +08:00 會差 8 小時)
const tzMin = (tz.startsWith('-') ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)))
const fmt = (ms) => new Date(ms + tzMin * 60_000).toISOString().replace('Z', tz)
const usage = { used: 100, byKey: { 'agy:gemini-3.8-flash-high': 90, 'claude:sonnet': 10 }, chain: '', providers: [{ id: 'agy:gemini-3.8-flash-high' }] }
let seq = 0
const stores = (over = {}) => () => ({ docs: memStore(), notes: memStore(), relations: memStore(), cores: memStore(), sources: memStore(), frontier: memStore(), ...over })
const make = (extra = {}) => createPatrol({
    dirs: { log: `${TMP}/log`, state: `${TMP}/state`, tmp: `${TMP}/tmp` },
    workDir: TMP,
    clock,
    openStores: stores(),
    closeStores: async () => {},
    aiUsageToday: () => usage,
    primaryProviderIds: ['agy:gemini-3.8-flash-high'],
    scheduleLimitMin: 55,
    capacity: { fetch: 27, extract: 54, relate: 36, distill: 2 },
    ...extra,
})
const resetLogs = () => {
    fs.rmSync(`${TMP}/log`, { recursive: true, force: true }); fs.mkdirSync(`${TMP}/log/${today}`, { recursive: true }); fs.rmSync(`${TMP}/state/patrol-state.json`, { force: true })
}
/** 寫一輪日誌(本小時,序號遞增);lines 為日誌行(不含時間戳),finished 決定是否有結束行 */
const writeLog = (lines, { finished = true, startMinOffset = 0, spanSec = 60 } = {}) => {
    const stamp = `${today}${hh}${String(seq++).padStart(2, '0')}00`
    const t0 = new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T${hh}:${String(startMinOffset).padStart(2, '0')}:00${tz}`).getTime()
    const at = (s) => `[${fmt(t0 + s * 1000)}]`
    const body = lines.map((l, i) => `${at(Math.min(spanSec, i))} INFO  ${l}`)
    if (finished) body.push(`${at(spanSec)} INFO  管道[知識管線] 結束，耗時 ${spanSec}.0s`)
    else body.push(`${at(spanSec)} INFO  內文[x] 成功（100 字，article）`)
    fs.writeFileSync(`${TMP}/log/${today}/${stamp}-run.log`, body.join('\n') + '\n', 'utf8')
    return stamp
}
/** 以 objects.mjs 之 report 形狀組一份 run.json */
const summaryFor = (stamp, { ms = 1000, extract = {}, relate = {}, fetch = {}, distill = {}, health = null } = {}) => {
    const sub = (stats, detail) => ({ ok: true, stats: { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0, ...stats }, detail, summary: '' })
    const report = {
        name: '知識管線',
        ms,
        ok: true,
        stages: [
            { name: '抓取', step: 1, status: 'ok', ms: 10, result: { ok: true, stats: {}, detail: { listFetch: sub({}, { newDocs: fetch.newDocs ?? 3, sourcesTried: 1 }), detailFetch: sub({}, { filled: 1, queued: fetch.queued ?? 100, queuedOldestDays: 40, left: fetch.left ?? 0 }) } } },
            { name: '彙整', step: 2, status: 'ok', ms: 10, result: { ok: true, stats: {}, detail: { extract: sub({ aiCalls: extract.aiCalls ?? 18, fail: extract.fail ?? 0 }, { processed: extract.processed ?? 54, notes: extract.notes ?? 7, skipped: extract.skipped ?? 47, explore: 1, pool: extract.pool ?? 60, poolOldestDays: 0, stopped: !!extract.stopped }) } } },
            { name: '關聯', step: 3, status: 'ok', ms: 10, result: { ok: true, stats: {}, detail: { relate: sub({ aiCalls: 6 }, { targets: 30, edges: 100, conflicts: 5, pending: relate.pending ?? 100 }) } } },
            { name: '提煉', step: 4, status: 'ok', ms: 10, result: { ok: true, stats: {}, detail: { distill: sub({ aiCalls: 16 }, { concepts: 2, updated: distill.updated ?? 2, aiCalls: 16 }) } } },
            { name: '索引', step: 5, status: 'ok', ms: 1, result: { ok: true, stats: {}, detail: { notes: 11454, cores: 175, edges: 36314 } } },
        ],
    }
    const ai = { aiUsageToday: () => ({ byKey: usage.byKey }), health: { snapshot: () => ({ threshold: 3, counts: health || {} }) } }
    return buildRunSummary({ report, startedAt: 'x', endedAt: 'y', deadlineMs: 2940_000, ai, stamp })
}
const record = (p) => fs.readFileSync(p.recordFile, 'utf8')

describe('unit-patrol', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        for (const d of ['log', 'state', 'tmp']) fs.mkdirSync(`${TMP}/${d}`, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── runSummary ──
    it('runSummary：sanitize 剔除函數、截長字串、限深度;write/read 往返;版本不符回 null', () => {
        const s = sanitize({ f: () => 1, s: 'x'.repeat(400), n: 1, deep: { a: { b: { c: { d: { e: { f: 1 } } } } } }, arr: [1, () => 2, 'a'] })
        assert.equal(s.f, undefined)
        assert.equal(s.s.length, 301)
        assert.equal(s.n, 1)
        assert.deepEqual(s.arr, [1, 'a'])
        assert.equal(s.deep.a.b.c.d, undefined, '深度限制(第 5 層起剔除)')
        const stamp = `${today}${hh}9900`
        const file = writeRunSummary({ dir: `${TMP}/log`, stamp, summary: summaryFor(stamp) })
        assert.ok(file && fs.existsSync(file))
        const j = readRunSummary(file)
        assert.equal(j.stages.length, 5)
        assert.equal(subReportOf(j, '彙整', 'extract').detail.notes, 7)
        assert.equal(subReportOf(j, '不存在', 'x'), null)
        // 階段名可由安裝方 opt.name 覆寫,子階段鍵才是固定接縫:階段名對不上時仍以子階段鍵找到(複審 B9)
        assert.equal(subReportOf(j, '改了名的階段', 'extract').detail.notes, 7)
        fs.writeFileSync(file, JSON.stringify({ version: 999, stages: [] }), 'utf8')
        assert.equal(readRunSummary(file), null, '版本不符須退回正則路徑')
        assert.equal(writeRunSummary({ dir: `${TMP}/log`, stamp: 'bad', summary: {} }), null)
        fs.rmSync(file, { force: true })
    })

    // ── JSON 優先、AI 欄合計 ──
    it('逐輪數字優先取自 run.json(正則路徑只作退路);AI 欄為三段合計;無 JSON 者標「正則」', async () => {
        resetLogs()
        const s1 = writeLog(['步驟2 彙整 完成：處理 54、新知識 1、略過 53、線索 0（AI 18 次）（1.0s）']) // 正則會讀到 知識 1
        writeRunSummary({ dir: `${TMP}/log`, stamp: s1, summary: summaryFor(s1, { extract: { notes: 7, skipped: 47 } }) })
        writeLog(['步驟2 彙整 完成：處理 9、新知識 2、略過 7、線索 0（AI 3 次）（1.0s）']) // 無 JSON
        const p = make({ recordFile: `${TMP}/r1.md` })
        await p.patrolFromPipeline()
        const t = record(p)
        assert.match(t, /\| run \| 新文件 3｜知識 7（略過 47）｜關聯 100 條｜核心 \+2 \| 40 \|/, 'JSON 之數字覆寫正則;AI＝18＋6＋16')
        assert.match(t, /\| run·正則 \| 新文件 -｜知識 2（略過 7）｜關聯 - 條｜核心 \+- \| 3 \|/, '無 JSON 者退回正則並標示')
    })

    // ── 新判準 ⑫～⑰ ──
    it('⑫ 整輪耗時逼近上限、⑬ 供應商健康(降序/席位不相容)、⑭ 判非知識比例、⑰ 設定不自洽', async () => {
        resetLogs()
        const s = writeLog([], { spanSec: 3100 })
        writeRunSummary({ dir: `${TMP}/log`, stamp: s, summary: summaryFor(s, { ms: 3100_000, extract: { processed: 54, skipped: 45 }, health: { 'agy:gemini-3.8-flash-high': { ok: 2, fail: { validation: 9, params: 6 }, cooled: 2, mismatch: 6 } } }) })
        const p = make({ recordFile: `${TMP}/r2.md`, settingsWarnings: ['fetch.articlesPerRun(60) 大於萃取容量 54'] })
        const a = await p.assess()
        assert.ok(a.issues.some((x) => /整輪耗時逼近排程上限 55 分：.*=3100s/.test(x)), '⑫')
        assert.ok(a.issues.some((x) => /供應商連續失敗被降序：agy:gemini-3\.8-flash-high×2（成 2／敗 15）/.test(x)), '⑬ 降序')
        assert.ok(a.issues.some((x) => /席位設定與供應商能力不相容（params 失敗）：agy:gemini-3\.8-flash-high×6/.test(x)), '⑬ 席位不相容')
        assert.ok(a.issues.some((x) => /判非知識比例 83%（45\/54，含預篩攔下）/.test(x)), '⑭（無預篩數字時即萃取本身之比例）')
        assert.ok(a.issues.some((x) => /設定不自洽：fetch\.articlesPerRun\(60\) 大於萃取容量 54/.test(x)), '⑰')
        assert.ok(!a.issues.some((x) => /未列入已知常態/.test(x)), '設定警告不再重複出現於 ⑦')
    })

    // 需求：某供應商末端連續數輪零成功而持續失敗時必須告警。兩種易寫錯的判準都不可用——
    //   ①依賴冷卻降序:exec／http 型失敗不觸發冷卻,cooled 恆 0;②用整日聚合:會被「早上正常、下午全敗」抹平。
    //   2026-09-18 muse 免費層斷供即兼具兩者(當日 ok 36／fail 162、cooled 0,04:00 起連 10 輪 ok=0)。
    it('⑬ 零成功：以末端連續輪數判定(整日聚合與 cooled 皆漏);失敗過少或末輪已恢復者不報', async () => {
        resetLogs()
        const dead = { ok: 0, fail: { exec: 18 }, cooled: 0, mismatch: 0, oversize: 0 }
        const rounds = [
        // 第一輪三家皆正常(muse 有成功 → 整日聚合會看到 ok>0,證明不能用聚合)
            { 'oc:opencode/muse-spark-1.3-contributor-free': { ok: 9, fail: {}, cooled: 0 }, 'codex:gpt-5.6-luna': { ok: 3, fail: {}, cooled: 0 }, 'poolside:laguna-s-2.1': { ok: 0, fail: { timeout: 9 }, cooled: 0 } },
            // 第二、三輪 muse 全敗;luna 每輪只敗 2(未達失敗門檻);poolside 末輪恢復(連續中斷)
            { 'oc:opencode/muse-spark-1.3-contributor-free': dead, 'codex:gpt-5.6-luna': { ok: 0, fail: { timeout: 1 }, cooled: 0 }, 'poolside:laguna-s-2.1': { ok: 0, fail: { timeout: 9 }, cooled: 0 } },
            { 'oc:opencode/muse-spark-1.3-contributor-free': dead, 'codex:gpt-5.6-luna': { ok: 0, fail: { timeout: 1 }, cooled: 0 }, 'poolside:laguna-s-2.1': { ok: 5, fail: {}, cooled: 0 } },
        ]
        for (const health of rounds) {
            const s = writeLog([])
            writeRunSummary({ dir: `${TMP}/log`, stamp: s, summary: summaryFor(s, { health }) })
        }
        const a = await make({ recordFile: `${TMP}/r2b.md` }).assess()
        const line = a.issues.find((x) => /供應商零成功/.test(x))
        assert.ok(line, '末端連續零成功必須告警(不經 cooled、不被整日聚合抹平)')
        assert.ok(/muse-spark-1\.3-contributor-free（連 2 輪，敗 36）/.test(line), '只計末端連續段,不含前面正常那輪')
        assert.ok(!/gpt-5\.6-luna/.test(line), '連 2 輪但僅敗 2 次者不列入(失敗門檻 6)')
        assert.ok(!/poolside/.test(line), '末輪已恢復者不列入(連續段歸零)')
        assert.ok(!a.issues.some((x) => /供應商連續失敗被降序/.test(x)), 'cooled 皆 0 時不報降序')
    })

    it('⑮ 待探索積壓、⑯ raw 池絕對量(大而不老化的積壓靠天數測不到)、⑤ 待關聯門檻＝六輪容量且看消化趨勢', async () => {
        resetLogs()
        const docs = memStore(Array.from({ length: 600 }, (_, i) => ({ id: `r${i}`, status: 'raw', rawAt: clock.iso8() })))
        const frontier = memStore(Array.from({ length: 6000 }, (_, i) => ({ id: `f${i}`, status: 'pending' })))
        const notes = memStore(Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, createdAt: '2026-09-01' }))) // 全數未關聯
        for (const pend of [300, 250, 200]) {
            const s = writeLog([]); writeRunSummary({ dir: `${TMP}/log`, stamp: s, summary: summaryFor(s, { relate: { pending: pend } }) })
        }
        const p = make({ recordFile: `${TMP}/r3.md`, openStores: stores({ docs, frontier, notes }) })
        const a = await p.assess()
        assert.ok(a.issues.some((x) => /待探索線索積壓 6000 筆（>5000）/.test(x)), '⑮')
        assert.ok(a.issues.some((x) => /raw 池 600 篇＝約 12 輪萃取容量（>10 輪）/.test(x)), '⑯')
        assert.ok(!a.issues.some((x) => /待關聯筆記積壓/.test(x)), '⑤ 積壓 300 > 216 但三輪 300→250→200 在消化,不報(曾以固定 72 每輪誤報)')
        resetLogs()
        for (const pend of [300, 310, 305]) {
            const s = writeLog([]); writeRunSummary({ dir: `${TMP}/log`, stamp: s, summary: summaryFor(s, { relate: { pending: pend } }) })
        }
        const a2 = await make({ recordFile: `${TMP}/r3b.md`, openStores: stores({ docs, frontier, notes }) }).assess()
        assert.ok(a2.issues.some((x) => /待關聯筆記積壓 300 篇（>216＝六輪容量）且近 3 輪無淨消化（300→310→305）/.test(x)), '⑤ 無淨消化才報')
    })

    // ── ② 早夭 vs 撞上限 ──
    it('② 未跑完者分「早夭」(啟動後不久即無日誌)與「撞上限」;④ 無數字者不視為 0 篇', async function() {
        // 以過去的小時命名使 ageMin > 上限:檔名時間戳取兩小時前,且須以 clock 時區換算(原以系統時區 getHours,系統時區不同即錯位)。
        // ② 只判「今日」之輪次:clock 時區凌晨 0～2 點時兩小時前已跨日,構造不出「今日且逾上限」之輪次,本案略過(原寫法此時段必敗)
        const pastIso = fmt(Date.now() - 2 * 3600_000)
        if (pastIso.slice(0, 10).replace(/-/g, '') !== today) this.skip()
        resetLogs()
        const pastHH = pastIso.slice(11, 13)
        const stampOf = (m) => `${today}${pastHH}${m}00`
        const t0 = (m) => new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T${pastHH}:${m}:00${tz}`).getTime()
        const line = (base, s, txt) => `[${fmt(base + s * 1000)}] INFO  ${txt}`
        fs.writeFileSync(`${TMP}/log/${today}/${stampOf('00')}-run.log`, [line(t0('00'), 0, '管道[知識管線] 啟動（6 段）'), line(t0('00'), 93, '內文[x] 成功（100 字，article）')].join('\n') + '\n', 'utf8')
        fs.writeFileSync(`${TMP}/log/${today}/${stampOf('10')}-run.log`, [line(t0('10'), 0, '管道[知識管線] 啟動（6 段）'), line(t0('10'), 3250, '提煉事件[x] claude:sonnet 成交（100s）')].join('\n') + '\n', 'utf8')
        const a = await make({ recordFile: `${TMP}/r4.md` }).assess()
        assert.ok(a.issues.some((x) => /早夭（啟動後不久即無日誌）：.*\(93s\).*非排程上限/.test(x)), '93 秒後無聲＝早夭,不是撞上限（曾誤導複審）')
        assert.ok(a.issues.some((x) => /撞排程上限未跑完：.*\(3250s\)/.test(x)), '3250 秒後無聲＝撞上限')
        assert.ok(!a.issues.some((x) => /最近 3 輪皆未產出新知識/.test(x)), '早夭輪無萃取數字,不可當 0 篇計入產出停滯')
        const t = record(await (async () => {
            const p = make({ recordFile: `${TMP}/r4.md` }); await p.patrolFromPipeline(); return p
        })())
        assert.match(t, /❌ 早夭（93s）/)
        assert.match(t, /❌ 撞上限/)
    })

    // ── 已知常態白名單 ──
    it('⑦ 白名單：降級採 A 稿、批次異常、逾時間預算守門、供應商健康降序、設定警告皆不列為未知警告;真未知者仍報', async () => {
        resetLogs()
        const s = writeLog([])
        fs.appendFileSync(`${TMP}/log/${today}/${s}-run.log`, [
            `[${clock.iso8()}] WARN  提煉[壓力測試]：審計鏈失敗（B failed: stage[accept] failed: ABORTED）→ 降級採用 A 整合稿`,
            `[${clock.iso8()}] WARN  批次異常：席位解析失敗`,
            `[${clock.iso8()}] WARN  批次：逾時間預算，第 4/6 輪起不再開工（未取件者留佇列）`,
            `[${clock.iso8()}] WARN  補全文：逾時間預算，12 篇未取件留下輪`,
            `[${clock.iso8()}] WARN  管道[知識管線] 階段[提煉] 略過：逾時間預算`,
            `[${clock.iso8()}] WARN  供應商健康：agy:gemini-3.8-flash-high 連續 3 次 validation 失敗（x），降序冷卻`,
            // 2026-09-24:整組金鑰皆敗之加註、批次失敗之歷程(前綴不變,白名單照舊涵蓋)
            `[${clock.iso8()}] WARN  供應商健康：agnes:agnes-3.0-flash 連續 3 次 http 失敗（每次 2 把金鑰皆敗）（HTTP 401），降序冷卻`,
            `[${clock.iso8()}] WARN  批次 AI 失敗（HTTP 401，試 2 次；歷程 agnes:agnes-3.0-flash#0:http(0.4s)、agnes:agnes-3.0-flash#1:http(0.3s)）→ `,
            `[${clock.iso8()}] WARN  fetch.articlesPerRun(60) 大於萃取容量 54（fetchExtractRounds×aiParallel×docsPerExtract）：抓進來萃不完`,
            `[${clock.iso8()}] WARN  來源[S] 有 2 項不符格式而略過：x`,
            `[${clock.iso8()}] WARN  這是一則真的未知警告 XYZ`,
        ].join('\n') + '\n', 'utf8')
        const a = await make({ recordFile: `${TMP}/r5.md` }).assess()
        const odd = a.issues.find((x) => /未列入已知常態/.test(x)) || ''
        assert.match(odd, /出現 1 種未列入已知常態的警告/, '只剩真未知者')
        assert.match(odd, /真的未知警告 XYZ/)
    })

    // ── 2026-09-23 修正之回歸 ──
    it('① 最近一輪取自近 N 日全部日誌:跨午夜之輪(日誌落在前一日目錄)不得誤報「排程可能未觸發」;全無日誌仍報', async () => {
        resetLogs()
        // 模擬跨午夜之輪(23:35 啟動、00:05 收尾巡檢):日誌落在前一日目錄,但啟動時距僅 30 分鐘。
        // 此前判準只看今日目錄,午夜後之收尾巡檢必誤報
        const yday = fmt(Date.now() - 86400_000).slice(0, 10).replace(/-/g, '')
        const stamp = fmt(Date.now() - 30 * 60_000).slice(0, 19).replace(/[-T:]/g, '')
        fs.mkdirSync(`${TMP}/log/${yday}`, { recursive: true })
        fs.writeFileSync(`${TMP}/log/${yday}/${stamp}-run.log`, `[${fmt(Date.now() - 30 * 60_000)}] INFO  管道[知識管線] 結束，耗時 60.0s\n`, 'utf8')
        const a = await make({ recordFile: `${TMP}/r6.md` }).assess()
        assert.ok(!a.issues.some((x) => /排程可能未觸發/.test(x)), `30 分鐘前啟動之輪次在窗內,不得報:${a.issues.join('｜')}`)
        resetLogs()
        const b = await make({ recordFile: `${TMP}/r6b.md` }).assess()
        assert.ok(b.issues.some((x) => /最近 115 分鐘無管線啟動（近 3 日至今 \d{2} 時無日誌）——排程可能未觸發/.test(x)), '全無日誌仍須報')
    })

    it('runCli:未給 dirs.tmp 時鎖檔退至 dirs.state(建構期只要求 log/state,此前 path.join(undefined) 拋 TypeError);結束即釋放', async () => {
        resetLogs()
        const p = createPatrol({ dirs: { log: `${TMP}/log`, state: `${TMP}/state` }, workDir: TMP, clock, openStores: stores(), closeStores: async () => {}, aiUsageToday: () => usage, recordFile: `${TMP}/r7.md` })
        const r = await p.runCli(['--force'])
        assert.ok(r && Array.isArray(r.issues), 'runCli 須正常完成')
        assert.ok(!fs.existsSync(`${TMP}/state/patrol.lock`), '鎖於結束後釋放')
        assert.ok(fs.existsSync(`${TMP}/r7.md`), '紀錄檔已落地')
    })

})
