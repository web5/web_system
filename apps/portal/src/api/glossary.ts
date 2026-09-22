/**
 * 生词本 / 收藏（portal ↔ user-service）
 *
 * 收藏是用户主动行为数据，落 user-service（跟用户走）。
 * request 响应拦截器已拆包 { code, data, message } → 直接拿 data。
 */
import request from '@/api/request';

export interface GlossaryItem {
  id: number;
  sourceType: string;
  sourceText: string | null;
  enMain: string;
  note: string | null;
  meta: { tone?: string; direction?: string } | null;
  createdAt: string;
}

export interface CollectPayload {
  sourceType: 'chat' | 'translate';
  sourceText?: string;
  enMain: string;
  note?: string;
  meta?: Record<string, unknown>;
  conversationId?: string;
}

/** 收藏（幂等；返回 created=false 表示已在生词本） */
export async function collectGlossary(
  payload: CollectPayload,
): Promise<{ id: number; created: boolean; existed: boolean }> {
  return (await request.post('/glossary', payload)) as { id: number; created: boolean; existed: boolean };
}

/** 我的收藏列表（分页） */
export async function listGlossary(page = 1, pageSize = 50): Promise<{ list: GlossaryItem[]; total: number }> {
  return (await request.get(`/glossary?page=${page}&pageSize=${pageSize}`)) as { list: GlossaryItem[]; total: number };
}

/** 删除一条收藏（成功 true；失败/他人 404 返回 false） */
export async function removeGlossary(id: number): Promise<boolean> {
  try {
    await request.delete(`/glossary/${id}`);
    return true;
  } catch {
    return false;
  }
}
