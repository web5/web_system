// 用户协议与隐私政策（M4：收集手机号/邮箱前的合规前置）
Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  data: {
    radiusClass: '',
  },
});
