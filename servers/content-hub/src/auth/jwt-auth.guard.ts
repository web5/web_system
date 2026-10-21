import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { hasSystem } from '@web-system/shared';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * 内容中枢 · 运营后台 JWT 守卫。
 *
 * 为什么 content-hub 现在要自己鉴权：
 *   历史上 content-hub 是「纯服务间 MCP」服务，靠 gateway 的 service key 通道鉴权
 *   （FinnewsController 的 /api/papers、/api/topics 等）。但「内容采集源管理」
 *   （ContentController / ContentQualityController 的 /api/content/*）要开放给
 *   admin 前端（浏览器、用户 JWT），service key 到不了浏览器。
 *   故只对「内容管理」这一组接口加用户 JWT 校验，FinnewsController 保持 service key 通道不动。
 *
 * 校验口径（与 console 的 JwtStrategy 同源）：
 *   - token 必须是 auth-service 签发的 access token（JWT_SECRET 同源）
 *   - payload.systems 必须含 'admin'（运营后台）—— C 端 portal 账号被挡在门外
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() 放行的路由（服务间接口，鉴权在 gateway service-key 层已做）跳过本守卫
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const auth = (req.headers as any)?.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('缺少登录凭证');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token);
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
