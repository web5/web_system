import { redisOptionsFromUrl } from './redis-options';

describe('redisOptionsFromUrl', () => {
  it('拆出 host/port/password（线上真实形状，密码含百分号编码）', () => {
    // 线上 .env 里的值：密码 gn%!CTvZNP0e4%Lc，其中 % 编码成 %25
    const opts = redisOptionsFromUrl('redis://:gn%25!CTvZNP0e4%25Lc@172.16.0.8:6379');

    expect(opts.host).toBe('172.16.0.8');
    expect(opts.port).toBe(6379);
    // ⚠️ new URL() 不对 redis: 这种非特殊 scheme 解码，需本函数自己解（与 ioredis parseURL 同口径）
    expect(opts.password).toBe('gn%!CTvZNP0e4%Lc');
  });

  it('密码含裸百分号（非法转义）时不抛错、原样透传', () => {
    expect(() => redisOptionsFromUrl('redis://:pw%zz@10.0.0.1:6379')).not.toThrow();
    expect(redisOptionsFromUrl('redis://:pw%zz@10.0.0.1:6379').password).toBe('pw%zz');
  });

  it('pathname 带 db 时解析出 db', () => {
    expect(redisOptionsFromUrl('redis://:pw@10.0.0.1:6380/2')).toMatchObject({
      host: '10.0.0.1',
      port: 6380,
      password: 'pw',
      db: 2,
    });
  });

  it('没有 db / 用户名的 URL 不写这些字段', () => {
    const opts = redisOptionsFromUrl('redis://10.0.0.1:6379');

    expect(opts.host).toBe('10.0.0.1');
    expect(opts.db).toBeUndefined();
    expect(opts.username).toBeUndefined();
    expect(opts.password).toBeUndefined();
  });

  it('省略端口时用 6379', () => {
    expect(redisOptionsFromUrl('redis://cache.internal')).toMatchObject({
      host: 'cache.internal',
      port: 6379,
    });
  });

  it('rediss:// 带 tls', () => {
    const opts = redisOptionsFromUrl('rediss://:pw@secure.internal:6380');

    expect(opts.host).toBe('secure.internal');
    expect(opts.tls).toEqual({});
  });

  it('非法 URL 回落到 localhost:6379（不抛错，启动不该被配置写坏打断）', () => {
    expect(redisOptionsFromUrl('不是URL')).toEqual({ host: 'localhost', port: 6379 });
  });

  it('⭐ 回归：绝不能产出 url 字段 —— ioredis 不解析它，会静默连本机', () => {
    const opts = redisOptionsFromUrl('redis://:pw@172.16.0.8:6379') as Record<string, unknown>;

    expect(opts.url).toBeUndefined();
    expect(opts.host).toBe('172.16.0.8');
  });
});
