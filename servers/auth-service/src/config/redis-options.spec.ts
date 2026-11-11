import { redisOptionsFromUrl } from './redis-options';

const VALID_URL = 'redis://:test-password@cache.test.invalid:6379';

describe('redisOptionsFromUrl', () => {
  it('拆出 host/port/password，并解码百分号', () => {
    const opts = redisOptionsFromUrl('redis://:pw%25-test@cache.test.invalid:6379');

    expect(opts.host).toBe('cache.test.invalid');
    expect(opts.port).toBe(6379);
    expect(opts.password).toBe('pw%-test');
  });

  it('密码含裸百分号（非法转义）时不抛错、原样透传', () => {
    expect(redisOptionsFromUrl('redis://:pw%zz@cache.test.invalid:6379').password).toBe('pw%zz');
  });

  it('pathname 带 db 时解析出 db', () => {
    expect(redisOptionsFromUrl('redis://:test-password@cache.test.invalid:6380/2')).toMatchObject({
      host: 'cache.test.invalid',
      port: 6380,
      password: 'test-password',
      db: 2,
    });
  });

  it('没有 db / 用户名的 URL 不写这些字段', () => {
    const opts = redisOptionsFromUrl('redis://cache.test.invalid:6379');

    expect(opts.host).toBe('cache.test.invalid');
    expect(opts.db).toBeUndefined();
    expect(opts.username).toBeUndefined();
    expect(opts.password).toBeUndefined();
  });

  it('省略端口时用 Redis 协议默认端口，而不是 localhost 缺省', () => {
    expect(redisOptionsFromUrl('redis://cache.test.invalid')).toMatchObject({
      host: 'cache.test.invalid',
      port: 6379,
    });
  });

  it('rediss:// 带 tls', () => {
    const opts = redisOptionsFromUrl('rediss://:test-password@secure.test.invalid:6380');

    expect(opts.host).toBe('secure.test.invalid');
    expect(opts.tls).toEqual({});
  });

  it.each([undefined, ''])('V2：缺失配置 %s 必须 fail-fast', (rawUrl) => {
    expect(() => redisOptionsFromUrl(rawUrl as string)).toThrow('Redis 配置缺失');
  });

  it.each([
    'not-a-url',
    'https://cache.test.invalid:6379',
    'redis:///0',
    'redis://cache.test.invalid:6379/not-a-db',
    'redis://cache.test.invalid:6379/-1',
    'redis://cache.test.invalid:6379/0/extra',
  ])('V2：非法配置必须 fail-fast，且错误不回显配置值：%s', (rawUrl) => {
    let thrown: unknown;
    try {
      redisOptionsFromUrl(rawUrl);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Redis 配置非法');
    expect((thrown as Error).message).not.toContain(rawUrl);
  });

  it('V3：连接、命令与离线队列都有明确上界', () => {
    const opts = redisOptionsFromUrl(VALID_URL);

    expect(opts).toMatchObject({
      connectTimeout: 1000,
      commandTimeout: 800,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    expect(opts.retryStrategy).toEqual(expect.any(Function));
  });

  it('V3：保留后台重连，退避上限 1000ms', () => {
    const retryStrategy = redisOptionsFromUrl(VALID_URL).retryStrategy!;

    expect(retryStrategy(1)).toBe(100);
    expect(retryStrategy(2)).toBe(200);
    expect(retryStrategy(10)).toBe(1000);
    expect(retryStrategy(100)).toBe(1000);
  });

  it('回归：绝不能产出 url 字段——ioredis 不解析它，会静默连本机', () => {
    const opts = redisOptionsFromUrl(VALID_URL) as Record<string, unknown>;

    expect(opts.url).toBeUndefined();
    expect(opts.host).toBe('cache.test.invalid');
  });
});
