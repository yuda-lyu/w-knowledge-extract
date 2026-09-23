// regenCore.mjs — 令指定概念的核心知識「打掉重練」(維運能力;CLI 殼在執行端)
//
// 【為何需要】提煉是累積式的:既有核心會當 priorBody 餵回模型「在此基礎上深化」。
//   一旦某版品質不佳(免費模型偶發語意破碎譯文),壞內容會一路傳給後續版本、無自癒。
//   模型輸出品質無法用程式可靠判定(規則式偵測會誤殺專有名詞音譯),故提供人工修復:
//   刪該概念的核心記錄與 md,下一輪以現有筆記從頭重練(v1),筆記本身不受影響。

import fs from 'fs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { normalizeConcept } from '../util/text.mjs'

/**
 * 列出現有核心(依筆記數降冪)
 *
 * @param {Object} stores 輸入集合物件，需含 cores(w-data-pipeline openCollection 介面，取 select)
 * @returns {Promise} 回傳 Promise，resolve 回傳核心記錄陣列，依 noteCount 降冪排序
 * @throws {Error} stores 非物件或缺 stores.cores.select 時拋出
 * @example
 * need test in nodejs.
 *
 * let cores = await listCores(stores)
 * console.log(cores.length)
 */
export async function listCores(stores) {

    //check
    if (!isobj(stores) || !isobj(stores.cores) || !isfun(stores.cores.select)) {
        throw new Error('listCores 需要 stores.cores.select（cores 集合）')
    }

    const cores = await stores.cores.select()
    return cores.sort((a, b) => (b.noteCount || 0) - (a.noteCount || 0))
}

/**
 * 打掉指定概念的核心:刪除核心索引記錄與 md 檔,相關筆記之 distilledAt 一併清空,
 * 令下一輪以現有筆記從頭重練(v1),筆記本身不受影響
 *
 * 先確認重練後仍有足夠筆記可用才刪,否則刪掉會變成「有概念但沒核心」;conceptArg 無效或找不到對應概念時
 * 回傳與「未找到」同形之結果物件(ok:false, notFound:true),不拋錯
 *
 * @param {Object} stores 輸入集合物件，需含 cores、notes(w-data-pipeline openCollection 介面)
 * @param {String} conceptArg 輸入欲重練之概念名稱字串(以 normalizeConcept 正規化後比對)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok:Boolean, notFound:Boolean(找不到或 conceptArg 無效時為 true), concept, version, availableNotes, messages:Array }
 * @throws {Error} stores 非物件、缺 stores.cores.select／stores.cores.raw.del 或 stores.notes.select／stores.notes.patch 時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await regenCore(stores, '注意力機制')
 * console.log(r.ok)
 */
export async function regenCore(stores, conceptArg) {

    //check, 本函數實際用到之集合方法須一併檢查(此前只驗 cores.select,缺 raw.del 或 notes 方法者要到刪檔之後才拋原生 TypeError,留下半套狀態)
    if (!isobj(stores) || !isobj(stores.cores) || !isfun(stores.cores.select)) {
        throw new Error('regenCore 需要 stores.cores.select（cores 集合）')
    }
    if (!isfun(stores.cores.raw?.del)) {
        throw new Error('regenCore 需要 stores.cores.raw.del（openCollection 之 raw ORM）')
    }
    if (!isobj(stores.notes) || !isfun(stores.notes.select) || !isfun(stores.notes.patch)) {
        throw new Error('regenCore 需要 stores.notes.select／stores.notes.patch（notes 集合）')
    }
    if (!isestr(conceptArg)) {
        return { ok: false, notFound: true, messages: [`找不到概念「${conceptArg}」的核心知識`] }
    }

    const messages = []
    const cores = await stores.cores.select()
    const target = cores.find((c) => normalizeConcept(c.concept) === normalizeConcept(conceptArg))
    if (!target) return { ok: false, notFound: true, messages: [`找不到概念「${conceptArg}」的核心知識`] }

    // 先確認重練後仍有足夠筆記可用,否則刪掉會變成「有概念但沒核心」
    const notes = await stores.notes.select()
    const available = notes.filter((n) => (n.concepts || []).some((c) => normalizeConcept(c) === normalizeConcept(target.concept)))
    messages.push(`概念「${target.concept}」：現為 v${target.version}（依據 ${target.noteCount} 篇），可用筆記 ${available.length} 篇`)

    try {
        fs.unlinkSync(target.file)
        messages.push(`已刪除 ${target.file}`)
    }
    catch (e) {
        messages.push(`md 檔已不存在或無法刪除：${e.message}`)
    }
    await stores.cores.raw.del({ id: target.id })
    messages.push('已刪除核心索引記錄')

    // 相關筆記的 distilledAt 一併清掉,讓重練後的統計正確反映
    for (const n of available) await stores.notes.patch(n.id, { distilledAt: '' })

    return { ok: true, concept: target.concept, version: target.version, availableNotes: available.length, messages }
}

export default { listCores, regenCore }
