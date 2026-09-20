import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EnvsService } from './envs.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';
import { CreateEnvDto, EnvSwitchLogDto, UpdateEnvDto, UpdateServiceRouteDto } from './dto';

/**
 * 微前端 · 环境域接口
 *
 * 路由：
 * - `GET  /api/envs/sites`                              站点列表
 * - `GET  /api/envs?siteKey=&q=&page=&pageSize=`        环境列表（搜索 + 分页）
 * - `POST /api/envs`                                    新建环境（envId 系统自增）
 * - `GET  /api/envs/:envId`                             环境详情
 * - `PUT  /api/envs/:envId`                             更新（名称/排序/启用）
 * - `DELETE /api/envs/:envId`                           删除（占用则阻断）
 * - `GET  /api/envs/:envId/service-routes`              该环境的后端服务指向
 * - `PUT  /api/envs/:envId/service-routes/:serviceKey`  改某服务的指向（主机必填）
 * - `POST /api/envs/switch-log`                         环境切换审计上报（Q110）
 */
@ApiTags('微前端 · 环境')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('envs')
export class EnvsController {
  constructor(
    private readonly envsService: EnvsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('sites')
  @ApiOperation({ summary: '站点列表（local/dev/prod）' })
  listSites() {
    return this.envsService.listSites();
  }

  @Get()
  @ApiOperation({ summary: '环境列表（站点筛选 + 关键字搜索 + 分页）' })
  list(
    @Query('siteKey') siteKey?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.envsService.listEnvs({
      siteKey,
      q,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('resolve')
  @ApiOperation({ summary: '运行时解析 envId（找不到回退 dev，供 gateway/shell 内部使用）' })
  resolve(@Query('envId') envId?: string) {
    return this.envsService.resolveEnvId(envId).then((resolved) => ({ envId: resolved }));
  }

  @Post()
  @ApiOperation({ summary: '新建环境（envId 由系统自增，用户只填名称 + 站点）' })
  async create(@Body() dto: CreateEnvDto, @CurrentUser() user: any) {
    const env = await this.envsService.createEnv(dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.create',
      env: env.envId,
      component: env.siteKey,
      status: 'success',
      detail: `新建环境 envId=${env.envId}(${env.name}) site=${env.siteKey}`,
    });
    return env;
  }

  @Post('switch-log')
  @ApiOperation({ summary: '环境切换审计上报（不阻断切换，失败可忽略）' })
  async switchLog(@Body() dto: EnvSwitchLogDto, @CurrentUser() user: any) {
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.switch',
      env: dto.envId,
      component: dto.siteKey || '-',
      status: 'success',
      detail: `切换加载环境到 ${dto.envId}`,
    });
    return { ok: true };
  }

  @Get(':envId/service-routes')
  @ApiOperation({ summary: '该环境的后端服务指向（含未配置项占位）' })
  listServiceRoutes(@Param('envId') envId: string) {
    return this.envsService.listServiceRoutes(envId);
  }

  @Put(':envId/service-routes/:serviceKey')
  @ApiOperation({ summary: '更新某服务在该环境的指向（主机必填）' })
  async updateServiceRoute(
    @Param('envId') envId: string,
    @Param('serviceKey') serviceKey: string,
    @Body() dto: UpdateServiceRouteDto,
    @CurrentUser() user: any,
  ) {
    const row = await this.envsService.updateServiceRoute(envId, serviceKey, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.service-route.update',
      env: envId,
      component: serviceKey,
      status: 'success',
      detail: `指向改为 ${row.hostName}:${row.port ?? '-'}${row.upstreamUrl ? ` (${row.upstreamUrl})` : ''}`,
    });
    return row;
  }

  @Get(':envId')
  @ApiOperation({ summary: '环境详情' })
  get(@Param('envId') envId: string) {
    return this.envsService.getEnv(envId);
  }

  @Put(':envId')
  @ApiOperation({ summary: '更新环境（名称 / 排序 / 启用；envId 与站点不可改）' })
  async update(@Param('envId') envId: string, @Body() dto: UpdateEnvDto, @CurrentUser() user: any) {
    const env = await this.envsService.updateEnv(envId, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.update',
      env: envId,
      component: env.siteKey,
      status: 'success',
      detail: `更新环境 ${envId}: ${JSON.stringify(dto)}`,
    });
    return env;
  }

  @Delete(':envId')
  @ApiOperation({ summary: '删除环境（内置不可删；有部署记录时阻断并列出占用者）' })
  async remove(@Param('envId') envId: string, @CurrentUser() user: any) {
    const res = await this.envsService.removeEnv(envId);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.delete',
      env: envId,
      component: '-',
      status: 'success',
      detail: `删除环境 ${envId}`,
    });
    return res;
  }
}
