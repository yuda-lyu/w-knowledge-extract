// coreStore.mjs — 核心狀態檔(真理檔)之讀寫:缺檔／壞檔分流、上一版 .prev、壞檔隔離、版本 CAS、封存、手改偵測、四態分流表
//
// 【為何不沿用 readJson 與一般之原子寫】readJson 對缺檔與壞檔回同一 fallback——壞檔會被當成「沒有狀態」而
//   從空狀態起步,下次寫入即覆蓋真理;一般之原子寫(如監控紀錄所用者)在 rename 被拒時退回直接覆寫(投影可重建,真理不可)。
// 【壞檔與缺檔之還原來源是 .prev】壞檔隔離(標記 corrupt)不移走 .prev——移走即「毀損且無上一版」,原可救回者變成救不回;打掉重練
//   (regen)與分身併入(merged)才連 .prev 一併封存(否則其後首次寫入前狀態檔若損壞,會自舊版 .prev「還原」出被打掉之核心)。
// 【四態分流表只一份】loadUsable 把 ok／recovered／missing／corrupt／foreign／error 分流為可讀、可寫兩個旗標(附原因);消費者只讀旗標,
//   不各自判 status——recovered(由上一版讀出而尚未修復)可讀不可寫,寫入消費者拒並指引跑提煉段之維護(隔離、落盤修復)。
// 【CAS】管線載入狀態後、寫回之前,若維運工具(regenCore 封存、安裝方之實驗台)動了同一檔,後寫者會蓋掉對方;
//   寫前重讀磁碟上之寫入序號(rev),與載入時不同即中止——不需改維運工具之呼叫介面,亦涵蓋「鎖被停用之第二實例」。
//   比 rev 不比 version:只落帳(略過、逾限標已用)之寫入不升知識版本,比 version 會看不見。
// 【手改偵測】核心 md 是投影、每版覆寫,使用者可能手改過——覆寫前比對上次渲染之雜湊,
//   不符即先另存一份再覆寫(「覆寫前先看目標」),不讓手改內容無聲消失。

import fs from 'fs'
import path from 'path'
import isestr from 'wsemi/src/isestr.mjs'
import { writeFileAtomic } from '../core/capturePackage.mjs'
import { sha1 } from '../core/capturePackage.mjs'
import { normalizeState, FOREIGN_STATE_CODE } from './coreState.mjs'

/** 封存之標記(檔名後綴 .<標記>-<時刻>):壞檔隔離 corrupt、打掉重練 regen、分身併入 merged、回退(被回退之版本之副本)rollback */
export const ARCHIVE_TAGS = Object.freeze({ corrupt: 'corrupt', regen: 'regen', merged: 'merged', rollback: 'rollback' })

/**
 * 該核心是否有某標記之狀態檔封存(封存目錄下 `<核心 id>.state.json.<標記>-…`,或只封存了上一版時之 `<核心 id>.state.prev.json.<標記>-…`——
 *   主檔缺而 .prev 在時之封存只有後者);封存目錄不存在回 false
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @param {String} coreId 輸入核心 id
 * @param {String} tag 輸入封存標記(ARCHIVE_TAGS 之值)
 * @returns {Boolean} 回傳是否有
 * @example
 * console.log(hasCoreArchive({ state: 'no/such/dir' }, 'c-1', 'regen'))
 * // => false
 */
export function hasCoreArchive(dirs, coreId, tag) {
    const dir = coreAuxDirs(dirs).archive
    if (!fs.existsSync(dir)) return false
    const heads = [`${coreId}.state.json.${tag}-`, `${coreId}.state.prev.json.${tag}-`]
    return fs.readdirSync(dir).some((f) => heads.some((h) => f.startsWith(h)))
}

/**
 * 核心狀態檔之目錄:dirs.coreState(非空字串者);未給者＝dirs.core(狀態檔與核心 md 同處)
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 coreState、core)
 * @returns {String} 回傳狀態檔目錄
 * @example
 * console.log(coreStateDirOf({ core: 'k/core' }), coreStateDirOf({ core: 'k/core', coreState: 's/core' }))
 * // => k/core s/core
 */
export function coreStateDirOf(dirs) {
    return isestr(dirs?.coreState) ? dirs.coreState : dirs?.core
}

/**
 * 核心之附屬目錄(dirs.state/core 下,不在知識目錄內):上一版 .prev、隔離／封存檔、手改副本、待投影標記
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 state)
 * @returns {Object} 回傳 { prev, archive, manual, dirty }
 * @example
 * need test in nodejs.
 *
 * const aux = coreAuxDirs(dirs)
 */
export function coreAuxDirs(dirs) {
    const base = path.join(dirs.state, 'core')
    return { prev: path.join(base, 'prev'), archive: path.join(base, 'archive'), manual: path.join(base, 'manual'), dirty: path.join(base, 'dirty') }
}

/**
 * 核心狀態檔之存取器(單一工廠):狀態目錄取 coreStateDirOf、上一版與封存取 coreAuxDirs——提煉段、維運(重練、重審預覽)與存量處置同一組目錄,
 *   壞檔時自同一處之上一版還原
 *
 * @param {Object} dirs 輸入每輪依賴之 dirs(取 coreState、core、state)
 * @returns {Object} 回傳 createCoreStore 之存取器
 * @example
 * need test in nodejs.
 *
 * const store = coreStoreOf(dirs)
 * const { state } = await store.loadUsable(coreId)
 */
export function coreStoreOf(dirs) {
    const aux = coreAuxDirs(dirs)
    return createCoreStore({ dir: coreStateDirOf(dirs), prevDir: aux.prev, archiveDir: aux.archive })
}

/**
 * 寫出之 rev(save 之序號規則一份;先記後寫之登錄據以預記「本次落盤後之 rev」):max(CAS 期待值, 狀態之 rev)＋1——自 .prev 還原者(磁碟已無檔,期待 null)
 *   仍接續其原 rev、不歸 1(否則投影之 rev 反而較大,被誤判為狀態倒退)
 *
 * @param {Number|null} expectRev 輸入 CAS 期待值(載入時之 rev;新建或匯入者為 null)
 * @param {Object} state 輸入欲寫之狀態
 * @returns {Number} 回傳寫出之 rev
 * @example
 * console.log(nextRevOf(3, { rev: 3 }), nextRevOf(null, { rev: 7 }))
 * // => 4 8
 */
export function nextRevOf(expectRev, state) {
    return Math.max(expectRev ?? 0, Number(state?.rev) || 0) + 1
}

/**
 * md 文字之雜湊(換行統一、去尾空白後計;編輯器改換行格式不算手改)
 *
 * @param {String} text 輸入 md 全文
 * @returns {String} 回傳雜湊字串
 * @example
 * console.log(mdHashOf('甲\r\n乙  \n') === mdHashOf('甲\n乙\n'))
 * // => true
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
 * @returns {Object} 回傳 { dir, prevDir, fileOf, prevOf, load, loadUsable, loadPrev, diskRev, save, quarantine, archive, snapshot, guardManualEdit }
 * @throws {Error} opt.dir 非有效字串時拋出
 * @example
 * need test in nodejs.
 *
 * const store = createCoreStore({ dir: `${workDir}/state/core` })
 * await store.save(coreId, state, { expectRev: null })
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
     * @returns {Object} 回傳 { status:'missing'|'ok'|'corrupt'|'foreign'(非本格式版本)|'error', state?, text?, error? }
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
            return { status: 'ok', state: normalizeState(raw), text }
        }
        catch (e) {
            // 非本格式版本之狀態檔:不當壞檔(不隔離、不以 .prev 覆蓋),由呼叫端記 ERROR 並跳過——本套件不轉換他種格式
            return { status: e?.code === FOREIGN_STATE_CODE ? 'foreign' : 'corrupt', error: e.message }
        }
    }

    /**
     * 載入狀態:壞檔或缺檔 → 試 .prev,救得回者 recovered(呼叫端須修復:壞檔先隔離、再以之落盤;lost 標記缺檔——隔離無對象、訊息不同);
     *   缺檔而無 .prev → missing(新核心自空起步;有記錄者由呼叫端拒);壞檔而無 .prev → corrupt
     *
     * @param {String} coreId 輸入核心 id
     * @returns {Object} 回傳 { status:'missing'|'ok'|'recovered'|'corrupt'|'foreign'|'error', state?, error?, lost?:Boolean(recovered 且主檔缺) }
     */
    function load(coreId) {
        const r = readFile(fileOf(coreId))
        if (r.status === 'ok' || r.status === 'foreign' || r.status === 'error') return r
        const p = readFile(prevOf(coreId))
        if (p.status === 'ok') return { status: 'recovered', state: p.state, error: r.status === 'corrupt' ? r.error : '狀態檔遺失', lost: r.status === 'missing' }
        return r
    }

    /**
     * 載入並分流為可讀／可寫(四態分流表一份;消費者只讀 readable／writable,不各自判 status):ok → 可讀、可寫;recovered(壞檔或缺檔而由上一版讀出)
     *   → 可讀、不可寫(須先經提煉段之修復——隔離、高水位、落盤);missing／corrupt／foreign／error → 皆否(why 載明)
     *
     * @param {String} coreId 輸入核心 id
     * @returns {Object} 回傳 { status, state:Object|null, expectRev:Number|null(可寫者之 CAS 期待值), readable:Boolean, writable:Boolean, lost:Boolean, error:String, why:String(不可寫之原因;可寫者'') }
     */
    function loadUsable(coreId) {
        const r = load(coreId)
        const base = { status: r.status, state: r.state || null, expectRev: null, readable: false, writable: false, lost: r.lost === true, error: r.error || '', why: '' }
        if (r.status === 'ok') return { ...base, expectRev: r.state.rev, readable: true, writable: true }
        if (r.status === 'recovered') return { ...base, readable: true, why: `狀態檔${r.lost ? '遺失' : '毀損'}，已由上一版讀出但尚未修復（跑一輪提煉段，其維護即隔離並落盤修復）` }
        const word = { missing: '狀態檔不存在', corrupt: '狀態檔毀損且無上一版可還原', foreign: '狀態檔非本格式版本', error: '狀態檔讀取失敗' }[r.status] || `狀態檔 ${r.status}`
        return { ...base, why: `${word}${r.error ? `（${r.error}）` : ''}` }
    }

    /**
     * 讀上一版(.prev):狀態檔遺失(誤刪、clone 時被 .gitignore 排除、維運交錯)時之還原來源
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
        const next = { ...state, rev: nextRevOf(expect, state) }
        if (cur.status === 'ok') writeFileAtomic(prevOf(coreId), cur.text)
        writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        return next
    }

    /**
     * 不撞名之封存路徑:同一標記同一時戳已有者加 -1、-2 序號(同一輪對同一核心封存兩次——如維護段隔離後再選中——不覆寫前一份)
     *
     * @param {String} name 輸入原檔名
     * @param {String} tag 輸入標籤
     * @param {String} stamp 輸入時間戳
     * @returns {String} 回傳封存路徑
     */
    function archivePathOf(name, tag, stamp) {
        const base = path.join(archiveDir, `${name}.${tag}-${stamp}`)
        if (!fs.existsSync(base)) return base
        for (let n = 1; n < 1000; n++) {
            if (!fs.existsSync(`${base}-${n}`)) return `${base}-${n}`
        }
        throw new Error(`封存檔撞名逾 1000 份：${base}`)
    }

    /**
     * 改名移開現存狀態檔(不刪):標記取 ARCHIVE_TAGS——壞檔隔離(corrupt)保留 .prev(壞檔之還原來源);打掉重練(regen)與分身併入(merged)連 .prev 一併封存
     *   (主檔不在時亦封存 .prev:否則其後同 id 之新核心首次寫入前狀態檔若損壞,會自舊版 .prev 還原出被打掉之核心);撞名加序號
     *
     * @param {String} coreId 輸入核心 id
     * @param {String} tag 輸入標籤
     * @param {String} stamp 輸入時間戳(檔名用)
     * @returns {String} 回傳主檔改名後之路徑；主檔不存在回''
     */
    function archiveAs(coreId, tag, stamp) {
        const file = fileOf(coreId)
        let to = ''
        if (fs.existsSync(file)) {
            to = archivePathOf(path.basename(file), tag, stamp)
            fs.mkdirSync(archiveDir, { recursive: true })
            fs.renameSync(file, to)
        }
        const prev = prevOf(coreId)
        if (tag !== ARCHIVE_TAGS.corrupt && fs.existsSync(prev)) {
            fs.mkdirSync(archiveDir, { recursive: true })
            fs.renameSync(prev, archivePathOf(path.basename(prev), tag, stamp))
        }
        return to
    }

    /**
     * 複製現存狀態檔至封存目錄(不移動、不動 .prev;回退用:被回退之版本留一份副本,主檔仍在直到被新內容 CAS 取代);撞名加序號;主檔不存在回 ''
     *
     * @param {String} coreId 輸入核心 id
     * @param {String} tag 輸入標籤(ARCHIVE_TAGS 之值)
     * @param {String} stamp 輸入時間戳(檔名用)
     * @returns {String} 回傳副本路徑;主檔不存在回 ''
     */
    function snapshot(coreId, tag, stamp) {
        const file = fileOf(coreId)
        if (!fs.existsSync(file)) return ''
        const to = archivePathOf(path.basename(file), tag, stamp)
        fs.mkdirSync(archiveDir, { recursive: true })
        fs.copyFileSync(file, to)
        return to
    }

    /**
     * 覆寫 md 前之手改偵測:現存 md 之雜湊不在「最近兩次渲染」之中 → 先另存副本(於 manualDir,副檔名 .txt,不讓筆記工具當成另一篇核心)
     *
     * 比對兩次:狀態先寫、md 後寫——md 寫前中斷時,磁碟上仍是上一次渲染;無雜湊(新核心首次渲染)不比對。
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
        loadUsable,
        loadPrev,
        diskRev,
        save,
        quarantine: (coreId, stamp) => archiveAs(coreId, ARCHIVE_TAGS.corrupt, stamp),
        archive: archiveAs,
        snapshot,
        guardManualEdit,
    }
}

export default { ARCHIVE_TAGS, createCoreStore, nextRevOf, mdHashOf, coreStateDirOf, coreAuxDirs, coreStoreOf, hasCoreArchive }
