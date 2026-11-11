/**
 * 大橙子个人助理 · 首页（tab 1 / 启动页）
 *
 * 设计同源：docs/ui/prototypes/dachengzi-3tab-2026-11-09.html 的 A1 帧。
 * 分工：首页只放「问候 + 今日一句 + 新对话入口 + 最近对话」，能力说明归发现页，
 * 设置统一收在「我的」——三 tab 各管一件事，首页不做能力清单。
 *
 * 为什么首页必须自己登记 tabBar 高亮：
 * 自定义 tabBar 组件在每个页面是独立实例，selected 会回到初始值，纯自推导会
 * 读到旧栈顶 —— 表现为「页面切过去了、高亮还停在上一项」（2026-10-13 实测）。
 * 权威做法见 utils/tabbar.ts 的 setTabBarSelected。
 *
 * 未登录口径：入口**不灰化、不禁用**（灰化会让空首页看起来像坏了），
 * 点击后再判登录 —— 未登录则提示并把人送到「我的」登录入口。
 * 最近对话拉取需登录态：未登录不发请求、显示空态（与科豆 login-gate 同语义）。
 */
import { createAgentApi } from '../../../services/agent-stream';
import { isLoggedIn } from '../../../services/auth';
import { getDailyQuote } from '../../../utils/daily';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';

/** 未登录时的登录引导落点：「我的」页有登录入口 */
const MINE_PATH = '/pages/mine/index/index';

/** 最近对话的本地缓存键：先显缓存，再后台刷新（stale-while-revalidate） */
const RECENT_CACHE_KEY = 'welcome_recent_cache';

/**
 * 最近对话的硬超时兜底（毫秒）—— 骨架屏最迟在这个时限内退出（台账 #8687）。
 *
 * 为什么必须有它：本区块 loading 的关闭原本 100% 依赖 `await` 返回，
 * 一旦某个 await 永不 settle（如 request 层 `await loginEnsurer()` 悬挂），
 * 骨架屏就永久驻留 —— 既不报错、也无 toast，连「加载失败」都等不到。
 *
 * 为什么是 12s（不是 API_TIMEOUT.DEFAULT 的 10s）：
 * 单个请求 10s 超时已由 wx.request 保证；本兜底要盖住「列表 + 详情」两段串行，
 * 取 12s = 10s 请求超时 + 余量，避免与正常超时路径抢答（弱网下先让 wx.request
 * 自己报错，走原有异常态出口，语义更准确）。
 */
const RECENT_LOAD_TIMEOUT = 12_000;

/** 最近一次会话（会话维度，最多展示一条） */
interface Recent {
  id: string;
  title: string;
  /** 该会话最近一条对话的内容截取（可能为空：详情拉取失败时只显示标题） */
  preview: string;
  timeText: string;
}

/** 最近对话卡片点击事件（dataset.id）最小结构 */
interface ConvTapEvent {
  currentTarget?: { dataset?: { id?: string | number } };
}

/** 时间展示：今天给时刻，昨天 / 更早给日期（与科豆 welcome 同口径） */
function formatTime(v: string | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (sameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 入口统一跳转：先判登录，再 navigateTo。
 *
 * 为什么不在 onShow 里按登录态渲染两套 UI：入口本身对匿名用户也是有效信息
 * （告诉他这里有什么能力），登录与否只影响「点了之后去哪」。
 */
function openEntry(url: string) {
  if (!isLoggedIn()) {
    wx.showToast({ title: '请先登录', icon: 'none' });
    wx.switchTab({ url: MINE_PATH });
    return;
  }
  wx.navigateTo({ url });
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /** 今日一句（本地文案池按日期取模，同天稳定、隔天自动换） */
    quote: getDailyQuote(),
    /** 登录态：false 时整页渲染登录引导卡（login-gate），不发起任何业务请求 */
    loggedIn: true,
    /** 最近一次会话（最多展示一条）；null = 还没有任何会话 */
    recent: null as Recent | null,
    /** 最近对话是否加载中 —— true 显示骨架，false 显示卡片（或空态/异常态） */
    recentLoading: true,
    /** 最近对话是否处于「接口异常」态 —— true 显示「加载失败，点此重试」，false 显示真·空态 */
    recentError: false,
  },

  /**
   * 登录成功广播退订函数（onUnload 调用）。
   * ⚠️ Page() 参数是对象字面量：运行时字段初始化只能写成 `null as <类型>`。
   */
  _offAuthLogged: null as (() => void) | null,
  _offAuthExpired: null as (() => void) | null,

  /**
   * loadRecent 的轮次序号：每轮进入 +1。
   * 异步回来（含超时计时器、await 之后的迟到返回）先比对序号，不匹配即为过期轮次，
   * 直接丢弃 —— 否则上一轮的超时会关掉本轮的骨架屏、旧数据会覆盖新数据。
   */
  _recentSeq: 0,
  /** loadRecent 的硬超时计时器 id（null = 当前没有在跑的计时器） */
  _recentTimer: null as ReturnType<typeof setTimeout> | null,

  onLoad() {
    // 登录成功广播：首启静默登录成功后刷新登录态并重拉最近对话（loadRecent 内部按登录态收敛），
    // 替代「仅 onShow 同步判 isLoggedIn」导致的首启不刷新竞态。
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      this._offAuthLogged = () => {
        this.setData({ loggedIn: isLoggedIn() });
        this.loadRecent();
      };
      __bus.on('auth:logged', this._offAuthLogged);
      // 登录态过期广播：request 401 / ai-agent 4010 信封清 token 后发 auth:expired → 本页弹登录墙
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
    }
  },

  onUnload() {
    // 页面销毁：收掉可能在跑的硬超时计时器，避免对已销毁实例 setData
    if (this._recentTimer != null) {
      clearTimeout(this._recentTimer);
      this._recentTimer = null;
    }
    // 退订登录态广播，避免回调打到已销毁实例
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
    }
  },

  onShow() {
    // tabBar 高亮登记：组件每页独立实例，须由页面显式登记（详见 utils/tabbar.ts）
    setTabBarSelected(this, TAB_INDEX.home);

    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    // 每次回到首页先同步登录态，再决定是否拉最近对话
    this.setData({ loggedIn: isLoggedIn() });

    // 最近对话：每次回到首页刷新（先缓存秒显，再后台刷新）
    this.loadRecent();
  },

  /** 登录卡登录成功后回调：刷新登录态与页面内容 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.onShow();
  },

  /** 新对话：hero 区快捷入口，独立于能力入口（缺省 agentId=auto，无 conversationId） */
  goChat() {
    openEntry('/pages/chat/index/index');
  },

  /**
   * 最近一次会话的**最近一条对话**（stale-while-revalidate）。
   *
   * 列表接口只返回标题/时间（不含消息内容），所以还要拉一次会话详情取最后一条 ——
   * 详情返回的是**全量 messages**，是整条链路里最慢的一环，因此：
   *  1. 先用本地缓存秒显（不阻塞首屏，也不闪骨架）；
   *  2. 再后台请求刷新，成功则写回缓存。
   */
  async loadRecent() {
    // ── 轮次（seq）登记：并发/重入保护 ────────────────────────────────────
    // 每轮 +1；此后所有「异步回来的写入」（超时计时器、await 之后的迟到返回）
    // 都要先比对自己是否仍是当前轮次，不匹配即丢弃，避免互相覆盖。
    const seq = (this._recentSeq || 0) + 1;
    this._recentSeq = seq;

    /** 收掉本轮/上轮的硬超时计时器（幂等：无计时器时什么都不做） */
    const clearTimer = () => {
      if (this._recentTimer != null) {
        clearTimeout(this._recentTimer);
        this._recentTimer = null;
      }
    };
    /** 本轮是否已被新一轮取代 */
    const isStale = () => this._recentSeq !== seq;
    /**
     * 本轮写结果：先收计时器，再判轮次 —— 两条都在所有出口上必经，
     * 保证既不留悬挂计时器，也不会用过期轮次的状态覆盖新一轮。
     */
    const settle = (patch: Record<string, unknown>): boolean => {
      clearTimer();
      if (isStale()) return false;
      this.setData(patch);
      return true;
    };

    // 上一轮的计时器先收掉：它是过期轮次，留着只会在错误的时点关掉本轮的 loading
    clearTimer();

    // 未登录：不发请求，直接空态（退出登录已由 auth 层清缓存）
    if (!isLoggedIn()) {
      this.setData({ recent: null, recentLoading: false });
      return;
    }

    let cached: Recent | null = null;
    try {
      cached = wx.getStorageSync(RECENT_CACHE_KEY) || null;
    } catch {
      /* 读不到就当没有缓存 */
    }
    if (cached && cached.id) {
      this.setData({ recent: cached, recentLoading: false });
    } else {
      this.setData({ recentLoading: true });
    }

    // 每次发起请求前重置异常态，避免上一次的「加载失败」残留到本轮
    this.setData({ recentError: false });

    // ── 硬超时兜底 ──────────────────────────────────────────────────────
    // 见 RECENT_LOAD_TIMEOUT 注释：无论任何原因不返回，骨架屏必须在此时限内退出。
    // 计时器回调里 self._recentTimer 先置 null（已触发，无需再 clear）。
    this._recentTimer = setTimeout(() => {
      this._recentTimer = null;
      // ⚠️ 有已显示内容（缓存秒显 / 上一轮成功结果）时只关 loading：
      // 把用户已经看到的卡片拿掉、改显示「加载失败」，比不兜底更差。
      // 只有实在没内容可显示时，才落「加载失败，点此重试」（区别于空态文案）。
      if (this.data.recent != null) {
        settle({ recentLoading: false });
      } else {
        settle({ recent: null, recentLoading: false, recentError: true });
      }
    }, RECENT_LOAD_TIMEOUT);

    try {
      const api = createAgentApi('auto');
      // 列表接口按 source 过滤（默认只查 chat），翻译会话 source='tool' 会被漏掉。
      // 并发查两路再合并取最新，避免首页「最近会话」空态。
      const [chatRes, toolRes] = await Promise.all([
        api.listConversations(1, 1, 'chat').catch(() => null),
        api.listConversations(1, 1, 'tool').catch(() => null),
      ]);
      const merged = [
        ...(chatRes && Array.isArray(chatRes.list) ? chatRes.list : []),
        ...(toolRes && Array.isArray(toolRes.list) ? toolRes.list : []),
      ];
      // 按 updatedAt 倒序取最新一条（updatedAt 可能为 undefined，用字符串比较兜底）
      const first = merged.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];

      if (chatRes === null && toolRes === null) {
        // 两路都异常（都 reject）：按「接口异常」处理，不显示「暂无记录」空态
        settle({ recent: null, recentLoading: false, recentError: true });
        return;
      }
      if (!first) {
        // 真·空态：确实还没有会话
        if (settle({ recent: null, recentLoading: false, recentError: false })) {
          try {
            wx.removeStorageSync(RECENT_CACHE_KEY);
          } catch {
            /* 清不掉不影响显示 */
          }
        }
        return;
      }

      let preview = '';
      try {
        const detail = await api.getConversation(first.id);
        const msgs = Array.isArray(detail?.messages) ? detail.messages : [];
        const last = msgs.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).pop();
        preview = String(last?.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      } catch {
        /* 详情拉取失败也要能显示：退回只显示标题 */
      }

      const next: Recent = {
        id: first.id,
        title: first.title || '（无标题）',
        preview,
        timeText: formatTime(first.updatedAt),
      };
      // 过期轮次的迟到返回：不写屏、也不写缓存（否则旧数据会盖掉新一轮）
      if (settle({ recent: next, recentLoading: false, recentError: false })) {
        try {
          wx.setStorageSync(RECENT_CACHE_KEY, next);
        } catch {
          /* 缓存写失败不影响本次显示 */
        }
      }
    } catch {
      // 加载失败：按「接口异常」处理（区别于真·空态），不误读成「还没有会话」
      settle({ recent: null, recentLoading: false, recentError: true });
    }
  },

  /**
   * 点最近对话卡片：携 conversationId 进对话页恢复该会话。
   * 对话页 onLoad 读到 conversationId → loadHistory 渲染并聚焦最新一条。
   */
  openConv(e: ConvTapEvent) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/chat/index/index?conversationId=' + encodeURIComponent(id) });
  },

  onShareAppMessage() {
    return { title: '大橙子个人助理', path: '/pages/home/index/index' };
  },
});
