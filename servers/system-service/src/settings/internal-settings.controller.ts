import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { Public } from '../auth/decorators';
import { InternalGuard } from '../auth/internal.guard';

/** 公网根地址的系统配置键（唯一权威源；三服务据此拼头像完整 URL） */
const PUBLIC_BASE_URL_KEY = 'public_base_url';

/**
 * 设置消费接口（服务间调用）。
 *
 * 与 `/admin/settings` 的区别：只暴露**白名单内**的固定键（当前仅 `public_base_url`），
 * 不做通用 `?key=` 查询 —— 对齐 `internal-storage` 的白名单纪律，避免把 `system_configs`
 * 配置表整体暴露成内部 API（表里还有审批环境、各类开关等平台配置）。
 * 鉴权走 `x-internal-key: INTERNAL_API_KEY`（@Public 跳过全局 JWT）。
 * 消费方（auth / user / upload 的 PublicBaseUrlService）必须做回落：DB 配置 → env 兜底。
 */
@ApiTags('设置（内部）')
@Controller('internal/settings')
@Public()
@UseGuards(InternalGuard)
export class InternalSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public-base-url')
  @ApiOperation({ summary: '读取公网根地址（服务间消费，白名单固定键）' })
  async getPublicBaseUrl() {
    const v = await this.settingsService.get(PUBLIC_BASE_URL_KEY);
    return { code: 0, data: v ?? '' };
  }
}
