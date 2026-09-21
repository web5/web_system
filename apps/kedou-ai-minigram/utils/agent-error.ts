/**
 * 对话错误规范。
 *
 * 目的：**技术细节不再直接透传给用户**。后端把失败归到固定的错误码，前端按码查表给用户
 * 一句能看懂、且知道该怎么做的提示；技术原文只进 run 落库供排查。
 *
 * 约定格式：后端 error 事件的 content 形如 `[MODEL_ERROR] 模型调用失败: upstream timeout`。
 * 若后端尚未升级（老格式），走 inferCodeByText() 按关键词兜底推断 —— 保证向前兼容。
 */

export type AgentErrorCode =
  | 'NETWORK_TIMEOUT'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'MODEL_ERROR'
  | 'MODEL_EMPTY'
  | 'AGENT_ERROR'
  | 'SERVER_ERROR'
  | 'STREAM_INTERRUPTED'
  | 'UNKNOWN';

/** 错误码 → 用户提示（给用户看的，不含技术细节） */
export const ERROR_TIPS: Record<AgentErrorCode, string> = {
  NETWORK_TIMEOUT: '网络不太顺畅，请检查网络后重试',
  AUTH_EXPIRED: '登录已过期，正在重新登录…',
  RATE_LIMITED: '提问有点频繁，稍等几秒再试',
  MODEL_ERROR: 'AI 开小差了，请再试一次',
  MODEL_EMPTY: '没能得到回答，请再试一次',
  AGENT_ERROR: '处理时出了点问题，请重试',
  SERVER_ERROR: '服务暂时不可用，请稍后再试',
  STREAM_INTERRUPTED: '回复中断了，已保留上面这部分',
  UNKNOWN: '出了点问题，请重试',
};

export interface AgentErrorInfo {
  code: AgentErrorCode;
  /** 给用户看的提示 */
  tip: string;
  /** 原文（排查用，不展示给用户） */
  raw: string;
}

/** 老格式兜底：从技术报错文本里推断错误码（后端升级为结构化后可去掉） */
function inferCodeByText(raw: string): AgentErrorCode {
  const s = (raw || '').toLowerCase();
  if (/401|未授权|unauthor|token|登录/.test(s)) return 'AUTH_EXPIRED';
  if (/429|限流|频繁|rate/.test(s)) return 'RATE_LIMITED';
  if (/timeout|超时|time ?out/.test(s)) return 'NETWORK_TIMEOUT';
  if (/request:fail|网络|network|fail/.test(s)) return 'NETWORK_TIMEOUT';
  if (/5\d\d|服务|server/.test(s)) return 'SERVER_ERROR';
  if (/模型未返回|empty/.test(s)) return 'MODEL_EMPTY';
  if (/模型调用失败|模型|model/.test(s)) return 'MODEL_ERROR';
  if (/工具执行失败|工具|tool|agent/.test(s)) return 'AGENT_ERROR';
  return 'UNKNOWN';
}

/** 解析失败信息：优先认结构化 `[CODE]`，否则按文本推断 */
export function parseAgentError(raw: string): AgentErrorInfo {
  const text = raw || '';
  const m = /^\[([A-Z_]+)\]\s*/.exec(text);
  if (m && m[1] in ERROR_TIPS) {
    const code = m[1] as AgentErrorCode;
    return { code, tip: ERROR_TIPS[code], raw: text.slice(m[0].length) };
  }
  const code = inferCodeByText(text);
  return { code, tip: ERROR_TIPS[code], raw: text };
}

/** 是否值得自动重试（技术上可恢复的） */
export function isRetryable(code: AgentErrorCode): boolean {
  return code !== 'AUTH_EXPIRED' || true; // 401 会先自动登录再重试，故都算可重试
}
