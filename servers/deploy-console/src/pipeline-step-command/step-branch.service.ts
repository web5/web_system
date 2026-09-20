import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DeployPipelineStepBranchEntity } from '../entities/deploy-pipeline-step-branch.entity';
import { validateStepBranches, type StepBranchLike } from '../pipeline/steps/step-branch';
import { isWritableStageKey } from '../pipeline-template/template-node';

export interface StepBranchInput extends StepBranchLike {
  /** 空/未传 = 默认任务（兜底） */
  condition?: string | null;
}

/**
 * 步骤任务（分支）服务。
 *
 * 步骤 1:N 任务 —— 任务是独立实体（specs/pipeline-step-branch/design.md §3.1）：
 * 「这次发布跑了哪个任务」是结构化事实，不靠反解脚本。
 *
 * 保存语义：**全量覆盖**（列表即真相），逐条 `bash -n` + 条件表达式校验，
 * 校验不过整批拒绝（避免半套配置落库后运行时才炸）。
 */
@Injectable()
export class StepBranchService {
  constructor(
    @InjectRepository(DeployPipelineStepBranchEntity)
    private readonly repo: Repository<DeployPipelineStepBranchEntity>,
  ) {}

  /** 某步骤的任务列表（按匹配顺序） */
  async list(templateId: string, nodeKey: string): Promise<DeployPipelineStepBranchEntity[]> {
    return this.repo.find({
      where: { templateId, nodeKey, enabled: true },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
  }

  /** 全量保存（空数组 = 清空，回落到节点单一执行体） */
  async saveAll(
    templateId: string,
    nodeKey: string,
    branches: StepBranchInput[],
    updatedBy?: string,
  ): Promise<DeployPipelineStepBranchEntity[]> {
    if (!isWritableStageKey(nodeKey)) {
      throw new BadRequestException(`步骤 ${nodeKey} 不可配置任务（平台保留字）`);
    }
    const list = branches ?? [];
    const errs = validateStepBranches(list);
    if (errs.length) throw new BadRequestException(errs.join('；'));
    for (const b of list) this.validateShell(b.script);

    await this.repo.delete({ templateId, nodeKey });
    if (!list.length) return [];

    const rows = list.map((b, i) =>
      this.repo.create({
        templateId,
        nodeKey,
        name: b.name.trim(),
        label: b.label?.trim() || null,
        condition: String(b.condition ?? '').trim() || null,
        script: b.script,
        sort: b.sort ?? i,
        enabled: b.enabled !== false,
        updatedBy,
      }),
    );
    return this.repo.save(rows);
  }

  /** 清空某步骤的任务（回落到 command / actions 单一执行体） */
  async clear(templateId: string, nodeKey: string): Promise<void> {
    await this.repo.delete({ templateId, nodeKey });
  }

  /** 语法校验（bash -n） */
  private validateShell(script: string): void {
    if (!script?.trim()) throw new BadRequestException('任务脚本不能为空');
    const tmp = path.join(os.tmpdir(), `step-branch-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
    try {
      fs.writeFileSync(tmp, script, 'utf8');
      execSync(`bash -n "${tmp}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const stderr = (e as { stderr?: Buffer })?.stderr?.toString();
      throw new BadRequestException(`任务脚本语法错误：${stderr || (e as Error).message}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}
