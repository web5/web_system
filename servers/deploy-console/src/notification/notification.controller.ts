import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from './notification.service';

/**
 * 通知中心（仅控制台 JWT 可访问）。
 * 通道配置通过服务端环境变量（NOTIFY_WEBHOOK_URL / NOTIFY_WECOM_URL）管理，
 * 不暴露写入接口——避免被改造成钓鱼/滥用通道。
 */
@ApiTags('通知')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('channels')
  @ApiOperation({ summary: '通道配置状态（确认是否已接通）' })
  channels() {
    return this.notifications.channels();
  }

  @Get()
  @ApiOperation({ summary: '通知历史（站内）' })
  list(@Query('limit') limit?: string) {
    if (limit !== undefined && !Number.isFinite(Number(limit))) {
      throw new BadRequestException('limit 必须是数字');
    }
    return this.notifications.list(limit ? Number(limit) : undefined);
  }
}
