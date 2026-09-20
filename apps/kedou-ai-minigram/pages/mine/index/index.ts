// 我的（tab）：个人信息 + 设置总入口
Page({
  data: {
    nickname: '橙子哥哥',
    realName: '已实名',
    phone: '138****6688',
  },

  goProfile() { wx.navigateTo({ url: '/pages/mine/profile/profile' }); },
  goAppSettings() { wx.navigateTo({ url: '/pages/mine/settings/settings' }); },
  goTrSettings() { wx.navigateTo({ url: '/pages/translate/settings/settings' }); },
  goAsSettings() { wx.navigateTo({ url: '/pages/assess/settings/settings' }); },
  goHistory() { wx.navigateTo({ url: '/pages/translate/history/history' }); },

  goVip() { wx.showToast({ title: '会员功能开发中', icon: 'none' }); },
  goContracts() { wx.showToast({ title: '我的合同开发中', icon: 'none' }); },
  goAgreement() { wx.showToast({ title: '协议页开发中', icon: 'none' }); },
  goAbout() { wx.showToast({ title: '科豆 AI v1.0.0', icon: 'none' }); },

  clearCache() {
    wx.showLoading({ title: '清理中…' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: '已清除 24.6MB' });
    }, 700);
  },
});
