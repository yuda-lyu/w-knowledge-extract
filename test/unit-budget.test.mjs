// unit-budget.test.mjs — 時間預算單一擁有者(core/budget):各段只消費 budgetOf(ctx),不各自持有數字
// 執行:npx mocha test/unit-budget.test.mjs

import assert from 'node:assert/strict'
import { budgetOf } from '../src/core/budget.mjs'


describe('unit-budget', function() {

    it('無截止(ctx 無 remainingMs)：剩餘無限、不逾期、封頂原樣回傳、席位不動', () => {
        const b = budgetOf({})
        assert.equal(b.remainingMs(), Infinity)
        assert.equal(b.expired(), false)
        assert.equal(b.shouldStop(), false)
        assert.equal(b.capMs(5000), 5000)
        assert.equal(b.capMs(Infinity), Infinity, '無截止時交給呼叫端的預設(dispatchAiFallback 自算鏈總和)')
        const seat = { use: 'x', budgetMs: 1234 }
        assert.equal(b.capSeat(seat), seat, '無截止不包裝席位(原物件)')
        assert.equal(budgetOf(null).remainingMs(), Infinity, 'ctx 缺席亦不拋')
    })

    it('有截止：capMs 取 min(要求, 剩餘)、下限 1ms;NaN 之剩餘視為無限', () => {
        let left = 5000
        const b = budgetOf({ remainingMs: () => left, expired: () => left <= 0 })
        assert.equal(b.remainingMs(), 5000)
        assert.equal(b.capMs(10_000), 5000)
        assert.equal(b.capMs(3000), 3000)
        assert.equal(b.capMs(Infinity), 5000, '無要求即以剩餘為上限')
        assert.equal(b.capMs(0), 5000, '非正數之要求視為無要求')
        left = 0
        assert.equal(b.capMs(3000), 1, '逾期後仍回 1ms(呼叫端以 shouldStop 守門,不靠 0 預算)')
        assert.equal(b.expired(), true)
        assert.equal(b.shouldStop(), true, 'shouldStop 即 expired(w-dispatch-ai 於嘗試之間詢問)')
        left = -100
        assert.equal(b.remainingMs(), 0, '負值夾為 0')
        left = NaN
        assert.equal(b.remainingMs(), Infinity)
        assert.equal(b.capMs(7000), 7000)
    })

    it('capSeat：budgetMs 為 getter,於席位「開工當下」(被展開時)才求值——序列後段席位拿到當時的剩餘', () => {
        let left = 8000
        const b = budgetOf({ remainingMs: () => left, expired: () => left <= 0 })
        const seat = { use: 'a', fallback: ['b'], budgetMs: 10_000 }
        const s = b.capSeat(seat)
        assert.notEqual(s, seat, '不改原席位')
        assert.deepEqual(Object.keys(s).sort(), ['budgetMs', 'fallback', 'use'], 'getter 可列舉——工作流以 spread 展開席位時不得消失')
        assert.equal(s.budgetMs, 8000, '開工時剩餘 8s < 席位 10s → 封頂 8s')
        left = 2000
        assert.equal({ ...s }.budgetMs, 2000, '數十分鐘後才輪到的席位,展開時取到當下剩餘(複審 B3)')
        left = 20_000
        assert.equal({ ...s }.budgetMs, 10_000, '剩餘充裕時維持席位自身預算')
        const noBudget = b.capSeat({ use: 'c' })
        assert.equal(noBudget.budgetMs, 20_000, '席位未給預算者以剩餘為預算')
        assert.equal(b.capSeat(null), null)
        assert.equal(b.capSeat('str'), 'str')
    })

})
