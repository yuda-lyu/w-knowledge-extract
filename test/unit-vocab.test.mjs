// unit-vocab.test.mjs — 提煉之詞彙表(core/vocab/extractVocab):預設(領域中立)、只認本套件之鍵、借用之鍵交擁有者驗(訊息即擁有者者)、
//   自有之鍵之逐條驗證(含推定詞)、guide.extract 之逐欄回退與型別、子集擷取、可重複套用(含 JSON 往返)、互不汙染、詞彙之啟動期警告
// 規則(出自 extractVocab 之設計):
//   ①只認 EXTRACT_VOCAB_KEYS(借用:抓取之主題範圍／稱呼／概念改名／別名、摘要之分類清單／落點／內容類型／證據等級／最高證據等級之要件、
//     關聯之型別清單／衝突型／後備型／型別改名／別名／角色;自有:證據封頂、證據性質封頂、推論類、自承限制片語、絕對語氣片語、推定詞;guide);
//     不認得之鍵(含他段之鍵)與 guide 之他段拋錯並列可用鍵——與他段共用一份詞彙表者以 pickExtractVocab 取子集
//   ②借用之鍵各交擁有者之解析(只交該擁有者之鍵),錯誤訊息即擁有者之訊息;分類清單只供驗證(自訂分類清單＋落點可解析且可重複套用)
//   ③自有之鍵依摘要解析後之內容類型與證據等級驗;未給之證據封頂取預設並只留現行內容類型之鍵;推論類未給取預設與證據性質封頂之鍵之交集;
//     推定詞預設 null(不推定),給了須為生效之證據性質封頂之鍵(「*」除外)
//   ④guide 只認 extract 段(10 欄);逐欄回退預設;欄位皆為句中片語(共用型別 estr;非字串、空字串與只含空白皆拋「須為非空字串」,null／undefined 沿用預設;終審 D11)
//   ⑤可重複套用(含 JSON 往返後再解析);各次解析之產物互不共用預設常數之參照(含抓取共用之鍵)
//   ⑥詞彙之啟動期警告:自訂內容類型而未給證據封頂、且預設封頂表無一鍵對得上 → 一條警告
// 執行:自套件根 node <mocha> test/unit-vocab.test.mjs(純函數,不連網、不寫檔)

import assert from 'node:assert/strict'
import {
    EXTRACT_GUIDE_FIELDS, EXTRACT_VOCAB_DEFAULT, EXTRACT_VOCAB_KEYS,
    extractGuideDefaultOf, resolveExtractVocab, pickExtractVocab, extractVocabWarningsOf,
} from '../src/core/vocab/extractVocab.mjs'
import { resolveCaptureVocab } from '../src/core/capturePackage.mjs'
import { resolveSummarizeVocab, SUMMARIZE_VOCAB_DEFAULT, NOTE_PLACEHOLDERS } from '../src/core/summarizePackage.mjs'
import { assertSummarizeVocab, QUANT_RULE } from './tools/summarizeForTest.mjs'
import { resolveRelateVocab } from '../src/core/relatePackage.mjs'
import { QUANT_VOCAB, QUANT_BASIS_CAPS } from './tools/quantVocab.mjs'
import { msgOf } from './tools/captureForTest.mjs'

const snap = (v) => JSON.stringify(v)
const R = (o) => resolveExtractVocab(o)

/** 借用之鍵(各擁有者) */
const CAPTURE_KEYS = ['domain', 'kbLabel', 'conceptRenames', 'conceptAliases']
const SUMMARIZE_KEYS = ['categories', 'fallbackCategory', 'claimTypes', 'evidenceLevels', 'evidenceRule']
const RELATE_KEYS = ['relationTypes', 'conflictType', 'fallbackType', 'relationTypeRenames', 'relationTypeAliases', 'relationTypeRoles']
const OWN_KEYS = ['evidenceCaps', 'basisCaps', 'inferenceBasis', 'selfLimitPhrases', 'absolutePhrases', 'presumedBasis']

/** 自有之鍵之預設(期望值;領域中立,寫死於本檔) */
const EXPECTED_OWN = {
    evidenceCaps: { 理論模型: 1, 實務經驗: -1, 教學示範: -1, 觀點評論: -1, 廠商內容: -1, 未標注: 1 },
    basisCaps: { 獨立驗證: 0, 單一研究: 1, 理論: 1, 模擬: 1, 案例: 1, 實務: -1, 教學: -1, 觀點: -1, 廠商: -1, 轉述: -1, '*': 1 },
    inferenceBasis: ['理論'],
    selfLimitPhrases: ['單一研究', '同一研究', '僅摘要', '未經獨立驗證', '未經驗證'],
    absolutePhrases: ['一定會', '一定能', '一定是', '必然', '必定', '總是', '永遠', '絕對會', '絕對是', '保證會', '保證能', '毫無例外', '無一例外', '無疑', '百分之百'],
    presumedBasis: null,
}
const GUIDE_DEFAULT = {
    extract: {
        ruleTarget: '可直接應用的操作規則',
        weakEvidence: '僅單一研究或未經獨立驗證',
        temporal: '這個概念的有效性如何隨時間、環境條件或機制（regime）改變；\n   利與弊在什麼條件下會反轉。原文有依據才寫。',
        narrowScope: '單一樣本、特定對象或期間、有前提條件',
        broadScope: '更多對象、期間或情境',
        reviseScope: '樣本、對象或期間',
        opposedObjects: '研究對象、族群、樣本',
        sameExample: '「網際網路」與「互聯網」',
        subtopicExample: '「排序」與「快速排序」',
        siblingExample: '「記憶體管理」與「行程排程」',
    },
}
/** guide.extract 之欄位(依欄位表之序) */
const GUIDE_FIELDS = ['ruleTarget', 'weakEvidence', 'temporal', 'narrowScope', 'broadScope', 'reviseScope', 'opposedObjects', 'sameExample', 'subtopicExample', 'siblingExample']

describe('unit-vocab', function() {

    describe('① 預設與鍵集', function() {

        it('可用鍵:借用抓取(鍵集取自抓取套件)、摘要、關聯之鍵＋自有之鍵＋guide;借用之鍵皆為擁有者所定義(關聯者恰為其自有之鍵)', () => {
            assert.deepEqual(Object.keys(resolveCaptureVocab({})), CAPTURE_KEYS)
            assert.deepEqual([...EXTRACT_VOCAB_KEYS], [...CAPTURE_KEYS, ...SUMMARIZE_KEYS, ...RELATE_KEYS, ...OWN_KEYS, 'guide'])
            assert.ok(Object.isFrozen(EXTRACT_VOCAB_KEYS))
            for (const k of SUMMARIZE_KEYS) assert.ok(k in SUMMARIZE_VOCAB_DEFAULT, `摘要套件定義 ${k}`)
            const relateOwn = Object.keys(resolveRelateVocab({})).filter((k) => !CAPTURE_KEYS.includes(k) && k !== 'guide')
            assert.deepEqual(relateOwn, RELATE_KEYS, '關聯套件之自有之鍵＝本套件借用者(新增者須決定是否借用)')
        })

        it('預設(領域中立):自有之鍵與 guide.extract(值與鍵序);證據封頂之缺值字樣之鍵取自摘要套件', () => {
            assert.deepEqual(Object.keys(EXTRACT_VOCAB_DEFAULT), [...OWN_KEYS, 'guide'])
            for (const k of OWN_KEYS) assert.deepEqual(EXTRACT_VOCAB_DEFAULT[k], EXPECTED_OWN[k], k)
            assert.deepEqual(Object.keys(EXTRACT_VOCAB_DEFAULT.basisCaps), Object.keys(EXPECTED_OWN.basisCaps))
            assert.equal(NOTE_PLACEHOLDERS.claimType, '未標注')
            assert.deepEqual(EXTRACT_VOCAB_DEFAULT.guide, GUIDE_DEFAULT)
            assert.deepEqual(extractGuideDefaultOf(), GUIDE_DEFAULT)
            assert.notEqual(extractGuideDefaultOf(), extractGuideDefaultOf(), '每次回傳新物件')
        })

        it('零設定之解析:依可用鍵之序含全部鍵;借用之鍵＝擁有者之預設;證據規則為已編譯(交摘要之函數即通過);非物件視為全用預設', () => {
            const sv = resolveSummarizeVocab({})
            const rv = resolveRelateVocab({})
            for (const v of [R(), R({}), R(null), R('x')]) {
                assert.deepEqual(Object.keys(v), [...EXTRACT_VOCAB_KEYS])
                for (const k of CAPTURE_KEYS) assert.deepEqual(v[k], resolveCaptureVocab({})[k], k)
                for (const k of SUMMARIZE_KEYS) assert.equal(snap(v[k]), snap(sv[k]), k)
                for (const k of RELATE_KEYS) assert.deepEqual(v[k], rv[k], k)
                for (const k of OWN_KEYS) assert.deepEqual(v[k], EXPECTED_OWN[k], k)
                assert.deepEqual(v.guide, GUIDE_DEFAULT)
                assert.equal(assertSummarizeVocab(v), v)
                assert.equal(v.evidenceRule.enabled, false, '預設不啟用最高證據等級之要件')
            }
        })

        it('不認得之鍵 → 拋並列全部可用鍵(他段之鍵亦拒收,以 pickExtractVocab 取子集;值為 undefined 之鍵亦檢)', () => {
            const m = (k) => `vocab 含不認得之鍵：${k}（可用：${EXTRACT_VOCAB_KEYS.join('、')}）`
            assert.equal(msgOf(() => R({ categoryRenames: {} })), m('categoryRenames'), '摘要之鍵而本套件不讀者')
            assert.equal(msgOf(() => R({ basisCap: {}, presumed: 'x' })), m('basisCap、presumed'))
            assert.equal(msgOf(() => R({ evidenceCapz: undefined })), m('evidenceCapz'))
        })
    })

    describe('② 借用之鍵交擁有者驗', function() {

        it('不合規則 → 拋擁有者之訊息(抓取:稱呼、概念對照;摘要:清單、落點、證據規則;關聯:型別清單、衝突型、角色、別名)', () => {
            const owners = [
                [resolveCaptureVocab, [{ kbLabel: 5 }, { conceptRenames: [] }, { conceptAliases: { a: '' } }]],
                [resolveSummarizeVocab, [{ claimTypes: [] }, { evidenceLevels: 'x' }, { categories: ['甲'] }, { fallbackCategory: '不存在' }, { evidenceRule: { subject: 'x' } }]],
                [resolveRelateVocab, [{ relationTypes: [] }, { conflictType: '不存在' }, { relationTypeRoles: { cousin: '延伸深化' } }, { relationTypeAliases: { 互補搭配: '衝突或反例' } }]],
            ]
            for (const [owner, cases] of owners) {
                for (const o of cases) {
                    const want = msgOf(() => owner(o))
                    assert.ok(want, `前提:擁有者拒收 ${JSON.stringify(o)}`)
                    assert.equal(msgOf(() => R(o)), want, JSON.stringify(o))
                }
            }
        })

        it('合法值原樣帶入:抓取共用之鍵、內容類型與證據等級、關聯型別清單與衝突型;型別角色由關聯套件推導', () => {
            const v = R({ domain: '天文學', kbLabel: '星空知識庫', conceptRenames: { 黑洞吸積: '吸積盤' }, claimTypes: ['觀測報告', '理論推導'], evidenceLevels: ['強', '弱'], relationTypes: ['前提', '延伸深化', '衝突'], conflictType: '衝突', fallbackType: '前提' })
            assert.deepEqual([v.domain, v.kbLabel, v.conceptRenames], ['天文學', '星空知識庫', { 黑洞吸積: '吸積盤' }])
            assert.deepEqual([v.claimTypes, v.evidenceLevels], [['觀測報告', '理論推導'], ['強', '弱']])
            assert.deepEqual([v.relationTypes, v.conflictType, v.fallbackType], [['前提', '延伸深化', '衝突'], '衝突', '前提'])
            assert.deepEqual(v.relationTypeRoles, { extension: '延伸深化' })
        })

        it('自訂分類清單(不含預設之落點)＋自訂落點:可解析、產物帶兩者、可重複套用與 JSON 往返;只給清單不給落點 → 拋摘要套件之訊息', () => {
            const v = R({ categories: ['觀測', '理論', '雜項'], fallbackCategory: '雜項' })
            assert.deepEqual([v.categories, v.fallbackCategory], [['觀測', '理論', '雜項'], '雜項'])
            assert.equal(snap(R(v)), snap(v))
            assert.equal(snap(R(JSON.parse(JSON.stringify(v)))), snap(v))
            assert.equal(msgOf(() => R({ categories: ['觀測', '理論'] })), msgOf(() => resolveSummarizeVocab({ categories: ['觀測', '理論'] })))
        })

        it('最高證據等級之要件:交摘要套件編譯,產物可交摘要之函數;JSON 往返(正規形)後再解析相同', () => {
            const v = R({ evidenceRule: QUANT_RULE })
            assert.equal(assertSummarizeVocab(v), v)
            assert.equal(v.evidenceRule.enabled, true)
            assert.equal(snap(v.evidenceRule), snap(resolveSummarizeVocab({ evidenceRule: QUANT_RULE }).evidenceRule))
            const again = R(JSON.parse(JSON.stringify(v)))
            assert.equal(snap(again), snap(v))
            assert.equal(again.evidenceRule.enabled, true)
        })
    })

    describe('③ 自有之鍵:逐條驗證', function() {

        it('證據封頂:明給者鍵須為現行內容類型(或其缺值字樣)、值須為等級名或位置整數;未給者取預設並只留現行內容類型之鍵;null 視為未給', () => {
            const types = [...SUMMARIZE_VOCAB_DEFAULT.claimTypes, '未標注']
            assert.equal(msgOf(() => R({ evidenceCaps: 'x' })), 'vocab.evidenceCaps 須為物件 { 內容類型: 等級名｜位置整數 }')
            assert.equal(msgOf(() => R({ evidenceCaps: { 不存在: 1 } })), `vocab.evidenceCaps 之「不存在」不在 claimTypes（${types.join('、')}）`)
            assert.equal(msgOf(() => R({ evidenceCaps: { 理論模型: '極高' } })), 'vocab.evidenceCaps.理論模型 須為 evidenceLevels 之等級名（高、中、低）或位置整數（-1＝最低）')
            assert.equal(msgOf(() => R({ evidenceCaps: { 理論模型: 1.5 } })), 'vocab.evidenceCaps.理論模型 須為 evidenceLevels 之等級名（高、中、低）或位置整數（-1＝最低）')
            assert.deepEqual(R({ evidenceCaps: { 觀點評論: '低', 未標注: 0 } }).evidenceCaps, { 觀點評論: '低', 未標注: 0 })
            assert.deepEqual(R({ claimTypes: ['論文', '觀點評論'] }).evidenceCaps, { 觀點評論: -1, 未標注: 1 }, '只留現行內容類型之鍵')
            assert.deepEqual(R({ claimTypes: ['論文'] }).evidenceCaps, { 未標注: 1 })
            assert.deepEqual(R({ evidenceCaps: null }).evidenceCaps, EXPECTED_OWN.evidenceCaps)
            assert.deepEqual(R({ evidenceLevels: ['強', '弱'], evidenceCaps: { 觀點評論: '弱' } }).evidenceCaps, { 觀點評論: '弱' }, '等級名依現行證據等級')
        })

        it('證據性質封頂:物件、鍵非空、值為等級名或位置整數;null → 預設;{} 照收(不封頂)', () => {
            assert.equal(msgOf(() => R({ basisCaps: 'x' })), 'vocab.basisCaps 須為物件 { basis 關鍵詞: 等級名｜位置整數, "*": 皆不含時 }')
            assert.equal(msgOf(() => R({ basisCaps: { '': 1 } })), 'vocab.basisCaps 之鍵不可為空字串')
            assert.equal(msgOf(() => R({ basisCaps: { 理論: '極高' } })), 'vocab.basisCaps.理論 須為 evidenceLevels 之等級名（高、中、低）或位置整數（0＝最高、-1＝最低）')
            assert.deepEqual(R({ basisCaps: null }).basisCaps, EXPECTED_OWN.basisCaps)
            assert.deepEqual(R({ basisCaps: {} }).basisCaps, {})
            assert.deepEqual(R({ basisCaps: { 觀測: '高', '*': '中' } }).basisCaps, { 觀測: '高', '*': '中' })
        })

        it('推論類:未給 → 預設與證據性質封頂之鍵之交集(封頂表無鍵時取預設);明給者須為字串陣列且皆為其鍵;[] 照收', () => {
            assert.deepEqual(R({}).inferenceBasis, ['理論'])
            assert.deepEqual(R({ basisCaps: { 觀測: 0, '*': 1 } }).inferenceBasis, [], '自訂封頂表不含預設詞 → 無推論類')
            assert.deepEqual(R({ basisCaps: {} }).inferenceBasis, ['理論'], '封頂表無鍵 → 取預設(不因未給而拋)')
            assert.deepEqual(R({ inferenceBasis: null }).inferenceBasis, ['理論'])
            assert.deepEqual(R({ inferenceBasis: [] }).inferenceBasis, [])
            assert.deepEqual(R({ basisCaps: { 推導: 1, 觀測: 0 }, inferenceBasis: ['推導'] }).inferenceBasis, ['推導'])
            assert.equal(msgOf(() => R({ inferenceBasis: '理論' })), 'vocab.inferenceBasis 須為字串陣列（[] 即一律須出處直接陳述）')
            assert.equal(msgOf(() => R({ inferenceBasis: [1] })), 'vocab.inferenceBasis 須為字串陣列（[] 即一律須出處直接陳述）')
            assert.match(msgOf(() => R({ inferenceBasis: ['不在表內'] })), /^vocab\.inferenceBasis 之「不在表內」不在 basisCaps 之鍵（獨立驗證、/)
        })

        it('推定詞:預設 null(不推定);給了須為生效之 basisCaps 之鍵(「*」除外)——不在其中、空字串、非字串皆拋並列可用鍵;依整鍵替換後之 basisCaps 判', () => {
            const keys = Object.keys(EXPECTED_OWN.basisCaps).filter((k) => k !== '*')
            assert.equal(R({}).presumedBasis, null)
            assert.equal(R({ presumedBasis: null }).presumedBasis, null)
            assert.equal(R({ presumedBasis: '單一研究' }).presumedBasis, '單一研究')
            const m = (v, list = keys) => `vocab.presumedBasis 之「${v}」不在 basisCaps 之鍵（${list.join('、') || '無'}）——推定之標記取 basisCaps 之鍵`
            assert.equal(msgOf(() => R({ presumedBasis: '樣本內' })), m('樣本內'), '中立預設之 basisCaps 無此鍵')
            assert.equal(msgOf(() => R({ presumedBasis: '*' })), m('*'), '「*」不是證據性質')
            assert.equal(msgOf(() => R({ presumedBasis: '單一' })), m('單一'), '須為鍵本身(不以子字串比對)')
            for (const bad of ['', '  ', 5, ['理論'], {}]) assert.equal(msgOf(() => R({ presumedBasis: bad })), 'vocab.presumedBasis 須為非空字串（basisCaps 之鍵）或 null（不推定）', JSON.stringify(bad))
            assert.equal(R({ basisCaps: QUANT_BASIS_CAPS, presumedBasis: '樣本內' }).presumedBasis, '樣本內', '依整鍵替換後之 basisCaps')
            assert.equal(msgOf(() => R({ basisCaps: { 觀測: 0 }, presumedBasis: '理論' })), m('理論', ['觀測']))
            assert.equal(msgOf(() => R({ basisCaps: {}, presumedBasis: '理論' })), m('理論', []), '封頂表無鍵 → 無可用鍵')
        })

        it('自承限制片語與絕對語氣片語:字串陣列(每項非空);null → 預設;[] 照收', () => {
            assert.equal(msgOf(() => R({ selfLimitPhrases: 'x' })), 'vocab.selfLimitPhrases 須為非空字串陣列（[] 即不封頂）')
            assert.equal(msgOf(() => R({ selfLimitPhrases: [''] })), 'vocab.selfLimitPhrases 須為非空字串陣列（[] 即不封頂）')
            assert.equal(msgOf(() => R({ absolutePhrases: {} })), 'vocab.absolutePhrases 須為非空字串陣列（[] 即不計）')
            assert.equal(msgOf(() => R({ absolutePhrases: ['ok', 3] })), 'vocab.absolutePhrases 須為非空字串陣列（[] 即不計）')
            assert.deepEqual([R({ selfLimitPhrases: null }).selfLimitPhrases, R({ absolutePhrases: null }).absolutePhrases], [EXPECTED_OWN.selfLimitPhrases, EXPECTED_OWN.absolutePhrases])
            assert.deepEqual([R({ selfLimitPhrases: [] }).selfLimitPhrases, R({ absolutePhrases: [] }).absolutePhrases], [[], []])
            assert.deepEqual(R({ selfLimitPhrases: ['僅單次觀測'] }).selfLimitPhrases, ['僅單次觀測'], '整鍵替換')
        })
    })

    describe('④ guide.extract:逐欄回退、型別、他段即拋', function() {

        it('欄位表:extract 段 10 欄(皆為句中片語——抓取套件 vocabKit 之共用型別 estr,同關聯之殘句欄;規則之三欄與出處支持覆核、修訂、爭議覆核、同義覆核之領域例七欄)', () => {
            assert.deepEqual(Object.keys(EXTRACT_GUIDE_FIELDS), ['extract'])
            assert.deepEqual(EXTRACT_GUIDE_FIELDS.extract, Object.fromEntries(GUIDE_FIELDS.map((k) => [k, 'estr'])))
            assert.ok(Object.isFrozen(EXTRACT_GUIDE_FIELDS) && Object.isFrozen(EXTRACT_GUIDE_FIELDS.extract))
        })

        it('七欄之預設為中立句;給回原句即取原句(他欄照預設)', () => {
            const v = R({ guide: QUANT_VOCAB.guide })
            for (const [k, s] of Object.entries(QUANT_VOCAB.guide.extract)) assert.equal(v.guide.extract[k], s, k)
            for (const k of ['ruleTarget', 'weakEvidence', 'temporal']) assert.equal(v.guide.extract[k], GUIDE_DEFAULT.extract[k], k)
            assert.deepEqual(Object.keys(QUANT_VOCAB.guide.extract), GUIDE_FIELDS.slice(3), '夾具涵蓋七欄')
            for (const k of GUIDE_FIELDS.slice(3)) assert.notEqual(GUIDE_DEFAULT.extract[k], QUANT_VOCAB.guide.extract[k], `${k}:預設不是原句`)
        })

        it('逐欄回退預設:只給一欄,其餘欄位為預設;null／undefined 視為未給', () => {
            const v = R({ guide: { extract: { ruleTarget: '可直接用於觀測規劃的規則' } } })
            assert.deepEqual(v.guide, { extract: { ...GUIDE_DEFAULT.extract, ruleTarget: '可直接用於觀測規劃的規則' } })
            assert.deepEqual(R({ guide: null }).guide, GUIDE_DEFAULT)
            assert.deepEqual(R({ guide: { extract: null } }).guide, GUIDE_DEFAULT)
            assert.deepEqual(R({ guide: { extract: { ruleTarget: null, temporal: undefined } } }).guide, GUIDE_DEFAULT)
        })

        it('形狀與型別錯 → 拋:guide 非物件、他段(含摘要與關聯之段)或不認得之段、段非物件、不認得之欄位、欄位非字串', () => {
            assert.equal(msgOf(() => R({ guide: 'x' })), 'vocab.guide 須為物件 { extract }')
            assert.equal(msgOf(() => R({ guide: [] })), 'vocab.guide 須為物件 { extract }')
            for (const sec of ['triage', 'summarize', 'faith', 'relate', 'extrac']) assert.equal(msgOf(() => R({ guide: { [sec]: {} } })), `vocab.guide 含不認得之鍵：${sec}（可用：extract）`)
            assert.equal(msgOf(() => R({ guide: { relate: undefined } })), 'vocab.guide 含不認得之鍵：relate（可用：extract）', '值為 undefined 之段亦檢')
            assert.equal(msgOf(() => R({ guide: { extract: 'x' } })), 'vocab.guide.extract 須為物件')
            assert.equal(msgOf(() => R({ guide: { extract: { ruleTargt: 'x' } } })), `vocab.guide.extract 含不認得之鍵：ruleTargt（可用：${GUIDE_FIELDS.join('、')}）`)
            for (const k of GUIDE_FIELDS) assert.equal(msgOf(() => R({ guide: { extract: { [k]: 3 } } })), `vocab.guide.extract.${k} 須為非空字串`, k)
        })

        it('D11 null 政策(刻意變更,終審 D11):各欄皆插在句中 → 空字串與只含空白即拋「須為非空字串」(此前照填成殘句);null／undefined 仍沿用預設;非字串同此訊息(共用型別 estr)', () => {
            // 規則:core/vocab/extractVocab 之 EXTRACT_GUIDE_FIELDS(estr;抓取 vocabKit 之型別表一份,同關聯之殘句欄)與檔頭【null／{}／[] 之語意】
            for (const k of GUIDE_FIELDS) {
                assert.equal(msgOf(() => R({ guide: { extract: { [k]: '' } } })), `vocab.guide.extract.${k} 須為非空字串`, `${k}:空字串`)
                assert.equal(msgOf(() => R({ guide: { extract: { [k]: '  ' } } })), `vocab.guide.extract.${k} 須為非空字串`, `${k}:只含空白`)
                assert.equal(R({ guide: { extract: { [k]: null } } }).guide.extract[k], GUIDE_DEFAULT.extract[k], `${k}:null 沿用預設`)
            }
            // 自有之鍵之 null＝未給(unset)、{}／[] 才是「不要」;推定詞之 null＝不推定
            const d = R({})
            assert.deepEqual([R({ basisCaps: null }).basisCaps, R({ selfLimitPhrases: null }).selfLimitPhrases], [d.basisCaps, d.selfLimitPhrases])
            assert.deepEqual([R({ basisCaps: {} }).basisCaps, R({ selfLimitPhrases: [] }).selfLimitPhrases, R({ presumedBasis: null }).presumedBasis], [{}, [], null])
        })

        it('整份共用之詞彙表(含他段之 guide、他段之鍵)→ 拋;以 pickExtractVocab 取子集後可解析', () => {
            const whole = {
                domain: '天文學', kbLabel: '星空知識庫', categories: ['觀測', '其他'], claimTypes: ['觀測報告', '理論推導'], evidenceLevels: ['高', '中', '低'],
                relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突或反例'], conflictType: '衝突或反例', fallbackType: '互補搭配',
                selfLimitPhrases: ['僅單次觀測'], basisCaps: { 觀測: 0, 理論: 1, '*': 1 },
                guide: { triage: { scopeLine: '' }, summarize: { target: '知識' }, relate: { vagueReason: '同屬天文' }, extract: { ruleTarget: '觀測規劃之規則' } },
            }
            assert.equal(msgOf(() => R(whole)), 'vocab.guide 含不認得之鍵：triage、summarize、relate（可用：extract）', '他段一次列全(checkKeys 之格式)')
            assert.equal(msgOf(() => R({ ...whole, categoryHints: {} })), `vocab 含不認得之鍵：categoryHints（可用：${EXTRACT_VOCAB_KEYS.join('、')}）`)
            const v = R(pickExtractVocab({ ...whole, categoryHints: {} }))
            assert.deepEqual([v.domain, v.categories, v.basisCaps, v.inferenceBasis, v.guide.extract.ruleTarget], ['天文學', ['觀測', '其他'], { 觀測: 0, 理論: 1, '*': 1 }, ['理論'], '觀測規劃之規則'])
        })
    })

    describe('⑤ 子集擷取、可重複套用、互不汙染', function() {

        it('pickExtractVocab:只取本套件之鍵(未給者不列)、guide 只取 extract 段(有給才列)、不改輸入;非物件 → {}', () => {
            const src = {
                domain: '天文學', kbLabel: undefined, categoryHints: {}, claimTypes: ['觀測報告'], relationTypes: ['相關', '衝突'], basisCaps: { 觀測: 0 },
                guide: { triage: { scopeLine: '' }, relate: { vagueReason: '同屬天文' }, extract: { ruleTarget: '規則' } },
            }
            const before = JSON.stringify(src)
            const p = pickExtractVocab(src)
            assert.deepEqual(p, { domain: '天文學', claimTypes: ['觀測報告'], relationTypes: ['相關', '衝突'], basisCaps: { 觀測: 0 }, guide: { extract: { ruleTarget: '規則' } } })
            assert.equal(JSON.stringify(src), before)
            assert.deepEqual(pickExtractVocab({ guide: { summarize: {} } }), { guide: {} }, '無 extract 段 → guide 為空物件(解析時全用預設)')
            assert.deepEqual([pickExtractVocab(null), pickExtractVocab('x')], [{}, {}])
            assert.equal(pickExtractVocab({ guide: 'x' }).guide, 'x', 'guide 非物件原樣交解析(由解析拋錯)')
        })

        it('可重複套用:resolve(resolve(x)) 與 resolve(x) 相同;JSON 往返後再解析亦相同;取子集再解析亦相同', () => {
            const cases = [
                {}, { domain: '天文學', kbLabel: '星空知識庫', conceptAliases: { 吸积盘: '吸積盤' } },
                { claimTypes: ['觀測報告', '理論推導'], evidenceLevels: ['強', '中等', '弱'], evidenceCaps: { 理論推導: '中等' }, basisCaps: { 推導: '中等', 觀測: '強', '*': '弱' }, inferenceBasis: ['推導'] },
                { categories: ['觀測', '雜項'], fallbackCategory: '雜項', evidenceRule: QUANT_RULE },
                { relationTypes: ['前提', '延伸', '衝突', '補充'], conflictType: '衝突', fallbackType: '補充', relationTypeRenames: { 舊延伸: '延伸' }, relationTypeAliases: { 衝突關係: '衝突' } },
                { basisCaps: {}, selfLimitPhrases: [], absolutePhrases: ['必然'], guide: { extract: { temporal: '有效性隨觀測條件改變' } } },
                { claimTypes: ['論文'] },
                { ...QUANT_VOCAB, evidenceRule: QUANT_RULE },
                { basisCaps: { 觀測: 0, 推導: 1, '*': 1 }, presumedBasis: '推導', guide: { extract: { sameExample: '「甲」與「乙」' } } },
            ]
            for (const x of cases) {
                const a = R(x)
                assert.equal(snap(R(a)), snap(a), JSON.stringify(x))
                assert.equal(snap(R(JSON.parse(JSON.stringify(a)))), snap(a), `JSON 往返:${JSON.stringify(x)}`)
                assert.equal(snap(R(pickExtractVocab(a))), snap(a))
            }
        })

        it('各次解析之產物互不共用預設常數之參照:就地修改不影響下次解析與預設(含抓取共用之鍵)', () => {
            const a = R({})
            a.basisCaps.新詞 = 0
            a.selfLimitPhrases.push('雜')
            a.evidenceCaps.理論模型 = 0
            a.inferenceBasis.push('雜')
            a.guide.extract.ruleTarget = '改'
            a.guide.extract.sameExample = '改'
            a.presumedBasis = '理論'
            a.conceptRenames.甲 = '乙'
            a.relationTypes.push('雜')
            const b = R({})
            for (const k of OWN_KEYS) assert.deepEqual(b[k], EXPECTED_OWN[k], k)
            assert.deepEqual([b.guide, b.conceptRenames, b.relationTypes.includes('雜')], [GUIDE_DEFAULT, {}, false])
            assert.deepEqual([EXTRACT_VOCAB_DEFAULT.basisCaps, EXTRACT_VOCAB_DEFAULT.selfLimitPhrases], [EXPECTED_OWN.basisCaps, EXPECTED_OWN.selfLimitPhrases])
            assert.deepEqual(resolveCaptureVocab({}).conceptRenames, {}, '抓取套件之預設不受影響')
        })
    })

    describe('⑥ 詞彙之啟動期警告', function() {
        const W = 'vocab.claimTypes 已自訂而未給 vocab.evidenceCaps：預設之內容類型封頂表無一鍵對得上，核心主張之證據等級只依出處筆記之等級與「最高級須 2 份文件」判定（觀點、廠商等內容不再封頂）；請依自訂之內容類型給 evidenceCaps'

        it('自訂內容類型而未給證據封頂、且預設封頂表無一鍵對得上 → 一條警告(字樣逐字)', () => {
            assert.deepEqual(extractVocabWarningsOf({ claimTypes: ['論文', '部落格'] }), [W])
            assert.deepEqual(extractVocabWarningsOf({ claimTypes: ['論文'], evidenceCaps: null }), [W], 'null 視為未給')
            assert.deepEqual(extractVocabWarningsOf({ claimTypes: ['論文', '未標注'] }), [W], '缺值字樣不算對得上')
        })

        it('不警告:給了證據封頂({} 亦然)、內容類型含預設封頂表之任一鍵、未自訂內容類型、非物件', () => {
            assert.deepEqual(extractVocabWarningsOf({ claimTypes: ['論文'], evidenceCaps: {} }), [])
            assert.deepEqual(extractVocabWarningsOf({ claimTypes: ['論文', '觀點評論'] }), [])
            assert.deepEqual([extractVocabWarningsOf({}), extractVocabWarningsOf({ claimTypes: 'x' }), extractVocabWarningsOf(null), extractVocabWarningsOf('x')], [[], [], [], []])
        })
    })
})
