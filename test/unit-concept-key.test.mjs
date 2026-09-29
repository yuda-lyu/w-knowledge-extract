// unit-concept-key.test.mjs — 概念分群鍵(2.0):預設折疊 tw→cn、折疊前改名／折疊後別名兩段、「(數字)」不自動併、線索鍵凍結 1.x 正規化
//
// 規格來源:tmp/wke-distill-b-全盤.md §11.1 A26～A29(2026-09-29 雙審定案)與安裝方〈建議w-knowledge-extract優化〉§1.6
//   A 組(字形變體,應收斂)、B 組(兩岸用語,字元級轉換不收斂,靠別名)、C 組(繁體語意不同而折疊後同鍵,已知取捨,靠改名拆開)
// 執行:npx mocha test/unit-concept-key.test.mjs(暫存落 test/_tmp/concept-key-<pid>,測完即刪;不發網路)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as OpenCC from 'opencc-js'
import { normalizeConcept, normalizeClue, setConceptFold, checkNameMap, sha1 } from '../src/util/text.mjs'
import { clueKey } from '../src/stores/frontierPolicy.mjs'
import { resolveVocab } from '../src/domain/vocabDefault.mjs'
import { createKnowledgeExtract } from '../src/core/createKnowledgeExtract.mjs'
import { stubAi } from './tools/stubAi.mjs'

const TMP = path.resolve(`test/_tmp/concept-key-${process.pid}`).replace(/\\/g, '/')
const tw2cn = OpenCC.Converter({ from: 'tw', to: 'cn' })
const cn2tw = OpenCC.Converter({ from: 'cn', to: 'tw' })
const same = (...xs) => new Set(xs.map(normalizeConcept)).size === 1

describe('unit-concept-key', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        setConceptFold(null) // 模組級單例,不留給同 worker 之他檔
    })

    it('總組裝預設(未給 conceptFold):分群折向簡體——A 組字形變體收斂;1.x 之 cn→tw 收斂不了者亦收斂', () => {
        createKnowledgeExtract({ workDir: `${TMP}/w1`, afterRun: false, aiAdapter: stubAi })
        assert.ok(same('均值回歸', '均值迴歸', '均值回归'), '回歸／迴歸／回归(1.x 分 2 鍵)')
        assert.ok(same('系統風險', '系统风险'))
        assert.ok(same('裡程碑', '里程碑'))
        assert.ok(same('對沖', '對衝'))
        assert.ok(same('捲積', '卷積'))
        assert.ok(same('Transformer 架構', 'transformer架構', 'Ｔransformer架構'), 'NFKC、去空白、小寫照舊')
    })

    it('B 組(兩岸用語)字元級不收斂;以折疊後別名合併,且別名對別名之字形變體亦生效', () => {
        createKnowledgeExtract({ workDir: `${TMP}/w2`, afterRun: false, aiAdapter: stubAi })
        assert.ok(!same('演算法', '算法'))
        assert.ok(!same('資料探勘', '数据挖掘'))
        createKnowledgeExtract({ workDir: `${TMP}/w3`, afterRun: false, aiAdapter: stubAi, data: { vocab: { conceptAliases: { '算法': '演算法', '数据挖掘': '資料探勘' } } } })
        assert.ok(same('演算法', '算法'))
        assert.ok(same('資料探勘', '数据挖掘', '數據挖掘'), '別名鍵經折疊:繁體寫法「數據挖掘」折疊後命中「数据挖掘」之別名')
    })

    it('C 組(繁體語意不同而折疊後同鍵)列為已知取捨;以折疊前改名拆開,改名不波及另一寫法', () => {
        createKnowledgeExtract({ workDir: `${TMP}/w4`, afterRun: false, aiAdapter: stubAi })
        assert.ok(same('曆年', '歷年'), '已知取捨:tw→cn 字元級折疊把曆／歷併為历')
        assert.ok(same('回復率', '回覆率'), '已知取捨(恢復率／回應率)')
        createKnowledgeExtract({ workDir: `${TMP}/w5`, afterRun: false, aiAdapter: stubAi, data: { vocab: { conceptRenames: { '曆年': '曆年（曆法）' } } } })
        assert.ok(!same('曆年', '歷年'), '改名以原字形精確比對,拆得開')
        assert.equal(normalizeConcept('歷年'), tw2cn('歷年'), '另一寫法不受影響')
    })

    it('「(數字)」尾綴不自動去除(AR(1)/AR(2)、I(0)/I(1) 為不同概念);既有「名稱(743)」分身以折疊前改名收斂(含全形括號)', () => {
        createKnowledgeExtract({ workDir: `${TMP}/w6`, afterRun: false, aiAdapter: stubAi })
        assert.ok(!same('AR(1)', 'AR(2)'))
        assert.ok(!same('I(0)', 'I(1)'))
        assert.ok(!same('市場微結構(743)', '市場微結構'), '零設定不自動併(年份與篇數同為數字,無從區分)')
        createKnowledgeExtract({ workDir: `${TMP}/w7`, afterRun: false, aiAdapter: stubAi, data: { vocab: { conceptRenames: { '市場微結構(743)': '市場微結構' } } } })
        assert.ok(same('市場微結構(743)', '市場微結構', '市場微結構（743）', '市场微结构'))
        assert.ok(!same('AR(1)', 'AR(2)'), '改名只作用於列出之寫法')
    })

    it('別名單跳不遞移;改名與別名可串接(改名 → 折疊 → 別名)', () => {
        setConceptFold(tw2cn, { aliases: { '甲': '乙', '乙': '丙' }, renames: { '丁(9)': '丁' }, clueFold: cn2tw })
        assert.equal(normalizeConcept('甲'), '乙', '單跳')
        assert.equal(normalizeConcept('乙'), '丙')
        setConceptFold(tw2cn, { renames: { '戊(12)': '戊' }, aliases: { '戊': '己' } })
        assert.equal(normalizeConcept('戊(12)'), '己', '改名後之寫法再經別名')
    })

    it('線索鍵凍結 1.x 正規化:預設 cn→tw 折疊、不套改名與別名——既有 frontier 記錄之 id 不變', () => {
        createKnowledgeExtract({ workDir: `${TMP}/w8`, afterRun: false, aiAdapter: stubAi, data: { vocab: { conceptAliases: { '算法': '演算法' }, conceptRenames: { '曆年': '曆年（曆法）' } } } })
        // 1.x:normalizeConcept(NFKC、去空白與括號、小寫)後以 cn→tw 折疊
        const v1 = (s) => cn2tw(String(s).normalize('NFKC').replace(/\s+/g, '').replace(/[（）()［］[\]「」]/g, '').toLowerCase().trim())
        for (const v of ['均值回归', '算法', '曆年', 'Transformer 架構', '市場微結構(743)']) {
            assert.equal(normalizeClue(v), v1(v), v)
            assert.equal(clueKey('keyword', v), sha1(`keyword|${v1(v)}`), `${v} 之線索鍵與 1.x 相同`)
        }
        assert.notEqual(normalizeClue('均值回归'), normalizeConcept('均值回归'), '線索鍵與分群鍵已脫鉤')
    })

    it('conceptFold:false 兩者皆不折疊;給函數者兩者同用該函數(1.x 之安裝方自訂折疊,線索鍵亦不變)', () => {
        createKnowledgeExtract({ workDir: `${TMP}/w9`, afterRun: false, aiAdapter: stubAi, conceptFold: false })
        assert.equal(normalizeConcept('均值回归'), '均值回归')
        assert.equal(normalizeClue('均值回归'), '均值回归')
        const fold = (s) => s.replace(/机/g, '機')
        createKnowledgeExtract({ workDir: `${TMP}/w10`, afterRun: false, aiAdapter: stubAi, conceptFold: fold })
        assert.equal(normalizeConcept('注意力机制'), '注意力機制')
        assert.equal(normalizeClue('注意力机制'), '注意力機制')
    })

    it('setConceptFold 只給 fn(1.x 用法):線索折疊同 fn、改名與別名清空;opt 非物件視為{}', () => {
        setConceptFold(tw2cn, { aliases: { '算法': '演算法' } })
        assert.ok(same('演算法', '算法'))
        setConceptFold(cn2tw)
        assert.ok(!same('演算法', '算法'), '別名清空')
        assert.equal(normalizeClue('均值回归'), cn2tw('均值回归'), '線索折疊同 fn')
        setConceptFold(null, 'bad')
        assert.equal(normalizeConcept('均值回归'), '均值回归')
    })

    it('別名設定形狀錯誤於建構期拋錯(不可靜默不生效);null 視為空對照', () => {
        assert.throws(() => checkNameMap(['a'], 'vocab.conceptAliases'), /vocab\.conceptAliases 須為物件/)
        assert.throws(() => checkNameMap({ '甲': '' }, 'vocab.conceptAliases'), /「甲」須對應非空字串/)
        assert.throws(() => checkNameMap({ '甲': 3 }, 'vocab.conceptRenames'), /「甲」須對應非空字串/)
        assert.deepEqual(checkNameMap(null, 'x'), [])
        assert.throws(() => resolveVocab({ conceptRenames: 'x' }), /vocab\.conceptRenames 須為物件/)
        assert.deepEqual(resolveVocab({ conceptAliases: null }).conceptAliases, {})
        assert.throws(() => createKnowledgeExtract({ workDir: `${TMP}/bad`, afterRun: false, aiAdapter: stubAi, data: { vocab: { conceptAliases: { '算法': ['演算法'] } } } }), /vocab\.conceptAliases 之「算法」須對應非空字串/)
        const before = normalizeConcept('均值回归')
        assert.throws(() => setConceptFold(cn2tw, { renames: 'x' }))
        assert.equal(normalizeConcept('均值回归'), before, '拋錯時模組狀態不變')
    })
})
