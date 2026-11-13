/**
 * 收藏页（原生词本）
 *
 * 入口：我的 → 收藏。
 * 收藏是用户主动行为数据（落 user-service），存句子快照，原课文删除后仍保留。
 */
import { listGlossary, removeGlossary, GlossaryItem } from '../../../services/glossary';

interface GlossaryViewItem extends GlossaryItem {
  /** meta 展示文本：nce 来源「Lesson N · 第 M 句」，旧 tone/direction 兜底 */
  metaText: string;
}

Page({
  data: {
    radiusClass: "",
    loading: true,
    empty: false,
    items: [] as GlossaryViewItem[],
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
      const { list } = await listGlossary(1, 50);
      this.apply(list);
    } catch {
      this.setData({ loading: false, empty: true, items: [] });
    }
  },

  apply(list: GlossaryItem[]) {
    const items: GlossaryViewItem[] = list.map((it) => {
      const m = (it.meta || {}) as {
        tone?: string;
        direction?: string;
        book?: string;
        lessonId?: number;
        lineIndex?: number;
      };
      let metaText = '';
      if (typeof m.lessonId === 'number') {
        const parts = [`Lesson ${m.lessonId}`];
        if (typeof m.lineIndex === 'number') parts.push(`第 ${m.lineIndex + 1} 句`);
        metaText = parts.join(' · ');
      } else {
        const parts = [
          m.tone,
          m.direction === 'zh2en' ? '中文→英语' : m.direction,
        ].filter(Boolean);
        metaText = parts.join(' · ');
      }
      return { ...it, metaText };
    });
    this.setData({ items, empty: items.length === 0, loading: false });
  },

  async onRemove(e: WechatMiniprogram.TouchEvent) {
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

  goNce() {
    wx.navigateTo({ url: '/pages/nce/index/index' });
  },
});
