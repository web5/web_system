import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 用户记忆摘要表（一用户一条，#8229 明细+摘要双层的注入源）。
 *
 * 范式照抄 user_taste_profiles：一用户一行 + namespace 扩展位。
 * 与明细层 user_memories 的关系：
 *   - 明细层：一用户多条，审计 / 编辑 / 明细查看；
 *   - 本表：明细全量重算出的结构化画像，是 loadProfile 注入的唯一来源（体积恒定）。
 *
 * 幂等判据：source_hash = 明细集指纹（按 id 升序 id:contentHash 拼接后 sha256）。
 * 明细集没变时重复 rebuild 不产生新版本（version 不递增）。
 */
@Entity('user_memory_summaries')
@Index('idx_user_memory_summaries_user_ns', ['userId', 'namespace'], { unique: true })
@Index('idx_user_memory_summaries_user', ['userId'])
export class UserMemorySummaryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '用户 id（与 user_memories.user_id 同口径）' })
  userId: string;

  /** 摘要域：general 为主（预留 music / business 等） */
  @Column({ type: 'varchar', length: 32, default: 'general', comment: '摘要域 general / 预留' })
  namespace: string;

  /** 记忆摘要正文（结构化中文，含分类小标题，≤500 字） */
  @Column({ type: 'text', comment: '记忆摘要正文' })
  summary: string;

  /** 摘要覆盖的明细条数（便于判断是否需要重算） */
  @Column({ type: 'int', comment: '摘要覆盖的明细条数' })
  itemCount: number;

  /** 明细集指纹（sha256），幂等与重算判据 */
  @Column({ type: 'varchar', length: 64, comment: '明细集 sha256 指纹' })
  sourceHash: string;

  /** 摘要版本号，明细集变化（重算生效）时 +1 */
  @Column({ type: 'int', default: 1, comment: '摘要版本号' })
  version: number;

  /** 最近一条明细的时间（nullable：无明细时为空） */
  @Column({ type: 'datetime', precision: 3, nullable: true, comment: '最近一条明细时间' })
  lastItemAt: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3, comment: '更新时间' })
  updatedAt: Date;
}
