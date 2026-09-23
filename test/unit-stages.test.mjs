// unit-stages.test.mjs — 階段機制的回歸測試：slug 容錯、衝突雙寫、角色鏈接線、降級保底、md 往返
// 執行：npx mocha test/unit-stages.test.mjs（暫存落 test/_tmp/stages-<pid>，測完即刪）

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore } from './tools/memStore.mjs'
import { nullLogger } from './tools/nullLogger.mjs'
import { makeSlugResolver, markConflict, applyRelationsToNote, stageRelate } from '../src/stages/relateStage.mjs'
import { buildWorkflowStages, mwBuildBase, mwRunWorkflow, mwAdoptResult, mwRenderCore, mwPersistCore } from '../src/stages/distillStage.mjs'
import { mwNormalizeItems, stageListFetch } from '../src/stages/listFetchStage.mjs'
import { stageExpand } from '../src/stages/expandStage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageDetailFetch, mwPersistOutcome } from '../src/stages/detailFetchStage.mjs'
import { stageDocMaintain } from '../src/stages/docMaintainStage.mjs'
import { stageExtract } from '../src/stages/extractStage.mjs'
import { stageTriage } from '../src/stages/triageStage.mjs'
import { defineMw, composeChain, makeMsg } from '../src/core/kernel.mjs'
import { buildDistillPrompt } from '../src/domain/distillDomain.mjs'
import { renderFrontmatter, parseFrontmatter, writeMd, readMd, sectionOf, dropSection } from '../src/md/md.mjs'
import { createClock } from '../src/util/clock.mjs'

const TMP = path.resolve(`test/_tmp/stages-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const log = nullLogger()
const clock = createClock('Asia/Taipei')

describe('unit-stages', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── slug 容錯 ──
    it('slug 解析：完全相符→尾碼容錯→幻想拒收', () => {
        const resolve = makeSlugResolver([{ id: '深度學習於蛋白質結構預測-ab12cd34' }])
        assert.equal(resolve('深度學習於蛋白質結構預測-ab12cd34'), '深度學習於蛋白質結構預測-ab12cd34')
        assert.equal(resolve('深度-學習-於蛋白質-結構預測-ab12cd34'), '深度學習於蛋白質結構預測-ab12cd34', '抄寫誤差由尾碼救回')
        assert.equal(resolve('完全捏造-ffffffff'), null, '幻想 slug 拒收——放行會種下指向空檔案的邊')
    })

    // ── md 往返 ──
    it('frontmatter 往返：含逗號/引號的陣列元素、數字、布林', () => {
        const front = { title: '含"引號"與,逗號', tags: ['a,b', 'c"d'], n: 3, ok: true }
        const { front: back } = parseFrontmatter(renderFrontmatter(front) + '\n\nbody')
        assert.equal(back.title, front.title)
        assert.deepEqual(back.tags, front.tags)
        assert.equal(back.n, 3)
        assert.equal(back.ok, true)
    })

    // ── 關聯寫回與衝突雙寫 ──
    it('關聯章節整段重寫不疊加；衝突雙寫冪等', () => {
        const file = `${TMP}/note-a.md`
        writeMd(file, { title: 'A', slug: 'a-11111111' }, '# A\n\n內文')
        const note = { id: 'a-11111111', file }
        const titleOf = () => 'B 標題'

        applyRelationsToNote(note, [{ to: 'b-22222222', type: '互補搭配', reason: 'r1' }], titleOf, { nowIso: clock.iso8() })
        applyRelationsToNote(note, [{ to: 'b-22222222', type: '互補搭配', reason: 'r2' }], titleOf, { nowIso: clock.iso8() })
        const md1 = readMd(file)
        assert.equal((md1.body.match(/## 關聯/g) || []).length, 1, '關聯章節必整段重寫，不可疊加')
        assert.match(md1.body, /r2/)
        assert.doesNotMatch(md1.body, /r1/)

        markConflict(note, 'c-33333333', 'C 標題', '甲說X乙說Y')
        markConflict(note, 'c-33333333', 'C 標題', '甲說X乙說Y')
        const md2 = readMd(file)
        assert.equal((md2.body.match(/c-33333333/g) || []).length, 1, '同一對象不可重複追加')
        assert.deepEqual(md2.front.conflicts, ['c-33333333'])
        // 衝突章節在關聯重寫後仍須存活（衝突追加於檔尾、關聯只在成為 target 時重寫一次）
        assert.match(md2.body, /⚠ 衝突與反例/)
    })

    // ── 章節順序不定時的正確性（2026-09-06 生產實測：133 篇衝突章在前、86 篇因此漏寫衝突行）──
    it('衝突章在關聯章之前：markConflict 仍追加、關聯重寫不吃掉衝突章、提煉輸入保留衝突章', () => {
        const file = `${TMP}/note-b.md`
        writeMd(file, { title: 'B', slug: 'b-22222222' }, '# B\n\n內文')
        const note = { id: 'b-22222222', file, title: 'B' }
        // ①先被別篇標為衝突（衝突章在前）②再成為 relate 目標（關聯章在後，且含指向 d 的衝突邊）
        markConflict(note, 'c-33333333', 'C 標題', '甲說X乙說Y')
        applyRelationsToNote(note, [
            { to: 'c-33333333', type: '衝突或反例', reason: '甲說X乙說Y' },
            { to: 'd-44444444', type: '衝突或反例', reason: '丙說P丁說Q' },
        ], () => 'T', { nowIso: clock.iso8() })
        // ③雙寫 d：衝突章不含 d、其後的關聯章含 [[d]] —— 舊實作（章節比對到檔尾）在此誤判已存在而漏寫
        markConflict(note, 'd-44444444', 'D 標題', '丙說P丁說Q')
        const md = readMd(file)
        assert.ok(md.body.indexOf('## ⚠ 衝突與反例') < md.body.indexOf('## 關聯'), '前置條件：衝突章在前、關聯章在後')
        const conf = sectionOf(md.body, '⚠ 衝突與反例')
        assert.ok(conf && conf.text.includes('[[d-44444444]]'), '衝突章節必須含 d（生產 86 篇漏寫之情境）')
        assert.ok(conf.text.includes('[[c-33333333]]'))
        assert.doesNotMatch(conf.text, /## 關聯/, '章節範圍須止於下一個 H2')
        assert.deepEqual(md.front.conflicts, ['c-33333333', 'd-44444444'])
        // ④再次成為目標：整章重寫關聯，衝突章（在前）與其內容不得被吃掉
        applyRelationsToNote(note, [{ to: 'e-55555555', type: '互補搭配', reason: 'r2' }], () => 'T', { nowIso: clock.iso8() })
        const md2 = readMd(file)
        assert.equal((md2.body.match(/## 關聯/g) || []).length, 1)
        assert.match(md2.body, /\[\[e-55555555\]\]/)
        assert.doesNotMatch(md2.body, /\[\[d-44444444\]\] T：/, '舊關聯行須被整章重寫')
        assert.ok(sectionOf(md2.body, '⚠ 衝突與反例')?.text.includes('[[d-44444444]]'), '衝突章節於關聯重寫後仍在')
        // ⑤提煉輸入：去關聯章、留衝突章（disputes 的直接材料）
        const prompt = buildDistillPrompt('概念', [{ id: note.id, title: 'B', file, sourceName: 's', sourceUrl: 'u' }], '')
        assert.match(prompt, /衝突與反例[\s\S]*丙說P丁說Q/)
        assert.doesNotMatch(prompt, /## 關聯/)
        // dropSection 對「關聯在前、衝突在後」亦只去關聯章
        const body3 = '# X\n\n內文\n\n## 關聯\n\n- a\n\n## ⚠ 衝突與反例\n\n- 與 [[y]] Y：r'
        assert.equal(dropSection(body3, '關聯'), '# X\n\n內文\n\n## ⚠ 衝突與反例\n\n- 與 [[y]] Y：r')
    })

    // ── 輪抓契約層：每來源取用上限與非陣列回傳 ──
    it('輪抓契約層：itemsPerSource 截斷生效；抓取器回傳非陣列 → 記 _outcome 失敗、不短路（計帳環仍走）', async () => {
        const mk = () => makeMsg('source', { name: 'S', url: 'https://s.example', _fetcher: { id: 'rss' } })
        const ctx = { deps: { settings: { fetch: { itemsPerSource: 3, maxTextChars: 100 } }, seen: null }, log }
        const run = composeChain([mwNormalizeItems()])
        const m1 = mk()
        m1.data._raw = Array.from({ length: 10 }, (_, i) => ({ url: `https://e.com/${i}`, title: `t${i}` }))
        await run(m1, ctx)
        assert.equal(m1.data._items.length, 3, '每來源取用上限須截斷（進料與處理量對齊；未截斷時單來源一輪曾新增 100 篇）')
        const m2 = mk()
        m2.data._raw = { not: 'array' }
        const { halted } = await run(m2, ctx)
        assert.equal(halted, '', '不短路：下游 accountSource 才能記失敗、更新 lastFetchAt')
        assert.equal(m2.data._outcome?.ok, false)
        assert.equal(m2.data._outcome.reason, 'contract-error')
        assert.equal(m2.stats.srcFail, 1)
    })

    // ── 角色鏈接線 ──
    const KINDS = {
        audit: { produces: 'issues', check: () => true, build: ({ draft, issues }) => `AUDIT|d=${draft}|i=${issues}` },
        revise: { produces: 'draft', check: () => true, build: ({ draft, issues }) => `REVISE|d=${draft}|i=${issues}` },
    }
    it('buildWorkflowStages：啟動期驗證', () => {
        assert.throws(() => buildWorkflowStages([], KINDS, {}), /未設定或為空/)
        assert.throws(() => buildWorkflowStages([{ stage: 'revise' }], KINDS, {}), /須為產出意見/)
        assert.throws(() => buildWorkflowStages([{ stage: 'nope' }], KINDS, {}), /未知的 stage/)
    })
    it('buildWorkflowStages：自動編號與稿件/意見接線', () => {
        const stages = buildWorkflowStages(
            [{ stage: 'audit' }, { stage: 'revise' }, { stage: 'audit' }, { stage: 'revise' }],
            KINDS, {},
        )
        assert.deepEqual(stages.map((s) => s.id), ['audit', 'revise', 'audit2', 'revise2'], '同種重複自動編號')
        const ctx = { input: 'DRAFT0', results: { audit: { issues: ['i1'] }, revise: 'DRAFT1', audit2: { issues: ['i2'] } } }
        assert.equal(stages[0].prompt(ctx), 'AUDIT|d=DRAFT0|i=null', '第一棒吃前段整合稿')
        assert.equal(stages[1].prompt(ctx), 'REVISE|d=DRAFT0|i=i1')
        assert.equal(stages[2].prompt(ctx), 'AUDIT|d=DRAFT1|i=i1', 'audit2 吃 revise 的新稿')
        assert.equal(stages[3].prompt(ctx), 'REVISE|d=DRAFT1|i=i2', 'revise2 吃最近的意見 audit2')
    })

    // ── 提煉：降級保底與版本化 ──
    const distillCfg = (wkfResult) => ({
        stores: { notes: memStore([]), cores: memStore([]) },
        log,
        clock,
        dirs: { core: TMP },
        notesPerTarget: 5,
        workflow: { wkf: { runFanoutPipeline: async () => wkfResult }, fanout: { indeps: [{}], integrate: {} }, pipeline: [{ stage: 'audit' }] },
        domain: {
            kinds: KINDS,
            buildBasePrompt: () => 'base',
            checkCore: () => true,
            coreSchema: '{}',
            renderCore: (t, data) => ({ body: `# 核心：${t.concept}\n\n${data.essence}` }),
        },
    })
    const target = () => ({ concept: '注意力機制', notes: [{ id: 'n1', createdAt: '2026-08-01' }], core: null })

    /** 逐概念鏈執行(2026-08-20 起提煉為動作鏈:buildBase→runWorkflow→adoptResult→renderCore→persistCore) */
    const runDistillTarget = async (cfg, t) => {
        const chain = composeChain([mwBuildBase({ notesPerTarget: cfg.notesPerTarget }), mwRunWorkflow(), mwAdoptResult(), mwRenderCore(), mwPersistCore()])
        const ctx = {
            deps: { stores: cfg.stores, clock: cfg.clock, dirs: cfg.dirs, ai: null, settings: { knowledge: { distillNotesPerConcept: cfg.notesPerTarget } } },
            log: cfg.log,
        }
        const msg = makeMsg('concept', { target: t, _domain: cfg.domain, _workflow: cfg.workflow })
        await chain(msg, ctx)
        return { updated: msg.stats.updated || 0, aiCalls: msg.stats.aiCalls || 0 }
    }

    it('提煉：B 段失敗降級採用 A 整合稿（欄位名 result）', async () => {
        const cfg = distillCfg({ ok: false, error: 'B段炸了', A: { result: { essence: '降級稿本質' } } })
        const r = await runDistillTarget(cfg, target())
        assert.equal(r.updated, 1, '降級路徑必須落盤——此路徑曾因欄位名寫錯靜默失效三天')
        const core = (await cfg.stores.cores.select())[0]
        assert.equal(core.version, 1)
        assert.match(core.essence, /降級稿本質/)
        assert.match(readMd(core.file).body, /降級稿本質/)
    })

    it('提煉：A 也沒有結果才算失敗；成功路徑版本遞增', async () => {
        const cfg1 = distillCfg({ ok: false, error: '全滅', A: null })
        assert.equal((await runDistillTarget(cfg1, target())).updated, 0)

        const cfg2 = distillCfg({ ok: true, result: { essence: '正式稿' }, totalMs: 1000 })
        cfg2.stores.notes = memStore([{ id: 'n1', createdAt: '2026-08-01' }]) // 預載依據筆記,distilledAt 之 patch 才有對象
        const t2 = target()
        await runDistillTarget(cfg2, t2)
        const core = (await cfg2.stores.cores.select())[0]
        // 第二版：帶既有 core 再跑一次
        await runDistillTarget(cfg2, { ...t2, core })
        assert.equal((await cfg2.stores.cores.select())[0].version, 2, '版本必須遞增')
        // used notes 須標 distilledAt(此前 memStore 未預載 n1,patch 為 no-op,本斷言形同虛設)
        assert.ok((await cfg2.stores.notes.get('n1')).distilledAt, '依據筆記須標 distilledAt')
    })

    // ── 補全文佇列：不得因容量或時間丟棄（2026-09-07 移除時間型過期）──
    it('docMaintain 沒有時間型過期：不論多舊、抓過幾次，new 件經維護後仍是 new；瘦身照常', async () => {
        const day = 86400_000
        const ago = (d) => new Date(Date.now() - d * day).toISOString()
        const docs = memStore([
            { id: 'never-old', status: 'new', fetchTries: 0, collectedAt: ago(400) }, // 沒輪到 400 天：不丟
            { id: 'tried-old', status: 'new', fetchTries: 2, collectedAt: ago(400) }, // 抓過 2 次、400 天：不丟（下輪 FIFO 再試）
            { id: 'noted-old', status: 'noted', text: 'AAAA', feedText: 'BB', collectedAt: ago(400) },
        ])
        const stage = stageDocMaintain()
        const r = await stage.run({ deps: { stores: { docs }, settings: { fetch: { terminalStatuses: ['noted'] } } }, log })
        assert.equal(r.ok, true)
        assert.equal((await docs.get('never-old')).status, 'new', '知識庫沒有逾期：從未輪到者不丟')
        assert.equal((await docs.get('tried-old')).status, 'new', '抓過失敗者由 detailFetch 試滿 maxFetchTries 標 dead，不因時間丟')
        assert.equal((await docs.get('noted-old')).text, '', '終態瘦身照常')
        assert.equal(r.detail.expired, undefined, '鏈上沒有 expire 環（曾為 mwExpire，2026-09-07 移除）')
    })

    it('補全文選取：tries 升冪→tier 升冪→同層級 FIFO；失敗件排隊末不佔重試名額；非 new 不選', async () => {
        const seen = []
        const record = defineMw({
            name: 'record',
            handle: async (msg, ctx, next) => {
                seen.push(msg.data.id); return next(msg)
            }
        })
        const docs = memStore([
        // 失敗過的最舊 tier-1 件：曾因保留原 collectedAt 而黏在隊頭、每輪重耗名額（2026-09-08 實測隊頭
        // 30 篇有 14 篇為 tries=2 之 MSN wrapper/401/403，27 個名額僅 5~15 篇抓成功）→ 應排到最末
            { id: 't1-tried', status: 'new', sourceTier: 1, fetchTries: 2, collectedAt: '2026-06-01T00:00:00+08:00' },
            { id: 't3-newest', status: 'new', sourceTier: 3, collectedAt: '2026-09-01T00:00:00+08:00' },
            { id: 't3-oldest', status: 'new', sourceTier: 3, collectedAt: '2026-07-01T00:00:00+08:00' },
            { id: 't2-old', status: 'new', sourceTier: 2, collectedAt: '2026-08-01T00:00:00+08:00' },
            { id: 't3-mid', status: 'new', sourceTier: 3, collectedAt: '2026-08-15T00:00:00+08:00' },
            { id: 'already-raw', status: 'raw', sourceTier: 1, collectedAt: '2026-06-01T00:00:00+08:00' },
        ])
        const stage = stageDetailFetch({ chain: [record], articlesPerRun: 3 })
        await stage.run({ deps: { stores: { docs }, settings: { fetch: { articlesPerRun: 3 } } }, log })
        assert.deepEqual(seen, ['t2-old', 't3-oldest', 't3-mid'],
            '未試過者先抓：tier 先、同層級最舊先。曾為最新優先，使沒搶到名額者每輪被更新者擠掉直到過期')
        assert.ok(!seen.includes('t1-tried'), '失敗件排隊末：即使 tier 最高、collectedAt 最舊也不得插隊佔用名額')
        assert.ok(!seen.includes('t3-newest'), '名額只有 3，最新者本輪排隊，不插隊')
        assert.ok(!seen.includes('already-raw'), '已有素材者不重抓')

        // 未試件抓完後，失敗件仍會被撿起（保留不丟；記錄永不刪除）
        const seen2 = []
        const record2 = defineMw({
            name: 'record2',
            handle: async (msg, ctx, next) => {
                seen2.push(msg.data.id); return next(msg)
            }
        })
        const docs2 = memStore([
            { id: 't1-tried', status: 'new', sourceTier: 1, fetchTries: 2, collectedAt: '2026-06-01T00:00:00+08:00' },
            { id: 't3-tried-more', status: 'new', sourceTier: 3, fetchTries: 1, collectedAt: '2026-07-01T00:00:00+08:00' },
        ])
        await stageDetailFetch({ chain: [record2], articlesPerRun: 3 })
            .run({ deps: { stores: { docs: docs2 }, settings: { fetch: { articlesPerRun: 3 } } }, log })
        assert.deepEqual(seen2, ['t3-tried-more', 't1-tried'], '無未試件時仍重試失敗件，且試較少次者先')
    })

    it('補全文落庫：未達上限退回 new（排隊末重試）；達 maxFetchTries 標 dead 並移出待抓清單', async () => {
        const docs = memStore([
            { id: 'a', status: 'new', fetchTries: 1 },
            { id: 'b', status: 'new', fetchTries: 2 },
        ])
        const deps = { stores: { docs }, settings: { fetch: { maxFetchTries: 3, maxTextChars: 100 } }, clock: createClock('Asia/Taipei') }
        const run = async (id, tries) => {
            const msg = makeMsg('doc', { id, _tries: tries, _fetched: { ok: false, message: 'HTTP 403' } }, { stage: 'detailFetch' })
            await composeChain([mwPersistOutcome()], { chainName: 'x' })(msg, { deps, log })
            return docs.get(id)
        }
        const a = await run('a', 2)
        assert.equal(a.status, 'new', '第 2 次失敗：退回 new 等重試（排隊末）')
        assert.equal(a.fetchTries, 2)
        assert.equal(a.deadAt, undefined, '未放棄者不記 deadAt')
        const b = await run('b', 3)
        assert.equal(b.status, 'dead', '第 3 次（maxFetchTries）失敗：標為無效資料，移出待抓清單')
        assert.match(b.lastError, /HTTP 403/, '保留最後錯誤供稽核')
        assert.ok(b.deadAt, '記下放棄時刻')
        assert.ok(await docs.get('b'), '記錄永不刪除——它是去重憑證，刪了同一 url 會被重新收錄')
    })

    it('萃取選取：tries 升冪→tier 升冪→同層級 FIFO（先收先萃）；raw 進料大於容量時最舊者不得被擠掉', async () => {
        const docs = memStore([
            { id: 't1-tried', status: 'raw', sourceTier: 1, extractTries: 1, collectedAt: '2026-06-01T00:00:00+08:00' }, // 失敗過：排隊尾
            { id: 't3-newest', status: 'raw', sourceTier: 3, collectedAt: '2026-09-01T00:00:00+08:00' },
            { id: 't3-oldest', status: 'raw', sourceTier: 3, collectedAt: '2026-07-01T00:00:00+08:00' },
            { id: 't1-new', status: 'raw', sourceTier: 1, collectedAt: '2026-09-01T00:00:00+08:00' },
            { id: 't3-mid', status: 'raw', sourceTier: 3, collectedAt: '2026-08-15T00:00:00+08:00' },
        ])
        const batches = []
        const domain = {
            buildPrompt: async (batch) => {
                batches.push(batch.map((d) => d.id)); return 'p'
            },
            isValidItem: () => true,
        }
        const stage = stageExtract({
            domain,
            docsPerBatch: 3,
            parallel: 1,
            rounds: 1,
            callAI: async () => ({ ok: true, data: [1, 2, 3].map((index) => ({ index, relevant: false, reason: '測試：判非知識' })) }),
        })
        const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock: createClock('Asia/Taipei'), settings: { knowledge: {}, ai: {} } }
        await stage.run({ deps, log })
        assert.deepEqual(batches[0], ['t1-new', 't3-oldest', 't3-mid'],
            'tier 先；同層級最舊先。曾為最新優先：raw 進料（補全文＋feed 直入）大於容量時最舊者永遠輪不到')
        assert.equal((await docs.get('t3-oldest')).status, 'skip', '最舊者本輪已被判定')
        assert.equal((await docs.get('t3-newest')).status, 'raw', '名額只有 3，最新者排隊，不插隊')
        assert.equal((await docs.get('t1-tried')).status, 'raw', '失敗過者排隊尾（隊頭防阻塞），不因 tier 高插隊')
    })

    it('萃取 report：批次失敗與未涵蓋須進 stats.fail（此前手組 report 恆 fail:0）；逾時間預算即 stopped 且不記 tries', async () => {
        const docs = memStore([{ id: 'a', status: 'raw', title: 'A', collectedAt: '2026-06-01' }, { id: 'b', status: 'raw', title: 'B', collectedAt: '2026-06-02' }])
        const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: { knowledge: {}, ai: {} } }
        const domain = { buildPrompt: async () => 'p', isValidItem: () => true }
        const r1 = await stageExtract({ domain, docsPerBatch: 2, parallel: 1, rounds: 1, callAI: async () => ({ ok: false, error: 'truncated', skipped: false }) })
            .run({ deps, log })
        assert.equal(r1.ok, true, '批次失敗不是子階段失敗(有隔離),但須計入 fail')
        assert.equal(r1.stats.fail, 1, '1 個失敗批次')
        assert.equal(r1.detail.failedBatches, 1)
        assert.equal((await docs.get('a')).extractTries, 1, '整批失敗記 tries(換批次組合後再試)')

        const docs2 = memStore([{ id: 'a', status: 'raw', title: 'A', collectedAt: '2026-06-01' }])
        const r2 = await stageExtract({ domain, docsPerBatch: 1, parallel: 1, rounds: 3, callAI: async () => ({ ok: true, data: [{ index: 1, relevant: false, reason: 'x' }] }) })
            .run({ deps: { ...deps, stores: { ...deps.stores, docs: docs2 } }, log, expired: () => true })
        assert.equal(r2.detail.stopped, true, '整輪已逾時間預算:一輪都不開工')
        assert.equal(r2.stats.aiCalls, 0)
        assert.equal((await docs2.get('a')).status, 'raw', '未取件者原樣留佇列,不記 tries')
    })

    it('預篩：放行標 relevant、攔下轉 skip（skipReason 預篩：）、未涵蓋記 tries、失敗達上限放行（fail-open）；萃取只取放行者；停用即整段不跑', async () => {
        const docs = memStore([
            { id: 'a', status: 'raw', title: 'A 批次正規化實驗', text: 'x', collectedAt: '2026-06-01' },
            { id: 'b', status: 'raw', title: 'B 體育新聞', text: 'y', collectedAt: '2026-06-02' },
            { id: 'c', status: 'raw', title: 'C', text: 'z', collectedAt: '2026-06-03' },
        ])
        const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: { knowledge: { triageEnabled: true }, ai: {} } }
        const domain = {
            buildPrompt: async () => 'p',
            isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
            reasonOf: (it) => it.reason || '',
        }
        const r = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, maxTries: 2, callAI: async () => ({ ok: true, data: [{ index: 1, relevant: true }, { index: 2, relevant: false, reason: '體育' }] }) })
            .run({ deps, log })
        assert.deepEqual([r.detail.processed, r.detail.relevant, r.detail.irrelevant, r.detail.missed], [2, 1, 1, 1])
        assert.equal((await docs.get('a')).triage, 'relevant')
        const b = await docs.get('b')
        assert.equal(b.status, 'skip', '攔下者轉 skip(終態,記錄保留)')
        assert.match(b.skipReason, /^預篩：體育/)
        assert.equal((await docs.get('c')).triageTries, 1, '未涵蓋者記 tries,仍待預篩(status 仍 raw)')
        // 萃取只取放行者:c 未預篩不取、b 已 skip
        const picked = []
        await stageExtract({
            domain: {
                buildPrompt: async (batch) => {
                    picked.push(...batch.map((d) => d.id)); return 'p'
                },
                isValidItem: () => true
            },
            docsPerBatch: 3,
            parallel: 1,
            rounds: 1,
            callAI: async () => ({ ok: true, data: [{ index: 1, relevant: false, reason: 'x' }] }),
        }).run({ deps, log })
        assert.deepEqual(picked, ['a'], '萃取 pickPool 只取 triage=relevant 者')
        // 預篩失敗達上限 → 放行(fail-open):預篩壞了不得擋住整條萃取線
        const r2 = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, maxTries: 2, callAI: async () => ({ ok: false, error: 'boom', skipped: false }) })
            .run({ deps, log })
        assert.equal(r2.detail.failedBatches, 1)
        const c = await docs.get('c')
        assert.deepEqual([c.triage, c.triageTries], ['relevant', 2])
        assert.match(c.lastError, /放行交萃取/)
        // 停用:整段不跑;萃取不看 triage 欄
        const r3 = await stageTriage({
            domain,
            callAI: async () => {
                throw new Error('停用時不應呼叫 AI')
            }
        })
            .run({ deps: { ...deps, settings: { knowledge: { triageEnabled: false }, ai: {} } }, log })
        assert.equal(r3.detail.disabled, true)
        const docs2 = memStore([{ id: 'u', status: 'raw', title: 'U', collectedAt: '2026-06-01' }])
        const picked2 = []
        await stageExtract({
            domain: {
                buildPrompt: async (batch) => {
                    picked2.push(...batch.map((d) => d.id)); return 'p'
                },
                isValidItem: () => true
            },
            docsPerBatch: 1,
            parallel: 1,
            rounds: 1,
            callAI: async () => ({ ok: true, data: [{ index: 1, relevant: false, reason: 'x' }] }),
        }).run({ deps: { ...deps, stores: { ...deps.stores, docs: docs2 }, settings: { knowledge: { triageEnabled: false }, ai: {} } }, log })
        assert.deepEqual(picked2, ['u'], '預篩停用時未預篩之 raw 亦可萃取')
    })

    // ── 例外仍落帳之對稱性(2026-09-23 修):逐項鏈拋錯時,每一種「逐項佇列」都要記 tries/計帳,否則拋錯者永遠排回隊頭 ──
    const boom = (why) => defineMw({
        name: 'boom',
        handle: async () => {
            throw new Error(why)
        }
    })

    it('補全文逐篇鏈異常:onFail 記 tries,達 maxFetchTries 標 dead(與落庫環同一判準;此前恆為 new)', async () => {
        const docs = memStore([
            { id: 'a', status: 'new', fetchTries: 0, collectedAt: '2026-06-01' },
            { id: 'b', status: 'new', fetchTries: 2, collectedAt: '2026-06-02' },
        ])
        const deps = { stores: { docs }, settings: { fetch: { articlesPerRun: 5, maxFetchTries: 3 } }, clock }
        const r = await stageDetailFetch({ chain: [boom('無可用內文抓取器')] }).run({ deps, log })
        assert.equal(r.stats.fail, 2)
        const a = await docs.get('a')
        const b = await docs.get('b')
        assert.deepEqual([a.status, a.fetchTries], ['new', 1], '未達上限:退回 new(排隊末)')
        assert.deepEqual([b.status, b.fetchTries], ['dead', 3], '達上限:標 dead 移出待抓清單')
        assert.ok(b.deadAt, '記下放棄時刻')
        assert.match(b.lastError, /逐篇鏈異常：無可用內文抓取器/)
    })

    it('輪抓逐來源鏈異常(計帳環之前拋錯):onFail 仍落帳——lastFetchAt 更新、failCount+1(此前永遠排在最舊優先隊頭)', async () => {
        const sources = memStore([{ id: 's1', name: 'S1', kind: 'rss', url: 'https://s1.example/feed', tier: 1, lastFetchAt: '', failCount: 0 }])
        const registry = { resolve: () => ({ id: 'rss', timeoutMs: 0 }), label: () => 'rss' }
        const deps = { stores: { sources }, registry, settings: { fetch: { sourcesPerRun: 5, minSourceIntervalMs: 0 }, sourcePolicy: { maxConsecFails: 8 } }, clock }
        const r = await stageListFetch({ chain: [boom('filter 必須回傳陣列')] }).run({ deps, log })
        const s = await sources.get('s1')
        assert.ok(s.lastFetchAt, 'lastFetchAt 須更新')
        assert.equal(s.failCount, 1, '計入連續失敗(達門檻才會停用)')
        assert.match(s.lastError, /逐來源鏈異常：filter 必須回傳陣列/)
        assert.equal(r.stats.fail, 1)
    })

    it('擴充逐線索鏈異常:onFail 走 settleClue 記 tries,達 maxTries 轉 failed(線索依 hits 排序,不落帳即每輪排回隊頭)', async () => {
        const frontier = memStore([{ id: 'c1', type: 'keyword', value: 'k', hits: 9, status: 'pending', tries: 0, addedAt: '2026-01-01' }])
        const deps = { stores: { frontier }, settings: { knowledge: { frontierPerRun: 5, frontierMaxPending: 0 } }, clock }
        const stage = stageExpand({ chain: [boom('入庫失敗')], maxTries: 2 })
        await stage.run({ deps, log })
        let c = await frontier.get('c1')
        assert.deepEqual([c.status, c.tries], ['pending', 1])
        assert.match(c.lastError, /逐線索鏈異常：入庫失敗/)
        await stage.run({ deps, log })
        c = await frontier.get('c1')
        assert.deepEqual([c.status, c.tries], ['failed', 2], '達 maxTries 轉 failed,不再每輪佔名額')
    })

    it('關聯逐項鏈異常:記 relateTries(與萃取/預篩之 applyItem 對稱;此前只記日誌,拋錯者同輪後續與下一輪皆排回隊頭)', async () => {
        const notes = memStore([
            { id: 'n1', title: 'A', concepts: ['x'], category: 'c', createdAt: '2026-01-01', relatedAt: '' },
            { id: 'n2', title: 'B', concepts: ['x'], category: 'c', createdAt: '2026-01-02', relatedAt: '' },
        ])
        const deps = {
            stores: { notes, relations: memStore() },
            settings: { knowledge: { relateBatch: 6, relateCandidates: 5 }, ai: { aiParallel: 1, organizeRounds: 1 } },
            ai: null,
            clock,
            domains: { relate: createRelateDomain({}) },
        }
        const bag = {}
        const ctx = {
            deps,
            log,
            set: (k, v) => {
                bag[k] = v
            },
            get: (k, d) => bag[k] ?? d,
        }
        await stageRelate({
            chain: [boom('寫回筆記失敗')],
            callAI: async () => ({ ok: true, data: [{ index: 1, relations: [] }, { index: 2, relations: [] }], error: '', skipped: false, attempts: 1, preview: '' }),
        }).run(ctx)
        for (const id of ['n1', 'n2']) {
            const n = await notes.get(id)
            assert.equal(n.relateTries, 1, `${id} 須記 relateTries`)
            assert.match(n.relateLastError, /逐項鏈異常：/)
            assert.equal(n.relatedAt, '', '未完成關聯者不標 relatedAt(記錄不丟,排隊尾重試)')
        }
    })

})
