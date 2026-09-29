import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  ParseIntPipe,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { PipelineOrchestrationService } from './pipeline-orchestration.service';
import { PipelineRevisionService } from './pipeline-revision.service';
import type { StepInput, TaskInput } from './orchestration-schema';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ApproverService, APPROVE_PERMISSION } from '../approval/approver.service';

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
    private readonly revisions: PipelineRevisionService,
    private readonly approvers: ApproverService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 保存成功后打版本快照；**快照失败不推翻保存结果**。
   *
   * 为什么降级：保存事务已提交，此时因快照问题抛 500 会让前端显示「保存失败」，
   * 而配置其实已经落库 —— 用户以为没保存成功，重复提交反而制造更多版本。
   * 快照缺失是「可追溯性受损」，不是「保存失败」，故记审计后放行。
   */
  private async safeSnapshot(
    id: string,
    source: 'save-steps' | 'save-tasks' | 'delete-step',
    summary: string,
    user?: string,
  ): Promise<number | null> {
    try {
      return await this.revisions.snapshot(id, source, summary, user);
    } catch (e) {
      await this.auditService.log({
        user,
        action: 'pipeline-orchestration.revision.failed',
        component: `pipeline:${id}`,
        status: 'error',
        detail: `配置已保存，但版本快照失败：${(e as Error).message}`,
      });
      return null;
    }
  }

  // ---- 配置版本（每次保存自动生成快照；可回看、可恢复）----

  @Get(':id/revisions')
  @ApiOperation({ summary: '配置版本列表（不含快照正文，倒序）' })
  async listRevisions(@Param('id') id: string) {
    return this.revisions.list(id);
  }

  @Get(':id/revisions/:rev')
  @ApiOperation({ summary: '单个配置版本（含完整快照正文）' })
  async getRevision(@Param('id') id: string, @Param('rev', ParseIntPipe) rev: number) {
    return this.revisions.get(id, rev);
  }

  @Post(':id/revisions/:rev/restore')
  @ApiOperation({ summary: '恢复到指定配置版本（生成新版本，历史不删除）' })
  async restoreRevision(
    @Param('id') id: string,
    @Param('rev', ParseIntPipe) rev: number,
    @Body() body: { confirm?: boolean; expectedRev?: number },
    @CurrentUser() user: any,
  ) {
    // 该操作整体替换当前编排树（含动作脚本），必须显式确认 —— 与 prod 发布同一先例
    if (body?.confirm !== true) {
      throw new BadRequestException('恢复配置版本需要 confirm=true（将整体替换当前编排树）');
    }
    // 权限：与发布审批同一把钥匙（user-service 不可达时降级放行，与该服务既有策略一致）
    const gate = await this.approvers.canApprove(user?.username);
    if (!gate.ok) {
      throw new ForbiddenException(
        `${user?.username || '当前操作人'} 无配置恢复权限（需 ${APPROVE_PERMISSION}）`,
      );
    }
    if (gate.degraded) {
      await this.auditService.log({
        user: user?.username,
        action: 'pipeline-orchestration.revision.restore',
        component: `pipeline:${id}`,
        status: 'warn',
        detail: `权限校验降级放行（${gate.reason ?? 'user-service 不可用'}）`,
      });
    }
    const result = await this.revisions.restore(id, rev, user?.username, body?.expectedRev);
    await this.auditService.log({
      user: user?.username,
      action: 'pipeline-orchestration.revision.restore',
      component: `pipeline:${id}`,
      status: 'ok',
      detail: `恢复流水线配置到版本 ${rev}（生成新版本 ${result.rev}）`,
      changes: [{ field: 'rev', before: String(rev), after: String(result.rev) }],
    });
    return result;
  }

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
    await this.safeSnapshot(
      id,
      'save-steps',
      `保存步骤 ${body.steps.length} 个（全量替换）`,
      user?.username,
    );
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
    await this.safeSnapshot(
      id,
      'save-tasks',
      `保存任务 ${body.tasks.length} 个（含动作，全量替换）`,
      user?.username,
    );
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
    await this.safeSnapshot(
      id,
      'delete-step',
      `删除步骤 ${removed?.name ?? stepId}（级联任务与动作）`,
      user?.username,
    );
    return result;
  }
}
