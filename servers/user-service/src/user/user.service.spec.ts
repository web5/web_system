import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { QueryFailedError } from 'typeorm';
import { UserService } from './user.service';

/**
 * 空 base 透传 stub：resolve() 返回 '' 时 stripPublicBaseUrl 原样返回，
 * 既有用例行为与注入 PublicBaseUrlService 之前逐字节一致。
 */
const passthroughBaseUrl = { resolve: async () => '' };

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
    const svc = new UserService(makeRepo(superAdminUser) as never, passthroughBaseUrl as never);
    await expect(
      svc.update('12', { roles: ['admin'] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update：保留 super_admin 的正常修改 → 放行', async () => {
    const repo = makeRepo(superAdminUser);
    const svc = new UserService(repo as never, passthroughBaseUrl as never);
    const saved = await svc.update('12', {
      nickname: '超管',
      roles: ['super_admin'],
    } as never);
    expect((saved as any).nickname).toBe('超管');
    expect(repo.save).toHaveBeenCalled();
  });

  it('update：不传 roles 的普通字段修改 → 放行', async () => {
    const repo = makeRepo(superAdminUser);
    const svc = new UserService(repo as never, passthroughBaseUrl as never);
    await expect(svc.update('12', { phone: '13800000000' } as never)).resolves.toBeDefined();
  });

  it('update：roles 是逗号串形态的历史数据也能识别超管并拒绝', async () => {
    const legacy = { ...superAdminUser, roles: 'super_admin,admin' };
    const svc = new UserService(makeRepo(legacy) as never, passthroughBaseUrl as never);
    await expect(
      svc.update('12', { roles: ['user'] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update：普通用户改角色不受影响', async () => {
    const normal = { id: 3, username: 'wx_oNLC', roles: ['user'] };
    const svc = new UserService(makeRepo(normal) as never, passthroughBaseUrl as never);
    await expect(
      svc.update('3', { roles: ['admin'] } as never),
    ).resolves.toBeDefined();
  });

  it('remove：超管账号 → 拒绝删除', async () => {
    const repo = makeRepo(superAdminUser);
    const svc = new UserService(repo as never, passthroughBaseUrl as never);
    await expect(svc.remove('12')).rejects.toThrow(BadRequestException);
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('remove：普通用户 → 正常删除', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_oNLC', roles: ['user'] });
    const svc = new UserService(repo as never, passthroughBaseUrl as never);
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
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    await svc.changeOwnPassword('1', 'oldpass123', 'newpass456');

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.password).not.toBe('newpass456');
    expect(await bcrypt.compare('newpass456', saved.password)).toBe(true);
    expect(saved.tokenVersion).toBe(1);
  });

  it('changeOwnPassword：旧密码错误 → 拒绝', async () => {
    const hashed = await bcrypt.hash('oldpass123', 10);
    const svc = new UserService(makeRepo({ ...baseUser, password: hashed }) as never, passthroughBaseUrl as never);

    await expect(
      svc.changeOwnPassword('1', 'wrongpass', 'newpass456'),
    ).rejects.toThrow(BadRequestException);
  });

  it('changeOwnPassword：未设置密码（NULL）→ 拒绝', async () => {
    const svc = new UserService(makeRepo({ ...baseUser, password: null }) as never, passthroughBaseUrl as never);

    await expect(
      svc.changeOwnPassword('1', 'whatever', 'newpass456'),
    ).rejects.toThrow(BadRequestException);
  });

  it('resetPassword：新密码哈希 + 令牌版本 +1', async () => {
    const repo = makeRepo({ ...baseUser, tokenVersion: 3 });
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    await svc.resetPassword('2', 'brandnew789');

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.password).not.toBe('brandnew789');
    expect(await bcrypt.compare('brandnew789', saved.password)).toBe(true);
    expect(saved.tokenVersion).toBe(4);
  });

  it('update：带 password → 哈希 + 令牌版本 +1', async () => {
    const repo = makeRepo({ ...baseUser, tokenVersion: 0 });
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    await svc.update('1', { password: 'updatedpass' } as never);

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.password).not.toBe('updatedpass');
    expect(await bcrypt.compare('updatedpass', saved.password)).toBe(true);
    expect(saved.tokenVersion).toBe(1);
  });

  it('update：不带 password（改昵称）→ 令牌版本不变', async () => {
    const repo = makeRepo({ ...baseUser, tokenVersion: 5 });
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    await svc.update('1', { nickname: '新昵称' } as never);

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.tokenVersion).toBe(5);
    expect(saved.nickname).toBe('新昵称');
  });

  it('create：带 password → 落库为 bcrypt 哈希而非明文', async () => {
    const repo = makeRepo(null);
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    await svc.create({ username: 'newbie', password: 'plain123' } as never);

    const created = (repo.create as jest.Mock).mock.calls[0][0];
    expect(created.password).not.toBe('plain123');
    expect(await bcrypt.compare('plain123', created.password)).toBe(true);
  });
});

/**
 * 2026-10-31：唯一约束冲突（ER_DUP_ENTRY=1062）转友好 400。
 * 背景：手机号/邮箱/用户名撞唯一索引时，TypeORM 抛 QueryFailedError → 全局过滤器按
 * 500 处理，前端只能看到「服务器内部错误」。修复后应转为字段级 BadRequestException。
 */
describe('UserService 唯一约束冲突转友好提示', () => {
  /** 构造一个带 errno=1062 的 QueryFailedError（模拟 MySQL 撞唯一索引） */
  function dupError(value: string, key: string): QueryFailedError {
    const driver = Object.assign(
      new Error(`Duplicate entry '${value}' for key '${key}'`),
      { errno: 1062, code: 'ER_DUP_ENTRY' },
    );
    return new QueryFailedError('INSERT INTO users', [], driver);
  }

  function makeDupRepo(error: Error) {
    return {
      findOne: jest.fn(async () => ({ id: 1, username: 'admin', roles: ['admin'] })),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async () => { throw error; }),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
  }

  it('create：撞手机号唯一索引 → 提示手机号被占用', async () => {
    const svc = new UserService(makeDupRepo(dupError('13924648565', 'users.uk_users_phone')) as never, passthroughBaseUrl as never);
    await expect(svc.create({ username: 'x', phone: '13924648565' } as never))
      .rejects.toThrow('该手机号已被其他用户使用');
  });

  it('update：撞邮箱唯一索引（哈希名）→ 按重复值含 @ 判为邮箱', async () => {
    const svc = new UserService(makeDupRepo(dupError('a@b.com', 'users.IDX_97672ac8')) as never, passthroughBaseUrl as never);
    await expect(svc.update('1', { email: 'a@b.com' } as never))
      .rejects.toThrow('该邮箱已被其他用户使用');
  });

  it('create：撞用户名唯一索引（哈希名）→ 判为用户名', async () => {
    const svc = new UserService(makeDupRepo(dupError('admin', 'users.IDX_fe0bb3f6')) as never, passthroughBaseUrl as never);
    await expect(svc.create({ username: 'admin' } as never))
      .rejects.toThrow('该用户名已被其他用户使用');
  });

  it('非唯一冲突的普通错误 → 原样抛出，不吞', async () => {
    const svc = new UserService(makeDupRepo(new Error('some other db error')) as never, passthroughBaseUrl as never);
    await expect(svc.create({ username: 'x' } as never))
      .rejects.toThrow('some other db error');
  });
});

/**
 * 2026-11-11：avatar 写侧净化（写侧污染修复）。
 *
 * 背景：upload-service 的 avatar 上传响应返回完整 URL，小程序拿到后原样 PUT
 * 落库，DB 被写入 `https://dev.kedouai.com/api/uploads/avatars/xxx` 污染行。
 * D1 铁律：DB 恒定存相对路径，故 create/update 落库前剥掉公网 origin；
 * 第三方 URL（微信头像等）与已是相对路径的值原样保留。
 */
describe('UserService avatar 写侧净化', () => {
  const devBaseUrl = { resolve: async () => 'https://dev.kedouai.com' };

  function makeRepo(user: unknown) {
    return {
      findOne: jest.fn(async () => user),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
  }

  it('create：avatar 带公网 origin → 落库为相对路径', async () => {
    const repo = makeRepo(null);
    const svc = new UserService(repo as never, devBaseUrl as never);

    await svc.create({
      username: 'wx_user',
      avatar: 'https://dev.kedouai.com/api/uploads/avatars/x.jpeg',
    } as never);

    const created = (repo.create as jest.Mock).mock.calls[0][0];
    expect(created.avatar).toBe('/api/uploads/avatars/x.jpeg');
  });

  it('update：avatar 带公网 origin → 落库为相对路径', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_user', roles: ['user'] });
    const svc = new UserService(repo as never, devBaseUrl as never);

    await svc.update('3', {
      avatar: 'https://dev.kedouai.com/api/uploads/avatars/y.jpeg',
    } as never);

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.avatar).toBe('/api/uploads/avatars/y.jpeg');
  });

  it('update：第三方 URL（微信头像）→ 原样落库，不动', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_user', roles: ['user'] });
    const svc = new UserService(repo as never, devBaseUrl as never);

    await svc.update('3', {
      avatar: 'https://thirdwx.qlogo.cn/mmopen/abc/132',
    } as never);

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.avatar).toBe('https://thirdwx.qlogo.cn/mmopen/abc/132');
  });

  it('update：已是相对路径 → 幂等不动', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_user', roles: ['user'] });
    const svc = new UserService(repo as never, devBaseUrl as never);

    await svc.update('3', { avatar: '/api/uploads/avatars/z.jpeg' } as never);

    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.avatar).toBe('/api/uploads/avatars/z.jpeg');
  });

  it('update：不传 avatar → 不查询公网 base，原样保存', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_user', roles: ['user'] });
    const spy = { resolve: jest.fn(async () => 'https://dev.kedouai.com') };
    const svc = new UserService(repo as never, spy as never);

    await svc.update('3', { nickname: '新昵称' } as never);

    expect(spy.resolve).not.toHaveBeenCalled();
    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.nickname).toBe('新昵称');
  });
});

/**
 * 2026-11-12：P1 安全修复 —— create/update 返回值不含 password 哈希。
 *
 * 背景：POST /users、PUT /users/:id、PUT /users/me 把 save() 后的完整实体
 * 原样当响应体，bcrypt 哈希随响应泄出。修复后 service 返回值恒定剥 password
 * （与 findAll/findOne 同口径），本块钉住该契约。
 */
describe('UserService 响应脱敏（返回值不含 password）', () => {
  function makeRepo(user: unknown) {
    return {
      findOne: jest.fn(async () => user),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
  }

  it('create：返回值不含 password 字段', async () => {
    const repo = makeRepo(null);
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    const created = await svc.create({ username: 'newbie', password: 'plain123' } as never);

    expect(created).not.toHaveProperty('password');
    expect(created).toMatchObject({ username: 'newbie' });
  });

  it('update：返回值不含 password 字段', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_user', roles: ['user'], password: 'hashed', tokenVersion: 0 });
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    const updated = await svc.update('3', { nickname: '新昵称' } as never);

    expect(updated).not.toHaveProperty('password');
    expect(updated).toMatchObject({ id: 3, nickname: '新昵称' });
  });

  it('update：改密场景返回值同样不含 password', async () => {
    const repo = makeRepo({ id: 3, username: 'wx_user', roles: ['user'], password: 'oldhash', tokenVersion: 0 });
    const svc = new UserService(repo as never, passthroughBaseUrl as never);

    const updated = await svc.update('3', { password: 'newpass456' } as never);

    expect(updated).not.toHaveProperty('password');
  });
});
