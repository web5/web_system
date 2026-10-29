/**
 * Admin - 权限管理（RBAC）
 * 后端：user-service
 * 接口前缀：/api/permissions、/api/admin/permissions、/api/admin/roles
 */
import request from './request';

export interface PermissionItem {
  code: string;
  name: string;
  type: string;
}

export interface PermissionGroup {
  group: string;
  permissions: PermissionItem[];
}

export interface RoleItem {
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export interface SaveRolePayload {
  code?: string;
  name: string;
  description?: string | null;
  permissions?: string[];
}

/**
 * 当前登录用户的权限码数组（admin 特判全量）
 *
 * `validateStatus` 单独放行 304：该接口会被浏览器按 ETag 缓存，二次请求命中
 * 304 时**响应体为空**。axios 默认只认 2xx，会把 304 当失败抛掉 —— 上层
 * fetchPermissions 便走进 catch 分支、用本地角色常量覆盖真实权限，
 * 表现为「超管登录成功却整站 403」（issue #478）。
 * 放行后由 fetchPermissions 按「空响应 = 未变更」处理，保留既有权限。
 *
 * 只在本接口放宽：其余接口的 304 仍按既有行为处理，避免误伤。
 */
export function getMyPermissions(): Promise<string[]> {
  return request.get('/permissions/my', {
    validateStatus: (status: number) => (status >= 200 && status < 300) || status === 304,
  });
}

export interface SyncPermissionResult {
  permissionsAdded: number;
  permissionsUpdated: number;
  rolesAdded: number;
  rolePermissionsCovered: number;
}

/**
 * 同步权限点（以代码声明为准；幂等）。
 * 用途：新增了权限码但前端菜单不出现时，点一下即可，无需重启 user-service。
 * ⚠️ 会全量覆盖**内置角色**的权限（自定义角色不受影响）。
 */
export function syncPermissions(): Promise<SyncPermissionResult> {
  return request.post('/admin/permissions/sync');
}

/**
 * 代码声明（packages/types）与数据库的权限差异（只读）。
 * 用于页面提示"代码已加权限码、库里还没同步"。
 */
export interface PermissionDiff {
  permissionsMissingInDb: string[];
  permissionsExtraInDb: string[];
  roles: Array<{ code: string; missingInDb: string[]; extraInDb: string[] }>;
  hasDiff: boolean;
}

export function getPermissionDiff(): Promise<PermissionDiff> {
  return request.get('/admin/permissions/diff');
}

/** 权限点全量（按 group 分组） */
export function listPermissions(): Promise<PermissionGroup[]> {
  return request.get('/admin/permissions');
}

/** 角色列表（含权限码） */
export function listRoles(): Promise<RoleItem[]> {
  return request.get('/admin/roles');
}

/** 新建角色 */
export function createRole(payload: SaveRolePayload): Promise<{ code: string }> {
  return request.post('/admin/roles', payload);
}

/** 更新角色（权限全量覆盖） */
export function updateRole(code: string, payload: SaveRolePayload): Promise<{ code: string }> {
  return request.put(`/admin/roles/${code}`, payload);
}

/** 删除角色 */
export function deleteRole(code: string): Promise<{ ok: boolean }> {
  return request.delete(`/admin/roles/${code}`);
}
