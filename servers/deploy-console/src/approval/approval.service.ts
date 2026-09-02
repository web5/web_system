import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DeployApprovalEntity,
  ApprovalStatus,
} from '../entities/deploy-approval.entity';
import { SystemSettingsService } from '../system-settings/system-settings.service';

/** 系统设置键：需要审批的环境列表（逗号分隔；未配置默认 prod） */
export const REQUIRE_APPROVAL_ENVS_KEY = 'REQUIRE_APPROVAL_ENVS';

export interface ApprovalCreateSpec {
  pipelineId: string;
  env: string;
  moduleKey: string;
  mode: string;
  gitBranch?: string;
  commitId?: string;
  operator: string;
}

/**
 * 发布审批门禁。
 *
 * 职责边界：只管理审批单的创建 / 状态机 / 环境判定，**不直接执行发布**。
 * 「审批通过后恢复流水线执行」由 PipelineService 负责（审批通过 → 触发 run），
 * 避免本模块反向依赖 pipeline 造成循环。
 *
 * 门禁规则：prod 发布需审批；「哪些环境要审批」由系统设置
 * `REQUIRE_APPROVAL_ENVS`（逗号分隔）控制，未配置时默认只要求 prod。
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    @InjectRepository(DeployApprovalEntity)
    private readonly repo: Repository<DeployApprovalEntity>,
    private readonly settings: SystemSettingsService,
  ) {}

  /**
   * 该环境是否需要审批。
   * 从系统设置读取（页面可配），env 兜底：未配置任何值时默认 ["prod"]。
   */
  async needsApproval(env: string): Promise<boolean> {
    const raw = await this.settings.get(REQUIRE_APPROVAL_ENVS_KEY);
    const list = (raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // 未配置或配置了空值（全空白）都视为默认规则：仅 prod 需审批
    const effective = list.length > 0 ? list : ['prod'];
    return effective.includes(env);
  }

  /** 创建审批单（同一 env+moduleKey 不允许重复待审批单） */
  async create(spec: ApprovalCreateSpec): Promise<DeployApprovalEntity> {
    const dup = await this.repo.findOne({
      where: { env: spec.env, moduleKey: spec.moduleKey, status: 'pending' as ApprovalStatus },
    });
    if (dup) {
      throw new ConflictException(
        `模块 ${spec.moduleKey} 在 ${spec.env} 已有待审批的发布请求 ${dup.pipelineId}，请等待审批结果`,
      );
    }
    const row = this.repo.create({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      pipelineId: spec.pipelineId,
      env: spec.env,
      moduleKey: spec.moduleKey,
      mode: spec.mode,
      gitBranch: spec.gitBranch,
      commitId: spec.commitId,
      operator: spec.operator,
      status: 'pending',
      createdAt: Date.now(),
    });
    return this.repo.save(row);
  }

  async get(id: string): Promise<DeployApprovalEntity> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`审批单不存在: ${id}`);
    return row;
  }

  /** 某流水线的审批单（一个流水线至多一张） */
  async byPipelineId(pipelineId: string): Promise<DeployApprovalEntity | null> {
    return this.repo.findOne({ where: { pipelineId } });
  }

  list(status?: string): Promise<DeployApprovalEntity[]> {
    return this.repo.find({
      where: status ? { status: status as ApprovalStatus } : {},
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  /**
   * 审批（approve/reject）。已处理的单不可二次审批（幂等保护）。
   */
  async resolve(
    id: string,
    action: 'approve' | 'reject',
    reviewer: string,
    comment?: string,
  ): Promise<DeployApprovalEntity> {
    const row = await this.get(id);
    if (row.status !== 'pending') {
      throw new ConflictException(`审批单 ${id} 已处理（${row.status}），不能重复审批`);
    }
    row.status = action === 'approve' ? 'approved' : 'rejected';
    row.reviewer = reviewer;
    row.comment = comment?.trim() || undefined;
    row.reviewedAt = Date.now();
    return this.repo.save(row);
  }
}
