/**
 * 前端资源 URL 的**唯一出口**（2026-11-04 Phase 1）。
 *
 * 背景：静态资源 URL 曾在 8+ 处以字面量 `/static/modules/...` 散落在 gateway、
 * shell 模板、构建脚本与前端 bundle 里。要让「本机 /cdn/ 目录 → 未来真实 CDN」
 * 只改一个配置，必须先把 URL 收口到这里。
 *
 * ## 用户拍板的两条规范
 *
 * 1. `ASSET_ORIGIN` 是**带域名的完整 URL base**（不是相对路径），例如
 *    - 现在同源起步：`https://kedouai.com/cdn/` / `https://dev.kedouai.com/cdn/`
 *    - 未来真 CDN：`https://cdn.kedouai.com/cdn/`（或去掉 /cdn/ 段）
 *    - 因此所有资源相对路径都不再自带 `cdn/` 前缀，由 base 统一提供。
 *    - ❌ 拒绝 `/cdn/` 这类相对值：那正是「换 CDN 要重建全部历史产物」的根源。
 * 2. `ASSET_URL_MODE=cdn` 时**去指针化**：manifest 直接给 `<commit>` 一跳 URL，
 *    不再生成 `/static/modules/<app>/<env>/index.js` 磁盘指针入口。
 *
 * ## 兼容契约（Phase 1 可零风险上线的关键）
 *
 * 未配置 `ASSET_ORIGIN` 且 `ASSET_URL_MODE` 非 cdn（= 线上现状）时，
 * 本模块输出的所有 URL 与改造前**逐字节一致**（相对站点绝对路径）。
 * 现有 gateway 全量单测即为此契约的回归网。
 *
 * ⚠️ 与 `PUBLIC_ROOT` 同样的坑：配置项必须由**进程 env** 注入
 * （`ecosystem.config.js` 的 gateway env 块）。写进 `servers/gateway/.env`
 * 对 import 期代码无效（@nestjs/config 加载得太晚），故这里统一走
 * ConfigService 运行时读取，不缓存模块级常量。
 */
import { join as joinPosix } from 'path/posix';

export type AssetUrlMode = 'legacy' | 'cdn';

export interface AssetConfig {
  /** 规范化后的完整 URL base（含结尾 `/`）；空串 = 保持相对路径兼容模式 */
  origin: string;
  mode: AssetUrlMode;
  /** cdn 模式下允许注入 css 的应用白名单；null = 全部允许 */
  cssApps: Set<string> | null;
}

export interface AssetEnvLike {
  ASSET_ORIGIN?: string | null;
  ASSET_URL_MODE?: string | null;
  ASSET_CSS_APPS?: string | null;
}

/** 相对路径合法字符：禁止协议相对、上级目录、query/hash、反斜杠 */
const SAFE_REL_RE = /^[A-Za-z0-9._\-/]+$/;

/**
 * 规范化 `ASSET_ORIGIN`：必须是 https（或 localhost 的 http）开头的完整 URL base。
 * 空值返回空串（兼容模式）；非法值直接抛错，避免带着半吊子配置上线。
 */
export function normalizeAssetOrigin(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `[gateway] ASSET_ORIGIN 必须是带域名的完整 URL（例：https://kedouai.com/cdn/），` +
        `当前收到 ${JSON.stringify(value)}。相对路径（如 /cdn/）会把域名写死进产物，` +
        `未来迁真 CDN 需要重建全部历史版本，已禁止。`,
    );
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) {
    throw new Error(`[gateway] ASSET_ORIGIN 必须使用 https（非本机不允许 http）：${value}`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error(`[gateway] ASSET_ORIGIN 不允许带 query / hash / 用户信息：${value}`);
  }
  if (url.port && url.protocol === 'https:' && url.port !== '443') {
    // 允许自定义端口（dev / 内网回源），保留在最终 origin 中，不做静默吞掉
  }
  const clean = url.pathname.replace(/\/{2,}/g, '/');
  const pathname = clean.endsWith('/') ? clean : `${clean}/`;
  return `${url.origin}${pathname}`;
}

/** 从环境变量（或 ConfigService 取值结果）组装配置，非法值 fail-fast */
export function assetConfigFrom(env: AssetEnvLike = process.env): AssetConfig {
  const mode: AssetUrlMode = String(env.ASSET_URL_MODE ?? '').trim().toLowerCase() === 'cdn' ? 'cdn' : 'legacy';
  const origin = normalizeAssetOrigin(env.ASSET_ORIGIN);
  if (mode === 'cdn' && !origin) {
    throw new Error(
      '[gateway] ASSET_URL_MODE=cdn 必须同时配置带域名的 ASSET_ORIGIN（例：https://kedouai.com/cdn/）；' +
        '仅设 mode 会让资源指向不存在的 /cdn/ 相对路径。',
    );
  }
  const rawCss = String(env.ASSET_CSS_APPS ?? '').trim();
  const cssApps = rawCss
    ? new Set(rawCss.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  return { origin, mode, cssApps };
}

/** 取 origin 的 `scheme://host[:port]`（CSP 白名单一项） */
export function assetOriginHost(origin: string): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

/**
 * 相对路径 → 最终 URL。
 * - origin 空：返回站点绝对相对路径 `/<rel>`（与历史行为逐字节一致）
 * - origin 有值：返回完整 URL `<origin><rel>`（用户拍板的全 URL base 形态）
 */
export function assetUrl(rel: string, origin = ''): string {
  assertSafeRel(rel);
  if (!origin) return `/${rel}`;
  return `${origin}${rel}`;
}

/** 公共库 / 公共素材的 URL（cdn 模式专用；相对路径不含 cdn/ 前缀，由 base 提供） */
export function commonAssetUrl(kind: 'libs' | 'pub', file: string, origin: string): string {
  return assetUrl(joinPosix('common', kind, file), origin);
}

function assertSafeRel(rel: string): void {
  if (!rel || !SAFE_REL_RE.test(rel) || rel.startsWith('/') || rel.includes('..') || rel.includes('//')) {
    throw new Error(`[gateway] 非法的资源相对路径（拒绝注入与协议相对 URL）：${JSON.stringify(rel)}`);
  }
}

export interface ModuleRelOpts {
  app: string;
  env: string;
  /** 版本（短 commit）。cdn 模式必填 —— 去指针化后不存在无版本入口 */
  commit?: string;
  file?: string;
}

/**
 * 模块资源的相对路径。
 * - legacy：`static/modules/<app>/<env>[/<commit>]/<file>`
 * - cdn：`<env>/<app>/<commit>/<file>`（env 在 app 前，且**无指针层**）
 */
export function moduleAssetRel(mode: AssetUrlMode, opts: ModuleRelOpts): string {
  assertSegment(opts.app, 'app');
  assertSegment(opts.env, 'env');
  const file = opts.file || 'index.js';
  assertSafeRel(file);
  if (mode === 'cdn') {
    if (!opts.commit) {
      throw new Error('[gateway] cdn 模式已去指针化：moduleAssetRel 必须带 commit，不允许生成无版本入口');
    }
    assertSegment(opts.commit, 'commit');
    return joinPosix(opts.env, opts.app, opts.commit, file);
  }
  const parts = ['static', 'modules', opts.app, opts.env];
  if (opts.commit) {
    assertSegment(opts.commit, 'commit');
    parts.push(opts.commit);
  }
  return joinPosix(...parts, file);
}

/**
 * 模块 `assetsBase`（前端解析 `./assets/xxx.js` 分包的基准目录）。
 * cdn 模式指向 commit 目录（immutable），legacy 保持现状指针目录。
 */
export function moduleAssetsBaseRel(mode: AssetUrlMode, opts: ModuleRelOpts): string {
  const rel = moduleAssetRel(mode, { ...opts, file: 'index.js' });
  return rel.slice(0, rel.lastIndexOf('/') + 1);
}

function assertSegment(v: string, label: string): void {
  if (!v || !/^[A-Za-z0-9._-]+$/.test(v)) {
    throw new Error(`[gateway] 非法的 ${label} 段：${JSON.stringify(v)}`);
  }
}
