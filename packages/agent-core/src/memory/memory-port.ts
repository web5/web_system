/**
 * 对话记忆端口：AgentEngine 仅依赖此接口，便于在 CLI / 测试场景替换实现。
 */
import { ChatMessage } from '../clients/base-ai.client';
import { AgentMemoryConfig } from '../interfaces/agent.interface';

export interface ConversationMemoryPort {
  load(userId: string, conversationId: string): Promise<{ summary: string | null; messages: ChatMessage[] }>;
  persist(
    userId: string,
    conversationId: string | undefined,
    fullRunMessages: ChatMessage[],
    config: AgentMemoryConfig,
  ): Promise<string>;
}
