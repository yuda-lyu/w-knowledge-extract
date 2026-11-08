// unit-extract-stage.test.mjs — 提煉階段(主張庫＋差量,3+3 工作流)之端到端行為:真檔案 IO＋記憶體集合＋腳本化 AI 替身
//
// 3+3:三家獨立起草(runFanout)→ 整合 → 審計 → 修訂 → 終審(callAi)→ 程式套用。AI 替身依席位(d1/d2/d3/int/aud/rev/acc)回腳本化之 JSON,
//   並經工作流傳入之 check 驗證(同真工作流之語意);整合替身預設把第一份成功候選原樣收入(via 指回)、審計預設無意見、終審預設逐條 keep。
// 執行:自套件根 node <mocha> test/unit-extract-stage.test.mjs(暫存落 test/_tmp/extract-stage-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不發網路、不開埠)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore, nullLogger, setConceptFold, resetConceptFold, requestRetry, waiveHold } from './tools/captureForTest.mjs'
import { tmpRoot, removeRoots, PKG_ROOT } from './tools/extractTestKit.mjs'
import { coreVersionsByProvenance } from '../src/ops/coreVersionsByProvenance.mjs'
import { stageExtract } from '../src/stages/extractStage.mjs'
import { mwLoadState, mwSelectNotes, mwPass, mwRenderState, mwPersistState } from '../src/stages/extractChain.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { DELETION_FILES } from './tools/relateForTest.mjs'
import { createRelateDomain } from '../src/core/relatePackage.mjs'
import { SYNONYM_LEDGER_KEY } from '../src/stages/synonymStep.mjs'
import { resolveExtractSettings } from '../src/core/extractSettings.mjs'
import { writeMd, readMd } from '../src/core/summarizePackage.mjs'
import { slugify, acquireLock } from '../src/core/capturePackage.mjs'
import { checkInvariants, emptyState, STATE_VERSION, withdrawSources } from '../src/stores/coreState.mjs'
import { createCoreStore } from '../src/stores/coreStore.mjs'
import { EXTRACT_HOLD_NEXT, EXTRACT_API_HINT, HOLD_UNDO_HOW, HOLD_STALE_HOW_PREFIX } from '../src/stores/extractHolds.mjs'
import { defineMw } from '../src/core/capturePackage.mjs'
import { putHold } from '../src/core/capturePackage.mjs'
import { reviveClaims } from '../src/ops/reviveClaims.mjs'
import { regenCore } from '../src/ops/regenCore.mjs'
import { stockNeedsOf } from '../src/standards/supportStock.mjs'
import { createContentCache } from '../src/stores/contentCache.mjs'
import { CONTENT_CACHE_FILE } from '../src/stores/extractFiles.mjs'
import {
    clock, fixedClock, recLog, has, readState, ledgerOf, seedCore, SEATS, ANN, batchOf, codesIn, acceptOps, keepAll, verdictOn, auditHigh, draftAll, onlyFirst, doubtOn, cover,
    scriptAi, noteRow, mkEnvIn, addNotes, runStage,
} from './tools/extractKit.mjs'

let TMP = ''

/** 建立一個知識庫環境(目錄、筆記 md、記憶體集合、設定;共用件見 test/tools/extractKit;暫存根於 before 建立後才實例化) */
let mkEnv = null

describe('unit-extract-stage', function() {

    before(() => {
        TMP = tmpRoot('extract-stage')
        mkEnv = mkEnvIn(TMP)
        resetConceptFold()
    })
    after(() => {
        resetConceptFold() // 模組級單例,不留給同 worker 之他檔
        removeRoots([TMP])
    })

    it('新概念首版:3+3 各棒(審計無意見不修訂)、截斷一律換家;狀態檔、md(〔C1〕、提煉自)、cores 記錄(rev、noteIds＝consumed)、extractedAt;第二版累積不遺失舊主張', async () => {
        const env = mkEnv(['a1', 'a2', 'a3'].map((id) => ({ id, concepts: ['均值回歸'] })))
        const ai = scriptAi({ draft: draftAll })
        const { report } = await runStage(env, ai)
        assert.equal(report.detail.updated, 1)
        assert.deepEqual(ai.roles(), ['draft', 'draft', 'draft', 'integrate', 'audit', 'accept'], '審計無意見 → 不呼叫修訂')
        assert.ok(ai.calls.every((c) => c.acceptTruncated === false), '截斷一律換家')
        const rec = (await env.stores.cores.select())[0]
        assert.deepEqual([rec.version, rec.rev, rec.status], [1, 1, 'active'])
        assert.deepEqual(rec.noteIds.sort(), ['a1', 'a2', 'a3'])
        const st = readState(env, rec.id)
        assert.equal(st.v, STATE_VERSION)
        assert.equal(st.claims.length, 3)
        assert.equal(st.claims[0].evidence.level, '中', '單篇「中」之出處 → 中')
        assert.equal(st.essence.text, '本質文字')
        const md = readMd(rec.file)
        assert.match(md.body, /〔C1〕/)
        assert.match(md.body, /## 提煉自/)
        assert.ok((await env.stores.notes.get('a1')).extractedAt)
        // 第二版:新筆記三篇,確認 C1 並新增
        await addNotes(env, ['a4', 'a5', 'a6'], ['均值回歸'])
        const ai2 = scriptAi({ draft: (p) => ({ ops: [{ op: 'confirm', id: 'C1', sources: codesIn(p).slice(0, 2) }, { op: 'add', kind: 'rule', text: '新規則', basis: '案例', sources: [codesIn(p)[2]], ...ANN }], skipped: [] }) })
        await runStage(env, ai2)
        const st2 = readState(env, rec.id)
        assert.equal(st2.version, 2)
        assert.equal(st2.claims.length, 4, '舊主張全在、新增一條')
        assert.equal(st2.claims[0].sources.length, 3, 'C1 出處累積')
        assert.deepEqual(checkInvariants(st, st2, { touched: ['C1', 'C4'] }), [])
        assert.match(ai2.calls[0].prompt, /〔C1〕\[rule\] 主張 a\d/, '起草看得到完整之既有主張(不截斷)')
    })

    it('終審:剔除(引高嚴重度離題)之操作不套用而其筆記算涵蓋;終審失敗 → 降級:建設性照套、取代存待審;無新筆記時另排待審專步交終審席裁決', async () => {
        const env = mkEnv(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id) => ({ id, concepts: ['動量'] })), { extract: { perRun: 1 } })
        const offTopic = (op) => op.text === '離題的東西'
        const ai = scriptAi({
            draft: (p) => {
                const [a, b, c] = codesIn(p)
                // 首版立本質(ES6:有效主張即須有本質——否則下一輪另排本質專步)
                return { ops: [{ op: 'add', ref: 'a', kind: 'rule', text: '動量效應存在', basis: '案例', sources: [a], ...ANN }, { op: 'add', kind: 'rule', text: '離題的東西', basis: '案例', sources: [b], ...ANN }, { op: 'essence', text: '動量效應存在', claims: ['@a'], reason: '首版' }], skipped: [{ note: c, reason: '離題' }] }
            },
            audit: auditHigh(offTopic),
            accept: verdictOn(offTopic, { action: 'drop', reason: '離題', note: '與動量無關' }),
        })
        await runStage(env, ai)
        assert.deepEqual(ai.roles(), ['draft', 'draft', 'draft', 'integrate', 'audit', 'revise', 'accept'], '審計有意見 → 修訂')
        const rec = (await env.stores.cores.select())[0]
        const st = readState(env, rec.id)
        assert.equal(st.claims.length, 1, '被剔除之 add 不套用')
        assert.equal(st.consumed.length, 3, '引用、剔除、略過三篇皆涵蓋')
        assert.ok(st.skipped.some((x) => x.reason === '終審剔除：離題'), JSON.stringify(st.skipped))
        // 第二輪:終審失敗 → 新增照套、取代存待審
        const ai2 = scriptAi({
            draft: (p) => {
                const [a, b, c] = codesIn(p)
                return { ops: [{ op: 'add', ref: 'n', kind: 'rule', text: '動量在高頻失效', basis: '案例', sources: [a], ...ANN }, { op: 'supersede', id: 'C1', by: '@n', reason: '新研究', validPeriod: '較早之研究', sources: [a] }], skipped: [{ note: b, reason: '無可用知識' }, { note: c, reason: '離題' }] }
            },
            accept: 'fail',
        })
        const r2 = await runStage(env, ai2)
        assert.equal(r2.report.detail.degraded, 1)
        assert.ok(has(r2.log, /^WARN 提煉降級\[動量\]：終審失敗/), r2.log.lines.join('\n'))
        const st2 = readState(env, rec.id)
        assert.equal(st2.claims.find((c) => c.id === 'C1').status, 'active', '未審之取代不套用')
        assert.deepEqual(st2.pendingReview.map((e) => [e.op.op, e.op.by, e.reason]), [['supersede', 'C2', '終審失敗']])
        assert.equal(st2.consumed.length, 6, '待審之出處算涵蓋')
        assert.match(readMd(rec.file).body, /待審：〔C1〕擬取代（由〔C2〕）/)
        assert.equal(st2.changelog.at(-1).accepted, false)
        assert.equal((await env.stores.cores.get(rec.id)).pendingReview, 1, 'cores 記錄鏡像待審數(無待提煉筆記時亦排待審專步)')
        // 第三輪:無新筆記(選題選不到),但待審存在 → 另排待審專步,只呼叫終審席
        const ai3 = scriptAi({ draft: 'fail', accept: () => ({ verdicts: [{ i: 0, action: 'keep' }] }) })
        const r3 = await runStage(env, ai3, { parallel: 1 })
        assert.deepEqual(ai3.roles(), ['accept'])
        assert.match(ai3.calls[0].prompt, /前次未經終審裁決而暫緩之取代／撤回操作/)
        assert.match(ai3.calls[0].prompt, /^i=0 \{"op":"supersede","id":"C1","by":"C2".*"sources":\["N1"\]/m, '待審操作之出處以本批代號呈現(對得上【筆記】)')
        assert.match(ai3.calls[0].prompt, /^### N1 /m)
        assert.equal(r3.report.detail.pendingReviewed, 1)
        const st3 = readState(env, rec.id)
        assert.equal(st3.pendingReview.length, 0)
        assert.deepEqual([st3.claims.find((c) => c.id === 'C1').status, st3.claims.find((c) => c.id === 'C1').supersededBy], ['superseded', 'C2'])
    })

    it('狀態檔非本格式版本(v≠3)→ ERROR、本概念跳過:不呼叫 AI、不覆寫狀態檔與 md、不隔離', async () => {
        const env = mkEnv(['c1', 'c2', 'c3'].map((id) => ({ id, concepts: ['波動率'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        const stFile = `${env.dirs.coreState}/${rec.id}.state.json`
        fs.writeFileSync(stFile, JSON.stringify({ ...readState(env, rec.id), v: 2 }), 'utf8')
        await addNotes(env, ['c4', 'c5', 'c6'], ['波動率'])
        const stBefore = fs.readFileSync(stFile, 'utf8')
        const mdBefore = fs.readFileSync(rec.file, 'utf8')
        const ai = scriptAi({ draft: draftAll })
        const { log } = await runStage(env, ai)
        assert.ok(has(log, /^ERROR 提煉\[波動率\]：狀態檔非本格式版本（格式版本 2 非本套件之 3，拒讀/), log.lines.join('\n'))
        assert.equal(ai.calls.length, 0)
        assert.equal(fs.readFileSync(stFile, 'utf8'), stBefore, '狀態檔不動')
        assert.equal(fs.readFileSync(rec.file, 'utf8'), mdBefore, 'md 不動')
        assert.equal(fs.existsSync(`${env.dirs.state}/core/archive`) && fs.readdirSync(`${env.dirs.state}/core/archive`).length, false, '不隔離')
    })

    it('狀態檔遺失:無 .prev → 跳過並 ERROR(不自空狀態重建、不覆寫);有 .prev → 立即修復(高水位、落盤、投影;WARN)後照常處理', async () => {
        const notes = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'].map((id) => ({ id, concepts: ['因子'] }))
        const env = mkEnv(notes, { extract: { perRun: 1 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        const stFile = `${env.dirs.coreState}/${rec.id}.state.json`
        const mdBefore = fs.readFileSync(rec.file, 'utf8')
        fs.rmSync(stFile)
        const ai1 = scriptAi({ draft: draftAll })
        const r1 = await runStage(env, ai1)
        assert.ok(has(r1.log, /^ERROR 提煉\[因子\]：核心記錄存在而狀態檔遺失且無上一版可還原/), r1.log.lines.join('\n'))
        assert.equal(ai1.calls.length, 0)
        assert.equal(fs.existsSync(stFile), false, '不自空狀態重建、不寫檔')
        assert.equal((await env.stores.cores.get(rec.id)).version, 1, '記錄不動')
        assert.equal(fs.readFileSync(rec.file, 'utf8'), mdBefore, 'md 不動')
        // 另一庫:跑兩版(產生 .prev)後刪狀態 → 由 .prev 還原
        const env2 = mkEnv(notes, { extract: { perRun: 1 } })
        await runStage(env2, scriptAi({ draft: draftAll }))
        await runStage(env2, scriptAi({ draft: draftAll }))
        const rec2 = (await env2.stores.cores.select())[0]
        assert.equal(readState(env2, rec2.id).version, 2)
        fs.rmSync(`${env2.dirs.coreState}/${rec2.id}.state.json`)
        const r2 = await runStage(env2, scriptAi({ draft: draftAll }))
        assert.ok(has(r2.log, /^WARN 提煉狀態還原\[因子\]：狀態檔遺失，已由上一版還原並落盤（落後一次寫入/), r2.log.lines.join('\n'))
        assert.equal(r2.log.lines.filter((l) => /提煉狀態還原\[因子\]/.test(l)).length, 1, '維護段已修復 → 選中時不再還原')
        assert.ok(!has(r2.log, /提煉手改另存/), '還原之狀態比磁碟 md 舊:修復時把磁碟現值之雜湊記入已知雜湊,不誤報手改')
        const back = readState(env2, rec2.id)
        assert.equal(back.version, 2, '自 .prev(v1)還原後照常提煉 → v2')
        assert.ok(back.rev > 2, 'rev 延續遞增(不歸 1)')
        assert.equal((await env2.stores.cores.get(rec2.id)).rev, back.rev, '投影與狀態同步')
        assert.equal(fs.readdirSync(`${env2.dirs.state}/core/dirty`).length, 0, '修復之投影已完成(無 dirty 殘留)')
    })

    it('維護段全量處置壞檔(不必被選中):上一版救得回者修復——隔離壞檔(保留 .prev)、高水位、立即落盤(rev 延續)、投影,計 repaired;單輪逾 5 份即熔斷(WARN 須見、其餘留待下輪);救不回者隔離並 ERROR', async () => {
        const concepts = ['甲', '乙', '丙', '丁', '戊', '己', '庚']
        const env = mkEnv(concepts.flatMap((c, k) => [1, 2, 3].map((n) => ({ id: `z${k}${n}`, concepts: [c] }))), { extract: { perRun: 7 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const cores = await env.stores.cores.select()
        assert.equal(cores.length, 7)
        const prevDir = `${env.dirs.state}/core/prev`
        const archive = `${env.dirs.state}/core/archive`
        fs.mkdirSync(prevDir, { recursive: true })
        const bad = '{"v":3,"claims":"壞'
        for (const c of cores) {
            fs.copyFileSync(`${env.dirs.coreState}/${c.id}.state.json`, `${prevDir}/${c.id}.state.prev.json`)
            fs.writeFileSync(`${env.dirs.coreState}/${c.id}.state.json`, bad, 'utf8')
        }
        const ai = scriptAi({ draft: 'fail' })
        const r1 = await runStage(env, ai)
        assert.equal(ai.calls.length, 0, '無新筆記 → 無 AI;修復純程式')
        assert.equal(r1.report.detail.repaired, 5, '熔斷:單輪修復 5 份即停手')
        assert.ok(has(r1.log, /^WARN 提煉狀態檔熔斷：本輪已修復或隔離 5 份核心狀態檔（上限 5），其餘留待下輪/), r1.log.lines.join('\n'))
        assert.equal(r1.log.lines.filter((l) => /^WARN 提煉狀態還原\[.+\]：狀態檔毀損（.*），已隔離為 .*corrupt-\d+/.test(l)).length, 5)
        const stillBad = cores.filter((c) => fs.readFileSync(`${env.dirs.coreState}/${c.id}.state.json`, 'utf8') === bad)
        assert.equal(stillBad.length, 2, '其餘 2 份原檔不動、留待下輪')
        assert.equal(fs.readdirSync(archive).filter((f) => /\.state\.json\.corrupt-/.test(f)).length, 5, '壞檔隔離(不刪)')
        for (const c of cores.filter((x) => !stillBad.includes(x))) {
            const st = readState(env, c.id)
            const rec = await env.stores.cores.get(c.id)
            assert.deepEqual([st.version, st.rev, rec.rev, st.claims.length], [1, c.rev + 1, c.rev + 1, 3], `${c.id}:自上一版落盤(rev 延續＋1)、投影同步`)
            assert.ok(fs.existsSync(`${prevDir}/${c.id}.state.prev.json`), `${c.id}:隔離保留 .prev`)
        }
        assert.equal(fs.readdirSync(`${env.dirs.state}/core/dirty`).length, 0)
        // 下輪:熔斷重計 → 其餘 2 份修復
        const r2 = await runStage(env, scriptAi({ draft: 'fail' }))
        assert.equal(r2.report.detail.repaired, 2)
        assert.ok(!has(r2.log, /提煉狀態檔熔斷/))
        assert.equal(cores.filter((c) => fs.readFileSync(`${env.dirs.coreState}/${c.id}.state.json`, 'utf8') === bad).length, 0)
        // 救不回者(無 .prev):隔離並 ERROR(須見「本概念跳過」),記錄與 md 不動
        const env3 = mkEnv(['y1', 'y2', 'y3'].map((id) => ({ id, concepts: ['辛'] })))
        await runStage(env3, scriptAi({ draft: draftAll }))
        const rec3 = (await env3.stores.cores.select())[0]
        fs.writeFileSync(`${env3.dirs.coreState}/${rec3.id}.state.json`, bad, 'utf8')
        const r3 = await runStage(env3, scriptAi({ draft: 'fail' }))
        assert.ok(has(r3.log, /^ERROR 提煉\[辛\]：狀態檔毀損且無上一版（.*），已隔離為 .*corrupt-\d+；本概念跳過、不覆寫。請自備份或版控還原狀態檔$/), r3.log.lines.join('\n'))
        assert.equal(fs.existsSync(`${env3.dirs.coreState}/${rec3.id}.state.json`), false)
        assert.equal(r3.report.detail.repaired, 0)
        assert.equal((await env3.stores.cores.get(rec3.id)).version, 1, '記錄不動')
    })

    it('登錄先於落盤:待判登錄之 ctx 記本次落盤後之 rev;落盤失敗(CAS)→ 本次新登錄撤銷結案(HOLD_UNDO_HOW)、既有登錄寫回前像(不改 tries、原因);維護段清掃結案登錄之 rev 大於現 rev 者（落盤未完成）與筆記已刪除者,置於重送名單之前', async () => {
        const env = mkEnv(['w1', 'w2', 'w3'].map((id) => ({ id, concepts: ['撤銷'] })))
        await runStage(env, scriptAi({ draft: onlyFirst }))
        const rec = (await env.stores.cores.select())[0]
        const stFile = `${env.dirs.coreState}/${rec.id}.state.json`
        assert.equal(readState(env, rec.id).rev, 1)
        // w3 已有一筆舊登錄(提示詞識別不同 → 本輪重送)
        const keyOf = (nid) => `extract-note:${rec.id}:${nid}:ES15`
        await putHold(env.stores.holds, { object: 'extract-note', oid: `${rec.id}:w3`, std: 'ES15', reason: 'pre', next: 'n', owner: 'pipeline', ctx: { promptId: 'old' } }, '2026-10-01T00:00:00+08:00')
        // 第二次仍未涵蓋 → w2、w3 逾限出隊 → 登錄(w2 新登、w3 再登)→ 落盤前他處改動 → CAS 失敗 → 補償
        const intruder = defineMw({
            name: 'intruder',
            handle: async (msg, ctx, next) => {
                const s = JSON.parse(fs.readFileSync(stFile, 'utf8'))
                fs.writeFileSync(stFile, JSON.stringify({ ...s, rev: s.rev + 5 }), 'utf8')
                return next(msg)
            },
        })
        const r2 = await runStage(env, scriptAi({ draft: { ops: [], skipped: [] } }), { tap: { renderState: { after: [intruder] } } })
        assert.ok(has(r2.log, /^ERROR 提煉\[撤銷\]：核心狀態已被他處改動/), r2.log.lines.join('\n'))
        const w2 = await env.stores.holds.get(keyOf('w2'))
        assert.deepEqual([w2.status, w2.how, w2.ctx.rev], ['resolved', HOLD_UNDO_HOW, '2'], '新登者結案(撤銷);ctx.rev＝本次落盤後之 rev(載入時 1 → 2)')
        const w3 = await env.stores.holds.get(keyOf('w3'))
        assert.deepEqual([w3.status, w3.tries, w3.reason, w3.ctx.promptId], ['open', 0, 'pre', 'old'], '既有登錄寫回前像(再登會 tries＋1、換原因與提示詞識別——皆還原)')
        const st2 = readState(env, rec.id)
        assert.deepEqual([st2.rev, st2.skipped.filter((x) => x.reason === '未涵蓋逾限').length], [6, 0], '狀態未落盤(他處之內容保留)')
        // 假待判:登錄之 rev 大於現 rev(落盤未完成而撤銷未及)→ 清掃結案;筆記已刪除者亦結案;其餘未結者不動。清掃在重送名單之前:被結案者不重送
        await putHold(env.stores.holds, { object: 'extract-note', oid: `${rec.id}:w2`, std: 'ES15', reason: 'ghost', next: 'n', owner: 'pipeline', ctx: { promptId: 'old', rev: '99' } }, '2026-10-02T00:00:00+08:00')
        await putHold(env.stores.holds, { object: 'extract-note', oid: `${rec.id}:zz`, std: 'ES15', reason: 'gone', next: 'n', owner: 'pipeline', ctx: { promptId: 'old', rev: '1' } }, '2026-10-02T00:00:00+08:00')
        const ai3 = scriptAi({ draft: { ops: [], skipped: [] } })
        const r3 = await runStage(env, ai3)
        assert.equal(r3.report.detail.holdsSwept, 2)
        assert.ok(has(r3.log, /^INFO 提煉待判清掃：2 筆已不適用之未結待判結案/), r3.log.lines.join('\n'))
        assert.deepEqual([(await env.stores.holds.get(keyOf('w2'))).how, (await env.stores.holds.get(keyOf('zz'))).how], [`${HOLD_STALE_HOW_PREFIX}：落盤未完成`, `${HOLD_STALE_HOW_PREFIX}：筆記已刪除`])
        assert.equal((await env.stores.holds.get(keyOf('w3'))).status, 'open', '仍適用者不動')
        const resent = batchOf(ai3.calls.find((c) => c.role === 'draft').prompt).map((x) => x.title)
        assert.ok(resent.includes('w3') && !resent.includes('zz'), `被清掃者不重送:${resent}`)
    })

    it('md 讀不到之筆記計重送次數(同未涵蓋),達上限即出隊並登錄待判(ES15;理由載明 md 讀不到);無可用筆記而有出隊者純程式落盤(不呼叫 AI)', async () => {
        const env = mkEnv(['m1', 'm2', 'm3'].map((id) => ({ id, concepts: ['讀不到'] })))
        fs.rmSync(`${env.dirs.notes}/m2.md`)
        fs.rmSync(`${env.dirs.notes}/m3.md`)
        const ai1 = scriptAi({ draft: draftAll })
        const r1 = await runStage(env, ai1)
        assert.equal(r1.report.detail.mdMissing, 2)
        assert.deepEqual(batchOf(ai1.calls.find((c) => c.role === 'draft').prompt).map((x) => x.title), ['m1'], '讀不到者不入批')
        const rec = (await env.stores.cores.select())[0]
        assert.deepEqual(ledgerOf(env, 'concept|讀不到').noteTries, { m2: 1, m3: 1 }, '計重送次數')
        const ai2 = scriptAi({ draft: draftAll })
        const r2 = await runStage(env, ai2)
        assert.equal(ai2.calls.length, 0, '無可用筆記 → 不呼叫 AI')
        assert.ok(has(r2.log, /^INFO 提煉無可用筆記\[讀不到\]：本批筆記之 md 皆讀不到，其中 2 篇逾限出隊（純程式落盤，不呼叫 AI）/), r2.log.lines.join('\n'))
        const st = readState(env, rec.id)
        assert.deepEqual([st.rev, st.version, st.consumed.sort(), st.skipped.filter((x) => x.reason === '未涵蓋逾限').map((x) => x.note).sort()], [2, 1, ['m1', 'm2', 'm3'], ['m2', 'm3']], '出隊入 skipped、只升 rev')
        const hs = (await env.stores.holds.select()).filter((h) => h.std === 'ES15')
        assert.deepEqual(hs.map((h) => [h.oid, h.status, h.owner, h.ctx.rev]).sort(), [[`${rec.id}:m2`, 'open', 'pipeline', '2'], [`${rec.id}:m3`, 'open', 'pipeline', '2']])
        assert.ok(hs.every((h) => /^md 讀不到逾限：提煉「讀不到」多次讀不到此篇之 md 而出隊$/.test(h.reason)), hs.map((h) => h.reason).join('\n'))
        assert.equal(r2.report.detail.notesHeld, 2)
        assert.equal((await env.stores.cores.get(rec.id)).rev, 2, '投影同步')
    })

    it('失敗計數(stat.failed)計全部模式:待審裁決失敗亦計;無事可做(no-notes、no-pending)與截止不計', async () => {
        const env = mkEnv(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => ({ id, concepts: ['計數'] })), { extract: { perRun: 1 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        // 第二批:終審失敗 → 取代存待審(降級,不計失敗)
        const sup = (p) => ({ ops: [{ op: 'add', ref: 'n', kind: 'rule', text: '新主張', basis: '案例', sources: [codesIn(p)[0]], ...ANN }, { op: 'supersede', id: 'C1', by: '@n', reason: '新研究', validPeriod: '較早之研究', sources: [codesIn(p)[0]] }], skipped: [{ note: codesIn(p)[1], reason: '離題' }, { note: codesIn(p)[2], reason: '離題' }] })
        const r2 = await runStage(env, scriptAi({ draft: sup, accept: 'fail' }))
        assert.deepEqual([r2.report.detail.degraded, r2.report.stats.fail], [1, 0])
        assert.equal(readState(env, (await env.stores.cores.select())[0].id).pendingReview.length, 1)
        // 無新筆記:待審專步之終審席失敗 → 計失敗;提煉無可用筆記不計
        const r3 = await runStage(env, scriptAi({ draft: 'fail', accept: 'fail' }), { parallel: 1 })
        assert.ok(has(r3.log, /^WARN 提煉\[計數\]：待審裁決失敗（/), r3.log.lines.join('\n'))
        assert.equal(r3.report.stats.fail, 1, '待審裁決失敗計入')
        // 待審裁決成功(C1 被取代 → 本質待重寫)後:本質專步失敗亦計;本質補成後無事可做 → 不計
        await runStage(env, scriptAi({ draft: 'fail', accept: keepAll }), { parallel: 1 })
        const r5 = await runStage(env, scriptAi({ draft: 'fail' }), { parallel: 1 })
        assert.ok(has(r5.log, /^WARN 提煉\[計數\]：本質失敗（/), r5.log.lines.join('\n'))
        assert.equal(r5.report.stats.fail, 1, '本質專步失敗計入')
        await runStage(env, scriptAi({ draft: { ops: [{ op: 'essence', text: '新本質', claims: ['C2'], reason: '取代後改寫' }], skipped: [] } }), { parallel: 1 })
        const r7 = await runStage(env, scriptAi({ draft: 'fail' }), { parallel: 1 })
        assert.equal(r7.report.stats.fail, 0, '無事可做不計')
    })

    it('中斷補做:dirty 標記殘留 → 下輪無 AI 以狀態重建投影(md、cores 記錄);投影 rev 落後者載入時對帳', async () => {
        const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['配對交易'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        fs.rmSync(rec.file)
        await env.stores.cores.replace({ ...rec, rev: 0, version: 0 })
        fs.mkdirSync(`${env.dirs.state}/core/dirty`, { recursive: true })
        fs.writeFileSync(`${env.dirs.state}/core/dirty/${rec.id}`, 'x', 'utf8')
        const ai = scriptAi({ draft: 'fail' })
        const { report, log } = await runStage(env, ai)
        assert.equal(report.detail.repaired, 1)
        assert.equal(ai.calls.length, 0, '無 AI')
        assert.ok(fs.existsSync(rec.file))
        assert.equal((await env.stores.cores.get(rec.id)).rev, 1)
        assert.ok(has(log, /^WARN 提煉投影補正\[配對交易\]/))
        assert.equal(fs.readdirSync(`${env.dirs.state}/core/dirty`).length, 0)
    })

    it('CAS:載入後狀態被他處改動 → 不寫入、不寫投影、記 ERROR', async () => {
        const env = mkEnv(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => ({ id, concepts: ['套利'] })), { extract: { perRun: 1 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        const stFile = `${env.dirs.coreState}/${rec.id}.state.json`
        const intruder = defineMw({
            name: 'intruder',
            handle: async (msg, ctx, next) => {
                const s = JSON.parse(fs.readFileSync(stFile, 'utf8'))
                fs.writeFileSync(stFile, JSON.stringify({ ...s, rev: s.rev + 5 }), 'utf8')
                return next(msg)
            },
        })
        const { log } = await runStage(env, scriptAi({ draft: draftAll }), { tap: { renderState: { after: [intruder] } } })
        assert.ok(has(log, /^ERROR 提煉\[套利\]：核心狀態已被他處改動/), log.lines.join('\n'))
        assert.equal(readState(env, rec.id).version, 1, '他處之內容保留')
        assert.equal((await env.stores.cores.get(rec.id)).version, 1)
    })

    it('失敗帳:起草全敗 → tries+1、lastTriedAt、筆記不消耗;批內未涵蓋 → 重送,達 2 次標已用並記「未涵蓋逾限」', async () => {
        const env = mkEnv(['g1', 'g2', 'g3'].map((id) => ({ id, concepts: ['風險平價'] })))
        const r0 = await runStage(env, scriptAi({ draft: 'fail' }))
        assert.ok(has(r0.log, /^WARN 提煉\[風險平價\]：提煉失敗（起草全敗）/), r0.log.lines.join('\n'))
        const ledger = ledgerOf(env)
        assert.equal(ledger['concept|風險平價'].tries, 1)
        assert.ok(ledger['concept|風險平價'].lastTriedAt)
        assert.equal((await env.stores.cores.select()).length, 0)
        // 只引用一篇、不交代另兩篇 → 未涵蓋兩篇重送
        await runStage(env, scriptAi({ draft: onlyFirst }))
        const rec = (await env.stores.cores.select())[0]
        let st = readState(env, rec.id)
        assert.equal(st.consumed.length, 1)
        const l2 = ledgerOf(env, 'concept|風險平價')
        assert.equal(l2.tries, 0, '成功即清除')
        assert.equal(Object.keys(l2.noteTries).length, 2)
        await runStage(env, scriptAi({ draft: { ops: [], skipped: [] } }))
        st = readState(env, rec.id)
        assert.equal(st.consumed.length, 3, '第二次仍未涵蓋 → 逾限標已用')
        assert.equal(st.skipped.filter((x) => x.reason === '未涵蓋逾限').length, 2)
        assert.equal(st.version, 1, '只落帳不改版號')
        assert.equal(st.rev, 2, '但升 rev(首輪失敗不寫;次輪 rev 1;本輪只落帳 rev 2)')
    })

    it('逐次失敗 WARN:錯誤只有裸離開碼時附 CLI 輸出開頭(額度用盡之原因只在 stdout);錯誤本身有內容者不附', async () => {
        const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['額度'] })))
        const { log } = await runStage(env, scriptAi({ draft: draftAll, d1: 'limit', d2: 'fail' }))
        assert.ok(has(log, /^WARN 提煉事件\[額度\] 起草1 d1：exec（Exit code 1）｜You've hit your session limit · resets 10:30am \(Asia\/Taipei\)$/), log.lines.join('\n'))
        assert.ok(has(log, /^WARN 提煉事件\[額度\] 起草2 d2：exec（替身失敗）$/), '錯誤有內容者不附輸出')
        assert.equal((await env.stores.cores.select()).length, 1, '一席失敗不影響其餘起草')
    })

    it('時間預算截止(shouldStop)→ 本次不套用、不計失敗(不記 tries),WARN 寫明下輪再做', async () => {
        const env = mkEnv(['s1', 's2', 's3'].map((id) => ({ id, concepts: ['停損'] })))
        const ai = scriptAi({ draft: draftAll })
        const { log } = await runStage(env, ai, { shouldStop: () => true })
        assert.equal(ai.calls.length, 0, '截止後不開下一棒')
        assert.ok(has(log, /^WARN 提煉\[停損\]：提煉因時間預算截止未完成（本次不套用、不計失敗，下輪再做）$/), log.lines.join('\n'))
        assert.equal((await env.stores.cores.select()).length, 0)
        const led = ledgerOf(env, 'concept|停損') || {}
        assert.equal(led.tries || 0, 0)
    })

    it('分身:同鍵兩核心 → 綁定主核心(版本高者)、落盤後分身標 merged、原文封存、md 改轉址頁', async () => {
        setConceptFold((s) => s.replace(/归/g, '歸'))
        try {
            const env = mkEnv(['h1', 'h2', 'h3'].map((id) => ({ id, concepts: ['均值回歸'] })))
            const store = createCoreStore({ dir: env.dirs.coreState })
            const mk = async (id, concept, version) => {
                const file = `${env.dirs.core}/${id}.md`
                const written = store.save(id, { ...emptyState({ coreId: id, concept, scope: 'concept' }), version }, { expectRev: null })
                writeMd(file, { concept, type: 'core', version }, `# 核心知識：${concept}\n\n## 本質\n\n${concept} 舊文`)
                await env.stores.cores.replace({ id, concept, scope: 'concept', file, version, rev: written.rev, noteCount: 2, noteIds: [], updatedAt: '2026-09-01T00:00:00+08:00' })
            }
            await mk('main-core', '均值回歸', 9)
            await mk('twin-core', '均值回归', 1)
            const { log } = await runStage(env, scriptAi({ draft: draftAll }))
            const twin = await env.stores.cores.get('twin-core')
            assert.deepEqual([twin.status, twin.mergedInto], ['merged', 'main-core'])
            assert.equal(readMd(twin.file).front.type, 'redirect')
            assert.match(fs.readFileSync(twin.archivedFile, 'utf8'), /均值回归 舊文/)
            assert.equal(fs.existsSync(`${env.dirs.coreState}/twin-core.state.json`), false, '分身之狀態檔封存(改名移開)')
            assert.ok(has(log, /^WARN 提煉分身合併\[均值回归\]/), log.lines.join('\n'))
            assert.equal(readState(env, 'main-core').version, 10)
        }
        finally {
            resetConceptFold()
        }
    })

    it('分身轉址頁之本文可經 domain 之 renderTwinRedirect 覆寫(前言之機制鍵由提煉段寫);兩輪冪等:不重封存、不重改寫', async () => {
        setConceptFold((s) => s.replace(/归/g, '歸'))
        try {
            const env = mkEnv(['t1', 't2', 't3'].map((id) => ({ id, concepts: ['均值回歸'] })))
            env.domains.extract = { ...createExtractDomain({}), renderTwinRedirect: ({ twin, into, archivedFile }) => `# ${twin.concept}\n\n→ ${into.concept}（舊文：${path.basename(archivedFile)}）` }
            const store = createCoreStore({ dir: env.dirs.coreState })
            const mk = async (id, concept, version) => {
                const file = `${env.dirs.core}/${id}.md`
                const written = store.save(id, { ...emptyState({ coreId: id, concept, scope: 'concept' }), version }, { expectRev: null })
                writeMd(file, { concept, type: 'core', version }, `# 核心知識：${concept}\n\n## 本質\n\n${concept} 舊文`)
                await env.stores.cores.replace({ id, concept, scope: 'concept', file, version, rev: written.rev, noteCount: 2, noteIds: [], updatedAt: '2026-09-01T00:00:00+08:00' })
            }
            await mk('main-core', '均值回歸', 9)
            await mk('twin-core', '均值回归', 1)
            await runStage(env, scriptAi({ draft: draftAll }))
            const twin = await env.stores.cores.get('twin-core')
            const md = readMd(twin.file)
            assert.deepEqual([md.front.type, md.front.concept, md.front.mergedInto], ['redirect', '均值回归', 'main-core'], '機制鍵由提煉段寫')
            assert.equal(md.body.trim(), `# 均值回归\n\n→ 均值回歸（舊文：${path.basename(twin.archivedFile)}）`)
            // cores 記錄之契約:主核心之欄位;分身另有 mergedInto、mergedAt、archivedFile
            const main = await env.stores.cores.get('main-core')
            assert.deepEqual(Object.keys(main).sort(), ['concept', 'essence', 'file', 'id', 'nextIdHigh', 'noteCount', 'noteIds', 'pendingReview', 'proposedAt', 'rev', 'scope', 'status', 'updatedAt', 'version'])
            assert.deepEqual([twin.status, twin.mergedInto, typeof twin.mergedAt, fs.existsSync(twin.archivedFile)], ['merged', 'main-core', 'string', true])
            const text1 = fs.readFileSync(twin.file, 'utf8')
            const archived1 = fs.readdirSync(path.dirname(twin.archivedFile)).sort()
            await runStage(env, scriptAi({ draft: draftAll }))
            const again = await env.stores.cores.get('twin-core')
            assert.equal(again.archivedFile, twin.archivedFile, '不重封存')
            assert.equal(fs.readFileSync(twin.file, 'utf8'), text1, '不重改寫')
            assert.deepEqual(fs.readdirSync(path.dirname(twin.archivedFile)).sort(), archived1, '封存目錄不增')
        }
        finally {
            resetConceptFold()
        }
    })

    it('新核心 id 撞號:同名類別核心占用 slug → 概念層新核心重新種子,兩者互不覆寫', async () => {
        const env = mkEnv(['i1', 'i2', 'i3'].map((id) => ({ id, concepts: ['方法與技術'] })))
        const catId = slugify('方法與技術', 'core|方法與技術')
        await env.stores.cores.replace({ id: catId, concept: '方法與技術', scope: 'category', file: `${env.dirs.core}/${catId}.md`, version: 3, noteCount: 12, noteIds: [] })
        await runStage(env, scriptAi({ draft: draftAll }))
        const all = await env.stores.cores.select()
        assert.equal(all.length, 2)
        const concept = all.find((c) => c.scope === 'concept')
        assert.notEqual(concept.id, catId)
        assert.equal((await env.stores.cores.get(catId)).version, 3, '類別核心不被覆寫')
    })

    it('整併:有效主張逾上限 → 先以 3+3 整併(起草用整併提示詞、不消耗筆記)再照常提煉;整併嘗試記入失敗帳', async () => {
        const env = mkEnv(['j1', 'j2', 'j3', 'j4', 'j5', 'j6'].map((id) => ({ id, concepts: ['動能'] })), { extract: { claimsCap: 2, consolidateEvery: 1, perRun: 1 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        const ai = scriptAi({ draft: (p) => (/的整併員/.test(p) ? { ops: [{ op: 'merge', into: 'C1', from: ['C2'], reason: '同義' }] } : draftAll(p)) })
        const { report } = await runStage(env, ai)
        assert.equal(report.detail.consolidated, 1)
        assert.equal(report.detail.batches, 1, '整併不取代提煉批次')
        const st = readState(env, rec.id)
        assert.equal(st.claims.find((c) => c.id === 'C2').mergedInto, 'C1')
        assert.ok(st.lastConsolidated > 0)
        const led = ledgerOf(env, 'concept|動能')
        assert.equal(led.consolidate.ok, true)
        const R = ['draft', 'draft', 'draft', 'integrate', 'audit', 'accept']
        assert.deepEqual(ai.roles(), [...R, ...R], '整併與提煉批次各走一次 3+3')
        assert.match(ai.calls[0].prompt, /的整併員/)
        assert.match(ai.calls[5].prompt, /以下是整併員對「動能」提出之整併操作/, '整併之終審提示詞說明是整併')
        assert.match(ai.calls[6].prompt, /的提煉器/)
    })

    it('不可逆操作漏裁決:整併之合併本次不採(不入待審、記日誌);提煉批次之取代改存待審(理由「終審未明列裁決」),非終態之新增照套;一條有效裁決都沒有 → 等同終審失敗(整併整份不套)', async () => {
        const env = mkEnv(['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => ({ id, concepts: ['流動性'] })), { extract: { claimsCap: 2, consolidateEvery: 1, perRun: 1 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        // 終審只裁決非終態之操作(新增、關聯)——終態者(合併、取代)漏列;整併只出一條合併 → 一條有效裁決都沒有(終審 §3 D5i:等同終審失敗)
        const skipTerminal = (p) => ({ verdicts: acceptOps(p).filter((x) => !['merge', 'supersede'].includes(x.op.op)).map((x) => ({ i: x.i, action: 'keep' })) })
        const { log } = await runStage(env, scriptAi({
            draft: (p) => {
                if (/的整併員/.test(p)) return { ops: [{ op: 'merge', into: 'C1', from: ['C2'], reason: '同義' }] }
                const [a, b, c] = codesIn(p)
                return { ops: [{ op: 'add', ref: 'n', kind: 'rule', text: '新規則', basis: '案例', sources: [a], ...ANN }, { op: 'supersede', id: 'C3', by: '@n', reason: '新研究', validPeriod: '較早之研究', sources: [a] }], skipped: [{ note: b, reason: '離題' }, { note: c, reason: '離題' }] }
            },
            accept: skipTerminal,
        }))
        const st = readState(env, rec.id)
        assert.equal(st.claims.find((c) => c.id === 'C2').status, 'active', '漏裁決之合併不套用')
        assert.ok(has(log, /^WARN 提煉降級\[流動性\]：終審未裁決任何操作：整份不套用$/), log.lines.join('\n'))
        assert.ok(has(log, /^INFO 提煉終審\[流動性\]：1 項不可逆操作未得裁決，擬存待審$/), log.lines.join('\n'))
        assert.equal(st.claims.find((c) => c.id === 'C3').status, 'active', '漏裁決之取代不套用')
        assert.deepEqual(st.pendingReview.map((e) => [e.op.op, e.op.id, e.reason]), [['supersede', 'C3', '終審未明列裁決']])
        assert.ok(st.claims.some((c) => c.text === '新規則'), '非終態之新增照套(未列出者視為 keep)')
    })

    it('追趕:同核心同輪連續多批(每批各自落盤);第二批起須仍有滿批', async () => {
        const env = mkEnv(Array.from({ length: 7 }, (_, i) => ({ id: `k${i}`, concepts: ['市場微結構'] })), { extract: { catchupBatches: 3, notesPerConcept: 3 } })
        const { report } = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(report.detail.batches, 2, '7 篇:第一批 3、第二批 3,剩 1 篇未滿批不再追')
        assert.deepEqual([report.detail.updated, report.detail.bumps, report.stats.out], [1, 2, 1], '「更新 N 則核心」以核心計(巡檢之核心更新數據此),升版次數另計')
        assert.equal((await env.stores.cores.select()).length, 1, '新核心之次批載入同一核心(不自造分身)')
        const rec = (await env.stores.cores.select())[0]
        assert.equal(readState(env, rec.id).consumed.length, 6)
        assert.equal(readState(env, rec.id).version, 2)
    })

    it('閒置輪:①補做久候尾數(既有核心只剩 1～3 篇且久候,一般規則永不入選);②類別後備預設停用', async () => {
        const env = mkEnv(Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, concepts: ['動量'] })), { extract: { minPending: 4, maxWaitDays: 30, notesPerConcept: 12 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        await addNotes(env, ['m6', 'm7'], ['動量'])
        // 尾數 2 篇 < extract.minPending 4:核心剛提煉 → 不入選
        const r1 = await runStage(env, scriptAi({ draft: draftAll }))
        assert.deepEqual([r1.report.detail.concepts, r1.report.detail.tails], [0, 0])
        assert.ok(has(r1.log, /提煉：無累積足量新筆記的概念$/), '類別後備預設停用(不改走類別層)')
        // 核心已久候(上次提煉 40 天前)→ 閒置輪補做尾數
        const aged = new Date(Date.now() - 40 * 86400_000).toISOString()
        await env.stores.cores.replace({ ...rec, proposedAt: aged, updatedAt: aged })
        const r2 = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(r2.report.detail.tails, 1)
        assert.ok(has(r2.log, /補做久候尾數（動量×2）/))
        assert.equal(readState(env, rec.id).consumed.length, 8)
    })

    it('類別後備(開啟時):只收久候孤兒(已屬概念核心者不收)、每輪 1 批;null／false 即停用', async () => {
        const notes = [
            ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, concepts: ['丙'], category: '其他' })),
            { id: 'o1', concepts: ['孤一'], category: '其他' },
            { id: 'o2', concepts: ['孤二'], category: '其他' },
            { id: 'o3', concepts: ['孤三'], category: '其他' },
            { id: 'o4', concepts: [], category: '其他' },
        ]
        const extract = { minNotes: 6, notesPerConcept: 2, catchupBatches: 3, categoryFallback: { minNotes: 3, minGain: 2 } }
        const env = mkEnv(notes, { extract })
        await runStage(env, scriptAi({ draft: draftAll }))
        const concept = (await env.stores.cores.select()).find((c) => c.concept === '丙')
        assert.equal(concept.noteIds.length, 6, '第一輪:概念層(丙)追趕三批')
        const r2 = await runStage(env, scriptAi({ draft: draftAll }))
        assert.ok(has(r2.log, /改走類別層（其他；久候孤兒 4 篇）/), r2.log.lines.join('\n'))
        const cat = (await env.stores.cores.select()).find((c) => c.scope === 'category')
        assert.equal(r2.report.detail.batches, 1, '類別目標每輪 1 批')
        assert.equal(cat.noteIds.length, 2)
        assert.ok(cat.noteIds.every((id) => /^o/.test(id)), '已屬概念核心之筆記不入類別核心')
        for (const off of [null, false]) {
            const e2 = mkEnv(notes, { extract: { ...extract, categoryFallback: off } })
            await runStage(e2, scriptAi({ draft: draftAll }))
            const r = await runStage(e2, scriptAi({ draft: draftAll }))
            assert.equal(r.report.detail.concepts, 0, `categoryFallback:${off}`)
        }
    })

    // 立一則爭議:甲(@x)為一方、另一篇為另一方(另一方寫明適用條件——拆解時只有立場文字之方轉為 pitfall,條件取自該方之 conditions,ES4 要求 pitfall 須有條件)
    const withDispute = (p) => {
        const [a, b, c] = codesIn(p)
        return {
            ops: [
                { op: 'add', ref: 'x', kind: 'rule', text: '大批次時要預熱', basis: '案例', sources: [a], ...ANN },
                { op: 'dispute_add', question: '預熱是否必要', sides: [{ position: '需要', claims: ['@x'] }, { position: '小資料微調時可省略', conditions: ['小資料微調'], sources: [b] }] },
                { op: 'add', kind: 'rule', text: '看資料量而定', basis: '案例', sources: [c], ...ANN },
                { op: 'essence', text: '預熱是否必要依資料量而定', claims: ['@x'], reason: '首版' },
            ],
            skipped: [],
        }
    }

    it('拆解硬配之爭議:起草提 dispute_dissolve、終審漏裁決 → 存待審;下輪待審專步保留 → 爭議入沿革、只有立場文字之方轉主張', async () => {
        const env = mkEnv(['d1', 'd2', 'd3'].map((id) => ({ id, concepts: ['學習率'] })))
        await runStage(env, scriptAi({ draft: withDispute }), {}, { clock: fixedClock('2026-10-01') })
        const rec = (await env.stores.cores.select())[0]
        let st = readState(env, rec.id)
        assert.deepEqual([st.disputes.length, st.claims.find((c) => c.id === 'C1').status], [1, 'contested'])
        await addNotes(env, ['d4', 'd5', 'd6'], ['學習率'])
        const dissolve = (p) => {
            const [a, b, c] = codesIn(p)
            return { ops: [{ op: 'dispute_dissolve', id: 'D1', reason: '兩方回答不同情境', kinds: [null, 'pitfall'], annotations: [null, { critique: ANN.critique }] }, { op: 'confirm', id: 'C2', sources: [a] }], skipped: [{ note: b, reason: '離題' }, { note: c, reason: '離題' }] }
        }
        await runStage(env, scriptAi({ draft: dissolve, accept: verdictOn((op) => op.op !== 'dispute_dissolve', { action: 'keep' }, true) }), {}, { clock: fixedClock('2026-10-02') })
        st = readState(env, rec.id)
        assert.deepEqual([st.disputes[0].status, st.pendingReview.map((e) => e.op.op)], ['open', ['dispute_dissolve']])
        assert.match(readMd(rec.file).body, /- 待審：〔D1〕擬拆解：兩方回答不同情境/)
        const ai3 = scriptAi({ draft: 'fail' })
        await runStage(env, ai3, {}, { clock: fixedClock('2026-10-03') })
        assert.deepEqual(ai3.roles(), ['accept'], '無新筆記:只跑待審專步')
        st = readState(env, rec.id)
        const conv = st.claims.find((c) => c.origin === 'dispute')
        assert.deepEqual([st.disputes[0].status, conv.kind, conv.text, st.claims.find((c) => c.id === 'C1').status], ['retracted', 'pitfall', '小資料微調時可省略', 'active'])
        const body = readMd(rec.file).body
        assert.match(body, new RegExp(`- 〔D1〕已拆解（非對立：兩方回答不同情境；各方見〔C1〕〔${conv.id}〕）：預熱是否必要`))
        assert.doesNotMatch(body, /## 爭議與未定論/)
    })

    it('終審之「非對立」(doubt,或以 drop＋非對立表達)→ 爭議照立並記存疑、日誌與計數可見;起草端只在存疑後之下一次看得到', async () => {
        for (const verdict of [{ action: 'doubt', reason: '非對立', note: '兩方回答不同情境' }, { action: 'drop', reason: '非對立', note: '兩方回答不同情境' }]) {
            const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['學習率'] })))
            const r1 = await runStage(env, scriptAi({ draft: withDispute, accept: verdictOn((op) => op.op === 'dispute_add', verdict) }), {}, { clock: fixedClock('2026-10-01') })
            const rec = (await env.stores.cores.select())[0]
            const d = readState(env, rec.id).disputes[0]
            assert.deepEqual([d?.status, d?.doubt?.reason, r1.report.detail.opsDoubted], ['open', '非對立', 1], verdict.action)
            // 刻意更新(Gitea #109 §1):每項理由前插入型別碼〔not-opposed〕(理由與說明之字樣不變)
            assert.ok(has(r1.log, /^INFO 提煉終審存疑\[學習率\]：i=1 dispute_add「預熱是否必要」（〔not-opposed〕非對立：兩方回答不同情境）/), r1.log.lines.join('\n'))
            assert.deepEqual(r1.report.detail.doubtedBy, { 'not-opposed': 1 }, 'detail 之型別計數與日誌行之碼同源,和等於 opsDoubted')
            if (verdict.action === 'drop') assert.ok(has(r1.log, /以「剔除＋非對立」表達，已轉為存疑/), r1.log.lines.join('\n'))
            assert.match(readMd(rec.file).body, / {2}- 終審存疑（v1；非對立）：兩方回答不同情境/)
            // 起草端:存疑產生後之下一次提煉看得到;其後(下一次提煉落盤後)不再呈現,避免同一懷疑逐批累積成拆解
            const seen = []
            const spy = (p, n) => {
                if (n === 1) seen.push(/〔D1〕[^\n]*終審存疑（非對立）/.test(p))
                return { ops: [{ op: 'confirm', id: 'C2', sources: [codesIn(p)[0]] }], skipped: [] }
            }
            await addNotes(env, ['q4'], ['學習率'])
            await runStage(env, scriptAi({ draft: spy }), {}, { clock: fixedClock('2026-10-02') })
            await addNotes(env, ['q5'], ['學習率'])
            await runStage(env, scriptAi({ draft: spy }), {}, { clock: fixedClock('2026-10-03') })
            assert.deepEqual(seen, [true, false], verdict.action)
        }
    })

    it('終審剔除入日誌與計數;保留之爭議所引新主張被剔除(不限理由)→ WARN「終審自相矛盾」＋reviewDisputesCascaded,拒收理由寫明因果', async () => {
        const isJia = (op) => op.text === '甲'
        const draft = (p) => {
            const [a, b, c] = codesIn(p)
            // 甲帶 conditions:下方「fix 改 kind 為 pitfall」之案例,改後之結果須仍合標準(ES4:pitfall 須有條件)才不在定稿被剔
            return { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: '甲', basis: '案例', sources: [a], ...ANN, conditions: ['限定情境'] }, { op: 'dispute_add', question: '預熱是否必要', sides: [{ position: '需要', claims: ['@x'] }, { position: '不需要', sources: [b] }] }, { op: 'add', kind: 'rule', text: '乙', basis: '案例', sources: [c], ...ANN }], skipped: [] }
        }
        const once = async (script) => {
            const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['學習率'] })))
            const r = await runStage(env, scriptAi({ draft, ...script }))
            const rec = (await env.stores.cores.select())[0]
            return { ...r, st: readState(env, rec.id) }
        }
        // 以「離題」剔除所引新主張(有高嚴重度意見,閘門放行)
        const r = await once({ audit: auditHigh(isJia), accept: verdictOn(isJia, { action: 'drop', reason: '離題', note: '與本概念無關' }) })
        assert.deepEqual([r.st.disputes.length, r.report.detail.opsDropped, r.report.detail.reviewConflicts, r.report.detail.reviewDisputesCascaded], [0, 1, 1, 1])
        // 刻意更新(Gitea #109 §1):每項理由前插入型別碼〔off-topic〕／〔dependency-rejected〕(理由字樣不變);detail 之型別計數同源
        assert.ok(has(r.log, /^INFO 提煉終審剔除\[學習率\]：〔off-topic〕離題×1$/), r.log.lines.join('\n'))
        assert.deepEqual([r.report.detail.acceptDroppedBy, r.report.detail.opsRejectedBy], [{ 'off-topic': 1 }, { 'dependency-rejected': 1 }])
        assert.ok(has(r.log, /^WARN 提煉終審自相矛盾\[學習率\]：保留 i=1 dispute_add「預熱是否必要」，卻以「離題」剔除其所引 @\S+（i=0）——所引不成立，該操作連帶拒收$/), r.log.lines.join('\n'))
        assert.ok(has(r.log, /^INFO 提煉拒收\[學習率\]：〔dependency-rejected〕所引 @\S+ 已被終審剔除（離題）×1$/), r.log.lines.join('\n'))
        // 以「重複」剔除(閘門恆放行)亦 WARN
        const rd = await once({ accept: verdictOn(isJia, { action: 'drop', reason: '重複' }) })
        assert.deepEqual([rd.st.disputes.length, rd.report.detail.reviewDisputesCascaded], [0, 1])
        assert.ok(has(rd.log, /^WARN 提煉終審自相矛盾\[學習率\]：保留 i=1 dispute_add「預熱是否必要」，卻以「重複」剔除其所引 @\S+（i=0）/), rd.log.lines.join('\n'))
        // 無高嚴重度意見而以「離題」剔除建設性操作 → 閘門擋下(改為 keep),爭議照立
        const rb = await once({ accept: verdictOn(isJia, { action: 'drop', reason: '離題' }) })
        assert.deepEqual([rb.st.disputes.length, rb.report.detail.verdictBlocked, rb.report.detail.reviewConflicts || 0], [1, 1, 0])
        // 「性質標錯」不剔除新增主張 → 裁決無效、按未裁決保留、爭議照立、無連帶、無 WARN
        const rl = await once({ audit: auditHigh(isJia), accept: verdictOn(isJia, { action: 'drop', reason: '性質標錯', note: '單篇不宜列為規則' }) })
        assert.deepEqual([rl.st.disputes.length, rl.st.claims.some((c) => c.text === '甲'), rl.report.detail.reviewConflicts || 0, rl.report.detail.opsDropped || 0], [1, true, 0, 0])
        assert.ok(!has(rl.log, /自相矛盾/), rl.log.lines.join('\n'))
        assert.ok(has(rl.log, /^INFO 提煉終審\[學習率\]：1 則裁決無效（.*收到「性質標錯」——標籤（種類、證據性質、快照）請以 fix 改正）），相應操作按未裁決處理$/), rl.log.lines.join('\n'))
        // fix 改 kind／basis → 照套新標籤,爭議照立
        const rf = await once({ accept: verdictOn(isJia, { action: 'fix', fields: { kind: 'pitfall', basis: '實務' }, note: '單篇實務經驗' }) })
        const ca = rf.st.claims.find((c) => c.text === '甲')
        assert.deepEqual([rf.st.disputes.length, ca.kind, ca.basis], [1, 'pitfall', '實務'])
        // 以「離題」剔除爭議(高嚴重度意見)、其所引之新主張卻保留 → 理由替代之監測(INFO＋計數;爭議類剔除附 note 入日誌)
        const isDispute = (op) => op.op === 'dispute_add'
        const r1 = await once({ audit: auditHigh(isDispute), accept: verdictOn(isDispute, { action: 'drop', reason: '離題', note: '與學習率無關' }) })
        assert.deepEqual([r1.st.disputes.length, r1.report.detail.reviewDisputeOfftopicKept], [0, 1])
        assert.ok(has(r1.log, /^INFO 提煉終審剔除\[學習率\]：〔off-topic〕離題×1；爭議類 i=1 dispute_add「預熱是否必要」（離題：與學習率無關）$/), r1.log.lines.join('\n'))
        assert.ok(has(r1.log, /^INFO 提煉終審不一致\[學習率\]：以「離題」剔除爭議 i=1 dispute_add「預熱是否必要」，其所引主張卻皆保留$/), r1.log.lines.join('\n'))
    })

    it('審計、修訂、終審所見之觸及條目:含 sides_add 所引主張、被觸及爭議之各方所引主張;終審存疑於觸及條目常駐(起草端已過窗)', async () => {
        const env = mkEnv(['g1', 'g2', 'g3'].map((id) => ({ id, concepts: ['學習率'] })))
        await runStage(env, scriptAi({ draft: withDispute, accept: doubtOn }), {}, { clock: fixedClock('2026-10-01') })
        await addNotes(env, ['g4'], ['學習率'])
        const ai2 = scriptAi({ draft: (p) => ({ ops: [{ op: 'confirm', id: 'C2', sources: [codesIn(p)[0]] }], skipped: [] }) })
        await runStage(env, ai2, {}, { clock: fixedClock('2026-10-02') })
        await addNotes(env, ['g5'], ['學習率'])
        const upd = (p) => ({ ops: [{ op: 'dispute_update', id: 'D1', note: '新證據', sides_add: [{ position: '看資料量', claims: ['C2'] }], sources: [codesIn(p)[0]] }], skipped: [] })
        const ai3 = scriptAi({ draft: upd })
        await runStage(env, ai3, {}, { clock: fixedClock('2026-10-03') })
        assert.match(ai2.calls[0].prompt, /〔D1〕預熱是否必要｜side 0：需要（引〔C1〕）｜side 1：小資料微調時可省略｜終審存疑（非對立）：兩方回答不同情境/, '存疑後之第一次起草看得到')
        const dp = ai3.calls.find((c) => c.role === 'draft').prompt
        const ap = ai3.calls.find((c) => c.role === 'accept').prompt
        assert.doesNotMatch(dp, /〔D1〕[^\n]*終審存疑/, '起草摘要:存疑已過窗')
        assert.match(ap, /〔D1〕預熱是否必要｜side 0：需要（引〔C1〕）｜side 1：小資料微調時可省略｜終審存疑（非對立）：兩方回答不同情境/, '終審所見:存疑常駐、side k')
        assert.match(ap, /〔C1〕\[rule\] 大批次時要預熱[^\n]*有爭議/, '被觸及爭議之各方所引主張一併列出')
        assert.match(ap, /〔C2〕\[rule\] 看資料量而定/, 'sides_add 所引主張列出')
        const rec = (await env.stores.cores.select())[0]
        assert.equal(readState(env, rec.id).disputes[0].sides[2].claims[0], 'C2')
    })

    it('暫緩之不可逆操作所依新項被終審剔除 → 如實記「未存待審」(不以存入待審誤報),待審與 opsWithheld 皆為 0', async () => {
        const env = mkEnv(['h1', 'h2'].map((id) => ({ id, concepts: ['學習率'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        await addNotes(env, ['h3'], ['學習率'])
        const isNew = (op) => op.op === 'add'
        const { report, log } = await runStage(env, scriptAi({
            draft: (p) => ({ ops: [{ op: 'add', ref: 'n', kind: 'rule', text: '新規則', basis: '案例', sources: [codesIn(p)[0]], ...ANN }, { op: 'supersede', id: 'C1', by: '@n', reason: '新證據', validPeriod: '不詳', sources: [codesIn(p)[0]] }], skipped: [] }),
            audit: auditHigh(isNew),
            // 剔除新項(離題)、漏裁決取代(不可逆 → 暫緩)
            accept: verdictOn(isNew, { action: 'drop', reason: '離題' }, true),
        }))
        const rec = (await env.stores.cores.select())[0]
        const st = readState(env, rec.id)
        assert.deepEqual([st.pendingReview.length, report.detail.opsWithheld || 0, st.claims.find((c) => c.id === 'C1').status], [0, 0, 'active'])
        assert.ok(has(log, /^INFO 提煉\[學習率\]：1 項暫緩之不可逆操作所依新項未成立（被終審剔除或拒收），未存待審（supersede（i=1））$/), log.lines.join('\n'))
        assert.ok(has(log, /^INFO 提煉終審\[學習率\]：1 項不可逆操作未得裁決，擬存待審$/), '終審當下之措辭為「擬存待審」(實際存入數於套用後計)')
    })

    it('絕對語氣指標(只計數不擋):本次新寫入或改寫之有效主張;否定不計;只確認出處者不重計;日誌列編號與片語', async () => {
        const env = mkEnv(['t1', 't2', 't3'].map((id) => ({ id, concepts: ['學習率'] })))
        const draft = (p) => {
            const [a, b, c] = codesIn(p)
            return { ops: [{ op: 'add', kind: 'rule', text: '預熱總是能穩定訓練', basis: '案例', sources: [a], ...ANN }, { op: 'add', kind: 'rule', text: '預熱不一定會提升效果', basis: '案例', sources: [b], ...ANN }, { op: 'add', kind: 'rule', text: '在一定程度上可減少發散', basis: '案例', sources: [c], ...ANN }], skipped: [] }
        }
        const r1 = await runStage(env, scriptAi({ draft }))
        assert.equal(r1.report.detail.absoluteTone, 1, '只計「總是」一條')
        assert.ok(has(r1.log, /^INFO 提煉語氣\[學習率\]：1 條新寫主張含絕對語氣（〔C1〕「總是」）$/), r1.log.lines.join('\n'))
        const rec = (await env.stores.cores.select())[0]
        assert.equal(readState(env, rec.id).claims.length, 3, '只計數不擋')
        await addNotes(env, ['t4'], ['學習率'])
        const r2 = await runStage(env, scriptAi({ draft: (p) => ({ ops: [{ op: 'confirm', id: 'C1', sources: [codesIn(p)[0]] }], skipped: [] }) }))
        assert.equal(r2.report.detail.absoluteTone || 0, 0, '文字未改者不重計')
    })

    it('本質專步(檢定標準 ES6):有效主張而無本質之閒置核心 → 以本質提示詞跑 3+3(只收 essence)補上本質;已補者下輪不再排;未補成 → 記退避(1 天內不重試)、其他操作「本 pass 只收 essence」拒收', async () => {
        const noEss = (p) => ({ ops: batchOf(p).map((x, k) => ({ op: 'add', ref: `r${k}`, kind: 'rule', text: `主張 ${x.title}`, basis: '案例', sources: [x.code], ...ANN })), skipped: [] })
        const essLedger = (e) => ledgerOf(e, 'concept|本質')
        // 補成
        const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['本質'] })))
        await runStage(env, scriptAi({ draft: noEss }), {}, { clock: fixedClock('2026-10-01') })
        const rec = (await env.stores.cores.select())[0]
        assert.equal(readState(env, rec.id).essence.text, '', '首版未寫本質')
        const essOp = { op: 'essence', text: '三篇主張之綜合', claims: ['C1', 'C2'], reason: '首版' }
        const ai2 = scriptAi({ draft: () => ({ ops: [essOp], skipped: [] }) })
        const r2 = await runStage(env, ai2, {}, { clock: fixedClock('2026-10-02') })
        const draftPrompt = ai2.calls.find((c) => c.role === 'draft').prompt
        assert.match(draftPrompt, /「本質」這個概念之核心已有 3 條有效主張而尚無本質，請只寫本質/)
        assert.ok(!/【本批筆記】/.test(draftPrompt), '不處理筆記')
        assert.ok(has(r2.log, /^INFO 提煉本質專步：本質（無本質）/), r2.log.lines.join('\n'))
        assert.equal(r2.report.detail.essencePasses, 1)
        const st = readState(env, rec.id)
        assert.deepEqual([st.essence.text, st.essence.claims], ['三篇主張之綜合', ['C1', 'C2']])
        assert.equal(essLedger(env).essenceTries || 0, 0)
        const ai3 = scriptAi({ draft: () => ({ ops: [essOp], skipped: [] }) })
        await runStage(env, ai3, {}, { clock: fixedClock('2026-10-03') })
        assert.equal(ai3.calls.length, 0, '已有本質 → 不再排')
        // 未補成:起草只給新增主張 → 拒收(本 pass 只收 essence)、本質仍缺 → 退避
        const env2 = mkEnv(['f1', 'f2', 'f3'].map((id) => ({ id, concepts: ['本質'] })))
        await runStage(env2, scriptAi({ draft: noEss }), {}, { clock: fixedClock('2026-10-01') })
        const bad = scriptAi({ draft: () => ({ ops: [{ op: 'add', kind: 'rule', text: '夾帶之新主張', basis: '案例', sources: [], ...ANN }], skipped: [] }) })
        const rb = await runStage(env2, bad, {}, { clock: fixedClock('2026-10-02') })
        assert.ok(has(rb.log, /^WARN 提煉\[本質\]：本質專步未補成本質（本質未成立（套用 0、拒收 1：本 pass 只收：essence（收到「add」）））/), rb.log.lines.join('\n'))
        assert.deepEqual([essLedger(env2).essenceTries, essLedger(env2).essenceLastTriedAt, rb.report.detail.essenceFailStreak, rb.report.detail.recheckFailStreak], [1, '2026-10-02T00:00:00+08:00', 1, 0], '本質之連續失敗於本輪統計可見(essenceFailStreak;終審 D9)')
        assert.ok(!readState(env2, (await env2.stores.cores.select())[0].id).claims.some((c) => c.text === '夾帶之新主張'))
        const again = scriptAi({ draft: () => ({ ops: [essOp], skipped: [] }) })
        await runStage(env2, again, {}, { clock: fixedClock('2026-10-02') })
        assert.equal(again.calls.length, 0, '退避期內不重試')
        await runStage(env2, again, {}, { clock: fixedClock('2026-10-04') })
        assert.ok(again.calls.length > 0, '退避期滿再試')
    })

    it('集合必開(holds、checks;判不了者須有處登錄、已檢者須有處記錄):缺任一集合 → 提煉段開工即拋(任何寫入與 AI 呼叫之前;訊息指每輪依賴之 stores),不靜默略過、不計 unheld／unchecked', async () => {
        for (const k of ['holds', 'checks', 'relations']) {
            const env = mkEnv(['u1', 'u2', 'u3'].map((id) => ({ id, concepts: ['待判乙'] })))
            delete env.stores[k]
            const ai = scriptAi({ draft: draftAll })
            await assert.rejects(() => runStage(env, ai), new RegExp(`^Error: 提煉段需要 stores\\.${k} 集合（notes、cores、relations、holds、checks 必開；`), k)
            assert.equal(ai.calls.length, 0, `${k}:開工前即拋,不呼叫 AI`)
            assert.deepEqual(fs.readdirSync(env.dirs.coreState).filter((f) => /\.state\.json$/.test(f)), [], `${k}:無任何寫入`)
        }
        const env = mkEnv(['u4', 'u5', 'u6'].map((id) => ({ id, concepts: ['待判丙'] })))
        delete env.stores.holds
        const e = await runStage(env, scriptAi({ draft: draftAll })).catch((x) => x)
        assert.ok(e.message.endsWith(`${EXTRACT_API_HINT.holdsStore}）`), e.message)
    })

    it('逾限筆記(檢定標準 ES15):出隊即登錄待判(原因、下一步、負責者、期限、當時之提示詞識別);同提示詞不重送;提示詞改了 → 以重審重送(【重審】標「重送」),涵蓋即結案;使用者要求重試亦重送', async () => {
        const env = mkEnv(['h1', 'h2', 'h3'].map((id) => ({ id, concepts: ['待判'] })))
        env.stores.holds = memStore([])
        await runStage(env, scriptAi({ draft: onlyFirst }), {}, { clock: fixedClock('2026-10-01') })
        const r2 = await runStage(env, scriptAi({ draft: { ops: [], skipped: [] } }), {}, { clock: fixedClock('2026-10-02') })
        const rec = (await env.stores.cores.select())[0]
        const held = await env.stores.holds.select()
        assert.equal(held.length, 2, '兩篇逾限 → 兩筆待判')
        const h = held.find((x) => x.oid === `${rec.id}:h2`)
        assert.deepEqual([h.id, h.object, h.std, h.status, h.owner, h.since], [`extract-note:${rec.id}:h2:ES15`, 'extract-note', 'ES15', 'open', 'pipeline', '2026-10-02T00:00:00+08:00'])
        assert.match(h.reason, /^未涵蓋逾限：提煉「待判」多次未交代此篇之去向而出隊/)
        assert.equal(h.next, EXTRACT_HOLD_NEXT.noteOverdue, '下一步取常數:指待判之處置 API(requestRetry、waiveHold),不指執行端之指令')
        assert.doesNotMatch(h.next, /standards (retry|waive)|<登錄鍵>/)
        assert.ok(h.deadline > '2026-10-31' && h.deadline < '2026-11-02', h.deadline)
        assert.match(h.ctx.promptId, /^[0-9a-f]{12}$/)
        assert.equal(r2.report.detail.notesHeld, 2)
        assert.ok(has(r2.log, /^INFO 提煉\[待判\]：2 篇未涵蓋逾限，已登錄待判（ES15/), r2.log.lines.join('\n'))
        // 同提示詞:不重送
        const same = scriptAi({ draft: { ops: [], skipped: [] } })
        await runStage(env, same, {}, { clock: fixedClock('2026-10-03') })
        assert.equal(same.calls.length, 0)
        // 提示詞改了(規則表多一條)→ 重審重送兩篇;起草見「重送」;涵蓋即結案
        const dom = createExtractDomain({})
        env.domains.extract = { ...dom, rules: [...dom.rules, { id: 'extra', priority: 99, text: '新增之規則（測試）' }] }
        const coverC1 = cover('C1')
        const ai4 = scriptAi({ draft: coverC1 })
        const r4 = await runStage(env, ai4, {}, { clock: fixedClock('2026-10-04') })
        const d4 = ai4.calls.find((c) => c.role === 'draft').prompt
        assert.match(d4, /- N1（重送）：前次提煉多次未交代此篇之去向而出隊，今重送一次。/)
        assert.match(d4, /- 重送者：照一般規則處理，務必交代去向/)
        assert.equal(r4.report.detail.holdsResolved, 2)
        assert.deepEqual((await env.stores.holds.select()).map((x) => [x.status, x.how]), [['resolved', '重送已涵蓋'], ['resolved', '重送已涵蓋']])
        assert.deepEqual(readState(env, rec.id).claims.find((c) => c.id === 'C1').sources.sort(), ['h1', 'h2', 'h3'])
        // 使用者要求重試(同提示詞):requestRetry → 下輪只重送該篇;未要求者仍待判
        const env2 = mkEnv(['k1', 'k2', 'k3'].map((id) => ({ id, concepts: ['重試'] })))
        env2.stores.holds = memStore([])
        await runStage(env2, scriptAi({ draft: onlyFirst }), {}, { clock: fixedClock('2026-10-01') })
        await runStage(env2, scriptAi({ draft: { ops: [], skipped: [] } }), {}, { clock: fixedClock('2026-10-02') })
        const k2 = (await env2.stores.holds.select()).find((x) => x.oid.endsWith(':k2'))
        await requestRetry(env2.stores.holds, k2.id, { at: '2026-10-03T00:00:00+08:00' })
        const ai5 = scriptAi({ draft: coverC1 })
        await runStage(env2, ai5, {}, { clock: fixedClock('2026-10-04') })
        const d5 = ai5.calls.find((c) => c.role === 'draft').prompt
        assert.deepEqual(batchOf(d5).map((x) => x.title), ['k2'], '只重送要求重試者')
        assert.equal((await env2.stores.holds.get(k2.id)).status, 'resolved')
        assert.equal((await env2.stores.holds.select()).filter((x) => x.status === 'open').length, 1, '未要求重試者仍待判')
    })

    it('出處支持覆核判不了(檢定標準 ES9):不採該操作;其所引而本批已涵蓋之筆記登錄待判(pipeline)→ 下輪以重審重送 → 覆核成立即結案;重送後仍判不了累計達 supportCheck.maxTries（3）→ 改由使用者判讀', async () => {
        const mk = () => {
            const env = mkEnv(['p1', 'p2', 'p3'].map((id) => ({ id, concepts: ['覆核'] })))
            env.stores.holds = memStore([])
            env.settings.extract.standards.supportCheck.enabled = true
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
            return env
        }
        /** 覆核替身:斷言以 bad 開頭者給 v,其餘 supported */
        const ck = (bad, v) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => ({ index: Number(m[1]), verdict: m[2].startsWith(bad) ? v : 'supported', reason: '出處之內容與斷言之關係說明' })) })
        // 每篇一條主張,另對第一篇多一條「可疑」主張(其出處同為第一篇)
        const draft = (p) => {
            const b = batchOf(p)
            return { ops: [...b.map((x, k) => ({ op: 'add', ref: `r${k}`, kind: 'rule', text: `主張 ${x.title}`, basis: '案例', sources: [x.code], ...ANN })), { op: 'add', kind: 'rule', text: `可疑主張 ${b[0].title}`, basis: '案例', sources: [b[0].code], ...ANN }, { op: 'essence', text: '本質文字', claims: ['@r0'], reason: '首版' }], skipped: [] }
        }
        const env = mk()
        const r1 = await runStage(env, scriptAi({ draft, ck1: ck('可疑', 'supported'), ck2: ck('可疑', 'contradicted'), ck3: ck('可疑', 'unsure') }), {}, { clock: fixedClock('2026-10-01') })
        const rec = (await env.stores.cores.select())[0]
        const s1 = readState(env, rec.id)
        assert.equal(s1.claims.some((c) => c.text.startsWith('可疑主張')), false, '判不了之操作不採')
        assert.equal(s1.claims.length, 3)
        assert.deepEqual([r1.report.detail.supportChecked, r1.report.detail.supportUndetermined, r1.report.detail.notesHeldEs9], [4, 1, 1])
        const h = await env.stores.holds.get(`extract-note:${rec.id}:p1:ES9`)
        assert.deepEqual([h?.status, h?.owner, h?.std], ['open', 'pipeline', 'ES9'])
        assert.match(h.reason, /出處支持覆核判不了（ES9）：本篇所引之操作未納入「覆核」/)
        assert.ok(has(r1.log, /^INFO 提煉\[覆核\]：1 篇因出處支持覆核判不了而有操作未納入，已登錄待判（ES9）/), r1.log.lines.join('\n'))
        // 下輪:重送 p1(【重審】標「重送」);覆核成立 → 結案
        const coverC1 = cover('C1')
        const ai2 = scriptAi({ draft: coverC1, ck1: ck('x', 'supported'), ck2: ck('x', 'supported') })
        const r2 = await runStage(env, ai2, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual(batchOf(ai2.calls.find((c) => c.role === 'draft').prompt).map((x) => x.title), ['p1'], '只重送待判之篇')
        assert.deepEqual([(await env.stores.holds.get(h.id)).status, (await env.stores.holds.get(h.id)).how, r2.report.detail.holdsResolved], ['resolved', '重送後已涵蓋', 1])
        // 另一庫:重送後仍判不了 → 再登(tries＋1、仍由管線重送);累計達 maxTries（預設 3）→ 負責者改 user、下一步為使用者判讀;之後不再自動重送
        const env2 = mk()
        await runStage(env2, scriptAi({ draft, ck1: ck('可疑', 'supported'), ck2: ck('可疑', 'contradicted'), ck3: ck('可疑', 'unsure') }), {}, { clock: fixedClock('2026-10-01') })
        const again = (p) => ({ ops: [{ op: 'add', kind: 'rule', text: `可疑主張 ${batchOf(p)[0].title}`, basis: '案例', sources: [codesIn(p)[0]], ...ANN }, ...codesIn(p).map((c) => ({ op: 'confirm', id: 'C1', sources: [c] }))], skipped: [] })
        const rec2 = (await env2.stores.cores.select())[0]
        await runStage(env2, scriptAi({ draft: again, ck1: ck('可疑', 'supported'), ck2: ck('可疑', 'contradicted'), ck3: ck('可疑', 'unsure') }), {}, { clock: fixedClock('2026-10-02') })
        const h1 = await env2.stores.holds.get(`extract-note:${rec2.id}:p1:ES9`)
        assert.deepEqual([h1.status, h1.owner, h1.tries], ['open', 'pipeline', 1], '第二次判不了:再登、仍由管線重送(未達 3)')
        assert.match(h1.reason, /重送後仍判不了，第 2 次/)
        const ai2b = scriptAi({ draft: again, ck1: ck('可疑', 'supported'), ck2: ck('可疑', 'contradicted'), ck3: ck('可疑', 'unsure') })
        await runStage(env2, ai2b, {}, { clock: fixedClock('2026-10-03') })
        assert.deepEqual(batchOf(ai2b.calls.find((c) => c.role === 'draft').prompt).map((x) => x.title), ['p1'], '第三次仍重送')
        const h2 = await env2.stores.holds.get(`extract-note:${rec2.id}:p1:ES9`)
        assert.deepEqual([h2.status, h2.owner, h2.tries], ['open', 'user', 2], '累計 3 次判不了 → 使用者判讀')
        assert.match(h2.next, /使用者判讀/)
        const ai3 = scriptAi({ draft: coverC1 })
        await runStage(env2, ai3, {}, { clock: fixedClock('2026-10-04') })
        assert.equal(ai3.calls.length, 0, '使用者負責之待判不自動重送')
    })

    it('爭議覆核(檢定標準 ES14):終審存疑之爭議到期 → 專步交覆核席;真對立 → 存疑結案(md 加註、不再排);判不了 → 待判(使用者)、不再排,要求重試後再判並結案;非對立 → 經納入閘拆解;停用＝不排', async () => {
        const mk = (dispute = {}) => {
            const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['學習率'] })), { extract: { standards: { disputeCheck: { perRun: 2, waitDays: 0, ...dispute } } } })
            env.stores.holds = memStore([])
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
            return env
        }
        /** 覆核替身:每項回 v(物件)或 'unsure' */
        const ck = (v) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => (v === 'unsure' ? { index: Number(m[1]), verdict: 'unsure' } : { index: Number(m[1]), ...v })) })
        const OPP = { verdict: 'opposed', reason: '一方說需要預熱一方說可省略' }
        const NOT = { verdict: 'not-opposed', reason: '一方談大批次一方談小資料微調，條件不同可同時成立', kinds: [null, 'pitfall'], annotations: [null, { critique: '只見於單一案例' }] }
        const seed = async (env) => {
            await runStage(env, scriptAi({ draft: withDispute, accept: doubtOn }), {}, { clock: fixedClock('2026-10-01') })
            return (await env.stores.cores.select())[0]
        }
        // 真對立 → 存疑結案
        const env = mk()
        const rec = await seed(env)
        const ai1 = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        const r1 = await runStage(env, ai1, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual(ai1.calls.map((c) => c.role), ['ck1', 'ck2'], '只有覆核兩席(無新筆記、不跑 3+3)')
        const s1 = readState(env, rec.id)
        assert.deepEqual([s1.disputes[0].status, s1.doubtChecks?.D1?.verdict, s1.doubtChecks?.D1?.seats], ['open', 'opposed', 'stub-ck1|stub-ck2'])
        assert.deepEqual([r1.report.detail.disputeDue, r1.report.detail.disputeChecked, r1.report.detail.disputeOpposed, r1.report.detail.disputeHeld], [1, 1, 1, 0])
        assert.match(readMd(rec.file).body, /終審存疑（v1；非對立）：兩方回答不同情境；兩席覆核（v1）：真對立——一方說需要預熱一方說可省略/)
        assert.ok(has(r1.log, /^INFO 提煉爭議覆核專步：學習率（〔D1〕）；到期共 1 則/), r1.log.lines.join('\n'))
        const ai1b = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        await runStage(env, ai1b, {}, { clock: fixedClock('2026-10-03') })
        assert.equal(ai1b.calls.length, 0, '已覆核者不再排')
        // 判不了 → 待判(使用者)、狀態不變;下輪不再排;使用者要求重試 → 再判,成立即結案
        const env2 = mk()
        const rec2 = await seed(env2)
        const before = fs.readFileSync(`${env2.dirs.coreState}/${rec2.id}.state.json`, 'utf8')
        const r2 = await runStage(env2, scriptAi({ ck1: ck(OPP), ck2: ck(NOT), ck3: ck('unsure') }), {}, { clock: fixedClock('2026-10-02') })
        assert.equal(fs.readFileSync(`${env2.dirs.coreState}/${rec2.id}.state.json`, 'utf8'), before, '判不了 → 狀態不落盤')
        const h = await env2.stores.holds.get(`dispute:${rec2.id}:D1:ES14`)
        assert.deepEqual([h?.status, h?.owner, r2.report.detail.disputeHeld, r2.report.detail.disputeHolds], ['open', 'user', 1, 1])
        // 未成立原因之字樣取判定小組之字樣表(摘要套件之 PANEL_WHY_LABELS;摘要、關聯、提煉同用)
        assert.match(h.reason, /爭議覆核判不了（ES14；有席位不確定）：「學習率」〔D1〕——/)
        assert.ok(has(r2.log, /^INFO 提煉\[學習率\]：1 則爭議覆核判不了，已登錄待判（ES14：〔D1〕有席位不確定）/), r2.log.lines.join('\n'))
        const ai2b = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        await runStage(env2, ai2b, {}, { clock: fixedClock('2026-10-03') })
        assert.equal(ai2b.calls.length, 0, '待判中者不再自動排')
        await requestRetry(env2.stores.holds, h.id, { at: '2026-10-03T12:00:00+08:00' })
        const r2c = await runStage(env2, scriptAi({ ck1: ck(OPP), ck2: ck(OPP) }), {}, { clock: fixedClock('2026-10-04') })
        assert.deepEqual([(await env2.stores.holds.get(h.id)).status, (await env2.stores.holds.get(h.id)).how, r2c.report.detail.holdsResolved, r2c.report.detail.disputeOpposed], ['resolved', '兩席覆核已判定', 1, 1])
        // 非對立 → 拆解(只有立場文字之方轉 pitfall,條件取該方之條件;引主張之方不動)
        const env3 = mk()
        const rec3 = await seed(env3)
        const r3 = await runStage(env3, scriptAi({ ck1: ck(NOT), ck2: ck(NOT) }), {}, { clock: fixedClock('2026-10-02') })
        const s3 = readState(env3, rec3.id)
        const out = s3.claims.find((c) => c.origin === 'dispute')
        assert.deepEqual([s3.disputes[0].status, s3.disputes[0].retractReason, out?.kind, out?.conditions, out?.critique, r3.report.detail.disputeDissolved, r3.report.detail.updated], ['retracted', '非對立', 'pitfall', ['小資料微調'], '只見於單一案例', 1, 1])
        assert.ok(has(r3.log, /^INFO 爭議覆核\[學習率\]：〔D1〕兩席判非對立——已拆解/), r3.log.lines.join('\n'))
        assert.match(r3.report.detail ? JSON.stringify(r3.report.detail) : '', /"disputePasses":1/)
        // 停用(預設 perRun 0)＝不排
        const env4 = mk({ perRun: 0 })
        await seed(env4)
        const ai4 = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        const r4 = await runStage(env4, ai4, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual([ai4.calls.length, r4.report.detail.disputeDue], [0, 0])
        // 開啟而缺第二席 → 執行期拋錯
        const env5 = mk()
        env5.settings.extract.standards.ai = { first: { use: 'ck1' } }
        await assert.rejects(() => runStage(env5, scriptAi({})), /爭議覆核\(extract\.standards\.disputeCheck\.perRun > 0\)已啟用,但缺席位/)
        // 豁免(使用者裁示保留爭議與存疑)→ 不再排入(2026-10-05 審查 B-M1:此前只排除未結案之登錄,豁免後每輪再覆核);
        //   其後又有新的終審存疑(存疑時刻晚於豁免)→ 照常到期
        const env6 = mk()
        const rec6 = await seed(env6)
        await runStage(env6, scriptAi({ ck1: ck(OPP), ck2: ck(NOT), ck3: ck('unsure') }), {}, { clock: fixedClock('2026-10-02') })
        const h6 = await env6.stores.holds.get(`dispute:${rec6.id}:D1:ES14`)
        await waiveHold(env6.stores.holds, h6.id, { by: '使用者', ruling: '保留爭議與存疑', at: '2026-10-02T12:00:00+08:00' })
        const ai6 = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        const r6 = await runStage(env6, ai6, {}, { clock: fixedClock('2026-10-03') })
        assert.deepEqual([ai6.calls.length, r6.report.detail.disputeDue], [0, 0], '豁免者不再排')
        const file6 = `${env6.dirs.coreState}/${rec6.id}.state.json`
        const st6 = JSON.parse(fs.readFileSync(file6, 'utf8'))
        st6.disputes[0].doubt = { ...st6.disputes[0].doubt, at: '2026-10-03T08:00:00+08:00', count: (st6.disputes[0].doubt.count || 1) + 1 }
        fs.writeFileSync(file6, JSON.stringify(st6), 'utf8')
        const ai6b = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        const r6b = await runStage(env6, ai6b, {}, { clock: fixedClock('2026-10-04') })
        assert.deepEqual([ai6b.calls.map((c) => c.role), r6b.report.detail.disputeOpposed], [['ck1', 'ck2'], 1], '豁免後之新存疑 → 再覆核')
        const h6b = await env6.stores.holds.get(h6.id)
        assert.equal(h6b.status, 'waived', '再覆核成立而無判不了 → 豁免紀錄原樣保留')
        // 又一次新存疑而再判不了,爭議之素材(問題、各方、出處內容)未變 → 不重登(豁免之裁示有效;終審 §3 D5e),detail 記 holdsWaivedKept
        const st6c = JSON.parse(fs.readFileSync(file6, 'utf8'))
        st6c.disputes[0].doubt = { ...st6c.disputes[0].doubt, at: '2026-10-05T08:00:00+08:00', count: (st6c.disputes[0].doubt.count || 1) + 1 }
        fs.writeFileSync(file6, JSON.stringify(st6c), 'utf8')
        const r6c = await runStage(env6, scriptAi({ ck1: ck(OPP), ck2: ck(NOT), ck3: ck('unsure') }), {}, { clock: fixedClock('2026-10-06') })
        assert.deepEqual([r6c.report.detail.disputeHeld, r6c.report.detail.disputeHolds, r6c.report.detail.holdsWaivedKept, (await env6.stores.holds.get(h6.id)).status], [1, 0, 1, 'waived'], '素材未變之再判不了 → 不重登、裁示仍有效')
        assert.ok(has(r6c.log, /^INFO 提煉\[學習率\]：1 則爭議覆核判不了/), r6c.log.lines.join('\n'))
    })

    it('regenCore 結案該核心之待判(F23):打掉重練後新核心沿用同一 id、條目編號自 C1／D1 重起——舊登錄與舊裁示不得作用於新條目(未結與已豁免皆結案,豁免之裁示留於記錄;新 D1 之爭議覆核照常到期;逾限筆記之舊登錄不殘留);他核心之登錄不動;意圖由下一輪管線開工消化(清失敗帳、WARN 已知)', async () => {
        const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['學習率'] })), { extract: { standards: { disputeCheck: { perRun: 2, waitDays: 0 } } } })
        env.stores.holds = memStore([])
        env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
        const ck = (v) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => (v === 'unsure' ? { index: Number(m[1]), verdict: 'unsure' } : { index: Number(m[1]), ...v })) })
        const OPP = { verdict: 'opposed', reason: '一方說需要預熱一方說可省略' }
        const draft = (day) => runStage(env, scriptAi({ draft: withDispute, accept: doubtOn }), {}, { clock: fixedClock(day) })
        await draft('2026-10-01')
        const rec = (await env.stores.cores.select())[0]
        // 舊核心:D1 之爭議覆核判不了 → 待判(使用者);另有逾限筆記之待判(ES15)、已豁免之主張待判、他核心之待判
        await runStage(env, scriptAi({ ck1: ck(OPP), ck2: ck('unsure'), ck3: ck('unsure') }), {}, { clock: fixedClock('2026-10-02') })
        const kD = `dispute:${rec.id}:D1:ES14`
        assert.equal((await env.stores.holds.get(kD))?.status, 'open', '前提:D1 待判未結')
        await putHold(env.stores.holds, { object: 'extract-note', oid: `${rec.id}:e1`, std: 'ES15', reason: '未涵蓋逾限', next: 'n', owner: 'pipeline', ctx: { promptId: 'p-old' } }, '2026-10-02T00:00:00+08:00')
        await putHold(env.stores.holds, { object: 'claim', oid: `${rec.id}:C2`, std: 'ES9', reason: 'r', next: 'n', owner: 'user' }, '2026-10-02T00:00:00+08:00')
        await waiveHold(env.stores.holds, `claim:${rec.id}:C2:ES9`, { by: '使用者', ruling: '保留', at: '2026-10-02T06:00:00+08:00' })
        await putHold(env.stores.holds, { object: 'dispute', oid: 'other-core:D1', std: 'ES14', reason: 'r', next: 'n', owner: 'user' }, '2026-10-02T00:00:00+08:00')
        // 打掉重練 → 該核心之待判結案(未結與已豁免;how 記打掉重練與執行者;豁免之裁示留於記錄);他核心者不動
        const rg = await regenCore(env.stores, '學習率', { dirs: env.dirs, by: '王小明', clock: fixedClock('2026-10-03'), stamp: '20261003000000' })
        assert.deepEqual([rg.ok, rg.holdsResolved], [true, [`claim:${rec.id}:C2:ES9`, kD, `extract-note:${rec.id}:e1:ES15`].sort()])
        for (const k of rg.holdsResolved) {
            const h = await env.stores.holds.get(k)
            assert.deepEqual([h.status, h.resolvedAt, h.how], ['resolved', '2026-10-03T00:00:00+08:00', '打掉重練（regenCore；執行者 王小明）：舊核心已封存，新核心自 v1 重起、條目編號重新配發'], k)
        }
        const w = await env.stores.holds.get(`claim:${rec.id}:C2:ES9`)
        assert.deepEqual([w.waivedBy, w.ruling], ['使用者', '保留'], '已豁免者結案而裁示留於記錄(舊裁示不作用於新條目)')
        assert.equal((await env.stores.holds.get('dispute:other-core:D1:ES14')).status, 'open', '他核心不動')
        assert.ok(rg.messages.includes('已結案該核心之待判 3 則'), rg.messages.join('；'))
        assert.equal(JSON.parse(fs.readFileSync(`${env.dirs.state}/extract-regen.json`, 'utf8')).cores[rec.id].done, true, '意圖已記並標 done')
        // 重練:下一輪開工消化意圖(WARN 已知、清失敗帳、刪意圖);新核心同 id、新 D1 → 爭議覆核照常到期(舊登錄不擋)
        const r4 = await draft('2026-10-04')
        assert.ok(has(r4.log, /^WARN 提煉重練意圖：已消化「學習率」/), r4.log.lines.join('\n'))
        assert.equal(fs.existsSync(`${env.dirs.state}/extract-regen.json`), false, '消化後刪意圖')
        const rec2 = (await env.stores.cores.select()).find((c) => c.status !== 'merged')
        assert.deepEqual([rec2.id, readState(env, rec2.id).version, readState(env, rec2.id).disputes[0].id], [rec.id, 1, 'D1'], '前提:同 id、v1、D1 重起')
        const ai = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        const r = await runStage(env, ai, {}, { clock: fixedClock('2026-10-05') })
        assert.deepEqual([ai.calls.map((c) => c.role), r.report.detail.disputeDue], [['ck1', 'ck2'], 1], '新 D1 照常覆核')
        // 缺 holds 集合 → 開頭即拋(未結待判須隨重練結案;集合必開),不動任何東西
        const env2 = mkEnv(['f1', 'f2', 'f3'].map((id) => ({ id, concepts: ['動量'] })))
        await runStage(env2, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const recF = (await env2.stores.cores.select())[0]
        delete env2.stores.holds
        await assert.rejects(() => regenCore(env2.stores, '動量', { dirs: env2.dirs, stamp: '20261003000000' }), /regenCore 需要 holds 集合/)
        assert.ok(fs.existsSync(recF.file) && (await env2.stores.cores.get(recF.id)), '拋於任何寫入之前')
    })

    it('出處支持之存量覆核(檢定標準 ES9 存量):既有主張逐條交覆核席——受支持記錄、不受支持撤回(可還原之理由)、判不了隔離＋待判(使用者);未變者不重檢;豁免解除隔離;要求重試再判;語氣超出者依出處收斂措辭;停用＝不排', async () => {
        const mk = (extract = {}) => {
            const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['存量'] })), { extract })
            env.stores.holds = memStore([])
            env.stores.checks = memStore([])
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
            return env
        }
        /** 覆核替身:依斷言開頭回裁決(by:{ 開頭: 裁決 });其餘 supported */
        const ck = (by = {}) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => {
            const hit = Object.keys(by).find((k) => m[2].startsWith(k))
            return { index: Number(m[1]), verdict: hit ? by[hit] : 'supported', reason: '出處之內容與斷言之關係說明' }
        }) })
        const seed = async (env) => {
            await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
            return (await env.stores.cores.select())[0]
        }
        const env = mk()
        const rec = await seed(env)
        env.settings.extract.standards.supportStock.perRun = 10
        const ai = scriptAi({ ck1: ck({ '主張 q2': 'insufficient', '主張 q3': 'supported' }), ck2: ck({ '主張 q2': 'contradicted', '主張 q3': 'contradicted' }), ck3: ck({ '主張 q3': 'unsure' }) })
        const r = await runStage(env, ai, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual(ai.calls.map((c) => c.role), ['ck1', 'ck2', 'ck3'], '無新筆記、只有覆核席(第三席只送 q3)')
        assert.match(ai.calls[0].prompt, /第1項（既有主張；證據性質：.+?；(推論類|非推論類)）/)
        const s = readState(env, rec.id)
        const by = (t) => s.claims.find((c) => c.text === t)
        assert.deepEqual([by('主張 q1').status, by('主張 q2').status, by('主張 q2').retractReason, by('主張 q3').status], ['active', 'retracted', '覆核無出處支持', 'active'])
        assert.deepEqual(Object.keys(s.held || {}), [by('主張 q3').id], '判不了者隔離')
        const chk = async (t) => (await env.stores.checks.get(`claim:${rec.id}:${by(t).id}`))?.results?.ES9?.status
        assert.deepEqual([await chk('主張 q1'), await chk('主張 q2'), await chk('主張 q3')], ['pass', 'violation', 'undetermined'])
        const h = await env.stores.holds.get(`claim:${rec.id}:${by('主張 q3').id}:ES9`)
        assert.deepEqual([h?.status, h?.owner], ['open', 'user'])
        assert.match(h.reason, /出處支持存量覆核判不了（ES9；有席位不確定）/)
        const d = r.report.detail
        assert.deepEqual([d.stockDue, d.stockChecked, d.stockSupported, d.stockRetracted, d.stockHeld, d.stockPasses, d.stockHolds], [3, 3, 1, 1, 1, 1, 1])
        const body = readMd(rec.file).body
        assert.match(body, /## 待判之條目（出處支持未能判定）[\s\S]*主張 q3/)
        assert.match(body, /已撤回（覆核無出處支持）：主張 q2/)
        assert.ok(has(r.log, /^INFO 提煉出處支持存量覆核專步：存量（3 條）；須檢共 3 條/), r.log.lines.join('\n'))
        // 未變者不重檢;隔離者待使用者
        const ai2 = scriptAi({ ck1: ck(), ck2: ck() })
        await runStage(env, ai2, {}, { clock: fixedClock('2026-10-03') })
        assert.equal(ai2.calls.length, 0, '已檢且內容未變者不重檢、隔離者不自動重判')
        // 要求重試 → 再判;受支持即解除隔離、待判結案
        await requestRetry(env.stores.holds, h.id, { at: '2026-10-03T12:00:00+08:00' })
        const ai3 = scriptAi({ ck1: ck(), ck2: ck() })
        const r3 = await runStage(env, ai3, {}, { clock: fixedClock('2026-10-04') })
        assert.equal(ai3.calls.length, 2)
        assert.equal(readState(env, rec.id).held, undefined, '受支持 → 解除隔離')
        assert.deepEqual([(await env.stores.holds.get(h.id)).status, r3.report.detail.holdsResolved], ['resolved', 1])
        // 豁免:使用者裁示保留 → 維護時解除隔離(不呼叫 AI)
        const envW = mk()
        const recW = await seed(envW)
        envW.settings.extract.standards.supportStock.perRun = 10
        await runStage(envW, scriptAi({ ck1: ck({ '主張 q1': 'supported' }), ck2: ck({ '主張 q1': 'unsure' }), ck3: ck({ '主張 q1': 'unsure' }) }), {}, { clock: fixedClock('2026-10-02') })
        const sW = readState(envW, recW.id)
        const idW = sW.claims.find((c) => c.text === '主張 q1').id
        assert.ok(sW.held?.[idW])
        await waiveHold(envW.stores.holds, `claim:${recW.id}:${idW}:ES9`, { by: '使用者', ruling: '保留', at: '2026-10-02T12:00:00+08:00' })
        const aiW = scriptAi({ ck1: ck(), ck2: ck() })
        const rW = await runStage(envW, aiW, {}, { clock: fixedClock('2026-10-03') })
        assert.deepEqual([aiW.calls.length, readState(envW, recW.id).held, rW.report.detail.stockReleased], [0, undefined, 1])
        // 語氣超出證據 → 修訂席依出處收斂措辭 → 重判受支持 → revise 落地、記 pass
        const envR = mk()
        const recR = await seed(envR)
        envR.settings.extract.standards.supportStock.perRun = 1
        const fix = (p) => ({ fixes: [...p.matchAll(/^--- 第(\d+)項（.+?）---$/gm)].map((m) => ({ index: Number(m[1]), text: '在單一案例中之主張 q1' })) })
        const aiR = scriptAi({ ck1: ck({ '主張 q1': 'overclaim' }), ck2: ck({ '主張 q1': 'overclaim' }), rev: fix })
        const rR = await runStage(envR, aiR, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual(aiR.calls.map((c) => c.role), ['ck1', 'ck2', 'revise', 'ck1', 'ck2'], '每輪上限 1 條:只檢 q1;修訂一次、重判一次')
        const sR = readState(envR, recR.id)
        const cR = sR.claims.find((c) => c.text === '在單一案例中之主張 q1')
        assert.ok(cR && cR.status === 'active', '修訂後之文字落地')
        assert.equal(cR.history.at(-1).op, 'revise')
        assert.equal((await envR.stores.checks.get(`claim:${recR.id}:${cR.id}`)).results.ES9.status, 'pass')
        assert.deepEqual([rR.report.detail.stockRevised, rR.report.detail.stockRetracted], [1, 0])
        // 停用(預設 0)＝不排;開啟而缺第二席 → 執行期拋錯
        const env0 = mk()
        await seed(env0)
        const ai0 = scriptAi({ ck1: ck(), ck2: ck() })
        const r0 = await runStage(env0, ai0, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual([ai0.calls.length, r0.report.detail.stockDue], [0, 0])
        env0.settings.extract.standards.supportStock.perRun = 5
        env0.settings.extract.standards.ai = { first: { use: 'ck1' } }
        await assert.rejects(() => runStage(env0, scriptAi({})), /出處支持存量覆核\(extract\.standards\.supportStock\.perRun > 0\)已啟用,但缺席位 settings\.extract\.standards\.ai\.second/)
    })

    it('reviveClaims(維運;使用者裁示):存量覆核撤回之主張 → 還原(沿革 revive、升版、md 不再列已撤回、cores 記錄同步)、未結待判結案、檢核紀錄改為使用者裁示(同雜湊、pass、席位 user);掃描口徑不再計違反、下一輪不重判;不可還原者逐條列 errors;出處皆已撤者不還原;缺裁示或集合即拋', async () => {
        const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['存量'] })))
        env.stores.holds = memStore([])
        env.stores.checks = memStore([])
        env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
        /** 覆核替身:依斷言開頭回裁決(by:{ 開頭: 裁決 });其餘 supported */
        const ck = (by = {}) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => {
            const hit = Object.keys(by).find((k) => m[2].startsWith(k))
            return { index: Number(m[1]), verdict: hit ? by[hit] : 'supported', reason: '出處之內容與斷言之關係說明' }
        }) })
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const rec = (await env.stores.cores.select())[0]
        env.settings.extract.standards.supportStock.perRun = 10
        await runStage(env, scriptAi({ ck1: ck({ '主張 q2': 'insufficient' }), ck2: ck({ '主張 q2': 'contradicted' }) }), {}, { clock: fixedClock('2026-10-02') })
        const stateFile = `${env.dirs.coreState}/${rec.id}.state.json`
        const text1 = fs.readFileSync(stateFile, 'utf8')
        const s1 = JSON.parse(text1)
        const q1 = s1.claims.find((c) => c.text === '主張 q1')
        const q2 = s1.claims.find((c) => c.text === '主張 q2')
        assert.deepEqual([q2.status, q2.retractReason], ['retracted', '覆核無出處支持'], '前提:存量覆核撤回')
        const key = `claim:${rec.id}:${q2.id}`
        const v0 = await env.stores.checks.get(key)
        assert.equal(v0.results.ES9.status, 'violation', '前提:檢核紀錄為違反')
        await putHold(env.stores.holds, { object: 'claim', oid: `${rec.id}:${q2.id}`, std: 'ES9', reason: '相關之未結待判', next: 'n', owner: 'user' }, '2026-10-02T12:00:00+08:00')
        const deps = { stores: env.stores, dirs: env.dirs, domain: env.domains.extract, clock: fixedClock('2026-10-03') }
        // 缺裁示、缺集合 → 拋(未寫入)
        await assert.rejects(() => reviveClaims(deps, { core: rec.id, ids: [q2.id], by: '王小明', ruling: ' ' }), /還原撤回須記裁示者與裁示內容（opt\.by、opt\.ruling）/)
        await assert.rejects(() => reviveClaims({ ...deps, stores: { ...env.stores, checks: undefined } }, { core: rec.id, ids: [q2.id], by: '王小明', ruling: 'r' }), /需要 checks 集合（請於每輪依賴之 stores 給 checks 集合）/)
        await assert.rejects(() => reviveClaims({ ...deps, domain: undefined }, { core: rec.id, ids: [q2.id], by: '王小明', ruling: 'r' }), /需要 deps\.domain/)
        assert.equal(fs.readFileSync(stateFile, 'utf8'), text1, '拋錯者未寫入')
        // 出處皆已撤 → 不還原(仍為失撐;先還原出處筆記),狀態不動
        fs.writeFileSync(stateFile, JSON.stringify(withdrawSources(s1, { withdraw: q2.sources.map((id) => ({ id, title: id, reason: '筆記已刪除' })), at: 'T' }).state), 'utf8')
        const text0 = fs.readFileSync(stateFile, 'utf8')
        const rw = await reviveClaims(deps, { core: rec.id, ids: [q2.id], by: '王小明', ruling: 'r' })
        assert.deepEqual([rw.ok, rw.revived, rw.errors], [false, [], [{ id: q2.id, why: '出處皆已撤——還原後仍為失撐（ES8）；先以關聯套件之 restoreNote 還原出處筆記' }]])
        assert.equal(fs.readFileSync(stateFile, 'utf8'), text0)
        fs.writeFileSync(stateFile, text1, 'utf8')
        // 以概念名指核心;不可還原者逐條列 errors、其餘照還原
        const r = await reviveClaims(deps, { core: '存量', ids: [q2.id, q1.id, 'C99'], by: '王小明', ruling: '原文第二段即支持此主張' })
        assert.deepEqual([r.ok, r.notFound, r.core, r.concept, r.revived], [true, false, rec.id, rec.concept, [q2.id]])
        assert.deepEqual(r.errors, [{ id: q1.id, why: '非撤回之主張（狀態 active）' }, { id: 'C99', why: '非本核心之主張' }])
        const s2 = readState(env, rec.id)
        const q2b = s2.claims.find((c) => c.id === q2.id)
        assert.deepEqual([q2b.status, q2b.retractReason, s2.version, r.version, s2.rev], ['active', '', s1.version + 1, s1.version + 1, s1.rev + 1])
        assert.deepEqual(q2b.history.at(-1), { version: s1.version + 1, at: '2026-10-03T00:00:00+08:00', op: 'revive', note: '使用者裁示（王小明）：原文第二段即支持此主張' }, '沿革記裁示')
        assert.deepEqual([s2.changelog.at(-1).mode, s2.changelog.at(-1).revived], ['revive', [q2.id]])
        assert.doesNotMatch(readMd(rec.file).body, /已撤回（覆核無出處支持）：主張 q2/, 'md 不再列為已撤回')
        assert.deepEqual([(await env.stores.cores.get(rec.id)).rev, (await env.stores.cores.get(rec.id)).version], [s2.rev, s2.version], 'cores 記錄同步')
        // 待判結案、檢核紀錄為使用者裁示(同雜湊)
        assert.deepEqual([r.holdsResolved, r.checks], [[`${key}:ES9`], [key]])
        const h = await env.stores.holds.get(`${key}:ES9`)
        assert.deepEqual([h.status, h.resolvedAt], ['resolved', '2026-10-03T00:00:00+08:00'])
        assert.equal(h.how, '使用者以 reviveClaims 還原（撤回理由 覆核無出處支持）——裁示者 王小明：原文第二段即支持此主張；同一內容不再自動覆核')
        const v1 = await env.stores.checks.get(key)
        assert.deepEqual([v1.hash, v1.results.ES9.status, v1.results.ES9.seats, v1.results.ES9.reason], [v0.hash, 'pass', 'user', h.how], '同一內容之紀錄改為使用者裁示')
        // 掃描之口徑(到期＝stockNeedsOf、違反＝檢核紀錄之 violation 數):本核心不再計
        const cache = createContentCache(`${env.dirs.state}/${CONTENT_CACHE_FILE}`, env.domains.extract)
        const byId = new Map((await env.stores.notes.select()).map((n) => [n.id, n]))
        const recs = new Map((await env.stores.checks.select()).map((x) => [x.oid, x]))
        assert.deepEqual(stockNeedsOf(s2, { coreId: rec.id, recOf: (oid) => recs.get(oid) || null, keyOf: (nid) => String(cache.keyOf(byId.get(nid)) ?? '') }), [], '無到期者')
        assert.equal([...recs.values()].filter((x) => x.oid.startsWith(`${rec.id}:`) && x.results?.ES9?.status === 'violation').length, 0, '無違反')
        // 下一輪:同一內容不重判(覆核席不被呼叫)、主張維持有效
        const ai = scriptAi({ ck1: ck({ '主張 q2': 'contradicted' }), ck2: ck({ '主張 q2': 'contradicted' }) })
        await runStage(env, ai, {}, { clock: fixedClock('2026-10-04') })
        assert.equal(ai.calls.length, 0, '使用者裁示之內容不重判')
        assert.equal(readState(env, rec.id).claims.find((c) => c.id === q2.id).status, 'active')
        // 再還原同一條 → 已 active 且紀錄為使用者裁示:視為前次中斷之續作(只結案待判,無未結者即無事;不落盤);找不到核心 → notFound
        const re = await reviveClaims(deps, { core: rec.id, ids: [q2.id], by: '王小明', ruling: 'r' })
        assert.deepEqual([re.ok, re.revived, re.resumed, re.holdsResolved, re.errors], [true, [], [q2.id], [], []])
        assert.deepEqual((await reviveClaims(deps, { core: rec.id, ids: [q1.id], by: '王小明', ruling: 'r' })).errors, [{ id: q1.id, why: '非撤回之主張（狀態 active）' }], '非撤回且非使用者裁示者仍為錯誤')
        const nf = await reviveClaims(deps, { core: '不存在之概念', ids: [q2.id], by: '王小明', ruling: 'r' })
        assert.deepEqual([nf.ok, nf.notFound, nf.errors], [false, true, [{ id: '', why: '找不到核心「不存在之概念」' }]])
    })

    it('reviveClaims 之產出鏈(EXT-39;stage standards-fix):changelog 該筆(mode revive)帶 produced——單一形(seat／provider 皆 null、無 promptFp／steps)、stamp 依 opt.stamp(輪次外未給 null、給了即該值)、at＝還原時刻;stamp 不合式即拋且未寫入;依產出鏈取回該等版本(stage 選得到、provider 選不到)', async () => {
        const KEYS = ['v', 'stamp', 'stage', 'seat', 'provider', 'pkg', 'at']
        const PKG = `w-knowledge-extract@${JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version}`
        const STAMP_R = '20261108160000'
        const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['存量'] })))
        env.stores.holds = memStore([])
        env.stores.checks = memStore([])
        env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
        /** 覆核替身:依斷言開頭回裁決(by:{ 開頭: 裁決 });其餘 supported */
        const ck = (by = {}) => (p) => {
            const checks = [...p.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => {
                const hit = Object.keys(by).find((k) => m[2].startsWith(k))
                return { index: Number(m[1]), verdict: hit ? by[hit] : 'supported', reason: '出處之內容與斷言之關係說明' }
            })
            return { checks }
        }
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const rec = (await env.stores.cores.select())[0]
        env.settings.extract.standards.supportStock.perRun = 10
        // q2、q3 皆被存量覆核撤回(兩席皆不支持)→ 各以一次還原驗兩種 stamp
        await runStage(env, scriptAi({ ck1: ck({ '主張 q2': 'insufficient', '主張 q3': 'insufficient' }), ck2: ck({ '主張 q2': 'contradicted', '主張 q3': 'contradicted' }) }), {}, { clock: fixedClock('2026-10-02') })
        const s1 = readState(env, rec.id)
        const q2 = s1.claims.find((c) => c.text === '主張 q2')
        const q3 = s1.claims.find((c) => c.text === '主張 q3')
        assert.deepEqual([q2.status, q3.status], ['retracted', 'retracted'], '前提:存量覆核撤回')
        const deps = { stores: env.stores, dirs: env.dirs, domain: env.domains.extract, clock: fixedClock('2026-10-03') }
        const stateFile = `${env.dirs.coreState}/${rec.id}.state.json`
        // stamp 不合式:寫入前即拋(狀態檔不動、檢核紀錄不動)
        const text1 = fs.readFileSync(stateFile, 'utf8')
        const chk0 = await env.stores.checks.get(`claim:${rec.id}:${q2.id}`)
        await assert.rejects(() => reviveClaims(deps, { core: rec.id, ids: [q2.id], by: '王小明', ruling: '裁示', stamp: 'BADSTAMP' }), (x) => /invalid o\.stamp/.test(x.message) && !x.message.includes('BADSTAMP'))
        assert.equal(fs.readFileSync(stateFile, 'utf8'), text1, '未寫入')
        assert.deepEqual(await env.stores.checks.get(`claim:${rec.id}:${q2.id}`), chk0, '檢核紀錄不動')
        // 輪次外(未給 opt.stamp):stamp null
        const ra = await reviveClaims(deps, { core: rec.id, ids: [q2.id], by: '王小明', ruling: '原文第二段即支持此主張' })
        assert.deepEqual([ra.ok, ra.revived], [true, [q2.id]])
        const ea = readState(env, rec.id).changelog.at(-1)
        assert.deepEqual([ea.mode, ea.revived, ea.version, ea.at], ['revive', [q2.id], s1.version + 1, '2026-10-03T00:00:00+08:00'])
        assert.deepEqual(Object.keys(ea.produced), KEYS, '規格 §2.1 單一形')
        assert.deepEqual([ea.produced.v, ea.produced.stamp, ea.produced.stage, ea.produced.seat, ea.produced.provider, ea.produced.pkg, ea.produced.at], [1, null, 'standards-fix', null, null, PKG, ea.at])
        // 給 opt.stamp(輪次內之呼叫者):stamp 為該值
        const rb = await reviveClaims(deps, { core: rec.id, ids: [q3.id], by: '王小明', ruling: '第三段亦支持', stamp: STAMP_R })
        assert.deepEqual([rb.ok, rb.revived], [true, [q3.id]])
        const eb = readState(env, rec.id).changelog.at(-1)
        assert.deepEqual([eb.mode, eb.revived, eb.version], ['revive', [q3.id], s1.version + 2])
        assert.deepEqual([eb.produced.stamp, eb.produced.stage, eb.produced.seat, eb.produced.provider, eb.produced.pkg, eb.produced.at], [STAMP_R, 'standards-fix', null, null, PKG, eb.at])
        // 依產出鏈取回:stage 選得到兩版、stamp 精確選到一版、起草席成交者選不到、不呼叫 AI(provider null)選得到
        const q = (o) => coreVersionsByProvenance(env.stores, { dirs: env.dirs, ...o })
        const vs = [s1.version + 1, s1.version + 2]
        assert.deepEqual((await q({ stage: 'standards-fix' })).map((x) => x.version), vs)
        assert.deepEqual((await q({ stage: 'standards-fix', stamp: STAMP_R })).map((x) => x.version), [vs[1]])
        assert.deepEqual((await q({ stage: 'standards-fix', stamp: null })).map((x) => x.version), [vs[0]])
        const byDrafter = (await q({ provider: 'stub-d1' })).map((x) => x.version)
        assert.ok(byDrafter.includes(1), '前提:起草席成交者選得到 AI 產出之版本')
        assert.deepEqual(byDrafter.filter((v) => vs.includes(v)), [], '起草席成交者選不到不呼叫 AI 之版本')
        assert.deepEqual((await q({ provider: null })).map((x) => x.version).filter((v) => vs.includes(v)), vs)
    })

    it('reviveClaims 之閘、序與續作:還原後不過檢定標準子集(ES2 數字紮根)者不還原、逐條列 errors;裁示紀錄先於落盤、待判結案於落盤後;主張已 active 而紀錄為使用者裁示者(前次中斷)只結案待判(resumed);管線持鎖中拒絕', async () => {
        const env = mkEnv(['r1', 'r2', 'r3'].map((id) => ({ id, concepts: ['還原閘'] })))
        env.stores.holds = memStore([])
        env.stores.checks = memStore([])
        env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
        const ck = (by = {}) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => {
            const hit = Object.keys(by).find((k) => m[2].startsWith(k))
            return { index: Number(m[1]), verdict: hit ? by[hit] : 'supported', reason: '出處之內容與斷言之關係說明' }
        }) })
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const rec = (await env.stores.cores.select())[0]
        env.settings.extract.standards.supportStock.perRun = 10
        await runStage(env, scriptAi({ ck1: ck({ '主張 r2': 'insufficient', '主張 r3': 'insufficient' }), ck2: ck({ '主張 r2': 'contradicted', '主張 r3': 'contradicted' }) }), {}, { clock: fixedClock('2026-10-02') })
        const stateFile = `${env.dirs.coreState}/${rec.id}.state.json`
        const s1 = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        const [q2, q3] = ['主張 r2', '主張 r3'].map((t) => s1.claims.find((c) => c.text === t))
        assert.deepEqual([q2.status, q3.status], ['retracted', 'retracted'], '前提:兩條皆被存量覆核撤回')
        // 閘:q3 之文字改含出處沒有之數字 → 還原後不過 ES2 → 不還原、列 errors;q2 照還原
        fs.writeFileSync(stateFile, JSON.stringify({ ...s1, claims: s1.claims.map((c) => (c.id === q3.id ? { ...c, text: '主張 r3 年化 87.5%' } : c)) }), 'utf8')
        const deps = { stores: env.stores, dirs: env.dirs, domain: env.domains.extract, clock: fixedClock('2026-10-03') }
        const r = await reviveClaims(deps, { core: rec.id, ids: [q2.id, q3.id], by: '王小明', ruling: '原文支持' })
        assert.deepEqual([r.ok, r.revived, r.resumed, r.errors.map((e) => e.id)], [true, [q2.id], [], [q3.id]])
        assert.match(r.errors[0].why, /^還原後不過檢定標準（ES2：所引出處無之數字：87\.5%）——修正後再還原$/, '「閘:違反者不還原、逐條列 errors」')
        const s2 = readState(env, rec.id)
        assert.deepEqual([s2.claims.find((c) => c.id === q2.id).status, s2.claims.find((c) => c.id === q3.id).status], ['active', 'retracted'])
        // 續作:主張已 active 而紀錄為使用者裁示(模擬前次於落盤後、結案前中斷:待判仍開)→ 只結案待判
        await putHold(env.stores.holds, { object: 'claim', oid: `${rec.id}:${q2.id}`, std: 'ES9', reason: '前次未結之待判', next: 'n', owner: 'user' }, '2026-10-03T06:00:00+08:00')
        const again = await reviveClaims(deps, { core: rec.id, ids: [q2.id], by: '王小明', ruling: '原文支持' })
        assert.deepEqual([again.ok, again.revived, again.resumed, again.holdsResolved, again.errors], [true, [], [q2.id], [`claim:${rec.id}:${q2.id}:ES9`], []], '「主張已 active 且檢核紀錄 seats 為 user 者,跳過寫入、只結案待判」')
        assert.equal(readState(env, rec.id).rev, s2.rev, '續作不落盤')
        // 「續作之原撤回理由:自前次所寫之裁示紀錄取」——結案說明帶實際之撤回理由,不是「（前次）」
        const closed = (await env.stores.holds.select()).find((h) => h.id === `claim:${rec.id}:${q2.id}:ES9`)
        assert.match(String(closed?.how || ''), /撤回理由 覆核無出處支持）/, JSON.stringify(closed))
        // 管線持鎖中:拒絕、不動
        const lockFile = `${env.dirs.state}/run.lock`
        const held = acquireLock(lockFile)
        const locked = await reviveClaims(deps, { core: rec.id, ids: [q3.id], by: '王小明', ruling: 'r', lockFile })
        assert.deepEqual([locked.ok, locked.locked, readState(env, rec.id).rev], [false, true, s2.rev])
        held.release()
    })

    it('失撐主張之專責佇列(檢定標準 ES8):出處筆記刪除 → 於本核心其餘已消化筆記找支持——兩席同指一篇即補出處;皆無支持 → 撤回(出處筆記還原即還原);判不了 → 待判;停用＝不排', async () => {
        const mk = () => {
            const env = mkEnv(['o1', 'o2', 'o3'].map((id) => ({ id, concepts: ['失撐'] })))
            env.stores.holds = memStore([])
            env.stores.checks = memStore([])
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
            return env
        }
        /** 失撐找支持替身:每項回 v(supported 時 by 為標題 title 之筆記標號) */
        const orphan = (v, title) => (p) => {
            const lab = [...p.matchAll(/^=== 筆記 (S\d+)：(\S+) ===$/gm)].find((m) => m[2] === title)?.[1]
            return { checks: [...p.matchAll(/^--- 第(\d+)項（證據性質：.+?）---$/gm)].map((m) => (v === 'supported' ? { index: Number(m[1]), verdict: 'supported', by: [lab || 'S9'], reason: '該筆記之內容直接陳述此主張' } : (v === 'unsure' ? { index: Number(m[1]), verdict: 'unsure' } : { index: Number(m[1]), verdict: 'none', reason: '候選筆記皆未涉及此主張' }))) }
        }
        const seedDel = async (env) => {
            await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
            const rec = (await env.stores.cores.select())[0]
            await env.stores.notes.del('o1')
            // 關聯段之刪除墓碑(帳檔名取關聯套件之常數;提煉讀之以撤出處)
            fs.writeFileSync(path.join(env.dirs.state, DELETION_FILES.tombstones), JSON.stringify({ ids: { o1: { at: '2026-10-01T12:00:00+08:00', reason: '與 o2 重複' } } }), 'utf8')
            env.settings.extract.standards.orphanCheck.perRun = 1
            return rec
        }
        // 兩席同指 o2 → 補出處
        const env = mk()
        const rec = await seedDel(env)
        const ai = scriptAi({ ck1: orphan('supported', 'o2'), ck2: orphan('supported', 'o2') })
        const r = await runStage(env, ai, {}, { clock: fixedClock('2026-10-02') })
        // 本質所引之 C1 失撐 → 本質待重寫(ES6 本質專步之起草亦會跑;此處只看失撐專步之覆核兩席)
        const cks = ai.calls.filter((c) => /^ck/.test(c.role))
        assert.deepEqual(cks.map((c) => c.role), ['ck1', 'ck2'])
        assert.match(cks[0].prompt, /=== 筆記 S\d+：o2 ===[\s\S]*=== 筆記 S\d+：o3 ===/, '候選＝其餘全部已消化筆記(不預篩)')
        assert.doesNotMatch(cks[0].prompt, /=== 筆記 S\d+：o1 ===/, '已刪除者不在候選')
        const s = readState(env, rec.id)
        const c1 = s.claims.find((c) => c.text === '主張 o1')
        assert.deepEqual([c1.status, c1.sources.includes('o2')], ['active', true])
        assert.equal((await env.stores.checks.get(`claim:${rec.id}:${c1.id}`)).results.ES8.status, 'pass')
        assert.deepEqual([r.report.detail.withdrawn, r.report.detail.orphanDue, r.report.detail.orphanResourced, r.report.detail.orphanPasses], [1, 1, 1, 1])
        assert.equal(r.report.detail.orphanPages, 1, '失撐專步之頁數入報告(與他專步之計數同經彙總)')
        assert.ok(has(r.log, /^INFO 失撐主張找支持\[失撐\]：〔C1〕兩席判 1 篇已消化筆記支持——補出處/), r.log.lines.join('\n'))
        // 皆無支持 → 撤回;出處筆記還原 → 撤回隨之還原
        const env2 = mk()
        const rec2 = await seedDel(env2)
        const r2 = await runStage(env2, scriptAi({ ck1: orphan('none'), ck2: orphan('none') }), {}, { clock: fixedClock('2026-10-02') })
        const c2 = readState(env2, rec2.id).claims.find((c) => c.text === '主張 o1')
        assert.deepEqual([c2.status, c2.retractReason, r2.report.detail.orphanRetracted], ['retracted', '出處已撤他篇無支持', 1])
        assert.match(readMd(rec2.file).body, /已撤回（出處已撤他篇無支持）：主張 o1/)
        await env2.stores.notes.insertNew([noteRow(env2.dirs, { id: 'o1', concepts: ['失撐'] })])
        fs.writeFileSync(path.join(env2.dirs.state, DELETION_FILES.tombstones), JSON.stringify({ ids: {} }), 'utf8')
        const ai2b = scriptAi({})
        const r2b = await runStage(env2, ai2b, {}, { clock: fixedClock('2026-10-03') })
        const c2b = readState(env2, rec2.id).claims.find((c) => c.text === '主張 o1')
        assert.deepEqual([c2b.status, c2b.history.at(-1).op, r2b.report.detail.restored, r2b.report.detail.orphanRevived], ['active', 'revive', 1, 1])
        assert.equal(ai2b.calls.filter((c) => /^ck/.test(c.role)).length, 0, '還原由維護(無 AI)完成;本質待重寫另由本質專步處理')
        // 判不了 → 待判(使用者)、狀態不變;下輪不再排
        const env3 = mk()
        const rec3 = await seedDel(env3)
        await runStage(env3, scriptAi({ ck1: orphan('none'), ck2: orphan('supported', 'o3'), ck3: orphan('unsure') }), {}, { clock: fixedClock('2026-10-02') })
        const c3 = readState(env3, rec3.id).claims.find((c) => c.text === '主張 o1')
        assert.equal(c3.status, 'active')
        const h3 = await env3.stores.holds.get(`claim:${rec3.id}:${c3.id}:ES8`)
        assert.deepEqual([h3?.status, h3?.owner], ['open', 'user'])
        const ai3b = scriptAi({ ck1: orphan('none'), ck2: orphan('none') })
        await runStage(env3, ai3b, {}, { clock: fixedClock('2026-10-03') })
        assert.equal(ai3b.calls.filter((c) => /^ck/.test(c.role)).length, 0, '已檢(判不了)而候選未變者不再排')
        // 停用＝不排
        const env4 = mk()
        await seedDel(env4)
        env4.settings.extract.standards.orphanCheck.perRun = 0
        const ai4 = scriptAi({ ck1: orphan('none'), ck2: orphan('none') })
        const r4 = await runStage(env4, ai4, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual([ai4.calls.filter((c) => /^ck/.test(c.role)).length, r4.report.detail.orphanDue], [0, 0])
    })

    it('同義核心核對專步之接線(檢定標準 ES11):extract.standards.synonymCheck.perRun > 0 → 各專步之後,提議席與覆核第一席用 standards.ai.first、覆核第二席用 second;同一概念 → 待判(使用者);預設 0＝不排', async () => {
        const R = '兩者之本質與主張談的是同一件事'
        const mk = (perRun) => {
            const notes = [...['s1', 's2', 's3'].map((id) => ({ id, concepts: ['最優執行'] })), ...['t1', 't2', 't3'].map((id) => ({ id, concepts: ['最適執行'] }))]
            const env = mkEnv(notes, { extract: { standards: { synonymCheck: { perRun } } } })
            env.stores.holds = memStore([])
            env.stores.checks = memStore([])
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' } }
            return env
        }
        /** 提議席回空名單;覆核兩席逐項回 same */
        const ck = (p) => (/的同義概念提議員/.test(p) ? { pairs: [] } : { checks: [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => ({ index: Number(m[1]), verdict: 'same', reason: R })) })
        const env = mk(5)
        const ai = scriptAi({ draft: draftAll, ck1: ck, ck2: ck })
        const { report } = await runStage(env, ai)
        assert.deepEqual(ai.calls.filter((c) => /^ck/.test(c.role)).map((c) => c.role), ['ck1', 'ck1', 'ck2'], '提議(第一席)→ 覆核第一席、第二席')
        const d = report.detail
        assert.deepEqual([d.synonymCandidates, d.synonymChecked, d.synonymSame, d.synonymHeld, d.synonymCalls], [1, 1, 1, 0, 3], JSON.stringify(d))
        assert.deepEqual((await env.stores.holds.select()).filter((h) => h.std === 'ES11').map((h) => h.owner), ['user'], '同一概念 → 待判(使用者)')
        // 預設 0＝不排
        const env0 = mk(0)
        const ai0 = scriptAi({ draft: draftAll, ck1: ck, ck2: ck })
        const r0 = await runStage(env0, ai0)
        assert.deepEqual([ai0.calls.filter((c) => /^ck/.test(c.role)).length, r0.report.detail.synonymCandidates], [0, 0])
        // 開啟而缺第二席、或 domain 缺覆核提示詞 → 執行期拋錯(功能與席位之單一判定;同義核心亦檢)
        const envS = mk(5)
        envS.settings.extract.standards.ai = { first: { use: 'ck1' } }
        await assert.rejects(() => runStage(envS, scriptAi({ draft: draftAll })), /同義核心核對\(extract\.standards\.synonymCheck\.perRun > 0\)已啟用,但缺席位 settings\.extract\.standards\.ai\.second/)
        const envD = mk(5)
        envD.domains.extract = { ...envD.domains.extract, buildSynonymCheckPrompt: undefined }
        await assert.rejects(() => runStage(envD, scriptAi({ draft: draftAll })), /同義核心核對\(extract\.standards\.synonymCheck\.perRun > 0\)已啟用,但 domain 缺 buildSynonymCheckPrompt/)
    })

    it('同義專步(ES11)之逐棒日誌與計數同他棒(提煉事件[同義核心核對]、aiCalls、aiAttempts);專步層之失敗(全部受檢項皆缺票或同一供應者)→ 失敗帳之全域鍵記次並退避、WARN 附連續次數、detail synonymFailStreak 可見;判過可用之兩票 → 歸零', async () => {
        const R = '兩者之本質與主張談的是同一件事'
        const notes = [...['s1', 's2', 's3'].map((id) => ({ id, concepts: ['最優執行'] })), ...['t1', 't2', 't3'].map((id) => ({ id, concepts: ['最適執行'] }))]
        const env = mkEnv(notes, { extract: { standards: { synonymCheck: { perRun: 5 } } } })
        env.stores.holds = memStore([])
        env.stores.checks = memStore([])
        env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' } }
        const ck = (p) => (/的同義概念提議員/.test(p) ? { pairs: [] } : { checks: [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => ({ index: Number(m[1]), verdict: 'same', reason: R })) })
        const ledOf = () => ledgerOf(env, SYNONYM_LEDGER_KEY)
        // 第一輪:建兩核心;同義覆核之第二席失敗 → 全部受檢項皆缺票 → 專步層之失敗
        const r1 = await runStage(env, scriptAi({ draft: draftAll, ck1: ck, ck2: 'fail' }), {}, { clock: fixedClock('2026-10-01') })
        for (const re of [/^INFO 提煉事件\[同義核心核對\] 同義提議 stub-ck1 成交/, /^INFO 提煉事件\[同義核心核對\] 同義覆核1 stub-ck1 成交/, /^WARN 提煉事件\[同義核心核對\] 同義覆核2 ck2：exec（替身失敗）/, /^WARN 提煉事件\[同義核心核對\] 同義覆核2 全鏈失敗：ck2 失敗（替身）/]) assert.ok(has(r1.log, re), `${re}\n${r1.log.lines.join('\n')}`)
        assert.ok(has(r1.log, /^WARN 提煉：同義核心核對失敗（同義核心核對（ES11）未完成：全部受檢項皆缺票或同一供應者.*）——專步連續失敗 1 次，退避 1 天後再試$/), r1.log.lines.join('\n'))
        assert.deepEqual([ledOf().synonymTries, ledOf().synonymLastTriedAt, r1.report.detail.synonymFailStreak], [1, '2026-10-01T00:00:00+08:00', 1])
        assert.deepEqual([(await env.stores.holds.select()).filter((h) => h.std === 'ES11').length, (await env.stores.checks.select()).length], [0, 0], '不逐項登錄待判、不記檢核')
        // 第二輪(同日):退避中不排;執行摘要仍見連續失敗
        const ai2 = scriptAi({ ck1: ck, ck2: ck })
        const r2 = await runStage(env, ai2, {}, { clock: fixedClock('2026-10-01') })
        assert.deepEqual([ai2.calls.length, r2.report.detail.synonymFailStreak], [0, 1])
        // 第三輪(次日):判過可用之兩票 → 歸零;本輪只有同義兩席之呼叫(名單未變不再提議)——aiCalls、aiAttempts 計入
        const r3 = await runStage(env, scriptAi({ ck1: ck, ck2: ck }), {}, { clock: fixedClock('2026-10-02') })
        const d = r3.report.detail
        assert.deepEqual([d.synonymSame, d.synonymCalls, d.aiCalls, d.aiAttempts, d.synonymFailStreak, ledOf().synonymTries], [1, 2, 2, 2, 0, 0], JSON.stringify(d))
    })

    it('同義核心核對之逐項次數上限取設定(extract.standards.synonymCheck.maxTries;終審 §3 D5a「ES11 之 maxTries 設定鍵」):部分缺票之對 → maxTries 1 首次缺票即待判改使用者;maxTries 3 → 負責者仍為 pipeline(下輪重判)', async () => {
        const WHY = '兩者談的是不同之執行方式與適用情境'
        const run = async (maxTries) => {
            const concepts = ['最優執行', '最適執行', '最佳執行']
            const notes = concepts.flatMap((c, k) => [1, 2, 3].map((i) => ({ id: `y${k}${i}-${maxTries}`, concepts: [c] })))
            const env = mkEnv(notes, { extract: { perRun: 3, standards: { synonymCheck: { perRun: 5, maxTries } } } })
            env.stores.holds = memStore([])
            env.stores.checks = memStore([])
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' } }
            const items = (p) => [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
            // 第一席逐項判「不同」;第二席只回第一項 → 其餘之對缺票(部分缺票:逐項計次,非專步層之失敗)
            const ck1 = (p) => (/的同義概念提議員/.test(p) ? { pairs: [] } : { checks: items(p).map((index) => ({ index, verdict: 'different', reason: WHY })) })
            const ck2 = (p) => ({ checks: items(p).slice(0, 1).map((index) => ({ index, verdict: 'different', reason: WHY })) })
            const { report } = await runStage(env, scriptAi({ draft: draftAll, ck1, ck2 }), {}, { clock: fixedClock('2026-10-01') })
            const missing = (await env.stores.holds.select()).filter((h) => h.std === 'ES11' && /判定小組未成立/.test(h.reason))
            return { d: report.detail, missing }
        }
        const one = await run(1)
        // 前提:確有部分缺票之對(候選 ≥2、一對判過而其餘缺票)
        assert.ok(one.d.synonymCandidates >= 2 && one.missing.length >= 1, JSON.stringify(one.d))
        // 規則:缺票之對之負責者依失敗帳之現值＋本次與設定之 maxTries 比(synonymStep 檔頭);maxTries 1 → 首次即使用者
        assert.deepEqual([...new Set(one.missing.map((h) => h.owner))], ['user'], 'maxTries 1:首次缺票即轉使用者')
        const three = await run(3)
        assert.ok(three.missing.length >= 1, JSON.stringify(three.d))
        assert.deepEqual([...new Set(three.missing.map((h) => h.owner))], ['pipeline'], 'maxTries 3:首次缺票之待判由管線重判')
    })

    it('判定小組專步之專步層失敗(ES14 爭議為例;存量、失撐、同義同一規則):全部受檢項皆缺票 → 不逐項計次、不轉待判;記 disputeTries 並退避,WARN 附連續次數,detail disputeFailStreak 可見;判成後歸零', async () => {
        const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['學習率'] })), { extract: { standards: { disputeCheck: { perRun: 2, waitDays: 0 } } } })
        env.stores.holds = memStore([])
        env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
        await runStage(env, scriptAi({ draft: withDispute, accept: doubtOn }), {}, { clock: fixedClock('2026-10-01') })
        const ck = (v) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => ({ index: Number(m[1]), ...v })) })
        const OPP = { verdict: 'opposed', reason: '一方說需要預熱一方說可省略' }
        const ledOf = () => ledgerOf(env, 'concept|學習率')
        const r1 = await runStage(env, scriptAi({ ck1: ck(OPP), ck2: 'fail' }), {}, { clock: fixedClock('2026-10-02') })
        assert.ok(has(r1.log, /^WARN 提煉\[學習率\]：爭議覆核失敗（爭議覆核（ES14）未完成：全部受檢項皆缺票或同一供應者.*）——專步連續失敗 1 次，退避 1 天後再試$/), r1.log.lines.join('\n'))
        assert.deepEqual([ledOf().disputeTries, ledOf().disputeItemTries, r1.report.detail.disputeFailStreak, (await env.stores.holds.select()).length], [1, undefined, 1, 0], '不逐項計次、不轉待判')
        const ai2 = scriptAi({ ck1: ck(OPP), ck2: ck(OPP) })
        const r2 = await runStage(env, ai2, {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual([ai2.calls.length, r2.report.detail.disputeFailStreak], [0, 1], '退避中不排;連續失敗仍可見')
        const r3 = await runStage(env, scriptAi({ ck1: ck(OPP), ck2: ck(OPP) }), {}, { clock: fixedClock('2026-10-03') })
        assert.deepEqual([r3.report.detail.disputeOpposed, ledOf().disputeTries, r3.report.detail.disputeFailStreak], [1, 0, 0])
    })

    it('判定小組專步之逐項次數上限取設定(standards.supportStock.maxTries;失撐之 standards.orphanCheck.maxTries 同):部分缺票者逐項計次,達上限 → 隔離＋待判(使用者)', async () => {
        const ck = (skip) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].filter((m) => !(skip && m[2].startsWith(skip))).map((m) => ({ index: Number(m[1]), verdict: 'supported', reason: '出處之內容與斷言之關係說明' })) })
        for (const [maxTries, over] of [[1, true], [3, false]]) {
            const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['存量'] })))
            env.stores.holds = memStore([])
            env.stores.checks = memStore([])
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' } }
            await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
            const rec = (await env.stores.cores.select())[0]
            env.settings.extract.standards.supportStock = { perRun: 10, maxTries }
            // 第二席不回 q2 → 只該條缺票(部分)
            await runStage(env, scriptAi({ ck1: ck(), ck2: ck('主張 q2') }), {}, { clock: fixedClock('2026-10-02') })
            const s = readState(env, rec.id)
            const c2 = s.claims.find((c) => c.text === '主張 q2')
            const h = await env.stores.holds.get(`claim:${rec.id}:${c2.id}:ES9`)
            const led = ledgerOf(env, 'concept|存量')
            if (over) assert.deepEqual([h?.owner, !!s.held?.[c2.id], led.supportItemTries?.[c2.id], led.supportTries], ['user', true, undefined, 0], 'maxTries 1:首次缺票即隔離＋待判')
            else assert.deepEqual([!!h, s.held?.[c2.id], led.supportItemTries?.[c2.id], led.supportTries], [false, undefined, 1, 0], 'maxTries 3:記次、下輪重試')
        }
        // 失撐(standards.orphanCheck.maxTries):刪兩篇 → 兩條失撐;兩席皆判 o1 之主張無支持、第二席不回 o2 之主張 → 只該條缺票(部分)
        const ckO = (skip) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---\n主張：(.+)$/gm)].filter((m) => !(skip && m[2].startsWith(skip))).map((m) => ({ index: Number(m[1]), verdict: 'none', reason: '候選筆記皆未涉及此主張' })) })
        for (const [maxTries, over] of [[1, true], [3, false]]) {
            const env = mkEnv(['o1', 'o2', 'o3'].map((id) => ({ id, concepts: ['失撐'] })))
            env.stores.holds = memStore([])
            env.stores.checks = memStore([])
            env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' } }
            await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
            const rec = (await env.stores.cores.select())[0]
            for (const id of ['o1', 'o2']) await env.stores.notes.del(id)
            fs.writeFileSync(path.join(env.dirs.state, DELETION_FILES.tombstones), JSON.stringify({ ids: { o1: { at: '2026-10-01T12:00:00+08:00', reason: '與 o3 重複' }, o2: { at: '2026-10-01T12:00:00+08:00', reason: '與 o3 重複' } } }), 'utf8')
            env.settings.extract.standards.orphanCheck = { perRun: 10, maxTries } // perRun 為每輪至多幾條主張(終審 §3 A-6;兩條皆須入檢)
            await runStage(env, scriptAi({ ck1: ckO(), ck2: ckO('主張 o2') }), {}, { clock: fixedClock('2026-10-02') })
            const s = readState(env, rec.id)
            const [c1, c2] = ['主張 o1', '主張 o2'].map((t) => s.claims.find((c) => c.text === t))
            const h = await env.stores.holds.get(`claim:${rec.id}:${c2.id}:ES8`)
            const led = ledgerOf(env, 'concept|失撐')
            assert.equal(c1.status, 'retracted', '兩席皆判無支持者照處置')
            if (over) assert.deepEqual([h?.owner, led.orphanItemTries?.[c2.id], led.orphanTries], ['user', undefined, 0], '失撐 maxTries 1:首次缺票即待判')
            else assert.deepEqual([!!h, led.orphanItemTries?.[c2.id], led.orphanTries], [false, 1, 0], '失撐 maxTries 3:記次、下輪重試')
        }
    })

    it('席位:settings.extract.ai 不合 3+3(含不認得之鍵或缺席位)→ 提煉段執行期拋錯;狀態含待審欄', async () => {
        const env = mkEnv(['z1', 'z2', 'z3'].map((id) => ({ id, concepts: ['學習率'] })))
        const bad = (ai) => ({ ...env, settings: { ...env.settings, extract: { ...env.settings.extract, ai } } })
        await assert.rejects(() => runStage(bad({ ...SEATS, judge: { use: 'x' } }), scriptAi({ draft: draftAll })), /settings\.extract\.ai 含不認得之鍵：judge/)
        await assert.rejects(() => runStage(bad({ ...SEATS, accept: undefined }), scriptAi({ draft: draftAll })), /settings\.extract\.ai 缺席位：accept/)
        assert.ok(Array.isArray(emptyState().pendingReview), '狀態含待審欄')
    })

    it('docs 集合選開:未給 stores.docs → 選篇之發布年退樣本期／建立年、來源退筆記之 sourceName,照常提煉(不拋 TypeError)', async () => {
        const env = mkEnv(['v1', 'v2', 'v3'].map((id) => ({ id, concepts: ['選開'] })))
        delete env.stores.docs
        const { report, log } = await runStage(env, scriptAi({ draft: draftAll }))
        assert.deepEqual([report.detail.concepts, report.detail.updated, report.detail.failed], [1, 1, 0], log.lines.join('\n'))
        assert.equal(readState(env, (await env.stores.cores.select())[0].id).consumed.length, 3)
    })

    it('斷網:調度層標 netDown(整鏈皆敗且本機網路不通)→ 視同截止(不套用、不計失敗、不計 tries);未完成之 WARN 寫「因本機網路不通」而非時間預算', async () => {
        const env = mkEnv(['y1', 'y2', 'y3'].map((id) => ({ id, concepts: ['斷網'] })))
        const ai = scriptAi({ draft: 'netDown', integrate: 'netDown', audit: 'netDown', revise: 'netDown', accept: 'netDown' })
        const { report, log } = await runStage(env, ai)
        assert.deepEqual([report.detail.stopped, report.detail.failed], [1, 0], log.lines.join('\n'))
        assert.ok(has(log, /^WARN 提煉\[斷網\]：提煉因本機網路不通未完成（本次不套用、不計失敗，下輪再做）/), log.lines.join('\n'))
        assert.ok(!has(log, /因時間預算截止/), '不誤寫為時間預算')
        const led = ledgerOf(env, 'concept|斷網')
        assert.equal(led.tries || 0, 0, '不計 tries')
    })

    // ── 2026-10-03 審查修正之回歸 ──
    it('X2 截止感知:上游 budget 且整輪剩餘不足一次嘗試 → stopped(不套用、不計 tries、只記 lastTriedAt、stat.stopped);剩餘充裕之 budget 仍為失敗(記 tries)', async () => {
        const env = mkEnv(['x1', 'x2', 'x3'].map((id) => ({ id, concepts: ['截止'] })), { extract: { minRemainingMs: 0 } })
        const ai = scriptAi({ draft: 'budget' })
        const ctxBase = { deps: { ...env, clock, ai }, expired: () => false }
        const log = recLog()
        const report = await stageExtract({}).run({ ...ctxBase, log, remainingMs: () => 10_000 }) // 剩餘 10 秒 < 席位 minAttemptMs 預設 20 秒
        assert.equal(report.detail.stopped, 1, log.lines.join('\n'))
        assert.equal(report.detail.failed, 0)
        assert.ok(has(log, /^WARN 提煉\[截止\]：提煉因時間預算截止未完成/), log.lines.join('\n'))
        const led = ledgerOf(env, 'concept|截止')
        assert.deepEqual([led.tries || 0, !!led.lastTriedAt], [0, true], '截止:不計 tries 但記 lastTriedAt(輪替)')
        assert.equal((await env.stores.cores.select()).length, 0)
        const log2 = recLog()
        const r2 = await stageExtract({}).run({ ...ctxBase, deps: { ...env, clock, ai: scriptAi({ draft: 'budget' }) }, log: log2, remainingMs: () => 600_000 })
        assert.deepEqual([r2.detail.stopped, r2.detail.failed], [0, 1], '剩餘充裕:席位自帶預算用盡,是這批的失敗')
        assert.equal(ledgerOf(env, 'concept|截止').tries, 1)
    })

    it('X3 載入失敗落帳:狀態檔非本格式版本／遺失無 .prev 皆記 tries＋lastTriedAt＋lastError(否則每輪被選中、每輪同一 ERROR)', async () => {
        const env = mkEnv(['y1', 'y2', 'y3'].map((id) => ({ id, concepts: ['落帳'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        const stFile = `${env.dirs.coreState}/${rec.id}.state.json`
        fs.writeFileSync(stFile, JSON.stringify({ ...readState(env, rec.id), v: 2 }), 'utf8')
        await addNotes(env, ['y4', 'y5', 'y6'], ['落帳'])
        await runStage(env, scriptAi({ draft: draftAll }))
        let led = ledgerOf(env, 'concept|落帳')
        assert.equal(led.tries, 1)
        assert.match(led.lastError, /狀態檔非本格式版本/)
        assert.ok(led.lastTriedAt)
        fs.rmSync(stFile)
        await runStage(env, scriptAi({ draft: draftAll }))
        led = ledgerOf(env, 'concept|落帳')
        assert.equal(led.tries, 2)
        assert.match(led.lastError, /狀態檔遺失且無上一版可還原/)
    })

    it('X4 待審只剩陳舊項(目標已終態或不存在)→ 不呼叫 AI、清除後落盤一次讓投影之待審數歸零;下輪不再排待審專步', async () => {
        const env = mkEnv(['p1', 'p2', 'p3'].map((id) => ({ id, concepts: ['陳舊'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = (await env.stores.cores.select())[0]
        const stFile = `${env.dirs.coreState}/${rec.id}.state.json`
        const st = readState(env, rec.id)
        st.pendingReview = [{ op: { op: 'supersede', id: 'C999', reason: 'r', validPeriod: '不詳', sources: [] }, sources: [], at: 'x', version: 1, reason: '終審失敗' }]
        fs.writeFileSync(stFile, JSON.stringify(st), 'utf8')
        await env.stores.cores.replace({ ...rec, pendingReview: 1 })
        const ai = scriptAi({ draft: draftAll })
        const { report, log } = await runStage(env, ai)
        assert.equal(ai.calls.length, 0, '無新筆記、待審只剩陳舊項:不呼叫 AI')
        assert.equal(report.detail.pendingPurged, 1)
        assert.ok(has(log, /^INFO 待審裁決\[陳舊\]：1 項待審之目標已為終態、不存在或所依出處已撤，自待審清除（supersede〔C999〕）/), log.lines.join('\n'))
        assert.deepEqual(readState(env, rec.id).pendingReview, [])
        assert.equal((await env.stores.cores.get(rec.id)).pendingReview, 0, '投影之待審數歸零 → 下輪不再排待審專步')
        assert.equal(readState(env, rec.id).version, 1, '只落盤不改版')
        const r2 = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(r2.report.detail.concepts, 0, '下輪無事可做')
    })

    it('A-1 分身不反向合併:待審專步只排主核心(coreForKey);分身自身不會被選到而把高版本主核心標 merged', async () => {
        setConceptFold((s) => s.replace(/归/g, '歸'))
        try {
            const env = mkEnv([], { extract: { perRun: 1 } })
            const store = createCoreStore({ dir: env.dirs.coreState })
            const mk = async (id, concept, version, pending) => {
                const file = `${env.dirs.core}/${id}.md`
                const base = { ...emptyState({ coreId: id, concept, scope: 'concept' }), version }
                const seeded = applyDeltaSeed(base)
                if (pending) seeded.pendingReview = [{ op: { op: 'supersede', id: 'C1', reason: 'r', validPeriod: '不詳', sources: [] }, sources: [], at: 'x', version, reason: '終審失敗' }]
                const written = store.save(id, seeded, { expectRev: null })
                writeMd(file, { concept, type: 'core', version }, `# 核心知識：${concept}`)
                await env.stores.cores.replace({ id, concept, scope: 'concept', file, version, rev: written.rev, noteCount: 2, noteIds: [], updatedAt: '2026-09-01T00:00:00+08:00', pendingReview: pending ? 1 : 0 })
            }
            await mk('main-core', '均值回歸', 9, false)
            await mk('twin-core', '均值回归', 1, true) // 分身帶待審:此前待審專步會選到它,落盤後把 main-core 併入分身
            const ai = scriptAi({ accept: keepAll })
            const { report } = await runStage(env, ai)
            assert.equal(report.detail.concepts, 0, '分身不入待審專步')
            assert.equal(ai.calls.length, 0)
            assert.notEqual((await env.stores.cores.get('main-core')).status, 'merged', '主核心不得被分身併掉')
            assert.notEqual((await env.stores.cores.get('twin-core')).status, 'merged', '分身亦未被動(主核心本輪未落盤)')
        }
        finally {
            resetConceptFold()
        }
    })

    it('D7 extract.perRun 0＝停用:不選題、不呼叫 AI、INFO「提煉停用」、report.detail.disabled', async () => {
        const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['停用'] })), { extract: { perRun: 0 } })
        const ai = scriptAi({ draft: draftAll })
        const { report, log } = await runStage(env, ai)
        assert.equal(report.detail.disabled, true)
        assert.equal(ai.calls.length, 0)
        assert.ok(has(log, /^INFO 提煉停用：extract\.perRun 為 0/), log.lines.join('\n'))
        assert.equal((await env.stores.cores.select()).length, 0)
    })

    it('A-4 整併被截止不記 led.consolidate(否則下次整併被推到 interval 個版次之後);截止之 pass 亦不消耗筆記', async () => {
        const env = mkEnv(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => ({ id, concepts: ['整併截止'] })), { extract: { claimsCap: 2, consolidateEvery: 1, perRun: 1, minRemainingMs: 0 } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const ai = scriptAi({ draft: 'budget' })
        const log = recLog()
        const report = await stageExtract({}).run({ deps: { ...env, clock, ai }, log, remainingMs: () => 10_000, expired: () => false })
        assert.equal(report.detail.stopped, 2, `整併與提煉批次各截止一次:${log.lines.join('\n')}`)
        const led = ledgerOf(env, 'concept|整併截止')
        assert.equal(led.consolidate, undefined, '截止不算一次整併嘗試')
        assert.equal(led.tries || 0, 0)
    })

    describe('extractStage', function() {

        const log = nullLogger()

        it('stageExtract:opt 非物件視為{},不拋錯;席位不合 3+3 拋錯;缺關聯 domain → 本輪任何寫入前即拋;有效輸入(無合格概念/類別)行為不變', async () => {
            const bad = stageExtract('not-object')
            assert.equal(typeof bad.run, 'function')

            const dirs = { state: `${TMP}/extract/state`, core: `${TMP}/extract/core`, coreState: `${TMP}/extract/core-state` }
            const seats = { drafters: [{ use: 'd1' }, { use: 'd2' }, { use: 'd3' }], integrate: { use: 'i' }, audit: { use: 'a' }, revise: { use: 'r' }, accept: { use: 'c' } }
            const deps = {
                stores: { notes: memStore([]), cores: memStore([]), relations: memStore([]), holds: memStore([]), checks: memStore([]), docs: memStore([]) },
                settings: resolveExtractSettings({ extract: { perRun: 2, minNotes: 100, ai: seats } }),
                dirs,
                clock,
                domains: { extract: createExtractDomain({}), relate: createRelateDomain({}) },
            }
            // 缺關聯 domain(衝突型、其舊名、型別現名化):衝突之重審、去向與關聯變更之影響會靜默失能 → 拋,且未寫任何檔
            fs.mkdirSync(dirs.state, { recursive: true })
            const noRelate = (relate) => stageExtract({ minNotes: 100 }).run({ deps: { ...deps, domains: { extract: deps.domains.extract, ...(relate ? { relate } : {}) } }, log })
            await assert.rejects(noRelate(null), /提煉需要關聯 domain：每輪依賴之 domains 須給 relate（缺 conflictType、conflictTypeNames、resolveType）/)
            await assert.rejects(noRelate({ conflictType: '衝突', conflictTypeNames: ['衝突'] }), /每輪依賴之 domains 須給 relate（缺 resolveType）/)
            await assert.rejects(noRelate({ conflictType: '', conflictTypeNames: '衝突', resolveType: (t) => t }), /每輪依賴之 domains 須給 relate（缺 conflictType、conflictTypeNames）/, '衝突型為空字串、舊名非陣列亦屬缺')
            assert.deepEqual(fs.readdirSync(dirs.state), [], '拋於任何寫入之前')
            const r = await stageExtract({ minNotes: 100 }).run({ deps, log })
            assert.equal(r.detail.concepts, 0)
            await assert.rejects(() => stageExtract({}).run({ deps: { ...deps, settings: { extract: {} } }, log }), /提煉需要 settings\.extract\.ai = \{ drafters:\[3 席\], integrate, audit, revise, accept \}/)
            await assert.rejects(() => stageExtract({}).run({ deps: { ...deps, settings: { extract: { ai: { judge: { use: 'x' } } } } }, log }), /settings\.extract\.ai 含不認得之鍵：judge/)
        })

        it('逐核心動作環:opt 非物件皆視為{},不拋錯;名稱即 hook 錨點', () => {
            const mws = [mwLoadState('x'), mwSelectNotes('x'), mwPass('x'), mwRenderState('x'), mwPersistState('x')]
            assert.deepEqual(mws.map((m) => m.name), ['loadState', 'selectNotes', 'pass', 'renderState', 'persistState'])
        })
    })
})

/** 分身測試用:以差量造一條主張(C1)與本質(ES6)並落帳,讓待審之 supersede 有合法目標 */
function applyDeltaSeed(base) {
    return seedCore({ base, ops: [{ op: 'add', ref: 's', kind: 'principle', text: '種子主張', basis: '案例', sources: ['N0'] }, { op: 'essence', text: '種子主張', claims: ['@s'], reason: '首版' }], batch: [{ code: 'N0', id: 'seed0' }], at: '2026-09-01T00:00:00+08:00' })
}
