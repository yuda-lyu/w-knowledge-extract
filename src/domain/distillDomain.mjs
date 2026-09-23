// distillDomain.mjs — 提煉的內建領域預設:各角色 prompt、稿件驗證、核心版型
//
// 角色鏈接線(宣告式 audit→revise→accept、自動編號、稿件/意見回推)與降級保底
// 在 stages/distillStage.mjs;本檔只有「知識庫的提煉要求長什麼樣」(領域中立,知識庫稱呼由 vocab.domain 注入)。
// 護欄措辭(「意見未涉及的內容不可刪除」)是實測教訓:審計曾刪過頭把真實爭議誤刪,
// 此護欄上線後未再發生。版型逐字保真(同 extractDomain 檔頭理由)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { readMd, section, dropSection } from '../md/md.mjs'
import { resolveVocab, kbLabelOf } from './vocabDefault.mjs'


/**
 * 核心知識之 JSON 輸出格式(提煉 prompt 與工作流 schema 共用)
 *
 * @type {String}
 */
export const CORE_SCHEMA = '{"essence":"...","principles":["..."],"rules":["..."],"parameters":[{"name":"","value":"","note":"出處篇名"}],"pitfalls":["..."],"disputes":["..."],"temporal":["..."],"open_questions":["..."],"related_concepts":["..."]}'


/**
 * 審計意見之結構驗證:須為物件且含 issues 陣列
 *
 * @param {*} d 輸入待驗證之資料
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkIssues({ issues: [] }), checkIssues({}))
 * // => true false
 */
export const checkIssues = (d) => !!d && typeof d === 'object' && Array.isArray(d.issues)


/**
 * 核心知識稿件之結構驗證:須為物件、essence 非空、principles 為非空陣列、rules 為陣列
 *
 * @param {*} data 輸入待驗證之稿件
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkCore({ essence: '本質', principles: ['原理'], rules: [] }))
 * // => true
 *
 * console.log(checkCore({ essence: '', principles: [] }))
 * // => false
 */
export function checkCore(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    if (!String(data.essence || '').trim()) return false
    if (!Array.isArray(data.principles) || data.principles.length === 0) return false
    if (!Array.isArray(data.rules)) return false
    return true
}


/**
 * 取筆記 md 正文(去掉關聯章節),作為提煉輸入;標注行讓模型能對證據強弱加權。
 * 只去「關聯」一章:其後的「⚠ 衝突與反例」章節保留——它正是 disputes 欄位的直接材料
 * (曾以「關聯章到檔尾」剝除,關聯在前的筆記其衝突章一併被剝掉,2026-09-06 實測 3823 篇)。
 *
 * @param {Object} note 輸入筆記記錄，需含 file、id、title，可含 claimType、evidenceLevel、samplePeriod、caveats、sourceName、sourceUrl
 * @returns {String} 回傳該筆記之摘要文字(正文限 1800 字)
 */
function noteDigest(note) {
    const md = readMd(note.file)
    const body = md ? dropSection(md.body, '關聯') : ''
    const caveats = (note.caveats || []).length ? `｜⚠ ${(note.caveats || []).join('/')}` : ''
    return [
        `### ${note.title}（slug: ${note.id}）`,
        `標注：${note.claimType || '未標注'}｜證據 ${note.evidenceLevel || '未評估'}｜樣本期 ${note.samplePeriod || '未載明'}${caveats}`,
        `來源：${note.sourceName}｜${note.sourceUrl}`,
        strTruncate(body.trim(), 1800),
    ].join('\n')
}


/**
 * 組提煉(起草)之基底 prompt:同概念(或類別)之多篇筆記 → 核心知識 JSON
 *
 * @param {String} concept 輸入概念(或類別)名稱字串
 * @param {Array} notes 輸入筆記記錄陣列(依新舊排序後之選用筆記)
 * @param {String} [coreBody=''] 輸入既有核心知識 md 本文，給定時要求在此基礎上深化，預設''代表首版
 * @param {String} [scope='concept'] 輸入選題層級字串，可選 'concept'、'category'，預設'concept'
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Integer} [opt.notesPerTarget=8] 輸入最多納入之筆記數，預設8
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件，取其 domain 作為知識庫稱呼，預設null代表不限主題
 * @returns {String} 回傳 prompt 字串
 */
export function buildDistillPrompt(concept, notes, coreBody, scope = 'concept', opt = {}) {

    //check
    if (!isarr(notes)) {
        notes = []
    }
    if (!isobj(opt)) {
        opt = {}
    }

    const kb = kbLabelOf(resolveVocab(opt.vocab))
    const scopeWord = scope === 'category' ? '類別' : '概念'
    const digests = notes.slice(0, opt.notesPerTarget ?? 8).map(noteDigest).join('\n\n')
    const prior = coreBody
        ? `\n\n【既有的核心知識（請在此基礎上深化與修正，不要推翻重寫；若新資料與既有內容衝突，請在 pitfalls 指出衝突點）】\n${strTruncate(coreBody, 2500)}`
        : ''

    return `你是${kb}的提煉器。以下是「${concept}」這個${scopeWord}底下的多篇知識筆記，請提煉出比單篇更核心、更可操作的知識。

要求：
1. 一律繁體中文，專有名詞保留英文於括號內。
2. 只根據提供的筆記內容提煉，不可加入筆記中沒有的數字、參數或研究結論。
3. essence：這個概念的本質是什麼、為什麼有效或為什麼失效，3 到 5 句。
4. principles：跨篇歸納出的原理層知識（不是單篇的摘要重述），每條一句。
5. rules：可直接應用的操作規則，寫成「若…則…」或明確步驟。
6. parameters：跨篇出現過的關鍵參數與其建議值或區間，須註明出處篇名。
7. pitfalls：實務上會踩的坑、失效條件。
8. **證據加權**：各筆記已標注內容類型與證據等級——證據「低」或帶 ⚠ 標注者，其結論只能以
   「有一說（證據弱）」的語氣呈現、不得寫成通則；「僅單一研究或未經獨立驗證」的參數須註明此限制。
9. **disputes（爭議與未定論）**：筆記之間結論相反或參數矛盾時，必須把兩方說法與各自的
   適用條件都寫出來（甲在 X 條件下主張…、乙在 Y 條件下主張…），不可擇一抹平、不可硬調和。
   沒有爭議就給空陣列，不要硬造。
10. **temporal（時效與條件相依）**：這個概念的有效性如何隨時間、環境條件或機制（regime）改變；
   利與弊在什麼條件下會反轉。原文有依據才寫。
11. open_questions：現有筆記還回答不了、值得日後再抓資料的問題。
12. related_concepts：與此概念關係緊密的其他概念名稱。

只回覆 JSON 物件，不要任何其他說明文字，格式：
${CORE_SCHEMA}
${prior}

【筆記內容】
${digests}`
}


/**
 * 組審計員 prompt:對照原始任務與筆記材料逐項挑錯
 *
 * @param {String} concept 輸入概念名稱字串
 * @param {Object} draft 輸入提煉稿(JSON 物件)
 * @param {String} basePrompt 輸入產生提煉稿所用之基底 prompt(含筆記材料)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件，取其 domain 作為知識庫稱呼，預設null代表不限主題
 * @returns {String} 回傳 prompt 字串
 */
export function buildAuditPrompt(concept, draft, basePrompt, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const kb = kbLabelOf(resolveVocab(opt.vocab))
    return `你是${kb}的審計員。以下是「${concept}」的提煉稿（JSON，由多份獨立提煉整合而成），以及產生它所用的原始任務與筆記材料。請對照原始筆記逐項挑錯，只挑真問題：①幻覺（筆記中沒有的數字、結論或比較被寫進稿中）；②證據加權錯誤（低證據／廠商內容被寫成通則、證據等級標錯）；③爭議遺漏（筆記間有矛盾但 disputes 未收）；④空話（無資訊量的填充句）；⑤出處錯誤（參數出處篇名張冠李戴）。

只回覆 JSON：{"issues":[{"severity":"高|中|低","type":"幻覺|證據加權|爭議遺漏|空話|出處錯誤","where":"欄位或條目","detail":"具體說明（引筆記為證）"}]}

【提煉稿】
${JSON.stringify(draft)}

【原始任務與筆記材料】
${basePrompt}`
}


/**
 * 組修訂者 prompt:逐條回應審計意見並修訂稿件
 *
 * @param {Object} draft 輸入提煉稿(JSON 物件)
 * @param {Array} issues 輸入審計意見陣列
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件，取其 domain 作為知識庫稱呼，預設null代表不限主題
 * @returns {String} 回傳 prompt 字串
 */
export function buildRevisePrompt(draft, issues, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const kb = kbLabelOf(resolveVocab(opt.vocab))
    return `你是${kb}的修訂者。以下是提煉稿與審計員意見，請逐條回應意見並修訂：屬實的修正、不屬實的維持。不可加入意見與稿件之外的新數字或新結論；意見未涉及的內容不可刪除。

只回覆修訂後的完整 JSON 物件（與原稿同格式），不要任何其他文字。

【提煉稿】
${JSON.stringify(draft)}

【審計意見】
${JSON.stringify(issues)}`
}


/**
 * 組終審者 prompt:確認高嚴重度意見已處理並定稿
 *
 * @param {Object} revised 輸入修訂稿(JSON 物件)
 * @param {Array} issues 輸入審計意見陣列
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件，取其 domain 作為知識庫稱呼，預設null代表不限主題
 * @returns {String} 回傳 prompt 字串
 */
export function buildFinalPrompt(revised, issues, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const kb = kbLabelOf(resolveVocab(opt.vocab))
    return `你是${kb}的終審者。以下是修訂稿與審計意見，請把關：確認高嚴重度意見都已被正確處理（未處理者代為修正），刪除仍存在的空話後定稿。不可加入新數字或新結論；意見未涉及的內容不可刪除。

只回覆定稿的完整 JSON 物件（與修訂稿同格式），不要任何其他文字。

【修訂稿】
${JSON.stringify(revised)}

【審計意見】
${JSON.stringify(issues)}`
}


/**
 * 由核心知識 JSON 組裝核心 md 本文(版型逐字保真)
 *
 * @param {String} concept 輸入概念名稱字串
 * @param {Object} k 輸入核心知識物件(checkCore 合格者)
 * @param {Array} notes 輸入提煉所依據之筆記記錄陣列(列於「提煉自」章節)
 * @returns {String} 回傳 md 本文字串(不含 frontmatter)
 * @example
 * let body = renderCoreBody('概念A', { essence: '本質', principles: ['原理'], rules: [] }, [{ id: 'n1', title: '筆記', sourceName: '來源' }])
 * console.log(body.split('\n')[0])
 * // => # 核心知識：概念A
 */
export function renderCoreBody(concept, k, notes) {

    //check
    if (!isobj(k)) {
        k = {}
    }
    if (!isarr(notes)) {
        notes = []
    }

    // 表格儲存格一律轉義 |(此前只轉義說明欄,名稱/值含 | 即撐破表格;2026-09-23 修)
    const cell = (v) => String(v || '').trim().replace(/\|/g, '／')
    const paramTable = Array.isArray(k.parameters) && k.parameters.length
        ? ['| 參數 | 值／區間 | 出處／說明 |', '| --- | --- | --- |',
            ...k.parameters.map((p) => `| ${cell(p?.name)} | ${cell(p?.value)} | ${cell(p?.note)} |`)].join('\n')
        : ''
    return [
        `# 核心知識：${concept}`,
        '',
        section('本質', k.essence),
        section('原理', k.principles),
        section('可操作規則', k.rules),
        paramTable ? `## 關鍵參數\n\n${paramTable}` : '',
        section('陷阱與失效條件', k.pitfalls),
        section('爭議與未定論', k.disputes),
        section('時效與機制相依', k.temporal),
        section('待解問題（供日後抓取）', k.open_questions),
        section('相關概念', k.related_concepts),
        section('提煉自', notes.map((n) => `[[${n.id}]] ${n.title}（${n.sourceName}）`)),
    ].filter(Boolean).join('\n\n')
}


/**
 * 建立提煉之內建領域預設(角色種類表＋基底 prompt＋驗證＋版型)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Integer} [opt.notesPerTarget=8] 輸入每概念最多納入之筆記數，預設8
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件，取其 domain 作為各角色 prompt 之知識庫稱呼，預設null代表不限主題
 * @returns {Object} 回傳 domain 物件，含 kinds(audit/revise/accept 之 { produces, check, build })、buildBasePrompt(t, used, priorBody)、checkCore、coreSchema、renderCore(t, data, used)
 * @example
 * let domain = createDistillDomain({ notesPerTarget: 8 })
 * console.log(Object.keys(domain.kinds))
 * // => [ 'audit', 'revise', 'accept' ]
 */
export function createDistillDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return {
        kinds: {
            audit: { produces: 'issues', check: checkIssues, build: ({ concept, basePrompt, draft }) => buildAuditPrompt(concept, draft, basePrompt, opt) },
            revise: { produces: 'draft', check: checkCore, build: ({ draft, issues }) => buildRevisePrompt(draft, issues, opt) },
            accept: { produces: 'draft', check: checkCore, build: ({ draft, issues }) => buildFinalPrompt(draft, issues, opt) },
        },
        buildBasePrompt: (t, used, priorBody) => buildDistillPrompt(t.concept, used, priorBody, t.scope || 'concept', opt),
        checkCore,
        coreSchema: CORE_SCHEMA,
        renderCore: (t, data, used) => ({
            front: { title: `核心知識：${t.concept}`, related_concepts: (data.related_concepts || []).map(String).slice(0, 8) },
            body: renderCoreBody(t.concept, data, used),
        }),
    }
}


export default createDistillDomain
