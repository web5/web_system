import { extractBearerToken, resolveAuthServiceUrl, verifyRemoteToken } from './unified-auth';

/**
 * 统一认证助手的单测（C1）。
 *
 * 锁定的方向：
 *   - **空串视为未配置**（2026-09-11 dev 事故：`fetch('')` 被误报成「认证服务不可用」）
 *   - 失败分类正确：missing / invalid / unavailable —— 服务据此抛对应的 401 文案
 *   - 成功时返回 auth-service 的 `data`（= 用户信息）
 */
describe('extractBearerToken', () => {
  it('正常 Bearer 头取到 token', () => {
    expect(extractBearerToken({ authorization: 'Bearer abc.def.ghi' })).toBe('abc.def.ghi');
  });

  it('非 Bearer / 无头 / 空 token 一律视为缺失', () => {
    expect(extractBearerToken({ authorization: 'Basic abc' })).toBeUndefined();
    expect(extractBearerToken({})).toBeUndefined();
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken({ authorization: 'Bearer ' })).toBeUndefined();
  });
});

describe('resolveAuthServiceUrl', () => {
  const get = (v?: string) => (key: string) => (key === 'AUTH_SERVICE_URL' ? v : undefined);

  it('配了就用配置值（去尾斜杠）', () => {
    expect(resolveAuthServiceUrl({ get: get('http://127.0.0.1:6001/') }, 'http://localhost:6101')).toBe(
      'http://127.0.0.1:6001',
    );
  });

  it('空串/空白视为未配置 → 回落到默认值（事故防回归）', () => {
    expect(resolveAuthServiceUrl({ get: get('') }, 'http://localhost:6101')).toBe('http://localhost:6101');
    expect(resolveAuthServiceUrl({ get: get('   ') }, 'http://localhost:6101')).toBe('http://localhost:6101');
  });

  it('未定义也回落默认值', () => {
    expect(resolveAuthServiceUrl({ get: get(undefined) }, 'http://localhost:6101')).toBe('http://localhost:6101');
  });
});

describe('verifyRemoteToken（远程校验）', () => {
  const fallback = 'http://localhost:6101';

  it('无 token → missing', async () => {
    const res = await verifyRemoteToken({}, { get: () => fallback }, fallback);
    expect(res).toEqual({ ok: false, reason: 'missing' });
  });

  it('auth-service 拒绝（非 2xx）→ invalid', async () => {
    const res = await verifyRemoteToken(
      { authorization: 'Bearer t' },
      { get: () => fallback, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) },
      fallback,
    );
    expect(res).toEqual({ ok: false, reason: 'invalid' });
  });

  it('返回体缺 data → invalid', async () => {
    const res = await verifyRemoteToken(
      { authorization: 'Bearer t' },
      { get: () => fallback, fetchImpl: async () => ({ ok: true, json: async () => ({ code: 0 }) }) },
      fallback,
    );
    expect(res).toEqual({ ok: false, reason: 'invalid' });
  });

  it('fetch 抛异常（连不上/超时）→ unavailable（不是 invalid）', async () => {
    const res = await verifyRemoteToken(
      { authorization: 'Bearer t' },
      {
        get: () => fallback,
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
      fallback,
    );
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('成功 → 返回 auth-service 的 data', async () => {
    let called = '';
    const res = await verifyRemoteToken(
      { authorization: 'Bearer t' },
      {
        get: () => 'http://127.0.0.1:6001',
        fetchImpl: async (url) => {
          called = url;
          return { ok: true, json: async () => ({ code: 0, data: { id: '1', username: 'admin' } }) };
        },
      },
      fallback,
    );
    expect(called).toBe('http://127.0.0.1:6001/auth/verify');
    expect(res).toEqual({ ok: true, user: { id: '1', username: 'admin' } });
  });
});
