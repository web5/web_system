import { ensureLogin, isLoggedIn } from './services/auth';
import { currentClass } from './utils/appearance';

/**
 * 后端地址按运行环境切换：
 * - 开发者工具：local.kedouai.com（本机 hosts → nginx → gateway）
 * - 真机（预览/体验版/远程调试）：dev 环境公网网关（DNS → nginx SSL → dev gateway）。
 *   走 https + 正式域名，真机无需开「开发调试」跳域名校验。
 *   ⚠️ 小程序正式上线前需在微信公众平台把 dev.kedouai.com 加入 request 合法域名（或体验版勾选「不校验合法域名」）。
 */
const IS_DEVTOOLS = (() => {
  try {
    return wx.getSystemInfoSync().platform === 'devtools';
  } catch {
    return false;
  }
})();

App<IAppOption>({
  onLaunch() {
    // 把 apiBase 同步落到 storage，供后续请求绕过 wx.getApp 直接读，
    // 避免某些异步栈里 wx.getApp 调用抛错或栈溢出
    try {
      wx.setStorageSync('api_base', this.globalData.apiBase);
    } catch {}
    this.autoLogin();
  },

  /** 圆角风格：当前页面根节点应叠加的 class（各页 onShow 调用，口径 specs/radius-style-dual §4.2） */
  radiusClassOf() {
    return currentClass();
  },

  /** 启动时自动登录（已有 token 则跳过，避免覆盖本地测试 token） */
  async autoLogin() {
    if (isLoggedIn()) {
      return;
    }
    // 走 ensureLogin（单例）：与首屏请求触发的登录共用同一次，避免并发重复 wx.login
    await ensureLogin();
  },

  globalData: {
    userInfo: null,
    token: '',
    refreshToken: '',
    apiBase: IS_DEVTOOLS ? 'http://local.kedouai.com' : 'https://dev.kedouai.com',
    bianbianOrigin: undefined,
    bianbianDesc: undefined,
    bianbianResult: undefined,
  },
});
