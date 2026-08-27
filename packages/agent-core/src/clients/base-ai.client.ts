/**
 * AI 客户端统一抽象（纯 TS，无 Nest 依赖）。
 */

export interface StreamChunk {
  content: string;
  done: boolean;
}

/** OpenAI 兼容的工具定义（tools 参数） */
export interface ToolCallSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

/** 模型返回的 tool_call（assistant 消息内） */
export interface ToolCall {
  id: string;
  name: string;
  /** 已 JSON 序列化的参数 */
  arguments: string;
}

/**
 * 统一对话消息。
 * - role 'tool' 用于工具执行结果回写，必须带 toolCallId
 * - role 'assistant' 可在 toolCalls 非空时携带模型发起的工具调用
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

/** 一次带工具推理的响应 */
export interface ChatWithToolsResult {
  content: string;
  toolCalls: ToolCall[];
  assistantMessage: ChatMessage;
  finishReason?: string;
}

/**
 * 流式带工具推理的事件。
 * - content_delta：模型正在生成 content 的增量片段（供前端"边生成边渲染"）
 * - done：整轮推理结束，携带最终 result（含 toolCalls 判断结果）
 */
export interface StreamToolEvent {
  type: 'content_delta' | 'done';
  /** content_delta 时：本片增量文本 */
  delta?: string;
  /** done 时：本轮完整结果 */
  result?: ChatWithToolsResult;
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

export abstract class BaseAiClient {
  abstract readonly modelId: string;
  abstract readonly displayName: string;
  abstract readonly description: string;

  abstract isAvailable(): boolean;

  abstract chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  abstract chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>;

  abstract chatWithTools(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): Promise<ChatWithToolsResult>;

  /**
   * 流式带工具推理。
   * 默认实现：非流式客户端回退到 chatWithTools，一次性吐出全部 content，
   * 保证不破坏现有引擎调用（引擎无需感知客户端是否真流式）。
   * 支持真流式的客户端（如 DeepSeek）应覆写此方法，逐 token 吐 content_delta。
   */
  async *chatWithToolsStream(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamToolEvent, void, unknown> {
    const result = await this.chatWithTools(messages, tools, options);
    if (result.content) {
      yield { type: 'content_delta', delta: result.content };
    }
    yield { type: 'done', result };
  }

  getModelInfo(): ModelInfo {
    return {
      id: this.modelId,
      displayName: this.displayName,
      description: this.description,
      available: this.isAvailable(),
    };
  }
}
