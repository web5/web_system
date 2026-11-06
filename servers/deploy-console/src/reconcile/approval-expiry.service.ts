import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApprovalService, APPROVAL_TTL_MS } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { PipelineService } from '../pipeline/pipeline.service';

/**
 * 审批单超时作废（鉴权时效收口 · 2026-11-06）。
 *
 * 背景：`pending` 审批单此前**永不过期**。一张没人处理的 prod 单会永久占住
 * `(env, moduleKey)` 查重位，让同模块的后续发布一直 409；审批台上它还一直排在
 * 「在途单」里，只能靠人工作废。定时作废把「谁来清理」从人变成策略。
 *
 * 🔴 三条硬约束：
 *  1. **不另写一套作废 SQL**：正常路径走 `PipelineService.cancel` —— 它已含
 *     CAS `WHERE status='pending'`、挂起实例 `awaiting-approval → cancelled` 联动、
 *     `approval.cancel` + `pipeline.cancel` 双审计。这里只负责「何时扫、扫到谁」。
 *  2. **`expires_at IS NULL` 的老单一律不碰**：历史单不回填，上线不能顺手清掉在途单。
 *  3. **单条失败不中断整批**：记 warn，下轮重试。作废是幂等操作（CAS 保证）。
 *
 * 兜底路径：`PipelineService.cancel` 只在流水线处于挂起态时联动作废审批单。
 * 若流水线已是终态（或被「已进入产物交付阶段禁止中断」挡住），单子仍会 pending ——
 * 这时补一次 `ApprovalService.cancel`，否则它会每轮都被扫到、永远清不掉。
 *
 * 调度：与 `ConsistencyWatchService` / `RetentionService` / `FactWatchService`
 * 同一范式（`setInterval` + env 开关 + `unref`）。console 有意不引 `@nestjs/schedule`
 * —— 见 consistency-watch.service.ts 顶部注释，那里已经否决过加依赖。
 */
export const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
/** 首次扫描延迟（默认 90s）：别和启动对账 / 首轮巡检挤在同一刻打 DB */
const DEFAULT_FIRST_DELAY_MS = 90 * 1000;
/** 单轮上限：宁可多跑几轮，也不要一次锁住大表 */
const BATCH_LIMIT = 100;
/** 系统操作者标识（进审计 user 字段，与人工操作区分） */
export const SYSTEM_ACTOR = 'system';

export interface ApprovalExpiryReport {
  ranAt: number;
  /** 命中的过期单数 */
  scanned: number;
  /** 成功作废数 */
  expired: number;
  /** 失败数（下轮重试） */
  failed: number;
  /** 其中流水线也被取消的数量（其余是「单关掉但流水线已终态」） */
  pipelineCancelled: number;
}

@Injectable()
export class ApprovalExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApprovalExpiryService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  /** 防重入：上一轮没跑完（DB 慢）时跳过本轮，而不是叠着跑 */
  private sweeping = false;
  private last: ApprovalExpiryReport | undefined;

  constructor(
    private readonly cfg: ConfigService,
    private readonly approvals: ApprovalService,
    private readonly pipelines: PipelineService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const rawEnabled = String(this.cfg.get('APPROVAL_EXPIRY_ENABLED') ?? '').trim();
    if (rawEnabled === '0' || rawEnabled.toLowerCase() === 'false') {
      this.logger.log('审批超时作废已关闭（APPROVAL_EXPIRY_ENABLED=0）');
      return;
    }
    const raw = Number(this.cfg.get<string>('APPROVAL_EXPIRY_INTERVAL_MS'));
    const configured = String(this.cfg.get('APPROVAL_EXPIRY_INTERVAL_MS') ?? '').trim();
    const interval = configured !== '' && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SWEEP_INTERVAL_MS;
    if (interval <= 0) {
      this.logger.log('审批超时作废已关闭（APPROVAL_EXPIRY_INTERVAL_MS=0）');
      return;
    }

    const run = () => {
      void this.sweep().catch((e) => this.logger.error(`审批超时作废异常：${(e as Error).message}`));
    };
    const delayMs =
      Number(this.cfg.get<string>('APPROVAL_EXPIRY_FIRST_DELAY_MS')) || DEFAULT_FIRST_DELAY_MS;
    this.firstTimer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }, delayMs);
    (this.firstTimer as unknown as { unref?: () => void })?.unref?.();
    this.logger.log(
      `审批超时作废已启用：每 ${Math.round(interval / 60000)} 分钟扫一次（首次 ${Math.round(
        delayMs / 1000,
      )}s 后），TTL ${Math.round(APPROVAL_TTL_MS / 86400000)} 天`,
    );
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /** 最近一次扫描结果（排障 / 单测断言用） */
  report(): ApprovalExpiryReport | undefined {
    return this.last;
  }

  /** 扫一轮（`nowMs` 可注入，便于测试时钟） */
  async sweep(nowMs: number = Date.now()): Promise<ApprovalExpiryReport> {
    if (this.sweeping) {
      return this.last ?? { ranAt: nowMs, scanned: 0, expired: 0, failed: 0, pipelineCancelled: 0 };
    }
    this.sweeping = true;
    const report: ApprovalExpiryReport = {
      ranAt: nowMs,
      scanned: 0,
      expired: 0,
      failed: 0,
      pipelineCancelled: 0,
    };
    try {
      const rows = await this.approvals.findExpiredPending(nowMs, BATCH_LIMIT);
      report.scanned = rows.length;
      for (const row of rows) {
        const ok = await this.expireOne(row, nowMs, report);
        if (ok) report.expired += 1;
        else report.failed += 1;
      }
      if (report.scanned > 0) {
        this.logger.warn(
          `审批超时作废本轮：命中 ${report.scanned}，作废 ${report.expired}，失败 ${report.failed}，` +
            `其中流水线同步取消 ${report.pipelineCancelled}`,
        );
      }
    } finally {
      this.sweeping = false;
      this.last = report;
    }
    return report;
  }

  /** 单张单的作废；返回是否已确认作废（false = 失败，留给下轮） */
  private async expireOne(
    row: DeployApprovalEntity,
    nowMs: number,
    report: ApprovalExpiryReport,
  ): Promise<boolean> {
    const expiresAt = Number(row.expiresAt) || nowMs;
    const overdueHours = Math.max(0, Math.round((nowMs - expiresAt) / 3600_000));
    const reason = `审批超时作废（创建于 ${this.fmt(row.createdAt)}，超过 ${
      Math.round(APPROVAL_TTL_MS / 86400000)
    } 天未处理）`;

    // ── 1) 正常路径：走既有 cancel（CAS + 挂起态联动 + 双审计）──
    // 🔴 必须用本行的局部标志，不能用 report.pipelineCancelled：
    //    那是**整批累计计数**，同一轮里第 1 张单取消成功后，
    //    第 2 张（流水线已终态、根本没取消）也会被写成「已联动取消」。
    let cancelledHere = false;
    try {
      const res = await this.pipelines.cancel(row.pipelineId, SYSTEM_ACTOR, reason);
      if (res.status === 'cancelled') {
        cancelledHere = true;
        report.pipelineCancelled += 1;
      }
    } catch (e) {
      // 单条失败不中断整批：流水线可能处于「已进入产物交付阶段，禁止中断」
      this.logger.warn(
        `审批超时作废：取消流水线 ${row.pipelineId} 失败（继续尝试关单）：${(e as Error).message}`,
      );
    }

    // ── 2) 兜底：cancel 没关掉这张单（流水线已终态 / 上一步抛错）时补关 ──
    let closed = false;
    try {
      const after = await this.approvals.get(row.id);
      if (after.status === 'pending') {
        await this.approvals.cancel(row.id, reason, SYSTEM_ACTOR);
      }
      closed = true;
    } catch (e) {
      this.logger.warn(`审批超时作废：关闭审批单 ${row.id} 失败：${(e as Error).message}`);
      return false;
    }

    // ── 3) 策略审计：区分「超时被系统清」与「人工作废」──
    //    approval.cancel 已记过一笔，但它无法表达「原因是超时策略」；
    //    这条带超时时长，供事后评估 TTL 定得是否合理。
    await this.audit
      .log({
        user: SYSTEM_ACTOR,
        action: 'approval.expire',
        env: row.env,
        component: row.moduleKey,
        status: 'cancelled',
        detail:
          `审批单超时作废：单号 ${row.id}；env=${row.env}；moduleKey=${row.moduleKey}；` +
          `node=${row.nodeKey ?? '-'}；createdAt=${this.fmt(row.createdAt)}；` +
          `expiresAt=${this.fmt(expiresAt)}；已超时 ${overdueHours}h；` +
          `pipelineId=${row.pipelineId}；流水线状态=${cancelledHere ? '已联动取消' : '未取消'}`,
      })
      .catch((e: Error) => this.logger.warn(`审批超时作废审计写入失败 ${row.id}: ${e.message}`));

    return closed;
  }

  private fmt(ms?: number | null): string {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '-';
    return new Date(n).toLocaleString('zh-CN', { hour12: false });
  }
}
