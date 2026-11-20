/**
 * 新概念英语 · 课文目录
 * 数据源：content-hub /api/content-admin/nce/*（与 PC portal / admin 同一份库表）
 *
 * 需求②（V9–V20，本页为三数据页之一）：
 * - V11 页面级 authExpired 标志 + load() catch 分流（会话过期不裸失败、保持骨架准备弹窗）。
 * - V12/V13/V18 会话过期弹窗（login-gate modal 态叠加层）+ 页面级订阅（onLoad on / onUnload off）。
 * - V16 登录成功后由广播回调显式重拉，不依赖 onShow()（目录页 onShow 不调 load）。
 * - V17 稍后→常驻提示条→再唤起；登录成功前提示条不消失。
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
  _offAuthExpired: null as (() => void) | null,
  _offAuthLogged: null as (() => void) | null,

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
    /** V11 页面级会话过期标志（由 auth:expired 订阅置位） */
    authExpired: false,
    /** V12 会话过期弹窗（login-gate modal 态） */
    showAuthModal: false,
    /** V17 稍后后的常驻提示条（登录成功前不消失） */
    showReloginTip: false,
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  onLoad() {
    // V13/V18：页面级订阅（onLoad on / onUnload off；先按旧引用退订防重复订阅）
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthExpired) __bus.off('auth:expired', this._offAuthExpired);
      if (this._offAuthLogged) __bus.off('auth:logged', this._offAuthLogged);
      this._offAuthExpired = () => {
        // T2：置页面级标志 + 弹 modal-auth；保持骨架/原内容，不置裸失败态
        this.setData({ authExpired: true, showAuthModal: true, showReloginTip: false });
      };
      __bus.on('auth:expired', this._offAuthExpired);
      this._offAuthLogged = () => {
        // V16：回调内显式重拉，不依赖 onShow()
        this.setData({ authExpired: false, showAuthModal: false, showReloginTip: false });
        void this.load();
      };
      __bus.on('auth:logged', this._offAuthLogged);
    }
    void this.load();
  },

  onUnload() {
    // V18：页面级退订（与 onLoad 成对，同一 handler 引用 off；组件内不订阅）
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
    }
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
      this.setData({ loading: false });
    } catch {
      // V11：会话过期不裸失败；保持骨架/原内容（loading 保持 true），准备弹窗
      if (this.data.authExpired) return;
      this.setData({ error: '课文目录加载失败，请稍后重试', loading: false });
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

  /** V17「稍后」：收起弹窗 + 常驻提示条（不是纯关闭弹窗） */
  onAuthDefer() {
    this.setData({ showAuthModal: false, showReloginTip: true });
  },

  /** V17 点提示条再次唤起同一 modal-auth；提示条登录成功前不消失 */
  onReopenAuth() {
    this.setData({ showAuthModal: true });
  },
});
