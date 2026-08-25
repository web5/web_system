/**
 * 请求超时常量（从 @web-system/shared 内联剥离，供 agent-core 独立发布使用）。
 * 约定：请求实际超时以三层（前端/Gateway/后端）中最短的一层为准。
 */

export const API_TIMEOUT = {
  /** 默认上游请求超时（毫秒） */
  DEFAULT: 10_000,
  /** AI 任务超时（毫秒）——模型冷启动 + 队列等待常见 10-30s */
  AI_TASK: 180_000,
  /** AI 查询超时（毫秒）——轮询生图/异步任务用 */
  AI_QUERY: 30_000,
  /** 上游 CHAT 调用超时（毫秒） */
  UPSTREAM: {
    CHAT: 30_000,
  },
} as const;
