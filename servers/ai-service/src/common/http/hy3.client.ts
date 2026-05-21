import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

@Injectable()
export class Hy3Client {
  private readonly logger = new Logger(Hy3Client.name);
  private readonly model = 'tencent/hy3-preview';

  constructor(private readonly httpService: HttpService) {}

  /**
   * 调用 Hy3 preview API 进行对话
   * @param messages 对话消息列表
   * @param options 可选参数
   * @returns AI 回复内容
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<string> {
    try {
      const baseUrl = process.env.HY3_BASE_URL || 'https://wcode.net/api/gpt/v1';
      const apiKey = process.env.HY3_API_KEY;

      if (!apiKey) {
        throw new Error('HY3_API_KEY is not configured');
      }

      const url = `${baseUrl}/chat/completions`;

      const payload = {
        model: this.model,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 2000,
        top_p: options?.topP || 1.0,
      };

      this.logger.debug(`Calling Hy3 API with ${messages.length} messages`);

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 60 秒超时
        }),
      );

      const replyContent = response.data.choices[0]?.message?.content;

      if (!replyContent) {
        throw new Error('Invalid response from Hy3 API');
      }

      this.logger.debug(`Hy3 API response received, length: ${replyContent.length}`);

      return replyContent;
    } catch (error) {
      this.logger.error(`Hy3 API error: ${error.message}`, error.stack);
      
      if (error.response) {
        this.logger.error(`API response error: ${JSON.stringify(error.response.data)}`);
        throw new Error(`AI 服务调用失败: ${error.response.data?.error?.message || error.message}`);
      }
      
      throw new Error(`AI 服务调用失败: ${error.message}`);
    }
  }
}
