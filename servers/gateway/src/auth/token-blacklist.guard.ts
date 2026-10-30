/**
 * 黑名单校验 Guard（代理转发前执行）
 *
 * 背景：gateway 的 ProxyController 整体 @Public，认证由各微服务自行处理，
 * 因此「已登出的 token」仍能调通 /api/users/* 等接口 —— 退出登录在服务端不生效。
 *
 * 已拍板（Q14）：黑名单统一由 auth-service 提供，gateway 调其内部端点，
 * 不各自直连 Redis（避免黑名单 key/TTL 规则外泄到多处）。
 *
 * 缓存策略（决定「登出多久生效」）：
 * - 命中「已失效」：缓存 300s（废掉的 token 恒废，无需回源）
 * - 命中「有效」：缓存 5s（登出后旧 token 最长 5s 内全局失效）
 * - auth-service 不可用：放行并告警（与现有 Redis 不可用放行策略一致）
 */
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SERVICE_URL_DEFAULTS } from '@web-system/shared';

interface CacheEntry {
  valid: boolean;
  at: number;
}

const VALID_CACHE_MS = 5_000;
const INVALID_CACHE_MS = 300_000;

/**
 * 公开鉴权路径白名单：这些接口本身就是「用凭据换凭据」，调用方不该被要求持有有效 token。
 *
 * 为什么必须放行：前端（浏览器）可能因为上一会话残留而带着**已登出**的旧 token 调登录接口。
 * 若在这里按黑名单拦截，会返回 401「令牌已失效（已登出）」，请求根本到不了 auth-service，
 * 表现为「密码正确却永远登不进去」——且客户端把该 401 视作"凭据错误"不清 token，
 * 形成死循环。见 fix/auth-stale-token-blocks-login。
 *
 * 注意：黑名单是「让已登出的 token 失效」的机制，与「谁能调登录接口」无关，
 * 放行这些路径不会削弱登出语义 —— 它们不消费 token，只签发 token。
 */
const PUBLIC_AUTH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/wechat-login',
  '/auth/miniprogram-login',
  '/auth/wechat/authorize',
  '/auth/wechat/callback',
];

function isPublicAuthPath(pathname: string): boolean {
  if (!pathname) return false;
  const path = pathname.split('?')[0];
  return PUBLIC_AUTH_PATHS.some((p) => path === p || path.endsWith(p));
}

@Injectable()
export class TokenBlacklistGuard implements CanActivate {
  private readonly logger = new Logger(TokenBlacklistGuard.name);
  private readonly cache = new Map<string, CacheEntry>();
  private alerted = false;

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; path?: string; originalUrl?: string }>();

    // 公开鉴权路径：不消费 token，只签发 token → 跳过黑名单校验
    if (isPublicAuthPath(req?.path || req?.originalUrl || '')) return true;

    const raw = req?.headers?.authorization || '';
    const token = raw.replace(/^Bearer\s+/i, '');
    // 无凭证请求交由各微服务自行处理（公共服务 / 登录接口）
    if (!token) return true;

    const now = Date.now();
    const cached = this.cache.get(token);
    if (cached) {
      const ttl = cached.valid ? VALID_CACHE_MS : INVALID_CACHE_MS;
      if (now - cached.at < ttl) {
        if (!cached.valid) throw new UnauthorizedException('令牌已失效（已登出）');
        return true;
      }
      this.cache.delete(token);
    }

    let valid = true;
    try {
      const res = await fetch(`${this.authBaseUrl()}/internal/auth/token-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, key: this.configService.get<string>('INTERNAL_API_KEY') || '' }),
      });
      if (!res.ok) {
        valid = true; // 端点异常按放行处理（同上：不可用不阻塞业务）
      } else {
        const data = (await res.json()) as { valid?: boolean };
        valid = data?.valid !== false;
      }
    } catch (err: any) {
      if (!this.alerted) {
        this.logger.warn(`token 状态校验失败，按放行处理: ${err?.message || err}`);
        this.alerted = true;
      }
      valid = true;
    }

    this.cache.set(token, { valid, at: now });
    if (!valid) throw new UnauthorizedException('令牌已失效（已登出）');
    return true;
  }

  private authBaseUrl(): string {
    // 与代理转发复用同一服务地址（dev/prod=6001、本机=6101），只换内部端点路径
    return this.configService.get<string>('AUTH_SERVICE_URL') || SERVICE_URL_DEFAULTS.auth;
  }
}
