/**
 * 回归锁：残留旧 token 掐死登录（fix/auth-stale-token-blocks-login）
 *
 * 事故链（prod 2026-10-29 实测）：
 *   浏览器 localStorage 残留上一会话的旧 token（其 sid 已在 Redis 黑名单）
 *   → 前端请求拦截器无条件给【登录请求】也加 Authorization
 *   → gateway 的 TokenBlacklistGuard 在转发前拦成 401「令牌已失效（已登出）」（1~4ms，根本没验密码）
 *   → 用户看到「密码正确却永远登不进去」，且该 401 属"公开接口凭据错误"不触发清 token
 *   → 死循环
 *
 * 这三条用例锁死修复口径：
 *   V1 登录/注册/刷新请求**绝不**携带 Authorization（即便本地有残留 token）
 *   V2 业务请求照常携带 Bearer（防过度修复把正常鉴权打掉）
 *   V3 公开鉴权接口返回 401 时清掉残留 token（断死循环）
 */
jest.mock('ant-design-vue', () => ({
  message: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

jest.mock('@/router', () => ({
  __esModule: true,
  default: { currentRoute: { value: { fullPath: '/login' } }, push: jest.fn() },
}));

jest.mock('@/stores/user', () => ({
  useUserStore: () => ({ logout: jest.fn() }),
}));

import request from '@/api/request';

const captured: any[] = [];

function okAdapter(config: any) {
  captured.push(config);
  return {
    data: { code: 0, data: { ok: true } },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

beforeEach(() => {
  captured.length = 0;
  localStorage.clear();
  request.defaults.adapter = async (config: any) => okAdapter(config);
});

describe('公开鉴权请求不得携带 Authorization', () => {
  it('V1a 本地有残留旧 token 时，POST /auth/login 不带 Authorization', async () => {
    localStorage.setItem('user-store', JSON.stringify({ token: 'STALE_TOKEN', refreshToken: 'STALE_RT' }));

    await request.post('/auth/login', { username: 'superadmin', password: 'x' });

    expect(captured).toHaveLength(1);
    expect(captured[0].headers.Authorization).toBeUndefined();
  });

  it('V1b POST /auth/register 不带 Authorization', async () => {
    localStorage.setItem('user-store', JSON.stringify({ token: 'STALE_TOKEN' }));

    await request.post('/auth/register', { username: 'a', password: 'b' });

    expect(captured[0].headers.Authorization).toBeUndefined();
  });

  it('V1c POST /auth/refresh 不带 Authorization', async () => {
    localStorage.setItem('user-store', JSON.stringify({ token: 'STALE_TOKEN' }));

    await request.post('/auth/refresh', { refreshToken: 'R' });

    expect(captured[0].headers.Authorization).toBeUndefined();
  });

  it('V1d 带 query 的登录路径同样被识别为公开鉴权', async () => {
    localStorage.setItem('user-store', JSON.stringify({ token: 'STALE_TOKEN' }));

    await request.post('/auth/login?from=admin', {});

    expect(captured[0].headers.Authorization).toBeUndefined();
  });
});

describe('业务请求照常携带 Bearer（防过度修复）', () => {
  it('V2 GET /users 带 Bearer', async () => {
    localStorage.setItem('user-store', JSON.stringify({ token: 'NEW_TOKEN' }));

    await request.get('/users');

    expect(captured[0].headers.Authorization).toBe('Bearer NEW_TOKEN');
  });

  it('V2b 本地无 token 时不加 Authorization 头', async () => {
    await request.get('/users');

    expect(captured[0].headers.Authorization).toBeUndefined();
  });
});

describe('公开鉴权接口 401 时清理残留 token（断死循环）', () => {
  it('V3 /auth/login 401 → localStorage 中的 token 被清空', async () => {
    localStorage.setItem(
      'user-store',
      JSON.stringify({ token: 'STALE_TOKEN', refreshToken: 'STALE_RT', userInfo: { username: 'x' } }),
    );
    request.defaults.adapter = async (config: any) => {
      const err: any = new Error('Request failed with status code 401');
      err.config = config;
      err.response = { status: 401, data: { message: '用户名或密码错误' }, headers: {}, config };
      throw err;
    };

    await expect(request.post('/auth/login', { username: 'u', password: 'p' })).rejects.toBeTruthy();

    const stored = JSON.parse(localStorage.getItem('user-store') || '{}');
    expect(stored.token).toBeFalsy();
    expect(stored.refreshToken).toBeFalsy();
  });
});
