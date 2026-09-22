/**
 * 用户记忆（小程序 ↔ user-service）
 *
 * AI 每轮对话后异步提炼写入，用户在此查看 / 删除。
 * user-service 统一响应 { code, data, message }，故取 res.data。
 */
import { get, del } from '../utils/request';

export interface MemoryItem {
  id: number;
  category: string;
  content: string;
  confidence: number;
  createdAt: string;
}

/** user-service 统一响应包装 */
interface Wrapped<T> {
  code: number;
  data: T;
  message?: string;
}

const BASE = '/api/user-memory';

/** 我的记忆列表（分页，category 分组由页面做） */
export async function listMemory(page = 1, pageSize = 50): Promise<{ list: MemoryItem[]; total: number }> {
  const res = await get<Wrapped<{ list: MemoryItem[]; total: number }>>(`${BASE}?page=${page}&pageSize=${pageSize}`);
  return res?.data ?? { list: [], total: 0 };
}

/** 删除一条记忆 */
export async function removeMemory(id: number): Promise<boolean> {
  try {
    await del(`${BASE}/${id}`);
    return true;
  } catch {
    return false;
  }
}
