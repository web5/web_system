import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ServicesService } from './services.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';
import {
  CreateServiceDto,
  DeployServiceDto,
  EndpointDto,
  ImportEndpointsDto,
  ProbeHealthDto,
  ServiceRouteDto,
  UpdateServiceDto,
} from './dto';

/**
 * API 网关域接口
 *
 * - `GET/POST   /api/services`                        列表 / 新建（key 唯一且不可改）
 * - `GET/PUT/DELETE /api/services/:key`               详情 / 更新 / 软删（被环境指向时阻断）
 * - `GET/POST   /api/services/:key/routes`            转发规则（前缀级，冲突阻断 + 前缀包含告警）
 * - `PUT/DELETE /api/services/:key/routes/:id`        改 / 删转发规则
 * - `GET/POST   /api/services/:key/endpoints`         接口清单
 * - `POST       /api/services/:key/endpoints/import`  批量导入（UPSERT 只补空字段）
 * - `PUT/DELETE /api/services/:key/endpoints/:id`     改 / 删接口
 * - `GET        /api/services/:key/envs`              各环境运行时与主机（只读）
 * - `POST       /api/services/:key/health`            手动探活
 */
@ApiTags('API 网关 · 服务')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('services')
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '服务列表（含接口数/路由数/已配环境）' })
  list(
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.servicesService.listServices({
      q,
      kind,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('meta')
  @ApiOperation({ summary: '类型 / 方法 / 鉴权模式枚举' })
  meta() {
    return this.servicesService.getMeta();
  }

  @Post()
  @ApiOperation({ summary: '新建服务（key 创建后不可修改）' })
  async create(@Body() dto: CreateServiceDto, @CurrentUser() user: any) {
    const svc = await this.servicesService.createService(dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.create',
      env: '-',
      component: svc.key,
      status: 'success',
      detail: `新建服务 ${svc.key}(${svc.name}) kind=${svc.kind} repoDir=${svc.repoDir}`,
    });
    return svc;
  }

  @Get(':key')
  @ApiOperation({ summary: '服务详情（含转发规则 / 接口 / 各环境指向）' })
  detail(@Param('key') key: string) {
    return this.servicesService.getServiceDetail(key);
  }

  @Put(':key')
  @ApiOperation({ summary: '更新服务（不含 key）' })
  async update(@Param('key') key: string, @Body() dto: UpdateServiceDto, @CurrentUser() user: any) {
    const svc = await this.servicesService.updateService(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.update',
      env: '-',
      component: key,
      status: 'success',
      detail: `更新服务 ${key}: ${JSON.stringify(dto)}`,
    });
    return svc;
  }

  @Delete(':key')
  @ApiOperation({ summary: '软删除服务（仍被环境指向时阻断）' })
  async remove(@Param('key') key: string, @CurrentUser() user: any) {
    const res = await this.servicesService.removeService(key);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.delete',
      env: '-',
      component: key,
      status: 'success',
      detail: `软删除服务 ${key}`,
    });
    return res;
  }

  // ============ 转发规则 ============

  @Get(':key/routes')
  @ApiOperation({ summary: '转发规则列表（可按环境过滤；不传 = 全环境默认）' })
  listRoutes(@Param('key') key: string, @Query('envId') envId?: string) {
    return this.servicesService.listRoutes(key, envId);
  }

  @Post(':key/routes')
  @ApiOperation({ summary: '新增转发规则（同前缀冲突阻断；前缀包含给出优先级告警）' })
  async createRoute(@Param('key') key: string, @Body() dto: ServiceRouteDto, @CurrentUser() user: any) {
    const route = await this.servicesService.createRoute(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.route.create',
      env: route.envId || '-',
      component: key,
      status: 'success',
      detail: `新增转发规则 ${route.pathPrefix}（priority=${route.priority}${route.upstreamOverride ? ` → ${route.upstreamOverride}` : ''}）`,
    });
    return route;
  }

  @Put(':key/routes/:id')
  @ApiOperation({ summary: '更新转发规则' })
  async updateRoute(
    @Param('key') key: string,
    @Param('id') id: string,
    @Body() dto: ServiceRouteDto,
    @CurrentUser() user: any,
  ) {
    const route = await this.servicesService.updateRoute(key, id, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.route.update',
      env: route.envId || '-',
      component: key,
      status: 'success',
      detail: `更新转发规则 ${route.pathPrefix}: ${JSON.stringify(dto)}`,
    });
    return route;
  }

  @Delete(':key/routes/:id')
  @ApiOperation({ summary: '删除转发规则' })
  async removeRoute(@Param('key') key: string, @Param('id') id: string, @CurrentUser() user: any) {
    const res = await this.servicesService.removeRoute(key, id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.route.delete',
      env: '-',
      component: key,
      status: 'success',
      detail: `删除转发规则 ${id}`,
    });
    return res;
  }

  // ============ 接口清单 ============

  @Get(':key/endpoints')
  @ApiOperation({ summary: '接口清单（方法/关键字/废弃筛选 + 分页）' })
  listEndpoints(
    @Param('key') key: string,
    @Query('method') method?: string,
    @Query('q') q?: string,
    @Query('deprecated') deprecated?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.servicesService.listEndpoints(key, {
      method,
      q,
      deprecated,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post(':key/endpoints')
  @ApiOperation({ summary: '新增接口（同服务下方法+路径唯一）' })
  async createEndpoint(
    @Param('key') key: string,
    @Body() dto: EndpointDto,
    @CurrentUser() user: any,
  ) {
    const ep = await this.servicesService.createEndpoint(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.endpoint.create',
      env: '-',
      component: key,
      status: 'success',
      detail: `新增接口 ${ep.method} ${ep.pathPattern}`,
    });
    return ep;
  }

  @Post(':key/endpoints/import')
  @ApiOperation({ summary: '批量导入接口（UPSERT 只补空字段，不覆盖人工配置）' })
  async importEndpoints(
    @Param('key') key: string,
    @Body() dto: ImportEndpointsDto,
    @CurrentUser() user: any,
  ) {
    const res = await this.servicesService.importEndpoints(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.endpoint.import',
      env: '-',
      component: key,
      status: 'success',
      detail: `接口导入（${dto.source ?? 'openapi'}）：新增 ${res.created} / 补空 ${res.filled} / 跳过 ${res.skipped}`,
    });
    return res;
  }

  @Put(':key/endpoints/:id')
  @ApiOperation({ summary: '更新接口（人工修改后 source 标记为 manual）' })
  async updateEndpoint(
    @Param('key') key: string,
    @Param('id') id: string,
    @Body() dto: EndpointDto,
    @CurrentUser() user: any,
  ) {
    const ep = await this.servicesService.updateEndpoint(key, id, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.endpoint.update',
      env: '-',
      component: key,
      status: 'success',
      detail: `更新接口 ${ep.method} ${ep.pathPattern}`,
    });
    return ep;
  }

  @Delete(':key/endpoints/:id')
  @ApiOperation({ summary: '删除接口' })
  async removeEndpoint(
    @Param('key') key: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    const res = await this.servicesService.removeEndpoint(key, id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.endpoint.delete',
      env: '-',
      component: key,
      status: 'success',
      detail: `删除接口 ${id}`,
    });
    return res;
  }

  // ============ 环境指向（只读） / 探活 ============

  @Get(':key/envs')
  @ApiOperation({ summary: '各环境运行时与目标主机（只读；编辑在环境详情）' })
  listEnvs(@Param('key') key: string) {
    return this.servicesService.listServiceEnvs(key);
  }

  @Post(':key/health')
  @ApiOperation({ summary: '手动探活（未配置主机时明确报错，不回落本机）' })
  async health(@Param('key') key: string, @Body() dto: ProbeHealthDto) {
    return this.servicesService.probeHealth(key, dto.envId || 'dev');
  }

  @Post(':key/deploy')
  @ApiOperation({
    summary: '部署某环境：重启进程 + 探活（与「构建发布」分离，不重新构建）',
  })
  async deploy(@Param('key') key: string, @Body() dto: DeployServiceDto, @CurrentUser() user: any) {
    const res = await this.servicesService.deploy(key, dto.envId);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'service.deploy',
      env: dto.envId,
      component: key,
      status: res.ok ? 'success' : 'failed',
      detail:
        `部署 ${dto.envId}：重启 ${res.restarted ?? '未执行'}` +
        `${res.restartNote ? `（${res.restartNote}）` : ''}` +
        `，探活 ${res.health.ok ? `${res.health.status} ${res.health.latencyMs}ms` : `失败 ${res.health.error || res.health.status}`}`,
    });
    return res;
  }
}
