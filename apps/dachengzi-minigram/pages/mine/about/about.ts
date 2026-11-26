// 关于与免责
//
// 承载品牌信息、免责声明正文与合规备案信息。
// 版本号不写死在 wxml：取 utils/version 的运行期解析结果（正式版读微信真值，
// 开发/体验/老基础库回退编译期常量，恒非空）。
import { resolveAppVersion } from '../../../utils/version';

Page({
  /** data 在页面实例化时求值：首帧就有版本号，避免先闪一个孤零零的「v」 */
  data: {
    radiusClass: '',
    appVersion: resolveAppVersion(),
  },

  /** onLoad 再解析一次：开发版/体验版升级后微信真值可能变化，且不依赖模块加载时序 */
  onLoad() {
    this.setData({ appVersion: resolveAppVersion() });
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  /** 底部入口：跳用户协议与隐私政策 */
  goAgreement() {
    wx.navigateTo({ url: '/pages/mine/agreement/agreement' });
  },
});
