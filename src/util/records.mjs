// records.mjs — doc 記錄組裝的單一模組:來源 id、正準 doc 形狀、三條入庫路徑的 toRecord
//
// 【單一組裝點】doc 記錄此前在四處各寫一份(輪抓 toRecord、轉錄 toLinkedRecord、探測入庫 toDocCandidates、
//   人工匯入 ingestNotes),欄位名與預設值靠人肉對齊;正準 schema(套件契約欄位)一改就要改四處。
//   此後只有 docRecord 一個形狀,各路徑只覆寫自己的差異欄位(2026-09-12 複審 P8/S5)。
// 【id 由去重層決定】記錄不自算 id:seen.admit 一律以 identity(keyOf:'raw'＝sha1(canonicalUrl))覆寫 id,
//   這是去重能成立的前提;探測入庫已改走同一閘門(stores/ingestGate),不再自算 sha1。

import isobj from 'wsemi/src/isobj.mjs'
import { sha1 } from './text.mjs'
import { normalizeUrl } from './web.mjs'

/**
 * 來源去重鍵:依 kind 與正規化後 url 算出 SHA-1(來源清單與轉錄來源之 id 皆由此決定;見檔頭【id 由去重層決定】)
 *
 * kind／url 非字串時 fail-safe(樣板字串化後照樣雜湊,不拋錯)——與 sha1／normalizeUrl 之容錯語意一致。
 *
 * @param {String} kind 輸入來源種類字串(如 'rss'、'grid')
 * @param {String} url 輸入來源網址字串(經 normalizeUrl 正規化後才雜湊)
 * @returns {String} 回傳 SHA-1 十六進位字串
 * @example
 * console.log(sourceId('rss', 'https://e.com/feed?utm_source=x'))
 * // => 8c6915c8580b776455f5d25c70686284e30b1a5f
 */
export function sourceId(kind, url) {
    return sha1(`${kind}|${normalizeUrl(url)}`)
}

/**
 * doc 記錄之正準形狀:所有入庫路徑由此出發,再各自覆寫差異欄位(見檔頭【單一組裝點】)。
 *
 * @param {Object} fields 輸入來源欄位物件，含 url、title、publishedAt、author、feedText(皆選填，缺者以空字串填入)
 * @param {Object} src 輸入來源記錄物件，含 id、name、tier、lang(id／name 直接採用，tier 缺省 2，lang 缺省'')
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}
 * @param {String} [opt.nowIso=''] 輸入現在時刻 ISO 字串，作為 collectedAt
 * @param {Integer} [opt.maxTextChars=20000] 輸入 feedText 保留字數上限
 * @returns {Object} 回傳正準 doc 記錄物件
 * @throws {Error} fields 或 src 非物件時拋出
 * @example
 * const r = docRecord({ url: 'https://e.com/a', title: 'T' }, { id: 's1', name: 'S' }, { nowIso: '2026-09-23T00:00:00+08:00' })
 * console.log(r.url, r.title, r.sourceId, r.status, r.collectedAt)
 * // => https://e.com/a T s1 new 2026-09-23T00:00:00+08:00
 */
export function docRecord(fields, src, opt = {}) {

    //check
    if (!isobj(fields) || !isobj(src)) {
        throw new Error('docRecord 需要 fields 與 src 物件')
    }
    if (!isobj(opt)) {
        opt = {}
    }

    return {
        url: fields.url,
        title: fields.title || '',
        publishedAt: fields.publishedAt || '',
        author: fields.author || '',
        feedText: String(fields.feedText || '').slice(0, opt.maxTextChars ?? 20_000),
        sourceId: src.id,
        sourceName: src.name,
        sourceTier: src.tier || 2,
        lang: src.lang || '',
        collectedAt: opt.nowIso || '',
        status: 'new',
        fetchTries: 0,
        text: '',
        textLength: 0,
    }
}

/**
 * 內建 toRecord 工廠(輪抓與探測入庫共用):契約層項目 → doc;grid 摘要即素材直入 raw(DOI 多付費牆)
 *
 * @param {Object} deps 輸入依賴物件，需含 settings(取 settings.fetch.maxTextChars)、clock(取 clock.iso8())
 * @returns {Function} 回傳 toRecord(it, meta) 函數:it 為契約層項目、meta.source 為來源記錄，回傳正準 doc 記錄(grid 來源另補 status／text／textLength／textFrom／rawAt)
 */
export const defaultToRecord = ({ settings, clock }) => (it, meta) => {
    const s = meta.source
    const rec = docRecord(
        { url: it.canonicalUrl || it.url, title: it.title, publishedAt: it.time, author: it.author, feedText: it.text || it.summary },
        s, { nowIso: clock.iso8(), maxTextChars: settings.fetch.maxTextChars },
    )
    // 摘要即素材,直入 raw;rawAt＝進入 raw 之時刻(raw 池等待時間據此量)
    if (s.kind === 'grid') Object.assign(rec, { status: 'raw', text: rec.feedText, textLength: rec.feedText.length, textFrom: 'abstract', rawAt: rec.collectedAt })
    return rec
}

/**
 * 內建轉錄記錄組裝工廠:sourceId 不可沿用母來源,否則真文章下輪又被拆成連結
 *
 * @param {Object} deps 輸入依賴物件，需含 clock(取 clock.iso8())
 * @returns {Function} 回傳組裝函數(l, mother):l 為轉錄連結{url,text}、mother 為母文件記錄，回傳正準 doc 記錄並附 fromDocId
 */
export const defaultToLinkedRecord = ({ clock }) => (l, mother) => ({
    ...docRecord(
        { url: normalizeUrl(l.url), title: l.text, publishedAt: mother.publishedAt },
        { id: `${mother.sourceId}:linked`, name: `${mother.sourceName}（轉錄）`, tier: mother.sourceTier || 2, lang: mother.lang || '' },
        { nowIso: clock.iso8() },
    ),
    fromDocId: mother.id,
})

export default { sourceId, docRecord, defaultToRecord, defaultToLinkedRecord }
