import { Controller, Get, Query } from '@nestjs/common';
import { OperationLogsService } from './operation-logs.service';

@Controller('admin/logs')
export class OperationLogsController {
  constructor(private readonly logsService: OperationLogsService) {}

  @Get()
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
