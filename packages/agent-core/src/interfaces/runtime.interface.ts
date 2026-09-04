/**
 * Agent 运行时接口（RunInput / StreamEvent）。
 */

export type StreamEventType =
  | 'token'
  | 'content_delta'
  | 'tool_call'
  | 'tool_result'
  | 'skill_load'
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
  /**
   * 临时覆盖 Agent 定义中的模型（调试/对比用）。
   * 不传则用 Agent 定义里的 model；传入时仅本次运行生效，不修改 Agent 定义。
   */
  model?: string;
}
