/**
 * Hy3 客户端（腾讯混元 Turbo，Tencent MaaS TokenHub），原生 fetch 版。
 */
import { BaseAiClient, ChatMessage, ChatOptions, StreamChunk, ToolCallSchema, ToolCall, ChatWithToolsResult } from './base-ai.client';
import { Logger } from '../lib/logger';
import { API_TIMEOUT } from '../lib/timeout';
import { postJson, streamSse } from '../lib/fetch-http';

const DEFAULT_BASE_URL = 'https://tokenhub.tencentmaas.com/v1';

export class Hy3Client extends BaseAiClient {
  readonly modelId = 'hy3';
  readonly displayName = '混元 Turbo';
  readonly description = '腾讯混元 Turbo（Tencent MaaS TokenHub）';
  private readonly logger = new Logger(Hy3Client.name);

  private getApiKey(): string {
    return process.env.HY3_API_KEY ?? '';
  }
  private getBaseUrl(): string {
    return process.env.HY3_BASE_URL || DEFAULT_BASE_URL;
  }
  private getChatEndpoint(): string {
    const base = this.getBaseUrl().replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) return base;
    return `${base}/chat/completions`;
  }

  isAvailable(): boolean {
    return !!this.getApiKey().trim();
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return (await this.chatWithTools(messages, [], options)).content;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): Promise<ChatWithToolsResult> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`Hy3 模型不可用：请配置 HY3_API_KEY 环境变量`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      top_p: options?.topP ?? 1.0,
      stream: false,
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    this.logger.debug(`调用 Hy3 API，messages=${messages.length}, tools=${tools.length}`);

    try {
      const data = await postJson<any>(
        this.getChatEndpoint(),
        payload,
        { headers: { Authorization: `Bearer ${key}` }, timeoutMs: API_TIMEOUT.AI_TASK },
      );
      const choice = data.choices?.[0];
      const message = choice?.message ?? {};
      if (!choice) throw new Error('Invalid response from Hy3 API');

      const rawToolCalls: any[] | undefined = message.tool_calls;
      const toolCalls: ToolCall[] = Array.isArray(rawToolCalls)
        ? rawToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments ?? '{}',
          }))
        : [];

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: message.content ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };

      return {
        content: assistantMessage.content,
        toolCalls,
        assistantMessage,
        finishReason: choice?.finish_reason,
      };
    } catch (error) {
      this.logger.error(`Hy3 API error: ${(error as Error).message}`);
      throw new Error(`Hy3 服务调用失败: ${(error as Error).message}`);
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`Hy3 模型不可用：请配置 HY3_API_KEY 环境变量`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      stream: true,
    };

    for await (const ev of streamSse(this.getChatEndpoint(), payload, {
      headers: { Authorization: `Bearer ${key}` },
      timeoutMs: API_TIMEOUT.AI_TASK,
    })) {
      if (ev.done) break;
      let parsed: any;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        continue;
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) yield { content: delta, done: false };
    }
    yield { content: '', done: true };
  }

  private toApiMessage(m: ChatMessage): Record<string, unknown> {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content };
  }
}
