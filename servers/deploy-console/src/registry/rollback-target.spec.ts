import { BadRequestException } from '@nestjs/common';
import { ReleaseRegistryService } from './release-registry.service';

/**
 * 回滚目标的统一取法（诊断 #17）。
 *
 * 此前两个入口各查一处：env-dir 读指针表 `previous_version`，后端读历史表里
 * 「最近一条非当前版本」—— 同一模块在两个页面点回滚可能得到不同目标。
 * 这里锁死统一口径：**显式 > 指针表 > 历史表**。
 */
describe('ReleaseRegistryService.resolveRollbackTarget（诊断 #17）', () => {
  let appVersionRepo: { findOne: jest.Mock };
  let deploymentRepo: { findOne: jest.Mock };
  let versionRepo: { find: jest.Mock };
  let svc: ReleaseRegistryService;

  beforeEach(() => {
    appVersionRepo = { findOne: jest.fn(async () => null) };
    deploymentRepo = { findOne: jest.fn(async () => null) };
    versionRepo = { find: jest.fn(async () => []) };
    svc = new ReleaseRegistryService(
      versionRepo as never,
      deploymentRepo as never,
      {} as never,
      appVersionRepo as never,
      {} as never,
      {} as never,
    );
  });

  it('显式指定优先（UI「回滚到此版本」按行传入）', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'c0ffee03',
      previousVersion: 'c0ffee02',
    });
    const r = await svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: 'c0ffee01' });
    expect(r).toEqual({ from: 'c0ffee03', to: 'c0ffee01', source: 'explicit' });
  });

  it('指针表的 previous_version 优先于历史表（它就是「上一次生效的版本」）', async () => {
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'c0ffee03', previousVersion: 'c0ffee02' });
    versionRepo.find.mockResolvedValue([{ versionTag: 'c0ffee09' }]);
    const r = await svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' });
    expect(r).toEqual({ from: 'c0ffee03', to: 'c0ffee02', source: 'pointer' });
  });

  it('指针表没有 previous_version → 回落历史表（后端 legacy 只写 deploy_deployments）', async () => {
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'c0ffee03', previousVersion: null });
    deploymentRepo.findOne.mockResolvedValue({ currentVersion: 'c0ffee03' });
    versionRepo.find.mockResolvedValue([
      { versionTag: 'c0ffee03' },
      { versionTag: 'c0ffee02' },
    ]);
    const r = await svc.resolveRollbackTarget({ env: 'dev', moduleKey: 'auth-service' });
    expect(r).toEqual({ from: 'c0ffee03', to: 'c0ffee02', source: 'history' });
  });

  /** 两个入口此前在这里行为不同：env-dir 抛错、后端继续找；现在统一成「都没有才报错」 */
  it('指针表与历史表都没有可回滚版本 → 明确报错（不说「请显式指定」就没法自救）', async () => {
    appVersionRepo.findOne.mockResolvedValue(null);
    deploymentRepo.findOne.mockResolvedValue({ currentVersion: 'c0ffee03' });
    versionRepo.find.mockResolvedValue([{ versionTag: 'c0ffee03' }]);
    await expect(
      svc.resolveRollbackTarget({ env: 'dev', moduleKey: 'auth-service' }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 核验修正（team-lead 2026-11-26）：三种来源的返回值都必须是纯 commit ──

  it('#9027：explicit / previous_version / 历史表 带前缀 → 归一后返回（回滚不落空）', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'portal/c0ffee03',
      previousVersion: 'portal/c0ffee02',
    });
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: 'portal/c0ffee01' }),
    ).resolves.toEqual({ from: 'portal/c0ffee03', to: 'c0ffee01', source: 'explicit' });

    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' }),
    ).resolves.toEqual({ from: 'portal/c0ffee03', to: 'c0ffee02', source: 'pointer' });

    // 历史表：current 仍是脏值，不能被当成「另一个版本」选出来
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'portal/c0ffee03',
      previousVersion: null,
    });
    versionRepo.find.mockResolvedValue([
      { versionTag: 'portal/c0ffee03' },
      { versionTag: 'portal/c0ffee02' },
    ]);
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' }),
    ).resolves.toEqual({ from: 'portal/c0ffee03', to: 'c0ffee02', source: 'history' });
  });

  /**
   * 🔴 P1 静默 no-op 回滚回归的**判别性用例**（本用例在修复前必须红）。
   *
   * 线上真实形态（prod portal）：`deploy_app_env_versions.current_version` 已被归一
   * 成纯 commit `b6ec9950`，而历史表 `deploy_versions.version_tag` 里当前版本那一行
   * 仍是带前缀的 `portal/b6ec9950`（历史脏值，未被回填）。
   *
   * 旧的精确比对 `r.versionTag !== row.currentVersion` 在这里判 `portal/b6ec9950 !== b6ec9950`
   * → 成立 → **把当前版本自己选成回滚目标** → 下游 setAppEnvPointerInner 里
   * `from === currentVersion` → `unchanged=true` → 直接 return，一个字都没写却报成功
   * （静默 no-op，用户以为回滚了、实际线上版本没动）。
   *
   * 断言必须是 `624bfa46`（更早那个真版本），且**绝不能**是 `b6ec9950`。
   */
  it('#9027 P1：指针已归一 + 历史表 current 仍是脏前缀 → 不得把当前版本选成回滚目标', async () => {
    // 指针表：current 已归一为纯 commit，previous 为空（真实 prod 形态）
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'b6ec9950', previousVersion: null });
    // 历史表：最新一条是当前版本的脏拼写，其下才是真正更早的版本
    versionRepo.find.mockResolvedValue([
      { versionTag: 'portal/b6ec9950' },
      { versionTag: '624bfa46' },
    ]);

    const r = await svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' });

    expect(r.to).toBe('624bfa46');
    // 反向断言：修复前的实现会返回 'portal/b6ec9950'（自指），归一后等价 'b6ec9950'
    expect(r.to).not.toBe('b6ec9950');
    expect(r.source).toBe('history');
    expect(r.from).toBe('b6ec9950');
  });

  it('#9027：previous_version 是非法值（..）→ 不硬用，回落历史表', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'c0ffee03',
      previousVersion: '..',
    });
    versionRepo.find.mockResolvedValue([{ versionTag: 'c0ffee02' }]);
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' }),
    ).resolves.toMatchObject({ to: 'c0ffee02', source: 'history' });
  });
});
