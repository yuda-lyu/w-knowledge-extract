// unit-extract-files.test.mjs — 提煉之待判字樣與期限(stores/extractHolds)、帳檔名之單一來源(EXTRACT_STATE_FILES、ATTEMPTS_FILE)、
//   失敗帳之連續失敗判讀(extractStuckOf)、核心狀態檔之目錄與存取器(coreStateDirOf、coreAuxDirs、coreStoreOf)、重設基準之名單
//   (requestRebaseline、rebaselineIdsOf)、重審預覽之依賴、他版狀態檔之錯誤碼、狀態欄 lineage 之宣告
// 規格:①待判之期限、物件名、標準識別只寫一處,各標準模組之物件常數取自之;面向使用者之下一步與提示指處置 API,不指執行端之指令
//   ②帳檔名各定義於其擁有之模組,彙集表與之同值、不重複;失敗帳之格式(計數欄、專步鍵)只在失敗帳模組,外部判讀經 extractStuckOf
//   ③只覆寫 core 者狀態檔與 md 同處;另給 coreState 者分開;上一版在附屬目錄,
//   壞檔自同一處還原——提煉段、重練與重審預覽同一組目錄 ④名單之指示者由呼叫端給(預設 'api');壞檔回空並回報 ⑤他版以錯誤碼分流
// 執行:在套件根 node <mocha> test/unit-extract-files.test.mjs(暫存落 test/_tmp/extract-files-<pid>〔tmpRoot〕,測完即刪〔removeRoots〕)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore } from './tools/captureForTest.mjs'
import { extractDirsOf, noteRow } from './tools/extractKit.mjs'
import { tmpRoot, removeRoots } from './tools/extractTestKit.mjs'
import { createRelateDomain } from '../src/core/relatePackage.mjs'
import {
    EXTRACT_HOLD_DEADLINE_DAYS, extractHoldDeadlineOf, EXTRACT_HOLD_OBJECTS, ES15, CORE_HOLD_OBJECT, EXTRACT_API_HINT, EXTRACT_HOLD_NEXT,
} from '../src/stores/extractHolds.mjs'
import { ATTEMPTS_FILE, EXTRACT_LEDGER_STEP_PREFIX, EXTRACT_STUCK_TRIES, createExtractLedger, extractStuckOf, coreLedgerKeyOf } from '../src/stores/extractLedger.mjs'
import { EXTRACT_LEDGER_CORRUPT_WORD, EXTRACT_LEDGER_SHAPES, readLedgerJson, saveLedgerJson } from '../src/stores/extractFiles.mjs'
import { coreStateDirOf, coreAuxDirs, coreStoreOf } from '../src/stores/coreStore.mjs'
import { emptyState, normalizeState, FOREIGN_STATE_CODE, CORRUPT_STATE_CODE, STATE_VERSION } from '../src/stores/coreState.mjs'
import { ES15_OBJECT } from '../src/standards/coreStandards.mjs'
import { ES14_OBJECT } from '../src/standards/disputeCheck.mjs'
import { CLAIM_OBJECT } from '../src/standards/supportStock.mjs'
import { ES11, pairKeyOf, pairOfKey } from '../src/standards/synonymCheck.mjs'
import { EXTRACT_STATE_FILES, IMPACT_RETRY_FILE, PENDING_DROPPED_FILE } from '../src/stages/extractStage.mjs'
import { newCoreIdOf } from '../src/stores/coreProjection.mjs'
import { CONTENT_CACHE_FILE, NO_TOP_CACHE_FILE } from '../src/stores/extractFiles.mjs'
import { EDGE_SEEN_FILE, IMPACT_LEDGER_FILE } from '../src/standards/relationImpact.mjs'
import { SYNONYM_STATE_FILE, SYNONYM_LEDGER_KEY } from '../src/stages/synonymStep.mjs'
import { previewRecheck } from '../src/ops/recheckOps.mjs'
import { REBASELINE_FILE, requestRebaseline, rebaselineIdsOf, cancelRebaseline, rebaselineDone } from '../src/stores/rebaseline.mjs'
import { REGEN_FILE } from '../src/stores/regenIntent.mjs'
import { createExtractDomain } from '../src/domain/extractDomain.mjs'

let TMP = ''
const CLI_WORDS = /standards\s+(retry|waive|audit)|<登錄鍵>|notes 工具|extract-baseline|openStores|flow\.info|CLI/

describe('unit-extract-files', function() {

    before(function() {
        TMP = tmpRoot('extract-files')
    })

    after(function() {
        removeRoots([TMP])
    })

    it('待判之期限與物件名只寫一處:期限 30 天;物件名凍結且與各標準模組之常數同值;ES15 之識別', () => {
        assert.equal(EXTRACT_HOLD_DEADLINE_DAYS, 30)
        assert.equal(extractHoldDeadlineOf('2026-10-05T10:00:00+08:00'), '2026-11-04T02:00:00.000Z')
        assert.throws(() => extractHoldDeadlineOf('不是時刻'), RangeError)
        assert.ok(Object.isFrozen(EXTRACT_HOLD_OBJECTS) && Object.isFrozen(ES15))
        assert.deepEqual(EXTRACT_HOLD_OBJECTS, { note: 'extract-note', dispute: 'dispute', claim: 'claim', corePair: 'core-pair', core: 'core' }, '持久化之值不變')
        assert.deepEqual(ES15, { std: 'ES15', object: 'extract-note' })
        assert.deepEqual([ES15_OBJECT, ES14_OBJECT, CLAIM_OBJECT, ES11.object, CORE_HOLD_OBJECT], ['extract-note', 'dispute', 'claim', 'core-pair', 'core'])
    })

    it('面向使用者之下一步與提示指處置 API(requestRetry、waiveHold、requestRebaseline、deleteNote／restoreNote、每輪依賴之 stores),不指執行端之指令', () => {
        assert.ok(Object.isFrozen(EXTRACT_HOLD_NEXT) && Object.isFrozen(EXTRACT_API_HINT))
        for (const [k, v] of [...Object.entries(EXTRACT_HOLD_NEXT), ...Object.entries(EXTRACT_API_HINT)]) {
            assert.equal(typeof v, 'string', k)
            assert.doesNotMatch(v, CLI_WORDS, k)
        }
        // 負責者為使用者之下一步皆寫明處置 API
        for (const k of ['noteOverdue', 'noteSupportUser', 'dispute', 'claimSupport', 'claimOrphan', 'synonymSame', 'synonymUser', 'coreStock']) assert.match(EXTRACT_HOLD_NEXT[k], /waiveHold/, k)
        for (const k of ['noteOverdue', 'noteSupportUser', 'dispute', 'claimSupport', 'claimOrphan']) assert.match(EXTRACT_HOLD_NEXT[k], /requestRetry/, k)
        assert.match(EXTRACT_API_HINT.holdsStore, /每輪依賴之 stores 給 holds/)
        assert.match(EXTRACT_API_HINT.checksStore, /每輪依賴之 stores 給 checks/)
        assert.match(EXTRACT_API_HINT.rebaseline, /requestRebaseline/)
        assert.match(EXTRACT_API_HINT.dangling, /deleteNote.*restoreNote/)
    })

    it('帳檔名之單一來源:EXTRACT_STATE_FILES 凍結、各值即其擁有之模組之常數、互不重複', () => {
        assert.ok(Object.isFrozen(EXTRACT_STATE_FILES))
        assert.deepEqual(EXTRACT_STATE_FILES, {
            attempts: ATTEMPTS_FILE, contentCache: CONTENT_CACHE_FILE, noTopCache: NO_TOP_CACHE_FILE, edgeSeen: EDGE_SEEN_FILE, impactLedger: IMPACT_LEDGER_FILE,
            impactRetry: IMPACT_RETRY_FILE, pendingDropped: PENDING_DROPPED_FILE, rebaseline: REBASELINE_FILE, regen: REGEN_FILE, synonym: SYNONYM_STATE_FILE,
        })
        assert.equal(ATTEMPTS_FILE, 'extract-attempts.json', '持久化之檔名不變')
        const vals = Object.values(EXTRACT_STATE_FILES)
        assert.equal(new Set(vals).size, vals.length)
        // 失敗帳:讀改寫為同一份共享物件;寫出即可讀回
        const f = `${TMP}/ledger/${ATTEMPTS_FILE}`
        fs.mkdirSync(path.dirname(f), { recursive: true })
        const led = createExtractLedger(f)
        led.entry('concept|甲').tries = 2
        led.save()
        assert.equal(createExtractLedger(f).data['concept|甲'].tries, 2)
        assert.equal(coreLedgerKeyOf({ concept: 'Transformer 架構' }), 'concept|transformer架構', '鍵式只此一處')
        assert.equal(coreLedgerKeyOf({ scope: 'category', concept: '方法' }), 'category|方法')
        assert.deepEqual([led.remove('concept|甲'), led.remove('concept|甲')], [true, false])
    })

    it('持久檔語意(STD-26):JSON 帳壞檔或錯形狀 → 隔離為 .corrupt-<時戳>、告警「提煉帳檔損壞」(字樣只一份)、以空帳續行;唯讀讀法不改名只回報;失敗帳同此;派生檔之結構判準另列', () => {
        const dir = `${TMP}/ledger2`
        fs.mkdirSync(dir, { recursive: true })
        const f = `${dir}/${ATTEMPTS_FILE}`
        const warns = []
        const log = { warn: (m) => warns.push(m) }
        // 壞 JSON:隔離＋告警(必看字樣),以空帳續行(下次寫入不覆寫壞檔)
        fs.writeFileSync(f, '{壞', 'utf8')
        const led = createExtractLedger(f, { stamp: 'S1', log })
        assert.deepEqual([Object.keys(led.data), fs.existsSync(`${f}.corrupt-S1`), fs.existsSync(f)], [[], true, false])
        assert.match(warns[0], /^提煉帳檔損壞：extract-attempts\.json（.+），已隔離為 extract-attempts\.json\.corrupt-S1；以空帳續行$/)
        assert.ok(warns[0].startsWith(EXTRACT_LEDGER_CORRUPT_WORD))
        // 錯形狀(可解析但結構不合):同一處置,原因為結構問題
        fs.writeFileSync(f, '["不是物件"]', 'utf8')
        createExtractLedger(f, { stamp: 'S2', log })
        assert.deepEqual([fs.existsSync(`${f}.corrupt-S2`), fs.existsSync(f)], [true, false])
        assert.match(warns[1], /結構應為 \{ \[核心鍵或專步鍵\]: 計數物件 \}/)
        // 唯讀讀法:壞檔不改名、不拋,只回報(預演、掃描、驗證之純讀入口)
        fs.writeFileSync(f, '{壞', 'utf8')
        const seen = []
        assert.equal(readLedgerJson(f, { shape: EXTRACT_LEDGER_SHAPES.attempts, quarantine: false, log, onCorrupt: (i) => seen.push(i) }), null)
        assert.deepEqual([fs.readFileSync(f, 'utf8'), seen[0].readOnly, seen[0].movedTo], ['{壞', true, null])
        assert.match(warns[2], /唯讀讀法未隔離/)
        // 缺檔＝空(不告警);合格者原樣
        assert.equal(readLedgerJson(`${dir}/none.json`, { shape: EXTRACT_LEDGER_SHAPES.attempts, log }), null)
        saveLedgerJson(f, { 'concept|甲': { tries: 1 } }, { pretty: true })
        assert.deepEqual(readLedgerJson(f, { shape: EXTRACT_LEDGER_SHAPES.attempts, log }), { 'concept|甲': { tries: 1 } })
        assert.equal(warns.length, 3)
        saveLedgerJson(f, null)
        assert.equal(fs.existsSync(f), false, 'null 即刪檔')
        // 各帳之結構判準:合格回 ''、不合回說明
        assert.deepEqual([EXTRACT_LEDGER_SHAPES.edgeSeen({ v: 1, at: '', edges: { e1: 'x' } }), EXTRACT_LEDGER_SHAPES.edgeSeen({ edges: [] }) !== '', EXTRACT_LEDGER_SHAPES.impactRetry({ c1: [] }), EXTRACT_LEDGER_SHAPES.impactRetry({ c1: {} }) !== '', EXTRACT_LEDGER_SHAPES.rebaseline({ ids: { n1: { at: '', by: '' } } }), EXTRACT_LEDGER_SHAPES.rebaseline({ ids: ['n1'] }) !== '', EXTRACT_LEDGER_SHAPES.regen({ cores: {} }), EXTRACT_LEDGER_SHAPES.synonym({ pairs: [] }), EXTRACT_LEDGER_SHAPES.synonym({}) !== ''], ['', true, '', true, '', true, '', '', true])
    })

    it('連續失敗之判讀 extractStuckOf(帳之格式只在提煉套件):核心鍵之 tries 或任一 <專步>Tries 達門檻;逐項之物件不算;專步鍵另列;門檻可給', () => {
        assert.equal(EXTRACT_STUCK_TRIES, 3)
        assert.equal(SYNONYM_LEDGER_KEY, `${EXTRACT_LEDGER_STEP_PREFIX}synonym`, '專步鍵由前綴組成(單一來源)')
        const data = {
            'concept|甲': { tries: 3, noteTries: {} },
            'concept|乙': { tries: 1, essenceTries: 4 },
            'category|丙': { tries: 2, disputeTries: 2, noteTries: { n1: 9 }, conflictTries: { e1: 9 }, supportItemTries: { C1: 9 } },
            'concept|丁': { orphanTries: 3, orphanLastError: '缺票' },
            [SYNONYM_LEDGER_KEY]: { synonymTries: 3 },
            'concept|戊': { tries: '9' },
        }
        assert.deepEqual(extractStuckOf(data), { cores: ['concept|甲', 'concept|乙', 'concept|丁'], steps: [SYNONYM_LEDGER_KEY] }, '逐項之物件與非數值不算')
        assert.deepEqual(extractStuckOf(data, { min: 4 }), { cores: ['concept|乙'], steps: [] })
        assert.deepEqual(extractStuckOf(data, { min: 0 }), extractStuckOf(data), '非正整數之門檻取預設')
        assert.deepEqual(extractStuckOf(null), { cores: [], steps: [] })
    })

    it('核心狀態檔之目錄:未給 coreState(或空字串)＝core;給了即分開;附屬目錄在 state/core 下', () => {
        assert.equal(coreStateDirOf({ core: 'k/core' }), 'k/core')
        assert.equal(coreStateDirOf({ core: 'k/core', coreState: '' }), 'k/core')
        assert.equal(coreStateDirOf({ core: 'k/core', coreState: 's/core' }), 's/core')
        const aux = coreAuxDirs({ state: 'w/state' })
        assert.deepEqual(Object.keys(aux), ['prev', 'archive', 'manual', 'dirty'])
        assert.equal(aux.prev.replace(/\\/g, '/'), 'w/state/core/prev')
    })

    it('單一存取器 coreStoreOf:上一版寫於附屬目錄;壞檔自同一處還原(recovered)', () => {
        const dirs = extractDirsOf(`${TMP}/store1`)
        for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
        const store = coreStoreOf(dirs)
        const s1 = store.save('k1', { ...emptyState({ coreId: 'k1', concept: '甲' }), version: 1 }, { expectRev: null })
        store.save('k1', { ...s1, version: 2 }, { expectRev: s1.rev })
        assert.ok(fs.existsSync(path.join(coreAuxDirs(dirs).prev, 'k1.state.prev.json')), '上一版在附屬目錄')
        fs.writeFileSync(path.join(coreStateDirOf(dirs), 'k1.state.json'), '{壞檔')
        const r = coreStoreOf(dirs).load('k1')
        assert.deepEqual([r.status, r.state.version], ['recovered', 1])
    })

    it('新核心之 id:只覆寫 core(未給 coreState)不拋、以 core 目錄判撞號;另給 coreState 者以該目錄之狀態檔判撞號;狀態檔之占用只認可讀者(ok／recovered),壞檔無上一版、他版不改種子', () => {
        const t = { concept: '乙', scope: 'concept', key: '乙' }
        const valid = (id) => JSON.stringify({ ...emptyState({ coreId: id, concept: '乙' }), version: 1 })
        const onlyCore = { core: `${TMP}/id1/core`, state: `${TMP}/id1/state` }
        fs.mkdirSync(onlyCore.core, { recursive: true })
        const a = newCoreIdOf(t, [], onlyCore)
        fs.writeFileSync(path.join(onlyCore.core, `${a.id}.state.json`), valid(a.id))
        assert.notEqual(newCoreIdOf(t, [], onlyCore).id, a.id, '狀態檔已在 core 目錄 → 撞號改種子')
        const split = { core: `${TMP}/id2/core`, coreState: `${TMP}/id2/cs`, state: `${TMP}/id2/state` }
        for (const d of [split.core, split.coreState]) fs.mkdirSync(d, { recursive: true })
        const b = newCoreIdOf(t, [], split)
        fs.writeFileSync(path.join(split.coreState, `${b.id}.state.json`), valid(b.id))
        assert.notEqual(newCoreIdOf(t, [], split).id, b.id, '狀態檔在 coreState 目錄 → 撞號改種子')
        // 四態:壞檔無上一版(corrupt)、他版(foreign)不算占用——由選中時之載入隔離並記 ERROR,不讓該概念永遠配到 -1 之 id;.prev 救得回者(recovered)算占用
        fs.writeFileSync(path.join(split.coreState, `${b.id}.state.json`), '{壞檔')
        assert.equal(newCoreIdOf(t, [], split).id, b.id, '壞檔無上一版 → 不改種子')
        fs.writeFileSync(path.join(split.coreState, `${b.id}.state.json`), JSON.stringify({ v: STATE_VERSION + 1 }))
        assert.equal(newCoreIdOf(t, [], split).id, b.id, '他版 → 不改種子')
        fs.mkdirSync(coreAuxDirs(split).prev, { recursive: true })
        fs.writeFileSync(path.join(coreAuxDirs(split).prev, `${b.id}.state.prev.json`), valid(b.id))
        fs.writeFileSync(path.join(split.coreState, `${b.id}.state.json`), '{壞檔')
        assert.notEqual(newCoreIdOf(t, [], split).id, b.id, '壞檔而 .prev 救得回(recovered)→ 占用')
    })

    it('重審預覽:需關聯 domain(衝突型)——缺即拋;壞檔可自上一版還原者照列其重審項(與提煉段同一組目錄)', async () => {
        const dirs = extractDirsOf(`${TMP}/pv1`)
        for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
        const relateDomain = createRelateDomain({})
        const store = coreStoreOf(dirs)
        const st = { ...emptyState({ coreId: 'k1', concept: '甲' }), version: 1, claims: [{ id: 'C1', kind: 'rule', text: '甲之規則', sources: ['n1'], status: 'active' }], consumed: ['n1'] }
        const s1 = store.save('k1', st, { expectRev: null })
        store.save('k1', { ...s1, version: 2 }, { expectRev: s1.rev })
        fs.writeFileSync(path.join(coreStateDirOf(dirs), 'k1.state.json'), '{壞檔')
        const stores = {
            notes: memStore([noteRow(dirs, { id: 'n1', createdAt: '2026-10-01' }), noteRow(dirs, { id: 'n2', createdAt: '2026-10-02' })]),
            cores: memStore([{ id: 'k1', concept: '甲', scope: 'concept', status: 'active', version: 2 }]),
            relations: memStore([{ id: 'e1', from: 'n1', to: 'n2', type: relateDomain.conflictType }]),
        }
        const deps = { stores, dirs, domain: createExtractDomain({}) }
        await assert.rejects(() => previewRecheck(deps), /previewRecheck 需要 deps\.relateDomain/)
        const rows = await previewRecheck({ ...deps, relateDomain })
        assert.deepEqual(rows.map((r) => [r.id, r.conflicts]), [['k1', 1]])
    })

    it('重設基準之名單:逐 id 記指示者與時刻(預設 api)、合併既有名單;取消與已處置只移除所列 id(空即刪檔);讀名單去重,檔不在回空;壞檔回空並回報——純讀不改檔、維護段給 stamp 即隔離、寫入前先隔離不覆蓋', () => {
        const dirs = { state: `${TMP}/rb1/state` }
        assert.deepEqual(rebaselineIdsOf(dirs), [])
        const f = requestRebaseline(dirs, '2026-10-10T00:00:00+08:00', ['n1', ' n1 ', 'n2'])
        assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { ids: { n1: { at: '2026-10-10T00:00:00+08:00', by: 'api' }, n2: { at: '2026-10-10T00:00:00+08:00', by: 'api' } } }, '「形狀 { ids:{ [筆記 id]:{ at, by } } }」')
        requestRebaseline(dirs, '2026-10-11T00:00:00+08:00', ['n3', 'n1'], { by: 'stock-fix' })
        const ids = JSON.parse(fs.readFileSync(f, 'utf8')).ids
        assert.deepEqual([ids.n1.by, ids.n2.by, ids.n3.by], ['stock-fix', 'api', 'stock-fix'], '同 id 以本次之指示者為準;其餘不動')
        assert.deepEqual(rebaselineIdsOf(dirs), ['n1', 'n2', 'n3'])
        assert.throws(() => requestRebaseline(dirs, 'x', []), /須給筆記 id 名單/)
        assert.deepEqual([cancelRebaseline(dirs, ['n2', 'zz']), rebaselineIdsOf(dirs)], [1, ['n1', 'n3']], '「取消:自名單移除所列 id」')
        assert.deepEqual([rebaselineDone(dirs, ['n1', 'n3']), fs.existsSync(f)], [2, false], '「已處置:只刪已處置之 id;空即刪檔」')
        assert.equal(cancelRebaseline(dirs, ['n1']), 0, '無檔不建檔')
        // 壞檔:純讀回空並回報、檔不動;給 stamp 即隔離(.corrupt-<stamp>)並回報
        requestRebaseline(dirs, '2026-10-12T00:00:00+08:00', ['n9'])
        fs.writeFileSync(f, '{壞')
        const errs = []
        assert.deepEqual(rebaselineIdsOf(dirs, { onError: (m) => errs.push(m) }), [])
        assert.equal(errs.length, 1)
        assert.match(errs[0], /^重設基準之名單檔不可讀（extract-rebaseline\.json），本次不生效；請以 requestRebaseline 重給名單$/)
        assert.equal(fs.readFileSync(f, 'utf8'), '{壞', '純讀不改檔')
        assert.deepEqual(rebaselineIdsOf(dirs, { stamp: 'T1', onError: (m) => errs.push(m) }), [])
        assert.match(errs[1], /已隔離為 extract-rebaseline\.json\.corrupt-T1/)
        assert.ok(!fs.existsSync(f) && fs.existsSync(`${f}.corrupt-T1`), '維護段之讀法隔離壞檔')
        fs.writeFileSync(f, '{壞')
        requestRebaseline(dirs, '2026-10-13T00:00:00+08:00', ['n8'])
        assert.ok(fs.existsSync(`${f}.corrupt-20261013000000`), '寫入前壞檔先隔離(時戳取指示時刻),不無聲覆蓋')
        assert.deepEqual(rebaselineIdsOf(dirs), ['n8'])
    })

    it('他版狀態檔以錯誤碼分流(不以訊息字首);錯形狀(鍵在場而錯型別)以另一錯誤碼分流、缺鍵補預設;狀態欄 lineage 宣告於空狀態(null＝尚未建立基準),舊檔無此欄者正規化為 null', () => {
        assert.throws(() => normalizeState({ v: STATE_VERSION + 1 }), (e) => e.code === FOREIGN_STATE_CODE)
        assert.throws(() => normalizeState('x'), (e) => e.code === undefined, '非物件不是他版')
        // 嚴格驗形:陣列鍵、物件鍵、選填物件鍵、非負整數鍵、字串鍵、lineage、seenConflicts 之元素;最多列三項
        assert.throws(() => normalizeState({ ...emptyState(), claims: {} }), (e) => e.code === CORRUPT_STATE_CODE && /claims 應為陣列/.test(e.message))
        assert.throws(() => normalizeState({ ...emptyState(), held: [] }), (e) => e.code === CORRUPT_STATE_CODE && /held 應為物件/.test(e.message), '選填之物件鍵在場而錯型別亦拒')
        assert.throws(() => normalizeState({ ...emptyState(), rev: -1 }), (e) => e.code === CORRUPT_STATE_CODE && /rev 應為非負整數/.test(e.message))
        assert.throws(() => normalizeState({ ...emptyState(), concept: 1 }), (e) => e.code === CORRUPT_STATE_CODE && /concept 應為字串/.test(e.message))
        assert.throws(() => normalizeState({ ...emptyState(), lineage: 'x' }), (e) => e.code === CORRUPT_STATE_CODE && /lineage 應為null 或物件/.test(e.message))
        assert.throws(() => normalizeState({ ...emptyState(), seenConflicts: [1] }), (e) => e.code === CORRUPT_STATE_CODE && /seenConflicts 之元素應為字串/.test(e.message))
        assert.throws(() => normalizeState({ ...emptyState(), claims: 1, seen: 1, rev: 'x', concept: 2 }), (e) => e.code === CORRUPT_STATE_CODE && e.message === '核心狀態檔錯形狀（claims 應為陣列；seen 應為物件；rev 應為非負整數）', '最多列三項')
        const missing = { ...emptyState({ coreId: 'k' }) }
        for (const k of ['claims', 'seen', 'withdrawn', 'seenConflicts', 'renderHashes', 'nextId', 'essence']) delete missing[k]
        const filled = normalizeState(missing)
        assert.deepEqual([filled.claims, filled.seen, filled.withdrawn, filled.seenConflicts, filled.renderHashes, filled.nextId, filled.essence.text], [[], {}, {}, [], [], { C: 1, D: 1, P: 1, Q: 1 }, ''], '缺鍵補預設(不算壞檔)')
        const dirs = extractDirsOf(`${TMP}/fv1`)
        for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
        fs.writeFileSync(path.join(coreStateDirOf(dirs), 'k9.state.json'), JSON.stringify({ v: STATE_VERSION + 1, coreId: 'k9' }))
        assert.equal(coreStoreOf(dirs).load('k9').status, 'foreign')
        assert.equal(emptyState().lineage, null)
        const old = { ...emptyState({ coreId: 'k1' }) }
        delete old.lineage
        assert.equal(normalizeState(old).lineage, null)
        assert.deepEqual(normalizeState({ ...emptyState(), lineage: { at: 'T' } }).lineage, { at: 'T' })
    })

    it('同義之配對鍵:pairOfKey 為 pairKeyOf 之逆(無序鍵;不含分隔者回空)', () => {
        assert.deepEqual(pairOfKey(pairKeyOf('乙', '甲')), ['乙', '甲'])
        assert.deepEqual(pairOfKey(pairKeyOf('甲', '乙')), ['乙', '甲'])
        assert.deepEqual(pairOfKey('沒有分隔'), ['', ''])
    })
})
