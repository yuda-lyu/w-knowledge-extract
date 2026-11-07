// unit-extract-direct.test.mjs — 公開模組匯出件之直接單元案:以往只經 runPass 黑箱涵蓋者,逐件依其檔頭／JSDoc 之規則句直接斷言
// 規則出處(每條斷言之上一行註明所對之規則句):
//   guards/similarity.mjs     檔頭【判準】【字組袋必須快取】與 bagOf／containment／bestContainment／mutualContainment／sameNegation／sameSubstance 之 JSDoc(thr=0.7)
//   workflow/candidates.mjs   檔頭【穩定 id 依席位】【計票以實際成交之 provider】【程式聯集保留單票者】與 remapRefs／prefixCandidate／trialApply／voteOps／
//                             programUnion／refAliasOf／validateVia／closeRefs／droppedMajority／applyRefAliases／refsOf／stripProgramFields 之 JSDoc
//                             與檔頭【整合員改 ref 名:「候選 ref → 輸出 ref／輸出操作」之對照只定義一份】(EXT-28;使用端 Gitea #91)
//   standards/opGuards.mjs    檔頭【補丁守門依操作類別映射】與 CONSTRUCTIVE_OPS／DESTRUCTIVE_OPS／textFieldsOf／opClass／rewriteTextFields 之 JSDoc
//   standards/parse.mjs       「各棒之形狀檢查(嚴格布林…)」與檔頭【為何只收含鍵之物件、取最後一個合格者】
//   domain/prompts.mjs        檔頭【規則表單一來源】【契約段】【依據】【稱呼只有一種機制】【意見類型由常數產生】與四函數之 JSDoc
//   stores/contentCache.mjs   bodyHashOf 之 JSDoc(正文雜湊:原文標題＋內容章,不含投影章與來源章,空白正規化;md 為空回 null)
//   standards/recheck.mjs     檔頭【到期】【理由之值只此一份】與 RECHECK_REASONS／URGENT_RECHECK_REASONS 之 JSDoc
// 執行:自套件根 node <mocha> test/unit-extract-direct.test.mjs(純函數;不寫檔、不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import { bagOf, containment, bestContainment, mutualContainment, sameNegation, sameSubstance } from '../src/guards/similarity.mjs'
import { remapRefs, prefixCandidate, trialApply, voteOps, programUnion, refAliasOf, validateVia, droppedMajority, applyRefAliases, refsOf, closeRefs, stripProgramFields } from '../src/workflow/candidates.mjs'
import { CONSTRUCTIVE_OPS, DESTRUCTIVE_OPS, textFieldsOf, opClass, rewriteTextFields } from '../src/standards/opGuards.mjs'
import { checkAudit, checkPatch, checkVerdicts, parseDraft, parseAudit, parsePatch } from '../src/standards/parse.mjs'
import { buildIntegratePrompt, buildAuditPrompt, buildRevisePrompt, buildAcceptAppendix } from '../src/domain/prompts.mjs'
import { bodyHashOf } from '../src/stores/contentCache.mjs'
import { RECHECK_REASONS, URGENT_RECHECK_REASONS } from '../src/standards/recheck.mjs'
import { emptyState } from '../src/stores/coreState.mjs'
import { applyDelta } from '../src/stores/coreDelta.mjs'
import { ISSUE_TYPES } from '../src/workflow/reviewGuards.mjs'
import { numberSet } from '../src/core/summarizePackage.mjs'
import { DELTA_OPS, CONSOLIDATE_OPS, TERMINAL_OPS } from '../src/WKnowledgeExtract.mjs'


// ═══════════════════════ 夾具(中立題材:天文) ═══════════════════════

// 38 個互異且不含數字、否定字、簡繁異形之字(造「共享 k 個雙字組」之字串用)
const POOL = [...'恆星行衛彗隕塵軌道光譜紅移黑洞脈衝暗質宇宙微波背景藍矮巨超新爆發環冰氣雲潮汐']

/** 造兩字串:各有 n 個雙字組、共享 k 個(兩向包含率皆為 k/n);字池須足以供 2n+1-k 個互異字 */
const pairOf = (n, k) => [POOL.slice(0, n + 1).join(''), POOL.slice(0, k + 1).join('') + POOL.slice(n + 1, n + 1 + (n - k)).join('')]
const bigramCount = (s) => [...bagOf(s).values()].reduce((x, y) => x + y, 0)
/** 夾具前提:兩字串各 n 個雙字組、包含率皆為 k/n */
const checkPair = ([a, b], n, k) => {
    assert.equal(bigramCount(a), n, '夾具:甲之雙字組數')
    assert.equal(bigramCount(b), n, '夾具:乙之雙字組數')
    assert.equal(containment(a, b), k / n, '夾具:甲→乙之包含率')
    assert.equal(containment(b, a), k / n, '夾具:乙→甲之包含率')
}

const BASE = '恆星核心之氫融合速率隨質量增加而提高'
const T1 = BASE
const T2 = '恆星核心之氫融合速率隨質量增加而提高並縮短壽命' // T1 加一段:與 T1 相似(雙向包含率 ≥0.6)
const T3 = '褐矮星缺乏足夠質量維持氫融合' // 與 T1、T2 無關

/** 新增類候選操作(帶程式欄位 _oid) */
const addOp = (oid, text, o = {}) => ({ op: 'add', kind: 'rule', text, basis: '觀測', sources: ['N1'], _oid: oid, ...o })
/** 取提示詞之某【章】內文(至下一個空行後之【為止) */
const secOf = (prompt, name) => (prompt.split(`【${name}】`)[1] || '').split('\n\n【')[0]
/** 取提示詞【輸出格式】章之範例 JSON 行 */
const exampleOf = (prompt) => secOf(prompt, '輸出格式').split('\n').find((l) => l.startsWith('{'))


describe('unit-extract-direct', function() {

    // ═══════════════════════ guards/similarity ═══════════════════════
    describe('guards/similarity', function() {

        it('bagOf:雙字組袋含次數(「甲乙甲乙」→ 甲乙×2、乙甲×1)', () => {
            // 規則:similarity.mjs 檔頭【判準】「雙字組袋」;bagOf JSDoc「回傳 雙字組 → 次數」
            const bag = bagOf('甲乙甲乙')
            assert.equal(bag.size, 2)
            assert.equal(bag.get('甲乙'), 2)
            assert.equal(bag.get('乙甲'), 1)
        })

        it('bagOf:單字元字串以該字為一袋', () => {
            // 規則:bagOf JSDoc「單字元字串以該字為一袋」
            assert.deepEqual([...bagOf('甲')], [['甲', 1]])
        })

        it('bagOf:先正規化(去空白與標點、小寫、簡轉繁折疊)再取字組', () => {
            // 規則:檔頭【判準】「正規化＝NFKC＋簡轉繁折疊＋小寫＋去空白標點符號」
            assert.deepEqual([...bagOf('Ab, C d！')], [...bagOf('abcd')])
            assert.deepEqual([...bagOf('发射塔')], [...bagOf('發射塔')])
        })

        it('bagOf:空字串、null、純標點為空袋;非字串以 String 轉', () => {
            // 規則:bagOf JSDoc「@param s 輸入任意值」;normText 去標點後無字則無字組
            assert.equal(bagOf('').size, 0)
            assert.equal(bagOf(null).size, 0)
            assert.equal(bagOf('，。 ').size, 0)
            assert.deepEqual([...bagOf(123)], [['12', 1], ['23', 1]])
        })

        it('bagOf:字組袋快取——同一輸入回同一個袋(同一實體)', () => {
            // 規則:檔頭【字組袋必須快取】「每次重建字組袋時,多份補丁之重放耗時以分鐘計,快取後降至秒級、結果逐字相同」
            assert.equal(bagOf(T1), bagOf(T1))
            assert.deepEqual([...bagOf(T1)], [...bagOf(T1)])
        })

        it('containment:有向——JSDoc 範例「光合作用」在「植物之光合作用效率」內為 1,反向為 3/8', () => {
            // 規則:containment JSDoc「a 之雙字組有多少比例出現在 b」與其 @example(=== 1)
            assert.equal(containment('光合作用', '植物之光合作用效率'), 1)
            // 反向:「植物之光合作用效率」有 8 個雙字組,只有光合、合作、作用 3 個在「光合作用」內
            assert.equal(containment('植物之光合作用效率', '光合作用'), 3 / 8)
        })

        it('containment:a 為空回 0;完全相同為 1;互不相交為 0', () => {
            // 規則:containment JSDoc「a 為空回 0」「@returns 0～1」
            assert.equal(containment('', T1), 0)
            assert.equal(containment('，。', T1), 0)
            assert.equal(containment(T1, ''), 0)
            assert.equal(containment(T1, T1), 1)
            assert.equal(containment(T1, '甲乙丙丁戊己'), 0)
        })

        it('containment:以袋計次數(a 之重複字組不因 b 只有一份而全算在內)', () => {
            // 規則:檔頭【判準】「雙字組袋之有向包含率」(袋＝含次數):甲乙×3、乙甲×2 共 5 個,b 只有甲乙×1 → 1/5
            assert.equal(containment('甲乙甲乙甲乙', '甲乙'), 1 / 5)
        })

        it('bestContainment:a 在清單中之最大包含率;非陣列或空清單為 0', () => {
            // 規則:bestContainment JSDoc「a 在清單中之最佳包含率」「list 非陣列視為空」
            const list = [T3, T2, '全然無關之文字內容']
            assert.equal(bestContainment(T1, list), Math.max(...list.map((b) => containment(T1, b))))
            assert.equal(bestContainment('光合作用', ['甲乙丙丁', '植物之光合作用效率', '戊己庚辛']), 1)
            assert.equal(bestContainment(T1, []), 0)
            assert.equal(bestContainment(T1, null), 0)
            assert.equal(bestContainment(T1, 'T1'), 0)
        })

        it('mutualContainment:兩方向之較小者(對稱);短句被長句包含不算重複', () => {
            // 規則:mutualContainment JSDoc「雙向包含率(兩方向之較小者):判『實質相同』用,避免短句被長句包含即誤判重複」
            const a = '光合作用'
            const b = '植物之光合作用效率'
            assert.equal(containment(a, b), 1)
            assert.equal(mutualContainment(a, b), Math.min(containment(a, b), containment(b, a)))
            assert.equal(mutualContainment(a, b), 3 / 8)
            assert.equal(mutualContainment(a, b), mutualContainment(b, a))
            assert.equal(mutualContainment(T1, T1), 1)
        })

        it('sameNegation:否定詞集合一致才 true(都沒有、或兩句有同一組)', () => {
            // 規則:sameNegation JSDoc「兩句之否定詞集合是否一致」;檔頭 NEGATIONS 註解「判實質相同時兩句之否定詞集合須一致」
            assert.equal(sameNegation(BASE, BASE), true)
            assert.equal(sameNegation('恆星不會爆炸', '行星不會爆炸'), true)
            // 一句有「不」、另一句沒有 → 結論可能相反
            assert.equal(sameNegation(BASE, '恆星核心之氫融合速率隨質量增加而不提高'), false)
            // 兩句各有否定,但詞不同(未／不)→ 集合不一致
            assert.equal(sameNegation('甲星未被觀測到', '甲星不被觀測到'), false)
        })

        it('sameNegation:字形折疊後比對(简体「无」「没有」與繁體同)', () => {
            // 規則:sameNegation JSDoc「(字形折疊後比對)」
            assert.equal(sameNegation('黑洞无法逃脱', '黑洞無法逃脫'), true)
            assert.equal(sameNegation('此星没有伴星', '此星沒有伴星'), true)
        })

        it('sameSubstance:三條件皆成立才算——格式差異(大小寫、全形空白、標點)不影響、完全相同為 true', () => {
            // 規則:sameSubstance JSDoc「雙向包含率 ≥ thr、數字集合相同、否定詞集合一致——三者皆成立才算」
            assert.equal(sameSubstance('Hubble 常數', 'hubble　常數！'), true)
            assert.equal(sameSubstance(T1, T1), true)
            assert.equal(sameSubstance(T1, `${T1}。`), true)
        })

        it('sameSubstance:數字集合不同 → false(即使包含率高;「誤差 3% 與誤差 5% 不是同一主張」)', () => {
            // 規則:sameSubstance 內註解「一位數帶事實單位者亦計(誤差 3% 與誤差 5% 不是同一主張)」;JSDoc「數字集合相同」
            const a = `${BASE}，測量誤差約 3%`
            const b = `${BASE}，測量誤差約 5%`
            assert.ok(mutualContainment(a, b) >= 0.7, '夾具:包含率已過門檻,唯一差別是數字')
            assert.notDeepEqual([...numberSet(a)], [...numberSet(b)], '夾具:數字集合確實不同')
            assert.equal(sameSubstance(a, b), false)
            assert.equal(sameSubstance(a, `${a}。`), true, '對照:數字相同則成立')
            const c = `${BASE}，週期約 11 年`
            const d = `${BASE}，週期約 12 年`
            assert.ok(mutualContainment(c, d) >= 0.7)
            assert.equal(sameSubstance(c, d), false)
        })

        it('sameSubstance:否定詞集合不同 → false(即使包含率高、數字相同)', () => {
            // 規則:sameSubstance JSDoc「否定詞集合一致」;檔頭「單向 ≥0.6 會把結論相反…之新主張吞成確認」
            const neg = '恆星核心之氫融合速率隨質量增加而不提高'
            assert.ok(mutualContainment(BASE, neg) >= 0.7, '夾具:包含率已過門檻,唯一差別是否定詞')
            assert.equal(sameSubstance(BASE, neg), false)
        })

        it('sameSubstance:雙向包含率不足 → false;單向包含(短句在長句內)不算', () => {
            // 規則:sameSubstance JSDoc「雙向包含率 ≥ thr」;mutualContainment JSDoc「避免短句被長句包含即誤判重複」
            assert.equal(sameSubstance(T1, T3), false)
            assert.equal(containment('光合作用', '植物之光合作用效率'), 1, '夾具:單向包含為 1')
            assert.equal(sameSubstance('光合作用', '植物之光合作用效率'), false)
        })

        it('sameSubstance 閾值 thr=0.7 邊界:恰在(7/10)算、略低(16/23=0.696)不算、略高(12/17=0.706)算', () => {
            // 規則:sameSubstance JSDoc「@param thr=0.7 雙向包含率門檻」與判式「mutualContainment(a, b) < thr → false」(即 ≥ thr 才可能算)
            const at = pairOf(10, 7)
            const below = pairOf(23, 16)
            const above = pairOf(17, 12)
            checkPair(at, 10, 7)
            checkPair(below, 23, 16)
            checkPair(above, 17, 12)
            // 先以 mutualContainment 算出實值,sameSubstance 之判定須與「實值 ≥ 0.7」一致
            for (const [a, b] of [at, below, above]) {
                assert.equal(sameSubstance(a, b), mutualContainment(a, b) >= 0.7, `mutual=${mutualContainment(a, b)}`)
            }
            assert.equal(mutualContainment(...at), 0.7)
            assert.equal(sameSubstance(...at), true, '恰在門檻:算')
            assert.ok(mutualContainment(...below) < 0.7)
            assert.equal(sameSubstance(...below), false, '略低:不算')
            assert.ok(mutualContainment(...above) > 0.7)
            assert.equal(sameSubstance(...above), true, '略高:算')
        })

        it('sameSubstance 之 thr 參數:門檻等於實值 → 算、高於實值一點點 → 不算;省略即 0.7', () => {
            // 規則:sameSubstance JSDoc「@param thr 輸入雙向包含率門檻(預設 0.7)」
            const [a, b] = pairOf(10, 5)
            checkPair([a, b], 10, 5)
            assert.equal(mutualContainment(a, b), 0.5)
            assert.equal(sameSubstance(a, b), false, '預設 0.7 > 0.5')
            assert.equal(sameSubstance(a, b, 0.5), true)
            assert.equal(sameSubstance(a, b, 0.5 + 1e-9), false)
            assert.equal(sameSubstance(a, b, 0.4), true)
            for (const [x, y] of [pairOf(10, 7), pairOf(23, 16), pairOf(17, 12), pairOf(10, 5)]) {
                assert.equal(sameSubstance(x, y), sameSubstance(x, y, 0.7), '省略 thr ＝ 0.7')
            }
        })
    })


    // ═══════════════════════ workflow/candidates ═══════════════════════
    describe('workflow/candidates', function() {

        it('remapRefs:@ref 之單值欄、陣列欄、sides／sides_add 之 claims、文字中之〔@ref〕皆改寫;既有條目編號不動;回同一操作', () => {
            // 規則:remapRefs JSDoc「操作內之 '@ref' 改寫(含 sides／sides_add 之 claims 與文字中之〔@ref〕)」「回傳同一操作」「map:(ref) => 新 ref(不含 @)」
            const op = {
                op: 'dispute_add', ref: 'd', question: '兩說何者成立',
                id: '@x', into: 'C1', claims: ['@r1', 'C2'], from: ['@r2', 'C9'],
                sides: [{ position: '甲', claims: ['@r1', 'C3'] }, { position: '乙', claims: ['@r2'] }],
                sides_add: [{ position: '丙', claims: ['@r1'] }],
                text: '依〔@r2〕與〔C5〕', note: '見〔@r1〕與〔@r3〕',
            }
            const seen = []
            const r = remapRefs(op, (x) => {
                seen.push(x)
                return `s2_${x}`
            })
            assert.equal(r, op, '就地修改並回同一操作')
            assert.equal(op.id, '@s2_x')
            assert.equal(op.into, 'C1', '非 @ 之既有條目編號不動')
            assert.deepEqual(op.claims, ['@s2_r1', 'C2'])
            assert.deepEqual(op.from, ['@s2_r2', 'C9'])
            assert.deepEqual(op.sides[0].claims, ['@s2_r1', 'C3'])
            assert.deepEqual(op.sides[1].claims, ['@s2_r2'])
            assert.deepEqual(op.sides_add[0].claims, ['@s2_r1'])
            assert.equal(op.text, '依〔@s2_r2〕與〔C5〕', '文字中之〔@ref〕改寫、〔C5〕不動')
            assert.equal(op.note, '見〔@s2_r1〕與〔@s2_r3〕')
            assert.ok(seen.length > 0 && seen.every((x) => !x.startsWith('@')), 'map 收到之 ref 不含 @')
            assert.ok(!seen.includes('C1') && !seen.includes('C2'), '既有條目編號不交給 map')
            assert.equal(op.ref, 'd', 'ref 為定義而非引用:不由 remapRefs 改')
        })

        it('prefixCandidate:每條操作給穩定 id a{席}_{n}、ref 改 a{席}_{ref}、引用同步改寫、標席位;skipped 與合格之 conflicts 標席位', () => {
            // 規則:prefixCandidate JSDoc「每條操作給穩定 id(a{席}_{n})、ref 改為 a{席}_{ref}、引用同步改寫;skipped 與衝突去向之宣告(conflicts,檢定標準 ES5)標席位」
            const delta = {
                ops: [
                    { op: 'add', ref: 'a', kind: 'rule', text: '依〔@b〕之觀測', sources: ['N1'] },
                    { op: 'add', ref: 'b', kind: 'rule', text: '另一條', sources: ['N1'] },
                    { op: 'essence', text: '本質', claims: ['@a'], reason: '首版' },
                    { op: 'confirm', id: 'C1', sources: ['N1'] },
                ],
                skipped: [{ note: 'N2', reason: '離題' }],
                conflicts: [{ edge: 'r3', disposition: '立爭議', reason: '兩說相反' }],
            }
            const r = prefixCandidate(delta, 2)
            assert.deepEqual(r.ops.map((o) => o._oid), ['a2_1', 'a2_2', 'a2_3', 'a2_4'])
            assert.ok(r.ops.every((o) => o._seat === 2))
            assert.equal(r.ops[0].ref, 'a2_a')
            assert.equal(r.ops[1].ref, 'a2_b')
            assert.equal(r.ops[0].text, '依〔@a2_b〕之觀測', '文字引用同步改寫')
            assert.deepEqual(r.ops[2].claims, ['@a2_a'], '引用同步改寫')
            assert.equal(r.ops[3].id, 'C1', '既有條目編號不動')
            assert.equal(r.ops[3].ref, undefined, '原無 ref 者不憑空加')
            assert.deepEqual(r.skipped, [{ note: 'N2', reason: '離題', _seat: 2 }])
            assert.deepEqual(r.conflicts, [{ edge: 'R3', disposition: '立爭議', reason: '兩說相反', _seat: 2 }])
        })

        it('prefixCandidate:回新物件不改輸入;不合格之衝突宣告丟棄;非物件之操作丟棄;空輸入回空三件', () => {
            // 規則:prefixCandidate JSDoc「@returns 回傳 { ops, skipped, conflicts }(新物件)」;conflictDisposition.normalizeConflictDecl JSDoc「不合者丟棄」
            const delta = {
                ops: [null, 'x', { op: 'add', ref: 'a', kind: 'rule', text: '甲', sources: ['N1'] }],
                conflicts: [{ edge: 'bad', disposition: '立爭議' }, { edge: 'R4', disposition: '不存在之去向' }, { edge: 'R5', disposition: '非對立', reason: '理由' }],
            }
            const before = JSON.parse(JSON.stringify(delta))
            const r = prefixCandidate(delta, 1)
            assert.deepEqual(delta, before, '輸入不被改動')
            assert.notEqual(r.ops[0], delta.ops[2], '操作為新物件')
            assert.equal(r.ops.length, 1)
            assert.match(r.ops[0]._oid, /^a1_\d+$/)
            assert.deepEqual(r.conflicts.map((x) => x.edge), ['R5'])
            assert.deepEqual(prefixCandidate(null, 3), { ops: [], skipped: [], conflicts: [] })
            assert.deepEqual(prefixCandidate(undefined, 3), { ops: [], skipped: [], conflicts: [] })
        })

        it('prefixCandidate:不同席位之 id 與 ref 互不相撞', () => {
            // 規則:檔頭【穩定 id 依席位而非成功候選之序】「以席位序號給 id(a{席}_{n})」——三席之候選合併後 id 不得重複
            const delta = { ops: [{ op: 'add', ref: 'a', kind: 'rule', text: '甲', sources: ['N1'] }, { op: 'confirm', id: 'C1', sources: ['N1'] }] }
            const all = [1, 2, 3].map((seat) => prefixCandidate(delta, seat))
            const oids = all.flatMap((c) => c.ops.map((o) => o._oid))
            const refs = all.flatMap((c) => c.ops.map((o) => o.ref)).filter(Boolean)
            assert.equal(new Set(oids).size, oids.length)
            assert.equal(new Set(refs).size, refs.length)
        })

        it('trialApply:以 applyDelta 套於複本(不落盤),拒收者標 _trial＝理由,回 { applied, rejected } 計數', () => {
            // 規則:trialApply JSDoc「以 applyDelta 套於複本(不落盤),標出會被拒收之操作(_trial＝理由)」「@returns { applied:Integer, rejected:Integer }」
            const state = emptyState({ coreId: 'c', concept: '潮汐' })
            const stateBefore = JSON.parse(JSON.stringify(state))
            const ctx = { batch: [{ code: 'N1', id: 'n1' }], mode: 'delta', at: '2026-10-30T10:00:00+08:00' }
            const mk = () => [
                { op: 'add', kind: 'rule', text: '潮汐鎖定使衛星同一面恆朝向行星', basis: '觀測', sources: ['N1'] },
                { op: 'add', kind: 'rule', text: '另一條缺出處之主張', basis: '觀測', sources: ['N9'] },
                { op: 'zzz' },
            ]
            const expected = applyDelta(state, { ops: mk() }, ctx).rejected
            assert.equal(expected.length, 2, '夾具:第二、三條會被 applyDelta 拒收')
            const ops = mk()
            const r = trialApply(state, ops, ctx)
            assert.deepEqual(r, { applied: 1, rejected: 2 })
            assert.equal(ops[0]._trial, undefined, '被收者不標')
            for (const x of expected) assert.equal(ops[x.index]._trial, x.reason, '_trial ＝ applyDelta 之拒收理由')
            assert.deepEqual(state, stateBefore, '不落盤:輸入狀態不被改動')
        })

        it('trialApply:ctx 原樣交 applyDelta(claimKinds 限縮 → 該種類之 add 被拒)', () => {
            // 規則:trialApply JSDoc「@param ctx 輸入 applyDelta 之 ctx(batch、mode、claimKinds、limits)」
            const state = emptyState({ coreId: 'c', concept: '潮汐' })
            const op = { op: 'add', kind: 'rule', text: '潮汐鎖定使衛星同一面恆朝向行星', basis: '觀測', sources: ['N1'] }
            const batch = [{ code: 'N1', id: 'n1' }]
            assert.deepEqual(trialApply(state, [{ ...op }], { batch }), { applied: 1, rejected: 0 })
            const ops = [{ ...op }]
            assert.deepEqual(trialApply(state, ops, { batch, claimKinds: ['principle'] }), { applied: 0, rejected: 1 })
            assert.ok(ops[0]._trial)
        })

        it('voteOps:每條操作之支持席位與票數(相異 provider 數);相似者互為 similar、無關者單票', () => {
            // 規則:voteOps JSDoc「每條操作之支持席位(以實際成交 provider 去重)」「@returns Map _oid → { votes(相異 provider 數), seats, similar(_oid) }」
            const cands = [
                { seat: 1, provider: 'p1', ops: [addOp('a1_1', T1)] },
                { seat: 2, provider: 'p2', ops: [addOp('a2_1', T2)] },
                { seat: 3, provider: 'p3', ops: [addOp('a3_1', T3)] },
            ]
            const v = voteOps(cands)
            assert.ok(v instanceof Map)
            assert.equal(v.get('a1_1').votes, 2)
            assert.deepEqual([...v.get('a1_1').seats].sort(), [1, 2])
            assert.deepEqual(v.get('a1_1').similar, ['a2_1'])
            assert.equal(v.get('a2_1').votes, 2)
            assert.deepEqual(v.get('a2_1').similar, ['a1_1'])
            assert.equal(v.get('a3_1').votes, 1)
            assert.deepEqual(v.get('a3_1').seats, [3])
            assert.deepEqual(v.get('a3_1').similar, [])
        })

        it('voteOps:同一 provider 只算一票(三席首選失敗而同落同一遞補家)', () => {
            // 規則:檔頭【計票以實際成交之 provider】「同一 provider 只算一票」
            const mk = (providers) => voteOps(providers.map((p, k) => ({ seat: k + 1, provider: p, ops: [addOp(`a${k + 1}_1`, T1)] })))
            const twoSame = mk(['p1', 'p1', 'p3'])
            assert.equal(twoSame.get('a1_1').votes, 2)
            assert.equal(twoSame.get('a3_1').votes, 2)
            const allSame = mk(['p1', 'p1', 'p1'])
            for (const oid of ['a1_1', 'a2_1', 'a3_1']) assert.equal(allSame.get(oid).votes, 1, oid)
            const allDiff = mk(['p1', 'p2', 'p3'])
            for (const oid of ['a1_1', 'a2_1', 'a3_1']) assert.equal(allDiff.get(oid).votes, 3, oid)
        })

        it('voteOps:同一席位內之操作不互相支持(跨候選計票)', () => {
            // 規則:voteOps JSDoc「跨候選計票」——同席之兩條相同文字不構成兩票
            const v = voteOps([{ seat: 1, provider: 'p1', ops: [addOp('a1_1', T1), addOp('a1_2', T1)] }])
            assert.equal(v.get('a1_1').votes, 1)
            assert.deepEqual(v.get('a1_1').similar, [])
            assert.equal(v.get('a1_2').votes, 1)
        })

        it('voteOps:改狀態類以「操作＋目標」比對、新增類(add／dispute_add／param_add／question_add)以文字比對;操作名不同不相似', () => {
            // 規則:candidates.mjs sigOf 註解「操作之比對簽章:改狀態類以『操作＋目標』,新增類以文字」
            const two = (a, b) => voteOps([{ seat: 1, provider: 'p1', ops: [{ ...a, _oid: 'a1_1' }] }, { seat: 2, provider: 'p2', ops: [{ ...b, _oid: 'a2_1' }] }])
            // 改狀態類:同操作同目標 → 相似;目標不同 → 否
            assert.equal(two({ op: 'retract', id: 'C1', reason: '重複' }, { op: 'retract', id: 'C1', reason: '離題' }).get('a1_1').votes, 2)
            assert.equal(two({ op: 'retract', id: 'C1', reason: '重複' }, { op: 'retract', id: 'C2', reason: '重複' }).get('a1_1').votes, 1)
            assert.equal(two({ op: 'retract', id: 'C1' }, { op: 'supersede', id: 'C1' }).get('a1_1').votes, 1, '操作名不同')
            // 新增類:同操作同文字 → 相似;同文字而操作名不同 → 否
            const same = [
                [{ op: 'add', text: T1 }, { op: 'add', text: T1 }],
                [{ op: 'dispute_add', question: T1 }, { op: 'dispute_add', question: T1 }],
                [{ op: 'param_add', name: '週期', value: '甚長' }, { op: 'param_add', name: '週期', value: '甚長' }],
                [{ op: 'question_add', text: T1 }, { op: 'question_add', text: T1 }],
            ]
            for (const [a, b] of same) assert.equal(two(a, b).get('a1_1').votes, 2, a.op)
            assert.equal(two({ op: 'add', text: T1 }, { op: 'question_add', text: T1 }).get('a1_1').votes, 1, '文字同而操作名不同')
            assert.equal(two({ op: 'add', text: T1 }, { op: 'add', text: T3 }).get('a1_1').votes, 1, '文字無關')
        })

        it('programUnion:保留全部未被試套拒收之操作(含單票者),相似者合為一條(出處取聯集、文字取長者),每條附 _via', () => {
            // 規則:programUnion JSDoc「保留全部未被試套拒收之操作,相似者合為一條(取票多、文字長者為代表,出處取聯集),每條附 _via」;檔頭【程式聯集保留單票者】
            assert.ok(mutualContainment(T1, T2) >= 0.6 && mutualContainment(T1, T3) < 0.6, '夾具:T1、T2 相似,T3 無關')
            const cands = [
                { seat: 1, provider: 'p1', ops: [addOp('a1_1', T1, { sources: ['N1'] })] },
                { seat: 2, provider: 'p2', ops: [addOp('a2_1', T2, { sources: ['N2'] }), addOp('a2_2', T1, { sources: ['N3'], _trial: '無本批出處' })] },
                { seat: 3, provider: 'p3', ops: [addOp('a3_1', T3, { sources: ['N4'] })] },
            ]
            const snapshot = JSON.parse(JSON.stringify(cands))
            const out = programUnion(cands, voteOps(cands))
            assert.equal(out.length, 2, '相似者合併為一、單票者保留、試套被拒者不入')
            const merged = out.find((o) => o._via.includes('a1_1'))
            assert.deepEqual([...merged._via].sort(), ['a1_1', 'a2_1'])
            assert.equal(merged.text, T2, '票數相同取文字較長者')
            assert.deepEqual([...merged.sources].sort(), ['N1', 'N2'], '出處取聯集')
            assert.equal(merged._votes, 2)
            const single = out.find((o) => o._via.includes('a3_1'))
            assert.equal(single.text, T3, '單票者照收')
            assert.deepEqual(single._via, ['a3_1'])
            assert.equal(single._votes, 1)
            assert.ok(!out.some((o) => o._via.includes('a2_2')), '試套被拒者不入聯集、也不入任何 _via')
            assert.deepEqual(cands, snapshot, '輸入候選不被改動(代表操作取複本)')
        })

        it('programUnion:代表操作取票數多者(再比文字長度)', () => {
            // 規則:programUnion JSDoc「取票多、文字長者為代表」——票數優先於文字長度
            const cands = [
                { seat: 1, provider: 'p1', ops: [addOp('a1_1', T1)] },
                { seat: 2, provider: 'p2', ops: [addOp('a2_1', T2)] },
            ]
            const votes = new Map([['a1_1', { votes: 3, seats: [1], similar: ['a2_1'] }], ['a2_1', { votes: 1, seats: [2], similar: ['a1_1'] }]])
            const out = programUnion(cands, votes)
            assert.equal(out.length, 1)
            assert.equal(out[0].text, T1, '票多者(較短)為代表')
            assert.equal(out[0]._votes, 3)
            assert.deepEqual(programUnion([], new Map()), [])
        })

        it('programUnion:操作名不同不合併;related_add 之關聯概念取聯集', () => {
            // 規則:candidates.mjs programUnion 內註解「關聯概念取聯集」;sigOf「操作名不同不相似」
            const cands = [
                { seat: 1, provider: 'p1', ops: [{ op: 'related_add', concepts: ['潮汐鎖定', '軌道共振'], sources: ['N1'], _oid: 'a1_1' }, addOp('a1_2', T1)] },
                { seat: 2, provider: 'p2', ops: [{ op: 'related_add', concepts: ['軌道共振', '洛希極限'], sources: ['N2'], _oid: 'a2_1' }, { op: 'question_add', text: T1, sources: ['N2'], _oid: 'a2_2' }] },
            ]
            const out = programUnion(cands, voteOps(cands))
            const rel = out.filter((o) => o.op === 'related_add')
            assert.equal(rel.length, 1)
            assert.deepEqual([...rel[0].concepts].sort(), ['潮汐鎖定', '洛希極限', '軌道共振'].sort())
            assert.equal(out.filter((o) => o.op === 'add').length, 1, 'add 與 question_add 即使文字相同亦不合併')
            assert.equal(out.filter((o) => o.op === 'question_add').length, 1)
        })

        it('programUnion:dispute_update 之補方取聯集(同立場去重)、說明取長者', () => {
            // 規則:programUnion 內註解「爭議補方取聯集(同立場者去重)、說明取長者(終審 §3 D5i)」
            const cands = [
                { seat: 1, provider: 'p1', ops: [{ op: 'dispute_update', id: 'D1', note: '短說明', sides_add: [{ position: '甲說', claims: ['C1'] }], sources: ['N1'], _oid: 'a1_1' }] },
                { seat: 2, provider: 'p2', ops: [{ op: 'dispute_update', id: 'D1', note: '較長之說明文字', sides_add: [{ position: '甲說' }, { position: '乙說' }], sources: ['N2'], _oid: 'a2_1' }] },
            ]
            const out = programUnion(cands, voteOps(cands))
            assert.equal(out.length, 1)
            assert.deepEqual(out[0].sides_add.map((s) => s.position).sort(), ['乙說', '甲說'])
            assert.equal(out[0].note, '較長之說明文字')
        })

        describe('validateVia', function() {
            const byOid = new Map([
                ['a1_1', addOp('a1_1', T1, { sources: ['N1'] })],
                ['a2_1', addOp('a2_1', T2, { sources: ['N2'] })],
                ['a3_1', { op: 'retract', id: 'C2', reason: '重複', _oid: 'a3_1' }],
                ['a3_2', { op: 'dispute_add', question: '兩說何者成立', sides: [{ position: '甲', sources: ['N1'] }, { position: '乙', sources: ['N2'] }], _oid: 'a3_2' }],
            ])

            it('合格:via 指回候選、種類與出處與文字皆合 → 通過,附 _via,via 欄移除', () => {
                // 規則:validateVia JSDoc「@returns { ops(通過者,帶 _via), rejected }」
                const r = validateVia([{ op: 'add', kind: 'rule', text: `${T1}。`, sources: ['N1'], via: ['a1_1'] }], byOid)
                assert.equal(r.rejected.length, 0)
                assert.equal(r.ops.length, 1)
                assert.deepEqual(r.ops[0]._via, ['a1_1'])
                assert.equal('via' in r.ops[0], false)
                const two = validateVia([{ op: 'add', kind: 'rule', text: T2, sources: ['N1', 'N2'], via: ['a1_1', 'a2_1'] }], byOid)
                assert.equal(two.ops.length, 1, '合併兩候選:出處可為兩者之聯集')
                assert.deepEqual(two.ops[0]._via, ['a1_1', 'a2_1'])
            })

            it('每條須以 via 指回候選操作:缺 via、空 via、via 全不在候選 → 拒', () => {
                // 規則:validateVia JSDoc「每條須以 via 指回候選操作」;檔頭註「整合不可新增候選沒有之操作」
                const base = { op: 'add', kind: 'rule', text: T1, sources: ['N1'] }
                for (const op of [{ ...base }, { ...base, via: [] }, { ...base, via: ['zzz_9'] }]) {
                    const r = validateVia([op], byOid)
                    assert.equal(r.ops.length, 0)
                    assert.equal(r.rejected.length, 1)
                    assert.match(r.rejected[0].reason, /via/)
                    assert.equal(r.rejected[0].op.text, T1, '拒收項帶原操作')
                }
            })

            it('操作種類須同所引候選之一:整合不可改變操作種類', () => {
                // 規則:validateVia JSDoc「操作種類須同所引候選之一」
                const bad = validateVia([{ op: 'question_add', text: T1, via: ['a1_1'] }], byOid)
                assert.equal(bad.ops.length, 0)
                assert.match(bad.rejected[0].reason, /操作種類/)
                // 所引多個候選時,同其中之一即可
                const ok = validateVia([{ op: 'add', kind: 'rule', text: T1, sources: ['N1'], via: ['a3_1', 'a1_1'] }], byOid)
                assert.equal(ok.ops.length, 1)
            })

            it('改狀態類之目標須同所引候選', () => {
                // 規則:validateVia JSDoc「改狀態類之目標須同所引候選」
                const bad = validateVia([{ op: 'retract', id: 'C9', reason: '重複', via: ['a3_1'] }], byOid)
                assert.equal(bad.ops.length, 0)
                assert.match(bad.rejected[0].reason, /目標/)
                const ok = validateVia([{ op: 'retract', id: 'C2', reason: '重複', via: ['a3_1'] }], byOid)
                assert.equal(ok.ops.length, 1)
            })

            describe('目標為同差量 ref 且整合員已改名(EXT-28)', function() {
                // 規則:validateVia JSDoc「目標為同差量 ref〔'@名'〕且整合員已改名者,候選之目標經 refAliasOf 之輸出名等於輸出之目標視為相同;既有條目編號不經改名表,
                //   真改指他條、或改指候選沒有且輸出亦未定義之 '@名' 仍拒」「兩段式:定義該 ref 之新增本身被拒者不入表」;拒收理由字樣與判式次序不變
                // 夾具:兩席各新增同義條目(ref def)與依附之 param_add(claim @def),經正式 prefixCandidate 得 a{席}_def 與 _oid a{席}_{n}(1＝add、2＝param_add);
                //   第 3 席另有改既有條目 C2 之 retract(a3_1)
                const seatOf = (seat) => prefixCandidate({
                    ops: [
                        { op: 'add', ref: 'def', kind: 'rule', text: T1, basis: '觀測', sources: [`N${seat}`] },
                        { op: 'param_add', claim: '@def', name: '門檻', value: '3', sources: [`N${seat}`] },
                    ],
                    skipped: [],
                }, seat)
                const cands = [1, 2].map((seat) => ({ seat, ...seatOf(seat) }))
                const by = new Map([...cands.flatMap((c) => c.ops.map((op) => [op._oid, op])), ['a3_1', { op: 'retract', id: 'C2', reason: '重複', _oid: 'a3_1' }]])
                const addOut = (ref, o = {}) => ({ op: 'add', ref, kind: 'rule', text: T1, basis: '觀測', sources: ['N1', 'N2'], via: ['a1_1', 'a2_1'], ...o })
                const depOut = (claim, via, src, o = {}) => ({ op: 'param_add', claim, name: '門檻', value: '3', sources: [src], via, ...o })

                it('夾具前提:候選之 ref 與依附目標皆帶席位前綴、_oid 依序', () => {
                    assert.deepEqual([...by.values()].map((o) => `${o._oid}:${o.op}:${o.ref || o.claim || o.id}`), ['a1_1:add:a1_def', 'a1_2:param_add:@a1_def', 'a2_1:add:a2_def', 'a2_2:param_add:@a2_def', 'a3_1:retract:C2'])
                })

                it('場景①去前綴合併:兩席同義新增合為 def,第 2 席之依附操作改指 @def → 通過(目標原樣保留)、拒收 0', () => {
                    const r = validateVia([addOut('def'), depOut('@def', ['a2_2'], 'N2')], by)
                    assert.equal(r.rejected.length, 0, r.rejected[0]?.reason)
                    assert.equal(r.ops.length, 2)
                    assert.equal(r.ops[1].claim, '@def', '目標原樣保留(由輸出之 ref 定義閉包,不需 closeRefs 補)')
                    assert.deepEqual(r.ops[1]._via, ['a2_2'])
                })

                it('場景②保留另一席之名:合併後取第 2 席之名 a2_def,第 1 席之依附操作 via 指 a1_2 而改指 @a2_def → 通過', () => {
                    const r = validateVia([addOut('a2_def'), depOut('@a2_def', ['a1_2'], 'N1')], by)
                    assert.equal(r.rejected.length, 0, r.rejected[0]?.reason)
                    assert.equal(r.ops.length, 2)
                })

                it('依附操作之目標不改(仍寫候選舊名)者維持通過(既有行為:由其後之 closeRefs 別名指向輸出)', () => {
                    const r = validateVia([addOut('def'), depOut('@a2_def', ['a2_2'], 'N2')], by)
                    assert.equal(r.rejected.length, 0, r.rejected[0]?.reason)
                })

                it('真改目標仍拒:改指候選沒有且輸出亦未定義之 @other;理由字樣不變', () => {
                    const r = validateVia([addOut('def'), depOut('@other', ['a2_2'], 'N2')], by)
                    assert.equal(r.ops.length, 1, '只剩 add')
                    assert.equal(r.rejected.length, 1)
                    assert.equal(r.rejected[0].reason, '目標 claim＝@other 與所引候選不同（整合不可改變操作之目標）')
                })

                it('改名表只對回「候選自身之目標」:依附操作 via 指第 2 席而目標寫第 1 席之舊名 @a1_def,即使兩席之新增已合併為 def 仍拒(現況邊界:與修前相同、不放寬)', () => {
                    const r = validateVia([addOut('def'), depOut('@a1_def', ['a2_2'], 'N2')], by)
                    assert.equal(r.ops.length, 1)
                    assert.match(r.rejected[0].reason, /目標 claim＝@a1_def/)
                })

                it('既有條目編號不經改名表:候選改既有 C2 者輸出改指 C9 或 @新名、候選指 @新名者輸出改指既有編號,皆拒', () => {
                    const toOther = validateVia([addOut('def'), { op: 'retract', id: 'C9', reason: '重複', via: ['a3_1'] }], by)
                    assert.match(toOther.rejected[0].reason, /目標 id＝C9/)
                    const toRef = validateVia([addOut('def'), { op: 'retract', id: '@def', reason: '重複', via: ['a3_1'] }], by)
                    assert.match(toRef.rejected[0].reason, /目標 id＝@def/, '候選之目標是既有編號(非 @)→ 不經改名表')
                    const toId = validateVia([addOut('def'), depOut('C2', ['a1_2'], 'N1')], by)
                    assert.match(toId.rejected[0].reason, /目標 claim＝C2/, '候選之目標是 @a1_def,輸出改指既有編號 → 不是改名')
                    const same = validateVia([addOut('def'), { op: 'retract', id: 'C2', reason: '重複', via: ['a3_1'] }], by)
                    assert.equal(same.rejected.length, 0, '同編號照過')
                    // 非 @ 之目標去首字元後即使恰等於改名表之鍵(a1_def→def)亦不經改名表:候選目標 Xa1_def、輸出目標 Xdef 仍視為不同
                    const odd = new Map(by).set('a3_2', { op: 'retract', id: 'Xa1_def', reason: '重複', _oid: 'a3_2' })
                    const viaOdd = validateVia([addOut('def'), { op: 'retract', id: 'Xdef', reason: '重複', via: ['a3_2'] }], odd)
                    assert.equal(viaOdd.rejected.length, 1)
                    assert.match(viaOdd.rejected[0].reason, /目標 id＝Xdef/)
                })

                it('兩段式:定義該 ref 之新增本身被其餘判式拒收(文字、出處)→ 不入改名表,依附操作不因改名而通過(以原理由拒、不留懸空目標)', () => {
                    assert.ok(containment(T1, T3) < 0.5 && containment(T3, T1) < 0.5, '夾具:T3 與 T1 無關')
                    for (const [bad, why] of [[addOut('def', { text: T3 }), /文字/], [addOut('def', { sources: ['N1', 'N2', 'N9'] }), /出處/]]) {
                        const r = validateVia([bad, depOut('@def', ['a2_2'], 'N2')], by)
                        assert.equal(r.ops.length, 0, JSON.stringify(r.ops))
                        assert.equal(r.rejected.length, 2)
                        assert.match(r.rejected[0].reason, why, '定義之新增:其自身之理由')
                        assert.match(r.rejected[1].reason, /目標 claim＝@def/, '依附操作:目標無從對回(定義本身被拒)')
                    }
                    // 定義之新增 via 不合(未指回任何候選)者同
                    const noVia = validateVia([addOut('def', { via: [] }), depOut('@def', ['a2_2'], 'N2')], by)
                    assert.equal(noVia.ops.length, 0)
                    assert.match(noVia.rejected[1].reason, /目標 claim＝@def/)
                })

                it('判式次序不變:目標在出處、文字之前——目標不合者以目標為由,目標已對回而出處超出者以出處為由', () => {
                    const t = validateVia([addOut('def'), depOut('@other', ['a2_2'], 'N9')], by)
                    assert.match(t.rejected[0].reason, /^目標 claim＝@other/, '目標與出處皆不合 → 以目標為由(與修前同)')
                    const s = validateVia([addOut('def'), depOut('@def', ['a2_2'], 'N9')], by)
                    assert.match(s.rejected[0].reason, /^出處 N9 /, '目標已對回、出處超出 → 以出處為由')
                })

                it('候選之定義操作被試套拒收(整合員修正後收入)者仍可對回:改名表以 byOid 全部候選為定義(不同於 closeRefs 之只取回未被拒者)', () => {
                    const trial = new Map(by)
                    trial.set('a1_1', { ...by.get('a1_1'), _trial: '缺標注' })
                    const r = validateVia([addOut('def'), depOut('@def', ['a1_2'], 'N1')], trial)
                    assert.equal(r.rejected.length, 0, r.rejected[0]?.reason)
                })
            })

            it('出處(含各方之出處)不得超出 via 所指操作之出處聯集', () => {
                // 規則:validateVia JSDoc「出處(含各方之出處)不得超出 via 所指操作之出處聯集」
                const extra = validateVia([{ op: 'add', kind: 'rule', text: T1, sources: ['N1', 'N7'], via: ['a1_1'] }], byOid)
                assert.equal(extra.ops.length, 0)
                assert.match(extra.rejected[0].reason, /出處/)
                // 他候選之出處(N2)不在所引之 a1_1 內
                const other = validateVia([{ op: 'add', kind: 'rule', text: T1, sources: ['N2'], via: ['a1_1'] }], byOid)
                assert.equal(other.ops.length, 0)
                // 爭議各方之出處
                const sideBad = validateVia([{ op: 'dispute_add', question: '兩說何者成立', sides: [{ position: '甲', sources: ['N9'] }, { position: '乙' }], via: ['a3_2'] }], byOid)
                assert.equal(sideBad.ops.length, 0)
                assert.match(sideBad.rejected[0].reason, /出處/)
                const sideOk = validateVia([{ op: 'dispute_add', question: '兩說何者成立', sides: [{ position: '甲', sources: ['N1'] }, { position: '乙', sources: ['N2'] }], via: ['a3_2'] }], byOid)
                assert.equal(sideOk.ops.length, 1)
            })

            it('文字須保有 via 原文過半:改成候選沒有之內容 → 拒', () => {
                // 規則:validateVia JSDoc「文字(新增類之 text／question…)須保有 via 原文過半」;拒收理由「整合不可改寫成候選沒有之內容」
                assert.ok(containment(T1, T3) < 0.5 && containment(T3, T1) < 0.5, '夾具:T3 與 T1 無關')
                const bad = validateVia([{ op: 'add', kind: 'rule', text: T3, sources: ['N1'], via: ['a1_1'] }], byOid)
                assert.equal(bad.ops.length, 0)
                assert.match(bad.rejected[0].reason, /文字/)
                // 保有原文(加一段)→ 過
                const ok = validateVia([{ op: 'add', kind: 'rule', text: T2, sources: ['N1'], via: ['a1_1'] }], byOid)
                assert.equal(ok.ops.length, 1)
            })

            it('輸入防呆:ops 非陣列回空結果;非物件之項略過(不入通過、不入拒收)', () => {
                // 規則:validateVia JSDoc「@param ops 輸入整合者回傳之操作(各帶 via:Array)」;@returns { ops, rejected } 恆為陣列
                assert.deepEqual(validateVia(null, byOid), { ops: [], rejected: [] })
                assert.deepEqual(validateVia(undefined, byOid), { ops: [], rejected: [] })
                assert.deepEqual(validateVia([null, 'x', 3], byOid), { ops: [], rejected: [] })
            })
        })

        describe('refAliasOf 與 closeRefs 共用同一份「候選 ref → 輸出 ref／輸出操作」對照(EXT-28)', function() {
            // 規則:refAliasOf JSDoc「候選定義操作(帶 ref)之承接者(輸出中同操作種類、_via 含其 _oid 之第一條)帶 ref 且名不同者入表;承接者未給 ref、名相同者不列;
            //   同一候選 ref 只取先見者」;closeRefs JSDoc「本差量中有操作之 _via 含該 ref 之定義操作 → 別名指向它(必要時補上 ref)」;兩者之承接者判準同為 successorOf
            const defA1 = { _oid: 'a1_1', op: 'add', ref: 'a1_def', kind: 'rule', text: T1, sources: ['N1'] }
            const defA2 = { _oid: 'a2_1', op: 'add', ref: 'a2_def', kind: 'rule', text: T1, sources: ['N2'] }
            const defs = [defA1, defA2]
            const merged = (ref, o = {}) => ({ _oid: 'i_1', op: 'add', ref, kind: 'rule', text: T1, sources: ['N1', 'N2'], _via: ['a1_1', 'a2_1'], ...o })

            it('去前綴合併:兩候選之 ref 皆對回輸出之 def;取另一席之名:只有對方之名入表(同名者不列)', () => {
                assert.deepEqual([...refAliasOf([merged('def')], defs)], [['a1_def', 'def'], ['a2_def', 'def']])
                assert.deepEqual([...refAliasOf([merged('a2_def')], defs)], [['a1_def', 'a2_def']])
            })

            it('不列:承接者未給 ref(交 closeRefs 補上候選之 ref)、via 未含該候選、操作種類不同(不是承接者)', () => {
                assert.equal(refAliasOf([merged('')], defs).size, 0)
                assert.equal(refAliasOf([merged('def', { _via: ['a9_9'] })], defs).size, 0)
                assert.equal(refAliasOf([merged('def', { op: 'dispute_add' })], defs).size, 0)
                assert.equal(refAliasOf([merged('def', { _via: 'a1_1' })], defs).size, 0, '_via 非陣列者不認(同 closeRefs)')
            })

            it('同一候選 ref 被多條輸出承接者只取先見者;無 ref 之候選略過;輸入防呆(ops、defs 非陣列／空)回空表', () => {
                assert.deepEqual([...refAliasOf([merged('x1'), merged('x2', { _oid: 'i_2' })], [defA1])], [['a1_def', 'x1']])
                assert.equal(refAliasOf([merged('def')], [{ _oid: 'a1_1', op: 'add' }]).size, 0)
                assert.equal(refAliasOf(null, defs).size, 0)
                assert.equal(refAliasOf([merged('def')], undefined).size, 0)
                assert.equal(refAliasOf([null, 'x', 3], defs).size, 0)
            })

            it('defs 可為任何可迭代(如 byOid.values())', () => {
                const m = new Map(defs.map((d) => [d._oid, d]))
                assert.deepEqual([...refAliasOf([merged('def')], m.values())], [['a1_def', 'def'], ['a2_def', 'def']])
            })

            it('共用同一份對照:對同一組輸出,closeRefs 把舊名引用改指之輸出名＝refAliasOf 之改名表', () => {
                const cand = (seat) => ({ seat, ops: [{ _oid: `a${seat}_1`, op: 'add', ref: `a${seat}_def`, kind: 'rule', text: T1, sources: [`N${seat}`] }, { _oid: `a${seat}_2`, op: 'param_add', claim: `@a${seat}_def`, name: '門檻', value: '3', sources: [`N${seat}`] }] })
                const cs = [cand(1), cand(2)]
                const out = () => [
                    merged('def'),
                    { _oid: 'i_2', op: 'param_add', claim: '@a1_def', name: '門檻', value: '3', sources: ['N1'], _via: ['a1_2'] },
                    { _oid: 'i_3', op: 'param_add', claim: '@a2_def', name: '門檻', value: '3', sources: ['N2'], _via: ['a2_2'] },
                ]
                const table = refAliasOf(out(), cs.flatMap((c) => c.ops))
                assert.deepEqual([...table], [['a1_def', 'def'], ['a2_def', 'def']])
                const cl = closeRefs(out(), cs)
                assert.deepEqual(cl.ops.map((o) => o.claim || o.ref), ['def', '@def', '@def'], 'closeRefs 把 @a1_def、@a2_def 都指向 refAliasOf 所列之 def')
                assert.deepEqual(cl.added.map((a) => [a.ref, a.how]), [['a1_def', '別名→i_1'], ['a2_def', '別名→i_1']])
                for (const [from, to] of table) assert.ok(cl.added.some((a) => a.ref === from) && cl.ops.some((o) => o.claim === `@${to}`), `${from}→${to}`)
            })

            it('closeRefs 既有行為(承接者須同操作種類):輸出中 _via 含該候選但種類不同者不是承接者 → 自候選取回定義;改名表不列', () => {
                const c = { seat: 1, ops: [defA1] }
                const out = () => [{ _oid: 'i_1', op: 'dispute_add', question: '甲說與乙說何者成立', sides: [{ position: '甲', claims: ['@a1_def'], sources: ['N1'] }, { position: '乙', sources: ['N1'] }], sources: ['N1'], _via: ['a1_1'] }]
                assert.equal(refAliasOf(out(), c.ops).size, 0)
                const cl = closeRefs(out(), [c])
                assert.deepEqual(cl.ops.map((o) => o._oid), ['i_1', 'a1_1'], '定義操作自候選取回')
                assert.deepEqual(cl.added.map((a) => a.how), ['取回 a1_1'])
            })

            it('closeRefs 既有行為(承接者未給 ref):補上候選之 ref,引用不變、不取回候選;此時改名表不列', () => {
                const c = { seat: 1, ops: [defA1, { _oid: 'a1_2', op: 'param_add', claim: '@a1_def', name: '門檻', value: '3', sources: ['N1'] }] }
                const out = () => [merged('', { _via: ['a1_1'] }), { _oid: 'i_2', op: 'param_add', claim: '@a1_def', name: '門檻', value: '3', sources: ['N1'], _via: ['a1_2'] }]
                assert.equal(refAliasOf(out(), c.ops).size, 0)
                const cl = closeRefs(out(), [c])
                assert.equal(cl.ops.length, 2, '不重複取回')
                assert.equal(cl.ops[0].ref, 'a1_def', '補上候選之 ref')
                assert.equal(cl.ops[1].claim, '@a1_def')
                assert.deepEqual(cl.added.map((a) => a.how), ['別名→i_1'])
            })
        })

        it('droppedMajority:票數 ≥2 而未被整合收入者(同義候選已被收入視為已收入);單票者不列', () => {
            // 規則:droppedMajority JSDoc「『多數支持卻未被整合收入』之操作(交審計)」「@returns 未被收入且票數 ≥2 之候選操作」
            const cands = [
                { seat: 1, provider: 'p1', ops: [addOp('a1_1', T1)] },
                { seat: 2, provider: 'p2', ops: [addOp('a2_1', T2)] },
                { seat: 3, provider: 'p3', ops: [addOp('a3_1', T3)] },
            ]
            const votes = voteOps(cands)
            const oidsOf = (integrated) => droppedMajority(cands, votes, integrated).map((o) => o._oid).sort()
            assert.deepEqual(oidsOf([]), ['a1_1', 'a2_1'], '多數支持(2 票)而一條都沒收入')
            assert.deepEqual(oidsOf([{ _via: ['a3_1'] }]), ['a1_1', 'a2_1'], '收入的是別條')
            assert.deepEqual(oidsOf([{ _via: ['a1_1', 'a2_1'] }]), [], '兩條都已被收入')
            // 同義之 a1_1 已被收入 → a2_1 之主張已在整合結果內,不算「被丟掉」
            assert.deepEqual(oidsOf([{ _via: ['a1_1'] }]), [], '同義候選已被收入')
            assert.ok(!oidsOf([]).includes('a3_1'), '單票者不列')
        })

        it('applyRefAliases:新增轉確認後,原 ref 之引用改指既有條目 id(去 @);未登記之 ref 不動;回同一陣列', () => {
            // 規則:applyRefAliases JSDoc「ref 別名(新增轉確認後,原 ref 之引用改指既有條目 id)」「@param ops 就地改寫」「@returns 同一陣列」
            const ops = [
                { op: 'confirm', id: 'C5', sources: ['N1'], _refAlias: { ref: 'r1', id: 'C5' } },
                { op: 'essence', text: '本質', claims: ['@r1', '@r2', 'C7'], reason: '首版' },
                { op: 'dispute_add', question: '問', sides: [{ position: '甲', claims: ['@r1'] }, { position: '乙', claims: ['C7'] }] },
                { op: 'dispute_update', id: 'D1', sides_add: [{ position: '丙', claims: ['@r1', '@r2'] }] },
                { op: 'merge', into: '@r1', from: ['@r1', 'C3'] },
            ]
            const r = applyRefAliases(ops)
            assert.equal(r, ops)
            assert.deepEqual(ops[1].claims, ['C5', '@r2', 'C7'])
            assert.deepEqual(ops[2].sides[0].claims, ['C5'])
            assert.deepEqual(ops[2].sides[1].claims, ['C7'])
            assert.deepEqual(ops[3].sides_add[0].claims, ['C5', '@r2'])
            assert.equal(ops[4].into, 'C5')
            assert.deepEqual(ops[4].from, ['C5', 'C3'])
        })

        it('applyRefAliases:無別名時原樣回同一陣列', () => {
            // 規則:applyRefAliases JSDoc「@returns 同一陣列」
            const ops = [{ op: 'essence', text: '本質', claims: ['@r1'], reason: '首版' }]
            const before = JSON.parse(JSON.stringify(ops))
            assert.equal(applyRefAliases(ops), ops)
            assert.deepEqual(ops, before)
        })

        it('refsOf:操作所引之同差量 ref(去 @;含 sides 之 claims 與文字中之〔@ref〕);既有條目編號不算;去重', () => {
            // 規則:refsOf 之 JSDoc「操作所引之同差量 ref(去 @;含 sides 之 claims 與文字中之〔@ref〕)」
            const op = {
                op: 'dispute_add', id: '@a', into: 'C1', dispute: '@b', claims: ['@c', 'C2'], from: ['@d'],
                sides: [{ position: '甲', claims: ['@e', 'C3'] }], sides_add: [{ position: '乙', claims: ['@f'] }],
                text: '依〔@g〕與〔C5〕', question: '〔@h〕', note: '〔@a〕重複', critique: '〔@i〕',
            }
            assert.deepEqual([...refsOf(op)].sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
            assert.deepEqual(refsOf({ op: 'confirm', id: 'C1', sources: ['N1'] }), [])
            assert.deepEqual(refsOf({ op: 'essence', claims: ['@'] }), [], '單獨之 @ 不是 ref')
        })

        it('stripProgramFields:去掉底線起頭之程式欄位(保留 _i、_withhold、_doubt),不動非程式欄位,回新物件', () => {
            // 規則:stripProgramFields 註解「去掉程式欄位(送模型或 applyDelta 前;_i 由 applyVerdicts 自行管理)」;
            //   coreDelta.applyDelta JSDoc「個別操作帶 _withhold:true 者亦暫緩」與其終審存疑之 op._doubt——二者須留至 applyDelta
            const op = { op: 'add', ref: 'a', text: '甲', sources: ['N1'], _oid: 'a1_1', _seat: 1, _trial: '理由', _via: ['a1_1'], _votes: 2, _i: 3, _withhold: true, _doubt: { reason: '非對立' } }
            const before = JSON.parse(JSON.stringify(op))
            const r = stripProgramFields(op)
            assert.deepEqual(op, before, '輸入不被改動')
            assert.notEqual(r, op)
            assert.deepEqual(Object.keys(r).sort(), ['_doubt', '_i', '_withhold', 'op', 'ref', 'sources', 'text'])
            assert.equal(r._i, 3)
            assert.deepEqual(r.sources, ['N1'])
        })
    })


    // ═══════════════════════ standards/opGuards ═══════════════════════
    describe('standards/opGuards', function() {
        const KNOWN = new Set([...DELTA_OPS, ...CONSOLIDATE_OPS])

        it('CONSTRUCTIVE_OPS 與 DESTRUCTIVE_OPS:兩集合不相交,皆為已知操作(差量與整併操作全集)之子集', () => {
            // 規則:opGuards.mjs 檔頭【補丁守門依操作類別映射】——一條操作只屬一類;coreState 之 DELTA_OPS／CONSOLIDATE_OPS 為操作全集
            assert.ok(CONSTRUCTIVE_OPS instanceof Set && DESTRUCTIVE_OPS instanceof Set)
            assert.deepEqual([...CONSTRUCTIVE_OPS].filter((x) => DESTRUCTIVE_OPS.has(x)), [])
            assert.deepEqual([...CONSTRUCTIVE_OPS].filter((x) => !KNOWN.has(x)), [])
            assert.deepEqual([...DESTRUCTIVE_OPS].filter((x) => !KNOWN.has(x)), [])
        })

        it('已知操作皆有類別:不在兩集合者只有依內容判類之 revise(依改動幅度)與 dispute_update(依狀態)', () => {
            // 規則:檔頭【補丁守門依操作類別映射】「revise 依改動幅度」;opClass 對 dispute_update 依 status 判(code 內分支);新增操作而漏歸類者在此現形
            const left = [...KNOWN].filter((x) => !CONSTRUCTIVE_OPS.has(x) && !DESTRUCTIVE_OPS.has(x)).sort()
            assert.deepEqual(left, ['dispute_update', 'revise'])
        })

        it('不可逆(終態)操作皆為破壞性', () => {
            // 規則:檔頭【補丁守門依操作類別映射】「破壞性操作(supersede、retract…)」＝讓知識離開;coreState 之 TERMINAL_OPS 為終態操作
            for (const op of TERMINAL_OPS) assert.ok(DESTRUCTIVE_OPS.has(op), op)
        })

        it('opClass:建設性操作各給一例(加入或累積知識)', () => {
            // 規則:CONSTRUCTIVE_OPS 註解「建設性操作(加入或累積知識):被剔除＝新知識進不來」;opClass JSDoc「'constructive'｜'destructive'」
            const ex = [
                { op: 'add', kind: 'rule', text: '甲', sources: ['N1'] },
                { op: 'confirm', id: 'C1', sources: ['N1'] },
                { op: 'param_add', name: '週期', value: '長' },
                { op: 'question_add', text: '甲乙何者成立' },
                { op: 'dispute_add', question: '問', sides: [{ position: '甲' }, { position: '乙' }] },
                { op: 'contest', id: 'C1', dispute: 'D1', side: '甲' },
                { op: 'related_add', concepts: ['潮汐'] },
                { op: 'essence', text: '本質', claims: ['C1'], reason: '首版' },
            ]
            for (const op of ex) assert.equal(opClass(op, emptyState()), 'constructive', op.op)
            assert.equal(ex.length, CONSTRUCTIVE_OPS.size, '每種建設性操作都有一例')
        })

        it('opClass:破壞性操作各給一例(讓既有知識離開有效集合)', () => {
            // 規則:DESTRUCTIVE_OPS 註解「破壞性操作(讓既有知識離開有效集合):被剔除＝舊知識被保住」
            const ex = [
                { op: 'supersede', id: 'C1', by: 'C2' },
                { op: 'retract', id: 'C1', reason: '離題' },
                { op: 'merge', into: 'C1', from: ['C2'] },
                { op: 'dispute_dissolve', id: 'D1', resolution: '非對立' },
                { op: 'question_resolve', id: 'Q1', resolution: '已解' },
                { op: 'related_prune', concepts: ['潮汐'] },
                { op: 'split', id: 'C1', parts: [{ text: '甲' }, { text: '乙' }] },
                { op: 'refacet', from: '舊面向', to: '新面向' },
            ]
            for (const op of ex) assert.equal(opClass(op, emptyState()), 'destructive', op.op)
            assert.equal(ex.length, DESTRUCTIVE_OPS.size, '每種破壞性操作都有一例')
        })

        it('opClass:dispute_update 結案(resolved)視為破壞性、其餘為建設性', () => {
            // 規則:opClass 之 dispute_update 分支(結案＝爭議離開有效集合,依檔頭「破壞性＝讓知識離開」之定義)
            assert.equal(opClass({ op: 'dispute_update', id: 'D1', status: 'resolved' }, emptyState()), 'destructive')
            assert.equal(opClass({ op: 'dispute_update', id: 'D1', status: 'open', note: '補充' }, emptyState()), 'constructive')
            assert.equal(opClass({ op: 'dispute_update', id: 'D1', note: '補充' }, emptyState()), 'constructive')
        })

        it('opClass:revise 依改動幅度——改後仍保有原文過半(包含率 ≥0.5)屬建設性,否則視同破壞性(邊界 0.5 屬建設性)', () => {
            // 規則:檔頭「revise 依改動幅度:改後仍保有原文過半(包含率 ≥0.5)屬建設性,否則視同破壞性」
            const [before, half] = pairOf(10, 5) // containment(before, half) = 0.5
            const [, less] = pairOf(10, 4) // containment(before, less) = 0.4
            assert.equal(containment(before, half), 0.5, '夾具:恰 0.5')
            assert.equal(containment(before, less), 0.4, '夾具:0.4')
            const state = { ...emptyState({ coreId: 'c', concept: '潮汐' }), claims: [{ id: 'C1', text: before }] }
            const rv = (text) => ({ op: 'revise', id: 'C1', fields: { text }, reason: '改寫' })
            assert.equal(opClass(rv(half), state), 'constructive', '恰 0.5')
            assert.equal(opClass(rv(less), state), 'destructive', '略低於 0.5')
            assert.equal(opClass(rv(`${before}並補充條件`), state), 'constructive', '原文完整保留')
            assert.equal(opClass(rv(T3), state), 'destructive', '幾乎全改')
        })

        it('opClass:revise 未改文字欄(原文完整保留)為建設性;參數以 value 為原文判幅度', () => {
            // 規則:檔頭「revise 依改動幅度」——未動原文者保留率為 100%;參數條目之原文為其 value(coreState.ITEM_TEXT_FIELDS.parameters 含 name、value)
            const [before, half] = pairOf(10, 5)
            const [, less] = pairOf(10, 4)
            const state = { ...emptyState({ coreId: 'c', concept: '潮汐' }), claims: [{ id: 'C1', text: before }], parameters: [{ id: 'P1', name: '週期', value: before }] }
            assert.equal(opClass({ op: 'revise', id: 'C1', fields: { conditions: ['僅限低緯度'] }, reason: '補條件' }, state), 'constructive')
            assert.equal(opClass({ op: 'revise', id: 'P1', fields: { value: half }, reason: '改值' }, state), 'constructive')
            assert.equal(opClass({ op: 'revise', id: 'P1', fields: { value: less }, reason: '改值' }, state), 'destructive')
        })

        describe('textFieldsOf', function() {
            const pathsOf = (op) => textFieldsOf(op).map((x) => x.path)

            it('頂層文字欄(字串與字串陣列);代號(op、ref、kind、sources、id)不列', () => {
                // 規則:textFieldsOf JSDoc「操作之全部文字欄…頂層」;TOP_TEXT_KEYS 註解「ES2／ES3 之範圍＝全部內容字串,代號除外」
                const op = { op: 'add', ref: 'a', kind: 'rule', text: '甲', conditions: ['乙', '丙'], pros: ['丁'], critique: '戊', basis: '己', facet: '庚', period: '辛', sources: ['N1'], id: 'C1' }
                const f = textFieldsOf(op)
                assert.deepEqual(f.map((x) => x.text).sort(), ['丁', '丙', '乙', '己', '庚', '戊', '甲', '辛'].sort())
                const paths = f.map((x) => x.path)
                for (const bad of ['op', 'ref', 'kind', 'sources', 'id']) assert.ok(!paths.some((p) => p === bad || p.startsWith(`${bad}[`)), `不應列出 ${bad}`)
                assert.ok(paths.includes('text'))
                assert.ok(paths.includes('conditions[0]') && paths.includes('conditions[1]'), '陣列欄逐項帶索引')
                assert.deepEqual(textFieldsOf({ op: 'add', conditions: '單值' }), [{ path: 'conditions', text: '單值' }])
            })

            it('revise 之 fields、爭議方(sides／sides_add)之 position／conditions／basis;方之出處與引用不列', () => {
                // 規則:textFieldsOf JSDoc「revise 之 fields、爭議方(sides／sides_add)」
                assert.deepEqual(pathsOf({ op: 'revise', id: 'C1', fields: { text: '新文', conditions: ['條'] }, reason: '補充' }).sort(), ['fields.conditions[0]', 'fields.text', 'reason'])
                const dispute = { op: 'dispute_add', question: '問', sides: [{ position: '甲方', conditions: ['條件'], basis: '依據', sources: ['N1'], claims: ['@a'] }, { position: '乙方' }] }
                assert.deepEqual(pathsOf(dispute).sort(), ['question', 'sides[0].basis', 'sides[0].conditions[0]', 'sides[0].position', 'sides[1].position'].sort())
                assert.deepEqual(pathsOf({ op: 'dispute_update', id: 'D1', note: '說明', sides_add: [{ position: '丙方', sources: ['N1'] }] }).sort(), ['note', 'sides_add[0].position'])
            })

            it('拆分各部(parts)、拆解之各方標注(annotations)、關聯概念(related_add／related_prune 之 concepts)、改面向(refacet 之 from／to)', () => {
                // 規則:textFieldsOf JSDoc「拆分各部(parts)、相關概念(related_add／related_prune 之 concepts)、改面向(refacet 之 from／to)」;
                //   ANNOTATION_TEXT_KEYS 註解「拆解爭議時各方轉主張之標注(dispute_dissolve 之 annotations[k])」
                assert.deepEqual(pathsOf({ op: 'split', id: 'C1', parts: [{ text: '部一', critique: '銳評', sources: ['N1'] }, { text: '部二' }] }).sort(), ['parts[0].critique', 'parts[0].text', 'parts[1].text'])
                assert.deepEqual(pathsOf({ op: 'dispute_dissolve', id: 'D1', resolution: '結論', annotations: [{ critique: '評', pros: ['利'] }] }).sort(), ['annotations[0].critique', 'annotations[0].pros[0]', 'resolution'])
                assert.deepEqual(pathsOf({ op: 'related_add', concepts: ['潮汐', '軌道'] }), ['concepts[0]', 'concepts[1]'])
                assert.deepEqual(pathsOf({ op: 'related_prune', concepts: ['潮汐'] }), ['concepts[0]'])
                assert.deepEqual(pathsOf({ op: 'refacet', from: '舊面向', to: '新面向' }), ['from', 'to'])
            })

            it('concepts、from／to 只在對應操作內才是文字欄(merge 之 from 是條目編號,不列)', () => {
                // 規則:textFieldsOf JSDoc 逐操作列舉欄位;代號除外(merge.from 為條目編號)
                assert.deepEqual(pathsOf({ op: 'merge', into: 'C1', from: ['C2', 'C3'] }), [])
                assert.deepEqual(pathsOf({ op: 'add', text: '甲', concepts: ['潮汐'] }), ['text'])
            })
        })

        describe('rewriteTextFields', function() {
            const SAMPLES = [
                { op: 'add', ref: 'a', kind: 'rule', text: '甲', conditions: ['乙', '丙'], critique: '戊', sources: ['N1'] },
                { op: 'revise', id: 'C1', fields: { text: '新文', conditions: ['條'] }, reason: '補充' },
                { op: 'dispute_add', question: '問', sides: [{ position: '甲方', conditions: ['條件'], sources: ['N1'], claims: ['@a'] }, { position: '乙方' }] },
                { op: 'dispute_update', id: 'D1', note: '說明', sides_add: [{ position: '丙方', sources: ['N1'] }] },
                { op: 'split', id: 'C1', parts: [{ text: '部一', critique: '銳評' }, { text: '部二' }] },
                { op: 'dispute_dissolve', id: 'D1', resolution: '結論', annotations: [{ critique: '評', pros: ['利'] }] },
                { op: 'related_add', concepts: ['潮汐', '軌道'], sources: ['N1'] },
                { op: 'refacet', from: '舊面向', to: '新面向' },
            ]

            it('與 textFieldsOf 同一欄位集:每個文字欄皆被 fn 改寫、欄位路徑不增不減', () => {
                // 規則:rewriteTextFields JSDoc「以 fn 改寫操作之全部文字欄(與 textFieldsOf 同一欄位集…)」
                const fn = (t) => `${t}*`
                for (const op of SAMPLES) {
                    const out = rewriteTextFields(op, fn)
                    assert.deepEqual(textFieldsOf(out).map((x) => x.path), textFieldsOf(op).map((x) => x.path), op.op)
                    assert.deepEqual(textFieldsOf(out).map((x) => x.text), textFieldsOf(op).map((x) => fn(x.text)), op.op)
                }
            })

            it('只改文字欄、不改非文字欄(op、ref、kind、id、sources、claims)', () => {
                // 規則:同上;TOP_TEXT_KEYS 註解「代號除外」——代號、出處、引用不被轉換
                const fn = (t) => `${t}*`
                const out = rewriteTextFields(SAMPLES[0], fn)
                for (const k of ['op', 'ref', 'kind', 'sources']) assert.deepEqual(out[k], SAMPLES[0][k], k)
                assert.equal(out.text, '甲*')
                assert.deepEqual(out.conditions, ['乙*', '丙*'])
                const d = rewriteTextFields(SAMPLES[2], fn)
                assert.deepEqual(d.sides[0].sources, ['N1'])
                assert.deepEqual(d.sides[0].claims, ['@a'])
                assert.equal(d.sides[0].position, '甲方*')
                const rv = rewriteTextFields(SAMPLES[1], fn)
                assert.equal(rv.id, 'C1')
                // 無文字欄之操作:內容原樣
                const merge = { op: 'merge', into: 'C1', from: ['C2', 'C3'] }
                assert.deepEqual(rewriteTextFields(merge, fn), merge)
            })

            it('回新物件、不修改輸入', () => {
                // 規則:rewriteTextFields JSDoc「不修改輸入」「@returns 回傳新操作」
                for (const op of SAMPLES) {
                    const before = JSON.parse(JSON.stringify(op))
                    const out = rewriteTextFields(op, (t) => `${t}*`)
                    assert.deepEqual(op, before, `${op.op}:輸入不被改動`)
                    assert.notEqual(out, op, `${op.op}:回新物件`)
                }
            })
        })
    })


    // ═══════════════════════ standards/parse ═══════════════════════
    describe('standards/parse', function() {

        it('checkAudit:含陣列 issues 之物件才合格;缺鍵、錯型別、null/undefined、他棒之鍵皆不合格;恆為嚴格布林', () => {
            // 規則:parse.mjs「各棒之形狀檢查(嚴格布林;…)」;parseAudit 只收含 issues 之物件
            assert.equal(checkAudit({ issues: [] }), true)
            assert.equal(checkAudit({ issues: [{ ref: 'a1_1', severity: '高' }], extra: 1 }), true)
            for (const bad of [{}, { issues: 'x' }, { issues: null }, { issues: {} }, { issue: [] }, { ops: [] }, { verdicts: [] }, [], null, undefined, 0, '', 'issues', 5]) {
                assert.strictEqual(checkAudit(bad), false, JSON.stringify(bad))
            }
        })

        it('checkVerdicts:含陣列 verdicts 之物件才合格;缺鍵、錯型別、null/undefined 皆不合格;恆為嚴格布林', () => {
            // 規則:parse.mjs「各棒之形狀檢查(嚴格布林;…)」;parseVerdicts 只收含 verdicts 之物件
            assert.equal(checkVerdicts({ verdicts: [] }), true)
            assert.equal(checkVerdicts({ verdicts: [{ i: 0, action: 'keep' }] }), true)
            for (const bad of [{}, { verdicts: 'x' }, { verdicts: null }, { verdicts: {} }, { verdict: [] }, { issues: [] }, [], null, undefined, 0, '', 5]) {
                assert.strictEqual(checkVerdicts(bad), false, JSON.stringify(bad))
            }
        })

        it('checkPatch:edits／adds／removes 任一為陣列,且其餘若在場須為陣列', () => {
            // 規則:parse.mjs checkPatch——補丁三鍵「任一為陣列且其餘若在場須為陣列」;檔頭【為何只收含鍵之物件】
            for (const ok of [{ edits: [] }, { adds: [] }, { removes: [] }, { edits: [], adds: [], removes: [] }, { edits: [1], removes: [2] }, { adds: [], extra: 'x' }]) {
                assert.strictEqual(checkPatch(ok), true, JSON.stringify(ok))
            }
            for (const bad of [
                {}, { foo: [] }, { edits: undefined },
                { edits: 'x' }, { adds: {} }, { removes: null },
                { edits: [], adds: 'x' }, { edits: [], removes: null }, { adds: [], edits: {} },
                [], null, undefined, 0, '',
            ]) {
                assert.strictEqual(checkPatch(bad), false, JSON.stringify(bad))
            }
        })
    })


    // ═══════════════════════ domain/prompts ═══════════════════════
    describe('domain/prompts', function() {
        const KB = '星象觀測筆記集'
        const RULES = '規則甲：材料沒有之數字不得寫入\n規則乙：結論相反者立爭議'

        const integrateCtx = () => ({
            kb: KB, concept: '恆星演化', rulesText: RULES, batchCodes: ['N1', 'N2'], digestIndex: 'C1 恆星分類之索引行',
            cands: [
                { seat: 1, ops: [addOp('a1_1', T1, { _seat: 1, _trial: '無本批出處' })], skipped: [{ note: 'N3', reason: '離題' }] },
                { seat: 2, ops: [addOp('a2_1', T2, { _seat: 2, _suspectDup: 'C3' }), addOp('a2_2', T3, { _seat: 2 })], skipped: [] },
            ],
            votes: new Map([['a1_1', { votes: 2 }], ['a2_1', { votes: 2 }]]),
        })
        const auditCtx = () => ({
            kb: KB, concept: '恆星演化', rulesText: RULES,
            ops: [addOp('a1_1', T1, { _votes: 2, _suspectDup: 'C3', _seat: 1, _via: ['a1_1'] })],
            flags: ['旗標：數字未紮根'], missing: [addOp('a2_1', T3)], touched: 'C3 既有條目之全文',
            batch: [{ code: 'N1', digest: 'N1 摘要全文' }],
        })
        const reviseCtx = () => ({
            kb: KB, concept: '恆星演化', rulesText: RULES,
            ops: [addOp('a1_1', T1, { _seat: 1 }), { op: 'confirm', id: 'C1', sources: ['N1'], _oid: 'a2_1' }],
            issues: [
                { k: 1, ref: 'a1_1', severity: '高', type: ISSUE_TYPES.offTopic, detail: '與本概念無直接關係', fix: '剔除該條' },
                { k: 2, ref: 'C1', severity: '低', type: '其他', detail: '語氣過強' },
            ],
            fixable: { add: ['text', 'sources', 'zzfield'], confirm: ['sources'] },
            touched: 'C1 既有條目之全文', batch: [{ code: 'N1', digest: 'N1 摘要全文' }],
        })
        /** 操作行(自某章內文取以 _oid 起首之行)之 JSON 部分 */
        const opJsonOf = (sec, oid) => {
            const line = sec.split('\n').find((l) => l.startsWith(oid))
            assert.ok(line, `${oid} 之操作行`)
            return JSON.parse(line.slice(line.indexOf('{')))
        }

        it('buildIntegratePrompt:帶入 kb 稱呼、概念名、規則表(同一份文字)、本批代號、狀態索引、各席候選與其操作 id', () => {
            // 規則:prompts.mjs 檔頭【稱呼只有一種機制】(ctx.kb 須自給)、【規則表單一來源】(rulesText 原文入【規則】章)、JSDoc ctx 欄位
            const p = buildIntegratePrompt(integrateCtx())
            assert.equal(typeof p, 'string')
            assert.ok(p.includes(KB), 'kb 稱呼')
            assert.ok(p.includes('恆星演化'), '概念名')
            assert.ok(secOf(p, '規則').includes(RULES), '規則表原文入【規則】章')
            assert.ok(secOf(p, '本批筆記代號').includes('N1、N2'), '本批代號')
            assert.ok(secOf(p, '目前核心狀態（索引）').includes('C1 恆星分類之索引行'), '狀態索引')
            const cand = secOf(p, '候選')
            assert.ok(cand.includes('【候選 1】') && cand.includes('【候選 2】'), '各席候選')
            for (const oid of ['a1_1', 'a2_1', 'a2_2']) assert.ok(cand.includes(oid), `候選操作 ${oid}`)
            assert.ok(!p.includes('知識庫'), '函數不再退「知識庫」')
            assert.ok(!p.includes('undefined'))
        })

        it('buildIntegratePrompt:每條候選操作行附票數、試套被拒理由、疑重複之既有編號;略過清單入提示;程式欄位不外送(只留 _oid)', () => {
            // 規則:buildIntegratePrompt JSDoc「以及程式之試套與計票結果」ctx.votes:Map(_oid→{votes});candidates.stripProgramFields「去掉程式欄位(送模型…前)」
            const p = buildIntegratePrompt(integrateCtx())
            const lines = p.split('\n')
            const lineOf = (oid) => lines.find((l) => l.startsWith(oid))
            assert.ok(lineOf('a1_1').includes('2 家支持'), '計票結果')
            assert.ok(lineOf('a1_1').includes('無本批出處'), '試套被拒之理由')
            assert.ok(lineOf('a2_1').includes('C3'), '疑與既有條目重複')
            assert.ok(lineOf('a2_2').includes('1 家支持'), '無計票記錄者自身一席')
            assert.ok(p.includes('N3') && p.includes('離題'), '略過清單')
            const j = JSON.parse(lineOf('a1_1').slice(lineOf('a1_1').indexOf('{')))
            assert.equal(j.text, T1)
            assert.equal(j._oid, 'a1_1', '操作 id 須留(供 via 指回)')
            for (const k of ['_seat', '_trial', '_suspectDup', '_votes', '_via']) assert.equal(j[k], undefined, `${k} 不外送`)
        })

        it('buildIntegratePrompt:契約段——要求每條附 via,輸出格式之範例 JSON 可被 parseDraft 解析', () => {
            // 規則:檔頭【契約段】「『只回覆 JSON…』起之段落是程式解析所依賴者(standards/parse.mjs)」;【依據】整合「via 必指回候選」
            const p = buildIntegratePrompt(integrateCtx())
            assert.ok(p.includes('"via"'))
            const ex = exampleOf(p)
            assert.ok(ex, '【輸出格式】章有範例 JSON')
            const j = JSON.parse(ex)
            assert.ok(Array.isArray(j.ops) && j.ops.every((o) => Array.isArray(o.via)), '範例每條操作附 via')
            assert.notEqual(parseDraft(ex), null)
        })

        it('buildAuditPrompt:帶入 kb、概念名、規則表、整合後操作(以 _oid 起首)、多數支持未收之操作、旗標、被觸及條目、本批筆記;類型字取自 ISSUE_TYPES', () => {
            // 規則:檔頭【依據】審計「以操作 id 定位(不以序號)」、【意見類型由常數產生】、JSDoc ctx 欄位
            const p = buildAuditPrompt(auditCtx())
            assert.ok(p.includes(KB) && p.includes('恆星演化'))
            assert.ok(secOf(p, '規則').includes(RULES))
            const ops = secOf(p, '整合後之操作')
            assert.ok(ops.split('\n').some((l) => l.startsWith('a1_1')), '整合後之操作以 _oid 起首(以 id 定位)')
            assert.ok(ops.includes('2 家支持') && ops.includes('C3'), '票數與疑重複之既有編號')
            const j = opJsonOf(ops, 'a1_1')
            assert.equal(j.text, T1)
            for (const k of ['_votes', '_suspectDup', '_seat', '_via']) assert.equal(j[k], undefined, `${k} 不外送`)
            const miss = secOf(p, '多數候選支持、但未被整合收入之操作')
            assert.ok(miss.includes('a2_1') && miss.includes(T3), '多數支持而未被收入者')
            assert.ok(secOf(p, '程式旗標').includes('旗標：數字未紮根'))
            assert.ok(secOf(p, '被觸及之既有條目').includes('C3 既有條目之全文'))
            assert.ok(secOf(p, '本批筆記').includes('N1 摘要全文'))
            for (const t of [ISSUE_TYPES.fabricated, ISSUE_TYPES.offTopic, ISSUE_TYPES.duplicate]) assert.ok(p.includes(t), `意見類型 ${t}`)
            assert.ok(!p.includes('知識庫') && !p.includes('undefined'))
        })

        it('buildAuditPrompt:關聯脈絡章只在給 relations 時附;契約段範例 JSON 可被 parseAudit 解析', () => {
            // 規則:buildAuditPrompt JSDoc ctx 之 relations(關聯脈絡);檔頭【契約段】
            const without = buildAuditPrompt(auditCtx())
            assert.ok(!without.includes('【關聯脈絡】'))
            const withRel = buildAuditPrompt({ ...auditCtx(), relations: 'R1 衝突邊之說明文字' })
            assert.ok(secOf(withRel, '關聯脈絡').includes('R1 衝突邊之說明文字'))
            const ex = exampleOf(without)
            assert.ok(ex)
            assert.ok(Array.isArray(JSON.parse(ex).issues))
            assert.notEqual(parseAudit(ex), null)
        })

        it('buildRevisePrompt:帶入 kb、概念名、規則表、操作(以 _oid 起首)、審計意見([k] 編號、嚴重度、類型、細節、改法)、可改欄位、被觸及條目、本批筆記', () => {
            // 規則:檔頭【依據】修訂「只輸出補丁」;JSDoc ctx:issues(正規化,帶 k)、fixable:Object(FIXABLE_FIELDS);提示詞內「審計意見（每條有編號 [k]）」
            const p = buildRevisePrompt(reviseCtx())
            assert.ok(p.includes(KB) && p.includes('恆星演化'))
            assert.ok(secOf(p, '規則').includes(RULES))
            const ops = secOf(p, '操作')
            assert.ok(ops.split('\n').some((l) => l.startsWith('a1_1')) && ops.split('\n').some((l) => l.startsWith('a2_1')), '操作以 _oid 起首')
            assert.equal(opJsonOf(ops, 'a1_1')._seat, undefined, '程式欄位不外送')
            const iss = secOf(p, '審計意見')
            const l1 = iss.split('\n').find((l) => l.includes('[1]'))
            assert.ok(l1 && l1.includes('a1_1') && l1.includes('高') && l1.includes(ISSUE_TYPES.offTopic) && l1.includes('與本概念無直接關係') && l1.includes('剔除該條'), '意見 [1] 之各欄')
            const l2 = iss.split('\n').find((l) => l.includes('[2]'))
            assert.ok(l2 && l2.includes('C1') && l2.includes('低') && l2.includes('語氣過強'), '意見 [2] 之各欄')
            assert.ok(p.includes('zzfield'), 'ctx.fixable 之可改欄位帶入')
            assert.ok(secOf(p, '被觸及之既有條目').includes('C1 既有條目之全文'))
            assert.ok(secOf(p, '本批筆記').includes('N1 摘要全文'))
            for (const t of [ISSUE_TYPES.duplicate, ISSUE_TYPES.offTopic, ISSUE_TYPES.fabricated, ISSUE_TYPES.standard]) assert.ok(p.includes(t), `意見類型 ${t}`)
            assert.ok(!p.includes('知識庫') && !p.includes('undefined'))
        })

        it('buildRevisePrompt:契約段——補丁三鍵 edits／adds／removes,範例 JSON 合 checkPatch 且可被 parsePatch 解析', () => {
            // 規則:檔頭【契約段】與【依據】修訂「只輸出補丁 {edits, adds, removes}」;standards/parse.mjs 之 checkPatch
            const p = buildRevisePrompt(reviseCtx())
            const ex = exampleOf(p)
            assert.ok(ex)
            const j = JSON.parse(ex)
            assert.equal(checkPatch(j), true)
            assert.deepEqual(Object.keys(j).sort(), ['adds', 'edits', 'removes'])
            assert.notEqual(parsePatch(ex), null)
        })

        it('buildAcceptAppendix:帶入審計意見與成功之修訂紀錄、不帶失敗之紀錄;提示意見須自行核實、不屬實者 keep;剔除之意見類型取自 ISSUE_TYPES', () => {
            // 規則:buildAcceptAppendix JSDoc「終審附錄(審計與修訂摘要…)附錄意見須自行對照筆記核實,不屬實者 keep」;檔頭【意見類型由常數產生】
            const text = buildAcceptAppendix({
                issues: [{ ref: 'a1_1', severity: '高', type: ISSUE_TYPES.offTopic, detail: '與本概念無關' }],
                patchLog: [{ ok: true, act: 'remove', ref: 'a1_1', why: '重複之條目' }, { ok: false, act: 'edit', ref: 'a2_1', why: '守門拒收之改寫' }],
            })
            for (const s of ['a1_1', '高', ISSUE_TYPES.offTopic, '與本概念無關']) assert.ok(text.includes(s), s)
            assert.ok(text.includes('remove') && text.includes('重複之條目'), '成功之修訂紀錄')
            assert.ok(!text.includes('守門拒收之改寫'), '失敗之紀錄不入附錄')
            assert.ok(text.includes('keep') && text.includes('核實'))
            for (const t of [ISSUE_TYPES.duplicate, ISSUE_TYPES.offTopic, ISSUE_TYPES.fabricated]) assert.ok(text.includes(t), `意見類型 ${t}`)
        })

        it('buildAcceptAppendix:附錄不逾 2,000 字(意見過多時截斷);無意見無紀錄亦回文字', () => {
            // 規則:buildAcceptAppendix JSDoc「終審附錄(審計與修訂摘要,≤2,000 字)」
            const many = Array.from({ length: 200 }, (_, k) => ({ ref: `a1_${k}`, severity: '中', type: '其他', detail: `第 ${k} 條意見之細節說明文字` }))
            const text = buildAcceptAppendix({ issues: many, patchLog: many.map((x) => ({ ok: true, act: 'edit', ref: x.ref, why: '修正' })) })
            assert.ok(text.length <= 2000, `長度 ${text.length}`)
            assert.ok(text.includes('a1_0'), '截斷保留開頭')
            const empty = buildAcceptAppendix({})
            assert.equal(typeof empty, 'string')
            assert.ok(empty.includes('keep') && !empty.includes('undefined'))
        })

        it('最小 ctx(只給 kb 與概念名):三支提示詞皆可產出,各章齊備、不洩漏 undefined', () => {
            // 規則:檔頭【稱呼只有一種機制】「直接呼叫本檔之函數者須自給 ctx.kb」——其餘欄位缺漏時以空段呈現
            const min = { kb: KB, concept: '恆星演化' }
            const cases = [[buildIntegratePrompt(min), ['規則', '輸出格式', '本批筆記代號', '目前核心狀態（索引）', '候選']], [buildAuditPrompt(min), ['規則', '輸出格式', '整合後之操作', '程式旗標', '被觸及之既有條目', '本批筆記']], [buildRevisePrompt(min), ['規則', '輸出格式', '操作', '審計意見', '被觸及之既有條目', '本批筆記']]]
            for (const [p, secs] of cases) {
                assert.ok(p.includes(KB) && p.includes('恆星演化'))
                for (const s of secs) assert.ok(p.includes(`【${s}】`), `缺【${s}】`)
                assert.ok(!p.includes('undefined') && !p.includes('知識庫'))
            }
        })
    })


    // ═══════════════════════ stores/contentCache.bodyHashOf ═══════════════════════
    describe('stores/contentCache.bodyHashOf', function() {
        const BODY = '# 太陽黑子\n\n## 核心知識\n\n- 週期約 11 年\n\n## 來源\n\n- 原文標題：太陽黑子週期\n- 發布時間：2026-01-01T08:00:00+08:00\n'
        const h = (body, front = {}) => bodyHashOf({ body, front })

        it('md 為空回 null;否則為 40 碼雜湊;同內文同雜湊', () => {
            // 規則:bodyHashOf JSDoc「@returns 40 碼雜湊(md 為空回 null)」
            assert.equal(bodyHashOf(null), null)
            assert.equal(bodyHashOf(undefined), null)
            assert.match(h(BODY), /^[0-9a-f]{40}$/)
            assert.equal(h(BODY), h(BODY))
        })

        it('只改 frontmatter 不影響(正文雜湊與章節設定、前言無關)', () => {
            // 規則:bodyHashOf JSDoc「正文雜湊(與章節設定無關):原文標題＋內容章…」——材料只取 md.body
            assert.equal(h(BODY, { title: '甲', conflicts: [] }), h(BODY, { title: '乙', conflicts: ['R1'], published: '2026-02-02' }))
        })

        it('內容章改變 → 雜湊變;原文標題改變 → 雜湊變', () => {
            // 規則:bodyHashOf JSDoc「原文標題＋內容章」
            const base = h(BODY)
            assert.notEqual(h(BODY.replace('約 11 年', '約 12 年')), base, '內容章改')
            assert.notEqual(h(BODY.replace('原文標題：太陽黑子週期', '原文標題：太陽活動週期')), base, '原文標題改')
            assert.notEqual(h(BODY.replace('# 太陽黑子', '# 太陽活動')), base, '「# 標題」行屬內容章')
        })

        it('來源章之其他行與下游投影章(關聯、⚠ 衝突與反例)之改變不影響', () => {
            // 規則:bodyHashOf JSDoc「(不含投影章、來源章——摘要套件之 noteMaterialText)」
            const base = h(BODY)
            assert.equal(h(BODY.replace('2026-01-01T08:00:00+08:00', '2026-02-02T09:00:00+08:00')), base, '來源章之發布時間')
            assert.equal(h(`${BODY}- 來源：某天文台\n`), base, '來源章加一行')
            assert.equal(h(`${BODY}\n## 關聯\n\n- 〔甲〕與〔乙〕相關\n\n## ⚠ 衝突與反例\n\n- 丙\n`), base, '附投影章')
        })

        it('空白正規化:行內多餘空白、定位字元、章間空行不影響', () => {
            // 規則:bodyHashOf JSDoc「空白正規化後雜湊」
            const base = h(BODY)
            assert.equal(h(BODY.replace('約 11 年', '約  11\t年')), base)
            assert.equal(h(BODY.replace('## 核心知識\n\n', '## 核心知識\n\n\n\n')), base)
        })
    })


    // ═══════════════════════ standards/recheck 常數 ═══════════════════════
    describe('standards/recheck 常數', function() {

        it('RECHECK_REASONS:凍結、值為非空字串且互異,窮舉七值', () => {
            // 規則:recheck.mjs 檔頭【理由之值只此一份】「七值之窮舉在 RECHECK_REASONS」;JSDoc「值即重審項之 reason,亦為狀態 impactRecheck 之已持久化之值——不可改」
            assert.ok(Object.isFrozen(RECHECK_REASONS))
            const vals = Object.values(RECHECK_REASONS)
            assert.ok(vals.every((v) => typeof v === 'string' && v.length > 0))
            assert.equal(new Set(vals).size, vals.length, '值互異')
            assert.equal(vals.length, 7)
            // recheckItemsOf JSDoc 所列之七個 reason 值(已持久化,不可改)
            assert.deepEqual([...vals].sort(), ['changed', 'conflict', 'conflictGone', 'conflictReason', 'partner', 'relationChanged', 'resend'])
        })

        it('URGENT_RECHECK_REASONS:凍結、為 RECHECK_REASONS 值之子集、互異;成員即「立即到期」五項', () => {
            // 規則:URGENT_RECHECK_REASONS 註解「立即到期之重審理由(不等湊批):內容已變、衝突已撤銷、關聯已變更、衝突理由已更新、重送」
            assert.ok(Object.isFrozen(URGENT_RECHECK_REASONS))
            assert.ok(Array.isArray(URGENT_RECHECK_REASONS))
            const all = Object.values(RECHECK_REASONS)
            assert.ok(URGENT_RECHECK_REASONS.every((x) => all.includes(x)), '子集')
            assert.equal(new Set(URGENT_RECHECK_REASONS).size, URGENT_RECHECK_REASONS.length, '互異')
            assert.deepEqual([...URGENT_RECHECK_REASONS].sort(), [RECHECK_REASONS.changed, RECHECK_REASONS.conflictGone, RECHECK_REASONS.relationChanged, RECHECK_REASONS.conflictReason, RECHECK_REASONS.resend].sort())
        })

        it('立即到期與湊批(新判衝突 conflict、新關聯之夥伴 partner)兩組不相交且合為全集', () => {
            // 規則:檔頭【到期】「立即到期之理由…不等湊批;湊批之理由(新判衝突、新關聯之夥伴)…才到期」——每個理由只屬一組
            const batched = [RECHECK_REASONS.conflict, RECHECK_REASONS.partner]
            assert.deepEqual(URGENT_RECHECK_REASONS.filter((x) => batched.includes(x)), [])
            assert.deepEqual([...URGENT_RECHECK_REASONS, ...batched].sort(), Object.values(RECHECK_REASONS).sort())
        })
    })
})
