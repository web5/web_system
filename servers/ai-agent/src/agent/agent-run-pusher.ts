import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 把 ai-agent 的 run 记录推送到 ai-service 统一落库。
 *
 * ai-service 暴露 POST /api/internal/agent-runs（无 auth ，
 * 通过内网/Nginx 限制只允许 127.0.0.1 与容器内网访问）。
 *
 * 失败不抛错：run 日志是辅助功能，主链路不能被日志拖垮。
 */
@Injectable()
export class AgentRunPusher {
  private readonly logger = new Logger(AgentRunPusher.name);
  private readonly endpoint: string;

  constructor(private readonly configService: ConfigService) {
    const base = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:6003',
    );
    this.endpoint = `${base.replace(/\/$/, '')}/internal/agent-runs`;
  }

  async push(payload: {
    agentId: string;
    agentName?: string | null;
    userId: string;
    conversationId?: string | null;
    userInput: string;
    systemPrompt: string;
    tools?: string[] | null;
    model?: string | null;
    steps: Array<{
      type: string;
      name?: string;
      content?: string;
      args?: unknown;
      step?: number;
      ts: number;
    }>;
    finalAnswer?: string | null;
    error?: string | null;
    status: 'ok' | 'error';
    durationMs?: number | null;
    source?: string;
  }): Promise<void> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, source: payload.source ?? 'ai-agent' }),
      });
      if (!res.ok) {
        this.logger.warn(`推 run 记录失败: status=${res.status}`);
      }
    } catch (e) {
      this.logger.warn(`推 run 记录异常: ${(e as Error).message}`);
    }
  }
}
