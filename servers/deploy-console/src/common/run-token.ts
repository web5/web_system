import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * 流水线 **run 短期令牌**（替掉注入脚本的长期 `INTERNAL_API_KEY`）。
 *
 * 背景（凭据面）：此前 `resolveStageVars()` 把控制台的 `INTERNAL_API_KEY` 原样注入为
 * `CONSOLE_TOKEN`，动作脚本用它调 `/api/internal/release/*`（写版本、切指针）。问题有三：
 *   1. **权限过大**：这一个 key 对 prod 是「任意模块切任意版本」，脚本本轮发布只需要
 *      「改这一个模块、这一次 run」的权限；
 *   2. **生命周期过长**：key 是静态配置，改一次要动 `.env` + 重启；脚本进程、日志、
 *      `set -x` 输出里泄露一个就永久有效；
 *   3. **无法归因**：审计只知道「有人用了内部接口」，不知道是哪次发布（见 InternalGuardService）。
 *
 * 做法：每次 run 的每次变量组装现场**现签一个短期令牌**，随脚本 env 下发；脚本侧
 * **零改造**（仍是 `x-internal-key: $CONSOLE_TOKEN`）。令牌自带 runId / env / moduleKey，
 * run 结束即撤销，过期自动失效。
 *
 * 安全边界（务必知晓，别当银弹）：
 *   - 令牌**不降权**：拿到它依然能切指针。本期收益是「作用域到单次 run + 短命 + 可撤销 +
 *     可归因」，真正的降权要等 scope 细化（`RunTokenClaims.scope` 字段已预留，判据待与动作类型联动后落地）；
 *   - 撤销表在**进程内存**：console 重启后未过期的令牌会复活，故 TTL 默认只有 2h，
 *     且 deploy-console 是 pm2 单实例（多实例部署需把撤销表挪到 DB/Redis）；
 *   - 签名密钥缺省回落 `JWT_SECRET`：不额外引入必须配置的新密钥，零配置即可上线。
 */

/** 令牌前缀：与静态 `INTERNAL_API_KEY` 区分，便于排障时一眼看出「这是 run 令牌」 */
export const RUN_TOKEN_PREFIX = 'rt1_';

/** 默认有效期 2 小时（覆盖一次发布最长耗时；`RUN_TOKEN_TTL_SEC` 可调） */
export const DEFAULT_RUN_TOKEN_TTL_SEC = 2 * 60 * 60;

/** 撤销表上限：超出即淘汰最旧的（防止长跑进程内存无限增长） */
const MAX_REVOKED = 5000;

/** run 令牌的载荷（HS256 JWT 的 payload 段） */
export interface RunTokenClaims {
  /** JWT id：撤销的最小单位 */
  jti: string;
  /** 流水线 run id（`deploy_pipeline_runs.id`），与脚本 env 里的 `RUN_ID` 同源 */
  runId: string;
  /** 目标环境（dev/prod/local） */
  env: string;
  /** 模块 key */
  moduleKey: string;
  /** 签发时间（秒） */
  iat: number;
  /** 过期时间（秒） */
  exp: number;
  /**
   * 权限范围。**本期不校验**（占位 + 留痕）：脚本目前只调「写版本 / 切指针 / 读配置」，
   * 细化到 `pointer:write` / `version:write` / `config:read` 需要与动作类型联动，
   * 属下一期。先落字段，免得将来改协议。
   */
  scope: string[];
}

/** 签发结果（未启用/无密钥时为 null，调用方回落到静态 key） */
export interface IssuedRunToken {
  token: string;
  jti: string;
  claims: RunTokenClaims;
  /** 过期时间（毫秒时间戳，便于日志/审计直接打印） */
  expiresAt: number;
}

export type VerifyFailureReason = 'not-run-token' | 'malformed' | 'bad-signature' | 'expired' | 'revoked';

export type VerifyResult =
  | { ok: true; claims: RunTokenClaims }
  | { ok: false; reason: VerifyFailureReason };

/**
 * 撤销表：`jti → 撤销时刻`。
 *
 * 为什么是内存而不是 DB：撤销只在「run 结束」这一刻发生，而校验发生在同进程
 * （脚本 curl 回的就是这台 console），落库只会给每次调用加一次 IO。
 * 代价见文件头「安全边界」——TTL 短 + 单实例，可接受。
 */
const revoked = new Map<string, number>();

/**
 * 签名密钥取值链（高 → 低）：`RUN_TOKEN_SECRET` → `CONFIG_MASTER_KEY` → `JWT_SECRET`。
 *
 * 故意**不回落** `INTERNAL_API_KEY`：否则「签令牌的密钥」和「令牌要替代的静态 key」
 * 是同一个值，等于把静态 key 换个形式继续在脚本里传，本期的收益就白做了。
 */
function signingSecret(): string {
  return (
    process.env.RUN_TOKEN_SECRET ||
    process.env.CONFIG_MASTER_KEY ||
    process.env.JWT_SECRET ||
    ''
  );
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(Buffer.from(JSON.stringify(obj), 'utf8'));
}

function decodeSegment(seg: string): Record<string, unknown> | null {
  try {
    const pad = seg.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(pad, 'base64').toString('utf8');
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

/** 常量时间比较：避免按字节提前退出造成的时序侧信道（签名比较必须走这个） */
function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * 签发一个 run 短期令牌。
 * @returns 未启用或取不到签名密钥时返回 `null` —— 调用方应回落静态 key，不要因此阻断发布。
 */
export function issueRunToken(i: {
  runId: string;
  env: string;
  moduleKey: string;
  ttlSec?: number;
}): IssuedRunToken | null {
  const secret = signingSecret();
  if (!secret) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = Number.isFinite(i.ttlSec) && (i.ttlSec as number) > 0
    ? Math.floor(i.ttlSec as number)
    : ttlFromEnv();
  const jti = randomUUID();
  const claims: RunTokenClaims = {
    jti,
    runId: String(i.runId || ''),
    env: String(i.env || ''),
    moduleKey: String(i.moduleKey || ''),
    iat: nowSec,
    exp: nowSec + ttl,
    scope: ['pointer:write', 'version:write', 'config:read'],
  };
  const body = `${b64urlJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlJson(claims)}`;
  return {
    token: RUN_TOKEN_PREFIX + body + '.' + sign(body, secret),
    jti,
    claims,
    expiresAt: (nowSec + ttl) * 1000,
  };
}

function ttlFromEnv(): number {
  const raw = Number(process.env.RUN_TOKEN_TTL_SEC);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RUN_TOKEN_TTL_SEC;
}

/**
 * 校验一个 run 令牌。
 *
 * **非 run 令牌**（不带 `rt1_` 前缀）返回 `{ ok:false, reason:'not-run-token' }` 而不是抛错：
 * 调用方要据此回落到静态 key 比对，两种凭据是**并存**关系（存量脚本/运维脚本仍用静态 key）。
 */
export function verifyRunToken(token: string): VerifyResult {
  const raw = String(token ?? '').trim();
  if (!raw.startsWith(RUN_TOKEN_PREFIX)) return { ok: false, reason: 'not-run-token' };

  const body = raw.slice(RUN_TOKEN_PREFIX.length);
  const parts = body.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts;

  const secret = signingSecret();
  if (!secret) return { ok: false, reason: 'bad-signature' };

  const header = decodeSegment(h);
  if (!header || header.alg !== 'HS256') return { ok: false, reason: 'malformed' };
  if (!safeEq(sign(`${h}.${p}`, secret), s)) return { ok: false, reason: 'bad-signature' };

  const claims = decodeSegment(p);
  if (!claims) return { ok: false, reason: 'malformed' };

  const exp = Number(claims.exp);
  const jti = String(claims.jti ?? '');
  const runId = String(claims.runId ?? '');
  const env = String(claims.env ?? '');
  const moduleKey = String(claims.moduleKey ?? '');
  if (!jti || !runId) return { ok: false, reason: 'malformed' };
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) >= exp) {
    return { ok: false, reason: 'expired' };
  }
  if (revoked.has(jti)) return { ok: false, reason: 'revoked' };

  return {
    ok: true,
    claims: {
      jti,
      runId,
      env,
      moduleKey,
      iat: Number(claims.iat) || 0,
      exp,
      scope: Array.isArray(claims.scope) ? claims.scope.map(String) : [],
    },
  };
}

/** 撤销单个令牌（run 结束时调用；已撤销/未知 jti 都是幂等的） */
export function revokeRunToken(jti: string): void {
  const k = String(jti ?? '').trim();
  if (!k) return;
  revoked.set(k, Date.now());
  if (revoked.size > MAX_REVOKED) {
    // Map 保持插入序，最旧的在最前
    const oldest = revoked.keys().next().value as string | undefined;
    if (oldest) revoked.delete(oldest);
  }
}

/** 批量撤销（一次 run 可能签过多个令牌：编排模式下每个动作都会重新组装 env） */
export function revokeRunTokens(jtis: readonly string[]): void {
  for (const j of jtis) revokeRunToken(j);
}

/** 仅供测试/诊断：当前撤销表大小 */
export function revokedTokenCount(): number {
  return revoked.size;
}

/** 仅供测试：清空撤销表 */
export function __clearRevokedForTest(): void {
  revoked.clear();
}

/** 令牌是否为本模块签发的形态（用于报错文案区分，不校验有效性） */
export function looksLikeRunToken(v: string): boolean {
  return String(v ?? '').trim().startsWith(RUN_TOKEN_PREFIX);
}

/** 失败原因 → 面向排障的错误文案（不含令牌内容） */
export function describeVerifyFailure(reason: VerifyFailureReason): string {
  switch (reason) {
    case 'expired':
      return 'run 令牌已过期（超过 RUN_TOKEN_TTL_SEC）：脚本执行时间过长，或这枚令牌属于上一次 run';
    case 'revoked':
      return 'run 令牌已被撤销（所属 run 已结束）：脚本在 run 结束后才回调平台';
    case 'bad-signature':
      return 'run 令牌签名校验失败：控制台签名密钥已变更（RUN_TOKEN_SECRET/CONFIG_MASTER_KEY/JWT_SECRET），请重跑发布';
    case 'malformed':
      return 'run 令牌格式非法（疑似被截断或改写）';
    default:
      return 'run 令牌无效';
  }
}
