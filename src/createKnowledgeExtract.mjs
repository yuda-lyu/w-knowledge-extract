// createKnowledgeExtract.mjs — 總組裝:通用知識提煉(安裝即用,僅 workDir 必填;逐層可覆寫)
//
// ════════════════ 套件用法 ════════════════
//
//   import W from 'w-knowledge-extract/src/WKnowledgeExtract.mjs'
//   const flow = W.createKnowledgeExtract({ workDir: 'c:/my-kb', data: { vocab: { domain: '天文學' } } })
//   await flow.run()
//
// 擴充入口(每層都有預設):
//   ①cfg 設定覆寫(ai／extract 逐鍵)                ②cfg.data.vocab 知識庫稱呼與主題範圍、證據封頂、推論類、提示詞之領域句(guide.extract)
//   ③cfg.prompts 各 AI 角色之提示詞與規則表         ④cfg.domains 整組置換提煉 domain
//   ⑤cfg.stages 整組自訂子階段／cfg.stageOpts 提煉子階段之 opt(含 tap)  ⑥cfg.aiAdapter 整組置換 AI 調度層(須具工作流入口)
//
// 【執行端不需要的膠水全在此】workDir → 各目錄展開(核心 md 在 <workDir>/knowledge/core,狀態檔預設同處);lmdb/WOrm 內建(可注入);AI 調度層內建
//   (envFile 給金鑰;cfg.aiAdapter 可整組置換);clock/logFactory 內建。提煉執行期件(資料與詞彙、概念鍵之折疊、提煉與關聯之 domain、啟用之檢定標準
//   之檢核、詞彙之警告)一律經 extractRuntime 之 createExtractRuntime 組裝——與他總組裝同一份,不在此另組。
// 【組裝機制取自抓取套件之總組裝共用件】鍵檢核、目錄、時鐘、提示詞與子階段設定、儲存、日誌工廠／收尾鉤子／調度層之形狀、調度層之建構與事件日誌、
//   集合之開關、每輪之序列與 info() 之共同欄,與抓取、摘要、關聯之總組裝同一份(經 core/capturePackage);本檔只放提煉專屬者(提煉之鍵集、
//   extractRuntime、提煉物件、每輪依賴、符合度掃描之接線)與檢核之順序。
// 【時間預算單一來源】整輪軟性截止 deadlineMs、執行鎖陳舊期限 lockStaleMs 與各路徑由抓取套件之 resolveRuntime 一次解析(排程上限
//   cfg.scheduleLimitMin;cfg 明給者優先);提煉為末段,不需保留時間給後段。
// 【開工標記】每輪開工先寫 log/<day>/<stamp>-run.start.json(本輪上限之宣告):被砍的輪次沒有 run.json,外部巡檢逐輪判界靠它。
// 【啟動期檢核】設定(兩段 schema、3+3 席位)、cfg 各鍵之形狀、資料、提示詞、domain、子階段之掛載、啟用之檢定標準所需之判定小組席位與 domain 成員、
//   AI 調度層之工作流入口(getWkf／seatSpec／recordCall)、AI 席位(use／fallback 全部可解析)皆於建構期驗——打錯之鍵、缺金鑰或 id 打錯要在啟動期爆。
//   形狀錯誤之訊息先於席位檢核(席位檢核在最後)。
// 【AI 調度層之建構選項】條目固有之 prompt 長度預篩(capability;席位規格 seatSpec 依實際提示詞長度預篩遞補鏈時計入)與工作流入口(workflow:
//   3+3 與各判定小組經 getWkf().callAi／runFanout)開啟。失敗預覽(preview)不開:它只作用於 callJson,提煉不經 callJson——逐棒之失敗原因取
//   工作流之嘗試紀錄(逐棒日誌之「提煉事件」行)。截斷放行不開:提煉之各棒逐次給 acceptTruncated:false(差量、裁決與票皆為全有全無之物件)。
// 【調度層事件寫入當輪日誌】ai.pools／ai.healthStreak(預設 3)／ai.providerLimits 開啟時,供應商額度／健康／能力之事件以 WARN 寫入當輪日誌
//   (注入 cfg.aiAdapter 時不接,調度層屬注入方)。
// 【本機網路判斷為選用】cfg.netGuard 給判斷器物件(抓取套件之 createNetGuard 產物或同形之 { check, confirmDown, isDown, describe })才判斷:
//   調度層整鏈皆敗時詢問,確認不通即回 skipped——該棒中止、不計失敗;本套件不內建探測(探測端點屬抓取之設定),未給或 null＝不判斷。
// 【收尾在管線之外、提煉之後】每輪結束依序:①符合度掃描(extract.standards.scanEachRun 開時;計數入執行摘要,本輪已逾時間預算者略過)
//   ②寫結構化摘要 run.json ③收尾鉤子(cfg.afterRun 給函數才跑;本套件無內建巡檢)。掃描與收尾失敗只留 warn,不影響本輪成敗。
// 【集合】筆記、核心記錄、邊庫、待判登錄(holds)、檢核紀錄(checks)必開(未能判定不得算合格——判不了者須有處登錄、已檢者須有處記錄;同關聯套件);
//   文件(docs)以 cfg.docs 開啟(true 或集合名),未開者發布時間與來源取筆記之欄位。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import {
    given, normalizeWorkDir, resolveRuntime, runtimeCfgOf,
    checkKeys, resolveClockCfg, resolvePromptsCfg, checkDataKeys, checkStageConfig, checkOptionalCollections, resolveLmdbCfg,
    resolveLogFactory, resolveAfterRun, checkAiAdapter, createRoundLog, buildAiAdapter, startupWarningsOf,
    createStoreOpener, pipelineNameOf, createRoundRunner, assemblyInfoOf, captureNetGuardOf, standardsCountsOf, DEPS_COMMON_KEYS,
} from './core/capturePackage.mjs'
import { resolveExtractSettings, extractSeatsOf } from './core/extractSettings.mjs'
import { createExtractObject, EXTRACT_TAP_STAGE_KEYS } from './extractObject.mjs'
import { createExtractRuntime, resolveExtractDirs, EXTRACT_STORE_KEYS, EXTRACT_DATA_KEYS, EXTRACT_PROMPT_SIGS } from './extractRuntime.mjs'
import { auditExtractStandards, extractScanOf } from './standards/audit.mjs'

/**
 * cfg 之全部可用鍵(本檔、extractRuntime、core/extractSettings 讀取者之聯集;交抓取套件 resolveRuntime 者經其 runtimeCfgOf 逐鍵讀出〔RUNTIME_CFG_KEYS〕):
 *   不在此者於組裝期拋錯——打錯之鍵若靜默接受,正名鍵會維持預設而無人察覺。新增讀取 cfg.<鍵> 處須同步列入
 *
 * @type {Array}
 */
export const CFG_KEYS = Object.freeze([
    'workDir', 'name', 'dirs', 'timeZone', 'clock', 'lang', 'data', 'prompts', 'domains', 'conceptFold',
    'ai', 'extract',
    'scheduleLimitMin', 'deadlineMs', 'lockStaleMs', 'lock', 'envFile', 'aiWorkspace', 'aiAdapter', 'aiOptions',
    'stages', 'stageOpts', 'lmdb', 'docs',
    'logFactory', 'afterRun', 'netGuard',
])

/**
 * cfg.data 之可用鍵(即提煉所讀之資料鍵,extractRuntime 之 EXTRACT_DATA_KEYS)
 *
 * @type {Array}
 */
export const DATA_KEYS = EXTRACT_DATA_KEYS

/**
 * cfg.prompts 之可用鍵(提示詞與規則表之覆寫;各鍵之函數形式見 EXTRACT_PROMPT_SIGS,輸出契約固定)
 *
 * @type {Array}
 */
export const PROMPT_KEYS = Object.freeze(Object.keys(EXTRACT_PROMPT_SIGS))

/**
 * 集合之對外名(cfg.lmdb.cls 之可用鍵;即 extractRuntime 之 EXTRACT_STORE_KEYS):notes、cores、relations、holds、checks 必開,docs 選開
 *
 * @type {Array}
 */
export const COLLECTION_KEYS = EXTRACT_STORE_KEYS

/** 必開之集合(依序;檔頭【集合】) */
const REQUIRED_STORES = Object.freeze(['notes', 'cores', 'relations', 'holds', 'checks'])

/** 內建管線名(日誌與執行摘要 run.json 之 name;cfg.name 給了即取代) */
const PIPELINE_NAME = '知識提煉'

/** AI 調度層之建構選項(檔頭【AI 調度層之建構選項】) */
const AI_ADAPTER_OPT = Object.freeze({ capability: true, workflow: true })

/**
 * AI 調度層所需之函數(工作流入口、名額規格、計帳):recordCall 於提煉之呼叫包裝為選用(workflow/aiCall 以 ?. 呼叫,子階段自組之測試替身可缺),
 *   總組裝則要求具備——內建調度層恆有;注入者缺之,用量計帳即靜默失效
 */
const AI_NEED = Object.freeze(['getWkf', 'seatSpec', 'recordCall'])

/**
 * 總組裝:通用知識提煉(安裝即用,僅 workDir 必填;擴充入口見檔頭)
 *
 * @param {Object} [cfg={}] 輸入設定物件，非物件時視為{}(再由 workDir 檢查拋錯)；可用鍵見 CFG_KEYS
 * @param {String} cfg.workDir 輸入工作目錄路徑字串(唯一必填:所有輸出的路徑錨點)
 * @param {String} [cfg.name] 輸入管線名(日誌之管道名與執行摘要 run.json 之 name)，未給用內建名「知識提煉」
 * @param {Object} [cfg.dirs] 輸入目錄逐鍵覆寫(鍵:db、log、tmp、state、knowledge、core、coreState;coreState 未給者＝core)
 * @param {String} [cfg.timeZone='Asia/Taipei'] 輸入 IANA 時區(日誌時間戳、檔名、時刻之基準;不依系統時區)
 * @param {Object} [cfg.clock] 輸入時鐘物件(wsemi 之 genClockTZ 產物)，給了即不依 timeZone 建立
 * @param {String} [cfg.lang='zh-TW'] 輸入語言設定(BCP 47 代碼;抓取套件之 resolveLocale):覆核類提示詞之輸出語言句、核心標準 ES3 之適用(只有繁體中文有字形
 *   標準,其餘語言列不適用、操作守門不轉字形)、概念鍵之繁簡折疊(中文才折)依之;預設繁體中文
 * @param {Object} [cfg.data] 輸入資料 { vocab:詞彙覆寫 }(鍵見 core/vocab/extractVocab 之 EXTRACT_VOCAB_KEYS)
 * @param {Object} [cfg.prompts] 輸入提示詞與規則表之覆寫(鍵與函數形式見 EXTRACT_PROMPT_SIGS;輸出契約固定)
 * @param {Object} [cfg.domains] 輸入整組置換之 domain { extract? }(須合成員表 EXTRACT_DOMAIN_MEMBERS;同時作用於管線與 info())
 * @param {Boolean|Function} [cfg.conceptFold] 輸入概念鍵之字形折疊：false 停用、函數自訂、true 內建繁簡折疊、未給依語言設定(中文折、其他不折)
 * @param {Object} [cfg.ai] 輸入 AI 調度層覆寫(鍵見 core/extractSettings 之 EXTRACT_AI_SCHEMA；席位在 extract 段)
 * @param {Object} [cfg.extract] 輸入提煉設定覆寫(鍵見 core/extractSettings 之 EXTRACT_SCHEMA)
 * @param {Number} [cfg.scheduleLimitMin] 輸入排程執行上限分鐘數，時間預算與鎖陳舊期限由此推導
 * @param {Number} [cfg.deadlineMs] 輸入整輪軟性截止毫秒數，未給由排程上限推導
 * @param {Number} [cfg.lockStaleMs] 輸入執行鎖陳舊期限毫秒數(持鎖者宣告值)
 * @param {Boolean|String} [cfg.lock] 輸入執行鎖：false 不上鎖、true 或未給用 <dirs.tmp>/run.lock、字串為鎖檔路徑
 * @param {String} [cfg.envFile] 輸入金鑰檔路徑(相對者以 workDir 為基準)，預設 <workDir>/.env
 * @param {String} [cfg.aiWorkspace] 輸入 AI 子進程工作目錄，預設 <workDir> 下之 tmp 目錄之 ai-workspace
 * @param {Object} [cfg.aiAdapter] 輸入整組置換之 AI 調度層(須具 getWkf()、seatSpec(seat, promptLen)、recordCall(r))，未給用內建調度層
 * @param {Object} [cfg.aiOptions] 輸入內建調度層之建構選項(安裝端之資產 { providerPick?, exes?, persistStore?, usageCounter? };鍵見抓取套件之 AI_OPTIONS_KEYS),
 *   注入 aiAdapter 時不用
 * @param {Array} [cfg.stages] 輸入整組自訂之子階段陣列({ name, run(ctx) })，給了即取代內建子階段(與 stageOpts 擇一)
 * @param {Object} [cfg.stageOpts] 輸入內建子階段之 opt { extract }(含 tap)
 * @param {Object} [cfg.lmdb] 輸入 { WOrm?, path?(預設 dirs.db), db?(預設 'knowledge'), cls?(集合名覆寫) }
 * @param {Boolean|String} [cfg.docs=false] 輸入文件集合(抓取套件寫入):true 或集合名 → 唯讀開啟
 * @param {Function} [cfg.logFactory] 輸入日誌工廠 () => logger，預設每輪一檔 log/<day>/<stamp>-run.log
 * @param {Function|Boolean} [cfg.afterRun] 輸入收尾鉤子 ({ report, summaryFile, log, deps }) => 結果，false 或未給即無
 * @param {Object|null} [cfg.netGuard] 輸入本機網路判斷器(交調度層之 isNetDown;檔頭【本機網路判斷為選用】)；未給或 null＝不判斷
 * @returns {Object} 回傳 { run:Function, openStores:Function, closeStores:Function, info:Function }
 * @throws {Error} cfg.workDir 非有效字串、cfg 含不認得之鍵、settings 各段不合 schema、cfg 各鍵形狀不合(見各檢核)、詞彙表不合規格、
 *   domain 不合成員表、子階段之掛載對不上錨點、啟用之檢定標準缺判定小組席位或 domain 成員、AI 調度層缺工作流入口，或 AI 席位無法解析時拋出
 * @example
 * need test in nodejs.
 *
 * let flow = createKnowledgeExtract({ workDir: 'c:/my-kb', data: { vocab: { domain: '天文學' } } })
 * let report = await flow.run()
 * console.log(report.ok)
 */
export function createKnowledgeExtract(cfg = {}) {

    //check
    if (!isobj(cfg)) {
        cfg = {}
    }
    if (!isestr(cfg.workDir)) {
        throw new Error('createKnowledgeExtract 需要 workDir（唯一必填：所有輸出的路徑錨點）')
    }
    checkKeys(cfg, CFG_KEYS, 'cfg')
    const pipelineName = pipelineNameOf(cfg.name, PIPELINE_NAME)

    const workDir = normalizeWorkDir(cfg.workDir)

    // ── 路徑(workDir 展開,核心 md 之目錄為下游目錄 extra;cfg.dirs 逐鍵覆寫;狀態檔目錄於覆寫之後衍生)──
    const dirs = resolveExtractDirs(workDir, cfg.dirs)

    // ── 設定與資料(內建預設＋覆寫;形狀錯誤一律啟動期拋錯)──
    const settings = resolveExtractSettings({ ai: cfg.ai, extract: cfg.extract })
    const clock = resolveClockCfg(cfg.clock, cfg.timeZone)
    checkDataKeys(cfg.data, DATA_KEYS)
    const prompts = resolvePromptsCfg(cfg.prompts, EXTRACT_PROMPT_SIGS)
    // 提煉執行期件(extractRuntime;與他總組裝同一份):資料、詞彙、概念鍵之折疊、提煉與關聯之 domain(cfg.prompts 覆寫提示詞、cfg.domains 整組置換)、
    //   啟用之檢定標準之檢核、詞彙之警告——設定錯誤一律於此拋
    const rt = createExtractRuntime(cfg, settings, { prompts, domains: cfg.domains })

    // ── 其餘 cfg 鍵之形狀(先於 AI 組裝:設定形狀錯誤的訊息不該被席位檢核搶先)──
    checkStageConfig(cfg.stages, cfg.stageOpts, EXTRACT_TAP_STAGE_KEYS)
    // 選開之集合(檔頭【集合】:只有 docs)
    const optional = {
        docs: { value: cfg.docs, label: '文件' },
    }
    const optionalOn = checkOptionalCollections(optional)
    const mkLog = resolveLogFactory(cfg.logFactory, { dir: dirs.log, clock })
    const afterRun = resolveAfterRun(cfg.afterRun)
    checkAiAdapter(cfg.aiAdapter, { need: AI_NEED })
    // 本機網路判斷(檔頭【本機網路判斷為選用】):判準與錯誤訊息取抓取套件之 captureNetGuardOf;未給視同 null(不內建探測)
    const { isNetDown } = captureNetGuardOf(given(cfg.netGuard) ? cfg.netGuard : null, {})

    // ── LMDB(WOrm 內建,可注入替換;集合名可覆寫,預設即對外名——與其他工作共用一庫時不必遷移)──
    const lmdb = resolveLmdbCfg(cfg.lmdb, dirs, { keys: COLLECTION_KEYS, optional })
    const storeNames = [...REQUIRED_STORES, ...optionalOn]

    // ── 執行期生效值(排程上限/時間預算/鎖/路徑之單一來源;管線與 info() 同取此份)──
    const runtime = resolveRuntime(runtimeCfgOf(cfg), { workDir, dirs })

    // ── AI 調度層(內建,開工作流入口;cfg.aiAdapter 整組置換——測試替身／共用之調度實例皆走這裡);調度層之事件(額度／健康／能力)寫入當輪日誌 ──
    const roundLog = createRoundLog()
    const ai = buildAiAdapter({ aiAdapter: cfg.aiAdapter, options: cfg.aiOptions, ai: settings.ai, envFile: runtime.envFile, workspace: runtime.aiWorkspace, clock, lang: rt.locale.code, isNetDown, roundLog, adapterOpt: AI_ADAPTER_OPT, need: AI_NEED })
    // 啟動期席位檢核(檔頭):不可解析即拋;席位清單取 extractSeatsOf(席位路徑只在 core/extractSettings 定義)。
    //   執行期生效值之警告(無效值、未給上限)、設定自洽警告(判定小組同家)與詞彙之警告併入:每輪開頭以「啟動期檢核：」記入日誌
    const startupWarnings = startupWarningsOf(ai, extractSeatsOf(settings), [runtime.warnings, settings.warnings, rt.warnings])

    // ── 提煉物件:自訂子階段整組置換;否則內建子階段＋子階段 opt ──
    const extractObject = createExtractObject(cfg.stages ? { stages: cfg.stages } : (cfg.stageOpts || {}))

    // ── 集合之開關:必開之集合＋選開之集合 ──
    const { openStores, closeStores } = createStoreOpener(lmdb, storeNames)

    /**
     * 每輪依賴(deps):套件子階段與執行端自寫子階段同一條注入通道。
     *
     * 【只放可列舉之普通屬性】w-data-pipeline 之管線建脈絡時以 spread 複製 deps({ ...parentCtx.deps, ...spec.deps });getter
     *   (Object.defineProperty 預設 enumerable:false)在 spread 時直接消失 → 子階段拿到 undefined、每輪靜默失敗。
     *
     * 【欄集之單一來源】欄與序取抓取套件之 DEPS_COMMON_KEYS(各總組裝之 buildDeps 同一份);本檔只給各欄之值。
     *
     * @param {Object} stores 輸入 openStores 之產物
     * @returns {Object} 回傳依賴物件 { stores, clock, dirs, data(安裝方原給之資料), vocab(已解析之詞彙表), locale(語言設定), settings, ai, domains(生效之一份 { extract, relate }) }
     */
    const depsValues = { clock, dirs, data: rt.data, vocab: rt.vocab, locale: rt.locale, settings, ai, domains: rt.domains }
    const buildDeps = (stores) => Object.fromEntries(DEPS_COMMON_KEYS.map((k) => [k, k === 'stores' ? stores : depsValues[k]]))

    /**
     * 執行一輪提煉(寫開工標記 → 開集合 → 跑管線(鎖、時間預算) → 符合度掃描(可選) → 寫執行摘要 → 收尾鉤子(可選) → 關集合)
     *
     * @returns {Promise} 回傳 Promise，resolve 回傳 report(runPipeline 之產物,另含 summaryFile 與 afterRun(收尾鉤子之回傳值));
     *   未取得執行鎖時 report.lockSkipped 為 true,不寫摘要、不觸發收尾鉤子
     */
    const run = createRoundRunner({
        name: pipelineName,
        dirs,
        clock,
        mkLog,
        startupWarnings,
        runtime,
        openStores,
        closeStores,
        buildDeps,
        stages: [extractObject],
        ai,
        roundLog,
        // 符合度掃描(settings.extract.standards.scanEachRun;預設關):本輪管線之後、執行摘要之前,掃主核心之確定性標準(與新進閘同一判定、以生效之 domain 判;
        //   ES2／ES16 讀出處筆記之材料)與 AI 標準之檢核紀錄與待判;結果之形狀取 standards/audit 之 extractScanOf、計數摘要取抓取套件之
        //   standardsCountsOf(與他總組裝同一份)
        scan: {
            enabled: () => settings.extract.standards.scanEachRun === true,
            audit: async ({ stores, deps }) => extractScanOf(await auditExtractStandards({ stores, dirs: deps.dirs, domain: deps.domains.extract, relateDomain: deps.domains.relate, locale: deps.locale }, { material: true })),
            countsOf: standardsCountsOf,
        },
        afterRun,
    })

    return {
        run,
        /** 維運入口(工具用):同一套集合定義,呼叫端自負開關 */
        openStores,
        closeStores,
        /**
         * 維運入口:不開管線時取得依賴與執行期生效值(與管線實際使用同源)
         *
         * @returns {Object} 回傳 { dirs, settings, clock, ai, domains(＝每輪 deps.domains 同一物件 { extract, relate }), locale(語言設定), lmdb, data, vocab(已解析之詞彙表),
         *   deadlineMs, lockStaleMs, startupWarnings, scheduleLimitMin(未給為 null), envFile, aiWorkspace(注入 cfg.aiAdapter 時為 null),
         *   lockFile(cfg.lock 為 false 時為 null), collections(openStores 開啟之集合對外名) }；envFile／aiWorkspace／lockFile 為絕對路徑
         *   (相對路徑以當下 cwd 解析,與實際讀寫相同)
         */
        info: () => assemblyInfoOf({
            dirs,
            settings,
            clock,
            ai,
            domains: rt.domains,
            extra: { locale: rt.locale },
            lmdb,
            data: rt.data,
            vocab: rt.vocab,
            runtime,
            startupWarnings,
            collections: storeNames,
        }),
    }
}

export default createKnowledgeExtract
