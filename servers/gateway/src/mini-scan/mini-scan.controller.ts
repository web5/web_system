import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * 微信扫码登录重定向处理
 * 用户用微信"扫一扫"扫描登录 QR 码后，此 URL 在微信内置浏览器中打开，
 * 重定向到微信 OAuth 授权页面完成登录确认
 */
@SkipThrottle()
@ApiExcludeController()
@Controller()
export class MiniScanController {
  @Get('mini-scan')
  redirect(@Query('ticket') ticket: string, @Res() res: Response) {
    if (!ticket) {
      return res.redirect('/');
    }
    const redirectUrl = `/api/auth/wechat/authorize?redirect=${encodeURIComponent('/?mini_scan_ticket=' + ticket)}`;
    return res.redirect(redirectUrl);
  }
}
