import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeployPipelineStepEntity } from '../entities/deploy-pipeline-step.entity';
import { DeployPipelineTaskEntity } from '../entities/deploy-pipeline-task.entity';
import { DeployPipelineActionEntity } from '../entities/deploy-pipeline-action.entity';
import { PipelineOrchestrationService } from './pipeline-orchestration.service';
import { PipelineOrchestrationController } from './pipeline-orchestration.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * 流水线编排（步骤 → 任务 → 动作）—— 新三层实体模型（specs/pipeline-step-task/design.md）。
 *
 * P1 骨架：实体 + 整树读取 + 全量保存 + managed 动作保护。
 * 执行引擎（P2）与 p16 迁移（P3）后续接入。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeployPipelineStepEntity,
      DeployPipelineTaskEntity,
      DeployPipelineActionEntity,
    ]),
    AuditModule,
  ],
  controllers: [PipelineOrchestrationController],
  providers: [PipelineOrchestrationService],
  exports: [PipelineOrchestrationService],
})
export class PipelineOrchestrationModule {}
