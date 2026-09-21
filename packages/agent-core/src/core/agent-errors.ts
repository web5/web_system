/**
 * 对话失败的错误码规范。
 *
 * 目的：把「技术报错」和「给用户看的提示」分开。
 * 服务端只负责**归类**（错误码），技术原文照旧进 run 落库供排查；
 * 用户提示由小程序按错误码查表（utils/agent-error.ts）给出 —— 两端共用同一套码表。
 *
 * 传输格式：error 事件的 content 形如 `[MODEL_ERROR] 模型调用失败: upstream timeout`。
 * 未带码的老格式由客户端 inferCodeByText() 兜底，保证前后端升级不同步时也能用。
 */

export const AGENT_ERROR_CODES = {
  /** 网络超时 / 断连 */
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  /** 登录态失效（401） */
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  /** 限流（429） */
  RATE_LIMITED: 'RATE_LIMITED',
  /** 模型调用失败（含超时、上游错误） */
  MODEL_ERROR: 'MODEL_ERROR',
  /** 模型返回了空结果 */
  MODEL_EMPTY: 'MODEL_EMPTY',
  /** 工具 / Agent 执行失败 */
  AGENT_ERROR: 'AGENT_ERROR',
  /** 服务不可用（5xx 等） */
  SERVER_ERROR: 'SERVER_ERROR',
  /** 兜底 */
  UNKNOWN: 'UNKNOWN',
} as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

/** 给错误文本加上错误码前缀 */
export function withCode(code: AgentErrorCode, message: string): string {
  return `[${code}] ${message}`;
}

/** 从异常文本推断错误码（用于 controller 的 catch 分支等拿不到 HTTP 状态的场景） */
export function classifyError(err: unknown): AgentErrorCode {
  const s = String((err as Error)?.message || err || '').toLowerCase();
  if (/401|未授权|unauthor|token|登录/.test(s)) return AGENT_ERROR_CODES.AUTH_EXPIRED;
  if (/429|限流|频繁|rate limit/.test(s)) return AGENT_ERROR_CODES.RATE_LIMITED;
  if (/timeout|超时|etimedout|econnreset/.test(s)) return AGENT_ERROR_CODES.NETWORK_TIMEOUT;
  if (/request:fail|网络|network|socket/.test(s)) return AGENT_ERROR_CODES.NETWORK_TIMEOUT;
  if (/5\d\d|服务|server|网关|gateway/.test(s)) return AGENT_ERROR_CODES.SERVER_ERROR;
  if (/模型未返回|empty/.test(s)) return AGENT_ERROR_CODES.MODEL_EMPTY;
  if (/模型|model|llm/.test(s)) return AGENT_ERROR_CODES.MODEL_ERROR;
  if (/工具|tool|skill|mcp/.test(s)) return AGENT_ERROR_CODES.AGENT_ERROR;
  return AGENT_ERROR_CODES.UNKNOWN;
}
