/**
 * 用户记忆（portal ↔ user-service）
 *
 * AI 每轮对话后异步提炼写入，用户在此查看 / 编辑 / 删除自己的记忆与画像摘要。
 * 写能力归属（用户 2026-10-30 拍板）：admin 只读，portal/C 端用户可自己改。
 */
import request from '@/api/request';

export interface MemoryItem {
  id: number;
  category: string;
  content: string;
  confidence: number;
  createdAt: string;
}

/** 记忆摘要行（GET /user-memory/summary 的 data.summary；无摘要时为 null） */
export interface MemorySummary {
  id: number;
  namespace: string;
  summary: string;
  itemCount: number;
  version: number;
  lastItemAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 我的记忆列表（分页，category 分组由页面做） */
export async function listMemory(page = 1, pageSize = 50): Promise<{ list: MemoryItem[]; total: number }> {
  return (await request.get(`/user-memory?page=${page}&pageSize=${pageSize}`)) as { list: MemoryItem[]; total: number };
}

/** 我的记忆摘要（一用户一条，自动生成；无则 null） */
export async function getMyMemorySummary(): Promise<MemorySummary | null> {
  const res = (await request.get('/user-memory/summary')) as { summary: MemorySummary | null };
  return res?.summary ?? null;
}

/**
 * 编辑我的一条记忆内容（PATCH，trim 非空、≤500 字由后端校验）。
 *
 * silent=true：错误不弹全局提示，由视图按状态分支处理——
 *   404（越权/已删）→「无权修改该条记忆，可能已被删除」并退出编辑态；
 *   400（空值/超长/同内容撞车）→ 透传后端 message；
 *   其余 →「保存失败，请重试」，保留编辑态与已输入内容。
 */
export async function editMyMemory(id: number, content: string): Promise<MemoryItem> {
  const res = (await request.patch(`/user-memory/${id}`, { content }, { silent: true })) as {
    success: boolean;
    memory: MemoryItem;
  };
  return res.memory;
}

/** 触发重算我的记忆摘要（摘要不可手改，只能重算） */
export async function rebuildMySummary(): Promise<{ changed: boolean; skipped: boolean }> {
  const res = (await request.post('/user-memory/summary/rebuild', {})) as {
    success: boolean;
    changed: boolean;
    skipped: boolean;
  };
  return { changed: Boolean(res?.changed), skipped: Boolean(res?.skipped) };
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
