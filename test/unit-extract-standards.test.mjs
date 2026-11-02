// unit-extract-standards.test.mjs — 核心之確定性檢定標準(checkCore:ES1、ES2、ES4、ES5、ES6、ES8、ES12、ES13、ES15、ES17)與 ES5 之判定材料(es5CtxOf)
//   每條標準之合格、不合格、未能判定(與不適用)各至少一案
// 執行:在套件根 node <mocha> test/unit-extract-standards.test.mjs(純函數,不落檔)

import assert from 'node:assert/strict'
import { checkCore, es5CtxOf } from '../src/standards/coreStandards.mjs'
import { emptyState, DEFAULT_LIMITS } from '../src/stores/coreState.mjs'
import { LEAK_PHRASES } from '../src/standards/opGuards.mjs'
import { createRelateDomain } from '../src/core/relatePackage.mjs'

describe('unit-extract-standards', function() {

    describe('核心(extract/standards/coreStandards)', function() {

        const state = () => {
            const s = emptyState({ coreId: 'c1', concept: '動量因子' })
            s.claims.push(
                { id: 'C1', kind: 'principle', text: '動量年化超額 8.2%', conditions: [], pros: ['可擴充'], cons: ['出處未載'], period: '', critique: '單一市場', basis: '', sources: ['n1', 'n2'], status: 'active', history: [] },
                { id: 'C2', kind: 'principle', text: '動量有效', conditions: [], pros: ['簡單'], cons: ['成本'], period: '', critique: '樣本短', basis: '', sources: ['n1', 'n1b'], status: 'active', history: [] },
                { id: 'C3', kind: 'temporal', text: '若採[[x-12345678]]之設計則年化 9.9%', conditions: [], pros: [], cons: [], period: '', critique: '', basis: '', sources: ['n2'], status: 'active', history: [] },
                { id: 'C4', kind: 'rule', text: '扣成本後仍有效', conditions: [], pros: ['可行'], cons: ['容量'], period: '', critique: '需更多市場', basis: '', sources: ['gone'], status: 'active', history: [] },
            )
            s.withdrawn = { gone: { at: '2026-10-01', title: 'g', reason: 'deleted' } }
            s.consumed = ['n1', 'n1b', 'n2', 'gone']
            s.nextId = { C: 5, D: 1, P: 1, Q: 1 }
            return s
        }
        const ctx = { contentOf: (id) => ({ n1: '動量年化超額 8.2%', n1b: '同文另一網址 8.2%', n2: '另一研究' }[id] ?? null), docIdOf: (id) => ({ n1: 'd1', n1b: 'd1', n2: 'd2' }[id] ?? null) }

        it('ES4:缺銳評、時效主張缺期間 → 不合格;利弊以「出處未載」明示者合格', () => {
            const rs = checkCore(state(), ctx).filter((r) => r.std === 'ES4')
            assert.equal(rs.find((r) => r.field === 'C1').status, 'pass')
            assert.match(rs.find((r) => r.field === 'C3').detail, /缺銳評.*時效主張缺期間/)
        })

        it('ES12:principle 之存活出處相異文件不足 2(同一文件之兩筆記只算一份)→ 不合格', () => {
            const rs = checkCore(state(), ctx).filter((r) => r.std === 'ES12')
            assert.equal(rs.find((r) => r.field === 'C1').status, 'pass')
            assert.equal(rs.find((r) => r.field === 'C2').status, 'violation')
        })

        it('ES17 不入掃描(納入閘為唯一執行處;存量之文字無本批之語境):checkCore 不產 ES17 列;ES2:所引出處無之數字(連結內雜湊不算)→ 不合格', () => {
            const rs = checkCore(state(), ctx)
            assert.equal(rs.some((r) => r.std === 'ES17'), false, '「符合度掃描不產 ES17 列」')
            const g = rs.find((r) => r.std === 'ES2' && r.field === 'C3')
            assert.equal(g.status, 'violation')
            assert.ok(g.detail.includes('9.9%') && !g.detail.includes('12345678'), g.detail)
            assert.equal(rs.find((r) => r.std === 'ES2' && r.field === 'C1').status, 'pass')
        })

        it('ES8:出處全撤之主張列未能判定(隔離待處置),不參與紮根與標注判定;ES6:有效主張而無本質 → 不合格;ES1 不變式合格', () => {
            const rs = checkCore(state(), ctx)
            assert.equal(rs.find((r) => r.std === 'ES8' && r.field === 'C4').status, 'undetermined')
            assert.equal(rs.find((r) => r.std === 'ES2' && r.field === 'C4'), undefined)
            assert.equal(rs.find((r) => r.std === 'ES6').status, 'violation')
            assert.equal(rs.find((r) => r.std === 'ES1').status, 'pass')
        })

        it('ES6 v2:本質待重寫(所引主張已被取代／撤回,或其出處已撤)→ 不合格;本質健在 → 合格;無有效主張 → 不適用', () => {
            const ok = state()
            ok.essence = { text: '動量年化超額 8.2%', claims: ['C1'], sources: [], at: 'T', stale: null }
            assert.equal(checkCore(ok, ctx).find((r) => r.std === 'ES6').status, 'pass')
            const st = state()
            st.essence = { text: '動量年化超額 8.2%', claims: ['C1'], sources: [], at: 'T', stale: { version: 2, at: 'T', from: 'C9' } }
            assert.match(checkCore(st, ctx).find((r) => r.std === 'ES6').detail, /本質待重寫（所引〔C9〕已被取代或撤回）/)
            const lost = state()
            lost.essence = { text: '扣成本後仍有效', claims: ['C4'], sources: [], at: 'T', stale: null }
            assert.match(checkCore(lost, ctx).find((r) => r.std === 'ES6').detail, /本質待重寫（所引〔C4〕之出處已撤）/)
            const none = state()
            none.claims = none.claims.map((c) => ({ ...c, status: 'retracted', statusNote: 'x', retractReason: '離題' }))
            assert.equal(checkCore(none, ctx).find((r) => r.std === 'ES6').status, 'na')
        })

        it('ES15:逾限筆記(最後一次略過理由為「未涵蓋逾限」且未被存活條目引用)逐篇須有待判登錄;無登錄 → 不合格;未給登錄 → 未能判定;重送後另有去向或已被引用者不算;無逾限 → 不產結果', () => {
            const s = state()
            // x1、x2 逾限(未被引用);n1 逾限但被 C1 引用(重送後已引用)→ 不算;x3 曾逾限而重送後離題(最後理由非逾限)→ 不算;n1b 離題不在此列
            s.consumed = [...s.consumed, 'x1', 'x2', 'x3']
            s.skipped = [{ note: 'x1', reason: '未涵蓋逾限', version: 1 }, { note: 'x2', reason: '未涵蓋逾限', version: 1 }, { note: 'x2', reason: '未涵蓋逾限', version: 2 }, { note: 'n1', reason: '未涵蓋逾限', version: 1 }, { note: 'x3', reason: '未涵蓋逾限', version: 1 }, { note: 'x3', reason: '離題', version: 2 }, { note: 'n1b', reason: '離題', version: 1 }]
            const rs = checkCore(s, { ...ctx, heldOf: (coreId, nid) => coreId === 'c1' && nid === 'x1' }).filter((r) => r.std === 'ES15')
            assert.deepEqual(rs.map((r) => [r.field, r.status]), [['x1', 'pass'], ['x2', 'violation']], '同一篇多次逾限只算一筆;被引用者、重送後另有去向者、離題不在此列')
            assert.match(rs[1].detail, /逾限筆記無待判登錄/)
            assert.deepEqual(checkCore(s, ctx).filter((r) => r.std === 'ES15').map((r) => r.status), ['undetermined', 'undetermined'])
            assert.equal(checkCore(state(), ctx).filter((r) => r.std === 'ES15').length, 0)
        })

        it('ES2:出處內容不可得而有未紮根者 → 未能判定', () => {
            const rs = checkCore(state(), { ...ctx, contentOf: (id) => (id === 'n2' ? null : ctx.contentOf(id)) })
            assert.equal(rs.find((r) => r.std === 'ES2' && r.field === 'C3').status, 'undetermined')
        })

        // 2026-10-05 審查 B-M4、A-A7:掃描須涵蓋新進閘之全部確定性標準(外洩、長度硬上限、ES13、ES5)
        it('ES1 v2:條目文字含流程用語(與新進同一 LEAK_PHRASES)或逾長度硬上限(文字欄 2 倍、本質 1 倍)→ 該條目不合格;其餘條目合格', () => {
            const s = state()
            s.claims[1].text = `動量有效${LEAK_PHRASES[0]}`
            s.claims[0].critique = '甲'.repeat(DEFAULT_LIMITS.critique * 2 + 1)
            s.essence = { text: '乙'.repeat(DEFAULT_LIMITS.essence + 1), claims: ['C1'], sources: [], at: 'T', stale: null }
            const rs = checkCore(s, ctx).filter((r) => r.std === 'ES1')
            assert.match(rs.find((r) => r.field === 'C2').detail, new RegExp(`text 含流程用語「${LEAK_PHRASES[0]}」`))
            assert.match(rs.find((r) => r.field === 'C1').detail, /critique 過長（\d+ 字，硬上限 180）/)
            assert.match(rs.find((r) => r.field === 'essence').detail, /essence 過長（221 字，硬上限 220）/)
            assert.equal(rs.find((r) => r.field === 'C3').status, 'pass')
        })

        it('ES13:參數證據等級為最低級或未評估而 conditions 無限制語 → 不合格;有限制語(自承之限制或弱證據說法)→ 合格;非最低級 → 不產結果;未給 evidence → 不檢', () => {
            const s = state()
            s.parameters.push(
                { id: 'P1', name: '形成期', value: '12 個月', conditions: '', period: '', claim: 'C1', sources: ['n1'], status: 'active', evidence: { level: '低' }, history: [] },
                { id: 'P2', name: '持有期', value: '1 個月', conditions: '未經獨立驗證', period: '', claim: 'C1', sources: ['n1'], status: 'active', evidence: { level: '低' }, history: [] },
                { id: 'P3', name: '成本', value: '0.3%', conditions: '', period: '', claim: 'C1', sources: ['n1'], status: 'active', evidence: { level: '中' }, history: [] },
                { id: 'P4', name: '門檻', value: '2 倍', conditions: '', period: '', claim: 'C1', sources: ['n1'], status: 'active', evidence: { level: '' }, history: [] },
            )
            const ev = { levels: ['高', '中', '低'], selfLimitOf: () => false }
            const rs = checkCore(s, { ...ctx, evidence: ev, weakEvidence: '未經獨立驗證' }).filter((r) => r.std === 'ES13')
            assert.deepEqual(rs.map((r) => [r.field, r.status]), [['P1', 'violation'], ['P2', 'pass'], ['P4', 'violation']])
            assert.equal(checkCore(s, ctx).filter((r) => r.std === 'ES13').length, 0)
        })

        it('ES5:已見之衝突兩端皆為已消化存活筆記 → 須有處置結構(爭議兩方)或已交 RS4 核對;皆無 → 不合格;一端不可引 → 不檢;未給邊端 → 不檢', () => {
            const s = state()
            s.seenConflicts = ['e1', 'e2', 'e3', 'e4']
            const ends = { e1: ['n1', 'n2'], e2: ['n1b', 'n2'], e3: ['n1', 'gone'], e4: ['n1', 'n2'] }
            s.disputes.push({ id: 'D1', question: '動量是否有效', status: 'open', sides: [{ position: '有效', sources: ['n1b'], claims: [] }, { position: '無效', sources: ['n2'], claims: [] }], history: [] })
            const rs = checkCore(s, { ...ctx, conflictEndsOf: (id) => ends[id] || null, rs4HeldOf: (id) => id === 'e4' }).filter((r) => r.std === 'ES5')
            assert.deepEqual(rs.map((r) => [r.field, r.status]), [['e1', 'violation'], ['e2', 'pass'], ['e4', 'pass']], 'e2 有爭議兩方、e4 已交 RS4、e3 一端已撤不檢')
            assert.match(rs[0].detail, /已記為見過而無處置結構/)
            assert.equal(checkCore(s, ctx).filter((r) => r.std === 'ES5').length, 0)
        })

        it('ES5 之判定材料 es5CtxOf(掃描與存量處置同一函數):衝突型取關聯 domain 之型別解析——現名與改名表之舊名皆認得(與提煉段讀衝突邊同一規則);已交 RS4 核對＝RS4 待判(任一狀態)', () => {
            const dom = createRelateDomain({ vocab: { relationTypes: ['互補搭配', '矛盾'], conflictType: '矛盾', fallbackType: '互補搭配', relationTypeRenames: { 衝突: '矛盾' } } })
            const edges = [
                { id: 'e1', from: 'a', to: 'b', type: '矛盾' },
                { id: 'e2', from: 'c', to: 'd', type: '衝突' }, // 改名之舊名(維護改寫前之一輪)
                { id: 'e3', from: 'e', to: 'f', type: '互補搭配' },
            ]
            const holds = [{ object: 'edge', oid: 'e2', std: 'RS4', status: 'resolved' }, { object: 'edge', oid: 'e3', std: 'RS6', status: 'open' }]
            const x = es5CtxOf(edges, holds, dom)
            assert.deepEqual([x.conflictEndsOf('e1'), x.conflictEndsOf('e2'), x.conflictEndsOf('e3')], [['a', 'b'], ['c', 'd'], null])
            assert.deepEqual([x.rs4HeldOf('e1'), x.rs4HeldOf('e2'), x.rs4HeldOf('e3')], [false, true, false])
            assert.equal(es5CtxOf(edges, null, dom).rs4HeldOf('e2'), false, '未開 holds 集合 → 無已交者')
        })
    })
})
