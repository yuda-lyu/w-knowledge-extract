// evidence.mjs — 主張之證據等級由程式判定(中立預設):模型只寫證據性質(basis),等級由出處筆記之標注依規則彙整
//
// 【為何不交給模型】安裝方四輪實測:凡交給模型者都漂移——r1 一律降級(失去鑑別力)、r2 一律灌水(評審最重之扣分:
//   單一來源、軼事被標「高」而與自身銳評矛盾)。〈建議w-knowledge-extract優化〉§2.4、§4.1-4.2(2026-09-29)。
// 【規則(2026-09-29 雙審定案,tmp/wke-distill-b-全盤.md §11.1 A25)】
//   ①每篇出處之有效等級＝min(該筆記證據等級, 其內容類型之封頂);未評估／未標注排在最低之下
//   ②主張＝出處有效等級之最高者;但最高級須至少 2 份相異文件(docId)同達,否則封頂為次高級(levels[1])——「單一來源封頂」之精確化,
//     依預設等級定義推得(高＝獨立驗證、重複驗證;中＝僅單一研究),偶數級亦有定義;以文件計而非筆記計:同一研究以不同網址入庫
//     (摘要頁與正式版、轉載)會成為兩篇筆記,不構成獨立驗證(第二輪判識 A §2-10)
//   ③有爭議(contested)封頂為次高級(GRADE 之不一致;不再降一級,免把中級主張降成「有一說」)
//   ④爭議各方取所引主張之最高等級,無所引主張才以出處計;參數取所依主張,無則以出處計
//   ⑤無出處(僅舊版內容)＝未評估
// 【等級名稱與封頂表屬詞彙】由 vocab.evidenceLevels／vocab.evidenceCaps 給,換詞彙即換表;本檔不認識任何等級名。
//   封頂值可為等級名或位置(整數:0＝最高、1＝次高、-1＝最低)——預設表以位置表達,安裝方把等級改名時封頂不會被靜默移除(判識 B Q9)。
// 【主張本身之兩道封頂(2026-09-29 待決事項 D3c／D3d;安裝方驗收條件 §3 #3)】只壓低、不抬高,與出處無關之獨立防線:
//   ⑥證據性質(basis)封頂:basisCaps { 關鍵詞: 位置 }——basis 含該詞即取其封頂,多詞取最嚴,皆不含取「*」;
//     「只有樣本外實證可達最高」由預設表之「*」＝次高表達(建議書:117)
//   ⑦自承限制封頂:critique／conditions／basis 含 selfLimit 片語(如「單一研究」「未經獨立驗證」)→ 封頂次高——模型逐條標出處時
//     會錯掛(安裝方 09-29 A/B:「出處系統性錯掛 → 灌水為樣本外」),只依出處算等級擋不住;不判否定句(誤判只往保守方向,安裝方接受)

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'

/** 未評估之標記(出處無有效等級、或僅舊版內容) */
export const UNASSESSED = '未評估'

const TERMINAL = new Set(['superseded', 'retracted'])


/**
 * 建立證據判定器
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}
 * @param {Array} [opt.levels=['高','中','低']] 輸入證據等級名稱(由高到低)
 * @param {Object} [opt.caps={}] 輸入內容類型封頂表 { 內容類型: 等級名｜位置整數(-1＝最低) }，無法對應 levels 者忽略
 * @param {Object} [opt.basisCaps={}] 輸入證據性質封頂表 { basis 關鍵詞: 等級名｜位置整數，'*': 皆不含時 }，空表＝不封頂
 * @param {Array} [opt.selfLimit=[]] 輸入自承限制片語陣列(critique／conditions／basis 含之即封頂次高)，空陣列＝不封頂
 * @returns {Object} 回傳 { levels, rankOf(level), capRank(claimType), noteRank(note), basisRank(basis), selfLimitOf(claim), claimEvidence(sources, notesById, contested), apply(state, notesById) }
 * @example
 * const ev = makeEvidence({ levels: ['高', '中', '低'] })
 * const notes = new Map([['a', { evidenceLevel: '高' }], ['b', { evidenceLevel: '高' }]])
 * console.log(ev.claimEvidence(['a'], notes).level, ev.claimEvidence(['a', 'b'], notes).level)
 * // => 中 高
 */
export function makeEvidence(opt = {}) {
    if (!isobj(opt)) opt = {}
    const levels = isarr(opt.levels) && opt.levels.length ? opt.levels.map(String) : ['高', '中', '低']
    const caps = isobj(opt.caps) ? opt.caps : {}
    const basisCaps = isobj(opt.basisCaps) ? opt.basisCaps : {}
    const selfLimit = (isarr(opt.selfLimit) ? opt.selfLimit : []).map((x) => String(x || '').trim()).filter(Boolean)
    const LOW = levels.length // 未評估:排在最低之下
    const rankOf = (lv) => {
        const i = levels.indexOf(String(lv ?? ''))
        return i < 0 ? LOW : i
    }
    const nameOf = (r) => (r < levels.length ? levels[r] : UNASSESSED)
    // 封頂值(等級名或位置整數)→ 等級序;無法對應者回 null
    const rankOfCap = (v) => {
        if (Number.isInteger(v)) {
            const i = v >= 0 ? v : levels.length + v
            return i >= 0 && i < levels.length ? i : null
        }
        return typeof v === 'string' && levels.includes(v) ? rankOf(v) : null
    }

    /**
     * 內容類型之封頂等級序;無封頂或無法對應者回 null
     *
     * @param {String} claimType 輸入內容類型
     * @returns {Integer|null} 回傳等級序或 null
     */
    const capRank = (claimType) => rankOfCap(caps[claimType])

    /**
     * 證據性質之封頂:basis 所含之關鍵詞取最嚴者,皆不含取「*」;無表回 null
     *
     * @param {String} basis 輸入證據性質文字
     * @returns {Object|null} 回傳 { rank, key } 或 null
     */
    const basisRank = (basis) => {
        const b = String(basis || '')
        let hit = null
        for (const [k, v] of Object.entries(basisCaps)) {
            if (k === '*' || !b.includes(k)) continue
            const r = rankOfCap(v)
            if (r !== null && (hit === null || r > hit.rank)) hit = { rank: r, key: k }
        }
        if (hit) return hit
        const r = rankOfCap(basisCaps['*'])
        return r === null ? null : { rank: r, key: b ? '其他' : '未寫' }
    }

    /**
     * 主張之自承限制片語(critique、conditions、basis 中第一個命中者)
     *
     * @param {Object} c 輸入主張
     * @returns {String} 回傳命中之片語，無則空字串
     */
    const selfLimitOf = (c) => {
        const text = [c?.critique, ...(isarr(c?.conditions) ? c.conditions : [c?.conditions]), c?.basis].filter((x) => typeof x === 'string').join('\n')
        return selfLimit.find((p) => text.includes(p)) || ''
    }

    /**
     * 單篇出處之有效等級序(0＝最高);內容類型封頂取較低者
     *
     * @param {Object} note 輸入筆記記錄(取 evidenceLevel、claimType)，缺者視為未評估
     * @returns {Integer} 回傳等級序
     */
    const noteRank = (note) => {
        let r = rankOf(note?.evidenceLevel)
        const cap = capRank(note?.claimType)
        if (cap !== null) r = Math.max(r, cap)
        return r
    }

    /**
     * 依出處計算等級(規則②③⑤)
     *
     * @param {Array} sources 輸入出處筆記 id 陣列
     * @param {Map} notesById 輸入筆記 id → 記錄
     * @param {Boolean} [contested=false] 輸入是否有爭議
     * @returns {Object} 回傳 { level, trace }
     */
    const claimEvidence = (sources, notesById, contested = false) => {
        const ids = isarr(sources) ? sources : []
        if (!ids.length) return { level: UNASSESSED, trace: '無出處' }
        const ranks = ids.map((id) => noteRank(notesById?.get?.(id)))
        let best = Math.min(...ranks)
        const tally = {}
        for (const r of ranks) tally[nameOf(r)] = (tally[nameOf(r)] || 0) + 1
        const notes = [`出處 ${ids.length} 篇：${Object.entries(tally).map(([k, n]) => `${k}×${n}`).join('、')}`]
        const topDocs = new Set(ids.filter((id, k) => ranks[k] === 0).map((id) => notesById?.get?.(id)?.docId || id))
        if (levels.length > 1 && best === 0 && topDocs.size < 2) {
            best = 1
            notes.push(`${levels[0]}級僅 1 份文件 → 封頂${levels[1]}`)
        }
        if (levels.length > 1 && contested && best < 1) {
            best = 1
            notes.push(`有爭議 → 封頂${levels[1]}`)
        }
        return { level: nameOf(best), trace: notes.join('；') }
    }

    /**
     * 對整份狀態重算證據等級(主張 → 參數 → 爭議各方;終態項保留原值);就地修改
     *
     * @param {Object} state 輸入狀態(就地修改)
     * @param {Map} notesById 輸入筆記 id → 記錄
     * @returns {Object} 回傳同一狀態
     */
    const apply = (state, notesById) => {
        for (const c of state?.claims || []) {
            if (TERMINAL.has(c.status)) continue
            const e = claimEvidence(c.sources, notesById, c.status === 'contested')
            let r = rankOf(e.level)
            const trace = [e.trace]
            if (r < LOW) {
                const b = basisRank(c.basis)
                if (b && b.rank > r) {
                    r = b.rank
                    trace.push(`性質「${b.key}」→ 封頂${nameOf(r)}`)
                }
                const lim = levels.length > 1 ? selfLimitOf(c) : ''
                if (lim && r < 1) {
                    r = 1
                    trace.push(`自承限制「${lim}」→ 封頂${nameOf(r)}`)
                }
            }
            c.evidence = { level: nameOf(r), basis: c.basis || '', trace: trace.join('；') }
        }
        const claimOf = new Map((state?.claims || []).map((c) => [c.id, c]))
        for (const p of state?.parameters || []) {
            if (TERMINAL.has(p.status)) continue
            const c = claimOf.get(p.claim)
            p.evidence = c ? { level: c.evidence?.level || UNASSESSED, basis: '', trace: `依〔${c.id}〕` } : { ...claimEvidence(p.sources, notesById), basis: '' }
        }
        for (const d of state?.disputes || []) {
            for (const sd of d.sides || []) {
                const cited = (sd.claims || []).map((id) => claimOf.get(id)).filter(Boolean)
                if (cited.length) {
                    const r = Math.min(...cited.map((c) => rankOf(c.evidence?.level)))
                    sd.evidence = { level: nameOf(r), trace: `依〔${cited.map((c) => c.id).join('〕〔')}〕` }
                }
                else sd.evidence = claimEvidence(sd.sources, notesById)
            }
        }
        return state
    }

    return { levels, rankOf, capRank, noteRank, basisRank, selfLimitOf, claimEvidence, apply }
}


export default makeEvidence
