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
      currentVersion: 'v3',
      previousVersion: 'v2',
    });
    const r = await svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal', to: 'v1' });
    expect(r).toEqual({ from: 'v3', to: 'v1', source: 'explicit' });
  });

  it('指针表的 previous_version 优先于历史表（它就是「上一次生效的版本」）', async () => {
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'v3', previousVersion: 'v2' });
    versionRepo.find.mockResolvedValue([{ versionTag: 'v9' }]);
    const r = await svc.resolveRollbackTarget({ env: 'prod', moduleKey: 'portal' });
    expect(r).toEqual({ from: 'v3', to: 'v2', source: 'pointer' });
  });

  it('指针表没有 previous_version → 回落历史表（后端 legacy 只写 deploy_deployments）', async () => {
    appVersionRepo.findOne.mockResolvedValue({ currentVersion: 'v3', previousVersion: null });
    deploymentRepo.findOne.mockResolvedValue({ currentVersion: 'v3' });
    versionRepo.find.mockResolvedValue([
      { versionTag: 'v3' },
      { versionTag: 'v2' },
    ]);
    const r = await svc.resolveRollbackTarget({ env: 'dev', moduleKey: 'auth-service' });
    expect(r).toEqual({ from: 'v3', to: 'v2', source: 'history' });
  });

  /** 两个入口此前在这里行为不同：env-dir 抛错、后端继续找；现在统一成「都没有才报错」 */
  it('指针表与历史表都没有可回滚版本 → 明确报错（不说「请显式指定」就没法自救）', async () => {
    appVersionRepo.findOne.mockResolvedValue(null);
    deploymentRepo.findOne.mockResolvedValue({ currentVersion: 'v3' });
    versionRepo.find.mockResolvedValue([{ versionTag: 'v3' }]);
    await expect(
      svc.resolveRollbackTarget({ env: 'dev', moduleKey: 'auth-service' }),
    ).rejects.toThrow(BadRequestException);
  });
});
