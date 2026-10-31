/**
 * MCP 管理端点 admin 守卫（L1-a）
 *
 * 背景（2026-10-31 实测）：gateway 的 ProxyController 整体 `@Public()`，认证交由各微服务自己处理；
 * 而 mcp-gateway 的 `AdminController` 一处鉴权都没有 —— 于是
 *   `GET https://kedouai.com/api/mcp/modules` 无任何凭证就 200，返回全部模块定义（含 base_url / auth_config）。
 *
 * 为什么修在 gateway 而不是 mcp-gateway：
 *   mcp-gateway 同时被内网服务直连调用（内容管道等），在它上面加「用户 JWT」守卫会打断内网调用。
 *   gateway 是唯一对外入口，且 JWT_SECRET 与 auth-service 同源，在这里判「是不是运营后台的人」最合适。
 *
 * 为什么不复用 AuthGuard：`auth.guard.ts` 只验「token 有效」，不判系统归属（systems 是否含 admin），
 *   拿 C 端 portal 账号的 token 也能过 —— 那不是本端点的受众。
 *
 * 判据与 content-hub `JwtAuthGuard`（servers/content-hub/src/auth/jwt-auth.guard.ts:44-67）**同一口径**：
 *   缺 token → 401 / 验签失败 → 401 / refresh token → 401 / 非 admin 系统 → 403。
 * 口径必须同源，否则同一个账号在「内容管理」能进、在「MCP 管理」被拒，排障时会怀疑 token 坏了。
 *
 * 刻意**不**读 `IS_PUBLIC_KEY`：本守卫挂在 ProxyController（class 级 `@Public()`）的方法上，
 *   全局 AuthGuard 已按 @Public 放行整类，若本守卫也看 @Public 就会把自己变成摆设。
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hasSystem } from '@web-system/shared';

/** access token 里本守卫关心的字段（其余字段原样透传给下游，不做白名单裁剪） */
interface McpAdminJwtPayload {
  sub?: number | string;
  username?: string;
  /** access / refresh；老 token 可能没这个字段，按 access 处理 */
  type?: string;
  /** 账号归属的系统列表，如 ['admin'] */
  systems?: unknown;
  [key: string]: unknown;
}

@Injectable()
export class McpAdminGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const auth = req.headers?.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('缺少登录凭证');
    }

    let payload: McpAdminJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<McpAdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('登录凭证无效或已过期');
    }

    // refresh token 不能当 access token 用
    if (payload?.type && payload.type !== 'access') {
      throw new UnauthorizedException('令牌类型不正确');
    }
    if (!hasSystem({ systems: payload?.systems }, 'admin')) {
      throw new ForbiddenException('该账号不属于运营后台（admin）');
    }

    req.user = payload;
    return true;
  }
}
