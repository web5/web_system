import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { CanaryModule } from '../canary/canary.module';
import { AuditModule } from '../audit/audit.module';
import { DeployModule } from '../deploy/deploy.module';
import { StageCommandModule } from '../stage-command/stage-command.module';
import { ConfigCenterModule } from '../config/config.module';
import { ReleaseLockModule } from '../release-lock/release-lock.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployPipelineEntity, DeployVersionEntity, DeployDeploymentEntity]),
    ModuleRegistryModule,
    CanaryModule,
    AuditModule,
    // 复用 DeployService 的版本查询能力（可发布版本列表）
    DeployModule,
    // 阶段命令（每模块每阶段一条 shell，DB 为真相源）
    StageCommandModule,
    // 配置中心（发布/重启时按作用域合并并强制覆盖注入进程环境）
    ConfigCenterModule,
    // 发布锁（同一模块×环境串行化，避免并发覆盖版本指针）
    ReleaseLockModule,
    // 通知中心（发布成功/失败/自动回滚事件推送）
    NotificationModule,
  ],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
