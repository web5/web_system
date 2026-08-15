import { SetMetadata } from '@nestjs/common';

/**
 * 公开访问装饰器
 * 标记路由为不需要 JWT 认证
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
