/**
 * 角色展示与主角色解析的单一出处。
 *
 * 背景（2026-10-29 事故）：UserList / UserDetail 各自写死角色映射且不认识
 * `super_admin`，导致超管在列表里显示「普通用户」，编辑保存还会把
 * super_admin 静默剥掉。角色以后是**动态可扩展**的（角色权限页可新建），
 * 这里只内置四个系统角色的展示，自定义角色优先用角色名映射、其次原样显示 code。
 */

/** 内置角色文案（super_admin 是 DB 里的系统角色，不在 @web-system/types 的 Role 字面量里也能展示） */
export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '管理员',
  editor: '编辑',
  viewer: '只读',
  user: '普通用户',
};

export const ROLE_TAG_COLORS: Record<string, string> = {
  super_admin: 'red',
  admin: 'orange',
  editor: 'blue',
  viewer: 'cyan',
};

/** 内置主角色优先级：super_admin 最高；user 只是兜底，优先级低于自定义角色 */
const ROLE_ORDER = ['super_admin', 'admin', 'editor', 'viewer'];

/**
 * 从后端 roles 数组解析页面展示用的主角色。
 * 内置管理角色按 ROLE_ORDER 取优先级最高；自定义角色原样返回（不吞成 user）；
 * 只有纯 user（或空数组）才落到 'user'。
 */
export function pickRole(roles: string[]): string {
  for (const r of ROLE_ORDER) {
    if (roles.includes(r)) return r;
  }
  const custom = roles.find((r) => !ROLE_ORDER.includes(r) && r !== 'user');
  return custom ?? 'user';
}

/** 角色文案：nameMap（来自 /admin/roles 的动态角色名）优先，其次内置，未知 code 原样显示 */
export function roleLabel(role: string, nameMap?: Record<string, string>): string {
  return nameMap?.[role] ?? ROLE_LABELS[role] ?? role;
}

export function roleTagColor(role: string): string {
  return ROLE_TAG_COLORS[role] ?? 'default';
}

/**
 * 编辑用户下拉的兜底选项（后端 /admin/roles 不可用时）。
 * 不含 super_admin：该选项只对超管操作者开放，见 UserList.vue。
 */
export const FALLBACK_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'admin', label: '管理员' },
  { value: 'editor', label: '编辑' },
  { value: 'viewer', label: '只读' },
  { value: 'user', label: '普通用户' },
];
