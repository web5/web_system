/**
 * 邮箱验证码（内部端点）
 *
 * 供 auth-service 在 bind-email 时核销验证码（验证码表与邮件通道都在 user-service）。
 * 路径前缀 internal/users，网关不映射，仅服务间直连；鉴权复用 InternalGuard（x-internal-key）。
 */
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { EmailService } from './email.service';
import { InternalGuard } from '../api-key/internal.guard';

@Controller('internal/users/email')
@UseGuards(InternalGuard)
export class InternalEmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('verify')
  async verify(@Body() dto: { email?: string; code?: string; userId?: number }) {
    return this.emailService.verify(dto?.email || '', dto?.code || '', dto?.userId);
  }
}
