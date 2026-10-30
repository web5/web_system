/**
 * `@web-system/shared` 的测试替身（保留真实常量，短路运行时依赖）。
 *
 * 为什么单开一个文件而不是复用 empty-module：
 *   1. 真实的 @web-system/shared 需要 dist 构建产物，纯前端用例不该被它绑架；
 *   2. request.ts 在模块顶层读 `API_TIMEOUT.DEFAULT`，缺这个导出会在 import 阶段直接崩。
 * 只补被短路模块真正读到的字段，新增字段请按需追加，不要整包照抄。
 */
export const API_TIMEOUT = {
  DEFAULT: 30000,
  AI_TASK: 300000,
  AI_QUERY: 120000,
  UPLOAD: 300000,
  GATEWAY: { DEFAULT: 30000, UPSTREAM_LONG: 300000 },
  UPSTREAM: { DEFAULT: 30000, LONG: 300000 },
};

export default { API_TIMEOUT };
