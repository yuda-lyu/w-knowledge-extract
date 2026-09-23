// runJsonCli.mjs — 以子進程執行 CLI 腳本,腳本把結果寫成 JSON 檔,本函數讀回並回傳;進度逐行回調(泛用件,自 tai-news 之執行殼移入)
//
// 【本套件自身不用它】本套件之正文抓取在行程內直呼 w-fetch-web(fetchers/articleParse);本檔服務的是
//   「排程殼不相依重量級抓取器」的消費端(tai-news 以子進程跑 fetch_web_cli.mjs)。
//
// 【為何用子進程而非同進程直接 import】會啟動瀏覽器(playwright／camofox)或其他重量級外部資源的抓取器,若在主進程同步呼叫:
//   ①卡死會拖住整條管線——失去強制中斷的能力,逾時保護形同虛設。
//   ②失去進程樹清理。Windows 上 playwright 以 non-detached 方式啟動瀏覽器且不用 Job Object,唯一負責殺瀏覽器的 taskkill
//     掛在 node 的 exit／signal handler 內;node 被強制終止(TerminateProcess、崩潰、OOM)時 handler 全不執行,
//     瀏覽器整棵孤兒化,服務反覆重啟則逐次疊加。
//   故維持「子進程執行 ＋ execCli 控管逾時與 tree kill」的保護。
//
// 【為何結果走檔案而非 stdout】stdout 會混入抓取器自身的進度訊息與第三方套件的雜訊輸出(瀏覽器警告、下載提示),
//   要從中切出乾淨的 JSON 既脆弱又會隨版本漂移。走檔案則兩者天然分離:stdout 專供進度觀察,檔案專供結果傳遞。
//
// 【為何要接進度回調】重試與階梯升級(curl → headless → headed → 反偵測瀏覽器)的歷程只存在於子進程的 stdout／stderr。
//   接上後可即時看出單次卡在哪一層,不必等最終失敗才從 stderr 摘要回推。
//
// 【為何失敗也回結構化物件而非拋錯】呼叫端通常是「逐項處理、允許個別失敗」的迴圈,拋錯會讓每個呼叫點都得包 try/catch;
//   統一形狀則可直接判 status。

import fs from 'fs'
import execCli from 'wsemi/src/execCli.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isstr from 'wsemi/src/isstr.mjs'
import { cliFailDetail } from '../util/misc.mjs'

/**
 * 把串流 chunk 累積成完整行後逐行回調(僅回傳指定前綴之行)。
 * 【為何不能直接對 chunk 切行】chunk 邊界不保證落在換行處,最後一段可能是半行,須留待下個 chunk 接續,否則會拼出壞行。
 * 【為何兩個串流要各自建立一份】stdout 與 stderr 共用同一緩衝時,兩邊的半行會互相插隊,組出的行既不屬於前者也不屬於後者。
 *
 * @param {Function} onLine 輸入逐行回調函數 (line:String) => void
 * @param {String} prefix 輸入只保留之行前綴字串，非字串視為''(全收)
 * @returns {Function} 回傳 chunk 接收函數 (chunk) => void
 * @throws {Error} onLine 非函數時拋出
 * @example
 * const lines = []
 * const feed = makeLineEmitter((l) => lines.push(l), '[x]')
 * feed('[x]a\n[y]b\n[x]c')
 * feed('d\n')
 * console.log(lines)
 * // => [ '[x]a', '[x]cd' ]
 */
export function makeLineEmitter(onLine, prefix) {

    //check
    if (!isfun(onLine)) {
        throw new Error('makeLineEmitter 需要 onLine 函數')
    }
    if (!isstr(prefix)) {
        prefix = ''
    }

    let buf = ''
    return (chunk) => {
        buf += chunk
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ''
        for (const ln of lines) {
            const s = ln.trim()
            if (!s) continue // 空行不回報:prefix 為空(全收)時,子進程的空白輸出行會變成空進度訊息
            if (!prefix || s.startsWith(prefix)) onLine(s)
        }
    }
}

/**
 * 以子進程執行 CLI 腳本,腳本把結果寫成 JSON 檔,本函數讀回並回傳;進度逐行回調(見檔頭三段設計說明)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}
 * @param {String} opt.script 輸入 CLI 腳本路徑字串(必填)
 * @param {String} opt.outputPath 輸入結果 JSON 檔路徑字串(必填;腳本路徑與 outputPath 由本函數安排為 [script, ...args, outputPath])
 * @param {Array} [opt.args=[]] 輸入傳給腳本之額外參數陣列，非陣列視為[]
 * @param {String} [opt.exe='node'] 輸入執行檔名稱
 * @param {Integer} [opt.timeoutMs] 輸入單次執行逾時毫秒;須涵蓋腳本內部最壞重試週期,過短會誤砍而讓失敗原因變成「逾時」,掩蓋真正的失敗點
 * @param {String} [opt.cwd] 輸入子進程工作目錄
 * @param {Integer} [opt.maxRetries=0] 輸入重試次數
 * @param {Function} [opt.onProgress] 輸入進度回調 (line, isErr) => void
 * @param {String} [opt.progressPrefix=''] 輸入只回報之行前綴字串,用於濾掉 CLI 自身的收尾訊息
 * @returns {Promise} 回傳 Promise，resolve 回傳腳本寫出之 JSON 物件；失敗時 resolve 為 { status:'error', message }(不 reject)
 * @throws {Error} opt.script 或 opt.outputPath 缺漏時拋出
 * @example
 * need test in nodejs.
 *
 * const r = await runJsonCli({ script: './tools/fetch_cli.mjs', outputPath: './tmp/out.json', timeoutMs: 30000 })
 */
export async function runJsonCli(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { script, outputPath, exe = 'node', timeoutMs, cwd, maxRetries = 0, onProgress, progressPrefix = '' } = opt
    if (!isestr(script)) {
        throw new Error('runJsonCli 需要 script')
    }
    if (!isestr(outputPath)) {
        throw new Error('runJsonCli 需要 outputPath')
    }

    //args
    let args = opt.args
    if (!isarr(args)) {
        args = []
    }

    const hasCb = isfun(onProgress)
    const onStdout = hasCb ? makeLineEmitter((line) => onProgress(line, false), progressPrefix) : undefined
    const onStderr = hasCb ? makeLineEmitter((line) => onProgress(line, true), progressPrefix) : undefined

    const result = await execCli(exe, [script, ...args, outputPath], { timeoutMs, cwd, maxRetries, onStdout, onStderr })

    if (!result.ok) {
    // 帶上嘗試次數與 stderr:只取 stderr 末行常是堆疊尾巴或進度訊息,會漏掉真正的失敗原因
        return { status: 'error', message: `${result.error}${cliFailDetail(result)}` }
    }
    try {
        return JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    }
    catch (err) {
        return { status: 'error', message: `JSON parse failed: ${err?.message || err}` }
    }
}

export default runJsonCli
