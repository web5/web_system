import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AppsService } from './apps.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';
import {
  AppRouteDto,
  CreateAppDto,
  RollbackVersionDto,
  SwitchEnvVersionDto,
  UpdateAppDto,
} from './dto';

/**
 * 微前端 · 应用域接口
 *
 * - `GET/POST            /api/apps`                     列表 / 新建（key 唯一）
 * - `GET/PUT/DELETE      /api/apps/:key`                详情 / 更新（key 不可改）/ 软删
 * - `GET/POST            /api/apps/:key/routes`         shell 挂载路由
 * - `PUT/DELETE          /api/apps/:key/routes/:id`     改 / 删挂载路由
 * - `GET                 /api/apps/:key/envs`           环境 × 版本矩阵
 * - `GET                 /api/apps/:key/versions`       某环境可选版本
 * - `POST                /api/apps/:key/switch`         切换版本（只改指针）
 * - `POST                /api/apps/:key/rollback`       回滚
 * - `GET                 /api/apps/meta`                类型/模式枚举
 */
@ApiTags('微前端 · 应用')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('apps')
export class AppsController {
  constructor(
    private readonly appsService: AppsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '应用列表（含各环境当前版本）' })
  list(
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('parentKey') parentKey?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    return this.appsService.listApps({
      kind,
      q,
      parentKey,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      includeDeleted: includeDeleted === '1' || includeDeleted === 'true',
    });
  }

  @Get('meta')
  @ApiOperation({ summary: '应用类型与部署模式枚举' })
  meta() {
    return this.appsService.getKinds();
  }

  @Post()
  @ApiOperation({ summary: '新建应用（key 创建后不可修改）' })
  async create(@Body() dto: CreateAppDto, @CurrentUser() user: any) {
    const app = await this.appsService.createApp(dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.create',
      env: '-',
      component: app.key,
      status: 'success',
      detail: `新建应用 ${app.key}(${app.name}) kind=${app.kind} mode=${app.deployMode}`,
    });
    return app;
  }

  @Get(':key')
  @ApiOperation({ summary: '应用详情（含挂载路由与各环境版本）' })
  detail(@Param('key') key: string) {
    return this.appsService.getAppDetail(key);
  }

  @Put(':key')
  @ApiOperation({ summary: '更新应用（不含 key；key 不可改）' })
  async update(@Param('key') key: string, @Body() dto: UpdateAppDto, @CurrentUser() user: any) {
    const app = await this.appsService.updateApp(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.update',
      env: '-',
      component: key,
      status: 'success',
      detail: `更新应用 ${key}: ${JSON.stringify(dto)}`,
    });
    return app;
  }

  @Delete(':key')
  @ApiOperation({ summary: '软删除应用（返回仍在生效的环境清单）' })
  async remove(@Param('key') key: string, @CurrentUser() user: any) {
    const res = await this.appsService.removeApp(key);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.delete',
      env: '-',
      component: key,
      status: 'success',
      detail: `软删除应用 ${key}（生效环境：${res.activeEnvs.join('、') || '无'}）`,
    });
    return res;
  }

  // ============ 挂载路由 ============

  @Get(':key/routes')
  @ApiOperation({ summary: '挂载路由列表' })
  listRoutes(@Param('key') key: string) {
    return this.appsService.listRoutes(key);
  }

  @Post(':key/routes')
  @ApiOperation({ summary: '新增挂载路由（同路径被占用时阻断）' })
  async createRoute(@Param('key') key: string, @Body() dto: AppRouteDto, @CurrentUser() user: any) {
    const route = await this.appsService.createRoute(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.route.create',
      env: '-',
      component: key,
      status: 'success',
      detail: `新增挂载路由 ${route.mountPath}（activeRule=${route.activeRule}）`,
    });
    return route;
  }

  @Put(':key/routes/:id')
  @ApiOperation({ summary: '更新挂载路由（只改配置，不触发发布）' })
  async updateRoute(
    @Param('key') key: string,
    @Param('id') id: string,
    @Body() dto: AppRouteDto,
    @CurrentUser() user: any,
  ) {
    const route = await this.appsService.updateRoute(key, id, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.route.update',
      env: '-',
      component: key,
      status: 'success',
      detail: `更新挂载路由 ${route.mountPath}: ${JSON.stringify(dto)}`,
    });
    return route;
  }

  @Delete(':key/routes/:id')
  @ApiOperation({ summary: '删除挂载路由' })
  async removeRoute(@Param('key') key: string, @Param('id') id: string, @CurrentUser() user: any) {
    const res = await this.appsService.removeRoute(key, id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.route.delete',
      env: '-',
      component: key,
      status: 'success',
      detail: `删除挂载路由 ${id}`,
    });
    return res;
  }

  // ============ 环境版本 ============

  @Get(':key/envs')
  @ApiOperation({ summary: '环境 × 版本矩阵（含磁盘可用版本与指针一致性）' })
  listEnvs(@Param('key') key: string) {
    return this.appsService.listAppEnvs(key);
  }

  @Get(':key/versions')
  @ApiOperation({ summary: '某环境的可选版本（切换弹窗用）' })
  listVersions(@Param('key') key: string, @Query('envId') envId: string) {
    return this.appsService.listVersions(key, envId);
  }

  @Post(':key/switch')
  @ApiOperation({ summary: '切换版本（只改写入口指针，不重新构建）' })
  async switchVersion(
    @Param('key') key: string,
    @Body() dto: SwitchEnvVersionDto,
    @CurrentUser() user: any,
  ) {
    const res = await this.appsService.switchVersion(key, dto.envId, dto.version, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.version.switch',
      env: dto.envId,
      component: key,
      status: 'success',
      detail: `切换版本 ${res.from ?? '-'} → ${res.to}（${res.unchanged ? '无变化' : '指针已改写'}）`,
    });
    return res;
  }

  @Post(':key/rollback')
  @ApiOperation({ summary: '回滚（默认回到上一版本）' })
  async rollback(
    @Param('key') key: string,
    @Body() dto: RollbackVersionDto,
    @CurrentUser() user: any,
  ) {
    const res = await this.appsService.rollback(key, dto.envId, dto.version, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'app.version.rollback',
      env: dto.envId,
      component: key,
      status: 'success',
      detail: `回滚 ${res.from ?? '-'} → ${res.to}`,
    });
    return res;
  }
}
