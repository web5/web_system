import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 用户偏好档案表（一期 music，从 ai-agent 迁到 user-service，跟用户走）。
 *
 * 与 agent_conversations.summary 的区别：summary 是会话级压缩摘要；本表是用户级，
 * 跨会话复用。带 namespace 便于扩展到其它偏好域（阅读 / 资讯）。
 *
 * data 结构：{ likes: { genres[], artists[], moods[] }, dislikes: { genres[], artists[] }, note? }
 */
@Entity('user_taste_profiles')
@Index('idx_user_taste_user_ns', ['userId', 'namespace'], { unique: true })
export class UserTasteProfileEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '用户 id' })
  userId: string;

  /** 偏好域：music（预留 reading 等） */
  @Column({ type: 'varchar', length: 32, default: 'music', comment: '偏好域 music / 预留' })
  namespace: string;

  /** 偏好数据（likes / dislikes / note），写入走 merge，不做整包覆盖 */
  @Column({ type: 'json', comment: '偏好数据 likes/dislikes/note' })
  data: unknown;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
