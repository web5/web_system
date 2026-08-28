import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * AuthGuard — 调用 auth-service 验证 JWT 令牌
 *
 * 所有微服务统一通过此守卫调用 auth-service /auth/verify 端点
 * 完成认证并获取用户信息，确保认证逻辑集中管理。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private authServiceUrl: string;

  constructor(
    private configService: ConfigService,
    private reflector: Reflector,
  ) {
    this.authServiceUrl = this.configService.get(
      'AUTH_SERVICE_URL',
      'http://localhost:6001',
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
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

      const result = await response.json();
      // result = { code: 200, data: { id, username, email, avatar, roles } }
      request['user'] = result.data;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('认证服务不可用');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
