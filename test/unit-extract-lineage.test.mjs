// unit-extract-lineage.test.mjs — 提煉要點 2「知識或關聯變更時更新影響範圍內之高階知識」(2026-10-04 提煉三審終審 X1′～X9′)
//   出處版本紀錄(seen／seenConflicts／首見)、撤出處與恢復(墓碑驅動、衍生、可逆)、洗白與重審撤回守門、noop 不升版、
//   內容鍵(正規化、版本、只含起草者讀得到之內容)、重審項(內容變更、新衝突)、重審入批與僅重審 pass、維護在時間守門前、投影更新寫回渲染雜湊
// 執行:自套件根 node <mocha> test/unit-extract-lineage.test.mjs(暫存落 test/_tmp/extract-lineage-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;不發網路)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore, readJsonlRows } from './tools/captureForTest.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import { programWriteProblems } from '../src/stores/coreProjection.mjs'
import { conflictDisposedOf, es5ReopenOf, es5RowsOf, normalizeConflictDecl } from '../src/standards/conflictDisposition.mjs'
import { relationContextRows } from '../src/workflow/relationContext.mjs'
import { createContentCache } from '../src/stores/contentCache.mjs'
import { recheckItemsOf, pickRecheck, recheckDue, conflictGoneOf } from '../src/standards/recheck.mjs'
import { EDGE_SEEN_FILE, IMPACT_LEDGER_FILE, edgeSnapshotOf, relationEventsOf, impactOfCore, applyImpact, impactLedgerRowsOf } from '../src/standards/relationImpact.mjs'
import { IMPACT_RETRY_FILE } from '../src/stages/extractStage.mjs'
// 關聯之件(撤邊、關聯帳、衝突事件帳、關聯 domain、刪除帳之檔名)一律經單一匯入點取自關聯套件(GEN-14):提煉讀關聯之產物,夾具以關聯之 API 造
import { retireEdge, openRelateLedgers, appendConflictEvent, DELETION_FILES } from './tools/relateForTest.mjs'
import { createRelateDomain, queueConflictCheck } from '../src/core/relatePackage.mjs'
import { previewRecheck } from '../src/ops/recheckOps.mjs'
import { requestRebaseline } from '../src/stores/rebaseline.mjs'
import { createExtractDomain, CONTENT_KEY_VERSION } from '../src/domain/extractDomain.mjs'
import { resolveExtractSettings } from '../src/core/extractSettings.mjs'
import { writeMd, readMd } from '../src/core/summarizePackage.mjs'
import { sha1 } from '../src/core/capturePackage.mjs'
import { makeEvidence } from '../src/stores/evidence.mjs'
import { applyDelta, commitBatch, coverageOf } from '../src/stores/coreDelta.mjs'
import { withdrawSources, unsupportedOf, liveSourcesOf, essenceLostOf, checkInvariants, findItem, RECHECK_SKIP_REASONS, citedNotesOf } from '../src/stores/coreState.mjs'
import { stateDigest } from '../src/stores/stateDigest.mjs'
import { pendingReviewOps } from '../src/workflow/verdicts.mjs'
import { has, readState, ledgerOf, seedCore, ANN, batchOf, draftAll, scriptAi, noteRow, writeNote, mkEnvIn, runStage } from './tools/extractKit.mjs'

let TMP = ''
const AT = '2026-10-04T09:00:00+08:00'
const clone = (v) => JSON.parse(JSON.stringify(v))
let seq = 0

// ─── 純函數之共用狀態 ───
const SEED = [{ code: 'N1', id: 'a' }, { code: 'N2', id: 'b' }, { code: 'N3', id: 'c' }]
function seedState() {
    return seedCore({
        coreId: 'k',
        concept: '動量',
        ops: [
            { op: 'add', ref: 'x', kind: 'principle', text: '只靠甲之主張', basis: '實證', sources: ['N1'] },
            { op: 'add', ref: 'y', kind: 'rule', text: '甲乙皆支持之主張', basis: '實證', sources: ['N1', 'N2'] },
            { op: 'add', ref: 'z', kind: 'pitfall', text: '只靠丙之主張', basis: '實證', sources: ['N3'] },
            { op: 'param_add', name: '期長', value: '12 個月', claim: '@x', sources: ['N1'] },
            { op: 'dispute_add', question: '甲之結論是否成立', sides: [{ position: '成立', claims: ['@x'] }, { position: '不成立', basis: '轉述', sources: ['N3'] }] },
            { op: 'essence', text: '本質文字', claims: ['@x'], reason: '首版' },
        ],
        batch: SEED,
        at: '2026-10-01T00:00:00+08:00',
    })
}
const idOf = (s, text) => s.claims.find((c) => c.text === text).id

describe('unit-extract-lineage', function() {

    before(() => {
        TMP = tmpRoot('extract-lineage')
    })
    after(() => removeRoots([TMP]))

    // ─── A. coreState:撤出處(衍生、可逆) ───

    it('撤出處:唯一出處被撤之主張失撐、參數依失撐主張亦失撐、本質待重寫(衍生);多出處者部分撤;升版並記沿革;還原即回復', () => {
        const s0 = seedState()
        const x = idOf(s0, '只靠甲之主張')
        const y = idOf(s0, '甲乙皆支持之主張')
        const w = withdrawSources(s0, { withdraw: [{ id: 'a', title: '甲篇', reason: 'deleted' }], at: AT })
        assert.equal(w.bumped, true)
        assert.equal(w.state.version, s0.version + 1)
        assert.deepEqual(w.state.changelog.at(-1).withdrawn, ['a'])
        const u = unsupportedOf(w.state)
        assert.ok(u.items.has(x), '唯一出處被撤 → 失撐')
        assert.ok(!u.items.has(y) && u.partial.has(y), '多出處者只是部分撤')
        assert.ok(u.items.has(w.state.parameters[0].id), '參數自身出處撤、所依主張失撐 → 失撐')
        assert.deepEqual(essenceLostOf(w.state, u), [x], '本質所引主張失撐 → 本質待重寫(衍生)')
        assert.equal(w.state.essence.stale, null, '不寫持久之 stale')
        assert.deepEqual(liveSourcesOf(findItem(w.state, y).item, w.state), ['b'])
        assert.deepEqual(findItem(w.state, y).item.sources, ['a', 'b'], '出處欄不動(出處只增)')
        assert.deepEqual(checkInvariants(s0, w.state, { touched: [] }), [], '撤出處不違反不變式')
        const back = withdrawSources(w.state, { restore: ['a'], at: AT })
        assert.equal(back.bumped, true)
        assert.equal(unsupportedOf(back.state).any, false, '還原即回復')
        assert.deepEqual(back.state.withdrawn, {})
    })

    it('撤出處:只影響略過(已消化未引用)之筆記 → 只記 withdrawn、不升版;未消化者不撤', () => {
        const s0 = commitBatch(seedState(), { used: [], pending: [], skipped: [{ note: 'd', reason: '離題' }], dropped: [] })
        const w = withdrawSources(s0, { withdraw: [{ id: 'd' }, { id: 'zz' }], at: AT })
        assert.equal(w.changed, true)
        assert.equal(w.bumped, false)
        assert.equal(w.state.version, s0.version)
        assert.deepEqual(Object.keys(w.state.withdrawn), ['d'], '未消化之 zz 不記')
    })

    it('洗白守門:失撐主張不得被合併、不得被新本質或新爭議方引用;同一差量內 confirm 補出處者放行', () => {
        const s0 = seedState()
        const x = idOf(s0, '只靠甲之主張')
        const y = idOf(s0, '甲乙皆支持之主張')
        const s = withdrawSources(s0, { withdraw: [{ id: 'a' }], at: AT }).state
        const B = [{ code: 'N1', id: 'n9' }]
        const merge = applyDelta(s, { ops: [{ op: 'merge', into: y, from: [x], reason: '同義' }] }, { batch: B, mode: 'consolidate', at: AT })
        assert.match(merge.rejected[0]?.reason || '', /出處已撤/)
        const ess = applyDelta(s, { ops: [{ op: 'essence', text: '新本質', claims: [x], reason: '重寫' }] }, { batch: B, mode: 'delta', at: AT })
        assert.match(ess.rejected[0]?.reason || '', /出處已撤/)
        const disp = applyDelta(s, { ops: [{ op: 'dispute_add', question: '新問', sides: [{ position: '甲', claims: [x] }, { position: '乙', sources: ['N1'] }] }] }, { batch: B, mode: 'delta', at: AT })
        assert.match(disp.rejected[0]?.reason || '', /出處已撤/)
        const ok = applyDelta(s, { ops: [{ op: 'confirm', id: x, sources: ['N1'] }, { op: 'essence', text: '新本質', claims: [x], reason: '補出處後重寫' }] }, { batch: B, mode: 'delta', at: AT })
        assert.deepEqual(ok.rejected, [], '補出處者放行')
        assert.equal(unsupportedOf(ok.state).items.has(x), false)
    })

    it('重審撤回守門:重審批內尚有他篇存活出處者不得以「無出處支持」撤回;僅以重審筆記為出處者可撤;非重審批不受影響', () => {
        const s = seedState()
        const x = idOf(s, '只靠甲之主張')
        const y = idOf(s, '甲乙皆支持之主張')
        const B = [{ code: 'N1', id: 'a' }]
        const blocked = applyDelta(s, { ops: [{ op: 'retract', id: y, reason: '無出處支持' }] }, { batch: B, mode: 'delta', at: AT, recheckIds: ['a'] })
        assert.match(blocked.rejected[0]?.reason || '', /仍有他篇出處/)
        const allowed = applyDelta(s, { ops: [{ op: 'retract', id: x, reason: '無出處支持' }] }, { batch: B, mode: 'delta', at: AT, recheckIds: ['a'] })
        assert.deepEqual(allowed.rejected, [])
        const normal = applyDelta(s, { ops: [{ op: 'retract', id: y, reason: '無出處支持' }] }, { batch: B, mode: 'delta', at: AT })
        assert.deepEqual(normal.rejected, [], '一般批維持原規則')
    })

    it('noop:confirm 之出處皆已在者不升版、不寫沿革;有實際改動才升版', () => {
        const s = seedState()
        const x = idOf(s, '只靠甲之主張')
        const B = [{ code: 'N1', id: 'a' }]
        const r = applyDelta(s, { ops: [{ op: 'confirm', id: x, sources: ['N1'] }] }, { batch: B, mode: 'delta', at: AT })
        assert.equal(r.applied[0].noop, true)
        assert.equal(r.state.version, s.version)
        assert.equal(r.state.changelog.length, s.changelog.length)
        const cov = coverageOf({ batch: B, applied: r.applied })
        assert.deepEqual(cov.used, ['a'], 'noop 之 confirm 仍算涵蓋')
    })

    it('涵蓋:重審專用略過理由只對重審筆記有效', () => {
        const B = [{ code: 'N1', id: 'a' }, { code: 'N2', id: 'b' }]
        const cov = coverageOf({ batch: B, skipped: [{ note: 'N1', reason: RECHECK_SKIP_REASONS[0] }, { note: 'N2', reason: RECHECK_SKIP_REASONS[1] }], recheckIds: ['a'] })
        assert.deepEqual(cov.skipped.map((x) => x.note), ['a'])
        assert.deepEqual(cov.badSkipped.map((x) => x.note), ['N2'])
    })

    it('涵蓋:合法理由附說明者正規化為該理由(2026-10-04 實測之形式);無分隔符、非合法開頭、一般批之裸「非對立」仍不合', () => {
        const B = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({ code: `N${i + 1}`, id }))
        const cov = coverageOf({
            batch: B,
            skipped: [
                { note: 'N1', reason: '離題：主題為擇時者情緒之逆勢短線訊號；與N7之衝突屬不同問題，非對立' },
                { note: 'N2', reason: '離題(反向VIX ETF為做空波動率之交易工具,非避險)' },
                { note: 'N3', reason: '品質不足:廠商推廣,無具體規則' },
                { note: 'N4', reason: '無可用知識（僅列舉方法名稱）' },
                { note: 'N5', reason: '離題目' },
                { note: 'N6', reason: '非對立' },
                { note: 'N7', reason: '非對立：兩方回答不同問題' },
            ],
            recheckIds: ['g'],
        })
        assert.deepEqual(cov.skipped, [{ note: 'a', reason: '離題' }, { note: 'b', reason: '離題' }, { note: 'c', reason: '品質不足' }, { note: 'd', reason: '無可用知識' }, { note: 'g', reason: '非對立' }])
        assert.deepEqual(cov.badSkipped.map((x) => x.note), ['N5', 'N6'], '無分隔符之「離題目」、一般批之裸「非對立」不收')
        assert.equal(cov.badSkipped[1].reason, '非對立', 'badSkipped 保留原文')
        assert.deepEqual(cov.uncovered, ['e', 'f'])
    })

    it('狀態摘要:無撤出處時逐字不變;有撤出處時篇數計存活出處、標失撐與部分撤、本質待重寫;marks 附註', () => {
        const s0 = seedState()
        const x = idOf(s0, '只靠甲之主張')
        const plain = stateDigest(s0)
        assert.equal(stateDigest({ ...s0, withdrawn: {} }), plain)
        const s = withdrawSources(s0, { withdraw: [{ id: 'a' }], at: AT }).state
        const d = stateDigest(s, { marks: new Map([[x, '引用重審筆記 N1']]) })
        assert.match(d, new RegExp(`〔${x}〕[^\\n]*出處 0 篇、出處已撤（待補出處）[^\\n]*｜引用重審筆記 N1`))
        assert.match(d, /出處 1 篇、部分出處已撤/)
        assert.match(d, /之出處已撤，本質待重寫/)
    })

    it('不變式:seen／withdrawn 含未消化之筆記即違反', () => {
        const s = seedState()
        const bad = { ...s, seen: { zz: { k: 'h', v: 'v' } }, withdrawn: { yy: { at: AT } } }
        const inv = checkInvariants(s, bad, { touched: [] })
        assert.ok(inv.some((x) => x.startsWith('seen 含未消化')) && inv.some((x) => x.startsWith('withdrawn 含未消化')), inv.join('；'))
    })

    it('待審:所依出處全數已撤者為陳舊項', () => {
        const s0 = seedState()
        const z = idOf(s0, '只靠丙之主張')
        const s = { ...withdrawSources(s0, { withdraw: [{ id: 'c' }], at: AT }).state, pendingReview: [{ op: { op: 'retract', id: z, reason: '離題' }, sources: ['c'], reason: '終審失敗' }] }
        const p = pendingReviewOps(s)
        assert.equal(p.ops.length, 0)
        assert.equal(p.stale.length, 1)
    })

    it('拆解爭議:自帶證據性質(轉述)之方另立主張並沿用其 basis——不併入所引主張、證據不被抬高', () => {
        const s = seedState()
        const d = s.disputes[0]
        const r = applyDelta(s, { ops: [{ op: 'dispute_dissolve', id: d.id, reason: '兩方回答不同問題', kinds: [null, 'rule'] }] }, { batch: [], mode: 'consolidate', at: AT })
        assert.deepEqual(r.rejected, [], JSON.stringify(r.rejected))
        const made = r.state.claims.find((c) => c.origin === 'dispute')
        assert.equal(made.basis, '轉述')
        const ev = makeEvidence({ levels: ['高', '中', '低'], basisCaps: { 轉述: -1, '*': 1 } })
        ev.apply(r.state, new Map([['c', { evidenceLevel: '高', claimType: '實證研究', docId: 'd1' }]]))
        assert.equal(made.evidence.level, '低', '轉述之封頂(最低)保留')
    })

    it('證據:只以存活出處計(篇數與等級)', () => {
        const s = withdrawSources(seedState(), { withdraw: [{ id: 'a' }], at: AT }).state
        const y = idOf(s, '甲乙皆支持之主張')
        makeEvidence({ levels: ['高', '中', '低'] }).apply(s, new Map([['a', { evidenceLevel: '高', docId: 'd1' }], ['b', { evidenceLevel: '低', docId: 'd2' }]]))
        assert.equal(findItem(s, y).item.evidence.level, '低', '已撤之高等級出處不計')
        assert.match(findItem(s, y).item.evidence.trace, /出處 1 篇/)
    })

    // ─── B. domain:內容鍵與渲染 ───

    it('內容鍵:CRLF／空白／衝突章／frontmatter conflicts／標題／分類不改變;正文章節(截斷內)、樣本期、品質疑慮改變即變;截斷外不變;md 讀不到為 null', () => {
        const dom = createExtractDomain({})
        const note = { id: 'n', title: 'T', claimType: '實證研究', evidenceLevel: '中', samplePeriod: '2000-2010', caveats: ['僅美股'] }
        const body = (k, extra = '') => `# T\n\n## 一句話重點\n\n重點\n\n## 核心知識\n\n- ${k}\n\n## ⚠ 衝突與反例\n\n- 與 [[x]] X：反${extra}\n`
        const key = (n, md) => dom.noteDigest(n, md, {}).contentKey
        const base = key(note, { front: { title: 'T', conflicts: [] }, body: body('知識甲') })
        assert.equal(typeof base, 'string')
        assert.equal(key(note, { front: { title: 'T', conflicts: [] }, body: body('知識甲').replace(/\n/g, '\r\n') }), base, 'CRLF')
        assert.equal(key(note, { front: { title: 'T', conflicts: [] }, body: body('知識甲').replace('- 知識甲', '-   知識甲  ') }), base, '空白')
        assert.equal(key(note, { front: { title: 'T', conflicts: ['x', 'y'] }, body: body('知識甲', '；另一衝突') }), base, '衝突章與 conflicts 為投影')
        assert.equal(key({ ...note, title: 'T2', claimType: '觀點評論', evidenceLevel: '低' }, { front: { title: 'T2', conflicts: [] }, body: body('知識甲') }), base, '標題與分類走投影更新')
        assert.notEqual(key(note, { front: { title: 'T', conflicts: [] }, body: body('知識乙') }), base, '核心知識改變')
        assert.notEqual(key({ ...note, samplePeriod: '1990-2000' }, { front: { title: 'T', conflicts: [] }, body: body('知識甲') }), base, '樣本期')
        assert.notEqual(key({ ...note, caveats: [] }, { front: { title: 'T', conflicts: [] }, body: body('知識甲') }), base, '品質疑慮')
        const long = 'x'.repeat(600)
        assert.equal(key(note, { front: { title: 'T', conflicts: [] }, body: body(`${long}甲`) }), key(note, { front: { title: 'T', conflicts: [] }, body: body(`${long}乙`) }), '截斷點之外不算')
        assert.equal(dom.noteDigest(note, null, {}).contentKey, null)
        assert.equal(dom.contentKeyVersion, CONTENT_KEY_VERSION)
    })

    it('渲染:失撐主張移至「出處已撤之條目」節、各處只列存活出處、爭議方與參數就地標示、本質待重寫呈現(衍生與持久)', () => {
        const dom = createExtractDomain({})
        const s = withdrawSources(seedState(), { withdraw: [{ id: 'a', title: '甲篇' }, { id: 'c', title: '丙篇' }], at: AT }).state
        const notesById = new Map([['b', { id: 'b', title: '乙篇', sourceName: 'S' }]])
        const { body } = dom.renderState(s, { notesById })
        assert.match(body, /## 出處已撤之條目（待重審）[\s\S]*只靠甲之主張[\s\S]*出處已撤：甲篇/)
        assert.ok(!/\[\[a\]\]/.test(body) && !/\[\[c\]\]/.test(body), '已撤出處不列')
        assert.match(body, /\[\[b\]\] 乙篇/)
        assert.match(body, /（出處已撤）/, '參數就地標示')
        assert.match(body, /出處已撤（筆記已刪除）/, '爭議方就地標示')
        assert.match(body, /> 本質待重寫：所引〔C\d+〕之出處已撤/)
        const stale = { ...seedState(), essence: { ...seedState().essence, stale: { version: 2, at: AT, from: 'C9' } } }
        assert.match(dom.renderState(stale, { notesById }).body, /> 本質待重寫：所引〔C9〕已於 v2 被取代或撤回/)
    })

    // ─── C. 內容鍵快取(stores/contentCache)與重審項(standards/recheck) ───

    it('內容鍵快取:mtime 與大小皆同即沿用(不重讀);內容變了即重算;版本不符重建;md 讀不到為 null', () => {
        const dom = createExtractDomain({})
        const dir = `${TMP}/cache${++seq}`
        fs.mkdirSync(dir, { recursive: true })
        const file = `${dir}/n.md`
        writeMd(file, { title: 'T' }, '# T\n\n## 核心知識\n\n- 甲\n')
        const note = { id: 'n', file }
        const c1 = createContentCache(`${dir}/cache.json`, dom)
        const k1 = c1.keyOf(note)
        c1.save()
        const c2 = createContentCache(`${dir}/cache.json`, dom)
        assert.equal(c2.keyOf(note), k1)
        writeMd(file, { title: 'T' }, '# T\n\n## 核心知識\n\n- 乙乙\n')
        assert.notEqual(c2.keyOf(note), k1)
        const c3 = createContentCache(`${dir}/cache.json`, { ...dom, contentKeyVersion: 'other' })
        assert.equal(c3.enabled, true)
        assert.equal(c3.keyOf({ id: 'gone', file: `${dir}/none.md` }), null)
        assert.equal(createContentCache(`${dir}/c4.json`, { ...dom, contentKeyVersion: undefined }).enabled, false, '自訂 domain 缺版本 → 停用')
        // 正文雜湊:內容章改了才變;空白差異與投影章(關聯、⚠)不變;與內容鍵版本無關
        const h1 = c3.bodyOf(note)
        assert.match(h1, /^[0-9a-f]{40}$/)
        writeMd(file, { title: 'T' }, '# T\n\n## 核心知識\n\n-  乙乙 \n\n## 關聯\n\n- [[x]]\n')
        assert.equal(c3.bodyOf(note), h1, '空白與投影章不影響')
        writeMd(file, { title: 'T' }, '# T\n\n## 核心知識\n\n- 丙\n')
        assert.notEqual(c3.bodyOf(note), h1)
        assert.equal(createContentCache(`${dir}/c5.json`, dom).bodyOf(note), c3.bodyOf(note), '與內容鍵版本無關')
    })

    it('重審項:changed 只看被有效條目引用者;conflict 以集合成員判定(未見過者)、兩端皆引用呈現較新一端、夥伴不在或讀不到者略;依序入批', () => {
        const s = { ...seedState(), seen: { a: { k: 'old', v: 'v1' }, b: { k: 'kb', v: 'v1' }, c: { k: 'kc', v: 'v1' } }, seenConflicts: ['e-seen'] }
        const notesById = new Map(['a', 'b', 'c', 'p', 'q'].map((id, i) => [id, { id, createdAt: `2026-0${i + 1}-01` }]))
        const keys = { a: 'new', b: 'kb', c: 'kc', p: 'kp', q: null }
        const items = recheckItemsOf(s, {
            notesById,
            keyOf: (id) => keys[id] ?? null,
            version: 'v1',
            conflictEdges: [
                { id: 'e-seen', from: 'a', to: 'p', updatedAt: '2026-10-01' },
                { id: 'e1', from: 'p', to: 'b', updatedAt: '2026-10-02' },
                { id: 'e2', from: 'a', to: 'c', updatedAt: '2026-10-01' },
                { id: 'e3', from: 'q', to: 'b', updatedAt: '2026-10-01' },
                { id: 'e4', from: 'r', to: 's', updatedAt: '2026-10-01' },
            ],
        })
        assert.deepEqual(items.filter((x) => x.reason === 'changed').map((x) => x.id), ['a'])
        const conf = items.filter((x) => x.reason === 'conflict')
        assert.deepEqual(conf.map((x) => [x.edgeId, x.id, x.anchor]), [['e1', 'p', 'b'], ['e2', 'c', 'a']], 'e-seen 已見、e3 夥伴讀不到、e4 不觸及');
        const pr = pickRecheck(items, 2)
        assert.deepEqual(pr.ids, ['a', 'c'], 'changed 先、conflict 依邊時刻舊到新')
        assert.ok(recheckDue(items, { minConflict: 6, waitDays: 7, nowMs: Date.parse('2026-10-03') }), '有 changed 即到期')
        assert.ok(!recheckDue(conf, { minConflict: 6, waitDays: 7, nowMs: Date.parse('2026-10-03') }), '衝突未滿半批且未久候')
        assert.ok(recheckDue(conf, { minConflict: 6, waitDays: 7, nowMs: Date.parse('2026-10-20') }), '最舊衝突已久候')
        assert.ok(citedNotesOf(s).has('c'), '爭議方之出處亦算引用')
        // 爭議頂層出處獨有之筆記(確認爭議而未指定方):內容已變即入重審(依據口徑＝citedNotesOf)
        const t = JSON.parse(JSON.stringify(s))
        const d = t.disputes[0]
        d.sources = [...d.sources, 'p']
        t.seen.p = { k: 'kp-old', v: 'v1' }
        const top = recheckItemsOf(t, { notesById, keyOf: (id) => keys[id] ?? null, version: 'v1' })
        assert.deepEqual(top.filter((x) => x.reason === 'changed').map((x) => x.id), ['a', 'p'])
        // 爭議已取代:其出處不再是依據 → 內容已變亦不入重審(由維護③靜默重設基準)
        d.status = 'superseded'
        const gone = recheckItemsOf(t, { notesById, keyOf: (id) => keys[id] ?? null, version: 'v1' })
        assert.deepEqual(gone.filter((x) => x.reason === 'changed').map((x) => x.id), ['a'])
    })

    // ─── D. 提煉段整合(真檔案＋記憶體集合＋腳本化 AI) ───

    /** 建立一個知識庫環境(目錄、筆記 md、記憶體集合、設定;3+3 替身、筆記之寫法與提煉段之執行等共用件見 test/tools/extractKit)——
     *   建構器於首次呼叫時才以暫存根實例化(暫存根於 before 建立;describe 定義期尚未有) */
    let envBuilder = null
    const mkEnv = (notes, o) => (envBuilder ||= mkEnvIn(TMP))(notes, o)
    const coreOf = async (env) => (await env.stores.cores.select())[0]

    it('首批落盤即記 lineage、seen(選篇當下之內容鍵)、seenConflicts(實際呈現之衝突邊);兩輪無變化 rev 不變', async () => {
        const env = mkEnv(['a1', 'a2', 'a3'].map((id) => ({ id, concepts: ['動能'] })), { relations: [{ id: 'e-a', from: 'a1', to: 'zz', type: '衝突或反例', reason: '相反' }] })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        const st = readState(env, rec.id)
        assert.ok(st.lineage?.at)
        assert.deepEqual(Object.keys(st.seen).sort(), ['a1', 'a2', 'a3'])
        assert.equal(st.seen.a1.v, CONTENT_KEY_VERSION)
        assert.deepEqual(st.seenConflicts, ['e-a'])
        const { report } = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(readState(env, rec.id).rev, st.rev, '無變化之輪不寫狀態')
        assert.equal(report.detail.projected, 0)
    })

    it('關聯脈絡型別(extract.relationTypes):conflict 只列衝突;linked 另列兩端皆在本批之他型;all 列觸及本批之全部;seenConflicts 一律只記衝突邊', async () => {
        const rels = [
            { id: 'r-c', from: 'k1', to: 'zz', type: '衝突或反例', reason: '相反' },
            { id: 'r-in', from: 'k1', to: 'k2', type: '互補搭配', reason: '批內' },
            { id: 'r-out', from: 'k2', to: 'yy', type: '延伸深化', reason: '他處' },
        ]
        const typesOf = (p) => (p.split('【關聯脈絡】')[1] || '').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.match(/〔([^；〕]+)/)[1]).sort()
        const got = {}
        for (const mode of ['conflict', 'linked', 'all']) {
            const env = mkEnv(['k1', 'k2', 'k3'].map((id) => ({ id, concepts: ['關聯型別'] })), { relations: rels, extract: { relationTypes: mode } })
            const ai = scriptAi({ draft: draftAll })
            await runStage(env, ai)
            got[mode] = typesOf(ai.calls.find((c) => c.role === 'draft').prompt)
            assert.deepEqual(readState(env, (await coreOf(env)).id).seenConflicts, ['r-c'], `${mode}:seenConflicts 只記衝突邊`)
        }
        assert.deepEqual(got, { conflict: ['衝突或反例'], linked: ['互補搭配', '衝突或反例'], all: ['互補搭配', '延伸深化', '衝突或反例'] })
        assert.throws(() => resolveExtractSettings({ extract: { relationTypes: 'bogus' } }), /extract\.relationTypes/)
    })

    it('首見:本版之前建立之核心(無 lineage)於維護時補基準(無 AI、不升版),不視為變更', async () => {
        const env = mkEnv(['b1', 'b2', 'b3'].map((id) => ({ id, concepts: ['價值'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        const st = readState(env, rec.id)
        delete st.lineage
        st.seen = {}
        st.seenConflicts = []
        fs.writeFileSync(`${env.dirs.coreState}/${rec.id}.state.json`, JSON.stringify(st), 'utf8')
        await env.stores.relations.insertNew([{ id: 'e-b', from: 'b1', to: 'zz', type: '衝突或反例', reason: 'x' }])
        const ai = scriptAi({ draft: draftAll })
        const { report } = await runStage(env, ai)
        const after = readState(env, rec.id)
        assert.equal(report.detail.baselined, 1)
        assert.equal(after.version, st.version, '不升版')
        assert.deepEqual(Object.keys(after.seen).sort(), ['b1', 'b2', 'b3'])
        assert.ok(after.seenConflicts.includes('e-b'), '現存衝突邊入基準')
        assert.equal(ai.calls.length, 0, '無 AI')
    })

    it('程式寫入之不變式(ES1;programWriteProblems):維護型改動(首見基準、seen、seenConflicts、lineage、撤出處升版、衍生欄位)通過;改條目內容、已用筆記減少、seen 含未消化者、版號跳動皆違反', () => {
        const s0 = seedState()
        const ok = clone(s0)
        ok.seen = { a: { k: 'h', v: '1' } }
        ok.seenConflicts = ['e1']
        ok.lineage = { at: AT }
        ok.claims[0].evidence = { level: '低', basis: '案例', trace: '' }
        assert.deepEqual(programWriteProblems(s0, ok), [], '維護型改動不違反')
        const w = withdrawSources(s0, { withdraw: [{ id: 'a', title: 'A' }], at: AT }).state
        assert.deepEqual(programWriteProblems(s0, w), [], '撤出處(升版＋沿革)不違反')
        const t = clone(s0)
        t.claims[0].text = '被改的文字'
        assert.match(programWriteProblems(s0, t).join('；'), /未觸及之項被改動/)
        const c = clone(s0)
        c.consumed = c.consumed.slice(1)
        assert.match(programWriteProblems(s0, c).join('；'), /已用筆記減少/)
        const sn = clone(s0)
        sn.seen = { zz: { k: 'h', v: '1' } }
        assert.match(programWriteProblems(s0, sn).join('；'), /seen 含未消化之筆記/)
        const v = clone(s0)
        v.version += 1
        assert.match(programWriteProblems(s0, v).join('；'), /changelog 與版號不一致/)
    })

    it('程式寫入之不變式:維護寫入違反(故障注入:證據外掛改了主張文字)→ 不落盤(rev 不變)、該核心維護失敗並告警;同輪他核心照常', async () => {
        const env = mkEnv([...['f1', 'f2', 'f3'].map((id) => ({ id, concepts: ['故障'] })), ...['g1', 'g2', 'g3'].map((id) => ({ id, concepts: ['正常'] }))])
        await runStage(env, scriptAi({ draft: draftAll }))
        const recs = await env.stores.cores.select()
        const bad = recs.find((r) => r.concept === '故障')
        const good = recs.find((r) => r.concept === '正常')
        const rev0 = readState(env, bad.id).rev
        const dom = createExtractDomain({})
        env.domains.extract = { ...dom, evidence: { ...dom.evidence, apply: (s, m) => { dom.evidence.apply(s, m); if (s.concept === '故障') s.claims[0].text = '外掛改寫之文字' } } }
        // 正常核心之筆記標題改了 → 維護要重繪投影(證明同輪他核心照常落盤)
        const n = await env.stores.notes.get('g1')
        await env.stores.notes.patch('g1', { title: 'g1 新標題' })
        const goodRev0 = readState(env, good.id).rev
        const { report, log } = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(report.detail.maintainFailed, 1)
        assert.ok(has(log, /^WARN 提煉維護失敗\[故障\]：不變式違反（維護寫入，未落盤）：未觸及之項被改動/), log.lines.join('\n'))
        assert.equal(readState(env, bad.id).rev, rev0, '違反者不落盤')
        assert.ok(!readState(env, bad.id).claims.some((c) => c.text === '外掛改寫之文字'))
        assert.ok(readState(env, good.id).rev > goodRev0, `他核心照常落盤（${n.title} → g1 新標題）`)
    })

    it('內容變更:被引用筆記之核心知識改了 → 僅重審 pass(無新筆記之核心):起草見【重審】段與被引條目、不動選題錨點與失敗帳、seen 更新', async () => {
        const env = mkEnv(['c1', 'c2', 'c3'].map((id) => ({ id, concepts: ['動量'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        const before = readState(env, rec.id)
        writeNote(env.dirs, { id: 'c1' }, 'c1 之知識(已修訂)')
        let draftPrompt = ''
        const ai = scriptAi({
            draft: (p) => {
                draftPrompt = p
                const code = batchOf(p)[0].code
                const cid = before.claims.find((c) => c.sources.includes('c1')).id
                return { ops: [{ op: 'revise', id: cid, fields: { text: '主張 c1(修訂後)' }, reason: '依新內容', sources: [code] }], skipped: [] }
            },
        })
        const { report, log } = await runStage(env, ai)
        assert.match(draftPrompt, /【重審】[\s\S]*N1（內容已更新）：本核心引用它之條目 〔C\d+〕/)
        assert.match(draftPrompt, /引用重審筆記 N1/)
        assert.equal(report.detail.recheckPasses, 1)
        assert.equal(report.detail.notesRechecked, 1)
        assert.equal(report.detail.notesUsed, 0, '重審篇不入消化')
        const after = readState(env, rec.id)
        assert.ok(after.claims.some((c) => c.text === '主張 c1(修訂後)'))
        assert.equal(after.proposedAt, before.proposedAt, '僅重審 pass 不動選題錨點')
        assert.notEqual(after.seen.c1.k, before.seen.c1.k, 'seen 更新為新內容鍵')
        const led = ledgerOf(env, 'concept|動量')
        assert.ok(!led.tries, '不動 tries')
        assert.ok(has(log, /^INFO 提煉選題：|^INFO 提煉：重審待處理/), log.lines.join('\n'))
        const again = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(again.report.detail.recheckChanged, 0, '處理後不再是重審項')
    })

    it('內容變更搭便車:核心另有新筆記而被選做一般批 → 重審筆記先入批(N1)、其餘照常選篇', async () => {
        const env = mkEnv(['d1', 'd2', 'd3'].map((id) => ({ id, concepts: ['波動'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        writeNote(env.dirs, { id: 'd1' }, 'd1 改寫')
        await env.stores.notes.insertNew(['d4', 'd5', 'd6'].map((id) => noteRow(env.dirs, { id, concepts: ['波動'] })))
        let p0 = ''
        await runStage(env, scriptAi({ draft: (p) => { p0 = p; return draftAll(p) } }))
        assert.deepEqual(batchOf(p0).map((x) => x.title), ['d1', 'd4', 'd5'], '重審筆記先入批,其餘補滿')
        assert.match(p0, /N1（內容已更新）/)
    })

    it('重審篇數填滿一批:新筆記之名額為 0 → 本批只有重審筆記(不得退回預設篇數而超出一批);新筆記留待下批', async () => {
        const env = mkEnv(['m1', 'm2', 'm3'].map((id) => ({ id, concepts: ['波動二'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        for (const id of ['m1', 'm2', 'm3']) writeNote(env.dirs, { id }, `${id} 改寫`)
        await env.stores.notes.insertNew(['m4', 'm5', 'm6'].map((id) => noteRow(env.dirs, { id, concepts: ['波動二'] })))
        let p0 = ''
        await runStage(env, scriptAi({ draft: (p) => { p0 = p; return draftAll(p) } }))
        assert.deepEqual(batchOf(p0).map((x) => x.title).sort(), ['m1', 'm2', 'm3'], '一批 3 篇皆為重審筆記')
        assert.equal(readState(env, (await coreOf(env)).id).consumed.filter((id) => ['m4', 'm5', 'm6'].includes(id)).length, 0, '新筆記本批未用')
    })

    it('刪除與還原:墓碑在且記錄不在 → 撤出處(無 AI)、md「出處已撤之條目」、noteCount 減;記錄回來且墓碑移除 → 恢復', async () => {
        const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['套利'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        const row = await env.stores.notes.get('e1')
        await env.stores.notes.del('e1')
        fs.writeFileSync(path.join(env.dirs.state, DELETION_FILES.tombstones), JSON.stringify({ ids: { e1: { at: AT, reason: '測試刪除' } } }), 'utf8')
        fs.mkdirSync(path.join(env.dirs.state, DELETION_FILES.archive), { recursive: true })
        fs.writeFileSync(path.join(env.dirs.state, DELETION_FILES.archive, 'e1.json'), JSON.stringify({ record: { title: 'E1 標題' } }), 'utf8')
        const ai = scriptAi({ draft: draftAll })
        const { report, log } = await runStage(env, ai)
        assert.equal(report.detail.withdrawn, 1)
        const st = readState(env, rec.id)
        assert.deepEqual(Object.keys(st.withdrawn), ['e1'])
        assert.equal(st.withdrawn.e1.title, 'E1 標題')
        const md = fs.readFileSync(rec.file, 'utf8')
        assert.match(md, /## 出處已撤之條目（待重審）/)
        assert.ok(!md.includes('[[e1]]'))
        assert.equal((await env.stores.cores.get(rec.id)).noteCount, 2)
        assert.ok(has(log, /^INFO 提煉出處撤出\[套利\]：E1 標題（筆記已刪除）/), log.lines.join('\n'))
        await env.stores.notes.insertNew([row])
        fs.writeFileSync(path.join(env.dirs.state, DELETION_FILES.tombstones), JSON.stringify({ ids: {} }), 'utf8')
        const back = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(back.report.detail.restored, 1)
        assert.deepEqual(readState(env, rec.id).withdrawn, {})
        assert.equal((await env.stores.cores.get(rec.id)).noteCount, 3)
    })

    it('懸空:記錄不在而無墓碑 → 只告警(MUST_SEE 字樣)、不撤出處', async () => {
        const env = mkEnv(['f1', 'f2', 'f3'].map((id) => ({ id, concepts: ['動能二'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        await env.stores.notes.del('f2')
        const { report, log } = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(report.detail.dangling, 1)
        assert.deepEqual(readState(env, rec.id).withdrawn, {})
        assert.ok(has(log, /^WARN 提煉出處懸空：/), log.lines.join('\n'))
    })

    it('時間不足之輪仍做維護(撤出處)後才不開工;大量內容變更守門 → 不排重審並告警', async () => {
        const env = mkEnv(['g1', 'g2', 'g3'].map((id) => ({ id, concepts: ['動量三'] })), { extract: { recheck: { guard: 1 } } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        await env.stores.notes.del('g3')
        fs.writeFileSync(path.join(env.dirs.state, DELETION_FILES.tombstones), JSON.stringify({ ids: { g3: { at: AT, reason: '測試刪除' } } }), 'utf8')
        const short = await runStage(env, scriptAi({ draft: draftAll }), {}, { remainingMs: 60_000 })
        assert.equal(short.report.detail.skippedForBudget, true)
        assert.equal(short.report.detail.withdrawn, 1, '維護在時間守門之前')
        const k0 = readState(env, rec.id).seen.g1.k
        writeNote(env.dirs, { id: 'g1' }, 'g1 改')
        writeNote(env.dirs, { id: 'g2' }, 'g2 改')
        const ai = scriptAi({ draft: draftAll })
        const { report, log } = await runStage(env, ai)
        assert.equal(report.detail.recheckBlocked, 2)
        assert.equal(report.detail.recheckPasses, 0)
        assert.equal(ai.calls.length, 0, '守門觸發:不排重審、不呼叫 AI')
        assert.ok(has(log, /^WARN 提煉內容變更守門：/), log.lines.join('\n'))
        assert.equal(readState(env, rec.id).seen.g1.k, k0, '基準不動(待放行或重設)')
        // 重設基準之指示(requestRebaseline):逐 id 名單——名單內者以現值為基準、不重審;名單外(g2)照常重審;名單檔用畢即刪
        const preview = await previewRecheck({ stores: env.stores, dirs: env.dirs, domain: env.domains.extract, relateDomain: env.domains.relate })
        assert.deepEqual(preview.map((r) => [r.id, r.changed.sort()]), [[rec.id, ['g1', 'g2']]])
        assert.throws(() => requestRebaseline(env.dirs, AT, []), /須給筆記 id 名單/)
        const flag = requestRebaseline(env.dirs, AT, ['g1'])
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(flag, 'utf8')).ids), ['g1'])
        const ai2 = scriptAi({ draft: draftAll })
        const r2 = await runStage(env, ai2)
        assert.equal(r2.report.detail.rebaselined, 1)
        assert.equal(r2.report.detail.recheckChanged, 1, '名單外之 g2 照常重審')
        assert.ok(ai2.calls.length > 0)
        const st2 = readState(env, rec.id)
        assert.notEqual(st2.seen.g1.k, k0)
        assert.ok(st2.seen.g1.h, '重設時一併記正文雜湊')
        assert.equal(fs.existsSync(flag), false, '指示用畢即刪')
    })

    it('內容鍵換版:正文雜湊相同 → 靜默換版(不重審);正文亦改 → 記為內容變更(重審);舊紀錄無正文雜湊 → 無從分辨、以現值為基準並計數;同版而缺正文雜湊者補記', async () => {
        const env = mkEnv(['v1', 'v2', 'v3'].map((id) => ({ id, concepts: ['換版'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        const st0 = readState(env, rec.id)
        assert.match(st0.seen.v1.h, /^[0-9a-f]{40}$/, '首批即記正文雜湊')
        // 同版而缺正文雜湊(本功能之前之紀錄)→ 補記,不算變更
        const noH = readState(env, rec.id)
        delete noH.seen.v2.h
        fs.writeFileSync(`${env.dirs.coreState}/${rec.id}.state.json`, JSON.stringify(noH), 'utf8')
        const ra = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(readState(env, rec.id).seen.v2.h, st0.seen.v2.h)
        assert.equal(ra.report.detail.recheckChanged, 0)
        // 換版:v1 正文改了、v2 未改、v3 之舊紀錄無正文雜湊
        const st1 = readState(env, rec.id)
        delete st1.seen.v3.h
        fs.writeFileSync(`${env.dirs.coreState}/${rec.id}.state.json`, JSON.stringify(st1), 'utf8')
        writeNote(env.dirs, { id: 'v1' }, 'v1 之知識已修訂')
        env.domains.extract = { ...env.domains.extract, contentKeyVersion: 'next-version' }
        const ai = scriptAi({ draft: draftAll })
        const rb = await runStage(env, ai)
        const st2 = readState(env, rec.id)
        assert.deepEqual([rb.report.detail.versionChanged, rb.report.detail.unverifiable], [1, 1])
        assert.equal(rb.report.detail.recheckChanged, 1, 'v1 排重審')
        assert.ok(ai.calls.some((c) => /（內容已更新）/.test(c.prompt)), '重審 pass 已跑')
        assert.deepEqual([st2.seen.v2.v, st2.seen.v2.h], ['next-version', st0.seen.v2.h], 'v2 靜默換版')
        assert.equal(st2.seen.v3.v, 'next-version', 'v3 以現值為基準')
        assert.ok(has(rb.log, /^INFO 提煉內容鍵換版：正文亦改者 1 處記為內容變更（重審）；舊紀錄無正文雜湊而無從分辨者 1 處以現值為基準/), rb.log.lines.join('\n'))
    })

    it('投影更新:筆記標題改了 → 無 AI 重繪 md 並把渲染雜湊寫回狀態,下次一般落盤不誤報手改', async () => {
        const env = mkEnv(['h1', 'h2', 'h3'].map((id) => ({ id, concepts: ['流動'] })))
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        await env.stores.notes.patch('h1', { title: 'H1 新標題' })
        const { report } = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(report.detail.projected, 1)
        assert.match(fs.readFileSync(rec.file, 'utf8'), /\[\[h1\]\] H1 新標題/)
        await env.stores.notes.insertNew(['h4', 'h5', 'h6'].map((id) => noteRow(env.dirs, { id, concepts: ['流動'] })))
        const { log } = await runStage(env, scriptAi({ draft: draftAll }))
        assert.ok(!has(log, /提煉手改另存/), log.lines.join('\n'))
        const manual = path.join(env.dirs.state, 'core', 'manual')
        assert.ok(!fs.existsSync(manual) || fs.readdirSync(manual).length === 0, '無手改另存之副本')
    })

    it('新衝突:被引用筆記與他概念之新筆記新判衝突 → 夥伴入僅重審 pass(關聯脈絡列出該邊)、處置後入 seenConflicts', async () => {
        const env = mkEnv(['i1', 'i2', 'i3'].map((id) => ({ id, concepts: ['動量四'] })), { extract: { recheck: { waitDays: 0 } } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'other1', concepts: ['別的概念'] })])
        await env.stores.relations.insertNew([{ id: 'e-new', from: 'other1', to: 'i2', type: '衝突或反例', reason: '結論相反', createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00' }])
        let p0 = ''
        const st0 = readState(env, rec.id)
        const cid = st0.claims.find((c) => c.sources.includes('i2')).id
        const ai = scriptAi({ draft: (p) => { p0 = p; return { ops: [{ op: 'dispute_add', question: 'i2 之結論是否成立', sides: [{ position: '成立', claims: [cid] }, { position: '不成立', sources: ['N1'] }] }], skipped: [] } } })
        const { report } = await runStage(env, ai)
        assert.equal(report.detail.recheckPasses, 1)
        assert.match(p0, /N1（新判衝突）：與核心已引之〈i2〉/)
        // 兩端皆可引(本批＋核心已引)→ R 編號、要求逐條交代去向(檢定標準 ES5);立了兩端分屬兩方之爭議 → 已處置 → 入 seen
        assert.match(p0, /- R1 N1 ↔ 〈i2〉（核心已引）〔衝突或反例；衝突〕：結論相反/)
        assert.match(p0, /【衝突之去向】【關聯脈絡】中標 R 編號之衝突（兩端皆可引），每一條都要交代去向並列入 conflicts/)
        assert.equal(report.detail.conflictsDisposed, 1)
        const st = readState(env, rec.id)
        assert.ok(st.seenConflicts.includes('e-new'))
        assert.equal(st.disputes.length, 1)
        assert.ok(st.consumed.includes('other1'), '夥伴被本核心消化')
    })

    it('衝突型改名(檢定標準 RS1′;詞彙表 relationTypeRenames):關聯段改寫前,邊仍為舊名者提煉亦認得為衝突——脈絡以現名呈現、入 seenConflicts', async () => {
        const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['動量六'] })), { extract: { recheck: { waitDays: 0 } } })
        env.domains.relate = createRelateDomain({ vocab: { relationTypes: ['前置概念', '互補搭配', '衝突', '延伸深化'], conflictType: '衝突', relationTypeRenames: { 衝突或反例: '衝突' } } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'other9', concepts: ['別的概念'] })])
        await env.stores.relations.insertNew([{ id: 'e-old', from: 'other9', to: 'q2', type: '衝突或反例', reason: '結論相反', createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00' }])
        let p0 = ''
        const cid = readState(env, rec.id).claims.find((c) => c.sources.includes('q2')).id
        const ai = scriptAi({ draft: (p) => { p0 = p; return { ops: [{ op: 'dispute_add', question: 'q2 之結論是否成立', sides: [{ position: '成立', claims: [cid] }, { position: '不成立', sources: ['N1'] }] }], skipped: [] } } })
        const { report } = await runStage(env, ai)
        assert.equal(report.detail.recheckPasses, 1, '舊名之衝突邊照樣排重審')
        assert.match(p0, /- R1 N1 ↔ 〈q2〉（核心已引）〔衝突；衝突〕：結論相反/, '脈絡以現名呈現')
        assert.ok(readState(env, rec.id).seenConflicts.includes('e-old'))
    })

    // ─── 衝突之去向(檢定標準 ES5) ───

    it('ES5 衝突去向(純判定):兩端分屬爭議兩方／取代／本版加條件且兩端皆為出處／一端離題 → 已處置;其餘未處置;宣告正規化只收 R 編號與清單內之去向', () => {
        const s = seedState() // C1 只引 a(爭議 side 0 引 C1)、爭議 side 1 出處 c(轉述)
        assert.equal(conflictDisposedOf(s, ['a', 'c']), 'dispute', '爭議兩方:a(經所引主張)與 c(方層出處)')
        assert.equal(conflictDisposedOf(s, ['c', 'a']), 'dispute', '無向')
        assert.equal(conflictDisposedOf(s, ['a', 'b']), '', '同一方或無爭議涉及 → 未處置')
        const sup = applyDelta(s, { ops: [{ op: 'add', ref: 'n', kind: 'rule', text: '新研究推翻', basis: '實證', sources: ['N2'] }, { op: 'supersede', id: idOf(s, '只靠丙之主張'), by: '@n', reason: '新證據', validPeriod: '較早之研究', sources: ['N2'] }] }, { batch: SEED, mode: 'delta', at: AT }).state
        assert.equal(conflictDisposedOf(sup, ['c', 'b']), 'supersede')
        const rev = applyDelta(s, { ops: [{ op: 'revise', id: idOf(s, '甲乙皆支持之主張'), fields: { conditions: ['市況平穩時'] }, reason: '加條件', sources: ['N2'] }] }, { batch: SEED, mode: 'delta', at: AT }).state
        assert.equal(conflictDisposedOf(rev, ['a', 'b'], { version: rev.version }), 'revise', '本版加條件且兩端皆為出處')
        assert.equal(conflictDisposedOf(rev, ['a', 'b'], { version: rev.version + 1 }), '', '非本版修改者不算')
        assert.equal(conflictDisposedOf(s, ['a', 'b'], { offtopic: new Set(['b']) }), 'offtopic')
        assert.deepEqual(normalizeConflictDecl([{ edge: 'r1', disposition: '非對立', reason: '回答不同問題' }, { edge: 'X', disposition: '立爭議' }, { edge: 'R2', disposition: '不知道' }, null]), [{ edge: 'R1', disposition: '非對立', reason: '回答不同問題' }])
        // R 編號只給兩端皆可引之衝突列
        const rows = relationContextRows([
            { id: 'e1', from: 'a', to: 'b', type: '衝突或反例', reason: '相反', updatedAt: '2026-10-02' },
            { id: 'e2', from: 'a', to: 'zz', type: '衝突或反例', reason: '相反', updatedAt: '2026-10-01' },
            { id: 'e3', from: 'a', to: 'c', type: '互補搭配', reason: '搭配', updatedAt: '2026-10-03' },
        ], { codeOf: (id) => ({ a: 'N1' })[id] || '', titleOf: (id) => id, cited: new Set(['b']), conflictType: '衝突或反例', label: true })
        assert.deepEqual(rows.map((x) => [x.id, x.label, x.enforced, x.line]), [
            ['e1', 'R1', true, '- R1 N1 ↔ 〈b〉（核心已引）〔衝突或反例；衝突〕：相反'],
            ['e2', '', false, '- N1 ↔ 〈zz〉（非本批）〔衝突或反例；衝突〕：相反'],
            ['e3', '', false, '- N1 ↔ 〈c〉（非本批）〔互補搭配〕：搭配'],
        ])
    })

    it('ES5 回頭檢查(純判定 es5ReopenOf):無處置結構且未交 RS4 者列出;有結構者、已交 RS4 者、一端非存活已消化筆記者不列;待判集合非 Set(未讀入)→ 不處置;與 es5RowsOf 同一判定', () => {
        const base = seedState() // 已消化 a b c;爭議 side 0 引 a(經 C1)、side 1 出處 c(轉述)
        const ENDS = { 'e-d': ['a', 'c'], 'e-n': ['a', 'b'], 'e-z': ['a', 'zz'], 'e-w': ['b', 'c'] }
        const conflictEndsOf = (eid) => ENDS[eid] || null
        const s = { ...base, seenConflicts: ['e-d', 'e-n', 'e-z', 'e-gone'] }
        const reopen = (st, rs4Held) => es5ReopenOf(st, { conflictEndsOf, rs4Held }).map((x) => x.eid)
        assert.deepEqual(reopen(s, new Set()), ['e-n'], 'e-d 有爭議結構、e-z 一端非已消化筆記、e-gone 邊已不在 → 不列')
        assert.deepEqual(es5ReopenOf(s, { conflictEndsOf, rs4Held: new Set() }), [{ eid: 'e-n', ends: ['a', 'b'] }])
        assert.deepEqual(reopen(s, new Set(['e-n'])), [], '已交 RS4 核對(任一狀態)者不列')
        for (const bad of [null, undefined, [], ['e-n'], {}, 'e-n']) assert.deepEqual(reopen(s, bad), [], `待判集合非 Set(${JSON.stringify(bad)})→ 不處置`)
        assert.deepEqual(es5ReopenOf(s, { rs4Held: new Set() }), [], '未給邊端 → 不判')
        // 一端之筆記已撤出 → 不再是存活已消化筆記,不列
        const w = { ...withdrawSources(s, { withdraw: [{ id: 'b', title: 'B' }], at: AT }).state, seenConflicts: ['e-n'] }
        assert.deepEqual(reopen(w, new Set()), [])
        // 與符合度掃描之判定同一份:es5ReopenOf ＝ es5RowsOf 中 how 為空者
        const rows = es5RowsOf(s, { conflictEndsOf, rs4HeldOf: () => false })
        assert.deepEqual(rows.filter((x) => !x.how).map((x) => x.eid), reopen(s, new Set()))
    })

    it('ES5 回頭檢查(純判定):處置結構因撤回／取代而消失 → 列出;以取代處置(被取代之主張以一端為出處、取代者以另一端為出處)者結構不會消失 → 不列', () => {
        const ENDS = { 'e-ab': ['a', 'b'], 'e-cb': ['c', 'b'] }
        const ctx = (rs4Held = new Set()) => ({ conflictEndsOf: (eid) => ENDS[eid] || null, rs4Held })
        const s0 = { ...seedState(), seenConflicts: ['e-ab'] }
        const y = idOf(s0, '甲乙皆支持之主張')
        const apply = (st, ops) => {
            const r = applyDelta(st, { ops }, { batch: SEED, mode: 'delta', at: AT })
            assert.deepEqual(r.rejected, [], JSON.stringify(r.rejected))
            return { ...r.state, seenConflicts: st.seenConflicts }
        }
        // 加條件之修正(兩端皆為出處、有條件)→ 有處置結構
        const rev = apply(s0, [{ op: 'revise', id: y, fields: { conditions: ['市況平穩時'] }, reason: '加條件', sources: ['N2'] }])
        assert.equal(conflictDisposedOf(rev, ['a', 'b'], { anyVersion: true }), 'revise')
        assert.deepEqual(es5ReopenOf(rev, ctx()), [], '有處置結構 → 不列')
        // 撤回該主張 → 結構消失
        const gone1 = apply(rev, [{ op: 'retract', id: y, reason: '無出處支持' }])
        assert.equal(conflictDisposedOf(gone1, ['a', 'b'], { anyVersion: true }), '')
        assert.deepEqual(es5ReopenOf(gone1, ctx()).map((x) => x.eid), ['e-ab'], '撤回路徑')
        assert.deepEqual(es5ReopenOf(gone1, ctx(new Set(['e-ab']))), [], '已交 RS4 者不列')
        // 取代該主張(取代者只以第三篇為出處)→ 結構消失
        const gone2 = apply(rev, [{ op: 'add', ref: 'n', kind: 'rule', text: '新研究推翻', basis: '實證', sources: ['N3'], ...ANN }, { op: 'supersede', id: y, by: '@n', reason: '新證據', validPeriod: '較早之研究', sources: ['N3'] }])
        assert.equal(conflictDisposedOf(gone2, ['a', 'b'], { anyVersion: true }), '')
        assert.deepEqual(es5ReopenOf(gone2, ctx()).map((x) => x.eid), ['e-ab'], '取代路徑')
        // 以取代處置之衝突(被取代之主張以 c 為出處、取代者以 b 為出處)→ 取代為終態、結構不會消失 → 不列
        const sup = apply({ ...s0, seenConflicts: ['e-cb'] }, [{ op: 'add', ref: 'n', kind: 'rule', text: '新研究推翻', basis: '實證', sources: ['N2'], ...ANN }, { op: 'supersede', id: idOf(s0, '只靠丙之主張'), by: '@n', reason: '新證據', validPeriod: '較早之研究', sources: ['N2'] }])
        assert.equal(conflictDisposedOf(sup, ['c', 'b'], { anyVersion: true }), 'supersede')
        assert.deepEqual(es5ReopenOf(sup, ctx()), [], '取代處置者不列')
    })

    it('ES5 衝突去向(提煉段):未處置 → 不入 seen、下次再呈現;第 2 次仍未處置 → 交 RS4 待判並入 seen;宣告非對立(附理由)→ 入 seen 並交 RS4 待判', async () => {
        const mk = async () => {
            const env = mkEnv(['j1', 'j2', 'j3'].map((id) => ({ id, concepts: ['動量七'] })), { extract: { recheck: { waitDays: 0 } } })
            env.stores.holds = memStore([])
            await runStage(env, scriptAi({ draft: draftAll }))
            await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'oth', concepts: ['別的概念'] })])
            await env.stores.relations.insertNew([{ id: 'e-x', from: 'oth', to: 'j2', type: '衝突或反例', reason: '結論相反', createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00' }])
            return env
        }
        const confirmOnly = (decl) => (p) => ({ ops: batchOf(p).map((x) => ({ op: 'confirm', id: 'C1', sources: [x.code] })), skipped: [], ...(decl ? { conflicts: decl } : {}) })
        // 未處置兩次 → RS4
        const env = await mk()
        const rec = await coreOf(env)
        const r1 = await runStage(env, scriptAi({ draft: confirmOnly() }))
        assert.equal(r1.report.detail.conflictsPending, 1)
        assert.ok(!readState(env, rec.id).seenConflicts.includes('e-x'), '未處置不入 seen')
        await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'oth2', concepts: ['動量七'] })])
        const ai2 = scriptAi({ draft: confirmOnly() })
        const r2 = await runStage(env, ai2)
        assert.ok(ai2.calls.some((c) => /- R1 /.test(c.prompt)), '再次呈現')
        assert.equal(r2.report.detail.conflictsToRs4, 1)
        assert.ok(readState(env, rec.id).seenConflicts.includes('e-x'))
        const h = await env.stores.holds.get('edge:e-x:RS4')
        assert.deepEqual([h.status, h.owner, h.ctx.from, h.ctx.to], ['open', 'pipeline', 'oth', 'j2'])
        assert.match(h.reason, /提煉 2 次呈現皆未處置此衝突/)
        // 宣告非對立 → 一次即入 seen、交 RS4
        const env2 = await mk()
        const rec2 = await coreOf(env2)
        const r3 = await runStage(env2, scriptAi({ draft: confirmOnly([{ edge: 'R1', disposition: '非對立', reason: '兩篇回答不同市場之問題' }]) }))
        assert.equal(r3.report.detail.conflictsNotOpposed, 1)
        assert.ok(readState(env2, rec2.id).seenConflicts.includes('e-x'))
        assert.match((await env2.stores.holds.get('edge:e-x:RS4')).reason, /^提煉判為非對立：兩篇回答不同市場之問題/)
    })

    // ─── 衝突已不成立(關聯段重評之撤銷／降級;帳驅動;收尾 A3 終審 F5) ───

    it('conflictGoneOf(純判定):事件之邊見過、當下非衝突、有未決爭議以其端點為出處 → 項;無爭議涉及 → orphans;仍為衝突或未見過 → 無', () => {
        const s = { ...seedState(), seenConflicts: ['e1', 'e2', 'e3'] }
        s.disputes = [{ id: 'D1', status: 'open', question: 'q', sides: [{ position: 'x', sources: ['p'] }, { position: 'y', sources: ['q'] }] }]
        const ev = (edgeId, from, to) => ({ edgeId, from, to, kind: 'retire', oldType: '衝突或反例', newType: '', reason: '已不相反', note: from, at: '2026-10-05T00:00:00+08:00' })
        const notesById = new Map(['p', 'q', 'r', 's'].map((id) => [id, { id }]))
        const r = conflictGoneOf(s, { conflictEvents: [ev('e1', 'p', 'r'), ev('e2', 'r', 's'), ev('e3', 'q', 'p'), ev('e9', 'p', 'q')], conflictIds: new Set(['e3']), notesById, keyOf: () => 'k' })
        assert.deepEqual(r.items.map((x) => [x.edgeId, x.id, x.anchor, x.reason]), [['e1', 'p', 'r', 'conflictGone']], 'e3 當下仍是衝突、e9 未見過')
        assert.deepEqual(r.orphans, ['e2'], 'e2 兩端皆無未決爭議涉及')
        assert.equal(conflictGoneOf(s, { conflictEvents: [], conflictIds: new Set() }).items.length, 0, '無事件不推定(邊讀不到不等於撤銷)')
    })

    it('衝突被重評撤銷(事件帳)→ 有爭議涉及之核心排重審(提示詞標「衝突已撤銷」與拆解指示);已涵蓋即自 seenConflicts 移出', async () => {
        const env = mkEnv(['j1', 'j2', 'j3'].map((id) => ({ id, concepts: ['動量五'] })), { extract: { recheck: { waitDays: 0 } } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'other2', concepts: ['別的概念'] })])
        await env.stores.relations.insertNew([{ id: 'e-c', from: 'other2', to: 'j2', type: '衝突或反例', reason: '結論相反', createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00' }])
        const cid = readState(env, rec.id).claims.find((c) => c.sources.includes('j2')).id
        await runStage(env, scriptAi({ draft: { ops: [{ op: 'dispute_add', question: 'j2 之結論是否成立', sides: [{ position: '成立', claims: [cid] }, { position: '不成立', sources: ['N1'] }] }], skipped: [] } }))
        const st1 = readState(env, rec.id)
        assert.ok(st1.seenConflicts.includes('e-c') && st1.disputes.length === 1, '前提:依衝突立了爭議')
        // 關聯段重評撤銷該衝突邊(寫事件、刪邊)
        await env.stores.relations.del('e-c')
        appendConflictEvent(env.dirs.state, { edgeId: 'e-c', from: 'other2', to: 'j2', kind: 'retire', oldType: '衝突或反例', newType: '', reason: '新內容與 j2 之結論已一致', note: 'other2', at: '2026-10-05T00:00:00+08:00' })
        let p0 = ''
        const dId = st1.disputes[0].id
        // 只有立場文字之方(side 1)轉為主張:種類取 kinds[1](預設首項 principle 須跨篇,該方只有單篇出處 → rule)、標注取 annotations[1](ES4)
        const ai3 = scriptAi({ draft: (p) => { p0 = p; return { ops: [{ op: 'dispute_dissolve', id: dId, reason: '兩方已回答同一問題且結論一致，可同時成立', kinds: [null, 'rule'], annotations: [null, ANN] }], skipped: [{ note: 'N1', reason: '非對立' }] } } })
        const { report } = await runStage(env, ai3)
        assert.equal(report.detail.recheckConflictGone, 1, JSON.stringify(report.detail))
        assert.match(p0, /N1（衝突已撤銷）：與核心已引之〈j2〉之衝突關係已由關聯段重評撤銷（理由：新內容與 j2 之結論已一致）/)
        assert.match(p0, /衝突已撤銷者：核對依此衝突所立之爭議是否仍成立——[^\n]*並於 skipped 寫「非對立」；仍對立者維持，並於 skipped 寫「重審無須變更」/)
        const st2 = readState(env, rec.id)
        assert.ok(!st2.seenConflicts.includes('e-c'), '已處置 → 移出(日後再成為衝突即為新衝突)')
        assert.equal(st2.disputes[0].status, 'retracted', '模型拆解之爭議落地')
    })

    it('衝突被撤銷而無未決爭議涉及 → 維護只自 seenConflicts 移出(無 AI);邊消失而無事件 → 不推定撤銷', async () => {
        const env = mkEnv(['k1', 'k2', 'k3'].map((id) => ({ id, concepts: ['動量六'] })), { relations: [{ id: 'e-k', from: 'k1', to: 'zz', type: '衝突或反例', reason: '相反' }, { id: 'e-q', from: 'k2', to: 'yy', type: '衝突或反例', reason: '相反' }] })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        assert.deepEqual(readState(env, rec.id).seenConflicts.sort(), ['e-k', 'e-q'])
        await env.stores.relations.del('e-k')
        await env.stores.relations.del('e-q')
        appendConflictEvent(env.dirs.state, { edgeId: 'e-k', from: 'k1', to: 'zz', kind: 'downgrade', oldType: '衝突或反例', newType: '互補搭配', reason: '不再相反', note: 'k1', at: '2026-10-05T00:00:00+08:00' })
        const ai = scriptAi({ draft: draftAll })
        const { report } = await runStage(env, ai)
        assert.equal(ai.calls.length, 0, '無 AI')
        assert.equal(report.detail.conflictGonePruned, 1)
        assert.deepEqual(readState(env, rec.id).seenConflicts, ['e-q'], 'e-q 無事件:讀不到不等於撤銷,保留')
    })

    // ─── 已見衝突之處置結構消失(檢定標準 ES5 回頭檢查;維護) ───

    const EDGE_AT = '2026-10-01T00:00:00+08:00'
    const conflictEdge = (id, from, to) => ({ id, from, to, type: '衝突或反例', reason: '結論相反', createdAt: EDGE_AT, updatedAt: EDGE_AT })
    const codeIn = (p, title) => batchOf(p).find((x) => x.title === title).code
    /** 起草替身:依提示詞組出一份差量(opsOf(提示詞) => 操作陣列;無略過) */
    const draftOps = (opsOf) => (p) => ({ ops: opsOf(p), skipped: [] })
    /** 僅重審 pass 之起草替身:記提示詞、不改任何條目(全部略過) */
    const recheckNoChange = (prompts) => (p) => {
        prompts.push(p)
        return { ops: [], skipped: batchOf(p).map((x) => ({ note: x.code, reason: '重審無須變更' })) }
    }

    it('已見衝突之處置結構消失(依衝突所立之爭議被拆解)→ 維護自 seenConflicts 移出(無 AI)並記 conflictReopened／INFO;仍有結構者、已交 RS4 核對者不動;移出者重審項重呈 R 列,未處置記次、不回 seen,逾次交 RS4 後不再移出(有界)', async () => {
        const env = mkEnv(['m1', 'm2', 'm3'].map((id) => ({ id, concepts: ['回頭檢查甲'] })), {
            extract: { recheck: { waitDays: 0 } },
            relations: [conflictEdge('e-m', 'm1', 'm2'), conflictEdge('e-r', 'm2', 'm3'), conflictEdge('e-s', 'm1', 'm3')],
        })
        // 首批:依三條衝突各立一則爭議(兩端分屬不同之方)→ 三邊皆有處置結構、入 seenConflicts
        const draft1 = draftOps((p) => [
            { op: 'add', ref: 'a', kind: 'rule', text: '甲之主張', basis: '實證', sources: [codeIn(p, 'm1')], ...ANN },
            { op: 'add', ref: 'b', kind: 'rule', text: '乙之主張', basis: '實證', sources: [codeIn(p, 'm2')], ...ANN },
            { op: 'add', ref: 'c', kind: 'rule', text: '丙之主張', basis: '實證', sources: [codeIn(p, 'm3')], ...ANN },
            { op: 'dispute_add', question: '甲乙何者成立', sides: [{ position: '甲', claims: ['@a'], sources: [codeIn(p, 'm1')] }, { position: '乙', claims: ['@b'], sources: [codeIn(p, 'm2')] }] },
            { op: 'dispute_add', question: '乙丙何者成立', sides: [{ position: '乙', claims: ['@b'], sources: [codeIn(p, 'm2')] }, { position: '丙', claims: ['@c'], sources: [codeIn(p, 'm3')] }] },
            { op: 'dispute_add', question: '甲丙何者成立', sides: [{ position: '甲', claims: ['@a'], sources: [codeIn(p, 'm1')] }, { position: '丙', claims: ['@c'], sources: [codeIn(p, 'm3')] }] },
            { op: 'essence', text: '本質文字', claims: ['@a'], reason: '首版' },
        ])
        await runStage(env, scriptAi({ draft: draft1 }))
        const rec = await coreOf(env)
        const st1 = readState(env, rec.id)
        assert.deepEqual(st1.seenConflicts.sort(), ['e-m', 'e-r', 'e-s'])
        const dispOf = (s) => [['m1', 'm2'], ['m2', 'm3'], ['m1', 'm3']].map((ends) => conflictDisposedOf(s, ends, { anyVersion: true }))
        assert.deepEqual(dispOf(st1), ['dispute', 'dispute', 'dispute'], '前提:三邊之處置皆為爭議')
        // 新筆記入批,起草把前兩則爭議拆解(模型判非對立;第三則維持)→ 前兩邊之處置結構消失,邊仍留在 seenConflicts(拆解當下不動記帳欄位,由維護統一處置)
        await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'm4', concepts: ['回頭檢查甲'] })])
        const dId = (q) => st1.disputes.find((d) => d.question === q).id
        const draft2 = draftOps((p) => [
            { op: 'add', ref: 'd', kind: 'rule', text: '丁之主張', basis: '實證', sources: [batchOf(p)[0].code], ...ANN },
            { op: 'dispute_dissolve', id: dId('甲乙何者成立'), reason: '甲乙回答不同問題，可同時成立', kinds: [null, null], annotations: [null, null] },
            { op: 'dispute_dissolve', id: dId('乙丙何者成立'), reason: '乙丙回答不同問題，可同時成立', kinds: [null, null], annotations: [null, null] },
        ])
        await runStage(env, scriptAi({ draft: draft2 }))
        const st2 = readState(env, rec.id)
        assert.deepEqual(dispOf(st2), ['', '', 'dispute'], '前兩邊處置結構已消失、第三邊仍有')
        assert.deepEqual(st2.seenConflicts.sort(), ['e-m', 'e-r', 'e-s'], '拆解當下不動 seenConflicts')
        // e-r 已交 RS4 核對(任一狀態皆算已處置):維護只移出 e-m
        assert.equal(await queueConflictCheck(env.stores.holds, { edgeId: 'e-r', from: 'm2', to: 'm3', reason: '測試：已交關聯段核對', at: AT }), 'queued')
        const prompts = []
        const ai3 = scriptAi({ draft: recheckNoChange(prompts) })
        const r3 = await runStage(env, ai3)
        assert.equal(r3.report.detail.conflictReopened, 1, JSON.stringify(r3.report.detail))
        assert.ok(r3.log.lines.some((l) => /^INFO 提煉\[回頭檢查甲\]：1 條已見衝突之處置結構已消失（爭議拆解／取代／撤回），移出已見、下輪重新呈現（ES5）：m[12] ⇄ m[12]$/.test(l)), r3.log.lines.join('\n'))
        assert.equal(r3.report.detail.recheckPasses, 1, `移出者成重審項 conflict、當輪到期(waitDays 0)→ 一次僅重審 pass：${JSON.stringify(r3.report.detail)}`)
        assert.ok(prompts.length >= 1 && prompts.every((p) => /^- R1 .*〔衝突或反例；衝突〕：結論相反/m.test(p)), `重呈為兩端皆可引之 R 列：\n${prompts[0]}`)
        assert.equal(r3.report.detail.conflictsPending, 1, '未處置 → 記次、不入 seen')
        const st3 = readState(env, rec.id)
        assert.equal(r3.report.detail.maintainFailed, 0, '程式寫入之不變式(ES1)放行維護之記帳寫入')
        assert.equal(st3.version, st2.version, '記帳欄位之移出:不升版')
        assert.deepEqual(st3.changelog, st2.changelog, '記帳欄位之移出:不加沿革')
        assert.deepEqual(st3.seenConflicts.sort(), ['e-r', 'e-s'], 'e-m 移出且未回 seen;e-r(已交 RS4)、e-s(結構仍在)不動')
        // 第二次仍未處置 → 交 RS4 待判並入 seen(有界);其後維護不再移出、不再重呈
        const r4 = await runStage(env, scriptAi({ draft: recheckNoChange([]) }))
        assert.equal(r4.report.detail.conflictsToRs4, 1)
        assert.equal(r4.report.detail.conflictReopened, 0, '本輪維護時 e-m 尚未入 seen')
        assert.deepEqual(readState(env, rec.id).seenConflicts.sort(), ['e-m', 'e-r', 'e-s'])
        assert.equal((await env.stores.holds.get('edge:e-m:RS4'))?.status, 'open')
        const ai5 = scriptAi({ draft: draftAll })
        const r5 = await runStage(env, ai5)
        assert.equal(r5.report.detail.conflictReopened, 0, '已交 RS4 核對者不再移出')
        assert.equal(ai5.calls.length, 0, '無 AI:不再重審')
        assert.deepEqual(readState(env, rec.id).seenConflicts.sort(), ['e-m', 'e-r', 'e-s'])
    })

    // 處置結構消失之另兩條路徑:撤回(retract)、取代(supersede)——「加條件之修正」所依之主張成為終態,conflictDisposedOf 之 ③ 不再成立
    for (const [shape, endingOps] of [
        ['撤回', (xId) => [{ op: 'add', ref: 'n', kind: 'rule', text: '丁之主張', basis: '實證', sources: ['@p4'], ...ANN }, { op: 'retract', id: xId, reason: '無出處支持' }]],
        ['取代', (xId) => [{ op: 'add', ref: 'n', kind: 'rule', text: '新研究推翻之主張', basis: '實證', sources: ['@p4'], ...ANN }, { op: 'supersede', id: xId, by: '@n', reason: '新證據', validPeriod: '較早之研究', sources: ['@p4'] }]],
    ]) {
        it(`已見衝突之處置為加條件之修正,其主張日後被${shape} → 處置結構消失,維護自 seenConflicts 移出並重呈(${shape}路徑)`, async () => {
            const env = mkEnv(['p1', 'p2', 'p3'].map((id) => ({ id, concepts: [`回頭檢查${shape}`] })), { extract: { recheck: { waitDays: 0 } }, relations: [conflictEdge('e-p', 'p1', 'p2')] })
            // 首批:以一條有條件、同時引兩端之主張處置該衝突(加條件之修正);兩端另各有一條只引自己之主張(使兩端於日後仍被核心引用)
            const draft1 = draftOps((p) => [
                { op: 'add', ref: 'x', kind: 'rule', text: '甲乙在平穩市況下皆成立', basis: '實證', conditions: ['市況平穩時'], sources: [codeIn(p, 'p1'), codeIn(p, 'p2')], ...ANN },
                { op: 'add', ref: 'y', kind: 'rule', text: '只靠甲之主張', basis: '實證', sources: [codeIn(p, 'p1')], ...ANN },
                { op: 'add', ref: 'z', kind: 'rule', text: '只靠乙之主張', basis: '實證', sources: [codeIn(p, 'p2')], ...ANN },
                { op: 'add', ref: 'w', kind: 'rule', text: '只靠丙之主張', basis: '實證', sources: [codeIn(p, 'p3')], ...ANN },
                { op: 'essence', text: '本質文字', claims: ['@w'], reason: '首版' },
            ])
            await runStage(env, scriptAi({ draft: draft1 }))
            const rec = await coreOf(env)
            const st1 = readState(env, rec.id)
            assert.deepEqual(st1.seenConflicts, ['e-p'])
            assert.equal(conflictDisposedOf(st1, ['p1', 'p2'], { anyVersion: true }), 'revise', '前提:以加條件之修正處置')
            const xId = st1.claims.find((c) => c.text === '甲乙在平穩市況下皆成立').id
            // 新筆記入批,起草使該主張成為終態
            await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'p4', concepts: [`回頭檢查${shape}`] })])
            await runStage(env, scriptAi({ draft: (p) => ({ ops: endingOps(xId).map((o) => JSON.parse(JSON.stringify(o).replace(/@p4/g, codeIn(p, 'p4')))), skipped: [] }) }))
            const st2 = readState(env, rec.id)
            assert.ok(['retracted', 'superseded'].includes(st2.claims.find((c) => c.id === xId).status), `前提:主張已成終態：${st2.claims.find((c) => c.id === xId).status}`)
            assert.equal(conflictDisposedOf(st2, ['p1', 'p2'], { anyVersion: true }), '', '處置結構已消失')
            assert.deepEqual(st2.seenConflicts, ['e-p'], '邊仍留在 seenConflicts')
            const prompts = []
            const ai3 = scriptAi({ draft: recheckNoChange(prompts) })
            const { report, log } = await runStage(env, ai3)
            assert.equal(report.detail.conflictReopened, 1, JSON.stringify(report.detail))
            assert.ok(log.lines.some((l) => /^INFO 提煉\[回頭檢查(撤回|取代)\]：1 條已見衝突之處置結構已消失/.test(l)), log.lines.join('\n'))
            assert.equal(report.detail.recheckPasses, 1)
            assert.ok(prompts.length >= 1 && prompts.every((p) => /^- R1 /m.test(p)), `重呈 R 列：\n${prompts[0]}`)
            assert.deepEqual(readState(env, rec.id).seenConflicts, [], '未處置不回 seen')
        })
    }

    it('已見衝突之處置結構消失而其邊已有 RS4 待判登錄(任一狀態:未結、已結案、已豁免)→ 維護不移出、不重呈(視同已交核對;與符合度掃描同讀待判登錄)', async () => {
        for (const status of ['open', 'resolved', 'waived']) {
            const env = mkEnv(['q1', 'q2', 'q3'].map((id) => ({ id, concepts: ['回頭檢查丙'] })), { extract: { recheck: { waitDays: 0 } }, relations: [conflictEdge('e-q', 'q1', 'q2')] })
            const draft1 = draftOps((p) => [
                { op: 'add', ref: 'a', kind: 'rule', text: '甲之主張', basis: '實證', sources: [codeIn(p, 'q1')], ...ANN },
                { op: 'add', ref: 'b', kind: 'rule', text: '乙之主張', basis: '實證', sources: [codeIn(p, 'q2')], ...ANN },
                { op: 'add', ref: 'c', kind: 'rule', text: '丙之主張', basis: '實證', sources: [codeIn(p, 'q3')], ...ANN },
                { op: 'dispute_add', question: '甲乙何者成立', sides: [{ position: '甲', claims: ['@a'], sources: [codeIn(p, 'q1')] }, { position: '乙', claims: ['@b'], sources: [codeIn(p, 'q2')] }] },
                { op: 'essence', text: '本質文字', claims: ['@c'], reason: '首版' },
            ])
            await runStage(env, scriptAi({ draft: draft1 }))
            const rec = await coreOf(env)
            const st1 = readState(env, rec.id)
            assert.deepEqual(st1.seenConflicts, ['e-q'])
            await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'q4', concepts: ['回頭檢查丙'] })])
            const draft2 = draftOps((p) => [
                { op: 'add', ref: 'd', kind: 'rule', text: '丁之主張', basis: '實證', sources: [batchOf(p)[0].code], ...ANN },
                { op: 'dispute_dissolve', id: st1.disputes[0].id, reason: '甲乙回答不同問題，可同時成立', kinds: [null, null], annotations: [null, null] },
            ])
            await runStage(env, scriptAi({ draft: draft2 }))
            assert.equal(conflictDisposedOf(readState(env, rec.id), ['q1', 'q2'], { anyVersion: true }), '', `${status}:前提:處置結構已消失`)
            assert.equal(await queueConflictCheck(env.stores.holds, { edgeId: 'e-q', from: 'q1', to: 'q2', reason: '測試：已交關聯段核對', at: AT }), 'queued')
            await env.stores.holds.replace({ ...(await env.stores.holds.get('edge:e-q:RS4')), status })
            const ai = scriptAi({ draft: recheckNoChange([]) })
            const { report } = await runStage(env, ai)
            assert.equal(report.detail.conflictReopened, 0, `${status}:${JSON.stringify(report.detail)}`)
            assert.equal(ai.calls.length, 0, `${status}:無重審`)
            assert.deepEqual(readState(env, rec.id).seenConflicts, ['e-q'], `${status}:不移出`)
        }
    })

    it('回頭檢查之範圍(與符合度掃描、存量處置一致):首見基準之核心(無 lineage)基準後同輪即受檢;非概念層之核心照樣移出(其重呈待下批觸及兩端時,無重審項)', async () => {
        // 首見基準:基準把兩端皆已消化、無處置結構之現存衝突邊記為已見——符合度掃描對此判違反,維護同輪移出並排重審
        const env = mkEnv(['b1', 'b2', 'b3'].map((id) => ({ id, concepts: ['回頭檢查範圍'] })), { extract: { recheck: { waitDays: 0 } } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        const st = readState(env, rec.id)
        delete st.lineage
        st.seen = {}
        st.seenConflicts = []
        fs.writeFileSync(`${env.dirs.coreState}/${rec.id}.state.json`, JSON.stringify(st), 'utf8')
        await env.stores.relations.insertNew([conflictEdge('e-b', 'b1', 'b2')])
        const prompts = []
        const r1 = await runStage(env, scriptAi({ draft: recheckNoChange(prompts) }))
        assert.equal(r1.report.detail.baselined, 1)
        assert.equal(r1.report.detail.conflictReopened, 1, JSON.stringify(r1.report.detail))
        assert.equal(r1.report.detail.recheckPasses, 1, '移出者同輪成重審項')
        assert.ok(prompts.length >= 1 && prompts.every((p) => /^- R1 /m.test(p)))
        assert.deepEqual(readState(env, rec.id).seenConflicts, [])
        // 非概念層(類別層)之核心:判定與移出照舊(範圍同掃描);類別核心無重審項,不排重審 pass
        const st2 = readState(env, rec.id)
        st2.seenConflicts = ['e-b']
        st2.scope = 'category'
        fs.writeFileSync(`${env.dirs.coreState}/${rec.id}.state.json`, JSON.stringify(st2), 'utf8')
        await env.stores.cores.replace({ ...rec, scope: 'category' })
        const ai2 = scriptAi({ draft: recheckNoChange([]) })
        const r2 = await runStage(env, ai2)
        assert.equal(r2.report.detail.conflictReopened, 1, JSON.stringify(r2.report.detail))
        assert.equal(r2.report.detail.recheckPasses, 0, '類別核心無重審項')
        assert.deepEqual(readState(env, rec.id).seenConflicts, [])
    })

    // ─── E. 關聯變更之影響(檢定標準 ES10;relationImpact) ───

    const isConflict = (t) => t === '衝突或反例'
    const edge = (id, type, reason = '理由', from = 'a', to = 'b') => ({ id, from, to, type, reason })
    // 影響事件(relationEventsOf 之產物形狀):邊 id 為 edgeId
    const evt = (kind, id, type, reason, from, to, oldType = '') => ({ kind, edgeId: id, from, to, type, reason, oldType })

    it('ES10 事件(純函數):首見不產事件;新增／改型／改理由／撤銷(稽核為證)／消失(無稽核);還原後不算撤銷;型別改名不算改型', () => {
        assert.deepEqual(relationEventsOf(null, [edge('x', '互補搭配')]), { baseline: true, events: [] })
        const prev = edgeSnapshotOf([edge('k', '互補搭配'), edge('t', '互補搭配'), edge('m', '延伸深化'), edge('d', '互補搭配'), edge('g', '互補搭配'), edge('z', '衝突'), edge('back', '互補搭配')], 'T0')
        const now = [edge('k', '互補搭配'), edge('t', '延伸深化'), edge('m', '延伸深化', '新理由'), edge('n', '同族策略'), edge('z', '衝突或反例')]
        const audit = [
            { at: 'T1', reason: 'reeval-retire', detail: '題材撞名', edge: edge('d', '互補搭配') },
            { at: 'T1', reason: 'note-deleted', edge: edge('back', '互補搭配') },
            { at: 'T2', reason: 'restored', restoredFrom: 'note-deleted', edge: edge('back', '互補搭配') },
        ]
        const ev = relationEventsOf(prev, now, audit, { typeOf: (t) => (t === '衝突' ? '衝突或反例' : t) })
        assert.equal(ev.baseline, false)
        assert.deepEqual(ev.events.map((x) => [x.kind, x.edgeId, x.oldType, x.type]), [
            ['retype', 't', '互補搭配', '延伸深化'],
            ['reason', 'm', '延伸深化', '延伸深化'],
            ['add', 'n', '', '同族策略'],
            ['retire', 'd', '互補搭配', ''],
            ['gone', 'g', '互補搭配', ''],
            ['gone', 'back', '互補搭配', ''],
        ], 'z 只是改名(現名相同、理由相同)→ 無事件;back 撤出後又還原 → 無撤銷之證據')
        assert.equal(ev.events.find((x) => x.edgeId === 'd').reason, '題材撞名', '撤銷之理由取稽核之說明')
    })

    it('ES10 處置(純函數):新關聯之另一端入夥伴候選;兩端皆已消化／一端未被引用／衝突型 → 不需更新(附理由);經夥伴入批者之關聯撤銷 → 重審;衝突理由更新而爭議兩方分含兩端 → 重審;夥伴所依之邊撤銷或改衝突 → 移出', () => {
        // seedState:C1 只引 a、C2 引 a,b、C3 引 c;D1 兩方分含 a(經 C1)與 c(方層出處);已消化 a,b,c
        const s = { ...seedState(), via: { c: 'e6' }, partners: { s1: { edge: 'e10', from: 'a', at: 'T0' }, u1: { edge: 'e11', from: 'b', at: 'T0' } } }
        const events = [
            evt('add', 'e1', '互補搭配', '搭配', 'a', 'p'),
            evt('add', 'e2', '互補搭配', '搭配', 'a', 'b'),
            evt('add', 'e3', '衝突或反例', '相反', 'a', 'q'),
            evt('add', 'e4', '互補搭配', '搭配', 'x', 'y'),
            evt('add', 'e5', '延伸深化', '延伸', 'b', 'p'),
            evt('retire', 'e6', '', '題材撞名', 'c', 'zz', '延伸深化'),
            evt('add', 'e7', '互補搭配', '搭配', 'r', 'a'),
            evt('retire', 'e7', '', '撤', 'r', 'a', '互補搭配'),
            evt('reason', 'e8', '衝突或反例', '新衝突理由', 'a', 'c', '衝突或反例'),
            evt('reason', 'e9', '衝突或反例', '新衝突理由', 'a', 'b', '衝突或反例'),
            evt('retype', 'e10', '延伸深化', '改型', 's1', 'a', '互補搭配'),
            evt('retype', 'e11', '衝突或反例', '改為衝突', 'u1', 'b', '互補搭配'),
            evt('reason', 'e12', '互補搭配', '新理由', 'a', 'w', '互補搭配'),
            evt('gone', 'e13', '', '', '', '', '互補搭配'),
        ]
        const plan = impactOfCore(s, events, { isConflict, at: 'T9' })
        assert.deepEqual(plan.rows.map((r) => [r.edgeId, r.action]), [
            ['e1', 'candidate'], ['e2', 'none'], ['e3', 'none'], ['e5', 'none'], ['e6', 'recheck'], ['e7', 'candidate'], ['e7', 'drop-candidate'],
            ['e8', 'recheck'], ['e9', 'none'], ['e10', 'none'], ['e11', 'drop-candidate'], ['e12', 'none'],
        ], 'e4 不觸及本核心、e13 消失(無稽核)只記於帳')
        const why = (id) => plan.rows.find((r) => r.edgeId === id).why
        assert.match(why('e2'), /兩端皆已被本核心消化/)
        assert.match(why('e3'), /衝突型新邊由重審/)
        assert.match(why('e5'), /已是夥伴候選/)
        assert.match(why('e9'), /無未決爭議之兩方分含兩端/)
        assert.match(why('e10'), /候選保留/)
        assert.match(why('e12'), /關聯只作脈絡/)
        assert.deepEqual([...plan.addPartners.keys()], ['p'], '同一批先加後撤之 r 不入候選')
        assert.deepEqual([...plan.dropPartners.keys()].sort(), ['r', 'u1'])
        assert.deepEqual(plan.recheck.map((x) => [x.id, x.reason, x.anchor, x.edgeId]), [['c', 'relationChanged', 'zz', 'e6'], ['a', 'conflictReason', 'c', 'e8']])
        // 套用:候選增刪、已刪筆記之候選移除、重審項併入;重套同一處置不算變更(冪等)
        const s2 = { ...s, partners: { ...s.partners, w1: { edge: 'e14', from: 'a', at: 'T0' } } }
        const ap = applyImpact(s2, plan, { gone: (nid) => nid === 'w1' })
        assert.equal(ap.changed, true)
        assert.deepEqual(ap.pruned, ['w1'])
        assert.deepEqual(Object.keys(ap.state.partners).sort(), ['p', 's1'])
        assert.deepEqual(ap.state.partners.p, { edge: 'e1', from: 'a', at: 'T9' })
        assert.deepEqual(Object.keys(ap.state.impactRecheck).sort(), ['a', 'c'])
        assert.equal(applyImpact(ap.state, plan).changed, false, '冪等')
        assert.deepEqual(programWriteProblems(s, ap.state), [], '記帳欄位之寫入不違反程式寫入之不變式')
        // 不變式:夥伴候選不得為已消化者;重審項、經夥伴入批之邊只對已消化者
        assert.match(checkInvariants(s, { ...ap.state, partners: { a: { edge: 'e1' } } }).join('；'), /partners 含已消化之筆記：a/)
        assert.match(checkInvariants(s, { ...ap.state, via: { zz: 'e1' } }).join('；'), /via 含未消化之筆記：zz/)
        assert.match(checkInvariants(s, { ...ap.state, impactRecheck: { zz: [] } }).join('；'), /impactRecheck 含未消化之筆記：zz/)
        // 消化即移出候選(不論經何途徑入批)
        const s3 = commitBatch(ap.state, { used: ['p'], pending: [], skipped: [], dropped: [] })
        assert.deepEqual(Object.keys(s3.partners), ['s1'])
    })

    it('ES10 處置帳(純函數):候選／重審／移出逐列;不需更新依理由彙整(邊清單);未觸及任何核心與消失之邊亦留痕', () => {
        const events = [evt('add', 'e1', '互補搭配', '搭配', 'a', 'b'), evt('add', 'e2', '互補搭配', '搭配', 'a', 'c'), evt('add', 'e3', '互補搭配', '搭配', 'x', 'y'), evt('gone', 'e4', '', '', '', '', '互補搭配')]
        const perCore = [
            { core: 'k1', rows: [{ ...events[0], action: 'candidate', why: '入候選' }, { ...events[1], action: 'none', why: '兩端皆已消化' }] },
            { core: 'k2', rows: [{ ...events[1], action: 'none', why: '兩端皆已消化' }] },
        ]
        const rows = impactLedgerRowsOf(events, perCore, 'T9')
        assert.deepEqual(rows.map((r) => [r.action, r.core || '', r.count || 0, (r.edges || []).join(',')]), [
            ['candidate', 'k1', 0, ''],
            ['none', '', 1, 'e2'],
            ['none', '', 1, 'e3'],
            ['none', '', 1, 'e4'],
        ])
        assert.match(rows[2].why, /未觸及任何核心/)
        assert.match(rows[3].why, /撤出稽核無紀錄/)
    })

    it('ES10 重審項:關聯變更之重審項(仍被引用者)與夥伴(未消化、就緒、所依之邊現存且非衝突)只在開啟時列入;排序殿後於他種、一般批可排除夥伴;夥伴湊批到期', () => {
        const s = { ...seedState(), impactRecheck: { c: [{ reason: 'relationChanged', anchor: 'zz', edgeId: 'e6', kind: 'retire', newType: '', why: '題材撞名', at: 'T1' }], zz: [{ reason: 'relationChanged', edgeId: 'e7' }] }, partners: { p: { edge: 'e1', from: 'a', at: '2026-10-02T00:00:00+08:00' }, p2: { edge: 'gone', from: 'a', at: 'T0' }, p3: { edge: 'e1', from: 'a', at: 'T0' }, a: { edge: 'e1', from: 'b', at: 'T0' } } }
        const notesById = new Map(['a', 'b', 'c', 'p', 'p2', 'p3'].map((id) => [id, { id }]))
        const base = { notesById, keyOf: () => 'k', version: '', conflictEdges: [] }
        assert.deepEqual(recheckItemsOf(s, base), [], '未開啟 → 不列(停用＝舊行為)')
        const items = recheckItemsOf(s, { ...base, impact: true, readyOf: (nid) => nid !== 'p3', edgeOf: (id) => (id === 'e1' ? edge('e1', '互補搭配', '搭配理由') : null) })
        assert.deepEqual(items.map((x) => [x.id, x.reason, x.newType, x.why]), [['c', 'relationChanged', '', '題材撞名'], ['p', 'partner', '互補搭配', '搭配理由']],
            'zz 未被引用、p2 所依之邊不在、p3 未就緒、a 已消化 → 不列')
        const mixed = [{ id: 'x1', reason: 'partner', at: '1' }, { id: 'x2', reason: 'conflict', at: '1' }, { id: 'x3', reason: 'resend' }, { id: 'x4', reason: 'conflictReason' }, { id: 'x5', reason: 'relationChanged' }, { id: 'x6', reason: 'conflictGone' }, { id: 'x7', reason: 'changed' }]
        assert.deepEqual(pickRecheck(mixed, 7).ids, ['x7', 'x6', 'x5', 'x4', 'x3', 'x2', 'x1'])
        assert.deepEqual(pickRecheck(mixed, 7, { exclude: ['partner'] }).ids, ['x7', 'x6', 'x5', 'x4', 'x3', 'x2'])
        const opt = { minConflict: 2, waitDays: 7, nowMs: Date.parse('2026-10-03T00:00:00+08:00') }
        assert.ok(recheckDue([{ id: 'c', reason: 'relationChanged' }], opt), '關聯變更立即到期')
        assert.ok(!recheckDue([{ id: 'p', reason: 'partner', at: '2026-10-02T00:00:00+08:00' }], opt), '夥伴未湊滿且未久候')
        assert.ok(recheckDue([{ id: 'p', reason: 'partner', at: '2026-10-02T00:00:00+08:00' }, { id: 'q', reason: 'conflict', at: '2026-10-02T00:00:00+08:00' }], opt), '夥伴與新判衝突合計湊滿')
        assert.ok(recheckDue([{ id: 'p', reason: 'partner', at: '2026-09-20T00:00:00+08:00' }], opt), '最舊夥伴已久候')
    })

    it('ES10 重審段文字:新關聯、關聯已變更、衝突理由已更新各有一行與處置指示;不含新理由時既有文字不變', () => {
        const domain = createExtractDomain({})
        const items = [
            { code: 'N1', reason: 'partner', anchorTitle: '甲', anchorItems: ['C1'], newType: '互補搭配', why: '兩者可搭配' },
            { code: 'N2', reason: 'relationChanged', anchorTitle: '乙', citedBy: ['C2'], kind: 'retire', newType: '', why: '題材撞名' },
            { code: 'N3', reason: 'conflictReason', anchorTitle: '丙', anchorItems: ['C3', 'D1'], kind: 'reason', newType: '衝突或反例', why: '樣本期不同而結論相反' },
        ]
        const draft = domain.buildRecheckText(items, { stage: 'draft' })
        assert.match(draft, /- N1（新關聯）：此篇未曾入本核心，因與核心已引之〈甲〉（〔C1〕之出處）新判「互補搭配」關係而呈現（理由：兩者可搭配）。/)
        assert.match(draft, /- N2（關聯已變更）：此篇當初經與核心已引之〈乙〉之關聯入批，該關聯已由關聯段撤銷（撤銷理由：題材撞名）；本核心引用它之條目 〔C2〕。/)
        assert.match(draft, /- N3（衝突理由已更新）：與核心已引之〈丙〉之衝突關係理由已更新為：樣本期不同而結論相反；涉及之條目 〔C3〕〔D1〕。/)
        assert.match(draft, /- 關聯已變更者：核對此篇是否仍屬本核心之主題——[^\n]*retract（理由「離題」）/)
        assert.match(draft, /- 衝突理由已更新者：[^\n]*dispute_update 寫 note[^\n]*dispute_dissolve 拆解/)
        assert.match(draft, /- 新關聯者：照一般規則處理——[^\n]*列入 skipped（理由「離題」）/)
        assert.match(draft, /新關聯者為新筆記，不適用此二理由。/)
        assert.match(draft, /^\n\n【重審】（以下筆記中，標「新關聯」者未曾入本核心、因與核心已引之筆記新判關聯而呈現，其他已被本核心消化過，因內容更新、關聯變更或新判衝突而重新呈現；本批其餘筆記照一般規則處理）\n/, '標頭依實況')
        assert.ok(!/- 內容已更新者：|- 新判衝突者：/.test(draft), '本批無此型者不列其說明')
        assert.match(domain.buildRecheckText(items, { stage: 'review' }), /關聯已變更者：以「離題」撤回須確認[^\n]*新關聯者：被引為出處之內容須確實出自該篇/)
        // 只有新關聯:標頭不稱「已被本核心消化過」、不列重審專用之略過理由
        const only = domain.buildRecheckText([items[0]], { stage: 'draft' })
        assert.match(only, /^\n\n【重審】（以下筆記未曾入本核心，因與核心已引之筆記新判關聯而呈現；本批其餘筆記照一般規則處理）\n- N1（新關聯）/)
        assert.ok(!/已被本核心消化過|重審無須變更|審核重審筆記相關之操作時/.test(only + domain.buildRecheckText([items[0]], { stage: 'review' })))
        assert.match(domain.buildRecheckText([items[0]], { stage: 'review' }), /^\n\n【重審】（本批有因與核心已引之筆記新判關聯而呈現之新筆記）\n- N1（新關聯）[^\n]*\n新關聯者：被引為出處之內容須確實出自該篇/)
        // 只有既有理由:逐字同此前(標頭、兩行固定說明、去向行)
        const old = domain.buildRecheckText([{ code: 'N1', reason: 'changed', citedBy: ['C1'] }], { stage: 'draft' })
        assert.equal(old, `\n\n【重審】（以下筆記已被本核心消化過，因內容更新或新判衝突而重新呈現；其餘筆記照一般規則處理）\n- N1（內容已更新）：本核心引用它之條目 〔C1〕。\n- 內容已更新者：逐條核對所列條目——仍成立者不動或 confirm；與新內容不符者 revise；僅以該篇為出處且已不成立者 retract（理由「無出處支持」）；仍有他篇出處者不可撤回、只可 revise；新內容中之新知識照常 add。\n- 新判衝突者：依爭議規則立爭議（該篇之立場以該篇代號為出處），或判為非對立。\n- 重審筆記之去向另可列入 skipped 之理由：重審無須變更｜非對立（前者＝內容已更新而所列條目皆仍成立；後者＝新判衝突而兩方並非對立）。`)
        assert.equal(domain.buildRecheckText([{ code: 'N1', reason: 'changed', citedBy: ['C1'] }], { stage: 'review' }), '\n\n【重審】（本批有被本核心消化過、因內容更新或新判衝突而重新呈現之筆記）\n- N1（內容已更新）：本核心引用它之條目 〔C1〕。\n審核重審筆記相關之操作時：依其新內容判斷 revise／retract 是否成立；仍有他篇出處之條目不得以「無出處支持」撤回；新判衝突者應立爭議或明示非對立。')
    })

    it('ES10 提煉段:首輪建快照;非衝突新關聯 → 夥伴候選 → 閒置核心之僅重審 pass 入批、被引用即記 via;該關聯撤銷(稽核)→ 重審 → 清除;處置寫影響帳', async () => {
        const env = mkEnv(['m1', 'm2', 'm3'].map((id) => ({ id, concepts: ['動量八'] })), { extract: { recheck: { relationImpact: true, waitDays: 0 } } })
        const r1 = await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        assert.ok(fs.existsSync(`${env.dirs.state}/${EDGE_SEEN_FILE}`), '首輪建快照')
        assert.equal(r1.report.detail.impactEvents, 0)
        assert.ok(has(r1.log, /^INFO 提煉關聯影響：首見，以現行 0 條邊建立快照/), r1.log.lines.join('\n'))
        // 他概念之新筆記與核心所引之 m2 新判「延伸深化」
        await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'pp', concepts: ['別的概念'] })])
        const ep = { id: 'e-p', from: 'pp', to: 'm2', type: '延伸深化', reason: 'pp 延伸 m2 之方法', createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00' }
        await env.stores.relations.insertNew([ep])
        const cid = readState(env, rec.id).claims.find((c) => c.sources.includes('m2')).id
        let p2 = ''
        const ai2 = scriptAi({ draft: (p) => { p2 = p; return { ops: [{ op: 'confirm', id: cid, sources: ['N1'] }], skipped: [] } } })
        const r2 = await runStage(env, ai2)
        assert.deepEqual([r2.report.detail.impactEvents, r2.report.detail.impactCandidates, r2.report.detail.recheckPasses, r2.report.detail.partnersCovered, r2.report.detail.partnersUsed], [1, 1, 1, 1, 1], JSON.stringify(r2.report.detail))
        assert.match(p2, new RegExp(`- N1（新關聯）：此篇未曾入本核心，因與核心已引之〈m2〉（〔${cid}〕之出處）新判「延伸深化」關係而呈現（理由：pp 延伸 m2 之方法）。`))
        const st2 = readState(env, rec.id)
        assert.ok(st2.consumed.includes('pp'))
        assert.deepEqual([st2.partners, st2.via], [{}, { pp: 'e-p' }], '消化即移出候選、被引用即記經此邊入批')
        assert.ok(st2.claims.find((c) => c.id === cid).sources.includes('pp'))
        // 關聯段撤銷該邊(稽核在先)→ 經此邊入批而被引用之 pp 重審
        await retireEdge({ relations: env.stores.relations, ledgers: openRelateLedgers(env.dirs.state), stateDir: env.dirs.state }, ep, { reason: 'reeval-retire', at: AT, detail: '題材撞名' })
        let p3 = ''
        const ai3 = scriptAi({ draft: (p) => { p3 = p; return { ops: [], skipped: [{ note: 'N1', reason: '重審無須變更' }] } } })
        const r3 = await runStage(env, ai3)
        assert.deepEqual([r3.report.detail.impactEvents, r3.report.detail.impactRecheck, r3.report.detail.recheckPasses, r3.report.detail.notesRechecked], [1, 1, 1, 1], JSON.stringify(r3.report.detail))
        assert.match(p3, new RegExp(`- N1（關聯已變更）：此篇當初經與核心已引之〈m2〉之關聯入批，該關聯已由關聯段撤銷（撤銷理由：題材撞名）；本核心引用它之條目 〔${cid}〕。`))
        assert.deepEqual(readState(env, rec.id).impactRecheck, {}, '已涵蓋即清除')
        // 影響帳:候選與重審逐列(含核心 id 與理由)
        // 影響帳為 JSONL(抓取套件之 readJsonlRows 讀;壞行即帳之寫法有誤——不容略過)
        const badRows = []
        const ledger = readJsonlRows(`${env.dirs.state}/${IMPACT_LEDGER_FILE}`, { onBad: (b) => badRows.push(b) })
        assert.deepEqual(badRows, [], '影響帳無壞行')
        assert.deepEqual(ledger.filter((r) => r.action !== 'none').map((r) => [r.action, r.edgeId, r.core, r.kind]), [['candidate', 'e-p', rec.id, 'add'], ['recheck', 'e-p', rec.id, 'retire']])
        // 再一輪無事件 → 不呼叫 AI
        const ai4 = scriptAi({ draft: draftAll })
        const r4 = await runStage(env, ai4)
        assert.deepEqual([ai4.calls.length, r4.report.detail.impactEvents], [0, 0])
    })

    it('ES10 提煉段:核心狀態壞檔 → 事件留待(只留觸及其已消化筆記者)、快照照常前進;修好後下輪補處置;停用 → 不建快照、不產候選(舊行為)', async () => {
        const env = mkEnv(['h1', 'h2', 'h3'].map((id) => ({ id, concepts: ['動量九'] })), { extract: { recheck: { relationImpact: true, perRun: 0 } } })
        await runStage(env, scriptAi({ draft: draftAll }))
        const rec = await coreOf(env)
        const file = `${env.dirs.coreState}/${rec.id}.state.json`
        const good = fs.readFileSync(file, 'utf8')
        fs.writeFileSync(file, '{ 壞檔')
        await env.stores.notes.insertNew([noteRow(env.dirs, { id: 'hp', concepts: ['別的概念'] })])
        await env.stores.relations.insertNew([{ id: 'e-h', from: 'h1', to: 'hp', type: '互補搭配', reason: '搭配', createdAt: AT, updatedAt: AT }, { id: 'e-x', from: 'xx', to: 'yy', type: '互補搭配', reason: '無關', createdAt: AT, updatedAt: AT }])
        const r2 = await runStage(env, scriptAi({ draft: draftAll }))
        assert.equal(r2.report.detail.impactRetryCores, 1)
        const retry = JSON.parse(fs.readFileSync(`${env.dirs.state}/${IMPACT_RETRY_FILE}`, 'utf8'))
        assert.deepEqual(retry[rec.id].map((e) => e.edgeId), ['e-h'], '只留觸及其已消化筆記之事件')
        assert.ok(JSON.parse(fs.readFileSync(`${env.dirs.state}/${EDGE_SEEN_FILE}`, 'utf8')).edges['e-h'], '快照照常前進')
        fs.writeFileSync(file, good)
        const r3 = await runStage(env, scriptAi({ draft: draftAll }))
        assert.deepEqual([r3.report.detail.impactEvents, r3.report.detail.impactCandidates, r3.report.detail.impactRetryCores], [0, 1, 0], JSON.stringify(r3.report.detail))
        assert.deepEqual(Object.keys(readState(env, rec.id).partners), ['hp'])
        assert.ok(!fs.existsSync(`${env.dirs.state}/${IMPACT_RETRY_FILE}`), '補處置後移除留待檔')
        // 停用:不建快照、不產候選
        const off = mkEnv(['o1', 'o2', 'o3'].map((id) => ({ id, concepts: ['動量十'] })), { relations: [{ id: 'e-o', from: 'o1', to: 'op', type: '互補搭配', reason: '搭配' }] })
        await runStage(off, scriptAi({ draft: draftAll }))
        assert.ok(!fs.existsSync(`${off.dirs.state}/${EDGE_SEEN_FILE}`))
        assert.equal(readState(off, (await coreOf(off)).id).partners, undefined)
    })
})
