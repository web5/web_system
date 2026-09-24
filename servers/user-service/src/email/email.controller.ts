/**
 * 邮箱验证码（对外）
 *
 * - POST /api/users/email/code：发送验证码（需登录），限频与 503 由 EmailService 处理
 * - POST /api/users/email/test：发送测试邮件（需登录 + 管理员），供 admin「系统设置 → 通知设置」验证配置
 * - 绑定落库与账号合并不在这里：统一由 auth-service 的 /api/auth/bind-email 处理
 *   （合并只有一套，避免为邮箱写第二份）
 */
import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { EmailService } from './email.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('users/email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('code')
  @UseGuards(AuthGuard)
  async sendCode(@Req() req: any, @Body() dto: { email?: string; purpose?: string }) {
    return this.emailService.sendCode(dto?.email || '', req?.user?.id ?? null, dto?.purpose || 'bind');
  }

  /** 测试邮件：先保存再测，服务端会强制重读配置（避免命中缓存测到旧值） */
  @Post('test')
  @UseGuards(AuthGuard)
  async sendTest(@Req() req: any, @Body() dto: { to?: string }) {
    this.requireAdmin(req?.user);
    const to = String(dto?.to || '').trim() || String(req?.user?.email || '');
    if (!to) throw new BadRequestException('请填写收件邮箱');
    return this.emailService.sendTestMail(to);
  }

  private requireAdmin(user: any): void {
    const roles: string[] = Array.isArray(user?.roles)
      ? user.roles
      : typeof user?.roles === 'string'
        ? user.roles.split(',').map((r: string) => r.trim())
        : [];
    if (!roles.includes('admin')) {
      throw new UnauthorizedException('需要管理员角色');
    }
  }
}
