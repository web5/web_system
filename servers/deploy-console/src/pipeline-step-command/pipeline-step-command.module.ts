import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployPipelineStepCommandEntity } from '../entities/deploy-pipeline-step-command.entity';
import { DeployPipelineStepBranchEntity } from '../entities/deploy-pipeline-step-branch.entity';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import { PipelineStepCommandService } from './pipeline-step-command.service';
import { PipelineStepCommandController } from './pipeline-step-command.controller';
import { PlatformScriptSeedService } from './platform-script-seed.service';
import { StepBranchService } from './step-branch.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // 模板实体用于平台托管脚本的全量同步（启动/提交时按模板 seed）
    TypeOrmModule.forFeature([
      DeployPipelineStepCommandEntity,
      DeployPipelineStepBranchEntity,
      DeployPipelineTemplateEntity,
    ]),
    AuditModule,
  ],
  controllers: [PipelineStepCommandController],
  providers: [PipelineStepCommandService, PlatformScriptSeedService, StepBranchService],
  exports: [PipelineStepCommandService, PlatformScriptSeedService, StepBranchService],
})
export class PipelineStepCommandModule {}
