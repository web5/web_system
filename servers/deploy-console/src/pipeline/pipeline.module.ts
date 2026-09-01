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
import { HookModule } from '../hook/hook.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployPipelineEntity, DeployVersionEntity, DeployDeploymentEntity]),
    ModuleRegistryModule,
    CanaryModule,
    AuditModule,
    // 复用 DeployService 的版本查询能力（可发布版本列表）
    DeployModule,
    // 发布脚本 Hook（各阶段可自定义 shell）
    HookModule,
  ],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
