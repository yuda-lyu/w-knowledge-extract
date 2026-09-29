// dirs.mjs — workDir → 各輸出目錄的展開(套件與執行端共用;此前兩處各寫一份而靠人肉對齊)

import isestr from 'wsemi/src/isestr.mjs'
import isobj from 'wsemi/src/isobj.mjs'

/**
 * 路徑錨點正規化:反斜線轉正斜線、去尾斜線
 *
 * @param {String} workDir 輸入工作目錄路徑字串
 * @returns {String} 回傳正規化後之路徑字串(反斜線轉正斜線、去尾斜線)
 * @throws {Error} workDir 非有效字串時拋出
 * @example
 * console.log(normalizeWorkDir('C:\\kb\\'))
 * // => C:/kb
 */
export function normalizeWorkDir(workDir) {

    //check
    if (!isestr(workDir)) {
        throw new Error('normalizeWorkDir 需要 workDir（路徑字串）')
    }

    return String(workDir).replace(/\\/g, '/').replace(/\/$/, '')
}

/**
 * 由 workDir 展開全部輸出目錄;overrides 逐鍵覆寫(cfg.dirs)。
 *
 * 【coreState 於覆寫之後衍生】核心狀態檔(真理)與核心 md(投影)須同處、同受版控與備份(git 回滾時兩者一起退);
 *   只覆寫 dirs.core 之安裝方若拿到字面預設之 coreState,狀態與 md 會靜默分家(2026-09-29 第二輪判識 B)。
 *
 * @param {String} workDir 輸入工作目錄路徑字串
 * @param {Object} [overrides={}] 輸入逐鍵覆寫物件(cfg.dirs)，非物件時視為{}
 * @returns {Object} 回傳全部輸出目錄物件 {db, log, tmp, state, knowledge, notes, core, coreState, relations}(皆為絕對路徑字串；coreState 未覆寫者＝core)
 * @throws {Error} workDir 非有效字串時拋出(見 normalizeWorkDir)
 * @example
 * console.log(expandDirs('c:/kb').db)
 * // => c:/kb/db
 *
 * console.log(expandDirs('c:/kb', { core: 'd:/vault/核心' }).coreState)
 * // => d:/vault/核心
 */
export function expandDirs(workDir, overrides = {}) {

    //check
    if (!isobj(overrides)) {
        overrides = {}
    }

    const w = normalizeWorkDir(workDir)
    const out = {
        db: `${w}/db`,
        log: `${w}/log`,
        tmp: `${w}/tmp`,
        state: `${w}/state`,
        knowledge: `${w}/knowledge`,
        notes: `${w}/knowledge/notes`,
        core: `${w}/knowledge/core`,
        relations: `${w}/knowledge/relations`,
        ...overrides,
    }
    if (!isestr(overrides.coreState)) out.coreState = out.core
    return out
}

export default { normalizeWorkDir, expandDirs }
