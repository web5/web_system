/**
 * 邮箱验证码（对外）
 *
 * - POST /api/users/email/code：发送验证码（需登录），限频与 503 由 EmailService 处理
 * - 绑定落库与账号合并不在这里：统一由 auth-service 的 /api/auth/bind-email 处理
 *   （合并只有一套，避免为邮箱写第二份）
 */
import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
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
}
