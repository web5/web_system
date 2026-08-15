import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 当前用户参数装饰器
 * 从请求中提取 JWT 验证后的用户信息
 * 用法：@CurrentUser() user: any
 */
export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    // 如果指定了属性名，则返回对应属性，否则返回整个用户对象
    return data ? user?.[data] : user;
  },
);
