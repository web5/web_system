import { InternalReleaseController } from './internal-release.controller';

/**
 * 锁 owner 透传（2026-10-09 回归）：
 * 流水线自持 `moduleKey × env` 的锁（owner = run id），发布节点的脚本再调本接口切指针时，
 * 若 owner 按 operator 派生（ui:xxx / script:xxx）就会**被流水线自己的锁判成并发 → 409**。
 * 两条分支（env-dir 走 switchVersion、后端走 registry.setPointer）都必须原样透传。
 */
describe('InternalReleaseController.pointer（锁 owner 透传）', () => {
  let apps: { findAppOrNull: jest.Mock; switchVersion: jest.Mock };
  let registry: { setPointer: jest.Mock };
  let guard: { run: jest.Mock };
  let gatewayCache: { notifyVersionChange: jest.Mock };
  let ctrl: InternalReleaseController;

  beforeEach(() => {
    jest.clearAllMocks();
    apps = {
      findAppOrNull: jest.fn(async () => null),
      switchVersion: jest.fn(async () => ({ from: 'v1', to: 'v2' })),
    };
    registry = { setPointer: jest.fn(async () => undefined) };
    // guard 只做鉴权/限流/审计包装，这里透传执行体
    guard = {
      run: jest.fn(async (_req: unknown, _meta: unknown, fn: () => Promise<unknown>) => fn()),
    };
    gatewayCache = { notifyVersionChange: jest.fn(async () => ({ ok: true, reason: 'notified' })) };
    ctrl = new InternalReleaseController(
      {} as never,
      registry as never,
      apps as never,
      guard as never,
      gatewayCache as never,
    );
  });

  it('env-dir：显式 lockOwner 原样透传给 switchVersion', async () => {
    apps.findAppOrNull.mockResolvedValue({ key: 'portal', deployMode: 'env-dir' });
    await ctrl.pointer(
      {
        moduleKey: 'portal',
        env: 'dev',
        versionTag: 'v2',
        operator: 'pipeline-script',
        lockOwner: '1791533401367-ewt8fgk',
      },
      {} as never,
    );
    expect(apps.switchVersion).toHaveBeenCalledWith(
      'portal',
      'dev',
      'v2',
      'pipeline-script',
      '1791533401367-ewt8fgk',
    );
  });

  it('legacy（后端服务）：显式 lockOwner 透传给 setPointer，缺省才用 script:<operator>', async () => {
    await ctrl.pointer(
      {
        moduleKey: 'deploy-console',
        env: 'dev',
        versionTag: 'v2',
        operator: 'pipeline-script',
        lockOwner: 'run-1',
      },
      {} as never,
    );
    expect(registry.setPointer).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { owner: 'run-1' } }),
    );

    registry.setPointer.mockClear();
    await ctrl.pointer(
      { moduleKey: 'deploy-console', env: 'dev', versionTag: 'v2', operator: 'pipeline-script' },
      {} as never,
    );
    expect(registry.setPointer).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { owner: 'script:pipeline-script' } }),
    );
  });

  it('runId 字段等价透传（兼容脚本两种写法）', async () => {
    await ctrl.pointer(
      {
        moduleKey: 'deploy-console',
        env: 'dev',
        versionTag: 'v2',
        operator: 'pipeline-script',
        runId: 'run-2',
      },
      {} as never,
    );
    expect(registry.setPointer).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { owner: 'run-2' } }),
    );
  });

  /**
   * 诊断 #16：后端服务切指针同样要通知 gateway。
   * 此前只有 deploy.service 那条路径通知 —— 同样是改指针，入口不同行为却不同，
   * 排查时极难定位（表现为「发布成功了，页面最多 10s 后才变」）。
   */
  it('legacy（后端服务）：切指针后也通知 gateway', async () => {
    await ctrl.pointer(
      { moduleKey: 'auth-service', env: 'prod', versionTag: 'v2', operator: 'ops' },
      {} as never,
    );
    expect(gatewayCache.notifyVersionChange).toHaveBeenCalledWith(
      expect.objectContaining({ env: 'prod', moduleKey: 'auth-service', version: 'v2' }),
    );
  });

  it('通知失败不影响切指针结果（legacy 分支）', async () => {
    gatewayCache.notifyVersionChange.mockRejectedValueOnce(new Error('gateway 不可达'));
    const r = await ctrl.pointer(
      { moduleKey: 'auth-service', env: 'prod', versionTag: 'v2', operator: 'ops' },
      {} as never,
    );
    expect(r).toMatchObject({ ok: true, currentVersion: 'v2' });
  });
});
