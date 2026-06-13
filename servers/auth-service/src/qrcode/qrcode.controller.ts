import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { QrcodeService } from './qrcode.service';

@ApiTags('扫码登录')
@Controller('auth/qrcode')
export class QrcodeController {
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
}
