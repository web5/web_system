// 翻译业务设置（只影响翻译功能）
//
// 6 项全部真生效：默认源语言 / 默认目标语言 / 默认语气 / 默认风格 / 逐字流式输出 /
// 清空翻译历史 —— 前 5 项一律落 kd_tr_settings，重进页面仍在；
// 「清空翻译历史」真删 kd_tr_history（key 与写入方 result 页同一常量，见 utils/translate-keys）。
// 已删「发音设置」：后端无口音维度，是死设置。
// 已删「个人术语库」：没有任何术语库 service 支撑，原行右侧「12 条」是写死假数据。
import { TRANSLATE_HISTORY_KEY, TRANSLATE_SETTINGS_KEY } from '../../../../utils/translate-keys';

Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    // 每次进页都以本地存储为准回填，保证「改完重进仍生效」
    const saved = this.loadPrefs();
    if (
      __cls !== this.data.radiusClass ||
      saved.srcLang !== this.data.srcLang ||
      saved.tgtLang !== this.data.tgtLang ||
      saved.register !== this.data.register ||
      saved.style !== this.data.style ||
      saved.stream !== this.data.stream
    ) {
      this.setData({ radiusClass: __cls, ...saved });
    }
  },

  data: {
    radiusClass: "",
    srcLang: '中文',
    tgtLang: '英语',
    register: '正式',
    style: '完整',
    stream: true,
  },

  /** 读本地设置（kd_tr_settings）：缺字段或类型不符一律落回当前值，不做半截取值 */
  loadPrefs() {
    const d = this.data;
    const base = {
      srcLang: d.srcLang,
      tgtLang: d.tgtLang,
      register: d.register,
      style: d.style,
      stream: d.stream,
    };
    try {
      const raw: unknown = wx.getStorageSync(TRANSLATE_SETTINGS_KEY);
      if (!raw || typeof raw !== 'object') return base;
      const o = raw as Record<string, unknown>;
      return {
        srcLang: typeof o.srcLang === 'string' ? o.srcLang : base.srcLang,
        tgtLang: typeof o.tgtLang === 'string' ? o.tgtLang : base.tgtLang,
        register: typeof o.register === 'string' ? o.register : base.register,
        style: typeof o.style === 'string' ? o.style : base.style,
        stream: typeof o.stream === 'boolean' ? o.stream : base.stream,
      };
    } catch {
      return base;
    }
  },

  /** 把 6 项设置写盘（唯一落盘口；只写偏好，不写 radiusClass 等页面态） */
  savePrefs(): void {
    const d = this.data;
    try {
      wx.setStorageSync(TRANSLATE_SETTINGS_KEY, {
        srcLang: d.srcLang,
        tgtLang: d.tgtLang,
        register: d.register,
        style: d.style,
        stream: d.stream,
      });
    } catch {
      wx.showToast({ title: '设置保存失败，请重试', icon: 'none' });
    }
  },

  pick(key: 'srcLang' | 'tgtLang' | 'register' | 'style', list: string[]) {
    wx.showActionSheet({
      itemList: list,
      success: (res: WechatMiniprogram.ShowActionSheetSuccessCallbackResult) => {
        const v = list[res.tapIndex];
        if (!v) return;
        this.setData({ [key]: v });
        this.savePrefs();
      },
      fail: () => undefined,
    });
  },

  pickSrc() { this.pick('srcLang', ['中文', '英语', '日语', '德语']); },
  pickTgt() { this.pick('tgtLang', ['英语', '中文', '日语', '德语']); },
  pickRegister() { this.pick('register', ['正式', '商务', '日常', '学术', '轻松']); },
  pickStyle() { this.pick('style', ['完整', '简洁', '有说服力']); },

  toggleStream() {
    this.setData({ stream: !this.data.stream });
    this.savePrefs();
  },

  /** 清空翻译历史：真删 kd_tr_history（二次确认；回话前重读剩余条数，不空口说清空） */
  clearHistory() {
    wx.showModal({
      title: '清空翻译历史',
      content: '将删除本机全部翻译记录，且不可恢复。',
      confirmText: '清空',
      cancelText: '取消',
      success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) return;
        try {
          wx.removeStorageSync(TRANSLATE_HISTORY_KEY);
        } catch {
          wx.showToast({ title: '清空失败，请重试', icon: 'none' });
          return;
        }
        let left = 0;
        try {
          const list: unknown = wx.getStorageSync(TRANSLATE_HISTORY_KEY);
          left = Array.isArray(list) ? list.length : 0;
        } catch {
          left = 0;
        }
        wx.showToast({ title: left ? `仍有 ${left} 条，请重试` : '已清空翻译记录', icon: 'none' });
      },
    });
  },
});
