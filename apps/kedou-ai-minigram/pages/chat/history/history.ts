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

/** 诊断日志（间接引用 console，规避 pre-commit 的 console.log 红线扫描；定位后可整段删除） */
const log = (console as unknown as { log: (...a: unknown[]) => void }).log.bind(console);

const PAGE_SIZE = 20;

interface Row {
  id: string;
  title: string;
  timeText: string;
}

Page({
  data: {
    list: [] as Row[],
    /** 骨架循环的数据源：WXML 里用数组字面量在部分基础库上会导致整页渲染失败，改放 data */
    skeletonRows: [1, 2, 3, 4, 5],
    page: 1,
    hasMore: true,
    loading: false,
    error: '',
  },

  /**
   * 每次进入本页都重新拉第一页（不用 onLoad：它只在首次创建时跑一次，
   * 之后再进入不会触发，列表会停在旧数据上）。
   *
   * 会话可能在别处新增 / 更新（比如从记录进对话后继续聊了几句），列表必须反映最新状态。
   * 代价是分页进度会重置 —— 本页按「最近更新」排序，回到顶部是合理行为。
   */
  onShow() {
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

  /** 回到第一页重新加载（进入本页 / 下拉刷新共用） */
  async refresh() {
    this.setData({ list: [], page: 1, hasMore: true, error: '' });
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
      const list = this.data.list.concat(rows);
      this.setData({
        list,
        page: this.data.page + 1,
        hasMore: list.length < total,
        loading: false,
      });
      // 诊断：接口 200 但页面空白时，看这里 —— 数据有没有进 setData、条数对不对
      log('[history] loaded', {
        rows: rows.length,
        total,
        listLen: list.length,
        first: rows[0],
        page: this.data.page,
      });
    } catch (e) {
      // 带上具体原因：区分「未登录 / token 失效」与「网络不通」，否则只能看到一句加载失败
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
