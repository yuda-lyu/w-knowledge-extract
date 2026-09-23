// ingestNotes.mjs — 人工/代理撰寫之知識筆記批次入庫(維運能力;CLI 殼在執行端)
//
// 與彙整物件共用同一份 domain(normalizeQuality/renderNoteBody),確保 md 結構、
// frontmatter、notes 索引欄位與管線產出完全一致;docs 集合同步登記(status:noted)
// 以維持 URL 去重。重複 URL/slug 一律跳過並回報。
//
// 輸入項目格式:{ url, sourceName?, publishedAt?, textFrom?, note: {同 extract 輸出欄位} }

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { docRecord } from '../util/records.mjs'
import { sha1, slugify } from '../util/text.mjs'
import { normalizeUrl, unwrapNewsUrl } from '../util/web.mjs'
import { oneline } from '../util/misc.mjs'
import { writeMd } from '../md/md.mjs'

/**
 * 批次將人工／代理撰寫之知識筆記寫入庫(md 檔＋notes 索引＋docs 同步登記為 noted),
 * 與彙整管線共用同一份 domain 正規化(normalizeQuality／renderNoteBody),確保筆記結構與管線產出完全一致
 *
 * 逐項處理、互不中斷:欄位不全(URL、title、key_points、concepts 缺一)者計入 bad 並略過；
 * URL 已在庫(docs 狀態為 noted／skip)或 slug 檔案已存在者計入 dup 並略過、不覆寫既有筆記
 *
 * @param {Object} deps 輸入依賴物件
 * @param {Object} deps.stores 輸入集合物件，需含 docs、notes(w-data-pipeline openCollection 介面)
 * @param {Object} deps.dirs 輸入目錄物件，需含 notes(筆記 md 存放目錄字串)
 * @param {Object} deps.clock 輸入時鐘物件(util/clock 之 createClock 產物)
 * @param {Object} deps.domain 輸入領域物件(createExtractDomain 產物)，取 normalizeQuality／renderNoteBody／vocab
 * @param {Array} items 輸入入庫項目陣列，各項形狀為 { url, sourceId?, sourceName?, publishedAt?, textFrom?, note:{ title, key_points, concepts, ...同 extract 輸出欄位 } }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { added:Integer, dup:Integer, bad:Integer, messages:Array }
 * @throws {Error} deps 非物件或缺 stores／dirs／clock／domain 任一者時拋出；items 非陣列時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await ingestNotes({ stores, dirs: { notes: './kb/notes' }, clock, domain }, [
 *     { url: 'https://e.com/a', note: { title: 'T', key_points: ['a'], concepts: ['c'] } },
 * ])
 * console.log(r.added)
 * // => 1
 */
export async function ingestNotes(deps, items) {

    //check
    if (!isobj(deps) || !isobj(deps.stores) || !isobj(deps.dirs) || !isobj(deps.clock) || !isobj(deps.domain)) {
        throw new Error('ingestNotes 需要 { stores, dirs, clock, domain }')
    }
    if (!isarr(items)) {
        throw new Error('ingestNotes 需要 items 陣列')
    }

    const { stores, dirs, clock, domain } = deps
    const messages = []
    let added = 0
    let dup = 0
    let bad = 0

    for (const it of items) {
        const k = it.note || {}
        const url = normalizeUrl(unwrapNewsUrl(it.url)) // 與管線之 doc 主鍵同一算法(解轉址＋正規化)
        if (!/^https?:\/\//.test(url) || !String(k.title || '').trim() || !(k.key_points || []).length || !(k.concepts || []).length) {
            messages.push(`✗ 欄位不全，略過：${oneline(k.title || it.url, 50)}`)
            bad++
            continue
        }
        const docId = sha1(url)
        const exists = await stores.docs.get(docId)
        if (exists && ['noted', 'skip'].includes(exists.status)) {
            messages.push(`= 已在庫（${exists.status}），略過：${oneline(k.title, 50)}`)
            dup++
            continue
        }

        const slug = slugify(k.title, docId)
        const file = path.join(dirs.notes, `${slug}.md`)
        if (fs.existsSync(file)) {
            // 與其他略過路徑一致須留訊息(此前靜默略過,呼叫端只看到 dup 計數而無從對應是哪一筆)
            messages.push(`= 筆記檔已存在（${slug}.md），略過：${oneline(k.title, 50)}`)
            dup++
            continue
        }
        const q = domain.normalizeQuality(k)
        const concepts = (k.concepts || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 6)
        const cat = domain.vocab.categories.includes(k.category) ? k.category : '其他'
        const nowIso = clock.iso8()
        // 正準 doc 形狀由 util/records 單一組裝;人工匯入只覆寫差異欄位(直接以 noted 終態入庫)
        const doc = {
            ...docRecord({ url, title: it.title || k.title, publishedAt: it.publishedAt }, { id: it.sourceId || '', name: it.sourceName || '手動抓取', tier: 1 }, { nowIso }),
            id: docId,
            status: 'noted',
            noteSlug: slug,
            textFrom: it.textFrom || 'abstract',
            notedAt: nowIso,
        }
        if (exists) await stores.docs.patch(docId, { status: 'noted', noteSlug: slug, notedAt: nowIso })
        else await stores.docs.insertNew([doc])

        writeMd(file, {
            title: k.title,
            slug,
            category: cat,
            concepts,
            claim_type: q.claimType,
            evidence_level: q.evidenceLevel,
            sample_period: q.samplePeriod,
            caveats: q.caveats,
            source_name: doc.sourceName,
            source_url: url,
            published: doc.publishedAt,
            created: nowIso,
            doc_id: docId,
            type: 'note',
        }, domain.renderNoteBody(k, doc, q))

        await stores.notes.insertNew([{
            id: slug,
            title: k.title,
            category: cat,
            concepts,
            summary: String(k.summary || '').slice(0, 300),
            claimType: q.claimType,
            evidenceLevel: q.evidenceLevel,
            caveats: q.caveats,
            samplePeriod: q.samplePeriod,
            sourceUrl: url,
            sourceName: doc.sourceName,
            docId,
            file: file.replace(/\\/g, '/'),
            createdAt: nowIso,
            relatedAt: '',
            distilledAt: '',
        }])
        added++
    }
    return { added, dup, bad, messages }
}

export default ingestNotes
