import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PipelineTemplateService, TemplateSpec } from './pipeline-template.service';
import { CurrentUser } from '../common/decorators';
import { AuditService, diffObject } from '../audit/audit.service';

const SNAPSHOT_KEYS = ['name', 'description', 'skipVerify', 'approval', 'defaultTarget', 'enabled'] as const;

/**
 * 流水线模板管理（**仅控制台 JWT，不暴露 MCP**）。
 * 模板属模块：`/modules/:key/pipeline-templates`；写操作审计 + 字段级 diff。
 */
@ApiTags('流水线模板')
@ApiBearerAuth()
@Controller('modules/:key/pipeline-templates')
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
  @ApiOperation({ summary: '模块流水线模板列表（含内置默认）' })
  async list(@Param('key') key: string) {
    return this.templates.listByModule(key);
  }

  @Post()
  @ApiOperation({ summary: '新建模板（名称模块内唯一）' })
  async create(
    @Param('key') key: string,
    @Body() body: TemplateSpec,
    @CurrentUser() user: any,
  ) {
    const tpl = await this.templates.create(key, body, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.create',
      component: key,
      status: 'success',
      detail: `新建流水线模板: ${key}/${tpl.name}`,
      changes: [{ field: 'name', before: null, after: tpl.name }],
    });
    return tpl;
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: '复制模板（含内置默认）' })
  async duplicate(@Param('key') key: string, @Param('id') id: string, @CurrentUser() user: any) {
    const src = await this.templates.get(id);
    const tpl = await this.templates.duplicate(id, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.duplicate',
      component: key,
      status: 'success',
      detail: `复制流水线模板: ${src.name} → ${tpl.name}`,
    });
    return tpl;
  }

  @Put(':id')
  @ApiOperation({ summary: '编辑模板（内置默认不可改名）' })
  async update(
    @Param('key') key: string,
    @Param('id') id: string,
    @Body() body: Partial<TemplateSpec>,
    @CurrentUser() user: any,
  ) {
    const before = await this.templates.get(id);
    const tpl = await this.templates.update(id, body, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.update',
      component: key,
      status: 'success',
      detail: `编辑流水线模板: ${key}/${tpl.name}`,
      changes: diffObject(this.snapshot(before), this.snapshot(tpl)),
    });
    return tpl;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除模板（内置默认不可删除）' })
  async remove(@Param('key') key: string, @Param('id') id: string, @CurrentUser() user: any) {
    const tpl = await this.templates.get(id);
    await this.templates.remove(id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-template.delete',
      component: key,
      status: 'success',
      detail: `删除流水线模板: ${key}/${tpl.name}`,
      changes: [{ field: 'name', before: tpl.name, after: null }],
    });
    return { ok: true };
  }
}
