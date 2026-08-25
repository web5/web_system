import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import * as rawAxios from 'axios';
import { API_TIMEOUT } from '@web-system/shared';
import { BaseAiClient, ChatMessage, ChatOptions, StreamChunk, ToolCallSchema, ToolCall, ChatWithToolsResult } from './base-ai.client';

@Injectable()
export class Hy3Client extends BaseAiClient {
  private readonly logger = new Logger(Hy3Client.name);
  readonly modelId = 'hy3';
  readonly displayName = '混元 Turbo';
  readonly description = '腾讯混元大模型，中文理解力强';

  constructor(private readonly httpService: HttpService) {
    super();
  }

  isAvailable(): boolean {
    return !!(process.env.HY3_API_KEY && process.env.HY3_API_KEY.trim() !== '');
  }

  private getBaseUrl(): string {
    return process.env.HY3_BASE_URL || 'https://tokenhub.tencentmaas.com/v1';
  }

  /** 归一化得到 chat/completions 完整端点（兼容 baseUrl 是否带末尾路径） */
  private getChatEndpoint(): string {
    const base = this.getBaseUrl().replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) return base;
    return `${base}/chat/completions`;
  }

  private getApiKey(): string {
    const key = process.env.HY3_API_KEY;
    if (!key) throw new Error('HY3_API_KEY is not configured');
    return key;
  }

  /** 非流式对话 */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return (await this.chatWithTools(messages, [], options)).content;
  }

  /** 带工具调用的对话（Agent harness 核心） */
  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): Promise<ChatWithToolsResult> {
    try {
      const url = this.getChatEndpoint();
      const payload: Record<string, unknown> = {
        model: this.modelId,
        messages: messages.map((msg) => this.toApiMessage(msg)),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2000,
        top_p: options?.topP ?? 1.0,
        stream: false,
      };
      if (tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = 'auto';
      }

      this.logger.debug(`Calling Hy3 API with ${messages.length} messages, tools=${tools.length}`);

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${this.getApiKey()}`,
            'Content-Type': 'application/json',
          },
          timeout: API_TIMEOUT.UPSTREAM.CHAT,
        }),
      );

      const choice = response.data.choices?.[0];
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

      this.logger.debug(`Hy3 API response received, toolCalls=${toolCalls.length}`);
      return {
        content: assistantMessage.content,
        toolCalls,
        assistantMessage,
        finishReason: choice?.finish_reason,
      };
    } catch (error) {
      if (error.response) {
        this.logger.error(`Hy3 API error: ${error.message} | ${JSON.stringify(error.response.data)}`);
        throw new Error(`Hy3 服务调用失败: ${error.response.data?.error?.message || error.message}`);
      }
      this.logger.error(`Hy3 API error: ${error.message}`, error.stack);
      throw new Error(`Hy3 服务调用失败: ${error.message}`);
    }
  }

  /** 将内部 ChatMessage 转为 API 需要的格式（含 tool / tool_calls） */
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

  /** 流式对话 */
  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const url = this.getChatEndpoint();
    const payload = {
      model: this.modelId,
      messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      top_p: options?.topP ?? 1.0,
      stream: true,
    };

    this.logger.debug(`Calling Hy3 API stream with ${messages.length} messages`);

    const response = await rawAxios.default.post(url, payload, {
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        'Content-Type': 'application/json',
      },
      timeout: API_TIMEOUT.UPSTREAM.CHAT_STREAM,
      responseType: 'stream',
    });

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = '';

    try {
      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') {
            yield { content: '', done: true };
            return;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) yield { content: delta, done: false };
              if (json.choices?.[0]?.finish_reason === 'stop') {
                yield { content: '', done: true };
                return;
              }
            } catch { /* skip malformed lines */ }
          }
        }
      }
    } finally {
      (stream as any).destroy?.();
    }

    yield { content: '', done: true };
  }
}
