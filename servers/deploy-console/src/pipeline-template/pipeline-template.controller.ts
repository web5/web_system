import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PipelineTemplateService, TemplateSpec } from './pipeline-template.service';
import { CurrentUser } from '../common/decorators';
import { AuditService, diffObject } from '../audit/audit.service';

const SNAPSHOT_KEYS = [
  'name',
  'description',
  'steps',
  'skipVerify',
  'rollbackOnFailure',
  'approval',
  'defaultTarget',
  'enabled',
] as const;

/**
 * 流水线模板管理（**仅控制台 JWT**）。
 *
 * 模板=全局流水线定义（不绑定模块，执行时选目标模块）；历史模块专属模板兼容可用。
 * 路由挂在根 `/pipeline-templates`（不再依赖 `/modules/:key/...`，模块页已瘦身）。
 */
@ApiTags('流水线模板')
@ApiBearerAuth()
@Controller('pipeline-templates')
export class PipelineTemplateController {
  constructor(
    private readonly templates: PipelineTemplateService,
    private readonly auditService: AuditService,
  ) {}

  private snapshot(row: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of SNAPSHOT_KEYS) out[k] = (row as any)[k];
    return out;
  }

  @Get()
  @ApiOperation({ summary: '模板列表：?moduleKey= 返回该模块可用（全局+专属）；否则全部' })
  async list(@Query('moduleKey') moduleKey?: string) {
    if (moduleKey) return this.templates.listUsable(moduleKey);
    return this.templates.listAll();
  }

  @Post()
  @ApiOperation({ summary: '新建全局流水线模板（不绑模块）' })
  async create(@Body() body: TemplateSpec, @CurrentUser() user: any) {
    const tpl = await this.templates.create(body, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.create',
      status: 'success',
      detail: `新建流水线模板: ${tpl.name}`,
      changes: [{ field: 'name', before: null, after: tpl.name }],
    });
    return tpl;
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: '复制模板（含内置默认）' })
  async duplicate(@Param('id') id: string, @CurrentUser() user: any) {
    const src = await this.templates.get(id);
    const tpl = await this.templates.duplicate(id, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.duplicate',
      status: 'success',
      detail: `复制流水线模板: ${src.name} → ${tpl.name}`,
    });
    return tpl;
  }

  @Put(':id')
  @ApiOperation({ summary: '编辑模板（内置默认不可改名）' })
  async update(
    @Param('id') id: string,
    @Body() body: Partial<TemplateSpec>,
    @CurrentUser() user: any,
  ) {
    const before = await this.templates.get(id);
    const tpl = await this.templates.update(id, body, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.update',
      status: 'success',
      detail: `编辑流水线模板: ${tpl.name}`,
      changes: diffObject(this.snapshot(before), this.snapshot(tpl)),
    });
    return tpl;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除模板（内置默认不可删除）' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const tpl = await this.templates.get(id);
    await this.templates.remove(id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.delete',
      status: 'success',
      detail: `删除流水线模板: ${tpl.name}`,
      changes: [{ field: 'name', before: tpl.name, after: null }],
    });
    return { ok: true };
  }
}
