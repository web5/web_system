/**
 * jest moduleNameMapper 的空实现替身。
 *
 * 用途：把 spec 目标模块（如 router/index.ts）顶层的副作用依赖短路掉 ——
 * pinia store、.vue 组件、@web-system/* 包都会拉起完整运行时（需要构建产物与
 * 浏览器 API），而待测的两个纯函数一个都不需要。
 *
 * 注意：只在纯逻辑用例里用。若要测组件行为，应改用 @vue/test-utils + jsdom，
 * 而不是往这里塞更多东西。
 */
export default {};
export const useUserStore = () => ({});
export const installChunkLoadErrorGuard = () => undefined;
export const isChunkLoadError = () => false;
export const showModuleLoadError = () => undefined;
