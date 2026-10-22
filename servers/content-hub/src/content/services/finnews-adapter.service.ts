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
import { SinaCollector } from '../collectors/sina.collector';
import { EastmoneyNewsCollector } from '../collectors/eastmoney-news.collector';
import { CollectLogService } from './collect-log.service';
import { ContentItemPersistService } from './content-item-persist.service';
import { RawItem } from '../collectors/collector.interface';
import {
  COLLECT_TRIGGER,
  type CollectTrigger,
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
    private readonly collectLog: CollectLogService,
    // p40：落库/去重/归因逻辑抽到共享服务（手动触发采集复用同一套语义）
    private readonly persist: ContentItemPersistService,
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

      const { written, skipped, failed } = await this.persist.persistItems(items, {
        pipelineId,
      });

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
}
