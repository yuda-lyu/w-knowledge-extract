// unit-entry.test.mjs — 入口契約:主入口「全部積木具名匯出」、含第二入口 taskRunner 全部成員(同名即同一實作)
// 執行:npx mocha test/unit-entry.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import WKnowledgeExtract from '../src/WKnowledgeExtract.mjs'
import taskRunner from '../src/taskRunner.mjs'

const SRC = path.resolve('src')
// 刻意不經主入口匯出之模組內部常數/工具(巡檢自適應階梯參數、run.json 內部之 sanitize)
const NOT_EXPORTED = new Set(['LADDER', 'STEP_UP_AFTER', 'sanitize'])

describe('unit-entry', function() {

    it('主入口含第二入口 taskRunner 之全部成員,且為同一實作(同名即同一實作)', () => {
        const keys = Object.keys(taskRunner)
        assert.ok(keys.length >= 35)
        for (const k of keys) assert.equal(WKnowledgeExtract[k], taskRunner[k], k)
    })

    it('主入口具名匯出全部模組之公開積木(新增模組 export 而未掛入口即失敗)', async () => {
        const files = fs.readdirSync(SRC, { recursive: true })
            .map(String)
            .filter((f) => f.endsWith('.mjs') && !/(^|[\\/])(WKnowledgeExtract|taskRunner)\.mjs$/.test(f))
        assert.ok(files.length >= 50, `模組數 ${files.length}`)
        const missing = []
        for (const f of files) {
            const mod = await import(pathToFileURL(path.join(SRC, f)).href)
            for (const [k, v] of Object.entries(mod)) {
                if (k === 'default' || NOT_EXPORTED.has(k)) continue
                if (WKnowledgeExtract[k] !== v) missing.push(`${f.replace(/\\/g, '/')}:${k}`)
            }
        }
        assert.deepEqual(missing, [], '未掛入主入口(或同名不同實作)之具名匯出')
    })

    it('主入口成員皆有定義;taskRunner 不含知識管線(不載入 stages／opencc／lmdb 之輕量入口)', () => {
        for (const [k, v] of Object.entries(WKnowledgeExtract)) assert.notEqual(v, undefined, k)
        assert.equal(typeof WKnowledgeExtract.createKnowledgeExtract, 'function')
        assert.equal(taskRunner.createKnowledgeExtract, undefined)
        assert.equal(taskRunner.stageExtract, undefined)
    })

})
