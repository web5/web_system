/**
 * Agent 执行链路（PC 端 portal）
 *
 * 与小程序共用同一条链路：`POST /api/ai-agent/agent/run`（SSE）。
 * 差异只在传输层：小程序用 `wx.request({ enableChunked })`，PC 用 `fetch` + ReadableStream。
 * 事件协议与 `apps/kedou-ai-minigram/services/agent-stream.ts` 的 `StreamEvent` 对齐。
 *
 * 会话模型（page-spec §2 风险项）：**不按类型隔离**，统一一个会话流，
 * `agentId` 缺省由后端意图路由决定；主对话不传 source（默认 chat，出现在会话列表）。
 */
import { getStoredToken } from '@/stores/user';
import request, { tryRefreshToken } from '@/api/request';
import router from '@/router';

const AGENT_RUN_URL = '/api/ai-agent/agent/run';
const CONVERSATIONS_URL = '/ai-agent/agent/conversations';

/** 意图路由结果（服务端在本轮第一个事件推送） */
export interface AgentIntent {
  agentId: string;
  agentName?: string;
  confidence: number;
  via: 'explicit' | 'locked' | 'rule' | 'llm' | 'fallback';
  switched?: boolean;
  previousAgentId?: string;
}

/**
 * 结构化卡片载荷（一期：音乐推荐卡 kind=music）。
 * 与小程序 `services/agent-stream.ts` 的 card 载荷、后端 `present-music-card` 工具输出对齐。
 */
export interface MusicCardPayload {
  kind: string;
  provider?: {
    code: string;
    name: string;
    appId?: string | null;
    entryType: string;
    path?: string | null;
    ready: boolean;
  };
  songs?: Array<{ title: string; artist?: string; reason?: string }>;
  keyword?: string;
}

/** SSE 事件（类型集合与 agent-core StreamEvent 对齐，新增类型向前兼容） */
export interface AgentStreamEvent {
  type:
    | 'start'
    | 'content_delta'
    | 'reasoning_delta'
    | 'tool_call'
    | 'tool_result'
    | 'summary'
    | 'final'
    | 'error'
    | 'intent'
    | 'card'
    | 'permission_request'
    | string;
  content?: string;
  name?: string;
  conversationId?: string;
  intent?: AgentIntent;
  card?: MusicCardPayload;
  requestId?: string;
}

export interface AgentStreamHandlers {
  /** 意图路由结果（早于任何 token，用于渲染 agent 徽标） */
  onIntent?(intent: AgentIntent): void;
  /** 逐字增量 */
  onDelta?(delta: string): void;
  /** 推理增量（思考中可视化） */
  onReasoning?(delta: string): void;
  /** 任意事件透传（tool_call / tool_result …） */
  onEvent?(event: AgentStreamEvent): void;
  /** 正常结束 */
  onDone?(conversationId?: string): void;
  /** 失败（网络 / HTTP / 服务端 error 事件） */
  onError?(err: Error): void;
}

export interface AgentRunParams {
  userInput: string;
  /** 缺省 / 'auto' = 后端意图路由；工具页（翻译、合翻）显式指定 */
  agentId?: string;
  conversationId?: string;
  source?: 'chat' | 'tool';
}

/* ==================== 会话（统一会话流） ==================== */

export interface ConversationSummary {
  id: string;
  title: string | null;
  meta?: { scene?: string; danger: number; warn: number; ok: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  type?: 'text' | 'report';
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  report: unknown;
  meta?: { scene?: string; danger: number; warn: number; ok: number } | null;
  messages: StoredChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResult {
  list: ConversationSummary[];
  total: number;
}

/** 会话列表（分页，updatedAt 倒序）。只声明 page/pageSize：后端 DTO 开了 forbidNonWhitelisted */
export async function listConversations(page = 1, pageSize = 50): Promise<ConversationListResult> {
  const res = await request.get(`${CONVERSATIONS_URL}?page=${page}&pageSize=${pageSize}`);
  const body = (res ?? {}) as Partial<ConversationListResult>;
  return { list: body.list ?? [], total: body.total ?? 0 };
}

/** 会话详情（含消息序列；他人会话后端统一 404） */
export async function getConversation(id: string): Promise<ConversationDetail> {
  return (await request.get(`${CONVERSATIONS_URL}/${id}`)) as ConversationDetail;
}

/** 删除会话（不可恢复；调用方须先二次确认，他人 / 不存在后端统一 404） */
export async function deleteConversation(id: string): Promise<void> {
  await request.delete(`${CONVERSATIONS_URL}/${id}`);
}

/* ==================== SSE ==================== */

/**
 * 发起一次 agent 流式调用。
 *
 * 401 处理与 axios 拦截器保持一致：refreshToken 成功后换新 token 重试一次，失败跳登录。
 * @returns AbortController —— 供「停止生成」中断流
 */
export function runAgentStream(params: AgentRunParams, handlers: AgentStreamHandlers): AbortController {
  const controller = new AbortController();

  const start = async (retry = false): Promise<void> => {
    const token = getStoredToken();
    if (!token) {
      handlers.onError?.(new Error('请先登录'));
      return;
    }

    let response: Response;
    try {
      response = await fetch(AGENT_RUN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      handlers.onError?.(err as Error);
      return;
    }

    if (response.status === 401 && !retry) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        await start(true);
        return;
      }
      const currentPath = router.currentRoute.value.fullPath;
      router.push(`/login?redirect=${encodeURIComponent(currentPath)}`);
      handlers.onError?.(new Error('登录已过期，请重新登录'));
      return;
    }

    if (!response.ok || !response.body) {
      handlers.onError?.(new Error(`请求失败 (${response.status})`));
      return;
    }

    await consumeStream(response.body, handlers);
  };

  start().catch((err: Error) => {
    if (err?.name === 'AbortError') return;
    handlers.onError?.(err);
  });

  return controller;
}

/**
 * 读取 SSE 流：跨 chunk 用 `TextDecoder({ stream: true })` 保真中文，
 * 逐行解析 `data: {...}`，final / error 终止。
 */
async function consumeStream(body: ReadableStream<Uint8Array>, handlers: AgentStreamHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let conversationId: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let event: AgentStreamEvent;
      try {
        event = JSON.parse(payload) as AgentStreamEvent;
      } catch {
        continue; // 非 JSON 行（心跳等）忽略
      }

      handlers.onEvent?.(event);
      if (event.type === 'intent' && event.intent) handlers.onIntent?.(event.intent);
      if (event.type === 'content_delta' && event.content) handlers.onDelta?.(event.content);
      if (event.type === 'reasoning_delta' && event.content) handlers.onReasoning?.(event.content);
      if (event.conversationId) conversationId = event.conversationId;

      if (event.type === 'final') {
        handlers.onDone?.(event.conversationId || conversationId);
        return;
      }
      if (event.type === 'error') {
        handlers.onError?.(new Error(event.content || '生成失败，请重试'));
        return;
      }
    }
  }

  // 流正常读完但没收到 final：按成功收尾（已渲染的内容保留）
  handlers.onDone?.(conversationId);
}
