import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';
import { UuidEntity } from '@web-system/shared';

/**
 * 对话表（日志类，uuid 主键）
 * 物理表名：conversations
 */
@Entity('conversations')
export class Conversation extends UuidEntity {
  @PrimaryGeneratedColumn('uuid', { comment: '对话 ID' })
  id: string;

  /** 用户 ID，关联 users.id（物理列 BIGINT；mysql2 默认以字符串返回，故属性用 string） */
  @Index()
  @Column({ type: 'bigint', unsigned: true, comment: '用户 ID，关联 users.id' })
  userId: string;

  /** 对话标题 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '对话标题' })
  title: string | null;

  /** 消息列表 */
  @Column({ type: 'json', comment: '消息列表' })
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;
}
