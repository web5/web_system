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

/** 公共静态资源的 URL 前缀（结尾带斜杠，与 Vite base 口径一致）。 */
export const PUBLIC_ASSET_BASE = '/static/cdn/pub/';

/**
 * 注入 `__PUBLIC_ASSET_BASE__` 编译期常量。
 * 用法与 appVersionDefine() 一致，在各 vite.config.ts 的 define 里展开即可。
 */
export function publicAssetDefine() {
  return {
    __PUBLIC_ASSET_BASE__: JSON.stringify(PUBLIC_ASSET_BASE),
  };
}
