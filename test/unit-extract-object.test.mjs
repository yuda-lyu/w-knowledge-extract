// unit-extract-object.test.mjs — 提煉物件(extractObject):子階段與動作鏈之掛載、階段契約、子階段序列與隔離、平鋪 opts 之分派、固定格式摘要
// 規格:①EXTRACT_STAGE_KEYS＝子階段與物件 report 之鍵(extract);EXTRACT_TAP_STAGE_KEYS＝有動作鏈之鍵(由行為推導:對不存在之錨點於建立物件時
//   即拋「無錨點」,並列出五個錨點 loadState／selectNotes／pass／renderState／persistState)
//   ②物件＝子階段序列,工廠零參數即可用;名「提煉」、預設 onError:'continue'(提煉失敗不阻斷同一管線之後段);階段契約欄位可覆寫,未給者不出現
//   ③子階段失敗預設隔離(記於 report、續跑後續子階段、留 WARN),宣告 onError:'abort' 才中止整個物件
//   ④平鋪 opts 只給 extract 子階段(與 opt.extract 合併,opt.extract 優先;tap 以 mergeTaps 合併——同錨點雙方皆 replace 即拋)
//   ⑤固定格式摘要(extractSummaryOf)為對外契約:第一段「概念 N、更新 N 則核心、消化 N 篇」與句尾「（AI N 次）」恆在,其餘段 >0 才附、依序;
//     有子階段失敗時一律改走通用摘要並列出失敗者;部分失敗(stats.fail>0)句尾附「｜失敗 N」
// 執行:自套件根 node <mocha> test/unit-extract-object.test.mjs(暫存 test/_tmp/extract-obj-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕;AI 為 3+3 替身)

import assert from 'node:assert/strict'
import { defineMw, stdReport } from '../src/core/capturePackage.mjs'
import { createExtractObject, extractSummaryOf, EXTRACT_STAGE_KEYS, EXTRACT_TAP_STAGE_KEYS } from '../src/extractObject.mjs'
import { recLog, clock, mkEnvIn, scriptAi, draftAll } from './tools/extractKit.mjs'
import { msgOf } from './tools/captureForTest.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'

let TMP = ''
/** 知識庫環境之建構器(暫存根於 before 建立後才實例化) */
let mkEnv = null

/**
 * 物件之執行脈絡(提煉段之依賴;剩餘時間一小時、未逾期)
 *
 * @param {Object} env 輸入 mkEnvIn 之環境
 * @param {Object} ai 輸入 AI 替身
 * @returns {Object} 回傳 ctx(含記錄型 log)
 */
const ctxOf = (env, ai) => ({ deps: { ...env, clock, ai }, log: recLog(), remainingMs: () => 3_600_000, expired: () => false })

/** 兩篇同概念之筆記(新核心門檻 2 篇) */
const TWO = [{ id: 'n1', concepts: ['甲概念'] }, { id: 'n2', concepts: ['甲概念'] }]

describe('unit-extract-object', function() {

    this.timeout(60_000)

    before(() => {
        TMP = tmpRoot('extract-obj')
        mkEnv = mkEnvIn(TMP)
    })
    after(() => removeRoots([TMP]))

    it('EXTRACT_STAGE_KEYS／EXTRACT_TAP_STAGE_KEYS 皆為 [extract] 且凍結', () => {
        assert.deepEqual([...EXTRACT_STAGE_KEYS], ['extract'])
        assert.deepEqual([...EXTRACT_TAP_STAGE_KEYS], ['extract'])
        assert.ok(Object.isFrozen(EXTRACT_STAGE_KEYS) && Object.isFrozen(EXTRACT_TAP_STAGE_KEYS))
    })

    it('EXTRACT_TAP_STAGE_KEYS＝實際有動作鏈之鍵(由行為推導,不手列):各鍵之 tap 對不存在之錨點,建立物件時即拋「無錨點」並列出五個錨點;平鋪之 tap 亦於建構期驗', () => {
        const tapped = EXTRACT_STAGE_KEYS.filter((k) => /無錨點「__noSuchAnchor」/.test(msgOf(() => createExtractObject({ [k]: { tap: { __noSuchAnchor: { after: [] } } } }))))
        assert.deepEqual(tapped, [...EXTRACT_TAP_STAGE_KEYS])
        assert.match(msgOf(() => createExtractObject({ extract: { tap: { __x: { after: [] } } } })), /鏈\[extract\.extract\] 無錨點「__x」\(可用:loadState\/selectNotes\/pass\/renderState\/persistState\)/)
        assert.match(msgOf(() => createExtractObject({ tap: { __y: { after: [] } } })), /鏈\[extract\.extract\] 無錨點「__y」/, '平鋪之 tap 亦於建構期驗')
        assert.doesNotThrow(() => createExtractObject({ stages: [], tap: { __z: { after: [] } } }), 'opt.stages 整組置換:內建子階段不建,其 tap 不讀')
    })

    // ══════════════════════════ 工廠契約 ══════════════════════════
    describe('createExtractObject 工廠契約', function() {

        it('零參數即符合階段契約(name＋run),名「提煉」、失敗預設隔離(onError:continue)——提煉失敗不阻斷同一管線之後段', () => {
            const o = createExtractObject()
            assert.deepEqual([o.name, o.onError, typeof o.run], ['提煉', 'continue', 'function'])
        })

        it('opt 非物件(null/字串/數字/陣列)→ 視為{},回傳零參數之預設階段物件(不拋錯);階段契約欄位可覆寫(name/onError/when/timeoutMs/always),未給者不出現', () => {
            for (const bogus of [null, 'bogus', 42, [1, 2]]) {
                const o = createExtractObject(bogus)
                assert.deepEqual([o.name, o.onError], ['提煉', 'continue'], JSON.stringify(bogus))
            }
            const o = createExtractObject({ name: 'extract2', onError: 'abort', timeoutMs: 5000, when: () => false, always: true })
            assert.deepEqual([o.name, o.onError, o.timeoutMs, typeof o.when, o.always], ['extract2', 'abort', 5000, 'function', true])
            const bare = createExtractObject()
            assert.deepEqual(['when', 'timeoutMs', 'always'].map((k) => k in bare), [false, false, false])
        })
    })

    // ══════════════════════════ 子階段序列與隔離 ══════════════════════════
    describe('子階段序列與隔離', function() {

        it('自寫子階段宣告 onError:abort → 物件外拋(可被管線隔離)', async () => {
            const obj = createExtractObject({ stages: [{ name: 'hard', onError: 'abort', run: async () => {
                throw new Error('硬炸')
            } }] })
            await assert.rejects(() => obj.run({ deps: {}, log: recLog() }), /硬炸/)
        })

        it('stages 整組換成自寫單元:單一子階段失敗被隔離、後續照跑、留 WARN;物件 report.ok 為 false;摘要走通用格式並列出失敗者', async () => {
            const trace = []
            const log = recLog()
            const obj = createExtractObject({
                stages: [
                    { name: 'o1', run: async () => {
                        trace.push('o1')
                        return stdReport({ stats: { in: 1, out: 1 } })
                    } },
                    { name: 'boom', run: async () => {
                        throw new Error('炸')
                    } },
                    { name: 'o2', run: async () => {
                        trace.push('o2')
                        return stdReport({ stats: { in: 2, out: 2 } })
                    } },
                ],
            })
            const r = await obj.run({ deps: {}, log })
            assert.deepEqual(trace, ['o1', 'o2'], 'boom 失敗後 o2 仍執行')
            assert.ok(log.lines.includes('WARN 子階段[boom] 失敗（續跑後續子階段）：炸'), log.lines.join('\n'))
            assert.deepEqual([r.ok, r.stats.in, r.stats.fail, Object.keys(r.detail)], [false, 3, 1, ['o1', 'boom', 'o2']])
            assert.equal(r.summary, '2/3 段完成（in 3、out 3、fail 1）｜失敗：boom')
        })

        it('預設子階段只有 extract:兩篇同概念之筆記 → 一則新核心;物件 report 之 detail 鍵即 EXTRACT_STAGE_KEYS;摘要為固定格式', async () => {
            const env = mkEnv(TWO)
            const r = await createExtractObject().run(ctxOf(env, scriptAi({ draft: draftAll })))
            assert.deepEqual(Object.keys(r.detail), [...EXTRACT_STAGE_KEYS])
            assert.equal(r.ok, true, JSON.stringify(r.detail.extract.detail))
            assert.equal(r.summary, '概念 1、更新 1 則核心、消化 2 篇（AI 6 次）')
            assert.equal((await env.stores.cores.select()).length, 1)
        })

        it('子階段收 enabled:false 與 when(ctx)(工廠以抓取套件之 stageFields 組契約欄位,runSubStages 據以略過):停用者 report 為 { disabled:true }、不執行(不呼叫 AI);when 不合者不入 report', async () => {
            // 規則:抓取套件 captureObject.runSubStages 與 core/kernel.stageFields——cfg.stageOpts.<子階段>.enabled:false 對四套件之子階段一體適用
            const env = mkEnv(TWO)
            const never = scriptAi({ draft: async () => assert.fail('停用之子階段不得呼叫 AI') })
            const off = await createExtractObject({ extract: { enabled: false } }).run(ctxOf(env, never))
            assert.deepEqual([Object.keys(off.detail), off.detail.extract.detail, off.ok], [['extract'], { disabled: true }, true])
            assert.equal((await env.stores.cores.select()).length, 0)
            const w = await createExtractObject({ extract: { when: () => false } }).run(ctxOf(env, never))
            assert.deepEqual(Object.keys(w.detail), [], 'when 不合者不入 report')
        })

        it('平鋪 opts 只給 extract 子階段且與 opt.extract 合併(opt.extract 優先):平鋪之 parallel 0 停用提煉;opt.extract 之 parallel 蓋過平鋪者', async () => {
            const env = mkEnv(TWO)
            const off = await createExtractObject({ parallel: 0 }).run(ctxOf(env, scriptAi({ draft: draftAll })))
            assert.equal(off.detail.extract.detail.disabled, true, '平鋪之 opts 送達 extract 子階段')
            const on = await createExtractObject({ parallel: 0, extract: { parallel: 2 } }).run(ctxOf(env, scriptAi({ draft: draftAll })))
            assert.equal(on.detail.extract.detail.updated, 1, 'opt.extract 優先')
        })

        it('平鋪 tap 與 opt.extract.tap 合併而非覆蓋:同錨點之 before／after 皆生效(每個目標各經一次);同錨點雙方皆 replace 即拋', async () => {
            const seen = []
            const mw = (name) => defineMw({ name, handle: async (m, c, n) => {
                seen.push(name)
                return n(m)
            } })
            const env = mkEnv(TWO)
            await createExtractObject({
                tap: { persistState: { before: [mw('flat-before')] } }, // 平鋪
                extract: { tap: { persistState: { after: [mw('sub-after')] } } }, // 子階段之 tap
            }).run(ctxOf(env, scriptAi({ draft: draftAll })))
            assert.deepEqual(seen, ['flat-before', 'sub-after'], '一個目標經落盤一次:平鋪之 before 與子階段之 after 皆生效')
            assert.throws(() => createExtractObject({ tap: { pass: { replace: mw('x') } }, extract: { tap: { pass: { replace: mw('y') } } } }), /extract\.extract 錨點\[pass\] 之 replace 衝突/)
        })
    })

    // ══════════════════════════ 固定格式摘要 ══════════════════════════
    describe('固定格式摘要(extractSummaryOf)與通用摘要', function() {

        const r = (detail, stats = {}) => ({ ok: true, stats: { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0, ...stats }, detail })
        const BASE = { concepts: 2, updated: 1, notesUsed: 5, notesSkipped: 1 }

        it('缺 extract 之 detail(或 reports 非物件)→ 回空字串,由通用摘要接手', () => {
            for (const bad of [undefined, null, 'x', 5, {}, { other: { detail: { updated: 1 } } }, { extract: { stats: {} } }]) assert.equal(extractSummaryOf(bad), '', JSON.stringify(bad))
        })

        it('第一段「概念 N、更新 N 則核心、消化 N 篇」與句尾「（AI N 次）」恆在(消化＝引用＋略過);缺 stats 時 AI 計 0', () => {
            assert.equal(extractSummaryOf({ extract: r({ ...BASE }, { aiCalls: 7 }) }), '概念 2、更新 1 則核心、消化 6 篇（AI 7 次）')
            assert.equal(extractSummaryOf({ extract: { detail: { concepts: 0, updated: 0 } } }), '概念 0、更新 0 則核心、消化 0 篇（AI 0 次）')
        })

        it('各附加段只在其計數 >0 時附上,依序插於第一段與句尾之間(全開之全文逐字)', () => {
            const head = '概念 2、更新 1 則核心、消化 6 篇'
            const cases = [
                [{ notesRechecked: 2 }, '、重審 2 篇'],
                [{ withdrawn: 1 }, '、撤出處 1 篇'],
                [{ restored: 3 }, '、恢復 3 篇'],
                [{ disputeChecked: 4, disputeOpposed: 1, disputeDissolved: 1, disputeHeld: 1, disputeRetry: 1 }, '、爭議覆核 4 則（真對立 1、拆解 1、待判 1、重試 1）'],
                [{ supportChecked: 5, supportRejected: 2, supportUndetermined: 1, supportRevised: 1 }, '、出處支持覆核 5 項（不採 2、判不了 1、修訂後採用 1）'],
                [{ stockChecked: 6, stockSupported: 2, stockRevised: 1, stockRetracted: 1, stockHeld: 1, stockRetry: 1 }, '、存量覆核 6 條（受支持 2、修訂 1、撤回 1、隔離 1、重試 1）'],
                [{ orphanChecked: 4, orphanResourced: 1, orphanRetracted: 1, orphanHeld: 1, orphanRetry: 1 }, '、失撐找支持 4 條（補出處 1、撤回 1、判不了 1、重試 1）'],
                [{ impactEvents: 2, impactCandidates: 1, impactRecheck: 1 }, '、關聯影響 2 則（夥伴候選 +1、關聯重審 1、夥伴入批 0 篇／被引 0）'],
                [{ partnersCovered: 2, partnersUsed: 1 }, '、關聯影響 0 則（夥伴候選 +0、關聯重審 0、夥伴入批 2 篇／被引 1）'],
                [{ synonymChecked: 3, synonymSame: 1, synonymDifferent: 1, synonymHeld: 1 }, '、同義核對 3 對（同一概念 1、不同 1、判不了 1、重試 0）'],
                [{ synonymResolved: 2 }, '、同義核對 0 對（同一概念 0、不同 0、判不了 0、重試 0、待判結案 2）'],
                [{ degraded: 1 }, '、降級 1'],
                [{ stopped: 2 }, '、截止 2'],
                [{ overLimit: 3, lengthChecked: 40 }, '、超長 3／40 欄'],
                [{ overLimit: 3 }, '、超長 3／3 欄'],
                [{ absoluteTone: 2 }, '、絕對語氣 2 條'],
            ]
            for (const [d, seg] of cases) assert.equal(extractSummaryOf({ extract: r({ ...BASE, ...d }, { aiCalls: 7 }) }), `${head}${seg}（AI 7 次）`, JSON.stringify(d))
            // 計數為 0 之段不附(受檢為 0 者整段不附,其餘計數不論)
            for (const d of [{ disputeChecked: 0, disputeOpposed: 3 }, { supportChecked: 0, supportRejected: 1 }, { stockChecked: 0, stockSupported: 1 }, { orphanChecked: 0, orphanResourced: 1 }, { impactEvents: 0, impactCandidates: 2 }]) {
                assert.equal(extractSummaryOf({ extract: r({ ...BASE, ...d }, { aiCalls: 7 }) }), `${head}（AI 7 次）`, JSON.stringify(d))
            }
            // 全開之全文與段序
            const all = Object.assign({}, BASE, ...cases.filter(([d]) => !('overLimit' in d && !('lengthChecked' in d))).map(([d]) => d))
            assert.equal(extractSummaryOf({ extract: r(all, { aiCalls: 7 }) }), `${head}、重審 2 篇、撤出處 1 篇、恢復 3 篇、爭議覆核 4 則（真對立 1、拆解 1、待判 1、重試 1）、出處支持覆核 5 項（不採 2、判不了 1、修訂後採用 1）、存量覆核 6 條（受支持 2、修訂 1、撤回 1、隔離 1、重試 1）、失撐找支持 4 條（補出處 1、撤回 1、判不了 1、重試 1）、關聯影響 2 則（夥伴候選 +1、關聯重審 1、夥伴入批 2 篇／被引 1）、同義核對 3 對（同一概念 1、不同 1、判不了 1、重試 0、待判結案 2）、降級 1、截止 2、超長 3／40 欄、絕對語氣 2 條（AI 7 次）`)
        })

        it('外部巡檢之正則退路依「更新 N 則核心」解析:全開之摘要仍只有一處該片語,且位於第一段', () => {
            const s = extractSummaryOf({ extract: r({ ...BASE, notesRechecked: 2, disputeChecked: 1, stockChecked: 1, orphanChecked: 1, synonymChecked: 1, degraded: 1 }, { aiCalls: 3 }) })
            assert.equal(s.match(/更新 \d+ 則核心/g).length, 1)
            assert.ok(s.startsWith('概念 2、更新 1 則核心、'))
        })

        it('物件摘要:全數成功用固定格式,部分失敗(stats.fail>0)句尾附「｜失敗 N」;有子階段失敗者一律通用摘要並列出失敗者,不印 undefined', async () => {
            const run = async (stages) => (await createExtractObject({ stages }).run({ deps: {}, log: recLog() })).summary
            const ext = { name: 'extract', run: async () => stdReport({ stats: { aiCalls: 4, fail: 2 }, detail: { concepts: 1, updated: 1, notesUsed: 3 } }) }
            assert.equal(await run([ext]), '概念 1、更新 1 則核心、消化 3 篇（AI 4 次）｜失敗 2')
            const bad = await run([ext, { name: 'other', run: async () => stdReport({ ok: false, stats: { fail: 1 } }) }])
            assert.equal(bad, '1/2 段完成（in 0、out 0、fail 3）｜失敗：other')
            assert.doesNotMatch(bad, /undefined/)
            assert.equal(await run([{ name: 'other', run: async () => stdReport({}) }]), '1/1 段完成（in 0、out 0、fail 0）', '無 extract 子階段 → 通用摘要')
        })
    })
})
