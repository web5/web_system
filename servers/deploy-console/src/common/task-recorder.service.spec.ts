import { Logger } from '@nestjs/common';
import { TaskRecorderService } from './task-recorder.service';

/**
 * 任务留痕服务（2026-10-09 遗留④）
 *
 * 锁定的三条语义：
 * 1. 开始/成功/失败都有终态 —— 「跑了但不知道结果」等于没留痕
 * 2. 失败必须**原样抛出**：留痕是旁路，不能改变调用方的成功/失败语义
 * 3. **写库失败绝不阻断主流程**（与审计同一取舍）：留痕挂了最多没记录，不能让发布发不出去
 */
describe('TaskRecorderService', () => {
  let repo: { save: jest.Mock; update: jest.Mock };
  let svc: TaskRecorderService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = { save: jest.fn(async (x: unknown) => x), update: jest.fn(async () => undefined) };
    svc = new TaskRecorderService(repo as never);
    // 留痕失败的 error 日志会刷屏，测试里静音
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('start：落一条 running 任务，含首行日志与开始时间', async () => {
    const id = await svc.start({ type: 'deploy', component: 'portal', env: 'prod', tag: 'v2', operator: 'alice' });
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        type: 'deploy',
        component: 'portal',
        env: 'prod',
        tag: 'v2',
        operator: 'alice',
        status: 'running',
      }),
    );
  });

  it('log：日志累积后整体回写（不做逐条读回）', async () => {
    const id = await svc.start({ type: 'deploy', component: 'portal' });
    await svc.log(id, '第一条');
    await svc.log(id, '第二条');
    expect(repo.update).toHaveBeenLastCalledWith(id, { logs: expect.arrayContaining(['第一条', '第二条']) });
  });

  it('record 成功 → 终态 success', async () => {
    const { result, taskId } = await svc.record({ type: 'deploy', component: 'portal' }, async () => 'ok');
    expect(result).toBe('ok');
    expect(taskId).toBeTruthy();
    expect(repo.update).toHaveBeenLastCalledWith(taskId, expect.objectContaining({ status: 'success' }));
  });

  it('record 失败 → 终态 failed 且**原样抛出**', async () => {
    await expect(
      svc.record({ type: 'rollback', component: 'portal' }, async () => {
        throw new Error('没有可回滚的版本');
      }),
    ).rejects.toThrow('没有可回滚的版本');
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed', error: '没有可回滚的版本' }),
    );
  });

  it('写库失败不阻断主流程（留痕是旁路，但会打 error）', async () => {
    repo.save.mockRejectedValueOnce(new Error('DB down'));
    repo.update.mockRejectedValueOnce(new Error('DB down'));
    const { result } = await svc.record({ type: 'deploy', component: 'portal' }, async () => 'still-ok');
    expect(result).toBe('still-ok');
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
