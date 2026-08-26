/**
 * 合同翻译官 - 首页（主入口）
 * 一键上传合同，AI 识别风险
 */
Page({
  data: {},

  goUpload() {
    wx.navigateTo({
      url: '/pages/contract/upload/upload',
    });
  },

  goHistory() {
    wx.switchTab({
      url: '/pages/contract/history/history',
    });
  },

  goMine() {
    wx.switchTab({
      url: '/pages/contract/mine/mine',
    });
  },
});
