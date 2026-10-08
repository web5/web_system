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
  BadRequestException,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { AuthGuard } from '../auth/auth.guard';

/**
 * API Key 管理
 * 公开：POST /api/keys/apply（发码）、POST /api/keys/verify（验码签发）
 * 用户中心：GET /api/keys/mine、DELETE /api/keys/mine/:id（需登录）
 * 运营：GET /api/keys、DELETE /api/keys/:id、POST /api/keys/admin（需登录且角色含 admin）
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

  /**
   * 运营：直接签发（免邮件验证码），用于自动化 / 运维场景发放专属凭据。
   * 默认把 key 绑定到**操作者本人**（ownerId = 当前 admin 的 id），
   * 使 MCP 通道的审计日志能追溯到人 —— 不做匿名凭据。
   */
  @Post('admin')
  @UseGuards(AuthGuard)
  async adminCreate(
    @Req() req: any,
    @Body() dto: { email?: string; ownerId?: number; name?: string },
  ) {
    this.requireAdminRole(req.user);
    const ownerId = dto?.ownerId ?? req.user?.id ?? null;
    // 显式指定 ownerId 时允许留空 email —— 由 service 从 owner 回填，
    // 避免出现「email 是 A 的、ownerId 是 B 的」这种归属不一致的 key。
    const email =
      dto?.email ?? (dto?.ownerId != null ? undefined : req.user?.email);
    if (!email && dto?.ownerId == null) {
      throw new BadRequestException('缺少邮箱（可显式传 email 或 ownerId）');
    }
    const { plaintext, prefix } = await this.svc.adminCreate(email, dto?.name, ownerId);
    return {
      key: plaintext,
      prefix,
      ownerId,
      message: 'API Key 已生成（admin），请妥善保管（明文仅展示一次）',
    };
  }
}
