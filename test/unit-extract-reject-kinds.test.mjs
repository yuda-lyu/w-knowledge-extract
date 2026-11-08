// unit-extract-reject-kinds.test.mjs — 拒收／擋下／剔除／存疑之型別碼(core/rejectKinds,規則帳本 EXT-38;使用端 Gitea #109 §1):
//   K1 型別碼清單(常數)之形狀:六組、組內碼唯一且為 kebab-case、皆有說明、皆含 unclassified 安全網;組別與執行摘要之 By 鍵、既有總數鍵一一對應
//   K2 理由字串 → 碼之對照(終審剔除與存疑之理由為封閉列舉)與 workflow/verdicts 之列舉同一份
//   K3 每個判定分支各產一個碼:applyDelta 之 opsRejected 組(逐碼觸發)、validateVia 之 integrateRejected 組、guardOps 之 guard 組、applyPatch 之 reviseBlocked 組、
//      applyVerdicts 之 acceptDropped／doubted 組;被拒之項目帶 kind、理由字樣不變
//   K4 原始碼掃描:各判定分支之碼字面皆在其組之清單、清單內之碼皆有分支使用(無死碼、無漏登記)
//   K5 輔助函數(rejectKindOf、rejectTag、rejectStatKey、rejectStatSplit、kindTally)
//   K6 日誌行之型別碼與 detail／stats 之鍵同源:runPass 層(guardBy、reviseBlockedBy、integrateRejectedBy 與其日誌行)與提煉段層(detail 六個 By 鍵、和等於既有總數、
//      日誌行解出之計數等於 detail、日誌行之碼皆在清單常數)
// 每條斷言之依據:使用端 Gitea #109 §1「型別碼為套件內既有判定分支之穩定識別」「型別碼清單匯出為常數」;各組之總數鍵即既有 report 鍵
// 執行:自套件根 node <mocha> test/unit-extract-reject-kinds.test.mjs(不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PKG_ROOT, tmpRoot, removeRoots, resetConceptFold } from './tools/extractTestKit.mjs'
import { seedCore, SEATS, seatAi, scriptAi, keepAll, codesIn, auditHigh, auditOps, verdictOn, draftAll, mkEnvIn, runStage } from './tools/extractKit.mjs'
import { runPass } from '../src/workflow/runPass.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { applyDelta } from '../src/stores/coreDelta.mjs'
import { coreStateOf } from '../src/standards/esCases.mjs'
import { holdItems, withdrawSources } from '../src/stores/coreState.mjs'
import { validateVia } from '../src/workflow/candidates.mjs'
import { guardOps } from '../src/standards/opGuards.mjs'
import { applyPatch, removalAllowed } from '../src/workflow/reviewGuards.mjs'
import { applyVerdicts, DROP_REASONS, DISSOLVE_DROP_REASONS, DOUBT_REASONS } from '../src/workflow/verdicts.mjs'
import { EXTRACT_REPORT_KEYS, extractStatInit } from '../src/logContract.mjs'
import {
    REJECT_KINDS, REJECT_GROUPS, REJECT_BY_KEYS, DROP_REASON_KINDS, DOUBT_REASON_KINDS, REJECT_TAG_RE, UNCLASSIFIED_KIND,
    rejectKindOf, rejectTag, rejectStatKey, rejectStatSplit, kindTally, passKindStats
} from '../src/core/rejectKinds.mjs'

const CTX = { batch: [{ code: 'N1', id: 'n1' }, { code: 'N2', id: 'n2' }] }
const ANN = { critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }
const add = (ref, text, src = 'N1') => ({ op: 'add', ref, kind: 'rule', text, basis: '案例', sources: [src], ...ANN })

/** 兩條主張(C1、C2)、一參數(P1)、一問題(Q1) */
const S2 = () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'], facet: 'f1' }, { text: '乙方法無效', sources: ['n2'] }], parameters: [{ name: 'p', value: '1', sources: ['n1'] }], questions: [{ text: '問題一', sources: ['n1'] }] }).state
/** 兩條主張與一爭議(D1;兩方各引一條主張) */
const SD = () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }, { text: '乙方法無效', sources: ['n2'] }], disputes: [{ question: '甲乙何者成立', sides: [{ position: '甲成立', claims: ['C1'], sources: ['n1'] }, { position: '乙成立', claims: ['C2'], sources: ['n2'] }] }] }).state
/** 一爭議(D1;兩方只有立場與出處,無所引主張) */
const SP = () => coreStateOf({ disputes: [{ question: '甲乙何者成立', sides: [{ position: '甲成立', sources: ['n1'] }, { position: '乙成立', sources: ['n2'] }] }] }).state
/** 一爭議(D1;已撤回) */
const SDT = () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }, { text: '乙方法無效', sources: ['n2'] }], disputes: [{ question: 'q', sides: [{ position: 'a', claims: ['C1'], sources: ['n1'] }, { position: 'b', claims: ['C2'], sources: ['n2'] }], status: 'retracted', note: 'x' }] }).state
/** 一爭議(D1;已解決:非未解決) */
const SDR = () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }, { text: '乙方法無效', sources: ['n2'] }], disputes: [{ question: 'q', sides: [{ position: 'a', claims: ['C1'], sources: ['n1'] }, { position: 'b', claims: ['C2'], sources: ['n2'] }], status: 'resolved' }] }).state
/** 含一條已撤回之主張(C2)、一則已解決之問題(Q1) */
const STERM = () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }, { text: '乙方法無效', sources: ['n2'], status: 'retracted', statusNote: '離題', retractReason: '離題' }], questions: [{ text: '問題一', sources: ['n1'], status: 'resolved' }] }).state

describe('unit-extract-reject-kinds', function() {

    this.timeout(60_000)

    describe('K1 型別碼清單(常數)之形狀', () => {
        it('六組;組內碼唯一(物件鍵)、為 kebab-case、皆有非空說明、皆含 unclassified 安全網;REJECT_GROUPS 與 REJECT_KINDS 之組一一對應', () => {
            assert.deepEqual(Object.keys(REJECT_KINDS), ['opsRejected', 'integrateRejected', 'guard', 'reviseBlocked', 'acceptDropped', 'doubted'])
            assert.deepEqual(Object.keys(REJECT_GROUPS), Object.keys(REJECT_KINDS))
            for (const [g, kinds] of Object.entries(REJECT_KINDS)) {
                assert.ok(Object.isFrozen(kinds), `${g} 凍結`)
                assert.ok(Object.hasOwn(kinds, UNCLASSIFIED_KIND), `${g} 含安全網`)
                for (const [code, desc] of Object.entries(kinds)) {
                    assert.match(code, /^[a-z]+(-[a-z]+)*$/, `${g}.${code} 須為 kebab-case(日誌標記之正則 REJECT_TAG_RE 同讀)`)
                    assert.ok(typeof desc === 'string' && desc.length > 0, `${g}.${code} 有說明`)
                }
            }
            assert.ok(Object.isFrozen(REJECT_KINDS) && Object.isFrozen(REJECT_GROUPS) && Object.isFrozen(REJECT_BY_KEYS))
        })

        it('各組之 By 鍵與總數鍵皆在執行摘要契約之 detail 鍵;By 鍵之統計初值為 {}、總數鍵之初值為 0(各鍵之和等於總數:以空為起點)', () => {
            const detail = EXTRACT_REPORT_KEYS.detail.extract
            assert.deepEqual(REJECT_BY_KEYS, ['opsRejectedBy', 'integrateRejectedBy', 'guardBy', 'reviseBlockedBy', 'acceptDroppedBy', 'doubtedBy'])
            const init = extractStatInit()
            for (const g of Object.values(REJECT_GROUPS)) {
                assert.ok(detail.includes(g.by) && detail.includes(g.total), `${g.by}／${g.total} 在契約`)
                assert.deepEqual(init[g.by], {})
                assert.equal(init[g.total], 0)
            }
            // 既有之五個總數鍵(主控定:各 By 之和等於「既有總數」)
            assert.deepEqual(['opsRejected', 'guardRejected', 'patchBlocked', 'opsDropped', 'opsDoubted'].map((k) => detail.includes(k)), [true, true, true, true, true])
            // 初值不共用參考(各次取得之 {} 互不牽動)
            assert.notEqual(extractStatInit().guardBy, extractStatInit().guardBy)
        })
    })

    describe('K2 理由 → 碼之對照與 workflow/verdicts 之列舉同一份', () => {
        it('終審剔除之理由(DROP_REASONS ∪ DISSOLVE_DROP_REASONS)與 DROP_REASON_KINDS 之鍵同集、值皆在 acceptDropped 清單且互異', () => {
            assert.deepEqual([...new Set([...DROP_REASONS, ...DISSOLVE_DROP_REASONS])].sort(), Object.keys(DROP_REASON_KINDS).sort())
            const codes = Object.values(DROP_REASON_KINDS)
            assert.equal(new Set(codes).size, codes.length)
            for (const c of codes) assert.ok(Object.hasOwn(REJECT_KINDS.acceptDropped, c), c)
        })

        it('終審存疑之理由(DOUBT_REASONS)與 DOUBT_REASON_KINDS 之鍵同集、值皆在 doubted 清單', () => {
            assert.deepEqual([...DOUBT_REASONS].sort(), Object.keys(DOUBT_REASON_KINDS).sort())
            for (const c of Object.values(DOUBT_REASON_KINDS)) assert.ok(Object.hasOwn(REJECT_KINDS.doubted, c), c)
        })
    })

    describe('K3 每個判定分支各產一個碼', () => {
        // ── applyDelta 之 opsRejected 組:[碼, 狀態, 操作, ctx(淺合併於 CTX), 預期被拒之操作數(未給＝1)] ──
        const DELTA_CASES = [
            ['op-not-in-pass', S2, [{ op: 'confirm', id: 'C1', sources: ['N1'] }], { onlyOps: ['essence'] }],
            ['op-not-in-mode', S2, [add('a', '甲方法有效且穩定')], { mode: 'consolidate' }],
            ['op-unknown', S2, [{ op: 'bogus' }]],
            ['ref-duplicate', S2, [add('a', '丙說法一'), add('a', '丁說法二')], {}, 2],
            ['state-op-multiple', S2, [{ op: 'revise', id: 'C1', fields: { text: '甲方法有效且穩定' }, reason: 'r', sources: ['N1'] }, { op: 'revise', id: 'C1', fields: { text: '甲方法有效而可靠' }, reason: 'r', sources: ['N1'] }], {}, 2],
            ['state-op-confirm-vs-terminal', S2, [{ op: 'confirm', id: 'C1', sources: ['N1'] }, { op: 'retract', id: 'C1', reason: '離題' }], {}, 2],
            ['launder-source-withdrawn', () => withdrawSources(S2(), { withdraw: [{ id: 'n1', title: 't', reason: 'r' }], at: 'T' }).state, [{ op: 'essence', text: '結論', claims: ['C1'], reason: 'r' }]],
            ['launder-source-held', () => holdItems(S2(), [{ id: 'C1', std: 'ES9', why: 'x' }], { at: 'T' }).state, [{ op: 'essence', text: '結論', claims: ['C1'], reason: 'r' }]],
            ['recheck-retract-has-other-sources', () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1', 'n2'] }] }).state, [{ op: 'retract', id: 'C1', reason: '無出處支持' }], { recheckIds: ['n1'] }],
            ['ref-undefined', S2, [{ op: 'param_add', name: 'x', value: '1', sources: ['N1'], claim: '@zzz' }]],
            ['dependency-rejected', S2, [{ op: 'add', ref: 'a', kind: 'rule', sources: ['N1'] }, { op: 'param_add', name: 'x', value: '1', sources: ['N1'], claim: '@a' }]],
            // 同一碼之另一條路徑(引用經 refOfKind／resolveRef 與經 targetOfKind 各自產碼,逐路徑觸發才抓得到誤標)
            ['dependency-rejected', S2, [{ op: 'add', ref: 'a', kind: 'rule', sources: ['N1'] }, { op: 'confirm', id: '@a', sources: ['N1'] }]],
            ['ref-undefined', S2, [{ op: 'confirm', id: '@zzz', sources: ['N1'] }]],
            ['item-not-found', S2, [{ op: 'param_add', name: 'x', value: '1', sources: ['N1'], claim: 'C99' }]],
            ['target-kind-mismatch', S2, [{ op: 'param_add', name: 'x', value: '1', sources: ['N1'], claim: 'P1' }]],
            ['target-terminal', STERM, [{ op: 'dispute_add', question: 'q', sides: [{ position: 'a', claims: ['C2'] }, { position: 'b', sources: ['N1'] }] }]],
            ['item-not-found', S2, [{ op: 'confirm', id: 'C99', sources: ['N1'] }]],
            ['target-kind-mismatch', () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }, { text: '乙方法無效', sources: ['n2'] }], disputes: [{ question: 'q', sides: [{ position: 'a', claims: ['C1'] }, { position: 'b', claims: ['C2'] }] }], questions: [{ text: 'q1', sources: ['n1'] }] }).state, [{ op: 'contest', id: 'Q1', dispute: 'D1', side: 0, reason: 'r', sources: ['N1'] }]],
            ['target-terminal', STERM, [{ op: 'confirm', id: 'C2', sources: ['N1'] }]],
            ['target-not-open', STERM, [{ op: 'question_resolve', id: 'Q1', resolution: '已解', sources: ['N1'] }]],
            ['kind-not-allowed', S2, [{ ...add('a', '丙說法一'), kind: 'bogus' }]],
            ['missing-field', S2, [{ op: 'add', kind: 'rule', sources: ['N1'] }]],
            ['no-batch-source', S2, [{ ...add('a', '丙說法一'), sources: [] }]],
            ['text-too-long', S2, [add('a', '長'.repeat(400))]],
            ['essence-too-long', S2, [{ op: 'essence', text: '長'.repeat(400), claims: ['C1'], reason: 'r' }]],
            ['dangling-text-ref', S2, [add('a', '依〔C99〕之說法成立')]],
            ['revise-no-editable-field', S2, [{ op: 'revise', id: 'C1', fields: { bogus: 'x' }, reason: 'r', sources: ['N1'] }]],
            ['required-field-emptied', S2, [{ op: 'revise', id: 'C1', fields: { text: '' }, reason: 'r', sources: ['N1'] }]],
            ['side-invalid', SD, [{ op: 'confirm', id: 'D1', side: 9, sources: ['N1'] }]],
            ['retract-reason-invalid', S2, [{ op: 'retract', id: 'C1', reason: '亂寫' }]],
            ['retract-duplicate-needs-into', S2, [{ op: 'retract', id: 'C1', reason: '重複' }]],
            ['supersede-by-self', S2, [{ op: 'supersede', id: 'C1', by: 'C1', reason: 'r', validPeriod: '2020', sources: ['N1'] }]],
            ['contest-needs-dispute', SD, [{ op: 'contest', id: 'C1', reason: 'r', sources: ['N1'] }]],
            ['dispute-sides-too-few', S2, [{ op: 'dispute_add', question: 'q', sides: [{ position: 'p', sources: ['N1'] }] }]],
            ['dispute-side-no-position', S2, [{ op: 'dispute_add', question: 'q', sides: [{ position: '', sources: ['N1'] }, { position: 'b', sources: ['N2'] }] }]],
            ['dispute-side-no-source', S2, [{ op: 'dispute_add', question: 'q', sides: [{ position: 'a' }, { position: 'b', sources: ['N2'] }] }]],
            ['dispute-status-invalid', SD, [{ op: 'dispute_update', id: 'D1', note: 'n', status: 'bogus' }]],
            ['same-doc-pair', S2, [{ op: 'dispute_add', question: 'q', sides: [{ position: 'a', sources: ['N1'] }, { position: 'b', sources: ['N1'] }] }]],
            ['essence-duplicate', S2, [{ op: 'essence', text: '結論一', claims: ['C1'], reason: 'r' }, { op: 'essence', text: '結論二', claims: ['C1'], reason: 'r' }]],
            ['essence-claims-required', S2, [{ op: 'essence', text: '結論', claims: [], reason: 'r' }]],
            ['merge-invalid-from', S2, [{ op: 'merge', into: 'C1', from: [], reason: 'r' }], { mode: 'consolidate' }],
            ['merge-text-overwrite', S2, [{ op: 'merge', into: 'C1', from: ['C2'], reason: 'r', text: '完全無關之合併稿內容與字樣' }], { mode: 'consolidate' }],
            ['merge-dispute-clash', SD, [{ op: 'merge', into: 'C1', from: ['C2'], reason: 'r' }], { mode: 'consolidate' }],
            ['split-parts-invalid', S2, [{ op: 'split', id: 'C1', reason: 'r', parts: [{ text: '甲方法' }] }]],
            ['split-part-not-subset', S2, [{ op: 'split', id: 'C1', reason: 'r', parts: [{ text: '完全不同之第一條' }, { text: '完全不同之第二條' }] }]],
            ['split-coverage-low', () => coreStateOf({ claims: [{ text: '甲方法有效且在多數情況下穩定可靠並經多次實驗驗證', sources: ['n1'] }] }).state, [{ op: 'split', id: 'C1', reason: 'r', parts: [{ text: '甲方法有效' }, { text: '甲方法有效' }] }]],
            ['refacet-invalid', S2, [{ op: 'refacet', from: 'f1', to: 'f1' }], { mode: 'consolidate' }],
            ['refacet-no-match', S2, [{ op: 'refacet', from: 'none', to: 'x' }], { mode: 'consolidate' }],
            ['dissolve-side-unconvertible', SP, [{ op: 'dispute_dissolve', id: 'D1', reason: '兩方非對立', kinds: ['rule', 'rule'], annotations: [{ critique: '長'.repeat(900) }] }]],
            // ── 同一碼有多個站點者(各操作之同類拒收分別標碼;逐站點觸發才抓得到單一站點之誤標) ──
            ['missing-field', S2, [{ op: 'revise', id: 'C1', fields: { text: '甲方法有效且穩定' }, sources: ['N1'] }]], // revise 缺 reason
            ['missing-field', S2, [{ op: 'supersede', id: 'C1', validPeriod: '2020', sources: ['N1'] }]], // supersede 缺 reason
            ['missing-field', S2, [{ op: 'supersede', id: 'C1', reason: 'r', sources: ['N1'] }]], // supersede 缺 validPeriod
            ['missing-field', SD, [{ op: 'contest', id: 'C1', dispute: 'D1', side: 0, sources: ['N1'] }]], // contest 缺 reason
            ['missing-field', SD, [{ op: 'dispute_update', id: 'D1', sides_add: [{ position: 'c', sources: ['N1'] }] }]], // dispute_update 缺 note
            ['missing-field', S2, [{ op: 'dispute_add', sides: [{ position: 'a', sources: ['N1'] }, { position: 'b', sources: ['N2'] }] }]], // dispute_add 缺 question
            ['missing-field', SP, [{ op: 'dispute_dissolve', id: 'D1', kinds: ['rule', 'rule'] }]], // 拆解缺 reason
            ['missing-field', S2, [{ op: 'param_add', sources: ['N1'] }]], // param_add 缺 name／value
            ['missing-field', S2, [{ op: 'question_add' }]], // question_add 缺 text
            ['missing-field', S2, [{ op: 'question_resolve', id: 'Q1', sources: ['N1'] }]], // question_resolve 缺 resolution
            ['missing-field', S2, [{ op: 'essence', claims: ['C1'], reason: 'r' }]], // essence 缺 text
            ['missing-field', () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }], essence: { text: '既有本質', claims: ['C1'] } }).state, [{ op: 'essence', text: '新本質', claims: ['C1'] }]], // 改寫本質缺 reason
            ['missing-field', S2, [{ op: 'related_add', concepts: [] }]], // related_add 缺 concepts
            ['missing-field', S2, [{ op: 'merge', into: 'C1', from: ['C2'] }], { mode: 'consolidate' }], // merge 缺 reason
            ['missing-field', S2, [{ op: 'split', id: 'C1', parts: [{ text: 'a' }, { text: 'b' }] }]], // split 缺 reason
            ['no-batch-source', S2, [{ op: 'confirm', id: 'C1', sources: [] }]],
            ['no-batch-source', S2, [{ op: 'revise', id: 'C1', fields: { text: '甲方法有效且穩定' }, reason: 'r' }]],
            ['no-batch-source', S2, [{ op: 'supersede', id: 'C1', reason: 'r', validPeriod: '2020' }]],
            ['no-batch-source', SD, [{ op: 'contest', id: 'C1', dispute: 'D1', side: 0, reason: 'r' }]],
            ['no-batch-source', S2, [{ op: 'dispute_add', question: 'q', sides: [{ position: 'a', claims: ['C1'] }, { position: 'b', claims: ['C2'] }] }]],
            ['no-batch-source', S2, [{ op: 'param_add', name: 'x', value: '1' }]],
            ['no-batch-source', S2, [{ op: 'question_resolve', id: 'Q1', resolution: '已解' }]],
            ['target-terminal', STERM, [{ op: 'revise', id: 'C2', fields: { text: '乙方法無效且穩定' }, reason: 'r', sources: ['N1'] }]],
            ['target-terminal', STERM, [{ op: 'supersede', id: 'C2', reason: 'r', validPeriod: '2020', sources: ['N1'] }]],
            ['target-terminal', STERM, [{ op: 'retract', id: 'C2', reason: '離題' }]],
            ['target-terminal', () => coreStateOf({ claims: [{ text: '甲方法有效', sources: ['n1'] }, { text: '乙方法無效', sources: ['n2'], status: 'retracted', statusNote: 'x', retractReason: '離題' }], disputes: [{ question: 'q', sides: [{ position: 'a', claims: ['C1'], sources: ['n1'] }, { position: 'b', sources: ['n2'] }] }] }).state, [{ op: 'contest', id: 'C2', dispute: 'D1', side: 0, reason: 'r', sources: ['N1'] }]],
            ['target-terminal', STERM, [{ op: 'split', id: 'C2', reason: 'r', parts: [{ text: 'a' }, { text: 'b' }] }]],
            ['target-terminal', SDT, [{ op: 'dispute_update', id: 'D1', note: 'n' }]],
            ['target-terminal', SDT, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r' }]],
            ['target-not-open', SDR, [{ op: 'contest', id: 'C1', dispute: 'D1', side: 0, reason: 'r', sources: ['N1'] }]],
            ['side-invalid', SD, [{ op: 'contest', id: 'C1', dispute: 'D1', side: 9, reason: 'r', sources: ['N1'] }]],
            ['kind-not-allowed', S2, [{ op: 'revise', id: 'C1', fields: { kind: 'bogus' }, reason: 'r', sources: ['N1'] }]],
            ['kind-not-allowed', SP, [{ op: 'dispute_dissolve', id: 'D1', reason: 'r', kinds: ['bogus', 'rule'] }]],
            ['kind-not-allowed', S2, [{ op: 'split', id: 'C1', reason: 'r', parts: [{ text: '甲方法有效', kind: 'bogus' }, { text: '甲方法有效' }] }]],
            ['dangling-text-ref', S2, [{ op: 'essence', text: '依〔C99〕之結論', claims: ['C1'], reason: 'r' }]],
            ['dangling-text-ref', S2, [{ op: 'merge', into: 'C1', from: ['C2'], reason: 'r', text: '甲方法有效乙方法無效〔C99〕' }], { mode: 'consolidate' }],
            ['text-too-long', S2, [{ op: 'merge', into: 'C1', from: ['C2'], reason: 'r', text: '甲方法有效乙方法無效'.repeat(40) }], { mode: 'consolidate' }],
        ]

        for (const [kind, mk, ops, ctx, n] of DELTA_CASES) {
            it(`applyDelta:${kind}——被拒之操作帶 kind「${kind}」,理由非空`, () => {
                const r = applyDelta(mk(), { ops }, { ...CTX, ...(ctx || {}) })
                const hit = r.rejected.filter((x) => x.kind === kind)
                assert.ok(hit.length >= 1, `應有 kind=${kind} 之拒收;實得 ${JSON.stringify(r.rejected.map((x) => [x.kind, x.reason]))}`)
                assert.equal(hit.length, n || 1, JSON.stringify(r.rejected.map((x) => [x.kind, x.reason])))
                for (const x of r.rejected) {
                    assert.ok(typeof x.reason === 'string' && x.reason.length > 0)
                    assert.ok(Object.hasOwn(REJECT_KINDS.opsRejected, x.kind), `${x.kind} 在清單`)
                    assert.notEqual(x.kind, UNCLASSIFIED_KIND, `${x.reason} 漏標`)
                }
            })
        }

        it('applyDelta:opsRejected 組之全部碼(除 unclassified)皆有上列觸發案——無碼只靠清單而無實測', () => {
            const tested = new Set(DELTA_CASES.map((c) => c[0]))
            const all = Object.keys(REJECT_KINDS.opsRejected).filter((k) => k !== UNCLASSIFIED_KIND)
            assert.deepEqual(all.filter((k) => !tested.has(k)), [], '未實測之碼')
        })

        it('applyDelta:被拒收之理由字樣不變(只加 kind 欄,既有欄 index／op／reason／sources 照舊)', () => {
            const r = applyDelta(S2(), { ops: [{ op: 'confirm', id: 'C99', sources: ['N1'] }] }, CTX)
            assert.deepEqual(r.rejected, [{ index: 0, op: 'confirm', reason: '目標 C99 不存在', sources: ['n1'], kind: 'item-not-found' }])
        })

        // ── validateVia 之 integrateRejected 組 ──
        it('validateVia:五個判式各產其碼(via-missing、op-type-changed、target-mismatch、source-not-in-candidates、text-diverged),理由字樣不變', () => {
            const cAdd = { _oid: 'a1_0', op: 'add', kind: 'rule', text: '甲乙丙丁戊己庚辛', sources: ['N1'] }
            const cConf = { _oid: 'a1_1', op: 'confirm', id: 'C1', sources: ['N1'] }
            const by = new Map([['a1_0', cAdd], ['a1_1', cConf]])
            const one = (op) => validateVia([op], by).rejected[0]
            assert.deepEqual(one({ op: 'add', kind: 'rule', text: '甲乙丙丁戊己庚辛', sources: ['N1'], via: [] }), { op: { op: 'add', kind: 'rule', text: '甲乙丙丁戊己庚辛', sources: ['N1'] }, reason: 'via 未指回任何候選操作（整合不可新增候選沒有之操作）', kind: 'via-missing' })
            assert.equal(one({ op: 'confirm', id: 'C1', sources: ['N1'], via: ['a1_0'] }).kind, 'op-type-changed')
            assert.equal(one({ op: 'confirm', id: 'C2', sources: ['N1'], via: ['a1_1'] }).kind, 'target-mismatch')
            const src = one({ op: 'add', kind: 'rule', text: '甲乙丙丁戊己庚辛', sources: ['N1', 'N9'], via: ['a1_0'] })
            assert.deepEqual([src.kind, src.reason], ['source-not-in-candidates', '出處 N9 不在所引候選之出處內'])
            assert.equal(one({ op: 'add', kind: 'rule', text: '全新而無關之文字內容', sources: ['N1'], via: ['a1_0'] }).kind, 'text-diverged')
            // 合格者無拒收
            assert.equal(validateVia([{ op: 'add', kind: 'rule', text: '甲乙丙丁戊己庚辛', sources: ['N1'], via: ['a1_0'] }], by).rejected.length, 0)
        })

        // ── guardOps 之 guard 組 ──
        it('guardOps:只見索引行之條目被改狀態 → target-not-in-prompt;可見者不拒', () => {
            const s = S2()
            const r = guardOps([{ op: 'revise', id: 'C1', fields: { text: '甲方法有效且穩定' }, reason: 'r' }], { state: s, visible: new Set() })
            assert.deepEqual(r.rejected.map((x) => x.kind), ['target-not-in-prompt'])
            assert.match(r.rejected[0].reason, /^目標 C1 未於提示詞中附全文/)
            assert.equal(guardOps([{ op: 'revise', id: 'C1', fields: { text: '甲方法有效且穩定' }, reason: 'r' }], { state: s, visible: new Set(['C1']) }).rejected.length, 0)
        })

        // ── applyPatch／removalAllowed 之 reviseBlocked 組 ──
        describe('applyPatch／removalAllowed:reviseBlocked 組', () => {
            const a0 = { _oid: 'a1_0', op: 'add', kind: 'rule', text: '甲甲甲甲甲甲甲甲', sources: ['N1'] }
            const d0 = { _oid: 'a1_1', op: 'dispute_add', question: 'q', sides: [{ position: 'a', sources: ['N1'] }, { position: 'b', sources: ['N2'] }] }
            const guardPass = (xs) => ({ ops: xs, rejected: [] })
            const kindsOf = (patch, ctx = {}, ops = [a0, d0]) => applyPatch(ops, patch, { state: S2(), issues: [], guard: guardPass, ...ctx }).log.filter((x) => !x.ok).map((x) => x.kind)

            it('op-not-found:remove／edit 指向不存在之操作', () => {
                assert.deepEqual(kindsOf({ removes: [{ ref: 'zz' }], edits: [{ ref: 'zz', fields: { text: 'x' } }] }), ['op-not-found', 'op-not-found'])
            })
            it('severity-too-low:建設性操作以無(或中低)意見移除;removal-dispute-not-offtopic:爭議類操作移除而理由非離題', () => {
                assert.deepEqual(kindsOf({ removes: [{ ref: 'a1_0' }] }), ['severity-too-low'])
                assert.deepEqual(kindsOf({ removes: [{ ref: 'a1_1' }] }), ['removal-dispute-not-offtopic'])
                assert.deepEqual([removalAllowed(a0, S2(), [], '').kind, removalAllowed(d0, S2(), [], '').kind], ['severity-too-low', 'removal-dispute-not-offtopic'])
                assert.equal(removalAllowed(a0, S2(), [], '重複').kind, undefined, '許可者無 kind')
            })
            it('severity-too-low:移除新項而其依附之建設性操作不合移除判準 → 該筆亦被擋、同碼(「引用已移除之新項…但…」)', () => {
                const newItem = { _oid: 'a1_2', op: 'add', ref: 'x', kind: 'rule', text: '丙丙丙丙丙丙丙丙', sources: ['N1'] }
                const dep = { _oid: 'a1_3', op: 'param_add', name: 'p', value: '1', claim: '@x', sources: ['N1'] }
                const issues = [{ k: 0, ref: 'a1_2', severity: '中', type: '重複', detail: 'd', fix: 'f' }]
                const log = applyPatch([newItem, dep], { removes: [{ ref: 'a1_2' }] }, { state: S2(), issues, guard: guardPass }).log
                assert.deepEqual(log.map((x) => [x.ok, x.kind]), [[true, undefined], [false, 'severity-too-low']])
                assert.match(log[1].why, /^引用已移除之新項 @x，但/)
            })
            it('no-editable-field、text-overwrite(兩種寫法:頂層欄與 revise 之 fields.text)', () => {
                assert.deepEqual(kindsOf({ edits: [{ ref: 'a1_0', fields: { bogus: 1 } }] }), ['no-editable-field'])
                assert.deepEqual(kindsOf({ edits: [{ ref: 'a1_0', fields: { text: '完全不同之改寫文字內容' } }] }), ['text-overwrite'])
                const rev = { _oid: 'a1_4', op: 'revise', id: 'C1', fields: { text: '甲方法有效且穩定可靠' }, reason: 'r', sources: ['N1'] }
                assert.deepEqual(kindsOf({ edits: [{ ref: 'a1_4', fields: { fields: { text: '完全不同之改寫文字內容' } } }] }, {}, [rev]), ['text-overwrite'])
            })
            it('guard-rejected:改寫或新增之操作過不了操作守門', () => {
                const guardNo = () => ({ ops: [], rejected: [{ reason: '守門之理由' }] })
                const issues = [{ k: 0, ref: 'a1_0', severity: '高', type: '離題', detail: 'd', fix: 'f' }]
                assert.deepEqual(kindsOf({ edits: [{ ref: 'a1_0', fields: { text: '甲甲甲甲甲甲甲甲甲' } }], adds: [{ ...add('n', '丁丁丁丁丁丁'), issue: '0' }] }, { guard: guardNo, issues }), ['guard-rejected', 'guard-rejected'])
            })
            it('over-limit:補丁使本條由合格變超限(edit)、新增超限(add)', () => {
                const issues = [{ k: 0, ref: 'a1_0', severity: '高', type: '離題', detail: 'd', fix: 'f' }]
                assert.deepEqual(kindsOf({ edits: [{ ref: 'a1_0', fields: { text: '甲'.repeat(400) } }], adds: [{ ...add('n', '丁'.repeat(400)), issue: '0' }] }, { issues }), ['over-limit', 'over-limit'])
            })
            it('new-standard-issue(edit 使本條新增問題)、add-standard-issue(add 之操作未達標準)', () => {
                const issues = [{ k: 0, ref: 'a1_0', severity: '高', type: '離題', detail: 'd', fix: 'f' }]
                const problemsOf = (xs) => new Map(xs.map((o) => [o, String(o.text || '').includes('壞') ? [{ std: 'ES2', field: 'text', detail: 'd', items: ['x'] }] : []]))
                assert.deepEqual(kindsOf({ edits: [{ ref: 'a1_0', fields: { text: '甲甲甲甲甲甲甲甲壞' } }] }, { issues, problemsOf }), ['new-standard-issue'])
                assert.deepEqual(kindsOf({ adds: [{ ...add('n', '壞壞壞壞壞壞'), issue: '0' }] }, { issues, problemsOf }), ['add-standard-issue'])
            })
            it('add-op-missing、add-needs-issue', () => {
                assert.deepEqual(kindsOf({ adds: [{ issue: '0' }] }), ['add-op-missing'])
                assert.deepEqual(kindsOf({ adds: [{ ...add('n', '丁丁丁丁丁丁') }] }), ['add-needs-issue'])
            })
            it('reviseBlocked 組之全部碼(除 unclassified)皆有上列觸發案', () => {
                const covered = new Set(['op-not-found', 'severity-too-low', 'removal-dispute-not-offtopic', 'no-editable-field', 'text-overwrite', 'guard-rejected', 'over-limit', 'new-standard-issue', 'add-standard-issue', 'add-op-missing', 'add-needs-issue'])
                assert.deepEqual(Object.keys(REJECT_KINDS.reviseBlocked).filter((k) => k !== UNCLASSIFIED_KIND && !covered.has(k)), [])
            })
        })

        // ── applyVerdicts 之 acceptDropped／doubted 組 ──
        describe('applyVerdicts:acceptDropped／doubted 組', () => {
            // 各理由所用之操作(依 applyVerdicts 之可用理由表:新增主張／參數不收「性質標錯」、爭議類只收離題、拆解另收對立成立)
            const OP_FOR = { 離題: { op: 'confirm', id: 'C1', sources: ['N1'] }, 無出處支持: { op: 'confirm', id: 'C1', sources: ['N1'] }, 同篇: { op: 'confirm', id: 'C1', sources: ['N1'] }, 重複: { op: 'confirm', id: 'C1', sources: ['N1'] }, 性質標錯: { op: 'confirm', id: 'C1', sources: ['N1'] }, 捏造: { op: 'confirm', id: 'C1', sources: ['N1'] }, 對立成立: { op: 'dispute_dissolve', id: 'D1', reason: 'r' } }
            for (const [reason, kind] of Object.entries(DROP_REASON_KINDS)) {
                it(`剔除理由「${reason}」→ kind「${kind}」`, () => {
                    const v = applyVerdicts({ ops: [OP_FOR[reason]] }, [{ i: 0, action: 'drop', reason }])
                    assert.deepEqual(v.dropped.map((x) => [x.reason, x.kind]), [[reason, kind]])
                })
            }
            for (const [reason, kind] of Object.entries(DOUBT_REASON_KINDS)) {
                it(`存疑理由「${reason}」→ kind「${kind}」(doubt 與 drop＋理由兩種寫法同碼)`, () => {
                    const op = { op: 'dispute_add', question: 'q', sides: [{ position: 'a', sources: ['N1'] }, { position: 'b', sources: ['N2'] }] }
                    const a = applyVerdicts({ ops: [op] }, [{ i: 0, action: 'doubt', reason, note: 'n' }])
                    const b = applyVerdicts({ ops: [op] }, [{ i: 0, action: 'drop', reason, note: 'n' }])
                    assert.deepEqual([a.doubted.map((x) => x.kind), b.doubted.map((x) => x.kind)], [[kind], [kind]])
                    assert.deepEqual([a.doubted[0].byDrop, b.doubted[0].byDrop], [false, true])
                })
            }
        })
    })

    describe('K4 原始碼掃描:各分支標記之碼皆在其組之清單、清單內之碼皆有分支使用', () => {
        const read = (rel) => fs.readFileSync(path.join(PKG_ROOT, 'src', rel), 'utf8')
        /** 含判定分支標記之行(fail( 或 kind: ')上之 kebab-case 字面(含連字號者;碼之字面寫法) */
        const literalsOf = (rel, linePred) => {
            const out = new Set()
            for (const line of read(rel).split('\n')) {
                if (!linePred(line)) continue
                for (const m of line.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)) out.add(m[1])
            }
            return out
        }
        const SITES = [
            ['opsRejected', 'stores/coreDelta.mjs', (l) => /\bfail\(|\bkind: /.test(l)],
            ['integrateRejected', 'workflow/candidates.mjs', (l) => /\bkind: /.test(l)],
            ['guard', 'standards/opGuards.mjs', (l) => /\bkind: /.test(l)],
            ['reviseBlocked', 'workflow/reviewGuards.mjs', (l) => /\bkind: /.test(l)],
        ]
        for (const [group, rel, pred] of SITES) {
            it(`${rel}:分支標記之碼字面 ⊆ ${group} 清單,且清單之碼(除 unclassified)皆有字面使用`, () => {
                const used = literalsOf(rel, pred)
                const list = new Set(Object.keys(REJECT_KINDS[group]))
                assert.deepEqual([...used].filter((c) => !list.has(c)), [], '使用而未登記')
                assert.deepEqual([...list].filter((c) => c !== UNCLASSIFIED_KIND && !used.has(c) && !(group === 'opsRejected' && ['dependency-rejected'].includes(c) && used.has(c))), [], '登記而無分支使用(死碼)')
            })
        }

        it('日誌行與 detail 取自同一常數:提煉段與工作流之日誌行以 rejectTag(rejectKindOf(組, kind)) 組標記,不內嵌碼字面', () => {
            for (const rel of ['stages/extractChain.mjs', 'workflow/runPass.mjs']) {
                const text = read(rel)
                assert.ok(!/〔[a-z]+(-[a-z]+)+〕/.test(text), `${rel} 不得內嵌型別碼字面(碼只在 core/rejectKinds 與各判定分支)`)
                assert.match(text, /rejectTag\(rejectKindOf\(/, `${rel} 以 rejectTag 組標記`)
            }
        })
    })

    // ─── K6 日誌行與 detail／stats 同源 ───
    describe('K6 日誌行之型別碼與 detail 之鍵同源(同一常數);各組之和等於既有總數', () => {
        const AT = '2026-10-02T20:00:00+08:00'
        const domain = createExtractDomain({})
        const SEED_BATCH = [{ code: 'N0', id: 's0' }]
        const baseState = () => seedCore({
            coreId: 'm',
            concept: '動量',
            at: AT,
            batch: SEED_BATCH,
            msg: '既有核心之差量須全數套用',
            ops: [
                { op: 'add', ref: 'a', kind: 'principle', text: '投資人對資訊反應不足，使價格緩慢反映消息', basis: '實證', sources: ['N0'] },
                { op: 'add', kind: 'principle', text: '動量報酬在空頭反轉期常出現崩潰，需搭配風險控管', basis: '實證', sources: ['N0'] },
                { op: 'add', kind: 'pitfall', text: '交易成本高時淨報酬消失', basis: '實證', sources: ['N0'] },
                { op: 'essence', text: '動量是贏家續贏之傾向。', claims: ['@a'], reason: '首版' },
            ]
        })
        const BATCH = [
            { code: 'N1', id: 'n1', digest: '### N1 動量與反應不足\n【核心知識】實證顯示投資人對盈餘消息反應不足，動量報酬可持續 3 到 12 個月。' },
            { code: 'N2', id: 'n2', digest: '### N2 動量崩潰\n【核心知識】動量策略在市場由空頭反轉向上時出現大幅虧損，波動率縮放可降低崩潰損失。' },
        ]
        const NOTES = new Map([['n1', { id: 'n1', evidenceLevel: '高', claimType: '實證研究', docId: 'd1' }], ['n2', { id: 'n2', evidenceLevel: '中', claimType: '實證研究', docId: 'd2' }]])
        const run = (state, ai, extra = {}) => {
            const lines = []; return runPass({ state, concept: '動量', batch: BATCH, domain, seats: SEATS, ai, notesById: NOTES, at: AT, log: (l) => lines.push(l), ...extra }).then((r) => ({ r, lines }))
        }
        const c1Of = (s) => s.claims.find((c) => c.text.includes('反應不足'))
        const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0)
        /** 某前綴之日誌行中之型別碼(單項行:每行一碼) */
        const tagsOf = (lines, prefix) => lines.filter((l) => l.startsWith(prefix)).flatMap((l) => [...l.matchAll(REJECT_TAG_RE)].map((m) => m[1]))

        it('操作守門:只見索引行之條目被改 → stats.guardBy＝{ target-not-in-prompt }、和＝guardRejected;日誌行「提煉守門[概念]〔碼〕：」之碼同', async () => {
            const s = baseState()
            const c1 = c1Of(s)
            const ops = [{ op: 'revise', id: c1.id, fields: { text: '投資人反應不足' }, reason: 'r', sources: ['N1'] }, { op: 'confirm', id: c1.id, sources: ['N1'] }]
            const { r, lines } = await run(s, seatAi({ d1: { ops, skipped: [] }, d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: keepAll }), { promptBudget: 10 })
            assert.equal(r.ok, true, r.error)
            assert.deepEqual(r.stats.guardBy, { 'target-not-in-prompt': 1 })
            assert.equal(sum(r.stats.guardBy), r.stats.guardRejected)
            assert.deepEqual(tagsOf(lines, '提煉守門['), ['target-not-in-prompt'])
            assert.match(lines.find((l) => l.startsWith('提煉守門[')), /^提煉守門\[動量\]〔target-not-in-prompt〕：revise 目標 C1 未於提示詞中附全文/, '插入位置:概念名之後、冒號之前;其餘字樣不變')
        })

        it('修訂補丁被擋:中嚴重度移除建設性操作 → stats.reviseBlockedBy＝{ severity-too-low }、和＝patch.blocked;日誌行「提煉修訂擋下[概念]〔碼〕：」之碼同', async () => {
            const s = baseState()
            const text = '動量報酬可持續 3 到 12 個月'
            const mk = () => ({ ops: [{ op: 'add', kind: 'rule', text, sources: ['N1'], ...ANN }], skipped: [] })
            const ai = seatAi({ d1: mk(), d2: mk(), d3: mk(), int: { ops: [{ op: 'add', kind: 'rule', text, sources: ['N1'], ...ANN, via: ['a1_1'] }], skipped: [] }, acc: keepAll, aud: { issues: [{ ref: 'i_1', severity: '中', type: '離題', detail: 'x' }] }, rev: { removes: [{ ref: 'i_1', issue: 0 }] } })
            const { r, lines } = await run(s, ai)
            assert.equal(r.ok, true, r.error)
            assert.deepEqual(r.stats.reviseBlockedBy, { 'severity-too-low': 1 })
            assert.equal(sum(r.stats.reviseBlockedBy), r.stats.patch.blocked)
            assert.deepEqual(tagsOf(lines, '提煉修訂擋下['), ['severity-too-low'])
            assert.match(lines.find((l) => l.startsWith('提煉修訂擋下[')), /^提煉修訂擋下\[動量\]〔severity-too-low〕：remove i_1 建設性操作只准以「重複」或「高」嚴重度之離題／捏造意見移除/)
        })

        it('整合輸出之驗證拒收:出處超出所引候選 → stats.integrateRejectedBy＝{ source-not-in-candidates }、和＝integrateRejected;日誌行「提煉整合拒收[概念]〔碼〕：」之碼同', async () => {
            const s = baseState()
            const c1 = c1Of(s)
            const add1 = { op: 'add', ref: 'x', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', basis: '實證', sources: ['N1'], ...ANN }
            const ai = seatAi({
                d1: { ops: [add1, { op: 'confirm', id: c1.id, sources: ['N1'] }], skipped: [] },
                d2: { ops: [{ op: 'add', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', sources: ['N1'], ...ANN }], skipped: [] },
                d3: 'fail',
                int: { ops: [{ ...add1, via: ['a1_1', 'a2_1'] }, { op: 'confirm', id: c1.id, sources: ['N1'], via: ['a1_2'] }, { op: 'confirm', id: c1.id, sources: ['N1', 'N2'], via: ['a1_2'] }], skipped: [] },
                aud: { issues: [] },
                acc: keepAll,
            })
            const { r, lines } = await run(s, ai)
            assert.equal(r.ok, true, r.error)
            assert.deepEqual(r.stats.integrateRejectedBy, { 'source-not-in-candidates': 1 })
            assert.equal(sum(r.stats.integrateRejectedBy), r.stats.integrateRejected)
            assert.deepEqual(tagsOf(lines, '提煉整合拒收['), ['source-not-in-candidates'])
            assert.match(lines.find((l) => l.startsWith('提煉整合拒收[')), /^提煉整合拒收\[動量\]〔source-not-in-candidates〕：出處 N2 不在所引候選之出處內$/)
            assert.deepEqual(r.trace.integrateRejected.map((x) => x.kind), ['source-not-in-candidates'], 'trace 亦帶碼')
        })

        // ── 段層:detail 之各 By 鍵、和等於既有總數、日誌行之碼與 detail 之鍵同一份 ──
        let root = ''
        let mkEnv = null
        before(() => {
            root = tmpRoot('extract-reject-kinds')
            mkEnv = mkEnvIn(root)
            resetConceptFold()
        })
        after(() => {
            resetConceptFold()
            removeRoots([root])
        })
        const withDispute = (p) => {
            const [a, b, c] = codesIn(p)
            return { ops: [{ op: 'add', ref: 'x', kind: 'rule', text: '大批次時要預熱', basis: '案例', sources: [a], ...ANN }, { op: 'dispute_add', question: '預熱是否必要', sides: [{ position: '需要', claims: ['@x'] }, { position: '小資料微調時可省略', conditions: ['小資料微調'], sources: [b] }] }, { op: 'add', kind: 'rule', text: '看資料量而定', basis: '案例', sources: [c], ...ANN }], skipped: [] }
        }
        const isDispute = (op) => op.op === 'dispute_add'
        /** 某組之日誌行(聚合行以「、〔碼〕」分項、乘數取 ×n;存疑行逐項取碼)解出之 { 碼: 計數 } */
        const logMapOf = (lines, group) => {
            const prefix = `${REJECT_GROUPS[group].line}[`
            const out = {}
            const bump = (code, n) => {
                out[code] = (out[code] || 0) + n
            }
            for (const l of lines.filter((x) => x.startsWith(`INFO ${prefix}`))) {
                const body = l.slice(l.indexOf('：') + 1)
                if (group === 'doubted') for (const m of body.matchAll(REJECT_TAG_RE)) bump(m[1], 1)
                else if (group === 'opsRejected' || group === 'acceptDropped') {
                    for (const item of body.split('；爭議類')[0].split(/、(?=〔[a-z]+(?:-[a-z]+)*〕)/)) {
                        const m = item.match(/^〔([a-z]+(?:-[a-z]+)*)〕.*×(\d+)$/)
                        bump(m[1], Number(m[2]))
                    }
                }
                else for (const m of l.slice(0, l.indexOf('：')).matchAll(REJECT_TAG_RE)) bump(m[1], 1)
            }
            return out
        }
        const check = (r) => {
            const d = r.report.detail
            const lines = r.log.lines
            for (const [group, g] of Object.entries(REJECT_GROUPS)) {
                assert.equal(sum(d[g.by]), d[g.total], `${g.by} 之和等於 ${g.total}`)
                assert.deepEqual(logMapOf(lines, group), d[g.by], `${group}:日誌行之碼與 detail.${g.by} 同源`)
                for (const code of Object.keys(d[g.by])) assert.ok(Object.hasOwn(REJECT_KINDS[group], code), `${group}.${code} 在清單(日誌行與 detail 皆取自同一常數)`)
                assert.ok(!Object.hasOwn(d[g.by], UNCLASSIFIED_KIND), `${g.by} 無 unclassified(分支皆已標)`)
            }
            // 全部 INFO／WARN 行中之型別碼標記皆在清單之聯集
            const all = new Set(Object.values(REJECT_KINDS).flatMap((k) => Object.keys(k)))
            for (const l of lines) for (const m of l.matchAll(REJECT_TAG_RE)) assert.ok(all.has(m[1]), `${m[1]} 不在清單:${l}`)
        }

        it('終審剔除＋所依新項被剔除之連帶拒收:acceptDroppedBy＝{ off-topic:1 }、opsRejectedBy＝{ dependency-rejected:1 };日誌與 detail 同源、各組和等於總數', async () => {
            const isJia = (op) => op.text === '大批次時要預熱'
            const env = mkEnv(['e1', 'e2', 'e3'].map((id) => ({ id, concepts: ['學習率'] })))
            const r = await runStage(env, scriptAi({ draft: withDispute, audit: auditHigh(isJia), accept: verdictOn(isJia, { action: 'drop', reason: '離題', note: '與本概念無關' }) }))
            const d = r.report.detail
            assert.deepEqual([d.acceptDroppedBy, d.opsRejectedBy, d.opsDropped, d.opsRejected], [{ 'off-topic': 1 }, { 'dependency-rejected': 1 }, 1, 1])
            check(r)
        })

        it('終審存疑(doubt 與 drop＋非對立兩種寫法):doubtedBy＝{ not-opposed:1 };日誌與 detail 同源', async () => {
            for (const verdict of [{ action: 'doubt', reason: '非對立', note: '兩方回答不同情境' }, { action: 'drop', reason: '非對立', note: '兩方回答不同情境' }]) {
                const env = mkEnv(['f1', 'f2', 'f3'].map((id) => ({ id, concepts: ['學習率'] })))
                const r = await runStage(env, scriptAi({ draft: withDispute, accept: verdictOn(isDispute, verdict) }))
                assert.deepEqual([r.report.detail.doubtedBy, r.report.detail.opsDoubted], [{ 'not-opposed': 1 }, 1], verdict.action)
                check(r)
            }
        })

        it('整合驗證拒收(整合員改了出處):integrateRejectedBy 記入段層 detail(新增之總數 integrateRejected),日誌與 detail 同源', async () => {
            const env = mkEnv(['g1', 'g2', 'g3'].map((id) => ({ id, concepts: ['學習率'] })))
            const integrate = (p) => {
                const [a] = codesIn(p)
                return { ops: [{ op: 'add', kind: 'rule', text: '大批次時要預熱', basis: '案例', sources: [a, 'N9'], ...ANN, via: ['a1_1'] }], skipped: [] }
            }
            const draft = (p) => ({ ops: [{ op: 'add', kind: 'rule', text: '大批次時要預熱', basis: '案例', sources: [codesIn(p)[0]], ...ANN }], skipped: [] })
            const r = await runStage(env, scriptAi({ draft, integrate }))
            const d = r.report.detail
            assert.deepEqual([d.integrateRejectedBy, d.integrateRejected], [{ 'source-not-in-candidates': 1 }, 1])
            check(r)
        })

        it('修訂補丁被擋(段層):reviseBlockedBy＝{ severity-too-low:1 }、patchBlocked＝1;日誌與 detail 同源', async () => {
            const env = mkEnv(['i1', 'i2', 'i3'].map((id) => ({ id, concepts: ['學習率'] })))
            const draft = (p) => ({ ops: [{ op: 'add', kind: 'rule', text: '大批次時要預熱', basis: '案例', sources: [codesIn(p)[0]], ...ANN }], skipped: [] })
            const audit = (p) => ({ issues: auditOps(p).map((x) => ({ ref: x.oid, severity: '中', type: '離題', detail: 'x', fix: 'y' })) })
            const r = await runStage(env, scriptAi({ draft, audit, revise: { edits: [], adds: [], removes: [{ ref: 'i_1', issue: 0 }] } }))
            const d = r.report.detail
            assert.deepEqual([d.reviseBlockedBy, d.patchBlocked], [{ 'severity-too-low': 1 }, 1])
            check(r)
        })

        it('無拒收之輪:各 By 鍵皆在、為空物件,總數為 0(契約之鍵恆在)', async () => {
            const env = mkEnv(['h1', 'h2', 'h3'].map((id) => ({ id, concepts: ['學習率'] })))
            const r = await runStage(env, scriptAi({ draft: draftAll }))
            for (const g of Object.values(REJECT_GROUPS)) assert.deepEqual([r.report.detail[g.by], r.report.detail[g.total]], [{}, 0], g.by)
            check(r)
        })
    })

    describe('K5 輔助函數', () => {
        it('rejectKindOf:組內之碼原樣、未登記或非字串歸 unclassified、組名不認得拋錯', () => {
            assert.equal(rejectKindOf('guard', 'target-not-in-prompt'), 'target-not-in-prompt')
            assert.equal(rejectKindOf('guard', 'nope'), UNCLASSIFIED_KIND)
            assert.equal(rejectKindOf('guard', undefined), UNCLASSIFIED_KIND)
            assert.equal(rejectKindOf('guard', 'toString'), UNCLASSIFIED_KIND, '原型鏈上之名不是碼')
            assert.equal(rejectKindOf('doubted', 'same-doc'), 'same-doc')
            assert.equal(rejectKindOf('acceptDropped', 'same-doc'), 'same-doc', '碼只在組內唯一:同名可出現於不同組')
            assert.throws(() => rejectKindOf('nope', 'x'), (e) => /^rejectKindOf 之分組不認得（可用：opsRejected、/.test(e.message) && !e.message.includes('nope'), '訊息列可用分組、不回顯輸入值')
        })

        it('rejectTag／REJECT_TAG_RE:標記可被正則取回;不與條目編號之標記〔C1〕相混', () => {
            assert.equal(rejectTag('essence-too-long'), '〔essence-too-long〕')
            const line = `提煉拒收[黑洞]：${rejectTag('item-not-found')}目標 〔C1〕 不存在×1、${rejectTag('missing-field')}缺 text×2`
            assert.deepEqual([...line.matchAll(REJECT_TAG_RE)].map((m) => m[1]), ['item-not-found', 'missing-field'])
            assert.deepEqual([...'提煉不變式剔除[x]：supersede〔C1〕〔D2〕'.matchAll(REJECT_TAG_RE)], [])
        })

        it('rejectStatKey／rejectStatSplit 互逆;未登記之碼歸 unclassified;非此形之鍵回 null', () => {
            assert.equal(rejectStatKey('opsRejected', 'essence-too-long'), 'opsRejectedBy:essence-too-long')
            assert.equal(rejectStatKey('opsRejected', 'bogus'), 'opsRejectedBy:unclassified')
            assert.deepEqual(rejectStatSplit('guardBy:target-not-in-prompt'), ['guardBy', 'target-not-in-prompt'])
            assert.equal(rejectStatSplit('opsApplied'), null)
            assert.equal(rejectStatSplit('notBy:x'), null)
            assert.equal(rejectStatSplit(42), null)
            for (const g of Object.keys(REJECT_KINDS)) for (const c of Object.keys(REJECT_KINDS[g])) assert.deepEqual(rejectStatSplit(rejectStatKey(g, c)), [REJECT_GROUPS[g].by, c])
        })

        it('passKindStats:pass 結果 → 扁平統計鍵(opsRejected 取 rejected、guard／reviseBlocked／integrateRejected 取 stats 之 By);各組之和等於該組之總數;零不列;缺者視同無', () => {
            const r = { rejected: [{ kind: 'item-not-found' }, { kind: 'item-not-found' }, { kind: 'bogus' }], stats: { guardRejected: 1, guardBy: { 'target-not-in-prompt': 1 }, patch: { blocked: 2 }, reviseBlockedBy: { 'severity-too-low': 2, 'op-not-found': 0 }, integrateRejected: 3, integrateRejectedBy: { 'text-diverged': 2, 'via-missing': 1 } } }
            const got = passKindStats(r)
            assert.deepEqual(got, {
                'opsRejectedBy:item-not-found': 2,
                'opsRejectedBy:unclassified': 1,
                'guardBy:target-not-in-prompt': 1,
                'reviseBlockedBy:severity-too-low': 2,
                'integrateRejected': 3,
                'integrateRejectedBy:text-diverged': 2,
                'integrateRejectedBy:via-missing': 1,
            })
            const total = (by) => Object.entries(got).filter(([k]) => rejectStatSplit(k)?.[0] === by).reduce((a, [, n]) => a + n, 0)
            assert.deepEqual([total('opsRejectedBy'), total('guardBy'), total('reviseBlockedBy'), total('integrateRejectedBy')], [r.rejected.length, r.stats.guardRejected, r.stats.patch.blocked, r.stats.integrateRejected])
            assert.deepEqual([passKindStats({}), passKindStats(undefined), passKindStats({ rejected: [], stats: {} })], [{}, {}, {}])
        })

        it('kindTally:各鍵之和等於項數;缺 kind 者歸 unclassified;非陣列視同無項', () => {
            assert.deepEqual(kindTally('guard', [{ kind: 'target-not-in-prompt' }, { kind: 'target-not-in-prompt' }, {}, { kind: 'x' }]), { 'target-not-in-prompt': 2, 'unclassified': 2 })
            assert.deepEqual(kindTally('guard', undefined), {})
            assert.deepEqual(kindTally('guard', []), {})
        })
    })
})
