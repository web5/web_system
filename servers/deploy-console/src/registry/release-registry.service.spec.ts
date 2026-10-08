import { ReleaseRegistryService } from './release-registry.service';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';

describe('ReleaseRegistryService（版本表/指针工具）', () => {
  let versionRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let deploymentRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  // 双写（2026-09-28）：应用域 + 应用×环境版本指针
  let appRepo: { findOne: jest.Mock };
  let appVersionRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  // 按环境分流（2026-10-08）：prod 指针镜像写云库
  let splitWriter: { mirrorPointer: jest.Mock; mirrorLegacyPointer: jest.Mock };
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
    splitWriter = {
      mirrorPointer: jest.fn(async () => ({ outcome: 'skipped' })),
      mirrorLegacyPointer: jest.fn(async () => ({ outcome: 'skipped' })),
    };
    svc = new ReleaseRegistryService(
      versionRepo as never,
      deploymentRepo as never,
      appRepo as never,
      appVersionRepo as never,
      splitWriter as never,
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

  it('setPointer 双写：site-version（基座 shell）也写新表（gateway 停用 legacy 后读它）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'shell', deployMode: 'site-version' });
    await svc.setPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v9' });
    const saved = appVersionRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({ appKey: 'shell', envId: 'prod', currentVersion: 'v9' });
    expect(deploymentRepo.save).toHaveBeenCalled();
  });

  it('setPointer 双写：后端服务（未登记到 deploy_apps）只写 legacy', async () => {
    appRepo.findOne.mockResolvedValue(null);
    await svc.setPointer({ env: 'prod', moduleKey: 'auth-service', currentVersion: 'v9' });
    expect(appVersionRepo.save).not.toHaveBeenCalled();
    expect(deploymentRepo.save).toHaveBeenCalled();
  });

  it('setPointer 双写：新表写失败只告警，不阻断发布', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.save.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.setPointer({ env: 'prod', moduleKey: 'portal', currentVersion: 'v3' }),
    ).resolves.toBeUndefined();
    expect(deploymentRepo.save).toHaveBeenCalled();
  });

  // ==================== 按环境分流（2026-10-08，design.md §6） ====================

  it('分流：本地写成功后调用云库镜像（prod 指针由 writer 决定是否落云库）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'shell', deployMode: 'site-version' });
    await svc.setPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v9', taskId: 't-9' });
    expect(splitWriter.mirrorPointer).toHaveBeenCalledWith(
      expect.objectContaining({ env: 'prod', moduleKey: 'shell', currentVersion: 'v9', taskId: 't-9' }),
    );
    // legacy 指针也镜像（应急读取源）
    expect(splitWriter.mirrorLegacyPointer).toHaveBeenCalled();
  });

  it('分流：本地写失败时**不**镜像（没有可信数据可同步）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.save.mockRejectedValueOnce(new Error('db down'));
    await svc.setPointer({ env: 'prod', moduleKey: 'portal', currentVersion: 'v3' });
    expect(splitWriter.mirrorPointer).not.toHaveBeenCalled();
  });

  it('分流：本地成功但云库镜像失败 → 抛出（禁止「显示成功、prod 没切」）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'shell', deployMode: 'site-version' });
    splitWriter.mirrorPointer.mockRejectedValueOnce(new Error('云库公网不通'));
    await expect(
      svc.setPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v9' }),
    ).rejects.toThrow(/云库公网不通/);
    // 本地已写成功（回滚目标仍在），错误必须上抛让任务失败
    expect(appVersionRepo.save).toHaveBeenCalled();
  });

  it('分流：后端服务（未登记应用）本地不写新表 → 也不镜像指针', async () => {
    appRepo.findOne.mockResolvedValue(null);
    await svc.setPointer({ env: 'prod', moduleKey: 'auth-service', currentVersion: 'v9' });
    expect(splitWriter.mirrorPointer).not.toHaveBeenCalled();
    // legacy 是后端服务唯一指针，仍需镜像
    expect(splitWriter.mirrorLegacyPointer).toHaveBeenCalled();
  });

  it('findByVersionTag 按标签查版本记录；无记录 → undefined', async () => {
    const found = { versionTag: 'abc', gitCommit: 'abc' };
    versionRepo.findOne.mockResolvedValue(found);
    expect(await svc.findByVersionTag('abc')).toBe(found);
    versionRepo.findOne.mockResolvedValue(null);
    expect(await svc.findByVersionTag('nope')).toBeUndefined();
  });
});
