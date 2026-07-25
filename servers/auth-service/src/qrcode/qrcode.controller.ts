import { Controller, Post, Get, Body, Query, Res, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { QrcodeService } from './qrcode.service';

@ApiTags('扫码登录')
@Controller('auth/qrcode')
export class QrcodeController {
  private readonly logger = new Logger(QrcodeController.name);
  constructor(private qrcodeService: QrcodeService) {}

  @Post('create')
  @ApiOperation({ summary: '创建扫码登录 ticket' })
  @HttpCode(HttpStatus.OK)
  createTicket() {
    return this.qrcodeService.createTicket();
  }

  @Get('check')
  @ApiOperation({ summary: '轮询检查 ticket 状态' })
  @HttpCode(HttpStatus.OK)
  checkTicket(@Query('ticket') ticket: string) {
    return this.qrcodeService.checkTicket(ticket);
  }

  @Post('confirm')
  @ApiOperation({ summary: '小程序扫码确认' })
  @HttpCode(HttpStatus.OK)
  async confirmScan(
    @Body('ticket') ticket: string,
    @Body('code') code: string,
  ) {
    return this.qrcodeService.confirmScan(ticket, code);
  }

  @Get('scan')
  @ApiOperation({ summary: '扫码重定向——微信扫码后跳转 OAuth 授权' })
  scanQrcode(
    @Query('ticket') ticket: string,
    @Query('redirect') redirect: string,
    @Res() res: Response,
  ) {
    if (!ticket) {
      return res.redirect('/login?error=invalid_ticket');
    }

    // 验证 ticket 是否存在且有效
    const ticketData = this.qrcodeService.getTicket(ticket);
    if (!ticketData) {
      return res.redirect('/login?error=ticket_expired');
    }

    // 确定前端回调地址（优先使用 redirect 参数，否则默认登录页）
    const frontendUrl = redirect || 'http://localhost:5173/login';

    // 构建 OAuth 授权 URL（ticket 编码在 state 中）
    const oauthUrl = this.qrcodeService.buildScanOAuthUrl(ticket, frontendUrl);

    this.logger.log(`QR scan redirect: ticket=${ticket}, redirect=${oauthUrl}`);
    return res.redirect(oauthUrl);
  }

  @Get('oauth-url')
  @ApiOperation({ summary: '获取扫码 URL（用于二维码内容）' })
  getOAuthUrl(
    @Query('ticket') ticket: string,
    @Query('redirect') redirect: string,
  ) {
    // 个人订阅号不支持网页授权，直接使用应用内链接
    // 微信扫码后打开此链接 → 前端检测到 ticket → 轮询等待小程序扫码确认
    const frontendUrl = redirect || 'http://localhost:5173/login';
    const scanUrl = `${frontendUrl}?qrcode_ticket=${ticket}`;
    return { oauthUrl: scanUrl };
  }
}
