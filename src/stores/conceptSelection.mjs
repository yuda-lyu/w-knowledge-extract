// conceptSelection.mjs — 概念分群與提煉選題的泛用機制
//
// 【以概念而非類別分群】類別太粗、提煉出來只會是泛論；概念是摘要時標好的細粒度標籤，
//   同概念的筆記彼此可對照可互補。分群鍵一律走 normalizeConcept——
//   標籤只要對不起來，提煉就永遠選不出東西。
//
// 【待提煉(pending)＝主標籤筆記 − 該核心已用過者】已用過＝該核心之累積出處（cores.noteIds 為狀態 consumed 之鏡像）；
//   pending 與新核心門檻只計主標籤（第一個標籤）；次標籤筆記只在補位時入選。
//   不以「全概念筆記數 − 上次筆記數」取最新 N 篇:兩次更新間新進 >N 篇時較舊者永不再被選;且每篇掛多個概念,
//   以該概念為第一標籤者常只占少數,「最新 N 篇」多為順帶掛標之離題筆記。
// 【score＝min(pending, 追趕批數×每批) × 等待天數】上限化 pending：樞紐概念 pending 可達上千，不上限化會壟斷名額、小核心飢餓；
//   乘等待天數使久候者分數升高、剛提煉者歸零（否則多數合格概念從未被提煉）。
// 【既有核心須滿一批才入選,否則須「≥ minPending 且等待 ≥ maxWaitDays」】否則久候之小核心以部分批(1～5 篇)贏過大核心,
//   實際消化只有名目容量之一小部分,加名額亦無效,積壓與樞紐概念皆無界成長;滿批門檻＋同核心連續多批(追趕,見 stages/extractSteps)後收斂。
// 【等待錨點＝上次提煉批次(proposedAt)】整併不消耗筆記,不可重置提煉之等待(否則該概念之 pending 晚一整個輪換週期)。
// 【失敗即回隊尾】等待天數自 max(上次成功, 上次嘗試) 起算：只以成功時刻起算,失敗之概念分數只增不減,
//   每輪都佔一個名額——違「例外仍落帳、隊頭防阻塞」之原則。
// 【身分含 scope】類別層與概念層同名時（如「方法與技術」）須分開綁定，否則兩層互相覆寫；
//   coreForKey 以 (scope, 鍵) 綁定，同鍵多核心（分身）以固定規則選唯一主核心（選題、regenCore、外部巡檢共用）。
// 【未關聯者延後】衝突章由關聯段寫入；先提煉即永久錯過爭議材料，故 relatedAt 空者延後，逾寬限天數放行（免被關聯積壓卡死）。
// 【摘要專用之概念工具在摘要套件】既有概念詞彙表(conceptVocabulary)、可疑標籤(tagSuspects)、概念標籤之清理建議(suggestConceptRenames)
//   屬摘要套件,經 core/summarizePackage 取用;本檔只留提煉之分群與選題。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { normalizeConcept, noteConceptsOf, noteCreatedMsOf, cmp } from '../core/capturePackage.mjs'
import { SUMMARIZE_VOCAB_DEFAULT } from '../core/summarizePackage.mjs'
import { isRelated } from '../core/relatePackage.mjs'
import { EXTRACT_DEFAULT } from '../core/extractSettings.mjs'
import { coreLedgerKeyOf } from './extractLedger.mjs'

const DAY = 86400_000

/** 核心記錄之狀態:active(現行)、merged(同鍵之分身已併入主核心;記錄留存供轉址與復活) */
export const CORE_STATUS = Object.freeze({ active: 'active', merged: 'merged' })

/**
 * 現存之核心記錄(非分身;含類別核心——索引、清單與外部巡檢之語意)
 *
 * @param {Array} cores 輸入核心記錄陣列，非陣列視為空
 * @returns {Array} 回傳非 merged 之記錄
 * @example
 * console.log(liveCoresOf([{ id: 'c1', concept: '黑洞' }, { id: 'c2', concept: '黑洞', status: 'merged' }, null]).map((c) => c.id))
 * // => [ 'c1' ]
 */
export function liveCoresOf(cores) {
    return (isarr(cores) ? cores : []).filter((c) => c && c.status !== CORE_STATUS.merged)
}

/**
 * 是否為其 (scope, 正規化鍵) 之主核心(coreForKey 所選者;分身與非主者為 false;不限 scope)
 *
 * @param {Object} c 輸入核心記錄
 * @param {Array} cores 輸入全部核心記錄
 * @returns {Boolean} 回傳是否主核心
 * @example
 * const cores = [{ id: 'c1', concept: '黑洞', version: 3 }, { id: 'c2', concept: '黑洞', version: 1 }]
 * console.log(isPrimaryCore(cores[0], cores), isPrimaryCore(cores[1], cores))
 * // => true false
 */
export function isPrimaryCore(c, cores) {
    return !!c && coreForKey(cores, c.scope || 'concept', normalizeConcept(c.concept))?.id === c.id
}

/**
 * 是否為概念層之主核心(scope 'concept'〔缺省即 concept〕且為其鍵之主核心——掃描、重審預覽、同義核對與概念層專步之對象)
 *
 * @param {Object} c 輸入核心記錄
 * @param {Array} cores 輸入全部核心記錄
 * @returns {Boolean} 回傳是否概念層之主核心
 * @example
 * const cores = [{ id: 'c1', concept: '黑洞', version: 3 }, { id: 'c2', concept: '宇宙', scope: 'category' }]
 * console.log(isMainCore(cores[0], cores), isMainCore(cores[1], cores))
 * // => true false
 */
export function isMainCore(c, cores) {
    return !!c && (c.scope || 'concept') === 'concept' && isPrimaryCore(c, cores)
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
    const list = (isarr(cores) ? cores : []).filter((c) => c && c.status !== CORE_STATUS.merged && (c.scope || 'concept') === scope && normalizeConcept(c.concept) === key)
    if (!list.length) return null
    list.sort((a, b) => (b.version || 0) - (a.version || 0) ||
        (b.noteCount || 0) - (a.noteCount || 0) ||
        cmp(String(b.updatedAt || ''), String(a.updatedAt || '')) ||
        cmp(String(a.id || ''), String(b.id || '')))
    return list[0]
}

/**
 * 同 (scope, 鍵) 之其他核心(分身:非主核心且未標 merged)
 *
 * @param {Array} cores 輸入核心記錄陣列
 * @param {Object} primary 輸入主核心記錄(coreForKey 之產出)
 * @returns {Array} 回傳分身核心記錄陣列
 * @example
 * const cores = [{ id: 'c1', concept: '黑洞', version: 3 }, { id: 'c2', concept: '黑洞', version: 1 }, { id: 'c3', concept: '黑洞', status: 'merged' }]
 * console.log(twinsOf(cores, cores[0]).map((c) => c.id))
 * // => [ 'c2' ]
 */
export function twinsOf(cores, primary) {
    if (!primary) return []
    const key = normalizeConcept(primary.concept)
    const scope = primary.scope || 'concept'
    return (isarr(cores) ? cores : []).filter((c) => c && c !== primary && c.id !== primary.id && c.status !== CORE_STATUS.merged && (c.scope || 'concept') === scope && normalizeConcept(c.concept) === key)
}

/**
 * 筆記是否已可提煉:已關聯(關聯套件之 isRelated——「已關聯」之判定之單一來源),或建立逾寬限天數(關聯積壓時不永久卡住)
 *
 * @param {Object} note 輸入筆記記錄(取 relatedAt、createdAt)
 * @param {Number} nowMs 輸入現在時刻毫秒數
 * @param {Number} [graceDays=3] 輸入寬限天數，非有限數視為 3
 * @returns {Boolean} 回傳是否可提煉
 * @example
 * const now = Date.parse('2026-09-10T00:00:00+08:00')
 * console.log(isReady({ relatedAt: '2026-09-02T00:00:00+08:00' }, now), isReady({ createdAt: '2026-09-09T00:00:00+08:00' }, now), isReady({ createdAt: '2026-09-01T00:00:00+08:00' }, now))
 * // => true false true
 */
export function isReady(note, nowMs, graceDays = 3) {
    if (isRelated(note)) return true
    const g = Number.isFinite(graceDays) ? graceDays : 3
    const t = noteCreatedMsOf(note)
    return Number.isFinite(t) && nowMs - t >= g * DAY
}

/**
 * 依概念分群:每篇筆記之第一個有效標籤為主標籤、其餘為次標籤(同一篇折疊成同一鍵之多個標籤只入群一次;
 *   標籤之取法與主標籤之定義取抓取套件之 noteConceptsOf——與抓取之領域發現同一定義)
 *
 * @param {Array} notes 輸入筆記陣列，非陣列視為空
 * @returns {Map} 回傳 鍵 → { display, primary:Array, secondary:Array }
 * @example
 * const g = groupByConcept([{ id: 'n1', concepts: ['黑洞', '吸積盤'] }, { id: 'n2', concepts: ['吸積盤'] }])
 * console.log([...g.keys()], g.get('吸積盤').primary.map((n) => n.id), g.get('吸積盤').secondary.map((n) => n.id))
 * // => [ '黑洞', '吸積盤' ] [ 'n2' ] [ 'n1' ]
 */
export function groupByConcept(notes) {
    const groups = new Map()
    for (const n of isarr(notes) ? notes : []) {
        noteConceptsOf(n).forEach(({ key, label }, i) => {
            if (!groups.has(key)) groups.set(key, { forms: new Map(), primary: [], secondary: [] })
            const g = groups.get(key)
            g.forms.set(label, (g.forms.get(label) || 0) + 1)
            if (i === 0) g.primary.push(n)
            else g.secondary.push(n)
        })
    }
    // display 取最常見寫法(理由同摘要套件之 conceptVocabulary;字形折疊後同鍵可能混著繁簡兩種寫法,取多數者才會收斂):它會成為核心檔的概念名
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
    const consumed = new Set(isarr(core?.noteIds) ? core.noteIds : [])
    const fresh = (n) => !consumed.has(n.id) && isReady(n, nowMs, cfg.graceDays)
    const pending = primary.filter(fresh)
    const fillers = secondary.filter(fresh)
    const lastOk = Date.parse(core?.proposedAt || core?.updatedAt || '')
    const lastTry = Date.parse(attempt?.lastTriedAt || '')
    let since
    if (core) since = Math.max(Number.isFinite(lastOk) ? lastOk : 0, Number.isFinite(lastTry) ? lastTry : 0)
    else {
        const oldest = Math.min(...pending.map((n) => noteCreatedMsOf(n)).filter(Number.isFinite), nowMs)
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
        minNotes: num(opt.minNotes, EXTRACT_DEFAULT.minNotes),
        minPending: num(opt.minPending, EXTRACT_DEFAULT.minPending),
        maxWaitDays: num(opt.maxWaitDays, EXTRACT_DEFAULT.maxWaitDays),
        batch: Number.isFinite(opt.notesPerTarget) && opt.notesPerTarget > 0 ? opt.notesPerTarget : EXTRACT_DEFAULT.notesPerConcept,
        catchup: Number.isInteger(opt.catchup) && opt.catchup > 0 ? opt.catchup : EXTRACT_DEFAULT.catchupBatches,
        graceDays: num(opt.graceDays, EXTRACT_DEFAULT.relateGraceDays),
        attempts: isobj(opt.attempts) ? opt.attempts : {},
        nowMs: Number.isFinite(opt.now) ? opt.now : Date.now(),
    }
}

/**
 * 概念層選題:新核心之主標籤可提煉筆記 ≥ minNotes;既有核心之 pending ≥ 每批,或(pending ≥ minPending 且等待 ≥ maxWaitDays);
 * 依 score＝min(pending, 追趕批數×每批)×等待天數 降冪(同分依 pending、再依鍵)。規則見檔頭。
 *
 * @param {Array} notes 輸入已由呼叫端取出之筆記陣列，非陣列則視為空陣列
 * @param {Array} cores 輸入已由呼叫端取出之核心記錄陣列(noteIds 為累積已用；等待錨點 proposedAt，缺則 updatedAt)，非陣列則視為空陣列
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Number} [opt.minNotes] 輸入新核心門檻(主標籤可提煉篇數;預設＝設定預設之 minNotes)
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
        const t = targetOf({ key, scope: 'concept', display: g.display, primary: g.primary, secondary: g.secondary, core, attempt: cfg.attempts[coreLedgerKeyOf({ scope: 'concept', key })], cfg, nowMs: cfg.nowMs })
        if (t) out.push(t)
    }
    out.sort((a, b) => b.score - a.score || b.pending.length - a.pending.length || cmp(a.key, b.key))
    return out
}

/**
 * 孤兒筆記(類別後備之唯一候選):主概念(第一個有效標籤)無概念核心、該主概念之主標籤可提煉篇數未達新核心門檻、
 * 且建立已逾久候天數者;無任何有效概念標籤者亦算。
 *
 * 【為何只收孤兒、且須久候】類別後備本意是「概念詞彙尚未收斂時」之保底(寧少勿泛);候選若是整個類別,概念層只是本輪
 *   暫無滿批之閒置輪,就會把早已提煉進概念核心之筆記再吃一遍;未久候之孤兒日後多半晉級為概念核心而被兩層各吃一次。
 *
 * @param {Array} notes 輸入筆記陣列，非陣列視為空
 * @param {Array} cores 輸入核心記錄陣列，非陣列視為空
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Number} [opt.minNotes] 輸入新概念核心之門檻(主標籤可提煉篇數；未達者之筆記才算孤兒;預設＝設定預設之 minNotes)
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
    const cfg = cfgOf(opt)
    const withCore = new Set(liveCoresOf(cores).filter((c) => (c.scope || 'concept') === 'concept').map((c) => normalizeConcept(c.concept)))
    const groups = groupByConcept(notes)
    const readyCount = new Map()
    const out = []
    for (const n of notes) {
        if (!isReady(n, cfg.nowMs, cfg.graceDays)) continue
        const t = noteCreatedMsOf(n)
        if (!Number.isFinite(t) || cfg.nowMs - t < cfg.maxWaitDays * DAY) continue
        // 主概念＝主標籤(noteConceptsOf 之第一個;與 groupByConcept 同一定義)
        const key = noteConceptsOf(n)[0]?.key || ''
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
 * 以 minGain 當滿批則剛提煉之類別核心加幾篇即入選（概念層之部分批問題在類別層重現）。
 *
 * @param {Array} notes 輸入筆記陣列(類別後備時為孤兒筆記)，非陣列則視為空陣列
 * @param {Array} cores 輸入已由呼叫端取出之核心記錄陣列，非陣列則視為空陣列
 * @param {Object} [opt={}] 輸入設定物件，非物件則回退為 {}
 * @param {Integer} [opt.minNotes] 輸入新類別核心之可提煉篇數門檻(預設＝設定預設之 minNotes)
 * @param {Integer} [opt.minGain=4] 輸入既有類別核心未滿一批時之入選下限(須同時等待 ≥ maxWaitDays)
 * @param {Number} [opt.notesPerTarget=12] 輸入每批篇數(既有類別核心之滿批門檻)
 * @param {Number} [opt.maxWaitDays=30] 輸入未滿一批者須等待之天數
 * @param {Number} [opt.graceDays=3] 輸入未關聯筆記之寬限天數
 * @param {Object} [opt.attempts={}] 輸入失敗帳 { 'category|鍵': { tries, lastTriedAt } }
 * @param {Number} [opt.now] 輸入現在時刻毫秒數
 * @param {String} [opt.fallbackCategory] 輸入無類別之筆記歸入之類別(vocab.fallbackCategory)，未給用預設詞彙表之值
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

    const minNotes = Number.isFinite(opt.minNotes) ? opt.minNotes : EXTRACT_DEFAULT.minNotes
    const minGain = Number.isFinite(opt.minGain) ? opt.minGain : EXTRACT_DEFAULT.minPending
    const cfg = { ...cfgOf(opt), minNotes, minPending: minGain, catchup: 1 }
    const byCat = new Map()
    const fb = typeof opt.fallbackCategory === 'string' && opt.fallbackCategory ? opt.fallbackCategory : SUMMARIZE_VOCAB_DEFAULT.fallbackCategory
    for (const n of notes) {
        const cat = n?.category || fb
        if (!byCat.has(cat)) byCat.set(cat, [])
        byCat.get(cat).push(n)
    }
    const out = []
    for (const [cat, list] of byCat) {
        const key = normalizeConcept(cat)
        const core = coreForKey(cores, 'category', key)
        const t = targetOf({ key, scope: 'category', display: cat, primary: list, secondary: [], core, attempt: cfg.attempts[coreLedgerKeyOf({ scope: 'category', key })], cfg, nowMs: cfg.nowMs })
        if (t) out.push({ ...t, concept: cat })
    }
    out.sort((a, b) => b.pending.length - a.pending.length || cmp(a.key, b.key))
    return out
}

export default { coreForKey, twinsOf, isReady, groupByConcept, pickConcepts, orphanNotes, pickCategories, CORE_STATUS, liveCoresOf, isPrimaryCore, isMainCore }
