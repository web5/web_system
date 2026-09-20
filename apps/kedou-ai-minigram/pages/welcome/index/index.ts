// 欢迎页（启动页，非 tab 页）
// TODO: 最近使用列表从 wx.getStorageSync('kd_recent') 读取
Page({
  data: {
    recent: [
      { id: 1, type: 'translate', title: '这个报价我们再商量商量…', time: '10:24' },
      { id: 2, type: 'assess', title: '设备采购合同_2026Q3.pdf', time: '昨天' },
    ],
  },

  onLoad() {
    // 已登录用户可直接进主界面，欢迎页保留为品牌入口
  },

  goTranslate() {
    wx.switchTab({ url: '/pages/translate/index/index' });
  },

  goAssess() {
    wx.switchTab({ url: '/pages/assess/index/index' });
  },

  openRecent(e: any) {
    const { type } = e.currentTarget.dataset;
    wx.switchTab({ url: type === 'translate' ? '/pages/translate/index/index' : '/pages/assess/index/index' });
  },
});
