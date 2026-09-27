/**
 * 编译期注入的全局常量（Vite define）。
 *
 * ⚠️ 这里的 key 必须与各 vite.config.ts 里注入的 define **一一对应**，
 *    少了声明会让 `vue-tsc` 报 TS2580（Cannot find name），portal 的 `npm run build`
 *    第一步就是 `vue-tsc && vite build`，会直接构建失败。
 */

/** 应用版本号（git short commit），见 scripts/vite-app-version.mjs */
declare const __APP_VERSION__: string;
/** 应用构建时间（ISO 字符串），见 scripts/vite-app-version.mjs */
declare const __APP_BUILD_TIME__: string;
/** 应用构建分支，见 scripts/vite-app-version.mjs */
declare const __APP_GIT_BRANCH__: string;
/** 公共静态资源前缀 `/static/cdn/pub/`，见 scripts/vite-public-assets.mjs */
declare const __PUBLIC_ASSET_BASE__: string;
