// indexStage.mjs — 知識庫入口索引重建（泛用：吃正準欄位，不認識領域內容）
//
// 【正準欄位】notes: {id,title,category,concepts,evidenceLevel,caveats,createdAt}
//   cores: {id,concept,version,noteCount,essence}(正準 schema,套件契約欄位)。
//   品質標注上索引：讓翻索引就看得到證據強弱與品質警示，不必逐篇點開。

import fs from 'fs'
import path from 'path'

// ─── 子階段包裝(hook 錨點:index.rebuild;always:索引反映庫的現況,前段倒了仍要重建) ───

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { defineMw, applyTaps, makeMsg, runChainOverMsgs, stdReport } from '../core/kernel.mjs'
import { renderFrontmatter } from '../md/md.mjs'

/**
 * 重建知識庫入口索引(index.md):核心知識依 noteCount 降冪、筆記依類別分組再依建立時間降冪
 *
 * @param {Object} cfg 輸入設定物件，需含 stores({notes,cores,relations}，皆須有 select 方法)與 dir(輸出目錄字串)
 * @param {Object} cfg.stores 輸入集合物件 { notes, cores, relations }
 * @param {String} cfg.dir 輸入輸出目錄路徑字串
 * @param {String} [cfg.nowIso] 輸入現在時刻 ISO 字串，寫入 frontmatter 之 updated 與內文
 * @param {String} [cfg.title='知識庫索引'] 輸入標題
 * @returns {Promise} 回傳 Promise，resolve 回傳 {notes:Integer, cores:Integer, edges:Integer}(副作用為寫入 index.md)
 * @throws {Error} cfg 非物件、cfg.dir 非有效字串、或 cfg.stores 缺 notes/cores/relations 之 select 方法時拋出
 */
export async function rebuildKnowledgeIndex(cfg) {

    //check
    if (!isobj(cfg) || !isestr(cfg.dir) || !isobj(cfg.stores) ||
        !isfun(cfg.stores.notes?.select) || !isfun(cfg.stores.cores?.select) || !isfun(cfg.stores.relations?.select)) {
        throw new Error('rebuildKnowledgeIndex 需要 { stores, dir }')
    }

    const { stores } = cfg
    const notes = await stores.notes.select()
    const cores = await stores.cores.select()
    const edges = await stores.relations.select()

    const byCategory = new Map()
    for (const n of notes) {
        const c = n.category || '其他'
        if (!byCategory.has(c)) byCategory.set(c, [])
        byCategory.get(c).push(n)
    }

    const title = cfg.title || '知識庫索引'
    // frontmatter 走 md/renderFrontmatter(與筆記同一序列化):此前手寫 `title: "${title}"`,標題含雙引號即產出解析不回去的檔頭
    const lines = [
        renderFrontmatter({ title, type: 'index', updated: cfg.nowIso, notes: notes.length, cores: cores.length, relations: edges.length }), '',
        `# ${title}`, '',
        `- 知識筆記 ${notes.length} 篇｜核心知識 ${cores.length} 則｜關聯 ${edges.length} 條`,
        `- 更新於 ${cfg.nowIso}`, '',
        '## 核心知識（提煉）', '',
    ]
    for (const c of cores.sort((a, b) => (b.noteCount || 0) - (a.noteCount || 0))) {
        lines.push(`- [[${c.id}]] **${c.concept}**（v${c.version}，依據 ${c.noteCount} 篇）：${String(c.essence || '').replace(/\s+/g, ' ').slice(0, 120)}`)
    }
    if (cores.length === 0) lines.push('（尚未累積足量筆記）')

    lines.push('', '## 知識筆記（依類別）', '')
    for (const [cat, list] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`### ${cat}（${list.length}）`, '')
        for (const n of list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))) {
            const warn = (n.caveats || []).length ? `｜⚠${(n.caveats || []).length}` : ''
            lines.push(`- [[${n.id}]] ${n.title}｜證據:${n.evidenceLevel || '未評估'}${warn}｜概念：${(n.concepts || []).join('、')}`)
        }
        lines.push('')
    }
    fs.writeFileSync(path.join(cfg.dir, 'index.md'), lines.join('\n'), 'utf8')
    return { notes: notes.length, cores: cores.length, edges: edges.length }
}

/**
 * 錨點:rebuild(知識庫入口索引重建;hook 錨點 index.rebuild)
 *
 * 不讀 msg.data(以 maintenance 空訊息觸發);寫 msg.data._idx({notes,cores,edges});不短路(恆呼叫 next)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {String} [opt.title] 輸入索引標題，未給則用 settings.indexTitle
 * @returns {Object} 回傳 defineMw 產物
 */
export const mwRebuildKnowledgeIndex = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'rebuild',
        handle: async (msg, ctx, next) => {
            const { stores, clock, dirs, settings } = ctx.deps
            const idx = await rebuildKnowledgeIndex({ stores, dir: dirs.knowledge, nowIso: clock.iso8(), title: opt.title || settings.indexTitle })
            msg.data._idx = idx
            return next(msg)
        },
    })
}

/**
 * 知識庫入口索引重建子階段(泛用:吃正準欄位,不認識領域內容)。hook 錨點:index.rebuild
 *
 * always:索引反映庫的現況,前段倒了仍要重建;when:cfg.dirs.knowledge 未設定時不跑(無輸出目錄可寫)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)
 * @param {String} [opt.title] 輸入索引標題，傳給 mwRebuildKnowledgeIndex
 * @returns {Object} 回傳 stage 物件 { name, always, when, run }
 */
export function stageKnowledgeIndex(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps([mwRebuildKnowledgeIndex(opt)], opt.tap, { chainName: 'index' })
    return {
        name: '索引',
        always: true,
        when: (ctx) => !!ctx.deps.dirs?.knowledge,
        run: async (ctx) => {
            const msg = makeMsg('maintenance', {})
            const r = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'index' })
            const idx = msg.data._idx || { notes: 0, cores: 0, edges: 0 }
            return stdReport({
                ok: r.fails === 0,
                stats: { in: 1, out: 1, fail: r.fails },
                detail: idx,
                summary: `筆記 ${idx.notes}、核心 ${idx.cores}、關聯 ${idx.edges}`,
            })
        },
    }
}

export default rebuildKnowledgeIndex
