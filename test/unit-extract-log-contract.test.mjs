// unit-extract-log-contract.test.mjs — 提煉之日誌與報告契約(logContract):外部巡檢判讀提煉段之字樣、正則與 run.json 之 report 鍵,
//   須對得上本套件實際產出之日誌與 report
// 規則(出自 logContract 檔頭):
//   ①原始碼之 WARN／ERROR 發出點逐一歸類(已知、須見、刻意不列),無未歸類者、歸類表無過時之列:發出點以去註解之程式碼掃描(訊息之字面),
//     其字樣以字面渲染(運算式代以樣本值;字樣在運算式內者——逐棒日誌之前綴、各 pass 之名與截止之說法、CAS 之原因——取自原始碼之常數)後判:
//     已知＝命中 EXTRACT_LOG_KNOWN 且不命中 EXTRACT_LOG_MUST_SEE;須見＝命中 EXTRACT_LOG_MUST_SEE;刻意不列＝兩者皆不命中(巡檢即當未知警告呈現)。
//     各 pass 之全鏈失敗字樣恰為原始碼之 pass 名之全集(新增 pass 而未列即失敗)
//   ②以真實執行(替身 AI;提煉段與總組裝)之日誌驗字樣:代表行逐字、巡檢之判準(列出＝非已知或為必看);EXTRACT_LOG_PARSE 之正則解析真日誌檔
//     之段落完成行,所得數字＝該輪 report;逐棒成交之正則命中每次成交;衝突交關聯段核對之正則對原始碼之字樣
//   ③EXTRACT_REPORT_KEYS:階段名、子階段鍵、統計鍵與實際 report 一致;detail 之鍵集＝實際 report(一般、停用、剩餘時間不足)之聯集——
//     實際 report 不得有未列之鍵,列了之鍵亦須在某一實際 report 出現
// 【發出點之字面讀取器(readLiteral／skipExpr／partsOf／renderOf)不是 sourceScan 之副本】抓取套件之 lexSource 只回「依完成之序」之字串表與骨架:
//   含運算式之樣板在骨架中不留序號、其內層字串先於外層入表(P6 以 tmp 探測證之)——無從由「.warn( 之位置」取回該處之首參數字面與其洞之位置;
//   本檔要的正是「某位置起之一個字面＋洞以樣本值代入」,故留此四件(只供本檔;以 lexSource 之 code 為輸入,註解已去)。
// 執行:自套件根 node <mocha> test/unit-extract-log-contract.test.mjs(暫存 test/_tmp/extract-log-contract-<pid>,測完即刪;真 LMDB、AI 為替身)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { acquireLock, stdReport, CORE_LOG_KNOWN, CORE_LOG_MUST_SEE } from '../src/core/capturePackage.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { EXTRACT_LOG_KNOWN, EXTRACT_LOG_MUST_SEE, EXTRACT_LOG_PARSE, EXTRACT_REPORT_KEYS, extractStatInit } from '../src/logContract.mjs'
import { REJECT_BY_KEYS } from '../src/core/rejectKinds.mjs'
import { createExtractObject, EXTRACT_STAGE_KEYS } from '../src/extractObject.mjs'
import { resolveExtractSettings, extractWarningsOf } from '../src/core/extractSettings.mjs'
import { lexSource, memStore, sourceFilesOf } from './tools/captureForTest.mjs'
import { recLog, mkEnvIn, runStage, scriptAi, draftAll, onlyFirst, fixedClock, addNotes } from './tools/extractKit.mjs'
import { PKG_ROOT, tmpRoot, removeRoots, resetConceptFold, logsOf, fileLogFactory, landNote, buildTestExtractor, seedNotes, subReport } from './tools/extractTestKit.mjs'

const KNOWN = new RegExp(EXTRACT_LOG_KNOWN.join('|'))
const MUST_SEE = new RegExp(EXTRACT_LOG_MUST_SEE.join('|'))
/** 巡檢之判準:列出＝非已知或為必看 */
const visible = (l) => !KNOWN.test(l) || MUST_SEE.test(l)
/** 一行之歸類 */
const clsOf = (l) => (MUST_SEE.test(l) ? 'must' : (KNOWN.test(l) ? 'known' : 'unlisted'))
const PANEL = { first: { use: 'f1' }, second: { use: 'f2' } }

// ═══════════════════════ 原始碼之發出點 ═══════════════════════

/** 套件 src/ 下之 .mjs(抓取套件之共用走訪 sourceFilesOf;略 node_modules;相對 src/) */
const libFiles = () => sourceFilesOf(path.join(PKG_ROOT, 'src'))

/**
 * 自 s[i](字面之起始引號)讀出一個字串或樣板字面之原文;樣板之運算式內之字串與巢狀樣板一併跳過
 *
 * @param {String} s 輸入原始碼(去註解)
 * @param {Integer} i 輸入起始索引(指向 ` ' ")
 * @returns {Object|null} 回傳 { raw:字面之原文(含引號), end:結束後之索引 },非字面回 null
 */
function readLiteral(s, i) {
    const q = s[i]
    if (q === '\'' || q === '"') {
        let j = i + 1
        while (j < s.length && s[j] !== q) j += s[j] === '\\' ? 2 : 1
        return { raw: s.slice(i, j + 1), end: j + 1 }
    }
    if (q !== '`') return null
    let j = i + 1
    while (j < s.length) {
        const c = s[j]
        if (c === '\\') {
            j += 2
            continue
        }
        if (c === '`') return { raw: s.slice(i, j + 1), end: j + 1 }
        if (c === '$' && s[j + 1] === '{') {
            j = skipExpr(s, j + 2)
            continue
        }
        j++
    }
    return null
}

/**
 * 跳過樣板之一個運算式(自 ${ 之後至對應之 })
 *
 * @param {String} s 輸入原始碼
 * @param {Integer} i 輸入運算式之起始索引
 * @returns {Integer} 回傳 } 之後之索引
 */
function skipExpr(s, i) {
    let depth = 0
    let j = i
    while (j < s.length) {
        const c = s[j]
        if (c === '`' || c === '\'' || c === '"') {
            j = readLiteral(s, j).end
            continue
        }
        if (c === '{') depth++
        if (c === '}') {
            if (depth === 0) return j + 1
            depth--
        }
        j++
    }
    return j
}

/**
 * 字面之頂層片段(樣板之運算式以 null 標位);字串字面為單一片段
 *
 * @param {String} raw 輸入字面之原文
 * @returns {Array} 回傳 [文字｜null, …]
 */
function partsOf(raw) {
    if (raw[0] !== '`') return [raw.slice(1, -1)]
    const out = []
    let text = ''
    let j = 1
    while (j < raw.length - 1) {
        if (raw[j] === '\\') {
            text += raw[j + 1]
            j += 2
            continue
        }
        if (raw[j] === '$' && raw[j + 1] === '{') {
            out.push(text, null)
            text = ''
            j = skipExpr(raw, j + 2)
            continue
        }
        text += raw[j]
        j++
    }
    out.push(text)
    return out
}

/** 字面之渲染:運算式代以樣本值(預設「甲」) */
const renderOf = (raw, fill = () => '甲') => {
    let k = 0
    return partsOf(raw).map((p) => (p === null ? fill(k++) : p)).join('')
}

/**
 * 全部 WARN／ERROR 之發出點(去註解之程式碼中 .warn(／.error( 之首參數)
 *
 * @returns {Array} 回傳 [{ file, line, level, raw }]
 */
function sitesOf() {
    const out = []
    for (const f of libFiles()) {
        const code = lexSource(fs.readFileSync(path.join(PKG_ROOT, 'src', f), 'utf8')).code
        for (const m of code.matchAll(/\.(warn|error)\??\.?\(\s*/g)) {
            const lit = readLiteral(code, m.index + m[0].length)
            out.push({ file: f, line: code.slice(0, m.index).split('\n').length, level: m[1], raw: lit ? lit.raw : null })
        }
    }
    return out
}

/** 提煉段之原始碼(編排、逐核心動作鏈、步驟序列):各 pass 之名、截止之說法、逐棒日誌之前綴、CAS 之原因所在 */
const STAGE_FILES = ['stages/extractStage.mjs', 'stages/extractChain.mjs', 'stages/extractSteps.mjs']

/** 原始碼之常數:各 pass 之名(MODE_WORD)、截止之兩種說法(stopWord)、逐棒日誌之前綴(aiCallLogOf 之首參數)、CAS 之原因 */
function sourceConstsOf() {
    const stage = STAGE_FILES.map((f) => lexSource(fs.readFileSync(path.join(PKG_ROOT, 'src', f), 'utf8')).code).join('\n')
    const mode = /const MODE_WORD = \{([^}]*)\}/.exec(stage)
    const stop = /const stopWord = netDown \? '([^']+)' : '([^']+)'/.exec(stage)
    const tags = [...stage.matchAll(/aiCallLogOf\((`[^`]*`|'[^']*')/g)].map((m) => renderOf(m[1]))
    const store = lexSource(fs.readFileSync(path.join(PKG_ROOT, 'src/stores/coreStore.mjs'), 'utf8')).code
    const cas = /new Error\((`核心狀態已被他處改動[^`]*`)\)/.exec(store)
    const written = /casFail\('([^']*被他處改動[^']*)'\)/.exec(stage)
    const rebaseline = /opt\.onError\((`[^`]*`)\)/.exec(lexSource(fs.readFileSync(path.join(PKG_ROOT, 'src/stores/rebaseline.mjs'), 'utf8')).code)
    assert.ok(mode && stop && tags.length >= 2 && cas && written && rebaseline, '前提:原始碼之常數皆取得')
    return {
        modeWords: Object.fromEntries([...mode[1].matchAll(/(\w+): '([^']+)'/g)].map((x) => [x[1], x[2]])),
        stopNet: stop[1],
        stopBudget: stop[2],
        tags,
        casText: renderOf(cas[1], () => '1'),
        writtenText: written[1],
        rebaselineText: renderOf(rebaseline[1], () => 'extract-rebaseline.json'),
    }
}

/**
 * 發出點之歸類表:每列 { file, has(字面原文之唯一子字串), n(發出點數), cls(預設渲染之歸類) | samples(由原始碼常數產生之 [字樣, 歸類]), why(刻意不列之理由) }
 *
 * @param {Object} c 輸入 sourceConstsOf 之產物
 * @returns {Array} 回傳歸類表
 */
const siteTable = (c) => [
    { file: 'stages/synonymStep.mjs', has: '提煉同義核心核對：提議席失敗', n: 1, cls: 'known' },
    { file: 'standards/synonymCheck.mjs', has: '提煉同義核心核對：提議紀錄檔損壞', n: 1, cls: 'known' },
    // 統計鍵不在初值表(count 之鍵與初值表、契約之鍵不同步——程式之錯;須見)
    { file: 'stages/extractSteps.mjs', has: '提煉統計：未知之統計鍵', n: 1, cls: 'must' },
    // JSON 帳損壞(stores/extractFiles 之唯一字樣 extractLedgerCorruptTextOf,經樣板轉交;須見)
    { file: 'stores/extractFiles.mjs', has: '${text}', n: 1, samples: [['提煉帳檔損壞：extract-attempts.json（Unexpected token），已隔離為 extract-attempts.json.corrupt-1；以空帳續行', 'must']] },
    // 逐棒日誌:前綴在運算式內(aiCallLogOf 之首參數:各核心與同義專步)
    { file: 'stages/extractChain.mjs', has: '${tag} ${stage} ${x.id}：', n: 1, samples: c.tags.map((t) => [`${t} 起草1 d1：exec（替身失敗）`, 'known']) },
    { file: 'stages/extractChain.mjs', has: '${tag} ${stage} 全鏈失敗：', n: 1, samples: c.tags.map((t) => [`${t} 整合 全鏈失敗：替身失敗`, 'known']) },
    // 各 pass 之結果:pass 名與截止之說法在運算式內(MODE_WORD、stopWord)
    {
        file: 'stages/extractChain.mjs', has: '${MODE_WORD[mode]}', n: 1,
        samples: Object.values(c.modeWords).flatMap((w) => [[`提煉[甲]：${w}失敗（替身失敗）`, 'known'], [`提煉[甲]：${w}失敗（替身失敗）——專步連續失敗 1 次，退避 1 天後再試`, 'known'], [`提煉[甲]：${w}${c.stopBudget}`, 'known'], [`提煉[甲]：${w}${c.stopNet}`, 'must']]),
    },
    { file: 'stages/extractChain.mjs', has: '提煉降級[', n: 2, cls: 'known' },
    // 判定小組專步之部分中止(已判之頁照處置、未判留待下輪;時間預算之截止為已知)
    { file: 'stages/extractChain.mjs', has: '專步因時間預算截止未完成', n: 1, cls: 'known' },
    // 重練意圖(regenCore 先記;管線開工消化):已消化為設計機制、未完成須見
    { file: 'stages/extractMaintain.mjs', has: '提煉重練意圖：已消化', n: 1, cls: 'known' },
    { file: 'stages/extractMaintain.mjs', has: '提煉重練意圖未完成：', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '提煉投影補正[', n: 2, cls: 'known' },
    { file: 'stages/extractMaintain.mjs', has: '提煉投影補正[', n: 1, cls: 'known' },
    { file: 'stages/extractChain.mjs', has: '本質專步未補成本質', n: 1, cls: 'known' },
    { file: 'stages/extractSteps.mjs', has: '提煉：同義核心核對失敗（', n: 1, cls: 'known' },
    { file: 'stages/extractChain.mjs', has: '提煉手改另存[', n: 1, cls: 'must' },
    { file: 'stores/coreProjection.mjs', has: '提煉手改另存[', n: 2, cls: 'must' },
    { file: 'stores/coreProjection.mjs', has: '提煉分身合併[', n: 1, cls: 'must' },
    // 維護失敗:逐核心、內容鍵快取、推定判定快取、關聯影響收尾、關聯影響留待(逐核心隔離)
    { file: 'stages/extractMaintain.mjs', has: '提煉維護失敗[', n: 4, cls: 'must' },
    { file: 'stores/contentCache.mjs', has: '提煉維護失敗[', n: 1, cls: 'must' },
    { file: 'stages/extractMaintain.mjs', has: '提煉出處懸空：', n: 1, cls: 'must' },
    { file: 'stages/extractMaintain.mjs', has: '提煉內容變更守門：', n: 1, cls: 'must' },
    // 狀態還原(選中之載入與維護段各一;同字樣)、狀態檔熔斷(維護段)、壞檔無上一版之隔離(維護段)、修復失敗(選中之載入)
    { file: 'stages/extractChain.mjs', has: '提煉狀態還原[', n: 1, cls: 'must' },
    { file: 'stages/extractMaintain.mjs', has: '提煉狀態還原[', n: 1, cls: 'must' },
    { file: 'stages/extractMaintain.mjs', has: '提煉狀態檔熔斷：', n: 1, cls: 'must' },
    { file: 'stages/extractMaintain.mjs', has: '：狀態檔毀損且無上一版（', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '：狀態檔修復失敗（', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '：${why}；本概念跳過、不覆寫。', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '：${tag}（${oneline(r.error, 160)}）；本概念跳過', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '投影補正違反不變式（未落盤）', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '不變式違反（pass 後落帳，未落盤）', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '不變式違反（md 讀不到逾限之出隊，未落盤）', n: 1, cls: 'must' },
    // 先記後寫之補償失敗(落盤失敗而登錄撤銷未完成;維護段清掃兜底)
    { file: 'standards/holdSettle.mjs', has: '落盤失敗之登錄撤銷未完成', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '待審丟棄帳寫入失敗', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '待審逾上限', n: 1, cls: 'must' },
    { file: 'stages/extractChain.mjs', has: '提煉終審自相矛盾[', n: 1, cls: 'must' },
    // 產出鏈(core/producedChain)組不出(stamp、套件版或時刻不合共用件之格式;程式之錯,該版 changelog 缺 produced)
    { file: 'stages/extractChain.mjs', has: '提煉產出鏈組不出[', n: 1, cls: 'must' },
    { file: 'stages/extractSteps.mjs', has: '提煉異常[', n: 1, cls: 'must' },
    { file: 'stages/extractSteps.mjs', has: '提煉：失敗帳寫入失敗', n: 2, cls: 'must' },
    // 落盤之 CAS:原因在運算式內(狀態檔被他處改動 → 須見;其餘寫檔失敗——權限、磁碟——不列,即當未知警告呈現)
    { file: 'stages/extractChain.mjs', has: '：${oneline(why, 240)}', n: 1, samples: [[`提煉[甲]：${c.casText}`, 'must'], [`提煉[甲]：${c.writtenText}`, 'must'], ['提煉[甲]：EACCES: permission denied, open \'x.state.json\'', 'unlisted']] },
    // 刻意不列(巡檢即當未知警告呈現):設定問題之提示
    { file: 'stages/extractMaintain.mjs', has: '提煉：${m}', n: 1, samples: [[`提煉：${c.rebaselineText}`, 'unlisted']], why: '重設基準之名單檔不可讀——安裝方之名單檔壞了,須人處理' },
    { file: 'stages/extractStage.mjs', has: '篇筆記找不到預設章節', n: 1, cls: 'unlisted', why: '自訂筆記版型而未對應章名——設定問題,須人處理' },
    { file: 'bench/cli.mjs', has: '提煉 AI 能力評分失敗', n: 1, cls: 'unlisted', why: '評分命令列之 stderr,非管線日誌(不經巡檢)' },
]

describe('unit-extract-log-contract', function() {

    this.timeout(180_000)

    let root = ''
    let mkEnv = null
    /** 各情境之實際產出:{ 名: { lines:Array, reps:Array(提煉段之 report) } } */
    const runs = {}
    /** 跑一次提煉段並記下(lines 累積;report 依序) */
    const stage = async (name, env, ai, opt = {}, o = {}) => {
        const r = await runStage(env, ai, opt, o)
        runs[name] = { lines: [...(runs[name]?.lines || []), ...r.log.lines], reps: [...(runs[name]?.reps || []), r.report] }
        return r
    }
    const two = (concept) => [{ id: `${concept}1`, concepts: [concept] }, { id: `${concept}2`, concepts: [concept] }]

    before(async () => {
        root = tmpRoot('extract-log-contract')
        mkEnv = mkEnvIn(`${root}/stage`)
        // ── 已知字樣 ──
        // 逐棒失敗與全鏈失敗、pass 之全鏈失敗(起草三席皆敗)
        await stage('aiFail', mkEnv(two('失敗')), scriptAi({ draft: 'fail' }))
        // 截止(上游預算耗盡且剩餘不足一次嘗試;不計失敗)
        await stage('stopped', mkEnv(two('截止'), { extract: { minRemainingMs: 0 } }), scriptAi({ draft: 'budget' }), {}, { remainingMs: 10_000 })
        // 降級(整合失敗 → 程式聯集)
        await stage('degrade', mkEnv(two('降級')), scriptAi({ draft: draftAll, integrate: 'fail' }))
        // 逾限筆記之待判登錄(ES15):兩輪(holds 為必開之集合)
        {
            const env = mkEnv(['u1', 'u2', 'u3'].map((id) => ({ id, concepts: ['待判乙'] })))
            await stage('exhausted', env, scriptAi({ draft: onlyFirst }), {}, { clock: fixedClock('2026-10-01') })
            await stage('exhausted', env, scriptAi({ draft: { ops: [], skipped: [] } }), {}, { clock: fixedClock('2026-10-02') })
        }
        // 同義專步:兩個主核心而提議席失敗 → 只用名稱相近之候選(同一輪:首版落盤後即排同義專步;替身無 f1／f2 → 提議席失敗)
        await stage('synProposeFail', mkEnv([...two('同義甲'), ...two('同義乙')], { extract: { standards: { ai: PANEL, synonymCheck: { perRun: 1 } } } }), scriptAi({ draft: draftAll }))
        // ── 須見字樣 ──
        // 手改另存(核心 md 被手改後再落盤)
        {
            const env = mkEnv(two('手改'))
            await stage('manual', env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-01') })
            const [rec] = await env.stores.cores.select()
            const file = `${env.dirs.core}/${rec.id}.md`
            fs.appendFileSync(file, '\n手改之一行\n', 'utf8')
            await addNotes(env, ['手改3'], ['手改'])
            await stage('manual', env, scriptAi({ draft: draftAll }), {}, { clock: fixedClock('2026-10-02') })
        }
        // 本機網路不通(調度層標 netDown;行首為已知之「提煉[…]：<pass>」形)
        {
            const ai = scriptAi({ draft: 'netDown', integrate: 'netDown', audit: 'netDown', revise: 'netDown', accept: 'netDown' })
            await stage('netDown', mkEnv(two('斷網')), ai)
        }
        // ── 刻意不列 ──
        // 筆記找不到預設章節(自訂筆記版型)
        {
            const env = mkEnv(two('無章'))
            for (const n of await env.stores.notes.select()) writeMd(n.file, { title: n.title }, `# ${n.title}\n\n一段沒有章名之內文，${n.id} 之知識。`)
            await stage('unsectioned', env, scriptAi({ draft: draftAll }))
        }
        // ── report 之條件路徑 ──
        await stage('disabled', mkEnv(two('停用')), scriptAi({}), { parallel: 0 })
        await stage('noTime', mkEnv(two('時間')), scriptAi({}), {}, { remainingMs: 1000 })
        // ── 總組裝之情境(管線秩序:鎖、時間預算、啟動期檢核) ──
        {
            const lg = logsOf()
            const { flow } = buildTestExtractor(`${root}/locked`, { logFactory: lg.factory, lock: undefined })
            const held = acquireLock(flow.info().lockFile, { staleMs: 3_600_000 })
            assert.equal(held.ok, true, '前提:測試先取得執行鎖')
            const rep = await flow.run()
            held.release()
            assert.equal(rep.lockSkipped, true)
            runs.locked = { lines: lg.lines(), reps: [] }
        }
        // 階段逾時間預算:提煉為多工作管線之末段,前段耗盡整輪預算 → 管線不再開工提煉段(管線之核心件發出)
        {
            const log = recLog()
            const pipe = W.definePipeline({ name: '知識提煉', log, deadlineMs: 20, deps: {}, stages: [{ name: '前段', run: async () => {
                await new Promise((r) => setTimeout(r, 60))
                return stdReport()
            } }, createExtractObject()] })
            await W.runPipeline(pipe, { log })
            runs.deadline = { lines: log.lines, reps: [] }
        }
    })

    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    /** 全部情境之 WARN／ERROR 行 */
    const alertLines = () => Object.values(runs).flatMap((r) => r.lines || []).filter((l) => /^(WARN|ERROR) /.test(l))

    // ══════════════════════════ ① 原始碼之發出點 ══════════════════════════
    describe('①原始碼之 WARN／ERROR 發出點之歸類', function() {

        it('字樣之全集(外部巡檢之判讀對象;改動須同步巡檢):皆為可編譯之正則、須見字樣為純文字(提煉異常之「[」除外,已跳脫);皆凍結;兩類不重疊', () => {
            for (const p of [...EXTRACT_LOG_KNOWN, ...EXTRACT_LOG_MUST_SEE]) assert.doesNotThrow(() => new RegExp(p), p)
            for (const p of EXTRACT_LOG_MUST_SEE.filter((x) => x !== '提煉異常\\[')) assert.ok(!/[\\^$.*+?()[\]{}|]/.test(p), `須見字樣不含正則語法:${p}`)
            for (const re of Object.values(EXTRACT_LOG_PARSE)) assert.ok(re instanceof RegExp)
            assert.ok([EXTRACT_LOG_KNOWN, EXTRACT_LOG_MUST_SEE, EXTRACT_LOG_PARSE, EXTRACT_REPORT_KEYS, EXTRACT_REPORT_KEYS.detail, EXTRACT_REPORT_KEYS.detail.extract].every(Object.isFrozen))
            assert.deepEqual(EXTRACT_LOG_KNOWN.filter((p) => EXTRACT_LOG_MUST_SEE.includes(p)), [])
            assert.equal(new Set(EXTRACT_LOG_KNOWN).size, EXTRACT_LOG_KNOWN.length)
            assert.equal(new Set(EXTRACT_LOG_MUST_SEE).size, EXTRACT_LOG_MUST_SEE.length)
            // 以聯集組成:提煉專屬者在前、抓取套件核心件之 CORE_LOG_* 殿後(不另抄一份)
            assert.deepEqual(EXTRACT_LOG_KNOWN.slice(-CORE_LOG_KNOWN.length), [...CORE_LOG_KNOWN])
            assert.deepEqual(EXTRACT_LOG_MUST_SEE.slice(-CORE_LOG_MUST_SEE.length), [...CORE_LOG_MUST_SEE])
            assert.deepEqual(EXTRACT_LOG_KNOWN.slice(0, -CORE_LOG_KNOWN.length).filter((p) => CORE_LOG_KNOWN.includes(p)), [], '專屬者不重抄核心件之字樣')
        })

        it('掃描器自檢:樣板之運算式內之字串與巢狀樣板跳過;頂層片段與渲染;註解內之 .warn( 不計', () => {
            const raw = readLiteral('`a${x ? `b${y}` : \'c\'}d${z}`', 0).raw
            assert.deepEqual(partsOf(raw), ['a', null, 'd', null, ''])
            assert.equal(renderOf(raw), 'a甲d甲')
            const code = lexSource('// log.warn(`註解`)\nlog.warn(`真的`)\n').code
            assert.deepEqual([...code.matchAll(/\.(warn|error)\??\.?\(\s*/g)].length, 1)
        })

        it('每個發出點之首參數皆為字面(訊息字樣可歸類);每個發出點恰屬歸類表之一列,每列之發出點數與表相符(無未歸類者、無過時之列)', () => {
            const sites = sitesOf()
            assert.ok(sites.length >= 35, `發出點過少:${sites.length}`)
            assert.deepEqual(sites.filter((s) => !s.raw).map((s) => `${s.file}:${s.line}`), [], '首參數非字面之發出點')
            const table = siteTable(sourceConstsOf())
            const owner = sites.map((s) => [s, table.filter((t) => t.file === s.file && s.raw.includes(t.has))])
            assert.deepEqual(owner.filter(([, ts]) => ts.length !== 1).map(([s, ts]) => `${s.file}:${s.line} ${s.raw.slice(0, 60)}（命中 ${ts.length} 列）`), [], '未歸類或歸類不唯一之發出點')
            for (const t of table) {
                const n = owner.filter(([, ts]) => ts[0] === t).length
                assert.equal(n, t.n, `「${t.has}」之發出點數`)
            }
        })

        it('各發出點之字樣之歸類＝表之所定:預設渲染(運算式代以樣本值)或由原始碼常數產生之字樣;刻意不列者附理由', () => {
            const c = sourceConstsOf()
            const sites = sitesOf()
            const bad = []
            for (const t of siteTable(c)) {
                const samples = t.samples || sites.filter((s) => s.file === t.file && s.raw.includes(t.has)).map((s) => [renderOf(s.raw), t.cls])
                for (const [text, want] of samples) if (clsOf(text) !== want) bad.push(`${t.has}:「${text}」歸類 ${clsOf(text)},應為 ${want}`)
                if (samples.some(([, w]) => w === 'unlisted')) assert.ok(typeof t.why === 'string' || t.samples, `${t.has}:刻意不列須附理由`)
            }
            assert.deepEqual(bad, [])
        })

        it('判定小組兩席同家之啟動期警告(摘要套件之字樣;開啟覆核時才發)為須見:行首「啟動期檢核：」為已知仍被看見(終審 §3 D5b)', () => {
            const a = { use: 'x:a' }
            const w = extractWarningsOf(resolveExtractSettings({ extract: { standards: { supportCheck: { enabled: true }, ai: { first: a, second: a } } } }))
            assert.equal(w.length, 1)
            assert.ok(/判定小組永遠無法成立/.test(w[0]), w[0])
            assert.equal(visible(`啟動期檢核：${w[0]}`), true)
            assert.equal(extractWarningsOf(resolveExtractSettings({ extract: { standards: { ai: { first: a, second: a } } } })).length, 0, '未開啟不警告')
        })

        it('各 pass 之全鏈失敗之已知字樣恰為原始碼之 pass 名之全集(「<pass 名>失敗（」;新增 pass 而未列即失敗);截止之兩種說法:時間預算為已知、本機網路不通為須見', () => {
            const c = sourceConstsOf()
            const fail = EXTRACT_LOG_KNOWN.filter((p) => /失敗（$/.test(p) && !/核對失敗（$/.test(p))
            assert.deepEqual(fail.sort(), Object.values(c.modeWords).map((w) => `${w}失敗（`).sort())
            assert.ok(KNOWN.test(c.stopBudget) && !MUST_SEE.test(c.stopBudget))
            assert.ok(MUST_SEE.test(c.stopNet))
            assert.deepEqual(c.tags.map((t) => KNOWN.test(t)), c.tags.map(() => true), '逐棒日誌之前綴皆為已知')
        })
    })

    // ══════════════════════════ ② 真實執行之日誌 ══════════════════════════
    describe('②真實執行之日誌(替身 AI)', function() {

        it('實際日誌之代表行逐字:逐棒失敗、全鏈失敗、pass 失敗、截止、斷網、降級、同義專步之提議席失敗、手改另存、找不到預設章節、略過本輪、階段逾時間預算、啟動期檢核', () => {
            // 斷言某輪之日誌有一行合乎樣式(共用件 has(log, re) 回布林,本件為斷言,故不同名)
            const assertLine = (name, re) => assert.ok(runs[name].lines.some((l) => re.test(l)), `${name}:\n${runs[name].lines.join('\n')}`)
            assertLine('aiFail', /^WARN 提煉事件\[失敗\] 起草1 d1：exec（替身失敗）$/)
            assertLine('aiFail', /^WARN 提煉事件\[失敗\] 起草1 全鏈失敗：d1 失敗（替身）$/)
            assertLine('aiFail', /^WARN 提煉\[失敗\]：提煉失敗（/)
            assertLine('stopped', /^WARN 提煉\[截止\]：提煉因時間預算截止未完成（本次不套用、不計失敗，下輪再做）$/)
            assertLine('netDown', /^WARN 提煉\[斷網\]：提煉因本機網路不通未完成（本次不套用、不計失敗，下輪再做）$/)
            assertLine('degrade', /^WARN 提煉降級\[降級\]：整合失敗（int 失敗（替身））：改用程式聯集$/)
            assertLine('synProposeFail', /^WARN 提煉同義核心核對：提議席失敗（.*），本輪只用名稱相近之候選$/)
            assertLine('manual', /^WARN 提煉手改另存\[手改\]：核心 md 與上次渲染不符，覆寫前已另存 /)
            assertLine('unsectioned', /^WARN 提煉：2 篇筆記找不到預設章節（自訂筆記版型？），摘要退回截斷正文；請以 domains\.extract\.noteDigest 對應自訂章名$/)
            assertLine('locked', /^WARN 管道\[知識提煉\] 略過本輪：/)
            assertLine('deadline', /^WARN 管道\[知識提煉\] 階段\[提煉\] 略過：逾時間預算$/)
            assertLine('locked', /^WARN 啟動期檢核：未給 scheduleLimitMin 亦未給 deadlineMs/)
        })

        it('實際日誌之 WARN／ERROR 行之歸類:各情境之代表行依巡檢之判準——常態(已知)不列;須見(手改另存、斷網)列;刻意不列(找不到預設章節)列', () => {
            const pick = (name, re) => runs[name].lines.find((l) => re.test(l))
            for (const [name, re] of [['aiFail', /^WARN 提煉事件/], ['aiFail', /^WARN 提煉\[失敗\]：提煉失敗/], ['stopped', /因時間預算截止/], ['degrade', /提煉降級/],
                ['synProposeFail', /提議席失敗/], ['locked', /略過本輪/], ['deadline', /逾時間預算/], ['locked', /啟動期檢核/]]) {
                const l = pick(name, re)
                assert.ok(l, `${name}:${runs[name].lines.join('\n')}`)
                assert.equal(visible(l), false, `常態不列:${l}`)
            }
            for (const [name, re] of [['manual', /提煉手改另存/], ['netDown', /本機網路不通/], ['unsectioned', /找不到預設章節/]]) {
                const l = pick(name, re)
                assert.ok(l, name)
                assert.equal(visible(l), true, `須見:${l}`)
            }
        })

        it('全部情境之實際 WARN／ERROR 行皆出自已歸類之發出點(字面之片段依序吻合;運算式處容任意字樣),或為管線核心件與總組裝共用件之字樣(略過本輪、階段略過、啟動期檢核)', () => {
            const esc = (t) => t.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
            const table = siteTable(sourceConstsOf())
            const res = sitesOf().filter((s) => table.some((t) => t.file === s.file && s.raw.includes(t.has))).map((s) => new RegExp(`^${partsOf(s.raw).map((p) => (p === null ? '[\\s\\S]*?' : esc(p))).join('')}$`))
            const outside = [/^管道\[知識提煉\] 略過本輪：/, /^管道\[知識提煉\] 階段\[提煉\] 略過：逾時間預算$/, /^啟動期檢核：/]
            const lines = alertLines().map((l) => l.replace(/^(WARN|ERROR) /, ''))
            assert.ok(lines.length >= 15, `情境之警告行過少:${lines.length}`)
            assert.deepEqual(lines.filter((l) => !res.some((re) => re.test(l)) && !outside.some((re) => re.test(l))), [], '出處不明之警告行')
        })

        it('逐輪數字之正則:真日誌檔(抓取套件之日誌器)之段落完成行解析所得＝report 之 detail／stats(概念、更新之核心、AI 次數);逐棒成交之正則命中每次成交(棒、供應者)', async () => {
            const wd = `${root}/parse`
            let flow = null
            ;({ flow } = buildTestExtractor(wd, { aiAdapter: scriptAi({ draft: draftAll }), logFactory: fileLogFactory(() => flow) }))
            await seedNotes(flow, ['a', 'b'].map((d, i) => landNote(`${wd}/knowledge/notes`, { doc: d, title: `視差筆記${i + 1}`, concepts: ['視差量測'] })))
            const rep = await flow.run()
            const text = fs.readFileSync(rep.summaryFile.replace(/-run\.json$/, '-run.log'), 'utf8')
            const num = (re) => {
                const m = text.match(re)
                return m ? Number(m[1]) : null
            }
            const ex = subReport(rep, '提煉', 'extract')
            assert.deepEqual({ cores: num(EXTRACT_LOG_PARSE.cores), concepts: num(EXTRACT_LOG_PARSE.concepts), aiCalls: num(EXTRACT_LOG_PARSE.aiCalls) }, { cores: ex.detail.updated, concepts: ex.detail.concepts, aiCalls: ex.stats.aiCalls }, text.split('\n').filter((l) => /提煉 完成/.test(l)).join('\n'))
            assert.deepEqual([ex.detail.updated, ex.detail.concepts, ex.stats.aiCalls], [1, 1, 6])
            const deals = text.split('\n').map((l) => l.match(EXTRACT_LOG_PARSE.deal)).filter(Boolean).map((m) => [m[1], m[2]])
            assert.deepEqual(deals, [['起草1', 'stub-d1'], ['起草2', 'stub-d2'], ['起草3', 'stub-d3'], ['整合', 'stub-int'], ['審計', 'stub-aud'], ['終審', 'stub-acc']])
            // 固定格式之附加段不影響解析(AI 次數取句尾)
            const line = '[2026-10-11T01:00:00+08:00] INFO  步驟1 提煉 完成：概念 3、更新 2 則核心、消化 9 篇、重審 1 篇、爭議覆核 2 則（真對立 1、拆解 1、待判 0、重試 0）、降級 1（AI 17 次）（12.3s）'
            assert.deepEqual([EXTRACT_LOG_PARSE.cores, EXTRACT_LOG_PARSE.concepts, EXTRACT_LOG_PARSE.aiCalls].map((re) => Number(line.match(re)[1])), [2, 3, 17])
        })

        it('衝突交關聯段核對之正則對原始碼之字樣(以樣本值渲染):group 1 為條數', () => {
            const code = lexSource(fs.readFileSync(path.join(PKG_ROOT, 'src/standards/holdSettle.mjs'), 'utf8')).code
            const m = /ctx\.log\.info\((`提煉\[\$\{o\.concept\}\]：\$\{ap\.rs4\.length\} 條衝突交關聯段核對[^`]*`)\)/.exec(code)
            assert.ok(m, '前提:原始碼之字樣')
            const text = `INFO ${renderOf(m[1], (k) => ['甲', '2', '理由'][k] ?? '甲')}`
            assert.equal(Number(text.match(EXTRACT_LOG_PARSE.toRelate)?.[1]), 2, text)
        })
    })

    // ══════════════════════════ ③ report 鍵 ══════════════════════════
    describe('③report 之鍵(EXTRACT_REPORT_KEYS)', function() {

        const stageReps = () => Object.values(runs).flatMap((r) => r.reps || [])

        it('階段名即提煉物件之預設名;子階段鍵即 EXTRACT_STAGE_KEYS(同一實體);統計鍵即實際 report 之 stats', async () => {
            assert.equal(EXTRACT_REPORT_KEYS.stage, createExtractObject().name)
            assert.equal(EXTRACT_STAGE_KEYS, EXTRACT_REPORT_KEYS.subStages, '同一實體(終審 D9)')
            const reps = stageReps()
            assert.ok(reps.length >= 10, `情境之 report 過少:${reps.length}`)
            for (const r of reps) assert.deepEqual(Object.keys(r.stats).sort(), [...EXTRACT_REPORT_KEYS.stats].sort())
            const obj = await createExtractObject().run({ deps: mkEnvDeps(mkEnv(two('物件'))), log: recLog(), remainingMs: () => 3_600_000, expired: () => false })
            assert.deepEqual(Object.keys(obj.detail), [...EXTRACT_REPORT_KEYS.subStages])
            assert.deepEqual(Object.keys(obj.stats).sort(), [...EXTRACT_REPORT_KEYS.stats].sort())
        })

        it('detail 之鍵集＝實際 report(一般、停用、剩餘時間不足)之聯集:無未列之鍵、無未出現之鍵;條件鍵各有情境涵蓋', () => {
            const seen = new Set()
            for (const r of stageReps()) for (const k of Object.keys(r.detail || {})) seen.add(k)
            const declared = [...EXTRACT_REPORT_KEYS.detail.extract]
            assert.equal(new Set(declared).size, declared.length, '列表無重複')
            assert.deepEqual([...seen].filter((k) => !declared.includes(k)).sort(), [], '實際 report 有未列之鍵')
            assert.deepEqual(declared.filter((k) => !seen.has(k)), [], '列了而未在實際 report 出現之鍵(情境未涵蓋或鍵已改)')
            assert.equal(runs.disabled.reps[0].detail.disabled, true)
            assert.equal(runs.noTime.reps[0].detail.skippedForBudget, true)
            assert.ok('backlog' in runs.aiFail.reps[0].detail)
        })

        it('統計鍵之來源 ⊆ 契約(agg 之守門):提煉段 count() 之鍵、各 pass 與專步 stats 初值之鍵皆在 detail 之鍵集——不在者於執行時被 agg 以 WARN「提煉統計：未知之統計鍵」拒收(不靜默吞掉)', () => {
            const declared = new Set(EXTRACT_REPORT_KEYS.detail.extract)
            const src = (rel) => fs.readFileSync(path.join(PKG_ROOT, 'src', rel), 'utf8')
            const counted = [...new Set([...['stages/extractStage.mjs', 'stages/extractChain.mjs', 'stages/extractSteps.mjs', 'stages/extractMaintain.mjs', 'standards/holdSettle.mjs', 'stores/coreProjection.mjs'].map(src).join('\n').matchAll(/\bcount\((?:o\.)?msg, '([A-Za-z0-9]+)'/g)].map((m) => m[1]))]
            assert.ok(counted.length >= 40, `count() 之鍵過少:${counted.length}`)
            assert.deepEqual(counted.filter((k) => !declared.has(k)), [], 'count() 之鍵不在契約')
            // 各 pass／專步回傳之 stats(提煉段逐鍵 count 入統計):初值由契約生成(extractStatInit 之鍵子集;runPass 之 stats 為追蹤值,不入統計,不在此列)
            const statsKeys = (rel) => [...src(rel).matchAll(/const stats = extractStatInit\(\[([^\]]*)\]\)/g)].flatMap((m) => [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((x) => x[1]))
            for (const rel of ['workflow/supportGate.mjs', 'workflow/supportStockPass.mjs', 'workflow/orphanPass.mjs', 'workflow/disputePass.mjs', 'workflow/pending.mjs', 'stages/synonymStep.mjs']) {
                const keys = statsKeys(rel)
                assert.ok(keys.length > 0, `${rel}:讀不到 stats 初值(須為 extractStatInit([...]))`)
                assert.deepEqual(keys.filter((k) => !declared.has(k)), [], `${rel}:stats 初值之鍵不在契約`)
            }
            assert.match(src('stages/extractStage.mjs'), /const stat = extractStatInit\(\)/, '提煉段之 stat 初值由契約生成')
            // 初值生成器:未給鍵＝全部非條件鍵(序即契約之序、值皆 0);鍵不在契約或為條件鍵即拋
            const cond = EXTRACT_REPORT_KEYS.conditional.extract
            assert.deepEqual(Object.keys(extractStatInit()), EXTRACT_REPORT_KEYS.detail.extract.filter((k) => !cond.includes(k)))
            // 初值皆 0;唯型別計數鍵(REJECT_BY_KEYS;Gitea #109 §1)之初值為空物件 { 碼: 計數 }
            assert.ok(Object.entries(extractStatInit()).every(([k, v]) => (REJECT_BY_KEYS.includes(k) ? (v !== null && typeof v === 'object' && Object.keys(v).length === 0) : v === 0)) && cond.every((k) => declared.has(k)))
            assert.deepEqual(extractStatInit(['updated', 'failed']), { updated: 0, failed: 0 })
            assert.throws(() => extractStatInit(['nope']), /鍵不在契約（nope）/)
            assert.throws(() => extractStatInit(['backlog']), /條件鍵不入初值（backlog）/)
            assert.ok(MUST_SEE.test('WARN 提煉統計：未知之統計鍵 foo（不在初值表，已略過；程式之錯）'), '未知統計鍵之 WARN 為須見')
        })

        it('巡檢所讀之鍵於實際執行時皆在:更新之核心、概念、消化(引用＋略過)、降級、截止、積壓、各專步之連續失敗;逾限之待判登錄數', () => {
            const d = runs.aiFail.reps[0].detail
            for (const k of ['updated', 'concepts', 'notesUsed', 'notesSkipped', 'degraded', 'stopped', 'failed', 'backlog', 'disputeFailStreak', 'supportFailStreak', 'orphanFailStreak', 'synonymFailStreak']) assert.ok(k in d, k)
            assert.ok(!('unheld' in d) && !('unchecked' in d), '集合必開後無未登錄／未記之鍵')
            assert.equal(runs.exhausted.reps[1].detail.notesHeld, 2)
            assert.equal(runs.stopped.reps[0].detail.stopped, 1)
            assert.equal(runs.degrade.reps[0].detail.degraded, 1)
        })
    })
})

/**
 * 物件之依賴(mkEnvIn 之環境＋時鐘與 AI 替身)
 *
 * @param {Object} env 輸入環境
 * @returns {Object} 回傳 deps
 */
function mkEnvDeps(env) {
    return { ...env, clock: fixedClock('2026-10-05'), ai: scriptAi({ draft: draftAll }) }
}
