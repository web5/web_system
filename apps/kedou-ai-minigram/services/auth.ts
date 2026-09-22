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

import { getToken, setToken, clearToken, setLoginEnsurer } from '../utils/request';

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
    // wx.login 显式 Promise 封装（不依赖基础库 Promise 风格）
    const loginRes = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>(
      (resolve, reject) => {
        wx.login({
          success: (r) => resolve(r),
          fail: (err) => reject(err),
        });
      },
    );
    const { code } = loginRes;
    if (!code) {
      throw new Error('wx.login 获取 code 失败');
    }

    // wx.request 不返回 Promise（原生返回 RequestTask），需手动 Promise 封装
    const res = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
      (resolve, reject) => {
        wx.request({
          url: `${getApp<IAppOption>().globalData.apiBase || ''}${AUTH_API}`,
          method: 'POST',
          data: { code },
          timeout: 10000,
          header: {
            // 强制不压缩（gateway 启用 compression，开发者工具对 gzip 响应解析失败）
            'Accept-Encoding': 'identity',
          },
          success: (r) => resolve(r),
          fail: (err) => reject(err),
        });
      },
    );

    if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
      const data = res.data as { accessToken: string; refreshToken: string; user: { id: number; nickname: string; avatarUrl: string } };
      setToken(data.accessToken, data.refreshToken);
      const app = getApp<IAppOption>();
      app.globalData.userInfo = data.user;
    } else {
      throw new Error(`登录接口返回异常: ${res.statusCode} ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    console.error('[auth] 登录失败:', err);
    throw err;
  }
}

/**
 * 确保已登录（用于需要登录态的页面）。
 *
 * 单例化：并发调用（如 App.onLaunch 的 autoLogin 与首屏页面请求同时触发）只会发一次登录，
 * 避免重复 wx.login 换 code 造成浪费；成功/失败后重置，允许下次重试。
 */
let loginPromise: Promise<boolean> | null = null;

export function ensureLogin(): Promise<boolean> {
  if (isLoggedIn()) return Promise.resolve(true);
  if (!loginPromise) {
    loginPromise = login()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        loginPromise = null;
      });
  }
  return loginPromise;
}

// 注入到 request 层：request.ts 不直接 import 本文件（会形成 request↔auth 循环依赖），
// 而是通过此钩子让「无 token 的请求」在发出前先走 ensureLogin。
setLoginEnsurer(ensureLogin);
