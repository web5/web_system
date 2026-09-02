import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MetricsService, MetricsQuery } from './metrics.service';

/** 字符串参数转数字；非法值直接 400，不让 NaN 流进 SQL */
function toNumber(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequestException(`${name} 必须是数字`);
  return n;
}

/**
 * 发布度量（仅控制台 JWT 可访问）。
 *
 * 数据全部来自 `deploy_pipelines` 的聚合——流水线本身已完整记录
 * status / stage / 起止时间，不需要额外埋点。
 */
@ApiTags('发布度量')
@ApiBearerAuth()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  private buildQuery(
    env?: string,
    moduleKey?: string,
    from?: string,
    to?: string,
  ): MetricsQuery {
    const f = toNumber(from, 'from');
    const t = toNumber(to, 'to');
    if (f !== undefined && t !== undefined && f > t) {
      throw new BadRequestException('from 不能大于 to');
    }
    return { env, moduleKey, from: f, to: t };
  }

  @Get('releases/overview')
  @ApiOperation({ summary: '发布概览：成功率、平均/P95 时长' })
  overview(
    @Query('env') env?: string,
    @Query('moduleKey') moduleKey?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.metrics.overview(this.buildQuery(env, moduleKey, from, to));
  }

  @Get('releases/trend')
  @ApiOperation({ summary: '按天发布趋势（成功 / 失败）' })
  trend(
    @Query('env') env?: string,
    @Query('moduleKey') moduleKey?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.metrics.trend(this.buildQuery(env, moduleKey, from, to));
  }

  @Get('releases/stage-failures')
  @ApiOperation({ summary: '失败阶段分布（定位问题最重要的视角）' })
  stageFailures(
    @Query('env') env?: string,
    @Query('moduleKey') moduleKey?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.metrics.stageFailures(this.buildQuery(env, moduleKey, from, to));
  }

  @Get('releases/top-modules')
  @ApiOperation({ summary: '发布频次 Top N' })
  topModules(
    @Query('env') env?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const l = toNumber(limit, 'limit');
    return this.metrics.topModules(this.buildQuery(env, undefined, from, to), l);
  }

  @Get('releases/failures')
  @ApiOperation({ summary: '失败下钻：具体哪几次失败、错误是什么' })
  failures(
    @Query('env') env?: string,
    @Query('moduleKey') moduleKey?: string,
    @Query('stage') stage?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const l = toNumber(limit, 'limit');
    return this.metrics.failures(
      { ...this.buildQuery(env, moduleKey, from, to), stage },
      l,
    );
  }
}
