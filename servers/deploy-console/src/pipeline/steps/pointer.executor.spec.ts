import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PointerExecutor } from './pointer.executor';
import { CdnAssetVerifier } from '../cdn-asset-verifier.service';
import { StepContext } from './step.types';

type Any = never;

function ctxOf(p: Record<string, unknown>, logs: string[] = []): StepContext {
  return {
    pipeline: p,
    uploadTarget: 'remote',
    enterStage: (m: string) => logs.push(`stage:${m}`),
    log: (l: string) => logs.push(l),
    save: async () => undefined,
    sleep: async () => undefined,
    assertNotCancelled: () => undefined,
  } as unknown as StepContext;
}

function makeEx(opts: {
  cdn: boolean;
  setPointer?: jest.Mock;
  createRule?: jest.Mock;
  assertReady?: jest.Mock;
  releaseWorkspace?: string;
  moduleDir?: string;
  app?: { key: string; deployMode: string; kind?: string } | null;
  switchVersion?: jest.Mock;
}) {
  const registry = { setPointer: opts.setPointer ?? jest.fn(async () => undefined) };
  const canary = { create: opts.createRule ?? jest.fn(async () => ({ id: 7 })) };
  const configService = { get: (k: string) => (k === 'RELEASE_WORKSPACE' ? opts.releaseWorkspace : undefined) };
  const moduleRegistry = { get: jest.fn(async () => ({ dir: opts.moduleDir ?? 'portal' })) };
  const verifier = {
    isCdnMode: () => opts.cdn,
    assertReady: opts.assertReady ?? jest.fn(async () => ({ files: 3, baseUrl: 'https://x/cdn' })),
  };
  // 半发布治理 F1-②：env-dir 应用切版本收敛到 AppsService 原子步
  const appsService = {
    findAppOrNull: jest.fn(async () => opts.app ?? null),
    switchVersion: opts.switchVersion ??
      jest.fn(async () => ({ appKey: 'portal', envId: 'dev', from: 'old0', to: 'abc1234', pointer: null })),
  };
  const ex = new PointerExecutor(
    registry as Any,
    canary as Any,
    configService as Any,
    moduleRegistry as Any,
    verifier as unknown as CdnAssetVerifier,
    appsService as Any,
  );
  return { ex, registry, canary, verifier, moduleRegistry, appsService };
}

describe('PointerExecutor（切指针 + CDN 硬门禁）', () => {
  let ws: string;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-ws-'));
    fs.mkdirSync(path.join(ws, 'apps', 'portal', 'dist'), { recursive: true });
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  const basePipeline = {
    id: 1,
    env: 'dev',
    moduleKey: 'portal',
    moduleType: 'frontend',
    versionTag: 'abc1234',
    mode: 'direct',
    operator: 'tester',
  };

  it('legacy 模式：不调 CDN 校验，直接切指针（零变化）', async () => {
    const { ex, registry, verifier } = makeEx({ cdn: false, releaseWorkspace: ws });
    await ex.run(ctxOf({ ...basePipeline }));
    expect(verifier.assertReady).not.toHaveBeenCalled();
    expect(registry.setPointer).toHaveBeenCalledWith(
      expect.objectContaining({ currentVersion: 'abc1234', env: 'dev', moduleKey: 'portal' }),
    );
  });

  it('cdn 模式：校验通过后才切指针，且本地产物目录按注册表 dir 解析', async () => {
    const { ex, registry, verifier } = makeEx({ cdn: true, releaseWorkspace: ws, moduleDir: 'portal-app' });
    const logs: string[] = [];
    await ex.run(ctxOf({ ...basePipeline }, logs));
    expect(verifier.assertReady).toHaveBeenCalledWith(
      expect.objectContaining({
        env: 'dev',
        app: 'portal',
        commit: 'abc1234',
        localDir: path.join(ws, 'apps', 'portal-app', 'dist'),
      }),
    );
    expect(registry.setPointer).toHaveBeenCalled();
    // 先校验后切：日志顺序可以证明
    const i = logs.findIndex((l) => l.includes('校验 CDN 产物'));
    const j = logs.findIndex((l) => l.includes('切换当前版本指针'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
  });

  it('cdn 模式：校验失败 → 抛错且**绝不切指针**（防「指针已切、资源 404」）', async () => {
    const assertReady = jest.fn(async () => {
      throw new Error('CDN 校验失败：取不到产物清单');
    });
    const { ex, registry } = makeEx({ cdn: true, releaseWorkspace: ws, assertReady });
    await expect(ex.run(ctxOf({ ...basePipeline }))).rejects.toThrow(/CDN 校验失败/);
    expect(registry.setPointer).not.toHaveBeenCalled();
  });

  it('cdn 模式灰度：校验失败同样不得写灰度规则', async () => {
    const assertReady = jest.fn(async () => {
      throw new Error('CDN 校验失败：内容不一致');
    });
    const { ex, canary } = makeEx({ cdn: true, releaseWorkspace: ws, assertReady });
    await expect(
      ex.run(ctxOf({ ...basePipeline, mode: 'grayscale', grayscaleRule: { percent: 10 } })),
    ).rejects.toThrow(/内容不一致/);
    expect(canary.create).not.toHaveBeenCalled();
  });

  it('cdn 模式：版本号为空 → 直接失败（不猜目录）', async () => {
    const { ex, registry, verifier } = makeEx({ cdn: true, releaseWorkspace: ws });
    await expect(ex.run(ctxOf({ ...basePipeline, versionTag: '' }))).rejects.toThrow(/版本号为空/);
    expect(verifier.assertReady).not.toHaveBeenCalled();
    expect(registry.setPointer).not.toHaveBeenCalled();
  });

  it('cdn 模式：注册表取不到模块时回落 moduleKey 作为目录名', async () => {
    const { ex, verifier, moduleRegistry } = makeEx({ cdn: true, releaseWorkspace: ws });
    (moduleRegistry.get as jest.Mock).mockRejectedValueOnce(new Error('not found'));
    await ex.run(ctxOf({ ...basePipeline }));
    expect(verifier.assertReady).toHaveBeenCalledWith(
      expect.objectContaining({ localDir: path.join(ws, 'apps', 'portal', 'dist') }),
    );
  });

  // ── 半发布治理 F1-②：env-dir 收敛原子步 ──

  it('env-dir 应用：走 AppsService.switchVersion 原子步，不再直连 setPointer（只写表不写盘的旧形态被拒）', async () => {
    const { ex, registry, appsService } = makeEx({
      cdn: false,
      releaseWorkspace: ws,
      app: { key: 'portal', deployMode: 'env-dir' },
    });
    await ex.run(ctxOf({ ...basePipeline, id: 'run-9' }));
    expect(appsService.switchVersion).toHaveBeenCalledWith(
      'portal',
      'dev',
      'abc1234',
      'tester',
      'run-9', // lockOwner = 流水线 run id：与流水线自持锁同源才算重入
    );
    expect(registry.setPointer).not.toHaveBeenCalled();
  });

  it('site-version shell：保持 setPointer 不变（无磁盘指针，本期不收敛）', async () => {
    const { ex, registry, appsService } = makeEx({
      cdn: false,
      releaseWorkspace: ws,
      app: { key: 'shell', deployMode: 'site-version', kind: 'shell' },
    });
    await ex.run(ctxOf({ ...basePipeline, moduleKey: 'shell' }));
    expect(appsService.switchVersion).not.toHaveBeenCalled();
    expect(registry.setPointer).toHaveBeenCalledWith(
      expect.objectContaining({ moduleKey: 'shell', currentVersion: 'abc1234' }),
    );
  });

  it('未登记应用（后端服务）：保持 setPointer 不变', async () => {
    const { ex, registry, appsService } = makeEx({ cdn: false, releaseWorkspace: ws, app: null });
    await ex.run(ctxOf({ ...basePipeline }));
    expect(appsService.switchVersion).not.toHaveBeenCalled();
    expect(registry.setPointer).toHaveBeenCalled();
  });

  it('env-dir 灰度分支：仍只写灰度规则，不触碰 switchVersion', async () => {
    const { ex, canary, appsService } = makeEx({
      cdn: false,
      releaseWorkspace: ws,
      app: { key: 'portal', deployMode: 'env-dir' },
    });
    await ex.run(ctxOf({ ...basePipeline, mode: 'grayscale', grayscaleRule: { percent: 10 } }));
    expect(canary.create).toHaveBeenCalled();
    expect(appsService.switchVersion).not.toHaveBeenCalled();
  });
});
