import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DeployModuleStageCommandEntity,
  CONFIGURABLE_STAGES,
  DEFAULT_BUILD_TEMPLATE,
  STAGE_BUILTIN_DESCRIPTIONS,
  StageAction,
} from '../entities/deploy-module-stage-command.entity';
import { PIPELINE_STAGES } from '../entities/deploy-pipeline.entity';
import { isWritableStageKey } from '../pipeline-template/template-node';

const ALL_PIPELINE_STAGES = PIPELINE_STAGES as readonly string[];

export interface ResolvedStageCommand {
  command: string;
  timeoutSec?: number;
}

/**
 * 从一行记录取出要执行的操作序列（纯函数，便于单测）。
 *
 * 兼容优先：`actions` 为空时把存量 `command` 包装成单操作 ——
 * 保证 v4 上线后所有未迁移模块行为完全不变。
 */
export function pickActions(row: {
  actions?: StageAction[] | null;
  command?: string | null;
  timeoutSec?: number | null;
}): StageAction[] {
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

/**
 * 操作序列校验（纯函数，保存前调用）。
 * @returns 错误列表；空数组表示合法
 */
export function validateActions(actions: StageAction[]): string[] {
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
 * 「流水线阶段命令」对前端展示用的统一视图。
 *
 * `ModuleDetail / PipelineDetail` 通过这个视图一次性拿到：
 *  - 命令来源：`configured` / `builtin` / `required-unset` / `semantic`
 *    前端据此决定展示「用户脚本（带行号或复制按钮）」还是「流水线内置说明」
 *  - 命令原文：仅当来源为 `configured` 时回传（其它来源不暴露 shell，semantic 真相源
 *    不允许改，`required-unset` 等于「失败」而非可执行逻辑）
 *  - 内置说明：来源为 `builtin` 时回传 STAGE_BUILTIN_DESCRIPTIONS 中的中文描述，
 *    让运维在不改 shell 的前提下知道「不带脚本时会发生什么」
 *
 * 该视图不参与流水线执行路径——运行时仍按 commandMode（base / required / override /
 * none）在 step-registry 数据驱动分派，本接口只服务于 UI。
 */
export interface StageScriptView {
  stage: string;
  /** 命令来源标签 */
  source: 'configured' | 'builtin' | 'required-unset' | 'semantic';
  /** 已配置 shell 原文（仅 source=configured 时返回） */
  command: string | null;
  /** v4 多操作（节点内 1..N 个执行动作）；单命令形态也包装成 1 个操作 */
  actions: StageAction[];
  /** 是否启用（仅 source=configured 时有意义） */
  enabled: boolean;
  /** 超时秒数（仅 source=configured 时返回） */
  timeoutSec: number | null;
  /** 编辑人 / 时间（仅 source=configured 时返回） */
  updatedAt: string | null;
  updatedBy: string | null;
  /** 阶段中文标题 + 流程内置说明（始终返回，前端无需再做 key→label 映射） */
  title: string;
  builtin: string;
  /** commandMode：决定流水线对该阶段是「内置 / 必需 / 可覆盖 / 不可配置」 */
  commandMode: 'base' | 'required' | 'override' | 'none';
}

const STAGE_TITLES: Record<string, string> = {
  check: '校验',
  pull: '拉取代码',
  build: '构建',
  upload: '投递',
  restart: '重启',
  version: '写版本',
  pointer: '切指针',
  verify: '探活',
  cleanup: '清理',
};

/**
 * 流水线阶段 commandMode（与 step-registry 保持一致；调整任一处需同步另一处）。
 *
 * 视图层只读，不参与分流逻辑；存在这里是为了给前端一个「为什么这是 builtin」的依据：
 *  - required：build 阶段，未配置即 publish 终止（fail-fast）
 *  - base：check 阶段，恒内置 + 命令叠加
 *  - override：pull/upload/restart/verify/cleanup，配置则覆盖，否则走内置
 *  - none：version/pointer，发布语义真相源，固定由流水线执行
 */
const STAGE_COMMAND_MODE: Record<string, StageScriptView['commandMode']> = {
  check: 'base',
  pull: 'override',
  build: 'required',
  upload: 'override',
  restart: 'override',
  version: 'none',
  pointer: 'none',
  verify: 'override',
  cleanup: 'override',
};

/**
 * 阶段命令真相源：每模块每阶段一条 shell 命令。
 *
 * 替代历史上两套互斥机制（`deploy_modules.buildCmd` 与 `deploy_module_hooks`），
 * 见 specs/release-platform/design.md 决策 1。
 */
@Injectable()
export class StageCommandService {
  constructor(
    @InjectRepository(DeployModuleStageCommandEntity)
    private readonly repo: Repository<DeployModuleStageCommandEntity>,
  ) {}

  /** 解析模块某阶段命令；未配置或未启用返回 null */
  async resolve(moduleKey: string, stage: string): Promise<ResolvedStageCommand | null> {
    const row = await this.repo.findOne({ where: { moduleKey, stage, enabled: true } });
    if (!row?.command?.trim()) return null;
    return { command: row.command, timeoutSec: row.timeoutSec ?? undefined };
  }

  /**
   * 读取模块某脚本节点 key 的完整配置（含 actions），供 v5 节点编辑/查看使用。
   * 返回完整实体行（含 enabled/actions/timeoutSec），未配置返回 null。
   */
  async getRow(moduleKey: string, stage: string): Promise<DeployModuleStageCommandEntity | null> {
    return this.repo.findOne({ where: { moduleKey, stage } });
  }

  /**
   * 解析阶段内的操作序列（v4 多操作执行入口）。
   *
   * 空数组 = 该阶段没有可执行操作（调用方按 commandMode 走内置逻辑或 fail-fast）。
   */
  async resolveActions(moduleKey: string, stage: string): Promise<StageAction[]> {
    const row = await this.repo.findOne({ where: { moduleKey, stage, enabled: true } });
    if (!row) return [];
    return pickActions(row);
  }

  /**
   * shell 语法校验（bash -n）。
   *
   * 阶段命令是任意 shell，保存前必须校验：既防手滑语法错误导致发布中途失败，
   * 也避免把非法内容写进真相源。写临时文件而非 heredoc，规避命令体包含 EOF 的冲突。
   */
  validate(command: string): void {
    if (!command?.trim()) throw new BadRequestException('命令不能为空');
    const tmp = path.join(
      os.tmpdir(),
      `stage-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
    );
    try {
      fs.writeFileSync(tmp, command, 'utf8');
      execSync(`bash -n "${tmp}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const stderr = (e as { stderr?: Buffer })?.stderr?.toString();
      throw new BadRequestException(`shell 语法错误：${stderr || (e as Error).message}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** 按模块类型返回默认构建命令模板 */
  template(type: string): string | null {
    return DEFAULT_BUILD_TEMPLATE[type] ?? null;
  }

  /**
   * 组装「流水线脚本视图」：每阶段的命令来源、原文、内置说明、commandMode。
   *
   * 视图优先级：
   *   1) semantic（version/pointer）：固定由流水线执行；命令永远不返回。
   *   2) required（仅 build）：未配置 → `required-unset`（发布会失败）。已配置则展示。
   *   3) configured：DB 有启用命令 → 展示原文。
   *   4) builtin：DB 未配置（且非 required）→ 展示流程内置说明。
   *
   * 调用方：ModuleDetail 的「发布脚本」面板、PipelineDetail 实例步骤展开。
   *
   * 注：本方法只读 DB 不写、纯函数视图；与运行时分流无关（命令执行仍由
   * `pipeline.service.ts:executeStage` 的 `commandMode` 分派）。
   */
  async resolveView(moduleKey: string): Promise<StageScriptView[]> {
    const rows = await this.repo.find({ where: { moduleKey } });
    const map = new Map(rows.map((r) => [r.stage, r]));
    // 9 阶段齐全（含 version/pointer 这两个不可配置但仍要展示的语义真相源）。
    // 仅迭代 CONFIGURABLE_STAGES 会丢 2 阶段，前端「流水线步骤」面板就缺一块。
    return ALL_PIPELINE_STAGES.map((stage) => {
      const row = map.get(stage);
      const commandMode = STAGE_COMMAND_MODE[stage];
      const title = STAGE_TITLES[stage] ?? stage;
      const builtin = STAGE_BUILTIN_DESCRIPTIONS[stage] ?? '';
      // 视图层多操作：单命令形态也包装成 1 个操作，前端无需区分两种形态
      const acts = row ? pickActions(row) : [];

      // 发布语义真相源（version/pointer）：永远不准用户改，UI 上展示「流程内置」即可
      if (commandMode === 'none') {
        return {
          stage,
          source: 'semantic',
          actions: acts,
          command: null,
          enabled: false,
          timeoutSec: null,
          updatedAt: null,
          updatedBy: null,
          title,
          builtin,
          commandMode,
        };
      }

      const hasCmd = !!(row?.command && row.command.trim());
      // build 阶段：未配置 → required-unset；配置 → configured
      if (commandMode === 'required') {
        if (!hasCmd) {
          return {
            stage,
            source: 'required-unset',
          actions: acts,
            command: null,
            enabled: false,
            timeoutSec: null,
            updatedAt: null,
            updatedBy: null,
            title,
            builtin,
            commandMode,
          };
        }
        return {
          stage,
          source: 'configured',
          actions: acts,
          command: row!.command,
          enabled: row!.enabled,
          timeoutSec: row!.timeoutSec ?? null,
          updatedAt: row!.updatedAt ? row!.updatedAt.toISOString() : null,
          updatedBy: row!.updatedBy ?? null,
          title,
          builtin,
          commandMode,
        };
      }

      // base（check）/ override（其余）：已配置显示脚本，未配置显示 builtin 说明
      if (hasCmd) {
        return {
          stage,
          source: 'configured',
          actions: acts,
          command: row!.command,
          enabled: row!.enabled,
          timeoutSec: row!.timeoutSec ?? null,
          updatedAt: row!.updatedAt ? row!.updatedAt.toISOString() : null,
          updatedBy: row!.updatedBy ?? null,
          title,
          builtin,
          commandMode,
        };
      }
      return {
        stage,
        source: 'builtin',
          actions: acts,
        command: null,
        enabled: false,
        timeoutSec: null,
        updatedAt: null,
        updatedBy: null,
        title,
        builtin,
        commandMode,
      };
    });
  }

  /** 列出模块全部阶段命令 */
  async listByModule(moduleKey: string): Promise<DeployModuleStageCommandEntity[]> {
    return this.repo.find({ where: { moduleKey }, order: { stage: 'ASC' } });
  }

  /** 新增或更新阶段命令（页面配置入口） */
  async upsert(
    moduleKey: string,
    stage: string,
    command: string,
    updatedBy?: string,
    timeoutSec?: number,
    actions?: StageAction[],
  ): Promise<DeployModuleStageCommandEntity> {
    // v5 开放：任意 script 节点 key 可配；platform 保留字（git/version/pointer）与非法格式拒绝
    if (!isWritableStageKey(stage)) {
      throw new BadRequestException(
        `阶段 ${stage} 不可配置：git/version/pointer 为平台保留（发布语义真相源），key 须匹配 ^[A-Za-z0-9_-]{1,32}$`,
      );
    }

    // 多操作形态：逐条校验结构 + 每个 shell 操作做 bash -n
    const hasActions = !!(actions && actions.length);
    if (hasActions) {
      const errs = validateActions(actions!);
      if (errs.length) throw new BadRequestException(errs.join('；'));
      for (const a of actions!) {
        if (a.type === 'shell' && a.code?.trim()) this.validate(a.code);
      }
    } else {
      if (!command?.trim()) {
        throw new BadRequestException('命令不能为空');
      }
      this.validate(command); // 保存前 bash -n 语法校验
    }

    let row = await this.repo.findOne({ where: { moduleKey, stage } });
    if (!row) {
      row = this.repo.create({ moduleKey, stage, command: command?.trim() || '', enabled: true });
    } else {
      row.command = command?.trim() || '';
      row.enabled = true;
    }
    if (hasActions) {
      row.actions = actions!;
      // command 列非空约束：回填首个 shell 操作脚本，保证旧读取路径仍有内容
      const firstShell = actions!.find((a) => a.type === 'shell' && a.code?.trim());
      row.command = firstShell?.code?.trim() ?? '';
    } else if (row.actions?.length) {
      row.actions = null; // 回退到单命令形态
    }
    row.updatedBy = updatedBy;
    if (timeoutSec !== undefined) row.timeoutSec = timeoutSec;
    return this.repo.save(row);
  }

  /** 删除阶段命令（该阶段恢复为流水线内置逻辑） */
  async remove(moduleKey: string, stage: string): Promise<void> {
    await this.repo.delete({ moduleKey, stage });
  }
}
