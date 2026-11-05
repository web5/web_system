// 构建脚本共享的 CDN 布局工具（Phase 2 · PR-B）。
//
// 为什么单独抽一个模块：CDN 布局的「开关判定 + 根路径 + 公共目录顺序」在
// vite-micro-frontend / build-externals / build-subset-externals / build-public-assets
// 多处都要用。散开各自手写 `process.env.ASSET_URL_MODE` 判定，会出现
// 「A 用 ASSET_URL_MODE、B 用 CDN_LAYOUT_MODE」的漂移。
// 收口到本模块，与 deploy-console `release-paths.ts`、gateway `static/asset-url.ts` 同口径。

/** 入口机 CDN 根（磁盘绝对路径，可用 CDN_ROOT 覆盖；与 release-paths.ts 的 CDN_ROOT 同值） */
export const CDN_ROOT_DEFAULT = '/data/cdn';

/**
 * 资源 URL 模式：`cdn` / `legacy`。
 * 与 gateway `static/asset-url.ts` 的 `assetConfigFrom` 同口径：非 `cdn` 一律 legacy。
 *
 * 为什么这里不做非法值 fail-fast：构建期拼错开关的代价是「多一次 legacy 构建」，
 * 重跑即可；gateway 运行期拼错则是「整站白屏」，必须 fail-fast。这里只区分 cdn / 非 cdn。
 */
export function cdnMode() {
  return String(process.env.ASSET_URL_MODE ?? '').trim().toLowerCase() === 'cdn' ? 'cdn' : 'legacy';
}

/** CDN 根（去尾斜杠）；未配回落 `/data/cdn` */
export function cdnRoot() {
  const raw = String(process.env.CDN_ROOT ?? '').trim();
  return (raw || CDN_ROOT_DEFAULT).replace(/\/+$/, '');
}

/** 公共依赖 / 资源磁盘目录：`<root>/common/<libs|pub>` */
export function cdnCommonDir(group) {
  assertGroup(group);
  return `${cdnRoot()}/common/${group}`;
}

/** 公共资源 URL 前缀（结尾带斜杠）：`/cdn/common/<libs|pub>/`（相对站点绝对路径，与 gateway 同源） */
export function cdnCommonUrlPrefix(group) {
  assertGroup(group);
  return `/cdn/common/${group}/`;
}

function assertGroup(group) {
  if (group !== 'libs' && group !== 'pub') {
    throw new Error(`[cdn-layout] 未知公共分组 ${JSON.stringify(group)}（只接受 libs / pub）`);
  }
}
