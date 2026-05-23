/**
 * 小程序登录服务
 *
 * TODO: 当前写死为已登录状态，等后台部署好之后恢复真实登录流程。
 *       真实流程：
 *         1. wx.login() 获取 code
 *         2. 将 code 发送到后端 /api/auth/miniprogram-login
 *         3. 后端调用微信 jscode2session 获取 openid
 *         4. 后端查找/创建用户，生成 JWT Token 返回
 *         5. 小程序存储 Token，标记登录成功
 */

import { setToken } from '../utils/request';

/** 检查是否已登录 — 暂时写死为 true */
export function isLoggedIn(): boolean {
  return true;
}

/** mock token，后续删除 */
const MOCK_TOKEN = 'mock_token_placeholder';

/**
 * 小程序登录
 * 暂时写死，直接模拟登录成功
 */
export async function login(): Promise<void> {
  console.log('[Auth] 模拟登录（后台未部署，写死为已登录）');

  // mock 数据
  setToken(MOCK_TOKEN, MOCK_TOKEN);
  const app = getApp<IAppOption>();
  app.globalData.userInfo = {
    id: 1,
    nickname: '测试用户',
    avatarUrl: '',
  };

  console.log('[Auth] 模拟登录成功');
}

/**
 * 确保已登录（用于需要登录态的页面）
 * 暂时写死为 true
 */
export async function ensureLogin(): Promise<boolean> {
  return true;
}
