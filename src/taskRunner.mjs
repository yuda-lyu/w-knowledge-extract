// taskRunner.mjs — 第二入口:排程任務執行殼(輕量;不載入知識管線之 stages／domain／lmdb／opencc)
//
// 【為何有兩個入口】主入口 WKnowledgeExtract.mjs 是完整知識管線(載入 opencc-js 轉換表、w-orm-lmdb、
//   w-fetch-web 與全部 stages);排程殼的消費端(如他專案之 AI 新聞管線)只需要「設定載入／時區時鐘／每次一檔日誌／
//   runTask 外殼／行程安全網／Telegram 通知／AI 接線／子進程隔離」這幾件泛用秩序,不該為此背上整套知識庫。
//   本入口只 import 泛用件(2026-09-23 本機實測約 0.15s),同 rxjs 之 `rxjs/operators`、firebase modular 之分入口做法。
//   主入口亦匯出本檔全部成員(同名即同一實作),擇一即可。
//
// 【抽提判準】外部給步驟,套件給秩序:任務要抓什麼、怎麼過濾、分幾步、prompt 怎麼寫、訊息怎麼排版,一律留消費端;
//   怎麼計時、怎麼記日誌、失敗怎麼收、狀態存哪、外部呼叫怎麼隔離,在本入口。
//   w-fetch-web 不經本入口載入(runJsonCli 只做子進程隔離,用哪個抓取器仍留消費端)。
//
// 【轉出 w-dispatch-ai 之三件工具】readEnvFile／createFileStore／createUsageCounter:消費端經本物件單一入口取用即可,
//   不必分辨哪件住哪個套件;實作與文件以 w-dispatch-ai 為準。
//
// 【來歷】2026-09-21 自他專案之執行殼(暫名 w-task-runner)移入並與本套件既有件合併:clock⊇time、logger⊇runLogger、
//   oneline 統一 strTruncate、cliFail 委派 cliFailDetail、目錄展開共用 ai/resolve;2026-09-23 檔名由 WTaskRunner.mjs 改為 taskRunner.mjs。
//
// import taskRunner from 'w-knowledge-extract/src/taskRunner.mjs'
// const { loadSettings, createTime, createRunLogger, runTask } = taskRunner

import readEnvFile from 'w-dispatch-ai/src/readEnvFile.mjs'
import createFileStore from 'w-dispatch-ai/src/wkf/createFileStore.mjs'
import createUsageCounter from 'w-dispatch-ai/src/wkf/createUsageCounter.mjs'
import { loadSettings, decorateSettings, createSettingsHolder, DF_DIRS } from './core/loadSettings.mjs'
import { acquireLock } from './core/lock.mjs'
import { createClock, createTime } from './util/clock.mjs'
import { createRunLogger, createLogger } from './ops/logger.mjs'
import { runTask } from './ops/runTask.mjs'
import { installProcessGuards } from './ops/processGuards.mjs'
import { createTelegramNotifier, escapeHtml, TELEGRAM_TEXT_MAX } from './ops/notify.mjs'
import { createAiCaller } from './ai/caller.mjs'
import { createAiAdapter } from './ai/adapter.mjs'
import { logAiOutcome, createAiEventLogger, OUTCOME_TEXT } from './ai/logAiOutcome.mjs'
import { parseIndexList, parseJsonArray, makeArrayCoverageValidator } from './ai/parsers.mjs'
import { resolveCatalogue, mergeCatalogue, timeoutPatch } from './ai/resolve.mjs'
import { runJsonCli, makeLineEmitter } from './fetchers/runJsonCli.mjs'
import { oneline, cliFailDetail, firstLineClamp, readJson, writeJson } from './util/misc.mjs'


/**
 * 排程任務執行殼(第二入口,輕量)
 *
 * 只提供排程任務共通之「秩序」:設定載入(JSON5＋workDir 衍生路徑＋機密宣告式注入)、時區時鐘、每次一檔日誌、
 * runTask 外殼(起訖行/總計時/收攔/失敗通知)、行程安全網、Telegram 通知、AI 接線(原始遞補呼叫與 JSON 任務層)、
 * 子進程隔離之 CLI 執行;任務內容(抓什麼、prompt、訊息模板、步驟)一律留消費端
 *
 * 不載入知識管線(stages／domain／opencc-js／w-orm-lmdb),主入口 WKnowledgeExtract 亦含本物件全部成員(同名即同一實作)
 *
 * @returns {Object} 回傳執行殼物件,含 loadSettings、decorateSettings、createSettingsHolder、DF_DIRS、createTime、createClock、
 *     createRunLogger、createLogger、runTask、installProcessGuards、acquireLock、createTelegramNotifier、escapeHtml、TELEGRAM_TEXT_MAX、
 *     createAiCaller、createAiAdapter、logAiOutcome、createAiEventLogger、OUTCOME_TEXT、parseIndexList、parseJsonArray、
 *     makeArrayCoverageValidator、resolveCatalogue、mergeCatalogue、timeoutPatch、readEnvFile、createFileStore、createUsageCounter、
 *     runJsonCli、makeLineEmitter、oneline、cliFailDetail、firstLineClamp、readJson、writeJson
 * @example
 * import taskRunner from 'w-knowledge-extract/src/taskRunner.mjs'
 *
 * let { createTime, createRunLogger, runTask } = taskRunner
 *
 * let time = createTime('Asia/Taipei')
 * let logger = createRunLogger({ root: './log', getISO: time.getISO })
 * let r = await runTask({
 *     name: '每日任務',
 *     logger,
 *     getNow: time.getNow,
 *     run: async (ctx) => {
 *         ctx.log('執行中')
 *         return 'done'
 *     },
 * })
 * console.log(r.ok, r.result)
 * // => true done
 */
let taskRunner = {

    //設定
    loadSettings,
    decorateSettings,
    createSettingsHolder,
    DF_DIRS,

    //時間與記錄
    createTime,
    createClock,
    createRunLogger,
    createLogger,

    //執行殼
    runTask,
    installProcessGuards,
    acquireLock,

    //通知
    createTelegramNotifier,
    escapeHtml,
    TELEGRAM_TEXT_MAX,

    //AI 接線(caller:原始遞補契約;adapter:JSON 任務＋健康＋計帳)
    createAiCaller,
    createAiAdapter,
    logAiOutcome,
    createAiEventLogger,
    OUTCOME_TEXT,
    parseIndexList,
    parseJsonArray,
    makeArrayCoverageValidator,
    resolveCatalogue,
    mergeCatalogue,
    timeoutPatch,

    //轉出自 w-dispatch-ai
    readEnvFile,
    createFileStore,
    createUsageCounter,

    //外部呼叫
    runJsonCli,
    makeLineEmitter,

    //工具
    oneline,
    cliFailDetail,
    firstLineClamp,
    readJson,
    writeJson,

}


export default taskRunner
