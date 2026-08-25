import { Injectable } from '@nestjs/common';
import { ConversationService } from '../../conversation/conversation.service';
import { AgentMemoryConfig } from '../interfaces/agent.interface';
import { StoredMessage } from './stored-message';

/**
 * 对话记忆：基于重构后的 ConversationService 做持久记忆 + 摘要压缩。
 * 骨架占位：实现待方案确认后填充
 */
@Injectable()
export class ConversationMemory {
  constructor(private readonly conversationService: ConversationService) {}

  /** 加载：返回 [summary, ...recentMessages] */
  async load(userId: string, conversationId: string): Promise<{ summary: string | null; messages: StoredMessage[] }> {
    void userId;
    void conversationId;
    return { summary: null, messages: [] };
  }

  /** 落库：run 结束后写入，内部判断是否触发 compaction */
  async persist(
    userId: string,
    conversationId: string | undefined,
    fullRunMessages: StoredMessage[],
    config: AgentMemoryConfig,
  ): Promise<string> {
    void userId;
    void conversationId;
    void fullRunMessages;
    void config;
    return '';
  }
}
