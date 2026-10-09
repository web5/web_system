import { ForbiddenException, HttpException } from '@nestjs/common';
import { InternalGuardService, clientIpOf, normalizeIp } from './internal-guard.service';

const KEY = 'test-internal-key-0123456789';

function makeGuard(cfg: Record<string, string> = {}) {
  const config = { get: (k: string) => cfg[k] } as never;
  const audit = { log: jest.fn(async () => undefined) } as never;
  const svc = new InternalGuardService(config, audit);
  return { svc, audit: audit as unknown as { log: jest.Mock } };
}

function reqWith(headers: Record<string, unknown> = {}, ip = '10.0.0.1') {
  return { headers, ip, socket: { remoteAddress: ip } } as never;
}

describe('internal-guard（诊断 #7）', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.INTERNAL_API_KEY;
  });

  describe('IP 归一', () => {
    it('IPv6 回环 / IPv4-mapped 归一为 127.0.0.1', () => {
      expect(normalizeIp('::1')).toBe('127.0.0.1');
      expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
      expect(normalizeIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
      expect(normalizeIp('')).toBe('unknown');
    });

    it('x-forwarded-for 取首段（nginx 反代）', () => {
      expect(clientIpOf({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } } as never)).toBe('1.2.3.4');
    });

    it('无 xff 时回落 socket.remoteAddress', () => {
      expect(clientIpOf({ socket: { remoteAddress: '::ffff:10.1.1.1' } } as never)).toBe('10.1.1.1');
    });
  });

  it('key 不对 → 401（鉴权优先于限流）', () => {
    const { svc } = makeGuard();
    expect(() => svc.check(reqWith({ 'x-internal-key': 'wrong' }), 'a')).toThrow(/不正确/);
  });

  it('未配 INTERNAL_API_KEY → 一律拒绝（宁不可用也不裸奔）', () => {
    delete process.env.INTERNAL_API_KEY;
    const { svc } = makeGuard();
    expect(() => svc.check(reqWith({ 'x-internal-key': KEY }), 'a')).toThrow(/未配置/);
  });

  it('限流：超阈值 → 429 且带 retryAfterSec', () => {
    const { svc } = makeGuard({ INTERNAL_RATE_LIMIT_PER_MIN: '2' });
    const ok = { 'x-internal-key': KEY };
    expect(svc.check(reqWith(ok), 'a')).toBe('10.0.0.1');
    svc.check(reqWith(ok), 'a');
    try {
      svc.check(reqWith(ok), 'a');
      throw new Error('应当被限流');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(429);
      expect((e as HttpException).getResponse()).toMatchObject({ retryAfterSec: expect.any(Number) });
    }
  });

  it('不同动作分开计数（切版本不影响写版本）', () => {
    const { svc } = makeGuard({ INTERNAL_RATE_LIMIT_PER_MIN: '1' });
    const ok = { 'x-internal-key': KEY };
    svc.check(reqWith(ok), 'internal.release.pointer');
    expect(() => svc.check(reqWith(ok), 'internal.release.pointer')).toThrow();
    expect(svc.check(reqWith(ok), 'internal.release.version')).toBe('10.0.0.1');
  });

  it('白名单启用后：名单外 → 403，名单内放行', () => {
    const { svc } = makeGuard({ INTERNAL_IP_ALLOWLIST: '127.0.0.1, ::1' });
    const ok = { 'x-internal-key': KEY };
    expect(svc.allowlistEnabled).toBe(true);
    expect(() => svc.check(reqWith(ok, '10.9.9.9'), 'a')).toThrow(ForbiddenException);
    // 归一后 ::1 等价 127.0.0.1 —— 配一个就能覆盖回环两种写法
    expect(svc.check(reqWith(ok, '::1'), 'a')).toBe('127.0.0.1');
  });

  it('回归：空白配置（空串 / 只有逗号 / 未配）都不得视为白名单启用', () => {
    // 踩过的坑：`''.split(',')` → [''] → normalizeIp('') 返回 'unknown'（审计占位值）
    // 被 filter(Boolean) 保留 ⇒ 白名单「默认启用」且只允许 unknown ⇒ 内部接口全部 403
    for (const v of [undefined, '', '   ', ',', ' ,, ']) {
      const { svc } = makeGuard(v === undefined ? {} : { INTERNAL_IP_ALLOWLIST: v });
      expect(svc.allowlistEnabled).toBe(false);
      expect(svc.check(reqWith({ 'x-internal-key': KEY }, '10.0.0.1'), 'a')).toBe('10.0.0.1');
    }
  });

  it('未配白名单 → 不限制来源（向后兼容）', () => {
    const { svc } = makeGuard();
    expect(svc.allowlistEnabled).toBe(false);
    expect(svc.check(reqWith({ 'x-internal-key': KEY }, '203.0.113.9'), 'a')).toBe('203.0.113.9');
  });

  it('run：成功留痕，detail 由回调生成且带来源 IP', async () => {
    const { svc, audit } = makeGuard();
    const r = await svc.run(
      reqWith({ 'x-internal-key': KEY }),
      { action: 'internal.release.pointer', env: 'prod', component: 'portal', user: 'pipeline-script' },
      async () => ({ from: 'v1', to: 'v2' }),
      (res) => `切指针 ${res.from} → ${res.to}`,
    );
    expect(r).toEqual({ from: 'v1', to: 'v2' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'internal.release.pointer',
        env: 'prod',
        component: 'portal',
        status: 'success',
        detail: '切指针 v1 → v2（来源 10.0.0.1）',
      }),
    );
  });

  it('run：失败也留痕，且异常原样上抛（不改变既有错误语义）', async () => {
    const { svc, audit } = makeGuard();
    await expect(
      svc.run(reqWith({ 'x-internal-key': KEY }), { action: 'a', env: 'prod' }, async () => {
        throw new Error('版本产物不存在');
      }),
    ).rejects.toThrow('版本产物不存在');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', detail: expect.stringContaining('版本产物不存在') }),
    );
  });

  it('审计写失败 → 不阻断主流程，但打 error 留痕', async () => {
    const config = { get: () => undefined } as never;
    const audit = { log: jest.fn(async () => { throw new Error('audit db down'); }) } as never;
    const errLog = jest.fn();
    const svc = new InternalGuardService(config, audit);
    // logger 是私有的：直接替换其 error 行为
    (svc as unknown as { logger: { error: jest.Mock } }).logger = { error: errLog } as never;
    const out = await svc.run(reqWith({ 'x-internal-key': KEY }), { action: 'a' }, async () => 'done');
    expect(out).toBe('done');
    expect(errLog).toHaveBeenCalledWith(expect.stringContaining('审计写入失败'));
  });

  /**
   * 诊断 #20：幂等。
   * 发布链路里重试是常态（脚本失败重跑、手动补刀），没有幂等键，
   * 重试就会重复「写版本」并把 previous_version 覆盖掉。
   */
  describe('run 的幂等（诊断 #20）', () => {
    it('不带 Idempotency-Key → 完全不启用（既有脚本零变化）', async () => {
      const { svc } = makeGuard();
      const fn = jest.fn(async () => 'ok');
      await svc.run(reqWith({ 'x-internal-key': KEY }), { action: 'a' }, fn);
      await svc.run(reqWith({ 'x-internal-key': KEY }), { action: 'a' }, fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('同一 action + key → 只执行一次，第二次复用结果', async () => {
      const { svc } = makeGuard();
      const fn = jest.fn(async () => 'ok');
      const r1 = await svc.run(
        reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'run-1' }),
        { action: 'pointer' },
        fn,
      );
      const r2 = await svc.run(
        reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'run-1' }),
        { action: 'pointer' },
        fn,
      );
      expect(fn).toHaveBeenCalledTimes(1);
      expect(r1).toBe('ok');
      expect(r2).toBe('ok');
    });

    it('不同 key / 不同 action 互不干扰', async () => {
      const { svc } = makeGuard();
      const fn = jest.fn(async () => 'ok');
      await svc.run(reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'a' }), { action: 'p' }, fn);
      await svc.run(reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'b' }), { action: 'p' }, fn);
      await svc.run(reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'a' }), { action: 'v' }, fn);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    /** 失败必须可重试：留了失败记录就等于一次抖动把发布永久卡死 */
    it('失败不留幂等记录 → 可以重试', async () => {
      const { svc } = makeGuard();
      let n = 0;
      const fn = jest.fn(async () => {
        n += 1;
        if (n === 1) throw new Error('网络抖动');
        return 'ok';
      });
      const req = () => reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'r' });
      await expect(svc.run(req(), { action: 'p' }, fn)).rejects.toThrow('网络抖动');
      await expect(svc.run(req(), { action: 'p' }, fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('INTERNAL_IDEMPOTENCY_TTL_MS=0 → 关闭幂等（可完全退回旧行为）', async () => {
      const { svc } = makeGuard({ INTERNAL_IDEMPOTENCY_TTL_MS: '0' });
      const fn = jest.fn(async () => 'ok');
      await svc.run(reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'r' }), { action: 'p' }, fn);
      await svc.run(reqWith({ 'x-internal-key': KEY, 'idempotency-key': 'r' }), { action: 'p' }, fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
