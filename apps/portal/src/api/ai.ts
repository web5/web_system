import request from './request';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  messages?: ChatMessage[];
  userId?: string;
}

export interface ChatResponse {
  code: number;
  message?: string;
  data: {
    conversationId: string;
    reply: string;
    timestamp: string;
  };
}

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export interface ConversationListResponse {
  code: number;
  data: {
    list: ConversationSummary[];
    total: number;
  };
}

export interface ConversationDetail {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetailResponse {
  code: number;
  data: ConversationDetail;
}

/** 发送消息并获取 AI 回复 */
export function sendChatMessage(data: ChatRequest): Promise<ChatResponse> {
  return request.post('/ai/chat', data);
}

/** 获取对话列表 */
export function getConversations(): Promise<ConversationListResponse> {
  return request.get('/ai/conversations');
}

/** 获取对话详情 */
export function getConversation(id: string): Promise<ConversationDetailResponse> {
  return request.get(`/ai/conversations/${id}`);
}

/** 删除单个对话 */
export function deleteConversation(id: string): Promise<{ code: number; message: string }> {
  return request.delete(`/ai/conversations/${id}`);
}

/** 清空所有对话 */
export function clearConversations(): Promise<{ code: number; message: string }> {
  return request.delete('/ai/conversations');
}

// ====== 图片生成 ======

export interface ImageSubmitResponse {
  code: number;
  message: string;
  data: {
    id: string;
    created: number;
  };
}

export interface ImageQueryResult {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  results?: Array<{
    url: string;
    revised_prompt?: string;
  }>;
  done: boolean;
}

export interface ImageQueryResponse {
  code: number;
  data: ImageQueryResult;
}

/** 提交图片生成任务 */
export function submitImage(prompt: string): Promise<ImageSubmitResponse> {
  return request.post('/ai/image/submit', { prompt });
}

/** 查询图片生成结果 */
export function queryImage(id: string): Promise<ImageQueryResponse> {
  return request.post('/ai/image/query', { id });
}
