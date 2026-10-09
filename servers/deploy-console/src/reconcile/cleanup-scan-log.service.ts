import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployCleanupScanEntity } from '../entities/deploy-cleanup-scan.entity';
import { RetentionReport } from './retention.service';

/**
 * 清理巡检留痕（诊断 #18 / #10 的观测配套）。
 *
 * 为什么要有这张表：
 * 保留策略与远端产物清理都是**删数据**的动作，我们给它们定的默认是「只观测」。
 * 观测的价值在于「先看几天再决定开不开」—— 但如果每次的结论只在响应里，
 * 7 天对比就只能靠人手工抄。落库之后，每天的数字自己会排成一条曲线。
 *
 * 设计取舍：
 * 1. **写库失败只告警不阻断**（与审计同一取舍）：留痕挂了不该让巡检跑不了，
 *    更不该让流水线红掉。故 `record` 永远不抛，失败时返回一份只存在于内存的记录。
 * 2. **候选清单要截断**（`MAX_ITEMS`）：一次巡检可能算出上万条，全存会把表撑爆，
 *    而真要排查时前几百条已经够定位。截断会留下 `…` 标记，不许假装完整。
 * 3. **不参与控制流**：本表只记结论，不决定删不删。
 */

/** 候选清单最大落库条数（超出截断并标记，避免单行 JSON 过大） */
export const MAX_ITEMS = 300;

export interface CleanupScanSummaryRow {
  /** 维度键：retention 为表名，remote 为模块 key */
  key: string;
  /** 候选数（超过保留期 / 超出保留份数且不在保护名单里） */
  candidates: number;
  /** 实际删除数（观测模式为 0） */
  deleted?: number;
  /** 因保护而留下的数量（指针版本 / 非终态任务） */
  protectedRows?: number;
  /** 远端扫描到的条目数（remote 专用） */
  scanned?: number;
  /** 备注（如保留截止时间） */
  note?: string;
}

export interface SaveScanInput {
  kind: 'retention' | 'remote';
  env?: string;
  component?: string;
  status: string;
  dryRun: boolean;
  reason?: string;
  summary?: CleanupScanSummaryRow[];
  items?: string[];
  operator?: string;
  scanTime?: number;
}

export interface RemoteScanOutcome {
  moduleKey: string;
  /** 远端扫描到的条目数 */
  scanned: number;
  keep: string[];
  remove: string[];
  reason?: string;
  /** 远端目录（脱敏后仅用于展示） */
  dir?: string;
}

/** 巡检 ID：与 deploy_tasks 同风格的自然键（便于日志里对着找） */
export function newScanId(nowMs: number = Date.now()): string {
  return `scan-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable()
export class CleanupScanLogService {
  private readonly logger = new Logger(CleanupScanLogService.name);

  constructor(
    @InjectRepository(DeployCleanupScanEntity)
    private readonly repo: Repository<DeployCleanupScanEntity>,
  ) {}

  /**
   * 落一条巡检记录。
   *
   * ⚠️ 永不抛错：留痕是辅助手段，不能反过来把主流程拖死。
   * 写库失败时返回内存对象（调用方照样能拿到结论用于响应/日志）。
   */
  async record(input: SaveScanInput): Promise<DeployCleanupScanEntity> {
    const summary = input.summary ?? [];
    const rawItems = input.items ?? [];
    const truncated = rawItems.length > MAX_ITEMS;
    const items = truncated
      ? [...rawItems.slice(0, MAX_ITEMS), `…（另有 ${rawItems.length - MAX_ITEMS} 条未列出，见日志）`]
      : rawItems;

    const entity = this.repo.create({
      id: newScanId(input.scanTime ?? Date.now()),
      kind: input.kind,
      env: input.env ?? '*',
      component: input.component ?? '*',
      status: input.status,
      dryRun: input.dryRun,
      reason: input.reason,
      summary,
      items,
      candidateCount: summary.reduce((s, r) => s + (r.candidates ?? 0), 0),
      deletedCount: summary.reduce((s, r) => s + (r.deleted ?? 0), 0),
      operator: input.operator ?? 'system',
      scanTime: input.scanTime ?? Date.now(),
    });

    try {
      return await this.repo.save(entity);
    } catch (e) {
      // 只告警：巡检结论已经算出来了，不能因为落库失败就当作没跑过
      this.logger.warn(`清理巡检留痕写入失败（结论仍返回）：${(e as Error).message}`);
      return entity;
    }
  }

  /** 数据保留巡检 → 留痕（每表一行汇总；行级明细不落库，量太大且无定位价值） */
  async recordRetention(report: RetentionReport, operator?: string): Promise<DeployCleanupScanEntity> {
    return this.record({
      kind: 'retention',
      env: '*',
      component: '*',
      status: report.status,
      dryRun: report.status !== 'deleted',
      reason: report.reason,
      summary: report.tables.map((t) => ({
        key: t.table,
        candidates: t.candidates,
        deleted: t.deleted,
        protectedRows: t.protectedRows,
        note: `保留 ${report.keepDays} 天，截止 ${t.cutoff}`,
      })),
      operator,
      scanTime: report.ranAt,
    });
  }

  /** 远端产物巡检 → 留痕（按模块汇总，候选清单落到 items 便于人工核对） */
  async recordRemote(
    env: string,
    outcomes: RemoteScanOutcome[],
    operator?: string,
  ): Promise<DeployCleanupScanEntity> {
    const items: string[] = [];
    const summary: CleanupScanSummaryRow[] = [];
    for (const o of outcomes) {
      for (const v of o.remove) items.push(`${o.moduleKey}:${v}`);
      summary.push({
        key: o.moduleKey,
        candidates: o.remove.length,
        deleted: 0, // 巡检只观测，真删由清理动作自己记
        scanned: o.scanned,
        note: o.reason ?? `保留 ${o.keep.length} 个${o.dir ? `（${o.dir}）` : ''}`,
      });
    }
    const reasons = outcomes.map((o) => o.reason).filter(Boolean) as string[];
    return this.record({
      kind: 'remote',
      env,
      component: outcomes.map((o) => o.moduleKey).join(','),
      status: reasons.length ? 'skipped' : 'dry-run',
      dryRun: true,
      reason: reasons.length ? reasons.join('；') : '巡检只观测，未执行删除',
      summary,
      items,
      operator,
    });
  }

  /** 历史列表（倒序） */
  async list(opts: { kind?: string; env?: string; limit?: number } = {}): Promise<DeployCleanupScanEntity[]> {
    const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0 ? Math.min(opts.limit as number, 500) : 50;
    const qb = this.repo.createQueryBuilder('s').orderBy('s.scanTime', 'DESC').limit(limit);
    if (opts.kind) qb.andWhere('s.kind = :kind', { kind: opts.kind });
    if (opts.env && opts.env !== '*') qb.andWhere('s.env = :env', { env: opts.env });
    try {
      return await qb.getMany();
    } catch (e) {
      // 表还没建出来（synchronize 时机）时不该让列表页 500
      this.logger.warn(`清理巡检记录读取失败：${(e as Error).message}`);
      return [];
    }
  }

  /** 单条详情 */
  async one(id: string): Promise<DeployCleanupScanEntity | null> {
    try {
      return await this.repo.findOne({ where: { id } });
    } catch (e) {
      this.logger.warn(`清理巡检记录读取失败（${id}）：${(e as Error).message}`);
      return null;
    }
  }
}
