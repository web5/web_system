import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';

export interface MetricsQuery {
  env?: string;
  moduleKey?: string;
  /** 起始时间（毫秒时间戳） */
  from?: number;
  /** 结束时间（毫秒时间戳） */
  to?: number;
}

export interface ReleaseOverview {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  cancelled: number;
  /** 成功率 0~1；无终态记录时为 null */
  successRate: number | null;
  avgDurationSec: number | null;
  p95DurationSec: number | null;
}

export interface TrendPoint {
  date: string;
  succeeded: number;
  failed: number;
}

export interface StageFailure {
  stage: string;
  count: number;
}

export interface ModuleFrequency {
  moduleKey: string;
  count: number;
}

export interface FailureRecord {
  id: string;
  moduleKey: string;
  env: string;
  versionTag: string | null;
  stage: string | null;
  error: string | null;
  startTime: number;
  endTime: number | null;
  operator: string | null;
}

/**
 * 成功率：仅统计终态（succeeded / failed）。
 *
 * 无终态记录时返回 **null 而不是 0**——0 会被误读成"全部失败"，
 * 而"还没跑完"与"全挂了"是两件完全不同的事。
 */
export function calcSuccessRate(succeeded: number, failed: number): number | null {
  const done = succeeded + failed;
  if (done === 0) return null;
  return succeeded / done;
}

export function calcAvg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 百分位数（线性插值）；空数组返回 null */
export function calcPercentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** 默认统计窗口：30 天 */
export const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 发布度量服务。
 *
 * 数据源就是 `deploy_pipelines`——流水线本就已完整记录 status / stage / 起止时间，
 * 因此**不需要任何额外的埋点或采集**，聚合即可（索引已覆盖 env / module_key / status / start_time）。
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectRepository(DeployPipelineEntity)
    private readonly repo: Repository<DeployPipelineEntity>,
  ) {}

  /** 构造 WHERE（全部参数化，杜绝 SQL 注入） */
  private buildWhere(q: MetricsQuery): { sql: string; params: unknown[] } {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q.env) {
      conds.push('env = ?');
      params.push(q.env);
    }
    if (q.moduleKey) {
      conds.push('module_key = ?');
      params.push(q.moduleKey);
    }
    if (q.from !== undefined) {
      conds.push('start_time >= ?');
      params.push(q.from);
    }
    if (q.to !== undefined) {
      conds.push('start_time <= ?');
      params.push(q.to);
    }
    return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  }

  async overview(q: MetricsQuery = {}): Promise<ReleaseOverview> {
    const { sql, params } = this.buildWhere(q);
    const rows = await this.repo.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('pending','running') THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM deploy_pipelines ${sql}`,
      params,
    );
    const r = rows?.[0] ?? {};
    const succeeded = Number(r.succeeded ?? 0);
    const failed = Number(r.failed ?? 0);

    // 时长只统计成功发布：失败发布往往很快中断，其时长没有参考意义
    const durs = await this.repo.query(
      `SELECT (end_time - start_time) / 1000 AS d
       FROM deploy_pipelines
       ${sql ? `${sql} AND` : 'WHERE'} status = 'succeeded' AND end_time IS NOT NULL`,
      params,
    );
    const values = (durs ?? [])
      .map((x: { d: string | number }) => Number(x.d))
      .filter((n: number) => Number.isFinite(n) && n >= 0);
    const avg = calcAvg(values);
    const p95 = calcPercentile(values, 95);

    return {
      total: Number(r.total ?? 0),
      succeeded,
      failed,
      running: Number(r.running ?? 0),
      cancelled: Number(r.cancelled ?? 0),
      successRate: calcSuccessRate(succeeded, failed),
      avgDurationSec: avg === null ? null : Math.round(avg),
      p95DurationSec: p95 === null ? null : Math.round(p95),
    };
  }

  async trend(q: MetricsQuery = {}): Promise<TrendPoint[]> {
    const { sql, params } = this.buildWhere(q);
    const rows = await this.repo.query(
      `SELECT FROM_UNIXTIME(start_time / 1000, '%Y-%m-%d') AS date,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM deploy_pipelines ${sql}
       GROUP BY date ORDER BY date ASC`,
      params,
    );
    return (rows ?? []).map((r: any) => ({
      date: String(r.date),
      succeeded: Number(r.succeeded ?? 0),
      failed: Number(r.failed ?? 0),
    }));
  }

  /** 失败集中在哪个阶段——定位问题最重要的一个视角 */
  async stageFailures(q: MetricsQuery = {}): Promise<StageFailure[]> {
    const { sql, params } = this.buildWhere(q);
    const rows = await this.repo.query(
      `SELECT COALESCE(stage, '(未知)') AS stage, COUNT(*) AS count
       FROM deploy_pipelines
       ${sql ? `${sql} AND` : 'WHERE'} status = 'failed'
       GROUP BY stage ORDER BY count DESC`,
      params,
    );
    return (rows ?? []).map((r: any) => ({
      stage: String(r.stage),
      count: Number(r.count ?? 0),
    }));
  }

  async topModules(q: MetricsQuery = {}, limit = 10): Promise<ModuleFrequency[]> {
    const { sql, params } = this.buildWhere(q);
    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 10;
    const rows = await this.repo.query(
      `SELECT module_key AS moduleKey, COUNT(*) AS count
       FROM deploy_pipelines ${sql}
       GROUP BY module_key ORDER BY count DESC LIMIT ${safeLimit}`,
      params,
    );
    return (rows ?? []).map((r: any) => ({
      moduleKey: String(r.moduleKey),
      count: Number(r.count ?? 0),
    }));
  }

  /**
   * 失败下钻：从"某阶段失败了 N 次"到"具体是哪几次、错误是什么"。
   * 没有这一步，度量就只是好看的数字，无法闭环到行动。
   */
  async failures(q: MetricsQuery & { stage?: string } = {}, limit = 20): Promise<FailureRecord[]> {
    const conds: string[] = ['status = ?'];
    const params: unknown[] = ['failed'];
    if (q.env) {
      conds.push('env = ?');
      params.push(q.env);
    }
    if (q.moduleKey) {
      conds.push('module_key = ?');
      params.push(q.moduleKey);
    }
    if (q.stage) {
      conds.push('stage = ?');
      params.push(q.stage);
    }
    if (q.from !== undefined) {
      conds.push('start_time >= ?');
      params.push(q.from);
    }
    if (q.to !== undefined) {
      conds.push('start_time <= ?');
      params.push(q.to);
    }
    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 200) : 20;

    const rows = await this.repo.query(
      `SELECT id, module_key AS moduleKey, env, version_tag AS versionTag, stage, error,
              start_time AS startTime, end_time AS endTime, operator
       FROM deploy_pipelines
       WHERE ${conds.join(' AND ')}
       ORDER BY start_time DESC
       LIMIT ${safeLimit}`,
      params,
    );
    return (rows ?? []).map((r: any) => ({
      id: String(r.id),
      moduleKey: String(r.moduleKey),
      env: String(r.env),
      versionTag: r.versionTag ?? null,
      stage: r.stage ?? null,
      error: r.error ?? null,
      startTime: Number(r.startTime),
      endTime: r.endTime === null ? null : Number(r.endTime),
      operator: r.operator ?? null,
    }));
  }
}
