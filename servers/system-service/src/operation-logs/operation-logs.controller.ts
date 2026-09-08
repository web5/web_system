import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OperationLogsService } from './operation-logs.service';
import { RequirePermission } from '../auth/decorators';

@ApiTags('操作日志')
@Controller('admin/logs')
export class OperationLogsController {
  constructor(private readonly logsService: OperationLogsService) {}

  @Get()
  @RequirePermission('logs:view')
  @ApiOperation({ summary: '查询操作日志（支持分页和多条件筛选）' })
  async query(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('operator') operator?: string,
    @Query('type') type?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    return this.logsService.query({ page, pageSize, operator, type, startTime, endTime });
  }
}
