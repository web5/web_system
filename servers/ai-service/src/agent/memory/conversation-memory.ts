import { Injectable, Logger } from '@nestjs/common';
import { ConversationService } from '../../conversation/conversation.service';
import {
  Compaction,
  ConversationMemoryPort,
  AgentMemoryConfig,
  StoredMessage,
  ChatMessage,
} from '@kedou-ai/agent-core';

/**
 * 对话记忆（DB 版）：基于 ConversationService 做持久记忆 + 摘要压缩。
 * 实现 @kedou-ai/agent-core 的 ConversationMemoryPort，供 agent-core 引擎使用。
 */
@Injectable()
export class ConversationMemory implements ConversationMemoryPort {
  private readonly logger = new Logger(ConversationMemory.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly compaction: Compaction,
  ) {}

  /** 加载：返回 [summary, ...recentMessages] 供引擎拼接 */
  async load(userId: string, conversationId: string): Promise<{ summary: string | null; messages: ChatMessage[] }> {
    const mem = await this.conversationService.loadAgentMemory(userId, conversationId);
    const messages: ChatMessage[] = (mem.recentMessages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      ...(m.name ? { name: m.name } : {}),
    }));
    return { summary: mem.summary, messages };
  }

  /**
   * 落库：run 结束后写入，内部判断是否触发摘要压缩。
   * @param fullRunMessages 引擎拼装的完整消息（含 system / summary / 本轮）
   */
  async persist(
    userId: string,
    conversationId: string | undefined,
    fullRunMessages: ChatMessage[],
    config: AgentMemoryConfig,
  ): Promise<string> {
    // 去掉 system（system prompt + 摘要上下文不持久化），只保留对话轮次
    let recent = this.compaction.extractPersistable(fullRunMessages);

    let summary: string | null = null;
    let summarizedCount = 0;
    if (conversationId) {
      const existing = await this.conversationService.loadAgentMemory(userId, conversationId);
      summary = existing.summary;
      summarizedCount = existing.summarizedCount;
    }

    // 触发压缩：早期部分压缩为摘要，近期部分保留
    if (this.compaction.shouldCompact(recent, config)) {
      const oldPart = recent.slice(0, recent.length - config.keepRecent);
      const newRecent = recent.slice(recent.length - config.keepRecent);
      const newSummary = await this.compaction.compact(summary, oldPart);
      if (newSummary) {
        summary = newSummary;
        summarizedCount += oldPart.length;
        recent = newRecent;
        this.logger.log(`触发摘要压缩: 压缩 ${oldPart.length} 条，保留近期 ${newRecent.length} 条`);
      }
    }

    const firstUserText = recent.find((m) => m.role === 'user')?.content ?? '';

    return this.conversationService.saveAgentMemory(
      userId,
      conversationId,
      recent as StoredMessage[],
      summary,
      summarizedCount,
      firstUserText,
    );
  }
}
