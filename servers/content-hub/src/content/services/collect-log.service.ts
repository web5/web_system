/**
 * 采集批次日志服务（p35 · CQO）。
 *
 * 存在理由：`content_items` 记的是**条目**，不是**批次**。
 * 「今天采了多少 / 这次成功了没有 / 哪个源最近老失败」这三个问题无法从条目表回答，
 * 而它们是排查「采不到数据」时的第一现场。
 *
 * 归因职责分工：
 *   · 批次级（源挂了 / 超时 / 返回空 / 全部解析失败）→ collect_runs（本服务）
 *   · 条目级（这一条摘要生成失败）→ content_items.quality_*
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectRunEntity } from '../entities/collect-run.entity';
import {
  COLLECT_RUN_STATUS,
  COLLECT_TRIGGER,
  type CollectRunStatus,
  type CollectTrigger,
} from '../quality/quality.enum';

/** 一次采集批次的执行结果 */
export interface CollectRunInput {
  sourceCode: string;
  sourceName?: string;
  trigger?: CollectTrigger;
  itemCount?: number;
  dedupCount?: number;
  failCount?: number;
  errorMessage?: string;
  startedAt: Date;
  finishedAt: Date;
}

@Injectable()
export class CollectLogService {
  private readonly logger = new Logger(CollectLogService.name);

  constructor(
    @InjectRepository(CollectRunEntity)
    private readonly runRepo: Repository<CollectRunEntity>,
  ) {}

  /** 记一次成功批次 */
  async logSuccess(input: CollectRunInput): Promise<void> {
    await this.write(input, COLLECT_RUN_STATUS.OK);
  }

  /** 记一次失败批次（errorMessage 存技术错误原文，不做归因标签化） */
  async logFailure(input: CollectRunInput): Promise<void> {
    await this.write(input, COLLECT_RUN_STATUS.FAILED);
  }

  private async write(
    input: CollectRunInput,
    status: CollectRunStatus,
  ): Promise<void> {
    const duration = input.finishedAt.getTime() - input.startedAt.getTime();
    try {
      await this.runRepo.insert({
        source_code: input.sourceCode,
        source_name: input.sourceName ?? null,
        trigger_type: input.trigger ?? COLLECT_TRIGGER.SCHEDULE,
        status,
        item_count: input.itemCount ?? 0,
        dedup_count: input.dedupCount ?? 0,
        fail_count: input.failCount ?? 0,
        duration_ms: duration >= 0 ? duration : null,
        error_message: input.errorMessage ?? null,
        started_at: input.startedAt,
        finished_at: input.finishedAt,
      });
    } catch (e) {
      /**
       * 记日志失败**不能**抛异常打断采集主流程——否则「日志写不进去」会升级成
       * 「采集任务失败」，反而掩盖真实故障。这里只 warn，让采集结果照常落库。
       */
      this.logger.warn(
        `写collect_runs 失败 source=${input.sourceCode}: ${(e as Error).message}（不影响采集结果）`,
      );
    }
  }

  /** 最近批次（admin 采集日志区块用） */
  async listRecent(opts: {
    sourceCode?: string;
    limit?: number;
  }): Promise<CollectRunEntity[]> {
    const qb = this.runRepo
      .createQueryBuilder('r')
      .orderBy('r.started_at', 'DESC')
      .limit(Math.min(opts.limit ?? 50, 200));
    if (opts.sourceCode) qb.andWhere('r.source_code = :code', { code: opts.sourceCode });
    return qb.getMany();
  }

  /**
   * 每个源最近一次采集批次（admin 采集源列表「最近采集」列，p40）。
   *
   * 实现说明：按 started_at 倒序取最近 500 条，JS 侧按 source_code 取首条
   * （即每个源的最新一次）。当前量级（个位数源、日均几十批次）下 500 条
   * 足够覆盖全部源；若源数量级上涨再改 GROUP BY 子查询。
   */
  async lastBySource(): Promise<
    Record<
      string,
      {
        status: string;
        item_count: number;
        dedup_count: number;
        started_at: Date;
        error_message: string | null;
      }
    >
  > {
    const rows = await this.runRepo.find({
      order: { started_at: 'DESC' },
      take: 500,
    });
    const map: Record<
      string,
      {
        status: string;
        item_count: number;
        dedup_count: number;
        started_at: Date;
        error_message: string | null;
      }
    > = {};
    for (const r of rows) {
      if (!map[r.source_code]) {
        map[r.source_code] = {
          status: r.status,
          item_count: r.item_count,
          dedup_count: r.dedup_count,
          started_at: r.started_at,
          error_message: r.error_message,
        };
      }
    }
    return map;
  }

  /** 采集健康度：近 N 天成功率 + 今日失败次数（admin 健康度卡片用） */
  async health(days = 7): Promise<{
    windowDays: number;
    totalRuns: number;
    failedRuns: number;
    successRate: number;
    todayFailed: number;
    /** 近 N 天零采集的源 = 静默失效（源还在配置里但没跑了） */
    staleSources: Array<{ source_code: string; last_run_at: Date | null }>;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    /*
     * 🔴 这里不能按「窗口内」过滤后分组：窗口内有记录的源恰恰是**有在采集**的源，
     *    拿它当「零采集源」会得到语义相反的结果（2026-10-15 D2 评审发现并修）。
     *    正确做法：统计覆盖全部有记录的源，窗口内的量用 CASE WHEN 单独聚合，
     *    再由 JS 侧挑出「最后一次采集早于窗口起点」的源。
     *
     * 已知边界：从未跑过的源（collect_runs 里一行都没有）无法被这里发现 ——
     *    它只存在于 content_sources，要覆盖需 join 源表，见设计文档遗留项。
     */
    const rows = await this.runRepo
      .createQueryBuilder('r')
      .select('r.source_code', 'source_code')
      .addSelect('SUM(CASE WHEN r.started_at >= :since THEN 1 ELSE 0 END)', 'total')
      .addSelect(
        'SUM(CASE WHEN r.started_at >= :since AND r.status = :failed THEN 1 ELSE 0 END)',
        'failed',
      )
      .addSelect('MAX(r.started_at)', 'last_run')
      .groupBy('r.source_code')
      .setParameter('since', since)
      .setParameter('failed', COLLECT_RUN_STATUS.FAILED)
      .getRawMany<{
        source_code: string;
        total: string;
        failed: string;
        last_run: string;
      }>();

    const totalRuns = rows.reduce((n, r) => n + Number(r.total ?? 0), 0);
    const failedRuns = rows.reduce((n, r) => n + Number(r.failed ?? 0), 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayFailed = await this.runRepo
      .createQueryBuilder('r')
      .where('r.started_at >= :todayStart', { todayStart })
      .andWhere('r.status = :failed', { failed: COLLECT_RUN_STATUS.FAILED })
      .getCount();

    return {
      windowDays: days,
      totalRuns,
      failedRuns,
      successRate: totalRuns > 0 ? (totalRuns - failedRuns) / totalRuns : 0,
      todayFailed,
      /* 静默失效 = 最后一次采集早于窗口起点（近 N 天零采集） */
      staleSources: rows
        .filter((r) => !r.last_run || Number(new Date(r.last_run)) < Number(since))
        .map((r) => ({
          source_code: r.source_code,
          last_run_at: r.last_run ? new Date(r.last_run) : null,
        })),
    };
  }
}
