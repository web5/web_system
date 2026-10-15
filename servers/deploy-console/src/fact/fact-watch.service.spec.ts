import { FactWatchService, DEFAULT_INTERVAL_MS } from './fact-watch.service';
import type { FactBatchReport } from './fact-collect.service';

const report = (env: string): FactBatchReport => ({
  batchId: 'b1',
  env,
  host: 'local',
  ranAt: 0,
  status: 'ok',
  checked: 1,
  drift: 0,
  missing: 0,
  error: 0,
  items: [],
});

function makeWatch(cfg: Record<string, string> = {}) {
  const collect = {
    collect: jest.fn(async (env: string) => report(env)),
    allowedEnvs: jest.fn(() => ['dev']),
  };
  const svc = new FactWatchService(
    { get: (k: string) => cfg[k] } as never,
    collect as never,
  );
  return { svc, collect };
}

describe('FactWatchService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('默认配置：首次延迟后采一次，并按间隔继续', async () => {
    const { svc, collect } = makeWatch();
    svc.onModuleInit();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(collect.collect).toHaveBeenCalledWith('dev', 'schedule');

    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS);
    await Promise.resolve();
    expect(collect.collect).toHaveBeenCalledTimes(2);
    svc.onModuleDestroy();
  });

  it('FACT_SNAPSHOT_ENABLED=false → 完全不启动', () => {
    const { svc, collect } = makeWatch({ FACT_SNAPSHOT_ENABLED: 'false' });
    svc.onModuleInit();
    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS * 2);
    expect(collect.collect).not.toHaveBeenCalled();
    svc.onModuleDestroy();
  });

  it('FACT_SNAPSHOT_INTERVAL_MS=0 → 不定时（仍可手动触发）', () => {
    const { svc, collect } = makeWatch({ FACT_SNAPSHOT_INTERVAL_MS: '0' });
    svc.onModuleInit();
    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS * 2);
    expect(collect.collect).not.toHaveBeenCalled();
    svc.onModuleDestroy();
  });

  it('单个环境采集抛错不影响其它环境', async () => {
    const collect = {
      collect: jest.fn(async (env: string) => {
        if (env === 'dev') throw new Error('主机未登记');
        return report(env);
      }),
      allowedEnvs: () => ['dev', 'prod'],
    };
    const svc = new FactWatchService({ get: () => undefined } as never, collect as never);
    const out = await svc.runAll();
    expect(out).toHaveLength(1);
    expect(out[0].env).toBe('prod');
  });

  it('lastReports 返回最近一次结果', async () => {
    const { svc } = makeWatch();
    await svc.runAll();
    expect(svc.lastReports()[0].env).toBe('dev');
  });
});
