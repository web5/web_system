import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ShellModule } from '../shell/shell.module';
import { RemoteDeliveryModule } from '../remote/remote-delivery.module';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { DeployFactSnapshotEntity } from '../entities/deploy-fact-snapshot.entity';
import { FactCollectService } from './fact-collect.service';
import { FactWatchService } from './fact-watch.service';
import { FactController } from './fact.controller';

/**
 * 事实层（Fact）v1 —— 《console 建设方案》P0-6。
 *
 * 把「线上真实态」定时采回来，与期望态比对出漂移，落 `deploy_fact_snapshots`。
 * 与 `ReconcileModule` 的分工：那边对账**平台自己的两库**，这边对账**平台 vs 机器**。
 *
 * 依赖取既有能力：本机命令走 `ShellModule`，远端走 `RemoteDeliveryModule` 的
 * `SshExecService`（目标机解析的唯一入口，不再自己解析一遍）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeployFactSnapshotEntity,
      DeployAppEnvVersionEntity,
      DeployServiceEnvEntity,
    ]),
    ShellModule,
    RemoteDeliveryModule,
    AuditModule,
  ],
  controllers: [FactController],
  providers: [FactCollectService, FactWatchService],
  exports: [FactCollectService],
})
export class FactModule {}
