/**
 * 后端权限守卫（RBAC）—— 供各微服务统一使用
 *
 * 用法（必须挂在 AuthGuard 之后，依赖 req.user.roles）：
 *   @UseGuards(AuthGuard, PermissionGuard)
 *   @RequirePermission('agents:manage')
 *
 * 校验逻辑：
 *   - 未标注 @RequirePermission 的路由直接放行
 *   - admin 角色特判放行
 *   - 其余角色：调 user-service 内部接口 /internal/roles/permissions
 *     解析权限码集合，命中则放行，否则 403
 *   - 内部接口不可用时 fail-closed（拒绝），避免鉴权被绕过
 *
 * 配置（各服务 .env）：
 *   USER_SERVICE_URL   user-service 地址，默认 http://127.0.0.1:6002
 *   INTERNAL_API_KEY   内部接口密钥，必须与 user-service 一致
 *
 * 实现说明：
 *   1) 不注入 Reflector（避免共享包与服务 @nestjs/core 双实例导致 DI token 不匹配），
 *      用全局 Reflect.getMetadata 读取装饰器元数据。
 *   2) 拒绝时返回 false 而非抛 ForbiddenException —— 共享包抛的 HttpException 子类
 *      与服务实例的 @nestjs/common 不是同一类，会被异常过滤器误判为非 HttpException
 *      而返回 500。return false 让 Nest 用服务自身实例抛 403。
 */
import { SetMetadata, Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import 'reflect-metadata';

export const REQUIRED_PERMISSION_KEY = 'required_permission';

/** 标注路由所需权限点：@RequirePermission('agents:manage') */
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      Reflect.getMetadata(REQUIRED_PERMISSION_KEY, context.getHandler()) ??
      Reflect.getMetadata(REQUIRED_PERMISSION_KEY, context.getClass());
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { roles?: string[] } | undefined;
    if (!user) return false;

    const roles = user.roles || [];
    if (roles.includes('admin')) return true;

    const permissions = await this.resolvePermissions(roles);
    return permissions.includes(required);
  }

  /** 调 user-service 内部接口解析角色权限（fail-closed：任何异常返回空集 → 拒绝） */
  private async resolvePermissions(roles: string[]): Promise<string[]> {
    const base = (process.env.USER_SERVICE_URL || 'http://127.0.0.1:6002').replace(/\/+$/, '');
    const internalKey = process.env.INTERNAL_API_KEY || '';
    try {
      const r = await fetch(`${base}/internal/roles/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': internalKey,
        },
        body: JSON.stringify({ roles }),
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return [];
      // 兼容裸 {permissions} 与全局拦截器包装的 {code,data:{permissions}}
      const json = (await r.json()) as {
        permissions?: string[];
        data?: { permissions?: string[] };
      };
      return json?.data?.permissions ?? json?.permissions ?? [];
    } catch {
      return [];
    }
  }
}
