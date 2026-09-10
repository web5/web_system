import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OperationLogsService } from './operation-logs.service';
import { Public } from '../auth/decorators';
import { InternalGuard } from '../auth/internal.guard';

/** 写入参数（长度在落库前收敛，避免超长字段写失败） */
interface WriteLogDto {
  operator?: string;
  type: string;
  target?: string;
  ip?: string;
}

/**
 * 操作日志内部写入接口（服务间调用，`x-internal-key: INTERNAL_API_KEY`）。
 *
 * 为什么需要：动作可能发生在别的服务（如 user-service 的权限同步、发布流水线的自动同步），
 * 而审计表 `operation_logs` 由本服务维护。有了这个接口，各服务不必直连本服务数据库，
 * 审计统一汇聚到 admin「操作日志」页。
 */
@ApiTags('操作日志（内部）')
@Controller('internal/logs')
@Public()
@UseGuards(InternalGuard)
export class InternalLogsController {
  constructor(private readonly logsService: OperationLogsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: '写入一条操作日志（服务间审计）' })
  async write(@Body() dto: WriteLogDto) {
    const entry = await this.logsService.log({
      operator: (dto.operator || 'internal').slice(0, 64),
      type: (dto.type || 'unknown').slice(0, 32),
      target: dto.target?.slice(0, 255),
      ip: dto.ip?.slice(0, 64),
    });
    return { code: 0, data: { id: entry.id } };
  }
}
