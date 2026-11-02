// extractTestKit.mjs — 提煉整合測試之共用件(總組裝層;不帶 .test. 中綴;只 import 套件內之檔案、三個測試專用之橋接與 node_modules 套件)
//
// 【為何走總組裝】整合測試跑的是套件對外之總組裝 createKnowledgeExtract(設定、詞彙、domain、鎖、日誌、執行摘要皆為真實件;集合為真 LMDB),
//   只換兩件事:①workDir 換成 test/_tmp/<案名>-<pid>(LMDB、目錄、鎖檔與日誌皆落此,與他測試隔離)②AI 調度層換成 3+3 之腳本化替身
//   (extractKit 之 scriptAi;不發網路、不燒額度)。本機網路判斷本套件預設即不做(cfg.netGuard 未給);斷網情境由測試明給判斷器。
// 【筆記即摘要套件交出之產物】landNote 取摘要套件之測試件 noteKit 之工廠(landNoteOf;經 summarizeForTest)以 related:true 實例化——以摘要套件之真實組裝
//   (buildNote)寫 md 與記錄,提煉讀到的是摘要真實之版型與欄位(md 之章名、記錄之 claimType／evidenceLevel／sourceName),不是測試自擬之形狀;
//   關聯之完成時刻(relatedAt)預設已給(可提煉)。seedNotes(筆記記錄與關聯之邊寫入集合)取關聯套件之測試件(經 relateForTest;關聯、提煉同一份)。
// 【位置無關之共用件】日誌之替身(silentLog、logsOf、fileLogFactory)、暫存根之刪除(removeRoots)、概念折疊之還原、子階段 report(subReport)、集合之開關
//   (withStores)、日誌目錄之檔(findFiles)、讀 JSON 皆取抓取套件之 test/tools/testKit(經 captureForTest;四套件同一份),本檔原樣轉出;
//   綁套件位置者(套件根 PKG_ROOT、暫存根 tmpRoot)以其工廠依本套件實例化。
// 【測試之提煉設定】TEST_EXTRACT(3+3 席位為替身之 use、小批、門檻 2 篇、不等候)與 cfg.extract 淺合併——測試只寫與預設不同之鍵。
// 【暫存】各測試自建專用資料夾(tmpRoot)、測完即刪(removeRoots;刪不掉者只警示)。
// 【固定埠】本套件之測試埠 8881～8889:8881＝無人監聽之死埠(內建調度層之條目指向它即整鏈皆敗)、8882＝假 REST(上游之工作流入口之真實路徑)。

import { createKnowledgeExtract } from '../../src/createKnowledgeExtract.mjs'
import {
    pkgRootOf, tmpRootsOf, silentLog, logsOf, fileLogFactory, removeRoots, resetConceptFold, subReport, withStores, findFiles, readJsonFile,
} from './captureForTest.mjs'
import { landNoteOf } from './summarizeForTest.mjs'
import { seedNotes } from './relateForTest.mjs'
import { scriptAi, SEATS } from './extractKit.mjs'

/** 套件根(以本檔位置推導,與 cwd 無關;正斜線) */
export const PKG_ROOT = pkgRootOf(import.meta.url)

/**
 * 專用暫存根(套件內 test/_tmp/<name>-<pid>;已存在者清掉重建;帶 pid 使並行互不干擾):tmpRoot(name) → 絕對路徑(正斜線)
 *
 * @type {Function}
 */
export const { tmpRoot } = tmpRootsOf(PKG_ROOT)

/** 無人監聽之本機埠(連線即被拒):內建調度層之條目指向它即「整鏈皆敗」 */
export const DEAD_PORT = 8881

/** 假 REST 之本機埠(上游調度層之工作流入口經真實之遞補鏈打到它) */
export const FAKE_PORT = 8882

/**
 * 測試之提煉設定(與 cfg.extract 淺合併):3+3 席位為替身之 use;每批 3 篇、新核心門檻 2 篇、每輪 2 個核心、不等候、關聯寬限 0 天
 *
 * @type {Object}
 */
export const TEST_EXTRACT = Object.freeze({ minNotes: 2, notesPerConcept: 3, perRun: 2, catchupBatches: 1, minPending: 1, maxWaitDays: 0, relateGraceDays: 0, ai: SEATS })

/**
 * 摘要套件交出之筆記(以其真實組裝寫 md 與組記錄;不入集合);關聯之完成時刻預設已給(relatedAt＝建立時刻,可提煉)
 *
 * 輸入 (notesDir, o):notesDir 為筆記 md 目錄;o 為 { doc:來源文件 id(決定 slug 之尾碼), title, concepts:Array, category?, summary?, keyPoints?:Array, conditions?:Array,
 *   k?:Object(摘要項目之其他欄位,如 parameters、methods、pros、cons、regime_dependency、counter_views、verifiable——對應各選填章),
 *   nowIso?(建立時刻;未給取真時鐘), record?:Object(記錄之額外欄位,覆寫 relatedAt 等) };回傳筆記記錄(id 即 slug;file 為 md 之路徑)
 *
 * @type {Function}
 */
export const landNote = landNoteOf({ related: true })

/**
 * 以總組裝建立測試用之提煉流程
 *
 * overrides 之鍵即 cfg 之鍵(見 createKnowledgeExtract 之 CFG_KEYS);其中 extract 與 TEST_EXTRACT 淺合併。另有測試專用鍵 log(日誌物件,
 * 給了即取代靜音日誌;每輪共用同一個)。預設:afterRun false、鎖檔在 <root>/tmp/run.lock、AI 為 3+3 之預設替身(holds 與 checks 為必開之集合)
 *
 * @param {String} root 輸入暫存根(tmpRoot 之產物或其子目錄)
 * @param {Object} [overrides={}] 輸入 cfg 覆寫
 * @returns {Object} 回傳 { flow, cfg, ai }：ai 為實際使用之 AI 調度層
 */
export function buildTestExtractor(root, overrides = {}) {
    const { log, extract, ...rest } = overrides
    const cfg = {
        workDir: root,
        afterRun: false,
        logFactory: () => log || silentLog,
        lock: `${root}/tmp/run.lock`,
        aiAdapter: scriptAi(),
        ...rest,
        extract: { ...TEST_EXTRACT, ...(extract || {}) },
    }
    return { flow: createKnowledgeExtract(cfg), cfg, ai: cfg.aiAdapter }
}

export { silentLog, logsOf, fileLogFactory, removeRoots, resetConceptFold, subReport, withStores, findFiles, readJsonFile, seedNotes }

export default {
    PKG_ROOT, DEAD_PORT, FAKE_PORT, silentLog, TEST_EXTRACT, logsOf, fileLogFactory, tmpRoot, removeRoots, resetConceptFold, landNote, buildTestExtractor,
    withStores, seedNotes, subReport, findFiles, readJsonFile,
}
