// 翻译主页（tab）
// 链路：本页只负责拼装参数 → 结果页用 services/agent-stream 的 createAgentApi('translate')
// 发起 SSE 流式请求；「翻译中」中间态与失败态都由结果页承载（与原型状态矩阵一致）。
// API Key 只在服务端，不会进小程序。

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

  doTranslate() {
    const text = this.data.input.trim();
    if (!text) return wx.showToast({ title: '先输入内容', icon: 'none' });
    if (this.data.srcLang === this.data.tgtLang) {
      return wx.showToast({ title: '源语言和目标语言不能相同', icon: 'none' });
    }
    // 参数经 storage 交给结果页（原文较长，不适合放 URL 参数）；
    // 结果页自己发起流式请求，中间态与失败态都落在那一页
    wx.setStorageSync('kd_translate_params', {
      srcLang: this.data.srcLang,
      tgtLang: this.data.tgtLang,
      register: this.data.register,
      style: this.data.style,
      text,
    });
    wx.navigateTo({ url: '/pages/translate/result/result' });
  },
});
