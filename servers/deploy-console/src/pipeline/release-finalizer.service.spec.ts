import { ReleaseFinalizerService } from './release-finalizer.service';
import {
  ManifestGateError,
  manifestMatches,
  manifestVersionOf,
} from './release-final-guard';

type Any = never;

/**
 * 发布收尾器单测（半发布治理 F1-②/③）。
 *
 * 变异思维：旧行为（编排收尾直连 setPointer / 无 manifest 门禁）下，
 * 「盘新表旧」或「manifest 滞后」都能蒙混成全绿 —— 以下用例逐条封死。
 */
function makeSvc(opts: {
  app?: { key: string; deployMode: string } | null;
  gatewayUrl?: string;
  manifestSequence?: Array<Record<string, unknown> | null>;
}) {
  const registry = { setPointer: jest.fn(async () => undefined) };
  const apps = {
    findAppOrNull: jest.fn(async () => opts.app ?? null),
    switchVersion: jest.fn(async () => ({ from: 'old0', to: 'abc1234', unchanged: false })),
  };
  const gatewayCache = { urlFor: jest.fn(() => opts.gatewayUrl ?? '') };
  const seq = [...(opts.manifestSequence ?? [])];
  const probe = {
    fetchGatewayManifest: jest.fn(async () => (seq.length ? seq.shift()! : null)),
  };
  const svc = new ReleaseFinalizerService(
    registry as Any,
    apps as Any,
    gatewayCache as Any,
    probe as Any,
  );
  return { svc, registry, apps, gatewayCache, probe };
}

const base = { id: 'run-1', env: 'prod', moduleKey: 'portal', versionTag: 'portal/abc1234', operator: 'ops' };
const manifestOk = { byEnv: { prod: { portal: { version: 'abc1234' } } } };

describe('release-final-guard 纯规则层', () => {
  it('manifestVersionOf：byEnv 优先，回落 modules[] 兼容字段', () => {
    expect(manifestVersionOf(manifestOk, 'prod', 'portal')).toBe('abc1234');
    expect(manifestVersionOf({ modules: [{ name: 'portal', version: 'def5678' }] }, 'prod', 'portal')).toBe('def5678');
    expect(manifestVersionOf({ byEnv: { prod: {} } }, 'prod', 'portal')).toBe(null);
    expect(manifestVersionOf(null, 'prod', 'portal')).toBe(null);
  });

  it('manifestMatches：双侧 toCommitId 归一（<ns>/<commit> vs 纯 commit 不误判）', () => {
    expect(manifestMatches(manifestOk, 'prod', 'portal', 'portal/abc1234')).toBe(true);
    expect(manifestMatches({ byEnv: { prod: { portal: { version: 'portal/abc1234' } } } }, 'prod', 'portal', 'abc1234')).toBe(true);
    expect(manifestMatches(manifestOk, 'prod', 'portal', 'deadbeef')).toBe(false);
    // 取不到实供版本 = 不一致（不猜）
    expect(manifestMatches(null, 'prod', 'portal', 'abc1234')).toBe(false);
  });
});

describe('ReleaseFinalizerService（收尾：指针收敛 + manifest 门禁）', () => {
  it('env-dir 应用：走原子步（switchVersion，lockOwner=run id），不直连 setPointer', async () => {
    const { svc, registry, apps } = makeSvc({
      app: { key: 'portal', deployMode: 'env-dir' },
      gatewayUrl: 'http://gw',
      manifestSequence: [manifestOk],
    });
    const r = await svc.finalizeFrontendPointer(base);
    expect(apps.switchVersion).toHaveBeenCalledWith('portal', 'prod', 'abc1234', 'ops', 'run-1');
    expect(registry.setPointer).not.toHaveBeenCalled();
    expect(r).toEqual({ finalVersion: 'abc1234', via: 'atomic-step', gate: 'passed' });
  });

  it('site-version / 未登记模块：保持 setPointer + toCommitId 兜底', async () => {
    const { svc, registry, apps } = makeSvc({
      app: { key: 'shell', deployMode: 'site-version' },
      gatewayUrl: 'http://gw',
      manifestSequence: [{ byEnv: { prod: { shell: { version: 'abc1234' } } } }],
    });
    await svc.finalizeFrontendPointer({ ...base, moduleKey: 'shell' });
    expect(apps.switchVersion).not.toHaveBeenCalled();
    expect(registry.setPointer).toHaveBeenCalledWith(
      expect.objectContaining({ moduleKey: 'shell', currentVersion: 'abc1234', taskId: 'run-1' }),
    );
  });

  it('manifest 一致 → passed（双侧拼写差归一）', async () => {
    const { svc } = makeSvc({
      app: { key: 'portal', deployMode: 'env-dir' },
      gatewayUrl: 'http://gw',
      manifestSequence: [{ byEnv: { prod: { portal: { version: 'portal/abc1234' } } } }],
    });
    await expect(svc.finalizeFrontendPointer(base)).resolves.toMatchObject({ gate: 'passed' });
  });

  it('manifest 不一致（半发布形态：manifest 仍供旧版本）→ 抛 ManifestGateError，重试窗口用尽后报错含三方值', async () => {
    const sleep = jest.fn(async () => undefined);
    const { svc, probe } = makeSvc({
      app: { key: 'portal', deployMode: 'env-dir' },
      gatewayUrl: 'http://gw',
      manifestSequence: [
        { byEnv: { prod: { portal: { version: 'old0' } } } },
        { byEnv: { prod: { portal: { version: 'old0' } } } },
      ],
    });
    await expect(
      svc.assertManifestMatches(
        { env: 'prod', moduleKey: 'portal', expectVersion: 'abc1234' },
        { attempts: 2, intervalMs: 1, sleep },
      ),
    ).rejects.toThrow(ManifestGateError);
    expect(probe.fetchGatewayManifest).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('缓存滞后自愈：首次旧版本、重试后新版本 → passed（不误杀正常发布）', async () => {
    const { svc } = makeSvc({
      app: { key: 'portal', deployMode: 'env-dir' },
      gatewayUrl: 'http://gw',
      manifestSequence: [{ byEnv: { prod: { portal: { version: 'old0' } } } }, manifestOk],
    });
    await expect(
      svc.assertManifestMatches(
        { env: 'prod', moduleKey: 'portal', expectVersion: 'abc1234' },
        { attempts: 3, intervalMs: 1, sleep: async () => undefined },
      ),
    ).resolves.toBe('passed');
  });

  it('gateway 地址未配置 → skipped，不阻断发布（判不了不判 fail）', async () => {
    const { svc, probe } = makeSvc({ app: { key: 'portal', deployMode: 'env-dir' }, gatewayUrl: '' });
    await expect(
      svc.assertManifestMatches({ env: 'prod', moduleKey: 'portal', expectVersion: 'abc1234' }),
    ).resolves.toBe('skipped');
    expect(probe.fetchGatewayManifest).not.toHaveBeenCalled();
  });

  it('manifest 取不到（gateway 不可达）→ 重试后判 fail（供数面消失也是撕裂信号）', async () => {
    const { svc } = makeSvc({
      app: { key: 'portal', deployMode: 'env-dir' },
      gatewayUrl: 'http://gw',
      manifestSequence: [null],
    });
    await expect(
      svc.assertManifestMatches(
        { env: 'prod', moduleKey: 'portal', expectVersion: 'abc1234' },
        { attempts: 1, sleep: async () => undefined },
      ),
    ).rejects.toThrow(/取不到/);
  });
});
