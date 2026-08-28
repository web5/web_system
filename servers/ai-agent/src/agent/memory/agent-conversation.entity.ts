import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * Agent 对话记忆表（数据库持久化版，替代 InMemoryConversationMemory）。
 *
 * 支持多轮追问：初次分析的 conversationId 落库后，用户后续追问复用同一 id，
 * 从本表恢复历史消息与摘要，实现跨请求/跨服务重启的记忆连续性。
 *
 * messages 以 JSONB 存储近期的 StoredMessage[]（含 user/assistant/tool），
 * summary 为历史早期的摘要压缩结果。两者构成"摘要 + 近期消息"的完整上下文。
 */
@Entity('agent_conversations')
@Index('idx_agent_conversations_user', ['userId'])
export class AgentConversation extends AbstractEntity {
  /** 会话 id：作为 conversationId 下发给客户端，用于后续追问 */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 所属用户 id */
  @Column({ type: 'varchar', length: 64, comment: '所属用户 id' })
  userId: string;

  /** 历史早期消息的摘要压缩结果，NULL 表示尚未触发压缩 */
  @Column({ type: 'text', nullable: true, comment: '对话历史摘要' })
  summary: string | null;

  /** 已压缩进 summary 的消息条数 */
  @Column({ type: 'int', default: 0, comment: '已压缩的消息条数' })
  summarizedCount: number;

  /** 近期消息（StoredMessage[] JSON 序列化） */
  @Column({ type: 'json', comment: '近期消息列表' })
  messages: unknown;
}
