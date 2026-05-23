// pages/index/index.ts
import { isLoggedIn } from '../../services/auth';

Page({
  data: {
    loggedIn: false,
    isIPad: false,
    isLandscape: false,
  },

  onLoad() {
    this.detectDevice();
  },

  onShow() {
    this.setData({ loggedIn: isLoggedIn() });
    this.detectDevice();
  },

  onResize() {
    this.detectDevice();
  },

  detectDevice() {
    try {
      const info = wx.getSystemInfoSync();
      const isIPad = info.model?.indexOf('iPad') >= 0 || info.windowWidth >= 768;
      const isLandscape = info.windowWidth > info.windowHeight;
      this.setData({ isIPad, isLandscape });
    } catch (_) { /* ignore */ }
  },

  goToDraw() {
    wx.navigateTo({
      url: '/pages/draw/draw',
    });
  },
});
