// unit-distill-stage.test.mjs — 提煉階段(2.0:主張庫＋差量)之端到端行為:真檔案 IO＋記憶體集合＋腳本化 AI 替身
//
// 規格來源:tmp/wke-distill-b-全盤.md §11.1、§12(2026-09-29 雙審定案);安裝方〈建議w-knowledge-extract優化〉§2、§3 驗收 1～6。
//   AI 替身依提示詞身分(提煉器／審查員／整併員)回腳本化之 JSON,並經階段傳入之 check 驗證(同真 callJson 之語意)。
// 執行:npx mocha test/unit-distill-stage.test.mjs(暫存落 test/_tmp/distill-stage-<pid>,測完即刪;不發網路、不開埠)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore } from './tools/memStore.mjs'
import { stageDistill, distillTarget } from '../src/stages/distillStage.mjs'
import { createDistillDomain } from '../src/domain/distillDomain.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { resolveSettings } from '../src/core/settingsDefault.mjs'
import { expandDirs } from '../src/core/dirs.mjs'
import { writeMd, readMd } from '../src/md/md.mjs'
import { createClock } from '../src/util/clock.mjs'
import { setConceptFold, slugify } from '../src/util/text.mjs'
import { checkInvariants, emptyState } from '../src/stores/coreState.mjs'
import { defineMw } from '../src/core/kernel.mjs'

const TMP = path.resolve(`test/_tmp/distill-stage-${process.pid}`).replace(/\\/g, '/')
const clock = createClock('Asia/Taipei')
let seq = 0

/** 建立一個知識庫環境(目錄、筆記 md、記憶體集合、設定) */
function mkEnv(notes, o = {}) {
    const dirs = expandDirs(`${TMP}/w${++seq}`)
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
    const rows = notes.map((n) => {
        const file = `${dirs.notes}/${n.id}.md`
        writeMd(file, { title: n.title || n.id, conflicts: n.conflicts || [], published: n.published || '' },
            `# ${n.title || n.id}\n\n## 一句話重點\n\n${n.id} 之重點\n\n## 核心知識\n\n- ${n.id} 之知識\n\n## 來源\n\n- x`)
        return { title: n.id, category: '方法與技術', createdAt: '2026-08-01T00:00:00+08:00', relatedAt: '2026-08-02', claimType: '實證研究', evidenceLevel: '中', sourceName: `S-${n.id}`, docId: `d-${n.id}`, ...n, file }
    })
    const settings = resolveSettings({
        knowledge: { distillMinNotes: 2, distillNotesPerConcept: 3, distillPerRun: 2, distillCatchupBatches: 1, distillMinPending: 1, distillMaxWaitDays: 0, ...(o.knowledge || {}) },
        ai: { distill: { propose: { use: 'x' }, review: o.review === false ? null : { use: 'y' }, consolidate: { use: 'x' } } },
    })
    return {
        dirs,
        stores: { notes: memStore(rows), cores: memStore(o.cores || []), relations: memStore(o.relations || []), docs: memStore(o.docs || []) },
        settings,
        domains: { distill: createDistillDomain({}), relate: createRelateDomain({}) },
    }
}

/** 腳本化 AI:依提示詞身分分派;腳本回 'fail' 即失敗,其餘經 check 驗證(不合即 OUTPUT_VALIDATION_FAILED) */
function scriptAi(script) {
    const calls = []
    return {
        calls,
        callJson: async (prompt, check, opt) => {
            const kind = /的審查員/.test(prompt) ? 'review' : (/的整併員/.test(prompt) ? 'consolidate' : 'propose')
            calls.push({ kind, prompt, opt })
            const fn = script[kind]
            const out = typeof fn === 'function' ? fn(prompt, calls.filter((c) => c.kind === kind).length) : fn
            if (out === 'fail' || out === undefined) return { ok: false, data: null, error: 'stub-fail', skipped: false, attempts: 1, preview: '', errors: ['stub:exec(0.1s)'] }
            if (!check(out)) return { ok: false, data: null, error: 'OUTPUT_VALIDATION_FAILED', skipped: false, attempts: 1, preview: '', errors: [] }
            return { ok: true, data: out, error: '', skipped: false, attempts: 1, preview: '', providerId: `stub-${kind}` }
        },
    }
}

/** 取提示詞中之本批代號 */
const codesIn = (prompt) => [...prompt.matchAll(/^### (N\d+) /gm)].map((m) => m[1])

/** 記錄型 logger */
function recLog() {
    const lines = []
    const f = (lv) => (m) => lines.push(`${lv} ${m}`)
    return { lines, info: f('INFO'), warn: f('WARN'), error: f('ERROR'), debug: () => {} }
}

async function runStage(env, ai, opt = {}) {
    const log = recLog()
    const ctx = { deps: { ...env, clock, ai }, log, remainingMs: () => 3_600_000, expired: () => false }
    const report = await stageDistill(opt).run(ctx)
    return { report, log }
}

const readState = (env, id) => JSON.parse(fs.readFileSync(`${env.dirs.coreState}/${id}.state.json`, 'utf8'))

// 一般提案:每篇一條新主張,並以首條立本質
const proposeAll = (prompt) => {
    const codes = codesIn(prompt)
    return {
        ops: [
            ...codes.map((c, k) => ({ op: 'add', ref: `r${k}`, kind: 'principle', text: `主張 ${c} ${Math.random().toString(36).slice(2, 6)}`, basis: '案例', sources: [c] })),
            { op: 'essence', text: '本質文字', claims: ['@r0'], reason: '首版' },
        ],
        skipped: [],
    }
}
// 審查全數保留:逐條明列 keep(不可逆操作須明列裁決,漏列者不套用)
const keepAll = (prompt) => ({ verdicts: [...prompt.matchAll(/^i=(\d+) /gm)].map((m) => ({ i: Number(m[1]), action: 'keep' })) })

describe('unit-distill-stage', function() {

    before(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        setConceptFold(null)
    })
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    it('新概念首版:狀態檔、md(〔C1〕、提煉自)、cores 記錄(stateFormat 2、rev、noteIds＝consumed)、distilledAt;第二版累積不遺失舊主張', async () => {
        const env = mkEnv(['a1', 'a2', 'a3'].map((id) => ({ id, concepts: ['均值回歸'] })))
        const ai = scriptAi({ propose: proposeAll, review: keepAll })
        const { report } = await runStage(env, ai)
        assert.equal(report.detail.updated, 1)
        const rec = (await env.stores.cores.select())[0]
        assert.deepEqual([rec.version, rec.rev, rec.stateFormat, rec.status], [1, 1, 2, 'active'])
        assert.deepEqual(rec.noteIds.sort(), ['a1', 'a2', 'a3'])
        const st = readState(env, rec.id)
        assert.equal(st.claims.length, 3)
        assert.equal(st.claims[0].evidence.level, '中', '單篇「中」之出處 → 中')
        const md = readMd(rec.file)
        assert.equal(md.front.stateFormat, 2)
        assert.match(md.body, /〔C1〕/)
        assert.match(md.body, /## 提煉自/)
        assert.ok((await env.stores.notes.get('a1')).distilledAt)
        assert.equal(ai.calls[0].opt.acceptTruncated, false, '截斷一律換家')
        // 第二版:新筆記三篇,確認 C1 並新增
        for (const id of ['a4', 'a5', 'a6']) {
            const file = `${env.dirs.notes}/${id}.md`
            writeMd(file, { title: id }, `# ${id}\n\n## 核心知識\n\n- ${id}`)
            await env.stores.notes.insertNew([{ id, title: id, concepts: ['均值回歸'], createdAt: '2026-08-01T00:00:00+08:00', relatedAt: 'x', file, docId: `d-${id}`, evidenceLevel: '中', claimType: '實證研究' }])
        }
        const ai2 = scriptAi({ propose: (p) => ({ ops: [{ op: 'confirm', id: 'C1', sources: codesIn(p).slice(0, 2) }, { op: 'add', kind: 'rule', text: '新規則', sources: [codesIn(p)[2]] }], skipped: [] }), review: keepAll })
        await runStage(env, ai2)
        const st2 = readState(env, rec.id)
        assert.equal(st2.version, 2)
        assert.equal(st2.claims.length, 4, '舊主張全在、新增一條')
        assert.equal(st2.claims[0].sources.length, 3, 'C1 出處累積')
        assert.deepEqual(checkInvariants(st, st2, { touched: ['C1', 'C4'] }), [])
        assert.match(ai2.calls[0].prompt, /〔C1〕\[principle\]/, '提案看得到完整之既有主張(不截斷)')
    })

    it('審查:drop 之操作不套用而其筆記算涵蓋;審查失敗 → 降級:非終態照套、取代存待審;下次審查成功先裁決待審', async () => {
        const env = mkEnv(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id) => ({ id, concepts: ['動量'] })), { knowledge: { distillPerRun: 1 } })
        const ai = scriptAi({
            propose: (p) => ({ ops: [{ op: 'add', ref: 'a', kind: 'principle', text: '動量效應存在', sources: [codesIn(p)[0]] }, { op: 'add', kind: 'rule', text: '離題的東西', sources: [codesIn(p)[1]] }], skipped: [{ note: codesIn(p)[2], reason: '離題' }] }),
            review: () => ({ verdicts: [{ i: 1, action: 'drop', reason: '離題' }] }),
        })
        await runStage(env, ai)
        const rec = (await env.stores.cores.select())[0]
        const st = readState(env, rec.id)
        assert.equal(st.claims.length, 1, '被剔除之 add 不套用')
        assert.equal(st.consumed.length, 3, '引用、剔除、略過三篇皆涵蓋')
        assert.ok(st.skipped.some((x) => /審查剔除：離題/.test(x.reason)))
        // 第二輪:審查失敗 → 新增照套、取代存待審
        const ai2 = scriptAi({
            propose: (p) => ({ ops: [{ op: 'add', ref: 'n', kind: 'principle', text: '動量在高頻失效', sources: [codesIn(p)[0]] }, { op: 'supersede', id: 'C1', by: '@n', reason: '新研究', validPeriod: '較早之研究', sources: [codesIn(p)[0]] }], skipped: [{ note: codesIn(p)[1], reason: '無可用知識' }, { note: codesIn(p)[2], reason: '離題' }] }),
            review: 'fail',
        })
        const r2 = await runStage(env, ai2)
        assert.equal(r2.report.detail.degraded, 1)
        assert.ok(r2.log.lines.some((l) => /^WARN 提煉降級\[動量\]/.test(l)))
        const st2 = readState(env, rec.id)
        assert.equal(st2.claims.find((c) => c.id === 'C1').status, 'active', '未審之取代不套用')
        assert.equal(st2.pendingReview.length, 1)
        assert.deepEqual([st2.pendingReview[0].op.op, st2.pendingReview[0].op.by], ['supersede', 'C2'])
        assert.equal(st2.consumed.length, 6, '待審之出處算涵蓋')
        assert.match(readMd(rec.file).body, /待審：〔C1〕擬取代（由〔C2〕）/)
        assert.equal(st2.changelog.at(-1).reviewed, 'failed')
        assert.equal((await env.stores.cores.get(rec.id)).pendingReview, 1, 'cores 記錄鏡像待審數(無待提煉筆記時亦排待審專步)')
        // 第三輪:無新筆記(選題選不到),但待審存在 → 另排待審專步,以獨立差量裁決;不呼叫提案
        const ai3 = scriptAi({ propose: 'fail', review: () => ({ verdicts: [{ i: 0, action: 'keep' }] }) })
        const r3 = await runStage(env, ai3, { parallel: 1 })
        assert.deepEqual(ai3.calls.map((c) => c.kind), ['review'])
        assert.match(ai3.calls[0].prompt, /前次未經審查而暫緩之取代／撤回操作/)
        assert.match(ai3.calls[0].prompt, /^i=0 \{"op":"supersede","id":"C1","by":"C2".*"sources":\["N1"\]\}$/m, '待審操作之出處以本批代號呈現(對得上【筆記】)')
        assert.match(ai3.calls[0].prompt, /^### N1 /m)
        assert.equal(r3.report.detail.pendingReviewed, 1)
        const st3 = readState(env, rec.id)
        assert.equal(st3.pendingReview.length, 0)
        assert.equal(st3.claims.find((c) => c.id === 'C1').status, 'superseded')
        assert.equal(st3.claims.find((c) => c.id === 'C1').supersededBy, 'C2')
    })

    it('1.0.3 舊核心遷移:封存散文(去 H1、降兩級、置於可收合區)、不轉主張、consumed 自 ∅、版號接續;索引本質於新本質前標「（舊版）」', async () => {
        const env = mkEnv(['c1', 'c2', 'c3'].map((id) => ({ id, concepts: ['波動率'] })))
        const file = `${env.dirs.core}/old-core.md`
        writeMd(file, { concept: '波動率', type: 'core', version: 7 }, '# 核心知識：波動率\n\n## 本質\n\n舊本質文字\n\n## 原理\n\n- 舊原理一\n\n## 提煉自\n\n- [[c1]] 舊批')
        await env.stores.cores.replace({ id: 'old-core', concept: '波動率', scope: 'concept', file, version: 7, noteCount: 99, noteIds: ['c1'], essence: '舊本質文字', updatedAt: '2026-09-01T00:00:00+08:00' })
        const ai = scriptAi({ propose: (p) => ({ ops: [{ op: 'add', kind: 'principle', text: '新主張', sources: codesIn(p) }], skipped: [] }), review: keepAll })
        const { log } = await runStage(env, ai)
        assert.equal(codesIn(ai.calls[0].prompt).length, 3, 'consumed 自 ∅:1.x 末批 c1 仍待提煉(其知識只在封存區)')
        const st = readState(env, 'old-core')
        assert.equal(st.version, 8, '版號接續')
        assert.match(st.legacy.body, /#### 原理/)
        assert.doesNotMatch(st.legacy.body, /核心知識：波動率|提煉自/)
        assert.equal(st.legacy.essence, '舊本質文字')
        const md = readMd(file)
        assert.match(md.body, /## 舊版內容（升版前之核心，未逐條出處，僅供參考）[\s\S]*<details>[\s\S]*舊原理一/)
        assert.match(md.body, /## 本質\n\n（舊版，未逐條出處）舊本質文字/)
        assert.match((await env.stores.cores.get('old-core')).essence, /^（舊版）舊本質文字/)
        assert.ok(log.lines.some((l) => /提煉遷移\[波動率\]/.test(l)))
    })

    it('2.0 狀態遺失:無 .prev → 跳過並 ERROR(絕不把 2.0 md 當舊散文重新匯入);有 .prev → 還原(WARN)後照常處理', async () => {
        const notes = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'].map((id) => ({ id, concepts: ['因子'] }))
        const env = mkEnv(notes, { knowledge: { distillPerRun: 1 } })
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        const rec = (await env.stores.cores.select())[0]
        const stFile = `${env.dirs.coreState}/${rec.id}.state.json`
        fs.rmSync(stFile)
        const r1 = await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        assert.ok(r1.log.lines.some((l) => /^ERROR 提煉\[因子\]：2\.0 核心之狀態檔遺失且無上一版可還原/.test(l)))
        assert.equal(fs.existsSync(stFile), false, '不重新匯入、不寫檔')
        assert.equal((await env.stores.cores.get(rec.id)).version, 1, '記錄不動')
        assert.doesNotMatch(readMd(rec.file).body, /舊版內容/)
        // 另一庫:跑兩版(產生 .prev)後刪狀態 → 由 .prev 還原
        const env2 = mkEnv(notes, { knowledge: { distillPerRun: 1 } })
        await runStage(env2, scriptAi({ propose: proposeAll, review: keepAll }))
        await runStage(env2, scriptAi({ propose: proposeAll, review: keepAll }))
        const rec2 = (await env2.stores.cores.select())[0]
        const st2 = `${env2.dirs.coreState}/${rec2.id}.state.json`
        assert.equal(readState(env2, rec2.id).version, 2)
        fs.rmSync(st2)
        const r2 = await runStage(env2, scriptAi({ propose: proposeAll, review: keepAll }))
        assert.ok(r2.log.lines.some((l) => /^WARN 提煉狀態還原\[因子\]：狀態檔遺失，已由上一版還原/.test(l)))
        const back = readState(env2, rec2.id)
        assert.equal(back.version, 2, '自 .prev(v1)還原後照常提案 → v2')
        assert.ok(back.rev > 2, 'rev 延續遞增(不歸 1)')
    })

    it('中斷補做:dirty 標記殘留 → 下輪無 AI 以狀態重建投影(md、cores 記錄);投影 rev 落後者載入時對帳', async () => {
        const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['配對交易'] })))
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        const rec = (await env.stores.cores.select())[0]
        fs.rmSync(rec.file)
        await env.stores.cores.replace({ ...rec, rev: 0, version: 0 })
        fs.mkdirSync(`${env.dirs.state}/core/dirty`, { recursive: true })
        fs.writeFileSync(`${env.dirs.state}/core/dirty/${rec.id}`, 'x', 'utf8')
        const ai = scriptAi({ propose: 'fail', review: keepAll })
        const { report, log } = await runStage(env, ai)
        assert.equal(report.detail.repaired, 1)
        assert.equal(ai.calls.length, 0, '無 AI')
        assert.ok(fs.existsSync(rec.file))
        assert.equal((await env.stores.cores.get(rec.id)).rev, 1)
        assert.ok(log.lines.some((l) => /WARN 提煉投影補正\[配對交易\]/.test(l)))
        assert.equal(fs.readdirSync(`${env.dirs.state}/core/dirty`).length, 0)
    })

    it('CAS:載入後狀態被他處改動 → 不寫入、不寫投影、記 ERROR', async () => {
        const env = mkEnv(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => ({ id, concepts: ['套利'] })), { knowledge: { distillPerRun: 1 } })
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
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
        const { log } = await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }), { tap: { renderState: { after: [intruder] } } })
        assert.ok(log.lines.some((l) => /^ERROR 提煉\[套利\]：核心狀態已被他處改動/.test(l)))
        assert.equal(readState(env, rec.id).version, 1, '他處之內容保留')
        assert.equal((await env.stores.cores.get(rec.id)).version, 1)
    })

    it('失敗帳:提案全鏈失敗 → tries+1、lastTriedAt、筆記不消耗;批內未涵蓋 → 重送,達 2 次標已用並記「未涵蓋逾限」', async () => {
        const env = mkEnv(['g1', 'g2', 'g3'].map((id) => ({ id, concepts: ['風險平價'] })))
        await runStage(env, scriptAi({ propose: 'fail' }))
        const ledger = JSON.parse(fs.readFileSync(`${env.dirs.state}/distill-attempts.json`, 'utf8'))
        assert.equal(ledger['concept|風險平價'].tries, 1)
        assert.ok(ledger['concept|風險平價'].lastTriedAt)
        assert.equal((await env.stores.cores.select()).length, 0)
        // 只引用一篇、不交代另兩篇 → 未涵蓋兩篇重送
        const onlyFirst = (p) => ({ ops: [{ op: 'add', kind: 'principle', text: `甲${Math.random()}`, sources: [codesIn(p)[0]] }], skipped: [] })
        await runStage(env, scriptAi({ propose: onlyFirst, review: keepAll }))
        const rec = (await env.stores.cores.select())[0]
        let st = readState(env, rec.id)
        assert.equal(st.consumed.length, 1)
        const l2 = JSON.parse(fs.readFileSync(`${env.dirs.state}/distill-attempts.json`, 'utf8'))['concept|風險平價']
        assert.equal(l2.tries, 0, '成功即清除')
        assert.equal(Object.keys(l2.noteTries).length, 2)
        await runStage(env, scriptAi({ propose: (p) => ({ ops: [], skipped: [] }), review: keepAll }))
        st = readState(env, rec.id)
        assert.equal(st.consumed.length, 3, '第二次仍未涵蓋 → 逾限標已用')
        assert.equal(st.skipped.filter((x) => x.reason === '未涵蓋逾限').length, 2)
        assert.equal(st.version, 1, '只落帳不改版號')
        assert.equal(st.rev, 2, '但升 rev(首輪失敗不寫;次輪 rev 1;本輪只落帳 rev 2)')
    })

    it('分身:同鍵兩核心 → 綁定主核心(版本高者)、落盤後分身標 merged、原文封存、md 改轉址頁;索引排除', async () => {
        setConceptFold((s) => s.replace(/归/g, '歸'))
        try {
            const env = mkEnv(['h1', 'h2', 'h3'].map((id) => ({ id, concepts: ['均值回歸'] })))
            const mk = async (id, concept, version) => {
                const file = `${env.dirs.core}/${id}.md`
                writeMd(file, { concept, type: 'core', version }, `# 核心知識：${concept}\n\n## 本質\n\n${concept} 舊文`)
                await env.stores.cores.replace({ id, concept, scope: 'concept', file, version, noteCount: 2, noteIds: [], updatedAt: '2026-09-01T00:00:00+08:00' })
            }
            await mk('main-core', '均值回歸', 9)
            await mk('twin-core', '均值回归', 1)
            const { log } = await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
            const twin = await env.stores.cores.get('twin-core')
            assert.deepEqual([twin.status, twin.mergedInto], ['merged', 'main-core'])
            const md = readMd(twin.file)
            assert.equal(md.front.type, 'redirect')
            assert.match(fs.readFileSync(twin.archivedFile, 'utf8'), /均值回归 舊文/)
            assert.ok(log.lines.some((l) => /^WARN 提煉分身合併\[均值回归\]/.test(l)))
            assert.equal(readState(env, 'main-core').version, 10)
        }
        finally {
            setConceptFold(null)
        }
    })

    it('新核心 id 撞號:同名類別核心占用 slug → 概念層新核心重新種子,兩者互不覆寫', async () => {
        const env = mkEnv(['i1', 'i2', 'i3'].map((id) => ({ id, concepts: ['方法與技術'] })))
        const catId = slugify('方法與技術', 'core|方法與技術')
        await env.stores.cores.replace({ id: catId, concept: '方法與技術', scope: 'category', file: `${env.dirs.core}/${catId}.md`, version: 3, noteCount: 12, noteIds: [] })
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        const all = await env.stores.cores.select()
        assert.equal(all.length, 2)
        const concept = all.find((c) => c.scope === 'concept')
        assert.notEqual(concept.id, catId)
        assert.equal((await env.stores.cores.get(catId)).version, 3, '類別核心不被覆寫')
    })

    it('整併:有效主張逾上限 → 先整併(不消耗筆記)再照常提案;整併嘗試記入失敗帳', async () => {
        const env = mkEnv(['j1', 'j2', 'j3', 'j4', 'j5', 'j6'].map((id) => ({ id, concepts: ['動能'] })), { knowledge: { distillClaimsCap: 2, distillConsolidateEvery: 1, distillPerRun: 1 } })
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        const rec = (await env.stores.cores.select())[0]
        const ai = scriptAi({
            consolidate: () => ({ ops: [{ op: 'merge', into: 'C1', from: ['C2'], reason: '同義' }] }),
            propose: proposeAll,
            review: keepAll,
        })
        const { report } = await runStage(env, ai)
        assert.equal(report.detail.consolidated, 1)
        assert.equal(report.detail.batches, 1, '整併不取代提案')
        const st = readState(env, rec.id)
        assert.equal(st.claims.find((c) => c.id === 'C2').mergedInto, 'C1')
        assert.ok(st.lastConsolidated > 0)
        const led = JSON.parse(fs.readFileSync(`${env.dirs.state}/distill-attempts.json`, 'utf8'))['concept|動能']
        assert.equal(led.consolidate.ok, true)
        assert.deepEqual(ai.calls.map((c) => c.kind), ['consolidate', 'review', 'propose', 'review'])
        assert.match(ai.calls[1].prompt, /整併員對「動能」提出之整併操作/, '整併之審查提示詞說明是整併')
    })

    it('不可逆操作漏裁決:整併之合併本次不採(不入待審);提案之取代改存待審(理由「審查未裁決」)', async () => {
        const env = mkEnv(['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => ({ id, concepts: ['流動性'] })), { knowledge: { distillClaimsCap: 2, distillConsolidateEvery: 1, distillPerRun: 1 } })
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        const rec = (await env.stores.cores.select())[0]
        const silent = () => ({ verdicts: [] })
        const { log } = await runStage(env, scriptAi({
            consolidate: () => ({ ops: [{ op: 'merge', into: 'C1', from: ['C2'], reason: '同義' }] }),
            propose: (p) => ({ ops: [{ op: 'add', ref: 'n', kind: 'rule', text: '新規則', sources: [codesIn(p)[0]] }, { op: 'supersede', id: 'C3', by: '@n', reason: '新研究', validPeriod: '舊', sources: [codesIn(p)[0]] }], skipped: [{ note: codesIn(p)[1], reason: '離題' }, { note: codesIn(p)[2], reason: '離題' }] }),
            review: silent,
        }))
        const st = readState(env, rec.id)
        assert.equal(st.claims.find((c) => c.id === 'C2').status, 'active', '漏裁決之合併不套用')
        assert.ok(log.lines.some((l) => /提煉審查\[流動性\]：1 項不可逆操作未得裁決，本次不採/.test(l)))
        assert.equal(st.claims.find((c) => c.id === 'C3').status, 'active', '漏裁決之取代不套用')
        assert.deepEqual(st.pendingReview.map((e) => [e.op.op, e.op.id, e.reason]), [['supersede', 'C3', '審查未裁決']])
        assert.ok(st.claims.some((c) => c.text === '新規則'), '非終態之新增照套(未列出者視為 keep)')
    })

    it('追趕:同核心同輪連續多批(每批各自落盤);第二批起須仍有滿批', async () => {
        const env = mkEnv(Array.from({ length: 7 }, (_, i) => ({ id: `k${i}`, concepts: ['市場微結構'] })), { knowledge: { distillCatchupBatches: 3, distillNotesPerConcept: 3 } })
        const { report } = await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        assert.equal(report.detail.batches, 2, '7 篇:第一批 3、第二批 3,剩 1 篇未滿批不再追')
        assert.deepEqual([report.detail.updated, report.detail.bumps, report.stats.out], [1, 2, 1], '「更新 N 則核心」以核心計(巡檢之核心更新數據此),升版次數另計')
        assert.equal((await env.stores.cores.select()).length, 1, '新核心之次批載入同一核心(不自造分身)')
        const rec = (await env.stores.cores.select())[0]
        assert.equal(readState(env, rec.id).consumed.length, 6)
        assert.equal(readState(env, rec.id).version, 2)
    })

    it('閒置輪:①補做久候尾數(既有核心只剩 1～3 篇且久候,一般規則永不入選);②類別後備預設停用', async () => {
        const env = mkEnv(Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, concepts: ['動量'] })), { knowledge: { distillMinPending: 4, distillMaxWaitDays: 30, distillNotesPerConcept: 12 } })
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        const rec = (await env.stores.cores.select())[0]
        for (const id of ['m6', 'm7']) {
            const file = `${env.dirs.notes}/${id}.md`
            writeMd(file, { title: id }, `# ${id}\n\n## 核心知識\n\n- ${id}`)
            await env.stores.notes.insertNew([{ id, title: id, concepts: ['動量'], category: '方法與技術', createdAt: '2026-08-01T00:00:00+08:00', relatedAt: 'x', file, docId: `d-${id}`, evidenceLevel: '中', claimType: '實證研究' }])
        }
        // 尾數 2 篇 < distillMinPending 4:核心剛提案 → 不入選
        const r1 = await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        assert.deepEqual([r1.report.detail.concepts, r1.report.detail.tails], [0, 0])
        assert.ok(r1.log.lines.some((l) => /提煉：無累積足量新筆記的概念$/.test(l)), '類別後備預設停用(不改走類別層)')
        // 核心已久候(上次提案 40 天前)→ 閒置輪補做尾數
        const aged = new Date(Date.now() - 40 * 86400_000).toISOString()
        await env.stores.cores.replace({ ...rec, proposedAt: aged, updatedAt: aged })
        const r2 = await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        assert.equal(r2.report.detail.tails, 1)
        assert.ok(r2.log.lines.some((l) => /補做久候尾數（動量×2）/.test(l)))
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
        const knowledge = { distillMinNotes: 6, distillNotesPerConcept: 2, distillCatchupBatches: 3, categoryFallback: { minNotes: 3, minGain: 2 } }
        const env = mkEnv(notes, { knowledge })
        await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        const concept = (await env.stores.cores.select()).find((c) => c.concept === '丙')
        assert.equal(concept.noteIds.length, 6, '第一輪:概念層(丙)追趕三批')
        const r2 = await runStage(env, scriptAi({ propose: proposeAll, review: keepAll }))
        assert.ok(r2.log.lines.some((l) => /改走類別層（其他；久候孤兒 4 篇）/.test(l)), r2.log.lines.join('\n'))
        const cat = (await env.stores.cores.select()).find((c) => c.scope === 'category')
        assert.equal(r2.report.detail.batches, 1, '類別目標每輪 1 批')
        assert.equal(cat.noteIds.length, 2)
        assert.ok(cat.noteIds.every((id) => /^o/.test(id)), '已屬概念核心之筆記不入類別核心')
        // 停用:null／false
        for (const off of [null, false]) {
            const e2 = mkEnv(notes, { knowledge: { ...knowledge, categoryFallback: off } })
            await runStage(e2, scriptAi({ propose: proposeAll, review: keepAll }))
            const r = await runStage(e2, scriptAi({ propose: proposeAll, review: keepAll }))
            assert.equal(r.report.detail.concepts, 0, `categoryFallback:${off}`)
        }
    })

    it('distillTarget:單一選題不落盤——同一條動作鏈(選篇→提案→審查→套用→渲染),回傳各步產物與新狀態;以回傳之 state 續跑下一版', async () => {
        const env = mkEnv(['t1', 't2', 't3', 't4'].map((id) => ({ id, concepts: ['學習率'] })))
        const notes = await env.stores.notes.select()
        const before = fs.readdirSync(TMP, { recursive: true }).length
        const ai = scriptAi({ propose: proposeAll, review: keepAll })
        const r1 = await distillTarget({ concept: '學習率', notes: notes.slice(0, 3), settings: env.settings, ai })
        assert.equal(r1.ok, true, r1.halt)
        assert.deepEqual(r1.calls.map((c) => [c.kind, c.ok]), [['propose', true], ['review', true]])
        assert.deepEqual(r1.batch.map((b) => b.code), ['N1', 'N2', 'N3'])
        assert.deepEqual([r1.state.version, r1.state.consumed.length, r1.state.claims.length], [1, 3, 3])
        assert.match(r1.render.body, /〔C1〕/)
        assert.match(r1.calls[0].prompt, /的提煉器/, '回傳提示詞原文(A/B 比對用)')
        assert.equal(fs.readdirSync(TMP, { recursive: true }).length, before, '不落盤')
        // 續跑:以回傳之 state 為舊狀態;已用過者不再入批
        const r2 = await distillTarget({ concept: '學習率', notes, state: r1.state, settings: env.settings, ai: scriptAi({ propose: proposeAll, review: keepAll }) })
        assert.deepEqual([r2.state.version, r2.batch.map((b) => b.id)], [2, ['t4']])
        assert.equal(r1.state.version, 1, '不修改傳入之狀態')
        // 全數用過 → 無可用筆記(不呼叫 AI)
        const r3 = await distillTarget({ concept: '學習率', notes, state: r2.state, settings: env.settings, ai: scriptAi({ propose: 'fail' }) })
        assert.deepEqual([r3.ok, r3.halt, r3.calls.length], [false, 'no-notes', 0])
        await assert.rejects(() => distillTarget({ concept: '', notes, settings: env.settings, ai }), /distillTarget 需要/)
    })

    it('提示詞長度保險絲:逾 60000 字 → WARN(含字數與有效主張數)＋longPrompts 計數,仍照常呼叫;未逾者不警示', async () => {
        const env = mkEnv(['p1', 'p2', 'p3'].map((id) => ({ id, concepts: ['學習率'] })))
        const notes = await env.stores.notes.select()
        const d0 = createDistillDomain({})
        const pad = (n) => ({ ...d0, buildProposePrompt: (x) => d0.buildProposePrompt(x) + 'x'.repeat(n) })
        const warns = []
        const log = { info: () => {}, warn: (m) => warns.push(m), error: () => {} }
        const long = await distillTarget({ concept: '學習率', notes, settings: env.settings, ai: scriptAi({ propose: proposeAll, review: keepAll }), domain: pad(60_001), log })
        assert.equal(long.stats.longPrompts, 1)
        assert.ok(long.calls[0].prompt.length > 60_000 && long.ok, '只警示不阻擋')
        assert.ok(warns.some((m) => /^提煉\[學習率\]：提案提示詞 \d{5,} 字偏長（有效主張 0 條）——.*regenCore/.test(m)), warns.join('\n'))
        warns.length = 0
        const short = await distillTarget({ concept: '學習率', notes, settings: env.settings, ai: scriptAi({ propose: proposeAll, review: keepAll }), log })
        assert.equal(short.stats.longPrompts || 0, 0)
        assert.ok(!warns.some((m) => /偏長/.test(m)))
    })

    it('拆解硬配之爭議經同一條鏈:提案 dispute_dissolve＋審查保留 → 爭議入沿革、立場轉主張;審查漏裁決 → 存待審;審查以「非對立」剔除新爭議 → 只立主張', async () => {
        const env = mkEnv(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((id) => ({ id, concepts: ['學習率'] })))
        const notes = await env.stores.notes.select()
        const codes = (p) => [...p.matchAll(/^### (N\d+) /gm)].map((m) => m[1])
        const withDispute = (p) => {
            const [a, b, c] = codes(p)
            const ops = [
                { op: 'add', ref: 'x', kind: 'rule', text: '大批次時要預熱', basis: '案例', sources: [a] },
                { op: 'dispute_add', question: '預熱是否必要', sides: [{ position: '需要', claims: ['@x'] }, { position: '小資料微調時可省略', sources: [b] }] },
                { op: 'add', kind: 'rule', text: '其他', basis: '案例', sources: [c] },
            ]
            return { ops }
        }
        const r1 = await distillTarget({ concept: '學習率', notes: notes.slice(0, 3), settings: env.settings, ai: scriptAi({ propose: withDispute, review: keepAll }) })
        assert.deepEqual([r1.ok, r1.state.disputes.length, r1.state.claims.find((c) => c.id === 'C1').status], [true, 1, 'contested'])
        const dissolve = (p) => ({ ops: [{ op: 'dispute_dissolve', id: 'D1', reason: '兩方回答不同情境', kinds: ['rule', 'pitfall'] }, { op: 'confirm', id: 'C2', sources: [codes(p)[0]] }], skipped: [] })
        // 審查漏裁決(未列出不可逆之拆解)→ 存待審、爭議不動
        const omit = (p) => ({ verdicts: [...p.matchAll(/^i=(\d+) (.*)$/gm)].filter((m) => !/dispute_dissolve/.test(m[2])).map((m) => ({ i: Number(m[1]), action: 'keep' })) })
        const r2 = await distillTarget({ concept: '學習率', notes: notes.slice(0, 4), state: r1.state, settings: env.settings, ai: scriptAi({ propose: dissolve, review: omit }) })
        assert.deepEqual([r2.state.disputes[0].status, r2.state.pendingReview.map((e) => e.op.op)], ['open', ['dispute_dissolve']])
        assert.match(r2.render.body, /- 待審：〔D1〕擬拆解：兩方回答不同情境/)
        // 審查保留 → 拆解
        const r3 = await distillTarget({ concept: '學習率', notes: notes.slice(0, 4), state: r1.state, settings: env.settings, ai: scriptAi({ propose: dissolve, review: keepAll }) })
        const c3 = r3.state.claims.find((c) => c.origin === 'dispute')
        assert.deepEqual([r3.state.disputes[0].status, c3.kind, c3.text, r3.state.claims.find((c) => c.id === 'C1').status], ['retracted', 'pitfall', '小資料微調時可省略', 'active'])
        assert.match(r3.render.body, new RegExp(`- 〔D1〕已拆解（非對立：兩方回答不同情境；各方見〔C1〕〔${c3.id}〕）：預熱是否必要`))
        assert.doesNotMatch(r3.render.body, /## 爭議與未定論/)
        // 審查以「非對立」剔除提案中之新爭議 → 只有立場之方轉為主張、無爭議
        const dropFake = (p) => ({ verdicts: [...p.matchAll(/^i=(\d+) (.*)$/gm)].map((m) => (/dispute_add/.test(m[2]) ? { i: Number(m[1]), action: 'drop', reason: '非對立' } : { i: Number(m[1]), action: 'keep' })) })
        const r4 = await distillTarget({ concept: '學習率', notes: notes.slice(0, 3), settings: env.settings, ai: scriptAi({ propose: withDispute, review: dropFake }) })
        assert.deepEqual([r4.ok, r4.state.disputes.length, r4.state.claims.map((c) => c.text).sort()], [true, 0, ['其他', '大批次時要預熱', '小資料微調時可省略'].sort()])
        assert.equal(r4.batch.length, 3)
        assert.equal(r4.stats.notesUncovered || 0, 0, '筆記皆涵蓋(轉出之主張沿用其出處)')
    })

    it('絕對語氣指標(安裝方 §3 #4,只計數不擋):本次新寫入或改寫之有效主張;否定不計;只確認出處者不重計;日誌列編號與片語', async () => {
        const env = mkEnv(['t1', 't2', 't3', 't4'].map((id) => ({ id, concepts: ['學習率'] })))
        const notes = await env.stores.notes.select()
        const infos = []
        const log = { info: (m) => infos.push(m), warn: () => {}, error: () => {} }
        const propose = (p) => {
            const [a, b, c] = [...p.matchAll(/^### (N\d+) /gm)].map((m) => m[1])
            const ops = [
                { op: 'add', kind: 'rule', text: '預熱總是能穩定訓練', basis: '案例', sources: [a] },
                { op: 'add', kind: 'rule', text: '預熱不一定會提升效果', basis: '案例', sources: [b] },
                { op: 'add', kind: 'rule', text: '在一定程度上可減少發散', basis: '案例', sources: [c] },
            ]
            return { ops, skipped: [] }
        }
        const r1 = await distillTarget({ concept: '學習率', notes: notes.slice(0, 3), settings: env.settings, ai: scriptAi({ propose, review: keepAll }), log })
        assert.equal(r1.stats.absoluteTone, 1, '只計「總是」一條')
        assert.ok(infos.some((m) => m === '提煉語氣[學習率]：1 條新寫主張含絕對語氣（〔C1〕「總是」）'), infos.join('\n'))
        assert.equal(r1.state.claims.length, 3, '只計數不擋')
        const confirm = (p) => ({ ops: [{ op: 'confirm', id: 'C1', sources: [[...p.matchAll(/^### (N\d+) /gm)][0][1]] }], skipped: [] })
        const r2 = await distillTarget({ concept: '學習率', notes, state: r1.state, settings: env.settings, ai: scriptAi({ propose: confirm, review: keepAll }), log })
        assert.equal(r2.ok, true)
        assert.equal(r2.stats.absoluteTone || 0, 0, '文字未改者不重計')
    })

    it('1.x 介面於組裝期拋錯:stageDistill 之 workflow／onSeat', () => {
        assert.throws(() => stageDistill({ workflow: {} }), /opt\.workflow 已於 2\.0 移除/)
        assert.throws(() => stageDistill({ onSeat: () => {} }), /opt\.onSeat 已於 2\.0 移除/)
        assert.ok(emptyState().pendingReview, '狀態含待審欄')
    })
})
