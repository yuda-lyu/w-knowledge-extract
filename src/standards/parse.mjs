// parse.mjs — 工作流各棒回覆之嚴格解析:只收含指定鍵之 JSON 物件,取最後一個合格者,找不到回 null(交驗證失敗 → 遞補)
//
// 【片段與選取之規則在抓取套件】「含指定鍵之物件」之找法(大括號配對、往不含鍵之外包物件內找、不中止於未閉合之「{」)與「由後往前取第一個
//   合格者」之選取,皆為抓取套件之 pickKeyedJson(與其頂層片段之 pickJsonReply 共用同一選取函數)——同一規則只此一份。本檔只注入寬鬆解析
//   (JSON5:尾逗號、單引號;抓取套件不依賴之),並為各棒帶入自己的 check。
// 【為何只收含鍵之物件、取最後一個合格者】取「第一個」JSON 片段時,模型前言寫「依意見 [3]」即拿到陣列 [3],補丁路徑把它當成空補丁
//   套回原稿,靜默變成空操作;模型偶會先回一段、再「更正如下」回完整一段,取第一個即拿到被模型自己作廢之那段。

import JSON5 from 'json5'
import { pickKeyedJson } from '../core/capturePackage.mjs'

/**
 * 自文字中取出「含任一指定鍵」之 JSON 物件:由後往前取第一個 accept(obj) === true 者;未給 accept 或皆不過時取最後一個含鍵者
 *   (交呼叫端之 check 判不合格)。即抓取套件之 pickKeyedJson 帶入 JSON5 之寬鬆解析(名為「回覆之物件」——與提煉物件 extractObject.mjs 區分)
 *
 * @param {*} text 輸入模型回覆(非字串以 String 轉)
 * @param {Array} keys 輸入須含之鍵(任一即可)
 * @param {Function} [accept] 輸入合格判定函數 (obj) => Boolean，嚴格 true 才合格(拋錯視同不合格)
 * @returns {Object|null} 回傳物件，找不到含鍵者回 null
 * @example
 * console.log(replyObjectOf('依意見 [3] 修改如下：{"edits":[]}', ['edits']).edits.length)
 * // => 0
 *
 * console.log(replyObjectOf('{"ops":[1]}\n等等，更正如下：\n{"ops":[1,2]}', ['ops']).ops.length)
 * // => 2
 */
export function replyObjectOf(text, keys, accept) {
    return pickKeyedJson(text, keys, accept, { looseParse: JSON5.parse })
}

/**
 * 起草棒(與整合棒)之形狀檢查(嚴格布林;交 w-dispatch-ai 之 check,並為解析器之合格判定):須有 ops 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkDraft({ ops: [] }), checkDraft({ issues: [] }), checkDraft(null))
 * // => true false false
 */
export const checkDraft = (j) => !!j && Array.isArray(j.ops)

/**
 * 審計棒之形狀檢查(嚴格布林;交 w-dispatch-ai 之 check,並為解析器之合格判定):須有 issues 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkAudit({ issues: [] }), checkAudit({ ops: [] }), checkAudit(null))
 * // => true false false
 */
export const checkAudit = (j) => !!j && Array.isArray(j.issues)

/**
 * 修訂棒之形狀檢查(嚴格布林;交 w-dispatch-ai 之 check,並為解析器之合格判定):edits、adds、removes 至少一個為陣列,且給了者皆為陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkPatch({ edits: [] }), checkPatch({ adds: [], removes: [] }), checkPatch({}), checkPatch({ edits: 'x' }))
 * // => true true false false
 */
export const checkPatch = (j) => !!j && ['edits', 'adds', 'removes'].some((k) => Array.isArray(j[k])) && ['edits', 'adds', 'removes'].every((k) => j[k] === undefined || Array.isArray(j[k]))

/**
 * 終審棒之形狀檢查(嚴格布林;交 w-dispatch-ai 之 check,並為解析器之合格判定):須有 verdicts 陣列
 *
 * @param {*} j 輸入解析出之回覆物件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkVerdicts({ verdicts: [] }), checkVerdicts({ verdicts: 'x' }), checkVerdicts(undefined))
 * // => true false false
 */
export const checkVerdicts = (j) => !!j && Array.isArray(j.verdicts)

/**
 * 起草棒之解析器(交 w-dispatch-ai 之 parse;回 null 即該家失敗、換遞補):取最後一個過 checkDraft 者
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 ops 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseDraft('以下為結果：{"ops":[{"op":"add"}],"skipped":[]}').ops.length, parseDraft('沒有 JSON'))
 * // => 1 null
 */
export const parseDraft = (s) => replyObjectOf(s, ['ops'], checkDraft)

/**
 * 審計棒之解析器(交 w-dispatch-ai 之 parse;回 null 即該家失敗、換遞補):取最後一個過 checkAudit 者
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 issues 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseAudit('{"issues":[{"ref":"a1_0"}]}').issues.length, parseAudit('{"ops":[]}'))
 * // => 1 null
 */
export const parseAudit = (s) => replyObjectOf(s, ['issues'], checkAudit)

/**
 * 修訂棒之解析器(交 w-dispatch-ai 之 parse;回 null 即該家失敗、換遞補):取最後一個過 checkPatch 者
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 edits／adds／removes 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parsePatch('{"edits":[],"adds":[{"op":"add"}],"removes":[]}').adds.length, parsePatch('沒有 JSON'))
 * // => 1 null
 */
export const parsePatch = (s) => replyObjectOf(s, ['edits', 'adds', 'removes'], checkPatch)

/**
 * 終審棒之解析器(交 w-dispatch-ai 之 parse;回 null 即該家失敗、換遞補):取最後一個過 checkVerdicts 者
 *
 * @param {*} s 輸入模型回覆(非字串以 String 轉)
 * @returns {Object|null} 回傳含 verdicts 之物件，找不到含鍵者回 null(含鍵而形狀不合者照回，交 check 判不合格)
 * @example
 * console.log(parseVerdicts("{verdicts:[{i:0,action:'keep',},]}").verdicts, parseVerdicts('[1]'))
 * // => [ { i: 0, action: 'keep' } ] null
 */
export const parseVerdicts = (s) => replyObjectOf(s, ['verdicts'], checkVerdicts)

/**
 * 差量之形狀正規化(不改語意):誤放在 ops 裡之「略過」移到 skipped(模型會輸出 {"op":"skipped",…},不移則以「未知操作」被拒);
 *   非物件之項丟棄並計數(dropped;呼叫端記 trace——不靜默)
 *
 * @param {Object} j 輸入 parseDraft 之產物
 * @returns {Object} 回傳 { ...j, ops, skipped, dropped:Integer }(新物件)
 * @example
 * const j = normalizeDelta({ ops: [{ op: 'add', text: '甲' }, { op: 'skipped', note: 'N2', reason: '離題' }, 'x'], skipped: [] })
 * console.log(j.ops.length, j.skipped, j.dropped)
 * // => 1 [ { note: 'N2', reason: '離題' } ] 1
 */
export function normalizeDelta(j) {
    const ops = []
    const skipped = Array.isArray(j?.skipped) ? [...j.skipped] : []
    let dropped = 0
    for (const o of Array.isArray(j?.ops) ? j.ops : []) {
        if (!o || typeof o !== 'object') {
            dropped++
            continue
        }
        const op = String(o.op ?? '').trim()
        if (op === 'skipped' || op === 'skip') {
            if (String(o.note ?? '').trim()) skipped.push({ note: o.note, reason: o.reason ?? '' })
            continue
        }
        ops.push(o)
    }
    return { ...(j || {}), ops, skipped, dropped }
}

export default { replyObjectOf, parseDraft, parseAudit, parsePatch, parseVerdicts, checkDraft, checkAudit, checkPatch, checkVerdicts, normalizeDelta }
