/**
 * 内容质量工程（CQO）· 采集日志与评测载体接口。
 *
 * 与既有 `content.controller.ts` 分开的原因：
 *   · 既有 controller 是「源 / 管线 / 条目」的配置与查询入口
 *   · 本 controller 是「采集可观测 + AI 产出落库」的质量入口
 * 职责不同混在一起会让两边都难读；且既有 controller 全是 `@Body() body: any`，
 * 新接口不应与之同风格（红线：必须 DTO）。
 *
 * 权限（由 admin 路由层控制，此处仅注释说明）：
 *   · 查询类 → `content:view`（高频只读）
 *   · 触发类 → `content:manage`（低频 + 有副作用）
 */
import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { CollectLogService } from './services/collect-log.service';
import { ArxivDigestService } from './services/arxiv-digest.service';
import { FinnewsAdapterService } from './services/finnews-adapter.service';
import { ManualCollectService } from './services/manual-collect.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { Public } from '../auth/public.decorator';
import {
  ArxivDigestBatchDto,
  CollectHealthQueryDto,
  CollectRunsQueryDto,
  EvalSampleQueryDto,
  ListItemsQueryDto,
  ListLhbQueryDto,
  TestCollectDto,
  TriggerCollectDto,
} from './dto/content-quality.dto';
import { COLLECT_TRIGGER } from './quality/quality.enum';
import { LhbRecordEntity } from './entities/lhb-record.entity';
import { ContentSourceEntity } from './entities/content-source.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SeatTagService } from './services/seat-tag.service';

/**
 * 采集观测 / 手动触发 / 落库接口，默认走运营后台（admin）用户 JWT。
 * 两类例外：
 *   · lhb* / arxiv-digest(POST) —— 服务间接口，@Public() 跳过用户 JWT +
 *     @UseGuards(InternalKeyGuard) 校验 Bearer <CONTENT_HUB_SERVICE_KEY>
 *   · arxiv-digest/versions、sample、quality/filter-support —— admin 评测看板，
 *     走用户 JWT（不挂 @Public）
 */
@UseGuards(JwtAuthGuard)
@Controller('api/content')
export class ContentQualityController {
  private readonly logger = new Logger(ContentQualityController.name);

  constructor(
    private readonly collectLog: CollectLogService,
    private readonly digest: ArxivDigestService,
    private readonly finnewsAdapter: FinnewsAdapterService,
    private readonly manualCollect: ManualCollectService,
    private readonly seatTag: SeatTagService,
    @InjectRepository(LhbRecordEntity)
    private readonly lhbRepo: Repository<LhbRecordEntity>,
    @InjectRepository(ContentSourceEntity)
    private readonly sourceRepo: Repository<ContentSourceEntity>,
  ) {}

  // ── 采集批次日志（FR-API-6）────────────────────────────────────────

  /** 采集批次日志：时间 / 源 / 触发方式 / 成败 / 条数 / 耗时 / 错误 */
  @Get('collect/runs')
  async collectRuns(@Query() query: CollectRunsQueryDto) {
    const runs = await this.collectLog.listRecent({
      sourceCode: query.source_code,
      limit: query.limit,
    });
    return {
      total: runs.length,
      items: runs.map((r) => ({
        id: Number(r.id),
        source_code: r.source_code,
        source_name: r.source_name,
        trigger_type: r.trigger_type,
        status: r.status,
        item_count: r.item_count,
        dedup_count: r.dedup_count,
        fail_count: r.fail_count,
        duration_ms: r.duration_ms,
        error_message: r.error_message,
        started_at: r.started_at,
        finished_at: r.finished_at,
      })),
    };
  }

  /** 采集健康度：近 N 天成功率 + 今日失败次数（FR-API-7） */
  @Get('collect/health')
  collectHealth(@Query() query: CollectHealthQueryDto) {
    return this.collectLog.health(query.days);
  }

  /**
   * 每个源最近一次采集结果（admin 采集源列表「最近采集」列，p40）。
   * 让「这源还活着吗」在列表页直接可见，不用跳监控页。
   */
  @Get('sources/last-collect')
  lastCollect() {
    return this.collectLog.lastBySource();
  }

  // ── 手动触发采集（FR-API-5）───────────────────────────────────────

  /**
   * 手动触发某个采集器（需 `content:manage`）。
   *
   * 幂等保护：同一采集器同一时刻只跑一次（`running` 集合），防重复点击把上游打爆。
   *
   * 分派（p40 补全，原来只有 finnews 双写 + 龙虎榜，arxiv/hackernews/rss
   * 全部落入「未注册采集器类型」——管理页点了触发实际什么都没采）：
   *   · sina_news / eastmoney_news → FinnewsAdapterService（双写 topics/news 旧表）
   *   · arxiv / rss / hackernews / eastmoney_lhb → ManualCollectService（落 content_items）
   *   · 其余 → rejected（配置了没有采集器的类型，属配置错误）
   */
  @Post('collect/:sourceCode')
  async trigger(
    @Param('sourceCode') sourceCode: string,
    @Body() body: TriggerCollectDto,
  ) {
    // 幂等保护：同一采集源同一时刻只跑一次（`running` 集合），防重复点击把上游打爆
    if (this.running.has(sourceCode)) {
      return {
        source_code: sourceCode,
        status: 'rejected',
        reason: '该采集源正在运行中，请勿重复触发',
      };
    }

    // 读表拿源配置：code / enabled / type / config 都在 content_sources 表里，
    // 改源、停用、换参都只改表，不用发版。
    const source = await this.sourceRepo.findOne({ where: { code: sourceCode } });
    if (!source) {
      return {
        source_code: sourceCode,
        status: 'unknown',
        reason: `未登记的采集源：${sourceCode}（请先在「采集源管理」里添加）`,
      };
    }
    if (!source.enabled) {
      return {
        source_code: sourceCode,
        status: 'rejected',
        reason: `采集源已停用：${source.name}`,
      };
    }

    this.running.add(sourceCode);
    try {
      // 财经快讯（新浪/东财）：走 finnews 适配器双写（质量归因 + 唯一键去重）
      if (source.type === 'sina_news' || source.type === 'eastmoney_news') {
        // pipelineId 传null：手动触发的条目不进固定管线（只保证内容有质量归因）
        const startedAt = new Date();
        const results = await this.finnewsAdapter.syncToContentItems(null, {
          trigger: COLLECT_TRIGGER.MANUAL,
          limit: body.limit,
        });
        return {
          source_code: sourceCode,
          status: 'ok',
          item_count: results.reduce((n, r) => n + r.legacyTotal, 0),
          inserted: results.reduce((n, r) => n + r.newWritten, 0),
          deduped: results.reduce((n, r) => n + r.dedupSkipped, 0),
          failed_count: results.reduce((n, r) => n + r.failed, 0),
          duration_ms: Date.now() - startedAt.getTime(),
        };
      }

      // 其余有采集器的类型（arxiv / rss / hackernews / 龙虎榜）：统一走手动采集执行器
      if (this.manualCollect.hasCollector(source.type)) {
        return await this.manualCollect.run(source, {
          trigger: COLLECT_TRIGGER.MANUAL,
          limit: body.limit,
        });
      }

      return {
        source_code: sourceCode,
        status: 'rejected',
        reason: `未注册采集器类型：${source.type}（该类型没有可用采集器，请检查采集源类型配置）`,
      };
    } finally {
      this.running.delete(sourceCode);
    }
  }

  /**
   * 试采（编辑页「测试采集」）。
   *
   * 🔴 与 trigger 的唯一区别：**不落库**——不写 content_items、不写
   *    collect_runs。config 取管理端当前表单值（含未保存修改），支持先测后存。
   */
  @Post('sources/test')
  testCollect(@Body() body: TestCollectDto) {
    return this.manualCollect.test(body.type, body.config ?? {}, body.limit ?? 5);
  }

  /** 运行中的采集器（防重复触发） */
  private readonly running = new Set<string>();

  // ── 论文摘要落库（FR-EVAL-2）───────────────────────────────────────

  /**
   * 批量落库论文摘要产出。
   *
   * 🔴 这是 Phase 2 的数据地基：不落库 →评测集无从抽样、幻觉率无法自动判定。
   * 由定时任务里的 AI 在生成日报后调用。
   */
  @Public()
  @UseGuards(InternalKeyGuard)
  @Post('arxiv-digest')
  async saveDigest(@Body() body: ArxivDigestBatchDto) {
    const items = body.items.map((i) => ({
      ...i,
      pipeline_id: i.pipeline_id ?? body.pipeline_id ?? null,
    }));
    const results = await this.digest.persistBatch(items);
    return {
      total: results.length,
      inserted: results.filter((r) => r.inserted).length,
      skipped: results.filter((r) => !r.inserted).length,
      degraded: results.filter((r) => r.degraded).length,
      results,
    };
  }

  /** 各 prompt 版本的产出条数（评测进度看板，admin 用户 JWT） */
  @Get('arxiv-digest/versions')
  versions() {
    return this.digest.countByVersion();
  }

  /**
   * 按 prompt 版本等间隔抽样（Phase 2 评测集）。
   *
   * 刻意排除降级产物：降级摘要模板化、无 LLM 内容，混进评测集会拉低幻觉率。
   */
  @Get('arxiv-digest/sample')
  async sample(@Query() query: EvalSampleQueryDto) {
    const rows = await this.digest.sampleForEval(query.prompt_version, query.size);
    return {
      prompt_version: query.prompt_version ?? '(全部非降级)',
      size: rows.length,
      items: rows.map((r) => ({
        id: Number(r.id),
        title: r.title,
        summary: r.summary,
        // content 是arXiv 原文，标注与幻觉判定都要用它
        abstract: r.content,
        publish_date: r.publish_date,
        quality_status: r.quality_status,
        quality_stage: r.quality_stage,
        meta: r.meta,
      })),
    };
  }

  // ── 龙虎榜（FR-API-8）────────────────────────────────────────────

  /** 龙虎榜列表（按交易日 / 标签筛；服务间接口，InternalKeyGuard 鉴权） */
  @Public()
  @UseGuards(InternalKeyGuard)
  @Get('lhb')
  async listLhb(@Query() query: ListLhbQueryDto) {
    const qb = this.lhbRepo
      .createQueryBuilder('l')
      .orderBy('l.trade_date', 'DESC')
      .limit(query.limit);
    if (query.trade_date) qb.andWhere('l.trade_date = :d', { d: query.trade_date });
    if (query.tag) {
      qb.andWhere("JSON_CONTAINS(l.tags, :tag)", { tag: JSON.stringify(query.tag) });
    }
    const rows = await qb.getMany();
    return {
      total: rows.length,
      items: rows.map((r) => ({
        id: Number(r.id),
        trade_date: r.trade_date,
        stock_code: r.stock_code,
        stock_name: r.stock_name,
        reason: r.reason,
        buy_amount: r.buy_amount,
        sell_amount: r.sell_amount,
        net_amount: r.net_amount,
        turnover_rate: r.turnover_rate,
        is_st: r.is_st,
        limit_up: r.limit_up,
        tags: r.tags,
        item_id: r.item_id,
      })),
    };
  }

  /** 单条详情（含席位明细；服务间接口，InternalKeyGuard 鉴权） */
  @Public()
  @UseGuards(InternalKeyGuard)
  @Get('lhb/:id')
  async lhbDetail(@Param('id') id: string) {
    const row = await this.lhbRepo.findOne({ where: { id: Number(id) } });
    if (!row) return { found: false };
    return {
      found: true,
      ...row,
      id: Number(row.id),
      // 逐席位判定明细：告诉 admin「为什么判成游资」
      seat_details: row.seats?.length
        ? await this.seatTag.tagSeats(row.seats)
        : { tags: [], details: [] },
    };
  }

  /** 龙虎榜统计：上榜数 / 涨停数 / 游资参与数 / 机构参与数（服务间接口） */
  @Public()
  @UseGuards(InternalKeyGuard)
  @Get('lhb/stats')
  async lhbStats() {
    const row = await this.lhbRepo
      .createQueryBuilder('l')
      .select('MAX(l.trade_date)', 'latest_date')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(l.limit_up)', 'limit_up')
      .addSelect("SUM(JSON_CONTAINS(l.tags, '\"hotmoney\"'))", 'hotmoney')
      .addSelect("SUM(JSON_CONTAINS(l.tags, '\"institution\"'))", 'institution')
      .getRawOne<{
        latest_date: string | null;
        total: string;
        limit_up: string;
        hotmoney: string;
        institution: string;
      }>();
    if (!row?.latest_date) {
      return {
        trade_date: null,
        total: 0,
        limit_up: 0,
        hotmoney: 0,
        institution: 0,
      };
    }
    // 统计卡按「最近交易日」算，不是全历史累计
    const day = await this.lhbRepo
      .createQueryBuilder('l')
      .select('COUNT(*)', 'total')
      .addSelect('SUM(l.limit_up)', 'limit_up')
      .addSelect("SUM(JSON_CONTAINS(l.tags, '\"hotmoney\"'))", 'hotmoney')
      .addSelect("SUM(JSON_CONTAINS(l.tags, '\"institution\"'))", 'institution')
      .where('l.trade_date = :d', { d: row.latest_date })
      .getRawOne<{
        total: string;
        limit_up: string;
        hotmoney: string;
        institution: string;
      }>();
    return {
      trade_date: row.latest_date,
      total: Number(day?.total ?? 0),
      limit_up: Number(day?.limit_up ?? 0),
      hotmoney: Number(day?.hotmoney ?? 0),
      institution: Number(day?.institution ?? 0),
    };
  }

  // ── 占位：内容条目筛选（M2 由既有 controller 增强时补齐）──────────

  /** 条目筛选能力自查（避免与既有 GET items 语义混淆；admin 用户 JWT） */
  @Get('quality/filter-support')
  filterSupport(@Query() query: ListItemsQueryDto) {
    return {
      supported: [
        'limit',
        'offset',
        'status',
        'quality_status',
        'quality_stage',
        'pipeline',
        'source',
        'keyword',
        'date_from',
        'date_to',
        'sort',
      ],
      received: Object.keys(query ?? {}).filter((k) => query[k] !== undefined),
    };
  }
}
