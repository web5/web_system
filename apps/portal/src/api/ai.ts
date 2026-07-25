import request from './request';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ChatRequest {
  conversationId?: string;
  messages: ChatMessage[];
  userId?: string;
  model?: string;
}

/** 可用模型信息 */
export interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  available: boolean;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: string | null;
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

/** 获取可用模型列表 */
export function fetchModels(): Promise<ModelsResponse> {
  return request.get('/ai/models');
}

/** 发送消息并获取 AI 回复 */
export function sendChatMessage(data: ChatRequest): Promise<ChatResponse> {
  return request.post('/ai/chat', data);
}

/**
 * 流式对话 - 使用 fetch 读取 SSE 流
 * @param data 对话请求参数
 * @param onChunk 每收到一个文本块的回调
 * @param onDone 流结束的回调
 * @param onError 出错回调
 */
export function sendChatMessageStream(
  data: ChatRequest,
  onChunk: (text: string) => void,
  onDone: (conversationId?: string) => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();
  const token = localStorage.getItem('access_token');

  fetch('/api/ai/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') {
            onDone();
            return;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              if (json.done) {
                onDone(json.conversationId);
                return;
              }
              if (json.error) {
                onError(new Error(json.error));
                return;
              }
              if (json.content) {
                onChunk(json.content);
              }
            } catch {
              // 跳过解析失败的行
            }
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      onError(err);
    });

  return controller;
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
