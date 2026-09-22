/**
 * 生词本 / 收藏页
 *
 * 入口：我的 → 我的数据 → 生词本。
 * 收藏是用户主动行为数据（落 user-service），存译文快照，原对话删除后仍保留。
 */
import { listGlossary, removeGlossary, GlossaryItem } from '../../../services/glossary';

interface GlossaryViewItem extends GlossaryItem {
  /** 语气 · 方向 拼成的 meta 展示文本 */
  metaText: string;
}

Page({
  data: {
    loading: true,
    empty: false,
    items: [] as GlossaryViewItem[],
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const { list } = await listGlossary(1, 50);
      this.apply(list);
    } catch {
      this.setData({ loading: false, empty: true, items: [] });
    }
  },

  apply(list: GlossaryItem[]) {
    const items: GlossaryViewItem[] = list.map((it) => {
      const m = (it.meta || {}) as { tone?: string; direction?: string };
      const parts = [
        m.tone,
        m.direction === 'zh2en' ? '中文→英语' : m.direction,
      ].filter(Boolean);
      return { ...it, metaText: parts.join(' · ') };
    });
    this.setData({ items, empty: items.length === 0, loading: false });
  },

  async onRemove(e: any) {
    const id = Number(e.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    wx.showLoading({ title: '移除中…', mask: false });
    try {
      const ok = await removeGlossary(id);
      wx.hideLoading();
      wx.showToast({ title: ok ? '已移出收藏' : '移除失败，请重试', icon: 'none' });
      if (ok) void this.load();
    } catch {
      wx.hideLoading();
      wx.showToast({ title: '移除失败，请重试', icon: 'none' });
    }
  },

  goTranslate() {
    wx.navigateTo({ url: '/packageTranslate/pages/translate/index/index' });
  },
});
