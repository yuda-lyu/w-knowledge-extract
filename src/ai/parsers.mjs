// parsers.mjs — 模型回覆之解析與驗證器:編號清單、嚴格 JSON 陣列、涵蓋率驗證(泛用件,自 tai-news 之執行殼移入)
//
// 【與 ai/adapter.parseJson 的分工】adapter 之 parseJson 於 extractJsonLoose 救不回時做截斷搶救(部分接受:本套件批次管線
//   之實戰結論,全有全無實測失敗率 26%);本檔 parseJsonArray 則是嚴格版——括號未閉合即回 null,不搶救半成品
//   (tai-news 之實戰結論:缺項輸出即不完整,接受它等於讓品質不良與正常在日誌上長得一樣)。兩者語意相反、各有依據,刻意並存。
//
// 【parseIndexList:為何不能直接抓全文所有數字】模型偶爾會把推理過程混進輸出——實測到過
//   `5,6,15,16,28 Wait, let me reconsider…`(提示詞已明訂「只回覆數字」仍被違反)。抓全文數字會讓說明文字裡的數字
//   被靜默當成編號;而提示詞常含數量上限(如「最多 5 篇」),模型複述時極易帶出該數字。
//   故取「數字個數最多的那一段」——那正是提示詞要求的作答格式;同長度取最先出現者(模型常先給答案後補說明)。
//   單一個 0 約定為空集合:空回覆無法與「模型沒回應」區分,故由 isZero 回報;不需要此約定時忽略即可。
//
// 【parseJsonArray:為何不可用「第一個 [ 到最後一個 ]」的正則】①貪婪過取:模型若在陣列後多寫一句含 ] 的說明,捕獲範圍
//   會超出真正的 JSON → 合格回覆被誤判為失敗而白白遞補;②code fence:實測有模型把輸出整段包在 ```json 圍欄內。
//   extractJsonLoose 先剝除 ANSI 色碼與 code fence,再以括號配對取出第一個完整片段,上述兩點皆免疫。
//
// 【makeArrayCoverageValidator】免費模型偶發在生成中途截斷(缺項、或截斷不成 JSON),此時 CLI 仍以離開碼 0 退出、底層判為 ok。
//   把格式與涵蓋率不符一律視為失敗交由遞補換下一家重產,比在下游補救可靠。內容非空也要驗(結構正確但欄位為空字串者
//   只驗編號會全數放行);以「涵蓋」而非「筆數相符」判定(模型可能對同一編號回多筆,實測有回 10 筆對應 5 項者)。
//   【長度上限 maxLengths】提示詞給的字數上限只是請求不是保證;「超長」與「截斷」同屬不合格,只是方向相反。不驗長度時超長
//   輸出一路通過、遞補不會換家,最後炸在下游硬限制上(tai-news:Telegram 單則 4,096 字元,整則發不出、該輪新聞永久丟失,
//   已發生 5 次;2026-09-21 實測 poolside 之 long 為規格 200 的 2.6~4.4 倍、agnes 3.0 則 136~205)。**任一項任一受限欄位超過即整體
//   不合格**,不把超長項當缺項剔除——同一編號回多筆時,以合格那筆蒙混會讓不照規格的供應商在日誌上與正常長得一樣。
//   數字(規格值×寬容倍數)是消費端政策,本層只收 maxLengths。onReject 回報可讀原因,否則日誌只看得到 OUTPUT_VALIDATION_FAILED。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import extractJsonLoose from 'w-dispatch-ai/src/wkf/extractJsonLoose.mjs'

/**
 * 自模型回覆抽取「逗號分隔之編號清單」
 *
 * 取「數字個數最多的那一串」視為答案(模型偶爾會把推理過程混進輸出);單一個 0 約定為空集合
 *
 * @param {String} text 輸入模型回覆原始文字
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Number} [opt.max=Infinity] 輸入有效編號上限，預設Infinity
 * @param {Number} [opt.min=1] 輸入有效編號下限，預設1
 * @param {Number} [opt.topN=Infinity] 輸入最多取幾個編號，預設Infinity
 * @returns {Object} 回傳 { isZero:Boolean, indices:Array }，isZero 為 true 時 indices 固定為空陣列
 * @example
 * console.log(parseIndexList('請選出 5,6,15,16,28 Wait, let me reconsider 5,6'))
 * // => { isZero: false, indices: [ 5, 6, 15, 16, 28 ] }
 *
 * console.log(parseIndexList('0'))
 * // => { isZero: true, indices: [] }
 */
export function parseIndexList(text, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { max = Infinity, min = 1, topN = Infinity } = opt
    const runs = String(text || '').match(/\d+(?:\s*[,，、]\s*\d+)*/g) || []
    // 取數字個數最多的那一串;同長度時取最先出現者
    let best = ''
    let bestCount = 0
    for (const r of runs) {
        const n = (r.match(/\d+/g) || []).length
        if (n > bestCount) {
            best = r; bestCount = n
        }
    }
    const nums = (best.match(/\d+/g) || []).map(Number)
    if (nums.length === 1 && nums[0] === 0) return { isZero: true, indices: [] } // 單一個 0 代表空集合
    return { isZero: false, indices: nums.filter((n) => n >= min && n <= max).slice(0, topN) }
}

/**
 * 自模型回覆抽取 JSON 陣列;抽不出、非陣列或截斷(括號未閉合)一律回 null——不搶救半成品
 *
 * @param {String} stdout 輸入模型回覆原始文字
 * @returns {Array} 回傳解析後之陣列，抽取失敗或非陣列時回傳 null
 * @example
 * console.log(parseJsonArray('前言 [{"a":1}] 後語'))
 * // => [ { a: 1 } ]
 *
 * console.log(parseJsonArray('[{"a":1}'))
 * // => null
 */
export function parseJsonArray(stdout) {
    const v = extractJsonLoose(String(stdout || ''))
    return Array.isArray(v) ? v : null
}

/**
 * 建立「JSON 陣列涵蓋率」驗證器:回覆為可解析之陣列、涵蓋所有預期編號、各項有實質內容、各受限欄位未超長
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為 {}
 * @param {Array} [opt.indices=[]] 輸入預期涵蓋之編號陣列；給了但非陣列時拋錯(見下)
 * @param {String} [opt.indexField='index'] 輸入編號欄位名，預設'index'
 * @param {Array} [opt.contentFields=[]] 輸入內容欄位名陣列，任一非空即視為有內容；非陣列視為[]（省略代表不檢查）
 * @param {Object} [opt.maxLengths={}] 輸入欄位長度上限對照(如 { short: 90, long: 300 })，非物件視為{}；0／省略之欄位不檢查，任一項任一欄位超過即整體不合格
 * @param {Function} [opt.onReject] 輸入判不合格時之回報函數 (why:String)=>void，判不合格時回報可讀原因(每次驗證各回報一次)；非函數則不回報
 * @returns {Function} 回傳可直接作為 dispatchAiFallback 之 validate 函數，格式 (stdout:String) => Boolean
 * @throws {TypeError} opt.indices 給了但非陣列時拋出
 * @example
 * let validate = makeArrayCoverageValidator({ indices: [1, 2] })
 * console.log(validate('[{"index":1},{"index":2}]'))
 * // => true
 *
 * console.log(validate('[{"index":1}]'))
 * // => false
 */
export function makeArrayCoverageValidator(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    let { indices = [], indexField = 'index', contentFields = [], maxLengths = {}, onReject } = opt

    //indices 給了但非陣列時不可靜默改空陣列——那會讓涵蓋率檢查形同放行,故此欄例外地拋錯
    if (!isarr(indices)) {
        throw new TypeError('makeArrayCoverageValidator 之 indices 須為陣列')
    }
    if (!isarr(contentFields)) {
        contentFields = []
    }
    if (!isobj(maxLengths)) {
        maxLengths = {}
    }

    const reject = (why) => {
        if (typeof onReject === 'function') onReject(why); return false
    }
    const limits = Object.entries(maxLengths || {}).filter(([, max]) => Number.isFinite(max) && max > 0)
    return (stdout) => {
        const arr = parseJsonArray(stdout)
        if (!Array.isArray(arr)) return reject('非 JSON 陣列或輸出截斷')
        for (const o of arr) {
            if (!o || typeof o !== 'object') continue
            for (const [f, max] of limits) {
                const len = String(o[f] ?? '').trim().length
                if (len > max) return reject(`第 ${o[indexField] ?? '?'} 項之 ${f} 為 ${len} 字，超過上限 ${max}`)
            }
        }
        const hasContent = (o) => contentFields.length === 0 || contentFields.some((f) => String(o[f] ?? '').trim() !== '')
        const got = new Set(arr.filter((o) => o && typeof o[indexField] === 'number' && hasContent(o)).map((o) => o[indexField]))
        const missing = indices.filter((i) => !got.has(i))
        if (missing.length) return reject(`未涵蓋編號 ${missing.join('、')}（缺項或內容為空）`)
        return true
    }
}

export default { parseIndexList, parseJsonArray, makeArrayCoverageValidator }
