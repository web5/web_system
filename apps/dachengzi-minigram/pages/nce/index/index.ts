/**
 * 新概念英语 · 课文目录
 * 数据源：content-hub /api/content-admin/nce/*（与 PC portal / admin 同一份库表）
 */
import { getNceMeta, listNceLessons, type NceLessonSummary, type NceMeta } from '../../../services/nce';
import { NCE_BOOKS, DEFAULT_NCE_BOOK, nceBookTotal, buildNceGroupRanges } from '../books';

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
    /** 当前书册（默认 NCE2），切册时重置 keyword 并重拉该册目录 */
    book: DEFAULT_NCE_BOOK,
    /** 书册切换控件数据源 */
    books: NCE_BOOKS,
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
      const [meta, list] = await Promise.all([
        getNceMeta(this.data.book),
        listNceLessons(1, 100, '', this.data.book),
      ]);
      this.setData({ meta, all: list.items || [] });
      this.applyFilter();
    } catch (e) {
      this.setData({ error: '课文目录加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 切册：重置 keyword（避免跨册搜索结果串味），再重拉该册目录 */
  switchBook(e: NceTapEvent) {
    const book = String(e.currentTarget.dataset.book || DEFAULT_NCE_BOOK);
    if (book === this.data.book) return;
    this.setData({ book, keyword: '' });
    void this.load();
  },

  applyFilter() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const list = (this.data.all || []).filter((l: NceLessonSummary) =>
      !kw ||
      String(l.id).indexOf(kw) >= 0 ||
      (l.title || '').toLowerCase().indexOf(kw) >= 0 ||
      (l.titleCn || '').indexOf(kw) >= 0,
    );
    const total = (this.data.meta && this.data.meta.total > 0)
      ? this.data.meta.total
      : nceBookTotal(this.data.book);
    const groups: Group[] = [];
    for (const r of buildNceGroupRanges(total)) {
      const items = list.filter((l: NceLessonSummary) => l.id >= r.start && l.id <= r.end);
      if (items.length) groups.push({ label: `Lesson ${r.start}–${r.end}`, items });
    }
    this.setData({ groups });
  },

  onSearch(e: NceInputEvent) {
    this.setData({ keyword: String(e.detail.value || '') }, () => this.applyFilter());
  },

  openDetail(e: NceTapEvent) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({ url: `/pages/nce/detail/detail?id=${id}&book=${this.data.book}` });
  },

  onRetry() {
    void this.load();
  },
});
