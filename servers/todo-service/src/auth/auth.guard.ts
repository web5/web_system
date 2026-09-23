import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { SERVICE_URL_DEFAULTS, verifyRemoteToken } from '@web-system/shared';

/**
 * AuthGuard — 调用 auth-service 验证 JWT 令牌（C1 灰度：todo-service 首个接入）
 *
 * 判定逻辑收敛到 `@web-system/shared` 的 `verifyRemoteToken`（统一 URL 解析、空串处理、
 * 失败分类、超时），本服务只负责**抛 401 与文案** —— 与改造前完全一致：
 *   - 无 token      → 'Authorization header missing'
 *   - 令牌无效/过期 → '令牌无效或已过期'
 *   - 认证服务不可达 → '认证服务不可用'
 *
 * 为什么共享包不直接抛 UnauthorizedException：共享包与服务里的 @nestjs/common 可能是
 * 两份实例（pnpm 隔离）→ 共享包抛的 HttpException 子类在服务侧可能退化成 500。
 *
 * 相对旧实现的**两处刻意改进**（均只在异常配置下触发，正常路径行为不变）：
 *   1. `AUTH_SERVICE_URL` 配成空串时回落到默认值 —— 旧写法会 `fetch('')`，被误报成
 *      「认证服务不可用」（2026-09-11 dev 事故同源）。
 *   2. 远程校验加 8s 超时 —— 旧写法无超时，auth-service 挂起时请求会一直挂着。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const res = await verifyRemoteToken(
      request.headers,
      { get: (key: string) => this.configService.get<string>(key) },
      SERVICE_URL_DEFAULTS.auth,
    );

    if (!res.ok) {
      const message =
        res.reason === 'missing'
          ? 'Authorization header missing'
          : res.reason === 'invalid'
            ? '令牌无效或已过期'
            : '认证服务不可用';
      throw new UnauthorizedException(message);
    }

    // data = { id, username, email, avatar, roles }
    request['user'] = res.user;
    return true;
  }
}
