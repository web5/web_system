import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 内部服务间调用保护：要求请求头 x-internal-key 等于 INTERNAL_API_KEY
 * 仅用于 mcp-gateway 等内部服务调用 user-service 的 /internal/* 接口
 */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const expected = this.config.get<string>('INTERNAL_API_KEY');
    const provided = req.headers['x-internal-key'] || req.headers['X-Internal-Key'];
    if (!expected || provided !== expected) {
      throw new UnauthorizedException('internal forbidden');
    }
    return true;
  }
}
