import { Fetcher } from './wecom-api.client';
import { WecomConfigService } from './wecom.config';
import { WecomIdentityClient } from './wecom-identity.client';

const enabled = {
  WECOM_APPROVE_ENABLED: '1',
  CONSOLE_PUBLIC_BASE_URL: 'https://dev.kedouai.com/console',
  WECOM_CORP_ID: 'corp-id',
  WECOM_AGENT_ID: '1000002',
  WECOM_SECRET: 'secret',
  JWT_SECRET: 'jwt',
  USER_SERVICE_URL: 'http://user-service:6002',
  INTERNAL_API_KEY: 'internal-key',
};

/** 记录请求头与 body，便于断言「带 x-internal-key、channel=wecom」 */
function responder(handler: () => { ok?: boolean; status?: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    const r = handler();
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  }) as unknown as Fetcher;
  return { fetcher, calls };
}

function client(env: Record<string, string>, fetcher: Fetcher): WecomIdentityClient {
  return new WecomIdentityClient(WecomConfigService.forTest(env), fetcher);
}

describe('WecomIdentityClient（卡② W-a / V14 fail-closed）', () => {
  it('正常解析返回身份，且请求带 internal key 与 channel=wecom', async () => {
    const identity = {
      userId: 'u1', username: 'bob', roles: ['admin'], systems: ['deploy'],
    };
    const { fetcher, calls } = responder(() => ({ body: { code: 0, data: identity } }));
    const result = await client(enabled, fetcher).resolve('wenzhui');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.username).toBe('bob');
    expect(calls[0].url).toBe('http://user-service:6002/internal/identities/resolve');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-internal-key']).toBe('internal-key');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ channel: 'wecom', externalId: 'wenzhui' });
  });

  it('user-service 不可达（fetch reject）→ unavailable，绝不返回身份', async () => {
    const fetcher = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as Fetcher;
    const result = await client(enabled, fetcher).resolve('wenzhui');
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('user-service 返回 503 → unavailable', async () => {
    const { fetcher } = responder(() => ({ ok: false, status: 503, body: {} }));
    expect(await client(enabled, fetcher).resolve('wenzhui')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('data:null（未绑定 / 停用）→ not_found，不是 404/500', async () => {
    const { fetcher } = responder(() => ({ body: { code: 0, data: null } }));
    expect(await client(enabled, fetcher).resolve('stranger')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('响应结构异常 → bad_response（不把畸形数据当身份）', async () => {
    const { fetcher } = responder(() => ({ body: { code: 0, data: { foo: 'bar' } } }));
    expect(await client(enabled, fetcher).resolve('wenzhui')).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('未配 INTERNAL_API_KEY → unavailable 且不发请求', async () => {
    const { fetcher, calls } = responder(() => ({ body: { code: 0, data: null } }));
    const result = await client({ ...enabled, INTERNAL_API_KEY: '' }, fetcher).resolve('wenzhui');
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
    expect(calls).toHaveLength(0);
  });

  it('通道关闭 → disabled，零跨服务调用', async () => {
    const { fetcher, calls } = responder(() => ({ body: { code: 0, data: null } }));
    const result = await client({ WECOM_APPROVE_ENABLED: '0' }, fetcher).resolve('wenzhui');
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(calls).toHaveLength(0);
  });

  it('空 externalId → not_found，不发出请求', async () => {
    const { fetcher, calls } = responder(() => ({ body: { code: 0, data: null } }));
    expect(await client(enabled, fetcher).resolve('  ')).toEqual({ ok: false, reason: 'not_found' });
    expect(calls).toHaveLength(0);
  });

  it('已合并账号的 mergedFrom 原样透传', async () => {
    const { fetcher } = responder(() => ({
      body: {
        code: 0,
        data: {
          userId: 'u2', username: 'bob', roles: [], systems: ['deploy'],
          mergedFrom: { userId: 'u1', username: 'bob-old' },
        },
      },
    }));
    const result = await client(enabled, fetcher).resolve('wenzhui');
    expect(result.ok && result.identity.mergedFrom).toEqual({ userId: 'u1', username: 'bob-old' });
  });
});
