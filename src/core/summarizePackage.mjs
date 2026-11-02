// summarizePackage.mjs — 摘要套件(npm 套件 w-knowledge-summarize)之單一匯入點
//
// 【為何單一匯入點】本套件除抓取、摘要、關聯三套件外不 import 任何其他專案程式碼;取摘要套件之件一律經本檔——摘要套件之指定詞只在本檔
//   ('w-knowledge-summarize/src/WKnowledgeSummarize.mjs';同抓取埠之說明)。
// 【明列名稱＝摘要埠】本套件依賴摘要套件之哪些件一目瞭然;新增依賴先列於此,不在他檔直接 import 摘要套件。只列套件程式碼所需之名
//   (測試另需者經測試專用之橋接 test/tools/summarizeForTest.mjs;unit-extract-package ① 驗每一名皆有非測試檔取用)。
// 【摘要之知識只在摘要套件】筆記 md 之讀寫與章節、內容章之材料、原文之發布時間與證據說明之讀法、筆記欄位之缺值字樣、摘要之詞彙鍵
//   (分類、清單外分類之落點、內容類型、證據等級、最高證據等級之要件)之驗證、caveats 之讀法與「自承無最高證據等級之要件」之判定——
//   本套件只讀摘要之產物、只呼叫其 API,不另寫一份(讀筆記之版型前先找摘要套件之 API)。
// 【核心件同一實作】判定小組(單頁執行器與其裁定字樣、設定面;裁定規則由執行器套用)、數字紮根取自摘要套件(待判登錄與提示詞覆寫之驗證屬
//   抓取套件,經抓取埠);本套件之 core/ 不得與其 core/ 有同相對路徑之模組(本檔為各套件各自之匯入點,不在此限)。

export {
    // ── ① 筆記 md:讀寫、章節 ──
    readMd, writeMd, mdText, sectionOf, dropSection,
    // ── ② 筆記之內容章材料、原文之發布時間、證據說明;版型之章名(分節摘要之章取之,不另寫字面)──
    noteMaterialText, publishedOf, evidenceNoteOf, NOTE_SECTION_TITLES,
    // ── ④ 判定小組(裁定字樣、未成立原因之字樣表、席位、單頁執行器;設定面:席位之 schema、小組之組成、同家之警告、席位表之列)──
    PANEL_UNSURE, PANEL_WHY, PANEL_WHY_LABELS, panelSeats, runPanelPage,
    PANEL_SCHEMA, panelGroupOf, panelSameProviderWarnings, panelSeatRowsOf,
    // ── ⑤ 數字紮根 ──
    numberSet, ungroundedNumbers, outputNumbers,
    // ── ⑥ 摘要之產物之契約(筆記欄位之缺值字樣)──
    NOTE_PLACEHOLDERS,
    // ── ⑦ 詞彙(摘要之鍵之預設、解析與子集)與證據規則(caveats 之讀法、自承無最高證據等級之要件之判定)──
    resolveSummarizeVocab, pickSummarizeVocab, SUMMARIZE_VOCAB_DEFAULT, evidenceCaveatsOf, noTopEvidenceOf,
    // ── ⑧ AI 調度層之設定段之預設(抓取套件之 ai 段＋健康降序;本套件不讀 parallel)、筆記進料上界之形狀(容量警告 extractWarningsOf 之 inflow 之判準)──
    SUMMARIZE_AI_DEFAULT, notesInflowProblem,
} from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'
