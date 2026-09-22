/**
 * 对话记忆端口：AgentEngine 仅依赖此接口，便于在 CLI / 测试场景替换实现。
 */
import { type ChatMessage } from '../clients/base-ai.client';
import { type AgentMemoryConfig } from '../interfaces/agent.interface';

export interface ConversationMemoryPort {
  load(userId: string, conversationId: string): Promise<{ summary: string | null; messages: ChatMessage[] }>;
  /**
   * 用户级长期记忆（跨会话），如口味档案。
   * 可选实现：不提供则引擎跳过注入（内存版记忆不实现）。
   * 与 load() 分开是因为它与 conversationId 无关——新会话的第一句话也要带上。
   */
  loadProfile?(userId: string): Promise<string | null>;
  persist(
    userId: string,
    conversationId: string | undefined,
    fullRunMessages: ChatMessage[],
    config: AgentMemoryConfig,
  ): Promise<string>;
}
