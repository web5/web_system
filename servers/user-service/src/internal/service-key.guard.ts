import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * 服务间鉴权守卫：internal 接口用，校验 x-service-key 头。
 *
 * 与 gateway 的 content-hub 通道同款模式：密钥 USER_SERVICE_KEY 配置在
 * user-service 与调用方（ai-agent）两端，不一致则拒绝。
 * 未配置密钥时一律拒绝（fail-closed），避免「忘配密钥导致 internal 裸奔」。
 */
@Injectable()
export class ServiceKeyGuard implements CanActivate {
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
