/**
 * 科豆 AI - 首页（主入口）
 * 一键上传合同，AI 识别风险
 */
Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  data: {
    radiusClass: "",},

  goUpload() {
    wx.navigateTo({
      url: '/packageContract/pages/contract/upload/upload',
    });
  },

  goAssistant() {
    wx.navigateTo({
      url: '/packageContract/pages/contract/assistant/assistant',
    });
  },

  // ⚠️ 这两个入口当前在 index.wxml 未绑定（首页按 v5 原型稿只有「上传 / 对话」双入口卡），
  // 保留为预留实现。跳转必须走 navigateTo：switchTab 只能跳 app.json tabBar.list 里的页面
  // （目前只有 pages/discover、pages/mine），分包页从来不在其中 —— 用 switchTab 点下去必失败。
  // 与兄弟分包一致（packageBianbian / packageTranslate 的 goHistory 都用 navigateTo）。
  goHistory() {
    wx.navigateTo({
      url: '/packageContract/pages/contract/history/history',
    });
  },

  goMine() {
    wx.navigateTo({
      url: '/packageContract/pages/contract/mine/mine',
    });
  },
});
