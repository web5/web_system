import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalService } from '../approval/approval.service';
import { ApproverService } from '../approval/approver.service';
import { AuditService } from '../audit/audit.service';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { PipelineService } from '../pipeline/pipeline.service';
import { ApprovalNode } from '../pipeline-template/template-node';
import { WecomConfigService } from './wecom.config';

/**
 * 企微审批执行（卡② T2-d / V3–V8 / V10）。
 *
 * 🔴 只**调用**既有 `PipelineService.approve/reject` 与 `ApprovalService`，
 * 不复制任何状态机逻辑；企微通道的增量只有：身份来源、CAS 领权、
 * prod 二次确认、审计三列、脱敏详情。
 */

export interface WecomActor {
  username: string;
  /** 企微 userid（外部身份 ID） */
  ext: string;
  /** 短令牌绑定的审批单 */
  approvalId: string;
}

export interface WecomDecisionBody {
  confirm?: boolean;
  comment?: string;
}

export interface WecomApprovalDetail {
  approvalId: string;
  status: string;
  env: string;
  moduleKey: string;
  mode: string;
  versionTag?: string;
  gitBranch?: string;
  commitId?: string;
  operator: string;
  /** 提交人用户名（由 operator 的 userId 反查；查不到时为 undefined，前端回落显示 operator） */
  operatorName?: string;
  createdAt: number;
  nodeKey?: string;
  nodeLabel?: string;
  pipelineId: string;
  /**
   * 所属流水线模板 id。
   * 控制台 `/console/pipelines/:id` 的 `:id` 是模板 id，不是运行实例 id ——
   * 前端必须用 `templateId` + `?run=pipelineId` 才能直接落到这次运行的详情。
   */
  templateId?: string;
  pipelineStatus: string;
  reviewer?: string;
  reviewedAt?: number;
  /** 前端 S2：prod 必须先过确认层 */
  requiresConfirm: boolean;
  /** S1 首屏：最近 3 个已完成节点（按节点顺序 + 挂起锚点推导） */
  recentNodes: Array<{ key: string; label: string; result: string }>;
}

export interface WecomDecisionResult {
  approvalId: string;
  status: 'approved' | 'rejected';
  pipelineStatus: string;
  resumedFrom?: string;
  /** 明确区分「审批结果」与「发布结果」 */
  message: string;
}

/**
 * 移动端只读运行快照（S5）。
 *
 * 🔴 **为什么要有它**：S4 之后审批人真正想知道的是「这次发布到底成没成」。
 * 让这个只读动作去换平台会话（方案 C）等于为了看一眼结果交一次后台权限。
 * 这个端点用**同一张审批票据**回答同一个问题，凭据面不出审批域。
 *
 * 🔴 **刻意不给的东西**：日志正文、绝对路径、环境变量、编排快照全文。
 * 卡② 的脱敏边界不因为「换个页面」而放松。要看日志去桌面。
 */
export interface WecomRunSnapshot {
  runId: string;
  approvalId: string;
  /** 模板 id（桌面链接要用它，不是运行 id） */
  templateId?: string;
  templateName?: string;
  env: string;
  moduleKey: string;
  mode: string;
  status: string;
  stage?: string;
  /**
   * 本次运行实际活动的节点（顺序即执行顺序）。
   * 状态由**前端**用 `pipeline.stages.ts` 的 `stepState` 推导 —— 后端不复制展示状态机，
   * 否则「桌面看到的」和「手机看到的」会各自漂移。
   */
  stages: Array<{ key: string; label?: string; kind?: string }>;
  progress?: { current: number; total: number; message?: string };
  versionTag?: string;
  gitBranch?: string;
  gitCommit?: string;
  triggerSource?: string;
  operator: string;
  operatorName?: string;
  startTime: number;
  endTime?: number;
  /** 失败摘要（只取首行 + 抹掉绝对路径，最多 180 字） */
  errorBrief?: string;
  /** 本次审批所在节点 */
  nodeLabel?: string;
  /** 仍在跑/等审批 → 前端轮询 */
  live: boolean;
}

/** 运行中的状态集合（与前端 isLive 保持同义，仅用于告知前端是否轮询） */
const LIVE_PIPELINE_STATUSES = ['running', 'pending', 'pending-approval', 'awaiting-approval'];

const TERMINAL_PIPELINE_STATUSES = ['cancelled', 'failed', 'succeeded', 'rejected'];

@Injectable()
export class WecomApprovalService {
  private readonly logger = new Logger(WecomApprovalService.name);

  /**
   * `viewRun` 审计去重表：`approvalId → 上次记录的 {ts, status}`。
   *
   * 🔴 为什么要去重：S5 页面在 `live` 状态会轮询（前端 5s 一次），每次轮询都落一条
   * `wecom.viewRun` 会把审计表灌成访问日志，真正要看「谁看过这次发布」时反而被噪声埋掉。
   *
   * 规则：同单 5 分钟内同状态只记第一条；`pipeline.status` 变化时**额外记一条**
   * （状态跃迁才是审计关心的事）；超过 5 分钟再访问算一次新的「查看行为」。
   *
   * ⚠️ 进程内 Map，前提是 console 单实例 pm2 部署。**多实例时必须换 DB/Redis**，
   * 否则每实例各记一条 = 去重失效（不会更糟，只是白记）。
   */
  private readonly viewRunSeen = new Map<string, { ts: number; status: string }>();

  /** 同单同状态的 viewRun 审计窗口 */
  static readonly VIEWRUN_DEDUP_MS = 5 * 60 * 1000;
  /** 去重表容量上限（超限丢最旧，防长期运行内存缓慢增长） */
  private static readonly VIEWRUN_SEEN_MAX = 500;

  constructor(
    private readonly config: WecomConfigService,
    private readonly approvals: ApprovalService,
    private readonly approvers: ApproverService,
    private readonly pipelines: PipelineService,
    private readonly audit: AuditService,
    @InjectRepository(DeployApprovalEntity)
    private readonly repo: Repository<DeployApprovalEntity>,
  ) {}

  /** 通道关闭时端点语义上不存在（V12） */
  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new NotFoundException('企微审批通道未启用');
    }
  }

  private nodeApprovers(approval: DeployApprovalEntity, pipeline: { nodes?: unknown }): string[] | undefined {
    const nodes = Array.isArray(pipeline.nodes) ? (pipeline.nodes as ApprovalNode[]) : [];
    const node = nodes.find((n) => n && n.key === (approval.nodeKey ?? ''));
    return node && node.kind === 'approval' ? node.approvers : undefined;
  }

  /**
   * 🔴 W-a fail-closed：既有 ApproverService 在 user-service 不可达时返回
   * `degraded=true` 且 `ok=true`（降级放行）。企微通道里身份服务是唯一身份来源，
   * 放行等于谁都能批 prod —— 这里把 degraded 一律当拒绝。
   */
  private async assertCanReview(
    approval: DeployApprovalEntity,
    actor: WecomActor,
    pipeline: { nodes?: unknown },
  ): Promise<void> {
    if (actor.approvalId !== approval.id) {
      throw new ForbiddenException('短令牌与审批单不匹配');
    }
    const gate = await this.approvers.canApprove(actor.username, this.nodeApprovers(approval, pipeline));
    if (gate.degraded) {
      this.logger.warn(
        `企微通道拒绝降级放行: approvalId=${approval.id} user=${actor.username} reason=${gate.reason ?? '未知'}`,
      );
      throw new ForbiddenException('身份服务不可用，请去控制台处理');
    }
    if (!gate.ok) {
      throw new ForbiddenException(`${actor.username} 不在审批人白名单内`);
    }
  }

  private async auditDecision(
    args: {
      action: 'approve' | 'reject' | 'detail' | 'viewRun';
      approval: DeployApprovalEntity;
      actor: WecomActor;
      sourceIp: string;
      status: string;
      detail: string;
    },
  ): Promise<void> {
    // 审计失败也尽力落（AuditService 内部吞 DB/文件异常）
    await this.audit.log({
      user: args.actor.username || 'unknown',
      action: `wecom.${args.action}`,
      env: args.approval.env,
      component: args.approval.moduleKey,
      status: args.status,
      detail:
        `${args.detail}；channel=wecom；identityExternalId=${args.actor.ext || '-'}；` +
        `sourceIp=${args.sourceIp || '-'}；approvalId=${args.approval.id}`,
    });
  }

  /** S1 详情：脱敏，不含日志正文 / 密钥 / 内部路径 */
  async detail(approvalId: string, actor: WecomActor, sourceIp: string): Promise<WecomApprovalDetail> {
    this.assertEnabled();
    const approval = await this.approvals.get(approvalId);
    const pipeline = await this.pipelines.get(approval.pipelineId);
    await this.assertCanReview(approval, actor, pipeline);

    const nodes = Array.isArray(pipeline.nodes) ? (pipeline.nodes as Array<{ key: string; label?: string }>) : [];
    const anchorIdx = nodes.findIndex((n) => n.key === (approval.nodeKey ?? ''));
    const prior = anchorIdx > 0 ? nodes.slice(Math.max(0, anchorIdx - 3), anchorIdx) : [];
    const recentNodes = prior.map((n) => ({ key: n.key, label: n.label || n.key, result: '已完成' }));

    // 只用于展示：查不到就回落成 operator 原值（不阻塞、不报错）
    const operatorName = await this.approvers.displayName(approval.operator);

    await this.auditDecision({
      action: 'detail', approval, actor, sourceIp, status: 'viewed', detail: '查看审批详情',
    });

    return {
      approvalId: approval.id,
      status: approval.status,
      env: approval.env,
      moduleKey: approval.moduleKey,
      mode: approval.mode,
      versionTag: pipeline.versionTag,
      gitBranch: approval.gitBranch,
      commitId: approval.commitId,
      operator: approval.operator,
      operatorName: operatorName ?? undefined,
      createdAt: approval.createdAt,
      nodeKey: approval.nodeKey,
      nodeLabel: approval.nodeLabel,
      pipelineId: approval.pipelineId,
      // 注意命名陷阱：DeployPipelineEntity.pipelineId 映射的列是 template_id（模板 id），
      // 与外层 approval.pipelineId（运行实例 id）不是一回事。历史运行可能为空，前端据此回落列表页。
      templateId: pipeline.pipelineId ?? undefined,
      pipelineStatus: pipeline.status,
      reviewer: approval.reviewer,
      reviewedAt: approval.reviewedAt,
      requiresConfirm: approval.env === 'prod',
      recentNodes,
    };
  }

  /**
   * S5 移动端只读运行快照。
   *
   * 🔴 白名单与 `detail` 完全一致（`assertCanReview`）：能看审批详情的人才看得懂运行结果，
   * 不因为是「只读」就放宽身份要求。
   *
   * 🔴 只读展示，**不改任何状态**；审计落 `wecom.viewRun`，便于回答「谁在什么时候看了哪次运行」。
   */
  async runSnapshot(
    approvalId: string,
    actor: WecomActor,
    sourceIp: string,
  ): Promise<WecomRunSnapshot> {
    this.assertEnabled();
    const approval = await this.approvals.get(approvalId);
    const pipeline = await this.pipelines.get(approval.pipelineId);
    await this.assertCanReview(approval, actor, pipeline);

    // 只用于展示：查不到回落 operator 原值
    const operatorName = await this.approvers.displayName(pipeline.operator || approval.operator);

    const dedup = this.shouldAuditViewRun(approval.id, pipeline.status, Date.now());
    if (dedup.log) {
      await this.auditDecision({
        action: 'viewRun',
        approval,
        actor,
        sourceIp,
        status: 'viewed',
        detail:
          `查看运行结果 runId=${pipeline.id} status=${pipeline.status} stage=${pipeline.stage ?? '-'}；` +
          `dedup=${dedup.mark}`,
      });
    }

    return {
      runId: pipeline.id,
      approvalId: approval.id,
      // 命名陷阱同 detail：DeployPipelineEntity.pipelineId 是模板 id
      templateId: pipeline.pipelineId ?? undefined,
      templateName: pipeline.templateName,
      env: pipeline.env,
      moduleKey: pipeline.moduleKey,
      mode: pipeline.mode,
      status: pipeline.status,
      stage: pipeline.stage,
      stages: this.stageListOf(pipeline),
      progress: pipeline.progress,
      versionTag: pipeline.versionTag,
      gitBranch: pipeline.gitBranch,
      gitCommit: pipeline.gitCommit,
      triggerSource: pipeline.triggerSource,
      operator: pipeline.operator || approval.operator,
      operatorName: operatorName ?? undefined,
      // bigint 列经 TypeORM 可能已是字符串，统一归一，避免前端 new Date('1793...') 得 Invalid Date
      startTime: Number(pipeline.startTime) || 0,
      endTime:
        pipeline.endTime === undefined || pipeline.endTime === null
          ? undefined
          : Number(pipeline.endTime),
      errorBrief: this.briefError(pipeline.error),
      nodeLabel: approval.nodeLabel,
      live: LIVE_PIPELINE_STATUSES.includes(pipeline.status),
    };
  }

  /**
   * 是否该为这次 `viewRun` 落一条审计；`mark` 进 detail 便于事后区分触发原因。
   *
   * 三种「该记」：first（首次）/ status-changed（状态跃迁）/ refreshed（超窗后的新查看行为）。
   */
  private shouldAuditViewRun(
    approvalId: string,
    status: string,
    nowMs: number,
  ): { log: boolean; mark: 'first' | 'status-changed' | 'refreshed' | 'skipped' } {
    const prev = this.viewRunSeen.get(approvalId);
    let mark: 'first' | 'status-changed' | 'refreshed';
    if (!prev) mark = 'first';
    else if (prev.status !== status) mark = 'status-changed';
    else if (nowMs - prev.ts >= WecomApprovalService.VIEWRUN_DEDUP_MS) mark = 'refreshed';
    else return { log: false, mark: 'skipped' };

    this.viewRunSeen.set(approvalId, { ts: nowMs, status });
    if (this.viewRunSeen.size > WecomApprovalService.VIEWRUN_SEEN_MAX) {
      // Map 的插入序不随 set 已存在键而更新，故按 ts 找最旧，而不是取 keys() 首个
      let oldestKey: string | undefined;
      let oldestTs = Infinity;
      for (const [k, v] of this.viewRunSeen) {
        if (v.ts < oldestTs) {
          oldestTs = v.ts;
          oldestKey = k;
        }
      }
      if (oldestKey) this.viewRunSeen.delete(oldestKey);
    }
    return { log: true, mark };
  }

  /**
   * 本次运行实际活动的节点（顺序即执行顺序）。
   * v5 nodes 优先 → steps 子集 → 空数组（前端回落九阶段）。
   * 🔴 只给 key/label/kind，**不给** actions、命令、env —— 手机端不需要，也不该有。
   */
  private stageListOf(pipeline: {
    nodes?: unknown;
    steps?: string[] | null;
  }): Array<{ key: string; label?: string; kind?: string }> {
    const nodes = Array.isArray(pipeline.nodes)
      ? (pipeline.nodes as Array<{ key?: string; label?: string; kind?: string }>)
      : [];
    const fromNodes = nodes
      .filter((n) => n && typeof n.key === 'string' && n.key)
      .map((n) => ({ key: n.key as string, label: n.label, kind: n.kind }));
    if (fromNodes.length) return fromNodes;
    if (Array.isArray(pipeline.steps) && pipeline.steps.length) {
      return pipeline.steps.map((s) => ({ key: s }));
    }
    return [];
  }

  /**
   * 失败摘要脱敏：只取首行 + 抹掉绝对路径 + 截断 180 字。
   * 报错里常带 `/home/ubuntu/...` 这类内部路径，不能原样送到手机上（卡② 脱敏边界）。
   */
  private briefError(error?: string): string | undefined {
    if (!error) return undefined;
    const firstLine = String(error)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (!firstLine) return undefined;
    const masked = firstLine
      .replace(/\/(?:home|Users|var|opt|srv|data|private)\/[^\s:;,)"']*/g, '<path>')
      .slice(0, 180);
    return masked || undefined;
  }

  async approve(
    approvalId: string,
    actor: WecomActor,
    body: WecomDecisionBody,
    sourceIp: string,
  ): Promise<WecomDecisionResult> {
    this.assertEnabled();
    const approval = await this.approvals.get(approvalId);
    try {
      await this.guardDecision(approval, actor, 'approve');
      // V8：prod 后端同样要求 confirm=true，前端确认层不算安全边界
      if (approval.env === 'prod' && body?.confirm !== true) {
        throw new BadRequestException('prod 环境审批必须携带 confirm=true（需二次确认）');
      }
      await this.claim(approval, actor, sourceIp);
      const result = await this.pipelines.approve(
        approval.pipelineId,
        actor.username,
        body?.comment?.trim() || undefined,
        approval.nodeKey,
        'wecom',
      );
      await this.auditDecision({
        action: 'approve', approval, actor, sourceIp, status: 'approved',
        detail: `审批通过（意见: ${body?.comment?.trim() || '-'}）；resumedFrom=${result.resumedFrom ?? '-'}`,
      });
      return {
        approvalId,
        status: 'approved',
        pipelineStatus: result.status,
        resumedFrom: result.resumedFrom,
        message: '已通过，发布继续（审批结果 ≠ 发布结果）',
      };
    } catch (e) {
      await this.auditDecision({
        action: 'approve', approval, actor, sourceIp, status: 'failed',
        detail: `审批未生效: ${(e as Error).message}`,
      }).catch(() => undefined);
      throw e;
    }
  }

  async reject(
    approvalId: string,
    actor: WecomActor,
    body: WecomDecisionBody,
    sourceIp: string,
  ): Promise<WecomDecisionResult> {
    this.assertEnabled();
    const approval = await this.approvals.get(approvalId);
    try {
      await this.guardDecision(approval, actor, 'reject');
      // V5：意见必填，后端是硬边界
      const comment = body?.comment?.trim();
      if (!comment) throw new BadRequestException('驳回意见必填');
      await this.claim(approval, actor, sourceIp);
      const result = await this.pipelines.reject(
        approval.pipelineId,
        actor.username,
        comment,
        approval.nodeKey,
        'wecom',
      );
      await this.auditDecision({
        action: 'reject', approval, actor, sourceIp, status: 'rejected', detail: `审批驳回: ${comment}`,
      });
      return {
        approvalId,
        status: 'rejected',
        pipelineStatus: result.status,
        message: '已驳回，流水线终止（不会自动回滚）',
      };
    } catch (e) {
      await this.auditDecision({
        action: 'reject', approval, actor, sourceIp, status: 'failed',
        detail: `审批未生效: ${(e as Error).message}`,
      }).catch(() => undefined);
      throw e;
    }
  }

  /** 决策前的只读校验：审批单状态 / 流水线终态 / 白名单 fail-closed */
  private async guardDecision(
    approval: DeployApprovalEntity,
    actor: WecomActor,
    _action: 'approve' | 'reject',
  ): Promise<void> {
    if (approval.status !== 'pending') {
      throw new ConflictException(
        `审批单已由 ${approval.reviewer || '未知'} 于 ${
          approval.reviewedAt ? new Date(approval.reviewedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间'
        } 处理（${approval.status}），不能重复审批`,
      );
    }
    const pipeline = await this.pipelines.get(approval.pipelineId);
    if (TERMINAL_PIPELINE_STATUSES.includes(pipeline.status)) {
      throw new ConflictException(`流水线已结束（${pipeline.status}），无需审批`);
    }
    await this.assertCanReview(approval, actor, pipeline);
  }

  /**
   * 🔴 W-b CAS 领权：条件更新 `WHERE status='pending'`。
   * 既有 `ApprovalService.resolve` 是 read-then-save，跨通道并发（V7）存在竞态；
   * 这里用一次原子 UPDATE 抢占决策权，affected!==1 即 409，resume 只发生一次。
   * 不改既有逻辑，也不复制状态机。
   */
  private async claim(approval: DeployApprovalEntity, actor: WecomActor, sourceIp: string): Promise<void> {
    const result = await this.repo.update(
      { id: approval.id, status: 'pending' },
      { channel: 'wecom', identityExternalId: actor.ext || null, sourceIp: sourceIp || null },
    );
    if (result.affected !== 1) {
      throw new ConflictException(`审批单 ${approval.id} 已被处理，请刷新后查看结果`);
    }
  }
}
