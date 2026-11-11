import { PublicBaseUrlService } from './public-base-url.service';
import type { ConfigService } from '@nestjs/config';

/**
 * 公网根地址读取客户端单测 —— 钉住三类行为：
 *  1. 成功返回 data → 规范化并缓存（缓存期内不再打网络）；
 *  2. 失败（非 2xx / 抛错）→ 回落 env 兜底；
 *  3. 空值 / 无兜底 → 返回空串（保持相对路径），绝不抛错。
 */

function fakeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    SYSTEM_SERVICE_URL: 'http://127.0.0.1:6004',
    INTERNAL_API_KEY: 'test-key',
    PUBLIC_BASE_URL: 'https://fallback.kedouai.com',
    PUBLIC_BASE_URL_CACHE_MS: '60000',
    ...overrides,
  };
  return { get: (key: string, def?: string) => values[key] ?? def } as unknown as ConfigService;
}

function okResponse(data: string): Response {
  return { ok: true, status: 200, json: async () => ({ code: 0, data }) } as unknown as Response;
}

function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe('PublicBaseUrlService.resolve', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('成功返回 data → 规范化并缓存（缓存期内只请求一次）', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse('https://dev.kedouai.com/'));
    const svc = new PublicBaseUrlService(fakeConfig());

    const first = await svc.resolve();
    const second = await svc.resolve();

    expect(first).toBe('https://dev.kedouai.com');
    expect(second).toBe('https://dev.kedouai.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // 请求头带 x-internal-key，端点固定为白名单键
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://127.0.0.1:6004/internal/settings/public-base-url',
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('test-key');
  });

  it('system-service 返回非 2xx → 回落 env 兜底', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(errResponse(500));
    const svc = new PublicBaseUrlService(fakeConfig());

    await expect(svc.resolve()).resolves.toBe('https://fallback.kedouai.com');
  });

  it('fetch 抛错 → 回落 env 兜底', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const svc = new PublicBaseUrlService(fakeConfig());

    await expect(svc.resolve()).resolves.toBe('https://fallback.kedouai.com');
  });

  it('返回空 data 且无 env 兜底 → 空串（保持相对路径，不抛错）', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse(''));
    const svc = new PublicBaseUrlService(fakeConfig({ PUBLIC_BASE_URL: '' }));

    await expect(svc.resolve()).resolves.toBe('');
  });

  it('env 兜底值经规范化（去掉结尾斜杠）', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    const svc = new PublicBaseUrlService(
      fakeConfig({ PUBLIC_BASE_URL: 'https://fallback.kedouai.com/' }),
    );

    await expect(svc.resolve()).resolves.toBe('https://fallback.kedouai.com');
  });
});
