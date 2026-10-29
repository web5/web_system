import { ROLE_LABELS, ROLE_TAG_COLORS, pickRole, roleLabel, roleTagColor } from './roles';

describe('pickRole（roles 数组 → 主角色）', () => {
  it('内置角色按 super_admin > admin > editor > viewer > user 取优先级最高', () => {
    expect(pickRole(['user', 'super_admin'])).toBe('super_admin');
    expect(pickRole(['viewer', 'admin'])).toBe('admin');
    expect(pickRole(['user', 'editor'])).toBe('editor');
    expect(pickRole(['user', 'viewer'])).toBe('viewer');
    expect(pickRole(['user'])).toBe('user');
  });

  it('未知/自定义角色原样返回，不再吞成 user（V10 回归：super_admin 必须被识别）', () => {
    expect(pickRole(['super_admin'])).toBe('super_admin');
    expect(pickRole(['ops-manager'])).toBe('ops-manager');
    expect(pickRole(['ops-manager', 'user'])).toBe('ops-manager');
  });

  it('空数组兜底 user', () => {
    expect(pickRole([])).toBe('user');
  });
});

describe('roleLabel / roleTagColor', () => {
  it('super_admin 显示为「超级管理员」', () => {
    expect(roleLabel('super_admin')).toBe('超级管理员');
    expect(roleTagColor('super_admin')).toBe('red');
  });

  it('内置角色各有文案', () => {
    expect(roleLabel('admin')).toBe('管理员');
    expect(roleLabel('editor')).toBe('编辑');
    expect(roleLabel('viewer')).toBe('只读');
    expect(roleLabel('user')).toBe('普通用户');
  });

  it('自定义角色用角色名映射优先，其次原样显示 code（不冒充普通用户）', () => {
    expect(roleLabel('ops-manager', { 'ops-manager': '运营经理' })).toBe('运营经理');
    expect(roleLabel('ops-manager')).toBe('ops-manager');
  });
});
