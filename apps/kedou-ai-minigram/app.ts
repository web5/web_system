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

  /**
   * 极简事件总线：跨页面广播（页面栈内任意页可收）。
   * 当前承载 `auth:expired`：request 层 401 清 token 后广播，各页收信 setData
   * loggedIn=false 弹出登录墙（login-gate）——替代旧方案 reLaunch 回首页
   * （会清空整个页面栈，导致用户「被弹回首页」且右滑返回永远回首页）。
   */
  eventBus: {
    _handlers: {} as Record<string, Array<(payload?: any) => void>>,
    on(event: string, handler: (payload?: any) => void) {
      const list = this._handlers[event] || (this._handlers[event] = []);
      list.push(handler);
    },
    off(event: string, handler: (payload?: any) => void) {
      const list = this._handlers[event];
      if (!list) return;
      this._handlers[event] = list.filter((h) => h !== handler);
    },
    emit(event: string, payload?: any) {
      const list = this._handlers[event];
      if (!list) return;
      list.slice().forEach((h) => h(payload));
    },
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
