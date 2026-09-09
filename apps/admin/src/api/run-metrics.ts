/**
 * Admin - Agent 观测台（P2·D6.2 观测行）
 *
 * 后端：ai-service `GET /api/agent-runs/metrics?agentId=&startDate=&endDate=`（run_metrics 增量聚合表）
 */
import request from './request';

export interface RunMetricRow {
  agentId: string;
  model: string;
  source: string;
  date: string;
  runCount: number;
  okCount: number;
  errorCount: number;
  /** bigint → string */
  totalTokens: string;
  /** decimal → string */
  totalCost: string;
  totalDurationMs: number;
}

export interface MetricsQuery {
  agentId?: string;
  startDate?: string;
  endDate?: string;
}

export async function fetchRunMetrics(q: MetricsQuery): Promise<RunMetricRow[]> {
  const res: unknown = await request.get('/agent-runs/metrics', { params: q });
  const list = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data ?? [];
  return (Array.isArray(list) ? list : []) as RunMetricRow[];
}
