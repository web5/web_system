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
  /** tool 消息：对应 assistant tool_calls 的 id */
  toolCallId?: string;
  /** assistant 消息：模型发起的工具调用 */
  toolCalls?: ToolCall[];
  /** assistant 消息：工具调用对应的函数名（部分模型回写需要） */
  name?: string;
}

/** 一次带工具推理的响应 */
export interface ChatWithToolsResult {
  /** 文本回复（可能与 tool_calls 并存） */
  content: string;
  /** 工具调用列表（空数组表示最终回答） */
  toolCalls: ToolCall[];
  /** 完整的 assistant 消息，含 tool_calls，供回写 messages */
  assistantMessage: ChatMessage;
  /** 模型停止原因 */
  finishReason?: string;
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

  /**
   * 带工具调用的对话（Agent harness 核心）。
   * 模型可返回文本回复和/或 tool_calls；无 tool_calls 即为最终回答。
   */
  abstract chatWithTools(
    messages: ChatMessage[],
    tools: ToolCallSchema[],
    options?: ChatOptions,
  ): Promise<ChatWithToolsResult>;

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
