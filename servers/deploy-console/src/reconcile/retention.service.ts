import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/**
 * 数据保留策略（诊断 #18）。
 *
 * 背景：全仓此前**没有任何保留策略** —— `deploy_tasks`（含 logs JSON）、
 * `deploy_versions`、`audit_logs` 只增不减。增长不算快，但审计日志会一直涨，
 * 且 `deploy_tasks.logs` 里存的是完整构建输出（单条可达几十 KB）。
 *
 * 设计原则与 #10（远端产物保留）保持一致：
 * 1. **默认只观测**：`RETENTION_ENABLED=false` 时只统计「会删多少」，一条不删。
 *    删数据是不可逆的，先让人看到数字再决定开不开 —— 这是唯一安全的默认。
 * 2. **配置非法即拒绝**：`RETENTION_KEEP_DAYS < 1` 不执行（误配 0 = 全表清空）。
 * 3. **指针指向的版本永不清**（见 `protectedVersionKeys`）：
 *    `deploy_versions` 是回滚菜单的数据源，删掉当前/上一个版本 = 回滚入口直接少一项。
 * 4. **只删终态任务**：`running/pending` 的任务可能是活的，不能顺手清掉。
 */

export interface RetentionTableReport {
  table: string;
  /** 超过保留期、且不在保护名单里的行数 */
  candidates: number;
  /** 实际删除行数（未启用时为 0） */
  deleted: number;
  /** 因被保护而跳过的行数（指针指向的版本 / 非终态任务） */
  protectedRows: number;
  cutoff: string;
}

export interface RetentionReport {
  ranAt: number;
  enabled: boolean;
  keepDays: number;
  status: 'dry-run' | 'deleted' | 'skipped' | 'error';
  reason?: string;
  tables: RetentionTableReport[];
}

/** 保留期默认 90 天 */
export const DEFAULT_KEEP_DAYS = 90;
/** 巡检间隔默认 24 小时（<0 或 0 = 关闭定时） */
export const DEFAULT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 单批删除上限：避免一次大事务锁表 */
export const DEFAULT_BATCH_SIZE = 500;

/** 保留策略覆盖的表（时间列口径不同：ms 时间戳 vs datetime） */
const TABLES: Array<{
  table: string;
  /** 时间列 */
  column: string;
  /** 时间列口径 */
  kind: 'ms' | 'datetime';
  /** 额外保留条件（SQL 片段，直接拼在 WHERE 里） */
  guard?: string;
}> = [
  {
    table: 'deploy_tasks',
    column: 'start_time',
    kind: 'ms',
    // 只清终态：running/pending 可能是活的任务（对账服务还要回收它们）
    guard: "status IN ('success','failed','cancelled')",
  },
  { table: 'deploy_versions', column: 'released_at', kind: 'datetime' },
  { table: 'audit_logs', column: 'timestamp', kind: 'datetime' },
];

/** 时间列取值统一成毫秒（bigint 直接用；datetime 由 MySQL 转） */
function timeExpr(column: string, kind: 'ms' | 'datetime'): string {
  return kind === 'ms' ? `\`${column}\`` : `UNIX_TIMESTAMP(\`${column}\`) * 1000`;
}

/**
 * 保留期截止点（纯函数，便于单测）。
 * `keepDays < 1` 返回 null —— 调用方据此拒绝执行，避免「保留 0 天」把表清空。
 */
export function retentionCutoff(nowMs: number, keepDays: number): number | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(keepDays) || keepDays < 1) return null;
  return nowMs - Math.floor(keepDays) * 24 * 60 * 60 * 1000;
}

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private last: RetentionReport | undefined;

  constructor(
    private readonly cfg: ConfigService,
    @InjectDataSource() private readonly local: DataSource,
  ) {}

  onModuleInit(): void {
    const intervalRaw = Number(this.cfg.get<string>('RETENTION_INTERVAL_MS'));
    const interval = Number.isFinite(intervalRaw) && intervalRaw >= 0 ? intervalRaw : DEFAULT_RETENTION_INTERVAL_MS;
    if (interval <= 0) {
      this.logger.log('数据保留巡检已关闭（RETENTION_INTERVAL_MS=0）');
      return;
    }
    const run = () => {
      void this.run()
        .then((r) => {
          if (r.status === 'deleted') {
            this.logger.log(
              `数据保留：清理 ${r.tables.reduce((s, t) => s + t.deleted, 0)} 行（保留 ${r.keepDays} 天）`,
            );
          }
        })
        .catch((e) => this.logger.error(`数据保留巡检异常：${(e as Error).message}`));
    };
    const delayMs = Number(this.cfg.get<string>('RETENTION_FIRST_DELAY_MS')) || 120000;
    this.firstTimer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }, delayMs);
    (this.firstTimer as unknown as { unref?: () => void })?.unref?.();
    this.logger.log(
      `数据保留巡检已启用：每 ${Math.round(interval / 3600000)} 小时一次（RETENTION_ENABLED=${
        this.enabled ? 'true' : 'false（只观测）'
      }）`,
    );
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  lastReport(): RetentionReport | undefined {
    return this.last;
  }

  /** 是否真的删（默认 false = 只观测） */
  get enabled(): boolean {
    return (this.cfg.get<string>('RETENTION_ENABLED') || '').trim().toLowerCase() === 'true';
  }

  /** 保留天数（非法值回落默认） */
  get keepDays(): number {
    const raw = Number(this.cfg.get<string>('RETENTION_KEEP_DAYS'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_KEEP_DAYS;
  }

  /**
   * 指针指向的版本：这些 `deploy_versions` 行**永远不能删**。
   *
   * 为什么：`deploy_versions` 是回滚菜单的数据源（诊断 #17 的回滚入口读它），
   * 删掉当前版本 = 菜单里直接少一项，且「当前跑的是哪个版本」这条线索也断了。
   */
  async protectedVersionKeys(): Promise<Array<{ env: string; component: string; version: string }>> {
    const out: Array<{ env: string; component: string; version: string }> = [];
    // 新指针表（env-dir 与后端的当前版本都在这）
    const rows = (await this.local.query(
      'SELECT env_id, app_key, current_version, previous_version FROM deploy_app_env_versions',
    )) as Array<Record<string, unknown>>;
    for (const r of rows) {
      for (const v of [r.current_version, r.previous_version]) {
        if (v) out.push({ env: String(r.env_id), component: String(r.app_key), version: String(v) });
      }
    }
    // legacy 指针表
    const legacy = (await this.local.query(
      'SELECT env_id, module_key, current_version FROM deploy_deployments',
    )) as Array<Record<string, unknown>>;
    for (const r of legacy) {
      if (r.current_version) {
        out.push({
          env: String(r.env_id),
          component: String(r.module_key),
          version: String(r.current_version),
        });
      }
    }
    return out;
  }

  /** 执行一次保留巡检/清理（定时与手动共用） */
  async run(nowMs: number = Date.now()): Promise<RetentionReport> {
    const ranAt = Date.now();
    const keepDays = this.keepDays;
    const enabled = this.enabled;

    /**
     * 配置**显式但非法**时必须跳过，不能静默回落成 90 天。
     * 静默回落的后果：运维以为设了「保留 0 天」（想快速瘦身），
     * 实际跑的是 90 天 —— 预期与实际长期不符，且没人会发现。
     * 宁可不跑并报错，也不要跑一个不是你以为的策略。
     */
    const raw = (this.cfg.get<string>('RETENTION_KEEP_DAYS') ?? '').trim();
    const rawNum = Number(raw);
    const explicitInvalid = raw !== '' && (!Number.isFinite(rawNum) || rawNum < 1);
    const cutoff = retentionCutoff(nowMs, keepDays);

    if (explicitInvalid || cutoff === null) {
      const report: RetentionReport = {
        ranAt,
        enabled,
        keepDays,
        status: 'skipped',
        reason: `RETENTION_KEEP_DAYS=${raw || '(未配置)'} 非法（必须 ≥1 天）—— 不执行，避免误配把表清空`,
        tables: [],
      };
      this.last = report;
      return report;
    }

    try {
      const protectedKeys = await this.protectedVersionKeys();
      const tables: RetentionTableReport[] = [];
      let totalDeleted = 0;

      for (const t of TABLES) {
        const where = await this.buildWhere(t, cutoff, protectedKeys);
        const candidates = await this.count(t.table, where.sql, where.params);
        let deleted = 0;
        if (enabled && candidates > 0) {
          deleted = await this.deleteBatch(t.table, where.sql, where.params);
          totalDeleted += deleted;
        }
        tables.push({
          table: t.table,
          candidates,
          deleted,
          protectedRows: await this.protectedCount(t, cutoff, protectedKeys),
          cutoff: new Date(cutoff).toISOString(),
        });
      }

      const report: RetentionReport = {
        ranAt,
        enabled,
        keepDays,
        status: enabled ? (totalDeleted > 0 ? 'deleted' : 'dry-run') : 'dry-run',
        reason: enabled ? undefined : 'RETENTION_ENABLED≠true：只统计不删除（观测模式）',
        tables,
      };
      this.last = report;
      return report;
    } catch (e) {
      const report: RetentionReport = {
        ranAt,
        enabled,
        keepDays,
        status: 'error',
        reason: (e as Error).message,
        tables: [],
      };
      this.last = report;
      return report;
    }
  }

  /** 组装 WHERE（含终态/保护名单两类保留条件） */
  private async buildWhere(
    t: (typeof TABLES)[number],
    cutoff: number,
    protectedKeys: Array<{ env: string; component: string; version: string }>,
  ): Promise<{ sql: string; params: unknown[] }> {
    const params: unknown[] = [cutoff];
    let sql = `WHERE ${timeExpr(t.column, t.kind)} < ?`;
    if (t.guard) sql += ` AND (${t.guard})`;

    if (t.table === 'deploy_versions' && protectedKeys.length) {
      const parts: string[] = [];
      for (const k of protectedKeys) {
        parts.push('(env = ? AND component = ? AND version_tag = ?)');
        params.push(k.env, k.component, k.version);
      }
      sql += ` AND NOT (${parts.join(' OR ')})`;
    }
    return { sql, params };
  }

  /** 被保护而跳过的行数（观测模式下也要能看到「有多少条是因为保护才留下的」） */
  private async protectedCount(
    t: (typeof TABLES)[number],
    cutoff: number,
    protectedKeys: Array<{ env: string; component: string; version: string }>,
  ): Promise<number> {
    if (t.table !== 'deploy_versions' || !protectedKeys.length) return 0;
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const k of protectedKeys) {
      parts.push('(env = ? AND component = ? AND version_tag = ?)');
      params.push(k.env, k.component, k.version);
    }
    const rows = (await this.local.query(
      `SELECT COUNT(*) AS c FROM \`${t.table}\` WHERE ${timeExpr(t.column, t.kind)} < ? AND (${parts.join(' OR ')})`,
      [cutoff, ...params],
    )) as Array<{ c: number | string }>;
    return Number(rows[0]?.c ?? 0);
  }

  private async count(table: string, whereSql: string, params: unknown[]): Promise<number> {
    const rows = (await this.local.query(
      `SELECT COUNT(*) AS c FROM \`${table}\` ${whereSql}`,
      params,
    )) as Array<{ c: number | string }>;
    return Number(rows[0]?.c ?? 0);
  }

  /** 分批删除（单批上限可配，避免大事务长时间锁表） */
  private async deleteBatch(table: string, whereSql: string, params: unknown[]): Promise<number> {
    const raw = Number(this.cfg.get<string>('RETENTION_BATCH_SIZE'));
    const size = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BATCH_SIZE;
    let deleted = 0;
    // 循环删除直到本批不满：既受单批上限约束，也能最终清干净
    for (;;) {
      const res = (await this.local.query(
        `DELETE FROM \`${table}\` ${whereSql} LIMIT ${size}`,
        params,
      )) as { affectedRows?: number };
      const n = Number(res?.affectedRows ?? 0);
      deleted += n;
      if (n < size) break;
    }
    return deleted;
  }
}
