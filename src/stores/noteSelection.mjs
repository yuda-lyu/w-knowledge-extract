// noteSelection.mjs — 提煉選篇(純函數,可經錨點置換):自選題項之候選中挑出本批筆記並配發批內代號 N1…Nk
//
// 【為何不再取「最新 N 篇」】1.x 選篇＝全概念最新 8 篇:兩次更新間新進 >8 篇時較舊者永不再被選、主標籤筆記被順帶掛標者擠掉、
//   內容時期集中於最近(安裝方〈建議w-knowledge-extract優化〉§1.3、§2.3)。2.0 起(2026-09-29 雙審定案 §11.1 A22):
//   ①候選＝本核心未用過且已可提煉者(選題已排除);②主標籤優先,不足一批才以次標籤補位(主標籤是待提煉之義務,次標籤只補位;
//     主標籤足量但集中於少數來源時,先放寬主標籤之來源上限,仍不足才輪到次標籤——1.0.4 曾讓次標籤先於放寬之主標籤,
//     實測排乾批數多 1.4～4.3 倍、殘餘主標籤要再等 30 天或閒置輪,2026-09-29 三獨立審定案 P1);
//   ③依內容時期(發布年)分層、自最新之年起輪流取,使各時期之觀點都有機會進入;
//   ④同層內:有衝突邊者、證據等級高者、有樣本期者先,再依建立時間(先來先用);
//   ⑤同一來源每批至多 sourceCap 篇——先施於同一層(主標籤、次標籤各自)內;該層依上限取不足時先放寬該層,再往下一層取
//     (不因多樣性要求而讓批次變小,也不讓多樣性凌駕主次);衝突成對(⑥)為例外,不受來源上限與主次限制;
//   ⑥選中之筆記若有「同概念、未用過」之衝突另一端,緊接成對入批——爭議之兩方才都有本批出處可引;
//   ⑦每批先保留 ⌈篇數／4⌉ 給最新建立之候選——依年分層時年數多則當年新料每批只分到約 1／年數,遷移積壓期間樞紐概念之新料
//     要等數月,與「活體回顧:新證據到來即增量更新」相違(第二輪判識 A Q7);
//   ⑧曾被送過而未被涵蓋之筆記(重送)排在同層最後,不擠掉新筆記(判識 B Q2)。
// 【批內代號】模型以 N1…Nk 引用出處,程式對回筆記 id:長中文 slug 抄寫誤差常見(關聯段曾為此加尾碼容錯),代號根除之。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'

/**
 * 由字串取年份(19xx／20xx 之第一個;取不到回 null)
 *
 * @param {*} v 輸入任意值(如 '2024-05-01'、'2015-2025'、2024)
 * @param {Boolean} [last=false] 輸入是否取最後一個年份(樣本期取其末年)
 * @returns {Integer|null} 回傳年份或 null
 * @example
 * console.log(yearOf('2015-2025', true), yearOf('Tue, 03 Sep 2024 10:00:00 GMT'), yearOf('未載明'))
 * // => 2025 2024 null
 */
export function yearOf(v, last = false) {
    const m = String(v ?? '').match(/(?:19|20)\d{2}/g)
    if (!m) return null
    return Number(last ? m[m.length - 1] : m[0])
}

/**
 * 選篇
 *
 * @param {Array} candidates 輸入候選 [{ note, primary:Boolean }](選題項之 candidates)，非陣列視為空
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}
 * @param {Integer} [opt.limit=12] 輸入本批篇數上限
 * @param {Integer} [opt.sourceCap=2] 輸入同一來源每批上限(不足一批時放寬)
 * @param {Function} [opt.publishedOf] 輸入 (note) => 發布時間字串(如由 docs.publishedAt 以 docId 對照)；取不到年份則退樣本期末年、再退建立年
 * @param {Function} [opt.sourceOf] 輸入 (note) => 來源識別字串，預設 note.sourceName
 * @param {Map} [opt.conflicts] 輸入 筆記 id → 衝突另一端 id 陣列(已限同概念與否不拘,本函數只取候選內者)
 * @param {Array} [opt.levels=['高','中','低']] 輸入證據等級(由高到低,用於同層排序)
 * @param {Number} [opt.newestShare=0.25] 輸入保留給最新建立之候選之比例(取上整;0 即不保留)
 * @param {Function} [opt.triesOf] 輸入 (noteId) => 已重送次數，>0 者排在同層最後且不入最新保留
 * @returns {Array} 回傳本批 [{ code:'N1', id, note, primary }]
 * @example
 * const c = [1, 2, 3].map((i) => ({ note: { id: `n${i}`, createdAt: `2026-09-0${i}`, sourceName: 'S' }, primary: true }))
 * console.log(selectNotes(c, { limit: 2 }).map((x) => x.code + ':' + x.id).join(','))
 * // => N1:n1,N2:n2
 */
export function selectNotes(candidates, opt = {}) {
    if (!isarr(candidates)) candidates = []
    if (!isobj(opt)) opt = {}
    const limit = Number.isInteger(opt.limit) && opt.limit > 0 ? opt.limit : 12
    const sourceCap = Number.isInteger(opt.sourceCap) && opt.sourceCap > 0 ? opt.sourceCap : 2
    const publishedOf = typeof opt.publishedOf === 'function' ? opt.publishedOf : (n) => n?.published || ''
    const sourceOf = typeof opt.sourceOf === 'function' ? opt.sourceOf : (n) => n?.sourceName || ''
    const conflicts = opt.conflicts instanceof Map ? opt.conflicts : new Map()
    const levels = isarr(opt.levels) && opt.levels.length ? opt.levels : ['高', '中', '低']
    const newestShare = Number.isFinite(opt.newestShare) && opt.newestShare >= 0 ? opt.newestShare : 0.25
    const triesOf = typeof opt.triesOf === 'function' ? opt.triesOf : () => 0
    const retried = (n) => (Number(triesOf(n.id)) || 0) > 0 ? 1 : 0
    const pool = new Map(candidates.filter((c) => c?.note?.id).map((c) => [c.note.id, c]))

    const yearKey = (n) => yearOf(publishedOf(n)) ?? yearOf(n?.samplePeriod, true) ?? yearOf(n?.createdAt) ?? 0
    const weight = (n) => {
        const r = levels.indexOf(n?.evidenceLevel)
        return ((conflicts.get(n.id) || []).some((x) => pool.has(x)) ? 4 : 0) + (r < 0 ? 0 : levels.length - r) + (yearOf(n?.samplePeriod) ? 0.5 : 0)
    }
    // 分層:年份 → 同層依權重降冪、建立時間升冪
    const strata = (list) => {
        const by = new Map()
        for (const c of list) {
            const y = yearKey(c.note)
            if (!by.has(y)) by.set(y, [])
            by.get(y).push(c)
        }
        for (const arr of by.values()) arr.sort((a, b) => retried(a.note) - retried(b.note) || weight(b.note) - weight(a.note) || String(a.note.createdAt || '').localeCompare(String(b.note.createdAt || '')) || String(a.note.id).localeCompare(String(b.note.id)))
        return [...by.keys()].sort((a, b) => b - a).map((y) => by.get(y))
    }

    const picked = []
    const taken = new Set()
    const perSource = new Map()
    const room = () => picked.length < limit
    const take = (c, capped) => {
        if (!room() || taken.has(c.note.id)) return false
        const src = sourceOf(c.note)
        if (capped && src && (perSource.get(src) || 0) >= sourceCap) return false
        taken.add(c.note.id)
        perSource.set(src, (perSource.get(src) || 0) + 1)
        picked.push(c)
        // 衝突另一端成對入批(候選內、未取者)
        for (const other of conflicts.get(c.note.id) || []) {
            const o = pool.get(other)
            if (o && !taken.has(other) && room()) {
                taken.add(other)
                perSource.set(sourceOf(o.note), (perSource.get(sourceOf(o.note)) || 0) + 1)
                picked.push(o)
            }
        }
        return true
    }
    // 輪取:各年層每次取一篇;capped＝是否套同來源上限
    const roundRobin = (layers, capped) => {
        const idx = layers.map(() => 0)
        let progress = true
        while (room() && progress) {
            progress = false
            for (let k = 0; k < layers.length && room(); k++) {
                while (idx[k] < layers[k].length) {
                    const c = layers[k][idx[k]++]
                    if (take(c, capped)) {
                        progress = true
                        break
                    }
                }
            }
        }
    }
    const primary = candidates.filter((c) => c?.note?.id && c.primary)
    const secondary = candidates.filter((c) => c?.note?.id && !c.primary)
    // 最新保留:主標籤中最新建立、未曾重送者先取 ⌈limit×比例⌉ 篇(套同來源上限)
    const reserve = Math.min(limit, Math.ceil(limit * newestShare))
    const newest = primary.filter((c) => !retried(c.note)).sort((a, b) => String(b.note.createdAt || '').localeCompare(String(a.note.createdAt || '')) || String(a.note.id).localeCompare(String(b.note.id)))
    for (const c of newest) {
        if (picked.length >= reserve) break
        take(c, true)
    }
    // 主標籤優先(②):主標籤限來源 → 主標籤放寬 → 次標籤限來源 → 次標籤放寬;來源上限只在同一層內求多樣(⑤)
    roundRobin(strata(primary), true)
    roundRobin(strata(primary), false)
    roundRobin(strata(secondary), true)
    roundRobin(strata(secondary), false)
    return picked.map((c, k) => ({ code: `N${k + 1}`, id: c.note.id, note: c.note, primary: !!c.primary }))
}

export default { yearOf, selectNotes }
