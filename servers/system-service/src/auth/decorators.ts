import { SetMetadata } from '@nestjs/common';

/** 标记路由/控制器无需登录即可访问 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * 标记路由所需权限码。
 * 未标注的路由仅需登录即可访问（AuthGuard 通过后放行）。
 */
export const PERMISSION_KEY = 'permission';
export const RequirePermission = (code: string) => SetMetadata(PERMISSION_KEY, code);
