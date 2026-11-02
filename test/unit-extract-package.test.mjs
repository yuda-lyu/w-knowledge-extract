// unit-extract-package.test.mjs — 套件結構測試:邊界(三個單一匯入點)、package.json 之依賴與實際 import 對帳、撞名、舊名不出現、預設領域中立
//
// 【佈局】原始碼全在 src/(主入口 src/WKnowledgeExtract.mjs);套件根另有 g.mjs(範例)、toolg/(編譯與文件工具)、test/;下文路徑除註明外皆相對套件根
// ① 邊界:套件內全部 .mjs(排除 node_modules、test/_tmp 與產物夾 tmp、dist、docs)之 import 只限套件內相對路徑、npm 套件,以及三個單一匯入點——抓取埠
//   src/core/capturePackage.mjs、摘要埠 src/core/summarizePackage.mjs、關聯埠 src/core/relatePackage.mjs(各只指向其上游之主入口);測試專用之三個橋接
//   (test/tools/{captureForTest,summarizeForTest,relateForTest}.mjs;另可取上游之共用測試件 test/tools/*,如領域中立詞表)亦許可;
//   不得引用專案既有程式與資料;非測試檔不引用 test/ 下之檔;
//   本套件之 src/core/ 不得有與三上游之 core/ 同相對路徑之檔(三埠之檔名以清單豁免);三埠所列之名皆存在於上游主入口且為同一實體
//   (以埠之指定詞解析出之主入口動態載入、取其鍵集——驗證用,不經橋接)
//   【指定詞以骨架比對】先剝註解與字串(抓取套件之 test/tools/sourceScan 之 specifiersOf,經 captureForTest)再比對 import／export 之形式(掃描器自檢釘住)
// ② package.json:名稱與入口、scripts 為 test(mocha 標準指令)與 deploy;dependencies＝src/ 實際 import 之 npm 套件＋三套件(經匯入點)、devDependencies＝
//   測試與編譯工具(g.mjs、toolg/)另 import 者(測試執行器 mocha 經 scripts.test 呼叫、不 import,隨編譯工具套件 w-package-tools 安裝;wsemi 自帶之依賴依自有套件之慣例不列);
//   三上游之版本合於所列範圍;入口可載入;發布面(main 指向 dist 之 UMD、不設 exports 與 files,使下游得以「套件名/src/…」與「套件名/test/tools/…」深層路徑取用;
//   不提供 .npmignore〔npm 包＝git 版控內容,依 .gitignore〕,npm pack --dry-run 之清單含 sgud/ 與 test/tools/、不含 CLAUDE*.md 與暫存;LICENSE 為 MIT);範例 g.mjs 離線可執行且 README 含其全文;
//   發布內容(README、*.csv、非測試 .mjs 與隨包發布之 test/tools/*.mjs)不含宿主之痕跡:磁碟機絕對路徑與使用者目錄
// ③ 撞名:本套件入口之具名匯出 ∩ 三上游主入口之具名匯出＝∅(判準自檢);唯一例外為總組裝之鍵集名(CFG_KEYS 等四名:四套件之總組裝依同一慣例
//   各匯出自己之一份,任何匯入點皆不轉出——例外須仍有對象:上游主入口皆有、本套件之四名出自總組裝、三埠皆不列);各公開模組之預設匯出之鍵。
//   【入口之四條規則不在此】具名＝預設、無 undefined 成員、全部公開模組之具名匯出掛入入口、入口成員恰為其聯集——唯一家在 unit-extract-entry
// ④ 舊名、沿革與面向使用者之字樣:非測試原始碼(含 bench)、隨包發布之 test/tools/*.mjs、package.json 與 README 逐行不命中舊之套件名、總組裝名與入口名(錨定之正則;新名
//   不命中——判準自檢)、沿革指標與宿主之指令;字串字面與 README 不含宿主之指令與帳本代號(判準取抓取套件之 test/tools/historyMarks);
//   判定小組未成立原因之舊字樣與字樣表之字面不出現(一律取摘要套件之 PANEL_WHY_LABELS)
// ⑤ 預設領域中立:非測試、非評分之原始碼(含註解、JSDoc 與字串)、隨包發布之 test/tools/*.mjs(負對照夾具 quantVocab.mjs 具名豁免)、package.json 與
//   README 不含特定產業領域之詞彙(bench/ 之原始碼與題組在 unit-extract-bench ⑥——同一份不掃兩處;詞表本身之自檢在抓取套件之 unit-domain-terms,
//   本檔只驗中立題材不被誤傷＋一個正向對照);預設設定、預設詞彙與零設定組裝之 info() 之值亦然。持久化之值以具名例外列明
//   (例外須仍有對象且只在程式行、不在註解;過時即須移除)
// ⑥ 層序:core ← guards ← stores ← standards(根之 logContract 同層)← workflow ← { stages, ops };stages 與 ops 互不引用;domain、bench 為葉
//   (自身可取全部;各層不得取);根檔(入口、總組裝、物件、執行期件)不被各層取;三埠視為外部。全部非測試原始碼之相對 import(含 export … from)
//   違反之邊＝0、檔級無環(DFS);判準自檢(合成之 import 清單與圖)
// ⑦ 區域同名件:非測試原始碼之頂層與巢狀函數型宣告(同審計盤查工具之判準),逐字同之跨檔同名＝0(同一規則一份——收斂為共用件);各自語意之
//   跨檔同名列白名單(名＋理由),白名單之名須仍為跨檔同名(過時即移除);判準自檢(合成之原始碼)
// 執行:在套件根 node <mocha> test/unit-extract-package.test.mjs(掃描為唯讀;〈打包清單〉執行 npm pack --dry-run、〈範例 g.mjs〉於 test/_tmp 暫存夾執行;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isBuiltin } from 'node:module'
import * as CapturePort from '../src/core/capturePackage.mjs'
import * as SummarizePort from '../src/core/summarizePackage.mjs'
import * as RelatePort from '../src/core/relatePackage.mjs'
import WKnowledgeExtract, * as NS from '../src/WKnowledgeExtract.mjs'
import { resolveExtractSettings, EXTRACT_DEFAULT, EXTRACT_AI_DEFAULT } from '../src/core/extractSettings.mjs'
import { EXTRACT_VOCAB_DEFAULT, resolveExtractVocab, extractGuideDefaultOf } from '../src/core/vocab/extractVocab.mjs'
import {
    specifiersOf, lexSource, exportedNamesOf, namedImportsOf, domainTermsIn, HOST_CLI, historyHitsOf, userTextHitsOf, historyScanOf, userTextScanOf, benchCaseNotesOf,
    sourceFilesOf,
} from './tools/captureForTest.mjs'
import { blankAi } from './tools/extractKit.mjs'
import { resetConceptFold, tmpRoot, removeRoots } from './tools/extractTestKit.mjs'

/** 套件根(以本檔位置推導,與 cwd 無關) */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')

/** 宿主之痕跡:磁碟機絕對路徑(盤符＋反斜線;字串字面中之跳脫形亦含)與使用者目錄 */
const HOST_PATH = /\b[A-Za-z]:\\|\/Users\/|C:\/Users/
/** 宿主之名(專案名與其通知管道;本套件為通用套件,發布內容不得提及) */
const HOST_NAME = /tai-kns|telegram/i

// ═══════════════════════ 掃描工具 ═══════════════════════

/**
 * 套件內全部指定副檔名之檔(預設 .mjs;相對路徑,正斜線,排序;略 node_modules、test/_tmp——並行之他測試會建立與刪除其內之檔案——與產物夾 tmp、dist、docs):
 *   抓取套件之共用走訪 sourceFilesOf(經 captureForTest;各守門同一份走訪)
 *
 * @param {String} [ext='.mjs'] 輸入副檔名
 * @returns {Array} 回傳相對路徑陣列
 */
const sourceFiles = (ext = '.mjs') => sourceFilesOf(ROOT, { ext, exclude: ['tmp', 'dist', 'docs'] })

/** 讀檔;讀取當下已被他行程刪除者回 null */
function readText(rel) {
    try {
        return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    }
    catch {
        return null
    }
}

/**
 * 三個單一匯入點:檔、測試專用之橋接、套件名、主入口、原始碼根(入口所在)與套件根(package.json 所在)——依匯入點之指定詞解析:
 *   已安裝之 npm 套件(「套件名/src/入口檔」;local 為 false)或相對路徑(本地套件;入口在其根)、埠之命名空間
 *
 * @type {Object}
 */
const PORTS = Object.fromEntries([
    ['capture', { label: '抓取套件', file: 'src/core/capturePackage.mjs', bridge: 'test/tools/captureForTest.mjs', pkg: 'w-knowledge-capture', entryName: 'WKnowledgeCapture.mjs', ns: CapturePort }],
    ['summarize', { label: '摘要套件', file: 'src/core/summarizePackage.mjs', bridge: 'test/tools/summarizeForTest.mjs', pkg: 'w-knowledge-summarize', entryName: 'WKnowledgeSummarize.mjs', ns: SummarizePort }],
    ['relate', { label: '關聯套件', file: 'src/core/relatePackage.mjs', bridge: 'test/tools/relateForTest.mjs', pkg: 'w-knowledge-relate', entryName: 'WKnowledgeRelate.mjs', ns: RelatePort }],
].map(([k, p]) => {
    const spec = specifiersOf(readText(p.file) || '')[0] || ''
    const local = spec.startsWith('.')
    const entry = (local ? path.resolve(ROOT, 'src/core', spec) : fileURLToPath(import.meta.resolve(spec))).replace(/\\/g, '/')
    const root = path.dirname(entry)
    const pkgRoot = local ? root : path.dirname(fileURLToPath(import.meta.resolve(`${p.pkg}/package.json`))).replace(/\\/g, '/')
    return [k, { ...p, spec, local, entry, root, pkgRoot, entrySpec: `${p.pkg}/src/${p.entryName}` }]
}))

/** 上游主入口(動態載入;驗證用) */
const entryOf = async (p) => import(pathToFileURL(p.entry).href)

/** 專案內不屬本套件之目錄名:指定詞以之起頭即引用專案既有程式或資料 */
const PROJECT_DIRS = ['srcPack', 'src', 'test', 'data', 'srcRunner', 'srcCapture', 'srcSummarize', 'srcRelate']

/**
 * 分類一個指定詞
 *
 * @param {String} file 輸入引用者(相對套件根)
 * @param {String} spec 輸入指定詞
 * @returns {Object} 回傳 { kind:'builtin'|'relative'|'package', pkg?:套件名, problem?:問題說明 }
 */
function classify(file, spec) {
    if (spec.startsWith('node:') || isBuiltin(spec)) return { kind: 'builtin' }
    if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
        const target = path.resolve(path.dirname(path.join(ROOT, file)), spec).replace(/\\/g, '/')
        const rel = path.relative(ROOT, target).replace(/\\/g, '/')
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            // 三套件只經匯入點(與測試專用之橋接)取用,且指向其主入口:其指定詞即該套件(移植後為 npm 套件名);
            //   測試專用之橋接另可取該套件之共用測試件(其 test/tools/ 下,如四套件同一份之領域中立詞表)
            for (const p of Object.values(PORTS)) {
                if ((file === p.file || file === p.bridge) && target === p.entry && fs.existsSync(target)) return { kind: 'package', pkg: p.pkg }
                if (file === p.bridge && (`${target}/`).startsWith(`${p.root}/test/tools/`) && fs.existsSync(target)) return { kind: 'package', pkg: p.pkg }
            }
            const port = Object.values(PORTS).find((p) => (`${target}/`).startsWith(`${p.root}/`))
            return { kind: 'relative', problem: `相對 import 跑出套件根 → ${spec}${port ? `(取${port.label}須經 ${port.file},且指向其主入口;測試專用之橋接另可取其 test/tools/)` : ''}` }
        }
        if (!fs.existsSync(target)) return { kind: 'relative', problem: `目標不存在 → ${spec}` }
        return { kind: 'relative' }
    }
    if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return { kind: 'package', problem: `絕對路徑或 URL 形式之指定詞 → ${spec}` }
    if (PROJECT_DIRS.some((d) => spec === d || spec.startsWith(`${d}/`))) return { kind: 'package', problem: `引用專案既有程式或資料 → ${spec}` }
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    const port = Object.values(PORTS).find((p) => p.pkg === pkg)
    if (port) {
        // npm 套件之形:匯入點(與橋接)只指向其主入口「套件名/src/入口檔」;測試專用之橋接另可取其共用測試件「套件名/test/tools/<檔>」(須為實有檔)
        if (file !== port.file && file !== port.bridge) return { kind: 'package', pkg, problem: `${port.label}須經單一匯入點 ${port.file} 取用 → ${spec}` }
        if (spec === port.entrySpec) return { kind: 'package', pkg }
        if (file === port.bridge && spec.startsWith(`${pkg}/test/tools/`) && fs.existsSync(path.join(port.pkgRoot, spec.slice(pkg.length + 1)))) return { kind: 'package', pkg }
        return { kind: 'package', pkg, problem: `取${port.label}須指向其主入口 ${port.entrySpec}(測試專用之橋接另可取其 test/tools/)→ ${spec}` }
    }
    return { kind: 'package', pkg }
}

/** 全套件掃描結果(逐檔之指定詞與分類) */
function scanAll() {
    const files = sourceFiles()
    const rows = []
    for (const f of files) {
        const code = readText(f)
        if (code === null) continue
        for (const spec of specifiersOf(code)) rows.push({ file: f, spec, ...classify(f, spec) })
    }
    return { files, rows }
}

/**
 * 埠之轉出清單(上游之原名 → 埠內之名;自 export { … } from 之子句解析,註解已剝)
 *
 * @param {String} file 輸入埠之檔(相對套件根)
 * @returns {Array} 回傳 [{ orig, name }]
 */
function portPairsOf(file) {
    const m = /export\s*\{([^}]*)\}\s*from/.exec(lexSource(readText(file) || '').code)
    if (!m) return []
    return m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const [orig, alias] = s.split(/\s+as\s+/)
        return { orig: orig.trim(), name: (alias || orig).trim() }
    })
}

/** 套件原始碼(src/ 下之 .mjs:公開模組、三埠、入口;相對套件根,即以 src/ 起頭;g.mjs、toolg/ 與測試不計) */
const libFiles = () => sourceFiles().filter((f) => f.startsWith('src/'))

// ═══════════════════════ 層序之判準(葉模型) ═══════════════════════

/** 各層之序(logContract 為根之契約檔,視同 standards) */
const LAYER = Object.freeze({ core: 0, guards: 1, stores: 2, logContract: 3, standards: 3, workflow: 4, stages: 5, ops: 5 })
/** 葉:自身可取全部;各層不得取 */
const LEAF = new Set(['domain', 'bench'])
/** 三埠(上游套件之單一匯入點):視為外部(路徑相對 src/ 或套件根皆可) */
const PORT_FILE_RE = /^(src\/)?core\/(capture|summarize|relate)Package\.mjs$/
/** 層名:路徑(相對 src/ 或套件根)去 src/ 後之第一段;根層檔取去副檔名之檔名 */
const dirOf = (r) => {
    const s = r.replace(/^src\//, '')
    return s.includes('/') ? s.split('/')[0] : s.replace(/\.mjs$/, '')
}
const groupOf = (r) => {
    const d = dirOf(r)
    return d in LAYER || LEAF.has(d) ? d : 'root'
}

/**
 * 一條邊是否違反層序:層內之檔只取同層或更低層、stages 與 ops 互不引用、不取葉、不取根檔;葉與根檔自身可取全部;三埠視為外部
 *
 * @param {String} from 輸入引用者(相對套件根)
 * @param {String} to 輸入被引用者(相對套件根)
 * @returns {Boolean} 回傳是否違反
 */
function layerViolation(from, to) {
    if (PORT_FILE_RE.test(to)) return false
    if (!(dirOf(from) in LAYER)) return false
    const a = groupOf(from)
    const b = groupOf(to)
    if (LEAF.has(b) || b === 'root') return true
    if (a === b) return false
    if ((a === 'stages' && b === 'ops') || (a === 'ops' && b === 'stages')) return true
    return LAYER[b] > LAYER[a]
}

/**
 * 非測試原始碼之相對 import(含 export … from)之邊:指定詞解析後相對套件根;跑出套件根者不計(由①守門)
 *
 * @returns {Array} 回傳 [{ from, to }]
 */
function importEdges() {
    const out = []
    for (const f of libFiles()) {
        const code = readText(f)
        if (code === null) continue
        for (const spec of specifiersOf(code)) {
            if (!spec.startsWith('.')) continue
            const to = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, f)), spec)).replace(/\\/g, '/')
            if (to.startsWith('..')) continue
            out.push({ from: f, to })
        }
    }
    return out
}

/**
 * 檔級之環(DFS;同一環只報一次)
 *
 * @param {Array} edges 輸入 [{ from, to }]
 * @returns {Array} 回傳環之陣列(各為檔之路徑陣列,首尾相同)
 */
function cyclesOf(edges) {
    const adj = new Map()
    for (const e of edges) {
        if (!adj.has(e.from)) adj.set(e.from, [])
        adj.get(e.from).push(e.to)
    }
    const state = new Map() // 1 訪問中、2 已完成
    const stack = []
    const out = []
    const seen = new Set()
    const visit = (n) => {
        state.set(n, 1)
        stack.push(n)
        for (const m of adj.get(n) || []) {
            if (state.get(m) === 1) {
                const cyc = [...stack.slice(stack.indexOf(m)), m]
                const key = cyc.slice(0, -1).sort().join('|')
                if (!seen.has(key)) {
                    seen.add(key)
                    out.push(cyc)
                }
            }
            else if (!state.get(m)) visit(m)
        }
        stack.pop()
        state.set(n, 2)
    }
    for (const n of adj.keys()) if (!state.get(n)) visit(n)
    return out
}

// ═══════════════════════ 區域同名件之判準(同審計盤查工具 dups 之判準) ═══════════════════════

/** 頂層宣告:function／const／let(含 export) */
const DECL_TOP_RE = /^(export\s+)?(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=)/
/** 巢狀宣告:只計函數型(function X、const X = (…) =>、const X = 識別字 =>、const X = async …、const X = function) */
const DECL_NESTED_RE = /^\s+(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b)/

/**
 * 一檔之宣告(頂層與巢狀之函數型):本體取自宣告行起至括號平衡(至多 200 行),去註解、去 export、空白壓成一格後比對
 *
 * @param {String} code 輸入原始碼
 * @returns {Array} 回傳 [{ name, line, norm }]
 */
function declsOf(code) {
    const lines = String(code).split('\n')
    const out = []
    for (let i = 0; i < lines.length; i++) {
        const t = DECL_TOP_RE.exec(lines[i])
        const n = t ? null : DECL_NESTED_RE.exec(lines[i])
        if (!t && !n) continue
        const name = t ? (t[2] || t[3]) : (n[1] || n[2] || n[3])
        const body = [lines[i]]
        let depth = (lines[i].match(/[{([]/g) || []).length - (lines[i].match(/[})\]]/g) || []).length
        for (let k = i + 1; k < lines.length && depth > 0 && k < i + 200; k++) {
            body.push(lines[k])
            depth += (lines[k].match(/[{([]/g) || []).length - (lines[k].match(/[})\]]/g) || []).length
        }
        const norm = body.join('\n').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*export\s+/, '').replace(/\s+/g, ' ').trim()
        out.push({ name, line: i + 1, norm })
    }
    return out
}

/**
 * 跨檔同名之宣告(兩檔以上宣告同一名):逐名列各處與「各處本體是否逐字同」
 *
 * @param {Array} files 輸入 [{ file, code }]
 * @returns {Array} 回傳 [{ name, same:Boolean, locs:Array(檔:行) }](依名排序)
 */
function sameNamesAcross(files) {
    const by = new Map()
    for (const { file, code } of files) for (const d of declsOf(code)) by.set(d.name, [...(by.get(d.name) || []), { ...d, file }])
    return [...by].filter(([, ds]) => new Set(ds.map((d) => d.file)).size >= 2).sort(([a], [b]) => (a < b ? -1 : (a > b ? 1 : 0)))
        .map(([name, ds]) => ({ name, same: new Set(ds.map((d) => d.norm)).size === 1, locs: ds.map((d) => `${d.file}:${d.line}`) }))
}

/**
 * 跨檔同名而各自語意之區域閉包(白名單;名 → 為何不是同一規則)——逐字同之跨檔同名一律不許(同一規則一份:收斂為共用件,P4 小件收斂)。
 *   新增之跨檔同名須先判:同一規則即收斂,各自語意才列入並寫理由;列了而已不再跨檔同名者須移除(自檢)
 *
 * @type {Object}
 */
const LOCAL_SAME_NAMES = Object.freeze({
    add: '各自之累加器:專步排程之 Map 集合、掃描之計數器、檢定問題之列、同義之提議——對象與產物不同',
    closeHolds: '還原撤回之逐主張結案(ops/reviveClaims 之區域件)與提煉段落盤後之逐核心結案(standards/holdSettle 之匯出)——對象與時機不同',
    done: '存量預演之結果組裝(standards/stockFix)與差量操作套用成功之落帳(stores/coreDelta)',
    entryOf: '內容鍵快取之條目(stores/contentCache)與逐棒紀錄之一筆(workflow/aiCall)',
    fail: '動作鏈之失敗落帳(stages/extractChain)與差量操作之拒收(stores/coreDelta)',
    fileOf: '核心狀態檔之路徑(stores/coreStore)與重設基準名單之路徑(stores/rebaseline)',
    finish: '各段之收尾:單核心之步驟序列(stages/extractSteps)與爭議／待審／3+3／存量 pass 之結果組裝——欄位與處置各異',
    fix: '各自之字串改寫:裸代號加括號(standards/opGuards)、引用換號(stores/coreDelta)、@ref 之換名／別名／補 @(workflow/candidates)',
    gate: '各段綁其可見性與換號選項之納入閘閉包(納入閘本體一份:standards/opStandards 之 gateOps);評分題組之判定(standards/esCases)另為逐案',
    has: '各自之成員判定:重審項之理由、出處含某篇、主張被本質引用、筆記在記錄',
    hashOf: '各專步綁其素材之雜湊閉包(雜湊之規則本體各一份:stockHashOf、orphanHashOf、synonymHashOf)',
    idsOf: '存量／失撐專步之本核心到期項(stages/extractSteps,兩專步各取其名單)與重設基準名單之正規化(stores/rebaseline)',
    keyOf: '筆記之內容鍵:還原撤回轉字串供雜湊(ops/reviveClaims)、維護保留 null 以判「md 讀不到」(stages/extractMaintain)——null 之語意不同',
    label: '逐棒日誌之席位標籤(stages/extractChain)與操作之標示(workflow/supportGate)',
    live: '條目非終態之判定(stores/coreDelta,對 findItem 之命中)與存活出處之過濾(stores/evidence)——對象不同',
    load: '存量處置之讀狀態(standards/stockFix)與核心儲存之讀檔(stores/coreStore)',
    markOf: '狀態摘要之附註(stores/stateDigest)與重審項之標示(workflow/runPass)',
    noteOf: '代號 → 筆記 id(standards/supportCheck)、逐棒紀錄之回呼(workflow/aiCall)、裁決說明之單行化(workflow/verdicts)——語意不同',
    onCall: '逐棒紀錄之計數:動作鏈計 aiCalls 與嘗試(stages/extractChain)、同義專步計 synonymCalls(stages/synonymStep)後轉交',
    pick: '夥伴候選之選取(standards/relationImpact)與修訂欄之取值(standards/supportRevise)',
    push: '各自之收集器:條目文字(standards/coreStandards)、操作之文字欄(standards/opGuards)、覆核之受檢項(standards/supportCheck)——形參與產物不同',
    put: '待判登錄之寫入(standards/holdSettle)與問題之累加(standards/opStandards)',
    recOf: '取各自已載入之檢核紀錄(本核心預載之 Map／掃描批次之 Map)之區域閉包,形同 Map.get——無規則可收',
    side: '提示詞之一方文字(domain/extractDomain)與同義雜湊之一方素材(standards/synonymCheck)',
    sideOf: '爭議方之解析(standards/supportCheck)與同義之一方素材之讀取(standards/synonymCheck)',
    srcOf: '差量操作之出處(代號 → 筆記;stores/coreDelta)與裁決涉及之出處聯集(含各方;workflow/verdicts)',
    take: '各自之取用:步驟序列之結果採計(stages/extractSteps)、選篇之名額(stores/noteSelection)、@ref 之收集(workflow/candidates)',
    targetOf: '各自之目標解析:覆核之條目或 @ref(standards/supportCheck)、選題項之組成(stores/conceptSelection)、差量之操作目標(stores/coreDelta)',
    view: '爭議覆核與同義覆核之提示詞之項之投影——欄位各異',
})

// ═══════════════════════ ⑧ 測試檔與發布面之守門之判準 ═══════════════════════

/** 建構即設定模組級之概念折疊者(總組裝、執行期件與測試之總組裝件;其建構依 cfg.conceptFold 呼叫抓取套件之 applyConceptFold) */
const FOLD_BUILDERS_RE = /\b(?:createKnowledgeExtract|createExtractRuntime|buildTestExtractor)\s*\(/

/**
 * 一份測試原始碼對模組級單例(概念折疊)之處置(於骨架上比對:註解與字串之內容不算)
 *
 * @param {String} src 輸入原始碼
 * @returns {Object} 回傳 { sets:Boolean(以非 null 呼叫 setConceptFold 或建構總組裝/執行期件), bare:Number(以 setConceptFold(null) 還原之處數), resets:Boolean(呼叫 resetConceptFold()) }
 */
function foldUseOf(src) {
    const sk = lexSource(src).skeleton
    const args = [...sk.matchAll(/\bsetConceptFold\(\s*([^)]*)\)/g)].map((m) => m[1].trim())
    return { sets: args.some((a) => a !== 'null') || FOLD_BUILDERS_RE.test(sk), bare: args.filter((a) => a === 'null').length, resets: /\bresetConceptFold\(\s*\)/.test(sk) }
}

/**
 * 一組測試檔之單例問題:改動而同檔未以 resetConceptFold() 還原、或以 setConceptFold(null) 還原(還原一律 resetConceptFold;setConceptFold 只留給設定新折疊)
 *
 * @param {Array} docs 輸入 [{ file, src }]
 * @returns {Array} 回傳問題字串陣列
 */
function foldProblemsOf(docs) {
    const bad = []
    for (const { file, src } of docs) {
        const u = foldUseOf(src)
        if (u.sets && !u.resets) bad.push(`${file}:改動模組級之概念折疊而同檔未以 resetConceptFold() 還原`)
        if (u.bare) bad.push(`${file}:以 setConceptFold(null) 還原 ${u.bare} 處(改用 resetConceptFold)`)
    }
    return bad
}

/**
 * 橋接檔之指定詞之歸類(三上游皆為已發布之 npm 套件):上游主入口「<上游套件名>/src/<主入口檔>」為 entry、上游 test/tools 下之實有檔為 tools、其餘無從映射為 other
 *
 * @param {Object} p 輸入埠(PORTS 之值)
 * @param {String} spec 輸入指定詞
 * @returns {String} 回傳 'entry'|'tools'|'other'
 */
const bridgeSpecKindOf = (p, spec) => (spec === p.entrySpec ? 'entry' : (spec.startsWith(`${p.pkg}/test/tools/`) && fs.existsSync(path.join(p.pkgRoot, spec.slice(p.pkg.length + 1))) ? 'tools' : 'other'))

/**
 * README §17 測試表所列之測試檔(第二欄之 `…`;大括號展開:`unit-extract-{a,b}` → unit-extract-a、unit-extract-b)
 *
 * @param {String} readme 輸入 README 全文
 * @returns {Array} 回傳檔名(不含 .test.mjs)陣列
 */
function readmeTestFilesOf(readme) {
    const sec = (String(readme).split(/^## 17\. 測試$/m)[1] || '').split(/^## 18\./m)[0]
    const out = []
    for (const line of sec.split('\n')) {
        if (!/^\|/.test(line) || /^\|\s*-/.test(line)) continue
        const cell = line.split('|')[2] || ''
        for (const [, tok] of cell.matchAll(/`([^`]+)`/g)) {
            const b = /^(.*)\{([^}]*)\}(.*)$/.exec(tok)
            if (b) out.push(...b[2].split(',').map((x) => `${b[1]}${x.trim()}${b[3]}`))
            else out.push(tok)
        }
    }
    return out.filter((x) => /^(unit|api)-/.test(x))
}

/**
 * 測試檔之暫存根問題:字串字面含 test/_tmp(手寫暫存根,綁 cwd 或不經回驗之刪除)者——暫存根一律 tmpRoot(name);呼叫 tmpRoot 者同檔須呼叫 removeRoots
 *
 * @param {Array} docs 輸入 [{ file, src }]
 * @param {Object} exempt 輸入 { 檔: 理由 }(只建構不寫入之路徑等)
 * @returns {Array} 回傳問題字串陣列
 */
function tmpProblemsOf(docs, exempt = {}) {
    const bad = []
    for (const { file, src } of docs) {
        const { strings, skeleton } = lexSource(src)
        if (!exempt[file] && strings.some((t) => /(^|[\\/\u0000])_tmp([\\/\u0000]|$)/.test(t))) bad.push(`${file}:手寫暫存根(字串含 _tmp;改用 tmpRoot)`)
        if (/\btmpRoot\(/.test(skeleton) && !/\bremoveRoots\(/.test(skeleton)) bad.push(`${file}:建了暫存根而未以 removeRoots 刪除並回驗`)
    }
    return bad
}

describe('unit-extract-package', function() {

    this.timeout(120_000)

    // ═══════════════════════ ① 邊界 ═══════════════════════
    describe('① 邊界(只經三個單一匯入點取抓取、摘要與關聯套件;套件須能整份移植)', () => {
        let scan = null
        before(() => {
            scan = scanAll()
        })

        it('掃描器自檢:各種 import 形式皆能取出指定詞;註解(含分號與引號)、字串、樣板與正規表示式字面不干擾;分類器抓得到跑出套件、專案目錄、繞過匯入點與絕對路徑', () => {
            // 動態 import 之固定樣本以拼接組成:本檔自身亦在掃描範圍,不可含完整之 import(...) 字樣
            const fixture = [
                "import a from './a.mjs'",
                'import {',
                '    b, // 註解含;分號與 \'單引號\' 與 "雙引號"',
                "} from '../../srcPack/x.mjs'",
                'export {',
                "    c, // 註解;含 'quote'",
                "} from './c.mjs'",
                "export * from 'wsemi/src/isobj.mjs'",
                "import 'side-effect-pkg'",
                `const m = await ${'imp'}${"ort('../../src/y.mjs')"}`,
                "// import d from 'commented-out'",
                "/* import e from 'in-block' */",
                '/**',
                " * import f from 'in-jsdoc'",
                ' */',
                "const s = \"import g from './in-string.mjs'\"",
                "const t = `import h from './in-template.mjs'`",
                "const u = `x${'y'}\nimport i from './in-template-expr.mjs'\n`",
                "const re = /['\"]/g; import k from './after-regex.mjs'",
                "const z = a / 2; import l from './after-division.mjs'",
            ].join('\n')
            assert.deepEqual(specifiersOf(fixture).sort(), ['../../src/y.mjs', '../../srcPack/x.mjs', './a.mjs', './after-division.mjs', './after-regex.mjs', './c.mjs', 'side-effect-pkg', 'wsemi/src/isobj.mjs'])
            const sk = lexSource("const x = 'import y from \"z\"' // 註解 import w from 'v'\nconst r = /from 'q'/").skeleton
            assert.doesNotMatch(sk, /import|from|註解/)
            assert.match(classify('test/x.test.mjs', '../../srcPack/x.mjs').problem, /跑出套件根/)
            assert.match(classify('src/stages/x.mjs', PORTS.capture.entrySpec).problem, /抓取套件須經單一匯入點 src\/core\/capturePackage\.mjs/)
            assert.match(classify('src/stages/x.mjs', PORTS.summarize.entrySpec).problem, /摘要套件須經單一匯入點 src\/core\/summarizePackage\.mjs/)
            assert.match(classify('src/stages/x.mjs', PORTS.relate.entrySpec).problem, /關聯套件須經單一匯入點 src\/core\/relatePackage\.mjs/)
            assert.match(classify(PORTS.relate.file, `${PORTS.relate.pkg}/src/core/stores/checks.mjs`).problem, /須指向其主入口/, '匯入點只可指向主入口')
            assert.match(classify(PORTS.capture.bridge, `${PORTS.capture.pkg}/src/core/kernel.mjs`).problem, /指向其主入口/, '橋接只可指向主入口')
            assert.match(classify(PORTS.capture.bridge, `${PORTS.capture.pkg}/test/tools/nope.mjs`).problem, /指向其主入口/, '橋接只可取其 test/tools/ 之實有檔')
            assert.match(classify('test/tools/extractKit.mjs', PORTS.relate.entrySpec).problem, /關聯套件須經單一匯入點/, '非橋接之測試件不可取上游')
            for (const p of Object.values(PORTS)) {
                assert.match(classify('src/stages/x.mjs', p.pkg).problem, /須經單一匯入點/)
                assert.deepEqual(classify(p.file, p.spec), { kind: 'package', pkg: p.pkg })
                assert.deepEqual(classify(p.bridge, p.local ? path.relative(path.join(ROOT, 'test/tools'), p.entry).replace(/\\/g, '/') : p.spec), { kind: 'package', pkg: p.pkg })
            }
            assert.match(classify('src/core/x.mjs', '../nope/none.mjs').problem, /目標不存在/)
            for (const s of ['srcPack/core/kernel.mjs', 'srcRunner/WTaskRunner.mjs', 'srcRelate/core/stores/checks.mjs', 'srcSummarize/core/md/md.mjs', 'data/vocab.json']) assert.match(classify('src/core/x.mjs', s).problem, /引用專案既有程式或資料/, s)
            assert.match(classify('src/core/x.mjs', 'C:/proj/a.mjs').problem, /絕對路徑或 URL/)
            assert.deepEqual(classify('src/core/x.mjs', 'wsemi/src/isobj.mjs'), { kind: 'package', pkg: 'wsemi' })
            assert.deepEqual(classify('src/core/x.mjs', 'node:fs'), { kind: 'builtin' })
            assert.deepEqual(classify('src/core/vocab/x.mjs', '../extractSettings.mjs'), { kind: 'relative' })
            for (const f of ['src/WKnowledgeExtract.mjs', 'src/core/extractSettings.mjs', 'src/core/vocab/extractVocab.mjs', PORTS.capture.file, PORTS.summarize.file, PORTS.relate.file,
                PORTS.capture.bridge, PORTS.summarize.bridge, PORTS.relate.bridge, 'test/unit-extract-package.test.mjs', 'test/tools/extractKit.mjs', 'g.mjs', 'toolg/gDistRollup.mjs']) {
                assert.ok(scan.files.includes(f), `掃描須含 ${f}`)
            }
            assert.ok(scan.files.length >= 15 && scan.rows.length >= 30, `掃描量過少：${scan.files.length} 檔／${scan.rows.length} 條指定詞`)
            assert.ok(!scan.files.some((f) => f.includes('node_modules') || f.startsWith('test/_tmp/') || /^(tmp|dist|docs)\//.test(f)), '須排除 node_modules、test/_tmp 與產物夾 tmp、dist、docs')
        })

        it('全部相對 import 解析後不跑出套件根、目標存在;取三套件者只有其單一匯入點(與測試專用之橋接),其目標即該套件之主入口', () => {
            const bad = scan.rows.filter((r) => r.problem).map((r) => `${r.file}：${r.problem}`)
            assert.deepEqual(bad, [])
            for (const p of Object.values(PORTS)) {
                const via = [...new Set(scan.rows.filter((r) => r.pkg === p.pkg).map((r) => r.file))]
                assert.ok(via.includes(p.file), `${p.file} 引用${p.label}`)
                assert.deepEqual(via.filter((f) => f !== p.file && f !== p.bridge), [], `${p.label}只經匯入點與測試橋接`)
                assert.equal(path.basename(p.entry), p.entryName)
                assert.ok(fs.existsSync(p.entry), `${p.label}之主入口存在`)
                assert.deepEqual(specifiersOf(readText(p.file)), [p.spec], `${p.file} 只有一個指定詞(移植時只改此處)`)
                // 橋接指向主入口者只有一個指定詞;另可取該上游之共用測試件(其 test/tools/ 下)
                const viaBridge = p.local ? path.relative(path.join(ROOT, 'test/tools'), p.entry).replace(/\\/g, '/') : p.spec
                const toolsPrefix = p.local ? `${path.relative(path.join(ROOT, 'test/tools'), p.root).replace(/\\/g, '/')}/test/tools/` : `${p.pkg}/test/tools/`
                assert.deepEqual(specifiersOf(readText(p.bridge)).filter((s) => !s.startsWith(toolsPrefix)), [viaBridge], `${p.bridge} 只有一個指定詞指向主入口(另可取其 test/tools/)`)
            }
        })

        it('非測試檔不引用 test/ 下之檔(測試工具與測試專用之橋接只供測試;發布之套件可不帶 test/)', () => {
            const intoTestOf = (rows) => rows.filter((r) => !r.file.startsWith('test/') && r.kind === 'relative' && !r.problem)
                .filter((r) => path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, r.file)), r.spec)).replace(/\\/g, '/').startsWith('test/'))
                .map((r) => `${r.file} → ${r.spec}`)
            const probes = [
                { file: 'src/stages/x.mjs', spec: '../../test/tools/extractKit.mjs' },
                { file: 'test/a.test.mjs', spec: './tools/extractKit.mjs' },
                { file: 'src/core/vocab/x.mjs', spec: '../extractSettings.mjs' },
            ].map((p) => ({ ...p, ...classify(p.file, p.spec) }))
            assert.deepEqual(intoTestOf(probes), ['src/stages/x.mjs → ../../test/tools/extractKit.mjs'], '判準自檢')
            assert.deepEqual(intoTestOf(scan.rows), [])
        })

        it('三埠所列之名皆存在於上游主入口且為同一實體;埠之清單即其命名空間、不重列', async () => {
            for (const p of Object.values(PORTS)) {
                const entry = await entryOf(p)
                const pairs = portPairsOf(p.file)
                assert.ok(pairs.length >= 10, `${p.file}:解析之名過少 ${pairs.length}`)
                assert.deepEqual(pairs.filter((x) => !(x.orig in entry) || entry[x.orig] === undefined).map((x) => x.orig), [], `${p.label}之主入口缺之名`)
                for (const x of pairs) assert.equal(p.ns[x.name], entry[x.orig], `${p.file}:${x.name} 須為上游 ${x.orig} 之同一實體`)
                assert.deepEqual(pairs.map((x) => x.name).sort(), Object.keys(p.ns).sort(), `${p.file}:解析之清單＝埠之命名空間`)
                assert.equal(new Set(pairs.map((x) => x.name)).size, pairs.length, `${p.file}:不重列`)
                assert.deepEqual(Object.keys(p.ns).filter((k) => p.ns[k] === undefined), [], `${p.file}:無 undefined 之名`)
            }
            // 解析之判準自檢:改名之轉出(上游之原名 → 埠內之名)
            assert.deepEqual(portPairsOf(PORTS.capture.file).find((x) => x.name === 'resolveCaptureVocab'), { orig: 'resolveVocab', name: 'resolveCaptureVocab' })
        })

        it('本套件之 src/core/ 與三上游之 core/ 無同相對路徑之檔(三埠之檔名以清單豁免:各套件各自之匯入點,同名而各指其上游)', () => {
            /** 一個原始碼根(src/ 或上游主入口所在夾)下 core/ 之 .mjs(相對 core/) */
            const listCore = (root) => {
                const out = []
                const walk = (rel) => {
                    for (const d of fs.readdirSync(path.join(root, 'core', rel), { withFileTypes: true })) {
                        const r = rel ? `${rel}/${d.name}` : d.name
                        if (d.isDirectory()) walk(r)
                        else if (d.name.endsWith('.mjs')) out.push(r)
                    }
                }
                walk('')
                return out
            }
            const EXEMPT = ['capturePackage.mjs', 'summarizePackage.mjs', 'relatePackage.mjs']
            const mine = listCore(`${ROOT}/src`)
            assert.ok(EXEMPT.every((f) => mine.includes(f)), '前提:三個匯入點在 src/core/')
            assert.ok(mine.includes('extractSettings.mjs') && mine.includes('vocab/extractVocab.mjs'), '前提:本套件之 core/ 有自有之模組')
            for (const p of Object.values(PORTS)) {
                const theirs = new Set(listCore(p.root))
                assert.ok(theirs.size >= 3, `前提:${p.label}之 core/ 有檔`)
                assert.deepEqual(mine.filter((f) => theirs.has(f) && !EXEMPT.includes(f)), [], `與${p.label}之 core/ 同相對路徑之檔`)
            }
            // 判準自檢:上游 core/ 之實有路徑(如關聯之檢核紀錄、摘要之選題詞表)若出現在本套件即被抓到
            const theirsAll = new Set(Object.values(PORTS).flatMap((p) => listCore(p.root)))
            assert.ok(['stores/checks.mjs', 'vocab/conceptGroups.mjs', 'settingsDefault.mjs', 'kernel.mjs'].every((f) => theirsAll.has(f)), '前提:不可用之路徑皆為上游之實有路徑')
        })

        it('三埠只列套件程式碼所需之名:所列每一名,非測試檔至少一檔經該埠具名取用(只供測試之名經測試專用之橋接)', () => {
            // 規則:上層可依賴之面以埠明列之名為準——埠多列只供測試之名,即把測試之需求寫成套件之依賴面(移植時誤以為套件需要)
            // 判準自檢:轉出取對外之名(x as y → y)、匯入取被匯入之名(y as z → y);多行、註解與字串不干擾
            assert.deepEqual(exportedNamesOf("export {\n    a, // 說明;b\n    c as d,\n} from '../x.mjs'\nconst s = \"export { q } from './q.mjs'\""), ['a', 'd'])
            assert.deepEqual(namedImportsOf("import { d as e, a } from '../core/capturePackage.mjs'\n// import { q } from './q.mjs'").map((x) => `${x.spec}:${x.name}`), ['../core/capturePackage.mjs:d', '../core/capturePackage.mjs:a'])
            const lib = libFiles()
            for (const p of Object.values(PORTS)) {
                const names = exportedNamesOf(readText(p.file))
                assert.deepEqual([...names].sort(), Object.keys(p.ns).sort(), `${p.file}:解析之清單＝埠之命名空間`)
                const target = path.join(ROOT, p.file).replace(/\\/g, '/')
                const used = new Set()
                for (const f of lib.filter((x) => x !== p.file)) {
                    const code = readText(f)
                    if (code === null) continue
                    for (const { spec, name } of namedImportsOf(code)) {
                        if (spec.startsWith('.') && path.resolve(path.dirname(path.join(ROOT, f)), spec).replace(/\\/g, '/') === target) used.add(name)
                    }
                }
                assert.deepEqual(names.filter((n) => !used.has(n)), [], `${p.file}:只供測試之名改列 ${p.bridge}`)
            }
        })
    })

    // ═══════════════════════ ② package.json ═══════════════════════
    describe('② package.json', () => {
        const pkg = JSON.parse(fs.readFileSync(`${ROOT}/package.json`, 'utf8'))
        /** 測試執行器(由 scripts.test 呼叫,不被 import;隨編譯工具套件 BUILD_TOOLS 安裝) */
        const TEST_RUNNER = 'mocha'
        /** 編譯與文件工具套件(toolg/ 以 w-package-tools 之 src 深層路徑取用;同自有套件之 devDependencies) */
        const BUILD_TOOLS = 'w-package-tools'
        /** 檔案所屬群組:src/ 為套件原始碼(lib)、test/ 為測試、其餘(g.mjs、toolg/)為範例與編譯工具(tool) */
        const groupOf = (file) => (file.startsWith('test/') ? 'test' : file.startsWith('src/') ? 'lib' : 'tool')

        /**
         * wsemi 自行規定並安裝之依賴:自有套件之慣例是依賴由該自有套件統籌,使用端不重列(自 node_modules 之 wsemi/package.json 讀取,由近而遠)
         *
         * @returns {Set} 回傳套件名集合
         */
        function providedByWsemi() {
            for (let dir = ROOT; ; dir = path.dirname(dir)) {
                const f = `${dir}/node_modules/wsemi/package.json`
                if (fs.existsSync(f)) return new Set(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).dependencies || {}))
                if (path.dirname(dir) === dir) throw new Error('找不到 node_modules/wsemi(須先安裝套件依賴)')
            }
        }

        it('名稱、版本與作者授權(同關聯套件);scripts 為 test(mocha --parallel 之標準指令)與 deploy(文件發布,同自有套件之範本),不增設其他指令', () => {
            // 規則:套件之 package.json 提供 npm test(有 parallel 之標準寫法)與 deploy(gh-pages -d docs;自有套件範本皆有)
            assert.equal(pkg.name, 'w-knowledge-extract')
            assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
            assert.deepEqual(Object.keys(pkg.scripts), ['test', 'deploy'])
            assert.equal(pkg.scripts.test, 'mocha --parallel "test/*.test.mjs" --timeout 180000')
            assert.equal(pkg.scripts.deploy, 'gh-pages -d docs')
            const relatePkg = JSON.parse(fs.readFileSync(`${PORTS.relate.pkgRoot}/package.json`, 'utf8'))
            assert.deepEqual([pkg.author, pkg.license], [relatePkg.author, relatePkg.license])
        })

        it('依賴之組成:三上游、wsemi、寬鬆 JSON 為 dependencies(字形折疊經抓取埠之 cnToTw,不直接依賴 opencc);管線、調度層與 lmdb(測試用)與編譯工具為 devDependencies(測試執行器 mocha 隨編譯工具套件安裝)', () => {
            assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['json5', 'w-knowledge-capture', 'w-knowledge-relate', 'w-knowledge-summarize', 'wsemi'])
            assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['w-data-pipeline', 'w-dispatch-ai', 'w-orm-lmdb', BUILD_TOOLS])
        })

        it('依賴對帳:src/ 之 import 套件＝dependencies(wsemi 自帶者除外;三套件經匯入點);測試與編譯工具(g.mjs、toolg/)另 import 者在 devDependencies;所列者皆有使用者', () => {
            const scan = scanAll()
            const deps = new Set(Object.keys(pkg.dependencies || {}))
            const dev = new Set(Object.keys(pkg.devDependencies || {}))
            const byWsemi = providedByWsemi()
            assert.ok(deps.has('wsemi') && byWsemi.has('lodash-es'), '前提:wsemi 為依賴且其依賴含 lodash-es')
            const used = { lib: new Set(), test: new Set(), tool: new Set() }
            for (const r of scan.rows.filter((x) => x.kind === 'package' && x.pkg && !x.problem)) used[groupOf(r.file)].add(r.pkg)
            const libMissing = [...used.lib].filter((p) => !deps.has(p) && !byWsemi.has(p))
            const devMissing = [...used.test, ...used.tool].filter((p) => !deps.has(p) && !dev.has(p) && !byWsemi.has(p))
            assert.deepEqual([libMissing, devMissing], [[], []], '被 import 之套件須列於 package.json')
            assert.deepEqual([...deps].filter((p) => !used.lib.has(p)), [], 'dependencies 不得有 src/ 未使用者')
            // 測試執行器 mocha 由 scripts.test 呼叫、不被 import:隨編譯工具套件安裝(同自有套件),不在 import 對帳之內,但須可解析
            assert.ok(dev.has(BUILD_TOOLS) && used.tool.has(BUILD_TOOLS), `編譯工具套件 ${BUILD_TOOLS} 須列於 devDependencies 且被 toolg/ 使用`)
            assert.doesNotThrow(() => import.meta.resolve(TEST_RUNNER), `測試執行器 ${TEST_RUNNER} 須已安裝`)
            assert.deepEqual([...dev].filter((p) => !used.test.has(p) && !used.tool.has(p)), [], 'devDependencies 不得有測試與編譯工具未使用者')
            assert.deepEqual([...dev].filter((p) => used.lib.has(p)), [], 'src/ 使用者須列於 dependencies')
            for (const p of [PORTS.capture.pkg, PORTS.summarize.pkg, PORTS.relate.pkg, 'wsemi', 'json5']) assert.ok(used.lib.has(p), `掃描非空洞:${p} 被掃到`)
            assert.ok(used.test.has('w-dispatch-ai'), '掃描非空洞:測試之依賴被掃到')
        })

        it('依賴為 semver 範圍(不指向本機路徑);三上游之實際版本合於所列範圍', () => {
            for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
                assert.match(range, /^[\^~>=<]*\d+\.\d+\.\d+/, `${name} 之版本範圍須為 semver：${range}`)
            }
            for (const p of Object.values(PORTS)) {
                const up = JSON.parse(fs.readFileSync(`${p.pkgRoot}/package.json`, 'utf8'))
                assert.equal(up.name, p.pkg)
                const [maj, min] = up.version.split('.').map(Number)
                const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.dependencies[p.pkg])
                assert.ok(m, pkg.dependencies[p.pkg])
                assert.ok(Number(m[1]) === 0 ? maj === 0 && min === Number(m[2]) : maj === Number(m[1]), `${p.label} ${up.version} 須合於 ${pkg.dependencies[p.pkg]}`)
            }
        })

        it('入口可載入:main 指向 dist 之 UMD(dist 由發布流程產製,不要求存在),ESM 入口 src/WKnowledgeExtract.mjs 存在(具名＝預設等入口之四條規則見 unit-extract-entry,不另寫)', () => {
            // 規則(移植指定詞):自有套件發布後 main 指 UMD、原始碼在 src/,下游一律以「套件名/src/入口檔」取 ESM 入口——
            //   套件不設 exports(設了即擋掉該子路徑與 test/tools 之深層路徑),入口檔須實際存在於 src/
            assert.equal(pkg.main, `dist/${pkg.name}.umd.js`)
            assert.ok(fs.existsSync(`${ROOT}/src/WKnowledgeExtract.mjs`), 'ESM 入口 src/WKnowledgeExtract.mjs 須存在')
            assert.equal(typeof WKnowledgeExtract.createKnowledgeExtract, 'function')
            assert.equal(typeof WKnowledgeExtract.resolveExtractSettings, 'function')
            assert.equal(typeof WKnowledgeExtract.resolveExtractVocab, 'function')
        })

        it('發布面:不設 exports 與 files(下游以深層路徑取用 src/ 與 test/tools/);不提供 .npmignore(npm 包＝git 版控內容,依 .gitignore;.gitignore 列 CLAUDE*.md、不排除 sgud、src、dist、test/tools);套件根範本檔齊備;LICENSE 為 MIT 且署名同作者', () => {
            // 規則:設 exports 即擋掉「套件名/src/…」「套件名/test/tools/…」之深層路徑(下游套件與專案以之取用);設 files 白名單則套件根新增檔案時易漏
            assert.equal(pkg.exports, undefined, '不設 exports')
            assert.equal(pkg.files, undefined, '不設 files(發布範圍＝git 版控內容,由 .gitignore 決定)')
            assert.deepEqual([pkg.repository.type, pkg.repository.url], ['git', 'git+https://github.com/yuda-lyu/w-knowledge-extract.git'])
            assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length >= 3 && typeof pkg.author === 'string' && pkg.author.length > 0, 'keywords 與 author 須有')
            // 發布範圍(使用者 2026-11-01 裁示):預設不提供 .npmignore,npm 包＝git 版控內容(依 .gitignore);只有外部執行檔與單一資料夾 ≥10MB 之非程式碼資料才提供——
            //   本套件兩者皆無(test/、docs/ 皆 <10MB),故不得有 .npmignore(有則 npm 不再讀 .gitignore);sgud/(經驗、處理要點、規則帳本、現況)、test/(含 test/tools/)、docs/ 皆隨包;
            //   CLAUDE*.md 由 .gitignore 排除,不入版控亦不入包。實際打包清單見下一案
            assert.equal(fs.existsSync(`${ROOT}/.npmignore`), false, '不得有 .npmignore(本套件無外部執行檔、無 ≥10MB 之非程式碼資料夾;發布範圍＝git 版控內容)')
            const gitignore = (readText('.gitignore') || '').split(/\r?\n/).map((l) => l.trim())
            assert.ok(gitignore.includes('CLAUDE*.md') && !gitignore.some((l) => /^!?sgud/.test(l) || l === '!CLAUDE.md'), '.gitignore 須列 CLAUDE*.md、不得排除 sgud、不得加 !CLAUDE.md')
            assert.ok(!gitignore.some((l) => /^\/?test\/?(tools\/?)?$/.test(l) || /^\/?test\/tools/.test(l) || /^\/?(src|dist)\/?$/.test(l)), '.gitignore 不得排除 test 夾整體、test/tools、src、dist(npm 包＝git 版控內容,下游取用 test/tools)')
            // 自有套件根目錄範本檔(編譯、文件、風格與安全政策)
            for (const f of ['.editorconfig', '.eslintignore', '.eslintrc.js', '.jsdoc', 'babel.config.js', 'SECURITY.md', 'g.mjs', 'README.md', 'LICENSE', 'script.txt', 'toolg/addVersion.mjs', 'toolg/modifyReadme.mjs', 'toolg/cleanFolder.mjs', 'toolg/gDocsExams.mjs', 'toolg/gDistRollup.mjs', 'toolg/genDocsDist.mjs', 'test/tools/extractTestKit.mjs']) {
                assert.ok(fs.existsSync(`${ROOT}/${f}`), `套件根須有 ${f}`)
            }
            const lic = readText('LICENSE') || ''
            assert.equal(pkg.license, 'MIT')
            assert.ok(lic.startsWith('MIT License') && lic.includes(`Copyright (c) 2026 ${pkg.author}`), 'LICENSE 須為 MIT 並署名作者')
        })

        it('打包清單(npm pack --dry-run):含 sgud/ 四份索引與 test/tools/ 全部檔、src 主入口、README、LICENSE、package.json;不含 CLAUDE*.md、暫存(tmp、test/_tmp)與 node_modules', () => {
            // 規則:npm 包＝git 版控內容(依 .gitignore);sgud/ 與 test/tools/ 隨包(下游之測試以「套件名/test/tools/…」取用),CLAUDE*.md 不入包
            const raw = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 120_000 })
            const parsed = JSON.parse(raw)
            const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
            const packed = info.files.map((x) => x.path.replace(/\\/g, '/'))
            assert.ok(packed.length >= 80, `打包清單過少:${packed.length}`)
            for (const f of ['sgud/exp/experience.md', 'sgud/proc/process.md', 'sgud/rule/rulebook.md', 'sgud/state/state.md', 'src/WKnowledgeExtract.mjs', 'README.md', 'LICENSE', 'package.json']) {
                assert.ok(packed.includes(f), `打包清單須含 ${f}`)
            }
            const tools = fs.readdirSync(`${ROOT}/test/tools`, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `test/tools/${e.name}`)
            assert.ok(tools.length >= 5, `test/tools 檔數過少:${tools.length}`)
            for (const f of tools) assert.ok(packed.includes(f), `打包清單須含 ${f}`)
            assert.deepEqual(packed.filter((f) => /(^|\/)CLAUDE[^/]*\.md$/.test(f)), [], '打包清單不得含 CLAUDE*.md')
            assert.deepEqual(packed.filter((f) => /^(tmp|test\/_tmp|node_modules)\//.test(f)), [], '打包清單不得含 tmp、test/_tmp、node_modules')
        })

        it('範例 g.mjs 離線可直接執行(不連網、不呼叫真 AI、不留工作目錄),輸出與檔末 `// =>` 逐行相符;README 之 Example 含 g.mjs 全文', () => {
            // 規則:自有套件根目錄 g.mjs 為可直接執行之範例,README 之 Example 連該檔(改 g.mjs 須同步 README)
            const g = (readText('g.mjs') || '').replace(/\r\n/g, '\n')
            const rd = (readText('README.md') || '').replace(/\r\n/g, '\n')
            assert.ok(g.length > 1000 && rd.includes(g.trimEnd()), 'README 之 Example 須含 g.mjs 全文')
            const lines = g.split('\n')
            const at = lines.findIndex((l) => l.startsWith('// => '))
            assert.ok(at > 0, 'g.mjs 檔末須附 `// =>` 輸出')
            const want = lines.slice(at).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ => /, '').replace(/^\/\/ ?/, ''))
            const cwd = tmpRoot('pkg-g-mjs')
            fs.mkdirSync(cwd, { recursive: true })
            try {
                // 以 g.mjs 之位置載入 src,工作目錄(./_test_knowledge_extract)落在暫存夾,與套件根無關
                const out = execFileSync(process.execPath, [`${ROOT}/g.mjs`], { cwd, encoding: 'utf8', timeout: 120_000 })
                assert.deepEqual(out.replace(/\r\n/g, '\n').trimEnd().split('\n'), want)
                assert.equal(fs.existsSync(`${cwd}/_test_knowledge_extract`), false, '範例結束須清掉工作目錄')
            }
            finally {
                removeRoots([cwd])
            }
        })

        it('發布內容(README、*.csv、非測試 .mjs〔src/、g.mjs、toolg/〕、隨包發布之 test/tools/*.mjs)不含宿主之痕跡:磁碟機絕對路徑(含字串字面中之跳脫形)、使用者目錄與宿主之名(專案名、通知管道);其餘 test/ 不計(不發布)', () => {
            // 判準自檢:被抓到與不誤判(盤符之相對寫法、網址、正斜線之範例路徑不算;宿主名不分大小寫、字首相近之他詞不算)
            for (const s of ['C:\\work\\x', "'d:\\\\kb'", '/Users/me/x', 'C:/Users/me']) assert.ok(HOST_PATH.test(s), s)
            for (const s of ['c:/kb/db', "workDir: 'd:/my-kb'", 'https://a.example/b', 'a:b', '相對\\路徑']) assert.ok(!HOST_PATH.test(s), s)
            for (const s of ['tai-kns-trade', 'TELEGRAM_TEXT_MAX', 'telegram 通知']) assert.ok(HOST_NAME.test(s), s)
            for (const s of ['telegraph', 'tai-news', '知識庫']) assert.ok(!HOST_NAME.test(s), s)
            const files = [...sourceFiles('.mjs').filter((f) => !f.startsWith('test/') || f.startsWith('test/tools/')), ...sourceFiles('.csv').filter((f) => !f.startsWith('test/')), 'README.md']
            assert.ok(files.length >= 40 && files.some((f) => f.endsWith('.csv')), `掃描量過少或漏 csv：${files.length}`)
            assert.ok(files.includes('test/tools/extractKit.mjs') && files.includes('test/tools/quantVocab.mjs'), '掃描須含隨包發布之 test/tools(npm 包＝git 版控內容,test/tools 隨包)')
            const bad = []
            for (const f of files) {
                (readText(f) || '').split('\n').forEach((l, i) => {
                    if (HOST_PATH.test(l) || HOST_NAME.test(l)) bad.push(`${f}:${i + 1} ${l.trim().slice(0, 80)}`)
                })
            }
            assert.deepEqual(bad, [])
        })
    })

    // ═══════════════════════ ③ 撞名 ═══════════════════════
    describe('③ 撞名(本套件之公開名不與三上游主入口同名)', () => {

        /**
         * 總組裝之鍵集名:四套件之總組裝(createKnowledge<工作>.mjs)依同一慣例各匯出自己之一份(cfg、cfg.data、cfg.prompts、集合之可用鍵);
         *   同名而各指其套件之總組裝,任何匯入點皆不轉出(他套件之件只經其匯入點取得,故不會在同一命名空間相遇)
         *
         * @type {Array}
         */
        const ASSEMBLY_KEY_NAMES = Object.freeze(['CFG_KEYS', 'DATA_KEYS', 'PROMPT_KEYS', 'COLLECTION_KEYS'])

        it('本套件入口之具名匯出 ∩ 三上游主入口之具名匯出＝∅,總組裝之鍵集名除外(判準自檢:上游實有之名會被抓到)', async () => {
            const mine = Object.keys(NS).filter((k) => k !== 'default')
            assert.ok(mine.length >= 20, `入口之名過少:${mine.length}`)
            const probe = mine.find((k) => !ASSEMBLY_KEY_NAMES.includes(k))
            for (const p of Object.values(PORTS)) {
                const theirs = new Set(Object.keys(await entryOf(p)).filter((k) => k !== 'default'))
                assert.ok(theirs.size > 100, `前提:${p.label}主入口之名 ${theirs.size}`)
                assert.deepEqual(mine.filter((k) => theirs.has(k) && !ASSEMBLY_KEY_NAMES.includes(k)), [], `與${p.label}主入口同名之名`)
                assert.deepEqual(['kbLabelOf', probe].filter((k) => theirs.has(k)), ['kbLabelOf'], '判準自檢')
                // 例外仍有對象:上游主入口皆有此四名(其總組裝之鍵集)
                assert.deepEqual(ASSEMBLY_KEY_NAMES.filter((k) => !theirs.has(k)), [], `前提:${p.label}主入口有總組裝之鍵集名`)
            }
        })

        it('總組裝之鍵集名之例外有界:本套件之四名出自總組裝(同一實體);三埠皆不列此四名(不會把上游之一份帶進本套件)', async () => {
            const asm = await import(pathToFileURL(path.join(ROOT, 'src/createKnowledgeExtract.mjs')).href)
            for (const k of ASSEMBLY_KEY_NAMES) {
                assert.ok(Object.prototype.hasOwnProperty.call(asm, k), `總組裝須匯出 ${k}`)
                assert.equal(NS[k], asm[k], `${k} 須為總組裝之一份`)
            }
            for (const p of Object.values(PORTS)) assert.deepEqual(ASSEMBLY_KEY_NAMES.filter((k) => k in p.ns), [], `${p.file} 不得列總組裝之鍵集名`)
        })

        it('各公開模組之預設匯出(同三上游之慣例):物件者之鍵恰為本模組之具名匯出且為同一實體;函數者為本模組具名匯出之主函數(工廠、段、專步)', async () => {
            const NOT_PUBLIC = new Set(['src/WKnowledgeExtract.mjs', PORTS.capture.file, PORTS.summarize.file, PORTS.relate.file])
            const bad = []
            let objs = 0
            for (const f of libFiles().filter((x) => !NOT_PUBLIC.has(x))) {
                const mod = await import(pathToFileURL(path.join(ROOT, f)).href)
                const named = Object.keys(mod).filter((k) => k !== 'default')
                const d = mod.default
                if (typeof d === 'function') {
                    if (!named.some((k) => mod[k] === d)) bad.push(`${f}:預設之函數非本模組之具名匯出`)
                    continue
                }
                if (!d || typeof d !== 'object') {
                    bad.push(`${f}:無預設匯出物件`)
                    continue
                }
                objs++
                const keys = Object.keys(d)
                for (const k of named) if (d[k] !== mod[k]) bad.push(`${f}:預設物件${k in d ? '之同名成員非同一實體' : '缺'} ${k}`)
                for (const k of keys) if (!named.includes(k)) bad.push(`${f}:預設物件多 ${k}`)
            }
            assert.ok(objs >= 20, `走訪不得空轉:預設物件之模組 ${objs}`)
            assert.deepEqual(bad, [])
        })
    })

    // ═══════════════════════ ④ 舊名、沿革與面向使用者之字樣 ═══════════════════════
    describe('④ 舊名、沿革與面向使用者之字樣(README、package.json 與原始碼〔含 bench/*.mjs;不含測試〕;判準取抓取套件之 test/tools/historyMarks)', () => {
        /** 舊之套件名、總組裝名與入口名(暫名 w-knowledge-extractor／createKnowledgeExtractor／WKnowledgeExtractor;定名 w-knowledge-extract／createKnowledgeExtract／WKnowledgeExtract 不命中) */
        const OLD = /w-knowledge-extractor|\bcreateKnowledgeExtractor\b|\bWKnowledgeExtractor\b/
        // 執行端之指令:面向使用者之字樣一律指本套件與上游套件之 API(宿主之共通名取 HOST_CLI);逐行(含註解)亦判
        const LINE = { old: OLD, extra: [['執行端之指令', HOST_CLI]] }
        const USER = { cli: HOST_CLI }
        /** 隨包發布之測試件(test/tools 隨包;安裝方拿得到,沿革與宿主之指令同判) */
        const toolFiles = () => sourceFiles().filter((f) => f.startsWith('test/tools/'))
        const files = () => [...libFiles(), ...toolFiles(), 'package.json', 'README.md']
        // 題組(src/bench/cases/*.json)之說明文字(頂層 note 與各案之 why)亦掃:說明屬原始碼之一部分,不得帶沿革;材料與應然為題材,不掃
        const caseDocs = () => sourceFiles('.json').filter((x) => x.startsWith('src/bench/cases/')).flatMap((f) => benchCaseNotesOf(f, readText(f) || ''))

        it('判準自檢:舊名之各種寫法皆命中、新名不命中;沿革、宿主之指令、帳本代號被抓到;工作流之棒名與範例之時刻不誤判;掃描範圍含題組檔之說明(note 與各案之 why,不含材料)與隨包發布之 test/tools', () => {
            assert.ok(['test/tools/extractKit.mjs', 'test/tools/captureForTest.mjs', 'test/tools/quantVocab.mjs'].every((f) => files().includes(f)), '掃描範圍須含 test/tools(隨包發布)')
            assert.ok(!files().some((f) => /^test\/[^/]+\.test\.mjs$/.test(f)), '測試檔不發布,不在掃描範圍')
            const cd = caseDocs()
            assert.ok(cd.filter((d) => /#note$/.test(d.file)).length >= 6 && cd.filter((d) => /\.why$/.test(d.file)).length >= 60, `題組之說明須在掃描範圍:${cd.length}`)
            assert.deepEqual(benchCaseNotesOf('x.json', '{"note":"說明","cases":[{"id":"a","why":"理由","input":{"text":"程式碼審查"}}]}'), [{ file: 'x.json#note', text: '說明' }, { file: 'x.json#a.why', text: '理由' }], '只取說明,不取材料')
            for (const s of ['w-knowledge-extractor', "from 'w-knowledge-extractor/src/WKnowledgeExtractor.mjs'", 'createKnowledgeExtractor(cfg)', 'WKnowledgeExtractor.mjs', 'import WKnowledgeExtractor from']) {
                assert.ok(OLD.test(s), s)
            }
            for (const s of ['w-knowledge-extract', "from 'w-knowledge-extract/src/WKnowledgeExtract.mjs'", 'createKnowledgeExtract(cfg)', 'WKnowledgeExtract', 'WKnowledgeExtract.mjs']) {
                assert.equal(OLD.test(s), false, s)
            }
            const line = (s) => historyHitsOf(s, LINE)
            assert.deepEqual([line('// 2026-10-10 審查 D 之結論'), line('// 以 npm run x 跑'), line('// 見 EXT-14')], [['日期', '帳本／審查代號'], ['執行端之指令'], ['帳本／審查代號']])
            for (const s of ['// 起草 → 整合 → 審計 → 修訂 → 終審', "const at = '2026-10-05T10:00:00+08:00'"]) assert.deepEqual(line(s), [], s)
            assert.deepEqual([userTextHitsOf('見 EXT-14', USER), userTextHitsOf('以 standards holds 處置', USER), userTextHitsOf('以 requestRetry 重送', USER)], [['規則帳本代號'], ['執行端之指令'], []])
        })

        it('不含舊名、沿革指標與宿主之指令(逐行,含註解;題組檔之說明同判)', () => {
            const docs = [...files().map((f) => ({ file: f, text: readText(f) || '' })), ...caseDocs()]
            assert.ok(docs.length >= 50, `掃描量過少:${docs.length}`)
            assert.deepEqual(historyScanOf(docs, LINE), [])
        })

        it('面向使用者之字樣(原始碼之字串字面與 README)不含宿主之指令與帳本代號', () => {
            const src = files().filter((f) => f.endsWith('.mjs')).map((f) => ({ file: f, strings: lexSource(readText(f) || '').strings }))
            assert.ok(src.reduce((n, d) => n + d.strings.length, 0) >= 4000, '字串字面過少(掃描空洞)')
            assert.deepEqual(userTextScanOf([...src, { file: 'README.md', strings: [readText('README.md') || ''] }], USER), [])
        })

        it('判定小組未成立原因之字樣不寫字面(取摘要套件之字樣表 PANEL_WHY_LABELS;摘要、關聯、提煉同用):非測試原始碼不含舊字樣或字樣表之字面', () => {
            const WORDS = /['`（:](有一席不確定|兩席不一致|有席位回覆材料不足|各席裁決不一致|一致之兩票為同一供應者|缺票：|缺票（|有席位不確定|缺票'|同一供應者')/
            const bad = []
            for (const f of libFiles()) {
                readText(f).split('\n').forEach((line, i) => {
                    if (WORDS.test(line)) bad.push(`${f}:${i + 1}`)
                })
            }
            assert.deepEqual(bad, [])
        })
    })

    // ═══════════════════════ ⑤ 預設領域中立 ═══════════════════════
    describe('⑤ 預設領域中立', () => {
        // 零設定組裝之建構即設定模組級之概念折疊(單例):不留給同 worker 之他檔
        after(() => resetConceptFold())
        /**
         * 中立掃描之具名例外:'stock'(存量覆核寫入沿革之持久化值＝存量;改名即令既有核心之沿革對不上,永久)。檔、程式行內之字樣、理由;
         *   例外之字樣自該檔移除後再掃,同檔之其他詞照判
         *
         * @type {Array}
         */
        const NAMED_EXCEPTIONS = Object.freeze([
            { file: 'src/workflow/supportStockPass.mjs', token: "pass: 'stock'", why: '存量覆核寫入沿革之 pass 值(持久化值＝存量)' },
        ])
        /**
         * 負對照夾具(隨包發布之 test/tools 中刻意帶領域詞者;整檔豁免中立掃描):檔 → 理由。豁免須仍有對象(該檔仍含領域詞,否則即不再是負對照、須移除)
         *
         * @type {Object}
         */
        const NEGATIVE_FIXTURES = Object.freeze({
            'test/tools/quantVocab.mjs': '量化詞彙之覆寫:負對照(unit-domain-terms ③、unit-extract-notop 之推定)以之驗「中立來自預設詞彙、給回領域原句即帶回領域詞」',
        })
        /**
         * 一份文字之命中(套用具名例外)
         *
         * @param {String} file 輸入檔名(相對套件根)
         * @param {String} text 輸入文字
         * @returns {Array} 回傳命中之詞
         */
        const hitsOfFile = (file, text) => {
            let t = String(text || '')
            for (const x of NAMED_EXCEPTIONS) if (x.file === file) t = t.split(x.token).join('')
            return domainTermsIn(t)
        }
        /** 值含函數與 RegExp 時之可掃描文字 */
        const textOf = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' || x instanceof RegExp ? String(x) : x))

        it('中立題材、本套件之識別字與模型條目 id 之片段不被詞表誤傷;一個正向對照(掃描非空洞——詞表之逐詞自檢在抓取套件之 unit-domain-terms,不在此重列)', () => {
            assert.deepEqual(domainTermsIn('天文學知識庫：quantum tunneling、supportStock、stockFix、oc:opencode/fledge-alpha-free'), [])
            assert.ok(domainTermsIn('只談套利').length > 0, '正向對照:詞表確能命中')
        })

        it('負對照夾具之豁免仍有對象(該檔仍含領域詞)且理由已寫;豁免只限所列之檔', () => {
            for (const [f, why] of Object.entries(NEGATIVE_FIXTURES)) {
                assert.ok(domainTermsIn(readText(f) || '').length > 0, `${f} 已不含領域詞:不再是負對照,請自豁免移除`)
                assert.ok(typeof why === 'string' && why.length >= 10, `${f}:豁免理由須寫明`)
            }
            assert.deepEqual(sourceFiles().filter((f) => f.startsWith('test/tools/') && !NEGATIVE_FIXTURES[f] && domainTermsIn(readText(f) || '').length), [], '其餘 test/tools 不得帶領域詞')
        })

        it('具名例外仍有對象且只在程式行(不在註解);例外只免該字樣,同檔之其他詞照判', () => {
            for (const x of NAMED_EXCEPTIONS) {
                const src = readText(x.file) || ''
                assert.ok(src.includes(x.token), `${x.file} 已不含 ${x.token}:具名例外過時,請移除`)
                assert.ok(lexSource(src).code.includes(x.token), `${x.token}:須在程式行(註解不得以例外豁免)`)
            }
            assert.deepEqual(hitsOfFile('src/workflow/supportStockPass.mjs', "pass: 'stock' 與 交易"), ['交易'])
            assert.deepEqual(hitsOfFile('src/core/extractSettings.mjs', "pass: 'stock'"), ['stock'], '未列之檔不免')
        })

        it('非測試、非評分之原始碼(含註解、JSDoc 與字串;公開模組、三埠、入口)、隨包發布之 test/tools/*.mjs(負對照夾具除外)、package.json 與 README 不含領域詞彙(具名例外除外;bench/ 由 unit-extract-bench ⑥ 走訪掃描)', () => {
            const tools = sourceFiles().filter((f) => f.startsWith('test/tools/') && !NEGATIVE_FIXTURES[f])
            const extras = sourceFiles().filter((f) => !f.startsWith('src/') && !f.startsWith('test/')) // 套件根之 g.mjs 與 toolg/(範例與編譯工具;隨包發布)
            const files = [...libFiles().filter((f) => !f.startsWith('src/bench/')), ...extras, ...tools, 'package.json', 'README.md']
            assert.ok(files.includes('src/core/extractSettings.mjs') && files.includes('src/core/vocab/extractVocab.mjs') && files.includes('test/tools/extractKit.mjs') && files.includes('g.mjs') && files.includes('toolg/gDistRollup.mjs') && files.length >= 7)
            const bad = []
            for (const f of files) {
                const h = hitsOfFile(f, readText(f))
                if (h.length) bad.push(`${f}：${h.join('、')}`)
            }
            assert.deepEqual(bad, [])
        })

        it('預設設定與預設詞彙(含 guide.extract 10 欄、證據性質封頂、自承限制片語、推定詞;常數、解析後之值與 guide 之預設)皆不含領域詞彙', () => {
            assert.deepEqual(domainTermsIn(textOf([resolveExtractSettings({}), EXTRACT_DEFAULT, EXTRACT_AI_DEFAULT])), [])
            assert.deepEqual(domainTermsIn(textOf([EXTRACT_VOCAB_DEFAULT, resolveExtractVocab({}), extractGuideDefaultOf()])), [])
            assert.deepEqual(Object.keys(EXTRACT_VOCAB_DEFAULT.guide.extract).length, 10, '前提:掃描涵蓋 guide.extract 之全部欄位')
            assert.deepEqual(Object.keys(extractGuideDefaultOf().extract).length, 10)
        })

        it('零設定組裝之 info()(設定、詞彙、資料、生效之提煉 domain 之規則表、限制與知識庫稱呼、關聯 domain 之衝突型)不含領域詞彙;稱呼為通用「知識庫」', () => {
            // 只建構不執行(建構期不開庫、不寫檔、不呼叫 AI);工作目錄不建立
            const info = WKnowledgeExtract.createKnowledgeExtract({ workDir: `${ROOT}/test/_tmp/extract-package-zero-${process.pid}`, aiAdapter: blankAi, lock: false }).info()
            const d = info.domains.extract
            assert.equal(d.kb, '知識庫')
            assert.deepEqual(domainTermsIn(textOf({ settings: info.settings, vocab: info.vocab, data: info.data, rules: d.rules, limits: d.limits, kb: d.kb, conflict: [info.domains.relate.conflictType, info.domains.relate.conflictTypeNames] })), [])
            assert.equal(fs.existsSync(`${ROOT}/test/_tmp/extract-package-zero-${process.pid}`), false, '建構期不建立工作目錄')
        })
    })

    // ═══════════════════════ ⑥ 層序 ═══════════════════════
    describe('⑥ 層序(core ← guards ← stores ← standards〔根之 logContract 同層〕← workflow ← { stages, ops };domain、bench 為葉;根檔不被各層取;三埠視為外部)', () => {

        it('判準自檢:合成之 import 清單——上取、stages 與 ops 互取、各層取葉、各層取根檔、低層取 logContract 皆判違反;同層、下取、葉與根檔取全部、取三埠、standards 取 logContract 皆不判', () => {
            const bad = [
                ['standards/a.mjs', 'workflow/b.mjs'], ['stores/a.mjs', 'standards/b.mjs'], ['core/a.mjs', 'guards/b.mjs'], ['stages/a.mjs', 'ops/b.mjs'], ['ops/a.mjs', 'stages/b.mjs'],
                ['stores/a.mjs', 'domain/x.mjs'], ['workflow/a.mjs', 'bench/x.mjs'], ['core/a.mjs', 'extractObject.mjs'], ['stages/a.mjs', 'createKnowledgeExtract.mjs'], ['stores/a.mjs', 'logContract.mjs'],
            ]
            const ok = [
                ['workflow/a.mjs', 'standards/b.mjs'], ['stages/a.mjs', 'stages/b.mjs'], ['ops/a.mjs', 'workflow/b.mjs'], ['domain/x.mjs', 'stages/y.mjs'], ['bench/x.mjs', 'domain/y.mjs'],
                ['extractObject.mjs', 'stages/y.mjs'], ['stages/a.mjs', 'core/capturePackage.mjs'], ['standards/a.mjs', 'logContract.mjs'], ['logContract.mjs', 'stores/a.mjs'],
            ]
            assert.deepEqual(bad.filter(([a, b]) => !layerViolation(a, b)).map((x) => x.join(' → ')), [], '應判違反而未判')
            assert.deepEqual(ok.filter(([a, b]) => layerViolation(a, b)).map((x) => x.join(' → ')), [], '不應判違反而判')
        })

        it('全部非測試原始碼之相對 import(含 export … from)違反層序之邊＝0;走訪涵蓋各層', () => {
            const edges = importEdges()
            for (const d of ['core', 'guards', 'stores', 'standards', 'workflow', 'stages', 'ops', 'domain', 'bench']) assert.ok(edges.some((e) => e.from.startsWith(`src/${d}/`)), `走訪缺 src/${d}/`)
            assert.ok(edges.length >= 300, `邊過少(走訪空轉?):${edges.length}`)
            assert.deepEqual(edges.filter((e) => layerViolation(e.from, e.to)).map((e) => `${e.from} → ${e.to}`), [])
        })

        it('檔級無環(DFS;全部非測試原始碼之相對 import 之圖);判準自檢:合成之圖之環抓得到、無環之圖不誤判', () => {
            assert.deepEqual(cyclesOf(importEdges()).map((c) => c.join(' → ')), [])
            assert.equal(cyclesOf([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]).length, 1)
            assert.equal(cyclesOf([{ from: 'a', to: 'a' }]).length, 1)
            assert.deepEqual(cyclesOf([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }]), [])
        })
    })

    // ═══════════════════════ ⑦ 區域同名件(同一規則一份) ═══════════════════════
    describe('⑦ 區域同名件(非測試原始碼之頂層與巢狀函數型宣告;逐字同之跨檔同名＝0,各自語意之跨檔同名列白名單)', () => {

        it('判準自檢:逐字同(去註解與空白後)之跨檔同名抓得到;本體不同者判非逐字同;取共用件之賦值(非箭頭／非 function)與同檔重名不算;巢狀只計函數型', () => {
            const files = [
                { file: 'a.mjs', code: "import x from 'y'\nconst str = (v) => (typeof v === 'string' ? v.trim() : '') // 甲\nfunction f() {\n    const pick = (k) => k + 1\n    const n = 3\n}\n" },
                { file: 'b.mjs', code: "const str = (v) =>  (typeof v === 'string' ? v.trim() : '')\nexport function g() {\n    const pick = (k) => k + 2\n    const call = callerOf(ai, {})\n    const n = 4\n}\n" },
                { file: 'c.mjs', code: "const only = () => 1\nconst only2 = () => 1\nfunction h() {\n    const call = callerOf(ai)\n}\n" },
            ]
            const got = sameNamesAcross(files)
            assert.deepEqual(got.map((x) => [x.name, x.same]), [['pick', false], ['str', true]], '逐字同之 str、非逐字同之 pick;call(取共用件之賦值)與 n(非函數)不算')
            assert.deepEqual(got.find((x) => x.name === 'str').locs, ['a.mjs:2', 'b.mjs:1'])
            assert.deepEqual(declsOf("export const A = 1\nexport async function b() {}\n    const c = async (x) => x\n    function d(y) {}\n    let e = function () {}\n").map((d) => d.name), ['A', 'b', 'c', 'd', 'e'])
        })

        it('逐字同之跨檔同名＝0(同一規則一份:收斂為共用件,不各寫一份)', () => {
            const all = sameNamesAcross(libFiles().map((file) => ({ file, code: readText(file) || '' })))
            assert.ok(libFiles().length >= 60, `走訪檔數過少(走訪空轉?):${libFiles().length}`)
            assert.deepEqual(all.filter((x) => x.same).map((x) => `${x.name}:${x.locs.join('、')}`), [])
        })

        it('跨檔同名(各自語意者)⊆ 白名單(名＋理由);白名單自檢:每名仍為跨檔同名(列了而已不存在即失敗)、理由非空', () => {
            const all = sameNamesAcross(libFiles().map((file) => ({ file, code: readText(file) || '' })))
            const names = all.map((x) => x.name)
            assert.deepEqual(names.filter((n) => !(n in LOCAL_SAME_NAMES)).map((n) => `${n}:${all.find((x) => x.name === n).locs.join('、')}`), [], '未列白名單之跨檔同名(同一規則即收斂;各自語意才列入並寫理由)')
            assert.deepEqual(Object.keys(LOCAL_SAME_NAMES).filter((n) => !names.includes(n)), [], '白名單之名已不再跨檔同名(過時即移除)')
            assert.deepEqual(Object.entries(LOCAL_SAME_NAMES).filter(([, why]) => !(typeof why === 'string' && why.trim().length >= 10)).map(([n]) => n), [], '理由須寫明')
        })
    })

    // ═══════════════════════ ⑧ 測試檔之隔離、橋接之發布後映射、README 之測試表 ═══════════════════════
    describe('⑧ 測試檔之隔離(--parallel)、暫存根、橋接之發布後指定詞、README §17 ↔ 測試檔', () => {
        /** 本套件之測試檔(test/*.test.mjs) */
        const testDocs = () => fs.readdirSync(`${ROOT}/test`).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => ({ file: `test/${f}`, src: readText(`test/${f}`) || '' }))

        it('判準自檢(單例):非 null 之 setConceptFold、建構總組裝／執行期件而未還原者被抓到;以 setConceptFold(null) 還原者被抓到;設定後 resetConceptFold、字串內之字樣不誤判', () => {
            const docs = [
                { file: 'a', src: 'setConceptFold((s) => s.trim())' },
                { file: 'b', src: 'const flow = createKnowledgeExtract({ workDir: w })' },
                { file: 'c', src: 'after(() => setConceptFold(null))' },
                { file: 'd', src: "setConceptFold(null, { aliases: { 甲: '乙' } })\nafter(() => resetConceptFold())" },
                { file: 'e', src: "const s = 'setConceptFold((x) => x)、createExtractRuntime({})'" },
                { file: 'f', src: 'buildTestExtractor(root)\nafter(() => resetConceptFold())' },
            ]
            assert.deepEqual(foldProblemsOf(docs).map((x) => x.split(':')[0]), ['a', 'b', 'c'])
        })

        it('模組級單例(概念折疊)不跨檔汙染:改動之檔(非 null 之 setConceptFold、建構總組裝／執行期件)同檔皆以 resetConceptFold() 還原;還原不寫 setConceptFold(null)', () => {
            // 規則:mocha --parallel 下同一 worker 依序載入多檔,模組級單例漏還原即汙染後一檔(抓取 testKit 之 resetConceptFold 檔頭)
            const docs = testDocs()
            assert.ok(docs.length >= 38 && docs.some((d) => foldUseOf(d.src).sets), `走訪不得空轉:${docs.length}`)
            assert.deepEqual(foldProblemsOf(docs), [])
        })

        it('暫存根一律 tmpRoot(套件根定位、帶 pid、舊者清掉重建)＋removeRoots(刪除並回驗);判準自檢:手寫之 test/_tmp、建而不刪被抓到', () => {
            // 規則:README §17「各測試自建 test/_tmp/<名>-<pid>,測完刪除」、extractTestKit 檔頭【暫存】
            const EXEMPT = Object.freeze({
                'test/unit-extract-package.test.mjs': '零設定組裝之工作目錄只建構不寫入(斷言建構期不建立);本檔之判準自檢樣本',
                'test/api-extract-bench-ai.test.mjs': '專案外目錄之判準自檢樣本(不寫入)',
            })
            assert.deepEqual(tmpProblemsOf([
                { file: 'x1', src: "const TMP = path.resolve(`test/_tmp/x-${process.pid}`)" },
                { file: 'x2', src: "const TMP = path.join(DIR, '_tmp', 'y')" },
                { file: 'x3', src: "before(() => { TMP = tmpRoot('z') })" },
                { file: 'x4', src: "before(() => { TMP = tmpRoot('z') })\nafter(() => removeRoots([TMP]))" },
            ]).map((x) => x.split(':')[0]), ['x1', 'x2', 'x3'])
            for (const f of Object.keys(EXEMPT)) assert.ok(fs.existsSync(`${ROOT}/${f}`), `例外之檔須存在:${f}`)
            assert.deepEqual(tmpProblemsOf(testDocs(), EXEMPT), [])
        })

        it('橋接之指定詞映射:三上游皆為已發布之 npm 套件——橋接之每個指定詞為其主入口「<上游>/src/<主入口>」或其 test/tools/ 之實有檔(映射由解析本身證明);判準自檢:指向上游內部檔、不存在之測試件、相對路徑者皆判無從映射', () => {
            assert.ok(Object.values(PORTS).every((p) => !p.local), '前提:三上游皆為已發布之 npm 套件(匯入點之指定詞非相對路徑)')
            for (const p of Object.values(PORTS)) {
                const specs = specifiersOf(readText(p.bridge) || '')
                assert.ok(specs.includes(p.entrySpec), `${p.bridge}:須有指向上游主入口之指定詞`)
                assert.deepEqual(specs.filter((s) => bridgeSpecKindOf(p, s) === 'other'), [], `${p.bridge}:指定詞無從映射(非上游主入口、非上游 test/tools 之實有檔)`)
            }
            const c = PORTS.capture
            assert.deepEqual([c.entrySpec, `${c.pkg}/test/tools/testKit.mjs`, `${c.pkg}/src/core/kernel.mjs`, `${c.pkg}/test/tools/nope.mjs`, '../../core/capturePackage.mjs'].map((s) => bridgeSpecKindOf(c, s)), ['entry', 'tools', 'other', 'other', 'other'])
        })

        it('README §17 之測試表 ＝ 實際之 test/*.test.mjs(雙向:漏列與多列皆紅);判準自檢:大括號展開、表頭與分隔列不計、第三欄之反引號不計', () => {
            // 規則:README §17 為測試之對外說明,表列之檔須與實際一致(新增測試檔而未列、刪檔而未改表皆失敗)
            const sample = '## 17. 測試\n\n| 層 | 檔案 | 內容 |\n|---|---|---|\n| 甲 | `unit-a`、`unit-b-{x,y}` | 說明 `test/tools/k` |\n| 乙 | `api-c` | — |\n\n## 18. 其他\n| 丙 | `unit-z` | — |\n'
            assert.deepEqual(readmeTestFilesOf(sample), ['unit-a', 'unit-b-x', 'unit-b-y', 'api-c'])
            const listed = readmeTestFilesOf(readText('README.md') || '')
            const actual = testDocs().map((d) => path.basename(d.file, '.test.mjs'))
            assert.ok(listed.length >= 30, `表列過少(解析空轉?):${listed.length}`)
            assert.deepEqual(actual.filter((f) => !listed.includes(f)), [], 'README §17 漏列之測試檔')
            assert.deepEqual(listed.filter((f) => !actual.includes(f)), [], 'README §17 列了而不存在之測試檔')
            assert.equal(new Set(listed).size, listed.length, 'README §17 不重列')
        })

        it('README §17 之固定埠與暫存之敘述對得上:8881＝DEAD_PORT、8882＝FAKE_PORT、8883～8889 保留;測試原始碼之埠字面皆在本套件之埠段;「測完刪除」與 api 測試之專案外目錄', async () => {
            // 規則:README §17「固定埠(≥8000、不隨機)…」「暫存:各測試自建 test/_tmp/<名>-<pid>,測完刪除」;extractTestKit 檔頭【固定埠】
            const { DEAD_PORT, FAKE_PORT } = await import(pathToFileURL(`${ROOT}/test/tools/extractTestKit.mjs`).href)
            const sec = ((readText('README.md') || '').split(/^## 17\. 測試$/m)[1] || '').split(/^## 18\./m)[0]
            assert.deepEqual([DEAD_PORT, FAKE_PORT], [8881, 8882])
            assert.match(sec, /8881 為無人監聽之埠/)
            assert.match(sec, /8882 為本機假 REST/)
            assert.match(sec, /8883～8889 保留/)
            assert.match(sec, /各測試自建 `test\/_tmp\/<名>-<pid>`,測完刪除/)
            assert.match(sec, /WK_BENCH_OUT/, 'api 評分測試之工作目錄與報表在專案外(README 須載明)')
            const ports = []
            for (const { file, src } of testDocs()) {
                const { skeleton, strings } = lexSource(src)
                for (const m of skeleton.matchAll(/\bport\s*:\s*(\d{2,5})\b/g)) ports.push(`${file}:${m[1]}`)
                for (const t of strings) for (const m of t.matchAll(/127\.0\.0\.1:(\d{2,5})/g)) ports.push(`${file}:${m[1]}`)
            }
            assert.deepEqual(ports.filter((x) => !(Number(x.split(':').pop()) >= 8881 && Number(x.split(':').pop()) <= 8889)), [], '埠字面須在本套件之埠段 8881～8889(他套件:抓取 8821～8832、摘要 8841～8842、關聯 8861～8862)')
        })
    })
})
