// unit-extract-failpaths.test.mjs — 提煉段之失敗／中斷路徑:狀態檔四態於段層、高水位與投影補正之不變式、分身補完、維護失敗之留待、判定小組專步之斷網、並行共寫失敗帳、還原撤回之中斷、手改另存、步 × 到點、失敗帳寫入失敗
//
// 規則出處(逐項;斷言之上一行另標所對應之規則句):
//   ①狀態檔四態(段層):stages/extractChain.mjs mwLoadState 之 JSDoc(短路:壞檔無上一版、修復失敗、非本格式版本、讀取失敗;recovered 立即修復——
//     不留「可讀不可寫」之狀態給其後之落盤)、stores/coreStore.mjs 檔頭【四態分流表只一份】、stores/coreProjection.mjs newCoreIdOf 之註解(壞檔無上一版
//     由選中時之載入隔離並記 ERROR,不以之改種子)、stages/extractMaintain.mjs STATE_REPAIR_FUSE、stages/extractStage.mjs 檔頭【失敗帳】、規則帳本 EXT-25
//   ②高水位:stores/coreProjection.mjs highWater／programWriteProblems 之 JSDoc、mwLoadState 之 JSDoc(狀態比投影舊者 WARN 並保 id 高水位)
//   ③分身補完:stores/coreProjection.mjs settleTwins 之 JSDoc(補完先前中斷之分身;冪等;回傳本次新標記之分身數)
//   ④維護失敗:stages/extractMaintain.mjs finishImpact 之 JSDoc 與 catch 註解、maintainCores 之重設基準註解、stores/rebaseline.mjs rebaselineDone 之 JSDoc、
//     stores/contentCache.mjs 檔頭(派生檔)與 saveNoTopCache 之 JSDoc、規則帳本 EXT-18／EXT-26、logContract.mjs EXTRACT_LOG_MUST_SEE(維護失敗)
//   ⑤四專步之斷網:workflow/aiCall.mjs 檔頭【歸類】②、規則帳本之三原則③、規則帳本鐵則 5／EXT-27、stages/extractChain.mjs mwPass 之註解
//     (專步之失敗另立欄位)與 stopWord、stages/synonymStep.mjs 檔頭
//   ⑥並行共寫:stores/extractLedger.mjs 檔頭【單一共享物件】、stages/extractStage.mjs 檔頭【失敗帳】
//   ⑦還原撤回之中斷:ops/reviveClaims.mjs 檔頭【規則】③序(可續作)與 JSDoc @throws(未落盤;裁示紀錄已寫,待判不動——重跑即續作)
//   ⑧手改另存:stores/coreStore.mjs 檔頭【手改偵測】與 guardManualEdit 之 JSDoc、stores/coreProjection.mjs writeProjections／persistMechanical 之 JSDoc、
//     stages/extractMaintain.mjs redoDirtyProjections 之 JSDoc
//   ⑨步 × 到點:stages/extractStage.mjs 檔頭【時間預算】與【失敗帳】(時間預算截止只記 lastTriedAt)、stages/extractSteps.mjs NO_FAIL_HALTS、
//     stages/extractChain.mjs mwPass 之註解(MODES 之專步不動 tries)
//   ⑩失敗帳寫入失敗:stages/extractSteps.mjs finish() 之註解、logContract.mjs EXTRACT_LOG_MUST_SEE(帳檔寫入失敗)
// 注入手法:狀態檔或帳檔之路徑以目錄占用(讀寫失敗)、集合之替身(spread 既有記憶體集合後覆寫 replace)、AI 替身之回覆函數內於本輪中途建目錄;皆不改 fs 之方法
// 執行:自套件根 node <mocha> test/unit-extract-failpaths.test.mjs(暫存 test/_tmp/extract-failpaths-<pid>,測完即刪;AI 為替身)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import {
    mkEnvIn, runStage, scriptAi, fixedClock, has, readState, ledgerOf, draftAll, codesIn, ANN, doubtOn, addNotes, noteRow, writeNote,
} from './tools/extractKit.mjs'
import { DELETION_FILES } from './tools/relateForTest.mjs'
import { QUANT_RULE } from './tools/summarizeForTest.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'
import { slugify, putHold } from '../src/core/capturePackage.mjs'
import { readMd, writeMd } from '../src/core/summarizePackage.mjs'
import { emptyState } from '../src/stores/coreState.mjs'
import { createCoreStore } from '../src/stores/coreStore.mjs'
import { coreLedgerKeyOf } from '../src/stores/extractLedger.mjs'
import { ATTEMPTS_FILE, CONTENT_CACHE_FILE, NO_TOP_CACHE_FILE, EDGE_SEEN_FILE, IMPACT_LEDGER_FILE, REBASELINE_FILE } from '../src/stores/extractFiles.mjs'
import { requestRebaseline } from '../src/stores/rebaseline.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { SYNONYM_LEDGER_KEY } from '../src/stages/synonymStep.mjs'
import { reviveClaims } from '../src/ops/reviveClaims.mjs'
import { EXTRACT_LOG_MUST_SEE } from '../src/logContract.mjs'

let TMP = ''
let mkEnv = null

/** 巡檢之須見字樣(logContract;行內命中即列出) */
const MUST = new RegExp(EXTRACT_LOG_MUST_SEE.join('|'))
/** 到點之判定(兩棒之間問 shouldStop;給了即截止感知) */
const STOP = () => true
/** 判定小組三席皆斷網(調度層標整鏈皆敗且本機網路不通;extractKit 之 scriptAi 之 'netDown') */
const DOWN = Object.freeze({ ck1: 'netDown', ck2: 'netDown', ck3: 'netDown' })
const AT = '2026-10-01T12:00:00+08:00'

/** 一個概念之筆記夾具(id＝前綴＋序號) */
const notesOf = (prefix, concept, n = 3) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, concepts: [concept] }))
/** 核心狀態檔之路徑 */
const stateFileOf = (env, id) => `${env.dirs.coreState}/${id}.state.json`
/** 讀檔(utf8) */
const textOf = (file) => fs.readFileSync(file, 'utf8')
/** 唯一之核心記錄 */
const coreRec = async (env) => (await env.stores.cores.select())[0]
/** 概念之失敗帳鍵 */
const lkey = (concept) => coreLedgerKeyOf({ concept })
/** 判定小組席位(覆核三席;各專步共用) */
const panelSeats = (env) => {
    env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' }, third: { use: 'ck3' } }
}
/** 路徑統一為正斜線(比對用) */
const slash = (p) => String(p).replace(/\\/g, '/')

/** 存量覆核替身:依斷言開頭回裁決(by:{ 開頭: 裁決 });其餘 supported */
const stockCk = (by = {}) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項（.+?）---\n斷言：(.+)$/gm)].map((m) => {
    const hit = Object.keys(by).find((k) => m[2].startsWith(k))
    return { index: Number(m[1]), verdict: hit ? by[hit] : 'supported', reason: '出處之內容與斷言之關係說明' }
}) })
/** 爭議覆核替身:每項回 v */
const disputeCk = (v) => (p) => ({ checks: [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => ({ index: Number(m[1]), ...v })) })
const OPPOSED = { verdict: 'opposed', reason: '一方說需要預熱一方說可省略' }
/** 同義替身:提議席回空名單;覆核逐項回 same */
const synCk = (p) => (/的同義概念提議員/.test(p) ? { pairs: [] } : { checks: [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => ({ index: Number(m[1]), verdict: 'same', reason: '兩者之本質與主張談的是同一件事' })) })
/** 同義之兩個主核心(名稱相近)之筆記 */
const synNotes = () => [...notesOf('s', '最優執行'), ...notesOf('t', '最適執行')]

/** 起草替身:一條主張＋一則爭議(一方只有立場文字)＋本質(終審以 doubtOn 存疑 → 爭議覆核到期) */
const draftDispute = (p) => {
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
/** 起草替身:同 draftAll 而主張不寫證據性質(推定只及於未寫者) */
const draftPlain = (p) => {
    const out = draftAll(p)
    return { ...out, ops: out.ops.map((op) => (op.op === 'add' ? { ...op, basis: '' } : op)) }
}
/** 起草替身:新增一條並以之取代 C1(終審失敗 → 取代存待審) */
const draftSupersede = (p) => ({
    ops: [{ op: 'add', ref: 'n', kind: 'rule', text: '新主張', basis: '案例', sources: [codesIn(p)[0]], ...ANN }, { op: 'supersede', id: 'C1', by: '@n', reason: '新研究', validPeriod: '較早之研究', sources: [codesIn(p)[0]] }],
    skipped: [{ note: codesIn(p)[1], reason: '離題' }, { note: codesIn(p)[2], reason: '離題' }],
})

/** 寫刪除墓碑(關聯段之明示刪除;提煉讀之以撤出處) */
const tombstone = (env, id) => fs.writeFileSync(path.join(env.dirs.state, DELETION_FILES.tombstones), JSON.stringify({ ids: { [id]: { at: AT, reason: '測試刪除' } } }), 'utf8')

/**
 * 還原撤回之前置:建核心 → 存量覆核撤回「主張 q2」(覆核無出處支持)→ 其 ES9 待判(未結)
 *
 * @param {String} concept 輸入概念名
 * @returns {Promise<Object>} 回傳 { env, rec, q2, file, key, deps, opt }
 */
async function seedRetracted(concept) {
    const env = mkEnv(notesOf('q', concept))
    panelSeats(env)
    await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
    const rec = await coreRec(env)
    env.settings.extract.standards.supportStock.perRun = 10
    await runStage(env, scriptAi({ ck1: stockCk({ '主張 q2': 'insufficient' }), ck2: stockCk({ '主張 q2': 'contradicted' }) }), {}, { clock: fixedClock('2026-10-02') })
    const file = stateFileOf(env, rec.id)
    const q2 = JSON.parse(textOf(file)).claims.find((c) => c.text === '主張 q2')
    assert.deepEqual([q2.status, q2.retractReason], ['retracted', '覆核無出處支持'], '前提:存量覆核撤回')
    await putHold(env.stores.holds, { object: 'claim', oid: `${rec.id}:${q2.id}`, std: 'ES9', reason: '相關之未結待判', next: 'n', owner: 'user' }, '2026-10-02T12:00:00+08:00')
    const deps = { stores: env.stores, dirs: env.dirs, domain: env.domains.extract, clock: fixedClock('2026-10-03') }
    return { env, rec, q2, file, key: `claim:${rec.id}:${q2.id}`, deps, opt: { core: rec.id, ids: [q2.id], by: '王小明', ruling: '原文第二段即支持此主張' } }
}

describe('unit-extract-failpaths', function() {

    this.timeout(180_000)

    before(() => {
        TMP = tmpRoot('extract-failpaths')
        mkEnv = mkEnvIn(TMP)
    })
    after(() => removeRoots([TMP]))

    // ══════════════════════════ ① 狀態檔四態於段層 ══════════════════════════

    it('①讀取失敗(error 態;狀態檔之路徑被目錄占用):ERROR「狀態檔讀取失敗」、本概念跳過——不呼叫 AI、不覆寫(路徑原樣、md 與記錄不動)、失敗帳 tries＋1、計入失敗', async function () {
        const env = mkEnv(notesOf('r', '讀取態'))
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const rec = await coreRec(env)
        const file = stateFileOf(env, rec.id)
        fs.rmSync(file)
        fs.mkdirSync(file)
        const mdBefore = textOf(rec.file)
        await addNotes(env, ['r4', 'r5', 'r6'], ['讀取態'])
        const ai = scriptAi({ draft: draftAll })
        const { report, log } = await runStage(env, ai, {}, { clock: fixedClock('2026-10-02') })
        // mwLoadState「短路:…讀取失敗」;四態分流表 error 態(四態皆否、why 載明「狀態檔讀取失敗」)→ ERROR、本概念跳過、不覆寫
        assert.ok(has(log, /^ERROR 提煉\[讀取態\]：狀態檔讀取失敗（.+）；本概念跳過、不覆寫$/), log.lines.join('\n'))
        // 「本概念跳過」:不呼叫 AI
        assert.equal(ai.calls.length, 0)
        // 「不覆寫」:狀態檔之路徑原樣(仍為目錄)、md 與 cores 記錄不動
        assert.ok(fs.statSync(file).isDirectory())
        assert.equal(textOf(rec.file), mdBefore)
        assert.equal((await env.stores.cores.get(rec.id)).rev, rec.rev)
        // 檔頭【失敗帳】「凡本輪對此核心有嘗試而未落盤皆須落帳…狀態檔損壞／非本格式／遺失…→ tries＋1」(mwLoadState 之載入失敗之落帳:tries、lastTriedAt、lastError)
        const led = ledgerOf(env, lkey('讀取態'))
        assert.deepEqual([led.tries, led.lastTriedAt], [1, '2026-10-02T00:00:00+08:00'])
        assert.match(led.lastError, /^狀態檔讀取失敗（/)
        // extractSteps 檔頭【失敗之計】「各 pass 之未產出計入本核心之失敗;無事可做與截止不計」
        assert.equal(report.detail.failed, 1)
    })

    it('①壞檔無上一版(corrupt 態;無記錄之孤兒狀態檔):選中之載入隔離為 .corrupt-<時戳>、ERROR、本概念跳過(不呼叫 AI、不建記錄與 md)、失敗帳 tries＋1;次輪新核心沿用原 slug(壞檔不改種子)', async function () {
        const concept = '孤兒檔'
        const env = mkEnv(notesOf('o', concept))
        const id = slugify(concept, `core|${concept}`)
        const file = stateFileOf(env, id)
        const bad = '{"v":3,"claims":"壞'
        fs.writeFileSync(file, bad, 'utf8')
        const ai1 = scriptAi({ draft: draftAll })
        const r1 = await runStage(env, ai1, {}, { clock: fixedClock('2026-10-01') })
        // mwLoadState「短路:壞檔無上一版」:隔離(coreStore 檔頭「壞檔隔離(標記 corrupt)」)並 ERROR、本概念跳過、不覆寫
        assert.ok(has(r1.log, /^ERROR 提煉\[孤兒檔\]：狀態檔毀損且無上一版（JSON 解析失敗：.*）；本概念跳過、不覆寫$/), r1.log.lines.join('\n'))
        assert.equal(ai1.calls.length, 0, '「本概念跳過」:不呼叫 AI')
        // 隔離＝改名移開(不刪):封存檔名 <檔名>.<標記>-<時刻>,內容即原壞檔
        assert.equal(fs.existsSync(file), false)
        const archived = `${env.dirs.state}/core/archive/${id}.state.json.corrupt-20261001`
        assert.equal(textOf(archived), bad)
        // 「不覆寫」:不建 cores 記錄、不寫核心 md
        assert.deepEqual([(await env.stores.cores.select()).length, fs.existsSync(`${env.dirs.core}/${id}.md`)], [0, false])
        // 檔頭【失敗帳】「狀態檔損壞…→ tries＋1」
        const led = ledgerOf(env, lkey(concept))
        assert.equal(led.tries, 1)
        assert.match(led.lastError, /^狀態檔毀損且無上一版（/)
        // newCoreIdOf「壞檔無上一版…由選中時之載入隔離並記 ERROR,不以之改種子(否則該概念永遠配到 -1 之 id,原檔隔離後亦不回頭)」
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-02') })
        const rec = await coreRec(env)
        assert.equal(rec.id, id)
        assert.deepEqual([readState(env, id).rev, readState(env, id).consumed.length], [1, 3])
        // mwPersistState「落盤成功 → tries 歸零」(選題之失敗帳清除)
        assert.equal(ledgerOf(env, lkey(concept)).tries, 0)
    })

    it('①recovered 於選中之載入(維護段熔斷後未修之核心被選中):立即修復(隔離壞檔、自上一版落盤、投影)再照常提煉——六份壞檔皆還原、無 CAS 錯誤、各核心升版', async function () {
        const concepts = ['甲一', '甲二', '甲三', '甲四', '甲五', '甲六']
        const env = mkEnv(concepts.flatMap((c, k) => notesOf(`f${k}`, c)), { extract: { perRun: 6 } })
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const cores = await env.stores.cores.select()
        assert.equal(cores.length, 6, '前提:六個核心')
        const prevDir = `${env.dirs.state}/core/prev`
        fs.mkdirSync(prevDir, { recursive: true })
        for (const c of cores) {
            fs.copyFileSync(stateFileOf(env, c.id), `${prevDir}/${c.id}.state.prev.json`)
            fs.writeFileSync(stateFileOf(env, c.id), '{"v":3,"claims":"壞', 'utf8')
        }
        await env.stores.notes.insertNew(concepts.map((c, k) => noteRow(env.dirs, { id: `f${k}9`, concepts: [c] })))
        const { report, log } = await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-02') })
        // STATE_REPAIR_FUSE「維護段單輪修復＋隔離逾此數即停手、其餘留待下輪」:熔斷須見
        assert.ok(has(log, /^WARN 提煉狀態檔熔斷：本輪已修復或隔離 5 份核心狀態檔（上限 5）/), log.lines.join('\n'))
        // mwLoadState「壞檔或遺失而上一版救得回者立即修復(隔離、高水位、落盤、投影)」:熔斷所留之第六份由選中之載入修復——六個概念各一行還原
        const restored = log.lines.filter((l) => /^WARN 提煉狀態還原\[/.test(l)).map((l) => l.match(/^WARN 提煉狀態還原\[(.+?)\]/)[1])
        assert.deepEqual([...restored].sort(), [...concepts].sort(), log.lines.join('\n'))
        // 「不留可讀不可寫之狀態給其後之落盤(CAS 必撞壞檔)」:無任何 ERROR(CAS、跳過)
        assert.deepEqual(log.lines.filter((l) => /^ERROR /.test(l)), [])
        // 修復後照常提煉:各核心納入新筆記並升版;壞檔皆隔離(不刪)
        for (const [k, c] of cores.entries()) {
            const st = readState(env, c.id)
            assert.ok(st.version === 2 && st.consumed.some((id) => /9$/.test(id)), `${c.concept}:${JSON.stringify([st.version, st.consumed])}`)
            assert.ok(st.rev > c.rev, `${c.id}:rev 延續遞增(${k})`)
        }
        assert.equal(fs.readdirSync(`${env.dirs.state}/core/archive`).filter((f) => /\.state\.json\.corrupt-/.test(f)).length, 6)
        assert.equal(report.detail.updated, 6)
    })

    // ══════════════════════════ ② 高水位 ══════════════════════════

    it('②狀態比投影舊(record.rev > state.rev;如 git 回滾狀態檔):WARN「比投影舊」、以狀態為準重建投影,rev 與 id 計數取高水位——新條目不重用回滾掉之編號', async function () {
        const concept = '高水位'
        const env = mkEnv(notesOf('h', concept))
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const id = (await coreRec(env)).id
        const file = stateFileOf(env, id)
        const text1 = textOf(file)
        await addNotes(env, ['h4', 'h5', 'h6'], [concept])
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-02') })
        const rec2 = await env.stores.cores.get(id)
        const s1 = JSON.parse(text1)
        const s2 = readState(env, id)
        assert.ok(rec2.rev > s1.rev && s2.claims.length > s1.claims.length, '前提:第二版落盤')
        // 回滾:狀態檔回到第一版(投影仍為第二版)
        fs.writeFileSync(file, text1, 'utf8')
        await addNotes(env, ['h7', 'h8', 'h9'], [concept])
        const { log } = await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-03') })
        // mwLoadState「狀態比投影舊者 WARN 並保 id 高水位」
        assert.ok(has(log, new RegExp(`^WARN 提煉投影補正\\[${concept}\\]：狀態（rev ${s1.rev}）比投影舊（rev ${rec2.rev}），以狀態為準重建投影（回滾後被退掉之版次所用筆記重新待提煉）$`)), log.lines.join('\n'))
        // mwLoadState「磁碟 md 為較新之投影(回滾後):其雜湊記入已知集……否則重建投影時被當手改另存」:較新之投影不是手改
        assert.ok(!has(log, /提煉手改另存/), log.lines.filter((l) => /手改/.test(l)).join('\n'))
        const s3 = readState(env, id)
        // highWater「狀態自較舊來源接續時(.prev 還原、git 回滾)取投影之高水位:rev」——否則同一 rev 在投影與新狀態中指不同內容
        assert.ok(s3.rev > rec2.rev, `${s3.rev} > ${rec2.rev}`)
        // recordOf「所有投影寫入器皆經此」:投影與狀態同步
        assert.equal((await env.stores.cores.get(id)).rev, s3.rev)
        // highWater「…與各前綴之下一個 id——否則同一〔C5〕在投影與新狀態中指不同內容」:回滾後新立之條目不得與第二版之條目同號
        const v1Ids = new Set(s1.claims.map((c) => c.id))
        const v2Ids = new Set(s2.claims.map((c) => c.id))
        const fresh = s3.claims.map((c) => c.id).filter((x) => !v1Ids.has(x))
        assert.ok(fresh.length > 0, '前提:回滾後之一批立了新條目')
        assert.deepEqual(fresh.filter((x) => v2Ids.has(x)), [], `新條目 ${fresh} 不重用第二版之 ${[...v2Ids]}`)
    })

    it('②投影補正違反程式寫入之不變式(programWriteProblems;手造之舊狀態:seen 含未消化之筆記):ERROR「投影補正違反不變式(未落盤)」、不呼叫 AI、狀態檔與記錄不動、失敗帳 tries＋1', async function () {
        const concept = '補正不變式'
        const env = mkEnv(notesOf('v', concept))
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const id = (await coreRec(env)).id
        const file = stateFileOf(env, id)
        const s1 = JSON.parse(textOf(file))
        await addNotes(env, ['v4', 'v5', 'v6'], [concept])
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-02') })
        const rec2 = await env.stores.cores.get(id)
        // 手造:回滾至第一版且帶一筆未消化筆記之出處版本紀錄(舊資料／手改之殘留)
        s1.seen.ghost = { ...(s1.seen[s1.consumed[0]] || { k: 'k', v: 'v' }) }
        fs.writeFileSync(file, `${JSON.stringify(s1, null, 2)}\n`, 'utf8')
        const textBad = textOf(file)
        await addNotes(env, ['v7', 'v8', 'v9'], [concept])
        const ai = scriptAi({ draft: draftAll })
        const { log } = await runStage(env, ai, {}, { clock: fixedClock('2026-10-03') })
        // programWriteProblems「程式自身之寫入(…高水位補正)…皆為違反——不寫入」;mwLoadState 之 ERROR 字樣(須見「違反不變式」)
        const line = log.lines.find((l) => /投影補正違反不變式/.test(l))
        assert.match(line || '', new RegExp(`^ERROR 提煉\\[${concept}\\]：投影補正違反不變式（未落盤）：.*seen 含未消化之筆記：ghost`), log.lines.join('\n'))
        assert.ok(MUST.test(line), '須見')
        // 「未落盤」:狀態檔逐字不動、cores 記錄不動;本概念不呼叫 AI
        assert.equal(textOf(file), textBad)
        assert.equal((await env.stores.cores.get(id)).rev, rec2.rev)
        assert.equal(ai.calls.length, 0)
        // 檔頭【失敗帳】「凡本輪對此核心有嘗試而未落盤皆須落帳」
        const led = ledgerOf(env, lkey(concept))
        assert.equal(led.tries, 1)
        assert.match(led.lastError, /^投影補正違反不變式：.*seen 含未消化之筆記：ghost/)
    })

    // ══════════════════════════ ③ 分身補完 ══════════════════════════

    it('③分身補完(手造之舊資料／中斷殘留:記錄已標 merged＋mergedInto 而 md 仍為原文、狀態檔未封存):主核心落盤後補做——原文封存、md 改轉址頁、狀態檔封存;不計為本次新標記;冪等', async function () {
        const concept = '分身補完'
        const env = mkEnv(notesOf('t', concept))
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const main = await coreRec(env)
        const twinId = 'twin-old'
        const twinFile = slash(`${env.dirs.core}/${twinId}.md`)
        writeMd(twinFile, { concept, type: 'core', version: 1 }, `# 核心知識：${concept}\n\n合併前之原文（舊分身）`)
        createCoreStore({ dir: env.dirs.coreState }).save(twinId, emptyState({ coreId: twinId, concept }), { expectRev: null })
        await env.stores.cores.replace({ id: twinId, concept, scope: 'concept', file: twinFile, version: 1, rev: 1, noteCount: 0, noteIds: [], status: 'merged', mergedInto: main.id, mergedAt: '2026-09-30T00:00:00+08:00', updatedAt: '2026-09-30T00:00:00+08:00', pendingReview: 0 })
        await addNotes(env, ['t4', 't5', 't6'], [concept])
        const r2 = await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-02') })
        // settleTwins「並補完先前中斷之分身(mergedInto＝本核心而 md 尚非轉址頁者)」;「前言之機制鍵(type:'redirect'、concept、mergedInto)由本函數寫」
        const md = readMd(twinFile)
        assert.deepEqual([md.front.type, md.front.concept, md.front.mergedInto], ['redirect', concept, main.id])
        assert.match(md.body, new RegExp(`\\[\\[${main.id}\\]\\]`), '轉址頁指向主核心')
        // settleTwins「原 md 封存並改寫轉址頁」:封存檔為合併前之原文;記錄記封存路徑,mergedAt 沿用既有者
        const archived = slash(`${env.dirs.state}/core/archive/${twinId}.md.merged-20261002.md`)
        assert.match(textOf(archived), /合併前之原文（舊分身）/)
        const tw = await env.stores.cores.get(twinId)
        assert.deepEqual([tw.status, tw.mergedInto, tw.mergedAt, slash(tw.archivedFile)], ['merged', main.id, '2026-09-30T00:00:00+08:00', archived])
        // settleTwins「→ 狀態檔封存」:不留在狀態目錄,改名入封存目錄
        assert.equal(fs.existsSync(stateFileOf(env, twinId)), false)
        assert.ok(fs.existsSync(`${env.dirs.state}/core/archive/${twinId}.state.json.merged-20261002`))
        // settleTwins「resolve 回傳本次新標記之分身數」:補完者不是本次新標記
        assert.equal(r2.report.detail.twinsMerged, 0)
        // 「冪等」:再一次主核心落盤 → 已是轉址頁者不再包(封存檔不被轉址頁覆寫、不另封存)
        await addNotes(env, ['t7', 't8', 't9'], [concept])
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-03') })
        assert.match(textOf(archived), /合併前之原文（舊分身）/)
        assert.equal(fs.existsSync(`${env.dirs.state}/core/archive/${twinId}.md.merged-20261003.md`), false)
        assert.equal(readMd(twinFile).front.type, 'redirect')
    })

    // ══════════════════════════ ④ 維護失敗 ══════════════════════════

    it('④關聯影響收尾失敗(finishImpact 之 catch;影響帳之路徑被目錄占用):maintainFailed＋1、WARN「提煉維護失敗[關聯影響收尾]」(須見)、快照不前進;下輪以同一舊快照重算差分並補寫', async function () {
        const env = mkEnv(notesOf('i', '影響收尾'), { extract: { recheck: { relationImpact: true } } })
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const seenFile = `${env.dirs.state}/${EDGE_SEEN_FILE}`
        const snap1 = textOf(seenFile)
        await env.stores.relations.insertNew([{ id: 'e-x', from: 'xx', to: 'yy', type: '互補搭配', reason: '無關', createdAt: AT, updatedAt: AT }])
        const ledgerPath = `${env.dirs.state}/${IMPACT_LEDGER_FILE}`
        fs.mkdirSync(ledgerPath)
        const r2 = await runStage(env, scriptAi({}), {}, { clock: fixedClock('2026-10-02') })
        // 規則帳本 EXT-26「影響收尾 finishImpact try/catch 留待下輪(WARN「提煉維護失敗[關聯影響收尾]」)」
        const line = r2.log.lines.find((l) => /提煉維護失敗\[關聯影響收尾\]/.test(l))
        assert.match(line || '', /^WARN 提煉維護失敗\[關聯影響收尾\]：/, r2.log.lines.join('\n'))
        assert.ok(MUST.test(line), '須見')
        assert.equal(r2.report.detail.maintainFailed, 1)
        // catch 註解「快照未更新 → 下輪以同一舊快照重算差分」;finishImpact「先帳與留待、後快照——快照寫成即視為本輪事件已交付」
        assert.equal(textOf(seenFile), snap1)
        fs.rmSync(ledgerPath, { recursive: true, force: true })
        const r3 = await runStage(env, scriptAi({}), {}, { clock: fixedClock('2026-10-03') })
        // 「下輪以同一舊快照重算差分(處置為冪等)」:同一事件再產生一次、此次交付(影響帳有該邊、快照前進)
        assert.deepEqual([r3.report.detail.impactEvents, r3.report.detail.maintainFailed], [1, 0], JSON.stringify(r3.report.detail))
        const rows = textOf(ledgerPath).trim().split('\n').map((l) => JSON.parse(l))
        assert.ok(rows.some((x) => x.edgeId === 'e-x' || (x.edges || []).includes('e-x')), JSON.stringify(rows))
        assert.ok(JSON.parse(textOf(seenFile)).edges['e-x'])
    })

    it('④派生快取寫不進(內容鍵快取、推定判定快取之路徑被目錄占用):WARN「提煉維護失敗[內容鍵快取]」／「[推定判定快取]」(須見),本輪照常提煉', async function () {
        const env = mkEnv(notesOf('c', '快取寫入'))
        fs.mkdirSync(`${env.dirs.state}/${CONTENT_CACHE_FILE}`)
        const r1 = await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        // maintainCores 之 cache.save() 以 try/catch 告警(logContract:「維護失敗」須見)
        const line = r1.log.lines.find((l) => /提煉維護失敗\[內容鍵快取\]/.test(l))
        assert.match(line || '', /^WARN 提煉維護失敗\[內容鍵快取\]：/, r1.log.lines.join('\n'))
        assert.ok(MUST.test(line))
        // contentCache 檔頭「派生檔,缺／壞／版本不符即重建」:寫不進不影響本輪之提煉
        assert.deepEqual([r1.report.detail.updated, r1.report.detail.failed], [1, 0])
        // 推定判定快取(規則開啟之 domain 才讀寫)
        const envN = mkEnv(['p1', 'p2', 'p3'].map((id) => ({ id, concepts: ['推定快取'], caveats: ['無樣本外驗證'] })))
        envN.domains.extract = createExtractDomain({ vocab: { ...QUANT_VOCAB, evidenceRule: QUANT_RULE } })
        fs.mkdirSync(`${envN.dirs.state}/${NO_TOP_CACHE_FILE}`)
        const rN = await runStage(envN, scriptAi({ draft: draftPlain }), {}, { clock: fixedClock('2026-10-01') })
        // saveNoTopCache「派生檔:寫不進只 WARN——下次以 md 重判,不影響本輪之渲染」
        const lineN = rN.log.lines.find((l) => /提煉維護失敗\[推定判定快取\]/.test(l))
        assert.match(lineN || '', /^WARN 提煉維護失敗\[推定判定快取\]：/, rN.log.lines.join('\n'))
        assert.ok(MUST.test(lineN))
        assert.deepEqual([rN.report.detail.updated, rN.report.detail.failed], [1, 0])
    })

    it('④有核心維護失敗(故障注入:證據外掛改主張文字 → 維護寫入違反不變式)→ 重設基準名單中屬該核心之 id 保留至下輪(INFO 載明);修好後下輪處置並刪名單', async function () {
        const concept = '重設保留'
        const env = mkEnv(notesOf('g', concept))
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const flag = requestRebaseline(env.dirs, '2026-10-01T18:00:00+08:00', ['g1'])
        assert.equal(slash(flag), slash(`${env.dirs.state}/${REBASELINE_FILE}`), '前提:名單檔之位置')
        const dom = env.domains.extract
        env.domains.extract = { ...dom, evidence: { ...dom.evidence, apply: (s, m) => { dom.evidence.apply(s, m); s.claims[0].text = '外掛改寫之文字' } } }
        const r1 = await runStage(env, scriptAi({}), {}, { clock: fixedClock('2026-10-02') })
        // EXT-18「逐核心 try/catch(WARN「提煉維護失敗[概念]」MUST_SEE)」(前提:本案之維護失敗確實發生)
        assert.ok(has(r1.log, new RegExp(`^WARN 提煉維護失敗\\[${concept}\\]：不變式違反（維護寫入，未落盤）`)), r1.log.lines.join('\n'))
        assert.equal(r1.report.detail.maintainFailed, 1)
        // maintainCores「維護畢只刪已處置之 id(所屬核心維護失敗者保留至下輪)」;rebaselineDone「所屬核心維護失敗者由呼叫端不列入,保留至下輪」
        assert.ok(has(r1.log, /^INFO 提煉重設內容基準（requestRebaseline 之名單 1 篇）：.*；1 篇所屬核心維護失敗，指示保留至下輪$/), r1.log.lines.join('\n'))
        assert.deepEqual(Object.keys(JSON.parse(textOf(flag)).ids), ['g1'])
        env.domains.extract = dom
        const r2 = await runStage(env, scriptAi({}), {}, { clock: fixedClock('2026-10-03') })
        // rebaselineDone「只刪已處置之 id…(空即刪檔)」
        assert.equal(r2.report.detail.maintainFailed, 0)
        assert.equal(fs.existsSync(flag), false)
    })

    // ══════════════════════════ ⑤ 四專步之斷網 ══════════════════════════

    it('⑤斷網不計(四專步;對稱關聯套件之 R75):爭議 ES14、存量 ES9、失撐 ES8、同義 ES11 之判定小組席皆斷網 → 不計 <mode>Tries／逐項計次、不記檢核紀錄、不登錄待判(不轉使用者)、狀態不落盤;WARN 含「本機網路不通」;下輪照排(未退避)', async function () {
        // ── 爭議覆核(ES14;檢核紀錄記於狀態之 doubtChecks)──
        const envD = mkEnv(notesOf('e', '爭議斷網'), { extract: { standards: { disputeCheck: { perRun: 2, waitDays: 0 } } } })
        panelSeats(envD)
        await runStage(envD, scriptAi({ draft: draftDispute, accept: doubtOn }), {}, { clock: fixedClock('2026-10-01') })
        const recD = await coreRec(envD)
        const textD = textOf(stateFileOf(envD, recD.id))
        const holdsD = (await envD.stores.holds.select()).length
        const rD = await runStage(envD, scriptAi(DOWN), {}, { clock: fixedClock('2026-10-02') })
        // aiCall【歸類】②「斷網:調度層標 netDown——網路問題不算在這一棒頭上(不計失敗、不計次)」;mwPass 之 stopWord(本機網路不通)
        assert.ok(has(rD.log, /^WARN 提煉\[爭議斷網\]：爭議覆核因本機網路不通未完成（本次不套用、不計失敗，下輪再做）$/), rD.log.lines.join('\n'))
        // 三原則③「基礎設施失敗留待、不計失敗、不轉使用者」:專步層之 disputeTries 與逐項之 disputeItemTries 皆不增
        const ledD = ledgerOf(envD, lkey('爭議斷網'))
        assert.deepEqual([ledD?.disputeTries || 0, ledD?.disputeItemTries], [0, undefined])
        // 「未判不記已審」:doubtChecks 不記(狀態檔逐字不變);待判不增(不轉使用者)
        assert.equal(textOf(stateFileOf(envD, recD.id)), textD)
        assert.equal((await envD.stores.holds.select()).length, holdsD)
        assert.deepEqual([rD.report.detail.failed, rD.report.detail.disputeFailStreak], [0, 0])
        // 不計失敗即不退避:下輪(同日)照排並判成
        const rD2 = await runStage(envD, scriptAi({ ck1: disputeCk(OPPOSED), ck2: disputeCk(OPPOSED) }), {}, { clock: fixedClock('2026-10-02') })
        assert.equal(rD2.report.detail.disputeOpposed, 1, '斷網之後未被退避')

        // ── 出處支持存量覆核(ES9 存量;檢核紀錄記於 checks 集合)──
        const envS = mkEnv(notesOf('q', '存量斷網'))
        panelSeats(envS)
        await runStage(envS, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        envS.settings.extract.standards.supportStock.perRun = 10
        const recS = await coreRec(envS)
        const textS = textOf(stateFileOf(envS, recS.id))
        const [holdsS, checksS] = [(await envS.stores.holds.select()).length, (await envS.stores.checks.select()).length]
        const rS = await runStage(envS, scriptAi(DOWN), {}, { clock: fixedClock('2026-10-02') })
        // aiCall【歸類】②;mwPass 之 stopWord
        assert.ok(has(rS.log, /^WARN 提煉\[存量斷網\]：出處支持存量覆核因本機網路不通未完成（本次不套用、不計失敗，下輪再做）$/), rS.log.lines.join('\n'))
        // 三原則③:supportTries、supportItemTries 不增
        const ledS = ledgerOf(envS, lkey('存量斷網'))
        assert.deepEqual([ledS?.supportTries || 0, ledS?.supportItemTries], [0, undefined])
        // 「未判不記已審」:checks 不增;待判不增;狀態不落盤(不隔離)
        assert.deepEqual([(await envS.stores.checks.select()).length, (await envS.stores.holds.select()).length], [checksS, holdsS])
        assert.equal(textOf(stateFileOf(envS, recS.id)), textS)
        assert.equal(rS.report.detail.failed, 0)

        // ── 失撐主張找支持(ES8)──
        const envO = mkEnv(notesOf('o', '失撐斷網'))
        panelSeats(envO)
        await runStage(envO, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        await envO.stores.notes.del('o1')
        tombstone(envO, 'o1')
        // 先一輪讓維護撤出處落盤(失撐專步未開;本質專步之起草亦斷網＝截止),本案之輪才能以「狀態檔逐字不變」判本輪不動
        await runStage(envO, scriptAi({ draft: 'netDown' }), {}, { clock: fixedClock('2026-10-01') })
        envO.settings.extract.standards.orphanCheck.perRun = 1
        const recO = await coreRec(envO)
        const textO = textOf(stateFileOf(envO, recO.id))
        const [holdsO, checksO] = [(await envO.stores.holds.select()).length, (await envO.stores.checks.select()).length]
        const rO = await runStage(envO, scriptAi({ ...DOWN, draft: 'netDown' }), {}, { clock: fixedClock('2026-10-02') })
        // aiCall【歸類】②;mwPass 之 stopWord
        assert.ok(has(rO.log, /^WARN 提煉\[失撐斷網\]：失撐主張找支持因本機網路不通未完成（本次不套用、不計失敗，下輪再做）$/), rO.log.lines.join('\n'))
        // 三原則③:orphanTries、orphanItemTries 不增
        const ledO = ledgerOf(envO, lkey('失撐斷網'))
        assert.deepEqual([ledO?.orphanTries || 0, ledO?.orphanItemTries], [0, undefined])
        // 「未判不記已審」、不轉使用者、不撤回(狀態不落盤)
        assert.deepEqual([(await envO.stores.checks.select()).length, (await envO.stores.holds.select()).length], [checksO, holdsO])
        assert.equal(textOf(stateFileOf(envO, recO.id)), textO)
        assert.equal(rO.report.detail.failed, 0)

        // ── 同義核心核對(ES11;全域鍵 step|synonym)──
        const envY = mkEnv(synNotes(), { extract: { standards: { synonymCheck: { perRun: 5 } } } })
        envY.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' } }
        const downCheck = (p) => (/的同義概念提議員/.test(p) ? { pairs: [] } : 'netDown')
        const rY = await runStage(envY, scriptAi({ draft: draftAll, ck1: downCheck, ck2: 'netDown' }), {}, { clock: fixedClock('2026-10-01') })
        // synonymStep 檔頭:專步層之失敗只對「全部受檢項皆缺票或同一供應者」;斷網為截止(aiCall【歸類】②)——不記同義核對失敗
        assert.ok(!has(rY.log, /同義核心核對失敗/), rY.log.lines.join('\n'))
        // 三原則③:synonymTries 與逐對之 synonymItemTries 不增
        const ledY = ledgerOf(envY, SYNONYM_LEDGER_KEY)
        assert.deepEqual([ledY?.synonymTries || 0, ledY?.synonymItemTries], [0, undefined])
        assert.equal(rY.report.detail.synonymFailStreak, 0)
        // 「未判不記已審」、不轉使用者:ES11 之待判與檢核紀錄皆無
        assert.deepEqual([(await envY.stores.holds.select()).filter((h) => h.std === 'ES11').length, (await envY.stores.checks.select()).length], [0, 0])
        // 不計失敗即不退避:下輪(同日)照排並判成
        const rY2 = await runStage(envY, scriptAi({ ck1: synCk, ck2: synCk }), {}, { clock: fixedClock('2026-10-01') })
        assert.equal(rY2.report.detail.synonymSame, 1, '斷網之後未被退避')
    })

    // ══════════════════════════ ⑥ 並行共寫失敗帳 ══════════════════════════

    it('⑥並行(perRun 2)之兩概念同輪皆失敗 → 失敗帳兩鍵皆在、tries 各＋1(行程內單一共享物件,不互相覆蓋);再一輪各再＋1', async function () {
        const env = mkEnv([...notesOf('a', '並行甲'), ...notesOf('b', '並行乙')], { extract: { perRun: 2 } })
        const keys = [lkey('並行甲'), lkey('並行乙')]
        const r1 = await runStage(env, scriptAi({ draft: 'fail' }), {}, { clock: fixedClock('2026-10-01') })
        assert.equal(r1.report.detail.concepts, 2, '前提:同輪並行兩概念')
        // extractLedger 檔頭【單一共享物件】「並行概念共寫同一物件」;extractStage 檔頭【失敗帳】「AI 失敗…→ tries＋1」(讀改寫會失落更新)
        assert.deepEqual(keys.map((k) => ledgerOf(env, k)?.tries), [1, 1])
        assert.ok(keys.every((k) => ledgerOf(env, k).lastTriedAt === '2026-10-01T00:00:00+08:00' && /起草全敗/.test(ledgerOf(env, k).lastError)), JSON.stringify(ledgerOf(env)))
        await runStage(env, scriptAi({ draft: 'fail' }), {}, { clock: fixedClock('2026-10-02') })
        assert.deepEqual(keys.map((k) => ledgerOf(env, k)?.tries), [2, 2])
    })

    // ══════════════════════════ ⑦ 還原撤回之中斷 ══════════════════════════

    it('⑦reviveClaims 落盤之 CAS 衝突(裁示紀錄寫入時狀態檔被他處改動):拋錯、未落盤(主張仍為撤回、md 不動)、裁示紀錄已寫、待判不動;重跑即續作', async function () {
        const { env, rec, q2, file, key, deps, opt } = await seedRetracted('還原衝突')
        const before = JSON.parse(textOf(file))
        const mdBefore = textOf(rec.file)
        // 注入:檢核紀錄之集合於寫入後把狀態檔之 rev 推進(模擬維運工具於此刻改動同一檔)
        const checksCas = {
            ...env.stores.checks,
            replace: async (r) => {
                await env.stores.checks.replace(r)
                const s = JSON.parse(textOf(file))
                fs.writeFileSync(file, JSON.stringify({ ...s, rev: s.rev + 5 }), 'utf8')
            },
        }
        // JSDoc @throws「寫入違反不變式或 CAS 衝突時拋出(未落盤;…)」
        await assert.rejects(() => reviveClaims({ ...deps, stores: { ...env.stores, checks: checksCas } }, opt), /核心狀態已被他處改動/)
        // 「未落盤」:磁碟為他處之內容(rev＋5)、主張仍為撤回、版本不變;md 不動
        const now = JSON.parse(textOf(file))
        assert.deepEqual([now.rev, now.version, now.claims.find((c) => c.id === q2.id).status], [before.rev + 5, before.version, 'retracted'])
        assert.equal(textOf(rec.file), mdBefore)
        // 「裁示紀錄已寫」(③序:先寫裁示紀錄 → 落盤 → 結案)
        const chk = await env.stores.checks.get(key)
        assert.deepEqual([chk.results.ES9.status, chk.results.ES9.seats], ['pass', 'user'])
        // 「待判不動」
        assert.equal((await env.stores.holds.get(`${key}:ES9`)).status, 'open')
        // 「重跑即續作」
        const again = await reviveClaims(deps, opt)
        assert.deepEqual([again.ok, again.revived, again.holdsResolved, again.errors], [true, [q2.id], [`${key}:ES9`], []])
        assert.equal(readState(env, rec.id).claims.find((c) => c.id === q2.id).status, 'active')
    })

    it('⑦reviveClaims 落盤成功後結案待判失敗(半套;待判之集合寫入拋錯):主張已還原落盤、待判仍開;重跑 → resumed(只結案待判、不再落盤)', async function () {
        const { env, rec, q2, key, deps, opt } = await seedRetracted('還原半套')
        let armed = true
        // 注入:待判之集合於第一次結案時拋錯(只拋一次)
        const holdsFlaky = {
            ...env.stores.holds,
            replace: async (r) => {
                if (armed && r.status === 'resolved') {
                    armed = false
                    throw new Error('注入：待判結案寫入失敗')
                }
                return env.stores.holds.replace(r)
            },
        }
        await assert.rejects(() => reviveClaims({ ...deps, stores: { ...env.stores, holds: holdsFlaky } }, opt), /注入：待判結案寫入失敗/)
        // ③序「→ 經核心之程式寫入器落盤 → 結案其主張物件之未結待判」:落盤已完成(主張 active、沿革 revive)、結案未完成
        const s1 = readState(env, rec.id)
        const c1 = s1.claims.find((c) => c.id === q2.id)
        assert.deepEqual([c1.status, c1.history.at(-1).op], ['active', 'revive'])
        assert.equal((await env.stores.holds.get(`${key}:ES9`)).status, 'open')
        // 「可續作:主張已 active 而檢核紀錄之席位為 user(前次於落盤後、結案前中斷)者跳過寫入、只結案待判」
        const re = await reviveClaims(deps, opt)
        assert.deepEqual([re.ok, re.revived, re.resumed, re.holdsResolved, re.errors], [true, [], [q2.id], [`${key}:ES9`], []])
        assert.equal(readState(env, rec.id).rev, s1.rev, '續作不落盤')
        assert.equal((await env.stores.holds.get(`${key}:ES9`)).status, 'resolved')
    })

    // ══════════════════════════ ⑧ 手改另存 ══════════════════════════

    it('⑧writeProjections(前次中斷之投影補做;dirty 標記)遇手改之 md:覆寫前另存 manual 副本(.txt、含手改內容)並 WARN「提煉手改另存」(須見),不呼叫 AI', async function () {
        const concept = '手改補做'
        const env = mkEnv(notesOf('m', concept))
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const rec = await coreRec(env)
        fs.appendFileSync(rec.file, '\n手改之一行（補做）\n', 'utf8')
        fs.mkdirSync(`${env.dirs.state}/core/dirty`, { recursive: true })
        fs.writeFileSync(`${env.dirs.state}/core/dirty/${rec.id}`, 'x', 'utf8')
        const ai = scriptAi({})
        const { report, log } = await runStage(env, ai, {}, { clock: fixedClock('2026-10-02') })
        // coreStore【手改偵測】「覆寫前比對上次渲染之雜湊,不符即先另存一份再覆寫,不讓手改內容無聲消失」
        const line = log.lines.find((l) => /提煉手改另存/.test(l))
        assert.match(line || '', new RegExp(`^WARN 提煉手改另存\\[${concept}\\]：核心 md 與上次渲染不符，覆寫前已另存 .+\\.manual\\.txt$`), log.lines.join('\n'))
        assert.ok(MUST.test(line))
        // guardManualEdit「先另存副本(於 manualDir,副檔名 .txt,不讓筆記工具當成另一篇核心)」:副本含手改內容
        const manualDir = `${env.dirs.state}/core/manual`
        const saved = fs.readdirSync(manualDir)
        assert.deepEqual(saved, [`${rec.id}.20261002.manual.txt`])
        assert.match(textOf(`${manualDir}/${saved[0]}`), /手改之一行（補做）/)
        // writeProjections「以狀態重建投影」:md 以狀態覆寫(手改行不在投影中)
        assert.doesNotMatch(textOf(rec.file), /手改之一行/)
        // redoDirtyProjections「標記所指之核心可讀者以狀態重建投影並計一次修復」;無 AI
        assert.deepEqual([report.detail.repaired, ai.calls.length], [1, 0])
    })

    it('⑧persistMechanical(維護之投影更新;筆記標題改了)遇手改之 md:覆寫前另存 manual 副本並 WARN「提煉手改另存」,投影照常更新', async function () {
        const concept = '手改維護'
        const env = mkEnv(notesOf('n', concept))
        await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
        const rec = await coreRec(env)
        fs.appendFileSync(rec.file, '\n手改之一行（維護）\n', 'utf8')
        await env.stores.notes.patch('n1', { title: 'n1 新標題' })
        const ai = scriptAi({})
        const { report, log } = await runStage(env, ai, {}, { clock: fixedClock('2026-10-02') })
        // persistMechanical「md(手改偵測:比對舊渲染雜湊與本次者)」;coreStore【手改偵測】「不符即先另存一份再覆寫」
        assert.ok(has(log, new RegExp(`^WARN 提煉手改另存\\[${concept}\\]：核心 md 與上次渲染不符，覆寫前已另存 .+\\.manual\\.txt$`)), log.lines.join('\n'))
        const manualDir = `${env.dirs.state}/core/manual`
        const saved = fs.readdirSync(manualDir)
        assert.equal(saved.length, 1)
        assert.match(textOf(`${manualDir}/${saved[0]}`), /手改之一行（維護）/)
        // EXT-18「投影更新:以現值(標題…)重算證據並渲染,渲染雜湊不同…→ 寫入」:投影已更新(新標題入 md、手改行不在)
        const md = textOf(rec.file)
        assert.match(md, /n1 新標題/)
        assert.doesNotMatch(md, /手改之一行/)
        assert.deepEqual([report.detail.projected, ai.calls.length], [1, 0])
    })

    // ══════════════════════════ ⑨ 步 × 到點 ══════════════════════════

    it('⑨步 × 到點(表驅動;shouldStop 為真):存量、失撐、僅重審、待審專步——不送 AI、本輪不動(狀態檔逐字不變)、不計失敗(各自之失敗帳欄位不增、stat.failed 0、記截止),WARN 寫「因時間預算截止未完成」', async function () {
        /** 步名 → 概念、pass 名(MODE_WORD)、失敗帳欄位、前置(使本輪排得到該步) */
        const STEPS = [
            {
                step: '存量', concept: '存量到點', word: '出處支持存量覆核', field: 'supportTries',
                setup: async (env) => {
                    await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
                    env.settings.extract.standards.supportStock.perRun = 10
                },
            },
            {
                step: '失撐', concept: '失撐到點', word: '失撐主張找支持', field: 'orphanTries',
                setup: async (env, ids) => {
                    await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
                    await env.stores.notes.del(ids[0])
                    tombstone(env, ids[0])
                    // 先一輪讓維護撤出處落盤(失撐專步未開;本質專步到點)
                    await runStage(env, scriptAi({}), { shouldStop: STOP }, { clock: fixedClock('2026-10-01') })
                    env.settings.extract.standards.orphanCheck.perRun = 1
                },
            },
            {
                step: '僅重審', concept: '重審到點', word: '重審', field: 'recheckTries',
                setup: async (env, ids) => {
                    await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
                    writeNote(env.dirs, { id: ids[0] }, `${ids[0]} 之知識(已修訂)`)
                },
            },
            {
                step: '待審', concept: '待審到點', word: '待審裁決', field: 'tries', n: 6, perRun: 1,
                setup: async (env) => {
                    await runStage(env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
                    await runStage(env, scriptAi({ draft: draftSupersede, accept: 'fail' }), {}, { clock: fixedClock('2026-10-01') })
                },
            },
        ]
        for (const c of STEPS) {
            const notes = notesOf(`k${STEPS.indexOf(c)}`, c.concept, c.n || 3)
            const env = mkEnv(notes, c.perRun ? { extract: { perRun: c.perRun } } : {})
            panelSeats(env)
            await c.setup(env, notes.map((x) => x.id))
            const rec = await coreRec(env)
            const file = stateFileOf(env, rec.id)
            const before = textOf(file)
            if (c.step === '待審') assert.equal(JSON.parse(before).pendingReview.length, 1, '前提:有待審')
            const ai = scriptAi({})
            const { report, log } = await runStage(env, ai, { shouldStop: STOP }, { clock: fixedClock('2026-10-02') })
            // extractStage【時間預算】「兩棒之間問 shouldStop;截止時本 pass 不套用、不計失敗,下輪再做」;aiCall 步驟①「已到點 → 不送」
            assert.ok(has(log, new RegExp(`^WARN 提煉\\[${c.concept}\\]：${c.word}因時間預算截止未完成（本次不套用、不計失敗，下輪再做）$`)), `${c.step}:\n${log.lines.join('\n')}`)
            assert.equal(ai.calls.length, 0, `${c.step}:到點不送`)
            // 「不套用」:本輪不動
            assert.equal(textOf(file), before, `${c.step}:狀態檔逐字不變`)
            // NO_FAIL_HALTS「截止…不計失敗」;截止計入 stopped
            assert.ok(report.detail.failed === 0 && report.detail.stopped >= 1, `${c.step}:${JSON.stringify([report.detail.failed, report.detail.stopped])}`)
            const led = ledgerOf(env, lkey(c.concept)) || {}
            // mwPass「僅重審、本質、判定小組專步之失敗另立欄位…不動 tries」且截止不計;待審(非 MODES)「時間預算截止只記 lastTriedAt」
            assert.equal(led[c.field] || 0, 0, `${c.step}:${c.field} 不增`)
            if (c.field === 'tries') assert.equal(led.lastTriedAt, '2026-10-02T00:00:00+08:00', '待審:截止只記 lastTriedAt')
        }
    })

    // ══════════════════════════ ⑩ 失敗帳寫入失敗 ══════════════════════════

    it('⑩失敗帳寫入失敗(帳檔之位置於本輪中途被目錄占用):逐核心收尾與同義專步之寫帳皆告警「提煉：失敗帳寫入失敗」(須見)、本輪不中斷(兩核心照常落盤、report 照回);位置恢復後下輪照常寫帳', async function () {
        const env = mkEnv(synNotes(), { extract: { standards: { synonymCheck: { perRun: 5 } } } })
        env.settings.extract.standards.ai = { first: { use: 'ck1' }, second: { use: 'ck2' } }
        const ledgerFile = `${env.dirs.state}/${ATTEMPTS_FILE}`
        // 注入:第一次起草時把帳檔之位置建成目錄(開工時之讀帳已過;開工前即占用者讀帳即拋,非本案)
        const blockLedger = (p) => {
            if (!fs.existsSync(ledgerFile)) fs.mkdirSync(ledgerFile)
            return draftAll(p)
        }
        const { report, log } = await runStage(env, scriptAi({ draft: blockLedger, ck1: synCk, ck2: 'fail' }), {}, { clock: fixedClock('2026-10-01') })
        // extractSteps finish()「逐核心收尾…落失敗帳」以 try/catch 告警;同義專步之寫帳同(兩核心各一、同義專步一)
        const lines = log.lines.filter((l) => /提煉：失敗帳寫入失敗（/.test(l))
        assert.equal(lines.length, 3, log.lines.join('\n'))
        // logContract EXTRACT_LOG_MUST_SEE「帳檔寫入失敗(失敗帳、待審丟棄帳;寫入層壞了)」:須見
        assert.ok(lines.every((l) => /^(WARN|ERROR) 提煉：失敗帳寫入失敗（/.test(l) && MUST.test(l)), lines.join('\n'))
        // 寫帳失敗不中斷本輪:兩核心照常落盤
        assert.deepEqual([report.detail.updated, (await env.stores.cores.select()).length], [2, 2])
        assert.ok(fs.statSync(ledgerFile).isDirectory(), '前提:位置仍被占用(注入有效)')
        fs.rmSync(ledgerFile, { recursive: true, force: true })
        const r2 = await runStage(env, scriptAi({ ck1: synCk, ck2: synCk }), {}, { clock: fixedClock('2026-10-02') })
        assert.ok(!has(r2.log, /失敗帳寫入失敗/), r2.log.lines.join('\n'))
        assert.ok(fs.statSync(ledgerFile).isFile(), '位置恢復後照常寫帳')
    })
})
