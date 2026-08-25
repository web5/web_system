import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import * as rawAxios from 'axios';
import { API_TIMEOUT } from '@web-system/shared';
import { BaseAiClient, ChatMessage, ChatOptions, StreamChunk, ToolCallSchema, ToolCall, ChatWithToolsResult } from './base-ai.client';

@Injectable()
export class DeepseekClient extends BaseAiClient {
  private readonly logger = new Logger(DeepseekClient.name);
  readonly modelId = 'deepseek-v4-flash';
  readonly displayName = 'DeepSeek V4 Flash';
  readonly description = '速度快、逻辑推理强，适合大多数问答场景';

  constructor(private readonly httpService: HttpService) {
    super();
  }

  isAvailable(): boolean {
    return !!process.env.DEEPSEEK_API_KEY;
  }

  private getBaseUrl(): string {
    return process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  }

  private getApiKey(): string {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY is not configured');
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
      const url = `${this.getBaseUrl()}/chat/completions`;
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

      this.logger.debug(`Calling DeepSeek API with ${messages.length} messages, tools=${tools.length}`);

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

      this.logger.debug(`DeepSeek API response received, toolCalls=${toolCalls.length}`);
      return {
        content: assistantMessage.content,
        toolCalls,
        assistantMessage,
        finishReason: choice?.finish_reason,
      };
    } catch (error) {
      if (error.response) {
        this.logger.error(`DeepSeek API error: ${error.message} | ${JSON.stringify(error.response.data)}`);
        throw new Error(`AI 服务调用失败: ${error.response.data?.error?.message || error.message}`);
      }
      this.logger.error(`DeepSeek API error: ${error.message}`, error.stack);
      throw new Error(`AI 服务调用失败: ${error.message}`);
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
    const url = `${this.getBaseUrl()}/chat/completions`;
    const payload = {
      model: this.modelId,
      messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
      top_p: options?.topP ?? 1.0,
      stream: true,
    };

    this.logger.debug(`Calling DeepSeek API stream with ${messages.length} messages`);

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
