import { BadRequestException } from '@nestjs/common';
import { AppsService } from './apps.service';

/**
 * 磁盘侧用 `EnvArtifactService` 桩替代（落点按环境解析，诊断 #3）：
 * 指针格式本身已由 `entry-pointer.spec.ts` 锁定，这里验证的是
 * **写入顺序 + 落点来源 + 补偿语义**。
 */
describe('AppsService.switchVersion（2026-10-09 收敛，诊断 #1/#5/#3）', () => {
  let appRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let routeRepo: { delete: jest.Mock; save: jest.Mock; find: jest.Mock };
  let versionRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; find: jest.Mock };
  let legacyModuleRepo: { find: jest.Mock };
  let envsService: { getEnv: jest.Mock };
  let configService: { get: jest.Mock };
  let mirror: { mirrorRow: jest.Mock; deleteMirror: jest.Mock };
  let registry: { setAppEnvPointer: jest.Mock; clearAppEnvPointer: jest.Mock };
  let artifacts: {
    hasVersion: jest.Mock;
    listVersions: jest.Mock;
    readPointer: jest.Mock;
    writePointer: jest.Mock;
    describeTarget: jest.Mock;
  };
  let gatewayCache: { notifyVersionChange: jest.Mock };
  let svc: AppsService;

  beforeEach(() => {
    jest.clearAllMocks();

    appRepo = {
      findOne: jest.fn(async () => ({ key: 'portal', deployMode: 'env-dir' })),
      save: jest.fn(async (x: unknown) => x),
      create: jest.fn(() => ({})),
    };
    routeRepo = { delete: jest.fn(), save: jest.fn(), find: jest.fn(async () => []) };
    versionRepo = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (x: unknown) => x),
      create: jest.fn(() => ({})),
      find: jest.fn(async () => []),
    };
    legacyModuleRepo = { find: jest.fn(async () => []) };
    envsService = { getEnv: jest.fn(async () => ({ envId: 'prod' })) };
    configService = { get: jest.fn(() => '/ws') };
    mirror = { mirrorRow: jest.fn(), deleteMirror: jest.fn() };
    gatewayCache = { notifyVersionChange: jest.fn(async () => ({ ok: true, reason: 'notified' })) };
    registry = {
      setAppEnvPointer: jest.fn(async () => ({ from: 'v1', previous: 'v0', unchanged: false })),
      clearAppEnvPointer: jest.fn(async () => undefined),
    };
    artifacts = {
      hasVersion: jest.fn(async () => true),
      listVersions: jest.fn(async () => []),
      readPointer: jest.fn(async () => null),
      writePointer: jest.fn(async () => ({ js: '/ws/x/index.js', css: null })),
      describeTarget: jest.fn(() => '本机 /ws/servers/gateway/public'),
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
      // gateway 缓存通知（诊断 #16）桩：默认不产生网络调用
      gatewayCache as never,
    );
  });

  it('指针走 registry 单一入口，不再自己 save（否则 prod 云库拿不到新指针）', async () => {
    const r = await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(registry.setAppEnvPointer).toHaveBeenCalledWith(
      expect.objectContaining({
        env: 'prod',
        moduleKey: 'portal',
        currentVersion: 'v2',
        deployedBy: 'u1',
      }),
    );
    // 关键断言：本地 versionRepo 不再被直接写
    expect(versionRepo.save).not.toHaveBeenCalled();
    expect(r).toMatchObject({ from: 'v1', to: 'v2' });
  });

  it('顺序：先提交指针表，再写磁盘入口指针', async () => {
    const order: string[] = [];
    registry.setAppEnvPointer.mockImplementation(async () => {
      order.push('db');
      return { from: 'v1', previous: 'v0', unchanged: false };
    });
    artifacts.writePointer.mockImplementation(async () => {
      order.push('disk');
      return { js: '/ws/x/index.js', css: null };
    });
    await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(order).toEqual(['db', 'disk']);
  });

  it('磁盘指针写失败 → 回滚指针表并抛出（禁止「DB 说新版本、磁盘指旧版本」）', async () => {
    artifacts.writePointer.mockImplementation(async () => {
      throw new Error('远端写入口指针失败（root@prod:/data/web_system_static/public）：timeout');
    });
    await expect(svc.switchVersion('portal', 'prod', 'v2', 'u1')).rejects.toThrow(BadRequestException);
    // 补偿：把 current 改回 from、previous 原样带回来
    expect(registry.setAppEnvPointer).toHaveBeenCalledTimes(2);
    expect(registry.setAppEnvPointer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentVersion: 'v1',
        previousVersion: 'v0',
      }),
    );
  });

  it('首次写入（from=null）+ 磁盘失败 → 删行而不是写空指针', async () => {
    registry.setAppEnvPointer.mockResolvedValue({ from: null, previous: null, unchanged: false });
    artifacts.writePointer.mockImplementation(async () => {
      throw new Error('EACCES');
    });
    await expect(svc.switchVersion('portal', 'prod', 'v2', 'u1')).rejects.toThrow(BadRequestException);
    expect(registry.clearAppEnvPointer).toHaveBeenCalledWith('portal', 'prod');
  });

  it('同值切换：不写盘、不重复提交（幂等）', async () => {
    registry.setAppEnvPointer.mockResolvedValue({ from: 'v2', previous: 'v1', unchanged: true });
    const r = await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(r).toMatchObject({ unchanged: true, pointer: null });
    expect(artifacts.writePointer).not.toHaveBeenCalled();
  });

  it('产物目录不存在 → fail-fast，且不动指针表', async () => {
    artifacts.hasVersion.mockResolvedValue(false);
    await expect(svc.switchVersion('portal', 'prod', 'v404', 'u1')).rejects.toThrow(/版本产物不存在/);
    expect(registry.setAppEnvPointer).not.toHaveBeenCalled();
  });

  it('#3：产物校验与写入都按 env 走落点服务（prod 落点不在 console 本机）', async () => {
    await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(artifacts.hasVersion).toHaveBeenCalledWith('prod', 'portal', 'v2');
    expect(artifacts.writePointer).toHaveBeenCalledWith('prod', 'portal', 'v2');
  });

  it('#3：远端静态根不可达 → 抛错且不动指针表（不把「没校验」伪装成「校验通过」）', async () => {
    artifacts.hasVersion.mockRejectedValue(new Error('ssh: connect to host prod port 22: timed out'));
    await expect(svc.switchVersion('portal', 'prod', 'v2', 'u1')).rejects.toThrow(/产物校验失败/);
    expect(registry.setAppEnvPointer).not.toHaveBeenCalled();
  });

  it('site-version（基座 shell）不写 env-dir 磁盘指针', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'shell', deployMode: 'site-version' });
    const r = await svc.switchVersion('shell', 'prod', 'v3', 'u1');
    expect(artifacts.writePointer).not.toHaveBeenCalled();
    expect(r.pointer).toBeNull();
    expect(registry.setAppEnvPointer).toHaveBeenCalled();
  });

  it('锁 owner 默认按 operator 派生（ui: 前缀，排障可见来源）', async () => {
    await svc.switchVersion('portal', 'prod', 'v2', 'pipeline-script');
    expect(registry.setAppEnvPointer).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { owner: 'ui:pipeline-script' } }),
    );
  });

  /**
   * 2026-10-09 回归（本批修复的起因）：
   * 流水线自持锁 owner = run id，激活脚本若按 operator 派生出 `ui:pipeline-script`，
   * 会被流水线自己那把锁判成并发 → 409 → dev 发布恒失败。
   */
  it('显式 lockOwner（流水线 run id）原样透传：与流水线锁同源 = 重入而非并发', async () => {
    await svc.switchVersion('portal', 'dev', 'v2', 'pipeline-script', '1791531699962-3dznagn');
    expect(registry.setAppEnvPointer).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { owner: '1791531699962-3dznagn' } }),
    );
  });

  it('显式 lockOwner 时回滚补偿也用同一 owner（否则补偿写会被外层锁拒绝）', async () => {
    artifacts.writePointer.mockImplementation(async () => {
      throw new Error('EIO');
    });
    await expect(
      svc.switchVersion('portal', 'dev', 'v2', 'pipeline-script', 'run-1'),
    ).rejects.toThrow(BadRequestException);
    expect(registry.setAppEnvPointer).toHaveBeenLastCalledWith(
      expect.objectContaining({ lock: { owner: 'run-1' } }),
    );
  });

  /**
   * 诊断 #16：改指针就必须通知 gateway，否则 gateway 的 versionCache（TTL 10s）
   * 还指着旧版本目录 —— 表现为「发布成功了，页面最多 10s 后才变」。
   * 此前只有 deploy.service 那条路径通知，UI 切换/回滚/internal pointer 全都不通知。
   */
  it('切版本后通知 gateway 失效版本缓存（env-dir 分支）', async () => {
    await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(gatewayCache.notifyVersionChange).toHaveBeenCalledWith(
      expect.objectContaining({ env: 'prod', moduleKey: 'portal', version: 'v2' }),
    );
  });

  it('通知失败不影响发布结果 —— 指针已写成功，不能把成功判成失败', async () => {
    gatewayCache.notifyVersionChange.mockRejectedValueOnce(new Error('gateway 不可达'));
    const r = await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(r.to).toBe('v2');
  });
});
