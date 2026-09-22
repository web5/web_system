import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 用户记忆（条目化，AI 每轮对话后异步提炼写入）。
 *
 * 归属 user-service（跟用户走）。category：preference（偏好）/ fact（事实）/ habit（习惯）。
 * 去重：(user_id, category, content_hash) 唯一。
 */
@Entity('user_memories')
@Index('idx_user_memories_user', ['userId'])
@Index('idx_user_memories_user_cat_hash', ['userId', 'category', 'contentHash'], { unique: true })
export class UserMemoryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '所属用户 id' })
  userId: string;

  /** preference=偏好 / fact=事实 / habit=习惯 */
  @Column({ type: 'varchar', length: 32, comment: '记忆分类 preference/fact/habit' })
  category: string;

  @Column({ type: 'text', comment: '记忆内容' })
  content: string;

  /** content 归一化（trim + 小写 + 压缩空白）后 sha256 截 64 */
  @Column({ type: 'varchar', length: 64, comment: 'content 归一化 sha256 截 64' })
  contentHash: string;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 1.0, comment: '置信度 0~1' })
  confidence: number;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '来源会话 id' })
  sourceConversationId: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
