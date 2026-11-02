// extractRuntime.mjs — 提煉執行期件之組裝(唯一一份):本套件之總組裝 createKnowledgeExtract 與他總組裝(多工作之知識套件)共用,
//   呼叫端不另組任何提煉件
//
// 【組裝之件】資料檢核(cfg.data 之 vocab)、詞彙解析(提煉自有之鍵＋抓取／摘要／關聯之借用鍵)、概念鍵之折疊(與抓取套件同一單例、同一規則)、
//   提煉 domain(內建工廠＋提示詞覆寫,或注入之整組 domain——經成員表之形狀檢核)、關聯 domain(衝突型與型別改名;他總組裝交其生效之一份,
//   獨立組裝以關聯套件之工廠自建)、啟用之檢定標準所需之判定小組席位與 domain 成員之啟動期檢核、詞彙之啟動期警告;另有目錄之展開
//   (resolveExtractDirs:核心 md 之目錄與狀態檔之目錄;他總組裝以其 extra 交他工作之目錄,同一份展開與鍵集檢核)。
// 【為何獨立】總組裝各自逐段同型實作時,任一側新增 domain 成員、檢核條件或依賴,另一側即漂移;他總組裝以本函數組出同一組提煉件。
// 【呼叫端負責】cfg 之鍵集檢核(含 cfg.data、cfg.prompts 之鍵)、設定解析(resolveExtractSettings 或同形之設定)、AI 調度層與本機網路判斷、
//   集合之開關與每輪管線——提煉以外之件不在此。本函數**不檢 AI 調度層**(工作流入口之有無屬組裝者:測試或他總組裝可給無工作流入口之替身)。
// 【生效之 domain 只有一份】回傳之 domains 即每輪依賴之 deps.domains(extract、relate)與總組裝之 info().domains:管線、維運 API 與評分用同一套
//   提示詞;子階段 opt.domain 仍可另給(屬自組)。提示詞覆寫(opt.prompts)作用於內建 domain;注入整組 domain(opt.domains.extract)者即不經提示詞
//   覆寫——兩者同給即拋(其一會靜默失效)。
// 【domain 之注入只經 opt.domains】本函數不讀 cfg.domains:獨立總組裝把其 cfg.domains 交 opt.domains;他總組裝交其 cfg.domains 中屬本套件之子集
//   (EXTRACT_DOMAIN_KEYS;無注入時 {})——不讀整份 cfg.domains,他工作之 domain 不會被誤認。
// 【設定錯誤一律啟動期拋錯】檢定標準開啟而缺判定小組之必填席位或 domain 之對應成員(extractFeatureProblems;與提煉段之執行期同一判定、同一字樣)、
//   注入之 domain 不合成員表(extractDomainShapeProblems)、詞彙表不合規格、關聯 domain 缺衝突型等成員——皆在建構期拋,不等到該段第一次執行才爆。
// 【概念鍵之折疊為模組級單例】本函數以 cfg.conceptFold 之決定與詞彙表之概念改名／別名設定抓取套件之折疊(選題之概念分群讀之);同行程多個
//   實例以最後建構者為準(同一份詞彙之多工作共用時,各工作設定之值相同)。
// 【他總組裝之接法】(與摘要、關聯套件之執行期件同一接法)他總組裝以自己解析之詞彙表取本套件之子集、以 EXTRACT_DOMAIN_KEYS 取其 cfg.domains 中
//   屬本套件者、交其關聯之生效 domain:
//     createExtractRuntime(cfg, settings, { vocab: pickExtractVocab(整份詞彙), domains: <屬本套件者> || {}, relateDomain: <關聯之生效 domain> })
//   容量警告(筆記進料之上界)屬設定之自洽,他總組裝以 core/extractSettings 之 extractWarningsOf(settings, { inflow }) 取,不經本函數。
//   回傳之件與自建之件逐一對應:domains.extract ⇔ createExtractDomain({ vocab, prompts })(或注入者);domains.relate ⇔ opt.relateDomain;
//   folds ⇔ 抓取套件之 applyConceptFold(cfg.conceptFold, 詞彙);啟用功能之檢核 ⇔ 功能表之單一判定(extractFeatureProblems)。
// 【共用件】資料之解析、折疊之套用、提示詞覆寫之驗證與其和注入 domain 之衝突、domain 之合併取抓取套件之共用件(各工作之執行期件同一份);
//   注入之 domain:恆必填之成員由合併檢核、資料成員之形狀與選填成員之型別由成員表(extractDomainShapeProblems)檢核、依功能而必填者由功能表檢核。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { given, checkKeys, resolveDirsCfg, applyConceptFold, promptOverridesOf, promptDomainConflicts, promptDomainOf, promptsForDomain, mergeDomains, resolveDataCfg, resolveLocale } from './core/capturePackage.mjs'
import { createRelateDomain, pickRelateVocab, relateDomainNeedsOf } from './core/relatePackage.mjs'
import { resolveExtractVocab, extractVocabWarningsOf } from './core/vocab/extractVocab.mjs'
import { createExtractDomain, extractDomainShapeProblems, extractFeatureProblems, EXTRACT_PROMPT_SIGS, EXTRACT_DOMAIN_MEMBERS } from './domain/extractDomain.mjs'

/**
 * 提煉所用之集合(對外名;提煉子階段與維運 API 讀寫者):筆記(摘要套件寫入;提煉寫其提煉端欄位)、核心記錄、邊庫(關聯套件寫入;提煉讀之)、
 *   待判登錄(ES15／ES9／ES14／ES8／ES11／核心層)、檢核紀錄(ES9／ES8／ES11)、文件(抓取套件寫入;提煉讀其發布時間與來源)。
 *   notes、cores、relations、holds、checks 必開(判不了者須有處登錄、已檢者須有處記錄);docs 於獨立組裝為選開
 *
 * @type {Array}
 */
export const EXTRACT_STORE_KEYS = Object.freeze(['notes', 'cores', 'relations', 'holds', 'checks', 'docs'])

/**
 * 提煉所讀之資料鍵(cfg.data):詞彙覆寫 vocab
 *
 * @type {Array}
 */
export const EXTRACT_DATA_KEYS = Object.freeze(['vocab'])

/**
 * 提煉之輸出目錄(相對 workDir;交 resolveDirsCfg／expandDirs 之 extra):core＝核心 md;coreState＝核心狀態檔之目錄(null:未給者於覆寫之後衍生為
 *   core——狀態檔〔真理〕與 md〔投影〕同處、同受版控與備份,只覆寫 core 者狀態不會靜默分家;見 resolveExtractDirs)
 *
 * @type {Object}
 */
export const EXTRACT_DIRS = Object.freeze({ core: 'knowledge/core', coreState: null })

/**
 * 提煉之 domain 鍵(每輪 deps.domains 中屬本套件者;他總組裝之 cfg.domains 另有他工作之 domain 時,以此取子集交 opt.domains)
 *
 * @type {Array}
 */
export const EXTRACT_DOMAIN_KEYS = Object.freeze(['extract'])

// 提示詞覆寫之鍵與函數形式(定義在 domain/extractDomain;此處轉出同一實體,組裝者一處取齊)
export { EXTRACT_PROMPT_SIGS }

/** 各提示詞所屬之 domain(提示詞覆寫交提煉 domain 之工廠;與注入之同一 domain 擇一;由 domain 檔之 SIGS 推導——抓取套件之 promptDomainOf) */
const PROMPT_DOMAIN = promptDomainOf({ extract: EXTRACT_PROMPT_SIGS })

/** createExtractRuntime 之 opt 之可用鍵(打錯或已刪之鍵於組裝期拋「不認得之鍵」——不靜默略過) */
const RUNTIME_OPT_KEYS = Object.freeze(['vocab', 'prompts', 'domains', 'relateDomain'])

/** 選填之 domain 成員:成員表(EXTRACT_DOMAIN_MEMBERS)中非恆必填者——依功能而必填者由功能表判、選填者缺之即停用對應之步 */
const OPTIONAL_DOMAIN_MEMBERS = Object.freeze({ extract: Object.freeze(Object.entries(EXTRACT_DOMAIN_MEMBERS).filter(([, m]) => m.need !== 'always').map(([k]) => k)) })

/**
 * 提煉所讀之資料(cfg.data 之 vocab)之檢核與正規化(抓取套件之 resolveDataCfg;各工作同一份);cfg.data 之鍵集由呼叫端檢核(各總組裝之 cfg.data 可另有其鍵)
 *
 * @param {*} d 輸入 cfg.data，未給代表全用預設
 * @returns {Object} 回傳 { vocab:Object|null(安裝方原給之詞彙覆寫;null＝用內建預設) }
 * @throws {Error} 非物件、或 vocab 非物件時拋出
 * @example
 * console.log(resolveExtractData({ vocab: { domain: '天文學' } }).vocab.domain)
 * // => 天文學
 */
export function resolveExtractData(d) {
    return resolveDataCfg(d, { keys: EXTRACT_DATA_KEYS, vocabKeysOf: 'core/vocab/extractVocab 之 EXTRACT_VOCAB_KEYS' })
}

/**
 * 目錄之展開:workDir 展開基本目錄、他工作之目錄(extra)與提煉之目錄(EXTRACT_DIRS),cfg.dirs 逐鍵覆寫;coreState 於覆寫之後衍生(未給者＝core)
 *
 * 【他總組裝之接法】多工作之總組裝以 extra 交其他工作之目錄宣告(如摘要之 notes、關聯之 relations),與提煉之目錄同一份展開、cfg.dirs 之鍵集
 *   同一份檢核——不另寫一份目錄展開而靠人肉對齊。
 *
 * @param {String} workDir 輸入工作目錄
 * @param {*} dirsCfg 輸入 cfg.dirs(未給代表全用預設;鍵:基本目錄、extra 之目錄、core、coreState)
 * @param {Object} [extra={}] 輸入他工作之目錄 { 鍵: 相對 workDir 之子路徑 }(交 resolveDirsCfg 之 extra)，非物件視為{}；不可重定提煉之目錄
 * @returns {Object} 回傳全部目錄 { db, log, tmp, state, knowledge, …extra, core, coreState }(coreState 未給者＝core)
 * @throws {Error} extra 重定提煉之目錄(core、coreState)或基本目錄、cfg.dirs 非物件、含不認得之鍵或值非非空字串時拋出
 * @example
 * let d = resolveExtractDirs('c:/kb', { core: 'd:/vault/核心' })
 * console.log(d.core, d.coreState)
 * // => d:/vault/核心 d:/vault/核心
 *
 * console.log(resolveExtractDirs('c:/kb', undefined, { notes: 'knowledge/notes' }).notes)
 * // => c:/kb/knowledge/notes
 */
export function resolveExtractDirs(workDir, dirsCfg, extra = {}) {
    const upstream = isobj(extra) ? extra : {}
    const clash = Object.keys(upstream).filter((k) => k in EXTRACT_DIRS)
    if (clash.length) {
        throw new Error(`resolveExtractDirs 之 extra 不可重定提煉之目錄：${clash.join('、')}`)
    }
    const dirsExtra = { ...upstream, ...EXTRACT_DIRS }
    let coreState = null
    let rest = dirsCfg
    if (isobj(dirsCfg)) {
        // 可用鍵＝展開之目錄＋coreState(其預設為衍生值,不在展開之列——鍵集須另補,否則打錯鍵之訊息漏列之)
        checkKeys(dirsCfg, [...Object.keys(resolveDirsCfg(workDir, undefined, dirsExtra)), 'coreState'], 'cfg.dirs')
        const { coreState: cs, ...others } = dirsCfg
        if (Object.prototype.hasOwnProperty.call(dirsCfg, 'coreState') && !isestr(cs)) throw new Error('cfg.dirs.coreState 須為非空路徑字串')
        coreState = isestr(cs) ? cs : null
        rest = others
    }
    const dirs = resolveDirsCfg(workDir, rest, dirsExtra)
    return { ...dirs, coreState: coreState ?? dirs.core }
}

/**
 * 組裝提煉執行期件(檔頭):建構期即驗資料、解析詞彙、設定概念鍵之折疊、建 domain 並檢核啟用之檢定標準——設定錯誤要在啟動期爆
 *
 * @param {Object} cfg 輸入總組裝之 cfg(讀 lang、data、conceptFold)
 * @param {Object} settings 輸入解析後之設定(讀 extract;本套件之 resolveExtractSettings 或他總組裝之同形設定)
 * @param {Object} [opt={}] 輸入設定物件(鍵限 RUNTIME_OPT_KEYS:vocab、prompts、domains、relateDomain)
 * @param {Object} [opt.vocab] 輸入交本套件之詞彙(只含本套件所讀之鍵,見 pickExtractVocab);**須為安裝方原給之詞彙**(未解析者——詞彙之啟動期警告以之
 *   判安裝方是否自訂,解析後之詞彙已含預設而判不出);未給即用 cfg.data.vocab
 * @param {Object} [opt.prompts] 輸入提示詞覆寫(鍵與函數形式見 EXTRACT_PROMPT_SIGS;呼叫端已檢核之 cfg.prompts),作用於內建 domain
 * @param {Object} [opt.domains] 輸入交本套件之 domain 注入 { extract? }(檔頭【domain 之注入只經 opt.domains】;未給＝無注入)
 * @param {Object} [opt.relateDomain] 輸入關聯之生效 domain(他總組裝交其一份;須具 conflictType、conflictTypeNames、resolveType——判準為關聯套件之
 *   relateDomainNeedsOf),未給即以關聯套件之 createRelateDomain(pickRelateVocab(詞彙)) 自建
 * @returns {Object} 回傳 { data:{ vocab }(原給), vocab(已解析), locale(語言設定:抓取套件 resolveLocale 之產物), folds:{ fold, clueFold }, domains:{ extract, relate }(生效之一份),
 *   warnings:Array(詞彙之警告;容量與判定小組同家之警告不在此——見 core/extractSettings 之 extractWarningsOf 與 settings.warnings) }
 * @throws {Error} opt 含不認得之鍵、settings 不含 extract、cfg.lang 不合、cfg.data 形狀不合、詞彙表不合規格、cfg.conceptFold 型別不合、opt.prompts 不合(非物件、不認得之鍵、
 *   值非函數)、opt.domains 非物件或含不認得之鍵、提示詞覆寫與注入之 domain 同給、注入之 domain 缺恆必填之成員或不合成員表之形狀、
 *   關聯 domain 缺成員、檢定標準開啟而缺判定小組之必填席位或 domain 之對應成員時拋出
 * @example
 * need test in nodejs.
 *
 * let rt = createExtractRuntime({ data: { vocab: { domain: '天文學' } } }, resolveExtractSettings({}))
 * console.log(rt.vocab.domain, rt.domains.extract.claimKinds, rt.domains.relate.conflictType)
 * // => 天文學 [ 'principle', 'rule', 'pitfall', 'temporal' ] 衝突或反例
 */
export function createExtractRuntime(cfg, settings, opt = {}) {
    if (!isobj(cfg)) cfg = {}
    if (!isobj(opt)) opt = {}
    checkKeys(opt, RUNTIME_OPT_KEYS, 'createExtractRuntime 之 opt')
    if (!isobj(settings?.extract)) throw new Error('createExtractRuntime 需要解析後之 settings(含 extract)')

    // ── 語言設定(cfg.lang;抓取套件之 core/locale):提示詞之輸出語言句、字形政策、折疊方向——與抓取套件同讀此一份 ──
    const locale = resolveLocale(cfg.lang)

    // ── 資料與詞彙(設定錯誤在建構期即爆)、概念鍵之折疊(檔頭)──
    const data = resolveExtractData(cfg.data)
    const vocabIn = isobj(opt.vocab) ? opt.vocab : data.vocab
    const vocab = resolveExtractVocab(vocabIn)
    const folds = applyConceptFold(cfg.conceptFold, vocab, locale)

    // ── 提煉 domain:內建工廠(詞彙、提示詞覆寫)→ 與注入者合併(生效之一份;注入者:恆必填之成員、成員表之形狀;依功能而必填者見下之功能檢核)──
    const prompts = promptOverridesOf(opt.prompts, EXTRACT_PROMPT_SIGS, 'createExtractRuntime')
    const conflicts = promptDomainConflicts(prompts, opt.domains, PROMPT_DOMAIN)
    if (conflicts.length) throw new Error(conflicts.join('；'))
    const { extract } = mergeDomains({ extract: createExtractDomain({ vocab, locale, prompts: promptsForDomain(prompts, PROMPT_DOMAIN, 'extract') }) }, opt.domains, {
        optional: OPTIONAL_DOMAIN_MEMBERS,
        factories: { extract: 'createExtractDomain({ vocab })' },
        check: (k, d) => extractDomainShapeProblems(d),
    })

    // ── 關聯 domain:他總組裝交其生效之一份;獨立組裝以關聯套件之工廠自建(詞彙取關聯之鍵)──
    let relate
    if (given(opt.relateDomain)) {
        // 提煉段讀之成員(衝突型、其舊名、型別現名化)之缺漏:判準在關聯套件(relateDomainNeedsOf),提煉段之執行期同讀
        const miss = relateDomainNeedsOf(opt.relateDomain)
        if (miss.length) throw new Error(`createExtractRuntime 之 opt.relateDomain 缺 ${miss.join('、')}（提煉之衝突重審、衝突之去向與關聯變更之影響依之判定）`)
        relate = opt.relateDomain
    }
    else relate = createRelateDomain({ vocab: pickRelateVocab(vocab), locale })

    // ── 啟用之檢定標準所需之判定小組席位與 domain 成員(與提煉段之執行期同一判定、同一字樣)──
    const problems = extractFeatureProblems(settings, extract, { domainLabel: 'cfg.domains.extract' })
    if (problems.length) throw new Error(problems.join('；'))

    // ── 啟動期警告:詞彙(自訂內容類型而未給證據封頂;判安裝方原給之詞彙)──
    const warnings = [...extractVocabWarningsOf(vocabIn)]
    return { data, vocab, locale, folds, domains: { extract, relate }, warnings }
}

export default {
    EXTRACT_STORE_KEYS, EXTRACT_DATA_KEYS, EXTRACT_DIRS, EXTRACT_DOMAIN_KEYS, EXTRACT_PROMPT_SIGS,
    resolveExtractData, resolveExtractDirs, createExtractRuntime,
}
