/**
 * 大橙子个人助理 · 主对话页（气泡对话）
 *
 * 统一承载两类气泡流：
 *   - 通用对话 `agentId=auto`（首页「新对话」/ 对话记录列表进入）
 *   - 翻译追问 `agentId=translate`（翻译结果页「继续追问」进入，复用 conversationId + kd_chat_seed 种子）
 *
 * 关键口径（施工图 §3 / §11）：
 *   - agentId 进入即锁定，存实例字段 `_agentId`，整页生命周期不变，不随 intent 事件切换。
 *   - source 派生：auto 不传（后端默认 chat）；translate 传 'tool'（不进「对话记录」列表）。
 *   - 首事件捕获 conversationId（onEvent）；conversationId 未就绪的翻译会话禁止追问。
 *   - `_busy` 串行锁：同一时刻只一条 SSE 在途，onDelta 按索引写回对应气泡。
 *   - 历史恢复：mergeConsecutiveAi 合并连续 assistant + decorateHistoryCards 定翻译卡归属。
 */
import { createAgentApi } from '../../../services/agent-stream';
import { isLoggedIn } from '../../../services/auth';
import { decorateHistoryCards } from '../../../utils/history-cards';
import { stripTitles } from '../../../utils/translate-parse';
import { CHAT_SEED_KEY } from '../../../utils/translate-keys';
import {
  buildAiReplyBubble,
  buildSeedBubbles,
  mergeConsecutiveAi,
  parseChatSeed,
  resolveAgentId,
  resolveSource,
  type ChatAgentId,
  type ChatMsg,
} from '../../../utils/chat-msg';

/** 未登录引导落点：「我的」页有登录入口 */
const MINE_PATH = '/pages/mine/index/index';

/** 输入事件最小结构 */
interface InputEvent {
  detail?: { value?: string };
}

/** 点击事件（重试 / 建议提问）最小结构 */
interface TapEvent {
  currentTarget?: { dataset?: { index?: string | number; text?: string } };
}

Page({
  data: {
    radiusClass: '',
    /** 是否翻译会话（顶部「翻译会话」徽标 + 输入框占位） */
    isTranslate: false,
    /** 输入框占位文案 */
    placeholder: '问问大橙子…',
    /** 气泡流 */
    messages: [] as ChatMsg[],
    /** 输入框内容 */
    input: '',
    /** 发送按钮禁用态（SSE 在途） */
    busy: false,
    /** 滚动定位锚点（最后一条气泡 id） */
    scrollIntoView: '',
    /** 自绘导航：状态栏高度 / 导航栏高度 / 右侧胶囊避让 */
    statusBarHeight: 20,
    navBarHeight: 44,
    menuGap: 96,
  },

  /* ==================== 实例字段（运行时态） ==================== */

  /** 会话级锁定 agentId：'auto' | 'translate' */
  _agentId: 'auto' as ChatAgentId,
  /** query.agentId 是否显式指定 translate（决定能否用 detail.agentId 兜底覆盖） */
  _agentExplicit: false,
  /** 会话 id：新会话为空，首事件捕获；翻译追问/历史恢复进入时从 query/detail 带入 */
  _conversationId: '',
  /** 并发串行锁：同一时刻只一条 SSE 在途 */
  _busy: false,
  /** 气泡自增 id（wx:key） */
  _nextSeq: 0,
  /** 未登录拦截标志 */
  _blocked: false,
  /** 登录态过期广播退订函数 */
  _offAuthExpired: null as null | (() => void),

  onLoad(query: Record<string, string | undefined> = {}) {
    // 进入即锁定 agentId（缺省/非法 → auto）
    this._agentId = resolveAgentId(query.agentId);
    this._agentExplicit = query.agentId === 'translate';
    this.applyAgent();

    // 自绘导航：状态栏 / 胶囊避让
    this.measureNav();

    // 登录门控：未登录不发请求、不可追问（toast + 引导到「我的」）
    if (!isLoggedIn()) {
      this._blocked = true;
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: MINE_PATH });
      this.subscribeAuth();
      return;
    }

    this.subscribeAuth();

    const conversationId = String(query.conversationId || '').trim();

    // 翻译追问种子优先：原文 + 译文作为首两条气泡，复用带入的 conversationId
    const seed = parseChatSeed(wx.getStorageSync(CHAT_SEED_KEY));
    if (seed) {
      wx.removeStorageSync(CHAT_SEED_KEY);
      if (conversationId) this._conversationId = conversationId;
      const bubbles = buildSeedBubbles(seed, () => this.nextId());
      this.setData({
        messages: bubbles,
        scrollIntoView: bubbles.length ? `msg-${bubbles[bubbles.length - 1].id}` : '',
      });
      return;
    }

    // 历史恢复：传 conversationId → 拉详情渲染（连续 assistant 已合并）
    if (conversationId) {
      this._conversationId = conversationId;
      void this.loadHistory(conversationId);
    }
  },

  onShow() {
    const app = getApp<IAppOption>();
    const cls = app.radiusClassOf ? app.radiusClassOf() : '';
    if (cls !== this.data.radiusClass) this.setData({ radiusClass: cls });
  },

  onUnload() {
    const bus = (getApp() as unknown as { eventBus?: { off?: (e: string, h: () => void) => void } })?.eventBus;
    if (bus?.off && this._offAuthExpired) {
      bus.off('auth:expired', this._offAuthExpired);
      this._offAuthExpired = null;
    }
  },

  /* ==================== 内部工具 ==================== */

  /** 依 agentId 同步顶部徽标与占位文案 */
  applyAgent() {
    const isTranslate = this._agentId === 'translate';
    this.setData({
      isTranslate,
      placeholder: isTranslate ? '继续追问这句翻译…' : '问问大橙子…',
    });
  },

  /** 计算自绘导航需要的高度与右侧胶囊避让 */
  measureNav() {
    try {
      const sys = wx.getSystemInfoSync();
      const statusBarHeight = sys.statusBarHeight || 20;
      const windowWidth = sys.windowWidth || 375;
      let navBarHeight = 44;
      let menuGap = 96;
      const menu = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
      if (menu && menu.height) {
        navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
        menuGap = windowWidth - menu.left + 8;
      }
      this.setData({ statusBarHeight, navBarHeight, menuGap });
    } catch {
      /* 取不到时用默认值，导航仍可用 */
    }
  },

  /** 订阅登录态过期广播：过期后锁定本页并引导登录 */
  subscribeAuth() {
    const bus = (getApp() as unknown as { eventBus?: { on?: (e: string, h: () => void) => void } })?.eventBus;
    if (!bus?.on) return;
    this._offAuthExpired = () => {
      this._blocked = true;
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: MINE_PATH });
    };
    bus.on('auth:expired', this._offAuthExpired);
  },

  /** 生成下一个气泡 id */
  nextId(): string {
    this._nextSeq += 1;
    return String(this._nextSeq);
  },

  /** 按索引回写某条气泡（合并补丁），供 onDelta / finalize / error 使用 */
  patchAi(idx: number, patch: Partial<ChatMsg>) {
    const cur = this.data.messages[idx];
    if (!cur) return;
    this.setData({ [`messages[${idx}]`]: { ...cur, ...patch } });
  },

  /* ==================== 历史恢复 ==================== */

  async loadHistory(conversationId: string) {
    try {
      const api = createAgentApi(this._agentId);
      const detail = await api.getConversation(conversationId);

      // agentId 兜底：历史会话未显式指定 translate 时，用 detail.agentId 收敛
      if (!this._agentExplicit && detail.agentId === 'translate') {
        this._agentId = 'translate';
        this.applyAgent();
      }

      const raw: ChatMsg[] = (detail.messages || [])
        .filter((m) => m.role !== 'tool')
        .map((m) => ({
          id: this.nextId(),
          role: m.role === 'user' ? ('user' as const) : ('ai' as const),
          text: m.content || '',
        }));
      const merged = mergeConsecutiveAi(raw);
      const decorated = decorateHistoryCards(merged, detail.intentHistory);
      this.setData({
        messages: decorated,
        scrollIntoView: decorated.length ? `msg-${decorated[decorated.length - 1].id}` : '',
      });
    } catch {
      wx.showToast({ title: '历史加载失败，请重试', icon: 'none' });
    }
  },

  /* ==================== 发送与流式 ==================== */

  onInput(e: InputEvent) {
    this.setData({ input: String((e.detail && e.detail.value) || '') });
  },

  /** 空态建议提问：填入输入框，用户可改后发送 */
  tapSuggest(e: TapEvent) {
    const text = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.text) || '');
    if (text) this.setData({ input: text });
  },

  send() {
    if (this._blocked) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const text = String(this.data.input || '').trim();
    if (!text) return;
    // 翻译会话 conversationId 未就绪（种子态异常）：此刻发送会另开会话，拦截
    if (this._agentId === 'translate' && !this._conversationId) {
      wx.showToast({ title: '翻译还没完成，稍后再问', icon: 'none' });
      return;
    }
    if (this._busy) {
      wx.showToast({ title: '上一条还在回答，稍等一下', icon: 'none' });
      return;
    }

    const userMsg: ChatMsg = { id: this.nextId(), role: 'user', text };
    const aiMsg: ChatMsg = { id: this.nextId(), role: 'ai', text: '', loading: true };
    const messages = this.data.messages.concat([userMsg, aiMsg]);
    const aiIndex = messages.length - 1;

    this._busy = true;
    this.setData({
      messages,
      input: '',
      busy: true,
      scrollIntoView: `msg-${aiMsg.id}`,
    });
    this.runStream(aiIndex, text);
  },

  runStream(aiIndex: number, userText: string) {
    const api = createAgentApi(this._agentId);
    const source = resolveSource(this._agentId);
    let acc = '';

    api.stream(
      userText,
      {
        ...(source ? { source } : {}),
        ...(this._conversationId ? { conversationId: this._conversationId } : {}),
      },
      {
        // 首事件捕获 conversationId（与翻译结果页同手法）
        onEvent: (ev) => {
          if (!this._conversationId && ev && ev.conversationId) {
            this._conversationId = ev.conversationId;
          }
        },
        onDelta: (delta) => {
          acc += delta;
          // 翻译会话流式期只出「主文」（去段落标题），完成后 finalize 再补注解
          this.patchAi(aiIndex, { text: this._agentId === 'translate' ? stripTitles(acc) : acc });
        },
        onReply: (content) => {
          this._busy = false;
          this.setData({ busy: false });
          const final = content || acc;
          const bubble = buildAiReplyBubble(this.data.messages[aiIndex]?.id || this.nextId(), final, userText, this._agentId);
          this.setData({ [`messages[${aiIndex}]`]: { ...bubble, loading: false } });
        },
        onError: (err) => {
          this._busy = false;
          this.setData({ busy: false });
          this.patchAi(aiIndex, {
            loading: false,
            error: true,
            text: (err && err.message) || '请求失败，请重试',
          });
        },
      },
    );
  },

  /** 失败态重试：同 agentId / 同 conversationId 重发，不产生重复用户气泡 */
  retry(e: TapEvent) {
    if (this._busy) {
      wx.showToast({ title: '上一条还在回答，稍等一下', icon: 'none' });
      return;
    }
    const rawIdx = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index) ?? '';
    const idx = Number(rawIdx);
    const msgs = this.data.messages;
    const ai = msgs[idx];
    const user = msgs[idx - 1];
    if (!ai || ai.role !== 'ai' || !ai.error || !user || user.role !== 'user') return;

    this._busy = true;
    this.setData({
      [`messages[${idx}]`]: { id: ai.id, role: 'ai' as const, text: '', loading: true },
      busy: true,
      scrollIntoView: `msg-${ai.id}`,
    });
    this.runStream(idx, user.text);
  },

  /* ==================== 导航动作 ==================== */

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/home/index/index' }),
    });
  },

  goHistory() {
    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/chat/history/history' });
  },

  /** 新对话：重置为全新 auto 会话（清气泡 / 清 conversationId / 清种子态） */
  newChat() {
    if (this._busy) {
      wx.showToast({ title: '回答中，稍等一下', icon: 'none' });
      return;
    }
    this._agentId = 'auto';
    this._agentExplicit = false;
    this._conversationId = '';
    this._nextSeq = 0;
    this.setData({
      messages: [],
      input: '',
      scrollIntoView: '',
    });
    this.applyAgent();
  },
});
