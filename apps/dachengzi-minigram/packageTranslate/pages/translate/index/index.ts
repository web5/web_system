// 翻译主页（tab）
// 链路：本页只负责拼装参数 → 结果页用 services/agent-stream 的 createAgentApi('translate')
// 发起 SSE 流式请求；「翻译中」中间态与失败态都由结果页承载（与原型状态矩阵一致）。
// API Key 只在服务端，不会进小程序。
import { TRANSLATE_SETTINGS_KEY, TRANSLATE_PARAMS_KEY } from '../../../../utils/translate-keys';

Page({
  data: {
    radiusClass: "",
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
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    const patch: Record<string, string> = {};
    if (__cls !== this.data.radiusClass) patch.radiusClass = __cls;

    // 读翻译默认参数（kd_tr_settings）：每次进页以本地设置为准，变更才 setData。
    // 只回填四个语言/语气/风格字段，绝不碰 input / clipboard（用户正在输入的文本不能被冲掉）。
    const prefs = this.readPrefs();
    if (prefs.srcLang !== this.data.srcLang) patch.srcLang = prefs.srcLang;
    if (prefs.tgtLang !== this.data.tgtLang) patch.tgtLang = prefs.tgtLang;
    if (prefs.register !== this.data.register) patch.register = prefs.register;
    if (prefs.style !== this.data.style) patch.style = prefs.style;

    if (Object.keys(patch).length) this.setData(patch);

    this.readClipboard();
  },

  /** 读翻译默认参数：逐字段类型校验，缺字段/类型不符一律落回当前 data 值，不做半截取值 */
  readPrefs() {
    const d = this.data;
    const base = { srcLang: d.srcLang, tgtLang: d.tgtLang, register: d.register, style: d.style };
    try {
      const raw: unknown = wx.getStorageSync(TRANSLATE_SETTINGS_KEY);
      if (!raw || typeof raw !== 'object') return base;
      const o = raw as Record<string, unknown>;
      return {
        srcLang: typeof o.srcLang === 'string' ? o.srcLang : base.srcLang,
        tgtLang: typeof o.tgtLang === 'string' ? o.tgtLang : base.tgtLang,
        register: typeof o.register === 'string' ? o.register : base.register,
        style: typeof o.style === 'string' ? o.style : base.style,
      };
    } catch {
      return base;
    }
  },

  readClipboard() {
    wx.getClipboardData({
      success: (res: WechatMiniprogram.GetClipboardDataSuccessCallbackOption) => {
        const t = (res.data || '').trim();
        this.setData({ clipboard: t.length > 0 && t.length < 60 ? t : '' });
      },
    });
  },

  doPaste() {
    this.setData({ input: this.data.clipboard, clipboard: '' });
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ input: e.detail.value });
  },

  useSample(e: WechatMiniprogram.TouchEvent) {
    this.setData({ input: e.currentTarget.dataset.v });
  },

  pickRegister(e: WechatMiniprogram.TouchEvent) {
    this.setData({ register: e.currentTarget.dataset.v });
  },

  pickStyle(e: WechatMiniprogram.TouchEvent) {
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
      success: (res: WechatMiniprogram.ShowActionSheetSuccessCallbackResult) => {
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

  doTranslate() {
    const text = this.data.input.trim();
    if (!text) return wx.showToast({ title: '先输入内容', icon: 'none' });
    if (this.data.srcLang === this.data.tgtLang) {
      return wx.showToast({ title: '源语言和目标语言不能相同', icon: 'none' });
    }
    // 参数经 storage 交给结果页（原文较长，不适合放 URL 参数）；
    // 结果页自己发起流式请求，中间态与失败态都落在那一页
    wx.setStorageSync(TRANSLATE_PARAMS_KEY, {
      srcLang: this.data.srcLang,
      tgtLang: this.data.tgtLang,
      register: this.data.register,
      style: this.data.style,
      text,
    });
    wx.navigateTo({ url: '/packageTranslate/pages/translate/result/result' });
  },
});
