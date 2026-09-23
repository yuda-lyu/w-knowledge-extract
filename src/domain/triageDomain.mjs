// triageDomain.mjs — 預篩(triage)的內建領域預設:以標題＋開頭片段判「可能含可長期複用之知識否」
//
// 【為何要預篩】萃取一次呼叫讀 3 篇全文(每篇 6000 字),而生產實測 59% 的呼叫判為非知識——
//   AI 容量多被純新聞／公告／廣告耗掉。預篩一次呼叫看 20 篇之標題＋開頭 400 字(約 1/10 成本),
//   把明確無關者在進萃取前攔下;萃取只讀放行者。同樣的 AI 預算下可判定的文件數約 2 倍以上。
// 【寧可多放行】預篩只做「明確無關」的否決,拿不準一律放行——萃取仍會嚴格判定 relevant;
//   誤攔的代價(知識漏失)遠大於多放行的代價(多一次萃取)。攔下者狀態 skip、skipReason 帶「預篩：」,
//   記錄保留可稽核;預篩本身失敗達上限者放行交萃取(fail-open),不得因預篩壞了擋住整條線。
// 【判準是「有無可複用之方法論」,不是「主題像不像」】原專案實測:主題相符但無方法論之內容(即時快訊、評論、
//   公告、產品新聞)正是萃取判掉的大宗;判準改為逐類列舉「無方法元素者」後才對得上萃取的尺。
//   2026-09-23 去除領域特化用語,主題範圍改由 vocab.domain 注入(空＝不限主題);判斷對象、判準提示、方法元素、
//   排除與放行清單、預設攔下理由改為 vocab.guide.triage 欄位(預設＝中立句),安裝方可逐字填回自己調校過的措辭。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { resolveVocab, kbLabelOf } from './vocabDefault.mjs'


/**
 * 建立預篩之內建領域預設
 *
 * 回傳物件之全部函數皆可被預篩子階段之 opts 逐項覆寫(opt.domain 整組置換)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(見 resolveVocab)，含 domain(主題範圍)、kbLabel、categories、guide.triage(領域句)等，預設null代表全用內建
 * @param {Integer} [opt.triageCharsPerDoc=400] 輸入每篇給模型之開頭片段字數正整數，預設400
 * @returns {Object} 回傳 domain 物件，含 vocab、buildPrompt(docs)、isValidItem(it, count)、reasonOf(it)
 * @throws {Error} opt.vocab 之 kbLabel 或 guide 不合規格時拋出(見 resolveVocab)
 * @example
 * let domain = createTriageDomain({ vocab: { domain: '機器學習' } })
 * let prompt = domain.buildPrompt([{ title: 'T', sourceName: 'S', text: '開頭片段' }])
 * console.log(prompt.startsWith('你是「機器學習」知識庫的預篩器'))
 * // => true
 */
export function createTriageDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveVocab(opt.vocab)

    //chars
    let chars = opt.triageCharsPerDoc
    if (!ispint(chars)) {
        chars = 400
    }
    chars = cint(chars)

    const kb = kbLabelOf(vocab)
    const g = vocab.guide.triage // 領域句(安裝方可經 vocab.guide.triage 逐欄覆寫;輸出格式與驗證留在本檔)

    /**
     * 組單批預篩 prompt(只給標題、來源與開頭片段)
     *
     * @param {Array} docs 輸入本批文件陣列，各項可含 title、sourceName、text 或 feedText
     * @returns {String} 回傳 prompt 字串
     */
    function buildPrompt(docs) {
        if (!isarr(docs)) docs = []
        const blocks = docs.map((d, i) => {
            const snippet = String(d.text || d.feedText || '').replace(/\s+/g, ' ').trim()
            return `${i + 1}. 【${strTruncate(String(d.title || '（無標題）'), 120)}】（${d.sourceName || '未知來源'}）${snippet ? strTruncate(snippet, chars) : '（無內文片段）'}`
        }).join('\n')

        const scopeLine = g.scopeLine ? `\n${g.scopeLine}` : ''
        const rejects = g.rejects.map((x) => `   - ${x}`).join('\n')
        return `你是${kb}的預篩器。以下 ${docs.length} 篇只給標題、來源與開頭片段，請逐篇判斷${g.question}。${scopeLine}

判準（**${g.criterionNote}**，判的是後者）：
0. 先看片段裡有沒有${g.elements}。
   **只要有，即使它包在一篇新聞報導或評論裡，也判 true**；沒有才往下看第 1 條。
1. ${g.rejectIntro}：
${rejects}
2. 下列判 true：${g.accepts}。
3. 片段太短、被付費牆截斷、或確實看不出屬於哪一邊者判 true（後續萃取會再嚴格判定——預篩只負責
   攔掉一望即知的雜訊，**寧可多放行**；攔過頭會讓萃取吃不飽而整體產出下降，實測放行率
   低於兩成即屬過嚴）。
4. 類別參考：${vocab.categories.join('、')}。
5. reason 用繁體中文十字以內。

只回覆 JSON 陣列，不要任何其他文字，格式：
[{"index":1,"relevant":true,"reason":"..."}]

${blocks}`
    }

    /**
     * 判斷單一 AI 回傳項目是否結構完整
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @param {Integer} count 輸入本批文件數(index 須為 1～count 之整數)
     * @returns {Boolean} 回傳是否結構完整
     */
    function isValidItem(it, count) {
        return !!it && typeof it === 'object' &&
      Number.isInteger(it.index) && it.index >= 1 && it.index <= count &&
      typeof it.relevant === 'boolean'
    }

    /**
     * 取攔下理由(供 skipReason;模型漏給時給預設)
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @returns {String} 回傳理由字串(壓平空白、限 60 字)，無理由時為預設說明
     */
    function reasonOf(it) {
        return String(it?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 60) || g.fallbackReason
    }

    return { vocab, buildPrompt, isValidItem, reasonOf }
}


export default createTriageDomain
