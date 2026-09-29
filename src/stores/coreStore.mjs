// coreStore.mjs — 核心狀態檔(真理檔)之讀寫:缺檔／壞檔分流、上一版 .prev、壞檔隔離、版本 CAS、封存、手改偵測
//
// 【為何不沿用 readJson／巡檢之 writeAtomic】readJson 對缺檔與壞檔回同一 fallback——壞檔會被當成「沒有狀態」而重新匯入或
//   從空狀態起步,下次寫入即覆蓋真理;巡檢之原子寫在 rename 被拒時退回直接覆寫(投影可重建,真理不可)。
//   (2026-09-29 雙審定案 tmp/wke-distill-b-全盤.md §11.1 A12～A16)
// 【CAS】管線載入狀態後、寫回之前,若維運工具(regenCore 封存、安裝方之實驗台)動了同一檔,後寫者會蓋掉對方;
//   寫前重讀磁碟上之寫入序號(rev),與載入時不同即中止——不需改維運工具之呼叫介面,亦涵蓋「鎖被停用之第二實例」。
//   比 rev 不比 version:只落帳(略過、逾限標已用)之寫入不升知識版本,比 version 會看不見(第二輪判識 A exp5)。
// 【手改偵測】核心 md 在 1.x 是唯一真理,使用者可能手改過;2.0 起 md 是投影、每版覆寫——覆寫前比對上次渲染之雜湊,
//   不符即先另存一份再覆寫(「覆寫前先看目標」),不讓手改內容無聲消失。

import fs from 'fs'
import path from 'path'
import isestr from 'wsemi/src/isestr.mjs'
import { writeFileAtomic } from '../util/misc.mjs'
import { sha1 } from '../util/text.mjs'
import { upgradeState } from './coreState.mjs'

/**
 * md 文字之雜湊(換行統一、去尾空白後計;編輯器改換行格式不算手改)
 *
 * @param {String} text 輸入 md 全文
 * @returns {String} 回傳雜湊字串
 */
export function mdHashOf(text) {
    return sha1(String(text ?? '').replace(/\r\n/g, '\n').trimEnd())
}

/**
 * 建立核心狀態檔之存取器
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.dir 輸入狀態檔目錄(檔名 <coreId>.state.json)
 * @param {String} [opt.prevDir] 輸入上一版之目錄(檔名 <coreId>.state.prev.json)，預設同 dir
 * @param {String} [opt.archiveDir] 輸入隔離與封存檔之目錄(壞檔、regenCore、分身)，預設同 dir
 * @returns {Object} 回傳 { dir, prevDir, fileOf, prevOf, load, loadPrev, diskRev, save, quarantine, archive, guardManualEdit }
 * @throws {Error} opt.dir 非有效字串時拋出
 */
export function createCoreStore(opt) {
    if (!isestr(opt?.dir)) throw new Error('createCoreStore 需要 dir（狀態檔目錄）')
    const dir = opt.dir
    const prevDir = isestr(opt.prevDir) ? opt.prevDir : dir
    const archiveDir = isestr(opt.archiveDir) ? opt.archiveDir : dir
    const fileOf = (coreId) => path.join(dir, `${coreId}.state.json`)
    const prevOf = (coreId) => path.join(prevDir, `${coreId}.state.prev.json`)

    /**
     * 讀單一狀態檔並分流
     *
     * @param {String} file 輸入檔案路徑
     * @returns {Object} 回傳 { status:'missing'|'ok'|'corrupt'|'newer'|'error', state?, text?, error? }
     */
    function readFile(file) {
        let text
        try {
            text = fs.readFileSync(file, 'utf8')
        }
        catch (e) {
            return e.code === 'ENOENT' ? { status: 'missing' } : { status: 'error', error: e.message }
        }
        let raw
        try {
            raw = JSON.parse(text)
        }
        catch (e) {
            return { status: 'corrupt', error: `JSON 解析失敗：${e.message}` }
        }
        try {
            return { status: 'ok', state: upgradeState(raw), text }
        }
        catch (e) {
            return { status: /新於本套件支援/.test(e.message) ? 'newer' : 'corrupt', error: e.message }
        }
    }

    /**
     * 載入狀態:缺檔 → missing(由呼叫端匯入或自空起步);壞檔 → 試 .prev,救得回者 recovered(呼叫端須先隔離壞檔)
     *
     * @param {String} coreId 輸入核心 id
     * @returns {Object} 回傳 { status:'missing'|'ok'|'recovered'|'corrupt'|'newer'|'error', state?, error? }
     */
    function load(coreId) {
        const r = readFile(fileOf(coreId))
        if (r.status !== 'corrupt') return r
        const p = readFile(prevOf(coreId))
        if (p.status === 'ok') return { status: 'recovered', state: p.state, error: r.error }
        return r
    }

    /**
     * 讀上一版(.prev):2.0 狀態檔遺失(誤刪、clone 時被 .gitignore 排除、維運交錯)時之還原來源
     *
     * @param {String} coreId 輸入核心 id
     * @returns {Object} 回傳同 readFile 之分流結果
     */
    function loadPrev(coreId) {
        return readFile(prevOf(coreId))
    }

    /**
     * 磁碟上現存狀態之寫入序號(CAS 用)
     *
     * @param {String} coreId 輸入核心 id
     * @returns {Number|null} 回傳 rev；缺檔回 null；壞檔或讀取失敗回 NaN(必不相等)
     */
    function diskRev(coreId) {
        const r = readFile(fileOf(coreId))
        if (r.status === 'missing') return null
        return r.status === 'ok' ? r.state.rev : NaN
    }

    /**
     * 寫回狀態(CAS:磁碟 rev 須等於 expectRev,缺檔對應 null);寫前把現存檔存為 .prev;原子寫、不退回覆寫;寫出者 rev＋1
     *
     * @param {String} coreId 輸入核心 id
     * @param {Object} state 輸入狀態
     * @param {Object} o 輸入 { expectRev:Number|null }(載入時之 rev；新建或匯入者為 null)
     * @returns {Object} 回傳寫出之狀態(rev 已＋1)
     * @throws {Error} CAS 不符(他處改動)或寫檔失敗時拋出(磁碟內容不變)
     */
    function save(coreId, state, o = {}) {
        const file = fileOf(coreId)
        const cur = readFile(file)
        const curRev = cur.status === 'missing' ? null : (cur.status === 'ok' ? cur.state.rev : NaN)
        const expect = o?.expectRev ?? null
        if (!(curRev === expect)) {
            throw new Error(`核心狀態已被他處改動（載入時 rev ${expect ?? '無檔'}、磁碟現為 ${Number.isNaN(curRev) ? '無法讀取' : (curRev ?? '無檔')}），本次不寫入：${file}`)
        }
        // rev 延續遞增:自 .prev 還原者(磁碟已無檔,expect 為 null)仍接續其原 rev,不歸 1——否則投影之 rev 反而較大,被誤判為狀態倒退
        const next = { ...state, rev: Math.max(expect ?? 0, Number(state?.rev) || 0) + 1 }
        if (cur.status === 'ok') writeFileAtomic(prevOf(coreId), cur.text)
        writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        return next
    }

    /**
     * 改名移開現存狀態檔(不刪):壞檔隔離用 tag 'corrupt'、regenCore 用 'regen'、分身用 'merged'
     *
     * @param {String} coreId 輸入核心 id
     * @param {String} tag 輸入標籤
     * @param {String} stamp 輸入時間戳(檔名用)
     * @returns {String} 回傳改名後之路徑；原檔不存在回''
     */
    function archiveAs(coreId, tag, stamp) {
        const file = fileOf(coreId)
        if (!fs.existsSync(file)) return ''
        const to = path.join(archiveDir, `${path.basename(file)}.${tag}-${stamp}`)
        fs.mkdirSync(archiveDir, { recursive: true })
        fs.renameSync(file, to)
        return to
    }

    /**
     * 覆寫 md 前之手改偵測:現存 md 之雜湊不在「最近兩次渲染」之中 → 先另存副本(於 manualDir,副檔名 .txt,不讓筆記工具當成另一篇核心)
     *
     * 比對兩次:狀態先寫、md 後寫——md 寫前中斷時,磁碟上仍是上一次渲染(判識 A exp7①);無雜湊(1.x 舊核心首次渲染)不比對。
     *
     * @param {String} mdFile 輸入核心 md 路徑
     * @param {Array} hashes 輸入最近之渲染雜湊(狀態之 renderHashes；空陣列代表無從比對,不動作)
     * @param {String} stamp 輸入時間戳(檔名用)
     * @param {String} manualDir 輸入副本目錄
     * @returns {String} 回傳另存之路徑；未另存回''
     */
    function guardManualEdit(mdFile, hashes, stamp, manualDir) {
        const known = (Array.isArray(hashes) ? hashes : [hashes]).filter(Boolean)
        if (!known.length || !fs.existsSync(mdFile)) return ''
        const text = fs.readFileSync(mdFile, 'utf8')
        if (known.includes(mdHashOf(text))) return ''
        const to = path.join(manualDir || path.dirname(mdFile), `${path.basename(mdFile).replace(/\.md$/i, '')}.${stamp}.manual.txt`)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.copyFileSync(mdFile, to)
        return to
    }

    return {
        dir,
        prevDir,
        fileOf,
        prevOf,
        load,
        loadPrev,
        diskRev,
        save,
        quarantine: (coreId, stamp) => archiveAs(coreId, 'corrupt', stamp),
        archive: archiveAs,
        guardManualEdit,
    }
}

export default createCoreStore
