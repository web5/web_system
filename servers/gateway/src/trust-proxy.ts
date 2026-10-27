/**
 * 网关 trust proxy 配置（prod 限流分桶修复，2026-10-27）
 *
 * ── 为什么必须是「代理 IP 白名单」，而不是数字跳数 / trust=true ──────────────
 *   生产拓扑：公网 nginx(内网 172.16.16.15) → 网关(172.16.16.2:6000)，6000 公网不可达。
 *   express 的 req.ip 走 forwarded + proxy-addr：地址链是 [socket对端, XFF最右, …, XFF最左]，
 *   从 index 0（socket）起判定信任，命中第一个「不可信」就截断，返回截断后最后一个。
 *   nginx 用 $proxy_add_x_forwarded_for 追加 → XFF 最右 = 真实客户端 IP。
 *
 *   实测（真实 express 4.x + 真实 HTTP，矩阵见 src/main.trust-proxy.spec.ts）：
 *     白名单 ['172.16.16.15'] → 经 nginx 取到真实客户端 IP；客户端伪造任意层 XFF 均无效；
 *                               直连方不在白名单 → socket 地址即 req.ip，伪造 XFF 同样无效。
 *     数字跳数 1 / 2         → 经 nginx 能取到真实 IP，但 socket 无论来自谁都落在 index 0
 *                               且被信任 → 直连时客户端自带的 XFF 直接成为 req.ip
 *                               → 直连方可任意伪造 req.ip 绕过限流。
 *     trust = true          → 返回链上最左的值 = 客户端伪造值 → 限流可被绕过。
 *   ⇒ 只有「代理 IP 白名单」同时满足：取到真实客户端 IP + 伪造无效 + 直连也安全。
 *
 * ⚠️ 不要把 'loopback' 加进信任列表：那会把「本机任意进程」也提升为可信代理
 *    （本机进程的 socket 同样落在 index 0），自带 XFF 即可伪造 req.ip。
 */

/** prod 公网 nginx 的内网 IP —— 唯一允许的直接上游（可经 TRUST_PROXY 环境变量覆盖） */
export const DEFAULT_TRUST_PROXY = '172.16.16.15';

/**
 * 把 TRUST_PROXY 配置解析成 express 的「代理 IP 白名单」数组。
 *
 * 始终返回 string[]：绝不会返回数字（= 跳数信任）或布尔（= 全信）——
 * 那两种写法都可被客户端伪造 XFF 绕过限流（见文件头说明）。
 */
export function buildTrustProxyList(raw?: string | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 把白名单装到 express app 上（express 的 'trust proxy' 设置项）。
 * 返回实际生效的白名单，便于调用方打日志。
 */
export function applyTrustProxy(
  app: { set(key: string, value: unknown): unknown },
  raw?: string | null,
): string[] {
  const list = buildTrustProxyList(raw);
  app.set('trust proxy', list);
  return list;
}

/**
 * 限流 tracker 需要的最小请求形态。
 *
 * 兼容 express 的 Request（ip: string / socket: Socket），
 * 也兼容「socket.remoteAddress 缺失」等极端输入 —— 这里刻意放宽成 null-able，
 * 因为「值可能缺失」正是这个兜底函数要处理的情况。
 */
export interface TrackerRequest {
  ip?: string | null;
  socket?: { remoteAddress?: string | null } | null;
}

/**
 * 限流 tracker 兜底。
 *
 * @nestjs/throttler v6 的默认 getTracker 就是 `req.ip`
 * （见 node_modules/@nestjs/throttler/dist/throttler.guard.js:141 `async getTracker(req) { return req.ip; }`）。
 * 若 req.ip 为 undefined（例如 socket.remoteAddress 缺失导致地址链为空），
 * 限流 key 会退化成 sha256(前缀-undefined) → 所有流量同一个桶 → 限流静默失效。
 * 这里显式回退，保证 tracker 永不为 undefined。
 */
export function resolveThrottleTracker(req: TrackerRequest): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
