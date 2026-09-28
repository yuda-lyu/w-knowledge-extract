// stubAi.mjs — 總組裝測試用之 AI 調度層替身(共用層,不帶 .test. 中綴)
// 不讀 .env:真 adapter 於啟動期檢核席位,測試環境無金鑰會拋;以 cfg.aiAdapter 整組置換即繞過
export const stubAi = {
    callJson: async () => ({ ok: false, data: null, error: 'stub', skipped: false, attempts: 0, preview: '' }),
    getWkf: () => ({}),
    withBudget: (s) => s,
    recordCall: () => {},
    drainStats: () => '無呼叫',
    aiUsageToday: () => ({ today: '', used: 0, byKey: {}, chain: '', providers: [], skipped: [] }),
}
export default stubAi
