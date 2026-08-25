/**
 * 摘要压缩策略：增量压缩（旧摘要 + 早期消息 → 新摘要）。
 * 摘要模型跟随用户所选（不硬编码 hy3）。
 */
import { ClientRegistry } from '../registry/client.registry';
import { BaseAiClient, ChatMessage } from '../clients/base-ai.client';
import { AgentMemoryConfig } from '../interfaces/agent.interface';
import { StoredMessage } from './stored-message';
import { Logger } from '../lib/logger';

const SUMMARY_PROMPT = `你是一个对话摘要助手。请将下面的对话历史压缩为一段简洁中文摘要，保留：关键事实、用户偏好、未完成任务、以及任何对后续对话重要的上下文。不要编造信息，不要输出摘要以外的解释。`;

export class Compaction {
  private readonly logger = new Logger(Compaction.name);

  constructor(private readonly clientRegistry: ClientRegistry) {}

  shouldCompact(recent: StoredMessage[], config: AgentMemoryConfig): boolean {
    return config.enabled && recent.length >= config.compactionThreshold;
  }

  /**
   * 对早期消息做增量压缩。
   * @param oldSummary 旧摘要
   * @param oldPart 待压缩的早期消息
   * @param preferredModelId 用户所选模型（摘要用同模型，未指定则回退）
   */
  async compact(
    oldSummary: string | null,
    oldPart: StoredMessage[],
    preferredModelId?: string,
  ): Promise<string> {
    const historyText = oldPart.map((m) => `[${m.role}] ${m.content}`).join('\n');
    const userPrompt = oldSummary
      ? `已有摘要：\n${oldSummary}\n\n需要追加合并的对话片段：\n${historyText}\n\n请输出合并后的完整摘要。`
      : `需要摘要的对话片段：\n${historyText}\n\n请输出摘要。`;

    let client: BaseAiClient;
    try {
      client = preferredModelId
        ? this.clientRegistry.getOrFallback(preferredModelId)
        : this.clientRegistry.getOrFallback();
    } catch {
      return oldSummary ?? '';
    }

    try {
      const content = await client.chat(
        [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.2, maxTokens: 800 },
      );
      return content.trim();
    } catch (error) {
      this.logger.error(`摘要压缩失败: ${(error as Error).message}`);
      return oldSummary ?? '';
    }
  }

  /** 将引擎的完整 messages 中可持久的部分（去掉 system）提取为 StoredMessage */
  extractPersistable(messages: ChatMessage[]): StoredMessage[] {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as StoredMessage['role'],
        content: m.content,
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      }));
  }
}
