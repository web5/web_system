import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { UpdateSettingsDto } from './update-settings.dto';
import { Public, RequirePermission } from '../auth/decorators';

@ApiTags('系统设置')
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly logsService: OperationLogsService,
  ) {}

  @Get()
  @RequirePermission('settings:view')
  @ApiOperation({ summary: '获取全部系统配置' })
  async getAll() {
    return { code: 0, data: await this.settingsService.getAll() };
  }

  // 公开配置项：前端未登录时也会读取（如登录页展示的平台名），豁免鉴权
  @Public()
  @Get('public/:key')
  @ApiOperation({ summary: '获取公开配置项' })
  async getPublic(@Param('key') key: string) {
    return {
      code: 0,
      data: await this.settingsService.get(key),
    };
  }

  @Put()
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: '批量更新系统配置' })
  async update(@Body() data: UpdateSettingsDto) {
    // 过滤掉非 string 值，防止嵌套对象/数组注入
    const safeData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string' || typeof key !== 'string') {
        continue;
      }
      safeData[key] = value;
    }

    await this.settingsService.batchSet(safeData);
    await this.logsService.log({
      operator: 'admin',
      type: 'update_setting',
      target: `批量更新 ${Object.keys(safeData).length} 项配置`,
      ip: '0.0.0.0',
    });
    return { code: 0, message: '保存成功' };
  }
}
