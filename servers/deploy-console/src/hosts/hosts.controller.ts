import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { HostsService } from './hosts.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';
import { CreateHostDto, UpdateHostDto } from './dto';

/**
 * 基础设施 · 主机管理
 *
 * 路由：
 * - `GET    /api/hosts?enabledOnly=1`   主机组列表（下拉只取启用项）
 * - `GET    /api/hosts/:name`           主机组详情
 * - `POST   /api/hosts`                 新建主机组（name 为引用键）
 * - `PUT    /api/hosts/:name`           更新（name 不可改）
 * - `DELETE /api/hosts/:name`           删除（仍被服务指向引用时阻断）
 */
@ApiTags('基础设施 · 主机')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('hosts')
export class HostsController {
  constructor(
    private readonly hostsService: HostsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '主机组列表（enabledOnly=1 时只返回启用项，供下拉使用）' })
  list(@Query('enabledOnly') enabledOnly?: string) {
    return this.hostsService.list(enabledOnly === '1' || enabledOnly === 'true');
  }

  @Get(':name')
  @ApiOperation({ summary: '主机组详情' })
  get(@Param('name') name: string) {
    return this.hostsService.get(name);
  }

  @Post()
  @ApiOperation({ summary: '新建主机组（name 是服务指向的引用键，创建后不可改）' })
  async create(@Body() dto: CreateHostDto, @CurrentUser() user: any) {
    const host = await this.hostsService.create(dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'host.create',
      env: '-',
      component: host.name,
      status: 'success',
      detail: `新建主机组 ${host.name} → ${host.host}（${host.sshUser}@${host.remoteDir}）`,
    });
    return host;
  }

  @Put(':name')
  @ApiOperation({ summary: '更新主机组（地址 / SSH 用户 / 部署目录 / 运行时 / 启用）' })
  async update(@Param('name') name: string, @Body() dto: UpdateHostDto, @CurrentUser() user: any) {
    const host = await this.hostsService.update(name, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'host.update',
      env: '-',
      component: name,
      status: 'success',
      detail: `更新主机组 ${name}: ${JSON.stringify(dto)}`,
    });
    return host;
  }

  @Delete(':name')
  @ApiOperation({ summary: '删除主机组（仍被服务指向引用时阻断并列出引用方）' })
  async remove(@Param('name') name: string, @CurrentUser() user: any) {
    const res = await this.hostsService.remove(name);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'host.delete',
      env: '-',
      component: name,
      status: 'success',
      detail: `删除主机组 ${name}`,
    });
    return res;
  }
}
