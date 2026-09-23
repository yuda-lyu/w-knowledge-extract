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
 * @param {String} workDir 輸入工作目錄路徑字串
 * @param {Object} [overrides={}] 輸入逐鍵覆寫物件(cfg.dirs)，非物件時視為{}
 * @returns {Object} 回傳全部輸出目錄物件 {db, log, tmp, state, knowledge, notes, core, relations}(皆為絕對路徑字串)
 * @throws {Error} workDir 非有效字串時拋出(見 normalizeWorkDir)
 * @example
 * console.log(expandDirs('c:/kb').db)
 * // => c:/kb/db
 */
export function expandDirs(workDir, overrides = {}) {

    //check
    if (!isobj(overrides)) {
        overrides = {}
    }

    const w = normalizeWorkDir(workDir)
    return {
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
}

export default { normalizeWorkDir, expandDirs }
