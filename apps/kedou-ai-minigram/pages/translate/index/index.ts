// 翻译主页（tab）
// TODO: 接入服务端 /api/translate（SSE 流式），不要在小程序里直接放 API Key
// TODO: 翻译接口待接入（服务端 /api/translate，SSE 流式）
// 注意：不要在小程序端直接放 API Key

Page({
  data: {
    srcLang: '中文',
    tgtLang: '英语',
    input: '',
    clipboard: '',
    registers: ['正式', '商务', '日常', '学术', '轻松'],
    styles: ['完整', '简洁', '有说服力'],
    register: '正式',
    style: '完整',
    samples: [
      '这个报价我们再商量商量，下周给你答复。',
      '麻烦尽快确认一下，我们这边等着排产。',
      '实在抱歉，这批货可能要晚两天到。',
    ],
  },

  onShow() {
    this.readClipboard();
  },

  readClipboard() {
    wx.getClipboardData({
      success: (res: any) => {
        const t = (res.data || '').trim();
        this.setData({ clipboard: t.length > 0 && t.length < 60 ? t : '' });
      },
    });
  },

  doPaste() {
    this.setData({ input: this.data.clipboard, clipboard: '' });
  },

  onInput(e: any) {
    this.setData({ input: e.detail.value });
  },

  useSample(e: any) {
    this.setData({ input: e.currentTarget.dataset.v });
  },

  pickRegister(e: any) {
    this.setData({ register: e.currentTarget.dataset.v });
  },

  pickStyle(e: any) {
    this.setData({ style: e.currentTarget.dataset.v });
  },

  pickSrc() {
    this.pickLang('srcLang', '选择源语言');
  },

  pickTgt() {
    this.pickLang('tgtLang', '选择目标语言');
  },

  pickLang(key: 'srcLang' | 'tgtLang', title: string) {
    wx.showActionSheet({
      itemList: ['中文', '英语', '日语', '德语'],
      success: (res: any) => {
        const v = ['中文', '英语', '日语', '德语'][res.tapIndex];
        this.setData({ [key]: v } as any);
      },
      fail: () => undefined,
    });
    void title;
  },

  swap() {
    this.setData({ srcLang: this.data.tgtLang, tgtLang: this.data.srcLang });
  },

  onImage() {
    wx.showToast({ title: '图片翻译开发中', icon: 'none' });
  },

  onVoice() {
    wx.showToast({ title: '语音翻译开发中', icon: 'none' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/translate/history/history' });
  },

  async doTranslate() {
    const text = this.data.input.trim();
    if (!text) return wx.showToast({ title: '先输入内容', icon: 'none' });
    if (this.data.srcLang === this.data.tgtLang) {
      return wx.showToast({ title: '源语言和目标语言不能相同', icon: 'none' });
    }
    wx.showLoading({ title: '翻译中…' });
    try {
      // TODO: const res = await request({ url: "/api/translate", method: "POST", data: {...} })
      const res = null;
      wx.hideLoading();
      // TODO: 结果落本地缓存后跳转结果页
      wx.navigateTo({ url: '/pages/translate/result/result' });
      void res;
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '翻译失败，请重试', icon: 'none' });
    }
  },
});
