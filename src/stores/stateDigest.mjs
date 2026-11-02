// stateDigest.mjs — 狀態之提示詞摘要與規則表之文字(stores 層;純函數):起草、整合、審計、修訂、終審、整併共用同一份

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { TERMINAL_SET, allItemsOf, emptyState, essenceLostOf, excludedSourcesOf, liveSourcesOf, unsupportedOf, withdrawnOf } from './coreState.mjs'
import { textValueOf as str } from '../core/capturePackage.mjs'


/**
 * 規則表 → 提示詞文字(機制:依優先序編號;起草、整合、審計、修訂、終審、整併共用同一份——同一類規則只定義一次、注入各步)
 *
 * @param {Array} rules 輸入規則陣列 [{ id, text, priority }]
 * @returns {String} 回傳編號後之規則文字
 * @example
 * console.log(renderRules([{ id: 'b', text: '乙', priority: 2 }, { id: 'a', text: '甲', priority: 1 }]))
 * // => 1. 甲
 * // 2. 乙
 */
export function renderRules(rules) {
    return (isarr(rules) ? rules : [])
        .filter((r) => r && String(r.text || '').trim())
        .slice().sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .map((r, k) => `${k + 1}. ${String(r.text).trim()}`)
        .join('\n')
}

/**
 * 狀態之提示詞摘要(機制預設;domain 可自組):本質、主張(非終態)、爭議(未撤回)、參數、待解問題、相關概念;終態項只列 id 與一句
 *
 * @param {Object} state 輸入狀態
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Boolean} [opt.full=false] 輸入是否附出處篇數以外之全部欄位(整併用)
 * @param {Set} [opt.only] 輸入只給全文之條目 id(其餘只列索引行)
 * @param {Integer} [opt.indexLen=30] 輸入索引行之字數
 * @param {Boolean} [opt.allDoubts=false] 輸入終審存疑是否一律顯示(終審所見之觸及條目用);預設只顯示至其後第一次提煉落盤
 * @param {Map} [opt.marks] 輸入條目 id → 附註(重審時標「引用重審筆記 N2」等;無則不加)
 * @returns {String} 回傳摘要文字；狀態為空時回傳「（尚無內容）」
 * @example
 * const s = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }], essence: { text: '本質', claims: ['C1'] } }).state
 * console.log(stateDigest(s).split('\n').slice(0, 3))
 * // => [ '【本質】本質（依〔C1〕）', '【主張】共 1 條', '〔C1〕[principle] 甲｜證據未評估、出處 1 篇' ]
 */
export function stateDigest(state, opt = {}) {
    if (!isobj(opt)) opt = {}
    const s = state || emptyState()
    const lines = []
    const j = (arr) => (isarr(arr) ? arr.filter(Boolean).join('；') : '')
    const ev = (x) => (x.evidence?.level ? `證據${x.evidence.level}` : '證據未評估')
    // 出處已撤:篇數一律計存活出處;失撐者標「出處已撤」、部分撤者標「部分出處已撤」
    const W = withdrawnOf(s)
    const un = unsupportedOf(s)
    const srcNote = (x) => `出處 ${liveSourcesOf(x, s, W).length} 篇${excludedSourcesOf(s, x.id).size ? `（其中 ${excludedSourcesOf(s, x.id).size} 篇經覆核判不支持，不計證據）` : ''}${un.held.has(x.id) ? '、出處支持未能判定（隔離待判，勿引用）' : (un.items.has(x.id) ? '、出處已撤（待補出處）' : (un.partial.has(x.id) ? '、部分出處已撤' : ''))}`
    const markOf = (x) => (opt.marks instanceof Map && opt.marks.get(x.id) ? `｜${opt.marks.get(x.id)}` : '')
    const lostEss = essenceLostOf(s, un)
    // 狀態視圖(提示詞預算不足時):opt.only 為要給全文之 id 集合,其餘只列索引行(id＋前 indexLen 字)——
    //   程式另行禁止對只見索引行之項目下改狀態之操作(standards/opGuards 之可見性規則)
    const only = opt.only instanceof Set ? opt.only : null
    const idxLen = Number.isInteger(opt.indexLen) && opt.indexLen > 0 ? opt.indexLen : 30
    const indexLine = (x, text) => `〔${x.id}〕（索引）${String(text || '').replace(/\s+/g, ' ').slice(0, idxLen)}…`
    // 所引主張被取代／撤回而未重寫(stale):明示待重寫,起草端據以提出新 essence(規則表 essence 條)
    const claims = s.claims.filter((c) => !TERMINAL_SET.has(c.status))
    if (s.essence?.text) lines.push(`【本質】${s.essence.text}${(s.essence.claims || []).length ? `（依〔${s.essence.claims.join('〕〔')}〕）` : ''}${isobj(s.essence.stale) ? `（所引主張〔${s.essence.stale.from}〕已於 v${s.essence.stale.version} 被取代或撤回，本質待重寫）` : ''}${lostEss.length ? `（所引主張〔${lostEss.join('〕〔')}〕之出處已撤，本質待重寫）` : ''}`)
    // 已有主張而無本質(首版之本質操作被拒、或從未提出):明示待歸納,下次處理此核心時起草端據以提出 essence——
    //   否則摘要只是少一行,無任何指示會補上
    else if (claims.length) lines.push('【本質】（尚未歸納——本核心已有主張而無本質，本批須以 essence 綜合現有主張）')
    if (claims.length) {
        lines.push(`【主張】共 ${claims.length} 條${only ? `（其中 ${claims.filter((c) => only.has(c.id)).length} 條附全文，其餘只列索引）` : ''}`)
        for (const c of claims) {
            if (only && !only.has(c.id)) {
                lines.push(indexLine(c, c.text))
                continue
            }
            const parts = [`〔${c.id}〕[${c.kind}${c.facet ? `｜${c.facet}` : ''}] ${c.text}`]
            if (c.conditions?.length) parts.push(`條件：${j(c.conditions)}`)
            if (opt.full && c.pros?.length) parts.push(`利：${j(c.pros)}`)
            if (opt.full && c.cons?.length) parts.push(`弊：${j(c.cons)}`)
            if (c.period) parts.push(`時期：${c.period}`)
            if (opt.full && c.critique) parts.push(`銳評：${c.critique}`)
            parts.push(`${ev(c)}、${srcNote(c)}${c.status === 'contested' ? '、有爭議' : ''}`)
            lines.push(parts.join('｜') + markOf(c))
        }
    }
    const disputes = s.disputes.filter((d) => d.status !== 'retracted')
    if (disputes.length) {
        lines.push('【爭議】（各方以 side k 標示，k 即操作之 "side" 值，自 0 起）')
        for (const d of disputes) {
            if (only && !only.has(d.id)) {
                lines.push(indexLine(d, d.question))
                continue
            }
            const lostSides = un.sides.get(d.id)
            const sides = (d.sides || []).map((sd, k) => `side ${k}：${sd.position}${sd.basis ? `〔${sd.basis}〕` : ''}${(sd.claims || []).length ? `（引〔${sd.claims.join('〕〔')}〕）` : ''}${lostSides?.has(k) ? '（出處已撤）' : ''}`).join('｜')
            // 終審存疑只顯示至其後第一次提煉落盤(存疑產生之提煉落帳時 proposedAt 即其時刻):給起草端至少一次拆解之機會,
            //   但不讓同一則懷疑逐批呈現而累積成拆解(第二方被第一方之懷疑帶著走);md 與終審所見之觸及條目常駐(opt.allDoubts)
            const doubt = d.status === 'open' && isobj(d.doubt) && (opt.allDoubts === true || str(d.doubt.at) >= str(s.proposedAt)) ? `｜終審存疑（${d.doubt.reason}）：${d.doubt.note}` : ''
            lines.push(`〔${d.id}〕${d.status === 'resolved' ? '（已解決）' : ''}${d.question}${sides ? `｜${sides}` : ''}${doubt}${markOf(d)}`)
        }
    }
    const params = s.parameters.filter((p) => !TERMINAL_SET.has(p.status))
    if (params.length) {
        lines.push('【參數】')
        for (const p of params) {
            if (only && !only.has(p.id)) {
                lines.push(indexLine(p, `${p.name}＝${p.value}`))
                continue
            }
            lines.push(`〔${p.id}〕${p.name}＝${p.value}${p.conditions ? `（${p.conditions}）` : ''}${p.period ? `｜時期：${p.period}` : ''}${p.claim ? `｜依〔${p.claim}〕` : ''}${un.items.has(p.id) ? '｜出處已撤（待補出處）' : ''}${markOf(p)}`)
        }
    }
    const qs = s.questions.filter((q) => q.status === 'open')
    if (qs.length) {
        lines.push('【待解問題】')
        for (const q of qs) lines.push(only && !only.has(q.id) ? indexLine(q, q.text) : `〔${q.id}〕${q.text}${un.items.has(q.id) ? '｜出處已撤' : ''}${markOf(q)}`)
    }
    if (s.related.length) lines.push(`【相關概念】${s.related.join('、')}`)
    if ((s.pendingReview || []).length) {
        lines.push(`【待審（終審失敗或未得裁決而暫緩之不可逆操作——取代、撤回、合併、拆解；出處支持覆核未完成之操作；勿重複提出）】${s.pendingReview.map((e) => `〔${e.op.id || e.op.into || e.op.ref || ''}〕${e.op.op}${e.op.by ? `→〔${e.op.by}〕` : ''}`).join('、')}`)
    }
    const gone = allItemsOf(s).filter((x) => TERMINAL_SET.has(x.status))
    if (gone.length) lines.push(`【已取代／撤回】${gone.map((x) => `〔${x.id}〕${x.status === 'retracted' ? `撤回（${x.retractReason}）` : `取代${x.mergedInto ? `（併入〔${x.mergedInto}〕）` : ''}`}`).join('、')}`)
    return lines.length ? lines.join('\n') : '（尚無內容）'
}

export default { renderRules, stateDigest }
