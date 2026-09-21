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
import { StepBranchService, type StepBranchInput } from './step-branch.service';
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
    private readonly stepBranches: StepBranchService,
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
      // 环境分支配置（envId → 脚本）；非空 = 该节点按环境分叉，脚本由它生成
      envBranches: r.envBranches ?? null,
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
    @Body()
    body: {
      command?: string;
      timeoutSec?: number;
      actions?: StepAction[];
      /** 环境分支（envId → 脚本）：非空=启用并生成执行体；null=关闭 */
      envBranches?: Record<string, string> | null;
      /** 步骤执行条件（gate）：不满足则跳过整个步骤；空串/null = 恒执行 */
      condition?: string | null;
    },
    @CurrentUser() user: any,
  ) {
    const hasActions = Array.isArray(body?.actions) && body.actions.length > 0;
    const hasBranches = !!body?.envBranches && Object.keys(body.envBranches).length > 0;
    const hasCondition = typeof body?.condition === 'string' || body?.condition === null;
    // 传 null = 关闭（清空）该配置：这类请求不要求同时带 command
    const closingBranches = body?.envBranches === null;
    if (
      !hasActions &&
      !hasBranches &&
      !hasCondition &&
      !closingBranches &&
      (!body || typeof body.command !== 'string' || !body.command.trim())
    ) {
      throw new BadRequestException(
        '缺少 command 字段（或提供 actions 多操作 / envBranches 环境分支 / condition 执行条件）',
      );
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
      // 注意：null = 关闭（清空配置），不能用 ?? 兜底成 undefined（否则 service 无法区分「不传」与「关闭」）
      body.envBranches === null ? null : body.envBranches,
      body.condition === null ? null : body.condition,
    );
    const after = JSON.stringify(pickStepActions(saved));
    const clip = (s: string | null) => (s && s.length > 1000 ? `${s.slice(0, 1000)}…` : s);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: before === null ? 'pipeline-step-command.create' : 'pipeline-step-command.update',
      component: id,
      status: 'success',
      detail: `保存流水线 ${id} 节点 ${nodeKey} ${
        hasBranches
          ? `环境分支（${Object.keys(body.envBranches!).join('、')}）`
          : hasActions
            ? `多操作（${body.actions!.length} 个）`
            : '命令'
      }`,
      changes: [
        {
          field: hasBranches
            ? `${nodeKey}.envBranches`
            : hasActions
              ? `${nodeKey}.actions`
              : `${nodeKey}.command`,
          before: clip(hasBranches ? JSON.stringify(beforeRow?.envBranches ?? null) : before),
          after: clip(hasBranches ? JSON.stringify(saved.envBranches ?? null) : after),
        },
      ],
    });
    return saved;
  }

  @Get(':id/steps/:nodeKey/branches')
  @ApiOperation({ summary: '某步骤的任务（分支）列表：条件 + 脚本，按匹配顺序' })
  async listBranches(@Param('id') id: string, @Param('nodeKey') nodeKey: string) {
    return this.stepBranches.list(id, nodeKey);
  }

  @Put(':id/steps/:nodeKey/branches')
  @ApiOperation({
    summary: '全量保存步骤任务（空数组=清空，回落单一执行体）；保存前 bash -n + 条件校验',
  })
  async saveBranches(
    @Param('id') id: string,
    @Param('nodeKey') nodeKey: string,
    @Body() body: { branches: StepBranchInput[] },
    @CurrentUser() user: any,
  ) {
    if (!Array.isArray(body?.branches)) {
      throw new BadRequestException('缺少 branches 数组（清空请传空数组）');
    }
    const before = await this.stepBranches.list(id, nodeKey);
    const saved = await this.stepBranches.saveAll(id, nodeKey, body.branches, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-step-branch.save',
      component: id,
      status: 'success',
      detail: `保存流水线 ${id} 步骤 ${nodeKey} 的任务：${saved.map((b) => b.name).join('、') || '（清空）'}`,
      changes: [
        {
          field: `${nodeKey}.branches`,
          before: JSON.stringify(before.map((b) => ({ name: b.name, condition: b.condition }))),
          after: JSON.stringify(saved.map((b) => ({ name: b.name, condition: b.condition }))),
        },
      ],
    });
    return saved;
  }

  @Delete(':id/steps/:nodeKey/branches')
  @ApiOperation({ summary: '清空步骤任务（回落到节点单一执行体）' })
  async clearBranches(
    @Param('id') id: string,
    @Param('nodeKey') nodeKey: string,
    @CurrentUser() user: any,
  ) {
    await this.stepBranches.clear(id, nodeKey);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-step-branch.clear',
      component: id,
      status: 'success',
      detail: `清空流水线 ${id} 步骤 ${nodeKey} 的任务`,
    });
    return { ok: true };
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
