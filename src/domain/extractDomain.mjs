// extractDomain.mjs — 彙整(萃取)的內建領域預設:prompt、驗證、品質標注、筆記版型
//
// 【套件開發者擁有、隨版本演進】萃取指令/欄位 schema/md 版型是內建能力(領域中立);安裝方經 organize 物件之 opts
//   逐項覆寫(buildPrompt/renderNote…),主題範圍(vocab.domain)與詞彙表經 cfg.data.vocab 整鍵替換,
//   prompt 之領域句(萃取對象、relevant 判準與排除、簡體字例、概念用語、證據等級定義、品質疑慮例、時效條件)
//   經 vocab.guide.extract 逐欄覆寫;輸出欄位與格式說明不開放覆寫(套件解析輸出之契約)。
// 【版型逐字保真】md 版型與 JSON 欄位自原專案原樣搬入(含全形標點)——版型變動會讓新舊筆記格式分裂,
//   非套件升級之正當理由。2026-09-23 去除 prompt 之領域特化用語時亦只改措辭,不動欄位與版型。
// 【regime_dependency 之稱呼與 md 章節名同為「時效與機制相依」】章節名綁定既有筆記(不可改);
//   prompt 曾改稱「時效與條件相依」致兩處不一致,2026-09-23 改回同名(「機制」即 regime,不綁領域)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { section } from '../md/md.mjs'
import { resolveVocab, kbLabelOf } from './vocabDefault.mjs'


/**
 * 清洗字串陣列欄位:非陣列視為空陣列,逐項轉字串修剪、去空值並限量
 *
 * @param {*} v 輸入待清洗值
 * @param {Integer} [max=6] 輸入最多保留項數
 * @returns {Array} 回傳字串陣列
 */
function strArr(v, max = 6) {
    return (Array.isArray(v) ? v : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, max)
}


/**
 * 建立彙整(萃取)之內建領域預設
 *
 * 回傳物件之全部函數皆可被彙整物件之 opts 逐項覆寫(opt.domain 整組置換,或 tap 置換 renderNote 環)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(見 resolveVocab)，含 domain(主題範圍)、kbLabel、categories、evidenceLevels、guide.extract(領域句)等，預設null代表全用內建
 * @param {Integer} [opt.extractCharsPerDoc=6000] 輸入每篇送入 prompt 之內文字數上限正整數，預設6000
 * @returns {Object} 回傳 domain 物件，含 vocab、buildPrompt(docs, conceptVocab)、isValidItem(it, count)、normalizeQuality(k)、renderNoteBody(k, doc, q)
 * @throws {Error} opt.vocab 之 kbLabel 或 guide 不合規格時拋出(見 resolveVocab)
 * @example
 * let domain = createExtractDomain({ vocab: { domain: '機器學習' } })
 * let prompt = domain.buildPrompt([{ title: 'T', sourceName: 'S', url: 'https://e.com/a', text: '內文' }], [])
 * console.log(prompt.startsWith('你是「機器學習」知識庫的萃取器'))
 * // => true
 */
export function createExtractDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveVocab(opt.vocab)

    //charsPerDoc
    let charsPerDoc = opt.extractCharsPerDoc
    if (!ispint(charsPerDoc)) {
        charsPerDoc = 6000
    }
    charsPerDoc = cint(charsPerDoc)

    const kb = kbLabelOf(vocab)
    const g = vocab.guide.extract // 領域句(安裝方可經 vocab.guide.extract 逐欄覆寫;輸出欄位與格式留在本檔)
    // 證據等級擇一清單依 vocab.evidenceLevels 產生(此前寫死高／中／低:安裝方改了等級名稱,prompt 仍要求高／中／低,
    // 而 normalizeQuality 依 evidenceLevels 驗證,產出全數落「未評估」;2026-09-23 修)
    const evidenceChoices = (isarr(vocab.evidenceLevels) ? vocab.evidenceLevels : []).map((lv) => (g.evidenceLevelDefs[lv] ? `${lv}（${g.evidenceLevelDefs[lv]}）` : lv)).join('／')
    const quoted = (arr) => arr.map((x) => `「${x}」`).join('')

    /**
     * 組單批萃取 prompt
     *
     * @param {Array} docs 輸入本批文件陣列，各項需含 title、sourceName、url、text
     * @param {Array} [conceptVocab=[]] 輸入既有概念標籤陣列(含使用篇數，如 '概念(3)')，令模型沿用既有寫法
     * @returns {String} 回傳 prompt 字串
     */
    function buildPrompt(docs, conceptVocab = []) {
        if (!isarr(docs)) docs = []
        if (!isarr(conceptVocab)) conceptVocab = []
        const blocks = docs.map((d, i) => [
            `--- 第${i + 1}篇 ---`,
            `標題：${d.title}`,
            `來源：${d.sourceName}`,
            `網址：${d.url}`,
            `內文：`,
            strTruncate(d.text, charsPerDoc),
        ].join('\n')).join('\n\n')

        return `你是${kb}的萃取器。請閱讀以下 ${docs.length} 篇資料，逐篇萃取${g.target}。

要求：
1. 先判斷該篇是否含有${g.relevance}（relevant）。下列一律 relevant 為 false：
   ${g.rejects}，
   以及「連結彙整、每週精選、文章清單」這類本身不含方法論、只是把別處文章列出來的匯流貼文。
   這類匯流貼文雖不成筆記，但它列出的題目很有價值，請務必在 explore 給出對應的關鍵字線索。
2. relevant 為 true 時，須以繁體中文萃取下列欄位；原文為英文時翻譯成繁體中文，專有名詞保留英文於括號內。
3. 只寫原文確實提到的內容，不可自行補充原文沒有的數字、參數或結論。原文沒提到的欄位請給空陣列。
4. concepts 是用於跨篇關聯與提煉的概念標籤，2 到 6 個，**必須使用繁體字形（不可寫${quoted(g.simplifiedExamples)}這類簡體）**，${g.conceptExamples}。
   標籤要「可跨篇共用」：優先用該領域的通用概念名稱，不要用只有這一篇才成立的長描述或論文專屬模型名。${conceptVocab.length
        ? `
   下列是知識庫既有的概念標籤（括號內為使用篇數）。若本篇的概念與其中某個語意相同，請「直接沿用既有寫法」，不要另創同義詞：
   ${conceptVocab.join('、')}`
        : ''}
5. explore 是你從本篇看出「值得日後再深入抓取」的線索：type 為 keyword（關鍵字）、topic（主題）或 site（具體網站首頁網址）。site 只能填原文中確實出現過的網址，不可自行想像；沒有就不要給 site。每篇最多 4 項，只給真正值得追的，不要為湊數而列泛泛題目。
6. category 從此清單擇一：${vocab.categories.join('、')}。
7. 品質與證據標注（每篇必填，這是為了讓後續使用者看得到內容的可信度與邊界）：
   - claim_type 擇一：${vocab.claimTypes.join('／')}。
   - evidence_level 擇一：${evidenceChoices}；evidence_note 一句話說明判定依據。
   - caveats：內容品質問題（陣列，誠實列出，無則空）——例：${quoted(g.caveatExamples)}。
   - sample_period：原文數據樣本期間（如 "2015-2025"；未載明填「未載明」）。
8. 多元觀點（原文有依據才寫，不可捏造）：
   - pros／cons：此方法或觀點的利與弊，各 0-4 條。
   - regime_dependency：時效與機制相依（0-3 條）——${g.regime}、何時失效、利弊在何種條件下反轉。
   - counter_views：原文提到的反方觀點、與主流相左的說法、或作者自己承認的爭議（0-3 條）。

只回覆 JSON 陣列，不要任何其他說明文字，格式：
[{"index":1,"relevant":true,"reason":"","title":"繁中標題","category":"${vocab.categories[0] || '其他'}","summary":"一句話重點","key_points":["..."],"parameters":[{"name":"參數名","value":"值或區間","note":"說明"}],"methods":["步驟或方法"],"conditions":["適用條件或限制"],"verifiable":["可驗證或可實作的要點"],"concepts":["概念1","概念2"],"claim_type":"實證研究","evidence_level":"中","evidence_note":"...","caveats":["..."],"sample_period":"...","pros":["..."],"cons":["..."],"regime_dependency":["..."],"counter_views":["..."],"explore":[{"type":"keyword","value":"...","why":"..."}]}]

${blocks}`
    }

    /**
     * 判斷單一 AI 回傳項目是否結構完整(可安全採用)
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @param {Integer} count 輸入本批文件數(index 須介於 1～count)
     * @returns {Boolean} 回傳是否結構完整，relevant 為 true 者另須有 title、key_points 與 concepts
     */
    function isValidItem(it, count) {
        if (!it || typeof it !== 'object') return false
        if (typeof it.index !== 'number' || it.index < 1 || it.index > count) return false
        if (typeof it.relevant !== 'boolean') return false
        if (it.relevant) {
            if (!String(it.title || '').trim()) return false
            if (!Array.isArray(it.key_points) || it.key_points.length === 0) return false
            if (!Array.isArray(it.concepts) || it.concepts.length === 0) return false
        }
        return true
    }

    /**
     * 正規化品質標注欄位(模型漏給時以「未評估」等呈現,不讓標注缺席)
     *
     * @param {Object} k 輸入 AI 回傳之單一項目
     * @returns {Object} 回傳品質標注物件，含 claimType、evidenceLevel、evidenceNote、caveats、samplePeriod、pros、cons、regime、counterViews
     */
    function normalizeQuality(k) {
        if (!isobj(k)) k = {}
        return {
            claimType: vocab.claimTypes.includes(k.claim_type) ? k.claim_type : '未標注',
            evidenceLevel: vocab.evidenceLevels.includes(k.evidence_level) ? k.evidence_level : '未評估',
            evidenceNote: String(k.evidence_note || '').trim().slice(0, 200),
            caveats: strArr(k.caveats, 8),
            samplePeriod: String(k.sample_period || '').trim().slice(0, 60) || '未載明',
            pros: strArr(k.pros, 4),
            cons: strArr(k.cons, 4),
            regime: strArr(k.regime_dependency, 3),
            counterViews: strArr(k.counter_views, 3),
        }
    }

    /**
     * 由結構化欄位組裝知識 md 本文(版型逐字同既有筆記)
     *
     * @param {Object} k 輸入 AI 回傳之單一項目(結構完整者)
     * @param {Object} doc 輸入來源文件記錄，需含 title、sourceName、url、publishedAt、textFrom
     * @param {Object} q 輸入 normalizeQuality 之產出
     * @returns {String} 回傳 md 本文字串(不含 frontmatter)
     */
    function renderNoteBody(k, doc, q) {
        // 表格儲存格一律轉義 |(此前只轉義說明欄,名稱/值含 | 即撐破表格;2026-09-23 修)
        const cell = (v) => String(v || '').trim().replace(/\|/g, '／')
        const paramTable = Array.isArray(k.parameters) && k.parameters.length
            ? ['| 參數 | 值／區間 | 說明 |', '| --- | --- | --- |',
                ...k.parameters.map((p) => `| ${cell(p?.name)} | ${cell(p?.value)} | ${cell(p?.note)} |`)].join('\n')
            : ''

        // 利弊分欄呈現(單一 section 混列會失去對照性)
        const prosCons = (q.pros.length || q.cons.length)
            ? ['## 利弊與取捨', '',
                ...(q.pros.length ? ['**優勢／利**', '', ...q.pros.map((x) => `- ${x}`), ''] : []),
                ...(q.cons.length ? ['**侷限／弊**', '', ...q.cons.map((x) => `- ${x}`)] : [])].join('\n')
            : ''

        return [
            `# ${k.title}`,
            '',
            section('一句話重點', k.summary),
            // 品質標注永遠存在(含「未評估」):後續 agent 一律先看到可信度邊界,再看內容
            section('品質與證據標注', [
                `內容類型：${q.claimType}`,
                `證據等級：${q.evidenceLevel}${q.evidenceNote ? `（${q.evidenceNote}）` : ''}`,
                `數據樣本期間：${q.samplePeriod}`,
                ...(q.caveats.length ? q.caveats.map((c) => `⚠ ${c}`) : ['（未發現明顯品質問題）']),
            ]),
            section('核心知識', k.key_points),
            paramTable ? `## 關鍵參數\n\n${paramTable}` : '',
            section('方法與步驟', k.methods),
            section('適用條件與限制', k.conditions),
            prosCons,
            section('時效與機制相依', q.regime),
            section('爭議與反方觀點', q.counterViews),
            section('可驗證要點', k.verifiable),
            section('來源', [
                `原文標題：${doc.title || '（無）'}`,
                `來源：${doc.sourceName}`,
                `網址：${doc.url}`,
                `發布時間：${doc.publishedAt || '（未提供）'}`,
                `內文取得方式：${{ feed: 'feed 內嵌內文', abstract: '論文摘要（abstract）' }[doc.textFrom] || '原網頁全文'}`,
            ]),
        ].filter(Boolean).join('\n\n')
    }

    return { vocab, buildPrompt, isValidItem, normalizeQuality, renderNoteBody }
}


export default createExtractDomain
