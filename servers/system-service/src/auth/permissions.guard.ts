import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_PERMISSIONS } from '@web-system/types';
import { PERMISSION_KEY } from './decorators';

/**
 * PermissionsGuard — 基于角色权限码的授权守卫
 *
 * 依赖 AuthGuard 注入的 request.user.roles，展开为权限码集合后比对。
 * 未标注 @RequirePermission() 的路由直接放行（只需登录）。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: { roles?: string[] } }>();
    const roles = request.user?.roles ?? [];
    const granted = roles.flatMap(
      (role) => (ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? [],
    );

    if (!granted.includes(required)) {
      this.logger.warn(
        `权限不足：需要 ${required}，用户角色 [${roles.join(', ') || '无'}]`,
      );
      throw new ForbiddenException('无权限访问');
    }

    return true;
  }
}
