// prompts.mjs — 提煉 3+3 工作流之整合、審計、修訂提示詞與終審附錄之內建實作(domain 之同名成員;各步經 domain 呼叫,
//   安裝方以 createExtractDomain 之 opt.prompts 之 integrate／audit／revise／acceptAppendix 覆寫,或整組置換 domain)
//
// 【規則表單一來源】三支提示詞皆引用 domain.rules 經 renderRules 之同一份文字(起草、終審同),改一條即各棒同步。
// 【契約段】「只回覆 JSON…」起之段落是程式解析所依賴者(standards/parse.mjs);規則與說明屬政策,可整份替換。
// 【依據】
//   整合:只合併、不新增(via 必指回候選);單票之知識照收——三家聯集勝過單家,多出之知識正是這些單票者;
//   審計:只指出、不改稿;須附嚴重度(修訂之刪除只採信「高」嚴重度之離題／捏造,中嚴重度多落在範圍有爭議或應保留者);
//     以操作 id 定位(不以序號:修訂移除後序號位移);
//   修訂:只輸出補丁 {edits, adds, removes}(整份重寫會改壞既有內容);移除之限制寫明,程式另行強制。
// 【稱呼只有一種機制】ctx.kb 由 domain 之同名成員以其閉包之 kb 帶入(domain/extractDomain 之 withKb;呼叫端不給,與其他各步同一稱呼);
//   直接呼叫本檔之函數者須自給 ctx.kb。
// 【意見類型由常數產生】提示詞所列之意見類型(捏造、離題、重複、檢定標準)取 workflow/reviewGuards 之 ISSUE_TYPES——補丁守門以同一組字判讀,
//   不各寫一份字面。

import { ISSUE_TYPES } from '../workflow/reviewGuards.mjs'

/** 審計意見之類型(workflow/reviewGuards 之 ISSUE_TYPES;補丁守門與提示詞同一來源) */
const T = ISSUE_TYPES

const ops1 = (op) => {
    const o = {}
    for (const [k, v] of Object.entries(op || {})) if (!k.startsWith('_') || k === '_oid') o[k] = v
    return JSON.stringify(o)
}

/**
 * 整合提示詞:三份候選差量 → 一份差量(每條附 via)
 *
 * @param {Object} ctx 輸入 { kb, concept, rulesText, cands:[{ seat, ops, skipped }], votes:Map(_oid→{votes}), digestIndex(狀態索引文字), batchCodes:Array }
 * @returns {String} 回傳 prompt
 * @example
 * need test in nodejs.
 *
 * const prompt = buildIntegratePrompt({ kb: '知識庫', concept: '黑洞', rulesText, cands, votes, digestIndex, batchCodes })
 */
export function buildIntegratePrompt(ctx) {
    const lines = []
    for (const c of ctx.cands || []) {
        lines.push(`【候選 ${c.seat}】`)
        for (const op of c.ops) {
            const v = ctx.votes?.get?.(op._oid)
            const tags = [`${v?.votes || 1} 家支持`, op._trial ? `試套會被拒：${op._trial}` : '', op._suspectDup ? `疑與既有 ${op._suspectDup} 重複` : ''].filter(Boolean).join('｜')
            lines.push(`${op._oid}（${tags}）${ops1(op)}`)
        }
        if ((c.skipped || []).length) lines.push(`略過：${c.skipped.map((x) => `${x.note}（${x.reason}）`).join('、')}`)
    }
    return `你是${ctx.kb}的整合員。以下是三位提煉器各自獨立對「${ctx.concept}」提出之差量候選（每條操作有 id，如 a1_3），以及程式之試套與計票結果。請把它們整合成一份差量：

- 合併同義之操作（出處取聯集），只保留一條；相同既有條目上至多一個改狀態操作（revise／supersede／retract／contest／merge／split 擇一，取證據最充分者）。
- 只出現在一份候選、但有本批出處支持且不違反規則之知識，照收——不要因為只有一家提出就丟掉。
- 試套會被拒之操作：能修正就修正後收入（如補出處、改用既有編號），修不了就不收。
- 結論相反之候選操作不是二選一：依規則立爭議。
- 不可新增候選中沒有之操作、數字或結論；每條輸出之操作都要附 "via"：所依候選操作之 id 陣列（至少一個）。
- 保留之操作若以 "@名" 引用同一候選之新條目（ref），該新條目也要收入且 ref 不變——漏收則引用它之操作會被拒收。
- dispute_add 之 sides 是陣列、至少兩方，每方有 position，並有本批出處或所引主張。
- skipped：三份候選都略過、或確無可收知識之筆記才列入（放在 "skipped" 陣列，不是 ops 裡之操作）；被任一保留之操作引用之筆記不列。

【規則】（與提煉器相同；依優先序）
${ctx.rulesText || ''}

【輸出格式】只回覆一個 JSON 物件，不要任何其他文字：
{"ops":[{"op":"add","ref":"a1_a","kind":"…","text":"…","sources":["N1","N2"],"via":["a1_2","a3_1"]}],"skipped":[{"note":"N4","reason":"離題"}]}

【本批筆記代號】${(ctx.batchCodes || []).join('、') || '（無）'}

【目前核心狀態（索引）】
${ctx.digestIndex || '（尚無內容）'}

【候選】
${lines.join('\n')}`
}

/**
 * 審計提示詞:整合後之差量 → 問題清單(只指出、不改稿)
 *
 * @param {Object} ctx 輸入 { kb, concept, rulesText, ops:Array(帶 _oid、_votes、旗標), flags:Array(程式旗標文字), missing:Array(多數支持卻未收之候選操作), touched(被觸及之既有條目文字), batch:[{code,digest}], relations }
 * @returns {String} 回傳 prompt
 * @example
 * need test in nodejs.
 *
 * const prompt = buildAuditPrompt({ kb: '知識庫', concept: '黑洞', rulesText, ops, flags: [], missing: [], touched: '', batch })
 */
export function buildAuditPrompt(ctx) {
    const opsText = (ctx.ops || []).map((op) => `${op._oid}（${op._votes || 1} 家支持${op._suspectDup ? `｜疑與 ${op._suspectDup} 重複` : ''}）${ops1(op)}`).join('\n')
    const miss = (ctx.missing || []).map((op) => `${op._oid} ${ops1(op)}`).join('\n')
    return `你是${ctx.kb}的審計員。以下是對「${ctx.concept}」整合後之差量操作（每條有 id），以及本批筆記、被觸及之既有條目與程式旗標。請只找問題、不要改寫或重寫，逐條列出：

- 類型擇一：${T.fabricated}（材料沒有之數字或結論）、出處錯誤、依據與語氣不符（弱證據寫成定論、缺保留語氣）、${T.offTopic}、${T.duplicate}、假爭議（兩方回答不同問題或可同時成立）、爭議遺漏（結論相反卻未立爭議，含關聯脈絡標「衝突」者）、遺漏（筆記中值得收入卻沒收之知識，寫明筆記代號）、操作用錯（應 confirm 卻 add、應 supersede 卻 revise 等）、空話、其他。
- 嚴重度擇一：高（不改會留下錯誤知識或遺失知識）、中、低。「${T.offTopic}」只有整條與本概念無直接關係時才標高；範圍有爭議者標中。
- 以操作 id（如 a1_3）或既有條目編號（如 C12）定位，不要用序號；每條附具體改法（fix）。
- 意見要克制：沒有問題的操作不要列；不要為了湊數而列。

【規則】（與提煉器相同；依優先序）
${ctx.rulesText || ''}

【輸出格式】只回覆一個 JSON 物件，不要任何其他文字：
{"issues":[{"ref":"a1_3","severity":"高","type":"${T.fabricated}","detail":"…","fix":"…"}]}

【整合後之操作】
${opsText || '（無）'}

【多數候選支持、但未被整合收入之操作】（請判斷是否為遺漏）
${miss || '（無）'}

【程式旗標】
${(ctx.flags || []).join('\n') || '（無）'}

【被觸及之既有條目】
${ctx.touched || '（無）'}

【本批筆記】
${(ctx.batch || []).map((b) => b.digest).join('\n\n') || '（無）'}${ctx.relations ? `

【關聯脈絡】
${ctx.relations}` : ''}`
}

/**
 * 修訂提示詞:差量＋審計意見 → 補丁 {edits, adds, removes}
 *
 * @param {Object} ctx 輸入 { kb, concept, rulesText, ops, issues(正規化,帶 k), fixable:Object(FIXABLE_FIELDS), touched, batch }
 * @returns {String} 回傳 prompt
 * @example
 * need test in nodejs.
 *
 * const prompt = buildRevisePrompt({ kb: '知識庫', concept: '黑洞', rulesText, ops, issues, fixable: FIXABLE_FIELDS, touched: '', batch })
 */
export function buildRevisePrompt(ctx) {
    const opsText = (ctx.ops || []).map((op) => `${op._oid} ${ops1(op)}`).join('\n')
    const iss = (ctx.issues || []).map((x) => `[${x.k}] ${x.ref}｜${x.severity}｜${x.type}｜${x.detail}${x.fix ? `｜改法：${x.fix}` : ''}`).join('\n')
    const fixable = Object.entries(ctx.fixable || {}).map(([k, v]) => `${k}＝${v.filter((f) => f !== 'sources').join('、')}`).join('；')
    return `你是${ctx.kb}的修訂員。以下是「${ctx.concept}」之差量操作（每條有 id）與審計意見（每條有編號 [k]）。請逐條對照筆記核實意見：屬實者修正，不屬實者維持原狀、不要照改。只輸出「補丁」，程式會套回；未點名之操作逐字保留：

- edits：改正某操作之欄位 {"ref":"a1_3","fields":{…},"issue":k}——只可改該操作之可改欄位（${fixable}），不可改 op 與目標編號；改寫須保有原文主要內容（能修就不刪）。revise 操作要改其新內容時，fields 直接寫內容欄位（如 {"text":"…","conditions":["…"]}）。confirm 只能改出處、不能補文字——要為既有條目補內容，請用 adds 新增一條 revise 操作。
- removes：移除某操作 {"ref":"a1_3","issue":k,"reason":"…"}——新增類（add、confirm、param_add、dispute_add、contest 等）只能以「${T.duplicate}」或引用嚴重度「高」之「${T.offTopic}／${T.fabricated}」意見移除；「假爭議」不是移除理由（爭議只能以引用嚴重度「高」之「${T.offTopic}」意見移除；兩方非對立、對立只出自同一研究者由終審標為存疑，不移除）；中、低嚴重度請改用 edits 修正措辭。
- 類型為「${T.standard}」之意見由程式查出（數字不見於所引出處、缺標注、文字提及筆記、principle 只有單一文件等），每條附改法；定稿仍不合者該操作不採——請依改法修正。
- adds：補上遺漏之操作 {"op":{"op":"add",…完整操作…},"issue":k}——內層物件須含 "op" 欄位（add、revise、param_add、dispute_add…）；須對應某條審計意見，出處只能引本批代號。
- 不可加入材料沒有之數字或結論。

【規則】（與提煉器相同；依優先序）
${ctx.rulesText || ''}

【輸出格式】只回覆一個 JSON 物件，不要任何其他文字：
{"edits":[],"adds":[],"removes":[]}

【操作】
${opsText || '（無）'}

【審計意見】
${iss || '（無）'}

【被觸及之既有條目】
${ctx.touched || '（無）'}

【本批筆記】
${(ctx.batch || []).map((b) => b.digest).join('\n\n') || '（無）'}`
}

/**
 * 終審附錄(審計與修訂摘要,≤2,000 字):附於 domain.buildReviewPrompt 之後;附錄意見須自行對照筆記核實,不屬實者 keep
 *
 * @param {Object} ctx 輸入 { issues, patchLog }
 * @returns {String} 回傳附錄文字
 * @example
 * const text = buildAcceptAppendix({ issues: [{ ref: 'a1_0', severity: '高', type: '離題', detail: '與本概念無關', fix: '剔除' }], patchLog: [] })
 * console.log(typeof text, text.includes('離題'))
 * // => string true
 */
export function buildAcceptAppendix(ctx) {
    const iss = (ctx.issues || []).map((x) => `${x.ref}｜${x.severity}｜${x.type}｜${x.detail}`).join('\n')
    const log = (ctx.patchLog || []).filter((x) => x.ok).map((x) => `${x.act} ${x.ref || ''}：${x.why}`).join('\n')
    const text = `\n\n【附錄：審計意見與修訂紀錄】（僅供參考——意見須自行對照筆記核實，不屬實者一律 keep；新增類操作只能以「${T.duplicate}」或嚴重度「高」之「${T.offTopic}／${T.fabricated}」剔除）\n${iss || '（無審計意見）'}\n${log ? `修訂：\n${log}` : ''}`
    return text.length > 2000 ? `${text.slice(0, 1990)}…` : text
}

export default { buildIntegratePrompt, buildAuditPrompt, buildRevisePrompt, buildAcceptAppendix }
