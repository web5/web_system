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

/**
 * 读取当前 token（单一判定口径）。
 *
 * 为什么不能直接只读 `token`：portal / admin 模块的登录由模块自己完成，
 * 它只写自己的 pinia persist key（`user-store`），不会写基座的 `token`。
 * 于是「通过模块登录后刷新页面」时，基座若只看 `token` 会误判为未登录，
 * 把人踢回登录页（2026-10-10 排查：未登录会被基座守卫无条件拦到老登录页，
 * 修为交给模块登录后必须同步判定口径，否则就变成登录死循环）。
 *
 * 优先级：`user-store` **存在**即以它为准（哪怕 token 为空串 —— 表示模块侧已登出），
 * 完全没有 `user-store` 记录时才回落到历史 `token`（迁移前的老会话）。
 */
function readUserStore(): Record<string, any> | null {
  const raw = localStorage.getItem('user-store');
  if (raw === null) return null;
  try {
    return JSON.parse(raw) || null;
  } catch {
    return null; // 脏 JSON 不该让整个登录判定崩掉
  }
}

export function readToken(): string | null {
  const stored = readUserStore();
  if (stored) return stored.token || null;
  return localStorage.getItem('token');
}

export function readRefreshToken(): string | null {
  const stored = readUserStore();
  if (stored) return stored.refreshToken || null;
  return localStorage.getItem('refreshToken');
}
