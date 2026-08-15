import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';

/**
 * 审计日志控制器
 * 提供审计日志的分页查询
 */
@ApiTags('审计日志')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * 分页查询审计日志
   */
  @Get('list')
  @ApiOperation({ summary: '分页查询审计日志' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码，默认 1' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '每页条数，默认 20' })
  @ApiResponse({ status: 200, description: '返回审计日志列表' })
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.auditService.list(page, limit);
  }
}
