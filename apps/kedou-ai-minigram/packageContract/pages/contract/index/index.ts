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

  goHistory() {
    wx.switchTab({
      url: '/packageContract/pages/contract/history/history',
    });
  },

  goMine() {
    wx.switchTab({
      url: '/packageContract/pages/contract/mine/mine',
    });
  },
});
