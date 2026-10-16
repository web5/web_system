import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import type { QualityStatus, QualityStage } from '../quality/quality.enum';

/** 内容管道采集条目——带状态机与去重指纹 */
@Entity('content_items')
@Index('idx_items_pipeline_status', ['pipeline_id', 'status'])
@Index('idx_items_simhash', ['simhash'])
@Index('idx_items_publish_date', ['publish_date'])
@Index('uk_items_pipeline_external', ['pipeline_id', 'external_id'], { unique: true })
export class ContentItemEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', nullable: true, comment: '所属管线 ID' })
  pipeline_id: number | null;

  @Column({ type: 'bigint', nullable: true, comment: '来源 ID' })
  source_id: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '源内唯一 id' })
  external_id: string | null;

  @Column({ type: 'varchar', length: 500, comment: '标题' })
  title: string;

  @Column({ type: 'varchar', length: 1024, nullable: true, comment: '原文链接' })
  url: string | null;

  @Column({ type: 'mediumtext', nullable: true, comment: '原始正文' })
  content: string | null;

  @Column({ type: 'text', nullable: true, comment: 'LLM 摘要' })
  summary: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '分类' })
  category: string | null;

  @Column({ type: 'json', nullable: true, comment: '标签' })
  tags: string[] | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'SimHash 指纹' })
  simhash: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '来源名称' })
  source_name: string | null;

  /**
   * 采集器塞入的源私有字段（作者 / 席位 / 龙虎榜数值 / prompt 版本…）。
   *
   * ⚠️ v1.0 方案文档与多处设计都把 `meta` 当作既有字段引用，实读确认**原本没有**，
   *    是 p35 随质量工程一起补上的 —— 详情页「原始 payload」区块与
   *    Phase 2 的 `prompt_version` 抽样都依赖它。
   *
   * 约定：用**具名接口**而非 `Record<string, unknown>`（json 字段写 Record 会让
   * 消费方失去类型保护，且键拼错不会报错）。
   */
  @Column({ type: 'json', nullable: true, comment: '源私有字段（采集器 meta）' })
  meta: ContentItemMeta | null;

  @Column({ type: 'datetime', nullable: true, comment: '原始发布时间' })
  publish_date: Date | null;

  @Column({ type: 'varchar', length: 24, default: 'pending', comment: '状态机' })
  status: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '最近错误信息' })
  error: string | null;

  // ── 质量归因（p35 · CQO）─────────────────────────────────────────────
  // 与 web_system B0（agent_runs.outcome / fail_stage）方法论同构：
  // 把「失败」从笼统的 status 拆成「结论 + 卡在哪一步」，让失败可归因。
  // 取值必须用 content/quality/quality.enum 的常量，禁止自由字符串。

  /** 质量结论：ok 完整 / partial 部分成功 / fail 失败 / skip 去重跳过 */
  @Column({ type: 'varchar', length: 16, nullable: true, comment: 'ok/partial/fail/skip' })
  quality_status: QualityStatus | null;

  /** 归因阶段：collect/dedup/llm/fallback/publish（fallback = 降级通道产出） */
  @Column({ type: 'varchar', length: 16, nullable: true, comment: 'collect/dedup/llm/fallback/publish' })
  quality_stage: QualityStage | null;

  /**
   * 归因标签式描述（如「LLM 超时」「上游返回空」）。
   * ⚠️ 与上面的 `error` 分工：error 是技术错误**原文**（异常 message），
   *    quality_issue 是人能读的**归因标签**。同一个错误不两处都写。
   */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '归因标签式描述' })
  quality_issue: string | null;

  /** 单条采集耗时（毫秒），慢源诊断用 */
  @Column({ type: 'int', nullable: true, comment: '采集耗时（毫秒）' })
  collect_duration_ms: number | null;

  /** 原始正文指纹，供源侧内容变更检测 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '原始正文指纹' })
  raw_hash: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}

/**
 * `content_items.meta` 的形状。
 *
 * 刻意用具名接口而非 `Record<string, unknown>`：json 字段声明成 Record 后，
 * 消费方拼错键（如 `promptVersion` 写成 `prompt_version`）编译器不报错，
 * 运行时静默取到undefined —— 这正是「摘要落库了但评测抽样筛不出来」这类问题的成因。
 *
 * 各采集器只填自己相关的字段。
 */
export interface ContentItemMeta {
  // ── 论文摘要（source_name='arxiv_digest'）──
  /** arXiv 论文 id，如 2408.12345 */
  arxiv_id?: string;
  /** 英文原标题 */
  title_en?: string;
  /** 作者列表 */
  authors?: string[];
  /** arXiv abs 页链接 */
  abs_url?: string | null;
  /** prompt 版本 —— Phase 2 评测按它做版本对照抽样 */
  prompt_version?: string;
  /** 是否降级通道产出（模板化摘要，会污染评测基线） */
  degraded?: boolean;
  /** 结构化四字段，评测标注直接引用 */
  digest?: {
    译名: string | null;
    核心贡献: string | null;
    方法亮点: string | null;
    潜在应用: string | null;
  };

  // ── 龙虎榜（source_name='东方财富龙虎榜'）──
  trade_date?: string;
  stock_code?: string;
  stock_name?: string;
  reason?: string;
  buy_amount?: number;
  sell_amount?: number;
  net_amount?: number;
  turnover_rate?: number | null;
  close_price?: number | null;
  change_rate?: number | null;
  is_st?: boolean;
  limit_up?: boolean;
  seats?: Array<{
    name: string;
    buy: number;
    sell: number;
    type: 'buy' | 'sell' | 'both';
  }>;
  /** 席位明细是否取到（取不到时留空数组，不静默当作「无席位」） */
  seats_available?: boolean;

  // ── 财经快讯 ──
  /** 旧套 source_type 的原值（原字段表达「这是爬来的」，语义已由 code 承载） */
  legacy_source_type?: string;
  em_news_code?: string | null;

  // ── arXiv 原始条目 ──
  categories?: string;
}
