// recheckOps.mjs — 提煉重審之維運能力:列出各核心之重審項(唯讀)。指示重設內容基準之名單在 stores/rebaseline(requestRebaseline 等)
//
// 【唯讀】核心狀態走四態分流表(可讀者列其重審項:壞檔而上一版救得回者以上一版列——提煉段下輪即以之修復);不寫快取、不改狀態。

import path from 'path'
import { isMainCore } from '../stores/conceptSelection.mjs'
import { coreStoreOf } from '../stores/coreStore.mjs'
import { createContentCache } from '../stores/contentCache.mjs'
import { RECHECK_REASONS, recheckItemsOf } from '../standards/recheck.mjs'
import { CONTENT_CACHE_FILE } from '../stores/extractFiles.mjs'
import { readConflictEvents } from '../core/relatePackage.mjs'
import { textValueOf as str } from '../core/capturePackage.mjs'


/**
 * 列出各主核心之重審項(唯讀;不寫快取、不改狀態)
 *
 * @param {Object} deps 輸入 { stores:{ notes, cores, relations }, dirs, domain(提煉 domain), relateDomain(關聯 domain:衝突型之現名 conflictType
 *   與其舊名 conflictTypeNames), settings?(取 extract.recheck.relationImpact——開啟者另列關聯變更之重審項與夥伴候選) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 [{ id, concept, changed:Array(筆記 id), conflicts:Integer, conflictGone:Integer, relationChanged:Integer, partners:Integer }](只列有項者)
 * @throws {Error} deps.relateDomain 無衝突型之名時拋出(衝突之重審項依之判定,不可靜默略過)
 * @example
 * need test in nodejs.
 *
 * const rows = await previewRecheck({ stores, dirs, domain, relateDomain, settings })
 * console.log(rows.map((r) => r.core))
 */
export async function previewRecheck(deps) {
    const { stores, dirs, domain, relateDomain } = deps
    const conflictType = str(relateDomain?.conflictType)
    if (!conflictType) throw new Error('previewRecheck 需要 deps.relateDomain（關聯 domain：衝突型之名 conflictType 與其舊名 conflictTypeNames）')
    const names = new Set(Array.isArray(relateDomain.conflictTypeNames) && relateDomain.conflictTypeNames.length ? relateDomain.conflictTypeNames : [conflictType])
    const [notes, cores, edges] = await Promise.all([stores.notes.select(), stores.cores.select(), stores.relations.select()])
    const notesById = new Map(notes.map((n) => [n.id, n]))
    const conflictEdges = edges.filter((e) => names.has(e.type))
    // 夥伴所依之邊須現存且非衝突型(與提煉段同一判準;就緒與否不在預覽之列)
    const edgeById = new Map(edges.filter((e) => !names.has(e.type)).map((e) => [e.id, e]))
    const impact = deps.settings?.extract?.recheck?.relationImpact === true ? { impact: true, edgeOf: (id) => edgeById.get(id) || null } : {}
    const conflictEvents = readConflictEvents(dirs.state)
    const cache = createContentCache(path.join(dirs.state, CONTENT_CACHE_FILE), domain)
    const store = coreStoreOf(dirs)
    const out = []
    for (const c of cores) {
        if (!isMainCore(c, cores)) continue
        // 四態分流表:可讀者照列(壞檔而上一版救得回者亦然:提煉段下輪即以之修復,預覽列出其重審項才與之相符);遺失、他版、救不回者略
        const r = store.loadUsable(c.id)
        if (!r.readable) continue
        const items = recheckItemsOf(r.state, { notesById, conflictEdges, keyOf: (nid) => cache.keyOf(notesById.get(nid)), version: cache.enabled ? cache.version : '', conflictEvents, ...impact })
        const changed = [...new Set(items.filter((x) => x.reason === RECHECK_REASONS.changed).map((x) => x.id))]
        const conflicts = items.filter((x) => x.reason === RECHECK_REASONS.conflict).length
        const conflictGone = items.filter((x) => x.reason === RECHECK_REASONS.conflictGone).length
        const relationChanged = items.filter((x) => x.reason === RECHECK_REASONS.relationChanged || x.reason === RECHECK_REASONS.conflictReason).length
        const partners = items.filter((x) => x.reason === RECHECK_REASONS.partner).length
        if (changed.length || conflicts || conflictGone || relationChanged || partners) out.push({ id: c.id, concept: c.concept, changed, conflicts, conflictGone, relationChanged, partners })
    }
    return out
}

export default { previewRecheck }
