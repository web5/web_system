import type { RedisOptions } from 'ioredis';

/**
 * `REDIS_URL` → ioredis 连接参数。
 *
 * ## 为什么不能直接传 `{ url }`
 *
 * ioredis **不支持** `new Redis({ url: 'redis://...' })`：它只在参数是**字符串**时才解析 URL
 * （见 `ioredis/built/Redis.js`：`typeof arg === "string"` 分支才调 `parseURL`，
 * 对象分支只做 `defaults(options, arg)` 原样合并）。
 *
 * 于是 `{ url }` 被当成一个普通字段塞进 options，**host / port 回落到默认 `localhost:6379`** ——
 * 配置里的 `REDIS_URL` 看起来生效了，实际连的是本机不存在的 Redis。
 *
 * 线上实证（2026-10-09）：prod auth-service 的 error log 里 594+ 次
 * `Error: connect ECONNREFUSED 127.0.0.1:6379`，而 `.env` 里 `REDIS_URL` 分明指向云 Redis
 * `172.16.0.8:6379`（实测 PING 通）。受影响的真实功能：
 * - **登出**：token 黑名单 `redis.set()` 无 catch → 命令一直 pending / 抛错；
 * - 账号 pending 状态、微信 access_token 缓存（有 catch 降级，静默失效）。
 *
 * ## 用法
 *
 * ```ts
 * RedisModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({
 *     config: redisOptionsFromUrl(config.get('REDIS_URL') ?? 'redis://localhost:6379'),
 *   }),
 * })
 * ```
 *
 * 支持 `redis://` / `rediss://`、`user:pass@host:port/db`。
 *
 * ⚠️ 必须自己做百分号解码：`new URL()` 只对 http/https/ws/ftp/file 等「特殊 scheme」解码，
 * `redis:` 不在其列，userinfo 会**原样保留** `%25`。而 ioredis 的 `parseURL` 是解码的
 * （实测 `new Redis('redis://:gn%25!...@172.16.0.8:6379')` PING 通），故这里要保持同口径，
 * 否则密码里的 `%` 会被当成字面百分号发给服务端 → 认证失败。
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // 非法百分号序列（如密码里本身含裸 %）：原样返回，交给服务端判定
    return value;
  }
}

export function redisOptionsFromUrl(rawUrl: string): RedisOptions {
  const fallback: RedisOptions = { host: 'localhost', port: 6379 };

  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    // URL 不合法：显式回落并保留原值，便于排障时看出「配置长什么样」
    return { ...fallback };
  }

  const options: RedisOptions = {
    host: u.hostname || 'localhost',
    port: u.port ? Number(u.port) : 6379,
  };

  // Redis 6 ACL 用户名（无则省略，避免给老版本发多余命令）
  if (u.username) options.username = safeDecode(u.username);
  if (u.password) options.password = safeDecode(u.password);

  // pathname 形如 "/0" → db；"/" 或空则不动（用 ioredis 默认 db 0）
  const dbSegment = u.pathname ? u.pathname.replace(/^\//, '') : '';
  const db = dbSegment ? Number(dbSegment) : Number.NaN;
  if (Number.isFinite(db)) options.db = db;

  if (u.protocol === 'rediss:') options.tls = {};

  return options;
}
