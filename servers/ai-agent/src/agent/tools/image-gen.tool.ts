import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '@kedouai/agent-core';
import { API_TIMEOUT } from '@web-system/shared';

/** ai-service internal/image/submit 响应 */
interface InternalSubmitResponse {
  id?: string;
}

/** ai-service internal/image/query 响应（ImageGenClient.query 的映射结果） */
interface InternalQueryResponse {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  results?: Array<{ url: string; revised_prompt?: string }>;
}

/**
 * 生图工具（ai-agent 侧）：经 ai-service 内部接口提交 / 轮询生图任务。
 *
 * 为什么不直连生图上游：IMAGE_GEN_API_KEY 只在 ai-service .env 持有，
 * ai-agent 经 AI_SERVICE_URL 复用其 internal/image 接口，密钥单点配置。
 * 提交/轮询节奏与 ai-service 本地 ImageGenTool 保持一致。
 */
@Injectable()
export class ImageGenTool implements ToolDefinition {
  readonly name = 'image-gen';
  readonly description =
    '根据文本提示词生成图片，返回生成结果的图片 URL。当用户需要画图、创作插画或视觉内容时使用。';
  readonly parameters = {
    prompt: { type: 'string' as const, description: '图片生成的文本描述（中文或英文）', required: true },
  };

  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    const base = configService.get<string>('AI_SERVICE_URL', 'http://localhost:6003');
    this.baseUrl = `${base.replace(/\/$/, '')}/internal/image`;
  }

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: { prompt: { type: 'string', description: '图片生成的文本描述' } },
          required: ['prompt'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) {
      return { success: false, content: '', error: 'prompt 不能为空' };
    }

    try {
      const submit = await this.post<InternalSubmitResponse>('/submit', { prompt });
      if (!submit.id) {
        return { success: false, content: '', error: '生图任务提交失败：未返回任务 ID' };
      }

      // 轮询结果（与 ai-service ImageGenTool 同口径：AI_QUERY 超时 / 2s 间隔）
      const maxAttempts = Math.floor(API_TIMEOUT.AI_QUERY / 2000);
      let lastStatus = '';
      for (let i = 0; i < maxAttempts; i++) {
        const result = await this.post<InternalQueryResponse>('/query', { id: submit.id });
        lastStatus = result.status;
        if (result.status === 'succeeded' && result.results?.length) {
          const urls = result.results.map((r) => r.url).join('\n');
          return { success: true, content: `已生成图片，URL 如下：\n${urls}` };
        }
        if (result.status === 'failed') {
          return { success: false, content: '', error: `生图任务失败，状态: ${result.status}` };
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      return { success: false, content: '', error: `生图任务超时未完成，最后状态: ${lastStatus}` };
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT.UPSTREAM.DEFAULT),
    });
    if (!res.ok) {
      throw new Error(`ai-service ${path} 失败: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
