import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployPipelineStepCommandEntity } from '../entities/deploy-pipeline-step-command.entity';
import { PipelineStepCommandService } from './pipeline-step-command.service';
import { PipelineStepCommandController } from './pipeline-step-command.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeployPipelineStepCommandEntity]), AuditModule],
  controllers: [PipelineStepCommandController],
  providers: [PipelineStepCommandService],
  exports: [PipelineStepCommandService],
})
export class PipelineStepCommandModule {}
