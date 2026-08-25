import { Logger } from '@nestjs/common';
import { ConversationMemoryPort } from './conversation-memory';
import { Compaction } from './compaction';
import { AgentMemoryConfig } from '../interfaces/agent.interface';
import { StoredMessage } from './stored-message';
import { ChatMessage } from '../../common/http/base-ai.client';

interface MemoryStore {
  summary: string | null;
  summarizedCount: number;
  recent: StoredMessage[];
}

/**
 * 内存版对话记忆（CLI / 测试用，不依赖数据库）。
 * 可选接入 Compaction 做摘要压缩，行为对齐 ConversationMemory。
 */
export class InMemoryConversationMemory implements ConversationMemoryPort {
  private readonly logger = new Logger(InMemoryConversationMemory.name);
  private readonly store = new Map<string, MemoryStore>();
  private seq = 0;

  constructor(private readonly compaction?: Compaction) {}

  async load(
    _userId: string,
    conversationId: string,
  ): Promise<{ summary: string | null; messages: ChatMessage[] }> {
    const mem = this.store.get(conversationId);
    if (!mem) return { summary: null, messages: [] };
    return {
      summary: mem.summary,
      messages: mem.recent.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      })),
    };
  }

  async persist(
    userId: string,
    conversationId: string | undefined,
    fullRunMessages: ChatMessage[],
    config: AgentMemoryConfig,
  ): Promise<string> {
    const id = conversationId ?? `mem_${++this.seq}`;
    const recent = this.compaction
      ? this.compaction.extractPersistable(fullRunMessages)
      : (fullRunMessages.filter((m) => m.role !== 'system') as StoredMessage[]);

    const existing = this.store.get(id);
    let summary = existing?.summary ?? null;
    let summarizedCount = existing?.summarizedCount ?? 0;

    if (this.compaction && this.compaction.shouldCompact(recent, config)) {
      const oldPart = recent.slice(0, recent.length - config.keepRecent);
      const newRecent = recent.slice(recent.length - config.keepRecent);
      const next = await this.compaction.compact(summary, oldPart);
      if (next) {
        summary = next;
        summarizedCount += oldPart.length;
        this.store.set(id, { summary, summarizedCount, recent: newRecent });
        this.logger.log(`[内存] 触发摘要压缩: 压缩 ${oldPart.length} 条，保留 ${newRecent.length} 条`);
        return id;
      }
    }

    this.store.set(id, { summary, summarizedCount, recent });
    void userId;
    return id;
  }
}
