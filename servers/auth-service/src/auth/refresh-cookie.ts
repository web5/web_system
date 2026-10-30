import type { Request, Response } from 'express';

/**
 * refresh token 的 httpOnly cookie 承载（方案 2 · S1）
 *
 * 目标：把长期凭据从 `localStorage`（XSS 可直读）搬到 httpOnly cookie —— 浏览器脚本
 * 拿不到它。access token 仍走 `Authorization` 头、只存内存，保持短命。
 *
 * 分端命名：admin 与 portal 同域（kedouai.com）不同路径，若共用一个 cookie 名，
 * 在 admin 登录会把 portal 的会话顶掉。因此按端区分 cookie 名。
 *
 * 向后兼容：请求 body 里的 `refreshToken` 仍然优先，本模块只负责「下发」与「兜底读取」，
 * 老客户端（还没升级的前端 / 小程序）行为不变。
 */

export type AuthClient = 'admin' | 'portal';

const COOKIE_NAMES: Record<AuthClient, string> = {
  admin: 'ws_rt_admin',
  portal: 'ws_rt_portal',
};

/** 与 refresh token 的 30d 有效期对齐 */
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * 判定请求来自哪个端。
 *
 * 优先级：`x-client` 显式声明 → Referer 路径 → 默认 portal。
 * 为什么不猜 User-Agent：admin 与 portal 都是浏览器，UA 无法区分。
 */
export function resolveAuthClient(req: Request): AuthClient {
  const explicit = String(req.headers['x-client'] || '').toLowerCase();
  if (explicit === 'admin' || explicit === 'portal') return explicit;

  const referer = String(req.headers.referer || '');
  if (referer) {
    try {
      const path = new URL(referer).pathname;
      if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
    } catch {
      // referer 非法（部分隐私模式会抹掉）→ 落到默认分支
    }
  }
  return 'portal';
}

/** 手写 cookie 解析：只为本模块取一个 key，不值得引入 cookie-parser 依赖 */
function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** 读该端的 refresh cookie（没有则 null） */
export function readRefreshCookie(req: Request, client: AuthClient): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAMES[client]] || null;
}

/** 下发/轮换 refresh cookie */
export function setRefreshCookie(
  res: Response,
  client: AuthClient,
  refreshToken: string,
  secure: boolean,
): void {
  if (!refreshToken) return;
  res.cookie(COOKIE_NAMES[client], refreshToken, {
    ...BASE_COOKIE_OPTIONS,
    secure,
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

/**
 * 清掉两端的 refresh cookie。
 *
 * 登出时清两端而不是只清当前端：用户可能从 admin 登出，但希望同一浏览器的 portal
 * 会话也被终止（同一个人、同一台设备）。分端 cookie 名只解决"同时登两个不同账号"，
 * 不改变"登出即全清"的语义。
 */
export function clearRefreshCookie(res: Response, secure: boolean): void {
  for (const name of Object.values(COOKIE_NAMES)) {
    res.clearCookie(name, { ...BASE_COOKIE_OPTIONS, secure });
  }
}

/** cookie 是否加 Secure（生产走 https；本地 dev 走 http 时不能加，否则浏览器直接丢弃） */
export function isSecureCookieEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production';
}

/** 对外暴露 cookie 名，供测试与排障使用 */
export const REFRESH_COOKIE_NAMES = COOKIE_NAMES;
