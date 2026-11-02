// api-extract-bench-ai.test.mjs — 提煉之 AI 能力評分之真 AI 測試:以免費模型跑十四角色(判定類六角色與工作流類八角色)之內建通用題組
//   (全題組、每案兩回;同關聯之 api-relate-bench-ai),驗執行器全程無例外、每模型每案每回皆有結果;評分只報告、不作通過門檻(模型能力
//   隨時間變動),報表落 <WK_BENCH_OUT>/extract-bench-ai-<時間戳>/ 並印出路徑
//
// 【閘門】會呼叫真 AI、耗用免費額度:只在 WK_LIVE_AI=1 時執行,否則整組略過(mocha pending)並印出原因。
// 【受測模型】WK_EXTRACT_MODELS(逗號分隔之條目 id)給了即用之;否則為提煉之預設起草三席之首選與遞補(extract.ai.drafters 之 use 與 fallback;同關聯取 use＋fallback)。
// 【角色】WK_EXTRACT_ROLES(逗號分隔之角色 id)給了只跑所列者(於 before 內解析——載入期不讀環境變數,打錯之角色只在開閘時才拋);否則依序跑十四角色。
//   各角色之 it 依已定義之角色(EXTRACT_BENCH_ROLES)建立,未選者略過。【題組】每角色跑內建題組之全部案(含保留題)。
// 【金鑰】WK_ENV_FILE(.env 格式之金鑰檔)給了即讀之;未給讀 process.env(預設席位為免金鑰之免費模型)。
// 【工作目錄與報表一律在專案外】WK_BENCH_OUT(絕對路徑;須在套件根之上一層之外)開閘時必給:AI 子行程之工作目錄
//   <WK_BENCH_OUT>/extract-bench-ai-ws-<pid>(測完即刪)與報表目錄 <WK_BENCH_OUT>/extract-bench-ai-<時間戳>(保留,供人閱讀)皆落此——
//   CLI 型模型會讀工作目錄上層之指示檔,在專案內跑量到的不是通用能力(使用者裁示:量通用能力之工作目錄放專案外)。本測試不寫套件之 test/_tmp。
// 【逐回即存】每回結果一完成即附寫報表目錄之 <角色>-progress.jsonl(抓取套件之 appendJsonlRows):中途被終止也留得下已跑之結果。
// 執行(套件根):WK_LIVE_AI=1 WK_BENCH_OUT=<專案外之絕對路徑> node <mocha> --timeout 180000 test/api-extract-bench-ai.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EXTRACT_BENCH_ROLES, extractBenchRoleOf, runExtractBench, planExtractBench } from '../src/bench/extractBench.mjs'
import { createAiAdapter, writeBenchReport, BENCH_FAIL_KINDS } from './tools/captureForTest.mjs'
import { PKG_ROOT } from './tools/extractTestKit.mjs'
import { resolveExtractSettings } from '../src/core/extractSettings.mjs'
import { appendJsonlRows } from '../src/core/capturePackage.mjs'

const LIVE = process.env.WK_LIVE_AI === '1'
const RUNS = 2

/**
 * 逗號分隔之環境變數(未給回 null)
 *
 * @param {String} name 輸入變數名
 * @returns {Array|null} 回傳字串陣列或 null
 */
const listEnv = (name) => (process.env[name] ? process.env[name].split(',').map((s) => s.trim()).filter(Boolean) : null)

/**
 * 專案外之評分目錄之問題(WK_BENCH_OUT;合格回 '')
 *
 * @param {String} dir 輸入目錄
 * @returns {String} 回傳問題說明
 */
const benchOutProblem = (dir) => {
    if (!dir) return '開閘(WK_LIVE_AI=1)須另給 WK_BENCH_OUT(專案外之絕對路徑):CLI 型模型會讀工作目錄上層之指示檔'
    if (!path.isAbsolute(dir)) return `WK_BENCH_OUT 須為絕對路徑：${dir}`
    const rel = path.relative(path.resolve(PKG_ROOT, '..'), path.resolve(dir))
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return `WK_BENCH_OUT 須在專案外(套件根之上一層之外)：${dir}`
    return ''
}

describe('api-extract-bench-ai：免費 AI 跑十四角色之通用題組（真 AI；評分只報告、不設門檻）', function() {

    this.timeout(6 * 3600_000)

    let ai = null
    let models = []
    let outDir = ''
    let workspace = ''
    /** 本次要跑之角色 id(before 內解析 WK_EXTRACT_ROLES) */
    let picked = new Set()

    before(function() {
        if (!LIVE) {
            console.log('    略過：未設 WK_LIVE_AI=1（本測試呼叫真 AI、耗用免費額度）')
            this.skip()
        }
        const bench = process.env.WK_BENCH_OUT || ''
        assert.equal(benchOutProblem(bench), '')
        workspace = path.join(path.resolve(bench), `extract-bench-ai-ws-${process.pid}`)
        picked = new Set((listEnv('WK_EXTRACT_ROLES') || EXTRACT_BENCH_ROLES.map((r) => r.id)).map((id) => extractBenchRoleOf(id).id))
        const settings = resolveExtractSettings({})
        models = listEnv('WK_EXTRACT_MODELS') || [...new Set(settings.extract.ai.drafters.flatMap((s) => [s.use, ...(s.fallback || [])]))]
        assert.ok(models.length > 0, '受測模型為空')
        const envFile = process.env.WK_ENV_FILE ? path.resolve(process.env.WK_ENV_FILE) : ''
        if (envFile) assert.ok(fs.existsSync(envFile), `WK_ENV_FILE 指定之金鑰檔不存在：${envFile}`)
        // 角色之呼叫經工作流入口(getWkf／seatSpec;同正式之各判定小組)
        ai = createAiAdapter({ ai: settings.ai, workspace, workflow: true, ...(envFile ? { envFile } : {}) })
    })

    after(() => {
        if (LIVE && workspace) fs.rmSync(workspace, { recursive: true, force: true })
    })

    for (const role of EXTRACT_BENCH_ROLES) {
        it(`${role.name}：每案 ${RUNS} 回，執行器全程無例外、每模型每案每回皆有結果(呼叫失敗與停測亦記原因);報表落地並印出路徑`, async function() {
            if (!picked.has(role.id)) this.skip()
            // 全題組(已驗之內建題組;同關聯之 api 測試跑全題組)
            const cases = planExtractBench(role.id).set
            let progressFile = ''
            const onProgress = (ev) => {
                if (ev.type === 'start') {
                    if (!outDir) outDir = path.join(path.resolve(process.env.WK_BENCH_OUT), `extract-bench-ai-${ev.meta.stamp}`)
                    fs.mkdirSync(outDir, { recursive: true })
                    progressFile = path.join(outDir, `${role.id}-progress.jsonl`)
                    console.log(`    ${role.name}：受測 ${ev.meta.models.join('、')}；${ev.meta.cases} 案 × ${ev.meta.runs} 回；提示詞指紋 ${ev.meta.promptFp}；逐回進度 ${progressFile}`)
                    return
                }
                appendJsonlRows(progressFile, [{ at: new Date().toISOString(), ...ev }])
                if (ev.type === 'call') {
                    const r = ev.record
                    const what = r.callFail ? `失敗（${BENCH_FAIL_KINDS[r.failKind] || r.failKind}：${String(r.error).slice(0, 80)}）` : (r.cls || `無裁決（${r.problem}）`)
                    console.log(`      [${ev.model}] 第 ${r.run} 回 ${ev.caseId}：${what}（${(r.ms / 1000).toFixed(1)}s）`)
                }
                else if (ev.type === 'model-stopped') console.log(`      [${ev.model}] ${ev.reason}`)
            }

            // 執行器全程無例外:runExtractBench 拋錯即本測試失敗(呼叫失敗、限流、停測皆應記入結果而非拋出)
            const result = await runExtractBench(role.id, { models, cases, runs: RUNS, aiAdapter: ai, onProgress })

            // 每模型每案每回皆有結果:裁決(類別或無裁決之原因)、呼叫失敗(類別與錯誤)或未呼叫(原因)三者之一;未通過之案皆附原因
            assert.equal(result.models.length, models.length)
            for (const m of result.models) {
                assert.equal(m.cases.length, cases.cases.length, `${m.model} 之案數`)
                for (const c of m.cases) {
                    assert.equal(c.runs.length, RUNS, `${m.model}／${c.id} 之回數`)
                    c.runs.forEach((r, k) => {
                        assert.equal(r.run, k + 1)
                        const hasResult = r.notRun ? !!r.error : r.callFail ? !!(r.failKind && r.error) : (r.cls !== null || !!r.problem)
                        assert.ok(hasResult, `${m.model}／${c.id} 第 ${k + 1} 回無結果：${JSON.stringify(r)}`)
                    })
                    if (!c.pass) assert.ok(c.note, `${m.model}／${c.id} 未通過而無原因`)
                }
                const { score, general, holdout, contract, calls } = m
                assert.equal(score.total, cases.cases.length)
                assert.equal(general.total + holdout.total, score.total)
                console.log(`    ${m.model}：通過 ${score.pass}/${score.total}（一般 ${general.pass}/${general.total}、保留 ${holdout.pass}/${holdout.total}）；合契約 ${contract.valid}/${contract.total}；平均 ${m.avgMs === null ? '-' : (m.avgMs / 1000).toFixed(1)}s；呼叫失敗 ${calls.failed}${calls.notRun ? `、未呼叫 ${calls.notRun}` : ''}${m.stopped ? `；${m.stopped}` : ''}`)
            }

            // 報表落地(評分只報告,不設門檻)
            const rep = writeBenchReport(result, outDir, { role, name: `${role.id}-bench` })
            for (const f of Object.values(rep.files)) assert.ok(fs.statSync(f).size > 0, f)
            console.log(`    報表：\n      ${[...Object.values(rep.files), progressFile].join('\n      ')}`)
        })
    }
})

// 閘外之判準自檢(主 describe 未開閘即整組略過,故另立;不呼叫 AI、不寫檔)
describe('api-extract-bench-ai：專案外目錄之判準', function() {

    it('判準自檢(不開閘亦跑):WK_BENCH_OUT 未給、相對路徑、在專案內(套件根或其上一層之下)皆為問題;專案外之絕對路徑合格', () => {
        // 規則:量通用能力之工作目錄放專案外(檔頭【工作目錄與報表一律在專案外】)
        assert.match(benchOutProblem(''), /須另給 WK_BENCH_OUT/)
        assert.match(benchOutProblem('rel/dir'), /須為絕對路徑/)
        assert.match(benchOutProblem(path.join(PKG_ROOT, 'test', '_tmp', 'x')), /須在專案外/)
        assert.match(benchOutProblem(path.resolve(PKG_ROOT, '..', 'other')), /須在專案外/, '套件根之上一層(單一倉庫內之專案根)之下亦算專案內')
        assert.equal(benchOutProblem(path.resolve(PKG_ROOT, '..', '..', 'outside-bench')), '')
    })
})
