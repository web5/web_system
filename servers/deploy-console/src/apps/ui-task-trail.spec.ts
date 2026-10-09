import { AppsService } from './apps.service';

/**
 * UI 切换/回滚的任务留痕（2026-10-09 遗留④）
 *
 * 此前这两个入口**完全不落 `deploy_tasks`**，也不在流水线里 ——
 * 于是「UI 上点了一次切版本」这件事在任何表里都查不到，
 * 排查 5ba74517 发布失败时只能靠 pm2 error log 反推。
 *
 * 这里锁定的三条边界：
 * 1. UI 入口（显式 recordTask）落任务，且返回结果与不留痕时完全一致
 * 2. 流水线 / 内部脚本入口（不传 recordTask）**不落任务** —— 它们各有自己的留痕，避免重复
 * 3. 失败要落 failed 并**原样抛出**（留痕不能改变调用方的成功/失败语义）
 */
describe('UI 切换/回滚的任务留痕', () => {
  let registry: { setAppEnvPointer: jest.Mock; resolveRollbackTarget: jest.Mock };
  let taskRecorder: { record: jest.Mock; start: jest.Mock; log: jest.Mock; finish: jest.Mock };
  let svc: AppsService;

  beforeEach(() => {
    jest.clearAllMocks();

    const appRepo = { findOne: jest.fn(async () => ({ key: 'portal', deployMode: 'env-dir' })), save: jest.fn(), create: jest.fn() };
    const routeRepo = { delete: jest.fn(), save: jest.fn(), find: jest.fn(async () => []) };
    const versionRepo = { findOne: jest.fn(async () => null), save: jest.fn(), create: jest.fn(), find: jest.fn(async () => []) };
    const legacyModuleRepo = { find: jest.fn(async () => []) };
    const envsService = { getEnv: jest.fn(async () => ({ envId: 'prod' })) };
    const configService = { get: jest.fn(() => '/ws') };
    const mirror = { mirrorRow: jest.fn(), deleteMirror: jest.fn() };
    const artifacts = {
      hasVersion: jest.fn(async () => true),
      listVersions: jest.fn(async () => []),
      readPointer: jest.fn(async () => null),
      writePointer: jest.fn(async () => ({ js: '/ws/x/index.js', css: null })),
      describeTarget: jest.fn(() => '本机 /ws/servers/gateway/public'),
    };
    const gatewayCache = { notifyVersionChange: jest.fn(async () => ({ ok: true })) };
    registry = {
      setAppEnvPointer: jest.fn(async () => ({ from: 'v1', previous: 'v0', unchanged: false })),
      resolveRollbackTarget: jest.fn(async () => ({ to: 'v1' })),
    };
    taskRecorder = {
      record: jest.fn(async (_meta: unknown, fn: (log: (l: string) => void) => Promise<unknown>) => ({
        result: await fn(() => undefined),
        taskId: 'task-1',
      })),
      start: jest.fn(async () => 'task-1'),
      log: jest.fn(async () => undefined),
      finish: jest.fn(async () => undefined),
    };

    svc = new AppsService(
      appRepo as never,
      routeRepo as never,
      versionRepo as never,
      legacyModuleRepo as never,
      envsService as never,
      configService as never,
      mirror as never,
      registry as never,
      artifacts as never,
      gatewayCache as never,
      taskRecorder as never,
    );
  });

  it('UI 切版本（recordTask）落一条 deploy 任务，元数据带上了模块/环境/版本/操作人', async () => {
    const res: { to: string } = (await svc.switchVersion('portal', 'prod', 'v2', 'alice', undefined, {
      recordTask: true,
    })) as { to: string };

    expect(taskRecorder.record).toHaveBeenCalledTimes(1);
    expect(taskRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'deploy',
        component: 'portal',
        env: 'prod',
        tag: 'v2',
        operator: 'alice',
      }),
      expect.any(Function),
    );
    // 留痕不改变结果：返回值仍是指针切换的结果
    expect(res.to).toBe('v2');
  });

  it('流水线 / 内部脚本入口不传 recordTask → 不落任务（避免与流水线任务重复）', async () => {
    await svc.switchVersion('portal', 'prod', 'v2', 'pipeline-script');
    expect(taskRecorder.record).not.toHaveBeenCalled();
  });

  it('UI 回滚落一条 rollback 任务', async () => {
    await svc.rollback('portal', 'prod', undefined, 'alice', { recordTask: true });
    expect(taskRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rollback', component: 'portal', env: 'prod', operator: 'alice' }),
      expect.any(Function),
    );
  });

  it('回滚目标解析失败 → 任务落 failed 且异常原样抛出（留痕不改变失败语义）', async () => {
    registry.resolveRollbackTarget.mockRejectedValueOnce(new Error('没有可回滚的版本'));
    taskRecorder.record.mockImplementationOnce(
      async (_meta: unknown, fn: (log: (l: string) => void) => Promise<unknown>) => {
        try {
          const result = await fn(() => undefined);
          await taskRecorder.finish('task-1', 'success');
          return { result, taskId: 'task-1' };
        } catch (e) {
          await taskRecorder.finish('task-1', 'failed', (e as Error).message);
          throw e;
        }
      },
    );

    await expect(svc.rollback('portal', 'prod', undefined, 'alice', { recordTask: true })).rejects.toThrow(
      '没有可回滚的版本',
    );
    expect(taskRecorder.finish).toHaveBeenCalledWith('task-1', 'failed', '没有可回滚的版本');
  });
});
