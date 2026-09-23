// reviveDocs.mjs — 把「確定抓不到」(dead)的文件放回待抓佇列(維運能力;CLI 殼在執行端)
//
// 【為何需要】dead 是「試滿 maxFetchTries」的判定,前提是抓取能力不變;能力升級後(如站台 adapter 上線、
//   反爬解法更新)那批判定就過時了——記錄永不刪,故可回填:status→new、fetchTries 歸零,
//   revivedFrom 留原失敗原因可稽核。回填後依 FIFO 排隊(collectedAt 不動),不插隊。

import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'

/**
 * 把狀態為 dead(已試滿 maxFetchTries)的文件依 match 篩選後放回待抓佇列
 *
 * status→new、fetchTries 歸零,revivedFrom 留原失敗原因可稽核;回填後依 FIFO 排隊(collectedAt 不動),不插隊。
 * dryRun 時只統計不寫入,供操作前預覽篩選結果。
 *
 * @param {Object} stores 輸入集合物件，需含 docs(w-data-pipeline openCollection 介面，取 select、patch)
 * @param {Object} cfg 輸入設定物件
 * @param {Function} cfg.match 輸入篩選函數 (doc) => Boolean，決定哪些 dead 文件要回填，必填
 * @param {String} cfg.nowIso 輸入現在時刻 ISO 字串，寫入 revivedAt
 * @param {Boolean} [cfg.dryRun=false] 輸入是否僅統計不寫入
 * @returns {Promise} 回傳 Promise，resolve 回傳 { dead:Integer, matched:Integer, revived:Integer, sample:Array(前 5 筆 url) }
 * @throws {Error} cfg.match 非函數時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await reviveDeadDocs(stores, { match: deadMatcher({ host: 'example.com' }), nowIso: clock.iso8() })
 * console.log(r.revived)
 */
export async function reviveDeadDocs(stores, cfg) {

    //check
    if (!isobj(stores) || !isobj(stores.docs) || !isfun(stores.docs.select) || !isfun(stores.docs.patch)) {
        throw new Error('reviveDeadDocs 需要 stores.docs.select／stores.docs.patch（docs 集合）')
    }
    if (typeof cfg?.match !== 'function') throw new Error('reviveDeadDocs 需要 match(doc) 函數')
    const dead = await stores.docs.select({ status: 'dead' })
    const targets = dead.filter(cfg.match)
    let revived = 0
    if (!cfg.dryRun) {
        for (const d of targets) {
            await stores.docs.patch(d.id, {
                status: 'new',
                fetchTries: 0,
                lastError: '',
                revivedAt: cfg.nowIso,
                revivedFrom: String(d.lastError || '').slice(0, 120),
            })
            revived++
        }
    }
    return { dead: dead.length, matched: targets.length, revived, sample: targets.slice(0, 5).map((d) => d.url) }
}

/**
 * 常用篩選產生器:依主機名(含子網域)與／或失敗原因子字串,產出可直接交給 reviveDeadDocs 之 cfg.match
 *
 * host／error 皆未給時,回傳之函數恆回 false(不誤配整批);host 以尾端錨定比對含子網域(如 host:'e.com' 亦配 'a.e.com')
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.host] 輸入主機名字串(不含協定，如 'example.com')，比對 d.url 之 hostname(含子網域)
 * @param {String} [opt.error] 輸入失敗原因子字串(視為正則，大小寫不拘)，比對 d.lastError
 * @returns {Function} 回傳篩選函數 (d) => Boolean
 * @example
 * let match = deadMatcher({ host: 'example.com' })
 * console.log(match({ url: 'https://a.example.com/x', lastError: '' }))
 * // => true
 */
export function deadMatcher(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const { host, error } = opt
    const hostRe = host ? new RegExp(`(^|\\.)${String(host).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : null
    const errRe = error ? new RegExp(String(error).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null
    /**
     * @param {Object} d 輸入文件記錄，取 url、lastError
     * @returns {Boolean} 回傳是否符合篩選條件
     */
    return (d) => {
        if (hostRe) {
            let h = ''
            try {
                h = new URL(d.url).hostname
            }
            catch {
                return false
            }
            if (!hostRe.test(h)) return false
        }
        if (errRe && !errRe.test(String(d.lastError || ''))) return false
        return !!(hostRe || errRe)
    }
}

export default { reviveDeadDocs, deadMatcher }
