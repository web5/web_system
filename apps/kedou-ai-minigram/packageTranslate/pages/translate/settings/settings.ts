// 翻译业务设置（只影响翻译功能）
Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  data: {
    radiusClass: "",
    srcLang: '中文',
    tgtLang: '英语',
    register: '正式',
    style: '完整',
    stream: true,
    accent: '美音',
  },

  pick(key: string, title: string, list: string[]) {
    wx.showActionSheet({
      itemList: list,
      success: (res: any) => {
        this.setData({ [key]: list[res.tapIndex] } as any);
        // TODO: wx.setStorageSync('kd_tr_settings', this.data)
      },
      fail: () => undefined,
    });
    void title;
  },

  pickSrc() { this.pick('srcLang', '源语言', ['中文', '英语', '日语', '德语']); },
  pickTgt() { this.pick('tgtLang', '目标语言', ['英语', '中文', '日语', '德语']); },
  pickRegister() { this.pick('register', '语气', ['正式', '商务', '日常', '学术', '轻松']); },
  pickStyle() { this.pick('style', '风格', ['完整', '简洁', '有说服力']); },
  pickAccent() { this.pick('accent', '发音', ['美音', '英音']); },

  toggleStream() {
    this.setData({ stream: !this.data.stream });
  },

  goGlossary() {
    wx.showToast({ title: '术语库开发中', icon: 'none' });
  },

  clearHistory() {
    wx.showModal({
      title: '清空翻译历史',
      content: '将删除本机全部翻译记录，且不可恢复。',
      success: (res: any) => {
        if (res.confirm) wx.showToast({ title: '已清空' });
      },
    });
  },
});
