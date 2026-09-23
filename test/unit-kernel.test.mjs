// unit-kernel.test.mjs — middleware 核心的回歸測試
// 執行:npx mocha test/unit-kernel.test.mjs

import assert from 'node:assert/strict'
import { defineMw, defineFirstMw, applyTaps, makeMsg, count, composeChain, runChainOverMsgs, stdReport, MwContractError } from '../src/core/kernel.mjs'

const tag = (name, trace) => defineMw({
    name,
    handle: async (msg, ctx, next) => {
        trace.push(`${name}↓`); const r = await next(msg); trace.push(`${name}↑`); return r
    }
})

describe('unit-kernel', function() {

    // ── 洋蔥語意 ──
    it('洋蔥順序:下行依序、上行反序(Koa compose)', async () => {
        const trace = []
        const run = composeChain([tag('a', trace), tag('b', trace), tag('c', trace)])
        await run(makeMsg('doc', {}), {})
        assert.deepEqual(trace, ['a↓', 'b↓', 'c↓', 'c↑', 'b↑', 'a↑'])
    })

    it('短路:不呼叫 next 即完結,halted 記錄短路者,後段不執行', async () => {
        const trace = []
        const gate = defineMw({
            name: 'gate',
            handle: async (msg) => {
                trace.push('gate'); return msg
            }
        })
        const run = composeChain([tag('a', trace), gate, tag('c', trace)])
        const { halted } = await run(makeMsg('doc', {}), {})
        assert.equal(halted, 'gate')
        assert.deepEqual(trace, ['a↓', 'gate', 'a↑'], 'c 不得執行;a 的上行仍要走完(收尾語意)')
    })

    it('topics/when 不合 → 原樣放行(透明),不算短路', async () => {
        const trace = []
        const onlyNote = defineMw({
            name: 'onlyNote',
            topics: ['note'],
            handle: async (msg, ctx, next) => {
                trace.push('onlyNote'); return next(msg)
            }
        })
        const skipEven = defineMw({
            name: 'skipEven',
            when: (m) => m.data.i % 2 === 1,
            handle: async (msg, ctx, next) => {
                trace.push('skipEven'); return next(msg)
            }
        })
        const run = composeChain([onlyNote, skipEven, tag('z', trace)])
        const { halted } = await run(makeMsg('doc', { i: 2 }), {})
        assert.equal(halted, '')
        assert.deepEqual(trace, ['z↓', 'z↑'], '兩顆都透明放行')
    })

    it('msg 沿鏈傳遞:next(m2) 換信封後,下游收到 m2', async () => {
        const swap = defineMw({ name: 'swap', handle: (msg, ctx, next) => next(makeMsg('doc', { swapped: true })) })
        const probe = defineMw({
            name: 'probe',
            handle: (msg, ctx, next) => {
                assert.equal(msg.data.swapped, true); return next(msg)
            }
        })
        await composeChain([swap, probe])(makeMsg('doc', { swapped: false }), {})
    })

    // ── first 錨點 ──
    it('first:候選依序試,第一個非空者勝出,結果與勝者記入 _first', async () => {
        const first = defineFirstMw({
            name: 'route',
            candidates: [
                { name: 'c1', probe: () => null },
                { name: 'c2', probe: () => 'hit2' },
                {
                    name: 'c3',
                    probe: () => {
                        throw new Error('不該試到 c3')
                    }
                },
            ],
        })
        const msg = makeMsg('doc', {})
        await composeChain([first])(msg, {})
        assert.equal(msg.data._first.route, 'hit2')
        assert.equal(msg.data._first.routeBy, 'c2')
    })

    it('first:tap add 追加候選;enforce pre 插頭', async () => {
        const first = defineFirstMw({ name: 'route', candidates: [{ name: 'c1', probe: () => 'base' }] })
        const chain = applyTaps([first], { route: { add: [{ name: 'mine', probe: () => 'mine!', enforce: 'pre' }] } })
        const msg = makeMsg('doc', {})
        await composeChain(chain)(msg, {})
        assert.equal(msg.data._first.route, 'mine!', 'pre 候選插頭應先勝出')
        // 原鏈不受污染
        const msg2 = makeMsg('doc', {})
        await composeChain([first])(msg2, {})
        assert.equal(msg2.data._first.route, 'base')
    })

    // ── 認名掛載 ──
    it('tap before/after/replace:定位正確、enforce 分帶排序', async () => {
        const trace = []
        const chain = applyTaps(
            [tag('a', trace), tag('b', trace)],
            {
                b: {
                    before: [tag('pre2', trace), { ...tag('pre1', trace), enforce: 'pre' }],
                    after: [tag('post1', trace)],
                    replace: tag('B2', trace),
                }
            },
        )
        await composeChain(chain)(makeMsg('doc', {}), {})
        const downs = trace.filter((s) => s.endsWith('↓')).map((s) => s.slice(0, -1))
        assert.deepEqual(downs, ['a', 'pre1', 'pre2', 'B2', 'post1'], 'pre 帶排最前;b 被 B2 置換')
    })

    it('tap 錨點不存在/未知鍵/對非 first 錨點 add → 定義期拋錯', () => {
        const base = [defineMw({ name: 'a', handle: (m, c, n) => n(m) })]
        assert.throws(() => applyTaps(base, { nope: { replace: base[0] } }), MwContractError)
        assert.throws(() => applyTaps(base, { a: { insert: [] } }), MwContractError)
        assert.throws(() => applyTaps(base, { a: { add: [{ name: 'x', probe: () => 1 }] } }), /非 first 錨點/)
    })

    it('鏈內 mw 名重複/非 defineMw 產物 → 定義期拋錯', () => {
        const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
        assert.throws(() => composeChain([a, defineMw({ name: 'a', handle: (m, c, n) => n(m) })]), /重複/)
        assert.throws(() => composeChain([a, { name: 'b', handle: () => {} }]), /非 defineMw/)
    })

    // ── 逐項執行與 emit ──
    it('runChainOverMsgs:stats 加總、emit 衍生訊息從鏈頭續跑、逐項隔離', async () => {
        const seen = []
        const splitter = defineMw({
            name: 'split',
            handle: async (msg, ctx, next) => {
                seen.push(msg.data.id)
                count(msg, 'seen')
                if (msg.data.id === 'mother') {
                    ctx.emit(makeMsg('doc', { id: 'child1' }, { from: 'mother' }))
                    ctx.emit(makeMsg('doc', { id: 'child2' }, { from: 'mother' }))
                }
                if (msg.data.id === 'boom') throw new Error('炸')
                return next(msg)
            },
        })
        const r = await runChainOverMsgs({
            chain: [splitter],
            ctx: {},
            chainName: 'test',
            msgs: [makeMsg('doc', { id: 'mother' }), makeMsg('doc', { id: 'boom' }), makeMsg('doc', { id: 'tail' })],
        })
        assert.deepEqual(seen, ['mother', 'boom', 'tail', 'child1', 'child2'], '衍生訊息排佇列尾、同鏈續跑')
        assert.equal(r.stats.seen, 4, 'boom 拋錯不計入(其 stats 丟棄)、其餘 4 項各計 1')
        assert.equal(r.fails, 1, '單項拋錯記 fail 不中斷')
        assert.match(r.errors[0], /炸/)
    })

    it('runChainOverMsgs:shouldStop 守門——回 true 即不再取件,未處理者計 left、其 stats 不計、記錄不動', async () => {
        let n = 0
        const tick = defineMw({
            name: 'tick',
            handle: async (msg, ctx, next) => {
                n++; count(msg, 'done'); return next(msg)
            }
        })
        const r = await runChainOverMsgs({
            chain: [tick],
            ctx: {},
            chainName: 'stop',
            msgs: [1, 2, 3, 4].map((i) => makeMsg('doc', { i })),
            shouldStop: () => n >= 2, // 第 3 筆取件前逾時間預算
        })
        assert.equal(n, 2, '進行中的那一筆跑完,之後不再取件')
        assert.equal(r.left, 2, '未處理者計 left(逐篇抓取據此回報「留下輪」)')
        assert.equal(r.stats.done, 2)
        assert.equal(r.fails, 0, '守門停止不是失敗')
        const r2 = await runChainOverMsgs({ chain: [tick], ctx: {}, msgs: [makeMsg('doc', {})] })
        assert.equal(r2.left, 0, '未給 shouldStop 時 left 恆 0(既有呼叫端不受影響)')
    })

    it('emit 超過上限 → 拋錯(無限衍生保險絲)', async () => {
        const loop = defineMw({
            name: 'loop',
            handle: async (msg, ctx, next) => {
                ctx.emit(makeMsg('doc', {})); return next(msg)
            }
        })
        const r = await runChainOverMsgs({ chain: [loop], ctx: {}, msgs: [makeMsg('doc', {})], maxEmits: 5, chainName: 'loop' })
        assert.ok(r.fails >= 1, '超限那次記 fail')
        assert.ok(r.errors.some((e) => /emit 超過上限/.test(e)))
    })

    // ── report ──
    it('stdReport:核心統計鍵一律補零(巡檢契約)', () => {
        const r = stdReport({ stats: { in: 3 }, summary: 'x' })
        assert.deepEqual(r.stats, { in: 3, out: 0, skip: 0, fail: 0, aiCalls: 0 })
        assert.equal(r.ok, true)
    })

    // ── 洋蔥契約:每環只可呼叫一次 next(2026-09-23 修:此前重複呼叫會讓下游整段再跑一次)──
    it('同一環重複呼叫 next → 拋 MwContractError,下游只跑一次(同 Koa compose)', async () => {
        let downstream = 0
        const twice = defineMw({
            name: 'twice',
            handle: async (m, c, next) => {
                await next(m); return next(m)
            }
        })
        const tail = defineMw({
            name: 'tail',
            handle: async (m, c, next) => {
                downstream++; return next(m)
            }
        })
        await assert.rejects(() => composeChain([twice, tail], { chainName: 'x' })(makeMsg('doc', {}), {}), (e) => e instanceof MwContractError && /重複呼叫 next/.test(e.message))
        assert.equal(downstream, 1, '第二次呼叫即拋錯,下游不得重跑(重複落庫/重複寫檔)')
        const r = await runChainOverMsgs({ chain: [twice, tail], ctx: {}, msgs: [makeMsg('doc', {})], chainName: 'x' })
        assert.equal(r.fails, 1, '逐項執行器將之記為該項失敗(隔離,不中斷整段)')
    })

})
