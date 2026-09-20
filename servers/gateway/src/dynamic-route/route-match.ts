/**
 * DB 路由匹配（纯函数，可单测）—— 双域重构 P2 · 验收判据 V9/V10 的机器可执行部分
 *
 * 规则来源：`deploy_service_routes`（前缀级转发） + `deploy_service_envs`（环境指向）
 *          + `deploy_endpoints`（未登记接口策略 unknownPolicy）
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §4.3 / §4.4
 *
 * 三条不变量：
 * ① 优先级数值小者优先；同优先级取**更长的前缀**（更具体者优先）；
 * ② 环境级规则（envId 有值）与全环境默认（envId=null）都参与匹配，命中后优先返回具体规则；
 * ③ 未命中任何 DB 规则 → 返回 null，**由上游调用方回落到既有硬编码路由**（FR-10.2，双轨零破坏）。
 */

export interface RouteRule {
  serviceKey: string;
  /** null = 全环境默认 */
  envId: string | null;
  pathPrefix: string;
  stripPrefix: string | null;
  rewriteTo: string | null;
  upstreamOverride: string | null;
  timeoutMs: number;
  authMode: string;
  priority: number;
}

export interface EndpointRule {
  method: string;
  pathPattern: string;
}

/** 前缀匹配：`/api/todo` 命中 `/api/todo` 与 `/api/todo/1`，不命中 `/api/todos` */
export function prefixMatches(reqPath: string, prefix: string): boolean {
  if (reqPath === prefix) return true;
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return reqPath.startsWith(`${base}/`);
}

/** 路径模式匹配：支持 `:param` 占位符（如 `/api/todo/:id`） */
export function patternMatches(pattern: string, reqPath: string): boolean {
  const escaped = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) return '[^/]+';
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${escaped}$`).test(reqPath);
}

/** 未登记接口判定：方法（含 ALL 通配）+ 路径模式 */
export function endpointMatches(
  method: string,
  reqPath: string,
  endpoints: EndpointRule[],
): boolean {
  return endpoints.some(
    (e) =>
      (e.method === 'ALL' || e.method.toUpperCase() === method.toUpperCase()) &&
      patternMatches(e.pathPattern, reqPath),
  );
}

/**
 * 选取生效规则。
 * @param routes 全部启用规则（含全环境 + 各环境）
 * @param reqPath 请求路径（不含 query）
 * @param envId 当前请求所属环境（由 Host/请求头解析得到，找不到回退 dev）
 */
export function pickRoute(
  routes: RouteRule[],
  reqPath: string,
  envId: string,
): RouteRule | null {
  const candidates = routes.filter(
    (r) => (r.envId === null || r.envId === envId) && prefixMatches(reqPath, r.pathPrefix),
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    // 环境级规则优先于全环境默认（同优先级下更"具体"）
    const aSpecific = a.envId ? 0 : 1;
    const bSpecific = b.envId ? 0 : 1;
    return a.priority - b.priority || aSpecific - bSpecific || b.pathPrefix.length - a.pathPrefix.length;
  });
  return candidates[0];
}

/** 路径重写：先按 stripPrefix 正则剥离，再拼接 rewriteTo；无规则时原样返回 */
export function rewritePath(reqPath: string, rule: Pick<RouteRule, 'stripPrefix' | 'rewriteTo'>): string {
  let out = reqPath;
  if (rule.stripPrefix) {
    try {
      out = out.replace(new RegExp(rule.stripPrefix), '');
    } catch {
      // 非法正则 → 不剥离（不因配置错误放大为 500）
    }
  }
  if (rule.rewriteTo) out = `${rule.rewriteTo}${out}`;
  return out.startsWith('/') ? out : `/${out}`;
}

/**
 * 解析上游地址：显式覆盖 > 环境指向（upstreamUrl > 主机解析地址:端口）> null
 *
 * Q17 方案 D：`hostName` 是主机**组名**，地址由 `hostAddress`（`deploy_hosts.host`）给出；
 * 组名未登记（hostAddress 为空）→ 视为未配置，**不把组名当主机名拼**。
 * Q19：端口不继承服务默认值，缺端口即配置错误。
 * null = 未配置 → 调用方必须 fail-fast，**不得回落本机**（B4）。
 */
export function resolveUpstream(
  rule: Pick<RouteRule, 'upstreamOverride'>,
  binding: { upstreamUrl?: string | null; hostName?: string | null; port?: number | null } | null,
  hostAddressByName: ReadonlyMap<string, string>,
): string | null {
  if (rule.upstreamOverride) return rule.upstreamOverride;
  if (!binding) return null;
  if (binding.upstreamUrl) return binding.upstreamUrl;
  if (!binding.hostName) return null;
  const hostAddress = hostAddressByName.get(binding.hostName);
  if (!hostAddress) return null;
  // 缺端口 = 配置不完整：不静默回落 80 端口
  if (!binding.port) return null;
  return `http://${hostAddress}:${binding.port}`;
}

/** 环境解析：请求头 > Host 站点默认 > dev（回退，Q1） */
export function resolveEnvId(
  headerEnvId: string | undefined,
  host: string | undefined,
  sites: { host: string; defaultEnvId: string }[],
): string {
  const fromHeader = (headerEnvId || '').trim();
  if (fromHeader) return fromHeader;
  const cleanHost = (host || '').split(':')[0].trim().toLowerCase();
  const site = sites.find((s) => s.host.toLowerCase() === cleanHost);
  return site?.defaultEnvId || 'dev';
}
