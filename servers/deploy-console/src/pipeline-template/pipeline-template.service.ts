import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DeployPipelineTemplateEntity,
  TemplateApproval,
  TemplateTarget,
} from '../entities/deploy-pipeline-template.entity';
import { PIPELINE_STAGES } from '../entities/deploy-pipeline.entity';

export const DEFAULT_TEMPLATE_NAME = '默认';
/** 全局模板标记：moduleKey='*' 表示通用流水线（不绑定模块，执行时选目标模块） */
export const GLOBAL_TEMPLATE = '*';

const APPROVALS: TemplateApproval[] = ['inherit', 'always', 'never'];
const TARGETS: TemplateTarget[] = ['auto', 'local', 'remote'];
export const ROLLBACK_MODES = ['previous', 'none'] as const;
export type RollbackMode = (typeof ROLLBACK_MODES)[number];

/** 不可裁剪的语义/安全基线步骤 */
export const CORE_STAGES: readonly string[] = ['check', 'version', 'pointer'];

/**
 * 归一化模板活动阶段（纯函数）：
 * null/空 → null（= 全部九阶段）；仅可裁剪不可重排；必含 check/version/pointer。
 */
export function normalizeSteps(steps?: (string | null | undefined)[] | null): string[] | null {
  if (!steps || steps.length === 0) return null;
  const s = steps.filter((x): x is string => !!x);
  if (new Set(s).size !== s.length) {
    throw new BadRequestException('步骤不能重复');
  }
  for (const x of s) {
    if (!(PIPELINE_STAGES as readonly string[]).includes(x)) {
      throw new BadRequestException(`非法步骤: ${x}（内置步骤: ${PIPELINE_STAGES.join(' / ')}）`);
    }
  }
  const ordered = (PIPELINE_STAGES as readonly string[]).filter((st) => s.includes(st));
  if (ordered.join(',') !== s.join(',')) {
    throw new BadRequestException('步骤仅可裁剪、不可重排（顺序必须与内置流程一致）');
  }
  for (const core of CORE_STAGES) {
    if (!s.includes(core)) {
      throw new BadRequestException(`步骤必须保留「${core}」（安全校验/发布语义基线，不可裁剪）`);
    }
  }
  return s;
}

/**
 * 审批判定（纯函数）：always→要审；never→免审；inherit/未设→沿用环境规则。
 */
export function needsApprovalForTemplate(
  tpl: { approval?: string } | null | undefined,
  envNeedsApproval: boolean,
): boolean {
  const a = tpl?.approval;
  if (a === 'always') return true;
  if (a === 'never') return false;
  return envNeedsApproval;
}

export interface TemplateSpec {
  name: string;
  description?: string;
  skipVerify?: boolean;
  steps?: string[];
  rollbackOnFailure?: RollbackMode;
  approval?: TemplateApproval;
  defaultTarget?: TemplateTarget;
  enabled?: boolean;
}

function genId(): string {
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 流水线模板服务（全局化版本，S6 演进）。
 *
 * **流水线不跟模块走**：
 * - 模板是全局资产（moduleKey='*'，GLOBAL_TEMPLATE），执行时再选目标模块；
 * - 历史"模块专属模板"（moduleKey 为具体模块）兼容保留：提交时可被引用、列表可用；
 * - 全局懒建一条不可删的 builtin「默认」模板（全流程+环境规则审批），
 *   不传模板的提交/MCP 即走它，行为与旧版完全一致。
 */
@Injectable()
export class PipelineTemplateService {
  constructor(
    @InjectRepository(DeployPipelineTemplateEntity)
    private readonly repo: Repository<DeployPipelineTemplateEntity>,
  ) {}

  private assertApproval(a?: TemplateApproval): void {
    if (a !== undefined && !APPROVALS.includes(a)) {
      throw new BadRequestException(`approval 仅支持 ${APPROVALS.join('/')}`);
    }
  }

  private assertTarget(t?: TemplateTarget): void {
    if (t !== undefined && !TARGETS.includes(t)) {
      throw new BadRequestException(`defaultTarget 仅支持 ${TARGETS.join('/')}`);
    }
  }

  private assertRollback(m?: RollbackMode): void {
    if (m !== undefined && !ROLLBACK_MODES.includes(m)) {
      throw new BadRequestException(`rollbackOnFailure 仅支持 ${ROLLBACK_MODES.join('/')}`);
    }
  }

  private resolveSteps(spec: { steps?: string[]; skipVerify?: boolean }): string[] | null {
    if (spec.steps !== undefined) return normalizeSteps(spec.steps);
    if (spec.skipVerify === true) {
      return (PIPELINE_STAGES as readonly string[]).filter((s) => s !== 'verify') as string[];
    }
    return null;
  }

  /** 全局默认模板：懒建（builtin 不可删/改名）；竞态靠唯一键吞错重查 */
  async ensureDefault(): Promise<DeployPipelineTemplateEntity> {
    const existing = await this.repo.findOne({
      where: { moduleKey: GLOBAL_TEMPLATE, builtin: true },
    });
    if (existing) return existing;
    const row = this.repo.create({
      id: genId(),
      moduleKey: GLOBAL_TEMPLATE,
      name: DEFAULT_TEMPLATE_NAME,
      description: '默认发布流程：全流程 + 环境规则审批（不传模板即走此模板）',
      builtin: true,
      steps: null,
      skipVerify: false,
      rollbackOnFailure: 'previous',
      approval: 'inherit',
      defaultTarget: 'auto',
      enabled: true,
      createdBy: 'system',
    });
    try {
      return await this.repo.save(row);
    } catch {
      const again = await this.repo.findOne({
        where: { moduleKey: GLOBAL_TEMPLATE, builtin: true },
      });
      if (again) return again;
      throw new BadRequestException('创建全局默认模板失败，请重试');
    }
  }

  /**
   * 提交解析：显式 id → 校验「全局模板 或 属于该模块的专属模板」且启用；
   * 未传 → 全局默认模板。
   */
  async resolveForSubmit(
    moduleKey: string,
    templateId?: string,
  ): Promise<DeployPipelineTemplateEntity> {
    if (!templateId) return this.ensureDefault();
    const tpl = await this.get(templateId);
    if (tpl.moduleKey !== GLOBAL_TEMPLATE && tpl.moduleKey !== moduleKey) {
      throw new BadRequestException(`模板 ${templateId} 不可用于模块 ${moduleKey}（仅全局或该模块专属）`);
    }
    if (!tpl.enabled) {
      throw new BadRequestException(`模板「${tpl.name}」已停用，请启用或改选其他模板`);
    }
    return tpl;
  }

  /** 该模块可用的模板列表（全局模板 + 模块专属，全局默认置顶） */
  async listUsable(moduleKey: string): Promise<DeployPipelineTemplateEntity[]> {
    await this.ensureDefault();
    const rows = await this.repo.find({
      where: [{ moduleKey: GLOBAL_TEMPLATE }, { moduleKey }],
      order: { builtin: 'DESC', createdAt: 'ASC' },
    });
    return rows;
  }

  /** 全部模板（流水线中心管理视图） */
  async listAll(): Promise<DeployPipelineTemplateEntity[]> {
    await this.ensureDefault();
    return this.repo.find({ order: { moduleKey: 'ASC', builtin: 'DESC', createdAt: 'ASC' } });
  }

  async get(id: string): Promise<DeployPipelineTemplateEntity> {
    const tpl = await this.repo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException(`流水线模板不存在: ${id}`);
    return tpl;
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const dup = await this.repo.findOne({ where: { moduleKey: GLOBAL_TEMPLATE, name } });
    if (dup && dup.id !== exceptId) {
      throw new ConflictException(`已存在同名全局模板「${name}」`);
    }
  }

  /** 创建全局模板（流水线独立于模块） */
  async create(spec: TemplateSpec, createdBy?: string): Promise<DeployPipelineTemplateEntity> {
    const name = spec.name?.trim();
    if (!name) throw new BadRequestException('模板名必填');
    this.assertApproval(spec.approval);
    this.assertTarget(spec.defaultTarget);
    this.assertRollback(spec.rollbackOnFailure);
    await this.assertNameFree(name);
    const steps = this.resolveSteps(spec);
    const row = this.repo.create({
      id: genId(),
      moduleKey: GLOBAL_TEMPLATE,
      name,
      description: spec.description?.trim() || undefined,
      steps,
      skipVerify: steps ? !steps.includes('verify') : (spec.skipVerify ?? false),
      rollbackOnFailure: spec.rollbackOnFailure ?? 'previous',
      approval: spec.approval ?? 'inherit',
      defaultTarget: spec.defaultTarget ?? 'auto',
      enabled: spec.enabled ?? true,
      builtin: false,
      createdBy,
    });
    return this.repo.save(row);
  }

  /** 复制模板 */
  async duplicate(id: string, createdBy?: string): Promise<DeployPipelineTemplateEntity> {
    const src = await this.get(id);
    const name = `${src.name} 副本`;
    await this.assertNameFree(name);
    const row = this.repo.create({
      id: genId(),
      moduleKey: GLOBAL_TEMPLATE,
      name,
      description: `${src.description ?? src.name}（副本）`,
      steps: src.steps ?? null,
      skipVerify: src.skipVerify,
      rollbackOnFailure: src.rollbackOnFailure ?? 'previous',
      approval: src.approval,
      defaultTarget: src.defaultTarget,
      enabled: src.enabled,
      builtin: false,
      createdBy,
    });
    return this.repo.save(row);
  }

  async update(
    id: string,
    patch: Partial<Omit<TemplateSpec, 'name'>> & { name?: string },
    updatedBy?: string,
  ): Promise<DeployPipelineTemplateEntity> {
    const tpl = await this.get(id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('模板名不能为空');
      if (tpl.builtin) {
        throw new BadRequestException('内置默认模板不可改名');
      }
      await this.assertNameFree(name, id);
      tpl.name = name;
    }
    this.assertApproval(patch.approval);
    this.assertTarget(patch.defaultTarget);
    this.assertRollback(patch.rollbackOnFailure);
    if (patch.description !== undefined) tpl.description = patch.description?.trim() || undefined;
    if (patch.steps !== undefined) {
      tpl.steps = normalizeSteps(patch.steps);
      tpl.skipVerify = tpl.steps ? !tpl.steps.includes('verify') : (patch.skipVerify ?? false);
    } else if (patch.skipVerify !== undefined) {
      tpl.skipVerify = patch.skipVerify;
      tpl.steps = patch.skipVerify
        ? ([...PIPELINE_STAGES] as string[]).filter((s) => s !== 'verify')
        : [...PIPELINE_STAGES];
    }
    if (patch.rollbackOnFailure !== undefined) tpl.rollbackOnFailure = patch.rollbackOnFailure;
    if (patch.approval !== undefined) tpl.approval = patch.approval;
    if (patch.defaultTarget !== undefined) tpl.defaultTarget = patch.defaultTarget;
    if (patch.enabled !== undefined) tpl.enabled = patch.enabled;
    return this.repo.save(tpl);
  }

  async remove(id: string): Promise<void> {
    const tpl = await this.get(id);
    if (tpl.builtin) {
      throw new BadRequestException('内置默认模板不可删除');
    }
    await this.repo.delete(id);
  }
}
