import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BigIntEntity } from '@web-system/shared';

/**
 * 用户偏好档案表（一期只有 music）。
 *
 * 与 agent_conversations.summary 的区别：summary 是**会话级**压缩摘要，换会话即失效；
 * 本表是**用户级**，跨会话复用，用于「记住用户口味」。
 * 带 namespace 便于后续扩展到其它偏好域（阅读 / 资讯），无需再建表。
 *
 * data 结构：
 * { likes: { genres: [], artists: [], moods: [] }, dislikes: { genres: [], artists: [] }, note?: string }
 */
@Entity('user_taste_profiles')
@Index('idx_user_taste_user_ns', ['userId', 'namespace'], { unique: true })
export class UserTasteProfile extends BigIntEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '用户 id' })
  userId: string;

  /** 偏好域：music（预留 reading 等） */
  @Column({ type: 'varchar', length: 32, default: 'music', comment: '偏好域：music / 预留' })
  namespace: string;

  /** 偏好数据（likes / dislikes / note），写入走 merge，不做整包覆盖 */
  @Column({ type: 'json', comment: '偏好数据：likes / dislikes / note' })
  data: unknown;
}
