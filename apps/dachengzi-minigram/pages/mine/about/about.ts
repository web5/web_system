// 关于与免责
//
// 承载品牌信息、免责声明正文与合规备案信息。
// 免责正文的署名是「大橙子助理」（与品牌名「大橙子个人助理」字面不同，勿合并）。
Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  data: {
    radiusClass: '',
  },

  /** 底部入口：跳用户协议与隐私政策 */
  goAgreement() {
    wx.navigateTo({ url: '/pages/mine/agreement/agreement' });
  },
});
