import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { AuthGuard } from '../auth/auth.guard';

/**
 * API Key 管理
 * 公开：POST /api/keys/apply（发码）、POST /api/keys/verify（验码签发）
 * 用户中心：GET /api/keys/mine、DELETE /api/keys/mine/:id（需登录）
 * 运营：GET /api/keys、DELETE /api/keys/:id（需登录且角色含 admin）
 */
@Controller('keys')
export class ApiKeyController {
  constructor(private readonly svc: ApiKeyService) {}

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

  /** 校验当前登录用户是否具备 admin 角色 */
  private requireAdminRole(user: any): void {
    const roles: string[] = Array.isArray(user?.roles)
      ? user.roles
      : typeof user?.roles === 'string'
        ? user.roles.split(',').map((r: string) => r.trim())
        : [];
    if (!roles.includes('admin')) {
      throw new UnauthorizedException('需要管理员角色');
    }
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(@Req() req: any) {
    this.requireAdminRole(req.user);
    return { keys: await this.svc.list() };
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async revoke(@Req() req: any, @Param('id') id: string) {
    this.requireAdminRole(req.user);
    await this.svc.revoke(Number(id));
    return { id: Number(id), message: '已吊销' };
  }
}
