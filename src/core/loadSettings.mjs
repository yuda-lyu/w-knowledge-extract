// loadSettings.mjs — 執行端設定載入(JSON5)＋衍生路徑＋機密宣告式注入＋設定持有器(泛用件,自 tai-news 之執行殼移入)
//
// 【與 core/settingsDefault 的分工】settingsDefault.resolveSettings 是「知識庫預設值之逐鍵合併」(套件內建數字);
//   本檔是「把宿主的 settings.json 讀進來、補絕對路徑、把 .env 之機密依宣告注入」的執行殼秩序。
//   本套件不會自己去讀宿主的 settings.json;本檔是給執行端呼叫的工具,路徑由呼叫端明給。
//
// 【為何路徑一律由 workDir 展開,不用 import.meta.url 也不用 cwd】
//   - import.meta.url:程式被安裝進 node_modules 後,輸出會落到套件目錄內。
//   - cwd 相對:Windows 工作排程器於 session 0 執行時 cwd 為 system32,產物會散落到系統目錄。
//   故以設定檔明寫的 workDir 為唯一錨點(與 core/dirs.expandDirs 同一原則;本檔的 dirs 對照由呼叫端給,不假設專案一定有哪幾個目錄)。
//
// 【為何機密採「宣告式注入」而非直接寫在設定檔】設定檔常隨專案進版控,機密寫進去就會外流。
//   設定檔只寫「變數名」,值一律由 .env 取得。缺值即拋——延後只會讓錯誤退化成不知指向何處的認證失敗。
//
// 【.env 解析委派 w-dispatch-ai readEnvFile,存在性檢查自持】readEnvFile 缺檔回空物件(其語境下金鑰缺失交 skipped 機制回報),
//   但本層語意是 fail-loud——機密檔不存在屬不可續行的初始化錯誤,靜默回空只會延後成難解的認證失敗。
//
// 【持有器為工廠,非模組級單例】套件內的模組級單例會被同一行程中的兩個消費者共用,後注入者覆蓋先注入者且無跡可循。
//   消費端要單例便利時,自行在專案的 getSettings.mjs 內建一份即可——單例的作用域屬於專案,不屬於套件。
//   set 也要經過 decorate:入口常是「讀檔 → 傳入主函數 → 主函數注入為共用來源」,若 set 不 decorate,
//   手動組出的設定物件就會缺 st.dir／st.env,形成「只在某條呼叫路徑上出現」的缺欄位錯誤。

import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import get from 'lodash-es/get.js'
import set from 'lodash-es/set.js'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import readEnvFile from 'w-dispatch-ai/src/readEnvFile.mjs'

/** 預設衍生目錄(相對 workDir)。呼叫端可完全覆寫或增補,本套件不假設專案一定有這幾個。 */
export const DF_DIRS = { db: 'db', log: 'log', tmp: 'tmp', state: 'state' }

/**
 * 補上衍生欄位(絕對路徑與機密),就地修改並回傳同一物件。
 *
 * 【為何與 loadSettings 分開】排程入口常是「讀檔 → 傳入主函數」,而主函數也可能收到呼叫端自行組出的設定物件
 *   (測試、或由上層系統下發)。兩條路徑都必須經過同一份衍生邏輯,否則會出現「手動傳入的設定沒有 st.dir」
 *   這種只在某條路徑上發生的缺欄位錯誤。
 *
 * @param {Object} st 輸入設定物件(須含 workDir)，非物件時視同缺 workDir
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}
 * @param {Object} [opt.dirs=DF_DIRS] 輸入衍生目錄對照(值為相對 workDir 之路徑)，非物件時視為未給(沿用 DF_DIRS)
 * @param {String} [opt.envFile] 輸入 .env 路徑(相對 workDir)；未給時取 st.envFile,再無則 '.env'
 * @param {Array} [opt.secrets=[]] 輸入機密注入規格陣列,各項 { to, from, envVar, required }:to＝寫入 st 的路徑(如 'telegram.token');
 *   from＝存放「變數名」的 st 路徑(如 'telegram.tokenEnvVar');envVar＝直接指定變數名(與 from 二擇一);required 預設 true；非陣列時視為未給(沿用[])
 * @param {Boolean} [opt.exposeEnv=true] 輸入是否把解析後之 .env 內容掛於 st.env
 * @returns {Object} 回傳同一設定物件(已補 st.dir、機密、st.env)
 * @throws {Error} st 非物件、st 缺 workDir、env 檔不存在、secrets 規格缺 to／取不到變數名／取不到值時拋出
 */
export function decorateSettings(st, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }
    let { dirs = DF_DIRS, envFile, secrets = [], exposeEnv = true } = opt
    if (!isobj(dirs)) {
        dirs = DF_DIRS
    }
    if (!isarr(secrets)) {
        secrets = []
    }
    if (!isobj(st)) {
        throw new Error('settings 缺少 workDir')
    }

    const workDir = get(st, 'workDir')
    if (!workDir) throw new Error('settings 缺少 workDir')

    // dir:衍生絕對路徑;各模組直接取用,不再各自 join 而產生不一致
    st.dir = { ...(st.dir || {}) }
    for (const k of Object.keys(dirs)) st.dir[k] = path.resolve(workDir, dirs[k])

    // env:讀取機密來源(存在性檢查自持,見檔頭)
    const envPath = path.resolve(workDir, envFile || st.envFile || '.env')
    if (!fs.existsSync(envPath)) throw new Error(`env 檔不存在：${envPath}`)
    const env = readEnvFile(envPath)

    // secrets:依規格注入
    for (const sec of secrets) {
        const to = sec.to
        if (!to) throw new Error('secrets 規格缺少 to')
        if (get(st, to)) continue // 已有值即不覆蓋:允許呼叫端以程式碼先行注入(測試替身)
        const name = sec.envVar || get(st, sec.from)
        if (!name) {
            if (sec.required === false) continue
            throw new Error(`secrets 規格無法取得變數名（to: ${to}）`)
        }
        const v = env[name]
        if (!v) {
            if (sec.required === false) continue
            throw new Error(`${name} 未設定於 ${envPath}`)
        }
        set(st, to, v)
    }

    // 一個變數可放多把金鑰:.env 無陣列型別,以逗號或分號分隔即可,展開規則由下游決定(如 resolveProviders),本層只原樣帶出
    if (exposeEnv) st.env = env
    return st
}

/**
 * 由檔案載入設定(JSON5)並補上衍生欄位。
 *
 * 【為何用 JSON5 而非 JSON】設定檔的每個數字背後都有反推過程(逾時階梯、重試次數、過濾門檻),
 *   這些理由若不能寫在值旁邊就一定會流失。JSON5 允許註解與尾逗號。
 * 【讀檔與解析錯誤各自帶路徑】設定缺失屬不可續行的初始化錯誤,訊息須指出是哪個檔、是讀不到還是格式錯。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}
 * @param {String} opt.file 輸入設定檔路徑字串(必填)
 * @param {Object} [opt.dirs] 同 decorateSettings
 * @param {String} [opt.envFile] 同 decorateSettings
 * @param {Array} [opt.secrets] 同 decorateSettings
 * @param {Boolean} [opt.exposeEnv] 同 decorateSettings
 * @returns {Object} 回傳設定物件(decorateSettings 之產物)
 * @throws {Error} opt.file 未給、讀不到檔案、JSON5 格式錯誤，或 decorateSettings 所列條件時拋出
 */
export function loadSettings(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { file } = opt
    if (!file) throw new Error('loadSettings 需要 file')
    let text
    try {
        text = fs.readFileSync(file, 'utf8')
    }
    catch (e) {
        throw new Error(`讀不到設定檔 ${file}：${e.message}`)
    }
    let st
    try {
        st = JSON5.parse(text)
    }
    catch (e) {
        throw new Error(`設定檔 ${file} 格式錯誤（JSON5）：${e.message}`)
    }
    return decorateSettings(st, opt)
}

/**
 * 設定持有器:讓全專案有「單一設定來源」而不必各模組自行讀檔(工廠;理由見檔頭)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}；欄位同 loadSettings(file／dirs／envFile／secrets／exposeEnv)
 * @returns {Object} 回傳持有器 { load, set, get, reset }
 */
export function createSettingsHolder(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    let _st = null
    return {
        /**
         * 由檔案載入(不動快取),供入口顯式讀取後傳入主函數
         * @param {String} [file=opt.file] 輸入設定檔路徑字串，未給則用 opt.file
         * @returns {Object} 回傳設定物件
         */
        load: (file = opt.file) => loadSettings({ ...opt, file }),
        /**
         * 注入設定為共用來源(會補上衍生欄位)
         * @param {Object} st 輸入設定物件(須含 workDir)
         * @returns {Object} 回傳已補衍生欄位之同一設定物件(並存入快取)
         */
        set: (st) => {
            _st = decorateSettings(st, opt); return _st
        },
        /**
         * 取得設定;未經 set 注入時,首次呼叫自檔案載入並快取
         * @returns {Object} 回傳設定物件
         */
        get: () => {
            if (!_st) _st = loadSettings(opt); return _st
        },
        /** 清除快取(測試用;正式流程不應需要) */
        reset: () => {
            _st = null
        },
    }
}

export default { loadSettings, decorateSettings, createSettingsHolder, DF_DIRS }
