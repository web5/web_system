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

// ── 自媒体账号（只读注册表；凭据只回掩码）──
export interface ContentAccount {
  id: number;
  platform: string;
  code: string;
  name: string;
  identity: string | null;
  /** 掩码后的凭据（AppSecret 前 2 后 4），接口永不返回明文 */
  credentials_mask: string | null;
  /** 是否有已加密凭据（有密文但掩码为空也按"有"处理） */
  has_credentials: boolean;
  capabilities: string[] | null;
  last_checked_at: string | null;
  /** ok | warn | err | null（null = 未检测） */
  last_check_status: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function listAccounts(platform?: string): Promise<ContentAccount[]> {
  return request.get('/content-admin/content/accounts', {
    params: platform ? { platform } : {},
  });
}

// ── 手动跑管线（采集 → 成文 → 发布，一次跑完）──
export interface PipelineRunResult {
  pipeline: string;
  /** 采集到的条目数 */
  collected: number;
  /** 去重后新入库条目数 */
  newItems: number;
  errors: number;
  /** 成功发布的条数 */
  published: number;
}

/** 运行受理回执：只说明"接到了"，不含结果 */
export interface PipelineRunAccepted {
  job_id: number;
  pipeline_code: string;
  status: 'running';
  /** true = 该管线已有在跑任务，本次复用它（防重复点击变成重复发布） */
  reused: boolean;
}

/** 运行任务状态（轮询终点：status 变成 ok / failed） */
export interface PipelineRunJob {
  job_id: number;
  pipeline_code: string;
  status: 'running' | 'ok' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  /** 仍在跑时的已耗时（毫秒） */
  elapsed_ms: number | null;
  collected: number;
  new_items: number;
  published: number;
  errors: number;
  error_msg: string | null;
}

/**
 * 立即运行一次管线（**异步**）。
 *
 * 🔴 这是**真发布**：管线配置的发布目标会真的收到内容（公众号草稿箱或正式发布，
 *    取决于管线的发布模式）。所以调用方必须二次确认，不能做成静默按钮。
 * 🔴 为什么不等结果：一次完整运行 30 秒起步，而链路超时依次是 前端 10s /
 *    网关 content-admin 30s / nginx 60s —— 同步等会让请求先被掐断，
 *    前端只看到「网络错误」，后端却仍在跑、内容仍会投出去。改为受理即返回 job_id，
 *    由调用方轮询 getPipelineRunJob 拿结果。
 * 🔴 请求体给 `{}` 而不是 `null` —— 原因同 republish（#428）：axios 会把 null
 *    序列化成裸字符串 "null"，网关 body-parser strict 模式直接 400。
 */
export function runPipeline(code: string): Promise<PipelineRunAccepted> {
  return request.post(`/content-admin/content/run/${code}`, {});
}

/** 查询一次运行的结果 */
export function getPipelineRunJob(jobId: number): Promise<PipelineRunJob> {
  return request.get(`/content-admin/content/run/job/${jobId}`);
}

/** 最近运行记录（回答"刚才那次跑了没 / 跑了多久"） */
export function listPipelineRuns(pipeline?: string, take = 10): Promise<PipelineRunJob[]> {
  return request.get('/content-admin/content/run/recent', {
    params: { ...(pipeline ? { pipeline } : {}), take },
  });
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

export interface PublicationFailure {
  /** 机器码（如微信 errcode 48001），抓不到为 null */
  code: string | null;
  /** 后端脱敏后的可读原因（凭证/路径已替换为 ***） */
  message: string;
  /** 失败时间（ISO） */
  at: string | null;
}

export interface PublicationPreview {
  id: number;
  target: string;
  status: string;
  external_id: string | null;
  published_at: string;
  title: string;
  html: string;
  /** stored 分支与 none 分支拿不到条数（后端返回 null），只有 aggregated 有 */
  item_count: number | null;
  /**
   * stored=发布留存的 payload 直渲染（**存的是发布当时的产物**，渲染器升级后不会自己变）；
   * aggregated=按管线+日期聚合现场重建；none=无内容。
   * ⚠️ 后端返回的是 `'stored'`，此前这里误写成 `'payload'`，会让按 source 分支的判断失效。
   */
  source: 'stored' | 'aggregated' | 'none';
  /** 仅 status=failed 时有值；其余为 null（#405） */
  failure: PublicationFailure | null;
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
  // ⚠️ 请求体必须是空对象 {}，不能写 null / undefined 占位。
  // 原因（#428）：axios 实例默认 Content-Type: application/json，transformRequest
  // 会把 null 序列化成裸字符串 "null" 发出去；网关 body-parser 默认 strict:true
  // 只接受顶层对象/数组，于是直接 400，前端只看到
  // `Unexpected token 'n', "null" is not valid JSON`（mode 走 query，本来不需要 body）。
  return request.post(`/content-admin/content/publications/${id}/republish`, {}, {
    params: { mode },
  });
}

/**
 * 按当前渲染器重建成文（#431）。
 *
 * 只重算库里 `detail.payload` 的标题 + HTML 并写回，**不投递、不产生新记录**。
 * 用于存量记录：它们在发布当时就把 HTML 渲染好存下来了，之后渲染器修的问题
 * （裸 URL 链接化、`{{date}}` 替换）对它们无效，只能重算一遍。
 *
 * 请求体给 `{}` 而不是 `null` —— 原因同上面 republish（#428）。
 */
export function rebuildPublication(id: number): Promise<{
  ok: boolean;
  id: number;
  title: string;
  /** 标题是否真的变了（false = 本来就是新的，重复点不会假装成功） */
  title_changed: boolean;
  /** HTML 是否真的变了 */
  html_changed: boolean;
}> {
  return request.post(`/content-admin/content/publications/${id}/rebuild`, {});
}
