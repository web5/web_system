import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import {
  DeployPipelineRevisionEntity,
  type PipelineApprovalSnapshot,
  type PipelineSnapshot,
} from '../entities/deploy-pipeline-revision.entity';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import { DeployPipelineStepEntity } from '../entities/deploy-pipeline-step.entity';
import { DeployPipelineTaskEntity } from '../entities/deploy-pipeline-task.entity';
import { DeployPipelineActionEntity } from '../entities/deploy-pipeline-action.entity';

/** 快照正文结构复用实体定义（单一真相源，避免两处漂移） */
export type { PipelineSnapshot };

export type RevisionSource = 'save-steps' | 'save-tasks' | 'delete-step' | 'restore' | 'seed';

/**
 * 流水线配置版本服务（2026-09-29）。
 *
 * 给「流水线定义」装一台时间机器：每次保存编排树（步骤/任务/动作，含脚本正文）
 * 生成一个 revision；可回看任意版本、可恢复到任意版本。
 *
 * 只增语义：恢复不是回到过去，而是**从旧快照长出一个新 revision** ——
 * 历史永不删除，审计链不断。
 */
@Injectable()
export class PipelineRevisionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DeployPipelineRevisionEntity)
    private readonly revisionsRepo: Repository<DeployPipelineRevisionEntity>,
    @InjectRepository(DeployPipelineTemplateEntity)
    private readonly templatesRepo: Repository<DeployPipelineTemplateEntity>,
    @InjectRepository(DeployPipelineStepEntity)
    private readonly stepsRepo: Repository<DeployPipelineStepEntity>,
    @InjectRepository(DeployPipelineTaskEntity)
    private readonly tasksRepo: Repository<DeployPipelineTaskEntity>,
    @InjectRepository(DeployPipelineActionEntity)
    private readonly actionsRepo: Repository<DeployPipelineActionEntity>,
  ) {}

  /** 读当前编排树并组装快照（不外泄实体内部字段） */
  private async buildSnapshot(pipelineId: string): Promise<PipelineSnapshot> {
    const pipeline = await this.templatesRepo.findOne({ where: { id: pipelineId } });
    if (!pipeline) throw new NotFoundException('流水线不存在');

    const steps = await this.stepsRepo.find({
      where: { pipelineId },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    const stepIds = steps.map((s) => s.id);
    const tasks = stepIds.length
      ? await this.tasksRepo.find({ where: { stepId: In(stepIds) }, order: { sort: 'ASC', createdAt: 'ASC' } })
      : [];
    const taskIds = tasks.map((t) => t.id);
    const actions = taskIds.length
      ? await this.actionsRepo.find({ where: { taskId: In(taskIds) }, order: { sort: 'ASC', createdAt: 'ASC' } })
      : [];

    const actionsByTask = new Map<string, DeployPipelineActionEntity[]>();
    for (const a of actions) {
      const list = actionsByTask.get(a.taskId) ?? [];
      list.push(a);
      actionsByTask.set(a.taskId, list);
    }
    const tasksByStep = new Map<string, DeployPipelineTaskEntity[]>();
    for (const t of tasks) {
      const list = tasksByStep.get(t.stepId) ?? [];
      list.push(t);
      tasksByStep.set(t.stepId, list);
    }

    return {
      pipeline: {
        id: pipeline.id,
        key: pipeline.key,
        name: pipeline.name,
        moduleKey: pipeline.moduleKey,
        env: pipeline.env ?? null,
        description: pipeline.description ?? null,
        approval: pipeline.approval,
        approvers: Array.isArray(pipeline.approvers) ? pipeline.approvers : null,
        defaultTarget: pipeline.defaultTarget,
        enabled: !!pipeline.enabled,
        builtin: !!pipeline.builtin,
        skipVerify: !!pipeline.skipVerify,
        rollbackOnFailure: pipeline.rollbackOnFailure,
        nodes: pipeline.nodes ? JSON.stringify(pipeline.nodes) : null,
      },
      steps: steps.map((s, si) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        sort: s.sort ?? si,
        enabled: s.enabled,
        tasks: (tasksByStep.get(s.id) ?? []).map((t, ti) => ({
          id: t.id,
          kind: t.kind,
          name: t.name,
          condition: t.condition ?? null,
          env: t.env ?? null,
          approval: (t.approval ?? null) as PipelineApprovalSnapshot | null,
          sort: t.sort ?? ti,
          enabled: t.enabled,
          actions: (actionsByTask.get(t.id) ?? []).map((a, ai) => ({
            id: a.id,
            name: a.name,
            script: a.script,
            managed: a.managed,
            sort: a.sort ?? ai,
            enabled: a.enabled,
          })),
        })),
      })),
    };
  }

  /**
   * 取号：事务内 `SELECT ... FOR UPDATE` 读-改-写。
   *
   * 两个坑（都踩过/差点踩）：
   *  1. 裸「读 rev → +1 → 写回」是跨语句读-改-写，并发保存会撞 `(pipeline_id, rev)`
   *     唯一键 → 业务已生效却报「请刷新重试」（契约评审 B2）。
   *  2. 改用 `UPDATE ... SET rev = LAST_INSERT_ID(rev+1)` + `SELECT LAST_INSERT_ID()` 看似原子，
   *     但 `dataSource.query()` **每次都新建 QueryRunner 并从池里取连接**，
   *     而 LAST_INSERT_ID() 是连接级值 → 两条语句可能落在不同连接，取到 0 或别处的 id
   *     （复审 R-B1）。故改为单事务内悲观锁读改写，天然同连接、且串行化并发。
   */
  private async allocateRev(pipelineId: string): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const row = await em.findOne(DeployPipelineTemplateEntity, {
        where: { id: pipelineId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('流水线不存在（取版本号失败）');
      const next = (row.rev ?? 0) + 1;
      await em.update(DeployPipelineTemplateEntity, { id: pipelineId }, { rev: next });
      return next;
    });
  }

  /**
   * 生成一个新版本快照（保存后调用）。
   * 返回新版本号；流水线实体的 rev 同步推进（原子取号，见 allocateRev）。
   */
  async snapshot(
    pipelineId: string,
    source: RevisionSource,
    summary?: string,
    user?: string,
    restoredFromRev?: number,
  ): Promise<number> {
    const pipeline = await this.templatesRepo.findOne({ where: { id: pipelineId } });
    if (!pipeline) throw new NotFoundException('流水线不存在');

    const nextRev = await this.allocateRev(pipelineId);
    const snapshot = await this.buildSnapshot(pipelineId);

    try {
      await this.revisionsRepo.insert({
        pipelineId,
        rev: nextRev,
        source,
        summary: summary ?? null,
        snapshot,
        restoredFromRev: restoredFromRev ?? null,
        createdBy: user ?? null,
      });
    } catch (e) {
      const msg = (e as { code?: string; message?: string })?.message ?? '';
      if ((e as { code?: string })?.code === 'ER_DUP_ENTRY' || msg.includes('Duplicate')) {
        throw new BadRequestException(
          `版本 ${nextRev} 已存在（并发保存）：请刷新后重试`,
        );
      }
      throw e;
    }
    await this.templatesRepo.update({ id: pipelineId }, { rev: nextRev });
    return nextRev;
  }

  /** 版本列表（不含正文，列表页只展示元信息） */
  async list(pipelineId: string) {
    // 存在性校验：否则对不存在的 id（或误传 run id）返回 200 空列表，
    // 未来给 Agent 调用时会「静默成功但什么都没有」
    const exists = await this.templatesRepo.findOne({ where: { id: pipelineId } });
    if (!exists) throw new NotFoundException('流水线不存在');

    const rows = await this.revisionsRepo.find({
      where: { pipelineId },
      order: { rev: 'DESC' },
      select: {
        id: true,
        pipelineId: true,
        rev: true,
        source: true,
        summary: true,
        restoredFromRev: true,
        createdBy: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      rev: r.rev,
      source: r.source,
      summary: r.summary ?? null,
      restoredFromRev: r.restoredFromRev ?? null,
      createdBy: r.createdBy ?? null,
      createdAt: r.createdAt,
    }));
  }

  /** 单个版本（含完整快照正文） */
  async get(pipelineId: string, rev: number) {
    const row = await this.revisionsRepo.findOne({ where: { pipelineId, rev } });
    if (!row) throw new NotFoundException(`版本 ${rev} 不存在`);
    return {
      id: row.id,
      rev: row.rev,
      source: row.source,
      summary: row.summary ?? null,
      restoredFromRev: row.restoredFromRev ?? null,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt,
      snapshot: row.snapshot,
    };
  }

  /**
   * 恢复到指定版本。
   *
   * 语义：**不回退历史** —— 以旧快照全量重建当前编排树（保留原 id，引用不漂移），
   * 然后追加一个新 revision（source='restore'）。
   */
  async restore(pipelineId: string, rev: number, user?: string, expectedRev?: number) {
    const target = await this.revisionsRepo.findOne({ where: { pipelineId, rev } });
    if (!target) throw new NotFoundException(`版本 ${rev} 不存在`);
    const snap = target.snapshot as PipelineSnapshot;
    if (!snap || !Array.isArray(snap.steps)) {
      throw new BadRequestException(`版本 ${rev} 快照结构损坏，无法恢复`);
    }

    // 乐观锁：调用方基于的版本号已不是当前版本 → 有人先改过，拒绝覆盖
    if (expectedRev != null) {
      const current = await this.templatesRepo.findOne({ where: { id: pipelineId } });
      if ((current?.rev ?? 0) !== expectedRev) {
        throw new ConflictException(
          `配置已被他人修改：当前版本 ${current?.rev ?? 0}，你基于 ${expectedRev}，请刷新后重试`,
        );
      }
    }

    // 恢复前先给「当前这棵树」留一份快照 —— 恢复本身也要可反悔（发布评审 C6）
    await this.snapshot(
      pipelineId,
      'restore',
      `恢复前自动快照（即将恢复到版本 ${rev}）`,
      user,
    );

    await this.dataSource.transaction(async (em) => {
      // 清空当前编排树（动作 → 任务 → 步骤）
      const oldSteps = await em.find(DeployPipelineStepEntity, { where: { pipelineId } });
      const oldStepIds = oldSteps.map((s) => s.id);
      const oldTasks = oldStepIds.length
        ? await em.find(DeployPipelineTaskEntity, { where: { stepId: In(oldStepIds) } })
        : [];
      const oldTaskIds = oldTasks.map((t) => t.id);
      if (oldTaskIds.length) {
        await em.delete(DeployPipelineActionEntity, { taskId: In(oldTaskIds) });
        await em.delete(DeployPipelineTaskEntity, { stepId: In(oldStepIds) });
      }
      if (oldStepIds.length) {
        await em.delete(DeployPipelineStepEntity, { id: In(oldStepIds) });
      }

      // 按快照重建（保留 id）
      for (let si = 0; si < snap.steps.length; si++) {
        const s = snap.steps[si];
        await em.insert(DeployPipelineStepEntity, {
          id: s.id,
          pipelineId,
          name: s.name,
          description: s.description ?? null,
          sort: s.sort ?? si,
          enabled: s.enabled ?? true,
          updatedBy: user ?? null,
        });
        const tasks = Array.isArray(s.tasks) ? s.tasks : [];
        for (let ti = 0; ti < tasks.length; ti++) {
          const t = tasks[ti];
          await em.insert(DeployPipelineTaskEntity, {
            id: t.id,
            stepId: s.id,
            kind: t.kind,
            name: t.name,
            condition: t.condition ?? null,
            env: t.env ?? null,
            approval: t.kind === 'approval' ? (t.approval ?? null) : null,
            sort: t.sort ?? ti,
            enabled: t.enabled ?? true,
            updatedBy: user ?? null,
          });
          const actions = Array.isArray(t.actions) ? t.actions : [];
          for (let ai = 0; ai < actions.length; ai++) {
            const a = actions[ai];
            await em.insert(DeployPipelineActionEntity, {
              id: a.id,
              taskId: t.id,
              name: a.name,
              script: a.script,
              managed: a.managed ?? false,
              sort: a.sort ?? ai,
              enabled: a.enabled ?? true,
              updatedBy: user ?? null,
            });
          }
        }
      }
    });

    const newRev = await this.snapshot(
      pipelineId,
      'restore',
      `从版本 ${rev} 恢复`,
      user,
      rev,
    );
    return { rev: newRev, restoredFromRev: rev };
  }
}
