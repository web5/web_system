/**
 * 变变素材库 — API
 * 对应后台 /api/admin/bianbian/* 接口
 */
import request from './request';

/** 通用 API 响应包装 */
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

/** 素材分类信息 */
export interface MaterialCategory {
  id: string;
  name: string;
  icon: string;
  count: number;
}

/** 素材项 */
export interface MaterialItem {
  id: string;
  name: string;
  category: string;
  content: string;
  tags: string;
  icon: string;
  type: 'emoji' | 'svg' | 'color';
  source: 'system' | 'custom';
  sortOrder: number;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ========== 分类 ==========

export function getMaterialCategories(): Promise<ApiResponse<MaterialCategory[]>> {
  return request.get('/admin/bianbian/categories');
}

// ========== 素材 CRUD ==========

export function getMaterials(params?: {
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<ApiResponse<{ list: MaterialItem[]; total: number }>> {
  return request.get('/admin/bianbian/materials', { params });
}

export function createMaterial(data: {
  name: string;
  category: string;
  content: string;
  tags?: string;
  icon?: string;
  type?: string;
  description?: string;
  sortOrder?: number;
}): Promise<ApiResponse<MaterialItem>> {
  return request.post('/admin/bianbian/materials', data);
}

export function updateMaterial(
  id: string,
  data: Partial<{
    name: string;
    category: string;
    content: string;
    tags: string;
    icon: string;
    type: string;
    description: string;
    sortOrder: number;
    enabled: boolean;
  }>,
): Promise<ApiResponse<MaterialItem>> {
  return request.put(`/admin/bianbian/materials/${id}`, data);
}

export function deleteMaterial(id: string): Promise<ApiResponse<void>> {
  return request.delete(`/admin/bianbian/materials/${id}`);
}

// ========== 批量操作 ==========

export function batchSortMaterials(
  items: Array<{ id: string; sortOrder: number }>,
): Promise<ApiResponse<void>> {
  return request.put('/admin/bianbian/materials/sort', { items });
}

export function batchToggleMaterials(
  ids: string[],
  enabled: boolean,
): Promise<ApiResponse<{ affected: number }>> {
  return request.put('/admin/bianbian/materials/batch/toggle', { ids, enabled });
}

// ========== 初始化 ==========

export function seedMaterials(): Promise<ApiResponse<{ count: number }>> {
  return request.post('/admin/bianbian/seed');
}
