/**
 * AI 客户端统一抽象（纯 TS，无 Nest 依赖）。
 */

import type { JsonSchemaProperty } from '../interfaces/tool.interface';

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
      properties: Record<string, JsonSchemaProperty>;
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
  /**
   * 消息写入时间戳（ms）——必填（B6），仅用于历史回放按时间分段（如日期线），
   * 不进入模型请求体（各 client 走 toApiMessage 白名单，不会携带该字段）。
   */
  ts: number;
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

/**
 * 流式带工具推理的事件。
 * - content_delta：模型正在生成 content 的增量片段（供前端"边生成边渲染"）
 * - reasoning_delta：模型正在"思考"的增量片段（供前端做"思考中"可视化）
 * - done：整轮推理结束，携带最终 result（含 toolCalls 判断结果）
 */
export interface StreamToolEvent {
  type: 'content_delta' | 'reasoning_delta' | 'done';
  /** content_delta / reasoning_delta 时：本片增量文本 */
  delta?: string;
  /** done 时：本轮完整结果 */
  result?: ChatWithToolsResult;
}

/**
 * 思考开关（仅 TokenHub 系模型支持，网关透传官方 `thinking` 参数）。
 *
 * 之所以需要「按调用」覆盖：TokenHubClient 会按模型名自动给 DeepSeek 系注入
 * `budget:1024`（防长任务思考把正文挤成 0）。但对「只要一小段结构化输出」的低成本调用
 * （如意图分类 maxTokens=60），1024 的思考预算会把输出预算**全部吃光** ——
 * 实测 `finish_reason=length`、`content` 为空，调用方拿到空串只能当失败处理。
 * 全局环境变量 `TOKENHUB_THINKING` 是给主对话用的，不能用它来修单点调用。
 */
export interface ThinkingOption {
  type: 'enabled' | 'disabled';
  /** type='enabled' 时的思考 token 上限 */
  budget_tokens?: number;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /**
   * 本次调用的思考开关（可选）。
   * 传了则**覆盖**客户端按模型名推断的默认值；不传 = 沿用各客户端原有行为
   * （因此对既有调用方零影响）。不支持该参数的客户端实现会忽略它。
   */
  thinking?: ThinkingOption;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  available: boolean;
}

/**
 * 解析模型输出的 JSON 文本工具调用（模型偶发把 function calling 写成
 * 文本 JSON：`{"name":"web-search","arguments":{"query":"..."}}`）。
 * 返回 null 表示内容不是可解析的工具调用 JSON。
 */
export function parseJsonToolCall(content: string): ToolCall[] | null {
  const trimmed = (content || '').trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const calls: ToolCall[] = [];
    for (const item of arr) {
      if (!item || typeof item.name !== 'string' || !item.name) continue;
      let argsStr = '{}';
      if (typeof item.arguments === 'string') argsStr = item.arguments;
      else if (item.arguments && typeof item.arguments === 'object') {
        argsStr = JSON.stringify(item.arguments);
      }
      calls.push({
        id: `call_${calls.length + 1}`,
        name: item.name,
        arguments: argsStr,
      });
    }
    return calls.length ? calls : null;
  } catch {
    return null;
  }
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
