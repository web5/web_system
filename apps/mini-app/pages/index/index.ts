// pages/index/index.ts
import { isLoggedIn } from '../../services/auth';
import { detectDevice } from '../../utils/device';

Page({
  data: {
    loggedIn: false,
    isIPad: false,
    isLandscape: false,
  },

  onLoad() {
    this.updateDeviceInfo();
  },

  onShow() {
    this.setData({ loggedIn: isLoggedIn() });
    this.updateDeviceInfo();
  },

  onResize() {
    this.updateDeviceInfo();
  },

  /** 更新设备信息（委托纯函数） */
  updateDeviceInfo() {
    const { isIPad, isLandscape } = detectDevice();
    this.setData({ isIPad, isLandscape });
  },

  goToDraw() {
    wx.navigateTo({
      url: '/pages/draw/draw',
    });
  },

  goToRecords() {
    wx.navigateTo({
      url: '/pages/records/records',
    });
  },
});
