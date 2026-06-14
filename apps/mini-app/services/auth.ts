/**
 * 小程序登录服务
 *
 * 流程：
 *   1. wx.login() 获取 code
 *   2. 将 code 发送到后端 /api/auth/miniprogram-login
 *   3. 后端调用微信 jscode2session 获取 openid
 *   4. 后端查找/创建用户，生成 JWT Token 返回
 *   5. 小程序存储 Token，标记登录成功
 */

import { getToken, setToken, clearToken } from '../utils/request';

const AUTH_API = '/api/auth/miniprogram-login';

/** 检查是否已登录 */
export function isLoggedIn(): boolean {
  return !!getToken();
}

/**
 * 小程序登录
 */
export async function login(): Promise<void> {
  try {
    const { code } = await wx.login();
    if (!code) {
      throw new Error('wx.login 获取 code 失败');
    }

    const res = await wx.request({
      url: `${getApp<IAppOption>().globalData.apiBase || ''}${AUTH_API}`,
      method: 'POST',
      data: { code },
      timeout: 10000,
    });

    if (res.statusCode === 200 && res.data) {
      const data = res.data as { accessToken: string; refreshToken: string; user: { id: number; nickname: string; avatarUrl: string } };
      setToken(data.accessToken, data.refreshToken);
      const app = getApp<IAppOption>();
      app.globalData.userInfo = data.user;
    } else {
      throw new Error('登录接口返回异常');
    }
  } catch (err) {
    console.error('[auth] 登录失败:', err);
    throw err;
  }
}

/**
 * 确保已登录（用于需要登录态的页面）
 */
export async function ensureLogin(): Promise<boolean> {
  if (isLoggedIn()) return true;
  try {
    await login();
    return true;
  } catch {
    return false;
  }
}
