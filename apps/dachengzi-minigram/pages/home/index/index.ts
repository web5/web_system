/**
 * 大橙子个人助理 · 首页（tab 1 / 启动页）
 *
 * 设计同源：docs/ui/prototypes/dachengzi-3tab-2026-11-09.html 的 A1 帧。
 * 分工：首页只放「问候 + 今日一句 + 两条快捷入口 + 最近对话」，能力说明归发现页，
 * 设置统一收在「我的」——三 tab 各管一件事，首页不做能力清单。
 *
 * 为什么首页必须自己登记 tabBar 高亮：
 * 自定义 tabBar 组件在每个页面是独立实例，selected 会回到初始值，纯自推导会
 * 读到旧栈顶 —— 表现为「页面切过去了、高亮还停在上一项」（2026-10-13 实测）。
 * 权威做法见 utils/tabbar.ts 的 setTabBarSelected。
 *
 * 未登录口径：两条入口**不灰化、不禁用**（灰化会让空首页看起来像坏了），
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
    /** 最近一次会话（最多展示一条）；null = 还没有任何会话 */
    recent: null as Recent | null,
    /** 最近对话是否加载中 —— true 显示骨架，false 显示卡片（或空态） */
    recentLoading: true,
  },

  onShow() {
    // tabBar 高亮登记：组件每页独立实例，须由页面显式登记（详见 utils/tabbar.ts）
    setTabBarSelected(this, TAB_INDEX.home);

    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    // 最近对话：每次回到首页刷新（先缓存秒显，再后台刷新）
    this.loadRecent();
  },

  /** 新对话：hero 区快捷入口，独立于两条能力入口（缺省 agentId=auto，无 conversationId） */
  goChat() {
    openEntry('/pages/chat/index/index');
  },

  /** 能力入口 1：翻译（分包页） */
  goTranslate() {
    openEntry('/packageTranslate/pages/translate/index/index');
  },

  /** 能力入口 2：新概念英语逐句精读（主包页） */
  goNce() {
    openEntry('/pages/nce/index/index');
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

    try {
      const api = createAgentApi('auto');
      const res = await api.listConversations(1, 1);
      const first = (res?.list || [])[0];
      if (!first) {
        this.setData({ recent: null, recentLoading: false });
        try {
          wx.removeStorageSync(RECENT_CACHE_KEY);
        } catch {
          /* 清不掉不影响显示 */
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
      this.setData({ recent: next, recentLoading: false });
      try {
        wx.setStorageSync(RECENT_CACHE_KEY, next);
      } catch {
        /* 缓存写失败不影响本次显示 */
      }
    } catch {
      // 加载失败：骨架和卡片都不显示（整块隐藏），避免被误读成「还没有会话」
      this.setData({ recent: null, recentLoading: false });
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
