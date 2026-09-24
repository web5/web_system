/**
 * 内部端点：token 状态校验
 *
 * 背景：gateway 的代理控制器整体 @Public，黑名单只有 auth-service 自己查，
 * 导致登出后的 token 仍能调通 /api/users/* 等其它服务接口。
 * 已拍板（Q14）：黑名单统一由 auth-service 提供，其它服务调本端点，不各自直连 Redis。
 *
 * 不对外暴露：路径前缀为 internal/auth，网关只映射 /api/auth → auth-service，
 * 本端点仅服务间直连（AUTH_SERVICE_URL，默认 http://127.0.0.1:6101）。
 */
import { Controller, Post, Body, HttpCode, HttpStatus, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Controller('internal/auth')
export class InternalAuthController {
  private readonly logger = new Logger(InternalAuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('token-status')
  @HttpCode(HttpStatus.OK)
  async tokenStatus(@Body() body: { token?: string }): Promise<{ valid: boolean; reason?: string }> {
    // 可选共享密钥：配置了 INTERNAL_API_KEY 时校验，未配置则仅依赖内网隔离
    const expected = this.configService.get<string>('INTERNAL_API_KEY');
    const provided = (body as { key?: string })?.key;
    if (expected && provided !== expected) {
      throw new UnauthorizedException('invalid internal key');
    }
    return this.authService.getTokenStatus(body?.token || '');
  }
}
