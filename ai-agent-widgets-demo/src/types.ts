// 跨模块共享的领域类型（与 Vue 组件解耦，便于基座/子应用共用）

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting'
  | 'done'
  | 'error';

export interface ToolCall {
  name: string;
  args: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 是否仍在流式接收（影响未闭合块的渲染策略） */
  streaming: boolean;
  status: AgentStatus;
  tools: ToolCall[];
}
