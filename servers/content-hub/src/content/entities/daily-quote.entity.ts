/**
 * 每日美句冻结池（s27 · DB 存储）。
 *
 * 一行对应冻结资产 `daily-quotes.json` 的 items[] 一项，`ordinal` 保留资产原序，
 * `pool_version` 固定为 DAILY_QUOTES_FROZEN_VERSION。只读：无对外写接口，
 * 写入只由 scripts/seed-daily-quotes.mjs 在运维显式执行时完成。
 *
 * 时间列 DATETIME(3) 与 migrations/0029_daily_quotes.sql、实体 precision:3 对齐。
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('daily_quotes')
@Index('uk_daily_quotes_version_ordinal', ['pool_version', 'ordinal'], { unique: true })
@Index('uk_daily_quotes_version_source', ['pool_version', 'source_lesson_id', 'source_line_index'], { unique: true })
export class DailyQuoteEntity {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'int', unsigned: true, default: 1, comment: '冻结池版本' })
  pool_version: number;

  @Column({ type: 'int', unsigned: true, comment: '资产 items[] 原序（1..136）' })
  ordinal: number;

  @Column({ type: 'varchar', length: 512, comment: '冻结中文（逐字）' })
  cn: string;

  @Column({ type: 'varchar', length: 512, comment: '冻结英文（逐字）' })
  en: string;

  @Column({ type: 'varchar', length: 16, comment: '来源册别（恒 NCE2）' })
  source_book: string;

  @Column({ type: 'int', unsigned: true, comment: '来源课号' })
  source_lesson_id: number;

  @Column({ type: 'varchar', length: 255, comment: '来源英文标题' })
  source_title: string;

  @Column({ type: 'int', unsigned: true, comment: '来源行号' })
  source_line_index: number;

  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', comment: '创建时间' })
  created_at: Date;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', onUpdate: 'CURRENT_TIMESTAMP(3)', comment: '更新时间' })
  updated_at: Date;
}
