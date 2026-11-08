// extractHolds.mjs — 提煉之待判(待判登錄之提煉端用法):期限、物件名與標準識別、面向使用者之下一步與處置 API 之字樣
//
// 【期限】提煉之待判一律 EXTRACT_HOLD_DEADLINE_DAYS 天(extractHoldDeadlineOf——期限之機制為抓取套件之 holdDeadlineOf;逾限筆記、新進與存量之出處支持、失撐、爭議覆核、同義核對、
//   核心之存量處置之登錄同讀此處);刻意不開放設定(同摘要、關聯套件之待判期限)。
// 【物件名】待判登錄鍵之一部分(已持久化,值不可改):筆記層 extract-note(逾限筆記 ES15;新進覆核判不了之筆記 ES9 沿用同一物件名)、
//   爭議 dispute(ES14)、主張 claim(存量 ES9、失撐 ES8;檢核紀錄之物件同名)、兩核心 core-pair(ES11;檢核紀錄同名)、核心 core(存量處置修不了者)。
//   各標準模組之物件常數(ES15.object〔＝note;ES15_OBJECT 為其對外別名〕、ES14_OBJECT、CLAIM_OBJECT、ES11.object)皆取自此處,值只寫一次。
// 【字樣】面向使用者之下一步、處置方式與日誌之提示指處置 API,不指特定執行端之指令:重送／重判／豁免為待判登錄之處置(抓取套件之
//   requestRetry、waiveHold;經抓取埠),重設基準為本套件之 requestRebaseline,出處懸空為關聯套件之 deleteNote／restoreNote;未開集合之提示指每輪依賴之
//   stores。觀察契約之字樣不在此改:同義核對之待判理由「建議於 vocab.conceptAliases 加入「…」→「…」」、逐棒日誌「提煉事件[…] <棒> <供應者> 成交」、
//   「…條衝突交關聯段核對」與外部巡檢所讀之日誌前綴。

import { holdDeadlineOf, listHolds } from '../core/capturePackage.mjs'

/** 待判之期限(天;提煉之全部待判同一期限) */
export const EXTRACT_HOLD_DEADLINE_DAYS = 30

/**
 * 待判之期限時刻(登錄時刻＋EXTRACT_HOLD_DEADLINE_DAYS 天;抓取套件之 holdDeadlineOf)
 *
 * @param {String} nowIso 輸入登錄時刻
 * @returns {String} 回傳期限時刻(ISO 8601,UTC)
 * @throws {RangeError} nowIso 不可解析時拋出
 * @example
 * console.log(extractHoldDeadlineOf('2026-10-05T10:00:00+08:00'))
 * // => 2026-11-04T02:00:00.000Z
 */
export function extractHoldDeadlineOf(nowIso) {
    return holdDeadlineOf(nowIso, EXTRACT_HOLD_DEADLINE_DAYS)
}

/**
 * 待判登錄之物件名(登錄鍵 `${object}:${oid}:${std}` 之一部分;已持久化,不可改)
 *
 * @type {Object}
 */
export const EXTRACT_HOLD_OBJECTS = Object.freeze({
    note: 'extract-note', // 筆記層:逾限筆記(ES15)、新進覆核判不了之筆記(ES9);oid＝`${核心 id}:${筆記 id}`
    dispute: 'dispute', // 爭議(ES14);oid＝`${核心 id}:${爭議 id}`
    claim: 'claim', // 主張(存量 ES9、失撐 ES8);oid＝`${核心 id}:${主張 id}`
    corePair: 'core-pair', // 兩核心(ES11);oid＝兩概念名之無序鍵
    core: 'core', // 核心(存量處置修不了者);oid＝核心 id
})

/**
 * 以核心 id 為前綴之 oid(筆記層、爭議、主張之待判與檢核紀錄:`<核心 id>:<條目或筆記 id>`;組與拆只此一處——parseItemOid 為其逆)
 *
 * @param {String} coreId 輸入核心 id
 * @param {String} id 輸入條目 id(爭議、主張)或筆記 id(筆記層);給空字串即得「該核心之 oid 前綴」
 * @returns {String} 回傳 oid
 * @example
 * console.log(itemOidOf('k1', 'C3'), itemOidOf('k1', ''))
 * // => k1:C3 k1:
 */
export function itemOidOf(coreId, id) {
    return `${coreId}:${id}`
}

/**
 * 拆 itemOidOf 之 oid:第一個「:」之前為核心 id、其後至下一個「:」為條目或筆記 id(無「:」者 id 為 undefined;非字串先轉字串,null／undefined 視為空字串)
 *
 * @param {*} oid 輸入 oid
 * @returns {Object} 回傳 { coreId:String, id:String|undefined }
 * @example
 * console.log(parseItemOid('k1:C3'), parseItemOid('k1'))
 * // => { coreId: 'k1', id: 'C3' } { coreId: 'k1', id: undefined }
 */
export function parseItemOid(oid) {
    const [coreId, id] = String(oid ?? '').split(':')
    return { coreId, id }
}

/** 逾限筆記之標準識別(ES15;筆記層之待判物件) */
export const ES15 = Object.freeze({ std: 'ES15', object: EXTRACT_HOLD_OBJECTS.note })

/** 核心之存量處置修不了者之待判物件(存量處置之登錄與符合度掃描之豁免查核同讀) */
export const CORE_HOLD_OBJECT = EXTRACT_HOLD_OBJECTS.core

/**
 * 某核心之待判中須隨「打掉重練」或「回退」結案者(未結 open 與已豁免 waived;以核心 id 為 oid 前綴之筆記層、爭議、主張待判,與以核心 id 為 oid 之核心待判;
 *   新核心沿用同一 id 而條目編號重新配發、回退後其後各版之條目不再存在——舊登錄與舊裁示不得作用於其後之條目);依登錄 id 排序。regenCore 與 rollbackCore 同讀此一份
 *
 * @param {Object} holds 輸入待判集合(listHolds 所讀之集合)
 * @param {String} coreId 輸入核心 id
 * @returns {Promise} 回傳 Promise，resolve 回傳待判登錄陣列(依 id 排序)
 * @example
 * need test in nodejs.
 *
 * const hs = await coreHoldsToCloseOf(stores.holds, 'k1')
 * console.log(hs.map((h) => h.id))
 */
export async function coreHoldsToCloseOf(holds, coreId) {
    const perCore = new Set([EXTRACT_HOLD_OBJECTS.note, EXTRACT_HOLD_OBJECTS.dispute, EXTRACT_HOLD_OBJECTS.claim])
    const mine = (h) => (perCore.has(h.object) && String(h.oid).startsWith(itemOidOf(coreId, ''))) || (h.object === CORE_HOLD_OBJECT && h.oid === coreId)
    return (await listHolds(holds)).filter((h) => (h.status === 'open' || h.status === 'waived') && mine(h)).sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** 落盤失敗時撤銷本次新登錄之處置方式(先記後寫之補償:登錄前無記錄者結案;有者寫回前像,不經結案) */
export const HOLD_UNDO_HOW = '落盤失敗（登錄撤銷）'

/** 清掃結案之處置方式前綴(維護段:登錄已不適用——落盤未完成、筆記已刪除、已被引用、核心不在、條目終態) */
export const HOLD_STALE_HOW_PREFIX = '已不適用'

/** 代表「登錄從未對應一次完成之落盤」之結案方式(撤銷、清掃之落盤未完成);符合度掃描之 ES15 不把這類結案當作有登錄 */
export const HOLD_VOID_HOWS = Object.freeze([HOLD_UNDO_HOW, `${HOLD_STALE_HOW_PREFIX}：落盤未完成`])

/**
 * 處置 API 之提示(日誌、拋錯與處置方式之尾段共用;面向使用者)
 *
 * @type {Object}
 */
export const EXTRACT_API_HINT = Object.freeze({
    holdsStore: '請於每輪依賴之 stores 給 holds 集合',
    checksStore: '請於每輪依賴之 stores 給 checks 集合',
    rebaseline: '屬格式變動者以 requestRebaseline（逐 id、opt.by）指示下一輪以現值重設基準',
    dangling: '以關聯套件之 deleteNote 明示刪除或 restoreNote 還原',
    regenDirs: '同每輪依賴之 dirs：核心狀態檔與封存目錄由此取得',
    revive: '使用者複核後以 reviveClaims（opt.by、opt.ruling）還原',
})

/**
 * 待判之下一步(固定者;負責者 user 之使用者處置與負責者 pipeline 之管線重判——皆見於待判清單,各段不另寫字面)
 *
 * @type {Object}
 */
export const EXTRACT_HOLD_NEXT = Object.freeze({
    // 逾限筆記(ES15):提示詞或起草席位變更後自動重送
    noteOverdue: '提示詞或起草席位變更後自動重送；或要求重送（requestRetry）、豁免（waiveHold）',
    // 新進覆核判不了之筆記(ES9,筆記層):首次由管線重送、重送後仍判不了 → 使用者
    noteSupportRetry: '下次處理本核心時自動重送本篇',
    noteSupportUser: '使用者判讀：要求重送（requestRetry）或豁免（waiveHold）',
    // 爭議覆核判不了(ES14)
    dispute: '使用者判讀：要求重判（requestRetry）或豁免（waiveHold：保留爭議與存疑）',
    // 存量出處支持(ES9)與失撐(ES8)之主張:判不了或逾次缺票
    claimSupport: '使用者判讀：豁免（waiveHold：保留主張並解除隔離）或要求重判（requestRetry）；主張被修訂或補出處後自動重判',
    claimOrphan: '使用者判讀：豁免（waiveHold：維持隔離，待新出處或出處筆記還原）或要求重判（requestRetry）',
    // 同義核對(ES11):同一概念、判定小組未成立、判不了
    synonymSame: '使用者確認後把該別名加入詞彙表之 conceptAliases（下一輪提煉段之分身合併即併為一核心，其筆記由正名核心重新提煉）；不同意則豁免（waiveHold）',
    synonymRetry: '下輪同義核心核對重判',
    synonymUser: '使用者判讀：同一概念者加入 conceptAliases；否則豁免（waiveHold）',
    // 核心之存量處置修不了者(同一核心同一標準一筆)
    coreStock: '使用者判讀：豁免（waiveHold：維持現狀，符合度掃描即記已豁免）；已不再違反者（內容經提煉改寫）於下次存量處置之套用時結案；或以 regenCore 打掉重練（隨之結案）',
})

export default { EXTRACT_HOLD_DEADLINE_DAYS, extractHoldDeadlineOf, EXTRACT_HOLD_OBJECTS, itemOidOf, parseItemOid, coreHoldsToCloseOf, ES15, CORE_HOLD_OBJECT, HOLD_UNDO_HOW, HOLD_STALE_HOW_PREFIX, HOLD_VOID_HOWS, EXTRACT_API_HINT, EXTRACT_HOLD_NEXT }
