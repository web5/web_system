import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalModule } from '../approval/approval.module';
import { AuditModule } from '../audit/audit.module';
import { CloudDbModule } from '../cloud-db/cloud-db.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ReleaseLockModule } from '../release-lock/release-lock.module';
import { DeployTaskEntity } from '../entities/deploy-task.entity';
import { DeployCleanupScanEntity } from '../entities/deploy-cleanup-scan.entity';
import { RemoteDeliveryModule } from '../remote/remote-delivery.module';
import { StartupReconcileService } from './startup-reconcile.service';
import { ConsistencyWatchService } from './consistency-watch.service';
import { RetentionService } from './retention.service';
import { CleanupScanService } from './cleanup-scan.service';
import { CleanupScanLogService } from './cleanup-scan-log.service';
import { ApprovalExpiryService } from './approval-expiry.service';
import { PointerReconcileService } from './pointer-reconcile.service';
import { ConfigAuditWatchService } from './config-audit-watch.service';
import { ReconcileController } from './reconcile.controller';
import { AppsModule } from '../apps/apps.module';
import { ProbeModule } from '../probe/probe.module';
import { CommonModule } from '../common/common.module';

/**
 * 运维自愈模块（诊断 #12 / #13）。
 *
 * - `StartupReconcileService`：启动即跑，回收「重启后永久 running」的僵尸任务与过期锁
 * - `ConsistencyWatchService`：定时比对两库 prod 指针，把漂移从「人想起来才查」变成**主动发现**
 * - `RetentionService`：定时清理超期的任务/版本/审计日志（诊断 #18，默认只观测）
 * - `CleanupScanService` + `CleanupScanLogService`：把上述两个清理能力的**观测结果**落库
 *   （诊断 #18 遗留观测项），使「连续观察 N 天再开开关」具备事实依据
 * - `ApprovalExpiryService`：定时作废超期 pending 审批单（鉴权时效收口）——
 *   放这里而不是 ApprovalModule，是因为它要调 `PipelineService.cancel`，
 *   而 PipelineModule 已经 import ApprovalModule，反向依赖会成环
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeployTaskEntity, DeployCleanupScanEntity]),
    ReleaseLockModule,
    CloudDbModule,
    AuditModule,
    // 远端产物扫描（只调 scan，不调 cleanup）—— 无循环依赖：ReconcileModule 仅被 app.module 引入
    RemoteDeliveryModule,
    // 审批超时作废：需要审批单查询 + 走既有 cancel 联动终止流水线
    ApprovalModule,
    PipelineModule,
    // 半发布治理 F2：盘↔表↔manifest 对账要读磁盘指针（EnvArtifactService）与 gateway manifest（Probe+Common）
    AppsModule,
    ProbeModule,
    CommonModule,
  ],
  controllers: [ReconcileController],
  providers: [
    StartupReconcileService,
    ConsistencyWatchService,
    RetentionService,
    CleanupScanService,
    CleanupScanLogService,
    ApprovalExpiryService,
    PointerReconcileService,
    ConfigAuditWatchService,
  ],
  exports: [
    StartupReconcileService,
    ConsistencyWatchService,
    RetentionService,
    CleanupScanService,
    CleanupScanLogService,
    ApprovalExpiryService,
    PointerReconcileService,
    ConfigAuditWatchService,
  ],
})
export class ReconcileModule {}
