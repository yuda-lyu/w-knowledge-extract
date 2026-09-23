// unit-capability.test.mjs — 供應商能力(prompt 長度上限)之契約:呼叫前剔除放不下的條目
// 執行:npx mocha test/unit-capability.test.mjs(不發網路、不呼叫任何 AI)

import assert from 'node:assert/strict'
import { KIND_MAX_PROMPT_CHARS, maxPromptCharsOf, fitChain } from '../src/ai/capability.mjs'


const agy = { id: 'agy:g', kind: 'antigravity' }
const son = { id: 'claude:sonnet', kind: 'claude' }
const cdx = { id: 'codex:luna', kind: 'codex' }

describe('unit-capability', function() {

    it('上限來源:kind 硬上限 → 條目自帶 → 逐 id 覆寫;未知 kind 無上限', () => {
        assert.equal(KIND_MAX_PROMPT_CHARS.antigravity, 30_000, '來源:w-dispatch-ai dispatchAntigravity.mjs MAX_PROMPT_LENGTH')
        assert.equal(maxPromptCharsOf(agy), 30_000)
        assert.equal(maxPromptCharsOf(son), Infinity, 'claude 走 stdin,無命令列長度上限')
        assert.equal(maxPromptCharsOf(cdx), Infinity, 'codex 走 stdin')
        assert.equal(maxPromptCharsOf({ id: 'x', kind: 'antigravity', maxPromptChars: 12_000 }), 12_000, '條目自帶優先於 kind')
        assert.equal(maxPromptCharsOf(agy, { 'agy:g': 20_000 }), 20_000, '逐 id 覆寫優先於一切')
        assert.equal(maxPromptCharsOf(agy, { 'agy:g': 0 }), Infinity, '覆寫為 0／null＝明示解除上限')
        assert.equal(maxPromptCharsOf(null), Infinity)
    })

    it('fitChain:超過上限者剔除、鏈序不變;放得下者全留', () => {
        const chain = [agy, son, cdx]
        const small = fitChain(chain, 10_000)
        assert.deepEqual(small.kept.map((x) => x.id), ['agy:g', 'claude:sonnet', 'codex:luna'])
        assert.deepEqual(small.dropped, [])
        // 實測值:關聯段 6 篇×25 候選之 prompt 為 40,191～43,814 字元(tmp/measure-prompts.mjs 對真庫)
        const big = fitChain(chain, 43_814)
        assert.deepEqual(big.kept.map((x) => x.id), ['claude:sonnet', 'codex:luna'], '剔除後鏈序不變,遞補照原順序')
        assert.deepEqual(big.dropped, [{ id: 'agy:g', limit: 30_000 }])
        assert.equal(fitChain(chain, 30_000).dropped.length, 0, '恰等於上限者放行(轉接器之判準為 >)')
        assert.equal(fitChain(chain, 30_001).dropped.length, 1)
    })

    it('fitChain:全鏈皆放不下時 kept 為空(呼叫端據此回失敗,不送出)', () => {
        const r = fitChain([agy, { id: 'agy:h', kind: 'antigravity' }], 50_000)
        assert.deepEqual(r.kept, [])
        assert.equal(r.dropped.length, 2)
        assert.deepEqual(fitChain([], 10), { kept: [], dropped: [] })
        assert.deepEqual(fitChain(null, 10), { kept: [], dropped: [] })
    })

})
