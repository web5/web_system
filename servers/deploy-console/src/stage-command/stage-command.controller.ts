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
import { StageCommandService, pickActions } from './stage-command.service';
import { CurrentUser } from '../common/decorators';
import {
  CONFIGURABLE_STAGES,
  StageAction,
} from '../entities/deploy-module-stage-command.entity';
import { AuditService } from '../audit/audit.service';

/**
 * 阶段命令管理（**仅控制台 JWT，不暴露 MCP**）。
 *
 * 每模块每阶段一条 shell 命令，是发布流水线的唯一执行真相源；
 * build 阶段未配置即 fail-fast，其余阶段未配置则回落到流水线内置逻辑。
 */
@ApiTags('阶段命令')
@ApiBearerAuth()
@Controller('modules')
export class StageCommandController {
  constructor(
    private readonly stageCommands: StageCommandService,
    private readonly auditService: AuditService,
  ) {}

  @Get(':key/stage-commands')
  @ApiOperation({ summary: '某模块各阶段命令（含未配置的阶段）' })
  async list(@Param('key') key: string) {
    const rows = await this.stageCommands.listByModule(key);
    const map = new Map(rows.map((r) => [r.stage, r]));
    return CONFIGURABLE_STAGES.map((stage) => {
      const row = map.get(stage);
      return {
        stage,
        configured: !!row?.command,
        command: row?.command ?? null,
        enabled: row?.enabled ?? false,
        timeoutSec: row?.timeoutSec ?? null,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
  }

  /**
   * 「发布脚本」面板数据源：每阶段的命令来源、原文、内置说明。
   *
   * 与上文 `list` 的区别：
   *  - `list`：纯 DB 行（用于阶段脚本编辑器，行无命令则不显示）
   *  - `resolveView`：合并视图（用于 ModuleDetail / PipelineDetail 步骤展示，
   *    把「没配置」的情况也补成 `builtin` 说明，告诉运维该阶段没有自定义脚本时会发生什么）
   *
   * 单一真相源仍是 `deploy_module_stage_commands` 表，本接口只做合并+视图，不落库。
   */
  @Get(':key/pipeline-script-view')
  @ApiOperation({ summary: '某模块流水线脚本视图（合并已配置命令与流程内置说明）' })
  async scriptView(@Param('key') key: string) {
    return this.stageCommands.resolveView(key);
  }

  /** 置于 :stage 路由之前，避免被参数路由吞掉 */
  @Get('stage-commands/templates')
  @ApiOperation({ summary: '按模块类型返回默认构建命令模板' })
  templates(@Query('type') type: string) {
    return this.stageCommands.template(type || 'frontend');
  }

  @Get(':key/stage-commands/:stage')
  @ApiOperation({ summary: '某模块某阶段/节点 key 命令（含 actions，未配置返回 null）' })
  async get(@Param('key') key: string, @Param('stage') stage: string) {
    return this.stageCommands.getRow(key, stage);
  }

  @Put(':key/stage-commands/:stage')
  @ApiOperation({ summary: '保存阶段命令（保存前 bash -n 语法校验）' })
  async save(
    @Param('key') key: string,
    @Param('stage') stage: string,
    @Body() body: { command?: string; timeoutSec?: number; actions?: StageAction[] },
    @CurrentUser() user: any,
  ) {
    const hasActions = Array.isArray(body?.actions) && body.actions.length > 0;
    // 多操作形态下 command 可空（由 actions 承载执行内容）
    if (!hasActions && (!body || typeof body.command !== 'string' || !body.command.trim())) {
      throw new BadRequestException('缺少 command 字段（或提供 actions 多操作）');
    }
    const beforeActs = await this.stageCommands.resolveActions(key, stage);
    const before = beforeActs.length ? JSON.stringify(beforeActs) : null;
    const saved = await this.stageCommands.upsert(
      key,
      stage,
      body.command ?? '',
      user?.username,
      body.timeoutSec,
      body.actions,
    );
    // 审计：多操作记 actions 全量（截断防超长），单操作记 command
    const afterActs = pickActions(saved);
    const after = afterActs.length ? JSON.stringify(afterActs) : null;
    const clip = (s: string | null) => (s && s.length > 1000 ? `${s.slice(0, 1000)}…` : s);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: before === null ? 'stage-command.create' : 'stage-command.update',
      component: key,
      status: 'success',
      detail: hasActions
        ? `保存 ${stage} 阶段多操作（${body.actions!.length} 个）`
        : `保存 ${stage} 阶段命令`,
      changes: [
        {
          field: hasActions ? `${stage}.actions` : `${stage}.command`,
          before: clip(before),
          after: clip(after),
        },
      ],
    });
    return saved;
  }

  @Delete(':key/stage-commands/:stage')
  @ApiOperation({ summary: '删除阶段命令（该阶段恢复为流水线内置逻辑）' })
  async remove(
    @Param('key') key: string,
    @Param('stage') stage: string,
    @CurrentUser() user: any,
  ) {
    const before = (await this.stageCommands.resolve(key, stage))?.command ?? null;
    await this.stageCommands.remove(key, stage);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'stage-command.remove',
      component: key,
      status: 'success',
      detail: `删除 ${stage} 阶段命令（恢复内置逻辑）`,
      changes: [{ field: `${stage}.command`, before, after: null }],
    });
    return { ok: true };
  }

  @Post(':key/stage-commands/:stage/validate')
  @ApiOperation({ summary: '仅语法校验（不保存）' })
  validate(@Body() body: { command: string }) {
    if (!body || typeof body.command !== 'string') {
      throw new BadRequestException('缺少 command 字段');
    }
    this.stageCommands.validate(body.command);
    return { ok: true, message: '语法正确' };
  }
}
