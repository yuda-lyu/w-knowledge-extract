// distillDomain.mjs — 提煉的內建領域預設(2.0):規則表、提案／審查／整併之提示詞、筆記分節摘要、核心 md 版型、舊版核心之封存匯入
//
// 【2.0 起模型只輸出差量】核心改為「主張庫(狀態)＋差量操作＋程式套用」(安裝方〈建議w-knowledge-extract優化〉,2026-09-29;
//   規劃與兩輪雙審見 tmp/wke-distill-b-全盤.md §11～§12)。本檔只有「提煉之要求長什麼樣」:
//   操作之合規、不變式、證據等級演算法、套用與落盤屬機制(stores/coreState、stores/evidence、stages/distillStage)。
// 【同一類規則只定義一次、注入各步】rules 為資料:提案、審查、整併之提示詞引用同一份規則文字(依優先序),
//   安裝方改一條即各步同步——安裝方 r3 之爭議流失即因規則分寫四處、改一處漏一處(建議檔:93)。
//   vocab.guide.distill 三欄(ruleTarget、weakEvidence、temporal)為其中兩條規則之領域句,安裝方既有 vocab 不需改。
// 【輸出格式段屬契約】「只回覆 JSON…」起之段落是機制解析所依賴者,不受 guide 影響;規則文字屬政策,可整份替換。
// 【版型】保留 1.x 之章名(本質、原理、可操作規則、關鍵參數、陷阱與失效條件、爭議與未定論、時效與機制相依、待解問題、
//   相關概念、提煉自),加主張編號、證據等級、出處與沿革;md 為狀態之純函數(時刻取自狀態),使投影重建逐字相同(手改偵測不誤報)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { sectionOf, dropSection } from '../md/md.mjs'
import { resolveVocab, kbLabelOf } from './vocabDefault.mjs'
import { DEFAULT_CLAIM_KINDS, DEFAULT_LIMITS, DROP_REASONS, NEW_ITEM_DROP_REASONS, DISPUTE_DROP_REASONS, DOUBT_REASONS, SKIP_REASONS, RETRACT_REASONS, FIXABLE_FIELDS } from '../stores/coreState.mjs'
import { makeEvidence, UNASSESSED } from '../stores/evidence.mjs'


/** 主張種類 → 核心 md 之章名(沿用 1.x 章名) */
export const KIND_LABELS = { principle: '原理', rule: '可操作規則', pitfall: '陷阱與失效條件', temporal: '時效與機制相依' }

/** 筆記分節摘要之章節與各節字數上限(章名同 extractDomain.renderNoteBody 與關聯段之衝突章) */
export const NOTE_SECTIONS = [
    ['一句話重點', 150],
    ['核心知識', 500],
    ['關鍵參數', 250],
    ['方法與步驟', 200],
    ['適用條件與限制', 200],
    ['利弊與取捨', 250],
    ['時效與機制相依', 200],
    ['爭議與反方觀點', 250],
    ['⚠ 衝突與反例', 350],
]


/**
 * 預設規則表(資料):{ id, text, priority }——數字小者優先;提案、審查、整併共用同一份
 *
 * @param {Object} vocab 輸入 resolveVocab 之產物(取 guide.distill)
 * @param {Object} limits 輸入長度上限
 * @returns {Array} 回傳規則陣列(依 priority 升冪)
 */
export function defaultRules(vocab, limits) {
    const g = vocab.guide.distill
    const L = { ...DEFAULT_LIMITS, ...(isobj(limits) ? limits : {}) }
    // 證據性質之選項＝basisCaps 之鍵(程式據以封頂;單一來源,安裝方改表即改提示詞)
    const bases = Object.keys(isobj(vocab.basisCaps) ? vocab.basisCaps : {}).filter((k) => k !== '*')
    return [
        { id: 'offtopic', priority: 1, text: '只收與本概念直接相關之知識；離題之筆記列入 skipped（理由「離題」），離題之主張不得藉爭議或任何條目保留（本條優先於爭議規則）。' },
        { id: 'source', priority: 2, text: '只根據本批筆記與既有條目，不可加入筆記中沒有之數字、參數或結論；每條新增或修改皆須引本批代號為出處。' },
        { id: 'confirm', priority: 3, text: '新筆記支持既有條目時一律 confirm 以累積出處，不另立同義條目；每一篇筆記都要交代去向（被引為出處，或列入 skipped 並寫理由）。' },
        { id: 'dispute', priority: 4, text: '此概念之核心問題上，凡結論相反者皆立爭議（弱方照列並寫明各自之適用條件），不可擇一抹平、不可硬調和，也不可把對立藏進 cons 或待解問題；只排除同一篇內之正反。兩方並非對立者（依下一條之界線）不是爭議，既有者以 dispute_dissolve 拆解（內容全留）。' },
        // 「非對立」之唯一定義(提案之拆解說明、審查、整併皆引用此條,不各寫一份——r3 爭議流失即因規則分寫多處);
        //   界線句經安裝方以真實筆記驗證(預設審查席之同系模型:無此句 2／9、有此句 6／6 保留真爭議),去領域化並補演進之切分
        //   (「時期不同」原句會把時間演進判成爭議,與 evolution 條衝突——2026-09-29 三獨立審 A／B)。獨立成條,使用方可單獨替換
        { id: 'disputeBoundary', priority: 5, text: '【非對立之界線】只有兩方回答的是不同問題、或兩方結論可同時成立（例如一方說效果減弱、一方說仍然存在）時，才算非對立。兩方證據性質不同（理論對實證、實證對實務）、對象、情境或樣本不同、適用條件不同，而就同一問題結論方向相反者，仍是爭議——立爭議並寫明各方之適用條件，不可判為非對立。同一對象之結論隨時期改變（較早期間成立、其後之新證據顯示不再成立）屬演進，依演進規則以 supersede 處理；兩方就重疊之期間結論相反者，才是爭議。' },
        // 待解問題(2.0 起恢復 1.x 之語意,排在爭議之後——2026-09-29 待決事項 D2:未設此條時真實模型 4 批皆 0 題)
        { id: 'question', priority: 6, text: '本批筆記指出、而現有材料回答不了且值得日後補證據之具體問題，以 question_add 列為待解問題（引出處）；已有相反結論者依爭議規則立爭議，不可改列為問題；新筆記回答了既有問題時以 question_resolve 結案。' },
        { id: 'kind', priority: 7, text: `主張分四種：principle＝跨篇歸納之原理（不是單篇摘要之重述）；rule＝${g.ruleTarget}，寫成「若…則…」或明確步驟；pitfall＝實務上會踩的坑與失效條件；temporal＝${g.temporal}` },
        { id: 'evidence', priority: 8, text: `不要寫證據等級（由程式依出處與證據性質判定）；${bases.length ? `basis 寫證據性質，擇自（可並列）：${bases.join('、')}；` : '在 basis 寫證據性質；'}限制（如單一研究、未經獨立驗證）照實寫在 conditions 或 critique；語氣須與證據相稱，不用絕對語氣；「${g.weakEvidence}」的參數須在 conditions 註明此限制。` },
        { id: 'evolution', priority: 9, text: '新證據使舊觀點過時或被推翻時用 supersede，validPeriod 寫舊觀點成立之期間：有年代者照列；年份不詳但材料明示先後者寫「較早之研究」或「較新之研究」；不得憑常識補歷史。' },
        { id: 'scope', priority: 10, text: '單一產品、單一事件或單篇敘事不寫成通則，併入 critique 或 pitfall。' },
        { id: 'length', priority: 11, text: `篇幅：text ≤${L.text} 字；conditions、pros、cons 每項 ≤${L.conditions} 字；critique ≤${L.critique} 字；本質 ≤${L.essence} 字；精簡而不刪對立。` },
        { id: 'ref', priority: 12, text: '文字中提到其他條目時寫〔C12〕格式（只可寫已存在之編號；同一差量內之新條目寫〔@ref名〕，由程式換成實際編號）；同一差量內之新條目以 ref 命名、他處以 "@ref名" 引用。本批代號（N1…）只用於 sources，文字中提及筆記請寫其論點（殘留之代號由程式換成筆記連結）。' },
        { id: 'essence', priority: 13, text: '本質（essence）須綜合所引之主張（claims），不可擇一抹平爭議——有爭議者在文字中並陳兩方，claims 只列主張（不列爭議）。' },
    ]
}

/**
 * 核心差量之格式說明(提案用;契約段)
 *
 * @param {Array} kinds 輸入主張種類
 * @returns {String} 回傳操作說明文字
 */
function proposeOpsText(kinds) {
    return [
        '【操作】（每條為一個 JSON 物件；出處一律寫本批代號，如 "sources":["N1","N3"]；既有條目以〔〕內編號指稱，如 "id":"C12"；同一差量內之新條目以 "ref" 命名、他處以 "@ref名" 引用）',
        `- add 新增主張：{"op":"add","ref":"a","kind":"${kinds.join('|')}","facet":"面向（選填）","text":"…","conditions":["…"],"pros":["…"],"cons":["…"],"period":"適用期間（選填）","critique":"銳評（選填）","basis":"證據性質","sources":["N1"]}`,
        '- confirm 新筆記支持既有條目（主張 C、參數 P、爭議 D；爭議可加 "side":k 指明一方，k 即狀態摘要中該方之 side k）：{"op":"confirm","id":"C3","sources":["N2"]}',
        '- revise 修正既有主張或參數之文字：{"op":"revise","id":"C3","fields":{"text":"…"},"reason":"…","sources":["N2"]}',
        '- supersede 新證據使舊條目過時或被推翻：{"op":"supersede","id":"C3","by":"@a 或 C9（選填）","reason":"…","validPeriod":"舊觀點成立期間","sources":["N2"]}',
        `- retract 撤回既有條目：{"op":"retract","id":"C5","reason":"${RETRACT_REASONS.join('|')}","into":"C2（理由為「重複」時必填）"}`,
        '- dispute_add 結論相反者立爭議（每方須有本批出處或所引既有主張；各方出處不可只有同一篇）：{"op":"dispute_add","ref":"d","question":"…","sides":[{"position":"…","conditions":["…"],"claims":["C1"]},{"position":"…","claims":["@a"],"sources":["N3"]}]}',
        '- dispute_update 爭議之補充或解決：{"op":"dispute_update","id":"D2","note":"…","status":"open|resolved（選填）","sides_add":[…],"sources":["N4"]}',
        '- contest 把既有主張列入某爭議之一方（side 即狀態摘要中該方之 side k；新立之爭議依 sides 之順序自 0 起）：{"op":"contest","id":"C3","dispute":"D2 或 @d","side":0,"reason":"…","sources":["N1"]}',
        `- dispute_dissolve 拆解非對立之爭議（依規則表之爭議規則與「非對立之界線」判定；內容與出處全留，只拿掉對立標籤；reason 須寫明兩方各回答什麼問題、或為何可同時成立——標有「審查存疑」者請獨立判斷，不可只引述存疑；只有立場文字之方由程式轉為主張，kinds[k] 為 side k 轉出主張之種類，引主張之方填 null，選填）：{"op":"dispute_dissolve","id":"D2","reason":"…","kinds":[null,"${kinds[0]}"]}`,
        '- param_add 關鍵參數：{"op":"param_add","name":"…","value":"值或區間","conditions":"…","period":"…","snapshot":false,"claim":"C3 或 @a（選填）","sources":["N2"]}',
        '- question_add／question_resolve 待解問題：{"op":"question_add","text":"…","sources":["N1"]}、{"op":"question_resolve","id":"Q1","resolution":"…","sources":["N2"]}',
        '- essence 本質（claims 只列所依之主張，不列爭議）：{"op":"essence","text":"…","claims":["C1","@a"],"reason":"…"}',
        '- related_add 相關概念：{"op":"related_add","concepts":["…"]}',
    ].join('\n')
}

/**
 * 核心 md 之標題降級(封存區用):去掉 H1,其餘降兩級(封存區內不留 H2,以 H2 為界之切章不會把它切開)
 *
 * @param {String} body 輸入舊 md 本文
 * @returns {String} 回傳處理後本文
 */
function demote(body) {
    return String(body || '')
        .split(/\r?\n/)
        .filter((l) => !/^#\s/.test(l))
        .map((l) => (/^#{2,4}\s/.test(l) ? `##${l}` : l))
        .join('\n')
        .trim()
}


/**
 * 建立提煉之內建領域預設
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(見 resolveVocab)，取其 kbLabel／domain 作為知識庫稱呼、guide.distill 作為規則之領域句、
 *   evidenceLevels／evidenceCaps／basisCaps／selfLimitPhrases 作為證據判定、absolutePhrases 作為絕對語氣指標
 * @param {Object} [opt.limits] 輸入長度上限覆寫(逐鍵)
 * @returns {Object} 回傳 domain 物件，含 claimKinds、kindLabels、limits、rules、evidence、toneOf、noteDigest、
 *   buildProposePrompt、buildReviewPrompt、buildConsolidatePrompt、checkDeltaExtra、renderState、importLegacy
 * @throws {Error} opt.vocab 之 kbLabel、guide、evidenceCaps、basisCaps、selfLimitPhrases 或 absolutePhrases 不合規格時拋出(見 resolveVocab)
 * @example
 * const d = createDistillDomain({})
 * console.log(d.claimKinds)
 * // => [ 'principle', 'rule', 'pitfall', 'temporal' ]
 */
export function createDistillDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveVocab(opt.vocab)
    const kb = kbLabelOf(vocab)
    const limits = { ...DEFAULT_LIMITS, ...(isobj(opt.limits) ? opt.limits : {}) }
    const claimKinds = [...DEFAULT_CLAIM_KINDS]
    const levels = isarr(vocab.evidenceLevels) ? vocab.evidenceLevels : []
    const lowest = levels[levels.length - 1]
    const scopeWord = (scope) => (scope === 'category' ? '類別' : '概念')
    const absolutes = (isarr(vocab.absolutePhrases) ? vocab.absolutePhrases : []).map(String).filter(Boolean)

    /**
     * 絕對語氣指標(只計數不擋;安裝方驗收 §3 #4——否定句會誤判,故不做硬擋):文字中第一個非否定之絕對語氣片語
     * 片語之前兩字含「不未非無」或為「難以」者視為否定(如「不一定會」「並非總是」「難以保證會」)
     *
     * @param {String} text 輸入文字
     * @returns {String} 回傳命中之片語，無則空字串
     */
    function toneOf(text) {
        const t = String(text || '')
        for (const p of absolutes) {
            for (let i = t.indexOf(p); i >= 0; i = t.indexOf(p, i + 1)) {
                const prev = t.slice(Math.max(0, i - 2), i)
                if (!/[不未非無]/.test(prev) && prev !== '難以') return p
            }
        }
        return ''
    }

    /**
     * 筆記分節摘要:依章名取各節並限長(衝突章不再因位於文末而被截掉);列出 frontmatter conflicts;
     * 找不到任何已知章節(自訂筆記版型)→ 退回截斷正文(sectioned:false,由機制記 WARN)
     *
     * @param {Object} note 輸入筆記記錄
     * @param {Object|null} md 輸入 readMd 之產物(讀不到為 null)
     * @param {Object} [ctx={}] 輸入 { code:'N1', codeOf:(id)=>代號或'', titleOf:(id)=>標題 }
     * @returns {Object} 回傳 { text, sectioned }
     */
    function noteDigest(note, md, ctx = {}) {
        const head = [
            `### ${ctx.code || ''} ${note?.title || ''}`,
            `標注：${note?.claimType || '未標注'}｜證據 ${note?.evidenceLevel || '未評估'}｜樣本期 ${note?.samplePeriod || '未載明'}${(note?.caveats || []).length ? `｜⚠ ${note.caveats.join('/')}` : ''}`,
            `來源：${note?.sourceName || ''}｜發布：${md?.front?.published || note?.published || '（未提供）'}`,
        ]
        const body = md ? dropSection(md.body, '關聯') : ''
        const parts = []
        for (const [title, max] of NOTE_SECTIONS) {
            const sec = sectionOf(body, title)
            if (!sec) continue
            const text = sec.text.replace(/^## [^\n]*\n/, '').trim()
            if (text) parts.push(`【${title}】\n${strTruncate(text, max)}`)
        }
        const conflicts = isarr(md?.front?.conflicts) ? md.front.conflicts.map(String) : []
        if (conflicts.length) {
            const who = conflicts.map((id) => {
                const c = typeof ctx.codeOf === 'function' ? ctx.codeOf(id) : ''
                return c ? `${c}（同批）` : `〈${(typeof ctx.titleOf === 'function' && ctx.titleOf(id)) || id}〉（非本批）`
            })
            parts.push(`衝突對象：${who.join('、')}`)
        }
        if (!parts.length || (parts.length === 1 && conflicts.length)) {
            return { text: [...head, strTruncate(body.trim(), 1800)].join('\n'), sectioned: false }
        }
        return { text: [...head, ...parts].join('\n'), sectioned: true }
    }

    /**
     * 提案提示詞:目前狀態＋本批筆記 → 差量
     *
     * @param {Object} ctx 輸入 { concept, scope, digest(stateDigest 之文字), batch:[{ code, digest }], rulesText }
     * @returns {String} 回傳 prompt 字串
     */
    function buildProposePrompt(ctx) {
        const batch = isarr(ctx?.batch) ? ctx.batch : []
        return `你是${kb}的提煉器。以下是「${ctx?.concept}」這個${scopeWord(ctx?.scope)}目前之核心知識狀態，以及本批 ${batch.length} 篇尚未提煉之筆記（代號 N1～N${batch.length}）。請只輸出「差量操作」，把本批筆記之知識併入核心；程式會逐條套用並檢查，不合規者拒收。

【規則】（依優先序；衝突時以前者為準）
${ctx?.rulesText || ''}

${proposeOpsText(claimKinds)}

【本批筆記之去向】每一篇都要交代：被某操作引為出處（支持既有條目者一律 confirm），或列入 skipped 並寫理由（${SKIP_REASONS.join('｜')}）。

【輸出格式】只回覆一個 JSON 物件，不要任何其他文字：
{"ops":[…],"skipped":[{"note":"N3","reason":"${SKIP_REASONS[0]}"}]}

【目前核心狀態】
${ctx?.digest || '（尚無內容）'}

【本批筆記】
${batch.map((b) => b.digest).join('\n\n')}`
    }

    /**
     * 審查提示詞:逐操作裁決(keep／drop／doubt／fix);不得新增操作、fix 不得增加出處;剔除只用於內容不成立者,標籤錯誤以 fix 改正
     *
     * @param {Object} ctx 輸入 { concept, scope, mode:'delta'|'pending'|'consolidate', ops:Array, batch:[{ code, digest }], touched(被觸及之既有條目摘要), rulesText, pending(舊參數:同 mode==='pending') }
     * @returns {String} 回傳 prompt 字串
     */
    function buildReviewPrompt(ctx) {
        const ops = isarr(ctx?.ops) ? ctx.ops : []
        const batch = isarr(ctx?.batch) ? ctx.batch : []
        const mode = ctx?.mode || (ctx?.pending ? 'pending' : 'delta')
        // fix 可改之欄位:只列本批出現之操作,取自程式之 FIXABLE_FIELDS(提示詞與程式同一來源;1.0.5 只寫「修正文字欄位」,
        //   審查不知 kind／basis 可改,遂以「性質標錯」整條剔除——安裝方正式環境實測,2026-10-01)
        const fixable = [...new Set(ops.map((o) => o?.op))].filter((k) => FIXABLE_FIELDS[k]).map((k) => `${k}＝${FIXABLE_FIELDS[k].join('、')}`)
        const kindEx = claimKinds[Math.min(2, claimKinds.length - 1)]
        const lead = {
            pending: `以下是「${ctx?.concept}」前次未經審查而暫緩之取代／撤回操作（逐條編號 i），以及其所引之筆記與被觸及之既有條目。`,
            consolidate: `以下是整併員對「${ctx?.concept}」提出之整併操作（逐條編號 i）與被觸及之既有條目；整併不處理筆記、不新增知識——請確認被合併者確為同義或重複、精簡後未改原意。`,
        }[mode] || `以下是提煉器對「${ctx?.concept}」提出之差量操作（逐條編號 i），以及本批筆記與被觸及之既有條目。`
        return `你是${kb}的審查員。${lead}請逐條裁決：
- keep：保留；
- drop：剔除——只用於內容不成立者，reason 擇一：${DROP_REASONS.join('｜')}（「性質標錯」指操作類別用錯，如應立爭議卻寫成取代或待解問題；新增主張 add、參數 param_add 只能以「${NEW_ITEM_DROP_REASONS.join('」「')}」剔除——其種類、證據性質、快照標錯者請以 fix 改正，不可剔除；爭議類操作 dispute_add、dispute_update、contest 只能以「${DISPUTE_DROP_REASONS.join('」或「')}」剔除——不可把真實之對立藏掉；拆解 dispute_dissolve 若對立其實成立，以「對立成立」剔除）；
- doubt：只用於爭議類操作——你依規則表「非對立之界線」認為兩方並非對立時用之，reason 寫「${DOUBT_REASONS[0]}」，note 寫明兩方各回答什麼問題、或為何可同時成立；程式照常套用該操作，並在爭議上標示審查存疑，不會移除（拆解另由提煉器提出）；
- fix：以 fields 改正欄位（只寫要改之欄位與其新值），不可新增出處（sources 只可刪減）${fixable.length ? `；本次各操作可改之欄位：${fixable.join('；')}` : ''}；例：{"i":3,"action":"fix","fields":{"kind":"${kindEx}"},"note":"…"}。
各裁決可附 note（一句說明，≤120 字）；drop 與 doubt 請務必附。爭議各方以 side k 標示，k 即操作之 "side" 值（自 0 起）。
被其他操作以 "@ref名" 引用之新項若剔除，引用它之操作會一併不成立（連帶拒收）——內容可用而標籤或措辭有誤者，請以 fix 改正，不要剔除。
取代（supersede）、撤回（retract）、合併（merge）、拆解（dispute_dissolve）不可逆，須逐條明列裁決；未列出者視為未審、本次不套用。其餘操作未列出者視為 keep。不得新增操作，不要重寫整份核心。

【規則】（與提煉器相同；依優先序）
${ctx?.rulesText || ''}

【輸出格式】只回覆一個 JSON 物件，不要任何其他文字：
{"verdicts":[{"i":0,"action":"keep","reason":"","note":""}]}

【操作】
${ops.map((o, i) => `i=${i} ${JSON.stringify(o)}`).join('\n')}

【被觸及之既有條目】
${ctx?.touched || '（無）'}

【筆記】
${batch.map((b) => b.digest).join('\n\n') || '（無）'}`
    }

    /**
     * 整併提示詞:有效主張逾上限時合併重複、重排面向、精簡措辭;不處理筆記、不新增知識
     *
     * @param {Object} ctx 輸入 { concept, scope, digest(完整摘要), live(有效主張數), cap, rulesText }
     * @returns {String} 回傳 prompt 字串
     */
    function buildConsolidatePrompt(ctx) {
        return `你是${kb}的整併員。「${ctx?.concept}」這個${scopeWord(ctx?.scope)}之核心已累積 ${ctx?.live ?? '?'} 條有效主張（上限 ${ctx?.cap ?? '?'}），請整併以控制篇幅，不新增知識、不處理筆記：
- merge 合併同義或重複之主張／參數／待解問題：{"op":"merge","into":"C3","from":["C7","C9"],"reason":"…","text":"合併後文字（選填）"}（出處由程式取聯集；不可刪除有效主張之知識）
- refacet 面向改名或合併：{"op":"refacet","from":"舊面向","to":"新面向"}
- revise 精簡措辭（不改原意）：{"op":"revise","id":"C3","fields":{"text":"…"},"reason":"…"}
- essence 重寫本質（claims 只列主張，不列爭議）：{"op":"essence","text":"…","claims":["C1","C4"],"reason":"…"}
- related_prune 移除不相干之相關概念：{"op":"related_prune","concepts":["…"]}
- dispute_dissolve 拆解非對立之爭議（依規則表之爭議規則與「非對立之界線」判定；reason 寫明兩方各回答什麼問題、或為何可同時成立——標有「審查存疑」者請獨立判斷，不可只引述存疑）：{"op":"dispute_dissolve","id":"D2","reason":"…"}（爭議轉入沿革；只有立場文字之方由程式轉為主張，內容與出處全留）
爭議之各方不可合併成一方；有爭議之主張不可與其對立方合併；真實之對立不可拆解。

【規則】（依優先序）
${ctx?.rulesText || ''}

【輸出格式】只回覆一個 JSON 物件，不要任何其他文字：
{"ops":[…]}

【目前核心狀態（完整）】
${ctx?.digest || '（尚無內容）'}`
    }

    /**
     * 自狀態渲染核心 md(純函數:時刻取自狀態,同一狀態渲染逐字相同)
     *
     * @param {Object} state 輸入核心狀態
     * @param {Object} [ctx={}] 輸入 { notesById:Map(筆記 id → 記錄,供「提煉自」之標題與來源) }
     * @returns {Object} 回傳 { front, body }
     */
    function renderState(state, ctx = {}) {
        const s = state || {}
        const notesById = ctx.notesById instanceof Map ? ctx.notesById : new Map()
        const TERM = new Set(['superseded', 'retracted'])
        const live = (s.claims || []).filter((c) => !TERM.has(c.status))
        const lv = (x) => x?.evidence?.level || UNASSESSED
        const prefix = (c) => (lv(c) === lowest ? '有一說：' : '')
        const src = (ids) => {
            const list = (ids || []).slice(0, 3).map((id) => `[[${id}]]`)
            return list.length ? `${list.join('、')}${(ids || []).length > 3 ? ` 等 ${ids.length} 篇` : ''}` : '（無）'
        }
        const claimLine = (c) => {
            const meta = [lv(c) === UNASSESSED ? '證據未評估' : `證據${lv(c)}`, c.status === 'contested' ? '有爭議' : ''].filter(Boolean).join('｜')
            const lines = [`- 〔${c.id}〕${prefix(c)}${c.text}（${meta}）`]
            if ((c.conditions || []).length) lines.push(`  - 條件：${c.conditions.join('；')}`)
            if ((c.pros || []).length) lines.push(`  - 利：${c.pros.join('；')}`)
            if ((c.cons || []).length) lines.push(`  - 弊：${c.cons.join('；')}`)
            if (c.period) lines.push(`  - 期間：${c.period}`)
            if (c.critique) lines.push(`  - 銳評：${c.critique}`)
            lines.push(`  - 出處：${src(c.sources)}`)
            return lines.join('\n')
        }
        const kindSection = (kind) => {
            const list = live.filter((c) => c.kind === kind)
            if (!list.length) return ''
            const facets = [...new Set(list.map((c) => c.facet || ''))]
            const out = [`## ${KIND_LABELS[kind] || kind}`, '']
            for (const f of facets) {
                if (f) out.push(`### ${f}`, '')
                out.push(list.filter((c) => (c.facet || '') === f).map(claimLine).join('\n'), '')
            }
            return out.join('\n').trim()
        }
        const cell = (v) => String(v ?? '').trim().replace(/\|/g, '／')
        const params = (s.parameters || []).filter((p) => !TERM.has(p.status))
        const paramTable = params.length
            ? ['## 關鍵參數', '', '| 編號 | 參數 | 值／區間 | 條件 | 期間 | 證據 | 出處 |', '| --- | --- | --- | --- | --- | --- | --- |',
                ...params.map((p) => `| ${p.id} | ${cell(p.name)} | ${cell(p.value)}${p.snapshot ? '（時點值）' : ''} | ${cell(p.conditions)} | ${cell(p.period)} | ${cell(lv(p))} | ${cell(src(p.sources))} |`)].join('\n')
            : ''
        const disputes = (s.disputes || []).filter((d) => d.status !== 'retracted')
        // 各方之出處＝直接出處 ∪ 所引主張之出處:只引既有主張之一方(合法之跨批爭議)此前顯示「出處：（無）」(判識 C 重現;安裝方驗收 §3 #2)
        const claimSrc = new Map((s.claims || []).map((c) => [c.id, c.sources || []]))
        const sideSrc = (sd) => [...new Set([...(sd.sources || []), ...(sd.claims || []).flatMap((cid) => claimSrc.get(cid) || [])])]
        const disputeSec = disputes.length
            ? ['## 爭議與未定論', '', ...disputes.map((d) => [
                `- 〔${d.id}〕${d.question}（${d.status === 'resolved' ? '已解決' : '未解決'}）`,
                ...(d.sides || []).map((sd, k) => `  - 第${k + 1}方：${sd.position}${(sd.conditions || []).length ? `（條件：${sd.conditions.join('；')}）` : ''}｜證據${sd.evidence?.level || UNASSESSED}${(sd.claims || []).length ? `｜依〔${sd.claims.join('〕〔')}〕` : ''}｜出處：${src(sideSrc(sd))}`),
                ...(d.note ? [`  - 註：${d.note}`] : []),
                // 審查存疑(未解決者常駐):審查認為兩方可能非對立而未移除,待提煉或整併以拆解處理或維持
                ...(d.status === 'open' && isobj(d.doubt) ? [`  - 審查存疑（v${d.doubt.version}${d.doubt.count > 1 ? `，累計 ${d.doubt.count} 次` : ''}；${d.doubt.reason}）：${d.doubt.note}`] : []),
            ].join('\n'))].join('\n')
            : ''
        const qs = (s.questions || []).filter((q) => q.status === 'open')
        const gone = [...(s.claims || []), ...(s.parameters || []), ...(s.disputes || []), ...(s.questions || [])].filter((x) => TERM.has(x.status))
        // 拆解之爭議(非對立):各方之內容在主張裡,列出主張編號供追溯
        const dissolvedLine = (x) => `- 〔${x.id}〕已拆解（非對立：${x.statusNote || ''}；各方見〔${[...new Set((x.sides || []).flatMap((sd) => sd.claims || []))].join('〕〔')}〕）：${x.question || ''}`
        const PENDING_VERB = { retract: '撤回', supersede: '取代', merge: '合併', dispute_dissolve: '拆解' }
        const history = [
            ...gone.map((x) => (x.status === 'retracted'
                ? (x.retractReason === '非對立' && isarr(x.sides) ? dissolvedLine(x) : `- 〔${x.id}〕已撤回（${x.retractReason}${x.mergedInto ? `，併入〔${x.mergedInto}〕` : ''}）：${x.text || x.name || x.question || ''}`)
                : `- 〔${x.id}〕已取代${x.supersededBy ? `（由〔${x.supersededBy}〕）` : ''}：${x.text || x.name || ''}｜理由：${x.statusNote || ''}${x.validPeriod ? `｜舊觀點成立期間：${x.validPeriod}` : ''}`)),
            // 已結案之待解問題亦留痕:文字中之〔Q〕引用在本文可找到(安裝方驗收 §3 #6 懸空 0),答案與出處不隨結案消失
            ...(s.questions || []).filter((q) => q.status === 'resolved').map((q) => `- 〔${q.id}〕已結案：${q.text}｜${q.resolution || ''}`),
            ...(s.pendingReview || []).map((e) => `- 待審：〔${e.op.id || e.op.into}〕擬${PENDING_VERB[e.op.op] || e.op.op}${e.op.by ? `（由〔${e.op.by}〕）` : ''}：${e.op.reason || ''}`),
            ...(s.essenceHistory || []).map((e) => `- 舊本質（v${e.version}）：${e.text}`),
        ]
        const used = [...new Set([...(s.claims || []), ...(s.parameters || []), ...(s.disputes || []), ...(s.questions || [])]
            .filter((x) => !TERM.has(x.status)).flatMap((x) => x.sources || []))]
        const usedLines = used.slice(0, 30).map((id) => {
            const n = notesById.get(id)
            return `- [[${id}]]${n ? ` ${n.title}（${n.sourceName}）` : ''}`
        })
        const essence = s.essence?.text
            ? `${s.essence.text}${(s.essence.claims || []).length ? `（依〔${s.essence.claims.join('〕〔')}〕）` : ''}`
            : (s.legacy?.essence ? `（舊版，未逐條出處）${s.legacy.essence}` : '（尚未歸納）')
        const contested = live.filter((c) => c.status === 'contested').length
        const body = [
            `# 核心知識：${s.concept}`,
            '',
            `> v${s.version}｜有效主張 ${live.length} 條（有爭議 ${contested}）｜依據 ${used.length} 篇｜更新 ${s.updatedAt || '—'}`,
            '',
            `## 本質\n\n${essence}`,
            kindSection('principle'),
            kindSection('rule'),
            paramTable,
            kindSection('pitfall'),
            disputeSec,
            kindSection('temporal'),
            ...claimKinds.filter((k) => !KIND_LABELS[k]).map(kindSection),
            // 章名 2.0 起去掉 1.x 之「（供日後抓取）」:套件沒有任何機制把待解問題送去抓取,不留未兌現之承諾(2026-09-29 待決事項 D2)
            qs.length ? ['## 待解問題', '', ...qs.map((q) => `- 〔${q.id}〕${q.text}`)].join('\n') : '',
            (s.related || []).length ? ['## 相關概念', '', ...s.related.map((r) => `- ${r}`)].join('\n') : '',
            history.length ? ['## 沿革', '', ...history].join('\n') : '',
            used.length ? ['## 提煉自', '', ...usedLines, ...(used.length > 30 ? [`- …共 ${used.length} 篇（完整清單在核心狀態檔）`] : [])].join('\n') : '',
            s.legacy?.body ? ['## 舊版內容（升版前之核心，未逐條出處，僅供參考）', '', '<details><summary>展開</summary>', '', s.legacy.body, '', '</details>'].join('\n') : '',
        ].filter(Boolean).join('\n\n')
        return { front: { title: `核心知識：${s.concept}`, related_concepts: (s.related || []).slice(0, 8) }, body }
    }

    /**
     * 升版前(1.0.3 版型)之核心 md → 封存(不轉主張):去 H1、去「提煉自」、標題降兩級;另取舊本質供索引於新本質產生前顯示
     *
     * @param {Object} o 輸入 { body:舊 md 本文 }
     * @returns {Object} 回傳 { body:封存本文, essence:舊本質文字(無則'') }
     */
    function importLegacy(o) {
        const raw = String(o?.body || '')
        const ess = sectionOf(raw, '本質')
        const essence = ess ? ess.text.replace(/^## [^\n]*\n/, '').trim().replace(/\s+/g, ' ') : ''
        return { body: demote(dropSection(raw, '提煉自')), essence }
    }

    return {
        claimKinds,
        kindLabels: { ...KIND_LABELS },
        limits,
        rules: defaultRules(vocab, limits),
        evidence: makeEvidence({ levels, caps: vocab.evidenceCaps, basisCaps: vocab.basisCaps, selfLimit: vocab.selfLimitPhrases }),
        toneOf,
        noteDigest,
        buildProposePrompt,
        buildReviewPrompt,
        buildConsolidatePrompt,
        checkDeltaExtra: () => true,
        renderState,
        importLegacy,
    }
}


export default createDistillDomain
