import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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

/**
 * 2026-10-31：用户改密双入口（个人中心改自己 + 用户管理重置别人）。
 * 判据：旧密码校验、bcrypt 哈希、令牌版本 +1 作废旧会话。
 */
describe('UserService 密码能力', () => {
  function makeRepo(user: unknown) {
    return {
      findOne: jest.fn(async () => user),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
  }

  const baseUser = {
    id: 1,
    username: 'admin',
    roles: ['admin'],
    password: null as string | null,
    tokenVersion: 0,
  };

  it('changeOwnPassword：旧密码正确 → 新密码哈希 + 令牌版本 +1', async () => {
    const hashed = await bcrypt.hash('oldpass123', 10);
    const repo = makeRepo({ ...baseUser, password: hashed });
    const svc = new UserService(repo as never);

    await svc.changeOwnPassword('1', 'oldpass123', 'newpass456');

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.password).not.toBe('newpass456');
    expect(await bcrypt.compare('newpass456', saved.password)).toBe(true);
    expect(saved.tokenVersion).toBe(1);
  });

  it('changeOwnPassword：旧密码错误 → 拒绝', async () => {
    const hashed = await bcrypt.hash('oldpass123', 10);
    const svc = new UserService(makeRepo({ ...baseUser, password: hashed }) as never);

    await expect(
      svc.changeOwnPassword('1', 'wrongpass', 'newpass456'),
    ).rejects.toThrow(BadRequestException);
  });

  it('changeOwnPassword：未设置密码（NULL）→ 拒绝', async () => {
    const svc = new UserService(makeRepo({ ...baseUser, password: null }) as never);

    await expect(
      svc.changeOwnPassword('1', 'whatever', 'newpass456'),
    ).rejects.toThrow(BadRequestException);
  });

  it('resetPassword：新密码哈希 + 令牌版本 +1', async () => {
    const repo = makeRepo({ ...baseUser, tokenVersion: 3 });
    const svc = new UserService(repo as never);

    await svc.resetPassword('2', 'brandnew789');

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.password).not.toBe('brandnew789');
    expect(await bcrypt.compare('brandnew789', saved.password)).toBe(true);
    expect(saved.tokenVersion).toBe(4);
  });

  it('update：带 password → 哈希 + 令牌版本 +1', async () => {
    const repo = makeRepo({ ...baseUser, tokenVersion: 0 });
    const svc = new UserService(repo as never);

    await svc.update('1', { password: 'updatedpass' } as never);

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.password).not.toBe('updatedpass');
    expect(await bcrypt.compare('updatedpass', saved.password)).toBe(true);
    expect(saved.tokenVersion).toBe(1);
  });

  it('update：不带 password（改昵称）→ 令牌版本不变', async () => {
    const repo = makeRepo({ ...baseUser, tokenVersion: 5 });
    const svc = new UserService(repo as never);

    await svc.update('1', { nickname: '新昵称' } as never);

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.tokenVersion).toBe(5);
    expect(saved.nickname).toBe('新昵称');
  });

  it('create：带 password → 落库为 bcrypt 哈希而非明文', async () => {
    const repo = makeRepo(null);
    const svc = new UserService(repo as never);

    await svc.create({ username: 'newbie', password: 'plain123' } as never);

    const created = (repo.create as jest.Mock).mock.calls[0][0];
    expect(created.password).not.toBe('plain123');
    expect(await bcrypt.compare('plain123', created.password)).toBe(true);
  });
});
