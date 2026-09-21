import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { PipelineOrchestrationService } from './pipeline-orchestration.service';
import type { StepInput, TaskInput } from './orchestration-schema';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

/**
 * 流水线编排（步骤 → 任务 → 动作，specs/pipeline-step-task/design.md §5）。
 *
 * 仅控制台 JWT，不暴露 MCP。写接口全部走页面级保存语义（全量替换），
 * 审计记录前后 diff 摘要。
 */
@ApiTags('流水线编排')
@ApiBearerAuth()
@Controller('pipelines')
export class PipelineOrchestrationController {
  constructor(
    private readonly orchestration: PipelineOrchestrationService,
    private readonly auditService: AuditService,
  ) {}

  @Get(':id/steps')
  @ApiOperation({ summary: '整树：步骤（含任务，任务含动作）' })
  async list(@Param('id') id: string) {
    return this.orchestration.getTree(id);
  }

  @Put(':id/steps')
  @ApiOperation({ summary: '步骤全量保存（名称/介绍/排序/启用；空数组=清空）' })
  async saveSteps(
    @Param('id') id: string,
    @Body() body: { steps?: StepInput[] },
    @CurrentUser() user: any,
  ) {
    if (!body || !Array.isArray(body.steps)) {
      throw new BadRequestException('缺少 steps 数组');
    }
    const before = await this.orchestration.getTree(id);
    const after = await this.orchestration.saveSteps(id, body.steps, user?.username);
    await this.auditService.log({
      user: user?.username,
      action: 'pipeline-orchestration.steps.save',
      component: `pipeline:${id}`,
      status: 'ok',
      detail: `保存步骤 ${body.steps.length} 个（全量替换）`,
      changes: [
        {
          field: 'steps',
          before: before.map((s: { name: string }) => s.name).join('、'),
          after: after.map((s: { name: string }) => s.name).join('、'),
        },
      ],
    });
    return after;
  }

  @Put(':id/steps/:stepId/tasks')
  @ApiOperation({ summary: '该步骤任务全量保存（含各自动作；空数组=清空）' })
  async saveTasks(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() body: { tasks?: TaskInput[] },
    @CurrentUser() user: any,
  ) {
    if (!body || !Array.isArray(body.tasks)) {
      throw new BadRequestException('缺少 tasks 数组');
    }
    const before = await this.orchestration.getTree(id);
    const after = await this.orchestration.saveTasks(id, stepId, body.tasks, user?.username);
    await this.auditService.log({
      user: user?.username,
      action: 'pipeline-orchestration.tasks.save',
      component: `pipeline:${id}/step:${stepId}`,
      status: 'ok',
      detail: `保存任务 ${body.tasks.length} 个（含动作，全量替换）`,
      changes: [
        {
          field: 'tasks',
          before: (before.find((s: { id: string }) => s.id === stepId) as { tasks?: { name: string; actions?: { name: string }[] }[] })
            ?.tasks?.map((t) => `${t.name}(${t.actions?.length ?? 0})`).join('、') ?? '',
          after: (after.find((s: { id: string }) => s.id === stepId) as { tasks?: { name: string; actions?: { name: string }[] }[] })
            ?.tasks?.map((t) => `${t.name}(${t.actions?.length ?? 0})`).join('、') ?? '',
        },
      ],
    });
    return after;
  }

  @Delete(':id/steps/:stepId')
  @ApiOperation({ summary: '删除步骤（级联任务与动作）' })
  async deleteStep(@Param('id') id: string, @Param('stepId') stepId: string, @CurrentUser() user: any) {
    const before = await this.orchestration.getTree(id);
    const result = await this.orchestration.deleteStep(id, stepId);
    const removed = before.find((s: { id: string }) => s.id === stepId);
    await this.auditService.log({
      user: user?.username,
      action: 'pipeline-orchestration.step.delete',
      component: `pipeline:${id}/step:${stepId}`,
      status: 'ok',
      detail: `删除步骤 ${removed?.name ?? stepId}（级联任务与动作）`,
    });
    return result;
  }
}
