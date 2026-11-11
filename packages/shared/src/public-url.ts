/**
 * 公网访问基座（把落库的相对路径拼成完整 URL）的**唯一实现**。
 *
 * ## 背景（头像刷新后不显示 · 台账 #8690）
 *
 * 头像从上传 → 落库 → verify 全链路都存相对路径（`/api/uploads/avatars/<name>`，
 * 无域名前缀）。DB、网关代理、完整 URL 本身都正常，断在**前端渲染**：小程序
 * `<image src>` 会把相对路径按包内资源解析导致加载失败。此前靠前端
 * `resolveAvatarUrl()` 拼 `api_base`，但用户实测刷新后仍不显示，静态分析查不出
 * 拼域名失败的根因。
 *
 * 收口方案（后端 A 方案）：各服务在**返回给前端前**用本模块把 avatar 拼成完整
 * URL，DB 仍落相对路径不变。前端 `resolveAvatarUrl()` 对 `https://` 开头原样返回，
 * 天然兼容，无需改前端。
 *
 * ## 配置口径
 *
 * 公网基座由统一环境变量 `PUBLIC_BASE_URL` 提供（dev=`https://dev.kedouai.com`、
 * prod=`https://kedouai.com`）。留空 = 保持相对路径（兼容模式，与历史行为逐字节一致）；
 * 非法值**静默回落为相对路径**，绝不让「半吊子配置」把头像接口打成 500。
 *
 * 为什么用环境变量而不是 `req.get('host')` 推断：gateway 的 proxy 用
 * `changeOrigin: true`，会把 Host 头重写成目标服务地址（`localhost:6008` 等），
 * 后端根本看不到公网域名；nginx 也不会默认带 `X-Forwarded-Host`。只有显式配置
 * 才是可靠的、跨环境一致的来源。
 */

/** 公网访问基座（完整 URL base，不含结尾斜杠）的环境变量名 */
export const PUBLIC_BASE_URL_ENV = 'PUBLIC_BASE_URL';

/**
 * 规范化 `PUBLIC_BASE_URL`：必须是 http(s) 的完整 URL，返回其 origin
 * （去掉路径 / query / hash / 用户信息 / 结尾斜杠）。
 *
 * - 空值 → 空串（= 不拼域名，保持相对路径）
 * - 非法值 → 空串（防御性回落，不抛错：错误配置导致头像 500 的代价比相对路径更大）
 */
export function normalizePublicBaseUrl(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.username || url.password) return '';
  // url.origin 天然剥离 path / query / hash；用户名密码已在上面拒绝（URL origin 会吞掉它们）
  return url.origin;
}

/**
 * 相对路径 → 公网绝对 URL（供头像等落库相对路径在返回前端前拼接）。
 *
 * - 空值 → 空串
 * - 已绝对（http/https 开头）→ 原样返回（幂等，兼容公众号头像等外部 URL）
 * - base 为空 → 原样返回（保持相对路径兼容）
 * - path 以 `/` 开头 → `<base><path>`
 * - 其它（相对且不带斜杠）→ 原样返回
 */
export function resolvePublicUrl(path: string | null | undefined, base: string): string {
  const p = (path || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;

  const b = (base || '').trim().replace(/\/+$/, '');
  if (!b) return p;
  if (p.startsWith('/')) return `${b}${p}`;
  return p;
}
