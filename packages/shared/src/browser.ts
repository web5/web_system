/**
 * `@web-system/shared` 的**浏览器安全入口** —— 前端（shell / admin / portal 及
 * 任何微前端模块）只允许从这里取用本包的能力。
 *
 * ## 为什么需要这个文件（2026-11-06 微前端白屏 P0 事故）
 *
 * 前端只要 `import { API_TIMEOUT } from '@web-system/shared'`，就会被 vite 别名指到
 * **后端 barrel** `src/index.ts`；barrel 里的
 * `export { DEFAULT_STORAGE_BASE } from './storage-dir'` 会让 `storage-dir.ts`
 * 进入前端模块图，而它的**顶层**就执行 `nodePath.join(os.homedir(), 'web_system')`。
 *
 * 浏览器里 `fs`/`os`/`path` 被 Vite 换成空的 `__viteBrowserExternal` 对象，
 * 于是这份副作用在模块 `execute` 阶段直接抛 `TypeError: (void 0) is not a function`
 * —— admin / portal **两个模块同时**启动即崩，整站白屏。
 *
 * 关键教训：**构建能过、产物看着正常、运行时 init 期才炸**。constructor 报告里的
 * 崩溃点反编译出来就是：
 * ```
 * DEFAULT_STORAGE_BASE = (void 0)((void 0)(), "web_system");
 * ```
 *
 * ## 本文件的硬约束（机器校验，别绕）
 *
 * 1. 只能 import **浏览器可跑**的相对模块；当前允许集：
 *    `./api` `./utils` `./micro-frontend` `./user-systems` `./contract`。
 * 2. 不得（直接或间接）出现 node 内置模块（fs/os/path/child_process/…）、
 *    不得出现 `process.env`、不得出现 typeorm / @nestjs/* 等服务端框架。
 * 3. 校验有两个口子，都在 `scripts/check-shared-browser-safety.mjs`：
 *    - **静态**：走本文件的模块图，命中即红（`pnpm check:shared-browser`，
 *      以及每次 `node scripts/build-module.mjs <key>` 构建前）；
 *    - **产物**：扫描模块产物里是否含 `__viteBrowserExternal` / node 内置 shim
 *      （每次模块构建后自动跑）。
 *
 * 因此：**往本文件加 node-only 再导出会当场变红**；反过来，前端误引
 * `DEFAULT_UPLOAD_DIR` 这类 node-only 符号会在 rollup 阶段报
 * `"…" is not exported by browser.ts`，而不是等到用户白屏。
 *
 * ## 接入方式
 *
 * `scripts/vite-micro-frontend.mjs`（admin/portal 的 mode=mf）与
 * `apps/{admin,portal,shell}/vite.config.ts`（standalone/dev）都把
 * `@web-system/shared` 别名指向本文件。新增前端应用时**必须**照此配置，
 * 否则又会指回后端 barrel。
 */

// 前后端统一的超时口径（前端唯一需要从本包取的常量）
export { API_TIMEOUT } from './api';

// 纯工具函数（dayjs 是唯一依赖，且已是微前端 external）
export { formatDateTime, randomString, sleep, debounce, throttle } from './utils';

// IAM 一期：系统维度（纯函数，前端做归属判定 / 文案映射要用）
export {
  SYSTEMS,
  SYSTEM_LABELS,
  DEFAULT_APP_SYSTEM,
  OPERATION_ROLES,
  resolveUserSystems,
  normalizeSystems,
  normalizeAppSystem,
  hasSystem,
  isAppSystem,
} from './user-systems';
export type { AppSystem, SystemResolvableUser } from './user-systems';

// 合同翻译官：IRR / 法定标准库（纯计算 + 类型，明确设计为前后端共用）
export * from './contract';

// 微前端平台契约（全是类型，编译期擦除；loader / 各模块共同引用）
export type {
  ModuleContext,
  UserInfo,
  ModuleManifestEntry,
  ModulesManifest,
  ModuleLifecycle,
  ModuleInstance,
  ModuleManifest,
} from './micro-frontend';
