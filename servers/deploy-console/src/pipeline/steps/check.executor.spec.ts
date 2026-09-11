import { CheckExecutor } from './check.executor';
import { StepContext } from './step.types';

/** 实例快照的轻量形状（仅覆盖 CheckExecutor 使用的字段） */
interface PipeLike {
  moduleKey: string;
  env: string;
  gitBranch?: string;
  versionTag?: string;
  /** R6 版本身份前缀（产物命名空间） */
  templateKey?: string;
  /** 入参 commit 快照 */
  requestedCommit?: string;
  reuseArtifact: boolean;
  gitCommit?: string;
  moduleType?: string;
  mode?: string;
  logs: string[];
}

describe('CheckExecutor（check 安全基线执行体）', () => {
  const mk = (over: Partial<PipeLike> = {}) => ({
    pipeline: {
      moduleKey: 'admin',
      env: 'dev',
      reuseArtifact: false,
      logs: [] as string[],
      ...over,
    } as PipeLike,
    uploadTarget: 'local' as const,
    enterStage: jest.fn(async () => undefined),
    log: jest.fn(),
    save: jest.fn(async () => undefined),
    sleep: jest.fn(async () => undefined),
    assertNotCancelled: jest.fn(),
  });

  const deps = (over: Record<string, unknown> = {}) => ({
    moduleRegistry: { get: jest.fn(async () => ({ type: 'micro-frontend', pm2: 'web-admin' })) },
    artifacts: { exists: jest.fn(() => false) },
    registry: { findByVersionTag: jest.fn(async () => undefined) },
    ...over,
  });

  it('设置 moduleType / 默认 master / 非复用产物', async () => {
    const d = deps();
    const ex = new CheckExecutor(d.moduleRegistry as never, d.artifacts as never, d.registry as never);
    const ctx = mk();
    await ex.run(ctx as never as StepContext);
    expect(ctx.pipeline.moduleType).toBe('micro-frontend');
    expect(ctx.pipeline.gitBranch).toBe('master');
    expect(ctx.pipeline.reuseArtifact).toBe(false);
    expect(d.moduleRegistry.get).toHaveBeenCalledWith('admin');
  });

  it('指定 commit 且产物在磁盘 → reuseArtifact=true 并回填 gitCommit', async () => {
    const d = deps({
      artifacts: { exists: jest.fn(() => true) },
      registry: { findByVersionTag: jest.fn(async () => ({ gitCommit: 'abc1234' })) },
    });
    const ex = new CheckExecutor(d.moduleRegistry as never, d.artifacts as never, d.registry as never);
    const ctx = mk({ versionTag: 'abc1234' });
    await ex.run(ctx as never as StepContext);
    expect(ctx.pipeline.reuseArtifact).toBe(true);
    expect(ctx.pipeline.gitCommit).toBe('abc1234');
    expect(d.registry.findByVersionTag).toHaveBeenCalledWith('abc1234');
  });

  it('v5 顺序（git 已把 versionTag 回填成完整引用）→ 不重复拼前缀，复用仍生效', async () => {
    // 回归：v5 的 git 是首节点，check 在它之后跑；旧实现会拼成 default/default/91f744b → 复用永久失效
    const d = deps({
      artifacts: { exists: jest.fn(() => true) },
      registry: { findByVersionTag: jest.fn(async () => ({ gitCommit: '91f744b' })) },
    });
    const ex = new CheckExecutor(d.moduleRegistry as never, d.artifacts as never, d.registry as never);
    const ctx = mk({ versionTag: 'default/91f744b', templateKey: 'default' });
    await ex.run(ctx as never as StepContext);

    expect(d.artifacts.exists).toHaveBeenCalledWith('admin', 'default/91f744b');
    expect(d.artifacts.exists).not.toHaveBeenCalledWith('admin', 'default/default/91f744b');
    expect(ctx.pipeline.reuseArtifact).toBe(true);
    expect(ctx.pipeline.versionTag).toBe('default/91f744b');
  });

  it('只有 requestedCommit（versionTag 尚未回填）→ 也能判定复用', async () => {
    const d = deps({
      artifacts: { exists: jest.fn(() => true) },
      registry: { findByVersionTag: jest.fn(async () => ({ gitCommit: '91f744b' })) },
    });
    const ex = new CheckExecutor(d.moduleRegistry as never, d.artifacts as never, d.registry as never);
    const ctx = mk({ requestedCommit: '91f744b', templateKey: 'default' });
    await ex.run(ctx as never as StepContext);

    expect(d.artifacts.exists).toHaveBeenCalledWith('admin', 'default/91f744b');
    expect(ctx.pipeline.reuseArtifact).toBe(true);
  });

  it('不支持的模块类型 → 抛错', async () => {
    const d = deps({ moduleRegistry: { get: jest.fn(async () => ({ type: 'mini-app' })) } });
    const ex = new CheckExecutor(d.moduleRegistry as never, d.artifacts as never, d.registry as never);
    await expect(ex.run(mk() as never as StepContext)).rejects.toThrow(/流水线暂不支持/);
  });

  it('prod 非 master 分支 → 抛错', async () => {
    const d = deps();
    const ex = new CheckExecutor(d.moduleRegistry as never, d.artifacts as never, d.registry as never);
    await expect(
      ex.run(mk({ env: 'prod', gitBranch: 'feature/x' }) as never as StepContext),
    ).rejects.toThrow(/仅允许发布 master/);
  });
});
