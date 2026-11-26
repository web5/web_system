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

  // ── 第五轮（D11 格式校验回退 / D12 自指守卫）：存量缺陷，本轮补修 ────────────────
  //
  // 🔴 变异预期（写清，避免下次误判）：
  //   删 `const explicitRef = requireCommitRef(explicit, '回滚目标')` → 下面 D11 那两条（`../../etc/passwd`
  //                                                             与 `.. / portal/../etc / a//b` 三输入）**变红**
  //   删 `explicitRef === fromCommit` 等值守卫整块            → 下面 D12a（同拼写）与 D12b（跨拼写）**双双变红**
  //   删指针分支 `prevRef !== fromCommit`                     → 下面「previous 自指」那条**变红**
  //   三条全删                                                 → `:102` runtime-checkpoint 透传那条**仍绿**
  //                                                              （它走格式校验；且 appVersionRepo 为 null → fromCommit=undefined）
  //   且既有 `#9027 P1` 用例在删「previous 自指」守卫后**仍绿**（它走 `previous=null`，靠 `:494` 归一比对）
  //   → 所以 P1 那条证明不了自指守卫存在，必须另有专条。
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

  /**
   * D11：`explicit` 非法引用必须 400，绝不能把 `..` 透给下游拼路径。
   *
   * 攻击面：`POST /deploy/rollback-version`（`deploy.controller.ts:111-132`）的 `@Body()`
   * 是内联类型，`to` 无 `@Matches` → 直达 `deploy.service.ts:605`
   * `path.join(ws,'servers',dir,versionTag)`，`../../etc/passwd` 会被 `path.join` 归一出去。
   *
   * 这是 round-1 已有行为的**恢复**：A″ 把 `requireCommitRef(explicit,'回滚目标')` 整句撤掉时
   * 连校验一起丢了。修复方式是「只校验、返回值仍用原始引用」，故 `:102` 的
   * runtime-checkpoint 透传用例不受影响。
   *
   * 断言带 `/非法/`（不只判异常类型）：等值守卫也抛同类 `BadRequestException`，
   * 只判类型会在「两个同类型异常都可达」时退化成假绿。
   */
  it('#9027 D11：explicit 传 ../../etc/passwd → 400，不把路径穿越值透给下游', async () => {
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'c0ffee03', previousVersion: null });
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: '../../etc/passwd' }),
    ).rejects.toThrow(/非法/);
  });

  /**
   * D12b：「回滚到当前版本」必须 400，不能落到下游被判成 no-op。
   *
   * 真实形态是**跨拼写**：指针表 `current_version` 已被归一成纯 commit `b6ec9950`，
   * UI 传来的 `to` 可能是历史行里的原始引用 `portal/b6ec9950`（或反过来）。
   * 只做 `explicit === from` 的字符串比较会漏，必须用**归一值**判等。
   *
   * 漏掉这层，两条链都不好：
   * - app / env-dir：`doSwitchVersion` 见 `from === version` → `unchanged: true`
   *   直接 return（`apps.service.ts:585`），线上一个字没改却报成功；
   * - 后端：`deploy.service.ts:1193-1194` 有守卫，但只挡**精确**相等的形态。
   *
   * 删掉 `explicitRef === fromCommit` → 本用例 resolve → `rejects` 变红。
   */
  it('#9027 D12b：explicit 归一后等于 current → 400（跨拼写自指，不被 unchanged 静默吃掉）', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'portal/b6ec9950',
      // previous 给一个**可用**值：证明 400 来自 `explicitRef === fromCommit` 判等，
      // 而不是「根本没有更早版本可退」。少了这个前提，本用例在等值守卫被删时
      // 仍可能因「无路可退」而 400，退化成假绿。
      previousVersion: 'portal/948d24fd',
    });
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: 'b6ec9950' }),
    ).rejects.toThrow(/就是当前版本/);
  });

  /**
   * D12a：同拼写（非跨拼写）的「回滚到当前版本」也必须 400。
   *
   * 与 `D12b` 是**两条独立的判别性用例**，不能互相替代：
   * - 本条的字符串本来就相等，`explicit === from` 这种朴素比较也能挡住 → 它只证明守卫**存在**；
   * - `D12b` 的 `to='b6ec9950'` vs `current='portal/b6ec9950'` 字符串不等、归一后相等
   *   → 只有**用归一值判等**才能挡住 → 那条才证明「判等口径是归一后的」。
   *
   * 删掉 `explicitRef === fromCommit` 整块 → 本条与 `D12b` **双双变红**。
   */
  it('#9027 D12a：explicit 与 current 同拼写相等 → 400（有可用 previous 也不许回滚到自己）', async () => {
    appVersionRepo.findOne.mockResolvedValue({
      currentVersion: 'a82270f9',
      previousVersion: 'b94924b3', // 可用 previous：排除「无路可退」这个混淆因素
    });
    await expect(
      svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'shell', to: 'a82270f9' }),
    ).rejects.toThrow(/就是当前版本/);
  });

  /**
   * D11 补充：三条非法输入覆盖**两条不同分支**，单留 `../../etc/passwd` 盖不全。
   * - `..`             → 点段守卫（`segs.some(s => s === '..')`）
   * - `portal/../etc`  → 点段守卫（前缀形态，确认不是靠「取末段」侥幸）
   * - `a//b`           → 空段守卫（`parts.some(s => !s.trim())`）—— 与上面是**不同**分支
   *
   * 三者都经 `requireCommitRef` → 文案含「非法」，故断言 `/非法/` 而非仅断言异常类型
   * （等值守卫抛的也是 `BadRequestException`，只判类型会退化成假绿）。
   */
  it('#9027 D11：explicit 传非法引用（.. / portal/../etc / a//b）→ 400，点段与空段守卫都要挡住', async () => {
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'c0ffee03', previousVersion: null });
    for (const bad of ['..', 'portal/../etc', 'a//b']) {
      await expect(
        svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: bad }),
      ).rejects.toThrow(/非法/);
    }
  });
});
