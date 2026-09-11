import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PipelineStepCommandService, pickStepActions } from './pipeline-step-command.service';
import { CurrentUser } from '../common/decorators';
import { StepAction } from '../entities/deploy-pipeline-step-command.entity';
import { AuditService } from '../audit/audit.service';

/**
 * 流水线节点命令管理（**仅控制台 JWT，不暴露 MCP**）。
 *
 * R6 新真相源：每流水线每节点一条命令（操作序列），模块不再持有命令。
 * build 节点未配置即 fail-fast，其余节点未配置则回落流水线内置逻辑。
 */
@ApiTags('流水线节点命令')
@ApiBearerAuth()
@Controller('pipeline-templates')
export class PipelineStepCommandController {
  constructor(
    private readonly stepCommands: PipelineStepCommandService,
    private readonly auditService: AuditService,
  ) {}

  @Get(':id/steps')
  @ApiOperation({ summary: '某流水线各节点命令（含未配置的节点）' })
  async list(@Param('id') id: string) {
    const rows = await this.stepCommands.listByTemplate(id);
    const map = new Map(rows.map((r) => [r.nodeKey, r]));
    return rows.map((r) => ({
      nodeKey: r.nodeKey,
      configured: !!r.command,
      command: r.command,
      actions: r.actions ?? [],
      enabled: r.enabled,
      // 平台托管（locked）：页面据此渲染为只读，不给编辑入口
      locked: !!r.locked,
      timeoutSec: r.timeoutSec ?? null,
      updatedAt: r.updatedAt ?? null,
      updatedBy: r.updatedBy ?? null,
    }));
  }

  @Get('steps/templates')
  @ApiOperation({ summary: '按模块类型返回默认构建命令模板（置于 :id 路由之前）' })
  templates(@Query('type') type: string) {
    const templates: Record<string, string> = {
      backend: 'npx tsc -p tsconfig.json',
      frontend: 'npx vite build',
      'micro-frontend': 'npx vite build --mode mf',
    };
    return { template: templates[type || 'frontend'] ?? null };
  }

  @Get(':id/steps/:nodeKey')
  @ApiOperation({ summary: '某流水线某节点命令（含 actions，未配置返回 null）' })
  async get(@Param('id') id: string, @Param('nodeKey') nodeKey: string) {
    return this.stepCommands.getRow(id, nodeKey);
  }

  @Put(':id/steps/:nodeKey')
  @ApiOperation({ summary: '保存节点命令（保存前 bash -n 语法校验）' })
  async save(
    @Param('id') id: string,
    @Param('nodeKey') nodeKey: string,
    @Body() body: { command?: string; timeoutSec?: number; actions?: StepAction[] },
    @CurrentUser() user: any,
  ) {
    const hasActions = Array.isArray(body?.actions) && body.actions.length > 0;
    if (!hasActions && (!body || typeof body.command !== 'string' || !body.command.trim())) {
      throw new BadRequestException('缺少 command 字段（或提供 actions 多操作）');
    }
    const beforeRow = await this.stepCommands.getRow(id, nodeKey);
    const before = beforeRow ? JSON.stringify(pickStepActions(beforeRow)) : null;
    const saved = await this.stepCommands.upsert(
      id,
      nodeKey,
      body.command ?? '',
      user?.username,
      body.timeoutSec,
      body.actions,
    );
    const after = JSON.stringify(pickStepActions(saved));
    const clip = (s: string | null) => (s && s.length > 1000 ? `${s.slice(0, 1000)}…` : s);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: before === null ? 'pipeline-step-command.create' : 'pipeline-step-command.update',
      component: id,
      status: 'success',
      detail: `保存流水线 ${id} 节点 ${nodeKey} ${hasActions ? `多操作（${body.actions!.length} 个）` : '命令'}`,
      changes: [
        {
          field: hasActions ? `${nodeKey}.actions` : `${nodeKey}.command`,
          before: clip(before),
          after: clip(after),
        },
      ],
    });
    return saved;
  }

  @Delete(':id/steps/:nodeKey')
  @ApiOperation({ summary: '删除节点命令（该节点回落流程内置逻辑）' })
  async remove(
    @Param('id') id: string,
    @Param('nodeKey') nodeKey: string,
    @CurrentUser() user: any,
  ) {
    const row = await this.stepCommands.getRow(id, nodeKey);
    await this.stepCommands.remove(id, nodeKey);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-step-command.remove',
      component: id,
      status: 'success',
      detail: `删除流水线 ${id} 节点 ${nodeKey} 命令（恢复内置逻辑）`,
      changes: [{ field: `${nodeKey}.command`, before: row?.command ?? null, after: null }],
    });
    return { ok: true };
  }

  @Post(':id/steps/:nodeKey/validate')
  @ApiOperation({ summary: '仅语法校验（不保存）' })
  validate(@Body() body: { command: string }) {
    if (!body || typeof body.command !== 'string') {
      throw new BadRequestException('缺少 command 字段');
    }
    this.stepCommands.validate(body.command);
    return { ok: true, message: '语法正确' };
  }
}
