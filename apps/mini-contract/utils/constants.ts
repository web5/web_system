/**
 * 小程序端本地常量
 *
 * 为什么不用 @web-system/shared？
 * 微信小程序原生模块系统不支持 monorepo workspace 包解析（require 时报
 * "module 'utils/@web-system/shared.js' is not defined"）。仅 API_TIMEOUT 一
 * 个常量被使用，直接在本地维护一份，避免引入整套共享包。
 *
 * 修改时需与 packages/shared/src/api.ts 保持同步（前端使用的 DEFAULT / AI_TASK / AI_QUERY）。
 */

/** 超时配置（毫秒）— 与 packages/shared/src/api.ts 的 API_TIMEOUT 前端字段对齐 */
export const API_TIMEOUT = {
  /** 默认通用请求（CRUD） */
  DEFAULT: 10_000,
  /** AI 异步任务（对话 / 生图 / 合同翻译官的 agent 分析） */
  AI_TASK: 180_000,
  /** AI 任务结果查询 / 轮询 */
  AI_QUERY: 30_000,
} as const;