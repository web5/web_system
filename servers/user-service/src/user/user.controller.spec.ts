import { UserController } from './user.controller';

/**
 * 2026-11-12：P1 安全修复 —— GET/PUT /users/me 响应体不含 password 哈希。
 *
 * 背景：getMe/updateMe 曾把 User 实体整体展开进响应（`{ ...user, avatar }`），
 * bcrypt 哈希随响应泄出。本块直接钉 controller 响应契约：data 中不得出现
 * password 键，其余字段（含 avatar URL 解析）保持原行为。
 */
describe('UserController /users/me 响应脱敏', () => {
  const hashed = '$2a$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqr';

  const entityUser = {
    id: 7,
    username: 'wx_user',
    password: hashed,
    nickname: '阿橙',
    avatar: '/api/uploads/avatars/x.jpeg',
    roles: ['user'],
  };

  function makeController(serviceOverrides: Record<string, unknown>) {
    const userService = {
      findById: jest.fn(async () => entityUser),
      update: jest.fn(async () => {
        const { password: _pwd, ...safe } = entityUser;
        return safe;
      }),
      ...serviceOverrides,
    };
    const operationLogClient = { write: jest.fn() };
    const publicBaseUrl = { resolve: async () => '' };
    return new UserController(userService as never, operationLogClient as never, publicBaseUrl as never);
  }

  const req = { user: { id: 7, username: 'wx_user' } } as never;

  it('getMe：响应 data 不含 password 字段', async () => {
    const controller = makeController({});
    const res = await controller.getMe(req);
    expect(res.code).toBe(0);
    expect(res.data).not.toHaveProperty('password');
    expect(res.data).toMatchObject({ id: 7, username: 'wx_user', nickname: '阿橙' });
  });

  it('updateMe：响应 data 不含 password 字段', async () => {
    const controller = makeController({});
    const res = await controller.updateMe(req, { nickname: '新昵称' } as never);
    expect(res.code).toBe(0);
    expect(res.data).not.toHaveProperty('password');
  });

  it('getMe：序列化后的 JSON 中也不出现 password 键', async () => {
    const controller = makeController({});
    const res = await controller.getMe(req);
    expect(JSON.stringify(res)).not.toContain('"password"');
    expect(JSON.stringify(res)).not.toContain(hashed);
  });
});
