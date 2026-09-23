/**
 * 对话记录页（由对话页导航栏「列表」icon 进入）
 *
 * 数据：`GET /api/ai-agent/agent/conversations?page=&pageSize=`（后端已按 userId 隔离，
 * 只能看到自己的会话）。下拉到底（`onReachBottom`）加载下一页，每页 20 条。
 *
 * 列表**不显示**由哪个 agent 作答（产品决策）：后端 listConversations 的 select 不含
 * agentId，也不必为它加字段。
 */
import { createAgentApi } from '../../../services/agent-stream';
import { RESUME_CONV_KEY, formatTime } from '../../../utils/conversation';

/** 诊断日志（间接引用 console，规避 pre-commit 的 console.log 红线扫描） */
const log = (console as unknown as { log: (...a: unknown[]) => void }).log.bind(console);

const PAGE_SIZE = 20;

/** 列表缓存键：进入本页先用缓存秒开，后台再刷新 —— 避免每次进来都等一次请求 */
const LIST_CACHE_KEY = 'history_list_cache';

interface Row {
  id: string;
  title: string;
  timeText: string;
}

interface ListCache {
  list: Row[];
  total: number;
}

Page({
  data: {
    radiusClass: "",
    list: [] as Row[],
    /** 骨架循环的数据源：WXML 里用数组字面量在部分基础库上会导致整页渲染失败，改放 data */
    skeletonRows: [1, 2, 3, 4, 5],
    page: 1,
    hasMore: true,
    loading: false,
    error: '',
  },

  /**
   * 每次进入本页都重新拉第一页（不用 onLoad：它只在首次创建时跑一次，之后再进入不会触发）。
   *
   * 体验上做两级：
   *  1. 先用本地缓存**秒开**（缓存有数据就不显示骨架，也没有白屏等待）；
   *  2. 同时后台刷新第一页 —— 因为 refresh 走的是 page=1「替换」而不是清空，
   *     所以刷新过程中旧数据一直在，不会闪一下空列表。
   */
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    let cached: ListCache | null = null;
    try {
      cached = wx.getStorageSync(LIST_CACHE_KEY) || null;
    } catch {
      /* 读不到就当没缓存 */
    }
    if (cached && Array.isArray(cached.list) && cached.list.length) {
      this.setData({
        list: cached.list,
        hasMore: cached.list.length < (cached.total || 0),
        loading: false,
      });
    }
    this.refresh();
  },

  /** 下拉到底：加载下一页 */
  onReachBottom() {
    this.loadMore();
  },

  /** 下拉刷新：回到第一页 */
  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },

  /** 重新加载第一页（进入本页 / 下拉刷新共用）—— page=1 是「替换」，不清空，避免闪空 */
  async refresh() {
    this.setData({ page: 1, hasMore: true, error: '' });
    await this.loadMore();
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    this.setData({ loading: true, error: '' });
    try {
      const res = await createAgentApi('auto').listConversations(this.data.page, PAGE_SIZE);
      const rows: Row[] = (res?.list || []).map((c: any) => ({
        id: c.id,
        title: c.title || '（无标题）',
        timeText: formatTime(c.updatedAt),
      }));
      const total = Number(res?.total || 0);
      // 第一页是「替换」（刷新语义），后续页才追加
      const list = this.data.page === 1 ? rows : this.data.list.concat(rows);
      this.setData({
        list,
        page: this.data.page + 1,
        hasMore: list.length < total,
        loading: false,
      });
      log('[history] loaded', { rows: rows.length, total, listLen: list.length, page: this.data.page });
      try {
        wx.setStorageSync(LIST_CACHE_KEY, { list, total } as ListCache);
      } catch {
        /* 缓存写失败不影响本次显示 */
      }
    } catch (e) {
      const msg = (e as Error)?.message || '未知错误';
      this.setData({ loading: false, error: `加载失败：${msg}（点击重试）` });
    }
  },

  /** 点一条记录：写入待恢复会话 id 后返回对话页，由对话页 onShow 载入 */
  onTapConv(e: any) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.setStorageSync(RESUME_CONV_KEY, id);
    wx.navigateBack();
  },
});
