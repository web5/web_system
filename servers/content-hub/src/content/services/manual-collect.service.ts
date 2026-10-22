/**
 * 手动采集执行器（p40）——trigger 全类型分派 + 试采。
 *
 * 背景：原 `POST /api/content/collect/:code` 只分派 sina_news / eastmoney_news
 * （走 finnews 双写）与 eastmoney_lhb，arxiv / hackernews / rss 全部落入
 * 「未注册采集器类型」——管理页点了触发，实际什么都没采（2026-10-22 用户截图）。
 *
 * 本服务补上其余三类（采集器与 PipelineService 注册表对齐，统一
 * `collect(config, limit)` 接口）：
 *   · run()  手动触发：采集 → 落库（pipeline_id=null，不进固定管线）→ collect_runs 日志
 *   · test() 试采：只采集不落库不写日志，供编辑页「测试采集」验证配置
 *
 * 🔴 试采与触发的分界线就是「是否写库」：试采任何异常都不允许产生
 *    content_items / collect_runs 副作用，否则「测试」会污染真实采集记录。
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ContentSourceEntity } from '../entities/content-source.entity';
import { ICollector, RawItem } from '../collectors/collector.interface';
import { ArxivCollector } from '../collectors/arxiv.collector';
import { RssCollector } from '../collectors/rss.collector';
import { HackerNewsCollector } from '../collectors/hackernews.collector';
import { EastmoneyLhbCollector } from '../collectors/eastmoney-lhb.collector';
import { CollectLogService } from './collect-log.service';
import { ContentItemPersistService } from './content-item-persist.service';
import { COLLECT_TRIGGER, type CollectTrigger } from '../quality/quality.enum';

/** 手动触发结果（管理页触发弹窗友好化展示用） */
export interface ManualRunOutcome {
  source_code: string;
  /** ok=采到并落库 / empty=上游返回空 / failed=异常 */
  status: 'ok' | 'empty' | 'failed';
  /** 采集到的条数（落库前） */
  item_count: number;
  /** 实际新写入条数 */
  inserted: number;
  /** 去重跳过条数 */
  deduped: number;
  /** 写入失败条数 */
  failed_count: number;
  duration_ms: number;
  error?: string;
}

/** 试采结果（仅预览，不入库） */
export interface TestCollectOutcome {
  status: 'ok' | 'empty' | 'failed';
  item_count: number;
  duration_ms: number;
  items: Array<{
    external_id: string;
    title: string;
    url: string | null;
    publish_date: Date | null;
    source_name: string;
  }>;
  error?: string;
}

@Injectable()
export class ManualCollectService {
  private readonly logger = new Logger(ManualCollectService.name);

  /**
   * 采集器注册表。
   * sina_news / eastmoney_news 不在此表——它们走 finnews 双写（还要写
   * topics/news 旧表），由 controller 分派给 FinnewsAdapterService。
   *
   * 第三构造参仅供单测注入假采集器（不碰网络）；生产走默认注册表。
   */
  private readonly collectors: Record<string, ICollector>;

  constructor(
    private readonly collectLog: CollectLogService,
    private readonly persist: ContentItemPersistService,
    @Optional() collectors?: Record<string, ICollector>,
  ) {
    this.collectors = collectors ?? {
      arxiv: new ArxivCollector(),
      rss: new RssCollector(),
      hackernews: new HackerNewsCollector(),
      eastmoney_lhb: new EastmoneyLhbCollector(),
    };
  }

  /** 该类型是否有可用的手动采集器（controller 分派判据） */
  hasCollector(type: string): boolean {
    return type in this.collectors;
  }

  /** 手动触发：采集 + 落库 + 批次日志 */
  async run(
    source: ContentSourceEntity,
    opts: { trigger?: CollectTrigger; limit?: number } = {},
  ): Promise<ManualRunOutcome> {
    const trigger = opts.trigger ?? COLLECT_TRIGGER.MANUAL;
    const limit = opts.limit ?? 20;
    const collector = this.collectors[source.type];
    const startedAt = new Date();

    // controller 已过滤，双保险（真出现说明分派表与来源配置脱节）
    if (!collector) {
      return {
        source_code: source.code,
        status: 'failed',
        item_count: 0,
        inserted: 0,
        deduped: 0,
        failed_count: 0,
        duration_ms: 0,
        error: `未注册采集器类型: ${source.type}`,
      };
    }

    let items: RawItem[] = [];
    let collectError: string | null = null;
    try {
      items = await collector.collect(source.config ?? {}, limit);
    } catch (e) {
      // 采集器约定内部异常 return []，走到这里是意外崩溃（如解析炸了）
      collectError = (e as Error).message;
    }
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    if (collectError || items.length === 0) {
      await this.collectLog.logFailure({
        sourceCode: source.code,
        sourceName: source.name,
        trigger,
        itemCount: 0,
        errorMessage: collectError ?? '采集返回空（源不可达或解析失败）',
        startedAt,
        finishedAt,
      });
      return {
        source_code: source.code,
        status: collectError ? 'failed' : 'empty',
        item_count: 0,
        inserted: 0,
        deduped: 0,
        failed_count: 0,
        duration_ms: durationMs,
        error: collectError ?? undefined,
      };
    }

    const { written, skipped, failed } = await this.persist.persistItems(items, {
      // 手动触发不归固定管线（与 finnews adapter 手动触发语义一致）
      pipelineId: null,
      sourceId: source.id,
    });

    await this.collectLog.logSuccess({
      sourceCode: source.code,
      sourceName: source.name,
      trigger,
      itemCount: items.length,
      dedupCount: skipped,
      failCount: failed,
      startedAt,
      finishedAt,
    });

    this.logger.log(
      `手动采集 ${source.code}: 采到 ${items.length}，新入库 ${written}，去重 ${skipped}，失败 ${failed}`,
    );
    return {
      source_code: source.code,
      status: 'ok',
      item_count: items.length,
      inserted: written,
      deduped: skipped,
      failed_count: failed,
      duration_ms: durationMs,
    };
  }

  /**
   * 试采：只跑采集器，**不落库、不写 collect_runs**。
   * 入参 type + config + limit 全部来自管理端表单（含未保存修改），
   * 让用户「先测后存」。
   */
  async test(
    type: string,
    config: Record<string, unknown> | undefined,
    limit = 5,
  ): Promise<TestCollectOutcome> {
    const collector = this.collectors[type];
    const startedAt = new Date();

    if (!collector) {
      return {
        status: 'failed',
        item_count: 0,
        duration_ms: 0,
        items: [],
        error: `未注册采集器类型: ${type}`,
      };
    }

    try {
      const raw = await collector.collect(config ?? {}, limit);
      return {
        status: raw.length > 0 ? 'ok' : 'empty',
        item_count: raw.length,
        duration_ms: Date.now() - startedAt.getTime(),
        // 预览上限 20 条，防大响应把管理页撑爆
        items: raw.slice(0, 20).map((r) => ({
          external_id: r.external_id,
          title: r.title,
          url: r.url ?? null,
          publish_date: r.publish_date ?? null,
          source_name: r.source_name,
        })),
      };
    } catch (e) {
      return {
        status: 'failed',
        item_count: 0,
        duration_ms: Date.now() - startedAt.getTime(),
        items: [],
        error: (e as Error).message,
      };
    }
  }
}
