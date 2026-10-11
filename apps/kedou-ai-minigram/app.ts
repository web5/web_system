import { ensureLogin, isLoggedIn } from './services/auth';
import { currentClass, applyFromServer } from './utils/appearance';

/**
 * 后端地址按运行环境切换（wx.getAccountInfoSync().miniProgram.envVersion）：
 * - 开发者工具：local.kedouai.com（本机 hosts → nginx → gateway）
 * - develop 开发版 / trial 体验版：dev 环境公网网关 https://dev.kedouai.com
 * - release 正式版：生产域名 https://kedouai.com
 * 老基础库不支持 getAccountInfoSync 时兜底 dev（宁可连错环境也不白屏）。
 *
 * 合法域名：dev.kedouai.com 与 kedouai.com 均需在公众平台「request 合法域名」中登记。
 */
const IS_DEVTOOLS = (() => {
  try {
    return wx.getSystemInfoSync().platform === 'devtools';
  } catch {
    return false;
  }
})();

function resolveApiBase(): string {
  if (IS_DEVTOOLS) return 'http://local.kedouai.com';
  try {
    const env = wx.getAccountInfoSync()?.miniProgram?.envVersion;
    if (env === 'release') return 'https://kedouai.com';
    // 'develop' | 'trial' 一律连 dev
  } catch {
    // 老基础库无该 API，走下面兜底
  }
  return 'https://dev.kedouai.com';
}

App<IAppOption>({
  onLaunch() {
    // 把 apiBase 同步落到 storage，供后续请求绕过 wx.getApp 直接读，
    // 避免某些异步栈里 wx.getApp 调用抛错或栈溢出
    try {
      wx.setStorageSync('api_base', this.globalData.apiBase);
    } catch {}
    // 界面偏好跟账号走：登录态就绪后以服务端为准收敛本地。
    // 未登录 / 断网一律保持本地值，不打扰用户。
    // 口径：specs/radius-style-dual/page-spec-pref-sync.md §4.2
    void (async () => {
      try {
        await this.autoLogin();
        if (isLoggedIn()) await applyFromServer();
      } catch {
        // 保持本地值
      }
    })();
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
    apiBase: resolveApiBase(),
    bianbianOrigin: undefined,
    bianbianDesc: undefined,
    bianbianResult: undefined,
  },
});
