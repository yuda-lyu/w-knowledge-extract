// unit-objects.test.mjs — 四物件/子階段/插件展開之契約回歸測試
// 執行:npx mocha test/unit-objects.test.mjs(暫存落 test/_tmp/objects-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createFetchObject, createOrganizeObject, createRelateObject, createDistillObject } from '../src/core/objects.mjs'
import { createKnowledgeExtract } from '../src/core/createKnowledgeExtract.mjs'
import { resolvePlugins, mergeTaps } from '../src/core/plugins.mjs'
import { defineMw, MwContractError } from '../src/core/kernel.mjs'
import { resolveSettings } from '../src/core/settingsDefault.mjs'
import { stageDetailFetch } from '../src/stages/detailFetchStage.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { createClock } from '../src/util/clock.mjs'
import { setConceptFold, normalizeConcept } from '../src/util/text.mjs'
import { memStore } from './tools/memStore.mjs'
import { nullLogger } from './tools/nullLogger.mjs'

// 暫存路徑 cwd 相對(自套件根執行):測試專用,after 清除(原寫在 ./tmp 且從未清除,留下 smoke-x/kf-objects 殘檔)
const TMP = path.resolve(`test/_tmp/objects-${process.pid}`).replace(/\\/g, '/')
const TMP_X = `${TMP}/x`
const TMP_O = `${TMP}/o`
// 總組裝測試用之 AI 調度層替身(不讀 .env;真 adapter 於啟動期檢核席位,測試環境無金鑰會拋)
const stubAi = {
    callJson: async () => ({ ok: false, data: null, error: 'stub', skipped: false, attempts: 0, preview: '' }),
    getWkf: () => ({}),
    withBudget: (s) => s,
    recordCall: () => {},
    drainStats: () => '無呼叫',
    aiUsageToday: () => ({ today: '', used: 0, byKey: {}, chain: '', providers: [], skipped: [] }),
}

describe('unit-objects', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        setConceptFold(null) // createKnowledgeExtract 會注入模組級 opencc 折疊,不留給同 worker 之他檔
    })

    // ── 工廠契約 ──
    it('四物件零參數即符合階段契約(name＋run),失敗預設隔離(onError:continue)', () => {
        const objs = [createFetchObject(), createOrganizeObject(), createRelateObject(), createDistillObject()]
        for (const o of objs) {
            assert.equal(typeof o.name, 'string')
            assert.equal(typeof o.run, 'function')
            assert.equal(o.onError, 'continue', '預設不阻斷後段——抓取失敗時既有筆記仍應被整理')
        }
        assert.deepEqual(objs.map((o) => o.name), ['抓取', '彙整', '關聯', '提煉'])
    })

    it('階段契約欄位可覆寫(name/onError/when/timeoutMs)', () => {
        const o = createRelateObject({ name: 'relate2', onError: 'abort', timeoutMs: 5000, when: () => false })
        assert.equal(o.name, 'relate2')
        assert.equal(o.onError, 'abort')
        assert.equal(o.timeoutMs, 5000)
        assert.equal(typeof o.when, 'function')
    })

    // ── 第 3 層:stages 重組 ──
    it('物件 stages 可整組換成自寫單元;通用摘要;單一子階段失敗被隔離', async () => {
        const trace = []
        const warns = []
        const obj = createFetchObject({
            stages: [
                {
                    name: 'o1',
                    run: async () => {
                        trace.push('o1'); return { ok: true, stats: { in: 1, out: 1 } }
                    }
                },
                {
                    name: 'boom',
                    run: async () => {
                        throw new Error('炸')
                    }
                },
                {
                    name: 'o2',
                    run: async () => {
                        trace.push('o2'); return { ok: true, stats: { in: 2, out: 2 } }
                    }
                },
            ],
        })
        const r = await obj.run({ deps: {}, log: { ...nullLogger(), warn: (m) => warns.push(m) } })
        assert.deepEqual(trace, ['o1', 'o2'], 'boom 失敗後 o2 仍執行')
        assert.ok(warns.some((m) => /boom/.test(m)), '失敗須留痕')
        assert.match(r.summary, /2\/3 段完成/)
        assert.equal(r.stats.in, 3)
        assert.equal(r.stats.fail, 1)
    })

    it('自寫子階段宣告 onError:abort → 物件外拋(可被 pipeline 隔離)', async () => {
        const obj = createOrganizeObject({
            stages: [{
                name: 'hard',
                onError: 'abort',
                run: async () => {
                    throw new Error('硬炸')
                }
            }],
        })
        await assert.rejects(() => obj.run({ deps: {}, log: nullLogger() }), /硬炸/)
    })

    // ── 第 4 層:子階段 tap 定義期驗證 ──
    it('子階段 tap 錨點不存在 → 定義期拋錯(不是跑到一半才發現掛空)', () => {
        assert.throws(() => stageDetailFetch({ tap: { nope: { replace: defineMw({ name: 'x', handle: (m, c, n) => n(m) }) } } }), MwContractError)
    })

    it('子階段 chain 可整鏈重排(自寫 mw 單元)', () => {
        const st = stageDetailFetch({ chain: [defineMw({ name: 'only', handle: (m, c, n) => n(m) })] })
        assert.equal(st.name, 'detailFetch')
        assert.equal(typeof st.run, 'function')
    })

    // ── 第 6 層:插件展開 ──
    it('插件展開:hook 全名 → 各子階段 taps;enforce pre 先套用', () => {
        const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
        const b = defineMw({ name: 'b', handle: (m, c, n) => n(m) })
        const taps = resolvePlugins([
            { 'name': 'p2', 'fetch.detailFetch.fetchDetail': { after: [b] } },
            { 'name': 'p1', 'enforce': 'pre', 'fetch.detailFetch.fetchDetail': { after: [a] }, 'organize.extract.persistNote': { replace: a } },
        ])
        assert.deepEqual(taps['fetch.detailFetch'].fetchDetail.after, [a, b], 'pre 插件的掛載排前')
        assert.equal(taps['organize.extract'].persistNote.replace, a)
    })

    it('插件:hook 名不合格式/兩顆插件搶 replace → 定義期拋錯', () => {
        const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
        assert.throws(() => resolvePlugins([{ 'name': 'p', 'bad-hook': { after: [a] } }]), /不合格式/)
        assert.throws(() => resolvePlugins([
            { 'name': 'p1', 'fetch.detailFetch.fetchDetail': { replace: a } },
            { 'name': 'p2', 'fetch.detailFetch.fetchDetail': { replace: a } },
        ]), /replace/)
    })

    it('mergeTaps:tap 與插件同錨點 replace 衝突拋錯;before/after 串接', () => {
        const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
        const b = defineMw({ name: 'b', handle: (m, c, n) => n(m) })
        const merged = mergeTaps({ x: { before: [a] } }, { x: { before: [b], after: [b] } })
        assert.deepEqual(merged.x.before, [a, b])
        assert.throws(() => mergeTaps({ x: { replace: a } }, { x: { replace: b } }), /衝突/)
    })

    // ── 平鋪 opts 與 opt.<子階段>（插件展開之形狀）並存 ──
    it('彙整物件:平鋪 callAI 與 extract.tap 同時生效;逐項鏈內 ctx.emit 可用', async () => {
        let called = 0
        let replaced = 0
        let emitType = ''
        const item = { index: 1, relevant: true, title: 'T', key_points: ['k'], concepts: ['c'], summary: 's', category: '方法與技術' }
        const obj = createOrganizeObject({
            callAI: async () => {
                called++; return { ok: true, data: [item], error: '', skipped: false, attempts: 1, preview: '' }
            }, // 平鋪
            extract: {
                tap: {
                    persistNote: {
                        replace: defineMw({
                            name: 'persistNote',
                            handle: async (m, c, n) => {
                                replaced++; emitType = typeof c.emit; return n(m)
                            }
                        })
                    }
                }
            }, // 插件展開後的形狀
        })
        const deps = {
            stores: { docs: memStore([{ id: 'd1', status: 'raw', title: 'doc', text: 'x'.repeat(50), url: 'https://e.com/a', sourceName: 's', sourceTier: 1, collectedAt: '2026-01-01' }]), notes: memStore(), frontier: memStore() },
            settings: resolveSettings({}),
            ai: null,
            clock: createClock('Asia/Taipei'),
            dirs: { notes: TMP_O },
            domains: { extract: createExtractDomain({}) },
        }
        await obj.run({ deps, log: nullLogger(), expired: () => false })
        assert.equal(called, 2, '平鋪的 callAI 須被使用（曾在有 opt.extract 時靜默失效）：預篩 1 次（放行）＋萃取 1 次')
        assert.equal(replaced, 1, 'opt.extract.tap 的 replace 須被使用')
        assert.equal(emitType, 'function', '逐項鏈內須提供 ctx.emit（README 契約）')
        assert.equal((await deps.stores.docs.get('d1')).status, 'noted')
    })

    // ── 總組裝契約 ──
    it('createKnowledgeExtract:缺 workDir 拋錯;自組 pipeline＋plugins 並用拋錯;skipTitlePatterns 形狀錯拋錯', () => {
        assert.throws(() => createKnowledgeExtract({}), /workDir/)
        assert.throws(() => createKnowledgeExtract({
            workDir: TMP_X,
            aiAdapter: stubAi,
            pipeline: [{ name: 'x', run: () => {} }],
            plugins: [{ 'name': 'p', 'fetch.listFetch.fetchList': {} }],
        }), /插件僅作用於預設 pipeline/)
        // 真 adapter 於啟動期檢核全部席位:缺金鑰之席位要在此拋,不是跑到第一次呼叫(2026-09-12)
        assert.throws(() => createKnowledgeExtract({ workDir: TMP_X, afterRun: false, envFile: `${TMP_X}/none.env` }),
            /AI 名額於啟動期檢核失敗.*缺金鑰/)
        assert.throws(() => createKnowledgeExtract({
            workDir: TMP_X,
            data: { skipTitlePatterns: [/^Weekly/i, { pattern: 'x' }] }, // 第 2 項形狀錯：舊實作編成空樣式而攔下全部標題
        }), /skipTitlePatterns\[1\]/)
    })

    it('createKnowledgeExtract:整輪軟性截止由排程上限推導(單一來源);明給 deadlineMs 優先;皆無時退預設 50 分', () => {
        const base = { workDir: TMP_O, afterRun: false, aiAdapter: stubAi }
        assert.equal(createKnowledgeExtract({ ...base, monitor: { scheduleLimitMin: 55 } }).info().deadlineMs, 2940_000, '55 分 − 6 分邊際(邊際涵蓋提煉末席位一次逾時 360s)')
        assert.equal(createKnowledgeExtract({ ...base, monitor: { scheduleLimitMin: 8 } }).info().deadlineMs, 600_000, '下限 10 分')
        assert.equal(createKnowledgeExtract({ ...base, monitor: { scheduleLimitMin: 55 }, deadlineMs: 1234 }).info().deadlineMs, 1234, '明給者優先')
        assert.equal(createKnowledgeExtract(base).info().deadlineMs, 3000_000)
        // 執行鎖陳舊期限同源推導:須大於排程上限(正常但偏慢的執行不可被下一實例判為殘留)
        assert.equal(createKnowledgeExtract({ ...base, monitor: { scheduleLimitMin: 55 } }).info().lockStaleMs, 3600_000, '55 分＋5 分')
        assert.equal(createKnowledgeExtract({ ...base, lockStaleMs: 99 }).info().lockStaleMs, 99)
    })

    // ── 2026-09-23 修正之回歸 ──
    it('插件:enforce 值非法/掛載鍵打錯字/掛載規格非物件/plugins 非陣列 → 定義期拋錯(此前整顆插件或該掛載被靜默丟棄)', () => {
        const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
        assert.throws(() => resolvePlugins([{ 'name': 'p', 'enforce': 'PRE', 'fetch.detailFetch.fetchDetail': { after: [a] } }]), /enforce 只能是 pre／post/, '舊實作:enforce 非 pre/post/空 者不在排序三帶內,整顆插件消失')
        assert.throws(() => resolvePlugins([{ 'name': 'p', 'fetch.detailFetch.fetchDetail': { afer: [a] } }]), /不認得的掛載鍵「afer」/, '舊實作:未知鍵被略過成空 tap,註冊了卻沒反應')
        assert.throws(() => resolvePlugins([{ 'name': 'p', 'fetch.detailFetch.fetchDetail': [a] }]), /掛載規格須為物件/)
        assert.throws(() => resolvePlugins({ name: 'p' }), /plugins 須為陣列/)
        assert.throws(() => resolvePlugins([null]), /插件\[0\] 須為物件/)
        assert.deepEqual(Object.keys(resolvePlugins([{ 'name': 'p', 'enforce': 'post', 'organize.triage.settleTriage': { after: [a] } }])), ['organize.triage'])
    })

    it('createKnowledgeExtract:插件可掛 organize.triage(預篩);hook 前綴不存在者組裝期拋錯(此前 organize.triage 與未知前綴皆被靜默丟棄)', () => {
        const base = { workDir: TMP_O, afterRun: false, aiAdapter: stubAi }
        const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
        assert.doesNotThrow(() => createKnowledgeExtract({ ...base, plugins: [{ 'name': 'p', 'organize.triage.settleTriage': { after: [a] } }] }))
        // 錨點不存在於預篩鏈 → 由預篩子階段之 applyTaps 拋錯:證明 organize.triage 之掛載確實送達預篩子階段
        assert.throws(() => createKnowledgeExtract({ ...base, plugins: [{ 'name': 'p', 'organize.triage.nope': { after: [a] } }] }), /organize\.triage.*無錨點「nope」/)
        assert.throws(() => createKnowledgeExtract({ ...base, plugins: [{ 'name': 'p', 'organize.extrct.persistNote': { after: [a] } }] }), /插件 hook 前綴不存在：organize\.extrct/)
    })

    it('彙整物件:平鋪之萃取專屬 opts(tap/domain/docsPerBatch)不灌進預篩;預篩只吃 opt.triage＋通用鍵(callAI/parallel/statuses)', async () => {
        const noopPersist = { persistNote: { replace: defineMw({ name: 'persistNote', handle: async (m, c, n) => n(m) }) } }
        assert.doesNotThrow(() => createOrganizeObject({ tap: noopPersist }), '平鋪 tap(萃取錨點)不得讓預篩鏈於組裝期拋「無錨點」')
        const seenPrompts = []
        const item = { index: 1, relevant: true, title: 'T', key_points: ['k'], concepts: ['c'], summary: 's', category: '方法與技術' }
        const obj = createOrganizeObject({
            domain: { ...createExtractDomain({}), buildPrompt: async () => 'EXTRACT-PROMPT' }, // 平鋪:萃取專屬
            docsPerBatch: 1, // 平鋪:萃取專屬(預篩應沿用自身之 docsPerTriage)
            callAI: async (p) => {
                seenPrompts.push(p === 'EXTRACT-PROMPT' ? 'extract' : (p.startsWith('你是知識庫的預篩器') ? 'triage' : 'other'))
                const data = p === 'EXTRACT-PROMPT' ? [item] : [{ index: 1, relevant: true }, { index: 2, relevant: true }]
                return { ok: true, data, error: '', skipped: false, attempts: 1, preview: '' }
            },
        })
        const mkDoc = (id, at) => ({ id, status: 'raw', title: id, text: 'x'.repeat(50), url: `https://e.com/${id}`, sourceName: 's', sourceTier: 1, collectedAt: at })
        const deps = {
            stores: { docs: memStore([mkDoc('d1', '2026-01-01'), mkDoc('d2', '2026-01-02')]), notes: memStore(), frontier: memStore() },
            settings: resolveSettings({}),
            ai: null,
            clock: createClock('Asia/Taipei'),
            dirs: { notes: TMP_O },
            domains: { extract: createExtractDomain({}) },
        }
        await obj.run({ deps, log: nullLogger(), expired: () => false })
        assert.equal(seenPrompts.filter((x) => x === 'triage').length, 1, '預篩用自身 domain 之 prompt、且一次看完 2 篇(未被平鋪 docsPerBatch:1 改成每批 1 篇)')
        assert.ok(!seenPrompts.includes('other'), '預篩不得改用平鋪之萃取 domain')
        assert.ok(seenPrompts.includes('extract'), '萃取仍吃平鋪之 domain')
        assert.equal((await deps.stores.docs.get('d1')).triage, 'relevant')
    })

    it('createKnowledgeExtract:conceptFold:true 即啟用內建繁簡折疊(此前 true 被當成非函數而清除折疊);false 停用', () => {
        const base = { workDir: TMP_O, afterRun: false, aiAdapter: stubAi }
        createKnowledgeExtract({ ...base, conceptFold: true })
        assert.equal(normalizeConcept('过拟合'), normalizeConcept('過擬合'), 'true＝開啟')
        createKnowledgeExtract({ ...base, conceptFold: false })
        assert.notEqual(normalizeConcept('过拟合'), normalizeConcept('過擬合'), 'false＝停用(模組級單例:以最後一個建構者為準)')
        createKnowledgeExtract({ ...base, conceptFold: (s) => s.replace(/拟/g, '擬').replace(/过/g, '過') })
        assert.equal(normalizeConcept('过拟合'), '過擬合', '函數＝自訂折疊')
    })

})
