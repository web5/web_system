/**
 * Admin - 字典 / 维表配置
 *
 * 后端：system-service `admin/dict`（gateway `/api/admin/dict` → system-service）
 * 权限：system:dict:view（查看，含 editor/viewer）/ system:dict:manage（维护，仅 admin 级）
 */
import request from './request';

export type DictFieldType = 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'date';

export type DictAttrValue = string | number | boolean | null;

export interface DictTypeItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  builtin: boolean;
  enabled: boolean;
  sort: number;
  itemsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DictFieldDef {
  id: string;
  typeCode: string;
  name: string;
  label: string;
  type: DictFieldType;
  length: number | null;
  required: boolean;
  defaultValue: string | null;
  options: string[] | null;
  sort: number;
}

export interface DictItemRow {
  id: string;
  typeCode: string;
  value: string;
  label: string;
  attrs: Record<string, DictAttrValue> | null;
  remark: string | null;
  enabled: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DictTypePayload {
  code: string;
  name: string;
  description?: string;
  sort?: number;
  enabled?: boolean;
}

export interface DictFieldPayload {
  name: string;
  label: string;
  type: DictFieldType;
  length?: number;
  required?: boolean;
  defaultValue?: string;
  options?: string[];
  sort?: number;
}

export interface DictItemPayload {
  typeCode: string;
  value: string;
  label: string;
  attrs?: Record<string, DictAttrValue>;
  remark?: string;
  sort?: number;
  enabled?: boolean;
}

/** 后端统一返回 { code, data }，这里把 data 解出来；异常由 request 拦截器抛出 */
function unwrap<T>(res: unknown): T {
  const body = res as { data?: T } | T | null;
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export async function fetchDictTypes(keyword?: string): Promise<DictTypeItem[]> {
  const res: unknown = await request.get('/admin/dict/types', { params: { keyword: keyword || undefined } });
  const list = unwrap<DictTypeItem[]>(res);
  return Array.isArray(list) ? list : [];
}

export async function createDictType(body: DictTypePayload): Promise<DictTypeItem> {
  return unwrap<DictTypeItem>(await request.post('/admin/dict/types', body));
}

export async function updateDictType(
  id: string,
  body: Partial<Omit<DictTypePayload, 'code'>>,
): Promise<DictTypeItem> {
  return unwrap<DictTypeItem>(await request.put(`/admin/dict/types/${id}`, body));
}

export async function removeDictType(id: string): Promise<{ ok: boolean }> {
  return unwrap<{ ok: boolean }>(await request.delete(`/admin/dict/types/${id}`));
}

export async function fetchDictFields(code: string): Promise<DictFieldDef[]> {
  const res: unknown = await request.get(`/admin/dict/types/${code}/fields`);
  const list = unwrap<DictFieldDef[]>(res);
  return Array.isArray(list) ? list : [];
}

/** 整体覆盖保存字段定义（前端提交最终态） */
export async function replaceDictFields(
  code: string,
  fields: DictFieldPayload[],
): Promise<DictFieldDef[]> {
  const res: unknown = await request.put(`/admin/dict/types/${code}/fields`, { fields });
  const list = unwrap<DictFieldDef[]>(res);
  return Array.isArray(list) ? list : [];
}

export async function fetchDictItems(
  code: string,
  params: { keyword?: string; enabled?: boolean; page?: number; pageSize?: number },
): Promise<Paged<DictItemRow>> {
  const res: unknown = await request.get(`/admin/dict/types/${code}/items`, { params });
  return unwrap<Paged<DictItemRow>>(res);
}

export async function createDictItem(body: DictItemPayload): Promise<DictItemRow> {
  return unwrap<DictItemRow>(await request.post('/admin/dict/items', body));
}

export async function updateDictItem(
  id: string,
  body: Partial<Omit<DictItemPayload, 'typeCode' | 'value'>>,
): Promise<DictItemRow> {
  return unwrap<DictItemRow>(await request.put(`/admin/dict/items/${id}`, body));
}

export async function removeDictItem(id: string): Promise<{ ok: boolean }> {
  return unwrap<{ ok: boolean }>(await request.delete(`/admin/dict/items/${id}`));
}

/** 长度类字段的展示单位（number=位，其余=字符） */
export function lengthUnit(type: DictFieldType): string {
  return type === 'number' ? '位' : '字符';
}
