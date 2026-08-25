// Agent 运行时接口（RunInput / StreamEvent / RunResult）
// 骨架占位：实现待方案确认后填充

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
}

export interface RunInput {
  agentId: string;
  userInput: string;
  conversationId?: string;
}
