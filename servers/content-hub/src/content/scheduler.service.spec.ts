import { ContentPipelineEntity } from './entities/content-pipeline.entity';
import { SchedulerService } from './scheduler.service';

/**
 * 调度注册的结果必须「可查」（#8557）。
 *
 * 历史行为：注册失败只 `logger.error` 一行，进程照常起来、`/health` 照常 200，
 * 于是 ai_news 停摆两天无人发现。本组用例钉死：
 *   1. 非法 cron → 该管线 state 里必须留下 `registered:false` + 原因；
 *   2. 合法的仍要照常注册（不能因为邻居坏了一条就整体不注册）；
 *   3. `reload()` 可重入（改完 cron 立刻生效，不必重启进程）。
 */
function makeService(rows: Array<Partial<ContentPipelineEntity>>) {
  const repo = { find: async () => rows };
  const pipelineService = { run: async () => ({ collected: 0 }) };
  const svc = new SchedulerService(repo as never, pipelineService as never);
  // 静默 logger，避免测试输出被注册日志刷屏
  (svc as unknown as { logger: { log: () => void; warn: () => void; error: () => void } }).logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return svc;
}

describe('SchedulerService', () => {
  it('合法 cron 注册成功，status 带下次执行时间', async () => {
    const svc = makeService([{ code: 'daily_paper', cron: '0 9 * * 5', enabled: true }]);
    await svc.reload();

    const status = svc.getStatus();
    expect(status.total).toBe(1);
    expect(status.failed).toBe(0);
    expect(status.jobs[0]).toMatchObject({ code: 'daily_paper', registered: true, error: null });
    expect(status.jobs[0].nextRun).toMatch(/T09:00:00\.000\+08:00$/);
    expect(status.timezone).toBe('Asia/Shanghai');
  });

  it('🔴 非法 cron 留下可查失败态，而不是只打日志', async () => {
    const svc = makeService([{ code: 'ai_news', cron: '0 8 0 * *', enabled: true }]);
    await svc.reload();

    const status = svc.getStatus();
    expect(status.failed).toBe(1);
    expect(status.jobs[0]).toMatchObject({ code: 'ai_news', registered: false, nextRun: null });
    expect(status.jobs[0].error).toContain('分 时 日 月 周');
  });

  it('好坏混排时互不牵连：坏的不注册，好的照常跑', async () => {
    const svc = makeService([
      { code: 'ai_news', cron: '0 8 0 * *', enabled: true },
      { code: 'daily_paper', cron: '0 9 * * 5', enabled: true },
      { code: 'hot_news', cron: '0 12 * * *', enabled: true },
    ]);
    await svc.reload();

    const status = svc.getStatus();
    expect(status.total).toBe(3);
    expect(status.failed).toBe(1);
    // 按 code 排序，便于后台稳定展示
    expect(status.jobs.map((j) => j.code)).toEqual(['ai_news', 'daily_paper', 'hot_news']);
    expect(status.jobs.filter((j) => j.registered).map((j) => j.code)).toEqual([
      'daily_paper',
      'hot_news',
    ]);
  });

  it('reload 可重入：改完 cron 立即反映，不残留旧任务', async () => {
    const rows: Array<Partial<ContentPipelineEntity>> = [
      { code: 'daily_paper', cron: '0 8 0 * *', enabled: true },
    ];
    const svc = makeService(rows);
    await svc.reload();
    expect(svc.getStatus().failed).toBe(1);

    // 模拟 admin 把 cron 改对后再次 reload
    rows[0].cron = '0 9 * * 5';
    await svc.reload();
    const status = svc.getStatus();
    expect(status.failed).toBe(0);
    expect(status.jobs[0].registered).toBe(true);
    // 重入不叠加：仍只有一条
    expect(status.total).toBe(1);
  });

  it('无启用管线时 status 为空且不报错（空转是可接受状态）', async () => {
    const svc = makeService([]);
    await svc.reload();
    expect(svc.getStatus()).toMatchObject({ total: 0, failed: 0, jobs: [] });
  });

  it('onModuleDestroy 停表不抛错', async () => {
    const svc = makeService([{ code: 'hot_news', cron: '0 12 * * *', enabled: true }]);
    await svc.reload();
    expect(() => svc.onModuleDestroy()).not.toThrow();
  });
});
