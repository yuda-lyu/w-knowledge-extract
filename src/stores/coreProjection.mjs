// coreProjection.mjs — 核心之投影與程式寫入器(stores 層;提煉段、維運與存量處置同用):渲染(機制鍵＋domain 版型)、cores 記錄、手改偵測之已知雜湊、
//   以狀態重建投影、壞檔之修復、分身之併入、無 AI 之落盤(證據重算、不變式、CAS)與管線外之寫入器
//
// 【狀態為真理、md 與 cores 記錄為投影】所有投影寫入器皆經 renderOf(同一狀態逐字相同)與 recordOf(rev 與 id 計數之高水位);
//   渲染雜湊寫回狀態,下次落盤據以判手改。
// 【寫入順序】dirty 標記 → 狀態(CAS、原子寫、.prev)→ 再驗磁碟 rev → md(手改偵測)→ cores 記錄 → 筆記 extractedAt → 清 dirty;
//   中斷者由 dirty 標記補做(stages/extractMaintain)。
// 【不取 domain 模組】版型取呼叫端交入之 domain 實例(renderState、renderTwinRedirect);分身轉址頁之內建版型 twinRedirectBodyOf 在本檔,
//   domain 以原名轉出並作為其 renderTwinRedirect 之預設。

import fs from 'fs'
import path from 'path'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { normalizeConcept, slugify, jsonClone as clone } from '../core/capturePackage.mjs'
import { mdText, readMd, writeMd } from '../core/summarizePackage.mjs'
import { CORE_STATUS, twinsOf } from './conceptSelection.mjs'
import { createNoTopCache, saveNoTopCache } from './contentCache.mjs'
import { checkInvariants, citedNotesOf, essenceNeedOf } from './coreState.mjs'
import { ARCHIVE_TAGS, coreAuxDirs, coreStoreOf, mdHashOf } from './coreStore.mjs'
import { NO_TOP_CACHE_FILE } from './extractFiles.mjs'
import { markExtracted } from './noteFacts.mjs'


/**
 * 程式寫入之不變式(ES1):核心狀態之每一次寫入,寫入前以 checkInvariants(寫入前之狀態, 欲寫狀態) 驗過——
 *   AI 差量之套用由 runPass／runPending 驗(帶 touched);程式自身之寫入(維護之首見基準、撤出處／恢復、投影更新;pass 後之落帳;
 *   高水位補正)不改條目內容,故 touched 為空:任何條目之非衍生欄位被改、出處減少、已用筆記減少、版號跳動皆為違反——不寫入
 *
 * @param {Object} before 輸入寫入前之狀態
 * @param {Object} after 輸入欲寫之狀態
 * @param {Array} [touched=[]] 輸入允許改動之條目 id(程式寫入通常為空)
 * @returns {Array} 回傳違反說明陣列(空＝通過)
 * @example
 * const s = emptyState()
 * console.log(programWriteProblems(s, s))
 * // => []
 */
export const programWriteProblems = (before, after, touched = []) => checkInvariants(before, after, { touched })

/**
 * 新核心之 id:種子為「core|名」(類別層「core|category|名」);撞到任何既有記錄或檔案(任何 scope／status)——
 * 同 (scope, 鍵) 之 merged 記錄 → 復活(沿用其 id);其餘 → 以「core|<scope>|<名>|<n>」重新種子
 *
 * @param {Object} t 輸入選題項(取 concept、scope、key)
 * @param {Array} cores 輸入核心記錄陣列
 * @param {Object} dirs 輸入 deps.dirs
 * @returns {Object} 回傳 { id }(復活者沿用 merged 記錄之 id;呼叫端只取 id)
 * @example
 * need test in nodejs.
 *
 * const id = newCoreIdOf({ concept: '黑洞', scope: 'concept', key: '黑洞' }, cores, dirs)
 */
export function newCoreIdOf(t, cores, dirs) {
    const byId = new Map((isarr(cores) ? cores : []).map((c) => [c.id, c]))
    // 狀態檔之占用只認可讀者(ok、recovered;四態分流表):壞檔無上一版、他版、讀不了者由選中時之載入隔離並記 ERROR,不以之改種子(否則該概念
    //   永遠配到 -1 之 id,原檔隔離後亦不回頭);核心 md 現存者仍算占用(投影不可無聲覆寫)
    const store = coreStoreOf(dirs)
    const taken = (id) => byId.has(id) || fs.existsSync(path.join(dirs.core, `${id}.md`)) || ['ok', 'recovered'].includes(store.load(id).status)
    const seed = t.scope === 'category' ? `core|category|${t.concept}` : `core|${t.concept}`
    const first = slugify(t.concept, seed)
    const rec = byId.get(first)
    if (rec && rec.status === CORE_STATUS.merged && (rec.scope || 'concept') === t.scope && normalizeConcept(rec.concept) === t.key) return { id: first }
    if (!taken(first)) return { id: first }
    for (let n = 1; n < 1000; n++) {
        const id = slugify(t.concept, `core|${t.scope}|${t.concept}|${n}`)
        if (!taken(id)) return { id }
    }
    throw new Error(`提煉：無法為「${t.concept}」配發不撞號之核心 id`)
}

/**
 * 本質待重寫之原因(呈現給讀者:md、cores 記錄、索引)——取代／撤回所致(持久 stale)或出處已撤(衍生)
 *
 * @param {Object} s 輸入狀態
 * @returns {String} 回傳原因文字(無則'')
 */
function essenceStaleOf(s) {
    return essenceNeedOf(s).staleWhy
}

/**
 * 狀態自較舊來源接續時(.prev 還原、git 回滾)取投影之高水位:rev 與各前綴之下一個 id——
 * 否則同一 rev 或同一〔C5〕在投影與新狀態中指不同內容(對帳誤判「已同步」、舊 md 之引用指錯主張)
 *
 * @param {Object} state 輸入狀態(就地修改)
 * @param {Object} rec 輸入 cores 記錄(可為 null)
 * @returns {Object} 回傳 state
 * @example
 * need test in nodejs.
 *
 * highWater(state, cores.find((c) => c.id === id))
 */
export function highWater(state, rec) {
    if (!rec) return state
    if (Number.isFinite(rec.rev)) state.rev = Math.max(Number(state.rev) || 0, rec.rev)
    for (const [p, n] of Object.entries(rec.nextIdHigh || {})) state.nextId[p] = Math.max(Number(state.nextId[p]) || 1, Number(n) || 1)
    return state
}

/**
 * 狀態 → cores 記錄(投影)。高水位一份:rev 與各前綴之 id 計數對既有記錄取 max——狀態自較舊來源接續(.prev 還原、git 回滾)而未經載入之補正者
 *   (管線外之寫入器)投影不倒退:倒退之 rev 會使對帳誤判「已同步」、倒退之 id 計數會使新條目與舊 md 所引者同號;所有投影寫入器皆經此
 *
 * @param {Object} s 輸入狀態
 * @param {Object} o 輸入 { id, file, prev(既有之 cores 記錄;可為 null) }
 * @returns {Object} 回傳 cores 記錄
 * @example
 * need test in nodejs.
 *
 * const rec = recordOf(state, { id, file, prev })
 */
export function recordOf(s, o) {
    const stale = s.essence?.text ? essenceStaleOf(s) : ''
    const essence = `${stale ? '〔待重寫〕' : ''}${s.essence?.text || ''}`
    const prev = isobj(o.prev) ? o.prev : null
    const nextIdHigh = { ...(s.nextId || {}) }
    for (const [p, n] of Object.entries(prev?.nextIdHigh || {})) nextIdHigh[p] = Math.max(Number(nextIdHigh[p]) || 1, Number(n) || 1)
    return {
        id: o.id,
        concept: s.concept,
        scope: s.scope || 'concept',
        file: String(o.file).replace(/\\/g, '/'),
        noteCount: citedNotesOf(s).size,
        noteIds: [...(s.consumed || [])],
        version: s.version,
        rev: Math.max(Number(s.rev) || 0, Number.isFinite(prev?.rev) ? prev.rev : 0),
        essence: String(essence).replace(/\s+/g, ' ').slice(0, 300),
        updatedAt: s.updatedAt || '',
        proposedAt: s.proposedAt || '',
        status: 'active',
        nextIdHigh,
        pendingReview: (s.pendingReview || []).length, // 待審數:無待提煉筆記之核心亦據此排待審專步
    }
}

/**
 * 手改偵測之已知雜湊集(一份;三寫入器同用):狀態所記之最近渲染 ＋ 本次渲染——狀態先寫、md 後寫,md 寫前中斷時磁碟仍是上一次渲染;
 *   還原之狀態比磁碟 md 舊者,修復時另把磁碟現值之雜湊記入 renderHashes(repairCore)
 *
 * @param {Object} state 輸入狀態(載入時者)
 * @param {Object} rendered 輸入本次渲染 { hash }
 * @returns {Array} 回傳雜湊陣列
 * @example
 * console.log(knownHashesOf({ renderHashes: ['h1', 'h2'] }, { hash: 'h3' }))
 * // => [ 'h1', 'h2', 'h3' ]
 */
export function knownHashesOf(state, rendered) {
    return [...new Set([...(state?.renderHashes || []), rendered?.hash].filter(Boolean))]
}

/**
 * 狀態所記之最近渲染雜湊之滾動(最近兩次:上一次＋本次)
 *
 * @param {Object} state 輸入狀態(載入時者)
 * @param {String} hash 輸入本次渲染之雜湊
 * @returns {Array} 回傳新的 renderHashes
 * @example
 * console.log(nextRenderHashes({ renderHashes: ['h1', 'h2'] }, 'h3'))
 * // => [ 'h2', 'h3' ]
 */
export function nextRenderHashes(state, hash) {
    return [...new Set([...(state?.renderHashes || []).slice(-1), hash])].slice(-2)
}

/**
 * 渲染 md(domain 版型＋機制之 frontmatter;時刻取自狀態,同一狀態逐字相同)。各落盤路徑(提煉、維護、補做投影、管線外之寫入器)一律經此,
 *   交 domain 同一組材料:筆記記錄與出處之推定判定(env.noTopOf;快取供給)
 *
 * @param {Object} s 輸入狀態
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} env 輸入本段環境(取 notesById、noTopOf)
 * @param {String} id 輸入核心 id
 * @returns {Object} 回傳 { front, body, hash }
 * @example
 * need test in nodejs.
 *
 * const { front, body, hash } = renderOf(state, domain, env, id)
 */
export function renderOf(s, domain, env, id) {
    const r = domain.renderState(s, { notesById: env.notesById, noTopOf: env.noTopOf })
    const last = (s.changelog || [])[s.changelog.length - 1]
    // 機制鍵(concept／slug／type／scope／version／note_count／notes／updated)由本段寫、不可被 domain 之 front 覆寫(鍵序維持機制鍵在前;終審 §3 D5i)
    const mech = {
        concept: s.concept,
        slug: id,
        type: 'core',
        scope: s.scope || 'concept',
        version: s.version,
        note_count: citedNotesOf(s).size,
        notes: isarr(last?.batch) ? last.batch : [],
        updated: s.updatedAt || '',
    }
    const front = { ...mech, ...(isobj(r?.front) ? r.front : {}), ...mech }
    const body = String(r?.body || '')
    return { front, body, hash: mdHashOf(mdText(front, body)) }
}

/**
 * 以狀態重建投影(無 AI):dirty 標記 → 渲染雜湊回寫(本次渲染不在狀態所記者——版型改了、還原後首次重建——寫回狀態,CAS 以現 rev;否則下次一般落盤
 *   以舊雜湊比對而誤報手改)→ md(手改偵測)→ cores 記錄(高水位)→ 筆記 extractedAt → 清 dirty。對帳、dirty 補做、修復共用
 *
 * @param {Object} o 輸入 { id, file, state, env, domain }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { rec, state(回寫渲染雜湊者為寫出之狀態,rev 已＋1;否則原狀態) }
 * @example
 * need test in nodejs.
 *
 * await writeProjections({ id, file, state, env, domain })
 */
export async function writeProjections(o) {
    const { id, file, env, domain } = o
    let state = o.state
    const rendered = renderOf(state, domain, env, id)
    const known = knownHashesOf(state, rendered)
    const dirty = path.join(env.aux.dirty, id)
    fs.mkdirSync(env.aux.dirty, { recursive: true })
    fs.writeFileSync(dirty, env.at, 'utf8')
    if (!(state.renderHashes || []).includes(rendered.hash)) state = env.store.save(id, { ...state, renderHashes: nextRenderHashes(state, rendered.hash) }, { expectRev: state.rev })
    const saved = env.store.guardManualEdit(file, known, env.stamp, env.aux.manual)
    if (saved) env.log.warn(`提煉手改另存[${state.concept}]：核心 md 與上次渲染不符，覆寫前已另存 ${saved.replace(/\\/g, '/')}`)
    writeMd(file, rendered.front, rendered.body)
    const k = env.cores.findIndex((c) => c.id === id)
    const rec = recordOf(state, { id, file, prev: k >= 0 ? env.cores[k] : null })
    await env.stores.cores.replace(rec)
    if (k >= 0) env.cores.splice(k, 1, rec)
    else env.cores.push(rec)
    await markExtracted(env.stores.notes, env.notesById, state.consumed || [], env.at)
    fs.rmSync(dirty, { force: true })
    return { rec, state }
}

/**
 * 修復一份可讀而不可寫之核心(recovered:狀態檔毀損或遺失而由上一版讀出):隔離壞檔(保留 .prev;遺失者無對象)→ 磁碟 md 現值之雜湊記入已知雜湊
 *   (還原之狀態比磁碟 md 舊,否則覆寫前誤報手改)→ 高水位(rev、id 計數取投影之值)→ 立即落盤(expectRev null;寫出即為新真理,不留
 *   「可讀不可寫」之狀態給其後之落盤——CAS 必撞壞檔)→ 重建投影。選中之載入與維護段同走此路
 *
 * @param {Object} env 輸入本段環境
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} o 輸入 { id, rec(cores 記錄;可為 null), file(核心 md 路徑), state(上一版之狀態), lost(Boolean;主檔缺) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { state(落盤後), expectRev, moved(隔離檔路徑;遺失者'') }
 * @example
 * need test in nodejs.
 *
 * await repairCore(env, domain, { id, rec, file, state, lost: false })
 */
export async function repairCore(env, domain, o) {
    const moved = o.lost ? '' : env.store.quarantine(o.id, env.stamp)
    const state = highWater(clone(o.state), o.rec)
    const diskHash = fs.existsSync(o.file) ? mdHashOf(fs.readFileSync(o.file, 'utf8')) : ''
    const rendered = renderOf(state, domain, env, o.id)
    state.renderHashes = [...new Set([diskHash, rendered.hash].filter(Boolean))]
    const written = env.store.save(o.id, state, { expectRev: null })
    const wp = await writeProjections({ id: o.id, file: o.file, state: written, env, domain })
    return { state: wp.state, expectRev: wp.state.rev, moved: String(moved || '').replace(/\\/g, '/') }
}

/**
 * 分身轉址頁之本文(內建版型):同 (scope, 鍵) 之分身併入主核心後,其 md 改寫為指向主核心之短頁
 *
 * @param {Object} o 輸入 { twin:{ concept }(分身記錄), into:{ id, concept }(主核心記錄), archivedFile:合併前內容之封存路徑 }
 * @returns {String} 回傳本文(md 之 body;前言之機制鍵由提煉段寫)
 * @example
 * console.log(twinRedirectBodyOf({ twin: { concept: '甲' }, into: { id: 'k1', concept: '甲乙' }, archivedFile: 'a/k2.md' }).split('\n')[0])
 * // => # 甲
 */
export function twinRedirectBodyOf(o) {
    return `# ${o?.twin?.concept ?? ''}\n\n本概念已併入 [[${o?.into?.id ?? ''}]]（${o?.into?.concept ?? ''}）。合併前之內容已封存於 ${o?.archivedFile ?? ''}。`
}

/**
 * 主核心落盤後處理同 (scope, 鍵) 之分身:標 merged＋mergedInto → 原 md 封存並改寫轉址頁(已是轉址頁者不再包)→ 狀態檔封存;
 * 並補完先前中斷之分身(mergedInto＝本核心而 md 尚非轉址頁者)。冪等。轉址頁之本文取 domain.renderTwinRedirect(缺之即內建版型),
 * 前言之機制鍵(type:'redirect'、concept、mergedInto)由本函數寫——冪等之判準(已是轉址頁者不再包)依之,不交 domain
 *
 * @param {Object} rec 輸入主核心記錄
 * @param {Object} env 輸入本段環境
 * @param {Object} domain 輸入提煉 domain(取 renderTwinRedirect)
 * @returns {Promise} 回傳 Promise，resolve 回傳本次新標記之分身數
 * @example
 * need test in nodejs.
 *
 * await settleTwins(rec, env, domain)
 */
export async function settleTwins(rec, env, domain) {
    const bodyOf = typeof domain?.renderTwinRedirect === 'function' ? domain.renderTwinRedirect : twinRedirectBodyOf
    const twins = twinsOf(env.cores, rec)
    const unfinished = env.cores.filter((c) => c.status === CORE_STATUS.merged && c.mergedInto === rec.id && readMd(c.file)?.front?.type !== 'redirect')
    let n = 0
    for (const tw of [...twins, ...unfinished]) {
        const md = readMd(tw.file)
        let archivedFile = tw.archivedFile || ''
        if (md && md.front?.type !== 'redirect') {
            archivedFile = path.join(env.aux.archive, `${tw.id}.md.${ARCHIVE_TAGS.merged}-${env.stamp}.md`).replace(/\\/g, '/')
            fs.mkdirSync(env.aux.archive, { recursive: true })
            fs.copyFileSync(tw.file, archivedFile)
            writeMd(tw.file, { type: 'redirect', concept: tw.concept, mergedInto: rec.id }, String(bodyOf({ twin: tw, into: rec, archivedFile }) ?? ''))
        }
        env.store.archive(tw.id, ARCHIVE_TAGS.merged, env.stamp)
        const merged = { ...tw, status: CORE_STATUS.merged, mergedInto: rec.id, mergedAt: tw.mergedAt || env.at, archivedFile }
        await env.stores.cores.replace(merged)
        const k = env.cores.findIndex((c) => c.id === tw.id)
        if (k >= 0) env.cores.splice(k, 1, merged)
        if (twins.includes(tw)) {
            n++
            env.log.warn(`提煉分身合併[${tw.concept}]：同鍵之分身併入 ${rec.concept}（${rec.id}）；分身原 v${tw.version ?? '?'}、依據 ${tw.noteCount ?? '?'} 篇，原文已封存（如為折疊誤合，請以 vocab.conceptRenames 拆開）`)
        }
    }
    return n
}

/**
 * 落盤前之衍生(證據等級依現行筆記重算;原地改寫並回傳同一物件)——落盤與回退之「已回到處置前」之比對同一衍生
 *
 * @param {Object} env 輸入 { notesById }
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} state 輸入核心狀態
 * @returns {Object} 回傳同一狀態
 */
function deriveCoreState(env, domain, state) {
    if (domain?.evidence?.apply) domain.evidence.apply(state, env.notesById)
    return state
}

/**
 * 無 AI 之落盤(維護:首見基準、撤出處／恢復、投影更新):證據現值 → 渲染 → 新渲染雜湊寫回狀態
 *   → dirty → 狀態(CAS)→ 再驗 rev → md(手改偵測:比對舊渲染雜湊與本次者)→ cores 記錄 → extractedAt → 清 dirty。
 *   與一般落盤同序;不觸發分身處理;知識版本由呼叫端決定(撤出處影響有效條目才升版,其餘只 rev+1)。
 *   渲染雜湊必須寫回狀態——否則下次一般落盤以舊雜湊比對而誤報手改。
 *
 * @param {Object} env 輸入本段環境
 * @param {Object} domain 輸入提煉 domain
 * @param {Object} o 輸入 { id, file, state(就地補 renderHashes), expectRev, before(載入時之狀態複本;程式寫入之不變式) }
 * @returns {Promise} 回傳 Promise，resolve 回傳落盤後之狀態
 * @throws {Error} 違反不變式(不寫入)、CAS 衝突或寫入後即被他處改動時拋出
 * @example
 * need test in nodejs.
 *
 * await persistMechanical(env, domain, { id, file, state, expectRev: rec.rev, before })
 */
export async function persistMechanical(env, domain, o) {
    const { id, file, state, expectRev } = o
    deriveCoreState(env, domain, state)
    // 不變式:回退(restore;還原處置前之整份狀態——版號與沿革本就倒退)不驗,其餘一律驗
    const bad = o.restore === true ? [] : programWriteProblems(o.before, state, o.touched || [])
    if (bad.length) throw new Error(`不變式違反（維護寫入，未落盤）：${bad.slice(0, 3).join('；')}`)
    const rendered = renderOf(state, domain, env, id)
    const known = knownHashesOf(state, rendered)
    state.renderHashes = nextRenderHashes(state, rendered.hash)
    const dirty = path.join(env.aux.dirty, id)
    fs.mkdirSync(env.aux.dirty, { recursive: true })
    fs.writeFileSync(dirty, env.at, 'utf8')
    let written
    try {
        written = env.store.save(id, state, { expectRev })
    }
    catch (e) {
        fs.rmSync(dirty, { force: true })
        throw e
    }
    if (env.store.diskRev(id) !== written.rev) throw new Error('狀態寫入後即被他處改動（如 regenCore），不寫投影')
    const saved = env.store.guardManualEdit(file, known, env.stamp, env.aux.manual)
    if (saved) env.log.warn(`提煉手改另存[${state.concept}]：核心 md 與上次渲染不符，覆寫前已另存 ${saved.replace(/\\/g, '/')}`)
    writeMd(file, rendered.front, rendered.body)
    const k = env.cores.findIndex((c) => c.id === id)
    const rec = recordOf(written, { id, file, prev: k >= 0 ? env.cores[k] : null })
    await env.stores.cores.replace(rec)
    if (k >= 0) env.cores.splice(k, 1, rec)
    else env.cores.push(rec)
    await markExtracted(env.stores.notes, env.notesById, written.consumed || [], env.at)
    fs.rmSync(dirty, { force: true })
    return written
}

/**
 * 核心之程式寫入器(管線外之確定性處置用,如核心之存量處置 ES3／ES5):與維護落盤同一路徑(persistMechanical——證據重算、
 *   不變式、渲染〔出處之推定判定同提煉段之快取〕、渲染雜湊、CAS、手改偵測、cores 記錄)。環境一次建立(筆記全表、核心記錄),逐核心呼叫
 *
 * @param {Object} deps 輸入 { stores:{ notes, cores }, dirs, clock, log, domain(提煉 domain) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { write:(o:{ id, file, state, expectRev, before, touched })=>Promise(落盤後之狀態),
 *   restore:(o:{ id, file, state, expectRev })=>Promise(回退:寫回處置前之整份狀態,不驗不變式), derive:(state)=>state(落盤前之衍生,原地;
 *   回退判「已回到處置前」以之比對), store(核心狀態庫) }
 * @example
 * need test in nodejs.
 *
 * const writer = await coreWriterOf({ stores, dirs, clock, log, domain })
 */
export async function coreWriterOf(deps) {
    const { stores, dirs, clock, domain } = deps
    const aux = coreAuxDirs(dirs)
    const notes = await stores.notes.select()
    const log = deps.log || { info: () => {}, warn: () => {}, error: () => {} }
    const env = {
        notesById: new Map(notes.map((n) => [n.id, n])),
        aux,
        at: clock.iso8(),
        stamp: clock.stamp8(),
        store: coreStoreOf(dirs),
        log,
        stores,
        cores: await stores.cores.select(),
        noTopCache: createNoTopCache(path.join(dirs.state, NO_TOP_CACHE_FILE), domain?.evidenceRule ?? null),
    }
    env.noTopOf = (nid) => env.noTopCache.of(env.notesById.get(nid))
    // 落盤後存推定判定之快取
    const persist = async (o) => {
        const out = await persistMechanical(env, domain, o)
        saveNoTopCache(env, log)
        return out
    }
    return { store: env.store, write: (o) => persist({ ...o, restore: false }), restore: (o) => persist({ ...o, restore: true }), derive: (state) => deriveCoreState(env, domain, state) }
}

/**
 * 證據欄位之快照(投影更新之比對用:等級與 trace 皆算)
 *
 * @param {Object} s 輸入核心狀態
 * @returns {String} 回傳各條目證據欄位之 JSON 快照字串
 * @example
 * console.log(evidenceSnapshot(emptyState()))
 * // => []
 */
export const evidenceSnapshot = (s) => JSON.stringify([...(s.claims || []), ...(s.parameters || [])].map((x) => [x.id, x.evidence || null]).concat((s.disputes || []).map((d) => [d.id, (d.sides || []).map((sd) => sd.evidence || null)])))

export default { programWriteProblems, newCoreIdOf, highWater, recordOf, knownHashesOf, nextRenderHashes, renderOf, writeProjections, repairCore, settleTwins, persistMechanical, evidenceSnapshot, twinRedirectBodyOf, coreWriterOf }
