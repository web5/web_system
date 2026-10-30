/**
 * refresh cookie 承载（方案 2 · S1）
 *
 * 锁死的口径：
 *   V1 端判定：x-client 显式优先 → Referer 路径 → 默认 portal（admin 与 portal 同域，
 *      共用 cookie 名会互相顶掉会话，因此必须能稳定区分来源端）
 *   V2 读取：只认对应端的 cookie 名，别的端 / 别的 key 一律不认
 *   V3 下发：必须 httpOnly + SameSite=Lax + path=/（缺一个都会让 XSS 或跨路径问题回来）
 *   V4 清除：登出清两端（同一设备同一人，登出即全清）
 */
import type { Request, Response } from 'express';
import {
  resolveAuthClient,
  readRefreshCookie,
  setRefreshCookie,
  clearRefreshCookie,
  isSecureCookieEnv,
  REFRESH_COOKIE_NAMES,
} from './refresh-cookie';

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): { res: Response; cookie: jest.Mock; clearCookie: jest.Mock } {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return { res: { cookie, clearCookie } as unknown as Response, cookie, clearCookie };
}

describe('V1 端判定 resolveAuthClient', () => {
  it('x-client=admin → admin', () => {
    expect(resolveAuthClient(makeReq({ 'x-client': 'admin' }))).toBe('admin');
  });

  it('x-client=PORTAL（大小写不敏感）→ portal', () => {
    expect(resolveAuthClient(makeReq({ 'x-client': 'PORTAL' }))).toBe('portal');
  });

  it('无 x-client 时按 Referer 路径判定：/admin/users → admin', () => {
    expect(resolveAuthClient(makeReq({ referer: 'https://kedouai.com/admin/users?page=1' }))).toBe('admin');
  });

  it('Referer=/admin 精确匹配 → admin', () => {
    expect(resolveAuthClient(makeReq({ referer: 'https://kedouai.com/admin' }))).toBe('admin');
  });

  it('Referer=/portal → portal', () => {
    expect(resolveAuthClient(makeReq({ referer: 'https://kedouai.com/portal/chat' }))).toBe('portal');
  });

  it('既无 x-client 也无 Referer → 默认 portal', () => {
    expect(resolveAuthClient(makeReq())).toBe('portal');
  });

  it('Referer 非法（隐私模式抹掉）→ 默认 portal，不抛错', () => {
    expect(resolveAuthClient(makeReq({ referer: 'not-a-url' }))).toBe('portal');
  });

  it('路径里出现 admin 但不在首段（/portal/admin-ish）→ 不算 admin', () => {
    expect(resolveAuthClient(makeReq({ referer: 'https://kedouai.com/portal/admin-ish' }))).toBe('portal');
  });
});

describe('V2 读取 readRefreshCookie', () => {
  it('admin 端读到 ws_rt_admin', () => {
    const req = makeReq({ cookie: `ws_rt_admin=ADMIN_RT; ws_rt_portal=PORTAL_RT` });
    expect(readRefreshCookie(req, 'admin')).toBe('ADMIN_RT');
  });

  it('portal 端读到 ws_rt_portal（不会串端）', () => {
    const req = makeReq({ cookie: `ws_rt_admin=ADMIN_RT; ws_rt_portal=PORTAL_RT` });
    expect(readRefreshCookie(req, 'portal')).toBe('PORTAL_RT');
  });

  it('只有另一端的 cookie → null（不跨端兜底）', () => {
    const req = makeReq({ cookie: 'ws_rt_portal=PORTAL_RT' });
    expect(readRefreshCookie(req, 'admin')).toBeNull();
  });

  it('无 cookie 头 → null', () => {
    expect(readRefreshCookie(makeReq(), 'admin')).toBeNull();
  });

  it('URL 编码值会被解码', () => {
    const req = makeReq({ cookie: 'ws_rt_admin=a%2Bb%3Dc' });
    expect(readRefreshCookie(req, 'admin')).toBe('a+b=c');
  });

  it('脏 cookie（无 =）不崩', () => {
    const req = makeReq({ cookie: 'garbage; ws_rt_admin=OK' });
    expect(readRefreshCookie(req, 'admin')).toBe('OK');
  });
});

describe('V3 下发 setRefreshCookie', () => {
  it('写入对应端 cookie 名 + httpOnly + SameSite=Lax + path=/', () => {
    const { res, cookie } = makeRes();

    setRefreshCookie(res, 'admin', 'RT_VALUE', true);

    expect(cookie).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookie.mock.calls[0];
    expect(name).toBe(REFRESH_COOKIE_NAMES.admin);
    expect(value).toBe('RT_VALUE');
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it('非 https 环境不加 Secure（否则浏览器直接丢弃 cookie）', () => {
    const { res, cookie } = makeRes();

    setRefreshCookie(res, 'portal', 'RT', false);

    expect(cookie.mock.calls[0][2].secure).toBe(false);
  });

  it('空 refreshToken 不下发（避免写入空 cookie 污染后续读取）', () => {
    const { res, cookie } = makeRes();

    setRefreshCookie(res, 'admin', '', true);

    expect(cookie).not.toHaveBeenCalled();
  });
});

describe('V4 清除 clearRefreshCookie', () => {
  it('登出清两端 cookie（同设备同一人，登出即全清）', () => {
    const { res, clearCookie } = makeRes();

    clearRefreshCookie(res, true);

    expect(clearCookie).toHaveBeenCalledTimes(2);
    const names = clearCookie.mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining([REFRESH_COOKIE_NAMES.admin, REFRESH_COOKIE_NAMES.portal]));
    // 清除时必须带同样的 path，否则浏览器认为清的是另一个 cookie
    expect(clearCookie.mock.calls[0][1]).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax' });
  });
});

describe('V5 Secure 判定', () => {
  it('production → 加 Secure', () => {
    expect(isSecureCookieEnv('production')).toBe(true);
  });

  it('development / undefined → 不加', () => {
    expect(isSecureCookieEnv('development')).toBe(false);
    expect(isSecureCookieEnv(undefined)).toBe(false);
  });
});
