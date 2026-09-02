import { Controller, Get, Put, Body, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemSettingsService } from './system-settings.service';
import { REQUIRE_APPROVAL_ENVS_KEY } from '../approval/approval.service';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

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
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly auditService: AuditService,
  ) {}

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
    const before = await this.settings.notifyChannels(() => undefined);
    await this.settings.setNotifyChannels(
      {
        webhook: body.webhookUrl === undefined ? undefined : (body.webhookUrl ?? ''),
        wecom: body.wecomUrl === undefined ? undefined : (body.wecomUrl ?? ''),
      },
      user?.username,
    );
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'system-settings.notify_channels',
      status: 'success',
      detail: '更新通知渠道配置',
      changes: [
        { field: 'webhookUrl', before: before.webhook, after: body.webhookUrl ?? '' },
        { field: 'wecomUrl', before: before.wecom, after: body.wecomUrl ?? '' },
      ],
    });
    return { ok: true };
  }

  @Get('approval-envs')
  @ApiOperation({ summary: '需要审批的环境列表（逗号分隔；默认 prod）' })
  async approvalEnvs() {
    const v = await this.settings.get(REQUIRE_APPROVAL_ENVS_KEY);
    return { envs: v || 'prod' };
  }

  @Put('approval-envs')
  @ApiOperation({ summary: '更新需审批的环境列表（逗号分隔；清空回落默认 prod）' })
  async updateApprovalEnvs(
    @Body() body: { envs?: string },
    @CurrentUser() user: any,
  ) {
    if (!body || body.envs === undefined) {
      throw new BadRequestException('缺少 envs 参数');
    }
    const value = body.envs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(',');
    const before = await this.settings.get(REQUIRE_APPROVAL_ENVS_KEY);
    await this.settings.set(REQUIRE_APPROVAL_ENVS_KEY, value, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'system-settings.approval_envs',
      status: 'success',
      detail: '更新审批门禁环境',
      changes: [
        { field: 'approvalEnvs', before: before || 'prod', after: value || 'prod' },
      ],
    });
    return { ok: true, envs: value || 'prod' };
  }
}
