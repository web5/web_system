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
    // 真实端口为 6101（见各服务 .env），勿沿用部分服务代码里遗留的 6001
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:6101');
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
