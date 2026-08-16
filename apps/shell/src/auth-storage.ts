/**
 * 统一登录态存储。基座负责登录/续期/登出，模块（portal/admin）从同一存储读 token。
 *
 * 存储约定：
 * - `token` / `refreshToken` / `user`：基座守卫、axios 拦截器用（历史约定）
 * - `user-store`：portal/admin 模块的 pinia persist key（state 为 { token, refreshToken, userInfo }）
 *
 * 基座登录成功后必须同时写两处，否则模块 user store 恢复不出 token，
 * 会导致模块内部路由守卫再次跳登录（双重登录问题）。
 */

export function saveAuth(token: string, refreshToken: string, userInfo: unknown) {
  localStorage.setItem('token', token);
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
  localStorage.setItem('user', JSON.stringify(userInfo || {}));
  // 模块（portal/admin）的 pinia persist key
  localStorage.setItem('user-store', JSON.stringify({ token, refreshToken: refreshToken || '', userInfo: userInfo || null }));
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('user-store');
}
