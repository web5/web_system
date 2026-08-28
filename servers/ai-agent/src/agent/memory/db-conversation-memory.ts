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

    // 触发摘要压缩：旧摘要 + 早期消息 → 新摘要，近期保留 config.keepRecent 条
    if (this.compaction.shouldCompact(recent, config)) {
      const oldPart = recent.slice(0, recent.length - config.keepRecent);
      const newRecent = recent.slice(recent.length - config.keepRecent);
      const next = await this.compaction.compact(summary, oldPart);
      if (next) {
        summary = next;
        summarizedCount += oldPart.length;
        await this.repo.save(
          this.repo.create({
            id,
            userId,
            summary,
            summarizedCount,
            messages: newRecent,
          }),
        );
        this.logger.log(
          `[DB] 触发摘要压缩: 压缩 ${oldPart.length} 条，保留 ${newRecent.length} 条，会话 ${id}`,
        );
        return id;
      }
    }

    await this.repo.save(
      this.repo.create({
        id,
        userId,
        summary,
        summarizedCount,
        messages: recent,
      }),
    );
    return id;
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
