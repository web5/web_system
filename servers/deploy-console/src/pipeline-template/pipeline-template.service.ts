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

const APPROVALS: TemplateApproval[] = ['inherit', 'always', 'never'];
const TARGETS: TemplateTarget[] = ['auto', 'local', 'remote'];
export const ROLLBACK_MODES = ['previous', 'none'] as const;
export type RollbackMode = (typeof ROLLBACK_MODES)[number];

/** 不可裁剪的语义/安全基线步骤（模板 steps 必须包含，且不可重排到产物产生前由保序保证） */
export const CORE_STAGES: readonly string[] = ['check', 'version', 'pointer'];

/**
 * 归一化模板活动阶段（纯函数，便于单测）：
 * - null/空 → null（= 全部九阶段）
 * - 仅可裁剪不可重排：必须是 PIPELINE_STAGES 的保序子序列
 * - 必含 check/version/pointer（安全校验与发布语义真相源）
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

export interface TemplateSpec {
  name: string;
  description?: string;
  /** 便捷开关（旧字段）：true 表示裁剪 verify；新输入建议用 steps 表达 */
  skipVerify?: boolean;
  /** 活动阶段子集（null/缺省=全量） */
  steps?: string[];
  /** verify 失败自动回滚 previous/none */
  rollbackOnFailure?: RollbackMode;
  approval?: TemplateApproval;
  defaultTarget?: TemplateTarget;
  enabled?: boolean;
}

/** 模板 id 生成 */
function genId(): string {
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 审批判定（纯函数，便于单测）：
 * - always → 必须审批（模板覆盖环境规则）
 * - never  → 免除审批
 * - inherit / 未设 → 沿用环境规则（needsApproval(env)）
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

/**
 * 流水线模板服务（S6-I）。
 *
 * 语义要点：
 * - 每模块懒建一条 builtin「默认」模板（不可删/改名），兼容旧提交（不传模板走默认）
 * - 模板属模块；name 模块内唯一（DB 唯一索引兜底）
 * - 实例在提交时落模板快照（templateId/templateName/skipVerify），模板事后修改不影响已提交实例
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

  /** steps 与 skipVerify 统一：显式 steps 优先；仅 skipVerify=true 时剔除 verify；否则全量 */
  private resolveSteps(spec: { steps?: string[]; skipVerify?: boolean }): string[] | null {
    if (spec.steps !== undefined) return normalizeSteps(spec.steps);
    if (spec.skipVerify === true) {
      return (PIPELINE_STAGES as readonly string[]).filter((s) => s !== 'verify') as string[];
    }
    return null;
  }

  /** 模块默认模板：不存在则懒建（内置，不可删/改名）；竞态下靠唯一键吞错重查 */
  async ensureDefault(moduleKey: string): Promise<DeployPipelineTemplateEntity> {
    const existing = await this.repo.findOne({ where: { moduleKey, builtin: true } });
    if (existing) return existing;
    const row = this.repo.create({
      id: genId(),
      moduleKey,
      name: DEFAULT_TEMPLATE_NAME,
      description: '默认发布流程：全量阶段 + 环境规则审批（不传模板即走此模板）',
      builtin: true,
      skipVerify: false,
      approval: 'inherit',
      defaultTarget: 'auto',
      enabled: true,
      createdBy: 'system',
    });
    try {
      return await this.repo.save(row);
    } catch {
      // 并发首建撞唯一键：返回已建成的默认模板
      const again = await this.repo.findOne({ where: { moduleKey, builtin: true } });
      if (again) return again;
      throw new BadRequestException(`创建 ${moduleKey} 默认模板失败，请重试`);
    }
  }

  /** 提交解析：显式 id → 校验归属与启用；否则模块默认模板 */
  async resolveForSubmit(
    moduleKey: string,
    templateId?: string,
  ): Promise<DeployPipelineTemplateEntity> {
    if (!templateId) return this.ensureDefault(moduleKey);
    const tpl = await this.get(templateId);
    if (tpl.moduleKey !== moduleKey) {
      throw new BadRequestException(`模板 ${templateId} 不属于模块 ${moduleKey}`);
    }
    if (!tpl.enabled) {
      throw new BadRequestException(`模板「${tpl.name}」已停用，请启用或改选其他模板`);
    }
    return tpl;
  }

  /** 模块模板列表（保证含 builtin 默认，在首位） */
  async listByModule(moduleKey: string): Promise<DeployPipelineTemplateEntity[]> {
    await this.ensureDefault(moduleKey);
    const rows = await this.repo.find({
      where: { moduleKey },
      order: { builtin: 'DESC', createdAt: 'ASC' },
    });
    return rows;
  }

  async get(id: string): Promise<DeployPipelineTemplateEntity> {
    const tpl = await this.repo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException(`流水线模板不存在: ${id}`);
    return tpl;
  }

  private async assertNameFree(moduleKey: string, name: string, exceptId?: string): Promise<void> {
    const dup = await this.repo.findOne({ where: { moduleKey, name } });
    if (dup && dup.id !== exceptId) {
      throw new ConflictException(`模块 ${moduleKey} 已存在同名模板「${name}」`);
    }
  }

  async create(moduleKey: string, spec: TemplateSpec, createdBy?: string): Promise<DeployPipelineTemplateEntity> {
    const name = spec.name?.trim();
    if (!name) throw new BadRequestException('模板名必填');
    this.assertApproval(spec.approval);
    this.assertTarget(spec.defaultTarget);
    await this.assertNameFree(moduleKey, name);
    this.assertRollback(spec.rollbackOnFailure);
    const steps = this.resolveSteps(spec);
    const row = this.repo.create({
      id: genId(),
      moduleKey,
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

  /** 复制模板（含默认）：复制全部策略为新模板，名称加「副本」 */
  async duplicate(id: string, createdBy?: string): Promise<DeployPipelineTemplateEntity> {
    const src = await this.get(id);
    const name = `${src.name} 副本`;
    await this.assertNameFree(src.moduleKey, name);
    const row = this.repo.create({
      id: genId(),
      moduleKey: src.moduleKey,
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
      await this.assertNameFree(tpl.moduleKey, name, id);
      tpl.name = name;
    }
    this.assertApproval(patch.approval);
    this.assertTarget(patch.defaultTarget);
    this.assertRollback(patch.rollbackOnFailure);
    if (patch.description !== undefined) tpl.description = patch.description.trim() || undefined;
    // steps 优先：显式 steps 重算 skipVerify；仅 skipVerify 时按开关归一化 steps
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
    tpl.createdBy = tpl.createdBy ?? updatedBy;
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
