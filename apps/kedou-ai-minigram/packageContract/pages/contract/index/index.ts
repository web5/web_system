/**
 * 科豆 AI - 首页（主入口）
 * 一键上传合同，AI 识别风险
 */
Page({
  data: {},

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
