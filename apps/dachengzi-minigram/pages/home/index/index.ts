/**
 * 大橙子英语 · 首页（tab 1 / 启动页）
 *
 * 整改后（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §2/§3.1）：
 * 问候 hero + 今日一句 + 常用功能（默认 NCE）+「更多功能」跳发现。
 * 已删除：新对话卡、最近对话整块、feature-flags 开关依赖。
 *
 * 为什么首页必须自己登记 tabBar 高亮：自定义 tabBar 组件在每个页面是独立实例，
 * selected 会回到初始值，权威做法见 utils/tabbar.ts 的 setTabBarSelected。
 */
import { isLoggedIn } from '../../../services/auth';
import { getDailyQuote } from '../../../utils/daily';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';
import { FEATURES, getPinned, FEATURES_UPDATED_EVENT, type FeatureDef } from '../../../utils/features';

/** 未登录时的登录引导落点：「我的」页有登录入口 */
const MINE_PATH = '/pages/mine/index/index';
const DISCOVER_PATH = '/pages/discover/index/index';

/** 当前「常用功能」项（按 getPinned 顺序映射注册表） */
function pinnedFeatures(): FeatureDef[] {
  const ids = getPinned();
  return FEATURES.filter((f) => ids.includes(f.id));
}

interface FeatureTapEvent {
  currentTarget: { dataset: { path?: string } };
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /** 今日一句（本地文案池按日期取模，同天稳定、隔天自动换） */
    quote: getDailyQuote(),
    /** 登录态：false 时整页渲染登录引导卡（login-gate），不发起任何业务请求 */
    loggedIn: true,
    /** 常用功能（pinned 项，读 utils/features 注册表） */
    features: [] as FeatureDef[],
  },

  _offAuthLogged: null as (() => void) | null,
  _offAuthExpired: null as (() => void) | null,
  _offFeaturesUpdated: null as (() => void) | null,

  onLoad() {
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      this._offAuthLogged = () => this.setData({ loggedIn: isLoggedIn() });
      __bus.on('auth:logged', this._offAuthLogged);
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
      // 常用功能变更广播：发现页「添加常用」后本页即时刷新
      this._offFeaturesUpdated = () => this.refreshPinned();
      __bus.on(FEATURES_UPDATED_EVENT, this._offFeaturesUpdated);
    }
  },

  onUnload() {
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
      if (this._offFeaturesUpdated) {
        __bus.off(FEATURES_UPDATED_EVENT, this._offFeaturesUpdated);
        this._offFeaturesUpdated = null;
      }
    }
  },

  onShow() {
    setTabBarSelected(this, TAB_INDEX.home);
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    this.setData({ loggedIn: isLoggedIn() });
    this.refreshPinned();
  },

  /** 登录卡登录成功后回调：刷新登录态与常用功能 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.refreshPinned();
  },

  refreshPinned() {
    this.setData({ features: pinnedFeatures() });
  },

  /** 点常用功能卡：needLogin 项先判登录，再 navigateTo */
  goFeature(e: FeatureTapEvent) {
    const path = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.path) || '');
    const feature = FEATURES.find((f) => f.path === path);
    if (!feature) return;
    if (feature.needLogin && !isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: MINE_PATH });
      return;
    }
    wx.navigateTo({ url: feature.path });
  },

  /** 更多功能 → 发现页（tab 2，全部功能列表） */
  goMore() {
    wx.switchTab({ url: DISCOVER_PATH });
  },

  onShareAppMessage() {
    return { title: '大橙子英语', path: '/pages/home/index/index' };
  },
});
