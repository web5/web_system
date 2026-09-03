import { buildBuiltinSteps, BuiltinExecutors } from './step-registry';

/**
 * 步骤注册表语义测试：锁定「分派由步骤元数据（category/commandMode/守卫）配置驱动」，
 * 任何步骤特性变化都从这里暴露，而不是散落在 engine 的 case 里。
 */
describe('step-registry（内置步骤配置化声明）', () => {
  const stub = (): BuiltinExecutors =>
    ({
      check: { run: jest.fn() },
      pull: { run: jest.fn() },
      upload: { run: jest.fn() },
      restart: { run: jest.fn() },
      version: { run: jest.fn() },
      pointer: { run: jest.fn() },
      verify: { run: jest.fn() },
      cleanup: { run: jest.fn() },
    }) as unknown as BuiltinExecutors;

  const registry = buildBuiltinSteps(stub());
  const p = (over: Record<string, unknown> = {}) =>
    ({ moduleType: undefined, reuseArtifact: false, skipVerify: false, ...over }) as never;

  it('九步骤齐全，category 与 commandMode 正确', () => {
    expect(Object.keys(registry).sort()).toEqual(
      ['build', 'check', 'cleanup', 'pointer', 'pull', 'restart', 'upload', 'verify', 'version'],
    );
    expect(registry.check).toMatchObject({ category: 'semantic', commandMode: 'base' });
    expect(registry.pull).toMatchObject({ category: 'code', commandMode: 'override' });
    expect(registry.build).toMatchObject({ category: 'build', commandMode: 'required' });
    expect(registry.upload).toMatchObject({ category: 'deploy', commandMode: 'override' });
    expect(registry.restart).toMatchObject({ category: 'deploy', commandMode: 'override' });
    expect(registry.version).toMatchObject({ category: 'semantic', commandMode: 'none' });
    expect(registry.pointer).toMatchObject({ category: 'semantic', commandMode: 'none' });
    expect(registry.verify).toMatchObject({ category: 'probe', commandMode: 'override' });
    expect(registry.cleanup).toMatchObject({ category: 'cleanup', commandMode: 'override' });
  });

  it('build 无内置执行体（required：必须命令驱动）', () => {
    expect(registry.build.run).toBeUndefined();
  });

  describe('守卫 skip（实例快照/类型决定跳过）', () => {
    it('复用产物跳过 拉取/构建/投递/重启', () => {
      for (const s of ['pull', 'build', 'upload', 'restart']) {
        expect(registry[s].skip!(p({ reuseArtifact: true }))).toBe(true);
      }
    });

    it('后端模块：upload/pointer 跳过，restart 执行', () => {
      const backend = p({ moduleType: 'backend' });
      expect(registry.upload.skip!(backend)).toBe(true);
      expect(registry.pointer.skip!(backend)).toBe(true);
      expect(registry.restart.skip!(backend)).toBe(false);
    });

    it('前端模块：restart 跳过，upload/pointer 执行', () => {
      const fe = p({ moduleType: 'micro-frontend' });
      expect(registry.restart.skip!(fe)).toBe(true);
      expect(registry.upload.skip!(fe)).toBe(false);
      expect(registry.pointer.skip!(fe)).toBe(false);
    });

    it('快线（skipVerify）跳过 verify', () => {
      expect(registry.verify.skip!(p({ skipVerify: true }))).toBe(true);
      expect(registry.verify.skip!(p({ skipVerify: false }))).toBe(false);
    });

    it('check/version/cleanup 无守卫（恒执行/由步骤序列控制）', () => {
      expect(registry.check.skip).toBeUndefined();
      expect(registry.version.skip).toBeUndefined();
      expect(registry.cleanup.skip).toBeUndefined();
    });
  });
});
