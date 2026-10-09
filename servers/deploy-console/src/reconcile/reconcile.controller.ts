import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { StartupReconcileService } from './startup-reconcile.service';
import { ConsistencyWatchService } from './consistency-watch.service';
import { RetentionService } from './retention.service';
import { CleanupScanService } from './cleanup-scan.service';

/**
 * 运维自愈接口（诊断 #12 / #13）。
 *
 * 三件事，都是「线上已经出问题时要有的抓手」：
 * - `POST /api/reconcile/run`：手动跑一次启动对账（回收僵尸任务 + 清过期锁）
 * - `GET  /api/reconcile/consistency`：看最近一次两库一致性巡检结果（`?run=1` 立即跑）
 * - `GET|DELETE /api/reconcile/locks`：看当前谁在发布 / **强制解锁**
 * - `GET  /api/reconcile/retention`：数据保留巡检结果（`?run=1` 立即跑；默认只观测不删）
 * - `POST /api/reconcile/scans/*`：清理巡检（**只观测**）并留痕，`GET scans` 回看历史
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
    private readonly cleanupScan: CleanupScanService,
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

  /**
   * 清理巡检（只观测）+ 留痕。
   *
   * 与 `GET retention` 的区别：那个只返回当次结果，这个会**落库**，
   * 于是「连续观察 7 天再决定开不开开关」才真的做得到（否则每天的数字都在响应里飘走）。
   */
  @Post('scans/retention')
  @ApiOperation({ summary: '跑一次数据保留巡检并留痕（是否真删由 RETENTION_ENABLED 决定）' })
  async scanRetention(@CurrentUser() user: any) {
    const r = await this.cleanupScan.runRetention(user?.username);
    await this.audit.log({
      user: user?.username || 'unknown',
      action: 'reconcile.scan.retention',
      status: r.report.status,
      detail: `数据保留巡检：候选 ${r.scan.candidateCount} 条、删除 ${r.scan.deletedCount} 条（${r.report.status}）`,
    });
    return r;
  }

  @Post('scans/remote')
  @ApiOperation({ summary: '跑一次远端产物巡检并留痕（只列出会删哪些，绝不删除）' })
  async scanRemote(
    @Body() body: { env?: string; moduleKey?: string },
    @CurrentUser() user: any,
  ) {
    const env = (body?.env || 'dev').trim();
    const r = await this.cleanupScan.runRemote(env, body?.moduleKey, user?.username);
    await this.audit.log({
      user: user?.username || 'unknown',
      action: 'reconcile.scan.remote',
      env,
      status: 'success',
      detail: `远端产物巡检 ${env}：候选 ${r.scan.candidateCount} 个（模块 ${r.outcomes.length} 个，只观测未删除）`,
    });
    return r;
  }

  @Get('scans')
  @ApiOperation({ summary: '清理巡检历史（?kind=retention|remote&env=&limit=）' })
  async listScans(@Query('kind') kind: string, @Query('env') env: string, @Query('limit') limit: string) {
    return this.cleanupScan.list({ kind, env, limit: Number(limit) });
  }

  @Get('scans/:id')
  @ApiOperation({ summary: '单条清理巡检详情（含候选清单）' })
  async getScan(@Param('id') id: string) {
    return this.cleanupScan.one(id);
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
