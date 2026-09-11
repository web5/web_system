import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * AuthGuard — 调用 auth-service 验证 JWT 令牌
 *
 * 与 todo-service / user-service 的实现一致：所有微服务统一通过
 * auth-service 的 /auth/verify 端点完成认证，确保认证逻辑集中管理。
 *
 * 标注了 @Public() 的路由直接放行。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly authServiceUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {
    // auth-service 地址，由各环境通过 AUTH_SERVICE_URL 显式指定。端口约定：
    //   - 本地：6101（本机 6001 被其它项目占用，见 servers/auth-service/.env）
    //   - dev/prod：6001（见 ecosystem.config.js 与 .env.production.example）
    // 此处默认值仅作兜底，与 user-service / ai-service / todo-service 的守卫保持一致。
    //
    // ⚠️ 必须把「空字符串」视为未配置：pm2 / 环境变量可能注入空串，
    //    而 configService.get(key, default) 只在 key 未定义时才用 default，
    //    拿到空串会执行 fetch('') 直接失败，最终被误报成 401「认证服务不可用」
    //    （2026-09-11 dev 环境事故：字典管理 / 数据浏览等页面全量 401）。
    const configured = (this.configService.get<string>('AUTH_SERVICE_URL') || '').trim();
    this.authServiceUrl = (configured || 'http://127.0.0.1:6001').replace(/\/+$/, '');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authorization header missing');
    }

    try {
      const response = await fetch(`${this.authServiceUrl}/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new UnauthorizedException('令牌无效或已过期');
      }

      const result = (await response.json()) as { data?: Record<string, unknown> };
      if (!result?.data) {
        throw new UnauthorizedException('令牌校验失败');
      }

      // data = { id, username, email, avatar, roles }
      request['user'] = result.data;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`调用 auth-service 失败: ${(error as Error).message}`);
      throw new UnauthorizedException('认证服务不可用');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
