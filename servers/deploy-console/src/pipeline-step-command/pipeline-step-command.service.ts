import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DeployPipelineStepCommandEntity,
  StepAction,
} from '../entities/deploy-pipeline-step-command.entity';
import { PLATFORM_RESERVED, isWritableStageKey } from '../pipeline-template/template-node';

/** 从一行记录取出要执行的操作序列（纯函数，复用 v4 pickActions 语义） */
export function pickStepActions(row: {
  actions?: StepAction[] | null;
  command?: string | null;
  timeoutSec?: number | null;
}): StepAction[] {
  const list = (row.actions ?? []).filter((a) => a && a.enabled !== false);
  if (list.length) return list;
  if (row.command?.trim()) {
    return [
      {
        id: 'a1',
        type: 'shell',
        name: '主操作',
        code: row.command.trim(),
        timeoutSec: row.timeoutSec ?? undefined,
      },
    ];
  }
  return [];
}

/** 操作序列校验（纯函数，保存前调用） */
export function validateStepActions(actions: StepAction[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  actions.forEach((a, i) => {
    const at = `操作#${i + 1}`;
    if (!a?.id) errs.push(`${at} 缺少 id`);
    else if (ids.has(a.id)) errs.push(`${at} id 重复: ${a.id}`);
    else ids.add(a.id);
    if (!a?.name?.trim()) errs.push(`${at} 缺少名称`);
    if (a?.type === 'shell' && !a.code?.trim()) errs.push(`${at}（${a.name}）shell 操作缺少脚本`);
    if (a?.type === 'service' && !a.tool?.trim()) {
      errs.push(`${at}（${a.name}）service 操作缺少工具 code`);
    }
    if (a && a.type !== 'shell' && a.type !== 'service') {
      errs.push(`${at} 未知操作类型: ${String(a.type)}`);
    }
  });
  return errs;
}

/**
 * 流水线节点命令服务（R6 新真相源：流水线 × 节点 key）。
 *
 * 取代 StageCommandService 的模块维度读写——命令归流水线，
 * 模块差异通过 {MODULE_*} 变量在运行时替换（design.md §3.1）。
 */
@Injectable()
export class PipelineStepCommandService {
  constructor(
    @InjectRepository(DeployPipelineStepCommandEntity)
    private readonly repo: Repository<DeployPipelineStepCommandEntity>,
  ) {}

  /** 读取某流水线某节点 key 的完整配置（含 actions）；未配置返回 null */
  async getRow(templateId: string, nodeKey: string): Promise<DeployPipelineStepCommandEntity | null> {
    return this.repo.findOne({ where: { templateId, nodeKey } });
  }

  /** 列出某流水线全部节点命令 */
  async listByTemplate(templateId: string): Promise<DeployPipelineStepCommandEntity[]> {
    return this.repo.find({ where: { templateId }, order: { nodeKey: 'ASC' } });
  }

  /**
   * 解析某流水线某节点的操作序列（运行时执行入口）。
   * 空数组 = 该节点没有可执行操作（调用方按 optional 走跳过或 fail-fast）。
   */
  async resolveActions(templateId: string, nodeKey: string): Promise<StepAction[]> {
    const row = await this.repo.findOne({ where: { templateId, nodeKey, enabled: true } });
    if (!row) return [];
    return pickStepActions(row);
  }

  /** shell 语法校验（bash -n） */
  validate(command: string): void {
    if (!command?.trim()) throw new BadRequestException('命令不能为空');
    const tmp = path.join(
      os.tmpdir(),
      `step-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
    );
    try {
      fs.writeFileSync(tmp, command, 'utf-8');
      execSync(`bash -n "${tmp}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const stderr = (e as { stderr?: Buffer })?.stderr?.toString();
      throw new BadRequestException(`shell 语法错误：${stderr || (e as Error).message}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** 新增或更新节点命令 */
  async upsert(
    templateId: string,
    nodeKey: string,
    command: string,
    updatedBy?: string,
    timeoutSec?: number,
    actions?: StepAction[],
  ): Promise<DeployPipelineStepCommandEntity> {
    if (!isWritableStageKey(nodeKey)) {
      throw new BadRequestException(
        `节点 ${nodeKey} 不可配置：${PLATFORM_RESERVED.join('/')} 为平台保留（发布语义真相源）`,
      );
    }
    await this.assertNotLocked(templateId, nodeKey);

    const hasActions = !!(actions && actions.length);
    if (hasActions) {
      const errs = validateStepActions(actions!);
      if (errs.length) throw new BadRequestException(errs.join('；'));
      for (const a of actions!) {
        if (a.type === 'shell' && a.code?.trim()) this.validate(a.code);
      }
    } else {
      if (!command?.trim()) {
        throw new BadRequestException('命令不能为空');
      }
      this.validate(command);
    }

    let row = await this.repo.findOne({ where: { templateId, nodeKey } });
    if (!row) {
      row = this.repo.create({ templateId, nodeKey, command: command?.trim() || '', enabled: true });
    } else {
      row.command = command?.trim() || '';
      row.enabled = true;
    }
    if (hasActions) {
      row.actions = actions!;
      const firstShell = actions!.find((a) => a.type === 'shell' && a.code?.trim());
      row.command = firstShell?.code?.trim() ?? '';
    } else if (row.actions?.length) {
      row.actions = null;
    }
    row.updatedBy = updatedBy;
    if (timeoutSec !== undefined) row.timeoutSec = timeoutSec;
    return this.repo.save(row);
  }

  /** 删除节点命令（该节点回落流程内置逻辑） */
  async remove(templateId: string, nodeKey: string): Promise<void> {
    await this.assertNotLocked(templateId, nodeKey);
    await this.repo.delete({ templateId, nodeKey });
  }

  /**
   * 平台托管守卫：`locked=true` 的节点拒绝从接口改写。
   *
   * 为什么既有保留字又要这一层：`git` 本身已被 `isWritableStageKey` 挡在 upsert 之外，
   * 但 **remove 原先没有守卫**（可以整行删掉，拉码直接失效），且未来若要托管非保留字节点
   * （如某个平台脚本节点）也需要通用机制。平台脚本的写入通道只有一条：
   * `PlatformScriptSeedService`（随代码同步）——"谁能改发布语义基线"要有唯一答案。
   */
  private async assertNotLocked(templateId: string, nodeKey: string): Promise<void> {
    const row = await this.repo.findOne({ where: { templateId, nodeKey } });
    if (row?.locked) {
      throw new BadRequestException(
        `节点 ${nodeKey} 为平台托管（locked），不可编辑；如需变更请调整代码内置脚本（重启后自动同步）`,
      );
    }
  }
}
