import { login } from './services/auth';

App<IAppOption>({
  onLaunch() {
    this.autoLogin();
  },

  /** 启动时自动登录 — 暂时写死为已登录 */
  async autoLogin() {
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
    apiBase: 'https://kedouai.com/api',
  },
});
