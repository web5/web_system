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

/** 大模型返回的 token 消耗（OpenAI 标准 usage 字段） */
export interface TokenUsage {
  /** 输入 token 数 */
  promptTokens: number;
  /** 输出 token 数 */
  completionTokens: number;
  /** 总 token 数 */
  totalTokens: number;
}

/** 一次带工具推理的响应 */
export interface ChatWithToolsResult {
  content: string;
  toolCalls: ToolCall[];
  assistantMessage: ChatMessage;
  finishReason?: string;
  /** 大模型返回的真实 token 消耗（若有） */
  usage?: TokenUsage;
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

  getModelInfo(): ModelInfo {
    return {
      id: this.modelId,
      displayName: this.displayName,
      description: this.description,
      available: this.isAvailable(),
    };
  }
}
