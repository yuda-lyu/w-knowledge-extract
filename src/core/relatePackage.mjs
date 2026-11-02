// relatePackage.mjs — 關聯套件(npm 套件 w-knowledge-relate)之單一匯入點
//
// 【為何單一匯入點】本套件除抓取、摘要、關聯三套件外不 import 任何其他專案程式碼;取關聯套件之件一律經本檔——關聯套件之指定詞只在本檔
//   ('w-knowledge-relate/src/WKnowledgeRelate.mjs';同抓取埠之說明)。
// 【明列名稱＝關聯埠】本套件依賴關聯套件之哪些件一目瞭然;新增依賴先列於此,不在他檔直接 import 關聯套件。只列套件程式碼所需之名
//   (測試另需者經測試專用之橋接 test/tools/relateForTest.mjs)。
// 【關聯之知識只在關聯套件】筆記是否已關聯之判定、筆記上關聯投影之章名、被撤出之邊與明示刪除之帳、衝突事件之帳、撤出稽核之帳、
//   衝突核對之待判交接、關聯之型別定義(衝突型、型別改名之對照)與其詞彙鍵之驗證——本套件只讀關聯之產物、只呼叫其 API,不另寫一份
//   (讀關聯之帳或邊之型別前先找關聯套件之 API)。
// 【核心件同一實作】檢核紀錄(checks 集合之鍵、到期判準與寫入、符合度掃描之 AI 標準列)、掃描之材料讀取器取自關聯套件;本套件之 core/ 不得與其 core/
//   有同相對路徑之模組(本檔為各套件各自之匯入點,不在此限)。

export {
    // ── ① 筆記之關聯判定、關聯投影之章名 ──
    isRelated, RELATE_SECTION_TITLES,
    // ── ② 關聯之帳之讀法(被撤出之邊、明示刪除、衝突事件、撤出稽核)與衝突核對之待判交接;JSON 帳之讀法(缺檔／壞檔分流、錯形狀＝壞檔、隔離或唯讀——
    //   持久檔語意之共用件,最低使用者為關聯;本套件之 JSON 帳〔stores/extractFiles〕同讀此一份,不另寫分流)──
    retiredEdgesOf, openDeletions, readConflictEvents, readEdgeAudit, RS4, queueConflictCheck, loadLedgerJson,
    // ── ③ 關聯之型別定義(獨立組裝時自建;所交 domain 之成員缺漏之判定)與其詞彙鍵(自有之鍵集)之子集與解析 ──
    createRelateDomain, relateDomainNeedsOf, pickRelateVocab, resolveRelateVocab, RELATE_VOCAB_OWN_KEYS,
    // ── ④ 檢核紀錄(鍵、到期、寫入;符合度掃描之 AI 標準列)、掃描之材料讀取器(三來源與快取之規則一份;材料之文字由本套件注入)──
    checkKey, needsCheck, recordCheck, aiStandardRowOf, createMaterialReader,
} from 'w-knowledge-relate/src/WKnowledgeRelate.mjs'
