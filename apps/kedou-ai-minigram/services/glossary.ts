/**
 * 生词本 / 收藏（小程序 ↔ user-service）
 *
 * 收藏是用户主动行为数据，落 user-service（跟用户走）。
 * user-service 统一响应 { code, data, message }，故取 res.data。
 */
import { get, post, del } from '../utils/request';

export interface GlossaryItem {
  id: number;
  sourceType: string;
  sourceText: string | null;
  enMain: string;
  note: string | null;
  meta: unknown;
  createdAt: string;
}

/** user-service 统一响应包装 */
interface Wrapped<T> {
  code: number;
  data: T;
  message?: string;
}

const BASE = '/api/glossary';

export interface CollectPayload {
  sourceType: 'chat' | 'translate';
  sourceText?: string;
  enMain: string;
  note?: string;
  meta?: Record<string, unknown>;
  conversationId?: string;
}

/** 收藏（幂等；返回 created=false 表示已在生词本） */
export async function collectGlossary(payload: CollectPayload): Promise<{ id: number; created: boolean; existed: boolean }> {
  const res = await post<Wrapped<{ id: number; created: boolean; existed: boolean }>>(BASE, payload);
  return res?.data ?? { id: 0, created: false, existed: false };
}

/** 我的收藏列表（分页） */
export async function listGlossary(page = 1, pageSize = 20): Promise<{ list: GlossaryItem[]; total: number }> {
  const res = await get<Wrapped<{ list: GlossaryItem[]; total: number }>>(`${BASE}?page=${page}&pageSize=${pageSize}`);
  return res?.data ?? { list: [], total: 0 };
}

/** 删除一条收藏（成功 true；失败/他人 404 返回 false） */
export async function removeGlossary(id: number): Promise<boolean> {
  try {
    await del(`${BASE}/${id}`);
    return true;
  } catch {
    return false;
  }
}
