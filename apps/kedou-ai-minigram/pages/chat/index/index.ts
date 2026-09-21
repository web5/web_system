/**
 * 科豆 AI · 通用对话页（tab 1，主界面）
 *
 * 数据源：真实 SSE 链路 —— `services/agent-stream.ts` 的 `createAgentApi(agentId)`，
 * 与合同评估 / 翻译共用同一条管线（小程序 → gateway → ai-agent → agent-core）。
 *
 * agentId 固定传 `'auto'`：由服务端意图路由（IntentService）决定具体 agent，
 * 并把结果通过 SSE 首个 `intent` 事件下发给前端展示徽标。
 * ⚠️ 主对话**不要**写死具体 agentId —— 那样会绕过分类，退化成单 agent。
 *
 * ⚠️ 硬约束：`conversationId` 必须**每轮回传**，否则每轮都被当成新会话（上下文断 + 重复分类）。
 */
import { getDailyQuote } from '../../../utils/daily';
import { createAgentApi } from '../../../services/agent-stream';
import { RESUME_CONV_KEY } from '../../../utils/conversation';
import { parseAgentError } from '../../../utils/agent-error';
import { ensureLogin } from '../../../services/auth';

/** 主对话走服务端意图路由 */
const CHAT_AGENT_ID = 'auto';

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
  /** 今日一句标记（仅首条 AI 消息） */
  daily?: boolean;
  /** 今日一句英文原文（仅首条） */
  en?: string;
  /** 运行时唯一 id，用于流式阶段定位气泡（不渲染） */
  _id?: string;
  /** 正在接收增量（显示流式态） */
  streaming?: boolean;
  /** 本条失败（网络 / HTTP / 服务端 error）；保留已收到的部分，UI 给「重试 / 删除这一轮」 */
  failed?: boolean;
  /** 失败原因：给用户看的友好提示（不是技术原文） */
  failReason?: string;
  /** 失败错误码：用于区分处理（如 401 自动登录并重试） */
  failCode?: string;
}

/** 开场推荐问题（写死；批次 4 改由 GET /ai/agents 的 entry.suggestions 驱动） */
const OPENING_SUGGESTIONS = ['帮我翻一句话', '看看合同风险', '今天该做什么'];

Page({
  data: {
    conversationId: '',
    chatMessages: [] as ChatMsg[],
    input: '',
    sending: false,
    /** AI 长消息「展开/收起」状态，按消息下标记录 */
    expandMap: {} as Record<number, boolean>,
    /** 开场推荐问题（发送一次后收起） */
    suggestions: OPENING_SUGGESTIONS as string[],
    /** scroll-view 滚动锚点（命中底部锚点即滚到底） */
    scrollIntoId: '',
    /** 自定义导航栏（navigationStyle: custom）：状态栏高与导航栏总高，单位 px */
    statusBarHeight: 20,
    navHeight: 44,
    /** 「+」菜单是否展开 */
    showPlus: false,
    /**
     * 当前作答的 agent（来自 SSE intent 事件）。
     * 路由错了用户能一眼看出「是谁在答」，也是排查误判的第一现场。
     */
    currentAgent: null as null | { id: string; name: string },
    /** 长按后展开复制入口的气泡下标；-1 = 无 */
    copyIdx: -1,
  },

  /**
   * 当前轮次标识：newChat / 页面卸载时自增，用于让**上一轮**的在途回调失效。
   * 真实 SSE 的 `stream()` 返回 void（没有取消接口），故用「轮次作废」代替，
   * 避免 unmount 或新开对话后旧回调继续 setData。
   */
  _runId: 0,

  /**
   * 当前会话是否经由「对话记录 / 欢迎页最近对话」载入（resumeIfNeeded 置位）。
   * 返回键据此决定回**来源列表页**还是欢迎页。
   */
  _resumed: false,

  onLoad() {
    this.initNavBar();
    const quote = getDailyQuote();
    this.setData({
      chatMessages: [{ role: 'ai', text: quote.cn, en: quote.en, daily: true }],
    });
  },

  /**
   * 隐藏 tabBar：对话页走沉浸式（navigationStyle 为 custom + 自定义 tabBar 不渲染），
   * 导航由「顶部返回 icon」与「输入区 + 菜单」承接。
   */
  onShow() {
    const tabBar = (this as any).getTabBar?.();
    if (tabBar) tabBar.setData({ currentPage: '/pages/chat/index/index', selected: 0 });
    // 从「对话记录」点某条记录返回时，载入该会话
    this.resumeIfNeeded();
  },

  /**
   * 自定义导航栏尺寸：状态栏高 + 胶囊下沿，保证标题与原生胶囊视觉对齐。
   * 取不到时保留 data 里的默认值（不阻塞页面）。
   */
  initNavBar() {
    try {
      const sys = wx.getSystemInfoSync();
      const statusBarHeight = sys.statusBarHeight || 20;
      // 导航栏内容区固定 44px（微信标准）：胶囊（32px 高）在其中自然居中，
      // 且 44px 与机型无关 —— 返回键 / 标题 / 右上操作都以它做垂直基准
      this.setData({ statusBarHeight, navHeight: statusBarHeight + 44 });
    } catch {
      // 忽略：退回默认高度
    }
  },

  /**
   * 顶部返回 icon：按**来源**返回 ——
   * - 从「对话记录」/「欢迎页最近对话」载入的会话 → 回到来源列表页；
   * - 正常从欢迎页进入的对话 → 回欢迎页（redirectTo 避免页面栈累积）。
   */
  goBack() {
    if (this._resumed) {
      this._resumed = false;
      wx.navigateTo({ url: '/pages/chat/history/history' });
      return;
    }
    wx.redirectTo({ url: '/pages/welcome/index/index' });
  },

  /** 导航栏「列表」icon：打开对话记录 */
  openHistory() {
    wx.navigateTo({ url: '/pages/chat/history/history' });
  },

  /**
   * 从「对话记录」点某条记录返回时载入该会话。
   * 对话页是 tabBar 页（navigateTo 到不了、switchTab 不能带参数），
   * 因此历史页把 conversationId 写进 storage，由这里读取后拉详情渲染。
   */
  async resumeIfNeeded() {
    let id = '';
    try {
      id = wx.getStorageSync(RESUME_CONV_KEY) || '';
    } catch {
      return;
    }
    if (!id) return;
    try {
      wx.removeStorageSync(RESUME_CONV_KEY);
    } catch {
      /* 清不掉也不阻塞 */
    }

    // 作废在途回调：切会话后，旧会话的流式回包不该再写入
    this._runId += 1;
    // 标记来源：返回键回「对话记录」而非欢迎页
    this._resumed = true;
    // 不弹全屏 loading：历史会话载入若偏慢，全屏「载入中」会让人以为页面卡住 / 元素缺失。
    // 改为静默载入 —— 先回到对话页（导航栏完整可用），数据到了再填充，失败才提示。
    try {
      const detail = await createAgentApi(CHAT_AGENT_ID).getConversation(id);
      const raw: any[] = Array.isArray(detail?.messages) ? detail.messages : [];
      // 只渲染 user / assistant；tool 过程消息不进对话流（与后端一致）
      const msgs: ChatMsg[] = raw
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({
          role: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
          text: String(m.content || ''),
          _id: `h-${Math.random().toString(36).slice(2)}`,
        }));
      this.setData({
        conversationId: id,
        chatMessages: msgs.length
          ? msgs
          : [{ role: 'ai' as const, text: '这个会话还没有内容。', _id: 'h-empty' }],
        sending: false,
        input: '',
        expandMap: {},
        suggestions: [],
        copyIdx: -1,
        // 历史会话的 agent 归属不在列表接口里（产品决策：不展示），故不清空不清算
        currentAgent: null,
      });
      // 可见反馈：与原型 resumeConv 的 toast 对齐，同时用于判断「载入这一步到底跑没跑」
      wx.showToast({ title: '已载入会话', icon: 'none' });
      // 从二级页返回后重新校正导航栏尺寸：避免残留状态导致返回键错位 / 不可见
      this.initNavBar();
      this.scrollToBottom();
    } catch {
      wx.showToast({ title: '载入会话失败', icon: 'none' });
    }
  },

  /** 新对话：清空当前会话，重新注入今日一句 */
  newChat() {
    // 作废在途回调：新一轮开始后，上一轮的 delta / reply / error 不再写 data
    this._runId += 1;
    // 新会话从欢迎页来：返回键回欢迎页
    this._resumed = false;
    const quote = getDailyQuote();
    this.setData({
      conversationId: '',
      sending: false,
      input: '',
      expandMap: {},
      suggestions: OPENING_SUGGESTIONS as string[],
      chatMessages: [{ role: 'ai', text: quote.cn, en: quote.en, daily: true }],
      // 新会话 = 未锁定，清空上一轮的 agent 徽标
      currentAgent: null,
      copyIdx: -1,
    });
    this.scrollToBottom();
  },

  openPlus() {
    this.setData({ showPlus: true });
  },

  closePlus() {
    this.setData({ showPlus: false });
  },

  /**
   * 「+」菜单项：对话页无 tabBar，故「发现能力 / 我的」在此承接，
   * 保证三个 tab 两两可达（交互质检的入口闭环项）。
   */
  onPlusItem(e: any) {
    const key = String(e.currentTarget.dataset.key || '');
    this.setData({ showPlus: false });
    if (key === 'discover') {
      wx.switchTab({ url: '/pages/discover/index/index' });
      return;
    }
    if (key === 'mine') {
      wx.switchTab({ url: '/pages/mine/index/index' });
      return;
    }
    wx.showToast({ title: key + ' · 待接入', icon: 'none' });
  },

  onUnload() {
    // 页面销毁：作废在途回调，避免 setData 打到已销毁实例
    this._runId += 1;
  },

  onInput(e: any) {
    this.setData({ input: e.detail.value });
  },

  /**
   * 键盘右下角「发送」/ 回车：直接发送。
   * 输入区是单行 input（confirm-type="send"），回车**不会**插入换行。
   */
  onConfirm() {
    this.send();
  },

  /** 长按气泡：在该气泡内展开「复制」入口（空气泡 / 流式中不响应） */
  onLongPressMsg(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    const msg = this.data.chatMessages[idx];
    if (!msg || !msg.text) return;
    this.setData({ copyIdx: idx });
  },

  /** 点「复制」：写入系统剪贴板 */
  onCopyMsg(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    const text = this.data.chatMessages[idx]?.text || '';
    this.setData({ copyIdx: -1 });
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
    });
  },

  /** 点消息区空白处：收起复制入口 */
  closeCopyMenu() {
    if (this.data.copyIdx >= 0) this.setData({ copyIdx: -1 });
  },

  /** 点击开场推荐问题：直接发送 */
  onTapSug(e: any) {
    const q = String(e.currentTarget.dataset.q || '').trim();
    if (q) this.sendWith(q);
  },

  send() {
    const question = this.data.input.trim();
    if (!question) {
      wx.showToast({ title: '先输入点内容', icon: 'none' });
      return;
    }
    this.sendWith(question);
  },

  sendWith(question: string) {
    if (this.data.sending) return;

    const aiId = `ai-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const replaceAiText = (next: string, done: boolean) => {
      this.setData({
        chatMessages: this.data.chatMessages.map((m: ChatMsg) =>
          m._id === aiId ? { ...m, text: next, streaming: !done } : m,
        ),
      });
      this.scrollToBottom();
    };

    this.setData({
      chatMessages: [
        ...this.data.chatMessages,
        { role: 'user', text: question, _id: `u-${Date.now()}` },
        { role: 'ai', text: '', _id: aiId, streaming: true },
      ],
      input: '',
      sending: true,
      suggestions: [],
      copyIdx: -1,
    });
    this.scrollToBottom();

    // 本轮标识：回调里比对，不匹配说明已被新对话 / 卸载作废
    const runId = (this._runId += 1);

    createAgentApi(CHAT_AGENT_ID).stream(
      question,
      // ⚠️ 每轮回传会话 id：漏传 = 后端开新会话，上下文断且每轮重新分类
      { conversationId: this.data.conversationId || undefined },
      {
        onEvent: (e) => {
          if (runId !== this._runId) return;
          // 服务端在 start 事件回传会话 id，后续轮次靠它续接同一会话
          if (e.conversationId && e.conversationId !== this.data.conversationId) {
            this.setData({ conversationId: e.conversationId });
          }
          // intent 事件（本轮第一个事件）：记录由哪个 agent 作答
          if (e.type === 'intent' && e.intent) {
            this.setData({
              currentAgent: { id: e.intent.agentId, name: e.intent.agentName || '' },
            });
          }
        },
        onDelta: (delta) => {
          if (runId !== this._runId) return;
          const cur = this.data.chatMessages.find((m: ChatMsg) => m._id === aiId);
          replaceAiText(((cur?.text as string) || '') + delta, false);
        },
        onReply: (text) => {
          if (runId !== this._runId) return;
          replaceAiText(text || '抱歉，暂时没有回复。', true);
          this.setData({ sending: false });
        },
        onError: (err) => {
          if (runId !== this._runId) return;
          // 失败不清空：保留已收到的部分正文，只把这一条标记为失败
          //（流式中途断是最常见形态，丢掉已读内容等于让用户白等）
          // 错误码 → 用户提示：技术原文不再直接透传（规范见 utils/agent-error.ts）
          const info = parseAgentError(err?.message || '');
          this.setData({
            chatMessages: this.data.chatMessages.map((m: ChatMsg) =>
              m._id === aiId
                ? { ...m, failed: true, failReason: info.tip, failCode: info.code, streaming: false }
                : m,
            ),
            sending: false,
          });
          // 登录过期：静默重新登录后自动重发这一轮（用户只需等一下，不用手动点重试）
          if (info.code === 'AUTH_EXPIRED') this.reloginAndRetry(question, aiId);
        },
      },
    );
  },

  /**
   * 401（登录过期）：静默重新登录 —— 微信 `wx.login` 不需要用户操作，
   * 所以这里只弹一个「正在登录…」，成功就关掉并**自动重发这一轮**。
   * 用户感知：等一下，问题自动又发出去了，不用手动点重试。
   */
  async reloginAndRetry(question: string, aiId: string) {
    wx.showLoading({ title: '正在登录…', mask: false });
    try {
      const ok = await ensureLogin();
      wx.hideLoading();
      if (!ok) {
        wx.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
        return;
      }
      // 丢掉那条失败气泡，重新发一次
      this.setData({
        chatMessages: this.data.chatMessages.filter((m: ChatMsg) => m._id !== aiId),
        copyIdx: -1,
      });
      this.sendWith(question);
    } catch {
      wx.hideLoading();
      wx.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
    }
  },

  /**
   * 重试这一轮：取该失败条之前最近的一条用户提问重发，
   * 并把失败条及其之后的内容裁掉（避免残留半截答案）。
   */
  onRetryMsg(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (Number.isNaN(idx)) return;
    const msgs = this.data.chatMessages;
    if (!msgs[idx] || !msgs[idx].failed) return;
    let question = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        question = msgs[i].text;
        break;
      }
    }
    if (!question) return;
    this.setData({ chatMessages: msgs.slice(0, idx), copyIdx: -1 });
    this.sendWith(question);
  },

  /** 删除这一轮：丢弃失败气泡，不留残废记录 */
  onDropMsg(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (Number.isNaN(idx)) return;
    this.setData({
      chatMessages: this.data.chatMessages.filter((_: ChatMsg, i: number) => i !== idx),
      copyIdx: -1,
    });
  },

  /** 切换 AI 长消息展开/收起 */
  onToggleExpand(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (Number.isNaN(idx)) return;
    this.setData({ expandMap: { ...this.data.expandMap, [idx]: !this.data.expandMap[idx] } });
  },

  /**
   * 滚到底部。
   * 注意：消息区是 scroll-view 内部滚动，`wx.pageScrollTo` 对它无效（既有 contract/chat 的老写法失效）。
   * 这里先清空锚点再设置，确保连续调用都能触发滚动。
   */
  scrollToBottom() {
    this.setData({ scrollIntoId: '' });
    // 两次延时：载入历史会话时可能有几十条消息，首次 setData 后视图未必渲染完，
    // 只设一次锚点会打空（表现为「停在顶部」）。第二次作为兜底补位。
    setTimeout(() => this.setData({ scrollIntoId: 'msg-bottom' }), 50);
    setTimeout(() => this.setData({ scrollIntoId: 'msg-bottom' }), 260);
  },
});
