// relateForTest.mjs — 測試專用之關聯橋接(只供測試;套件程式碼不得 import 本檔——邊界檢查只許本檔與 core/relatePackage.mjs 引用關聯套件,
//   且非測試檔一律不得引用 test/ 下之檔)
//
// 【為何需要】關聯 → 提煉之介面(邊之組成與 id、邊之撤出、關聯之帳之開啟、衝突事件之寫入、明示刪除之帳檔、筆記之明示刪除與其撤銷、筆記 md 之投影)
//   須以關聯套件之真實件造出關聯之產物,驗提煉之讀法與之一致;這些件是關聯之積木,本套件之程式碼用不到,故不列入關聯埠
//   (core/relatePackage.mjs 只列套件程式碼所需之名)。
// 【只轉出測試所需之名】新增前先確認關聯埠沒有、且確為測試所需(關聯埠已有者——如關聯之型別定義與其詞彙之子集——測試經埠取用);每一名須被本套件
//   test/ 下至少一檔具名匯入(本套件尚無自動守門案守橋接之死轉出,新增時人工確認)。
// 【寫入筆記與邊之測試件】seedNotes(筆記記錄與關聯之邊寫入集合)在關聯套件之 test/tools/relateTestKit(關聯、提煉同一份),經本檔取用。
// 【指定詞】關聯套件為 npm 套件:主入口 'w-knowledge-relate/src/WKnowledgeRelate.mjs'(同關聯埠)、測試件 'w-knowledge-relate/test/tools/<檔>'(隨其 npm 包發布)。

export {
    makeEdge, retireEdge, openRelateLedgers, appendConflictEvent, DELETION_FILES, deleteNote, undoDeleteNote, projectNotes,
} from 'w-knowledge-relate/src/WKnowledgeRelate.mjs'
export { seedNotes } from 'w-knowledge-relate/test/tools/relateTestKit.mjs'
