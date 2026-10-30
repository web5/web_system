import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * ai-agent 服务间鉴权守卫：internal 接口用，校验 x-service-key 头。
 *
 * 与 user-service 的 ServiceKeyGuard 同款模式（fail-closed）：
 * 密钥 USER_SERVICE_KEY 配置在 ai-agent 与调用方（user-service）两端，
 * 不一致则拒绝；未配置密钥时一律拒绝，避免「忘配密钥导致 internal 裸奔」。
 */
@Injectable()
export class AiAgentServiceKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = this.configService.get<string>('USER_SERVICE_KEY');
    if (!expected) {
      throw new UnauthorizedException('服务未配置 USER_SERVICE_KEY，拒绝 internal 调用');
    }
    const key = req.headers['x-service-key'];
    if (typeof key !== 'string' || key !== expected) {
      throw new UnauthorizedException('x-service-key 校验失败');
    }
    return true;
  }
}
