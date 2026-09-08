import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  ConversationMemoryPort,
  Compaction,
  AgentMemoryConfig,
  ChatMessage,
  StoredMessage,
} from '@kedouai/agent-core';
import { AgentConversation } from './agent-conversation.entity';

/**
 * 数据库版对话记忆：实现 ConversationMemoryPort，落库到 agent_conversations。
 *
 * 行为对齐 agent-core 的 InMemoryConversationMemory：
 * - load：读取 { summary + 近期消息 }
 * - persist：写入/更新会话，按需触发 Compaction 摘要压缩
 *
 * 不同点：id 由 uuid v4 生成并持久化到数据库，服务重启后追问上下文不丢失。
 */
@Injectable()
export class DbConversationMemory implements ConversationMemoryPort {
  private readonly logger = new Logger(DbConversationMemory.name);

  constructor(
    @InjectRepository(AgentConversation)
    private readonly repo: Repository<AgentConversation>,
    private readonly compaction: Compaction,
  ) {}

  async load(
    userId: string,
    conversationId: string,
  ): Promise<{ summary: string | null; messages: ChatMessage[] }> {
    const conv = await this.repo.findOne({ where: { id: conversationId, userId } });
    if (!conv) return { summary: null, messages: [] };
    return {
      summary: conv.summary,
      messages: this.parseMessages(conv.messages),
    };
  }

  async persist(
    userId: string,
    conversationId: string | undefined,
    fullRunMessages: ChatMessage[],
    config: AgentMemoryConfig,
  ): Promise<string> {
    const id = conversationId ?? (await this.newConversationId());
    const existing = await this.repo.findOne({ where: { id, userId } });

    // 从完整消息中提取可持久化部分（去掉 system）
    const recent = this.compaction.extractPersistable(fullRunMessages);

    let summary: string | null = existing?.summary ?? null;
    let summarizedCount = existing?.summarizedCount ?? 0;
    // 标题只在无既有值时生成（首条 user 前 20 字），既有值保留——业务快照服务后续可覆盖
    const title = existing?.title ?? this.defaultTitle(fullRunMessages);

    // 触发摘要压缩：旧摘要 + 早期消息 → 新摘要，近期保留 config.keepRecent 条
    if (this.compaction.shouldCompact(recent, config)) {
      const oldPart = recent.slice(0, recent.length - config.keepRecent);
      const newRecent = recent.slice(recent.length - config.keepRecent);
      const next = await this.compaction.compact(summary, oldPart);
      if (next) {
        summary = next;
        summarizedCount += oldPart.length;
        await this.saveConversation({
          id,
          userId,
          title,
          summary,
          summarizedCount,
          messages: newRecent,
        });
        this.logger.log(
          `[DB] 触发摘要压缩: 压缩 ${oldPart.length} 条，保留 ${newRecent.length} 条，会话 ${id}`,
        );
        return id;
      }
    }

    await this.saveConversation({
      id,
      userId,
      title,
      summary,
      summarizedCount,
      messages: recent,
    });
    return id;
  }

  /**
   * 落库会话。仅携带对话记忆字段（id/userId/title/summary/summarizedCount/messages），
   * 不携带 report/meta 业务列——TypeORM 对未提供的列不生成 UPDATE，避免把快照列覆盖为空。
   */
  private async saveConversation(data: {
    id: string;
    userId: string;
    title: string;
    summary: string | null;
    summarizedCount: number;
    messages: StoredMessage[];
  }): Promise<void> {
    await this.repo.save(this.repo.create(data));
  }

  /** 默认标题：首条 user 消息去空白后前 20 字 */
  private defaultTitle(fullRunMessages: ChatMessage[]): string {
    const firstUser = fullRunMessages.find((m) => m.role === 'user');
    const text = (firstUser?.content ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.substring(0, 20) : '新对话';
  }

  /** 生成新会话 id（uuid v4，Node crypto 生成，跨 MySQL/PG 通用） */
  private newConversationId(): string {
    return randomUUID();
  }

  /** 把存储的 JSON messages 还原为 ChatMessage[] */
  private parseMessages(raw: unknown): ChatMessage[] {
    if (!Array.isArray(raw)) return [];
    return (raw as StoredMessage[]).map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      ...(m.name ? { name: m.name } : {}),
    }));
  }
}
