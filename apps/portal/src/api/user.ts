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
  return request.get('/users', { params });
}

/**
 * 获取用户详情
 */
export function getUserDetail(id: string): Promise<UserInfo> {
  return request.get(`/users/${id}`);
}

/**
 * 获取当前用户信息
 */
export function getCurrentUser(): Promise<UserInfo> {
  return request.get('/users/me');
}

/**
 * 更新用户信息
 */
export function updateUserProfile(data: Partial<UserInfo>): Promise<UserInfo> {
  return request.put('/users/me', data);
}

/**
 * 上传头像
 */
export function uploadAvatar(formData: FormData): Promise<{ avatarUrl: string }> {
  return request.post('/users/me/avatar', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

/**
 * 创建用户
 */
export function createUser(data: Partial<UserInfo>): Promise<UserInfo> {
  return request.post('/users', data);
}

/**
 * 更新用户
 */
export function updateUser(id: string, data: Partial<UserInfo>): Promise<UserInfo> {
  return request.put(`/users/${id}`, data);
}

/**
 * 删除用户
 */
export function deleteUser(id: string): Promise<void> {
  return request.delete(`/users/${id}`);
}

/**
 * 切换用户状态
 */
export function toggleUserStatus(id: string, enabled: boolean): Promise<UserInfo> {
  return request.patch(`/users/${id}/status`, { enabled });
}

/**
 * API Key 管理（迁至 user-service）
 * 申请验证码：已登录传 ownerId（用账户邮箱发码），自助传 email
 */
export function applyApiKey(data: { email?: string; ownerId?: number }): Promise<{ message: string }> {
  return request.post('/keys/apply', data);
}

/** 验证验证码并签发 Key */
export function verifyApiKey(
  data: { email?: string; ownerId?: number; code: string; name?: string },
): Promise<{ key: string; prefix: string; message: string }> {
  return request.post('/keys/verify', data);
}

/** 我的 API Key 列表 */
export function getMyApiKeys(): Promise<{ keys: ApiKeyItem[] }> {
  return request.get('/keys/mine');
}

/** 吊销我的 API Key */
export function revokeMyApiKey(id: number): Promise<void> {
  return request.delete(`/keys/mine/${id}`);
}

export interface ApiKeyItem {
  id: number;
  name: string | null;
  keyPrefix: string;
  status: 'active' | 'revoked';
  ownerType: 'apply' | 'admin';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}
