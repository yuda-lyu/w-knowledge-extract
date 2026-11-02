// regenCore.mjs — 令指定概念的核心知識「打掉重練」(維運能力)
//
// 【為何需要】模型輸出品質無法用程式可靠判定(規則式偵測會誤殺專有名詞音譯),故提供人工修復:
//   封存該概念之核心狀態與 md、刪核心記錄,下一輪以現有筆記從頭重練(v1),筆記本身不受影響。
// 【規則】①以 coreForKey 選主核心(與選題綁定一致;同鍵多核心時不取第一筆);
//   ②意圖先記(stores/regenIntent:逐核心 { key, scope, concept, stamp, by, at, done })→ 封存狀態檔(連 .prev;主檔缺亦封存 .prev)→ 封存 md
//     → 刪記錄(集合介面之 del)→ 結案該核心之待判 → 標 done。各步冪等:重跑同概念依未完成之意圖續作(沿用其時戳),封存檔撞名加序號;
//     與進行中之提煉交錯時,提煉之 CAS(rev 比對)使其不寫回;不刪檔(改名封存);
//   ③不清 extractedAt:「已用過」是逐核心累積出處(狀態之 consumed),extractedAt 只是「曾被任一核心用過」之標記,
//     清掉會讓其他核心之統計失真;
//   ④失敗帳與影響留待由管線開工時消化已完成之意圖而清(跨行程之寫者只有管線;本函數不直接改帳——否則被管線之整份覆寫吃掉);
//     未完成之意圖每輪 WARN(須見),重跑本函數即續作;
//   ⑤給 lockFile 時取執行鎖(管線持鎖中即拒絕;opt.staleMs 為持鎖者未宣告陳舊期限時所用),避免與管線同時動同一核心;
//   ⑥結案該核心之待判(以核心 id 為鍵之持久物全集:筆記層、爭議、主張、核心之存量處置;未結與已豁免皆結——新核心沿用同一 id、
//     條目編號自 C1／D1 重新配發,舊登錄與舊裁示不得作用於新條目;結案方式記打掉重練與執行者,豁免之裁示仍留於記錄供追溯);
//   ⑦opt.dryRun:只回將封存之檔、將刪之記錄與將結案之待判(plan),不寫任何東西。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { normalizeConcept, resolveClockCfg } from '../core/capturePackage.mjs'
import { listHolds, resolveHold } from '../core/capturePackage.mjs'
import { liveCoresOf, coreForKey } from '../stores/conceptSelection.mjs'
import { ARCHIVE_TAGS, coreStoreOf, coreAuxDirs } from '../stores/coreStore.mjs'
import { acquireLock } from '../core/capturePackage.mjs'
import { EXTRACT_API_HINT, EXTRACT_HOLD_OBJECTS, CORE_HOLD_OBJECT, itemOidOf } from '../stores/extractHolds.mjs'
import { readRegenIntents, writeRegenIntents } from '../stores/regenIntent.mjs'

/** 以核心 id 為 oid 前綴(`<核心 id>:<條目或筆記 id>`)之待判物件 */
const PER_CORE_OBJECTS = new Set([EXTRACT_HOLD_OBJECTS.note, EXTRACT_HOLD_OBJECTS.dispute, EXTRACT_HOLD_OBJECTS.claim])

/**
 * 不撞名之路徑(同一時戳已有者加 -1、-2 序號)
 *
 * @param {String} base 輸入不含副檔名之路徑
 * @param {String} ext 輸入副檔名
 * @returns {String} 回傳路徑
 */
function uniquePath(base, ext) {
    if (!fs.existsSync(`${base}${ext}`)) return `${base}${ext}`
    for (let n = 1; n < 1000; n++) {
        if (!fs.existsSync(`${base}-${n}${ext}`)) return `${base}-${n}${ext}`
    }
    throw new Error(`封存檔撞名逾 1000 份：${base}${ext}`)
}

/**
 * 列出現有核心(排除已併入他核心之分身;依版本、筆記數降冪)
 *
 * @param {Object} stores 輸入集合物件，需含 cores(w-data-pipeline openCollection 介面，取 select)
 * @returns {Promise} 回傳 Promise，resolve 回傳核心記錄陣列
 * @throws {Error} stores 非物件或缺 stores.cores.select 時拋出
 * @example
 * need test in nodejs.
 *
 * let cores = await listCores(stores)
 * console.log(cores.length)
 */
export async function listCores(stores) {

    //check
    if (!isobj(stores) || !isobj(stores.cores) || !isfun(stores.cores.select)) {
        throw new Error('listCores 需要 stores.cores.select（cores 集合）')
    }

    const cores = await stores.cores.select()
    return liveCoresOf(cores).sort((a, b) => (b.version || 0) - (a.version || 0) || (b.noteCount || 0) - (a.noteCount || 0))
}

/**
 * 打掉指定概念的核心:意圖先記 → 封存狀態檔(連 .prev)與 md(改名至核心之封存目錄,不刪)→ 刪核心記錄 → 結案該核心之待判 → 標 done;
 * 下一輪管線開工消化意圖(清該核心之失敗帳與影響留待)後,以現有筆記從頭重練(v1),筆記本身與其 extractedAt 皆不受影響
 *
 * @param {Object} stores 輸入集合物件，需含 cores(select、del)、notes(select)、holds(get／replace／select;該核心之待判隨重練結案)
 * @param {String} conceptArg 輸入欲重練之概念名稱字串(以 normalizeConcept 正規化後比對；先找概念層、再找類別層)
 * @param {Object} opt 輸入設定物件(必填)
 * @param {Object} opt.dirs 輸入目錄物件(同每輪依賴之 dirs；取 core、coreState、state)
 * @param {String} [opt.lockFile] 輸入執行鎖檔路徑(與管線同一把)，給了即取鎖、管線持鎖中即拒絕
 * @param {Integer} [opt.staleMs] 輸入取鎖時持鎖者未宣告陳舊期限所用之毫秒數
 * @param {String} [opt.stamp] 輸入封存檔名之時間戳，預設 clock.stamp8()(續作者沿用意圖之時戳)
 * @param {String} [opt.by='api'] 輸入執行者(意圖與待判結案之處置方式記之)
 * @param {Object} [opt.clock] 輸入時鐘(取 iso8、stamp8)，未給依預設時區
 * @param {Boolean} [opt.dryRun=false] 輸入預演:只回 plan,不寫任何東西
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok:Boolean, notFound:Boolean, locked?:Boolean, dryRun?:Boolean, concept, version, availableNotes, archived:Array,
 *   holdsResolved:Array(結案之登錄鍵), plan?:{ state, prev, md, record:Boolean, holds:Array, stamp }(預演), messages:Array }
 * @throws {Error} stores 缺必要方法(含 holds)、或 opt.dirs 缺 core／state 時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await regenCore(stores, '光合作用', { dirs, lockFile })
 * console.log(r.ok)
 */
export async function regenCore(stores, conceptArg, opt = {}) {

    //check, 本函數實際用到之集合方法須一併檢查(缺者要到封存之後才拋原生 TypeError,留下半套狀態)
    if (!isobj(stores) || !isobj(stores.cores) || !isfun(stores.cores.select)) {
        throw new Error('regenCore 需要 stores.cores.select（cores 集合）')
    }
    if (!isfun(stores.cores.del)) {
        throw new Error('regenCore 需要 stores.cores.del（集合介面之刪除）')
    }
    if (!isobj(stores.notes) || !isfun(stores.notes.select)) {
        throw new Error('regenCore 需要 stores.notes.select（notes 集合）')
    }
    if (!isobj(opt) || !isobj(opt.dirs) || !isestr(opt.dirs.core) || !isestr(opt.dirs.state)) {
        throw new Error(`regenCore 需要 opt.dirs（${EXTRACT_API_HINT.regenDirs}）`)
    }
    if (!['get', 'replace', 'select'].every((m) => isfun(stores.holds?.[m]))) {
        throw new Error(`regenCore 需要 holds 集合（具 get／replace／select 方法；${EXTRACT_API_HINT.holdsStore}）——該核心之未結待判須隨重練結案`)
    }
    if (!isestr(conceptArg)) {
        return { ok: false, notFound: true, archived: [], holdsResolved: [], messages: [`找不到概念「${conceptArg}」的核心知識`] }
    }

    let lock = null
    if (isestr(opt.lockFile)) {
        lock = acquireLock(opt.lockFile, Number.isInteger(opt.staleMs) && opt.staleMs > 0 ? { staleMs: opt.staleMs } : {})
        if (!lock.ok) return { ok: false, notFound: false, locked: true, archived: [], holdsResolved: [], messages: [`管線執行中，未重練：${lock.message}`] }
    }
    try {
        const dirs = opt.dirs
        const clock = isfun(opt.clock?.iso8) && isfun(opt.clock?.stamp8) ? opt.clock : resolveClockCfg(opt.clock)
        const at = clock.iso8()
        const by = isestr(opt.by) ? opt.by.trim() : 'api'
        const key = normalizeConcept(conceptArg)
        const messages = []
        const cores = await stores.cores.select()
        const target = coreForKey(cores, 'concept', key) || coreForKey(cores, 'category', key)
        // 未完成之意圖(前次中斷於刪記錄之後,記錄已不在):同鍵者續作
        const intents = readRegenIntents(dirs, { stamp: clock.stamp8(), log: { warn: (m) => messages.push(m) } })
        const resumeId = Object.keys(intents.cores).find((id) => isobj(intents.cores[id]) && intents.cores[id].done !== true && intents.cores[id].key === key)
        if (!target && !resumeId) return { ok: false, notFound: true, archived: [], holdsResolved: [], messages: [...messages, `找不到概念「${conceptArg}」的核心知識`] }
        const id = target?.id || resumeId
        const prior = isobj(intents.cores[id]) && intents.cores[id].done !== true ? intents.cores[id] : null
        const stamp = isestr(prior?.stamp) ? prior.stamp : (isestr(opt.stamp) ? opt.stamp : clock.stamp8())
        const concept = target?.concept || prior?.concept || conceptArg
        const scope = target?.scope || prior?.scope || 'concept'
        const notes = await stores.notes.select()
        const available = notes.filter((n) => (n.concepts || []).some((c) => normalizeConcept(c) === key))
        messages.push(target
            ? `概念「${concept}」：現為 v${target.version}（依據 ${target.noteCount} 篇），可用筆記 ${available.length} 篇${prior ? `；前次重練（${prior.stamp}）未完成，續作` : ''}`
            : `概念「${concept}」：前次重練（${prior.stamp}）中斷於刪記錄之後，續作；可用筆記 ${available.length} 篇`)

        const store = coreStoreOf(dirs)
        const aux = coreAuxDirs(dirs)
        const mdFile = target?.file || path.join(dirs.core, `${id}.md`)
        const how = `打掉重練（regenCore；執行者 ${by}）：舊核心已封存，新核心自 v1 重起、條目編號重新配發`
        const mine = (h) => (PER_CORE_OBJECTS.has(h.object) && String(h.oid).startsWith(itemOidOf(id, ''))) || (h.object === CORE_HOLD_OBJECT && h.oid === id)
        const holdsToClose = (await listHolds(stores.holds)).filter((h) => (h.status === 'open' || h.status === 'waived') && mine(h)).sort((a, b) => (a.id < b.id ? -1 : 1))
        const plan = {
            state: fs.existsSync(store.fileOf(id)) ? store.fileOf(id).replace(/\\/g, '/') : '',
            prev: fs.existsSync(store.prevOf(id)) ? store.prevOf(id).replace(/\\/g, '/') : '',
            md: fs.existsSync(mdFile) ? String(mdFile).replace(/\\/g, '/') : '',
            record: !!target,
            holds: holdsToClose.map((h) => h.id),
            stamp,
        }
        if (opt.dryRun === true) {
            messages.push(`預演：將封存 ${[plan.state, plan.prev, plan.md].filter(Boolean).length} 檔、刪記錄 ${plan.record ? 1 : 0} 筆、結案待判 ${plan.holds.length} 則（未結 ${holdsToClose.filter((h) => h.status === 'open').length}、已豁免 ${holdsToClose.filter((h) => h.status === 'waived').length}）；未寫入`)
            return { ok: true, dryRun: true, notFound: false, concept, version: target?.version ?? null, availableNotes: available.length, archived: [], holdsResolved: [], plan, messages }
        }

        // ①意圖先記(續作者沿用其時戳與發起時刻)
        intents.cores[id] = { key, scope, concept, stamp, by, at: isestr(prior?.at) ? prior.at : at, done: false }
        writeRegenIntents(dirs, intents)
        // ②封存狀態檔(連 .prev;主檔缺亦封存 .prev——否則新核心首次寫入前狀態檔若損壞,會自舊版 .prev 還原出被打掉之核心)
        const archived = []
        const st = store.archive(id, ARCHIVE_TAGS.regen, stamp)
        if (st) archived.push(st.replace(/\\/g, '/'))
        // ③封存 md(撞名加序號)
        if (fs.existsSync(mdFile)) {
            fs.mkdirSync(aux.archive, { recursive: true })
            const to = uniquePath(path.join(aux.archive, `${id}.md.${ARCHIVE_TAGS.regen}-${stamp}`), '.md')
            fs.renameSync(mdFile, to)
            archived.push(to.replace(/\\/g, '/'))
        }
        messages.push(archived.length ? `已封存：${archived.join('、')}` : '無狀態檔與 md 可封存（已封存或不存在）')
        // ④刪記錄(集合介面;進行中之提煉若於其後寫回,會因狀態檔已封存而 CAS 失敗、不寫投影)
        if (target) {
            await stores.cores.del(id)
            messages.push('已刪除核心索引記錄')
        }
        // ⑤結案該核心之待判(未結與已豁免;新核心沿用同一 id、條目編號重新配發——舊登錄與舊裁示不得作用於新條目)
        const holdsResolved = []
        for (const h of holdsToClose) {
            await resolveHold(stores.holds, h.id, { at, how })
            holdsResolved.push(h.id)
        }
        if (holdsResolved.length) messages.push(`已結案該核心之待判 ${holdsResolved.length} 則`)
        // ⑥標 done:失敗帳與影響留待由管線開工時消化
        intents.cores[id] = { ...intents.cores[id], done: true, doneAt: at }
        writeRegenIntents(dirs, intents)
        messages.push('重練意圖已記（管線下一輪開工時清其失敗帳與影響留待，再以現有筆記從頭重練）')
        return { ok: true, notFound: false, concept, version: target?.version ?? null, availableNotes: available.length, archived, holdsResolved, messages }
    }
    finally {
        lock?.release?.()
    }
}

export default { listCores, regenCore }
