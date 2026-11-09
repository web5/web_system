/**
 * 大橙子个人助理 · 我的（tab 3）
 *
 * 范围收敛：头像卡 + 学习 3 项（翻译记录 / 课文学习进度 / 生词本）
 * + 通用 4 项（翻译设置 / 设置 / 用户协议与隐私政策 / 关于与免责）+ 退出登录。
 * 专业版、AI 记忆（口味 / 记忆）、合同评估设置、我的合同、对话记录、消息通知、清除缓存
 * 已全部移除（能力不在本期范围内；清除缓存已挪进「设置」页）。
 *
 * 数字一律读真数据，读不到就显示空 / 未开始，绝不写死假数字。
 */
import { listGlossary } from '../../../services/glossary';
import { isLoggedIn, logout } from '../../../services/auth';
import { fetchProfile } from '../../../services/account';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';
import { TRANSLATE_HISTORY_KEY } from '../../../utils/translate-keys';

/** 翻译记录条数：读本地历史（写入方 = packageTranslate result 页，key 与 history 页一致） */
function readTrCount(): string {
  try {
    const list: unknown = wx.getStorageSync(TRANSLATE_HISTORY_KEY);
    if (Array.isArray(list) && list.length) return list.length + ' 条';
  } catch {
    // 读不到就留空：宁可不显示，也不编造条数
  }
  return '';
}

Page({
  data: {
    radiusClass: '',
    /** 登录态：false 时整页渲染登录引导卡（不拉任何业务数据） */
    loggedIn: true,
    /** 昵称；空 = 尚未取到（渲染层兜底「未设置昵称」，不写死假昵称） */
    nickname: '',
    /** 脱敏手机号；空 = 未绑定（禁止展示硬编码假数据） */
    phone: '',
    /** 本机翻译记录条数（空则不展示数字） */
    trCount: '',
    /** 生词本条数摘要 */
    glossarySummary: '0 条',
    /** 课文学习进度：暂无进度落库接口，先显示「未开始」（不编造数字） */
    nceSummary: '未开始',
  },

  /**
   * 登录态过期广播退订函数（onUnload 调用）。
   * ⚠️ Page() 参数是对象字面量、没有类属性语法：`xxx: T = v` 会被解析成「把 T 当值用」，
   * 真机编译 fatal（TS2693）——运行时字段初始化只能写成 `null as <类型>`。
   */
  _offAuthExpired: null as (() => void) | null,

  onLoad() {
    // 登录态过期广播：request 401 清 token 后发 auth:expired → 本页弹登录墙。
    // （旧方案 reLaunch 回首页会清空页面栈，致右滑返回永远回首页，已废弃）
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
    }
  },

  onUnload() {
    // 退订登录态广播，避免回调打到已销毁实例
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus && this._offAuthExpired) {
      __bus.off('auth:expired', this._offAuthExpired);
      this._offAuthExpired = null;
    }
  },

  onShow() {
    // tabBar 高亮登记：组件每页独立实例，须由页面显式登记（详见 utils/tabbar.ts）
    setTabBarSelected(this, TAB_INDEX.mine);

    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    const loggedIn = isLoggedIn();
    this.setData({ loggedIn });
    // 未登录：只渲染登录卡，不发起任何业务请求（判据第 8 条）
    if (!loggedIn) return;

    // 账号信息：昵称 / 手机号（未绑定显示占位文案，不展示假数据）
    void fetchProfile()
      .then((info) => {
        this.setData({
          phone: info.phone || '未绑定手机号',
          nickname: info.nickname || '',
        });
      })
      .catch(() => undefined);

    // 翻译记录条数：本地历史实时读；生词本只取总数（pageSize=1），失败保持 0 条不打扰
    this.setData({ trCount: readTrCount() });
    void listGlossary(1, 1)
      .then((r) => {
        this.setData({ glossarySummary: (r.total || 0) + ' 条' });
      })
      .catch(() => undefined);
  },

  goProfile() { wx.navigateTo({ url: '/pages/mine/profile/profile' }); },
  goHistory() { wx.navigateTo({ url: '/packageTranslate/pages/translate/history/history' }); },
  /** 课文学习进度：进课文列表（进度暂无落库接口） */
  goNce() { wx.navigateTo({ url: '/pages/nce/index/index' }); },
  goGlossary() { wx.navigateTo({ url: '/pages/mine/glossary/index' }); },
  /** 翻译设置：翻译功能自己的默认参数（源/目标语言、语气、风格、发音、流式） */
  goTrSettings() { wx.navigateTo({ url: '/packageTranslate/pages/translate/settings/settings' }); },
  goAppSettings() { wx.navigateTo({ url: '/pages/mine/settings/settings' }); },
  goAgreement() { wx.navigateTo({ url: '/pages/mine/agreement/agreement' }); },
  goAbout() { wx.navigateTo({ url: '/pages/mine/about/about' }); },

  /** 退出登录：二次确认 → 服务端作废 + 本地清态 → 停在登录墙（不跳欢迎页） */
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能继续使用。服务端登录凭证会同时失效。',
      confirmText: '退出',
      cancelText: '取消',
      success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) return;
        void (async () => {
          await logout();
          this.setData({ loggedIn: false });
          wx.showToast({ title: '已退出登录', icon: 'none' });
        })();
      },
    });
  },

  /** 登录卡登录成功后回调：刷新本页内容 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.onShow();
  },
});
