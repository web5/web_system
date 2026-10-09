import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { StartupReconcileService } from './startup-reconcile.service';
import { ConsistencyWatchService } from './consistency-watch.service';
import { RetentionService } from './retention.service';

/**
 * 运维自愈接口（诊断 #12 / #13）。
 *
 * 三件事，都是「线上已经出问题时要有的抓手」：
 * - `POST /api/reconcile/run`：手动跑一次启动对账（回收僵尸任务 + 清过期锁）
 * - `GET  /api/reconcile/consistency`：看最近一次两库一致性巡检结果（`?run=1` 立即跑）
 * - `GET|DELETE /api/reconcile/locks`：看当前谁在发布 / **强制解锁**
 * - `GET  /api/reconcile/retention`：数据保留巡检结果（`?run=1` 立即跑；默认只观测不删）
 *
 * ⚠️ 强制解锁是危险操作：只在确认发布进程确实没了时使用，故强制留审计。
 */
@ApiTags('运维自愈')
@ApiBearerAuth()
@Controller('reconcile')
export class ReconcileController {
  constructor(
    private readonly reconcile: StartupReconcileService,
    private readonly consistency: ConsistencyWatchService,
    private readonly locks: ReleaseLockService,
    private readonly retentionSvc: RetentionService,
    private readonly audit: AuditService,
  ) {}

  @Post('run')
  @ApiOperation({ summary: '手动执行一次启动对账（回收僵尸任务 + 清理过期发布锁）' })
  async run(@CurrentUser() user: any) {
    const r = await this.reconcile.reconcile();
    await this.audit.log({
      user: user?.username || 'unknown',
      action: 'reconcile.run',
      status: 'success',
      detail: `手动对账：回收僵尸任务 ${r.staleTasks} 条、清理过期锁 ${r.staleLocks} 条`,
    });
    return r;
  }

  @Get('consistency')
  @ApiOperation({ summary: '两库一致性巡检结果（?run=1 立即执行一次）' })
  async consistencyStatus(@Query('run') run: string) {
    if (run === '1') return this.consistency.check();
    return (
      this.consistency.lastReport() ?? {
        ranAt: 0,
        status: 'skipped',
        reason: '尚未执行过巡检（用 ?run=1 立即执行）',
        checkedRows: 0,
        diffs: [],
      }
    );
  }

  @Get('retention')
  @ApiOperation({ summary: '数据保留巡检结果（?run=1 立即执行；RETENTION_ENABLED≠true 时只统计不删除）' })
  async retention(@Query('run') run: string) {
    if (run === '1') return this.retentionSvc.run();
    return (
      this.retentionSvc.lastReport() ?? {
        ranAt: 0,
        enabled: this.retentionSvc.enabled,
        keepDays: this.retentionSvc.keepDays,
        status: 'skipped',
        reason: '尚未执行过保留巡检（用 ?run=1 立即执行）',
        tables: [],
      }
    );
  }

  @Get('locks')
  @ApiOperation({ summary: '列出当前发布锁（谁在发布、是否已过期）' })
  async listLocks() {
    return this.locks.listAll();
  }

  @Delete('locks/:moduleKey/:env')
  @ApiOperation({ summary: '强制解锁（确认发布进程已终止时使用，留审计）' })
  async forceUnlock(
    @Param('moduleKey') moduleKey: string,
    @Param('env') env: string,
    @CurrentUser() user: any,
  ) {
    const before = await this.locks.holder(moduleKey, env);
    const removed = await this.locks.forceRelease(moduleKey, env);
    await this.audit.log({
      user: user?.username || 'unknown',
      action: 'release-lock.force-unlock',
      env,
      component: moduleKey,
      status: removed ? 'success' : 'skipped',
      detail: removed
        ? `强制解锁 ${moduleKey}@${env}（原持有者 ${before?.pipelineId ?? '未知'}${before?.expiresAt ? `，原到期 ${new Date(before.expiresAt).toISOString()}` : ''}）`
        : `强制解锁 ${moduleKey}@${env}：无锁可解`,
    });
    return { ok: removed, moduleKey, env, previousHolder: before?.pipelineId ?? null };
  }
}
