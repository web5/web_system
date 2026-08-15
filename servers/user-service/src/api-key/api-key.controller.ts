import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Headers,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/auth.guard';

/**
 * API Key 管理
 * 公开：POST /api/keys/apply（发码）、POST /api/keys/verify（验码签发）
 * 用户中心：GET /api/keys/mine、DELETE /api/keys/mine/:id（需登录）
 * 运营：GET /api/keys、DELETE /api/keys/:id（需 X-Admin-Key）
 */
@Controller('keys')
export class ApiKeyController {
  constructor(
    private readonly svc: ApiKeyService,
    private readonly config: ConfigService,
  ) {}

  @Post('apply')
  async apply(@Body() dto: { email?: string; ownerId?: number }) {
    const email = await this.svc.apply(dto);
    return { message: `验证码已发送至 ${email}，请查收（10 分钟内有效）` };
  }

  @Post('verify')
  async verify(@Body() dto: { email?: string; ownerId?: number; code: string; name?: string }) {
    const { plaintext, prefix } = await this.svc.verifyAndIssue(dto);
    return { key: plaintext, prefix, message: 'API Key 已生成，请妥善保管（明文仅展示一次）' };
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  async mine(@Req() req: any) {
    return { keys: await this.svc.listByOwner(req.user.id) };
  }

  @Delete('mine/:id')
  @UseGuards(AuthGuard)
  async revokeMine(@Req() req: any, @Param('id') id: string) {
    await this.svc.revokeByOwner(Number(id), req.user.id);
    return { id: Number(id), message: '已吊销' };
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
