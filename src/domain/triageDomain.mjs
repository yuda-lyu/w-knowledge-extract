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
//   2026-09-23 去除領域特化用語,主題範圍改由 vocab.domain 注入(空＝不限主題)。

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
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(整鍵替換內建 VOCAB_DEFAULT)，含 domain(主題範圍)、categories 等，預設null代表全用內建
 * @param {Integer} [opt.triageCharsPerDoc=400] 輸入每篇給模型之開頭片段字數正整數，預設400
 * @returns {Object} 回傳 domain 物件，含 vocab、buildPrompt(docs)、isValidItem(it, count)、reasonOf(it)
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
    const domainName = String(vocab.domain || '').trim()

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

        const scopeLine = domainName ? `\n本知識庫之主題範圍為「${domainName}」：與此主題無關者判 false。` : ''
        return `你是${kb}的預篩器。以下 ${docs.length} 篇只給標題、來源與開頭片段，請逐篇判斷「本篇是否含有**可長期複用的知識或方法論**」——原理與機制、模型或演算法、方法與步驟、參數與門檻、規則或準則、指標或評估方式、實驗或實證結果、風險與限制分析。${scopeLine}

判準（**與主題相關並不等於有可複用之知識**，判的是後者）：
0. 先看片段裡有沒有**具體的方法或知識元素**——模型或方法的名稱與做法、參數與門檻值、規則或步驟、
   實驗設計／樣本與檢定、評估方式、機制或原理的說明。
   **只要有，即使它包在一篇新聞報導或評論裡，也判 true**；沒有才往下看第 1 條。
1. 無上述元素，且**整篇的主要內容**即為下列之一者判 false：
   - 即時新聞快訊、數字或價格之例行報導
   - 名人／評論者／分析師之主觀看法、預測、展望、採訪與節目摘要
   - 問卷或意見調查之數字報導
   - 公司／平台之產品發布、上線公告、業務與財務新聞
   - 產品介紹、比較、排行或促銷資訊
   - 法規、政策之宣導與新聞
   - 例行統計數據發布、產業或時事新聞
   - 個人生活建議、公司人事與活動公告、廣告與招募、免責聲明或版權頁、純導覽頁
2. 下列判 true：學術論文與研究、方法或模型之構建與驗證、實驗或評估方法與陷阱、參數選擇、
   原理與機制分析、風險與限制分析、資料處理方法、程式或工具之方法說明、對某方法之實證檢驗或反駁。
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
        return String(it?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 60) || (domainName ? `與「${domainName}」無關或無可複用知識` : '無可複用知識')
    }

    return { vocab, buildPrompt, isValidItem, reasonOf }
}


export default createTriageDomain
