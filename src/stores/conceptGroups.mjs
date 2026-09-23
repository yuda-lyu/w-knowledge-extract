// conceptGroups.mjs — 概念分群與提煉選題的泛用機制
//
// 【以概念而非類別分群】類別太粗、提煉出來只會是泛論；概念是萃取時標好的細粒度標籤，
//   同概念的筆記彼此可對照可互補。分群鍵一律走 normalizeConcept——
//   標籤只要對不起來，提煉就永遠選不出東西。
//
// 【gain 選題】某概念的筆記數比上次提煉時多才重跑：沒有新資訊卻重跑，
//   只會消耗 AI 額度並讓核心檔在同一內容上反覆抖動。
// 【gain × 等待天數排序（aging）】只以絕對增量排序時，大概念每小時都有新筆記、增量永遠最大，
//   會壟斷每輪名額：2026-09-06 生產實測 275 個合格概念中 194 個從未提煉（含多個核心主題），
//   29 則核心逾 7 天有新料排不到，而最大的概念已 v103。乘上等待天數後，
//   久候者分數自然升高、剛提煉者歸零，大概念仍會定期輪到（不是被排除），無門檻常數可調。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import { normalizeConcept } from '../util/text.mjs'

/**
 * 既有概念詞彙表（依使用篇數降冪），餵回萃取 prompt 令標籤收斂成共用詞彙
 *
 * @param {Object} notes 輸入筆記集合，需具 select 方法
 * @param {Integer} [limit=60] 輸入回傳最多幾條，非正整數則用預設 60
 * @returns {Promise} 回傳 Promise，resolve 回傳字串陣列，格式為 '<顯示寫法>(<使用篇數>)'
 * @throws {Error} notes 缺 select 方法時拋出
 */
export async function conceptVocabulary(notes, limit = 60) {

    //check
    if (!isfun(notes?.select)) {
        throw new Error('conceptVocabulary 需要 notes 集合（具 select 方法）')
    }
    if (!ispint(limit)) {
        limit = 60
    }
    limit = cint(limit)

    const all = await notes.select()
    const count = new Map()
    const forms = new Map() // key → Map(原始寫法 → 次數)
    for (const n of all) {
        const seenKeys = new Set() // 同一篇筆記之多個標籤折疊成同一鍵時只計一次(計的是「使用篇數」)
        for (const c of n.concepts || []) {
            const key = normalizeConcept(c)
            if (!key || seenKeys.has(key)) continue
            seenKeys.add(key)
            count.set(key, (count.get(key) || 0) + 1)
            if (!forms.has(key)) forms.set(key, new Map())
            const f = String(c).trim()
            forms.get(key).set(f, (forms.get(key).get(f) || 0) + 1)
        }
    }
    // display 取「最常見的原始寫法」而非首見：字形折疊後同鍵可能混著繁簡兩種寫法，
    // 首見若是簡體，詞彙表回饋 prompt 反而會鼓勵模型續用簡體——取多數寫法才會收斂
    const displayOf = (key) => [...forms.get(key).entries()].sort((a, b) => b[1] - a[1])[0][0]
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
        .map(([k, v]) => `${displayOf(k)}(${v})`)
}

/**
 * 概念層選題：筆記數達門檻且比上次提煉多者，依 score＝gain × 等待天數 降冪（同分依 gain、再依筆記數）。
 * 等待天數：有核心者自上次提煉（core.updatedAt）起算；尚無核心者自該群最早筆記起算（素材等了多久）。
 *
 * @param {Array} notes 輸入已由呼叫端取出之筆記陣列，非陣列則視為空陣列
 * @param {Array} cores 輸入已由呼叫端取出之核心檔陣列，非陣列則視為空陣列
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Number} [opt.minNotes] 輸入群組最少筆記數門檻，非數值則視為 0（維持現行「不過濾」語意）
 * @param {Number} [opt.now] 輸入現在時刻毫秒數(測試注入用)，非有限數則用 Date.now()
 * @returns {Array} 回傳選題陣列，依 score 降冪排序，每項 { concept, notes, core, gain, ageDays, score, scope:'concept' }
 * @example
 * let notes = [{ concepts: ['甲'], createdAt: '2026-09-01T00:00:00Z' }, { concepts: ['甲'], createdAt: '2026-09-02T00:00:00Z' }]
 * let out = pickConcepts(notes, [], { minNotes: 2, now: Date.parse('2026-09-10T00:00:00Z') })
 * console.log(out.map((o) => [o.concept, o.notes.length]))
 * // => [ [ '甲', 2 ] ]
 */
export function pickConcepts(notes, cores, opt = {}) {

    //check
    if (!isarr(notes)) {
        notes = []
    }
    if (!isarr(cores)) {
        cores = []
    }
    if (!isobj(opt)) {
        opt = {}
    }
    let minNotes = opt.minNotes
    if (!isnum(minNotes)) {
        minNotes = 0
    }
    minNotes = cdbl(minNotes)
    const now = opt.now

    const nowMs = Number.isFinite(now) ? now : Date.now()
    const byConcept = new Map()
    for (const n of notes) {
        // 同一篇筆記之多個標籤折疊成同一鍵(如 ['過擬合','过拟合'] 或重複標籤)時只入群一次:
        // 此前逐標籤入群,同篇重複計入群組——增量(gain)與 noteCount 虛增、同篇重複送進提煉 prompt(2026-09-23 修)
        const seenKeys = new Set()
        for (const c of n.concepts || []) {
            const key = normalizeConcept(c)
            if (!key || seenKeys.has(key)) continue
            seenKeys.add(key)
            if (!byConcept.has(key)) byConcept.set(key, { forms: new Map(), list: [] })
            const g = byConcept.get(key)
            const f = String(c).trim()
            g.forms.set(f, (g.forms.get(f) || 0) + 1)
            g.list.push(n)
        }
    }
    const coreMap = new Map(cores.map((c) => [normalizeConcept(c.concept), c]))
    const out = []
    for (const [key, group] of byConcept) {
    // display 取最常見寫法（理由同 conceptVocabulary）：它會成為核心檔的概念名
        group.display = [...group.forms.entries()].sort((a, b) => b[1] - a[1])[0][0]
        if (group.list.length < minNotes) continue
        const core = coreMap.get(key)
        const lastCount = core?.noteCount || 0
        if (group.list.length <= lastCount) continue
        const gain = group.list.length - lastCount
        const sinceRaw = core?.updatedAt
            ? Date.parse(core.updatedAt)
            : Math.min(...group.list.map((n) => Date.parse(n.createdAt || '')).filter(Number.isFinite), nowMs)
        const ageDays = Math.max(0, (nowMs - (Number.isFinite(sinceRaw) ? sinceRaw : nowMs)) / 86400_000)
        out.push({ concept: group.display, notes: group.list, core, gain, ageDays, score: gain * ageDays, scope: 'concept' })
    }
    out.sort((a, b) => b.score - a.score || b.gain - a.gain || b.notes.length - a.notes.length)
    return out
}

/**
 * 後備：類別層選題（概念詞彙尚未收斂、概念層挑不出群組時啟用）。
 * 門檻較高、增量要求較大——類別層較粗，寧可少做也不要產出泛論。
 *
 * @param {Array} notes 輸入已由呼叫端取出之筆記陣列，非陣列則視為空陣列
 * @param {Array} cores 輸入已由呼叫端取出之核心檔陣列，非陣列則視為空陣列
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Integer} [opt.minNotes=6] 輸入群組最少筆記數門檻
 * @param {Integer} [opt.minGain=4] 輸入最少增量門檻
 * @returns {Array} 回傳選題陣列，依 gain 降冪排序，每項 { concept, notes, core, gain, scope:'category' }
 * @example
 * let notes = Array.from({ length: 6 }, () => ({ category: '其他' }))
 * console.log(pickCategories(notes, [], { minNotes: 6, minGain: 4 }).map((o) => [o.concept, o.gain]))
 * // => [ [ '其他', 6 ] ]
 */
export function pickCategories(notes, cores, opt = {}) {

    //check
    if (!isarr(notes)) {
        notes = []
    }
    if (!isarr(cores)) {
        cores = []
    }
    if (!isobj(opt)) {
        opt = {}
    }
    const { minNotes = 6, minGain = 4 } = opt

    const byCat = new Map()
    for (const n of notes) {
        const cat = n.category || '其他'
        if (!byCat.has(cat)) byCat.set(cat, [])
        byCat.get(cat).push(n)
    }
    const coreMap = new Map(cores.map((c) => [normalizeConcept(c.concept), c]))
    const out = []
    for (const [cat, list] of byCat) {
        if (list.length < minNotes) continue
        const core = coreMap.get(normalizeConcept(cat))
        const lastCount = core?.noteCount || 0
        if (list.length - lastCount < minGain) continue
        out.push({ concept: cat, notes: list, core, gain: list.length - lastCount, scope: 'category' })
    }
    out.sort((a, b) => b.gain - a.gain)
    return out
}

export default { conceptVocabulary, pickConcepts, pickCategories }
