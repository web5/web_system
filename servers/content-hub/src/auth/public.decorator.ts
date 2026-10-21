import { SetMetadata } from '@nestjs/common';

/** 标记公开路由：跳过 JWT 校验（供 service key 通道的接口使用） */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
