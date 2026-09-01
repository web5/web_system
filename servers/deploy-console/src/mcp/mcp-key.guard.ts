import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { McpAuthService } from './mcp-auth.service';

/**
 * MCP 专用鉴权守卫（替代控制台 JWT，用于 /api/mcp/* 路由）。
 *
 * 取 `X-Mcp-Key`（mcp-core 的 pass-through 凭证头）或 `Authorization: Bearer`，
 * 校验出 ownerId 后挂到 `req.mcpOperator`，供审计日志使用。
 *
 * 安全约束：ownerId 缺失时一律拒绝 —— 审计不允许出现 mcp/anonymous/unknown。
 */
@Injectable()
export class McpKeyGuard implements CanActivate {
  constructor(private readonly mcpAuth: McpAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const headerKey = req.headers?.['x-mcp-key'];
    const auth = req.headers?.['authorization'];
    const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const key = (Array.isArray(headerKey) ? headerKey[0] : headerKey) || bearer;

    if (!key) {
      throw new UnauthorizedException('missing MCP key (X-Mcp-Key or Bearer)');
    }

    const result = await this.mcpAuth.verifyKey(key);
    if (!result.valid || !result.ownerId) {
      throw new UnauthorizedException('invalid or revoked MCP key');
    }

    req.mcpOperator = result.ownerId;
    req.mcpKeyId = result.keyId;
    return true;
  }
}
