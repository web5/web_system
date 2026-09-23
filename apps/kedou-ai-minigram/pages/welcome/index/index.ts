/**
 * 科豆 AI · 欢迎页（启动页，非 tab 页）
 *
 * 结构：Hello. + 今日一句 + 最近对话卡片 + 开始对话。
 * 今日一句与对话页首条共用 `utils/daily.ts`，避免两处文案漂移。
 */
import { getDailyQuote } from '../../../utils/daily';
import { createAgentApi } from '../../../services/agent-stream';
import { RESUME_CONV_KEY, formatTime } from '../../../utils/conversation';

/** 最近对话的本地缓存键：用于「先显缓存，再后台刷新」，避免每次进欢迎页都等请求 */
const RECENT_CACHE_KEY = 'welcome_recent_cache';

interface Recent {
  id: string;
  title: string;
  /** 该会话最近一条对话的内容截取（可能为空：详情拉取失败时只显示标题） */
  preview: string;
  timeText: string;
}

Page({
  data: {
    radiusClass: "",
    quote: getDailyQuote(),
    /** 最近一次会话（最多展示一条）；null = 还没有任何会话 */
    recent: null as Recent | null,
    /** 最近对话是否加载中 —— true 显示骨架，false 显示卡片（或整块隐藏） */
    recentLoading: true,
  },

  /**
   * 欢迎页不是 tab 页，框架不会自动注入自定义 tabBar —— 本页是手动挂载的，
   * 所以这里用 selectComponent 取实例（`getTabBar()` 只对 tab 页有效）。
   * selected = -1：tabBar 显示但不高亮任何一项。
   */
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    const tabBar = this.selectComponent('#tabbar') as any;
    if (tabBar) tabBar.setData({ currentPage: '/pages/welcome/index/index', selected: -1 });
    this.loadRecent();
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
      const first: any = (res?.list || [])[0];
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
        const msgs: any[] = Array.isArray(detail?.messages) ? detail.messages : [];
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
   * 点最近对话卡片：写入待恢复会话 id → 进对话页。
   * 对话页 onShow 会载入该会话并滚动到底部（聚焦最新一条）。
   */
  openConv(e: any) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.setStorageSync(RESUME_CONV_KEY, id);
    wx.switchTab({ url: '/pages/chat/index/index' });
  },

  /** 进入对话 tab（switchTab：进入后不可后退回欢迎页） */
  startChat() {
    wx.switchTab({ url: '/pages/chat/index/index' });
  },
});
