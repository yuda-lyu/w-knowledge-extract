// audit.mjs — 提煉檢定標準之符合度掃描(唯讀,不寫任何知識庫檔案)
//
// 【單一實作】新進之納入閘、落盤前之不變式與本掃描呼叫同一組判定(standards/coreStandards 之 checkCore 與其規則函數),輸入同為落地形態之
//   核心狀態;ES1 之長度上限、ES13 之證據等級與限制片語一律取提煉 domain(與提煉段同一份——安裝方整組置換之 domain 亦然)——掃描之結果即
//   「現行標準下存量之真實違反數」。
// 【對象】只掃主核心(概念層與類別層、非分身;isPrimaryCore——與四專步同一範圍,終審 §3 D5m);狀態檔讀不了者(壞檔而無上一版、遺失、非本格式)
//   範圍內之全部標準記未能判定。狀態檔之存取器取 coreStoreOf(與提煉段、維運、存量處置同一組目錄;壞檔而上一版救得回者照掃)。
// 【ES2／ES16 之材料】出處筆記之內容章＋原文標題＋發布時間(stores/noteFacts 之 extractMaterialOf;與提煉段同一定義)。來源三擇一:①呼叫端給
//   opt.materialOf(共用其已有之走訪,本掃描不讀 md)②給 opt.onNote 者逐篇讀 md(全量走訪;每篇讀得到 md 者回呼一次)③其餘只讀判定所需之
//   筆記之 md(各篇至多一次)。md 讀不到 → 該篇之材料不可得 → 含數字者記未能判定(不報為零)。opt.material 為 false → 不讀材料:含數字者記
//   未能判定並註明。範圍不含 ES2／ES16 者不取材料、不走訪。
// 【ES5 之材料】衝突邊之兩端(衝突型之現名與改名之舊名,取關聯 domain)、已交衝突核對者(待判登錄,任一狀態)——範圍含 ES5 才讀邊。
// 【回報】逐標準:總量、四態計數、版本、完整 id(不合格、未能判定、已豁免皆列;id 為「核心 id」或「核心 id#條目」)。不合格或未能判定而
//   該條目該標準有使用者豁免者記「已豁免」(逐一列出)——豁免是裁示,不是合格。豁免之鍵:條目層之待判(主張 claim、逾限筆記 extract-note:
//   `<物件>:<核心 id>:<條目或筆記 id>:<標準>`)與核心層之待判(存量處置修不了者 core:`core:<核心 id>:<標準>`——該核心該標準之全部判定)。
// 【AI 標準】ES8、ES9、ES11 之判定在檢核紀錄(checks;各紀錄之 results 之該標準)與待判登錄(holds):ai[標準]＝已檢、四態、版本過時
//   (紀錄之 v ≠ 現版,須重檢)、待判之未結與已豁免;四者另以核心狀態算受檢總量(total)與到期數(due)——與專步同一函數(ES9 stockNeedsOf、
//   ES8 orphanNeedsOf、ES11 synonymCandidatesOf＋synonymDueOf、ES14 disputeProgressOf;出處之內容鍵取提煉段之同一快取,唯讀)。
//   ES14 之覆核只記於核心狀態(doubtChecks;單一真理,終審 §3 D5g):其已檢、合格、版本過時亦由狀態推得,不讀檢核紀錄。
//   來源集合未給者其欄為 null(無從計,不報為零);該列之來源集合皆未給者該列為 null(ES14 之來源為核心狀態,恆有列)。列之計法取關聯套件之
//   aiStandardRowOf(檢核紀錄形狀之家;經關聯埠),受檢總量與到期數於列後附加(讀到檢核紀錄或待判登錄時;ES14 恆附)。
// 【累計與總覽之形狀】桶、四態、豁免之映射與逐態 id 上限取抓取套件之 createStandardsTally(四工作同一份;ES2／ES16 未讀材料之說明為其說明之
//   替換);總覽之形狀 extractScanOf 取其 standardsScanOf,計數摘要取其 standardsCountsOf。材料讀取器(三來源、快取、全量走訪)取關聯套件之
//   createMaterialReader(經關聯埠),材料之文字以本套件之 extractMaterialOf 注入。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { STATUS, result, createStandardsTally, standardsScanOf, retryRequestedOf, noteDocIdOf } from '../core/capturePackage.mjs'
import { aiStandardRowOf, createMaterialReader } from '../core/relatePackage.mjs'
import { checkCore, es5CtxOf } from './coreStandards.mjs'
import { CLAIM_OBJECT, stockNeedsOf } from './supportStock.mjs'
import { orphanNeedsOf } from './orphanCheck.mjs'
import { ES14, disputeHoldSetsOf, disputeHeldIdsOf, disputeProgressOf } from './disputeCheck.mjs'
import { ES11, synonymCandidatesOf, synonymDueOf } from './synonymCheck.mjs'
import { EXTRACT_STANDARDS, EXTRACT_AUDITED_STANDARD_IDS, EXTRACT_AI_STANDARD_IDS } from './registry.mjs'
import { TERMINAL_SET, unsupportedOf } from '../stores/coreState.mjs'
import { coreStoreOf } from '../stores/coreStore.mjs'
import { isPrimaryCore } from '../stores/conceptSelection.mjs'
import { extractMaterialOf } from '../stores/noteFacts.mjs'
import { ES15, CORE_HOLD_OBJECT, HOLD_VOID_HOWS, itemOidOf } from '../stores/extractHolds.mjs'
import { createContentCache } from '../stores/contentCache.mjs'
import { CONTENT_CACHE_FILE } from '../stores/extractFiles.mjs'

export { EXTRACT_AUDITED_STANDARD_IDS, EXTRACT_AI_STANDARD_IDS }

/** 掃描結果之物件名(併入總覽時之對象欄) */
export const EXTRACT_SCAN_OBJECT = 'cores'

/** 以核心狀態算受檢總量與到期數之 AI 標準(四專步;ES14 之判定欄亦由狀態推得) */
const PROGRESS_STDS = Object.freeze(['ES9', 'ES8', 'ES14', 'ES11'])

/** 以出處材料判定之標準 */
const MATERIAL_STDS = Object.freeze(['ES2', 'ES16'])

/** opt.material 為 false 時 ES2／ES16 之未能判定說明 */
const NO_MATERIAL_DETAIL = '未讀筆記材料（material:false），數字紮根無從判定'


/**
 * 掃描之提煉 domain(ES1 之長度上限、ES13 之證據判定與限制句;ES9 之內容鍵快取亦讀之)
 *
 * @param {*} d 輸入 deps.domain
 * @returns {Object} 回傳 domain
 * @throws {Error} 缺 domain 或缺長度上限時拋出
 */
function auditDomainOf(d) {
    if (!isobj(d) || !isobj(d.limits)) {
        throw new Error('auditExtractStandards 需要 deps.domain（提煉 domain，createExtractDomain 之產物——長度上限、證據判定與限制句取自此，與提煉段同一份）')
    }
    return d
}

/**
 * 提煉檢定標準之符合度掃描(唯讀)
 *
 * @param {Object} deps 輸入 { stores:{ notes, cores, relations?(範圍含 ES5 時必給), holds?, checks? }, dirs(每輪依賴之 dirs;取 core、coreState、state),
 *   domain(提煉 domain), relateDomain?(關聯 domain;範圍含 ES5 時必給——衝突型之判定), locale?(語言設定;ES3 只適用於臺灣正體,其餘逐條目列不適用;未給＝正體) }
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.only] 輸入只跑這些標準 id(未給或空陣列＝全部:逐件判定之標準與 AI 標準之列;不認得之 id 略過)
 * @param {Boolean} [opt.material=true] 輸入 ES2／ES16 是否讀出處筆記之材料;false 時含數字者記未能判定(給了 materialOf 者以之為準)
 * @param {Function} [opt.materialOf] 輸入 (筆記記錄) => 材料字串｜null(不可得):呼叫端已有之材料(內容章＋原文標題＋發布時間;本掃描不讀 md)
 * @param {Function} [opt.onNote] 輸入 (筆記記錄, md) => void:給了即逐篇讀 md(全量走訪),每篇讀得到 md 者回呼一次;只在範圍含 ES2／ES16、
 *   未給 materialOf 且 material 非 false 時走訪
 * @param {Integer} [opt.maxIds] 輸入每態列出之 id 上限(非負整數;預設全部)
 * @param {Object} [opt.disputeCheck] 輸入 ES14 到期之門檻 { minVersions, waitDays }(同 extract.standards.disputeCheck;未給取設定預設)
 * @param {Number} [opt.nowMs] 輸入到期判定之現在(毫秒;未給取 Date.now())
 * @returns {Promise} 回傳 Promise,resolve 回傳 { counts:{ cores(掃到之主核心數) }, standards:{ [id]: { id, title, kind, v, module:'extract', object,
 *   total, pass, violation, undetermined, na, waived, violations:[{ id, detail }], undetermineds:[{ id, detail }], waiveds:[{ id, detail }] } },
 *   ai?:{ [AI 標準]: { id, title, kind, v, module:'extract', object, checked, pass, violation, undetermined, na, stale, holdsOpen, holdsWaived,
 *   total?, due?(ES9／ES8／ES11 讀到檢核紀錄時;ES14 恆附,其判定欄由狀態推得) }|null }(範圍內有 AI 標準時才有;欄為 null＝來源集合未給,
 *   列為 null＝來源集合皆未給——ES14 之來源為核心狀態,恆有列),
 *   checksRead:Boolean(範圍內有 AI 標準且讀到 checks 集合) }
 * @throws {Error} deps.stores 缺 notes／cores 之 select、缺 deps.dirs 或 deps.domain、範圍含 ES5 而缺 relations 或 relateDomain 時拋出
 * @example
 * need test in nodejs.
 *
 * const rep = await auditExtractStandards({ stores, dirs, domain, relateDomain }, { only: ['ES3', 'ES5'] })
 * console.log(rep.standards.ES3.violation, rep.standards.ES5.violations)
 */
export async function auditExtractStandards(deps, opt = {}) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.notes?.select) || !isfun(stores.cores?.select)) {
        throw new Error('auditExtractStandards 需要 deps.stores.notes 與 deps.stores.cores（具 select 方法）')
    }
    if (!isobj(deps.dirs) || !(isestr(deps.dirs.coreState) || isestr(deps.dirs.core)) || !isestr(deps.dirs.state)) {
        throw new Error('auditExtractStandards 需要 deps.dirs（同每輪依賴之 dirs：核心狀態檔與其上一版、內容鍵快取由此取得——core、state）')
    }
    const domain = auditDomainOf(deps.domain)
    if (!isobj(opt)) {
        opt = {}
    }

    const only = isarr(opt.only) && opt.only.length ? new Set(opt.only) : null
    const useMaterial = opt.material !== false
    const materialOf = isfun(opt.materialOf) ? opt.materialOf : null
    const onNote = isfun(opt.onNote) ? opt.onNote : null
    // 待判登錄(一次讀;集合可缺):使用者豁免映射回四態(累計器)、ES15 之登錄查核、ES5 之已交衝突核對、AI 標準之待判數
    const allHolds = isfun(stores.holds?.select) ? await stores.holds.select() : null
    const tally = createStandardsTally(EXTRACT_STANDARDS, {
        module: 'extract', only, holds: allHolds, maxIds: opt.maxIds,
        // 未讀材料者之未能判定註明其因(不是材料不可得)
        detailOf: (r) => (!useMaterial && !materialOf && MATERIAL_STDS.includes(r.std) && r.status === STATUS.UNDETERMINED ? NO_MATERIAL_DETAIL : r.detail),
    })
    const std = tally.std
    const scanIds = Object.keys(std)
    const aiIds = EXTRACT_AI_STANDARD_IDS.filter((id) => !only || only.has(id))
    const needEs5 = scanIds.includes('ES5')
    if (needEs5 && (!isfun(stores.relations?.select) || !isestr(deps.relateDomain?.conflictType))) {
        throw new Error('auditExtractStandards 之 ES5 需要 deps.stores.relations（具 select 方法）與 deps.relateDomain（關聯 domain，衝突型之判定）')
    }
    /**
     * 記一筆判定;不合格／未能判定而該條目(主張、逾限筆記之待判)或該核心(存量處置修不了者之待判)該標準有豁免者記 waived
     */
    const add = (coreId, r) => tally.add(coreId, r, [[CORE_HOLD_OBJECT, coreId], ...(r.field ? [[CLAIM_OBJECT, itemOidOf(coreId, r.field)], [ES15.object, itemOidOf(coreId, r.field)]] : [])])

    const progressIds = PROGRESS_STDS.filter((id) => aiIds.includes(id))
    const checkRows = aiIds.length && isfun(stores.checks?.select) ? await stores.checks.select() : null
    // 受檢總量與到期數:ES9／ES8／ES11 之到期以檢核紀錄判(讀到才算);ES14 由核心狀態推得(恆算)
    const wantDispute = progressIds.includes(ES14.std)
    const wantProgress = (!!checkRows && progressIds.some((id) => id !== ES14.std)) || wantDispute
    const progress = Object.fromEntries(progressIds.map((id) => [id, { total: 0, due: 0 }]))
    if (progress.ES14) Object.assign(progress.ES14, { checked: 0, pass: 0, violation: 0, undetermined: 0, na: 0, stale: 0 })
    const nowMs = Number.isFinite(opt.nowMs) ? opt.nowMs : Date.now()
    let coreCount = 0
    if (scanIds.length || wantProgress) {
        const notes = await stores.notes.select()
        const noteById = new Map(notes.map((n) => [n.id, n]))
        const ctx0 = { limits: domain.limits, evidence: domain.evidence, weakEvidence: domain.weakEvidence, docIdOf: (nid) => noteDocIdOf(noteById.get(nid)) || null, locale: deps.locale }
        if (MATERIAL_STDS.some((id) => scanIds.includes(id))) ctx0.contentOf = createMaterialReader({ notes, noteById, useMaterial, materialOf, onNote, textOf: extractMaterialOf })
        if (std.ES15 && allHolds) {
            // 有登錄＝未結、已豁免、或已結案而結案方式不是「登錄從未對應一次完成之落盤」(落盤失敗之撤銷、清掃之落盤未完成——那類結案等於沒登錄)
            const held = new Set(allHolds.filter((h) => h.object === ES15.object && h.std === ES15.std && (h.status !== 'resolved' || !HOLD_VOID_HOWS.includes(String(h.how || '')))).map((h) => h.oid))
            ctx0.heldOf = (coreId, nid) => held.has(itemOidOf(coreId, nid))
        }
        if (needEs5) Object.assign(ctx0, es5CtxOf(await stores.relations.select(), allHolds, deps.relateDomain))
        // 到期之判定:檢核紀錄(物件 claim)與出處之內容鍵(提煉段之同一快取;唯讀,不呼叫 save);ES14 之待判集合(待判中、已豁免)
        const claimRec = new Map((wantProgress && checkRows ? checkRows : []).filter((r) => r.object === CLAIM_OBJECT).map((r) => [r.oid, r]))
        const cache = wantProgress ? createContentCache(path.join(deps.dirs.state || '', CONTENT_CACHE_FILE), domain) : null
        const noteKeyOf = (nid) => String(cache?.keyOf(noteById.get(nid)) ?? '')
        const disputeHolds = wantDispute && allHolds ? disputeHoldSetsOf(allHolds, retryRequestedOf) : new Map()
        const disputeOpt = isobj(opt.disputeCheck) ? opt.disputeCheck : {}
        const cores = await stores.cores.select()
        const store = coreStoreOf(deps.dirs)
        for (const c of cores) {
            if (!isPrimaryCore(c, cores)) continue
            // 四態分流表:可讀者掃(壞檔而上一版救得回者以上一版掃;提煉段下輪即以之修復);其餘記未能判定並載明原因
            const lr = store.loadUsable(c.id)
            if (!lr.readable) {
                for (const id of scanIds) add(c.id, result(id, STATUS.UNDETERMINED, lr.why))
                continue
            }
            coreCount++
            if (scanIds.length) for (const r of checkCore(lr.state, ctx0)) add(c.id, r)
            if (wantProgress) {
                const recOf = (oid) => claimRec.get(oid) || null
                const live = (lr.state.claims || []).filter((x) => !TERMINAL_SET.has(x.status))
                if (progress.ES9 && checkRows) {
                    progress.ES9.total += live.length
                    progress.ES9.due += stockNeedsOf(lr.state, { coreId: c.id, recOf, keyOf: noteKeyOf }).length
                }
                if (progress.ES8 && checkRows) {
                    // ES8 受檢＝失撐(出處全撤)而非隔離之有效主張;到期＝無檢核或候選／版本已變者(候選之內容鍵入雜湊,與專步同)
                    const un = unsupportedOf(lr.state)
                    progress.ES8.total += live.filter((x) => un.items.has(x.id) && !un.held.has(x.id)).length
                    progress.ES8.due += orphanNeedsOf(lr.state, { coreId: c.id, recOf, has: (nid) => noteById.has(nid), keyOf: noteKeyOf }).length
                }
                if (progress.ES14) {
                    // ES14:已檢、合格、版本過時由狀態之 doubtChecks 推得;受檢＝未解決且帶存疑;到期與專步同一判定(待判中、已豁免而無新存疑者不計)
                    const p = disputeProgressOf(lr.state, { minVersions: disputeOpt.minVersions, waitDays: disputeOpt.waitDays, nowMs, heldIds: disputeHeldIdsOf(lr.state, disputeHolds.get(c.id)), keyOf: noteKeyOf })
                    for (const k of Object.keys(p)) progress.ES14[k] += p[k]
                }
            }
        }
        if (progress.ES11 && checkRows) {
            // ES11:受檢總量＝名稱相近 ∪ 已存之提議之候選對;到期＝其中須檢者(與專步同一判定:待判中(使用者)、已判同素材、已豁免且素材未變者不計)
            const sc = synonymCandidatesOf({ cores, loadUsable: (id) => store.loadUsable(id), notesById: noteById, stateDir: deps.dirs.state })
            const mine = (allHolds || []).filter((h) => h?.std === ES11.std && h.object === ES11.object)
            const openBy = new Map(mine.filter((h) => h.status === 'open').map((h) => [h.oid, h]))
            const waivedBy = new Map(mine.filter((h) => h.status === 'waived').map((h) => [h.oid, h]))
            const recBy = new Map(checkRows.filter((r) => r?.object === ES11.object).map((r) => [r.oid, r]))
            const dr = await synonymDueOf(sc, { openOf: (k) => openBy.get(k) || null, waivedOf: (k) => waivedBy.get(k) || null, recOf: (k) => recBy.get(k) || null })
            progress.ES11.total = sc.cand.size
            progress.ES11.due = dr.due.length
        }
    }

    const out = { counts: { cores: coreCount }, standards: std, checksRead: !!checkRows }

    // ── AI 標準:檢核紀錄＋待判(檔頭;列之計法關聯套件之 aiStandardRowOf;受檢總量與到期數於列後附加;ES14 之判定欄由狀態推得、恆有列)──
    if (aiIds.length) {
        out.ai = {}
        for (const id of aiIds) {
            const s = EXTRACT_STANDARDS.find((x) => x.id === id)
            let row = aiStandardRowOf(s, { module: 'extract', checkRows, holds: allHolds })
            if (id === ES14.std) row = { ...(row || aiStandardRowOf(s, { module: 'extract', checkRows: [], holds: allHolds })), ...progress.ES14 }
            else if (row && checkRows && progress[id]) Object.assign(row, progress[id])
            out.ai[id] = row
        }
    }
    return out
}

/**
 * 掃描結果 → 總覽之形狀(與他工作之掃描合併用;抓取套件之 standardsScanOf):標準列之對象改為 EXTRACT_SCAN_OBJECT;AI 列之計數欄 null 補 0、
 *   全零之列與整列為 null 者不列(ES9／ES8 之受檢總量與到期數計入非零之判;讀到檢核紀錄時附之);另附是否讀到檢核紀錄
 *
 * @param {Object} rep 輸入 auditExtractStandards 之產物
 * @returns {Object} 回傳 { counts:{ cores }, standards:{ [id]: 標準列(object 'cores') }, ai:{ [id]: { checked, pass, violation, undetermined, na,
 *   stale, holdsOpen, holdsWaived, v, total?, due? } }, checksRead:Boolean }
 * @example
 * let s = extractScanOf({ counts: { cores: 2 }, standards: {}, ai: { ES9: { v: 2, checked: 0, holdsOpen: 0, total: 5, due: 5 }, ES11: { v: 1, checked: 0, holdsOpen: 0 }, ES14: null } })
 * console.log(s.counts.cores, Object.keys(s.ai), s.ai.ES9.due)
 * // => 2 [ 'ES9' ] 5
 */
export function extractScanOf(rep) {
    const s = standardsScanOf(rep, { object: EXTRACT_SCAN_OBJECT })
    return { ...s, counts: { cores: Number(rep?.counts?.cores) || 0 }, checksRead: rep?.checksRead === true }
}

export default { EXTRACT_SCAN_OBJECT, EXTRACT_AUDITED_STANDARD_IDS, EXTRACT_AI_STANDARD_IDS, auditExtractStandards, extractScanOf }
