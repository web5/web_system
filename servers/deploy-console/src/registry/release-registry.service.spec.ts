import { ReleaseRegistryService } from './release-registry.service';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';

describe('ReleaseRegistryService（版本表/指针工具）', () => {
  let versionRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let deploymentRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  // 双写（2026-09-28）：应用域 + 应用×环境版本指针
  let appRepo: { findOne: jest.Mock };
  let appVersionRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let svc: ReleaseRegistryService;

  beforeEach(() => {
    versionRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((d: Partial<DeployVersionEntity>) => ({ ...d })),
      save: jest.fn(async (x: unknown) => x),
    };
    deploymentRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn(() => ({})),
      save: jest.fn(async (x: unknown) => x),
    };
    appRepo = { findOne: jest.fn(async () => null) };
    appVersionRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn(() => ({})),
      save: jest.fn(async (x: unknown) => x),
    };
    svc = new ReleaseRegistryService(
      versionRepo as never,
      deploymentRepo as never,
      appRepo as never,
      appVersionRepo as never,
    );
  });

  it('registerVersion 按字段写入 deploy_versions（含默认状态/时间）', async () => {
    await svc.registerVersion({
      env: 'dev',
      moduleKey: 'admin',
      versionTag: 'abc1234',
      gitCommit: 'abc1234',
      gitBranch: 'master',
      releasedBy: 'admin',
      taskId: 't-1',
      note: '流水线发布',
    });
    const saved = versionRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      env: 'dev',
      component: 'admin',
      versionTag: 'abc1234',
      gitCommit: 'abc1234',
      gitBranch: 'master',
      releasedBy: 'admin',
      taskId: 't-1',
      note: '流水线发布',
      status: 'active',
    });
    expect(saved.releasedAt).toBeInstanceOf(Date);
  });

  it('setPointer 无记录时新建（upsert）', async () => {
    await svc.setPointer({ env: 'dev', moduleKey: 'admin', currentVersion: 'abc', deployedBy: 'op', taskId: 't-1' });
    expect(deploymentRepo.findOne).toHaveBeenCalledWith({ where: { envId: 'dev', moduleKey: 'admin' } });
    expect(deploymentRepo.create).toHaveBeenCalled();
    const saved = deploymentRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      envId: 'dev',
      moduleKey: 'admin',
      currentVersion: 'abc',
      status: 'deployed',
      deployedBy: 'op',
      taskId: 't-1',
    });
    expect(saved.deployedAt).toBeInstanceOf(Date);
  });

  it('setPointer 已有记录时更新不重建', async () => {
    const existing = { envId: 'dev', moduleKey: 'admin', currentVersion: 'old' };
    deploymentRepo.findOne.mockResolvedValue(existing);
    await svc.setPointer({ env: 'dev', moduleKey: 'admin', currentVersion: 'new', taskId: 't-2' });
    expect(deploymentRepo.create).not.toHaveBeenCalled();
    expect(existing).toMatchObject({ currentVersion: 'new', status: 'deployed', taskId: 't-2' });
  });

  it('currentVersion 返回指针版本', async () => {
    deploymentRepo.findOne.mockResolvedValue({ currentVersion: 'abc' });
    expect(await svc.currentVersion('dev', 'admin')).toBe('abc');
    deploymentRepo.findOne.mockResolvedValue(null);
    expect(await svc.currentVersion('dev', 'admin')).toBeUndefined();
  });

  it('setPointer 双写：env-dir 应用同步写 deploy_app_env_versions', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    await svc.setPointer({ env: 'prod', moduleKey: 'portal', currentVersion: 'v2', deployedBy: 'op' });
    // legacy 照旧写
    expect(deploymentRepo.save).toHaveBeenCalled();
    // 新模型也写，且 previousVersion 留空（首次）
    const saved = appVersionRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({ appKey: 'portal', envId: 'prod', currentVersion: 'v2', status: 'deployed' });
  });

  it('setPointer 双写：已有指针时把旧版本存为 previousVersion', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'admin', deployMode: 'env-dir' });
    appVersionRepo.findOne.mockResolvedValue({ appKey: 'admin', envId: 'prod', currentVersion: 'v1' });
    await svc.setPointer({ env: 'prod', moduleKey: 'admin', currentVersion: 'v2' });
    const saved = appVersionRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({ currentVersion: 'v2', previousVersion: 'v1' });
  });

  it('setPointer 双写：后端服务 / site-version 应用不写新表', async () => {
    // 未登记（后端服务在新模型无载体）
    appRepo.findOne.mockResolvedValue(null);
    await svc.setPointer({ env: 'prod', moduleKey: 'auth-service', currentVersion: 'v9' });
    expect(appVersionRepo.save).not.toHaveBeenCalled();

    // shell 走 site-version，不纳入 env 切换
    appRepo.findOne.mockResolvedValue({ key: 'shell', deployMode: 'site-version' });
    await svc.setPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v9' });
    expect(appVersionRepo.save).not.toHaveBeenCalled();
    // 但 legacy 两处都写了（后端发布仍依赖它）
    expect(deploymentRepo.save).toHaveBeenCalledTimes(2);
  });

  it('setPointer 双写：新表写失败只告警，不阻断发布', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.save.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.setPointer({ env: 'prod', moduleKey: 'portal', currentVersion: 'v3' }),
    ).resolves.toBeUndefined();
    expect(deploymentRepo.save).toHaveBeenCalled();
  });

  it('findByVersionTag 按标签查版本记录；无记录 → undefined', async () => {
    const found = { versionTag: 'abc', gitCommit: 'abc' };
    versionRepo.findOne.mockResolvedValue(found);
    expect(await svc.findByVersionTag('abc')).toBe(found);
    versionRepo.findOne.mockResolvedValue(null);
    expect(await svc.findByVersionTag('nope')).toBeUndefined();
  });
});
