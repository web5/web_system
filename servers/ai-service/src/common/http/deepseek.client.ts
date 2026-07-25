import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import * as rawAxios from 'axios';
import { BaseAiClient, ChatMessage, ChatOptions, StreamChunk } from './base-ai.client';

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
    try {
      const url = `${this.getBaseUrl()}/chat/completions`;
      const payload = {
        model: this.modelId,
        messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2000,
        top_p: options?.topP ?? 1.0,
        stream: false,
      };

      this.logger.debug(`Calling DeepSeek API with ${messages.length} messages`);

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${this.getApiKey()}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }),
      );

      const replyContent = response.data.choices?.[0]?.message?.content;
      if (!replyContent) throw new Error('Invalid response from DeepSeek API');

      this.logger.debug(`DeepSeek API response received, length: ${replyContent.length}`);
      return replyContent;
    } catch (error) {
      this.logger.error(`DeepSeek API error: ${error.message}`, error.stack);
      if (error.response) {
        this.logger.error(`API response error: ${JSON.stringify(error.response.data)}`);
        throw new Error(`AI 服务调用失败: ${error.response.data?.error?.message || error.message}`);
      }
      throw new Error(`AI 服务调用失败: ${error.message}`);
    }
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
      timeout: 120000,
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
