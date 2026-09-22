/**
 * 兼容 shim：AI 回答 blocks 解析真源已迁至 `@web-system/agent-message`（三端复用）。
 * 保留此文件仅为避免大范围改 import——`AiChat.vue` / `Translate.vue` 仍从 `@/utils/answer-parse` 引用。
 * 新增解析能力请改 `packages/agent-message/src`，不要改这里。
 */
export * from '@web-system/agent-message';
