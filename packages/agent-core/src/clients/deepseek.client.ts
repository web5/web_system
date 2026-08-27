/**
 * DeepSeek 客户端（OpenAI 兼容），原生 fetch 版。
 */
import { BaseAiClient, ChatMessage, ChatOptions, StreamChunk, ToolCallSchema, ToolCall, ChatWithToolsResult, StreamToolEvent } from './base-ai.client';
import { Logger } from '../lib/logger';
import { API_TIMEOUT } from '../lib/timeout';
import { postJson, streamSse } from '../lib/fetch-http';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

export class DeepseekClient extends BaseAiClient {
  readonly modelId = 'deepseek-chat';
  readonly displayName = 'DeepSeek Chat';
  readonly description = 'DeepSeek Chat（支持稳定的 function calling）';
  private readonly logger = new Logger(DeepseekClient.name);

  private getApiKey(): string {
    return process.env.DEEPSEEK_API_KEY ?? process.env.DEPSEEK_API_KEY ?? '';
  }
  private getBaseUrl(): string {
    return process.env.DEEPSEEK_BASE_URL || process.env.DEPSEEK_BASE_URL || DEFAULT_BASE_URL;
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
      throw new Error(`DeepSeek 模型不可用：请配置 DEPSEEK_API_KEY 环境变量`);
    }

    const payload: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => this.toApiMessage(m)),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      stream: false,
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    this.logger.debug(`调用 DeepSeek API，messages=${messages.length}, tools=${tools.length}`);

    try {
      const data = await postJson<any>(
        this.getChatEndpoint(),
        payload,
        { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 300_000 },
      );
      const choice = data.choices?.[0];
      const message = choice?.message ?? {};
      if (!choice) throw new Error('Invalid response from DeepSeek API');

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

      // OpenAI 标准 usage：{ prompt_tokens, completion_tokens, total_tokens }
      const usage = data.usage;
      return {
        content: assistantMessage.content,
        toolCalls,
        assistantMessage,
        finishReason: choice?.finish_reason,
        usage:
          usage && typeof usage.prompt_tokens === 'number'
            ? {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens ?? 0,
                totalTokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
              }
            : undefined,
      };
    } catch (error) {
      this.logger.error(`DeepSeek API error: ${(error as Error).message}`);
      throw new Error(`AI 服务调用失败: ${(error as Error).message}`);
    }
  }

  /**
   * 流式带工具推理（DeepSeek OpenAI 兼容）。
   *
   * 逐 SSE 事件处理：
   * - delta.content 增量 → yield content_delta（供引擎转发前端做"逐字渲染"）
   * - delta.tool_calls 增量 → 按 index 聚合成完整 ToolCall（arguments 是分片，需拼接）
   * 流结束时根据是否有 toolCalls 返回最终 result。
   *
   * 注意：DeepSeek 流式下，工具调用轮 content 通常为空、tool_calls 有增量；
   * 直接回答轮 content 有增量。两者独立累积，互不干扰。
   */
  async *chatWithToolsStream(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamToolEvent, void, unknown> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`DeepSeek 模型不可用：请配置 DEPSEEK_API_KEY 环境变量`);
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

    // 累积变量
    let content = '';
    let finishReason: string | undefined;
    // 工具调用按 index 聚合：index -> { id, name, arguments(拼接) }
    const toolAcc: Record<number, { id: string; name: string; arguments: string }> = {};
    let sawAnyToolCall = false;

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
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      finishReason = choice.finish_reason ?? finishReason;

      // 1) content 增量
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        yield { type: 'content_delta', delta: delta.content };
      }

      // 2) tool_calls 增量（分片累积）
      if (Array.isArray(delta.tool_calls)) {
        sawAnyToolCall = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const acc = (toolAcc[idx] = toolAcc[idx] ?? {
            id: '',
            name: '',
            arguments: '',
          });
          if (tc.id) acc.id += tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    // 组装 toolCalls（若有）
    const toolCalls: ToolCall[] = sawAnyToolCall
      ? Object.values(toolAcc).map((a) => ({
          id: a.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: a.name,
          arguments: a.arguments || '{}',
        }))
      : [];

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };

    yield {
      type: 'done',
      result: {
        content,
        toolCalls,
        assistantMessage,
        finishReason,
      },
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const key = this.getApiKey();
    if (!key.trim()) {
      throw new Error(`DeepSeek 模型不可用：请配置 DEPSEEK_API_KEY 环境变量`);
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
