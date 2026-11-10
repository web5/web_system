/**
 * 大橙子个人助理 · 首页（tab 1 / 启动页）
 *
 * 设计同源：docs/ui/prototypes/dachengzi-3tab-2026-11-09.html 的 A1 帧。
 * 分工：首页只放「问候 + 两条快捷入口 + 最近使用」，能力说明归发现页，
 * 设置统一收在「我的」——三 tab 各管一件事，首页不做能力清单。
 *
 * 为什么首页必须自己登记 tabBar 高亮：
 * 自定义 tabBar 组件在每个页面是独立实例，selected 会回到初始值，纯自推导会
 * 读到旧栈顶 —— 表现为「页面切过去了、高亮还停在上一项」（2026-10-13 实测）。
 * 权威做法见 utils/tabbar.ts 的 setTabBarSelected。
 *
 * 未登录口径：两条入口**不灰化、不禁用**（灰化会让空首页看起来像坏了），
 * 点击后再判登录 —— 未登录则提示并把人送到「我的」登录入口。
 */
import { isLoggedIn } from '../../../services/auth';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';

/** 未登录时的登录引导落点：「我的」页有登录入口 */
const MINE_PATH = '/pages/mine/index/index';

/**
 * 入口统一跳转：先判登录，再 navigateTo。
 *
 * 为什么不在 onShow 里按登录态渲染两套 UI：入口本身对匿名用户也是有效信息
 * （告诉他这里有什么能力），登录与否只影响「点了之后去哪」。
 */
function openEntry(url: string) {
  if (!isLoggedIn()) {
    wx.showToast({ title: '请先登录', icon: 'none' });
    wx.switchTab({ url: MINE_PATH });
    return;
  }
  wx.navigateTo({ url });
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
  },

  onShow() {
    // tabBar 高亮登记：组件每页独立实例，须由页面显式登记（详见 utils/tabbar.ts）
    setTabBarSelected(this, TAB_INDEX.home);

    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  /** 新对话：hero 区快捷入口，独立于两条能力入口（缺省 agentId=auto，无 conversationId） */
  goChat() {
    openEntry('/pages/chat/index/index');
  },

  /** 能力入口 1：翻译（分包页） */
  goTranslate() {
    openEntry('/packageTranslate/pages/translate/index/index');
  },

  /** 能力入口 2：新概念英语逐句精读（主包页） */
  goNce() {
    openEntry('/pages/nce/index/index');
  },

  onShareAppMessage() {
    return { title: '大橙子个人助理', path: '/pages/home/index/index' };
  },
});
