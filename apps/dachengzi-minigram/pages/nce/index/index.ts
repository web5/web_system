/**
 * 新概念英语 · 课文目录
 * 数据源：content-hub /api/content-admin/nce/*（与 PC portal / admin 同一份库表）
 */
import { getNceMeta, listNceLessons, type NceLessonSummary, type NceMeta } from '../../../services/nce';

interface Group {
  label: string;
  items: NceLessonSummary[];
}
interface NceInputEvent {
  detail: { value?: string };
}
interface NceTapEvent {
  currentTarget: { dataset: Record<string, string | number | undefined> };
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    groups: [] as Group[],
    meta: null as NceMeta | null,
    keyword: '',
    loading: true,
    error: '',
    all: [] as NceLessonSummary[],
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  onLoad() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [meta, list] = await Promise.all([getNceMeta(), listNceLessons(1, 100)]);
      this.setData({ meta, all: list.items || [] });
      this.applyFilter();
    } catch (e) {
      this.setData({ error: '课文目录加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilter() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const list = (this.data.all || []).filter((l: NceLessonSummary) =>
      !kw ||
      String(l.id).indexOf(kw) >= 0 ||
      (l.title || '').toLowerCase().indexOf(kw) >= 0 ||
      (l.titleCn || '').indexOf(kw) >= 0,
    );
    const groups: Group[] = [];
    for (let s = 1; s <= 96; s += 24) {
      const items = list.filter((l: NceLessonSummary) => l.id >= s && l.id < s + 24);
      if (items.length) groups.push({ label: `Lesson ${s}–${s + 23}`, items });
    }
    this.setData({ groups });
  },

  onSearch(e: NceInputEvent) {
    this.setData({ keyword: String(e.detail.value || '') }, () => this.applyFilter());
  },

  openDetail(e: NceTapEvent) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({ url: `/pages/nce/detail/detail?id=${id}` });
  },

  onRetry() {
    void this.load();
  },
});
