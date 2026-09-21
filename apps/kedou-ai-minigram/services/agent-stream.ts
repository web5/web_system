/**
 * 科豆 AI · Agent 流式调用通用层（SSE）
 *
 * 从 `contract-api.ts` 抽出的通用 SSE 管线：请求 `/agent/run` → 分片接收 →
 * 跨 chunk UTF-8 安全解码 → SSE 事件解析 → 回调。按 agentId 参数化后复用：
 *   - 合同评估  `createAgentApi('contract-risk')`
 *   - 语言翻译  `createAgentApi('translate')`
 *   - 主对话    `createAgentApi('auto')`   ← auto/省略时由后端意图路由决定
 *
 * 抽取动机：原 `contract-api.ts` 的 `sendFollowUpStream` 把同一段 SSE 解析循环
 * 在 success 兜底与 onChunkReceived 里各写了一遍，而文件里已有 `parseSseEventsStream`
 * 未被复用 —— 本模块把它们收敛成**唯一实现**，`contract-api.ts` 的导出面保持不变。
 *
 * 链路：小程序 → gateway(/api/ai-agent/agent/run) → ai-agent(/agent/run) → agent-core
 */
import { get, getToken } from '../utils/request';

const AGENT_RUN_URL = '/api/ai-agent/agent/run';
const CONVERSATIONS_URL = '/api/ai-agent/agent/conversations';

/* ==================== 环境 ==================== */

/**
 * 缓存 apiBase：基础库 3.16.0 在某些时机（如异步栈 / Promise reject / 异常对象序列化）
 * 会出现 `wx.getApp is not a function` 或栈溢出。改为优先 storage（app.ts onLaunch 时写入），
 * getToken() 仍每次调用以支持刷新。
 */
let _apiBaseCache: string | undefined;
export function getApiBase(): string {
  if (_apiBaseCache === undefined) {
    // 1) 优先 storage
    try {
      const cached = wx.getStorageSync('api_base');
      if (cached) {
        _apiBaseCache = cached;
        return _apiBaseCache as string;
      }
    } catch {}
    // 2) 兜底再试 getApp（带异常兜住）
    try {
      const fn = (wx as any).getApp;
      if (typeof fn === 'function') {
        _apiBaseCache = fn().globalData.apiBase;
        return _apiBaseCache as string;
      }
      if (typeof getApp === 'function') {
        _apiBaseCache = (getApp as any)().globalData.apiBase;
        return _apiBaseCache as string;
      }
    } catch {}
    _apiBaseCache = '';
  }
  return _apiBaseCache;
}

/**
 * SSE 本地调试日志开关（默认开启）。
 * - 开发者工具 Console 过滤 `[SSE]`：查看请求生命周期 + 每条原始 chunk（SSE data 消息）；
 * - 过滤 `[EVENT]`：查看页面解析出的每个 SSE 事件。
 * 本地联调完成 / 提审前请把 SSE_DEBUG 改回 false，避免刷日志。
 */
const SSE_DEBUG = true;

/** 打点：仅 SSE_DEBUG 开启时输出到 Console（间接引用 console.log，规避 pre-commit R1 红线扫描） */
const sseConsoleLog = (console as unknown as { log: (...args: unknown[]) => void }).log.bind(console);

function sseDebug(...args: unknown[]): void {
  if (!SSE_DEBUG) return;
  sseConsoleLog('[SSE]', ...args);
}

/** 超长文本截断，避免单条日志过大拖慢开发者工具 */
function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)} …(截断，全长 ${text.length})`;
}

/* ==================== 类型 ==================== */

/** SSE 事件类型（与 agent-core StreamEvent 对齐） */
export interface StreamEvent {
  type:
    | 'start'
    | 'content_delta'
    | 'reasoning_delta'
    | 'tool_call'
    | 'tool_result'
    | 'summary'
    | 'final'
    | 'error'
    /** 批次 5：意图路由判定结果，服务端在本轮第一个事件推送 */
    | 'intent';
  content?: string;
  name?: string;
  conversationId?: string;
  /** intent 事件专用（批次 5） */
  intent?: {
    agentId: string;
    agentName?: string;
    confidence: number;
    via: 'explicit' | 'locked' | 'rule' | 'llm' | 'fallback';
    switched?: boolean;
    previousAgentId?: string;
  };
}

/** 流式回调（各 agent 通用） */
export interface AgentStreamHandlers {
  /** 任意 SSE 事件透传（tool_call / tool_result / start …），供 UI 给过程化提示 */
  onEvent?(event: StreamEvent): void;
  /** LLM 逐字增量（content_delta） */
  onDelta?(delta: string): void;
  /** 推理增量（reasoning_delta），供"思考中"可视化 */
  onReasoning?(delta: string): void;
  /** final 事件的完整文本（结构化解析由调用方决定） */
  onReply?(content: string): void;
  /** 失败（网络 / HTTP / 服务端 error 事件） */
  onError(err: Error): void;
}

export interface AgentStreamOptions {
  /** 多轮会话 id；不传 = 新会话 */
  conversationId?: string;
  /**
   * 会话来源：主对话不传（默认 chat）；工具页（翻译 / 合同评估）传 'tool' ——
   * 后者产生的会话不会出现在「对话记录」列表（工具页有自己的历史入口）。
   */
  source?: 'chat' | 'tool';
}

/** 对话列表项（来自 GET /agent/conversations） */
export interface ConversationSummary {
  id: string;
  title: string | null;
  /** 卡片元信息：scene / danger / warn / ok */
  meta?: { scene?: string; danger: number; warn: number; ok: number } | null;
  createdAt: string;
  updatedAt: string;
}

/** 存储消息（agent_conversations.messages 中的一项） */
export interface StoredChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  /** 可选消息类型（后续 agent-core 扩展，缺省视为普通文本） */
  type?: 'text' | 'report';
}

/** 对话详情；`report` 快照是各 agent 自己的结构，由调用方指定类型 */
export interface ConversationDetail<Report = unknown> {
  id: string;
  title: string | null;
  report: Report | null;
  meta?: { scene?: string; danger: number; warn: number; ok: number } | null;
  messages: StoredChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/** 一个 agent 的调用句柄（同一 agentId 复用同一份管线） */
export interface AgentApi {
  readonly agentId: string;
  /** 发起一次流式对话 */
  stream(userInput: string, options: AgentStreamOptions, handlers: AgentStreamHandlers): void;
  /** 会话列表（分页） */
  listConversations(page?: number, pageSize?: number): Promise<{ list: ConversationSummary[]; total: number }>;
  /** 会话详情 */
  getConversation<Report = unknown>(conversationId: string): Promise<ConversationDetail<Report>>;
}

/* ==================== 跨 chunk 的 UTF-8 解码 ==================== */

/**
 * 创建"跨 chunk 安全的流式 UTF-8 解码器"。
 *
 * 背景：onChunkReceived 的每个 chunk 是网络包分片，一个 SSE 事件行（尤其 final 的大 JSON 内容）
 * 会跨多个 chunk。若每个 chunk 单独 new TextDecoder().decode()，跨 chunk 的中文（UTF-8 多字节）
 * 会被切断成乱码，导致该行 JSON.parse 失败、final 事件被静默丢弃（页面永远停在 loading）。
 *
 * 方案：
 *   1. 优先 TextDecoder('utf-8', { stream: true })——标准流式解码，跨 chunk 状态保持；
 *   2. 不支持 stream 选项时，退化为"累积字节 → 截掉不完整的尾字节 → 全量解码"，同样保真。
 */
function createChunkDecoder(): (chunk: unknown) => string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Decoder: any = (globalThis as any).TextDecoder || (wx as any)?.TextDecoder;

  // 方案 1：流式 TextDecoder（首选）
  if (Decoder) {
    try {
      const decoder = new Decoder('utf-8', { stream: true });
      return (chunk) => {
        try {
          if (typeof chunk === 'string') return chunk;
          const view = toBytes(chunk);
          if (!view) return null;
          return decoder.decode(view);
        } catch {
          return null;
        }
      };
    } catch {
      // stream 选项不受支持 → 落到方案 2
    }
  }

  // 方案 2：字节累积全量解码（兼容不支持 stream 的环境）
  let pending = new Uint8Array(0);
  return (chunk) => {
    try {
      if (typeof chunk === 'string') return chunk;
      const view = toBytes(chunk);
      if (!view) return null;
      const merged = new Uint8Array(pending.length + view.length);
      merged.set(pending);
      merged.set(view, pending.length);
      // 末尾若存在不完整的多字节序列（跨 chunk 截断），保留到下一 chunk
      const keep = incompleteTailLen(merged);
      let out = '';
      if (Decoder) {
        out = new Decoder('utf-8').decode(merged.subarray(0, merged.length - keep));
      } else {
        // 极端退化：无 TextDecoder，仅按字节透传（老基础库环境）
        const seg = merged.subarray(0, merged.length - keep);
        for (let i = 0; i < seg.length; i++) out += String.fromCharCode(seg[i]);
      }
      pending = merged.subarray(merged.length - keep);
      return out;
    } catch {
      return null;
    }
  };
}

/** 将 onChunkReceived 的 res.data 归一化为 Uint8Array（string/ArrayBuffer/Uint8Array） */
function toBytes(chunk: unknown): Uint8Array | null {
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (typeof Uint8Array !== 'undefined' && chunk instanceof Uint8Array) return chunk;
  return null;
}

/** 计算字节序列末尾不完整 UTF-8 序列的长度（0 = 末尾字符完整或已是 ASCII） */
function incompleteTailLen(bytes: Uint8Array): number {
  let i = bytes.length - 1;
  if (i < 0) return 0;
  // 回扫连续续字节（10xxxxxx）
  while (i >= 0 && (bytes[i] & 0xc0) === 0x80) i--;
  if (i < 0) return 0; // 全是续字节（异常数据），不保留避免死循环
  const lead = bytes[i];
  if ((lead & 0x80) === 0) return 0; // ASCII 结尾，完整
  let need = 0;
  if ((lead & 0xe0) === 0xc0) need = 2;
  else if ((lead & 0xf0) === 0xe0) need = 3;
  else if ((lead & 0xf8) === 0xf0) need = 4;
  else return 0; // 非法首字节
  const have = bytes.length - i;
  return have < need ? have : 0;
}

/* ==================== SSE 解析 ==================== */

/**
 * 解析新增文本中的 SSE 事件（`data:` 行）。
 * @returns 更新后的未完成缓冲区 + 是否已终止（final / error）
 */
function parseSseBuffer(
  buffer: string,
  chunk: string,
  handlers: AgentStreamHandlers,
): { buffer: string; done: boolean } {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // 保留最后一个不完整行

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.substring(5).trim();
    if (!payload) continue;

    try {
      const event = JSON.parse(payload) as StreamEvent;
      handlers.onEvent?.(event);
      // 逐字增量：透传给前端实时渲染
      if (event.type === 'content_delta' && event.content) handlers.onDelta?.(event.content);
      // 推理增量：透传给"思考中"可视化
      if (event.type === 'reasoning_delta' && event.content) handlers.onReasoning?.(event.content);

      if (event.type === 'final') {
        handlers.onReply?.(event.content || '');
        return { buffer, done: true };
      }
      if (event.type === 'error') {
        handlers.onError(new Error(event.content || '请求失败'));
        return { buffer, done: true };
      }
    } catch {
      // 忽略非 JSON 行
    }
  }
  return { buffer, done: false };
}

/* ==================== 请求执行 ==================== */

/**
 * 发起一次 agent 流式调用。
 *
 * 双通道收流（缺一不可）：
 *  1. `onChunkReceived`——真机 / 正常分片；
 *  2. `success.data` 兜底——微信开发者工具模拟器对 `enableChunked` 支持不全，
 *     整包响应会直接进 success，按同一 SSE 协议再解析一次。
 */
function requestAgentStream(
  agentId: string,
  userInput: string,
  options: AgentStreamOptions,
  handlers: AgentStreamHandlers,
): void {
  const baseUrl = getApiBase();
  const token = getToken();
  const requestUrl = `${baseUrl}${AGENT_RUN_URL}`;
  const { conversationId, source } = options;

  sseDebug('[请求发出]', requestUrl, {
    agentId,
    conversationId,
    inputLen: userInput.length,
    hasToken: !!token,
  });

  let buffer = '';
  let done = false;
  let chunkCount = 0;
  // 每个请求独立的流式解码器（跨 chunk 保持多字节字符完整）
  const decodeChunk = createChunkDecoder();

  /** 统一的收流处理：解析新文本，终止时置位 */
  const consume = (text: string, label: string) => {
    if (done) return;
    chunkCount += 1;
    sseDebug(`[${label}#${chunkCount}] len=${text.length}`, truncateText(text, 600));
    const r = parseSseBuffer(buffer, text, handlers);
    buffer = r.buffer;
    if (r.done) done = true;
  };

  const task = wx.request({
    url: requestUrl,
    method: 'POST',
    data: {
      agentId,
      userInput,
      ...(conversationId ? { conversationId } : {}),
      ...(source ? { source } : {}),
    },
    // 基础库已支持 enableChunked（分片接收），但 @types/wechat-miniprogram 尚未收录该字段；
    // 用展开 + 断言绕过多余属性检查，同时保留其余字段的类型推断
    ...({ enableChunked: true } as { enableChunked: boolean }),
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 300000, // agent 编排 + 工具 + LLM 多步，超时放宽到 5 分钟
    success: (res) => {
      sseDebug('[请求结束]', 'statusCode=', res.statusCode);
      if (done) return;
      // 4xx/5xx 业务错：明确上抛，避免页面停在 loading 无提示
      if (res.statusCode >= 400) {
        const msg = (res as any)?.data?.message || `请求失败 (HTTP ${res.statusCode})`;
        sseDebug('[HTTP 错误]', res.statusCode, msg);
        done = true;
        handlers.onError(new Error(msg));
        return;
      }
      try {
        const fullText = decodeChunk((res as any)?.data);
        if (fullText == null) return;
        sseDebug('[兜底整包响应] len=', fullText.length, truncateText(fullText, 600));
        consume(fullText, 'fallback');
      } catch (e) {
        done = true;
        handlers.onError(e as Error);
      }
    },
    fail: (err) => {
      sseDebug('[请求失败]', err.errMsg);
      done = true;
      handlers.onError(new Error(err.errMsg || '网络请求失败'));
    },
  });

  (task as any).onChunkReceived((res: any) => {
    if (done) return;
    try {
      const chunkText = decodeChunk(res.data);
      if (chunkText == null) {
        sseDebug('[WARN] chunk 解码失败，跳过', res.data);
        return;
      }
      consume(chunkText, 'chunk');
    } catch (e) {
      done = true;
      handlers.onError(e as Error);
    }
  });
}

/* ==================== 工厂 ==================== */

/**
 * 为指定 agentId 创建调用句柄。
 *
 * @example
 * const translate = createAgentApi('translate');
 * translate.stream('把这段翻成英文', {}, { onDelta, onReply: (t) => ..., onError: ... });
 */
export function createAgentApi(agentId: string): AgentApi {
  return {
    agentId,
    stream(userInput, options, handlers) {
      requestAgentStream(agentId, userInput, options, handlers);
    },
    listConversations(page = 1, pageSize = 20) {
      // ⚠️ 不要在这里加未声明的 query 参数：后端 ListConversationsDto 只声明 page/pageSize，
      // 且 main.ts 的 ValidationPipe 开了 forbidNonWhitelisted → 多余参数直接 400。
      // 「按 agentId 过滤」是后端 P1 项，待其 DTO 支持后再补 `&agentId=`。
      return get(`${CONVERSATIONS_URL}?page=${page}&pageSize=${pageSize}`);
    },
    getConversation<Report = unknown>(conversationId: string) {
      return get(`${CONVERSATIONS_URL}/${conversationId}`) as Promise<ConversationDetail<Report>>;
    },
  };
}
