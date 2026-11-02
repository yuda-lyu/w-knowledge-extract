// unit-extract-audit.test.mjs — 提煉檢定標準之符合度掃描(standards/audit):對象、四態、豁免、材料、範圍、AI 列、總覽之形狀
//
// 規格來源:standards/audit 檔頭【對象】【ES2／ES16 之材料】【ES5 之材料】【回報】【AI 標準】與各函數之 JSDoc;每條斷言之訊息標明所對之規格句。
// 執行:自套件根 node <mocha> test/unit-extract-audit.test.mjs(暫存落 test/_tmp/extract-audit-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不連網、不開埠)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { memStore } from './tools/captureForTest.mjs'
import { seedCore, ANN } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/core/relatePackage.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { createCoreStore, coreAuxDirs } from '../src/stores/coreStore.mjs'
import { EXHAUSTED_REASON } from '../src/stores/coreState.mjs'
import { HOLD_UNDO_HOW, HOLD_VOID_HOWS } from '../src/stores/extractHolds.mjs'
import { auditExtractStandards, extractScanOf, EXTRACT_SCAN_OBJECT, EXTRACT_AUDITED_STANDARD_IDS, EXTRACT_AI_STANDARD_IDS } from '../src/standards/audit.mjs'
import { synonymCandidatesOf } from '../src/standards/synonymCheck.mjs'
import { standardsCountsOf } from '../src/core/capturePackage.mjs'

let TMP = ''
const AT = '2026-10-11T09:00:00+08:00'
const DOMAIN = createExtractDomain({})
const REL = createRelateDomain({})
const hold = (object, oid, std, status, extra = {}) => ({ id: `${object}:${oid}:${std}`, object, oid, std, status, reason: 'r', next: 'n', owner: 'user', since: AT, at: AT, tries: 0, ctx: {}, ...extra })

/** 主核心甲之狀態:C1 合格、C2 數字不在出處(ES2)、C3 簡體(ES3)、C4 年份只見於發布時間(紮根於發布時間)、C5 失撐(ES8)、C6 隔離(ES9);逾限 n5、n6(ES15);已見衝突 e1(未處置)、e2(已交 RS4) */
function stateA() {
    const B = ['n1', 'n2', 'n3', 'n4'].map((id, k) => ({ code: `N${k + 1}`, id }))
    const s = seedCore({
        coreId: 'core-a', concept: '甲', batch: B, at: '2026-10-01T00:00:00+08:00',
        ops: [
            { op: 'add', kind: 'rule', text: '甲在 12 個月內有效', basis: '實證', sources: ['N1'], ...ANN },
            { op: 'add', kind: 'rule', text: '持有 37 個月可得益', basis: '實證', sources: ['N2'], ...ANN },
            { op: 'add', kind: 'rule', text: '成本會侵蝕收益', basis: '實證', sources: ['N1'], ...ANN },
            { op: 'add', kind: 'rule', text: '自 2024 年起成立', basis: '實證', sources: ['N2'], ...ANN },
            { op: 'add', kind: 'rule', text: '只靠丙之主張', basis: '實證', sources: ['N3'], ...ANN },
            { op: 'add', kind: 'rule', text: '長期才出現', basis: '實證', sources: ['N4'], ...ANN },
            { op: 'essence', text: '甲在 12 個月內有效', claims: ['C1'], reason: '首版' },
        ],
    })
    s.claims.find((c) => c.id === 'C3').text = '成本会侵蚀收益'
    s.withdrawn = { n3: { title: 'n3', reason: '筆記已刪除', at: AT } }
    s.held = { C6: { why: '有一席不確定', hash: 'h', at: AT } }
    s.consumed = [...new Set([...s.consumed, 'n5', 'n6'])]
    s.skipped = [...(s.skipped || []), { note: 'n5', reason: EXHAUSTED_REASON, version: s.version }, { note: 'n6', reason: EXHAUSTED_REASON, version: s.version }]
    s.seenConflicts = ['e1', 'e2']
    return s
}
const simple = (coreId, concept) => seedCore({ coreId, concept, batch: [{ code: 'N1', id: 'n1' }], at: '2026-10-01T00:00:00+08:00', ops: [{ op: 'add', kind: 'rule', text: `${concept}之規則`, basis: '實證', sources: ['N1'], ...ANN }] })

let seq = 0
/** 建一個掃描環境(主核心甲、分身、類別核心、已併入者、壞檔無上一版者〔乙〕、壞檔而上一版在附屬目錄者〔丙〕) */
function mkEnv(o = {}) {
    const dir = `${TMP}/w${++seq}`
    const dirs = { core: `${dir}/core`, coreState: `${dir}/core`, state: `${dir}/state`, notes: `${dir}/notes` }
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
    const notes = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id, k) => {
        const file = `${dirs.notes}/${id}.md`
        const body = { n1: '甲在 12 個月內顯著', n2: '乙在長期出現' }[id] || `${id} 之內容`
        writeMd(file, { title: id }, `# ${id}\n\n## 一句話重點\n\n${id} 之重點\n\n## 核心知識\n\n- ${body}\n\n## 來源\n\n- 原文標題：${id} 之研究\n- 發布時間：2024-05-01\n`)
        return { id, file, docId: `d${k + 1}`, title: id, evidenceLevel: '中', claimType: '實證研究' }
    })
    const store = createCoreStore({ dir: dirs.coreState })
    for (const [id, st] of [['core-a', stateA()], ['core-a2', simple('core-a2', '甲')], ['core-b', { ...simple('core-b', '甲'), scope: 'category' }], ['core-m', simple('core-m', '甲')], ['core-d', simple('core-d', '丙')]]) store.save(id, st, { expectRev: null })
    fs.writeFileSync(`${dirs.coreState}/core-c.state.json`, '{壞檔', 'utf8')
    // 丙:壞檔,上一版在核心之附屬目錄(提煉段寫入 .prev 之處)→ 照掃(recovered)
    const prev = coreAuxDirs(dirs).prev
    fs.mkdirSync(prev, { recursive: true })
    fs.copyFileSync(`${dirs.coreState}/core-d.state.json`, `${prev}/core-d.state.prev.json`)
    fs.writeFileSync(`${dirs.coreState}/core-d.state.json`, '{壞檔', 'utf8')
    const cores = [
        { id: 'core-a', concept: '甲', version: 9, noteCount: 6, status: 'active' },
        { id: 'core-a2', concept: '甲', scope: 'concept', version: 1, noteCount: 1, status: 'active' },
        { id: 'core-b', concept: '甲', scope: 'category', version: 5, noteCount: 1, status: 'active' },
        { id: 'core-m', concept: '甲', version: 99, status: 'merged', mergedInto: 'core-a' },
        { id: 'core-c', concept: '乙', version: 1, status: 'active' },
        { id: 'core-d', concept: '丙', version: 1, status: 'active' },
    ]
    const edges = [
        { id: 'e1', from: 'n1', to: 'n2', type: REL.conflictType, reason: 'r' },
        { id: 'e2', from: 'n1', to: 'n4', type: REL.conflictType, reason: 'r' },
    ]
    const stores = {
        notes: memStore(notes), cores: memStore(cores), relations: memStore(edges),
        ...(o.holds === null ? {} : { holds: memStore(o.holds || [hold('edge', 'e2', 'RS4', 'open'), hold('extract-note', 'core-a:n5', 'ES15', 'resolved')]) }),
        ...(o.checks === null ? {} : { checks: memStore(o.checks || []) }),
    }
    return { dirs, stores, deps: { stores, dirs, domain: DOMAIN, relateDomain: REL } }
}
const ids = (list) => list.map((x) => x.id)

describe('unit-extract-audit', function() {

    before(() => {
        TMP = tmpRoot('extract-audit')
    })

    after(() => {
        removeRoots([TMP])
    })

    it('依賴之檢核:缺 notes／cores 集合、dirs、domain 即拋;範圍含 ES5 而缺 relations 或 relateDomain 即拋(範圍不含者不需)', async () => {
        const env = mkEnv()
        await assert.rejects(() => auditExtractStandards({ ...env.deps, stores: { notes: env.stores.notes } }), /需要 deps\.stores\.notes 與 deps\.stores\.cores/)
        await assert.rejects(() => auditExtractStandards({ ...env.deps, dirs: undefined }), /需要 deps\.dirs/)
        await assert.rejects(() => auditExtractStandards({ ...env.deps, domain: undefined }), /需要 deps\.domain（提煉 domain/)
        await assert.rejects(() => auditExtractStandards({ ...env.deps, relateDomain: undefined }), /ES5 需要 deps\.stores\.relations（具 select 方法）與 deps\.relateDomain/)
        const r = await auditExtractStandards({ ...env.deps, relateDomain: undefined, stores: { ...env.stores, relations: undefined } }, { only: ['ES3'] })
        assert.deepEqual(Object.keys(r.standards), ['ES3'], '範圍不含 ES5 → 不需邊與關聯 domain')
    })

    it('對象:只掃主核心(概念層與類別層;分身、已併入者不掃——與四專步同一範圍,終審 §3 D5m);壞檔而無上一版 → 範圍內全部標準記未能判定(id＝核心 id);壞檔而上一版救得回 → 照掃', async () => {
        const env = mkEnv()
        const r = await auditExtractStandards(env.deps)
        assert.equal(r.counts.cores, 3, '甲、類別層之甲、丙(救回)')
        for (const id of EXTRACT_AUDITED_STANDARD_IDS) {
            const b = r.standards[id]
            // 未能判定之原因取核心儲存之四態分流表(loadUsable 之 why)
            assert.ok(b.undetermineds.some((x) => x.id === 'core-c' && x.detail.startsWith('狀態檔毀損且無上一版可還原（')), `${id}:乙記未能判定`)
            for (const k of ['violations', 'undetermineds', 'waiveds']) assert.ok(!b[k].some((x) => /^core-(a2|m)\b/.test(x.id)), `${id}.${k}:分身、已併入者不掃`)
        }
        assert.ok(r.standards.ES6.violations.some((x) => x.id === 'core-d'), '丙照掃(有主張而無本質)')
        assert.ok(r.standards.ES6.violations.some((x) => x.id === 'core-b'), '類別層之主核心照掃')
    })

    it('四態與 id:ES2 數字不在出處 → 違反、發布時間亦為材料;ES3 簡體 → 違反;ES8 失撐、ES9 隔離 → 未能判定;ES15 有登錄(任一狀態)者合格、無者違反;ES5 未處置者違反、已交 RS4 者合格;id 為「核心#條目」', async () => {
        const env = mkEnv()
        const S = (await auditExtractStandards(env.deps)).standards
        assert.deepEqual(ids(S.ES2.violations), ['core-a#C2'], '37 不在 n2')
        assert.match(S.ES2.violations[0].detail, /所引出處無之數字：37/)
        assert.ok(!S.ES2.violations.some((x) => x.id === 'core-a#C4') && !S.ES2.undetermineds.some((x) => x.id === 'core-a#C4'), '2024 見於出處之發布時間 → 紮根')
        assert.deepEqual(ids(S.ES3.violations), ['core-a#C3'])
        assert.deepEqual(ids(S.ES8.undetermineds).filter((x) => x.startsWith('core-a')), ['core-a#C5'])
        assert.deepEqual(ids(S.ES9.undetermineds).filter((x) => x.startsWith('core-a')), ['core-a#C6'])
        assert.deepEqual([ids(S.ES15.violations), S.ES15.pass], [['core-a#n6'], 1], 'n5 之登錄已結案亦算有登錄')
        assert.deepEqual([ids(S.ES5.violations), S.ES5.pass], [['core-a#e1'], 1], 'e2 已交 RS4')
        assert.ok(S.ES1.pass > 0 && S.ES1.total === S.ES1.pass + S.ES1.violation + S.ES1.undetermined + S.ES1.na + S.ES1.waived, '計數相加＝總量')
        // 「登錄從未對應一次完成之落盤」之結案(落盤失敗之撤銷、清掃之落盤未完成)等於沒登錄 → 違反
        const voided = mkEnv({ holds: [hold('edge', 'e2', 'RS4', 'open'), hold('extract-note', 'core-a:n5', 'ES15', 'resolved', { how: HOLD_UNDO_HOW }), hold('extract-note', 'core-a:n6', 'ES15', 'resolved', { how: HOLD_VOID_HOWS[1] })] })
        const V = (await auditExtractStandards(voided.deps, { only: ['ES15'] })).standards.ES15
        assert.deepEqual([ids(V.violations), V.pass], [['core-a#n5', 'core-a#n6'], 0])
    })

    it('豁免:條目層(主張之 ES9 待判豁免)與核心層(core:<核心>:<標準>——該核心該標準之全部判定)記已豁免、不算違反;未給待判集合 → ES15 未能判定', async () => {
        const env = mkEnv({ holds: [hold('edge', 'e2', 'RS4', 'open'), hold('claim', 'core-a:C6', 'ES9', 'waived'), hold('core', 'core-a', 'ES3', 'waived'), hold('extract-note', 'core-a:n6', 'ES15', 'open'), hold('extract-note', 'core-a:n5', 'ES15', 'waived')] })
        const S = (await auditExtractStandards(env.deps)).standards
        assert.deepEqual([ids(S.ES9.waiveds), ids(S.ES9.undetermineds).filter((x) => x.startsWith('core-a'))], [['core-a#C6'], []], '主張層之豁免')
        assert.deepEqual([ids(S.ES3.waiveds), S.ES3.violation], [['core-a#C3'], 0], '核心層之豁免適用於該核心之條目')
        assert.deepEqual([S.ES15.violation, S.ES15.pass], [0, 2])
        const none = (await auditExtractStandards(mkEnv({ holds: null }).deps, { only: ['ES15'] })).standards.ES15
        assert.deepEqual([none.undetermineds.filter((x) => x.id.startsWith('core-a')).map((x) => x.detail), none.pass], [['未給待判登錄', '未給待判登錄'], 0])
    })

    it('材料:material:false → 含數字者記未能判定並註明、無數字者照判;給 materialOf 者以之為準(不讀 md);給 onNote 者全量走訪、每篇讀得到 md 者回呼一次;範圍不含 ES2／ES16 者不讀', async () => {
        const env = mkEnv()
        const nm = (await auditExtractStandards(env.deps, { only: ['ES2'], material: false })).standards.ES2
        assert.ok(nm.undetermineds.some((x) => x.id === 'core-a#C1' && x.detail === '未讀筆記材料（material:false），數字紮根無從判定'))
        assert.ok(!nm.undetermineds.some((x) => x.id === 'core-a#C3') && nm.pass > 0, '無數字者照判')
        const seen = []
        const mo = (await auditExtractStandards(env.deps, { only: ['ES2'], material: false, materialOf: (n) => (seen.push(n.id), `${n.id} 之內容 12 37 2024`) })).standards.ES2
        assert.deepEqual([...mo.violations, ...mo.undetermineds].filter((x) => x.id.startsWith('core-a')), [], 'materialOf 之材料涵蓋各數字(乙之壞檔另記未能判定)')
        assert.ok(seen.length > 0)
        const visited = []
        await auditExtractStandards(env.deps, { only: ['ES2'], onNote: (n, md) => visited.push([n.id, typeof md.body]) })
        assert.deepEqual(visited.map((x) => x[0]).sort(), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'], 'onNote:全量走訪')
        const v2 = []
        await auditExtractStandards(env.deps, { only: ['ES3'], onNote: (n) => v2.push(n.id) })
        assert.deepEqual(v2, [], '範圍不含 ES2／ES16 → 不走訪')
    })

    it('範圍與上限:only 只跑所列(不認得之 id 略過;AI 列亦依範圍);maxIds 限每態列出之 id 數(計數不受影響)', async () => {
        const env = mkEnv()
        const r = await auditExtractStandards(env.deps, { only: ['ES3', 'ES9', 'XX9'] })
        assert.deepEqual([Object.keys(r.standards), Object.keys(r.ai)], [['ES3', 'ES9'], ['ES9']])
        const r0 = await auditExtractStandards(env.deps, { only: ['ES8'], maxIds: 0 })
        assert.deepEqual([r0.standards.ES8.undetermined > 0, r0.standards.ES8.undetermineds], [true, []])
        const rx = await auditExtractStandards(env.deps, { only: ['ES3'] })
        assert.equal(rx.ai, undefined, '範圍無 AI 標準 → 無 ai 欄')
    })

    it('AI 列:檢核紀錄之已檢、四態、版本過時;待判之未結與已豁免;ES9／ES8 之受檢總量與到期數(與專步同一函數);來源集合未給之欄為 null、皆未給之列為 null(ES14 之來源為狀態,恆有列)', async () => {
        const checks = [
            { id: 'claim:core-a:C1', object: 'claim', oid: 'core-a:C1', hash: 'x', results: { ES9: { v: 2, at: AT, status: 'pass', seats: 'a|b', reason: '' } } },
            { id: 'claim:core-a:C2', object: 'claim', oid: 'core-a:C2', hash: 'x', results: { ES9: { v: 1, at: AT, status: 'violation', seats: 'a|b', reason: '' } } },
            { id: 'dispute:core-a:D1', object: 'dispute', oid: 'core-a:D1', hash: 'x', results: { ES14: { v: 1, at: AT, status: 'undetermined', seats: 'a|b', reason: '' } } },
        ]
        const holds = [hold('dispute', 'core-a:D1', 'ES14', 'open'), hold('core-pair', '甲|乙', 'ES11', 'waived')]
        const env = mkEnv({ checks, holds })
        const r = await auditExtractStandards(env.deps)
        assert.deepEqual(Object.keys(r.ai), ['ES8', 'ES9', 'ES11', 'ES14'])
        const a9 = r.ai.ES9
        assert.deepEqual([a9.checked, a9.pass, a9.violation, a9.stale, a9.holdsOpen], [2, 1, 1, 1, 0])
        assert.ok(a9.total >= 5 && a9.due >= 1, `ES9 之受檢總量與到期數:${a9.total}／${a9.due}`)
        assert.equal(r.ai.ES8.total, 1, '失撐而非隔離之有效主張(C5)')
        assert.deepEqual([r.ai.ES14.checked, r.ai.ES14.undetermined, r.ai.ES14.total, r.ai.ES14.holdsOpen], [0, 0, 0, 1], 'ES14 之判定只在狀態之 doubtChecks:檢核紀錄之 ES14 列不計(單一真理,終審 §3 D5g);待判仍計')
        assert.deepEqual([r.ai.ES11.checked, r.ai.ES11.holdsWaived, r.ai.ES11.total, r.ai.ES11.due], [0, 1, 0, 0], '單字之名無候選')
        assert.equal(r.checksRead, true)
        const noChecks = await auditExtractStandards(mkEnv({ checks: null, holds }).deps, { only: ['ES14', 'ES11'] })
        assert.deepEqual([noChecks.ai.ES14.checked, noChecks.ai.ES14.holdsOpen, noChecks.ai.ES11.checked, noChecks.ai.ES11.total, noChecks.checksRead], [0, 1, null, undefined, false], '無 checks → 檢核之欄為 null、受檢總量不附;ES14 由狀態推得照算')
        const neither = await auditExtractStandards(mkEnv({ checks: null, holds: null }).deps, { only: ['ES14', 'ES11'] })
        assert.deepEqual([neither.ai.ES11, neither.ai.ES14.checked, neither.ai.ES14.holdsOpen], [null, 0, null], '來源集合皆未給 → 列為 null;ES14 之來源為核心狀態 → 恆有列,待判之欄為 null')
    })

    it('ES14 列由狀態推得(與專步同一判定):已檢＝doubtChecks 筆數、合格＝現版判對立、版本過時＝舊版;受檢＝未解決且帶存疑;到期不計待判中、已豁免而無新存疑者;門檻取 opt.disputeCheck', async () => {
        const env = mkEnv({ checks: [], holds: [] })
        const store = createCoreStore({ dir: env.dirs.coreState })
        const r0 = store.loadUsable('core-a')
        const s = r0.state
        s.disputes = [
            { id: 'D1', status: 'open', question: '甲是否有效', sides: [{ position: '有效', sources: ['n1'] }, { position: '無效', sources: ['n2'] }], doubt: { version: 3, at: '2026-09-01T00:00:00+08:00', count: 1, reason: '非對立' } },
            { id: 'D2', status: 'open', question: '乙是否有效', sides: [{ position: '有效', sources: ['n1'] }, { position: '無效', sources: ['n2'] }], doubt: { version: 9, at: '2026-10-10T00:00:00+08:00', count: 1, reason: '非對立' } },
            { id: 'D3', status: 'open', question: '無存疑', sides: [{ position: 'a' }, { position: 'b' }] },
        ]
        s.doubtChecks = { D0: { v: 1, verdict: 'opposed', doubtVersion: 1, doubtCount: 1, hash: 'h' }, D9: { v: 0, verdict: 'opposed', doubtVersion: 1, doubtCount: 1, hash: 'h' } }
        store.save('core-a', s, { expectRev: r0.expectRev })
        const nowMs = Date.parse(AT)
        const a = (await auditExtractStandards(env.deps, { only: ['ES14'], nowMs })).ai.ES14
        assert.deepEqual([a.checked, a.pass, a.stale, a.total, a.due, a.holdsOpen], [2, 1, 1, 2, 1, 0], 'D1 存疑逾 7 天且核心已再升版 → 到期;D2 剛存疑且版差 0 → 未到期;D3 無存疑不計')
        const b = (await auditExtractStandards(env.deps, { only: ['ES14'], nowMs, disputeCheck: { minVersions: 0, waitDays: 0 } })).ai.ES14
        assert.deepEqual([b.total, b.due], [2, 2], '門檻取 opt.disputeCheck')
        // 待判中(未要求重試)、已豁免且存疑時刻不晚於豁免 → 不計到期;豁免後有新存疑 → 計
        env.stores.holds = memStore([hold('dispute', 'core-a:D1', 'ES14', 'open'), hold('dispute', 'core-a:D2', 'ES14', 'waived', { waivedAt: '2026-10-11T00:00:00+08:00' })])
        const c = (await auditExtractStandards(env.deps, { only: ['ES14'], nowMs, disputeCheck: { minVersions: 0, waitDays: 0 } })).ai.ES14
        assert.deepEqual([c.total, c.due, c.holdsOpen, c.holdsWaived], [2, 0, 1, 1])
        env.stores.holds = memStore([hold('dispute', 'core-a:D2', 'ES14', 'waived', { waivedAt: '2026-10-09T00:00:00+08:00' })])
        const d = (await auditExtractStandards(env.deps, { only: ['ES14'], nowMs, disputeCheck: { minVersions: 0, waitDays: 0 } })).ai.ES14
        assert.deepEqual([d.due, d.holdsWaived], [2, 1], '豁免後之新存疑照常到期')
    })

    it('ES11 列之受檢總量與到期數(與專步同一函數):候選＝名稱相近 ∪ 已存之提議;到期不計待判中(使用者)、已判同素材、已豁免且素材未變者', async () => {
        const env = mkEnv({ checks: [], holds: [] })
        const store = createCoreStore({ dir: env.dirs.coreState })
        for (const [id, concept] of [['core-x', '動量策略'], ['core-y', '動量策略法'], ['core-z', '統計套利']]) store.save(id, simple(id, concept), { expectRev: null })
        const cores = [...(await env.stores.cores.select()), ...[['core-x', '動量策略'], ['core-y', '動量策略法'], ['core-z', '統計套利']].map(([id, concept]) => ({ id, concept, version: 1, noteCount: 1, status: 'active' }))]
        env.stores.cores = memStore(cores)
        const key = '動量策略 ⇄ 動量策略法'
        const a = (await auditExtractStandards(env.deps, { only: ['ES11'] })).ai.ES11
        assert.deepEqual([a.total, a.due, a.checked], [1, 1, 0], '名稱包含 → 候選一對、未判 → 到期')
        // 已存之提議(名單未變)併入候選
        fs.writeFileSync(`${env.dirs.state}/extract-synonym.json`, JSON.stringify({ v: 1, namesHash: 'stale', at: AT, pairs: [{ a: '統計套利', b: '動量策略', by: 'propose' }] }), 'utf8')
        assert.equal((await auditExtractStandards(env.deps, { only: ['ES11'] })).ai.ES11.total, 1, '名單雜湊不符之提議不算')
        const sc0 = synonymCandidatesOf({ cores, loadUsable: (id) => store.loadUsable(id), notesById: new Map(), stateDir: env.dirs.state })
        assert.deepEqual(sc0.names, ['丙', '乙', '動量策略', '動量策略法', '甲', '統計套利'], '主核心之名(分身、已併入者不算;類別層與壞檔者算)')
        fs.writeFileSync(`${env.dirs.state}/extract-synonym.json`, JSON.stringify({ v: 1, namesHash: sc0.namesHash, at: AT, pairs: [{ a: '動量策略', b: '統計套利', by: 'propose' }] }), 'utf8')
        const b = (await auditExtractStandards(env.deps, { only: ['ES11'] })).ai.ES11
        assert.deepEqual([b.total, b.due], [2, 2], '名單同雜湊之提議併入')
        // 待判中(使用者)不計;已判同素材不計;已豁免且素材未變不計
        const sc = synonymCandidatesOf({ cores, loadUsable: (id) => store.loadUsable(id), notesById: new Map(), stateDir: env.dirs.state })
        const h = sc.hashOf(sc.cand.get(key))
        env.stores.holds = memStore([hold('core-pair', key, 'ES11', 'open', { owner: 'user' })])
        assert.equal((await auditExtractStandards(env.deps, { only: ['ES11'] })).ai.ES11.due, 1, '待判中(使用者)不計')
        env.stores.holds = memStore([hold('core-pair', key, 'ES11', 'waived', { ctx: { hash: h } })])
        env.stores.checks = memStore([{ id: `core-pair:${key}`, object: 'core-pair', oid: key, hash: h, results: { ES11: { v: 1, at: AT, status: 'pass', seats: 'a|b', reason: '' } } }])
        const c = (await auditExtractStandards(env.deps, { only: ['ES11'] })).ai.ES11
        assert.deepEqual([c.checked, c.pass, c.due, c.holdsWaived], [1, 1, 1, 1], '已判同素材不計')
        env.stores.checks = memStore([{ id: `core-pair:${key}`, object: 'core-pair', oid: key, hash: 'other', results: { ES11: { v: 1, at: AT, status: 'pass', seats: 'a|b', reason: '' } } }])
        assert.equal((await auditExtractStandards(env.deps, { only: ['ES11'] })).ai.ES11.due, 1, '素材變但已豁免且豁免時之素材雜湊＝現雜湊 → 不計')
        env.stores.holds = memStore([hold('core-pair', key, 'ES11', 'waived', { ctx: { hash: 'old' } })])
        assert.equal((await auditExtractStandards(env.deps, { only: ['ES11'] })).ai.ES11.due, 2, '豁免時之素材已變 → 計')
    })

    it('總覽之形狀:extractScanOf 把標準列之對象改為 cores、AI 列之 null 補 0、全零之列與 null 列不列(ES9／ES8 之受檢總量或到期數非零即列);計數摘要(抓取套件之 standardsCountsOf)之計數與 AI 列', async () => {
        const env = mkEnv({ checks: [] })
        const rep = await auditExtractStandards(env.deps, { only: ['ES3', 'ES9', 'ES11', 'ES14'] })
        const s = extractScanOf(rep)
        assert.equal(EXTRACT_SCAN_OBJECT, 'cores')
        assert.deepEqual([s.standards.ES3.object, s.standards.ES3.module, s.counts.cores, s.checksRead], ['cores', 'extract', 3, true])
        assert.deepEqual(Object.keys(s.ai), ['ES9'], 'ES11／ES14 全零不列;ES9 有受檢總量即列')
        assert.ok(s.ai.ES9.total > 0 && s.ai.ES9.checked === 0 && s.ai.ES9.v === 2)
        const c = standardsCountsOf(s, { at: 'T', ms: 3 })
        assert.deepEqual([c.at, c.ms, c.counts.ES3], ['T', 3, { v: 2, total: s.standards.ES3.total, violation: 1, undetermined: s.standards.ES3.undetermined, waived: 0 }])
        assert.deepEqual(c.ai.ES9, { holdsOpen: 0, total: s.ai.ES9.total, due: s.ai.ES9.due })
        assert.deepEqual(extractScanOf(null), { counts: { cores: 0 }, standards: {}, ai: {}, checksRead: false })
        assert.deepEqual(EXTRACT_AI_STANDARD_IDS, ['ES8', 'ES9', 'ES11', 'ES14'])
    })
})
