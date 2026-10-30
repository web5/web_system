/**
 * 回归锁：公开鉴权路径必须跳过 token 黑名单校验（fix/auth-stale-token-blocks-login）
 *
 * 事故链：浏览器残留上一个会话的旧 token（sid 已进黑名单）→ 前端把 Authorization
 * 也加到了 POST /api/auth/login 上 → 本 Guard 在转发前拦成 401「令牌已失效（已登出）」，
 * 请求根本到不了 auth-service，表现为「密码正确却永远登不进去」。
 *
 * 口径：登录/注册/刷新等「签发 token 的接口」不消费 token，必须放行；
 * 业务接口的黑名单校验语义不变（登出仍然生效）。
 */
import { UnauthorizedException } from '@nestjs/common';
import { TokenBlacklistGuard } from './token-blacklist.guard';

function makeContext(path: string, token?: string): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        path,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    }),
  };
}

function makeGuard(): { guard: TokenBlacklistGuard; fetchMock: jest.Mock } {
  const configService = {
    get: (key: string) => (key === 'INTERNAL_API_KEY' ? 'internal-key' : 'http://auth:6001'),
  } as any;
  const fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  return { guard: new TokenBlacklistGuard(configService), fetchMock };
}

describe('公开鉴权路径放行', () => {
  const paths = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/auth/wechat-login',
    '/api/auth/miniprogram-login',
  ];

  it.each(paths)('V1 %s 即便带着已拉黑的 token 也放行，且不查黑名单', async (path) => {
    const { guard, fetchMock } = makeGuard();

    await expect(guard.canActivate(makeContext(path, 'BLACKLISTED_TOKEN'))).resolves.toBe(true);
    // 关键：根本没回源 auth-service —— 证明拦截不是"查完发现有效"，而是压根没查
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('V1b 带 query 的登录路径同样放行', async () => {
    const { guard, fetchMock } = makeGuard();

    await expect(guard.canActivate(makeContext('/api/auth/login?from=admin', 'BLACKLISTED'))).resolves.toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('V1c 无 token 的登录请求自然放行', async () => {
    const { guard, fetchMock } = makeGuard();

    await expect(guard.canActivate(makeContext('/api/auth/login'))).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('业务接口黑名单语义不变（防过度放行）', () => {
  it('V2 业务路径 + 已拉黑 token → 401「令牌已失效（已登出）」', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ valid: false }) });

    await expect(guard.canActivate(makeContext('/api/users/me', 'BLACKLISTED'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('V2b 业务路径 + 有效 token → 放行', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ valid: true }) });

    await expect(guard.canActivate(makeContext('/api/users/me', 'GOOD_TOKEN'))).resolves.toBe(true);
  });

  it('V2c 路径相似但非白名单（/api/auth/logout）仍走黑名单校验', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ valid: false }) });

    await expect(guard.canActivate(makeContext('/api/auth/logout', 'BLACKLISTED'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('V2d auth-service 不可用 → 按放行处理（既有降级策略，不许回退成 503）', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(guard.canActivate(makeContext('/api/users/me', 'ANY'))).resolves.toBe(true);
  });
});
