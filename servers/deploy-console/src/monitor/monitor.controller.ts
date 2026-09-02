import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MonitorService } from './monitor.service';
import { LogsQueryDto } from './dto/logs-query.dto';

/**
 * 服务监控控制器
 * 提供健康检查、PM2 进程列表和日志拉取
 */
@ApiTags('服务监控')
@ApiBearerAuth()
@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  /**
   * 各服务端口健康检查
   */
  @Get('health')
  @ApiOperation({ summary: '服务健康检查' })
  @ApiQuery({ name: 'env', required: true, type: String, description: '环境: dev/prod' })
  @ApiResponse({ status: 200, description: '返回各服务健康状态' })
  healthCheck(@Query('env') env: string) {
    return this.monitorService.healthCheck(env);
  }

  /**
   * 获取远程 PM2 进程列表
   */
  @Get('pm2')
  @ApiOperation({ summary: '获取 PM2 进程列表' })
  @ApiQuery({ name: 'env', required: true, type: String, description: '环境: dev/prod' })
  @ApiResponse({ status: 200, description: '返回 PM2 进程列表' })
  getPm2List(@Query('env') env: string) {
    return this.monitorService.getPm2List(env);
  }

  /**
   * 拉取远程 PM2 日志
   */
  @Get('logs')
  @ApiOperation({ summary: '拉取服务日志' })
  @ApiQuery({ name: 'env', required: true, type: String, description: '环境: dev/prod' })
  @ApiQuery({ name: 'service', required: true, type: String, description: '服务名称（仅字母/数字/下划线/连字符）' })
  @ApiQuery({ name: 'lines', required: false, type: Number, description: '日志行数，默认 100' })
  @ApiResponse({ status: 200, description: '返回日志内容' })
  getLogs(@Query('env') env: string, @Query() query: LogsQueryDto) {
    return this.monitorService.getLogs(env, query.service, query.lines ?? 100);
  }

  /**
   * 获取本机 PM2 进程列表（不走 SSH）
   */
  @Get('local/pm2')
  @ApiOperation({ summary: '获取本机 PM2 进程列表' })
  getLocalPm2List() {
    return this.monitorService.getLocalPm2List();
  }

  /**
   * 本机服务健康检查
   */
  @Get('local/health')
  @ApiOperation({ summary: '本机服务健康检查' })
  getLocalHealth() {
    return this.monitorService.getLocalHealth();
  }

  /**
   * 拉取本机 PM2 日志
   */
  @Get('local/logs')
  @ApiOperation({ summary: '拉取本机服务日志' })
  @ApiQuery({ name: 'service', required: true, type: String, description: '服务名称（仅字母/数字/下划线/连字符）' })
  @ApiQuery({ name: 'lines', required: false, type: Number, description: '日志行数，默认 100' })
  getLocalLogs(@Query() query: LogsQueryDto) {
    return this.monitorService.getLocalLogs(query.service, query.lines ?? 100);
  }
}
