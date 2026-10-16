import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 采集批次日志（p35）。
 *
 * 为什么需要这张表：`content_items` 记的是**条目**，不是**批次**。
 * 「今天采了多少 / 这次采集成功了没有 / 哪个源最近老失败」这三个问题
 * 无法从条目表回答 —— 而它们恰恰是排查「采不到数据」时的第一现场。
 *
 * 与 `content_items` 的归因职责分工：
 *   · 批次级问题（源挂了 / 超时 / 返回空）→ 本表
 *   · 条目级问题（这一条摘要生成失败）→ content_items.quality_*
 */
@Entity('collect_runs')
@Index('idx_runs_source_time', ['source_code', 'started_at'])
@Index('idx_runs_status_time', ['status', 'started_at'])
export class CollectRunEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 32, comment: '采集器 code（ICollector.code）' })
  source_code: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '来源展示名' })
  source_name: string | null;

  @Column({ type: 'varchar', length: 16, default: 'schedule', comment: 'schedule/manual' })
  trigger_type: string;

  @Column({ type: 'varchar', length: 16, comment: 'ok/failed' })
  status: string;

  @Column({ type: 'int', default: 0, comment: '采集条数' })
  item_count: number;

  @Column({ type: 'int', default: 0, comment: '去重跳过条数' })
  dedup_count: number;

  @Column({ type: 'int', default: 0, comment: '失败条数' })
  fail_count: number;

  @Column({ type: 'int', nullable: true, comment: '本批次总耗时（毫秒）' })
  duration_ms: number | null;

  @Column({ type: 'text', nullable: true, comment: '错误原文（技术错误，非归因标签）' })
  error_message: string | null;

  @Column({ type: 'datetime', precision: 3, comment: '批次开始时间' })
  started_at: Date;

  @Column({ type: 'datetime', precision: 3, comment: '批次结束时间' })
  finished_at: Date;

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  created_at: Date;
}
