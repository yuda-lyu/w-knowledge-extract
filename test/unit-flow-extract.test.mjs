// unit-flow-extract.test.mjs — 提煉之整合流程:總組裝於真 LMDB 上以 3+3 替身跑四輪(新核心 → 新料與內容變更 → 明示刪除 → 撤銷刪除)
// 規則(出自 createKnowledgeExtract、extractObject、stages/extractStage 與 stages/extractMaintain 之檔頭):
//   F1 第一輪:摘要交出之筆記依主標籤分群,主標籤可提煉篇數 ≥ 新核心門檻者成核心(未達者不建);一次 3+3(起草三席 → 整合 → 審計 → 終審),
//      差量套用後狀態檔(真理)與核心 md(投影)落 <workDir>/knowledge/core、核心記錄入 cores、所用之筆記記提煉時刻(extractedAt)
//   F2 固定格式摘要(對外契約)逐字;run.start.json 先宣告本輪上限、run.json 結構化落地;日誌檔之字樣可由日誌契約之正則解析
//   F3 第二輪(增量):新加入之同概念筆記入批、已提煉而內容變更之筆記排入重審(維護時以內容鍵偵測);核心升版;未變者不重送
//   F4 第三輪:關聯套件之明示刪除(墓碑)→ 維護撤出該篇之出處(不呼叫 AI;出處欄不動、存活出處由撤出集合衍生);第四輪前撤銷刪除(關聯套件之
//      undoDeleteNote,原樣放回)→ 恢復
// 執行:自套件根 node <mocha> test/unit-flow-extract.test.mjs(暫存 test/_tmp/flow-extract-<pid>,測完即刪;不連網、不呼叫真 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readMd, writeMd } from '../src/core/summarizePackage.mjs'
import { EXTRACT_LOG_PARSE } from '../src/logContract.mjs'
import { liveSourcesOf } from '../src/stores/coreState.mjs'
import { deleteNote, undoDeleteNote } from './tools/relateForTest.mjs'
import { scriptAi, draftAll, readState } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots, resetConceptFold, landNote, buildTestExtractor, withStores, seedNotes, subReport, findFiles, readJsonFile, fileLogFactory, silentLog } from './tools/extractTestKit.mjs'
import { sleep } from './tools/captureForTest.mjs'

const MIN = 60_000

describe('unit-flow-extract', function() {

    this.timeout(120_000)

    let root = ''
    let flow = null
    const reps = []
    const N = {}
    const ai = scriptAi({ draft: draftAll })
    /** 各輪送進起草之筆記標題(三席同一提示詞:取第一席)、各輪之 AI 呼叫數、各輪結束時之核心狀態 */
    const titlesOfRound = []
    const callsOfRound = []
    const statesOfRound = []
    /** 一輪(兩輪之間隔一秒:時間戳為秒級,各輪之日誌、開工標記與執行摘要各一份) */
    const runRound = async () => {
        if (reps.length) await sleep(1100)
        const before = ai.calls.length
        const rep = await flow.run()
        const calls = ai.calls.slice(before)
        const draft = calls.find((c) => c.role === 'draft')
        titlesOfRound.push(draft ? [...draft.prompt.matchAll(/^### N\d+ (\S*)/gm)].map((m) => m[1]) : [])
        callsOfRound.push(calls.length)
        const [core] = (await withStores(flow, (s) => s.cores.select())).filter((c) => c.concept === '視差量測')
        statesOfRound.push(core ? readState({ dirs: flow.info().dirs }, core.id) : null)
        reps.push(rep)
        return rep
    }
    const relateDeps = (s) => ({ stores: s, dirs: flow.info().dirs, clock: flow.info().clock, log: silentLog, domain: flow.info().domains.relate })

    before(async () => {
        root = tmpRoot('flow-extract')
        const notesDir = `${root}/knowledge/notes`
        N.a = landNote(notesDir, { doc: 'a', title: '恆星視差之量測', concepts: ['視差量測'] })
        N.b = landNote(notesDir, { doc: 'b', title: '視差誤差之修正', concepts: ['視差量測'] })
        N.c = landNote(notesDir, { doc: 'c', title: '星等之定義', concepts: ['星等'] })
        ;({ flow } = buildTestExtractor(root, { aiAdapter: ai, scheduleLimitMin: 55, logFactory: fileLogFactory(() => flow) }))
        await seedNotes(flow, [N.a, N.b, N.c])
        // ── 第一輪 ──
        await runRound()
        // ── 兩輪之間:新筆記加入;b 之核心知識被改寫(摘要套件之內容同步)──
        N.d = landNote(notesDir, { doc: 'd', title: '視差量測之新方法', concepts: ['視差量測'] })
        await withStores(flow, (s) => s.notes.insertNew([N.d]))
        const md = readMd(N.b.file)
        writeMd(N.b.file, md.front, md.body.replace(/視差誤差之修正之步驟/, '修訂：視差誤差之修正須先校正儀器之系統誤差'))
        // ── 第二輪 ──
        await runRound()
        // ── 第三輪前:關聯套件之明示刪除 a(墓碑＋封存;不投影)──
        await withStores(flow, (s) => deleteNote(relateDeps(s), N.a.id, { reason: '與他篇重複之文件', project: false }))
        await runRound()
        // ── 第四輪前:撤銷 a 之刪除(原樣放回)──
        await withStores(flow, (s) => undoDeleteNote(relateDeps(s), N.a.id, { project: false }))
        await runRound()
    })

    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    const logText = (rep) => fs.readFileSync(rep.summaryFile.replace(/-run\.json$/, '-run.log'), 'utf8')
    const coreOf = async () => (await withStores(flow, (s) => s.cores.select())).filter((c) => c.concept === '視差量測')

    it('F1 第一輪:主標籤達門檻之概念(視差量測 2 篇)成一則新核心,未達者(星等 1 篇)不建;一次 3+3,起草送進本批兩篇;狀態檔與 md 落核心目錄、所用之筆記記提煉時刻', async () => {
        assert.equal(reps[0].ok, true)
        const d = subReport(reps[0], '提煉', 'extract').detail
        assert.deepEqual([d.concepts, d.updated, d.notesUsed, d.failed], [1, 1, 2, 0])
        assert.deepEqual(titlesOfRound[0].sort(), ['恆星視差之量測', '視差誤差之修正'])
        assert.deepEqual(ai.roles().slice(0, 6), ['draft', 'draft', 'draft', 'integrate', 'audit', 'accept'])
        const [core] = await coreOf()
        assert.deepEqual(fs.readdirSync(`${root}/knowledge/core`).filter((f) => f.startsWith(core.id)).sort(), [`${core.id}.md`, `${core.id}.state.json`])
        const st0 = readJsonFile(`${root}/knowledge/core/${core.id}.state.json`)
        assert.equal(st0.concept, '視差量測')
        const md = readMd(`${root}/knowledge/core/${core.id}.md`)
        assert.equal(md.front.concept, '視差量測')
        await withStores(flow, async (s) => {
            assert.match((await s.notes.get(N.b.id)).extractedAt, /^\d{4}-\d{2}-\d{2}T/)
            assert.equal((await s.notes.get(N.c.id)).extractedAt || '', '', '未入核心之篇不記提煉時刻')
        })
    })

    it('F2 固定格式摘要(對外契約)逐字;開工標記先宣告本輪上限、執行摘要結構化落地;四輪各一份,時間戳與日誌檔同一個;段落完成行可由日誌契約之正則解析', () => {
        assert.equal(reps[0].stages[0].result.summary, '概念 1、更新 1 則核心、消化 2 篇（AI 6 次）')
        const starts = findFiles(`${root}/log`, '-run.start.json')
        const sums = findFiles(`${root}/log`, '-run.json')
        assert.deepEqual([starts.length, sums.length, findFiles(`${root}/log`, '-run.log').length], [4, 4, 4])
        const st = readJsonFile(starts[0])
        assert.deepEqual([st.limitMin, st.scheduleLimitMin, st.deadlineMs, st.lockStaleMs, st.pid], [55, 55, 49 * MIN, 60 * MIN, process.pid])
        assert.equal(path.basename(starts[0]).replace('-run.start.json', ''), path.basename(reps[0].summaryFile).replace('-run.json', ''))
        const sum = readJsonFile(reps[0].summaryFile)
        assert.deepEqual([sum.name, sum.ok, sum.lockSkipped, sum.stages.map((x) => x.name)], ['知識提煉', true, false, ['提煉']])
        assert.deepEqual(Object.keys(sum.stages[0].sub), ['extract'])
        assert.equal(sum.stages[0].summary, reps[0].stages[0].result.summary)
        const t1 = logText(reps[0])
        const num = (re) => Number(t1.match(re)[1])
        assert.deepEqual([num(EXTRACT_LOG_PARSE.concepts), num(EXTRACT_LOG_PARSE.cores), num(EXTRACT_LOG_PARSE.aiCalls)], [1, 1, 6])
    })

    it('F3 第二輪之增量:新筆記(d)入批、內容變更之已提煉筆記(b)排入重審;未變者(a)不重送;核心升版(v2);摘要附「重審 1 篇」', async () => {
        assert.equal(reps[1].ok, true)
        const d = subReport(reps[1], '提煉', 'extract').detail
        assert.deepEqual([d.concepts, d.updated, d.recheckChanged, d.notesRechecked], [1, 1, 1, 1], JSON.stringify(d))
        assert.deepEqual(titlesOfRound[1].sort(), ['視差誤差之修正', '視差量測之新方法'])
        assert.deepEqual([statesOfRound[0].version, statesOfRound[1].version], [1, 2])
        assert.match(reps[1].stages[0].result.summary, /^概念 1、更新 1 則核心、消化 \d+ 篇、重審 1 篇（AI \d+ 次）$/)
    })

    it('F4 明示刪除(墓碑)→ 第三輪之維護撤出 a 之出處(不呼叫 AI;出處欄不動、存活出處不含 a);摘要附「撤出處 1 篇」', async () => {
        const d = subReport(reps[2], '提煉', 'extract').detail
        assert.equal(d.withdrawn, 1, JSON.stringify(d))
        assert.equal(callsOfRound[2], 0, '撤出處屬無 AI 之維護')
        const st = statesOfRound[2]
        assert.deepEqual(Object.keys(st.withdrawn), [N.a.id])
        assert.equal(st.withdrawn[N.a.id].title, '恆星視差之量測')
        const citingA = st.claims.filter((c) => (c.sources || []).includes(N.a.id))
        assert.ok(citingA.length >= 1, '出處欄不動')
        for (const c of citingA) assert.ok(!liveSourcesOf(c, st).includes(N.a.id), `${c.id}:存活出處不含已撤者`)
        assert.match(reps[2].stages[0].result.summary, /、撤出處 1 篇/)
    })

    it('F4 還原 → 第四輪之維護恢復 a(撤出集合移除);摘要附「恢復 1 篇」', async () => {
        const d = subReport(reps[3], '提煉', 'extract').detail
        assert.equal(d.restored, 1, JSON.stringify(d))
        assert.equal(callsOfRound[3], 0, '恢復屬無 AI 之維護')
        assert.deepEqual(Object.keys(statesOfRound[3].withdrawn), [])
        const citingA = statesOfRound[3].claims.filter((c) => (c.sources || []).includes(N.a.id))
        for (const c of citingA) assert.ok(liveSourcesOf(c, statesOfRound[3]).includes(N.a.id), `${c.id}:還原後存活出處含 a`)
        assert.match(reps[3].stages[0].result.summary, /、恢復 1 篇/)
    })
})
