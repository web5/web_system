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

  // ── 核验修正（A″，2026-11-26）：本函数**原样返回版本引用**，归一只发生在写列处 ──

  it('#9027：resolveRollbackTarget 原样返回版本引用（归一只发生在写列处）', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'portal/c0ffee03',
      previousVersion: 'portal/c0ffee02',
    });
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: 'portal/c0ffee01' }),
    ).resolves.toEqual({ from: 'portal/c0ffee03', to: 'portal/c0ffee01', source: 'explicit' });

    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' }),
    ).resolves.toEqual({ from: 'portal/c0ffee03', to: 'portal/c0ffee02', source: 'pointer' });

    // 历史表：current 仍是脏值，不能被当成「另一个版本」选出来；返回该行的原始 versionTag
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
    ).resolves.toEqual({ from: 'portal/c0ffee03', to: 'portal/c0ffee02', source: 'history' });
  });

  /**
   * 后端（非 env-dir）模块的版本引用是**真实目录层级**：`applyBackendVersion` 直接
   * `path.join(ws,'servers',dir,versionTag)`，而磁盘上就有 `runtime-checkpoint/<id>` 这一级
   * 目录。剥成 `<id>` 会指向不存在的目录 → 回滚必然失败。本用例锁死「原样透传」。
   */
  it('#9027：显式传入 runtime-checkpoint 引用必须原样透传（剥前缀会指向不存在的目录）', async () => {
    // 后端模块：deploy_app_env_versions 无该 key（指针表只服务 app/env-dir）
    appVersionRepo.findOne.mockResolvedValue(null);
    await expect(
      svc.resolveRollbackTarget({
        env: 'prod',
        moduleKey: 'todo',
        to: 'runtime-checkpoint/todo-prod-1792396360725',
      }),
    ).resolves.toEqual({
      from: null,
      to: 'runtime-checkpoint/todo-prod-1792396360725',
      source: 'explicit',
    });
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

  // ── 第五轮：`previous == current` 自指守卫（存量缺陷，本轮补修）────────────────
  //
  // 🔴 变异预期（写清，避免下次误判）：
  //   删掉指针分支的 `prevRef !== fromCommit` →
  //     · 下面第 1、2 条**变红**（`source` 变 pointer、`to` 变当前版本）
  //     · 上面的 `#9027 P1` 用例**仍然绿**（它走 `previous=null`，靠的是既有 `:463`
  //       归一比对，与自指守卫无关）→ 所以 P1 那条证明不了自指守卫存在，必须另有专条。
  //
  // 定性：`previous == current` 是**合法状态**（同一 commit 连续发布两次），不是脏数据。

  it('#9027 自指：previous 归一后等于 current → 视同无 previous，回落历史表取真正更早版本', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'portal/b6ec9950',
      previousVersion: 'portal/b6ec9950', // 归一后 === current 的 commit
    });
    versionRepo.find.mockResolvedValue([
      { versionTag: 'portal/b6ec9950' },
      { versionTag: 'portal/b6ec9950' },
      { versionTag: 'portal/948d24fd' },
    ]);

    const r = await svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' });

    // 删掉自指守卫会得到 { to: 'portal/b6ec9950', source: 'pointer' } → 本断言变红
    expect(r).toEqual({ from: 'portal/b6ec9950', to: 'portal/948d24fd', source: 'history' });
  });

  it('#9027 自指：shell@prod 真实形态 previous==current(a82270f9) → 回落到 b94924b3', async () => {
    // 数据侧取证（releaser-9027-preflight）：a82270f9 于 2026-10-10 发布过两次
    // （14:23:37 与 14:33:02），previous 忠实记为 a82270f9；真上一个**不同**版本是 b94924b3。
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'a82270f9',
      previousVersion: 'a82270f9',
    });
    versionRepo.find.mockResolvedValue([
      { versionTag: 'a82270f9' },
      { versionTag: 'a82270f9' },
      { versionTag: 'b94924b3' },
    ]);

    const r = await svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'shell' });

    expect(r.to).toBe('b94924b3'); // 正向断言（不用 !==，否则 throw 场景下无意义）
    expect(r.source).toBe('history'); // 走回落，不是指针分支
  });

  it('#9027 自指：previous==current 且历史表无更早版本 → 明确报错（绝不静默成功）', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'a82270f9',
      previousVersion: 'a82270f9',
    });
    versionRepo.find.mockResolvedValue([{ versionTag: 'a82270f9' }]);

    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'shell' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('#9027：explicit 指定当前版本 → 400（无回落路径，不许静默成功）', async () => {
    // previous 给一个可用值，证明 400 来自 explicit 判等，而不是「根本没得退」
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'a82270f9',
      previousVersion: 'b94924b3',
    });
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'shell', to: 'a82270f9' }),
    ).rejects.toThrow(BadRequestException);

    // 同一 commit 的不同拼写也必须认出「就是当前版本」
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'portal/b6ec9950',
      previousVersion: 'portal/948d24fd',
    });
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: 'b6ec9950' }),
    ).rejects.toThrow(BadRequestException);
  });

  /**
   * ⚠️ 本条对应**超出 team-lead 指定范围**的第 3 处改动（explicit 非法引用校验）。
   * 它是 round-1 已有行为的恢复 —— A″ 把 `requireCommitRef(explicit, '回滚目标')`
   * 整句撤掉时一并丢失了校验，导致 `POST /deploy/rollback-version` 的 `to`
   * 可直达 `applyBackendVersion` 的 `path.join(ws,'servers',dir,versionTag)`。
   *
   * 若不采纳这处改动：把 explicit 分支的
   *   `const explicitRef = requireCommitRef(explicit, '回滚目标');`
   * 改为 `const explicitRef = normalizeCommitRef(explicit);`
   * 并把判等改成 `if (explicitRef && explicitRef === fromCommit)`，然后删掉本条用例即可。
   */
  it('#9027：explicit 传非法引用（.. / 空段）→ 400，不把脏值透给下游拼路径', async () => {
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'c0ffee03', previousVersion: null });
    for (const bad of ['..', 'portal/../etc', 'a//b']) {
      await expect(
        svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: bad }),
      ).rejects.toThrow(BadRequestException);
    }
  });
});
