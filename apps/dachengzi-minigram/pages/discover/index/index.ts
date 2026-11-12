/**
 * 大橙子英语 · 发现页（tab 2）—— 能力市场
 *
 * 默认关态（新装 = 审核态）只呈现新概念英语；「对话练习」「文本翻译」卡由本地开关
 * 控制（utils/feature-flags.ts，wx:if 分支渲染，不做两套页面）；
 * 「功能设置」入口卡在暗门解锁（双击发现 tab，见 custom-tab-bar/index.ts）后常驻。
 */
import { isLoggedIn } from '../../../services/auth';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';
import { readFlags, FLAGS_UPDATED_EVENT, FlagsState } from '../../../utils/feature-flags';

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /** 登录态：false 时整页只渲染登录引导卡 */
    loggedIn: true,
    /** 本地功能开关：初始全关（安全侧），onShow / flags:updated 广播时以 storage 为准刷新 */
    flags: { chat: false, translate: false, labsUnlocked: false } as FlagsState,
  },

  /**
   * 登录态过期广播退订函数（onUnload 调用）。
   * ⚠️ Page() 参数是对象字面量、没有类属性语法：`xxx: T = v` 会被解析成「把 T 当值用」，
   * 真机编译 fatal（TS2693）——运行时字段初始化一律用 `null as any` 断言式。
   */
  _offAuthExpired: null as any,
  _offAuthLogged: null as (() => void) | null,
  /** 功能开关变更广播退订函数（onUnload 调用） */
  _offFlagsUpdated: null as (() => void) | null,

  onShow() {
    // tabBar 高亮登记：组件每页独立实例，须由页面显式登记（详见 utils/tabbar.ts）
    setTabBarSelected(this, TAB_INDEX.discover);

    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    const loggedIn = isLoggedIn();
    // 开关状态每次进页以 storage 为准刷新（暗门解锁广播错过时也能在 onShow 收敛）
    this.setData({ loggedIn, flags: readFlags() });
  },

  onLoad() {
    // 登录态过期广播：request 401 清 token 后发 auth:expired → 本页弹登录墙。
    // （旧方案 reLaunch 回首页会清空页面栈，致右滑返回永远回首页，已废弃）
    const __bus = (getApp() as any)?.eventBus;
    if (__bus?.on) {
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
      // 登录成功广播：首启静默登录成功后刷新登录态（本页无业务数据，只需收口登录态）
      this._offAuthLogged = () => this.setData({ loggedIn: isLoggedIn() });
      __bus.on('auth:logged', this._offAuthLogged);
      // 功能开关变更广播：设置页拨开关 / 暗门解锁后本页即时重渲染（入口卡 200ms 淡入）
      this._offFlagsUpdated = () => this.setData({ flags: readFlags() });
      __bus.on(FLAGS_UPDATED_EVENT, this._offFlagsUpdated);
    }
  },

  onUnload() {
    // 退订登录态广播，避免回调打到已销毁实例
    const __bus = (getApp() as any)?.eventBus;
    if (__bus?.off) {
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
      if (this._offFlagsUpdated) {
        __bus.off(FLAGS_UPDATED_EVENT, this._offFlagsUpdated);
        this._offFlagsUpdated = null;
      }
    }
  },

  /** 登录卡登录成功后回调：刷新本页 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
  },

  /** 文本翻译（专属 UI，已存在；开关开启时入口才渲染） */
  openTranslate() {
    wx.navigateTo({ url: '/packageTranslate/pages/translate/index/index' });
  },

  /** 对话练习（对话页，已存在；开关开启时入口才渲染） */
  openChat() {
    wx.navigateTo({ url: '/pages/chat/index/index' });
  },

  /** 功能设置（暗门入口卡；本地开关读写页） */
  openSettings() {
    wx.navigateTo({ url: '/pages/discover/settings/settings' });
  },

  /** 新概念英语：主包课文目录（与 PC portal / admin 同一份 nce_lessons 数据） */
  openNce() {
    wx.navigateTo({ url: '/pages/nce/index/index' });
  },
});
