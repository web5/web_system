import { Injectable } from '@nestjs/common';
import { TokenHubClient } from '@kedouai/agent-core';
import {
  BaseAiClient,
  ChatMessage,
  ChatOptions,
  StreamChunk,
  ToolCallSchema,
  ChatWithToolsResult,
} from './base-ai.client';

@Injectable()
export class DeepseekClient extends BaseAiClient {
  readonly modelId = 'deepseek-v4-flash';
  readonly displayName = 'DeepSeek V4 Flash';
  readonly description = '速度快、逻辑推理强，适合大多数问答场景';
  private readonly client = new TokenHubClient(this.modelId, this.displayName);

  isAvailable(): boolean {
    return this.client.isAvailable();
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return (await this.chatWithTools(messages, [], options)).content;
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): Promise<ChatWithToolsResult> {
    return this.client.chatWithTools(
      messages.map((message) => ({ ...message, ts: Date.now() })),
      tools,
      { ...options, maxTokens: options?.maxTokens ?? 2000 },
    );
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    yield* this.client.chatStream(
      messages.map((message) => ({ ...message, ts: Date.now() })),
      { ...options, maxTokens: options?.maxTokens ?? 2000 },
    );
  }
}
