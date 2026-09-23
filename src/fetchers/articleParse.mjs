// articleParse.mjs — 抓取單篇網頁並萃取正文;彙整貼文連結抽取;RSS/Atom feed 探測
//
// 建構於 w-fetch-web(≥1.0.18):正文解析走 fetchWeb(method:'curl', parse:true, adapters)——內部已含
// 空殼頁/反爬蟲判識(inspectHtml)、Readability 解析,以及內建站台 adapter(gelonghui、bloomberg、msn)。
// 指定 method:'curl' 之計畫為「[命中站台 adapter 之 fetch 掛點] → curl」,絕不升級 Playwright/Camoufox
// (w-fetch-web buildPlan.mjs:93 插入 adapter 階、:102-107 非 auto 僅單一抓取階)——
// 排程環境不宜常駐瀏覽器,避免 chrome 孤兒程序。adapter 階不啟動瀏覽器:內建 msn 之 fetch 掛點
// 亦是經本套件之 curl 抓取器打站方內容 API(w-fetch-web fetchMsn.mjs)。
// options.adapters 之語意是「排在 w-fetch-web 內建清單之前」而非整組置換:本檔不傳
// useDefaultAdapters(預設 true),故內建清單恆生效;要停用或剔除須由呼叫端另行指定該選項。
// fetchArticleLinks/discoverFeed 直呼 fetchWebByCurl,不經 fetchWeb,不受 adapter 影響。

import fetchWeb from 'w-fetch-web/src/fetchWeb.mjs'
import fetchWebByCurl from 'w-fetch-web/src/fetchWebByCurl.mjs'
import decodeEntities from 'w-dwdata-hub/src/decodeEntities.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { normalizeUrl } from '../util/web.mjs'
import { DEFAULT_SITE_ADAPTERS } from './siteAdapters.mjs'

// 轉錄連結時要濾掉的非文章連結:學術索引、平台工具、憑證與社群按鈕。
// 【為何需要】彙整貼文頁面裡混著大量樣板連結(實測抓進「Google Scholar」「SSL technology」
// 等 7 筆垃圾文件)。這些連結一旦入庫就會佔用全文抓取與 AI 萃取的名額,
// 而它們永遠不可能產出知識——寧可濾嚴一點,漏掉的下一輪彙整貼文還會再出現。
const LINK_HOST_DENY = /(^|\.)(google|gstatic|googleusercontent|letsencrypt|w3|gravatar|wordpress|paypal|amazon|apple|microsoft|cloudflare)\.[a-z.]+$/i
const MIN_LINK_TEXT = 20 // 文章標題普遍長於此;樣板連結(Google Scholar、More、Read)短得多

/**
 * 從 HTML 取出對外連結(彙整轉錄用)。
 * 對「連結彙整站」而言,連結正是這篇貼文的全部價值——丟掉連結就只剩一串標題,
 * 送進 AI 只會被判為匯流貼文而白費一次呼叫。
 *
 * 濾除同站連結、社群分享按鈕、學術索引／平台工具網域(LINK_HOST_DENY)與過短連結文字(MIN_LINK_TEXT)。
 *
 * @param {*} html 輸入頁面 HTML 字串，falsy 時回傳空陣列
 * @param {String} baseUrl 輸入該頁面網址字串，用於相對連結展開與同站過濾
 * @returns {Array} 回傳連結物件陣列 [{ url:String, text:String }]
 */
function extractLinks(html, baseUrl) {
    if (!html) return []
    const out = []
    let host = ''
    try {
        host = new URL(baseUrl).hostname.replace(/^www\./, '')
    }
    catch { /* 無法解析就不做同站過濾 */ }
    for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let href = m[1]
        // 連結文字會成為轉錄文件的 title(送 AI 的素材),故須解 HTML 實體
        const text = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
        try {
            href = new URL(href, baseUrl).toString()
        }
        catch {
            continue
        }
        if (!/^https?:\/\//i.test(href)) continue
        let h = ''
        try {
            h = new URL(href).hostname.replace(/^www\./, '')
        }
        catch {
            continue
        }
        if (host && h === host) continue // 同站導覽/分頁
        if (/^(twitter|x|facebook|linkedin|reddit|t)\.(com|co)$/i.test(h)) continue // 分享按鈕
        if (LINK_HOST_DENY.test(h)) continue // 學術索引/平台工具
        if (text.length < MIN_LINK_TEXT) continue // 樣板連結
        out.push({ url: href, text: text.slice(0, 200) })
    }
    return out
}

/**
 * 抓取單篇文章正文(fetchWeb 內部:[站台 adapter 取得] → curl 抓取 → 空殼頁判識 → Readability 解析)
 * maxRetries 2(預設 5):curl 層預設重試預算單篇最壞 255s,每輪 8 篇全文最壞 34 分鐘,
 * 會吃掉排程上限;壓到 2 次後單篇最壞約 114s;4xx/403 類本就不重試,不受影響。
 *
 * url 非有效字串時不發網路、不拋錯,直接回失敗結果(reason 取 w-fetch-web constants.REASONS 之 invalid-url)。
 *
 * @param {String} url 輸入文章網址字串
 * @param {Object} [options={}] 輸入設定物件，非物件視為{}
 * @param {Integer} [options.timeoutMs=30000] 輸入逾時毫秒數
 * @param {Array} [options.adapters=本套件自帶清單] 輸入站台 adapter 陣列(排於 w-fetch-web 內建清單之前,非整組置換)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok, url, title?, content?, contentLength?, method?, adapterId?, reason?, message? };
 *   method 為 w-fetch-web 之結果方法名('curl' 或經 adapter 取得時為 'adapter');adapterId 僅經 adapter 時非空
 * @example
 * need test in nodejs.
 *
 * const r = await fetchArticle('not a url')
 * console.log(r.ok, r.reason)
 * // => false invalid-url
 */
export async function fetchArticle(url, options = {}) {

    //check
    if (!isobj(options)) {
        options = {}
    }
    if (!isestr(url)) {
        return { ok: false, url, reason: 'invalid-url', message: 'url 需為非空字串' }
    }

    const r = await fetchWeb(url, {
        method: 'curl',
        parse: true,
        showLog: false,
        timeoutMs: options.timeoutMs || 30_000,
        maxRetries: 2,
        adapters: Array.isArray(options.adapters) ? options.adapters : DEFAULT_SITE_ADAPTERS,
    })
    if (r.status !== 'success') {
    // w-fetch-web 1.0.17 起失敗結果頂層帶 reason(finalizeResult.mjs:115,取最後一階之歸因);
    // 1.0.18 起於 adapter 階收攤者頂層另帶 adapterId(:122),本函數未讀取(失敗歸因足夠)。
    // 1.0.15 時頂層不帶 reason,只在 attempts[0](blocked 帶 type、failed 帶 reason)——保留為退路
        const a0 = r.attempts?.[0] || {}
        return { ok: false, url, reason: r.reason || a0.reason || a0.type || 'fetch-error', message: r.message }
    }
    return { ok: true, url, title: r.title, content: r.content, contentLength: r.contentLength, method: r.method, adapterId: r.adapterId || '' }
}

/**
 * 抓取彙整貼文並抽取其外部連結(不解析正文——彙整貼文本身不是知識,連結才是)。
 *
 * url 非有效字串時不發網路、不拋錯,直接回失敗結果(reason 取 w-fetch-web constants.REASONS 之 invalid-url)。
 *
 * @param {String} url 輸入彙整貼文網址字串
 * @param {Object} [options={}] 輸入設定物件，非物件視為{}
 * @param {Integer} [options.timeoutMs=30000] 輸入逾時毫秒數
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok, url, links?:Array<{url,text}>, reason?, message? }
 * @example
 * need test in nodejs.
 *
 * const r = await fetchArticleLinks(123)
 * console.log(r.ok, r.reason)
 * // => false invalid-url
 */
export async function fetchArticleLinks(url, options = {}) {

    //check
    if (!isobj(options)) {
        options = {}
    }
    if (!isestr(url)) {
        return { ok: false, url, reason: 'invalid-url', message: 'url 需為非空字串' }
    }

    const r = await fetchWebByCurl(url, { timeoutMs: options.timeoutMs || 30_000, maxRetries: 2 })
    if (r.status !== 'success') {
        return { ok: false, url, reason: r.reason || 'fetch-error', message: r.message }
    }
    return { ok: true, url, links: extractLinks(r.html, url) }
}

// ─── Feed 探測(自動擴充來源用)─────────────────────────

const COMMON_FEED_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/blog/feed']

/**
 * 判斷文字前段是否含 RSS/Atom/RDF 的根標籤特徵,用於確認抓回內容確實是 feed(而非僅「路徑看起來像」)
 *
 * @param {*} text 輸入待判斷文字，null／undefined 視為空字串
 * @returns {Boolean} 回傳是否判定為 feed
 */
function looksLikeFeed(text) {
    const head = String(text || '').slice(0, 2000).toLowerCase()
    return head.includes('<rss') || head.includes('<feed') || head.includes('<rdf:rdf')
}

/**
 * 從一個網站首頁探測可用的 RSS/Atom feed。
 * 先讀 HTML 的 <link rel="alternate">,再試常見路徑;皆須實際抓回並確認是 feed 才回傳
 * ——不可只憑「路徑看起來像 feed」就登錄成來源,否則來源清單會塞滿抓不到東西的死連結。
 * 探測型請求(一次性試抓、失敗就算了)用最小重試預算。
 *
 * siteUrl 非有效字串時不發網路、不拋錯,直接回失敗結果。
 *
 * @param {String} siteUrl 輸入網站首頁網址字串
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ok, feedUrl?, siteTitle?, message? }
 * @example
 * need test in nodejs.
 *
 * const r = await discoverFeed(null)
 * console.log(r.ok, r.message)
 * // => false siteUrl 需為非空字串
 */
export async function discoverFeed(siteUrl) {

    //check
    if (!isestr(siteUrl)) {
        return { ok: false, message: 'siteUrl 需為非空字串' }
    }

    const base = normalizeUrl(siteUrl)
    const r = await fetchWebByCurl(base, { timeoutMs: 12_000, maxRetries: 1 })
    const candidates = []

    if (r.status === 'success') {
        const html = r.html
        const linkRe = /<link[^>]+>/gi
        for (const tag of html.match(linkRe) || []) {
            if (!/rel=["']?alternate/i.test(tag)) continue
            if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue
            const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
            if (href) {
                try {
                    candidates.push(new URL(href, base).toString())
                }
                catch { /* 忽略畸形 href */ }
            }
        }
    }
    for (const p of COMMON_FEED_PATHS) {
        try {
            candidates.push(new URL(p, base).toString())
        }
        catch { /* 忽略 */ }
    }

    for (const c of [...new Set(candidates)].slice(0, 8)) {
        const fr = await fetchWebByCurl(c, { timeoutMs: 12_000, maxRetries: 1 })
        if (fr.status === 'success' && looksLikeFeed(fr.html)) {
            const siteTitle = (fr.html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim()
            return { ok: true, feedUrl: c, siteTitle }
        }
    }
    return { ok: false, message: r.status === 'success' ? '未找到可用 feed' : `首頁抓取失敗:${r.message}` }
}

export default { fetchArticle, fetchArticleLinks, discoverFeed }
