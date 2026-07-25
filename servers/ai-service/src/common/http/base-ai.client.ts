export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  available: boolean;
}

/** AI 客户端统一抽象 */
export abstract class BaseAiClient {
  /** 模型唯一标识 */
  abstract readonly modelId: string;
  /** 展示名称 */
  abstract readonly displayName: string;
  /** 模型简介 */
  abstract readonly description: string;

  /** 检查此客户端是否可用（API Key 已配置） */
  abstract isAvailable(): boolean;

  /** 非流式对话 */
  abstract chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<string>;

  /** 流式对话 */
  abstract chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /** 获取模型信息 */
  getModelInfo(): ModelInfo {
    return {
      id: this.modelId,
      displayName: this.displayName,
      description: this.description,
      available: this.isAvailable(),
    };
  }
}
