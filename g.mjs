import fs from 'fs'
import WKnowledgeExtract from './src/WKnowledgeExtract.mjs'


let { createKnowledgeExtract } = WKnowledgeExtract


let test = async () => {
    let ms = []

    //workDir, 知識庫根目錄(唯一必填): db/log/state/knowledge/tmp 等皆由此展開, 筆記 md 位於 knowledge/notes, 核心知識 md 與狀態檔寫入 knowledge/core
    let workDir = './_test_knowledge_extract'
    fs.rmSync(workDir, { recursive: true, force: true })
    let notesDir = `${workDir}/knowledge/notes`
    fs.mkdirSync(notesDir, { recursive: true })

    //notes, 模擬摘要套件交出之筆記(記錄與 md), 實務上由 w-knowledge-summarize 寫入同一個 workDir, 關聯由 w-knowledge-relate 完成(relatedAt 非空代表已關聯)
    let landNote = (id, title, concepts, summary, points) => {
        let file = `${notesDir}/${id}.md`
        let md = [
            '---',
            `title: "${title}"`,
            `slug: "${id}"`,
            `concepts: [${concepts.map((c) => `"${c}"`).join(', ')}]`,
            'type: "note"',
            '---',
            '',
            `# ${title}`,
            '',
            '## 一句話重點',
            '',
            summary,
            '',
            '## 核心知識',
            '',
            ...points.map((p) => `- ${p}`),
            '',
        ].join('\n')
        fs.writeFileSync(file, md, 'utf8')
        return { id, title, category: '方法與技術', concepts, summary, claimType: '實證研究', evidenceLevel: '中', file, createdAt: '2026-09-01T00:00:00+08:00', relatedAt: '2026-09-02T00:00:00+08:00', extractedAt: '' }
    }
    let notes = [
        landNote('accretion-disk', '黑洞吸積盤之輻射機制', ['黑洞', '吸積盤'], '吸積盤氣體因摩擦加熱，並以 X 射線輻射出重力位能。', ['盤內緣溫度可達百萬度以上']),
        landNote('black-hole-spin', '以鐵譜線輪廓量測黑洞自旋', ['黑洞', '自旋'], '由 X 射線光譜中鐵譜線的輪廓，可推估吸積盤內緣位置與黑洞自旋。', ['譜線輪廓愈寬，內緣愈靠近黑洞']),
        landNote('jet-launching', '相對論噴流之發射', ['黑洞', '噴流'], '吸積盤磁場把部分物質沿自旋軸加速成相對論噴流。', ['噴流功率與自旋及磁場強度相關']),
    ]

    //aiAdapter, AI 調度層替身(cfg.aiAdapter 為正當擴充口): 依提示詞首句判斷 3+3 工作流之角色並作答, 離線可跑
    //  起草(三席)每篇筆記提一條「規則」主張並立本質, 整合收入第一份候選, 審計無意見, 終審逐條保留
    let calls = []
    let roleOf = (prompt) => {
        let roles = [[/^你是.*?的提煉器。/, 'draft'], [/^你是.*?的整合員。/, 'integrate'], [/^你是.*?的審計員。/, 'audit'], [/^你是.*?的修訂員。以下是「/, 'revise'], [/^你是.*?的終審員。/, 'accept']]
        return (roles.find(([re]) => re.test(prompt)) || [null, 'other'])[1]
    }
    let answerOf = {
        draft: (prompt) => {
            let batch = [...prompt.matchAll(/^### (N\d+) (\S*)/gm)].map((m) => ({ code: m[1], title: m[2] }))
            let ann = { critique: '僅單一案例', pros: ['出處未載'], cons: ['出處未載'] }
            return {
                ops: [
                    ...batch.map((n, k) => ({ op: 'add', ref: `r${k}`, kind: 'rule', text: `主張：${n.title}`, basis: '案例', sources: [n.code], ...ann })),
                    { op: 'essence', text: '黑洞周圍之吸積盤、自旋與噴流彼此相扣', claims: ['@r0'], reason: '首版' },
                ],
                skipped: [],
            }
        },
        integrate: (prompt) => {
            let sec = prompt.split(/^【候選 (\d+)】$/m)[2] || ''
            let ops = sec.split('\n').filter((l) => /^a\d+_\d+（/.test(l)).map((l) => {
                let op = JSON.parse(l.slice(l.indexOf('{')))
                delete op._oid
                return { ...op, via: [l.match(/^(a\d+_\d+)（/)[1]] }
            })
            return { ops, skipped: [] }
        },
        audit: () => ({ issues: [] }),
        revise: () => ({ edits: [], adds: [], removes: [] }),
        accept: (prompt) => ({ verdicts: [...prompt.matchAll(/^i=(\d+) \{.*\}$/gm)].map((m) => ({ i: Number(m[1]), action: 'keep' })) }),
    }
    let answer = (prompt, opt) => {
        let role = roleOf(prompt)
        calls.push(role)
        let json = (answerOf[role] || (() => null))(prompt)
        let ok = json !== null && (typeof opt?.check !== 'function' || opt.check(json))
        return ok ? { ok: true, json, providerId: `stub-${role}`, ms: 1, tried: [{ providerId: `stub-${role}`, outcome: 'ok' }] } : { ok: false, error: '替身形狀不合', tried: [] }
    }
    let wkf = {
        runFanout: async ({ task, agents }) => ({ ok: true, agents: agents.map((a) => answer(task, a)) }),
        callAi: async (prompt, opt) => answer(prompt, opt),
    }
    let aiAdapter = {
        getWkf: () => wkf,
        seatSpec: (seat) => (seat ? { use: seat.use, fallback: [], timeoutMs: 60000 } : null),
        recordCall: () => {},
    }

    //flow, 總組裝: 內建設定/詞彙/提示詞/檢定標準/LMDB/鎖/日誌/執行摘要走預設, 只置換 AI 調度層; extract 僅調降新核心門檻與批量以適應 3 篇筆記
    let silent = { info: () => {}, warn: () => {}, error: () => {} }
    let flow = createKnowledgeExtract({
        workDir,
        data: {
            vocab: { domain: '天文學' }, //主題範圍(選填), 提示詞之領域句據此限定, 未給即不限主題
        },
        extract: { minNotes: 2, notesPerConcept: 3, perRun: 1 },
        aiAdapter,
        scheduleLimitMin: 60, //排程執行上限(分鐘), 整輪時間預算與鎖陳舊期限由此推導
        afterRun: false, //無收尾鉤子
        logFactory: () => silent, //靜音日誌(預設每輪寫 log/<day>/<stamp>-run.log)
    })

    //stores, 寫入筆記記錄(實務上由摘要套件寫入, 此處直接插入作為輸入)
    let stores = flow.openStores()
    await stores.notes.insertNew(notes)
    await flow.closeStores(stores)

    //run, 一輪: 選題 → 3+3 工作流(起草→整合→審計→終審)→ 套用 → 寫狀態檔與核心 md
    let r = await flow.run()
    ms.push({ round: `ok[${r.ok}], ` + r.stages.map((s) => `${s.name}[${s.status}]`).join(', ') })
    ms.push({ summary: r.stages[0].result.summary })

    //stores, 讀回結果(狀態檔為真理, 核心 md 與 cores 記錄為其投影)
    stores = flow.openStores()
    let cs = await stores.cores.select()
    ms.push({ cores: cs.map((c) => `${c.concept}｜${c.noteCount} 篇`) })
    let ns = await stores.notes.select()
    ms.push({ extracted: ns.map((n) => `${n.id}｜${n.extractedAt ? '已提煉' : '未提煉'}`).sort() })
    await flow.closeStores(stores)
    let files = fs.readdirSync(`${workDir}/knowledge/core`).sort()
    ms.push({ coreFiles: files.map((f) => f.replace(cs[0].id, '<核心 id>')) })
    let md = fs.readFileSync(`${workDir}/knowledge/core/${cs[0].id}.md`, 'utf8')
    ms.push({ mdSection: md.split('\n').filter((l) => l.startsWith('## ')) })
    ms.push({ calls })

    //clear
    fs.rmSync(workDir, { recursive: true, force: true })

    console.log('ms', ms)
    return ms
}
await test()
    .catch((err) => {
        console.log(err)
    })
// => ms [
//   { round: 'ok[true], 提煉[ok]' },
//   { summary: '概念 1、更新 1 則核心、消化 3 篇（AI 6 次）' },
//   { cores: [ '黑洞｜3 篇' ] },
//   {
//     extracted: [
//       'accretion-disk｜已提煉',
//       'black-hole-spin｜已提煉',
//       'jet-launching｜已提煉'
//     ]
//   },
//   { coreFiles: [ '<核心 id>.md', '<核心 id>.state.json' ] },
//   { mdSection: [ '## 本質', '## 可操作規則', '## 提煉自' ] },
//   {
//     calls: [ 'draft', 'draft', 'draft', 'integrate', 'audit', 'accept' ]
//   }
// ]
