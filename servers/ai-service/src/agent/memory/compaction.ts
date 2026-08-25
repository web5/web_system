import { Injectable } from '@nestjs/common';
import { BaseAiClient } from '../../common/http/base-ai.client';
import { AgentMemoryConfig } from '../interfaces/agent.interface';
import { StoredMessage } from './stored-message';

const SUMMARY_PROMPT = `请将以下对话历史压缩为一段简洁的摘要，保留关键事实、用户偏好与未完成的任务。不要编造信息。`;

/**
 * 摘要压缩策略：增量压缩（旧摘要 + 早期消息 → 新摘要）。
 * 骨架占位：实现待方案确认后填充
 */
@Injectable()
export class Compaction {
  constructor() {}

  shouldCompact(recent: StoredMessage[], config: AgentMemoryConfig): boolean {
    return config.enabled && recent.length >= config.compactionThreshold;
  }

  async compact(
    oldSummary: string | null,
    oldPart: StoredMessage[],
    client: BaseAiClient,
  ): Promise<string> {
    void oldSummary;
    void oldPart;
    void client;
    return ''; // TODO: 调 client.chat() 生成增量摘要
  }
}
