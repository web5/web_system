import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 生词本 / 收藏条目（一期：翻译类收藏）。
 *
 * 归属 user-service（跟用户走）：收藏是用户主动行为数据，生命周期跟账号走。
 * 存「译文快照」而非消息引用 —— 会话删除后收藏仍在。
 * 去重：(user_id, content_hash) 唯一，重复收藏幂等。
 */
@Entity('glossary_entries')
@Index('idx_glossary_user', ['userId'])
@Index('idx_glossary_user_hash', ['userId', 'contentHash'], { unique: true })
export class GlossaryEntryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '所属用户 id' })
  userId: string;

  /** enMain 归一化（trim + 小写 + 压缩空白）后 sha256 截 64 */
  @Column({ type: 'varchar', length: 64, comment: 'enMain 归一化 sha256 截 64' })
  contentHash: string;

  /** chat=聊天页翻译卡片；translate=翻译结果页 */
  @Column({ type: 'varchar', length: 16, comment: '来源 chat/translate' })
  sourceType: string;

  @Column({ type: 'text', nullable: true, comment: '中文原文' })
  sourceText: string | null;

  @Column({ type: 'text', comment: '英文译文主文' })
  enMain: string;

  @Column({ type: 'text', nullable: true, comment: '注解 / 直译对照 / 委婉版' })
  note: string | null;

  /** { tone?, style?, direction:'zh2en' } */
  @Column({ type: 'json', nullable: true, comment: '语气 / 风格 / 方向 meta' })
  meta: unknown;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '关联会话 id' })
  conversationId: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
