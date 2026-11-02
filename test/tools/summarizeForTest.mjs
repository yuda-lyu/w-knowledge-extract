// summarizeForTest.mjs — 測試專用之摘要橋接(只供測試;套件程式碼不得 import 本檔——邊界檢查只許本檔與 core/summarizePackage.mjs 引用摘要套件,
//   且非測試檔一律不得引用 test/ 下之檔)
//
// 【為何需要】摘要 → 提煉之介面(筆記組裝寫出之 md 與記錄、筆記之版型、證據規則之編譯、摘要不算內容章之章名、
//   筆記之內容同步——讀下游之處理時刻 extractedAt)須以摘要套件之真實件驗兩側讀寫之欄位一致;這些件是摘要之積木,本套件之程式碼用不到,
//   故不列入摘要埠(core/summarizePackage.mjs 只列套件程式碼所需之名)。
// 【只轉出測試所需之名】新增前先確認摘要埠沒有、且確為測試所需(摘要埠已有者——如摘要詞彙之解析——測試經埠取用);每一名須被本套件 test/ 下
//   至少一檔具名取用(本套件尚無自動守門案守橋接之死轉出,新增時人工確認)。摘要埠只列套件程式碼所需之名(unit-extract-package ① 自動驗),故摘要詞彙之斷言等
//   只供測試之名經本檔。
// 【筆記與證據規則之測試件】落筆記之工廠(landNoteOf;以摘要之真實組裝寫 md 與記錄)與測試用之證據規則(QUANT_RULE)在摘要套件之 test/tools
//   (noteKit、quantRule;關聯、提煉同一份),經本檔取用。
// 【指定詞】摘要套件為 npm 套件:主入口 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'(同摘要埠)、測試件 'w-knowledge-summarize/test/tools/<檔>'(隨其 tarball 發布)。

export {
    createSummarizeDomain, NON_CONTENT_SECTIONS, syncNotes, assertSummarizeVocab,
} from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'
export { landNoteOf } from 'w-knowledge-summarize/test/tools/noteKit.mjs'
export { QUANT_RULE } from 'w-knowledge-summarize/test/tools/quantRule.mjs'
