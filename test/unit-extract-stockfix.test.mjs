// unit-extract-stockfix.test.mjs — 核心之存量處置:coreFixOf 之直接案、預演／套用／連鎖斷言／回退、修不了者之登錄、已不再違反者之結案、
//   邊庫快照之連鎖處理器、處置帳之讀法
//
// 規格來源:standards/coreStockFix 與 standards/stockFix 之檔頭與 JSDoc;每條斷言之訊息標明所對之規格句。
// 執行:自套件根 node <mocha> test/unit-extract-stockfix.test.mjs(暫存落 test/_tmp/extract-stockfix-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不連網、不開埠)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore, STOCK_LEDGER_FILE, silentLog } from './tools/captureForTest.mjs'
import { seedCore, readState, ANN } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots, PKG_ROOT } from './tools/extractTestKit.mjs'
import { coreVersionsByProvenance } from '../src/ops/coreVersionsByProvenance.mjs'
import { writeMd, readMd } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/core/relatePackage.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { createCoreStore, coreAuxDirs } from '../src/stores/coreStore.mjs'
import { EXTRACT_HOLD_NEXT, extractHoldDeadlineOf } from '../src/stores/extractHolds.mjs'
import { coreFixOf, CORE_FIX_STDS, stateFingerprintOf } from '../src/standards/coreStockFix.mjs'
import { edgeSigOf, EDGE_SEEN_FILE } from '../src/standards/relationImpact.mjs'
import {
    planCoreStockFix, applyCoreStockFix, verifyCoreStockChain, readCoreStockLedger, rollbackCoreStockFix, edgeSeenSyncOf,
    CORE_FIX_STDS as FIX_FROM_STOCK, STOCK_STDS,
} from '../src/standards/stockFix.mjs'

let TMP = ''
const AT = '2026-10-11T09:00:00+08:00'
const AT2 = '2026-10-11T10:00:00+08:00'
const clockAt = (iso) => ({ iso8: () => iso, stamp8: () => iso.replace(/\D/g, '').slice(0, 14), date8: () => iso.slice(0, 10) })
const DOMAIN = createExtractDomain({})
const REL = createRelateDomain({})
const clone = (v) => JSON.parse(JSON.stringify(v))

/** 甲:C1 簡體、爭議 D1 之一方簡體、本質簡體(ES3);已見衝突 e1 未處置(ES5)、e2 由 D1 兩方處置、e3 已交 RS4 */
function stateA() {
    const B = ['n1', 'n2', 'n3'].map((id, k) => ({ code: `N${k + 1}`, id }))
    const s = seedCore({
        coreId: 'core-a', concept: '甲', batch: B, at: '2026-10-01T00:00:00+08:00',
        ops: [
            { op: 'add', kind: 'rule', text: '成本會侵蝕收益', basis: '實證', sources: ['N1'], ...ANN },
            { op: 'add', kind: 'rule', text: '長期才出現', basis: '實證', sources: ['N2'], ...ANN },
            { op: 'add', kind: 'rule', text: '丙之規則', basis: '實證', sources: ['N3'], ...ANN },
            { op: 'dispute_add', question: '是否持續', sides: [{ position: '持續', claims: ['C1'] }, { position: '會反轉', basis: '實證', sources: ['N2'] }] },
            { op: 'essence', text: '成本會侵蝕收益', claims: ['C1'], reason: '首版' },
        ],
    })
    s.claims[0].text = '成本会侵蚀收益'
    s.disputes[0].sides[1].position = '会反转'
    s.essence.text = '成本会侵蚀收益'
    s.seenConflicts = ['e1', 'e2', 'e3']
    return s
}
const simple = (coreId, concept) => seedCore({ coreId, concept, batch: [{ code: 'N1', id: 'n1' }], at: '2026-10-01T00:00:00+08:00', ops: [{ op: 'add', kind: 'rule', text: `${concept}之規則`, basis: '實證', sources: ['N1'], ...ANN }, { op: 'essence', text: `${concept}之本質`, claims: ['C1'], reason: '首版' }] })

let seq = 0
function mkEnv(o = {}) {
    const dir = `${TMP}/w${++seq}`
    const dirs = { core: `${dir}/core`, coreState: `${dir}/core`, state: `${dir}/state`, notes: `${dir}/notes` }
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
    const notes = ['n1', 'n2', 'n3'].map((id, k) => {
        const file = `${dirs.notes}/${id}.md`
        writeMd(file, { title: id }, `# ${id}\n\n## 一句話重點\n\n${id} 之重點\n\n## 核心知識\n\n- ${id} 之知識\n`)
        return { id, file, docId: `d${k + 1}`, title: id, evidenceLevel: '中', claimType: '實證研究', extractedAt: AT }
    })
    const store = createCoreStore({ dir: dirs.coreState })
    const put = (id, st) => {
        store.save(id, st, { expectRev: null })
        writeMd(`${dirs.core}/${id}.md`, { concept: st.concept }, `# 核心知識：${st.concept}\n`)
    }
    put('core-a', stateA())
    put('core-b', simple('core-b', '乙'))
    const cores = [
        { id: 'core-a', concept: '甲', version: 9, noteCount: 3, file: `${dirs.core}/core-a.md`, status: 'active' },
        { id: 'core-b', concept: '乙', version: 1, noteCount: 1, file: `${dirs.core}/core-b.md`, status: 'active' },
    ]
    if (o.corrupt) {
        fs.writeFileSync(`${dirs.coreState}/core-c.state.json`, '{壞檔', 'utf8')
        cores.push({ id: 'core-c', concept: '丙', version: 1, file: `${dirs.core}/core-c.md`, status: 'active' })
    }
    const edges = [
        { id: 'e1', from: 'n1', to: 'n3', type: REL.conflictType, reason: 'r' },
        { id: 'e2', from: 'n1', to: 'n2', type: REL.conflictType, reason: 'r' },
        { id: 'e3', from: 'n2', to: 'n3', type: REL.conflictType, reason: 'r' },
    ]
    const holds = o.holds === null ? undefined : memStore(o.holds || [{ id: 'edge:e3:RS4', object: 'edge', oid: 'e3', std: 'RS4', status: 'open', reason: 'r', next: 'n', owner: 'pipeline', since: AT, at: AT, tries: 0, ctx: {} }])
    const stores = { notes: memStore(notes), cores: memStore(cores), relations: memStore(edges), ...(holds ? { holds } : {}) }
    return { dirs, stores, deps: { stores, dirs, domain: DOMAIN, relateDomain: REL, clock: clockAt(AT), log: silentLog }, ledger: path.join(dirs.state, STOCK_LEDGER_FILE) }
}
const derivedFree = (s) => {
    const t = clone(s)
    for (const k of ['claims', 'parameters', 'disputes']) for (const x of t[k] || []) {
        delete x.evidence
        for (const sd of x.sides || []) delete sd.evidence
    }
    return { ...t, rev: undefined, renderHashes: undefined }
}
const openHold = (object, oid, std) => ({ id: `${object}:${oid}:${std}`, object, oid, std, status: 'open', reason: 'r', next: 'n', owner: 'user', since: AT, at: AT, tries: 0, ctx: {} })

describe('unit-extract-stockfix', function() {

    before(() => {
        TMP = tmpRoot('extract-stockfix')
    })

    after(() => {
        removeRoots([TMP])
    })

    describe('coreFixOf(純函數)', function() {

        it('ES3:非終態條目、爭議之方與本質之簡體只改違規處;[[連結]] 與網址不轉;條目沿革記存量處置、升一版、changelog 記 stock-fix;本質之改寫入本質沿革;終態條目、已撤回之爭議不動', () => {
            const s = stateA()
            s.claims[1].text = '长期才出现[[n2]] https://x.cn/后'
            s.claims.push({ ...clone(s.claims[1]), id: 'C9', text: '已撤回之简体', status: 'retracted', retractReason: '離題', statusNote: '離題' })
            const r = coreFixOf(s, { stds: ['ES3'], at: AT })
            const c = (id) => r.state.claims.find((x) => x.id === id)
            assert.deepEqual([c('C1').text, c('C2').text, r.state.disputes[0].sides[1].position, r.state.essence.text], ['成本會侵蝕收益', '長期才出現[[n2]] https://x.cn/后', '會反轉', '成本會侵蝕收益'])
            assert.equal(c('C9').text, '已撤回之简体', '終態條目不動')
            assert.deepEqual(r.changes.map((x) => [x.std, x.id]), [['ES3', 'C1'], ['ES3', 'C2'], ['ES3', 'D1'], ['ES3', 'essence']])
            assert.match(r.changes.find((x) => x.id === 'D1').what, /sides\[1\]\.position 轉正體/)
            assert.deepEqual([r.state.version, r.bumped, r.touched], [s.version + 1, true, ['C1', 'C2', 'D1']])
            assert.deepEqual([c('C1').history.at(-1).op, r.state.changelog.at(-1).mode, r.state.changelog.at(-1).items], ['stock-fix', 'stock-fix', ['C1', 'C2', 'D1', 'essence']])
            assert.deepEqual(r.state.essenceHistory.at(-1).text, '成本会侵蚀收益', '本質之改寫入本質沿革')
            assert.equal(s.claims[0].text, '成本会侵蚀收益', '不修改輸入')
        })

        it('ES5:已見而無去向之衝突移出已見(不升版);已處置(爭議兩方)與已交 RS4 者留存;未給 conflictEndsOf 者不處置;stds 只給 ES3 者不處置 ES5;無變更者回原物件', () => {
            const s = stateA()
            const ctx = { conflictEndsOf: (id) => ({ e1: ['n1', 'n3'], e2: ['n1', 'n2'], e3: ['n2', 'n3'] })[id] || null, rs4HeldOf: (id) => id === 'e3' }
            const r = coreFixOf(s, { stds: ['ES5'], at: AT, ...ctx })
            assert.deepEqual([r.state.seenConflicts, r.seenRemoved, r.bumped, r.state.version], [['e2', 'e3'], ['e1'], false, s.version])
            assert.match(r.changes[0].what, /衝突（n1 ⇄ n3）移出已見/)
            assert.equal(coreFixOf(s, { stds: ['ES5'] }).changes.length, 0, '未給 conflictEndsOf → 不處置')
            assert.deepEqual(coreFixOf(s, { stds: ['ES3'], ...ctx }).seenRemoved, [], '只給 ES3')
            const clean = simple('core-b', '乙')
            const same = coreFixOf(clean, { at: AT, ...ctx })
            assert.deepEqual([same.state === clean, same.changes], [true, []])
            assert.equal(FIX_FROM_STOCK, CORE_FIX_STDS, '存量處置模組轉出同一實體')
        })
    })

    describe('預演／套用／連鎖斷言／回退', function() {

        it('預演:列出各核心之處置(掃描之違反、修法、計數);ids 只處置所列;limit 為每種修正組合之核心數;不寫任何東西', async () => {
            const env = mkEnv()
            const before = fs.readFileSync(`${env.dirs.coreState}/core-a.state.json`, 'utf8')
            const p = await planCoreStockFix(env.deps, { at: AT })
            assert.deepEqual(p.items.map((x) => [x.object, x.id, x.stds.sort()]), [['core', 'core-a', ['ES3', 'ES5']]])
            assert.deepEqual([p.counts.violations.ES3, p.counts.violations.ES5, Object.entries(p.counts.violations).filter(([k, v]) => v && !['ES3', 'ES5'].includes(k)), p.counts.fixes, p.unfixable, p.resolvable], [3, 1, [], { ES3: 1, ES5: 1 }, [], []], '違反逐條目計(主張、爭議之方、本質),修正逐核心計;範圍為掃描之全部逐件標準,其餘無違反')
            assert.deepEqual(p.stds, STOCK_STDS, '預設範圍＝掃描之逐件判定標準(可修者只 ES3／ES5,其餘之違反列修不了)')
            assert.deepEqual((await planCoreStockFix(env.deps, { ids: ['core-b'] })).items, [], 'ids')
            assert.deepEqual((await planCoreStockFix(env.deps, { stds: ['ES5', 'XX'] })).stds, ['ES5'], '不認得之標準略過')
            assert.equal(fs.readFileSync(`${env.dirs.coreState}/core-a.state.json`, 'utf8'), before, '預演不寫')
            assert.equal(fs.existsSync(env.ledger), false)
            // limit:同一修正組合(只 ES3)之核心至多 limit 個(依掃描之序)
            const sb = readState(env, 'core-b')
            sb.claims[0].text = '乙之规则'
            fs.writeFileSync(`${env.dirs.coreState}/core-b.state.json`, JSON.stringify(sb), 'utf8')
            const lim = await planCoreStockFix(env.deps, { stds: ['ES3'], limit: 1 })
            assert.deepEqual([lim.items.map((x) => x.id), lim.counts.violations.ES3], [['core-a'], 4])
            assert.deepEqual((await planCoreStockFix(env.deps, { stds: ['ES3'] })).items.map((x) => x.id), ['core-a', 'core-b'])
        })

        it('套用:經核心寫入器落盤(狀態、md、cores 記錄)、即記帳;連鎖斷言無問題;再套用同一計畫 → 現值已不須處置(stale);回退寫回處置前之狀態、附寫回退列,讀帳即排除', async () => {
            const env = mkEnv()
            const original = readState(env, 'core-a')
            const p = await planCoreStockFix(env.deps, { at: AT })
            const rows = []
            const r = await applyCoreStockFix(env.deps, p, { at: AT, onRow: (x) => rows.push(x) })
            assert.deepEqual([r.counts, r.applied, r.errors, r.stale], [{ ES3: 1, ES5: 1 }, [{ id: 'core-a', stds: ['ES3', 'ES5'] }], [], []])
            const s = readState(env, 'core-a')
            assert.deepEqual([s.claims[0].text, s.seenConflicts, s.version], ['成本會侵蝕收益', ['e2', 'e3'], original.version + 1])
            assert.match(readMd(`${env.dirs.core}/core-a.md`).body, /成本會侵蝕收益/, 'md 重新渲染')
            assert.deepEqual([(await env.stores.cores.get('core-a')).rev, (await env.stores.cores.get('core-a')).version], [s.rev, s.version], 'cores 記錄同步')
            assert.deepEqual([rows.length, r.rows.length, rows[0].object, rows[0].seq, rows[0].before.state.version, path.basename(rows[0].file), rows[0].after], [1, 1, 'core', 0, original.version, 'core-a.md', { rev: s.rev, hash: stateFingerprintOf(s) }], '帳列(先記:after＝預測之版次與內容指紋;seq 精確對應)')
            assert.deepEqual((await verifyCoreStockChain(env.deps, r.rows)).problems, [])
            assert.deepEqual((await applyCoreStockFix(env.deps, p, { at: AT2 })).stale, ['core-a'], '再套用 → stale')
            const led = readCoreStockLedger(env.ledger)
            const rb = await rollbackCoreStockFix({ ...env.deps, clock: clockAt(AT2) }, led)
            assert.deepEqual([rb.restored, rb.accepted, rb.conflicts, rb.errors], [1, 0, [], []])
            assert.deepEqual(derivedFree(readState(env, 'core-a')), derivedFree(original), '寫回處置前之狀態(衍生欄位除外)')
            assert.deepEqual(readCoreStockLedger(env.ledger), [], '已回退之列不再列出')
            // 續作(寫回後、回退列前中斷):內容已回到處置前 → 已完成,不再寫
            const rev = readState(env, 'core-a').rev
            const again = await rollbackCoreStockFix({ ...env.deps, clock: clockAt(AT2) }, r.rows)
            assert.deepEqual([again.restored, again.conflicts, again.errors, readState(env, 'core-a').rev], [1, [], [], rev])
        })

        it('產出鏈(EXT-39;stage standards-fix):套用寫入之 changelog 該筆(mode stock-fix)帶 produced——單一形(seat／provider 皆 null、無 promptFp／steps)、stamp 依 opt.stamp(輪次內給、輪次外 null)、at＝套用時刻;stamp 不合式即拋且未寫入未記帳;只移出已見(不升版)者不寫 changelog;依產出鏈取回該版(stage 選得到、provider 選不到)', async () => {
            const KEYS = ['v', 'stamp', 'stage', 'seat', 'provider', 'pkg', 'at']
            const PKG = `w-knowledge-extract@${JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version}`
            const STAMP_A = '20261108150000'
            // 輪次內(給 opt.stamp)
            const env = mkEnv()
            const r = await applyCoreStockFix(env.deps, await planCoreStockFix(env.deps, { at: AT }), { at: AT, stamp: STAMP_A })
            assert.deepEqual(r.errors, [])
            const s = readState(env, 'core-a')
            const e = s.changelog.at(-1)
            assert.deepEqual([e.mode, e.version, e.at], ['stock-fix', s.version, AT], '前提:存量處置升版並寫一筆 stock-fix')
            assert.deepEqual(Object.keys(e.produced), KEYS, '規格 §2.1 單一形')
            assert.deepEqual([e.produced.v, e.produced.stamp, e.produced.stage, e.produced.seat, e.produced.provider, e.produced.pkg, e.produced.at], [1, STAMP_A, 'standards-fix', null, null, PKG, AT])
            // 輪次外(未給 opt.stamp):stamp 為 null
            const env2 = mkEnv()
            await applyCoreStockFix(env2.deps, await planCoreStockFix(env2.deps, { at: AT }), { at: AT })
            assert.deepEqual(Object.keys(readState(env2, 'core-a').changelog.at(-1).produced), KEYS)
            assert.equal(readState(env2, 'core-a').changelog.at(-1).produced.stamp, null)
            // stamp 不合式:寫入前即拋(狀態檔不動、不記帳)
            const env3 = mkEnv()
            const plan3 = await planCoreStockFix(env3.deps, { at: AT })
            const file3 = `${env3.dirs.coreState}/core-a.state.json`
            const before3 = fs.readFileSync(file3, 'utf8')
            await assert.rejects(() => applyCoreStockFix(env3.deps, plan3, { at: AT, stamp: 'BADSTAMP' }), (x) => /invalid o\.stamp/.test(x.message) && !x.message.includes('BADSTAMP'))
            assert.deepEqual([fs.readFileSync(file3, 'utf8') === before3, fs.existsSync(env3.ledger)], [true, false], '未寫入、未記帳')
            // 只移出已見(ES5;不升版)→ 不寫 changelog(無版本可掛產出鏈)
            const env4 = mkEnv()
            const n4 = readState(env4, 'core-a').changelog.length
            const r4 = await applyCoreStockFix(env4.deps, await planCoreStockFix(env4.deps, { at: AT, stds: ['ES5'] }), { at: AT, stamp: STAMP_A })
            assert.deepEqual([r4.errors, r4.applied.length, readState(env4, 'core-a').changelog.length], [[], 1, n4], '只改記帳欄位,不升版、不寫沿革')
            // 依產出鏈取回:stage 選得到該版、起草席成交者選不到、不呼叫 AI(provider null)選得到
            const q = (o) => coreVersionsByProvenance(env.stores, { dirs: env.dirs, ...o })
            assert.deepEqual((await q({ stage: 'standards-fix' })).map((x) => [x.concept, x.version]), [['甲', s.version]])
            assert.deepEqual((await q({ stage: 'standards-fix', stamp: STAMP_A })).map((x) => x.version), [s.version])
            assert.deepEqual((await q({ stage: 'standards-fix', stamp: '20200101000000' })).map((x) => x.version), [])
            assert.deepEqual((await q({ provider: 'stub-d1' })).map((x) => x.version), [], '成交者選不到不呼叫 AI 之版本')
            assert.deepEqual((await q({ provider: null })).map((x) => x.version), [s.version])
        })

        it('回退＝撤銷:其後被改寫(版次≠處置後)→ 衝突、不覆寫、不記回退列(仍列於帳);acceptCurrent 記取代列;核心已不在 → 衝突;缺 after 之列即錯', async () => {
            const env = mkEnv()
            const r = await applyCoreStockFix(env.deps, await planCoreStockFix(env.deps, { at: AT }), { at: AT })
            const st = readState(env, 'core-a')
            const later = { ...st, claims: st.claims.map((c, k) => (k ? c : { ...c, text: '其後提煉改寫之主張' })), rev: st.rev + 1 }
            fs.writeFileSync(`${env.dirs.coreState}/core-a.state.json`, JSON.stringify(later), 'utf8')
            const rb = await rollbackCoreStockFix({ ...env.deps, clock: clockAt(AT2) }, r.rows)
            assert.deepEqual([rb.restored, rb.accepted, rb.errors, rb.conflicts], [0, 0, [], [{ id: 'core-a', object: 'core', units: ['狀態（內容指紋 ≠ 處置後之指紋）'] }]])
            assert.deepEqual([readState(env, 'core-a').claims[0].text, readCoreStockLedger(env.ledger).length], ['其後提煉改寫之主張', 1], '不覆寫;仍列於帳')
            const ok = await rollbackCoreStockFix({ ...env.deps, clock: clockAt(AT2) }, r.rows, { acceptCurrent: true })
            assert.deepEqual([ok.restored, ok.accepted, ok.conflicts, readState(env, 'core-a').claims[0].text, readCoreStockLedger(env.ledger)], [0, 1, [], '其後提煉改寫之主張', []], '接受現值:值不動、帳不再列')
            // 狀態檔遺失而上一版在 → 由上一版讀出而尚未修復:拒(不是核心不在);連上一版亦不在 → 核心不在(衝突)
            fs.rmSync(`${env.dirs.coreState}/core-a.state.json`)
            const lost = await rollbackCoreStockFix(env.deps, r.rows)
            assert.deepEqual([lost.conflicts, lost.errors.length], [[], 1])
            assert.match(lost.errors[0].error, /^核心狀態檔不可寫：狀態檔遺失，已由上一版讀出但尚未修復/)
            fs.rmSync(`${coreAuxDirs(env.dirs).prev}/core-a.state.prev.json`)
            assert.deepEqual((await rollbackCoreStockFix(env.deps, r.rows)).conflicts, [{ id: 'core-a', object: 'core', units: ['（核心不在）'] }])
            const bad = await rollbackCoreStockFix(env.deps, [{ ...r.rows[0], after: undefined }])
            assert.deepEqual(bad.errors, [{ id: 'core-a', object: 'core', error: '帳列缺 after（處置後之指紋或版次），無從判定其後是否被改寫' }])
        })

        it('連鎖斷言:核心之版號被他處覆寫 → 回報;內容被他處改寫(指紋變)→ 回報,只升 rev 不報;待判列之登錄不在 → 回報', async () => {
            const env = mkEnv()
            const r = await applyCoreStockFix(env.deps, await planCoreStockFix(env.deps, { at: AT }), { at: AT })
            const st = readState(env, 'core-a')
            fs.writeFileSync(`${env.dirs.coreState}/core-a.state.json`, JSON.stringify({ ...st, version: st.version + 5 }), 'utf8')
            assert.match((await verifyCoreStockChain(env.deps, r.rows)).problems[0], /^核心 core-a：版號 \d+ ≠ 處置後應有之 \d+（被他處覆寫？）$/)
            fs.writeFileSync(`${env.dirs.coreState}/core-a.state.json`, JSON.stringify({ ...st, seenConflicts: [...st.seenConflicts, 'e9'] }), 'utf8')
            assert.deepEqual((await verifyCoreStockChain(env.deps, r.rows)).problems, ['核心 core-a：內容指紋 ≠ 帳列之處置後指紋（被他處覆寫？）'], 'ES5 只動已見(不升版)者亦驗得出(指紋含 seenConflicts)')
            fs.writeFileSync(`${env.dirs.coreState}/core-a.state.json`, JSON.stringify({ ...st, rev: st.rev + 1 }), 'utf8')
            await env.stores.cores.replace({ ...(await env.stores.cores.get('core-a')), rev: st.rev + 1 })
            assert.deepEqual((await verifyCoreStockChain(env.deps, r.rows)).problems, [], '只升 rev(投影更新)不報')
            const v = await verifyCoreStockChain(env.deps, [{ at: AT, object: 'hold', id: 'core:core-a:ES3', stds: ['ES3'], before: {}, hold: 'core:core-a:ES3' }])
            assert.deepEqual(v.problems, ['待判 core:core-a:ES3：未登錄'])
        })

        it('修不了者:同一核心同一標準登錄一筆使用者待判(原因列各條、期限與下一步取常數)、記待判列;登錄前以現值重驗(標準,條目)——已不違反之條目不列、全不違反即不登錄(stale);已有未結或已豁免者不重登;未開 holds 集合 → errors;回退只結未結者(其後已豁免者不動)', async () => {
            const env = mkEnv()
            // 甲之 C1 仍簡體(違反)、C2 已正體(不違反);乙之 ES5 無已見衝突可違反 → 全不違反、不登錄;他模組之項略過
            const plan = { items: [], unfixable: [{ id: 'core-a#C1', std: 'ES3', detail: '轉不了甲' }, { id: 'core-a#C2', std: 'ES3', detail: '轉不了乙' }, { id: 'core-b', std: 'ES5', detail: '狀態檔 corrupt' }, { id: 'n1', std: 'SS3', detail: '他模組之項' }] }
            const r = await applyCoreStockFix(env.deps, plan, { at: AT })
            assert.deepEqual([r.held.map((x) => x.key), r.stale], [['core:core-a:ES3'], ['core:core-b:ES5']], '「以現值重驗(標準,條目):已不違反者不列,全不違反即不登錄」')
            const h = await env.stores.holds.get('core:core-a:ES3')
            assert.deepEqual([h.status, h.owner, h.next, h.deadline, h.reason], ['open', 'user', EXTRACT_HOLD_NEXT.coreStock, extractHoldDeadlineOf(AT), '存量修不了（ES3）：〔C1〕轉不了甲'])
            assert.deepEqual(r.rows.map((x) => [x.object, x.id]), [['hold', 'core:core-a:ES3']])
            assert.deepEqual((await applyCoreStockFix(env.deps, plan, { at: AT2 })).alreadyHeld, ['core:core-a:ES3'], '已有未結 → 不重登')
            await env.stores.holds.replace({ ...(await env.stores.holds.get('core:core-a:ES3')), status: 'waived', waivedBy: 'u', ruling: 'r', waivedAt: AT2 })
            const rb = await rollbackCoreStockFix({ ...env.deps, clock: clockAt(AT2) }, r.rows)
            assert.deepEqual([rb.restored, (await env.stores.holds.get('core:core-a:ES3')).status], [1, 'waived'], '回退只結未結者(其後已豁免者不動;回退列仍附寫)')
            const noHolds = mkEnv({ holds: null })
            const e = await applyCoreStockFix(noHolds.deps, { unfixable: [{ id: 'core-a#C1', std: 'ES3', detail: 'x' }] }, { at: AT })
            assert.deepEqual(e.errors, [{ id: 'core-a', object: 'core', error: '未開 holds 集合，修不了之存量未登錄待判' }])
            // 待判列以登錄鍵前綴 core: 認(不限標準):他標準之核心待判列亦為本模組之列
            const foreign = await rollbackCoreStockFix(env.deps, [{ at: AT, object: 'hold', id: 'core:core-a:ES9', stds: ['ES9'], before: { hold: null }, hold: 'core:core-a:ES9' }])
            assert.deepEqual([foreign.restored, foreign.errors], [1, []], '「待判列以 hold 鍵前綴 core: 認,不限 stds」')
        })

        it('先記後寫:帳列先於寫入(after＝預測之版次與內容指紋);寫入失敗而狀態未變 → 附寫作廢列(rollbackOfSeq 精確對應),讀帳即排除、不計已套用', async () => {
            const env = mkEnv()
            const stFile = `${env.dirs.coreState}/core-a.state.json`
            const text0 = fs.readFileSync(stFile, 'utf8')
            // 寫入前他處改動(CAS 失敗):以 cores.get 為鉤(套用於載入之後、寫入之前取記錄)
            const get = env.stores.cores.get
            env.stores.cores.get = async (id) => {
                const s = JSON.parse(fs.readFileSync(stFile, 'utf8'))
                fs.writeFileSync(stFile, JSON.stringify({ ...s, rev: s.rev + 5 }), 'utf8')
                return get(id)
            }
            const r = await applyCoreStockFix(env.deps, await planCoreStockFix(env.deps, { at: AT }), { at: AT })
            env.stores.cores.get = get
            assert.deepEqual([r.applied, r.rows.map((x) => [x.object, x.id, x.seq])], [[], [['core', 'core-a', 0]]], '帳列已記(先記)而未套用')
            assert.match(r.errors[0].error, /核心狀態已被他處改動/)
            const lines = fs.readFileSync(env.ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
            assert.deepEqual(lines.map((x) => [x.object, x.id, x.seq, x.rollbackOf, x.rollbackOfSeq, x.voided]), [['core', 'core-a', 0, undefined, undefined, undefined], ['core', 'core-a', undefined, AT, 0, 'write-failed']], '「寫入失敗而狀態未變者附寫作廢列」')
            assert.deepEqual(readCoreStockLedger(env.ledger), [], '作廢列使先記之列不再列於帳')
            assert.equal(JSON.parse(fs.readFileSync(stFile, 'utf8')).rev, JSON.parse(text0).rev + 5, '狀態為他處之值,未被覆寫')
            assert.deepEqual((await verifyCoreStockChain(env.deps, readCoreStockLedger(env.ledger))).problems, [])
        })

        it('回退判準以內容指紋為主:套用後只有投影更新(rev 升、內容不變)仍可回退;寫回前驗形(壞 before 即 errors);md 路徑取現行記錄;連鎖斷言加驗 ES3 重跑無改動與投影版號', async () => {
            const env = mkEnv()
            const r = await applyCoreStockFix(env.deps, await planCoreStockFix(env.deps, { at: AT }), { at: AT })
            const stFile = `${env.dirs.coreState}/core-a.state.json`
            const st = readState(env, 'core-a')
            // 投影更新:只升 rev、改渲染雜湊(內容不變)→ 指紋同 → 斷言仍過、回退仍寫回
            fs.writeFileSync(stFile, JSON.stringify({ ...st, rev: st.rev + 3, renderHashes: ['x'] }), 'utf8')
            await env.stores.cores.replace({ ...(await env.stores.cores.get('core-a')), rev: st.rev + 3 })
            assert.deepEqual((await verifyCoreStockChain(env.deps, r.rows)).problems, [], '「投影更新只升 rev、不改指紋」')
            // 連鎖加驗:cores 記錄之版號 ≠ 狀態 → problem;其後寫入簡體 → ES3 重跑有改動 → problem(指紋亦變)
            await env.stores.cores.replace({ ...(await env.stores.cores.get('core-a')), version: st.version + 9 })
            assert.match((await verifyCoreStockChain(env.deps, r.rows)).problems[0], /cores 記錄之版號 \d+ ≠ 狀態 \d+（投影未更新）/)
            await env.stores.cores.replace({ ...(await env.stores.cores.get('core-a')), version: st.version })
            const rb = await rollbackCoreStockFix({ ...env.deps, clock: clockAt(AT2) }, r.rows)
            assert.deepEqual([rb.restored, rb.conflicts, rb.errors], [1, [], []], '「現值仍為該次處置之結果(指紋＝after.hash)才寫回」——投影更新不礙回退')
            assert.equal(readState(env, 'core-a').claims[0].text, '成本会侵蚀收益', '寫回處置前')
            // 壞 before:寫回前驗形 → errors、不寫
            const r2 = await applyCoreStockFix(env.deps, await planCoreStockFix(env.deps, { at: AT2 }), { at: AT2 })
            const bad = { ...r2.rows[0], before: { state: { ...r2.rows[0].before.state, claims: 'x' } } }
            const rbBad = await rollbackCoreStockFix(env.deps, [bad])
            assert.deepEqual([rbBad.restored, rbBad.errors.length], [0, 1])
            assert.match(rbBad.errors[0].error, /核心狀態檔錯形狀/)
            assert.equal(readState(env, 'core-a').claims[0].text, '成本會侵蝕收益', '未寫')
            // 缺 after(指紋與版次皆無)即錯
            const noAfter = await rollbackCoreStockFix(env.deps, [{ ...r2.rows[0], after: {} }])
            assert.match(noAfter.errors[0].error, /帳列缺 after（處置後之指紋或版次）/)
        })

        it('已不再違反之未結登錄:預演須以現值重判全為合格才列;套用時再驗一次,仍違反者不結案(stale)', async () => {
            const env = mkEnv({ holds: [openHold('core', 'core-a', 'ES3')] })
            assert.deepEqual((await planCoreStockFix(env.deps, { at: AT })).resolvable, [], '甲仍違反 → 不列')
            const r = await applyCoreStockFix(env.deps, { items: [], unfixable: [], resolvable: [{ key: 'core:core-a:ES3', id: 'core-a', std: 'ES3' }] }, { at: AT })
            assert.deepEqual([r.resolved, r.stale, (await env.stores.holds.get('core:core-a:ES3')).status], [[], ['core:core-a:ES3'], 'open'], '「套用時以現值再驗一次才結案」')
        })

        it('已不再違反之未結登錄:預演列 resolvable(本次掃到之主核心、該標準無違反亦無未能判定者;壞檔之核心不列)、套用結案並記結案列;回退復原為結案前之登錄(其後已被重開者不動)', async () => {
            const env = mkEnv({ corrupt: true, holds: [openHold('core', 'core-b', 'ES3'), openHold('core', 'core-a', 'ES3'), openHold('core', 'core-c', 'ES3'), openHold('core', 'ghost', 'ES5')] })
            const p = await planCoreStockFix(env.deps, { at: AT })
            assert.deepEqual(p.resolvable, [{ key: 'core:core-b:ES3', id: 'core-b', std: 'ES3' }], '甲仍違反、丙壞檔、ghost 非現存核心 → 不列')
            const r = await applyCoreStockFix(env.deps, p, { at: AT })
            const h = await env.stores.holds.get('core:core-b:ES3')
            assert.deepEqual([r.resolved, h.status, h.how, r.counts.resolved], [['core:core-b:ES3'], 'resolved', '存量處置重掃已無此違反', 1])
            assert.deepEqual((await verifyCoreStockChain(env.deps, r.rows)).problems, [])
            const rb = await rollbackCoreStockFix({ ...env.deps, clock: clockAt(AT2) }, r.rows.filter((x) => x.object === 'hold-resolved'))
            assert.deepEqual([rb.restored, (await env.stores.holds.get('core:core-b:ES3')).status], [1, 'open'], '回退復原')
        })

        it('四態分流表:由上一版讀出而尚未修復(recovered)者進不了計畫(預演列 unreadable、不列修不了、不登錄待判);套用拒;連鎖斷言報 problem;回退拒;狀態檔與上一版皆不在者回退為核心不在(衝突)', async () => {
            const env = mkEnv()
            // 甲(有違反):主檔弄壞、留上一版(提煉段之附屬目錄)→ recovered:掃描以上一版掃到違反,但不可寫
            const prevDir = coreAuxDirs(env.dirs).prev
            fs.mkdirSync(prevDir, { recursive: true })
            fs.copyFileSync(`${env.dirs.coreState}/core-a.state.json`, `${prevDir}/core-a.state.prev.json`)
            fs.writeFileSync(`${env.dirs.coreState}/core-a.state.json`, '{壞檔', 'utf8')
            const p = await planCoreStockFix(env.deps, { at: AT })
            assert.deepEqual([p.items, p.unfixable, p.unreadable.map((u) => [u.id, u.status]), p.counts.unreadable], [[], [], [['core-a', 'recovered']], 1], '「狀態檔讀不了或尚未修復者進不了計畫:預演另列 unreadable(不列修不了、不登錄待判)」')
            assert.match(p.unreadable[0].why, /^狀態檔毀損，已由上一版讀出但尚未修復（跑一輪提煉段/)
            const r = await applyCoreStockFix(env.deps, { items: [{ object: 'core', id: 'core-a', stds: ['ES3'], changes: [] }] }, { at: AT })
            assert.deepEqual([r.applied, r.held, r.errors.map((e) => [e.id, e.object])], [[], [], [['core-a', 'core']]])
            assert.match(r.errors[0].error, /^核心狀態檔不可寫：狀態檔毀損，已由上一版讀出但尚未修復/, '「不可寫者套用拒」')
            const row = { at: AT, object: 'core', id: 'core-a', stds: ['ES3'], changes: [{ std: 'ES3' }], before: { state: stateA() }, after: { rev: 1 }, file: `${env.dirs.core}/core-a.md` }
            assert.match((await verifyCoreStockChain(env.deps, [row])).problems[0], /^核心 core-a：狀態檔毀損，已由上一版讀出但尚未修復/, '「斷言報 problem」')
            const rb = await rollbackCoreStockFix(env.deps, [row])
            assert.deepEqual([rb.restored, rb.conflicts], [0, []])
            assert.match(rb.errors[0].error, /^核心狀態檔不可寫：狀態檔毀損，已由上一版讀出但尚未修復/, '「回退拒」')
            assert.equal(fs.readFileSync(`${env.dirs.coreState}/core-a.state.json`, 'utf8'), '{壞檔', '預演、套用、斷言、回退皆不動壞檔(修復是提煉段維護之事)')
            // 狀態檔與上一版皆不在 → 核心不在(衝突,可 acceptCurrent)
            fs.rmSync(`${env.dirs.coreState}/core-a.state.json`)
            fs.rmSync(`${prevDir}/core-a.state.prev.json`)
            const gone = await rollbackCoreStockFix(env.deps, [row])
            assert.deepEqual([gone.restored, gone.errors, gone.conflicts], [0, [], [{ id: 'core-a', object: 'core', units: ['（核心不在）'] }]], '「狀態檔與上一版皆不在者為核心不在,衝突」')
        })

        it('回退逐列:他模組之列略過(restored 0、不報錯);處置帳之讀法排除他模組之列與回退列,遇無法解析之列即拋(allowBad 才略過),依 since／at 取列', async () => {
            const env = mkEnv()
            const r = await applyCoreStockFix(env.deps, await planCoreStockFix(env.deps, { at: AT }), { at: AT })
            fs.appendFileSync(env.ledger, `${JSON.stringify({ at: AT, object: 'note', id: 'n1', stds: ['SS3'], before: {} })}\n{壞行\n${JSON.stringify({ at: AT, object: 'hold', id: 'note:n1:SS3', stds: ['SS3'], hold: 'note:n1:SS3', before: {} })}\n`, 'utf8')
            assert.throws(() => readCoreStockLedger(env.ledger), /有 1 行無法解析（第 3 行：/)
            assert.deepEqual(readCoreStockLedger(env.ledger, { allowBad: true }).map((x) => x.object), ['core'])
            assert.deepEqual([readCoreStockLedger(env.ledger, { at: AT, allowBad: true }).length, readCoreStockLedger(env.ledger, { since: AT2, allowBad: true }).length], [1, 0])
            const other = await rollbackCoreStockFix(env.deps, [{ at: AT, object: 'note', id: 'n1', stds: ['SS3'], before: {} }])
            assert.deepEqual([other.restored, other.errors], [0, []])
            assert.equal(r.rows.length, 1)
            assert.deepEqual([readCoreStockLedger(undefined), readCoreStockLedger(`${env.ledger}.none`)], [[], []], '無檔回空陣列')
        })
    })

    describe('邊庫快照之連鎖處理器(edgeSeenSyncOf)', function() {

        it('字形修正:快照原與舊值同步者換為新值之簽章(回傳之 seen 併入關聯之帳列;flush 才寫回、改了才寫);不同步者不動;回退:快照仍為處置所換之值者換回;連鎖斷言比對快照與現值', async () => {
            const env = mkEnv()
            assert.throws(() => edgeSeenSyncOf({}), /edgeSeenSyncOf 需要 dirs\.state/)
            const file = path.join(env.dirs.state, EDGE_SEEN_FILE)
            const before = { id: 'e9', from: 'n1', to: 'n2', type: REL.conflictType, reason: '后来不同', updatedAt: AT }
            const after = { ...before, reason: '後來不同' }
            const other = { id: 'e8', from: 'n1', to: 'n3', type: REL.conflictType, reason: '甲', updatedAt: AT }
            fs.writeFileSync(file, JSON.stringify({ edges: { e9: edgeSigOf(before), e8: 'stale-sig' } }), 'utf8')
            const sync = edgeSeenSyncOf(env.dirs)
            const x = sync.onEdgeFixed(before, after)
            assert.deepEqual(x, { seen: { from: edgeSigOf(before), to: edgeSigOf(after) } })
            assert.equal(sync.onEdgeFixed(other, { ...other, reason: '乙' }), undefined, '不同步者不動')
            assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).edges.e9, edgeSigOf(before), 'flush 前未寫')
            assert.deepEqual([sync.flush(), sync.flush()], [true, false], '改了才寫')
            assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).edges.e9, edgeSigOf(after))
            const row = { at: AT, object: 'edge', id: 'e9', stds: ['RS3'], before: { edge: before }, ...x }
            await env.stores.relations.replace(after)
            assert.deepEqual((await verifyCoreStockChain(env.deps, [row])).problems, [], '快照已換簽章')
            sync.onEdgeRolledBack(row)
            assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).edges.e9, edgeSigOf(before), '回退換回')
            assert.deepEqual((await verifyCoreStockChain(env.deps, [row])).problems, ['邊 e9：提煉之邊庫快照未隨字形修正換簽章（下輪會產生「理由已更新」事件）'])
        })
    })
})
