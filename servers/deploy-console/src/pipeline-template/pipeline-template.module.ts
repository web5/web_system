import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import { PipelineTemplateService } from './pipeline-template.service';
import { PipelineTemplateController } from './pipeline-template.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * 流水线模板模块（S6-I）：模板=流程定义，实例=一次发布（deploy_pipelines）。
 * PipelineService 依赖本模块做提交解析（resolveForSubmit）与审批判定。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeployPipelineTemplateEntity]),
    // 模板 CRUD 需审计（含前后 diff）
    AuditModule,
  ],
  controllers: [PipelineTemplateController],
  providers: [PipelineTemplateService],
  exports: [PipelineTemplateService],
})
export class PipelineTemplateModule {}
