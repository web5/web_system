import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CanaryService } from './canary.service';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

@ApiTags('灰度规则')
@Controller('canary')
export class CanaryController {
  constructor(
    private readonly canaryService: CanaryService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出灰度规则' })
  async list(@Query('envId') envId?: string, @Query('moduleKey') moduleKey?: string) {
    return this.canaryService.list(envId, moduleKey);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询灰度规则详情' })
  async get(@Param('id') id: string) {
    return this.canaryService.get(id);
  }

  @Post()
  @ApiOperation({ summary: '创建灰度规则' })
  async create(@Body() body: any, @CurrentUser() user: any) {
    const r = await this.canaryService.create(body);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'canary.create',
      component: `${body.envId}/${body.moduleKey}`,
      status: 'success',
      detail: `创建灰度规则: ${body.moduleKey} → ${body.canaryVersion}`,
    });
    return r;
  }

  @Put(':id')
  @ApiOperation({ summary: '更新灰度规则' })
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    const r = await this.canaryService.update(id, body);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'canary.update',
      component: `${r.envId}/${r.moduleKey}`,
      status: 'success',
      detail: `更新灰度规则: ${id}`,
    });
    return r;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除灰度规则' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const r = await this.canaryService.get(id);
    await this.canaryService.remove(id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'canary.delete',
      component: `${r.envId}/${r.moduleKey}`,
      status: 'success',
      detail: `删除灰度规则: ${id}`,
    });
    return { status: 'success' };
  }

  @Post(':id/preview')
  @ApiOperation({ summary: '命中预览：输入 userId 判断是否命中灰度' })
  async preview(@Param('id') id: string, @Body() body: { userId: string }) {
    const rule = await this.canaryService.get(id);
    return { hit: this.canaryService.preview(rule, body.userId), rule };
  }
}
