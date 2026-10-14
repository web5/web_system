import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FactCollectService, FactBatchReport } from './fact-collect.service';
import { FactWatchService } from './fact-watch.service';
import { FactQueryDto, FactCollectDto } from './dto/fact-query.dto';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

/**
 * 环境事实巡检（Fact 层 v1）。
 *
 * 只读为主：快照 / 漂移查询都不写业务数据；`POST /collect` 是运维动作，
 * 只写事实表 + 审计，**不改任何发布状态**。
 */
@ApiTags('环境事实巡检')
@ApiBearerAuth()
@Controller('fact')
export class FactController {
  constructor(
    private readonly collect: FactCollectService,
    private readonly watch: FactWatchService,
    private readonly auditService: AuditService,
  ) {}

  /** 允许采集的环境（默认 dev）：页面/排障先确认"哪些环境在采" */
  @Get('envs')
  @ApiOperation({ summary: '事实巡检覆盖的环境' })
  envs() {
    return { envs: this.collect.allowedEnvs() };
  }

  @Get('snapshots')
  @ApiOperation({ summary: '最近事实快照（版本 / 目录 / 进程 / 端口）' })
  snapshots(@Query() q: FactQueryDto) {
    const env = q.env || this.collect.allowedEnvs()[0] || 'dev';
    return this.collect.snapshots(env, q.kind, q.limit);
  }

  @Get('drift')
  @ApiOperation({ summary: '最近一批的漂移清单（期望 ≠ 线上实际）' })
  drift(@Query() q: FactQueryDto) {
    const env = q.env || this.collect.allowedEnvs()[0] || 'dev';
    return this.collect.drift(env);
  }

  /** 手动触发一次采集（env 为空 = 对所有允许的环境各采一次） */
  @Post('collect')
  @ApiOperation({ summary: '手动触发事实采集' })
  async runCollect(@Body() body: FactCollectDto, @CurrentUser() user: any) {
    const envs = body.env ? [body.env] : this.collect.allowedEnvs();
    const reports: (FactBatchReport | { env: string; status: string; reason: string })[] = [];
    for (const env of envs) {
      // 单个环境失败（如主机未登记）不应吞掉其余环境的结果
      try {
        reports.push(await this.collect.collect(env, 'manual'));
      } catch (e) {
        reports.push({ env, status: 'error', reason: (e as Error).message });
      }
    }
    await this.auditService.log({
      user: user?.username || user?.id || 'unknown',
      action: 'fact.collect',
      env: envs.join(','),
      component: 'fact',
      status: reports.some((r) => r.status === 'error') ? 'failed' : 'success',
      detail: `手动触发事实采集：${reports
        .map((r) => {
          const bid = 'batchId' in r ? r.batchId.slice(0, 8) : '';
          return `${r.env ?? '?'}=${r.status}${bid ? `(${bid})` : ''}`;
        })
        .join('; ')}`,
    });
    return { reports };
  }

  /** 最近一次定时采集的结论（排查"为什么没采"用） */
  @Get('last')
  @ApiOperation({ summary: '最近一次定时采集的结论' })
  last() {
    return { reports: this.watch.lastReports() };
  }
}
