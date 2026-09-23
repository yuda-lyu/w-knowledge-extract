// createKnowledgeExtract.mjs — 總組裝:安裝即用(僅 workDir 必填),逐層可覆寫
//
// ════════════════ 套件用法 ════════════════
//
//   import W from 'w-knowledge-extract'
//   const flow = W.createKnowledgeExtract({ workDir: 'c:/my-kb' })   // 零注入即完整管線
//   await flow.run()
//
// 六個擴充入口(每層都有預設,詳見設計文件):
//   ①cfg 設定覆寫(fetch/knowledge/ai/data…逐鍵)  ②cfg.pipeline 物件重排
//   ③物件工廠 stages 子階段重組                    ④子階段工廠 tap/chain 動作鏈掛載
//   ⑤mw 工廠 opts 注入                             ⑥cfg.plugins 跨階段插件
//
// 【執行端不需要的膠水全在此】workDir → 各目錄展開;lmdb/WOrm 內建(可注入);
//   dedup → identity＋seen;內建抓取器＋cfg.fetchers 合併(同 id 置換);
//   AI 調度層內建(envFile 給金鑰;cfg.aiAdapter 可整組置換);
//   clock/conceptFold/logFactory 內建;索引自動附掛(always)。
// 【時間預算單一來源】整輪軟性截止 deadlineMs 與執行鎖陳舊期限 lockStaleMs 皆由排程上限
//   (cfg.scheduleLimitMin,舊名 cfg.monitor.scheduleLimitMin 仍認)推導;cfg 明給者優先。
//   各段經 core/budget 之 budgetOf(ctx) 消費同一份預算,不各自持有數字。
// 【啟動期檢核】AI 名額(席位)之 use/fallback 全部可解析才開工——缺金鑰或 id 打錯要在啟動期爆,
//   不是跑到第一次呼叫才拋、再被批次層當單批異常吞掉(2026-09-12 複審 A3)。
// 【收尾在管線之外、摘要之後】每輪結束依序:①寫結構化摘要 run.json ②收尾鉤子(預設巡檢)。
//   巡檢讀 log/<day>/ 之 run.json,當輪的必須已存在——此前收尾是管線內的 always 階段而摘要在管線後寫,
//   巡檢結構上永遠讀不到當輪,供應商健康等新判準對當輪失效(2026-09-12 複審 B1);收尾失敗亦留 warn(B2)。

import path from 'path'
import * as OpenCC from 'opencc-js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import WOrmDefault from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { definePipeline, runPipeline } from 'w-data-pipeline/src/core/definePipeline.mjs'
import { acquireLock } from './lock.mjs'
import { normalizeWorkDir, expandDirs } from './dirs.mjs'
import { resolveSettings, SKIP_TITLE_PATTERNS_DEFAULT } from './settingsDefault.mjs'
import { resolvePlugins, mergeTaps } from './plugins.mjs'
import { MwContractError } from './kernel.mjs'
import { createFetchObject, createOrganizeObject, createRelateObject, createDistillObject } from './objects.mjs'
import { createClock } from '../util/clock.mjs'
import { setConceptFold } from '../util/text.mjs'
import { oneline } from '../util/misc.mjs'
import { createDefaultFetchers, mergeFetchers } from '../fetchers/defaultFetchers.mjs'
import { DEFAULT_SITE_ADAPTERS, mergeSiteAdapters } from '../fetchers/siteAdapters.mjs'
import { createTriageDomain } from '../domain/triageDomain.mjs'
import { createExtractDomain } from '../domain/extractDomain.mjs'
import { createRelateDomain } from '../domain/relateDomain.mjs'
import { createDistillDomain } from '../domain/distillDomain.mjs'
import { createAiAdapter } from '../ai/adapter.mjs'
import { createLogger } from '../ops/logger.mjs'
import { createPatrol } from '../ops/patrol.mjs'
import { buildRunSummary, writeRunSummary } from '../ops/runSummary.mjs'
import { stageKnowledgeIndex } from '../stages/indexStage.mjs'

/**
 * 預設物件之「物件鍵 → 子階段鍵」對照(插件 hook 前綴解析用)
 * 須與 core/objects.mjs 各物件之預設 stages 同步:曾漏列 organize.triage,插件掛 'organize.triage.settleTriage'
 * 會被靜默丟棄(2026-09-23 修);前綴不在此表者一律於組裝期拋錯,不再默默失效
 */
const OBJECT_STAGES = {
    fetch: ['seedSync', 'listFetch', 'detailFetch', 'docMaintain', 'expand'],
    organize: ['triage', 'extract'],
    relate: ['relate', 'relationIndex'],
    distill: ['distill'],
}

// 安全邊際:截止只切得到已接上剩餘預算的呼叫;席位預算於開工當下封頂(core/budget),但已開始的那一次
// 嘗試最多再跑到其自身 timeout(現行最大 claude:sonnet 360s),邊際取 6 分鐘涵蓋之;下限 10 分
const DEADLINE_MARGIN_MS = 360_000
const DEADLINE_DEFAULT_MS = 3000_000
// 執行鎖陳舊期限須大於排程上限:正常但偏慢的執行不可在跑到一半被下一實例判為殘留而搶鎖
const LOCK_STALE_EXTRA_MS = 300_000
const LOCK_STALE_DEFAULT_MS = 3600_000

/**
 * 由 settings.ai 列出全部席位(名稱 → {use,fallback}),供啟動期檢核
 *
 * @param {Object} ai 輸入 settings.ai(resolveSettings 之產物,含 extract/triage/relate/distill 各名額)
 * @returns {Object} 回傳席位對照物件 { <席位路徑字串>: {use, fallback} }，如 'ai.extract.executor'／'ai.distill.pipeline[0](audit)'
 */
function listSeats(ai) {
    const seats = {}
    if (ai.extract?.executor) seats['ai.extract.executor'] = ai.extract.executor
    if (ai.triage?.executor) seats['ai.triage.executor'] = ai.triage.executor
    if (ai.relate?.executor) seats['ai.relate.executor'] = ai.relate.executor;
    (ai.distill?.fanout?.indeps || []).forEach((s, i) => {
        seats[`ai.distill.fanout.indeps[${i}]`] = s
    })
    if (ai.distill?.fanout?.integrate) seats['ai.distill.fanout.integrate'] = ai.distill.fanout.integrate;
    (ai.distill?.pipeline || []).forEach((s, i) => {
        seats[`ai.distill.pipeline[${i}](${s?.stage || '?'})`] = s
    })
    return seats
}

/**
 * 總組裝:安裝即用(僅 workDir 必填),逐層可覆寫(六個擴充入口見檔頭)
 *
 * @param {Object} [cfg={}] 輸入設定物件，非物件時視為{}(再由 workDir 檢查拋錯)；各鍵預設值見 core/settingsDefault,僅 workDir 必填
 * @param {String} cfg.workDir 輸入工作目錄路徑字串(唯一必填:所有輸出的路徑錨點)
 * @returns {Object} 回傳 { run:Function, openStores:Function, closeStores:Function, info:Function }
 * @throws {Error} cfg.workDir 非有效字串時拋出
 */
export function createKnowledgeExtract(cfg = {}) {

    //check
    if (!isobj(cfg)) {
        cfg = {}
    }
    if (!isestr(cfg.workDir)) {
        throw new Error('createKnowledgeExtract 需要 workDir(唯一必填:所有輸出的路徑錨點)')
    }

    const workDir = normalizeWorkDir(cfg.workDir)

    // ── 路徑(workDir 展開,cfg.dirs 逐鍵覆寫;core/dirs 與執行端 config 同一份展開)──
    const dirs = expandDirs(workDir, cfg.dirs)

    // ── 設定與資料(內建預設＋覆寫)──
    const settings = resolveSettings(cfg)
    const clock = cfg.clock || createClock(cfg.timeZone || 'Asia/Taipei')
    /**
     * 標題預篩樣式正規化:接受 RegExp 或 { p, f }(JSON 可寫);其餘形狀啟動期拋錯——
     * new RegExp(undefined) 是空樣式、匹配一切,誤傳會把每一篇都判成彙整貼文而靜默零產出
     *
     * @param {*} x 輸入單一樣式項，RegExp 實例或 { p:樣式字串, f?:旗標字串 }
     * @param {Integer} i 輸入該項在 cfg.data.skipTitlePatterns 之索引(錯誤訊息用)
     * @returns {RegExp} 回傳正規表示式
     * @throws {Error} x 非 RegExp 亦非合法 { p, f } 形狀時拋出
     */
    const toTitleRe = (x, i) => {
        if (x instanceof RegExp) return x
        if (x && typeof x.p === 'string' && x.p) return new RegExp(x.p, x.f || '')
        throw new Error(`cfg.data.skipTitlePatterns[${i}] 須為 RegExp 或 { p: 樣式字串, f?: 旗標 }，收到：${JSON.stringify(x)}`)
    }
    const data = {
        seedSources: cfg.data?.seedSources || [],
        gridTopics: cfg.data?.gridTopics || [],
        vocab: cfg.data?.vocab || null, // null=用內建預設(domain 內 resolveVocab)
        skipTitlePatterns: (cfg.data?.skipTitlePatterns || SKIP_TITLE_PATTERNS_DEFAULT).map(toTitleRe),
    }

    // 繁簡折疊(分群鍵用):內建 opencc cn→tw;cfg.conceptFold=false 可停用,給函數即自訂,其餘值(含 true)一律用內建。
    // why:模型偶爾無視「一律繁體」輸出簡體,NFKC 不做繁簡轉換,不折疊會讓同一概念
    // 分裂兩群、產出重複核心檔(實例:同一概念繁體版 v47 ⇄ 簡體版 v1)
    // 【true 曾被當成停用】舊寫法 setConceptFold(cfg.conceptFold || 內建) 於 conceptFold:true 時把 true 傳入,
    //   setConceptFold 視非函數為清除——字面上「開啟」反而關閉折疊(2026-09-23 修)
    // 【false 須明確清除】折疊為模組級單例(同行程多個實例以最後建構者為準):false 若只是「不設定」,
    //   同行程先前實例注入之折疊會殘留,與「以最後建構者為準」不一致(2026-09-23 修)
    if (cfg.conceptFold === false) setConceptFold(null)
    else setConceptFold(typeof cfg.conceptFold === 'function' ? cfg.conceptFold : OpenCC.Converter({ from: 'cn', to: 'tw' }))

    // ── pipeline 形狀(先於 AI 組裝檢核:設定形狀錯誤的訊息不該被席位檢核搶先)──
    if (cfg.pipeline) {
        if (Array.isArray(cfg.plugins) && cfg.plugins.length) {
            throw new Error('插件僅作用於預設 pipeline;自組 pipeline 請直接對各工廠傳 tap/stages')
        }
        if (!Array.isArray(cfg.pipeline) || cfg.pipeline.length === 0) throw new Error('cfg.pipeline 須為非空陣列')
    }

    // ── 抓取器與去重身分(建構時定案:設定錯誤要在啟動期爆)──
    const fetchers = mergeFetchers(
        createDefaultFetchers({
            articleTimeoutMs: settings.fetch.articleTimeoutMs,
            openAlexMailto: cfg.openAlexMailto || '',
            // 網格來源之領域過濾(OpenAlex field id／arXiv 類別):通用套件預設不限,主題範圍由安裝方以 fetch 設定給
            openAlexFields: settings.fetch.openAlexFields,
            arxivCategories: settings.fetch.arxivCategories,
            // 站台 adapter:安裝方 cfg.siteAdapters 同 id 置換本套件自帶、其餘排前;不合契約者啟動期拋錯。
            // 合併結果再由 w-fetch-web 排在其內建清單(gelonghui/bloomberg/msn)之前
            siteAdapters: mergeSiteAdapters(DEFAULT_SITE_ADAPTERS, cfg.siteAdapters),
        }),
        cfg.fetchers || [],
    )
    const registry = W.createFetcherRegistry(fetchers)
    const identity = W.createIdentity(cfg.dedup || { keyOf: 'raw' })

    // ── LMDB(WOrm 內建,可注入替換;集合名可覆寫)──
    const lmdb = {
        WOrm: cfg.lmdb?.WOrm || WOrmDefault,
        path: cfg.lmdb?.path || dirs.db,
        db: cfg.lmdb?.db || 'kns',
        cls: { docs: 'docs', sources: 'sources', frontier: 'frontier', notes: 'notes', relations: 'relations', cores: 'cores', ...(cfg.lmdb?.cls || {}) },
    }

    // ── 內建領域預設(可由物件 opts 整組置換或 tap 逐環覆寫)──
    const domains = {
        triage: createTriageDomain({ vocab: data.vocab, triageCharsPerDoc: settings.knowledge.triageCharsPerDoc }),
        extract: createExtractDomain({ vocab: data.vocab, extractCharsPerDoc: settings.knowledge.extractCharsPerDoc }),
        relate: createRelateDomain({ vocab: data.vocab }),
        distill: createDistillDomain({ vocab: data.vocab, notesPerTarget: settings.knowledge.distillNotesPerConcept }),
    }

    // ── AI 調度層(內建;cfg.aiAdapter 整組置換——測試 stub/自建調度皆走這裡)──
    fsCreateFolder(dirs.state)
    const envFile = cfg.envFile
        ? (path.isAbsolute(cfg.envFile) ? cfg.envFile : `${workDir}/${cfg.envFile}`)
        : `${workDir}/.env`
    const aiWorkspace = cfg.aiWorkspace || `${workDir}/tmp/ai-workspace`
    // 當輪日誌:adapter 於建構期建立而日誌逐輪建立,健康層事件經此轉寫進當輪日誌(輪外為 null 即靜默)
    let runLog = null
    const ai = cfg.aiAdapter || createAiAdapter({
        ai: settings.ai,
        envFile,
        stateDir: dirs.state,
        workspace: aiWorkspace,
        clock,
        onHealth: (ev) => runLog?.warn(`供應商健康：${ev.providerId} 連續 ${ev.streak} 次 ${ev.errorType} 失敗（${ev.error}），降序冷卻`),
        // prompt 逾該條目長度上限而於呼叫前被剔除(省掉一次 spawn);同一條目每輪只記一行,次數由執行摘要彙報
        onOversize: (ev) => runLog?.warn(`供應商能力：${ev.providerId} 之 prompt 上限 ${ev.limit} 字元，本輪有呼叫達 ${ev.promptLen} 字元而改由遞補承接（未 spawn）`),
    })
    // 啟動期席位檢核(檔頭):不可解析即拋;能力不相容(如提煉席位派給命令列長度受限之 agy)只警告——席位配置屬安裝方裁示
    const startupWarnings = []
    if (typeof ai.validateSeats === 'function') {
        const r = ai.validateSeats(listSeats(settings.ai))
        for (const w of r?.warnings || []) startupWarnings.push(w)
    }

    // 提煉工作流:惰性建構(名額 id 驗證與 wkf 建立延後到提煉真的要跑;
    // 金鑰全缺的環境(測試/純抓取端)不因此在啟動期爆)
    let distillWorkflowMemo = null
    /**
     * 惰性建構並快取提煉工作流(cfg.distillWorkflow 給了即整組置換;否則由 settings.ai.distill 組裝)
     *
     * @returns {Object} 回傳工作流物件 { wkf, fanout:{indeps, integrate}, pipeline }(indeps/integrate/pipeline 各項皆經 ai.withBudget 包裝)
     */
    const getDistillWorkflow = () => {
        if (distillWorkflowMemo) return distillWorkflowMemo
        if (cfg.distillWorkflow) {
            distillWorkflowMemo = cfg.distillWorkflow; return distillWorkflowMemo
        }
        distillWorkflowMemo = {
            wkf: ai.getWkf(),
            fanout: {
                indeps: settings.ai.distill.fanout.indeps.map(ai.withBudget),
                integrate: ai.withBudget(settings.ai.distill.fanout.integrate),
            },
            pipeline: settings.ai.distill.pipeline.map(ai.withBudget),
        }
        return distillWorkflowMemo
    }

    // ── pipeline(預設四物件＋插件;自組 pipeline 時插件拋錯——無從注入,不默默失效)──
    let pipeline
    if (cfg.pipeline) {
        pipeline = cfg.pipeline
    }
    else {
        const pluginTaps = resolvePlugins(cfg.plugins || [])
        // 插件 hook 之「<物件>.<子階段>」前綴須對得上預設物件之子階段;對不上(錯字/已移除之子階段)即組裝期拋錯——
        // 此前只取 OBJECT_STAGES 列出者,其餘前綴之掛載被靜默丟棄,插件「註冊了卻完全沒反應」
        const knownPrefixes = Object.entries(OBJECT_STAGES).flatMap(([o, subs]) => subs.map((s) => `${o}.${s}`))
        const unknownPrefixes = Object.keys(pluginTaps).filter((p) => !knownPrefixes.includes(p))
        if (unknownPrefixes.length) {
            throw new MwContractError(`插件 hook 前綴不存在：${unknownPrefixes.join('、')}（可用：${knownPrefixes.join('、')}）`)
        }
        /**
         * 組單一物件(fetch/organize/relate/distill)之工廠 opt:使用者覆寫＋插件展開之各子階段 tap 合併
         *
         * @param {String} objKey 輸入物件鍵('fetch'／'organize'／'relate'／'distill')
         * @returns {Object} 回傳該物件之工廠 opt(cfg.objects[objKey] 逐子階段併入插件 tap)
         */
        const objOpt = (objKey) => {
            const user = cfg.objects?.[objKey] || {}
            const out = { ...user }
            for (const stageKey of OBJECT_STAGES[objKey]) {
                const fromPlugin = pluginTaps[`${objKey}.${stageKey}`]
                if (!fromPlugin) continue
                const stageOpt = { ...(out[stageKey] || {}) }
                stageOpt.tap = mergeTaps(stageOpt.tap, fromPlugin, `${objKey}.${stageKey}`)
                out[stageKey] = stageOpt
            }
            return out
        }
        pipeline = [
            createFetchObject(objOpt('fetch')),
            createOrganizeObject(objOpt('organize')),
            createRelateObject(objOpt('relate')),
            createDistillObject(objOpt('distill')),
        ]
    }
    // 索引段的掛載走 cfg.objects.index(自動附掛段不屬四物件,插件 hook 不涵蓋)
    const indexOpt = cfg.objects?.index || {}

    /**
     * 開全部集合(每次執行開一組,結束一律關閉——LMDB 檔案鎖不可跨執行持有)
     *
     * @returns {Object} 回傳集合物件 { docs, sources, frontier, notes, relations, cores }(各為 w-orm-lmdb 集合實例)
     */
    const openStores = () => {
        const out = {}
        for (const name of ['docs', 'sources', 'frontier', 'notes', 'relations', 'cores']) {
            out[name] = W.openCollection({ WOrm: lmdb.WOrm, path: lmdb.path, db: lmdb.db, cl: lmdb.cls[name] || name })
        }
        return out
    }

    /**
     * 關閉 openStores 開出之全部集合
     *
     * @param {Object} stores 輸入 openStores 之產物
     * @returns {Promise} 回傳 Promise，resolve 時代表全部集合皆已關閉
     */
    const closeStores = async (stores) => {
        for (const s of Object.values(stores)) await s.close()
    }

    /**
     * 每輪依賴(deps):套件子階段與執行端自寫單元同一條注入通道。
     *
     * 【工作流以函數而非 getter 交付】w-data-pipeline 的 createContext 以 spread
     *   複製 deps({...parentCtx.deps});Object.defineProperty 預設 enumerable:false,
     *   getter 屬性在 spread 時直接消失 → 子階段拿到 undefined、每輪靜默失敗
     *   (2026-08-20 實彈輪實測:提煉段每輪拋「需要 workflow.wkf」被隔離)。
     *   改為普通函數屬性:可列舉故能跨脈絡傳遞,且仍保持惰性
     *   (金鑰全缺的環境不因建 wkf 而在啟動期爆)。
     *
     * @param {Object} stores 輸入 openStores 之產物
     * @param {Object} seen 輸入 W.createSeenStore 之產物(去重身分查詢)
     * @returns {Object} 回傳依賴物件 { stores, seen, registry, clock, dirs, data, settings, ai, domains, getDistillWorkflow }
     */
    const buildDeps = (stores, seen) => ({
        stores,
        seen,
        registry,
        clock,
        dirs,
        data,
        settings,
        ai,
        domains,
        getDistillWorkflow,
    })

    const lockFile = cfg.lock === false ? null : (cfg.lock || `${dirs.tmp}/run.lock`)
    const mkLog = cfg.logFactory || (() => createLogger('run', { dir: dirs.log, clock }))

    // 時間預算單一來源(檔頭):排程上限 − 安全邊際;明給 deadlineMs 者優先。執行鎖陳舊期限同源推導。
    // cfg.scheduleLimitMin 為正式鍵(舊名 monitor.scheduleLimitMin 仍認:它此前只是巡檢環境,現為預算上游)
    const limitMin = Number(cfg.scheduleLimitMin ?? cfg.monitor?.scheduleLimitMin)
    const hasLimit = Number.isFinite(limitMin) && limitMin > 0
    const deadlineMs = Number.isFinite(cfg.deadlineMs) && cfg.deadlineMs > 0
        ? cfg.deadlineMs
        : (hasLimit ? Math.max(600_000, limitMin * 60_000 - DEADLINE_MARGIN_MS) : DEADLINE_DEFAULT_MS)
    const lockStaleMs = Number.isFinite(cfg.lockStaleMs) && cfg.lockStaleMs > 0
        ? cfg.lockStaleMs
        : (hasLimit ? limitMin * 60_000 + LOCK_STALE_EXTRA_MS : LOCK_STALE_DEFAULT_MS)
    if (!hasLimit && !(Number.isFinite(cfg.deadlineMs) && cfg.deadlineMs > 0)) {
        startupWarnings.push(`未給 scheduleLimitMin 亦未給 deadlineMs，整輪時間預算採套件預設 ${DEADLINE_DEFAULT_MS / 60000} 分（與本安裝端之排程上限無關）`)
    }

    // 巡檢之「主力供應商」＝各名額(extract/relate/distill 各席)之 use;用量占比判定據此計算。
    // 曾以 providerPick[0] 當主力:主力換家後每小時誤報一次(2026-08-13 起累計 257 筆)
    /** 取席位規格之 use(供應商 id);席位不存在時回 undefined */
    const seatUse = (s) => s?.use
    const primaryProviderIds = [...new Set([
        seatUse(settings.ai.extract?.executor), seatUse(settings.ai.relate?.executor),
        ...(settings.ai.distill?.fanout?.indeps || []).map(seatUse), seatUse(settings.ai.distill?.fanout?.integrate),
        ...(settings.ai.distill?.pipeline || []).map(seatUse),
    ].filter(Boolean))]

    // 收尾鉤子:預設=內建巡檢(每輪寫監控紀錄 md);cfg.afterRun=false 停用,函數則自訂
    let patrolMemo = null
    /**
     * 惰性建構並快取巡檢器(首次呼叫才建,建構含讀 dirs/settings 但不觸發 I/O)
     *
     * @returns {Object} 回傳巡檢器(createPatrol 之產物,含 patrolFromPipeline 等方法)
     */
    const getPatrol = () => {
        if (!patrolMemo) {
            patrolMemo = createPatrol({
                dirs,
                workDir,
                clock,
                envFile,
                openStores,
                closeStores,
                aiUsageToday: () => ai.aiUsageToday(),
                primaryProviderIds,
                scheduleLimitMin: hasLimit ? limitMin : undefined,
                // 狀態機全集(pending 兩態＋終態):多出來的狀態即「未判定即丟棄」類機制被重新引入之訊號
                knownStatuses: ['new', 'raw', ...settings.fetch.terminalStatuses],
                // 待辦表用:四關卡之每輪容量(由設定推導,與各階段實際取量同源)與提煉選題門檻
                maxFetchTries: settings.fetch.maxFetchTries,
                distillMinNotes: settings.knowledge.distillMinNotes,
                capacity: {
                    fetch: settings.fetch.articlesPerRun,
                    triage: settings.knowledge.triageCapacity,
                    extract: settings.knowledge.extractCapacity,
                    relate: settings.knowledge.relateCapacity,
                    distill: settings.knowledge.distillPerRun,
                },
                // 設定自洽與啟動期檢核之警告:巡檢以獨立判準(⑰)揭露,不靠日誌 WARN 掃描
                settingsWarnings: [...(settings.warnings || []), ...startupWarnings],
                ...(cfg.monitor || {}),
            })
        }
        return patrolMemo
    }
    const afterRun = cfg.afterRun === false
        ? null
        : (typeof cfg.afterRun === 'function' ? cfg.afterRun : () => getPatrol().patrolFromPipeline())

    return {
        /**
         * 執行一輪知識管線(開集合 → 跑 pipeline＋索引段 → 寫執行摘要 → 收尾鉤子 → 關集合)
         *
         * @returns {Promise} 回傳 Promise，resolve 回傳 report(runPipeline 之產物,額外含 summaryFile；
         *   未取得執行鎖時 report.lockSkipped 為 true,不寫摘要、不觸發收尾鉤子)
         */
        run: async () => {
            for (const d of Object.values(dirs)) fsCreateFolder(d)
            const log = mkLog()
            runLog = log
            for (const w of startupWarnings) log.warn(`啟動期檢核：${w}`)
            const stores = openStores()
            try {
                const seen = W.createSeenStore({ collection: stores.docs, identity, log })
                const deps = buildDeps(stores, seen)
                const root = definePipeline({
                    name: '知識管線',
                    log,
                    onError: 'continue',
                    deadlineMs,
                    lock: lockFile ? () => acquireLock(lockFile, { staleMs: lockStaleMs }) : undefined,
                    deps,
                    stages: [...pipeline, stageKnowledgeIndex(indexOpt)],
                })
                const startedAt = clock.iso8()
                const report = await runPipeline(root, { log })
                // 未取得鎖＝本輪未執行(上一輪仍在跑):不寫摘要、不收尾——寫了會被巡檢當成一輪早夭的執行
                if (report.lockSkipped) return report

                // ① 結構化摘要先落地(巡檢／健康檢查優先讀它;失敗只留 warn,不影響本輪成敗)
                const stamp = /^\d{14}$/.test(String(log.now || '')) ? log.now : clock.stamp8()
                const file = writeRunSummary({
                    dir: dirs.log,
                    stamp,
                    summary: buildRunSummary({ report, startedAt, endedAt: clock.iso8(), deadlineMs, ai, stamp }),
                })
                if (!file) log.warn?.('執行摘要（run.json）寫入失敗——巡檢將退回正則解析日誌')
                report.summaryFile = file

                // ② 收尾鉤子(預設巡檢):在管線外、摘要之後;失敗留痕,不影響本輪成敗(檔頭)
                if (typeof afterRun === 'function') {
                    const t0 = Date.now()
                    try {
                        const r = await afterRun({ report, summaryFile: file, log, deps })
                        if (r && r.ok === false) log.warn(`收尾失敗：${oneline(r.error, 200)}（管線本身不受影響；監控紀錄停留在上一輪）`)
                        else log.info(`收尾完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`)
                    }
                    catch (e) {
                        log.warn(`收尾鉤子拋錯：${oneline(e?.message, 200)}`)
                    }
                }
                return report
            }
            finally {
                runLog = null
                await closeStores(stores)
            }
        },
        /** 維運入口(工具用):同一套集合定義,呼叫端自負開關 */
        openStores,
        closeStores,
        /** 維運入口:不開管線時取得依賴(clock/dirs/settings/ai/domains/patrol/deadlineMs/lockStaleMs/startupWarnings) */
        info: () => ({ dirs, settings, clock, ai, domains, registry, lmdb, data, deadlineMs, lockStaleMs, startupWarnings, patrol: getPatrol() }),
    }
}

export default createKnowledgeExtract
