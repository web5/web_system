import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  DeployApprovalEntity,
  ApprovalStatus,
} from '../entities/deploy-approval.entity';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AuditService } from '../audit/audit.service';

/** 系统设置键：需要审批的环境列表（逗号分隔；未配置默认 prod） */
export const REQUIRE_APPROVAL_ENVS_KEY = 'REQUIRE_APPROVAL_ENVS';

/**
 * 审批单默认有效期：7 天。
 *
 * 🔴 为什么要有：`pending` 单此前**永不过期**，一张没人处理的 prod 单会永久卡住
 * 同模块同环境的后续提交（`create` 的 pending 查重直接 409），只能靠人工作废。
 * 7 天覆盖「跨周末 + 出差」的正常审批节奏，再长就应该重新发起（代码/分支可能已变）。
 *
 * 只对**新单**写入；历史单 `expires_at` 为 NULL = 不过期，不被扫描。
 */
export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ApprovalCreateSpec {
  pipelineId: string;
  env: string;
  moduleKey: string;
  mode: string;
  gitBranch?: string;
  commitId?: string;
  operator: string;
}

/** 节点级审批单（P0：审批成为流水线节点，可插任意位置） */
export interface NodeApprovalCreateSpec extends ApprovalCreateSpec {
  /** 审批节点 key（挂起/恢复锚点；同一流水线内唯一） */
  nodeKey: string;
  /** 节点展示名（留痕用，便于审批台看出卡在哪一步） */
  nodeLabel?: string;
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
    private readonly audit: AuditService,
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
    const dup = await this.pendingFor(spec.env, spec.moduleKey);
    if (dup) {
      throw new ConflictException(
        `模块 ${spec.moduleKey} 在 ${spec.env} 已有待审批的发布请求 ${dup.pipelineId}，请等待审批结果`,
      );
    }
    const now = Date.now();
    const row = this.repo.create({
      id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
      pipelineId: spec.pipelineId,
      env: spec.env,
      moduleKey: spec.moduleKey,
      mode: spec.mode,
      gitBranch: spec.gitBranch,
      commitId: spec.commitId,
      operator: spec.operator,
      status: 'pending',
      createdAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
    });
    return this.repo.save(row);
  }

  /**
   * 创建**节点级**审批单（P0 核心）。
   *
   * 与 `create`（流水线级门禁）的两点差异：
   *  1) 去重维度是 `(pipelineId, nodeKey)` 而非 `(env, moduleKey)` ——
   *     同一条流水线可以在不同节点多次审批；
   *  2) 重复触发同一节点时**复用已有待决单**（幂等），而不是抛冲突：
   *     引擎重试 / 恢复重入不该因为"已经挂起过"而让整条流水线失败。
   */
  async createNode(spec: NodeApprovalCreateSpec): Promise<DeployApprovalEntity> {
    const dup = await this.pendingForNode(spec.pipelineId, spec.nodeKey);
    if (dup) return dup;
    const now = Date.now();
    const row = this.repo.create({
      id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
      pipelineId: spec.pipelineId,
      nodeKey: spec.nodeKey,
      nodeLabel: spec.nodeLabel,
      env: spec.env,
      moduleKey: spec.moduleKey,
      mode: spec.mode,
      gitBranch: spec.gitBranch,
      commitId: spec.commitId,
      operator: spec.operator,
      status: 'pending',
      createdAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
    });
    return this.repo.save(row);
  }

  /**
   * 已超时但仍 `pending` 的审批单（供 `ApprovalExpiryService` 定时扫描）。
   *
   * 🔴 `expires_at IS NULL` 的老单**永远不会**被选中 —— 这正是「历史单不回填」的
   * 运行时保证：上线不会顺手清掉一批在途单。
   */
  async findExpiredPending(nowMs: number, limit = 100): Promise<DeployApprovalEntity[]> {
    return this.repo.find({
      where: { status: 'pending' as ApprovalStatus, expiresAt: LessThanOrEqual(nowMs) },
      order: { expiresAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * 某「环境 × 模块」当前**待决**的审批单（无则 null）。
   *
   * 独立成只读方法的原因：`release_plan` 要在**不写库**的前提下判断
   * "提交会不会撞上已有待审单而 409"，而判重原本内联在 `create()` 里。
   * 两边共用同一个方法，避免"plan 阶段说没冲突、提交时却 409"的口径分裂。
   */
  async pendingFor(env: string, moduleKey: string): Promise<DeployApprovalEntity | null> {
    return this.repo.findOne({
      where: { env, moduleKey, status: 'pending' as ApprovalStatus },
    });
  }

  /** 某流水线某节点**待决**的审批单（无则 null） */
  async pendingForNode(
    pipelineId: string,
    nodeKey: string,
  ): Promise<DeployApprovalEntity | null> {
    return this.repo.findOne({
      where: { pipelineId, nodeKey, status: 'pending' as ApprovalStatus },
    });
  }

  /** 某流水线当前**待决**的审批单（节点级优先；无则取最早的流水线级单） */
  async pendingForPipeline(pipelineId: string): Promise<DeployApprovalEntity | null> {
    const rows = await this.repo.find({
      where: { pipelineId, status: 'pending' as ApprovalStatus },
      order: { createdAt: 'ASC' },
    });
    return rows.find((r) => !!r.nodeKey) ?? rows[0] ?? null;
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

  /**
   * 作废（cancel）：把一张 **pending** 单标记为 `cancelled`。
   *
   * 业务场景：流水线的挂起实例随进程重启丢失后，审批单会永久停在 pending ——
   * 点进去也批不动（恢复时找不到锚点），但它仍会出现在「在途单」检查里，
   * 成了每次运维都要人工排除的噪声。cancel 就是给它一个**合法的终点**。
   *
   * 🔴 三条硬约束：
   *  1. **必须写原因**：没有原因就无法与「误点作废」区分，事后不可审计。
   *  2. **只动审批单，不动流水线**：cancel 表示「这单不再有决策对象」，
   *     不触发恢复也不触发终止；流水线自身状态由其运行记录负责。
   *  3. **CAS 而非先读后写**：`WHERE status='pending'` 把并发挤在数据库一侧。
   *     先 get 再 save 会把并发已 approved 的单覆盖成 cancelled —— 那等于
   *     抹掉一次真实审批留痕，比不做还糟。
   */
  async cancel(
    id: string,
    reason: string,
    actor: string,
  ): Promise<DeployApprovalEntity> {
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) {
      throw new BadRequestException('作废审批单必须填写原因');
    }
    const trimmedActor = (actor || '').trim();
    if (!trimmedActor) {
      throw new BadRequestException('作废审批单必须记录操作者');
    }

    const now = Date.now();
    const result = await this.repo
      .createQueryBuilder()
      .update(DeployApprovalEntity)
      .set({
        status: 'cancelled',
        reviewer: trimmedActor,
        comment: trimmedReason,
        reviewedAt: now,
      })
      .where('id = :id AND status = :pending', { id, pending: 'pending' })
      .execute();

    const affected = result?.affected ?? 0;
    if (affected !== 1) {
      const row = await this.repo.findOne({ where: { id } });
      if (!row) throw new NotFoundException(`审批单 ${id} 不存在`);
      throw new ConflictException(
        `审批单 ${id} 当前状态为 ${row.status}，只有 pending 可作废`,
      );
    }

    const after = await this.repo.findOne({ where: { id } });
    await this.audit
      .log({
        user: trimmedActor,
        action: 'approval.cancel',
        env: after?.env,
        component: 'approval',
        status: 'success',
        detail: `作废审批单 ${id}（原 pending）｜原因：${trimmedReason}｜流水线：${after?.pipelineId ?? '未知'}`,
      })
      .catch((err: Error) => {
        // 审计失败不回滚业务状态：单已作废是既成事实，补记即可
        this.logger.error(`作废审计写入失败 ${id}: ${err.message}`);
      });

    this.logger.warn(
      `审批单已作废 ${id} by ${trimmedActor}｜原因：${trimmedReason}`,
    );
    return after as DeployApprovalEntity;
  }
}
