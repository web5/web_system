// 翻译结果页
//
// 职责：用 services/agent-stream 的 createAgentApi('translate') 发起 SSE 流式请求，
//       承载「翻译中」中间态与失败态，并把 agent 输出的四段文本切成结构化字段渲染。
//
// 契约（与 specs/kedou-ai-minigram/agent-translate.sql 的 systemPrompt 对齐）：
//   入参：【源语言】/【目标语言】/【语气】/【风格】/【原文】
//   出参：【推荐译文】/【直译对照】/【委婉版】/【语气要点】
import { createAgentApi } from '../../../../services/agent-stream';
import { parseSections, stripTitles } from '../../../../utils/translate-parse';
import { speakText, stopSpeak, onSpeakState } from '../../../../services/tts';
import { collectGlossary } from '../../../../services/glossary';
import { TRANSLATE_HISTORY_KEY, TRANSLATE_PARAMS_KEY, TRANSLATE_SETTINGS_KEY, CHAT_SEED_KEY, TrHistoryItem } from '../../../../utils/translate-keys';

/** 历史上限：超出丢弃最旧的，防无限增长 */
const HISTORY_MAX = 50;

Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  data: {
    radiusClass: "",
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
  /** 逐字流式开关（读 kd_tr_settings.stream；显式 false = 一次性出全文，onDelta 不渲染中间态） */
  _streamMode: true,
  /** 本次翻译的会话 id：从 SSE 事件里取，追问复用同一条会话 */
  _conversationId: '',
  /** 本次翻译在 kd_tr_history 里的记录 id：重试时覆盖同一条，不新增 */
  _historyId: '',
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

    const p = (wx.getStorageSync(TRANSLATE_PARAMS_KEY) || {}) as Record<string, string>;
    this._params = p;
    // 播放结束 / 停止时清除「播放中」态
    this._offSpeakState = onSpeakState((s) => {
      if (!s) this.setData({ speaking: false });
    });

    // 从历史回看：直接渲染已存译文，不发新请求；
    // 同时恢复 conversationId / 记录 id —— 回看后仍可继续追问，重翻也只覆盖这一条历史。
    if (query.fromHistory === '1') {
      const saved = String(p.natural || '').trim();
      this._historyId = String(p.__historyId || '');
      this._conversationId = String(p.conversationId || '');
      this.setData({
        source: p.text || '',
        natural: saved,
        loading: false,
        failed: !saved,
        failReason: saved ? '' : '这条记录没有译文，可以重新翻译一次',
        meta: `${p.register || '正式'} · ${p.style || '完整'} · ${p.srcLang || ''}→${p.tgtLang || ''}`,
      });
      if (saved) this.buildShareImage(saved);
      return;
    }

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
      title: text || '大橙子个人助理翻译官',
      path: text ? `/packageTranslate/pages/translate/result/result?fwd=${encodeURIComponent(text)}` : '/packageTranslate/pages/translate/index/index',
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
    // 逐字流式偏好：读 kd_tr_settings.stream，只有显式 false 才一次性出全文（缺省默认逐字）
    try {
      const prefs = (wx.getStorageSync(TRANSLATE_SETTINGS_KEY) || {}) as Record<string, unknown>;
      this._streamMode = prefs.stream !== false;
    } catch {
      this._streamMode = true;
    }
    // 新一轮翻译 = 新会话：旧 conversationId / 旧追问气泡都作废
    this._conversationId = '';
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
      // 会话 id 在首个带 conversationId 的事件里取，追问靠它续同一条会话
      onEvent: (ev) => {
        if (!this._conversationId && ev && ev.conversationId) {
          this._conversationId = ev.conversationId;
        }
      },
      onDelta: (delta) => {
        this._raw += delta;
        // 关闭逐字流式：onDelta 不渲染中间态，等 onReply 一次性出全文
        if (!this._streamMode) return;
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
        // 翻译成功即落一条历史（重试覆盖同一条，不新增）
        this.saveHistory(natural);
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

  /**
   * 翻译成功后写一条历史（kd_tr_history）。
   *
   * 幂等策略：id 记在实例字段 _historyId 上 ——
   *   首次写入：生成 id 并记下，unshift 到最前，裁到上限 50 条；
   *   重试写入：按 _historyId 找到旧记录原地覆盖（保留原 id 与 ts），不新增一条。
   * 存储异常（超限 / 序列化失败）一律吞掉：历史是附属能力，不能反过来把翻译结果搞成失败。
   */
  saveHistory(natural: string) {
    // 转发卡片落地展示的不是本次翻译，不落历史
    if (this.data.fromShare) return;
    const body = String(natural || '').trim();
    if (!body) return;
    try {
      const p = (this._params || {}) as Record<string, string>;
      const raw = wx.getStorageSync(TRANSLATE_HISTORY_KEY);
      const list: TrHistoryItem[] = Array.isArray(raw) ? (raw as TrHistoryItem[]) : [];
      const srcLang = String(p.srcLang || '');
      const tgtLang = String(p.tgtLang || '');
      const register = String(p.register || '');
      const style = String(p.style || '');
      const text = String(p.text || this.data.source || '');
      const conversationId = this._conversationId;

      if (this._historyId) {
        const at = list.findIndex((it) => !!it && it.id === this._historyId);
        if (at >= 0) {
          list[at] = { ...list[at], natural: body, srcLang, tgtLang, register, style, conversationId };
          wx.setStorageSync(TRANSLATE_HISTORY_KEY, list);
          return;
        }
      }

      const id = this._historyId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      this._historyId = id;
      list.unshift({ id, text, natural: body, srcLang, tgtLang, register, style, conversationId, ts: Date.now() });
      wx.setStorageSync(TRANSLATE_HISTORY_KEY, list.slice(0, HISTORY_MAX));
    } catch {
      /* 历史写入失败不影响本次翻译结果 */
    }
  },

  /**
   * 继续追问入口：写种子（原文 + 译文）+ navigateTo 主对话页（agentId=translate + 复用本次 conversationId）。
   * 主对话页读取 kd_chat_seed 后自行 removeStorageSync 清除，原文/译文作为首两条气泡。
   * 结构化结果页与翻译历史保持不变。
   */
  goFollowUpChat() {
    const natural = String(this.data.natural || '').trim();
    const source = String(this.data.source || '').trim();
    if (!this._conversationId) {
      wx.showToast({ title: '翻译还没完成，稍后再问', icon: 'none' });
      return;
    }
    try {
      wx.setStorageSync(CHAT_SEED_KEY, { user: source, reply: natural });
    } catch {
      /* 种子写失败不阻断跳转：对话页会以空种子进入 */
    }
    wx.navigateTo({
      url: `/pages/chat/index/index?agentId=translate&conversationId=${encodeURIComponent(this._conversationId)}`,
    });
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
    const enMain = String(this.data.natural || '').trim();
    if (!enMain) return;
    const p = (this._params || {}) as Record<string, string>;
    void collectGlossary({
      sourceType: 'translate',
      sourceText: this.data.source,
      enMain,
      note: this.data.notes,
      meta: { tone: p.register, direction: 'zh2en' },
    })
      .then((r) => {
        wx.showToast({ title: r.created ? '已收进生词本' : '已在生词本', icon: 'none' });
      })
      .catch(() => {
        wx.showToast({ title: '收藏失败，请重试', icon: 'none' });
      });
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
      wx.redirectTo({ url: '/packageTranslate/pages/translate/index/index' });
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
