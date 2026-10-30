import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SERVICE_URL_DEFAULTS } from '@web-system/shared';

/** 生成摘要的明细原料（与 internal/llm/memory-summary 入参对齐） */
export interface SummaryItemInput {
  category: string;
  content: string;
}

/**
 * ai-agent「记忆摘要生成」internal 客户端（#8229 架构修正）。
 *
 * LLM 调用统一走 ai-agent 的 AI 服务通道：user-service 在 rebuild 时调用
 * POST {AI_AGENT_URL}/internal/llm/memory-summary（x-service-key = USER_SERVICE_KEY，
 * 两端同 key，未配置时 ai-agent fail-closed 401）。user-service 不直连 TokenHub、
 * 不持有任何 LLM 密钥。
 *
 * 超时预算 30s（对端 maxTokens 800 的补全调用）；任何失败向上抛，
 * 由 UserMemorySummaryService 回落确定性模板聚合（链路不阻断）。
 */
@Injectable()
export class AiAgentSummaryClient {
  private readonly logger = new Logger(AiAgentSummaryClient.name);

  private readonly aiAgentUrl: string;
  private readonly serviceKey: string;

  constructor(private readonly configService: ConfigService) {
    this.aiAgentUrl = this.configService.get<string>('AI_AGENT_URL', SERVICE_URL_DEFAULTS.aiAgent);
    this.serviceKey = this.configService.get<string>('USER_SERVICE_KEY', '');
  }

  /** 生成摘要文本；失败抛错（调用方兜底） */
  async summarize(userId: string, namespace: string, items: SummaryItemInput[], itemCount: number): Promise<string> {
    const url = `${this.aiAgentUrl.replace(/\/$/, '')}/internal/llm/memory-summary`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': this.serviceKey,
      },
      body: JSON.stringify({ userId, namespace, itemCount, items }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`ai-agent internal llm/memory-summary 返回 ${res.status}`);
    }
    const body = (await res.json()) as { summary?: string };
    return body?.summary ?? '';
  }
}
