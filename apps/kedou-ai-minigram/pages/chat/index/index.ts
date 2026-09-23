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
import { createAgentApi } from '../../../services/agent-stream';
import { RESUME_CONV_KEY } from '../../../utils/conversation';
import { parseAgentError } from '../../../utils/agent-error';
import { ensureLogin } from '../../../services/auth';
import {
  buildTranslateCardView,
  inferTranslateDirection,
  looksLikeTranslateReply,
} from '../../../utils/translate-parse';
import { speakText, stopSpeak, onSpeakState } from '../../../services/tts';
import { collectGlossary } from '../../../services/glossary';

/** 主对话走服务端意图路由 */
const CHAT_AGENT_ID = 'auto';

/** 需要按「翻译卡片」承载的 agent（与 SSE intent 的 agentId 对齐） */
const CARD_AGENT_IDS = ['translate'];

/** 歌曲卡片载荷（与 services/agent-stream.ts 的 StreamEvent.card 同构） */
interface MusicCardPayload {
  kind: string;
  provider?: {
    code: string;
    name: string;
    appId?: string | null;
    entryType: string;
    path?: string | null;
    ready: boolean;
  };
  songs?: Array<{ title: string; artist?: string; reason?: string }>;
  keyword?: string;
}

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
  /** 载入历史会话时的占位消息（「正在载入…」） */
  loading?: boolean;
  /** 本条失败（网络 / HTTP / 服务端 error）；保留已收到的部分，UI 给「重试 / 删除这一轮」 */
  failed?: boolean;
  /** 失败原因：给用户看的友好提示（不是技术原文） */
  failReason?: string;
  /** 失败错误码：用于区分处理（如 401 自动登录并重试） */
  failCode?: string;
  /** 由翻译官作答 → 用「推荐译文卡片」承载（含流式阶段，见 sendWith） */
  card?: boolean;
  /**
   * 歌曲推荐卡片（SSE `card` 事件 kind=music）。
   * ⚠️ 不能复用上面的 card 布尔值 —— 它已被「推荐译文卡片」占用。
   */
  musicCard?: MusicCardPayload | null;
  /** 卡片英文主文 */
  enMain?: string;
  /** 卡片中文注解（无则空串，不渲染注解区） */
  note?: string;
  /** 卡片方向 meta（如「中文 → 英语」）；推断不出为空，只留 tag */
  meta?: string;
}

/**
 * 新会话首屏的统一欢迎语。
 * 不再是「今日一句」—— 用户还没开始对话时，给一句稳定的招呼即可（今日一句保留在欢迎页展示）。
 */
const WELCOME_GREETING = '科豆 AI · 体验不一样的 AI';

/** 历史会话详情缓存前缀：按会话 id 缓存，第二次进入同一会话秒开 */
const CONV_CACHE_PREFIX = 'conv_detail_';

/** 载入历史会话时最多渲染的条数：长会话只取最近这些，避免一次性渲染过多 */
const RECENT_MSG_LIMIT = 50;

/** 开场推荐问题（写死；批次 4 改由 GET /ai/agents 的 entry.suggestions 驱动） */
const OPENING_SUGGESTIONS = ['帮我翻一句话', '看看合同风险', '今天该做什么'];

/**
 * 历史消息的翻译卡片启发式补判（缓存与网络刷新共用，幂等：已打 card 标记的不重算）。
 *
 * 后端 getConversation 不回传 intent，只能从文本形态识别（utils/translate-parse 的
 * looksLikeTranslateReply：含【推荐译文】标记，或「英文开头 + 中文说明」形态）。
 * 方向 meta 用其前面最近一条用户提问推断 —— 找不到对应提问就不显示（不猜）。
 */
/** 尝试把 tool 消息内容解析成歌曲卡片；不是卡片返回 null（历史回看据此还原，不退化为文本） */
function tryParseMusicCard(content: unknown): MusicCardPayload | null {
  if (typeof content !== 'string' || !content) return null;
  try {
    const obj = JSON.parse(content);
    if (!obj || obj.kind !== 'music' || !Array.isArray(obj.songs) || !obj.songs.length) return null;
    return obj as MusicCardPayload;
  } catch {
    return null;
  }
}

function decorateHistoryCards(msgs: ChatMsg[]): ChatMsg[] {
  let lastUserText = '';
  return msgs.map((m) => {
    if (m.role === 'user') {
      lastUserText = m.text;
      return m;
    }
    // 已是卡片（新缓存）或不像翻译回复：原样返回
    if (m.card || !looksLikeTranslateReply(m.text)) return m;
    const view = buildTranslateCardView(m.text);
    const out: ChatMsg = {
      ...m,
      card: true,
      text: view.text,
      enMain: view.main,
      note: view.note,
      meta: inferTranslateDirection(lastUserText),
    };
    // 消费掉提问：连续多条 AI 消息时，后面那条没有对应提问，meta 不再沿用
    lastUserText = '';
    return out;
  });
}

Page({
  data: {
    radiusClass: "",
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
    /** 朗读按钮态：正在合成音频的消息下标；-1 = 无 */
    speakLoadingIdx: -1,
    /** 朗读按钮态：正在播放的消息下标；-1 = 无（再点一次 = 停止） */
    speakPlayingIdx: -1,
  },

  /**
   * 当前轮次标识：newChat / 页面卸载时自增，用于让**上一轮**的在途回调失效。
   * 真实 SSE 的 `stream()` 返回 void（没有取消接口），故用「轮次作废」代替，
   * 避免 unmount 或新开对话后旧回调继续 setData。
   */
  _runId: 0,

  /** 本次转发针对的消息下标（onShareTap 记录，onShareAppMessage 消费） */
  _shareIdx: -1,

  /** 朗读状态订阅的退订函数（onUnload 时调用） */
  _offSpeakState: null as null | (() => void),

  onLoad() {
    this.initNavBar();
    this.setData({
      chatMessages: [{ role: 'ai', text: WELCOME_GREETING }],
    });
    // 播放结束 / 停止时清除按钮「停止」态（合成中由 await 时序管理）
    this._offSpeakState = onSpeakState((s) => {
      if (!s) this.setData({ speakPlayingIdx: -1 });
    });
  },

  /**
   * 隐藏 tabBar：对话页走沉浸式（navigationStyle 为 custom + 自定义 tabBar 不渲染），
   * 导航由「顶部返回 icon」与「输入区 + 菜单」承接。
   */
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

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
   * 顶部返回 icon：**统一回欢迎页** ——
   * 无论本次会话是从「开始对话」、记录页点一条、还是欢迎页卡片进入的，返回都回欢迎页。
   * （记录页自己有原生返回可以退回，不需要对话页代劳）
   */
  goBack() {
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

    // ① 缓存命中 → 立即渲染（秒开），随后再后台静默刷新
    let cached: ChatMsg[] | null = null;
    try {
      cached = wx.getStorageSync(CONV_CACHE_PREFIX + id) || null;
    } catch {
      /* 读不到就走网络 */
    }
    if (Array.isArray(cached) && cached.length) {
      this.applyResumed(id, cached);
    } else {
      // ② 未命中 → 先给占位气泡（不用全屏 loading：它会盖住导航栏、也像卡住）
      this.setData({
        conversationId: id,
        chatMessages: [{ role: 'ai', text: '正在载入…', _id: 'h-loading', loading: true }],
        sending: false,
        input: '',
        suggestions: [],
        copyIdx: -1,
        currentAgent: null,
      });
    }

    try {
      const detail = await createAgentApi(CHAT_AGENT_ID).getConversation(id);
      const raw: any[] = Array.isArray(detail?.messages) ? detail.messages : [];
      // 只渲染 user / assistant；tool 过程消息不进对话流（与后端一致）
      const all: ChatMsg[] = raw
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'))
        .map((m) => {
          // tool 消息只有一种要渲染：歌曲卡片（present-music-card 的结果，内容即卡片 JSON）。
          // 其余工具过程消息不进对话流（与后端一致），避免历史里冒出原始 JSON。
          const card = m.role === 'tool' ? tryParseMusicCard(m.content) : null;
          return {
            role: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
            text: card ? '' : String(m.content || ''),
            musicCard: card,
            _id: `h-${Math.random().toString(36).slice(2)}`,
          };
        })
        // 卡片消息没有正文，若紧邻的空气泡会出现空白：过滤掉「无正文且无卡片」的空 assistant
        .filter((m) => m.musicCard || m.text || m.role === 'user');
      // ③ 长会话只取最近 N 条，避免一次性渲染过多
      const msgs = all.length > RECENT_MSG_LIMIT ? all.slice(-RECENT_MSG_LIMIT) : all;
      try {
        wx.setStorageSync(CONV_CACHE_PREFIX + id, msgs);
      } catch {
        /* 缓存写失败不影响本次显示 */
      }
      this.applyResumed(id, msgs);
    } catch {
      wx.showToast({ title: '载入会话失败', icon: 'none' });
    }
  },

  /** 渲染载回的历史会话（缓存命中与网络刷新共用） */
  applyResumed(id: string, msgs: ChatMsg[]) {
    this.setData({
      conversationId: id,
      chatMessages: msgs.length
        ? decorateHistoryCards(msgs)
        : [{ role: 'ai' as const, text: '这个会话还没有内容。', _id: 'h-empty' }],
      sending: false,
      input: '',
      expandMap: {},
      suggestions: [],
      copyIdx: -1,
      // 历史会话的 agent 归属不在列表接口里（产品决策：不展示）
      currentAgent: null,
    });
    // 从二级页返回后重新校正导航栏尺寸：避免残留状态导致返回键错位 / 不可见
    this.initNavBar();
    this.scrollToBottom();
  },

  /** 新对话：清空当前会话，重新注入今日一句 */
  newChat() {
    // 作废在途回调：新一轮开始后，上一轮的 delta / reply / error 不再写 data
    this._runId += 1;
    this.setData({
      conversationId: '',
      sending: false,
      input: '',
      expandMap: {},
      suggestions: OPENING_SUGGESTIONS as string[],
      chatMessages: [{ role: 'ai', text: WELCOME_GREETING }],
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
    // 离开页面停掉朗读，避免音频在后台继续响
    stopSpeak();
    if (this._offSpeakState) {
      this._offSpeakState();
      this._offSpeakState = null;
    }
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

  /**
   * 卡片「换一批 / 不感兴趣」：当作新一轮对话发出。
   * 不自己造推荐逻辑 —— 排序与口味都由 Agent 侧按口味档案决定。
   */
  onMusicSwap() {
    if (this.data.sending) return;
    this.sendWith('换一批');
  },
  onMusicDislike() {
    if (this.data.sending) return;
    this.sendWith('不感兴趣，换一批');
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
    /** 本轮累积的原文（未切分）：卡片视图每次由它重算，保证流式 → 完成平滑过渡 */
    let raw = '';
    /** 本轮是否由翻译官作答 → 卡片承载（intent 事件到达后置位，早于任何正文） */
    let isCard = false;

    const patchAi = (patch: Partial<ChatMsg>) => {
      this.setData({
        chatMessages: this.data.chatMessages.map((m: ChatMsg) =>
          m._id === aiId ? { ...m, ...patch } : m,
        ),
      });
      this.scrollToBottom();
    };

    /**
     * 写入本轮正文：卡片态额外填 enMain / note，纯文本态只更新 text。
     * 流式与完成态共用 buildTranslateCardView，不出现排版跳变。
     */
    const writeAiText = (next: string, done: boolean) => {
      raw = next;
      if (isCard) {
        const view = buildTranslateCardView(raw);
        patchAi({ text: view.text, enMain: view.main, note: view.note, streaming: !done });
        return;
      }
      patchAi({ text: next, streaming: !done });
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
            const agentId = e.intent.agentId || '';
            this.setData({
              currentAgent: { id: agentId, name: e.intent.agentName || '' },
            });
            // 翻译官作答 → 立刻铺出卡片骨架（T0：卡片头 + 「翻译中」先到位，消除等待焦虑）
            if (CARD_AGENT_IDS.indexOf(agentId) >= 0) {
              isCard = true;
              const view = buildTranslateCardView(raw);
              patchAi({
                card: true,
                // 方向由本轮提问推断；推断不出为空 → 只留 tag，不留空白
                meta: inferTranslateDirection(question),
                text: view.text,
                enMain: view.main,
                note: view.note,
              });
            }
          }
        },
        onDelta: (delta) => {
          if (runId !== this._runId) return;
          writeAiText(raw + delta, false);
        },
        onReply: (text) => {
          if (runId !== this._runId) return;
          writeAiText(text || '抱歉，暂时没有回复。', true);
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

  /**
   * 卡片操作行（仅完成态渲染）：复制英文主文。
   * 没有主文时退回整段正文，避免点了没反应。
   */
  onCardCopy(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    const msg = this.data.chatMessages[idx];
    if (!msg) return;
    const text = msg.enMain || msg.text || '';
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
    });
  },

  /**
   * 卡片操作行：朗读英文主文 —— 走后端 TTS（gateway /api/ai/tts/speak → ai-service 腾讯云 TTS）。
   * 等待期不做全屏 loading：按钮内联切换「合成中…」，命中本地缓存则直接播放（无等待）。
   * 再点一次 = 停止播放（由 speakText 内部判定）。
   */
  async onCardSpeak(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    const msg = this.data.chatMessages[idx];
    const text = msg?.enMain || msg?.text || '';
    if (!text) return;
    // 再点一次 = 停止（speakText 内部判定，直接返回，无需 loading 态）
    if (this.data.speakPlayingIdx === idx) {
      this.setData({ speakPlayingIdx: -1 });
      await speakText(text);
      return;
    }
    this.setData({ speakLoadingIdx: idx, speakPlayingIdx: -1 });
    const ok = await speakText(text);
    this.setData({ speakLoadingIdx: -1, speakPlayingIdx: ok ? idx : -1 });
  },

  /** 卡片操作行：收藏当前翻译卡片的英文主文（幂等） */
  onCardFav(e: any) {
    const idx = Number(e?.currentTarget?.dataset?.idx);
    const msg = this.data.chatMessages[idx];
    const enMain = String(msg?.enMain || '').trim();
    if (!enMain) return;
    void collectGlossary({
      sourceType: 'chat',
      enMain,
      note: msg?.note,
      meta: { direction: 'zh2en' },
    })
      .then((r) => {
        wx.showToast({ title: r.created ? '已收进生词本' : '已在生词本', icon: 'none' });
      })
      .catch(() => {
        wx.showToast({ title: '收藏失败，请重试', icon: 'none' });
      });
  },

  /**
   * 转发（极简文本式，与翻译结果页同一交互）：
   * 微信不向 onShareAppMessage 传触发来源，故 bindtap 先记录分享哪条卡。
   */
  onShareTap(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    this._shareIdx = Number.isNaN(idx) ? -1 : idx;
  },

  /** 分享内容：当前卡的英文主文；落地走翻译结果页（好友只看译文） */
  onShareAppMessage() {
    const idx = (this as any)._shareIdx;
    const msg = this.data.chatMessages[idx];
    const text = String(msg?.enMain || msg?.text || '').trim();
    return {
      title: text || '科豆 AI',
      path: text
        ? `/packageTranslate/pages/translate/result/result?fwd=${encodeURIComponent(text)}`
        : '/pages/welcome/index/index',
    };
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
