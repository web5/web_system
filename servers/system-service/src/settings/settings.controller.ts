import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';

@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly logsService: OperationLogsService,
  ) {}

  @Get()
  async getAll() {
    return { code: 0, data: await this.settingsService.getAll() };
  }

  @Get('public/:key')
  async getPublic(@Param('key') key: string) {
    return {
      code: 0,
      data: await this.settingsService.get(key),
    };
  }

  @Put()
  async update(@Body() data: Record<string, string>) {
    await this.settingsService.batchSet(data);
    await this.logsService.log({
      operator: 'admin',
      type: 'update_setting',
      target: `批量更新 ${Object.keys(data).length} 项配置`,
      ip: '0.0.0.0',
    });
    return { code: 0, message: '保存成功' };
  }
}
