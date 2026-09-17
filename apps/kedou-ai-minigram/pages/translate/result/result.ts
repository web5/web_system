// 翻译结果页
Page({
  data: {
    source: '',
    natural: '',
    literal: '',
    polite: '',
    notes: '',
    meta: '',
    open: false,
  },

  onLoad(options: any) {
    // TODO: 从本地缓存或上一页 eventChannel 取结果
    this.setData({
      source: options?.source || '',
      natural: options?.natural || '',
      meta: options?.meta || '',
    });
  },

  copy() {
    wx.setClipboardData({ data: this.data.natural });
  },

  speak() {
    wx.showToast({ title: '朗读开发中', icon: 'none' });
  },

  fav() {
    wx.showToast({ title: '已收进生词本', icon: 'none' });
  },

  more() {
    wx.showActionSheet({
      itemList: ['复制译文', '加入生词本', '生成分享图', '举报'],
      fail: () => undefined,
    });
  },

  toggleFold() {
    this.setData({ open: !this.data.open });
  },

  goVip() {
    wx.showToast({ title: '会员功能开发中', icon: 'none' });
  },

  share() {
    wx.showToast({ title: '分享卡生成中', icon: 'none' });
  },

  goBack() {
    wx.navigateBack();
  },
});
