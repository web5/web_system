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

/** 当前登录用户的权限码数组（admin 特判全量） */
export function getMyPermissions(): Promise<string[]> {
  return request.get('/permissions/my');
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
