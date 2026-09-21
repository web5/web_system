import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

import { DeployPipelineStepEntity } from '../entities/deploy-pipeline-step.entity';
import { DeployPipelineTaskEntity } from '../entities/deploy-pipeline-task.entity';
import { DeployPipelineActionEntity } from '../entities/deploy-pipeline-action.entity';
import { validateTree, type StepInput, type TaskInput } from './orchestration-schema';

/**
 * 流水线编排（步骤 → 任务 → 动作）服务（specs/pipeline-step-task/design.md §4–§5）。
 *
 * 读：整树一次取回（三个 IN 查询组装，无 N+1）。
 * 写：步骤/任务均**全量替换**（页面级保存语义），单事务；
 *     managed 动作受保护 —— 不可删除、不可改名（脚本内容允许更新）。
 */
@Injectable()
export class PipelineOrchestrationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DeployPipelineStepEntity)
    private readonly stepsRepo: Repository<DeployPipelineStepEntity>,
    @InjectRepository(DeployPipelineTaskEntity)
    private readonly tasksRepo: Repository<DeployPipelineTaskEntity>,
    @InjectRepository(DeployPipelineActionEntity)
    private readonly actionsRepo: Repository<DeployPipelineActionEntity>,
  ) {}

  /** shell 语法校验（bash -n）；与 step-command 同款实现 */
  checkScript(script: string): void {
    const tmp = path.join(os.tmpdir(), `orch-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
    try {
      fs.writeFileSync(tmp, script, 'utf-8');
      execSync(`bash -n "${tmp}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const stderr = (e as { stderr?: Buffer })?.stderr?.toString();
      throw new Error(stderr || (e as Error).message);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** 整树：步骤（含任务，任务含动作），按 sort 排序 */
  async getTree(pipelineId: string) {
    const steps = await this.stepsRepo.find({
      where: { pipelineId },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    if (!steps.length) return [];

    const stepIds = steps.map((s) => s.id);
    const tasks = await this.tasksRepo.find({
      where: { stepId: In(stepIds) },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    const taskIds = tasks.map((t) => t.id);
    const actions = taskIds.length
      ? await this.actionsRepo.find({
          where: { taskId: In(taskIds) },
          order: { sort: 'ASC', createdAt: 'ASC' },
        })
      : [];

    const actionsByTask = new Map<string, DeployPipelineActionEntity[]>();
    for (const a of actions) {
      const list = actionsByTask.get(a.taskId) ?? [];
      list.push(a);
      actionsByTask.set(a.taskId, list);
    }
    const tasksByStep = new Map<string, DeployPipelineTaskEntity[]>();
    for (const t of tasks) {
      t['actions'] = actionsByTask.get(t.id) ?? [];
      const list = tasksByStep.get(t.stepId) ?? [];
      list.push(t);
      tasksByStep.set(t.stepId, list);
    }
    for (const s of steps) s['tasks'] = tasksByStep.get(s.id) ?? [];
    return steps;
  }

  /** 步骤全量保存（名称/介绍/排序/启用；tasks 不在本接口，走 saveTasks）；空数组 = 清空全部步骤 */
  async saveSteps(pipelineId: string, steps: StepInput[], user?: string) {
    if (!Array.isArray(steps)) throw new BadRequestException('steps 必须是数组');
    const errs = validateTree(
      steps.map(({ tasks: _tasks, ...rest }) => rest) as StepInput[],
      () => undefined,
    );
    if (errs.length) throw new BadRequestException(errs.join('；'));

    // 树读取在事务提交后执行（事务回调内用非事务 repo 会读不到未提交数据）；
    // 改名撞其他步骤名（DB 唯一键）转 400，不给用户看 500
    try {
      await this.runSaveSteps(pipelineId, steps, user);
    } catch (e) {
      const msg = (e as { code?: string; message?: string })?.message ?? '';
      if ((e as { code?: string })?.code === 'ER_DUP_ENTRY' || msg.includes('Duplicate')) {
        throw new BadRequestException(`步骤名重复（${steps.map((s) => s.name).join('、')}）：改名不能与其他步骤同名`);
      }
      throw e;
    }
    return this.getTree(pipelineId);
  }

  private async runSaveSteps(pipelineId: string, steps: StepInput[], user?: string) {
    await this.dataSource.transaction(async (em) => {
      // 按 id upsert：带 id 的步骤更新元数据（**可改名，任务保留** —— 任务挂在 stepId 上）；
      // 不带 id 的按名新建；库中有而提交没有（按 id）→ 删除（级联任务与动作）；空数组 = 清空。
      // 注意不能按名 upsert：改名会被当成「删旧建新」→ 任务全部丢失（已实测踩坑）。
      const oldSteps = await em.find(DeployPipelineStepEntity, { where: { pipelineId } });
      const oldById = new Map(oldSteps.map((s) => [s.id, s]));
      const submittedIds = new Set(steps.map((s) => s.id).filter(Boolean));

      for (const old of oldSteps) {
        if (!submittedIds.has(old.id)) {
          const oldTasks = await em.find(DeployPipelineTaskEntity, { where: { stepId: old.id } });
          if (oldTasks.length) {
            await em.delete(DeployPipelineActionEntity, {
              taskId: In(oldTasks.map((t) => t.id)),
            });
            await em.delete(DeployPipelineTaskEntity, { stepId: old.id });
          }
          await em.delete(DeployPipelineStepEntity, { id: old.id });
        }
      }

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const name = s.name.trim();
        if (s.id && oldById.has(s.id)) {
          await em.update(
            DeployPipelineStepEntity,
            { id: s.id },
            {
              name,
              description: s.description?.trim() || null,
              sort: s.sort ?? i,
              enabled: s.enabled ?? true,
              updatedBy: user ?? null,
            },
          );
        } else {
          await em.insert(DeployPipelineStepEntity, {
            id: s.id && !oldById.has(s.id) ? s.id : crypto.randomUUID(),
            pipelineId,
            name,
            description: s.description?.trim() || null,
            sort: s.sort ?? i,
            enabled: s.enabled ?? true,
            updatedBy: user ?? null,
          });
        }
      }
    });
  }
  async saveTasks(pipelineId: string, stepId: string, tasks: TaskInput[], user?: string) {
    const step = await this.stepsRepo.findOne({ where: { id: stepId, pipelineId } });
    if (!step) throw new NotFoundException('步骤不存在');

    const errs = validateTree([{ name: step.name, tasks }], (s) => this.checkScript(s));
    if (errs.length) throw new BadRequestException(errs.join('；'));

    // managed 保护：库中托管动作必须原样保留（名字不变且未删除；脚本内容允许更新）
    const oldTasks = await this.tasksRepo.find({ where: { stepId } });
    const oldTaskIds = oldTasks.map((t) => t.id);
    const oldActions = oldTaskIds.length
      ? await this.actionsRepo.find({ where: { taskId: In(oldTaskIds) } })
      : [];
    const managedOld = oldActions.filter((a) => a.managed);
    // 托管保护按「动作名」（步骤范围内）：任务改名合法（托管动作随任务保留）；
    // 托管动作自身不可删除、不可改名 —— 提交里找不到同名托管动作即拒绝。
    // （按「任务名/动作名」组合键会让任务改名被误判为删除托管动作，已实测踩坑。）
    const oldManagedNames = new Set(managedOld.map((m) => m.name));
    for (const name of oldManagedNames) {
      const kept = tasks.some((t) => t.actions?.some((a) => a.name === name));
      if (!kept) {
        throw new BadRequestException(`平台托管动作不可删除或不可改名: ${name}`);
      }
    }

    await this.dataSource.transaction(async (em) => {
      if (oldTaskIds.length) {
        await em.delete(DeployPipelineActionEntity, { taskId: In(oldTaskIds) });
        await em.delete(DeployPipelineTaskEntity, { stepId });
      }
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const taskId = crypto.randomUUID();
        await em.insert(DeployPipelineTaskEntity, {
          id: taskId,
          stepId,
          kind: t.kind,
          name: t.name.trim(),
          condition: t.condition?.trim() || null,
          env: t.env && Object.keys(t.env).length ? t.env : null,
          approval: t.kind === 'approval' ? t.approval ?? null : null,
          sort: t.sort ?? i,
          enabled: t.enabled ?? true,
          updatedBy: user ?? null,
        });
        if (t.kind === 'script') {
          const actions = t.actions ?? [];
          for (let j = 0; j < actions.length; j++) {
            const a = actions[j];
            // managed 以库中已托管为准（本步骤范围按动作名），前端传值仅新建托管时生效
            const wasManaged = oldManagedNames.has(a.name) || a.managed === true;
            await em.insert(DeployPipelineActionEntity, {
              id: crypto.randomUUID(),
              taskId,
              name: a.name.trim(),
              script: a.script,
              managed: wasManaged,
              sort: a.sort ?? j,
              enabled: a.enabled ?? true,
              updatedBy: user ?? null,
            });
          }
        }
      }
    });
    // 同上：事务提交后再读树
    return this.getTree(pipelineId);
  }

  /** 删除步骤（级联其任务与动作） */
  async deleteStep(pipelineId: string, stepId: string) {
    const step = await this.stepsRepo.findOne({ where: { id: stepId, pipelineId } });
    if (!step) throw new NotFoundException('步骤不存在');
    await this.dataSource.transaction(async (em) => {
      const tasks = await em.find(DeployPipelineTaskEntity, { where: { stepId } });
      if (tasks.length) {
        await em.delete(DeployPipelineActionEntity, { taskId: In(tasks.map((t) => t.id)) });
        await em.delete(DeployPipelineTaskEntity, { stepId });
      }
      await em.delete(DeployPipelineStepEntity, { id: stepId });
    });
    return { deleted: stepId };
  }
}
