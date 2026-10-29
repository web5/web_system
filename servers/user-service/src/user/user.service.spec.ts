import { BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';

/**
 * 2026-10-29：super_admin 防剥权回归测试。
 *
 * 背景：admin 用户管理页的角色下拉曾不认识 super_admin，编辑超管用户
 * 保存时 roles 被整体覆盖成所选角色，超管被静默降级、整站权限丢失。
 * 判据：update/remove 对持有 super_admin 的用户必须拒绝。
 */
describe('UserService.super_admin 防剥权', () => {
  const superAdminUser = {
    id: 12,
    username: 'superadmin',
    roles: ['super_admin'],
    preferences: {},
  };

  function makeRepo(user: unknown) {
    return {
      findOne: jest.fn(async () => user),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
  }

  it('update：把超管改成非超管 → 拒绝', async () => {
    const svc = new UserService(makeRepo(superAdminUser) as never);
    await expect(
      svc.update('12', { roles: ['admin'] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update：保留 super_admin 的正常修改 → 放行', async () => {
    const repo = makeRepo(superAdminUser);
    const svc = new UserService(repo as never);
    const saved = await svc.update('12', {
      nickname: '超管',
      roles: ['super_admin'],
    } as never);
    expect((saved as any).nickname).toBe('超管');
    expect(repo.save).toHaveBeenCalled();
  });

  it('update：不传 roles 的普通字段修改 → 放行', async () => {
    const repo = makeRepo(superAdminUser);
    const svc = new UserService(repo as never);
    await expect(svc.update('12', { phone: '13800000000' } as never)).resolves.toBeDefined();
  });

  it('update：roles 是逗号串形态的历史数据也能识别超管并拒绝', async () => {
    const legacy = { ...superAdminUser, roles: 'super_admin,admin' };
    const svc = new UserService(makeRepo(legacy) as never);
    await expect(
      svc.update('12', { roles: ['user'] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update：普通用户改角色不受影响', async () => {
    const normal = { id: 3, username: 'wx_oNLC', roles: ['user'] };
    const svc = new UserService(makeRepo(normal) as never);
    await expect(
      svc.update('3', { roles: ['admin'] } as never),
    ).resolves.toBeDefined();
  });

  it('remove：超管账号 → 拒绝删除', async () => {
    const repo = makeRepo(superAdminUser);
    const svc = new UserService(repo as never);
    await expect(svc.remove('12')).rejects.toThrow(BadRequestException);
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('remove：普通用户 → 正常删除', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_oNLC', roles: ['user'] });
    const svc = new UserService(repo as never);
    await expect(svc.remove('3')).resolves.toBeUndefined();
    expect(repo.remove).toHaveBeenCalled();
  });
});
