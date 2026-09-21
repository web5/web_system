// 翻译结果页
//
// 职责：用 services/agent-stream 的 createAgentApi('translate') 发起 SSE 流式请求，
//       承载「翻译中」中间态与失败态，并把 agent 输出的四段文本切成结构化字段渲染。
//
// 契约（与 specs/kedou-ai-minigram/agent-translate.sql 的 systemPrompt 对齐）：
//   入参：【源语言】/【目标语言】/【语气】/【风格】/【原文】
//   出参：【推荐译文】/【直译对照】/【委婉版】/【语气要点】
import { createAgentApi } from '../../../services/agent-stream';
import { parseSections, stripTitles } from '../../../utils/translate-parse';
import { speakText, stopSpeak, onSpeakState } from '../../../services/tts';

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
    /** 朗读按钮态：音频合成中（内联反馈，不做全屏 loading） */
    speakLoading: false,
    /** 朗读按钮态：播放中（再点一次 = 停止） */
    speaking: false,
    /** 转发卡片落地：只展示译文（隐藏原文卡 / 直译对照 / VIP / 重翻等区块） */
    fromShare: false,
  },

  /** 本轮参数（重试用） */
  _params: null as null | Record<string, string>,
  /** 流式累积的原文（未切分） */
  _raw: '',
  /** 转发缩略图（canvas 白底译文，onShareAppMessage 用） */
  _shareImage: '',
  /** 朗读状态订阅的退订函数（onUnload 时调用） */
  _offSpeakState: null as null | (() => void),

  onLoad(query: Record<string, string | undefined> = {}) {
    // 转发卡片落地：只带译文（fwd=natural），只展示译文，不重翻
    const fwd = decodeURIComponent(query.fwd || '');
    if (fwd) {
      this._forwarded = fwd;
      this.setData({
        natural: fwd,
        loading: false,
        meta: '来自好友分享',
        fromShare: true,
      });
      return;
    }

    const p = (wx.getStorageSync('kd_translate_params') || {}) as Record<string, string>;
    this._params = p;
    // 播放结束 / 停止时清除「播放中」态
    this._offSpeakState = onSpeakState((s) => {
      if (!s) this.setData({ speaking: false });
    });
    this.setData({
      source: p.text || '',
      meta: `${p.register || '正式'} · ${p.style || '完整'} · ${p.srcLang || ''}→${p.tgtLang || ''}`,
    });
    this.start(p);
  },

  /**
   * 微信转发（极简文本式）：标题=译文、缩略图=白底译文（无品牌元素）。
   * 卡片底部「小程序名」灰字为微信强制展示，无法去除。
   */
  onShareAppMessage() {
    const text = (this.data.natural || '').trim();
    return {
      title: text || '科豆翻译官',
      path: text ? `/pages/translate/result/result?fwd=${encodeURIComponent(text)}` : '/pages/translate/index/index',
      // imageUrl 缺省时微信用截图兜底；白底译文 canvas 图在 _shareImage 缓存
      ...(this._shareImage ? { imageUrl: this._shareImage } : {}),
    };
  },

  onUnload() {
    this._raw = '';
    // 离开页面停掉朗读，避免音频在后台继续响
    stopSpeak();
    if (this._offSpeakState) {
      this._offSpeakState();
      this._offSpeakState = null;
    }
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
        const natural = s['推荐译文'] || stripTitles(content || '');
        this.setData({
          loading: false,
          natural,
          literal: s['直译对照'] || '',
          polite: s['委婉版'] || '',
          notes: s['语气要点'] || '',
        });
        // 转发缩略图：白底译文（无品牌元素），好友在聊天流不点开即可读
        this.buildShareImage(natural);
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

  /**
   * 朗读推荐译文 —— 与对话页共用 services/tts（后端 TTS）。
   * 等待期不做全屏 loading：按钮内联切换「合成中…」，命中本地缓存则直接播放。
   * 再点一次 = 停止播放。
   */
  async speak() {
    if (this.data.speaking) {
      this.setData({ speaking: false });
      await speakText(this.data.natural);
      return;
    }
    this.setData({ speakLoading: true });
    const ok = await speakText(this.data.natural);
    this.setData({ speakLoading: false, speaking: ok });
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
    // 转发落地无页面栈可退：回到翻译输入页（导流闭环）
    if (this.data.fromShare) {
      wx.redirectTo({ url: '/pages/translate/index/index' });
      return;
    }
    wx.navigateBack();
  },

  /**
   * 生成转发缩略图（5:4 白底译文，canvas 离屏绘制）。
   * 无 logo / 无品牌色 —— 卡片观感接近一条纯文本消息（小程序名灰字为微信强制，无法去除）。
   */
  buildShareImage(text: string) {
    if (!text) return;
    try {
      const W = 500;
      const H = 400; // 5:4
      const query = wx.createSelectorQuery();
      // canvas 节点在 WXML（offscreen），完成后存临时路径供 onShareAppMessage 使用
      query
        .select('#share-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) return;
          const canvas = item.node as WechatMiniprogram.Canvas;
          const ctx = canvas.getContext('2d');
          const dpr = 2;
          canvas.width = W * dpr;
          canvas.height = H * dpr;
          ctx.scale(dpr, dpr);
          // 白底
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, W, H);
          // 译文：自动换行 + 截断（缩略图只求可读，完整内容靠卡片标题）
          ctx.fillStyle = '#10131A';
          ctx.font = '500 30px -apple-system, PingFang SC, sans-serif';
          const maxWidth = W - 80;
          let y = 90;
          let line = '';
          const chars = Array.from(text);
          for (let i = 0; i < chars.length && y < H - 50; i++) {
            const test = line + chars[i];
            if (ctx.measureText(test).width > maxWidth) {
              ctx.fillText(line, 40, y);
              y += 44;
              line = chars[i];
            } else {
              line = test;
            }
          }
          if (line && y < H - 50) ctx.fillText(line, 40, y);
          else if (y >= H - 50 && line) ctx.fillText('…', 40, y - 44 < 90 ? 90 : y);
          wx.canvasToTempFilePath({
            canvas,
            success: (r) => {
              this._shareImage = r.tempFilePath;
            },
            fail: () => {
              /* 图生成失败不阻断转发：微信会用页面截图兜底 */
            },
          });
        });
    } catch {
      /* canvas 不可用（如低版本基础库）：转发退回默认截图 */
    }
  },
});
