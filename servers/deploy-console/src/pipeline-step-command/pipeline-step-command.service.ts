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
// 环境分支：把「每环境一段脚本」拼装成单一执行体（纯函数，见 specs/pipeline-env-branch/design.md）
import { buildEnvBranchScript } from '../pipeline/steps/env-branch';
// 步骤执行条件（gate）与步骤任务共用一套表达式引擎（specs/pipeline-step-branch/design.md §2）
import { validateCondition } from '../pipeline/steps/condition';

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
  async getRow(pipelineId: string, nodeKey: string): Promise<DeployPipelineStepCommandEntity | null> {
    return this.repo.findOne({ where: { pipelineId, nodeKey } });
  }

  /** 列出某流水线全部节点命令 */
  async listByTemplate(pipelineId: string): Promise<DeployPipelineStepCommandEntity[]> {
    return this.repo.find({ where: { pipelineId }, order: { nodeKey: 'ASC' } });
  }

  /**
   * 解析某流水线某节点的操作序列（运行时执行入口）。
   * 空数组 = 该节点没有可执行操作（调用方按 optional 走跳过或 fail-fast）。
   */
  async resolveActions(pipelineId: string, nodeKey: string): Promise<StepAction[]> {
    const row = await this.repo.findOne({ where: { pipelineId, nodeKey, enabled: true } });
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
    pipelineId: string,
    nodeKey: string,
    command: string,
    updatedBy?: string,
    timeoutSec?: number,
    actions?: StepAction[],
    /**
     * 环境分支配置（envId → 脚本）。
     * 传非空对象 = 启用环境分支（脚本由它拼装，覆盖 command/actions[shell].code）；
     * 传 null = 关闭环境分支（回到单一脚本形态）；不传 = 不改动。
     */
    envBranches?: Record<string, string> | null,
    /** 步骤执行条件（gate）：语法校验后落库；空串/null = 恒执行 */
    condition?: string | null,
  ): Promise<DeployPipelineStepCommandEntity> {
    if (!isWritableStageKey(nodeKey)) {
      throw new BadRequestException(
        `节点 ${nodeKey} 不可配置：${PLATFORM_RESERVED.join('/')} 为平台保留（发布语义真相源）`,
      );
    }
    await this.assertNotLocked(pipelineId, nodeKey);

    // 步骤执行条件（gate）：语法不过 → 400（运行期不再判错，避免"配了才发现不生效"）
    if (condition !== undefined && condition !== null && String(condition).trim()) {
      const check = validateCondition(condition);
      if (!check.ok) {
        throw new BadRequestException(`执行条件非法：${check.reason}`);
      }
    }

    // 环境分支：逐段校验 → 拼装单一执行体（未配置的环境落 fail-fast 分支）
    let generated: string | null = null;
    if (envBranches && Object.keys(envBranches).length) {
      for (const [env, code] of Object.entries(envBranches)) {
        try {
          this.validate(code);
        } catch (e) {
          throw new BadRequestException(
            `环境 ${env} 的脚本语法错误：${(e as Error).message?.replace(/^shell 语法错误：/, '')}`,
          );
        }
      }
      try {
        generated = buildEnvBranchScript(envBranches).script;
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      this.validate(generated);
    }

    const hasActions = !!(actions && actions.length);
    if (hasActions) {
      const errs = validateStepActions(actions!);
      if (errs.length) throw new BadRequestException(errs.join('；'));
      for (const a of actions!) {
        if (a.type === 'shell' && a.code?.trim()) this.validate(a.code);
      }
    } else if (generated) {
      // 环境分支形态：执行体由分支配置拼装，command 入参可为空（且会被覆盖）
    } else if (envBranches === null || condition !== undefined) {
      // 仅关闭环境分支 / 仅更新执行条件：command 未传时保留现有脚本，不做覆盖
      if (command?.trim()) this.validate(command);
    } else {
      if (!command?.trim()) {
        throw new BadRequestException('命令不能为空');
      }
      this.validate(command);
    }

    // command 未传且本次是「生成 / 关闭 / 改条件」时，保留库里既有脚本，不置空
    const keepCommand = !command?.trim() && (!!generated || envBranches === null || condition !== undefined);
    let row = await this.repo.findOne({ where: { pipelineId, nodeKey } });
    if (!row) {
      row = this.repo.create({ pipelineId, nodeKey, command: command?.trim() || '', enabled: true });
    } else if (!keepCommand) {
      row.command = command?.trim() || '';
      row.enabled = true;
    }
    if (hasActions) {
      row.actions = actions!;
      const firstShell = actions!.find((a) => a.type === 'shell' && a.code?.trim());
      row.command = firstShell?.code?.trim() ?? '';
    } else if (
      !generated &&
      envBranches === null &&
      condition === undefined &&
      row.actions?.length
    ) {
      // 仅「单一脚本形态」才清空多操作（避免 command 与 actions 双真相源）。
      // 以下三种情况**必须保留**原有操作（如 write-version），否则平台能力会被悄悄绕过去：
      //   ① 启用环境分支（generated 非空）
      //   ② 仅关闭环境分支（envBranches === null）
      //   ③ 仅更新执行条件（condition !== undefined）
      row.actions = null;
    }
    if (generated) {
      // 执行体真相源在 actions[shell].code（pickStepActions 优先取 actions），command 列同步写入
      row.command = generated;
      row.envBranches = envBranches!;
      if (row.actions?.length) {
        row.actions = row.actions.map((a) =>
          a && a.type === 'shell' ? { ...a, code: generated! } : a,
        );
      }
    } else if (envBranches === null) {
      // 关闭环境分支：回到单一脚本形态（当前 command / actions 保持不变）
      row.envBranches = null;
    }
    if (condition !== undefined) {
      row.condition = condition === null || !String(condition).trim() ? null : String(condition).trim();
    }
    row.updatedBy = updatedBy;
    if (timeoutSec !== undefined) row.timeoutSec = timeoutSec;
    return this.repo.save(row);
  }

  /** 删除节点命令（该节点回落流程内置逻辑） */
  async remove(pipelineId: string, nodeKey: string): Promise<void> {
    await this.assertNotLocked(pipelineId, nodeKey);
    await this.repo.delete({ pipelineId, nodeKey });
  }

  /**
   * 平台托管守卫：`locked=true` 的节点拒绝从接口改写。
   *
   * 为什么既有保留字又要这一层：`git` 本身已被 `isWritableStageKey` 挡在 upsert 之外，
   * 但 **remove 原先没有守卫**（可以整行删掉，拉码直接失效），且未来若要托管非保留字节点
   * （如某个平台脚本节点）也需要通用机制。平台脚本的写入通道只有一条：
   * `PlatformScriptSeedService`（随代码同步）——"谁能改发布语义基线"要有唯一答案。
   */
  private async assertNotLocked(pipelineId: string, nodeKey: string): Promise<void> {
    const row = await this.repo.findOne({ where: { pipelineId, nodeKey } });
    if (row?.locked) {
      throw new BadRequestException(
        `节点 ${nodeKey} 为平台托管（locked），不可编辑；如需变更请调整代码内置脚本（重启后自动同步）`,
      );
    }
  }
}
