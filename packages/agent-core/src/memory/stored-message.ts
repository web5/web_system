/**
 * 存储消息结构（与 Agent run 消息对齐，含 tool 消息）。
 */

export type StoredMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface StoredMessage {
  role: StoredMessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
  /** 消息写入时间戳（ms）。历史旧数据可能无此字段，消费方需兼容降级。 */
  ts?: number;
}
