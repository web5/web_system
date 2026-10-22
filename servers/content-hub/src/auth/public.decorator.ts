import { SetMetadata } from '@nestjs/common';

/**
 * 标记跳过用户 JWT 校验的路由。
 *
 * 用于服务间接口：类级挂了 JwtAuthGuard 时，@Public() 让 JWT 守卫放行，
 * 由方法级 `@UseGuards(InternalKeyGuard)` 接管服务间 key 鉴权。
 *
 * 🔴 @Public() 本身不提供任何鉴权，只表示「不走用户 JWT」——
 *    单独使用等于裸奔，必须搭配 InternalKeyGuard。
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
