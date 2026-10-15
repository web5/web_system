import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ArtifactStoreService } from '../artifact/artifact-store.service';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';
import { ApprovalService } from '../approval/approval.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { FactCollectService } from '../fact/fact-collect.service';
import { FACT_ALERT_STATUSES } from '../entities/deploy-fact-snapshot.entity';
import { defaultReleaseWorkspace, toCommitId } from '../pipeline/release-paths';
import { resolveStaticTarget, StaticTarget } from '../apps/static-target';
import {
  ReleasePlan,
  ReleasePlanInput,
  ReleasePlanMode,
  ReleaseImpact,
  InvariantResult,
  InvariantKey,
  INVARIANT_KEYS,
  invariant,
  RELEASE_PLAN_KNOWN_GAPS,
} from './release-plan.types';
import {
  DEFAULT_FACT_MAX_AGE_MS,
  buildPlanId,
  buildEvidenceHash,
  buildSummary,
  gradeRisk,
  normalizeMode,
} from './release-plan-rules';

/** 取最近流水线列表时的上限（够判断"有没有正在跑"即可，不必全表） */
const RECENT_PIPELINE_LIMIT = 50;

/**
 * `release_plan` —— L1 只读 dry-run（《aiops-console-target-architecture》§五 MCP 工具矩阵）。
 *
 * **硬约束：只读。** 本服务不得调用任何写方法（save / create / update / delete /
 * acquire / submit / switchPointer …）。这不是洁癖，而是 L1 工具的定义：
 * Agent 拿到 plan 的能力是"提一个提案"，不是"顺手做点什么"。
 * 该约束由 `release-plan.service.spec.ts` 里的只读断言守住。
 *
 * 事实来源全部复用既有真相源，**不新增第二套判定**：
 *
 * | 不变量 | 真相源 |
 * |---|---|
 * | 模块在册 | `ModuleRegistryService.get` |
 * | 目标产物存在 | `ArtifactStoreService.exists` |
 * | 发布锁空闲 | `ReleaseLockService.holder` |
 * | 无并发流水线 | `PipelineService.list` |
 * | 环境健康 | `FactCollectService.latestBatch`（#341 事实巡检） |
 * | 回滚点存在 | `ReleaseRegistryService.resolveRollbackTarget`（诊断 #17 唯一口径） |
 * | 无重复待审 | `ApprovalService.pendingFor` |
 */
@Injectable()
export class ReleasePlanService {
  private readonly logger = new Logger(ReleasePlanService.name);

  constructor(
    private readonly cfg: ConfigService,
    private readonly modules: ModuleRegistryService,
    private readonly artifacts: ArtifactStoreService,
    private readonly locks: ReleaseLockService,
    private readonly registry: ReleaseRegistryService,
    private readonly approvals: ApprovalService,
    private readonly pipelines: PipelineService,
    private readonly facts: FactCollectService,
  ) {}

  /**
   * 生成发布提案。
   *
   * @throws 入参非法（空 env / 空 moduleKey / 目标 commit 含非法字符）时抛错。
   *         **事实查不到不抛错** —— 那正是 `unknown` 状态要表达的东西。
   */
  async plan(input: ReleasePlanInput): Promise<ReleasePlan> {
    const env = String(input?.env ?? '').trim();
    const moduleKey = String(input?.moduleKey ?? '').trim();
    if (!env) throw new Error('release_plan 需要 env');
    if (!moduleKey) throw new Error('release_plan 需要 moduleKey');

    const rawRef = String(input?.versionTag ?? '').trim();
    // 与流水线提交同源归一化（release-paths.toCommitId），避免出现第二套版本解析
    const targetVersion = rawRef ? (toCommitId(rawRef) ?? null) : null;
    if (targetVersion && !/^[A-Za-z0-9._-]{4,64}$/.test(targetVersion)) {
      throw new Error(`目标 commit 含非法字符: ${rawRef}`);
    }

    const mode = normalizeMode(input.mode);
    const target = resolveStaticTarget(
      env,
      (k) => this.cfg.get<string>(k),
      this.cfg.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace(),
    );

    // 影响面先算：它是人读结论的地基（"从哪个版本发到哪个版本"）
    const impact = await this.buildImpact(env, moduleKey, targetVersion, mode, target);

    // 各前置检查独立兜底：单项查不到只让**该项**变成 unknown，
    // 不能拖垮整份 plan —— 缺一项判据不是"什么都不敢说"的理由。
    const invariants: InvariantResult[] = [
      await this.safeCheck(INVARIANT_KEYS.moduleRegistered, () =>
        this.checkModuleRegistered(moduleKey),
      ),
      await this.safeCheck(INVARIANT_KEYS.targetArtifact, () =>
        this.checkTargetArtifact(moduleKey, targetVersion, target),
      ),
      await this.safeCheck(INVARIANT_KEYS.releaseLock, () => this.checkReleaseLock(moduleKey, env)),
      await this.safeCheck(INVARIANT_KEYS.noRunningPipeline, () =>
        this.checkRunningPipeline(moduleKey, env),
      ),
      await this.safeCheck(INVARIANT_KEYS.envHealthy, () => this.checkEnvHealthy(env)),
      await this.safeCheck(INVARIANT_KEYS.rollbackPoint, () =>
        this.checkRollbackPoint(moduleKey, env),
      ),
      await this.safeCheck(INVARIANT_KEYS.noPendingApproval, () =>
        this.checkPendingApproval(moduleKey, env),
      ),
    ];

    const isApprovalEnv = await this.safeBoolean(() => this.approvals.needsApproval(env), false);
    const requiresApproval = isApprovalEnv;
    const approvalReason = requiresApproval
      ? `环境 ${env} 在受控清单内（REQUIRE_APPROVAL_ENVS），提交将进入待审批；` +
        `此外提交时还会叠加流水线模板的审批策略（always/never/inherit），plan 阶段尚未绑定模板`
      : `环境 ${env} 不在受控清单内；最终仍以提交时「模板策略 ∩ 环境规则」为准`;

    const risk = gradeRisk({ env, mode, invariants, requiresApproval, isApprovalEnv });
    const evidenceHash = buildEvidenceHash({ impact, invariants, requiresApproval });

    const blockers = invariants.filter((i) => i.blocking && i.status === 'fail').map((i) => i.title);
    const warnings = invariants
      .filter((i) => i.status === 'unknown' || (!i.blocking && i.status === 'fail'))
      .map((i) => `${i.title}：${i.detail}`);

    const summary = buildSummary({
      env,
      moduleKey,
      targetVersion,
      risk,
      blockers,
      unknowns: invariants.filter((i) => i.status === 'unknown').map((i) => i.title),
      requiresApproval,
    });

    const result: ReleasePlan = {
      planId: buildPlanId(input),
      evidenceHash,
      createdAt: Date.now(),
      dryRun: true,
      input: { env, moduleKey, versionTag: targetVersion, mode },
      impact,
      invariants,
      risk,
      requiresApproval,
      approvalReason,
      blockers,
      warnings,
      knownGaps: RELEASE_PLAN_KNOWN_GAPS,
      summary,
    };

    this.logger.log(
      `release_plan: ${summary} (planId=${result.planId}, evidence=${result.evidenceHash}, host=${impact.staticTarget})`,
    );
    return result;
  }

  // ── 影响面 ──

  private async buildImpact(
    env: string,
    moduleKey: string,
    targetVersion: string | null,
    mode: ReleasePlanMode,
    target: StaticTarget,
  ): Promise<ReleaseImpact> {
    const currentVersion =
      (await this.safeNullable(() => this.registry.currentVersion(env, moduleKey))) ?? null;
    let moduleType: string | null = null;
    try {
      moduleType = (await this.modules.get(moduleKey))?.type ?? null;
    } catch {
      // 模块不存在由「模块已登记」那条不变量表达，这里不影响影响面的其它字段
    }

    return {
      currentVersion,
      targetVersion,
      // 任一侧缺失就是 unknown —— 不知道"从哪来"或"到哪去"时，不能猜它变了
      versionChange:
        !currentVersion || !targetVersion
          ? 'unknown'
          : currentVersion === targetVersion
            ? 'same'
            : 'upgrade',
      moduleType,
      mode,
      staticRoot: target.root,
      staticTarget: target.sshTarget ?? 'local',
    };
  }

  // ── 不变量检查 ──

  private async checkModuleRegistered(moduleKey: string): Promise<InvariantResult> {
    const mod = await this.modules.get(moduleKey);
    return invariant({
      key: INVARIANT_KEYS.moduleRegistered,
      status: 'pass',
      blocking: true,
      detail: `模块 ${moduleKey} 已登记（type=${mod.type}）`,
      evidence: { type: mod.type },
    });
  }

  /**
   * 目标产物是否存在。
   *
   * 两处**必须**是 unknown 而非 pass：
   *  1. 没传 versionTag —— 本次要现场构建，发布前产物还没生成。报"不存在"是错的
   *     （会吓退正常发版），报"存在"更是纯属编造。
   *  2. 静态根在远端主机（STATIC_SSH_TARGET）—— 本机 fs 看不到那台机器。
   *     这里**不**为此建 SSH 连接：dry-run 不该有副作用，也不该拖长响应时间。
   */
  private async checkTargetArtifact(
    moduleKey: string,
    targetVersion: string | null,
    target: StaticTarget,
  ): Promise<InvariantResult> {
    const base = { key: INVARIANT_KEYS.targetArtifact };

    if (!targetVersion) {
      return invariant({
        ...base,
        status: 'unknown',
        blocking: false,
        detail:
          '未指定 versionTag：本次为现场构建，产物要到流水线构建阶段才生成，发布前无从校验；' +
          '如需先验请显式传入目标版本',
        evidence: { reason: 'no-target-version' },
      });
    }

    if (target.sshTarget) {
      return invariant({
        ...base,
        status: 'unknown',
        blocking: false,
        detail:
          `该环境静态根在远端主机 ${target.sshTarget}（${target.root}），本机无法读取；` +
          'dry-run 不建立 SSH 连接，故不做判定',
        evidence: { reason: 'remote-static-root', host: target.sshTarget, root: target.root },
      });
    }

    const exists = await this.artifacts.exists(moduleKey, targetVersion);
    return invariant({
      ...base,
      status: exists ? 'pass' : 'fail',
      blocking: true,
      detail: exists
        ? `本机产物目录中已存在 ${moduleKey}/${targetVersion} 入口`
        : `本机产物目录中不存在 ${moduleKey}/${targetVersion} 的 index.js —— 直接发布会在切指针阶段失败`,
      evidence: { moduleKey, version: targetVersion, root: target.root },
    });
  }

  /** 发布锁：过期锁视作可抢占（口径与 `canAcquire` 一致，不另写一套） */
  private async checkReleaseLock(moduleKey: string, env: string): Promise<InvariantResult> {
    const base = { key: INVARIANT_KEYS.releaseLock };
    const holder = await this.locks.holder(moduleKey, env);
    if (!holder) {
      return invariant({
        ...base,
        status: 'pass',
        blocking: true,
        detail: `无持有者，${moduleKey}@${env} 可获取发布锁`,
      });
    }
    const expired = holder.expiresAt <= Date.now();
    return invariant({
      ...base,
      status: expired ? 'pass' : 'fail',
      blocking: true,
      detail: expired
        ? `锁 ${moduleKey}@${env} 原由流水线 ${holder.pipelineId} 持有但已过期（${new Date(
            holder.expiresAt,
          ).toISOString()}），可被抢占`
        : `流水线 ${holder.pipelineId} 正持有 ${moduleKey}@${env} 的发布锁（至 ${new Date(
            holder.expiresAt,
          ).toISOString()}），并发发布会互相覆盖版本指针`,
      evidence: { holder: holder.pipelineId, expiresAt: holder.expiresAt, expired },
    });
  }

  /** 同「模块 × 环境」是否有正在运行的流水线（有 → 提交会被 409 拒绝） */
  private async checkRunningPipeline(moduleKey: string, env: string): Promise<InvariantResult> {
    const base = { key: INVARIANT_KEYS.noRunningPipeline };
    const rows = await this.pipelines.list(env, moduleKey, RECENT_PIPELINE_LIMIT);
    const running = rows.filter((r) => String(r.status) === 'running');
    if (running.length) {
      return invariant({
        ...base,
        status: 'fail',
        blocking: true,
        detail:
          `存在 ${running.length} 条运行中的流水线：${running.map((r) => r.id).join('、')}` +
          ' —— 提交会被拒绝（409）',
        evidence: { ids: running.map((r) => r.id) },
      });
    }
    return invariant({
      ...base,
      status: 'pass',
      blocking: true,
      detail: `最近 ${rows.length} 条流水线中无运行中任务`,
      evidence: { scanned: rows.length },
    });
  }

  /**
   * 目标环境健康（取 Fact 层最近一批事实）。
   *
   * **从不把"没数据"当成"健康"**：
   *  - 从未采集 → unknown
   *  - 快照超过 {@link DEFAULT_FACT_MAX_AGE_MS} → unknown（陈旧事实不等于此刻现状）
   *  - 环境不在 `FACT_SNAPSHOT_ENVS` 内 → unknown，且提示这是**持续性**缺口
   *
   * 有漂移时是 fail 但**不 blocking**：环境带着漂移跑新版本有时正是修复手段，
   * 一律拦住会让"发版修问题"这条路走不通。它以告警 + 抬高风险的方式表达。
   */
  private async checkEnvHealthy(env: string): Promise<InvariantResult> {
    const base = { key: INVARIANT_KEYS.envHealthy };
    const covered = this.facts.allowedEnvs().includes(env);
    const batch = await this.facts.latestBatch(env);

    if (!batch) {
      return invariant({
        ...base,
        status: 'unknown',
        blocking: false,
        detail:
          `环境 ${env} 从未做过事实巡检，无法确认线上当前是否健康` +
          (covered
            ? ''
            : '（且该环境不在 FACT_SNAPSHOT_ENVS 内，定时采集不会覆盖它，建议先加入或手动触发一次 /api/fact/collect）'),
        evidence: { reason: 'no-snapshot', inAllowedEnvs: covered },
      });
    }

    const ageMs = Date.now() - batch.collectedAt;
    const alerts = batch.items.filter((i) => FACT_ALERT_STATUSES.includes(i.status));

    if (ageMs > DEFAULT_FACT_MAX_AGE_MS) {
      return invariant({
        ...base,
        status: 'unknown',
        blocking: false,
        detail:
          `最近一次事实采集在 ${Math.round(ageMs / 3600_000)} 小时前` +
          `（${new Date(batch.collectedAt).toISOString()}），已超过 ${Math.round(
            DEFAULT_FACT_MAX_AGE_MS / 3600_000,
          )} 小时，不足以证明发布前此刻的健康状态`,
        evidence: { reason: 'stale', batchId: batch.batchId, ageMs, alerts: alerts.length },
      });
    }

    if (alerts.length) {
      return invariant({
        ...base,
        status: 'fail',
        blocking: false,
        detail:
          `最近一批事实快照（${new Date(batch.collectedAt).toISOString()}）有 ${alerts.length} 项异常：` +
          alerts
            .slice(0, 5)
            .map(
              (i) =>
                `${i.kind}[${i.targetKey}] ${i.status}（期望=${i.expected ?? '-'}，实际=${i.actual ?? '-'}）`,
            )
            .join('、'),
        evidence: {
          batchId: batch.batchId,
          alerts: alerts.map((i) => `${i.kind}:${i.targetKey}:${i.status}`),
        },
      });
    }

    return invariant({
      ...base,
      status: 'pass',
      blocking: false,
      detail: `最近一批事实快照（${new Date(batch.collectedAt).toISOString()}）${batch.items.length} 项全部一致`,
      evidence: { batchId: batch.batchId, checked: batch.items.length, ageMs },
    });
  }

  /**
   * 回滚点是否存在。
   *
   * 复用 `resolveRollbackTarget`（诊断 #17 收敛的唯一口径），不自己查历史版本表。
   *
   * 要区分"首次发布"与"已发布过却丢了回滚点"：前者是无可奈何的事实，
   * 后者是**数据异常**。两者都报 fail（都不该让人以为"失败能自动退回去"），
   * 但 detail 要指向不同的处置方式。
   */
  private async checkRollbackPoint(moduleKey: string, env: string): Promise<InvariantResult> {
    const base = { key: INVARIANT_KEYS.rollbackPoint };
    const current = (await this.registry.currentVersion(env, moduleKey)) ?? null;

    let rollback: { from: string | null; to: string; source: string } | null = null;
    let reason = '';
    try {
      rollback = await this.registry.resolveRollbackTarget({ env, moduleKey });
    } catch (e) {
      reason = (e as Error).message;
    }

    if (rollback?.to) {
      return invariant({
        ...base,
        status: 'pass',
        blocking: false,
        detail: `回滚目标 ${rollback.to}（来源=${rollback.source}，当前=${current ?? '无'}）`,
        evidence: { ...rollback, firstRelease: false },
      });
    }

    const firstRelease = !current;
    return invariant({
      ...base,
      status: 'fail',
      // 不 blocking：首次发布必然没有回滚点，拦住等于永远发不了第一个版本
      blocking: false,
      detail: firstRelease
        ? `${moduleKey}@${env} 无当前版本记录，属首次发布：发布失败后没有可自动回退的版本`
        : `${moduleKey}@${env} 当前版本为 ${current}，但找不到任何回滚目标 —— 属指针表/版本表数据异常，发布失败将无法自动回退`,
      evidence: { current, firstRelease, reason: reason || null },
    });
  }

  /** 是否已有待审单（有 → 提交会被 409 拒绝） */
  private async checkPendingApproval(moduleKey: string, env: string): Promise<InvariantResult> {
    const base = { key: INVARIANT_KEYS.noPendingApproval };
    const pending = await this.approvals.pendingFor(env, moduleKey);
    if (pending) {
      return invariant({
        ...base,
        status: 'fail',
        blocking: true,
        detail:
          `${moduleKey}@${env} 已有待审批单 ${pending.id}（流水线 ${pending.pipelineId}，` +
          `提交人 ${pending.operator}）—— 再提交会被拒绝（409）`,
        evidence: { approvalId: pending.id, pipelineId: pending.pipelineId, operator: pending.operator },
      });
    }
    return invariant({ ...base, status: 'pass', blocking: true, detail: '无待决审批单' });
  }

  // ── 兜底工具 ──

  /**
   * 单项检查的异常兜底。
   *
   * 抛错时返回 **unknown（非 blocking）** 而不是 fail：
   * "这项查不到"和"这项不通过"是两件事，前者不该假装成了后者。
   */
  private async safeCheck(key: InvariantKey, fn: () => Promise<InvariantResult>): Promise<InvariantResult> {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      return invariant({
        key,
        status: 'unknown',
        blocking: false,
        detail: `该项检查未能完成：${msg}`,
        evidence: { reason: 'check-threw', message: msg },
      });
    }
  }

  private async safeNullable<T>(fn: () => Promise<T | undefined>): Promise<T | undefined> {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  }

  /**
   * 布尔型查询的兜底。
   *
   * 审批开关读不到时兜 false，即"不额外要求审批"。这是**保守方向**：
   * 门禁缺失时不假装"要审批"（那会让工具直接不可用），也不假装"不用审批"去放行 ——
   * 真正的放行判定仍在 `pipeline.submit` 里独立重跑一遍，这里只给提案一个提示。
   */
  private async safeBoolean(fn: () => Promise<boolean>, fallback: boolean): Promise<boolean> {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }
}
