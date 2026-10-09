import { ConflictException } from '@nestjs/common';
import { ReleaseRegistryService } from './release-registry.service';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';

describe('ReleaseRegistryService（版本表/指针工具）', () => {
  let versionRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let deploymentRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  // 双写（2026-09-28）：应用域 + 应用×环境版本指针
  let appRepo: { findOne: jest.Mock };
  let appVersionRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; remove: jest.Mock };
  // 按环境分流（2026-10-08）：prod 指针镜像写云库
  let splitWriter: {
    mirrorPointer: jest.Mock;
    mirrorLegacyPointer: jest.Mock;
    deleteMirror: jest.Mock;
  };
  /** 发布锁（诊断 #6）：默认抢得到 */
  let locks: { acquireEx: jest.Mock; release: jest.Mock };
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
      remove: jest.fn(async (x: unknown) => x),
    };
    splitWriter = {
      mirrorPointer: jest.fn(async () => ({ outcome: 'skipped' })),
      mirrorLegacyPointer: jest.fn(async () => ({ outcome: 'skipped' })),
      deleteMirror: jest.fn(),
    };
    locks = {
      acquireEx: jest.fn(async () => ({ ok: true, newly: true })),
      release: jest.fn(async () => undefined),
    };
    svc = new ReleaseRegistryService(
      versionRepo as never,
      deploymentRepo as never,
      appRepo as never,
      appVersionRepo as never,
      splitWriter as never,
      locks as never,
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

  // ==================== setAppEnvPointer（2026-10-09 收敛，诊断 #1） ====================
  // 背景：UI 切换/回滚、UI 部署、流水线 internal/release/pointer 三条路都走 AppsService.switchVersion，
  // 而它原先自己 versionRepo.save() 且**从不写云库** → prod「切换成功但线上没变」且不报错。

  it('setAppEnvPointer：走 registry 单一入口，prod 必须镜像云库', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.findOne.mockResolvedValue({
      appKey: 'portal',
      envId: 'prod',
      currentVersion: 'v1',
      previousVersion: 'v0',
    });
    const r = await svc.setAppEnvPointer({
      env: 'prod',
      moduleKey: 'portal',
      currentVersion: 'v2',
      deployedBy: 'u1',
    });
    expect(r).toEqual({ from: 'v1', previous: 'v0', unchanged: false });
    expect(appVersionRepo.save).toHaveBeenCalled();
    expect(splitWriter.mirrorPointer).toHaveBeenCalledWith(
      expect.objectContaining({ env: 'prod', moduleKey: 'portal', currentVersion: 'v2' }),
    );
  });

  it('setAppEnvPointer：同值幂等 → 不写库也不镜像（避免两库 deployed_at 漂移）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.findOne.mockResolvedValue({
      appKey: 'portal',
      envId: 'prod',
      currentVersion: 'v1',
    });
    const r = await svc.setAppEnvPointer({
      env: 'prod',
      moduleKey: 'portal',
      currentVersion: 'v1',
    });
    expect(r.unchanged).toBe(true);
    expect(appVersionRepo.save).not.toHaveBeenCalled();
    expect(splitWriter.mirrorPointer).not.toHaveBeenCalled();
  });

  it('setAppEnvPointer：prod 云库写失败 → 抛出（不留「以为切了其实没切」）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    splitWriter.mirrorPointer.mockRejectedValueOnce(new Error('云库公网不通'));
    await expect(
      svc.setAppEnvPointer({ env: 'prod', moduleKey: 'portal', currentVersion: 'v2' }),
    ).rejects.toThrow(/云库公网不通/);
  });

  it('setAppEnvPointer：应用未登记于 deploy_apps → 抛 404（不静默空转）', async () => {
    appRepo.findOne.mockResolvedValue(null);
    await expect(
      svc.setAppEnvPointer({ env: 'prod', moduleKey: 'ghost', currentVersion: 'v2' }),
    ).rejects.toThrow(/未登记/);
  });

  it('setAppEnvPointer：previousVersion 显式传入时原样落库（回滚补偿用）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.findOne.mockResolvedValue({
      appKey: 'portal',
      envId: 'prod',
      currentVersion: 'v2',
      previousVersion: 'v9',
    });
    await svc.setAppEnvPointer({
      env: 'prod',
      moduleKey: 'portal',
      currentVersion: 'v1',
      previousVersion: 'v0',
    });
    const saved = appVersionRepo.save.mock.calls[0][0];
    // 补偿要把旧值带回来，不能让 previous 指向那个没生效的失败目标
    expect(saved).toMatchObject({ currentVersion: 'v1', previousVersion: 'v0' });
  });

  it('clearAppEnvPointer：本地删行 + 云库删除补偿（首次写入回滚用）', async () => {
    const row = { appKey: 'portal', envId: 'prod', currentVersion: 'v1' };
    appVersionRepo.findOne.mockResolvedValue(row);
    await svc.clearAppEnvPointer('portal', 'prod');
    expect(appVersionRepo.remove).toHaveBeenCalled();
    expect(splitWriter.deleteMirror).toHaveBeenCalledWith('deploy_app_env_versions', {
      app_key: 'portal',
      env_id: 'prod',
    });
  });

  it('findByVersionTag 按标签查版本记录；无记录 → undefined', async () => {
    const found = { versionTag: 'abc', gitCommit: 'abc' };
    versionRepo.findOne.mockResolvedValue(found);
    expect(await svc.findByVersionTag('abc')).toBe(found);
    versionRepo.findOne.mockResolvedValue(null);
    expect(await svc.findByVersionTag('nope')).toBeUndefined();
  });

  // ── 诊断 #6：非流水线入口的锁 + CAS ──

  it('#6：传 lock → 申请锁并在写完后释放（本次新拿到）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    await svc.setAppEnvPointer({
      env: 'prod',
      moduleKey: 'portal',
      currentVersion: 'v2',
      lock: { owner: 'ui:alice' },
    });
    expect(locks.acquireEx).toHaveBeenCalledWith('portal', 'prod', 'ui:alice', undefined);
    expect(locks.release).toHaveBeenCalledWith('portal', 'prod', 'ui:alice');
  });

  it('#6：重入（newly=false）→ 不释放锁（那是外层流水线还在用的）', async () => {
    locks.acquireEx.mockResolvedValue({ ok: true, newly: false });
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    await svc.setAppEnvPointer({
      env: 'prod',
      moduleKey: 'portal',
      currentVersion: 'v2',
      lock: { owner: 'pipeline-1' },
    });
    expect(locks.release).not.toHaveBeenCalled();
  });

  it('#6：锁被他人持有 → 409 且不写库（禁止交叉覆盖）', async () => {
    locks.acquireEx.mockResolvedValue({ ok: false, newly: false, holder: 'pipeline-9' });
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    await expect(
      svc.setAppEnvPointer({
        env: 'prod',
        moduleKey: 'portal',
        currentVersion: 'v2',
        lock: { owner: 'ui:alice' },
      }),
    ).rejects.toThrow(ConflictException);
    expect(appVersionRepo.save).not.toHaveBeenCalled();
  });

  it('#6：不传 lock → 完全不碰锁（流水线自带锁，向后兼容）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    await svc.setAppEnvPointer({ env: 'prod', moduleKey: 'portal', currentVersion: 'v2' });
    expect(locks.acquireEx).not.toHaveBeenCalled();
    expect(locks.release).not.toHaveBeenCalled();
  });

  it('#6：CAS 不符（页面显示 v1、实际已是 v2）→ 409 且不写库', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.findOne.mockResolvedValue({
      appKey: 'portal',
      envId: 'prod',
      currentVersion: 'v2',
      previousVersion: 'v1',
    });
    await expect(
      svc.setAppEnvPointer({
        env: 'prod',
        moduleKey: 'portal',
        currentVersion: 'v3',
        expectedFrom: 'v1',
      }),
    ).rejects.toThrow(/版本已被并发修改/);
    expect(appVersionRepo.save).not.toHaveBeenCalled();
    expect(splitWriter.mirrorPointer).not.toHaveBeenCalled();
  });

  it('#6：CAS 相符 → 正常推进（previous 记为真实旧值）', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    appVersionRepo.findOne.mockResolvedValue({
      appKey: 'portal',
      envId: 'prod',
      currentVersion: 'v2',
      previousVersion: 'v1',
    });
    const r = await svc.setAppEnvPointer({
      env: 'prod',
      moduleKey: 'portal',
      currentVersion: 'v3',
      expectedFrom: 'v2',
    });
    expect(r).toMatchObject({ from: 'v2', unchanged: false });
    expect(appVersionRepo.save.mock.calls[0][0]).toMatchObject({
      currentVersion: 'v3',
      previousVersion: 'v2',
    });
  });

  it('#6：setPointer 带锁 → 锁覆盖「legacy + 镜像 + 新表」整段，且只申请一次', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    await svc.setPointer({
      env: 'prod',
      moduleKey: 'portal',
      currentVersion: 'v2',
      lock: { owner: 'deploy:portal' },
    });
    // 内嵌的 syncAppEnvPointer 走 inner，不再重复申请
    expect(locks.acquireEx).toHaveBeenCalledTimes(1);
    expect(splitWriter.mirrorLegacyPointer).toHaveBeenCalled();
    expect(appVersionRepo.save).toHaveBeenCalled();
  });
});
