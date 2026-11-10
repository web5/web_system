// 小程序「设置」页：外观 / 存储 / 关于 / 账号 四段共 5 项，每项都真生效。
//
// 历史项「深色模式 / 字体大小 / 消息通知 / 个性化推荐 / 隐私设置 / 回上一版入口页」已整项移除：
// app.json 无 darkmode 且无 theme/ 目录（做不了跟随系统）、无字号缩放通道、
// 无订阅消息授权、无个性化推荐实现、那个入口页已下线（原跳转是死链）。
// 移除即整项删净：不留置灰行、不留空方法。
import * as appearance from '../../../utils/appearance';
import { logout, isLoggedIn } from '../../../services/auth';
import { getToken, getRefreshToken, setToken } from '../../../utils/request';
import { TRANSLATE_HISTORY_KEY, TRANSLATE_PARAMS_KEY, TRANSLATE_SETTINGS_KEY } from '../../../utils/translate-keys';

/**
 * 清理缓存时**必须保留**的本地存储 key —— 白名单之外的 key 一律视为可清缓存。
 * 实现用「白名单排除法」逐个 removeStorageSync，绝不用 wx.clearStorage() 一把梭
 * （一把梭中途失败会把登录态和偏好一起清掉，无法回滚）。
 * 语义边界：**清临时数据，不清用户资产与偏好**。
 * - 登录凭证 / 主动退出标志 / 接口域名：见 utils/request.ts 的 TOKEN_KEY、REFRESH_TOKEN_KEY、
 *   LOGGED_OUT_KEY、api_base。清掉会直接把人踢下线，或让后续请求丢掉 apiBase
 * - 界面偏好：utils/appearance.ts 的 STORAGE_KEY（圆角风格）；nce-mode / nce-font
 *   （课文阅读模式与字号偏好，见 pages/nce/detail/detail.ts）
 * - 用户资产与业务偏好（kd_*）：翻译记录 / 翻译入参 / 翻译默认参数。
 *   历史页无服务端备份，清掉即永久丢失，用户会当成「我的记录莫名消失」
 * ⚠️ NCE 课文学习进度**尚未落库**（pages/nce 下只有 nce-mode / nce-font 两个偏好 key），
 *   将来落库时（无论叫 kd_nce_progress 还是别的名字）必须同步加进本名单，否则清缓存会吃掉进度。
 */
const PRESERVE_KEYS: string[] = [
  'access_token',
  'refresh_token',
  'account_logged_out',
  'api_base',
  appearance.STORAGE_KEY,
  TRANSLATE_HISTORY_KEY,
  TRANSLATE_PARAMS_KEY,
  TRANSLATE_SETTINGS_KEY,
  'nce-mode',
  'nce-font',
];

/** 容量 → 展示文案：入参是 wx.getStorageInfoSync().currentSize（单位千字节，实时读、不写死）。
 *  ≥0.1 兆用一位小数（如 0.3）；更小用千字节 —— 本机缓存常只有几千字节，
 *  强行折成兆会显示成「0.00」，看起来像没生效的假数据。 */
function formatSize(kb: number): string {
  const safe = Number.isFinite(kb) && kb > 0 ? kb : 0;
  const mb = safe / 1024;
  return mb >= 0.1 ? mb.toFixed(1) + 'MB' : Math.round(safe) + 'KB';
}

Page({
  data: {
    radiusClass: '',
    radiusText: appearance.labelOf(),
    /** 本地缓存占用：onShow 与清理后都按 currentSize 实时换算，禁止写死 */
    cacheText: '',
  },

  onShow() {
    // 登录守卫：分享直达等路径可能绕过 tab 的登录墙
    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateBack();
      return;
    }
    // 圆角风格：本页即偏好入口，根节点 class 与设置项文案都按本地存储刷新
    const cls = appearance.currentClass();
    const label = appearance.labelOf();
    this.setData({ radiusClass: cls, radiusText: label, cacheText: this.cacheSizeText() });
  },

  /** 当前缓存占用文案：每次调用都重新读 storage，不缓存、不写死 */
  cacheSizeText(): string {
    try {
      return formatSize(wx.getStorageInfoSync().currentSize);
    } catch {
      return formatSize(0);
    }
  },

  /** 圆角风格：柔和 / 清爽 / 直角 —— 写入本地存储并立即刷新本页根节点 class */
  pickRadius() {
    const labels = appearance.STYLE_OPTIONS.map((o) => o.label);
    wx.showActionSheet({
      itemList: labels,
      success: (res: WechatMiniprogram.ShowActionSheetSuccessCallbackResult) => {
        const opt = appearance.STYLE_OPTIONS[res.tapIndex];
        if (!opt) return;
        appearance.setStyle(opt.value);
        this.setData({ radiusText: opt.label, radiusClass: appearance.currentClass() });
      },
      fail: () => undefined,
    });
  },

  /**
   * 清除缓存（真清）：
   * 1) 取 wx.getStorageInfoSync().keys，用 PRESERVE_KEYS 白名单排除出可清列表；
   * 2) 二次确认后才逐个 wx.removeStorageSync（不用 clearStorage 一把梭）；
   * 3) 清完重新读 currentSize，用「清理前 - 清理后」算真实释放量，并立即刷新展示值。
   * 登录凭证、圆角偏好、kd_* 用户数据均在白名单内，不会被清。
   */
  clearCache() {
    // 直接调 getStorageInfoSync（不经包装函数）：容量必须来自真实 API，读不到就明说，不猜
    let before: WechatMiniprogram.GetStorageInfoSyncOption | null = null;
    try {
      before = wx.getStorageInfoSync();
    } catch {
      before = null;
    }
    if (!before) {
      wx.showToast({ title: '缓存读取失败，请稍后重试', icon: 'none' });
      return;
    }
    const removable = before.keys.filter((key) => !PRESERVE_KEYS.includes(key));
    if (!removable.length) {
      wx.showToast({ title: '没有可清理的缓存', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清除缓存',
      content: '将清理本机临时缓存，你的翻译记录、学习进度与偏好设置会保留。',
      confirmText: '清除',
      cancelText: '取消',
      success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) return;
        // 凭证快照兜底：万一日后 request.ts 改了 key 名而白名单没跟上，也不会把用户清成未登录
        const token = getToken();
        const refreshToken = getRefreshToken();
        removable.forEach((key) => {
          try {
            wx.removeStorageSync(key);
          } catch {
            // 单个 key 删除失败不中断整体清理
          }
        });
        if (token && !getToken()) setToken(token, refreshToken);

        // 清完再读一次，用真实差值算释放量（读失败就按「没变化」处理，不编造）
        let afterKb = before.currentSize;
        try {
          afterKb = wx.getStorageInfoSync().currentSize;
        } catch {
          afterKb = before.currentSize;
        }
        const freedKb = Math.max(0, before.currentSize - afterKb);
        this.setData({ cacheText: formatSize(afterKb) });
        wx.showToast({
          title: freedKb > 0 ? `已释放 ${formatSize(freedKb)}` : `当前占用 ${formatSize(afterKb)}`,
          icon: 'none',
        });
      },
    });
  },

  /** 用户协议与隐私政策 */
  goAgreement() {
    wx.navigateTo({ url: '/pages/mine/agreement/agreement' });
  },

  /** 关于与免责（品牌、免责正文、AI 生成内容提示） */
  goAbout() {
    wx.navigateTo({ url: '/pages/mine/about/about' });
  },

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
          // 回到「我的」tab：那里有登录入口
          wx.switchTab({ url: '/pages/mine/index/index' });
          wx.showToast({ title: '已退出登录', icon: 'none' });
        })();
      },
    });
  },
});
