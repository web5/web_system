/**
 * TokenHub 通用客户端（腾讯 MaaS 网关，OpenAI 兼容）。
 *
 * 与 Hy3Client/DeepseekClient 协议一致（chat/completions + OpenAI function calling），
 * 区别：modelId 由构造注入，因此可用网关上托管的任意模型
 * （如 deepseek-v4-flash、deepseek-v4-pro-0813、hy4-preview、glm-5.3、kimi-k3 等）。
 *
 * 配置：
 *   TOKENHUB_BASE_URL  默认 https://tokenhub.tencentmaas.com/v1
 *   TOKENHUB_API_KEY   缺省回落到 HY3_API_KEY（同一把网关 key）
 */
import {
  BaseAiClient,
  ChatMessage,
  ChatOptions,
  StreamChunk,
  ToolCallSchema,
  ToolCall,
  ChatWithToolsResult,
  StreamToolEvent,
  parseJsonToolCall,
} from './base-ai.client';
import { Logger } from '../lib/logger';
import { API_TIMEOUT } from '../lib/timeout';
import { postJson, streamSse } from '../lib/fetch-http';

const DEFAULT_BASE_URL = 'https://tokenhub.tencentmaas.com/v1';

export class TokenHubClient extends BaseAiClient {
  readonly modelId: string;
  readonly displayName: string;
  readonly description: string;
  private readonly logger = new Logger(TokenHubClient.name);

  constructor(modelId: string, displayName?: string) {
    super();
    this.modelId = modelId;
    this.displayName = displayName || modelId;
    this.description = `TokenHub 托管模型 ${modelId}`;
  }

  private getApiKey(): string {
    return process.env.TOKENHUB_API_KEY ?? process.env.HY3_API_KEY ?? '';
  }
  private getBaseUrl(): string {
    return process.env.TOKENHUB_BASE_URL || process.env.HY3_BASE_URL || DEFAULT_BASE_URL;
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
      throw new Error(`${this.modelId} 不可用：请配置 TOKENHUB_API_KEY 或 HY3_API_KEY`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
      stream: false,
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    try {
      const data = await postJson<any>(
        this.getChatEndpoint(),
        payload,
        { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 300_000 },
      );
      const choice = data.choices?.[0];
      const message = choice?.message ?? {};
      if (!choice) throw new Error(`Invalid response: ${this.modelId}`);

      const rawToolCalls: any[] | undefined = message.tool_calls;
      let toolCalls: ToolCall[] = Array.isArray(rawToolCalls)
        ? rawToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments ?? '{}',
          }))
        : [];
      // 兜底：部分模型把工具调用写成文本 JSON
      if (toolCalls.length === 0) {
        const parsed = parseJsonToolCall(message.content ?? '');
        if (parsed) toolCalls = parsed;
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: message.content ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
      const usage = data.usage;
      return {
        content: assistantMessage.content,
        toolCalls,
        assistantMessage,
        finishReason: choice?.finish_reason,
        usage:
          usage
            ? {
                promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
                completionTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
                totalTokens:
                  usage.total_tokens ??
                  (usage.prompt_tokens ?? usage.input_tokens ?? 0) +
                    (usage.completion_tokens ?? usage.output_tokens ?? 0),
              }
            : undefined,
      };
    } catch (error) {
      this.logger.error(`${this.modelId} API error: ${(error as Error).message}`);
      throw new Error(`${this.modelId} 调用失败: ${(error as Error).message}`);
    }
  }

  /** 流式带工具推理（真流式 + tool_calls 增量聚合） */
  async *chatWithToolsStream(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamToolEvent, void, unknown> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`${this.modelId} 不可用：请配置 TOKENHUB_API_KEY 或 HY3_API_KEY`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    let content = '';
    let finishReason: string | undefined;
    const toolAcc: Record<number, { id: string; name: string; arguments: string }> = {};
    let sawAnyToolCall = false;
    let lastUsage:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;

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
      // 流式 usage：OpenAI Chat Completions 用 prompt_tokens/completion_tokens；
      // TokenHub 兼容 Responses API 时用 input_tokens/output_tokens（字段名不同）
      const u = parsed.usage;
      if (u) {
        const prompt = u.prompt_tokens ?? u.input_tokens;
        const completion = u.completion_tokens ?? u.output_tokens;
        if (typeof prompt === 'number' && typeof completion === 'number') {
          lastUsage = {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: u.total_tokens ?? prompt + completion,
          };
        }
      }
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      finishReason = choice.finish_reason ?? finishReason;

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        yield { type: 'content_delta', delta: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        sawAnyToolCall = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const acc = (toolAcc[idx] = toolAcc[idx] ?? { id: '', name: '', arguments: '' });
          if (tc.id) acc.id += tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    let toolCalls: ToolCall[] = sawAnyToolCall
      ? Object.values(toolAcc).map((a) => ({
          id: a.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: a.name,
          arguments: a.arguments || '{}',
        }))
      : [];
    if (toolCalls.length === 0) {
      const parsed = parseJsonToolCall(content);
      if (parsed) toolCalls = parsed;
    }

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
    yield {
      type: 'done',
      result: { content, toolCalls, assistantMessage, finishReason, usage: lastUsage },
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`${this.modelId} 不可用：请配置 TOKENHUB_API_KEY 或 HY3_API_KEY`);
    }
    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
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
