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
 * 历史故障实证：prod auth-service 持续连接回环 Redis 失败，而 `.env` 中的
 * `REDIS_URL` 实际指向内网 Redis。受影响的真实功能：
 * - **登出**：token 黑名单 `redis.set()` 等待或失败会破坏退出语义；
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
 * （可用 `redis://:pw%25-test@cache.test.invalid:6379` 这类脱敏值验证），故这里要保持同口径，
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

export function redisOptionsFromUrl(rawUrl: string | undefined): RedisOptions {
  if (!rawUrl?.trim()) throw new Error('Redis 配置缺失');

  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Redis 配置非法');
  }

  if ((u.protocol !== 'redis:' && u.protocol !== 'rediss:') || !u.hostname) {
    throw new Error('Redis 配置非法');
  }

  const options: RedisOptions = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    connectTimeout: 1000,
    commandTimeout: 800,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // 请求命令关闭离线排队；后台仍按有界退避重连。
    retryStrategy: (times: number) => Math.min(times * 100, 1000),
  };

  // Redis 6 ACL 用户名（无则省略，避免给老版本发多余命令）
  if (u.username) options.username = safeDecode(u.username);
  if (u.password) options.password = safeDecode(u.password);

  // pathname 仅接受 "/<非负整数 db>"；"/" 或空沿用 db 0。
  if (u.pathname && u.pathname !== '/') {
    const dbSegment = u.pathname.slice(1);
    if (!/^\d+$/.test(dbSegment)) throw new Error('Redis 配置非法');
    const db = Number(dbSegment);
    if (!Number.isSafeInteger(db)) throw new Error('Redis 配置非法');
    options.db = db;
  }

  if (u.protocol === 'rediss:') options.tls = {};

  return options;
}
