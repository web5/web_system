/**
 * 统一认证助手（C1，`specs/backend-consolidation/design.md` 任务表 C1）
 *
 * 目标：8 个服务各自维护一份 `auth.guard.ts`，逻辑重复但**细节又不完全一致**
 * （远程 verify / 本地 JwtService / 本地 HMAC 三种形态、错误文案各写各的、
 *  `AUTH_SERVICE_URL` 空串处理有的对有的不对）。C1 先把**可共享的判定逻辑**收敛到这里，
 *  **行为完全不变**：401 与文案仍由各服务自己的薄 guard 抛。
 *
 * 为什么**不**在共享包里直接抛 `UnauthorizedException`：
 *   共享包里的 `@nestjs/common` 与服务里的可能是两份实例（pnpm 隔离）→ 共享包抛出的
 *   HttpException 子类在服务侧可能不被识别为 HTTP 异常，会退化成 500。
 *   与既有 `auth/permission.guard.ts` 同一约定（它返回 false 而非抛 Forbidden）。
 *
 * 为什么**不**注入 `Reflector`：
 *   `@nestjs/core` 同样存在双实例风险（DI token 不匹配）。`@Public()` 的判定留在各服务
 *   薄 guard 里做，共享包只提供**纯函数 + 可注入的 fetch/get**，方便单测。
 *
 * 语义变更在 C2（由 `AUTH_MODE` 开关双轨控制），C1 只做结构收敛。
 */

/** 认证模式：remote = 调 auth-service /auth/verify；local = 本地校验 JWT */
export type AuthMode = 'remote' | 'local';

/** 远程校验结果（判别联合：服务据此决定抛哪个 401 文案） */
export type VerifyResult =
  | { ok: true; user: Record<string, unknown> }
  | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' };

export interface RemoteAuthDeps {
  /** 读配置（传 `configService.get` 或 `process.env` 读取器） */
  get: (key: string) => string | undefined;
  /** 便于单测替换 */
  fetchImpl?: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
    ok: boolean;
    json: () => Promise<unknown>;
  }>;
  /** 超时（毫秒，默认 8000） */
  timeoutMs?: number;
}

/**
 * 解析 auth-service 地址。
 *
 * ⚠️ **空串必须视为"未配置"**：pm2 / 环境变量可能注入空串，而
 * `configService.get(key, default)` 只在 key **未定义**时才用 default ——
 * 拿到空串会 `fetch('')` 直接失败，最终被误报成 401「认证服务不可用」
 * （2026-09-11 dev 事故：字典管理 / 数据浏览等页面全量 401）。
 *
 * 这是相对旧实现**唯一的**、且刻意的判定差异：只在"配了空串"这种明确错误配置下生效，
 * 正常配置行为不变。
 */
export function resolveAuthServiceUrl(deps: RemoteAuthDeps, fallback: string): string {
  const configured = String(deps.get('AUTH_SERVICE_URL') ?? '').trim();
  return (configured || fallback).replace(/\/+$/, '');
}

/** 从 Authorization 头提取 Bearer token */
export function extractBearerToken(headers: { authorization?: string } | undefined): string | undefined {
  const [type, token] = headers?.authorization?.split(' ') ?? [];
  return type === 'Bearer' && token ? token : undefined;
}

/**
 * 远程校验：调 `${authServiceUrl}/auth/verify`，成功返回 `data`（= 用户信息）。
 *
 * 失败分类：
 *   - `missing`     没有 Bearer token
 *   - `invalid`     auth-service 明确拒绝（令牌无效/过期）或返回体不合预期
 *   - `unavailable` 连不上 / 超时 / 抛异常（**认证服务不可用**）
 */
export async function verifyRemoteToken(
  headers: { authorization?: string },
  deps: RemoteAuthDeps,
  fallbackUrl: string,
): Promise<VerifyResult> {
  const token = extractBearerToken(headers);
  if (!token) return { ok: false, reason: 'missing' };

  const base = resolveAuthServiceUrl(deps, fallbackUrl);
  const doFetch: NonNullable<RemoteAuthDeps['fetchImpl']> =
    deps.fetchImpl ??
    ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<NonNullable<RemoteAuthDeps['fetchImpl']>>);

  try {
    const response = await doFetch(`${base}/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
    if (!response.ok) return { ok: false, reason: 'invalid' };

    const result = (await response.json()) as { data?: Record<string, unknown> };
    if (!result?.data) return { ok: false, reason: 'invalid' };
    return { ok: true, user: result.data };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
