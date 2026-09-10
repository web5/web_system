import { login, isLoggedIn } from './services/auth';

App<IAppOption>({
  onLaunch() {
    // 把 apiBase 同步落到 storage，供后续请求绕过 wx.getApp 直接读，
    // 避免某些异步栈里 wx.getApp 调用抛错或栈溢出
    try {
      wx.setStorageSync('api_base', this.globalData.apiBase);
    } catch {}
    this.autoLogin();
  },

  /** 启动时自动登录（已有 token 则跳过，避免覆盖本地测试 token） */
  async autoLogin() {
    if (isLoggedIn()) {
      return;
    }
    try {
      await login();
    } catch (err) {
      // 登录失败静默处理，用户可重试
    }
  },

  globalData: {
    userInfo: null,
    token: '',
    refreshToken: '',
    apiBase: 'http://local.kedouai.com',
    bianbianOrigin: undefined,
    bianbianDesc: undefined,
    bianbianResult: undefined,
  },
});
