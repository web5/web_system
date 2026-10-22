/**
 * content_items 通用落库服务（p40 从 FinnewsAdapterService 抽取）。
 *
 * 存在理由：落库 + 去重 + 归因的逻辑原本私有在 finnews 适配器里，但
 * 「手动触发采集」（arxiv / rss / hackernews / 龙虎榜）需要同一套
 * 「insert → 唯一键冲突记 skip → 其他错误记 fail」的语义。
 * 复制一遍会两份漂移（去重判据、fail 后缀、归因字段各改一半），
 * 因此抽成共享服务，两边都注入它。
 *
 * 归因分工（与 finnews adapter 注释保持一致）：
 *   · 写入成功 → quality_status='ok' / quality_stage='collect'
 *   · 唯一键冲突（已采集过）→ 'skip' / 'dedup'
 *   · 其他写入错误 → 'fail' / 'collect'（error 存原文，quality_issue 存归因标签）
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { createHash } from 'node:crypto';
import { ContentItemEntity } from '../entities/content-item.entity';
import { RawItem } from '../collectors/collector.interface';
import { simhash } from '../../common/dedup';
import {
  QUALITY_STAGE,
  QUALITY_STATUS,
  type QualityStatus,
} from '../quality/quality.enum';

export interface PersistResult {
  /** 实际新写入条数 */
  written: number;
  /** 唯一键冲突（已采集过）条数 */
  skipped: number;
  /** 写入失败条数 */
  failed: number;
}

export interface PersistOptions {
  /** 归属管线；null = 手动触发，不归固定管线 */
  pipelineId: number | null;
  /** 来源 ID（content_sources.id），明细页按源筛选用 */
  sourceId?: number | null;
}

@Injectable()
export class ContentItemPersistService {
  private readonly logger = new Logger(ContentItemPersistService.name);

  constructor(
    @InjectRepository(ContentItemEntity)
    private readonly itemRepo: Repository<ContentItemEntity>,
  ) {}

  /** 逐条写入：唯一键冲突算 skip，其余失败算 fail（一条失败不拖垮整批） */
  async persistItems(
    items: RawItem[],
    opts: PersistOptions,
  ): Promise<PersistResult> {
    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of items) {
      // SimHash 近似去重（精确去重靠唯一索引，SimHash 抓「改写重复」）
      const simhashFingerprint = simhash(item.content ?? item.title);

      const row: Partial<ContentItemEntity> = {
        pipeline_id: opts.pipelineId,
        source_id: opts.sourceId ?? null,
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
        raw_hash: createHash('sha256')
          .update(item.content ?? '')
          .digest('hex')
          .slice(0, 64),
        collect_duration_ms: null,
      };

      try {
        await this.itemRepo.insert(row);
        written++;
      } catch (e) {
        const err = e as { code?: string; message?: string };
        // 1062 = Duplicate entry → 唯一键命中，说明这条已采集过
        if (err.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(err.message ?? '')) {
          await this.markAsSkip(item, opts, err.message ?? '唯一键冲突');
          skipped++;
          continue;
        }
        // 其他错误：记 fail 但不中断整批（一条失败不该拖垮这次采集）
        this.logger.warn(
          `写入失败 source=${item.source_name} external_id=${item.external_id}: ${err.message}`,
        );
        await this.markAsFail(item, opts, err.message ?? '写入失败');
        failed++;
      }
    }

    return { written, skipped, failed };
  }

  /** 已采集过：补一条 skip 标记（不改内容字段，避免污染历史记录） */
  private async markAsSkip(
    item: RawItem,
    opts: PersistOptions,
    reason: string,
  ): Promise<void> {
    try {
      await this.itemRepo.update(
        // pipeline_id 可为 null（手动触发），用 IsNull() 显式匹配而非传 null
        {
          pipeline_id: opts.pipelineId === null ? IsNull() : opts.pipelineId,
          external_id: item.external_id,
        },
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
    opts: PersistOptions,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.itemRepo.insert({
        pipeline_id: opts.pipelineId,
        source_id: opts.sourceId ?? null,
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
        raw_hash: createHash('sha256')
          .update(item.content ?? '')
          .digest('hex')
          .slice(0, 64),
      } satisfies Partial<ContentItemEntity>);
    } catch (e) {
      this.logger.warn(`记fail 记录失败：${(e as Error).message}`);
    }
  }
}
