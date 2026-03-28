import request from './request';
import type { UserInfo } from '@web-system/types';

export interface UserListParams {
  page?: number;
  limit?: number;
  keyword?: string;
}

export interface UserListResponse {
  list: UserInfo[];
  total: number;
}

/**
 * 获取用户列表
 */
export function getUserList(params: UserListParams): Promise<UserListResponse> {
  return request.get('/user/list', { params });
}

/**
 * 获取用户详情
 */
export function getUserDetail(id: string): Promise<UserInfo> {
  return request.get(`/user/${id}`);
}

/**
 * 创建用户
 */
export function createUser(data: Partial<UserInfo>): Promise<UserInfo> {
  return request.post('/user', data);
}

/**
 * 更新用户
 */
export function updateUser(id: string, data: Partial<UserInfo>): Promise<UserInfo> {
  return request.put(`/user/${id}`, data);
}

/**
 * 删除用户
 */
export function deleteUser(id: string): Promise<void> {
  return request.delete(`/user/${id}`);
}

/**
 * 切换用户状态
 */
export function toggleUserStatus(id: string, enabled: boolean): Promise<UserInfo> {
  return request.patch(`/user/${id}/status`, { enabled });
}
