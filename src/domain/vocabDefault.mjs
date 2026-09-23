// vocabDefault.mjs — 套件內建預設詞彙表(知識庫的主題範圍/分類/標注/關聯型別)
//
// 【安裝即用 vs 執行端擴充】內建預設讓零設定可跑;執行端給 cfg.data.vocab 時
//   「整鍵替換」(給 categories 就整組換 categories,未給的鍵沿用內建)——
//   不做深合併:合併語意不可預期,整鍵替換一眼可斷。
// 【領域中立】本套件為通用知識套件,預設不綁任何領域(2026-09-23 去除原專案之領域特化詞彙);
//   安裝方以 domain 給主題範圍、以 categories／relationTypes 給領域詞彙,即可把預設 prompt 收斂到自己的主題。
//
// 各鍵語意:
//   domain          主題範圍字串(如「機器學習」);空字串＝不限主題。預篩/萃取/關聯/提煉之 prompt 據此限定範圍
//   categories      筆記分類(彙整 prompt 之單選清單;不在清單者落「其他」)
//   claimTypes      內容類型標注(實證研究/理論模型…)
//   evidenceLevels  證據等級(高＝有獨立驗證或實際應用;中＝僅單一研究、案例或統計分析;低＝示範或推廣)
//   relationTypes   關聯型別白名單;conflictType 觸發衝突雙寫;fallbackType 非法型別之落點

import isobj from 'wsemi/src/isobj.mjs'


/**
 * 內建預設詞彙表(領域中立)
 *
 * @type {Object}
 */
export const VOCAB_DEFAULT = {
    domain: '',
    categories: ['原理與概念', '方法與技術', '模型與演算法', '流程與實務', '工具與實作', '資料與指標', '評估與驗證', '風險與限制', '其他'],
    claimTypes: ['實證研究', '理論模型', '實務經驗', '教學示範', '觀點評論', '廠商內容'],
    evidenceLevels: ['高', '中', '低'],
    relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突或反例', '實作範例', '同類方法', '共用資料或指標'],
    conflictType: '衝突或反例',
    fallbackType: '互補搭配',
}


/**
 * 合併內建預設詞彙表與執行端覆寫(整鍵替換,不做深合併)
 *
 * @param {Object} [override] 輸入覆寫物件，給定之鍵整鍵替換內建值，未給或非物件代表全用內建預設
 * @returns {Object} 回傳合併後詞彙表物件，含 domain、categories、claimTypes、evidenceLevels、relationTypes、conflictType、fallbackType
 * @example
 * let v = resolveVocab({ domain: '機器學習', categories: ['模型', '資料', '其他'] })
 * console.log(v.domain, v.categories, v.evidenceLevels)
 * // => 機器學習 [ '模型', '資料', '其他' ] [ '高', '中', '低' ]
 */
export function resolveVocab(override) {

    //check
    if (!isobj(override)) {
        override = {}
    }

    return { ...VOCAB_DEFAULT, ...override }
}


/**
 * 由詞彙表取得 prompt 用之知識庫稱呼(有主題範圍時帶主題)
 *
 * @param {Object} vocab 輸入詞彙表物件(resolveVocab 之產出)
 * @returns {String} 回傳稱呼字串，domain 為空時為「知識庫」，否則為「「<domain>」知識庫」
 * @example
 * console.log(kbLabelOf({ domain: '' }))
 * // => 知識庫
 *
 * console.log(kbLabelOf({ domain: '機器學習' }))
 * // => 「機器學習」知識庫
 */
export function kbLabelOf(vocab) {
    let domain = String(vocab?.domain || '').trim()
    return domain ? `「${domain}」知識庫` : '知識庫'
}


export default VOCAB_DEFAULT
