// unit-extract-golden.test.mjs — 提煉提示詞之逐字基準(golden):3+3 之一般批(起草、整合、審計、修訂、終審)、部分可見之起草、整併、本質專步、
//   待審裁決,與檢定標準之六支(出處支持覆核、依出處收斂之修訂、失撐找支持、爭議覆核、同義覆核、同義提議)
// 【為何要有】提煉之提示詞改一字即改了模型行為(評比與 A/B 皆失效);新增之條件段(重審、出處已撤)只在有項時出現,無項時須與既有逐字相同——
//   結構斷言驗不出措辭漂移,故以替身 AI 擷取實際送出之提示詞與基準檔比對。
// 【兩組基準】①覆寫重現(test/golden/extract-override/):以量化詞彙之覆寫(test/tools/quantVocab:中立化之前之證據性質封頂與自承限制片語、
//   推定詞、guide.extract 7 欄之原句)產出,須與中立化之前之實作所產者逐字同——證明安裝方給回原值與原句,提示詞即逐字重現。3+3 之十檔為中立化之前
//   之基準原檔;檢定標準之六檔由中立化之前之實作以同一組輸入(test/tools/promptInputs 之 ES_PROMPT_INPUTS)產生——兩者皆非本套件之產物,
//   本測試不重產之 ②中立基準(test/golden/extract/):以預設詞彙產出。
// 【覆寫重現之 16 檔為何不可重產】其真理源是「中立化之前之實作」之輸出(3+3 之十檔為當時之基準原檔、檢定標準之六檔為當時之實作以同一組輸入所產),
//   該實作已不在本套件——以現行實作重產等於拿被測物自己的輸出當真理,「給回原值即逐字重現」之證明即失效;本測試之 writable:false 使任何旗標皆不寫此組。
//   若確認某檔本身有誤(非實作漂移),只能手改並於提交說明逐行依據。
// 【覆寫重現之手改紀錄】(逐檔逐行;每次手改於此登錄,其餘各行與中立化之前之產出逐字同)
//   ・delta-draft.txt、delta-draft-partial.txt 之第 25 行(起草提示詞之 dispute_add 說明)與第 29 行(param_add 說明)——依據:使用端需求 Gitea #90(規則帳本 EXT-37):
//     起草提示詞須以字面寫出納入閘與檢定標準 ES13 以字面判讀之要求,且已以正式起草席位 A/B 驗證。手改法＝以原行就地置換該兩處說明文字(不是以現行實作之輸出重產):
//     ⑴dispute_add:「每方須有本批出處或所引既有主張；」→「每方須有本批出處或所引主張，且至少一方要寫本批出處 sources——各方只引主張（含同一差量之新主張 @名）而整條無 sources 者會被拒收；」
//     ⑵param_add:「關鍵參數：」→「關鍵參數（conditions 寫適用條件；證據僅單一來源或未經獨立驗證者，conditions 須含『…』之一（程式以字面判讀，同義改寫不算））：」,
//     『…』之限制語列表＝測試詞彙之 selfLimitPhrases(多「僅樣本內」,置最前)＋弱證據之說法(中立基準之同一行無「僅樣本內」——證明列表隨詞彙變)。
//     本測試以現行實作之輸出逐字比對這兩處手改:兩者相符,即證明手改法與實作之置換結果一致。
// 【中立基準之重產紀律】刻意改提示詞(須先以正式席位 A/B 驗證)才重產,一律經 test/tools/regen-golden.mjs:預設預演(列出會新增／改動之檔、
//   不寫),GOLDEN_WRITE=1 才寫入;覆寫組照常比對、不符即中止。工具以 GOLDEN_WRITE=1＋GOLDEN_OUT=<暫存根> 跑本測試——GOLDEN_OUT 給了即把可重產之組
//   寫到暫存根而非原處(只給 GOLDEN_WRITE=1 者寫回原處,同既有用法)。
// 執行:自套件根 node <mocha> test/unit-extract-golden.test.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { goldenPlanOf, regenGolden, GOLDEN_WRITABLE_DIRS } from './tools/regen-golden.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import { runPass } from '../src/workflow/runPass.mjs'
import { runPending } from '../src/workflow/pending.mjs'
import { relationContextRows } from '../src/workflow/relationContext.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { findItem } from '../src/stores/coreState.mjs'
import { seedCore, SEATS, ANN, seatAi as captureAi, keepAll } from './tools/extractKit.mjs'
import { QUANT_VOCAB } from './tools/quantVocab.mjs'
import { ES_PROMPT_INPUTS } from './tools/promptInputs.mjs'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden')
const WRITE = process.env.GOLDEN_WRITE === '1'
/** 可重產之組之寫出根:GOLDEN_OUT 給了即寫到該處(重產工具之暫存根),否則原處 */
const OUT = process.env.GOLDEN_OUT ? path.resolve(process.env.GOLDEN_OUT) : GOLDEN
const AT = '2026-10-04T08:00:00+08:00'

/** 兩組基準:覆寫重現(不重產)與中立基準(GOLDEN_WRITE=1 重產) */
const VARIANTS = [
    { name: '覆寫重現(量化詞彙)', dir: 'extract-override', vocab: QUANT_VOCAB, writable: false },
    { name: '中立基準(預設詞彙)', dir: 'extract', vocab: null, writable: true },
]

// 3+3 之席位、合檢定標準之標注(ANN)與替身(依席位回覆並記下每席收到之提示詞)取共用件(test/tools/extractKit)。起草之新增主張不合標準會成
//   程式意見(檢定標準)列入審計意見、使修訂與終審提示詞多出程式意見——基準檔須以「合標準之起草」產生;單篇出處(N1)之主張為 rule(principle 須兩份相異文件,ES12)

const md = (title, sections) => ({ front: { title, published: '2026-09-01', conflicts: [] }, body: `# ${title}\n\n${Object.entries(sections).map(([k, v]) => `## ${k}\n\n${v}`).join('\n\n')}\n` })
const NOTE_MD = {
    n1: md('動量與反應不足', { 一句話重點: '投資人對盈餘消息反應不足，使動量報酬持續。', 核心知識: '- 實證顯示動量報酬可持續 3 到 12 個月。\n- 反應不足在小型股較明顯。', 關鍵參數: '- 形成期：12 個月\n- 持有期：3 個月', 適用條件與限制: '- 樣本為 1965～1989 年美股。', 利弊與取捨: '- 利：簡單。\n- 弊：崩潰風險。', 時效與機制相依: '- 2000 年後效果減弱。' }),
    n2: md('動量崩潰', { 一句話重點: '動量策略在空頭反轉向上時大幅虧損。', 核心知識: '- 2009 年動量崩潰虧損逾 70%。\n- 波動率縮放可降低崩潰損失。', 爭議與反方觀點: '- 有研究認為崩潰可事前預測。' }),
}
NOTE_MD.n2.front.conflicts = ['s0']
const NOTES = new Map([
    ['s0', { id: 's0', title: '早期動量研究', evidenceLevel: '高', claimType: '實證研究', docId: 'd0', sourceName: 'SSRN' }],
    ['n1', { id: 'n1', title: '動量與反應不足', evidenceLevel: '高', claimType: '實證研究', docId: 'd1', sourceName: 'arXiv', samplePeriod: '1965-1989', caveats: ['僅美股'] }],
    ['n2', { id: 'n2', title: '動量崩潰', evidenceLevel: '中', claimType: '實證研究', docId: 'd2', sourceName: 'SSRN', samplePeriod: '1927-2013' }],
])
// 以 domain 之 noteDigest 造本批(共用件 batchOf 為「解析提示詞中之本批」,方向相反,故不同名)
const batchFor = (domain, ids) => {
    const code = new Map(ids.map((id, i) => [id, `N${i + 1}`]))
    return ids.map((id) => {
        const d = domain.noteDigest(NOTES.get(id), NOTE_MD[id], { code: code.get(id), codeOf: (x) => code.get(x) || '', titleOf: (x) => NOTES.get(x)?.title || '' })
        return { code: code.get(id), id, digest: String(d?.text ?? d ?? '') }
    })
}
const SEED = [{ code: 'N0', id: 's0' }]
/** 既有核心:主張 4、爭議 1、參數 1、問題 1、本質(所引主張存活) */
function baseState() {
    return seedCore({
        coreId: 'golden',
        concept: '動量',
        ops: [
            { op: 'add', ref: 'a', kind: 'principle', text: '投資人對資訊反應不足，使價格緩慢反映消息', conditions: ['美股樣本'], basis: '實證', sources: ['N0'] },
            { op: 'add', ref: 'b', kind: 'pitfall', text: '動量報酬在空頭反轉期常出現崩潰', critique: '崩潰時點難以事前判斷', basis: '實證', sources: ['N0'] },
            { op: 'add', ref: 'c', kind: 'rule', text: '若形成期 12 個月則持有 3 個月較穩健', basis: '實證', sources: ['N0'] },
            { op: 'add', ref: 'd', kind: 'temporal', text: '2000 年後動量效果於美股減弱', period: '2000 年後', basis: '實證', sources: ['N0'] },
            { op: 'dispute_add', question: '動量崩潰是否可事前預測', sides: [{ position: '可由波動率預測', claims: ['@b'] }, { position: '無法穩定預測', basis: '轉述', sources: ['N0'] }] },
            { op: 'param_add', name: '形成期', value: '12 個月', claim: '@c', sources: ['N0'] },
            { op: 'question_add', text: '動量在亞洲市場是否同樣存在', sources: ['N0'] },
            { op: 'essence', text: '動量是贏家續贏之傾向，崩潰風險為其主要代價。', claims: ['@a', '@b'], reason: '首版' },
        ],
        batch: SEED,
        at: '2026-10-01T08:00:00+08:00',
        msg: '基準狀態須全數套用',
    })
}
const relations = (batch) => relationContextRows([{ from: 'n2', to: 's0', type: '衝突或反例', reason: '崩潰可否預測結論相反', updatedAt: '2026-10-02T00:00:00+08:00' }, { from: 'n1', to: 'n2', type: '互補搭配', reason: '同屬動量', updatedAt: '2026-10-02T00:00:00+08:00' }], {
    codeOf: (id) => batch.find((b) => b.id === id)?.code || '',
    titleOf: (id) => NOTES.get(id)?.title || '',
    cited: new Set(['s0']),
    conflictType: '衝突或反例',
    label: true, // 與提煉段同(兩端皆可引之衝突冠 R 編號;檢定標準 ES5)
}).map((r) => r.line).join('\n')

/**
 * 與基準檔比對(可重產者於 GOLDEN_WRITE=1 時寫入)
 *
 * @param {Object} v 輸入基準之組(VARIANTS 之一)
 * @param {String} name 輸入基準檔名(不含副檔名)
 * @param {String} text 輸入實際送出之提示詞
 */
function check(v, name, text) {
    const file = path.join(GOLDEN, v.dir, `${name}.txt`)
    if (WRITE && v.writable) {
        const out = path.join(OUT, v.dir, `${name}.txt`)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, text, 'utf8')
        return
    }
    assert.ok(fs.existsSync(file), `缺基準檔 ${v.dir}/${name}.txt${v.writable ? '(以 GOLDEN_WRITE=1 產生)' : ''}`)
    const want = fs.readFileSync(file, 'utf8')
    if (text !== want) {
        const a = text.split('\n')
        const b = want.split('\n')
        const i = a.findIndex((l, k) => l !== b[k])
        assert.fail(`${v.name}:提示詞 ${name} 與基準不符(第 ${i + 1} 行)\n實際：${a[i]}\n基準：${b[i]}`)
    }
}

describe('unit-extract-golden', function() {

    for (const v of VARIANTS) {
        describe(v.name, function() {
            const domain = createExtractDomain(v.vocab ? { vocab: v.vocab } : {})

            it('一般批(delta):起草、整合、審計、修訂、終審之提示詞逐字同基準', async () => {
                const s = baseState()
                const batch = batchFor(domain,['n1', 'n2'])
                const c1 = s.claims[0]
                const add = { op: 'add', kind: 'rule', text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月', basis: '實證', sources: ['N1'], ...ANN }
                const ai = captureAi({
                    d1: { ops: [add, { op: 'confirm', id: c1.id, sources: ['N1'] }], skipped: [{ note: 'N2', reason: '品質不足' }] },
                    d2: { ops: [add], skipped: [] },
                    d3: { ops: [add], skipped: [] },
                    int: { ops: [{ ...add, via: ['a1_1', 'a2_1', 'a3_1'] }, { op: 'confirm', id: c1.id, sources: ['N1'], via: ['a1_2'] }], skipped: [{ note: 'N2', reason: '品質不足' }] },
                    aud: { issues: [{ ref: 'i_1', severity: '中', type: '空話', detail: '可更具體', fix: '補持續期間' }] },
                    rev: { edits: [{ ref: 'i_1', fields: { text: '盈餘消息反應不足使動量報酬持續 3 到 12 個月（美股）' }, issue: 0 }] },
                    acc: keepAll,
                })
                const r = await runPass({ state: s, concept: '動量', batch, relations: relations(batch), domain, seats: SEATS, ai, notesById: NOTES, at: AT, claimsCap: 80 })
                assert.equal(r.ok, true, r.error)
                assert.equal(r.stats.stdIssues, 0, '起草合檢定標準(無「檢定標準」程式意見):基準不夾帶程式意見,審計意見只有替身所給者')
                for (const k of ['d1', 'int', 'aud', 'rev', 'acc']) assert.ok(ai.prompts[k], `${k} 有收到提示詞`)
                check(v, 'delta-draft', ai.prompts.d1)
                check(v, 'delta-integrate', ai.prompts.int)
                check(v, 'delta-audit', ai.prompts.aud)
                check(v, 'delta-revise', ai.prompts.rev)
                check(v, 'delta-accept', ai.prompts.acc)
            })

            it('部分可見(狀態超出起草預算):索引行與全文混排之起草提示詞逐字同基準', async () => {
                const s = baseState()
                const batch = batchFor(domain,['n1'])
                const ai = captureAi({ d1: { ops: [], skipped: [{ note: 'N1', reason: '品質不足' }] }, d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: keepAll })
                await runPass({ state: s, concept: '動量', batch, relations: '', domain, seats: SEATS, ai, notesById: NOTES, at: AT, promptBudget: 4600 })
                assert.ok(ai.prompts.d1.includes('（索引）'), '預算不足時有索引行')
                check(v, 'delta-draft-partial', ai.prompts.d1)
            })

            it('整併(consolidate):起草提示詞逐字同基準', async () => {
                const s = baseState()
                const ai = captureAi({ d1: { ops: [], skipped: [] }, d2: { ops: [], skipped: [] }, d3: 'fail', aud: { issues: [] }, acc: keepAll })
                await runPass({ state: s, concept: '動量', batch: [], mode: 'consolidate', domain, seats: SEATS, ai, notesById: NOTES, at: AT, claimsCap: 2 })
                assert.ok(ai.prompts.d1)
                check(v, 'consolidate-draft', ai.prompts.d1)
            })

            it('本質專步(essence;ES6):無本質之核心——起草與終審提示詞逐字同基準;只收 essence', async () => {
                const s = baseState()
                s.essence = { text: '', claims: [], sources: [], at: '', stale: null }
                const [a, b] = s.claims
                const ess = { op: 'essence', text: '投資人對資訊反應不足使動量延續，空頭反轉期之崩潰為其主要代價。', claims: [a.id, b.id], reason: '首版' }
                const ai = captureAi({ d1: { ops: [ess], skipped: [] }, d2: { ops: [ess], skipped: [] }, d3: 'fail', int: { ops: [{ ...ess, via: ['a1_1', 'a2_1'] }], skipped: [] }, aud: { issues: [] }, acc: keepAll })
                const r = await runPass({ state: s, concept: '動量', batch: [], mode: 'essence', domain, seats: SEATS, ai, notesById: NOTES, at: AT })
                assert.equal(r.ok, true, r.error)
                assert.equal(r.state.essence.text, ess.text)
                check(v, 'essence-draft', ai.prompts.d1)
                check(v, 'essence-accept', ai.prompts.acc)
            })

            it('待審裁決(pending):終審席提示詞逐字同基準', async () => {
                const s = baseState()
                const batch = batchFor(domain,['n1', 'n2'])
                const crash = s.claims.find((c) => c.kind === 'pitfall')
                const sup = { op: 'supersede', id: crash.id, reason: '新證據顯示波動率縮放可降低崩潰', validPeriod: '較早之研究', sources: ['N2'] }
                const first = await runPass({ state: s, concept: '動量', batch, relations: relations(batch), domain, seats: SEATS, ai: captureAi({ d1: { ops: [sup], skipped: [{ note: 'N1', reason: '品質不足' }] }, d2: 'fail', d3: 'fail', aud: { issues: [] }, acc: 'fail' }), notesById: NOTES, at: AT })
                assert.equal(first.ok, true, first.error)
                assert.equal(first.state.pendingReview.length, 1, '終審失敗 → 取代存待審')
                assert.notEqual(findItem(first.state, crash.id).item.status, 'superseded', '未套用取代')
                const ai = captureAi({ acc: { verdicts: [{ i: 0, action: 'keep' }] } })
                const r = await runPending({ state: first.state, concept: '動量', batch: batchFor(domain,['n2']), domain, seats: SEATS, ai, notesById: NOTES, at: AT })
                assert.equal(r.ok, true, r.error)
                check(v, 'pending-accept', ai.prompts.acc)
            })

            it('檢定標準之六支(ES9 覆核與修訂、ES8、ES14、ES11 覆核與提議):提示詞逐字同基準', () => {
                const IN = ES_PROMPT_INPUTS
                check(v, 'es9-support-check', domain.buildSupportCheckPrompt(IN.supportCheck))
                check(v, 'es9-support-revise', domain.buildSupportRevisePrompt(IN.supportRevise))
                check(v, 'es8-orphan-check', domain.buildOrphanCheckPrompt(IN.orphanCheck))
                check(v, 'es14-dispute-check', domain.buildDisputeCheckPrompt(IN.disputeCheck))
                check(v, 'es11-synonym-check', domain.buildSynonymCheckPrompt(IN.synonymCheck))
                check(v, 'es11-synonym-propose', domain.buildSynonymProposePrompt(IN.synonymPropose))
            })
        })
    }

    describe('重產工具(test/tools/regen-golden.mjs)', function() {

        this.timeout(180_000)

        let root = ''
        before(() => {
            root = tmpRoot('extract-golden-plan')
        })
        after(() => removeRoots([root]))

        it('只重產可重產之組:可重產之組恰為中立基準(VARIANTS 之 writable)、覆寫重現之組不在其內', () => {
            // 規則:檔頭【覆寫重現之 16 檔為何不可重產】、regen-golden 檔頭【只重產可重產之組】
            assert.deepEqual([...GOLDEN_WRITABLE_DIRS], VARIANTS.filter((v) => v.writable).map((v) => v.dir))
            assert.ok(VARIANTS.some((v) => !v.writable && v.dir === 'extract-override') && !GOLDEN_WRITABLE_DIRS.includes('extract-override'))
            assert.equal(fs.readdirSync(path.join(GOLDEN, 'extract-override')).filter((f) => f.endsWith('.txt')).length, 16, '覆寫重現之基準 16 檔皆在')
        })

        it('計畫之判準(goldenPlanOf):產出有而基準無＝新增、內容不同＝改動、相同、基準有而產出無＝多出(只列)', () => {
            // 規則:regen-golden 檔頭【預演為預設】(列出會新增／改動之檔與多出之檔)
            const staged = `${root}/staged`
            const golden = `${root}/golden`
            for (const d of [staged, golden]) fs.mkdirSync(d, { recursive: true })
            fs.writeFileSync(`${staged}/a.txt`, '甲', 'utf8')
            fs.writeFileSync(`${staged}/b.txt`, '乙改', 'utf8')
            fs.writeFileSync(`${staged}/c.txt`, '丙', 'utf8')
            fs.writeFileSync(`${golden}/b.txt`, '乙', 'utf8')
            fs.writeFileSync(`${golden}/c.txt`, '丙', 'utf8')
            fs.writeFileSync(`${golden}/d.txt`, '丁', 'utf8')
            fs.writeFileSync(`${golden}/note.md`, '非基準檔', 'utf8')
            assert.deepEqual(goldenPlanOf(staged, golden), { added: ['a.txt'], changed: ['b.txt'], same: ['c.txt'], extra: ['d.txt'] })
        })

        it('預演(未設 GOLDEN_WRITE):以現行實作重產之中立基準與基準檔 0 差、不寫任何檔、暫存根刪除;覆寫組照常比對而過', function() {
            // 規則:中立基準為預設詞彙之產出,現行實作與之逐字同(提示詞未改);預演不寫(regen-golden 檔頭)
            if (process.env.GOLDEN_OUT) this.skip() // 本案由重產工具內層之 mocha 執行時略過(否則遞迴)
            const lines = []
            const before = fs.readdirSync(path.join(GOLDEN, 'extract')).map((f) => [f, fs.statSync(path.join(GOLDEN, 'extract', f)).mtimeMs])
            const r = regenGolden({ write: false, log: (s) => lines.push(s) })
            assert.equal(r.ok, true, r.error)
            assert.deepEqual([r.plans.extract.added, r.plans.extract.changed, r.plans.extract.extra], [[], [], []], lines.join('\n'))
            assert.equal(r.plans.extract.same.length, 16)
            assert.deepEqual(r.wrote, [])
            assert.deepEqual(fs.readdirSync(path.join(GOLDEN, 'extract')).map((f) => [f, fs.statSync(path.join(GOLDEN, 'extract', f)).mtimeMs]), before, '基準檔未被寫')
            assert.ok(lines.some((l) => /預演\(未寫入/.test(l)))
        })
    })
})
