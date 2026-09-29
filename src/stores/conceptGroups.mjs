// conceptGroups.mjs — 概念分群與提煉選題的泛用機制
//
// 【以概念而非類別分群】類別太粗、提煉出來只會是泛論；概念是萃取時標好的細粒度標籤，
//   同概念的筆記彼此可對照可互補。分群鍵一律走 normalizeConcept——
//   標籤只要對不起來，提煉就永遠選不出東西。
//
// 【待提煉(pending)＝主標籤筆記 − 該核心已用過者（2.0）】1.x 以「全概念筆記數 − 上次筆記數」為增量、每次只取最新 8 篇：
//   兩次更新間新進 >8 篇時較舊者永不再被選，樞紐概念覆蓋上界 ≤29%；且每篇掛 4～5 個概念，以該概念為第一標籤者僅 7～52%，
//   「最新 8 篇」多為順帶掛標之離題筆記（安裝方〈建議w-knowledge-extract優化〉§1.3、§1.4）。2.0 起：已用過＝該核心之累積出處
//   （cores.noteIds 為狀態 consumed 之鏡像）；pending 與新核心門檻只計主標籤（第一個標籤）；次標籤筆記只在補位時入選。
//   升版前之核心（記錄無 stateFormat 2）其 noteIds 只是 1.x 末批、知識只在封存區（不轉主張）：已用過視為 ∅，與遷移後狀態之 consumed 一致。
// 【score＝min(pending, 追趕批數×每批) × 等待天數】上限化 pending：遷移後樞紐概念 pending 上千，不上限化會壟斷名額、小核心飢餓；
//   乘等待天數使久候者分數升高、剛提煉者歸零（2026-09-06 生產實測 275 個合格概念中 194 個從未提煉之教訓）。
// 【既有核心須滿一批才入選,否則須「≥ minPending 且等待 ≥ maxWaitDays」】第二輪判識 B 以規劃原案之規則模擬(Zipf 分布、549 核心):
//   久候之小核心以部分批(1～5 篇)贏過大核心,實際消化只有名目容量之 1/3(11.5～15.7 篇／輪、滿批 6～21%),加名額亦無效,
//   積壓與樞紐概念皆無界成長;滿批門檻＋同核心連續多批(追趕,見 distillStage)後收斂(2026-09-29)。
// 【等待錨點＝上次提案(proposedAt)】整併不消耗筆記,不可重置提案之等待(否則該概念之 pending 晚一整個輪換週期)。
// 【失敗即回隊尾】等待天數自 max(上次成功, 上次嘗試) 起算：此前失敗之概念 updatedAt 不前進、分數只增不減，
//   每輪都佔一個名額（雙審 exp 實測第 31～35 天 210→250 每天被選中）——違「例外仍落帳、隊頭防阻塞」之原則。
// 【身分含 scope】類別層與概念層同名時（如「方法與技術」）此前共用同一核心綁定（不比 scope），兩層互相覆寫；
//   coreForKey 以 (scope, 鍵) 綁定，同鍵多核心（分身）以固定規則選唯一主核心（選題、regenCore、巡檢共用）。
// 【未關聯者延後】衝突章由關聯段寫入；先提煉即永久錯過爭議材料，故 relatedAt 空者延後，逾寬限天數放行（免被關聯積壓卡死）。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import { normalizeConcept } from '../util/text.mjs'

const DAY = 86400_000

/**
 * 既有概念詞彙表（依使用篇數降冪），餵回萃取 prompt 令標籤收斂成共用詞彙
 *
 * 【預設只回名稱（2.0）】1.x 回「名稱(篇數)」並原樣餵回萃取 prompt，模型把「(743)」照抄進標籤，
 *   產生「市場微結構(743)」這類分身概念（安裝方 2026-09-29 回報 43 組疑似重複）；篇數之訊號改由排序表達。
 *
 * @param {Object} notes 輸入筆記集合，需具 select 方法
 * @param {Integer} [limit=60] 輸入回傳最多幾條，非正整數則用預設 60
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}
 * @param {Boolean} [opt.counts=false] 輸入是否附使用篇數(維運顯示用；勿餵回 prompt)
 * @returns {Promise} 回傳 Promise，resolve 回傳字串陣列(依使用篇數降冪)，格式為 '<顯示寫法>'；opt.counts 為 true 時為 '<顯示寫法>(<使用篇數>)'
 * @throws {Error} notes 缺 select 方法時拋出
 */
export async function conceptVocabulary(notes, limit = 60, opt = {}) {

    //check
    if (!isfun(notes?.select)) {
        throw new Error('conceptVocabulary 需要 notes 集合（具 select 方法）')
    }
    if (!ispint(limit)) {
        limit = 60
    }
    limit = cint(limit)
    if (!isobj(opt)) {
        opt = {}
    }

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
        .map(([k, v]) => (opt.counts === true ? `${displayOf(k)}(${v})` : displayOf(k)))
}

/**
 * 核心身分綁定:在 (scope, 正規化鍵) 相同之核心中選唯一主核心——排除已併入他核心者(status 'merged');
 * 依 version 降冪 → noteCount 降冪 → updatedAt 降冪 → id 升冪(任何陣列順序皆得同一結果)
 *
 * @param {Array} cores 輸入核心記錄陣列，非陣列視為空
 * @param {String} scope 輸入 'concept'｜'category'(記錄缺 scope 者視為 'concept')
 * @param {String} key 輸入正規化鍵(normalizeConcept 之產出)
 * @returns {Object|null} 回傳主核心記錄，無則 null
 * @example
 * const cores = [{ id: 'a', concept: '甲', version: 1 }, { id: 'b', concept: '甲', version: 5 }]
 * console.log(coreForKey(cores, 'concept', '甲').id)
 * // => b
 */
export function coreForKey(cores, scope, key) {
    const list = (isarr(cores) ? cores : []).filter((c) => c && c.status !== 'merged' && (c.scope || 'concept') === scope && normalizeConcept(c.concept) === key)
    if (!list.length) return null
    list.sort((a, b) => (b.version || 0) - (a.version || 0) ||
        (b.noteCount || 0) - (a.noteCount || 0) ||
        String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) ||
        String(a.id || '').localeCompare(String(b.id || '')))
    return list[0]
}

/**
 * 同 (scope, 鍵) 之其他核心(分身:非主核心且未標 merged)
 *
 * @param {Array} cores 輸入核心記錄陣列
 * @param {Object} primary 輸入主核心記錄(coreForKey 之產出)
 * @returns {Array} 回傳分身核心記錄陣列
 */
export function twinsOf(cores, primary) {
    if (!primary) return []
    const key = normalizeConcept(primary.concept)
    const scope = primary.scope || 'concept'
    return (isarr(cores) ? cores : []).filter((c) => c && c !== primary && c.id !== primary.id && c.status !== 'merged' && (c.scope || 'concept') === scope && normalizeConcept(c.concept) === key)
}

/**
 * 筆記是否已可提煉:已關聯,或建立逾寬限天數(關聯積壓時不永久卡住)
 *
 * @param {Object} note 輸入筆記記錄(取 relatedAt、createdAt)
 * @param {Number} nowMs 輸入現在時刻毫秒數
 * @param {Number} [graceDays=3] 輸入寬限天數，非有限數視為 3
 * @returns {Boolean} 回傳是否可提煉
 */
export function isReady(note, nowMs, graceDays = 3) {
    if (note?.relatedAt) return true
    const g = Number.isFinite(graceDays) ? graceDays : 3
    const t = Date.parse(note?.createdAt || '')
    return Number.isFinite(t) && nowMs - t >= g * DAY
}

/**
 * 依概念分群:每篇筆記之第一個有效標籤為主標籤、其餘為次標籤(同一篇折疊成同一鍵之多個標籤只入群一次)
 *
 * @param {Array} notes 輸入筆記陣列，非陣列視為空
 * @returns {Map} 回傳 鍵 → { display, primary:Array, secondary:Array }
 */
export function groupByConcept(notes) {
    const groups = new Map()
    for (const n of isarr(notes) ? notes : []) {
        const seen = new Set()
        let first = true
        for (const c of n?.concepts || []) {
            const key = normalizeConcept(c)
            if (!key || seen.has(key)) continue
            seen.add(key)
            if (!groups.has(key)) groups.set(key, { forms: new Map(), primary: [], secondary: [] })
            const g = groups.get(key)
            const f = String(c).trim()
            g.forms.set(f, (g.forms.get(f) || 0) + 1)
            if (first) g.primary.push(n)
            else g.secondary.push(n)
            first = false
        }
    }
    // display 取最常見寫法（理由同 conceptVocabulary）：它會成為核心檔的概念名
    for (const g of groups.values()) g.display = [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return groups
}

/**
 * 內部:由一組候選(主／次)、已用集合與失敗帳算出選題項
 *
 * @param {Object} o 輸入 { key, scope, display, primary, secondary, core, attempt, cfg, nowMs }
 * @returns {Object|null} 回傳選題項，不合格回 null
 */
function targetOf(o) {
    const { key, scope, display, primary, secondary, core, attempt, cfg, nowMs } = o
    const consumed = new Set(core?.stateFormat >= 2 && isarr(core.noteIds) ? core.noteIds : [])
    const fresh = (n) => !consumed.has(n.id) && isReady(n, nowMs, cfg.graceDays)
    const pending = primary.filter(fresh)
    const fillers = secondary.filter(fresh)
    const lastOk = Date.parse(core?.proposedAt || core?.updatedAt || '')
    const lastTry = Date.parse(attempt?.lastTriedAt || '')
    let since
    if (core) since = Math.max(Number.isFinite(lastOk) ? lastOk : 0, Number.isFinite(lastTry) ? lastTry : 0)
    else {
        const oldest = Math.min(...pending.map((n) => Date.parse(n.createdAt || '')).filter(Number.isFinite), nowMs)
        since = Math.max(oldest, Number.isFinite(lastTry) ? lastTry : 0)
    }
    const ageDays = Math.max(0, (nowMs - (since || nowMs)) / DAY)
    if (core) {
        if (pending.length === 0) return null
        const full = pending.length >= cfg.batch
        if (!full && !(pending.length >= cfg.minPending && ageDays >= cfg.maxWaitDays)) return null
    }
    else if (pending.length < cfg.minNotes) return null
    const score = Math.min(pending.length, cfg.batch * cfg.catchup) * ageDays
    return {
        key,
        scope,
        concept: core?.concept || display,
        core: core || null,
        pending,
        candidates: [...pending.map((note) => ({ note, primary: true })), ...fillers.map((note) => ({ note, primary: false }))],
        gain: pending.length,
        ageDays,
        score,
        tries: attempt?.tries || 0,
    }
}

/**
 * 內部:選題設定正規化
 *
 * @param {Object} opt 輸入選題設定
 * @returns {Object} 回傳 { minNotes, minPending, maxWaitDays, batch, catchup, graceDays, attempts, nowMs }
 */
function cfgOf(opt) {
    const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d)
    return {
        minNotes: num(opt.minNotes, 0),
        minPending: num(opt.minPending, 4),
        maxWaitDays: num(opt.maxWaitDays, 30),
        batch: Number.isFinite(opt.notesPerTarget) && opt.notesPerTarget > 0 ? opt.notesPerTarget : 12,
        catchup: Number.isInteger(opt.catchup) && opt.catchup > 0 ? opt.catchup : 1,
        graceDays: num(opt.graceDays, 3),
        attempts: isobj(opt.attempts) ? opt.attempts : {},
        nowMs: Number.isFinite(opt.now) ? opt.now : Date.now(),
    }
}

/**
 * 概念層選題:新核心之主標籤可提煉筆記 ≥ minNotes;既有核心之 pending ≥ 每批,或(pending ≥ minPending 且等待 ≥ maxWaitDays);
 * 依 score＝min(pending, 追趕批數×每批)×等待天數 降冪(同分依 pending、再依鍵)。規則見檔頭。
 *
 * @param {Array} notes 輸入已由呼叫端取出之筆記陣列，非陣列則視為空陣列
 * @param {Array} cores 輸入已由呼叫端取出之核心記錄陣列(stateFormat 2 者之 noteIds 為累積已用，升版前者視為 ∅；等待錨點 proposedAt，缺則 updatedAt)，非陣列則視為空陣列
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Number} [opt.minNotes=0] 輸入新核心門檻(主標籤可提煉篇數)
 * @param {Number} [opt.minPending=4] 輸入既有核心未滿一批時之入選下限(須同時等待 ≥ maxWaitDays)
 * @param {Number} [opt.maxWaitDays=30] 輸入未滿一批者須等待之天數
 * @param {Number} [opt.notesPerTarget=12] 輸入每批篇數(滿批門檻與 score 之上限化)
 * @param {Integer} [opt.catchup=1] 輸入同核心同輪至多幾批(score 上限＝追趕批數×每批)
 * @param {Number} [opt.graceDays=3] 輸入未關聯筆記之寬限天數
 * @param {Object} [opt.attempts={}] 輸入失敗帳 { 'concept|鍵': { tries, lastTriedAt } }
 * @param {Number} [opt.now] 輸入現在時刻毫秒數(測試注入用)，非有限數則用 Date.now()
 * @returns {Array} 回傳選題陣列(依 score 降冪)，每項 { key, scope:'concept', concept, core, pending, candidates:[{note,primary}], gain, ageDays, score, tries }
 * @example
 * let notes = Array.from({ length: 2 }, (_, i) => ({ id: `n${i}`, concepts: ['甲'], createdAt: '2026-09-01T00:00:00Z', relatedAt: 'x' }))
 * let out = pickConcepts(notes, [], { minNotes: 2, now: Date.parse('2026-09-10T00:00:00Z') })
 * console.log(out.map((o) => [o.concept, o.pending.length]))
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

    const cfg = cfgOf(opt)
    const out = []
    for (const [key, g] of groupByConcept(notes)) {
        const core = coreForKey(cores, 'concept', key)
        const t = targetOf({ key, scope: 'concept', display: g.display, primary: g.primary, secondary: g.secondary, core, attempt: cfg.attempts[`concept|${key}`], cfg, nowMs: cfg.nowMs })
        if (t) out.push(t)
    }
    out.sort((a, b) => b.score - a.score || b.pending.length - a.pending.length || a.key.localeCompare(b.key))
    return out
}

/**
 * 孤兒筆記(類別後備之唯一候選):主概念(第一個有效標籤)無概念核心、該主概念之主標籤可提煉篇數未達新核心門檻、
 * 且建立已逾久候天數者;無任何有效概念標籤者亦算。
 *
 * 【為何只收孤兒、且須久候】類別後備本意是「概念詞彙尚未收斂時」之保底(寧少勿泛);候選若是整個類別,概念層只是本輪
 *   暫無滿批之閒置輪,就會把早已提煉進概念核心之筆記再吃一遍(模擬:安裝方量級閒置輪 5～8%、小庫約半數;每輪至多數十篇
 *   已提煉之筆記);未久候之孤兒日後多半晉級為概念核心而被兩層各吃一次(2026-09-29 三獨立判識,A 之 B1sf)。
 *
 * @param {Array} notes 輸入筆記陣列，非陣列視為空
 * @param {Array} cores 輸入核心記錄陣列，非陣列視為空
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Number} [opt.minNotes=6] 輸入新概念核心之門檻(主標籤可提煉篇數；未達者之筆記才算孤兒)
 * @param {Number} [opt.maxWaitDays=30] 輸入久候天數(建立逾此天數之孤兒才入選)
 * @param {Number} [opt.graceDays=3] 輸入未關聯筆記之寬限天數
 * @param {Number} [opt.now] 輸入現在時刻毫秒數
 * @returns {Array} 回傳孤兒筆記陣列(保持輸入順序)
 * @example
 * let old = '2026-01-01T00:00:00Z'
 * let notes = [{ id: 'a', concepts: ['甲'], createdAt: old, relatedAt: old }, { id: 'b', concepts: [], createdAt: old, relatedAt: old }]
 * console.log(orphanNotes(notes, [], { minNotes: 6, now: Date.parse('2026-09-01T00:00:00Z') }).map((n) => n.id))
 * // => [ 'a', 'b' ]
 */
export function orphanNotes(notes, cores, opt = {}) {
    if (!isarr(notes)) notes = []
    if (!isobj(opt)) opt = {}
    const cfg = { ...cfgOf(opt), minNotes: Number.isFinite(opt.minNotes) ? opt.minNotes : 6 }
    const withCore = new Set((isarr(cores) ? cores : []).filter((c) => c && c.status !== 'merged' && (c.scope || 'concept') === 'concept').map((c) => normalizeConcept(c.concept)))
    const groups = groupByConcept(notes)
    const readyCount = new Map()
    const out = []
    for (const n of notes) {
        if (!isReady(n, cfg.nowMs, cfg.graceDays)) continue
        const t = Date.parse(n?.createdAt || '')
        if (!Number.isFinite(t) || cfg.nowMs - t < cfg.maxWaitDays * DAY) continue
        const key = (n?.concepts || []).map((c) => normalizeConcept(c)).find(Boolean) || ''
        if (key) {
            if (withCore.has(key)) continue
            if (!readyCount.has(key)) readyCount.set(key, (groups.get(key)?.primary || []).filter((x) => isReady(x, cfg.nowMs, cfg.graceDays)).length)
            if (readyCount.get(key) >= cfg.minNotes) continue
        }
        out.push(n)
    }
    return out
}

/**
 * 後備：類別層選題（預設停用，由呼叫端以孤兒筆記呼叫；見 orphanNotes）。類別層較粗，寧可少做也不要產出泛論；類別層之筆記一律視為主標籤。
 * 新類別核心：可提煉 ≥ minNotes；既有類別核心之入選與概念層對稱：滿一批（notesPerTarget），或（≥ minGain 且等待 ≥ maxWaitDays）——
 * 此前以 minGain 4 當滿批，1 天前才提煉之類別核心加 4 篇即入選（概念層之部分批教訓未套到類別層；2026-09-29 三獨立判識）。
 *
 * @param {Array} notes 輸入筆記陣列(類別後備時為孤兒筆記)，非陣列則視為空陣列
 * @param {Array} cores 輸入已由呼叫端取出之核心記錄陣列，非陣列則視為空陣列
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Integer} [opt.minNotes=6] 輸入新類別核心之可提煉篇數門檻
 * @param {Integer} [opt.minGain=4] 輸入既有類別核心未滿一批時之入選下限(須同時等待 ≥ maxWaitDays)
 * @param {Number} [opt.notesPerTarget=12] 輸入每批篇數(既有類別核心之滿批門檻)
 * @param {Number} [opt.maxWaitDays=30] 輸入未滿一批者須等待之天數
 * @param {Number} [opt.graceDays=3] 輸入未關聯筆記之寬限天數
 * @param {Object} [opt.attempts={}] 輸入失敗帳 { 'category|鍵': { tries, lastTriedAt } }
 * @param {Number} [opt.now] 輸入現在時刻毫秒數
 * @returns {Array} 回傳選題陣列，依 pending 降冪，每項同 pickConcepts 之形狀(scope:'category')
 * @example
 * let notes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, category: '其他', relatedAt: 'x' }))
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

    const minNotes = Number.isFinite(opt.minNotes) ? opt.minNotes : 6
    const minGain = Number.isFinite(opt.minGain) ? opt.minGain : 4
    const cfg = { ...cfgOf(opt), minNotes, minPending: minGain, catchup: 1 }
    const byCat = new Map()
    for (const n of notes) {
        const cat = n?.category || '其他'
        if (!byCat.has(cat)) byCat.set(cat, [])
        byCat.get(cat).push(n)
    }
    const out = []
    for (const [cat, list] of byCat) {
        const key = normalizeConcept(cat)
        const core = coreForKey(cores, 'category', key)
        const t = targetOf({ key, scope: 'category', display: cat, primary: list, secondary: [], core, attempt: cfg.attempts[`category|${key}`], cfg, nowMs: cfg.nowMs })
        if (t) out.push({ ...t, concept: cat })
    }
    out.sort((a, b) => b.pending.length - a.pending.length || a.key.localeCompare(b.key))
    return out
}

/**
 * 概念標籤之清理建議(維運用;不自動改任何資料):供安裝方審閱後貼入 vocab.conceptRenames／conceptAliases
 *
 * 【為何不自動】「名稱(743)」之數字與年份、階數不可辨(金融危機(2008)、AR(1)／AR(2)、I(0)／I(1)),自動去尾會誤併;
 *   折疊(tw→cn)之同鍵裡亦有繁體語意不同者(曆年／歷年、回復率／回覆率)。根因(詞彙表附篇數被照抄)已於 2.0 消除,
 *   這裡只處理既有資料(2026-09-29 雙審定案 Q6)。輸出原字形(改名以折疊前之原字形精確比對)。
 *
 * 另列兩類只供人審之候選(1.0.5;安裝方 1.0.4 回報 ④、三獨立審定案 T2′):
 *   annotated——「名稱(說明)」之括號說明、英文對照或「是否在清單中」之註記(分群鍵保留括號內容,與「名稱」分成兩鍵);
 *     括號內只有數字／分隔符者(AR(1)、GARCH(1,1)、I(0)、(2008)、(743))不列;限定語(如「動量(時間序列)」)可能是不同概念,故不併入 renames;
 *   multi——括號外以「,」「，」「、」「;」「；」串接多個概念之單一標籤;改名對照只能一對一,拆分屬使用方之資料整理。
 *
 * @param {Array} notes 輸入筆記陣列，非陣列視為空
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Integer} [opt.minSuffix=10] 輸入「名稱(N)」之 N 至少多少才列入(篇數照抄多為兩位數以上)
 * @returns {Object} 回傳 { renames:{ 原寫法: 基名 }, renameDetail:Array({ form, base, notes, yearLike }), foldGroups:Array({ key, forms:Array({ form, notes }) }),
 *   annotated:Array({ form, base, inner, notes, baseUsed }), multi:Array({ form, parts, notes }) }；yearLike＝N 看似年份(1000～2100,如「金融危機(2008)」,多為誤報)
 * @example
 * const notes = [{ concepts: ['市場微結構'] }, { concepts: ['市場微結構(743)'] }, { concepts: ['AR(1)'] }]
 * console.log(suggestConceptRenames(notes).renames)
 * // => { '市場微結構(743)': '市場微結構' }
 */
export function suggestConceptRenames(notes, opt = {}) {
    if (!isarr(notes)) notes = []
    if (!isobj(opt)) opt = {}
    const minSuffix = Number.isInteger(opt.minSuffix) ? opt.minSuffix : 10
    const byKey = new Map() // key → Map(原字形 → 篇數)
    for (const n of notes) {
        const seen = new Set()
        for (const c of n?.concepts || []) {
            const form = String(c).trim()
            const key = normalizeConcept(form)
            if (!key || seen.has(`${key}|${form}`)) continue
            seen.add(`${key}|${form}`)
            if (!byKey.has(key)) byKey.set(key, new Map())
            byKey.get(key).set(form, (byKey.get(key).get(form) || 0) + 1)
        }
    }
    const renames = {}
    const renameDetail = []
    for (const forms of byKey.values()) {
        for (const [form, cnt] of forms) {
            const m = form.normalize('NFKC').match(/^(.+?)\s*\((\d+)\)$/)
            if (!m || Number(m[2]) < minSuffix) continue
            const baseForms = byKey.get(normalizeConcept(m[1]))
            if (!baseForms) continue
            const base = [...baseForms.entries()].sort((a, b) => b[1] - a[1])[0][0]
            renames[form] = base
            const n = Number(m[2])
            renameDetail.push({ form, base, notes: cnt, yearLike: n >= 1000 && n <= 2100 })
        }
    }
    const foldGroups = [...byKey.entries()]
        .filter(([, forms]) => new Set([...forms.keys()].map((f) => f.normalize('NFKC').replace(/\s+/g, '').toLowerCase())).size > 1)
        .map(([key, forms]) => ({ key, forms: [...forms.entries()].map(([form, n]) => ({ form, notes: n })).sort((a, b) => b.notes - a.notes) }))
        .sort((a, b) => b.forms.reduce((s, x) => s + x.notes, 0) - a.forms.reduce((s, x) => s + x.notes, 0))
    const annotated = []
    const multi = []
    for (const forms of byKey.values()) {
        for (const [form, cnt] of forms) {
            const a = annotationOf(form)
            if (a) annotated.push({ form, base: a.base, inner: a.inner, notes: cnt, baseUsed: byKey.has(normalizeConcept(a.base)) })
            const parts = splitTopLevel(form.normalize('NFKC'))
            if (parts.length >= 2) multi.push({ form, parts, notes: cnt })
        }
    }
    annotated.sort((a, b) => Number(b.baseUsed) - Number(a.baseUsed) || b.notes - a.notes || a.form.localeCompare(b.form))
    multi.sort((a, b) => b.notes - a.notes || a.form.localeCompare(b.form))
    return { renames, renameDetail, foldGroups, annotated, multi }
}

/**
 * 標籤之末尾括號說明:「名稱(說明)」且括號內不是只有數字／分隔符(排除 AR(1)、GARCH(1,1)、I(0)、(2008)、(743))
 *
 * @param {String} tag 輸入標籤原字形
 * @returns {Object|null} 回傳 { base, inner } 或 null
 */
function annotationOf(tag) {
    const m = String(tag || '').normalize('NFKC').trim().match(/^(.+?)\s*\(([^()]+)\)$/)
    if (!m || /^[\p{N}\s,.\-+:/·]+$/u.test(m[2])) return null
    return { base: m[1].trim(), inner: m[2].trim() }
}

/**
 * 可疑之概念標籤(括號說明／英文對照,或一個標籤擠多個概念;萃取段只計數、不改資料——判準同 suggestConceptRenames 之 annotated／multi)
 *
 * @param {Array} tags 輸入標籤陣列，非陣列視為空
 * @returns {Array} 回傳 [{ tag, kind:'annotated'|'multi' }]
 * @example
 * console.log(tagSuspects(['GARCH(1,1)', '價格發現(未載入)', '甲, 乙', 'AR(1)']).map((x) => x.kind))
 * // => [ 'annotated', 'multi' ]
 */
export function tagSuspects(tags) {
    const out = []
    for (const t of isarr(tags) ? tags : []) {
        if (annotationOf(t)) out.push({ tag: t, kind: 'annotated' })
        else if (splitTopLevel(String(t || '').normalize('NFKC')).length >= 2) out.push({ tag: t, kind: 'multi' })
    }
    return out
}

/**
 * 以括號外之「,」「、」「;」切分(括號／引號內不切,如 GARCH(1,1));NFKC 後全形之「，」「；」已轉為半形
 *
 * @param {String} s 輸入字串
 * @returns {Array} 回傳非空片段陣列(去頭尾空白)
 */
function splitTopLevel(s) {
    const OPEN = '([「『【'
    const CLOSE = ')]」』】'
    const parts = []
    let depth = 0
    let cur = ''
    for (const ch of String(s || '')) {
        if (OPEN.includes(ch)) depth++
        else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1)
        if (depth === 0 && /[,、;]/.test(ch)) {
            parts.push(cur)
            cur = ''
            continue
        }
        cur += ch
    }
    parts.push(cur)
    return parts.map((x) => x.trim()).filter(Boolean)
}

export default { conceptVocabulary, coreForKey, twinsOf, isReady, groupByConcept, pickConcepts, orphanNotes, pickCategories, suggestConceptRenames, tagSuspects }
