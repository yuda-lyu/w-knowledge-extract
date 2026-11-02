// regen-golden.mjs — 提示詞基準檔(test/golden)之重產工具(不帶 .test. 中綴:共用層,避免被 runner 當測試檔抓取)
//
// 【只重產可重產之組】中立基準(test/golden/extract/;預設詞彙之產出)可重產;覆寫重現(test/golden/extract-override/,16 檔)不可重產——
//   其為中立化之前之實作之產物(該實作已不在本套件),只能逐字比對、手改須另有依據(理由見 test/unit-extract-golden 檔頭)。本工具不寫覆寫組;
//   跑重產時覆寫組照常比對,不符即中止。
// 【預演為預設】未設 GOLDEN_WRITE=1:只列出會新增／改動之基準檔與基準目錄中多出之檔(不寫);設 GOLDEN_WRITE=1 才寫入有變之檔(多出之檔只列不刪)。
//   刻意改提示詞才重產(改一字即改題目識別:須先以正式席位 A/B 驗證);重產之檔須於提交說明逐檔列出理由。
// 【作法】以 GOLDEN_WRITE=1 與 GOLDEN_OUT=<暫存根> 跑 test/unit-extract-golden(該測試於 GOLDEN_OUT 給時把可重產之組寫到暫存根而非原處),
//   再逐檔比對暫存與基準;暫存根為 test/_tmp/regen-golden-<pid>(tmpRoot),結束即刪(removeRoots)。
// 用法(套件根):node test/tools/regen-golden.mjs(預演)／GOLDEN_WRITE=1 node test/tools/regen-golden.mjs(寫入)

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PKG_ROOT, tmpRoot, removeRoots } from './extractTestKit.mjs'

/** 可重產之組(test/golden 下之目錄;覆寫重現之組不在此) */
export const GOLDEN_WRITABLE_DIRS = Object.freeze(['extract'])

/**
 * 暫存之產出 ↔ 基準目錄之逐檔比對(.txt)
 *
 * @param {String} stagedDir 輸入暫存之組目錄(重產之產出)
 * @param {String} goldenDir 輸入基準之組目錄
 * @returns {Object} 回傳 { added:Array(基準無而產出有), changed:Array(內容不同), same:Array, extra:Array(基準有而產出無) }(皆為檔名,排序)
 */
export function goldenPlanOf(stagedDir, goldenDir) {
    const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.txt')).sort() : [])
    const staged = ls(stagedDir)
    const golden = new Set(ls(goldenDir))
    const plan = { added: [], changed: [], same: [], extra: [] }
    for (const f of staged) {
        if (!golden.has(f)) plan.added.push(f)
        else if (fs.readFileSync(path.join(stagedDir, f), 'utf8') !== fs.readFileSync(path.join(goldenDir, f), 'utf8')) plan.changed.push(f)
        else plan.same.push(f)
    }
    plan.extra = [...golden].filter((f) => !staged.includes(f))
    return plan
}

/**
 * mocha 之執行檔(自套件根往上找 node_modules/mocha/bin/mocha.js)
 *
 * @returns {String} 回傳絕對路徑
 */
function mochaBin() {
    for (let dir = PKG_ROOT; ; dir = path.dirname(dir)) {
        const f = path.join(dir, 'node_modules', 'mocha', 'bin', 'mocha.js')
        if (fs.existsSync(f)) return f
        if (path.dirname(dir) === dir) throw new Error('找不到 node_modules/mocha(須先安裝套件依賴)')
    }
}

/**
 * 重產:跑基準測試把可重產之組寫到暫存,比對後依 write 寫回
 *
 * @param {Object} [o={}] 輸入 { write:Boolean(預設讀 GOLDEN_WRITE==='1'), log:(s)=>void(預設 console.log) }
 * @returns {Object} 回傳 { ok:Boolean, plans:{ 組目錄: plan }, wrote:Array(寫回之相對路徑), error? }
 */
export function regenGolden(o = {}) {
    const write = typeof o.write === 'boolean' ? o.write : process.env.GOLDEN_WRITE === '1'
    const log = typeof o.log === 'function' ? o.log : (s) => console.log(s)
    const stage = tmpRoot('regen-golden')
    try {
        const r = spawnSync(process.execPath, [mochaBin(), 'test/unit-extract-golden.test.mjs', '--timeout', '180000'], {
            cwd: PKG_ROOT, encoding: 'utf8', env: { ...process.env, GOLDEN_WRITE: '1', GOLDEN_OUT: stage },
        })
        if (r.status !== 0) return { ok: false, plans: {}, wrote: [], error: `基準測試失敗(覆寫重現之組不符或測試出錯;未寫任何檔):\n${String(r.stdout || '').slice(-2000)}${String(r.stderr || '').slice(-1000)}` }
        const plans = {}
        const wrote = []
        for (const d of GOLDEN_WRITABLE_DIRS) {
            const goldenDir = path.join(PKG_ROOT, 'test', 'golden', d)
            const plan = goldenPlanOf(path.join(stage, d), goldenDir)
            plans[d] = plan
            log(`${d}/:會新增 ${plan.added.length}、會改動 ${plan.changed.length}、相同 ${plan.same.length}、基準多出(只列不刪)${plan.extra.length}`)
            for (const f of [...plan.added, ...plan.changed]) log(`  ${plan.added.includes(f) ? '新增' : '改動'} ${d}/${f}`)
            for (const f of plan.extra) log(`  多出 ${d}/${f}`)
            if (write) {
                for (const f of [...plan.added, ...plan.changed]) {
                    fs.mkdirSync(goldenDir, { recursive: true })
                    fs.copyFileSync(path.join(stage, d, f), path.join(goldenDir, f))
                    wrote.push(`test/golden/${d}/${f}`)
                }
            }
        }
        log(write ? `已寫入 ${wrote.length} 檔` : '預演(未寫入;GOLDEN_WRITE=1 才寫)')
        return { ok: true, plans, wrote }
    }
    finally {
        removeRoots([stage])
    }
}

// 直接執行(node test/tools/regen-golden.mjs)時才跑;被 import 時不跑
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const r = regenGolden()
    if (!r.ok) {
        console.error(r.error)
        process.exitCode = 1
    }
}

export default { GOLDEN_WRITABLE_DIRS, goldenPlanOf, regenGolden }
