import { StartupReconcileService, DEFAULT_STALE_TASK_MS } from './startup-reconcile.service';

describe('StartupReconcileService（诊断 #12：启动对账）', () => {
  let qb: any;
  let taskRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let locks: { releaseExpired: jest.Mock };
  let svc: StartupReconcileService;

  const running = (id: string, startTime: number) => ({ id, startTime, component: 'portal', env: 'prod' });

  beforeEach(() => {
    qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    taskRepo = {
      createQueryBuilder: jest.fn(() => qb),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    locks = { releaseExpired: jest.fn(async () => 0) };
    svc = new StartupReconcileService(taskRepo as never, locks as never);
  });

  it('超期 running 任务 → 置 failed 并写清原因（不静默删除）', async () => {
    qb.getMany.mockResolvedValue([running('t-1', Date.now() - DEFAULT_STALE_TASK_MS - 1000)]);
    const r = await svc.reconcile();
    expect(r.staleTasks).toBe(1);
    expect(taskRepo.update).toHaveBeenCalledWith(
      { id: 't-1' },
      expect.objectContaining({ status: 'failed' }),
    );
    const patch = taskRepo.update.mock.calls[0][1];
    expect(patch.error).toContain('启动对账');
    expect(typeof patch.endTime).toBe('number');
  });

  it('未超期的 running → 不动（那是一次真的在跑的发布）', async () => {
    qb.getMany.mockResolvedValue([]); // 查询条件已把未超期的过滤掉
    const r = await svc.reconcile();
    expect(r.staleTasks).toBe(0);
    expect(taskRepo.update).not.toHaveBeenCalled();
  });

  it('阈值可配：10 分钟阈值下 20 分钟前的任务即判定僵尸', async () => {
    qb.getMany.mockResolvedValue([running('t-2', Date.now() - 20 * 60 * 1000)]);
    const r = await svc.reconcile(10 * 60 * 1000);
    expect(r.staleTasks).toBe(1);
    expect(qb.andWhere).toHaveBeenCalledWith('t.startTime < :cutoff', expect.any(Object));
  });

  it('过期锁一并清理，且用同一时刻判定', async () => {
    locks.releaseExpired.mockResolvedValue(3);
    const r = await svc.reconcile();
    expect(r.staleLocks).toBe(3);
    expect(locks.releaseExpired).toHaveBeenCalledTimes(1);
  });

  it('返回被回收的任务 ID（供 UI/日志核对）', async () => {
    qb.getMany.mockResolvedValue([running('t-1', 0), running('t-2', 0)]);
    const r = await svc.reconcile();
    expect(r.taskIds).toEqual(['t-1', 't-2']);
  });

  it('对账抛错不冒泡到启动流程（绝不能因对账拖垮启动）', async () => {
    qb.getMany.mockRejectedValue(new Error('db down'));
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('无残留时不写任何更新', async () => {
    qb.getMany.mockResolvedValue([]);
    locks.releaseExpired.mockResolvedValue(0);
    const r = await svc.reconcile();
    expect(r).toMatchObject({ staleTasks: 0, staleLocks: 0 });
    expect(taskRepo.update).not.toHaveBeenCalled();
  });
});
