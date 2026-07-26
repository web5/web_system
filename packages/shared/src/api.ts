/**
 * 超时配置 — 前后端统一，按场景分层
 *
 * - 前端 portal/admin-web/mini-app 直接用 API_TIMEOUT.{DEFAULT,AI_TASK,AI_QUERY}
 * - Gateway proxy 层用 API_TIMEOUT.GATEWAY.*
 * - 后端 service 调第三方 API 用 API_TIMEOUT.UPSTREAM.*
 *
 * 修改超时值只需改这一个文件。
 */
export const API_TIMEOUT = {
  // ========== 前端通用 ==========

  /** 默认通用请求（CRUD） */
  DEFAULT: 10_000,

  /** AI 异步任务 — 对话、生图、变变等需等第三方模型响应的接口 */
  AI_TASK: 180_000,

  /** AI 任务结果查询 / 轮询 */
  AI_QUERY: 30_000,

  // ========== Gateway 代理层 ==========

  GATEWAY: {
    /** 默认 CRUD 路由代理 */
    DEFAULT: 30_000,
    /** AI / 变变等长链路路由代理 */
    AI_TASK: 180_000,
    /** TTS 语音合成代理 */
    TTS: 15_000,
  },

  // ========== 后端调第三方 API ==========

  UPSTREAM: {
    /** 默认（生图 submit / query 等常规调用） */
    DEFAULT: 30_000,
    /** AI 对话（非流式，等模型生成完整回复） */
    CHAT: 60_000,
    /** AI 流式对话（SSE，超时需要够长以免中断流） */
    CHAT_STREAM: 120_000,
    /** 内部微服务间调用（system-service / user-service） */
    INTERNAL: 3_000,
  },
} as const;
