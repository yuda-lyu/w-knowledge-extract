// processGuards.mjs — 行程層級安全網:把「連 catch 都接不到的例外」記錄下來再退出(泛用件,自 tai-news 之執行殼移入)
//
// 【為何非有不可】排程執行沒有 console 可看,日誌是唯一的事後診斷來源。未捕捉例外與未處理 rejection 會讓 node 行程
//   直接結束,現象是「排程時間到了、但完全沒有紀錄、也沒有任何通知」——這與「排程根本沒觸發」在外觀上完全相同,
//   會把診斷方向整個帶偏。
//
// 【為何仍要 exit 而不續行】此時行程狀態已不可信(可能有半完成的寫入、未關閉的資料庫控制代碼)。續行只會在後續
//   產生更難解釋的次生錯誤。非零離開碼同時讓外部排程器記錄為失敗。
//
// 【為何不在此發送通知】通知是非同步且可能失敗的動作,而此刻行程正要退出,等待送出會拖住退出、失敗又會觸發
//   第二層例外。失敗通知交由 runTask 的 catch 路徑(那裡行程仍健全)處理。
//
// ※ 原專案之執行端(trigger)仍手寫同樣兩行 process.on(訊息落 console.error);改用本函數
//   須先決定 onFatal 落日誌的方式(其 logger 於組裝期才建立),列為已知不修(2026-09-21)。

import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'

/**
 * 掛上行程層級之未捕捉例外／未處理 rejection 安全網:記錄後以非零離開碼退出
 *
 * 排程執行沒有 console 可看,日誌是唯一的事後診斷來源;此時行程狀態已不可信(可能有半完成的寫入、
 * 未關閉的資料庫控制代碼),故續行只會產生更難解釋的次生錯誤,一律記錄後 exit。通知動作不在此發送
 * (見檔頭說明),失敗通知交由呼叫端(如 runTask 之 catch 路徑)於行程仍健全時處理。
 *
 * @param {Object} opt 輸入設定物件
 * @param {Function} opt.onFatal 輸入致命錯誤記錄函數 (msg:String) => void，必填(通常為記錄器之 error)
 * @param {Integer} [opt.exitCode=1] 輸入捕捉到例外後之離開碼
 * @returns {Function} 回傳解除函數(移除本次掛上的 handler,供測試使用)
 * @throws {Error} onFatal 非函數時拋出
 * @example
 * need test in nodejs.
 *
 * let uninstall = installProcessGuards({ onFatal: (msg) => logger.error(msg) })
 * // ...行程結束前
 * uninstall()
 */
export function installProcessGuards(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { onFatal, exitCode = 1 } = opt
    if (!isfun(onFatal)) throw new Error('installProcessGuards 需要 onFatal')

    /** 未捕捉例外之 handler:記錄後以 exitCode 退出 */
    const onErr = (err) => {
        onFatal(`[uncaughtException] ${err?.stack || err?.message || err}`)
        process.exit(exitCode)
    }
    /** 未處理 rejection 之 handler:記錄後以 exitCode 退出 */
    const onRej = (reason) => {
        onFatal(`[unhandledRejection] ${reason?.stack || reason}`)
        process.exit(exitCode)
    }
    process.on('uncaughtException', onErr)
    process.on('unhandledRejection', onRej)

    return () => {
        process.off('uncaughtException', onErr)
        process.off('unhandledRejection', onRej)
    }
}

export default installProcessGuards
