// 微前端「公共静态资源」的唯一常量与 Vite define 入口。
//
// 背景（2026-09-27）：模块内的 public 资源（logo / avatars / materials）原先有两种引用形式：
//   1) `${import.meta.env.BASE_URL}logo.svg` —— 跟随产物 base，
//      即 `/static/modules/<key>/<产品线>/<版本>/logo.svg`；
//   2) `/logo.svg` 硬编码根绝对路径 —— 依赖 gateway public 根目录下的一份「幽灵拷贝」。
// 形式 1 让产物目录里必须塞满静态资源（每个版本 4~5MB），且 typename/产品线段一旦不一致就静默 404；
// 形式 2 的资源要靠人工往 gateway public 根目录拷，没人维护、dev 与 prod 两份不同步。
//
// 统一方案：全部资源编译期拼一个**固定前缀** `/static/cdn/pub/`，
// 由 scripts/build-public-assets.mjs 从单一源目录 assets/shared-public/ 发布，
// 走与 vue/antd 那批 UMD 完全相同的 `deploy_cdn()` 投递通道（tar 整包覆盖 `public/static/cdn/`）。
// 于是：产物目录只剩 index.js / index.css / manifest.json，「双目录」包袱消失。
//
// ⚠️ 改这里的值必须同步改：
//   - scripts/build-public-assets.mjs 的 OUT_DIR（发布落盘位置）
//   - servers/gateway/src/static/static.module.ts 的缓存判定（CDN_DIR_RE 已按 /static/cdn/ 前缀命中）

import { cdnMode, cdnCommonUrlPrefix } from './lib/cdn-layout.mjs';

/** 公共静态资源的 URL 前缀（结尾带斜杠，与 Vite base 口径一致）。
 *  legacy fallback 值；`ASSET_URL_MODE=cdn` 时 publicAssetExpression() 改用 `/cdn/common/pub/`。 */
export const PUBLIC_ASSET_BASE = '/static/cdn/pub/';

/**
 * `__PUBLIC_ASSET_BASE__` 的**运行时表达式**（不带引号，可直接进源码）。
 *
 * **Phase 1（2026-11-04）改为运行时求值**：所有 `${__PUBLIC_ASSET_BASE__}logo.svg`
 * 最终变成 `${(window.__ASSET_BASE__ || '/static/cdn/pub/')}logo.svg`。
 * `window.__ASSET_BASE__` 由 gateway 在 shell HTML 的 <head> 注入
 * （cdn 模式 = `ASSET_ORIGIN + common/pub/` 完整 URL）。
 *
 * 为什么必须改：编译期常量会把「域名 + 路径」烧进每一个历史版本 bundle，
 * 换 CDN / 换路径就得重建**全部历史版本**（迁移不可行）。改成运行时后，
 * 老产物在旧路径下仍靠 fallback 正常工作，新产物随 env 切换，零重建。
 *
 * 兼容：未注入 `window.__ASSET_BASE__`（legacy 模式 / vite dev 直接起）
 * 时回落 `PUBLIC_ASSET_BASE`，与改造前逐字节一致。
 *
 * ⚠️ 用法变了：Phase 1 原先把这段表达式塞进 Vite `define`，esbuild 不接受表达式，
 * 构建必挂（详见 {@link publicAssetPlugin}）。现在只在插件内部使用，不要再放回 define。
 */
export function publicAssetExpression() {
  // cdn 模式下 fallback 对齐 CDN 布局 `/cdn/common/pub/`；legacy 保持 `/static/cdn/pub/`（逐字节不变）。
  const fallback = cdnMode() === 'cdn' ? cdnCommonUrlPrefix('pub') : PUBLIC_ASSET_BASE;
  return `(window.__ASSET_BASE__ || ${JSON.stringify(fallback)})`;
}

/** 被替换的标识符名（与 env.d.ts 的 declare 一致） */
const PLACEHOLDER = '__PUBLIC_ASSET_BASE__';

/**
 * 把 `__PUBLIC_ASSET_BASE__` 替换成运行时表达式。
 *
 * ⚠️ **为什么不能用 Vite `define`**（2026-11-06 修）：
 *   Phase 1（90615061）把 define 的值写成了 JS 表达式
 *   `(window.__ASSET_BASE__ || "/static/cdn/pub/")`。但 Vite 的 define 最终交给
 *   esbuild，esbuild 只接受「合法 JSON」或「单个标识符」，表达式直接报
 *   `Invalid define value (must be an entity name or valid JSON syntax)`，
 *   **admin / portal 的 `vite build` 从 11-04 起必挂**，而 CI 只在「改动包」上跑
 *   build，admin 一直没进改动包，所以直到 11-06 #8561 改了 admin 才暴露。
 *
 *   改走 `transform` 源码替换：esbuild 只管把它当普通表达式编译，运行时能力
 *   （window.__ASSET_BASE__ 优先、fallback 兜底）与 Phase 1 设计完全一致。
 *
 * 跳过 `.d.ts`：`env.d.ts` 里的 `declare const __PUBLIC_ASSET_BASE__` 是给
 * vue-tsc 的类型声明，替换后语法不成立。
 */
export function publicAssetPlugin() {
  const replacement = publicAssetExpression();
  const re = new RegExp(`\\b${PLACEHOLDER}\\b`, 'g');
  return {
    name: 'web-system:public-asset-base',
    // pre：必须早于 vite:esbuild / @vitejs/plugin-vue，拿到的是原始源码
    enforce: 'pre',
    transform(code, id) {
      if (!code.includes(PLACEHOLDER)) return null;
      if (id.endsWith('.d.ts') || id.includes('/node_modules/')) return null;
      return { code: code.replace(re, replacement), map: null };
    },
  };
}
