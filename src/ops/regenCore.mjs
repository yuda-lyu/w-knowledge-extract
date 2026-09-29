// regenCore.mjs — 令指定概念的核心知識「打掉重練」(維運能力;CLI 殼在執行端)
//
// 【為何需要】模型輸出品質無法用程式可靠判定(規則式偵測會誤殺專有名詞音譯),故提供人工修復:
//   封存該概念之核心狀態與 md、刪核心記錄,下一輪以現有筆記從頭重練(v1),筆記本身不受影響。
// 【2.0 之變更(2026-09-29 雙審定案 tmp/wke-distill-b-全盤.md §11～§12)】
//   ①以 coreForKey 選主核心(1.x 以 find 取第一筆,同鍵多核心時與選題綁定不一致);
//   ②先刪記錄、再封存狀態檔與 md——與進行中之提煉交錯時,提煉之 CAS(rev 比對)使其不寫回;不刪檔(改名封存);
//   ③不再清 distilledAt:2.0 之「已用過」是逐核心累積出處(狀態之 consumed),distilledAt 只是「曾被任一核心用過」之標記,
//     清掉會讓其他核心之統計失真;④清該核心之失敗帳(否則重練後舊 noteTries 仍在,一次未涵蓋即逾限);
//   ⑤給 lockFile 時取執行鎖(管線持鎖中即拒絕),避免與管線同時動同一核心。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { normalizeConcept } from '../util/text.mjs'
import { readJson, writeFileAtomic } from '../util/misc.mjs'
import { coreForKey } from '../stores/conceptGroups.mjs'
import { createCoreStore } from '../stores/coreStore.mjs'
import { acquireLock } from '../core/lock.mjs'

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
    return cores.filter((c) => c.status !== 'merged').sort((a, b) => (b.version || 0) - (a.version || 0) || (b.noteCount || 0) - (a.noteCount || 0))
}

/**
 * 打掉指定概念的核心:刪核心記錄 → 封存狀態檔與 md(改名至 dirs.state/core/archive,不刪)→ 清該核心之失敗帳;
 * 下一輪以現有筆記從頭重練(v1),筆記本身與其 distilledAt 皆不受影響
 *
 * @param {Object} stores 輸入集合物件，需含 cores、notes(w-data-pipeline openCollection 介面)
 * @param {String} conceptArg 輸入欲重練之概念名稱字串(以 normalizeConcept 正規化後比對；先找概念層、再找類別層)
 * @param {Object} opt 輸入設定物件(2.0 起必填)
 * @param {Object} opt.dirs 輸入目錄物件(createKnowledgeExtract(...).info().dirs；取 core、coreState、state)
 * @param {String} [opt.lockFile] 輸入執行鎖檔路徑(info().lockFile)，給了即取鎖、管線持鎖中即拒絕
 * @param {String} [opt.stamp] 輸入封存檔名之時間戳，預設現在時刻
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok:Boolean, notFound:Boolean, locked?:Boolean, concept, version, availableNotes, archived:Array, messages:Array }
 * @throws {Error} stores 缺必要方法、或 opt.dirs 缺 core／state 時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await regenCore(stores, '注意力機制', { dirs: flow.info().dirs, lockFile: flow.info().lockFile })
 * console.log(r.ok)
 */
export async function regenCore(stores, conceptArg, opt = {}) {

    //check, 本函數實際用到之集合方法須一併檢查(缺者要到刪檔之後才拋原生 TypeError,留下半套狀態)
    if (!isobj(stores) || !isobj(stores.cores) || !isfun(stores.cores.select)) {
        throw new Error('regenCore 需要 stores.cores.select（cores 集合）')
    }
    if (!isfun(stores.cores.raw?.del)) {
        throw new Error('regenCore 需要 stores.cores.raw.del（openCollection 之 raw ORM）')
    }
    if (!isobj(stores.notes) || !isfun(stores.notes.select)) {
        throw new Error('regenCore 需要 stores.notes.select（notes 集合）')
    }
    if (!isobj(opt) || !isobj(opt.dirs) || !isestr(opt.dirs.core) || !isestr(opt.dirs.state)) {
        throw new Error('regenCore 於 2.0 起需要 opt.dirs（flow.info().dirs：核心狀態檔與封存目錄由此取得）')
    }
    if (!isestr(conceptArg)) {
        return { ok: false, notFound: true, archived: [], messages: [`找不到概念「${conceptArg}」的核心知識`] }
    }

    let lock = null
    if (isestr(opt.lockFile)) {
        lock = acquireLock(opt.lockFile)
        if (!lock.ok) return { ok: false, notFound: false, locked: true, archived: [], messages: [`管線執行中，未重練：${lock.message}`] }
    }
    try {
        const dirs = opt.dirs
        const stamp = isestr(opt.stamp) ? opt.stamp : new Date().toISOString().replace(/\D/g, '').slice(0, 14)
        const archiveDir = path.join(dirs.state, 'core', 'archive')
        const key = normalizeConcept(conceptArg)
        const cores = await stores.cores.select()
        const target = coreForKey(cores, 'concept', key) || coreForKey(cores, 'category', key)
        if (!target) return { ok: false, notFound: true, archived: [], messages: [`找不到概念「${conceptArg}」的核心知識`] }

        const messages = []
        const notes = await stores.notes.select()
        const available = notes.filter((n) => (n.concepts || []).some((c) => normalizeConcept(c) === key))
        messages.push(`概念「${target.concept}」：現為 v${target.version}（依據 ${target.noteCount} 篇），可用筆記 ${available.length} 篇`)

        // 先刪記錄:進行中之提煉若於其後寫回,會因狀態檔已封存而 CAS 失敗、不寫投影
        await stores.cores.raw.del({ id: target.id })
        messages.push('已刪除核心索引記錄')
        const archived = []
        const store = createCoreStore({ dir: dirs.coreState || dirs.core, prevDir: path.join(dirs.state, 'core', 'prev'), archiveDir })
        const st = store.archive(target.id, 'regen', stamp)
        if (st) archived.push(st.replace(/\\/g, '/'))
        const mdFile = target.file || path.join(dirs.core, `${target.id}.md`)
        if (fs.existsSync(mdFile)) {
            fs.mkdirSync(archiveDir, { recursive: true })
            const to = path.join(archiveDir, `${target.id}.md.regen-${stamp}.md`)
            fs.renameSync(mdFile, to)
            archived.push(to.replace(/\\/g, '/'))
        }
        messages.push(archived.length ? `已封存：${archived.join('、')}` : '無狀態檔與 md 可封存')

        // 清該核心之失敗帳(含批內重送次數)
        const ledgerFile = path.join(dirs.state, 'distill-attempts.json')
        const ledger = readJson(ledgerFile, null)
        const lk = `${target.scope || 'concept'}|${key}`
        if (isobj(ledger) && ledger[lk]) {
            delete ledger[lk]
            writeFileAtomic(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`)
            messages.push('已清除該核心之失敗帳')
        }
        return { ok: true, notFound: false, concept: target.concept, version: target.version, availableNotes: available.length, archived, messages }
    }
    finally {
        lock?.release?.()
    }
}

export default { listCores, regenCore }
