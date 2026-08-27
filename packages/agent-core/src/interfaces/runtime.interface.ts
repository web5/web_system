/**
 * Agent 运行时接口（RunInput / StreamEvent）。
 */

export type StreamEventType =
  | 'token'
  | 'content_delta'
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
}

export interface RunInput {
  agentId: string;
  userInput: string;
  conversationId?: string;
}
