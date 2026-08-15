import { Controller, Post, Get, Delete, Body, Param, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ConfigService } from '@nestjs/config';

/**
 * API Key 管理
 * 公开：POST /api/keys/apply（发码）、POST /api/keys/verify（验码签发）
 * 运营：GET /api/keys、DELETE /api/keys/:id（需 X-Admin-Key）
 */
@Controller('api/keys')
export class ApiKeyController {
  constructor(
    private readonly svc: ApiKeyService,
    private readonly config: ConfigService,
  ) {}

  @Post('apply')
  async apply(@Body() dto: { email: string }) {
    await this.svc.apply(dto.email);
    return { message: '验证码已发送到邮箱，请查收（10 分钟内有效）' };
  }

  @Post('verify')
  async verify(@Body() dto: { email: string; code: string; name?: string }) {
    const { plaintext, prefix } = await this.svc.verifyAndIssue(dto.email, dto.code, dto.name);
    return { key: plaintext, prefix, message: 'API Key 已生成，请妥善保管（明文仅展示一次）' };
  }

  private requireAdmin(headers: Record<string, any>): void {
    const adminKey = this.config.get('MCP_ADMIN_KEY');
    const provided = headers['x-admin-key'] || headers['X-Admin-Key'];
    if (!adminKey || provided !== adminKey) {
      throw new UnauthorizedException('需要管理员密钥 (X-Admin-Key)');
    }
  }

  @Get()
  async list(@Headers() headers: Record<string, any>) {
    this.requireAdmin(headers);
    return { keys: await this.svc.list() };
  }

  @Delete(':id')
  async revoke(@Headers() headers: Record<string, any>, @Param('id') id: string) {
    this.requireAdmin(headers);
    await this.svc.revoke(Number(id));
    return { id: Number(id), message: '已吊销' };
  }
}
