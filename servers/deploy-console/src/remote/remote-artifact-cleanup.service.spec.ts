import { RemoteArtifactCleanupService, isSafeVersionName, planRetain } from './remote-artifact-cleanup.service';

const DAY = 24 * 60 * 60 * 1000;

describe('planRetain（远端保留策略，纯函数）', () => {
  const now = 1_700_000_000_000;

  it('保留最近 keep 个（按 mtime 倒序）', () => {
    const r = planRetain(
      [
        { name: 'old1', mtime: now - 5 * DAY },
        { name: 'old2', mtime: now - 4 * DAY },
        { name: 'v3', mtime: now - 3 * DAY },
        { name: 'v4', mtime: now },
      ],
      { keep: 2, minAgeMs: 0, now },
    );
    expect(r.keep).toEqual(['v4', 'v3']);
    // remove 也按 mtime 倒序（与 keep 同一排序，便于日志里看清「从旧到新删了哪些」）
    expect(r.remove).toEqual(['old2', 'old1']);
  });

  it('受保护版本即使最旧也保留', () => {
    const r = planRetain(
      [
        { name: 'cur', mtime: now - 30 * DAY },
        { name: 'v2', mtime: now },
      ],
      { keep: 1, protectedVersions: new Set(['cur']), minAgeMs: 0, now },
    );
    expect(r.keep).toContain('cur');
    expect(r.remove).not.toContain('cur');
  });

  it('未满 minAge 的一律保留（防用户开着旧页面被清掉产物）', () => {
    const r = planRetain(
      [
        { name: 'a', mtime: now - 60 * 60 * 1000 }, // 1h 前
        { name: 'b', mtime: now - 2 * 60 * 60 * 1000 }, // 2h 前
      ],
      { keep: 1, minAgeMs: DAY, now },
    );
    // b 虽然不在 keep(1) 内，但未满 24h → 保留
    expect(r.remove).toEqual([]);
    expect(r.keep).toEqual(['a', 'b']);
  });

  it('超过 minAge 且不在 keep 内 → 删除', () => {
    const r = planRetain(
      [
        { name: 'recent', mtime: now - 60 * 1000 },
        { name: 'v2', mtime: now - 3 * DAY },
      ],
      { keep: 1, minAgeMs: DAY, now },
    );
    expect(r.keep).toEqual(['recent']);
    expect(r.remove).toEqual(['v2']);
  });

  it('minAge=0 时只按数量保留', () => {
    const r = planRetain(
      [
        { name: 'a', mtime: now - 60 * 1000 },
        { name: 'b', mtime: now - 2 * 60 * 1000 },
      ],
      { keep: 1, minAgeMs: 0, now },
    );
    expect(r.remove).toEqual(['b']);
  });

  it('空列表 → 空计划', () => {
    expect(planRetain([], {})).toEqual({ keep: [], remove: [] });
  });
});

describe('isSafeVersionName（远端删除前的形态闸）', () => {
  it('放行 commit 短/长哈希与 vX.Y.Z', () => {
    expect(isSafeVersionName('cdb055bc')).toBe(true);
    expect(isSafeVersionName('6e7b2690a1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe(true);
    expect(isSafeVersionName('v1.2.3')).toBe(true);
    expect(isSafeVersionName('v1.2.3-rc.1')).toBe(true);
  });

  it('拦截路径穿越 / 绝对路径 / 当前生效目录', () => {
    for (const bad of ['..', '.', 'dist', '/data', 'a/b', 'a\\b', '', 'prod', 'index.js']) {
      expect(isSafeVersionName(bad)).toBe(false);
    }
  });
});

describe('RemoteArtifactCleanupService', () => {
  function makeSvc(cfg: Record<string, string>, sshOut: string | Error, run = jest.fn()) {
    const config = { get: (k: string) => cfg[k] } as never;
    const ssh = { run } as never;
    run.mockImplementation(async () => {
      if (sshOut instanceof Error) throw sshOut;
      return sshOut;
    });
    const svc = new RemoteArtifactCleanupService(config, ssh);
    return { svc, run };
  }

  const cfg = {
    STATIC_PUBLIC_ROOT_PROD: '/data/web_system_static/public',
    STATIC_SSH_TARGET_PROD: 'root@10.0.0.2',
  };

  it('scan：解析远端 stat 输出为条目（秒 → 毫秒）', async () => {
    const { svc, run } = makeSvc(cfg, '1700000000\tabc1234\n1699000000\tdef5678\n');
    const entries = await svc.scan('prod', 'portal');
    expect(entries).toEqual([
      { name: 'abc1234', mtime: 1_700_000_000_000 },
      { name: 'def5678', mtime: 1_699_000_000_000 },
    ]);
    expect(String(run.mock.calls[0][1])).toContain('/data/web_system_static/public/static/modules/portal/prod');
  });

  it('scan：未配 ssh 目标（本机）→ 不扫远端，返回空', async () => {
    const { svc, run } = makeSvc({ STATIC_PUBLIC_ROOT_DEV: '/local' }, '');
    expect(await svc.scan('dev', 'portal')).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('cleanup：默认只观测（未开 REMOTE_CLEANUP_ENABLED）→ applied=false 且不发删除命令', async () => {
    const { svc, run } = makeSvc(cfg, '1700000000\tabc1234\n1600000000\t0011223\n');
    const r = await svc.cleanup('prod', 'portal', { keep: 1 });
    expect(r.applied).toBe(false);
    expect(r.reason).toContain('未开启');
    expect(r.scanned).toBe(2);
    expect(r.remove).toEqual(['0011223']);
    // 只调用过一次（scan），没有第二次（删除）
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cleanup：开启后只删形态安全的目录，且命令里带守卫', async () => {
    const { svc, run } = makeSvc({ ...cfg, REMOTE_CLEANUP_ENABLED: 'true' }, '1700000000\tabc1234\n1600000000\t0011223\n');
    const r = await svc.cleanup('prod', 'portal', { keep: 1 });
    expect(r.applied).toBe(true);
    expect(r.remove).toEqual(['0011223']);
    const delCmd = String(run.mock.calls[1][1]);
    expect(delCmd).toContain("rm -rf -- '0011223'");
    expect(delCmd).toContain("!= dist");
  });

  it('cleanup：形态异常的目录名被剔除（防误删 dist / 路径穿越）', async () => {
    const { svc, run } = makeSvc({ ...cfg, REMOTE_CLEANUP_ENABLED: 'true' }, '1500000000\tdist\n1400000000\t..\n');
    const r = await svc.cleanup('prod', 'portal', { keep: 0, protectedVersions: new Set() });
    expect(r.remove).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1); // 只有 scan
  });

  it('cleanup：扫描失败不阻断（清理是维护性动作）', async () => {
    const { svc } = makeSvc(cfg, new Error('SSH 连接失败'));
    const r = await svc.cleanup('prod', 'portal');
    expect(r.applied).toBe(false);
    expect(r.reason).toContain('scan-failed');
  });

  it('cleanup：受保护版本不进删除列表', async () => {
    const { svc } = makeSvc(cfg, '1700000000\tabc1234\n1600000000\t0011223\n');
    const r = await svc.cleanup('prod', 'portal', { keep: 1, protectedVersions: new Set(['0011223']) });
    expect(r.remove).toEqual([]);
    expect(r.keep).toContain('0011223');
  });
});
