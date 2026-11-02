// similarity.mjs — 提煉守門共用之文字相似度(純函數＋快取);數字紮根已移至檢定標準共用件 core/standards/numbers
//
// 【判準】正規化＝NFKC＋簡轉繁折疊(抓取套件之 cnToTw;比對用,非繁體中文之文字為不動點)＋小寫＋去空白標點符號;相似度＝雙字組袋之有向包含率
//   (a 之雙字組有多少比例出現在 b)——評比之計分器與補丁守門(workflow/reviewGuards)用同一判準,門檻(重複 0.7、改寫保留 0.5)即在此判準下驗證。
// 【字組袋必須快取】守門每次改動都要重算全部受保護條目之包含率;每次重建字組袋時,多份補丁之重放耗時以分鐘計,
//   快取後降至秒級、結果逐字相同。

import { cnToTw } from '../core/capturePackage.mjs'
import { numberSet } from '../core/summarizePackage.mjs'

const cn2tw = (s) => cnToTw(s)
const LIMIT = 50_000
const foldCache = new Map()
const bagCache = new Map()

/**
 * 字形折疊:NFKC 後簡轉繁(比對用,不改寫內容)
 *
 * @param {*} s 輸入任意值(非字串以 String 轉)
 * @returns {String} 回傳折疊後字串
 * @example
 * console.log(foldScript('软件开发'))
 * // => 軟件開發
 */
export function foldScript(s) {
    const key = String(s ?? '')
    let v = foldCache.get(key)
    if (v === undefined) {
        v = cn2tw(key.normalize('NFKC'))
        if (foldCache.size > LIMIT) foldCache.clear()
        foldCache.set(key, v)
    }
    return v
}

/**
 * 比對用正規化:字形折疊、小寫、去空白與標點符號
 *
 * @param {*} s 輸入任意值
 * @returns {String} 回傳正規化字串
 * @example
 * console.log(normText('Hello, World！ 你好'))
 * // => helloworld你好
 */
export function normText(s) {
    return foldScript(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

/**
 * 雙字組袋(快取):單字元字串以該字為一袋
 *
 * @param {*} s 輸入任意值
 * @returns {Map} 回傳 雙字組 → 次數
 * @example
 * console.log(bagOf('甲乙丙').size, bagOf('甲').size)
 * // => 2 1
 */
export function bagOf(s) {
    const key = String(s ?? '')
    let bag = bagCache.get(key)
    if (bag) return bag
    const t = normText(key)
    bag = new Map()
    if (t.length === 1) bag.set(t, 1)
    for (let i = 0; i < t.length - 1; i++) {
        const g = t.slice(i, i + 2)
        bag.set(g, (bag.get(g) || 0) + 1)
    }
    if (bagCache.size > LIMIT) bagCache.clear()
    bagCache.set(key, bag)
    return bag
}

/**
 * 有向包含率:a 之雙字組有多少比例出現在 b(a 為空回 0)
 *
 * @param {*} a 輸入被包含者
 * @param {*} b 輸入容器
 * @returns {Number} 回傳 0～1
 * @example
 * console.log(containment('光合作用', '植物之光合作用效率') === 1)
 * // => true
 */
export function containment(a, b) {
    const A = bagOf(a)
    const B = bagOf(b)
    let na = 0
    let inter = 0
    for (const [g, v] of A) {
        na += v
        inter += Math.min(v, B.get(g) || 0)
    }
    return na ? inter / na : 0
}

/**
 * a 在清單中之最佳包含率
 *
 * @param {*} a 輸入被包含者
 * @param {Array} list 輸入候選容器陣列(非陣列視為空)
 * @returns {Number} 回傳 0～1
 * @example
 * console.log(bestContainment('甲乙丙丁', ['甲乙丙丁戊己', '庚辛']), bestContainment('甲乙丙丁', []))
 * // => 1 0
 */
export function bestContainment(a, list) {
    let best = 0
    for (const b of Array.isArray(list) ? list : []) {
        const c = containment(a, b)
        if (c > best) best = c
        if (best >= 1) break
    }
    return best
}

/**
 * 雙向包含率(兩方向之較小者):判「實質相同」用,避免短句被長句包含即誤判重複
 *
 * @param {*} a 輸入字串甲
 * @param {*} b 輸入字串乙
 * @returns {Number} 回傳 0～1
 * @example
 * console.log(mutualContainment('甲乙丙丁', '甲乙丙丁'), mutualContainment('甲乙', '甲乙丙丁戊己庚辛'))
 * // => 1 0.14285714285714285
 */
export function mutualContainment(a, b) {
    return Math.min(containment(a, b), containment(b, a))
}

/** 否定與限定詞(判「實質相同」時兩句之否定詞集合須一致;否則結論可能相反) */
const NEGATIONS = ['不', '未', '非', '無', '沒有', '否', '難以', '失效', '反而', '相反', '並非', '不再']

/**
 * 兩句之否定詞集合是否一致(字形折疊後比對)
 *
 * @param {*} a 輸入字串甲
 * @param {*} b 輸入字串乙
 * @returns {Boolean} 回傳是否一致
 * @example
 * console.log(sameNegation('此法可行', '此法有效可行'), sameNegation('此法可行', '此法不可行'))
 * // => true false
 */
export function sameNegation(a, b) {
    const fa = foldScript(a)
    const fb = foldScript(b)
    return NEGATIONS.every((w) => fa.includes(w) === fb.includes(w))
}

/**
 * 「實質相同」判定(重複轉 confirm 之自動條件):雙向包含率 ≥ thr、數字集合相同、否定詞集合一致——三者皆成立才算
 *   (單向 ≥0.6 會把結論相反或加條件之新主張吞成確認,反方因此消失)
 *
 * @param {*} a 輸入新條目文字
 * @param {*} b 輸入既有條目文字
 * @param {Number} [thr=0.7] 輸入雙向包含率門檻(補丁守門驗證過之判重門檻)
 * @returns {Boolean} 回傳是否實質相同
 * @example
 * console.log(sameSubstance('吸積盤溫度提高了 35%', '吸積盤溫度提高了 35%'), sameSubstance('吸積盤溫度提高了 35%', '吸積盤溫度提高了 50%'))
 * // => true false
 */
export function sameSubstance(a, b, thr = 0.7) {
    if (mutualContainment(a, b) < thr) return false
    // 數字集合以檢定標準共用件取(core/standards/numbers):一位數帶事實單位者亦計(誤差 3% 與誤差 5% 不是同一主張)
    const na = [...numberSet(a)].sort().join('|')
    const nb = [...numberSet(b)].sort().join('|')
    if (na !== nb) return false
    return sameNegation(a, b)
}

export default { foldScript, normText, bagOf, containment, bestContainment, mutualContainment, sameNegation, sameSubstance }
