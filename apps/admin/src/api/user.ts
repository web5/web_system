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

/** 用户记忆明细条目（user-service UserMemoryService.list 投影，日期为 ISO 字符串） */
export interface UserMemoryItem {
  id: number;
  category: string;
  content: string;
  confidence: number;
  createdAt: string;
}

/** 用户记忆摘要行（user-service user_memory_summaries；无摘要时接口返回 null） */
export interface UserMemorySummary {
  id: number;
  namespace: string;
  summary: string;
  itemCount: number;
  version: number;
  lastItemAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 明细分页（与 C 端 list 同构） */
export interface UserMemoryPage {
  list: UserMemoryItem[];
  total: number;
}

/** GET /users/:id/memory 响应：摘要（可 null）+ 明细分页（#8229 批次 2 卡 2.4） */
export interface UserMemoryDetail {
  summary: UserMemorySummary | null;
  memories: UserMemoryPage;
}

/**
 * 查某用户的记忆摘要 + 明细分页（admin 只读；守卫 users:view，写能力在 C 端）
 */
export function getUserMemory(id: string, page = 1, pageSize = 50): Promise<UserMemoryDetail> {
  return request.get(`/users/${id}/memory`, { params: { page, pageSize } });
}

/** 用户API对象（兼容组件中的默认导入） */
export const userApi = {
  getDetail: getUserDetail,
  getList: getUserList,
  create: createUser,
  update: updateUser,
  delete: deleteUser,
  toggleStatus: toggleUserStatus,
  getUserMemory,
};
