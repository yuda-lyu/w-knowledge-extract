// extractVocab.mjs — 提煉之詞彙表:內建預設、驗證與合併、子集擷取、啟動期警告
//
// 【安裝即用 vs 執行端擴充】內建預設讓零設定可跑;執行端給詞彙表時「整鍵替換」(給 basisCaps 就整組換 basisCaps,未給的鍵沿用內建)——
//   不做深合併:合併語意不可預期,整鍵替換一眼可斷。唯一例外是 guide:逐欄回退預設(只給部分欄位時其餘沿用預設;若整鍵替換,漏給一欄提示詞就缺句)。
// 【只認本套件讀取之鍵】不認得之鍵與 guide 之他段拋錯並列出可用鍵:打錯之鍵若靜默接受,正名鍵會維持預設而無人察覺。與其他知識處理段共用一份
//   詞彙表者,以 pickExtractVocab 取本套件所讀之鍵(guide 只取 extract 段)。
// 【借用之鍵交擁有者驗】本套件亦讀他套件定義之鍵,其預設、規則與訊息只在擁有者(本檔不另寫一份),且各只交該擁有者之鍵:主題範圍、稱呼、
//   概念之改名與別名交抓取套件;分類清單、清單外分類之落點、內容類型、證據等級、最高證據等級之要件交摘要套件;關聯型別清單、衝突型、後備型、
//   型別之改名／別名／語意角色交關聯套件。分類清單只供驗證——清單外分類之落點須在分類清單內,自訂分類清單者須同給落點,產物同帶兩者才可
//   重複套用;關聯之鍵供獨立組裝時自建關聯之型別定義。
// 【自有之鍵依摘要之清單驗】內容類型封頂之鍵須為現行內容類型(或其缺值字樣)、各封頂之值須為現行證據等級之名或位置整數——取自摘要套件
//   解析後之清單(與摘要同一份),不另抄清單。
// 【可重複套用】產物可再交本函數解析而結果不變(含 JSON 往返後之複本:最高證據等級之要件 JSON 化為其正規形,重新解析即還原)。
// 【提示詞之兩種句子分居兩處】描述「輸出哪些欄位、什麼格式、怎麼驗證」的句子是套件解析輸出所依賴的契約,留在 domain 檔;描述「這個領域裡
//   規則落到哪裡、什麼算弱證據、有效性隨何改變」的句子是安裝方的政策,一律成為 guide 欄位。安裝方填回自己調校過的措辭即可逐字重現其提示詞,
//   而輸出契約仍隨套件演進,不會因安裝方複製整段模板而漂移。
// 【頭、子集與 guide 取共用件】值為 undefined 之鍵視為未給、null 依逐鍵宣告(EXTRACT_VOCAB_NULL_AS;借用之鍵依擁有者之宣告)、不認得之鍵／段／
//   欄位之訊息、guide 之逐欄回退與型別——皆取抓取套件之 vocabKit(各工作之詞彙表同一份)。
// 【null／{}／[] 之語意(自有之鍵)】null＝未給(取預設;'unset'):evidenceCaps、basisCaps、inferenceBasis、selfLimitPhrases、absolutePhrases、guide——
//   其預設非空且有意義,「不要」須明給空值:{}＝不封頂(basisCaps;evidenceCaps 給 {} 即不依內容類型封頂)、[]＝無推論類／不封頂／不計;
//   presumedBasis 之 null 照收(＝不推定,即其預設)。摘要、關聯之詞彙表另有 'empty'(null＝空對照或空清單):其鍵之預設本為空(改名、
//   別名、退役、提示等對照),null 與預設等價;本套件自有之鍵之預設非空,故不用 'empty'——null 若當空值,安裝方寫 null 本意「用預設」即被當成「不要」。
// 【guide 之欄位皆為句中片語(共用型別 'estr';同關聯之殘句欄)】各欄皆插在提示詞之句中,空字串(或只含空白)會使規則或例句成為殘句——
//   解析即拋「須為非空字串」(非字串者亦同此訊息;抓取套件 vocabKit 之型別表一份);null／undefined 沿用預設(mergeGuideFields 之逐欄回退)。
//
// 各鍵語意(本套件自有之鍵;借用之鍵之語意見各擁有者之詞彙表):
//   guide            提示詞之領域句(段與欄位見 EXTRACT_GUIDE_FIELDS;值原樣插入,可含換行,續行請自帶三格縮排)
//   evidenceCaps     核心主張證據等級之內容類型封頂 { 內容類型: 等級名｜位置整數 }(0＝最高、1＝次高、-1＝最低)。預設表之鍵取自摘要套件之預設
//                    內容類型、值以位置表達(等級改名仍生效):觀點評論／實務經驗／教學示範／廠商內容之主張封頂最低、理論模型封頂次高(錯在保守方向
//                    優於灌水)。不給封頂表即「取出處最高」——即灌水之規則。內容類型之缺值字樣(摘要之落點)封頂次高
//   basisCaps        核心主張之證據性質封頂 { basis 關鍵詞: 等級名｜位置整數, '*': 皆不含時 }——basis 含該詞即封頂,多詞取最嚴;鍵同時是提煉規則表中
//                    「證據性質擇自」之清單與核心 md 語氣標記之詞(單一來源)。鍵取短詞(子字串比對亦涵蓋長寫法)。給 {} 即不封頂。
//                    預設只有經獨立驗證者可達最高:單一研究、理論、模擬、案例封頂次高,實務、教學、觀點、廠商、轉述封頂最低
//   inferenceBasis   推論類之證據性質關鍵詞(basis 含之即為推論類;子字串比對)——出處支持之覆核以此分判準:推論類須斷言寫明所依前提(前提為出處
//                    明載)才算受支持,其餘須出處直接陳述。須同時是 basisCaps 之鍵(起草提示詞才列得出);給 [] 即一律須直接陳述
//   selfLimitPhrases 核心主張之自承限制片語(critique／conditions／basis 含之即封頂次高)。給 [] 即不封頂
//   absolutePhrases  絕對語氣片語:本次新寫入或改寫之主張文字含之(前兩字有「不未非無」或為「難以」者不計)即計入指標「絕對語氣」,
//                    只計數、不擋(否定句會誤判,不做硬擋)。給 [] 即不計
//   presumedBasis    推定之證據性質(basisCaps 之鍵;null＝不推定):主張之 basis 與出處之內容類型皆無證據性質之關鍵詞,而出處筆記皆自承無
//                    最高證據等級之要件(摘要之證據規則 evidenceRule)者,核心 md 以此詞標記——只推保守方向。推定詞須與最高級之要件成對
//                    (要件為某種驗證,推定詞即未經該驗證之證據性質),故預設不推定:要件因領域而異,配錯會把無關之自承標成此詞

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { resolveCaptureVocab, CAPTURE_VOCAB_KEYS, pickCaptureVocab, cloneSettingsDefault, vocabHeadOf, pickVocabKeys, mergeGuideFields } from '../capturePackage.mjs'
import { resolveSummarizeVocab, pickSummarizeVocab, NOTE_PLACEHOLDERS } from '../summarizePackage.mjs'
import { resolveRelateVocab, pickRelateVocab, RELATE_VOCAB_OWN_KEYS } from '../relatePackage.mjs'


/**
 * 提示詞領域句之欄位表:段 → 欄位 → 型別('estr' 非空字串——句中片語,空字串會使句子成為殘句;檔頭【guide 之欄位皆為句中片語】;型別表在抓取套件 vocabKit)
 *
 * @type {Object}
 */
export const EXTRACT_GUIDE_FIELDS = Object.freeze({
    extract: Object.freeze({
        ruleTarget: 'estr', // 規則表之規則落點(「…」之規則)
        weakEvidence: 'estr', // 「『…』的參數須註明此限制」之弱證據描述
        temporal: 'estr', // temporal 之說明全文(可含換行)
        narrowScope: 'estr', // 出處支持覆核之 overclaim:「出處只支持較窄的結論（例如…）」之較窄範圍之例
        broadScope: 'estr', // 同上:「斷言卻把結論擴大到出處未涵蓋之範圍（…）」之擴大範圍之例
        reviseScope: 'estr', // 依出處收斂措辭之修訂:「縮小到出處涉及的…」之範圍
        opposedObjects: 'estr', // 爭議覆核之 opposed:「兩方之對象（…）、證據性質或適用條件不同」之對象之例
        sameExample: 'estr', // 同義核心覆核之 same:「同義詞、譯名、簡稱或只是寫法不同（例如…）」之例(兩個概念名)
        subtopicExample: 'estr', // 同上之 different:「一方是另一方之子題或上位概念（例如…）」之例
        siblingExample: 'estr', // 同上之 different:「同一領域之不同主題（例如…）」之例
    }),
})


/**
 * 提示詞領域句之預設值(中立句,不隨主題範圍變)
 *
 * @returns {Object} 回傳完整 guide 物件 { extract }，各欄位皆有值(欄位見 EXTRACT_GUIDE_FIELDS)
 * @example
 * console.log(extractGuideDefaultOf().extract.ruleTarget)
 * // => 可直接應用的操作規則
 */
export function extractGuideDefaultOf() {
    return {
        extract: {
            ruleTarget: '可直接應用的操作規則',
            weakEvidence: '僅單一研究或未經獨立驗證',
            temporal: '這個概念的有效性如何隨時間、環境條件或機制（regime）改變；\n   利與弊在什麼條件下會反轉。原文有依據才寫。',
            narrowScope: '單一樣本、特定對象或期間、有前提條件',
            broadScope: '更多對象、期間或情境',
            reviseScope: '樣本、對象或期間',
            opposedObjects: '研究對象、族群、樣本',
            sameExample: '「網際網路」與「互聯網」',
            subtopicExample: '「排序」與「快速排序」',
            siblingExample: '「記憶體管理」與「行程排程」',
        },
    }
}


/**
 * 內建預設詞彙表(本套件自有之鍵＋guide 之 extract 段;借用之鍵之預設在各擁有者)
 *
 * @type {Object}
 */
export const EXTRACT_VOCAB_DEFAULT = {
    // 內容類型之缺值字樣(摘要之落點)封頂次高
    evidenceCaps: { '理論模型': 1, '實務經驗': -1, '教學示範': -1, '觀點評論': -1, '廠商內容': -1, [NOTE_PLACEHOLDERS.claimType]: 1 },
    // 鍵用短詞:basis 以子字串比對,短詞同時涵蓋長短寫法(「實務」命中「實務經驗」)——模型之用詞有長有短,長鍵會漏接短寫法而把應封頂最低者
    //   抬成次高(灌水方向之錯);短鍵之誤差只往保守方向。最高級只給「獨立驗證」:未經他方重現之結果皆可能只在其自身條件下成立。
    //   領域另有慣用詞者以 vocab.basisCaps 整組替換
    basisCaps: { '獨立驗證': 0, '單一研究': 1, '理論': 1, '模擬': 1, '案例': 1, '實務': -1, '教學': -1, '觀點': -1, '廠商': -1, '轉述': -1, '*': 1 },
    inferenceBasis: ['理論'],
    selfLimitPhrases: ['單一研究', '同一研究', '僅摘要', '未經獨立驗證', '未經驗證'],
    // 不收裸詞「一定／絕對／保證」:「一定程度」「絕對值」「保證金」等常見詞會被誤計
    absolutePhrases: ['一定會', '一定能', '一定是', '必然', '必定', '總是', '永遠', '絕對會', '絕對是', '保證會', '保證能', '毫無例外', '無一例外', '無疑', '百分之百'],
    presumedBasis: null,
    guide: extractGuideDefaultOf(),
}


/** 本套件自有之鍵(guide 以外;整鍵替換) */
const OWN_KEYS = Object.freeze(Object.keys(EXTRACT_VOCAB_DEFAULT).filter((k) => k !== 'guide'))

/** 借用抓取套件之鍵(鍵集取自抓取套件之詞彙表 CAPTURE_VOCAB_KEYS:主題範圍、稱呼、概念之改名與別名) */
const CAPTURE_KEYS = CAPTURE_VOCAB_KEYS

/** 借用摘要套件之鍵(分類清單只供驗證清單外分類之落點) */
const SUMMARIZE_KEYS = Object.freeze(['categories', 'fallbackCategory', 'claimTypes', 'evidenceLevels', 'evidenceRule'])

/** 借用關聯套件之鍵(關聯之型別定義所讀之鍵;鍵集取自關聯套件之 RELATE_VOCAB_OWN_KEYS,不另抄) */
const RELATE_KEYS = RELATE_VOCAB_OWN_KEYS

/**
 * 詞彙表之全部可用鍵(resolveExtractVocab 據此拒絕不認得之鍵;pickExtractVocab 據此取子集):借用之鍵(抓取、摘要、關聯)＋自有之鍵＋guide
 *
 * @type {Array}
 */
export const EXTRACT_VOCAB_KEYS = Object.freeze([...CAPTURE_KEYS, ...SUMMARIZE_KEYS, ...RELATE_KEYS, ...OWN_KEYS, 'guide'])


/**
 * null 之逐鍵政策(抓取套件之 vocabHeadOf):封頂表、推論類與兩組片語之 null 視為未給(取預設——[] 才是「不封頂／不計」),guide 之 null
 *   視為未給;推定詞之 null 照收(＝不推定)。借用之鍵之 null 依各擁有者之宣告
 */
const EXTRACT_VOCAB_NULL_AS = Object.freeze({
    evidenceCaps: 'unset', basisCaps: 'unset', inferenceBasis: 'unset', selfLimitPhrases: 'unset', absolutePhrases: 'unset', guide: 'unset',
})


/**
 * 合併內建預設詞彙表與執行端覆寫(整鍵替換;guide 逐欄回退預設):借用之鍵各交擁有者之解析(只交該擁有者之鍵),自有之鍵於此驗
 *
 * 可重複套用:resolveExtractVocab(resolveExtractVocab(x)) 與 resolveExtractVocab(x) 相同;產物經 JSON 往返後再解析亦相同
 *
 * @param {Object} [override] 輸入覆寫物件，給定之鍵整鍵替換內建值(值為 undefined 者視為未給;null 依 EXTRACT_VOCAB_NULL_AS)，未給或非物件代表
 *   全用內建預設(鍵見 EXTRACT_VOCAB_KEYS)
 * @returns {Object} 回傳合併後詞彙表物件，依 EXTRACT_VOCAB_KEYS 之序含其全部鍵;evidenceRule 為摘要套件已編譯之規則物件(交摘要之函數即通過其
 *   詞彙檢核),relationTypeRoles 為關聯套件推導後之角色對照,guide 只含 extract 段
 * @throws {Error} 含不認得之鍵(附可用鍵;他段之鍵亦然——以 pickExtractVocab 取子集),guide 非物件、含他段或不合 EXTRACT_GUIDE_FIELDS,
 *   借用之鍵不合擁有者之規則(訊息即擁有者之訊息),evidenceCaps 之鍵不在 claimTypes／值非等級名或位置整數，basisCaps 非物件／鍵為空／值非等級名
 *   或位置整數，inferenceBasis 非字串陣列或其詞不在 basisCaps 之鍵，selfLimitPhrases／absolutePhrases 非字串陣列，或 presumedBasis 非 null 而
 *   不是 basisCaps 之鍵(「*」除外;訊息列可用鍵)時拋出
 * @example
 * let v = resolveExtractVocab({ domain: '天文學', claimTypes: ['觀測報告', '理論推導'], evidenceCaps: { 理論推導: 1 } })
 * console.log(v.domain, v.claimTypes, v.evidenceCaps, v.inferenceBasis)
 * // => 天文學 [ '觀測報告', '理論推導' ] { '理論推導': 1 } [ '理論' ]
 *
 * let v2 = resolveExtractVocab({ guide: { extract: { ruleTarget: '可直接用於觀測規劃的規則' } } })
 * console.log(v2.guide.extract.ruleTarget, v2.guide.extract.weakEvidence)
 * // => 可直接用於觀測規劃的規則 僅單一研究或未經獨立驗證
 */
export function resolveExtractVocab(override) {
    const o = vocabHeadOf(override, EXTRACT_VOCAB_KEYS, { nullAs: EXTRACT_VOCAB_NULL_AS, defaults: EXTRACT_VOCAB_DEFAULT })

    // 借用之鍵:各交擁有者驗證與合併(只交該擁有者之鍵;抓取共用之鍵之產物另複製,不與抓取套件之預設共用參照)
    const shared = cloneSettingsDefault(resolveCaptureVocab(pickCaptureVocab(o)))
    const sv = resolveSummarizeVocab(pickSummarizeVocab(pickVocabKeys(o, SUMMARIZE_KEYS)))
    const rv = resolveRelateVocab(pickRelateVocab(pickVocabKeys(o, RELATE_KEYS)))
    const guide = mergeGuideFields(EXTRACT_GUIDE_FIELDS, extractGuideDefaultOf(), o.guide)

    // 自有之鍵:整鍵替換;未給者取預設之複本(各次解析之產物互不共用預設常數之參照)
    const v = { ...cloneSettingsDefault(pickVocabKeys(EXTRACT_VOCAB_DEFAULT, OWN_KEYS)), ...pickVocabKeys(o, OWN_KEYS) }
    const levels = sv.evidenceLevels
    // 證據封頂:安裝方明給者嚴格檢查(鍵打錯即該內容類型靜默不封頂——等於退回灌水規則);
    //   未給者沿用預設表並只留現行內容類型之鍵(亦使本函數可重複套用)
    const types = [...sv.claimTypes, NOTE_PLACEHOLDERS.claimType]
    if (o.evidenceCaps !== undefined) {
        const caps = o.evidenceCaps
        if (!isobj(caps)) throw new Error('vocab.evidenceCaps 須為物件 { 內容類型: 等級名｜位置整數 }')
        for (const [k, val] of Object.entries(caps)) {
            if (!types.includes(k)) throw new Error(`vocab.evidenceCaps 之「${k}」不在 claimTypes（${types.join('、')}）`)
            if (!(Number.isInteger(val) || levels.includes(val))) throw new Error(`vocab.evidenceCaps.${k} 須為 evidenceLevels 之等級名（${levels.join('、')}）或位置整數（-1＝最低）`)
        }
    }
    else v.evidenceCaps = Object.fromEntries(Object.entries(EXTRACT_VOCAB_DEFAULT.evidenceCaps).filter(([k]) => types.includes(k)))
    // 證據性質封頂與自承限制片語:形狀錯誤於建構期拋錯(null 已依宣告視為未給)
    if (!isobj(v.basisCaps)) throw new Error('vocab.basisCaps 須為物件 { basis 關鍵詞: 等級名｜位置整數, "*": 皆不含時 }')
    for (const [k, val] of Object.entries(v.basisCaps)) {
        if (!String(k).trim()) throw new Error('vocab.basisCaps 之鍵不可為空字串')
        if (!(Number.isInteger(val) || levels.includes(val))) throw new Error(`vocab.basisCaps.${k} 須為 evidenceLevels 之等級名（${levels.join('、')}）或位置整數（0＝最高、-1＝最低）`)
    }
    // 推論類之證據性質:須為 basisCaps 之鍵(起草提示詞之「證據性質擇自」只列 basisCaps 之鍵;不在其中者模型無從標出)。
    //   未明給者取預設與 basisCaps 之鍵之交集(安裝方自訂 basisCaps 而不含預設詞者 → 無推論類＝一律須直接陳述;不因未給本鍵而拋錯)
    const capKeys = Object.keys(v.basisCaps).filter((k) => k !== '*')
    if (o.inferenceBasis === undefined) {
        v.inferenceBasis = EXTRACT_VOCAB_DEFAULT.inferenceBasis.filter((p) => !capKeys.length || capKeys.includes(p))
    }
    if (!isarr(v.inferenceBasis) || v.inferenceBasis.some((p) => !isestr(p))) throw new Error('vocab.inferenceBasis 須為字串陣列（[] 即一律須出處直接陳述）')
    const offList = v.inferenceBasis.filter((p) => !capKeys.includes(p))
    if (capKeys.length && offList.length) throw new Error(`vocab.inferenceBasis 之「${offList.join('、')}」不在 basisCaps 之鍵（${capKeys.join('、')}）——起草提示詞列不出,模型無從標為推論類`)
    if (!isarr(v.selfLimitPhrases) || v.selfLimitPhrases.some((p) => !isestr(p))) throw new Error('vocab.selfLimitPhrases 須為非空字串陣列（[] 即不封頂）')
    if (!isarr(v.absolutePhrases) || v.absolutePhrases.some((p) => !isestr(p))) throw new Error('vocab.absolutePhrases 須為非空字串陣列（[] 即不計）')
    // 推定詞:null＝不推定;給了須為生效之 basisCaps 之鍵(「*」除外)——標記取自 basisCaps 之鍵,不在其中者核心 md 標不出、證據封頂亦對不上
    if (v.presumedBasis !== null) {
        if (!isestr(v.presumedBasis) || !v.presumedBasis.trim()) throw new Error('vocab.presumedBasis 須為非空字串（basisCaps 之鍵）或 null（不推定）')
        if (!capKeys.includes(v.presumedBasis)) throw new Error(`vocab.presumedBasis 之「${v.presumedBasis}」不在 basisCaps 之鍵（${capKeys.join('、') || '無'}）——推定之標記取 basisCaps 之鍵`)
    }

    // 合併(依可用鍵之序):借用之鍵取各擁有者之產物(evidenceRule 為已編譯之規則物件、型別角色已推導)＋自有之鍵＋guide 之 extract 段
    const out = { ...shared, ...pickVocabKeys(sv, SUMMARIZE_KEYS), ...pickVocabKeys(rv, RELATE_KEYS), ...v, guide }
    return Object.fromEntries(EXTRACT_VOCAB_KEYS.map((k) => [k, out[k]]))
}


/**
 * 自任意詞彙表取本套件所讀之鍵(EXTRACT_VOCAB_KEYS;guide 只取 extract 段):他段與本套件共用一份詞彙表時,以此取子集交本套件
 *   (resolveExtractVocab 拒收其他鍵與他段)——鍵集只在本檔定義,呼叫端不另抄一份
 *
 * @param {Object} [vocab] 輸入詞彙表(可含他段之鍵)，非物件視為{}
 * @returns {Object} 回傳只含本套件所讀之鍵(未給者不列;guide 為物件時只留 extract 段〔有給才列〕)之新物件
 * @example
 * console.log(pickExtractVocab({ domain: '天文學', categoryHints: {}, basisCaps: { 觀測: 0 }, guide: { triage: { scopeLine: '' }, extract: { ruleTarget: '規則' } } }))
 * // => { domain: '天文學', basisCaps: { '觀測': 0 }, guide: { extract: { ruleTarget: '規則' } } }
 */
export function pickExtractVocab(vocab) {
    return pickVocabKeys(vocab, EXTRACT_VOCAB_KEYS, { guideSections: Object.keys(EXTRACT_GUIDE_FIELDS) })
}


/**
 * 詞彙之啟動期警告:安裝方換了內容類型清單(claimTypes)而未給證據封頂(evidenceCaps),使預設封頂表之鍵全數對不上 → 主張證據等級退回
 *   「取出處最高」(觀點、廠商等內容不再封頂)
 *
 * @param {Object} [vocab] 輸入安裝方之詞彙覆寫(未經解析者——解析後之詞彙恆帶 evidenceCaps,不判;可為整份共用之詞彙表或其子集)
 * @returns {Array} 回傳警告字串陣列(無需警告回 [])
 * @example
 * console.log(extractVocabWarningsOf({ claimTypes: ['論文', '部落格'] }).length, extractVocabWarningsOf({}).length)
 * // => 1 0
 */
export function extractVocabWarningsOf(vocab) {
    if (!isobj(vocab) || !isarr(vocab.claimTypes)) return []
    if (vocab.evidenceCaps !== undefined && vocab.evidenceCaps !== null) return []
    const hit = Object.keys(EXTRACT_VOCAB_DEFAULT.evidenceCaps).filter((k) => k !== NOTE_PLACEHOLDERS.claimType && vocab.claimTypes.includes(k))
    if (hit.length) return []
    return ['vocab.claimTypes 已自訂而未給 vocab.evidenceCaps：預設之內容類型封頂表無一鍵對得上，核心主張之證據等級只依出處筆記之等級與「最高級須 2 份文件」判定（觀點、廠商等內容不再封頂）；請依自訂之內容類型給 evidenceCaps']
}


export default {
    EXTRACT_GUIDE_FIELDS, EXTRACT_VOCAB_DEFAULT, EXTRACT_VOCAB_KEYS,
    extractGuideDefaultOf, resolveExtractVocab, pickExtractVocab, extractVocabWarningsOf,
}
