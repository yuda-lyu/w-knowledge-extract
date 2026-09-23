// md.mjs — 知識 md 的 frontmatter 讀寫與組裝（自原專案原樣抽提，泛用件）
//
// frontmatter 只用「純量 + 一維字串陣列」兩種型別，並自行序列化／解析，
// 不引入 YAML 套件：知識檔要能被任何工具（含 AI、grep、編輯器）穩定讀取，
// 型別越少越不會出現「寫得出來卻解析不回去」的不對稱。

import fs from 'fs'
import path from 'path'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isstr from 'wsemi/src/isstr.mjs'

/**
 * frontmatter 值轉為雙引號包覆字串(跳脫反斜線與雙引號,換行壓成空格)
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串，其餘轉字串
 * @returns {String} 回傳雙引號包覆之字串(內容已跳脫)
 */
function quote(s) {
    return `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`
}

/**
 * 去除 frontmatter 值兩側之雙引號並還原跳脫字元;非雙引號包覆之字串原樣回傳(去頭尾空白)
 *
 * @param {*} s 輸入任意值，null／undefined 視為空字串，其餘轉字串
 * @returns {String} 回傳還原後字串
 */
function unquote(s) {
    const t = String(s ?? '').trim()
    if (t.startsWith('"') && t.endsWith('"')) {
        return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return t
}

/**
 * 組出 frontmatter 區塊字串(--- 包夾之 key: value 清單);陣列值以雙引號逗號分隔清單呈現,數字／布林原樣,其餘字串加雙引號
 *
 * @param {Object} front 輸入 frontmatter 物件，非物件視為{}；值為 undefined／null 之鍵略過不輸出
 * @returns {String} 回傳 frontmatter 區塊字串(含首尾 --- 行)
 * @example
 * console.log(renderFrontmatter({ title: 'T', tags: ['a', 'b'], n: 3, ok: true }))
 * // => ---
 * //    title: "T"
 * //    tags: ["a", "b"]
 * //    n: 3
 * //    ok: true
 * //    ---
 */
export function renderFrontmatter(front) {

    //check
    if (!isobj(front)) {
        front = {}
    }

    const lines = ['---']
    for (const [k, v] of Object.entries(front)) {
        if (v === undefined || v === null) continue
        if (Array.isArray(v)) {
            lines.push(`${k}: [${v.map((x) => quote(x)).join(', ')}]`)
        }
        else if (typeof v === 'number' || typeof v === 'boolean') {
            lines.push(`${k}: ${v}`)
        }
        else {
            lines.push(`${k}: ${quote(v)}`)
        }
    }
    lines.push('---')
    return lines.join('\n')
}

/**
 * 解析 md 檔頭之 frontmatter 區塊(--- 包夾),還原純量與一維字串陣列;無 frontmatter 區塊時回空 front、原文全文為 body
 *
 * @param {*} text 輸入 md 檔案全文，null／undefined 視為空字串
 * @returns {Object} 回傳 { front:Object, body:String }
 * @example
 * const { front, body } = parseFrontmatter('---\ntitle: "T"\ntags: ["a", "b"]\n---\n\n內文')
 * console.log(front, JSON.stringify(body))
 * // => { title: 'T', tags: [ 'a', 'b' ] } "\n內文"
 *
 * const { front: f2, body: b2 } = parseFrontmatter('no frontmatter here')
 * console.log(f2, JSON.stringify(b2))
 * // => {} "no frontmatter here"
 */
export function parseFrontmatter(text) {
    const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!m) return { front: {}, body: String(text || '') }
    const front = {}
    for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
        if (!kv) continue
        const [, k, rawV] = kv
        const v = rawV.trim()
        if (v.startsWith('[') && v.endsWith(']')) {
            // 逐一抓出被雙引號包住的元素（允許 \" 轉義）；用切割字串的做法會被含逗號的元素咬到
            const inner = v.slice(1, -1)
            front[k] = [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
                .map((mm) => mm[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
        }
        else if (v === 'true' || v === 'false') {
            front[k] = v === 'true'
        }
        else if (/^-?\d+(\.\d+)?$/.test(v)) {
            front[k] = Number(v)
        }
        else {
            front[k] = unquote(v)
        }
    }
    return { front, body: m[2] }
}

/**
 * 寫入 md 檔(frontmatter ＋ 空行 ＋ 本文),自動建立父目錄
 *
 * body 非字串視為空字串(2026-09-23 修 F17:此前以 String(body) 轉換,body 為 undefined 時會把字面 'undefined' 寫進筆記)
 *
 * @param {String} file 輸入 md 檔案路徑字串
 * @param {Object} front 輸入 frontmatter 物件，非物件視為{}
 * @param {*} body 輸入本文，非字串視為''
 * @returns {String} 回傳寫入之 file 路徑(原樣回傳輸入)
 * @throws {Error} file 非有效字串時拋出
 * @example
 * need test in nodejs.
 *
 * writeMd('./tmp/note.md', { title: 'T' }, '# 內容')
 */
export function writeMd(file, front, body) {

    //check
    if (!isestr(file)) {
        throw new Error('writeMd 需要 file（檔案路徑字串）')
    }
    if (!isobj(front)) {
        front = {}
    }
    if (!isstr(body)) {
        body = ''
    }

    fsCreateFolder(path.dirname(file))
    fs.writeFileSync(file, `${renderFrontmatter(front)}\n\n${body.trim()}\n`, 'utf8')
    return file
}

/**
 * 讀 md 檔並解析 frontmatter;file 非有效字串、讀取失敗或解析拋錯皆回 null(維持「失敗回 null」語意)
 *
 * @param {String} file 輸入 md 檔案路徑字串
 * @returns {Object|null} 回傳 { front, body }，失敗時回傳 null
 * @example
 * need test in nodejs.
 *
 * console.log(readMd('./not-exist.md'))
 * // => null
 */
export function readMd(file) {

    //check
    if (!isestr(file)) {
        return null
    }

    try {
        return parseFrontmatter(fs.readFileSync(file, 'utf8'))
    }
    catch {
        return null
    }
}

/**
 * 以 md 章節組裝：section('標題', 內容) → '## 標題\n\n內容' 或空字串(內容為陣列時逐項轉為 - 開頭清單,過濾空白項)
 *
 * @param {String} title 輸入章節標題字串
 * @param {*} content 輸入章節內容，字串則直接使用(去頭尾空白)，陣列則逐項轉字串、去空白、過濾空值後轉為清單，其餘視為空
 * @returns {String} 回傳組好之章節字串，內容為空時回傳空字串(呼叫端可用 .filter(Boolean) 濾掉)
 * @example
 * console.log(JSON.stringify(section('重點', ['a', '', 'b'])))
 * // => "## 重點\n\n- a\n- b"
 *
 * console.log(section('重點', ''))
 * // =>
 */
export function section(title, content) {
    const c = Array.isArray(content)
        ? content.filter((x) => String(x || '').trim()).map((x) => `- ${String(x).trim()}`).join('\n')
        : String(content || '').trim()
    if (!c) return ''
    return `## ${title}\n\n${c}`
}

/**
 * 跳脫正規表示式特殊字元,供 sectionOf 動態組出比對標題用的 RegExp
 *
 * @param {*} s 輸入任意值(轉字串後跳脫)
 * @returns {String} 回傳已跳脫正規表示式特殊字元之字串
 */
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 找出 H2 章節「## title」的範圍：自標題起、到下一個 H2 之前(或檔尾)。找不到回 null。
 *
 * 【為何要「到下一個 H2 為止」】章節操作若一律延伸到檔尾,只在該章節恰為最後一章時正確；
 *   筆記的「關聯」與「⚠ 衝突與反例」兩章寫入時機不同、先後順序不定(2026-09-06 生產實測：
 *   133 篇衝突章在前、3823 篇關聯章在前),延伸到檔尾會把後面的章節一起算進來——
 *   衝突雙寫因此誤判「已寫過」而漏寫(86 篇),提煉輸入也把衝突章一併剝掉。
 *
 * @param {*} body 輸入 md 本文，null／undefined 視為空字串
 * @param {String} title 輸入章節標題字串(不含 ## 前綴)
 * @returns {Object|null} 找到時回傳 { start:Number, end:Number, text:String }(end 為下一章之前的換行位置,不含)；找不到回傳 null
 * @example
 * const body = '前言\n\n## 甲\n\n內容甲\n\n## 乙\n\n內容乙'
 * console.log(sectionOf(body, '甲'))
 * // => { start: 4, end: 14, text: '## 甲\n\n內容甲\n' }
 *
 * console.log(sectionOf('無此章節', '甲'))
 * // => null
 */
export function sectionOf(body, title) {
    const src = String(body || '')
    const m = new RegExp('(^|\\n)## ' + reEscape(title) + '[ \\t]*(?:\\n|$)').exec(src)
    if (!m) return null
    const start = m.index + (m[1] ? 1 : 0)
    const rest = src.slice(start + 3)
    const nx = rest.search(/\n## /)
    const end = nx < 0 ? src.length : start + 3 + nx
    return { start, end, text: src.slice(start, end) }
}

/**
 * 移除 H2 章節「## title」(僅該章,不動其後章節),回傳整理過空行的正文
 *
 * @param {*} body 輸入 md 本文，null／undefined 視為空字串
 * @param {String} title 輸入章節標題字串(不含 ## 前綴)
 * @returns {String} 回傳移除該章節後之正文(該章不存在時回傳去尾空白後之原文)
 * @example
 * const body = '前言\n\n## 甲\n\n內容甲\n\n## 乙\n\n內容乙'
 * console.log(JSON.stringify(dropSection(body, '甲')))
 * // => "前言\n\n## 乙\n\n內容乙"
 */
export function dropSection(body, title) {
    const src = String(body || '')
    const sec = sectionOf(src, title)
    if (!sec) return src.trimEnd()
    const head = src.slice(0, sec.start).trimEnd()
    const tail = src.slice(sec.end).replace(/^\n+/, '').trimEnd()
    return [head, tail].filter(Boolean).join('\n\n')
}

export default { renderFrontmatter, parseFrontmatter, writeMd, readMd, section, sectionOf, dropSection }
