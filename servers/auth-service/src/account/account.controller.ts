/**
 * 账号绑定：手机号（微信一键获取）与邮箱（验证码）
 *
 * 认证沿用 auth.controller 的口径：手写解析 Authorization 后走 AuthService.verifyToken，
 * 因此天然带黑名单校验（已登出的 token 不能绑定）。
 *
 * 冲突语义（Q15 = c 合并账号）：
 * - 命中已有账号 → 409，body 带 { conflict: true, canMerge, maskedValue, hint }
 * - 前端二次确认后带 confirmMerge=true 重发 → 走合并，返回新凭证（sub = 目标账号）
 */
import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AccountService } from './account.service';

@ApiTags('账号')
@Controller('auth')
export class AccountController {
  private readonly logger = new Logger(AccountController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly accountService: AccountService,
  ) {}

  @Post('bind-phone')
  @ApiBearerAuth()
  @ApiOperation({ summary: '绑定手机号（微信手机号快速验证）' })
  @HttpCode(HttpStatus.OK)
  async bindPhone(
    @Headers('authorization') auth: string,
    @Body() body: { code?: string; channel?: string; confirmMerge?: boolean },
  ) {
    const user = await this.currentUser(auth);
    // channel 预留：一期仅 wechat（短信为二期兜底，见方案 §5.0）
    if (body?.channel && body.channel !== 'wechat') {
      throw new BadRequestException('暂不支持该绑定方式');
    }
    const result = await this.accountService.bindPhone(user.id, body?.code, !!body?.confirmMerge);
    if (result.conflict) {
      throw new ConflictException(result);
    }
    await this.accountService.clearPending(user.id);
    return result;
  }

  @Post('bind-email')
  @ApiBearerAuth()
  @ApiOperation({ summary: '绑定邮箱（邮箱验证码）' })
  @HttpCode(HttpStatus.OK)
  async bindEmail(
    @Headers('authorization') auth: string,
    @Body() body: { email?: string; code?: string; confirmMerge?: boolean },
  ) {
    const user = await this.currentUser(auth);
    const result = await this.accountService.bindEmail(
      user.id,
      body?.email || '',
      body?.code || '',
      !!body?.confirmMerge,
    );
    if (result.conflict) {
      throw new ConflictException(result);
    }
    await this.accountService.clearPending(user.id);
    return result;
  }

  private async currentUser(auth: string): Promise<{ id: number }> {
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('缺少 Authorization 头');
    const user = await this.authService.verifyToken(token);
    return { id: user.id };
  }
}
