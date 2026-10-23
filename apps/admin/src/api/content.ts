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
  /** 发布模式：publish=直接发布，draft=只进公众号草稿箱 */
  publish_mode?: 'draft' | 'publish' | null;
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

export function getSource(id: number): Promise<ContentSource> {
  return request.get(`/content-admin/content/sources/${id}`);
}

export function getPipeline(id: number): Promise<ContentPipeline> {
  return request.get(`/content-admin/content/pipelines/${id}`);
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

// ── 试采（p40：仅预览，不入库）──
export interface TestSampleItem {
  external_id: string;
  title: string;
  url: string | null;
  publish_date: string | null;
  source_name: string;
  summary?: string | null;
}

export interface TestCollectResult {
  status: 'ok' | 'empty' | 'failed';
  items: TestSampleItem[];
  duration_ms: number;
  error?: string;
}

/**
 * 试采：按当前表单配置调采集器，返回预览条目。
 * 零副作用——不写 content_items / collect_runs，可在保存前验证配置。
 */
export function testCollect(body: {
  type: string;
  config?: Record<string, unknown>;
  limit?: number;
}): Promise<TestCollectResult> {
  return request.post('/content-admin/content/sources/test', body);
}

// ── 最近采集聚合（p40：列表页「最近采集」列）──
export interface LastCollectRow {
  source_code: string;
  status: string;
  item_count: number;
  finished_at: string | null;
  duration_ms: number;
}

/**
 * 每个源最近一次采集结果。
 * 🔴 路径与后端 `@Get('collect/last')` 保持一致 —— 原 `sources/last-collect`
 *    会被后端 `sources/:id` 通配抢先匹配，返回 500（2026-10-22 事故）。
 */
export function lastCollect(): Promise<{ items: LastCollectRow[] }> {
  return request.get('/content-admin/content/collect/last');
}

// ── 采集明细（p40：五维筛选 + 服务端分页）──
export interface ContentItem {
  id: number;
  external_id: string;
  title: string;
  url: string | null;
  summary: string | null;
  /** 采集原文（详情页展示；列表接口不返回正文，故为可选） */
  content?: string | null;
  source_id: number | null;
  source_name: string | null;
  pipeline_id: number | null;
  pipeline_code: string | null;
  publish_date: string | null;
  status: string;
  quality_status: string | null;
  quality_stage: string | null;
  quality_issue: string | null;
  collect_duration_ms: number | null;
  simhash: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListItemsParams {
  limit?: number;
  offset?: number;
  status?: string;
  quality_status?: string;
  quality_stage?: string;
  /** 管线 ID */
  pipeline?: number;
  /** 采集源 ID */
  source?: number;
  keyword?: string;
  date_from?: string;
  date_to?: string;
}

export function listItems(params: ListItemsParams = {}): Promise<{ total: number; items: ContentItem[] }> {
  return request.get('/content-admin/content/items', { params });
}

export function itemStats(): Promise<{
  today_new: number;
  today_dedup: number;
  quality_abnormal_7d: number;
  into_article_7d: number;
}> {
  return request.get('/content-admin/content/items/stats');
}

export interface ContentItemDetail {
  item: ContentItem;
  pipeline: { id: number; code: string; type: string } | null;
  source: { id: number; code: string; name: string; type: string } | null;
  publications: Publication[];
}

export function getItemDetail(id: number): Promise<ContentItemDetail> {
  return request.get(`/content-admin/content/items/${id}`);
}

// ── 公众号成文（p40：筛选分页 + 文章级预览 + 重发）──
export interface Publication {
  id: number;
  item_id: number;
  item_title: string | null;
  pipeline_id: number | null;
  target: string;
  status: string;
  external_id: string | null;
  /** 草稿 media_id（公众号草稿箱定位用，非草稿记录为 null） */
  media_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ListPublicationsParams {
  limit?: number;
  offset?: number;
  target?: string;
  status?: string;
}

export function listPublications(
  params: ListPublicationsParams = {},
): Promise<{ total: number; items: Publication[] }> {
  return request.get('/content-admin/content/publications', { params });
}

export interface PublicationPreview {
  id: number;
  target: string;
  status: string;
  external_id: string | null;
  published_at: string;
  title: string;
  html: string;
  item_count: number;
  /** payload=发布留存的原文；aggregated=按管线+日期聚合重建；none=无内容 */
  source: 'payload' | 'aggregated' | 'none';
}

export function publicationPreview(id: number): Promise<PublicationPreview> {
  return request.get(`/content-admin/content/publications/${id}/preview`);
}

/**
 * 重新发布。
 * mode='draft' 只把成文投递到公众号草稿箱（资质不足时的正常操作）；
 * mode='publish'（默认）建草稿后直接提交发布。两种都会产生一条新记录。
 */
export function republishPublication(
  id: number,
  mode: 'draft' | 'publish' = 'publish',
): Promise<{
  ok: boolean;
  success: boolean;
  publication_id: number;
  status: string;
  external_id: number | string | null;
  media_id: string | null;
  error: string | null;
}> {
  return request.post(`/content-admin/content/publications/${id}/republish`, null, {
    params: { mode },
  });
}
