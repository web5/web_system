import { CRON_TIMEZONE, nextCronRuns, parseCronExpression } from './cron.util';

/**
 * cron 解析口径的回归测试（#8557 / #8561）。
 *
 * 钉死两件事：
 *   1. 合法表达式必须能算出「下次执行时间」——预览要用它，算不出来等于没校验；
 *   2. 非法表达式必须**被判定为失败并带人话原因**——`0 8 0 * *`（把周四写进日字段）
 *      正是本次线上故障的原文，它以前能原样入库。
 */
describe('parseCronExpression', () => {
  // 固定基准时刻，避免用「现在」导致断言随日期漂移：2026-11-06 是周五
  const NOW = new Date('2026-11-06T10:00:00+08:00');

  it('合法的 5 段式返回下次执行时间（每周四 8 点 → 11-12 08:00）', () => {
    const r = parseCronExpression('0 8 * * 4', NOW);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('0 8 * * 4');
    expect(r.nextRun).toBe('2026-11-12T08:00:00.000+08:00');
  });

  it('合法的 6 段式（带秒）也接受', () => {
    const r = parseCronExpression('0 0 9 * * 5', NOW);
    expect(r.ok).toBe(true);
    expect(r.nextRun).toBe('2026-11-13T09:00:00.000+08:00');
  });

  it('合并多余空白后再解析', () => {
    const r = parseCronExpression('  0   9  *  *  *  ', NOW);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('0 9 * * *');
  });

  it('🔴 `0 8 0 * *`（日字段越界）判为非法，且原因是「out of range」', () => {
    const r = parseCronExpression('0 8 0 * *', NOW);
    expect(r.ok).toBe(false);
    expect(r.nextRun).toBeUndefined();
    expect(r.error).toContain('out of range');
    // 原因里必须带字段顺序提示，否则运营只会看到一句英文报错
    expect(r.error).toContain('分 时 日 月 周');
  });

  it('段数不对时直接给中文提示，而不是抛 Too few fields', () => {
    const r = parseCronExpression('* * *', NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('需要 5 段');
    expect(r.error).toContain('实际 3 段');
  });

  it('空串 / 非字符串一律非法', () => {
    expect(parseCronExpression('', NOW).ok).toBe(false);
    expect(parseCronExpression('   ', NOW).ok).toBe(false);
    expect(parseCronExpression(null, NOW).ok).toBe(false);
    expect(parseCronExpression(undefined, NOW).ok).toBe(false);
    expect(parseCronExpression(42, NOW).ok).toBe(false);
  });

  it('时区固定为 Asia/Shanghai（与调度器注册一致）', () => {
    expect(CRON_TIMEZONE).toBe('Asia/Shanghai');
    // 09:00 的班次必须解析成 +08:00 的 09:00，不能是 UTC 的 09:00
    const r = parseCronExpression('0 9 * * *', NOW);
    expect(r.nextRun).toBe('2026-11-07T09:00:00.000+08:00');
  });
});

describe('nextCronRuns', () => {
  const NOW = new Date('2026-11-06T10:00:00+08:00');

  it('每周五 9 点 → 给出连续 3 个周五（当天 9 点已过，从下周起算）', () => {
    expect(nextCronRuns('0 9 * * 5', 3, NOW)).toEqual([
      '2026-11-13T09:00:00.000+08:00',
      '2026-11-20T09:00:00.000+08:00',
      '2026-11-27T09:00:00.000+08:00',
    ]);
  });

  it('每天 12 点 → 连续三天', () => {
    expect(nextCronRuns('0 12 * * *', 3, NOW)).toEqual([
      '2026-11-06T12:00:00.000+08:00',
      '2026-11-07T12:00:00.000+08:00',
      '2026-11-08T12:00:00.000+08:00',
    ]);
  });

  it('非法表达式直接抛错（调用方必须先判 ok）', () => {
    expect(() => nextCronRuns('0 8 0 * *', 3, NOW)).toThrow(/out of range/);
  });
});
