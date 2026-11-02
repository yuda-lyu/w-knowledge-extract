// contentCache.mjs — 出處筆記之逐篇判定之快取(stores 層;派生檔):內容鍵快取、推定判定之快取與正文雜湊
//
// 【內容鍵快取】已消化筆記之內容鍵(domain.noteDigest 之 contentKey 的雜湊),以 mtime＋大小快取(dirs.state/extract-content.json,
//   派生檔,缺／壞／版本不符即重建);md 讀不到 → null(不是「內容變為空」,不算變更、不入批)。
// 【推定之判定與其快取】核心 md 之推定標記(domain.renderState 之 ctx.noTopOf)須知出處筆記是否自承無最高證據等級之要件:判準為摘要套件之
//   noTopEvidenceOf(與摘要之最高級要件同一判準),材料同摘要之讀法(caveats 取 md 之 frontmatter、無則取記錄;證據說明取 md)。逐篇判定以 md 之
//   mtime＋大小快取(dirs.state/extract-notop.json;派生檔,規則或格式不符即重建)——渲染每輪逐核心進行,不快取即每輪重讀全部出處之 md。
//   內容鍵快取另成一檔:兩者之有效條件不同(內容鍵隨章節設定換版、推定隨證據規則換版),合為一檔則一方換版會連帶作廢另一方。

import fs from 'fs'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { oneline, readJson, sha1, writeFileAtomic, textValueOf as str } from '../core/capturePackage.mjs'
import { evidenceCaveatsOf, evidenceNoteOf, noTopEvidenceOf, noteMaterialText, readMd } from '../core/summarizePackage.mjs'
import { CONTENT_CACHE_FILE, NO_TOP_CACHE_FILE } from './extractFiles.mjs'

export { CONTENT_CACHE_FILE, NO_TOP_CACHE_FILE }


/** 內容鍵快取之格式(2:每筆另存正文雜湊);不符即重建 */
const CACHE_FORMAT = 2

/**
 * 正文雜湊(與章節設定無關):原文標題＋內容章(不含投影章、來源章——摘要套件之 noteMaterialText)之空白正規化後雜湊。
 *   內容鍵(contentKey)隨提煉之章節設定與正規化規則換版;換版時以本雜湊分辨「只是鍵之定義變了」(相同 → 靜默換版)與「內容也改了」(不同 → 重審)
 *
 * @param {Object|null} md 輸入 readMd 之產物
 * @returns {String|null} 回傳 40 碼雜湊(md 為空回 null)
 * @example
 * console.log(bodyHashOf(null), bodyHashOf({ body: '# 標題\n\n## 一句話重點\n\n內容' }) === bodyHashOf({ body: '# 標題\n\n## 一句話重點\n\n內容  ' }))
 * // => null true
 */
export function bodyHashOf(md) {
    if (!md) return null
    return sha1(noteMaterialText(md.body).replace(/\s+/g, ' ').trim())
}

/**
 * 內容鍵快取:{ v:內容鍵版本, f:格式, notes:{ 筆記 id: [mtimeMs, size, 內容鍵雜湊|null, 正文雜湊|null] } };mtime 與大小皆同即沿用,否則讀 md 重算
 *
 * @param {String} file 輸入快取檔路徑
 * @param {Object} domain 輸入提煉 domain(noteDigest、contentKeyVersion)
 * @returns {Object} 回傳 { enabled:Boolean(domain 有內容鍵版本), version, keyOf(note) → 雜湊|null, bodyOf(note) → 正文雜湊|null, save() }
 * @example
 * need test in nodejs.
 *
 * const cache = createContentCache(`${dirs.state}/content-cache.json`, domain)
 * const key = cache.keyOf(note)
 */
export function createContentCache(file, domain) {
    const version = str(domain?.contentKeyVersion)
    const enabled = !!version && typeof domain?.noteDigest === 'function'
    const raw = enabled ? readJson(file, null) : null
    const ok = isobj(raw) && raw.v === version && raw.f === CACHE_FORMAT && isobj(raw.notes)
    const notes = ok ? raw.notes : {}
    let dirty = enabled && !ok
    const entryOf = (note) => {
        if (!enabled || !str(note?.file)) return null
        let st
        try {
            st = fs.statSync(note.file)
        }
        catch {
            return null
        }
        const e = notes[note.id]
        if (isarr(e) && e[0] === st.mtimeMs && e[1] === st.size) return e
        const md = readMd(note.file)
        const key = md ? domain.noteDigest(note, md, {})?.contentKey : null
        const next = [st.mtimeMs, st.size, typeof key === 'string' ? sha1(key) : null, bodyHashOf(md)]
        notes[note.id] = next
        dirty = true
        return next
    }
    return {
        enabled,
        version,
        keyOf: (note) => entryOf(note)?.[2] ?? null,
        bodyOf: (note) => entryOf(note)?.[3] ?? null,
        save: () => {
            if (!dirty) return
            writeFileAtomic(file, JSON.stringify({ v: version, f: CACHE_FORMAT, notes }))
            dirty = false
        },
    }
}

/** 推定判定之快取之格式(材料之讀法或判定之式改變即換版);不符即重建 */
const NO_TOP_FORMAT = 1

/**
 * 筆記是否自承無最高證據等級之要件(推定之判準;檔頭【推定之判定與其快取】):摘要套件之 noTopEvidenceOf,材料同摘要之讀法——caveats 取 md 之
 *   frontmatter、無則取筆記記錄(evidenceCaveatsOf),證據說明取 md 之證據等級行(evidenceNoteOf);md 讀不到者只以記錄之 caveats 判
 *
 * @param {Object} note 輸入筆記記錄
 * @param {Object|null} md 輸入 readMd 之產物(讀不到為 null)
 * @param {Object|null} rule 輸入證據規則(詞彙表之 evidenceRule;停用或 null 恆 false)
 * @returns {Boolean} 回傳是否自承無要件(且無另一種合格證據)
 * @example
 * console.log(noteNoTopOf({ caveats: ['觀測期短'] }, null, null))
 * // => false
 */
export function noteNoTopOf(note, md, rule) {
    return noTopEvidenceOf({ caveats: evidenceCaveatsOf(md?.front, note), evidence: md ? evidenceNoteOf(md.body) : '' }, rule)
}

/**
 * 推定判定之逐篇快取:{ f:格式, r:規則之指紋, notes:{ 筆記 id: [mtimeMs, size, 判定(0|1), 記錄之 caveats 指紋] } }——md 之 mtime 與大小皆同即沿用
 *   (同內容鍵快取之機制);判定之 caveats 取自 md 者記錄之指紋為 '',取自記錄者(md 無 caveats)記其指紋,記錄改了即重判。
 *   規則(或格式)與快取不符 → 整份重建;規則停用 → 恆 false(不讀檔);md 不存在(stat 失敗)→ 只以記錄判、不快取
 *
 * @param {String} file 輸入快取檔路徑
 * @param {Object|null} rule 輸入證據規則(提煉 domain 之 evidenceRule)
 * @returns {Object} 回傳 { of(note) → Boolean, save() }
 * @example
 * need test in nodejs.
 *
 * const cache = createNoTopCache(`${dirs.state}/notop-cache.json`, domain.evidenceRule)
 * const noTop = cache.judge(note)
 */
export function createNoTopCache(file, rule) {
    const off = rule === null || rule === undefined || rule.enabled === false
    const ruleKey = sha1(JSON.stringify(rule ?? null)).slice(0, 16)
    const raw = off ? null : readJson(file, null)
    const notes = isobj(raw) && raw.f === NO_TOP_FORMAT && raw.r === ruleKey && isobj(raw.notes) ? raw.notes : {}
    let dirty = false
    const recKeyOf = (note) => sha1(JSON.stringify(isarr(note?.caveats) ? note.caveats : [])).slice(0, 12)
    return {
        of: (note) => {
            if (off || !isobj(note)) return false
            let st = null
            try {
                st = str(note.file) ? fs.statSync(note.file) : null
            }
            catch {
                st = null
            }
            if (!st) return noteNoTopOf(note, null, rule)
            const e = notes[note.id]
            if (isarr(e) && e[0] === st.mtimeMs && e[1] === st.size && (e[3] === '' || e[3] === recKeyOf(note))) return e[2] === 1
            const md = readMd(note.file)
            const flag = noteNoTopOf(note, md, rule)
            notes[note.id] = [st.mtimeMs, st.size, flag ? 1 : 0, isarr(md?.front?.caveats) ? '' : recKeyOf(note)]
            dirty = true
            return flag
        },
        save: () => {
            if (!dirty) return
            writeFileAtomic(file, JSON.stringify({ f: NO_TOP_FORMAT, r: ruleKey, notes }))
            dirty = false
        },
    }
}

/**
 * 存推定判定之快取(派生檔:寫不進只 WARN——下次以 md 重判,不影響本輪之渲染)
 *
 * @param {Object} env 輸入本段環境(取 noTopCache)
 * @param {Object} log 輸入日誌
 * @returns {void} 無回傳值(寫不進只 WARN)
 * @example
 * need test in nodejs.
 *
 * saveNoTopCache({ noTopCache }, log)
 */
export function saveNoTopCache(env, log) {
    try {
        env.noTopCache?.save()
    }
    catch (e) {
        log.warn(`提煉維護失敗[推定判定快取]：${oneline(e?.message, 160)}`)
    }
}

export default { CONTENT_CACHE_FILE, NO_TOP_CACHE_FILE, bodyHashOf, createContentCache, noteNoTopOf, createNoTopCache, saveNoTopCache }
