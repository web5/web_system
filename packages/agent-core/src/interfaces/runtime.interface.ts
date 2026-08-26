/**
 * Agent 运行时接口（RunInput / StreamEvent）。
 */

export type StreamEventType =
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'summary'
  | 'final'
  | 'error';

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  name?: string;
  args?: unknown;
  step?: number;
  conversationId?: string;
  /** 本轮对话累计的 token 消耗（final/error 事件携带，来自大模型返回的 usage） */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface RunInput {
  agentId: string;
  userInput: string;
  conversationId?: string;
}
