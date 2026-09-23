// 小程序通用设置（影响全局）
import * as appearance from '../../../utils/appearance';

Page({
  onShow() {
    // 圆角风格：本页即偏好入口，根节点 class 与设置项文案都按本地存储刷新
    const cls = appearance.currentClass();
    const label = appearance.labelOf();
    if (cls !== this.data.radiusClass || label !== this.data.radiusText) {
      this.setData({ radiusClass: cls, radiusText: label });
    }
  },

  data: {
    radiusClass: '',
    radiusText: appearance.labelOf(),
    themeText: '跟随系统',
    fontSize: '标准',
    notify: true,
    recommend: false,
  },

  toggleTheme() {
    // 真机跟随系统需在 app.json 配 "darkmode": true + theme/*.json
    wx.showActionSheet({
      itemList: ['跟随系统', '始终浅色', '始终深色'],
      success: (res: any) => {
        this.setData({ themeText: ['跟随系统', '始终浅色', '始终深色'][res.tapIndex] });
      },
      fail: () => undefined,
    });
  },

  pickFont() {
    wx.showActionSheet({
      itemList: ['小', '标准', '大'],
      success: (res: any) => {
        this.setData({ fontSize: ['小', '标准', '大'][res.tapIndex] });
      },
      fail: () => undefined,
    });
  },

  /** 圆角风格：柔和 / 清爽 / 直角 —— 写入本地存储并立即刷新本页根节点 class */
  pickRadius() {
    const labels = appearance.STYLE_OPTIONS.map((o) => o.label);
    wx.showActionSheet({
      itemList: labels,
      success: (res: any) => {
        const opt = appearance.STYLE_OPTIONS[res.tapIndex];
        if (!opt) return;
        appearance.setStyle(opt.value);
        this.setData({ radiusText: opt.label, radiusClass: appearance.currentClass() });
      },
      fail: () => undefined,
    });
  },

  toggleNotify() { this.setData({ notify: !this.data.notify }); },
  toggleRecommend() { this.setData({ recommend: !this.data.recommend }); },
  goPrivacy() { wx.showToast({ title: '隐私设置开发中', icon: 'none' }); },

  clearCache() {
    wx.showLoading({ title: '清理中…' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: '已清除 24.6MB' });
    }, 700);
  },

  backWelcome() {
    wx.navigateTo({ url: '/pages/welcome/index/index' });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新微信授权登录。',
      success: (res: any) => {
        if (res.confirm) wx.showToast({ title: '已退出' });
      },
    });
  },
});
