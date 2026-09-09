import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * InternalKeyGuard — 服务间调用鉴权（MCP 模块调用 knowledge 工具时由
 * mcp-gateway 附 Bearer <INTERNAL_API_KEY>；与 mcp-gateway seed 的
 * KNOWLEDGE_SERVICE_AUTH_CONFIG.token 同值）
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private internalKey: string;

  constructor(private configService: ConfigService) {
    this.internalKey = this.configService.get('INTERNAL_API_KEY', '');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token && token === this.internalKey) {
      return true;
    }
    throw new UnauthorizedException('内部调用密钥无效');
  }
}
