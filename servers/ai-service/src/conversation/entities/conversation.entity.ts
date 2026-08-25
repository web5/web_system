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

  /** 消息列表（兼容旧式轻量对话：单轮 user/assistant/system） */
  @Column({ type: 'json', comment: '消息列表（轻量对话）' })
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;

  /** 已压缩的对话摘要（Agent 长期记忆，省 token） */
  @Column({ type: 'text', nullable: true, comment: '对话历史摘要（Agent 摘要压缩）' })
  summary: string | null;

  /** 已被摘要覆盖的消息条数（避免重复压缩同批） */
  @Column({ type: 'int', default: 0, comment: '已摘要覆盖的消息条数' })
  summarizedCount: number;

  /** 未压缩的近期原始消息（Agent 短列表，受 keepRecent 控制） */
  @Column({ type: 'json', nullable: false, default: () => "'[]'", comment: 'Agent 近期原始消息' })
  recentMessages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolCallId?: string;
    name?: string;
  }>;
}
