// lock.mjs — 單例執行鎖，避免排程重疊（泛用件，自原專案抽提並參數化）
//
// 【陳舊鎖】前次執行被強制中止（TerminateProcess／當機）時 finally 不會執行，鎖檔殘留。
//   故鎖檔記 pid 與時間：超過 staleMs 或該 pid 已不存在即視為殘留可接管——
//   否則一次崩潰就會讓排程永久停擺。
//
// 【只釋放自己的鎖】release 須確認鎖檔仍是自己寫入的那一份才刪除：本實例若跑過 staleMs 而被下一實例接管，
//   無條件刪除會把接管者的鎖一併刪掉，第三個實例即可與接管者並行（2026-09-23 修）。
//
// 【與 w-data-pipeline 的 lock 介面相容】回傳 { ok, message, release }，
//   可直接作為 definePipeline 的 spec.lock。

import fs from 'fs'
import path from 'path'
import get from 'lodash-es/get.js'
import cint from 'wsemi/src/cint.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'


/**
 * 判斷行程是否存活(送出 signal 0 探測,不影響目標行程)
 *
 * @param {Integer} pid 輸入行程 id 整數
 * @returns {Boolean} 回傳是否存活，存在但無權限(EPERM)亦視為存活
 */
function pidAlive(pid) {
    try {
        process.kill(pid, 0)
        return true
    }
    catch (e) {
        return e.code === 'EPERM' // 存在但無權限 → 仍視為活著
    }
}


/**
 * 取得單例執行鎖
 *
 * 鎖檔不存在、內容損壞、逾 staleMs、或記錄之 pid 已不存在者視為可接管;否則回傳 ok:false 與占用說明。
 * release 只刪除自己寫入的那一份鎖檔(被接管後不誤刪他人之鎖)
 *
 * @param {String} file 輸入鎖檔路徑字串，父目錄不存在時自動建立
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Integer} [opt.staleMs=3600000] 輸入鎖檔視為殘留之毫秒數正整數，預設3600000(1小時)
 * @returns {Object} 回傳結果物件，取得時為 { ok:true, release:Function }，被占用時為 { ok:false, message:String }
 * @throws {Error} file 非有效字串時拋出
 * @example
 * need test in nodejs.
 *
 * let lock = acquireLock('./tmp/run.lock', { staleMs: 3600000 })
 * if (lock.ok) {
 *     try {
 *         //執行任務
 *     }
 *     finally {
 *         lock.release()
 *     }
 * }
 * else {
 *     console.log(lock.message)
 *     // => 另一個執行中（pid 1234，已執行 12s）
 * }
 */
export function acquireLock(file, opt = {}) {

    //check
    if (!isestr(file)) {
        throw new Error('acquireLock 需要 file（鎖檔路徑字串）')
    }
    if (!isobj(opt)) {
        opt = {}
    }

    //staleMs
    let staleMs = get(opt, 'staleMs', null)
    if (!ispint(staleMs)) {
        staleMs = 3600000
    }
    staleMs = cint(staleMs)

    fsCreateFolder(path.dirname(file))
    let prev = null
    try {
        prev = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
    catch { /* 無鎖檔或壞檔皆視同無鎖 */ }
    if (prev && typeof prev.pid === 'number') {
        const age = Date.now() - (prev.at || 0)
        if (age < staleMs && pidAlive(prev.pid) && prev.pid !== process.pid) {
            return { ok: false, message: `另一個執行中（pid ${prev.pid}，已執行 ${(age / 1000).toFixed(0)}s）` }
        }
    }
    const token = { pid: process.pid, at: Date.now() }
    fs.writeFileSync(file, JSON.stringify(token), 'utf8')
    return {
        ok: true,
        release: () => {
            // 只刪自己的鎖:鎖檔已被他實例接管(pid 或時間戳不同)或已不存在即不動
            try {
                const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
                if (cur?.pid !== token.pid || cur?.at !== token.at) return
            }
            catch {
                return // 已被清掉或壞檔:不動
            }
            try {
                fs.unlinkSync(file)
            }
            catch { /* 已被清掉 */ }
        }
    }
}


export default acquireLock
