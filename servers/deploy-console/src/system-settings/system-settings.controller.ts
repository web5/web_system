import { Controller, Get, Put, Body, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemSettingsService } from './system-settings.service';
import { CurrentUser } from '../common/decorators';

/**
 * 系统设置（仅控制台 JWT 可写）。
 *
 * 当前只有通知渠道配置；后续审批开关等系统级配置都收在这里。
 * 渠道 URL 非机密信息，允许回显；未来若加入机密类设置，须在返回前掩码。
 */
@ApiTags('系统设置')
@ApiBearerAuth()
@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Get('notify-channels')
  @ApiOperation({ summary: '通知渠道配置（DB 优先，env 兜底）' })
  async notifyChannels() {
    const c = await this.settings.notifyChannels((k) => process.env[k]);
    return { webhookUrl: c.webhook, wecomUrl: c.wecom };
  }

  @Put('notify-channels')
  @ApiOperation({ summary: '更新通知渠道（空串=关闭该通道）' })
  async updateNotifyChannels(
    @Body() body: { webhookUrl?: string | null; wecomUrl?: string | null },
    @CurrentUser() user: any,
  ) {
    if (!body || (body.webhookUrl === undefined && body.wecomUrl === undefined)) {
      throw new BadRequestException('缺少要保存的渠道配置');
    }
    await this.settings.setNotifyChannels(
      {
        webhook: body.webhookUrl === undefined ? undefined : (body.webhookUrl ?? ''),
        wecom: body.wecomUrl === undefined ? undefined : (body.wecomUrl ?? ''),
      },
      user?.username,
    );
    return { ok: true };
  }
}
