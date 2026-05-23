import { login } from './services/auth';

App<IAppOption>({
  onLaunch() {
    console.log('[App] Mini app launched');
    this.autoLogin();
  },

  /** 启动时自动登录 — 暂时写死为已登录 */
  async autoLogin() {
    try {
      await login();
      console.log('[App] 自动登录成功（模拟）');
    } catch (err) {
      console.warn('[App] 自动登录失败', err);
    }
  },

  globalData: {
    userInfo: null,
    token: '',
    refreshToken: '',
    apiBase: 'https://api.kedouai.com',
  },
});
