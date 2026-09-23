// 翻译历史
// TODO: 读取 wx.getStorageSync('kd_tr_history')
Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  data: {
    radiusClass: "",
    list: [
      { id: 1, title: '这个报价我们再商量商量…', time: '10:24' },
      { id: 2, title: 'Could you confirm at your earliest…', time: '昨天' },
      { id: 3, title: '实在抱歉，这批货可能要晚两天到。', time: '3 天前' },
    ],
  },

  open() {
    wx.navigateTo({ url: '/packageTranslate/pages/translate/result/result' });
  },
});
