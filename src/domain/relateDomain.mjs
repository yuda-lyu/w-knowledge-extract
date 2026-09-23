// relateDomain.mjs — 關聯的內建領域預設:prompt 與品質標注摘要
//
// 關聯型別白名單與主題範圍來自詞彙表(內建預設,cfg.data.vocab 整鍵替換);
// 候選挑選、slug 容錯、衝突雙寫等機制在 stages/relateStage.mjs。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { oneline } from '../util/misc.mjs'
import { resolveVocab, kbLabelOf } from './vocabDefault.mjs'


/**
 * 筆記的品質標注摘要行(供 prompt 對照證據強弱與衝突判斷用)
 *
 * @param {Object} n 輸入筆記記錄，可含 evidenceLevel、caveats
 * @returns {String} 回傳摘要字串，例如 '證據:中｜⚠樣本小'
 */
function qualityTag(n) {
    const cv = (n.caveats || []).length ? `｜⚠${(n.caveats || []).join('/')}` : ''
    return `證據:${n.evidenceLevel || '未評估'}${cv}`
}


/**
 * 建立關聯之內建領域預設
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(整鍵替換內建 VOCAB_DEFAULT)，含 domain、relationTypes、conflictType、fallbackType 等，預設null代表全用內建
 * @returns {Object} 回傳 domain 物件，含 relationTypes、conflictType、fallbackType、buildPrompt(targets, candidateMap)
 * @example
 * let domain = createRelateDomain({})
 * console.log(domain.conflictType, domain.relationTypes.includes(domain.fallbackType))
 * // => 衝突或反例 true
 */
export function createRelateDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveVocab(opt.vocab)
    const kb = kbLabelOf(vocab)

    /**
     * 組單批關聯 prompt
     *
     * @param {Array} targets 輸入待建立關聯之筆記陣列，各項需含 id、title、category、concepts、summary
     * @param {Map} candidateMap 輸入各目標之候選清單對照(筆記 id → 候選筆記陣列)
     * @returns {String} 回傳 prompt 字串
     */
    function buildPrompt(targets, candidateMap) {
        if (!isarr(targets)) targets = []
        if (!(candidateMap instanceof Map)) candidateMap = new Map()
        const blocks = targets.map((t, i) => {
            const cands = candidateMap.get(t.id) || []
            const list = cands.map((c) => `  - slug: ${c.id}｜標題: ${c.title}｜類別: ${c.category}｜${qualityTag(c)}｜概念: ${(c.concepts || []).join('、')}｜重點: ${oneline(c.summary, 80)}`).join('\n')
            return [
                `--- 第${i + 1}篇（待建立關聯）---`,
                `標題：${t.title}`,
                `類別：${t.category}｜${qualityTag(t)}`,
                `概念：${(t.concepts || []).join('、')}`,
                `重點：${oneline(t.summary, 200)}`,
                `候選關聯對象：`,
                list || '  （無候選）',
            ].join('\n')
        }).join('\n\n')

        return `你是${kb}的關聯建立器。針對每一篇「待建立關聯」的筆記，從它自己的候選清單中找出真正有知識關聯的對象。

要求：
1. 只能選候選清單內出現過的 slug，不可自創 slug。
2. 每篇最多選 4 個，寧缺勿濫：只有題材撞名、同屬某一大領域這種泛泛關係，不算關聯，請不要選。
3. type 從此清單擇一：${vocab.relationTypes.join('、')}。
4. reason 用繁體中文一句話說明兩篇之間的具體關聯（要指出共同的機制、參數或前提，不可只寫「都與某主題有關」）。
5. **主動獵取衝突**：兩篇結論相反、參數矛盾、或適用條件互斥時，務必選為「${vocab.conflictType}」並在 reason 寫明衝突的具體內容（甲說 X、乙說 Y）。衝突是知識庫裡最有價值的關聯——觀點本就多元、利弊會隨時間與環境條件轉換，絕不可因為衝突而不選、或硬把衝突寫成互補。
6. 若某篇確實找不到夠格的關聯，relations 給空陣列。

只回覆 JSON 陣列，不要任何其他說明文字，格式：
[{"index":1,"relations":[{"to":"候選slug","type":"${vocab.relationTypes[1] || vocab.fallbackType}","reason":"..."}]}]

${blocks}`
    }

    return {
        relationTypes: vocab.relationTypes,
        conflictType: vocab.conflictType,
        fallbackType: vocab.fallbackType,
        buildPrompt,
    }
}


export default createRelateDomain
