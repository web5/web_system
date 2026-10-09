import { SlidingWindowLimiter } from './rate-limit';

describe('SlidingWindowLimiter（诊断 #7 限流）', () => {
  let now = 1_000_000;
  const limiter = (limit: number, windowMs = 60_000) =>
    new SlidingWindowLimiter(limit, windowMs, () => now);

  it('窗口内未超阈值 → 放行，计数递增', () => {
    const l = limiter(3);
    expect(l.hit('a').allowed).toBe(true);
    expect(l.hit('a').allowed).toBe(true);
    expect(l.hit('a').count).toBe(3);
  });

  it('超阈值 → 拒绝，且给出可执行的重试时间', () => {
    const l = limiter(2);
    l.hit('a');
    l.hit('a');
    const v = l.hit('a');
    expect(v.allowed).toBe(false);
    expect(v.count).toBe(2);
    expect(v.retryAfterMs).toBe(60_000);
    // 推进 30s：仍应拒绝，重试时间缩短
    now += 30_000;
    const v2 = l.hit('a');
    expect(v2.allowed).toBe(false);
    expect(v2.retryAfterMs).toBe(30_000);
  });

  it('窗口滑过 → 恢复放行（滑动窗口，不是固定窗口）', () => {
    const l = limiter(2);
    l.hit('a');
    l.hit('a');
    expect(l.hit('a').allowed).toBe(false);
    now += 60_001; // 最早一次已滑出窗口
    expect(l.hit('a').allowed).toBe(true);
  });

  it('拒绝时不写入本次：否则重试永远进不来', () => {
    const l = limiter(1);
    l.hit('a');
    for (let i = 0; i < 5; i++) expect(l.hit('a').allowed).toBe(false);
    now += 60_001;
    expect(l.hit('a').allowed).toBe(true); // 未被拒绝请求填满
  });

  it('不同 key 互不影响', () => {
    const l = limiter(1);
    expect(l.hit('a').allowed).toBe(true);
    expect(l.hit('b').allowed).toBe(true);
    expect(l.hit('a').allowed).toBe(false);
  });

  it('limit<=0 → 关闭限流（仍计数，便于随时开启即生效）', () => {
    const l = limiter(0);
    expect(l.enabled).toBe(false);
    for (let i = 0; i < 100; i++) expect(l.hit('a').allowed).toBe(true);
    expect(l.hit('a').count).toBe(101);
  });

  it('reset 可清空（单 key 或全部）', () => {
    const l = limiter(1);
    l.hit('a');
    l.hit('b');
    l.reset('a');
    expect(l.hit('a').allowed).toBe(true);
    expect(l.size).toBe(2);
    l.reset();
    expect(l.size).toBe(0);
  });
});
