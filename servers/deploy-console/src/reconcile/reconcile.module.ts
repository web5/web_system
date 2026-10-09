import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CloudDbModule } from '../cloud-db/cloud-db.module';
import { ReleaseLockModule } from '../release-lock/release-lock.module';
import { DeployTaskEntity } from '../entities/deploy-task.entity';
import { StartupReconcileService } from './startup-reconcile.service';
import { ConsistencyWatchService } from './consistency-watch.service';
import { RetentionService } from './retention.service';
import { ReconcileController } from './reconcile.controller';

/**
 * 运维自愈模块（诊断 #12 / #13）。
 *
 * - `StartupReconcileService`：启动即跑，回收「重启后永久 running」的僵尸任务与过期锁
 * - `ConsistencyWatchService`：定时比对两库 prod 指针，把漂移从「人想起来才查」变成**主动发现**
 * - `RetentionService`：定时清理超期的任务/版本/审计日志（诊断 #18，默认只观测）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeployTaskEntity]),
    ReleaseLockModule,
    CloudDbModule,
    AuditModule,
  ],
  controllers: [ReconcileController],
  providers: [StartupReconcileService, ConsistencyWatchService, RetentionService],
  exports: [StartupReconcileService, ConsistencyWatchService, RetentionService],
})
export class ReconcileModule {}
