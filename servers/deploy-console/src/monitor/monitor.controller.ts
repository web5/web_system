import { Controller, Get, Post, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MonitorService } from './monitor.service';
import { LogsQueryDto } from './dto/logs-query.dto';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

/** service 名直接参与 shell 命令拼接，必须白名单（与 LogsQueryDto 一致） */
const SERVICE_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * 服务监控与自助诊断控制器（任务 23：端口检测 / 进程重启 / 日志检索全部页面化，无需 SSH）。
 * 读取类不写库；重启属运维操作，一律留审计。
 */
@ApiTags('服务监控与诊断')
@ApiBearerAuth()
@Controller('monitor')
export class MonitorController {
  constructor(
    private readonly monitorService: MonitorService,
    private readonly auditService: AuditService,
  ) {}

  private assertServiceName(service: string | undefined): void {
    if (!service || !SERVICE_RE.test(service)) {
      throw new BadRequestException('service 仅允许字母、数字、下划线和连字符');
    }
  }

  private assertPort(port: string | undefined): number {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      throw new BadRequestException('port 必须是 1-65535 的整数');
    }
    return p;
  }

  /**
   * 各服务端口健康检查
   */
  @Get('health')
  @ApiOperation({ summary: '服务健康检查' })
  healthCheck(@Query('env') env: string) {
    return this.monitorService.healthCheck(env);
  }

  /**
   * 获取远程 PM2 进程列表
   */
  @Get('pm2')
  @ApiOperation({ summary: '获取 PM2 进程列表' })
  getPm2List(@Query('env') env: string) {
    return this.monitorService.getPm2List(env);
  }

  /**
   * 拉取远程服务日志（支持 keyword 在结果侧过滤，不进命令）
   */
  @Get('logs')
  @ApiOperation({ summary: '拉取服务日志（可选关键词过滤）' })
  getLogs(
    @Query('env') env: string,
    @Query() query: LogsQueryDto,
    @Query('keyword') keyword?: string,
  ) {
    return this.monitorService.getLogs(env, query.service, query.lines ?? 100, keyword);
  }

  /**
   * 重启远程服务（pm2 restart，写操作留审计）
   */
  @Post('pm2/restart')
  @ApiOperation({ summary: '重启远程服务（pm2 restart）' })
  async restart(
    @Query('env') env: string,
    @Query('service') service: string,
    @CurrentUser() user: any,
  ) {
    this.assertServiceName(service);
    const r = await this.monitorService.restartPm2(env, service);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'monitor.restart',
      env,
      component: service,
      status: 'success',
      detail: `重启远程服务: ${env}/${service}`,
    });
    return r;
  }

  /**
   * 远程端口占用检测（lsof LISTEN）
   */
  @Get('port')
  @ApiOperation({ summary: '检测端口占用（lsof LISTEN）' })
  checkPort(@Query('env') env: string, @Query('port') port: string) {
    return this.monitorService.checkPort(env, this.assertPort(port));
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
   * 拉取本机服务日志（支持 keyword 过滤）
   */
  @Get('local/logs')
  @ApiOperation({ summary: '拉取本机服务日志（可选关键词过滤）' })
  getLocalLogs(@Query() query: LogsQueryDto, @Query('keyword') keyword?: string) {
    return this.monitorService.getLocalLogs(query.service, query.lines ?? 100, keyword);
  }

  /**
   * 重启本机服务（pm2 restart，写操作留审计）
   */
  @Post('local/pm2/restart')
  @ApiOperation({ summary: '重启本机服务（pm2 restart）' })
  async restartLocal(
    @Query('service') service: string,
    @CurrentUser() user: any,
  ) {
    this.assertServiceName(service);
    const r = this.monitorService.restartLocalPm2(service);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'monitor.restart',
      env: 'local',
      component: service,
      status: 'success',
      detail: `重启本机服务: ${service}`,
    });
    return r;
  }

  /**
   * 本机端口占用检测（lsof LISTEN）
   */
  @Get('local/port')
  @ApiOperation({ summary: '检测本机端口占用（lsof LISTEN）' })
  checkLocalPort(@Query('port') port: string) {
    return this.monitorService.checkLocalPort(this.assertPort(port));
  }
}
