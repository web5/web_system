import { buildUserPayload } from './user-payload';

describe('buildUserPayload（用户表单 → 后端 DTO 载荷）', () => {
  it('V1 编辑：只发后端认得的字段，表格整行垃圾字段（id/createdAt/enabled/systems…）一律不进载荷', () => {
    // 模拟 editUser 把整行 record 拷进 formData 后的"脏"表单对象
    const dirtyForm = {
      id: 3,
      username: 'superadmin',
      nickname: '超级管理员',
      createdAt: '2026-10-29T10:57:21.910Z',
      updatedAt: '2026-10-29T10:57:21.910Z',
      deletedAt: null,
      enabled: true,
      mpOpenid: 'oX-123',
      oaOpenid: 'oA-456',
      mergedTo: null,
      systems: ['admin'],
      role: 'super_admin',
      email: 'wenzhui5@gmail.com',
      phone: '13924648565',
    };
    const p = buildUserPayload(dirtyForm, { isCreate: false });
    expect(Object.keys(p).sort()).toEqual(['email', 'nickname', 'phone', 'roles', 'status', 'username']);
    expect(p.roles).toEqual(['super_admin']);
    expect(p.status).toBe('active');
    expect((p as any).id).toBeUndefined();
    expect((p as any).enabled).toBeUndefined();
    expect((p as any).systems).toBeUndefined();
  });

  it('V2 编辑：enabled=false 映射为 status=inactive（后端没有 enabled 字段）', () => {
    const p = buildUserPayload({ username: 'u1', enabled: false, role: 'editor' }, { isCreate: false });
    expect(p.status).toBe('inactive');
  });

  it('V3 编辑：enabled 未定义时不发 status（保持后端原值不动）', () => {
    const p = buildUserPayload({ username: 'u1', role: 'viewer' }, { isCreate: false });
    expect(p.status).toBeUndefined();
  });

  it('V4 空串 email/phone 整体不发（IsEmail 拒空串；phone 空串撞 uk_users_phone 唯一索引 500）', () => {
    const p = buildUserPayload({ username: 'u2', email: '', phone: '   ', role: 'user' }, { isCreate: false });
    expect(p.email).toBeUndefined();
    expect(p.phone).toBeUndefined();
    expect('email' in p).toBe(false);
    expect('phone' in p).toBe(false);
  });

  it('V5 首尾空白会被 trim', () => {
    const p = buildUserPayload(
      { username: ' bob ', nickname: ' 鲍勃 ', email: ' a@b.co ', role: ' editor ' },
      { isCreate: false },
    );
    expect(p.username).toBe('bob');
    expect(p.nickname).toBe('鲍勃');
    expect(p.email).toBe('a@b.co');
    expect(p.roles).toEqual(['editor']);
  });

  it('V6 role 为空/纯空白时兜底为 user（后端 roles 数组兜底语义不变）', () => {
    expect(buildUserPayload({ username: 'u3', role: '' }, { isCreate: false }).roles).toEqual(['user']);
    expect(buildUserPayload({ username: 'u3' }, { isCreate: false }).roles).toEqual(['user']);
  });

  it('V7 新建：必发 password、不发 status（CreateUserDto 必填 password 且无 status 字段）', () => {
    const p = buildUserPayload(
      { username: 'newbie', password: 'secret66', role: 'user', enabled: false },
      { isCreate: true },
    );
    expect(p.password).toBe('secret66');
    expect(p.status).toBeUndefined();
  });

  it('V8 新建：password 缺失时给空串（让后端 minLength 校验给出明确报错，而不是 undefined 序列化异常）', () => {
    const p = buildUserPayload({ username: 'newbie2', role: 'user' }, { isCreate: true });
    expect(p.password).toBe('');
  });

  it('V9 编辑：不携带 password（编辑弹窗不提供改密）', () => {
    const p = buildUserPayload(
      { username: 'u4', password: 'should-be-ignored', role: 'user', enabled: true },
      { isCreate: false },
    );
    expect(p.password).toBeUndefined();
  });
});
