import { DeployService } from './deploy.service';
import { DeployTaskEntity } from '../entities/deploy-task.entity';

describe('DeployService 模块级回滚边界', () => {
  const rows = new Map<string, Partial<DeployTaskEntity>>();
  const taskRepo = {
    save: jest.fn(async (row: Partial<DeployTaskEntity> & { id: string }) => {
      rows.set(row.id, row);
      return row;
    }),
    update: jest.fn(async (id: string, partial: Partial<DeployTaskEntity>) => {
      rows.set(id, { ...rows.get(id), ...partial });
    }),
    findOne: jest.fn(async (input: { where: { id: string } }) => rows.get(input.where.id)),
  };
  const versions = { save: jest.fn() };
  const deployments = { upsert: jest.fn() };
  const apps = { findAppOrNull: jest.fn(), switchVersion: jest.fn() };
  const registry = { resolveRollbackTarget: jest.fn() };
  let service: DeployService;
  let legacyScript: jest.SpyInstance;

  beforeEach(() => {
    rows.clear();
    jest.clearAllMocks();
    apps.findAppOrNull.mockResolvedValue({ key: 'admin', deployMode: 'env-dir' });
    apps.switchVersion.mockResolvedValue({ from: 'versionA', to: 'versionB' });
    registry.resolveRollbackTarget.mockResolvedValue({ from: 'versionA', to: 'versionB', source: 'explicit' });
    service = new DeployService(
      { get: jest.fn() } as never, taskRepo as never, versions as never, deployments as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, apps as never, {} as never, {} as never, registry as never,
      {} as never, {} as never,
    );
    legacyScript = jest.spyOn(service as unknown as {
      executeRollbackScript: (...args: unknown[]) => Promise<void>;
    }, 'executeRollbackScript').mockResolvedValue(undefined);
  });

  const settle = () => new Promise<void>(resolve => setImmediate(resolve));

  it('指定模块时复用统一回滚，不调用整站脚本或重复写指针', async () => {
    const taskId = await service.startRollback('dev', 'versionB', 'operator-1', 'admin');
    await settle();
    expect(legacyScript).not.toHaveBeenCalled();
    expect(registry.resolveRollbackTarget).toHaveBeenCalledWith({ env: 'dev', moduleKey: 'admin', to: 'versionB' });
    expect(apps.switchVersion).toHaveBeenCalledWith('admin', 'dev', 'versionB', 'operator-1');
    await expect(service.getTask(taskId)).resolves.toMatchObject({
      type: 'rollback', component: 'admin', status: 'success', operator: 'operator-1',
    });
    await expect(service.waitTask(taskId, 100)).resolves.toBe('success');
    expect(versions.save).not.toHaveBeenCalled();
    expect(deployments.upsert).not.toHaveBeenCalled();
  });

  it('模块回滚失败必须落 failed，不能降级整站恢复', async () => {
    apps.switchVersion.mockRejectedValueOnce(new Error('artifact missing'));
    const taskId = await service.startRollback('dev', 'versionB', 'operator-1', 'admin');
    await settle();
    expect(legacyScript).not.toHaveBeenCalled();
    await expect(service.getTask(taskId)).resolves.toMatchObject({ status: 'failed', error: 'artifact missing' });
    await expect(service.waitTask(taskId, 100)).resolves.toBe('failed');
    expect(versions.save).not.toHaveBeenCalled();
    expect(deployments.upsert).not.toHaveBeenCalled();
  });

  it('后端模块也只调用模块级后端恢复', async () => {
    apps.findAppOrNull.mockResolvedValueOnce(null);
    const rollback = jest.spyOn(service, 'rollbackVersion').mockResolvedValue({
      moduleKey: 'todo-service', env: 'dev', from: 'versionA', to: 'versionB',
    });
    const taskId = await service.startRollback('dev', 'versionB', 'operator-1', 'todo-service');
    await settle();
    expect(rollback).toHaveBeenCalledWith({ moduleKey: 'todo-service', env: 'dev', to: 'versionB', operator: 'operator-1', taskId });
    expect(legacyScript).not.toHaveBeenCalled();
    await expect(service.getTask(taskId)).resolves.toMatchObject({ component: 'todo-service', status: 'success' });
  });

  it('shell/site-version 回滚复用应用版本切换，不走 legacy 后端恢复', async () => {
    apps.findAppOrNull.mockResolvedValueOnce({ key: 'shell', kind: 'shell', deployMode: 'site-version' });
    const fallback = jest.spyOn(service, 'rollbackVersion');
    const taskId = await service.startRollback('dev', 'versionB', 'operator-1', 'shell');
    await settle();
    expect(apps.switchVersion).toHaveBeenCalledWith('shell', 'dev', 'versionB', 'operator-1');
    expect(fallback).not.toHaveBeenCalled();
    expect(legacyScript).not.toHaveBeenCalled();
    await expect(service.getTask(taskId)).resolves.toMatchObject({ component: 'shell', status: 'success' });
  });

  it('未指定 component 的旧整站调用保持独立，不偷偷推断模块', async () => {
    const taskId = await service.startRollback('dev', 'snapshot-tag', 'legacy-operator');
    expect(legacyScript).toHaveBeenCalledTimes(1);
    await expect(service.getTask(taskId)).resolves.toMatchObject({ component: 'system' });
    expect(apps.switchVersion).not.toHaveBeenCalled();
  });

  it('模块操作尚未完成时，任务不能提前报告 success', async () => {
    let complete!: (result: { from: string; to: string }) => void;
    apps.switchVersion.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const taskId = await service.startRollback('dev', 'versionB', 'operator-1', 'admin');
    await settle();
    await expect(service.getTask(taskId)).resolves.toMatchObject({ status: 'running' });
    expect(rows.get(taskId)?.endTime).toBeUndefined();
    complete({ from: 'versionA', to: 'versionB' });
    await settle();
    await expect(service.getTask(taskId)).resolves.toMatchObject({ status: 'success' });
    expect(rows.get(taskId)?.endTime).toEqual(expect.any(Number));
  });

  it('显式空模块不能退回旧整站路径', async () => {
    await expect(service.startRollback('dev', 'versionB', 'operator-1', ' ')).rejects.toThrow(/component/);
    expect(taskRepo.save).not.toHaveBeenCalled();
    expect(legacyScript).not.toHaveBeenCalled();
  });
});
