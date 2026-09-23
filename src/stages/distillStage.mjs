// distillStage.mjs — 提煉階段的泛用機制：選題、角色鏈接線、版本化落盤、降級保底
//
// 【機制入套件、prompt／工作流設定留執行端】
//   選題（概念層 gain 優先、類別層後備）、used-notes 取新排序、核心檔版本化、
//   distilledAt 標記、B 段失敗降級採用 A 整合稿——這些是機制；
//   各角色的提示詞（audit/revise/accept）、fanout 名額、schema 全是領域與 AI 設定，
//   由執行端注入（kinds 表 + wkf 實例 + fanout/pipeline 宣告）。
//
// 【降級保底的教訓】欄位名是 result 不是 final——這條路徑曾因欄位名寫錯而
//   靜默失效三天（B 段失敗卻報「工作流失敗」），故此處有測試義務（接入後補）。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import { readMd, writeMd } from '../md/md.mjs'
import { slugify } from '../util/text.mjs'
import { oneline } from '../util/misc.mjs'
import { pickConcepts, pickCategories } from '../stores/conceptGroups.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { budgetOf } from '../core/budget.mjs'

/**
 * 把宣告式的角色鏈展開成 runRolePipeline 的 stages（自動編號、接線由程式處理）。
 *
 * 【接線】每一棒自動接上「它之前最近一份稿件」與「它之前最近一份審計意見」，
 *   故 audit→revise→audit→revise 這種組合直接在設定宣告即可，不必改程式。
 * 【驗證在啟動期】階段種類或順序不合法立即拋出，不默默降級。
 *
 * @param {Array} pipeline 設定宣告 [{stage, ...spec}]；非陣列或空陣列拋錯
 * @param {Object} kinds 執行端注入的種類表 { audit:{produces,check,build}, revise:{...}, accept:{...} }；非物件拋錯
 * @param {Object} bind 綁定給 build 的脈絡 { concept, basePrompt }；非物件視為{}
 * @returns {Array} 回傳展開後之 stages 陣列，供 runFanoutPipeline 之 stages 使用
 * @throws {Error} pipeline 非陣列或為空、kinds 非物件、stage 名未知、或階段順序不合法(缺前置審計類階段)時拋出
 */
export function buildWorkflowStages(pipeline, kinds, bind) {

    //check
    if (!Array.isArray(pipeline) || pipeline.length === 0) throw new Error('distill pipeline 未設定或為空')
    if (!isobj(kinds)) throw new Error('buildWorkflowStages 需要 kinds（角色種類表）')
    if (!isobj(bind)) {
        bind = {}
    }

    const kindNames = Object.keys(kinds)
    const seen = {}
    const ids = []
    const kindSeq = []
    return pipeline.map((item, i) => {
        const { stage, ...spec } = item
        const kind = kinds[stage]
        if (!kind) throw new Error(`distill pipeline[${i}]：未知的 stage「${stage}」（可用：${kindNames.join('／')}）`)
        if (i === 0 && kind.produces !== 'issues') throw new Error('distill pipeline[0] 須為產出意見的階段（初稿由前段 fanout 整合產生，本鏈不含 draft）')
        if (kind.produces === 'draft' && !kindSeq.some((k) => kinds[k].produces === 'issues')) {
            throw new Error(`distill pipeline[${i}]：${stage} 之前必須先有審計類階段`)
        }
        seen[stage] = (seen[stage] || 0) + 1
        const id = seen[stage] === 1 ? stage : `${stage}${seen[stage]}`
        const prevIds = [...ids]
        const prevKinds = [...kindSeq]
        ids.push(id)
        kindSeq.push(stage)
        return {
            id,
            ...spec,
            check: kind.check,
            prompt: (ctx) => {
                // 最近一份稿件：往前找最後一個產稿階段；都沒有就是前段整合稿（ctx.input）
                let draft = ctx.input
                for (let k = prevIds.length - 1; k >= 0; k--) {
                    if (kinds[prevKinds[k]].produces === 'draft') {
                        draft = ctx.results[prevIds[k]]; break
                    }
                }
                // 最近一份審計意見：往前找最後一個 issues 階段
                let issues = null
                for (let k = prevIds.length - 1; k >= 0; k--) {
                    if (kinds[prevKinds[k]].produces === 'issues') {
                        issues = ctx.results[prevIds[k]]?.issues; break
                    }
                }
                return kind.build({ ...bind, draft, issues })
            },
        }
    })
}

// ─── 逐概念動作鏈(hook 錨點:distill.distill.{buildBase, runWorkflow, adoptResult,
//     renderCore, persistCore}) ───

/**
 * 錨點:buildBase(選材與組稿計畫:used 取新排序(不排序會讓累積式深化名存實亡)、既有核心續版)
 *
 * 讀 msg.data(target、_domain、_workflow.pipeline);寫 msg.data._plan({used,coreSlug,file,priorBody,basePrompt,stages});不短路(恆呼叫 next)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Integer} [opt.notesPerTarget] 輸入每次組稿取用之最新筆記數上限，未給則用 settings.knowledge.distillNotesPerConcept
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwBuildBase = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'buildBase',
        handle: async (msg, ctx, next) => {
            const { dirs } = ctx.deps
            const { target: t, _domain: domain, _workflow: workflow } = msg.data
            const used = t.notes.slice()
                .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
                .slice(0, opt.notesPerTarget ?? ctx.deps.settings.knowledge.distillNotesPerConcept)
            const coreSlug = t.core?.id || slugify(t.concept, `core|${t.concept}`)
            const file = path.join(dirs.core, `${coreSlug}.md`)
            const priorBody = t.core ? (readMd(file)?.body || '') : ''
            const basePrompt = domain.buildBasePrompt(t, used, priorBody)
            msg.data._plan = {
                used,
                coreSlug,
                file,
                priorBody,
                basePrompt,
                stages: buildWorkflowStages(workflow.pipeline, domain.kinds, { concept: t.concept, basePrompt }),
            }
            return next(msg)
        },
    })
}

/**
 * 錨點:runWorkflow(工作流執行:fanout(並行多開)→整合→串行角色鏈;實績走 onSeat 回調)
 *
 * 讀 msg.data(target、_domain、_workflow、_plan);寫 msg.data._raw(工作流原始結果);不短路(恆呼叫 next)
 *
 * 【時間預算聯動】各名額之 budgetMs 只保證「走完自己的遞補鏈」,A/B 兩段串起來的總和
 *   可超過整輪預算(依 2026-09 設定最壞 66 分 > 排程 55 分;2026-08-28 11:00 輪第二概念卡到被砍)。
 *   故把 ctx.expired() 接成 w-dispatch-ai 的 shouldStop:逾預算後每次嘗試之間即中止(ABORTED),
 *   已完成之 A 段整合稿仍可由 adoptResult 降級採用——當輪成果不因硬砍而全丟。
 * 【逐次事件寫日誌】工作流內的嘗試/遞補/中止原本只進用量計帳,卡住 45 分鐘日誌全無痕跡;
 *   現在成交記 info、失敗類記 warn(巡檢已列為已知常態),計帳仍由本回調轉呼叫 usage。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Function} [opt.shouldStop] 輸入時間預算守門函數，未給則用 budgetOf(ctx).shouldStop
 * @param {Function} [opt.onSeat] 輸入席位成交回調 (name, seatResult) => void，未給則用 ctx.deps.ai.recordCall
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwRunWorkflow = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'runWorkflow',
        handle: async (msg, ctx, next) => {
            const { target: t, _domain: domain, _workflow: workflow, _plan: plan } = msg.data
            const ai = ctx.deps.ai
            const budget = budgetOf(ctx)
            const shouldStop = opt.shouldStop || budget.shouldStop
            // aiCalls 計實際嘗試(try 事件),不計名目席位數:遞補與重試會讓實際次數遠大於席位數
            //(2026-09-09 11:00 輪報 16 次,實際成交＋遞補略過 >30 次),巡檢的用量判讀因此失真
            let tries = 0
            /** 轉呼叫調度層之統一入口(計帳＋供應商健康);累計 try 事件次數(tries),其餘轉寫日誌 */
            const onEvent = (ev) => {
                // 轉呼叫調度層之統一入口(計帳＋供應商健康);舊版 adapter 只有 usage.onEvent 時退回之
                try {
                    (ai?.onEvent || ai?.usage?.onEvent)?.(ev)
                }
                catch { /* 計帳失敗不影響工作流 */ }
                if (!ev) return
                if (ev.type === 'try') {
                    tries++; return
                }
                const tag = `提煉事件[${t.concept}]`
                if (ev.type === 'ok') ctx.log.info(`${tag} ${ev.keyId || ev.providerId || ''} 成交（${Math.round((ev.durationMs || 0) / 1000)}s）`)
                else ctx.log.warn(`${tag} ${ev.type} ${ev.keyId || ev.providerId || ''}${ev.error ? `：${oneline(ev.error, 120)}` : ''}`)
            }
            // 席位預算以「開工當下」的剩餘時間封頂(core/budget 之 capSeat 以 getter 於工作流展開該席位時求值):
            // dispatchAiFallback 以剩餘預算封頂每次嘗試之 timeout,進行中的最後一次呼叫才會在截止時被切斷。
            // 此前席位預算為靜態鏈總和,shouldStop 只擋「下一次嘗試」——2026-09-09 10:00/11:00 兩輪各超過截止
            // 210s/196s 皆出於末席位之 sonnet 254s;第一版修正在工作流開工時取一次剩餘時間,序列後段席位拿到的是
            // 數十分鐘前的值,對同一 case 仍不生效(2026-09-12 複審 B3)
            const r = await workflow.wkf.runFanoutPipeline({
                task: plan.basePrompt,
                agents: workflow.fanout.indeps.map(budget.capSeat),
                integrate: budget.capSeat(workflow.fanout.integrate),
                check: domain.checkCore,
                schema: domain.coreSchema,
                stages: plan.stages.map(budget.capSeat),
                callOpt: { shouldStop, onEvent },
            })
            // 實際被呼叫之席位(有結果者):aiCalls＝任務數,與萃取/關聯之批次數同義;aiAttempts＝含遞補之嘗試數
            const seats = [
                ...(r.A?.agents || []).map((x, i) => [`起草${i + 1}`, x]),
                ['整合', r.A?.integrateDetail],
                ...plan.stages.map((s) => [s.id, r.B?.stages?.[s.id]]),
            ].filter(([, x]) => x)
            const onSeat = opt.onSeat || (ctx.deps.ai?.recordCall && ((name, x) => ctx.deps.ai.recordCall(x)))
            if (onSeat) for (const [name, x] of seats) onSeat(name, x)
            count(msg, 'aiCalls', seats.length || (tries ? 1 : 0))
            count(msg, 'aiAttempts', tries)
            msg.data._raw = r
            return next(msg)
        },
    })
}

/**
 * 錨點:adoptResult(採稿:走完用定稿;審計鏈失敗降級採 A 整合稿(欄位名 result——曾因寫錯靜默失效);全敗短路)
 *
 * 讀 msg.data(target、_raw);寫 msg.data._result(採用之定稿);短路:全敗(無 r.ok 亦無 r.A.result)時直接回傳 msg(不呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwAdoptResult = () => defineMw({
    name: 'adoptResult',
    handle: async (msg, ctx, next) => {
        const { target: t, _raw: r } = msg.data
        if (r.ok) {
            msg.data._result = r.result
            ctx.log.info(`提煉[${t.concept}]：工作流走完（共 ${Math.round((r.totalMs || 0) / 1000)}s）`)
        }
        else if (r.A?.result) {
            // 【降級採用整合稿】審計鏈失敗時 A 段整合稿仍是合格成品,棄之等於 fanout＋整合白做。
            // 修訂稿不採用——半套審計的中間態不可信。
            msg.data._result = r.A.result
            ctx.log.warn(`提煉[${t.concept}]：審計鏈失敗（${r.error}）→ 降級採用 A 整合稿`)
        }
        else {
            ctx.log.warn(`提煉[${t.concept}]：工作流失敗（${r.error}）`)
            return msg // 短路:本概念本輪無產出
        }
        return next(msg)
    },
})

/**
 * 錨點:renderCore(版型組裝:版本遞增＋front/body,不落地;replace 此環＝換核心版型)
 *
 * 讀 msg.data(target.core.version、_domain、_plan.used、_result);寫 msg.data._render({version,front?,body});不短路(恆呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwRenderCore = () => defineMw({
    name: 'renderCore',
    handle: async (msg, ctx, next) => {
        const { target: t, _domain: domain, _plan: plan, _result: data } = msg.data
        const version = (t.core?.version || 0) + 1
        msg.data._render = { version, ...domain.renderCore(t, data, plan.used, { version }) }
        return next(msg)
    },
})

/**
 * 錨點:persistCore(版本化落盤:md＋cores 索引＋筆記 distilledAt 標記)
 *
 * 讀 msg.data(target、_plan、_result、_render);不寫 msg.data(落地為 md 檔、stores.cores、stores.notes);不短路(恆呼叫 next)
 *
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwPersistCore = () => defineMw({
    name: 'persistCore',
    handle: async (msg, ctx, next) => {
        const { stores, clock } = ctx.deps
        const { target: t, _plan: plan, _result: data, _render: rendered } = msg.data
        writeMd(plan.file, {
            // 識別與版本欄位由套件掌管(機制);其餘 frontmatter 由 domain 補(內容)
            concept: t.concept,
            slug: plan.coreSlug,
            type: 'core',
            scope: t.scope || 'concept',
            version: rendered.version,
            note_count: t.notes.length,
            notes: plan.used.map((n) => n.id),
            updated: clock.iso8(),
            ...(rendered.front || {}),
        }, rendered.body)

        await stores.cores.replace({
            id: plan.coreSlug,
            concept: t.concept,
            scope: t.scope || 'concept',
            file: plan.file.replace(/\\/g, '/'),
            noteCount: t.notes.length,
            noteIds: plan.used.map((n) => n.id),
            version: rendered.version,
            essence: String(data.essence || '').replace(/\s+/g, ' ').slice(0, 300),
            updatedAt: clock.iso8(),
        })
        for (const n of plan.used) await stores.notes.patch(n.id, { distilledAt: clock.iso8() })

        count(msg, 'updated')
        ctx.log.info(`提煉[${t.concept}]：v${rendered.version} 完成（依據 ${plan.used.length} 篇，概念累計 ${t.notes.length} 篇）`)
        return next(msg)
    },
})

/**
 * 提煉子階段:選題(概念層 gain 優先、類別層後備)→ 並行逐概念鏈 → 軟性截止。hook 錨點:distill.distill.{buildBase, runWorkflow, adoptResult, renderCore, persistCore}
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)
 * @param {Object} [opt.domain] 輸入整組置換之提煉領域物件，未給則用 ctx.deps.domains.distill
 * @param {Object} [opt.workflow] 輸入整組置換之工作流物件({wkf,fanout,pipeline})，未給則用 ctx.deps.getDistillWorkflow()
 * @param {Function} [opt.onSeat] 輸入席位成交回調，傳給 mwRunWorkflow
 * @param {Function} [opt.shouldStop] 輸入工作流中止判定，傳給 mwRunWorkflow，預設 ctx.expired
 * @param {Integer} [opt.minNotes] 輸入概念層選題之最少筆記數門檻，傳給 pickConcepts
 * @param {Integer} [opt.notesPerTarget] 輸入每次組稿取用之最新筆記數上限，傳給 mwBuildBase
 * @param {Integer} [opt.parallel] 輸入本輪並行概念數，未給則用 settings.knowledge.distillPerRun
 * @param {Object} [opt.categoryFallback] 輸入類別層後備選題之門檻設定，未給則用 settings.knowledge.categoryFallback
 * @param {Function} [opt.deadline] 輸入軟性截止判定函數，未給則用 budgetOf(ctx).expired
 * @param {Integer} [opt.minRemainingMs=600000] 輸入開工門檻:剩餘時間不足即不開工之毫秒數，未給則用 settings.knowledge.distillMinRemainingMs
 * @returns {Object} 回傳 stage 物件 { name, run }
 */
export function stageDistill(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps(
        [mwBuildBase(opt), mwRunWorkflow(opt), mwAdoptResult(opt), mwRenderCore(opt), mwPersistCore(opt)],
        opt.tap, { chainName: 'distill.distill' },
    )

    return {
        name: 'distill',
        run: async (ctx) => {
            const { stores, settings } = ctx.deps
            const log = ctx.log
            const stat = { concepts: 0, updated: 0, aiCalls: 0, aiAttempts: 0 }
            const budget = budgetOf(ctx)
            const deadline = opt.deadline || budget.expired
            // 開工門檻:剩餘時間不足一個概念之合理下限即不開工(整個工作流最短亦需數分鐘;開了只會在截止時被切斷、
            // 白耗前段席位)。門檻可由 opt.minRemainingMs／knowledge.distillMinRemainingMs 覆寫,預設 10 分
            const minRemainingMs = opt.minRemainingMs ?? settings.knowledge?.distillMinRemainingMs ?? 600_000
            const remainingMs = budget.remainingMs()

            if (deadline() || remainingMs < minRemainingMs) {
                log.info(`提煉：${deadline() ? '逾時間預算' : `剩餘時間預算 ${Math.round(remainingMs / 1000)}s 不足下限 ${Math.round(minRemainingMs / 1000)}s`}，本輪不再提煉`)
                return stdReport({ detail: { ...stat, skippedForBudget: true } })
            }
            const domain = opt.domain || ctx.deps.domains.distill
            const workflow = opt.workflow || ctx.deps.getDistillWorkflow?.()
            if (!workflow?.wkf) throw new Error('提煉子階段需要 workflow.wkf（AI 調度層之工作流;由 cfg.ai 或 opt.workflow 提供）')

            const notes = await stores.notes.select()
            const cores = await stores.cores.select()
            const parallel = opt.parallel ?? settings.knowledge.distillPerRun
            let targets = pickConcepts(notes, cores, { minNotes: opt.minNotes ?? settings.knowledge.distillMinNotes }).slice(0, parallel)
            if (targets.length === 0) {
                targets = pickCategories(notes, cores, opt.categoryFallback || settings.knowledge.categoryFallback || {}).slice(0, parallel)
                if (targets.length > 0) log.info(`提煉：概念層無合格群組，改走類別層（${targets.map((t) => t.concept).join('、')}）`)
            }
            if (targets.length === 0) {
                log.info('提煉：無累積足量新筆記的概念或類別')
                return stdReport({ detail: stat })
            }
            stat.concepts = targets.length

            // 逐概念鏈走 runChainOverMsgs(與其他子階段同一執行器:可 ctx.emit、拋錯隔離記 fail)
            const results = await Promise.all(targets.map(async (t) => {
                const msg = makeMsg('concept', { target: t, _domain: domain, _workflow: workflow }, { stage: 'distill' })
                const r = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'distill.distill' })
                if (r.fails) log.warn(`提煉異常[${t.concept}]：${r.errors.join('；')}`)
                // 失敗＝鏈拋錯,或工作流全敗於 adoptResult 短路(無產出);降級採 A 稿仍算成功
                return { updated: r.stats.updated || 0, aiCalls: r.stats.aiCalls || 0, aiAttempts: r.stats.aiAttempts || 0, failed: r.fails + (r.halts.adoptResult || 0) }
            }))
            let failedCount = 0
            for (const s of results) {
                stat.updated += s.updated || 0
                stat.aiCalls += s.aiCalls || 0
                stat.aiAttempts += s.aiAttempts || 0
                failedCount += s.failed || 0
            }
            stat.failed = failedCount
            // fail＝無產出之概念數(此前手組 report 恆 fail:0,工作流全敗被吸收成「一切正常」)
            return stdReport({
                stats: { in: stat.concepts, out: stat.updated, skip: 0, fail: failedCount, aiCalls: stat.aiCalls },
                detail: stat,
            })
        },
    }
}

export default stageDistill
