// 存储消息结构（与 Agent run 消息对齐，含 tool 消息）
// 骨架占位：实现待方案确认后填充

export type StoredMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface StoredMessage {
  role: StoredMessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
}
