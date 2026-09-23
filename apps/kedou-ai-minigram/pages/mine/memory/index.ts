/**
 * 用户记忆页
 *
 * 入口：我的 → AI 记忆 → 用户记忆。
 * AI 每轮对话后异步提炼写入（user_memories），这里按 category 分组展示，可单条删除。
 * 一期只读 + 删除，不支持手动新增/编辑。
 */
import { listMemory, removeMemory, MemoryItem } from '../../../services/user-memory';

const CATEGORY_TITLE: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  habit: '习惯',
};

Page({
  data: {
    radiusClass: "",
    loading: true,
    empty: false,
    groups: [] as Array<{ category: string; title: string; items: MemoryItem[] }>,
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    void this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const { list } = await listMemory(1, 50);
      this.apply(list);
    } catch {
      this.setData({ loading: false, empty: true, groups: [] });
    }
  },

  apply(list: MemoryItem[]) {
    const order = ['fact', 'preference', 'habit'];
    const map = new Map<string, MemoryItem[]>();
    for (const m of list) {
      const arr = map.get(m.category) || [];
      arr.push(m);
      map.set(m.category, arr);
    }
    const groups = order
      .filter((c) => map.has(c))
      .map((c) => ({ category: c, title: CATEGORY_TITLE[c] || c, items: map.get(c)! }));
    this.setData({ groups, empty: list.length === 0, loading: false });
  },

  async onRemove(e: any) {
    const id = Number(e.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    wx.showLoading({ title: '删除中…', mask: false });
    try {
      const ok = await removeMemory(id);
      wx.hideLoading();
      wx.showToast({ title: ok ? '已删除' : '删除失败，请重试', icon: 'none' });
      if (ok) void this.load();
    } catch {
      wx.hideLoading();
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
    }
  },

  goChat() {
    wx.switchTab({ url: '/pages/chat/index/index' });
  },
});
