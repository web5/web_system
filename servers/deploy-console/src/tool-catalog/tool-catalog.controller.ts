import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ToolCatalogService, ToolSpec } from './tool-catalog.service';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

/**
 * 工具注册表管理（**仅控制台 JWT**）。
 * service 工具 = 内置执行器（探活/写版本/切指针/回滚等，与流水线步骤对应）；
 * shell 工具 = 外部 CLI 元数据。写操作审计。
 */
@ApiTags('工具目录')
@ApiBearerAuth()
@Controller('tools')
export class ToolCatalogController {
  constructor(
    private readonly tools: ToolCatalogService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '工具列表（分类/kind 过滤；自动补齐种子）' })
  list(@Query('category') category?: string, @Query('kind') kind?: string) {
    return this.tools.list(category, kind);
  }

  @Post()
  @ApiOperation({ summary: '新增 shell 工具（code 由名称生成）' })
  async create(@Body() body: ToolSpec, @CurrentUser() user: any) {
    const t = await this.tools.create(body);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'tool.create',
      status: 'success',
      detail: `新增工具: ${t.code}（${t.kind}/${t.category}）`,
    });
    return t;
  }

  @Put(':code')
  @ApiOperation({ summary: '编辑工具（说明/示例/分类/可用性）' })
  async update(
    @Param('code') code: string,
    @Body() body: Partial<Omit<ToolSpec, 'name'>>,
    @CurrentUser() user: any,
  ) {
    const t = await this.tools.update(code, body);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'tool.update',
      status: 'success',
      detail: `编辑工具: ${t.code}`,
    });
    return t;
  }

  @Delete(':code')
  @ApiOperation({ summary: '删除工具（内置不可删除）' })
  async remove(@Param('code') code: string, @CurrentUser() user: any) {
    const t = await this.tools.get(code);
    await this.tools.remove(code);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'tool.delete',
      status: 'success',
      detail: `删除工具: ${t.code}`,
    });
    return { ok: true };
  }
}
