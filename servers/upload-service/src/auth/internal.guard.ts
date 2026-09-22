import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 服务间内部接口鉴权（与 user-service / system-service 的 InternalGuard 同一约定）。
 *
 * 使用方式：控制器上 `@Public()`（跳过全局 JWT 校验）+ `@UseGuards(InternalGuard)`，
 * 调用方在 header 带 `x-internal-key: <INTERNAL_API_KEY>`。
 *
 * 为什么 upload-service 也要有：A3 之后本服务是**唯一写入点**，
 * ai-service 等不再自己落盘，必须有一个受控的服务间写入口
 * （`POST /internal/uploads/store`），而不是让各服务共享磁盘路径。
 */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const expected = this.config.get<string>('INTERNAL_API_KEY');
    if (!expected) {
      throw new UnauthorizedException('internal api key 未配置');
    }
    const provided = req.headers['x-internal-key'] ?? req.headers['X-Internal-Key'];
    if (provided !== expected) {
      throw new UnauthorizedException('internal forbidden');
    }
    return true;
  }
}
