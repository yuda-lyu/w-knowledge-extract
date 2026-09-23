// vocabDefault.mjs — 套件內建預設詞彙表(知識庫的主題範圍/分類/標注/關聯型別/prompt 領域句)
//
// 【安裝即用 vs 執行端擴充】內建預設讓零設定可跑;執行端給 cfg.data.vocab 時
//   「整鍵替換」(給 categories 就整組換 categories,未給的鍵沿用內建)——
//   不做深合併:合併語意不可預期,整鍵替換一眼可斷。
//   **唯一例外是 guide:逐欄回退預設**(只給部分欄位時其餘沿用預設;若整鍵替換,漏給一欄 prompt 就缺句)。
// 【領域中立】本套件為通用知識套件,預設不綁任何領域(2026-09-23 去除原專案之領域特化詞彙);
//   安裝方以 domain 給主題範圍、以 categories／relationTypes 給領域詞彙,即可把預設 prompt 收斂到自己的主題。
// 【prompt 之兩種句子分居兩處】描述「輸出哪些欄位、什麼格式、怎麼驗證」的句子是套件解析輸出所依賴的契約,
//   留在各 domain 檔;描述「這個領域裡什麼算知識、什麼是雜訊、證據怎麼分級」的句子是安裝方的政策,
//   一律成為 guide 欄位(預設值＝套件中立句)。安裝方填回自己調校過的措辭即可逐字重現原 prompt,
//   而輸出契約仍隨套件演進,不會因安裝方複製整段模板而漂移(2026-09-23 依安裝方提議改)。
//
// 各鍵語意:
//   domain          主題範圍字串(如「機器學習」);空字串＝不限主題。預設 guide 之數句與知識庫稱呼據此產生
//   kbLabel         知識庫稱呼(prompt 首句、索引標題、巡檢推送標題);空字串＝由 domain 推導(見 kbLabelOf)
//   categories      筆記分類(彙整 prompt 之單選清單;不在清單者落「其他」)
//   claimTypes      內容類型標注(實證研究/理論模型…)
//   evidenceLevels  證據等級名稱(prompt 之擇一清單與產出驗證同據此;各級定義見 guide.extract.evidenceLevelDefs)
//   relationTypes   關聯型別白名單;conflictType 觸發衝突雙寫;fallbackType 非法型別之落點
//   guide           prompt 之領域句(欄位見 GUIDE_FIELDS;值原樣插入,可含換行,續行請自帶三格縮排)

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'


/**
 * prompt 領域句之欄位表:段 → 欄位 → 型別('string' 字串｜'array' 字串陣列｜'levelMap' 證據等級→定義之物件)
 *
 * @type {Object}
 */
export const GUIDE_FIELDS = {
    triage: {
        question: 'string', // 首句「請逐篇判斷…」之判斷對象與列舉(含「」與粗體)
        scopeLine: 'string', // 主題範圍句;空字串＝不出現
        criterionNote: 'string', // 「判準（**…**，判的是後者）」之粗體內文
        elements: 'string', // 判準 0 之「具體的…元素」與列舉
        rejectIntro: 'string', // 判準 1 之前導句(不含結尾冒號)
        rejects: 'array', // 判準 1 之排除清單(每項一行)
        accepts: 'string', // 判準 2「下列判 true：」之列舉(不含句號)
        fallbackReason: 'string', // 模型漏給 reason 時之預設攔下理由
    },
    extract: {
        target: 'string', // 首句「逐篇萃取…」之對象
        relevance: 'string', // 要求 1「先判斷該篇是否含有…（relevant）」之判準
        rejects: 'string', // 要求 1 之 relevant 為 false 清單(不含結尾逗號)
        simplifiedExamples: 'array', // 要求 4 之簡體字例
        conceptExamples: 'string', // 要求 4 之概念標籤用語提示(不含句號)
        evidenceLevelDefs: 'levelMap', // 證據等級之定義(鍵須為 evidenceLevels 之成員;逐級回退預設)
        caveatExamples: 'array', // caveats 之品質疑慮例
        regime: 'string', // regime_dependency 之有效條件描述
    },
    relate: {
        broadRelation: 'string', // 「只有題材撞名、…這種泛泛關係」之例
        vagueReason: 'string', // 「不可只寫『…』」之空泛理由例
        changeDrivers: 'string', // 「利弊會…，絕不可因為衝突而不選」之轉換條件
    },
    distill: {
        ruleTarget: 'string', // 要求 5 rules 之規則落點
        weakEvidence: 'string', // 要求 8「『…』的參數須註明此限制」之弱證據描述
        temporal: 'string', // 要求 10 temporal 之說明全文(可含換行)
    },
}


/**
 * 依主題範圍產生 prompt 領域句之預設值(套件中立句;有 domain 時數句帶入主題)
 *
 * @param {String} [domain=''] 輸入主題範圍字串，空字串代表不限主題
 * @returns {Object} 回傳完整 guide 物件，各段各欄位皆有值(欄位見 GUIDE_FIELDS)
 * @example
 * console.log(guideDefaultOf('').triage.fallbackReason)
 * // => 無可複用知識
 *
 * console.log(guideDefaultOf('機器學習').triage.scopeLine)
 * // => 本知識庫之主題範圍為「機器學習」：與此主題無關者判 false。
 */
export function guideDefaultOf(domain = '') {
    const d = String(domain || '').trim()
    return {
        triage: {
            question: '「本篇是否含有**可長期複用的知識或方法論**」——原理與機制、模型或演算法、方法與步驟、參數與門檻、規則或準則、指標或評估方式、實驗或實證結果、風險與限制分析',
            scopeLine: d ? `本知識庫之主題範圍為「${d}」：與此主題無關者判 false。` : '',
            criterionNote: '與主題相關並不等於有可複用之知識',
            elements: '**具體的方法或知識元素**——模型或方法的名稱與做法、參數與門檻值、規則或步驟、\n   實驗設計／樣本與檢定、評估方式、機制或原理的說明',
            rejectIntro: '無上述元素，且**整篇的主要內容**即為下列之一者判 false',
            rejects: [
                '即時新聞快訊、數字或價格之例行報導',
                '名人／評論者／分析師之主觀看法、預測、展望、採訪與節目摘要',
                '問卷或意見調查之數字報導',
                '公司／平台之產品發布、上線公告、業務與財務新聞',
                '產品介紹、比較、排行或促銷資訊',
                '法規、政策之宣導與新聞',
                '例行統計數據發布、產業或時事新聞',
                '個人生活建議、公司人事與活動公告、廣告與招募、免責聲明或版權頁、純導覽頁',
            ],
            accepts: '學術論文與研究、方法或模型之構建與驗證、實驗或評估方法與陷阱、參數選擇、\n   原理與機制分析、風險與限制分析、資料處理方法、程式或工具之方法說明、對某方法之實證檢驗或反駁',
            fallbackReason: d ? `與「${d}」無關或無可複用知識` : '無可複用知識',
        },
        extract: {
            target: '可長期複用的知識',
            relevance: `${d ? `與「${d}」相關、` : ''}可長期複用之知識、方法、技術、參數或原理`,
            rejects: `純新聞快訊、廣告、招募、無方法論的評論或觀點、免責聲明或版權頁、產品／月報更新${d ? `、與「${d}」無關之內容` : ''}`,
            simplifiedExamples: ['数据', '网络'],
            conceptExamples: '用該領域的通用術語',
            evidenceLevelDefs: {
                '高': '有獨立驗證、重複驗證或實際應用結果',
                '中': '僅單一研究、案例或統計分析',
                '低': '示範性質、未驗證、或推廣內容',
            },
            caveatExamples: ['無獨立驗證', '樣本小或期間短', '倖存者偏差風險', '數據窺探風險', '適用範圍狹窄', '推廣性質', '結論與所附數據不符'],
            regime: '在什麼環境／時期／條件下有效',
        },
        relate: {
            broadRelation: '同屬某一大領域',
            vagueReason: '都與某主題有關',
            changeDrivers: '隨時間與環境條件轉換',
        },
        distill: {
            ruleTarget: '可直接應用的操作規則',
            weakEvidence: '僅單一研究或未經獨立驗證',
            temporal: '這個概念的有效性如何隨時間、環境條件或機制（regime）改變；\n   利與弊在什麼條件下會反轉。原文有依據才寫。',
        },
    }
}


/**
 * 驗證並合併 guide:安裝方給的欄位覆寫預設,未給(undefined 或 null)者沿用預設;空字串照填(如 scopeLine:'' 關閉主題範圍句)
 *
 * @param {Object} def 輸入預設 guide(guideDefaultOf 之產出)
 * @param {*} user 輸入安裝方之 guide，未給(undefined 或 null)代表全用預設
 * @param {Array} levels 輸入證據等級名稱陣列(evidenceLevelDefs 之鍵須為其成員)
 * @returns {Object} 回傳合併後之完整 guide(evidenceLevelDefs 只留 levels 內之等級)
 * @throws {Error} guide 非物件、含不認得之段或欄位、欄位型別不符、或 evidenceLevelDefs 之鍵不在 evidenceLevels 時拋出
 */
function mergeGuide(def, user, levels) {
    if (user !== undefined && user !== null && !isobj(user)) {
        throw new Error('vocab.guide 須為物件 { triage, extract, relate, distill }')
    }
    user = user || {}
    for (const sec of Object.keys(user)) {
        if (!GUIDE_FIELDS[sec]) {
            throw new Error(`vocab.guide 含不認得的段「${sec}」（可用：${Object.keys(GUIDE_FIELDS).join('、')}）`)
        }
        if (user[sec] !== undefined && user[sec] !== null && !isobj(user[sec])) {
            throw new Error(`vocab.guide.${sec} 須為物件`)
        }
    }
    const out = {}
    for (const [sec, fields] of Object.entries(GUIDE_FIELDS)) {
        const u = user[sec] || {}
        for (const k of Object.keys(u)) {
            if (!fields[k]) {
                throw new Error(`vocab.guide.${sec} 含不認得的欄位「${k}」（可用：${Object.keys(fields).join('、')}）`)
            }
        }
        out[sec] = {}
        for (const [k, type] of Object.entries(fields)) {
            const v = u[k]
            const name = `vocab.guide.${sec}.${k}`
            if (v === undefined || v === null) {
                out[sec][k] = def[sec][k]
            }
            else if (type === 'string') {
                if (typeof v !== 'string') throw new Error(`${name} 須為字串`)
                out[sec][k] = v
            }
            else if (type === 'array') {
                if (!isarr(v) || v.length === 0 || !v.every(isestr)) throw new Error(`${name} 須為字串陣列(至少一項、每項非空字串)`)
                out[sec][k] = [...v]
            }
            else {
                // levelMap:逐級回退預設;鍵須為 evidenceLevels 之成員(打錯級名會讓該級靜默沿用預設)
                if (!isobj(v)) throw new Error(`${name} 須為物件 { <證據等級>: 定義字串 }`)
                for (const [lv, text] of Object.entries(v)) {
                    if (!levels.includes(lv)) throw new Error(`${name} 之「${lv}」不在 evidenceLevels（${levels.join('、')}）`)
                    if (typeof text !== 'string') throw new Error(`${name}.${lv} 須為字串`)
                }
                const merged = { ...def[sec][k], ...v }
                out[sec][k] = Object.fromEntries(levels.filter((lv) => merged[lv] !== undefined).map((lv) => [lv, merged[lv]]))
            }
        }
    }
    // levelMap 未給時亦只留 levels 內之等級(改了等級名稱者,預設之高／中／低定義不適用)
    const defs = out.extract.evidenceLevelDefs
    out.extract.evidenceLevelDefs = Object.fromEntries(levels.filter((lv) => defs[lv] !== undefined).map((lv) => [lv, defs[lv]]))
    return out
}


/**
 * 內建預設詞彙表(領域中立)
 *
 * @type {Object}
 */
export const VOCAB_DEFAULT = {
    domain: '',
    kbLabel: '',
    categories: ['原理與概念', '方法與技術', '模型與演算法', '流程與實務', '工具與實作', '資料與指標', '評估與驗證', '風險與限制', '其他'],
    claimTypes: ['實證研究', '理論模型', '實務經驗', '教學示範', '觀點評論', '廠商內容'],
    evidenceLevels: ['高', '中', '低'],
    relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突或反例', '實作範例', '同類方法', '共用資料或指標'],
    conflictType: '衝突或反例',
    fallbackType: '互補搭配',
    guide: guideDefaultOf(''),
}


/**
 * 合併內建預設詞彙表與執行端覆寫(guide 以外之鍵整鍵替換;guide 逐欄回退預設,預設句依 domain 產生)
 *
 * 可重複套用:resolveVocab(resolveVocab(x)) 與 resolveVocab(x) 相同
 *
 * @param {Object} [override] 輸入覆寫物件，給定之鍵整鍵替換內建值，未給或非物件代表全用內建預設
 * @returns {Object} 回傳合併後詞彙表物件，含 domain、kbLabel、categories、claimTypes、evidenceLevels、relationTypes、conflictType、fallbackType、guide
 * @throws {Error} kbLabel 非字串，或 guide 不合 GUIDE_FIELDS(不認得之段或欄位、型別不符、證據等級鍵不在 evidenceLevels)時拋出
 * @example
 * let v = resolveVocab({ domain: '機器學習', categories: ['模型', '資料', '其他'] })
 * console.log(v.domain, v.categories, v.evidenceLevels)
 * // => 機器學習 [ '模型', '資料', '其他' ] [ '高', '中', '低' ]
 *
 * let v2 = resolveVocab({ guide: { relate: { vagueReason: '都屬同一學科' } } })
 * console.log(v2.guide.relate.vagueReason, v2.guide.relate.broadRelation)
 * // => 都屬同一學科 同屬某一大領域
 */
export function resolveVocab(override) {

    //check
    if (!isobj(override)) {
        override = {}
    }
    if (override.kbLabel !== undefined && override.kbLabel !== null && typeof override.kbLabel !== 'string') {
        throw new Error('vocab.kbLabel 須為字串')
    }

    const v = { ...VOCAB_DEFAULT, ...override }
    const levels = isarr(v.evidenceLevels) ? v.evidenceLevels : []
    v.guide = mergeGuide(guideDefaultOf(v.domain), override.guide, levels)
    return v
}


/**
 * 由詞彙表取得知識庫稱呼(prompt 首句、索引標題、巡檢推送標題共用):kbLabel 優先,否則由 domain 推導
 *
 * @param {Object} vocab 輸入詞彙表物件(resolveVocab 之產出，或至少含 domain／kbLabel)
 * @returns {String} 回傳稱呼字串：kbLabel 非空時為其值；否則 domain 為空時為「知識庫」，有 domain 時為「「<domain>」知識庫」
 * @example
 * console.log(kbLabelOf({ domain: '' }))
 * // => 知識庫
 *
 * console.log(kbLabelOf({ domain: '機器學習' }))
 * // => 「機器學習」知識庫
 *
 * console.log(kbLabelOf({ domain: '機器學習', kbLabel: '機器學習知識庫' }))
 * // => 機器學習知識庫
 */
export function kbLabelOf(vocab) {
    const label = typeof vocab?.kbLabel === 'string' ? vocab.kbLabel.trim() : ''
    if (label) return label
    const domain = String(vocab?.domain || '').trim()
    return domain ? `「${domain}」知識庫` : '知識庫'
}


export default VOCAB_DEFAULT
