// unit-maint.test.mjs — 維運與索引:知識庫索引/關聯總覽(frontmatter 轉義)、人工筆記入庫、核心重練、dead 回填
// 執行:npx mocha test/unit-maint.test.mjs(暫存落 test/_tmp/maint-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { rebuildKnowledgeIndex } from '../src/stages/indexStage.mjs'
import { rebuildRelationIndex } from '../src/stages/relateStage.mjs'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'
import { regenCore, listCores } from '../src/ops/regenCore.mjs'
import { reviveDeadDocs, deadMatcher } from '../src/ops/reviveDocs.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { parseFrontmatter, readMd, writeMd } from '../src/md/md.mjs'
import { createClock } from '../src/util/clock.mjs'
import { memStore } from './tools/memStore.mjs'

const TMP = path.resolve(`test/_tmp/maint-${process.pid}`).replace(/\\/g, '/') // cwd 相對(自套件根執行);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const clock = createClock('Asia/Taipei')
const NOW = '2026-09-23T10:00:00+08:00'

describe('unit-maint', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    it('知識庫索引:frontmatter 經 renderFrontmatter——標題含雙引號仍可解析回原值(此前手寫不轉義,2026-09-23 修);核心依篇數、類別依篇數排序', async () => {
        const dir = `${TMP}/idx`
        fs.mkdirSync(dir, { recursive: true })
        const stores = {
            notes: memStore([
                { id: 'n1', title: '筆記一', category: '方法與技術', concepts: ['c'], evidenceLevel: '中', caveats: ['樣本小'], createdAt: '2026-09-01' },
                { id: 'n2', title: '筆記二', category: '方法與技術', concepts: ['c'], createdAt: '2026-09-02' },
                { id: 'n3', title: '筆記三', category: '其他', concepts: [], createdAt: '2026-09-03' },
            ]),
            cores: memStore([{ id: 'k1', concept: '小', version: 1, noteCount: 2, essence: 'e1' }, { id: 'k2', concept: '大', version: 3, noteCount: 9, essence: 'e2' }]),
            relations: memStore([{ id: 'e1' }]),
        }
        const r = await rebuildKnowledgeIndex({ stores, dir, nowIso: NOW, title: '我的"知識"庫' })
        assert.deepEqual(r, { notes: 3, cores: 2, edges: 1 })
        const { front, body } = parseFrontmatter(fs.readFileSync(`${dir}/index.md`, 'utf8'))
        assert.deepEqual([front.title, front.type, front.updated, front.notes, front.cores, front.relations], ['我的"知識"庫', 'index', NOW, 3, 2, 1])
        assert.match(body.trimStart(), /^# 我的"知識"庫/, 'frontmatter 後之正文以 H1 起頭')
        assert.ok(body.indexOf('[[k2]]') < body.indexOf('[[k1]]'), '核心依篇數降冪')
        assert.ok(body.indexOf('### 方法與技術（2）') < body.indexOf('### 其他（1）'), '類別依篇數降冪')
        assert.match(body, /- \[\[n1\]\] 筆記一｜證據:中｜⚠1｜概念：c/)
        await rebuildKnowledgeIndex({ stores, dir, nowIso: NOW })
        assert.equal(parseFrontmatter(fs.readFileSync(`${dir}/index.md`, 'utf8')).front.title, '知識庫索引', '未給 title 用領域中立之預設')
    })

    it('關聯總覽:frontmatter 可解析回原值、graph.json 全量;導覽依連結數排序並限量(indexTopN)', async () => {
        const dir = `${TMP}/rel`
        fs.mkdirSync(dir, { recursive: true })
        const stores = {
            notes: memStore([{ id: 'a', title: 'A', concepts: [] }, { id: 'b', title: 'B', concepts: [] }, { id: 'c', title: 'C', concepts: [] }]),
            relations: memStore([
                { id: 'r1', from: 'a', to: 'b', type: '互補搭配', reason: 'x' },
                { id: 'r2', from: 'c', to: 'b', type: '衝突或反例', reason: 'y' },
            ]),
        }
        await rebuildRelationIndex(stores, { dir, nowIso: NOW, indexTopN: 2, indexTitle: '總覽"一"' })
        const { front, body } = parseFrontmatter(fs.readFileSync(`${dir}/index.md`, 'utf8'))
        assert.deepEqual([front.title, front.type, front.edges, front.nodes, front.shown], ['總覽"一"', 'relation-index', 2, 3, 2])
        assert.match(body.trimStart(), /^# 總覽"一"/, 'frontmatter 後之正文以 H1 起頭')
        assert.ok(body.indexOf('## B') >= 0 && body.indexOf('## B') < body.indexOf('## A'), '連結數最多者(B:2)排最前')
        const g = JSON.parse(fs.readFileSync(`${dir}/graph.json`, 'utf8'))
        assert.equal(g.edges.length, 2)
        assert.equal(g.nodes.length, 3)
    })

    it('ingestNotes:筆記＋doc(noted)入庫;重複 URL 略過;筆記檔已存在略過且留訊息(此前靜默,2026-09-23 修);欄位不全略過', async () => {
        const deps = { stores: { docs: memStore(), notes: memStore() }, dirs: { notes: `${TMP}/notes` }, clock, domain: createExtractDomain({}) }
        const item = { url: 'https://e.com/a?utm_source=x', sourceName: 'S', note: { title: '人工筆記', key_points: ['k'], concepts: ['c'], summary: 's', category: '方法與技術' } }
        const r1 = await ingestNotes(deps, [item, { url: 'https://e.com/b', note: { title: '缺概念', key_points: ['k'] } }])
        assert.deepEqual([r1.added, r1.dup, r1.bad], [1, 0, 1])
        const note = (await deps.stores.notes.select())[0]
        assert.equal(note.category, '方法與技術')
        assert.equal(readMd(note.file).front.title, '人工筆記')
        const doc = (await deps.stores.docs.select())[0]
        assert.deepEqual([doc.status, doc.url], ['noted', 'https://e.com/a'], 'doc 主鍵與管線同一算法(解轉址＋正規化)')
        const r2 = await ingestNotes(deps, [item])
        assert.deepEqual([r2.added, r2.dup], [0, 1])
        assert.match(r2.messages[0], /已在庫（noted）/)
        // docs 集合換新(如去重庫重建)但筆記檔仍在:不覆寫既有筆記,且須留訊息
        const r3 = await ingestNotes({ ...deps, stores: { docs: memStore(), notes: memStore() } }, [item])
        assert.deepEqual([r3.added, r3.dup], [0, 1])
        assert.match(r3.messages[0], /筆記檔已存在（.+\.md），略過：人工筆記/)
    })

    it('regenCore:刪核心 md 與索引記錄、清相關筆記 distilledAt;找不到回 notFound;listCores 依篇數降冪', async () => {
        const file = `${TMP}/core/k1.md`
        writeMd(file, { title: 'x' }, 'body')
        const deleted = []
        const cores = memStore([{ id: 'k1', concept: 'Transformer 架構', version: 3, noteCount: 5, file }, { id: 'k2', concept: '其他', version: 1, noteCount: 9, file: `${TMP}/core/none.md` }])
        cores.raw = {
            del: async (find) => {
                deleted.push(find.id)
            }
        }
        const notes = memStore([{ id: 'n1', concepts: ['transformer架構'], distilledAt: 'x' }, { id: 'n2', concepts: ['別的'], distilledAt: 'y' }])
        const stores = { cores, notes }
        assert.deepEqual((await listCores(stores)).map((c) => c.id), ['k2', 'k1'])
        const r = await regenCore(stores, 'TRANSFORMER架構')
        assert.equal(r.ok, true)
        assert.deepEqual([r.concept, r.version, r.availableNotes], ['Transformer 架構', 3, 1], '以 normalizeConcept 比對(大小寫/空白不敏感)')
        assert.ok(!fs.existsSync(file), '核心 md 已刪')
        assert.deepEqual(deleted, ['k1'], '核心索引記錄已刪')
        assert.equal((await notes.get('n1')).distilledAt, '', '相關筆記 distilledAt 清空(重練後統計正確)')
        assert.equal((await notes.get('n2')).distilledAt, 'y')
        const nf = await regenCore(stores, '不存在的概念')
        assert.deepEqual([nf.ok, nf.notFound], [false, true])
    })

    it('reviveDeadDocs/deadMatcher:依主機名(含子網域)與失敗原因回填 dead→new、fetchTries 歸零、revivedFrom 留痕;dryRun 不寫;match 必填', async () => {
        const docs = memStore([
            { id: 'd1', status: 'dead', url: 'https://www.msn.com/a', lastError: 'HTTP 403', fetchTries: 3 },
            { id: 'd2', status: 'dead', url: 'https://other.com/b', lastError: 'HTTP 403', fetchTries: 3 },
            { id: 'd3', status: 'new', url: 'https://www.msn.com/c', fetchTries: 1 },
        ])
        const m = deadMatcher({ host: 'msn.com' })
        assert.equal(m({ url: 'https://www.msn.com/x' }), true, '子網域命中')
        assert.equal(m({ url: 'https://notmsn.com/x' }), false, '同尾綴之他網域不命中')
        assert.equal(deadMatcher({})({ url: 'https://msn.com' }), false, '未給任何條件不命中(避免全量回填)')
        const dry = await reviveDeadDocs({ docs }, { match: m, nowIso: NOW, dryRun: true })
        assert.deepEqual([dry.dead, dry.matched, dry.revived], [2, 1, 0])
        assert.equal((await docs.get('d1')).status, 'dead', 'dryRun 不寫')
        const r = await reviveDeadDocs({ docs }, { match: deadMatcher({ error: '403' }), nowIso: NOW })
        assert.deepEqual([r.matched, r.revived], [2, 2])
        const d1 = await docs.get('d1')
        assert.deepEqual([d1.status, d1.fetchTries, d1.revivedFrom, d1.revivedAt], ['new', 0, 'HTTP 403', NOW])
        await assert.rejects(() => reviveDeadDocs({ docs }, {}), /需要 match/)
    })

})
