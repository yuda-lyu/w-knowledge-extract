// unit-extract-registry.test.mjs — 提煉檢定標準之全集(standards/registry)之欄位完整性與單一來源
// 規則(出自 standards/registry 檔頭):
//   ①每條標準一列定義(id、標題、對象、kind、版本、能證明／不能證明、執行處、是否掃描、掃描說明);全集為 ES1～ES17;欄序固定、全集與各列凍結
//   ②執行處為「套件內檔案:函數」:檔存在、檔內宣告該名(讀檔＋正則)、且 import 後為函數;各標準之寫入入口皆列(起草之 3+3、待審裁決、
//     爭議覆核之拆解、出處支持存量覆核、程式寫入、各專步、存量處置、還原撤回、掃描——依實際之碼)
//   ③版本單一來源:逐件判定之標準之 id、標題、kind 與版本取自 CORE_STANDARDS;ES8、ES9、ES11、ES14 之 id 與版本取自其判定模組;
//     ES7 無獨立版本(v 為 null);ES10 為 1
//   ④scan 為 true 者＝EXTRACT_AUDITED_STANDARD_IDS(依全集之序)＝CORE_STANDARDS 之 id;AI 列＝EXTRACT_AI_STANDARD_IDS(ES8、ES9、ES11、ES14);
//     不掃者寫明理由;掃描報告之標題、kind、版本、對象取自全集
//   ⑤標題、對象、能證明／不能證明、掃描說明為中立措辭(不含特定產業領域之詞彙、不指他工作之套件名、不指執行端之指令或帳本代號);
//     ES4 之明示字樣取 ANNOTATION_UNSTATED、ES15 之期限取 EXTRACT_HOLD_DEADLINE_DAYS(不另寫)
//   ⑥不經納入閘之寫入入口(EXTRACT_UNGATED_WRITE_ENTRIES:回退與機械寫入)之形狀;寫入站點(store.save、.restore、.archive、archiveAs、writeMd)之
//     反向盤點:所在之頂層函數 ⊆ 各標準之執行處 ∪ 不經納入閘之寫入入口(判準自檢)
// 執行:自套件根 npx mocha test/unit-extract-registry.test.mjs(只讀檔與 import,不寫檔、不連網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { memStore, DOMAIN_TERM_RE, lexSource, sourceFilesOf } from './tools/captureForTest.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'
import { CORE_STANDARDS, ANNOTATION_UNSTATED } from '../src/standards/coreStandards.mjs'
import { ES8 } from '../src/standards/orphanCheck.mjs'
import { ES9 } from '../src/standards/supportCheck.mjs'
import { ES11 } from '../src/standards/synonymCheck.mjs'
import { ES14 } from '../src/standards/disputeCheck.mjs'
import { EXTRACT_HOLD_DEADLINE_DAYS } from '../src/stores/extractHolds.mjs'
import { EXTRACT_STANDARDS, EXTRACT_UNGATED_WRITE_ENTRIES, EXTRACT_AUDITED_STANDARD_IDS, EXTRACT_AI_STANDARD_IDS } from '../src/standards/registry.mjs'
import { auditExtractStandards, EXTRACT_AUDITED_STANDARD_IDS as AUDITED_FROM_AUDIT } from '../src/standards/audit.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IDS = Array.from({ length: 17 }, (_, i) => `ES${i + 1}`)
const KEY_ORDER = ['id', 'title', 'object', 'kind', 'v', 'proves', 'notProves', 'enforcedAt', 'scan', 'scanNote']
const TEXT_KEYS = ['title', 'object', 'proves', 'notProves', 'scanNote']
const byId = (id) => EXTRACT_STANDARDS.find((s) => s.id === id)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 檔案內宣告該名稱(函數宣告、const／let／var、或 export { … }):以讀檔＋正則驗
const declares = (src, name) => [
    new RegExp(`(^|\\n)\\s*(export\\s+)?(async\\s+)?function\\s*\\*?\\s*${esc(name)}\\s*\\(`),
    new RegExp(`(^|\\n)\\s*(export\\s+)?(const|let|var)\\s+${esc(name)}\\s*=`),
    new RegExp(`export\\s*\\{[^}]*\\b${esc(name)}\\b[^}]*\\}`),
].some((r) => r.test(src))
// 寫入站點之樣式(反向盤點):核心狀態之寫入(store.save)、回退(.restore)、封存(.archive／archiveAs)、核心 md(writeMd)
const WRITE_SITE_RE = /\bstore\.save\(|\.restore\(|\.archive\(|\barchiveAs\(|\bwriteMd\(/g
// 儲存之實作(save 與 archiveAs 之定義處;不是寫入入口)
const WRITE_IMPL = 'stores/coreStore.mjs'

/**
 * 套件之原始碼(src/ 下;相對 src/;略過 node_modules;抓取套件之共用走訪 sourceFilesOf,經 captureForTest)
 *
 * @returns {Array} 回傳相對 src/ 之路徑陣列(排序)
 */
const libSources = () => sourceFilesOf(path.join(PKG, 'src'))

/**
 * 一檔之寫入站點:去註解之程式碼中合於 WRITE_SITE_RE 者;所在之頂層宣告(行首之 function／const／let)即其入口
 *
 * @param {String} file 輸入檔(相對套件根)
 * @param {String} src 輸入原始碼
 * @returns {Array} 回傳 [{ entry:'檔:函數', line }]
 */
function writeSitesOf(file, src) {
    const out = []
    let owner = ''
    lexSource(src).code.split('\n').forEach((l, i) => {
        const m = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+|const\s+|let\s+)([A-Za-z_$][\w$]*)/.exec(l)
        if (m) owner = m[1]
        for (const x of l.matchAll(WRITE_SITE_RE)) if (x) out.push({ entry: `${file}:${owner}`, line: i + 1 })
    })
    return out
}

// 他工作之套件名(上游以「筆記」「邊」「關聯」稱之,不指他套件)
const OTHER_PKGS = /摘要套件|抓取套件|關聯套件|w-knowledge-(capture|summarize|relate)/
// 執行端之指令、帳本代號、專案之路徑
const PROJECT_REFS = /\b(REL|STD|GEN|SUM|CAP|EXT|OPS)-\d|規則帳本|srcPack|CLI|standards (audit|waive|retry)|restore-claim|regen-core|extract-baseline|--[a-z]/

describe('unit-extract-registry', function() {

    it('全集為 ES1～ES17(依序、不重複)', () => {
        assert.deepEqual(EXTRACT_STANDARDS.map((s) => s.id), IDS)
    })

    it('每條標準之欄位齊全且型別正確、欄序固定;全集與各列(含執行處)皆凍結', () => {
        assert.ok(Object.isFrozen(EXTRACT_STANDARDS))
        for (const s of EXTRACT_STANDARDS) {
            assert.ok(Object.isFrozen(s) && Object.isFrozen(s.enforcedAt), `${s.id} 凍結`)
            assert.deepEqual(Object.keys(s), KEY_ORDER, `${s.id} 欄序`)
            for (const k of ['id', ...TEXT_KEYS]) assert.ok(typeof s[k] === 'string' && s[k].trim().length > 0, `${s.id}.${k} 須為非空字串(能證明／不能證明與不掃之理由皆須寫明)`)
            assert.ok(['program', 'ai'].includes(s.kind), `${s.id}.kind=${s.kind}`)
            assert.ok(s.id === 'ES7' ? s.v === null : Number.isInteger(s.v) && s.v > 0, `${s.id}.v=${s.v}`)
            assert.equal(typeof s.scan, 'boolean', `${s.id}.scan`)
            assert.ok(Array.isArray(s.enforcedAt) && s.enforcedAt.length > 0, `${s.id} 須有執行處`)
        }
        assert.throws(() => {
            EXTRACT_STANDARDS[0].title = 'x'
        }, TypeError, '凍結之列不可改')
        assert.throws(() => {
            EXTRACT_STANDARDS[0].enforcedAt.push('x')
        }, TypeError, '凍結之執行處不可改')
    })

    it('kind:ES7、ES9、ES11、ES14 為 AI 判定;其餘為程式判定(ES8 之隔離為程式判定、找支持之專步列於 AI 列)', () => {
        const kinds = Object.fromEntries(EXTRACT_STANDARDS.map((s) => [s.id, s.kind]))
        for (const id of ['ES7', 'ES9', 'ES11', 'ES14']) assert.equal(kinds[id], 'ai', id)
        for (const id of IDS.filter((x) => !['ES7', 'ES9', 'ES11', 'ES14'].includes(x))) assert.equal(kinds[id], 'program', id)
    })

    it('執行處:每條皆為「套件內檔案:函數」——檔存在、檔內宣告該名、import 後為函數;路徑相對套件根、不含 ..、不重複', async () => {
        let n = 0
        const mods = new Map()
        for (const s of EXTRACT_STANDARDS) {
            assert.equal(new Set(s.enforcedAt).size, s.enforcedAt.length, `${s.id} 執行處不重複`)
            for (const ref of s.enforcedAt) {
                n++
                const m = /^([A-Za-z0-9_./-]+\.mjs):([A-Za-z_$][\w$]*)$/.exec(ref)
                assert.ok(m, `${s.id} 執行處格式「檔案:函數」:${ref}`)
                const [, file, name] = m
                assert.ok(!file.split('/').includes('..') && !path.isAbsolute(file), `${ref} 須為相對 src/ 之路徑`)
                const abs = path.join(PKG, 'src', file)
                assert.ok(fs.existsSync(abs), `${s.id} 執行處之檔不存在:${ref}`)
                assert.ok(declares(fs.readFileSync(abs, 'utf8'), name), `${s.id} 執行處之名未宣告於檔內:${ref}`)
                if (!mods.has(abs)) mods.set(abs, await import(pathToFileURL(abs).href))
                assert.equal(typeof mods.get(abs)[name], 'function', `${s.id} 執行處 import 後須為函數:${ref}`)
            }
        }
        assert.ok(n >= EXTRACT_STANDARDS.length * 3, '走訪須真涵蓋各執行處')
        // 對照:宣告檢查須真能分辨有無(否則上列恆過)
        assert.equal(declares('function foo() {}', 'foo'), true)
        assert.equal(declares('export const foo = () => {}', 'foo'), true)
        assert.equal(declares('// function foo() {}', 'foo'), false, '註解中之宣告不算')
        assert.equal(declares('const x = 1', 'foo'), false)
    })

    it('執行處涵蓋各寫入入口:逐件判定之標準列判定與掃描;新進之標準列納入閘、起草之 3+3 與待審裁決;ES1 列不變式與各程式寫入;ES3／ES5 列存量處置;AI 標準列其判定模組、專步與 domain', () => {
        for (const id of EXTRACT_AUDITED_STANDARD_IDS) {
            for (const ref of ['standards/coreStandards.mjs:checkCore', 'standards/audit.mjs:auditExtractStandards']) assert.ok(byId(id).enforcedAt.includes(ref), `${id} 須列${ref}`)
        }
        const GATE = ['standards/opStandards.mjs:createOpStandards', 'workflow/runPass.mjs:runPass', 'workflow/pending.mjs:runPending']
        for (const id of ['ES2', 'ES4', 'ES12', 'ES13', 'ES16', 'ES17']) for (const ref of GATE) assert.ok(byId(id).enforcedAt.includes(ref), `${id}:${ref}`)
        for (const ref of ['stores/coreState.mjs:checkInvariants', 'stores/coreDelta.mjs:applyDelta', 'stores/coreProjection.mjs:programWriteProblems', 'stores/coreProjection.mjs:coreWriterOf', 'workflow/disputePass.mjs:runDisputePass', 'workflow/supportStockPass.mjs:runSupportStockPass', 'workflow/orphanPass.mjs:runOrphanPass', 'ops/reviveClaims.mjs:reviveClaims', 'standards/stockFix.mjs:applyCoreStockFix']) assert.ok(byId('ES1').enforcedAt.includes(ref), `ES1:${ref}`)
        for (const id of ['ES3', 'ES5']) for (const ref of ['standards/coreStockFix.mjs:coreFixOf', 'standards/stockFix.mjs:planCoreStockFix', 'standards/stockFix.mjs:applyCoreStockFix']) assert.ok(byId(id).enforcedAt.includes(ref), `${id}:${ref}`)
        assert.ok(byId('ES3').enforcedAt.includes('standards/opGuards.mjs:guardOps'), 'ES3 列守門之轉正體')
        for (const ref of ['standards/conflictDisposition.mjs:conflictDisposedOf', 'standards/coreStandards.mjs:es5CtxOf', 'workflow/relationContext.mjs:relationContextRows']) assert.ok(byId('ES5').enforcedAt.includes(ref), `ES5:${ref}`)
        for (const ref of ['stores/coreState.mjs:essenceNeedOf', 'workflow/runPass.mjs:runPass']) assert.ok(byId('ES6').enforcedAt.includes(ref), `ES6:${ref}`)
        for (const ref of ['standards/supportRevise.mjs:runSupportRevise', 'workflow/supportStockPass.mjs:runSupportStockPass']) assert.ok(byId('ES7').enforcedAt.includes(ref), `ES7:${ref}`)
        for (const ref of ['stores/coreState.mjs:withdrawSources', 'standards/orphanCheck.mjs:runOrphanCheck', 'workflow/orphanPass.mjs:runOrphanPass', 'ops/reviveClaims.mjs:reviveClaims']) assert.ok(byId('ES8').enforcedAt.includes(ref), `ES8:${ref}`)
        for (const ref of ['standards/supportCheck.mjs:runSupportCheck', 'standards/supportStock.mjs:stockNeedsOf', 'stores/coreState.mjs:holdItems', 'stores/coreState.mjs:setExcluded', 'ops/reviveClaims.mjs:reviveClaims']) assert.ok(byId('ES9').enforcedAt.includes(ref), `ES9:${ref}`)
        for (const ref of ['standards/relationImpact.mjs:impactOfCore', 'standards/relationImpact.mjs:applyImpact', 'standards/recheck.mjs:recheckItemsOf']) assert.ok(byId('ES10').enforcedAt.includes(ref), `ES10:${ref}`)
        for (const ref of ['standards/synonymCheck.mjs:runSynonymCheck', 'stages/synonymStep.mjs:runSynonymStep']) assert.ok(byId('ES11').enforcedAt.includes(ref), `ES11:${ref}`)
        for (const ref of ['standards/disputeCheck.mjs:runDisputeCheck', 'workflow/disputePass.mjs:runDisputePass']) assert.ok(byId('ES14').enforcedAt.includes(ref), `ES14:${ref}`)
        for (const ref of ['stages/extractChain.mjs:mwPersistState', 'stages/extractStage.mjs:extractPromptId']) assert.ok(byId('ES15').enforcedAt.includes(ref), `ES15:${ref}`)
        for (const id of ['ES7', 'ES9', 'ES11', 'ES14']) assert.ok(byId(id).enforcedAt.includes('domain/extractDomain.mjs:createExtractDomain'), `${id} 列提示詞之 domain`)
    })

    it('版本單一來源:逐件判定之標準之 id、標題、kind 與版本取自 CORE_STANDARDS;ES8、ES9、ES11、ES14 之版本取自判定模組;ES7 為 null、ES10 為 1', () => {
        for (const d of CORE_STANDARDS) assert.deepEqual([byId(d.id)?.title, byId(d.id)?.v, byId(d.id)?.kind], [d.title, d.v, d.kind], d.id)
        assert.deepEqual([byId(ES8.std).v, byId(ES9.std).v, byId(ES11.std).v, byId(ES14.std).v], [ES8.v, ES9.v, ES11.v, ES14.v])
        assert.deepEqual([byId('ES7').v, byId('ES10').v], [null, 1])
    })

    it('掃描旗標與掃描器一致:scan 為 true 者即 EXTRACT_AUDITED_STANDARD_IDS(依全集之序)＝CORE_STANDARDS 之 id;AI 列＝EXTRACT_AI_STANDARD_IDS;不掃者寫明理由;掃描報告之標題、kind、版本、對象取自全集', async () => {
        assert.deepEqual(EXTRACT_AUDITED_STANDARD_IDS, EXTRACT_STANDARDS.filter((s) => s.scan).map((s) => s.id))
        assert.deepEqual([...EXTRACT_AUDITED_STANDARD_IDS], CORE_STANDARDS.map((s) => s.id))
        assert.equal(AUDITED_FROM_AUDIT, EXTRACT_AUDITED_STANDARD_IDS, '掃描模組轉出同一份')
        assert.ok(Object.isFrozen(EXTRACT_AUDITED_STANDARD_IDS) && Object.isFrozen(EXTRACT_AI_STANDARD_IDS))
        assert.deepEqual([...EXTRACT_AI_STANDARD_IDS], ['ES8', 'ES9', 'ES11', 'ES14'])
        for (const id of EXTRACT_AI_STANDARD_IDS) assert.match(byId(id).scanNote, new RegExp(`ai\\.${id}\\b`), `${id} 之掃描說明載明 AI 列`)
        for (const s of EXTRACT_STANDARDS.filter((x) => !x.scan)) assert.match(s.scanNote, /^未掃:/, `${s.id} 寫明不掃之理由`)
        const rep = await auditExtractStandards({ stores: { notes: memStore([]), cores: memStore([]), relations: memStore([]), holds: memStore([]), checks: memStore([]) }, dirs: { core: 'c', state: 's' }, domain: createExtractDomain({}), relateDomain: { conflictType: '衝突' } })
        assert.deepEqual(Object.keys(rep.standards), [...EXTRACT_AUDITED_STANDARD_IDS])
        for (const [id, b] of Object.entries(rep.standards)) {
            const s = byId(id)
            assert.deepEqual([b.id, b.title, b.kind, b.v, b.object, b.module], [s.id, s.title, s.kind, s.v, s.object, 'extract'], id)
        }
        assert.deepEqual(Object.keys(rep.ai), [...EXTRACT_AI_STANDARD_IDS])
        for (const [id, a] of Object.entries(rep.ai)) {
            const s = byId(id)
            assert.deepEqual([a.id, a.title, a.kind, a.v, a.object, a.module], [s.id, s.title, s.kind, s.v, s.object, 'extract'], id)
        }
    })

    it('標題、對象、能證明／不能證明、掃描說明為中立措辭:不含特定產業領域之詞彙(中英)、不指他套件之名、不指執行端之指令或帳本代號;ES4 之字樣與 ES15 之期限取常數;規則自檢', () => {
        const bad = []
        for (const s of EXTRACT_STANDARDS) {
            for (const k of TEXT_KEYS) {
                for (const [name, re] of [['領域詞彙', DOMAIN_TERM_RE], ['他套件', OTHER_PKGS], ['執行端', PROJECT_REFS]]) if (re.test(s[k])) bad.push(`${s.id}.${k}〔${name}〕${s[k].slice(0, 60)}`)
            }
        }
        assert.deepEqual(bad, [])
        assert.ok(byId('ES4').proves.includes(`「${ANNOTATION_UNSTATED}」`), 'ES4 之明示字樣取常數')
        assert.ok(byId('ES15').proves.includes(`期限 ${EXTRACT_HOLD_DEADLINE_DAYS} 天`), 'ES15 之期限取常數')
        // 規則自檢:詞表真能抓到
        assert.ok(DOMAIN_TERM_RE.test('主張提及回測之年化報酬'))
        assert.ok(OTHER_PKGS.test('交摘要套件處置') && PROJECT_REFS.test('見 EXT-03') && PROJECT_REFS.test('standards audit --json'))
    })

    it('不經納入閘之寫入入口(回退與機械寫入;刻意):每列 { entry, kind, why },entry 為「套件內檔案:函數」(檔存在、宣告、import 後為函數);kind 只 undo／mechanical;凍結;回退入口不列於各標準之執行處', async () => {
        assert.ok(Object.isFrozen(EXTRACT_UNGATED_WRITE_ENTRIES) && EXTRACT_UNGATED_WRITE_ENTRIES.every(Object.isFrozen))
        assert.deepEqual(EXTRACT_UNGATED_WRITE_ENTRIES.map((x) => [x.entry, x.kind]), [
            ['standards/stockFix.mjs:rollbackCoreStockFix', 'undo'], ['ops/regenCore.mjs:regenCore', 'mechanical'], ['ops/rollbackCore.mjs:rollbackCore', 'undo'], ['stores/coreState.mjs:releaseHeld', 'mechanical'],
            ['standards/stockFix.mjs:edgeSeenSyncOf', 'mechanical'], ['stores/coreProjection.mjs:writeProjections', 'mechanical'], ['stores/coreProjection.mjs:repairCore', 'mechanical'],
            ['stores/coreProjection.mjs:settleTwins', 'mechanical'],
        ])
        for (const x of EXTRACT_UNGATED_WRITE_ENTRIES) {
            assert.deepEqual(Object.keys(x), ['entry', 'kind', 'why'])
            assert.ok(typeof x.why === 'string' && x.why.trim().length > 0, x.entry)
            const [file, name] = x.entry.split(':')
            const abs = path.join(PKG, 'src', file)
            assert.ok(fs.existsSync(abs) && declares(fs.readFileSync(abs, 'utf8'), name), x.entry)
            assert.equal(typeof (await import(pathToFileURL(abs).href))[name], 'function', x.entry)
            for (const [k, re] of [['領域詞彙', DOMAIN_TERM_RE], ['他套件', OTHER_PKGS], ['執行端', PROJECT_REFS]]) assert.ok(!re.test(x.why), `${x.entry}〔${k}〕`)
        }
        for (const s of EXTRACT_STANDARDS) assert.ok(!s.enforcedAt.includes('standards/stockFix.mjs:rollbackCoreStockFix'), `${s.id}:回退不列於執行處`)
    })

    it('寫入站點之反向盤點:非測試原始碼中 store.save(／.restore(／.archive(／archiveAs(／writeMd( 之站點,其所在之頂層函數 ⊆ 各標準之執行處 ∪ 不經納入閘之寫入入口(儲存之實作 stores/coreStore 除外);判準自檢', () => {
        const allowed = new Set([...EXTRACT_STANDARDS.flatMap((s) => s.enforcedAt), ...EXTRACT_UNGATED_WRITE_ENTRIES.map((x) => x.entry)])
        const sites = libSources().filter((f) => f !== WRITE_IMPL).flatMap((f) => writeSitesOf(f, fs.readFileSync(path.join(PKG, 'src', f), 'utf8')))
        assert.ok(sites.length >= 10, `寫入站點過少(走訪空轉?):${sites.length}`)
        assert.deepEqual([...new Set(sites.filter((s) => !allowed.has(s.entry)).map((s) => s.entry))], [], '寫入站點所在之函數未列於執行處或不經納入閘之寫入入口')
        // 判準自檢:各樣式皆抓得到、所在之頂層函數取對、註解內者不計
        const probe = writeSitesOf('x/probe.mjs', [
            'export function a() {', '    env.store.save(id, s)', '}',
            'export const b = () => defineMw({', '    handle: async () => writeMd(f, x, y),', '})',
            'async function c() {', '    await writer.restore(o)', '    store.archive(id, t, s)', '}',
            '// store.save(在註解內)',
            'function d() {', '    return archiveAs(id)', '}',
        ].join('\n'))
        assert.deepEqual(probe.map((s) => s.entry), ['x/probe.mjs:a', 'x/probe.mjs:b', 'x/probe.mjs:c', 'x/probe.mjs:c', 'x/probe.mjs:d'])
    })
})
