/**
 * 财经链路桥接服务（p35 · CQO）—— 双写期专用。
 *
 * 🔴 **红线：不改 `finnews.service.ts`（370 行）**。
 * 那370 行承载情绪分析、板块识别、实体抽取，是财经链路的全部业务价值所在。
 * 双写期只增不改：新套 ICollector 同步把内容写进 `content_items`，
 * 旧的 `topics` / `news` 由 `FinnewsService.collectOnce()` 照常写。
 *
 * 为什么用适配器而不是直接改造旧 collector：
 *   旧 collector 不实现 ICollector、不产 external_id，直接改会牵动情绪分析链路。
 *   先双写（两边都跑）+ 行数对账，验证稳定后再考虑合并。
 *
 * 归因职责：本服务负责「写入时填 quality_*」——
 *   采集成功 → quality_status='ok'（后续 LLM 处理阶段由 scheduler 更新）
 *   采集失败 → 'fail' + quality_stage='collect'
 *   重复命中 → 'skip' + quality_stage='dedup'
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { createHash } from 'node:crypto';
import { ContentItemEntity } from '../entities/content-item.entity';
import { SinaCollector } from '../collectors/sina.collector';
import { EastmoneyNewsCollector } from '../collectors/eastmoney-news.collector';
import { CollectLogService } from './collect-log.service';
import { simhash } from '../../common/dedup';
import { RawItem } from '../collectors/collector.interface';
import {
  COLLECT_TRIGGER,
  QUALITY_STAGE,
  QUALITY_STATUS,
  type CollectTrigger,
  type QualityStatus,
} from '../quality/quality.enum';

/** 双写对账结果 */
export interface ReconcileResult {
  sourceCode: string;
  /** 旧套产出的条数（collectAll 返回） */
  legacyTotal: number;
  /** 新套实际写入 content_items 的条数 */
  newWritten: number;
  /** 因唯一键冲突跳过（已采集过） */
  dedupSkipped: number;
  /** 因失败落 fail 的条数 */
  failed: number;
  /** 对账是否一致（legacyTotal === newWritten + dedupSkipped） */
  consistent: boolean;
}

@Injectable()
export class FinnewsAdapterService {
  private readonly logger = new Logger(FinnewsAdapterService.name);

  constructor(
    @InjectRepository(ContentItemEntity)
    private readonly itemRepo: Repository<ContentItemEntity>,
    private readonly collectLog: CollectLogService,
  ) {}

  /**
   * 采集并写入 content_items（**不触碰** topics/news）。
   *
   * @param pipelineId 归属管线（进 (pipeline_id, external_id) 唯一键）；传 null 表示
   *                   手动触发、不归入固定管线，只保证内容有质量归因
   * @param opts.trigger 触发方式，写进 collect_runs
   */
  async syncToContentItems(
    pipelineId: number | null,
    opts: { trigger?: CollectTrigger; limit?: number } = {},
  ): Promise<ReconcileResult[]> {
    const trigger = opts.trigger ?? COLLECT_TRIGGER.SCHEDULE;
    const collectors = [new SinaCollector(), new EastmoneyNewsCollector()];
    const results: ReconcileResult[] = [];

    for (const collector of collectors) {
      const startedAt = new Date();
      const sourceCode = collector.code;

      let items: RawItem[] = [];
      let collectError: string | null = null;
      try {
        items = await collector.collect({}, opts.limit ?? 50);
      } catch (e) {
        // 采集器内部已按约定 return []，走到这里说明是意外异常（如 JSON 解析崩了）
        collectError = (e as Error).message;
      }
      const finishedAt = new Date();

      if (collectError || items.length === 0) {
        await this.collectLog.logFailure({
          sourceCode,
          sourceName: items[0]?.source_name,
          trigger,
          itemCount: 0,
          errorMessage: collectError ?? '采集返回空（源不可达或解析失败）',
          startedAt,
          finishedAt,
        });
        results.push({
          sourceCode,
          legacyTotal: items.length,
          newWritten: 0,
          dedupSkipped: 0,
          failed: 0,
          consistent: true, // 返回空不算不一致，属正常情况
        });
        continue;
      }

      const { written, skipped, failed } = await this.persistItems(items, pipelineId);

      await this.collectLog.logSuccess({
        sourceCode,
        sourceName: items[0]?.source_name,
        trigger,
        itemCount: items.length,
        dedupCount: skipped,
        failCount: failed,
        startedAt,
        finishedAt,
      });

      results.push({
        sourceCode,
        legacyTotal: items.length,
        newWritten: written,
        dedupSkipped: skipped,
        failed,
        consistent: written + skipped + failed === items.length,
      });
    }

    return results;
  }

  /** 逐条写入：唯一键冲突算skip，其余失败算 fail */
  private async persistItems(
    items: RawItem[],
    pipelineId: number | null,
  ): Promise<{ written: number; skipped: number; failed: number }> {
    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of items) {
      // SimHash 近似去重（精确去重靠唯一索引，SimHash 抓「改写重复」）
      const simhashFingerprint = simhash(item.content ?? item.title);

      const row: Partial<ContentItemEntity> = {
        pipeline_id: pipelineId,
        external_id: item.external_id,
        title: item.title.slice(0, 500),
        url: item.url ?? null,
        content: item.content,
        simhash: simhashFingerprint,
        source_name: item.source_name,
        publish_date: item.publish_date ?? null,
        status: 'pending',
        quality_status: QUALITY_STATUS.OK as QualityStatus,
        quality_stage: QUALITY_STAGE.COLLECT,
        quality_issue: null,
        raw_hash: createHash('sha256').update(item.content ?? '').digest('hex').slice(0, 64),
        collect_duration_ms: null,
      };

      try {
        await this.itemRepo.insert(row);
        written++;
      } catch (e) {
        const err = e as { code?: string; message?: string };
        // 1062 = Duplicate entry → 唯一键命中，说明这条已采集过
        if (err.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(err.message ?? '')) {
          await this.markAsSkip(item, pipelineId, err.message ?? '唯一键冲突');
          skipped++;
          continue;
        }
        // 其他错误：记 fail 但不中断整批（一条失败不该拖垮这次采集）
        this.logger.warn(
          `写入失败 source=${item.source_name} external_id=${item.external_id}: ${err.message}`,
        );
        await this.markAsFail(item, pipelineId, err.message ?? '写入失败');
        failed++;
      }
    }

    return { written, skipped, failed };
  }

  /** 已采集过：补一条 skip 标记（不改内容字段，避免污染历史记录） */
  private async markAsSkip(
    item: RawItem,
    pipelineId: number | null,
    reason: string,
  ): Promise<void> {
    try {
      await this.itemRepo.update(
        // pipeline_id 可为 null（手动触发），用 IsNull() 显式匹配而非传 null
        { pipeline_id: pipelineId === null ? IsNull() : pipelineId, external_id: item.external_id },
        {
          quality_status: QUALITY_STATUS.SKIP,
          quality_stage: QUALITY_STAGE.DEDUP,
          quality_issue: reason.slice(0, 255),
        },
      );
    } catch (e) {
      this.logger.warn(`标记 skip 失败：${(e as Error).message}`);
    }
  }

  /** 写入失败：插一条 fail 记录（用新的 external_id 后缀避免撞唯一键） */
  private async markAsFail(
    item: RawItem,
    pipelineId: number | null,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.itemRepo.insert({
        pipeline_id: pipelineId,
        // 加 #fail 后缀让失败记录能落库，同时与成功记录可区分
        external_id: `${item.external_id}#fail`,
        title: item.title.slice(0, 500),
        url: item.url ?? null,
        content: item.content,
        source_name: item.source_name,
        publish_date: item.publish_date ?? null,
        status: 'failed',
        // error 存技术错误原文，quality_issue 存归因标签——两者分工不混写
        error: errorMessage.slice(0, 512),
        quality_status: QUALITY_STATUS.FAIL,
        quality_stage: QUALITY_STAGE.COLLECT,
        quality_issue: '采集或写入失败',
        raw_hash: createHash('sha256').update(item.content ?? '').digest('hex').slice(0, 64),
      } satisfies Partial<ContentItemEntity>);
    } catch (e) {
      this.logger.warn(`记fail 记录失败：${(e as Error).message}`);
    }
  }
}
