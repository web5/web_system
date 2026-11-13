import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { valueFingerprint } from '../config/config.service';

/** config_items 行（比对所需的最小字段） */
export interface ConfigItemRow {
  scope: string;
  envId: string;
  moduleKey: string;
  key: string;
  /** 密文或明文原值（只取指纹，永不回显） */
  value: string | null;
}

/** config_revisions 行（比对所需的最小字段） */
export interface ConfigRevisionRow {
  scope: string;
  envId: string;
  moduleKey: string;
  key: string;
  action: string;
  afterFingerprint: string | null;
}

export interface ConfigAuditDiff {
  kind: 'unaudited-row' | 'resurrected-row' | 'value-drift' | 'unaudited-delete';
  /** 业务键 `scope/env/module/key` */
  businessKey: string;
  reason: string;
}

export interface ConfigAuditReport {
  ranAt: number;
  status: 'ok' | 'drift' | 'error';
  reason?: string;
  checkedRows: number;
  diffs: ConfigAuditDiff[];
}

/** 业务唯一键（与 config_items 唯一约束同口径：空串表示不适用） */
function bk(r: { scope: string; envId: string; moduleKey: string; key: string }): string {
  return `${r.scope}|${r.envId ?? ''}|${r.moduleKey ?? ''}|${r.key}`;
}

/**
 * config_items ↔ config_revisions 直写库检测（纯函数）。
 *
 * 背景（03 号文 S2）：13:51 有人直写库加配置（无审计），闸门拦住了后果但拦不住
 * 行为本身；且半发布无正规修复通道会**逼出**直写库。本检测只报告、不改数据。
 *
 * 判据（值一律走指纹比对，密文对密文，不解密不回显）：
 * - `unaudited-row`：行存在但无任何修订记录（直写新增）；
 * - `resurrected-row`：最新修订是 delete 但行又出现（直写复活）；
 * - `value-drift`：行值指纹 ≠ 最新修订 after_fingerprint（直写改值）；
 * - `unaudited-delete`：有修订但行已不在（直写删除；正规删除必落 action=delete 修订）。
 */
export function diffConfigAudit(
  items: ConfigItemRow[],
  latestRevisions: Map<string, ConfigRevisionRow>,
): ConfigAuditDiff[] {
  const diffs: ConfigAuditDiff[] = [];
  const itemKeys = new Set<string>();

  for (const item of items) {
    const key = bk(item);
    itemKeys.add(key);
    const rev = latestRevisions.get(key);
    if (!rev) {
      diffs.push({
        kind: 'unaudited-row',
        businessKey: key,
        reason: '配置行存在但 config_revisions 无任何修订记录（疑似直写库新增）',
      });
      continue;
    }
    if (rev.action === 'delete') {
      diffs.push({
        kind: 'resurrected-row',
        businessKey: key,
        reason: '最新修订为 delete 但配置行重新出现（疑似直写库复活已删除配置）',
      });
      continue;
    }
    const fp = valueFingerprint(item.value ?? '');
    if (rev.afterFingerprint && fp !== rev.afterFingerprint) {
      diffs.push({
        kind: 'value-drift',
        businessKey: key,
        reason: '配置行值指纹与最新修订不符（疑似直写库改值，未经配置中心通道）',
      });
    }
  }

  for (const [key, rev] of latestRevisions) {
    if (rev.action !== 'delete' && !itemKeys.has(key)) {
      diffs.push({
        kind: 'unaudited-delete',
        businessKey: key,
        reason: '配置行已不存在但无 delete 修订（疑似直写库删除）',
      });
    }
  }
  return diffs;
}

/** 默认巡检间隔 6 小时（`CONFIG_AUDIT_WATCH_INTERVAL_MS`，0 = 关闭） */
export const DEFAULT_CONFIG_AUDIT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FIRST_DELAY_MS = 120 * 1000;

/**
 * 直写库检测巡检（半发布治理 F3，2026-11-12，03 号文 S2）。
 *
 * 只观测、不改数据：drift 即 `logger.error` + `GET /api/reconcile/config-audit` 可查。
 * 正规修复通道 = 配置中心 UI / API（自动落修订）与指针修复入口（repairPointer）。
 */
@Injectable()
export class ConfigAuditWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfigAuditWatchService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private last: ConfigAuditReport | undefined;

  constructor(
    private readonly cfg: ConfigService,
    @InjectDataSource() private readonly local: DataSource,
  ) {}

  onModuleInit(): void {
    const raw = Number(this.cfg.get<string>('CONFIG_AUDIT_WATCH_INTERVAL_MS'));
    const interval =
      Number.isFinite(raw) && raw >= 0 && String(this.cfg.get('CONFIG_AUDIT_WATCH_INTERVAL_MS') ?? '') !== ''
        ? raw
        : DEFAULT_CONFIG_AUDIT_INTERVAL_MS;
    if (interval <= 0) {
      this.logger.log('直写库检测巡检已关闭（CONFIG_AUDIT_WATCH_INTERVAL_MS=0）');
      return;
    }
    const run = () => {
      void this.check().catch((e) => this.logger.error(`直写库检测异常：${(e as Error).message}`));
    };
    const delayMs = Number(this.cfg.get<string>('CONFIG_AUDIT_WATCH_FIRST_DELAY_MS')) || DEFAULT_FIRST_DELAY_MS;
    this.firstTimer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }, delayMs);
    (this.firstTimer as unknown as { unref?: () => void })?.unref?.();
    this.logger.log(`直写库检测巡检已启用：每 ${Math.round(interval / 60000)} 分钟一次`);
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  lastReport(): ConfigAuditReport | undefined {
    return this.last;
  }

  /** 执行一次比对（定时 / `GET /api/reconcile/config-audit?run=1` 共用） */
  async check(): Promise<ConfigAuditReport> {
    const ranAt = Date.now();
    try {
      const items = (await this.local.query(
        'SELECT scope, env_id AS envId, module_key AS moduleKey, `key`, `value` FROM config_items',
      )) as ConfigItemRow[];
      // 按业务键取最新一条修订（created_at 倒序后首个命中即最新）
      const revisions = (await this.local.query(
        'SELECT scope, env_id AS envId, module_key AS moduleKey, `key`, action, after_fingerprint AS afterFingerprint FROM config_revisions ORDER BY created_at DESC',
      )) as ConfigRevisionRow[];
      const latest = new Map<string, ConfigRevisionRow>();
      for (const r of revisions) {
        const key = bk(r);
        if (!latest.has(key)) latest.set(key, r);
      }

      const diffs = diffConfigAudit(items, latest);
      const report: ConfigAuditReport = {
        ranAt,
        status: diffs.length ? 'drift' : 'ok',
        checkedRows: items.length,
        diffs,
      };
      this.last = report;
      if (diffs.length) {
        this.logger.error(
          `直写库检测发现 ${diffs.length} 处无审计变更：` +
            diffs.slice(0, 10).map((d) => `${d.kind} ${d.businessKey}`).join('；') +
            '（本巡检不改数据；请走配置中心正规通道重写一次以补齐审计，或人工确认后登记）',
        );
      } else {
        this.logger.log(`直写库检测通过（config_items ${items.length} 行均有匹配审计）`);
      }
      return report;
    } catch (e) {
      const report: ConfigAuditReport = {
        ranAt,
        status: 'error',
        reason: (e as Error).message,
        checkedRows: 0,
        diffs: [],
      };
      this.last = report;
      this.logger.error(`直写库检测失败：${(e as Error).message}`);
      return report;
    }
  }
}
