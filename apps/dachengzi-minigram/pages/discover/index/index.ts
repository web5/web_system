/**
 * 大橙子英语 · 发现页（tab 2）—— 全部功能 + 添加常用
 *
 * 整改后（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §2/§3.2）：
 * 渲染 `FEATURES` 全量（NCE + 收藏），每项带「添加常用 / 已添加」开关，
 * 点击卡片进入功能。已删除：对话练习 / 文本翻译卡与 feature-flags 依赖。
 */
import { isLoggedIn } from '../../../services/auth';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';
import { FEATURES, isPinned, togglePinned, FEATURES_UPDATED_EVENT, type FeatureDef } from '../../../utils/features';

interface FeatureView extends FeatureDef {
  pinned: boolean;
}

/** 渲染视图：注册表 + 是否已常驻首页 */
function featureViews(): FeatureView[] {
  return FEATURES.map((f) => ({ ...f, pinned: isPinned(f.id) }));
}

interface FeatureTapEvent {
  currentTarget: { dataset: { path?: string; id?: string } };
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /** 登录态：false 时整页只渲染登录引导卡 */
    loggedIn: true,
    /** 全部功能视图 */
    features: [] as FeatureView[],
  },

  _offAuthExpired: null as (() => void) | null,
  _offAuthLogged: null as (() => void) | null,
  _offFeaturesUpdated: null as (() => void) | null,

  onShow() {
    setTabBarSelected(this, TAB_INDEX.discover);
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    this.setData({ loggedIn: isLoggedIn() });
    this.refresh();
  },

  onLoad() {
    const __bus = getApp<IAppOption>()?.eventBus;
    if (__bus?.on) {
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
      this._offAuthLogged = () => this.setData({ loggedIn: isLoggedIn() });
      __bus.on('auth:logged', this._offAuthLogged);
      this._offFeaturesUpdated = () => this.refresh();
      __bus.on(FEATURES_UPDATED_EVENT, this._offFeaturesUpdated);
    }
  },

  onUnload() {
    const __bus = getApp<IAppOption>()?.eventBus;
    if (__bus?.off) {
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
      if (this._offFeaturesUpdated) {
        __bus.off(FEATURES_UPDATED_EVENT, this._offFeaturesUpdated);
        this._offFeaturesUpdated = null;
      }
    }
  },

  refresh() {
    this.setData({ features: featureViews() });
  },

  /** 登录卡登录成功后回调：刷新本页 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.refresh();
  },

  /** 添加/取消常用（catchtap 隔离，不触发卡片跳转） */
  toggleFeature(e: FeatureTapEvent) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    togglePinned(id);
    this.refresh();
  },

  /** 点卡片进功能（needLogin 项先判登录） */
  openFeature(e: FeatureTapEvent) {
    const path = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.path) || '');
    const feature = FEATURES.find((f) => f.path === path);
    if (!feature) return;
    if (feature.needLogin && !isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/mine/index/index' });
      return;
    }
    wx.navigateTo({ url: feature.path });
  },
});
