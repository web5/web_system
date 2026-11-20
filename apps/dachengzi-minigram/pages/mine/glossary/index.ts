/**
 * 收藏页（原生词本）
 *
 * 入口：我的 → 收藏。
 * 收藏是用户主动行为数据（落 user-service），存句子快照，原课文删除后仍保留。
 *
 * 需求②（V9–V20，本页为三数据页之一）：
 * - V11 页面级 authExpired 标志 + load() catch 分流；本页 empty 与 error 共用态，须特判：
 *   会话过期时保持骨架、不误判空态；非 401 失败沿用原「空态」显示。
 * - V12/V13/V18 会话过期弹窗（login-gate modal 态叠加层）+ 页面级订阅（onLoad on / onUnload off）。
 * - V16 登录成功后由广播回调显式重拉，不依赖 onShow()。
 * - V17 稍后→常驻提示条→再唤起；登录成功前提示条不消失。
 */
import { listGlossary, removeGlossary, GlossaryItem } from '../../../services/glossary';

interface GlossaryViewItem extends GlossaryItem {
  /** meta 展示文本：nce 来源「Lesson N · 第 M 句」，旧 tone/direction 兜底 */
  metaText: string;
}

Page({
  _offAuthExpired: null as (() => void) | null,
  _offAuthLogged: null as (() => void) | null,

  data: {
    radiusClass: "",
    loading: true,
    empty: false,
    items: [] as GlossaryViewItem[],
    /** V11 页面级会话过期标志（由 auth:expired 订阅置位） */
    authExpired: false,
    /** V12 会话过期弹窗（login-gate modal 态） */
    showAuthModal: false,
    /** V17 稍后后的常驻提示条（登录成功前不消失） */
    showReloginTip: false,
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
    // 数据仍由 onShow 首拉（本页既有语义）；重登重拉由 auth:logged 回调显式承接
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
      // V11：会话过期不裸失败；保持骨架/原内容（loading 保持 true），准备弹窗。
      // 本页 empty/error 共用 empty:true,items:[]，会话过期时不得误判为空态。
      if (this.data.authExpired) return;
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

  /** V17「稍后」：收起弹窗 + 常驻提示条（不是纯关闭弹窗） */
  onAuthDefer() {
    this.setData({ showAuthModal: false, showReloginTip: true });
  },

  /** V17 点提示条再次唤起同一 modal-auth；提示条登录成功前不消失 */
  onReopenAuth() {
    this.setData({ showAuthModal: true });
  },
});
