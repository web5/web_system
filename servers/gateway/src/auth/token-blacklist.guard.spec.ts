import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { API_TIMEOUT } from '@web-system/shared';
import { TokenBlacklistGuard } from './token-blacklist.guard';

const UNAVAILABLE_MESSAGE = '认证状态暂不可用，请稍后重试';
const originalFetch = global.fetch;

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

function response(data: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function makeGuard(realTimeout = false): {
  guard: TokenBlacklistGuard;
  fetchMock: jest.Mock;
  timeoutSpy: jest.SpyInstance;
} {
  const configService = {
    get: (key: string) => (key === 'INTERNAL_API_KEY' ? 'test-internal-key' : 'http://auth.test.invalid:6001'),
  } as any;
  const fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
  if (!realTimeout) {
    timeoutSpy.mockImplementation(() => new AbortController().signal);
  }
  return { guard: new TokenBlacklistGuard(configService), fetchMock, timeoutSpy };
}

async function expectUnavailable(promise: Promise<boolean>): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(ServiceUnavailableException);
  expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
    message: UNAVAILABLE_MESSAGE,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  (global as any).fetch = originalFetch;
});

describe('回源前的既有放行分支', () => {
  const paths = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/auth/wechat-login',
    '/api/auth/miniprogram-login',
  ];

  it.each(paths)('%s 即便带 token 也放行，且不查黑名单', async (path) => {
    const { guard, fetchMock } = makeGuard();

    await expect(guard.canActivate(makeContext(path, 'TEST_TOKEN'))).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('带 query 的登录路径同样放行', async () => {
    const { guard, fetchMock } = makeGuard();

    await expect(guard.canActivate(makeContext('/api/auth/login?from=test', 'TEST_TOKEN'))).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('无 token 的业务请求仍交由微服务处理，不查黑名单', async () => {
    const { guard, fetchMock } = makeGuard();

    await expect(guard.canActivate(makeContext('/api/users/me'))).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('V6：严格 token-status 映射', () => {
  it('200 valid:true 放行', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue(response({ valid: true }));

    await expect(guard.canActivate(makeContext('/api/users/me', 'GOOD_TOKEN'))).resolves.toBe(true);
  });

  it('200 valid:false 返回 401', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue(response({ valid: false }));

    await expect(guard.canActivate(makeContext('/api/users/me', 'BLACKLISTED'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([201, 401, 500, 503])('HTTP %s 即使响应体看似 valid:true 也返回 503', async (status) => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue(response({ valid: true }, status));

    await expectUnavailable(guard.canActivate(makeContext('/api/users/me', 'TEST_TOKEN')));
  });

  it.each([{}, { valid: 'true' }, { valid: null }, []])('200 但响应缺 valid 或类型非法：%p → 503', async (data) => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue(response(data));

    await expectUnavailable(guard.canActivate(makeContext('/api/users/me', 'TEST_TOKEN')));
  });

  it('JSON 畸形返回 503，不得放行', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('test malformed json');
      },
    });

    await expectUnavailable(guard.canActivate(makeContext('/api/users/me', 'TEST_TOKEN')));
  });

  it.each([
    new Error('test network unavailable'),
    new DOMException('test timeout', 'TimeoutError'),
  ])('网络错误/超时返回统一 503：%s', async (failure) => {
    const { guard, fetchMock } = makeGuard();
    fetchMock.mockRejectedValue(failure);

    await expectUnavailable(guard.canActivate(makeContext('/api/users/me', 'TEST_TOKEN')));
  });

  it('内部 fetch 复用 shared 的 3000ms AbortSignal.timeout', async () => {
    const { guard, fetchMock, timeoutSpy } = makeGuard();
    fetchMock.mockResolvedValue(response({ valid: true }));

    await guard.canActivate(makeContext('/api/users/me', 'TEST_TOKEN'));

    expect(timeoutSpy).toHaveBeenCalledWith(API_TIMEOUT.UPSTREAM.INTERNAL);
    expect(API_TIMEOUT.UPSTREAM.INTERNAL).toBe(3000);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('真实 AbortSignal 在 3000ms 中止 pending fetch，并返回 503', async () => {
    const { guard, fetchMock, timeoutSpy } = makeGuard(true);
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });

    await expectUnavailable(guard.canActivate(makeContext('/api/users/me', 'TIMEOUT_TOKEN')));

    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  }, 7000);
});

describe('V6：缓存只保存明确结论', () => {
  it('故障不写 valid 缓存：恢复后必须再次回源并放行', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock
      .mockRejectedValueOnce(new Error('test network unavailable'))
      .mockResolvedValueOnce(response({ valid: true }));

    await expectUnavailable(guard.canActivate(makeContext('/api/users/me', 'RECOVERY_TOKEN')));
    await expect(guard.canActivate(makeContext('/api/users/me', 'RECOVERY_TOKEN'))).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('故障不写 invalid 缓存：恢复后必须再次回源并返回 401', async () => {
    const { guard, fetchMock } = makeGuard();
    fetchMock
      .mockRejectedValueOnce(new Error('test network unavailable'))
      .mockResolvedValueOnce(response({ valid: false }));

    await expectUnavailable(guard.canActivate(makeContext('/api/users/me', 'RECOVERY_TOKEN')));
    await expect(guard.canActivate(makeContext('/api/users/me', 'RECOVERY_TOKEN'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('有效结果保持 5s 缓存，过期后再回源', async () => {
    const { guard, fetchMock } = makeGuard();
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock.mockResolvedValue(response({ valid: true }));
    const context = makeContext('/api/users/me', 'CACHE_TOKEN');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    now += 4_999;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 1;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('无效结果保持 300s 缓存，过期后再回源', async () => {
    const { guard, fetchMock } = makeGuard();
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock.mockResolvedValue(response({ valid: false }));
    const context = makeContext('/api/users/me', 'CACHE_TOKEN');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    now += 299_999;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 1;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
