/**
 * Admin - 内容采集源 / 管线（ContentHub）
 * 后端：content-hub 微服务（经 gateway /api/content-admin/* 用户 JWT 通道）
 * 接口前缀：/content-admin/content（pathRewrite 后落到 content-hub 的 /api/content/*）
 */
import request from './request';

export interface ContentSource {
  id: number;
  code: string;
  name: string;
  /** 采集器类型：arxiv / sina_news / eastmoney_news / eastmoney_lhb / hackernews / rss */
  type: string;
  /** 各源私有配置（JSON 对象） */
  config: Record<string, unknown> | null;
  /** 内容领域：论文 / 财经 / AI */
  category: string | null;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ContentPipeline {
  id: number;
  code: string;
  /** 管线类型：paper | ai-news */
  type: string;
  title_template: string | null;
  cron: string;
  llm_prompt: string | null;
  publish_targets: string[] | null;
  tencent_folder: string | null;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CollectRun {
  id: number;
  source_code: string;
  source_name: string;
  trigger_type: string;
  status: string;
  item_count: number;
  dedup_count: number;
  fail_count: number;
  duration_ms: number;
  error_message: string | null;
  started_at: string;
  finished_at: string;
}

// ── 采集源 ──
export function listSources(): Promise<ContentSource[]> {
  return request.get('/content-admin/content/sources');
}

export function createSource(dto: Partial<ContentSource>): Promise<ContentSource> {
  return request.post('/content-admin/content/sources', dto);
}

export function updateSource(id: number, dto: Partial<ContentSource>): Promise<ContentSource> {
  return request.patch(`/content-admin/content/sources/${id}`, dto);
}

export function deleteSource(id: number): Promise<{ ok: boolean }> {
  return request.delete(`/content-admin/content/sources/${id}`);
}

// ── 管线 ──
export function listPipelines(): Promise<ContentPipeline[]> {
  return request.get('/content-admin/content/pipelines');
}

export function createPipeline(dto: Partial<ContentPipeline>): Promise<ContentPipeline> {
  return request.post('/content-admin/content/pipelines', dto);
}

export function updatePipeline(id: number, dto: Partial<ContentPipeline>): Promise<ContentPipeline> {
  return request.patch(`/content-admin/content/pipelines/${id}`, dto);
}

export function deletePipeline(id: number): Promise<{ ok: boolean }> {
  return request.delete(`/content-admin/content/pipelines/${id}`);
}

// ── 手动触发采集 ──
export interface TriggerResult {
  source_code: string;
  status: 'ok' | 'empty' | 'failed' | 'rejected' | 'unknown';
  reason?: string;
  error?: string;
  results?: unknown;
  items?: number;
}

export function triggerCollect(sourceCode: string, limit = 20): Promise<TriggerResult> {
  return request.post(`/content-admin/content/collect/${sourceCode}`, { limit });
}

// ── 采集观测 ──
export interface CollectRunsResult {
  total: number;
  items: CollectRun[];
}

export function listCollectRuns(sourceCode?: string, limit = 50): Promise<CollectRunsResult> {
  return request.get('/content-admin/content/collect/runs', {
    params: sourceCode ? { source_code: sourceCode, limit } : { limit },
  });
}

export interface CollectHealth {
  windowDays: number;
  totalRuns: number;
  failedRuns: number;
  successRate: number;
  todayFailed: number;
  staleSources: Array<{ source_code: string; last_run_at: string | null }>;
}

export function collectHealth(days = 7): Promise<CollectHealth> {
  return request.get('/content-admin/content/collect/health', { params: { days } });
}
