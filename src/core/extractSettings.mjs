// extractSettings.mjs — 提煉之設定預設值、schema 與解析(安裝即用;執行端 cfg 逐鍵覆寫)
//
// 【兩段】ai(AI 調度層:抓取套件之 ai 段,健康降序預設開——提煉每輪多棒、呼叫量大,連續失敗之條目宜移到鏈尾;預設取摘要套件之 ai 段之一份,
//   不含 parallel——提煉不讀此鍵:每輪之概念數由 extract.perRun 定,3+3 之起草三席同時、其餘逐棒)、extract(提煉之全部設定)。extract 依提煉之要點分組:
//   要點 1 整合既有知識與關聯提煉成核心知識(選題、批次、3+3 席位)、要點 2 知識或關聯變更時更新受影響之核心(recheck)、
//   檢定標準(standards:各覆核之開關、共用之判定小組、符合度掃描)。推導值在 capacity(唯讀)。
// 【合併】組(物件節點)逐鍵遞迴合併:只給想調的鍵,其餘沿用預設;葉(含 3+3 席位)給了即整個取代——席位成組設計,給了即整份取代。
//   合併與共用型別之規則取抓取套件之 mergeSettingsGroup(各套件同一份規則,不另寫);只本段用得到之型別(關聯脈絡之型別、類別後備、
//   3+3 席位)以 EXTRACT_SETTING_TYPES 經其 opt.types 帶入,不加進各段共用之型別表。席位之形狀一律取抓取套件之 seatProblem(3+3 之七席逐席驗;
//   判定小組之席即其 seatOrNull)——與 AI 調度層之啟動期檢核同一判準,打錯之鍵在解析設定時即拋,不等到呼叫時才爆。
// 【免費 AI 為主】預設席位全為免費模型(兩家輪替:起草三席之首選為 mimo、big-pickle、mimo,整合、審計、修訂、終審之首選輪流);付費家由安裝方加於 fallback 尾。
// 【設定錯誤一律啟動期拋錯,不靜默回預設】各組之鍵以 schema 逐鍵驗型別與值域、不認得之鍵拋錯、組給了但形狀錯亦拋、本函數不收之段亦拋——
//   安裝方之設定是刻意為之,靜默改用套件預設(如席位退回預設家、'27' 被算成字串)比拋錯更難察覺。
// 【容量自洽】提煉是真正的佇列(已用過之筆記逐核心累積,容量不足即無界積壓):每輪容量 extract.perRun×extract.notesPerConcept 須 ≥ 筆記進料
//   之上界。進料上界屬上游之推導,由組裝者以 extractWarningsOf 之 inflow 給;只警告「進料 > 容量」,不警告「容量閒置」(容量是上限不是成本)。
//   extract.perRun 0＝刻意停用,不警告。
// 【判定小組】各覆核共用一組席位(extract.standards.ai):兩票之實際成交供應者須不同才成立——已開啟而首兩席首選同家且無首選不同之第三席者,
//   啟動期警告(永遠無法成立)。修訂席(extract.ai.revise)只改寫措辭,不投票。小組之組成、同家之判定與警告之字樣取摘要套件之判定小組設定面
//   (panelConfig;三工作同一份)。
// 【功能表之設定面只在本檔】各覆核(出處支持、出處支持之存量、失撐主張、爭議、同義核心)之稱呼、開啟判準與判定小組之必填席只在 EXTRACT_FEATURES
//   ——判定小組之開啟與必填、domain 成員之必填條件(成員表 EXTRACT_DOMAIN_MEMBERS 依功能之鍵)、功能之問題(extractFeatureProblems)同讀,不各寫一份。
// 【席位之知識只在本檔】3+3 之席位路徑、顯示名、判定小組之組成與開啟判準、3+3 之席位語意提示(起草多樣性、審計與終審換家)——組裝者與
//   席位檢核工具取本檔之 API,不另寫席位路徑。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { mergeSettingsGroup, cloneSettingsDefault, seatProblem, seatsFrom, seatLabelsFrom, AI_SCHEMA, unknownKeysProblem, checkKeys, featureProblemsOf } from './capturePackage.mjs'
import { PANEL_SCHEMA, panelGroupOf, panelSameProviderWarnings, panelSeatRowsOf, SUMMARIZE_AI_DEFAULT, notesInflowProblem } from './summarizePackage.mjs'


/**
 * ai 段之預設:摘要套件之 ai 段預設(抓取套件之 AI 調度層預設＋健康降序 3;健康降序之預設只在摘要套件)取 ai 段之 schema(抓取套件之 AI_SCHEMA)
 *   之鍵——正向取鍵:摘要之 ai 段另有之鍵(parallel 等;提煉不讀,每輪之概念數由 extract.perRun 定)不會漏進來。
 *   鍵序取預設本身(＝抓取套件之 AI_DEFAULT 之序,摘要套件之預設由其展開而來),不取 AI_SCHEMA 之序:抓取套件之 schema 與預設之鍵序可不同
 *   (1.0.18 新增之 cooldownGrowth／cooldownMaxMs 在預設緊接 cooldownMs、在 schema 則排最後),以 schema 之序組出會使本段之鍵序偏離抓取套件
 *
 * @type {Object}
 */
export const EXTRACT_AI_DEFAULT = cloneSettingsDefault(Object.fromEntries(Object.keys(SUMMARIZE_AI_DEFAULT).filter((k) => k in AI_SCHEMA).map((k) => [k, SUMMARIZE_AI_DEFAULT[k]])))

/** ai 段之 schema:抓取套件之 ai 段(同一物件,不另寫;不含 parallel) */
export const EXTRACT_AI_SCHEMA = AI_SCHEMA


/** 提煉(extract)之預設 */
export const EXTRACT_DEFAULT = {
    // ── 要點 1:整合既有知識與關聯,提煉成核心知識(主張庫＋差量,3+3 工作流;stages/extractStage)──
    // 每輪提煉幾個概念。容量＝perRun×notesPerConcept 篇(追趕另計),須 ≥ 筆記進料上界:已用過逐核心累積,提煉是真正的佇列,容量不足即無界積壓。
    //   靜態檢核只是必要條件——實際消化受部分批與輪流影響,宜由外部巡檢量「實際消化／進料」。0＝停用
    perRun: 4,
    notesPerConcept: 12, // 一批之篇數
    minNotes: 6, // 新核心門檻:主標籤可提煉篇數(門檻過低者,如只根據 2 篇之核心,實為兩篇摘要而非提煉)
    // 既有核心未滿一批時之入選下限(須同時等待 ≥ maxWaitDays):每次入選約 7 次 AI 呼叫(3+3),為 1～3 篇開工會吃掉名額
    minPending: 4,
    maxWaitDays: 30, // 未滿一批者須等待之天數(少量新料終會併入,但不以部分批占名額)
    catchupBatches: 3, // 積壓核心同輪至多連續幾批(每批一般差量;以剩餘時間守門);樞紐概念只靠輪流追不上其進料
    relateGraceDays: 3, // 未關聯之筆記延後入選之寬限天數(衝突章由關聯套件寫入;先提煉即錯過爭議材料)
    sourceCap: 2, // 同一來源每批上限(不足一批時放寬)
    noteTries: 2, // 批內未被涵蓋(未被引用、未列略過)之筆記至多送幾次(含首次):第 noteTries 次仍未涵蓋即出隊、標已用並記原因
    claimsCap: 80, // 有效主張數逾此值即排入整併(每 consolidateEvery 版至多一次)
    consolidateEvery: 5,
    // 開工與每一步(待審／整併／每批)之門檻:本輪剩餘時間不足即不再開始下一步(截止時本 pass 不套用、下輪再做)。
    //   一批 5～7 棒、單棒可達 442 秒,門檻過小會讓每批在最後幾棒被截止作廢;15 分為估值,宜以執行摘要之截止次數校準
    minRemainingMs: 900_000,
    // 起草提示詞【關聯脈絡】所列之關聯型別:'conflict' 只列衝突型;'linked' 衝突型＋兩端皆在本批或為核心已引之他型;
    //   'all' 觸及本批之全部型別(衝突在前、新到舊、上限 40 列)
    relationTypes: 'conflict',
    // 類別後備(預設停用;給物件 { minNotes, minGain } 才開啟):概念層無目標之閒置輪,以「久候孤兒」(主概念無核心、主標籤篇數未達
    //   minNotes、建立逾 maxWaitDays)建／更新類別核心,每輪 1 批。預設停用之理由:篇數不足者不建核心;類別核心之材料異質、只增不減;
    //   概念層於新庫數小時～數天內即有目標。未達門檻之概念要收斂,請以 vocab.conceptAliases 併入上位概念
    categoryFallback: null,
    // 席位(3+3:三家獨立起草 → 整合 → 審計 → 修訂 → 終審 → 程式套用;起草 runFanout、其餘 callAi)。差量之單次呼叫可達 442 秒,
    //   各席 600 秒。預設為兩家免費模型輪替:起草三席之首選依序為 mimo、big-pickle、mimo(只有兩家,故第三席與第一席同家;計票以實際成交之
    //   供應者計),整合、審計、修訂、終審之首選輪流,遞補為另一家——只有兩家時審計與終審之首選必與某起草席同家(席位語意提示見 extractSeatHintsOf)。
    //   各家於差量各棒之適任須以評比為準,安裝方應覆寫為自己評比選定之席位;給了即整份取代(席位成組設計)
    ai: {
        drafters: [
            { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'], timeoutMs: 600_000, minAttemptMs: 90_000 },
            { use: 'oc:opencode/big-pickle', fallback: ['oc:opencode/mimo-v2.6-flash-free'], timeoutMs: 600_000, minAttemptMs: 90_000 },
            { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'], timeoutMs: 600_000, minAttemptMs: 90_000 },
        ],
        integrate: { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'], timeoutMs: 600_000, minAttemptMs: 90_000 },
        audit: { use: 'oc:opencode/big-pickle', fallback: ['oc:opencode/mimo-v2.6-flash-free'], timeoutMs: 600_000, minAttemptMs: 90_000 },
        revise: { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'], timeoutMs: 600_000, minAttemptMs: 90_000 },
        accept: { use: 'oc:opencode/big-pickle', fallback: ['oc:opencode/mimo-v2.6-flash-free'], timeoutMs: 600_000, minAttemptMs: 90_000 },
    },

    // ── 要點 2:知識或關聯變更時更新受影響之核心 ──
    // 重審:已提煉筆記內容變更、或與核心所引筆記新判衝突 → 以 3+3 重審該核心
    recheck: {
        slots: 3, // 一般批內保留給重審筆記之格數(0＝不搭便車)
        perRun: 1, // 每輪至多幾個僅重審 pass(0＝停用;每個約 6～7 次呼叫)
        guard: 20, // 單輪內容變更篇數之守門(逾者不排重審並告警,防格式腳本等批次改寫無聲排入大量重審)
        waitDays: 7, // 衝突重審之最長等待天數
        // 關聯變更之影響(檢定標準 ES10;standards/relationImpact):開啟時每輪以邊庫快照差分產生全型別之影響事件,逐核心處置並記帳
        //   (狀態目錄下之影響帳,「不需更新」亦附理由):非衝突新關聯之另一端入夥伴候選(重審管道之最低優先);經夥伴入批者之
        //   關聯撤銷／改型／改理由 → 重審;衝突理由更新而有未決爭議之兩方分含兩端 → 重審。開啟後首輪只建快照(不產事件);每輪載入全部邊
        relationImpact: false,
    },

    // ── 檢定標準(各項開啟條件:該標準之評分題組以正式席位逐案兩次全過)──
    standards: {
        // 出處支持覆核(ES9;workflow/supportGate):定稿於套用前判新增／確認／改寫之主張與爭議各方是否受所引出處支持,
        //   未受支持者不採、判不了者不採並入待判(下次重送);缺票或同一供應者(基礎設施)→ 操作存待審、不計失敗。
        //   maxTries:同一筆記之覆核判不了逾此次數(含待審裁決之再判)→ 改由使用者判讀(負責者 user)
        supportCheck: { enabled: false, maxTries: 3 },
        // 出處支持之存量覆核(ES9 存量;workflow/supportStockPass):每輪至多幾條既有有效主張判是否仍受其存活出處支持——語氣超出證據者
        //   依出處收斂措辭(修訂席 extract.ai.revise)後重判;不受支持者撤回(可由使用者還原);判不了者隔離＋待判。0＝停用;存量全量須使用者同意配額。
        //   maxTries:同一主張缺票或同一供應者逾此次數 → 隔離＋待判(使用者)
        supportStock: { perRun: 0, maxTries: 3 },
        // 失撐主張之專責佇列(ES8;workflow/orphanPass):出處筆記全數已刪除之主張,每輪至多幾個核心,於該核心全部已消化筆記中找支持——
        //   兩席判有支持 → 補出處;兩席判皆無 → 撤回(出處筆記還原即還原);判不了 → 待判。0＝停用。maxTries:同一主張缺票或同一供應者逾此次數 → 待判
        orphanCheck: { perRun: 0, maxTries: 3 },
        // 爭議覆核(ES14;workflow/disputePass):終審存疑之未解決爭議,於起草者已有一次機會後(核心再升版 minVersions 版,或存疑逾 waitDays 天)
        //   判是否真對立:真對立 → 存疑結案;非對立 → 拆解(經同一納入閘);判不了 → 待判。每輪至多 perRun 則(0＝停用——開啟判準只此一鍵);
        //   缺票或同一供應者逾 maxTries 次 → 待判
        disputeCheck: { perRun: 0, minVersions: 1, waitDays: 7, maxTries: 3 },
        // 同義核心核對(ES11;stages/synonymStep):每輪至多幾對候選(主核心概念名之名稱相近者＋AI 提議者)判是否同一概念——
        //   同一概念者登錄待判(建議 vocab.conceptAliases 之別名;不改詞彙表)。0＝停用。maxTries:同一對缺票或同一供應者逾此次數 → 待判(使用者)
        synonymCheck: { perRun: 0, maxTries: 3 },
        // 上列各項共用之判定小組:first、second 並行(second 項序打亂),未成立而可成立者叫 third;兩票之實際成交供應者須不同才成立,
        //   故宜取不同家族、且與提煉起草席不同。任一項開啟時 first、second 必填
        ai: { first: null, second: null, third: null },
        // 符合度掃描:每輪管線結束後掃一次提煉之確定性標準(ES*;不呼叫 AI),違反數入執行摘要。
        //   預設關閉:掃描逐核心讀狀態與出處筆記,大庫耗時;由安裝端依庫規模開啟
        scanEachRun: false,
    },
}


/**
 * 提煉席位之鍵(3+3 工作流;首鍵為起草三席,其餘依棒序)
 *
 * @type {Array}
 */
export const EXTRACT_SEAT_KEYS = Object.freeze(['drafters', 'integrate', 'audit', 'revise', 'accept'])

/** 起草之席數(三家獨立起草;計票以實際成交之供應者計) */
const DRAFTERS = 3

/**
 * 提煉席位之設定問題(3+3:三家獨立起草＋整合、審計、修訂、終審);合格回空字串。設定之解析(啟動期)與提煉段(執行期)共用此判準
 *
 * @param {Object} d 輸入 settings.extract.ai
 * @returns {String} 回傳問題說明(合格回 '')
 * @example
 * console.log(extractSeatsProblem({ drafters: [] }) !== '')
 * // => true
 *
 * console.log(extractSeatsProblem(resolveExtractSettings({}).extract.ai))
 * // =>
 */
export function extractSeatsProblem(d) {
    if (!isobj(d)) return '提煉需要 settings.extract.ai = { drafters:[3 席], integrate, audit, revise, accept }(3+3 工作流之席位)'
    const unknown = unknownKeysProblem(d, EXTRACT_SEAT_KEYS, 'settings.extract.ai')
    if (unknown) return `${unknown}——3+3 工作流＝三家獨立起草 → 整合 → 審計 → 修訂 → 終審 → 程式套用`
    if (!Array.isArray(d.drafters) || d.drafters.length !== DRAFTERS || !d.drafters.every((s) => isobj(s) && s.use)) return `settings.extract.ai.drafters 須為 ${DRAFTERS} 個席位 [{ use, fallback }, …](三家獨立起草)`
    const missing = EXTRACT_SEAT_KEYS.slice(1).filter((k) => !isobj(d[k]) || !d[k].use)
    if (missing.length) return `settings.extract.ai 缺席位：${missing.join('、')}(各為 { use, fallback, timeoutMs?, minAttemptMs? })`
    return ''
}


/**
 * 3+3 席位之型別之問題(設定型別 extractSeats 之判準;合格回 ''):先驗 3+3 之結構(extractSeatsProblem),再逐席驗形狀(抓取套件之 seatProblem——
 *   與 AI 調度層之啟動期檢核同一判準;各席之問題一併列出)
 *
 * @param {*} d 輸入 settings.extract.ai
 * @returns {String} 回傳問題說明(合格回 '')
 */
function extractSeatsTypeProblem(d) {
    const structural = extractSeatsProblem(d)
    if (structural) return structural
    const seats = [...d.drafters.map((s, i) => [`drafters[${i}]`, s]), ...EXTRACT_SEAT_KEYS.slice(1).map((k) => [k, d[k]])]
    const bad = seats.map(([k, s]) => [k, seatProblem(s)]).filter(([, p]) => p)
    return bad.length ? `settings.extract.ai 之席位不合：${bad.map(([k, p]) => `${k} → ${p}`).join('；')}` : ''
}

/** 類別後備之物件所收之鍵(皆為正整數) */
const CATEGORY_FALLBACK_KEYS = Object.freeze(['minNotes', 'minGain'])

/**
 * 本段專屬之設定型別(名稱 → { test, desc, why? };經抓取套件 mergeSettingsGroup 之 opt.types 帶入,不加進各段共用之型別表):
 *   關聯脈絡之型別、類別後備、3+3 席位(結構＋逐席之形狀);判定小組之席沿用抓取套件之 seatOrNull
 *
 * @type {Object}
 */
export const EXTRACT_SETTING_TYPES = Object.freeze({
    relationTypes: Object.freeze({ test: (v) => ['conflict', 'linked', 'all'].includes(v), desc: "'conflict'｜'linked'｜'all'" }),
    // 類別後備:null／false 停用;物件只收 minNotes、minGain(正整數)
    categoryFallback: Object.freeze({
        test: (v) => v === null || v === false || (isobj(v) && Object.keys(v).every((k) => CATEGORY_FALLBACK_KEYS.includes(k)) && CATEGORY_FALLBACK_KEYS.every((k) => v[k] === undefined || (Number.isInteger(v[k]) && v[k] > 0))),
        desc: 'null／false（停用）或物件 { minNotes?:正整數, minGain?:正整數 }',
    }),
    extractSeats: Object.freeze({ test: (v) => extractSeatsTypeProblem(v) === '', desc: '提煉席位 { drafters:[3 席], integrate, audit, revise, accept }', why: extractSeatsTypeProblem }),
})

/** extract 段之 schema(判定小組之三席取摘要套件之 PANEL_SCHEMA)(與 EXTRACT_DEFAULT 同形;節點為字串＝葉之型別名,為物件＝組) */
export const EXTRACT_SCHEMA = {
    // perRun 0＝停用提煉,合法
    perRun: 'p0int', notesPerConcept: 'pint', minNotes: 'pint', minPending: 'pint', maxWaitDays: 'p0num', catchupBatches: 'pint',
    relateGraceDays: 'p0num', sourceCap: 'pint', noteTries: 'pint', claimsCap: 'pint', consolidateEvery: 'pint', minRemainingMs: 'p0int',
    relationTypes: 'relationTypes', categoryFallback: 'categoryFallback', ai: 'extractSeats',
    recheck: { slots: 'p0int', perRun: 'p0int', guard: 'pint', waitDays: 'p0num', relationImpact: 'bool' },
    standards: {
        supportCheck: { enabled: 'bool', maxTries: 'pint' },
        supportStock: { perRun: 'p0int', maxTries: 'pint' },
        orphanCheck: { perRun: 'p0int', maxTries: 'pint' },
        disputeCheck: { perRun: 'p0int', minVersions: 'p0int', waitDays: 'p0num', maxTries: 'pint' },
        synonymCheck: { perRun: 'p0int', maxTries: 'pint' },
        ai: PANEL_SCHEMA,
        scanEachRun: 'bool',
    },
}

/**
 * 提煉設定是否已解析(提煉段開工之守門;各段之值一律取解析後之設定,不另寫退路):settings.extract 須具 EXTRACT_SCHEMA 之全部鍵(組逐層;葉只驗在場——
 *   預設為 null 之葉〔判定小組之席、類別後備〕缺之即同 null,不算缺)、且以同一 schema 與型別(EXTRACT_SETTING_TYPES)重驗合格——
 *   resolveExtractSettings 或他總組裝以同一 schema 解析之設定恆合格
 *
 * @param {Object} settings 輸入每輪依賴之 settings(取 extract)
 * @returns {String} 回傳問題(合格回 '')
 * @example
 * console.log(extractResolvedProblem(resolveExtractSettings({})), extractResolvedProblem({ extract: { perRun: 1 } }).slice(0, 26))
 * // =>  settings.extract 未經解析（缺 se
 */
export function extractResolvedProblem(settings) {
    const x = settings?.extract
    if (!isobj(x)) return '提煉需要解析後之 settings.extract（resolveExtractSettings 之產物）'
    const missing = []
    const walk = (schema, dflt, v, at) => {
        for (const [k, node] of Object.entries(schema)) {
            if (!isobj(v) || !(k in v)) {
                if (!(typeof node === 'string' && dflt?.[k] === null)) missing.push(`${at}.${k}`)
            }
            else if (typeof node !== 'string') walk(node, dflt?.[k], v[k], `${at}.${k}`)
        }
    }
    walk(EXTRACT_SCHEMA, EXTRACT_DEFAULT, x, 'settings.extract')
    if (missing.length) return `settings.extract 未經解析（缺 ${missing.join('、')}）：提煉之各值只取解析後之設定（resolveExtractSettings 或以 EXTRACT_SCHEMA 解析之同形設定）`
    try {
        mergeSettingsGroup('extract', x, EXTRACT_SCHEMA, EXTRACT_DEFAULT, { types: EXTRACT_SETTING_TYPES })
    }
    catch (e) {
        return e.message
    }
    return ''
}

/** resolveExtractSettings 所收之段(頂層之其他鍵屬組裝者或他工作,交之即拋) */
const SECTIONS = Object.freeze(['ai', 'extract'])


/**
 * 提煉之每輪容量(由已解析設定推導之唯一來源;容量自洽檢核與外部巡檢取用,不另推導)。提煉每篇筆記恰落一個概念之待提煉(只計主標籤;
 *   次標籤只補位),故以篇計
 *
 * @param {Object} settings 輸入已解析之設定(resolveExtractSettings 之產物,或同形之 { extract })
 * @returns {Object} 回傳 { extract:提煉容量＝extract.perRun×extract.notesPerConcept }
 * @example
 * console.log(extractCapacityOf(resolveExtractSettings({})))
 * // => { extract: 48 }
 */
export function extractCapacityOf(settings) {
    const { extract } = settings
    return { extract: extract.perRun * extract.notesPerConcept }
}

/**
 * 容量之推導式說明(警告與巡檢訊息引用;式之單一來源為 extractCapacityOf)
 *
 * @type {Object}
 */
export const EXTRACT_CAPACITY_DESC = Object.freeze({
    extract: 'extract.perRun×extract.notesPerConcept',
})


/** 判定小組之設定路徑(各覆核共用一組) */
const PANEL_PATH = 'extract.standards.ai'

/**
 * 提煉之功能表之設定面(唯一一份;抓取套件之 featureProblemsOf 之表,所需之 domain 成員與額外檢核由 domain/extractDomain 之成員表補上——
 *   extractFeatureProblems):檢定標準之各覆核之稱呼(含開啟之設定)、開啟判準、判定小組之必填席(各覆核共用 extract.standards.ai,
 *   first、second 必填——只有一席永遠判不成)。出處支持覆核(ES9 新進)、出處支持之存量覆核(ES9 存量)、失撐主張之專責佇列(ES8)、
 *   爭議覆核(ES14)、同義核心核對(ES11)。判定小組之開啟與必填(extractPanelsOf)、功能之問題(extractFeatureProblems)同讀
 *
 * @type {Array}
 */
export const EXTRACT_FEATURES = Object.freeze([
    { key: 'supportCheck', what: '出處支持覆核(extract.standards.supportCheck.enabled)', on: (s) => s?.extract?.standards?.supportCheck?.enabled === true },
    { key: 'supportStock', what: '出處支持存量覆核(extract.standards.supportStock.perRun > 0)', on: (s) => s?.extract?.standards?.supportStock?.perRun > 0 },
    { key: 'orphanCheck', what: '失撐主張專責佇列(extract.standards.orphanCheck.perRun > 0)', on: (s) => s?.extract?.standards?.orphanCheck?.perRun > 0 },
    { key: 'disputeCheck', what: '爭議覆核(extract.standards.disputeCheck.perRun > 0)', on: (s) => s?.extract?.standards?.disputeCheck?.perRun > 0 },
    { key: 'synonymCheck', what: '同義核心核對(extract.standards.synonymCheck.perRun > 0)', on: (s) => s?.extract?.standards?.synonymCheck?.perRun > 0 },
].map((f) => Object.freeze({ ...f, panel: Object.freeze({ path: PANEL_PATH, seats: Object.freeze(['first', 'second']) }) })))

/** 判定小組之各席(鍵 → 顯示名;一起投票之組合為 [first, second, third];席位表之列取摘要套件之 panelSeatRowsOf) */
const PANEL_ROWS = Object.freeze(panelSeatRowsOf(PANEL_PATH, [['first', '提煉覆核第一席'], ['second', '提煉覆核第二席'], ['third', '提煉覆核第三席']], (x) => x?.standards?.ai).map((r) => Object.freeze(r)))

/**
 * 判定小組之定義(摘要套件之 panelConfig 之小組定義;單一組:各覆核共用 extract.standards.ai)
 *
 * @type {Object}
 */
const PANEL_DEF = Object.freeze({
    std: 'ES9／ES14／ES8／ES11',
    path: PANEL_PATH,
    name: '提煉覆核',
    members: (s) => ['first', 'second', 'third'].map((k) => ({ key: k, label: k, seat: s.extract.standards?.ai?.[k] })),
})

/**
 * 提煉之判定小組(單一組:各覆核共用 extract.standards.ai;席位檢核工具與啟動期同家警告同讀,呼叫端不另寫小組之組成;摘要套件之 panelGroupOf):
 *   標準、設定路徑、名稱、是否開啟(各覆核任一項開啟)、成員(顯示名、席位〔null＝未設〕、是否必填——由功能表推導)與一起投票之組合
 *   (ballots:[首票, 次票, 第三席] 之成員索引)。修訂席不在小組內(只依出處收斂措辭,不投票)
 *
 * @param {Object} settings 輸入已解析之設定(取 extract;本套件或組裝者之 resolve 產物皆可)
 * @returns {Array} 回傳 [{ std, path, name, on:Boolean, members:[{ label, seat:Object|null, required:Boolean }], ballots:[[0, 1, 2]] }](無 extract 段回 [])
 * @example
 * console.log(extractPanelsOf(resolveExtractSettings({})).map((g) => `${g.std}:${g.on}`))
 * // => [ 'ES9／ES14／ES8／ES11:false' ]
 */
export function extractPanelsOf(settings) {
    if (!isobj(settings?.extract)) return []
    return [panelGroupOf(PANEL_DEF, settings, EXTRACT_FEATURES)]
}

/**
 * 提煉之啟動期警告:容量自洽(只在組裝者給進料上界時判;只警告「進料 > 容量」;extract.perRun 0＝停用不判)、已開啟之判定小組兩席同家。
 *   resolveExtractSettings 之 warnings 即本函數不給 inflow 之結果;他總組裝以自己解析之同形設定(含 extract;其 ai 段可另有本套件不收之鍵)
 *   取同一組警告,不另寫判準與字樣
 *
 * @param {Object} settings 輸入已解析之設定 { extract }
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.inflow] 輸入筆記進料之上界 { max:非負數(篇/輪), desc:非空字串(推導式說明,入警告訊息) },未給則不判容量
 * @returns {Array} 回傳警告字串陣列(容量在前,其次判定小組)
 * @throws {Error} opt.inflow 給了而形狀不符時拋出
 * @example
 * console.log(extractWarningsOf(resolveExtractSettings({}), { inflow: { max: 60, desc: '上游產出上界' } }).length)
 * // => 1
 */
export function extractWarningsOf(settings, opt = {}) {
    const inflow = isobj(opt) ? opt.inflow : undefined
    const warnings = []
    if (inflow !== undefined && inflow !== null) {
        // 形狀之判準與字樣取摘要套件之 notesInflowProblem(筆記進料上界之產出者;關聯同讀)
        const p = notesInflowProblem(inflow)
        if (p) throw new Error(`extractWarningsOf 之 opt.inflow ${p}`)
        const cap = extractCapacityOf(settings).extract
        if (settings.extract.perRun > 0 && inflow.max > cap) {
            warnings.push(`筆記進料上界約 ${inflow.max} 篇（${inflow.desc}）大於提煉容量 ${cap}（${EXTRACT_CAPACITY_DESC.extract}）：待提煉之筆記會逐輪堆積；調高 extract.perRun 或 extract.notesPerConcept`)
        }
    }
    return [...warnings, ...panelSameProviderWarnings(extractPanelsOf(settings))]
}


/**
 * ai／extract 兩段逐組覆寫,每組依 schema 驗鍵集、型別與值域(檔頭);另推導容量(capacity)並產生啟動期警告(warnings;進料上界屬組裝者,
 *   此處只含判定小組之同家警告——容量警告見 extractWarningsOf 之 inflow)
 *
 * @param {Object} [cfg={}] 輸入執行端設定覆寫物件，非物件時視為{};只收 ai、extract 兩段(他總組裝只交原給之段)
 * @param {Object} [cfg.ai] 輸入 AI 調度層之覆寫(鍵見 EXTRACT_AI_SCHEMA)
 * @param {Object} [cfg.extract] 輸入提煉之覆寫(鍵見 EXTRACT_SCHEMA;ai 給了即整份取代預設之 3+3 席位)
 * @returns {Object} 回傳 { ai, extract, capacity:{ extract }, warnings:字串陣列 }
 * @throws {Error} cfg 含 ai、extract 以外之段,任一組給了但非物件、含不認得之鍵、或值型別與值域不符(訊息含完整設定路徑與可用鍵),
 *   或 cfg.extract.ai 不合 3+3 席位(extractSeatsProblem)時拋出——不可讓安裝方之設定靜默失效
 * @example
 * let s = resolveExtractSettings({ extract: { perRun: 2, standards: { disputeCheck: { perRun: 1 } } } })
 * console.log(s.extract.perRun, s.extract.notesPerConcept, s.extract.standards.disputeCheck.waitDays, s.capacity.extract)
 * // => 2 12 7 24
 */
export function resolveExtractSettings(cfg = {}) {

    //check
    if (!isobj(cfg)) {
        cfg = {}
    }
    checkKeys(cfg, SECTIONS, 'settings')

    const s = {
        ai: mergeSettingsGroup('ai', cfg.ai, EXTRACT_AI_SCHEMA, EXTRACT_AI_DEFAULT),
        extract: mergeSettingsGroup('extract', cfg.extract, EXTRACT_SCHEMA, EXTRACT_DEFAULT, { types: EXTRACT_SETTING_TYPES }),
    }
    s.capacity = extractCapacityOf(s)
    s.warnings = extractWarningsOf(s)
    return s
}


/** 起草席之設定路徑 */
const drafterPath = (i) => `extract.ai.drafters[${i}]`

/** 起草以外之席位之顯示名(依棒序;鍵同 EXTRACT_SEAT_KEYS 之其餘) */
const WORK_SEAT_LABELS = Object.freeze({ integrate: '整合', audit: '審計', revise: '修訂', accept: '終審' })

/**
 * 提煉之 AI 席位表(唯一一份):設定路徑、顯示名、自 settings.extract 取席位之函數。序:起草各席(3+3 之起草數已由 extractSeatsProblem 定)、
 *   整合、審計、修訂、終審、判定小組 first／second／third
 *
 * @type {Array}
 */
const EXTRACT_SEATS = Object.freeze([
    ...Array.from({ length: DRAFTERS }, (_, i) => ({ path: drafterPath(i), label: `起草${i + 1}`, of: (x) => x?.ai?.drafters?.[i] })),
    ...EXTRACT_SEAT_KEYS.slice(1).map((k) => ({ path: `extract.ai.${k}`, label: WORK_SEAT_LABELS[k], of: (x) => x?.ai?.[k] })),
    ...PANEL_ROWS,
].map((x) => Object.freeze(x)))

/**
 * 提煉之 AI 席位之顯示名(設定路徑 → 名稱;全部可設之席位,含預設為 null 者;席位檢核工具與報表用),序同 extractSeatsOf
 *
 * @type {Object}
 */
export const EXTRACT_SEAT_LABELS = seatLabelsFrom(EXTRACT_SEATS)

/**
 * 提煉之 AI 席位(設定路徑 → 席位;只列已設者——判定小組之空席 null 不列):啟動期席位檢核、主力供應商計算與席位檢核工具取用,
 *   呼叫端不另寫席位路徑。序同席位表
 *
 * @param {Object} settings 輸入已解析之設定(取 extract;本套件或組裝者之 resolve 產物皆可)
 * @returns {Object} 回傳 { '<設定路徑>': { use, fallback, … } }
 * @example
 * console.log(Object.keys(extractSeatsOf(resolveExtractSettings({}))).length)
 * // => 7
 */
export function extractSeatsOf(settings) {
    return seatsFrom(EXTRACT_SEATS, settings?.extract)
}

/**
 * 3+3 之席位語意提示(只提示、不擋:候選池有限時強制會讓鏈短到失去韌性,由人判斷;同家＝首選 use 相同):
 *   ①起草三席之首選是否三家不同(計票以實際成交之供應者計,同一家只算一票——同家即多數支持之判斷退化)
 *   ②審計、終審之首選是否與起草／整合同家(同家即自審)
 *
 * @param {Object} settings 輸入已解析之設定(取 extract.ai;席位結構不合 3+3 者回 []——結構問題見 extractSeatsProblem)
 * @returns {Array} 回傳 [{ key:'drafters'|'audit'|'accept', paths:Array(設定路徑), uses:Array(首選), ok:Boolean, text:String }]
 * @example
 * console.log(extractSeatHintsOf(resolveExtractSettings({})).map((h) => `${h.key}:${h.ok}`))
 * // => [ 'drafters:false', 'audit:false', 'accept:false' ]
 */
export function extractSeatHintsOf(settings) {
    const d = settings?.extract?.ai
    if (extractSeatsProblem(d)) return []
    const uses = d.drafters.map((s) => s.use)
    const distinct = new Set(uses).size
    const out = [{
        key: 'drafters',
        paths: uses.map((_, i) => drafterPath(i)),
        uses,
        ok: distinct === DRAFTERS,
        text: `起草三席之首選：${uses.join('、')}——${distinct === DRAFTERS ? '三家不同' : `只有 ${distinct} 家（計票以供應商計，多數支持之判斷退化）`}`,
    }]
    const authors = new Set([...uses, d.integrate.use])
    for (const k of ['audit', 'accept']) {
        const use = d[k].use
        const same = authors.has(use)
        out.push({ key: k, paths: [`extract.ai.${k}`], uses: [use], ok: !same, text: `${WORK_SEAT_LABELS[k]}首選與起草／整合同家：${same ? `${use}（同家即自審）` : '否'}` })
    }
    return out
}


/**
 * 提煉之保留時間:提煉啟用(extract.perRun 非 0)時＝extract.minRemainingMs,否則 0(提煉停用時不白白預留)——多工作之組裝把它交給前段,
 *   使前段不吃掉提煉開工所需之時間;提煉為末段,獨立組裝不需保留
 *
 * @param {Object} settings 輸入已解析之設定(取 extract.perRun、extract.minRemainingMs;minRemainingMs 非非負數時取預設)
 * @returns {Number} 回傳保留毫秒數
 * @example
 * console.log(extractReserveMs({ extract: { perRun: 4, minRemainingMs: 900000 } }), extractReserveMs({ extract: { perRun: 0, minRemainingMs: 900000 } }))
 * // => 900000 0
 */
export function extractReserveMs(settings) {
    const x = settings?.extract || {}
    if (Number(x.perRun) === 0) return 0
    const v = Number(x.minRemainingMs)
    return Number.isFinite(v) && v >= 0 ? v : EXTRACT_DEFAULT.minRemainingMs
}


/**
 * 提煉之選題參數(由已解析設定映射之唯一一份;提煉段之選題與外部巡檢之待提煉估算同讀,不各寫一份):欄名即選題函數之讀法——
 *   notesPerTarget(每批篇數)、minNotes(新核心門檻)、minPending(未滿一批之入選下限)、maxWaitDays(未滿一批須等待之天數)、
 *   graceDays(未關聯筆記之寬限天數)、catchup(同核心同輪至多幾批,至少 1)、categoryFallback(類別後備之 { minNotes?, minGain? };null＝停用)
 *
 * @param {Object} settings 輸入已解析之設定(取 extract)
 * @returns {Object} 回傳 { minNotes, minPending, maxWaitDays, notesPerTarget, graceDays, catchup, categoryFallback }
 * @throws {Error} settings 無 extract 段時拋出
 * @example
 * console.log(extractPickOf(resolveExtractSettings({})))
 * // => { minNotes: 6, minPending: 4, maxWaitDays: 30, notesPerTarget: 12, graceDays: 3, catchup: 3, categoryFallback: null }
 */
export function extractPickOf(settings) {
    const x = settings?.extract
    if (!isobj(x)) throw new Error('extractPickOf 須給已解析之設定（含 extract 段）')
    return {
        minNotes: x.minNotes,
        minPending: x.minPending,
        maxWaitDays: x.maxWaitDays,
        notesPerTarget: x.notesPerConcept,
        graceDays: x.relateGraceDays,
        catchup: Math.max(1, Number(x.catchupBatches) || 1),
        categoryFallback: isobj(x.categoryFallback) ? { ...x.categoryFallback } : null,
    }
}


/**
 * domain 成員之描述
 *
 * @param {String} kind 輸入 'data'(資料)｜'fn'(函數)
 * @param {String} need 輸入 'always'(必填)｜'feature'(所列功能任一開啟即必填)｜'optional'(選填:缺之即停用對應之步)
 * @param {String} desc 輸入說明
 * @param {Array} [features] 輸入 need 為 'feature' 時之功能(core/extractSettings 之功能表 EXTRACT_FEATURES 之鍵)
 * @returns {Object} 回傳凍結之 { kind, need, desc, features? }
 */
const member = (kind, need, desc, features) => Object.freeze({ kind, need, desc, ...(features ? { features: Object.freeze([...features]) } : {}) })

/**
 * 提煉 domain 之成員表(唯一一份;成員是否必填依實際之讀處:每輪無條件呼叫者必填、功能開啟才呼叫者依功能、讀處以型別判者選填)——
 *   注入整組 domain(cfg.domains)之檢核(extractDomainShapeProblems)、功能與席位之檢核同讀,JSDoc 由之敘述。
 *   功能之鍵見功能表 EXTRACT_FEATURES(supportCheck＝出處支持覆核 ES9、supportStock＝其存量 ES9、orphanCheck＝失撐主張 ES8、disputeCheck＝爭議覆核 ES14、
 *   synonymCheck＝同義核心 ES11)
 *
 * @type {Object}
 */
export const EXTRACT_DOMAIN_MEMBERS = Object.freeze({
    // ── 資料成員(必填;形狀見 extractDomainShapeProblems)──
    kb: member('data', 'always', '知識庫之稱呼(非空字串;各提示詞首句之稱呼)'),
    claimKinds: member('data', 'always', '主張種類(須為內建之四種,不可覆寫——規則表、檢定標準與核心版型皆以之為準)'),
    limits: member('data', 'always', '長度上限(物件,各值為正數)'),
    rules: member('data', 'always', '規則表 [{ id, priority, text }](id 不重複;爭議覆核開啟時須含 disputeBoundary)'),
    evidence: member('data', 'always', '證據判定(具 apply、levels、selfLimitOf)'),
    weakEvidence: member('data', 'always', '弱證據之說法(字串;檢定標準 ES13 亦認之為限制語)'),
    evidenceRule: member('data', 'always', '最高證據等級之要件(摘要套件之證據規則;推定之判準——呼叫端據以供給 renderState 之 ctx.noTopOf;null＝停用)'),
    // ── 函數成員:每輪無條件呼叫者(必填)──
    noteDigest: member('fn', 'always', '筆記分節摘要與內容鍵'),
    renderState: member('fn', 'always', '核心 md 版型'),
    toneOf: member('fn', 'always', '絕對語氣指標'),
    buildProposePrompt: member('fn', 'always', '起草提示詞'),
    buildIntegratePrompt: member('fn', 'always', '整合提示詞'),
    buildAuditPrompt: member('fn', 'always', '審計提示詞'),
    buildRevisePrompt: member('fn', 'always', '修訂提示詞'),
    buildReviewPrompt: member('fn', 'always', '終審提示詞(待審裁決同一支)'),
    buildAcceptAppendix: member('fn', 'always', '終審附錄(審計意見與修訂紀錄)'),
    buildConsolidatePrompt: member('fn', 'always', '整併提示詞'),
    // ── 依功能開啟而必填 ──
    buildSupportCheckPrompt: member('fn', 'feature', '出處支持覆核(ES9)之提示詞', ['supportCheck', 'supportStock']),
    buildOrphanCheckPrompt: member('fn', 'feature', '失撐主張找支持(ES8)之提示詞', ['orphanCheck']),
    buildDisputeCheckPrompt: member('fn', 'feature', '爭議覆核(ES14)之提示詞', ['disputeCheck']),
    buildSynonymCheckPrompt: member('fn', 'feature', '同義核心覆核(ES11)之提示詞', ['synonymCheck']),
    // ── 選填:缺之即停用對應之步 ──
    buildSynonymProposePrompt: member('fn', 'optional', '同義核心之提議(缺之即只用名稱相近之候選)'),
    buildSupportRevisePrompt: member('fn', 'optional', '依出處收斂措辭之修訂(缺之即不修訂,照不受支持處置)'),
    buildEssencePrompt: member('fn', 'optional', '本質專步之提示詞(缺之即不排本質專步)'),
    buildRecheckText: member('fn', 'optional', '重審段(缺之即提示詞不附重審段)'),
    withdrawnRule: member('fn', 'optional', '條件規則:核心有出處已撤之條目時加入規則表(缺之即不加)'),
    renderTwinRedirect: member('fn', 'optional', '分身轉址頁之本文({ twin, into, archivedFile } => 字串;缺之即用內建版型——前言之機制鍵 type／concept／mergedInto 由提煉段寫,不可覆寫)'),
    contentKeyVersion: member('data', 'optional', '內容鍵之版本(字串;缺之即不偵測筆記內容變更)'),
})

/** 功能之額外檢核(功能之鍵 → (settings, domain, domainLabel) => 問題說明,'' 為無):爭議覆核以規則表之「非對立之界線」為判準(規則表非陣列亦為缺) */
const FEATURE_EXTRA = Object.freeze({
    disputeCheck: (s, domain, dl) => (isarr(domain?.rules) && domain.rules.some((r) => r?.id === 'disputeBoundary') ? '' : `${dl}.rules 缺 id「disputeBoundary」之規則（爭議覆核以之為判準）`),
})

/**
 * 提煉之完整功能表(抓取套件之 featureProblemsOf 之表):設定面(稱呼、開啟判準、判定小組之必填席)取 core/extractSettings 之 EXTRACT_FEATURES,
 *   所需之 domain 函數成員取成員表(EXTRACT_DOMAIN_MEMBERS 之 need 'feature' 依其功能之鍵),額外檢核取 FEATURE_EXTRA——各一份,此處只組合
 *
 * @type {Array}
 */
const FEATURE_TABLE = Object.freeze(EXTRACT_FEATURES.map((f) => Object.freeze({
    ...f,
    members: Object.freeze(Object.entries(EXTRACT_DOMAIN_MEMBERS).filter(([, m]) => m.need === 'feature' && m.features.includes(f.key)).map(([k]) => k)),
    ...(FEATURE_EXTRA[f.key] ? { extra: FEATURE_EXTRA[f.key] } : {}),
})))

/**
 * 檢定標準之功能與席位之問題(單一判定;抓取套件之 featureProblemsOf;提煉段之執行期與組裝者之啟動期同讀,字樣同一份):已開啟之功能
 *   (EXTRACT_FEATURES)所需之判定小組必填席(extract.standards.ai.first／second;各功能共用一組,缺之一句列出需要所缺之席之開啟者)、依功能而必填之
 *   domain 函數成員(EXTRACT_DOMAIN_MEMBERS 之 need 'feature';成員一句列出需要它之開啟者)、爭議覆核開啟時規則表須含「非對立之界線」。
 *   功能皆未開 → 無問題(未開之功能不檢其成員與席位)
 *
 * @param {Object} settings 輸入已解析之設定(取 extract.standards;本套件或組裝者之 resolve 產物皆可)
 * @param {Object} domain 輸入提煉 domain(非物件視為缺全部成員)
 * @param {Object} [o={}] 輸入 { enabled?:Array(開啟之功能鍵;子階段之選項覆寫設定時用), domainLabel?:String(訊息中 domain 之稱呼,預設 'domain') }
 * @returns {Array} 回傳問題說明陣列(無問題為空陣列;依序:席位、成員〔功能表中首次出現之序,同成員表之序〕、規則表)
 * @example
 * // createExtractDomain 取自 domain/extractDomain.mjs(本檔不取 domain;範例只示意輸入)
 * console.log(extractFeatureProblems(resolveExtractSettings({ extract: { standards: { disputeCheck: { perRun: 1 } } } }), createExtractDomain({})))
 * // => [ '爭議覆核(extract.standards.disputeCheck.perRun > 0)已啟用,但缺席位 settings.extract.standards.ai.first、settings.extract.standards.ai.second' ]
 */
export function extractFeatureProblems(settings, domain, o = {}) {
    return featureProblemsOf(FEATURE_TABLE, settings, domain, o)
}


export default {
    EXTRACT_AI_DEFAULT, EXTRACT_AI_SCHEMA, EXTRACT_DEFAULT, EXTRACT_SCHEMA, EXTRACT_SETTING_TYPES, EXTRACT_SEAT_KEYS, extractSeatsProblem, extractResolvedProblem,
    resolveExtractSettings, extractCapacityOf, EXTRACT_CAPACITY_DESC, extractWarningsOf, EXTRACT_FEATURES, extractPanelsOf, EXTRACT_SEAT_LABELS, extractSeatsOf,
    extractSeatHintsOf, extractReserveMs, extractPickOf, EXTRACT_DOMAIN_MEMBERS, extractFeatureProblems,
}
