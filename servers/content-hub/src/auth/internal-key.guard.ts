import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * InternalKeyGuard — 服务间调用鉴权。
 *
 * 用于 mcp-gateway 直连 content-hub 的内部接口（/api/papers、/api/topics、
 * /api/institution/*、/api/content/wechat/*、/api/content/lhb* 等）。
 * mcp-gateway 侧经 mcp-core 的 bearer 机制附带
 * `Authorization: Bearer <token>`（token 来自 seed 的 auth_config）；
 * SSH curl skill（dev-machine / wechat-mp / paper 等）同样带此头。
 *
 * 与 knowledge-service 的 InternalKeyGuard 同模式，区别仅在 key 的环境变量名：
 * 复用 gateway 已在用的 `CONTENT_HUB_SERVICE_KEY`（兼容旧名 FINNEWS_SERVICE_KEY），
 * 不引入第二把服务间钥匙。
 *
 * 🔴 安全默认：key 未配置时**全部拒绝**（而非放行）—— 空 key 等于没配鉴权，
 *    放行会让「忘了配 key」表现为静默裸奔。忘配时启动日志会明确告警。
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private static readonly logger = new Logger(InternalKeyGuard.name);
  private readonly internalKey: string;

  constructor(configService: ConfigService) {
    this.internalKey =
      configService.get<string>('CONTENT_HUB_SERVICE_KEY') ||
      configService.get<string>('FINNEWS_SERVICE_KEY') ||
      '';
    if (!this.internalKey) {
      InternalKeyGuard.logger.warn(
        'CONTENT_HUB_SERVICE_KEY 未配置 —— 所有内部服务间接口' +
          '（/api/papers、/api/institution/*、/api/content/wechat/* 等）将全部返回 401',
      );
    }
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
