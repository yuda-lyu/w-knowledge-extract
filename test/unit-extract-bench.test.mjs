// unit-extract-bench.test.mjs — 提煉之 AI 能力評分(bench/extractBench.mjs、bench/cli.mjs、standards/esCases.mjs)之單元測試:以替身調度層
//   (工作流入口之替身;不連網、不呼叫真 AI)驗十四角色(判定類六角色＋工作流類八角色 wf-*)
//   ①題組:判定類六份通用題組全數通過驗證(案數、保留題、std／v、類別涵蓋、每案依據);工作流類八份各 16 案(12 一般＋4 保留;保留題涵蓋 ≥2 種謂詞組合;
//     各謂詞皆有案列於應然);ES9／ES8／ES14／ES11
//     逐案題組之同形案可直接收、標準或版本不符拒收;各角色之逐案檢核(缺欄、應然非法、打錯之謂詞名 → 任何呼叫之前列出全部問題);題組層之出處一致性
//   ②頁組法與提示詞:esCases 之頁組法與「安裝方之檢定標準逐案執行器」之組法(本檔內之參考實作)逐字同,且與正式之 run*Check 實際送出之提示詞逐字同
//     (四標準各一,以替身截取第一席之提示詞);評分之分頁與提示詞＝esCases;--batch;修訂之頁同正式;提議之名單先排序;工作流類之提示詞＝正式之 domain.build*Prompt
//   ③呼叫:單棒經 extractAiCall(席位不遞補、正式之 parse 與 check、acceptTruncated:false、onEvent 轉交);起草三席之棒經 extractFanout(受測席一席、凍結席不送出);
//     失敗之逐次摘要附不合格原因(抓取套件之 callJsonShapeOf)
//   ④逐案類別:示範回覆逐案每回皆通過(應然可達;十四角色;工作流類八角色共 128 案各一份應然回覆 WF_DEMO);各角色之邊界(缺票、同編號矛盾、出處不符、
//     拆解欄位不可用、修訂之各謂詞、提議之漏提與誤提、工作流類各謂詞之不成立);工作流類之反例回覆 WF_NEG(逐筆判得出不成立之謂詞;每謂詞 ≥2 份且分佈於 ≥2 案;
//     每角色 ≥1 份與示範回覆只差一處者;修訂之 notWorse 不可由回覆構成不成立,另以一案證之)
//   ⑤命令列與受測名單:--role all 依序十四角色、--lang、用法說明、薄殼、預設受測名單
//   ⑥領域中立:題組與評分原始碼不含量化／金融詞與網址;esCases 之共用件(coreStateOf、disputeCaseOf、reviseCaseOf)
// 執行(套件根):node node_modules/mocha/bin/mocha.js --timeout 180000 test/unit-extract-bench.test.mjs(暫存 test/_tmp/extract-bench-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
    EXTRACT_BENCH_ROLES, EXTRACT_BENCH_ROLE_IDS, EXTRACT_BENCH_CASES_FILES, EXTRACT_BENCH_MODELS, EXTRACT_BENCH_USAGE, WF_STRUCTURAL,
    supportCheckBenchRole, supportReviseBenchRole, orphanCheckBenchRole, disputeCheckBenchRole, synonymCheckBenchRole, synonymProposeBenchRole,
    wfAuditBenchRole, wfAcceptBenchRole, wfPendingBenchRole, wfIntegrateBenchRole, wfDraftBenchRole, wfReviseBenchRole, wfConsolidateBenchRole, wfEssenceBenchRole,
    extractBenchRoleOf, runExtractBench, planExtractBench, runExtractBenchCli, parseExtractBenchArgs,
} from '../src/bench/extractBench.mjs'
import * as cli from '../src/bench/cli.mjs'
import { DEFAULT_FREE_MODELS, resolveLocale } from '../src/core/capturePackage.mjs'
import { EXTRACT_DEFAULT } from '../src/core/extractSettings.mjs'
import { createExtractDomain, SUPPORT_KINDS } from '../src/domain/extractDomain.mjs'
import { SKIP_REASONS, essenceNeedOf, emptyState } from '../src/stores/coreState.mjs'
import { removalAllowed, normalizeIssues, issueOnOp, ISSUE_TYPES, SEV_HIGH } from '../src/workflow/reviewGuards.mjs'
import { parseSupportChecks, checkSupportChecks, supportClassOf, runSupportCheck, SUPPORT_KINDS as SUPPORT_KINDS_STD } from '../src/standards/supportCheck.mjs'
import { parseSupportRevise } from '../src/standards/supportRevise.mjs'
import { parseOrphanChecks, runOrphanCheck } from '../src/standards/orphanCheck.mjs'
import { parseDisputeChecks, runDisputeCheck } from '../src/standards/disputeCheck.mjs'
import { parseSynonymChecks, parseSynonymProposals, runSynonymCheck, SYNONYM_PAGE_SIZE } from '../src/standards/synonymCheck.mjs'
import { parseDraft, parseAudit, parsePatch, parseVerdicts } from '../src/standards/parse.mjs'
import * as esCases from '../src/standards/esCases.mjs'
import { domainTermsIn, validateBenchCases, BENCH_BOARD_HEADER, msgOf, plainLog, sourceFilesOf } from './tools/captureForTest.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'

const { esPageOf, esPagesOfCases, dissolveUsableOf, disputeCaseOf, reviseCaseOf, coreStateOf, esSuiteProblems, esByMatchOf, reviseReasonsOf, ES_BY_MISMATCH, ES_NOT_NOFIELDS, ES_CASE_PAGE_SIZE } = esCases

// 套件根與測試暫存(以本檔位置定,不依 cwd;暫存根 tmpRoot 帶 pid 使並行互不干擾、before 內建立(舊者清掉重建)、after 刪除並回驗)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let TMP = ''

/** 預設詞彙之 domain */
const D = createExtractDomain()
/** 判定類六角色與工作流類八角色(依 --role all 之序) */
const JUDGE_IDS = ['support-check', 'support-revise', 'orphan-check', 'dispute-check', 'synonym-check', 'synonym-propose']
const WF_IDS = ['wf-audit', 'wf-accept', 'wf-pending', 'wf-integrate', 'wf-draft', 'wf-revise', 'wf-consolidate', 'wf-essence']
const ROLE_IDS = [...JUDGE_IDS, ...WF_IDS]
/** 各角色之內建題組(已驗) */
const SET = Object.fromEntries(ROLE_IDS.map((id) => [id, planExtractBench(id).set]))

// ════════════════ 示範回覆(各案之應然答案;驗應然可達) ════════════════

/** 明確票之理由(≥10 字) */
const WHY = '出處之內容經逐項比對後所得之結論'

/** 爭議覆核:非對立之拆解欄位(轉為主張之方:rule 與完整之標注;不另立主張之方:null) */
const dissolveFieldsOf = (sides) => ({
    kinds: sides.map((sd) => (sd.toClaim === false ? null : 'rule')),
    annotations: sides.map((sd) => (sd.toClaim === false ? null : { critique: '僅單一研究之觀察', pros: ['出處未載'], cons: ['出處未載'] })),
})

/** 修訂之示範改寫(過守門與納入閘,且合案明定之謂詞) */
const REVISE_FIX = {
    r01: { text: '某小學三年級每日 15 分鐘晨讀一學期後，閱讀測驗平均分數提高', conditions: ['某一所小學之三年級', '實施一學期'] },
    r02: { text: '該河段之溶氧量維持在每公升 6 毫克以上', conditions: ['單一河段之觀測'], period: '2018 至 2020 年' },
    r04: { text: '某大學一門統計入門課之線上班期末測驗平均分數略高於實體班', conditions: ['某大學一門統計入門課'] },
    r05: { text: '每日日照 6 小時以上之番茄植株，平均每株結果數多於日照不足 4 小時者', conditions: ['同一溫室', '同一品種'] },
    r06: { text: '雨天騎乘機車時煞車距離可能變長', conditions: ['路面濕滑', '單次測試約 1.5 倍'] },
    r07: { text: '此款節能燈泡在特定使用條件下估計可使用約十年', conditions: ['室溫 25 度', '每日點亮 3 小時', '製造商估計'] },
    r09: { text: '某市一條路段改為單行道後，一年內交通事故件數較前一年減少', conditions: ['某市單一路段'] },
    h1: { text: '使用站立式辦公桌 3 個月後，員工自評之背痛程度降低', conditions: ['某公司 30 名員工', '自評'] },
    h2: { text: '在 OLED 螢幕之手機上，深色介面較淺色介面省電', conditions: ['OLED 螢幕之手機'] },
    h3: { text: '此款空氣清淨機可降低塵蟎過敏原之濃度', conditions: ['密閉測試室內運轉 1 小時'] },
}

/** 工作流類之共用材料(示範回覆之操作) */
const OP_A = { op: 'add', kind: 'rule', text: '社區圖書館週末開放後，週末借閱量約占全週兩成', conditions: ['某社區圖書館之統計'], critique: '僅單一館之觀察', pros: ['擴大服務時段'], cons: ['出處未載'], sources: ['N1'] }
const OP_P = { op: 'add', kind: 'pitfall', text: '延長開放時段若未增派人力，閉館後之整理時間不足', conditions: ['未增派人力時'], critique: '僅館方之說明', sources: ['N2'] }

/** 審計之高嚴重度意見(植入之缺陷) */
const aud = (ref, type, detail) => ({ ref, severity: '高', type, detail, fix: '刪除' })

/** 起草之示範操作(新增主張;標注齊全。rule／principle:銳評與利弊;pitfall:條件與銳評;temporal:期間與銳評) */
const mkRule = (text, cond, sources) => ({ op: 'add', kind: 'rule', text, conditions: [cond], critique: '僅單一來源之說法', pros: ['出處未載'], cons: ['出處未載'], sources })
const mkPri = (text, sources) => ({ op: 'add', kind: 'principle', text, critique: '僅兩個來源之主張', pros: ['出處未載'], cons: ['出處未載'], sources })
const mkPit = (text, cond, sources) => ({ op: 'add', kind: 'pitfall', text, conditions: [cond], critique: '僅單一來源之說明', sources })
const mkTmp = (text, period, sources) => ({ op: 'add', kind: 'temporal', text, period, critique: '僅單一來源之公告', sources })
/** 起草之示範爭議(兩方各引一篇) */
const mkDis = (question, a, b) => ({ op: 'dispute_add', question, sides: [{ position: a, sources: ['N1'] }, { position: b, sources: ['N2'] }] })

/** 本質之示範回覆:一條 essence 操作 */
const ess = (text, claims, reason = '綜合各條主張') => ({ ops: [{ op: 'essence', text, claims, reason }] })

/** 整併之示範操作:把 from 併入 into */
const mg = (into, from, reason) => ({ op: 'merge', into, from, reason })

/** 整合之示範操作:取案之第 seat 席第 n 條候選操作(皆 1 起),加 via(指回之候選操作 id)並可覆寫欄位(整合後之 ref 為席位前綴 a<席>_<ref>) */
const pick = (id, seat, n, via, over = {}) => ({ ...SET['wf-integrate'].cases.find((c) => c.id === id).input.candidates[seat - 1].ops[n - 1], via, ...over })

/**
 * 工作流類之示範回覆(以案 id 為鍵;逐案起草之題組須為每案給一份,證應然可達)
 *
 * @type {Object}
 */
const WF_DEMO = {
    a01: { issues: [{ ref: 'a1_2', severity: '高', type: '捏造', detail: '出處未載倍增，亦未及各地圖書館', fix: '刪除' }] },
    a02: { issues: [{ ref: 'a2_1', severity: '高', type: '重複', detail: '與 a1_1 同義', fix: '刪除' }] },
    a03: { issues: [aud('a2_1', '離題', '出處只談盆栽澆水，本條談公車末班車')] },
    a04: { issues: [] },
    a05: { issues: [aud('a2_1', '捏造', '出處只說行駛時間縮短，未提任何路線或減半')] },
    a06: { issues: [aud('a2_1', '重複', '與 a1_1 同指遠離路燈可見較多暗星')] },
    a07: { issues: [aud('a1_3', '離題', '出處只談燉肉火候，本條談學童閱讀')] },
    a08: { issues: [aud('a2_1', '捏造', '出處未提保暖毯可完全避免失溫')] },
    a09: { issues: [aud('a2_1', '重複', '與 a1_1 同指解說兩分鐘內較能專注'), aud('a2_2', '離題', '停車場收費與出處無關')] },
    a10: { issues: [] },
    a11: { issues: [aud('a2_1', '捏造', '出處未提再製比例'), aud('a3_1', '離題', '樂器調音與出處無關')] },
    a12: { issues: [aud('a2_1', '重複', '與 a1_1 同指固定時段練習較易持續')] },
    ah1: { issues: [aud('a2_1', '捏造', '出處未談午睡長短與專注力')] },
    ah2: { issues: [aud('a2_1', '離題', '花園堆肥與泳池水質無關')] },
    ah3: { issues: [aud('a2_2', '重複', '與 a1_2 同指無人簽收時留通知單')] },
    ah4: { issues: [{ ref: 'a1_2', severity: '低', type: '措辭', detail: '可再精簡', fix: '精簡文字' }] },
    c01: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '捏造', note: '出處未載倍增' }, { i: 2, action: 'keep' }] },
    c02: { verdicts: [{ i: 0, action: 'keep', note: '兩條同義' }] },
    c03: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep', note: '同一社團修正其說法，取代成立' }] },
    c04: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '重複', note: '與 i=0 同義' }, { i: 2, action: 'keep' }] },
    c05: { verdicts: [{ i: 0, action: 'drop', reason: '性質標錯', note: '兩條結論各異，不可併為一條' }] },
    c06: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep', note: '週末之班距與平日不同，非重複' }] },
    c07: { verdicts: [{ i: 0, action: 'doubt', reason: '非對立', note: '兩方談結塊速度與處理方式，並不互斥' }, { i: 1, action: 'keep' }] },
    c08: { verdicts: [{ i: 0, action: 'keep', note: '兩個獨立說法拆開成立' }] },
    c09: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep', note: '見於 N2，離題意見不成立' }] },
    c10: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'doubt', reason: '非對立', note: '兩方談不同情境' }, { i: 2, action: 'drop', reason: '捏造', note: '出處未說完全避免受傷' }] },
    c11: { verdicts: [{ i: 0, action: 'drop', reason: '捏造', note: 'C1 之出處明載整理時間不足' }] },
    c12: { verdicts: [{ i: 0, action: 'drop', reason: '性質標錯', note: '取代方向相反' }] },
    ch1: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep' }, { i: 2, action: 'drop', reason: '離題', note: '與出處無關' }] },
    ch2: { verdicts: [{ i: 0, action: 'drop', reason: '性質標錯', note: 'C2 之內容明載於 n1，並非離題' }, { i: 1, action: 'keep' }] },
    ch3: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep' }] },
    ch4: { verdicts: [{ i: 0, action: 'keep', note: '兩條同義，合併成立' }] },
    p01: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '捏造', note: 'C1 之出處明載' }] },
    p02: { verdicts: [] },
    p03: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '捏造', note: '「3 小時」不見於出處' }] },
    p04: { verdicts: [{ i: 0, action: 'drop', reason: '性質標錯', note: '兩條結論各異，不可併為一條' }] },
    p05: { verdicts: [{ i: 0, action: 'keep', note: '兩條同義' }] },
    p06: { verdicts: [{ i: 0, action: 'drop', reason: '同篇', note: 'principle 之出處只有一份文件' }, { i: 1, action: 'keep' }] },
    p07: { verdicts: [] },
    p08: { verdicts: [] },
    p09: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '捏造', note: '「6 小時」與全部更換為出處所無' }] },
    p10: { verdicts: [{ i: 0, action: 'keep', note: '兩條同義' }, { i: 1, action: 'drop', reason: '性質標錯', note: 'C3 見於 n1，並非離題' }] },
    p11: { verdicts: [{ i: 1, action: 'keep' }] },
    p12: { verdicts: [{ i: 1, action: 'drop', reason: '捏造', note: '學員人數與成效為出處所無' }] },
    ph1: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '捏造', note: '當日再次投遞為出處所無' }] },
    ph2: { verdicts: [] },
    ph3: { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep' }] },
    ph4: { verdicts: [{ i: 0, action: 'drop', reason: '性質標錯', note: 'C1 之內容明載於 n1，並非離題' }] },
    g01: { ops: [{ ...OP_A, via: ['a1_1', 'a2_1', 'a3_1'] }, { ...OP_P, via: ['a1_2', 'a3_2'] }], skipped: [] },
    g02: { ops: [{ ...OP_A, via: ['a1_1', 'a2_1'] }], skipped: [] },
    g03: { ops: [pick('g03', 1, 1, ['a1_1', 'a2_1']), pick('g03', 1, 2, ['a1_2', 'a3_1']), pick('g03', 1, 3, ['a1_3', 'a2_2'])], skipped: [] },
    g04: { ops: [pick('g04', 1, 1, ['a1_1', 'a2_1'], { ref: 'a1_f' }), pick('g04', 1, 3, ['a1_3', 'a2_2'], { claim: '@a1_f' }), pick('g04', 1, 2, ['a1_2', 'a3_1'])], skipped: [] },
    g05: { ops: [pick('g05', 1, 1, ['a1_1']), pick('g05', 2, 1, ['a2_1']), pick('g05', 3, 1, ['a3_1'])], skipped: [] },
    g06: { ops: [pick('g06', 1, 1, ['a1_1', 'a2_1'], { ref: 'a1_m' }), pick('g06', 1, 2, ['a1_2', 'a2_2'], { text: '避開光害〔@a1_m〕之地點應如何挑選？' }), pick('g06', 3, 1, ['a3_1'])], skipped: [] },
    g07: { ops: [pick('g07', 1, 1, ['a1_1', 'a2_1'])], skipped: [] },
    g08: { ops: [pick('g08', 1, 1, ['a1_1', 'a2_1']), pick('g08', 1, 2, ['a1_2', 'a3_1'])], skipped: [] },
    g09: { ops: [pick('g09', 1, 1, ['a1_1', 'a2_1'], { ref: 'a1_a' }), pick('g09', 1, 2, ['a1_2', 'a2_2'], { ref: 'a1_b' }), pick('g09', 1, 3, ['a1_3', 'a2_3'], { sides: [{ position: '真人導覽互動性佳', claims: ['@a1_a'], sources: ['N1'] }, { position: '語音導覽可自行調整節奏', claims: ['@a1_b'], sources: ['N2'] }] })], skipped: [] },
    g10: { ops: [pick('g10', 1, 1, ['a1_1', 'a2_1', 'a3_1']), pick('g10', 1, 2, ['a1_2', 'a3_2'])], skipped: [] },
    g11: { ops: [pick('g11', 1, 1, ['a1_1', 'a2_1'], { ref: 'a1_k' }), pick('g11', 1, 2, ['a1_2', 'a2_2', 'a3_1'], { claim: '@a1_k' })], skipped: [] },
    g12: { ops: [pick('g12', 1, 1, ['a1_1']), pick('g12', 2, 1, ['a2_1'])], skipped: [] },
    gh1: { ops: [pick('gh1', 1, 1, ['a1_1', 'a2_1']), pick('gh1', 1, 2, ['a1_2', 'a3_1'])], skipped: [] },
    gh2: { ops: [pick('gh2', 1, 1, ['a1_1', 'a2_1'], { ref: 'a1_p' }), pick('gh2', 1, 2, ['a1_2', 'a2_2'], { text: '暫停開放〔@a1_p〕後應何時恢復？' })], skipped: [] },
    gh3: { ops: [pick('gh3', 1, 1, ['a1_1', 'a2_1']), pick('gh3', 1, 2, ['a1_2', 'a3_1'])], skipped: [] },
    gh4: { ops: [pick('gh4', 1, 1, ['a1_1', 'a2_1']), pick('gh4', 3, 1, ['a3_1'])], skipped: [] },
    d01: { ops: [OP_A], skipped: [{ note: 'N2', reason: SKIP_REASONS[0] }] },
    d02: { ops: [{ op: 'confirm', id: 'C1', sources: ['N1'] }], skipped: [] },
    d03: { ops: [mkRule('觀葉植物每月施肥一次，肥料須稀釋後使用', '某園藝社之建議', ['N1']), mkPit('施肥後 2 小時內陽光直射易使葉片灼傷', '施肥後 2 小時內', ['N1'])], skipped: [] },
    d04: { ops: [mkRule('冷氣濾網每月清洗一次，可維持出風順暢', '某家電行之建議', ['N1']), mkRule('冷氣室外機周圍勿堆放雜物', '某家電行之建議', ['N1'])], skipped: [{ note: 'N2', reason: '無可用知識' }] },
    d05: { ops: [mkDis('設置公車專用道是否可縮短尖峰時段之行駛時間？', '設置專用道後尖峰時段之行駛時間縮短', '設置專用道後行駛時間並未縮短，反因專用道遭違規占用而延誤')], skipped: [] },
    d06: { ops: [{ op: 'confirm', id: 'C1', sources: ['N1'] }, mkTmp('幼犬基礎疫苗之施打間隔由三週改為四週', '今年起', ['N2'])], skipped: [] },
    d07: { ops: [mkRule('煮白米飯時米與水之體積比約為 1 比 1.2，浸泡 30 分鐘後再煮口感較佳', '某烹飪教室之說明', ['N1'])], skipped: [{ note: 'N2', reason: '品質不足' }] },
    d08: { ops: [mkPri('登山時衣物宜以多層穿搭為原則，隨體溫與氣溫增減', ['N1', 'N2'])], skipped: [] },
    d09: { ops: [mkDis('導覽時間以多長為宜？', '導覽以 60 分鐘為宜，參觀者較能全程專注', '導覽宜縮短至 30 分鐘，超過 30 分鐘參觀者明顯疲倦')], skipped: [] },
    d10: { ops: [{ op: 'confirm', id: 'C1', sources: ['N1'] }, mkRule('寶特瓶之瓶蓋須另外投放', '另一社區回收站之規定', ['N1'])], skipped: [] },
    d11: { ops: [mkTmp('某游泳池平日開放時間延長至晚間 9 點', '本月起', ['N1'])], skipped: [{ note: 'N2', reason: '離題' }] },
    d12: { ops: [mkRule('每日固定練習 20 分鐘，比偶爾長時間練習更易進步', '某音樂教室之建議', ['N1']), mkRule('練習時記錄困難之小節，下次優先處理', '另一音樂教室之建議', ['N2'])], skipped: [] },
    dh1: { ops: [mkRule('洗手須先濕手、搓出泡沫、搓洗約 20 秒後沖淨', '某幼兒園之教導', ['N1'])], skipped: [{ note: 'N2', reason: '無可用知識' }] },
    dh2: { ops: [mkDis('平交道加裝柵欄是否減少闖越事件？', '加裝柵欄後闖越事件減少', '加裝柵欄後闖越事件並未減少')], skipped: [] },
    dh3: { ops: [{ op: 'confirm', id: 'C1', sources: ['N1'] }], skipped: [] },
    dh4: { ops: [mkPri('選擇營地以遠離河谷與孤立之大樹為原則', ['N1', 'N2']), mkPit('雷雨時在孤立大樹下避雨，易遭雷擊', '雷雨時', ['N1'])], skipped: [] },
    r01: { edits: [{ ref: 'a1_1', fields: { text: '社區圖書館週末開放後，週末借閱量約占全週兩成' } }] },
    r02: { removes: [{ ref: 'a1_2', issue: 0, reason: '重複' }] },
    r03: { edits: [{ ref: 'a1_2', fields: { text: '盆栽澆水後宜放在通風處，待表土稍乾' } }] },
    r04: { edits: [{ ref: 'a1_1', fields: { text: '冷氣出風不順暢時，應先檢查濾網是否阻塞並清洗乾淨，再檢查室外機周圍是否堆放雜物而妨礙散熱，接著確認排水管是否暢通無阻，仍未改善時才請專人到府檢修' } }] },
    r05: { removes: [{ ref: 'a2_1', issue: 0, reason: '重複' }] },
    r06: { removes: [{ ref: 'a2_1', issue: 0, reason: '離題' }] },
    r07: { removes: [{ ref: 'a2_1', issue: 0, reason: '捏造' }] },
    r08: { edits: [{ ref: 'a1_2', fields: { text: '下坡時使用登山杖可減輕膝蓋負擔' } }] },
    r09: { edits: [{ ref: 'a1_1', fields: { text: '每個展品之解說控制在兩分鐘內，參觀者較能專注', conditions: ['某博物館導覽員之說明'] } }] },
    r10: { edits: [{ ref: 'a1_1', fields: { text: '幼犬每日分次餵食，較一次餵食不易腹瀉' } }] },
    r11: { edits: [{ ref: 'a1_2', fields: { text: '紙類須壓平並捆紮後投入回收' } }] },
    r12: { edits: [{ ref: 'a1_2', fields: { text: '小提琴弦每半年更換一次，使用頻繁者更換較勤' } }], removes: [{ ref: 'a2_1', issue: 1, reason: '離題' }] },
    rh1: { edits: [{ ref: 'a1_2', fields: { text: '池水濁度偏高時須暫停開放並換水' } }] },
    rh2: { removes: [{ ref: 'a2_2', issue: 0, reason: '重複' }] },
    rh3: { edits: [{ ref: 'a1_1', fields: { text: '平交道柵欄放下時不得闖越' } }] },
    rh4: { removes: [{ ref: 'a2_1', issue: 0, reason: '捏造' }] },
    s01: { ops: [{ op: 'merge', into: 'C1', from: ['C2'], reason: '兩條同義' }] },
    s02: { ops: [{ op: 'merge', into: 'C1', from: ['C2'], reason: '兩條同義' }, { op: 'merge', into: 'C3', from: ['C4'], reason: '兩條同義' }] },
    s03: { ops: [mg('C1', ['C2'], '兩條同指春季修剪促進新芽')] },
    s04: { ops: [mg('C1', ['C2'], '兩條同指濾網每月清洗'), mg('P1', ['P2'], '兩個參數同名同值')] },
    s05: { ops: [mg('C1', ['C2'], '兩條同指看板顯示到站時間'), mg('Q1', ['Q2'], '兩個問題同問老舊站牌更新時間')] },
    s06: { ops: [mg('C1', ['C2'], '兩條同指新月夜可見較多暗星')] },
    s07: { ops: [mg('C1', ['C2', 'C3'], '三條同指煎魚前拭乾魚身較不易黏鍋')] },
    s08: { ops: [mg('C3', ['C4'], '兩條同指入山前須登記')] },
    s09: { ops: [mg('C1', ['C2'], '兩條同指真人導覽互動性佳')] },
    s10: { ops: [mg('C1', ['C2'], '兩條同指幼犬分次餵食較不易腹瀉'), mg('P1', ['P2'], '兩個參數同名同值')] },
    s11: { ops: [mg('C1', ['C2'], '兩條同指寶特瓶須倒空後投入'), mg('Q1', ['Q2'], '兩個問題同問瓶身標籤')] },
    s12: { ops: [mg('C1', ['C2'], '兩條同指每日分段練習較易進步')] },
    sh1: { ops: [mg('C1', ['C2'], '兩條同指戶外活動前補充水分')] },
    sh2: { ops: [mg('C1', ['C2'], '兩條同指濁度偏高時暫停開放'), mg('P1', ['P2'], '兩個參數同名同值')] },
    sh3: { ops: [mg('C1', ['C2'], '兩條同指須由收件人簽收')] },
    sh4: { ops: [mg('C1', ['C2', 'C3'], '三條同指候車須站在黃線後方'), mg('Q1', ['Q2'], '兩個問題同問黃線後方之距離')] },
    e01: { ops: [{ op: 'essence', text: '社區圖書館週末開放可增加使用，但延長開放須配合人力，否則閉館後之整理時間不足', claims: ['C1', 'C2'], reason: '綜合兩條' }] },
    e02: { ops: [{ op: 'essence', text: '兩館之週末借閱皆多於平日，延長開放須配合人力，否則整理時間不足', claims: ['C1', 'C2', 'C3'], reason: '綜合三條' }] },
    e03: ess('觀葉植物之照料重在節制：每月施肥一次且肥料須稀釋、施肥後 2 小時內避免陽光直射；澆水待土表乾燥再進行，並避開夏季午後', ['C1', 'C2', 'C3', 'C4']),
    e04: ess('冷氣設定溫度有省電與舒適兩種取捨：設定 26 度較省電、設定 24 度較舒適，尚無定論；另須每月清洗濾網以維持出風順暢', ['C1', 'C2', 'C3']),
    e05: ess('公車服務之改善靠資訊、設施與路權：電子看板顯示到站時間、座椅與遮雨棚使候車較舒適、專用道縮短尖峰行駛時間；然老舊站牌尚待更新、夜間班距偏長，專用道遭違規占用時成效縮小', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']),
    e06: ess('觀星宜選新月夜、遠離路燈與車道之光害處，可見較多暗星', ['C1', 'C2'], '所引之 C3 已撤回，依存活之主張重寫'),
    e07: ess('煮白米飯重在水量、浸泡與悶蒸：米水比約 1 比 1.2、浸泡 30 分鐘、煮好後悶 10 分鐘再翻鬆；洗米宜輕搓，避免用力搓洗與保溫過久', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']),
    e08: ess('登山杖有減輕膝蓋負擔與使腿部肌力退化兩面之主張，尚無定論，宜視使用情境取捨；登山鞋則須合腳且鞋底紋路完整', ['C1', 'C2', 'C3']),
    e09: ess('導覽以 60 分鐘為宜，參觀者較能全程專注；團體過大時後排聽不清楚', ['C1', 'C2'], '舊本質所引之 C3 已撤回，依存活之主張重寫'),
    e10: ess('幼犬照護重在腸胃與水分：分次餵食、換糧時逐步混合新舊飼料，並隨時有乾淨飲水可用', ['C1', 'C2', 'C3']),
    e11: ess('社區回收重在投放前之整理：寶特瓶倒空壓扁、瓶蓋另放，紙類壓平捆紮且潮濕沾油者不收，廚餘瀝乾後投入專用桶，專用桶每週收集兩次', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']),
    e12: ess('樂器練習重在規律與音準：每日固定練習 20 分鐘並記錄困難小節，練習前以調音器確認音準，弦線更換後須重新調音', ['C1', 'C2', 'C3', 'C4']),
    eh1: ess('幼兒園之衛生與活動習慣：洗手須搓洗約 20 秒後沖淨，戶外活動前補充水分、活動後洗手再進教室', ['C1', 'C2', 'C3']),
    eh2: ess('游泳池濁度偏高時須暫停開放並換水，開放時段內須有救生員在場', ['C1', 'C2'], '舊本質含已撤回之說法，依存活之主張重寫'),
    eh3: ess('掛號郵件可否由同住成員代收，兩郵局說法相反，尚無定論；無人簽收時投遞員留下通知單，郵件改存郵局', ['C1', 'C2', 'C3']),
    eh4: ess('鐵道出行之安全與班次：候車須站在黃線後方且列車進站時勿靠近月台邊緣，平交道柵欄放下時不得闖越並須先確認前方空間；班次尖峰每 5 分鐘、離峰每 15 分鐘一班', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']),
}

/** 工作流類各角色之謂詞(依角色定義之謂詞序;反例之類別 cls 取其一) */
const WF_PREDS = {
    'wf-audit': ['flags', 'clean'],
    'wf-accept': ['drop', 'keep', 'irreversibleListed'],
    'wf-pending': ['drop', 'keep', 'withheld'],
    'wf-integrate': ['viaValid', 'keepsMajority', 'refsClosed', 'applies'],
    'wf-draft': ['cites', 'skips', 'covered', 'dispute', 'grounded', 'noRejected', 'kinds'],
    'wf-revise': ['fixed', 'untouched', 'notWorse', 'blockedNone'],
    'wf-consolidate': ['merges', 'noLoss', 'liveAtMost'],
    'wf-essence': ['essenceOk', 'withinLimit'],
}

/**
 * 不可由模型之回覆構成「不成立」之謂詞(不列反例;另有一案證其不可證偽):修訂之 notWorse——使檢定標準問題增加之補丁(改寫新增問題、新增操作未達標)
 *   皆被正式之補丁守門擋下而不採(類別為 blockedNone),故補丁後之問題數恆不高於補丁前
 *
 * @type {Object}
 */
const WF_NEG_UNFALSIFIABLE = { 'wf-revise': ['notWorse'] }

/** 反例回覆之一筆:(案 id, 應得之類別＝不成立之謂詞, 回覆, 註記〔只差一處者寫明〕, only〔true＝案之應然只留該謂詞判之,使排在前之謂詞不先擋〕) */
const neg = (id, cls, reply, note = '', only = false) => ({ id, cls, reply, note, only })

/**
 * 工作流類之反例回覆(模型可能犯之錯;非形狀錯誤):逐筆之類別＝該謂詞;與示範回覆只差一處者 note 以「只差一處」起首
 *
 * @type {Object}
 */
const WF_NEG = {
    'wf-audit': [
        neg('a01', 'flags', { issues: [{ ...WF_DEMO.a01.issues[0], severity: '中' }] }, '只差一處：植入缺陷之嚴重度由高改中'),
        neg('a01', 'flags', { issues: [{ ...WF_DEMO.a01.issues[0], type: '離題' }] }, '類型錯：捏造誤判為離題'),
        neg('a03', 'flags', { issues: [] }, '漏列：植入之離題未指出'),
        neg('a11', 'flags', { issues: [WF_DEMO.a11.issues[0], { ...WF_DEMO.a11.issues[1], type: '捏造' }] }, '離題之 a3_1 判成捏造'),
        neg('a04', 'clean', { issues: [aud('a1_1', '捏造', '誤指')] }, '乾淨之操作被列高嚴重度之捏造'),
        neg('a04', 'clean', { issues: [aud('a1_2', '重複', '誤指')] }, '乾淨之操作被列高嚴重度之重複'),
        neg('a09', 'clean', { issues: [...WF_DEMO.a09.issues, aud('a1_2', '離題', '誤指')] }, '只差一處：多列一條對乾淨操作之高嚴重度意見'),
        neg('ah3', 'clean', { issues: [...WF_DEMO.ah3.issues, aud('a1_1', '捏造', '誤指')] }, '植入已指出，但另對乾淨之 a1_1 列高嚴重度'),
        neg('a02', 'clean', { issues: [...WF_DEMO.a02.issues, { ref: 'a1_1', severity: '中', type: '重複', detail: '誤指', fix: '刪除' }] }, '植入已指出，但另對乾淨之 a1_1 標中嚴重度之重複（正式流程可據以移除，知識遺失）'),
    ],
    'wf-accept': [
        neg('c04', 'drop', { verdicts: [WF_DEMO.c04.verdicts[0], { i: 1, action: 'keep' }, WF_DEMO.c04.verdicts[2]] }, '只差一處：重複之 i=1 由剔除改保留'),
        neg('c01', 'drop', { verdicts: [{ i: 0, action: 'keep' }, { i: 2, action: 'keep' }] }, '該剔之 i=1 未列裁決（保留）'),
        neg('c05', 'drop', { verdicts: [{ i: 0, action: 'keep' }] }, '不當之合併被保留'),
        neg('c06', 'keep', { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '重複' }] }, '只差一處：非重複之 i=1 以重複剔除（合剔除閘而被剔）'),
        neg('c09', 'keep', { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '離題' }] }, '審計誤指離題，模型照剔（有高嚴重度意見故合閘）'),
        neg('c01', 'keep', { verdicts: [{ i: 0, action: 'drop', reason: '重複' }, WF_DEMO.c01.verdicts[1], WF_DEMO.c01.verdicts[2]] }, '剔除之外另把應留之 i=0 以重複剔除'),
        neg('c02', 'irreversibleListed', { verdicts: [{ i: 0, action: 'fix', fields: { bogus: 1 } }] }, '撤回以 fix 回覆而無可改之欄位（等同未列裁決）', true),
        neg('c05', 'irreversibleListed', { verdicts: [{ i: 0, action: 'drop', reason: '不當之合併' }] }, '剔除理由不在清單（裁決無效，合併未得有效裁決）', true),
        neg('c03', 'irreversibleListed', { verdicts: [WF_DEMO.c03.verdicts[0]] }, '只差一處：漏列取代（i=1）之裁決', true),
    ],
    'wf-pending': [
        neg('p01', 'drop', { verdicts: [{ i: 0, action: 'keep' }] }, '該剔之 i=1 未列裁決（不可逆而留待審，非剔除）'),
        neg('p03', 'drop', { verdicts: [WF_DEMO.p03.verdicts[0], { i: 1, action: 'keep' }] }, '只差一處：數字未紮根之 i=1 由剔除改保留（過不了定稿篩選）'),
        neg('p06', 'drop', { verdicts: [{ i: 0, action: 'keep' }, { i: 1, action: 'keep' }] }, '單一文件之 principle 被保留（過不了跨篇之定稿篩選）'),
        neg('p04', 'drop', { verdicts: [{ i: 0, action: 'keep' }] }, '不當之合併被保留'),
        neg('p01', 'keep', { verdicts: [{ i: 0, action: 'drop', reason: '重複' }, WF_DEMO.p01.verdicts[1]] }, '該留之重複撤回被剔除'),
        neg('p05', 'keep', { verdicts: [{ i: 0, action: 'drop', reason: '性質標錯' }] }, '同義之合併被剔除'),
        neg('p09', 'keep', { verdicts: [{ i: 0, action: 'drop', reason: '離題' }, WF_DEMO.p09.verdicts[1]] }, '只差一處：該留之待解問題 i=0 由保留改剔除'),
        neg('ph3', 'keep', { verdicts: [WF_DEMO.ph3.verdicts[0], { i: 1, action: 'drop', reason: '重複' }] }, '該留之 i=1 被剔除'),
        neg('p02', 'withheld', { verdicts: [{ i: 0, action: 'keep' }] }, '只差一處：p02 之應然回覆加列 { i:0, action:keep }（列了裁決即定案，不再留待審）'),
        neg('p07', 'withheld', { verdicts: [{ i: 0, action: 'keep' }] }, '尚待決議之取代被保留'),
        neg('p08', 'withheld', { verdicts: [{ i: 0, action: 'drop', reason: '對立成立' }] }, '尚待核對之拆解被剔除'),
        neg('p11', 'withheld', { verdicts: [{ i: 0, action: 'keep' }, WF_DEMO.p11.verdicts[0]] }, '尚待核對之拆解被保留'),
    ],
    'wf-integrate': [
        neg('g03', 'viaValid', { ops: [{ ...WF_DEMO.g03.ops[0], via: ['a9_9'] }, ...WF_DEMO.g03.ops.slice(1)], skipped: [] }, '只差一處：第一條之 via 改為不存在之 id'),
        neg('g05', 'viaValid', { ops: [{ ...WF_DEMO.g05.ops[0], text: '夜間班次之時刻表應全面重排' }, ...WF_DEMO.g05.ops.slice(1)], skipped: [] }, '文字改成候選沒有之內容（保有所指候選原文過半不成立）'),
        neg('g12', 'viaValid', { ops: [{ op: 'question_add', text: '練習前先以調音器確認音準之方法為何？', sources: ['N1'], via: ['a1_1'] }, WF_DEMO.g12.ops[1]], skipped: [] }, '操作種類與所指候選不同（add 改為 question_add）'),
        neg('g08', 'viaValid', { ops: [{ ...WF_DEMO.g08.ops[0], id: 'C2' }, WF_DEMO.g08.ops[1]], skipped: [] }, '改變確認之目標（C1 → C2）'),
        neg('g03', 'keepsMajority', { ops: WF_DEMO.g03.ops.slice(0, 2), skipped: [] }, '漏收兩票之第三條（換盆後之照顧）'),
        neg('g10', 'keepsMajority', { ops: WF_DEMO.g10.ops.slice(0, 1), skipped: [] }, '漏收兩票之陷阱'),
        neg('gh3', 'keepsMajority', { ops: WF_DEMO.gh3.ops.slice(0, 1), skipped: [] }, '漏收兩票之第二條'),
        neg('g08', 'keepsMajority', { ops: WF_DEMO.g08.ops.slice(1), skipped: [] }, '漏收兩票之確認 C1'),
        neg('g04', 'refsClosed', { ops: WF_DEMO.g04.ops.slice(1), skipped: [] }, '只差一處：收了依 @a1_f 之參數而漏收其所依之主張'),
        neg('g09', 'refsClosed', { ops: WF_DEMO.g09.ops.slice(2), skipped: [] }, '收了爭議而漏收其兩方所引之兩條主張'),
        neg('g06', 'refsClosed', { ops: [WF_DEMO.g06.ops[1], WF_DEMO.g06.ops[2]], skipped: [] }, '待解問題引用〔@a1_m〕而漏收其所引之主張'),
        neg('gh2', 'refsClosed', { ops: WF_DEMO.gh2.ops.slice(1), skipped: [] }, '待解問題引用〔@a1_p〕而漏收其所引之陷阱'),
        neg('g07', 'applies', { ops: [WF_DEMO.g07.ops[0], pick('g07', 1, 2, ['a1_2', 'a2_2'])], skipped: [] }, '收入目標不存在之確認 C9（試套即被拒收）'),
        neg('gh4', 'applies', { ops: [...WF_DEMO.gh4.ops, pick('gh4', 1, 2, ['a1_2', 'a2_2'])], skipped: [] }, '只差一處：多收一條種類不在清單之操作'),
        neg('g03', 'applies', { ops: [{ ...WF_DEMO.g03.ops[0], kind: 'law' }, ...WF_DEMO.g03.ops.slice(1)], skipped: [] }, '第一條之種類改為清單外之 law'),
    ],
    'wf-draft': [
        neg('d01', 'cites', { ops: [], skipped: [{ note: 'N1', reason: '離題' }, { note: 'N2', reason: '離題' }] }, '全部略過（應引為出處之 n1 被略過）'),
        neg('d03', 'cites', { ops: [], skipped: [{ note: 'N1', reason: '品質不足' }] }, '唯一之筆記被略過'),
        neg('d06', 'cites', { ops: [WF_DEMO.d06.ops[1]], skipped: [] }, '只差一處：漏掉確認既有主張之 confirm（n1 未被引為出處）'),
        neg('d01', 'skips', { ops: WF_DEMO.d01.ops, skipped: [{ note: 'N2', reason: '不想寫' }] }, '略過理由不在清單'),
        neg('d04', 'skips', { ops: WF_DEMO.d04.ops, skipped: [] }, '招生公告類之 n2 既未引用亦未略過'),
        neg('d07', 'skips', { ops: [...WF_DEMO.d07.ops, mkRule('加一點神奇配方煮飯會特別好吃', '網路傳言', ['N2'])], skipped: [] }, '品質不足之 n2 被引為出處而非略過'),
        neg('d01', 'covered', { ops: [mkRule('社區圖書館週末開放後，週末借閱量約占全週兩成', '某社區圖書館之統計', ['N1'])], skipped: [] }, '漏交代 n2（既未引用亦未略過）', true),
        neg('d11', 'covered', { ops: WF_DEMO.d11.ops, skipped: [] }, '漏交代 n2', true),
        neg('d12', 'covered', { ops: [WF_DEMO.d12.ops[0]], skipped: [] }, '漏交代 n2', true),
        neg('d05', 'dispute', { ops: [mkRule('設置公車專用道後，尖峰時段公車之行駛時間縮短', '某市之調查', ['N1']), mkRule('設置公車專用道後，行駛時間並未縮短', '另一城市之調查', ['N2'])], skipped: [] }, '兩篇結論相反而各寫成一條規則、未立爭議'),
        neg('dh2', 'dispute', { ops: [mkRule('平交道加裝柵欄後，闖越事件減少', '某鐵道單位之主張', ['N1']), mkRule('平交道加裝柵欄後，闖越事件並未減少', '另一單位之報告', ['N2'])], skipped: [] }, '兩篇結論相反而未立爭議'),
        neg('d12', 'dispute', { ops: [...WF_DEMO.d12.ops, mkDis('練習方式何者為宜？', '每日固定練習 20 分鐘', '練習時記錄困難之小節')], skipped: [] }, '兩篇並不相反，卻立為爭議'),
        neg('d08', 'dispute', { ops: [mkDis('登山衣物是否宜多層穿搭？', '衣物以多層穿搭為原則', '多層穿搭便於調整保暖程度')], skipped: [] }, '兩篇結論一致，卻立為爭議'),
        neg('d07', 'grounded', { ops: [mkRule('煮白米飯時米與水之體積比約為 1 比 1.2，浸泡 45 分鐘後再煮口感較佳', '某烹飪教室之說明', ['N1'])], skipped: [{ note: 'N2', reason: '品質不足' }] }, '數字 45 分鐘不見於出處', true),
        neg('d03', 'grounded', { ops: [WF_DEMO.d03.ops[0], mkPit('施肥後 3 小時內陽光直射易使葉片灼傷', '施肥後 3 小時內', ['N1'])], skipped: [] }, '只差一處：陷阱中之 2 小時改為出處所無之 3 小時', true),
        neg('d09', 'grounded', { ops: [WF_DEMO.d09.ops[0], mkPit('導覽超過 45 分鐘，參觀者明顯疲倦', '導覽超過 45 分鐘', ['N2'])], skipped: [] }, '數字 45 分鐘不見於出處', true),
        neg('d01', 'noRejected', { ops: [{ ...WF_DEMO.d01.ops[0], kind: 'law' }], skipped: [{ note: 'N2', reason: '離題' }] }, '主張種類為清單外之 law（試套被拒收）', true),
        neg('d12', 'noRejected', { ops: [...WF_DEMO.d12.ops, { op: 'confirm', id: 'C9', sources: ['N1'] }], skipped: [] }, '確認不存在之 C9（試套被拒收）', true),
        neg('d03', 'kinds', { ops: [WF_DEMO.d03.ops[0]], skipped: [] }, '只差一處：漏寫陷阱（只有 rule）'),
        neg('dh4', 'kinds', { ops: [mkRule('選擇營地以遠離河谷與孤立之大樹為原則', '某露營協會之主張', ['N1', 'N2']), WF_DEMO.dh4.ops[1]], skipped: [] }, '應寫 principle 而寫成 rule'),
        neg('d11', 'kinds', { ops: [mkRule('某游泳池平日開放時間延長至晚間 9 點', '本月起', ['N1'])], skipped: [{ note: 'N2', reason: '離題' }] }, '有時點之規定寫成 rule 而非 temporal'),
    ],
    'wf-revise': [
        neg('r03', 'fixed', { edits: [] }, '未改：帶程式意見之 a1_2 未被改正'),
        neg('r05', 'fixed', { edits: [] }, '未移除重複之 a2_1'),
        neg('r08', 'fixed', { removes: [{ ref: 'a1_2', issue: 0, reason: '捏造' }] }, '中嚴重度之陷阱：以捏造移除（不合補丁守門，a1_2 未被改正）'),
        neg('r09', 'fixed', { edits: [{ ref: 'a1_1', fields: { text: '展品解說越短越好' } }] }, '改寫未保有原文過半（被補丁守門擋下，a1_1 未被改正）'),
        neg('r03', 'untouched', { edits: [WF_DEMO.r03.edits[0], { ref: 'a1_1', fields: { text: '每次澆水量以盆底流出少量水為度，且須分次澆入' } }] }, '只差一處：多改寫了無意見之 a1_1'),
        neg('r06', 'untouched', { removes: WF_DEMO.r06.removes, edits: [{ ref: 'a1_2', fields: { text: '觀星時攜帶紅光手電筒，可保持暗適應之狀態' } }] }, '另改寫了無意見之 a1_2'),
        neg('rh2', 'untouched', { removes: [WF_DEMO.rh2.removes[0], { ref: 'a1_2', reason: '重複' }] }, '把應保留之 a1_2 也以重複移除'),
        neg('r01', 'blockedNone', { edits: WF_DEMO.r01.edits, removes: [{ ref: 'a1_2', reason: '離題' }] }, '只差一處：另移除無意見之 a1_2（不合補丁守門）'),
        neg('r07', 'blockedNone', { removes: [WF_DEMO.r07.removes[0], { ref: 'a1_1', reason: '離題' }] }, '另移除無意見之 a1_1（不合補丁守門）'),
        neg('rh1', 'blockedNone', { edits: WF_DEMO.rh1.edits, adds: [{ op: 'add', kind: 'rule', text: '游泳池換水後須重新檢測水質', conditions: ['某游泳池之作法'], critique: '出處未載', pros: ['出處未載'], cons: ['出處未載'], sources: ['N1'] }] }, '新增未對應任何意見（補丁守門擋下）'),
        neg('r04', 'blockedNone', { edits: [WF_DEMO.r04.edits[0], { ref: 'a1_2', fields: { text: '完全不同之另一句話' } }] }, '另一處改寫未保有原文過半（被補丁守門擋下）'),
    ],
    'wf-consolidate': [
        neg('s03', 'merges', { ops: [] }, '未合併'),
        neg('s06', 'noLoss', { ops: [mg('C1', ['C2'], '兩條同義'), mg('C3', ['C4'], '同談半月夜之地面方位')] }, '多併：爭議 D1 兩方所引之 C3／C4 併為一條 → 套用拒收（同一爭議之不同方不得指向同一主張）'),
        neg('s07', 'merges', { ops: [mg('C1', ['C2'], '兩條同義')] }, '只差一處：三條同義只併了兩條（漏併 C3）'),
        neg('s04', 'merges', { ops: [WF_DEMO.s04.ops[0]] }, '只併主張，漏併同名同值之參數 P1／P2'),
        neg('s05', 'merges', { ops: [WF_DEMO.s05.ops[1]] }, '只併待解問題，漏併同義之主張 C1／C2'),
        neg('s01', 'noLoss', { ops: [...WF_DEMO.s01.ops, mg('C1', ['C9'], '同主題')] }, '併入不存在之條目 C9（套用被拒收）'),
        neg('s09', 'noLoss', { ops: [...WF_DEMO.s09.ops, { op: 'dispute_dissolve', id: 'D1', reason: '兩方談不同面向，並不對立' }] }, '只差一處：多出一個未給種類與標注之爭議拆解（套用被拒收）'),
        neg('s10', 'noLoss', { ops: [...WF_DEMO.s10.ops, mg('P1', ['C3'], '誤把主張併入參數')] }, '跨種類合併：把主張併入參數（套用被拒收）'),
        neg('s12', 'noLoss', { ops: [...WF_DEMO.s12.ops, mg('C1', ['C1'], '自身合併')] }, 'from 含 into 自身（套用被拒收）'),
        neg('s08', 'liveAtMost', { ops: [...WF_DEMO.s08.ops, { op: 'dispute_dissolve', id: 'D1', reason: '兩方談不同季節，並不對立', kinds: ['temporal', 'temporal'], annotations: [{ critique: '僅單一山屋之公告', period: '夏季' }, { critique: '僅單一山屋之公告', period: '冬季' }] }] }, '合併之外又合規地拆解非對立爭議，新增兩條有效主張而逾上限'),
        neg('s02', 'liveAtMost', { ops: [] }, '未整併，有效主張仍逾上限', true),
        neg('s07', 'liveAtMost', { ops: [mg('C1', ['C2'], '兩條同義')] }, '三條同義只併了兩條，有效主張仍逾上限', true),
    ],
    'wf-essence': [
        neg('e01', 'essenceOk', { ops: [] }, '無 essence 操作（核心仍無本質）'),
        neg('e03', 'essenceOk', ess(WF_DEMO.e03.ops[0].text.replace('2 小時', '5 小時'), ['C1', 'C2', 'C3', 'C4']), '只差一處：本質中之 2 小時改為所引主張出處所無之 5 小時（ES16）'),
        neg('e05', 'essenceOk', ess(WF_DEMO.e05.ops[0].text, ['C1', 'C2', 'C3', 'C4', 'C5', 'C9']), '所引之 C9 不存在（essence 未落地，核心仍無本質）'),
        neg('e06', 'essenceOk', { ops: [] }, '本質待重寫而未重寫（ES6 仍不合格）'),
        neg('e07', 'essenceOk', ess(WF_DEMO.e07.ops[0].text.replace('30 分鐘', '50 分鐘'), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']), '數字 50 分鐘不見於所引主張之出處（ES16）'),
        neg('e02', 'withinLimit', ess(`${'社區圖書館週末開放可增加使用，'.repeat(40)}但須配合人力。`, ['C1', 'C2', 'C3']), '本質逾長度硬上限（交程式截至句界後可合格，但模型輸出本身已逾限）'),
        neg('e10', 'withinLimit', ess(`${'幼犬照護重在腸胃與水分，須分次餵食、逐步換糧並隨時有乾淨飲水可用，'.repeat(8)}以上為要點。`, ['C1', 'C2', 'C3']), '本質逾長度硬上限'),
        neg('e11', 'withinLimit', ess(`${'社區回收重在投放前之整理，寶特瓶須倒空壓扁，紙類須壓平捆紮，廚餘須瀝乾後投入專用桶。'.repeat(6)}`, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']), '六條主張逐條照抄而逾長度硬上限（長度壓力）'),
        neg('eh2', 'withinLimit', ess(`${'游泳池濁度偏高時須暫停開放並換水，開放時段內須有救生員在場，'.repeat(8)}以上為要點。`, ['C1', 'C2'], '重寫本質'), '待重寫之本質逾長度硬上限（只判長度）', true),
    ],
}

/**
 * 出處標號(依 esPageOf 之 idOf 反查)
 *
 * @param {Object} page 輸入 esPageOf 之產物
 * @param {String} id 輸入出處 id
 * @returns {String} 回傳標號
 */
const labelOf = (page, id) => [...page.idOf].find(([, x]) => x === id)[0]

/** 各角色之示範回覆:(該頁之案) => 回覆(JSON) */
const ORACLE = {
    'support-check': (cases) => {
        const page = esPageOf('ES9', cases, { domain: D })
        return { checks: cases.map((c, j) => {
            const index = page.indices[j]
            if (c.expect.verdict !== 'supported') return { index, verdict: c.expect.verdict, reason: WHY }
            return { index, verdict: 'supported', by: c.expect.by ? c.expect.by.map((id) => labelOf(page, id)) : [...page.labelsOf.get(index)], reason: WHY }
        }) }
    },
    'support-revise': (cases) => ({ fixes: cases.map((c, j) => (c.expect.drop ? { index: j + 1, drop: true } : { index: j + 1, ...REVISE_FIX[c.id] })) }),
    'orphan-check': (cases) => {
        const c = cases[0]
        const page = esPageOf('ES8', cases, { domain: D })
        return { checks: [c.expect.verdict === 'supported' ? { index: 1, verdict: 'supported', by: c.expect.by.map((id) => labelOf(page, id)), reason: WHY } : { index: 1, verdict: c.expect.verdict, reason: WHY }] }
    },
    'dispute-check': (cases) => ({ checks: cases.map((c, j) => (c.expect.verdict === 'opposed' ? { index: j + 1, verdict: 'opposed', reason: WHY } : { index: j + 1, verdict: c.expect.verdict, reason: WHY, ...dissolveFieldsOf(c.input.sides) })) }),
    'synonym-check': (cases) => ({ checks: cases.map((c, j) => ({ index: j + 1, verdict: c.expect.verdict, reason: WHY })) }),
    'synonym-propose': (cases) => ({ pairs: cases[0].expect.must.map(([a, b]) => ({ a, b, reason: '同一概念之不同寫法' })) }),
    ...Object.fromEntries(WF_IDS.map((id) => [id, (cases) => WF_DEMO[cases[0].id]])),
}

/**
 * 替身調度層(工作流入口):以各角色之規劃認出提示詞屬哪一頁,依 reply[角色](同頁之案, 首案之前之案數, 模型)或示範回覆作答;回覆以
 *   正式之 parse 解析、以 check 驗(同 w-dispatch-ai 之 callAi:check 嚴格 true 才過);fail[模型] 給了即以之失敗(events 經 onEvent 送出)。
 *   記錄每次呼叫(含逐次選項);驗證失敗之嘗試帶回覆原文(stdout;不合格原因由角色依正式之 parse／check 重判)。
 *   【為何不用 extractKit 之 scriptAi】本替身依評分之規劃(planExtractBench 之頁)認頁、以回覆原文經正式之 parse 解析——評分執行器專屬之契約
 *   (被測物即評分);scriptAi 依提煉段之席位／角色回 JSON,不認頁、不經 parse,套不上
 *
 * @param {Object} [o={}] 輸入 { reply:{ 角色 id: 函數 }, raw:{ 角色 id: 函數(回原文字串) }, fail:{ 模型: { error, errorType, tried, events } }, plan:{ 角色 id: 規劃之設定 } }
 * @returns {Object} 回傳 { calls, seatSpec, recordCall, getWkf }
 */
function wkfStub(o = {}) {
    const byPrompt = new Map()
    for (const role of EXTRACT_BENCH_ROLES) {
        const plan = planExtractBench(role.id, o.plan?.[role.id] || {})
        const byId = new Map(plan.set.cases.map((c) => [c.id, c]))
        let base = 0
        for (const p of plan.pages) {
            byPrompt.set(p.prompt, { role: role.id, cases: p.ids.map((id) => byId.get(id)), base })
            base += p.ids.length
        }
    }
    const calls = []
    return {
        calls,
        seatSpec: (seat) => ({ use: seat.use, fallback: seat.fallback || [], timeoutMs: seat.timeoutMs || 1000, budgetMs: 1000 }),
        recordCall: () => {},
        getWkf: () => ({
            callAi: async (prompt, opt) => {
                const model = opt.spec.use
                const hit = byPrompt.get(String(prompt))
                calls.push({ model, role: hit?.role || '', ids: hit ? hit.cases.map((c) => c.id) : [], opt })
                const f = o.fail?.[model]
                if (f) {
                    for (const ev of f.events || []) opt.onEvent?.(ev)
                    return { ok: false, json: null, error: f.error, errorType: f.errorType, tried: f.tried || [] }
                }
                const text = hit && o.raw?.[hit.role] ? o.raw[hit.role](hit.cases, hit.base, model) : JSON.stringify(hit ? (o.reply?.[hit.role] || ORACLE[hit.role])(hit.cases, hit.base, model) : {})
                let j = null
                try {
                    j = opt.parse(text)
                }
                catch { /* 解析拋錯視同不合格 */ }
                if (j === null || opt.check(j) !== true) return { ok: false, json: null, error: 'validation failed', errorType: 'validation', tried: [{ providerId: model, outcome: 'skip-group', errorType: 'validation', durationMs: 1200, stdout: text }] }
                return { ok: true, json: j, providerId: model, ms: 5, tried: [{ providerId: model, outcome: 'ok', durationMs: 5 }] }
            },
        }),
    }
}

/**
 * 單頁之判定:以題組規劃後直接呼叫角色之 verdictOf
 *
 * @param {String} roleId 輸入角色 id
 * @param {Array} cases 輸入同頁之案(未驗之原樣)
 * @param {*} data 輸入回覆(解析後之 JSON)
 * @param {Object} [opt={}] 輸入規劃之設定(roleOpt 等)
 * @returns {Array} 回傳各案之 verdictOf 結果(依頁內序)
 */
function judgePage(roleId, cases, data, opt = {}) {
    const role = extractBenchRoleOf(roleId)
    const set = validateBenchCases(role, cases)
    const pages = role.paginate ? role.paginate(set.cases, { roleOpt: opt.roleOpt || {} }) : [set.cases]
    const page = pages[0]
    role.promptOf(page, D, { roleOpt: opt.roleOpt || {}, base: 0 })
    return page.map((c, k) => role.verdictOf(data, c, { index: k + 1, seq: k + 1, base: 0, domain: D, cases: page, roleOpt: {} }))
}

/**
 * 工作流類之單案判定(示範案改一處後之類別)
 *
 * @param {String} roleId 輸入角色 id
 * @param {Object} c 輸入案
 * @param {*} data 輸入回覆
 * @returns {Object} 回傳 verdictOf 之結果
 */
const wfJudge = (roleId, c, data) => judgePage(roleId, [c], data)[0]

/** 工作流類之示範案(依 id 取;深複本,供改一處) */
const wfCase = (roleId, id) => structuredClone(SET[roleId].cases.find((c) => c.id === id))

// ════════════════ 合成之材料(中立之示意;只用於驗檢核與判定之機制) ════════════════

/** ES9 形之案 */
const es9 = (id, over = {}) => ({ id, input: { kind: 'add', text: `斷言${id}`, sources: [{ id: `s-${id}`, title: `出處${id}`, text: `出處${id}之內容` }] }, expect: { verdict: 'supported' }, why: 'w', ...over })
/** ES8 形之案 */
const es8 = (id, over = {}) => ({ id, input: { claim: `主張${id}`, candidates: [{ id: 'c1', title: '甲', text: '甲之內容' }, { id: 'c2', title: '乙', text: '乙之內容' }] }, expect: { verdict: 'supported', by: ['c2'] }, why: 'w', ...over })
/** ES14 形之案(兩方各一出處) */
const es14 = (id, over = {}) => ({ id, input: { question: `問題${id}`, doubt: { reason: '非對立', note: '說明' }, sides: [{ position: `甲方${id}`, sources: [{ id: `a-${id}`, title: 'A', text: '甲方之內容' }] }, { position: `乙方${id}`, sources: [{ id: `b-${id}`, title: 'B', text: '乙方之內容' }] }] }, expect: { verdict: 'not-opposed' }, why: 'w', ...over })
/** ES11 形之案 */
const es11 = (id, over = {}) => ({ id, input: { a: { concept: `甲${id}`, essence: '甲之本質', claims: ['甲之主張'], notes: ['甲之出處'] }, b: { concept: `乙${id}`, essence: '乙之本質', claims: ['乙之主張'], notes: ['乙之出處'] } }, expect: { verdict: 'different' }, why: 'w', ...over })
/** 修訂形之案(新增主張;單一出處;覆核說明為結構化之票) */
const rev = (id, over = {}) => ({ id, input: { kind: 'add', text: '晨讀可提高閱讀能力', annotation: { kind: 'rule', critique: '僅單一學校', pros: ['出處未載'], cons: ['出處未載'] }, sources: [{ id: 's1', title: '晨讀', text: '某小學三年級實施每日 15 分鐘晨讀一學期，閱讀測驗分數提高。' }], votes: [{ verdict: 'overclaim', reason: '出處只涵蓋某小學三年級' }] }, expect: { fix: { conditionsAny: ['三年級'] } }, why: 'w', ...over })

// ════════════════ 專案執行器之組法之參考實作(與正式 run*Check 同一組法:項編號頁內重起、出處依首次出現序以 id 去重;測試不讀專案檔) ════════════════

/**
 * 參考實作:執行器以替身 AI 跑一遍所送出之提示詞(依頁)——ES9／ES8／ES14／ES11 之組法
 *
 * @param {String} std 輸入標準 id
 * @param {Array} cases 輸入題組之案
 * @param {Object} extractDomain 輸入提煉 domain
 * @returns {Array} 回傳提示詞陣列(依頁)
 */
function runnerPrompts(std, cases, extractDomain) {
    const PAGE = 10
    const out = []
    const dedupe = (srcs) => [...new Map(srcs.map((s) => [s.id, s])).values()]
    if (std === 'ES9') {
        for (let i = 0; i < cases.length; i += PAGE) {
            const page = cases.slice(i, i + PAGE).map((c, j) => ({ c, index: j + 1 }))
            const srcs = dedupe(page.flatMap(({ c }) => c.input.sources))
            const label = new Map(srcs.map((s, k) => [s.id, `S${k + 1}`]))
            out.push(extractDomain.buildSupportCheckPrompt({
                concept: '題組',
                sources: srcs.map((s) => ({ label: label.get(s.id), title: s.title, text: s.text })),
                items: page.map(({ c, index }) => ({ index, kind: c.input.kind, text: c.input.text, basis: c.input.basis || '', labels: c.input.sources.map((s) => label.get(s.id)) })),
            }))
        }
    }
    if (std === 'ES8') {
        for (const c of cases) out.push(extractDomain.buildOrphanCheckPrompt({ concept: '題組', sources: c.input.candidates.map((x, k) => ({ label: `S${k + 1}`, title: x.title, text: x.text })), items: [{ index: 1, text: c.input.claim, basis: c.input.basis || '' }] }))
    }
    if (std === 'ES14') {
        for (let i = 0; i < cases.length; i += PAGE) {
            const page = cases.slice(i, i + PAGE).map((c, j) => ({ c, index: j + 1 }))
            const srcs = dedupe(page.flatMap(({ c }) => c.input.sides.flatMap((sd) => sd.sources)))
            const label = new Map(srcs.map((s, k) => [s.id, `S${k + 1}`]))
            out.push(extractDomain.buildDisputeCheckPrompt({
                concept: '題組',
                sources: srcs.map((s) => ({ label: label.get(s.id), title: s.title, text: s.text })),
                items: page.map(({ c, index }) => ({ index, question: c.input.question, doubt: c.input.doubt, sides: c.input.sides.map((sd) => ({ position: sd.position, conditions: sd.conditions || [], basis: sd.basis || '', claims: sd.claims || [], labels: sd.sources.map((s) => label.get(s.id)), toClaim: sd.toClaim !== false })) })),
            }))
        }
    }
    if (std === 'ES11') {
        for (let i = 0; i < cases.length; i += PAGE) {
            const page = cases.slice(i, i + PAGE).map((c, j) => ({ c, index: j + 1 }))
            out.push(extractDomain.buildSynonymCheckPrompt(page.map(({ c, index }) => ({ index, a: c.input.a, b: c.input.b }))))
        }
    }
    return out
}

/**
 * 正式之判定小組之替身呼叫:記下各席之提示詞(依棒名),回空票(只截取提示詞)
 *
 * @returns {Object} 回傳 { prompts:Map(棒名 → 提示詞陣列), call }
 */
function panelCapture() {
    const prompts = new Map()
    return {
        prompts,
        call: async (stage, seat, prompt) => {
            prompts.set(stage, [...(prompts.get(stage) || []), prompt])
            return { ok: true, json: { checks: [] }, providerId: seat.use }
        },
    }
}

/** 判定小組兩席(區域名;與共用件 extractKit 之 3+3 席位 SEATS 不同義) */
const PANEL2 = { first: { use: 's1' }, second: { use: 's2' } }

describe('unit-extract-bench', function() {

    before(() => {
        TMP = tmpRoot('extract-bench')
    })

    after(() => {
        removeRoots([TMP])
    })

    // ══════════════════════════ ①題組 ══════════════════════════
    describe('① 題組', function() {

        it('十四角色之題組皆通過驗證:判定類各 12～16 案、保留題 3～4 案;工作流類各 16 案(12 一般＋4 保留,保留題涵蓋 ≥2 種謂詞組合,各謂詞皆有案列於應然);std／v 與角色相符;題組檔在 bench/cases/<角色 id>-generic.json(依 id 推得);每案有依據', () => {
            assert.deepEqual(EXTRACT_BENCH_ROLES.map((r) => r.id), ROLE_IDS)
            assert.deepEqual([...EXTRACT_BENCH_ROLE_IDS], ROLE_IDS, '角色 id 由角色定義導出')
            assert.deepEqual(EXTRACT_BENCH_ROLES.slice(0, 6).map((r) => [r.name, [...r.std], r.v]), [
                ['出處支持覆核(support-check)', ['ES9'], 2], ['出處修訂(support-revise)', ['ES9'], 2], ['失撐找支持(orphan-check)', ['ES8'], 2],
                ['爭議覆核(dispute-check)', ['ES14'], 1], ['同義覆核(synonym-check)', ['ES11'], 1], ['同義提議(synonym-propose)', ['ES11'], 1],
            ])
            assert.deepEqual(EXTRACT_BENCH_ROLES.slice(6).map((r) => [r.name, [...r.std], r.v]), [
                ['審計(wf-audit)', [], null], ['終審(wf-accept)', [], null], ['待審裁決(wf-pending)', [], null], ['整合(wf-integrate)', [], null],
                ['起草(wf-draft)〔結構合規〕', [], null], ['修訂(wf-revise)〔結構合規〕', [], null], ['整併(wf-consolidate)〔結構合規〕', [], null], ['本質(wf-essence)〔結構合規〕', [], null],
            ], '工作流類第二批之角色名標「結構合規」(評比表之角色欄)')
            assert.deepEqual([...WF_STRUCTURAL], ['wf-draft', 'wf-revise', 'wf-consolidate', 'wf-essence'])
            for (const role of EXTRACT_BENCH_ROLES) {
                const set = SET[role.id]
                const n = set.cases.length
                const h = set.cases.filter((c) => c.holdout).length
                if (JUDGE_IDS.includes(role.id)) {
                    assert.ok(n >= 12 && n <= 16, `${role.id} 案數 ${n}`)
                    assert.ok(h >= 3 && h <= 4, `${role.id} 保留題 ${h}`)
                }
                else {
                    assert.equal(n, 16, `${role.id} 案數 ${n}（12 一般＋4 保留）`)
                    assert.equal(h, 4, `${role.id} 保留題 ${h}`)
                    const combos = new Set(set.cases.filter((c) => c.holdout).map((c) => Object.keys(c.expect).sort().join('＋')))
                    assert.ok(combos.size >= 2, `${role.id} 之保留題涵蓋謂詞組合 ${combos.size} 種：${[...combos].join('｜')}`)
                    const used = new Set(set.cases.flatMap((c) => Object.keys(c.expect)))
                    for (const p of WF_PREDS[role.id]) assert.ok(used.has(p), `${role.id} 之謂詞 ${p} 無一案列於應然`)
                    assert.equal(new Set(set.cases.map((c) => c.id)).size, 16, `${role.id} 案 id 不重複`)
                }
                if (role.std.length) assert.ok(role.std.includes(set.std), `${role.id} 之 std ${set.std}`)
                if (role.v !== null) assert.equal(set.v, role.v, `${role.id} 之 v`)
                assert.equal(role.casesFile, EXTRACT_BENCH_CASES_FILES[role.id])
                assert.equal(path.relative(PKG, role.casesFile).replace(/\\/g, '/'), `src/bench/cases/${role.id}-generic.json`)
                assert.ok(set.cases.every((c) => typeof c.why === 'string' && c.why.length > 8), `${role.id} 每案有依據`)
                assert.ok(set.note.length > 100, `${role.id} 之 note 寫明應然之推得`)
            }
            for (const id of ROLE_IDS) assert.ok(planExtractBench(id).pages.length > 0, `${id} 可規劃`)
        })

        it('類別涵蓋:覆核三角色含各應然類別;修訂含 drop 與三種謂詞與兩種斷言種類;提議含無同義之名單;保留題各涵蓋 2 類以上(含修訂之 drop／fix、提議之有無應提)', () => {
            const kinds = (id, f = (c) => extractBenchRoleOf(id).expectOf(c)) => [...new Set(SET[id].cases.map(f))].sort()
            assert.deepEqual(kinds('support-check', (c) => c.expect.verdict), ['contradicted', 'insufficient', 'overclaim', 'supported'])
            const sc = SET['support-check'].cases
            assert.ok(sc.some((c) => c.expect.by) && sc.some((c) => (c.expect.by || []).length >= 2), '多出處之 by(單一與兩個)')
            assert.ok(sc.some((c) => c.input.basis && c.expect.verdict === 'supported') && sc.some((c) => c.input.basis && c.expect.verdict !== 'supported'), '推論類之受支持與未寫前提')
            assert.deepEqual([...new Set(sc.map((c) => c.input.kind))].sort(), [...SUPPORT_KINDS].sort(), '斷言之各種類(含存量之 claim)')
            assert.deepEqual(kinds('orphan-check'), ['none', 'supported'])
            assert.ok(SET['orphan-check'].cases.some((c) => c.input.basis && c.expect.verdict === 'supported') && SET['orphan-check'].cases.some((c) => c.input.basis && c.expect.verdict === 'none'), '失撐:推論類兩向')
            assert.deepEqual(kinds('dispute-check', (c) => c.expect.verdict), ['not-opposed', 'opposed', 'same-study'])
            assert.ok(SET['dispute-check'].cases.some((c) => c.input.sides.some((sd) => sd.toClaim === false)), '不另立主張之方')
            assert.ok(SET['dispute-check'].cases.some((c) => c.input.sides.some((sd) => sd.basis === '轉述')), '引述他人研究之一方')
            assert.deepEqual(kinds('synonym-check'), ['different', 'same', 'unsure'])
            const rv = SET['support-revise'].cases
            assert.ok(rv.some((c) => c.expect.drop) && rv.some((c) => c.expect.fix))
            for (const k of ['conditionsAny', 'periodAny', 'textMustNot']) assert.ok(rv.some((c) => c.expect.fix?.[k]), `修訂之謂詞 ${k}`)
            assert.deepEqual([...new Set(rv.map((c) => c.input.kind))].sort(), ['add', 'side'])
            assert.ok(rv.some((c) => c.input.annotation?.kind === 'pitfall'), '陷阱主張(改寫後條件仍須在——標注之納入閘)')
            const pp = SET['synonym-propose'].cases
            assert.ok(pp.some((c) => !c.expect.must.length) && pp.some((c) => c.expect.must.length >= 2), '無同義之名單與兩對同義')
            const holdKinds = {
                'support-check': (c) => extractBenchRoleOf('support-check').expectOf(c),
                'orphan-check': (c) => extractBenchRoleOf('orphan-check').expectOf(c),
                'dispute-check': (c) => extractBenchRoleOf('dispute-check').expectOf(c),
                'synonym-check': (c) => extractBenchRoleOf('synonym-check').expectOf(c),
                'support-revise': (c) => (c.expect.drop ? 'drop' : 'fix'),
                'synonym-propose': (c) => (c.expect.must.length ? 'must' : 'none'),
            }
            for (const [id, f] of Object.entries(holdKinds)) {
                const hk = new Set(SET[id].cases.filter((c) => c.holdout).map(f))
                assert.ok(hk.size >= 2, `${id} 之保留題涵蓋 ${hk.size} 類`)
            }
        })

        it('檢定標準逐案題組之形狀相容:ES9(v2)、ES8(v2)、ES14(v1)、ES11(v1)之同形案可直接驗過;標準或版本不符拒收;修訂與 ES9 同 std／v——格式之差由逐案檢核擋下', () => {
            assert.equal(validateBenchCases(supportCheckBenchRole, { std: 'ES9', v: 2, cases: [es9('e1', { expect: { verdict: 'supported', by: ['s-e1'] } })] }).cases.length, 1)
            assert.equal(validateBenchCases(orphanCheckBenchRole, { std: 'ES8', v: 2, cases: [es8('s1'), es8('s2', { expect: { verdict: 'none' } })] }).cases.length, 2)
            const claimSide = { position: '甲方', toClaim: false, claims: [{ id: 'C1', text: '甲之主張', conditions: ['某條件'] }], sources: [{ id: 't1', title: 'T', text: '甲方之內容' }] }
            assert.equal(validateBenchCases(disputeCheckBenchRole, { std: 'ES14', v: 1, cases: [es14('e1', { input: { ...es14('e1').input, sides: [claimSide, es14('e1').input.sides[1]] } })] }).cases.length, 1)
            assert.equal(validateBenchCases(synonymCheckBenchRole, { std: 'ES11', v: 1, cases: [es11('u1', { expect: { verdict: 'unsure' } })] }).cases.length, 1)
            assert.match(msgOf(() => validateBenchCases(supportCheckBenchRole, { std: 'ES9', v: 1, cases: [es9('e1')] })), /題組之 v「1」非本角色所讀之題組版本（2）/)
            assert.match(msgOf(() => validateBenchCases(orphanCheckBenchRole, { std: 'ES9', v: 2, cases: [es8('s1')] })), /題組之 std「ES9」非本角色之標準（ES8）/)
            assert.match(msgOf(() => validateBenchCases(supportReviseBenchRole, { std: 'ES9', v: 2, cases: [es9('e1')] })), /cases\[0\]\(e1\) input\.votes 須為非空之票陣列/, '出處支持覆核之題組交修訂:格式之差由逐案檢核擋下')
            assert.match(msgOf(() => validateBenchCases(supportReviseBenchRole, { std: 'ES9', v: 1, cases: [rev('r1')] })), /題組之 v「1」非本角色所讀之題組版本（2）/)
        })

        it('逐案檢核:各角色之缺欄、應然非法、打錯之謂詞名 → 任何呼叫之前拋錯並列出全部問題;斷言種類取正式之 SUPPORT_KINDS', () => {
            assert.equal(SUPPORT_KINDS, SUPPORT_KINDS_STD, 'domain 轉出 standards/supportCheck 之同一實體')
            const bad = (role, cases) => msgOf(() => validateBenchCases(role, cases)) || ''
            const s = bad(supportCheckBenchRole, [{ id: 'a', input: { kind: 'move', text: '', sources: [] }, expect: { verdict: 'maybe' }, why: 'w' }, es9('b', { expect: { verdict: 'overclaim', by: ['s-b'] } }), es9('c', { expect: { verdict: 'supported', by: ['x'] } })])
            for (const p of [/cases\[0\]\(a\) input\.text 須為非空字串/, /input\.sources 須至少一筆/, /input\.kind 須為 add／confirm／revise／merge／side／contest／claim/, /expect\.verdict 須為 supported／contradicted／insufficient／overclaim／unsure/, /cases\[1\]\(b\) expect\.by 只用於 supported/, /cases\[2\]\(c\) expect\.by 之「x」不在本案之出處/]) assert.match(s, p)
            const o = bad(orphanCheckBenchRole, [es8('a', { expect: { verdict: 'supported' } }), es8('b', { input: { claim: '', candidates: [{ id: 'c1', title: 'T', text: 'x' }, { id: 'c1', title: 'T', text: 'y' }] } })])
            for (const p of [/cases\[0\]\(a\) expect\.by 須給（supported 之支持候選筆記 id）/, /cases\[1\]\(b\) input\.claim 須為非空字串/, /input\.candidates 之 id 重複/]) assert.match(o, p)
            const d = bad(disputeCheckBenchRole, [
                es14('a', { input: { question: '', sides: [{ position: '甲', sources: [] }] }, expect: { verdict: 'x' } }),
                es14('b', { input: { question: 'q', sides: [{ position: '甲', toClaim: false, sources: [{ id: 'a', title: 'A', text: 't' }] }, { position: '乙', claims: [{ id: 'C1', text: '乙之主張' }], sources: [{ id: 'b', title: 'B', text: 't' }] }] } }),
            ])
            for (const p of [/cases\[0\]\(a\) input\.question 須為非空字串/, /input\.sides 須為至少兩方之陣列/, /expect\.verdict 須為 opposed／not-opposed／same-study／unsure/, /cases\[1\]\(b\) side 0 之 toClaim 為 false 而未引主張/, /side 1 引主張而 toClaim 非 false/]) assert.match(d, p)
            assert.match(bad(synonymCheckBenchRole, [es11('a', { input: { a: { concept: '' }, b: { concept: '乙', claims: 'x' } }, expect: { verdict: 'same?' } })]), /input\.a\.concept 須為非空字串.*input\.b\.claims 須為字串陣列.*expect\.verdict 須為 same／different／unsure/)
            const r = bad(supportReviseBenchRole, [
                rev('a', { input: { kind: 'revise', text: '', sources: [], votes: [] }, expect: { drop: true, fix: {} } }),
                rev('b', { input: { ...rev('b').input, kind: 'side', period: '2020 年', annotation: { kind: 'rule', critique: '' } }, expect: { fix: { periodAny: ['2020'], other: ['x'] } } }),
                rev('c', { input: { ...rev('c').input, annotation: null, votes: [{ verdict: 'overclaim', reason: '甲' }, { verdict: 'contradicted', reason: '乙' }] }, expect: { fix: {} } }),
                rev('e', { input: { ...rev('e').input, reasons: ['語氣超出證據：甲'], votes: [{ verdict: 'supported', reason: '' }] } }),
            ])
            for (const p of [/cases\[0\]\(a\) input\.kind 須為 add／side/, /input\.text 須為非空字串/, /input\.sources 須為非空陣列/, /input\.votes 須為非空之票陣列/, /expect 須恰為 \{ drop:true \} 或/,
                /cases\[1\]\(b\) input\.period 不用於爭議之一方/, /input\.annotation 不用於爭議之一方/, /expect\.fix 含不認得之鍵：other/, /expect\.fix\.periodAny 不用於爭議之一方/,
                /cases\[2\]\(c\) input\.annotation 須為 \{ kind\(主張種類\), critique/, /expect\.fix 須至少給一個謂詞/, /cases\[2\]\(c\) input\.votes 不可修訂（正式之修訂只收原因含 overclaim 且無 contradicted 者）/,
                /cases\[3\]\(e\) input\.reasons 不收/, /cases\[3\]\(e\) input\.votes\[0\]\.verdict 須為不受支持之裁決/]) assert.match(r, p)
            const pr = bad(synonymProposeBenchRole, [{ id: 'a', input: { names: ['甲', '甲'] }, expect: { must: [['甲', '丙']], mustNot: [['甲', '甲']] }, why: 'w' }, { id: 'b', input: { names: ['甲', '乙'] }, expect: { must: [['甲', '乙']], mustNot: [['乙', '甲']] }, why: 'w' }])
            for (const p of [/cases\[0\]\(a\) input\.names 有重複之概念名/, /expect\.must\[0\] 之「丙」不在名單/, /expect\.mustNot\[0\] 之兩名相同/, /cases\[1\]\(b\) input\.names 須依碼元序排列/, /cases\[1\]\(b\) 配對 乙 ⇄ 甲 同時列於 must 與 mustNot|配對 甲 ⇄ 乙 同時列於 must 與 mustNot/]) assert.match(pr, p)
            assert.match(bad(supportCheckBenchRole, [es9('a', { input: { ...es9('a').input, vocab: { bogus: 1 } } })]), /input\.vocab 不合：vocab 含不認得之鍵：bogus/)
        })

        it('題組層之出處一致性(esSuiteProblems;出處支持覆核、修訂、爭議覆核三角色共用一條):同一出處 id 之標題或內文不同即拋', () => {
            assert.equal(supportCheckBenchRole.suiteProblems, esSuiteProblems)
            assert.equal(supportReviseBenchRole.suiteProblems, esSuiteProblems)
            assert.equal(disputeCheckBenchRole.suiteProblems, esSuiteProblems)
            const share = (text) => ({ id: 'sx', title: '共用', text })
            assert.match(msgOf(() => validateBenchCases(supportCheckBenchRole, [es9('a', { input: { kind: 'add', text: '甲', sources: [share('甲')] } }), es9('b', { input: { kind: 'add', text: '乙', sources: [share('乙')] } })])), /出處 id「sx」於各案之標題或內文不同/)
            assert.match(msgOf(() => validateBenchCases(supportReviseBenchRole, [rev('a'), rev('b', { input: { ...rev('b').input, sources: [{ id: 's1', title: '晨讀', text: '另一份內文' }] } })])), /出處 id「s1」於各案之標題或內文不同/)
            const side = (text) => ({ position: '甲方', sources: [share(text)] })
            assert.match(msgOf(() => validateBenchCases(disputeCheckBenchRole, [es14('a', { input: { question: 'q', sides: [side('甲'), side('乙')] } })])), /出處 id「sx」於各案之標題或內文不同/, '同案兩方亦驗')
            assert.deepEqual(esSuiteProblems({ cases: [es9('a', { input: { kind: 'add', text: '甲', sources: [share('甲')] } }), es9('b', { input: { kind: 'add', text: '乙', sources: [share('甲')] } })] }), [])
        })

        it('工作流類之逐案檢核:材料、本批、狀態之描述(coreStateOf)、角色之欄;打錯之謂詞名、謂詞值之型別、所列之 _oid／i／id 須在案中 → 任何呼叫之前列出全部問題', () => {
            const bad = (role, cases) => msgOf(() => validateBenchCases(role, cases)) || ''
            const a = wfCase('wf-audit', 'a01')
            const m1 = bad(wfAuditBenchRole, [{ ...a, input: { ...a.input, sources: 'x', extra: 1 }, expect: { flag: { a1_2: '捏造' } } }])
            for (const p of [/input 含不認得之鍵：extra/, /input\.sources 須為陣列/, /expect 含不認得之鍵：flag/, /expect 須至少給一個謂詞/]) assert.match(m1, p)
            const m2 = bad(wfAuditBenchRole, [{ ...a, expect: { flags: { a9: '超限' }, clean: ['a1_2'] } }])
            for (const p of [/expect\.flags 之「a9」不在 input\.ops/, /expect\.flags\.a9 須為 捏造／離題／重複/]) assert.match(m2, p)
            const c = wfCase('wf-accept', 'c01')
            assert.match(bad(wfAcceptBenchRole, [{ ...c, expect: { drop: [1, 5], keep: [1] } }]), /expect\.drop 須為操作之 i 陣列（0～2）.*|i=1 同時列於/)
            const g = wfCase('wf-integrate', 'g01')
            assert.match(bad(wfIntegrateBenchRole, [{ ...g, input: { ...g.input, candidates: [g.input.candidates[0]] } }]), /input\.candidates 須為 2～3 份候選差量/)
            assert.match(bad(wfIntegrateBenchRole, [{ ...g, expect: { viaValid: false } }]), /expect\.viaValid 須為 true/)
            const d = wfCase('wf-draft', 'd01')
            const m3 = bad(wfDraftBenchRole, [{ ...d, input: { ...d.input, batch: ['n1', 'n9'] }, expect: { cites: ['n3'], kinds: ['law'] } }])
            for (const p of [/input\.batch 之「n9」不在 input\.sources/, /expect\.cites 之「n3」不在 input\.batch|input\.batch/, /expect\.kinds 之「law」不在主張種類|input\.batch/]) assert.match(m3, p)
            const s = wfCase('wf-consolidate', 's01')
            assert.match(bad(wfConsolidateBenchRole, [{ ...s, input: { ...s.input, cap: 5 } }]), /input\.state 之有效主張（3）須逾 input\.cap/)
            const e = wfCase('wf-essence', 'e01')
            assert.match(bad(wfEssenceBenchRole, [{ ...e, input: { ...e.input, state: { ...e.input.state, essence: { text: '已有本質', claims: ['C1'] } } } }]), /input\.state 須有本質之需求/)
            const p = wfCase('wf-pending', 'p01')
            assert.match(bad(wfPendingBenchRole, [{ ...p, input: { ...p.input, state: { ...p.input.state, pendingReview: [] } } }]), /input\.state 須含仍有效之待審/)
            assert.match(bad(wfReviseBenchRole, [{ ...wfCase('wf-revise', 'r01'), expect: { fixed: ['a1_1'], untouched: ['a1_1'] } }]), /「a1_1」同時列於 expect\.fixed 與 expect\.untouched/)
            const st = wfCase('wf-draft', 'd02')
            assert.match(bad(wfDraftBenchRole, [{ ...st, input: { ...st.input, sources: st.input.sources.slice(1) } }]), /input\.state 所引之出處「n0」不在 input\.sources/)
        })
    })

    // ══════════════════════════ ②頁組法與提示詞 ══════════════════════════
    describe('② 頁組法與提示詞(與檢定標準逐案執行器及正式 run*Check 之組法逐字同)', function() {

        it('esPagesOfCases 與執行器之組法逐字同(六條件):ES9 12 案 10／2、項編號頁內重起、出處依首次出現序以 id 去重;ES14 同;各欄預設、不另立主張之方;ES8 一案一頁;ES11 頁內重起', () => {
            const shared = { id: 'sx', title: '共用出處', text: '兩案共引之內容' }
            const c9 = Array.from({ length: 12 }, (_, i) => es9(`e${i + 1}`, i === 0 || i === 2 ? { input: { kind: 'side', text: `斷言 ${i + 1}`, basis: i === 2 ? '理論推導' : undefined, sources: [shared, { id: `own-${i}`, title: `出處 ${i}`, text: '內容' }] } } : {}))
            const c14 = Array.from({ length: 11 }, (_, i) => es14(`d${i + 1}`, i === 1 ? { input: { question: '問題', sides: [{ position: '甲方', conditions: ['某條件'], basis: '轉述', toClaim: false, claims: [{ id: 'C1', text: '甲之主張' }], sources: [shared] }, { position: '乙方', sources: [shared, { id: 'zz', title: 'Z', text: '乙' }] }] } } : {}))
            const c8 = [es8('s1'), es8('s2', { input: { claim: '主張', basis: '理論推導', candidates: [{ id: 'k9', title: '丙', text: '丙之內容' }] } })]
            const c11 = Array.from({ length: 12 }, (_, i) => es11(`y${i + 1}`))
            for (const [std, cases] of [['ES9', c9], ['ES14', c14], ['ES8', c8], ['ES11', c11]]) {
                const mine = esPagesOfCases(std, cases, { domain: D })
                assert.deepEqual(mine.map((p) => p.prompt), runnerPrompts(std, cases, D), std)
            }
            const p9 = esPagesOfCases('ES9', c9, { domain: D })
            assert.deepEqual(p9.map((p) => p.indices), [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2]], 'ES9 項編號頁內重起(同正式 runSupportCheck)')
            assert.equal((p9[0].prompt.match(/=== 出處 S\d+：共用出處 ===/g) || []).length, 1, 'ES9 出處以 id 去重(同正式之 uniq(notes))')
            assert.match(p9[0].prompt, /=== 出處 S1：共用出處 ===/, '標號依首次出現序')
            const p14 = esPagesOfCases('ES14', c14, { domain: D })
            assert.deepEqual(p14.map((p) => p.indices), [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1]], 'ES14 頁內重起')
            assert.equal((p14[0].prompt.match(/=== 出處 S\d+：共用出處 ===/g) || []).length, 1, 'ES14 出處以 id 去重')
            assert.match(p14[0].prompt, /拆解時不另立主張（kinds\[0\]、annotations\[0\] 填 null）/)
            assert.deepEqual(esPagesOfCases('ES8', c8, { domain: D }).map((p) => p.indices), [[1], [1]], 'ES8 一案一頁、項編號恆 1')
            assert.ok(p9.every((p) => p.prompt.includes('「題組」')), '概念名「題組」')
            assert.equal(esPagesOfCases('ES11', c11, { domain: D, pageSize: 5 }).length, 3, 'pageSize 可改')
            assert.equal(ES_CASE_PAGE_SIZE, SYNONYM_PAGE_SIZE, 'ES11 之頁量與正式同義專步同源')
            assert.match(msgOf(() => esPagesOfCases('ES7', c9, { domain: D })), /不認得之逐案題組標準：ES7/)
            assert.match(msgOf(() => esPageOf('ES9', c9.slice(0, 2), { domain: {} })), /ES9 之 domain 須具 buildSupportCheckPrompt/)
            assert.match(msgOf(() => esPageOf('ES8', c8, { domain: D })), /ES8 一案一頁/)
        })

        it('esPageOf 與正式之 run*Check 實際送出之提示詞逐字同(四標準各一;替身截取第一席之提示詞——判定小組之第一席依題組序、第二席打亂)', async () => {
            const shared = { id: 'sx', title: '共用出處', text: '兩案共引之內容' }
            const c9 = [es9('e1', { input: { kind: 'side', text: '斷言甲', basis: '理論推導', sources: [shared, { id: 'o1', title: '甲', text: '甲之內容' }] } }), es9('e2'), es9('e3', { input: { kind: 'revise', text: '斷言丙', sources: [{ id: 'o3', title: '丙', text: '丙之內容' }, shared] } })]
            const src9 = new Map(c9.flatMap((c) => c.input.sources.map((s) => [s.id, s])))
            const k9 = panelCapture()
            await runSupportCheck({ items: c9.map((c) => ({ key: c.id, kind: c.input.kind, text: c.input.text, basis: c.input.basis || '', notes: c.input.sources.map((s) => s.id) })), concept: '題組', contentOf: (n) => src9.get(n).text, titleOf: (n) => src9.get(n).title, buildPrompt: D.buildSupportCheckPrompt, call: k9.call, seats: PANEL2 })
            assert.equal(k9.prompts.get('check1')[0], esPageOf('ES9', c9, { domain: D }).prompt, 'ES9')
            const c8 = es8('o1', { input: { claim: '主張甲', basis: '理論推導', candidates: [{ id: 'k1', title: '甲', text: '甲之內容' }, { id: 'k2', title: '乙', text: '乙之內容' }] } })
            const src8 = new Map(c8.input.candidates.map((s) => [s.id, s]))
            const k8 = panelCapture()
            await runOrphanCheck({ items: [{ key: 'C1', text: c8.input.claim, basis: c8.input.basis }], notes: c8.input.candidates.map((s) => s.id), concept: '題組', contentOf: (n) => src8.get(n).text, titleOf: (n) => src8.get(n).title, buildPrompt: D.buildOrphanCheckPrompt, call: k8.call, seats: PANEL2 })
            assert.equal(k8.prompts.get('orphan1')[0], esPageOf('ES8', [c8], { domain: D }).prompt, 'ES8')
            const c14 = es14('d1', { input: { question: '問題甲', doubt: { reason: '非對立', note: '兩方回答不同之問題' }, sides: [{ position: '甲方', conditions: ['某條件'], basis: '轉述', toClaim: false, claims: [{ id: 'C1', text: '甲之主張' }], sources: [shared] }, { position: '乙方', sources: [shared, { id: 'zz', title: 'Z', text: '乙之內容' }] }] } })
            const x14 = disputeCaseOf(c14.input)
            const src14 = new Map(c14.input.sides.flatMap((sd) => sd.sources.map((s) => [s.id, s])))
            const k14 = panelCapture()
            await runDisputeCheck({ items: [x14.item], concept: '題組', contentOf: (n) => src14.get(n).text, titleOf: (n) => src14.get(n).title, buildPrompt: D.buildDisputeCheckPrompt, call: k14.call, seats: PANEL2 })
            assert.equal(k14.prompts.get('dispute1')[0], esPageOf('ES14', [c14], { domain: D }).prompt, 'ES14')
            const c11 = [es11('y1'), es11('y2'), es11('y3')]
            const k11 = panelCapture()
            await runSynonymCheck({ items: c11.map((c) => ({ key: c.id, a: c.input.a, b: c.input.b })), buildPrompt: D.buildSynonymCheckPrompt, call: k11.call, seats: PANEL2 })
            assert.equal(k11.prompts.get('synonym1')[0], esPageOf('ES11', c11, { domain: D }).prompt, 'ES11')
        })

        it('評分之分頁與提示詞＝esCases 之頁組法:ES 四角色之各頁提示詞與 esPagesOfCases 逐字同(--batch 改每頁案數,項編號頁內重起;角色參數之正整數同核心之 benchPintOf);失撐一案一頁', () => {
            const map = { 'support-check': 'ES9', 'orphan-check': 'ES8', 'dispute-check': 'ES14', 'synonym-check': 'ES11' }
            for (const [id, std] of Object.entries(map)) {
                const plan = planExtractBench(id)
                assert.deepEqual(plan.pages.map((p) => p.prompt), esPagesOfCases(std, plan.set.cases, { domain: D }).map((p) => p.prompt), id)
            }
            const b4 = planExtractBench('support-check', { roleOpt: { batch: 4 } })
            assert.deepEqual(b4.pages.map((p) => p.ids.length), [4, 4, 4, 4])
            assert.match(b4.pages[1].prompt, /--- 第1項（/, '--batch 之第 2 頁由第 1 項起(頁內重起)')
            assert.equal(planExtractBench('orphan-check', { roleOpt: { batch: 4 } }).pages.length, SET['orphan-check'].cases.length, '失撐恆一案一頁')
            assert.match(msgOf(() => planExtractBench('synonym-check', { roleOpt: { batch: 0 } })), /roleOpt\.batch 須為正整數，收到 0/)
            assert.match(msgOf(() => esPagesOfCases('ES11', [es11('a')], { domain: D, pageSize: 0 })), /每頁案數須為正整數/, 'esPageSizeOf 仍為安裝方之公開 API')
        })

        it('修訂之頁同正式 runSupportRevise:出處依頁內首次出現序去重標號、項之欄＝正式之 fieldsOf(方無期間)、覆核說明＝案之 votes 經正式之 notSupportedReasonsOf;原操作未過閘或標注種類不在清單 → 任何呼叫之前拋錯', () => {
            const plan = planExtractBench('support-revise')
            const page = plan.set.cases.slice(0, 10)
            const ids = [...new Set(page.flatMap((c) => c.input.sources.map((s) => s.id)))]
            const label = new Map(ids.map((id, i) => [id, `S${i + 1}`]))
            const byId = new Map(page.flatMap((c) => c.input.sources.map((s) => [s.id, s])))
            const items = page.map((c, j) => {
                const f = reviseCaseOf(c.input, D).fields
                return { index: j + 1, kind: c.input.kind, text: f.text, conditions: f.conditions, period: f.period, labels: c.input.sources.map((s) => label.get(s.id)), reasons: reviseReasonsOf(c.input.votes) }
            })
            assert.equal(plan.pages[0].prompt, D.buildSupportRevisePrompt({ concept: '題組', sources: ids.map((n) => ({ label: label.get(n), title: byId.get(n).title, text: byId.get(n).text })), items }))
            assert.deepEqual(reviseReasonsOf([{ verdict: 'overclaim', reason: '甲' }, { verdict: 'insufficient', reason: '乙' }, { verdict: 'overclaim', reason: '甲' }]), ['語氣超出證據：甲', '出處未涉及或不足以支持：乙'], '正式之字樣、去重')
            assert.ok(!/--- 第4項（爭議之一方）---[^]*?期間：/.test(plan.pages[0].prompt.split('--- 第5項')[0]), '方之項不列期間')
            assert.match(msgOf(() => planExtractBench('support-revise', { cases: [rev('a', { input: { ...rev('a').input, text: '晨讀 99 分鐘可提高閱讀能力' } })] })), /案 a 之原操作未過納入閘（ES2：數字 99/)
            assert.match(msgOf(() => planExtractBench('support-revise', { cases: [rev('a', { input: { ...rev('a').input, annotation: { kind: 'pitfall', critique: '僅單一學校' } } })] })), /案 a 之原操作未過納入閘（ES4/)
            assert.match(msgOf(() => planExtractBench('support-revise', { cases: [rev('a', { input: { ...rev('a').input, annotation: { kind: 'law', critique: 'c', pros: ['p'], cons: ['c'] } } })] })), /案 a 之標注種類「law」不在主張種類/)
        })

        it('同義提議之提示詞同正式:名單先依碼元序(題組之序不入提示詞)', () => {
            const c = { id: 'p', input: { names: ['乙', '甲'].sort() }, expect: { must: [['甲', '乙']], mustNot: [] }, why: 'w' }
            const plan = planExtractBench('synonym-propose', { cases: [c] })
            assert.equal(plan.pages[0].prompt, D.buildSynonymProposePrompt(['乙', '甲'].sort()))
        })

        it('工作流類之提示詞＝正式之 domain.build*Prompt(與正式呼叫點同一組材料;一案一頁):審計、終審(＋附錄)、整合、起草、修訂、整併、本質;待審裁決＝正式之 pendingReviewPromptOf', () => {
            const firstPrompt = (id) => planExtractBench(id).pages[0].prompt
            assert.match(firstPrompt('wf-audit'), /a1_2/)
            assert.match(firstPrompt('wf-accept'), /i=1 /)
            assert.match(firstPrompt('wf-accept'), /捏造/, '終審附錄(意見)')
            assert.match(firstPrompt('wf-pending'), /前次未經終審裁決而暫緩/)
            assert.match(firstPrompt('wf-integrate'), /a3_2/)
            assert.match(firstPrompt('wf-draft'), /本批 2 篇尚未提煉之筆記/)
            assert.match(firstPrompt('wf-revise'), /約占全週三成/)
            assert.match(firstPrompt('wf-consolidate'), /上限 2/)
            assert.match(firstPrompt('wf-essence'), /尚無本質/)
            for (const id of WF_IDS) assert.equal(planExtractBench(id).pages.length, SET[id].cases.length, `${id} 一案一頁`)
        })
    })

    // ══════════════════════════ ③呼叫 ══════════════════════════
    describe('③ 呼叫(同正式之單棒呼叫包裝與起草三席)', function() {

        it('單棒之角色經 extractAiCall:席位只放受測模型(不遞補)、正式之 parse、交調度層之 check 為正式之判準(嚴格 true)、acceptTruncated:false、onEvent 轉交;各角色之段名與解析器', async () => {
            const ai = wkfStub()
            await runExtractBench('support-check', { models: ['m1'], runs: 1, aiAdapter: ai, cases: SET['support-check'].cases.slice(0, 2), timeoutMs: 4321 })
            const o = ai.calls[0].opt
            assert.deepEqual(o.spec, { use: 'm1', fallback: [] })
            assert.equal(o.timeoutMs, 4321, '--timeout 經席位帶入')
            assert.equal(o.parse, parseSupportChecks)
            assert.equal(o.acceptTruncated, false)
            assert.equal(typeof o.onEvent, 'function')
            assert.equal(o.check({ checks: [] }), true)
            assert.equal(typeof o.check({ items: [] }), 'string', '不合者回說明(callAi 判嚴格 true 才過)')
            assert.equal(checkSupportChecks({ checks: [] }), true)
            const parsers = { 'support-revise': parseSupportRevise, 'orphan-check': parseOrphanChecks, 'dispute-check': parseDisputeChecks, 'synonym-check': parseSynonymChecks, 'synonym-propose': parseSynonymProposals, 'wf-audit': parseAudit, 'wf-accept': parseVerdicts, 'wf-pending': parseVerdicts, 'wf-integrate': parseDraft, 'wf-revise': parsePatch }
            for (const [id, parse] of Object.entries(parsers)) {
                const st = wkfStub()
                await runExtractBench(id, { models: ['m1'], runs: 1, aiAdapter: st, cases: SET[id].cases.slice(0, 1) })
                assert.equal(st.calls[0].opt.parse, parse, id)
                assert.equal(st.calls.length, 1, `${id} 一頁一次`)
            }
        })

        it('起草三席之棒(起草、整併、本質)經正式之 extractFanout:受測模型為第一席(唯一送出之呼叫;正式之 parseDraft、acceptTruncated:false、onEvent 轉交),其餘兩席為凍結腳本(不送出、不記帳)', async () => {
            for (const id of ['wf-draft', 'wf-consolidate', 'wf-essence']) {
                const st = wkfStub()
                let recorded = 0
                const ai = { ...st, recordCall: () => recorded++ }
                const r = await runExtractBench(id, { models: ['m1'], runs: 1, aiAdapter: ai, cases: SET[id].cases.slice(0, 1) })
                assert.equal(st.calls.length, 1, `${id} 只送出受測席`)
                const o = st.calls[0].opt
                assert.deepEqual([o.spec.use, o.parse, o.acceptTruncated, typeof o.onEvent], ['m1', parseDraft, false, 'function'], id)
                assert.equal(recorded, 1, `${id} 只記受測席之帳`)
                assert.equal(r.models[0].score.pass, 1, id)
            }
        })

        it('失敗之逐次摘要經抓取套件之 callJsonShapeOf:驗證失敗附不合格原因(依正式之 parse 與 check 重判;與 callJson 同字樣);回覆不合 → reply;逾時 → timeout;限流(冷卻事件)→ 停測;他模型照跑', async () => {
            const cases = SET['synonym-check'].cases.slice(0, 2)
            const ai = wkfStub({
                plan: { 'synonym-check': { cases } },
                raw: { 'synonym-check': (cs, base, m) => (m === 'bad' ? '我無法判斷' : (m === 'shape' ? '{"items":[]}' : JSON.stringify(ORACLE['synonym-check'](cs)))) },
                fail: { slow: { error: 'TIMEOUT after 1000ms', errorType: 'timeout', tried: [{ providerId: 'slow', outcome: 'skip-group', errorType: 'timeout', durationMs: 1000 }] }, cool: { error: 'x', errorType: 'exec', events: [{ type: 'cooled', error: 'FreeUsageLimitError' }], tried: [{ providerId: 'cool', outcome: 'skip-group', errorType: 'exec', durationMs: 5 }] } },
            })
            const r = await runExtractBench('synonym-check', { models: ['ok', 'bad', 'shape', 'slow', 'cool'], runs: 1, aiAdapter: ai, cases })
            const m = Object.fromEntries(r.models.map((x) => [x.model, x]))
            assert.equal(m.ok.score.pass, 2)
            assert.equal(m.bad.cases[0].runs[0].failKind, 'reply')
            assert.match(m.bad.cases[0].runs[0].error, /bad:validation\(1\.2s\)：回覆中無含指定鍵之物件（非 JSON 或缺鍵）/)
            assert.match(m.shape.cases[0].runs[0].error, /shape:validation\(1\.2s\)：回覆中無含指定鍵之物件/, '缺鍵之物件亦解析不出')
            assert.equal(m.slow.cases[0].runs[0].failKind, 'timeout')
            assert.ok(m.cool.stopped, '限流即停')
        })
    })

    // ══════════════════════════ ④逐案類別 ══════════════════════════
    describe('④ 逐案類別', function() {

        it('示範回覆 → 十四角色逐案每回皆通過、合契約率 100%(應然可達);呼叫數＝頁數×回數', async () => {
            for (const role of EXTRACT_BENCH_ROLES) {
                const ai = wkfStub()
                const r = await runExtractBench(role.id, { models: ['m1'], runs: 2, aiAdapter: ai })
                const m = r.models[0]
                const fails = m.cases.filter((c) => !c.pass).map((c) => `${c.id}：${c.note}`)
                assert.deepEqual(fails, [], role.id)
                assert.equal(m.contract.valid, m.contract.total, `${role.id} 合契約`)
                assert.equal(ai.calls.length, planExtractBench(role.id).pages.length * 2, `${role.id} 呼叫數`)
            }
        })

        it('出處支持覆核:類別 supportClassOf(三種不受支持同類);缺票(理由過短、裁決不在清單、by 皆非該項所引)、同編號矛盾 → 無裁決;應然列 by 者所列不屬應然或未分別 → supported(出處不符);unsure 合法', () => {
            const cases = [es9('a', { expect: { verdict: 'supported', by: ['s-a'] } }), es9('b', { expect: { verdict: 'overclaim' } }), es9('c'), es9('d'), es9('e')]
            const v = judgePage('support-check', cases, { checks: [
                { index: 1, verdict: 'supported', by: ['S2'], reason: WHY }, // S2 為 b 之出處——非本項所引 → 缺票
                { index: 2, verdict: 'insufficient', reason: WHY },
                { index: 3, verdict: 'overclaim', reason: '太短' },
                { index: 4, verdict: 'supported', reason: WHY }, { index: 4, verdict: 'contradicted', reason: WHY },
                { index: 5, verdict: 'unsure', reason: '' },
            ] })
            assert.deepEqual(v.map((x) => x.cls), [null, 'not', null, null, 'unsure'])
            assert.match(v[0].problem, /index 1 之裁決不合格/)
            assert.match(v[2].problem, /index 3 之裁決不合格/)
            assert.match(v[3].problem, /同編號 4 之裁決互相矛盾/)
            const two = es9('m', { input: { kind: 'add', text: '甲', sources: [{ id: 'x1', title: 'X1', text: '甲' }, { id: 'x2', title: 'X2', text: '乙' }] }, expect: { verdict: 'supported', by: ['x1'] } })
            const cls = (by) => judgePage('support-check', [two], { checks: [{ index: 1, verdict: 'supported', ...(by ? { by } : {}), reason: WHY }] })[0].cls
            assert.deepEqual([cls(['S1']), cls(['S1', 'S2']), cls(['S2']), cls(null)], ['supported', ES_BY_MISMATCH, ES_BY_MISMATCH, ES_BY_MISMATCH], '所列須非空且皆屬應然;未分別亦不符')
            assert.equal(judgePage('support-check', [es9('n')], { checks: [{ index: 1, verdict: 'supported', reason: WHY }] })[0].cls, 'supported', '應然未列 by 者不比對所列')
            assert.deepEqual(['supported', 'contradicted', 'insufficient', 'overclaim', 'unsure'].map((verdict) => supportClassOf({ verdict })), ['supported', 'not', 'not', 'not', 'unsure'])
        })

        it('出處之比對一份(esByMatchOf;required 旗標):ES9 之應然選列 by(未列不比對)、ES8 之應然必列(未列即不符)', () => {
            const idOf = new Map([['S1', 'a'], ['S2', 'b']])
            assert.deepEqual([esByMatchOf({ by: ['S1'] }, { by: ['a'] }, idOf), esByMatchOf({ by: ['S1', 'S2'] }, { by: ['a'] }, idOf), esByMatchOf({ by: [] }, { by: ['a'] }, idOf), esByMatchOf({}, { by: ['a'] }, idOf)], [true, false, false, false])
            assert.deepEqual([esByMatchOf({ by: ['S1'] }, {}, idOf), esByMatchOf({ by: ['S1'] }, {}, idOf, { required: true })], [true, false])
        })

        it('失撐找支持:supported 所列須非空且皆屬應然(列了不支持者 → supported(出處不符));none;unsure;by 不屬本頁之標號、理由過短 → 缺票', () => {
            const c = es8('a', { expect: { verdict: 'supported', by: ['c2'] } })
            const one = (raw) => judgePage('orphan-check', [c], { checks: [raw] })[0]
            assert.equal(one({ index: 1, verdict: 'supported', by: ['S2'], reason: WHY }).cls, 'supported')
            assert.equal(one({ index: 1, verdict: 'supported', by: ['S1', 'S2'], reason: WHY }).cls, ES_BY_MISMATCH)
            assert.equal(one({ index: 1, verdict: 'none', reason: WHY }).cls, 'none')
            assert.equal(one({ index: 1, verdict: 'unsure', reason: '' }).cls, 'unsure')
            assert.equal(one({ index: 1, verdict: 'supported', by: ['S9'], reason: WHY }).cls, null)
            assert.equal(one({ index: 1, verdict: 'none', reason: '短' }).cls, null)
            assert.equal(judgePage('orphan-check', [c], { checks: [] })[0].problem, '回覆之 checks 為空')
        })

        it('爭議覆核:opposed;非對立之票之拆解欄位可用 → not;種類為 null、缺欄、principle 而單一文件(ES12)、標注缺銳評(ES4)、標注含出處沒有之數字(ES2)→ not-nofields(附原因);unsure;理由過短 → 缺票', () => {
            const c = es14('a')
            const ann = { critique: '僅單一研究之觀察', pros: ['出處未載'], cons: ['出處未載'] }
            const one = (extra) => judgePage('dispute-check', [c], { checks: [{ index: 1, verdict: 'not-opposed', reason: WHY, ...extra }] })[0]
            assert.equal(judgePage('dispute-check', [c], { checks: [{ index: 1, verdict: 'opposed', reason: '' }] })[0].cls, 'opposed')
            assert.equal(one({ kinds: ['rule', 'pitfall'], annotations: [ann, { critique: '僅單一研究', conditions: ['某條件'] }] }).cls, 'not')
            assert.equal(judgePage('dispute-check', [c], { checks: [{ index: 1, verdict: 'same-study', reason: WHY, kinds: ['rule', 'rule'], annotations: [ann, ann] }] })[0].cls, 'not', 'same-study 同類')
            for (const [extra, why] of [
                [{ kinds: [null, null], annotations: [null, null] }, /無拆解欄位|種類不在清單/],
                [{}, /無拆解欄位/],
                [{ kinds: ['principle', 'rule'], annotations: [ann, ann] }, /ES12/],
                [{ kinds: ['rule', 'rule'], annotations: [{ pros: ['出處未載'], cons: ['出處未載'] }, ann] }, /ES4.*缺銳評/],
                [{ kinds: ['rule', 'rule'], annotations: [{ ...ann, critique: '僅 37 人之觀察' }, ann] }, /ES2.*37/],
            ]) {
                const r = one(extra)
                assert.equal(r.cls, ES_NOT_NOFIELDS, JSON.stringify(extra))
                assert.match(r.fields.dissolve, why)
            }
            assert.equal(judgePage('dispute-check', [c], { checks: [{ index: 1, verdict: 'unsure', reason: '' }] })[0].cls, 'unsure')
            assert.equal(one({ reason: '短', kinds: ['rule', 'rule'], annotations: [ann, ann] }).cls, null)
            // 不另立主張之方:種類與標注填 null 才可用(正式之去處判定為 none)
            const side0 = { position: '甲方', toClaim: false, claims: [{ id: 'C1', text: '甲之主張' }], sources: [{ id: 't1', title: 'T', text: '甲方之內容' }] }
            const cs = es14('b', { input: { ...es14('b').input, sides: [side0, es14('b').input.sides[1]] } })
            assert.equal(judgePage('dispute-check', [cs], { checks: [{ index: 1, verdict: 'not-opposed', reason: WHY, kinds: [null, 'rule'], annotations: [null, ann] }] })[0].cls, 'not')
        })

        it('同義覆核:same／different／unsure;理由過短、裁決不在清單、同編號矛盾 → 缺票', () => {
            const v = judgePage('synonym-check', [es11('a'), es11('b'), es11('c'), es11('d'), es11('e')], { checks: [
                { index: 1, verdict: 'same', reason: WHY }, { index: 2, verdict: 'Different', reason: WHY }, { index: 3, verdict: 'unsure', reason: '' },
                { index: 4, verdict: 'same', reason: '短' }, { index: 5, verdict: 'same', reason: WHY }, { index: 5, verdict: 'different', reason: WHY },
            ] })
            assert.deepEqual(v.map((x) => x.cls), ['same', 'different', 'unsure', null, null])
        })

        it('出處修訂:應然 drop 者回 drop → ok、改寫 → drop;應然 fix 者回 drop → fix;改寫套回後過守門與納入閘(陷阱主張刪光條件 → gate、數字不見於出處 → gate)才判謂詞(conditionsAny／periodAny／textMustNot);無該項、無 text 亦非 drop、同編號多份 → 無裁決', () => {
            const dropCase = rev('d', { expect: { drop: true } })
            const one = (c, fix) => judgePage('support-revise', [c], { fixes: [{ index: 1, ...fix }] })[0]
            assert.equal(one(dropCase, { drop: true }).cls, 'ok')
            assert.equal(one(dropCase, { text: '某小學三年級晨讀後閱讀分數提高', conditions: ['三年級'] }).cls, 'drop')
            const fixCase = rev('f', { expect: { fix: { conditionsAny: ['三年級'], textMustNot: ['可提高'] } } })
            assert.equal(one(fixCase, { drop: true }).cls, 'fix')
            assert.equal(one(fixCase, { text: '某小學實施晨讀後閱讀分數提高', conditions: ['三年級', '每日 15 分鐘'] }).cls, 'ok')
            const g = one(fixCase, { text: '某小學實施晨讀後閱讀分數提高', conditions: ['三年級', '每日 20 分鐘'] })
            assert.equal(g.cls, 'gate')
            assert.match(g.fields.why, /ES2.*20/)
            assert.equal(one(fixCase, { text: '某小學實施晨讀後閱讀分數提高', conditions: ['某一所小學'] }).cls, 'conditionsAny')
            assert.equal(one(fixCase, { text: '晨讀可提高閱讀能力', conditions: ['三年級'] }).cls, 'textMustNot')
            const per = rev('p', { input: { ...rev('p').input, sources: [{ id: 's1', title: '晨讀', text: '2019 年某小學三年級實施晨讀，閱讀測驗分數提高。' }] }, expect: { fix: { periodAny: ['2019'] } } })
            assert.equal(one(per, { text: '某小學三年級實施晨讀後閱讀分數提高', conditions: ['三年級'], period: '2019 年' }).cls, 'ok')
            assert.equal(one(per, { text: '某小學三年級實施晨讀後閱讀分數提高', conditions: ['三年級', '2019 年'] }).cls, 'periodAny', '期間寫在條件不算(提示詞明定期間寫進 period)')
            const pit = rev('t', { input: { ...rev('t').input, conditions: ['三年級'], annotation: { kind: 'pitfall', critique: '僅單一學校' } }, expect: { fix: { textMustNot: ['可提高'] } } })
            const gp = one(pit, { text: '晨讀與閱讀分數之關係只在單一學校觀察到', conditions: [] })
            assert.equal(gp.cls, 'gate')
            assert.match(gp.fields.why, /ES4.*陷阱主張缺條件/)
            const side = rev('s', { input: { kind: 'side', text: '晨讀一律提高閱讀能力', sources: rev('s').input.sources, votes: [{ verdict: 'overclaim', reason: '只涵蓋某小學三年級' }] }, expect: { fix: { textMustNot: ['一律'], conditionsAny: ['三年級'] } } })
            assert.equal(one(side, { text: '某小學實施晨讀後閱讀分數提高', conditions: ['三年級'] }).cls, 'ok', '爭議之一方:改立場與條件')
            assert.equal(one(side, { text: '晨讀一律提高閱讀能力', conditions: ['三年級'] }).cls, 'textMustNot')
            assert.match(judgePage('support-revise', [fixCase], { fixes: [] })[0].problem, /fixes 為空/)
            assert.match(judgePage('support-revise', [fixCase], { fixes: [{ index: 1 }] })[0].problem, /無 text 亦非 drop/)
            assert.match(judgePage('support-revise', [fixCase], { fixes: [{ index: 1, text: '甲' }, { index: 1, text: '乙' }] })[0].problem, /同編號 1 之修訂多份/)
            assert.match(judgePage('support-revise', [fixCase], { items: [] })[0].problem, /回覆不含 fixes 陣列/)
        })

        it('同義提議:經正式之 proposedCandidatesOf;應提皆在 → ok、漏提 → must、提了不應提者 → mustNot;名單外之名與同名之配對不合契約(正式略去)', () => {
            const c = { id: 'p', input: { names: ['丁', '丙', '乙', '甲'] }, expect: { must: [['甲', '乙']], mustNot: [['丙', '丁']] }, why: 'w' }
            const one = (pairs) => judgePage('synonym-propose', [c], { pairs })[0]
            assert.deepEqual([one([{ a: '乙', b: '甲' }]).cls, one([{ a: '乙', b: '甲' }]).valid], ['ok', true])
            assert.equal(one([]).cls, 'must')
            assert.equal(one([{ a: '甲', b: '乙' }, { a: '丁', b: '丙' }]).cls, 'mustNot')
            const off = one([{ a: '甲', b: '乙' }, { a: '甲', b: '戊' }, { a: '丙', b: '丙' }])
            assert.deepEqual([off.cls, off.valid, off.fields.offList], ['ok', false, 2])
            assert.match(judgePage('synonym-propose', [c], { checks: [] })[0].problem, /回覆不含 pairs 陣列/)
        })

        it('審計(wf-audit):植入之缺陷未以高嚴重度指出或類型不符 → flags;乾淨之操作被列高嚴重度 → clean;意見指向操作之判準同正式(issueOnOp)', () => {
            const c = wfCase('wf-audit', 'a01')
            const one = (issues) => wfJudge('wf-audit', c, { issues })
            assert.equal(one(WF_DEMO.a01.issues).cls, 'ok')
            assert.equal(one([{ ref: 'a1_2', severity: '中', type: '捏造', detail: 'x', fix: 'y' }]).cls, 'flags', '中嚴重度不算')
            assert.equal(one([{ ref: 'a1_2', severity: '高', type: '離題', detail: 'x', fix: 'y' }]).cls, 'flags', '類型不符')
            assert.equal(one([...WF_DEMO.a01.issues, { ref: 'a1_1', severity: 'high', type: '重複', detail: 'x', fix: 'y' }]).cls, 'clean', '乾淨之操作被列高嚴重度(含英文字樣)')
            assert.equal(one([...WF_DEMO.a01.issues, { ref: 'a1_1', severity: '低', type: '措辭', detail: 'x', fix: 'y' }]).cls, 'ok', '低嚴重度之意見不影響乾淨')
            assert.equal(wfJudge('wf-audit', c, { ops: [] }).cls, null, '回覆不合 check → 無裁決')
        })

        it('審計(wf-audit):植入之「重複」不論嚴重度、類型相符即算指出(R1:同正式之移除判準——重複不論嚴重度、離題／捏造須高);捏造／離題仍須高;類型不符、指向他條、合寫之 ref 不成立', () => {
            const c = wfCase('wf-audit', 'a02')
            const one = (issues, cc = c) => wfJudge('wf-audit', cc, { issues })
            const dup = (severity, ref = 'a2_1', type = '重複') => ({ ref, severity, type, detail: '與 a1_1 同義', fix: '刪除' })
            assert.equal(one([dup('高')]).cls, 'ok', '高嚴重度之重複')
            assert.equal(one([dup('中')]).cls, 'ok', '中嚴重度之重複亦算指出(正式之修訂、終審可依之移除;審計提示詞之「高」不含重複)')
            assert.equal(one([dup('低')]).cls, 'ok', '低嚴重度之重複亦算指出')
            assert.equal(one([dup('中', 'a2_1', '捏造')]).cls, 'flags', '類型不符(重複被標成捏造而嚴重度非高)')
            assert.equal(one([dup('高', 'a2_1', '離題')]).cls, 'flags', '類型不符(高嚴重度亦不補類型)')
            assert.equal(one([dup('中', 'a1_1')]).cls, 'flags', '指向另一條(只指後出之 a2_1 才算)')
            assert.equal(one([dup('中', 'a1_1、a2_1')]).cls, 'flags', '合寫之 ref 不指向任一操作(同正式之 issueOnOp)')
            const r = one([])
            assert.equal(r.cls, 'flags')
            assert.match(r.fields.why, /重複不論嚴重度/, '不成立之處寫明判準')
            const a = wfCase('wf-audit', 'a03')
            assert.equal(wfJudge('wf-audit', a, { issues: [{ ref: 'a2_1', severity: '中', type: '離題', detail: 'x', fix: 'y' }] }).cls, 'flags', '離題以中嚴重度仍不成立')
            assert.equal(wfJudge('wf-audit', a, { issues: [{ ref: 'a2_1', severity: '高', type: '離題', detail: 'x', fix: 'y' }] }).cls, 'ok', '離題以高嚴重度成立')
            const f = wfCase('wf-audit', 'a01')
            assert.equal(wfJudge('wf-audit', f, { issues: [{ ref: 'a1_2', severity: '中', type: '捏造', detail: 'x', fix: 'y' }] }).cls, 'flags', '捏造以中嚴重度仍不成立')
            assert.equal(wfJudge('wf-audit', f, { issues: [{ ref: 'a1_2', severity: '低', type: '重複', detail: 'x', fix: 'y' }] }).cls, 'flags', '應然為捏造而意見為重複 → 類型不符')
        })

        it('審計(wf-audit)與正式移除判準單一來源(R2):建設性操作之 removalAllowed 與謂詞 flags 對同一組意見之判斷逐格一致(類型×嚴重度×指向);破壞性、爭議類之分支屬操作類別與移除方自述之理由,非意見面,謂詞不採', () => {
            const c = wfCase('wf-audit', 'a02')
            const op = c.input.ops.find((x) => x._oid === 'a2_1')
            const s = emptyState()
            const types = ['重複', '離題', '捏造', '超限', '檢定標準', '措辭', '重複／捏造', '離題、重複', '']
            const sevs = ['高', 'high', 'High', 'HIGH', '嚴重', '中', '低', '']
            const refs = ['a2_1', 'a1_1', 'a1_1、a2_1', '']
            const flagged = (issues) => [ISSUE_TYPES.fabricated, ISSUE_TYPES.offTopic, ISSUE_TYPES.duplicate].some((t) => wfJudge('wf-audit', { ...c, expect: { flags: { a2_1: t } } }, { issues }).cls === 'ok')
            let cells = 0
            let agree = 0
            for (const type of types) for (const severity of sevs) for (const ref of refs) {
                const issues = [{ ref, severity, type, detail: 'x', fix: 'y' }]
                const formal = removalAllowed(op, s, normalizeIssues(issues), '').ok
                assert.equal(flagged(issues), formal, `type=${type} severity=${severity} ref=${ref}`)
                cells++
                if (formal) agree++
            }
            assert.equal(cells, types.length * sevs.length * refs.length)
            assert.ok(agree > 0 && agree < cells, '格內有成立亦有不成立(格不得全同)')
            // 兩條意見合併判:任一條足以移除即成立(同 issues.find)
            const two = [{ ref: 'a2_1', severity: '中', type: '離題', detail: 'x', fix: 'y' }, { ref: 'a2_1', severity: '低', type: '重複', detail: 'x', fix: 'y' }]
            assert.equal(removalAllowed(op, s, normalizeIssues(two), '').ok, true)
            assert.equal(flagged(two), true)
            // 邊界:無意見時,破壞性操作之移除正式放行(取決於操作類別),但「審計席有沒有指出」不因此成立
            const k = wfCase('wf-audit', 'a05')
            const gone = { op: 'retract', id: 'C1', reason: '離題', sources: ['N1'], _oid: 'a3_1' }
            const withGone = { ...k, input: { ...k.input, ops: [...k.input.ops, gone] } }
            assert.equal(removalAllowed(gone, coreStateOf(k.input.state).state, [], '').ok, true, '破壞性操作移除不需意見(正式)')
            assert.equal(wfJudge('wf-audit', { ...withGone, expect: { flags: { a3_1: '離題' } } }, { issues: [] }).cls, 'flags', '謂詞只判審計席之意見,不因操作類別而放行')
        })

        it('審計(wf-audit):clean 與正式移除判準對稱(R7)——乾淨之操作被標足以使正式流程移除之意見(重複不論嚴重度、離題／捏造須高)即不乾淨,另保留「任何高嚴重度意見即不乾淨」(兩條件取聯集)', () => {
            const c = wfCase('wf-audit', 'a02')
            assert.deepEqual(c.expect.clean, ['a1_1'], 'a02:a2_1 為植入之重複、a1_1 為乾淨之操作')
            const mk = (severity, type, ref = 'a1_1') => ({ ref, severity, type, detail: 'x', fix: 'y' })
            const on = (extra) => wfJudge('wf-audit', c, { issues: [...WF_DEMO.a02.issues, extra] })
            // 新條件:足以使正式流程移除(重複不論嚴重度)——正式流程會移除乾淨之操作 = 知識遺失
            for (const sev of ['中', '低', '']) assert.equal(on(mk(sev, '重複')).cls, 'clean', `乾淨之操作被標${sev || '空'}嚴重度之重複 → 不乾淨`)
            // 既有條件:任何高嚴重度意見(不限類型)
            for (const type of ['重複', '離題', '捏造', '措辭', '超限', '檢定標準', '遺漏', '']) {
                for (const sev of ['高', 'high', '嚴重']) assert.equal(on(mk(sev, type)).cls, 'clean', `乾淨之操作被標${sev}嚴重度之${type || '空類型'} → 不乾淨`)
            }
            // 不足以移除、亦非高 → 仍乾淨
            for (const type of ['離題', '捏造', '措辭', '超限', '檢定標準', '遺漏', '']) {
                for (const sev of ['中', '低', '']) assert.equal(on(mk(sev, type)).cls, 'ok', `${sev || '空'}嚴重度之${type || '空類型'}不足以移除、亦非高 → 乾淨`)
            }
            assert.equal(on(mk('中', '重複', 'a2_1')).cls, 'ok', '意見指向植入之 a2_1 不影響乾淨之 a1_1')
            assert.equal(on(mk('中', '重複', 'a1_1、a2_1')).cls, 'ok', '合寫之 ref 不指向任一操作(同 issueOnOp)')
            // 不成立說明分兩因
            assert.match(on(mk('中', '重複')).fields.why, /乾淨之操作被列足以使正式流程移除之意見.*a1_1/, '足以移除之因')
            assert.match(on(mk('高', '措辭')).fields.why, /乾淨之操作被列高嚴重度意見.*a1_1/, '高嚴重度之因')
            // 與正式移除判準對稱:不乾淨 ⇔ 指向該操作且(高嚴重度 或 removalAllowed 放行);全積(含正式放行者必不乾淨)
            const op = c.input.ops.find((x) => x._oid === 'a1_1')
            const s = emptyState()
            const types = ['重複', '離題', '捏造', '超限', '檢定標準', '措辭', '重複／捏造', '離題、重複', '']
            const sevs = ['高', 'high', 'High', 'HIGH', '嚴重', '中', '低', '']
            const refs = ['a1_1', 'a2_1', 'a1_1、a2_1']
            let notClean = 0
            let byRemoval = 0
            for (const type of types) for (const severity of sevs) for (const ref of refs) {
                const x = normalizeIssues([mk(severity, type, ref)])[0]
                const formal = removalAllowed(op, s, [x], '').ok
                const want = issueOnOp(x, op) && (SEV_HIGH.has(x.severity) || formal)
                assert.equal(on(mk(severity, type, ref)).cls === 'clean', want, `type=${type} severity=${severity} ref=${ref}`)
                if (formal) assert.equal(on(mk(severity, type, ref)).cls, 'clean', '正式放行移除者必不乾淨')
                if (want) notClean++
                if (want && !SEV_HIGH.has(x.severity)) byRemoval++
            }
            assert.ok(notClean > 0 && notClean < types.length * sevs.length * refs.length, '格內有乾淨亦有不乾淨')
            assert.ok(byRemoval > 0, '有僅因「足以移除」而不乾淨之格(新條件確有作用)')
        })

        it('審計(wf-audit):意見 ref 為空不指向任何操作(R8)——flags 不因缺 ref 之意見而成立、clean 不因缺 ref 之高嚴重度意見而全數不乾淨', () => {
            const c = wfCase('wf-audit', 'a02')
            const noRef = (severity, type) => ({ severity, type, detail: 'x', fix: 'y' })
            assert.equal(wfJudge('wf-audit', c, { issues: [noRef('高', '重複')] }).cls, 'flags', '缺 ref 之重複意見不指出植入之 a2_1')
            assert.equal(wfJudge('wf-audit', c, { issues: [{ ...noRef('高', '重複'), ref: '' }] }).cls, 'flags', 'ref 為空字串亦然')
            assert.equal(wfJudge('wf-audit', c, { issues: [...WF_DEMO.a02.issues, noRef('高', '遺漏')] }).cls, 'ok', '缺 ref 之高嚴重度意見(如對批次整體之遺漏)不使乾淨之 a1_1 不乾淨')
            assert.equal(wfJudge('wf-audit', c, { issues: [...WF_DEMO.a02.issues, noRef('中', '重複')] }).cls, 'ok', '缺 ref 之中嚴重度重複亦然')
        })

        it('終審(wf-accept):該剔未剔 → drop;剔除建設性操作而無高嚴重度意見(正式之剔除閘擋為 keep)→ 仍 drop 不成立;該留被剔 → keep;不可逆操作未明列 → irreversibleListed;無有效裁決 → 無裁決', () => {
            const c = wfCase('wf-accept', 'c01')
            const one = (verdicts, cc = c) => wfJudge('wf-accept', cc, { verdicts })
            assert.equal(one(WF_DEMO.c01.verdicts).cls, 'ok')
            assert.equal(one([{ i: 0, action: 'keep' }, { i: 2, action: 'keep' }]).cls, 'drop', '該剔者未列裁決 → 保留')
            assert.equal(one([{ i: 0, action: 'drop', reason: '捏造' }, { i: 1, action: 'drop', reason: '捏造' }, { i: 2, action: 'keep' }]).cls, 'ok', '剔除 i=0 而無高嚴重度意見——正式之剔除閘擋下改 keep')
            assert.equal(one([{ i: 0, action: 'keep' }, { i: 1, action: 'drop', reason: '捏造' }, { i: 2, action: 'drop', reason: '重複' }]).cls, 'keep', '以重複剔除 i=2 合剔除閘 → 該留被剔')
            const noIssue = { ...c, input: { ...c.input, issues: [] } }
            assert.equal(one(WF_DEMO.c01.verdicts, noIssue).cls, 'drop', '無高嚴重度意見時剔除建設性操作被閘擋下(正式之 gateVerdicts)')
            const c2 = wfCase('wf-accept', 'c02')
            assert.equal(one([{ i: 0, action: 'keep' }], c2).cls, 'ok')
            assert.equal(wfJudge('wf-accept', { ...c2, expect: { irreversibleListed: true } }, { verdicts: [{ i: 0, action: 'fix', fields: { bogus: 1 } }] }).cls, 'irreversibleListed', 'fix 無可改之欄位＝未得有效裁決')
            assert.equal(wfJudge('wf-accept', c2, { verdicts: [{ i: 9, action: 'keep' }] }).cls, null, '無有效裁決(同正式之終審失敗)')
        })

        it('待審裁決(wf-pending):去向＝剔除／保留(過正式之定稿篩選)／存待審(未列裁決之不可逆操作);與終審共用去向之判定件', () => {
            const p = wfCase('wf-pending', 'p01')
            const one = (verdicts, cc = p) => wfJudge('wf-pending', cc, { verdicts })
            assert.equal(one(WF_DEMO.p01.verdicts).cls, 'ok')
            assert.equal(one([{ i: 0, action: 'keep' }]).cls, 'drop', 'i=1 未列 → 留待審,非剔除')
            assert.equal(one([{ i: 0, action: 'drop', reason: '捏造' }, { i: 1, action: 'drop', reason: '捏造' }]).cls, 'keep')
            const p2 = wfCase('wf-pending', 'p02')
            assert.equal(one([], p2).cls, 'ok')
            assert.equal(one([{ i: 0, action: 'keep' }], p2).cls, 'withheld', '列了裁決即定案,不再留待審')
        })

        it('整合(wf-integrate):via 指回不存在之候選 → viaValid;漏收多數支持者 → keepsMajority;引用未收之新項(程式補閉包)→ refsClosed;套用被拒收 → applies', () => {
            const g = wfCase('wf-integrate', 'g01')
            const one = (ops, cc = g) => wfJudge('wf-integrate', cc, { ops, skipped: [] })
            const [A, P] = WF_DEMO.g01.ops
            assert.equal(one(WF_DEMO.g01.ops).cls, 'ok')
            assert.equal(one([{ ...A, via: ['a9_9'] }, P]).cls, 'viaValid')
            assert.equal(one([A]).cls, 'keepsMajority', '兩票之陷阱未收')
            const q = { op: 'question_add', text: '增派多少人力才足以完成閉館後之整理〔@x〕？', sources: ['N2'] }
            const withRef = { ...structuredClone(g), expect: { refsClosed: true } }
            withRef.input.candidates = [{ provider: 'p1', ops: [{ ...OP_A, ref: 'x' }, q] }, { provider: 'p2', ops: [OP_A] }]
            assert.equal(wfJudge('wf-integrate', withRef, { ops: [{ ...q, text: '增派多少人力才足以完成閉館後之整理〔@a1_x〕？', via: ['a1_2'] }], skipped: [] }).cls, 'refsClosed', '引用 @a1_x 而未收其定義 → 程式補閉包')
            assert.equal(wfJudge('wf-integrate', withRef, { ops: [{ ...OP_A, ref: 'a1_x', via: ['a1_1', 'a2_1'] }, { ...q, text: '增派多少人力才足以完成閉館後之整理〔@a1_x〕？', via: ['a1_2'] }], skipped: [] }).cls, 'ok', '一併收其定義 → 自足')
            assert.equal(one([{ ...A, kind: 'law' }, P]).cls, 'applies', '種類不在清單 → 套用拒收')
        })

        it('起草(wf-draft;結構合規):未引為出處 → cites;未以合法理由略過 → skips;漏交代 → covered;爭議與否不符 → dispute;未紮根之數字 → grounded;套用被拒收 → noRejected;種類未出現 → kinds', () => {
            const d = wfCase('wf-draft', 'd01')
            const one = (j, cc = d) => wfJudge('wf-draft', cc, j)
            assert.equal(one(WF_DEMO.d01).cls, 'ok')
            assert.equal(one({ ops: [], skipped: [{ note: 'N1', reason: SKIP_REASONS[0] }, { note: 'N2', reason: SKIP_REASONS[0] }] }).cls, 'cites')
            assert.equal(one({ ops: [OP_A], skipped: [{ note: 'N2', reason: '不想寫' }] }).cls, 'skips', '略過理由不在清單')
            assert.equal(one({ ops: [OP_A], skipped: [] }, { ...d, expect: { covered: true } }).cls, 'covered')
            const d2 = wfCase('wf-draft', 'd02')
            assert.equal(one(WF_DEMO.d02, { ...d2, expect: { dispute: true } }).cls, 'dispute', '應然要求有爭議而無爭議類操作落地')
            assert.equal(one({ ops: [{ ...OP_A, text: '社區圖書館週末開放後，週末借閱量約占全週 37%' }], skipped: [{ note: 'N2', reason: SKIP_REASONS[0] }] }, { ...d, expect: { grounded: true } }).cls, 'grounded', '數字不見於出處(納入閘 ES2)')
            assert.equal(one({ ops: [{ ...OP_A, kind: 'law' }], skipped: [{ note: 'N2', reason: SKIP_REASONS[0] }] }, { ...d, expect: { noRejected: true } }).cls, 'noRejected', '種類不在清單 → 試套拒收')
            assert.equal(one({ ops: [{ ...OP_A, kind: 'law' }], skipped: [{ note: 'N2', reason: SKIP_REASONS[0] }] }).cls, 'cites', '種類不在清單 → 試套拒收、不落地 → 未被引')
            assert.equal(one({ ops: [{ ...OP_A, kind: 'pitfall', pros: [], cons: [] }], skipped: [{ note: 'N2', reason: SKIP_REASONS[0] }] }, { ...d, expect: { kinds: ['rule'] } }).cls, 'kinds', '種類為陷阱而應然要求 rule')
        })

        it('起草(wf-draft):dispute 不成立之說明寫明原因(R5)——無爭議落地時分「未提出」與「提出而被拒收(附拒收處與原因)」;只改說明、不改判定', () => {
            const d5 = wfCase('wf-draft', 'd05')
            const why = (j, cc = d5) => wfJudge('wf-draft', cc, j).fields.why
            const a = { ...mkRule('設置公車專用道後，尖峰時段公車之行駛時間縮短', '某市之調查', ['N1']), ref: 'a' }
            const b = { ...mkPit('另一城市設置專用道後，行駛時間並未縮短，反因違規占用而延誤', '專用道遭違規占用時', ['N2']), ref: 'b' }
            const claimsOnly = { op: 'dispute_add', question: '設置公車專用道是否縮短尖峰時段之行駛時間？', sides: [{ position: '縮短', claims: ['@a'] }, { position: '未縮短', claims: ['@b'] }] }
            const r = wfJudge('wf-draft', d5, { ops: [a, b, claimsOnly], skipped: [] })
            assert.equal(r.cls, 'dispute', '判定不變:無爭議類操作落地')
            assert.match(r.fields.why, /無爭議類操作落地（爭議類操作被拒收——試套：無本批出處）/, '各方只引新主張而全無本批出處 → 試套拒收(整條須至少一個本批出處)')
            assert.match(why({ ops: [a, b], skipped: [] }), /無爭議類操作落地（未提出爭議類操作）/, '未提出')
            const withSrc = { ...claimsOnly, sides: [{ ...claimsOnly.sides[0], sources: ['N1'] }, { ...claimsOnly.sides[1], sources: ['N2'] }] }
            assert.equal(wfJudge('wf-draft', d5, { ops: [a, b, withSrc], skipped: [] }).cls, 'ok', '各方附本批出處 → 落地')
            assert.equal(wfJudge('wf-draft', { ...d5, expect: { cites: ['n1', 'n2'], dispute: false } }, { ops: [a, b, withSrc], skipped: [] }).fields.why, '有爭議類操作落地', '應然為無爭議而落地 → 說明不變')
        })

        it('起草(wf-draft):grounded 不成立之說明附納入閘之檢定標準與問題(R5;screen 之 rejected 為 { op, problems },原讀不存在之 why 而只剩「add：」)', () => {
            const d7 = wfCase('wf-draft', 'd07')
            const g = wfJudge('wf-draft', { ...d7, expect: { grounded: true } }, { ops: [mkRule('煮白米飯時米與水之體積比約為 1 比 1.2，浸泡 45 分鐘後再煮口感較佳', '某烹飪教室之說明', ['N1'])], skipped: [{ note: 'N2', reason: '品質不足' }] })
            assert.equal(g.cls, 'grounded')
            assert.match(g.fields.why, /^add：ES2：數字 45 分鐘/, '附檢定標準與問題(原僅「add：」)')
        })

        it('修訂(wf-revise;結構合規):未改正 → fixed;改動應保留者 → untouched;補丁使問題增加 → notWorse 或被守門擋 → blockedNone', () => {
            const r = wfCase('wf-revise', 'r01')
            const one = (patch, cc = r) => wfJudge('wf-revise', cc, patch)
            assert.equal(one(WF_DEMO.r01).cls, 'ok')
            assert.equal(one({ edits: [] }).cls, 'fixed')
            assert.equal(one({ edits: [...WF_DEMO.r01.edits, { ref: 'a1_2', fields: { text: '週末開放若未增派人力，閉館後之整理時間嚴重不足' } }] }).cls, 'untouched')
            assert.equal(one({ edits: WF_DEMO.r01.edits, removes: [{ ref: 'a1_2', reason: '離題' }] }).cls, 'blockedNone', '中嚴重度／無意見者之移除被補丁守門擋下')
            assert.equal(one({ edits: [{ ref: 'a1_1', fields: { text: '完全不同之另一句話' } }] }).cls, 'fixed', '改寫未保有原文過半 → 擋下 → 未改正')
            assert.equal(wfJudge('wf-revise', { ...r, expect: { notWorse: true } }, { edits: [{ ref: 'a1_1', fields: { text: '社區圖書館週末開放後，週末借閱量約占全週 37%' } }] }).cls, 'ok', '使問題增加之補丁正式不採(保留原稿)——不增')
        })

        it('整併(wf-consolidate;結構合規):未合併 → merges;套用被拒收 → noLoss;有效主張仍逾 → liveAtMost', () => {
            const s = wfCase('wf-consolidate', 's01')
            const one = (ops, cc = s) => wfJudge('wf-consolidate', cc, { ops })
            assert.equal(one(WF_DEMO.s01.ops).cls, 'ok')
            assert.equal(one([]).cls, 'merges')
            assert.equal(one([...WF_DEMO.s01.ops, { op: 'merge', into: 'C1', from: ['C9'], reason: '同主題' }]).cls, 'noLoss', '併入不存在之條目 → 套用拒收')
            assert.equal(wfJudge('wf-consolidate', { ...s, expect: { liveAtMost: 2 } }, { ops: [] }).cls, 'liveAtMost')
        })

        it('本質(wf-essence;結構合規):無 essence 或引用不存在之主張(未落地)→ essenceOk;本質逾硬上限(正式截短後落地仍可合格)→ withinLimit;數字不紮根 → essenceOk', () => {
            const e = wfCase('wf-essence', 'e01')
            const one = (ops) => wfJudge('wf-essence', e, { ops })
            assert.equal(one(WF_DEMO.e01.ops).cls, 'ok')
            assert.equal(one([]).cls, 'essenceOk')
            const long = `${'社區圖書館週末開放可增加使用，'.repeat(40)}但須配合人力。`
            assert.equal(one([{ op: 'essence', text: long, claims: ['C1', 'C2'], reason: 'r' }]).cls, 'withinLimit', '逾上限:截至句界後落地合格 → 首個不成立者為 withinLimit')
            assert.equal(one([{ op: 'essence', text: '週末借閱占全週 37%，延長開放須配合人力', claims: ['C1', 'C2'], reason: 'r' }]).cls, 'essenceOk', 'ES16:數字不見於所引主張之出處')
        })

        it('工作流類之反例回覆(WF_NEG):逐筆判得出不成立之謂詞(類別＝該謂詞、非形狀錯誤之無裁決);每謂詞 ≥2 份反例且分佈於 ≥2 個案;每角色 ≥1 份「只差一處」之反例(與該案示範回覆只差一處);反例不同於示範回覆', () => {
            for (const id of WF_IDS) {
                if (!WF_NEG[id]) continue
                const caseIds = new Set(SET[id].cases.map((c) => c.id))
                for (const [k, x] of WF_NEG[id].entries()) {
                    assert.ok(caseIds.has(x.id), `${id} 反例 ${k} 之案 ${x.id} 不在題組`)
                    assert.ok(WF_PREDS[id].includes(x.cls), `${id} 反例 ${k} 之類別 ${x.cls} 非本角色之謂詞`)
                    assert.ok(x.note.length > 0, `${id} 反例 ${k} 須有註記`)
                    assert.notDeepEqual(x.reply, WF_DEMO[x.id], `${id} 反例 ${k} 與示範回覆相同`)
                    const cs = wfCase(id, x.id)
                    if (x.only) {
                        assert.ok(x.cls in cs.expect, `${id} 反例 ${k} 之案 ${x.id} 之應然未列 ${x.cls}`)
                        cs.expect = { [x.cls]: cs.expect[x.cls] }
                    }
                    const r = wfJudge(id, cs, x.reply)
                    assert.equal(r.cls, x.cls, `${id} 反例 ${k}（案 ${x.id}：${x.note}）判為 ${r.cls}${r.problem ? `（無裁決：${r.problem}）` : ''}`)
                }
                for (const p of WF_PREDS[id].filter((x) => !(WF_NEG_UNFALSIFIABLE[id] || []).includes(x))) {
                    const hits = WF_NEG[id].filter((x) => x.cls === p)
                    assert.ok(hits.length >= 2 && new Set(hits.map((x) => x.id)).size >= 2, `${id} 之謂詞 ${p} 反例 ${hits.length} 份、${new Set(hits.map((x) => x.id)).size} 案`)
                }
                assert.ok(WF_NEG[id].some((x) => x.note.startsWith('只差一處')), `${id} 須有「只差一處」之反例`)
            }
            assert.deepEqual(Object.keys(WF_NEG), WF_IDS, '八角色皆有反例')
        })

        it('修訂之 notWorse 不可證偽(故不列反例):使問題增加之補丁(改寫加入出處所無之數字、新增未達標之操作)被正式之補丁守門擋下、保留原稿——notWorse 仍成立,不成立者為 blockedNone', () => {
            const r = wfCase('wf-revise', 'r03')
            const worse = { edits: [WF_DEMO.r03.edits[0], { ref: 'a1_1', fields: { text: '每次澆水量以盆底流出少量水為度，並靜置 40 分鐘' } }] }
            assert.equal(wfJudge('wf-revise', { ...r, expect: { notWorse: true } }, worse).cls, 'ok', '問題數不增')
            assert.equal(wfJudge('wf-revise', r, worse).cls, 'blockedNone', '增加問題之改寫被守門擋下（log 不成立）')
            const add = { op: 'add', kind: 'rule', text: '盆栽澆水後須放在通風處至少 5 小時', conditions: ['某園藝社之建議'], critique: '出處未載', pros: ['出處未載'], cons: ['出處未載'], sources: ['N1'] }
            const worse2 = { edits: WF_DEMO.r03.edits, adds: [{ ...add, issue: 0 }] }
            assert.equal(wfJudge('wf-revise', { ...r, expect: { notWorse: true } }, worse2).cls, 'ok', '未達標之新增被擋下，問題數不增')
            assert.equal(wfJudge('wf-revise', r, worse2).cls, 'blockedNone')
        })

        it('錯誤回覆經 runExtractBench:判錯之案逐回列原因、他案照常;同一模型兩回不一致不通過', async () => {
            const cases = SET['synonym-check'].cases.slice(0, 3)
            let n = 0
            const ai = wkfStub({ plan: { 'synonym-check': { cases } }, reply: { 'synonym-check': (cs) => ({ checks: cs.map((c, j) => ({ index: j + 1, verdict: j === 0 && n++ === 1 ? 'different' : c.expect.verdict, reason: WHY })) }) } })
            const r = await runExtractBench('synonym-check', { models: ['m1'], runs: 2, aiAdapter: ai, cases })
            const cs = r.models[0].cases
            assert.equal(cs[0].pass, false)
            assert.match(cs[0].note, /^第 2 回判 (different|same)（[^）]+），應然 (same|different)；各回不一致$/)
            assert.ok(cs.slice(1).every((x) => x.pass))
        })
    })

    // ══════════════════════════ ⑤命令列與受測名單 ══════════════════════════
    describe('⑤ 命令列與受測名單', function() {

        it('--role 解析與用法說明(核心之多角色命令列＋本套件之 --lang);--role all 依序十四角色、評比表十四角色之列並存;cli.mjs 為薄殼', async () => {
            const a = parseExtractBenchArgs(['--role=dispute-check', '--batch', '4', '--lang', 'en'])
            assert.deepEqual([a.role, a.roles.map((r) => r.id), a.rest, a.lang], ['dispute-check', ['dispute-check'], ['--batch', '4'], 'en'])
            assert.match(msgOf(() => parseExtractBenchArgs(['--role', 'nope'])), new RegExp(`不認得之評分角色：nope（可用：${ROLE_IDS.join('、')}、all）`))
            assert.match(msgOf(() => parseExtractBenchArgs(['--batch', '4'])), /--role all 不可給角色專屬參數 --batch/)
            assert.match(msgOf(() => parseExtractBenchArgs(['--lang'])), /--lang 缺值/)
            assert.match(msgOf(() => parseExtractBenchArgs(['--lang', 'en', '--lang=zh-TW'])), /--lang 重複給定/)
            for (const r of EXTRACT_BENCH_ROLES) assert.ok(EXTRACT_BENCH_USAGE.includes(`【${r.name}】`), r.id)
            assert.match(EXTRACT_BENCH_USAGE, /以 pickExtractVocab 取本套件之鍵/)
            assert.match(EXTRACT_BENCH_USAGE, /--lang <語言代碼>/)
            const out = path.join(TMP, 'all')
            const ai = wkfStub()
            const r = await runExtractBenchCli(['--models', 'm1', '--runs', '1', '--out', out, '--board', path.join(out, 'board.csv')], { aiAdapter: ai, log: plainLog() })
            assert.deepEqual(r.runs.map((x) => x.role), ROLE_IDS)
            assert.ok(r.runs.every((x) => x.result.models[0].score.pass === x.result.models[0].score.total), '示範回覆皆通過')
            const board = fs.readFileSync(path.join(out, 'board.csv'), 'utf8')
            assert.ok(board.startsWith(`﻿${BENCH_BOARD_HEADER.join(',')}`) || board.startsWith(BENCH_BOARD_HEADER.join(',')), '評比表表頭同核心')
            for (const role of EXTRACT_BENCH_ROLES) assert.ok(board.includes(role.name), role.id)
            assert.equal((board.match(/〔結構合規〕/g) || []).length, 4, '第二批四角色之列標「結構合規」')
            assert.equal(cli.runExtractBenchCli, runExtractBenchCli)
            assert.equal(cli.default, runExtractBenchCli)
            const help = await runExtractBenchCli(['--help'], { log: plainLog() })
            assert.deepEqual(help, { help: true })
            // README §15 之角色表與角色定義同步(角色 id 只寫在定義一處;表須列出全部角色且不列多餘者)
            const readme = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8')
            const sec = readme.slice(readme.indexOf('## 15.'), readme.indexOf('## 16.'))
            const listed = [...sec.matchAll(/^\| `([a-z][a-z0-9-]*)` /gm)].map((m) => m[1])
            assert.deepEqual(listed, ROLE_IDS, 'README §15 之角色表＝EXTRACT_BENCH_ROLE_IDS(依序)')
            assert.match(sec, new RegExp(`## 15\\. 免費 AI 能力評分\\(${ROLE_IDS.length === 14 ? '十四' : ROLE_IDS.length}角色`))
        })

        it('印出之命令列用法與題組路徑為套件佈局下實際可用之路徑(node src/bench/cli.mjs、src/bench/cases/…):各角色 cli.command 之腳本與 cli.casesHelp 之題組於套件根存在;直接執行 --help 之首行、各角色用法行、題組路徑與失敗時之錯誤訊息皆指向同一佈局', () => {
            // 規則:套件原始碼在 src/,命令列為 src/bench/cli.mjs、內建題組為 src/bench/cases/<角色 id>-generic.json;用法字串不得仍印佈局改動前之 node bench/cli.mjs 與 bench/cases/(該路徑於套件根不存在)
            for (const r of EXTRACT_BENCH_ROLES) {
                const m = r.cli.command.match(/^node (\S+\.mjs) --role (\S+)$/)
                assert.ok(m, `${r.id} 之 command 形狀:${r.cli.command}`)
                assert.deepEqual([m[1], m[2]], ['src/bench/cli.mjs', r.id])
                assert.ok(fs.existsSync(path.join(PKG, m[1])), `${r.id} 之 command 所指腳本須存在:${m[1]}`)
                const c = r.cli.casesHelp.match(/\((src\/bench\/cases\/\S+\.json)\)$/)
                assert.ok(c, `${r.id} 之 casesHelp 須以(src/bench/cases/…json)結尾:${r.cli.casesHelp}`)
                assert.equal(c[1], `src/bench/cases/${r.id}-generic.json`)
                assert.ok(fs.existsSync(path.join(PKG, c[1])), `${r.id} 之 casesHelp 所指題組須存在:${c[1]}`)
            }
            const cwd = path.join(TMP, 'cli-spawn')
            fs.mkdirSync(cwd, { recursive: true })
            const run = (args) => spawnSync(process.execPath, [path.join(PKG, 'src', 'bench', 'cli.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 60_000 })
            const help = run(['--help'])
            assert.equal(help.status, 0)
            assert.ok(help.stdout.startsWith('用法：node src/bench/cli.mjs [--role <support-check|'), `--help 首行須為 node src/bench/cli.mjs:${help.stdout.split('\n')[0].slice(0, 80)}`)
            for (const r of EXTRACT_BENCH_ROLES) {
                assert.ok(help.stdout.includes(`node src/bench/cli.mjs --role ${r.id}`), `--help 須印 ${r.id} 之用法`)
                assert.ok(help.stdout.includes(`(src/bench/cases/${r.id}-generic.json)`), `--help 須印 ${r.id} 之內建題組路徑`)
            }
            assert.ok(!/node bench\/cli\.mjs/.test(help.stdout), '--help 之首行與各角色用法不得仍印 node bench/cli.mjs')
            assert.ok(!/[(\s]bench\/cases\//.test(help.stdout), '--help 之題組路徑不得仍印 bench/cases/(缺 src/)')
            const bad = run(['--role', 'nope'])
            assert.equal(bad.status, 1)
            assert.ok(bad.stderr.includes('提煉 AI 能力評分失敗：不認得之評分角色：nope'), bad.stderr)
            assert.ok(bad.stderr.includes('（用法：node src/bench/cli.mjs --help）'), bad.stderr)
        })

        it('--lang／opt.lang:語言設定同正式(createExtractDomain 之 locale):提示詞之輸出語言句隨之改變;不合之代碼即拋;未給＝正式之預設(提示詞與不給 lang 同)', async () => {
            const en = resolveLocale('en')
            const pEn = planExtractBench('synonym-check', { lang: 'en' })
            const pDef = planExtractBench('synonym-check')
            assert.notEqual(pEn.promptFp, pDef.promptFp)
            assert.ok(pEn.pages[0].prompt.includes(en.label), '輸出語言之稱呼')
            assert.equal(planExtractBench('synonym-check', { lang: 'zh-TW' }).promptFp, pDef.promptFp, '預設即 zh-TW')
            assert.match(msgOf(() => planExtractBench('synonym-check', { lang: '!!' })), /planExtractBench\(synonym-check\) 之 opt\.lang/)
            const out = path.join(TMP, 'lang')
            const r = await runExtractBenchCli(['--role', 'synonym-check', '--lang', 'en', '--models', 'm1', '--runs', '1', '--out', out], { aiAdapter: wkfStub({ plan: { 'synonym-check': { lang: 'en' } } }), log: plainLog() })
            assert.equal(r.runs[0].result.meta.promptFp, pEn.promptFp, '命令列之 --lang 同 opt.lang')
        })

        it('受測名單:預設起草三席(extract.ai.drafters 之 use 與 fallback)在前,其餘為核心之免費名單(去重);十四角色皆以之為預設', () => {
            const head = [...new Set(EXTRACT_DEFAULT.ai.drafters.flatMap((s) => [s.use, ...s.fallback]))]
            assert.deepEqual(EXTRACT_BENCH_MODELS.slice(0, head.length), head)
            assert.deepEqual(EXTRACT_BENCH_MODELS, [...new Set([...head, ...DEFAULT_FREE_MODELS])])
            for (const r of EXTRACT_BENCH_ROLES) assert.deepEqual([...r.models], EXTRACT_BENCH_MODELS, r.id)
        })

        it('套件根之 模型評比.csv(--board 之看板;隨包發布):含 BOM、表頭同核心之評比表(併入時表頭不同即拒寫)、已寫入之列之角色皆為本套件之角色', () => {
            // 規則:看板表頭只在核心 BENCH_BOARD_HEADER 一份;角色欄＝角色定義之 name(第二批帶〔結構合規〕);與關聯套件之同名案同判準
            const text = fs.readFileSync(path.join(PKG, '模型評比.csv'), 'utf8')
            assert.equal(text.charCodeAt(0), 0xFEFF, '含 BOM(試算表軟體以之判 UTF-8)')
            const [head, ...rest] = text.slice(1).split(/\r?\n/).filter(Boolean)
            assert.equal(head, BENCH_BOARD_HEADER.join(','))
            const names = EXTRACT_BENCH_ROLES.map((x) => x.name)
            for (const row of rest) assert.ok(names.includes(row.slice(0, row.indexOf(','))), row.slice(0, 60))
        })
    })

    // ══════════════════════════ ⑥領域中立與 esCases 之共用件 ══════════════════════════
    describe('⑥ 領域中立與 esCases', function() {

        it('bench/ 之全部檔(十四份題組與評分原始碼;走訪而不手列,含註解)不含量化／金融詞與網址;題組之建構件 standards/esCases.mjs 不含網址(其領域詞由 unit-extract-package ⑤ 掃)', () => {
            // 走訪取抓取套件之共用件 sourceFilesOf(全部副檔名;略 node_modules)
            const files = sourceFilesOf(path.join(PKG, 'src/bench'), { ext: '' }).map((f) => path.join(PKG, 'src/bench', f))
            const rel = files.map((f) => path.relative(PKG, f).replace(/\\/g, '/'))
            assert.ok(['src/bench/extractBench.mjs', 'src/bench/cli.mjs',...Object.values(EXTRACT_BENCH_CASES_FILES).map((f) => path.relative(PKG, f).replace(/\\/g, '/'))].every((f) => rel.includes(f)), `走訪須含題組與評分原始碼:${rel.join('、')}`)
            for (const f of files) {
                const t = fs.readFileSync(f, 'utf8')
                assert.deepEqual(domainTermsIn(t), [], path.basename(f))
                assert.equal(/https?:\/\//.test(t), false, `${path.basename(f)} 不含網址`)
            }
            assert.equal(/https?:\/\//.test(fs.readFileSync(path.join(PKG, 'src/standards/esCases.mjs'), 'utf8')), false, 'esCases.mjs 不含網址')
        })

        it('coreStateOf:精簡之描述補齊正式條目之全部欄位、依集合序配發 id、編號計數接最大號、消化之筆記預設為被引之出處;不變式自檢;id 重複列為問題', () => {
            const x = coreStateOf({ claims: [{ text: '甲', sources: ['n1'] }, { id: 'C5', text: '乙', sources: ['n2'], kind: 'pitfall', conditions: ['某條件'] }], disputes: [{ question: '丙', sides: [{ position: '一方', sources: ['n1'] }, { position: '他方', claims: ['C1'], sources: ['n2'] }], doubt: { reason: '非對立', note: '說明' } }], parameters: [{ name: '某值', value: '3', claim: 'C1', sources: ['n1'], conditions: ['甲', '乙'] }] })
            assert.deepEqual(x.problems, [])
            assert.deepEqual([x.state.claims.map((c) => c.id), x.state.disputes[0].id, x.state.parameters[0].id], [['C1', 'C5'], 'D1', 'P1'])
            assert.deepEqual(x.state.nextId, { C: 6, D: 2, P: 2, Q: 1 })
            assert.deepEqual(x.state.consumed, ['n1', 'n2'])
            assert.deepEqual([x.state.claims[0].kind, x.state.claims[0].status, x.state.version, x.state.parameters[0].conditions, x.state.disputes[0].doubt.count], ['principle', 'active', 1, '甲；乙', 1])
            assert.deepEqual(coreStateOf({}).state, { ...coreStateOf({}).state, version: 0, claims: [], consumed: [] }, '空描述＝空狀態')
            assert.match(coreStateOf({ claims: [{ id: 'C1', text: '甲' }, { id: 'C1', text: '乙' }] }).problems.join('；'), /條目 id 重複：C1/)
            const stale = coreStateOf({ claims: [{ id: 'C1', text: '甲', sources: ['n1'], status: 'retracted', retractReason: '離題', statusNote: '與題組無關' }, { id: 'C2', text: '乙', sources: ['n1'] }], essence: { text: '本質', claims: ['C2'], stale: { from: 'C1' } } })
            assert.deepEqual([stale.problems, essenceNeedOf(stale.state).need], [[], 'stale'], '本質待重寫之標記(同正式之持久 essence.stale)')
            assert.match(coreStateOf({ claims: 'x' }).problems.join('；'), /claims 須為陣列/)
        })

        it('disputeCaseOf:題組之爭議建成合成之核心狀態(經 coreStateOf),正式之去處(dissolveSidesOf)與題組之 toClaim 相符;不符者(另立主張之方引主張、不另立之方未引主張)列為問題', () => {
            const ok = disputeCaseOf(es14('a').input)
            assert.deepEqual([ok.problems, ok.item.sides.map((sd) => sd.toClaim)], [[], [true, true]])
            const side0 = { position: '甲方', toClaim: false, claims: [{ id: 'C1', text: '甲之主張' }], sources: [{ id: 't1', title: 'T', text: '甲' }] }
            assert.deepEqual(disputeCaseOf({ ...es14('b').input, sides: [side0, es14('b').input.sides[1]] }).item.sides.map((sd) => sd.toClaim), [false, true])
            assert.match(disputeCaseOf({ ...es14('c').input, sides: [{ ...side0, toClaim: true }, es14('c').input.sides[1]] }).problems.join('；'), /side 0 引主張而 toClaim 非 false/)
            assert.equal(dissolveUsableOf({ verdict: 'not-opposed', reason: WHY, ...dissolveFieldsOf(es14('d').input.sides) }, es14('d').input, D).ok, true)
            assert.equal(dissolveUsableOf({ verdict: 'not-opposed', reason: WHY, ...dissolveFieldsOf(es14('d').input.sides) }, es14('d').input, D, { locale: resolveLocale('en') }).ok, true, '語言設定交操作守門')
        })

        it('reviseCaseOf:原操作(新增主張／爭議之一方)、受檢項與正式之 fieldsOf;閘＝守門＋納入閘(新增主張另驗套用不被拒收);覆核說明＝votes 經正式之 notSupportedReasonsOf', () => {
            const a = reviseCaseOf(rev('a').input, D)
            assert.deepEqual([a.op.op, a.it.kind, a.fields], ['add', 'add', { text: '晨讀可提高閱讀能力', conditions: [], period: '' }])
            assert.equal(a.gate(a.op).ok, true)
            assert.equal(a.gate({ ...a.op, kind: 'law' }).ok, false, '種類不在清單 → 套用拒收')
            assert.match(a.gate({ ...a.op, kind: 'law' }).why.join(''), /套用拒收/)
            const s = reviseCaseOf({ kind: 'side', text: '甲方立場', conditions: ['某條件'], sources: [{ id: 'x', title: 'X', text: '甲方立場之內容' }] }, D)
            assert.deepEqual([s.op.op, s.it.key, s.fields], ['dispute_add', '0:side0', { text: '甲方立場', conditions: ['某條件'], period: '' }])
            assert.equal(s.gate(s.op).ok, true)
            assert.match(s.gate({ ...s.op, sides: [{ ...s.op.sides[0], position: '依審計意見修改之立場' }] }).why.join(''), /外洩/)
            assert.deepEqual(reviseReasonsOf(rev('a').input.votes), ['語氣超出證據：出處只涵蓋某小學三年級'])
        })
    })
})
