/**
 * 大橙子个人助理 · 对话记录列表页
 *
 * 数据源：createAgentApi('auto').listConversations()（后端已按 source 排除 tool 会话，
 * 翻译会话不会出现在这里 —— 翻译有自己的历史页）。
 * 点击某条 → navigateTo 主对话页并传 conversationId，进入后 getConversation 恢复历史气泡。
 *
 * ⚠️ listConversations 不加多余 query（如 &agentId=）：后端 ListConversationsDto 只声明
 * page/pageSize 且开 forbidNonWhitelisted，多余参数会 400。
 */
import { createAgentApi, type ConversationSummary } from '../../../services/agent-stream';
import { isLoggedIn } from '../../../services/auth';

/** 渲染用行（时间已格式化） */
interface HistoryRow {
  id: string;
  title: string;
  time: string;
}

/** 列表点击事件（只用 currentTarget.dataset.id） */
interface RowTapEvent {
  currentTarget: { dataset: { id?: string } };
}

const TITLE_MAX = 40;

function truncate(s: string, max: number): string {
  const chars = Array.from(String(s || '').trim());
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('') + '…';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 相对时间：今天 HH:mm / 昨天 / N 天前 / 超过 7 天 YYYY-MM-DD */
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return '';
  const d = new Date(t);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const dayMs = 86400000;
  if (t >= todayStart) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (t >= todayStart - dayMs) return '昨天';
  const days = Math.floor((todayStart - t) / dayMs) + 1;
  if (days <= 7) return `${days} 天前`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

Page({
  data: {
    radiusClass: '',
    list: [] as HistoryRow[],
    loading: true,
  },

  _offAuthExpired: null as null | (() => void),

  onLoad() {
    const bus = (getApp() as unknown as { eventBus?: { on?: (e: string, h: () => void) => void } })?.eventBus;
    if (bus?.on) {
      this._offAuthExpired = () => this.setData({ loading: false });
      bus.on('auth:expired', this._offAuthExpired);
    }
  },

  onUnload() {
    const bus = (getApp() as unknown as { eventBus?: { off?: (e: string, h: () => void) => void } })?.eventBus;
    if (bus?.off && this._offAuthExpired) {
      bus.off('auth:expired', this._offAuthExpired);
      this._offAuthExpired = null;
    }
  },

  onShow() {
    const app = getApp<IAppOption>();
    const cls = app.radiusClassOf ? app.radiusClassOf() : '';
    if (cls !== this.data.radiusClass) this.setData({ radiusClass: cls });

    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/mine/index/index' });
      return;
    }
    void this.refresh();
  },

  async refresh() {
    this.setData({ loading: true });
    try {
      const { list } = await createAgentApi('auto').listConversations(1, 50);
      const rows: HistoryRow[] = (list || []).map((it: ConversationSummary) => ({
        id: String(it.id),
        title: truncate(it.title || '未命名对话', TITLE_MAX),
        time: relTime(it.updatedAt || it.createdAt),
      }));
      this.setData({ list: rows, loading: false });
    } catch {
      this.setData({ loading: false });
      wx.showToast({ title: '对话记录加载失败', icon: 'none' });
    }
  },

  /** 恢复某条历史会话 */
  open(e: RowTapEvent) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    wx.navigateTo({ url: `/pages/chat/index/index?conversationId=${encodeURIComponent(id)}` });
  },

  /** 新建通用对话 */
  newChat() {
    wx.navigateTo({ url: '/pages/chat/index/index' });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/home/index/index' }),
    });
  },
});
