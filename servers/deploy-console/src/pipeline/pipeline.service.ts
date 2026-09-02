import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { DeployPipelineEntity, PIPELINE_STAGES, PipelineMode } from '../entities/deploy-pipeline.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { CanaryService } from '../canary/canary.service';
import { AuditService } from '../audit/audit.service';
import { StageCommandService } from '../stage-command/stage-command.service';
// 配置中心服务（与 @nestjs/config 的 ConfigService 重名，故别名导入）
import { ConfigService as ConfigCenterService } from '../config/config.service';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { NotificationService } from '../notification/notification.service';
import { DeployService } from '../deploy/deploy.service';
import { ApprovalService } from '../approval/approval.service';
import {
  PipelineTemplateService,
  needsApprovalForTemplate,
} from '../pipeline-template/pipeline-template.service';
// pm2 进程探活工具（回滚后健康检查 probeBackendHealth 复用）
import { Pm2ProbeService } from '../pm2/pm2-probe.service';
// 静态产物存储工具（公共 API：可发布版本/历史版本切换的产物检查）
import { ArtifactStoreService } from '../artifact/artifact-store.service';
// 版本注册表工具（公共 API：历史版本切换/灰度转全量的指针与版本写入）
import { ReleaseRegistryService } from '../registry/release-registry.service';
// 命令执行工具（runShell 子进程 PATH / node bin 解析用）
import { CommandService, buildChildEnv } from '../shell/command.service';
// 内置步骤执行器注册表（executeStage 数据驱动分派）
import { PIPELINE_BUILTIN_STEPS } from './steps/step-registry';
import { BuiltinStepDef, StepContext } from './steps/step.types';

/** 构建超时（毫秒） */
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 阶段命令的工作目录：后端 `servers/<dir>`，前端/微前端/小程序 `apps/<dir>`。
 *
 * 默认模板命令（如 `npx tsc -p tsconfig.json`、`npx vite build`）依赖 cwd 定位配置与产物，
 * 必须在模块目录下执行——否则会在 deploy-console 自身目录下编译错目标。
 * 抽成纯函数以便单测：该缺陷正是重构 `stageBuild` 时丢失 cwd 引入的。
 */
export function resolveStageCwd(ws: string, moduleType?: string, dir?: string): string {
  if (!dir) return ws;
  return path.join(ws, moduleType === 'backend' ? 'servers' : 'apps', dir);
}

/**
 * 支持发布的环境。
 *
 * `local` = 本机环境（gateway 以 DEPLOY_ENV_ID=local 启动，读独立的一套版本指针）。
 * 它存在的意义：本地开发发布只投递本机产物，**不污染远程 dev 的指针**——
 * 否则远程 dev 的 gateway 会指向一个本地才有、远程没有的产物版本，导致 dev 页面 404。
 */
export const SUPPORTED_ENVS: readonly string[] = ['local', 'dev', 'staging', 'prod'];

export interface SubmitPipelineDto {
  env: string;
  moduleKey: string;
  /** direct=全量；grayscale=灰度（写灰度规则，不切 stable 指针） */
  mode?: PipelineMode;
  /**
   * 目标分支（默认 master）。发布基于远程仓库的该分支拉取代码，而非当前工作区。
   */
  branch?: string;
  /**
   * 目标 commitId（git 短哈希）。不传则取该分支最新提交。
   * 兼容旧参数名 versionTag。
   */
  commitId?: string;
  /** @deprecated 等价于 commitId，兼容旧调用 */
  versionTag?: string;
  /** 流水线模板 ID（不传 = 模块默认模板，兼容旧调用/MCP） */
  templateId?: string;
  /** 投递目标：local=本机静态目录；remote=SSH 到服务器。默认自动判定 */
  target?: 'local' | 'remote';
  /** 灰度规则（mode=grayscale 时必填）：{ type:'percent'|'user-list'|'header', ... } */
  grayscaleRule?: Record<string, unknown>;
}

/**
 * 发布流水线引擎。
 *
 * 把「构建 → 投递产物 → 写版本表 → 切指针 → 等 TTL 并验证 → 清理旧版本」固化为一条流水线，
 * 其中「版本表必须是 web_system_deploy 库」「必须等 gateway TTL 再断言」两个历史坑由代码保证。
 *
 * 任务状态落库（deploy_pipelines），可查询/可取消；执行为后台异步，不阻塞提交请求。
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  /** 取消标记（进程内即可，重启后任务本身也会中断） */
  private readonly cancelled = new Set<string>();
  /** 运行中流水线的 shell 子进程：取消时立即 SIGKILL，避免"已取消的发布仍跑完整条流水线" */
  private readonly shells = new Map<string, ChildProcess>();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(DeployPipelineEntity)
    private readonly pipelineRepo: Repository<DeployPipelineEntity>,
    @InjectRepository(DeployVersionEntity)
    private readonly versionRepo: Repository<DeployVersionEntity>,
    @InjectRepository(DeployDeploymentEntity)
    private readonly deploymentRepo: Repository<DeployDeploymentEntity>,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly canaryService: CanaryService,
    private readonly auditService: AuditService,
    private readonly stageCommands: StageCommandService,
    private readonly configs: ConfigCenterService,
    private readonly releaseLock: ReleaseLockService,
    private readonly notifications: NotificationService,
    private readonly deployService: DeployService,
    // 审批门禁：需审批环境的提交进入 pending-approval，审批通过后才执行
    private readonly approvals: ApprovalService,
    // 流水线模板：提交解析模板并落实例快照（不传默认=模块 builtin 默认）
    private readonly templates: PipelineTemplateService,
    // pm2 进程探活（回滚后健康检查 probeBackendHealth 复用）
    private readonly pm2Probe: Pm2ProbeService,
    // 命令执行（runShell 子进程 PATH / node bin 解析）
    private readonly command: CommandService,
    // 静态产物存储（公共 API：可发布版本 / 历史版本切换的产物检查）
    private readonly artifacts: ArtifactStoreService,
    // 版本注册表（公共 API：历史版本切换 / 灰度转全量的指针与版本写入）
    private readonly registry: ReleaseRegistryService,
    // 内置步骤注册表（executeStage 按步骤元数据数据驱动分派；执行体在各自 executor 内）
    @Inject(PIPELINE_BUILTIN_STEPS)
    private readonly builtinSteps: Record<string, BuiltinStepDef>,
  ) {}

  /**
   * 发布目录（RELEASE_WORKSPACE）：
   * 从远程仓库拉取代码并构建部署的隔离目录，与开发工作区完全分离。
   * 本地验证流程 = 开发工作区 commit&push → 发布目录 fetch/checkout → 构建部署。
   */
  private get releaseWorkspace(): string {
    return (
      this.configService.get<string>('RELEASE_WORKSPACE') || '/Users/geekwen/web_system_release'
    );
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 提交发布流水线：落库后立即返回，后台异步执行。
   * 同一 (env, moduleKey) 不允许并发发布（避免产物互相覆盖）。
   */
  async submit(
    dto: SubmitPipelineDto,
    operator?: string,
  ): Promise<{ jobId: string; status: string; approvalId?: string }> {
    const mode: PipelineMode = dto.mode ?? 'direct';
    if (!SUPPORTED_ENVS.includes(dto.env)) {
      throw new BadRequestException(
        `不支持的环境: ${dto.env}（支持 ${SUPPORTED_ENVS.join(' / ')}）`,
      );
    }
    // 防命令注入：branch / commit 会拼进发布目录的 git 命令，白名单收敛（禁空格/引号/分号/$ 等）
    const safeBranchRe = /^[A-Za-z0-9._/-]{1,128}$/;
    if (dto.branch && !safeBranchRe.test(dto.branch)) {
      throw new BadRequestException(`分支名含非法字符: ${dto.branch}`);
    }
    const targetCommit = dto.commitId ?? dto.versionTag;
    if (targetCommit && !/^[A-Za-z0-9._-]{4,64}$/.test(targetCommit)) {
      throw new BadRequestException(`目标 commit 含非法字符: ${targetCommit}`);
    }
    if (mode === 'grayscale' && !dto.grayscaleRule) {
      throw new BadRequestException('灰度发布必须提供 grayscaleRule');
    }

    const running = await this.pipelineRepo.findOne({
      where: { env: dto.env, moduleKey: dto.moduleKey, status: 'running' as any },
    });
    if (running) {
      throw new ConflictException(
        `模块 ${dto.moduleKey} 在 ${dto.env} 有正在运行的流水线 ${running.id}，请等待完成或取消`,
      );
    }

    const id = this.generateId();
    // 流水线模板：不传默认走模块 builtin 默认（旧调用/MCP 兼容）；实例落模板快照
    const tpl = await this.templates.resolveForSubmit(dto.moduleKey, dto.templateId);
    // 审批门禁：模板策略覆盖环境规则（always/never），inherit 沿用环境（默认 prod）
    const needsApproval = needsApprovalForTemplate(
      tpl,
      await this.approvals.needsApproval(dto.env),
    );
    const runTarget =
      dto.target ??
      (tpl.defaultTarget === 'auto' ? undefined : (tpl.defaultTarget as 'local' | 'remote'));
    const entity = this.pipelineRepo.create({
      id,
      env: dto.env,
      moduleKey: dto.moduleKey,
      // commitId 与旧参数名 versionTag 等价
      versionTag: dto.commitId ?? dto.versionTag,
      gitBranch: dto.branch || undefined,
      mode,
      // 模板快照：模板后续修改/删除不影响已提交实例
      templateId: tpl.id,
      templateName: tpl.name,
      steps: tpl.steps ?? null,
      skipVerify: !!tpl.skipVerify,
      rollbackOnFailure: tpl.rollbackOnFailure ?? 'previous',
      runTarget,
      status: needsApproval ? 'pending-approval' : 'pending',
      stage: 'check',
      progress: {
        current: 0,
        total: PIPELINE_STAGES.length,
        message: needsApproval ? '已提交，等待审批' : '已提交，等待执行',
      },
      logs: needsApproval
        ? [`该发布需审批（模板「${tpl.name}」）：提交已阻断，审批通过后自动执行`]
        : [],
      operator,
      grayscaleRule: dto.grayscaleRule,
      startTime: Date.now(),
    });
    await this.pipelineRepo.save(entity);

    if (needsApproval) {
      const approval = await this.approvals.create({
        pipelineId: id,
        env: dto.env,
        moduleKey: dto.moduleKey,
        mode,
        gitBranch: dto.branch || undefined,
        commitId: dto.commitId ?? dto.versionTag,
        operator: operator || 'unknown',
      });
      await this.auditService.log({
        user: operator || 'unknown',
        action: 'pipeline.submit',
        env: dto.env,
        component: dto.moduleKey,
        status: 'pending_approval',
        detail: `提交发布流水线 ${id}（mode=${mode}, 模板=${tpl.name}）→ 需审批，已阻断等待`,
      });
      this.notifications.notify({
        event: 'deploy.pending-approval',
        env: dto.env,
        moduleKey: dto.moduleKey,
        versionTag: dto.commitId ?? dto.versionTag,
        status: 'warn',
        detail: `${operator || 'unknown'} 提交发布待审批（模板「${tpl.name}」，审批单 ${approval.id}）`,
        operator: operator || 'unknown',
      });
      return { jobId: id, status: 'pending-approval', approvalId: approval.id };
    }

    await this.auditService.log({
      user: operator || 'unknown',
      action: 'pipeline.submit',
      env: dto.env,
      component: dto.moduleKey,
      status: 'started',
      detail: `提交发布流水线 ${id}（mode=${mode}, 模板=${tpl.name}）`,
    });

    // 后台执行，不阻塞提交响应（投递目标已随实例快照 runTarget 固化）
    void this.run(entity);

    return { jobId: id, status: entity.status };
  }

  /** 查询流水线状态 */
  async get(id: string): Promise<DeployPipelineEntity> {
    const p = await this.pipelineRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`流水线不存在: ${id}`);
    return p;
  }

  /** 列出流水线（按开始时间倒序） */
  async list(
    env?: string,
    moduleKey?: string,
    limit = 20,
    templateId?: string,
  ): Promise<DeployPipelineEntity[]> {
    const where: Record<string, unknown> = {};
    if (env) where.env = env;
    if (moduleKey) where.moduleKey = moduleKey;
    if (templateId) where.templateId = templateId;
    return this.pipelineRepo.find({ where, order: { startTime: 'DESC' }, take: limit });
  }

  /**
   * 各流水线模板的运行摘要：总次数 / 成功次数 / 最近一次执行。
   * 只统计提交时带 templateId 快照的实例（模板删除不影响历史归属）。
   */
  async listTemplateSummaries(
    templateIds?: string[],
  ): Promise<Record<string, { total: number; ok: number; latest: DeployPipelineEntity | null }>> {
    const qb = this.pipelineRepo
      .createQueryBuilder('p')
      .where('p.templateId IS NOT NULL')
      .orderBy('p.startTime', 'DESC')
      .take(1000);
    if (templateIds && templateIds.length) {
      qb.andWhere('p.templateId IN (:...ids)', { ids: templateIds });
    }
    const rows = await qb.getMany();
    const out: Record<string, { total: number; ok: number; latest: DeployPipelineEntity | null }> = {};
    for (const p of rows) {
      const t = p.templateId as string;
      const item = out[t] || (out[t] = { total: 0, ok: 0, latest: null });
      item.total += 1;
      if (p.status === 'succeeded') item.ok += 1;
      if (!item.latest) item.latest = p;
    }
    return out;
  }

  /** 取消流水线（幂等；仅对 pending/running 有意义） */
  async cancel(id: string, operator?: string): Promise<{ id: string; status: string }> {
    const p = await this.get(id);
    if (['succeeded', 'failed', 'cancelled'].includes(p.status)) {
      return { id, status: p.status };
    }
    // 撤回待审批提交：联动关闭审批单，避免审批台出现孤儿单
    if (p.status === 'pending-approval') {
      const pending = await this.approvals.byPipelineId(id);
      if (pending && pending.status === 'pending') {
        await this.approvals.resolve(pending.id, 'reject', operator || 'unknown', '提交人撤回');
      }
    }
    this.cancelled.add(id);
    // 立即中断正在执行的 shell 子进程（否则要等当前命令跑完/超时才真正终止）
    const child = this.shells.get(id);
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    p.status = 'cancelled';
    p.endTime = Date.now();
    p.progress = { ...(p.progress ?? { current: 0, total: PIPELINE_STAGES.length }), message: '已取消' };
    await this.pipelineRepo.save(p);
    await this.auditService.log({
      user: operator || p.operator || 'unknown',
      action: 'pipeline.cancel',
      env: p.env,
      component: p.moduleKey,
      status: 'cancelled',
      detail: `取消流水线 ${id}（阶段: ${p.stage ?? '-'}）`,
    });
    return { id, status: p.status };
  }

  /**
   * 重试失败的实例：以相同参数（模块/分支/commit/灰度规则/模板）重新提交一条新流水线。
   * 仅 failed / cancelled 可重试；原实例保留，新实例走全新状态机与并发锁。
   */
  async retry(
    id: string,
    operator?: string,
  ): Promise<{ jobId: string; status: string; approvalId?: string }> {
    const p = await this.get(id);
    // 终态可重试：失败/取消 = 重试；成功 = 以相同参数"再次发布"（重复部署同一 commit，用于复验）
    if (!['failed', 'cancelled', 'succeeded'].includes(p.status)) {
      throw new BadRequestException(
        `流水线 ${id} 状态为 ${p.status}，仅 失败/已取消/成功 可重试（运行中请等待结束）`,
      );
    }
    await this.auditService.log({
      user: operator || p.operator || 'unknown',
      action: 'pipeline.retry',
      env: p.env,
      component: p.moduleKey,
      status: 'started',
      detail: `重试流水线 ${id}（原 ${p.status}）→ 重新提交`,
    });
    const dto: SubmitPipelineDto = {
      env: p.env,
      moduleKey: p.moduleKey,
      mode: (p.mode === 'grayscale' ? 'grayscale' : 'direct') as PipelineMode,
      branch: p.gitBranch || 'master',
      commitId: p.gitCommit ?? p.versionTag,
      grayscaleRule: p.grayscaleRule as Record<string, unknown> | undefined,
      target: p.runTarget && p.runTarget !== 'auto' ? (p.runTarget as 'local' | 'remote') : undefined,
      templateId: p.templateId ?? undefined,
    };
    return this.submit(dto, operator || p.operator);
  }

  /**
   * 审批通过：恢复待审批流水线并触发执行。
   * 执行人记审批人（reviewer）：审批通过即代表其确认本次发布。
   */
  async approve(
    id: string,
    reviewer?: string,
    comment?: string,
  ): Promise<{ id: string; status: string }> {
    const p = await this.get(id);
    if (p.status !== 'pending-approval') {
      throw new BadRequestException(`流水线 ${id} 状态为 ${p.status}，不是待审批状态`);
    }
    const approval = await this.approvals.byPipelineId(id);
    if (!approval) {
      throw new NotFoundException(`流水线 ${id} 缺少审批单`);
    }
    await this.approvals.resolve(approval.id, 'approve', reviewer || 'unknown', comment);

    p.status = 'pending';
    p.stage = 'check';
    p.logs = [...(p.logs ?? []), `审批通过（审批人: ${reviewer || 'unknown'}）`];
    p.progress = {
      ...(p.progress ?? { current: 0, total: PIPELINE_STAGES.length }),
      message: '审批通过，开始执行',
    };
    await this.pipelineRepo.save(p);

    await this.auditService.log({
      user: reviewer || 'unknown',
      action: 'pipeline.approve',
      env: p.env,
      component: p.moduleKey,
      status: 'approved',
      detail: `审批通过流水线 ${id}（意见: ${comment?.trim() || '-'}）`,
      changes: [
        { field: 'approval.status', before: 'pending', after: 'approved' },
        { field: 'approval.comment', before: null, after: comment?.trim() || null },
      ],
    });
    this.notifications.notify({
      event: 'deploy.approved',
      env: p.env,
      moduleKey: p.moduleKey,
      versionTag: p.versionTag,
      status: 'success',
      detail: `${reviewer || 'unknown'} 已审批通过，发布开始执行`,
      operator: p.operator,
    });

    // 后台执行，不阻塞审批响应
    void this.run(p);

    return { id, status: 'approved' };
  }

  /** 审批拒绝：流水线标记取消并留审批意见 */
  async reject(
    id: string,
    reviewer?: string,
    comment?: string,
  ): Promise<{ id: string; status: string }> {
    const p = await this.get(id);
    if (p.status !== 'pending-approval') {
      throw new BadRequestException(`流水线 ${id} 状态为 ${p.status}，不是待审批状态`);
    }
    const approval = await this.approvals.byPipelineId(id);
    if (!approval) {
      throw new NotFoundException(`流水线 ${id} 缺少审批单`);
    }
    await this.approvals.resolve(approval.id, 'reject', reviewer || 'unknown', comment);

    p.status = 'cancelled';
    p.endTime = Date.now();
    p.error = `审批拒绝: ${comment?.trim() || '无意见'}`;
    p.progress = {
      ...(p.progress ?? { current: 0, total: PIPELINE_STAGES.length }),
      message: '审批拒绝',
    };
    await this.pipelineRepo.save(p);

    await this.auditService.log({
      user: reviewer || 'unknown',
      action: 'pipeline.reject',
      env: p.env,
      component: p.moduleKey,
      status: 'rejected',
      detail: `审批拒绝流水线 ${id}（意见: ${comment?.trim() || '-'}）`,
      changes: [
        { field: 'approval.status', before: 'pending', after: 'rejected' },
        { field: 'approval.comment', before: null, after: comment?.trim() || null },
      ],
    });
    this.notifications.notify({
      event: 'deploy.rejected',
      env: p.env,
      moduleKey: p.moduleKey,
      versionTag: p.versionTag,
      status: 'failed',
      detail: `${reviewer || 'unknown'} 拒绝了发布（意见: ${comment?.trim() || '无意见'}）`,
      operator: p.operator,
    });

    return { id, status: 'rejected' };
  }

  /**
   * 可发布版本（回滚/按版本发布的候选），按 versionTag 去重。
   *
   * 合并两个来源：
   *  - db：deploy_versions 记录（同一版本多次发布会有多条，按最新去重）
   *  - artifact：磁盘上已存在但未登记版本表的历史产物
   *
   * 控制台与 MCP 共用本方法，避免两边逻辑漂移。
   */
  async listReleaseCandidates(
    env?: string,
    component?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const where: Record<string, unknown> = {};
    if (env) where.env = env;
    if (component) where.component = component;

    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const v of await this.versionRepo.find({ where, order: { releasedAt: 'DESC' } })) {
      const tag = String(v.versionTag);
      if (seen.has(tag)) continue;
      seen.add(tag);
      rows.push({ ...v, source: 'db' });
    }

    if (component) {
      for (const tag of this.artifacts.listVersions(component)) {
        if (seen.has(tag)) continue;
        seen.add(tag);
        rows.push({
          versionTag: tag,
          component,
          env: env || '',
          status: 'active',
          source: 'artifact',
          note: '磁盘产物（未登记版本表）',
        });
      }
    }
    return rows;
  }

  /**
   * 仅切指针（不重新构建），用于回退到「版本表无记录」的历史版本。
   *
   * 背景：deploy.sh 时代写入的版本记录 component 形如 `mf:admin`，与现在的 `admin` 不一致，
   * 导致这些历史产物虽在磁盘上，却查不到版本记录、无法回滚。这里以**产物实际存在**为准，
   * 切换后补写一条版本记录（git 信息留空并标注来源）。
   */
  async switchPointer(
    env: string,
    moduleKey: string,
    versionTag: string,
    operator?: string,
  ): Promise<{ env: string; moduleKey: string; versionTag: string }> {
    const mod = await this.moduleRegistry.get(moduleKey);
    if (mod.type !== 'micro-frontend') {
      throw new BadRequestException(`模块 ${moduleKey} 类型为 ${mod.type}，仅支持微前端模块切换版本`);
    }
    if (!this.artifacts.exists(moduleKey, versionTag)) {
      throw new BadRequestException(
        `版本产物不存在，无法切换: ${moduleKey}/${versionTag}（发布目录产物目录缺 index.js）`,
      );
    }

    await this.registry.setPointer({
      env,
      moduleKey,
      currentVersion: versionTag,
      deployedBy: operator,
    });
    // 补写版本记录，保证后续 list_releases 能看到（git 信息留空并标注来源）
    await this.registry.registerVersion({
      env,
      moduleKey,
      versionTag,
      releasedBy: operator,
      note: '历史版本回退切换（原记录缺失，以产物为准）',
    });

    await this.auditService.log({
      user: operator || 'unknown',
      action: 'pipeline.switch_pointer',
      env,
      component: moduleKey,
      status: 'success',
      detail: `切换版本指针（历史版本回退）: ${env}/${moduleKey} → ${versionTag}`,
    });

    return { env, moduleKey, versionTag };
  }

  /**
   * 灰度转全量：把 stable 指针切到灰度版本，并禁用灰度规则。
   */
  async promote(id: string, operator?: string): Promise<{ id: string; versionTag: string }> {
    const p = await this.get(id);
    if (p.mode !== 'grayscale') {
      throw new BadRequestException(`流水线 ${id} 不是灰度发布，无需转全量`);
    }
    if (p.status !== 'succeeded') {
      throw new BadRequestException(`流水线 ${id} 未成功完成，无法转全量`);
    }
    if (!p.versionTag) {
      throw new BadRequestException(`流水线 ${id} 缺少版本标签`);
    }

    await this.registry.setPointer({
      env: p.env,
      moduleKey: p.moduleKey,
      currentVersion: p.versionTag,
      deployedBy: operator ?? p.operator,
      taskId: p.id,
    });

    // 禁用本次灰度规则
    if (p.canaryRuleId) {
      try {
        await this.canaryService.update(p.canaryRuleId, { enabled: false });
      } catch (e) {
        this.logger.warn(`禁用灰度规则 ${p.canaryRuleId} 失败: ${(e as Error).message}`);
      }
    }

    await this.auditService.log({
      user: operator || p.operator || 'unknown',
      action: 'pipeline.promote',
      env: p.env,
      component: p.moduleKey,
      status: 'success',
      detail: `灰度转全量: ${p.env}/${p.moduleKey} → ${p.versionTag}`,
    });

    return { id, versionTag: p.versionTag };
  }

  // ── 执行引擎 ──────────────────────────────────────────────

  private async run(p: DeployPipelineEntity, target?: 'local' | 'remote'): Promise<void> {
    // 投递目标：实例快照 runTarget（提交时模板/入参确定）优先；auto/缺省 → 配置或本机
    const effectiveTarget =
      p.runTarget && p.runTarget !== 'auto' ? (p.runTarget as 'local' | 'remote') : target;
    // local 环境只投递本机：远程投递到「本地环境」没有意义，且容易误改远程产物
    const uploadTarget =
      p.env === 'local' ? 'local' : (effectiveTarget ?? this.resolveDefaultTarget());
    if (target === 'remote' && p.env === 'local') {
      p.logs = [...(p.logs ?? []), 'local 环境不支持远程投递，已强制为本机投递'];
    }
    let prevVersion: string | undefined;

    // 并发锁：同一「模块 × 环境」串行化发布。
    // 否则两条流水线会互相覆盖版本指针，出现"发布 A 成功、实际跑的是 B 的产物"这类静默错误。
    const locked = await this.releaseLock.acquire(p.moduleKey, p.env, p.id);
    if (!locked) {
      const reason = `${p.moduleKey}@${p.env} 正在发布中，请等待其结束后重试`;
      p.status = 'failed';
      p.error = reason;
      p.progress = {
        ...(p.progress ?? { current: 0, total: PIPELINE_STAGES.length }),
        message: '发布被拒绝：已有进行中的发布',
      };
      p.endTime = Date.now();
      await this.save(p);
      await this.auditService.log({
        user: p.operator || 'unknown',
        action: 'pipeline.rejected',
        env: p.env,
        component: p.moduleKey,
        status: 'failed',
        detail: reason,
      });
      this.logger.warn(`发布被拒绝（并发）: ${p.id} ${p.env}/${p.moduleKey}`);
      return;
    }

    try {
      p.status = 'running';
      await this.save(p);

      // 活动阶段 = 实例快照 p.steps（模板提交时固化，null=全部九阶段）
      const activeStages: string[] = (p.steps && p.steps.length
        ? (p.steps as string[])
        : [...PIPELINE_STAGES]) as string[];

      if (p.reuseArtifact) {
        p.logs = [...(p.logs ?? []), '已跳过 pull / build / upload（复用已有产物）'];
        await this.save(p);
      }

      // 数据驱动执行：每步由 executeStage 分派到内置执行器（平台语义）或阶段命令覆盖（S6-II）
      for (const stage of activeStages) {
        this.assertNotCancelled(p);
        // version 前捕获当前线上版本（verify 失败自动回滚的回退目标）
        if (stage === 'version') {
          try {
            const dep = await this.deploymentRepo.findOne({
              where: { envId: p.env, moduleKey: p.moduleKey },
            });
            prevVersion = dep?.currentVersion;
          } catch {
            /* 查询失败不影响发布，仅导致失败时无法自动回滚 */
          }
        }
        await this.executeStage(p, stage, uploadTarget);
      }

      p.status = 'succeeded';
      p.progress = { ...p.progress!, message: '发布完成' };
      p.endTime = Date.now();
      await this.save(p);

      await this.auditService.log({
        user: p.operator || 'unknown',
        action: 'pipeline.finish',
        env: p.env,
        component: p.moduleKey,
        status: 'success',
        detail: `发布成功: ${p.env}/${p.moduleKey} → ${p.versionTag}（mode=${p.mode}, target=${uploadTarget}）`,
      });
      this.logger.log(`流水线完成: ${p.id} ${p.env}/${p.moduleKey} → ${p.versionTag}`);
      void this.notifyPipelineEvent(p, 'pipeline.succeeded', 'success', '发布成功');
    } catch (e) {
      const msg = (e as Error).message;
      // 取消优先于失败：取消一旦发出（含 SIGKILL 中断命令引发的失败），终态一律记为 cancelled
      p.status = this.cancelled.has(p.id) ? 'cancelled' : 'failed';
      if (p.status === 'failed') {
        p.error = msg;
        p.progress = { ...(p.progress ?? { current: 0, total: PIPELINE_STAGES.length }), message: `失败: ${msg}` };
        p.endTime = Date.now();
      }
      await this.save(p);
      this.logger.error(`流水线失败: ${p.id} 阶段=${p.stage} : ${msg}`);
      if (p.status === 'failed') {
        // ⑤ 验证阶段失败 → 自动回滚到上一稳定版本（verify 阶段才说明新版本已发布但不健康）
        if (
          p.stage === 'verify' &&
          p.rollbackOnFailure !== 'none' &&
          prevVersion &&
          prevVersion !== p.versionTag
        ) {
          try {
            const rollTask = await this.deployService.startRollback(
              p.env,
              prevVersion,
              p.operator,
              p.moduleKey,
            );
            // 必须等回滚真正跑完：startRollback 是异步 spawn，不等就不知道结果，
            // "自动回滚"会变成"发起了动作但失败了也没人知道"。
            const outcome = await this.deployService.waitTask(String(rollTask));
            p.logs = [
              ...(p.logs ?? []),
              `验证失败，已自动回滚到 ${prevVersion}（task=${rollTask}, 结果=${outcome}）`,
            ];

            // 回滚后探活确认：服务是否真的恢复了，而不是只发起了回滚
            let probeNote = '前端模块，跳过端口探活';
            if (p.moduleType === 'backend') {
              const probe = await this.probeBackendHealth(p);
              probeNote = probe.note;
              p.logs = [
                ...(p.logs ?? []),
                `回滚后探活: ${probe.ok ? '服务已恢复' : `服务未恢复（${probe.note}）`}`,
              ];
              await this.save(p);
            }

            await this.auditService.log({
              user: p.operator || 'unknown',
              action: 'pipeline.auto-rollback',
              env: p.env,
              component: p.moduleKey,
              status: outcome === 'success' ? 'success' : 'failed',
              detail: `验证失败自动回滚: ${p.env}/${p.moduleKey} → ${prevVersion}（task=${rollTask}, 结果=${outcome}, 探活=${probeNote}）`,
            });
            void this.notifyPipelineEvent(
              p,
              'pipeline.auto-rollback',
              outcome === 'success' ? 'warn' : 'failed',
              `验证失败，已自动回滚到 ${prevVersion}（回滚结果=${outcome}, 探活=${probeNote}）`,
            );
          } catch (re) {
            p.logs = [...(p.logs ?? []), `自动回滚失败: ${(re as Error).message}`];
            this.logger.error(`自动回滚失败: ${(re as Error).message}`);
            await this.auditService.log({
              user: p.operator || 'unknown',
              action: 'pipeline.auto-rollback',
              env: p.env,
              component: p.moduleKey,
              status: 'failed',
              detail: `验证失败自动回滚异常: ${(re as Error).message}`,
            });
          }
        }
        await this.auditService.log({
          user: p.operator || 'unknown',
          action: 'pipeline.finish',
          env: p.env,
          component: p.moduleKey,
          status: 'failed',
          detail: `发布失败: ${p.env}/${p.moduleKey}（阶段 ${p.stage}）: ${msg}`,
        });
        void this.notifyPipelineEvent(
          p,
          'pipeline.failed',
          'failed',
          `阶段 ${p.stage} 失败: ${msg}`,
        );
      }
    } finally {
      // 无论成功失败都必须释放锁，否则只能等 TTL 过期后才能再次发布
      await this.releaseLock.release(p.moduleKey, p.env, p.id);
      this.cancelled.delete(p.id);
    }
  }

  /**
   * 单步执行（数据驱动）：按步骤注册表元数据分派，不做任何「步骤具体怎么做」的判断。
   *
   * 每个内置步骤在 step-registry 中声明：
   *   category（特性分类） + commandMode（命令协作语义） + skip（守卫） + run（执行体）。
   * engine 只负责：查表 → 守卫跳过 → 命令覆盖优先级（base/override/required/none）→ 构造 ctx 调执行体。
   * 步骤"怎么做"全部在独立 executor（steps/*.executor.ts）中，各自注入所需 service 工具。
   */
  private async executeStage(
    p: DeployPipelineEntity,
    stage: string,
    uploadTarget: 'local' | 'remote',
  ): Promise<void> {
    const def = this.builtinSteps[stage];
    if (!def) {
      // 模板校验已挡（steps 仅允许内置九阶段），双保险
      throw new Error(`未知或不可编排步骤: ${stage}`);
    }
    const ctx: StepContext = {
      pipeline: p,
      uploadTarget,
      enterStage: (message) => this.enterStage(p, stage, message),
      log: (line) => {
        p.logs = [...(p.logs ?? []), line];
      },
      save: () => this.save(p),
      sleep: (ms) => this.sleep(ms),
      assertNotCancelled: () => this.assertNotCancelled(p),
    };

    // 守卫：实例快照/配置决定跳过（复用产物 / 快线 / 模块类型不适用）
    if (def.skip?.(p)) return;

    switch (def.commandMode) {
      case 'base':
        // check：安全基线恒内置执行，命令作附加校验
        await def.run!(ctx);
        await this.runStageCommand(p, stage);
        return;
      case 'required':
        // build：必须由模块阶段命令驱动，未配置 fail-fast
        if (!(await this.runStageCommand(p, stage))) {
          throw new Error(
            `模块 ${p.moduleKey} 未配置 build 阶段命令，无法构建，发布终止（请在「模块详情 → 阶段命令」中配置）`,
          );
        }
        return;
      case 'override':
        // 配置了命令则覆盖执行体，未配置回退内置
        if (!(await this.runStageCommand(p, stage))) await def.run!(ctx);
        return;
      default:
        // none：version/pointer 发布语义真相源，纯内置
        await def.run!(ctx);
    }
  }

  /** 默认投递目标：配置优先，未配置时本机优先（本地开发直投本机静态目录） */
  private resolveDefaultTarget(): 'local' | 'remote' {
    const cfg = this.configService.get<string>('PIPELINE_UPLOAD_TARGET');
    if (cfg === 'local' || cfg === 'remote') return cfg;
    return 'local';
  }

  // ── 阶段命令（每模块每阶段一条 shell，DB 为真相源）────────────────

  /**
   * 发布关键事件通知（尽力而为；通知失败由 NotificationService 兜底，不影响发布主流程）。
   */
  private notifyPipelineEvent(
    p: DeployPipelineEntity,
    event: string,
    status: 'success' | 'failed' | 'warn',
    detail: string,
  ): Promise<void> {
    return this.notifications.notify({
      event,
      env: p.env,
      moduleKey: p.moduleKey,
      versionTag: p.versionTag,
      status,
      detail,
      operator: p.operator,
    });
  }

  /**
   * 解析要注入的环境变量：配置中心按 global → env → module 合并的结果。
   *
   * 合并后的键**强制覆盖**既有环境（历史 `PORT=6200` 污染的对策）。
   * 解析失败只告警不阻断——配置中心是增强能力，不该让整个发布失败。
   */
  private async resolveInjectEnv(p: DeployPipelineEntity): Promise<Record<string, string>> {
    try {
      const cfg = await this.configs.resolve(p.env, p.moduleKey);
      const keys = Object.keys(cfg);
      if (keys.length) {
        p.logs = [...(p.logs ?? []), `[config] 注入 ${keys.length} 项配置（强制覆盖）`];
        await this.save(p);
      }
      return cfg;
    } catch (e) {
      this.logger.warn(`解析配置失败，本次不注入配置: ${(e as Error).message}`);
      return {};
    }
  }

  /**
   * 执行某阶段的模块命令。
   * @returns true=已配置命令且执行成功；false=未配置命令（调用方走内置逻辑或 fail-fast）
   */
  private async runStageCommand(p: DeployPipelineEntity, stage: string): Promise<boolean> {
    const cmd = await this.stageCommands.resolve(p.moduleKey, stage);
    if (!cmd) return false;

    this.assertNotCancelled(p);
    await this.enterStage(p, stage as any, `执行阶段命令: ${p.moduleKey}/${stage}`);

    let mod: any = null;
    try {
      mod = await this.moduleRegistry.get(p.moduleKey);
    } catch {
      /* 查不到模块信息时 env 留空 */
    }

    const env: Record<string, string> = {
      DEPLOY_ENV: p.env || '',
      MODULE_KEY: p.moduleKey,
      BRANCH: p.gitBranch || '',
      COMMIT_ID: p.versionTag || '',
      RELEASE_DIR: this.releaseWorkspace,
      STAGE: stage,
      MODULE_TYPE: mod?.type || p.moduleType || '',
      MODULE_DIR: mod?.dir || '',
      PM2_NAME: mod?.pm2 || p.moduleKey,
    };
    p.logs = [...(p.logs ?? []), `[${stage}] $ ${cmd.command}`];
    await this.save(p);

    // 命令必须在模块目录下执行：默认模板依赖 cwd 定位 tsconfig / 产物目录
    const cwd = resolveStageCwd(this.releaseWorkspace, mod?.type || p.moduleType, mod?.dir);
    p.logs = [...(p.logs ?? []), `[${stage}] cwd: ${cwd}`];
    await this.save(p);

    // 配置中心注入（global → env → module 强制覆盖）
    const inject = await this.resolveInjectEnv(p);
    const code = await this.runShell(cmd.command, { ...env, ...inject }, p, cmd.timeoutSec, cwd);
    if (code !== 0) {
      throw new Error(`[${stage}] 阶段命令执行失败（exit ${code}），详见日志`);
    }
    p.logs = [...(p.logs ?? []), `[${stage}] 阶段命令完成`];
    await this.save(p);
    return true;
  }

  /**
   * 执行 shell 命令（bash -c），输出流式进流水线日志。
   * 超时优先用该阶段配置的 timeoutSec，缺省用 BUILD_TIMEOUT_MS。
   */
  private runShell(
    command: string,
    env: Record<string, string>,
    p: DeployPipelineEntity,
    timeoutSec?: number,
    cwd?: string,
  ): Promise<number> {
    return new Promise((resolve) => {
      const timeoutMs = timeoutSec && timeoutSec > 0 ? timeoutSec * 1000 : BUILD_TIMEOUT_MS;
      const child = spawn('bash', ['-c', command], {
        // 未显式传 cwd 时回落到发布目录，避免落到 deploy-console 自身目录
        cwd: cwd || this.releaseWorkspace,
        // PATH 补齐与 CommandService 同一实现（node 目录 / /usr/local/bin 等）
        env: buildChildEnv(env, this.command.nodeBinDir()),
      });
      // 登记子进程：取消时可立即 SIGKILL，否则"已取消的发布"要等当前命令自然结束/超时才终止
      this.shells.set(p.id, child);
      const unregister = () => this.shells.delete(p.id);
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

      // 日志节流：命令逐行输出按 300ms 合并写库，避免每行都全量序列化 p.logs
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          this.save(p).catch(() => undefined);
        }, 300);
      };
      const pushLog = (line: string) => {
        p.logs = [...(p.logs ?? []), line];
        scheduleFlush();
      };
      const finalize = (code: number) => {
        clearTimeout(timer);
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = undefined;
        }
        unregister();
        resolve(code ?? 1);
      };

      child.stdout.on('data', (d: Buffer) => {
        for (const line of String(d).split('\n').filter(Boolean)) pushLog(line);
      });
      child.stderr.on('data', (d: Buffer) => {
        for (const line of String(d).split('\n').filter(Boolean)) pushLog(`[stderr] ${line}`);
      });
      child.on('close', (code: number | null) => {
        finalize(code ?? 1);
      });
      child.on('error', (err: Error) => {
        pushLog(`[${env.STAGE ?? 'shell'}] 命令启动失败: ${err.message}`);
        finalize(1);
      });
    });
  }

  private async save(p: DeployPipelineEntity): Promise<void> {
    await this.pipelineRepo.save(p).catch((e) => this.logger.warn(`保存流水线失败: ${e.message}`));
  }

  private assertNotCancelled(p: DeployPipelineEntity): void {
    if (this.cancelled.has(p.id)) {
      throw new Error('流水线已被取消');
    }
  }

  private async enterStage(p: DeployPipelineEntity, stage: string, message: string): Promise<void> {
    this.assertNotCancelled(p);
    const index = PIPELINE_STAGES.indexOf(stage as any);
    p.stage = stage;
    p.progress = { current: index + 1, total: PIPELINE_STAGES.length, message };
    p.logs = [...(p.logs ?? []), `[${new Date().toISOString()}] [${stage}] ${message}`];
    await this.save(p);
  }


  /**
   * 后端探活（**不抛错**，返回健康状态）：查 pm2 进程 → 取端口 → HTTP 探活。
   * 供回滚后确认"服务确实恢复了"使用，与 verify 阶段的区别是不阻断流程。
   */
  private async probeBackendHealth(
    p: DeployPipelineEntity,
  ): Promise<{ ok: boolean; note: string; port?: string | number }> {
    try {
      const mod = await this.moduleRegistry.get(p.moduleKey);
      const res = await this.pm2Probe.probeOnce(p.moduleKey, mod?.pm2);
      if (!res.online) return { ok: false, note: 'pm2 中未找到处于 online 的服务进程' };
      const port = res.hit?.port;
      if (port == null) return { ok: false, note: 'pm2_env.PORT 缺失，无法做端口探活' };
      const ok = res.reachable === true;
      return { ok, note: `端口 ${port} ${ok ? '有响应' : '无响应'}`, port };
    } catch (e) {
      return { ok: false, note: (e as Error).message };
    }
  }


  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
