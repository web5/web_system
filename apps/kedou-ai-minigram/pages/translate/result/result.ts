// 翻译结果页
//
// 职责：用 services/agent-stream 的 createAgentApi('translate') 发起 SSE 流式请求，
//       承载「翻译中」中间态与失败态，并把 agent 输出的四段文本切成结构化字段渲染。
//
// 契约（与 specs/kedou-ai-minigram/agent-translate.sql 的 systemPrompt 对齐）：
//   入参：【源语言】/【目标语言】/【语气】/【风格】/【原文】
//   出参：【推荐译文】/【直译对照】/【委婉版】/【语气要点】
import { createAgentApi } from '../../../services/agent-stream';

/** 出参四段标题（顺序即渲染顺序） */
const SECTION_TITLES = ['推荐译文', '直译对照', '委婉版', '语气要点'];

/** 按标题切分 agent 输出；一个标题都没命中时返回空对象 */
function parseSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const marks: Array<{ key: string; start: number }> = [];
  for (const t of SECTION_TITLES) {
    const idx = text.indexOf(`【${t}】`);
    if (idx >= 0) marks.push({ key: t, start: idx });
  }
  marks.sort((a, b) => a.start - b.start);
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].start + `【${marks[i].key}】`.length;
    const to = i + 1 < marks.length ? marks[i + 1].start : text.length;
    out[marks[i].key] = text.slice(from, to).trim();
  }
  return out;
}

/** 流式过程中还没凑齐四段时，去掉标题直接展示已收到的正文 */
function stripTitles(text: string): string {
  return text.replace(/【[^】]*】/g, '').trim();
}

Page({
  data: {
    source: '',
    natural: '',
    literal: '',
    polite: '',
    notes: '',
    meta: '',
    open: false,
    /** 流式进行中（「翻译中」中间态） */
    loading: false,
    /** 失败态 */
    failed: false,
    failReason: '',
  },

  /** 本轮参数（重试用） */
  _params: null as null | Record<string, string>,
  /** 流式累积的原文（未切分） */
  _raw: '',

  onLoad() {
    const p = (wx.getStorageSync('kd_translate_params') || {}) as Record<string, string>;
    this._params = p;
    this.setData({
      source: p.text || '',
      meta: `${p.register || '正式'} · ${p.style || '完整'} · ${p.srcLang || ''}→${p.tgtLang || ''}`,
    });
    this.start(p);
  },

  onUnload() {
    this._raw = '';
  },

  start(p: Record<string, string> | null) {
    const text = String((p && p.text) || '').trim();
    if (!text) {
      this.setData({ loading: false, failed: true, failReason: '没有拿到要翻译的内容' });
      return;
    }

    const userInput = [
      `【源语言】${p!.srcLang || '中文'}`,
      `【目标语言】${p!.tgtLang || '英语'}`,
      `【语气】${p!.register || '正式'}`,
      `【风格】${p!.style || '完整'}`,
      `【原文】${text}`,
    ].join('\n');

    this._raw = '';
    this.setData({
      loading: true,
      failed: false,
      failReason: '',
      natural: '',
      literal: '',
      polite: '',
      notes: '',
    });

    // source='tool'：翻译页产生的会话不进「对话记录」列表（本页有自己的翻译历史）
    createAgentApi('translate').stream(userInput, { source: 'tool' }, {
      onDelta: (delta) => {
        this._raw += delta;
        // 逐字渲染：一旦出现「推荐译文」就只显示它，否则显示去掉标题的已收正文
        const s = parseSections(this._raw);
        this.setData({ natural: s['推荐译文'] || stripTitles(this._raw) });
      },
      onReply: (content) => {
        const s = parseSections(content || '');
        this.setData({
          loading: false,
          natural: s['推荐译文'] || stripTitles(content || ''),
          literal: s['直译对照'] || '',
          polite: s['委婉版'] || '',
          notes: s['语气要点'] || '',
        });
      },
      onError: (err) => {
        this.setData({
          loading: false,
          failed: true,
          failReason: err?.message || '翻译失败，请重试',
        });
      },
    });
  },

  /** 失败态唯一主操作：用同一批参数重发 */
  retry() {
    this.start(this._params);
  },

  copy() {
    if (!this.data.natural) return;
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
