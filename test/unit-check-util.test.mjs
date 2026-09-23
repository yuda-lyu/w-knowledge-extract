// unit-check-util.test.mjs — 型別檢查與 JSDoc 新增之驗證(util 群組):
//   util/clock、util/records、util/text、util/web、md/md、fetchers/articleParse、fetchers/endpoints、fetchers/runJsonCli、fetchers/siteAdapters
// 執行:npx mocha test/unit-check-util.test.mjs
// 不發網路:fetchArticle／fetchArticleLinks／discoverFeed 僅測「url／siteUrl 非有效字串」之無效輸入路徑(不觸發任何 HTTP 請求)。
// runJsonCli 一案會真的 spawn 暫存 node 腳本(test/_tmp/check-util-<pid>,after 清除)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createClock, createTime } from '../src/util/clock.mjs'
import { sourceId, docRecord, defaultToRecord, defaultToLinkedRecord } from '../src/util/records.mjs'
import { sha1, normalizeConcept, slugify, setConceptFold } from '../src/util/text.mjs'
import { normalizeUrl, unwrapNewsUrl } from '../src/util/web.mjs'
import { renderFrontmatter, parseFrontmatter, writeMd, readMd, section, sectionOf, dropSection } from '../src/md/md.mjs'
import { fetchArticle, fetchArticleLinks, discoverFeed } from '../src/fetchers/articleParse.mjs'
import { gridSourceUrl, bingNewsSearchUrl, expandSeeds } from '../src/fetchers/endpoints.mjs'
import { runJsonCli, makeLineEmitter } from '../src/fetchers/runJsonCli.mjs'
import { mergeSiteAdapters } from '../src/fetchers/siteAdapters.mjs'

const TMP = path.resolve(`test/_tmp/check-util-${process.pid}`).replace(/\\/g, '/') // 帶 pid 後綴,多個代理並行執行互不干擾

describe('unit-check-util', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ── util/clock.mjs ──

    it('createClock：timeZone 非有效字串拋錯(訊息含 IANA)；有效字串回傳正確物件', () => {
        assert.throws(() => createClock(), /IANA/)
        assert.throws(() => createClock(123), /IANA/)
        assert.throws(() => createClock(''), /IANA/)
        const c = createClock('Asia/Taipei')
        assert.equal(c.timeZone, 'Asia/Taipei')
        assert.equal(c.getDay('20260818120000'), '20260818')
        assert.equal(c.formatTime('20260818214408'), '2026/08/18 21:44')
    })

    it('createTime：省略 timeZone 時預設 Asia/Taipei；有效輸入行為不變', () => {
        assert.equal(createTime().timeZone, 'Asia/Taipei')
        assert.equal(createTime('UTC').timeZone, 'UTC')
    })

    // ── util/records.mjs ──

    it('sourceId：kind／url 維持容錯(非字串亦不拋錯)；有效輸入可重現', () => {
        const a = sourceId('rss', 'https://e.com/feed?utm_source=x')
        assert.equal(a, sourceId('rss', 'https://e.com/feed?utm_source=x'))
        assert.equal(a.length, 40)
        assert.doesNotThrow(() => sourceId(undefined, undefined))
        assert.doesNotThrow(() => sourceId(123, {}))
    })

    it('docRecord：fields／src 非物件拋錯；opt 非物件視為{}；有效輸入形狀不變', () => {
        assert.throws(() => docRecord(null, { id: 's' }), /docRecord 需要 fields 與 src 物件/)
        assert.throws(() => docRecord({ url: 'x' }, null), /docRecord 需要 fields 與 src 物件/)
        assert.throws(() => docRecord('bad', 'bad'), /docRecord 需要 fields 與 src 物件/)
        const r = docRecord({ url: 'https://e.com/a', title: 'T' }, { id: 's1', name: 'S' }, 'bad-opt')
        assert.equal(r.collectedAt, '', 'opt 非物件視為{}，nowIso 回退空字串')
        const r2 = docRecord({ url: 'https://e.com/a', title: 'T' }, { id: 's1', name: 'S' }, { nowIso: '2026-09-23T00:00:00+08:00' })
        assert.deepEqual([r2.url, r2.title, r2.sourceId, r2.status, r2.collectedAt], ['https://e.com/a', 'T', 's1', 'new', '2026-09-23T00:00:00+08:00'])
    })

    it('defaultToRecord／defaultToLinkedRecord：工廠回傳函數，形狀正確(grid 來源另補 raw 相關欄位)', () => {
        const clock = createClock('Asia/Taipei')
        const toRecord = defaultToRecord({ settings: { fetch: { maxTextChars: 100 } }, clock })
        const rec = toRecord({ url: 'https://e.com/a', title: 'T', text: 'x'.repeat(10) }, { source: { id: 's1', name: 'S', kind: 'rss' } })
        assert.equal(rec.sourceId, 's1')
        assert.equal(rec.status, 'new')
        const recGrid = toRecord({ url: 'https://e.com/g', title: 'G', summary: 'abstract' }, { source: { id: 's2', name: 'S2', kind: 'grid' } })
        assert.equal(recGrid.status, 'raw')
        assert.equal(recGrid.textFrom, 'abstract')
        const toLinked = defaultToLinkedRecord({ clock })
        const linked = toLinked({ url: 'https://e.com/b', text: 'L' }, { sourceId: 's1', sourceName: 'S', id: 'mother1', publishedAt: '2026-01-01' })
        assert.equal(linked.sourceId, 's1:linked')
        assert.equal(linked.fromDocId, 'mother1')
    })

    // ── util/text.mjs ──

    it('sha1：委派 str2sha；空／null／undefined 輸入回空字串', () => {
        assert.equal(sha1('hello'), 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
        assert.equal(sha1(undefined), '')
        assert.equal(sha1(null), '')
    })

    it('normalizeConcept：全形轉半形、去空白、英文小寫，未注入折疊時原樣回傳', () => {
        assert.equal(normalizeConcept('  注意力 機制 '), '注意力機制')
        assert.equal(normalizeConcept('Risk（測度）'), 'risk測度')
    })

    it('setConceptFold：注入函數後 normalizeConcept 套用折疊；傳非函數即清除(還原預設行為)', () => {
        setConceptFold((t) => t.replace(/风/g, '風'))
        assert.equal(normalizeConcept('风险'), '風险')
        setConceptFold('not-a-function') // 傳非函數 → 清除(視同 null)
        assert.equal(normalizeConcept('风险'), '风险', '傳非函數即清除折疊')
        setConceptFold(null) // 還原，避免影響本檔其他案例(模組層級共用狀態)
    })

    it('slugify：保留中英數、尾綴 8 碼雜湊；省略 seed 時以 title 雜湊(可重現)；title／seed 皆空時仍符合格式', () => {
        assert.equal(slugify('Hello World'), 'hello-world-0a4d55a8')
        assert.equal(slugify('Transformer 注意力機制！！', 'k1'), 'transformer-注意力機制-a2ab1959')
        assert.match(slugify(''), /^note-[0-9a-f]{8}$/, 'title／seed 皆空時退回亂數，但格式仍須符合')
    })

    // ── util/web.mjs ──

    it('normalizeUrl：去 hash／追蹤參數／尾斜線；非字串 fail-safe 轉字串回傳,不拋錯', () => {
        assert.equal(normalizeUrl('https://a.com/x/?utm_source=y&b=2#frag'), 'https://a.com/x/?b=2')
        assert.doesNotThrow(() => normalizeUrl(undefined))
        assert.equal(normalizeUrl(undefined), '')
    })

    it('unwrapNewsUrl：解開 Bing News apiclick 轉址；非字串 fail-safe 轉字串回傳,不拋錯', () => {
        assert.equal(unwrapNewsUrl('https://www.bing.com/news/apiclick.aspx?ref=x&url=https%3A%2F%2Fe.com%2Fa'), 'https://e.com/a')
        assert.doesNotThrow(() => unwrapNewsUrl(undefined))
        assert.equal(unwrapNewsUrl(undefined), '')
    })

    // ── md/md.mjs ──

    it('renderFrontmatter：front 非物件視為{}；有效輸入輸出正確區塊', () => {
        assert.equal(renderFrontmatter('bad'), '---\n---')
        assert.equal(renderFrontmatter({ title: 'T', tags: ['a', 'b'], n: 3, ok: true }), '---\ntitle: "T"\ntags: ["a", "b"]\nn: 3\nok: true\n---')
    })

    it('parseFrontmatter：還原純量與字串陣列；無 frontmatter 區塊時 front 為空、body 為全文', () => {
        const { front, body } = parseFrontmatter('---\ntitle: "T"\ntags: ["a", "b"]\n---\n\n內文')
        assert.deepEqual(front, { title: 'T', tags: ['a', 'b'] })
        assert.equal(body, '\n內文')
        const p2 = parseFrontmatter('no frontmatter here')
        assert.deepEqual(p2.front, {})
        assert.equal(p2.body, 'no frontmatter here')
    })

    it('writeMd：file 非有效字串拋錯；front 非物件視為{}；body 非字串視為""(F17 修:此前寫入字面 "undefined")', () => {
        assert.throws(() => writeMd(undefined, {}, 'x'), /writeMd 需要 file（檔案路徑字串）/)
        assert.throws(() => writeMd(123, {}, 'x'), /writeMd 需要 file（檔案路徑字串）/)

        const f1 = `${TMP}/f17.md`
        writeMd(f1, { title: 'X' }, undefined)
        const c1 = fs.readFileSync(f1, 'utf8')
        assert.doesNotMatch(c1, /undefined/, 'F17:body 為 undefined 時不得把字面 undefined 寫入筆記')
        assert.equal(c1, '---\ntitle: "X"\n---\n\n\n')

        const f2 = `${TMP}/badfront.md`
        writeMd(f2, 'bad-front', 'body ok')
        assert.equal(fs.readFileSync(f2, 'utf8'), '---\n---\n\nbody ok\n')

        const f3 = `${TMP}/valid.md`
        writeMd(f3, { title: 'A' }, '# A\n\n內文')
        assert.equal(fs.readFileSync(f3, 'utf8'), '---\ntitle: "A"\n---\n\n# A\n\n內文\n')
    })

    it('readMd：file 非有效字串回 null；讀不到檔回 null；有效檔案讀回 front/body', () => {
        assert.equal(readMd(undefined), null)
        assert.equal(readMd(123), null)
        assert.equal(readMd(`${TMP}/not-exist.md`), null)
        const f = `${TMP}/read.md`
        writeMd(f, { title: 'R' }, 'body')
        const r = readMd(f)
        assert.equal(r.front.title, 'R')
        assert.equal(r.body.trim(), 'body')
    })

    it('section：content 為陣列時過濾空白項並轉清單；空內容回傳空字串', () => {
        assert.equal(section('重點', ['a', '', 'b']), '## 重點\n\n- a\n- b')
        assert.equal(section('重點', ''), '')
    })

    it('sectionOf／dropSection：找出/移除指定 H2 章節,不動其他章節', () => {
        const body = '前言\n\n## 甲\n\n內容甲\n\n## 乙\n\n內容乙'
        assert.deepEqual(sectionOf(body, '甲'), { start: 4, end: 14, text: '## 甲\n\n內容甲\n' })
        assert.equal(sectionOf('無此章節', '甲'), null)
        assert.equal(dropSection(body, '甲'), '前言\n\n## 乙\n\n內容乙')
    })

    // ── fetchers/articleParse.mjs(僅測無效輸入路徑,不發網路)──

    it('fetchArticle：url 非有效字串回 {ok:false, reason:"invalid-url"}，不發網路；options 非物件視為{}', async () => {
        const r1 = await fetchArticle(undefined)
        assert.equal(r1.ok, false)
        assert.equal(r1.reason, 'invalid-url')
        const r2 = await fetchArticle(123, 'bad-options')
        assert.equal(r2.ok, false)
        assert.equal(r2.reason, 'invalid-url')
        const r3 = await fetchArticle('')
        assert.equal(r3.ok, false)
        assert.equal(r3.reason, 'invalid-url')
    })

    it('fetchArticleLinks：url 非有效字串回 {ok:false, reason:"invalid-url"}，不發網路', async () => {
        const r = await fetchArticleLinks(null)
        assert.equal(r.ok, false)
        assert.equal(r.reason, 'invalid-url')
    })

    it('discoverFeed：siteUrl 非有效字串回 {ok:false, message}，不發網路', async () => {
        const r = await discoverFeed(NaN)
        assert.equal(r.ok, false)
        assert.equal(typeof r.message, 'string')
    })

    // ── fetchers/endpoints.mjs ──

    it('gridSourceUrl：query 非有效字串拋錯；有效字串組出識別 URL', () => {
        assert.throws(() => gridSourceUrl(undefined), /gridSourceUrl 需要 query/)
        assert.throws(() => gridSourceUrl(123), /gridSourceUrl 需要 query/)
        assert.equal(gridSourceUrl('deep learning'), 'grid://openalex/deep%20learning')
    })

    it('bingNewsSearchUrl：keyword 非字串 fail-safe 轉字串,不拋錯；有效字串組出查詢 URL', () => {
        assert.doesNotThrow(() => bingNewsSearchUrl(undefined))
        assert.equal(bingNewsSearchUrl(undefined), 'https://www.bing.com/news/search?q=&format=rss')
        assert.equal(bingNewsSearchUrl('a b'), 'https://www.bing.com/news/search?q=a%20b&format=rss')
    })

    it('expandSeeds：data／opt 非物件視為{}；seedSources／gridTopics 非陣列視為[]；有效輸入展開正確', () => {
        assert.deepEqual(expandSeeds('bad', 'bad'), [])
        assert.deepEqual(expandSeeds({ seedSources: 'bad', gridTopics: 'bad' }), [])
        const seeds = expandSeeds({ seedSources: [{ kind: 'rss', url: 'https://e.com/feed', tier: 1, name: 'S' }], gridTopics: [['模型評估', 'model evaluation']] }, { nowIso: '2026-09-23T00:00:00+08:00' })
        assert.deepEqual(seeds.map((s) => s.kind), ['rss', 'grid'])
        assert.equal(seeds[1].url, 'grid://openalex/model%20evaluation')
        assert.equal(seeds[1].id, sourceId('grid', 'grid://openalex/model%20evaluation'))
        assert.equal(seeds[1].addedAt, '2026-09-23T00:00:00+08:00')
    })

    it('expandSeeds：gridTopics 項目不合 [標籤,查詢] 字串對即拋錯,訊息含索引', () => {
        assert.throws(() => expandSeeds({ gridTopics: [['ok', 'ok'], ['bad-only-one']] }), /cfg\.data\.gridTopics\[1\] 須為 \[標籤, 查詢\] 字串對/)
        assert.throws(() => expandSeeds({ gridTopics: [{}] }), /cfg\.data\.gridTopics\[0\] 須為 \[標籤, 查詢\] 字串對/)
        assert.throws(() => expandSeeds({ gridTopics: [['', 'q']] }), /cfg\.data\.gridTopics\[0\]/)
    })

    // ── fetchers/runJsonCli.mjs ──

    it('makeLineEmitter：onLine 非函數拋錯；prefix 非字串視為""(全收)；有效輸入行為不變', () => {
        assert.throws(() => makeLineEmitter('not-a-fn', ''), /makeLineEmitter 需要 onLine 函數/)
        const lines = []
        const feed = makeLineEmitter((l) => lines.push(l), '[x]')
        feed('[x]a\n[y]b\n[x]c')
        feed('d\n')
        assert.deepEqual(lines, ['[x]a', '[x]cd'])
        const lines2 = []
        const feed2 = makeLineEmitter((l) => lines2.push(l), 123) // prefix 非字串
        feed2('hello\n')
        assert.deepEqual(lines2, ['hello'], 'prefix 非字串時視為""(全收)')
    })

    it('runJsonCli：opt 非物件視為{}；script／outputPath 缺漏依既定訊息拋錯(不可改)', async () => {
        await assert.rejects(() => runJsonCli('bad-opt'), /需要 script/)
        await assert.rejects(() => runJsonCli({ outputPath: 'x' }), /需要 script/)
        await assert.rejects(() => runJsonCli({ script: 'x' }), /需要 outputPath/)
    })

    it('runJsonCli：args 非陣列視為[]，不因 spread 而崩潰；有效 args 陣列之子進程正常寫回 JSON', async () => {
        const script = `${TMP}/cli-check.mjs`
        fs.writeFileSync(script, [
            'import fs from \'node:fs\';',
            'const out = process.argv[process.argv.length - 1];',
            'fs.writeFileSync(out, JSON.stringify({ status: \'ok\', argc: process.argv.length }));',
        ].join('\n'), 'utf8')
        const r1 = await runJsonCli({ script, args: 'not-an-array', outputPath: `${TMP}/out-badargs.json`, timeoutMs: 15000 })
        assert.equal(r1.status, 'ok', 'args 非陣列時視為[]，不崩潰、子進程正常執行')
        const r2 = await runJsonCli({ script, args: ['a', 'b'], outputPath: `${TMP}/out-goodargs.json`, timeoutMs: 15000 })
        assert.equal(r2.status, 'ok')
        assert.equal(r2.argc, r1.argc + 2, '有效 args 陣列正確展開為子進程參數')
    })

    // ── fetchers/siteAdapters.mjs ──

    it('mergeSiteAdapters：defaults 非陣列時回退 DEFAULT_SITE_ADAPTERS；有效輸入合併行為不變', () => {
        const mine = { id: 'x', match: /x\.com/, parse: () => ({ success: false }) }
        assert.deepEqual(mergeSiteAdapters('bad', [mine]).map((a) => a.id), ['x'], 'defaults 非陣列時回退為 DEFAULT_SITE_ADAPTERS(空)')
        assert.deepEqual(mergeSiteAdapters(undefined, [mine]).map((a) => a.id), ['x'])
        const own = { id: 'y', match: /y\.com/, parse: () => ({ success: false }) }
        assert.deepEqual(mergeSiteAdapters([own], [mine]).map((a) => a.id), ['x', 'y'], '有效 defaults 之合併行為不變')
    })

})
