import { RemoteCleanupWatchService } from './remote-cleanup-watch.service';

/**
 * 远端产物清理定时化（诊断 #10 遗留④）。
 *
 * 这里最该锁的是**默认行为**：定时 + 删除，一旦默认开就是无人值守地删线上文件。
 * 所以必须「间隔不配 = 关闭」，且真删还要过 `REMOTE_CLEANUP_ENABLED` 第二道开关。
 */
describe('RemoteCleanupWatchService（定时清理）', () => {
  let query: jest.Mock;
  let cleanup: { cleanup: jest.Mock };
  let svc: RemoteCleanupWatchService;

  const makeSvc = (cfg: Record<string, string | undefined>) =>
    new RemoteCleanupWatchService(
      { get: (k: string) => cfg[k] } as never,
      cleanup as never,
      { query } as never,
    );

  beforeEach(() => {
    query = jest.fn(async () => []);
    cleanup = { cleanup: jest.fn(async () => ({ dir: '/x', applied: false, scanned: 0, keep: [], remove: [] })) };
  });

  it('待清理目标取自指针表（发过版的地方才可能有堆积）', async () => {
    query.mockResolvedValue([
      { app_key: 'portal', env_id: 'prod', current_version: 'v3', previous_version: 'v2' },
      { app_key: 'admin', env_id: 'dev', current_version: 'v1', previous_version: null },
    ]);
    svc = makeSvc({});
    const t = await svc.targets();
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({
      env: 'prod',
      moduleKey: 'portal',
      protectedVersions: new Set(['v3', 'v2']),
    });
    // previous 为空时不能把 null 塞进保护集合
    expect([...(await svc.targets())][1].protectedVersions).toEqual(new Set(['v1']));
  });

  it('当前版本与上一版本都进保护名单（删掉它们 = 回滚入口直接少一项）', async () => {
    query.mockResolvedValue([
      { app_key: 'portal', env_id: 'prod', current_version: 'v3', previous_version: 'v2' },
    ]);
    svc = makeSvc({});
    const r = await svc.run();
    expect(r.scannedTargets).toBe(1);
    expect(cleanup.cleanup).toHaveBeenCalledWith(
      'prod',
      'portal',
      expect.objectContaining({
        envId: 'prod',
        protectedVersions: expect.objectContaining({ size: 2 }),
      }),
    );
  });

  it('单个目标失败不影响其他目标（清理是维护性动作，不该拖垮整轮）', async () => {
    query.mockResolvedValue([
      { app_key: 'a', env_id: 'dev', current_version: 'v1', previous_version: null },
      { app_key: 'b', env_id: 'dev', current_version: 'v1', previous_version: null },
    ]);
    cleanup.cleanup
      .mockRejectedValueOnce(new Error('ssh 不通'))
      .mockResolvedValueOnce({ dir: '/x', applied: false, scanned: 3, keep: [], remove: [] });
    svc = makeSvc({});
    const r = await svc.run();
    expect(r.scannedTargets).toBe(2);
    expect(r.results).toHaveLength(1);
  });
});
