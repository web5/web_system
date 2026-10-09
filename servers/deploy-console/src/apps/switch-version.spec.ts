import { BadRequestException } from '@nestjs/common';
import { AppsService } from './apps.service';
import { hasEnvVersion, writeEnvEntryPointer } from './entry-pointer';

/**
 * 只 mock 磁盘侧的两个函数，其余走真实实现（requireActual）：
 * 指针格式本身已由 `entry-pointer.spec.ts` 锁定，这里验证的是**写入顺序与补偿**。
 */
jest.mock('./entry-pointer', () => ({
  ...jest.requireActual('./entry-pointer'),
  hasEnvVersion: jest.fn(() => true),
  writeEnvEntryPointer: jest.fn(() => ({ js: '/ws/x/index.js', css: null })),
}));

const hasEnvVersionMock = hasEnvVersion as unknown as jest.Mock;
const writePointerMock = writeEnvEntryPointer as unknown as jest.Mock;

describe('AppsService.switchVersion（2026-10-09 收敛，诊断 #1/#5）', () => {
  let appRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let routeRepo: { delete: jest.Mock; save: jest.Mock; find: jest.Mock };
  let versionRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; find: jest.Mock };
  let legacyModuleRepo: { find: jest.Mock };
  let envsService: { getEnv: jest.Mock };
  let configService: { get: jest.Mock };
  let mirror: { mirrorRow: jest.Mock; deleteMirror: jest.Mock };
  let registry: { setAppEnvPointer: jest.Mock; clearAppEnvPointer: jest.Mock };
  let svc: AppsService;

  beforeEach(() => {
    jest.clearAllMocks();
    hasEnvVersionMock.mockReturnValue(true);
    writePointerMock.mockReturnValue({ js: '/ws/x/index.js', css: null });

    appRepo = {
      findOne: jest.fn(async () => ({ key: 'portal', deployMode: 'env-dir' })),
      save: jest.fn(async (x: unknown) => x),
      create: jest.fn(() => ({})),
    };
    routeRepo = { delete: jest.fn(), save: jest.fn(), find: jest.fn(async () => []) };
    versionRepo = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (x: unknown) => x),
      create: jest.fn(() => ({})),
      find: jest.fn(async () => []),
    };
    legacyModuleRepo = { find: jest.fn(async () => []) };
    envsService = { getEnv: jest.fn(async () => ({ envId: 'prod' })) };
    configService = { get: jest.fn(() => '/ws') };
    mirror = { mirrorRow: jest.fn(), deleteMirror: jest.fn() };
    registry = {
      setAppEnvPointer: jest.fn(async () => ({ from: 'v1', previous: 'v0', unchanged: false })),
      clearAppEnvPointer: jest.fn(async () => undefined),
    };

    svc = new AppsService(
      appRepo as never,
      routeRepo as never,
      versionRepo as never,
      legacyModuleRepo as never,
      envsService as never,
      configService as never,
      mirror as never,
      registry as never,
    );
  });

  it('指针走 registry 单一入口，不再自己 save（否则 prod 云库拿不到新指针）', async () => {
    const r = await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(registry.setAppEnvPointer).toHaveBeenCalledWith(
      expect.objectContaining({
        env: 'prod',
        moduleKey: 'portal',
        currentVersion: 'v2',
        deployedBy: 'u1',
      }),
    );
    // 关键断言：本地 versionRepo 不再被直接写
    expect(versionRepo.save).not.toHaveBeenCalled();
    expect(r).toMatchObject({ from: 'v1', to: 'v2' });
  });

  it('顺序：先提交指针表，再写磁盘入口指针', async () => {
    const order: string[] = [];
    registry.setAppEnvPointer.mockImplementation(async () => {
      order.push('db');
      return { from: 'v1', previous: 'v0', unchanged: false };
    });
    writePointerMock.mockImplementation(() => {
      order.push('disk');
      return { js: '/ws/x/index.js', css: null };
    });
    await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(order).toEqual(['db', 'disk']);
  });

  it('磁盘指针写失败 → 回滚指针表并抛出（禁止「DB 说新版本、磁盘指旧版本」）', async () => {
    writePointerMock.mockImplementation(() => {
      throw new Error('EACCES: 只读文件系统');
    });
    await expect(svc.switchVersion('portal', 'prod', 'v2', 'u1')).rejects.toThrow(BadRequestException);
    // 补偿：把 current 改回 from、previous 原样带回来
    expect(registry.setAppEnvPointer).toHaveBeenCalledTimes(2);
    expect(registry.setAppEnvPointer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentVersion: 'v1',
        previousVersion: 'v0',
      }),
    );
  });

  it('首次写入（from=null）+ 磁盘失败 → 删行而不是写空指针', async () => {
    registry.setAppEnvPointer.mockResolvedValue({ from: null, previous: null, unchanged: false });
    writePointerMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    await expect(svc.switchVersion('portal', 'prod', 'v2', 'u1')).rejects.toThrow(BadRequestException);
    expect(registry.clearAppEnvPointer).toHaveBeenCalledWith('portal', 'prod');
  });

  it('同值切换：不写盘、不重复提交（幂等）', async () => {
    registry.setAppEnvPointer.mockResolvedValue({ from: 'v2', previous: 'v1', unchanged: true });
    const r = await svc.switchVersion('portal', 'prod', 'v2', 'u1');
    expect(r).toMatchObject({ unchanged: true, pointer: null });
    expect(writePointerMock).not.toHaveBeenCalled();
  });

  it('产物目录不存在 → fail-fast，且不动指针表', async () => {
    hasEnvVersionMock.mockReturnValue(false);
    await expect(svc.switchVersion('portal', 'prod', 'v404', 'u1')).rejects.toThrow(/版本产物不存在/);
    expect(registry.setAppEnvPointer).not.toHaveBeenCalled();
  });

  it('site-version（基座 shell）不写 env-dir 磁盘指针', async () => {
    appRepo.findOne.mockResolvedValue({ key: 'shell', deployMode: 'site-version' });
    const r = await svc.switchVersion('shell', 'prod', 'v3', 'u1');
    expect(writePointerMock).not.toHaveBeenCalled();
    expect(r.pointer).toBeNull();
    expect(registry.setAppEnvPointer).toHaveBeenCalled();
  });
});
