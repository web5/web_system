/**
 * 用户记忆（portal ↔ user-service）
 *
 * AI 每轮对话后异步提炼写入，用户在此查看 / 删除。
 */
import request from '@/api/request';

export interface MemoryItem {
  id: number;
  category: string;
  content: string;
  confidence: number;
  createdAt: string;
}

/** 我的记忆列表（分页，category 分组由页面做） */
export async function listMemory(page = 1, pageSize = 50): Promise<{ list: MemoryItem[]; total: number }> {
  return (await request.get(`/user-memory?page=${page}&pageSize=${pageSize}`)) as { list: MemoryItem[]; total: number };
}

/** 删除一条记忆（成功 true；失败/他人 404 返回 false） */
export async function removeMemory(id: number): Promise<boolean> {
  try {
    await request.delete(`/user-memory/${id}`);
    return true;
  } catch {
    return false;
  }
}
