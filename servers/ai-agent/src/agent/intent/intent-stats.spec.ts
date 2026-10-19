import { IntentStats } from './intent-stats';

describe('IntentStats', () => {
  const fill = (s: IntentStats, via: 'rule' | 'llm' | 'fallback', n: number, reason?: any) => {
    for (let i = 0; i < n; i++) s.record(via, reason);
  };

  it('空窗口：比例 0、不告警', () => {
    const s = new IntentStats();
    expect(s.snapshot()).toEqual({ total: 0, byVia: {}, byReason: {}, fallbackRatio: 0 });
    expect(s.shouldWarn(1_000)).toBe(false);
  });

  it('按 via 与降级原因分桶；比例 = fallback / total', () => {
    const s = new IntentStats();
    fill(s, 'rule', 6);
    fill(s, 'fallback', 3, 'llm_empty');
    s.record('llm');
    const snap = s.snapshot();
    expect(snap.total).toBe(10);
    expect(snap.byVia).toEqual({ rule: 6, fallback: 3, llm: 1 });
    expect(snap.byReason).toEqual({ llm_empty: 3 });
    expect(snap.fallbackRatio).toBeCloseTo(0.3);
  });

  it('locked 收尾 + 降级原因：不算 fallback，但原因仍被统计（不被「沿用锁定」掩盖）', () => {
    const s = new IntentStats();
    s.record('locked' as any, 'llm_error');
    expect(s.snapshot().fallbackRatio).toBe(0);
    expect(s.snapshot().byReason).toEqual({ llm_error: 1 });
  });

  it('样本不足（< minSamples）即使 100% 兜底也不告警', () => {
    const s = new IntentStats({ minSamples: 30 });
    fill(s, 'fallback', 29);
    expect(s.shouldWarn(1_000)).toBe(false);
  });

  it('比例低于阈值不告警；达到阈值告警', () => {
    const s = new IntentStats({ minSamples: 10, warnRatio: 0.5 });
    fill(s, 'rule', 6);
    fill(s, 'fallback', 4); // 40%
    expect(s.shouldWarn(1_000)).toBe(false);
    fill(s, 'fallback', 6); // 10/16 = 62.5%
    expect(s.shouldWarn(2_000)).toBe(true);
  });

  it('同一时间窗内只告警一次（防刷屏），间隔过后可再次告警', () => {
    const s = new IntentStats({ minSamples: 5, warnRatio: 0.5, warnIntervalMs: 60_000 });
    fill(s, 'fallback', 10);
    expect(s.shouldWarn(100_000)).toBe(true);
    expect(s.shouldWarn(110_000)).toBe(false);
    expect(s.shouldWarn(100_000 + 60_000)).toBe(true);
  });

  it('滑动窗口：旧数据被挤出，比例随最近行为变化（故障恢复后能降下来）', () => {
    const s = new IntentStats({ windowSize: 10, minSamples: 5 });
    fill(s, 'fallback', 10);
    expect(s.snapshot().fallbackRatio).toBe(1);
    fill(s, 'rule', 10);
    expect(s.snapshot().total).toBe(10);
    expect(s.snapshot().fallbackRatio).toBe(0);
  });
});
